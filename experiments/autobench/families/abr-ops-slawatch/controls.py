"""abr-ops-slawatch bad controls (code, no model). Each must FAIL the family; together they show that the oracle rejects
a do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null            does nothing at all
  echo            posts every trigger back into #support-escalation and texts it to the first agent on the tracker
  naive           the <= 40-line "ignore every note and rule" heuristic (RECURRING-DESIGN §3.11 gate 4): at each check,
                  warn every row whose deadline (offset dropped) is within 2 hours and breach every row past its
                  deadline; no status, hold, dedupe, phone normalisation, tracker state or Policy Log
  eager           the reference, but a ticket event is handled at once (the check rules applied to the changed ticket):
                  warnings and SMS go out before the next hourly check
  no-hold         the reference without the LGL- legal hold
  utc-naive       the reference, but a deadline's UTC offset is dropped (the local clock is read as UTC)
  status-blind    the reference, but every row with a readable deadline is monitored, whatever its Status
  no-reassign     the reference without rule 3 (no SMS to the new agent after a reassignment)
  warn-once       the reference, but a ticket counts as warned once Warned At is filled, whatever the deadline
                  (an extended deadline is never warned)
  strict-window   the reference with strict inequalities: warn when deadline - now < window, breach when deadline < now
  slack-dedupe    the reference, but "already warned / breached" is read from #support-escalation by substring match
                  on the ticket id instead of from the tracker's state columns
  raw-phone       the reference, but the SMS goes to the phone exactly as written in the tracker
  any-amendment   the reference, but an amendment from anyone is applied
  fixed-window    the reference with the warning window fixed at 120 minutes (Policy Log and amendments ignored)
  late-warning    the reference, but a warning waits for the second check inside the window (one check late)
  early-warning   the reference, but a warning goes out one check before the window opens (one check early)
  memoryless      reads no state column (Warned At / Agent / Deadline, Breached At) and keeps no memory: it decides from
                  the clock alone. It warns when the deadline is inside the window now but was not at the previous
                  scheduled check, breaches when the deadline passed since the previous check, and has no rule 3. Every
                  timing rule that the clock decides it gets right; it is wrong exactly where the tracker's state
                  matters (reassignment, a hold cleared late or inside the window, work resumed inside the window, a
                  short extension, a reopen after the deadline, a window amendment between two checks, a ticket opened
                  already inside the window, a repeated escalation)
  no-escalate     the reference, but whatever it cannot decide (an unreadable phone, an out-of-range amendment from
                  the support manager) it silently skips instead of posting to #automation-review
"""
from __future__ import annotations

import inspect
import json
import re
from datetime import timedelta

import reference as ref
from reference import ESCALATION, MANAGER, SLACK, TWILIO, SMS_FROM, SlaWatch, Undecidable, parse_time, table, values_url, \
    TICKETS


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    text = json.dumps(trigger)[:500]
    ctx.fetch("POST", SLACK, body={"channel": ESCALATION, "text": text})
    rows = table(ctx.fetch_json("GET", values_url(TICKETS)))
    if rows:
        ctx.fetch("POST", TWILIO, body={"To": rows[0].get("Agent Phone", ""), "From": SMS_FROM, "Body": text[:150]})


def naive(trigger, ctx):
    if trigger.get("event") != "hourly_check":
        return None
    now = parse_time(trigger["at"])
    rows = table(ctx.fetch_json("GET", values_url(TICKETS)))
    for r in rows:
        m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", r.get("SLA Deadline", "").strip())
        if not m:
            continue
        D = parse_time(m.group(1) + "Z")
        tid = r.get("Ticket ID", "")
        if D <= now:
            ctx.fetch("POST", ref.JIRA, body={"fields": {"project": {"key": "SUPPORT"}, "summary": f"SLA breach {tid}"}})
            ctx.fetch("POST", SLACK, body={"channel": ESCALATION, "text": f"BREACHED {tid}"})
        elif (D - now).total_seconds() <= 7200:
            line = f"{tid} | {r.get('Subject')} | due {D:%H:%M} UTC | {r.get('Assigned Agent')}"
            ctx.fetch("POST", TWILIO, body={"To": r.get("Agent Phone"), "From": SMS_FROM,
                                            "Body": f"SLA warning {tid}: due {D:%H:%M} UTC"})
            ctx.fetch("POST", SLACK, body={"channel": ESCALATION, "text": line})
            ctx.fetch("POST", f"{ref.GMAIL}/messages/send", body={"to": MANAGER, "subject": f"SLA warning {tid}", "body": line})


NAIVE_LINES = len(inspect.getsourcelines(naive)[0])   # the gate's <= 40-line budget


class Eager(SlaWatch):
    def ticket_event(self):
        row = (self.t.get("data") or {}).get("row") or {}
        self.only = (row.get("Ticket ID") or "").strip()
        return self.hourly_check() if self.only else None

    def decide(self, row, W):
        if getattr(self, "only", None) and row.get("Ticket ID", "").strip() != self.only:
            return None
        return super().decide(row, W)


class NoHold(SlaWatch):
    def held(self, row):
        return False


class UtcNaive(SlaWatch):
    def deadline(self, row):
        m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)", row.get("SLA Deadline", "").strip())
        return parse_time(m.group(1) + "Z") if m else None


class StatusBlind(SlaWatch):
    def monitored(self, row):
        return self.deadline(row) is not None


class NoReassign(SlaWatch):
    def reassigned(self, row):
        return False


class WarnOnce(SlaWatch):
    def warned_for(self, row, D):
        return bool(row.get("Warned At", "").strip())


class StrictWindow(SlaWatch):
    def is_due(self, D):
        return D < self.now

    def in_window(self, D, W):
        return 0 < (D - self.now).total_seconds() < W * 60


class SlackDedupe(SlaWatch):
    def read_all(self):
        rows, cfg, policy = super().read_all()
        hist = self.ctx.fetch_json("GET", "https://slack.com/api/conversations.history", params={"channel": ESCALATION, "limit": 1000})
        self.texts = [str(m.get("text") or "") for m in hist.get("messages") or []]
        return rows, cfg, policy

    def warned_for(self, row, D):
        tid = row.get("Ticket ID", "").strip()
        return any(tid in t and "|" in t for t in self.texts)

    def breached(self, row):
        tid = row.get("Ticket ID", "").strip()
        return any(f"BREACHED {tid}" in t for t in self.texts)


class RawPhone(SlaWatch):
    def phone(self, row):
        return row.get("Agent Phone", "").strip() or None


class AnyAmendment(SlaWatch):
    def authorized(self, sender):
        return True


class FixedWindow(SlaWatch):
    def window(self, policy):
        return 120


class LateWarning(SlaWatch):
    def in_window(self, D, W):
        return 0 < (D - self.now).total_seconds() <= (W - 60) * 60


class EarlyWarning(SlaWatch):
    def in_window(self, D, W):
        return 0 < (D - self.now).total_seconds() <= (W + 60) * 60


def prev_check(now):
    """The scheduled check before `now` (hourly 10:00-17:00 UTC, Monday to Friday; POLICY.md section 1)."""
    t = now - timedelta(hours=1)
    while not (t.weekday() < 5 and 10 <= t.hour <= 17):
        t -= timedelta(hours=1)
    return t


class Memoryless(SlaWatch):
    def decide(self, row, W):
        if not self.monitored(row) or self.held(row):
            return None
        D = self.deadline(row)
        if D is None:
            raise Undecidable(f"{row.get('Ticket ID')}: SLA Deadline {row.get('SLA Deadline')!r} cannot be read")
        p = prev_check(self.now)
        if self.is_due(D):
            return "breach" if D > p else None
        if self.in_window(D, W) and not (timedelta(0) < D - p <= timedelta(minutes=W)):
            return "warn"
        return None


class NoEscalate(SlaWatch):
    def escalate(self, reason):
        return None

    def flush(self):
        self.escalations = []
        super().flush()


def _wrap(cls):
    def run(trigger, ctx):
        cls(trigger, ctx).run()
    run.__name__ = cls.__name__
    return run


CONTROLS = {
    "null": null,
    "echo": echo,
    "naive": naive,
    "eager": _wrap(Eager),
    "no-hold": _wrap(NoHold),
    "utc-naive": _wrap(UtcNaive),
    "status-blind": _wrap(StatusBlind),
    "no-reassign": _wrap(NoReassign),
    "warn-once": _wrap(WarnOnce),
    "strict-window": _wrap(StrictWindow),
    "slack-dedupe": _wrap(SlackDedupe),
    "raw-phone": _wrap(RawPhone),
    "any-amendment": _wrap(AnyAmendment),
    "fixed-window": _wrap(FixedWindow),
    "late-warning": _wrap(LateWarning),
    "early-warning": _wrap(EarlyWarning),
    "memoryless": _wrap(Memoryless),
    "no-escalate": _wrap(NoEscalate),
}
