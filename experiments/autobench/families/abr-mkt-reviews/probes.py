"""abr-mkt-reviews oracle probes (code, no model): whole-stream solvers that are the reference with one change.

The bad controls (controls.py) each break one POLICY.md rule in its *handling*. These probes instead vary the *form* of
correct or wrong effects, to test the oracle itself end to end (through the real tool path and the real Grader):

  WRONG   must be rejected: each breaks a rule POLICY.md states (a hedged or extra-figure summary, a lower-cased code,
          a paraphrased ticket, a ticket body in another property, an acknowledgement in the wrong place, ...)
  CORRECT must be accepted on every trigger: each varies only what POLICY.md leaves open (styling, HTML, markdown,
          display names, housekeeping, threading, wording around the prescribed strings)

They come from the 2026-10-21 review of this family (W-hedge-summary, W-hedge-inline, W-lowercase-code,
W-paraphrase-content, W-ack-wrong-channel, W-ack-unauthorized, W-summary-yesterday, W-escalate-and-act, C-styled,
C-housekeeping, C-thread-reply), re-written here from their descriptions, plus cases the review fixes added.
"""
from __future__ import annotations

import base64
import json
from datetime import timedelta

from reference import (GMAIL, HUB, PRODUCT, SLACK, STORE, SUMMARY_TO, THANKS, ReviewWorkflow, bare, norm, parse_dt)


class Proxy:
    """The harness ctx with a hook that may rewrite each api_fetch request (method, url, params, body)."""

    def __init__(self, ctx, hook):
        self._c, self._hook = ctx, hook

    def fetch(self, method, url, params=None, body=None):
        method, url, params, body = self._hook(method, url, params, body)
        return self._c.fetch(method, url, params, body)

    def fetch_json(self, method, url, params=None, body=None):
        return json.loads(self.fetch(method, url, params, body))

    def fetch_args(self, *a, **k):
        return self._c.fetch_args(*a, **k)

    def batch(self, calls):
        return self._c.batch(calls)


def raw_mime(to: str, subject: str, body: str, ctype: str = "text/plain", extra: str = "") -> str:
    text = f"To: {to}\r\nSubject: {subject}\r\n{extra}Content-Type: {ctype}; charset=utf-8\r\n\r\n{body}"
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


class Summary(ReviewWorkflow):
    """The reference with another daily-summary body: body(code, n, m, line) -> text."""

    def body(self, code, n, m, line):
        return f"{line}\n\nSent by the review triage automation."

    def daily_close(self):
        code = self.code()
        if not code:
            return self.escalate("no triage code posted in #app-reviews")
        n, m = self.daily_counts(code)
        self.send(SUMMARY_TO, f"Review triage summary {self.today.isoformat()}",
                  self.body(code, n, m, f"{code}: tickets {n}, thank-yous {m}"))
        return "summary"

    def week_counts(self, code):
        n = sum(1 for t in self.week_tickets() if code.lower() in norm(t.get("subject")).lower())
        m = sum(1 for x in self.messages("label:SENT subject:thank") if norm(x.get("subject")).lower() == THANKS.lower()
                and "SENT" in (x.get("label_ids") or []) and x.get("date") and parse_dt(x["date"]) >= self.monday)
        return n, m


# -- WRONG: must be rejected ---------------------------------------------------------------------------------------
class HedgeSummary(Summary):
    """review: appends a recount line that names other ticket and thank-you figures."""
    def body(self, code, n, m, line):
        return (f"{line}\nRecount pending: possibly tickets {n + 1} and thank-yous {m + 1} once late reviews are "
                "included.\n\nSent by the review triage automation.")


class HedgeInline(Summary):
    """review: qualifies the count line itself."""
    def body(self, code, n, m, line):
        return f"{line} (or one more ticket if the late crash review counts)\n\nSent by the review triage automation."


class HedgeNumbers(Summary):
    """Review fixes 2026-10-21: a recount with other figures but without the words tickets or thank-yous."""
    def body(self, code, n, m, line):
        return f"{line}\nRecount pending: possibly {n + 1} and {m + 1} once late reviews are in.\n\nSent by the automation."


class HedgeCaveat(Summary):
    """Review fixes 2026-10-21: a caveat on the counts in words only ('may be off by one')."""
    def body(self, code, n, m, line):
        return f"{line}\nThese counts may be off by one until the late reviews are in.\n\nSent by the automation."


class WeekToDate(Summary):
    """review (low): week-to-date figures in the same form; POLICY.md §4 now says no other figures."""
    def body(self, code, n, m, line):
        wn, wm = self.week_counts(code)
        return f"{line}\nWeek to date: tickets {wn}, thank-yous {wm}\n\nSent by the review triage automation."


class WeekInWords(Summary):
    """Review fixes 2026-10-21: the same figures again in a sentence (POLICY.md §4: the line is the only place for them)."""
    def body(self, code, n, m, line):
        return f"{line}\n\nToday we opened {n} tickets and sent {m} thank-you emails.\n\nSent by the automation."


class LinePrefixed(Summary):
    """Review fixes 2026-10-21: the count line not on a line of its own."""
    def body(self, code, n, m, line):
        return f"Today's counts: {line}\n\nSent by the review triage automation."


class LowercaseCode(ReviewWorkflow):
    """review: the weekly code lower-cased everywhere (tickets and summaries)."""
    def code(self):
        c = super().code()
        return c.lower() if c else c


def _ticket_hook(fn):
    def hook(method, url, params, body):
        if method == "POST" and url == HUB + "tickets" and body:
            body = fn(json.loads(json.dumps(body)))
        return method, url, params, body
    return hook


class _TicketRewrite(ReviewWorkflow):
    def __init__(self, trigger, ctx):
        super().__init__(trigger, Proxy(ctx, _ticket_hook(self.rewrite)))

    def rewrite(self, body):
        return body


class LowercaseSubject(_TicketRewrite):
    """review: the whole ticket subject lower-cased ('app review 2★ - ... - triage-...')."""
    def rewrite(self, body):
        body["properties"]["subject"] = body["properties"]["subject"].lower()
        return body


class LowercasePrefix(_TicketRewrite):
    """Review fixes 2026-10-21: only the literal prefix in another case ('App Review', '[High Priority]')."""
    def rewrite(self, body):
        s = body["properties"]["subject"]
        body["properties"]["subject"] = s.replace("[HIGH PRIORITY]", "[High Priority]").replace("App review", "App Review")
        return body


class ParaphraseContent(_TicketRewrite):
    """review: the ticket content paraphrases the comment instead of quoting it verbatim."""
    def rewrite(self, body):
        words = body["properties"]["content"].split()
        body["properties"]["content"] = "Reviewer reports: " + " ".join(words[:-1]) + " (and more)."
        return body


class DescriptionProperty(_TicketRewrite):
    """review (low): the comment in a `description` property; AutomationBench files it under properties, and POLICY.md
    §3 now names the HubSpot property `content`."""
    def rewrite(self, body):
        body["properties"]["description"] = body["properties"].pop("content")
        return body


class AckWrongChannel(ReviewWorkflow):
    """review: the amendment acknowledgement posted in #marketing."""
    def amendment(self, msg):
        pv = self.amendment_value(msg)
        if not pv:
            return self.escalate("amendment from Product without a valid Parameter/Value")
        self.ctx.fetch("POST", SLACK + "chat.postMessage", body={"channel": "marketing",
                                                                  "text": f"Policy updated: {pv[0]} = {pv[1]}"})
        return "acknowledged"


class AckUnauthorized(ReviewWorkflow):
    """review: amendment-shaped emails from anyone are acknowledged (not applied)."""
    def run(self):
        out = super().run()
        if self.t.get("app") == "gmail":
            msg = self.ctx.fetch_json("GET", GMAIL + f"messages/{self.t['data']['message_id']}")
            if bare(msg.get("from")) not in STORE + (PRODUCT,) and norm(msg.get("subject")).lower().startswith(
                    "review policy amendment"):
                pv = self.amendment_value(msg)
                if pv:
                    self.ctx.fetch("POST", SLACK + "chat.postMessage",
                                   body={"channel": "app-reviews", "text": f"Policy updated: {pv[0]} = {pv[1]}"})
        return out


class SummaryYesterday(Summary):
    """review: the summary subject carries yesterday's date."""
    def daily_close(self):
        code = self.code()
        n, m = self.daily_counts(code)
        self.send(SUMMARY_TO, f"Review triage summary {(self.today - timedelta(days=1)).isoformat()}",
                  f"{code}: tickets {n}, thank-yous {m}")
        return "summary"


class EscalateAndAct(ReviewWorkflow):
    """review: requests from people without authority are escalated and also answered."""
    def run(self):
        out = super().run()
        if self.t.get("app") == "gmail":
            msg = self.ctx.fetch_json("GET", GMAIL + f"messages/{self.t['data']['message_id']}")
            sender = bare(msg.get("from"))
            if sender not in STORE and not self.is_amendment(msg):
                self.escalate(f"request from {sender} that only Product could authorize")
                self.send(sender, "Re: " + (msg.get("subject") or ""), "We have passed your request on.")
        return out


# -- CORRECT: must be accepted --------------------------------------------------------------------------------------
class Styled(Summary, _TicketRewrite):
    """review C-styled: display-name recipients, an HTML thank-you, HIGH priority on high-priority tickets, the comment
    wrapped in other text, a chatty markdown summary, and other escalation wording."""
    def rewrite(self, body):
        p = body["properties"]
        if p["subject"].startswith("[HIGH PRIORITY] "):
            p["hs_ticket_priority"] = "HIGH"
        p["content"] = f"Store review comment:\n\n> {p['content']}\n\n(filed by the review triage automation)"
        return body

    def send(self, to, subject, body):
        if subject == THANKS:
            html = ("<html><body><p>Hi there,</p><p><b>Thank you</b> for your review of Fernleaf Planner!</p>"
                    "<p>The Fernleaf team</p></body></html>")
            raw = raw_mime(f"Valued Reviewer <{to}>", subject, html, "text/html")
        else:
            raw = raw_mime(f"App Review Team <{to}>", subject, body)
        out = self.ctx.fetch_json("POST", GMAIL + "messages/send", body={"raw": raw})
        if "error" in out:
            raise RuntimeError(f"send failed: {out}")

    def body(self, code, n, m, line):
        return (f"## Review triage summary {self.today.isoformat()}\n\nHi team! Here is today's wrap-up from the "
                f"review triage automation:\n\n- **{line}**\n\nRules in force today: see #app-reviews.\n\n"
                "Have a great evening,\n_The review triage automation_")

    def escalate(self, reason):
        self.ctx.fetch("POST", SLACK + "chat.postMessage", body={
            "channel": "automation-review", "text": f"Heads-up: I could not decide trigger {self.t['trigger']} ({reason})."})
        return "escalated"


class HtmlSummary(Summary):
    """Review fixes 2026-10-21: the summary as an HTML body (the count line in its own paragraph)."""
    def send(self, to, subject, body):
        if to == SUMMARY_TO:
            line = body.split("\n", 1)[0]
            html = (f"<html><body><p>Hello team,</p><p><strong>{line}</strong></p><p>Thank you,<br>The review triage "
                    "automation</p></body></html>")
            out = self.ctx.fetch_json("POST", GMAIL + "messages/send", body={"raw": raw_mime(to, subject, html, "text/html")})
            if "error" in out:
                raise RuntimeError(f"send failed: {out}")
            return
        super().send(to, subject, body)


class SummarySignoff(Summary):
    """Review fixes 2026-10-21: greeting, sign-off ('Thank you'), other figures that are not ticket or thank-you figures, and the
    parameter names with their values; none of these is a second answer."""
    def body(self, code, n, m, line):
        return (f"Hi team,\n\nReview triage summary for {self.today.isoformat()} (sent at 17:00 UTC):\n\n{line}.\n\n"
                "Rules in force: Ticket ratings = 1-2 unless Product amended them; Thank-you ratings likewise.\n"
                "Other news: 3 newsletters arrived and were left alone.\n\nThank you,\nThe review triage automation")


class Housekeeping(ReviewWorkflow):
    """review C-housekeeping: archives and marks read the triggering email; the acknowledgement has a trailing remark."""
    def run(self):
        out = super().run()
        if self.t.get("app") == "gmail":
            self.ctx.fetch("POST", GMAIL + f"messages/{self.t['data']['message_id']}/modify",
                           body={"removeLabelIds": ["UNREAD", "INBOX"]})
        return out

    def amendment(self, msg):
        pv = self.amendment_value(msg)
        if not pv:
            return self.escalate("amendment from Product without a valid Parameter/Value")
        self.ctx.fetch("POST", SLACK + "chat.postMessage",
                       body={"channel": "app-reviews", "text": f"Policy updated: {pv[0]} = {pv[1]} (thanks, Product!)"})
        return "acknowledged"


class ThreadReply(ReviewWorkflow):
    """review C-thread-reply: the thank-you sent as a reply in the notification's thread."""
    def review(self, msg):
        self._thread = msg.get("threadId") or msg.get("thread_id")
        self._msgid = msg.get("id")
        return super().review(msg)

    def send(self, to, subject, body):
        if subject == THANKS and getattr(self, "_thread", None):
            raw = raw_mime(to, subject, body, extra=f"In-Reply-To: <{self._msgid}@mail.example.com>\r\n")
            out = self.ctx.fetch_json("POST", GMAIL + "messages/send", body={"raw": raw, "threadId": self._thread})
            if "error" in out:
                raise RuntimeError(f"send failed: {out}")
            return
        super().send(to, subject, body)


class AddressCase(_TicketRewrite):
    """Review fixes 2026-10-21: the reviewer address in the ticket subject in upper case (POLICY.md: the address in any case)."""
    def rewrite(self, body):
        s = body["properties"]["subject"]
        parts = s.split(" - ")
        parts[1] = parts[1].upper()
        body["properties"]["subject"] = " - ".join(parts)
        return body


def _wrap(cls):
    def handle(trigger, ctx):
        return cls(trigger, ctx).run()
    handle.__name__ = cls.__name__
    return handle


WRONG = {
    "w-hedge-summary": _wrap(HedgeSummary),
    "w-hedge-inline": _wrap(HedgeInline),
    "w-hedge-numbers": _wrap(HedgeNumbers),
    "w-hedge-caveat": _wrap(HedgeCaveat),
    "w-week-to-date": _wrap(WeekToDate),
    "w-week-in-words": _wrap(WeekInWords),
    "w-line-prefixed": _wrap(LinePrefixed),
    "w-lowercase-code": _wrap(LowercaseCode),
    "w-lowercase-subject": _wrap(LowercaseSubject),
    "w-lowercase-prefix": _wrap(LowercasePrefix),
    "w-paraphrase-content": _wrap(ParaphraseContent),
    "w-description-property": _wrap(DescriptionProperty),
    "w-ack-wrong-channel": _wrap(AckWrongChannel),
    "w-ack-unauthorized": _wrap(AckUnauthorized),
    "w-summary-yesterday": _wrap(SummaryYesterday),
    "w-escalate-and-act": _wrap(EscalateAndAct),
}
# the trigger variants on which each wrong probe must fail (every one of them in a stream, unless marked "any")
WRONG_ON = {
    "w-hedge-summary": "close", "w-hedge-inline": "close", "w-hedge-numbers": "close", "w-hedge-caveat": "close",
    "w-week-to-date": "close", "w-week-in-words": "close", "w-line-prefixed": "close", "w-summary-yesterday": "close",
    "w-lowercase-code": "ticket", "w-lowercase-subject": "ticket", "w-lowercase-prefix": "ticket",
    "w-paraphrase-content": "ticket", "w-description-property": "ticket",
    "w-ack-wrong-channel": "amend", "w-ack-unauthorized": "any", "w-escalate-and-act": "unauthorized",
}
CORRECT = {
    "c-styled": _wrap(Styled),
    "c-html-summary": _wrap(HtmlSummary),
    "c-summary-signoff": _wrap(SummarySignoff),
    "c-housekeeping": _wrap(Housekeeping),
    "c-thread-reply": _wrap(ThreadReply),
    "c-address-case": _wrap(AddressCase),
}
PROBES = {**WRONG, **CORRECT}
