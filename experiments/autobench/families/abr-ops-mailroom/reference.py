"""abr-ops-mailroom reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch -> AutomationBench's api_fetch on the simulated apps). It never imports the generator or the oracle, and it
keeps no private state: the package Status column, the Employee Directory and the #mailroom history are the state of
record, read back on every trigger.

`Mailroom` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
Entry point: handle(trigger, ctx).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from urllib.parse import quote

SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/"
SLACK = "https://slack.com/api/"
TWILIO = "https://api.twilio.com/2010-04-01/Accounts/ACmailroom/Messages.json"
SS, WS_PKG, WS_EMP = "ss_mailroom", "ws_packages", "ws_employees"
PACKAGES, DIRECTORY = "incoming packages", "employee directory"
MAILROOM_NUMBER = "+15550100200"
DOCK = "Loading Dock B"
ARROW = "→"
SMS_TYPES = ("refrigerated", "hazardous")
ROUTED, SKIPPED, HELD_LEAVE, HELD_CUSTOMS = "Routed", "Skipped", "Held - On Leave", "Held - Customs"
ROUTING_POST = re.compile(r"^\S+ " + ARROW + " ")


def norm(s) -> str:
    return " ".join(str(s or "").split()).lower()


class Mailroom:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx

    # -- tools ----------------------------------------------------------------------------------------------------------
    def call(self, method: str, url: str, params=None, body=None) -> dict:
        out = self.ctx.fetch_json(method, url, params, body)
        if isinstance(out, dict) and (out.get("error") or out.get("ok") is False):
            raise RuntimeError(f"{method} {url}: {out}")
        return out

    def sheet(self, ws: str) -> list[tuple[int, dict]]:
        """(A1 row number, cells) for every data row. Rows come back in order; the header is row 1."""
        out = self.call("GET", f"{SHEETS}{SS}/values/{quote(ws)}")
        values = out.get("values") or []
        if not values:
            return []
        hdr = values[0]
        rows = [(i + 2, dict(zip(hdr, [str(v) for v in row] + [""] * (len(hdr) - len(row))))) for i, row in enumerate(values[1:])]
        last = re.search(r"(\d+)$", out.get("range", ""))
        if last and rows and int(last.group(1)) != rows[-1][0]:
            raise RuntimeError(f"row numbering does not match the returned range {out.get('range')}")
        return rows

    def set_status(self, row_no: int, status: str):
        self.call("PUT", f"{SHEETS}{SS}/values/{WS_PKG}/rows/{row_no}", None, {"cells": {"Status": status}})

    def post(self, text: str, channel: str = "mailroom"):
        self.call("POST", SLACK + "chat.postMessage", None, {"channel": channel, "text": text})

    def sms(self, to: str, body: str):
        self.call("POST", TWILIO, None, {"To": to, "From": MAILROOM_NUMBER, "Body": body})

    # -- entry ----------------------------------------------------------------------------------------------------------
    def run(self):
        app, ev, d = self.t.get("app"), self.t.get("event"), self.t.get("data") or {}
        if app == "schedule" and ev == "day_close":
            return self.day_close(d["date"])
        if app != "google_sheets" or d.get("spreadsheet_id", SS) != SS:
            return None
        ws = norm(d.get("worksheet"))
        if ev == "new_row" and ws in (PACKAGES, WS_PKG):
            return self.received(int(d["row_id"]))
        if ev == "row_updated" and ws in (PACKAGES, WS_PKG):
            return self.package_changed(int(d["row_id"]))
        if ev == "row_updated" and ws in (DIRECTORY, WS_EMP):
            return self.employee_changed(int(d["row_id"]))
        return None

    # -- rules (one method per policy clause) ---------------------------------------------------------------------------
    def returned(self, pkg: dict) -> bool:                       # section 3 rule 1
        return "returned to sender" in norm(pkg.get("Notes"))

    def customs_hold(self, pkg: dict) -> bool:                   # rule 4
        return "customs hold" in norm(pkg.get("Notes"))

    def recipient(self, pkg: dict, directory: list[tuple[int, dict]]) -> dict | None:   # rule 2
        m = [e for _, e in directory if norm(e.get("Name")) == norm(pkg.get("Recipient Name"))
             and norm(e.get("Department")) == norm(pkg.get("Department"))]
        if len(m) > 1:
            raise LookupError("several directory rows match name and department")
        return m[0] if m else None

    def location(self, pkg: dict, emp: dict) -> str:             # rule 5
        return DOCK if "oversized" in norm(pkg.get("Notes")) else f"Floor {emp['Floor'].strip()}"

    def sms_location(self, pkg: dict, emp: dict) -> str:
        return self.location(pkg, emp)

    def needs_sms(self, pkg: dict) -> bool:
        return norm(pkg.get("Package Type")) in SMS_TYPES

    def decide(self, row_no: int, pkg: dict, directory: list[tuple[int, dict]]):
        """Section 3 on one package; performs the effects."""
        if self.returned(pkg):
            return self.on_returned(row_no, pkg)
        emp = self.recipient(pkg, directory)
        if emp is None or norm(emp.get("Status")) == "terminated":
            return self.set_status(row_no, SKIPPED)
        if norm(emp.get("Status")) == "on leave":
            return self.set_status(row_no, HELD_LEAVE)
        if self.customs_hold(pkg):
            return self.set_status(row_no, HELD_CUSTOMS)
        if norm(emp.get("Status")) != "active":
            raise LookupError(f"unknown directory status {emp.get('Status')!r}")
        self.route(row_no, pkg, emp)

    def on_returned(self, row_no: int, pkg: dict):
        return None

    def route(self, row_no: int, pkg: dict, emp: dict):
        trk = pkg["Tracking Number"].strip()
        loc = self.location(pkg, emp)
        self.post(f"{trk} {ARROW} {loc} ({emp['Name'].strip()}, {emp['Department'].strip()})")
        if self.needs_sms(pkg):
            self.sms(emp["Phone"].strip(), f"Package {trk} ready at {self.sms_location(pkg, emp)}")
        self.set_status(row_no, ROUTED)

    # -- triggers -------------------------------------------------------------------------------------------------------
    def received(self, row_no: int):
        rows = dict(self.sheet(WS_PKG))
        pkg = rows.get(row_no)
        if pkg is None:
            raise LookupError(f"no package row {row_no}")
        self.decide(row_no, pkg, self.sheet(WS_EMP))

    def package_changed(self, row_no: int):                      # section 4, customs cleared
        pkg = dict(self.sheet(WS_PKG)).get(row_no)
        if pkg is None or not self.customs_released(pkg):
            return None
        self.decide(row_no, pkg, self.sheet(WS_EMP))

    def customs_released(self, pkg: dict) -> bool:
        return norm(pkg.get("Status")) == norm(HELD_CUSTOMS) and not self.customs_hold(pkg)

    def employee_changed(self, row_no: int):                     # section 4, back from leave
        directory = self.sheet(WS_EMP)
        emp = dict(directory).get(row_no)
        if emp is None or norm(emp.get("Status")) != "active":
            return None
        for n, pkg in self.sheet(WS_PKG):
            if norm(pkg.get("Status")) == norm(HELD_LEAVE) and self.same_person(pkg, emp):
                self.decide(n, pkg, directory)

    def same_person(self, pkg: dict, emp: dict) -> bool:
        return norm(pkg.get("Recipient Name")) == norm(emp.get("Name")) and norm(pkg.get("Department")) == norm(emp.get("Department"))

    def day_close(self, day: str):                               # section 5
        self.post(f"Routed today: {self.count_today(day)}")

    def count_today(self, day: str) -> int:
        hist = self.call("GET", SLACK + "conversations.history", {"channel": "mailroom", "limit": 1000})
        n = 0
        for m in hist.get("messages", []):
            when = datetime.fromtimestamp(float(m["ts"]), tz=timezone.utc).date().isoformat()
            if when == day and ROUTING_POST.match((m.get("text") or "").strip()):
                n += 1
        return n


def handle(trigger: dict, ctx):
    try:
        return Mailroom(trigger, ctx).run()
    except LookupError as e:                                     # section 6: cannot decide -> escalate, nothing else
        ctx.fetch("POST", SLACK + "chat.postMessage", None,
                  {"channel": "automation-review", "text": f"{trigger.get('trigger')}: {e}"})
        return None


if __name__ == "__main__":
    print(json.dumps({"entry": "handle(trigger, ctx)"}))
