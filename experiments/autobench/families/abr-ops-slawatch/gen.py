#!/usr/bin/env python3
"""abr-ops-slawatch: seeded stream generator (AutomationBench-R, research/automationbench-20261014/RECURRING-DESIGN.md
§3.2, §4.5). Runs inside AutomationBench's own venv (it validates worlds with AutomationBench's WorldState):

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-ops-slawatch/gen.py \
        --seed 610 [--difficulty d2] --out HOSTDIR

Writes into HOSTDIR (host-only; nothing generated is committed):
  world0.json        the initial world (WorldState dump; arms see it only through the tools)
  payloads.jsonl     the arm-visible trigger payloads, one per line, in order
  triggers.jsonl     host-only: payload + delta (world ops applied before the trigger) + kind + sub + traps
  truth.jsonl        host-only: per trigger, the expected outcome, effects, guards and AutomationBench assertion dicts
  end.json           host-only: the end-of-week expectations (graded at the last hourly check, Friday 17:00)
  serve-inputs.jsonl one input row per trigger for `bridge.py serve --input <row> --world world_t.json`
  meta.json          family, version, seed, difficulty, counts, trap shares and sha256 of every file

Determinism: one random.Random(f"{family}:{version}:{seed}:{difficulty}"); no wall clock; every id and timestamp of
every record is written explicitly, so no pydantic default factory ever fires.

The truth comes from the generator's own canonical model of the business (tickets as typed fields: a UTC deadline as a
datetime, a canonical status, a hold flag, ten phone digits), simulated check by check with the state after correct
handling of every earlier trigger. It never parses the strings it renders into the sheet, and it never reads a solver's
output. The reference solver (reference.py) is a separate implementation that parses those strings through the tools.

Trap annotation (per trigger, host-only): a trap planted on a ticket (or in the world) is recorded on a trigger when it
is *exposed* there: when a solver that ignores exactly that rule (simulated over the whole week with its own state)
would produce different effects at that trigger, or, for format and look-alike traps, when the ticket has an effect at
that trigger whose literals the trap affects.

State annotation (per trigger, host-only, since 1.1.0): `needs_state` is true where a memoryless solver (it reads no
state column and keeps no memory; it warns when the deadline entered the window since the previous scheduled check and
breaches when it passed since then) would produce different effects. controls.py's `memoryless` control fails exactly
there and at the week close.
"""
from __future__ import annotations

import argparse
import copy
import json
import random
import sys
from collections import Counter
from datetime import date, datetime, time, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import lib as L  # noqa: E402
from lib import UTC, hhmm, iso_z  # noqa: E402

FAMILY, VERSION = L.FAMILY, L.VERSION
APPS = L.APPS
canon, sha = L.canon, L.sha

# ---------------------------------------------------------------------------------------------------------------------
# Fictional pools (no real person or organization; every domain is *.example.com; 555 numbers are fictional)
# ---------------------------------------------------------------------------------------------------------------------
AGENTS = [("Paula Reed", "5552011001"), ("Carl Jensen", "5552011002"), ("Diana Moss", "5552011003"),
          ("Mike Torres", "5552011004"), ("Sarah Kim", "5552011005"), ("Omar Haddad", "5552011006"),
          ("Lena Fischer", "5552011007"), ("Tomas Novak", "5552011008"), ("Grace Osei", "5552011009"),
          ("Ravi Menon", "5552011010"), ("Ines Duarte", "5552011011"), ("Jonah Price", "5552011012")]
MANAGER_NAME = "Morgan Hale"
SUBJECTS = ["Login failures", "Payment error", "Data export broken", "API timeout", "Dashboard crash",
            "Email sync issue", "Slow search", "Billing discrepancy", "Database connection refused",
            "SSO redirect loop", "Webhook retries failing", "Invoice PDF blank", "Mobile app crash on upload",
            "Report scheduler stuck", "CSV import rejects dates", "Password reset emails delayed",
            "Search index out of date", "Permissions not applied", "Audit log missing entries",
            "Calendar sync duplicates", "Attachment upload fails", "Two-factor codes not arriving",
            "Bulk edit times out", "Notifications sent twice", "Usage report totals wrong", "Webhook signature invalid",
            "Sandbox reset failed", "Custom fields missing", "Timezone shown wrong", "Export stuck at 99%"]
CUSTOMERS = ["Crestview Industries", "NovaGen Labs", "Harborline Logistics", "Copperleaf Health", "Lumengrid Energy",
             "Orchard Lane Foods", "Tidewater Marine Supply", "Granite Peak Software", "Brightwell Learning",
             "Quarrystone Builders", "Meadowbrook Retail Group", "Juniper Bay Hotels", "Vantage Point Robotics",
             "Kestrel Aviation Services", "Fernhollow Analytics", "Saltmarsh Media", "Larkspur Insurance",
             "Wrenford Partners", "Galeway Energy", "Thornfield Assurance"]
PRIORITIES = ["P1", "P2", "P2", "P3", "P3", "P4"]
PLAIN_NOTES = ["", "", "", "", "Customer escalated via phone", "Engineering investigating", "Workaround shared",
               "Logs received", "VIP customer", "Follow-up call booked", "Reproduced in staging"]
LEGAL_MENTION_NOTES = ["Legal cc'd for visibility, no hold", "Customer's legal team asked for an RCA",
                       "Legal reviewed the contract terms last month; nothing pending"]
HOLD_NOTES = ["Under {code} review - do not contact", "Hold: {code} (contract dispute)",
              "{code} pending, legal to advise", "Customer data request under {code}"]
CLEAR_NOTES = ["Legal review complete; hold lifted", "Legal cleared, resume normal handling",
               "Hold released by legal this morning"]
VOID_DEADLINES = ["N/A", "VOID", "-", "TBD", "see parent ticket"]
OFFSETS = [-5, -4, 1, 2, 5.5]            # UTC offsets for written deadlines (T-format:offset)
PHONE_FORMATS = ["paren", "dots", "dashes", "plus-space", "one-dash", "paren-plus"]
UNREADABLE_PHONES = ["ext. 4410", "see Slack profile", "555-0199", "on file", "x2214 (desk)"]   # no 10-digit US number

# Per-difficulty knobs. Counts are per week; rates are the share of eligible tickets carrying an attribute trap.
COUNTS = {
    "d1": {"init": (10, 12), "opened": (5, 6), "updated": (5, 6), "history": (3, 4), "void": (1, 1)},
    "d2": {"init": (10, 13), "opened": (5, 7), "updated": (7, 10), "history": (3, 5), "void": (1, 2)},
    "d3": {"init": (12, 14), "opened": (6, 7), "updated": (9, 10), "history": (4, 5), "void": (2, 3)},
}
ATTR_RATE = {"d1": 0.0, "d2": 0.12, "d3": 0.8}
# Story mix (number of tickets per story) per difficulty: (min, max). Since 1.1.0 the mix leans on stories whose correct
# handling needs the tracker's state columns, not only the clock (a memoryless solver that warns when the deadline
# enters the window between two checks and breaches when it passes between two checks gets them wrong): reassignment
# after the warning, a hold cleared after the deadline or inside the window, work resumed inside the window, a short
# extension whose new deadline is already inside the window, a reopen after the deadline, a window amendment that
# straddles two checks, a ticket opened already inside the window, and an unreadable phone (escalated at every check
# that would warn).
STORIES = {
    "d1": {},
    "d2": {"hold": (1, 1), "legal-mention": (0, 1), "waiting": (1, 1), "closed-duplicate": (1, 1),
           "reassign-after-warning": (2, 2), "extend-after-warning": (1, 1), "reopened": (0, 1),
           "reopened-late": (1, 1), "breached-last-week": (1, 1), "exact-window": (1, 1), "exact-deadline": (0, 1),
           "after-hours": (1, 1), "eager-open": (1, 2), "lookalike": (1, 1), "unreadable-phone": (1, 1)},
    "d3": {"hold": (2, 2), "legal-mention": (0, 1), "waiting": (1, 1), "closed-duplicate": (1, 1),
           "reassign-after-warning": (2, 2), "extend-after-warning": (1, 1), "reopened": (0, 1),
           "reopened-late": (1, 1), "breached-last-week": (1, 1), "exact-window": (1, 1), "exact-deadline": (1, 1),
           "after-hours": (1, 1), "eager-open": (2, 3), "lookalike": (1, 1), "extended-last-week": (0, 1),
           "amend-straddle": (1, 1), "unreadable-phone": (1, 1)},
}
HOLD_KINDS = ["hold-cleared-late", "hold-cleared-in-window", "hold-static", "hold-placed"]
HOLD_WEIGHTS = [0.35, 0.35, 0.15, 0.15]

# Blind solver variants (one rule ignored) and the planted traps whose exposure each variant measures.
FLAG_TRAPS = {
    "hold": {"T-note:legal-hold"},
    "legal-mention": {"T-note:legal-mention"},
    "status": {"T-note:waiting", "T-repeat:closed-duplicate"},
    "status-case": {"T-format:status-case"},
    "offset": {"T-format:offset"},
    "preseed": {"T-repeat:breached-last-week"},
    "extension": {"T-repeat:extended"},
    "reassign": {"T-repeat:reassigned"},
    "strict": {"T-timing:exact-window", "T-timing:exact-deadline"},
    "lookahead": {"T-timing:after-hours"},
    "reopen": {"T-repeat:reopened"},
    "memoryless": {"T-repeat:reopened-late", "T-stale:window-straddle"},
}
# Story tickets that may equally be opened during the week (their story does not need the ticket open on Monday)
MOVABLE = {"legal-mention", "after-hours", "exact-deadline", "exact-window", "lookalike", "reassign-after-warning",
           "extend-after-warning", "hold-static", "hold-placed", "hold-cleared-in-window", "hold-cleared-late",
           "reopened-late", "amend-straddle", "unreadable-phone"}
WORLD_FLAGS = {"amend-ignored": "T-stale:window-amended", "amend-any": "T-authority:unauthorized-amendment",
               "amend-now": "T-timing:effective-date"}
TRAP_KINDS = ["T-lookalike", "T-stale", "T-note", "T-authority", "T-format", "T-repeat", "T-timing"]


def default_difficulty(seed: int) -> str:
    """Within each seed block (RECURRING-DESIGN §3.9) the first seed is d2, then d2/d3 alternate."""
    starts = [601, 610, 614, 622, 631, 8801, 8805, 8825, 8837]
    start = max([s for s in starts if s <= seed], default=seed)
    return "d2" if (seed - start) % 2 == 0 else "d3"


def render_deadline(D: datetime, offset) -> str:
    if offset is None:
        return iso_z(D)
    local = D + timedelta(hours=offset)
    sign = "+" if offset >= 0 else "-"
    h, m = int(abs(offset)), int(round((abs(offset) % 1) * 60))
    return local.strftime("%Y-%m-%dT%H:%M:%S") + f"{sign}{h:02d}:{m:02d}"


def naive_deadline(D: datetime, offset) -> datetime:
    """The offset-blind reading: the local clock taken as UTC."""
    return D if offset is None else D + timedelta(hours=offset)


def render_phone(d10: str, fmt: str | None) -> str:
    a, b, c = d10[:3], d10[3:6], d10[6:]
    return {None: "+1" + d10, "paren": f"({a}) {b}-{c}", "dots": f"{a}.{b}.{c}", "dashes": f"{a}-{b}-{c}",
            "plus-space": f"+1 {a} {b} {c}", "one-dash": f"1-{a}-{b}-{c}", "paren-plus": f"+1 ({a}) {b}-{c}"}[fmt]


def next_check(now: datetime) -> datetime:
    """The first hourly check strictly after `now` (any week)."""
    t = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    while True:
        if t.weekday() < 5 and t.hour in L.CHECK_HOURS:
            return t
        t += timedelta(hours=1)


def prev_check(now: datetime) -> datetime:
    """The scheduled hourly check strictly before `now` (any week)."""
    t = now.replace(minute=0, second=0, microsecond=0)
    if t == now:
        t -= timedelta(hours=1)
    while not (t.weekday() < 5 and t.hour in L.CHECK_HOURS):
        t -= timedelta(hours=1)
    return t




def iso_date(d) -> str:
    return d.isoformat() if isinstance(d, date) else str(d)


EMPTY_COUNTS = {"sms": [], "warn_posts": 0, "emails": 0, "breach_posts": 0, "jira": 0}
STATE_KEYS = ("rid", "tid", "subject", "agent", "phone10", "st", "status_cell", "D", "offset", "held", "legal_mention",
              "warned_at", "warned_agent", "warned_deadline", "breached_at")


class Gen:
    def __init__(self, seed: int, difficulty: str):
        if difficulty not in COUNTS:
            raise ValueError(f"difficulty must be d1, d2 or d3 (got {difficulty!r})")
        self.seed, self.d = int(seed), difficulty
        self.r = random.Random(f"{FAMILY}:{VERSION}:{self.seed}:{difficulty}")
        mondays = [date(2026, 2, 2) + timedelta(weeks=k) for k in range(60)]
        mondays = [m for m in mondays if m <= date(2026, 11, 23)]
        self.monday = datetime.combine(self.r.choice(mondays), time(0, 0), tzinfo=UTC)
        self.start = self.monday + timedelta(hours=8)
        self.checks = L.checks_of_week(self.monday)
        self.close = self.checks[-1]                       # Friday 17:00: the week-close check
        self.ids: set[str] = set()
        self.times: set[datetime] = set(self.checks)
        self.tickets: list[dict] = []                      # every tracker row (world0 rows and rows opened later)
        self.events: list[dict] = []                       # non-tick events (ticket.opened / ticket.updated)
        self.policy0: list[tuple[date, int, int]] = []     # (effective, minutes, order) rows in world0
        self.amend: list[dict] = []                        # amendment emails (d3)
        self.hist_sms, self.hist_posts, self.hist_mail, self.hist_jira = [], [], [], []
        self.world_traps: list[str] = []

    # -- ids, times ----------------------------------------------------------------------------------------------------
    def uid(self, alphabet: str, n: int, prefix: str = "") -> str:
        while True:
            v = prefix + "".join(self.r.choice(alphabet) for _ in range(n))
            if v not in self.ids:
                self.ids.add(v)
                return v

    def rid(self) -> str:
        return self.uid("0123456789abcdef", 24, "row")

    def tid(self, lo: int = 4001, hi: int = 4399) -> str:
        """A fresh ticket id that is neither a prefix of nor prefixed by any id so far (look-alikes only on purpose)."""
        while True:
            v = f"TK-{self.r.randint(lo, hi)}"
            if not any(x.startswith("TK-") and (v.startswith(x) or x.startswith(v)) for x in self.ids):
                self.ids.add(v)
                return v

    def lookalike_tid(self, base: str) -> str:
        for _ in range(100):
            v = base + str(self.r.randint(0, 9))
            if v not in self.ids:
                self.ids.add(v)
                return v
        raise RuntimeError("no look-alike id")

    def event_time(self, lo: datetime, hi: datetime, hours: range = range(8, 18)) -> datetime | None:
        """A unique event time in [lo, hi): a weekday, 08:00-17:59 (or `hours`), minute != 0, before the week-close
        check."""
        hi = min(hi, self.close - timedelta(minutes=1))
        lo = max(lo, self.start + timedelta(minutes=1)).replace(second=0, microsecond=0)
        cands = []
        t = lo
        while t < hi:
            if t.weekday() < 5 and t.hour in hours and t.minute != 0 and t not in self.times:
                cands.append(t)
            t += timedelta(minutes=1)
        if not cands:
            return None
        v = self.r.choice(cands)
        self.times.add(v)
        return v

    @staticmethod
    def window(policy: list, now: datetime) -> int:
        """Newest row with Effective <= the check's date; of equal dates the later row (higher order) wins."""
        best = None
        for eff, val, order in policy:
            if eff <= now.date() and (best is None or (eff, order) >= (best[0], best[2])):
                best = (eff, val, order)
        return best[1]

    def W_at(self, now: datetime) -> int:
        """The window in force at `now` (planning helper: the authorized amendments that arrived before `now`)."""
        rows = self.policy0 + [(a["effective"], a["value"], 100 + i) for i, a in enumerate(self.amend)
                               if a["kind"] == "authorized" and a["t"] < now]
        return self.window(rows, now)

    def window_checks(self, D: datetime) -> list[datetime]:
        """The hourly checks before D at which D is inside the window then in force."""
        return [c for c in self.checks if c < D and D - c <= timedelta(minutes=self.W_at(c))]

    def first_window_check(self, D: datetime) -> datetime | None:
        return next(iter(self.window_checks(D)), None)

    def story_deadline(self, day_lo: int, day_hi: int, hour_lo: int = 10, hour_hi: int = 17, k: int = 2) -> datetime:
        """A deadline on a working day with at least k checks inside the window before it (a story that acts between
        the warning check and a later check needs two; a window narrowed to 60 minutes leaves one)."""
        D = None
        for _ in range(200):
            D = self.work_deadline(day_lo, day_hi)
            D = D.replace(hour=min(hour_hi, max(hour_lo, D.hour)))
            if D > self.start + timedelta(hours=2) and len(self.window_checks(D)) >= k:
                return D
        return D

    def work_deadline(self, day_lo: int = 0, day_hi: int = 4, on_hour: bool = False) -> datetime:
        while True:
            day = self.r.randint(day_lo, day_hi)
            if on_hour:
                t = self.monday + timedelta(days=day, hours=self.r.randint(11, 17))
            else:
                t = self.monday + timedelta(days=day, hours=self.r.randint(10, 18), minutes=self.r.choice(range(5, 60, 5)))
            if t > self.start + timedelta(hours=2):
                return t

    # -- tickets ------------------------------------------------------------------------------------------------------
    def new_ticket(self, D: datetime | None, st: str = "open", story: str = "plain", tid: str | None = None,
                   history: bool = False, opened_at: datetime | None = None, attrs: bool = True) -> dict:
        r = self.r
        agent, d10 = r.choice(self.agents)
        if st in ("open", "in progress") and not opened_at and r.random() < 0.5:
            st = "in progress"
        status_cell = {"open": "Open", "in progress": "In Progress", "resolved": "Resolved", "closed": "Closed",
                       "waiting": "Waiting on Customer", "archived": "Archived", "void": "Void"}[st]
        tk = {"rid": self.rid(), "tid": tid or self.tid(), "subject": r.choice(SUBJECTS), "customer": r.choice(CUSTOMERS),
              "priority": r.choice(PRIORITIES), "agent": agent, "phone10": d10, "phone_fmt": None, "phone_raw": None, "st": st,
              "status_cell": status_cell, "D": D, "offset": None, "void_cell": None, "notes": r.choice(PLAIN_NOTES),
              "held": False, "legal_mention": False, "warned_at": None, "warned_agent": None, "warned_deadline": None,
              "breached_at": None, "traps": set(), "story": story, "history": history, "opened_at": opened_at}
        if attrs and D is not None and st in L.MONITORED and not history:
            if r.random() < ATTR_RATE[self.d]:
                tk["offset"] = r.choice(OFFSETS)
                tk["traps"].add("T-format:offset")
            if r.random() < ATTR_RATE[self.d]:
                tk["phone_fmt"] = r.choice(PHONE_FORMATS)
                tk["traps"].add("T-format:phone")
            if self.d == "d3" and r.random() < ATTR_RATE[self.d] / 2:
                tk["status_cell"] = r.choice(["in progress", "OPEN", " Open ", "In progress", "open"])
                tk["st"] = "in progress" if "progress" in tk["status_cell"].lower() else "open"
                tk["traps"].add("T-format:status-case")
        self.tickets.append(tk)
        return tk

    def cells(self, tk: dict, state: bool = True) -> dict:
        c = {"Ticket ID": tk["tid"], "Subject": tk["subject"], "Customer": tk["customer"], "Assigned Agent": tk["agent"],
             "Agent Phone": tk["phone_raw"] if tk["phone10"] is None else render_phone(tk["phone10"], tk["phone_fmt"]),
             "Priority": tk["priority"],
             "Status": tk["status_cell"],
             "SLA Deadline": tk["void_cell"] if tk["D"] is None else render_deadline(tk["D"], tk["offset"]),
             "Notes": tk["notes"]}
        if state:
            c.update(state_cells(tk))
        return c

    def set_hold(self, tk: dict, on: bool):
        if on:
            code = f"LGL-2026-{self.r.randint(10, 99):03d}"
            if self.d == "d3" and self.r.random() < 0.3:
                code = code.lower()
            tk["notes"] = self.r.choice(HOLD_NOTES).format(code=code)
        else:
            tk["notes"] = self.r.choice(CLEAR_NOTES)
        tk["held"] = on

    # -- planning -----------------------------------------------------------------------------------------------------
    def plan(self):
        r, d = self.r, self.d
        self.agents = r.sample(AGENTS, 8)
        self.policy0 = [(date(2025, 11, 3), L.DEFAULT_WINDOW, 1)]
        if d == "d3":
            self.policy0 = [(date(2025, 8, 4), 180, 0)] + self.policy0
            self.world_traps += ["T-stale:former-manager", "T-stale:old-window-row"]
        self.plan_amendments()
        self.plan_history()
        stories = []
        for s, (lo, hi) in STORIES[d].items():
            stories += [s] * r.randint(lo, hi)
        auth = [a for a in self.amend if a["kind"] == "authorized"]
        if not auth or auth[0]["effective"] != auth[0]["t"].date():
            stories = [s for s in stories if s != "amend-straddle"]      # the straddle needs a same-day window change
        self.n_holds = 0
        r.shuffle(stories)
        for s in stories:
            if s != "eager-open":
                self.make_story(s)
        n_init = r.randint(*COUNTS[d]["init"])
        n_open = r.randint(*COUNTS[d]["opened"])
        n_eager = stories.count("eager-open")
        # story tickets beyond the start-of-week count arrive during the week instead (a ticket.opened event)
        spare = n_open - n_eager
        movable = [tk for tk in self.tickets if tk["story"] in MOVABLE and not tk["history"]]
        r.shuffle(movable)
        for tk in movable:
            if self.n_open_at_start() <= n_init or spare <= 0:
                break
            if self.move_to_week(tk):
                spare -= 1
        while self.n_open_at_start() < n_init:
            self.make_plain()
        for k in range(n_eager):
            self.make_opened(eager=True)
        while sum(1 for e in self.events if e["kind"] == "ticket.opened") < n_open:
            self.make_opened(eager=False)
        self.init_state = {tk["rid"]: {k: tk[k] for k in STATE_KEYS} for tk in self.tickets}
        self.plan_updates()

    def n_open_at_start(self) -> int:
        opened = {e["rid"] for e in self.events if e["kind"] == "ticket.opened"}
        return sum(1 for tk in self.tickets if not tk["history"] and tk["rid"] not in opened
                   and tk["st"] in L.MONITORED + ("waiting",))

    def move_to_week(self, tk: dict) -> bool:
        """Turn a planned story ticket into one the support team opens during the week, well before its window."""
        e = self.event_time(self.start, tk["D"] - timedelta(minutes=L.WINDOW_MAX + 60))
        if e is None:
            return False
        tk["opened_at"] = e
        if tk["status_cell"] == "In Progress":       # a new ticket starts Open (status-case variants stay as written)
            tk["st"], tk["status_cell"] = "open", "Open"
        self.events.append({"kind": "ticket.opened", "sub": "opened", "t": e, "rid": tk["rid"]})
        return True

    def plan_amendments(self):
        """d3: an authorized in-range amendment (between two checks, effective that day in 70% of weeks, so the window
        changes from one check to the next), an amendment from someone else, and an out-of-range one from the support
        manager (the policy cannot decide it: escalate)."""
        if self.d != "d3":
            return
        r = self.r
        t = self.event_time(self.monday + timedelta(days=1, hours=9), self.monday + timedelta(days=3, hours=16),
                            hours=range(10, 17))
        value = r.choice([v for v in (60, 90, 150, 180) if v != L.DEFAULT_WINDOW])
        eff = t.date() + timedelta(days=0 if r.random() < 0.7 else 1)
        self.amend.append({"t": t, "kind": "authorized", "from": L.MANAGER, "from_name": MANAGER_NAME, "value": value,
                           "effective": eff, "traps": []})
        t2 = self.event_time(self.monday + timedelta(hours=9), self.monday + timedelta(days=1, hours=16))
        kind = r.choice(["agent", "lookalike", "lead"])
        if kind == "agent":
            name, _ = r.choice(self.agents)
            sender, trap = name.lower().replace(" ", ".") + f"@{L.ORG}", "T-authority:unauthorized-amendment"
        elif kind == "lead":
            name, sender, trap = "Avery Cole", f"avery.cole@{L.ORG}", "T-authority:unauthorized-amendment"
        else:
            name, sender, trap = MANAGER_NAME, r.choice(["support-manager@company-example.com",
                                                         "support.manager@company.example.com",
                                                         "support-manager@cornpany.example.com"]), "T-lookalike:sender"
        self.amend.append({"t": t2, "kind": "unauthorized", "from": sender, "from_name": name,
                           "value": r.choice([45, 60, 90, 150, 240]), "effective": t2.date(), "traps": [trap]})
        t3 = self.event_time(self.monday + timedelta(hours=9), self.monday + timedelta(days=4, hours=12))
        self.amend.append({"t": t3, "kind": "out-of-range", "from": L.MANAGER, "from_name": MANAGER_NAME,
                           "value": r.choice([30, 45, 200, 240]), "effective": t3.date() + timedelta(days=1),
                           "traps": ["T-authority:out-of-range-amendment"]})

    def plan_history(self):
        """Last week's rows: resolved/closed (warned, some breached), archived/void rows with non-date deadlines."""
        r = self.r
        for _ in range(r.randint(*COUNTS[self.d]["history"])):
            D = self.last_week_deadline()
            tk = self.new_ticket(D, st=r.choice(["resolved", "closed"]), story="history", tid=self.tid(3901, 3999),
                                 history=True, attrs=False)
            self.hist_warn(tk)
            if r.random() < 0.4:
                self.hist_breach(tk)
        for _ in range(r.randint(*COUNTS[self.d]["void"])):
            tk = self.new_ticket(None, st=r.choice(["archived", "void"]), story="void", tid=self.tid(3901, 3999),
                                 history=True, attrs=False)
            tk["void_cell"] = r.choice(VOID_DEADLINES)
            tk["notes"] = r.choice(["Archived after migration", "Created in error", "Merged into parent ticket", ""])
        self.world_traps.append("T-note:void-row")

    def hist_warn(self, tk: dict):
        w = next_check(tk["D"] - timedelta(minutes=L.DEFAULT_WINDOW) - timedelta(seconds=1))
        if w >= tk["D"]:
            return
        tk["warned_at"], tk["warned_agent"], tk["warned_deadline"] = w, tk["agent"], tk["D"]
        line = L.warn_line(tk["tid"], tk["subject"], tk["D"], tk["agent"])
        self.hist_sms.append({"to": "+1" + tk["phone10"], "body": L.warn_sms(tk["tid"], tk["D"]), "at": w})
        self.hist_posts.append({"channel": L.ESC, "text": line, "at": w})
        self.hist_mail.append({"to": L.MANAGER, "subject": L.warn_subject(tk["tid"]), "body": line, "at": w})

    def hist_breach(self, tk: dict):
        b = tk["D"] if tk["D"].minute == 0 and tk["D"].weekday() < 5 and tk["D"].hour in L.CHECK_HOURS else next_check(tk["D"])
        tk["breached_at"] = b
        self.hist_posts.append({"channel": L.ESC, "text": L.breach_post(tk["tid"]), "at": b})
        self.hist_jira.append({"summary": L.breach_summary(tk["tid"]), "at": b})

    def last_week_deadline(self) -> datetime:
        """A deadline in last week's working hours (Tuesday-Friday 10:05-16:55), so its warning and breach checks were
        last week too."""
        return self.monday - timedelta(days=self.r.randint(3, 6)) + timedelta(hours=self.r.randint(10, 16),
                                                                               minutes=self.r.choice(range(5, 60, 5)))

    def make_plain(self, **kw) -> dict:
        r = self.r
        x = r.random()
        if x < 0.12:
            D = self.monday + timedelta(days=r.randint(7, 8), hours=r.randint(9, 17), minutes=r.choice(range(5, 60, 5)))
        elif x < 0.2:
            D = self.monday + timedelta(hours=r.randint(8, 9), minutes=r.choice(range(5, 60, 5)))   # before Monday 10:00
        else:
            D = self.work_deadline()
        return self.new_ticket(D, st=kw.pop("st", "open"), **kw)

    def make_story(self, s: str):
        r = self.r
        if s == "hold":
            self.n_holds += 1
            if self.d == "d3" and self.n_holds == 1:          # d3: the first hold is always cleared during the week
                story = r.choice(HOLD_KINDS[:2])
            else:
                story = r.choices(HOLD_KINDS, weights=HOLD_WEIGHTS)[0]
            D = self.story_deadline(1, 3, 12, 17) if story == "hold-cleared-in-window" else self.work_deadline(1, 3)
            tk = self.new_ticket(D, story=story)
            tk["traps"].add("T-note:legal-hold")
            if story != "hold-placed":
                self.set_hold(tk, True)
        elif s == "legal-mention":
            tk = self.new_ticket(self.work_deadline(), story="legal-mention")
            tk["notes"], tk["legal_mention"] = r.choice(LEGAL_MENTION_NOTES), True
            tk["traps"].add("T-note:legal-mention")
        elif s == "waiting":
            story = "waiting-then-active" if r.random() < 0.75 else "waiting"
            D = self.story_deadline(0, 3, 12, 17) if story == "waiting-then-active" else self.work_deadline(0, 3)
            tk = self.new_ticket(D, st="waiting", story=story)
            tk["notes"] = "Waiting for customer to confirm the fix"
            tk["traps"].add("T-note:waiting")
        elif s == "closed-duplicate":
            base = self.new_ticket(self.work_deadline(), story="plain")
            dup = self.new_ticket(base["D"] + timedelta(minutes=r.choice([0, 0, 10, -15])), st="closed",
                                  story="closed-duplicate", attrs=False)
            dup.update(subject=base["subject"] + " - duplicate", agent=base["agent"], phone10=base["phone10"],
                       customer=base["customer"], notes=f"Duplicate of {base['tid']}")
            dup["traps"].add("T-repeat:closed-duplicate")
        elif s == "reassign-after-warning":
            self.new_ticket(self.story_deadline(0, 3, 13, 17), story="reassign-after-warning")
        elif s == "extend-after-warning":
            self.new_ticket(self.story_deadline(0, 3, 12, 16), story="extend-after-warning")
        elif s == "reopened":
            self.new_ticket(self.story_deadline(1, 3, 14, 17), story="reopened")
        elif s == "reopened-late":       # resolved before the deadline, reopened after it: the breach is still owed
            self.new_ticket(self.story_deadline(0, 3, 11, 16, k=1), story="reopened-late")
        elif s == "amend-straddle":      # the window changes between two checks with the deadline between the old and
            a = next(a for a in self.amend if a["kind"] == "authorized")      # the new window edge at the earlier one
            c0 = a["t"].replace(minute=0, second=0, microsecond=0)
            lo, hi = sorted((self.W_at(c0), a["value"]))
            tk = self.new_ticket(c0 + timedelta(minutes=lo + 5 * r.randint(1, (hi - lo) // 5)), story="amend-straddle")
            tk["traps"].add("T-stale:window-straddle")
        elif s == "unreadable-phone":    # the warning cannot be sent: escalate at every check that would warn
            tk = self.new_ticket(self.story_deadline(0, 3, 12, 17, k=1), story="unreadable-phone", attrs=False)
            tk["phone10"], tk["phone_raw"] = None, r.choice(UNREADABLE_PHONES)
            tk["traps"].add("T-format:unreadable-phone")
        elif s == "breached-last-week":
            D = self.last_week_deadline()
            tk = self.new_ticket(D, st="in progress", story="breached-last-week", attrs=False)
            tk["notes"] = r.choice(["Escalated to tier 2", "Customer informed of delay", "Fix scheduled for release"])
            w = next_check(D - timedelta(minutes=L.DEFAULT_WINDOW) - timedelta(seconds=1))
            tk["warned_at"], tk["warned_agent"], tk["warned_deadline"] = min(w, D - timedelta(minutes=30)), tk["agent"], D
            tk["breached_at"] = next_check(D - timedelta(seconds=1))
            tk["traps"].add("T-repeat:breached-last-week")
            self.hist_sms.append({"to": "+1" + tk["phone10"], "body": L.warn_sms(tk["tid"], D), "at": tk["warned_at"]})
            self.hist_posts.append({"channel": L.ESC, "text": L.warn_line(tk["tid"], tk["subject"], D, tk["agent"]),
                                    "at": tk["warned_at"]})
            self.hist_posts.append({"channel": L.ESC, "text": L.breach_post(tk["tid"]), "at": tk["breached_at"]})
            self.hist_jira.append({"summary": L.breach_summary(tk["tid"]), "at": tk["breached_at"]})
        elif s == "extended-last-week":
            old = self.monday - timedelta(days=3, hours=r.randint(5, 6), minutes=r.choice(range(5, 60, 5)))
            tk = self.new_ticket(self.work_deadline(0, 1), st="in progress", story="extended-last-week")
            w = next_check(old - timedelta(minutes=L.DEFAULT_WINDOW) - timedelta(seconds=1))
            tk["warned_at"], tk["warned_agent"], tk["warned_deadline"] = w, tk["agent"], old
            tk["notes"] = "Deadline extended: customer agreed a new date"
            tk["traps"].add("T-repeat:extended")
            self.hist_sms.append({"to": "+1" + tk["phone10"], "body": L.warn_sms(tk["tid"], old), "at": w})
            self.hist_posts.append({"channel": L.ESC, "text": L.warn_line(tk["tid"], tk["subject"], old, tk["agent"]), "at": w})
        elif s == "exact-window":
            c = r.choice([c for c in self.checks if c.weekday() <= 2 and c.hour <= 15])
            tk = self.new_ticket(c + timedelta(minutes=self.W_at(c)), story="exact-window")
            tk["traps"].add("T-timing:exact-window")
        elif s == "exact-deadline":
            tk = self.new_ticket(self.work_deadline(0, 4, on_hour=True), story="exact-deadline")
            tk["traps"].add("T-timing:exact-deadline")
        elif s == "after-hours":
            day = r.randint(0, 3)
            if r.random() < 0.6:
                D = self.monday + timedelta(days=day, hours=r.randint(20, 22), minutes=r.choice(range(5, 60, 5)))
            else:
                D = self.monday + timedelta(days=day + 1, hours=r.randint(1, 8), minutes=r.choice(range(5, 60, 5)))
            tk = self.new_ticket(D, story="after-hours")
            tk["traps"].add("T-timing:after-hours")
        elif s == "lookalike":
            base = self.tid()
            longer = self.lookalike_tid(base)
            main_tid, sib_tid = (base, longer) if r.random() < 0.5 else (longer, base)
            main = self.new_ticket(self.work_deadline(), story="lookalike", tid=main_tid)
            main["traps"].add("T-lookalike:id")
            if r.random() < 0.5:         # last week's resolved sibling, warned (its posts and SMS are in the history)
                sib = self.new_ticket(self.last_week_deadline(), st="resolved", story="lookalike-sibling", tid=sib_tid,
                                      history=True, attrs=False)
                if r.random() < 0.5:
                    sib["subject"] = main["subject"]
                self.hist_warn(sib)
            else:                        # an open sibling with its own deadline, later in the week or next week
                sib = self.new_ticket(self.work_deadline(2, 6), story="lookalike-sibling", tid=sib_tid)
                if r.random() < 0.5:
                    sib["subject"] = main["subject"]
            sib["traps"].add("T-lookalike:id")
        else:
            raise ValueError(s)

    def make_opened(self, eager: bool):
        r = self.r
        for _ in range(500):
            # an eager ticket arrives after 10:00, so the check before its first check is the same day's
            e = self.event_time(self.monday + timedelta(hours=9), self.monday + timedelta(days=4, hours=15),
                                hours=range(10, 18) if eager else range(8, 18))
            if e is None:
                continue
            if eager:
                c = next_check(e)
                W = self.W_at(c)
                if c >= self.close or c.date() != e.date():
                    self.times.discard(e)
                    continue
                if r.random() < 0.35:
                    # logged after its deadline already passed, before the previous check: the breach is owed at the
                    # next check although no check saw the deadline pass
                    D = c - timedelta(minutes=60 + 5 * r.randint(1, 24))
                else:
                    # opened inside the window, and inside it already at the previous check (before it existed)
                    hi, lo = e + timedelta(minutes=W), c + timedelta(minutes=5)
                    if c + timedelta(minutes=W - 60) > lo:
                        hi = min(hi, c + timedelta(minutes=W - 60))
                    if hi <= lo:
                        self.times.discard(e)
                        continue
                    D = lo + timedelta(minutes=5 * r.randint(0, int((hi - lo).total_seconds() // 300)))
            else:
                D = e + timedelta(minutes=5 * r.randint(30, 340))
                D = D.replace(minute=(D.minute // 5) * 5, second=0)
                if D.minute == 0:
                    D += timedelta(minutes=5)
            tk = self.new_ticket(D, st="open", story="eager-open" if eager else "opened", opened_at=e)
            if eager:
                tk["traps"].add("T-timing:eager-open")
            tk["notes"] = r.choice(["", "", "New ticket from web form", "Reported by phone"])
            self.events.append({"kind": "ticket.opened", "sub": "opened", "t": e, "rid": tk["rid"]})
            return tk
        raise RuntimeError("could not place an opened ticket")

    # -- updates ------------------------------------------------------------------------------------------------------
    def provisional(self) -> dict:
        """rid -> check times of its warnings / breaches under the true rules, before any update exists."""
        out = {}
        res = self.simulate()
        for ev, effs in zip(res["timeline"], res["effects"]):
            for e in effs:
                if e[0] in ("warn", "breach", "reassign"):
                    out.setdefault(e[2], {"warn": [], "breach": [], "reassign": []})[e[0]].append(ev["t"])
        return out

    def add_update(self, tk: dict, t: datetime, sub: str, model: dict):
        self.events.append({"kind": "ticket.updated", "sub": sub, "t": t, "rid": tk["rid"], "model": model})

    def has_update(self, tk: dict) -> bool:
        return any(e["kind"] == "ticket.updated" and e["rid"] == tk["rid"] for e in self.events)

    def last_check_before(self, b: datetime) -> datetime | None:
        cs = [c for c in self.checks if c < b]
        return cs[-1] if cs else None

    def plan_updates(self):
        r = self.r
        target = r.randint(*COUNTS[self.d]["updated"])
        cap = COUNTS[self.d]["updated"][1]
        prov = self.provisional()
        n = 0
        none = {"warn": [], "breach": [], "reassign": []}

        def before_a_check(a: datetime, b: datetime) -> datetime | None:
            """An event time after `a` with an hourly check strictly after it and before `b`."""
            c = self.last_check_before(b)
            return self.event_time(a + timedelta(minutes=1), c) if c and c > a else None

        def other_agent(tk):
            return r.choice([x for x in self.agents if x[0] != tk["agent"]])

        for tk in list(self.tickets):
            p, s = prov.get(tk["rid"], none), tk["story"]
            if n + (2 if s in ("reopened", "reopened-late") else 1) > cap:
                continue                 # the week's update budget is spent: this story keeps its initial state
            if s == "hold-cleared-late":         # cleared after a check that already had the deadline passed
                c = next_check(tk["D"] - timedelta(seconds=1))
                t = self.event_time(c + timedelta(minutes=1), c + timedelta(hours=26))
                if t:
                    self.add_update(tk, t, "hold-cleared", {"hold": False})
                    n += 1
            elif s == "hold-cleared-in-window":   # cleared after a check that already had the deadline inside the window
                c1 = self.first_window_check(tk["D"])
                t = before_a_check(c1, tk["D"]) if c1 else None
                if t:
                    self.add_update(tk, t, "hold-cleared", {"hold": False})
                    n += 1
            elif s == "hold-placed":
                t = self.event_time(tk["opened_at"] or self.start, tk["D"] - timedelta(minutes=200))
                if t:
                    self.add_update(tk, t, "hold-placed", {"hold": True})
                    n += 1
            elif s == "waiting-then-active":     # work resumes inside the window (after a check that already had the
                c1 = self.first_window_check(tk["D"])     # deadline inside it): the first check after it warns
                t = before_a_check(c1, tk["D"]) if c1 else None
                if t:
                    self.add_update(tk, t, "status", {"st": "in progress", "status_cell": "In Progress",
                                                      "notes": "Customer replied; work resumed"})
                    n += 1
            elif s == "reassign-after-warning" and p["warn"]:
                t = before_a_check(p["warn"][0], tk["D"])
                if t:
                    name, d10 = other_agent(tk)
                    fmt = r.choice(PHONE_FORMATS) if r.random() < 0.5 else None
                    self.add_update(tk, t, "reassigned", {"agent": name, "phone10": d10, "phone_fmt": fmt})
                    tk["traps"].add("T-repeat:reassigned")
                    if fmt:
                        tk["traps"].add("T-format:phone")
                    n += 1
            elif s == "extend-after-warning" and p["warn"]:
                newD, t = None, None
                if r.random() < 0.5:     # short: the new deadline is inside the window already an hour before the next check
                    t = before_a_check(p["warn"][0], tk["D"])
                    if t:
                        c = next_check(t)
                        room = int((c + timedelta(minutes=self.W_at(c) - 60) - tk["D"]).total_seconds() // 300)
                        if room >= 1:
                            newD = tk["D"] + timedelta(minutes=5 * r.randint(1, min(room, 9)))
                        else:
                            self.times.discard(t)
                            t = None
                if t is None:            # long: two to five hours later, warned again when it enters the window
                    t = self.event_time(p["warn"][0] + timedelta(minutes=1), tk["D"])
                    if t:
                        newD = tk["D"] + timedelta(hours=r.randint(2, 5), minutes=r.choice([0, 15, 30, 45]))
                        if newD.hour >= 18 or newD.hour < 8:
                            newD += timedelta(hours=15)              # into the next morning's checks
                        if newD.weekday() >= 5:
                            newD += timedelta(days=7 - newD.weekday())
                if t:
                    self.add_update(tk, t, "extended", {"D": newD, "notes": "Deadline extended by the support manager"})
                    tk["traps"].add("T-repeat:extended")
                    n += 1
            elif s == "reopened" and p["warn"]:
                c = self.last_check_before(tk["D"])
                t1 = self.event_time(p["warn"][0] + timedelta(minutes=1), c) if c and c > p["warn"][0] else None
                t2 = before_a_check(t1, tk["D"]) if t1 else None
                if t1 and t2:
                    self.add_update(tk, t1, "resolved", {"st": "resolved", "status_cell": "Resolved"})
                    self.add_update(tk, t2, "reopened", {"st": "open", "status_cell": "Open",
                                                         "notes": "Reopened: customer reports the issue again"})
                    tk["traps"].add("T-repeat:reopened")
                    n += 2
                elif t1:
                    self.times.discard(t1)
            elif s == "reopened-late":
                lo1 = p["warn"][0] + timedelta(minutes=1) if p["warn"] else (tk["opened_at"] or self.start)
                t1 = self.event_time(lo1, tk["D"])
                c = next_check(tk["D"] - timedelta(seconds=1))     # reopened after the check the deadline passed at
                t2 = self.event_time(c + timedelta(minutes=1), c + timedelta(hours=26)) if t1 else None
                if t1 and t2:
                    self.add_update(tk, t1, "resolved", {"st": "resolved", "status_cell": "Resolved"})
                    self.add_update(tk, t2, "reopened", {"st": "open", "status_cell": "Open",
                                                         "notes": "Reopened: the fix did not hold"})
                    tk["traps"].add("T-repeat:reopened-late")
                    n += 2
                elif t1:
                    self.times.discard(t1)
        # fill with resolutions, closures and early reassignments until the target count
        cands = [tk for tk in self.tickets if tk["story"] in ("plain", "opened", "legal-mention", "lookalike")
                 and tk["st"] in L.MONITORED and not self.has_update(tk)]
        r.shuffle(cands)
        for tk in cands:
            if n >= target:
                break
            p = prov.get(tk["rid"], none)
            lo = tk["opened_at"] or self.start
            modes = ["after-warning", "after-warning", "before-window", "after-breach", "reassign-early"]
            r.shuffle(modes)
            for mode in modes:
                t = None
                if mode == "after-warning" and p["warn"]:
                    t = self.event_time(p["warn"][0] + timedelta(minutes=1), tk["D"])
                elif mode == "after-breach" and p["breach"]:
                    t = self.event_time(p["breach"][0] + timedelta(minutes=1), p["breach"][0] + timedelta(hours=20))
                elif mode == "before-window":
                    end = (p["warn"][0] - timedelta(minutes=61)) if p["warn"] else min(tk["D"], self.close)
                    t = self.event_time(lo, end)
                elif mode == "reassign-early" and p["warn"]:
                    t = self.event_time(lo, p["warn"][0] - timedelta(minutes=61))
                    if t:
                        name, d10 = other_agent(tk)
                        self.add_update(tk, t, "reassigned", {"agent": name, "phone10": d10, "phone_fmt": None})
                        n += 1
                        break
                    continue
                if t:
                    st = r.choice(["resolved", "closed"])
                    self.add_update(tk, t, "resolved", {"st": st, "status_cell": st.capitalize()})
                    n += 1
                    break

    # -- simulation ---------------------------------------------------------------------------------------------------
    def timeline(self) -> list[dict]:
        evs = [{"kind": "tick", "sub": "hourly_check", "t": c} for c in self.checks]
        evs += [dict(e) for e in self.events]
        evs += [{"kind": "amendment", "sub": a["kind"], "t": a["t"], "amend": i} for i, a in enumerate(self.amend)]
        evs.sort(key=lambda e: e["t"])
        return evs

    @staticmethod
    def decide(s: dict, now: datetime, W: int, blind: frozenset) -> list[tuple]:
        """Section 4 of POLICY.md on the generator's typed model; mutates the ticket state when it acts. `blind` names
        the rules a deliberately wrong solver ignores (used only to annotate trap exposure)."""
        if "status" in blind:
            monitored = s["D"] is not None
        elif "status-case" in blind:
            monitored = s["status_cell"] in ("Open", "In Progress")
        else:
            monitored = s["st"] in L.MONITORED
        if not monitored or s["D"] is None:
            return []
        held = s["held"] and "hold" not in blind
        if "legal-mention" in blind:
            held = held or s["legal_mention"]
        if held:
            return []
        D = naive_deadline(s["D"], s["offset"]) if "offset" in blind else s["D"]
        phone = "+1" + s["phone10"] if s["phone10"] else None
        if "memoryless" in blind:        # no state read: the deadline entered the window / passed since the last check
            p = prev_check(now)
            if D <= now:
                if D > p:
                    s["breached_at"] = now
                    return [("breach", s["tid"], s["rid"])]
                return []
            if timedelta(0) < D - now <= timedelta(minutes=W) and not (timedelta(0) < D - p <= timedelta(minutes=W)):
                if phone is None:
                    return [("escalate", s["tid"], s["rid"], "phone")]
                s["warned_at"], s["warned_agent"], s["warned_deadline"] = now, s["agent"], D
                return [("warn", s["tid"], s["rid"], phone, hhmm(D), s["agent"], s["subject"], iso_z(D))]
            return []
        strict = "strict" in blind
        if (D < now) if strict else (D <= now):
            if s["breached_at"] is None:
                s["breached_at"] = now
                return [("breach", s["tid"], s["rid"])]
            return []
        left = D - now
        in_win = timedelta(0) < left and ((left < timedelta(minutes=W)) if strict else (left <= timedelta(minutes=W)))
        if "lookahead" in blind and now.hour == 17 and D < next_check(now):
            in_win = True
        warned = s["warned_at"] is not None and ("extension" in blind or s["warned_deadline"] == D)
        if in_win and not warned:
            if phone is None:            # POLICY.md section 7: the phone cannot be read; nothing else for the ticket
                return [("escalate", s["tid"], s["rid"], "phone")]
            s["warned_at"], s["warned_agent"], s["warned_deadline"] = now, s["agent"], D
            return [("warn", s["tid"], s["rid"], phone, hhmm(D), s["agent"], s["subject"], iso_z(D))]
        if warned and D > now and "reassign" not in blind and L.norm_ci(s["warned_agent"]) != L.norm_ci(s["agent"]):
            if phone is None:
                return [("escalate", s["tid"], s["rid"], "phone")]
            s["warned_agent"] = s["agent"]
            return [("reassign", s["tid"], s["rid"], phone, hhmm(D), s["agent"])]
        return []

    def simulate(self, blind: frozenset = frozenset(), keep: bool = False) -> dict:
        """Run the week on the canonical model. keep=True also records, per trigger, every row's state after the
        trigger's delta and before it is handled."""
        opened = {e["rid"] for e in self.events if e["kind"] == "ticket.opened"}
        state = {rid: dict(s) for rid, s in self.init_state.items()}
        order = [tk["rid"] for tk in self.tickets if tk["rid"] not in opened]
        if "preseed" in blind:
            for rid in order:
                s = state[rid]
                s["warned_at"] = s["warned_agent"] = s["warned_deadline"] = s["breached_at"] = None
        policy = list(self.policy0)
        tl = self.timeline()
        effects, windows, states = [], [], []
        for ev in tl:
            if ev["kind"] == "ticket.opened":
                order.append(ev["rid"])
            elif ev["kind"] == "ticket.updated":
                s = state[ev["rid"]]
                for k, v in ev["model"].items():
                    if k == "hold":
                        s["held"] = v
                    elif k in s:
                        s[k] = v
                if "reopen" in blind and ev["sub"] == "reopened":
                    s["warned_at"] = s["warned_agent"] = s["warned_deadline"] = None
            if keep:
                states.append({rid: dict(state[rid]) for rid in order})
            W = self.window(policy, ev["t"])
            windows.append(W)
            effs = []
            if ev["kind"] == "tick":
                for rid in order:
                    effs += self.decide(state[rid], ev["t"], W, blind)
            elif ev["kind"] == "amendment":
                a = self.amend[ev["amend"]]
                if a["kind"] == "out-of-range":          # from the owner but outside 60-180: cannot decide (section 6)
                    effs.append(("escalate", None, None, "amendment"))
                elif (a["kind"] == "authorized" and "amend-ignored" not in blind) or \
                        (a["kind"] == "unauthorized" and "amend-any" in blind):
                    use = ev["t"].date() if "amend-now" in blind else a["effective"]
                    policy.append((use, a["value"], 100 + ev["amend"]))
                    effs.append(("policy", iso_date(a["effective"]), a["value"], a["from"]))
            effects.append(effs)
        return {"timeline": tl, "effects": effects, "state": state, "order": order, "policy": policy,
                "windows": windows, "states": states}

    # -- truth ----------------------------------------------------------------------------------------------------------
    def phone_fmt_at(self, tk: dict, t: datetime):
        fmt = tk["phone_fmt"]
        for e in sorted((e for e in self.events if e["rid"] == tk["rid"] and e["kind"] == "ticket.updated"),
                        key=lambda e: e["t"]):
            if e["t"] < t and "phone_fmt" in e["model"]:
                fmt = e["model"]["phone_fmt"]
        return fmt

    def compute_truth(self):
        true = self.simulate(keep=True)
        self.true = true
        by_tid = {tk["tid"]: tk for tk in self.tickets}
        blinds = {f: self.simulate(frozenset([f])) for f in list(FLAG_TRAPS) + list(WORLD_FLAGS)}
        # needs_state: a solver that reads no state column and keeps no memory (decides from the clock: warn when the
        # deadline entered the window since the previous scheduled check, breach when it passed since then) acts
        # differently at this trigger
        mem = blinds["memoryless"]["effects"]
        self.needs_state = [Counter(mem[i]) != Counter(true["effects"][i]) for i in range(len(true["timeline"]))]
        traps_per = []
        for i, ev in enumerate(true["timeline"]):
            exp: set[str] = set()
            te = true["effects"][i]
            sig_t = Counter(te)
            for f, res in blinds.items():
                sig_b = Counter(res["effects"][i])
                if sig_b == sig_t:
                    continue
                if f in WORLD_FLAGS:
                    exp.add(WORLD_FLAGS[f])
                    continue
                for e in (sig_b - sig_t) + (sig_t - sig_b):
                    tk = by_tid.get(e[1]) if e[0] != "policy" else None
                    if tk is None:
                        continue
                    if f == "strict":        # any ticket a strict-inequality solver handles differently is a boundary
                        tk["traps"].add("T-timing:exact-deadline" if tk["D"] and tk["D"].minute == 0
                                        and tk["D"] in set(self.checks) else "T-timing:exact-window")
                    elif f == "lookahead":
                        tk["traps"].add("T-timing:after-hours")
                    exp |= tk["traps"] & FLAG_TRAPS[f]
            for e in te:
                if e[0] == "escalate" and e[1]:
                    exp |= by_tid[e[1]]["traps"] & {"T-format:unreadable-phone"}
                if e[0] in ("warn", "reassign", "breach"):
                    tk = by_tid[e[1]]
                    if "T-lookalike:id" in tk["traps"]:
                        exp.add("T-lookalike:id")
                    if e[0] in ("warn", "reassign") and self.phone_fmt_at(tk, ev["t"]):
                        exp.add("T-format:phone")
                    if e[0] == "warn" and self.d == "d3":
                        exp.add("T-stale:former-manager")
            if ev["kind"] in ("ticket.opened", "ticket.updated"):
                s = dict(true["states"][i][ev["rid"]])
                if self.decide(s, ev["t"], true["windows"][i], frozenset()):
                    exp.add("T-timing:eager-open" if ev["kind"] == "ticket.opened" else "T-timing:eager-update")
            if ev["kind"] == "amendment":
                exp |= set(self.amend[ev["amend"]]["traps"])
            traps_per.append(sorted(exp))
        self.traps_per = traps_per

    # -- the stream -----------------------------------------------------------------------------------------------------
    def apply_model(self, tk: dict, model: dict) -> list[str]:
        """Apply an update to the generator's ticket record (for rendering later deltas); return the changed columns."""
        before = self.cells(tk, state=False)
        for k, v in model.items():
            if k == "hold":
                self.set_hold(tk, v)
            else:
                tk[k] = v
        after = self.cells(tk, state=False)
        changed = [c for c in L.TICKET_COLS if before[c] != after[c]]
        if not changed:
            raise AssertionError(f"update on {tk['tid']} changes nothing")
        return changed

    def stream(self) -> list[dict]:
        """Render payloads and deltas in time order. Ticket records are mutated as events apply, so world0 is rendered
        first from the records' initial values."""
        tl = self.true["timeline"]
        by_rid = {tk["rid"]: tk for tk in self.tickets}
        opened = {e["rid"] for e in self.events if e["kind"] == "ticket.opened"}
        self.world0_cells = {tk["rid"]: self.cells(tk) for tk in self.tickets if tk["rid"] not in opened}
        self.inbound_ids = []
        triggers = []
        for i, ev in enumerate(tl):
            tid = f"s{self.seed}/t{i + 1:02d}"
            at = iso_z(ev["t"])
            payload = {"trigger": tid, "at": at}
            delta = []
            if ev["kind"] == "tick":
                payload.update(app="schedule", event="hourly_check", data={})
            elif ev["kind"] == "ticket.opened":
                tk = by_rid[ev["rid"]]
                cells = self.cells(tk)
                delta.append({"op": "insert_row", "spreadsheet_id": L.TICKETS_SS, "worksheet_id": L.WS_OPEN,
                              "id": tk["rid"], "cells": cells})
                payload.update(app="google_sheets", event="new_row",
                               data={"spreadsheet_id": L.TICKETS_SS, "worksheet": L.TITLES[L.WS_OPEN],
                                     "row": {c: cells[c] for c in L.TICKET_COLS}})
            elif ev["kind"] == "ticket.updated":
                tk = by_rid[ev["rid"]]
                changed = self.apply_model(tk, ev["model"])
                cells = self.cells(tk, state=False)
                delta.append({"op": "update_row", "spreadsheet_id": L.TICKETS_SS, "worksheet_id": L.WS_OPEN,
                              "id": tk["rid"], "cells": {c: cells[c] for c in changed}})
                payload.update(app="google_sheets", event="updated_row",
                               data={"spreadsheet_id": L.TICKETS_SS, "worksheet": L.TITLES[L.WS_OPEN],
                                     "row": cells, "changed": changed})
            else:
                a = self.amend[ev["amend"]]
                msg = self.amend_message(a, ev["t"])
                self.inbound_ids.append(msg["id"])
                delta.append({"op": "add_email", "message": msg})
                payload.update(app="gmail", event="new_email",
                               data={"message_id": msg["id"], "from": f"{a['from_name']} <{a['from']}>",
                                     "subject": msg["subject"], "snippet": msg["body_plain"][:90]})
            kind = {"tick": "tick", "ticket.opened": "ticket.opened", "ticket.updated": "ticket.updated",
                    "amendment": "policy.amendment"}[ev["kind"]]
            triggers.append({"trigger": tid, "index": i + 1, "at": at, "kind": kind, "sub": ev["sub"],
                             "payload": payload, "delta": delta, "traps": self.traps_per[i]})
        return triggers

    def amend_message(self, a: dict, t: datetime) -> dict:
        mid, thread = self.uid("0123456789abcdef", 16), self.uid("0123456789abcdef", 16)
        if a["kind"] in ("authorized", "out-of-range"):
            subject = "Warning window change"
            body = (f"Hi,\n\nPlease change the SLA warning window for the hourly checks.\n\nParameter: Warning window\n"
                    f"New value: {a['value']} minutes\nEffective: {iso_date(a['effective'])}\n\nThanks,\n{MANAGER_NAME}\n"
                    f"Support Manager\n")
        else:
            subject = self.r.choice(["Re: SLA warnings", "Warning window change", "Can we tweak the SLA heads-up?"])
            body = (f"Hi,\n\nThe current heads-up does not suit our shift pattern. Please switch the automation to the "
                    f"following.\n\nParameter: Warning window\nNew value: {a['value']} minutes\nEffective: "
                    f"{iso_date(a['effective'])}\n\nThanks,\n{a['from_name']}\n")
        ms = int(t.timestamp() * 1000)
        return {"id": mid, "thread_id": thread, "from_": a["from"], "from_name": a["from_name"], "to": [L.INBOX],
                "subject": subject, "body_plain": body, "date": ms, "internal_date": ms, "label_ids": ["INBOX", "UNREAD"],
                "is_read": False}

    def compile_truth(self, triggers: list[dict]) -> list[dict]:
        tl, effs, states = self.true["timeline"], self.true["effects"], self.true["states"]
        by_tid = {tk["tid"]: tk for tk in self.tickets}
        sms_ever = {h["body"].split(":")[0][len("SLA warning "):] for h in self.hist_sms}
        breach_ever = {h["summary"][len("SLA breach "):] for h in self.hist_jira}
        truth = []
        for i, (ev, trig) in enumerate(zip(tl, triggers)):
            exp = {"warn": [], "reassign": [], "breach": [], "policy_rows": [], "escalate": False}
            asserts = []
            for e in effs[i]:
                if e[0] == "warn":
                    _, tid, rid, to, due, agent, subject, dl = e
                    line = f"{tid} | {subject} | due {due} UTC | {agent}"
                    exp["warn"].append({"tid": tid, "rid": rid, "to": to, "due": due, "agent": agent, "subject": subject,
                                        "deadline": dl, "line": line, "sms": f"SLA warning {tid}: due {due} UTC"})
                    asserts += [{"type": "twilio_sms_sent", "to_number": to, "from_number": L.SMS_FROM,
                                 "body_contains": [f"SLA warning {tid}:", f"due {due} UTC"]},
                                {"type": "slack_message_exists", "channel_name": L.ESC,
                                 "text_contains": [f"{tid} |", f"due {due} UTC"]},
                                {"type": "gmail_message_sent", "to": L.MANAGER, "subject_contains": f"SLA warning {tid}",
                                 "body_contains": [f"{tid} |", f"due {due} UTC"]},
                                {"type": "google_sheets_row_cell_equals", "spreadsheet_id": L.TICKETS_SS,
                                 "worksheet_id": L.WS_OPEN, "row_id": rid, "column": "Warned Agent", "value": agent}]
                    sms_ever.add(tid)
                elif e[0] == "reassign":
                    _, tid, rid, to, due, agent = e
                    exp["reassign"].append({"tid": tid, "rid": rid, "to": to, "due": due, "agent": agent,
                                            "sms": f"SLA warning {tid}: due {due} UTC"})
                    asserts += [{"type": "twilio_sms_sent", "to_number": to, "from_number": L.SMS_FROM,
                                 "body_contains": [f"SLA warning {tid}:"]},
                                {"type": "google_sheets_row_cell_equals", "spreadsheet_id": L.TICKETS_SS,
                                 "worksheet_id": L.WS_OPEN, "row_id": rid, "column": "Warned Agent", "value": agent}]
                elif e[0] == "breach":
                    _, tid, rid = e
                    exp["breach"].append({"tid": tid, "rid": rid})
                    asserts += [{"type": "jira_issue_exists_with_summary", "summary": f"SLA breach {tid}",
                                 "project": L.JIRA_PROJECT},
                                {"type": "slack_message_exists", "channel_name": L.ESC, "text_contains": f"BREACHED {tid}"}]
                    breach_ever.add(tid)
                elif e[0] == "policy":
                    _, eff, value, who = e
                    exp["policy_rows"].append({"Effective": eff, "Parameter": L.PARAM, "Value": str(value),
                                               "Approved by": L.MANAGER})
                elif e[0] == "escalate":
                    if not exp["escalate"]:
                        asserts.append({"type": "slack_message_exists", "channel_name": L.SINK,
                                        "text_contains": trig["trigger"]})
                    exp["escalate"] = True
            # guards: decoys in their decision zone that must get nothing; AB negatives only where nothing was ever sent
            guards = []
            if ev["kind"] == "tick":
                acted = {e[1] for e in effs[i] if e[0] != "policy"}
                for s in states[i].values():
                    tk = by_tid[s["tid"]]
                    if s["tid"] in acted or s["D"] is None:
                        continue
                    decoy = (s["held"] and s["st"] in L.MONITORED) or s["st"] in ("waiting", "closed", "resolved") \
                        or "T-lookalike:id" in tk["traps"]
                    if not decoy or not (ev["t"] - timedelta(hours=1) < s["D"] <= ev["t"] + timedelta(minutes=180)):
                        continue
                    guards.append(s["tid"])
                    if s["tid"] not in sms_ever:
                        asserts.append({"type": "twilio_sms_not_sent", "body_contains": f"SLA warning {s['tid']}:"})
                    if s["D"] <= ev["t"] and s["tid"] not in breach_ever:
                        asserts.append({"type": "slack_message_not_exists", "channel_name": L.ESC,
                                        "text_contains": f"BREACHED {s['tid']}"})
            outcome = "act" if (exp["warn"] or exp["reassign"] or exp["breach"] or exp["policy_rows"]) else \
                "escalate" if exp["escalate"] else "no-op"
            truth.append({"trigger": trig["trigger"], "index": i + 1, "at": trig["at"], "kind": trig["kind"],
                          "sub": trig["sub"], "outcome": outcome, "expect": exp, "guards": sorted(guards),
                          "traps": trig["traps"], "needs_state": self.needs_state[i], "window": self.true["windows"][i],
                          "assertions": asserts})
        return truth

    def end_spec(self, truth: list[dict]) -> dict:
        """End-of-week expectations, graded at the last hourly check (Friday 17:00)."""
        final = self.true["state"]
        rows = {}
        for tk in self.tickets:           # ticket columns as the support team left them (records hold final values now)
            c = self.cells(tk, state=False)
            c.update(state_cells(final[tk["rid"]]))
            rows[tk["rid"]] = c
        counts: dict[str, dict] = {tk["tid"]: copy.deepcopy(EMPTY_COUNTS) for tk in self.tickets}
        for t in truth:
            for w in t["expect"]["warn"]:
                c = counts[w["tid"]]
                c["sms"].append(w["to"])
                c["warn_posts"] += 1
                c["emails"] += 1
            for w in t["expect"]["reassign"]:
                counts[w["tid"]]["sms"].append(w["to"])
            for b in t["expect"]["breach"]:
                counts[b["tid"]]["breach_posts"] += 1
                counts[b["tid"]]["jira"] += 1
        for c in counts.values():
            c["sms"] = sorted(c["sms"])
        policy_rows = [{"Effective": iso_date(e), "Parameter": L.PARAM, "Value": str(v), "Approved by": L.MANAGER}
                       for e, v, o in sorted(self.policy0, key=lambda x: x[2])]
        policy_rows += [r for t in truth for r in t["expect"]["policy_rows"]]
        hist_to = Counter(h["to"] for h in self.hist_sms)
        week_to = Counter(to for c in counts.values() for to in c["sms"])
        asserts = [{"type": "twilio_message_count", "to_number": to, "from_number": L.SMS_FROM,
                    "count": hist_to[to] + week_to[to]} for to in sorted(set(hist_to) | set(week_to))]
        hist_j = Counter(h["summary"] for h in self.hist_jira)
        for tid, c in sorted(counts.items()):
            s = f"SLA breach {tid}"
            asserts.append({"type": "jira_action_count", "action_key": "create_issue",
                            "params": {"summary": s, "project": L.JIRA_PROJECT}, "count": hist_j[s] + c["jira"]})
        return {"week_start": iso_z(self.start), "close": iso_z(self.close), "rows": rows,
                "row_order": [tk["rid"] for tk in self.tickets], "counts": counts, "policy_rows": policy_rows,
                "inbound_ids": sorted(self.inbound_ids), "assertions": asserts}

    # -- world0 -------------------------------------------------------------------------------------------------------
    def world0(self) -> dict:
        opened = {e["rid"] for e in self.events if e["kind"] == "ticket.opened"}
        w0 = [tk for tk in self.tickets if tk["rid"] not in opened]
        hist = sorted([tk for tk in w0 if tk["history"]], key=lambda tk: tk["tid"])
        cur = sorted([tk for tk in w0 if not tk["history"]], key=lambda tk: tk["tid"])
        open_rows = [{"id": tk["rid"], "row_id": i + 2, "cells": self.world0_cells[tk["rid"]]}
                     for i, tk in enumerate(hist + cur)]
        cfg = []
        if self.d == "d3":
            cfg.append(["Former Support Manager Email (until 2026-01-31)", L.FORMER_MANAGER])
        cfg += [["Support Manager Email", L.MANAGER], ["Escalation Channel", L.ESC], ["SMS From Number", L.SMS_FROM],
                ["Check Schedule", "Hourly, 10:00-17:00 UTC, Monday-Friday"], ["Jira Project", L.JIRA_PROJECT],
                ["Warning Window", "See the SLA Policy Log"]]
        cfg_rows = [{"id": f"cfg{i:02d}s{self.seed}", "row_id": i + 2, "cells": dict(zip(L.CONFIG_HEADERS, v))}
                    for i, v in enumerate(cfg)]
        hold_rows = [{"id": f"hold01s{self.seed}", "row_id": 2, "cells": {
            "Rule Name": "Legal Hold", "Condition": "Notes contain any LGL- reference code",
            "Action": "Send no SLA notification (SMS, Slack or email) and write nothing in the tracker for the ticket "
                      "until the code is removed from Notes",
            "Reference": "LGL-2026-021 (example)"}}]
        pol_rows = [{"id": f"pol{i:02d}s{self.seed}", "row_id": i + 2,
                     "cells": {"Effective": iso_date(e), "Parameter": L.PARAM, "Value": str(v), "Approved by": L.MANAGER}}
                    for i, (e, v, o) in enumerate(sorted(self.policy0, key=lambda x: x[2]))]
        sheets = [
            {"id": L.TICKETS_SS, "title": "Support Tickets", "worksheets": [
                {"id": L.WS_OPEN, "title": L.TITLES[L.WS_OPEN], "headers": L.OPEN_HEADERS, "rows": open_rows},
                {"id": L.WS_CONFIG, "title": L.TITLES[L.WS_CONFIG], "headers": L.CONFIG_HEADERS, "rows": cfg_rows},
                {"id": L.WS_HOLD, "title": L.TITLES[L.WS_HOLD], "headers": L.HOLD_HEADERS, "rows": hold_rows}]},
            {"id": L.POLICY_SS, "title": "SLA Policy Log", "worksheets": [
                {"id": L.WS_POLICY, "title": L.TITLES[L.WS_POLICY], "headers": L.POLICY_HEADERS, "rows": pol_rows}]},
        ]
        acct = "AC" + self.uid("abcdefghijklmnopqrstuvwxyz0123456789", 32)
        sms = []
        for h in sorted(self.hist_sms, key=lambda h: h["at"]):
            ts = h["at"].strftime("%Y-%m-%dT%H:%M:%S")
            sms.append({"sid": "SM" + self.uid("abcdefghijklmnopqrstuvwxyz0123456789", 32), "account_sid": acct,
                        "from_number": L.SMS_FROM, "to_number": h["to"], "body": h["body"], "status": "delivered",
                        "direction": "outbound-api", "date_created": ts, "date_updated": ts, "num_segments": 1,
                        "price": None, "price_unit": "USD"})
        users = [{"id": "U0SLAWATCH1", "username": "sla-watch", "name": "SLA Watch", "is_bot": True},
                 {"id": "U0SUPMGR001", "username": "morgan", "name": MANAGER_NAME, "email": L.MANAGER}]
        for k, (name, d10) in enumerate(sorted(self.agents)):
            users.append({"id": f"U0AGENT{k:04d}", "username": name.split()[0].lower(), "name": name,
                          "email": name.lower().replace(" ", ".") + f"@{L.ORG}"})
        posts = [dict(p) for p in self.hist_posts]
        posts.append({"channel": L.GENERAL, "user": "U0SUPMGR001", "at": self.monday - timedelta(days=4, hours=-9),
                      "text": "Reminder: keep SLA Deadline current when a customer agrees a new date, and note legal "
                              "holds with their LGL- code."})
        posts.append({"channel": L.GENERAL, "user": "U0AGENT0001", "at": self.monday - timedelta(days=3, hours=-14),
                      "text": "Heads up: the dashboard export is slow today, tickets may lag a bit."})
        msgs = []
        for i, p in enumerate(sorted(posts, key=lambda p: p["at"])):
            msgs.append({"id": f"M{self.seed}{i:04d}", "ts": f"{int(p['at'].timestamp())}.{100100 + i:06d}",
                         "channel_id": L.CHANNELS[p["channel"]], "user_id": p.get("user", "U0SLAWATCH1"),
                         "text": p["text"], "is_bot": "user" not in p})
        channels = [{"id": cid, "name": name, "is_private": False, "member_ids": [u["id"] for u in users],
                     "topic": {L.ESC: "SLA warnings and breaches", L.SINK: "Items the automations could not decide",
                               L.GENERAL: "Support team"}[name]} for name, cid in L.CHANNELS.items()]
        mails = []
        for h in sorted(self.hist_mail, key=lambda h: h["at"]):
            ms = int(h["at"].timestamp() * 1000)
            mails.append({"id": self.uid("0123456789abcdef", 16), "thread_id": self.uid("0123456789abcdef", 16),
                          "from_": L.INBOX, "to": [h["to"]], "subject": h["subject"], "body_plain": h["body"],
                          "date": ms, "internal_date": ms, "label_ids": ["SENT"], "is_read": True})
        ms = int((self.monday - timedelta(days=21, hours=-10)).timestamp() * 1000)
        mails.append({"id": self.uid("0123456789abcdef", 16), "thread_id": self.uid("0123456789abcdef", 16),
                      "from_": L.MANAGER, "from_name": MANAGER_NAME, "to": [L.INBOX, f"support-team@{L.ORG}"],
                      "subject": "Hourly SLA checks", "body_plain": "Team,\n\nThe SLA watch automation runs every hour "
                      "from 10:00 to 17:00 UTC on weekdays. Keep the tracker current.\n\nMorgan\n", "date": ms,
                      "internal_date": ms, "label_ids": ["INBOX"], "is_read": True})
        mails.sort(key=lambda m: m["date"])
        projects = [{"id": "jira_project_support", "action_key": "project",
                     "params": {"key": L.JIRA_PROJECT, "name": "Customer Support", "projectTypeKey": "service_desk"},
                     "created_at": "2025-06-02T09:00:00Z"},
                    {"id": "jira_project_ops", "action_key": "project",
                     "params": {"key": "OPS", "name": "Operations", "projectTypeKey": "software"},
                     "created_at": "2025-06-02T09:00:00Z"}]
        issues = [{"id": "jira_" + self.uid("0123456789abcdef", 32), "action_key": "create_issue",
                   "params": {"project": L.JIRA_PROJECT, "issuetype": "Task", "summary": h["summary"]},
                   "created_at": iso_z(h["at"])} for h in sorted(self.hist_jira, key=lambda h: h["at"])]
        return {
            "meta": {"schema_version": "0.1.0", "current_time": iso_z(self.start), "allowed_services": sorted(APPS)},
            "google_sheets": {"spreadsheets": sheets},
            "twilio": {"sms_messages": sms, "whatsapp_messages": [], "calls": []},
            "slack": {"channels": channels, "messages": msgs, "users": users},
            "gmail": {"messages": mails, "labels": [], "drafts": []},
            "jira": {"actions": {"project": projects, "create_issue": issues}, "issues": [], "projects": []},
        }

    # -- run ----------------------------------------------------------------------------------------------------------
    def run(self) -> dict:
        self.plan()
        self.compute_truth()
        triggers = self.stream()
        truth = self.compile_truth(triggers)
        end = self.end_spec(truth)
        world = self.world0()
        return {"world0": world, "triggers": triggers, "payloads": [t["payload"] for t in triggers], "truth": truth,
                "end": end, "world_traps": sorted(set(self.world_traps)),
                "stories": dict(sorted(Counter(tk["story"] for tk in self.tickets).items()))}


def state_cells(s: dict) -> dict:
    return {"Warned At": iso_z(s["warned_at"]) if s["warned_at"] else "",
            "Warned Agent": s["warned_agent"] or "",
            "Warned Deadline": iso_z(s["warned_deadline"]) if s["warned_deadline"] else "",
            "Breached At": iso_z(s["breached_at"]) if s["breached_at"] else ""}


def validate_world(world: dict) -> dict:
    """WorldState validation and the canonical dump; raises on an invalid world. Requires AutomationBench's venv."""
    from automationbench.schema.world import WorldState
    dumped = WorldState(**copy.deepcopy(world)).model_dump(mode="json")
    again = WorldState(**copy.deepcopy(dumped)).model_dump(mode="json")
    if canon(again) != canon(dumped):
        raise ValueError("world0 does not survive the dump -> load -> dump round trip")
    return dumped


def serve_input(seed: int, trigger: dict) -> dict:
    """The input row for `bridge.py serve --input <row> --world <world_t>` for ONE trigger: the family's apps only (so
    the allowed services are fixed), no assertions (the truth never enters the serve process), the api toolset, and
    meta.current_time = the trigger time (serve seeds its determinism shim from it, so the records an arm creates carry
    the check's time, which the oracle's timing check reads). The prompt holds only arm-visible text."""
    policy = (HERE / "POLICY.md").read_text()
    info = {"task_name": f"{FAMILY}.s{seed}.t{trigger['index']:02d}", "zapier_tools": [], "assertions": [],
            "initial_state": {"meta": {"schema_version": "0.1.0", "current_time": trigger["at"]},
                              **{a: {} for a in APPS}}}
    return {"example_id": trigger["index"],
            "prompt": [{"role": "system", "content": "standing automation " + FAMILY},
                       {"role": "user", "content": policy + "\n\nTrigger:\n" + canon(trigger["payload"])}],
            "answer": "", "info": json.dumps(info)}


def generate(seed: int, difficulty: str | None = None, validate: bool = True) -> dict:
    difficulty = difficulty or default_difficulty(seed)
    out = Gen(seed, difficulty).run()
    if validate:
        out["world0"] = validate_world(out["world0"])
    kinds, outcomes, traps, tkinds = Counter(), Counter(), Counter(), Counter()
    for t in out["truth"]:
        kinds[t["kind"]] += 1
        outcomes[t["outcome"]] += 1
        traps.update(t["traps"])
        tkinds.update({x.split(":")[0] for x in t["traps"]})
    n = len(out["truth"])
    ticks = [t for t in out["truth"] if t["kind"] == "tick"]
    out["meta"] = {"family": FAMILY, "version": VERSION, "seed": seed, "difficulty": difficulty,
                   "week": out["end"]["week_start"][:10], "n_triggers": n, "kinds": dict(sorted(kinds.items())),
                   "outcomes": dict(sorted(outcomes.items())),
                   "act_ticks": sum(1 for t in ticks if t["outcome"] == "act"),
                   "quiet_ticks": sum(1 for t in ticks if t["outcome"] == "no-op"),
                   "warnings": sum(len(t["expect"]["warn"]) for t in out["truth"]),
                   "reassign_sms": sum(len(t["expect"]["reassign"]) for t in out["truth"]),
                   "breaches": sum(len(t["expect"]["breach"]) for t in out["truth"]),
                   "escalations": sum(1 for t in out["truth"] if t["expect"]["escalate"]),
                   "needs_state": sum(1 for t in out["truth"] if t["needs_state"]),
                   "traps": dict(sorted(traps.items())), "trap_kinds": dict(sorted(tkinds.items())),
                   "trigger_trap_share": round(sum(1 for t in out["truth"] if t["traps"]) / max(1, n), 3),
                   "world_traps": out.pop("world_traps"), "stories": out.pop("stories")}
    return out


def write(out: dict, d: Path) -> dict:
    d.mkdir(parents=True, exist_ok=True)
    files = {"world0.json": json.dumps(out["world0"], sort_keys=True, ensure_ascii=False) + "\n",
             "payloads.jsonl": "".join(canon(p) + "\n" for p in out["payloads"]),
             "triggers.jsonl": "".join(canon(t) + "\n" for t in out["triggers"]),
             "truth.jsonl": "".join(canon(t) + "\n" for t in out["truth"]),
             "end.json": json.dumps(out["end"], sort_keys=True, indent=1) + "\n",
             "serve-inputs.jsonl": "".join(canon(serve_input(out["meta"]["seed"], t)) + "\n" for t in out["triggers"])}
    for name, text in files.items():
        (d / name).write_text(text)
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
    if 8801 <= a.seed <= 8840:
        sys.exit("held-out seeds are generated only by the preregistered runner, never by hand")
    meta = write(generate(a.seed, a.difficulty, validate=not a.no_validate), Path(a.out))
    print(canon({k: v for k, v in meta.items() if k != "sha256"}))


if __name__ == "__main__":
    main()
