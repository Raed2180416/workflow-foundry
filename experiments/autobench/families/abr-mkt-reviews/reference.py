"""abr-mkt-reviews reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch -> AutomationBench's api_fetch on the simulated Gmail, HubSpot and Slack). It never imports the generator,
the oracle or lib.py, and it keeps no private state: every cross-trigger fact (this week's code, amendments in force,
tickets created this week, thank-yous sent today) is read back from the apps, which are the state of record.

Reading a review is line parsing (`Rating:`, `Reviewer:`, `Date:`, `Comment:`, `Notes:`), and the high-priority test is
a whole-word list. A model-built workflow needs the same two steps; the reference's rules are checked against the
generator's own templates only, which is a known limit (README, "Limits").

`ReviewWorkflow` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
"""
from __future__ import annotations

import base64
import json
import re
from datetime import date, datetime, timedelta, timezone

UTC = timezone.utc
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/"
HUB = "https://api.hubapi.com/crm/v3/objects/"
SLACK = "https://slack.com/api/"

STORE = ("reviews@appstore.example.com", "review-noreply@appstore.example.com")
PRODUCT = "product@company.example.com"
SUMMARY_TO = "app-reviews@company.example.com"
THANKS = "Thank you for your review"
AMEND = "Review policy amendment"
TEAM = "App Review Team"
HIGH_PREFIX = "[HIGH PRIORITY] "
STAR = "★"
DEFAULTS = {"Ticket ratings": "1-2", "Thank-you ratings": "4-5"}
ALLOWED = {"Ticket ratings": ("1-2", "1-3"), "Thank-you ratings": ("4-5", "5")}
HIGH_WORDS = re.compile(r"(?<![a-z])(crash|crashes|crashed|crashing|freeze|freezes|freezing|froze|frozen)(?![a-z])", re.I)
CODE_POST = re.compile(r"Triage code for the week of (\d{4}-\d{2}-\d{2}):\s*(TRIAGE-[A-Za-z0-9-]+)")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
NO_EMAIL_NOTES = ("escalated to engineering", "comp account", "non-solicitation")


def parse_dt(s) -> datetime:
    """An ISO string (naive = UTC) or Gmail's milliseconds since the epoch."""
    if isinstance(s, (int, float)):
        return datetime.fromtimestamp(s / 1000, UTC)
    d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return d.replace(tzinfo=UTC) if d.tzinfo is None else d.astimezone(UTC)


def norm(s) -> str:
    return " ".join(str(s or "").split())


def bare(s: str | None) -> str:
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


def ratings(value: str) -> set[int]:
    a, _, b = value.partition("-")
    return set(range(int(a), int(b or a) + 1))


def raw_email(to: str, subject: str, body: str) -> str:
    text = f"To: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


class ReviewWorkflow:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx
        self.at = parse_dt(trigger["at"])
        self.today = self.at.date()
        self.monday = (self.at - timedelta(days=self.at.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)

    # -- entry -------------------------------------------------------------------------------------------------------
    def run(self):
        if self.t.get("app") == "schedule" and self.t.get("event") == "daily_close":
            return self.daily_close()
        if self.t.get("app") != "gmail" or self.t.get("event") != "new_email":
            return None
        msg = self.ctx.fetch_json("GET", GMAIL + f"messages/{self.t['data']['message_id']}")
        sender = bare(msg.get("from"))
        if sender in STORE:
            return self.review(msg)
        if self.is_amendment(msg):
            return self.amendment(msg)
        return None

    def escalate(self, reason: str):
        self.ctx.fetch("POST", SLACK + "chat.postMessage",
                       body={"channel": "automation-review", "text": f"{self.t['trigger']}: {reason}"})
        return "escalated"

    # -- state of record ---------------------------------------------------------------------------------------------
    def messages(self, q: str) -> list[dict]:
        ids = self.ctx.fetch_json("GET", GMAIL + "messages", params={"q": q, "maxResults": 500}).get("messages", [])
        if not ids:
            return []
        calls = [self.ctx.fetch_args("GET", GMAIL + f"messages/{m['id']}") for m in ids]
        return [json.loads(x) for x in self.ctx.batch([{"name": "api_fetch", "arguments": c} for c in calls])]

    def is_amendment(self, msg: dict) -> bool:
        return bare(msg.get("from")) == PRODUCT and norm(msg.get("subject")).lower().startswith(AMEND.lower())

    def amendment_value(self, msg: dict) -> tuple[str, str] | None:
        body = msg.get("body_plain") or ""
        p = re.search(r"^\s*Parameter:\s*(.+?)\s*$", body, re.M)
        v = re.search(r"^\s*Value:\s*(.+?)\s*$", body, re.M)
        if not p or not v:
            return None
        param = next((k for k in ALLOWED if k.lower() == p.group(1).strip().lower()), None)
        value = v.group(1).strip().replace(" ", "").replace("–", "-")
        if param is None or value not in ALLOWED[param]:
            return None
        return param, value

    def params(self) -> dict:
        """Defaults, changed by the newest authorized amendment per parameter received before this trigger."""
        out, when = dict(DEFAULTS), {}
        for m in self.messages(f"from:{PRODUCT}"):
            if not self.is_amendment(m) or parse_dt(m.get("date")) >= self.at:
                continue
            pv = self.amendment_value(m)
            if pv and (pv[0] not in when or parse_dt(m["date"]) > when[pv[0]]):
                out[pv[0]], when[pv[0]] = pv[1], parse_dt(m["date"])
        return out

    def code(self) -> str | None:
        users = self.ctx.fetch_json("GET", SLACK + "users.list").get("members", [])
        team = {u["id"] for u in users if TEAM in (u.get("real_name"), (u.get("profile") or {}).get("display_name"))}
        hist = self.ctx.fetch_json("GET", SLACK + "conversations.history", params={"channel": "app-reviews", "limit": 500})
        posts = [m for m in hist.get("messages", []) if m.get("user") in team and float(m.get("ts", 0)) <= self.at.timestamp()]
        for m in sorted(posts, key=lambda m: float(m["ts"]), reverse=True):
            g = CODE_POST.search(m.get("text") or "")
            if g:
                return g.group(2)
        return None

    def week_tickets(self) -> list[dict]:
        res = self.ctx.fetch_json("GET", HUB + "tickets").get("results", [])
        return [t for t in res if t.get("createdAt") and parse_dt(t["createdAt"]) >= self.monday]

    # -- a review ----------------------------------------------------------------------------------------------------
    def fields(self, body: str) -> dict:
        out = {}
        for line in (body or "").splitlines():
            m = re.match(r"\s*(Rating|Reviewer|Date|Comment|Notes)\s*:\s*(.*)$", line)
            if m and m.group(1) not in out:
                out[m.group(1)] = m.group(2).strip()
        return out

    def rating(self, f: dict, msg: dict) -> int | None:
        m = re.fullmatch(r"([1-5])", f.get("Rating", ""))
        return int(m.group(1)) if m else None

    def reviewer(self, f: dict) -> str | None:
        m = EMAIL.search(f.get("Reviewer", ""))
        return m.group(0).lower() if m else None

    def is_old(self, f: dict) -> bool:
        try:
            return date.fromisoformat(f.get("Date", "").strip()) < self.today
        except ValueError:
            return False

    def suppressed(self, notes: str) -> bool:
        n = notes.lower()
        return "bot suspected" in n or "abuse" in n

    def is_high(self, comment: str) -> bool:
        return HIGH_WORDS.search(comment or "") is not None

    def emails_blocked(self, notes: str) -> bool:
        return any(x in notes.lower() for x in NO_EMAIL_NOTES)

    def has_ticket(self, reviewer: str) -> bool:
        key = f" - {reviewer.lower()} - "
        return any(key in norm(t.get("subject")).lower() for t in self.week_tickets())

    def review(self, msg: dict):
        f = self.fields(msg.get("body_plain") or "")
        rating, who = self.rating(f, msg), self.reviewer(f)
        if rating is None or not who:
            return self.escalate("review notification without a whole-number rating 1-5 or a reviewer address")
        if self.is_old(f):
            return None
        notes = f.get("Notes", "")
        if self.suppressed(notes):
            return None
        comment = f.get("Comment", "")
        high = self.is_high(comment)
        params = self.params()
        done = []
        if (high or rating in ratings(params["Ticket ratings"])) and not self.has_ticket(who):
            code = self.code()
            if not code:
                return self.escalate("no triage code posted in #app-reviews")
            subject = (HIGH_PREFIX if high else "") + f"App review {rating}{STAR} - {who} - {code}"
            self.ctx.fetch("POST", HUB + "tickets", body={"properties": {
                "subject": subject, "content": comment, "hs_pipeline": "0", "hs_pipeline_stage": "1"}})
            done.append("ticket")
        if rating in ratings(params["Thank-you ratings"]) and not high and not self.emails_blocked(notes):
            self.send(who, THANKS, "Thank you for your review of Fernleaf Planner! We read every review and are glad "
                                   "the app helps you.\n\nThe Fernleaf team")
            done.append("thanks")
        return "+".join(done) or None

    def send(self, to: str, subject: str, body: str):
        out = self.ctx.fetch_json("POST", GMAIL + "messages/send", body={"raw": raw_email(to, subject, body)})
        if "error" in out:
            raise RuntimeError(f"send failed: {out}")

    # -- an amendment ------------------------------------------------------------------------------------------------
    def amendment(self, msg: dict):
        pv = self.amendment_value(msg)
        if not pv:
            return self.escalate("amendment from Product without a valid Parameter/Value")
        self.ctx.fetch("POST", SLACK + "chat.postMessage",
                       body={"channel": "app-reviews", "text": f"Policy updated: {pv[0]} = {pv[1]}"})
        return "acknowledged"

    # -- daily close -------------------------------------------------------------------------------------------------
    def daily_counts(self, code: str) -> tuple[int, int]:
        n = sum(1 for t in self.week_tickets() if parse_dt(t["createdAt"]).date() == self.today
                and "app review" in norm(t.get("subject")).lower() and code.lower() in norm(t.get("subject")).lower())
        m = sum(1 for x in self.messages("label:SENT subject:thank")
                if "SENT" in (x.get("label_ids") or []) and norm(x.get("subject")).lower() == THANKS.lower()
                and parse_dt(x.get("date")).date() == self.today)
        return n, m

    def daily_close(self):
        code = self.code()
        if not code:
            return self.escalate("no triage code posted in #app-reviews")
        n, m = self.daily_counts(code)
        self.send(SUMMARY_TO, f"Review triage summary {self.today.isoformat()}",
                  f"{code}: tickets {n}, thank-yous {m}\n\nSent by the review triage automation.")
        return "summary"


def handle(trigger: dict, ctx):
    return ReviewWorkflow(trigger, ctx).run()


if __name__ == "__main__":
    print(json.dumps({"module": "reference", "entry": "handle(trigger, ctx)"}))
