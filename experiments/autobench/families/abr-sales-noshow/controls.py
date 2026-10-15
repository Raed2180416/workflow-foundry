"""abr-sales-noshow bad controls (code, no model). Each must FAIL the family; together they show the oracle rejects a
do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null                 does nothing at all
  echo                 repeats every trigger back into #sales-alerts (and creates a task named after the message)
  naive                the <= 40-line "ignore every note and rule" heuristic (RECURRING-DESIGN §3.11 gate 4): any
                       message naming an outside email is a no-show of that person's latest event, the old $100,000
                       rule, all opportunities summed, no repeat or duplicate check, retractions ignored
  stale-threshold      the reference with the superseded Slack procedure: High only at $100,000 of pipeline
  no-repeat            the reference without the 14-day repeat no-show rule
  latest-event         the reference, but the meeting is the invitee's latest event that started before the report,
                       whatever its status or day
  all-opps             the reference, but closed opportunities count toward the pipeline and the threshold
  chatter-as-report    the reference, but every message naming an outside email is treated as a no-show report
  no-dedupe            the reference, but a second report of an already-marked no-show creates a second task
"""
from __future__ import annotations

import json
import re

import reference as ref
from reference import CAL, EMAIL, PREFIX, SF, SLACK, NoShowWorkflow, parse_dt, scheduled, soql


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    text = (trigger.get("data") or {}).get("text") or json.dumps(trigger)
    ctx.fetch("POST", SLACK + "chat.postMessage", body={"channel": "sales-alerts", "text": text})
    if trigger.get("app") == "slack":
        ctx.fetch("POST", SF + "sobjects/Task", body={"Subject": PREFIX + text[:60], "Description": text})


def naive(trigger, ctx):
    if trigger.get("event") == "week_close":
        tasks = soql(ctx, "SELECT Id, Subject FROM Task")
        n = sum(1 for t in tasks if (t.get("Subject") or "").startswith(PREFIX))
        return ctx.fetch("POST", SLACK + "chat.postMessage", body={"channel": "sales-alerts", "text": f"No-shows this week: {n}"})
    emails = [e.lower().rstrip(".") for e in EMAIL.findall((trigger.get("data") or {}).get("text") or "")]
    if not emails:
        return None
    email, at = emails[0], parse_dt(trigger["at"])
    events = ctx.fetch_json("GET", CAL + "scheduled_events", params={"invitee_email": email})["collection"]
    past = sorted((e for e in events if e.get("start_time") and parse_dt(e["start_time"]) <= at),
                  key=lambda e: parse_dt(e["start_time"]))
    if not past:
        return None
    ev = past[-1]
    uuid = ev["uri"].rstrip("/").split("/")[-1]
    invs = ctx.fetch_json("GET", CAL + f"scheduled_events/{uuid}/invitees", params={"email": email})["collection"]
    if invs:
        ctx.fetch("POST", CAL + "invitee_no_shows", body={"invitee": invs[0]["uri"]})
    contacts = soql(ctx, f"SELECT Id, AccountId FROM Contact WHERE Email = '{email}'")
    if not contacts:
        return None
    opps = soql(ctx, f"SELECT Amount FROM Opportunity WHERE AccountId = '{contacts[0]['AccountId']}'")
    total = int(sum(float(o.get("Amount") or 0) for o in opps))
    ctx.fetch("POST", SF + "sobjects/Task", body={
        "Subject": PREFIX + ev["name"], "Status": "Not Started", "Priority": "High" if total >= 100_000 else "Normal",
        "WhoId": contacts[0]["Id"],
        "Description": f"{scheduled(parse_dt(ev['start_time']))} | Account pipeline: ${total:,}"})


class StaleThreshold(NoShowWorkflow):
    def pipeline(self, account_id):
        total, _ = super().pipeline(account_id)
        return total, total >= 100_000


class NoRepeat(NoShowWorkflow):
    def is_repeat(self, email, ev, events, contact_id):
        return False


class LatestEvent(NoShowWorkflow):
    def find_meeting(self, email, events):
        past = sorted((e for e in events if e.get("start_time") and parse_dt(e["start_time"]) <= self.at),
                      key=lambda e: parse_dt(e["start_time"]))
        if not past:
            return []
        return [(past[-1], i) for i in self.invitees(past[-1], email)][:1]


class AllOpps(NoShowWorkflow):
    def pipeline(self, account_id):
        opps = soql(self.ctx, f"SELECT Id, Amount, StageName FROM Opportunity WHERE AccountId = '{account_id}'")
        amounts = [float(o.get("Amount") or 0) for o in opps]
        return int(round(sum(amounts))), any(a >= ref.THRESHOLD for a in amounts)


class ChatterAsReport(NoShowWorkflow):
    def classify(self, text):
        emails = [e for e in EMAIL.findall(text) if not e.lower().endswith("@" + ref.INTERNAL_DOMAIN)]
        if emails:
            return "report"
        return super().classify(text)


class NoDedupe(NoShowWorkflow):
    def report(self, text):
        email = sorted({e.lower().rstrip(".") for e in EMAIL.findall(text)})
        if len(email) == 1 and not email[0].endswith("@" + ref.INTERNAL_DOMAIN):
            events = self.ctx.fetch_json("GET", CAL + "scheduled_events", params={"invitee_email": email[0]})["collection"]
            pairs = self.find_meeting(email[0], events)
            if len(pairs) == 1 and pairs[0][1].get("no_show"):
                pairs[0][1]["no_show"] = None      # forget the mark: handle the report as new
                return self._handle_again(email[0], events, pairs[0])
        return super().report(text)

    def _handle_again(self, email, events, pair):
        ev, _ = pair
        contacts = soql(self.ctx, f"SELECT Id, AccountId FROM Contact WHERE Email = '{email}'")
        if len(contacts) != 1:
            return None
        pipeline, big = self.pipeline(contacts[0].get("AccountId"))
        repeat = self.is_repeat(email, ev, events, contacts[0]["Id"])
        desc = f"{scheduled(parse_dt(ev['start_time']))} | Account pipeline: ${pipeline:,}" + (" | Repeat no-show" if repeat else "")
        self.ctx.fetch("POST", SF + "sobjects/Task", body={"Subject": PREFIX + ev["name"], "Status": "Not Started",
                                                          "Priority": self.priority(big, repeat),
                                                          "WhoId": contacts[0]["Id"], "Description": desc})


def _wrap(cls):
    return lambda trigger, ctx: cls(trigger, ctx).run()


CONTROLS = {
    "null": null,
    "echo": echo,
    "naive": naive,
    "stale-threshold": _wrap(StaleThreshold),
    "no-repeat": _wrap(NoRepeat),
    "latest-event": _wrap(LatestEvent),
    "all-opps": _wrap(AllOpps),
    "chatter-as-report": _wrap(ChatterAsReport),
    "no-dedupe": _wrap(NoDedupe),
}

NAIVE_LINES = len(re.findall(r"\n", __import__("inspect").getsource(naive)))
