#!/usr/bin/env python3
"""abr-sup-gdpr: seeded stream generator (AutomationBench-R family 8; research/automationbench-20261014/
RECURRING-DESIGN.md §3.2, §4.8). Runs inside AutomationBench's own venv (it validates worlds with its WorldState):

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-sup-gdpr/gen.py \
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

The truth comes from the generator's own canonical model of the business (`Gen.simulate`: requests, the Compliance
Log, the holds, the Zendesk users and tickets as they would be after correct handling of every earlier trigger), never
from a solver's output. The plan only says what happens in the world (who writes in, who replies from which address,
which hold changes); the expected effects are derived by applying the policy to that world, and the planned intent is
then asserted against the derivation (a planning bug fails generation). The reference solver (reference.py) is a
separate implementation that sees only the payload, POLICY.md and the tools. Every person, company and address is
fictional (RFC 2606 *.example.com / .net / .org).
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

FAMILY = "abr-sup-gdpr"
VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
UTC = timezone.utc

APPS = ("zendesk", "google_sheets", "gmail", "slack")
SS, SS_TITLE = "ss_gdpr", "GDPR Processing"
WS_REQ, WS_HOLD, WS_LOG, WS_CFG = "ws_requests", "ws_legal_hold", "ws_compliance_log", "ws_config"
WS_TITLE = {WS_REQ: "Erasure Requests", WS_HOLD: "Legal Hold", WS_LOG: "Compliance Log", WS_CFG: "Report Config"}
REQ_HEADERS = ["Request ID", "Email", "Name", "Requested Date", "Source"]
HOLD_HEADERS = ["Email", "Hold Reason", "Case Reference", "Status", "Updated"]
LOG_HEADERS = ["Request ID", "Email", "Transition", "At", "Reference"]
CFG_HEADERS = ["Setting", "Value"]
ORG_DOMAIN = "company.example.com"
INBOX = f"privacy@{ORG_DOMAIN}"
PRIVACY_OPS, REVIEW, GENERAL = "privacy-ops", "automation-review", "general"
PREFIX, TAG = "[GDPR Purged] ", "gdpr-purged"
VS, VERIFIED, BLOCKED, PURGED = "Verification Sent", "Verified", "Blocked - Legal Hold", "Purged"
NOT_FOUND, DUPLICATE, CLOSED = "Not Found", "Duplicate", "Closed - Unverified"
TRANSITIONS = [VS, VERIFIED, BLOCKED, PURGED, NOT_FOUND, DUPLICATE, CLOSED]
OPEN_FOR_DUP = (VS, BLOCKED, PURGED)
DEADLINE_DAYS = 30
ID_RE = re.compile(r"\bGDPR-\d+\b")


def subj_verify(rid: str) -> str:
    return f"Verify your erasure request {rid}"


def subj_notfound(rid: str) -> str:
    return f"Erasure request {rid}: no account found"


def subj_hold(rid: str) -> str:
    return f"Erasure request {rid}: on legal hold"


def subj_closed(rid: str) -> str:
    return f"Erasure request {rid}: closed unverified"


def summary_post(day: str, n: int, m: int, batch: str) -> str:
    return f"{day}: {n} purged, {m} blocked, batch {batch}"


# Per difficulty: (lo, hi) per trigger kind. req = erasure.requested, rep = verification.reply (all inbound email),
# hold = legal_hold.changed, dup = erasure.duplicate, bad = replies that verify nothing (spoofed, forwarded, no ID,
# late, repeated, wrong ID).
COUNTS = {
    "d1": dict(req=(8, 8), rep=(6, 6), hold=(1, 1), dup=(1, 1), bad=(0, 0)),
    "d2": dict(req=(8, 10), rep=(6, 8), hold=(1, 2), dup=(1, 2), bad=(2, 2)),
    "d3": dict(req=(10, 12), rep=(8, 10), hold=(2, 3), dup=(2, 3), bad=(4, 4)),
}

# ---------------------------------------------------------------------------------------------------------------
# Fictional pools (no real person or organization). Domains use the RFC 2606 reserved names only.
# ---------------------------------------------------------------------------------------------------------------
FIRST = ["Lena", "Jonas", "Amara", "Tobias", "Ines", "Mateo", "Priya", "Kwame", "Sofia", "Daniel", "Hannah", "Ravi",
         "Chloe", "Tomas", "Aiko", "Elena", "Farid", "Grace", "Hugo", "Imani", "Keiko", "Luis", "Maya", "Nikolai",
         "Olivia", "Pavel", "Rosa", "Samir", "Tess", "Uma", "Victor", "Wren", "Yusuf", "Zara", "Omar", "Clara",
         "Felix", "Greta", "Henrik", "Isla", "Julien", "Kira", "Leon", "Mira", "Nadia", "Oskar", "Pia", "Rafael"]
LAST = ["Fischer", "Brandt", "Okafor", "Lindqvist", "Mensah", "Marchetti", "Iyer", "Bernard", "Novak", "Tanaka",
        "Reyes", "Osei", "Haddad", "Moreau", "Kowalski", "Nakamura", "Fontaine", "Sorensen", "Varga", "Quintero",
        "Brennan", "Castellano", "Duarte", "Hargrove", "Ibarra", "Jansen", "Kapoor", "Whitfield", "Ames", "Halvorsen",
        "Delgado", "Achebe", "Albrecht", "Bauer", "Costa", "Dahl", "Eriksen", "Ferreira", "Gallo", "Holm"]
BRANDS = [("nordwind", "Nordwind Logistics"), ("brightwave", "Brightwave Media"), ("calloway", "Calloway Foods"),
          ("fernhill", "Fernhill Studio"), ("harborlight", "Harborlight Travel"), ("juniperworks", "Juniper Works"),
          ("kestrel", "Kestrel Analytics"), ("larchmont", "Larchmont Clinics"), ("meridale", "Meridale Retail"),
          ("oakvale", "Oakvale Energy"), ("pinecroft", "Pinecroft Legal"), ("quillon", "Quillon Software"),
          ("silverfen", "Silverfen Labs"), ("tidewell", "Tidewell Marine")]
FREEMAIL = ["mailbox.example.org", "postbox.example.net", "inbox.example.org", "webpost.example.com"]
RELAY = "mailrelay.example.net"
TICKET_SUBJECTS = ["Cannot reset password", "Invoice shows the wrong VAT number", "CSV export fails", "Login loop on the mobile app",
                   "Refund for a duplicate charge", "Change of shipping address", "Two-factor codes not arriving",
                   "API rate limit questions", "Account locked after the update", "Feature request: dark mode",
                   "Webhook retries failing", "Cannot add a team member", "Data export for Q2", "Billing contact change",
                   "Order arrived damaged", "Calendar sync stopped", "Upgrade to the annual plan", "Missing loyalty points",
                   "Report totals do not match", "Notification emails go to spam", "Cancel my subscription",
                   "Wrong currency on the invoice", "Search returns no results", "SSO setup help"]
TICKET_DESC = ["Since last week I cannot get past this step.", "This started after the last update.",
               "Could you look into this please? Screenshots attached.", "We need this fixed before the end of the month.",
               "Happens on both the web app and the phone.", "Second time this month.", "Please advise on next steps.",
               "Our finance team flagged this.", "It worked fine until Monday."]
TAG_POOL = ["billing", "vip", "mobile", "api", "refund", "escalated", "enterprise", "onboarding"]
STATUSES = [("open", 30), ("pending", 15), ("solved", 30), ("closed", 10), ("new", 15)]
PRIORITIES = ["low", "normal", "normal", "high", "urgent"]
HOLD_REASONS = ["Pending litigation", "Regulatory inquiry", "Chargeback dispute", "Employment tribunal",
                "Insurance claim review"]
SOURCES = ["Web form", "Web form", "Web form", "Email to privacy inbox", "Phone (entered by staff)"]
CHATTER = ["Reminder: legal hold list was reviewed with counsel this morning.",
           "Privacy training for the support team is on Thursday.",
           "If a requester calls, ask them to reply to the verification email from the same address."]
TEAM = [("U0PRIVOFF01", "Marta Albrecht", "marta.albrecht"), ("U0PRIVOFF02", "Joel Hargrove", "joel.hargrove"),
        ("U0SUPLEAD01", "Nina Costa", "nina.costa")]
AGENTS = [("usr_90001", "Marta Albrecht", "marta.albrecht@company.example.com"),
          ("usr_90002", "Support Desk", "support@company.example.com")]

TRAP_KIND = {
    "lookalike-domain": "T-lookalike", "same-name": "T-lookalike", "hold-lookalike": "T-lookalike", "wrong-id": "T-lookalike",
    "spoof-lookalike": "T-authority", "spoof-forward": "T-authority", "spoof-display": "T-authority",
    "spoof-colleague": "T-authority",
    "cc-user": "T-note", "org-domain": "T-note", "no-id": "T-note", "hold-on-request": "T-note", "on-hold": "T-note",
    "hold-added": "T-note",
    "duplicate-open": "T-repeat", "duplicate-purged": "T-repeat", "duplicate-blocked": "T-repeat",
    "duplicate-case": "T-repeat", "repeat-reply": "T-repeat", "late-reply": "T-repeat",
    "case-address": "T-format", "case-sender": "T-format", "keep-tags": "T-format", "no-tickets": "T-format",
    "id-in-body": "T-format", "backdated": "T-format",
    "re-request": "T-stale", "hold-lifted-row": "T-stale", "batch-changed": "T-stale",
    "deadline": "T-timing", "deadline-weekend": "T-timing", "deadline-not-yet": "T-timing", "deadline-day": "T-timing",
    "hold-lift": "T-state", "hold-still": "T-state", "count-lift": "T-state",
}
BAD_TYPES = ["spoof-lookalike", "spoof-forward", "spoof-display", "spoof-colleague", "no-id", "late-reply",
             "repeat-reply", "wrong-id"]


# ---------------------------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------------------------
def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256((obj if isinstance(obj, str) else canon(obj)).encode("utf-8")).hexdigest()


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def naive(dt: datetime) -> str:
    return dt.astimezone(UTC).replace(tzinfo=None).isoformat()


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def norm_addr(s) -> str:
    """POLICY.md section 3: the same address = equal after ignoring letter case and surrounding spaces."""
    return str(s or "").strip().lower()


def sender_addr(header) -> str:
    """The address of a From header: the part in angle brackets when there is one, else the whole value."""
    m = re.search(r"<([^<>]+)>\s*$", str(header or ""))
    return norm_addr(m.group(1) if m else header)


def default_difficulty(seed: int) -> str:
    """Within each seed block (RECURRING-DESIGN §3.9) the first seed is d2, then d2/d3 alternate."""
    starts = [601, 610, 614, 622, 631, 8801, 8805, 8825, 8837]
    start = max([s for s in starts if s <= seed], default=seed)
    return "d2" if (seed - start) % 2 == 0 else "d3"


def snippet_of(body: str) -> str:
    return " ".join(body.split())[:100]


class PlanError(RuntimeError):
    pass


# ---------------------------------------------------------------------------------------------------------------
# generator
# ---------------------------------------------------------------------------------------------------------------
class Gen:
    def __init__(self, seed: int, difficulty: str, attempt: int = 0):
        if difficulty not in COUNTS:
            raise ValueError(f"difficulty must be d1, d2 or d3 (got {difficulty!r})")
        self.seed, self.d, self.attempt = int(seed), difficulty, attempt
        self.r = random.Random(f"{FAMILY}:{VERSION}:{self.seed}:{difficulty}" + (f":{attempt}" if attempt else ""))
        mondays = [date(2026, 2, 2) + timedelta(weeks=k) for k in range(60)]
        mondays = [m for m in mondays if m <= date(2026, 11, 23)]
        self.monday = datetime.combine(self.r.choice(mondays), time(0, 0), tzinfo=UTC)
        self.cnt = {k: self.r.randint(*v) for k, v in COUNTS[difficulty].items()}
        self.ids: set[str] = set()
        self.minutes: set[int] = set()
        self.emails: set[str] = set()       # every address in use (users, requests, holds, senders)
        self.names: set[str] = set()
        self.orgs: list[dict] = []
        self.users: list[dict] = []         # world0 Zendesk users (end-users)
        self.tickets: list[dict] = []       # world0 Zendesk tickets
        self.requests: list[dict] = []      # every request (history, pre-seeded, this week)
        self.log0: list[dict] = []          # world0 Compliance Log rows {cells, at}
        self.holds0: list[dict] = []        # world0 Legal Hold rows {cells}
        self.mail0: list[dict] = []         # world0 Gmail messages
        self.posts0: list[dict] = []        # world0 Slack messages
        self.events: list[dict] = []        # the week's triggers (plan)
        self.used: set[str] = set()         # user ids already given a role
        self.chan: dict[str, str] = {}

    # -- ids, times ---------------------------------------------------------------------------------------------------
    def uid(self, alphabet: str, n: int, prefix: str = "") -> str:
        while True:
            v = prefix + "".join(self.r.choice(alphabet) for _ in range(n))
            if v not in self.ids:
                self.ids.add(v)
                return v

    def hexid(self, n: int = 16) -> str:
        return self.uid("0123456789abcdef", n)

    def num(self, prefix: str, n: int) -> str:
        return self.uid("0123456789", n, prefix)

    def ts(self, at: datetime) -> str:
        while True:
            v = f"{int(at.timestamp())}.{self.r.randint(100000, 999999):06d}"
            if v not in self.ids:
                self.ids.add(v)
                return v

    def day(self, i: int) -> datetime:
        return self.monday + timedelta(days=i)

    @property
    def friday_end(self) -> datetime:
        return self.day(4) + timedelta(hours=16, minutes=50)

    def slot(self, lo: datetime, hi: datetime, h_lo: float = 8.05, h_hi: float = 16.85) -> datetime:
        """A free business minute (Monday-Friday, h_lo..h_hi UTC) strictly inside (lo, hi)."""
        cand = []
        for d in range(5):
            for m in range(int(round(h_lo * 60)), int(round(h_hi * 60))):
                k = d * 1440 + m
                at = self.monday + timedelta(minutes=k)
                if k not in self.minutes and lo < at < hi:
                    cand.append(k)
        if not cand:
            raise PlanError(f"no free business minute in ({lo}, {hi})")
        k = self.r.choice(cand)
        self.minutes.add(k)
        return self.monday + timedelta(minutes=k)

    def past(self, days_before: int, h_lo: int = 8, h_hi: int = 17) -> datetime:
        """A time on the calendar day `days_before` days before Monday (any weekday or weekend day)."""
        d = self.monday - timedelta(days=days_before)
        return d + timedelta(hours=self.r.randint(h_lo, h_hi - 1), minutes=self.r.randint(0, 59))

    def first_close_at_or_after(self, req_date: date) -> datetime:
        """The first weekday 17:00 on or after Requested Date + 30 days (POLICY section 8)."""
        d = req_date + timedelta(days=DEADLINE_DAYS)
        while d.weekday() >= 5:
            d += timedelta(days=1)
        return datetime.combine(d, time(17, 0), tzinfo=UTC)

    # -- people -------------------------------------------------------------------------------------------------------
    def person(self) -> tuple[str, str]:
        while True:
            f, ln = self.r.choice(FIRST), self.r.choice(LAST)
            if f"{f} {ln}" not in self.names:
                self.names.add(f"{f} {ln}")
                return f, ln

    def new_email(self, local: str, domain: str) -> str:
        e = f"{local}@{domain}".lower()
        k = 2
        while e in self.emails:
            e = f"{local}{k}@{domain}".lower()
            k += 1
        self.emails.add(e)
        return e

    def org_local(self, f: str, ln: str) -> str:
        return self.r.choice([f"{f}.{ln}", f"{f[0]}{ln}", f"{f}.{ln[0]}", f"{f}{ln}"]).lower()

    def free_local(self, f: str, ln: str) -> str:
        return self.r.choice([f"{f}.{ln}{self.r.randint(1, 99)}", f"{f}{ln[0]}{self.r.randint(10, 99)}",
                              f"{f}_{ln}"]).lower()

    def lookalike(self, email: str, avoid_plus: bool = False) -> str:
        """A different address that a careless reader takes for `email` (POLICY section 3 lists these as different)."""
        local, dom = email.split("@")
        brand, rest = dom.split(".", 1)
        opts = []
        for tld in ("example.com", "example.net", "example.org"):
            if rest != tld:
                opts.append(f"{local}@{brand}.{tld}")
        opts.append(f"{local}@{brand}-de.{rest}")
        for a, b in (("i", "1"), ("l", "1"), ("o", "0"), ("m", "rn")):
            if a in brand:
                opts.append(f"{local}@{brand.replace(a, b, 1)}.{rest}")
        if "." in local:
            opts.append(f"{local.replace('.', '', 1)}@{dom}")
        else:
            opts.append(f"{local[:1]}.{local[1:]}@{dom}")
        if not avoid_plus:
            opts.append(f"{local}+privacy@{dom}")
        opts = [o for o in opts if o not in self.emails]
        if not opts:
            raise PlanError(f"no look-alike for {email}")
        e = self.r.choice(opts)
        self.emails.add(e)
        return e

    def case_variant(self, email: str) -> str:
        local, dom = email.split("@")
        parts = re.split(r"([._-])", local)
        local2 = "".join(p.capitalize() if p not in "._-" else p for p in parts)
        dom2 = dom.split(".", 1)[0].capitalize() + "." + dom.split(".", 1)[1]
        out = f"{local2}@{dom2}"
        if out == email:
            out = email.upper()
        return out

    # -- Zendesk base -------------------------------------------------------------------------------------------------
    def add_user(self, f: str, ln: str, org: dict | None, email: str | None = None) -> dict:
        email = email or (self.new_email(self.org_local(f, ln), org["domain"]) if org
                          else self.new_email(self.free_local(f, ln), self.r.choice(FREEMAIL)))
        created = self.monday - timedelta(days=self.r.randint(60, 700), minutes=self.r.randint(0, 1439))
        u = {"id": self.num("usr_", 5), "name": f"{f} {ln}", "email": email, "org": org["id"] if org else None,
             "created": created}
        self.users.append(u)
        return u

    def add_ticket(self, u: dict, subject: str | None = None, desc: str | None = None, tags: list | None = None,
                   comments: list | None = None, requester_id: str | None = None, org: str | None = None) -> dict:
        r = self.r
        created = self.monday - timedelta(days=r.randint(2, 120), minutes=r.randint(0, 1439))
        if tags is None:
            tags = sorted(r.sample(TAG_POOL, r.choice([1, 1, 2]))) if r.random() < 0.3 else []
        t = {"id": self.num("tkt_", 5), "subject": subject or r.choice(TICKET_SUBJECTS),
             "description": desc or r.choice(TICKET_DESC), "status": r.choices([s for s, _ in STATUSES],
                                                                               weights=[w for _, w in STATUSES])[0],
             "priority": r.choice(PRIORITIES), "requester": requester_id or u["id"],
             "org": org if org is not None else u.get("org"), "tags": list(tags), "comments": comments or [],
             "created": created}
        if not t["comments"] and r.random() < 0.5:
            author = u["id"] if r.random() < 0.5 else AGENTS[0][0]
            t["comments"] = [{"id": self.num("cmt_", 6), "body": "Any update on this?" if author == u["id"]
                              else "Thanks, we are looking into it.", "author": author,
                              "at": created + timedelta(hours=r.randint(1, 30))}]
        self.tickets.append(t)
        return t

    def build_zendesk(self):
        r = self.r
        brands = r.sample(BRANDS, r.randint(7, 9))
        for b, title in brands:
            self.orgs.append({"id": self.num("org_", 3), "name": title, "domain": f"{b}.example.com"})
        for o in self.orgs:
            for _ in range(r.randint(3, 5)):
                f, ln = self.person()
                self.add_user(f, ln, o)
        for _ in range(r.randint(12, 15)):
            f, ln = self.person()
            self.add_user(f, ln, None)
        for u in list(self.users):
            subjects = r.sample(TICKET_SUBJECTS, r.choices([0, 1, 2, 3], weights=[20, 35, 30, 15])[0])
            for s in subjects:
                self.add_ticket(u, s)

    def pick_user(self, need_org: bool | None = None, tickets: str | None = None) -> dict:
        """An end-user not yet given a role. tickets: 'some', 'none', 'tagged' or None."""
        pool = [u for u in self.users if u["id"] not in self.used and (need_org is None or bool(u["org"]) == need_org)]
        if tickets == "some":
            pool = [u for u in pool if self.tickets_of(u)]
        elif tickets == "none":
            pool = [u for u in pool if not self.tickets_of(u)]
        elif tickets == "tagged":
            pool = [u for u in pool if any(t["tags"] for t in self.tickets_of(u))]
        if not pool:
            raise PlanError("no free user")
        u = self.r.choice(sorted(pool, key=lambda x: x["id"]))
        self.used.add(u["id"])
        return u

    def tickets_of(self, u: dict) -> list[dict]:
        return [t for t in self.tickets if t["requester"] == u["id"]]

    def org_of(self, u: dict) -> dict | None:
        return next((o for o in self.orgs if o["id"] == u["org"]), None)

    # -- plants -------------------------------------------------------------------------------------------------------
    def plant_cc(self, u: dict):
        """Another user's ticket that mentions u's address and carries a comment by u (u is not its requester)."""
        others = [x for x in self.users if x["id"] != u["id"] and x["id"] not in self.used]
        v = self.r.choice(sorted(others, key=lambda x: x["id"]))
        self.used.add(v["id"])
        body = f"Please keep {u['email']} in copy on this thread, {u['name'].split()[0]} manages our account."
        self.add_ticket(v, self.r.choice(TICKET_SUBJECTS), body, comments=[
            {"id": self.num("cmt_", 6), "body": f"Adding my notes here. - {u['name']}", "author": u["id"],
             "at": self.monday - timedelta(days=self.r.randint(2, 20))}])

    def plant_namesake(self, u: dict):
        f, ln = u["name"].split(" ", 1)
        org = self.r.choice([o for o in self.orgs if o["id"] != u["org"]] + [None])
        w = self.add_user(f, ln, org)
        self.used.add(w["id"])
        for s in self.r.sample(TICKET_SUBJECTS, self.r.randint(1, 2)):
            self.add_ticket(w, s)

    def ensure_tags(self, u: dict):
        ts = self.tickets_of(u)
        if ts and not any(t["tags"] for t in ts):
            ts[0]["tags"] = sorted(self.r.sample(TAG_POOL, 2))

    # -- requests -----------------------------------------------------------------------------------------------------
    def request(self, email: str, name: str, req_date: date, sub_at: datetime, phase: str, story: str,
                user: dict | None, source: str | None = None) -> dict:
        q = {"key": f"q{len(self.requests)}", "email": email, "name": name, "date": req_date, "sub_at": sub_at,
             "phase": phase, "story": story, "user": user["id"] if user else None,
             "source": source or self.r.choice(SOURCES), "rid": None}
        self.requests.append(q)
        return q

    def hist_rows(self, q: dict, rows: list[tuple[str, datetime, str]]):
        for tr, at, ref in rows:
            self.log0.append({"q": q, "Transition": tr, "at": at, "Reference": ref})

    def verification_body(self, q: dict) -> str:
        return (f"Hello {q['name'].split()[0]},\n\nWe received a request to erase your personal data (request {q['rid']}). "
                f"To confirm it, reply to this email from this address and quote {q['rid']}.\n\nPrivacy Office")

    def plan(self):
        """Who writes in, who replies from which address, which holds change. No expected effect is decided here."""
        r, d = self.r, self.d
        d2, d3 = d == "d2", d == "d3"
        C = self.cnt
        mon = self.monday.date()
        # ---------- history (closed requests from earlier weeks)
        self.hist_purged = []
        for _ in range(2):
            f, ln = self.person()
            em = self.new_email(self.org_local(f, ln), r.choice(self.orgs)["domain"])
            ago = r.randint(9, 40)
            q = self.request(em, f"{f} {ln}", mon - timedelta(days=ago), self.past(ago), "history", "hist-purged", None)
            q["v_at"] = q["sub_at"] + timedelta(days=r.randint(1, min(5, ago - 3)), minutes=r.randint(5, 300))
            gone = {"id": self.num("usr_", 5), "org": None}     # the requester's Zendesk user was deleted then
            q["tickets"] = []
            for _ in range(r.randint(0, 2)):
                t = self.add_ticket(gone, tags=[TAG], comments=[{"id": self.num("cmt_", 6), "body": "Closing this out.",
                                                                  "author": AGENTS[1][0], "at": q["sub_at"]}])
                t["subject"] = PREFIX + t["subject"]
                q["tickets"].append(t["id"])
            self.hist_purged.append(q)
        f, ln = self.person()
        em = self.new_email(self.free_local(f, ln), r.choice(FREEMAIL))
        ago = r.randint(8, 40)
        self.hist_nf = self.request(em, f"{f} {ln}", mon - timedelta(days=ago), self.past(ago), "history", "hist-nf", None)
        self.hist_closed = []
        for k in range(2):
            u = self.pick_user(tickets="some") if k == 0 else None
            if u is None:
                f, ln = self.person()
                em, nm = self.new_email(self.free_local(f, ln), r.choice(FREEMAIL)), f"{f} {ln}"
            else:
                em, nm = u["email"], u["name"]
            ago = r.randint(36, 55)
            q = self.request(em, nm, mon - timedelta(days=ago), self.past(ago), "history", "hist-closed", u)
            self.hist_closed.append(q)
        hd = self.hist_purged[0]
        ago = (mon - hd["date"]).days
        dup_at = hd["v_at"] + timedelta(days=1, minutes=r.randint(10, 200))
        if dup_at.date() >= mon:
            dup_at = self.past(1)
        self.hist_dup = self.request(hd["email"], hd["name"], dup_at.date(), dup_at, "history", "hist-dup", None)

        # ---------- pre-seeded open requests (Verification Sent in earlier weeks)
        self.pre = []

        def pre(story: str, age: int, user: dict | None, email: str | None = None) -> dict:
            if user is None and email is None:
                f, ln = self.person()
                email = self.new_email(self.free_local(f, ln), r.choice(FREEMAIL))
                nm = f"{f} {ln}"
            else:
                nm = user["name"]
                email = email or user["email"]
            q = self.request(email, nm, mon - timedelta(days=age), self.past(age), "pre", story, user)
            self.pre.append(q)
            return q

        # holds plan (legal_hold.changed triggers)
        hold_types = ["lift-pre", "add-block", "lift-still"][: C["hold"]]
        n_bad = C["bad"]
        n_gen = C["rep"] - n_bad
        n_add_block = 1 if "add-block" in hold_types else 0
        n_block_pre = 1 if d3 and n_gen - n_add_block >= 4 else 0
        n_pre_verify = 2 if n_gen - n_add_block - n_block_pre >= 5 else 1
        n_purge = n_gen - n_add_block - n_block_pre - n_pre_verify
        if n_purge < 1:
            raise PlanError("no purge story")
        # pre-seeded verified this week (one may be a day-30 verification at d3)
        self.pre_verify = []
        for k in range(n_pre_verify):
            u = self.pick_user(need_org=None, tickets="some")
            if d3 and k == 0 and r.random() < 0.7:
                v_day = r.randint(1, 4)
                q = pre("pre-verify-day30", DEADLINE_DAYS - v_day, u)
                q["v_day"] = v_day
            else:
                q = pre("pre-verify", r.randint(2, 20), u)
                q["v_day"] = None
            self.pre_verify.append(q)
        # deadlines reached this week (no reply)
        n_deadline = {"d1": 1, "d2": r.randint(1, 2), "d3": 2}[d]
        self.pre_deadline = []
        for k in range(n_deadline):
            if d3 and k == 0:
                c, age = 0, r.choice([31, 32])           # day 30 fell on the weekend: closed at Monday's close
            else:
                c = r.randint(0, 3)
                age = DEADLINE_DAYS - c
            u = self.pick_user() if r.random() < 0.6 else None
            q = pre("pre-deadline", age, u)
            q["close_day"] = c
            self.pre_deadline.append(q)
        # open requests that stay open (day 29 at Friday's close at d3, and young ones)
        self.pre_open = []
        if d3 or (d2 and r.random() < 0.5):
            self.pre_open.append(pre("pre-notyet", DEADLINE_DAYS - 5, self.pick_user() if r.random() < 0.5 else None))
        for _ in range(r.randint(1, 2)):
            self.pre_open.append(pre("pre-open", r.randint(1, 14), self.pick_user(tickets="some")))
        # blocked requests from earlier weeks
        self.pre_blocked = []
        if "lift-pre" in hold_types:
            u = self.pick_user(tickets="some")
            q = pre("pre-blocked-lift", r.randint(8, 25), u)
            q["v_at"] = q["sub_at"] + timedelta(days=r.randint(1, 4), minutes=r.randint(5, 300))
            if q["v_at"].date() >= mon:
                q["v_at"] = self.past(1)
            self.pre_blocked.append(q)
        if "lift-still" in hold_types:
            u = self.pick_user(tickets="some")
            q = pre("pre-blocked-still", r.randint(8, 25), u)
            q["v_at"] = q["sub_at"] + timedelta(days=r.randint(1, 4), minutes=r.randint(5, 300))
            if q["v_at"].date() >= mon:
                q["v_at"] = self.past(1)
            self.pre_blocked.append(q)

        # ---------- this week's new requests
        n_nf = 2 if d3 else 1
        n_rereq = 1 if (d3 or (d2 and r.random() < 0.5)) else 0
        n_back = 1 if d3 else 0
        n_pending = C["req"] - n_purge - n_add_block - n_block_pre - n_nf - n_rereq - n_back
        while n_pending < 0:
            if n_back:
                n_back -= 1
            elif n_rereq:
                n_rereq -= 1
            elif n_nf > 1:
                n_nf -= 1
            else:
                raise PlanError("request budget too small")
            n_pending += 1
        self.week = []

        def week(story: str, user: dict | None, email: str | None = None, name: str | None = None) -> dict:
            q = self.request(email or user["email"], name or user["name"], mon, mon, "week", story, user)
            self.week.append(q)
            return q

        # purge stories: target attributes (planted traps)
        self.purge = []
        attrs = []
        for k in range(n_purge):
            a = {"org": r.random() < (0.55 if d3 else 0.4 if d2 else 0.0)}
            attrs.append(a)
        if d2 or d3:
            plants = ["cc", "keep-tags", "same-name", "no-tickets", "hold-lookalike", "hold-lifted-row", "case-address"]
            want = {"d2": ["cc", "keep-tags"] + r.sample(["same-name", "no-tickets", "hold-lookalike", "hold-lifted-row"], 2),
                    "d3": ["cc", "keep-tags", "same-name", "hold-lookalike", "case-address"]
                    + r.sample(["no-tickets", "hold-lifted-row"], 1)}[d]
            assert all(p in plants for p in want)
            conflict = {("no-tickets", "keep-tags"), ("keep-tags", "no-tickets")}
            for i, p in enumerate(want):
                for j in range(n_purge):
                    a = attrs[(i + j) % n_purge]
                    if not any((p, x) in conflict for x in a.get("plants", [])):
                        a.setdefault("plants", []).append(p)
                        break
        for a in attrs:
            ps = a.get("plants", [])
            if "no-tickets" in ps:
                u = self.pick_user(need_org=a["org"], tickets="none")
            elif "keep-tags" in ps:
                u = self.pick_user(need_org=a["org"], tickets="tagged") if any(
                    any(t["tags"] for t in self.tickets_of(x)) for x in self.users
                    if x["id"] not in self.used and bool(x["org"]) == a["org"]) else self.pick_user(need_org=a["org"], tickets="some")
                self.ensure_tags(u)
            else:
                u = self.pick_user(need_org=a["org"], tickets="some")
            if "cc" in ps:
                self.plant_cc(u)
            if "same-name" in ps:
                self.plant_namesake(u)
            em = self.case_variant(u["email"]) if "case-address" in ps else None
            q = week("purge", u, email=em)
            q["plants"] = ps
            if "hold-lookalike" in ps:
                self.holds0.append({"Email": self.lookalike(u["email"], avoid_plus=False), "Status": "Active"})
            if "hold-lifted-row" in ps:
                self.holds0.append({"Email": u["email"], "Status": "Lifted"})
            self.purge.append(q)
        self.blocks = []
        if n_add_block:
            q = week("block-add", self.pick_user(tickets="some"))
            self.blocks.append(q)
        if n_block_pre:
            u = self.pick_user(tickets="some")
            self.holds0.append({"Email": u["email"], "Status": "Active"})
            q = week("block-pre", u)
            self.blocks.append(q)
        self.notfound = []
        for k in range(n_nf):
            if k == 0 and (d3 or (d2 and r.random() < 0.6)):
                src = r.choice(sorted((u for u in self.users if u["id"] not in self.used), key=lambda x: x["id"]))
                em = self.lookalike(src["email"], avoid_plus=True)
                q = week("notfound-lookalike", None, email=em, name=src["name"])
            else:
                f, ln = self.person()
                q = week("notfound", None, email=self.new_email(self.free_local(f, ln), r.choice(FREEMAIL)),
                         name=f"{f} {ln}")
            self.notfound.append(q)
        self.rereq = []
        if n_rereq:
            hc = self.hist_closed[0]
            self.rereq.append(week("re-request", None, email=hc["email"], name=hc["name"]))
            self.rereq[-1]["user"] = hc["user"]
        self.backdated = []
        if n_back:
            u = self.pick_user()
            q = week("backdated", u)
            q["source"] = "Postal letter (entered by staff)"
            self.backdated.append(q)
        self.pending = [week("pending", self.pick_user()) for _ in range(n_pending)]

        # ---------- holds in world0
        for q in self.pre_blocked:
            self.holds0.append({"Email": q["email"], "Status": "Active", "q": q})
            if q["story"] == "pre-blocked-still":
                self.holds0.append({"Email": q["email"], "Status": "Active", "q": q})
        for _ in range(r.randint(1, 2)):                       # holds on people with no request
            u = self.pick_user()
            self.holds0.append({"Email": u["email"], "Status": "Active"})
        for _ in range(r.randint(1, 2)):
            u = self.pick_user()
            self.holds0.append({"Email": u["email"], "Status": "Lifted"})

        self.hold_types = hold_types
        self.n_bad = n_bad
        self.n_dup = C["dup"]

    # -- the week's schedule ------------------------------------------------------------------------------------------
    def schedule(self):
        r, d3 = self.r, self.d == "d3"
        mon = self.monday
        fri_end = self.friday_end
        ev = self.events
        for i in range(5):
            ev.append({"kind": "day.close", "sub": "day-close", "at": self.day(i) + timedelta(hours=17),
                       "date": self.day(i).date().isoformat()})

        def at_req(q: dict, lo_day: int, hi_day: int, h_hi: float = 15.5):
            t = self.slot(self.day(lo_day), self.day(hi_day) + timedelta(hours=h_hi), h_hi=h_hi)
            q["sub_at"] = t
            q["date"] = t.date()
            ev.append({"kind": "erasure.requested", "sub": q["story"], "at": t, "q": q})
            return t

        # new requests
        for q in self.purge:
            at_req(q, 0, 3)
        for q in self.blocks:
            at_req(q, 0, 2)
        for q in self.notfound + self.rereq + self.pending:
            at_req(q, 0, 4, 16.5)
        for q in self.backdated:
            e = r.randint(0, 1)
            t = self.slot(self.day(e), self.day(e) + timedelta(hours=12), h_hi=12)
            k = r.randint(26 + e, 29)
            q["sub_at"], q["date"] = t, t.date() - timedelta(days=k)
            ev.append({"kind": "erasure.requested", "sub": "backdated", "at": t, "q": q})

        # replies that verify (genuine)
        self.genuine = []

        def genuine(q: dict, lo: datetime, hi: datetime):
            t = self.slot(lo, hi)
            e = {"kind": "verification.reply", "sub": "genuine", "at": t, "q": q, "style": self.reply_style()}
            ev.append(e)
            self.genuine.append(e)
            q["reply_at"] = t
            return t

        for q in self.purge:
            genuine(q, q["sub_at"] + timedelta(minutes=25), fri_end - timedelta(minutes=30))
        for q in self.pre_verify:
            if q.get("v_day") is not None:
                genuine(q, self.day(q["v_day"]), self.day(q["v_day"]) + timedelta(hours=16, minutes=50))
            else:
                genuine(q, mon, fri_end - timedelta(minutes=30))
        # holds
        for q in self.blocks:
            if q["story"] == "block-add":
                th = self.slot(q["sub_at"] + timedelta(minutes=5), self.day(3) + timedelta(hours=12))
                f, ln = q["name"].split(" ", 1)
                hold = {"Email": q["email"], "Status": "Active", "q": q, "added_at": th}
                ev.append({"kind": "legal_hold.changed", "sub": "hold-added", "at": th, "hold": hold, "op": "add"})
                genuine(q, th + timedelta(minutes=15), fri_end - timedelta(minutes=30))
            else:
                genuine(q, q["sub_at"] + timedelta(minutes=25), fri_end - timedelta(minutes=30))
        for q in self.pre_blocked:
            t = self.slot(mon, fri_end)
            h = next(h for h in self.holds0 if h.get("q") is q)
            ev.append({"kind": "legal_hold.changed", "sub": "hold-lift" if q["story"] == "pre-blocked-lift" else "hold-still",
                       "at": t, "hold": h, "op": "lift"})
            q["lift_at"] = t

        # duplicates
        dup_targets = []
        opens = [q for q in self.pending + self.pre_open + self.pre_verify if q["phase"] != "history"]
        purged_after = [q for q in self.purge]
        kinds = ["open", "purged", "blocked"]
        plan = (["open"] + (["purged"] if d3 else []) + (["blocked"] if d3 else []) + r.choices(kinds, k=3))[: self.n_dup]
        for k, kind in enumerate(plan):
            if kind == "blocked" and self.pre_blocked:
                q = self.pre_blocked[0]
                lo, hi = mon, q.get("lift_at", fri_end) - timedelta(minutes=10)
            elif kind == "purged":
                if r.random() < 0.5 and purged_after:
                    q = r.choice(purged_after)
                    lo, hi = q["reply_at"] + timedelta(minutes=10), fri_end
                else:
                    q = self.hist_purged[1]
                    lo, hi = mon, fri_end
            else:
                q = r.choice(opens)
                lo = q["sub_at"] + timedelta(minutes=20) if q["phase"] == "week" else mon
                hi = q.get("reply_at", fri_end) - timedelta(minutes=10)
            em = q["email"]
            if d3 and k == 1:
                em = " " + self.case_variant(norm_addr(em)) + " " if r.random() < 0.5 else self.case_variant(norm_addr(em))
            dq = self.request(em, q["name"], mon, mon, "week", f"dup-{kind}", None,
                              source=r.choice(["Web form", "Email to privacy inbox"]))
            dq["dup_of"] = q
            t = self.slot(lo, hi)
            dq["sub_at"], dq["date"] = t, t.date()
            ev.append({"kind": "erasure.duplicate", "sub": f"dup-{kind}", "at": t, "q": dq})

        # replies that verify nothing
        req_types = {"d1": [], "d2": [r.choice(["spoof-lookalike", "spoof-display", "spoof-forward"])],
                     "d3": ["spoof-lookalike", "spoof-display", "spoof-forward"]}[self.d]
        rest = [x for x in BAD_TYPES if x != "wrong-id" or d3]
        bads = (req_types + r.choices(rest, k=self.n_bad))[: self.n_bad]
        for b in bads:
            self.plan_bad(b)

    def reply_style(self) -> dict:
        r, d = self.r, self.d
        return {"display": r.random() < 0.5,
                "case": r.random() < {"d1": 0.0, "d2": 0.2, "d3": 0.35}[d],
                "body_id": r.random() < {"d1": 0.0, "d2": 0.25, "d3": 0.4}[d]}

    def open_window(self, q: dict) -> tuple[datetime, datetime]:
        """While request q is in Verification Sent (plan view)."""
        lo = q["sub_at"] + timedelta(minutes=10) if q["phase"] == "week" else self.monday
        hi = q.get("reply_at") or (self.day(q["close_day"]) + timedelta(hours=17) if "close_day" in q else self.friday_end)
        return lo, hi - timedelta(minutes=5)

    def pick_open(self, cands: list[dict]) -> dict:
        ok = [q for q in cands if self.open_window(q)[1] - self.open_window(q)[0] >= timedelta(minutes=20)]
        if not ok:
            raise PlanError("no open request with a usable window")
        return self.r.choice(ok)

    def plan_bad(self, b: str):
        r = self.r
        ev = self.events
        fri_end = self.friday_end
        opens = [q for q in self.purge + self.pending + self.pre_open + self.pre_verify + self.pre_deadline
                 if q.get("story") != "pre-verify-day30"]
        if b == "late-reply":
            cands = [q for q in self.pre_deadline if q["close_day"] <= 3]
            if not cands:
                b = "no-id"
            else:
                q = r.choice(cands)
                t = self.slot(self.day(q["close_day"] + 1), fri_end)
                ev.append({"kind": "verification.reply", "sub": b, "at": t, "q": q})
                return
        if b == "repeat-reply":
            cands = [e for e in self.genuine]
            e0 = r.choice(cands)
            q = e0["q"]
            t = self.slot(e0["at"] + timedelta(minutes=10), fri_end + timedelta(minutes=5))
            ev.append({"kind": "verification.reply", "sub": b, "at": t, "q": q})
            return
        if b == "spoof-colleague":
            cands = [q for q in opens if q["user"] and self.org_of(self.user(q["user"]))]
            if not cands:
                b = "spoof-forward"
            else:
                q = self.pick_open(cands)
                mates = [u for u in self.users if u["org"] == self.user(q["user"])["org"] and u["id"] != q["user"]]
                lo, hi = self.open_window(q)
                t = self.slot(lo, hi)
                ev.append({"kind": "verification.reply", "sub": b, "at": t, "q": q, "sender": r.choice(mates)})
                return
        if b == "wrong-id":
            q = self.pick_open(opens)
            others = [x for x in self.requests if x is not q and norm_addr(x["email"]) != norm_addr(q["email"])]
            lo, hi = self.open_window(q)
            t = self.slot(lo, hi)
            ev.append({"kind": "verification.reply", "sub": b, "at": t, "q": q, "other": r.choice(others)})
            return
        q = self.pick_open(opens)
        lo, hi = self.open_window(q)
        t = self.slot(lo, hi)
        e = {"kind": "verification.reply", "sub": b, "at": t, "q": q}
        if b == "spoof-lookalike":
            e["sender_email"] = self.lookalike(norm_addr(q["email"]))
        elif b == "spoof-forward":
            f, ln = q["name"].split(" ", 1)
            e["sender_email"] = self.new_email(f"{f}.{ln}.home".lower().replace(" ", ""), r.choice(FREEMAIL))
        elif b == "spoof-display":
            local = norm_addr(q["email"]).split("@")[0]
            e["sender_email"] = self.new_email(f"{local}-relay", RELAY)
        self.events.append(e)

    def user(self, uid: str) -> dict:
        return next(u for u in self.users if u["id"] == uid)

    # -- ids and texts ------------------------------------------------------------------------------------------------
    def assign_ids(self):
        base = self.r.randint(2100, 6800)
        for q in sorted(self.requests, key=lambda q: (q["sub_at"], q["key"])):
            base += self.r.choice([1, 1, 1, 2])
            q["rid"] = f"GDPR-{base}"
        for h in self.holds0 + [e["hold"] for e in self.events if e["kind"] == "legal_hold.changed" and e["op"] == "add"]:
            if "Case Reference" not in h:
                h["Case Reference"] = self.uid("0123456789", 3, f"CASE-{self.monday.year}-")
            h.setdefault("Hold Reason", self.r.choice(HOLD_REASONS))

    def compose_email(self, e: dict) -> dict:
        """The inbound message for a reply event (texts are our own; ids quoted per the plan)."""
        r = self.r
        q = e["q"]
        rid, name = q["rid"], q["name"]
        first = name.split()[0]
        addr = norm_addr(q["email"])
        sub = e["sub"]
        quote = (f"\n\n> Hello {first},\n> We received a request to erase your personal data (request {rid}). "
                 f"To confirm it, reply to this email from this address and quote {rid}.")
        if sub == "genuine":
            st = e["style"]
            a = self.case_variant(addr) if st["case"] else addr
            frm = f"{name} <{a}>" if st["display"] else a
            if st["body_id"]:
                subject = r.choice(["Re: your email", "Confirming", "Re: Data deletion"])
                body = (f"Hello Privacy team,\n\nThank you for getting back to me so quickly. I confirm that I want my account "
                        f"and all of my support history deleted. My request number is {rid}.\n\nBest regards,\n{first}")
                if len(snippet_of(body.split(rid)[0])) < 100:
                    body = body.replace("Thank you for getting back to me so quickly.",
                                        "Thank you for getting back to me so quickly, and sorry for the slow answer, "
                                        "I was travelling for most of the week.")
            else:
                subject = f"Re: {subj_verify(rid)}"
                body = r.choice(["Yes, I confirm. Please erase my data.", "Confirmed, please go ahead and delete everything.",
                                 "I confirm this request. Thank you."]) + f" {rid}" + quote
            return {"from": frm, "subject": subject, "body": body}
        if sub == "spoof-lookalike":
            return {"from": f"{name} <{e['sender_email']}>" if r.random() < 0.5 else e["sender_email"],
                    "subject": f"Re: {subj_verify(rid)}", "body": f"Yes, I confirm. Please erase my data. {rid}" + quote}
        if sub == "spoof-forward":
            return {"from": f"{name} <{e['sender_email']}>", "subject": f"Fwd: {subj_verify(rid)}",
                    "body": (f"This is {name}, writing from my personal address because I cannot reach my usual mailbox. "
                             f"Please go ahead with {rid}.\n\n---------- Forwarded message ----------\nFrom: {INBOX}\n"
                             f"To: {addr}\nSubject: {subj_verify(rid)}" + quote)}
        if sub == "spoof-display":
            return {"from": f"\"{addr}\" <{e['sender_email']}>", "subject": f"Re: {subj_verify(rid)}",
                    "body": f"Confirmed. Please delete my account. {rid}" + quote}
        if sub == "spoof-colleague":
            v = e["sender"]
            return {"from": f"{v['name']} <{v['email']}>", "subject": f"Re: {subj_verify(rid)}",
                    "body": (f"Hello, I am writing on behalf of my colleague {name}, who asked me to confirm erasure "
                             f"request {rid}. Please proceed.\n\n{v['name']}")}
        if sub == "no-id":
            return {"from": addr, "subject": r.choice(["Please delete my data", "Account deletion", "Erasure"]),
                    "body": "I asked you to delete my data and my account. Please just do it, I confirm."}
        if sub == "late-reply":
            return {"from": f"{name} <{addr}>", "subject": f"Re: {subj_verify(rid)}",
                    "body": f"Sorry for the slow reply. Yes, please erase my data ({rid})." + quote}
        if sub == "repeat-reply":
            return {"from": addr, "subject": f"Re: {subj_verify(rid)}",
                    "body": f"Just making sure you received my confirmation for {rid}. Thanks!"}
        if sub == "wrong-id":
            o = e["other"]["rid"]
            return {"from": addr, "subject": f"Confirming erasure request {o}",
                    "body": f"Hello, I confirm erasure request {o}. Please delete my account."}
        raise ValueError(sub)

    # -- canonical simulation (truth) ---------------------------------------------------------------------------------
    def simulate(self):
        r = self.r
        self.events.sort(key=lambda e: (e["at"], e["kind"]))
        # state as the automation left it at world0
        S = {"users": {u["id"]: dict(u) for u in self.world_users},
             "tickets": {t["id"]: {"subject": t["subject"], "tags": list(t["tags"]), "requester": t["requester"]}
                         for t in self.tickets},
             "req": {}, "log": [dict(x) for x in self.log_cells0], "holds": [dict(h) for h in self.hold_cells0],
             "cfg": {c["Setting"]: c["Value"] for c in self.cfg_cells0}}
        for x in self.req_cells0:
            S["req"][x["Request ID"]] = {"email": x["Email"], "date": date.fromisoformat(x["Requested Date"])}
        req_row = max([2 + i for i in range(len(self.req_cells0))], default=1)
        hold_row = 1 + len(self.hold_cells0)
        self.truth, self.triggers, self.payloads = [], [], []
        week_rows, week_mail, week_posts = [], [], []
        req_rows_all = [dict(c) for c in self.req_cells0]
        last_batch = None
        lift_today: dict[str, int] = {}
        batch_change_at = self.day(2) + timedelta(hours=8) if self.d == "d3" else None
        batch_done = False

        def state(rid):
            rows = [x for x in S["log"] if x["Request ID"] == rid]
            return rows[-1]["Transition"] if rows else None

        def users_with(addr):
            return [u for u in S["users"].values() if norm_addr(u["email"]) == norm_addr(addr)]

        def active_holds(addr):
            return [h for h in S["holds"] if h["Status"] == "Active" and norm_addr(h["Email"]) == norm_addr(addr)]

        for n, e in enumerate(self.events, 1):
            tid = f"s{self.seed}/t{n:02d}"
            at = e["at"]
            at_s = iso_z(at)
            today = at.date().isoformat()
            delta = []
            if batch_change_at is not None and not batch_done and at >= batch_change_at:
                newb = f"GDPR-BATCH-{self.day(2).strftime('%Y%m%d')}"
                row = next(i for i, c in enumerate(self.cfg_cells0) if c["Setting"] == "Batch_Reference")
                delta.append({"op": "set_cells", "spreadsheet_id": SS, "worksheet_id": WS_CFG, "row_id": row + 2,
                              "cells": {"Value": newb}})
                S["cfg"]["Batch_Reference"] = newb
                batch_done = True
            ex = {"log": [], "emails": [], "tickets": [], "delete_users": [], "posts": [], "escalate": False}
            asserts, labels = [], []

            def log(rid, email, tr, ref=""):
                row = {"Request ID": rid, "Email": email.strip(), "Transition": tr, "At": at_s, "Reference": ref}
                S["log"].append(row)
                ex["log"].append(row)
                week_rows.append(row)
                asserts.append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_LOG,
                                "cells": {"Request ID": rid, "Transition": tr}})

            def mail(to, subject, rid):
                ex["emails"].append({"to": norm_addr(to), "subject": subject, "rid": rid})
                week_mail.append([norm_addr(to), subject])
                asserts.append({"type": "gmail_message_sent_to_with_body_contains", "to": norm_addr(to),
                                "subject": subject, "body_contains": [rid]})

            def protect(uid_list):
                for t_id, t in sorted(S["tickets"].items()):
                    if t["requester"] in uid_list and PREFIX.strip() not in t["subject"]:
                        asserts.append({"type": "zendesk_ticket_not_has_tag", "ticket_id": t_id, "tag": TAG})

            def purge(rid, email):
                us = users_with(email)
                if len(us) != 1:
                    raise PlanError(f"{tid}: purge of {email} finds {len(us)} users")
                u = us[0]
                ids = []
                for t_id, t in sorted(S["tickets"].items()):
                    if t["requester"] == u["id"]:
                        t["subject"] = PREFIX + t["subject"]
                        if TAG not in t["tags"]:
                            t["tags"] = t["tags"] + [TAG]
                        ids.append(t_id)
                        ex["tickets"].append({"id": t_id, "subject": t["subject"], "tags": sorted(t["tags"])})
                        asserts.append({"type": "zendesk_ticket_exists", "ticket_id": t_id, "subject_contains": PREFIX.strip()})
                        asserts.append({"type": "zendesk_ticket_has_tag", "ticket_id": t_id, "tag": TAG})
                del S["users"][u["id"]]
                ex["delete_users"].append({"id": u["id"], "email": norm_addr(u["email"])})
                asserts.append({"type": "zendesk_user_not_exists", "email": u["email"]})
                log(rid, email, PURGED, ", ".join(ids) if ids else "none")
                # labels: what else a careless purge would touch
                if not ids:
                    labels.append("no-tickets")
                if any(t["tags"] != [TAG] for t_id, t in S["tickets"].items() if t_id in ids):
                    labels.append("keep-tags")
                others = [x for x in S["users"].values()]
                same_name = [x["id"] for x in others if x["name"].lower() == u["name"].lower()]
                org_mates = [x["id"] for x in others if u["org"] and x["org"] == u["org"]]
                cc = [t_id for t_id, t in S["tickets"].items() if t["requester"] != u["id"]
                      and (u["email"] in self.ticket_text(t_id) or u["id"] in self.ticket_authors(t_id))]
                if same_name and any(t["requester"] in same_name for t in S["tickets"].values()):
                    labels.append("same-name")
                    protect(same_name)
                if org_mates and any(t["requester"] in org_mates for t in S["tickets"].values()):
                    labels.append("org-domain")
                    protect(org_mates)
                if cc:
                    labels.append("cc-user")
                    for t_id in cc:
                        asserts.append({"type": "zendesk_ticket_not_has_tag", "ticket_id": t_id, "tag": TAG})
                if any(h["Status"] == "Active" and self.is_lookalike(norm_addr(h["Email"]), norm_addr(email)) for h in S["holds"]):
                    labels.append("hold-lookalike")
                if any(h["Status"] == "Lifted" and norm_addr(h["Email"]) == norm_addr(email) for h in S["holds"]):
                    labels.append("hold-lifted-row")

            # ---------------- event kinds
            if e["kind"] in ("erasure.requested", "erasure.duplicate"):
                q = e["q"]
                req_row += 1
                cells = {"Request ID": q["rid"], "Email": q["email"], "Name": q["name"],
                         "Requested Date": q["date"].isoformat(), "Source": q["source"]}
                req_rows_all.append(dict(cells))
                delta.append({"op": "insert", "app": "google_sheets", "collection": "rows",
                              "record": {"id": self.hexid(24), "spreadsheet_id": SS, "worksheet_id": WS_REQ,
                                         "row_id": req_row, "cells": dict(cells)}})
                payload = {"app": "google_sheets", "event": "new_row",
                           "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_REQ], "row_id": req_row, "row": dict(cells)}}
                rid, em = q["rid"], q["email"]
                earlier = [(x, state(x)) for x in S["req"] if norm_addr(S["req"][x]["email"]) == norm_addr(em)]
                S["req"][rid] = {"email": em, "date": q["date"]}
                dups = [x for x, s in earlier if s in OPEN_FOR_DUP]
                if len(dups) > 1:
                    raise PlanError(f"{tid}: several open requests for {em}")
                if dups:
                    log(rid, em, DUPLICATE, dups[0])
                    labels.append({VS: "duplicate-open", BLOCKED: "duplicate-blocked", PURGED: "duplicate-purged"}[dict(earlier)[dups[0]]])
                    if em != S["req"][dups[0]]["email"]:
                        labels.append("duplicate-case")
                    asserts.append({"type": "gmail_message_not_sent_to", "to": norm_addr(em)})
                elif not users_with(em):
                    log(rid, em, NOT_FOUND)
                    mail(em, subj_notfound(rid), rid)
                    if any(self.is_lookalike(norm_addr(em), norm_addr(u["email"])) for u in S["users"].values()):
                        labels.append("lookalike-domain")
                    if any(s in (NOT_FOUND, CLOSED) for _, s in earlier):
                        labels.append("re-request")
                else:
                    mail(em, subj_verify(rid), rid)
                    log(rid, em, VS)
                    u = users_with(em)[0]
                    if em.strip() != u["email"]:
                        labels.append("case-address")
                    if any(s in (NOT_FOUND, CLOSED) for _, s in earlier):
                        labels.append("re-request")
                    if active_holds(em):
                        labels.append("hold-on-request")
                    if q["date"].isoformat() != today:
                        labels.append("backdated")
                    asserts.append({"type": "zendesk_user_exists", "user_id": u["id"]})
                intent = {"purge": VS, "block-add": VS, "block-pre": VS, "pending": VS, "re-request": VS, "backdated": VS,
                          "notfound": NOT_FOUND, "notfound-lookalike": NOT_FOUND}.get(q["story"], DUPLICATE)
                if ex["log"][-1]["Transition"] != intent:
                    raise PlanError(f"{tid}: {q['story']} derived {ex['log'][-1]['Transition']}, planned {intent}")

            elif e["kind"] == "verification.reply":
                q = e["q"]
                m = self.compose_email(e)
                mid = self.hexid(16)
                rec = {"id": mid, "thread_id": self.hexid(16), "from_": m["from"], "to": [INBOX], "subject": m["subject"],
                       "body_plain": m["body"], "snippet": snippet_of(m["body"]), "label_ids": ["INBOX", "UNREAD"],
                       "is_read": False, "date": ms(at - timedelta(minutes=1)), "internal_date": ms(at - timedelta(minutes=1))}
                delta.append({"op": "insert", "app": "gmail", "collection": "messages", "record": rec})
                payload = {"app": "gmail", "event": "new_email",
                           "data": {"message_id": mid, "from": m["from"], "subject": m["subject"], "snippet": rec["snippet"]}}
                quoted = []
                for x in ID_RE.findall(m["subject"] + "\n" + m["body"]):
                    if x not in quoted:
                        quoted.append(x)
                snd = sender_addr(m["from"])
                hits = [x for x in quoted if x in S["req"] and state(x) == VS and norm_addr(S["req"][x]["email"]) == snd]
                if len(hits) > 1:
                    raise PlanError(f"{tid}: an email verifies several requests")
                if hits:
                    rid = hits[0]
                    em = S["req"][rid]["email"]
                    log(rid, em, VERIFIED, mid)
                    raw_addr = re.search(r"<([^<>]+)>\s*$", m["from"])
                    raw_addr = (raw_addr.group(1) if raw_addr else m["from"]).strip()
                    if raw_addr != em.strip():
                        labels.append("case-sender")
                    if rid not in m["subject"] and rid not in rec["snippet"]:
                        labels.append("id-in-body")
                    if (at.date() - S["req"][rid]["date"]).days >= DEADLINE_DAYS:
                        labels.append("deadline-day")
                    holds = active_holds(em)
                    if holds:
                        log(rid, em, BLOCKED, ", ".join(h["Case Reference"] for h in holds))
                        mail(em, subj_hold(rid), rid)
                        labels.append("on-hold")
                        us = users_with(em)
                        asserts.append({"type": "zendesk_user_exists", "user_id": us[0]["id"]})
                        protect([us[0]["id"]])
                    else:
                        purge(rid, em)
                else:
                    labels.append(e["sub"])
                    for x in quoted:
                        if x in S["req"]:
                            asserts.append({"type": "gmail_message_not_sent_to", "to": norm_addr(S["req"][x]["email"])})
                    asserts.append({"type": "gmail_message_not_sent_to", "to": snd})
                    if q.get("user") and q["user"] in S["users"]:
                        asserts.append({"type": "zendesk_user_exists", "user_id": q["user"]})
                        protect([q["user"]])
                if (e["sub"] == "genuine") != bool(hits):
                    raise PlanError(f"{tid}: reply {e['sub']} derived verified={bool(hits)}")
                if hits:
                    want = BLOCKED if q["story"] in ("block-add", "block-pre") else PURGED
                    if ex["log"][-1]["Transition"] != want:
                        raise PlanError(f"{tid}: {q['story']} derived {ex['log'][-1]['Transition']}, planned {want}")

            elif e["kind"] == "legal_hold.changed":
                h = e["hold"]
                if e["op"] == "add":
                    hold_row += 1
                    cells = {"Email": h["Email"], "Hold Reason": h["Hold Reason"], "Case Reference": h["Case Reference"],
                             "Status": "Active", "Updated": today}
                    h["row_id"] = hold_row
                    S["holds"].append(dict(cells, row_id=hold_row))
                    delta.append({"op": "insert", "app": "google_sheets", "collection": "rows",
                                  "record": {"id": self.hexid(24), "spreadsheet_id": SS, "worksheet_id": WS_HOLD,
                                             "row_id": hold_row, "cells": dict(cells)}})
                    payload = {"app": "google_sheets", "event": "new_row",
                               "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_HOLD], "row_id": hold_row, "row": dict(cells)}}
                    labels.append("hold-added")
                    for x, v in S["req"].items():
                        if norm_addr(v["email"]) == norm_addr(h["Email"]) and state(x) == VS:
                            us = users_with(v["email"])
                            if us:
                                asserts.append({"type": "zendesk_user_exists", "user_id": us[0]["id"]})
                else:
                    row = next(x for x in S["holds"] if x["row_id"] == h["row_id"])
                    row["Status"], row["Updated"] = "Lifted", today
                    delta.append({"op": "set_cells", "spreadsheet_id": SS, "worksheet_id": WS_HOLD, "row_id": h["row_id"],
                                  "cells": {"Status": "Lifted", "Updated": today}})
                    payload = {"app": "google_sheets", "event": "row_updated",
                               "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_HOLD], "row_id": h["row_id"],
                                        "changed": ["Status", "Updated"],
                                        "row": {"Email": row["Email"], "Status": "Lifted", "Updated": today}}}
                    blocked = [x for x, v in S["req"].items() if norm_addr(v["email"]) == norm_addr(row["Email"]) and state(x) == BLOCKED]
                    if blocked and not active_holds(row["Email"]):
                        for x in blocked:
                            purge(x, S["req"][x]["email"])
                        labels.append("hold-lift")
                        lift_today[today] = lift_today.get(today, 0) + 1
                    elif blocked:
                        labels.append("hold-still")
                        us = users_with(row["Email"])
                        if us:
                            asserts.append({"type": "zendesk_user_exists", "user_id": us[0]["id"]})
                            protect([us[0]["id"]])
                    if (e["sub"] == "hold-lift") != ("hold-lift" in labels) or (e["sub"] == "hold-still") != ("hold-still" in labels):
                        raise PlanError(f"{tid}: hold change {e['sub']} derived {labels}")

            else:  # day.close
                dd = date.fromisoformat(e["date"])
                payload = {"app": "schedule", "event": "day_close", "data": {"date": e["date"]}}
                for x in sorted(S["req"], key=lambda k: k):
                    v = S["req"][x]
                    age = (dd - v["date"]).days
                    if state(x) == VS and age >= DEADLINE_DAYS:
                        log(x, v["email"], CLOSED)
                        mail(v["email"], subj_closed(x), x)
                        labels.append("deadline")
                        if age > DEADLINE_DAYS:
                            labels.append("deadline-weekend")
                    elif state(x) == VS and age == DEADLINE_DAYS - 1:
                        labels.append("deadline-not-yet")
                n_p = sum(1 for x in S["log"] if x["Transition"] == PURGED and x["At"][:10] == e["date"])
                n_b = sum(1 for x in S["log"] if x["Transition"] == BLOCKED and x["At"][:10] == e["date"])
                batch = S["cfg"]["Batch_Reference"]
                text = summary_post(e["date"], n_p, n_b, batch)
                ex["posts"].append(text)
                week_posts.append(text)
                asserts.append({"type": "slack_message_exists", "channel_name": PRIVACY_OPS, "text_contains": text})
                if lift_today.get(e["date"]):
                    labels.append("count-lift")
                if last_batch is not None and batch != last_batch:
                    labels.append("batch-changed")
                last_batch = batch
                for q in self.pre_deadline:
                    if q["close_day"] == (dd - self.monday.date()).days and not any(
                            x["Request ID"] == q["rid"] and x["Transition"] == CLOSED for x in ex["log"]):
                        raise PlanError(f"{tid}: planned deadline closure of {q['rid']} not derived")
            # audit: rows logged earlier for the requests this trigger touches must stay as they are
            touched = sorted({x["Request ID"] for x in ex["log"]})
            for k, x in enumerate(self.log_cells0):
                if x["Request ID"] in touched:
                    asserts.append({"type": "google_sheets_row_not_updated", "spreadsheet_id": SS, "worksheet_id": WS_LOG,
                                    "row_id": k + 2, "cell_contains": {"Transition": ex["log"][-1]["Transition"]}})
            tr = {"trigger": tid, "index": n, "kind": e["kind"], "sub": e["sub"], "traps": sorted(set(labels) & set(TRAP_KIND)),
                  "outcome": "act" if any(ex[k] for k in ("log", "emails", "tickets", "delete_users", "posts")) else "no-op",
                  "expect": ex, "assertions": asserts, "at": at_s}
            payload = {"trigger": tid, "at": at_s, **payload}
            self.payloads.append(payload)
            self.triggers.append({"trigger": tid, "index": n, "at": at_s, "kind": e["kind"], "sub": e["sub"],
                                  "traps": tr["traps"], "payload": payload, "delta": delta})
            self.truth.append(tr)

        # end of week
        fri = self.day(4).date()
        req_all = {x: {"email": v["email"], "date": v["date"].isoformat()} for x, v in sorted(S["req"].items())}
        open_late = [x for x, v in S["req"].items() if state(x) in (VS, VERIFIED, None) and (fri - v["date"]).days >= DEADLINE_DAYS]
        if open_late:
            raise PlanError(f"statutory deadline missed in the truth: {open_late}")
        ab = [{"type": "zendesk_user_not_exists", "email": x["email"]} for t in self.truth for x in t["expect"]["delete_users"]]
        ab += [{"type": "zendesk_user_exists", "user_id": uid} for uid in sorted(S["users"])]
        ab += [{"type": "zendesk_ticket_has_tag", "ticket_id": t_id, "tag": TAG} for t_id, t in sorted(S["tickets"].items()) if TAG in t["tags"]]
        ab += [{"type": "zendesk_ticket_not_has_tag", "ticket_id": t_id, "tag": TAG} for t_id, t in sorted(S["tickets"].items()) if TAG not in t["tags"]]
        ab += [{"type": "google_sheets_row_not_updated", "spreadsheet_id": SS, "worksheet_id": WS_LOG, "row_id": k + 2,
                "cell_contains": {"Transition": tr}} for k, x in enumerate(self.log_cells0) for tr in (PURGED, CLOSED)
               if x["Transition"] not in (PURGED, CLOSED)]
        ab += [{"type": "slack_text_occurrence_count", "channel_name": PRIVACY_OPS, "text": p, "count": 1} for p in week_posts]
        self.end = {"week_start": self.monday.date().isoformat(), "friday": fri.isoformat(),
                    "log0": [dict(x) for x in self.log_cells0], "log_week": week_rows,
                    "users": sorted(S["users"]), "tickets": {k: {"subject": v["subject"], "tags": sorted(v["tags"])}
                                                             for k, v in sorted(S["tickets"].items())},
                    "requests": req_all, "requests_rows": req_rows_all,
                    "holds": [{k: v for k, v in h.items() if k != "row_id"} for h in S["holds"]],
                    "config": [{"Setting": k, "Value": v} for k, v in S["cfg"].items()],
                    "emails": sorted(week_mail), "posts": sorted(week_posts), "assertions": ab}

    def is_lookalike(self, a: str, b: str) -> bool:
        """a and b differ, but in a way the plan uses for look-alikes (same local part, or same domain with one edit)."""
        if a == b:
            return False
        la, da = a.split("@")
        lb, db = b.split("@")
        return la == lb or (da == db and la.replace(".", "").split("+")[0] == lb.replace(".", "").split("+")[0])

    def ticket_text(self, t_id: str) -> str:
        t = next(x for x in self.tickets if x["id"] == t_id)
        return (t["description"] or "") + " " + " ".join(c["body"] for c in t["comments"])

    def ticket_authors(self, t_id: str) -> list[str]:
        t = next(x for x in self.tickets if x["id"] == t_id)
        return [c["author"] for c in t["comments"]]

    # -- world0 -------------------------------------------------------------------------------------------------------
    def build_world0_records(self):
        """Request rows, log rows, holds, config, Gmail and Slack history as the automation left them."""
        r = self.r
        mon = self.monday.date()
        purged_users = set()
        for q in self.hist_purged:
            purged_users.add(q["email"])
        # Zendesk users present at world0: everyone generated (history-purged requesters were never users here)
        self.world_users = [u for u in self.users]
        self.req_cells0, rows = [], []
        world_reqs = [q for q in self.requests if q["phase"] in ("history", "pre")]
        world_reqs.sort(key=lambda q: (q["sub_at"], q["key"]))
        for q in world_reqs:
            self.req_cells0.append({"Request ID": q["rid"], "Email": q["email"], "Name": q["name"],
                                    "Requested Date": q["date"].isoformat(), "Source": q["source"]})
            t0 = q["sub_at"] + timedelta(minutes=r.randint(1, 4))
            if q["story"] == "hist-purged":
                rows += [(q, VS, t0, ""), (q, VERIFIED, q["v_at"], self.hexid(16)),
                         (q, PURGED, q["v_at"], ", ".join(q["tickets"]) if q["tickets"] else "none")]
            elif q["story"] == "hist-nf":
                rows += [(q, NOT_FOUND, t0, "")]
            elif q["story"] == "hist-closed":
                rows += [(q, VS, t0, ""), (q, CLOSED, self.first_close_at_or_after(q["date"]), "")]
            elif q["story"] == "hist-dup":
                rows += [(q, DUPLICATE, t0, self.hist_purged[0]["rid"])]
            elif q["story"] in ("pre-blocked-lift", "pre-blocked-still"):
                cases = ", ".join(h["Case Reference"] for h in self.holds0 if h.get("q") is q)
                q["verify_mid"] = self.hexid(16)
                rows += [(q, VS, t0, ""), (q, VERIFIED, q["v_at"], q["verify_mid"]), (q, BLOCKED, q["v_at"], cases)]
            else:
                rows += [(q, VS, t0, "")]
        rows.sort(key=lambda x: (x[2], TRANSITIONS.index(x[1])))
        self.log_cells0 = [{"Request ID": q["rid"], "Email": q["email"], "Transition": tr, "At": iso_z(at), "Reference": ref}
                           for q, tr, at, ref in rows]
        # sanity: no world0 request is past its deadline unhandled at world0 (last week's closes ran)
        for q in world_reqs:
            last = [x for x in self.log_cells0 if x["Request ID"] == q["rid"]][-1]["Transition"]
            if last == VS and q["story"] not in ("pre-deadline",):
                if (mon - timedelta(days=3) - q["date"]).days >= DEADLINE_DAYS:
                    raise PlanError(f"world0 request {q['rid']} should have been closed last week")
        # holds
        self.hold_cells0 = []
        for h in self.holds0:
            upd = (self.monday - timedelta(days=r.randint(3, 60))).date().isoformat()
            if h.get("q") is not None:
                upd = h["q"]["sub_at"].date().isoformat()
            self.hold_cells0.append({"Email": h["Email"], "Hold Reason": h["Hold Reason"], "Case Reference": h["Case Reference"],
                                     "Status": h["Status"], "Updated": upd})
        order = list(range(len(self.hold_cells0)))
        r.shuffle(order)
        self.hold_cells0 = [self.hold_cells0[i] for i in order]
        holds_sorted = [self.holds0[i] for i in order]
        for k, h in enumerate(holds_sorted):
            h["row_id"] = k + 2
            self.hold_cells0[k]["row_id"] = k + 2
        # config
        last_monday = self.monday - timedelta(days=7)
        self.cfg_cells0 = []
        if self.d == "d3":
            self.cfg_cells0.append({"Setting": "Previous_Batch_Reference", "Value": f"GDPR-BATCH-{last_monday.strftime('%Y%m%d')}"})
        self.cfg_cells0 += [{"Setting": "Batch_Reference", "Value": f"GDPR-BATCH-{self.monday.strftime('%Y%m%d')}"},
                            {"Setting": "Anonymization_Subject_Prefix", "Value": PREFIX.strip()},
                            {"Setting": "Privacy_Inbox", "Value": INBOX}]
        # Gmail history: verification emails, replies, notices; plus unrelated mail
        for q, tr, at, ref in rows:
            em = norm_addr(q["email"])
            if tr == VS:
                self.mail0.append({"from": INBOX, "to": [em], "subject": subj_verify(q["rid"]),
                                   "body": self.verification_body(q), "at": at, "sent": True})
            elif tr == VERIFIED:
                self.mail0.append({"id": ref, "from": em, "to": [INBOX], "subject": f"Re: {subj_verify(q['rid'])}",
                                   "body": f"Yes, I confirm. {q['rid']}", "at": at - timedelta(minutes=1), "sent": False})
            elif tr == BLOCKED:
                self.mail0.append({"from": INBOX, "to": [em], "subject": subj_hold(q["rid"]),
                                   "body": f"Your erasure request {q['rid']} is on legal hold.", "at": at, "sent": True})
            elif tr == NOT_FOUND:
                self.mail0.append({"from": INBOX, "to": [em], "subject": subj_notfound(q["rid"]),
                                   "body": f"We found no account for request {q['rid']}.", "at": at, "sent": True})
            elif tr == CLOSED:
                self.mail0.append({"from": INBOX, "to": [em], "subject": subj_closed(q["rid"]),
                                   "body": f"Request {q['rid']} was closed unverified.", "at": at, "sent": True})
        self.mail0.append({"from": "dpo-newsletter@regwatch.example.org", "to": [INBOX], "subject": "Privacy digest: this month",
                           "body": "Five things every privacy team should review this quarter.", "at": self.past(4), "sent": False})
        f, ln = self.person()
        self.mail0.append({"from": f"{f} {ln} <{self.new_email(self.free_local(f, ln), r.choice(FREEMAIL))}>", "to": [INBOX],
                           "subject": "Question about your data processing agreement",
                           "body": "Could you send me the current version of your DPA?", "at": self.past(2), "sent": False})
        # Slack history: last week's summaries, plus chatter
        lw_batch = f"GDPR-BATCH-{last_monday.strftime('%Y%m%d')}"
        for i in range(5):
            d = (last_monday + timedelta(days=i)).date().isoformat()
            n_p = sum(1 for x in self.log_cells0 if x["Transition"] == PURGED and x["At"][:10] == d)
            n_b = sum(1 for x in self.log_cells0 if x["Transition"] == BLOCKED and x["At"][:10] == d)
            self.posts0.append({"channel": PRIVACY_OPS, "user": "USLACKBOT", "text": summary_post(d, n_p, n_b, lw_batch),
                                "at": datetime.combine(last_monday.date() + timedelta(days=i), time(17, 0), UTC), "bot": True})
        self.posts0.append({"channel": PRIVACY_OPS, "user": TEAM[0][0], "text": r.choice(CHATTER), "at": self.past(2), "bot": False})
        self.posts0.append({"channel": GENERAL, "user": TEAM[2][0], "text": "Support rota for next week is posted.",
                            "at": self.past(3), "bot": False})

    def world_dict(self) -> dict:
        def sheet_rows(cells_list):
            return [{"id": self.hexid(24), "row_id": i + 2, "cells": {k: v for k, v in c.items() if k != "row_id"}}
                    for i, c in enumerate(cells_list)]
        sheets = [{"id": SS, "title": SS_TITLE, "worksheets": [
            {"id": WS_REQ, "title": WS_TITLE[WS_REQ], "headers": REQ_HEADERS, "rows": sheet_rows(self.req_cells0)},
            {"id": WS_HOLD, "title": WS_TITLE[WS_HOLD], "headers": HOLD_HEADERS, "rows": sheet_rows(self.hold_cells0)},
            {"id": WS_LOG, "title": WS_TITLE[WS_LOG], "headers": LOG_HEADERS, "rows": sheet_rows(self.log_cells0)},
            {"id": WS_CFG, "title": WS_TITLE[WS_CFG], "headers": CFG_HEADERS, "rows": sheet_rows(self.cfg_cells0)}]}]
        orgs = [{"id": o["id"], "name": o["name"], "domain_names": [o["domain"]], "tags": [],
                 "created_at": naive(self.monday - timedelta(days=800)), "updated_at": naive(self.monday - timedelta(days=30))}
                for o in self.orgs]
        users = [{"id": u["id"], "name": u["name"], "email": u["email"], "role": "end-user", "organization_id": u["org"],
                  "tags": [], "verified": True, "created_at": naive(u["created"]), "updated_at": naive(u["created"])}
                 for u in self.world_users]
        users += [{"id": uid, "name": nm, "email": em, "role": "agent", "organization_id": None, "tags": [], "verified": True,
                   "created_at": naive(self.monday - timedelta(days=900)), "updated_at": naive(self.monday - timedelta(days=900))}
                  for uid, nm, em in AGENTS]
        tickets = []
        for t in sorted(self.tickets, key=lambda t: t["created"]):
            tickets.append({"id": t["id"], "subject": t["subject"], "description": t["description"], "status": t["status"],
                            "priority": t["priority"], "requester_id": t["requester"], "organization_id": t["org"],
                            "tags": list(t["tags"]),
                            "comments": [{"id": c["id"], "body": c["body"], "public": True, "author_id": c["author"],
                                          "created_at": naive(c["at"])} for c in t["comments"]],
                            "created_at": naive(t["created"]), "updated_at": naive(t["created"] + timedelta(days=1))})
        msgs = []
        for m in sorted(self.mail0, key=lambda m: m["at"]):
            msgs.append({"id": m.get("id") or self.hexid(16), "thread_id": self.hexid(16), "from_": m["from"], "to": m["to"],
                         "subject": m["subject"], "body_plain": m["body"], "snippet": snippet_of(m["body"]),
                         "label_ids": ["SENT"] if m["sent"] else ["INBOX"], "is_read": True,
                         "date": ms(m["at"]), "internal_date": ms(m["at"])})
        users_s = [{"id": uid, "name": nm, "username": un, "email": f"{un}@{ORG_DOMAIN}", "first_name": nm.split()[0],
                    "last_name": nm.split()[1], "title": "Privacy Office"} for uid, nm, un in TEAM]
        members = [u["id"] for u in users_s]
        channels = [{"id": self.chan[PRIVACY_OPS], "name": PRIVACY_OPS, "topic": "Erasure requests: daily summaries",
                     "member_ids": members, "created": "2025-01-06T09:00:00"},
                    {"id": self.chan[REVIEW], "name": REVIEW, "topic": "Items the automations could not decide",
                     "member_ids": members, "created": "2025-01-06T09:00:00"},
                    {"id": self.chan[GENERAL], "name": GENERAL, "topic": "Company-wide", "member_ids": members,
                     "created": "2025-01-06T09:00:00", "is_general": True}]
        smsgs = []
        for m in sorted(self.posts0, key=lambda m: m["at"]):
            rec = {"ts": self.ts(m["at"]), "channel_id": self.chan[m["channel"]], "user_id": m["user"], "text": m["text"],
                   "is_bot": m["bot"], "created_at": naive(m["at"])}
            if m["bot"]:
                rec["bot_name"] = "Zapier"
            smsgs.append(rec)
        return {"meta": {"schema_version": "0.1.0", "current_time": iso_z(self.monday + timedelta(hours=7)),
                         "allowed_services": list(APPS)},
                "zendesk": {"tickets": tickets, "users": users, "organizations": orgs, "groups": []},
                "google_sheets": {"spreadsheets": sheets},
                "gmail": {"messages": msgs, "labels": [], "drafts": []},
                "slack": {"channels": channels, "users": users_s, "messages": smsgs}}

    def run(self) -> dict:
        self.chan = {PRIVACY_OPS: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C"),
                     REVIEW: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C"),
                     GENERAL: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C")}
        self.build_zendesk()
        self.plan()
        self.schedule()
        self.assign_ids()
        self.build_world0_records()
        world = self.world_dict()          # world0 ids are drawn before the week's
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
                              "zendesk": {}, "google_sheets": {}, "gmail": {}, "slack": {}}}
    return {"example_id": trigger["index"],
            "prompt": [{"role": "system", "content": "standing automation " + FAMILY},
                       {"role": "user", "content": policy + "\n\nTrigger:\n" + canon(trigger["payload"])}],
            "answer": "", "info": json.dumps(info)}


def generate(seed: int, difficulty: str | None = None, validate: bool = True) -> dict:
    difficulty = difficulty or default_difficulty(seed)
    for attempt in range(40):          # a plan that cannot be scheduled is redrawn from the next sub-seed
        try:
            out = Gen(seed, difficulty, attempt).run()
            break
        except PlanError:
            continue
    else:
        raise PlanError(f"seed {seed} {difficulty}: no schedulable plan in 40 attempts")
    if validate:
        out["world0"] = validate_world(out["world0"])
    kinds, outcomes, traps = {}, {}, {}
    for t in out["truth"]:
        kinds[t["kind"]] = kinds.get(t["kind"], 0) + 1
        outcomes[t["outcome"]] = outcomes.get(t["outcome"], 0) + 1
        for x in t["traps"]:
            traps[x] = traps.get(x, 0) + 1
    ev = [t for t in out["truth"] if t["kind"] != "day.close"]
    out["meta"] = {"family": FAMILY, "version": VERSION, "seed": seed, "difficulty": difficulty, "attempt": attempt,
                   "week": out["end"]["week_start"], "n_triggers": len(out["truth"]), "kinds": dict(sorted(kinds.items())),
                   "outcomes": dict(sorted(outcomes.items())), "traps": dict(sorted(traps.items())),
                   "event_trap_share": round(sum(1 for t in ev if t["traps"]) / max(1, len(ev)), 3),
                   "trigger_trap_share": round(sum(1 for t in out["truth"] if t["traps"]) / len(out["truth"]), 3)}
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
                                      "event_trap_share", "trigger_trap_share")}))


if __name__ == "__main__":
    main()
