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
  no-amendments      the reference, but Product's amendments are neither acknowledged nor applied
  stale-code         the reference, but the code is the one in the newest summary email (the intern's advice)
  count-all          the reference, but the daily count includes every ticket created today (other teams' too)

Added 2026-10-21 (one rule each; the first seven passed every dev week before the d3 clause floor and the balanced
amendment parameter, see README "Changes"):
  no-abuse             the abuse note is ignored (only `Bot Suspected` suppresses)
  no-bot               the `Bot Suspected` note is ignored (only abuse suppresses)
  crash-rating-only    crash words only prefix tickets the rating earns: no ticket for a crash at a 3-5 star rating
  crash-thanks         high priority does not block the thank-you
  eng-email            the Engineering note does not block emails
  comp-email           the COMP / non-solicitation note does not block emails
  ticket-amend-ignored Product's `Ticket ratings` amendments are acknowledged but not applied
  eng-no-ticket        the Engineering note also blocks the ticket (the upstream task's reading)
  comp-no-ticket       the COMP note also blocks the ticket
  base-forms           only `crash` and `freeze` count, not the other listed forms
  no-escalate          a notification without a usable rating or reviewer is skipped instead of escalated
  oldest-amendment     the oldest Product amendment per parameter wins instead of the newest
  thanks-amend-ignored Product's `Thank-you ratings` amendments are acknowledged but not applied
  week-count           the daily summary counts this week's tickets and thank-yous instead of today's
  reply-requester      the policy is applied, but unauthorized requesters get a polite reply
  any-poster-code      the code is the newest TRIAGE code in #app-reviews, whoever posted it
  updated-ignored      updated reviews are skipped as already handled
"""
from __future__ import annotations

import json
import re
from datetime import timedelta

from reference import (DEFAULTS, EMAIL, GMAIL, HUB, PRODUCT, SLACK, STAR, STORE, THANKS, ReviewWorkflow, bare, norm,
                       parse_dt, ratings, raw_email)

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
        sent = [json.loads(x) for x in ctx.batch([{"name": "api_fetch", "arguments": ctx.fetch_args(
            "GET", GMAIL + f"messages/{m['id']}")} for m in ids])]
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

    def params(self):
        out, when = dict(DEFAULTS), {}
        for m in self.messages("subject:review policy amendment"):
            if not self.is_amendment(m) or parse_dt(m.get("date")) >= self.at:
                continue
            pv = self.amendment_value(m)
            if pv and (pv[0] not in when or parse_dt(m["date"]) > when[pv[0]]):
                out[pv[0]], when[pv[0]] = pv[1], parse_dt(m["date"])
        return out


class NoAmendments(ReviewWorkflow):
    def is_amendment(self, msg):
        return False

    def params(self):
        return dict(DEFAULTS)


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


class NoAbuse(ReviewWorkflow):
    def suppressed(self, notes):
        return "bot suspected" in notes.lower()


class NoBot(ReviewWorkflow):
    def suppressed(self, notes):
        return "abuse" in notes.lower()


class CrashRatingOnly(ReviewWorkflow):
    def review(self, msg):
        f = self.fields(msg.get("body_plain") or "")
        rating = self.rating(f, msg)
        if self.is_high(f.get("Comment", "")) and rating is not None and rating not in ratings(self.params()["Ticket ratings"]):
            return None
        return super().review(msg)


class CrashThanks(ReviewWorkflow):
    """The reference's handling, then a thank-you also for a high-priority review at a thank-you rating."""
    def review(self, msg):
        out = super().review(msg)
        f = self.fields(msg.get("body_plain") or "")
        rating, who, notes = self.rating(f, msg), self.reviewer(f), f.get("Notes", "")
        if (rating is not None and who and not self.is_old(f) and not self.suppressed(notes)
                and self.is_high(f.get("Comment", "")) and rating in ratings(self.params()["Thank-you ratings"])
                and not self.emails_blocked(notes)):
            self.send(who, THANKS, "Thank you for your review of Fernleaf Planner!")
        return out


class EngEmail(ReviewWorkflow):
    def emails_blocked(self, notes):
        n = notes.lower()
        return "comp account" in n or "non-solicitation" in n


class CompEmail(ReviewWorkflow):
    def emails_blocked(self, notes):
        return "escalated to engineering" in notes.lower()


class EngNoTicket(ReviewWorkflow):
    def suppressed(self, notes):
        return super().suppressed(notes) or "escalated to engineering" in notes.lower()


class CompNoTicket(ReviewWorkflow):
    def suppressed(self, notes):
        n = notes.lower()
        return super().suppressed(notes) or "comp account" in n or "non-solicitation" in n


class BaseForms(ReviewWorkflow):
    def is_high(self, comment):
        return re.search(r"\b(crash|freeze)\b", comment or "", re.I) is not None


class NoEscalate(ReviewWorkflow):
    def escalate(self, reason):
        return None


class OldestAmendment(ReviewWorkflow):
    def params(self):
        out, when = dict(DEFAULTS), {}
        for m in self.messages(f"from:{PRODUCT}"):
            if not self.is_amendment(m) or parse_dt(m.get("date")) >= self.at:
                continue
            pv = self.amendment_value(m)
            if pv and (pv[0] not in when or parse_dt(m["date"]) < when[pv[0]]):
                out[pv[0]], when[pv[0]] = pv[1], parse_dt(m["date"])
        return out


class TicketAmendIgnored(ReviewWorkflow):
    def params(self):
        return dict(super().params(), **{"Ticket ratings": DEFAULTS["Ticket ratings"]})


class ThanksAmendIgnored(ReviewWorkflow):
    def params(self):
        return dict(super().params(), **{"Thank-you ratings": DEFAULTS["Thank-you ratings"]})


class WeekCount(ReviewWorkflow):
    def daily_counts(self, code):
        n = sum(1 for t in self.week_tickets() if "app review" in norm(t.get("subject")).lower()
                and code.lower() in norm(t.get("subject")).lower())
        m = sum(1 for x in self.messages("label:SENT subject:thank")
                if "SENT" in (x.get("label_ids") or []) and norm(x.get("subject")).lower() == THANKS.lower()
                and parse_dt(x.get("date")) >= self.monday)
        return n, m


class ReplyRequester(ReviewWorkflow):
    def run(self):
        out = super().run()
        if self.t.get("app") == "gmail":
            msg = self.ctx.fetch_json("GET", GMAIL + f"messages/{self.t['data']['message_id']}")
            sender = bare(msg.get("from"))
            if sender not in STORE and sender != PRODUCT:
                self.send(sender, "Re: " + (msg.get("subject") or ""),
                          "Thanks for reaching out. Only Product can change the review triage policy.")
        return out


class AnyPosterCode(ReviewWorkflow):
    def code(self):
        hist = self.ctx.fetch_json("GET", SLACK + "conversations.history", params={"channel": "app-reviews", "limit": 500})
        posts = [m for m in hist.get("messages", []) if float(m.get("ts", 0)) <= self.at.timestamp()]
        for m in sorted(posts, key=lambda m: float(m["ts"]), reverse=True):
            g = re.search(r"TRIAGE-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*", m.get("text") or "")
            if g:
                return g.group(0)
        return None


class UpdatedIgnored(ReviewWorkflow):
    def review(self, msg):
        if "updated" in norm(msg.get("subject")).lower():
            return None
        return super().review(msg)


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
    "no-amendments": _wrap(NoAmendments),
    "stale-code": _wrap(StaleCode),
    "count-all": _wrap(CountAll),
    "no-abuse": _wrap(NoAbuse),
    "no-bot": _wrap(NoBot),
    "crash-rating-only": _wrap(CrashRatingOnly),
    "crash-thanks": _wrap(CrashThanks),
    "eng-email": _wrap(EngEmail),
    "comp-email": _wrap(CompEmail),
    "ticket-amend-ignored": _wrap(TicketAmendIgnored),
    "eng-no-ticket": _wrap(EngNoTicket),
    "comp-no-ticket": _wrap(CompNoTicket),
    "base-forms": _wrap(BaseForms),
    "no-escalate": _wrap(NoEscalate),
    "oldest-amendment": _wrap(OldestAmendment),
    "thanks-amend-ignored": _wrap(ThanksAmendIgnored),
    "week-count": _wrap(WeekCount),
    "reply-requester": _wrap(ReplyRequester),
    "any-poster-code": _wrap(AnyPosterCode),
    "updated-ignored": _wrap(UpdatedIgnored),
}


def _naive_lines() -> int:
    import inspect
    src = inspect.getsource(naive).splitlines()
    return sum(1 for x in src if x.strip() and not x.strip().startswith("#"))


NAIVE_LINES = _naive_lines()
