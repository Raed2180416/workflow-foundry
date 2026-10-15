#!/usr/bin/env python3
"""abr-fin-apintake: seeded stream generator (AutomationBench-R family 9; research/automationbench-20261014/
RECURRING-DESIGN.md §3.2, §4.9). Runs inside AutomationBench's own venv (it validates worlds with its WorldState):

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-fin-apintake/gen.py \
        --seed 610 [--difficulty d2] --out HOSTDIR

Writes into HOSTDIR (host-only; nothing generated is committed):
  world0.json        the initial world (WorldState dump; arms see it only through the tools)
  payloads.jsonl     the arm-visible trigger payloads, one per line, in order
  triggers.jsonl     host-only: payload + delta (world ops applied before the trigger) + kind + sub + traps
  truth.jsonl        host-only: per trigger, the outcome, the expected effects, AutomationBench assertion dicts and
                     the approval authority map used by the hard-requirement check
  end.json           host-only: the end-of-week expectations (graded at the last trigger, Friday's week close)
  serve-inputs.jsonl one input row per trigger for `bridge.py serve --input <row> --world world_t.json`
  meta.json          family, version, seed, difficulty, counts, trap shares and sha256 of every file

Determinism: one random.Random(f"{family}:{version}:{seed}:{difficulty}"); no wall clock, no set iteration in any
output, every id and datetime written explicitly, so no pydantic default factory fires.

The truth comes from the generator's own canonical model of the business (`Book`: Pending Invoices, Receiving,
Blocked Vendors, Policy Log, the #accounts-payable messages and the QuickBooks bills, as they would be after correct
handling of every earlier trigger), never from a solver's output. The plan only says what happens in the world (which
vendor sends which invoice, which delivery arrives, who writes which email or Slack message); the expected effects are
derived by applying POLICY.md to that world, and the planned intent is then asserted against the derivation (a plan
whose intent does not hold is redrawn). The reference solver (reference.py) is a separate implementation that sees only
the payload, POLICY.md and the tools. Every person, company and address is fictional (RFC 2606 *.example.com / .net /
.org); `Acme Supplies LLC` / `Acme Solutions Inc.` are AutomationBench's own fictional pair.
"""
from __future__ import annotations

import argparse
import copy
import difflib
import hashlib
import json
import random
import re
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

FAMILY = "abr-fin-apintake"
VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
UTC = timezone.utc

APPS = ("gmail", "google_sheets", "quickbooks", "slack")
SS, SS_TITLE = "ss_ap", "AP Intake"
WS_PENDING, WS_BLOCKED, WS_PO = "ws_pending", "ws_blocked", "ws_po"
WS_RECV, WS_APPROVERS, WS_POLICY = "ws_receiving", "ws_approvers", "ws_policy_log"
WS_TITLE = {WS_PENDING: "Pending Invoices", WS_BLOCKED: "Blocked Vendors", WS_PO: "Purchase Orders",
            WS_RECV: "Receiving", WS_APPROVERS: "Approvers", WS_POLICY: "Policy Log"}
HEADERS = {
    WS_PENDING: ["Logged", "Vendor", "Invoice #", "Invoice Date", "Due Date", "Amount", "Qty", "PO #", "Approver",
                 "Match", "Approval", "Status", "Notes"],
    WS_BLOCKED: ["Vendor Name", "Reason", "Status", "Updated"],
    WS_PO: ["PO #", "Vendor", "Department", "Qty", "Amount", "Issued"],
    WS_RECV: ["PO #", "Received Qty", "Received Date", "Note"],
    WS_APPROVERS: ["Role", "Department", "Name", "Email", "Active"],
    WS_POLICY: ["Effective", "Parameter", "Value", "Approved by"],
}
ORG = "company.example.com"
INBOX = f"ap@{ORG}"
AP_LEAD = f"ap-lead@{ORG}"
CFO = f"cfo@{ORG}"
CONTROLLER = f"controller@{ORG}"
AP_CHANNEL, REVIEW, GENERAL = "accounts-payable", "automation-review", "general"
QB_REALM = "4620816365"

OPEN, PROCESSING, PAID, REJECTED = "Open", "Processing", "Paid", "Rejected - Blocked"
AWAIT_RECEIPT, MATCHED = "Awaiting Receipt", "Matched"
PV_REVIEW, PV_HOLD, QD_HOLD = "Price Variance - Review", "Price Variance - Hold", "Quantity Discrepancy - Hold"
NOTIFY = (QD_HOLD, PV_REVIEW, PV_HOLD)
NOT_REQUIRED, AWAITING, APPROVED = "Not Required", "Awaiting Approval", "Approved"
P_APPROVAL, P_CFO = "Approval threshold", "CFO threshold"
ACTIVE_BLOCK, LIFTED = "Active Block", "Lifted"
PARTIAL = "partial - expected"
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Per difficulty: (lo, hi) per trigger kind (RECURRING-DESIGN §4.9 / the family spec).
COUNTS = {
    "d1": dict(inv=(14, 14), recv=(10, 10), appr=(4, 4), resent=(2, 2), corr=(1, 1), block=(0, 0), other=(0, 0), amend=(0, 0)),
    "d2": dict(inv=(14, 16), recv=(10, 11), appr=(4, 6), resent=(2, 3), corr=(1, 2), block=(0, 1), other=(1, 1), amend=(0, 0)),
    "d3": dict(inv=(16, 18), recv=(11, 12), appr=(5, 7), resent=(3, 3), corr=(2, 3), block=(1, 2), other=(1, 1), amend=(2, 2)),
}
# Base rates of optional traps per difficulty (d1 plants none).
RATES = {
    "d1": dict(amount_fmt=0.0, date_fmt=0.0, sender_alt=0.0, weekend=0.0, trap_appr=(0, 0), unknown_po=0.0, lookalike_po=0.0,
               extra_blocked=0.0, future_row=0.0, inactive_head=0.0, band_edge=0.0, var_edge=0.0, same_amount_old=0.0,
               partial=0.0, short_other=0.0, qty_mismatch=0.0, review=0.10, hold=0.0, early_corr=0.0, unauth_corr=0.0,
               review_hist=0.0),
    "d2": dict(amount_fmt=0.12, date_fmt=0.12, sender_alt=0.25, weekend=None, trap_appr=(1, 2), unknown_po=0.5, lookalike_po=0.0,
               extra_blocked=0.0, future_row=0.5, inactive_head=1.0, band_edge=0.5, var_edge=0.3, same_amount_old=0.5,
               partial=1.0, short_other=0.5, qty_mismatch=0.5, review=0.12, hold=0.05, early_corr=0.5, unauth_corr=0.5,
               review_hist=0.0),
    "d3": dict(amount_fmt=0.30, date_fmt=0.30, sender_alt=0.35, weekend=None, trap_appr=(2, 3), unknown_po=1.0, lookalike_po=1.0,
               extra_blocked=0.5, future_row=1.0, inactive_head=1.0, band_edge=1.0, var_edge=1.0, same_amount_old=1.0,
               partial=1.0, short_other=1.0, qty_mismatch=1.0, review=0.14, hold=0.07, early_corr=1.0, unauth_corr=1.0,
               review_hist=1.0),
}

# ---------------------------------------------------------------------------------------------------------------
# Fictional pools (no real person or organization). Domains use the RFC 2606 reserved names only.
# (legal name, domain, invoice prefix, what they sell)
# ---------------------------------------------------------------------------------------------------------------
VENDOR_SINGLES = [
    ("Tamarack Electrical Supply Co.", "tamarack-electrical.example.com", "TES", "electrical supplies"),
    ("Quillfeather Print Works", "quillfeather-print.example.com", "QPW", "printed materials"),
    ("Ostrander Lab Supplies Inc.", "ostrander-lab.example.com", "OLS", "lab consumables"),
    ("Velloro Catering Co.", "velloro-catering.example.com", "VCC", "catering"),
    ("Hallisey HVAC Services LLC", "hallisey-hvac.example.com", "HHS", "HVAC maintenance"),
    ("Marrowdale Packaging Ltd.", "marrowdale-packaging.example.com", "MDP", "packaging materials"),
    ("Kestrelmoor Fleet Maintenance", "kestrelmoor-fleet.example.com", "KFM", "fleet maintenance"),
    ("Junebrook Software Ltd.", "junebrook-software.example.com", "JBS", "software licences"),
    ("Fairhaven Uniform Supply Inc.", "fairhaven-uniform.example.com", "FUS", "work uniforms"),
    ("Silverbirch Office Interiors", "silverbirch-interiors.example.com", "SOI", "office furniture"),
    ("Thornbury Security Services", "thornbury-security.example.com", "TSS", "security services"),
    ("Wexley Industrial Gases Inc.", "wexley-gases.example.com", "WIG", "industrial gases"),
    ("Brackenridge Courier Co.", "brackenridge-courier.example.com", "BCC", "courier services"),
    ("Lindqvist Water Systems", "lindqvist-water.example.com", "LWS", "water treatment"),
]
LOOKALIKE_PAIRS = [
    (("Acme Supplies LLC", "acmesupplies.example.com", "ACM", "janitorial supplies"),
     ("Acme Solutions Inc.", "acmesolutions.example.com", "ASI", "IT consulting")),
    (("Brindle Packaging Co.", "brindle-packaging.example.com", "BRP", "corrugated boxes"),
     ("Brindle Packaging Partners", "brindlepartners.example.net", "BPP", "packaging design")),
    (("Corvane Industrial LLC", "corvane-industrial.example.com", "CVI", "machine parts"),
     ("Corvane Industries LLC", "corvane-industries.example.com", "CVN", "safety equipment")),
    (("Pellham Janitorial Services", "pellham-janitorial.example.com", "PJS", "cleaning services"),
     ("Pelham Janitorial Services", "pelham-cleaning.example.com", "PEL", "cleaning services")),
    (("Northgate Freight Inc.", "northgate-freight.example.com", "NGF", "freight"),
     ("Northgate Freight Co.", "northgatefreight.example.net", "NFC", "freight")),
]
DEPARTMENTS = ["Operations", "Facilities", "IT", "Marketing", "Engineering", "Warehouse"]
FIRST = ["Dana", "Marcus", "Priya", "Tomas", "Helena", "Kofi", "Ingrid", "Rafael", "Mei", "Oscar", "Leila", "Bruno",
         "Sanne", "Arjun", "Nadia", "Elliot", "Yara", "Viktor", "Camila", "Jasper", "Rosa", "Idris", "Freya", "Mateus",
         "Linnea", "Tariq", "Odile", "Kenji", "Amara", "Florian", "Signe", "Rohan", "Beatriz", "Callum", "Esme", "Lukas"]
LAST = ["Ruiz", "Okonkwo", "Lindgren", "Haddad", "Petrov", "Achterberg", "Moreau", "Kowalczyk", "Brennan", "Szabo",
        "Valdivia", "Nakashima", "Ferreira", "Holmgren", "Adeyemi", "Castell", "Weiss", "Marchand", "Okafor", "Duarte",
        "Lindahl", "Varela", "Kaminski", "Osei", "Rautio", "Bianchi", "Hartmann", "Sorensen", "Quintana", "Novak"]
FREEMAIL = ["mailbox.example.org", "postbox.example.net", "inbox.example.org"]
REASONS = ["Contract dispute", "Fraud investigation", "Repeated billing errors", "Sanctions screening hit",
           "Insurance certificate expired"]
TERMS = [15, 30, 30, 30, 45, 60]
LABELS = {"inv": ["Invoice Number", "Invoice #", "Invoice No"], "date": ["Invoice Date", "Date"],
          "due": ["Due Date", "Due"], "po": ["PO Number", "PO #", "Purchase Order"], "qty": ["Quantity", "Qty"],
          "amt": ["Amount", "Amount Due", "Total Due"]}
RECV_NOTES_FULL = ["", "", "All items received", "Count verified", "Delivered to dock 2"]
PARTIAL_NOTES = ["Partial - Expected (balance ships next week)", "Partial - Expected", "partial - expected, remainder on backorder"]
SHORT_NOTES = ["Short shipment - remainder cancelled by vendor", "Partial - not expected, vendor out of stock",
               "Partial shipment, nothing further expected"]

TRAP_KIND = {
    # look-alikes
    "lookalike-blocked": "T-lookalike", "lookalike-po": "T-lookalike", "unknown-po": "T-lookalike",
    "approver-lookalike": "T-lookalike",
    # authority
    "approver-wrong-dept": "T-authority", "approver-display": "T-authority", "approver-not-cfo": "T-authority",
    "approver-inactive": "T-authority", "correction-unauthorized": "T-authority", "amendment-unauthorized": "T-authority",
    "unblock-request": "T-authority", "remit-address": "T-authority",
    # notes
    "blocked-vendor": "T-note", "partial-expected": "T-note", "partial-note-other": "T-note", "not-approved": "T-note",
    "other-invoice": "T-note", "pay-blocked": "T-note", "block-added": "T-note", "pay-unapproved": "T-note",
    "pay-review": "T-note",
    # repeats
    "second-notice": "T-repeat", "second-notice-amount": "T-repeat", "dup-paid": "T-repeat", "reissue-dup": "T-repeat",
    "dup-window-edge": "T-repeat", "same-amount-old": "T-repeat", "repeat-approval": "T-repeat",
    # formats
    "amount-format": "T-format", "date-format": "T-format", "weekend-due": "T-format", "band-boundary": "T-format",
    "variance-boundary": "T-format",
    # stale / versions
    "policy-log-old": "T-stale", "policy-log-future": "T-stale", "inactive-head": "T-stale", "block-lifted-row": "T-stale",
    "block-lifted": "T-stale", "processing-total": "T-stale", "logged-week-only": "T-stale",
    # cross-trigger state
    "receipt-first": "T-state", "receipt-before-invoice": "T-state", "partial-complete": "T-state",
    "correction-early": "T-state", "correction-rematch": "T-state", "correction-band": "T-state",
    "amended-band": "T-state", "amendment-authorized": "T-state", "carryover": "T-state", "pay-corrected": "T-state",
}


# ---------------------------------------------------------------------------------------------------------------
# helpers (shared with nothing: the reference and the oracle have their own)
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


def wsk(s) -> str:
    """POLICY section 3: names compare ignoring letter case and runs of spaces."""
    return " ".join(str(s or "").split()).lower()


def addr(s) -> str:
    """POLICY section 3: the address of a From header (the part in angle brackets), lower-cased and stripped."""
    m = re.search(r"<([^<>]+)>\s*$", str(s or ""))
    return (m.group(1) if m else str(s or "")).strip().lower()


def num_key(s) -> str:
    return str(s or "").strip().upper()


def plain(c: int) -> str:
    """Cents as a sheet amount: 4750.00."""
    return f"{c // 100}.{c % 100:02d}"


def usd(c: int) -> str:
    return f"${c // 100:,}.{c % 100:02d}"


def amount_text(c: int, style: str) -> str:
    if style == "usd-prefix":
        return f"USD {c // 100:,}.{c % 100:02d}"
    if style == "usd-suffix":
        return f"{c // 100:,}.{c % 100:02d} USD"
    if style == "bare-dollar":
        return f"${c // 100}" if c % 100 == 0 else f"${c // 100}.{c % 100:02d}"
    return usd(c)


def date_text(d: date, style: str) -> str:
    if style == "long":
        return d.strftime("%B ") + str(d.day) + d.strftime(", %Y")
    if style == "short":
        return d.strftime("%b ") + str(d.day) + d.strftime(", %Y")
    if style == "dmy":
        return f"{d.day} " + d.strftime("%B %Y")
    return d.isoformat()


def moved_due(d: date) -> date:
    """POLICY section 5 rule 4: a Saturday or Sunday due date moves to the following Monday."""
    return d + timedelta(days=(7 - d.weekday()) % 7) if d.weekday() >= 5 else d


def is_lookalike(a: str, b: str) -> bool:
    a, b = wsk(a), wsk(b)
    if a == b:
        return False
    return a.split()[0] == b.split()[0] or difflib.SequenceMatcher(None, a, b).ratio() >= 0.85


def variance_class(amount: int, po_amount: int) -> str:
    """POLICY section 9 rule 3, in exact integer arithmetic on cents."""
    diff = abs(amount - po_amount)
    if diff * 100 <= 2 * po_amount:
        return MATCHED
    if diff * 100 <= 5 * po_amount:
        return PV_REVIEW
    return PV_HOLD


def default_difficulty(seed: int) -> str:
    """Within each seed block (RECURRING-DESIGN §3.9) the first seed is d2, then d2/d3 alternate."""
    starts = [601, 610, 614, 622, 631, 8801, 8805, 8825, 8837]
    start = max([s for s in starts if s <= seed], default=seed)
    return "d2" if (seed - start) % 2 == 0 else "d3"


def snippet_of(body: str) -> str:
    return " ".join(body.split())[:100]


APPROVAL_RE = r"\b(not\s+)?approved\s*[:\-]?\s*{inv}(?![A-Za-z0-9-])"


def approves(text: str, inv: str) -> bool:
    """POLICY section 7: the word Approved directly followed by the Invoice # (optional ':' or '-'); not 'Not approved'."""
    pat = re.compile(APPROVAL_RE.format(inv=re.escape(inv.strip())), re.I)
    return any(m.group(1) is None for m in pat.finditer(text or ""))


class PlanError(RuntimeError):
    pass


# ---------------------------------------------------------------------------------------------------------------
# the canonical model of the business (applies POLICY.md; used for the truth only)
# ---------------------------------------------------------------------------------------------------------------
class Book:
    def __init__(self, g: "Gen"):
        self.g = g
        self.rows = [{"row_id": c["row_id"], "cells": {k: v for k, v in c.items() if k != "row_id"}} for c in g.pending0]
        self.recv = [dict(c) for c in g.recv0]
        self.blocked = [{"row_id": i + 2, "cells": {k: v for k, v in c.items() if k != "row_id"}} for i, c in enumerate(g.blocked0)]
        self.policy = [dict(c) for c in g.policy0]
        self.po = {num_key(c["PO #"]): dict(c) for c in g.po0}
        self.approvers = [dict(c) for c in g.approvers0]
        self.slack = [dict(m) for m in g.slack_ap0]          # {"email", "text"} in #accounts-payable, in order
        self.bills = [dict(b) for b in g.bills0]              # {"id","vendor_id","doc","total","balance"}

    # -- reads -----------------------------------------------------------------------------------------------------
    def active_blocks(self) -> list[str]:
        return [wsk(b["cells"]["Vendor Name"]) for b in self.blocked if wsk(b["cells"]["Status"]) == wsk(ACTIVE_BLOCK)]

    def is_blocked(self, vendor: str) -> bool:
        return wsk(vendor) in self.active_blocks()

    def thresholds(self, at: datetime) -> dict[str, int]:
        out = {}
        for p in (P_APPROVAL, P_CFO):
            rows = [c for c in self.policy if wsk(c["Parameter"]) == wsk(p)
                    and datetime.fromisoformat(c["Effective"].replace("Z", "+00:00")) <= at]
            if not rows:
                raise PlanError(f"no {p} in force at {at}")
            best = max(rows, key=lambda c: datetime.fromisoformat(c["Effective"].replace("Z", "+00:00")))
            out[p] = int(round(float(best["Value"]) * 100))
        return out

    def approver(self, amount: int, dept: str, at: datetime, policy=None) -> str:
        th = policy or self.thresholds(at)
        if amount < th[P_APPROVAL]:
            return "none"
        if amount <= th[P_CFO]:
            hits = [c for c in self.approvers if wsk(c["Role"]) == "department head" and wsk(c["Department"]) == wsk(dept)
                    and wsk(c["Active"]) == "yes"]
        else:
            hits = [c for c in self.approvers if wsk(c["Role"]) == "cfo" and wsk(c["Active"]) == "yes"]
        if len(hits) != 1:
            raise PlanError(f"{len(hits)} approvers for {dept} at {amount}")
        return hits[0]["Email"].lower()

    def correction_for(self, inv: str) -> int | None:
        hit = None
        for m in self.slack:
            if m["email"] == AP_LEAD and re.search(rf"(?<![A-Za-z0-9-]){re.escape(inv)}(?![A-Za-z0-9-])", m["text"], re.I):
                c = parse_correction(m["text"])
                if c is not None:
                    hit = c
        return hit

    def find_row(self, vendor: str, inv: str) -> dict | None:
        for r in self.rows:
            if wsk(r["cells"]["Vendor"]) == wsk(vendor) and num_key(r["cells"]["Invoice #"]) == num_key(inv):
                return r
        return None

    def rows_with_inv(self, inv: str) -> list[dict]:
        return [r for r in self.rows if num_key(r["cells"]["Invoice #"]) == num_key(inv)]

    def duplicate_of(self, vendor: str, inv: str, amount: int, inv_date: date) -> dict | None:
        for r in self.rows:
            c = r["cells"]
            if wsk(c["Status"]) == wsk(REJECTED) or wsk(c["Vendor"]) != wsk(vendor):
                continue
            if num_key(c["Invoice #"]) == num_key(inv):
                return r
            if int(round(float(c["Amount"]) * 100)) == amount and abs((date.fromisoformat(c["Invoice Date"]) - inv_date).days) <= 7:
                return r
        return None

    def three_way(self, cells: dict) -> str | None:
        """POLICY section 9 for a row; None = wait (no receiving rows, or Partial - Expected)."""
        po = self.po.get(num_key(cells["PO #"]))
        recs = [c for c in self.recv if num_key(c["PO #"]) == num_key(cells["PO #"])]
        if po is None or not recs:
            return None
        received = sum(int(c["Received Qty"]) for c in recs)
        newest = max(enumerate(recs), key=lambda x: (x[1]["Received Date"], x[0]))[1]
        if received < int(po["Qty"]) and PARTIAL in newest["Note"].lower():
            return None
        if not (int(cells["Qty"]) == int(po["Qty"]) == received):
            return QD_HOLD
        return variance_class(int(round(float(cells["Amount"]) * 100)), int(round(float(po["Amount"]) * 100)))


def parse_correction(text: str) -> int | None:
    m = re.search(r"the correct amount is\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)", text or "", re.I)
    if not m:
        return None
    v = m.group(1).replace(",", "")
    whole, _, frac = v.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


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
        self.rate = RATES[difficulty]
        self.ids: set[str] = set()
        self.minutes: set[int] = set()
        self.names: set[str] = set()
        self.po_numbers: set[str] = set()
        self.events: list[dict] = []
        self.mail0: list[dict] = []
        self.posts0: list[dict] = []
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

    def qbid(self) -> str:
        """World0 QuickBooks ids are 6 digits, outside the API's 5-digit random range, so they never collide."""
        return self.uid("0123456789", 5, str(self.r.randint(1, 9)))

    def ts(self, at: datetime) -> str:
        while True:
            v = f"{int(at.timestamp())}.{self.r.randint(100000, 999999):06d}"
            if v not in self.ids:
                self.ids.add(v)
                return v

    def day(self, i: int) -> datetime:
        return self.monday + timedelta(days=i)

    @property
    def run_at(self) -> datetime:
        return self.day(3) + timedelta(hours=10)

    @property
    def close_at(self) -> datetime:
        return self.day(4) + timedelta(hours=17)

    def slot(self, lo: datetime, hi: datetime, h_lo: float = 8.05, h_hi: float = 16.85) -> datetime:
        """A free business minute (Monday-Friday, h_lo..h_hi UTC) strictly inside (lo, hi)."""
        cand = []
        for d in range(5):
            for m in range(int(round(h_lo * 60)), int(round(h_hi * 60))):
                k = d * 1440 + m
                at = self.monday + timedelta(minutes=k)
                if k not in self.minutes and lo < at < hi and at != self.run_at:
                    cand.append(k)
        if not cand:
            raise PlanError(f"no free business minute in ({lo}, {hi})")
        k = self.r.choice(cand)
        self.minutes.add(k)
        return self.monday + timedelta(minutes=k)

    def person(self) -> tuple[str, str]:
        while True:
            f, ln = self.r.choice(FIRST), self.r.choice(LAST)
            if f"{f} {ln}" not in self.names:
                self.names.add(f"{f} {ln}")
                return f, ln

    def new_po(self) -> str:
        while True:
            v = f"PO-{self.r.randint(40000, 49999)}"
            if v not in self.po_numbers:
                self.po_numbers.add(v)
                return v

    def next_inv(self, v: dict) -> str:
        v["next_no"] += self.r.randint(3, 40)
        return f"{v['prefix']}-{v['next_no']}"

    # -- people, vendors ------------------------------------------------------------------------------------------------
    def build_people(self):
        r = self.r
        self.depts = r.sample(DEPARTMENTS, 4)
        self.heads = {}
        for dep in self.depts:
            f, ln = self.person()
            self.heads[dep] = {"name": f"{f} {ln}", "email": f"{f}.{ln}@{ORG}".lower(), "first": f}
        self.inactive = None
        if r.random() < self.rate["inactive_head"]:
            dep = r.choice(self.depts)
            f, ln = self.person()
            self.inactive = {"dept": dep, "name": f"{f} {ln}", "email": f"{f}.{ln}@{ORG}".lower(), "first": f}
        f, ln = self.person()
        self.cfo = {"name": f"{f} {ln}", "email": CFO, "first": f}
        f, ln = self.person()
        self.controller = {"name": f"{f} {ln}", "email": CONTROLLER, "first": f}
        f, ln = self.person()
        self.aplead = {"name": f"{f} {ln}", "email": AP_LEAD, "first": f}
        self.staff = []   # slack users who are not the AP lead
        for role, title in (("clerk", "AP Clerk"), ("buyer", "Buyer"), ("buyer", "Buyer"), ("warehouse", "Warehouse Lead")):
            f, ln = self.person()
            self.staff.append({"role": role, "title": title, "name": f"{f} {ln}", "email": f"{f}.{ln}@{ORG}".lower(), "first": f})
        f, ln = self.person()
        self.guest = {"role": "guest", "title": "Consultant (guest)", "name": f"{f} {ln}",
                      "email": f"{f}.{ln}@audit-partners.example.net".lower(), "first": f}
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
        for p in [self.aplead, self.controller] + self.staff + [self.guest]:
            p["slack_id"] = self.uid(alphabet, 9, "U")

    def mk_vendor(self, spec, role: str) -> dict:
        name, domain, prefix, cat = spec
        f, ln = self.person()
        alt = self.r.random() < self.rate["sender_alt"]
        return {"name": name, "domain": domain, "prefix": prefix, "cat": cat, "role": role, "qb_id": self.qbid(),
                "email": f"billing@{domain}", "sender": f"{self.r.choice(['ar', 'invoices', 'accounts'])}@{domain}" if alt else f"billing@{domain}",
                "contact": f"{f} {ln}", "next_no": self.r.randint(1000, 89000)}

    def build_vendors(self):
        r = self.r
        p1, p2 = r.sample(LOOKALIKE_PAIRS, 2)
        if r.random() < 0.5:
            p1 = (p1[1], p1[0])
        singles = r.sample(VENDOR_SINGLES, 10)
        self.v_fine = self.mk_vendor(p1[0], "lookalike-of-blocked")       # active, a look-alike of a blocked vendor
        self.v_blocked = self.mk_vendor(p1[1], "blocked")                  # Active Block in world0, invoices this week
        self.v_po_a = self.mk_vendor(p2[0], "pair")                        # both active; B may cite A's PO
        self.v_po_b = self.mk_vendor(p2[1], "pair")
        self.v_oldblock = self.mk_vendor(singles[0], "old-blocked")        # Active Block in world0 (history rejection)
        self.v_liftrow = self.mk_vendor(singles[1], "lifted-row")          # a Lifted row in world0: not blocked
        self.v_lift = self.mk_vendor(singles[2], "lift-midweek")           # d3: Active Block lifted this week
        self.v_regular = [self.mk_vendor(s, "regular") for s in singles[3:]]
        self.vendors = [self.v_fine, self.v_blocked, self.v_po_a, self.v_po_b, self.v_oldblock, self.v_liftrow,
                        self.v_lift] + self.v_regular
        self.active_vendors = [self.v_fine, self.v_po_a, self.v_po_b, self.v_liftrow] + self.v_regular

    # -- invoices -------------------------------------------------------------------------------------------------------
    def amount_in(self, band: str) -> int:
        r = self.r
        if band == "low":
            return r.randint(350_00, 4_900_00) // 5 * 5
        if band == "mid":
            return r.randint(5_150_00, 24_500_00) // 5 * 5
        return r.randint(25_600_00, 78_000_00) // 5 * 5

    def make_invoice(self, vendor: dict, at: datetime, band: str, outcome: str, dept: str | None = None,
                     amount: int | None = None, story: str = "normal") -> dict:
        """One invoice with its PO. outcome: matched | review | hold | qty (invoice qty differs from the PO)."""
        r = self.r
        dept = dept or r.choice(self.depts)
        po_qty = r.randint(2, 60)
        inv_qty = po_qty
        target = amount if amount is not None else self.amount_in(band)
        po_amount = target
        if outcome == "matched":
            if amount is None and r.random() < 0.3:
                po_amount = int(round(target / (1 + r.uniform(-0.019, 0.019))))
        elif outcome == "review":
            po_amount = int(round(target / (1 + r.choice([1, -1]) * r.uniform(0.022, 0.048))))
        elif outcome == "hold":
            po_amount = int(round(target / (1 + r.uniform(0.06, 0.15))))
        elif outcome == "qty":
            inv_qty = po_qty + r.choice([-2, -1, 1, 2, 3]) if po_qty > 3 else po_qty + 1
        elif outcome == "edge":           # variance exactly 2% (Matched) or 5% (Review): whole-dollar PO amounts
            po_amount = max(100, target // 100 // 10 * 10) * 100
            pct = r.choice([2, 5])
            target = po_amount + po_amount * pct // 100 * r.choice([1, -1])
        inv_date = (at - timedelta(days=r.randint(0, 6))).date()
        terms = r.choice(TERMS)
        due = inv_date + timedelta(days=terms)
        if self.d == "d1" and due.weekday() >= 5:      # d1 plants no traps: no weekend due dates
            due = moved_due(due)
        q = {"vendor": vendor, "inv": self.next_inv(vendor), "inv_date": inv_date, "due": due, "terms": terms,
             "po": self.new_po(), "qty": inv_qty, "amount": target, "dept": dept, "po_qty": po_qty,
             "po_amount": po_amount, "outcome": outcome, "at": at, "story": story,
             "amt_style": self.pick_style(self.rate["amount_fmt"], ["usd-prefix", "usd-suffix", "bare-dollar"], "usd"),
             "date_style": self.pick_style(self.rate["date_fmt"], ["long", "short", "dmy"], "iso"),
             "labels": {k: r.choice(v) for k, v in LABELS.items()}, "recv": "none", "po_issued": inv_date - timedelta(days=r.randint(3, 20))}
        q["cited_po"] = q["po"]
        return q

    def pick_style(self, p: float, alts: list[str], base: str) -> str:
        return self.r.choice(alts) if self.r.random() < p else base

    def band_of(self, amount: int) -> str:
        return "low" if amount < 5_000_00 else ("mid" if amount <= 25_000_00 else "high")

    # -- the plan -------------------------------------------------------------------------------------------------------
    def plan(self):
        r, d = self.r, self.d
        self.build_people()
        self.build_vendors()
        self.build_history()
        self.build_policy_log()
        n_inv = self.cnt["inv"]
        # stories of this week's invoices
        stories = ["blocked"]
        if r.random() < self.rate["extra_blocked"]:
            stories.append("blocked-old")
        if r.random() < self.rate["unknown_po"]:
            stories.append("unknown-po")
        if r.random() < self.rate["lookalike_po"]:
            stories.append("lookalike-po")
        self.lift_planned = d == "d3" and self.cnt["block"] >= 2
        if self.lift_planned:
            stories.append("lifted")
        if self.cnt["amend"]:
            stories += ["amend-auth", "amend-unauth"]
        if r.random() < self.rate["same_amount_old"]:
            stories.append("same-amount-old")
        if r.random() < self.rate["band_edge"]:
            stories.append("band-edge")
        if r.random() < self.rate["var_edge"]:
            stories.append("var-edge")
        stories.append("fine-lookalike")
        while len(stories) < n_inv:
            stories.append("normal")
        stories = stories[:n_inv]
        # arrival times: weighted to the start of the week
        times = []
        for _ in stories:
            dd = r.choices(range(5), weights=[27, 25, 22, 16, 10])[0]
            lo = self.day(dd) + timedelta(hours=8)
            hi = self.day(dd) + timedelta(hours=15, minutes=50)
            times.append(self.slot(lo, hi))
        times.sort()
        # constrained stories take a suitable time first; the rest are shuffled over the remaining times
        constrained = []
        if "amend-auth" in stories:
            self.amend_auth_at = self.slot(self.day(1) + timedelta(hours=8), self.day(1) + timedelta(hours=12))
            self.amend_unauth_at = self.slot(self.day(1) + timedelta(hours=12), self.day(2) + timedelta(hours=12))
            constrained += [("amend-auth", lambda t: t > self.amend_auth_at + timedelta(hours=1)),
                            ("amend-unauth", lambda t: t > self.amend_unauth_at + timedelta(hours=1))]
        if "lifted" in stories:
            self.lift_at = self.slot(self.day(0) + timedelta(hours=9), self.day(1) + timedelta(hours=16))
            constrained.append(("lifted", lambda t: t > self.lift_at + timedelta(hours=1)))
        placed = []
        for story, pred in constrained:
            ok = [t for t in times if pred(t)]
            if not ok:
                raise PlanError(f"no slot for {story}")
            t = r.choice(ok)
            times.remove(t)
            stories.remove(story)
            placed.append((story, t))
        r.shuffle(stories)
        placed += list(zip(stories, times))
        placed.sort(key=lambda x: x[1])
        self.invoices = []
        for story, at in placed:
            self.invoices.append(self.story_invoice(story, at))
        self.plan_receiving()
        self.plan_resent()
        self.plan_approvals()
        self.plan_corrections()
        self.plan_blocklist()
        self.plan_other()
        self.plan_amendments()
        self.events.append({"kind": "payment.run", "sub": "run", "at": self.run_at})
        self.events.append({"kind": "week.close", "sub": "close", "at": self.close_at})

    def story_invoice(self, story: str, at: datetime) -> dict:
        r = self.r
        outcomes = ["matched"] * 70 + ["review"] * int(self.rate["review"] * 100) + ["hold"] * int(self.rate["hold"] * 100)
        if r.random() < self.rate["qty_mismatch"] * 0.25:
            outcomes += ["qty"] * 10
        band = r.choices(["low", "mid", "high"], weights=[50, 36, 14])[0]
        out = r.choice(outcomes)
        if story == "blocked":
            q = self.make_invoice(self.v_blocked, at, band, "matched", story=story)
        elif story == "blocked-old":
            q = self.make_invoice(self.v_oldblock, at, band, "matched", story=story)
        elif story == "unknown-po":
            q = self.make_invoice(r.choice(self.active_vendors), at, band, "matched", story=story)
            digits = q["po"][3:]
            for _ in range(20):
                alt = "PO-" + "".join(r.sample(digits, len(digits)))
                if alt != q["po"] and alt not in self.po_numbers:
                    break
            else:
                raise PlanError("no unknown PO number")
            q["cited_po"] = alt
            self.po_numbers.add(alt)
        elif story == "lookalike-po":
            # B invoices citing a PO that belongs to its look-alike A (escalate)
            q = self.make_invoice(self.v_po_b, at, band, "matched", story=story)
            q["po_vendor"] = self.v_po_a
        elif story == "lifted":
            q = self.make_invoice(self.v_lift, at, "low", "matched", story=story)
        elif story == "amend-auth":
            if self.amend_param == P_CFO:
                amt = r.randint(self.amend_value * 100 + 50_00, 24_900_00) // 5 * 5
            else:
                amt = r.randint(self.amend_value * 100, 4_950_00) // 5 * 5
            q = self.make_invoice(r.choice(self.active_vendors), at, self.band_of(amt), "matched", amount=amt, story=story)
        elif story == "amend-unauth":
            amt = r.randint(5_100_00, self.unauth_value * 100 - 100_00) // 5 * 5
            q = self.make_invoice(r.choice(self.active_vendors), at, "mid", "matched", amount=amt, story=story)
        elif story == "same-amount-old":
            v = self.old_row_vendor
            q = self.make_invoice(v, at, "low", "matched", amount=self.old_row_amount, story=story)
        elif story == "band-edge":
            q = self.make_invoice(r.choice(self.active_vendors), at, "mid", "matched", amount=r.choice([5_000_00, 25_000_00]), story=story)
            q["po_amount"] = q["amount"]
        elif story == "var-edge":
            q = self.make_invoice(r.choice(self.active_vendors), at, band, "edge", story=story)
        elif story == "fine-lookalike":
            q = self.make_invoice(self.v_fine, at, "low", "matched", story=story)
        else:
            q = self.make_invoice(r.choice(self.active_vendors), at, band, out, story=story)
        # the PO row (unknown-po: none for the cited number; lookalike-po: the PO is A's)
        pv = q.get("po_vendor", q["vendor"])
        q["po_row"] = {"PO #": q["po"], "Vendor": pv["name"], "Department": q["dept"], "Qty": str(q["po_qty"]),
                       "Amount": plain(q["po_amount"]), "Issued": q["po_issued"].isoformat()}
        return q

    # -- receiving ------------------------------------------------------------------------------------------------------
    def plan_receiving(self):
        r = self.r
        n = self.cnt["recv"]
        self.recv_events = []
        # 1. last week's row awaiting receipt
        h = self.h_recv
        at = self.slot(self.day(0) + timedelta(hours=8), self.run_at - timedelta(hours=2))
        self.recv_events.append({"q": h, "qty": h["po_qty"], "note": r.choice(RECV_NOTES_FULL), "at": at, "sub": "carryover"})
        loggable = [q for q in self.invoices if q["story"] not in ("blocked", "blocked-old", "unknown-po", "lookalike-po")]
        r.shuffle(loggable)
        partial = [q for q in loggable if q["outcome"] == "matched"][:1] if r.random() < self.rate["partial"] else []
        short = [q for q in loggable if q["outcome"] == "matched" and q not in partial][:1] if r.random() < self.rate["short_other"] else []
        for q in partial:
            q1 = max(1, q["po_qty"] // 2 - r.randint(0, 1))
            at1 = self.slot(q["at"], self.day(3) + timedelta(hours=16))
            self.recv_events.append({"q": q, "qty": q1, "note": r.choice(PARTIAL_NOTES), "at": at1, "sub": "partial-expected"})
            q["recv"] = "partial"
            if len(self.recv_events) < n - 2 and at1 < self.day(3):
                nxt = datetime.combine(at1.date() + timedelta(days=1), time(0, 0), tzinfo=UTC)
                at2 = self.slot(nxt, self.day(4) + timedelta(hours=16))
                self.recv_events.append({"q": q, "qty": q["po_qty"] - q1, "note": "", "at": at2, "sub": "partial-complete"})
        for q in short:
            k = r.randint(1, max(1, q["po_qty"] // 3))
            self.recv_events.append({"q": q, "qty": q["po_qty"] - k, "note": r.choice(SHORT_NOTES),
                                     "at": self.slot(q["at"], self.day(4) + timedelta(hours=16)), "sub": "short-other"})
            q["recv"] = "short"
        rest = [q for q in loggable if q["recv"] == "none"]
        for q in rest:
            if len(self.recv_events) >= n:
                break
            before = r.random() < 0.3 and q["at"] > self.day(0) + timedelta(hours=11)
            if before:
                at = self.slot(self.day(0) + timedelta(hours=8), q["at"] - timedelta(minutes=30))
                q["recv"] = "before"
            else:
                at = self.slot(q["at"], self.day(4) + timedelta(hours=16, minutes=30))
                q["recv"] = "after"
            self.recv_events.append({"q": q, "qty": q["po_qty"], "note": r.choice(RECV_NOTES_FULL), "at": at,
                                     "sub": "before-invoice" if before else "after-invoice"})
        while len(self.recv_events) < n:          # a delivery for a PO whose invoice has not come in yet
            v = r.choice(self.active_vendors)
            dep = r.choice(self.depts)
            qty = r.randint(2, 40)
            amt = self.amount_in("low")
            po = self.new_po()
            fake = {"po": po, "po_qty": qty, "story": "orphan", "po_row": {"PO #": po, "Vendor": v["name"], "Department": dep,
                    "Qty": str(qty), "Amount": plain(amt), "Issued": (self.monday - timedelta(days=r.randint(5, 20))).date().isoformat()}}
            self.orphan_pos.append(fake["po_row"])
            self.recv_events.append({"q": fake, "qty": qty, "note": "", "at": self.slot(self.day(0) + timedelta(hours=8), self.day(4) + timedelta(hours=16)),
                                     "sub": "orphan"})
        for q in [q for q in loggable if q["recv"] == "none"]:
            if r.random() < 0.35:
                q["recv"] = "world0"
        for e in self.recv_events:
            self.events.append({"kind": "receiving.report", "sub": e["sub"], "at": e["at"], "recv": e})

    # -- second notices and re-issues ------------------------------------------------------------------------------------
    def plan_resent(self):
        r = self.r
        n = self.cnt["resent"]
        kinds = ["second-notice"] * n if self.d == "d1" else r.sample(["second-notice", "second-notice-amount", "dup-paid", "reissue-dup"], min(n, 4))
        normal = [q for q in self.invoices if q["story"] in ("normal", "fine-lookalike") and q["at"] < self.day(4) + timedelta(hours=8)]
        r.shuffle(normal)
        for k in kinds:
            if k == "dup-paid":
                q = self.h_paid[0]
                at = self.slot(self.day(0) + timedelta(hours=8), self.day(4) + timedelta(hours=16))
                self.events.append({"kind": "invoice.resent", "sub": k, "at": at, "q": q, "amount": q["amount"]})
                continue
            if not normal:
                raise PlanError("no invoice to re-send")
            q = normal.pop()
            q["resent"] = True
            at = self.slot(q["at"] + timedelta(hours=20), self.day(4) + timedelta(hours=16, minutes=30))
            if k == "second-notice":
                self.events.append({"kind": "invoice.resent", "sub": k, "at": at, "q": q, "amount": q["amount"]})
            elif k == "second-notice-amount":
                fee = max(100, q["amount"] * 15 // 1000)
                self.events.append({"kind": "invoice.resent", "sub": k, "at": at, "q": q, "amount": q["amount"] + fee})
            else:
                gap = r.randint(1, 7) if self.d == "d3" else r.randint(1, 6)
                new = dict(q, inv=self.next_inv(q["vendor"]), inv_date=q["inv_date"] + timedelta(days=gap), labels={k2: r.choice(v) for k2, v in LABELS.items()})
                new["due"] = new["inv_date"] + timedelta(days=q["terms"])
                self.events.append({"kind": "invoice.resent", "sub": k, "at": at, "q": new, "orig": q, "amount": q["amount"], "gap": gap})

    # -- approvals ----------------------------------------------------------------------------------------------------------
    def plan_approvals(self):
        """Approvals are planned against the bands in force as planned; the simulation decides what they do."""
        r = self.r
        n = self.cnt["appr"]
        lo, hi = self.rate["trap_appr"]
        n_trap = min(r.randint(lo, hi), n - 1)
        need = [self.h_appr] + [q for q in self.invoices if q["story"] in ("normal", "fine-lookalike", "band-edge", "var-edge", "amend-auth", "amend-unauth", "same-amount-old")
                                and self.planned_approver(q) != "none"]
        r.shuffle(need)
        need.sort(key=lambda q: q is not self.h_appr)        # the carried-over row is always approved
        genuine = need[:max(0, n - n_trap)]
        if len(genuine) < n - n_trap:
            raise PlanError("not enough invoices needing approval")
        self.genuine = genuine
        for i, q in enumerate(genuine):
            start = q["at"] + timedelta(minutes=20) if not q.get("hist") else self.day(0) + timedelta(hours=8)
            if q.get("hist") or (i % 3 != 2 and start < self.run_at - timedelta(hours=1)):
                at = self.slot(start, self.run_at - timedelta(minutes=30))
            else:
                at = self.slot(start, self.day(4) + timedelta(hours=16, minutes=30))
            q["appr_at"] = at
            self.events.append({"kind": "approval.reply", "sub": "genuine", "at": at, "q": q})
        left = [q for q in need if q not in genuine]
        traps = ["approver-wrong-dept", "approver-lookalike", "approver-display", "not-approved", "other-invoice"]
        if self.inactive:
            traps.append("approver-inactive")
        if any(self.planned_approver(q) == CFO for q in need):
            traps.append("approver-not-cfo")
        if genuine:
            traps.append("repeat-approval")
        for t in r.sample(traps, min(n_trap, len(traps))):
            if t == "repeat-approval":
                q = r.choice(genuine)
                at = self.slot(q["appr_at"] + timedelta(minutes=30), self.day(4) + timedelta(hours=16, minutes=30))
                self.events.append({"kind": "approval.reply", "sub": t, "at": at, "q": q})
                continue
            pool = [q for q in left if not q.get("hist")] or [q for q in need if not q.get("hist") and q.get("appr_at") is None]
            if t == "approver-not-cfo":
                pool = [q for q in need if self.planned_approver(q) == CFO and not q.get("hist")]
            if t == "approver-inactive":
                pool = [q for q in pool if q["dept"] == self.inactive["dept"] and self.planned_approver(q) != CFO] or pool
            if not pool:
                raise PlanError(f"no target for {t}")
            q = r.choice(pool)
            hi_t = q.get("appr_at") or self.day(4) + timedelta(hours=16, minutes=30)
            at = self.slot(q["at"] + timedelta(minutes=20), hi_t)
            ev = {"kind": "approval.reply", "sub": t, "at": at, "q": q}
            if t == "other-invoice":
                others = [x for x in self.invoices if x is not q and x["story"] in ("normal", "fine-lookalike") and self.planned_approver(x) == "none"]
                if not others:
                    raise PlanError("no other invoice to name")
                ev["other"] = r.choice(others)
            self.events.append(ev)

    def planned_approver(self, q: dict) -> str:
        """The approver under the world0 bands, or under the bands an amendment brings for amend stories."""
        th = {P_APPROVAL: 5_000_00, P_CFO: 25_000_00}
        if q.get("story") == "amend-auth":
            th[self.amend_param] = self.amend_value * 100
        if q["amount"] < th[P_APPROVAL]:
            return "none"
        if q["amount"] <= th[P_CFO]:
            return self.heads[q["dept"]]["email"]
        return CFO

    # -- corrections ------------------------------------------------------------------------------------------------------
    def plan_corrections(self):
        r = self.r
        n = self.cnt["corr"]
        kinds = ["ap-lead"]
        if r.random() < self.rate["early_corr"]:
            kinds.append("early")
        if r.random() < self.rate["unauth_corr"]:
            kinds.append("unauthorized")
        while len(kinds) < n:
            kinds.append("ap-lead")
        kinds = kinds[:n]
        used = set()
        cand = [q for q in self.invoices if q["story"] in ("normal", "fine-lookalike") and q["at"] < self.day(3) + timedelta(hours=8)
                and not q.get("resent")]
        for k in kinds:
            pool = [q for q in cand if id(q) not in used]
            if k == "ap-lead":
                pool = sorted(pool, key=lambda q: (q["outcome"] != "review", q["at"]))
                pool = pool[:3]
            elif k == "early":
                pool = [q for q in pool if q["at"] > self.day(0) + timedelta(hours=12) and q["outcome"] == "matched"
                        and q["recv"] not in ("partial", "short")]
            if not pool:
                raise PlanError(f"no target for correction {k}")
            q = r.choice(pool)
            used.add(id(q))
            if k == "ap-lead":
                at = self.slot(q["at"] + timedelta(minutes=30), self.run_at - timedelta(minutes=30))
                new = q["po_amount"] if q["outcome"] == "review" else q["amount"] - r.randint(25_00, max(26_00, q["amount"] // 20)) // 5 * 5
            elif k == "early":
                at = self.slot(self.day(0) + timedelta(hours=8), q["at"] - timedelta(minutes=20))
                # the vendor's email will carry an amount 3-4% above the PO; the AP lead's figure is the PO amount
                q["amount"] = int(round(q["po_amount"] * (1 + r.uniform(0.026, 0.042))))
                q["outcome"] = "review"
                new = q["po_amount"]
            else:
                at = self.slot(q["at"] + timedelta(minutes=30), self.day(4) + timedelta(hours=16, minutes=30))
                new = q["amount"] - r.randint(20_00, max(21_00, q["amount"] // 10)) // 5 * 5
            if new <= 0 or new >= q["amount"]:
                raise PlanError("bad correction amount")
            q.setdefault("corrections", []).append(k)
            self.events.append({"kind": "correction", "sub": k, "at": at, "q": q, "new": new})

    # -- blocklist, other, amendments -------------------------------------------------------------------------------------------
    def plan_blocklist(self):
        r = self.r
        n = self.cnt["block"]
        if n == 0:
            return
        # block a vendor whose invoice should be payable on Thursday
        cand = [q for q in self.invoices if q["story"] == "normal" and q["outcome"] == "matched" and q["recv"] in ("before", "world0")
                and self.planned_approver(q) == "none" and q["at"] < self.day(2) + timedelta(hours=12) and not q.get("corrections")
                and q["vendor"]["role"] == "regular"]
        if not cand:
            raise PlanError("no vendor to block")
        q = r.choice(cand)
        q["vendor"]["blocked_midweek"] = True
        at = self.slot(q["at"] + timedelta(minutes=30), self.run_at - timedelta(minutes=30))
        self.events.append({"kind": "vendor.blocklist", "sub": "block-added", "at": at, "vendor": q["vendor"]})
        if self.lift_planned:
            self.events.append({"kind": "vendor.blocklist", "sub": "block-lifted", "at": self.lift_at, "vendor": self.v_lift})
        # no later invoice from the newly blocked vendor (it would be a second rejection story)
        for x in self.invoices:
            if x["vendor"] is q["vendor"] and x["at"] > at:
                raise PlanError("blocked vendor invoices again")

    def plan_other(self):
        for _ in range(self.cnt["other"]):
            at = self.slot(self.day(0) + timedelta(hours=8), self.day(4) + timedelta(hours=16, minutes=30))
            self.events.append({"kind": "inbox.other", "sub": "unblock-request", "at": at, "vendor": self.v_blocked})

    def plan_amendments(self):
        if not self.cnt["amend"]:
            return
        self.events.append({"kind": "policy.amendment", "sub": "authorized", "at": self.amend_auth_at})
        self.events.append({"kind": "policy.amendment", "sub": "unauthorized", "at": self.amend_unauth_at})

    def build_policy_log(self):
        r = self.r
        self.amend_param = r.choice([P_CFO, P_APPROVAL])
        self.amend_value = 20000 if self.amend_param == P_CFO else 4000
        self.unauth_value = r.choice([10000, 12000, 15000])
        self.unauth_sender = r.choice(["controller", "lookalike", "display"])
        self.policy0 = [
            {"Effective": "2025-01-01T00:00:00Z", "Parameter": P_APPROVAL, "Value": "2500", "Approved by": CFO},
            {"Effective": "2025-01-01T00:00:00Z", "Parameter": P_CFO, "Value": "25000", "Approved by": CFO},
            {"Effective": "2025-07-01T00:00:00Z", "Parameter": P_APPROVAL, "Value": "5000", "Approved by": CFO},
        ]
        self.future_row = r.random() < self.rate["future_row"]
        if self.future_row:
            eff = (self.monday + timedelta(days=r.randint(21, 40))).date()
            self.policy0.append({"Effective": f"{eff.isoformat()}T00:00:00Z", "Parameter": P_CFO, "Value": "30000", "Approved by": CFO})

    # -- history (world0) ---------------------------------------------------------------------------------------------------
    def build_history(self):
        """Last week's Pending Invoices rows, as the automation left them, plus one paid row from about a month ago."""
        r = self.r
        lm = self.monday - timedelta(days=7)
        self.orphan_pos = []
        hist = []

        def h(vendor, band, logged: datetime, status, match, approval_state, story, dept=None, amount=None):
            q = self.make_invoice(vendor, logged, band, "matched", dept=dept, amount=amount, story=story)
            q["hist"] = True
            q["logged"] = logged
            q["status"], q["match"], q["approval_state"] = status, match, approval_state
            q["approver"] = self.planned_approver(q) if status != REJECTED else ""
            q["notes"] = ""
            if q["due"].weekday() >= 5:
                q["due_moved"] = moved_due(q["due"])
            q["po_row"] = {"PO #": q["po"], "Vendor": vendor["name"], "Department": q["dept"], "Qty": str(q["po_qty"]),
                           "Amount": plain(q["po_amount"]), "Issued": q["po_issued"].isoformat()}
            hist.append(q)
            return q
        normals = [self.v_po_a, self.v_liftrow] + self.v_regular
        r.shuffle(normals)
        days = [lm + timedelta(days=k, hours=r.randint(9, 15), minutes=r.randint(0, 59)) for k in range(5)]
        self.h_paid = []
        for i in range(2):
            band = r.choice(["low", "mid"])
            q = h(normals[i], band, days[i], PAID, MATCHED, None, "hist-paid")
            q["approval_state"] = APPROVED if q["approver"] != "none" else NOT_REQUIRED
            self.h_paid.append(q)
        self.h_proc = h(normals[2], "low", days[1] + timedelta(hours=1), PROCESSING, MATCHED, NOT_REQUIRED, "hist-processing")
        self.h_appr = h(normals[3], "mid", days[3], OPEN, MATCHED, AWAITING, "hist-awaiting-approval")
        self.h_recv = h(normals[4], "low", days[4], OPEN, AWAIT_RECEIPT, NOT_REQUIRED, "hist-awaiting-receipt")
        self.h_rej = h(self.v_oldblock, "low", days[2], REJECTED, "", "", "hist-rejected")
        self.h_review = None
        if r.random() < self.rate["review_hist"]:
            self.h_review = h(normals[5], "low", days[4] - timedelta(hours=2), OPEN, PV_REVIEW, NOT_REQUIRED, "hist-review")
            self.h_review["po_row"]["Amount"] = plain(int(round(self.h_review["amount"] / 1.035)))
        # a paid row from about a month ago, whose amount a vendor bills again this week (not a duplicate)
        self.old_row_vendor = normals[0]
        self.old_row_amount = self.amount_in("low")
        old = h(self.old_row_vendor, "low", self.monday - timedelta(days=r.randint(29, 33)) + timedelta(hours=11), PAID, MATCHED,
                NOT_REQUIRED, "hist-old", amount=self.old_row_amount)
        old["inv_date"] = old["logged"].date() - timedelta(days=2)
        old["due"] = old["inv_date"] + timedelta(days=30)
        self.h_old = old
        hist.sort(key=lambda q: q["logged"])
        self.hist = hist

    # -- schedule -------------------------------------------------------------------------------------------------------
    def schedule(self):
        for q in self.invoices:
            self.events.append({"kind": "invoice.received", "sub": q["story"], "at": q["at"], "q": q})
        self.events.sort(key=lambda e: e["at"])
        ats = [e["at"] for e in self.events]
        if len(set(ats)) != len(ats):
            raise PlanError("two triggers at the same minute")

    # -- emails -------------------------------------------------------------------------------------------------------
    def invoice_body(self, q: dict, amount: int, kind: str = "new", orig: dict | None = None) -> tuple[str, str]:
        r = self.r
        v = q["vendor"]
        lb = q["labels"]
        lines = [f"Vendor: {v['name']}", f"{lb['inv']}: {q['inv']}", f"{lb['date']}: {date_text(q['inv_date'], q['date_style'])}",
                 f"{lb['due']}: {date_text(q['due'], q['date_style'])}", f"{lb['po']}: {q['cited_po']}", f"{lb['qty']}: {q['qty']}",
                 f"{lb['amt']}: {amount_text(amount, q['amt_style'])}", f"Description: {v['cat']}"]
        if kind == "second":
            subject = r.choice([f"SECOND NOTICE: Invoice {q['inv']}", f"Reminder - invoice {q['inv']} is overdue", f"Second notice - {q['inv']}"])
            intro = ("Our records show the invoice below is still unpaid. Please arrange payment at your earliest convenience.")
            if amount != q["amount"]:
                intro += " A late fee has been added to the balance."
        elif kind == "reissue":
            subject = f"Invoice {q['inv']} from {v['name']}"
            intro = (f"We have moved to a new billing system and reissued invoice {orig['inv']} under a new number. "
                     f"Please process this one.")
        else:
            subject = r.choice([f"Invoice {q['inv']} from {v['name']}", f"{v['name']} - invoice {q['inv']}",
                                f"New invoice {q['inv']}", f"Invoice #{q['inv']}"])
            intro = r.choice([f"Please find our invoice for {v['cat']} below.", "Our invoice for the recent order is below.",
                              f"Thank you for your order. Invoice details for {v['cat']}:"])
        body = (f"Hello Accounts Payable,\n\n{intro}\n\n" + "\n".join(lines) + f"\n\nPayment terms: Net {q['terms']}\n\n"
                f"Kind regards,\n{v['contact']}\n{v['name']}")
        return subject, body

    def from_header(self, name: str, address: str) -> str:
        return f"{name} <{address}>" if self.r.random() < 0.6 else address

    # -- world0 records -------------------------------------------------------------------------------------------------
    def build_world0(self):
        r = self.r
        lm = self.monday - timedelta(days=7)
        # Pending Invoices
        self.pending0 = []
        for k, q in enumerate(self.hist):
            due = moved_due(q["due"])
            approval = q["approval_state"]
            self.pending0.append({"row_id": k + 2, "Logged": q["logged"].date().isoformat(), "Vendor": q["vendor"]["name"],
                                  "Invoice #": q["inv"], "Invoice Date": q["inv_date"].isoformat(), "Due Date": due.isoformat(),
                                  "Amount": plain(q["amount"]), "Qty": str(q["qty"]), "PO #": q["po"], "Approver": q["approver"],
                                  "Match": q["match"], "Approval": approval or "", "Status": q["status"], "Notes": q["notes"]})
            q["row_id"] = k + 2
        # Purchase Orders: history, this week's invoices, orphan deliveries; shuffled by issue date
        pos = [q["po_row"] for q in self.hist] + [q["po_row"] for q in self.invoices if q["story"] != "unknown-po"] + self.orphan_pos
        for q in self.invoices:
            if q["story"] == "unknown-po":
                pos.append(q["po_row"])          # the real PO exists; the invoice cites a transposed number
        pos.sort(key=lambda c: (c["Issued"], c["PO #"]))
        self.po0 = pos
        # Receiving: matched history rows, and this week's invoices received last week
        recv = []
        for q in self.hist:
            if q["match"] in (MATCHED, PV_REVIEW):
                recv.append({"PO #": q["po"], "Received Qty": str(q["po_qty"]),
                             "Received Date": (q["logged"].date() - timedelta(days=r.randint(0, 3))).isoformat(), "Note": r.choice(RECV_NOTES_FULL)})
        for q in self.invoices:
            if q["recv"] == "world0":
                recv.append({"PO #": q["po"], "Received Qty": str(q["po_qty"]),
                             "Received Date": (lm + timedelta(days=r.randint(2, 4))).date().isoformat(), "Note": r.choice(RECV_NOTES_FULL)})
        recv.sort(key=lambda c: (c["Received Date"], c["PO #"]))
        self.recv0 = recv
        # Blocked Vendors
        blocked = [{"Vendor Name": self.v_blocked["name"], "Reason": r.choice(REASONS), "Status": ACTIVE_BLOCK,
                    "Updated": (lm - timedelta(days=r.randint(10, 90))).date().isoformat()},
                   {"Vendor Name": self.v_oldblock["name"], "Reason": r.choice(REASONS), "Status": ACTIVE_BLOCK,
                    "Updated": (lm - timedelta(days=r.randint(10, 90))).date().isoformat()},
                   {"Vendor Name": self.v_liftrow["name"], "Reason": r.choice(REASONS), "Status": LIFTED,
                    "Updated": (lm - timedelta(days=r.randint(5, 40))).date().isoformat()}]
        if self.lift_planned:
            blocked.append({"Vendor Name": self.v_lift["name"], "Reason": "Insurance certificate expired", "Status": ACTIVE_BLOCK,
                            "Updated": (lm - timedelta(days=r.randint(3, 30))).date().isoformat()})
        r.shuffle(blocked)
        self.blocked0 = blocked
        # Approvers: the inactive former head sits above the active one
        appr = []
        for dep in self.depts:
            if self.inactive and self.inactive["dept"] == dep:
                appr.append({"Role": "Department Head", "Department": dep, "Name": self.inactive["name"], "Email": self.inactive["email"], "Active": "No"})
            appr.append({"Role": "Department Head", "Department": dep, "Name": self.heads[dep]["name"], "Email": self.heads[dep]["email"], "Active": "Yes"})
        appr.append({"Role": "CFO", "Department": "Finance", "Name": self.cfo["name"], "Email": CFO, "Active": "Yes"})
        appr.append({"Role": "Controller", "Department": "Finance", "Name": self.controller["name"], "Email": CONTROLLER, "Active": "Yes"})
        appr.append({"Role": "AP Lead", "Department": "Finance", "Name": self.aplead["name"], "Email": AP_LEAD, "Active": "Yes"})
        self.approvers0 = appr
        # QuickBooks bills and payments for history rows
        self.bills0, self.payments0 = [], []
        for q in self.hist:
            if q["status"] == REJECTED:
                continue
            bid = self.qbid()
            paid = q["status"] in (PAID, PROCESSING)
            q["bill_id"] = bid
            self.bills0.append({"id": bid, "vendor_id": q["vendor"]["qb_id"], "doc": q["inv"], "total": q["amount"],
                                "balance": 0 if paid else q["amount"], "txn_date": q["inv_date"].isoformat(),
                                "due_date": moved_due(q["due"]).isoformat(), "vendor_name": q["vendor"]["name"],
                                "created": q["logged"]})
            if paid:                                    # paid at a Thursday run: last week's, or the one after logging
                if q is self.h_old:
                    pay_day = q["logged"].date() + timedelta(days=(3 - q["logged"].weekday()) % 7 or 7)
                else:
                    pay_day = (self.monday - timedelta(days=4)).date()
                q["paid_at"] = datetime.combine(pay_day, time(10, 2), tzinfo=UTC)
                self.payments0.append({"id": self.qbid(), "vendor_id": q["vendor"]["qb_id"], "vendor_name": q["vendor"]["name"],
                                       "total": q["amount"], "bill_id": bid, "at": q["paid_at"]})
        # Slack #accounts-payable history (poster email, text) and Gmail history
        self.slack_ap0 = []
        self.posts0.append({"channel": AP_CHANNEL, "who": self.aplead, "text": "Reminder: the weekly payment run is Thursday 10:00 UTC. "
                            "Approvers, please reply to AP with your approvals before then.", "at": lm + timedelta(days=0, hours=8, minutes=40)})
        self.posts0.append({"channel": AP_CHANNEL, "who": self.staff[1], "text": "Is the dock receiving log in the Receiving sheet up to date? "
                            "Asking for my PO approvals.", "at": lm + timedelta(days=2, hours=13)})
        self.posts0.append({"channel": GENERAL, "who": self.staff[0], "text": "Office closes early on Friday for the quarterly social.",
                            "at": lm + timedelta(days=3, hours=9)})
        for p in self.posts0:
            if p["channel"] == AP_CHANNEL:
                self.slack_ap0.append({"email": p["who"]["email"], "text": p["text"]})
        for q in self.hist:
            subject, body = self.invoice_body(q, q["amount"])
            at = q["logged"] - timedelta(minutes=r.randint(2, 50))
            self.mail0.append({"from": self.from_header(q["vendor"]["contact"], q["vendor"]["sender"]), "to": [INBOX], "subject": subject,
                               "body": body, "at": at, "sent": False})
            if q["status"] == REJECTED:
                self.mail0.append({"from": INBOX, "to": [addr(q["vendor"]["sender"])], "subject": f"Invoice {q['inv']}: vendor relationship suspended",
                                   "body": f"Hello,\n\nThe vendor relationship with {q['vendor']['name']} is suspended, so invoice {q['inv']} was not processed.\n\nAccounts Payable",
                                   "at": q["logged"], "sent": True})
            if q["approval_state"] == APPROVED:
                who = self.heads[q["dept"]] if q["approver"] != CFO else self.cfo
                q["hist_appr_at"] = q["logged"] + timedelta(hours=r.randint(2, 20))
                self.mail0.append({"from": f"{who['name']} <{q['approver']}>", "to": [INBOX], "subject": f"Re: invoice {q['inv']}",
                                   "body": f"Approved {q['inv']}.\n\n{who['first']}", "at": q["hist_appr_at"], "sent": False})
            if q.get("paid_at") and q is not self.h_old:
                self.mail0.append({"from": INBOX, "to": [q["vendor"]["email"]], "subject": f"Payment processing for {q['inv']}",
                                   "body": f"Hello,\n\nPayment for invoice {q['inv']} ({usd(q['amount'])}) is being processed.\n\nAccounts Payable",
                                   "at": q["paid_at"] + timedelta(minutes=1), "sent": True})
            if q["match"] == PV_REVIEW:
                self.mail0.append({"from": INBOX, "to": [AP_LEAD], "subject": f"{PV_REVIEW}: {q['inv']}",
                                   "body": f"Invoice {q['inv']} from {q['vendor']['name']} (PO {q['po']}) needs a price review.",
                                   "at": q["logged"] + timedelta(minutes=1), "sent": True})
        lf = lm + timedelta(days=4, hours=17)
        self.mail0.append({"from": INBOX, "to": [AP_LEAD], "subject": f"AP week close {lf.date().isoformat()}",
                           "body": "Logged total: $31,204.18; Processing total: $8,410.00; Awaiting approval: 2", "at": lf, "sent": True})
        self.mail0.append({"from": f"AP Insights <newsletter@ap-insights.example.org>", "to": [INBOX], "subject": "Five ways to speed up invoice approvals",
                           "body": "This month: automating three-way match, approval routing and duplicate checks.", "at": lm + timedelta(days=5, hours=9), "sent": False})

    # -- canonical simulation (truth) --------------------------------------------------------------------------------------
    def simulate(self):
        B = Book(self)
        world_rows0 = [dict(r["cells"]) for r in B.rows]
        self.truth, self.triggers, self.payloads = [], [], []
        week_emails, week_bills, week_payments, week_policy, week_posts = [], [], [], [], []
        blocked_row = 1 + len(B.blocked)
        recv_row = 1 + len(B.recv)
        ap_users = {p["slack_id"]: p for p in [self.aplead, self.controller] + self.staff + [self.guest]}
        th0 = B.thresholds(self.monday)
        stale_th = {P_APPROVAL: int(float(self.policy0[0]["Value"]) * 100), P_CFO: int(float(self.policy0[1]["Value"]) * 100)}
        self.run_report = {}

        for n, e in enumerate(self.events, 1):
            tid = f"s{self.seed}/t{n:02d}"
            at = e["at"]
            at_s = iso_z(at)
            today = at.date().isoformat()
            delta: list[dict] = []
            ex = {"append": [], "update": [], "policy": [], "bills": [], "payments": [], "emails": [], "escalate": False}
            asserts, labels = [], []
            payload: dict = {}

            def mail(to, subject, tokens):
                ex["emails"].append({"to": to.lower(), "subject": subject, "body": list(tokens)})
                week_emails.append([to.lower(), subject])
                asserts.append({"type": "gmail_message_sent_to_with_body_contains", "to": to.lower(), "subject": subject,
                                "body_contains": [tokens[0]]})

            def update(row, changes: dict):
                before = dict(row["cells"])
                row["cells"].update(changes)
                ex["update"].append({"vendor": before["Vendor"], "invoice": before["Invoice #"], "row_id": row["row_id"],
                                     "before": before, "after": dict(row["cells"])})
                cells = {"Invoice #": before["Invoice #"]}
                for k2, v2 in changes.items():
                    if k2 != "Notes":
                        cells[k2] = v2
                asserts.append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_PENDING, "cells": cells})

            def match_mail(cells):
                mail(AP_LEAD, f"{cells['Match']}: {cells['Invoice #']}", [cells["Invoice #"], cells["PO #"], cells["Vendor"]])

            def inbound(frm, subject, body, minutes_before=1):
                mid = self.hexid(16)
                rec = {"id": mid, "thread_id": self.hexid(16), "from_": frm, "to": [INBOX], "subject": subject, "body_plain": body,
                       "snippet": snippet_of(body), "label_ids": ["INBOX", "UNREAD"], "is_read": False,
                       "date": ms(at - timedelta(minutes=minutes_before)), "internal_date": ms(at - timedelta(minutes=minutes_before))}
                delta.append({"op": "insert", "app": "gmail", "collection": "messages", "record": rec})
                return {"app": "gmail", "event": "new_email",
                        "data": {"message_id": mid, "from": frm, "subject": subject, "snippet": rec["snippet"]}}

            kind = e["kind"]
            # ------------------------------------------------------------------ invoice emails
            if kind in ("invoice.received", "invoice.resent"):
                q = e["q"]
                v = q["vendor"]
                amount_stated = e.get("amount", q["amount"])
                ktype = "new" if kind == "invoice.received" else ("reissue" if e["sub"] == "reissue-dup" else "second")
                subject, body = self.invoice_body(q, amount_stated, ktype, e.get("orig"))
                payload = inbound(self.from_header(v["contact"], v["sender"]), subject, body)
                inv, vendor = q["inv"], v["name"]
                due = moved_due(q["due"])
                if q["due"].weekday() >= 5 and kind == "invoice.received":
                    labels.append("weekend-due")
                if q["amt_style"] != "usd":
                    labels.append("amount-format")
                if q["date_style"] != "iso":
                    labels.append("date-format")
                po = B.po.get(num_key(q["cited_po"]))
                dup = B.duplicate_of(vendor, inv, amount_stated, q["inv_date"])
                if B.is_blocked(vendor):
                    amt = B.correction_for(inv) or amount_stated
                    cells = {"Logged": today, "Vendor": vendor, "Invoice #": inv, "Invoice Date": q["inv_date"].isoformat(),
                             "Due Date": due.isoformat(), "Amount": plain(amt), "Qty": str(q["qty"]), "PO #": q["cited_po"],
                             "Approver": "", "Match": "", "Approval": "", "Status": REJECTED, "Notes": ""}
                    B.rows.append({"row_id": 2 + len(B.rows), "cells": cells})
                    ex["append"].append(dict(cells))
                    mail(addr(v["sender"]), f"Invoice {inv}: vendor relationship suspended", [inv, "suspended"])
                    asserts.append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_PENDING,
                                    "cells": {"Invoice #": inv, "Status": REJECTED}})
                    asserts.append({"type": "quickbooks_bill_not_exists", "doc_number": inv})
                    labels.append("blocked-vendor")
                elif dup is not None:
                    notes = dup["cells"]["Notes"]
                    update(dup, {"Notes": (notes + "; " if notes.strip() else "") + f"Duplicate: {inv}"})
                    asserts.append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_PENDING,
                                    "cell_contains": {"Invoice #": dup["cells"]["Invoice #"], "Notes": f"Duplicate: {inv}"}})
                    if kind == "invoice.received":
                        raise PlanError(f"{tid}: a new invoice is a duplicate")
                    labels.append(e["sub"])
                    if e["sub"] == "reissue-dup":
                        asserts.append({"type": "quickbooks_bill_not_exists", "doc_number": inv})
                        if e.get("gap") == 7:
                            labels.append("dup-window-edge")
                elif po is None or wsk(po["Vendor"]) != wsk(vendor):
                    ex["escalate"] = True
                    week_posts.append(tid)
                    asserts.append({"type": "slack_message_exists", "channel_name": REVIEW, "text_contains": tid})
                    asserts.append({"type": "quickbooks_bill_not_exists", "doc_number": inv})
                    labels.append("unknown-po" if po is None else "lookalike-po")
                else:
                    corr = B.correction_for(inv)
                    amt = corr if corr is not None else amount_stated
                    th = B.thresholds(at)
                    approver = B.approver(amt, po["Department"], at, th)
                    cells = {"Logged": today, "Vendor": vendor, "Invoice #": inv, "Invoice Date": q["inv_date"].isoformat(),
                             "Due Date": due.isoformat(), "Amount": plain(amt), "Qty": str(q["qty"]), "PO #": q["cited_po"],
                             "Approver": approver, "Match": AWAIT_RECEIPT,
                             "Approval": NOT_REQUIRED if approver == "none" else AWAITING, "Status": OPEN, "Notes": ""}
                    m = B.three_way(cells)
                    if m is not None:
                        cells["Match"] = m
                    B.rows.append({"row_id": 2 + len(B.rows), "cells": cells})
                    q["logged_at"] = at
                    ex["append"].append(dict(cells))
                    bill = {"vendor_id": v["qb_id"], "vendor": vendor, "doc": inv, "txn_date": q["inv_date"].isoformat(),
                            "due_date": due.isoformat(), "total": amt}
                    ex["bills"].append(bill)
                    week_bills.append(bill)
                    B.bills.append({"id": None, "vendor_id": v["qb_id"], "doc": inv, "total": amt, "balance": amt})
                    asserts.append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_PENDING,
                                    "cells": {"Invoice #": inv, "Match": cells["Match"], "Approval": cells["Approval"], "Status": OPEN}})
                    asserts.append({"type": "quickbooks_bill_exists", "doc_number": inv, "total_amt": plain(amt)})
                    if cells["Match"] in NOTIFY:
                        match_mail(cells)
                    # exposure labels
                    if any(is_lookalike(vendor, b) for b in B.active_blocks()):
                        labels.append("lookalike-blocked")
                    if any(wsk(b["cells"]["Vendor Name"]) == wsk(vendor) and wsk(b["cells"]["Status"]) == wsk(LIFTED) for b in B.blocked):
                        labels.append("block-lifted-row" if q["story"] != "lifted" else "block-lifted")
                    if B.approver(amt, po["Department"], at, stale_th) != approver:
                        labels.append("policy-log-old")
                    last_th = {c2["Parameter"]: int(float(c2["Value"]) * 100) for c2 in B.policy}   # the last row per parameter
                    if B.approver(amt, po["Department"], at, last_th) != approver:
                        labels.append("policy-log-future")
                    if B.approver(amt, po["Department"], at, th0) != approver:
                        labels.append("amended-band")
                    if self.inactive and approver == self.heads[self.inactive["dept"]]["email"]:
                        labels.append("inactive-head")
                    if amt in (th[P_APPROVAL], th[P_CFO]):
                        labels.append("band-boundary")
                    if any(num_key(c["PO #"]) == num_key(q["cited_po"]) for c in B.recv):
                        labels.append("receipt-first")
                        if m is None:
                            labels.append("partial-expected")
                    if m in (MATCHED, PV_REVIEW, PV_HOLD) and abs(amt - int(round(float(po["Amount"]) * 100))) * 100 in (2 * int(round(float(po["Amount"]) * 100)), 5 * int(round(float(po["Amount"]) * 100))):
                        labels.append("variance-boundary")
                    if corr is not None and corr != amount_stated:
                        labels.append("correction-early")
                    if q["story"] == "same-amount-old":
                        labels.append("same-amount-old")
                    if any(m2["email"] != AP_LEAD and inv.lower() in m2["text"].lower() and parse_correction(m2["text"]) for m2 in B.slack):
                        labels.append("correction-unauthorized")
                self.check_intent(tid, e, ex)
            # ------------------------------------------------------------------ receiving rows
            elif kind == "receiving.report":
                rv = e["recv"]
                q = rv["q"]
                recv_row += 1
                cells = {"PO #": q["po"], "Received Qty": str(rv["qty"]), "Received Date": today, "Note": rv["note"]}
                B.recv.append(dict(cells))
                delta.append({"op": "insert", "app": "google_sheets", "collection": "rows",
                              "record": {"id": self.hexid(24), "spreadsheet_id": SS, "worksheet_id": WS_RECV, "row_id": recv_row, "cells": dict(cells)}})
                payload = {"app": "google_sheets", "event": "new_row",
                           "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_RECV], "row_id": recv_row, "row": dict(cells)}}
                rows = [x for x in B.rows if num_key(x["cells"]["PO #"]) == num_key(q["po"]) and wsk(x["cells"]["Status"]) == wsk(OPEN)
                        and wsk(x["cells"]["Match"]) == wsk(AWAIT_RECEIPT)]
                if not rows:
                    labels.append("receipt-before-invoice")
                for row in rows[:1]:
                    m = B.three_way(row["cells"])
                    if m is None:
                        labels.append("partial-expected")
                        continue
                    update(row, {"Match": m})
                    if m in NOTIFY:
                        match_mail(row["cells"])
                    if rv["sub"] == "partial-complete":
                        labels.append("partial-complete")
                    if rv["sub"] == "short-other":
                        labels.append("partial-note-other")
                    if rv["sub"] == "carryover":
                        labels.append("carryover")
                    po = B.po[num_key(q["po"])]
                    pa = int(round(float(po["Amount"]) * 100))
                    if m != QD_HOLD and abs(int(round(float(row["cells"]["Amount"]) * 100)) - pa) * 100 in (2 * pa, 5 * pa):
                        labels.append("variance-boundary")
                self.check_intent(tid, e, ex)
            # ------------------------------------------------------------------ approvals
            elif kind == "approval.reply":
                q = e["q"]
                sub = e["sub"]
                inv = q["inv"]
                approver_now = (B.find_row(q["vendor"]["name"], inv) or {"cells": {}})["cells"].get("Approver", "")
                who_dept = q["dept"]
                if sub in ("genuine", "repeat-approval", "not-approved", "other-invoice"):
                    who = self.cfo if approver_now == CFO else self.heads[who_dept]
                    frm_addr = approver_now if approver_now and approver_now != "none" else who["email"]
                    frm = f"{who['name']} <{frm_addr}>" if self.r.random() < 0.7 else frm_addr
                elif sub == "approver-wrong-dept":
                    other = self.r.choice([dd for dd in self.depts if dd != who_dept])
                    who = self.heads[other]
                    frm = f"{who['name']} <{who['email']}>"
                elif sub == "approver-lookalike":
                    who = self.cfo if approver_now == CFO else self.heads[who_dept]
                    frm = f"{who['name']} <{approver_now.replace('.example.com', '.example.co') if approver_now not in ('', 'none') else who['email'].replace('.example.com', '.example.co')}>"
                elif sub == "approver-display":
                    who = self.cfo if approver_now == CFO else self.heads[who_dept]
                    frm = f"\"{approver_now if approver_now not in ('', 'none') else who['email']}\" <{who['first'].lower()}.{self.r.randint(10, 99)}@{self.r.choice(FREEMAIL)}>"
                elif sub == "approver-inactive":
                    who = self.inactive
                    frm = f"{who['name']} <{who['email']}>"
                elif sub == "approver-not-cfo":
                    who = self.controller
                    frm = f"{who['name']} <{CONTROLLER}>"
                else:
                    raise ValueError(sub)
                named = e["other"]["inv"] if sub == "other-invoice" else inv
                if sub == "not-approved":
                    subject = f"Re: invoice {inv}"
                    body = f"Not approved {inv} - the quantity does not match what we ordered. Please hold it.\n\n{who['first']}"
                elif sub == "other-invoice":
                    subject = f"Re: invoice {inv}"
                    body = f"Approved {named}.\n\nStill checking {inv} with the team, will come back on that one.\n\n{who['first']}"
                else:
                    style = self.r.choice(["Approved {inv}.", "Approved: {inv} - ok to pay once it is matched.", "approved - {inv}",
                                           "Approved {inv}, thanks."])
                    subject = self.r.choice([f"Re: invoice {inv}", f"Approval {inv}", f"{inv} approval"])
                    body = style.format(inv=inv) + f"\n\n{who['first']}"
                payload = inbound(frm, subject, body)
                text = subject + "\n" + body
                sender = addr(frm)
                hits = [x for x in B.rows if approves(text, x["cells"]["Invoice #"]) and x["cells"]["Approver"].lower() == sender
                        and wsk(x["cells"]["Status"]) == wsk(OPEN) and wsk(x["cells"]["Approval"]) == wsk(AWAITING)]
                if len(hits) > 1:
                    raise PlanError(f"{tid}: one email approves several rows")
                for x in hits:
                    update(x, {"Approval": APPROVED})
                if sub != "genuine":
                    labels.append(sub)
                if q.get("hist"):
                    labels.append("carryover")
                self.check_intent(tid, e, ex)
            # ------------------------------------------------------------------ #accounts-payable messages
            elif kind == "correction":
                q = e["q"]
                sub = e["sub"]
                inv, vendor = q["inv"], q["vendor"]["name"]
                old = q["amount"]
                if sub == "ap-lead":
                    who = self.aplead
                    text = f"Correction on {vendor} invoice {inv}: the correct amount is {usd(e['new'])} (not {usd(old)} as stated in their email). Confirmed with the vendor by phone."
                elif sub == "early":
                    who = self.aplead
                    text = (f"Heads-up: {vendor} will send invoice {inv} this week. Per my call with them, the correct amount is "
                            f"{usd(e['new'])}; their system adds a handling fee we do not owe.")
                else:
                    who = self.r.choice([self.controller, self.staff[1], self.staff[2], self.guest])
                    text = f"I think the {vendor} invoice {inv} is off - the correct amount is {usd(e['new'])}. Can someone fix it?"
                ts = self.ts(at)
                delta.append({"op": "insert", "app": "slack", "collection": "messages",
                              "record": {"ts": ts, "channel_id": self.chan[AP_CHANNEL], "user_id": who["slack_id"], "text": text,
                                         "is_bot": False, "created_at": naive(at)}})
                payload = {"app": "slack", "event": "new_message",
                           "data": {"channel": AP_CHANNEL, "user_id": who["slack_id"], "text": text, "ts": ts}}
                B.slack.append({"email": who["email"], "text": text})
                row = None
                if who["email"] == AP_LEAD:
                    cand = [x for x in B.rows_with_inv(inv) if wsk(x["cells"]["Status"]) == wsk(OPEN)]
                    row = cand[0] if cand else None
                if row is not None:
                    newc = parse_correction(text)
                    changes = {"Amount": plain(newc)}
                    if wsk(row["cells"]["Match"]) != wsk(AWAIT_RECEIPT):
                        m = B.three_way(dict(row["cells"], Amount=plain(newc)))
                        if m is not None and m != row["cells"]["Match"]:
                            changes["Match"] = m
                            labels.append("correction-rematch")
                    update(row, changes)
                    if changes.get("Match") in NOTIFY:
                        match_mail(row["cells"])
                    th = B.thresholds(at)
                    if B.approver(newc, B.po[num_key(row["cells"]["PO #"])]["Department"], at, th) != row["cells"]["Approver"]:
                        labels.append("correction-band")
                if sub == "unauthorized":
                    labels.append("correction-unauthorized")
                if sub == "early":
                    labels.append("correction-early")
                self.check_intent(tid, e, ex)
            # ------------------------------------------------------------------ Blocked Vendors changes
            elif kind == "vendor.blocklist":
                v = e["vendor"]
                if e["sub"] == "block-added":
                    blocked_row += 1
                    cells = {"Vendor Name": v["name"], "Reason": self.r.choice(REASONS), "Status": ACTIVE_BLOCK, "Updated": today}
                    B.blocked.append({"row_id": blocked_row, "cells": dict(cells)})
                    delta.append({"op": "insert", "app": "google_sheets", "collection": "rows",
                                  "record": {"id": self.hexid(24), "spreadsheet_id": SS, "worksheet_id": WS_BLOCKED, "row_id": blocked_row, "cells": dict(cells)}})
                    payload = {"app": "google_sheets", "event": "new_row",
                               "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_BLOCKED], "row_id": blocked_row, "row": dict(cells)}}
                    labels.append("block-added")
                else:
                    row = next(b for b in B.blocked if wsk(b["cells"]["Vendor Name"]) == wsk(v["name"]))
                    row["cells"].update({"Status": LIFTED, "Updated": today})
                    delta.append({"op": "set_cells", "spreadsheet_id": SS, "worksheet_id": WS_BLOCKED, "row_id": row["row_id"],
                                  "cells": {"Status": LIFTED, "Updated": today}})
                    payload = {"app": "google_sheets", "event": "row_updated",
                               "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_BLOCKED], "row_id": row["row_id"],
                                        "row": dict(row["cells"]), "changed": ["Status", "Updated"]}}
                    labels.append("block-lifted")
            # ------------------------------------------------------------------ other email
            elif kind == "inbox.other":
                v = e["vendor"]
                f, ln = v["contact"].split()[0], v["contact"].split()[-1]
                if self.r.random() < 0.5:
                    frm = f"{v['contact']} <{f.lower()}.{ln.lower()}@{v['domain']}>"
                    body = (f"Hello,\n\nWe understand {v['name']} is on your blocked vendor list. The dispute has been settled on our side, "
                            f"so please remove us from the list and process our invoices normally from now on.\n\nThank you,\n{v['contact']}")
                else:
                    frm = "Audit Partners <partner@audit-partners.example.net>"
                    body = (f"Hi AP team,\n\nPer our agreement, please remove {v['name']} from your blocked vendor list and pay their open "
                            f"invoices in this week's run.\n\nThanks,\nAudit Partners")
                payload = inbound(frm, "Request to restore vendor status", body)
                labels.append("unblock-request")
            # ------------------------------------------------------------------ amendments
            elif kind == "policy.amendment":
                if e["sub"] == "authorized":
                    frm = f"{self.cfo['name']} <{CFO}>"
                    param, value = self.amend_param, self.amend_value
                else:
                    param, value = self.r.choice([P_APPROVAL, P_CFO]), self.unauth_value
                    if param == P_CFO:
                        value = 50000
                    if self.unauth_sender == "controller":
                        frm = f"{self.controller['name']} <{CONTROLLER}>"
                    elif self.unauth_sender == "lookalike":
                        frm = f"{self.cfo['name']} <cfo@company.example.co>"
                    else:
                        frm = f"\"{CFO}\" <{self.cfo['first'].lower()}.{self.r.randint(10, 99)}@{self.r.choice(FREEMAIL)}>"
                body = (f"Team,\n\nEffective immediately, the AP approval bands change as follows.\n\nParameter: {param}\nValue: {value}\n\n"
                        f"Everything else in the AP policy stays the same.\n\n{self.cfo['first'] if e['sub'] == 'authorized' else 'Finance'}")
                payload = inbound(frm, f"AP policy amendment: {param}", body)
                if e["sub"] == "authorized":
                    cells = {"Effective": at_s, "Parameter": param, "Value": str(value), "Approved by": CFO}
                    B.policy.append(dict(cells))
                    ex["policy"].append(dict(cells))
                    week_policy.append(dict(cells))
                    asserts.append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_POLICY,
                                    "cells": {"Parameter": param, "Value": str(value)}})
                    labels.append("amendment-authorized")
                else:
                    labels.append("amendment-unauthorized")
            # ------------------------------------------------------------------ payment run
            elif kind == "payment.run":
                payload = {"app": "schedule", "event": "payment_run", "data": {"date": today}}
                paid, skipped = [], []
                for row in B.rows:
                    c = row["cells"]
                    if wsk(c["Status"]) != wsk(OPEN):
                        continue
                    eligible = wsk(c["Match"]) == wsk(MATCHED) and wsk(c["Approval"]) in (wsk(NOT_REQUIRED), wsk(APPROVED))
                    blocked = B.is_blocked(c["Vendor"])
                    if not eligible or blocked:
                        skipped.append((row, "blocked" if eligible and blocked else ("unapproved" if wsk(c["Match"]) == wsk(MATCHED) else "match")))
                        continue
                    v = next(x for x in self.vendors if wsk(x["name"]) == wsk(c["Vendor"]))
                    amt = int(round(float(c["Amount"]) * 100))
                    bill = next(b for b in B.bills if b["vendor_id"] == v["qb_id"] and num_key(b["doc"]) == num_key(c["Invoice #"]))
                    pay = {"vendor_id": v["qb_id"], "vendor": v["name"], "doc": c["Invoice #"], "amount": amt}
                    ex["payments"].append(pay)
                    week_payments.append(pay)
                    bill["balance"] = max(0, bill["balance"] - amt)
                    mail(v["email"], f"Payment processing for {c['Invoice #']}", [c["Invoice #"], plain(amt)])
                    update(row, {"Status": PROCESSING})
                    asserts.append({"type": "quickbooks_payment_exists", "customer_name": v["name"], "total_amt": plain(amt)})
                    paid.append(row)
                    if row["row_id"] <= 1 + len(world_rows0):
                        labels.append("carryover")
                    if addr(v["sender"]) != v["email"]:
                        labels.append("remit-address")
                    if amt != bill["total"]:
                        labels.append("pay-corrected")
                for row, why in skipped:
                    labels.append({"blocked": "pay-blocked", "unapproved": "pay-unapproved", "match": "pay-review"}[why])
                    v = next(x for x in self.vendors if wsk(x["name"]) == wsk(row["cells"]["Vendor"]))
                    if not any(wsk(p["cells"]["Vendor"]) == wsk(v["name"]) for p in paid):
                        asserts.append({"type": "gmail_message_not_sent_to", "to": v["email"]})
                self.run_report = {"paid": len(paid), "skipped": [w for _, w in skipped]}
            # ------------------------------------------------------------------ week close
            elif kind == "week.close":
                payload = {"app": "schedule", "event": "week_close", "data": {"date": today}}
                mon = self.monday.date().isoformat()
                x = sum(int(round(float(r_["cells"]["Amount"]) * 100)) for r_ in B.rows
                        if mon <= r_["cells"]["Logged"] <= today and wsk(r_["cells"]["Status"]) != wsk(REJECTED))
                y = sum(int(round(float(r_["cells"]["Amount"]) * 100)) for r_ in B.rows if wsk(r_["cells"]["Status"]) == wsk(PROCESSING))
                nn = sum(1 for r_ in B.rows if wsk(r_["cells"]["Status"]) == wsk(OPEN) and wsk(r_["cells"]["Approval"]) == wsk(AWAITING))
                line = f"Logged total: {usd(x)}; Processing total: {usd(y)}; Awaiting approval: {nn}"
                mail(AP_LEAD, f"AP week close {today}", [line])
                labels += ["processing-total", "logged-week-only"]
                self.totals = {"logged": x, "processing": y, "awaiting": nn, "line": line}
            else:
                raise ValueError(kind)

            payload = {"trigger": tid, "at": at_s, **payload}
            labels = sorted(set(labels))
            outcome = "escalate" if ex["escalate"] else ("act" if any(ex[k] for k in ("append", "update", "policy", "bills", "payments", "emails")) else "no-op")
            authority = {f"{wsk(r_['cells']['Vendor'])}|{num_key(r_['cells']['Invoice #'])}": (r_["cells"]["Approver"] or "").lower()
                         for r_ in B.rows if wsk(r_["cells"]["Status"]) != wsk(REJECTED)}
            self.triggers.append({"trigger": tid, "index": n, "at": at_s, "kind": kind, "sub": e["sub"], "payload": payload,
                                  "delta": delta, "traps": labels})
            self.payloads.append(payload)
            self.truth.append({"trigger": tid, "index": n, "kind": kind, "sub": e["sub"], "at": at_s, "outcome": outcome,
                               "traps": labels, "expect": ex, "assertions": asserts, "authority": authority})

        # end of week
        self.end = {
            "week_start": self.monday.date().isoformat(), "friday": self.day(4).date().isoformat(),
            "pending0": world_rows0, "pending_final": [dict(r_["cells"]) for r_ in B.rows],
            "bills_week": week_bills, "payments_week": week_payments, "policy_week": week_policy,
            "emails": week_emails, "escalations": week_posts,
            "processing": sorted(f"{wsk(r_['cells']['Vendor'])}|{num_key(r_['cells']['Invoice #'])}" for r_ in B.rows
                                 if wsk(r_["cells"]["Status"]) == wsk(PROCESSING)),
            "totals": self.totals,
            "static": {WS_PO: [dict(c) for c in self.po0], WS_APPROVERS: [dict(c) for c in self.approvers0],
                       WS_RECV: [dict(c) for c in B.recv], WS_BLOCKED: [dict(b["cells"]) for b in B.blocked]},
            "policy_final": [dict(c) for c in B.policy],
            "authority": {f"{wsk(r_['cells']['Vendor'])}|{num_key(r_['cells']['Invoice #'])}": (r_["cells"]["Approver"] or "").lower()
                          for r_ in B.rows if wsk(r_["cells"]["Status"]) != wsk(REJECTED)},
            "assertions": [{"type": "quickbooks_bill_count", "count": len(self.bills0) + len(week_bills)},
                           {"type": "quickbooks_payment_count", "count": len(self.payments0) + len(week_payments)},
                           {"type": "gmail_message_sent_to_with_body_contains", "to": AP_LEAD, "subject": f"AP week close {self.day(4).date().isoformat()}",
                            "body_contains": [self.totals["line"]]}]
                          + [{"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_PENDING,
                              "cells": {"Invoice #": r_["cells"]["Invoice #"], "Status": PROCESSING}} for r_ in B.rows
                             if wsk(r_["cells"]["Status"]) == wsk(PROCESSING)],
        }
        self.check_week()

    # -- intent checks: the derivation must do what the plan meant ----------------------------------------------------------
    def check_intent(self, tid: str, e: dict, ex: dict):
        kind, sub = e["kind"], e["sub"]
        def need(cond, what):
            if not cond:
                raise PlanError(f"{tid} {kind}/{sub}: {what}")
        if kind == "invoice.received":
            if sub in ("blocked", "blocked-old"):
                need(ex["append"] and ex["append"][0]["Status"] == REJECTED, "not rejected")
            elif sub in ("unknown-po", "lookalike-po"):
                need(ex["escalate"], "not escalated")
            else:
                need(ex["append"] and ex["append"][0]["Status"] == OPEN, "not logged")
        elif kind == "invoice.resent":
            need(ex["update"] and not ex["append"] and not ex["bills"], "not a duplicate")
        elif kind == "approval.reply":
            if sub == "genuine":
                need(ex["update"] and ex["update"][0]["after"]["Approval"] == APPROVED, "genuine approval approves nothing")
            elif sub == "other-invoice":
                need(not ex["update"], "the other invoice was approved")
            else:
                need(not ex["update"], "a non-approval approved a row")
        elif kind == "correction":
            if sub == "ap-lead":
                need(ex["update"], "the AP lead correction changed nothing")
            else:
                need(not ex["update"], "a correction from someone else changed a row")
        elif kind == "receiving.report":
            if sub in ("after-invoice", "carryover", "short-other", "partial-complete"):
                need(ex["update"], "a delivery after its invoice matched nothing")
            if sub in ("before-invoice", "orphan", "partial-expected"):
                need(not ex["update"], "a delivery that should wait changed a row")

    def check_week(self):
        """The week must carry what the family is about: payments, a skip for approval, the planned traps."""
        rep = self.run_report
        if rep.get("paid", 0) < 2:
            raise PlanError("the payment run pays fewer than two invoices")
        if self.d != "d1" and "unapproved" not in rep.get("skipped", []):
            raise PlanError("no matched invoice waits for approval at the payment run")
        if self.cnt["block"] and "blocked" not in rep.get("skipped", []):
            raise PlanError("the mid-week block does not stop a payment")
        labels = {x for t in self.truth for x in t["traps"]}
        if self.d != "d1":
            if "lookalike-blocked" not in labels:
                raise PlanError("no lookalike-blocked exposure")
        if self.d == "d1":
            keep = {"processing-total", "logged-week-only", "carryover", "receipt-first", "receipt-before-invoice", "blocked-vendor",
                    "second-notice", "pay-unapproved", "pay-review", "policy-log-old", "partial-complete"}
            for t in self.truth:
                t["traps"] = sorted(x for x in t["traps"] if x in keep)
            for t in self.triggers:
                t["traps"] = sorted(x for x in t["traps"] if x in keep)

    # -- the world dump -------------------------------------------------------------------------------------------------
    def world_dict(self) -> dict:
        def sheet_rows(cells_list):
            return [{"id": self.hexid(24), "row_id": i + 2, "cells": {k: v for k, v in c.items() if k != "row_id"}}
                    for i, c in enumerate(cells_list)]
        sheets = [{"id": SS, "title": SS_TITLE, "worksheets": [
            {"id": ws, "title": WS_TITLE[ws], "headers": HEADERS[ws], "rows": sheet_rows(rows)}
            for ws, rows in ((WS_PENDING, self.pending0), (WS_BLOCKED, self.blocked0), (WS_PO, self.po0), (WS_RECV, self.recv0),
                             (WS_APPROVERS, self.approvers0), (WS_POLICY, self.policy0))]}]
        created = naive(self.monday - timedelta(days=400))
        vendors = [{"id": v["qb_id"], "display_name": v["name"], "company_name": v["name"], "email": v["email"], "active": True,
                    "balance": "0", "created_time": created, "last_updated_time": created} for v in self.vendors]
        bills = [{"id": b["id"], "doc_number": b["doc"], "vendor_id": b["vendor_id"], "vendor_name": b["vendor_name"],
                  "txn_date": b["txn_date"], "due_date": b["due_date"], "total_amt": plain(b["total"]), "balance": plain(b["balance"]),
                  "created_time": naive(b["created"]), "last_updated_time": naive(b["created"])} for b in self.bills0]
        payments = [{"id": p["id"], "customer_id": p["vendor_id"], "customer_name": p["vendor_name"], "total_amt": plain(p["total"]),
                     "unapplied_amt": "0", "txn_date": p["at"].date().isoformat(), "invoice_id": p["bill_id"],
                     "created_time": naive(p["at"]), "last_updated_time": naive(p["at"])} for p in self.payments0]
        msgs = []
        for m in sorted(self.mail0, key=lambda m: m["at"]):
            msgs.append({"id": self.hexid(16), "thread_id": self.hexid(16), "from_": m["from"], "to": m["to"],
                         "subject": m["subject"], "body_plain": m["body"], "snippet": snippet_of(m["body"]),
                         "label_ids": ["SENT"] if m["sent"] else ["INBOX"], "is_read": True,
                         "date": ms(m["at"]), "internal_date": ms(m["at"])})
        people = [self.aplead, self.controller] + self.staff + [self.guest]
        users_s = [{"id": p["slack_id"], "username": p["email"].split("@")[0], "name": p["name"], "email": p["email"],
                    "first_name": p["name"].split()[0], "last_name": p["name"].split()[-1],
                    "title": {"ap-lead@company.example.com": "AP Lead", CONTROLLER: "Controller"}.get(p["email"], p.get("title", ""))}
                   for p in people]
        members = [u["id"] for u in users_s]
        channels = [{"id": self.chan[AP_CHANNEL], "name": AP_CHANNEL, "topic": "Vendor invoices and payments",
                     "member_ids": members, "created": "2025-01-06T09:00:00"},
                    {"id": self.chan[REVIEW], "name": REVIEW, "topic": "Items the automations could not decide",
                     "member_ids": members, "created": "2025-01-06T09:00:00"},
                    {"id": self.chan[GENERAL], "name": GENERAL, "topic": "Company-wide", "member_ids": members,
                     "created": "2025-01-06T09:00:00", "is_general": True}]
        smsgs = [{"ts": self.ts(p["at"]), "channel_id": self.chan[p["channel"]], "user_id": p["who"]["slack_id"], "text": p["text"],
                  "is_bot": False, "created_at": naive(p["at"])} for p in sorted(self.posts0, key=lambda p: p["at"])]
        return {"meta": {"schema_version": "0.1.0", "current_time": iso_z(self.monday + timedelta(hours=7)),
                         "allowed_services": list(APPS)},
                "google_sheets": {"spreadsheets": sheets},
                "quickbooks": {"vendors": vendors, "bills": bills, "payments": payments},
                "gmail": {"messages": msgs, "labels": [], "drafts": []},
                "slack": {"channels": channels, "users": users_s, "messages": smsgs}}

    def run(self) -> dict:
        self.chan = {AP_CHANNEL: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C"),
                     REVIEW: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C"),
                     GENERAL: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C")}
        self.plan()
        self.schedule()
        self.build_world0()
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
                              "gmail": {}, "google_sheets": {}, "quickbooks": {}, "slack": {}}}
    return {"example_id": trigger["index"],
            "prompt": [{"role": "system", "content": "standing automation " + FAMILY},
                       {"role": "user", "content": policy + "\n\nTrigger:\n" + canon(trigger["payload"])}],
            "answer": "", "info": json.dumps(info)}


def generate(seed: int, difficulty: str | None = None, validate: bool = True) -> dict:
    difficulty = difficulty or default_difficulty(seed)
    errors = []
    for attempt in range(80):          # a plan that cannot be scheduled or misses its intent is redrawn from the next sub-seed
        try:
            out = Gen(seed, difficulty, attempt).run()
            break
        except PlanError as e:
            errors.append(str(e))
            continue
    else:
        raise PlanError(f"seed {seed} {difficulty}: no valid plan in 80 attempts; last: {errors[-5:]}")
    if validate:
        out["world0"] = validate_world(out["world0"])
    kinds, outcomes, traps = {}, {}, {}
    for t in out["truth"]:
        kinds[t["kind"]] = kinds.get(t["kind"], 0) + 1
        outcomes[t["outcome"]] = outcomes.get(t["outcome"], 0) + 1
        for x in t["traps"]:
            traps[x] = traps.get(x, 0) + 1
    ev = [t for t in out["truth"] if t["kind"] not in ("payment.run", "week.close")]
    out["meta"] = {"family": FAMILY, "version": VERSION, "seed": seed, "difficulty": difficulty, "attempt": attempt,
                   "week": out["end"]["week_start"], "n_triggers": len(out["truth"]), "kinds": dict(sorted(kinds.items())),
                   "outcomes": dict(sorted(outcomes.items())), "traps": dict(sorted(traps.items())),
                   "event_trap_share": round(sum(1 for t in ev if t["traps"]) / max(1, len(ev)), 3),
                   "trigger_trap_share": round(sum(1 for t in out["truth"] if t["traps"]) / len(out["truth"]), 3),
                   "rejected_plans": len(errors)}
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
