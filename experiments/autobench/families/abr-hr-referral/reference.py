"""abr-hr-referral reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch -> AutomationBench's api_fetch on the simulated Google Sheets, Gmail and Slack). It never imports the
generator or the oracle and keeps no private state: the Referral Log (Status, Hold, Bonus, Paid On), Employees and the
#vp-people history are the state of record, read back on every trigger.

`Referral` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
Entry point: handle(trigger, ctx).
"""
from __future__ import annotations

import base64
import json
import re
from datetime import date, timedelta
from urllib.parse import quote

SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/"
SLACK = "https://slack.com/api/"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/"
SS, WS_LOG, WS_EMP = "ss_referral", "ws_referrals", "ws_employees"
LOG, EMPLOYEES = "referral log", "employees"
VP_ID, VP_CHANNEL = "U0VPPEOPLE", "vp-people"
PAYROLL = "payroll@company.example.com"
CAP = 10000
PENDING, PNYE, ELIGIBLE, PAID = "Pending", "Pending - Not Yet Eligible", "Eligible", "Paid"
DUPLICATE, REHIRE, VOIDED, CAPPED = "Duplicate referral", "Ineligible - Rehire", "Voided", "Capped"
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
REF_ID = re.compile(r"\bREF-\d+\b")


def norm(s) -> str:
    return " ".join(str(s or "").split()).lower()


def ident(s) -> str:
    """Candidate Email / Employee ID comparison (POLICY section 2): ignoring letter case and surrounding spaces."""
    return str(s or "").strip().lower()


def to_date(s) -> date:
    """POLICY section 2 date forms; raises LookupError (-> escalate) on anything else."""
    t = " ".join(str(s or "").split())
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", t)
    if m:                                                    # month first
        return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    m = re.fullmatch(r"([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}), (\d{4})", t)
    if m and m.group(1).lower() in MONTHS:
        return date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))
    m = re.fullmatch(r"(\d{1,2}) ([A-Za-z]{3})[A-Za-z]* (\d{4})", t)
    if m and m.group(2).lower() in MONTHS:
        return date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    raise LookupError(f"cannot read the date {s!r}")


def dollars(n: int) -> str:
    return f"${n:,}"


def amount_of(s) -> int:
    digits = re.sub(r"[^\d]", "", str(s or "").split(".")[0])
    return int(digits) if digits else 0


class Referral:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx

    # -- tools ----------------------------------------------------------------------------------------------------------
    def call(self, method: str, url: str, params=None, body=None):
        out = self.ctx.fetch_json(method, url, params, body)
        if isinstance(out, dict) and (out.get("error") or out.get("ok") is False):
            raise RuntimeError(f"{method} {url}: {out}")
        return out

    def sheet(self, ws: str) -> list[tuple[int, dict]]:
        """(A1 row number, cells) for every data row, in sheet order; the header is row 1."""
        out = self.call("GET", f"{SHEETS}{SS}/values/{quote(ws)}")
        values = out.get("values") or []
        if not values:
            return []
        hdr = values[0]
        return [(i + 2, dict(zip(hdr, [str(v) for v in row] + [""] * (len(hdr) - len(row))))) for i, row in enumerate(values[1:])]

    def set_cells(self, row_no: int, cells: dict):
        self.call("PUT", f"{SHEETS}{SS}/values/{WS_LOG}/rows/{row_no}", None, {"cells": cells})

    def send(self, to: str, subject: str, body: str):
        raw = f"To: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        self.call("POST", GMAIL + "messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})

    # -- entry ----------------------------------------------------------------------------------------------------------
    def run(self):
        app, ev, d = self.t.get("app"), self.t.get("event"), self.t.get("data") or {}
        if app == "schedule" and ev == "payout_run":
            return self.payout(to_date(d["date"]))
        if app == "slack" and ev == "new_message":
            return self.on_message(d.get("channel"), d.get("ts"))
        if app == "gmail":
            return self.on_email(d)
        if app != "google_sheets" or d.get("spreadsheet_id", SS) != SS:
            return None
        ws = norm(d.get("worksheet"))
        if ev == "new_row" and ws in (LOG, WS_LOG):
            return self.on_submitted(int(d["row_id"]))
        if ev == "row_updated" and ws in (LOG, WS_LOG) and "Hire Date" in (d.get("changed") or []):
            return self.on_hired(int(d["row_id"]))
        if ev == "row_updated" and ws in (EMPLOYEES, WS_EMP):
            return self.on_employee_changed(int(d["row_id"]))
        return None

    def on_email(self, data: dict):                                  # section 8: emails ask for nothing
        return None

    # -- section 3: a new referral --------------------------------------------------------------------------------------
    def on_submitted(self, row_no: int):
        log = self.sheet(WS_LOG)
        row = dict(log).get(row_no)
        if row is None:
            raise LookupError(f"no Referral Log row {row_no}")
        if row.get("Status", "").strip():
            return None                                              # already handled (a repeated event)
        self.set_cells(row_no, {"Status": DUPLICATE if self.is_duplicate(row_no, row, log) else PENDING})

    def is_duplicate(self, row_no: int, row: dict, log) -> bool:
        return any(n < row_no and self.same_candidate(c, row) for n, c in log)

    def same_candidate(self, a: dict, b: dict) -> bool:
        return ident(a.get("Candidate Email")) == ident(b.get("Candidate Email"))

    # -- section 4: a hire ----------------------------------------------------------------------------------------------
    def on_hired(self, row_no: int):
        row = dict(self.sheet(WS_LOG)).get(row_no)
        if row is None:
            raise LookupError(f"no Referral Log row {row_no}")
        if self.hire_ignored(row):
            return None
        hire = self.hire_date(row)
        rehire = self.is_rehire(row, hire, [c for _, c in self.sheet(WS_EMP)])
        self.set_cells(row_no, {"Status": REHIRE if rehire else PNYE})

    def hire_ignored(self, row: dict) -> bool:                       # section 4.1
        return norm(row.get("Status")) == norm(DUPLICATE)

    def hire_date(self, row: dict) -> date:
        return to_date(row.get("Hire Date"))

    def is_rehire(self, row: dict, hire: date, emps: list[dict]) -> bool:
        try:
            a_year_before = hire.replace(year=hire.year - 1)
        except ValueError:
            a_year_before = hire.replace(year=hire.year - 1, day=28)
        for e in emps:
            if ident(e.get("Personal Email")) != ident(row.get("Candidate Email")):
                continue
            if ident(e.get("Employee ID")) == ident(row.get("Employee ID")) or norm(e.get("Status")) != "left":
                continue
            if to_date(e.get("Left Date")) >= a_year_before:
                return True
        return False

    # -- section 5: someone leaves --------------------------------------------------------------------------------------
    def on_employee_changed(self, row_no: int):
        emp = dict(self.sheet(WS_EMP)).get(row_no)
        if emp is None or norm(emp.get("Status")) != "left":
            return None
        left = to_date(emp.get("Left Date"))
        for n, c in self.sheet(WS_LOG):
            if self.referral_of(c, emp) and norm(c.get("Status")) in (norm(PNYE), norm(ELIGIBLE)):
                if left < self.hire_date(c) + timedelta(days=90):
                    self.set_cells(n, {"Status": VOIDED})

    def referral_of(self, row: dict, emp: dict) -> bool:
        return bool(ident(row.get("Employee ID"))) and ident(row.get("Employee ID")) == ident(emp.get("Employee ID"))

    # -- section 6: holds -----------------------------------------------------------------------------------------------
    def on_message(self, channel: str, ts: str):
        if norm(channel) != VP_CHANNEL:
            return None
        hist = self.call("GET", SLACK + "conversations.history", {"channel": VP_CHANNEL, "limit": 1000})
        msg = next((m for m in hist.get("messages", []) if m.get("ts") == ts), None)
        if msg is None:
            raise LookupError(f"message {ts} not found in #{VP_CHANNEL}")
        command = self.hold_command(msg)
        if command is None:
            return None
        value = "Yes" if command == "hold" else ""
        ids = REF_ID.findall(msg.get("text") or "")
        for n, c in self.sheet(WS_LOG):
            if c.get("Referral ID", "").strip() in ids and c.get("Hold", "").strip() != value:
                self.set_cells(n, {"Hold": value})

    def hold_command(self, msg: dict) -> str | None:
        if msg.get("user") != VP_ID:
            return None
        m = re.match(r"\s*(hold|release)\b", msg.get("text") or "", re.I)
        return m.group(1).lower() if m else None

    # -- section 7: payout run ------------------------------------------------------------------------------------------
    def payout(self, run: date):
        self.decisions = self.decide(run)
        for n, c, action, amount in self.decisions:
            if action == "cap":
                self.set_cells(n, {"Status": CAPPED})
            else:
                self.pay(n, c, amount, run)

    def decide(self, run: date) -> list[tuple[int, dict, str, int]]:
        """[(row number, cells, 'pay' | 'cap', amount)] in row order; reads the sheets, writes nothing."""
        log = self.sheet(WS_LOG)
        emps = {ident(e.get("Employee ID")): e for _, e in self.sheet(WS_EMP)}
        totals = self.year_totals(log, run)
        out = []
        for n, c in log:
            if not self.eligible(c, emps, run):
                continue
            amount = self.amount(c)
            key = self.referrer_key(c)
            if self.over_cap(totals.get(key, 0), amount):
                out.append((n, c, "cap", amount))
                continue
            out.append((n, c, "pay", amount))
            totals[key] = totals.get(key, 0) + amount
        return out

    def referrer_key(self, c: dict) -> str:
        return ident(c.get("Referrer Email"))

    def year_totals(self, log, run: date) -> dict:
        totals: dict[str, int] = {}
        for _, c in log:
            if norm(c.get("Status")) != "paid" or not c.get("Paid On", "").strip():
                continue
            if self.counts_this_year(to_date(c["Paid On"]), run):
                k = self.referrer_key(c)
                totals[k] = totals.get(k, 0) + amount_of(c.get("Bonus"))
        return totals

    def counts_this_year(self, paid_on: date, run: date) -> bool:
        return paid_on.year == run.year

    def over_cap(self, total: int, amount: int) -> bool:
        return total + amount > CAP

    def eligible(self, c: dict, emps: dict, run: date) -> bool:
        if norm(c.get("Status")) not in (norm(PNYE), norm(ELIGIBLE)):
            return False
        if self.already_paid(c) or self.on_hold(c):
            return False
        emp = self.employee(c, emps)
        if emp is None or norm(emp.get("Status")) != "active":
            return False
        return self.due(c, run)

    def already_paid(self, c: dict) -> bool:
        return bool(c.get("Paid On", "").strip()) or "paid out" in norm(c.get("Notes"))

    def on_hold(self, c: dict) -> bool:
        return bool(c.get("Hold", "").strip())

    def employee(self, c: dict, emps: dict) -> dict | None:
        """Section 7, condition 4: no Employees row with that Employee ID -> not eligible (None)."""
        return emps.get(ident(c.get("Employee ID")))

    def due(self, c: dict, run: date) -> bool:
        return run >= self.hire_date(c) + timedelta(days=90)

    def amount(self, c: dict) -> int:
        level = re.sub(r"\s+", "", c.get("Role Level", "")).upper()
        m = re.fullmatch(r"(IC|M)(\d+)", level)
        if not m:
            raise LookupError(f"{c.get('Referral ID')}: unknown Role Level {c.get('Role Level')!r}")
        if m.group(1) == "M":
            return 5000
        return {1: 2000, 2: 2000, 3: 3500, 4: 3500}[int(m.group(2))]

    def pay(self, row_no: int, c: dict, amount: int, run: date):
        rid, cand = c["Referral ID"].strip(), c["Candidate"].strip()
        self.send(PAYROLL, f"Referral bonus payout: {rid}", self.payroll_body(c, amount))
        self.send(c["Referrer Email"].strip(), f"Your referral bonus for {cand}", self.referrer_body(c, amount))
        self.set_cells(row_no, {"Status": PAID, "Bonus": dollars(amount), "Paid On": run.isoformat()})

    def payroll_body(self, c: dict, amount: int) -> str:              # section 7: these facts, nothing else
        return (f"Referral bonus payout {c['Referral ID'].strip()}\n\nReferrer: {c['Referrer'].strip()} "
                f"({c['Referrer Email'].strip()})\nReferred employee: {c['Candidate'].strip()} ({c['Employee ID'].strip()})\n"
                f"Level: {c['Role Level'].strip()}\nAmount: {dollars(amount)}\n\nPlease include it in the next payroll.")

    def referrer_body(self, c: dict, amount: int) -> str:             # the amount; nobody else's referral
        return (f"Hi {c['Referrer'].strip().split()[0]},\n\nThank you for referring {c['Candidate'].strip()}. Your referral "
                f"bonus of {dollars(amount)} will be included in your next payroll.\n\nPeople Operations")


def handle(trigger: dict, ctx):
    try:
        return Referral(trigger, ctx).run()
    except LookupError as e:                                     # section 8: cannot decide -> escalate, nothing else
        ctx.fetch("POST", SLACK + "chat.postMessage", None,
                  {"channel": "automation-review", "text": f"{trigger.get('trigger')}: {e}"})
        return None


if __name__ == "__main__":
    print(json.dumps({"entry": "handle(trigger, ctx)"}))
