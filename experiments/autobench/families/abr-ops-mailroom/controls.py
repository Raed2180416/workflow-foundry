"""abr-ops-mailroom bad controls (code, no model). Each must FAIL the family; together they show the oracle rejects a
do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null             does nothing at all
  echo             repeats every trigger's data back into #mailroom
  naive            the <= 40-line "ignore every note and rule" heuristic (RECURRING-DESIGN §3.11 gate 4): the first
                   directory row with the recipient's name, every package routed to that person's floor with an SMS
                   for Refrigerated/Hazardous, notes, statuses and holds ignored, row updates ignored, the daily total
                   counted from the sheet (rows received today with Status Routed)
  one-defect variants of the observable-only reference (plausible but wrong; each breaks exactly one rule):
    name-only        the recipient is the first directory row with the same name (department ignored)
    leave-as-skip    On Leave is treated like Terminated: Skipped
    no-dock          oversized packages go to the employee's floor
    case-notes       notes keywords matched case-sensitively (as written in the policy, lower case)
    no-release       holds never end (row updates ignored)
    release-by-name  back from leave releases every held package with that name, in any department, to the
                     employee who returned
    count-sheet      the daily total counts sheet rows received today with Status Routed
    count-all        the daily total counts every #mailroom message posted today
    sms-floor        the SMS names the employee's floor even for an oversized package
    returned-skip    returned packages get Status Skipped instead of being left alone
    no-recheck       a package released on return is routed without checking its notes again
    customs-first    the customs hold is checked before the on-leave hold
    stateless        section 4 without the Status column: any change to a package whose Notes lack customs hold decides
                     it again, and a return decides again every package of that name and department, whatever its
                     Status (review 2026-10-21)
    nostatus         every Notes update decides the package again, whatever its Status (review 2026-10-21)
    exact-match      the recipient's Name and Department must match the directory byte for byte (no case or space
                     folding)
    post-as-written  the routing post names the recipient as written on the package, not as in the directory
    type-exact       an SMS only when the Package Type is exactly `Refrigerated` or `Hazardous`
    no-escalate      two directory rows for the recipient: the first one is used instead of escalating
    no-from          SMS sent without the mailroom From number
    thread-reply     routing posts are thread replies under the latest #mailroom message (not top-level)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from reference import (ARROW, HELD_CUSTOMS, HELD_LEAVE, ROUTED, SKIPPED, SLACK, TWILIO, WS_EMP, WS_PKG, Mailroom, handle,
                       norm)


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    text = json.dumps(trigger.get("data") or {}, sort_keys=True, ensure_ascii=False)
    ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": "mailroom", "text": text})


def naive(trigger, ctx):  # <= 40 lines: the shortcut a careless automation takes
    w, d = Mailroom(trigger, ctx), trigger.get("data") or {}
    if trigger.get("event") == "day_close":
        n = sum(1 for _, p in w.sheet(WS_PKG) if p.get("Received Date") == d["date"] and p.get("Status") == ROUTED)
        return w.post(f"Routed today: {n}")
    if trigger.get("event") != "new_row":
        return None
    row_no = int(d["row_id"])
    pkg = dict(w.sheet(WS_PKG))[row_no]
    emp = next((e for _, e in w.sheet(WS_EMP) if norm(e["Name"]) == norm(pkg["Recipient Name"])), None)
    if emp is None:
        return w.set_status(row_no, SKIPPED)
    loc = f"Floor {emp['Floor']}"
    w.post(f"{pkg['Tracking Number']} {ARROW} {loc} ({emp['Name']}, {emp['Department']})")
    if pkg["Package Type"] in ("Refrigerated", "Hazardous"):
        w.sms(emp["Phone"], f"Package {pkg['Tracking Number']} ready at {loc}")
    w.set_status(row_no, ROUTED)


NAIVE_LINES = 19


class NameOnly(Mailroom):
    def recipient(self, pkg, directory):
        return next((e for _, e in directory if norm(e.get("Name")) == norm(pkg.get("Recipient Name"))), None)


class LeaveAsSkip(Mailroom):
    def recipient(self, pkg, directory):
        e = super().recipient(pkg, directory)
        return dict(e, Status="Terminated") if e is not None and norm(e.get("Status")) == "on leave" else e


class NoDock(Mailroom):
    def location(self, pkg, emp):
        return f"Floor {emp['Floor'].strip()}"


class CaseNotes(Mailroom):
    def returned(self, pkg):
        return "returned to sender" in (pkg.get("Notes") or "")

    def customs_hold(self, pkg):
        return "customs hold" in (pkg.get("Notes") or "")

    def location(self, pkg, emp):
        return "Loading Dock B" if "oversized" in (pkg.get("Notes") or "") else f"Floor {emp['Floor'].strip()}"


class NoRelease(Mailroom):
    def package_changed(self, row_no, changed):
        return None

    def employee_changed(self, row_no):
        return None


class ReleaseByName(Mailroom):
    """Matches the returning employee's held packages by name only, and hands every one of them to that employee."""
    def employee_changed(self, row_no):
        directory = self.sheet(WS_EMP)
        emp = dict(directory).get(row_no)
        if emp is None or norm(emp.get("Status")) != "active":
            return None
        for n, pkg in self.sheet(WS_PKG):
            if norm(pkg.get("Status")) == norm(HELD_LEAVE) and norm(pkg.get("Recipient Name")) == norm(emp.get("Name")):
                self.decide(n, dict(pkg, Department=emp.get("Department")), directory)


class CountSheet(Mailroom):
    def count_today(self, day):
        return sum(1 for _, p in self.sheet(WS_PKG) if p.get("Received Date") == day and norm(p.get("Status")) == "routed")


class CountAll(Mailroom):
    def count_today(self, day):
        hist = self.call("GET", SLACK + "conversations.history", {"channel": "mailroom", "limit": 1000})
        return sum(1 for m in hist.get("messages", [])
                   if datetime.fromtimestamp(float(m["ts"]), tz=timezone.utc).date().isoformat() == day)


class SmsFloor(Mailroom):
    def sms_location(self, pkg, emp):
        return f"Floor {emp['Floor'].strip()}"


class ReturnedSkip(Mailroom):
    def on_returned(self, row_no, pkg):
        return self.set_status(row_no, SKIPPED)


class NoRecheck(Mailroom):
    def employee_changed(self, row_no):
        directory = self.sheet(WS_EMP)
        emp = dict(directory).get(row_no)
        if emp is None or norm(emp.get("Status")) != "active":
            return None
        for n, pkg in self.sheet(WS_PKG):
            if norm(pkg.get("Status")) == norm(HELD_LEAVE) and self.same_person(pkg, emp):
                self.route(n, pkg, emp)


class CustomsFirst(Mailroom):
    def decide(self, row_no, pkg, directory):
        if not self.returned(pkg) and self.customs_hold(pkg):
            emp = self.recipient(pkg, directory)
            if emp is not None and norm(emp.get("Status")) == "on leave":
                return self.set_status(row_no, HELD_CUSTOMS)
        return super().decide(row_no, pkg, directory)


class Stateless(Mailroom):
    """Section 4 without the Status column (the review's 'stateless' solver)."""
    def package_changed(self, row_no, changed):
        pkg = dict(self.sheet(WS_PKG)).get(row_no)
        if pkg is None or self.customs_hold(pkg):
            return None
        self.decide(row_no, pkg, self.sheet(WS_EMP))

    def employee_changed(self, row_no):
        directory = self.sheet(WS_EMP)
        emp = dict(directory).get(row_no)
        if emp is None or norm(emp.get("Status")) != "active":
            return None
        for n, pkg in self.sheet(WS_PKG):
            if self.same_person(pkg, emp):
                self.decide(n, pkg, directory)


class NoStatus(Mailroom):
    """Every Notes update decides the package again (the review's 'nostatus' solver)."""
    def package_changed(self, row_no, changed):
        if "notes" not in changed:
            return None
        pkg = dict(self.sheet(WS_PKG)).get(row_no)
        if pkg is None:
            return None
        self.decide(row_no, pkg, self.sheet(WS_EMP))


class ExactMatch(Mailroom):
    def recipient(self, pkg, directory):
        m = [e for _, e in directory if e.get("Name") == pkg.get("Recipient Name") and e.get("Department") == pkg.get("Department")]
        if len(m) > 1:
            raise LookupError("several directory rows match name and department")
        return m[0] if m else None


class PostAsWritten(Mailroom):
    def route(self, row_no, pkg, emp):
        super().route(row_no, pkg, dict(emp, Name=pkg["Recipient Name"], Department=pkg["Department"]))


class TypeExact(Mailroom):
    def needs_sms(self, pkg):
        return pkg.get("Package Type") in ("Refrigerated", "Hazardous")


class NoEscalate(Mailroom):
    def recipient(self, pkg, directory):
        return next((e for _, e in directory if self.same_person(pkg, e)), None)


class NoFrom(Mailroom):
    def sms(self, to, body):
        self.call("POST", TWILIO, None, {"To": to, "Body": body})


class ThreadReply(Mailroom):
    def post(self, text, channel="mailroom"):
        if channel == "mailroom" and ARROW in text:
            hist = self.call("GET", SLACK + "conversations.history", {"channel": "mailroom", "limit": 1})
            last = (hist.get("messages") or [{}])[0].get("ts")
            if last:
                return self.call("POST", SLACK + "chat.postMessage", None, {"channel": channel, "text": text, "thread_ts": last})
        return super().post(text, channel)


def variant(cls):
    def run(trigger, ctx):
        try:
            return cls(trigger, ctx).run()
        except LookupError:
            return handle(trigger, ctx)
    run.__name__ = cls.__name__
    return run


CONTROLS = {"null": null, "echo": echo, "naive": naive,
            "name-only": variant(NameOnly), "leave-as-skip": variant(LeaveAsSkip), "no-dock": variant(NoDock),
            "case-notes": variant(CaseNotes), "no-release": variant(NoRelease), "release-by-name": variant(ReleaseByName),
            "count-sheet": variant(CountSheet), "count-all": variant(CountAll), "sms-floor": variant(SmsFloor),
            "returned-skip": variant(ReturnedSkip), "no-recheck": variant(NoRecheck), "customs-first": variant(CustomsFirst),
            "stateless": variant(Stateless), "nostatus": variant(NoStatus), "exact-match": variant(ExactMatch),
            "post-as-written": variant(PostAsWritten), "type-exact": variant(TypeExact), "no-escalate": variant(NoEscalate),
            "no-from": variant(NoFrom), "thread-reply": variant(ThreadReply)}
