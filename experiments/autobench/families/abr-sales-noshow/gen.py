#!/usr/bin/env python3
"""abr-sales-noshow: seeded stream generator (AutomationBench-R, research/automationbench-20261014/RECURRING-DESIGN.md
§3.2, §4.2). Runs inside AutomationBench's own venv (it validates worlds with AutomationBench's WorldState):

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-sales-noshow/gen.py \
        --seed 610 [--difficulty d2] --out HOSTDIR

Writes into HOSTDIR (host-only; nothing generated is committed):
  world0.json      the initial world (WorldState dump; arms see it only through the tools)
  payloads.jsonl   the arm-visible trigger payloads, one per line, in order
  triggers.jsonl   host-only: payload + delta (world ops applied before the trigger) + kind + variant + traps
  truth.jsonl      host-only: per trigger, the expected outcome, effects, guards and AutomationBench assertion dicts
  end.json         host-only: the end-of-week expectations (graded at the week-close trigger)
  serve-inputs.jsonl one input row per trigger for `bridge.py serve --input <row> --world world_t.json`
                   (assertions: [], current_time = trigger time; see serve_input)
  meta.json        family, version, seed, difficulty, counts and sha256 of every file

Determinism: one random.Random(f"{family}:{version}:{seed}:{difficulty}"); no wall clock, no set iteration, every
datetime field of every record is written explicitly, so no pydantic default factory ever fires.

The truth is computed from the generator's own canonical model of the business (entities, the trigger timeline, and
the state after correct handling of every earlier trigger), never from a solver's output. The reference solver
(reference.py) is a separate implementation that sees only the payload, POLICY.md and the tools.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

FAMILY = "abr-sales-noshow"
VERSION = "1.1.0"       # 1.1.0: no duplicate report after a retraction of the same no-show; no repeat history on
                        # the calendar day 14 days before an act (both asserted in compute_truth). Streams differ from 1.0.0
HERE = Path(__file__).resolve().parent
UTC = timezone.utc

INTERNAL_DOMAIN = "company.example.com"
THRESHOLD = 50_000
WINDOW = timedelta(hours=3)
REPEAT_WINDOW = timedelta(days=14)
APPS = ("calendly", "salesforce", "slack")
SUBJECT_PREFIX = "Follow up on missed call - "
RETRACT_SUFFIX = " | Retracted: joined late"
ALERTS, REVIEW = "sales-alerts", "automation-review"
# Probability that a handled report gets planted traps. Chatter, internal, duplicate and escalation reports are traps
# by construction, so these per-report rates put the share of trap-bearing TRIGGERS near the design's 40% (d2) and
# 70% (d3): measured over seeds 601-650, 0.43 (d2) and 0.72 (d3); gen meta reports the share per stream.
TRAP_RATE = {"d1": 0.0, "d2": 0.15, "d3": 0.6}
# Probability that a retraction names a person who has a same-surname look-alike at another account with an OPEN
# follow-up task for an event of the same name (T-lookalike:retraction-surname): the first name decides.
RETRACT_LOOKALIKE_RATE = {"d1": 0.0, "d2": 0.5, "d3": 0.7}

# ---------------------------------------------------------------------------------------------------------------
# Fictional pools (no real person or organization; every domain is *.example.com)
# ---------------------------------------------------------------------------------------------------------------
FIRST = ["Jennifer", "Carlos", "Priya", "Marcus", "Elena", "Tomas", "Aisha", "Daniel", "Mei", "Oliver", "Sofia",
         "Rahul", "Grace", "Liam", "Nadia", "Victor", "Hannah", "Diego", "Ingrid", "Kwame", "Laura", "Samuel", "Yuki",
         "Fatima", "Ethan", "Chloe", "Mateo", "Zara", "Henry", "Ines", "Leo", "Amara", "Felix", "Rosa", "Noah",
         "Keiko", "Omar", "Clara", "Jonas", "Lucia", "Arjun", "Megan", "Pavel", "Selin", "Bruno", "Tara", "Hugo",
         "Maya"]
LAST = ["Martinez", "Chen", "Okafor", "Novak", "Silva", "Patel", "Kowalski", "Larsen", "Haddad", "Moreau", "Tanaka",
        "Brennan", "Ivanova", "Mendes", "Osei", "Fischer", "Rossi", "Nguyen", "Byrne", "Sato", "Alvarez", "Dubois",
        "Kim", "Nakamura", "Petrov", "Quinn", "Reyes", "Sorensen", "Varga", "Walsh"]
COMPANIES = [("Crestview Industries", "crestview", "Manufacturing"), ("NovaGen Labs", "novagen", "Biotech"),
             ("Harborline Logistics", "harborline", "Logistics"), ("Copperleaf Health", "copperleaf", "Healthcare"),
             ("Lumengrid Energy", "lumengrid", "Energy"), ("Orchard Lane Foods", "orchardlane", "Food & Beverage"),
             ("Tidewater Marine Supply", "tidewater-marine", "Wholesale"),
             ("Granite Peak Software", "granitepeak", "Software"), ("Brightwell Learning", "brightwell", "Education"),
             ("Quarrystone Builders", "quarrystone", "Construction"), ("Meadowbrook Retail Group", "meadowbrook", "Retail"),
             ("Juniper Bay Hotels", "juniperbay", "Hospitality"), ("Vantage Point Robotics", "vantagept", "Robotics"),
             ("Kestrel Aviation Services", "kestrel-av", "Aviation"), ("Pinecrest Dental Group", "pinecrest-dental", "Healthcare"),
             ("Fernhollow Analytics", "fernhollow", "Software"), ("Saltmarsh Media", "saltmarsh", "Media"),
             ("Ridgeback Fabrication", "ridgeback-fab", "Manufacturing"), ("Larkspur Insurance", "larkspur-ins", "Insurance"),
             ("Wrenford Partners", "wrenford", "Consulting"), ("Galeway Energy", "galeway", "Energy"),
             ("Thornfield Assurance", "thornfield", "Insurance")]
TITLES = ["VP of Procurement", "Director of IT", "Head of Operations", "CFO", "Operations Manager", "IT Manager",
          "Purchasing Lead", "COO", "Director of Finance", "Engineering Manager", "Head of Sales Ops"]
EVENT_NAMES = ["Product Demo", "Discovery Call", "Pricing Review", "Technical Deep Dive", "Security Review",
               "Onboarding Kickoff", "Executive Briefing", "Renewal Check-in", "Implementation Planning", "Intro Call",
               "Solution Workshop", "Proof of Concept Review"]
INTERNAL_EVENTS = ["Pipeline Review", "Forecast Sync", "Deal Strategy Session", "Territory Planning"]
REPS = [("Riley", "Park"), ("Jordan", "Ames"), ("Casey", "Lindqvist"), ("Morgan", "Tate"), ("Avery", "Cole"),
        ("Quinn", "Halvorsen")]
SALES_OPS = ("Dana", "Whitfield")
PRODUCTS = ["Enterprise License", "Support Contract", "Platform Expansion", "Pilot", "Renewal", "Analytics Add-on",
            "Training Package", "Multi-year Agreement"]
OPEN_STAGES = ["Prospecting", "Qualification", "Proposal", "Negotiation"]
AMOUNTS = [8000, 12000, 15000, 18500, 22000, 25000, 30000, 35000, 40000, 45000, 48000, 52000, 60000, 65000, 75000,
           85000, 90000, 110000, 120000, 140000, 175000]
SMALL = [a for a in AMOUNTS if a < THRESHOLD]
MID = [52000, 55000, 60000, 65000, 72000, 75000, 80000, 85000, 90000, 95000]   # >= new threshold, < old $100,000
BIG = [a for a in AMOUNTS if a >= THRESHOLD]
NOISE_TASKS = ["Send proposal", "Schedule onboarding call", "Call back about renewal", "Share security documentation",
               "Prepare pricing options", "Confirm contract signatory"]
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

# Report, retraction and chatter text. Chatter never uses the report or retraction wording of POLICY.md section 1/3.
REPORT_T = [
    "No-show: {email} missed {event} at {hhmm} UTC.",
    "Hey team, we had a no-show today. The invitee was {email} - can someone follow up?",
    "{name} ({email}) didn't show for the {event}. Logging it here.",
    "No-show on my {hhmm} UTC call: {email} never joined.",
]
REPORT_LOCAL_T = "No-show: {email} missed the {event} at {local} ET."
DUPLICATE_T = ["+1, {email} never joined the {event} today either.", "Also flagging: {email} was a no-show for the {event}."]
RETRACT_T = [
    "False alarm on the {event} - {name} joined late.",
    "Update: {name} did join the {event}, about 15 minutes late. Not a no-show.",
    "Scratch my earlier no-show: {name} ({email}) joined the {event} late.",
]
CHATTER_T = [
    "Deal closed! {email} signed the contract.",
    "{email} rescheduled the {event} to {weekday}.",
    "Can someone send {name} ({email}) the security questionnaire?",
    "Great {event} with {email} this morning - they want pricing for 50 seats.",
    "{name} ({email}) confirmed for the {event} on {weekday}.",
    "Heads up: {email} asked to add a colleague to the next call.",
]

ACT_TRAPS = ["T-repeat:cancelled-in-window", "T-repeat:older-event", "T-repeat:later-today", "T-lookalike:surname",
             "T-lookalike:colleague", "T-stale:threshold", "T-stale:closed-big", "T-boundary:50k", "T-format:offset",
             "T-format:email-case", "T-format:localtime", "T-history:repeat", "T-history:repeat-completed",
             "T-history:old", "T-history:retracted"]
# Trap groups for the FIRST trap of a trapped report. Groups are dealt round-robin from a per-stream shuffled order,
# so every group recurs in every few trapped reports (each trap kind >= 5 times across the four dev label streams,
# RECURRING-DESIGN §3.11 gate 4) instead of a group with two members surfacing a third as often as one with four.
TRAP_GROUPS = {
    "T-repeat": ["T-repeat:cancelled-in-window", "T-repeat:older-event", "T-repeat:later-today"],
    "T-lookalike": ["T-lookalike:surname", "T-lookalike:colleague"],
    "T-stale": ["T-stale:threshold", "T-stale:closed-big", "T-boundary:50k"],
    "T-format": ["T-format:offset", "T-format:email-case", "T-format:localtime"],
    "T-history": ["T-history:repeat", "T-history:repeat-completed", "T-history:old", "T-history:retracted"],
}
OPP_TRAPS = {"T-stale:threshold", "T-stale:closed-big", "T-boundary:50k"}
HISTORY_TRAPS = {"T-history:repeat", "T-history:repeat-completed", "T-history:old", "T-history:retracted"}
TEXT_TRAPS = {"T-format:email-case", "T-format:localtime"}
TRAP_KINDS = ["T-lookalike", "T-stale", "T-note", "T-format", "T-repeat"]


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256((obj if isinstance(obj, str) else canon(obj)).encode("utf-8")).hexdigest()


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def cal_time(dt: datetime, offset_h: int | None = None) -> str:
    """Calendly start/end strings: UTC as +00:00, or (format trap) the same instant written with a US Eastern offset."""
    if offset_h is None:
        return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    local = dt.astimezone(UTC) + timedelta(hours=offset_h)
    return local.strftime("%Y-%m-%dT%H:%M:%S") + f"-{abs(offset_h):02d}:00"


def et_offset(dt: datetime) -> int:
    """US Eastern offset for 2026 (DST from 2026-03-08 to 2026-11-01)."""
    d = dt.astimezone(UTC).date()
    return -4 if date(2026, 3, 8) <= d < date(2026, 11, 1) else -5


def money(n: int) -> str:
    return f"${n:,}"


def scheduled(dt: datetime) -> str:
    return f"Scheduled: {dt.astimezone(UTC):%Y-%m-%d %H:%M} UTC"


def description(start: datetime, pipeline: int, repeat: bool) -> str:
    return f"{scheduled(start)} | Account pipeline: {money(pipeline)}" + (" | Repeat no-show" if repeat else "")


def near_repeat_boundary(start: datetime, prior_start: datetime) -> bool:
    """POLICY.md 2.7 counts earlier no-shows 'that started in the 14 days before this event's start'. Read as elapsed
    time (the truth: start - 14 days <= prior < start) or as calendar days, the readings can differ only when the
    earlier start lies on the calendar day 14 days before, or within 12 hours of the exact boundary. The generator
    never places a prior no-show there, so the repeat verdict is the same under either reading."""
    s, q = start.astimezone(UTC), prior_start.astimezone(UTC)
    return (s.date() - q.date()).days == 14 or abs((s - q) - REPEAT_WINDOW) < timedelta(hours=12)


def default_difficulty(seed: int) -> str:
    """Within each seed block (RECURRING-DESIGN §3.9) the first seed is d2, then d2/d3 alternate."""
    starts = [601, 610, 614, 622, 631, 8801, 8805, 8825, 8837]
    start = max([s for s in starts if s <= seed], default=seed)
    return "d2" if (seed - start) % 2 == 0 else "d3"


class Gen:
    def __init__(self, seed: int, difficulty: str):
        if difficulty not in TRAP_RATE:
            raise ValueError(f"difficulty must be d1, d2 or d3 (got {difficulty!r})")
        self.seed, self.d = int(seed), difficulty
        self.r = random.Random(f"{FAMILY}:{VERSION}:{self.seed}:{difficulty}")
        self.ids: set[str] = set()
        self.names: set[str] = set()
        self.emails: set[str] = set()
        self.times: set[str] = set()
        mondays = [date(2026, 2, 2) + timedelta(weeks=k) for k in range(60)]
        mondays = [m for m in mondays if m <= date(2026, 11, 23)]
        self.monday = datetime.combine(self.r.choice(mondays), time(0, 0), tzinfo=UTC)
        self.week_close = self.monday + timedelta(days=4, hours=17)
        self.accounts, self.contacts, self.opps = [], [], []
        self.events, self.invitees, self.tasks, self.messages = [], [], [], []
        self.plans = []          # planned triggers (canonical model), sorted by time later
        self.prior = {}          # email -> [{"start", "event", "contact_id", "report_at", "retract_at"}] (history + week)
        self.target_contacts: set[str] = set()
        self.group_order: list[str] = []      # round-robin deal of trap groups (TRAP_GROUPS)

    # -- ids and names ---------------------------------------------------------------------------------------------
    def _uid(self, alphabet: str, n: int, prefix: str = "") -> str:
        while True:
            v = prefix + "".join(self.r.choice(alphabet) for _ in range(n))
            if v not in self.ids:
                self.ids.add(v)
                return v

    def sf_id(self, prefix: str) -> str:
        return self._uid("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 15, prefix)

    def cal_id(self) -> str:
        return self._uid("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 16)

    def slack_id(self, prefix: str) -> str:
        return self._uid("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 10, prefix)

    def ts(self, at: datetime) -> str:
        while True:
            v = f"{int(at.timestamp())}.{self.r.randint(100000, 999999):06d}"
            if v not in self.ids:
                self.ids.add(v)
                return v

    def person(self, last: str | None = None):
        for _ in range(10_000):
            first = self.r.choice(FIRST)
            ln = last or self.r.choice(LAST)
            full = f"{first} {ln}"
            if full not in self.names:
                self.names.add(full)
                return first, ln
        raise RuntimeError("name pool exhausted")

    def unique_time(self, at: datetime) -> datetime:
        at = at.replace(microsecond=0)
        while iso_z(at) in self.times:
            at += timedelta(seconds=37)
        self.times.add(iso_z(at))
        return at

    # -- world entities ----------------------------------------------------------------------------------------------
    def build_people(self):
        r = self.r
        self.reps = []
        for first, last in REPS + [SALES_OPS]:
            self.names.add(f"{first} {last}")
            email = f"{first.lower()}.{last.lower()}@{INTERNAL_DOMAIN}"
            self.emails.add(email)
            self.reps.append({"first": first, "last": last, "name": f"{first} {last}", "email": email,
                              "slack": self.slack_id("U"), "cal": self.cal_id()})
        self.sales_ops = self.reps.pop()           # posts policy messages only, never reports
        n_acc = 16 if self.d == "d3" else 14
        companies = r.sample(COMPANIES, n_acc)
        for name, slug, industry in companies:
            acc = {"id": self.sf_id("001"), "name": name, "domain": f"{slug}.example.com", "industry": industry,
                   "created": self.monday - timedelta(days=r.randint(200, 900))}
            self.accounts.append(acc)
            for _ in range(r.choice([2, 2, 3])):
                self.add_contact(acc)
            n_open = r.choices([0, 1, 2, 3], weights=[15, 35, 35, 15])[0]
            for _ in range(n_open):
                self.add_opp(acc, r.choice(AMOUNTS), open_=True)
            for _ in range(r.choice([0, 0, 1, 2])):
                self.add_opp(acc, r.choice(AMOUNTS), open_=False)

    def add_contact(self, acc, first=None, last=None):
        if first is None:
            first, last = self.person(last)
        email = f"{first.lower()}.{last.lower()}@{acc['domain']}"
        if email in self.emails:
            return None
        self.emails.add(email)
        c = {"id": self.sf_id("003"), "first": first, "last": last, "name": f"{first} {last}", "email": email,
             "account_id": acc["id"], "account_name": acc["name"], "title": self.r.choice(TITLES),
             "created": acc["created"] + timedelta(days=self.r.randint(1, 150))}
        self.contacts.append(c)
        return c

    def add_opp(self, acc, amount: int, open_: bool):
        r = self.r
        stage = r.choice(OPEN_STAGES) if open_ else r.choice(["Closed Won", "Closed Lost"])
        o = {"id": self.sf_id("006"), "name": f"{acc['name'].split()[0]} - {r.choice(PRODUCTS)}", "stage": stage,
             "amount": int(amount), "account_id": acc["id"], "open": open_,
             "close": self.monday + timedelta(days=r.randint(-120, -10) if not open_ else r.randint(10, 120)),
             "created": acc["created"] + timedelta(days=r.randint(10, 150))}
        self.opps.append(o)
        return o

    def acc_of(self, contact):
        return next(a for a in self.accounts if a["id"] == contact["account_id"])

    def open_opps(self, acc_id: str):
        return [o for o in self.opps if o["account_id"] == acc_id and o["open"]]

    def add_event(self, name: str, start: datetime, host, minutes: int = 30, status: str = "active",
                  offset_h: int | None = None):
        eid = self.cal_id()
        e = {"id": eid, "name": name, "start": start, "end": start + timedelta(minutes=minutes), "status": status,
             "host": host["cal"], "offset": offset_h, "booked": start - timedelta(days=self.r.randint(2, 12),
                                                                              minutes=self.r.randint(0, 600))}
        self.events.append(e)
        return e

    def add_invitee(self, event, person, status: str | None = None, no_show_at: datetime | None = None):
        iid = self.cal_id()
        inv = {"id": iid, "event_id": event["id"], "email": person["email"], "name": person["name"],
               "first": person["first"], "last": person["last"],
               "status": status or ("canceled" if event["status"] == "canceled" else "active"),
               "no_show": no_show_at is not None, "marked_at": no_show_at, "created": event["booked"]}
        self.invitees.append(inv)
        return inv

    def add_task(self, subject, contact_id, desc, status, priority, created):
        t = {"id": self.sf_id("00T"), "subject": subject, "contact_id": contact_id, "description": desc,
             "status": status, "priority": priority, "created": created}
        self.tasks.append(t)
        return t

    def add_message(self, channel: str, user, text: str, at: datetime):
        m = {"id": self.slack_id("M"), "channel": channel, "user": user["slack"], "text": text, "at": at, "ts": self.ts(at)}
        self.messages.append(m)
        return m

    # -- history (previous weeks) ------------------------------------------------------------------------------------
    def pipeline_of(self, acc_id: str) -> int:
        return sum(o["amount"] for o in self.open_opps(acc_id))

    def add_history_noshow(self, contact, start: datetime, retracted: bool = False, completed: bool = False,
                           event_name: str | None = None):
        """A no-show handled in an earlier week: flagged invitee, its follow-up task, the old report message."""
        r = self.r
        host = r.choice(self.reps)
        ev = self.add_event(event_name or r.choice(EVENT_NAMES), start, host, r.choice([30, 60]))
        report_at = start + timedelta(minutes=r.randint(15, 120), seconds=r.randint(0, 59))
        self.add_invitee(ev, contact, no_show_at=report_at)
        acc = self.acc_of(contact)
        pipe = self.pipeline_of(acc["id"])
        prio = "High" if any(o["amount"] >= THRESHOLD for o in self.open_opps(acc["id"])) else "Normal"
        desc = description(start, pipe, False)
        status = "Not Started"
        if retracted:
            desc, status = desc + RETRACT_SUFFIX, "Completed"
        elif completed:
            status = "Completed"
        self.add_task(SUBJECT_PREFIX + ev["name"], contact["id"], desc, status, prio, report_at)
        rep = r.choice(self.reps)
        self.add_message(ALERTS, rep, r.choice(REPORT_T[:1] + REPORT_T[2:3]).format(
            email=contact["email"], event=ev["name"], hhmm=f"{start:%H:%M}", name=contact["name"]), report_at)
        if retracted:
            self.add_message(ALERTS, rep, RETRACT_T[0].format(event=ev["name"], name=contact["name"]),
                             report_at + timedelta(minutes=r.randint(5, 50)))
        self.prior.setdefault(contact["email"], []).append(
            {"start": start, "event": ev["name"], "contact_id": contact["id"], "report_at": report_at,
             "retract_at": (report_at + timedelta(minutes=1)) if retracted else None})
        return ev

    # -- the week ----------------------------------------------------------------------------------------------------
    def slot(self, day: int, latest_start: time = time(15, 30)) -> datetime:
        base = self.monday + timedelta(days=day, hours=8)
        n = int((datetime.combine(date.min, latest_start) - datetime.combine(date.min, time(8, 0))).total_seconds() // 1800)
        return base + timedelta(minutes=30 * self.r.randint(0, n))

    def report_time(self, start: datetime, day: int) -> datetime:
        r = self.r
        limit = (self.monday + timedelta(days=day, hours=16, minutes=50)) if day == 4 else \
            (self.monday + timedelta(days=day, hours=18, minutes=30))
        hi = min(170, int((limit - start).total_seconds() // 60))
        return self.unique_time(start + timedelta(minutes=r.randint(10, max(10, hi)), seconds=r.randint(0, 59)))

    def free_contacts(self):
        return [c for c in self.contacts if c["id"] not in self.target_contacts]

    def pick_target(self, used_accounts: set):
        pool = [c for c in self.free_contacts() if c["account_id"] not in used_accounts] or self.free_contacts()
        c = self.r.choice(pool)
        self.target_contacts.add(c["id"])
        used_accounts.add(c["account_id"])
        return c

    def plan_week(self):
        r, d = self.r, self.d
        if d == "d1":
            n_rep, n_chat, n_ret, n_int, n_dup, n_esc, n_rep_week = 10, 3, 1, 0, 0, 0, 0
        elif d == "d2":
            n_rep, n_chat, n_ret = r.randint(10, 14), r.randint(3, 4), r.randint(1, 2)
            n_int, n_dup, n_esc, n_rep_week = r.randint(0, 1), r.randint(0, 1), r.randint(0, 1), r.randint(0, 1)
        else:
            n_rep, n_chat, n_ret = r.randint(14, 16), r.randint(4, 5), r.randint(2, 3)
            n_int, n_dup, n_esc, n_rep_week = 1, 1, r.randint(1, 2), r.randint(1, 2)
        n_act = n_rep - n_int - n_dup - n_esc
        used_acc: set = set()
        days = [i % 5 for i in range(n_act - n_rep_week)]
        r.shuffle(days)
        acts = []
        for day in sorted(days):
            acts.append(self.plan_act(self.pick_target(used_acc), day))
        for _ in range(n_rep_week):        # the same invitee no-shows again later in the week (cross-trigger state)
            # the repeat's day avoids the calendar day 14 days after any earlier no-show of the invitee: history is
            # placed relative to the base act, so a later day could otherwise land on the 14-day boundary
            opts = {id(a): [x for x in range(a["day"] + 1, 5) if self.repeat_day_clear(a["contact"], x)]
                    for a in acts if a["day"] < 4 and not a.get("repeat_base")}
            bases = [a for a in acts if opts.get(id(a))]
            if not bases:                  # (never on seeds 601-650) keep the report count: an ordinary act instead
                acts.append(self.plan_act(self.pick_target(used_acc), r.randint(0, 4)))
                continue
            base = r.choice(bases)
            base["repeat_base"] = True
            acts.append(self.plan_act(base["contact"], r.choice(opts[id(base)]), in_week_repeat=True))
        self.acts = acts
        for _ in range(n_esc):
            self.plan_escalation(used_acc)
        for _ in range(n_int):
            self.plan_internal()
        for _ in range(n_dup):
            self.plan_duplicate(acts)
        # a retraction comes after any duplicate report of the same no-show (a "+1, X never joined" after "X joined
        # late, not a no-show" would be an incoherent story that invites a fair escalation), so it needs room after it
        ret_ok = [a for a in acts if self.retraction_room(a) >= 6]
        for a in r.sample(ret_ok, min(n_ret, len(ret_ok))):
            self.plan_retraction(a)
        for _ in range(n_chat):
            self.plan_chatter()
        self.plans.append({"kind": "week.close", "variant": "week_close", "at": self.unique_time(self.week_close),
                           "traps": []})

    def repeat_day_clear(self, contact, day: int) -> bool:
        """No earlier no-show of the contact lies on the calendar day 14 days before `day` of this week."""
        d = (self.monday + timedelta(days=day)).date()
        return all((d - q["start"].astimezone(UTC).date()).days != 14 for q in self.prior.get(contact["email"], []))

    def plan_act(self, contact, day: int, in_week_repeat: bool = False):
        r = self.r
        traps = []
        if in_week_repeat:
            traps.append("T-repeat:in-week")
        elif r.random() < TRAP_RATE[self.d]:
            k = 1 if self.d == "d2" and r.random() < 0.75 else r.randint(1, 3 if self.d == "d3" else 2)
            if not self.group_order:
                self.group_order = sorted(TRAP_GROUPS)
                r.shuffle(self.group_order)
            traps.append(r.choice(TRAP_GROUPS[self.group_order.pop()]))
            pool = [t for t in ACT_TRAPS if t not in traps]
            while len(traps) < k and pool:
                t = r.choice(pool)
                pool.remove(t)
                if (t in OPP_TRAPS and OPP_TRAPS & set(traps)) or (t in HISTORY_TRAPS and HISTORY_TRAPS & set(traps)):
                    continue
                traps.append(t)
        latest = time(14, 0) if day == 4 else time(15, 30)
        start = self.slot(day, latest)
        offset = et_offset(start) if "T-format:offset" in traps else None
        host = r.choice(self.reps)
        ev = self.add_event(r.choice(EVENT_NAMES), start, host, r.choice([30, 60]), offset_h=offset)
        inv = self.add_invitee(ev, contact)
        at = self.report_time(start, day)
        reporter = r.choice(self.reps)
        act = {"kind": "noshow.reported", "variant": "act", "contact": contact, "event": ev, "invitee": inv,
               "day": day, "at": at, "reporter": reporter, "traps": traps, "decoys": []}
        self.apply_act_traps(act)
        text_t = REPORT_LOCAL_T if "T-format:localtime" in traps else r.choice(REPORT_T)
        email = contact["email"]
        if "T-format:email-case" in traps:
            email = contact["first"] + "." + contact["last"] + "@" + contact["email"].split("@")[1].capitalize()
        local = start + timedelta(hours=et_offset(start))
        act["text"] = text_t.format(email=email, event=ev["name"], hhmm=f"{start:%H:%M}", name=contact["name"],
                                    local=f"{local.hour}:{local:%M}")
        self.plans.append(act)
        return act

    def apply_act_traps(self, act):
        r, c, ev, at, traps = self.r, act["contact"], act["event"], act["at"], act["traps"]
        acc = self.acc_of(c)
        day0 = self.monday + timedelta(days=act["day"])
        for t in list(traps):
            if t == "T-repeat:cancelled-in-window":
                lo = max(at - WINDOW + timedelta(minutes=5), day0 + timedelta(hours=8))
                span = int((at - timedelta(minutes=5) - lo).total_seconds() // 60)
                if span < 5:
                    traps.remove(t)
                    continue
                s = lo + timedelta(minutes=r.randint(0, span))
                s = s.replace(second=0)
                dec = self.add_event(r.choice(EVENT_NAMES), s, r.choice(self.reps), 30, status="canceled")
                act["decoys"].append(self.add_invitee(dec, c)["id"])
            elif t == "T-repeat:older-event":
                # an attended (unflagged) meeting on an earlier day: this week before the report day, or last week
                days = list(range(act["day"])) + [-7, -6, -5, -4, -3]
                s = self.slot(r.choice(days))
                dec = self.add_event(r.choice(EVENT_NAMES), s, r.choice(self.reps), 30)
                act["decoys"].append(self.add_invitee(dec, c)["id"])
            elif t == "T-repeat:later-today":
                s = at + timedelta(minutes=r.randint(20, 120))
                s = s.replace(minute=0 if s.minute < 30 else 30, second=0) + timedelta(minutes=30)
                dec = self.add_event(r.choice(EVENT_NAMES), s, r.choice(self.reps), 30)
                act["decoys"].append(self.add_invitee(dec, c)["id"])
                act["later_start"] = s       # a duplicate report must come before it starts (plan_duplicate)
            elif t == "T-lookalike:surname":
                busy = {x["account_id"] for x in self.contacts if x["id"] in self.target_contacts}
                others = [a for a in self.accounts if a["id"] != acc["id"] and a["id"] not in busy] or \
                    [a for a in self.accounts if a["id"] != acc["id"]]
                oacc = r.choice(others)
                look = None
                for _ in range(50):
                    first, last = self.person(c["last"])
                    look = self.add_contact(oacc, first, last)
                    if look:
                        break
                if look is None:
                    traps.remove(t)
                    continue
                self.add_opp(oacc, r.choice(BIG), open_=True)
                act["lookalike"] = look["id"]
            elif t == "T-lookalike:colleague":
                mates = [x for x in self.contacts if x["account_id"] == acc["id"] and x["id"] != c["id"]
                         and x["id"] not in self.target_contacts]
                if not mates:
                    mate = self.add_contact(acc)
                    if mate is None:
                        traps.remove(t)
                        continue
                else:
                    mate = r.choice(mates)
                self.target_contacts.add(mate["id"])     # never a target or background invitee elsewhere
                act["decoys"].append(self.add_invitee(ev, mate)["id"])
            elif t == "T-stale:threshold":
                for o in self.open_opps(acc["id"]):
                    o["amount"] = r.choice(SMALL)
                self.add_opp(acc, r.choice(MID), open_=True)
            elif t == "T-stale:closed-big":
                for o in self.open_opps(acc["id"]):
                    o["amount"] = r.choice(SMALL)
                self.add_opp(acc, r.choice(BIG), open_=False)
            elif t == "T-boundary:50k":
                for o in self.open_opps(acc["id"]):
                    o["amount"] = r.choice(SMALL)
                self.add_opp(acc, THRESHOLD, open_=True)
            elif t in HISTORY_TRAPS:
                # before Monday; a weekend landing moves up to 2 days earlier, so repeat history stays <= 13 calendar
                # days before THIS act and old history >= 16. A later in-week repeat of the same invitee sees this
                # history up to 4 days further back; plan_week keeps that repeat off the 14-day boundary
                # (near_repeat_boundary, asserted for every act in compute_truth)
                min_days = max(3, act["day"] + 1)
                k = r.randint(16, 24) if t == "T-history:old" else r.randint(min_days, 11)
                s = (ev["start"] - timedelta(days=k)).replace(minute=0 if r.random() < 0.5 else 30)
                if s.weekday() >= 5:
                    s -= timedelta(days=s.weekday() - 4)
                same_name = r.random() < 0.4
                self.add_history_noshow(c, s, retracted=t == "T-history:retracted",
                                        completed=t == "T-history:repeat-completed",
                                        event_name=ev["name"] if same_name else None)

    def plan_escalation(self, used_acc: set):
        r = self.r
        variant = r.choice(["escalate:cancelled-only", "escalate:no-contact"])
        day = r.randint(0, 4)
        start = self.slot(day, time(14, 0) if day == 4 else time(15, 30))
        at = self.report_time(start, day)
        host = r.choice(self.reps)
        if variant == "escalate:cancelled-only":
            c = self.pick_target(used_acc)
            ev = self.add_event(r.choice(EVENT_NAMES), start, host, 30, status="canceled")
            inv = self.add_invitee(ev, c)
            if r.random() < 0.5:   # plus an older active event on another day
                o = self.add_event(r.choice(EVENT_NAMES), start - timedelta(days=r.randint(1, 6)), host, 30)
                self.add_invitee(o, c)
            person = c
        else:
            acc = r.choice(self.accounts)
            first, last = self.person()
            email = f"{first.lower()}.{last.lower()}@{acc['domain']}"
            self.emails.add(email)
            person = {"first": first, "last": last, "name": f"{first} {last}", "email": email}
            ev = self.add_event(r.choice(EVENT_NAMES), start, host, 30)
            inv = self.add_invitee(ev, person)
        text = r.choice(REPORT_T).format(email=person["email"], event=ev["name"], hhmm=f"{start:%H:%M}",
                                         name=person["name"])
        self.plans.append({"kind": "noshow.reported", "variant": variant, "at": at, "reporter": r.choice(self.reps),
                           "text": text, "invitee": inv, "traps": ["T-note:" + variant.split(":")[1]],
                           "decoys": [inv["id"]]})

    def plan_internal(self):
        r = self.r
        day = r.randint(0, 4)
        start = self.slot(day, time(14, 0) if day == 4 else time(15, 30))
        at = self.report_time(start, day)
        host, mate, reporter = r.sample(self.reps, 3)
        ev = self.add_event(r.choice(INTERNAL_EVENTS), start, host, 30)
        inv = self.add_invitee(ev, mate)
        text = r.choice(REPORT_T[:1] + REPORT_T[2:]).format(email=mate["email"], event=ev["name"],
                                                             hhmm=f"{start:%H:%M}", name=mate["name"])
        self.plans.append({"kind": "noshow.reported", "variant": "internal", "at": at, "reporter": reporter,
                           "text": text, "invitee": inv, "traps": ["T-note:internal"], "decoys": [inv["id"]]})

    def plan_duplicate(self, acts):
        """A second rep reports the same no-show while the meeting is still inside the 3-hour window (outside it, the
        policy would make the report an escalation, not a duplicate)."""
        r = self.r

        def room(a):          # minutes left after the first report, inside the window and before the day's end
            end = a["event"]["start"] + WINDOW - timedelta(minutes=2)
            if a["day"] == 4:
                end = min(end, self.week_close - timedelta(minutes=3))
            if a.get("later_start"):   # once the later meeting starts, two events are in the window (an escalation)
                end = min(end, a["later_start"] - timedelta(minutes=2))
            return int((end - a["at"]).total_seconds() // 60)
        ok = [a for a in acts if room(a) >= 3 and not a.get("dup_at")]
        if not ok:
            return
        act = r.choice(ok)
        at = self.unique_time(act["at"] + timedelta(minutes=r.randint(1, min(40, room(act) - 1)), seconds=r.randint(0, 59)))
        act["dup_at"] = at                 # a retraction of this no-show, if any, comes later (plan_retraction)
        reporter = r.choice([x for x in self.reps if x is not act["reporter"]])
        text = r.choice(DUPLICATE_T).format(email=act["contact"]["email"], event=act["event"]["name"])
        self.plans.append({"kind": "noshow.reported", "variant": "duplicate", "at": at, "reporter": reporter,
                           "text": text, "of": act, "traps": ["T-repeat:duplicate-report"], "decoys": []})

    def retraction_limit(self, act) -> datetime:
        return (self.monday + timedelta(days=act["day"], hours=16, minutes=58)) if act["day"] == 4 else \
            (self.monday + timedelta(days=act["day"], hours=20))

    def retraction_room(self, act) -> int:
        """Minutes between the last report of the no-show (the duplicate, if any) and the retraction's latest time."""
        last = max(act["at"], act.get("dup_at") or act["at"])
        return int((self.retraction_limit(act) - last).total_seconds() // 60)

    def plan_retraction(self, act):
        r = self.r
        last = max(act["at"], act.get("dup_at") or act["at"])
        room = self.retraction_room(act)
        at = self.unique_time(last + timedelta(minutes=r.randint(5, max(5, min(90, room - 1))), seconds=r.randint(0, 59)))
        c = act["contact"]
        text = r.choice(RETRACT_T).format(event=act["event"]["name"], name=c["name"], email=c["email"])
        act["retract_at"] = at
        traps = []
        if r.random() < RETRACT_LOOKALIKE_RATE[self.d] and self.plant_retraction_lookalike(act):
            traps.append("T-lookalike:retraction-surname")
        self.plans.append({"kind": "noshow.retracted", "variant": "retraction", "at": at, "reporter": act["reporter"],
                           "text": text, "of": act, "traps": traps, "decoys": []})

    def plant_retraction_lookalike(self, act) -> bool:
        """A contact with the retracted person's surname at another account, whose no-show of an event with the same
        name was handled in an earlier week and whose follow-up task is still open (Not Started). Only the first name
        (or the email) in the retraction tells the two tasks apart."""
        r, c, ev = self.r, act["contact"], act["event"]
        oacc = r.choice([a for a in self.accounts if a["id"] != c["account_id"]])
        look = None
        for _ in range(50):
            first, last = self.person(c["last"])
            look = self.add_contact(oacc, first, last)
            if look:
                break
        if look is None:
            return False
        self.target_contacts.add(look["id"])      # never a background invitee or history no-show elsewhere
        # strictly before this week's Monday (a weekend landing moves earlier), so the week count never includes it
        s = (ev["start"] - timedelta(days=r.randint(max(3, act["day"] + 1), 12))).replace(minute=r.choice([0, 30]))
        if s.weekday() >= 5:
            s -= timedelta(days=s.weekday() - 4)
        self.add_history_noshow(look, s, event_name=ev["name"])
        return True

    def plan_chatter(self):
        r = self.r
        day = r.randint(0, 4)
        at = self.unique_time(self.monday + timedelta(days=day, hours=8, minutes=r.randint(5, 8 * 60 + 50 if day == 4 else 9 * 60 + 50),
                                                      seconds=r.randint(0, 59)))
        if at >= self.week_close:
            at = self.unique_time(self.week_close - timedelta(minutes=r.randint(3, 40)))
        roll = r.random()
        if roll < 0.6 and self.acts:
            c = r.choice(self.acts)["contact"]
            trap = "T-note:chatter-names-reported"
        else:
            c = r.choice(self.contacts)
            trap = "T-note:chatter"
        text = r.choice(CHATTER_T).format(email=c["email"], name=c["name"], event=r.choice(EVENT_NAMES),
                                          weekday=r.choice(WEEKDAYS))
        self.plans.append({"kind": "chatter", "variant": "chatter", "at": at, "reporter": r.choice(self.reps),
                           "text": text, "traps": [trap], "decoys": []})

    def background(self):
        """Other people's meetings this week and earlier no-shows of other people (noise in our own words)."""
        r = self.r
        free = [c for c in self.contacts if c["id"] not in self.target_contacts]
        for day in range(5):
            for _ in range(r.randint(3, 6)):
                c = r.choice(free)
                ev = self.add_event(r.choice(EVENT_NAMES), self.slot(day), r.choice(self.reps), r.choice([30, 60]),
                                    status="canceled" if r.random() < 0.15 else "active")
                self.add_invitee(ev, c)
        for _ in range(r.randint(3, 6)):
            c = r.choice(free)
            if c["email"] in self.prior:
                continue
            s = self.slot(0) - timedelta(days=r.randint(3, 20))
            if s.weekday() >= 5:
                s -= timedelta(days=s.weekday() - 4)
            self.add_history_noshow(c, s, retracted=r.random() < 0.2, completed=r.random() < 0.3)
        for _ in range(r.randint(4, 8)):
            c = r.choice(self.contacts)
            created = self.monday - timedelta(days=r.randint(1, 30), hours=r.randint(0, 9))
            self.add_task(f"{r.choice(NOISE_TASKS)} - {c['account_name']}", c["id"], None,
                          r.choice(["Not Started", "In Progress", "Completed"]), r.choice(["Normal", "High"]), created)
        ops = self.sales_ops
        self.add_message(ALERTS, ops, "Old no-show procedure: create a task, set priority High only if pipeline >= "
                         "$100,000. Normal otherwise.", self.monday - timedelta(days=r.randint(150, 220), hours=-10))
        self.add_message(ALERTS, ops, "No-show follow-ups are now handled by the automation. Priority High if any open "
                         "opportunity on the account is >= $50,000, otherwise Normal.",
                         self.monday - timedelta(days=r.randint(25, 60), hours=-9))
        for _ in range(r.randint(2, 4)):
            c = r.choice(self.contacts)
            at = self.monday - timedelta(days=r.randint(1, 12), hours=r.randint(-17, -8))
            self.add_message(ALERTS, r.choice(self.reps), r.choice(CHATTER_T).format(
                email=c["email"], name=c["name"], event=r.choice(EVENT_NAMES), weekday=r.choice(WEEKDAYS)), at)
        self.add_message(REVIEW, ops, "Escalations from automations land here. Please include the trigger id.",
                         self.monday - timedelta(days=r.randint(30, 90)))

    # -- truth -------------------------------------------------------------------------------------------------------
    def compute_truth(self):
        self.plans.sort(key=lambda p: p["at"])
        assert self.plans[-1]["kind"] == "week.close"
        flagged0 = sorted(i["id"] for i in self.invitees if i["no_show"])
        flagged_now = set(flagged0)        # flags after correct handling of every earlier trigger
        week_acts = []
        truth, end_tasks = [], []
        for n, p in enumerate(self.plans, 1):
            p["tid"] = f"s{self.seed}/t{n:02d}"
            p["n"] = n
        for p in self.plans:
            exp = {"noshow": [], "task_create": [], "task_update": [], "slack_post": [], "escalate": False}
            guards = list(p.get("decoys", []))
            ab = []
            outcome = "no-op"
            if p["variant"] == "act":
                c, ev, inv, at = p["contact"], p["event"], p["invitee"], p["at"]
                near = [q for q in self.prior.get(c["email"], [])
                        if q["start"] < ev["start"] and near_repeat_boundary(ev["start"], q["start"])]
                if near:                   # generator invariant (near_repeat_boundary): no ambiguous repeat verdict
                    raise AssertionError(f"{p['tid']}: prior no-show at {near[0]['start']} on the 14-day boundary")
                acc_id = c["account_id"]
                opps = self.open_opps(acc_id)
                pipe = sum(o["amount"] for o in opps)
                big = any(o["amount"] >= THRESHOLD for o in opps)
                repeat = any(ev["start"] - REPEAT_WINDOW <= q["start"] < ev["start"] and q["report_at"] < at
                             and (q["retract_at"] is None or q["retract_at"] > at)
                             for q in self.prior.get(c["email"], []))
                prio = "High" if (big or repeat) else "Normal"
                subj = SUBJECT_PREFIX + ev["name"]
                sched = scheduled(ev["start"])
                desc = description(ev["start"], pipe, repeat)
                exp["noshow"] = [inv["id"]]
                exp["task_create"] = [{"subject": subj, "status": "Not Started", "priority": prio, "contact_id": c["id"],
                                       "scheduled": sched, "pipeline": money(pipe), "repeat": repeat,
                                       "description": desc}]
                guards += [i["id"] for i in self.invitees if i["email"] == c["email"] and i["id"] != inv["id"]]
                guards = [g for g in guards if g not in flagged_now]
                flagged_now.add(inv["id"])
                ab = [{"type": "calendly_invitee_is_no_show", "invitee_id": inv["id"]},
                      {"type": "salesforce_task_exists_with_field", "field": "subject", "value": subj,
                       "additional_checks": {"status": "Not Started", "priority": prio, "contact_id": c["id"],
                                             "description_contains": sched}},
                      {"type": "salesforce_task_description_contains", "text": f"Account pipeline: {money(pipe)}"}]
                ab += [{"type": "calendly_invitee_not_no_show", "invitee_id": g} for g in sorted(set(guards))]
                outcome = "act"
                p["truth_task"] = {"contact_id": c["id"], "subject": subj, "scheduled": sched, "priority": prio,
                                   "description": desc}
                p["repeat"], p["big"], p["pipeline"] = repeat, big, pipe
                self.prior.setdefault(c["email"], []).append(
                    {"start": ev["start"], "event": ev["name"], "contact_id": c["id"], "report_at": at,
                     "retract_at": p.get("retract_at")})
                week_acts.append(p)
            elif p["variant"] == "retraction":
                a = p["of"]
                tt = a["truth_task"]
                exp["task_update"] = [{"contact_id": tt["contact_id"], "subject": tt["subject"],
                                       "scheduled": tt["scheduled"], "status": "Completed",
                                       "description": tt["description"] + RETRACT_SUFFIX}]
                ab = [{"type": "salesforce_task_exists_with_field", "field": "subject", "value": tt["subject"],
                       "additional_checks": {"status": "Completed", "contact_id": tt["contact_id"],
                                             "description_contains": "Retracted"}}]
                outcome = "act"
            elif p["variant"].startswith("escalate:"):
                exp["escalate"] = True
                ab = [{"type": "slack_message_in_channel", "channel": REVIEW, "text_contains": p["tid"]}]
                ab += [{"type": "calendly_invitee_not_no_show", "invitee_id": g} for g in sorted(set(guards))]
                outcome = "escalate"
            elif p["variant"] in ("internal", "duplicate", "chatter"):
                if p["variant"] == "duplicate" and p["of"].get("retract_at") and p["of"]["retract_at"] < p["at"]:
                    raise AssertionError(f"{p['tid']}: duplicate report after the retraction of the same no-show")
                ab = [{"type": "calendly_invitee_not_no_show", "invitee_id": g} for g in sorted(set(guards))]
            elif p["variant"] == "week_close":
                n_ret = sum(1 for a in week_acts if a.get("retract_at") is not None and a["retract_at"] < p["at"])
                count = len(week_acts) - n_ret
                exp["slack_post"] = [{"channel": ALERTS, "text": f"No-shows this week: {count}"}]
                ab = [{"type": "slack_message_in_channel", "channel": ALERTS, "text_contains": f"No-shows this week: {count}"}]
                outcome = "act"
                p["count"] = count
            truth.append({"trigger": p["tid"], "index": p["n"], "kind": p["kind"], "variant": p["variant"],
                          "outcome": outcome, "expect": exp, "guards": {"not_noshow": sorted(set(guards))},
                          "assertions": ab, "traps": list(p["traps"])})
        for a in week_acts:
            tt = a["truth_task"]
            retracted = a.get("retract_at") is not None
            end_tasks.append({"contact_id": tt["contact_id"], "subject": tt["subject"], "scheduled": tt["scheduled"],
                              "priority": tt["priority"], "status": "Completed" if retracted else "Not Started",
                              "description": tt["description"] + (RETRACT_SUFFIX if retracted else "")})
        flagged_end = sorted(set(flagged0) | {a["invitee"]["id"] for a in week_acts})
        all_inv = sorted(i["id"] for i in self.invitees)
        self.end = {"flagged": flagged_end, "not_flagged": [i for i in all_inv if i not in set(flagged_end)],
                    "week_tasks": end_tasks, "week_start": iso_z(self.monday), "count": self.plans[-1]["count"],
                    "count_text": f"No-shows this week: {self.plans[-1]['count']}"}
        self.truth = truth

    # -- output ------------------------------------------------------------------------------------------------------
    def world_dict(self):
        r = self.r
        cal_users = [{"id": x["cal"], "uri": f"https://api.calendly.com/users/{x['cal']}", "name": x["name"],
                      "email": x["email"], "timezone": "UTC"} for x in self.reps]
        events = [{"id": e["id"], "uuid": e["id"], "uri": f"https://api.calendly.com/scheduled_events/{e['id']}",
                   "name": e["name"], "status": e["status"], "start_time": cal_time(e["start"], e["offset"]),
                   "end_time": cal_time(e["end"], e["offset"]), "timezone": "UTC", "host_ids": [e["host"]],
                   "location_kind": "zoom", "created_at": iso_z(e["booked"]), "updated_at": iso_z(e["booked"])}
                  for e in self.events]
        invitees = [{"id": i["id"], "uri": f"https://api.calendly.com/scheduled_events/{i['event_id']}/invitees/{i['id']}",
                     "event_id": i["event_id"], "email": i["email"], "name": i["name"], "first_name": i["first"],
                     "last_name": i["last"], "timezone": "America/New_York", "status": i["status"],
                     "is_no_show": i["no_show"],
                     "no_show_marked_at": i["marked_at"].astimezone(UTC).replace(tzinfo=None).isoformat() if i["marked_at"] else None,
                     "created_at": iso_z(i["created"]), "updated_at": iso_z(i["marked_at"] or i["created"])}
                    for i in self.invitees]
        accounts = [{"id": a["id"], "account_name": a["name"], "industry": a["industry"], "website": a["domain"],
                     "created_date": iso_z(a["created"]), "last_modified_date": iso_z(a["created"])} for a in self.accounts]
        contacts = [{"id": c["id"], "first_name": c["first"], "last_name": c["last"], "email": c["email"],
                     "account_id": c["account_id"], "account_name": c["account_name"], "title": c["title"],
                     "created_date": iso_z(c["created"]), "last_modified_date": iso_z(c["created"])} for c in self.contacts]
        opps = [{"id": o["id"], "name": o["name"], "stage_name": o["stage"], "amount": float(o["amount"]),
                 "account_id": o["account_id"], "is_closed": not o["open"], "is_won": o["stage"] == "Closed Won",
                 "close_date": iso_z(o["close"]), "created_date": iso_z(o["created"]),
                 "last_modified_date": iso_z(o["created"])} for o in self.opps]
        tasks = [{"id": t["id"], "subject": t["subject"], "description": t["description"], "status": t["status"],
                  "priority": t["priority"], "contact_id": t["contact_id"], "is_closed": t["status"] == "Completed",
                  "created_date": iso_z(t["created"]), "last_modified_date": iso_z(t["created"])} for t in self.tasks]
        for coll in (events, invitees, accounts, contacts, opps, tasks):
            r.shuffle(coll)        # no positional signal: targets are never first, decoys never last
        users = [{"id": x["slack"], "name": x["name"], "username": f"{x['first'].lower()}.{x['last'].lower()}",
                  "email": x["email"], "first_name": x["first"], "last_name": x["last"], "tz": "UTC"}
                 for x in self.reps + [self.sales_ops]]
        members = [u["id"] for u in users]
        self.chan = {ALERTS: self.slack_id("C"), REVIEW: self.slack_id("C")}
        channels = [{"id": self.chan[ALERTS], "name": ALERTS, "topic": "Sales team alerts", "member_ids": members},
                    {"id": self.chan[REVIEW], "name": REVIEW, "topic": "Escalations from automations",
                     "member_ids": members}]
        msgs = [self.slack_msg(m) for m in sorted(self.messages, key=lambda m: m["ts"])]
        return {"meta": {"schema_version": "0.1.0", "current_time": iso_z(self.monday + timedelta(hours=8)),
                         "allowed_services": list(APPS)},
                "slack": {"channels": channels, "users": users, "messages": msgs},
                "calendly": {"users": cal_users, "scheduled_events": events, "invitees": invitees},
                "salesforce": {"accounts": accounts, "contacts": contacts, "opportunities": opps, "tasks": tasks}}

    def slack_msg(self, m):
        return {"id": m["id"], "channel_id": self.chan[m["channel"]], "user_id": m["user"], "text": m["text"],
                "ts": m["ts"], "created_at": m["at"].astimezone(UTC).replace(tzinfo=None).isoformat()}

    def stream(self):
        triggers, payloads = [], []
        for p in self.plans:
            if p["kind"] == "week.close":
                payload = {"trigger": p["tid"], "at": iso_z(p["at"]), "app": "schedule", "event": "week_close", "data": {}}
                delta = []
            else:
                m = {"id": self.slack_id("M"), "channel": ALERTS, "user": p["reporter"]["slack"], "text": p["text"],
                     "at": p["at"], "ts": self.ts(p["at"])}
                rec = self.slack_msg(m)
                payload = {"trigger": p["tid"], "at": iso_z(p["at"]), "app": "slack", "event": "new_message",
                           "data": {"channel": ALERTS, "channel_id": self.chan[ALERTS], "message_id": m["id"],
                                    "ts": m["ts"], "user_id": p["reporter"]["slack"], "user_name": p["reporter"]["name"],
                                    "text": p["text"]}}
                delta = [{"op": "insert", "app": "slack", "collection": "messages", "record": rec}]
            payloads.append(payload)
            triggers.append({"trigger": p["tid"], "index": p["n"], "at": iso_z(p["at"]), "kind": p["kind"],
                             "variant": p["variant"], "traps": list(p["traps"]), "payload": payload, "delta": delta})
        return triggers, payloads

    def run(self):
        self.build_people()
        self.plan_week()
        self.background()
        self.compute_truth()
        world = self.world_dict()
        triggers, payloads = self.stream()
        return {"world0": world, "triggers": triggers, "payloads": payloads, "truth": self.truth, "end": self.end}


def validate_world(world: dict) -> dict:
    """WorldState validation and the canonical dump; raises on an invalid world. Requires AutomationBench's venv."""
    from automationbench.schema.world import WorldState
    dumped = WorldState(**world).model_dump(mode="json")
    again = WorldState(**dumped).model_dump(mode="json")
    if canon(again) != canon(dumped):
        raise ValueError("world0 does not survive the dump -> load -> dump round trip")
    return dumped


def serve_input(seed: int, trigger: dict) -> dict:
    """The input row for `bridge.py serve --input <row> --world <world_t>` for ONE trigger (an AutomationBenchEnv
    dataset row): the family's apps only (so the allowed services are fixed), no assertions (the truth never enters
    the serve process), the api toolset, and meta.current_time = the trigger time. serve seeds its determinism shim
    from this row (task_seed(task_name), clock base = current_time), so records the arm creates carry the trigger's
    time; a row without current_time would stamp them 2026-01-01. The prompt holds only arm-visible text."""
    policy = (HERE / "POLICY.md").read_text()
    info = {"task_name": f"{FAMILY}.s{seed}.t{trigger['index']:02d}", "zapier_tools": [], "assertions": [],
            "initial_state": {"meta": {"schema_version": "0.1.0", "current_time": trigger["at"]},
                              "calendly": {}, "salesforce": {}, "slack": {}}}
    return {"example_id": trigger["index"],
            "prompt": [{"role": "system", "content": "standing automation " + FAMILY},
                       {"role": "user", "content": policy + "\n\nTrigger:\n" + canon(trigger["payload"])}],
            "answer": "", "info": json.dumps(info)}


def generate(seed: int, difficulty: str | None = None, validate: bool = True) -> dict:
    difficulty = difficulty or default_difficulty(seed)
    out = Gen(seed, difficulty).run()
    if validate:
        out["world0"] = validate_world(out["world0"])
    counts = {}
    for t in out["triggers"]:
        counts[t["variant"]] = counts.get(t["variant"], 0) + 1
    acts = [t for t in out["truth"] if t["variant"] == "act"]
    out["meta"] = {"family": FAMILY, "version": VERSION, "seed": seed, "difficulty": difficulty,
                   "week": out["end"]["week_start"][:10], "n_triggers": len(out["triggers"]), "variants": counts,
                   "act_trap_share": round(sum(1 for t in acts if t["traps"]) / max(1, len(acts)), 3),
                   "trigger_trap_share": round(sum(1 for t in out["truth"] if t["traps"]) / len(out["truth"]), 3)}
    return out


def write(out: dict, d: Path):
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
    print(canon(meta))


if __name__ == "__main__":
    main()
