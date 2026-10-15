"""abr-sup-gdpr reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch -> AutomationBench's api_fetch on the simulated Zendesk, Google Sheets, Gmail and Slack). It never imports
the generator or the oracle and keeps no private state: the Compliance Log (request state), the Erasure Requests and
Legal Hold sheets, Report Config, Zendesk and the inbox are the state of record, read back on every trigger.

`Gdpr` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
Entry point: handle(trigger, ctx).
"""
from __future__ import annotations

import base64
import json
import re
from datetime import date, datetime, timezone
from urllib.parse import quote

SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/"
SLACK = "https://slack.com/api/"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/"
ZENDESK = "https://company.zendesk.com/api/v2/"
SS = "ss_gdpr"
WS_REQ, WS_HOLD, WS_LOG, WS_CFG = "ws_requests", "ws_legal_hold", "ws_compliance_log", "ws_config"
REQUESTS, HOLDS = "erasure requests", "legal hold"
PRIVACY_OPS = "privacy-ops"
PREFIX, TAG = "[GDPR Purged] ", "gdpr-purged"
VS, VERIFIED, BLOCKED, PURGED = "Verification Sent", "Verified", "Blocked - Legal Hold", "Purged"
NOT_FOUND, DUPLICATE, CLOSED = "Not Found", "Duplicate", "Closed - Unverified"
DUP_STATES = (VS, BLOCKED, PURGED)
DEADLINE_DAYS = 30
REQUEST_ID = re.compile(r"\bGDPR-\d+\b")


def norm(s) -> str:
    return " ".join(str(s or "").split()).lower()


def address(s) -> str:
    """POLICY section 3: equal ignoring letter case and surrounding spaces."""
    return str(s or "").strip().lower()


def sender(header) -> str:
    """The address of a From header: the part in angle brackets, else the whole value."""
    m = re.search(r"<([^<>]+)>\s*$", str(header or ""))
    return address(m.group(1) if m else header)


def utc_date(at) -> str | None:
    try:
        dt = datetime.fromisoformat(str(at).strip().replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).date().isoformat()


class Gdpr:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx
        self.at = trigger.get("at")

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

    def headers(self, ws: str) -> list[str]:
        out = self.call("GET", f"{SHEETS}{SS}/values/{quote(ws)}")
        return (out.get("values") or [[]])[0]

    def append_log(self, rid: str, email: str, transition: str, reference: str = ""):
        """Section 9: one new row at the bottom of the Compliance Log; nothing is ever edited."""
        cells = {"Request ID": rid, "Email": email.strip(), "Transition": transition, "At": self.at, "Reference": reference}
        hdr = self.headers(WS_LOG)
        self.call("POST", f"{SHEETS}{SS}/values/{WS_LOG}:append", {"valueInputOption": "RAW"},
                  {"values": [[cells.get(h, "") for h in hdr]]})

    def send(self, to: str, subject: str, rid: str, text: str):
        body = f"Hello,\n\n{text}\n\nRequest ID: {rid}\n\nPrivacy Office"
        raw = f"To: {to.strip()}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        self.call("POST", GMAIL + "messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})

    def post(self, text: str, channel: str = PRIVACY_OPS):
        self.call("POST", SLACK + "chat.postMessage", None, {"channel": channel, "text": text})

    def log(self) -> list[dict]:
        return [c for _, c in self.sheet(WS_LOG)]

    def state(self, rid: str, log: list[dict]) -> str | None:
        rows = [c for c in log if c.get("Request ID", "").strip() == rid]
        return rows[-1].get("Transition", "").strip() if rows else None

    def requests(self) -> list[tuple[int, dict]]:
        return self.sheet(WS_REQ)

    def quoted_text(self, m: dict) -> str:
        return "\n".join(str(m.get(k) or "") for k in ("subject", "body_plain", "body_html"))

    def users_with(self, email: str) -> list[dict]:
        return [u for u in self.call("GET", ZENDESK + "users").get("users", []) if self.same(u.get("email"), email)]

    def active_holds(self, email: str) -> list[dict]:
        return [c for _, c in self.sheet(WS_HOLD) if norm(c.get("Status")) == "active" and self.same(c.get("Email"), email)]

    def same(self, a, b) -> bool:
        return address(a) == address(b)

    # -- entry ----------------------------------------------------------------------------------------------------------
    def run(self):
        app, ev, d = self.t.get("app"), self.t.get("event"), self.t.get("data") or {}
        if app == "schedule" and ev == "day_close":
            return self.day_close(d["date"])
        if app == "gmail" and ev == "new_email":
            return self.on_email(d["message_id"])
        if app != "google_sheets" or d.get("spreadsheet_id", SS) != SS:
            return None
        ws = norm(d.get("worksheet"))
        if ev == "new_row" and ws in (REQUESTS, WS_REQ):
            return self.on_request(int(d["row_id"]))
        if ev == "row_updated" and ws in (HOLDS, WS_HOLD):
            return self.on_hold_update(int(d["row_id"]))
        return None                                              # a hold added: nothing now (section 7)

    # -- section 4: a new request ---------------------------------------------------------------------------------------
    def on_request(self, row_no: int):
        rows = self.requests()
        req = dict(rows).get(row_no)
        if req is None:
            raise LookupError(f"no Erasure Requests row {row_no}")
        rid, email = req["Request ID"].strip(), req["Email"]
        log = self.log()
        earlier = self.duplicate_of(rid, email, rows, log)
        if earlier:
            return self.append_log(rid, email, DUPLICATE, earlier)
        if not self.users_with(email):
            self.append_log(rid, email, NOT_FOUND)
            return self.send(email, f"Erasure request {rid}: no account found", rid,
                             f"We could not find an account for {email.strip()}, so there is nothing to erase.")
        self.send(email, f"Verify your erasure request {rid}", rid,
                  f"We received a request to erase your personal data ({rid}). To confirm it, reply to this email "
                  f"from this address and quote {rid}.")
        self.append_log(rid, email, VS)

    def duplicate_of(self, rid: str, email: str, rows, log) -> str | None:
        hits = [c["Request ID"].strip() for _, c in rows if c["Request ID"].strip() != rid and self.same(c["Email"], email)
                and self.state(c["Request ID"].strip(), log) in DUP_STATES]
        if len(hits) > 1:
            raise LookupError(f"several open requests for {email.strip()}: {hits}")
        return hits[0] if hits else None

    # -- section 5: an email --------------------------------------------------------------------------------------------
    def on_email(self, message_id: str):
        m = self.call("GET", GMAIL + f"messages/{message_id}")
        quoted = list(dict.fromkeys(REQUEST_ID.findall(self.quoted_text(m))))
        if not quoted:
            return None
        frm = self.from_address(m)
        reqs = {c["Request ID"].strip(): c for _, c in self.requests()}
        log = self.log()
        hits = [x for x in quoted if x in reqs and self.state(x, log) == VS and self.same(reqs[x]["Email"], frm)]
        if len(hits) > 1:
            raise LookupError(f"one email verifies several requests: {hits}")
        if hits:
            self.verified(hits[0], reqs[hits[0]]["Email"], m.get("id") or message_id)

    def from_address(self, m: dict) -> str:
        return sender(m.get("from"))

    def verified(self, rid: str, email: str, message_id: str):
        self.append_log(rid, email, VERIFIED, message_id)
        holds = self.active_holds(email)
        if holds:
            self.append_log(rid, email, BLOCKED, ", ".join(c["Case Reference"].strip() for c in holds))
            return self.send(email, f"Erasure request {rid}: on legal hold", rid,
                             "Your erasure request is verified, but your data is under a legal hold, so we cannot erase "
                             "it yet. We will erase it when the hold ends.")
        self.purge_and_log(rid, email)

    # -- section 6: purge -----------------------------------------------------------------------------------------------
    def purge_and_log(self, rid: str, email: str):
        ids = self.purge(email)
        self.append_log(rid, email, PURGED, ", ".join(ids) if ids else "none")

    def purge(self, email: str) -> list[str]:
        users = self.users_with(email)
        if len(users) != 1:
            raise LookupError(f"{len(users)} Zendesk users with the address {email.strip()}")
        u = users[0]
        ids = []
        for t in self.requester_tickets(u):
            self.anonymize(t)
            ids.append(t["id"])
        self.call("DELETE", ZENDESK + f"users/{u['id']}")
        return ids

    def requester_tickets(self, u: dict) -> list[dict]:
        return [t for t in self.call("GET", ZENDESK + "tickets").get("tickets", []) if t.get("requester_id") == u["id"]]

    def anonymize(self, t: dict):
        tags = list(t.get("tags") or [])
        if TAG not in tags:
            tags.append(TAG)
        self.call("PUT", ZENDESK + f"tickets/{t['id']}", None, {"ticket": {"subject": PREFIX + t["subject"], "tags": tags}})

    # -- section 7: a hold row changed ----------------------------------------------------------------------------------
    def on_hold_update(self, row_no: int):
        holds = self.sheet(WS_HOLD)
        row = dict(holds).get(row_no)
        if row is None or norm(row.get("Status")) != "lifted":
            return None
        email = row.get("Email")
        if any(n != row_no and norm(c.get("Status")) == "active" and self.same(c.get("Email"), email) for n, c in holds):
            return None
        log = self.log()
        for _, c in self.requests():
            rid = c["Request ID"].strip()
            if self.same(c["Email"], email) and self.state(rid, log) == BLOCKED:
                self.purge_and_log(rid, c["Email"])

    # -- section 8: daily close -----------------------------------------------------------------------------------------
    def day_close(self, day: str):
        log = self.log()
        for _, c in self.requests():
            rid = c["Request ID"].strip()
            if self.state(rid, log) == VS and self.overdue(c, day):
                self.append_log(rid, c["Email"], CLOSED)
                self.send(c["Email"], f"Erasure request {rid}: closed unverified", rid,
                          "We did not receive a confirmation within 30 days, so this request is closed. You can send a "
                          "new request at any time.")
        log = self.log()
        self.post(f"{day}: {self.count(log, PURGED, day)} purged, {self.count(log, BLOCKED, day)} blocked, batch {self.batch()}")

    def count(self, log: list[dict], transition: str, day: str) -> int:
        return sum(1 for c in log if c.get("Transition", "").strip() == transition and utc_date(c.get("At")) == day)

    def overdue(self, req: dict, day: str) -> bool:
        return (date.fromisoformat(day) - date.fromisoformat(req["Requested Date"].strip())).days >= DEADLINE_DAYS

    def batch(self) -> str:
        vals = [c["Value"].strip() for _, c in self.sheet(WS_CFG) if c.get("Setting", "").strip() == "Batch_Reference"]
        if len(vals) != 1:
            raise LookupError(f"{len(vals)} Batch_Reference settings")
        return vals[0]


def handle(trigger: dict, ctx):
    try:
        return Gdpr(trigger, ctx).run()
    except LookupError as e:                                     # section 11: cannot decide -> escalate, nothing else
        ctx.fetch("POST", SLACK + "chat.postMessage", None,
                  {"channel": "automation-review", "text": f"{trigger.get('trigger')}: {e}"})
        return None


if __name__ == "__main__":
    print(json.dumps({"entry": "handle(trigger, ctx)"}))
