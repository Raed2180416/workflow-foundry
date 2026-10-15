"""abr-mkt-reviews bad controls (code, no model). Each must FAIL the family; together they show the oracle rejects a
do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null               does nothing at all
  echo               answers every email with its own subject and body, files a ticket named after it, and at the
                     close mails the payload back
  naive              the <= 40-line "ignore every note and rule" heuristic (RECURRING-DESIGN §3.11 gate 4): the
                     rating from the subject, 1-2 stars a ticket with the newest TRIAGE code seen in #app-reviews,
                     4-5 stars a thank-you, no notes, dates, crash rule, amendments or dedupe; the close counts every
                     ticket and every sent email of the day
  intern-policy      the reference under the superseded intern email: tickets for 1-3 stars, reviews of any date
  ignore-notes       the reference without the notes rules (bots, abuse, engineering, COMP accounts)
  subject-rating     the reference, but the rating is read from the subject line
  no-dedupe          the reference without "at most one ticket per reviewer per week"
  substring-dedupe   the reference, but the dedupe looks for the bare address anywhere in a subject (no ' - ' marks)
  rolling-week       the reference, but "this week" is the last 7 days instead of since Monday
  no-crash-rule      the reference without the high-priority (crash/freeze) rule
  substring-crash    the reference, but high priority is a substring test ("freezer" counts)
  old-dates          the reference, but older reviews are handled like today's
  any-sender-amend   the reference, but an amendment-shaped email from anyone changes the parameters
  stale-code         the reference, but the code is the one in the newest summary email (the intern's advice)
  count-all          the reference, but the daily count includes every ticket created today (other teams' too)
"""
from __future__ import annotations

import json
import re
from datetime import timedelta

from reference import (EMAIL, GMAIL, HUB, SLACK, STAR, THANKS, ReviewWorkflow, bare, norm, parse_dt, raw_email)

NAIVE_LINES = 0          # set below from the source of `naive`


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    data = trigger.get("data") or {}
    if trigger.get("app") == "gmail":
        msg = ctx.fetch_json("GET", GMAIL + f"messages/{data['message_id']}")
        ctx.fetch("POST", GMAIL + "messages/send", body={"raw": raw_email(bare(msg.get("from")), "Re: " + (msg.get("subject") or ""),
                                                                           msg.get("body_plain") or "")})
        ctx.fetch("POST", HUB + "tickets", body={"properties": {"subject": msg.get("subject") or "review",
                                                                 "content": msg.get("body_plain") or ""}})
    else:
        ctx.fetch("POST", GMAIL + "messages/send", body={"raw": raw_email("app-reviews@company.example.com",
                                                                           "Review triage summary", json.dumps(trigger))})


def naive(trigger, ctx):
    at = parse_dt(trigger["at"])
    hist = ctx.fetch_json("GET", SLACK + "conversations.history", params={"channel": "app-reviews"})["messages"]
    codes = [c for m in hist for c in re.findall(r"TRIAGE-[A-Za-z0-9-]+", m.get("text") or "")]
    code = codes[0] if codes else "TRIAGE"
    if trigger.get("event") == "daily_close":
        tickets = ctx.fetch_json("GET", HUB + "tickets")["results"]
        n = sum(1 for t in tickets if parse_dt(t["createdAt"]).date() == at.date())
        ids = ctx.fetch_json("GET", GMAIL + "messages", params={"q": "label:SENT", "maxResults": 500})["messages"]
        sent = [ctx.fetch_json("GET", GMAIL + f"messages/{m['id']}") for m in ids]
        m = sum(1 for x in sent if parse_dt(x["date"]).date() == at.date() and "thank" in (x.get("subject") or "").lower())
        body = f"{code}: tickets {n}, thank-yous {m}"
        return ctx.fetch("POST", GMAIL + "messages/send", body={"raw": raw_email(
            "app-reviews@company.example.com", f"Review triage summary {at.date().isoformat()}", body)})
    msg = ctx.fetch_json("GET", GMAIL + f"messages/{trigger['data']['message_id']}")
    stars = re.search(r"(\d) star", msg.get("subject") or "")
    who = EMAIL.search((msg.get("body_plain") or "").split("Reviewer:")[-1])
    if not stars or not who:
        return None
    n, who = int(stars.group(1)), who.group(0).lower()
    comment = re.search(r"Comment:\s*(.*)", msg.get("body_plain") or "")
    if n <= 2:
        ctx.fetch("POST", HUB + "tickets", body={"properties": {
            "subject": f"App review {n}{STAR} - {who} - {code}", "content": comment.group(1) if comment else ""}})
    elif n >= 4:
        ctx.fetch("POST", GMAIL + "messages/send", body={"raw": raw_email(who, THANKS, "Thank you for your review!")})


class InternPolicy(ReviewWorkflow):
    def params(self):
        return dict(super().params(), **{"Ticket ratings": "1-3"})

    def is_old(self, f):
        return False


class IgnoreNotes(ReviewWorkflow):
    def suppressed(self, notes):
        return False

    def emails_blocked(self, notes):
        return False


class SubjectRating(ReviewWorkflow):
    def rating(self, f, msg):
        m = re.search(r"(\d)\s*star", msg.get("subject") or "")
        return int(m.group(1)) if m else super().rating(f, msg)


class NoDedupe(ReviewWorkflow):
    def has_ticket(self, reviewer):
        return False


class SubstringDedupe(ReviewWorkflow):
    def has_ticket(self, reviewer):
        return any(reviewer.lower() in norm(t.get("subject")).lower() for t in self.week_tickets())


class RollingWeek(ReviewWorkflow):
    def __init__(self, trigger, ctx):
        super().__init__(trigger, ctx)
        self.monday = self.at - timedelta(days=7)


class NoCrashRule(ReviewWorkflow):
    def is_high(self, comment):
        return False


class SubstringCrash(ReviewWorkflow):
    def is_high(self, comment):
        c = (comment or "").lower()
        return any(w in c for w in ("crash", "freez", "froze"))


class OldDates(ReviewWorkflow):
    def is_old(self, f):
        return False


class AnySenderAmend(ReviewWorkflow):
    def is_amendment(self, msg):
        return norm(msg.get("subject")).lower().startswith("review policy amendment")


class StaleCode(ReviewWorkflow):
    def code(self):
        sent = self.messages("label:SENT subject:summary")
        sent = [m for m in sent if parse_dt(m.get("date")) < self.at]
        for m in sorted(sent, key=lambda m: parse_dt(m["date"]), reverse=True):
            g = re.search(r"TRIAGE-[A-Za-z0-9-]+", m.get("body_plain") or "")
            if g:
                return g.group(0).rstrip(":")
        return super().code()


class CountAll(ReviewWorkflow):
    def daily_counts(self, code):
        n, m = super().daily_counts(code)
        extra = sum(1 for t in self.week_tickets() if parse_dt(t["createdAt"]).date() == self.today
                    and code.lower() not in norm(t.get("subject")).lower())
        return n + extra, m


def _wrap(cls):
    def handle(trigger, ctx):
        return cls(trigger, ctx).run()
    handle.__name__ = cls.__name__
    return handle


CONTROLS = {
    "null": null,
    "echo": echo,
    "naive": naive,
    "intern-policy": _wrap(InternPolicy),
    "ignore-notes": _wrap(IgnoreNotes),
    "subject-rating": _wrap(SubjectRating),
    "no-dedupe": _wrap(NoDedupe),
    "substring-dedupe": _wrap(SubstringDedupe),
    "rolling-week": _wrap(RollingWeek),
    "no-crash-rule": _wrap(NoCrashRule),
    "substring-crash": _wrap(SubstringCrash),
    "old-dates": _wrap(OldDates),
    "any-sender-amend": _wrap(AnySenderAmend),
    "stale-code": _wrap(StaleCode),
    "count-all": _wrap(CountAll),
}


def _naive_lines() -> int:
    import inspect
    src = inspect.getsource(naive).splitlines()
    return sum(1 for x in src if x.strip() and not x.strip().startswith("#"))


NAIVE_LINES = _naive_lines()
