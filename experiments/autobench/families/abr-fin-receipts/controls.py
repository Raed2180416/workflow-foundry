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
    def cap_other(self, rows, name, d, exclude_ts):
        s = Decimal("0")
        for _, c in rows:
            if (norm(c.get("Employee")) == norm(name) and norm(c.get("Category")) == "meals" and c.get("Date") == d.isoformat()
                    and c.get("Message TS") != (exclude_ts or "")):
                s += Decimal(c["Amount"])
        return s

    def individual(self, f):
        return f["category"] == "Meals"

    def meal_rule(self, f, cap_other):
        why = super().meal_rule(dict(f, attendees=f["attendees"] if f["attendees"] != 1 else None), Decimal("0"))
        if why:
            return why
        return "Over daily meal cap" if cap_other + f["amount"] > 100 else None


class CapWeekOnly(Receipts):
    def cap_other(self, rows, name, d, exclude_ts):
        start = self.t["at"][:10]
        from datetime import date as _d, timedelta as _td
        monday = (_d.fromisoformat(start) - _td(days=_d.fromisoformat(start).weekday())).isoformat()
        return super().cap_other([(n, c) for n, c in rows if c.get("Submitted", "") >= monday], name, d, exclude_ts)


class AnyCorrector(Receipts):
    def correction(self, d, parent):
        return super().correction(dict(d, user=parent.get("user")), dict(parent, _any=True))

    def apply_correction(self, f, text, attachments, posted):
        return super().apply_correction(f, text, attachments, posted)

    def thread_reply(self, d):
        text = (d.get("text") or "").strip()
        parent = self.parent(d["thread_ts"])
        if parent is not None and re.match(r"correction\b", text, re.I) and d["user"] != parent.get("user"):
            # apply this reply as if the poster had written it
            orig = self.replies

            def replies(ts):
                out = orig(ts)
                return [dict(m, user=parent.get("user")) if m["ts"] == d["ts"] else m for m in out]
            self.replies = replies
            return Receipts.correction(self, dict(d, user=parent.get("user")), parent)
        return super().thread_reply(d)


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
    def read(self, text, attachments, posted):
        if R.words_money(text) is not None and not re.search(r"\$\s?\d|\d\s*USD|USD\s*\d", text):
            return None
        return super().read(text, attachments, posted)

    def top_level(self, d):
        if self.read(d.get("text") or "", [], ts_date(d["ts"])) is None:
            return None
        return super().top_level(d)


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
    def top_level(self, d):
        text = d.get("text") or ""
        f = None
        if parse_amount(text) is not None and self.poster(d["user"]) is not None:
            f = self.read(text, d.get("attachments") or [], ts_date(d["ts"]))
        if f is not None and not self.is_repost(d, f):
            rows = self.sheet(SUBMISSIONS)
            emp = self.poster(d["user"])
            other = self.cap_other(rows, emp["Employee"], f["date"], None) if self.individual(f) else Decimal("0")
            status, reason = self.check(f, other)
            if status is None:
                self.append_row(self.row_for(d["ts"], ts_date(d["ts"]).isoformat(), emp["Employee"], f, R.REJECTED))
                return self.post(self.outcome_text(None, reason, f["amount"], f["category"]), thread_ts=d["ts"])
        return super().top_level(d)


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
    def update_row(self, row_no, cells):
        if self.t.get("data", {}).get("thread_ts") and re.match(r"correction\b", (self.t["data"].get("text") or "").strip(), re.I):
            return self.append_row(cells)
        return super().update_row(row_no, cells)


class UnknownLogged(Receipts):
    def poster(self, user_id):
        emp = super().poster(user_id)
        if emp is not None:
            return emp
        out = self.ctx.fetch_json("GET", SLACK + "users.info", {"user": user_id})
        return {"Employee": out["user"]["real_name"], "Email": "", "Manager Email": ""}


class DatePosted(Receipts):
    def read(self, text, attachments, posted):
        f = super().read(text, attachments, posted)
        if f is not None:
            f["date"] = posted
        return f


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
                    ("date-posted", DatePosted)]:
    CONTROLS[_name] = _solver(_cls)

assert handle  # the reference entry point stays importable beside the controls
