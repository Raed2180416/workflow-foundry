"""abr-hr-inbox reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch -> AutomationBench's api_fetch on the simulated Gmail, Google Sheets and Slack). It never imports the
generator or the oracle and keeps no private state: the Routing Rules, the Employee Directory, the Grievance Tracker,
the Policy Log and the HR inbox's Sent mail are the state of record, read back on every trigger.

`Inbox` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
Entry point: handle(trigger, ctx).
"""
from __future__ import annotations

import base64
import json
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/"
SLACK = "https://slack.com/api/"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/"
SS = "ss_hr_ops"
WS_RULES, WS_DIR, WS_GRIEV, WS_POLICY = "ws_routing_rules", "ws_directory", "ws_grievances", "ws_policy_log"
ORG_DOMAIN = "@company.example.com"
HR_DIRECTOR = "hr-director@company.example.com"
HR_BP = "hr-bp@company.example.com"
LEGAL = "legal@company.example.com"
HR_OPS = "hr-ops@company.example.com"
SECURITY_TEAM = "security-team@company.example.com"
REVIEW = "automation-review"
PAYROLL, DISCRIMINATION = "Payroll", "Discrimination"
PAYROLL_PARAM = "Payroll mailbox"
BANK_MARKERS = ("direct deposit", "bank details", "bank account", "routing number")
SUMMARY_LABELS = ("Benefits", "Address Change", "Payroll", "IT Access", "Leave / PTO", "Security", "Fraud reports", "Grievances")
H_LEGAL, H_HRBP = "Legal and HR Director", "HRBP"
ID_RE = re.compile(r"(?<![A-Za-z0-9])emp[-\s]?(\d{4})(?![0-9])", re.I)


def norm(s) -> str:
    """POLICY section 3: categories, severities and statuses compare ignoring letter case and runs of spaces."""
    return " ".join(str(s or "").split()).lower()


def address(s) -> str:
    """POLICY section 3: the part in angle brackets of a From header, else the whole value; case and spaces ignored."""
    m = re.search(r"<([^<>]+)>\s*$", str(s or ""))
    return (m.group(1) if m else str(s or "")).strip().lower()


def employee_id(line: str) -> str | None:
    m = ID_RE.search(line or "")
    return f"EMP-{m.group(1)}" if m else None


def phrase(k: str) -> re.Pattern:
    """A keyword as a whole word or phrase, ignoring letter case (runs of spaces inside a phrase allowed)."""
    return re.compile(r"(?<![A-Za-z0-9])" + r"\s+".join(re.escape(w) for w in k.split()) + r"(?![A-Za-z0-9])", re.I)


def parse_time(s) -> datetime:
    dt = datetime.fromisoformat(str(s).strip().replace("Z", "+00:00").replace(" ", "T", 1))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class Inbox:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx
        self.at = parse_time(trigger.get("at"))

    # -- tools ----------------------------------------------------------------------------------------------------------
    def call(self, method: str, url: str, params=None, body=None):
        out = self.ctx.fetch_json(method, url, params, body)
        if isinstance(out, dict) and (out.get("error") or out.get("ok") is False):
            raise RuntimeError(f"{method} {url}: {out}")
        return out

    def calls(self, specs: list[tuple]) -> list:
        """One step: several calls at once (as parallel tool calls in one model response)."""
        if not specs:
            return []
        outs = self.ctx.batch([{"name": "api_fetch", "arguments": self.ctx.fetch_args(*s)} for s in specs])
        res = []
        for s, o in zip(specs, outs):
            v = json.loads(o)
            if isinstance(v, dict) and (v.get("error") or v.get("ok") is False):
                raise RuntimeError(f"{s[0]} {s[1]}: {v}")
            res.append(v)
        return res

    @staticmethod
    def rows_of(values_out: dict) -> list[tuple[int, dict]]:
        """(A1 row number, cells) for every data row, in sheet order; the header is row 1."""
        values = values_out.get("values") or []
        if not values:
            return []
        hdr = values[0]
        return [(i + 2, dict(zip(hdr, [str(v) for v in row] + [""] * (len(hdr) - len(row))))) for i, row in enumerate(values[1:])]

    def read(self, *worksheets: str) -> dict:
        """Several worksheets in one step."""
        outs = self.calls([("GET", f"{SHEETS}{SS}/values/{quote(ws)}") for ws in worksheets])
        return {ws: self.rows_of(v) for ws, v in zip(worksheets, outs)}

    @staticmethod
    def send_spec(to: list[str], subject: str, body: str) -> tuple:
        raw = f"To: {', '.join(to)}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        return ("POST", GMAIL + "messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})

    def post_spec(self, channel: str, text: str) -> tuple:
        return ("POST", SLACK + "chat.postMessage", None, {"channel": channel, "text": text})

    def escalate(self, reason: str):
        """POLICY section 9: the trigger id and a reason in #automation-review, nothing else (never a Case ID)."""
        self.calls([self.post_spec(REVIEW, f"{self.t['trigger']}: {reason}")])

    # -- entry ----------------------------------------------------------------------------------------------------------
    def run(self):
        app, ev, d = self.t.get("app"), self.t.get("event"), self.t.get("data") or {}
        if app == "gmail" and ev == "new_email":
            return self.on_email(d["message_id"])
        if app == "google_sheets" and ev == "new_row" and norm(d.get("worksheet")) in ("grievance tracker", WS_GRIEV):
            return self.on_grievance(int(d["row_id"]))
        if app == "schedule" and ev == "week_close":
            return self.week_close(d["date"])
        return None

    # -- section 4 ---------------------------------------------------------------------------------------------------------
    def on_email(self, message_id: str):
        m = self.call("GET", GMAIL + f"messages/{message_id}")
        subject = str(m.get("subject") or "")
        body = str(m.get("body_plain") or "") or re.sub(r"<[^>]+>", " ", str(m.get("body_html") or ""))
        sender = address(m.get("from"))
        if norm(subject).startswith("hr routing amendment"):
            return self.on_amendment(sender, body)
        if self.is_auto_reply(subject):
            return None
        return self.on_request(sender, subject, body)

    def is_auto_reply(self, subject: str) -> bool:
        s = norm(subject)
        return s.startswith("automatic reply") or s.startswith("out of office")

    # -- section 5 ---------------------------------------------------------------------------------------------------------
    def split(self, body: str) -> tuple[list[str], str | None]:
        """(lines above the sign-off, the named Employee ID)."""
        lines = body.splitlines()
        for i, ln in enumerate(lines):
            eid = employee_id(ln)
            if eid:
                return lines[:i], eid
        return lines, None

    def request_text(self, subject: str, body: str) -> str:
        above, _ = self.split(body)
        return "\n".join([subject] + [ln for ln in above if not ln.lstrip().startswith(">")])

    def named_employee(self, body: str, directory: list[tuple[int, dict]]) -> dict | None:
        _, eid = self.split(body)
        if eid is None:
            return None
        return next((c for _, c in directory if employee_id(c.get("Employee ID")) == eid), None)

    def is_bank_change(self, text: str) -> bool:
        return any(phrase(k).search(text) for k in BANK_MARKERS)

    def same_sender(self, sender: str, emp: dict) -> bool:
        return sender == address(emp.get("Email"))

    def category(self, text: str, rules: list[tuple[int, dict]]) -> str | None:
        """Section 5 'Classifying': the matching rows; several -> shortest SLA, then the row nearer the top."""
        hits = []
        for k, (_, c) in enumerate(rules):
            kws = [x.strip() for x in str(c.get("Keywords") or "").split(",") if x.strip()]
            if any(phrase(x).search(text) for x in kws):
                m = re.search(r"\d+(?:\.\d+)?", str(c.get("SLA") or ""))
                hours = float(m.group(0)) if m else float("inf")
                if "day" in norm(c.get("SLA")):
                    hours *= 24
                hits.append((hours, k, c["Category"]))
        return min(hits)[2] if hits else None

    def mailbox(self, cat: str, rules: list[tuple[int, dict]], policy: list[tuple[int, dict]]) -> str:
        row = next(c for _, c in rules if norm(c["Category"]) == norm(cat))
        if norm(cat) == norm(PAYROLL):
            return self.payroll_mailbox(policy, address(row["Route To"]))
        return address(row["Route To"])

    def payroll_mailbox(self, policy: list[tuple[int, dict]], default: str) -> str:
        """Section 7: the HR Director's latest Payroll mailbox row effective by now."""
        best = None
        for _, c in policy:
            if norm(c.get("Parameter")) != norm(PAYROLL_PARAM) or address(c.get("Approved by")) != HR_DIRECTOR:
                continue
            try:
                eff = parse_time(c.get("Effective"))
            except ValueError:
                continue
            if eff <= self.at and (best is None or eff >= best[0]):
                best = (eff, address(c.get("Value")))
        return best[1] if best else default

    def on_request(self, sender: str, subject: str, body: str):
        s = self.read(WS_RULES, WS_DIR, WS_POLICY)
        emp = self.named_employee(body, s[WS_DIR])
        if emp is None:
            return self.escalate("request with no Employee ID from the Employee Directory")
        text = self.request_text(subject, body)
        if self.is_bank_change(text) and not self.same_sender(sender, emp):
            return self.fraud_report(sender, subject, emp)
        if not self.same_sender(sender, emp):
            return self.escalate("the sender is not the named employee")
        cat = self.category(text, s[WS_RULES])
        if cat is None:
            return self.escalate("no Routing Rules category matches the request")
        return self.route(sender, subject, text, emp, cat, self.mailbox(cat, s[WS_RULES], s[WS_POLICY]))

    def fraud_report(self, sender: str, subject: str, emp: dict):
        body = (f"A request to change bank or direct-deposit details arrived from {sender}, which is not the address of "
                f"the employee it names ({employee_id(emp['Employee ID'])}).\n\nOriginal subject: {subject}")
        self.calls([self.send_spec([SECURITY_TEAM], f"Possible fraud: {subject}", body)])

    def route(self, sender: str, subject: str, text: str, emp: dict, cat: str, mailbox: str):
        eid = employee_id(emp["Employee ID"])
        fwd = (f"Employee: {emp['Name']} ({eid})\nCategory: {cat}\n\nOriginal subject: {subject}\n\n"
               + "\n".join(text.splitlines()[1:]).strip())
        ack = f"Hello,\n\nYour request has been routed to {cat}.\n\nHR Operations"
        self.calls([self.send_spec([mailbox], f"HR request {eid}: {cat}", fwd),
                    self.send_spec([sender], f"Re: {subject}", ack)])

    # -- section 6 ---------------------------------------------------------------------------------------------------------
    def first_named(self, description: str, directory: list[tuple[int, dict]]) -> dict | None:
        best = None
        for _, c in directory:
            name = " ".join(str(c.get("Name") or "").split())
            if not name:
                continue
            m = re.search(r"(?<![A-Za-z])" + r"\s+".join(re.escape(w) for w in name.split()) + r"(?![A-Za-z])", description or "")
            if m and (best is None or m.start() < best[0] or (m.start() == best[0] and len(name) > best[2])):
                best = (m.start(), c, len(name))
        return best[1] if best else None

    def about_manager(self, cells: dict, emp: dict, directory) -> bool:
        first = self.first_named(cells.get("Description"), directory)
        return first is not None and address(first.get("Email")) == address(emp.get("Manager Email"))

    def handler(self, cells: dict, emp: dict, directory) -> tuple[str, list[str]] | None:
        """Section 6 rules 1-6; None means escalate."""
        sev = norm(cells.get("Severity"))
        if norm(cells.get("Category")) == norm(DISCRIMINATION):
            return H_LEGAL, [LEGAL, HR_DIRECTOR]
        if sev == "level 3":
            return H_LEGAL, [LEGAL, HR_DIRECTOR]
        if sev not in ("level 1", "level 2"):
            return None
        if sev == "level 2":
            return H_HRBP, [HR_BP]
        if self.about_manager(cells, emp, directory):
            return H_HRBP, [HR_BP]
        return self.direct_manager(cells, emp)

    def direct_manager(self, cells: dict, emp: dict) -> tuple[str, list[str]]:
        return " ".join(str(emp["Manager"]).split()), [address(emp["Manager Email"])]

    def on_grievance(self, row_id: int):
        s = self.read(WS_GRIEV, WS_DIR)
        cells = next((c for n, c in s[WS_GRIEV] if n == row_id), None)
        if cells is None:
            return self.escalate(f"Grievance Tracker row {row_id} not found")
        eid = employee_id(cells.get("Employee ID"))
        emp = next((c for _, c in s[WS_DIR] if employee_id(c.get("Employee ID")) == eid), None)
        if emp is None:
            return self.escalate(f"grievance at Grievance Tracker row {row_id}: employee not in the Employee Directory")
        h = self.handler(cells, emp, s[WS_DIR])
        if h is None:
            return self.escalate(f"grievance at Grievance Tracker row {row_id} has no usable Severity")
        name, to = h
        cid = str(cells.get("Case ID")).strip()
        body = (f"Case {cid}\nEmployee: {emp['Name']}\nCategory: {cells.get('Category')}\nSeverity: {cells.get('Severity')}\n\n"
                f"{cells.get('Description')}")
        self.calls([self.send_spec(to, f"Grievance {cid}", body),
                    ("PUT", f"{SHEETS}{SS}/values/{WS_GRIEV}/rows/{row_id}", None, {"cells": {"Status": f"Routed to {name}"}})])

    # -- section 7 ---------------------------------------------------------------------------------------------------------
    def authorized(self, sender: str) -> bool:
        return sender == HR_DIRECTOR

    def on_amendment(self, sender: str, body: str):
        if not self.authorized(sender):
            return None
        m = re.search(r"(?im)^\s*value\s*:\s*(\S+)\s*$", body)
        p = re.search(r"(?im)^\s*parameter\s*:\s*(.+?)\s*$", body)
        if m is None or (p is not None and norm(p.group(1)) != norm(PAYROLL_PARAM)):
            return self.escalate("an HR Director amendment without a Payroll mailbox value")
        row = [self.t["at"], PAYROLL_PARAM, address(m.group(1)), HR_DIRECTOR]
        self.calls([("POST", f"{SHEETS}{SS}/values/{WS_POLICY}:append", {"valueInputOption": "RAW"}, {"values": [row]})])

    # -- section 8 ---------------------------------------------------------------------------------------------------------
    def week_start(self) -> datetime:
        d = self.at.date()
        return datetime.combine(d - timedelta(days=d.weekday()), datetime.min.time(), tzinfo=timezone.utc)

    def sent_this_week(self) -> list[dict]:
        lst = self.call("GET", GMAIL + "messages", {"labelIds": "SENT", "maxResults": 500})
        ids = [m["id"] for m in lst.get("messages") or []]
        msgs = self.calls([("GET", GMAIL + f"messages/{i}") for i in ids])
        start = int(self.week_start().timestamp() * 1000)
        return [m for m in msgs if int(m.get("date") or 0) >= start]

    def counts(self, sent: list[dict], griev: list[tuple[int, dict]], cats: list[str]) -> dict:
        out = {k: 0 for k in SUMMARY_LABELS}
        pat = re.compile(r"^\s*hr request\s+emp-\d{4}\s*:\s*(.+?)\s*$", re.I)
        for m in sent:
            subj = str(m.get("subject") or "")
            mm = pat.match(subj)
            if mm:
                cat = next((c for c in cats if norm(c) == norm(mm.group(1))), None)
                if cat in out:
                    out[cat] += 1
            elif norm(subj).startswith("possible fraud"):
                out["Fraud reports"] += 1
        start = self.week_start().date()
        for _, c in griev:
            try:
                filed = date.fromisoformat(str(c.get("Filed")).strip()[:10])
            except ValueError:
                continue
            if start <= filed <= self.at.date() and norm(c.get("Status")).startswith("routed to"):
                out["Grievances"] += 1
        return out

    def week_close(self, day: str):
        sent = self.sent_this_week()
        s = self.read(WS_GRIEV, WS_RULES)
        out = self.counts(sent, s[WS_GRIEV], [c["Category"] for _, c in s[WS_RULES]])
        body = "\n".join(f"{k}: {out[k]}" for k in SUMMARY_LABELS)
        self.calls([self.send_spec([HR_OPS], f"HR inbox week {day}", body)])


def handle(trigger: dict, ctx):
    return Inbox(trigger, ctx).run()
