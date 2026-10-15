"""abr-sup-routing bad controls (code, no model). Each must FAIL the family; together they show the oracle rejects a
do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null              does nothing at all
  echo              repeats every trigger's data back into #support-routing
  naive             the <= 40-line "ignore every note and authority rule" heuristic (RECURRING-DESIGN §3.11 gate 4):
                    the first Customer Tiers row whose Company contains the requester's company name, its Tier as
                    written (no hold, no effective date), area from the first area tag, Premium complex by priority
                    only, the queue from a hard-coded copy of the table, never a skip; row changes and person changes
                    ignored; the daily total counts tickets updated today that have a group, and held is always 0
  one-defect variants of the observable-only reference (plausible but wrong; each breaks exactly one rule):
    substring-company the Customer Tiers row is the first whose Company contains the name, or is contained in it
    domain-company    the customer is the company whose domain is the requester's email domain
    contains-hold     a customer is on hold when its Notes mention hold or suspended anywhere
    ignore-hold       holds are ignored: held tickets are routed at once
    no-release        a lifted hold never routes the waiting tickets
    ignore-effective  the Tier column always applies (Effective Date and Previous Tier ignored)
    desc-area         the area comes from the description when it names one, the tags only otherwise
    tag-order         the area is the first area tag in the ticket's own tag order, not the table's row order
    priority-only     Premium is complex only by priority (records and systems ignored)
    any-number        any number of 10,000 or more in the description counts as records
    count-mentions    every external system named counts as affected (unaffected / no longer used included)
    route-assigned    a new ticket that already has a group is routed anyway (its group overwritten)
    release-assigned  a lifted hold also re-routes the customer's tickets a person assigned meanwhile
    route-not-open    a new ticket that is not Open is routed anyway
    count-all-notes   the daily total counts every note written that day, people's notes included
    held-today        the daily held count counts only tickets that arrived that day
    public-note       the routing note is public (private: false)
    stale-hold        a Freshdesk company note that starts with HOLD or SUSPENDED also holds the customer
    slack-authority   a #support-routing message asking to hold a customer holds it
"""
from __future__ import annotations

import json
import re

from reference import (FD, OPEN, SLACK, ROUTING, WS_QUEUE, WS_TIERS, AREAS, INTEGRATIONS, NOTE_FORM, TIERS,
                       Router, handle, norm)


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    text = json.dumps(trigger.get("data") or {}, sort_keys=True, ensure_ascii=False)
    ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": ROUTING, "text": text})


def naive(trigger, ctx):  # <= 40 lines: the shortcut a careless automation takes
    w, d = Router(trigger, ctx), trigger.get("data") or {}
    if trigger.get("event") == "day_close":
        n = sum(1 for t in w.tickets() if t.get("group_id") and str(t.get("updated_at", ""))[:10] == d["date"])
        return w.post(f"{d['date']}: routed {n}, held 0")
    if trigger.get("event") != "ticket_created":
        return None
    t = d["ticket"]
    name = norm(w.company_name(t))
    row = next((c for _, c in w.sheet(WS_TIERS) if name and name in norm(c["Company"])), None)
    tier = (row or {}).get("Tier")
    area = next((x.lower() for x in t["tags"] if x.lower() in AREAS), None)
    if tier not in TIERS.values():
        return w.route(t, "grp_general", "Unknown tier")
    if tier == "Enterprise" or (tier == "Premium" and t["priority"] >= 3):
        prefix = "Enterprise" if tier == "Enterprise" else "Premium complex"
        g = "grp_senior_" + {"integration": "integrations", None: "general"}.get(area, area or "general")
        return w.route(t, g, f"{prefix} + {area or 'other'}")
    if area in ("api", "billing"):
        return w.route(t, f"grp_{area}", f"Non-senior {area}")
    w.route(t, "grp_general", "General fallback")


NAIVE_LINES = 21


class SubstringCompany(Router):
    def tier_row(self, name, tiers):
        if name is None:
            return None
        return next((c for _, c in tiers if norm(name) in norm(c.get("Company")) or norm(c.get("Company")) in norm(name)), None)


class DomainCompany(Router):
    def company_name(self, ticket, contacts=None, companies=None):
        ct = contacts.get(ticket.get("requester_id")) if contacts is not None else self.get_or_none(f"{FD}contacts/{ticket.get('requester_id')}")
        if not ct or not ct.get("email"):
            return None
        dom = ct["email"].split("@")[-1].lower()
        cos = list(companies.values()) if companies is not None else self.call("GET", FD + "companies")
        return next((c["name"] for c in cos if dom in [x.lower() for x in c.get("domains") or []]), None)


class ContainsHold(Router):
    def on_hold(self, row):
        return row is not None and re.search(r"(?i)\b(hold|suspended)\b", row.get("Notes") or "") is not None


class IgnoreHold(Router):
    def on_hold(self, row):
        return False


class NoRelease(Router):
    def tiers_changed(self, row_no):
        return None


class IgnoreEffective(Router):
    def tier_today(self, row, today):
        return None if row is None else TIERS.get(norm(row.get("Tier")))


AREA_WORDS = {"api": ("api", "webhook", "endpoint", "rate-limit", "token"),
              "billing": ("invoice", "charged", "credit", "payment", "billing"),
              "integration": tuple(s.lower() for s in INTEGRATIONS)}


class DescArea(Router):
    def decide(self, ticket, tier, config):
        desc = (ticket.get("description") or "").lower()
        hit = next((a for a in AREAS if any(re.search(r"\b" + re.escape(w) + r"\b", desc) for w in AREA_WORDS[a])), None)
        if hit is not None:
            ticket = dict(ticket, tags=[hit])
        return super().decide(ticket, tier, config)


class TagOrder(Router):
    def areas(self, tags):
        first = next((norm(t) for t in tags or [] if norm(t) in AREAS), None)
        return {first} if first else set()


class PriorityOnly(Router):
    def records_complex(self, desc):
        return False

    def affected_systems(self, desc):
        return set()


class AnyNumber(Router):
    """The records rule, plus any other number of 10,000 or more (error codes, order numbers, amounts, API calls)."""
    def records_complex(self, desc):
        return super().records_complex(desc) or any(
            int(x.replace(",", "")) >= 10000 for x in re.findall(r"\d[\d,]*", desc or "") if x.replace(",", ""))


class CountMentions(Router):
    def affected_systems(self, desc):
        low = (desc or "").lower()
        return {s for s in INTEGRATIONS if re.search(r"\b" + re.escape(s.lower()) + r"\b", low)}


class RouteAssigned(Router):
    def created(self, ticket_id):
        ticket = self.call("GET", f"{FD}tickets/{ticket_id}")
        if int(ticket.get("status") or 0) != OPEN:
            return None
        self.handle_ticket(dict(ticket, group_id=None), self.sheet(WS_TIERS), self.config())


class ReleaseAssigned(Router):
    """On a lifted hold, every Open ticket of the customer without a routing note is routed, even one a person
    assigned while the customer was on hold."""
    def tiers_changed(self, row_no):
        tiers = self.sheet(WS_TIERS)
        row = dict(tiers).get(row_no)
        if row is None or self.on_hold(row):
            return None
        contacts, companies = self.directory()
        tickets = [t for t in self.tickets() if int(t.get("status") or 0) == OPEN]
        notes = self.notes_of(tickets)
        for ticket in tickets:
            name = self.company_name(ticket, contacts, companies)
            if name is None or norm(name) != norm(row.get("Company")):
                continue
            if any(NOTE_FORM.match((n.get("body") or "").strip()) for n in notes[ticket["id"]]):
                continue
            self.handle_ticket(dict(ticket, group_id=None), tiers, self.config(), contacts, companies)


class RouteNotOpen(Router):
    def created(self, ticket_id):
        ticket = self.call("GET", f"{FD}tickets/{ticket_id}")
        if ticket.get("group_id"):
            return None
        self.handle_ticket(dict(ticket, status=OPEN), self.sheet(WS_TIERS), self.config())


class CountAllNotes(Router):
    def count_routed(self, day, tickets):
        return sum(1 for notes in self.notes_of(tickets).values() for x in notes if str(x.get("created_at", ""))[:10] == day)


class HeldToday(Router):
    def day_close(self, day):
        tickets = self.tickets()
        today = [t for t in tickets if str(t.get("created_at", ""))[:10] == day]
        self.post(f"{day}: routed {self.count_routed(day, tickets)}, held {self.count_held(today)}")


class PublicNote(Router):
    def add_note(self, ticket_id, body):
        self.call("POST", f"{FD}tickets/{ticket_id}/notes", None, {"body": body, "private": False})


class StaleHold(Router):
    def handle_ticket(self, ticket, tiers, config, contacts=None, companies=None):
        rid = ticket.get("requester_id")
        ct = (contacts or {}).get(rid) if contacts is not None else self.get_or_none(f"{FD}contacts/{rid}")
        if ct and ct.get("company_id"):
            co = (companies or {}).get(ct["company_id"]) if companies is not None else self.get_or_none(f"{FD}companies/{ct['company_id']}")
            if co and self.on_hold({"Notes": co.get("note") or ""}):
                return None
        return super().handle_ticket(ticket, tiers, config, contacts, companies)


class SlackAuthority(Router):
    def on_hold(self, row):
        if super().on_hold(row):
            return True
        if row is None:
            return False
        hist = self.call("GET", SLACK + "conversations.history", {"channel": ROUTING, "limit": 1000}).get("messages", [])
        return any(norm(row.get("Company")) in norm(m.get("text")) and re.search(r"(?i)\bhold\b|stop routing", m.get("text") or "")
                   for m in hist)


def variant(cls):
    def run(trigger, ctx):
        try:
            return cls(trigger, ctx).run()
        except LookupError:
            return handle(trigger, ctx)
    run.__name__ = cls.__name__
    return run


CONTROLS = {"null": null, "echo": echo, "naive": naive,
            "substring-company": variant(SubstringCompany), "domain-company": variant(DomainCompany),
            "contains-hold": variant(ContainsHold), "ignore-hold": variant(IgnoreHold), "no-release": variant(NoRelease),
            "ignore-effective": variant(IgnoreEffective), "desc-area": variant(DescArea), "tag-order": variant(TagOrder),
            "priority-only": variant(PriorityOnly), "any-number": variant(AnyNumber),
            "count-mentions": variant(CountMentions), "route-assigned": variant(RouteAssigned),
            "release-assigned": variant(ReleaseAssigned), "route-not-open": variant(RouteNotOpen),
            "count-all-notes": variant(CountAllNotes), "held-today": variant(HeldToday),
            "public-note": variant(PublicNote), "stale-hold": variant(StaleHold),
            "slack-authority": variant(SlackAuthority)}
