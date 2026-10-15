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
"""
from __future__ import annotations

import inspect
import json
import re

import reference as ref
from reference import ESCALATION, MANAGER, SLACK, TWILIO, SMS_FROM, SlaWatch, parse_time, table, values_url, TICKETS


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
}
