#!/usr/bin/env python3
"""abr-sup-routing: seeded stream generator (AutomationBench-R family 7; research/automationbench-20261014/
RECURRING-DESIGN.md §3.2, §4.7). Runs inside AutomationBench's own venv (it validates worlds with its WorldState):

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-sup-routing/gen.py \
        --seed 610 [--difficulty d2] --out HOSTDIR

Writes into HOSTDIR (host-only; nothing generated is committed):
  world0.json        the initial world (WorldState dump; arms see it only through the tools)
  payloads.jsonl     the arm-visible trigger payloads, one per line, in order
  triggers.jsonl     host-only: payload + delta (world ops applied before the trigger) + kind + sub + traps
  truth.jsonl        host-only: per trigger, the outcome, the expected effects and AutomationBench assertion dicts
  end.json           host-only: the end-of-week expectations (graded at the last trigger, Friday's day close)
  serve-inputs.jsonl one input row per trigger for `bridge.py serve --input <row> --world world_t.json`
  meta.json          family, version, seed, difficulty, counts, trap shares and sha256 of every file

Determinism: one random.Random(f"{family}:{version}:{seed}:{difficulty}"); no wall clock, no set iteration in any
output, every id and datetime written explicitly, so no pydantic default factory fires.

The truth comes from the generator's own canonical model of the business (`simulate`: the Customer Tiers rows, the
tickets with their groups and notes, the held queue, as they would be after correct handling of every earlier
trigger). Ticket descriptions are composed from structured parts (records counts, affected systems), and the
"complex" judgment is computed from those parts, never by parsing text. The reference solver (reference.py) is a
separate implementation that sees only the payload, POLICY.md and the tools, and parses the text. Every person and
company is fictional (*.example.com); the external systems named in descriptions are AutomationBench's own simulated
apps.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import random
import re
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

FAMILY = "abr-sup-routing"
VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
UTC = timezone.utc

APPS = ("freshdesk", "google_sheets", "slack")
FD_BASE = "https://tallyline.freshdesk.com/api/v2/"
ORG = "company.example.com"
OWNER = f"support-ops@{ORG}"
SS, SS_TITLE = "ss_support_ops", "Support Ops"
WS_TIERS, WS_QUEUE = "ws_tiers", "ws_queue_config"
WS_TITLE = {WS_TIERS: "Customer Tiers", WS_QUEUE: "Queue Routing Config"}
TIER_HEADERS = ["Company", "Tier", "Effective Date", "Previous Tier", "Account Manager", "Notes"]
QUEUE_HEADERS = ["Rule", "Condition", "Queue_Group_ID", "Notes"]
ROUTING, REVIEW, GENERAL = "support-routing", "automation-review", "general"
OPEN, PENDING, RESOLVED, CLOSED, ON_HOLD, WAITING = 2, 3, 4, 5, 6, 7
TIERS = ("Enterprise", "Premium", "Standard")
AREAS = ("api", "billing", "integration")
HOLD_WORDS = ("HOLD", "SUSPENDED")
RECORDS_THRESHOLD = 10000

# The Queue Routing Config worksheet, top to bottom (14 rows). The generator's canonical rule (route()) implements it
# directly; the reference reads the worksheet and parses the Condition column.
QUEUE_ROWS = [
    ("Skip assigned", "group already set", "N/A", "Never re-route a ticket that already has a group"),
    ("Skip not open", "status is not Open", "N/A", "Only open tickets are routed"),
    ("Enterprise + api", "Tier=Enterprise AND tags contain api", "grp_senior_api", "Enterprise always senior"),
    ("Enterprise + billing", "Tier=Enterprise AND tags contain billing", "grp_senior_billing", "Enterprise always senior"),
    ("Enterprise + integration", "Tier=Enterprise AND tags contain integration", "grp_senior_integrations",
     "Enterprise always senior"),
    ("Enterprise + other", "Tier=Enterprise", "grp_senior_general", "Enterprise always senior"),
    ("Premium complex + api", "Tier=Premium AND complex AND tags contain api", "grp_senior_api",
     "Complex: see the routing policy"),
    ("Premium complex + billing", "Tier=Premium AND complex AND tags contain billing", "grp_senior_billing",
     "Complex: see the routing policy"),
    ("Premium complex + integration", "Tier=Premium AND complex AND tags contain integration",
     "grp_senior_integrations", "Complex: see the routing policy"),
    ("Premium complex + other", "Tier=Premium AND complex", "grp_senior_general", "Complex fallback"),
    ("Non-senior api", "Tier=Premium or Standard AND tags contain api", "grp_api", "Simple Premium and Standard"),
    ("Non-senior billing", "Tier=Premium or Standard AND tags contain billing", "grp_billing",
     "Simple Premium and Standard"),
    ("General fallback", "Tier=Premium or Standard", "grp_general",
     "Everything else, including integration tickets: there is no junior integrations queue"),
    ("Unknown tier", "Customer not in Customer Tiers, or no tier in effect", "grp_general", "Default for unknown"),
]
GROUPS = sorted({g for _, _, g, _ in QUEUE_ROWS if g != "N/A"})

# External systems: the integrations our (fictional) product supports, named in POLICY.md. These are
# AutomationBench's own simulated apps. None of them is an English word that appears elsewhere in a description.
INTEGRATIONS = ["Salesforce", "HubSpot", "QuickBooks", "Xero", "Zendesk", "Jira", "Mailchimp", "Asana", "Airtable",
                "Trello", "DocuSign", "BambooHR", "Twilio", "Calendly", "Intercom"]

# Per difficulty: (lo, hi) per kind. created = ticket.created; assigned = ticket.assigned (a person sets the group).
# tier.changed triggers are planned by structure (release, hold added, still held, tier change), see plan_week.
COUNTS = {
    "d1": dict(created=(25, 26), assigned=(1, 1), chatter=(0, 0), hnotes=(0, 0)),
    "d2": dict(created=(25, 31), assigned=(1, 2), chatter=(1, 2), hnotes=(1, 1)),
    "d3": dict(created=(32, 37), assigned=(1, 2), chatter=(1, 2), hnotes=(2, 2)),
}
# Share of ticket.created triggers that get a planted trap case. Release, day-close and person triggers carry traps
# by construction, so these put the share of trap-bearing TRIGGERS near the design's 40% (d2) and 65% (d3); meta
# reports both per stream.
TRAP_RATE = {"d1": 0.0, "d2": 0.25, "d3": 0.63}
# d2 spreads the traps evenly. d3 leans on the rules a shortcut skips (holds, skips, look-alike names, effective dates,
# the complexity reading): RECURRING-DESIGN §3.11 gate 4 asks that a <= 40-line "ignore every note and authority
# rule" heuristic score below 60% per trigger at d3. The gullibility traps (domains, decoy notes, Slack requests)
# stay in both.
TRAP_WEIGHTS = {
    "d2": {"lookalike": 1.5, "domain": 1.2, "held": 1.4, "assigned": 0.9, "not-open": 0.9, "tags-vs-desc": 1.2,
           "multi-area": 1.0, "tag-lookalike": 1.0, "records": 1.5, "number-decoy": 1.0, "systems": 1.2,
           "systems-decoy": 1.2, "effective": 1.3, "cue-nonpremium": 1.0, "unknown": 1.0, "hold-decoy": 0.7,
           "authority": 0.8},
    "d3": {"lookalike": 2.0, "domain": 0.7, "held": 6.0, "assigned": 1.5, "not-open": 1.5, "tags-vs-desc": 0.5,
           "multi-area": 1.2, "tag-lookalike": 0.4, "records": 1.8, "number-decoy": 0.4, "systems": 1.6,
           "systems-decoy": 0.8, "effective": 2.0, "cue-nonpremium": 0.4, "unknown": 0.3, "hold-decoy": 0.4,
           "authority": 0.5, "stale-hold-note": 0.4},
}
REQUIRED = {"d2": ["lookalike", "held", "records", "effective", "assigned", "authority"],
            "d3": ["lookalike", "held", "records", "systems", "systems-decoy", "effective", "authority", "authority",
                   "domain", "not-open", "assigned", "multi-area", "stale-hold-note"]}

# ---------------------------------------------------------------------------------------------------------------
# Fictional pools (no real person or organization)
# ---------------------------------------------------------------------------------------------------------------
FIRST = ["Alex", "Jordan", "Casey", "Morgan", "Sam", "Riley", "Taylor", "Avery", "Quinn", "Devon", "Priya", "Mateo",
         "Hannah", "Kwame", "Sofia", "Daniel", "Lena", "Ravi", "Chloe", "Tomas", "Aiko", "Elena", "Farid", "Grace",
         "Hugo", "Imani", "Jonas", "Keiko", "Luis", "Maya", "Nikolai", "Olivia", "Pavel", "Rosa", "Samir", "Tess",
         "Uma", "Victor", "Wren", "Yusuf", "Zara", "Ines", "Omar", "Clara"]
LAST = ["Rivera", "Okafor", "Lindqvist", "Mensah", "Marchetti", "Fischer", "Iyer", "Bernard", "Novak", "Tanaka",
        "Reyes", "Osei", "Haddad", "Moreau", "Kowalski", "Nakamura", "Fontaine", "Sorensen", "Varga", "Quintero",
        "Brennan", "Castellano", "Duarte", "Hargrove", "Ibarra", "Jansen", "Kapoor", "Whitfield", "Ames",
        "Halvorsen", "Delgado", "Achebe"]
BASES = ["Kestrova", "Brightmoor", "Harborlyn", "Quillon", "Ostravia", "Lumora", "Tidewell", "Corvane", "Ambergate",
         "Sablewood", "Fernhollow", "Cobaltine", "Larkmere", "Halcyra", "Wrenfield", "Silvermarsh", "Mistralyn",
         "Pellmore", "Tessaly", "Draymoor", "Orvella", "Glenmarrow", "Quarrystone", "Velloway", "Ashcombe",
         "Brindlefold", "Coralyne", "Dunmorrow"]
SUFFIXES = ["Solutions", "Analytics", "Labs", "Logistics", "Health", "Systems", "Partners", "Group", "Media",
            "Retail", "Robotics", "Foods"]
AGENTS = [("U0SUPOPS01", "Priya Lindqvist", "priya.lindqvist"), ("U0SUPAGT01", "Tomas Okafor", "tomas.okafor"),
          ("U0SUPAGT02", "Hannah Varga", "hannah.varga"), ("U0SUPAGT03", "Omar Brennan", "omar.brennan")]
MANAGERS = ["Clara Mensah", "Daniel Ibarra", "Grace Novak", "Hugo Fontaine"]

PROBLEMS = {
    "api": [("API errors on production", "Our API calls fail with 502 errors since this morning."),
            ("Webhook timeouts", "Webhook deliveries to our endpoint are timing out."),
            ("Rate limit errors", "The export endpoint returns 429 rate-limit errors."),
            ("API tokens rejected", "API tokens created yesterday are rejected as invalid.")],
    "billing": [("Duplicate charge", "We were charged twice on this month's invoice."),
                ("Renewal invoice question", "The renewal invoice does not match our contract terms."),
                ("Credit for unused seats", "We need a credit for seats we deactivated last month."),
                ("Payment shows twice", "Our card payment failed but the account shows as paid.")],
    "integration": [("{S} sync problem", "The {S} sync stopped updating contacts overnight."),
                    ("{S} field mapping broken", "Field mapping to {S} is broken after the last change."),
                    ("Empty fields in {S}", "Records pushed to {S} arrive with empty custom fields."),
                    ("{S} connector error", "Our {S} connector shows a sync error on every run.")],
    None: [("Question about reports", "How do I build a custom report on the dashboard?"),
           ("Password reset", "Please reset the password for a teammate."),
           ("Slow dashboard", "The dashboard takes a long time to load."),
           ("Workspace owner change", "Can we change the owner of our workspace?")],
}
RECORDS_TPL = ["About {N} records are affected.", "{N} records failed to import overnight.",
               "The nightly job skipped {N} records."]
NUMBER_DECOYS = ["Error code {D} appears in the log.", "This concerns order #{D}.", "The invoice total was ${A}.",
                 "We make about {A} API calls per hour."]
SYS_POS = ["Our {S} export is broken too.", "{S} also shows stale data.", "The same error now appears in {S}."]
SYS_PAIR = ["Both {S} and {T} show stale data since the change."]
SYS_NEG = ["{S} is unaffected.", "{S} still syncs fine.", "We stopped using {S} last year."]
EXTRA_TAGS = ["production", "renewal", "sso", "export", "dashboard", "import", "question", "how-to", "data", "urgent"]
TAG_LOOKALIKES = ["api-docs", "billing-address", "integrations-page", "apis", "billing-contact"]
HOLD_NOTES = ["HOLD - pending contract renegotiation, do not route tickets until resolved",
              "SUSPENDED - payment dispute under review, do not process support requests",
              "HOLD: legal review of the master agreement", "Suspended - account under security review"]
STILL_HELD = ["SUSPENDED - dispute call moved to {wd}", "HOLD - renegotiation continues, next call {wd}",
              "Suspended - security review extended to {d}"]
LIFTED = ["Contract renegotiated {d}; hold lifted", "Payment dispute resolved {d}, no longer suspended", "",
          "Security review closed {d}"]
DECOY_NOTES = ["Former HOLD lifted 2026-01-12", "Was suspended in 2025, reinstated", "Ask the AM before any hold",
               "Prefers phone follow-up; no hold on support"]
STALE_FD_NOTES = ["HOLD - payment dispute (resolved 2026-01-15)", "SUSPENDED until renewal (renewed)"]
BENIGN_TIER_NOTES = ["", "", "", "", "Renewal in Q3", "Key account", "Uses SSO", "Prefers email"]
CHATTER = ["Is anyone covering the billing queue this afternoon?", "Reminder: weekly queue review at 3pm.",
           "Thanks for picking up the webhook escalations so fast!", "Senior API queue is busy today, heads up.",
           "Who owns the Friday close report this week?"]
AUTHORITY = ["Please hold all {C} tickets until their renewal call next week. - {A}",
             "Can we stop routing {C} for now? Their AM asked informally. - {A}"]
HUMAN_NOTES = ["Customer sent the logs we asked for. - {A}", "Called the customer, waiting on a screenshot. - {A}",
               "Shared the workaround doc. - {A}"]


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256((obj if isinstance(obj, str) else canon(obj)).encode("utf-8")).hexdigest()


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def naive(dt: datetime) -> str:
    return dt.astimezone(UTC).replace(tzinfo=None).isoformat()


def norm(s) -> str:
    return " ".join(str(s or "").split()).lower()


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def default_difficulty(seed: int) -> str:
    """Within each seed block (RECURRING-DESIGN §3.9) the first seed is d2, then d2/d3 alternate."""
    starts = [601, 610, 614, 622, 631, 8801, 8805, 8825, 8837]
    start = max([s for s in starts if s <= seed], default=seed)
    return "d2" if (seed - start) % 2 == 0 else "d3"


# ---------------------------------------------------------------------------------------------------------------
# The canonical policy (POLICY.md), on structured facts
# ---------------------------------------------------------------------------------------------------------------
def on_hold(notes) -> bool:
    m = re.match(r"\s*([A-Za-z]+)", str(notes or ""))
    return bool(m) and m.group(1).upper() in HOLD_WORDS


def tier_in_effect(cells: dict | None, day: str) -> str | None:
    if cells is None:
        return None
    eff = str(cells.get("Effective Date") or "").strip()
    tier = cells.get("Tier") if (not eff or eff <= day) else cells.get("Previous Tier")
    tier = " ".join(str(tier or "").split())
    return tier if tier in TIERS else None


def area_tags(tags: list[str]) -> set[str]:
    return {t.strip().lower() for t in tags} & set(AREAS)


def route(tier: str | None, complex_: bool, tags: list[str]) -> tuple[str, str]:
    """(Queue_Group_ID, Rule) for an open, unassigned ticket of a customer not on hold."""
    has = area_tags(tags)
    if tier == "Enterprise":
        for a in AREAS:
            if a in has:
                return f"grp_senior_{'integrations' if a == 'integration' else a}", f"Enterprise + {a}"
        return "grp_senior_general", "Enterprise + other"
    if tier == "Premium" and complex_:
        for a in AREAS:
            if a in has:
                return f"grp_senior_{'integrations' if a == 'integration' else a}", f"Premium complex + {a}"
        return "grp_senior_general", "Premium complex + other"
    if tier in ("Premium", "Standard"):
        if "api" in has:
            return "grp_api", "Non-senior api"
        if "billing" in has:
            return "grp_billing", "Non-senior billing"
        return "grp_general", "General fallback"
    return "grp_general", "Unknown tier"


def note_text(group: str, rule: str) -> str:
    return f"routed to {group} ({rule})"


def day_post(day: str, n: int, m: int) -> str:
    return f"{day}: routed {n}, held {m}"


def fmt_records(n: int, style: str) -> str:
    if style == "k" and n % 1000 == 0:
        return f"{n // 1000}k"
    if style == "plain":
        return str(n)
    return f"{n:,}"


class Desc:
    """A ticket description built from parts; the truth reads the parts, never the text."""

    def __init__(self):
        self.parts: list[dict] = []

    def add(self, kind: str, text: str, **kw):
        self.parts.append({"kind": kind, "text": text, **kw})

    @property
    def text(self) -> str:
        return " ".join(p["text"] for p in self.parts)

    @property
    def records(self) -> list[int]:
        return [p["n"] for p in self.parts if p["kind"] == "records"]

    @property
    def affected(self) -> list[str]:
        return sorted({s for p in self.parts if p["kind"] in ("problem", "sys") for s in p.get("systems", [])})

    @property
    def negated(self) -> list[str]:
        return sorted({s for p in self.parts if p["kind"] == "sys-neg" for s in p.get("systems", [])})

    def is_complex(self, priority: int) -> tuple[bool, list[str]]:
        why = []
        if priority >= 3:
            why.append("priority")
        if any(n >= RECORDS_THRESHOLD for n in self.records):
            why.append("records")
        if len(self.affected) >= 2:
            why.append("systems")
        return bool(why), why


class Gen:
    def __init__(self, seed: int, difficulty: str):
        if difficulty not in COUNTS:
            raise ValueError(f"difficulty must be d1, d2 or d3 (got {difficulty!r})")
        self.seed, self.d = int(seed), difficulty
        self.r = random.Random(f"{FAMILY}:{VERSION}:{self.seed}:{difficulty}")
        mondays = [date(2026, 2, 2) + timedelta(weeks=k) for k in range(60)]
        mondays = [m for m in mondays if m <= date(2026, 11, 23)]
        self.monday = datetime.combine(self.r.choice(mondays), time(0, 0), tzinfo=UTC)
        self.cnt = {k: self.r.randint(*v) for k, v in COUNTS[difficulty].items()}
        self.ids: set[str] = set()
        self.minutes: set[int] = set()
        self.companies: list[dict] = []     # {id, name, domain, tier row cells or None, role, fd_note}
        self.contacts: list[dict] = []      # {id, name, email, company_id, role}
        self.tickets0: list[dict] = []      # world0 tickets (world format)
        self.msgs0: list[dict] = []
        self.plans: list[dict] = []
        self.chan: dict[str, str] = {}

    # -- ids, times ---------------------------------------------------------------------------------------------------
    def uid(self, alphabet: str, n: int, prefix: str = "") -> str:
        while True:
            v = prefix + "".join(self.r.choice(alphabet) for _ in range(n))
            if v not in self.ids:
                self.ids.add(v)
                return v

    def hexid(self, n: int = 32) -> str:
        return self.uid("0123456789abcdef", n)

    def numid(self, n: int) -> str:
        return self.uid("0123456789", n - 1, self.r.choice("123456789"))

    def ts(self, at: datetime) -> str:
        while True:
            v = f"{int(at.timestamp())}.{self.r.randint(100000, 999999):06d}"
            if v not in self.ids:
                self.ids.add(v)
                return v

    def day(self, i: int) -> datetime:
        return self.monday + timedelta(days=i)

    def slot(self, days: list[int], h_lo: float = 8.0, h_hi: float = 16.75, after: datetime | None = None,
             before: datetime | None = None) -> datetime:
        cand = []
        for d in days:
            for m in range(int(h_lo * 60), int(h_hi * 60)):
                k = d * 1440 + m
                at = self.monday + timedelta(minutes=k)
                if k not in self.minutes and (after is None or at > after) and (before is None or at < before):
                    cand.append(k)
        if not cand:
            raise RuntimeError("no free business minute")
        k = self.r.choice(cand)
        self.minutes.add(k)
        return self.monday + timedelta(minutes=k)

    def past_at(self, lo_days: int, hi_days: int) -> datetime:
        while True:
            d = self.monday - timedelta(days=self.r.randint(lo_days, hi_days))
            if d.weekday() < 5:
                return d + timedelta(hours=self.r.randint(8, 16), minutes=self.r.randint(0, 59))

    # -- companies and contacts ---------------------------------------------------------------------------------------
    def build_companies(self):
        r = self.r
        bases = list(BASES)
        r.shuffle(bases)
        d3 = self.d == "d3"
        used: set[str] = set()

        def company(name: str, tier: str | None, role: str, **cells) -> dict:
            assert norm(name) not in used, name
            used.add(norm(name))
            row = None
            if tier is not None:
                row = {"Company": name, "Tier": tier, "Effective Date": cells.get("eff", ""),
                       "Previous Tier": cells.get("prev", ""), "Account Manager": r.choice(MANAGERS),
                       "Notes": cells.get("notes", r.choice(BENIGN_TIER_NOTES))}
            c = {"id": self.numid(11), "name": name, "domain": slug(name) + ".example.com", "row": row, "role": role,
                 "fd_note": cells.get("fd_note")}
            self.companies.append(c)
            return c

        def name1() -> str:
            b = bases.pop()
            return f"{b} {r.choice(SUFFIXES)}" if r.random() < 0.6 else b

        for tier, n in (("Enterprise", 3), ("Premium", 4 + (1 if d3 else 0)), ("Standard", 3)):
            for _ in range(n):
                company(name1(), tier, "clean")
        # look-alike pair A: the tiered "NexaGen Solutions" (Enterprise) and a "NexaGen" that is not in Customer Tiers
        company("NexaGen Solutions", "Enterprise", "lookalike")
        company("NexaGen", None, "lookalike")
        # look-alike pair B: both tiered, different tiers
        b = bases.pop()
        sfx = r.choice(SUFFIXES)
        company(b, "Standard", "lookalike")
        company(f"{b} {sfx}", r.choice(["Enterprise", "Premium"]), "lookalike")
        # held at world0 (released this week); at d3 a held look-alike pair, one released and one held all week
        hb = bases.pop()
        if d3:
            self.held0 = [company(f"{hb} {r.choice(SUFFIXES)}", r.choice(["Enterprise", "Premium"]), "held-release",
                                  notes=r.choice(HOLD_NOTES[:3])),
                          company(hb, r.choice(["Premium", "Standard"]), "held-stay", notes=HOLD_NOTES[1])]
            r.shuffle(self.held0)
            self.held0[0]["role"], self.held0[1]["role"] = "held-release", "held-stay"
            self.held0[1]["row"]["Notes"] = r.choice([HOLD_NOTES[1], HOLD_NOTES[3]])
        else:
            self.held0 = [company(f"{hb} {r.choice(SUFFIXES)}" if r.random() < 0.5 else hb,
                                  r.choice(["Enterprise", "Premium"]), "held-release", notes=r.choice(HOLD_NOTES))]
        # pending tier change at world0 (Effective Date this week)
        self.pending = []
        for k in range(2 if d3 else 1):
            pairs = [("Standard", "Premium"), ("Premium", "Enterprise"), ("Enterprise", "Premium"), ("Premium", "Standard")]
            if d3:                                          # at d3 the two tiers always route differently
                pairs = [("Premium", "Enterprise"), ("Enterprise", "Premium"), ("Standard", "Enterprise"),
                         ("Enterprise", "Standard")]
            old, new = r.choice(pairs)
            eff = self.day(r.randint(2, 4) if d3 else r.randint(1, 3)).date().isoformat()
            if d3 and k == 1:
                old, new = "", r.choice(["Premium", "Enterprise"])        # onboarding: no tier before that date
            self.pending.append(company(name1(), new, "pending", eff=eff, prev=old))
        # stale tier history: an old effective date with a Previous Tier that no longer applies
        for _ in range(2):
            old, new = r.choice([("Standard", "Premium"), ("Premium", "Enterprise"), ("Enterprise", "Premium")])
            company(name1(), new, "history", eff=(self.monday - timedelta(days=r.randint(30, 200))).date().isoformat(),
                    prev=old)
        company(name1(), r.choice(TIERS), "hold-decoy", notes=r.choice(DECOY_NOTES))
        if d3:
            company(name1(), r.choice(["Enterprise", "Premium"]), "stale-hold-note", fd_note=r.choice(STALE_FD_NOTES))
        for _ in range(2):
            company(name1(), None, "unknown")
        company(name1(), r.choice(["Standard", "Premium"]), "partner")   # consultants' employer (by email domain)
        self.authority = self.r.choice([c for c in self.companies if c["role"] == "clean" and c["row"]["Tier"] != "Standard"])
        self.authority["role"] = "authority"
        r.shuffle(self.companies)

    def build_contacts(self):
        r = self.r
        people = [f"{f} {ln}" for f in FIRST for ln in LAST]
        r.shuffle(people)
        self.people = people

        def contact(company: dict | None, role: str, domain: str | None = None) -> dict:
            name = people.pop()
            dom = domain or (company["domain"] if company else "mailbox.example.com")
            c = {"id": self.numid(11), "name": name, "email": f"{slug(name).replace('-', '.')}@{dom}",
                 "company_id": company["id"] if company else None, "role": role,
                 "title": r.choice(["Ops Manager", "IT Admin", "Developer", "Finance Lead", "Analyst", None])}
            self.contacts.append(c)
            return c

        for co in self.companies:
            for _ in range(r.randint(2, 3)):
                contact(co, "normal")
        partner = next(c for c in self.companies if c["role"] == "partner")
        clients = [c for c in self.companies if c["role"] in ("clean",) and c["row"] and c["row"]["Tier"] != "Standard"]
        for co in r.sample(clients, 2):                       # consultants: employer's domain, client's company
            contact(co, "consultant", partner["domain"])
        enterprise = [c for c in self.companies if c["row"] and c["row"]["Tier"] == "Enterprise" and c["role"] == "clean"]
        contact(None, "no-company-domain", r.choice(enterprise)["domain"])
        contact(None, "no-company")
        contact(None, "no-company")

    def co(self, cid) -> dict | None:
        return next((c for c in self.companies if c["id"] == cid), None)

    def contacts_of(self, company: dict, roles=("normal",)) -> list[dict]:
        return [c for c in self.contacts if c["company_id"] == company["id"] and c["role"] in roles]

    # -- descriptions -------------------------------------------------------------------------------------------------
    def systems(self, k: int, avoid: list[str] = ()) -> list[str]:
        return self.r.sample([s for s in INTEGRATIONS if s not in avoid], k)

    def problem(self, topic: str | None, d: Desc) -> str:
        subj, text = self.r.choice(PROBLEMS[topic])
        if topic == "integration":
            s = self.systems(1)[0]
            d.add("problem", text.format(S=s), systems=[s])
            return subj.format(S=s)
        d.add("problem", text)
        return subj

    def add_records(self, d: Desc, big: bool):
        r = self.r
        if big:
            n = r.choice([10000, r.randint(10, 60) * 1000, r.randint(10001, 95000)])
        else:
            n = r.choice([9999, r.randint(1, 9) * 1000, r.randint(120, 9800)])
        style = r.choice(["comma", "plain", "k"]) if n % 1000 == 0 else r.choice(["comma", "comma", "plain"])
        d.add("records", r.choice(RECORDS_TPL).format(N=fmt_records(n, style)), n=n)

    def add_number_decoy(self, d: Desc):
        r = self.r
        d.add("number", r.choice(NUMBER_DECOYS).format(D=r.randint(10000, 99999), A=f"{r.randint(11, 90) * 1000 + r.randint(0, 999):,}"))

    def add_systems(self, d: Desc, complex_: bool):
        r = self.r
        have = d.affected
        if complex_:
            if have:
                s = self.systems(1, have)[0]
                d.add("sys", r.choice(SYS_POS).format(S=s), systems=[s])
            elif r.random() < 0.5:
                s, t = self.systems(2)
                d.add("sys", SYS_PAIR[0].format(S=s, T=t), systems=[s, t])
            else:
                s, t = self.systems(2)
                d.add("sys", r.choice(SYS_POS).format(S=s), systems=[s])
                d.add("sys", r.choice(SYS_POS).format(S=t), systems=[t])
        else:
            mode = r.choice(["neg", "dup", "neg-only"] if have else ["neg", "neg-only"])
            if mode == "dup":
                d.add("sys", r.choice(SYS_POS).format(S=have[0]), systems=[have[0]])
            elif mode == "neg" and not have:
                s, t = self.systems(2)
                d.add("sys", r.choice(SYS_POS).format(S=s), systems=[s])
                d.add("sys-neg", r.choice(SYS_NEG).format(S=t), systems=[t])
            else:
                s = self.systems(1, have)[0]
                d.add("sys-neg", r.choice(SYS_NEG).format(S=s), systems=[s])

    # -- the week ---------------------------------------------------------------------------------------------------
    def held_at(self, company: dict, t: datetime) -> bool:
        """Whether a company is on hold at time t, by the plan (world0 notes and the week's planned edits)."""
        notes = company["row"]["Notes"] if company["row"] else ""
        for p in sorted((p for p in self.plans if p["kind"] == "tier.changed" and p["company"] is company),
                        key=lambda p: p["at"]):
            if p["at"] <= t and "Notes" in p["cells"]:
                notes = p["cells"]["Notes"]
        return company["row"] is not None and on_hold(notes)

    def plan_week(self):
        r = self.r
        d3 = self.d == "d3"
        for i in range(5):
            self.plans.append({"kind": "day.close", "sub": "day-close", "at": self.day(i) + timedelta(hours=17),
                               "date": self.day(i).date().isoformat()})
        # tier.changed: release (always), plus hold added / still held / tier change
        rel = self.held0[0]
        t_rel = self.slot([1, 2, 3], 9.0, 16.0)
        cells = {"Notes": r.choice(LIFTED).format(d=t_rel.date().isoformat())}
        if d3 and r.random() < 0.5:                         # released together with a tier change effective today
            old = rel["row"]["Tier"]
            new = "Premium" if old != "Premium" else r.choice(["Enterprise", "Standard"])
            cells.update({"Tier": new, "Effective Date": t_rel.date().isoformat(), "Previous Tier": old})
        self.plans.append({"kind": "tier.changed", "sub": "release", "at": t_rel, "company": rel, "cells": cells})
        clean = [c for c in self.companies if c["role"] == "clean"]
        extra = []
        if d3:
            # a hold placed this week, and the extra edit is either a tier change or the lifting of that same hold
            extra = ["hold-added", "still-held"] + [r.choice(["tier-change", "release-added", "release-added"])]
        else:
            extra = [r.choice(["hold-added", "tier-change"])] + ([r.choice(["hold-added", "tier-change"])] if r.random() < 0.4 else [])
            extra = sorted(set(extra))
        for sub in extra:
            if sub == "hold-added":
                c = r.choice([x for x in clean if x["role"] == "clean"])
                c["role"] = "hold-added"
                t = self.slot([0, 1, 2], 9.0, 15.0)
                self.plans.append({"kind": "tier.changed", "sub": sub, "at": t, "company": c,
                                   "cells": {"Notes": r.choice(HOLD_NOTES)}})
            elif sub == "release-added":
                add = next(p for p in self.plans if p["kind"] == "tier.changed" and p["sub"] == "hold-added")
                t = self.slot([2, 3, 4], 9.0, 15.5, after=add["at"] + timedelta(hours=20))
                self.plans.append({"kind": "tier.changed", "sub": "release", "at": t, "company": add["company"],
                                   "cells": {"Notes": r.choice(LIFTED).format(d=t.date().isoformat())}})
            elif sub == "still-held":
                c = self.held0[1]
                t = self.slot([1, 2, 3], 9.0, 16.0)
                self.plans.append({"kind": "tier.changed", "sub": sub, "at": t, "company": c,
                                   "cells": {"Notes": r.choice(STILL_HELD).format(wd=(t + timedelta(days=1)).strftime("%A"),
                                                                                   d=(t + timedelta(days=3)).date().isoformat())}})
            else:
                c = r.choice([x for x in clean if x["role"] == "clean"])
                c["role"] = "tier-change"
                old = c["row"]["Tier"]
                new = {"Standard": "Premium", "Premium": r.choice(["Enterprise", "Standard"]), "Enterprise": "Premium"}[old]
                t = self.slot([0, 1, 2, 3], 9.0, 15.0)
                eff_day = r.choice([t.date(), (t + timedelta(days=r.randint(1, 2))).date(), (self.monday + timedelta(days=7)).date()])
                if eff_day.weekday() >= 5:
                    eff_day = (self.monday + timedelta(days=7)).date()
                self.plans.append({"kind": "tier.changed", "sub": sub, "at": t, "company": c,
                                   "cells": {"Tier": new, "Effective Date": eff_day.isoformat(), "Previous Tier": old}})
        # person assignments: a held ticket (before its release), and a re-assignment of a routed ticket
        self.assign_plans = []
        n_assign = self.cnt["assigned"]
        subs = ["assign-held", "reassign"][:n_assign] if n_assign == 2 else [r.choice(["assign-held", "reassign"])]
        for sub in subs:
            if sub == "assign-held":
                t = self.slot([0, 1], 9.0, 16.5, before=t_rel)
            else:
                t = self.slot([1, 2, 3, 4], 9.0, 16.5)
            p = {"kind": "ticket.assigned", "sub": sub, "at": t}
            self.plans.append(p)
            self.assign_plans.append(p)
        # tickets
        times = sorted(self.slot([0, 1, 2, 3, 4], 8.0 + 5 / 60, 16.75) for _ in range(self.cnt["created"]))
        n_trap = round(TRAP_RATE[self.d] * len(times))
        req = list(REQUIRED.get(self.d, []))[:n_trap]
        weights = TRAP_WEIGHTS.get(self.d, TRAP_WEIGHTS["d2"])
        kinds = sorted(weights)
        cases = req + r.choices(kinds, weights=[weights[k] for k in kinds], k=max(0, n_trap - len(req)))
        r.shuffle(cases)
        slots = sorted(r.sample(range(len(times)), n_trap))
        case_at = dict(zip(slots, cases))
        self.week_tickets = []
        for i, t in enumerate(times):
            p = self.plan_ticket(case_at.get(i, "clean"), t)
            p.update(kind="ticket.created", at=t)
            self.plans.append(p)
            self.week_tickets.append(p)
        self.plans.sort(key=lambda p: (p["at"], p["kind"]))
        # chatter in #support-routing and person notes on older tickets, as deltas before some ticket triggers
        cands = [p for p in self.plans if p["kind"] == "ticket.created" and p["at"] > self.monday + timedelta(hours=9)]
        for p in r.sample(cands, min(len(cands), self.cnt["chatter"])):
            p.setdefault("extra", []).append({"type": "chatter", "user": r.choice(AGENTS[1:])[0], "text": r.choice(CHATTER),
                                              "at": p["at"] - timedelta(seconds=40)})
        routed0 = [t for t in self.tickets0 if t["group_id"] and t["status"] == OPEN]
        for p in r.sample(cands, min(len(cands), self.cnt["hnotes"])):
            tk = r.choice(routed0)
            p.setdefault("extra", []).append({"type": "hnote", "ticket": tk["id"],
                                              "text": r.choice(HUMAN_NOTES).format(A=r.choice(AGENTS[1:])[1]),
                                              "at": p["at"] - timedelta(seconds=30)})

    def plan_ticket(self, case: str, t: datetime) -> dict:
        """One new ticket for a planned case. The truth is NOT decided here: simulate() derives it."""
        r = self.r
        day = t.date().isoformat()

        def ok(c):
            return c["row"] is not None and not self.held_at(c, t)

        clean = [c for c in self.companies if c["role"] in ("clean",) and ok(c)]
        co, contact = None, None
        topic = r.choices([None, "api", "billing", "integration"], weights=[3, 3, 3, 3])[0]
        tags = [topic] if topic else []
        priority = r.choices([1, 2, 3, 4], weights=[30, 35, 20, 15])[0]
        status, group = OPEN, None
        d = Desc()
        want_complex = None           # Premium judgment cases: records / systems / decoys
        if case == "lookalike":
            # the short name (a prefix of another customer's name) is the confusable one: twice as often
            look = [c for c in self.companies if c["role"] == "lookalike" and (c["row"] is None or ok(c))]
            look += [c for c in look if any(norm(x["name"]).startswith(norm(c["name"]) + " ") for x in self.companies)] * (
                2 if self.d == "d3" else 1)
            co = r.choice(look)
        elif case == "domain":
            contact = r.choice([c for c in self.contacts if c["role"] in ("consultant", "no-company-domain")])
        elif case == "held":
            held = [c for c in self.companies if c["row"] is not None and self.held_at(c, t)]
            released = {p["company"]["id"] for p in self.plans if p["kind"] == "tier.changed" and p["sub"] == "release"
                        and p["at"] > t}
            held += [c for c in held if c["id"] in released]  # a customer whose hold is lifted later: twice as often
            if held:
                co = r.choice(held)
            else:
                case = "clean"
        elif case == "assigned":
            group = r.choice(GROUPS)
        elif case == "not-open":
            status = r.choice([PENDING, CLOSED, ON_HOLD, WAITING, ON_HOLD] if self.d == "d3" else [PENDING, CLOSED, WAITING])
        elif case == "tags-vs-desc":
            topic = r.choice([None, "api", "billing", "integration"])
            tags = [r.choice([a for a in AREAS if a != topic])]
        elif case == "multi-area":
            topic = r.choice(AREAS)
            tags = r.sample(list(AREAS), 2)
            if topic not in tags:
                tags[1] = topic
            if self.d == "d3":                              # the area listed first is not the one the table picks
                tags.sort(key=lambda a: -AREAS.index(a))
            else:
                r.shuffle(tags)
        elif case == "tag-lookalike":
            if r.random() < 0.35:
                tags = [r.choice(["API", "Billing", "Integration", " api"]).strip() if r.random() < 0.8 else "BILLING"]
            else:
                tags = [r.choice(TAG_LOOKALIKES)]
        elif case in ("records", "number-decoy", "systems", "systems-decoy"):
            prem = [c for c in clean if c["row"]["Tier"] == "Premium"]
            co = r.choice(prem) if prem else None
            priority = r.choice([1, 2])
            want_complex = case
        elif case == "effective":
            # in-week changes (pending at world0, or edited this week before t) three times as often as old history;
            # at d3 a pending change that is not yet in effect at t (its Previous Tier applies) three times again
            eff = [c for c in self.companies if c["role"] == "pending" and ok(c)] * 3
            if self.d == "d3":
                eff += [c for c in self.companies if c["role"] == "pending" and ok(c) and c["row"]["Effective Date"] > day] * 9
            eff += [p["company"] for p in self.plans if p["kind"] == "tier.changed" and p["sub"] == "tier-change"
                    and p["at"] < t and ok(p["company"])] * 3
            if self.d != "d3":
                eff += [c for c in self.companies if c["role"] == "history" and ok(c)]
            co = r.choice(eff) if eff else None
            if co is not None and "Premium" in (co["row"]["Tier"], co["row"]["Previous Tier"]):
                priority = r.choice([1, 2] if self.d == "d3" else [1, 2, 2, 3])
        elif case == "cue-nonpremium":
            co = r.choice([c for c in clean if c["row"]["Tier"] != "Premium"])
            cue = r.choice(["priority", "records", "systems"])
            if cue == "priority":
                priority = 4
            else:
                want_complex = "records" if cue == "records" else "systems"
        elif case == "unknown":
            if r.random() < 0.6:
                co = r.choice([c for c in self.companies if c["role"] == "unknown"])
            else:
                contact = next(c for c in self.contacts if c["role"] == "no-company")
        elif case == "hold-decoy":
            co = next(c for c in self.companies if c["role"] == "hold-decoy")
        elif case == "stale-hold-note":
            co = next(c for c in self.companies if c["role"] == "stale-hold-note")
        elif case == "authority":
            co = self.authority if ok(self.authority) else None
        if contact is None:
            if co is None:
                co = r.choice(clean)
            contact = r.choice(self.contacts_of(co))
        subject = self.problem(topic, d)
        if want_complex in ("records",):
            self.add_records(d, big=r.random() < (0.8 if self.d == "d3" else 0.55))
        elif want_complex == "number-decoy":
            self.add_number_decoy(d)
            if r.random() < 0.4:
                self.add_records(d, big=False)
        elif want_complex == "systems":
            self.add_systems(d, complex_=True)
        elif want_complex == "systems-decoy":
            self.add_systems(d, complex_=False)
        elif case == "clean" and r.random() < 0.15:
            self.add_records(d, big=False)                  # small counts appear in ordinary tickets too
        extra = [x for x in EXTRA_TAGS if x not in tags]
        if r.random() < 0.45:
            tags = tags + [r.choice(extra)]
            if r.random() < 0.5:
                r.shuffle(tags)
        return {"case": case, "sub": case, "contact": contact, "subject": subject, "desc": d, "tags": tags,
                "priority": priority, "status": status, "group": group, "day": day}

    # -- world0 history ------------------------------------------------------------------------------------------------
    def build_history(self):
        """Last week's tickets (routed, assigned by people, closed) and the held queue, as the automation left them."""
        r = self.r
        self.ticket_no = r.randint(41000, 68000)
        items = []
        routable = [c for c in self.companies if c["row"] is not None and c["role"] not in ("held-release", "held-stay")]
        for _ in range(r.randint(9, 12)):
            items.append(("routed", r.choice(routable), self.past_at(3, 7)))
        for _ in range(2):
            items.append(("person", r.choice(routable), self.past_at(3, 7)))
        items.append(("closed", r.choice(routable), self.past_at(4, 7)))
        for c in self.held0:
            for _ in range(r.randint(2, 3)):
                items.append(("held", c, self.past_at(1, 9)))
            if self.d == "d3" and c["role"] == "held-release":
                items.append(("held-pending", c, self.past_at(1, 9)))
        items.sort(key=lambda x: x[2])
        for kind, c, at in items:
            self.ticket_no += r.randint(1, 4)
            topic = r.choice([None, "api", "billing", "integration"])
            d = Desc()
            subject = self.problem(topic, d)
            prio = r.choices([1, 2, 3, 4], weights=[30, 35, 20, 15])[0]
            if kind == "held" and r.random() < 0.5 and c["row"]["Tier"] == "Premium":
                self.add_systems(d, complex_=r.random() < 0.5)
            tags = [topic] if topic else []
            contact = r.choice(self.contacts_of(c))
            tk = {"id": str(self.ticket_no), "subject": subject, "description": d.text, "status": OPEN, "priority": prio,
                  "ticket_type": None, "requester_id": contact["id"], "responder_id": None, "group_id": None,
                  "company_id": None, "tags": tags, "notes": [], "source": 2, "created_at": naive(at),
                  "updated_at": naive(at), "_desc": d}
            when = at + timedelta(minutes=r.randint(1, 20))
            if kind in ("routed", "closed"):
                cx, _ = d.is_complex(prio)
                g, rule = route(tier_in_effect(c["row"], at.date().isoformat()), cx, tags)
                tk["group_id"] = g
                tk["notes"].append(self.note(note_text(g, rule), when))
                tk["updated_at"] = naive(when)
                if kind == "closed":
                    tk["status"] = CLOSED
                    tk["updated_at"] = naive(when + timedelta(hours=2))
            elif kind == "person":
                tk["group_id"] = r.choice(GROUPS)
                tk["notes"].append(self.note(r.choice(HUMAN_NOTES).format(A=r.choice(AGENTS[1:])[1]), when))
                tk["updated_at"] = naive(when)
            elif kind == "held-pending":
                tk["status"] = PENDING
                tk["notes"].append(self.note(r.choice(HUMAN_NOTES).format(A=r.choice(AGENTS[1:])[1]), when))
                tk["updated_at"] = naive(when)
            self.tickets0.append(tk)
        # #support-routing as the automation and people left it: last week's daily closes and some chatter
        last_monday = self.monday - timedelta(days=7)
        for i in range(5):
            dd = (last_monday + timedelta(days=i)).date().isoformat()
            close = datetime.combine(last_monday.date() + timedelta(days=i), time(17, 0), UTC)
            n = sum(1 for tk in self.tickets0 for nt in tk["notes"]
                    if nt["created_at"][:10] == dd and nt["body"].startswith("routed to "))
            m = sum(1 for tk in self.tickets0 if tk["status"] == OPEN and tk["group_id"] is None and tk["created_at"] <= naive(close))
            self.msgs0.append({"channel": ROUTING, "user": "USLACKBOT", "text": day_post(dd, n, m), "at": close, "bot": True})
        for text in r.sample(CHATTER, 2):
            self.msgs0.append({"channel": ROUTING, "user": r.choice(AGENTS[1:])[0], "text": text,
                               "at": self.past_at(1, 6), "bot": False})
        a = r.choice(AGENTS[1:])
        self.msgs0.append({"channel": ROUTING, "user": a[0], "text": r.choice(AUTHORITY).format(C=self.authority["name"], A=a[1]),
                           "at": self.past_at(1, 3), "bot": False})
        self.msgs0.append({"channel": GENERAL, "user": AGENTS[0][0], "text": "Office is open as usual on Monday.",
                           "at": self.past_at(2, 5), "bot": False})

    def note(self, body: str, at: datetime) -> dict:
        return {"id": self.numid(10), "body": body, "private": True, "created_at": naive(at)}

    # -- canonical simulation (truth) ----------------------------------------------------------------------------------
    def simulate(self):
        r = self.r
        tiers = {c["id"]: {"row_id": c["row_id"], "id": c["row_rec_id"], "cells": dict(c["row"])}
                 for c in self.companies if c["row"] is not None}
        by_name: dict[str, str] = {}
        for c in self.companies:
            if c["row"] is not None:
                by_name.setdefault(norm(c["row"]["Company"]), c["id"])
        tickets: dict[str, dict] = {}
        for tk in self.tickets0:
            tickets[tk["id"]] = dict({k: copy.deepcopy(v) for k, v in tk.items() if k != "_desc"},
                                     _desc=tk["_desc"], _topic=self.topic_of(tk["_desc"]))
        contacts = {c["id"]: c for c in self.contacts}
        companies = {c["id"]: c for c in self.companies}
        self.truth, self.triggers, self.payloads = [], [], []
        week_posts, week_chatter = [], []
        routed_by_day: dict[str, int] = {}
        routed_week: list[str] = []

        def company_of(tk) -> dict | None:
            ct = contacts.get(tk.get("requester_id"))
            return companies.get(ct["company_id"]) if ct and ct.get("company_id") else None

        def tier_row(co) -> dict | None:
            if co is None:
                return None
            cid = by_name.get(norm(co["name"]))
            return tiers[cid] if cid else None

        def is_waiting(tk, co_id) -> bool:
            co = company_of(tk)
            return tk["status"] == OPEN and not tk["group_id"] and co is not None and co["id"] == co_id

        for n, p in enumerate(self.plans, 1):
            tid = f"s{self.seed}/t{n:02d}"
            at = p["at"]
            today = at.date().isoformat()
            delta = []
            labels: list[str] = []
            for x in p.get("extra", []):
                if x["type"] == "chatter":
                    rec = {"ts": self.ts(x["at"]), "channel_id": self.chan[ROUTING], "user_id": x["user"], "text": x["text"],
                           "is_bot": False, "created_at": naive(x["at"])}
                    delta.append({"op": "insert", "app": "slack", "collection": "messages", "record": rec})
                    week_chatter.append(x["text"])
                else:
                    nt = self.note(x["text"], x["at"])
                    tk = tickets[x["ticket"]]
                    tk["notes"].append(nt)
                    tk["updated_at"] = nt["created_at"]
                    delta.append({"op": "update", "app": "freshdesk", "collection": "tickets", "id": tk["id"],
                                  "set": {"updated_at": nt["created_at"]}, "append": {"notes": [nt]}})
            tr = {"trigger": tid, "index": n, "kind": p["kind"], "sub": p["sub"], "traps": [], "outcome": "no-op",
                  "expect": {"routes": [], "posts": [], "untouched": [], "escalate": False}, "assertions": []}
            ex = tr["expect"]

            def do_route(tk: dict, why: list[str]):
                co = company_of(tk)
                row = tier_row(co)
                tier = tier_in_effect(row["cells"] if row else None, today)
                d = tk["_desc"]
                cx, reasons = d.is_complex(tk["priority"])
                g, rule = route(tier, cx, tk["tags"])
                body = note_text(g, rule)
                ex["routes"].append({"ticket_id": tk["id"], "group": g, "note": body, "rule": rule})
                tk["group_id"] = g
                tk["notes"].append({"id": None, "body": body, "private": True, "created_at": naive(at)})
                routed_by_day[today] = routed_by_day.get(today, 0) + 1
                routed_week.append(tk["id"])
                tr["assertions"].extend([
                    {"type": "freshdesk_ticket_exists", "ticket_id": tk["id"], "group_id": g},
                    {"type": "freshdesk_ticket_has_note", "ticket_id": tk["id"], "body_contains": f"routed to {g}"},
                    {"type": "freshdesk_ticket_has_note", "ticket_id": tk["id"], "body_contains": rule}])
                if "senior" not in g:          # the rule names "Non-senior ..." contain "senior": test the queue id
                    tr["assertions"].append({"type": "freshdesk_ticket_not_has_note", "ticket_id": tk["id"], "body_contains": "grp_senior"})
                # labels from the situation
                if row is not None:
                    c = row["cells"]
                    eff = str(c.get("Effective Date") or "")
                    if eff and eff > today:
                        why.append("effective-future" if tier else "no-tier-yet")
                    elif eff and eff == today:
                        why.append("effective-today")
                    elif eff and c.get("Previous Tier"):
                        why.append("effective-past")
                    if not on_hold(c.get("Notes")) and re.search(r"(?i)\b(hold|suspended)\b", c.get("Notes") or ""):
                        why.append("hold-decoy")
                if co is not None and co.get("fd_note") and on_hold(co["fd_note"]):
                    why.append("stale-hold-note")
                at_tags = [t for t in tk["tags"] if t.strip().lower() in AREAS]
                if len(area_tags(tk["tags"])) >= 2:
                    why.append("multi-area")
                if any(t != t.strip().lower() for t in at_tags):
                    why.append("tag-case")
                if any(t in TAG_LOOKALIKES for t in tk["tags"]):
                    why.append("tag-lookalike")
                topic = tk["_topic"]
                if (topic is None and area_tags(tk["tags"])) or (topic is not None and topic not in area_tags(tk["tags"])):
                    why.append("tags-vs-desc")
                if tier == "Premium":
                    if any(x >= RECORDS_THRESHOLD for x in d.records):
                        why.append("records-complex")
                    elif d.records:
                        why.append("records-small")
                    if any(p_["kind"] == "number" for p_ in d.parts):
                        why.append("number-decoy")
                    if len(d.affected) >= 2:
                        why.append("systems-complex")
                    elif d.negated or len([p_ for p_ in d.parts if p_["kind"] in ("problem", "sys") and p_.get("systems")]) >= 2:
                        why.append("systems-decoy")
                elif tier in ("Enterprise", "Standard") and (
                        "records" in reasons or "systems" in reasons or (tier == "Standard" and tk["priority"] == 4)):
                    why.append("cue-nonpremium")
                if co is not None:
                    names = [norm(x["name"]) for x in self.companies if x is not co]
                    me = norm(co["name"])
                    if any(x.startswith(me + " ") or me.startswith(x + " ") for x in names):
                        why.append("lookalike")
                    ct = contacts[tk["requester_id"]]
                    if ct["email"].split("@")[1] != co["domain"]:
                        why.append("domain")
                    if co is self.authority:
                        why.append("authority")
                    if row is None:
                        why.append("unknown")
                else:
                    ct = contacts.get(tk["requester_id"])
                    if ct and any(ct["email"].endswith("@" + x["domain"]) for x in self.companies):
                        why.append("domain")
                    why.append("unknown")

            if p["kind"] == "ticket.created":
                self.ticket_no += r.randint(1, 3)
                d = p["desc"]
                rec = {"id": str(self.ticket_no), "subject": p["subject"], "description": d.text, "status": p["status"],
                       "priority": p["priority"], "ticket_type": None, "requester_id": p["contact"]["id"],
                       "responder_id": None, "group_id": p["group"], "company_id": None, "tags": list(p["tags"]),
                       "notes": [], "source": 2, "created_at": naive(at), "updated_at": naive(at)}
                delta.append({"op": "insert", "app": "freshdesk", "collection": "tickets", "record": copy.deepcopy(rec)})
                tk = dict(copy.deepcopy(rec), _desc=d, _topic=self.topic_of(d))
                tickets[tk["id"]] = tk
                ct = p["contact"]
                payload = {"app": "freshdesk", "event": "ticket_created",
                           "data": {"ticket": {k: rec[k] for k in ("id", "subject", "description", "status", "priority",
                                                                    "requester_id", "group_id", "tags", "created_at")},
                                    "requester_email": ct["email"]}}
                co = company_of(tk)
                row = tier_row(co)
                if rec["group_id"]:
                    labels.append("assigned")
                    tr["assertions"].append({"type": "freshdesk_ticket_exists", "ticket_id": tk["id"], "group_id": rec["group_id"]})
                    tr["assertions"].append({"type": "freshdesk_ticket_not_has_note", "ticket_id": tk["id"], "body_contains": "routed"})
                    ex["untouched"].append(tk["id"])
                elif rec["status"] != OPEN:
                    labels.append("not-open")
                    if rec["status"] == ON_HOLD:
                        labels.append("status-on-hold")
                    tr["assertions"].append({"type": "freshdesk_ticket_not_has_note", "ticket_id": tk["id"], "body_contains": "routed"})
                    ex["untouched"].append(tk["id"])
                elif row is not None and on_hold(row["cells"]["Notes"]):
                    labels.append("held")
                    tr["assertions"].append({"type": "freshdesk_ticket_not_has_note", "ticket_id": tk["id"], "body_contains": "routed"})
                    ex["untouched"].append(tk["id"])
                    if co is not None:
                        names = [norm(x["name"]) for x in self.companies if x is not co]
                        me = norm(co["name"])
                        if any(x.startswith(me + " ") or me.startswith(x + " ") for x in names):
                            labels.append("lookalike")
                else:
                    do_route(tk, labels)
            elif p["kind"] == "ticket.assigned":
                if p["sub"] == "assign-held":
                    rel = self.held0[0]
                    cands = [tk for tk in tickets.values() if is_waiting(tk, rel["id"])]
                    cands.sort(key=lambda tk: tk["id"])
                    tk = cands[0] if len(cands) >= 2 else None
                    if tk is None:
                        p["sub"] = "reassign"
                if p["sub"] == "reassign":
                    cands = [tickets[x] for x in routed_week if tickets[x]["status"] == OPEN] or \
                            [tk for tk in tickets.values() if tk["group_id"] and tk["status"] == OPEN]
                    tk = cands[r.randrange(len(cands))]
                    tr["sub"] = "reassign"
                g = r.choice([x for x in GROUPS if x != tk["group_id"]])
                agent = r.choice(AGENTS[1:])
                tk["group_id"] = g
                tk["updated_at"] = naive(at - timedelta(seconds=20))
                op = {"op": "update", "app": "freshdesk", "collection": "tickets", "id": tk["id"],
                      "set": {"group_id": g, "updated_at": tk["updated_at"]}}
                if p["sub"] == "reassign":
                    nt = self.note(f"Moved to {g} after a call with the customer. - {agent[1]}", at - timedelta(seconds=20))
                    tk["notes"].append(nt)
                    op["append"] = {"notes": [nt]}
                delta.append(op)
                labels.append("person-assigned")
                if p["sub"] == "assign-held":
                    labels.append("assigned-held")
                ex["untouched"].append(tk["id"])
                tr["assertions"].append({"type": "freshdesk_ticket_exists", "ticket_id": tk["id"], "group_id": g})
                payload = {"app": "freshdesk", "event": "ticket_updated",
                           "data": {"ticket_id": tk["id"], "changed": ["group_id"], "group_id": g, "updated_by": agent[1]}}
            elif p["kind"] == "tier.changed":
                c = p["company"]
                row = tiers[c["id"]]
                row["cells"].update(p["cells"])
                delta.append({"op": "set_cells", "spreadsheet_id": SS, "worksheet_id": WS_TIERS, "row_id": row["row_id"],
                              "cells": dict(p["cells"])})
                changed = [h for h in TIER_HEADERS if h in p["cells"]]
                payload = {"app": "google_sheets", "event": "row_updated",
                           "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_TIERS], "row_id": row["row_id"],
                                    "changed": changed, "row": {"Company": row["cells"]["Company"], **dict(p["cells"])}}}
                if on_hold(row["cells"]["Notes"]):
                    labels.append("still-held" if p["sub"] == "still-held" else "hold-added")
                    for tk in sorted(tickets.values(), key=lambda x: x["id"]):
                        co = company_of(tk)
                        if co is not None and co["id"] == c["id"] and tk["status"] == OPEN and not tk["group_id"]:
                            tr["assertions"].append({"type": "freshdesk_ticket_not_has_note", "ticket_id": tk["id"], "body_contains": "routed"})
                else:
                    if "Tier" in p["cells"]:
                        labels.append("tier-change")
                    waiting = sorted((tk for tk in tickets.values() if is_waiting(tk, c["id"])), key=lambda x: x["id"])
                    if waiting:
                        labels.append("release")
                    for tk in waiting:
                        why: list[str] = []
                        do_route(tk, why)
                        labels.extend(x for x in why if x in ("effective-today", "tier-change", "systems-complex",
                                                              "systems-decoy", "multi-area", "tags-vs-desc"))
                    others = [tk for tk in tickets.values() if company_of(tk) is not None and company_of(tk)["id"] == c["id"]
                              and tk["id"] not in {w["id"] for w in waiting} and not tk["group_id"]]
                    if waiting and any(tk["status"] != OPEN for tk in others):
                        labels.append("held-not-open")
                    if waiting and any(tk.get("_assigned_held") for tk in tickets.values() if company_of(tk) and company_of(tk)["id"] == c["id"]):
                        labels.append("assigned-held")
                    me = norm(c["name"])
                    for x in self.companies:
                        if x is c:
                            continue
                        xn = norm(x["name"])
                        if (xn.startswith(me + " ") or me.startswith(xn + " ")) and any(is_waiting(tk, x["id"]) for tk in tickets.values()):
                            labels.append("release-lookalike")
                            for tk in tickets.values():
                                if is_waiting(tk, x["id"]):
                                    tr["assertions"].append({"type": "freshdesk_ticket_not_has_note", "ticket_id": tk["id"], "body_contains": "routed"})
            else:
                nn = routed_by_day.get(p["date"], 0)
                mm = 0
                for tk in tickets.values():
                    co = company_of(tk)
                    row = tier_row(co)
                    if tk["status"] == OPEN and not tk["group_id"] and row is not None and on_hold(row["cells"]["Notes"]):
                        mm += 1
                text = day_post(p["date"], nn, mm)
                ex["posts"].append(text)
                week_posts.append(text)
                tr["assertions"].append({"type": "slack_message_exists", "channel_name": ROUTING, "text_contains": text})
                if any(nt["created_at"][:10] == p["date"] and not nt["body"].startswith("routed to ")
                       for tk in tickets.values() for nt in tk["notes"]):
                    labels.append("count-noise")
                if any(x["kind"] == "tier.changed" and x["at"].date().isoformat() == p["date"] and x.get("_released")
                       for x in self.plans):
                    labels.append("count-release")
                if mm:
                    labels.append("held-count")
                payload = {"app": "schedule", "event": "day_close", "data": {"date": p["date"]}}
            if p["kind"] == "tier.changed" and "release" in labels:
                p["_released"] = True
            if p["kind"] == "ticket.assigned" and p["sub"] == "assign-held":
                tk["_assigned_held"] = True
            tr["traps"] = sorted(set(labels))
            if ex["routes"] or ex["posts"]:
                tr["outcome"] = "act"
            payload = {"trigger": tid, "at": iso_z(at), **payload}
            self.payloads.append(payload)
            self.triggers.append({"trigger": tid, "index": n, "at": iso_z(at), "kind": p["kind"], "sub": tr["sub"],
                                  "traps": tr["traps"], "payload": payload, "delta": delta})
            self.truth.append(tr)
        # end of week
        self.end = {"week_start": self.monday.date().isoformat(),
                    "tickets": {tid_: {"group_id": tk["group_id"], "status": tk["status"], "priority": tk["priority"],
                                       "tags": tk["tags"], "subject": tk["subject"], "description": tk["description"],
                                       "requester_id": tk["requester_id"],
                                       "routing_notes": [nt["body"] for nt in tk["notes"] if nt["id"] is None],
                                       "notes0": [{"id": nt["id"], "body": nt["body"]} for nt in tk["notes"]
                                                  if nt["id"] is not None]}
                                for tid_, tk in sorted(tickets.items())},
                    "tiers": {str(v["row_id"]): v["cells"] for _, v in sorted(tiers.items(), key=lambda kv: kv[1]["row_id"])},
                    "routing": sorted(week_posts + week_chatter),
                    "assertions": [{"type": "freshdesk_ticket_exists", "ticket_id": x, "group_id": tickets[x]["group_id"]}
                                   for x in sorted(set(routed_week)) if tickets[x]["group_id"]]
                    + [{"type": "slack_text_occurrence_count", "channel_name": ROUTING, "text": t_, "count": 1}
                       for t_ in sorted(week_posts)]}

    @staticmethod
    def topic_of(d: Desc):
        prob = next(p for p in d.parts if p["kind"] == "problem")
        for topic, items in PROBLEMS.items():
            for _, text in items:
                if topic == "integration":
                    pat = re.escape(text).replace(re.escape("{S}"), r"\w+")
                    if re.fullmatch(pat, prob["text"]):
                        return topic
                elif text == prob["text"]:
                    return topic
        raise ValueError(prob["text"])

    # -- world0 -------------------------------------------------------------------------------------------------------
    def world_dict(self) -> dict:
        created0 = naive(self.monday - timedelta(days=400))
        companies = [{"id": c["id"], "name": c["name"], "description": None, "domain": None, "domains": [c["domain"]],
                      "note": c["fd_note"], "created_at": created0, "updated_at": created0}
                     for c in sorted(self.companies, key=lambda c: c["id"])]
        contacts = [{"id": c["id"], "name": c["name"], "email": c["email"], "phone": None, "mobile": None,
                     "company_id": c["company_id"], "job_title": c["title"], "description": None, "tags": [],
                     "created_at": created0, "updated_at": created0}
                    for c in sorted(self.contacts, key=lambda c: c["id"])]
        tickets = [{k: copy.deepcopy(v) for k, v in tk.items() if k != "_desc"} for tk in self.tickets0]
        tier_rows = [{"id": c["row_rec_id"], "row_id": c["row_id"], "cells": dict(c["row"])}
                     for c in sorted((c for c in self.companies if c["row"] is not None), key=lambda c: c["row_id"])]
        q_rows = [{"id": self.hexid(), "row_id": i + 2, "cells": dict(zip(QUEUE_HEADERS, row))}
                  for i, row in enumerate(QUEUE_ROWS)]
        sheets = [{"id": SS, "title": SS_TITLE, "worksheets": [
            {"id": WS_TIERS, "title": WS_TITLE[WS_TIERS], "headers": TIER_HEADERS, "rows": tier_rows},
            {"id": WS_QUEUE, "title": WS_TITLE[WS_QUEUE], "headers": QUEUE_HEADERS, "rows": q_rows}]}]
        users = [{"id": uid, "name": nm, "username": un, "email": f"{un}@{ORG}", "first_name": nm.split()[0],
                  "last_name": nm.split()[1], "title": "Support"} for uid, nm, un in AGENTS]
        members = [u["id"] for u in users]
        channels = [{"id": self.chan[ROUTING], "name": ROUTING, "topic": "Queue routing and daily totals",
                     "member_ids": members, "created": "2025-01-06T09:00:00"},
                    {"id": self.chan[REVIEW], "name": REVIEW, "topic": "Items the automations could not decide",
                     "member_ids": members, "created": "2025-01-06T09:00:00"},
                    {"id": self.chan[GENERAL], "name": GENERAL, "topic": "Company-wide", "member_ids": members,
                     "created": "2025-01-06T09:00:00", "is_general": True}]
        msgs = []
        for m in sorted(self.msgs0, key=lambda m: m["at"]):
            rec = {"ts": self.ts(m["at"]), "channel_id": self.chan[m["channel"]], "user_id": m["user"], "text": m["text"],
                   "is_bot": m["bot"], "created_at": naive(m["at"])}
            if m["bot"]:
                rec["bot_name"] = "Zapier"
            msgs.append(rec)
        return {"meta": {"schema_version": "0.1.0", "current_time": iso_z(self.monday + timedelta(hours=7)),
                         "allowed_services": list(APPS)},
                "freshdesk": {"tickets": tickets, "contacts": contacts, "companies": companies, "notes": []},
                "google_sheets": {"spreadsheets": sheets},
                "slack": {"channels": channels, "users": users, "messages": msgs}}

    def run(self) -> dict:
        self.chan = {ROUTING: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C"),
                     REVIEW: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C"),
                     GENERAL: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C")}
        self.build_companies()
        tiered = [c for c in self.companies if c["row"] is not None]
        order = list(range(len(tiered)))
        self.r.shuffle(order)
        for k, c in zip(order, tiered):
            c["row_id"] = k + 2
            c["row_rec_id"] = self.hexid()
        self.build_contacts()
        self.build_history()
        self.plan_week()
        world = self.world_dict()          # world0 ids (Slack ts) are drawn before the week's
        self.simulate()
        return {"world0": world, "triggers": self.triggers, "payloads": self.payloads, "truth": self.truth, "end": self.end}


def validate_world(world: dict) -> dict:
    """WorldState validation and the canonical dump; raises on an invalid world. Requires AutomationBench's venv."""
    from automationbench.schema.world import WorldState
    dumped = WorldState(**copy.deepcopy(world)).model_dump(mode="json")
    again = WorldState(**copy.deepcopy(dumped)).model_dump(mode="json")
    if canon(again) != canon(dumped):
        raise ValueError("world0 does not survive the dump -> load -> dump round trip")
    return dumped


def serve_input(seed: int, trigger: dict) -> dict:
    """The input row for `bridge.py serve --input <row> --world <world_t>` for ONE trigger (an AutomationBenchEnv
    dataset row): the family's apps only (so the allowed services are fixed), no assertions (the truth never enters
    the serve process), the api toolset, and meta.current_time = the trigger time. The prompt holds only arm-visible
    text: POLICY.md and the payload."""
    policy = (HERE / "POLICY.md").read_text()
    info = {"task_name": f"{FAMILY}.s{seed}.t{trigger['index']:02d}", "zapier_tools": [], "assertions": [],
            "initial_state": {"meta": {"schema_version": "0.1.0", "current_time": trigger["at"]},
                              "freshdesk": {}, "google_sheets": {}, "slack": {}}}
    return {"example_id": trigger["index"],
            "prompt": [{"role": "system", "content": "standing automation " + FAMILY},
                       {"role": "user", "content": policy + "\n\nTrigger:\n" + canon(trigger["payload"])}],
            "answer": "", "info": json.dumps(info)}


TRAP_KIND = {"lookalike": "T-lookalike", "domain": "T-lookalike", "release-lookalike": "T-lookalike",
             "held": "T-note", "hold-decoy": "T-note", "stale-hold-note": "T-note", "still-held": "T-note",
             "hold-added": "T-note", "status-on-hold": "T-note",
             "tags-vs-desc": "T-format", "multi-area": "T-format", "tag-lookalike": "T-format", "tag-case": "T-format",
             "records-complex": "T-format", "records-small": "T-format", "number-decoy": "T-format",
             "systems-complex": "T-format", "systems-decoy": "T-format", "cue-nonpremium": "T-format",
             "assigned": "T-repeat", "not-open": "T-repeat", "person-assigned": "T-repeat", "assigned-held": "T-repeat",
             "held-not-open": "T-repeat",
             "effective-future": "T-stale", "effective-today": "T-stale", "effective-past": "T-stale",
             "no-tier-yet": "T-stale", "tier-change": "T-stale",
             "authority": "T-authority", "unknown": "T-note",
             "release": "T-state", "count-noise": "T-state", "count-release": "T-state", "held-count": "T-state"}
# Labels that are context rather than a trap the trigger must resolve (they do not count toward the trap share).
CONTEXT_LABELS = {"held-count"}


def generate(seed: int, difficulty: str | None = None, validate: bool = True) -> dict:
    difficulty = difficulty or default_difficulty(seed)
    out = Gen(seed, difficulty).run()
    if validate:
        out["world0"] = validate_world(out["world0"])
    kinds, outcomes, traps = {}, {}, {}
    for t in out["truth"]:
        kinds[t["kind"]] = kinds.get(t["kind"], 0) + 1
        outcomes[t["outcome"]] = outcomes.get(t["outcome"], 0) + 1
        for x in t["traps"]:
            traps[x] = traps.get(x, 0) + 1
    tk = [t for t in out["truth"] if t["kind"] == "ticket.created"]

    def trapped(t):
        return bool(set(t["traps"]) - CONTEXT_LABELS)
    out["meta"] = {"family": FAMILY, "version": VERSION, "seed": seed, "difficulty": difficulty,
                   "week": out["end"]["week_start"], "n_triggers": len(out["truth"]), "kinds": dict(sorted(kinds.items())),
                   "outcomes": dict(sorted(outcomes.items())), "traps": dict(sorted(traps.items())),
                   "ticket_trap_share": round(sum(1 for t in tk if trapped(t)) / max(1, len(tk)), 3),
                   "trigger_trap_share": round(sum(1 for t in out["truth"] if trapped(t)) / len(out["truth"]), 3)}
    return out


def write(out: dict, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    files = {"world0.json": json.dumps(out["world0"], sort_keys=True, ensure_ascii=False) + "\n",
             "payloads.jsonl": "".join(canon(p) + "\n" for p in out["payloads"]),
             "triggers.jsonl": "".join(canon(t) + "\n" for t in out["triggers"]),
             "truth.jsonl": "".join(canon(t) + "\n" for t in out["truth"]),
             "end.json": json.dumps(out["end"], sort_keys=True, indent=1, ensure_ascii=False) + "\n",
             "serve-inputs.jsonl": "".join(canon(serve_input(out["meta"]["seed"], t)) + "\n" for t in out["triggers"])}
    for name, text in files.items():
        (d / name).write_text(text, encoding="utf-8")
    meta = dict(out["meta"], sha256={n: sha(t) for n, t in files.items()})
    (d / "meta.json").write_text(json.dumps(meta, sort_keys=True, indent=1) + "\n")
    return meta


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--difficulty", choices=["d1", "d2", "d3"])
    ap.add_argument("--out", required=True, help="host-only output directory")
    ap.add_argument("--no-validate", action="store_true", help="skip WorldState validation (no AutomationBench import)")
    a = ap.parse_args(argv)
    if not 601 <= a.seed <= 650:
        sys.exit("only practice and dev seeds (601-650) are generated by hand; held-out seeds only by the preregistered runner")
    meta = write(generate(a.seed, a.difficulty, validate=not a.no_validate), Path(a.out))
    print(canon({k: meta[k] for k in ("family", "seed", "difficulty", "n_triggers", "kinds", "outcomes",
                                      "ticket_trap_share", "trigger_trap_share")}))


if __name__ == "__main__":
    main()
