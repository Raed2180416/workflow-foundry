"""abr-ops-slawatch reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch -> AutomationBench's api_fetch on the simulated apps). It never imports the generator, lib.py or the oracle,
and it keeps no private state: every cross-trigger fact (what was warned, for which deadline and to whom, what was
breached, the warning window in force) is read back from the tracker and the Policy Log, which are the state of record.

The hourly check costs three tool steps: one batched read (tracker, SLA Config, Policy Log), one batched lookup of the
rows it will write (row ids), and one batched write of every effect. Quiet checks cost one step.

`SlaWatch` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
"""
from __future__ import annotations

import base64
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

UTC = timezone.utc
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
TWILIO = "https://api.twilio.com/2010-04-01/Accounts/ACslawatch/Messages.json"
SLACK = "https://slack.com/api/chat.postMessage"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
JIRA = "https://company.atlassian.net/rest/api/3/issue"

TICKETS = ("sheet-support-tickets", "Open Tickets")
CONFIG = ("sheet-support-tickets", "SLA Config")
POLICY_LOG = ("sheet-sla-policy", "Policy Log")
MANAGER = "support-manager@company.example.com"
SMS_FROM = "+15550001111"
ESCALATION, REVIEW = "support-escalation", "automation-review"
PROJECT = "SUPPORT"
PARAM = "warning window"
MONITORED = ("open", "in progress")
LGL = re.compile(r"LGL-\d", re.I)


class Undecidable(Exception):
    pass


def parse_time(s) -> datetime | None:
    t = str(s or "").strip()
    if not t:
        return None
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(?:UTC|GMT)$", t, re.I)
    if m:
        t = f"{m.group(1)}T{m.group(2)}+00:00"
    if t[-1:] in ("Z", "z"):
        t = t[:-1] + "+00:00"
    if "T" not in t:
        return None
    try:
        dt = datetime.fromisoformat(t)
    except ValueError:
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def zulu(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def e164(phone) -> str | None:
    d = re.sub(r"\D", "", str(phone or ""))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return "+1" + d if len(d) == 10 else None


def same(a, b) -> bool:
    return " ".join(str(a or "").split()).lower() == " ".join(str(b or "").split()).lower()


def values_url(ref: tuple[str, str]) -> str:
    return f"{SHEETS}/{ref[0]}/values/{quote(ref[1])}"


def table(resp: dict) -> list[dict]:
    vals = resp.get("values") or []
    if not vals:
        return []
    hdr = [str(h) for h in vals[0]]
    return [dict(zip(hdr, [str(v) for v in row] + [""] * (len(hdr) - len(row)))) for row in vals[1:]]


class SlaWatch:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx
        self.now = parse_time(trigger.get("at"))
        self.writes: list[tuple] = []          # (method, url, params, body)
        self.row_updates: list[tuple[dict, dict]] = []   # (tracker row as read, cells to write)
        self.escalations: list[str] = []

    # -- entry -------------------------------------------------------------------------------------------------------
    def run(self):
        app, ev = self.t.get("app"), self.t.get("event")
        if app == "schedule" and ev == "hourly_check":
            return self.hourly_check()
        if app == "gmail" and ev == "new_email":
            return self.amendment()
        return self.ticket_event()

    def ticket_event(self):
        """new_row / updated_row: no effect of their own (section 5); the next hourly check applies the rules."""
        return None

    # -- reads -------------------------------------------------------------------------------------------------------
    def read_all(self) -> tuple[list[dict], dict, list[dict]]:
        tickets, config, policy = self.ctx.fetch_many([("GET", values_url(TICKETS)), ("GET", values_url(CONFIG)),
                                                      ("GET", values_url(POLICY_LOG))])
        for name, r in (("Open Tickets", tickets), ("SLA Config", config), ("Policy Log", policy)):
            if not isinstance(r, dict) or "values" not in r:
                raise RuntimeError(f"could not read {name}: {str(r)[:200]}")
        cfg = {" ".join(r.get("Setting", "").split()): r.get("Value", "").strip() for r in table(config)}
        return table(tickets), cfg, table(policy)

    def manager(self, cfg: dict) -> str:
        m = cfg.get("Support Manager Email", "").strip().lower()
        if not m:
            raise Undecidable("SLA Config has no Support Manager Email")
        return m

    def window(self, policy: list[dict]) -> int:
        """Newest Policy Log row for the warning window with Effective <= the check's date; later row wins a tie."""
        today = self.now.date().isoformat()
        best = None
        for i, r in enumerate(policy):
            eff = r.get("Effective", "").strip()[:10]
            if same(r.get("Parameter"), PARAM) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", eff) and eff <= today:
                if best is None or (eff, i) >= (best[0], best[1]):
                    best = (eff, i, r.get("Value", ""))
        if best is None or not re.sub(r"\D", "", best[2]):
            raise Undecidable("no warning window in force in the Policy Log")
        return int(re.sub(r"\D", "", best[2]))

    # -- rules (one method per policy clause) ------------------------------------------------------------------------
    def monitored(self, row: dict) -> bool:
        return same(row.get("Status"), "open") or same(row.get("Status"), "in progress")

    def held(self, row: dict) -> bool:
        return LGL.search(row.get("Notes", "")) is not None

    def deadline(self, row: dict) -> datetime | None:
        return parse_time(row.get("SLA Deadline"))

    def phone(self, row: dict) -> str | None:
        return e164(row.get("Agent Phone"))

    def breached(self, row: dict) -> bool:
        return bool(row.get("Breached At", "").strip())

    def is_due(self, D: datetime) -> bool:
        return D <= self.now

    def in_window(self, D: datetime, W: int) -> bool:
        return timedelta(0) < D - self.now <= timedelta(minutes=W)

    def warned_for(self, row: dict, D: datetime) -> bool:
        return bool(row.get("Warned At", "").strip()) and parse_time(row.get("Warned Deadline")) == D

    def reassigned(self, row: dict) -> bool:
        return not same(row.get("Assigned Agent"), row.get("Warned Agent"))

    def decide(self, row: dict, W: int) -> str | None:
        """Section 4, first matching rule: 'breach', 'warn', 'reassign' or None."""
        if not self.monitored(row) or self.held(row):
            return None
        D = self.deadline(row)
        if D is None:
            raise Undecidable(f"{row.get('Ticket ID')}: SLA Deadline {row.get('SLA Deadline')!r} cannot be read")
        if self.is_due(D):
            return None if self.breached(row) else "breach"
        if self.in_window(D, W) and not self.warned_for(row, D):
            return "warn"
        if self.warned_for(row, D) and D > self.now and self.reassigned(row):
            return "reassign"
        return None

    # -- effects -------------------------------------------------------------------------------------------------------
    def sms(self, to: str, tid: str, D: datetime):
        self.writes.append(("POST", TWILIO, None, {"To": to, "From": SMS_FROM, "Body": f"SLA warning {tid}: due {D:%H:%M} UTC"}))

    def post(self, channel: str, text: str):
        self.writes.append(("POST", SLACK, None, {"channel": channel, "text": text}))

    def send_email(self, to: str, subject: str, body: str):
        raw = f"To: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        self.writes.append(("POST", f"{GMAIL}/messages/send", None,
                            {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")}))

    def line(self, row: dict, D: datetime) -> str:
        return f"{row['Ticket ID'].strip()} | {row.get('Subject', '').strip()} | due {D:%H:%M} UTC | {row.get('Assigned Agent', '').strip()}"

    def warn(self, row: dict, D: datetime, manager: str):
        tid, to = row["Ticket ID"].strip(), self.phone(row)
        if to is None:
            raise Undecidable(f"{tid}: Agent Phone {row.get('Agent Phone')!r} cannot be read")
        line = self.line(row, D)
        self.sms(to, tid, D)
        self.post(ESCALATION, line)
        self.send_email(manager, f"SLA warning {tid}",
                   f"Hello,\n\nSLA warning for ticket {tid}:\n\n{line}\n\nSLA watch automation\n")
        self.row_updates.append((row, {"Warned At": zulu(self.now), "Warned Agent": row.get("Assigned Agent", "").strip(),
                                       "Warned Deadline": zulu(D)}))

    def reassign(self, row: dict, D: datetime):
        tid, to = row["Ticket ID"].strip(), self.phone(row)
        if to is None:
            raise Undecidable(f"{tid}: Agent Phone {row.get('Agent Phone')!r} cannot be read")
        self.sms(to, tid, D)
        self.row_updates.append((row, {"Warned Agent": row.get("Assigned Agent", "").strip()}))

    def breach(self, row: dict):
        tid = row["Ticket ID"].strip()
        self.writes.append(("POST", JIRA, None, {"fields": {"project": {"key": PROJECT}, "issuetype": {"name": "Task"},
                                                            "summary": f"SLA breach {tid}",
                                                            "description": f"SLA deadline {row.get('SLA Deadline')} passed."}}))
        self.post(ESCALATION, f"BREACHED {tid}")
        self.row_updates.append((row, {"Breached At": zulu(self.now)}))

    # -- the hourly check ----------------------------------------------------------------------------------------------
    def hourly_check(self):
        rows, cfg, policy = self.read_all()
        try:
            W, manager = self.window(policy), self.manager(cfg)
        except Undecidable as e:
            return self.escalate(str(e))
        for row in rows:
            try:
                action = self.decide(row, W)
                if action is None:
                    continue
                D = self.deadline(row)
                if action == "breach":
                    self.breach(row)
                elif action == "warn":
                    self.warn(row, D, manager)
                elif action == "reassign":
                    self.reassign(row, D)
            except Undecidable as e:
                self.escalations.append(str(e))
        self.flush()

    def escalate(self, reason: str):
        self.ctx.fetch("POST", SLACK, body={"channel": REVIEW, "text": f"{self.t.get('trigger')}: {reason}"})

    def flush(self):
        reqs = list(self.writes)
        for reason in self.escalations:
            reqs.append(("POST", SLACK, None, {"channel": REVIEW, "text": f"{self.t.get('trigger')}: {reason}"}))
        if self.row_updates:
            lookups = self.ctx.fetch_many([("GET", f"{values_url(TICKETS)}:lookup",
                                            {"lookupKey": "Ticket ID", "lookupValue": row["Ticket ID"].strip(), "rowCount": 20})
                                           for row, _ in self.row_updates])
            for (row, cells), res in zip(self.row_updates, lookups):
                cands = [x for x in (res.get("rows") or []) if all(str((x.get("cells") or {}).get(k, "")) == v
                                                                    for k, v in row.items() if k in ("Ticket ID", "Status", "SLA Deadline", "Notes"))]
                if len(cands) != 1:
                    raise RuntimeError(f"cannot locate the tracker row of {row['Ticket ID']} ({len(cands)} candidates)")
                # the rows endpoint wants the worksheet id (not its title): take it from the lookup result
                ws = quote(str(cands[0].get("worksheet_id") or TICKETS[1]))
                reqs.append(("PUT", f"{SHEETS}/{TICKETS[0]}/values/{ws}/rows/{cands[0]['row_id']}", None, {"cells": cells}))
        if reqs:
            outs = self.ctx.fetch_many(reqs)
            bad = [o for o in outs if isinstance(o, dict) and (o.get("error") or o.get("ok") is False)]
            if bad:
                raise RuntimeError(f"write failed: {str(bad[0])[:300]}")

    # -- amendments ----------------------------------------------------------------------------------------------------
    def authorized(self, sender: str) -> bool:
        m = re.search(r"<([^>]+)>", sender or "")
        return (m.group(1) if m else (sender or "")).strip().lower() == MANAGER

    def amendment(self):
        data = self.t.get("data") or {}
        msg = self.ctx.fetch_json("GET", f"{GMAIL}/messages/{quote(str(data.get('message_id', '')))}")
        sender = msg.get("from") or data.get("from") or ""
        if not self.authorized(sender):
            return None
        body = msg.get("body_plain") or ""
        found = {k.lower(): v.strip() for k, v in re.findall(r"^\s*(Parameter|New value|Effective)\s*:\s*(.+?)\s*$", body, re.M | re.I)}
        if not found:
            return None                       # not an amendment: nothing to do
        value = re.sub(r"\D", "", found.get("new value", ""))
        eff = found.get("effective", "")
        if not same(found.get("parameter"), PARAM) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", eff) or not value \
                or not 60 <= int(value) <= 180:
            return self.escalate("amendment from the support manager cannot be applied as written")
        self.ctx.fetch("POST", f"{values_url(POLICY_LOG)}:append", params={"valueInputOption": "RAW"},
                       body={"values": [[eff, "Warning window", value, MANAGER]]})
        return None


def handle(trigger: dict, ctx) -> None:
    SlaWatch(trigger, ctx).run()
