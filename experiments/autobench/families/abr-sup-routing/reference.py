"""abr-sup-routing reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch / ctx.batch -> AutomationBench's api_fetch on the simulated apps). It never imports the generator or the
oracle, and it keeps no private state: tickets with their groups and notes, the Customer Tiers rows and the Queue
Routing Config are the state of record, read back on every trigger. The Queue Routing Config is read from the sheet
and its Condition column is parsed; the "complex" judgment (POLICY.md section 3.7) is a text reading of the
description, done here with a small parser where a workflow arm would use one typed model call.

`Router` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
Entry point: handle(trigger, ctx).
"""
from __future__ import annotations

import json
import re
from urllib.parse import quote

FD = "https://tallyline.freshdesk.com/api/v2/"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/"
SLACK = "https://slack.com/api/"
SS, WS_TIERS, WS_QUEUE = "ss_support_ops", "ws_tiers", "ws_queue_config"
TIERS_TITLE = "customer tiers"
ROUTING, REVIEW = "support-routing", "automation-review"
OPEN = 2
TIERS = {"enterprise": "Enterprise", "premium": "Premium", "standard": "Standard"}
AREAS = ("api", "billing", "integration")
HOLD_WORDS = ("HOLD", "SUSPENDED")
THRESHOLD = 10000
# POLICY.md section 3.7: the integrations we support (external systems)
INTEGRATIONS = ["Salesforce", "HubSpot", "QuickBooks", "Xero", "Zendesk", "Jira", "Mailchimp", "Asana", "Airtable",
                "Trello", "DocuSign", "BambooHR", "Twilio", "Calendly", "Intercom"]
NOT_AFFECTED = ("unaffected", "not affected", "still syncs fine", "still working fine", "works fine",
                "stopped using", "no longer use")
RECORDS = re.compile(r"(?<![\d,.])(\d[\d,]*)\s*(k)?\s+records\b", re.I)
SENTENCE = re.compile(r"(?<=[.!?])\s+")
NOTE_FORM = re.compile(r"^routed to \S+ \(.+\)\.?$", re.I)


def norm(s) -> str:
    return " ".join(str(s or "").split()).lower()


class Router:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx
        self.today = str(trigger.get("at") or "")[:10]

    # -- tools ----------------------------------------------------------------------------------------------------------
    def call(self, method: str, url: str, params=None, body=None):
        out = self.ctx.fetch_json(method, url, params, body)
        if isinstance(out, dict) and (out.get("error") or out.get("ok") is False):
            raise RuntimeError(f"{method} {url}: {out}")
        return out

    def get_or_none(self, url: str):
        out = self.ctx.fetch_json("GET", url)
        return None if isinstance(out, dict) and out.get("error") else out

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

    def set_group(self, ticket_id: str, group: str):
        self.call("PUT", f"{FD}tickets/{ticket_id}", None, {"group_id": group})

    def add_note(self, ticket_id: str, body: str):
        self.call("POST", f"{FD}tickets/{ticket_id}/notes", None, {"body": body, "private": True})

    def post(self, text: str, channel: str = ROUTING):
        self.call("POST", SLACK + "chat.postMessage", None, {"channel": channel, "text": text})

    def directory(self) -> tuple[dict, dict]:
        """All contacts and companies by id (two reads)."""
        contacts = self.call("GET", FD + "contacts").get("contacts", [])
        companies = self.call("GET", FD + "companies")
        return {c["id"]: c for c in contacts}, {c["id"]: c for c in companies}

    # -- entry ----------------------------------------------------------------------------------------------------------
    def run(self):
        app, ev, d = self.t.get("app"), self.t.get("event"), self.t.get("data") or {}
        if app == "schedule" and ev == "day_close":
            return self.day_close(d["date"])
        if app == "freshdesk" and ev == "ticket_created":
            return self.created(str((d.get("ticket") or {}).get("id")))
        if app == "freshdesk" and ev == "ticket_updated":
            return self.person_changed(d)
        if app == "google_sheets" and ev == "row_updated" and norm(d.get("worksheet")) in (TIERS_TITLE, WS_TIERS):
            return self.tiers_changed(int(d["row_id"]))
        return None

    # -- rules (one method per policy clause) ---------------------------------------------------------------------------
    def company_name(self, ticket: dict, contacts: dict | None = None, companies: dict | None = None) -> str | None:
        """Section 3.2: the requester's company in Freshdesk (never the email domain)."""
        rid = ticket.get("requester_id")
        if not rid:
            return None
        ct = contacts.get(rid) if contacts is not None else self.get_or_none(f"{FD}contacts/{rid}")
        if not ct or not ct.get("company_id"):
            return None
        co = companies.get(ct["company_id"]) if companies is not None else self.get_or_none(f"{FD}companies/{ct['company_id']}")
        return co.get("name") if co else None

    def tier_row(self, name: str | None, tiers: list[tuple[int, dict]]) -> dict | None:
        """Section 3.3: the Customer Tiers row whose Company is exactly the name (case and spaces ignored)."""
        if name is None:
            return None
        m = [c for _, c in tiers if norm(c.get("Company")) == norm(name)]
        if len(m) > 1:
            raise LookupError(f"several Customer Tiers rows for {name!r}")
        return m[0] if m else None

    def on_hold(self, row: dict | None) -> bool:                  # section 3.4
        if row is None:
            return False
        m = re.match(r"\s*([A-Za-z]+)", row.get("Notes") or "")
        return bool(m) and m.group(1).upper() in HOLD_WORDS

    def tier_today(self, row: dict | None, today: str) -> str | None:   # section 3.5
        if row is None:
            return None
        eff = (row.get("Effective Date") or "").strip()
        tier = row.get("Tier") if (not eff or eff <= today) else row.get("Previous Tier")
        return TIERS.get(norm(tier))

    def areas(self, tags: list) -> set[str]:                      # section 3.6
        return {norm(t) for t in tags or []} & set(AREAS)

    def records_complex(self, desc: str) -> bool:
        for m in RECORDS.finditer(desc or ""):
            n = int(m.group(1).replace(",", "")) * (1000 if m.group(2) else 1)
            if n >= THRESHOLD:
                return True
        return False

    def affected_systems(self, desc: str) -> set[str]:
        out = set()
        for s in SENTENCE.split(desc or ""):
            low = s.lower()
            if any(x in low for x in NOT_AFFECTED):
                continue
            for sysname in INTEGRATIONS:
                if re.search(r"\b" + re.escape(sysname.lower()) + r"\b", low):
                    out.add(sysname)
        return out

    def is_complex(self, ticket: dict) -> bool:                   # section 3.7
        if int(ticket.get("priority") or 0) >= 3:
            return True
        if self.records_complex(ticket.get("description") or ""):
            return True
        return len(self.affected_systems(ticket.get("description") or "")) >= 2

    def config(self) -> list[dict]:
        return [c for _, c in self.sheet(WS_QUEUE)]

    def condition(self, cond: str, f: dict) -> bool:
        """Section 3.8: one Condition cell of the Queue Routing Config, on the ticket's facts."""
        c = norm(cond)
        if c == "group already set":
            return bool(f["group"])
        if c == "status is not open":
            return f["status"] != OPEN
        if c.startswith("customer not in customer tiers"):
            return f["tier"] is None
        ok = True
        for part in (x.strip() for x in c.split(" and ")):
            if part.startswith("tier="):
                ok = ok and f["tier"] is not None and norm(f["tier"]) in [x.strip() for x in part[5:].split(" or ")]
            elif part == "complex":
                ok = ok and f["complex"]()
            elif part == "not complex":
                ok = ok and not f["complex"]()
            elif part.startswith("tags contain "):
                ok = ok and part[len("tags contain "):].strip() in f["areas"]
            else:
                raise LookupError(f"cannot read the routing condition {cond!r}")
        return ok

    def decide(self, ticket: dict, tier: str | None, config: list[dict]) -> tuple[str, str] | None:
        memo = {}

        def cx():
            if "v" not in memo:
                memo["v"] = self.is_complex(ticket)
            return memo["v"]
        f = {"group": ticket.get("group_id"), "status": int(ticket.get("status") or 0), "tier": tier,
             "areas": self.areas(ticket.get("tags")), "complex": cx}
        for row in config:
            if self.condition(row.get("Condition", ""), f):
                g = (row.get("Queue_Group_ID") or "").strip()
                return None if g.upper() == "N/A" else (g, (row.get("Rule") or "").strip())
        raise LookupError("no Queue Routing Config row applies")

    def note_text(self, group: str, rule: str) -> str:
        return f"routed to {group} ({rule})"

    def route(self, ticket: dict, group: str, rule: str):        # section 3.9
        self.set_group(ticket["id"], group)
        self.add_note(ticket["id"], self.note_text(group, rule))

    def handle_ticket(self, ticket: dict, tiers, config, contacts=None, companies=None):
        """Sections 3.1-3.9 on one ticket; performs the effects."""
        if ticket.get("group_id") or int(ticket.get("status") or 0) != OPEN:
            return None
        row = self.tier_row(self.company_name(ticket, contacts, companies), tiers)
        if self.on_hold(row):
            return None
        out = self.decide(ticket, self.tier_today(row, self.today), config)
        if out is not None:
            self.route(ticket, *out)

    # -- triggers -------------------------------------------------------------------------------------------------------
    def created(self, ticket_id: str):
        ticket = self.call("GET", f"{FD}tickets/{ticket_id}")
        if ticket.get("group_id") or int(ticket.get("status") or 0) != OPEN:
            return None
        self.handle_ticket(ticket, self.sheet(WS_TIERS), self.config())

    def person_changed(self, data: dict):                         # section 5
        return None

    def tiers_changed(self, row_no: int):                         # section 4
        tiers = self.sheet(WS_TIERS)
        row = dict(tiers).get(row_no)
        if row is None or self.on_hold(row):
            return None
        contacts, companies = self.directory()
        config = None
        for ticket in self.tickets():
            if not self.waiting(ticket):
                continue
            name = self.company_name(ticket, contacts, companies)
            if name is not None and norm(name) == norm(row.get("Company")):
                config = config if config is not None else self.config()
                self.handle_ticket(ticket, tiers, config, contacts, companies)

    def tickets(self) -> list[dict]:
        return sorted(self.call("GET", FD + "tickets"), key=lambda t: str(t["id"]))

    def waiting(self, ticket: dict) -> bool:
        return int(ticket.get("status") or 0) == OPEN and not ticket.get("group_id")

    def day_close(self, day: str):                                # section 6
        tickets = self.tickets()
        self.post(f"{day}: routed {self.count_routed(day, tickets)}, held {self.count_held(tickets)}")

    def notes_of(self, tickets: list[dict]) -> dict:
        """All tickets' notes in one step (one batch of reads)."""
        if not tickets:
            return {}
        calls = [{"name": "api_fetch", "arguments": {"method": "GET", "url": f"{FD}tickets/{t['id']}/conversations"}}
                 for t in tickets]
        res = self.ctx.batch(calls)
        return {t["id"]: json.loads(r).get("notes", []) for t, r in zip(tickets, res)}

    def count_routed(self, day: str, tickets: list[dict]) -> int:
        n = 0
        for notes in self.notes_of(tickets).values():
            n += sum(1 for x in notes if str(x.get("created_at", ""))[:10] == day and NOTE_FORM.match((x.get("body") or "").strip()))
        return n

    def count_held(self, tickets: list[dict]) -> int:
        tiers = self.sheet(WS_TIERS)
        contacts, companies = self.directory()
        return sum(1 for t in tickets if self.waiting(t)
                   and self.on_hold(self.tier_row(self.company_name(t, contacts, companies), tiers)))


def handle(trigger: dict, ctx):
    try:
        return Router(trigger, ctx).run()
    except LookupError as e:                                     # section 7: cannot decide -> escalate, nothing else
        ctx.fetch("POST", SLACK + "chat.postMessage", None,
                  {"channel": REVIEW, "text": f"{trigger.get('trigger')}: {e}"})
        return None


if __name__ == "__main__":
    print(json.dumps({"entry": "handle(trigger, ctx)"}))
