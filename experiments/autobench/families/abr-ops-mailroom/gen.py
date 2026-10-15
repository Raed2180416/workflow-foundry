#!/usr/bin/env python3
"""abr-ops-mailroom: seeded stream generator (AutomationBench-R family 6; research/automationbench-20261014/
RECURRING-DESIGN.md §3.2, §4.6). Runs inside AutomationBench's own venv (it validates worlds with its WorldState):

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-ops-mailroom/gen.py \
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

The truth comes from the generator's own canonical model of the business (`simulate`: the directory, the package
sheet, the posts and SMS as they would be after correct handling of every earlier trigger), never from a solver's
output. The reference solver (reference.py) is a separate implementation that sees only the payload, POLICY.md and
the tools. Every person, company and number is fictional (phones in the 555-01xx fiction range, *.example.com).
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

FAMILY = "abr-ops-mailroom"
VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
UTC = timezone.utc

APPS = ("google_sheets", "slack", "twilio")
SS, SS_TITLE = "ss_mailroom", "Mailroom"
WS_PKG, WS_EMP, WS_POL = "ws_packages", "ws_employees", "ws_mailroom_policy"
WS_TITLE = {WS_PKG: "Incoming Packages", WS_EMP: "Employee Directory", WS_POL: "Mailroom Policies"}
PKG_HEADERS = ["Tracking Number", "Recipient Name", "Department", "Package Type", "Received Date", "Notes", "Status"]
EMP_HEADERS = ["Name", "Department", "Floor", "Phone", "Status"]
POL_HEADERS = ["Policy", "Rule", "Effective Date"]
MAILROOM, REVIEW, GENERAL = "mailroom", "automation-review", "general"
DOCK = "Loading Dock B"
ARROW = "→"
SMS_TYPES = ("Refrigerated", "Hazardous")
MAILROOM_NUMBER = "+15550100200"
ROUTED, SKIPPED, HELD_LEAVE, HELD_CUSTOMS = "Routed", "Skipped", "Held - On Leave", "Held - Customs"
KW_RETURNED, KW_CUSTOMS, KW_OVERSIZED = "returned to sender", "customs hold", "oversized"

# Per difficulty: (lo, hi) per kind. pkg = package.received; lift = customs.cleared that lifts a hold; odd = d3's
# customs.cleared look-alikes (notes still say customs hold; the package is not Held - Customs); ret =
# employee.returned; chatter = human messages in #mailroom during the week (count-noise for the daily total).
COUNTS = {
    "d1": dict(pkg=(32, 34), lift=(2, 2), odd=(0, 0), ret=(1, 1), chatter=(0, 0)),
    "d2": dict(pkg=(32, 38), lift=(2, 3), odd=(0, 0), ret=(1, 2), chatter=(1, 2)),
    "d3": dict(pkg=(39, 45), lift=(1, 2), odd=(2, 2), ret=(1, 2), chatter=(2, 3)),
}
# Share of package.received triggers that get a planted trap. Release triggers are traps by construction, so these
# put the share of trap-bearing TRIGGERS near the design's 35% (d2) and 60% (d3); meta reports both per stream.
TRAP_RATE = {"d1": 0.0, "d2": 0.24, "d3": 0.55}
TRAP_WEIGHTS = {"twin-active": 2.0, "wrong-dept": 1.0, "not-found": 1.0, "terminated": 1.5, "on-leave": 1.5,
                "customs": 1.5, "returned": 1.0, "returned-rescan": 1.0, "oversized": 1.0, "oversized-sms": 1.0,
                "decoy": 1.5, "back": 0.7}
TRAP_WEIGHTS_D3 = {"precedence": 0.8}

# ---------------------------------------------------------------------------------------------------------------
# Fictional pools (no real person or organization)
# ---------------------------------------------------------------------------------------------------------------
FIRST = ["Alex", "Jordan", "Casey", "Morgan", "Sam", "Riley", "Taylor", "Avery", "Quinn", "Devon", "Priya", "Mateo",
         "Hannah", "Kwame", "Sofia", "Daniel", "Lena", "Ravi", "Chloe", "Tomas", "Aiko", "Elena", "Farid", "Grace",
         "Hugo", "Imani", "Jonas", "Keiko", "Luis", "Maya", "Nikolai", "Olivia", "Pavel", "Rosa", "Samir", "Tess",
         "Uma", "Victor", "Wren", "Yusuf", "Zara", "Ines", "Omar", "Clara"]
LAST = ["Rivera", "Lee", "Brown", "Smith", "Patel", "Okafor", "Lindqvist", "Mensah", "Marchetti", "Fischer", "Iyer",
        "Bernard", "Novak", "Tanaka", "Reyes", "Osei", "Haddad", "Moreau", "Kowalski", "Nakamura", "Fontaine",
        "Sorensen", "Varga", "Quintero", "Brennan", "Castellano", "Duarte", "Hargrove", "Ibarra", "Jansen", "Kapoor",
        "Whitfield", "Ames", "Halvorsen", "Delgado", "Achebe"]
DEPTS = [("Engineering", 3), ("Marketing", 5), ("Finance", 7), ("Sales", 2), ("HR", 4), ("Legal", 6),
         ("Operations", 1), ("Product", 8), ("Customer Success", 2), ("IT", 1)]
DEPT_FLOOR = dict(DEPTS)
AREAS = ["212", "312", "415", "617", "720", "503", "206", "404", "512", "303"]
TYPES = [("Standard", 40), ("Document", 15), ("Fragile", 10), ("Refrigerated", 18), ("Hazardous", 17)]
SENDERS = ["Harbor Office Supply", "Bluefin Lab Goods", "Northgate Print Co", "Cobalt Parts Depot", "Juniper Florals",
           "Ironwood Tools", "Saltmarsh Biologics", "Pinecrest Stationers"]

BENIGN = ["", "", "", "", "", "signature required", "leave at front desk if no answer", "keep upright", "2 boxes",
          "fragile - handle with care", "envelope only", "sender: {sender}", "{sender} order {n}"]
CUSTOMS_STD = "customs hold - pending clearance"
CUSTOMS_VAR = ["Customs Hold: awaiting broker documents", "CUSTOMS HOLD - duty unpaid", "customs hold (broker ref CB-{n})",
               "Customs hold - inspection scheduled", "Customs HOLD, call broker"]
CLEARED = ["customs cleared {d} - released by broker", "Cleared by customs on {d}", "released from customs {d}, duty paid",
           "Customs released {d}"]
STILL_HELD = ["customs hold - broker documents received, inspection {wd}", "CUSTOMS HOLD - duty invoice sent {d}",
              "Customs hold: second inspection requested {d}"]
RETURNED = ["RETURNED TO SENDER - refused by recipient", "Returned to sender (address unknown)",
            "returned to sender - damaged in transit", "RETURNED TO SENDER", "Returned To Sender - recipient moved"]
OVERSIZED = ["oversized - requires forklift", "OVERSIZED pallet", "Oversized: 2 crates", "oversized box, use the dock cart"]
DECOYS = ["return label enclosed", "Return to sender if undeliverable", "cleared customs at port of entry",
          "customs paperwork attached", "large box, two-person lift", "sender requested a return receipt"]
CHATTER = ["Heads up: the freight elevator is out until noon.", "Did anyone see a box from Harbor Office Supply?",
           "Dock B closes at 4 today.", "Thanks for getting the lab samples up so fast!",
           "Reminder: perishables go in the fridge by the front desk.",
           "Front desk is short-staffed this afternoon, pickups may be slow.",
           "Who ordered twelve cases of printer paper?"]
POLICY_ROWS = [
    ("Customs Hold", "Packages with 'customs hold' in Notes are held (Held - Customs) until the note is cleared; then they "
     "are routed. No SMS and no routing post while held.", "2025-08-15"),
    ("Returned Packages", "Any package with 'returned to sender' in Notes has already been processed for return. Do not "
     "route, notify or change it.", "2025-09-01"),
    ("Directory Match", "Match the recipient on both Name and Department. Not in the directory, or Terminated: Skipped.",
     "2025-09-01"),
    ("Oversized Package Handling", "Packages with 'oversized' in Notes go to Loading Dock B instead of the employee's "
     "floor. An SMS, when the type needs one, names Loading Dock B.", "2025-10-01"),
    ("On Leave Hold", "Packages for employees On Leave are held (Held - On Leave) until they return. These are not the "
     "same as terminated employees, whose packages are skipped.", "2025-11-01"),
    ("Notifications", "Refrigerated and Hazardous packages get an SMS when routed. Other packages are only routed.",
     "2025-11-01"),
    ("Daily Total", "At 17:00 each weekday, post 'Routed today: N' in #mailroom.", "2026-01-05"),
]
FRONT_DESK = [("U0FRONTDSK1", "Dana Whitfield", "dana.whitfield"), ("U0FACILIT01", "Marco Delgado", "marco.delgado"),
              ("U0FACILIT02", "Ines Achebe", "ines.achebe")]


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


def default_difficulty(seed: int) -> str:
    """Within each seed block (RECURRING-DESIGN §3.9) the first seed is d2, then d2/d3 alternate."""
    starts = [601, 610, 614, 622, 631, 8801, 8805, 8825, 8837]
    start = max([s for s in starts if s <= seed], default=seed)
    return "d2" if (seed - start) % 2 == 0 else "d3"


def routing_post(trk: str, loc: str, name: str, dept: str) -> str:
    return f"{trk} {ARROW} {loc} ({name}, {dept})"


def sms_body(trk: str, loc: str) -> str:
    return f"Package {trk} ready at {loc}"


def day_total(n: int) -> str:
    return f"Routed today: {n}"


def decide(cells: dict, directory: list[dict]) -> dict:
    """POLICY.md section 3 on one package row against the directory (list of cell dicts). The generator's canonical
    rule; the reference (reference.py) implements the same policy independently."""
    notes = norm(cells.get("Notes"))
    if KW_RETURNED in notes:
        return {"status": None, "reason": "returned"}
    match = [e for e in directory if norm(e["Name"]) == norm(cells.get("Recipient Name"))
             and norm(e["Department"]) == norm(cells.get("Department"))]
    if len(match) > 1:
        raise ValueError(f"ambiguous directory match for {cells}")
    if not match or norm(match[0]["Status"]) == "terminated":
        return {"status": SKIPPED, "reason": "terminated" if match else "not-found"}
    e = match[0]
    if norm(e["Status"]) == "on leave":
        return {"status": HELD_LEAVE, "reason": "on-leave", "emp": e}
    if KW_CUSTOMS in notes:
        return {"status": HELD_CUSTOMS, "reason": "customs", "emp": e}
    loc = DOCK if KW_OVERSIZED in notes else f"Floor {e['Floor']}"
    trk = cells["Tracking Number"]
    out = {"status": ROUTED, "reason": "route", "emp": e, "loc": loc,
           "post": routing_post(trk, loc, e["Name"], e["Department"])}
    if cells.get("Package Type") in SMS_TYPES:
        out["sms"] = [e["Phone"], sms_body(trk, loc)]
    return out


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
        self.trks: set[str] = set()
        self.phones: set[str] = set()
        self.minutes: set[int] = set()
        self.emps: list[dict] = []
        self.former: list[str] = []
        self.rows0: list[dict] = []        # world0 package rows {id, row_id, cells, at}
        self.msgs0: list[dict] = []        # world0 Slack messages {channel, user, text, at, bot}
        self.sms0: list[dict] = []         # world0 SMS {to, body, at}
        self.plans: list[dict] = []        # the week's triggers (canonical model)
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

    def trk(self) -> str:
        while True:
            v = f"TRK-{self.r.randint(10000, 99999)}"
            if v not in self.trks:
                self.trks.add(v)
                return v

    def phone(self) -> str:
        while True:
            v = f"+1{self.r.choice(AREAS)}55501{self.r.randint(0, 99):02d}"
            if v not in self.phones:
                self.phones.add(v)
                return v

    def ts(self, at: datetime) -> str:
        while True:
            v = f"{int(at.timestamp())}.{self.r.randint(100000, 999999):06d}"
            if v not in self.ids:
                self.ids.add(v)
                return v

    def day(self, i: int) -> datetime:
        return self.monday + timedelta(days=i)

    def slot(self, days: list[int], h_lo: float = 8.0, h_hi: float = 16.75, after: datetime | None = None) -> datetime:
        """A free business minute of the week on one of `days` (0 = Monday) in [h_lo, h_hi) hours, after `after`."""
        cand = []
        for d in days:
            for m in range(int(h_lo * 60), int(h_hi * 60)):
                k = d * 1440 + m
                at = self.monday + timedelta(minutes=k)
                if k not in self.minutes and (after is None or at > after):
                    cand.append(k)
        if not cand:
            raise RuntimeError("no free business minute")
        k = self.r.choice(cand)
        self.minutes.add(k)
        return self.monday + timedelta(minutes=k)

    def past_at(self, lo_days: int, hi_days: int) -> datetime:
        """A business time 1..n days before Monday, on a weekday."""
        while True:
            d = self.monday - timedelta(days=self.r.randint(lo_days, hi_days))
            if d.weekday() < 5:
                return d + timedelta(hours=self.r.randint(8, 16), minutes=self.r.randint(0, 59))

    def ptype(self, sms: bool | None = None) -> str:
        pool = [t for t in TYPES if sms is None or (t[0] in SMS_TYPES) == sms]
        return self.r.choices([t[0] for t in pool], weights=[t[1] for t in pool])[0]

    def benign(self) -> str:
        return self.r.choice(BENIGN).format(sender=self.r.choice(SENDERS), n=self.r.randint(1000, 9999))

    # -- directory ----------------------------------------------------------------------------------------------------
    def build_directory(self):
        r = self.r
        people = [f"{f} {ln}" for f in FIRST for ln in LAST]
        r.shuffle(people)
        self.people = people
        names = [d[0] for d in DEPTS]

        def emp(name: str, dept: str, status: str, role: str) -> dict:
            floor = DEPT_FLOOR[dept] if r.random() < 0.8 else r.choice([f for f in range(1, 10) if f != DEPT_FLOOR[dept]])
            e = {"name": name, "dept": dept, "floor": str(floor), "phone": self.phone(), "status": status, "role": role,
                 "id": self.hexid()}
            self.emps.append(e)
            return e

        d3 = self.d == "d3"
        for _ in range(r.randint(16, 20) + (2 if d3 else 0)):
            emp(people.pop(), r.choice(names), "Active", "plain")
        for _ in range(3 if d3 else 2):                       # same name, two departments, both Active
            n = people.pop()
            a, b = r.sample(names, 2)
            emp(n, a, "Active", "twin")
            emp(n, b, "Active", "twin")
        n = people.pop()                                       # same name: Active and Terminated
        a, b = r.sample(names, 2)
        emp(n, a, "Active", "twin")
        emp(n, b, "Terminated", "terminated")
        for _ in range(2):
            emp(people.pop(), r.choice(names), "Terminated", "terminated")
        self.returning = []
        for k in range(self.cnt["ret"]):
            self.returning.append(emp(people.pop(), r.choice(names), "On Leave", "returning"))
        r1 = self.returning[0]
        if self.d == "d2":                                     # the returning employee's namesake, Active
            emp(r1["name"], r.choice([x for x in names if x != r1["dept"]]), "Active", "twin")
        elif d3:                                               # ... or also On Leave, and staying on leave
            emp(r1["name"], r.choice([x for x in names if x != r1["dept"]]), "On Leave", "staying-twin")
        emp(people.pop(), r.choice(names), "On Leave", "staying")
        self.former = [people.pop() for _ in range(4)]
        r.shuffle(self.emps)
        for i, e in enumerate(self.emps):
            e["row_id"] = i + 2

    def emp_cells(self, e: dict) -> dict:
        return {"Name": e["name"], "Department": e["dept"], "Floor": e["floor"], "Phone": e["phone"], "Status": e["status"]}

    def role(self, *roles: str) -> list[dict]:
        return [e for e in self.emps if e["role"] in roles]

    def namesakes(self, e: dict) -> list[dict]:
        return [x for x in self.emps if x is not e and norm(x["name"]) == norm(e["name"])]

    # -- history (world0) ----------------------------------------------------------------------------------------------
    def add_row0(self, e_or_name, dept: str | None, at: datetime, ptype: str, notes: str, trk: str | None = None):
        name = e_or_name["name"] if isinstance(e_or_name, dict) else e_or_name
        dept = dept or e_or_name["dept"]
        self.rows0.append({"id": self.hexid(), "at": at, "cells": {
            "Tracking Number": trk or self.trk(), "Recipient Name": name, "Department": dept, "Package Type": ptype,
            "Received Date": at.date().isoformat(), "Notes": notes, "Status": ""}})

    def build_history(self):
        r = self.r
        plain, twins = self.role("plain"), self.role("twin")
        for _ in range(r.randint(7, 10)):                      # last week, routed
            e = r.choice(plain + twins)
            notes = r.choice(OVERSIZED) if r.random() < 0.15 else self.benign()
            self.add_row0(e, None, self.past_at(3, 7), self.ptype(), notes)
        self.add_row0(r.choice(self.role("terminated")), None, self.past_at(3, 7), self.ptype(), self.benign())
        self.add_row0(self.former[0], r.choice([d[0] for d in DEPTS]), self.past_at(3, 7), self.ptype(), self.benign())
        self.add_row0(r.choice(plain), None, self.past_at(3, 7), self.ptype(), r.choice(RETURNED))
        # held on leave: every returning employee has at least one held package, so a return always releases something
        for k, e in enumerate(self.returning):
            for j in range(r.randint(1, 2) if k == 0 else 1):
                notes = self.benign()
                if self.d == "d3" and k == 0 and j == 0:
                    notes = r.choice([CUSTOMS_STD] + CUSTOMS_VAR).format(n=r.randint(1000, 9999))  # back -> customs
                self.add_row0(e, None, self.past_at(2, 13), self.ptype(), notes)
        for e in self.role("staying", "staying-twin"):
            self.add_row0(e, None, self.past_at(2, 13), self.ptype(), self.benign())
        # held for customs: lifted this week (and, at d3, one notes update that keeps the hold)
        need = self.cnt["lift"] + (1 if self.d == "d3" else 0)
        self.customs0 = []
        for k in range(need):
            e = r.choice(plain)
            notes = r.choice([CUSTOMS_STD] + CUSTOMS_VAR).format(n=r.randint(1000, 9999))
            if k == 0:
                notes = notes + "; " + r.choice(OVERSIZED)       # released to the loading dock
            self.add_row0(e, None, self.past_at(1, 9), self.ptype(sms=(k == 0)) if k == 0 else self.ptype(), notes)
            self.customs0.append(self.rows0[-1])
        self.not_held0 = []
        if self.d == "d3":                                    # customs notes on a package that is not Held - Customs
            e = self.role("staying")[0]
            self.add_row0(e, None, self.past_at(1, 9), self.ptype(), CUSTOMS_STD)
            self.not_held0.append(self.rows0[-1])
            self.add_row0(r.choice(self.role("terminated")), None, self.past_at(1, 9), self.ptype(), r.choice(CUSTOMS_VAR).format(n=r.randint(1000, 9999)))
            self.not_held0.append(self.rows0[-1])
        self.rows0.sort(key=lambda x: x["at"])
        for i, x in enumerate(self.rows0):
            x["row_id"] = i + 2
        # statuses, posts and SMS as the automation left them
        directory = [self.emp_cells(e) for e in self.emps]
        per_day: dict[date, int] = {}
        for x in self.rows0:
            dec = decide(x["cells"], directory)
            x["cells"]["Status"] = dec["status"] or ""
            if dec["status"] == ROUTED:
                at = x["at"] + timedelta(minutes=r.randint(1, 20))
                self.msgs0.append({"channel": MAILROOM, "user": "USLACKBOT", "text": dec["post"], "at": at, "bot": True})
                per_day[at.date()] = per_day.get(at.date(), 0) + 1
                if dec.get("sms"):
                    self.sms0.append({"to": dec["sms"][0], "body": dec["sms"][1], "at": at + timedelta(seconds=5)})
        last_monday = self.monday - timedelta(days=7)
        for i in range(5):
            d = (last_monday + timedelta(days=i)).date()
            self.msgs0.append({"channel": MAILROOM, "user": "USLACKBOT", "text": day_total(per_day.get(d, 0)),
                               "at": datetime.combine(d, time(17, 0), UTC), "bot": True})
        for k, text in enumerate(r.sample(CHATTER, 2)):
            self.msgs0.append({"channel": MAILROOM, "user": r.choice(FRONT_DESK)[0], "text": text,
                               "at": self.past_at(1, 6), "bot": False})
        self.msgs0.append({"channel": GENERAL, "user": FRONT_DESK[1][0], "text": "Office closed Monday for the holiday? No - open as usual.",
                           "at": self.past_at(2, 5), "bot": False})
        assert all(x["cells"]["Status"] == HELD_CUSTOMS for x in self.customs0), "customs rows must be held"

    # -- the week -----------------------------------------------------------------------------------------------------
    def plan_week(self):
        r = self.r
        for i in range(5):
            self.plans.append({"kind": "day.close", "sub": "day-close", "at": self.day(i) + timedelta(hours=17),
                               "date": self.day(i).date().isoformat()})
        # returns first: the on-leave status a package sees depends on them
        self.return_at = {}
        windows = [[1, 2, 3], [2, 3, 4]]
        for k, e in enumerate(self.returning):
            t = self.slot(windows[k], 9.0, 16.0)
            self.return_at[e["id"]] = t
            self.plans.append({"kind": "employee.returned", "sub": "release", "at": t, "emp": e})
        times = sorted(self.slot([0, 1, 2, 3, 4], 8.0 + 5 / 60, 16.75) for _ in range(self.cnt["pkg"]))
        n_trap = round(TRAP_RATE[self.d] * len(times))
        req = [] if n_trap == 0 else ["twin-active", "oversized-sms", "returned-rescan"] + (
            ["returned-rescan", "precedence"] if self.d == "d3" else [])
        weights = dict(TRAP_WEIGHTS, **(TRAP_WEIGHTS_D3 if self.d == "d3" else {}))
        kinds = sorted(weights)
        cases = req[:n_trap] + r.choices(kinds, weights=[weights[k] for k in kinds], k=max(0, n_trap - len(req)))
        r.shuffle(cases)
        slots = sorted(r.sample(range(len(times)), n_trap))
        case_at = dict(zip(slots, cases))
        self.pkgs = []
        for i, t in enumerate(times):
            p = self.plan_package(case_at.get(i, "clean"), t)
            p.update(kind="package.received", at=t)
            self.plans.append(p)
            self.pkgs.append(p)
        # customs notes updates: lift world0 holds, or this week's (if one was received early enough)
        lifts = list(self.customs0[: self.cnt["lift"]])
        week_customs = [p for p in self.pkgs if p["case"] == "customs" and p["at"] < self.day(4) + timedelta(hours=13)]
        for k in range(len(lifts)):
            if k == len(lifts) - 1 and week_customs and r.random() < 0.5:
                p = r.choice(week_customs)
                t = self.slot([0, 1, 2, 3, 4], 8.0, 16.5, after=p["at"] + timedelta(minutes=90))
                self.plans.append({"kind": "customs.cleared", "sub": "lift", "at": t, "target": ("week", p),
                                   "notes": self.cleared(t, p["cells"]["Notes"])})
            else:
                t = self.slot([0, 1, 2, 3, 4], 9.0, 16.5)
                self.plans.append({"kind": "customs.cleared", "sub": "lift", "at": t, "target": ("w0", lifts[k]),
                                   "notes": self.cleared(t, lifts[k]["cells"]["Notes"])})
        if self.d == "d3":
            x = self.customs0[self.cnt["lift"]]
            t = self.slot([0, 1, 2, 3, 4], 9.0, 16.5)
            self.plans.append({"kind": "customs.cleared", "sub": "still-held", "at": t, "target": ("w0", x),
                               "notes": r.choice(STILL_HELD).format(d=t.date().isoformat(), wd=t.strftime("%A"))})
            x = r.choice(self.not_held0)
            t = self.slot([0, 1, 2, 3, 4], 9.0, 16.5)
            self.plans.append({"kind": "customs.cleared", "sub": "not-held", "at": t, "target": ("w0", x),
                               "notes": self.cleared(t, x["cells"]["Notes"])})
        self.plans.sort(key=lambda p: (p["at"], p["kind"]))
        # chatter in #mailroom during the week: a human message just before some package triggers
        cands = [p for p in self.plans if p["kind"] == "package.received" and p["at"] > self.monday + timedelta(hours=9)]
        for p in r.sample(cands, min(len(cands), self.cnt["chatter"])):
            p["chatter"] = {"user": r.choice(FRONT_DESK)[0], "text": r.choice(CHATTER), "at": p["at"] - timedelta(seconds=40)}

    def cleared(self, t: datetime, old: str) -> str:
        new = self.r.choice(CLEARED).format(d=t.date().isoformat())
        rest = old.split("; ", 1)[1] if "; " in old else ""
        if rest:                                            # keep the rest of the note (e.g. oversized)
            new += "; " + rest
        assert KW_CUSTOMS not in norm(new)
        return new

    def on_leave_at(self, e: dict, t: datetime) -> bool:
        if e["status"] != "On Leave":
            return False
        back = self.return_at.get(e["id"])
        return back is None or t < back

    def plan_package(self, case: str, t: datetime) -> dict:
        """One received package for a planned case. The truth is NOT decided here: simulate() derives it."""
        r = self.r
        plain = self.role("plain")
        e, name, dept, notes, ptype, trk, decoy = None, None, None, self.benign(), self.ptype(), None, False
        if case == "back":
            back = [x for x in self.returning if self.return_at[x["id"]] < t]
            case = "back" if back else "twin-active"
            if back:
                e = r.choice(back)
        if case == "clean":
            e = r.choice(plain)
        elif case == "twin-active":
            e = r.choice([x for x in self.role("twin") if x["status"] == "Active"])
        elif case == "wrong-dept":
            src = r.choice(plain + self.role("twin"))
            taken = {x["dept"] for x in self.emps if norm(x["name"]) == norm(src["name"])}
            name, dept = src["name"], r.choice([d[0] for d in DEPTS if d[0] not in taken])
        elif case == "not-found":
            name, dept = r.choice(self.former), r.choice([d[0] for d in DEPTS])
        elif case == "terminated":
            e = r.choice(self.role("terminated"))
            ptype = self.ptype(sms=r.random() < 0.5)
        elif case in ("on-leave", "precedence"):
            away = [x for x in self.emps if self.on_leave_at(x, t)]
            e = r.choice(away)
            ptype = self.ptype(sms=r.random() < 0.5)
            if case == "precedence":
                notes = r.choice([CUSTOMS_STD] + CUSTOMS_VAR).format(n=r.randint(1000, 9999))
        elif case == "customs":
            e = r.choice(plain)
            notes = (CUSTOMS_STD if r.random() < (0.5 if self.d == "d2" else 0.3) else r.choice(CUSTOMS_VAR)).format(n=r.randint(1000, 9999))
            ptype = self.ptype(sms=r.random() < 0.5)
        elif case == "returned":
            e = r.choice(plain)
            notes = r.choice(RETURNED)
            ptype = self.ptype(sms=r.random() < 0.5)
        elif case == "returned-rescan":
            done = [x for x in self.rows0 if x["cells"]["Status"] == ROUTED] + [
                p for p in self.pkgs if p["case"] in ("clean", "decoy") and p["at"] < t]
            src = r.choice(done)
            trk, name, dept, ptype = (src["cells"]["Tracking Number"], src["cells"]["Recipient Name"],
                                      src["cells"]["Department"], src["cells"]["Package Type"])
            notes = r.choice(RETURNED)
        elif case in ("oversized", "oversized-sms"):
            e = r.choice(plain + [x for x in self.role("twin") if x["status"] == "Active"])
            notes = r.choice(OVERSIZED)
            ptype = self.ptype(sms=True) if case == "oversized-sms" else self.ptype()
        elif case == "decoy":
            e = r.choice(plain)
            notes = r.choice(DECOYS)
            decoy = True
        if e is not None:
            name, dept = e["name"], e["dept"]
        cells = {"Tracking Number": trk or self.trk(), "Recipient Name": name, "Department": dept, "Package Type": ptype,
                 "Received Date": t.date().isoformat(), "Notes": notes, "Status": ""}
        return {"case": case, "sub": case, "cells": cells, "decoy": decoy}

    # -- canonical simulation (truth) ----------------------------------------------------------------------------------
    def simulate(self):
        rows = [{"id": x["id"], "row_id": x["row_id"], "cells": dict(x["cells"])} for x in self.rows0]
        emps = {e["row_id"]: {"id": e["id"], "cells": self.emp_cells(e)} for e in self.emps}
        mail = [{"date": m["at"].date().isoformat(), "text": m["text"], "routing": m["bot"] and ARROW in m["text"]}
                for m in self.msgs0 if m["channel"] == MAILROOM]
        returned_ids: list[str] = []
        released_today: dict[str, int] = {}
        self.truth, self.triggers, self.payloads = [], [], []
        week_posts, week_sms, week_chatter = [], [], []
        for n, p in enumerate(self.plans, 1):
            tid = f"s{self.seed}/t{n:02d}"
            at = p["at"]
            today = at.date().isoformat()
            delta = []
            if p.get("chatter"):
                c = p["chatter"]
                rec = {"ts": self.ts(c["at"]), "channel_id": self.chan[MAILROOM], "user_id": c["user"], "text": c["text"],
                       "is_bot": False, "created_at": naive(c["at"])}
                delta.append({"op": "insert", "app": "slack", "collection": "messages", "record": rec})
                mail.append({"date": today, "text": c["text"], "routing": False})
                week_chatter.append(c["text"])
            if p["kind"] == "package.received":
                row = {"id": self.hexid(), "row_id": max(x["row_id"] for x in rows) + 1, "cells": dict(p["cells"])}
                rows.append(row)
                delta.append({"op": "insert", "app": "google_sheets", "collection": "rows",
                              "record": {"id": row["id"], "spreadsheet_id": SS, "worksheet_id": WS_PKG,
                                         "row_id": row["row_id"], "cells": dict(row["cells"])}})
                p["row"] = row
                payload = {"app": "google_sheets", "event": "new_row",
                           "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_PKG], "row_id": row["row_id"],
                                    "row": dict(row["cells"])}}
            elif p["kind"] == "customs.cleared":
                src, ref = p["target"]
                row = next(x for x in rows if x["id"] == (ref["id"] if src == "w0" else ref["row"]["id"]))
                row["cells"]["Notes"] = p["notes"]
                delta.append({"op": "set_cells", "spreadsheet_id": SS, "worksheet_id": WS_PKG, "row_id": row["row_id"],
                              "cells": {"Notes": p["notes"]}})
                payload = {"app": "google_sheets", "event": "row_updated",       # key + changed cells only: the
                           "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_PKG],  # Status is the arm's own state
                                    "row_id": row["row_id"], "changed": ["Notes"],
                                    "row": {"Tracking Number": row["cells"]["Tracking Number"], "Notes": p["notes"]}}}
            elif p["kind"] == "employee.returned":
                e = p["emp"]
                emps[e["row_id"]]["cells"]["Status"] = "Active"
                returned_ids.append(e["id"])
                delta.append({"op": "set_cells", "spreadsheet_id": SS, "worksheet_id": WS_EMP, "row_id": e["row_id"],
                              "cells": {"Status": "Active"}})
                me = emps[e["row_id"]]["cells"]
                payload = {"app": "google_sheets", "event": "row_updated",
                           "data": {"spreadsheet_id": SS, "worksheet": WS_TITLE[WS_EMP], "row_id": e["row_id"],
                                    "changed": ["Status"],
                                    "row": {"Name": me["Name"], "Department": me["Department"], "Status": me["Status"]}}}
            else:
                payload = {"app": "schedule", "event": "day_close", "data": {"date": p["date"]}}
            directory = [v["cells"] for _, v in sorted(emps.items())]
            tr = {"trigger": tid, "index": n, "kind": p["kind"], "sub": p["sub"], "traps": [], "outcome": "no-op",
                  "expect": {"status": [], "posts": [], "sms": [], "escalate": False}, "assertions": []}
            ex = tr["expect"]

            def apply(row: dict, dec: dict, labels: list[str]):
                trk = row["cells"]["Tracking Number"]
                if dec["status"] is not None and norm(dec["status"]) != norm(row["cells"]["Status"]):
                    ex["status"].append({"id": row["id"], "row_id": row["row_id"], "trk": trk, "before": row["cells"]["Status"],
                                         "status": dec["status"]})
                    row["cells"]["Status"] = dec["status"]
                tr["assertions"].extend(self.assertions(row, dec, directory))
                if dec["status"] == ROUTED:
                    ex["posts"].append(dec["post"])
                    mail.append({"date": today, "text": dec["post"], "routing": True})
                    week_posts.append(dec["post"])
                    if dec.get("sms"):
                        ex["sms"].append(list(dec["sms"]))
                        week_sms.append(list(dec["sms"]))
                    if KW_OVERSIZED in norm(row["cells"]["Notes"]):
                        labels.append("oversized-sms" if dec.get("sms") else "oversized")

            labels: list[str] = []
            if p["kind"] == "package.received":
                row = p["row"]
                c = row["cells"]
                nl = c["Notes"]
                for kw in (KW_RETURNED, KW_CUSTOMS, KW_OVERSIZED):
                    if kw in nl.lower() and kw not in nl:
                        labels.append("notes-variant")
                if p["decoy"]:
                    labels.append("notes-decoy")
                same = [d for d in directory if norm(d["Name"]) == norm(c["Recipient Name"])]
                match = [d for d in same if norm(d["Department"]) == norm(c["Department"])]
                dec = decide(c, directory)
                if dec["reason"] == "returned":
                    labels.append("returned")
                    if any(x["cells"]["Tracking Number"] == c["Tracking Number"] for x in rows if x is not row):
                        labels.append("returned-rescan")
                else:
                    if match and len(same) > len(match):
                        labels.append("lookalike")
                    if not match:
                        labels.append("wrong-dept" if same else "not-found")
                    elif dec["reason"] in ("terminated", "on-leave", "customs"):
                        labels.append(dec["reason"])
                        if dec["reason"] == "on-leave" and KW_CUSTOMS in norm(nl):
                            labels.append("precedence")
                    elif any(x["id"] in returned_ids and norm(x["name"]) == norm(c["Recipient Name"])
                             and norm(x["dept"]) == norm(c["Department"]) for x in self.returning):
                        labels.append("back-from-leave")
                apply(row, dec, labels)
            elif p["kind"] == "customs.cleared":
                labels.append("release")
                if norm(row["cells"]["Status"]) == norm(HELD_CUSTOMS) and KW_CUSTOMS not in norm(row["cells"]["Notes"]):
                    dec = decide(row["cells"], directory)
                    apply(row, dec, labels)
                    if dec["status"] == ROUTED:
                        released_today[today] = released_today.get(today, 0) + 1
                else:
                    labels.append("still-held" if KW_CUSTOMS in norm(row["cells"]["Notes"]) else "not-held")
                    tr["assertions"].extend(self.assertions(row, {"status": None}, directory))
            elif p["kind"] == "employee.returned":
                labels.append("release")
                me = emps[p["emp"]["row_id"]]["cells"]
                if norm(me["Status"]) == "active":
                    for row in rows:
                        if norm(row["cells"]["Status"]) == norm(HELD_LEAVE) and norm(row["cells"]["Recipient Name"]) == norm(me["Name"]) \
                                and norm(row["cells"]["Department"]) == norm(me["Department"]):
                            dec = decide(row["cells"], directory)
                            apply(row, dec, labels)
                            if dec["status"] == HELD_CUSTOMS:
                                labels.append("requeue")
                            if dec["status"] == ROUTED:
                                released_today[today] = released_today.get(today, 0) + 1
                    others = [x for x in rows if norm(x["cells"]["Status"]) == norm(HELD_LEAVE)
                              and norm(x["cells"]["Recipient Name"]) == norm(me["Name"])
                              and norm(x["cells"]["Department"]) != norm(me["Department"])]
                    if others:
                        labels.append("release-lookalike")
                        for x in others:
                            tr["assertions"].extend(self.assertions(x, {"status": None}, directory))
            else:
                k = sum(1 for m in mail if m["routing"] and m["date"] == p["date"])
                text = day_total(k)
                ex["posts"].append(text)
                mail.append({"date": today, "text": text, "routing": False})
                week_posts.append(text)
                tr["assertions"].append({"type": "slack_message_exists", "channel_name": MAILROOM, "text_contains": text})
                if any(m["date"] == p["date"] and not m["routing"] and not m["text"].startswith("Routed today:") for m in mail):
                    labels.append("count-noise")
                if released_today.get(p["date"]):
                    labels.append("count-release")
            tr["traps"] = sorted(set(labels))
            if ex["status"] or ex["posts"] or ex["sms"]:
                tr["outcome"] = "act"
            payload = {"trigger": tid, "at": iso_z(at), **payload}
            self.payloads.append(payload)
            self.triggers.append({"trigger": tid, "index": n, "at": iso_z(at), "kind": p["kind"], "sub": p["sub"],
                                  "traps": tr["traps"], "payload": payload, "delta": delta})
            self.truth.append(tr)
        final_dir = {str(rid): v["cells"] for rid, v in sorted(emps.items())}
        posts0 = [m["text"] for m in self.msgs0 if m["channel"] == MAILROOM]
        sms_to = sorted({s[0] for s in week_sms})
        routed_week = sorted({p.split(" ")[0] for p in week_posts if ARROW in p})
        ab = [{"type": "slack_text_occurrence_count", "channel_name": MAILROOM, "text": f"{trk} {ARROW}",
               "count": sum(1 for t in posts0 + week_posts if t.startswith(f"{trk} {ARROW}"))} for trk in routed_week]
        ab += [{"type": "twilio_message_count", "to_number": to,
                "count": sum(1 for s in self.sms0 if s["to"] == to) + sum(1 for s in week_sms if s[0] == to)} for to in sms_to]
        self.end = {"week_start": self.monday.date().isoformat(),
                    "statuses": {x["id"]: x["cells"]["Status"] for x in rows},
                    "rows": {x["id"]: {k: v for k, v in x["cells"].items() if k != "Status"} for x in rows},
                    "mailroom": sorted(week_posts + week_chatter), "sms": sorted(week_sms), "directory": final_dir,
                    "assertions": ab}

    def assertions(self, row: dict, dec: dict, directory: list[dict]) -> list[dict]:
        """AutomationBench assertion dicts for one decided package (checked on this trigger's effects only)."""
        c = row["cells"]
        trk = c["Tracking Number"]
        out = []
        if dec["status"] == ROUTED:
            out.append({"type": "slack_message_exists", "channel_name": MAILROOM, "text_contains": [trk, dec["loc"], dec["emp"]["Name"]]})
            out.append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_PKG,
                        "cells": {"Tracking Number": trk, "Status": ROUTED}})
            if dec.get("sms"):
                out.append({"type": "twilio_sms_sent", "to_number": dec["sms"][0], "body_contains": [trk, dec["loc"]]})
            else:
                out.append({"type": "twilio_sms_not_sent", "body_contains": trk})
            for d in directory:
                if norm(d["Name"]) == norm(dec["emp"]["Name"]) and d["Phone"] != dec["emp"]["Phone"]:
                    out.append({"type": "twilio_sms_not_sent", "to_number": d["Phone"], "body_contains": trk})
        else:
            out.append({"type": "slack_message_not_exists", "channel_name": MAILROOM, "text_contains": trk})
            out.append({"type": "twilio_sms_not_sent", "body_contains": trk})
            if dec["status"] is not None:
                out.append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_PKG,
                            "cells": {"Tracking Number": trk, "Status": dec["status"]}})
        return out

    # -- world0 -------------------------------------------------------------------------------------------------------
    def world_dict(self) -> dict:
        pkg_rows = [{"id": x["id"], "row_id": x["row_id"], "cells": dict(x["cells"])} for x in self.rows0]
        emp_rows = [{"id": e["id"], "row_id": e["row_id"], "cells": self.emp_cells(e)} for e in sorted(self.emps, key=lambda e: e["row_id"])]
        pol_rows = [{"id": self.hexid(), "row_id": i + 2, "cells": {"Policy": p, "Rule": rule, "Effective Date": d}}
                    for i, (p, rule, d) in enumerate(POLICY_ROWS)]
        sheets = [{"id": SS, "title": SS_TITLE, "worksheets": [
            {"id": WS_PKG, "title": WS_TITLE[WS_PKG], "headers": PKG_HEADERS, "rows": pkg_rows},
            {"id": WS_EMP, "title": WS_TITLE[WS_EMP], "headers": EMP_HEADERS, "rows": emp_rows},
            {"id": WS_POL, "title": WS_TITLE[WS_POL], "headers": POL_HEADERS, "rows": pol_rows}]}]
        users = [{"id": uid, "name": nm, "username": un, "email": f"{un}@company.example.com",
                  "first_name": nm.split()[0], "last_name": nm.split()[1], "title": "Facilities"} for uid, nm, un in FRONT_DESK]
        members = [u["id"] for u in users]
        channels = [{"id": self.chan[MAILROOM], "name": MAILROOM, "topic": "Package routing and daily totals",
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
        sms = [{"sid": "SM" + self.hexid(32), "account_sid": "AC" + self.acct, "from_number": MAILROOM_NUMBER,
                "to_number": s["to"], "body": s["body"], "status": "delivered", "direction": "outbound-api",
                "date_created": naive(s["at"]), "date_updated": naive(s["at"])} for s in sorted(self.sms0, key=lambda s: s["at"])]
        return {"meta": {"schema_version": "0.1.0", "current_time": iso_z(self.monday + timedelta(hours=7)),
                         "allowed_services": list(APPS)},
                "google_sheets": {"spreadsheets": sheets},
                "slack": {"channels": channels, "users": users, "messages": msgs},
                "twilio": {"sms_messages": sms, "whatsapp_messages": [], "calls": []}}

    def run(self) -> dict:
        self.acct = self.hexid(32)
        self.chan = {MAILROOM: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C"),
                     REVIEW: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C"),
                     GENERAL: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C")}
        self.build_directory()
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
    the serve process), the api toolset, and meta.current_time = the trigger time (records the arm creates carry the
    trigger's time). The prompt holds only arm-visible text: POLICY.md and the payload."""
    policy = (HERE / "POLICY.md").read_text()
    info = {"task_name": f"{FAMILY}.s{seed}.t{trigger['index']:02d}", "zapier_tools": [], "assertions": [],
            "initial_state": {"meta": {"schema_version": "0.1.0", "current_time": trigger["at"]},
                              "google_sheets": {}, "slack": {}, "twilio": {}}}
    return {"example_id": trigger["index"],
            "prompt": [{"role": "system", "content": "standing automation " + FAMILY},
                       {"role": "user", "content": policy + "\n\nTrigger:\n" + canon(trigger["payload"])}],
            "answer": "", "info": json.dumps(info)}


TRAP_KIND = {"lookalike": "T-lookalike", "wrong-dept": "T-lookalike", "release-lookalike": "T-lookalike",
             "terminated": "T-note", "on-leave": "T-note", "customs": "T-note", "returned": "T-note",
             "notes-variant": "T-note", "notes-decoy": "T-note", "not-found": "T-note", "precedence": "T-note",
             "still-held": "T-note", "not-held": "T-note", "requeue": "T-note",
             "oversized": "T-format", "oversized-sms": "T-format",
             "returned-rescan": "T-repeat",
             "release": "T-state", "back-from-leave": "T-state", "count-noise": "T-state", "count-release": "T-state"}


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
    pk = [t for t in out["truth"] if t["kind"] == "package.received"]
    out["meta"] = {"family": FAMILY, "version": VERSION, "seed": seed, "difficulty": difficulty,
                   "week": out["end"]["week_start"], "n_triggers": len(out["truth"]), "kinds": dict(sorted(kinds.items())),
                   "outcomes": dict(sorted(outcomes.items())), "traps": dict(sorted(traps.items())),
                   "package_trap_share": round(sum(1 for t in pk if t["traps"]) / max(1, len(pk)), 3),
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
                                      "package_trap_share", "trigger_trap_share")}))


if __name__ == "__main__":
    main()
