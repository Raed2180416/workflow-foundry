"""Observable-only reference workflow for abr-mkt-suppression.

Written from POLICY.md alone. It sees exactly what an arm sees: the trigger payload, and the simulated apps through the
AutomationBench `api_fetch` tool (the `api` object passed in; in the stream harness its `fetch` calls
automationbench.tools.api.fetch.api_fetch on the live world, the same routing the agent's tool uses). It imports only
the Python standard library: never the generator, its truth, the oracle or lib.py, so agreement with the generator's
truth is evidence from two independent implementations (RECURRING-DESIGN section 3.5, 3.11 gate 3).

Entry point: handle(payload, api). The class is split into small methods, one per policy clause, so that controls.py
can build one-defect "plausible but wrong" variants by overriding exactly one rule.
"""
from __future__ import annotations

import base64
import re
from datetime import date, timedelta
from urllib.parse import quote

MAILCHIMP = "https://us21.api.mailchimp.com/3.0"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
SLACK = "https://slack.com/api"

REQUESTS = ("sheet-unsubscribe-requests", "Requests")
BOUNCES = ("sheet-email-bounces", "Bounces")
BOUNCE_LOG = ("sheet-bounce-log", "Soft Bounces")
COMPLIANCE_LOG = ("sheet-compliance-log", "Log")
MANAGERS = ("sheet-account-managers", "Managers")
POLICY_LOG = ("sheet-suppression-policy", "Policy Log")

COMPLIANCE = "compliance@company.example.com"
CONFIRM_SUBJECT = "Unsubscribe confirmation"
PARAMS = ("Soft-bounce threshold", "Soft-bounce window")
CONFIRM_DAYS = 30


class Undecidable(Exception):
    pass


def email_addr(s) -> str:
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


def window_start(today: str, days: int) -> str:
    return (date.fromisoformat(today) - timedelta(days=days - 1)).isoformat()


class Suppression:
    def __init__(self, api):
        self.api = api
        self._lists = None

    # ------------------------------------------------------------------ tool access
    def call(self, method, url, params=None, body=None):
        r = self.api.fetch(method, url, params, body)
        if isinstance(r, dict) and r.get("error"):
            raise RuntimeError(f"{method} {url}: {r['error']}")
        return r

    def sheet(self, ref: tuple[str, str]) -> tuple[list[str], list[dict]]:
        vals = self.call("GET", f"{SHEETS}/{ref[0]}/values/{quote(ref[1])}").get("values", [])
        if not vals:
            return [], []
        hdr = vals[0]
        return hdr, [dict(zip(hdr, [str(v) for v in row] + [""] * (len(hdr) - len(row)))) for row in vals[1:]]

    def append(self, ref: tuple[str, str], cells: dict):
        hdr, _ = self.sheet(ref)
        self.call("POST", f"{SHEETS}/{ref[0]}/values/{quote(ref[1])}:append", {"valueInputOption": "RAW"},
                  {"values": [[cells.get(h, "") for h in hdr]]})

    def post(self, channel: str, text: str):
        self.call("POST", f"{SLACK}/chat.postMessage", None, {"channel": channel, "text": text})

    def history(self, channel: str) -> list[str]:
        r = self.call("GET", f"{SLACK}/conversations.history", {"channel": channel, "limit": 1000})
        return [m.get("text") or "" for m in r.get("messages", [])]

    def send(self, to: str, subject: str, body: str):
        raw = f"To: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        self.call("POST", f"{GMAIL}/messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})

    def escalate(self, p: dict, reason: str):
        self.post("automation-review", f"{p['trigger']}: {reason}")

    # ------------------------------------------------------------------ Mailchimp
    def lists(self) -> list[tuple[str, str]]:
        if self._lists is None:
            self._lists = [(x["id"], x["name"]) for x in self.call("GET", f"{MAILCHIMP}/lists").get("lists", [])]
        return self._lists

    def member_status(self, list_id: str, email: str) -> str | None:
        r = self.api.fetch("GET", f"{MAILCHIMP}/lists/{list_id}/members/{quote(email, safe='')}")
        if not isinstance(r, dict) or r.get("error") or (r.get("email") or "").strip().lower() != email:
            return None
        return r.get("status")

    def on_lists(self, email: str) -> list[tuple[str, str]]:
        out = []
        for lid, name in self.lists():
            st = self.member_status(lid, email)
            if st is not None and st != "archived":
                out.append((lid, name))
        return out

    def archive(self, email: str, lists: list[tuple[str, str]]) -> list[str]:
        for lid, _ in lists:
            self.call("DELETE", f"{MAILCHIMP}/lists/{lid}/members/{quote(email, safe='')}")
        return sorted(name for _, name in lists)

    # ------------------------------------------------------------------ rules (one method per policy clause)
    def norm(self, s) -> str:
        return email_addr(s)

    def logged(self, log: list[dict], ref: str) -> bool:
        return any(r.get("Ref", "").strip() == ref for r in log)

    def duplicate(self, notes: str) -> bool:
        return "duplicate" in (notes or "").lower()

    def invalid(self, notes: str) -> bool:
        n = (notes or "").lower()
        return "resolved" in n or "pre-migration" in n or "retracted" in n

    def hold_until(self, notes: str) -> str | None:
        m = re.search(r"hold until (\d{4}-\d{2}-\d{2})", notes or "", re.I)
        return m.group(1) if m else None

    def premium(self, notes: str) -> bool:
        return "premium-tier" in (notes or "").lower()

    def reprocess(self, notes: str) -> bool:
        n = (notes or "").lower()
        return "system error" in n and "reprocess" in n

    def unsub_subject(self, subject: str) -> bool:
        s = (subject or "").strip()
        while True:
            m = re.match(r"(?i)\s*(re|fwd|fw)\s*:\s*", s)
            if not m:
                break
            s = s[m.end():]
        return s.strip().lower() == "unsubscribe"

    def authorized(self, sender: str) -> bool:
        return email_addr(sender) == COMPLIANCE

    def confirmed_recently(self, log: list[dict], email: str, today: str) -> bool:
        lo = window_start(today, CONFIRM_DAYS)
        return any(self.norm(r.get("Email")) == email and r.get("Confirmation", "").strip().lower() == "sent"
                   and lo <= r.get("Date", "").strip() <= today for r in log)

    def params(self, today: str) -> tuple[int, int]:
        _, rows = self.sheet(POLICY_LOG)
        best: dict[str, tuple[str, str]] = {}
        for r in rows:  # newest Effective on or before today; the later row wins a tie
            name, eff = r.get("Parameter", "").strip(), r.get("Effective", "").strip()
            if name in PARAMS and eff <= today and (name not in best or eff >= best[name][0]):
                best[name] = (eff, r.get("Value", "").strip())
        if len(best) < 2:
            raise Undecidable(f"no Policy Log value for the soft-bounce parameters on {today}")
        return int(re.sub(r"\D", "", best["Soft-bounce threshold"][1])), int(re.sub(r"\D", "", best["Soft-bounce window"][1]))

    def soft_count(self, email: str, today: str, window: int) -> int:
        _, rows = self.sheet(BOUNCE_LOG)
        lo = window_start(today, window)
        return sum(1 for r in rows if self.norm(r.get("Email")) == email and lo <= r.get("Date", "").strip() <= today)

    def manager_for(self, email: str) -> str | None:
        _, rows = self.sheet(MANAGERS)
        for r in rows:
            if self.norm(r.get("Email")) == email and r.get("Account Manager", "").strip():
                return r["Account Manager"].strip()
        return None

    def log(self, today: str, email: str, event: str, action: str, ref: str, lists=(), conf: str = ""):
        self.append(COMPLIANCE_LOG, {"Date": today, "Email": email, "Event": event, "Action": action,
                                     "Lists": "; ".join(sorted(lists)), "Confirmation": conf, "Ref": ref})

    # ------------------------------------------------------------------ the event rules (section 5)
    def unsub(self, email: str, ref: str, today: str, event: str = "Unsubscribe"):
        lists = self.on_lists(email)
        if not lists:
            self.log(today, email, event, "Not subscribed", ref)
            return
        names = self.archive(email, lists)
        _, log = self.sheet(COMPLIANCE_LOG)
        conf = ""
        if not self.confirmed_recently(log, email, today):
            self.send(email, CONFIRM_SUBJECT, f"Hello,\n\n{email} has been removed from all our mailing lists. "
                                              f"You will not receive marketing email from us again.\n\nCompany Marketing\n")
            conf = "Sent"
        self.log(today, email, event, "Archived", ref, names, conf)

    def hard_decision(self, email: str, notes: str) -> str:
        """'archive', or the account manager's address; Undecidable when a Premium-tier address has no manager."""
        if self.premium(notes):
            mgr = self.manager_for(email)
            if not mgr:
                raise Undecidable(f"Premium-tier bounce for {email} but no Account Managers row")
            return mgr
        return "archive"

    def hard_apply(self, email: str, ref: str, today: str, decision: str, event: str):
        if decision != "archive":
            self.send(decision, f"Premium-tier hard bounce: {email}",
                      f"Hello,\n\nThe premium-tier subscriber {email} hard-bounced (Bounce ID {ref}). The address was not "
                      f"archived; please check it with the account.\n\nSuppression automation\n")
            self.log(today, email, event, "Escalated", ref)
            return
        lists = self.on_lists(email)
        if not lists:
            self.log(today, email, event, "Not subscribed", ref)
            return
        self.log(today, email, event, "Archived", ref, self.archive(email, lists))

    def hard(self, email: str, ref: str, notes: str, today: str):
        self.hard_apply(email, ref, today, self.hard_decision(email, notes), "Hard bounce")

    def soft(self, email: str, ref: str, notes: str, today: str):
        threshold, window = self.params(today)
        decision = None
        if self.soft_count(email, today, window) + 1 >= threshold:
            decision = self.hard_decision(email, notes)  # may raise: then nothing is written
        self.append(BOUNCE_LOG, {"Date": today, "Email": email, "Bounce ID": ref})
        if decision is None:
            self.log(today, email, "Soft bounce", "Logged", ref)
        else:
            self.hard_apply(email, ref, today, decision, "Soft bounce")

    def apply_rule(self, key: str, cells: dict, today: str):
        """Step 5 of section 4."""
        email = self.norm(cells.get("Email"))
        if key == "requests":
            self.unsub(email, cells.get("Request ID", "").strip(), today)
            return
        ref, notes = cells.get("Bounce ID", "").strip(), cells.get("Notes", "")
        kind = (cells.get("Bounce Type") or "").strip().lower()
        if kind == "hard":
            self.hard(email, ref, notes, today)
        elif kind == "soft":
            self.soft(email, ref, notes, today)
        elif kind in ("transient", "unknown"):
            self.log(today, email, f"{kind.capitalize()} bounce", "Ignored", ref)
        else:
            raise Undecidable(f"unknown Bounce Type '{cells.get('Bounce Type')}' on {ref}")

    def event_name(self, key: str, cells: dict) -> str:
        if key == "requests":
            return "Unsubscribe"
        kind = (cells.get("Bounce Type") or "").strip().lower()
        if kind not in ("hard", "soft", "transient", "unknown"):
            raise Undecidable(f"unknown Bounce Type '{cells.get('Bounce Type')}'")
        return f"{kind.capitalize()} bounce"

    # ------------------------------------------------------------------ events
    def handle(self, p: dict):
        ev, data = p.get("event"), p.get("data") or {}
        today = str(p["at"])[:10]
        try:
            if ev == "new_row":
                key = {REQUESTS[0]: "requests", BOUNCES[0]: "bounces"}.get(data.get("spreadsheet_id"))
                if key:
                    self.on_row(key, data.get("row") or {}, today)
            elif ev == "updated_row":
                if data.get("spreadsheet_id") == REQUESTS[0]:
                    self.on_updated(data.get("row") or {}, today)
            elif ev == "new_email":
                self.on_email(data, today)
            elif ev == "daily_close":
                self.on_close(p, data.get("date") or today)
        except Undecidable as e:
            self.escalate(p, str(e))

    def on_row(self, key: str, cells: dict, today: str):
        ref = (cells.get("Request ID") if key == "requests" else cells.get("Bounce ID") or "").strip()
        notes = cells.get("Notes", "")
        _, log = self.sheet(COMPLIANCE_LOG)
        if self.logged(log, ref) or self.duplicate(notes):
            return
        if self.invalid(notes):
            self.log(today, self.norm(cells.get("Email")), self.event_name(key, cells), "Skipped", ref)
            return
        if self.hold_until(notes):
            return
        self.apply_rule(key, cells, today)

    def on_updated(self, cells: dict, today: str):
        if not self.reprocess(cells.get("Notes", "")):
            return
        ref = cells.get("Request ID", "").strip()
        _, log = self.sheet(COMPLIANCE_LOG)
        if any(r.get("Ref", "").strip() == ref and r.get("Event", "").strip().lower() == "unsubscribe (reprocess)" for r in log):
            return
        self.unsub(self.norm(cells.get("Email")), ref, today, "Unsubscribe (reprocess)")

    def on_email(self, data: dict, today: str):
        msg = self.call("GET", f"{GMAIL}/messages/{quote(data['message_id'])}")
        sender = msg.get("from") or data.get("from") or ""
        if self.unsub_subject(msg.get("subject") or data.get("subject")):
            ref = msg.get("id") or data["message_id"]
            _, log = self.sheet(COMPLIANCE_LOG)
            if not self.logged(log, ref):
                self.unsub(self.norm(sender), ref, today)
            return
        if not self.authorized(sender):
            return
        body = msg.get("body_plain") or ""
        found = {k.lower(): v.strip() for k, v in re.findall(r"^\s*(Parameter|New value|Effective)\s*:\s*(.+?)\s*$", body, re.M | re.I)}
        if not found:
            return  # not an amendment: nothing to do
        param = next((x for x in PARAMS if x.lower() == found.get("parameter", "").lower()), None)
        eff, value = found.get("effective", ""), re.sub(r"\D", "", found.get("new value", ""))
        if param is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", eff) or not value:
            raise Undecidable("amendment from compliance could not be read")
        if self.amendment_logged(eff, param, value):
            return  # a repeated delivery of an amendment already logged (section 8)
        self.append(POLICY_LOG, {"Effective": eff, "Parameter": param, "Value": value, "Approved by": COMPLIANCE})

    def releasable(self, cells: dict, log: list[dict], today: str, key: str) -> bool:
        hd = self.hold_until(cells.get("Notes", ""))
        ref = (cells.get("Request ID") if key == "requests" else cells.get("Bounce ID") or "").strip()
        return bool(hd) and hd <= today and not self.logged(log, ref) and not self.duplicate(cells.get("Notes")) \
            and not self.invalid(cells.get("Notes"))

    def amendment_logged(self, eff: str, param: str, value: str) -> bool:
        _, rows = self.sheet(POLICY_LOG)
        return any((r.get("Effective", "").strip(), r.get("Parameter", "").strip(), re.sub(r"\D", "", r.get("Value", ""))) == (eff, param, value)
                   for r in rows)

    def closed(self, today: str) -> bool:
        return any(t.strip().startswith(f"{today}:") for t in self.history("compliance"))

    def on_close(self, p: dict, today: str):
        if self.closed(today):
            return  # this close already ran (section 7 step 1)
        for key, ref in (("requests", REQUESTS), ("bounces", BOUNCES)):
            _, rows = self.sheet(ref)
            for cells in rows:
                _, log = self.sheet(COMPLIANCE_LOG)
                if self.releasable(cells, log, today, key):
                    try:
                        self.apply_rule(key, cells, today)
                    except Undecidable as e:
                        self.escalate(p, str(e))
        _, log = self.sheet(COMPLIANCE_LOG)
        rows = [r for r in log if r.get("Date", "").strip() == today]
        n = sum(1 for r in rows if r.get("Action", "").strip().lower() == "archived")
        m = sum(1 for r in rows if r.get("Action", "").strip().lower() == "escalated")
        k = sum(1 for r in rows if r.get("Confirmation", "").strip().lower() == "sent")
        self.post("compliance", f"{today}: archived {n}, escalated {m}, confirmations {k}")


def handle(payload: dict, api) -> None:
    Suppression(api).handle(payload)
