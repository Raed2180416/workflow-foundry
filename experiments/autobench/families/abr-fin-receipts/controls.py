"""abr-fin-receipts bad controls (code, no model). Each must FAIL the family; together they show the oracle rejects a
do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null               does nothing at all
  echo               repeats every trigger's data back into #expense-submissions as a top-level post
  naive              the <= 40-line "ignore every note and authority rule" heuristic (RECURRING-DESIGN §3.11 gate 4):
                     every top-level message with an amount is logged (the reference's reader for amount, date and
                     category; Pending over $500), only the three disallowed categories are rejected; no repost check,
                     no receipt, alcohol, meal, cap, hotel or flight rule; corrections are ignored and any reply
                     starting with "pre-approved" approves; the week-close email is computed correctly
  one-defect variants of the observable-only reference (plausible but wrong; each breaks exactly one rule):
    no-dedupe          reposts are processed as new receipts
    no-cap             the daily meal cap is ignored
    cap-all-meals      the daily cap counts every Meals row of the day (team meals too) and applies to team meals
    cap-week-only      the daily cap counts only rows submitted this week (last week's rows are ignored)
    any-corrector      a correction from anyone is applied
    any-approver       a "pre-approved" reply from anyone approves
    name-approver      the approver is matched by first name against the Manager column
    contains-approved  a reply that contains "pre-approved" anywhere approves ("Not pre-approved yet" too)
    field-category     a category field that is not one of the eight names is written as it stands (no word table)
    digits-only        amounts written in words are not read (the message is not a receipt)
    drinks-ok          the alcohol rule is ignored
    slack-name         the Employee cell is the Slack display name, not the Employees sheet name
    no-preapproval     receipts over $500 are logged Approved at once
    top-level-reply    replies are posted at the top level of the channel, not in the receipt's thread
    log-rejected       rejected receipts also get a Submissions row with Status Rejected
    total-all-weeks    the weekly totals count every Approved row, whatever week it was submitted
    no-receipt-rule    the receipt rule (over $25) is ignored
    domestic-only      every hotel gets the domestic nightly limit
    cabin-ignored      the flight rule is ignored
    six-hours-ok       business class is allowed from 6 hours on (inclusive)
    correction-append  a correction appends a second row instead of updating the receipt's row
    unknown-logged     a poster missing from Employees is logged under their Slack name instead of escalated
    date-posted        the expense date is always the posting date
  added with generator 1.1.0 (review 2026-10-21), one per rule the 1.0.0 streams never exercised:
    no-recheck         a correction applies the stated values and logs them; no rule is checked again (5.1)
    no-pending-check   the manager's 'pre-approved' approves without checking that the row is pending (5.2)
    repost-rel-now     an earlier message's 'today' / 'yesterday' / missing date is read relative to the new
                       message's posting date, not its own (4.2)
    category-first     the category is read (and an unreadable one escalated) before the repost check (4.2 before 4.3)
    cap-counts-rejected    the daily cap also counts rows with Status Rejected (rule 4d)
    total-counts-rejected  the weekly totals also count rows with Status Rejected (section 6)
    cap-counts-own-row     a corrected meal's cap counts its own old row too (5.1)
    latest-correction-only only the newest correction of a thread is applied to the original receipt (5.1)
    correction-receipt-day a correction's relative date is read on the receipt's posting day (5.1)
    preapproval-forgotten  a correction drops an earlier pre-approval (5.1, last bullet)
    preapproval-any-time   a manager's 'pre-approved' counts even when the row was not pending at the time (5.2)
    travel-facts-kept  a category corrected to Travel keeps the hotel and flight facts read under the old category
    cabin-anywhere     any 'business' in a flight description is a business cabin ('for a business meeting')
"""
from __future__ import annotations

import json
import re
from decimal import Decimal

import reference as R
from reference import (APPROVED, CHAN, NOT_ALLOWED, PENDING, SLACK, SUBMISSIONS, Receipts, handle, norm, parse_amount,
                       ts_date)


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    text = json.dumps(trigger.get("data") or {}, sort_keys=True, ensure_ascii=False)
    ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": CHAN, "text": text})


def naive(trigger, ctx):  # <= 40 lines: the shortcut a careless automation takes
    w, d = Receipts(trigger, ctx), trigger.get("data") or {}
    if trigger.get("event") == "week_close":
        return w.week_close(d["week_start"], d["date"])
    if trigger.get("event") != "new_message":
        return None
    text = d.get("text") or ""
    if d.get("thread_ts"):
        if not re.match(r"pre-approved\b", text.strip(), re.I):
            return None
        mine = next(((n, c) for n, c in w.sheet(SUBMISSIONS) if c["Message TS"] == d["thread_ts"]), None)
        if mine and norm(mine[1]["Status"]) == norm(PENDING):
            w.update_row(mine[0], dict(mine[1], Status=APPROVED))
            w.post(f"Logged: {R.money(Decimal(mine[1]['Amount']))} {mine[1]['Category']}", thread_ts=d["thread_ts"])
        return None
    if parse_amount(text) is None:
        return None
    emp = w.poster(d["user"]) or {"Employee": "Unknown"}
    f = w.read(text, d.get("attachments") or [], ts_date(d["ts"]))
    if f["category"] in NOT_ALLOWED:
        return w.post(f"Rejected: {f['category']} needs VP pre-approval", thread_ts=d["ts"])
    status = PENDING if f["amount"] > 500 else APPROVED
    w.append_row(w.row_for(d["ts"], ts_date(d["ts"]).isoformat(), emp["Employee"], f, status))
    w.post(w.outcome_text(status, None, f["amount"], f["category"]), thread_ts=d["ts"])


NAIVE_LINES = 25


class NoDedupe(Receipts):
    def is_repost(self, d, f):
        return False


class NoCap(Receipts):
    def cap_other(self, rows, name, d, exclude_ts):
        return Decimal("-100000")


class CapAllMeals(Receipts):
    """The cap counts every Meals row of the day and applies to team meals as well."""
    def individual(self, f):
        return f["category"] == "Meals"

    def att_value(self, v):
        return 1


class CapWeekOnly(Receipts):
    def cap_other(self, rows, name, d, exclude_ts):
        start = self.t["at"][:10]
        from datetime import date as _d, timedelta as _td
        monday = (_d.fromisoformat(start) - _td(days=_d.fromisoformat(start).weekday())).isoformat()
        return super().cap_other([(n, c) for n, c in rows if c.get("Submitted", "") >= monday], name, d, exclude_ts)


class AnyCorrector(Receipts):
    def is_corrector(self, user_id, parent):
        return bool(user_id)


class AnyApprover(Receipts):
    def is_manager(self, user_id, emp):
        return bool(user_id)


class NameApprover(Receipts):
    def is_manager(self, user_id, emp):
        out = self.ctx.fetch_json("GET", SLACK + "users.info", {"user": user_id})
        name = ((out or {}).get("user") or {}).get("real_name") or ""
        return bool(name) and norm(name.split()[0]) == norm(str(emp.get("Manager", "")).split()[0])


class ContainsApproved(Receipts):
    def thread_reply(self, d):
        text = (d.get("text") or "").strip()
        parent = self.parent(d["thread_ts"])
        if parent is not None and "pre-approved" in text.lower() and not re.match(r"correction\b", text, re.I):
            return self.preapproval(d, parent)
        return super().thread_reply(d)


class FieldCategory(Receipts):
    def category(self, text):
        m = re.search(r"\bcategory:\s*([^,()\n]+)", text, re.I)
        if m:
            return m.group(1).strip().title()
        return super().category(text)


class DigitsOnly(Receipts):
    def amount(self, text):
        a = parse_amount(text)
        return a if a is not None and re.search(r"\$\s?\d|\d\s*USD|USD\s*\d", text) else None


class DrinksOk(Receipts):
    def is_alcohol(self, text):
        return False


class SlackName(Receipts):
    def poster(self, user_id):
        emp = super().poster(user_id)
        if emp is None:
            return None
        out = self.ctx.fetch_json("GET", SLACK + "users.info", {"user": user_id})
        return dict(emp, Employee=out["user"]["real_name"])


class NoPreapproval(Receipts):
    def check(self, f, cap_other):
        status, reason = super().check(f, cap_other)
        return (APPROVED if status == PENDING else status), reason


class TopLevelReply(Receipts):
    def post(self, text, thread_ts=None, channel=CHAN):
        return super().post(text, None, channel)


class LogRejected(Receipts):
    def on_rejected(self, d, emp, f):
        self.append_row(self.row_for(d["ts"], ts_date(d["ts"]).isoformat(), emp["Employee"], f, R.REJECTED))


class TotalAllWeeks(Receipts):
    def week_lines(self, rows, week_start, friday):
        return super().week_lines(rows, "0000-00-00", "9999-99-99")


class NoReceiptRule(Receipts):
    def has_receipt(self, text, attachments):
        return True


class DomesticOnly(Receipts):
    def international(self, text):
        return False


class CabinIgnored(Receipts):
    def flight_rule(self, f):
        return None


class SixHoursOk(Receipts):
    def flight_rule(self, f):
        fl = f["flight"]
        if fl is not None and fl["hours"] is not None and fl["hours"] >= 6:
            return None
        return super().flight_rule(f)


class CorrectionAppend(Receipts):
    def correct_row(self, row_no, cells):
        self.append_row(cells)


class UnknownLogged(Receipts):
    def poster(self, user_id):
        emp = super().poster(user_id)
        if emp is not None:
            return emp
        out = self.ctx.fetch_json("GET", SLACK + "users.info", {"user": user_id})
        return {"Employee": out["user"]["real_name"], "Email": "", "Manager Email": ""}


class DatePosted(Receipts):
    def expense_date(self, text, posted):
        return posted


class NoRecheck(Receipts):
    def recheck(self, f, cap_other):
        return APPROVED, None


class NoPendingCheck(Receipts):
    def approvable(self, status):
        return True


class RepostRelNow(Receipts):
    def earlier_date(self, m, d):
        return R.parse_date(m.get("text") or "", ts_date(d["ts"]))


class CategoryFirst(Receipts):
    def is_repost(self, d, f):
        self.category(d.get("text") or "")      # raises Undecidable (an escalation) on a message without a category
        return super().is_repost(d, f)


class CapCountsRejected(Receipts):
    def cap_counts(self, status):
        return True


class TotalCountsRejected(Receipts):
    def in_total(self, status):
        return status in (norm(APPROVED), norm(R.REJECTED))


class CapCountsOwnRow(Receipts):
    def own_ts(self, parent):
        return None


class LatestCorrectionOnly(Receipts):
    def applies(self, m, d):
        return m["ts"] == d["ts"]


class CorrectionReceiptDay(Receipts):
    def correction_day(self, m, parent):
        return ts_date(parent["ts"])


class PreapprovalForgotten(Receipts):
    def keeps_preapproval(self, preapproved):
        return False


class PreapprovalAnyTime(Receipts):
    def preapproval_counts(self, pending):
        return True


class TravelFactsKept(Receipts):
    def travel_facts(self, f, parent_text):
        travel = f["category"] == "Travel"
        return (f["hotel"] if travel else None), (f["flight"] if travel else None)


class CabinAnywhere(Receipts):
    def cabin(self, low):
        return "other" if "premium economy" in low or R.has_word(low, ["business", "first class"]) else "economy"


def _solver(cls):
    def run(trigger, ctx):
        return cls(trigger, ctx).run()
    run.__name__ = cls.__name__
    return run


CONTROLS = {"null": null, "echo": echo, "naive": naive}
for _name, _cls in [("no-dedupe", NoDedupe), ("no-cap", NoCap), ("cap-all-meals", CapAllMeals),
                    ("cap-week-only", CapWeekOnly), ("any-corrector", AnyCorrector), ("any-approver", AnyApprover),
                    ("name-approver", NameApprover), ("contains-approved", ContainsApproved),
                    ("field-category", FieldCategory), ("digits-only", DigitsOnly), ("drinks-ok", DrinksOk),
                    ("slack-name", SlackName), ("no-preapproval", NoPreapproval), ("top-level-reply", TopLevelReply),
                    ("log-rejected", LogRejected), ("total-all-weeks", TotalAllWeeks),
                    ("no-receipt-rule", NoReceiptRule), ("domestic-only", DomesticOnly),
                    ("cabin-ignored", CabinIgnored), ("six-hours-ok", SixHoursOk),
                    ("correction-append", CorrectionAppend), ("unknown-logged", UnknownLogged),
                    ("date-posted", DatePosted), ("no-recheck", NoRecheck), ("no-pending-check", NoPendingCheck),
                    ("repost-rel-now", RepostRelNow), ("category-first", CategoryFirst),
                    ("cap-counts-rejected", CapCountsRejected), ("total-counts-rejected", TotalCountsRejected),
                    ("cap-counts-own-row", CapCountsOwnRow), ("latest-correction-only", LatestCorrectionOnly),
                    ("correction-receipt-day", CorrectionReceiptDay), ("preapproval-forgotten", PreapprovalForgotten),
                    ("preapproval-any-time", PreapprovalAnyTime), ("travel-facts-kept", TravelFactsKept),
                    ("cabin-anywhere", CabinAnywhere)]:
    CONTROLS[_name] = _solver(_cls)

assert handle  # the reference entry point stays importable beside the controls
