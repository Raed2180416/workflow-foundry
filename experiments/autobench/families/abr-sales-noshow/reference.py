"""abr-sales-noshow reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch -> AutomationBench's api_fetch on the simulated apps). It never imports the generator or the oracle, and it
keeps no private state: every cross-trigger fact (earlier no-shows, retractions, this week's tasks) is read back from
Calendly and Salesforce, which are the state of record.

Message classification is keyword rules (POLICY.md section 1 and 3). A model-built workflow would need a judgment
there; the reference's rules are checked against the generator's text templates only, which is a known limit
(README, "Limits").

`NoShowWorkflow` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
SF = "https://example.my.salesforce.com/services/data/v61.0/"
CAL = "https://api.calendly.com/"
SLACK = "https://slack.com/api/"
INTERNAL_DOMAIN = "company.example.com"
THRESHOLD = 50_000
WINDOW = timedelta(hours=3)
REPEAT_WINDOW = timedelta(days=14)
PREFIX = "Follow up on missed call - "
RETRACT_SUFFIX = " | Retracted: joined late"
CLOSED = ("Closed Won", "Closed Lost")

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
RETRACTION = re.compile(r"false alarm|joined\b.{0,40}\blate\b|\bdid join\b|not a no-?show", re.I)
REPORT = re.compile(r"no-?show|didn'?t show|did not show|never (?:joined|showed)|\bmissed\b", re.I)


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(UTC)


def scheduled(dt: datetime) -> str:
    return f"Scheduled: {dt:%Y-%m-%d %H:%M} UTC"


def soql(ctx, q: str) -> list[dict]:
    out = ctx.fetch_json("GET", SF + "query", params={"q": q})
    if "records" not in out:
        raise RuntimeError(f"SOQL failed: {out}")
    return out["records"]


def q(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


class NoShowWorkflow:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx
        self.at = parse_dt(trigger["at"])

    # -- entry -------------------------------------------------------------------------------------------------------
    def run(self):
        if self.t.get("app") == "schedule" and self.t.get("event") == "week_close":
            return self.week_close()
        if self.t.get("app") != "slack" or self.t.get("event") != "new_message":
            return None
        text = self.t["data"].get("text") or ""
        kind = self.classify(text)
        if kind == "retraction":
            return self.retraction(text)
        if kind == "report":
            return self.report(text)
        return None

    def classify(self, text: str) -> str:
        if RETRACTION.search(text):
            return "retraction"
        if REPORT.search(text):
            return "report"
        return "other"

    def escalate(self, reason: str):
        self.ctx.fetch("POST", SLACK + "chat.postMessage",
                       body={"channel": "automation-review", "text": f"{self.t['trigger']}: {reason}"})
        return "escalated"

    # -- no-show report ----------------------------------------------------------------------------------------------
    def report(self, text: str):
        emails = sorted({e.lower().rstrip(".") for e in EMAIL.findall(text)})
        if len(emails) != 1:
            return self.escalate(f"cannot identify one invitee email in the report ({len(emails)} found)")
        email = emails[0]
        if email.endswith("@" + INTERNAL_DOMAIN):
            return None
        events = self.ctx.fetch_json("GET", CAL + "scheduled_events", params={"invitee_email": email})["collection"]
        pairs = self.find_meeting(email, events)
        if len(pairs) != 1:
            return self.escalate(f"{len(pairs)} active Calendly events of {email} started in the 3 hours before the report")
        ev, inv = pairs[0]
        if inv.get("no_show"):
            return None                                           # already handled: duplicate report
        contacts = soql(self.ctx, f"SELECT Id, AccountId, Email FROM Contact WHERE Email = '{q(email)}'")
        contacts = [c for c in contacts if (c.get("Email") or "").lower() == email]
        if len(contacts) != 1:
            return self.escalate(f"{len(contacts)} Salesforce contacts with email {email}")
        contact = contacts[0]
        pipeline, big = self.pipeline(contact.get("AccountId"))
        repeat = self.is_repeat(email, ev, events, contact["Id"])
        start = parse_dt(ev["start_time"])
        desc = f"{scheduled(start)} | Account pipeline: ${pipeline:,}" + (" | Repeat no-show" if repeat else "")
        self.ctx.fetch("POST", CAL + "invitee_no_shows", body={"invitee": inv["uri"]})
        self.ctx.fetch("POST", SF + "sobjects/Task", body={
            "Subject": PREFIX + ev["name"], "Status": "Not Started", "Priority": self.priority(big, repeat),
            "WhoId": contact["Id"], "Description": desc})
        return "handled"

    def invitees(self, ev: dict, email: str) -> list[dict]:
        uuid = ev["uri"].rstrip("/").split("/")[-1]
        out = self.ctx.fetch_json("GET", CAL + f"scheduled_events/{uuid}/invitees", params={"email": email})
        return [i for i in out.get("collection", []) if (i.get("email") or "").lower() == email]

    def find_meeting(self, email: str, events: list[dict]) -> list[tuple]:
        cands = [e for e in events if e.get("status") == "active" and e.get("start_time")
                 and self.at - WINDOW <= parse_dt(e["start_time"]) <= self.at]
        return [(e, i) for e in cands for i in self.invitees(e, email) if i.get("status") == "active"]

    def pipeline(self, account_id) -> tuple[int, bool]:
        if not account_id:
            return 0, False
        opps = soql(self.ctx, f"SELECT Id, Amount, StageName FROM Opportunity WHERE AccountId = '{q(account_id)}'")
        open_ = [o for o in opps if o.get("StageName") not in CLOSED]
        amounts = [float(o.get("Amount") or 0) for o in open_]
        return int(round(sum(amounts))), any(a >= THRESHOLD for a in amounts)

    def priority(self, big: bool, repeat: bool) -> str:
        return "High" if big or repeat else "Normal"

    def is_repeat(self, email: str, ev: dict, events: list[dict], contact_id: str) -> bool:
        start = parse_dt(ev["start_time"])
        prior = [e for e in events if e["uri"] != ev["uri"] and e.get("start_time")
                 and start - REPEAT_WINDOW <= parse_dt(e["start_time"]) < start]
        flagged = [e for e in prior if any(i.get("no_show") for i in self.invitees(e, email))]
        if not flagged:
            return False
        tasks = soql(self.ctx, f"SELECT Id, Subject, Description FROM Task WHERE WhoId = '{q(contact_id)}'")

        def retracted(e):
            sched = scheduled(parse_dt(e["start_time"]))
            return any((t.get("Subject") or "").strip() == PREFIX + e["name"] and sched in (t.get("Description") or "")
                       and "retracted" in (t.get("Description") or "").lower() for t in tasks)
        return any(not retracted(e) for e in flagged)

    # -- retraction --------------------------------------------------------------------------------------------------
    def retraction(self, text: str):
        tasks = soql(self.ctx, "SELECT Id, Subject, Description, Status, WhoId, CreatedDate FROM Task "
                               "WHERE Status = 'Not Started'")
        tasks = [t for t in tasks if (t.get("Subject") or "").startswith(PREFIX)]
        contacts = {c["Id"]: c for c in soql(self.ctx, "SELECT Id, FirstName, LastName, Email FROM Contact")}
        low = text.lower()

        def names_person(c):
            full = f"{c.get('FirstName') or ''} {c.get('LastName') or ''}".strip().lower()
            return bool(full) and re.search(r"(?<![a-z])" + re.escape(full) + r"(?![a-z])", low) is not None \
                or (c.get("Email") or "").lower() in low
        hits = [t for t in tasks if t.get("WhoId") in contacts and names_person(contacts[t["WhoId"]])
                and t["Subject"][len(PREFIX):].strip().lower() in low]
        if not hits:
            return self.escalate("retraction: cannot identify the open follow-up task")
        t = max(hits, key=lambda x: str(x.get("CreatedDate")))
        # AutomationBench's generic sobject PATCH takes the model's field names (status, description)
        self.ctx.fetch("PATCH", SF + f"sobjects/Task/{t['Id']}",
                       body={"status": "Completed", "description": (t.get("Description") or "") + RETRACT_SUFFIX})
        return "retracted"

    # -- week close --------------------------------------------------------------------------------------------------
    def week_count(self) -> int:
        monday = (self.at - timedelta(days=self.at.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        tasks = soql(self.ctx, "SELECT Id, Subject, Description, CreatedDate FROM Task")
        return sum(1 for t in tasks if (t.get("Subject") or "").startswith(PREFIX)
                   and t.get("CreatedDate") and parse_dt(t["CreatedDate"]) >= monday
                   and "retracted" not in (t.get("Description") or "").lower())

    def week_close(self):
        n = self.week_count()
        self.ctx.fetch("POST", SLACK + "chat.postMessage", body={"channel": "sales-alerts", "text": f"No-shows this week: {n}"})
        return "posted"


def handle(trigger: dict, ctx):
    return NoShowWorkflow(trigger, ctx).run()


if __name__ == "__main__":
    print(json.dumps({"module": "reference", "entry": "handle(trigger, ctx)"}))
