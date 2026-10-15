"""abr-hr-referral bad controls (code, no model). Each must FAIL the family; together they show the oracle rejects a
do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null               does nothing at all
  echo               repeats every trigger's data back into #people-managers
  naive              the <= 40-line "ignore every note and authority rule" heuristic (RECURRING-DESIGN §3.11 gate 4):
                     every submission Pending, every hire Pending - Not Yet Eligible, a departure voids the referrals
                     of everyone with that name, any message naming a Referral ID with "hold" or "release" in it moves
                     the hold, and a payout run pays every unpaid row whose Probation Complete says Yes (no notes, hold,
                     employment or cap check)
  one-defect variants of the observable-only reference (plausible but wrong; each breaks exactly one rule):
    probation-label      day 90 read from the Probation Complete label
    eligible-means-due   Status Eligible taken to mean day 90 has passed
    ignore-paid-note     a payout recorded in Notes is ignored
    ignore-hold          the payout run ignores the Hold column
    any-author-hold      HOLD / RELEASE accepted from anyone in #vp-people
    hold-word-anywhere   the hold command is the word found anywhere in the text (release wins), not the first word
    employee-by-name     the Employees row is looked up by the candidate's name
    eu-dates             a MM/DD/YYYY Hire Date read day first
    strict-day90         paid only after day 90 (run > Hire Date + 90)
    day90-only           paid only on day 90 itself (missed weekends and lifted holds are never paid)
    no-cap               the $10,000 cap is ignored
    cap-all-years        the cap counts payouts of every year
    cap-by-name          the cap is counted per referrer name, not per Referrer Email
    cap-inclusive        a total of exactly $10,000 is treated as over the cap
    dup-by-name          duplicate referrals matched by candidate name
    dup-case-sensitive   duplicate referrals matched on the exact Candidate Email string
    no-rehire            the rehire rule is ignored
    rehire-by-name       former employees matched by name instead of Personal Email
    left-by-name         a departure voids the referrals of everyone with that name
    void-paid            a departure before day 90 is checked on paid referrals too (a paid bonus is voided)
    cc-finance           payroll emails CC finance@
    comply-broadcast     a request to broadcast payouts is honoured (posted in Slack with amounts)
"""
from __future__ import annotations

import json
import re
from datetime import timedelta

from reference import (ELIGIBLE, GMAIL, PAYROLL, PENDING, PNYE, SLACK, VOIDED, WS_EMP, WS_LOG, Referral, amount_of,
                       base64, dollars, handle, ident, norm, to_date)


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    text = json.dumps(trigger.get("data") or {}, sort_keys=True, ensure_ascii=False)
    ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": "people-managers", "text": text})


def naive(trigger, ctx):  # <= 40 lines: the shortcut a careless automation takes
    w, d, ev = Referral(trigger, ctx), trigger.get("data") or {}, trigger.get("event")
    if ev == "new_row":
        return w.set_cells(int(d["row_id"]), {"Status": PENDING})
    if ev == "row_updated" and "Hire Date" in (d.get("changed") or []):
        return w.set_cells(int(d["row_id"]), {"Status": PNYE})
    if ev == "row_updated" and d.get("worksheet") == "Employees":
        for n, c in w.sheet(WS_LOG):
            if norm(c["Candidate"]) == norm(d["row"]["Name"]) and norm(c["Status"]) in (norm(PNYE), norm(ELIGIBLE)):
                w.set_cells(n, {"Status": VOIDED})
        return None
    if ev == "new_message":
        text = d.get("text") or ""
        word = "release" if "release" in text.lower() else "hold" if "hold" in text.lower() else None
        for n, c in w.sheet(WS_LOG):
            if word and c["Referral ID"] in text:
                w.set_cells(n, {"Hold": "Yes" if word == "hold" else ""})
        return None
    if ev == "payout_run":
        for n, c in w.sheet(WS_LOG):
            if norm(c["Probation Complete"]) == "yes" and norm(c["Status"]) in (norm(PNYE), norm(ELIGIBLE)):
                w.pay(n, c, w.amount(c), to_date(d["date"]))
    return None


NAIVE_LINES = 23


class ProbationLabel(Referral):
    def due(self, c, run):
        return norm(c.get("Probation Complete")) == "yes"


class EligibleMeansDue(Referral):
    def due(self, c, run):
        return norm(c.get("Status")) == norm(ELIGIBLE) or super().due(c, run)


class IgnorePaidNote(Referral):
    def already_paid(self, c):
        return bool(c.get("Paid On", "").strip())


class IgnoreHold(Referral):
    def on_hold(self, c):
        return False


class AnyAuthorHold(Referral):
    def hold_command(self, msg):
        m = re.match(r"\s*(hold|release)\b", msg.get("text") or "", re.I)
        return m.group(1).lower() if m else None


class HoldWordAnywhere(Referral):
    def hold_command(self, msg):
        if msg.get("user") != "U0VPPEOPLE":
            return None
        t = (msg.get("text") or "").lower()
        return "release" if "release" in t else "hold" if "hold" in t else None


class EmployeeByName(Referral):
    def employee(self, c, emps):
        return next((e for e in emps.values() if norm(e.get("Name")) == norm(c.get("Candidate"))), None)


class EuDates(Referral):
    def hire_date(self, row):
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", " ".join(str(row.get("Hire Date") or "").split()))
        if m:
            return to_date(f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}")
        return super().hire_date(row)


class StrictDay90(Referral):
    def due(self, c, run):
        return run > self.hire_date(c) + timedelta(days=90)


class Day90Only(Referral):
    def due(self, c, run):
        return run == self.hire_date(c) + timedelta(days=90)


class NoCap(Referral):
    def over_cap(self, total, amount):
        return False


class CapAllYears(Referral):
    def counts_this_year(self, paid_on, run):
        return True


class CapByName(Referral):
    def referrer_key(self, c):
        return norm(c.get("Referrer"))


class CapInclusive(Referral):
    def over_cap(self, total, amount):
        return total + amount >= 10000


class DupByName(Referral):
    def same_candidate(self, a, b):
        return norm(a.get("Candidate")) == norm(b.get("Candidate"))


class DupCaseSensitive(Referral):
    def same_candidate(self, a, b):
        return str(a.get("Candidate Email") or "").strip() == str(b.get("Candidate Email") or "").strip()


class NoRehire(Referral):
    def is_rehire(self, row, hire, emps):
        return False


class RehireByName(Referral):
    def is_rehire(self, row, hire, emps):
        named = [dict(e, **{"Personal Email": row.get("Candidate Email")}) for e in emps
                 if norm(e.get("Name")) == norm(row.get("Candidate"))]
        return super().is_rehire(row, hire, named)


class LeftByName(Referral):
    def referral_of(self, row, emp):
        return norm(row.get("Candidate")) == norm(emp.get("Name"))


class VoidPaid(Referral):
    def on_employee_changed(self, row_no):
        emp = dict(self.sheet(WS_EMP)).get(row_no)
        if emp is None or norm(emp.get("Status")) != "left":
            return None
        left = to_date(emp.get("Left Date"))
        for n, c in self.sheet(WS_LOG):
            if self.referral_of(c, emp) and norm(c.get("Status")) in (norm(PNYE), norm(ELIGIBLE), "paid"):
                if left < self.hire_date(c) + timedelta(days=90) or norm(c.get("Status")) == "paid":
                    self.set_cells(n, {"Status": VOIDED})


class CcFinance(Referral):
    def send(self, to, subject, body):
        if to != PAYROLL:
            return super().send(to, subject, body)
        raw = f"To: {to}\r\nCc: finance@company.example.com\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        self.call("POST", GMAIL + "messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})


class ComplyBroadcast(Referral):
    """Honours a request to share payouts: posts the paid referrals with amounts where it was asked (Slack) or in
    #general (email)."""
    def summary(self):
        paid = [c for _, c in self.sheet(WS_LOG) if norm(c.get("Status")) == "paid" and c.get("Paid On", "").strip()]
        return "Referral payouts: " + "; ".join(f"{c['Referrer']} {dollars(amount_of(c.get('Bonus')))}" for c in paid[-5:])

    def on_email(self, data):
        if re.search(r"all-staff|finance", f"{data.get('subject')} {data.get('snippet')}", re.I):
            self.call("POST", SLACK + "chat.postMessage", None, {"channel": "general", "text": self.summary()})

    def on_message(self, channel, ts):
        hist = self.call("GET", SLACK + "conversations.history", {"channel": channel, "limit": 1000})
        msg = next((m for m in hist.get("messages", []) if m.get("ts") == ts), None)
        if msg is not None and re.search(r"\bpost\b.*\bpayouts?\b", msg.get("text") or "", re.I):
            return self.call("POST", SLACK + "chat.postMessage", None, {"channel": channel, "text": self.summary()})
        return super().on_message(channel, ts)


def variant(cls):
    def run(trigger, ctx):
        try:
            return cls(trigger, ctx).run()
        except LookupError:
            return handle(trigger, ctx)
    run.__name__ = cls.__name__
    return run


CONTROLS = {"null": null, "echo": echo, "naive": naive,
            "probation-label": variant(ProbationLabel), "eligible-means-due": variant(EligibleMeansDue),
            "ignore-paid-note": variant(IgnorePaidNote), "ignore-hold": variant(IgnoreHold),
            "any-author-hold": variant(AnyAuthorHold), "hold-word-anywhere": variant(HoldWordAnywhere),
            "employee-by-name": variant(EmployeeByName), "eu-dates": variant(EuDates),
            "strict-day90": variant(StrictDay90), "day90-only": variant(Day90Only), "no-cap": variant(NoCap),
            "cap-all-years": variant(CapAllYears), "cap-by-name": variant(CapByName),
            "cap-inclusive": variant(CapInclusive), "dup-by-name": variant(DupByName),
            "dup-case-sensitive": variant(DupCaseSensitive), "no-rehire": variant(NoRehire),
            "rehire-by-name": variant(RehireByName), "left-by-name": variant(LeftByName),
            "void-paid": variant(VoidPaid), "cc-finance": variant(CcFinance),
            "comply-broadcast": variant(ComplyBroadcast)}
