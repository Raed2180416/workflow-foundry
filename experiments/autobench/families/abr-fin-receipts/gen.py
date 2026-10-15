#!/usr/bin/env python3
"""abr-fin-receipts: seeded stream generator (AutomationBench-R family 10; research/automationbench-20261014/
RECURRING-DESIGN.md §3.2, §4.10). Runs inside AutomationBench's own venv (it validates worlds with its WorldState):

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-fin-receipts/gen.py \
        --seed 610 [--difficulty d2] --out HOSTDIR

Writes into HOSTDIR (host-only; nothing generated is committed):
  world0.json        the initial world (WorldState dump; arms see it only through the tools)
  payloads.jsonl     the arm-visible trigger payloads, one per line, in order
  triggers.jsonl     host-only: payload + delta (world ops applied before the trigger) + kind + sub + traps
  truth.jsonl        host-only: per trigger, the outcome, the expected effects and AutomationBench assertion dicts
  end.json           host-only: the end-of-week expectations (graded at the last trigger, Friday's week close)
  serve-inputs.jsonl one input row per trigger for `bridge.py serve --input <row> --world world_t.json`
  meta.json          family, version, seed, difficulty, counts, trap shares and sha256 of every file

Determinism: one random.Random(f"{family}:{version}:{seed}:{difficulty}"); no wall clock, no set iteration in any
output, every id and datetime written explicitly, so no pydantic default factory fires.

The truth comes from the generator's own canonical model of the business (`Gen.simulate`): each receipt is a set of
structured facts (category, amount, expense date, attendees, receipt, alcohol, client, hotel nights, flight cabin and
hours), decided by `decide()` against the Submissions rows as they would be after correct handling of every earlier
trigger. Message text is rendered from the facts at the end, in several styles; the truth never parses text. The
reference solver (reference.py) is a separate implementation that sees only the payload, POLICY.md and the tools, and
parses the text. Every person and company is fictional (*.example.com).
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
from decimal import Decimal
from pathlib import Path

FAMILY = "abr-fin-receipts"
VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
UTC = timezone.utc

APPS = ("slack", "google_sheets", "gmail")
ORG = "company.example.com"
FINANCE = f"finance@{ORG}"
AUTOMATION = f"expenses-automation@{ORG}"
SS, SS_TITLE = "ss_expense_tracker", "Expense Tracker"
WS_SUB, WS_EMP, WS_POL = "ws_submissions", "ws_employees", "ws_policy"
WS_TITLE = {WS_SUB: "Submissions", WS_EMP: "Employees", WS_POL: "Expense Policy"}
SUB_HEADERS = ["Message TS", "Submitted", "Employee", "Date", "Amount", "Category", "Attendees", "Status"]
EMP_HEADERS = ["Employee", "Email", "Department", "Manager", "Manager Email"]
POL_HEADERS = ["Rule", "Detail"]
CHAN, REVIEW, GENERAL = "expense-submissions", "automation-review", "general"
APPROVED, PENDING, REJECTED = "Approved", "Pending Pre-Approval", "Rejected"
ALLOWED = ("Travel", "Meals", "Office Supplies", "Software", "Consulting")
NOT_ALLOWED = ("Entertainment", "Personal", "Gifts")
CATEGORIES = ALLOWED + NOT_ALLOWED
# POLICY.md section 7: category words (whole words, letter case ignored)
CATEGORY_WORDS = {
    "Travel": ["travel", "uber", "lyft", "taxi", "rideshare", "train", "flight", "airfare", "hotel", "lodging",
               "parking", "mileage"],
    "Meals": ["meals", "meal", "lunch", "dinner", "breakfast", "coffee", "catering", "drinks"],
    "Office Supplies": ["office supplies", "supplies", "toner", "notebooks", "pens", "markers", "desk lamp",
                        "monitor stand"],
    "Software": ["software", "license", "subscription", "saas"],
    "Consulting": ["consulting", "consultant", "contractor", "advisory"],
    "Entertainment": ["entertainment", "escape room", "concert", "bowling", "karaoke", "team building"],
    "Personal": ["personal", "gym", "haircut", "dry cleaning"],
    "Gifts": ["gifts", "gift", "gift basket", "gift card", "flowers"],
}
ALCOHOL_WORDS = ["drinks", "wine", "beer", "cocktails", "bar tab", "happy hour"]
LIMITS = {"receipt": Decimal("25"), "individual": Decimal("50"), "attendees": Decimal("75"),
          "team_pp": Decimal("75"), "cap": Decimal("100"), "hotel": Decimal("250"), "hotel_intl": Decimal("350"),
          "flight_hours": Decimal("6"), "preapproval": Decimal("500")}

POLICY_ROWS = [
    ("Allowed Categories", "Travel, Meals, Office Supplies, Software, Consulting"),
    ("Rejected Categories", "Entertainment, Personal, Gifts - these need VP pre-approval outside this channel"),
    ("Meals", "Team meals at most $75 per person (attendee count required over $75); individual meals at most $50; "
              "at most $100 of individual meals per employee per day"),
    ("Hotel", "At most $250 per night domestic, $350 per night international"),
    ("Flights", "Economy unless the flight is longer than 6 hours"),
    ("Alcohol", "Only for client entertainment, with the client's name"),
    ("Pre-Approval", "Over $500 needs the employee's manager to reply 'pre-approved' in the thread"),
    ("Receipts", "Required over $25 (attach the file or write receipt: yes)"),
]

KINDS = ("receipt.posted", "receipt.corrected", "receipt.reposted", "preapproval.reply", "week.close")
COUNTS = {
    "d1": {"receipt.posted": (24, 26), "receipt.corrected": (2, 2), "receipt.reposted": (2, 2), "preapproval.reply": (1, 1)},
    "d2": {"receipt.posted": (24, 30), "receipt.corrected": (2, 3), "receipt.reposted": (2, 3), "preapproval.reply": (1, 2)},
    "d3": {"receipt.posted": (32, 38), "receipt.corrected": (3, 4), "receipt.reposted": (2, 3), "preapproval.reply": (3, 3)},
}
# Share of receipts given each format trap (a receipt may get several).
FORMAT_RATE = {"d1": {"synonym": 0.0, "words": 0.0, "currency": 0.0, "date": 0.0},
               "d2": {"synonym": 0.05, "words": 0.02, "currency": 0.02, "date": 0.03},
               "d3": {"synonym": 0.16, "words": 0.09, "currency": 0.06, "date": 0.12}}
# Employees whose Slack display name differs from their Employees name (nicknames), by difficulty.
NICK_STAFF = {"d1": 0, "d2": 1, "d3": 2}
MENU = {
    "d1": {"ok-ride": 4, "ok-parking": 2, "ok-train": 1, "ok-hotel": 1, "ok-flight": 1, "ok-meal-ind": 4,
           "ok-meal-team": 2, "ok-supplies": 2, "ok-software": 2, "ok-consulting": 1, "rej-category": 2,
           "rej-receipt": 1, "rej-attendees": 1, "rej-individual": 1, "rej-team": 1, "rej-hotel": 1, "rej-flight": 1},
    "d2": {"ok-ride": 4, "ok-parking": 2, "ok-train": 1, "ok-hotel": 1, "ok-flight": 1, "ok-meal-ind": 4,
           "ok-meal-team": 2, "ok-supplies": 2, "ok-software": 2, "ok-consulting": 1, "rej-category": 2,
           "rej-receipt": 1, "rej-attendees": 1, "rej-individual": 1, "rej-team": 1, "rej-hotel": 1, "rej-flight": 1,
           "rej-alcohol": 0.4, "drinks-client": 0.3, "hotel-intl": 0.3, "flight-long": 0.2, "flight-six": 0.15},
    "d3": {"ok-ride": 2, "ok-parking": 1, "ok-train": 1, "ok-hotel": 0.7, "ok-flight": 0.7, "ok-meal-ind": 2,
           "ok-meal-team": 1.5, "ok-supplies": 1, "ok-software": 1, "ok-consulting": 0.7, "rej-category": 2,
           "rej-receipt": 2, "rej-attendees": 1.5, "rej-individual": 1.5, "rej-team": 1.5, "rej-hotel": 1.5,
           "rej-flight": 1.5, "rej-alcohol": 2, "drinks-client": 1.5, "hotel-intl": 1.2, "flight-long": 0.8,
           "flight-six": 0.6},
}

# -- fictional pools ------------------------------------------------------------------------------------------------
NICK = {"Samuel": "Sam", "Katherine": "Kate", "Alexander": "Alex", "Jonathan": "Jon", "Elizabeth": "Liz",
        "Michael": "Mike", "Rebecca": "Becca", "Daniel": "Dan", "Christopher": "Chris", "Margaret": "Maggie"}
FIRST = ["Priya", "Mateo", "Ingrid", "Tomas", "Amara", "Kenji", "Lucia", "Omar", "Freya", "Desmond", "Nadia",
         "Rafael", "Sienna", "Viktor", "Leah", "Hiro", "Zara", "Felix", "Imani", "Bruno", "Jordan", "Casey", "Morgan",
         "Avery", "Quinn", "Riley", "Elena", "Tobias"]
LAST = ["Okafor", "Lindqvist", "Mensah", "Marchetti", "Fischer", "Iyer", "Bernard", "Novak", "Tanaka", "Haddad",
        "Kowalski", "Brennan", "Castillo", "Duarte", "Engstrom", "Farouk", "Galloway", "Holm", "Ibarra", "Jansen",
        "Kessler", "Laine", "Moreau", "Nakamura", "Ortega", "Petrov", "Quintero", "Rasmussen", "Sato", "Toivonen",
        "Ulloa", "Varga", "Whitlock", "Yilmaz", "Zeller"]
DEPTS = ["Sales", "Engineering", "Marketing"]
CONTRACTOR = ("Robin", "Hale", "robin.hale@northwind-studio.example.com")
RESTAURANTS = ["Saffron House", "Copper Kettle Diner", "Juniper Grill", "Blue Fern Cafe", "Bella Notte Trattoria",
               "Marigold Kitchen", "Olive and Thyme", "Lantern Street Noodles", "Harbor Fish Shack", "Plum Tree Bistro"]
CAFES = ["Blue Fern Cafe", "Kettle and Crumb", "Northside Roasters", "Little Acorn Bakery"]
CITIES = ["Denver", "Boston", "Chicago", "Austin", "Seattle", "Portland", "Atlanta", "Phoenix", "Nashville", "Raleigh"]
INTL = [("Toronto", "Canada"), ("Lyon", "France"), ("Dublin", "Ireland"), ("Osaka", "Japan"), ("Munich", "Germany"),
        ("Utrecht", "Netherlands"), ("Valencia", "Spain"), ("Melbourne", "Australia"), ("Monterrey", "Mexico"),
        ("Manchester", "United Kingdom")]
HOTELS = ["Harborview Hotel", "Cedar Point Hotel", "Larkspur Hotel", "Granite Square Hotel", "Willow Court Hotel"]
CLIENTS = ["Brightmoor Health", "Kestrova Analytics", "Harborlyn Labs", "Quillon Partners", "Tidewell Logistics",
           "Corvane Media", "Ambergate Systems", "Ostravia Foods"]
TOOLS = ["Draftboard Pro", "Snaplytics", "Clipnote", "Formwise", "Taskmint", "Pixelpane"]
FIRMS = ["Northgate Group", "Fenwick and Shaw", "Bluepeak Partners", "Arden Lane Studio"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]
ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
        "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
CENT = Decimal("0.01")


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256((obj if isinstance(obj, str) else canon(obj)).encode("utf-8")).hexdigest()


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def naive(dt: datetime) -> str:
    return dt.astimezone(UTC).replace(tzinfo=None).isoformat()


def default_difficulty(seed: int) -> str:
    """Within each seed block (RECURRING-DESIGN §3.9) the first seed is d2, then d2/d3 alternate."""
    starts = [601, 610, 614, 622, 631, 8801, 8805, 8825, 8837]
    start = max([s for s in starts if s <= seed], default=seed)
    return "d2" if (seed - start) % 2 == 0 else "d3"


def money(a: Decimal) -> str:
    return f"${a:,.2f}"


def cell_amount(a: Decimal) -> str:
    return f"{a:.2f}"


def words_int(n: int) -> str:
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("-" + ONES[n % 10] if n % 10 else "")
    if n < 1000:
        return ONES[n // 100] + " hundred" + (" " + words_int(n % 100) if n % 100 else "")
    return words_int(n // 1000) + " thousand" + (" " + words_int(n % 1000) if n % 1000 else "")


def money_words(a: Decimal) -> str:
    d, c = int(a), int((a * 100) % 100)
    s = words_int(d) + (" dollar" if d == 1 else " dollars")
    if c:
        s += " and " + words_int(c) + (" cent" if c == 1 else " cents")
    return s


def words_in(text: str, words: list[str]) -> bool:
    low = text.lower()
    return any(re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", low) for w in words)


def categories_in(text: str) -> list[str]:
    """POLICY.md section 7 table, used only as a solvability self-check on rendered text (never for the truth)."""
    return [c for c in CATEGORIES if words_in(text, [c.lower()] + CATEGORY_WORDS[c])]


# ---------------------------------------------------------------------------------------------------------------
# The canonical policy (POLICY.md sections 4-8), on structured facts
# ---------------------------------------------------------------------------------------------------------------
def individual(f: dict) -> bool:
    return f["category"] == "Meals" and (f["attendees"] is None or f["attendees"] == 1)


def decide(f: dict, cap_other: Decimal) -> tuple[str | None, str | None, str | None]:
    """(status, reason, rule) for a receipt's facts; cap_other = the employee's other individual Meals rows that
    expense date (POLICY.md section 8). status is None when rejected."""
    a, cat = f["amount"], f["category"]
    if cat in NOT_ALLOWED:
        return None, f"{cat} needs VP pre-approval", "1"
    if a > LIMITS["receipt"] and not f["receipt"]:
        return None, "Receipt required", "2"
    if f["alcohol"] and not f["client"]:
        return None, "Alcohol needs a client name", "3"
    if cat == "Meals":
        n = f["attendees"]
        if n is None and a > LIMITS["attendees"]:
            return None, "Attendees required", "4a"
        if (n is None or n == 1) and a > LIMITS["individual"]:
            return None, "Over individual meal limit", "4b"
        if n is not None and n >= 2 and a / n > LIMITS["team_pp"]:
            return None, "Over team meal limit", "4c"
        if (n is None or n == 1) and cap_other + a > LIMITS["cap"]:
            return None, "Over daily meal cap", "4d"
    if f["hotel"] is not None:
        lim = LIMITS["hotel_intl"] if f["hotel"]["intl"] else LIMITS["hotel"]
        if a / f["hotel"]["nights"] > lim:
            return None, "Over hotel nightly limit", "5"
    if f["flight"] is not None and f["flight"]["cabin"] != "economy" and f["flight"]["hours"] <= LIMITS["flight_hours"]:
        return None, "Economy only for flights up to 6 hours", "6"
    return (PENDING if a > LIMITS["preapproval"] else APPROVED), None, None


def reply_text(status: str | None, reason: str | None, f: dict) -> str:
    if status is None:
        return f"Rejected: {reason}"
    if status == PENDING:
        return f"Pending pre-approval: {money(f['amount'])} {f['category']}"
    return f"Logged: {money(f['amount'])} {f['category']}"


def row_cells(ts: str, submitted: str, name: str, f: dict, status: str) -> dict:
    return {"Message TS": ts, "Submitted": submitted, "Employee": name, "Date": f["date"].isoformat(),
            "Amount": cell_amount(f["amount"]), "Category": f["category"],
            "Attendees": str(f["attendees"] or 1) if f["category"] == "Meals" else "", "Status": status}


def weekly_email(rows: list[dict], week_start: str, friday: str) -> dict:
    totals: dict[str, Decimal] = {}
    for r in rows:
        c = r["cells"]
        if c["Status"] == APPROVED and week_start <= c["Submitted"] <= friday:
            totals[c["Employee"]] = totals.get(c["Employee"], Decimal("0")) + Decimal(c["Amount"])
    lines = [f"{name}: {money(totals[name])}" for name in sorted(totals)]
    lines.append(f"Total: {money(sum(totals.values(), Decimal('0')))}")
    lines.append(f"Pending pre-approval: {sum(1 for r in rows if r['cells']['Status'] == PENDING)}")
    return {"to": FINANCE, "subject": f"Weekly expense totals {week_start}", "lines": lines,
            "body": "\n".join(lines)}


# ---------------------------------------------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------------------------------------------
class Gen:
    def __init__(self, seed: int, difficulty: str):
        if difficulty not in COUNTS:
            raise ValueError(f"difficulty must be d1, d2 or d3 (got {difficulty!r})")
        self.seed, self.d = int(seed), difficulty
        self.r = random.Random(f"{FAMILY}:{VERSION}:{self.seed}:{difficulty}")
        mondays = [date(2026, 2, 2) + timedelta(weeks=k) for k in range(60)]
        mondays = [m for m in mondays if m <= date(2026, 11, 23)]
        self.monday = datetime.combine(self.r.choice(mondays), time(0, 0), tzinfo=UTC)
        self.friday = self.monday + timedelta(days=4)
        self.close_at = self.friday + timedelta(hours=16)
        self.cnt = {k: self.r.randint(*v) for k, v in COUNTS[difficulty].items()}
        self.ids: set[str] = set()
        self.minutes: set[int] = set()
        self.people: list[dict] = []
        self.by_email: dict[str, dict] = {}
        self.rows: list[dict] = []              # canonical Submissions rows {row_id, id, cells}
        self.receipts: dict[str, dict] = {}     # ts -> receipt state
        self.tops: list[dict] = []              # top-level receipt messages {email, ts, date, amount}
        self.msgs0: list[dict] = []             # world0 Slack messages
        self.bot_replies: list[dict] = []       # this week's expected bot replies {thread_ts, text}
        self.reviews: list[str] = []            # this week's escalated trigger ids
        self.reserved: set = set()              # (email, expense date) of the daily-cap scenarios
        self.file_no = 0

    # -- ids, times ---------------------------------------------------------------------------------------------------
    def uid(self, alphabet: str, n: int, prefix: str = "") -> str:
        while True:
            v = prefix + "".join(self.r.choice(alphabet) for _ in range(n))
            if v not in self.ids:
                self.ids.add(v)
                return v

    def hexid(self, n: int = 32) -> str:
        return self.uid("0123456789abcdef", n)

    def ts(self, at: datetime) -> str:
        while True:
            v = f"{int(at.timestamp())}.{self.r.randint(100000, 999999):06d}"
            if v not in self.ids:
                self.ids.add(v)
                return v

    def minute_slot(self, lo: datetime, hi: datetime) -> datetime:
        """A free business minute (Mon-Thu 08:00-17:00, Fri 08:00-15:50) in [lo, hi)."""
        cand = []
        start = max(0, int((lo - self.monday).total_seconds() // 60) + (1 if (lo - self.monday).total_seconds() % 60 else 0))
        end = int((hi - self.monday).total_seconds() // 60)
        for k in range(start, end):
            day, m = divmod(k, 1440)
            if day > 4 or k in self.minutes:
                continue
            if 8 * 60 <= m < (17 * 60 if day < 4 else 15 * 60 + 50):
                cand.append(k)
        if not cand:
            raise RuntimeError("no free business minute")
        k = self.r.choice(cand)
        self.minutes.add(k)
        return self.monday + timedelta(minutes=k)

    def amt(self, lo: float, hi: float, whole: float = 0.25) -> Decimal:
        if self.r.random() < whole:
            return Decimal(self.r.randint(int(lo + 0.999), int(hi)))
        return (Decimal(self.r.randint(int(lo * 100), int(hi * 100))) * CENT).quantize(CENT)

    # -- people ---------------------------------------------------------------------------------------------------------
    def build_people(self):
        r = self.r
        firsts = list(FIRST)
        r.shuffle(firsts)
        lasts = list(LAST)
        r.shuffle(lasts)
        nick_firsts = sorted(NICK)
        r.shuffle(nick_firsts)

        def person(first, role, dept):
            last = lasts.pop()
            name = f"{first} {last}"
            return {"name": name, "first": first, "last": last, "email": f"{first.lower()}.{last.lower()}@{ORG}",
                    "role": role, "dept": dept, "slack_name": name}
        director = person(firsts.pop(), "director", "Operations")
        director.update(manager=None, manager_name="Morgan Ashby", manager_email=f"cfo@{ORG}")
        people = [director]
        managers = {}
        for dept in DEPTS:
            m = person(firsts.pop(), "manager", dept)
            m.update(manager=director["email"], manager_name=director["name"], manager_email=director["email"])
            managers[dept] = m
            people.append(m)
        fin = person(firsts.pop(), "finance", "Finance")
        fin.update(manager=director["email"], manager_name=director["name"], manager_email=director["email"])
        people.append(fin)
        n_staff = r.randint(10, 12)
        staff = []
        for i in range(n_staff):
            dept = DEPTS[i % 3]
            first = nick_firsts.pop() if i < 3 else firsts.pop()
            s = person(first, "staff", dept)
            m = managers[dept]
            s.update(manager=m["email"], manager_name=m["name"], manager_email=m["email"])
            staff.append(s)
        # namesakes: for each manager one staff member of another department with the manager's first name
        for k, dept in enumerate(DEPTS):
            m = managers[dept]
            cands = [s for s in staff[3:] if s["dept"] != dept and not s.get("namesake_of")]
            s = cands[r.randrange(len(cands))]
            s["first"] = m["first"]
            s["name"] = f"{m['first']} {s['last']}"
            s["slack_name"] = s["name"]
            s["email"] = f"{m['first'].lower()}.{s['last'].lower()}@{ORG}"
            s["namesake_of"] = m["email"]
        # display names: nickname staff (by difficulty), and (d2/d3, half the seeds) one manager shown with an initial
        for s in staff[:NICK_STAFF[self.d]]:
            s["slack_name"] = f"{NICK[s['first']]} {s['last']}"
        if self.d != "d1" and r.random() < 0.5:
            m = managers[r.choice(DEPTS)]
            m["slack_name"] = f"{m['first']} {m['last'][0]}."
        people += staff
        assert len({p["name"] for p in people}) == len(people) and len({p["email"] for p in people}) == len(people)
        for p in people:
            p["slack_id"] = self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "U")
            self.by_email[p["email"]] = p
        self.people = people
        self.director, self.managers, self.finance, self.staff = director, managers, fin, staff
        c = {"name": f"{CONTRACTOR[0]} {CONTRACTOR[1]}", "first": CONTRACTOR[0], "last": CONTRACTOR[1],
             "email": CONTRACTOR[2], "role": "contractor", "dept": None, "slack_name": f"{CONTRACTOR[0]} {CONTRACTOR[1]}",
             "slack_id": self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "U")}
        self.contractor = c
        self.submitters = staff + list(managers.values()) + [fin]

    def manager_of(self, p: dict) -> dict | None:
        return self.by_email.get(p.get("manager_email"))

    # -- receipt facts --------------------------------------------------------------------------------------------------
    def expense_date(self, post: date) -> date:
        k = self.r.choices([0, 1, 2, 3, 4, 5], [45, 30, 12, 7, 4, 2])[0]
        return post - timedelta(days=k)

    def receipt_flag(self, a: Decimal) -> bool:
        return True if a > LIMITS["receipt"] else self.r.random() < 0.5

    def blank(self, cat: str, a: Decimal, d: date) -> dict:
        return {"category": cat, "amount": a, "date": d, "attendees": None, "receipt": self.receipt_flag(a),
                "alcohol": False, "client": None, "hotel": None, "flight": None}

    def facts(self, intent: str, post: date, fixed: dict | None = None) -> tuple[dict, dict]:
        """Structured facts plus a render spec for one receipt of the given intent."""
        r, fixed = self.r, fixed or {}
        d = fixed.get("date") or self.expense_date(post)
        spec: dict = {"intent": intent}
        if intent in ("unknown",):
            intent = r.choice(["ok-supplies", "ok-software", "ok-ride"])
        if intent == "ok-ride":
            f = self.blank("Travel", self.amt(9, 68), d)
            spec.update(desc=r.choice(["Uber to the airport", "Lyft from the client office", "Taxi to the train station",
                                       "Uber back to the office", "Lyft to the offsite"]),
                        syn=["Rideshare", "Uber", "Taxi"], sub="ride")
        elif intent == "ok-parking":
            f = self.blank("Travel", self.amt(8, 42), d)
            spec.update(desc=r.choice(["Parking at the conference center", "Airport parking", "Parking garage downtown"]),
                        syn=["Parking"], sub="parking")
        elif intent == "ok-train":
            f = self.blank("Travel", self.amt(32, 145), d)
            spec.update(desc=r.choice([f"Train to {r.choice(CITIES)}", f"Train fare to {r.choice(CITIES)} and back"]),
                        syn=["Train", "Travel"], sub="train")
        elif intent in ("ok-hotel", "rej-hotel", "hotel-intl", "pending-hotel"):
            intl = intent == "hotel-intl" or (intent == "rej-hotel" and r.random() < 0.35)
            if intent == "ok-hotel":
                nights, per = r.choice([1, 1, 2]), self.amt(110, 245, 0.5)
            elif intent == "pending-hotel":
                nights = r.choice([3, 3, 4])
                per = self.amt(170 if nights == 3 else 130, 245, 0.5)
            elif intent == "hotel-intl":
                nights, per = r.choice([1, 1, 2]), self.amt(255, 349, 0.5)
            else:
                nights = r.choice([1, 2, 2, 3])
                per = self.amt(355, 430, 0.5) if intl else self.amt(258, 345, 0.5)
            f = self.blank("Travel", (per * nights).quantize(CENT), d)
            f["receipt"] = True
            f["hotel"] = {"nights": nights, "intl": intl}
            city = r.choice(INTL) if intl else (r.choice(CITIES), None)
            spec.update(sub="hotel", nights=nights, city=city, hotel=r.choice(HOTELS),
                        intl_style=("country" if r.random() < 0.7 else "word") if intl else None,
                        nights_style=r.choice(["digits", "digits", "words", "dash"]), syn=["Lodging", "Hotel"])
        elif intent in ("ok-flight", "rej-flight", "flight-long", "flight-six", "pending-flight"):
            if intent == "ok-flight":
                cabin, hours, a = r.choice(["economy", None]), Decimal(r.choice([2, 3, 4, 5, 6, 7])) + Decimal(r.choice([0, 0, 25, 50])) / 60, self.amt(150, 480)
            elif intent == "pending-flight":
                cabin, hours, a = r.choice(["economy", None]), Decimal(r.choice([3, 4, 5, 6])), self.amt(520, 780)
            elif intent == "flight-long":
                cabin, hours, a = r.choice(["business", "business", "first class", "premium economy"]), Decimal(r.choice([6, 7, 8, 9, 10])) + Decimal(r.choice([15, 30, 45])) / 60, self.amt(900, 2400)
            elif intent == "flight-six":
                cabin, hours, a = r.choice(["business", "premium economy"]), Decimal(6), self.amt(600, 1500)
            else:
                cabin, hours, a = r.choice(["business", "business", "first class", "premium economy"]), Decimal(r.choice([2, 3, 4, 5])) + Decimal(r.choice([0, 30])) / 60, self.amt(450, 1800)
            f = self.blank("Travel", a, d)
            f["receipt"] = True
            f["flight"] = {"cabin": cabin or "economy", "hours": hours}
            a_city, b_city = r.sample(CITIES, 2)
            spec.update(sub="flight", route=(a_city, b_city), cabin=cabin, hours=hours,
                        hours_style=r.choice(["h", "hm", "hours"]), syn=["Airfare", "Flight"])
        elif intent in ("ok-meal-ind", "cap-setup", "cap-reject", "cap-under", "cap-history", "rej-individual"):
            if intent == "ok-meal-ind":
                cap_left = fixed.get("cap_left", LIMITS["cap"])
                a = self.amt(8, float(min(LIMITS["individual"], cap_left)))
            elif intent in ("cap-setup", "cap-reject", "cap-under", "cap-history"):
                a = fixed["amount"]
            else:
                a = self.amt(50.5, 75)
            f = self.blank("Meals", a, d)
            if intent == "rej-individual" and r.random() < 0.3:
                f["attendees"] = 1
            spec.update(desc=r.choice([f"Lunch at {r.choice(RESTAURANTS)}", f"Breakfast at {r.choice(CAFES)}",
                                       f"Dinner at {r.choice(RESTAURANTS)} while traveling",
                                       f"Coffee with a candidate at {r.choice(CAFES)}",
                                       f"Lunch at {r.choice(RESTAURANTS)} during the site visit"]),
                        syn=["Meal", "Lunch", "Meals"], sub="meal")
        elif intent in ("ok-meal-team", "rej-team", "rej-attendees", "pending-meal", "drinks-client"):
            if intent == "ok-meal-team":
                n = r.randint(2, 6)
                a = (Decimal(r.randint(18, 75)) * n - Decimal(r.choice([0, 0, 1, 3]))).quantize(CENT)
                a = min(a, Decimal("495.00"))
            elif intent == "pending-meal":
                n = r.randint(8, 10)
                a = (self.amt(63, 75) * n).quantize(CENT)
                a = max(a, Decimal("505.00")) if a / n <= 75 else a
            elif intent == "drinks-client":
                n = r.randint(2, 5)
                a = (self.amt(40, 75) * n).quantize(CENT)
            elif intent == "rej-team":
                n = r.randint(2, 6)
                a = (self.amt(76, 110) * n).quantize(CENT)
            else:  # rej-attendees: a team meal posted without its count
                n = None
                a = self.amt(80, 260)
            f = self.blank("Meals", a, d)
            f["attendees"] = n
            f["receipt"] = True
            if intent == "drinks-client":
                f["alcohol"] = True
                f["client"] = r.choice(CLIENTS)
                spec.update(desc=r.choice([f"Dinner and wine at {r.choice(RESTAURANTS)}",
                                           f"Cocktails and dinner at {r.choice(RESTAURANTS)}",
                                           f"Client dinner with drinks at {r.choice(RESTAURANTS)}"]),
                            syn=["Dinner", "Meals"], sub="meal")
            else:
                spec.update(desc=r.choice([f"Team lunch at {r.choice(RESTAURANTS)}", f"Team dinner at {r.choice(RESTAURANTS)}",
                                           "Catering for the sprint review", f"Working lunch at {r.choice(RESTAURANTS)}",
                                           f"Client lunch at {r.choice(RESTAURANTS)}"]),
                            syn=["Catering", "Meals", "Lunch"], sub="meal")
            spec["att_style"] = r.choice(["attendees", "people", "colon", "team", "party", "guests"])
        elif intent == "rej-alcohol":
            f = self.blank("Meals", self.amt(30, 95), d)
            f["receipt"] = True
            f["alcohol"] = True
            desc = r.choice(["Drinks at the conference", f"Happy hour drinks at {r.choice(RESTAURANTS)}",
                             "Beer and snacks after the offsite dinner", f"Wine with dinner at {r.choice(RESTAURANTS)}",
                             f"Bar tab and dinner at {r.choice(RESTAURANTS)} after the trade show"])
            if r.random() < 0.3:
                f["attendees"] = r.randint(2, 4)
                spec["att_style"] = r.choice(["attendees", "people", "colon"])
            spec.update(desc=desc, syn=["Meals", "Drinks"], sub="meal")
        elif intent in ("ok-supplies", "fix-cat-supplies"):
            f = self.blank("Office Supplies", self.amt(9, 180), d)
            spec.update(desc=r.choice(["Printer toner", "Notebooks and pens for the team", "Whiteboard markers",
                                       "Desk lamp for the office", "Monitor stand"]), syn=["Supplies"], sub="supplies")
        elif intent in ("ok-software", "pending-software", "fix-cat-software"):
            a = self.amt(540, 1200) if intent == "pending-software" else self.amt(10, 300)
            f = self.blank("Software", a, d)
            tool = r.choice(TOOLS)
            spec.update(desc=r.choice([f"{tool} subscription", f"{tool} annual license", f"{tool} license renewal"]),
                        syn=["Subscription", "SaaS", "License"], sub="software")
        elif intent in ("ok-consulting", "pending-consulting"):
            a = self.amt(650, 2000) if intent == "pending-consulting" else self.amt(150, 500)
            f = self.blank("Consulting", a, d)
            spec.update(desc=r.choice([f"Consultant fee for the {r.choice(FIRMS)} workshop",
                                       f"Contractor invoice from {r.choice(FIRST)} {r.choice(LAST)}",
                                       f"Advisory session with {r.choice(FIRMS)}"]),
                        syn=["Contractor", "Consultant", "Advisory"], sub="consulting")
        elif intent == "rej-category":
            cat = r.choice(NOT_ALLOWED)
            if cat == "Entertainment":
                desc, a = r.choice([("Team building escape room", (300, 900)), ("Concert seats for the team", (120, 600)),
                                         ("Bowling night with the team", (150, 400)), ("Karaoke night after the launch", (90, 300))])
                syn = ["Team building", "Entertainment"]
            elif cat == "Personal":
                desc, a = r.choice([("Gym membership", (40, 90)), ("Haircut before the conference", (35, 60)),
                                    ("Dry cleaning before the trip", (18, 40))])
                syn = ["Personal", "Gym"]
            else:
                desc, a = r.choice([(f"Gift basket for {r.choice(CLIENTS)}", (60, 150)), ("Flowers for a colleague", (40, 90)),
                                    ("Gift card for the intern", (25, 100))])
                syn = ["Gift", "Gifts"]
            f = self.blank(cat, self.amt(*a), d)
            spec.update(desc=desc, syn=syn, sub="rejected")
        elif intent == "rej-receipt":
            base_intent = r.choice(["ok-software", "ok-supplies", "ok-train", "ok-consulting"])
            f, base_spec = self.facts(base_intent, post, {"date": d})
            spec.update({k: v for k, v in base_spec.items() if k != "intent"})
            if f["amount"] <= LIMITS["receipt"]:
                f["amount"] = self.amt(26, 160)
            f["amount"] = min(f["amount"], Decimal("480.00"))
            f["receipt"] = False
            spec["no_receipt"] = r.choice(["no", "none", "silent"])
        else:
            raise ValueError(intent)
        spec.setdefault("intent", intent)
        return f, spec

    # -- rendering ----------------------------------------------------------------------------------------------------
    def date_text(self, d: date, post: date, style: str) -> str | None:
        if style == "none":
            return None
        if style == "today":
            return "today"
        if style == "yesterday":
            return "yesterday"
        if style == "mon":
            return f"{MONTHS[d.month - 1][:3]} {d.day}"
        if style == "month":
            return f"{MONTHS[d.month - 1]} {d.day}"
        if style == "dmonth":
            return f"{d.day} {MONTHS[d.month - 1]}"
        return d.isoformat()

    def date_styles(self, d: date, post: date) -> list[str]:
        out = ["mon", "month", "dmonth"]
        if d == post:
            out += ["today", "none"]
        if d == post - timedelta(days=1):
            out.append("yesterday")
        return out

    def amount_text(self, a: Decimal, style: str) -> str:
        if style == "words":
            return money_words(a)
        if style == "usd_suffix":
            return f"{a:,.2f} USD"
        if style == "usd_prefix":
            return f"USD {a:,.2f}"
        if style == "dollar0" and a == a.to_integral_value():
            return f"${int(a):,}"
        return money(a)

    def attendees_text(self, n: int, style: str) -> str:
        return {"attendees": f"{n} attendees", "people": f"{n} people", "colon": f"attendees: {n}",
                "team": f"team of {n}", "party": f"party of {n}", "guests": f"{n} guests"}[style]

    def new_file(self) -> dict:
        self.file_no += 1
        fid = self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 9, "F")
        ext = self.r.choice(["jpg", "png", "pdf"])
        return {"id": fid, "name": f"scan_{self.file_no:03d}.{ext}",
                "mimetype": {"jpg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}[ext]}

    def choose_style(self, f: dict, spec: dict, post: date, traps: dict) -> dict:
        """Decide the textual form of a receipt: template, category field, amount and date styles."""
        r = self.r
        st = {"template": "A", "cat_field": f["category"], "amount": "dollar", "date": "iso"}
        if traps.get("synonym"):
            st["cat_field"] = None if r.random() < 0.45 else r.choice(spec["syn"])
            if st["cat_field"] is not None and st["cat_field"].lower() == f["category"].lower():
                st["cat_field"] = None
        if traps.get("words") and f["amount"] < 10000:
            st["amount"] = "words"
        elif traps.get("currency"):
            st["amount"] = r.choice(["usd_suffix", "usd_prefix"])
        elif r.random() < 0.3:
            st["amount"] = "dollar0"
        if traps.get("date"):
            st["date"] = r.choice(self.date_styles(f["date"], post))
        if self.d != "d1" and r.random() < 0.45:
            st["template"] = r.choice(["B", "C", "D"])
        if st["cat_field"] is None and st["template"] == "A" and r.random() < 0.5:
            st["template"] = r.choice(["B", "C", "D"])
        return st

    def render(self, f: dict, spec: dict, st: dict, post: date, *, prefix: str = "") -> tuple[str, list[dict]]:
        r = self.r
        desc = spec.get("desc")
        if spec.get("sub") == "hotel":
            city, country = spec["city"]
            n = spec["nights"]
            nights = {"digits": f"{n} night{'s' if n > 1 else ''}", "words": f"{ONES[n]} night{'s' if n > 1 else ''}",
                      "dash": f"{n}-night stay"}[spec["nights_style"]]
            if spec.get("intl_style") == "country":
                place = f"{city}, {country}"
            elif spec.get("intl_style") == "word":
                place = f"{city} (international)"
            else:
                place = city
            if spec["nights_style"] == "dash":
                desc = f"{nights} at the {spec['hotel']} in {place}"
                desc = desc[0].upper() + desc[1:]
            else:
                desc = r.choice([f"Hotel in {place}, {nights}", f"Lodging in {place} ({nights})",
                                 f"{spec['hotel']} in {place}, {nights}"])
        elif spec.get("sub") == "flight":
            a_city, b_city = spec["route"]
            h = spec["hours"]
            hh, mm = int(h), int(round((h - int(h)) * 60))
            if spec["hours_style"] == "hm" and mm:
                dur = f"{hh}h {mm}m"
            elif spec["hours_style"] == "hours":
                dur = f"{h.normalize():f} hours" if mm in (0, 30) else f"{hh}h {mm}m"
            else:
                dur = f"{hh}h" if not mm else f"{hh}h {mm}m"
            parts = [r.choice([f"Flight {a_city} to {b_city}", f"Airfare {a_city} - {b_city}"])]
            if spec["cabin"]:
                parts.append(spec["cabin"] if spec["cabin"] != "business" else r.choice(["business", "business class"]))
            parts.append(dur)
            desc = ", ".join(parts)
        amount = self.amount_text(f["amount"], st["amount"])
        dtext = self.date_text(f["date"], post, st["date"])
        extras = []
        if f["attendees"] is not None:
            extras.append(self.attendees_text(f["attendees"], spec.get("att_style") or "attendees"))
        if f["client"]:
            extras.append(f"client: {f['client']}")
        if st["template"] != "A" and st["cat_field"]:
            extras.append(f"category: {st['cat_field']}")
        files = []
        if f["receipt"]:
            if r.random() < 0.6:
                files.append(self.new_file())
            else:
                extras.append("receipt: yes")
        else:
            ns = spec.get("no_receipt") or r.choice(["silent", "silent", "no"])
            if ns == "no":
                extras.append("receipt: no")
            elif ns == "none":
                extras.append("no receipt")
        ex = (", " + ", ".join(extras)) if extras else ""
        t = st["template"]
        if t == "A":
            parts = [f"Expense: {desc}", amount]
            if st["cat_field"]:
                parts.append(f"category: {st['cat_field']}")
            if dtext:
                parts.append(f"date: {dtext}")
            text = ", ".join(parts) + ex
        elif t == "B":
            text = f"{desc} - {amount}" + (f" - {dtext}" if dtext else "") + ex
        elif t == "C":
            text = f"Submitting {amount} for {desc[0].lower() + desc[1:]}" + (f" ({dtext})" if dtext else "") + ex
        else:
            on = (f" on {dtext}" if st["date"] not in ("today", "yesterday") else f" {dtext}") if dtext else ""
            text = f"{desc}, {amount}{on}" + ex
        text = prefix + text + "".join(f" [file: {x['name']}]" for x in files)
        self.self_check(text, f, st)
        return text, files

    def self_check(self, text: str, f: dict, st: dict):
        """Solvability self-check on the rendered text (POLICY.md section 7): the category is decidable and the alcohol
        words appear exactly when the facts say so. Raises on a generator bug."""
        if st["cat_field"]:
            got = categories_in(st["cat_field"])
        else:
            got = categories_in(text)
        if got != [f["category"]]:
            raise AssertionError(f"category not decidable from {text!r} (cat field {st['cat_field']!r}): {got}")
        if words_in(text, ALCOHOL_WORDS) != f["alcohol"]:
            raise AssertionError(f"alcohol words disagree with the facts: {text!r}")
        if f["category"] == "Travel" and (words_in(text, ["hotel", "lodging"]) != (f["hotel"] is not None)
                                          or words_in(text, ["flight", "airfare"]) != (f["flight"] is not None)):
            raise AssertionError(f"hotel or flight words disagree with the facts: {text!r}")

    # -- canonical state helpers ----------------------------------------------------------------------------------------
    def cap_other(self, name: str, d: date, exclude_ts: str | None) -> Decimal:
        s = Decimal("0")
        for row in self.rows:
            c = row["cells"]
            if (c["Employee"] == name and c["Category"] == "Meals" and c["Date"] == d.isoformat()
                    and c["Attendees"] == "1" and c["Status"] != REJECTED and c["Message TS"] != exclude_ts):
                s += Decimal(c["Amount"])
        return s

    def is_repost(self, email: str, d: date, a: Decimal, before_ts: str | None = None) -> bool:
        return any(t["email"] == email and t["date"] == d and t["amount"] == a for t in self.tops)

    def row_of(self, ts: str) -> dict | None:
        return next((row for row in self.rows if row["cells"]["Message TS"] == ts), None)

    def append_row(self, cells: dict) -> dict:
        row = {"row_id": max([r_["row_id"] for r_ in self.rows], default=1) + 1, "id": self.hexid(), "cells": cells}
        self.rows.append(row)
        return row

    # -- history (world0) ---------------------------------------------------------------------------------------------
    def build_history(self):
        """Last week's receipts, processed with the canonical policy: rows, bot replies and the weekly email."""
        r = self.r
        last_mon = self.monday - timedelta(days=7)
        n = r.randint(10, 13)
        intents = ["pending-flight", "pending-hotel"][: r.choice([1, 2])]
        intents += [r.choice(["rej-category", "rej-receipt", "rej-individual"]), "ok-meal-ind", "ok-meal-team"]
        while len(intents) < n:
            intents.append(r.choice(["ok-ride", "ok-parking", "ok-supplies", "ok-software", "ok-meal-ind", "ok-train",
                                     "ok-consulting", "ok-flight"]))
        r.shuffle(intents)
        slots = []
        used = set()
        for _ in intents:
            while True:
                day = r.randint(0, 4)
                m = r.randint(8 * 60, 16 * 60 + 30)
                if (day, m) not in used:
                    used.add((day, m))
                    slots.append(last_mon + timedelta(days=day, minutes=m))
                    break
        plans = list(zip(sorted(slots), intents))
        # the cap-history scenario: two individual meals of one employee on last Thursday or Friday
        if self.cap_hist:
            emp, d0 = self.cap_hist["emp"], self.cap_hist["date"]
            for k, a in enumerate(self.cap_hist["setup"]):
                at = datetime.combine(d0, time(12 + 5 * k, r.randint(0, 50)), tzinfo=UTC)
                plans.append((at, ("hist-cap", emp, a)))
            plans.sort(key=lambda x: x[0])
        self.hist = []
        for at, intent in plans:
            if isinstance(intent, tuple):
                _, emp, a = intent
                f, spec = self.facts("cap-setup", at.date(), {"date": self.cap_hist["date"], "amount": a})
            else:
                emp = r.choice([s for s in self.submitters if s is not (self.cap_hist or {}).get("emp")])
                f, spec = self.facts(intent, at.date())
                if f["category"] == "Meals" and individual(f):
                    left = LIMITS["cap"] - self.cap_other(emp["name"], f["date"], None)
                    if f["amount"] > left:
                        f["amount"] = max(Decimal("8.00"), (left - Decimal("1.00")).quantize(CENT))
                while self.is_repost(emp["email"], f["date"], f["amount"]):
                    f["amount"] += Decimal("1.17")
            st = {"template": "A", "cat_field": f["category"], "amount": "dollar", "date": "iso"}
            if r.random() < 0.3:
                st["template"] = r.choice(["B", "C", "D"])
            text, files = self.render(f, spec, st, at.date())
            ts = self.ts(at)
            self.msgs0.append({"ts": ts, "channel": CHAN, "user": emp["slack_id"], "text": text, "at": at,
                               "attachments": files, "bot": False})
            status, reason, _ = decide(f, self.cap_other(emp["name"], f["date"], None) if individual(f) else Decimal("0"))
            row = None
            if status:
                row = self.append_row(row_cells(ts, at.date().isoformat(), emp["name"], f, status))
            reply_at = at + timedelta(minutes=r.randint(1, 3))
            self.msgs0.append({"ts": self.ts(reply_at), "channel": CHAN, "user": "USLACKBOT", "text": reply_text(status, reason, f),
                               "at": reply_at, "attachments": [], "bot": True, "thread_ts": ts})
            self.receipts[ts] = {"ts": ts, "emp": emp, "at": at, "facts": f, "cur": dict(f), "spec": spec, "row": row,
                                 "status": status, "reason": reason, "preapproved": False, "history": True,
                                 "intent": intent if isinstance(intent, str) else "hist-cap"}
            self.tops.append({"email": emp["email"], "ts": ts, "date": f["date"], "amount": f["amount"]})
            self.hist.append(ts)
        # a channel reminder from Finance (no amount: not a receipt)
        at = last_mon + timedelta(days=4, hours=9, minutes=r.randint(0, 40))
        self.msgs0.append({"ts": self.ts(at), "channel": CHAN, "user": self.finance["slack_id"], "at": at, "attachments": [],
                           "text": "Reminder: please post receipts here by Friday afternoon so they make the weekly totals.",
                           "bot": False})
        self.msgs0.sort(key=lambda m: m["at"])
        last_fri = self.friday - timedelta(days=7)
        em = weekly_email(self.rows, last_mon.date().isoformat(), last_fri.date().isoformat())
        sent = last_fri + timedelta(hours=16, minutes=1)
        self.mail0 = [{"id": self.hexid(16), "thread_id": self.hexid(16), "from_": AUTOMATION, "to": [FINANCE],
                       "subject": em["subject"], "body_plain": em["body"], "label_ids": ["SENT"], "is_read": True,
                       "date": iso_z(sent), "internal_date": iso_z(sent)}]

    # -- the week's plan ---------------------------------------------------------------------------------------------
    def plan_week(self):
        """Choose the triggers: kinds, subs, times, posters, and the links between follow-ups and their targets."""
        r, d = self.r, self.d
        n_post, n_corr = self.cnt["receipt.posted"], self.cnt["receipt.corrected"]
        n_rep, n_appr = self.cnt["receipt.reposted"], self.cnt["preapproval.reply"]
        # follow-up subs
        fix_rej = ["fix-attendees", "fix-receipt"]
        fix_ok = ["fix-amount", "fix-date", "fix-category"]
        if d == "d1":
            corr = ["fix-amount", "fix-attendees"][:n_corr]
            rep = ["repost"] * n_rep
            appr = ["approve"] * n_appr
        elif d == "d2":
            corr = [r.choice(fix_rej), r.choice(fix_ok)] + (["wrong-person"] if n_corr > 2 else [])
            rep = ["repost", "repost-history"] + (["repost"] if n_rep > 2 else [])
            appr = ["approve"] + ([r.choice(["wrong-self", "wrong-namesake", "wrong-manager", "wrong-finance", "negated",
                                             "again"])] if n_appr > 1 else [])
        else:
            corr = [r.choice(fix_rej), r.choice(fix_ok), "wrong-person"]
            if n_corr > 3:
                corr.append(r.choice(fix_rej + fix_ok))
            rep = ["repost-fixed", r.choice(["repost", "repost-history"])] + (["repost"] if n_rep > 2 else [])
            appr = ["approve", "wrong-namesake", "negated"]
        # every d2 week has at least one authority trap (a wrong corrector or approver, or an unknown poster)
        authority = "wrong-person" in corr or any(a.startswith("wrong") for a in appr)
        self.unknown = d == "d3" or (d == "d2" and (r.random() < 0.5 or not authority))
        # posted intents
        pending_kinds = ["pending-flight", "pending-hotel", "pending-consulting", "pending-software", "pending-meal",
                         "flight-long"]
        n_pending = {"d1": 1, "d2": 2, "d3": 3}[d]
        fixed: list[str] = [r.choice(pending_kinds) for _ in range(n_pending)]
        for c in corr:
            fixed.append({"fix-attendees": "rej-attendees", "fix-receipt": "rej-receipt", "fix-amount": "fixable-ok",
                          "fix-date": "fixable-ok", "fix-category": "fixable-cat", "wrong-person": "fixable-ok"}[c])
        if "repost-fixed" in rep:
            fixed.append("rej-receipt")
        if self.unknown:
            fixed.append("unknown")
        n_near = {"d1": 0, "d2": 1, "d3": 2}[d]
        fixed += ["near-dup"] * n_near
        if d == "d3":
            fixed.append("flight-six")      # the 6-hour boundary appears every d3 week
        cap_in = d == "d3" or (d == "d2" and not self.cap_hist)
        cap_under = d == "d3"
        n_cap = (3 if cap_in else 0) + (3 if cap_under else 0) + (1 if self.cap_hist else 0)
        n_free = n_post - len(fixed) - n_cap
        if n_free < 0:
            raise RuntimeError("too many fixed receipts for the week's volume")
        menu = MENU[d]
        names = sorted(menu)
        free = r.choices(names, [menu[k] for k in names], k=n_free)
        # times
        times = sorted(self.minute_slot(self.monday, self.friday + timedelta(hours=15)) for _ in range(n_post))
        idx = list(range(n_post))
        slots: list[dict | None] = [None] * n_post

        def take(pool):
            pool = [i for i in pool if slots[i] is None]
            return pool[r.randrange(len(pool))] if pool else None
        early = [i for i in idx if i < int(n_post * 0.6)]
        # cap scenarios (setup, setup, final), same employee and expense date
        cap_emps = [s for s in self.staff if s is not (self.cap_hist or {}).get("emp")]
        r.shuffle(cap_emps)
        scen = []
        if cap_in:
            scen.append(("cap-reject", cap_emps.pop()))
        if cap_under:
            scen.append(("cap-under", cap_emps.pop()))
        for kind, emp in scen:
            free_idx = [i for i in idx if slots[i] is None]
            i0 = free_idx[r.randrange(max(1, len(free_idx) // 2))]
            later = [i for i in free_idx if i > i0]
            j, k = sorted(r.sample(later, 2))
            exp_d = times[i0].date() - timedelta(days=r.choice([0, 0, 1]))
            while True:
                if kind == "cap-reject":
                    a1, a2 = self.amt(26, 48), self.amt(26, 48)
                    a3 = self.amt(float(max(Decimal("26"), LIMITS["cap"] - a1 - a2 + 1)), 50)
                else:
                    a1, a2 = self.amt(20, 40), self.amt(20, 35)
                    target = r.choice([Decimal("100"), Decimal("100"), Decimal("95.50"), Decimal("90")])
                    a3 = min(target - a1 - a2, LIMITS["individual"])
                if len({a1, a2, a3}) == 3:
                    break
            for pos, (intent, a) in zip((i0, j, k), (("cap-setup", a1), ("cap-setup", a2), (kind, a3))):
                slots[pos] = {"intent": intent, "emp": emp, "fixed": {"date": exp_d, "amount": a}}
            self.reserved.add((emp["email"], exp_d))
        if self.cap_hist:
            self.reserved.add((self.cap_hist["emp"]["email"], self.cap_hist["date"]))
            pos = take([i for i in idx if times[i] < self.monday + timedelta(days=2)])
            slots[pos] = {"intent": "cap-history", "emp": self.cap_hist["emp"],
                          "fixed": {"date": self.cap_hist["date"], "amount": self.cap_hist["final"]}}
        for intent in fixed:
            if intent.startswith("pending") or intent in ("flight-long", "rej-attendees", "rej-receipt", "fixable-ok",
                                                          "fixable-cat"):
                pos = take(early)
            elif intent == "near-dup":
                pos = take([i for i in idx if i >= int(n_post * 0.25)])
            else:
                pos = take(idx)
            if pos is None:
                pos = take(idx)
            slots[pos] = {"intent": intent}
        for intent in free:
            slots[take(idx)] = {"intent": intent}
        posters = [s for s in self.submitters]
        for i, s in enumerate(slots):
            s["at"] = times[i]
            s["kind"] = "receipt.posted"
            if "emp" not in s:
                s["emp"] = self.contractor if s["intent"] == "unknown" else r.choice(posters)
            s["sub"] = s["intent"]
            s["key"] = f"p{i}"
        self.posted = slots
        # follow-ups
        plans = list(slots)
        end = self.friday + timedelta(hours=15, minutes=50)

        def after(t0, lo_min=12, hi=None):
            hi = min(hi or end, t0 + timedelta(days=2), end)
            try:
                return self.minute_slot(t0 + timedelta(minutes=lo_min), max(hi, t0 + timedelta(minutes=lo_min + 30)))
            except RuntimeError:
                return self.minute_slot(t0 + timedelta(minutes=lo_min), end)
        by_intent = lambda name: [s for s in slots if s["intent"] == name]  # noqa: E731
        used_targets: set[str] = set()

        def pick_target(cands):
            cands = [c for c in cands if c["key"] not in used_targets]
            c = cands[r.randrange(len(cands))]
            used_targets.add(c["key"])
            return c
        for c in corr:
            if c == "fix-attendees":
                t = pick_target(by_intent("rej-attendees"))
            elif c == "fix-receipt":
                t = pick_target([s for s in by_intent("rej-receipt") if not s.get("for_repost")])
            elif c == "fix-category":
                t = pick_target(by_intent("fixable-cat"))
            else:
                t = pick_target(by_intent("fixable-ok"))
            plans.append({"kind": "receipt.corrected", "sub": c, "target": t["key"], "at": after(t["at"])})
        pend = [s for s in slots if (s["intent"].startswith("pending") or s["intent"] == "flight-long")
                and s["at"] < self.friday + timedelta(hours=9)]
        hist_pend = [ts for ts in self.hist if self.receipts[ts]["status"] == PENDING]
        approvals = []
        for a in appr:
            if a == "approve":
                if hist_pend and (d != "d1" and r.random() < 0.4):
                    tgt, t_at = hist_pend[0], self.monday + timedelta(hours=8)
                    plans.append({"kind": "preapproval.reply", "sub": "approve", "target": tgt, "hist": True,
                                  "at": self.minute_slot(t_at, t_at + timedelta(days=3))})
                else:
                    t = pend[r.randrange(len(pend))]
                    plans.append({"kind": "preapproval.reply", "sub": "approve", "target": t["key"], "at": after(t["at"], 20)})
                approvals.append(plans[-1])
        for a in appr:
            if a == "approve":
                continue
            if a == "again":
                base = approvals[0]
                plans.append({"kind": "preapproval.reply", "sub": "again", "target": base["target"], "hist": base.get("hist"),
                              "at": after(base["at"], 20)})
                continue
            approved = {p["target"]: p["at"] for p in approvals}
            cands = [s for s in pend if s["key"] not in approved] or pend
            if a == "wrong-namesake":
                # a namesake exists for the department managers: prefer a receipt of their staff
                cands = [s for s in cands if s["emp"]["role"] == "staff"] or cands
            t = cands[r.randrange(len(cands))]
            hi = approved.get(t["key"])
            plans.append({"kind": "preapproval.reply", "sub": a, "target": t["key"], "at": after(t["at"], 15, hi)})
        for k_, rp in enumerate(rep):
            if rp == "repost-history":
                tgt = self.hist[r.randrange(len(self.hist))]
                plans.append({"kind": "receipt.reposted", "sub": rp, "target": tgt, "hist": True,
                              "at": self.minute_slot(self.monday, self.monday + timedelta(days=3))})
            elif rp == "repost-fixed":
                cands = [s for s in by_intent("rej-receipt") if s["key"] not in used_targets]
                t = pick_target(cands)
                plans.append({"kind": "receipt.reposted", "sub": rp, "target": t["key"], "at": after(t["at"], 30)})
            else:
                cands = [s for s in slots if s["intent"] not in ("unknown", "cap-setup", "cap-reject", "cap-under")
                         and s["key"] not in used_targets and s["at"] < end - timedelta(hours=3)]
                t = pick_target(cands)
                plans.append({"kind": "receipt.reposted", "sub": rp, "target": t["key"], "at": after(t["at"], 40)})
        plans.sort(key=lambda p: p["at"])
        plans.append({"kind": "week.close", "sub": "week-close", "at": self.close_at})
        self.plans = plans
        self.slot_by_key = {s["key"]: s for s in slots}

    # -- simulation ---------------------------------------------------------------------------------------------------
    def simulate(self):
        self.truth, self.triggers, self.payloads = [], [], []
        key_ts: dict[str, str] = {}
        corrected: set[str] = set()
        for n, p in enumerate(self.plans, 1):
            tid = f"s{self.seed}/t{n:02d}"
            at = p["at"]
            tr = {"trigger": tid, "index": n, "kind": p["kind"], "sub": p["sub"], "traps": [], "outcome": "no-op",
                  "expect": {"new_rows": [], "set_rows": [], "replies": [], "email": None, "escalate": False,
                             "no_row": []},
                  "assertions": []}
            ex, labels = tr["expect"], tr["traps"]
            delta = []
            if p["kind"] == "week.close":
                em = weekly_email(self.rows, self.monday.date().isoformat(), self.friday.date().isoformat())
                ex["email"] = {"to": em["to"], "subject": em["subject"], "lines": em["lines"]}
                tr["outcome"] = "act"
                tr["assertions"].append({"type": "gmail_message_sent_to_with_body_contains", "to": FINANCE,
                                         "subject": em["subject"], "body_contains": em["lines"]})
                labels += self.week_labels()
                payload = {"trigger": tid, "at": iso_z(at), "app": "schedule", "event": "week_close",
                           "data": {"week_start": self.monday.date().isoformat(), "date": self.friday.date().isoformat()}}
            elif p["kind"] in ("receipt.posted", "receipt.reposted"):
                ts = self.ts(at)
                if p["kind"] == "receipt.posted":
                    emp, f, spec, text, files = self.instantiate(p, at, labels)
                    key_ts[p["key"]] = ts
                else:
                    tgt_ts = p["target"] if p.get("hist") else key_ts[p["target"]]
                    rc = self.receipts[tgt_ts]
                    emp, f, spec = rc["emp"], dict(rc["facts"]), rc["spec"]
                    text, files = self.render_repost(rc, at, p["sub"])
                    labels.append(p["sub"])
                msg = {"ts": ts, "channel_id": self.chan[CHAN], "user_id": emp["slack_id"], "text": text,
                       "attachments": files, "is_bot": False, "created_at": naive(at)}
                delta.append({"op": "insert", "app": "slack", "collection": "messages", "record": msg})
                payload = {"trigger": tid, "at": iso_z(at), "app": "slack", "event": "new_message",
                           "data": {"channel": CHAN, "channel_id": self.chan[CHAN], "ts": ts, "thread_ts": None,
                                    "user": emp["slack_id"], "text": text, "attachments": copy.deepcopy(files)}}
                self.handle_top(tr, emp, f, spec, ts, at, p)
            else:
                tgt_ts = p["target"] if p.get("hist") else key_ts[p["target"]]
                rc = self.receipts[tgt_ts]
                ts = self.ts(at)
                poster, text, files = self.render_reply(p, rc, at, labels)
                msg = {"ts": ts, "channel_id": self.chan[CHAN], "user_id": poster["slack_id"], "text": text,
                       "attachments": files, "is_bot": False, "created_at": naive(at), "thread_ts": tgt_ts}
                delta.append({"op": "insert", "app": "slack", "collection": "messages", "record": msg})
                delta.append({"op": "inc", "app": "slack", "collection": "messages", "channel_id": self.chan[CHAN],
                              "ts": tgt_ts, "field": "reply_count", "by": 1})
                payload = {"trigger": tid, "at": iso_z(at), "app": "slack", "event": "new_message",
                           "data": {"channel": CHAN, "channel_id": self.chan[CHAN], "ts": ts, "thread_ts": tgt_ts,
                                    "user": poster["slack_id"], "text": text, "attachments": copy.deepcopy(files)}}
                if p["kind"] == "receipt.corrected":
                    self.handle_correction(tr, rc, poster, p, at, labels)
                    if p["sub"] != "wrong-person":
                        corrected.add(tgt_ts)
                else:
                    self.handle_approval(tr, rc, poster, p, labels)
            # de-duplicate labels, keep order
            seen = []
            for x in labels:
                if x not in seen:
                    seen.append(x)
            tr["traps"] = seen
            trig = {"trigger": tid, "index": n, "kind": p["kind"], "sub": p["sub"], "at": iso_z(at), "payload": payload,
                    "delta": delta, "traps": seen}
            self.truth.append(tr)
            self.triggers.append(trig)
            self.payloads.append(payload)
        self.end = {"week_start": self.monday.date().isoformat(), "friday": self.friday.date().isoformat(),
                    "rows": {row["cells"]["Message TS"]: dict(row["cells"]) for row in self.rows},
                    "replies": list(self.bot_replies), "reviews": list(self.reviews),
                    "human": [[t["payload"]["data"]["channel_id"], t["payload"]["data"]["ts"]] for t in self.triggers
                              if t["payload"]["app"] == "slack"],
                    "assertions": [{"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_SUB,
                                    "cell_contains": {"Message TS": row["cells"]["Message TS"],
                                                      "Amount": row["cells"]["Amount"], "Status": row["cells"]["Status"]}}
                                   for row in self.rows]}

    def week_labels(self) -> list[str]:
        out = ["week-total"]
        if any(row["cells"]["Status"] == PENDING for row in self.rows):
            out.append("pending-at-close")
        wk = self.monday.date().isoformat()
        if any(rc.get("approved_now") and rc["at"].date().isoformat() < wk for rc in self.receipts.values()):
            out.append("approved-last-week")
        if any(rc.get("corrected_row") for rc in self.receipts.values()):
            out.append("corrected-total")
        return out

    def instantiate(self, p: dict, at: datetime, labels: list[str]):
        """Facts and text for a new receipt (receipt.posted), using the canonical state (daily cap, reposts)."""
        r = self.r
        emp, intent = p["emp"], p["intent"]
        post = at.date()
        fixed = dict(p.get("fixed") or {})
        if intent == "near-dup":
            return self.near_dup(p, at, labels)
        mapped = {"fixable-ok": r.choice(["ok-supplies", "ok-software", "ok-ride", "ok-train", "ok-consulting"]),
                  "fixable-cat": r.choice(["fix-cat-supplies", "fix-cat-software"])}.get(intent, intent)
        for _ in range(60):
            if mapped == "ok-meal-ind":
                d = fixed.get("date") or self.expense_date(post)
                left = LIMITS["cap"] - self.cap_other(emp["name"], d, None)
                if left < 12 or (emp["email"], d) in self.reserved:
                    continue
                f, spec = self.facts(mapped, post, {"date": d, "cap_left": left})
            else:
                f, spec = self.facts(mapped, post, fixed)
            if intent == "fixable-ok" and f["amount"] <= LIMITS["receipt"]:
                f["receipt"] = True
            if intent in ("cap-setup", "cap-reject", "cap-under", "cap-history"):
                break
            if not self.is_repost(emp["email"], f["date"], f["amount"]):
                break
        else:
            raise RuntimeError(f"could not instantiate {intent}")
        if self.is_repost(emp["email"], f["date"], f["amount"]):
            raise RuntimeError(f"planned receipt {intent} collides with an earlier receipt")
        traps = {k: r.random() < v for k, v in FORMAT_RATE[self.d].items()}
        if intent == "cap-setup":
            traps = {k: False for k in traps}
        st = self.choose_style(f, spec, post, traps)
        if intent == "fixable-cat":
            # declared with the other category: the category field decides until the poster corrects it
            declared = "Office Supplies" if f["category"] == "Software" else "Software"
            spec["true_category"] = f["category"]
            f["category"] = declared
            st["cat_field"] = declared
            st["template"] = "A"
            labels.append("declared-category")
        try:
            text, files = self.render(f, spec, st, post)
        except AssertionError:
            if st["cat_field"] is not None:
                raise
            st["cat_field"] = f["category"]           # the words alone are ambiguous: write the category
            text, files = self.render(f, spec, st, post)
        spec["style"] = st
        self.format_labels(st, f, spec, labels)
        return emp, f, spec, text, files

    def format_labels(self, st: dict, f: dict, spec: dict, labels: list[str]):
        if st["cat_field"] is None or st["cat_field"] != f["category"]:
            labels.append("synonym")
        if st["amount"] == "words":
            labels.append("words-amount")
        elif st["amount"] in ("usd_suffix", "usd_prefix"):
            labels.append("currency-format")
        if st["date"] != "iso":
            labels.append("date-format")

    def near_dup(self, p: dict, at: datetime, labels: list[str]):
        """A receipt that looks like an earlier one but is not a repost (another date, another amount, or another
        employee): it is processed normally."""
        r = self.r
        post = at.date()
        cands = [rc for rc in self.receipts.values() if rc["facts"]["category"] in ("Travel", "Office Supplies", "Software")
                 and rc["facts"]["hotel"] is None and rc["facts"]["flight"] is None and rc["emp"]["role"] != "contractor"
                 and rc["facts"]["amount"] <= LIMITS["preapproval"]]
        base = cands[r.randrange(len(cands))]
        f = dict(base["facts"])
        spec = dict(base["spec"])
        spec.pop("style", None)
        variant = r.choice(["date", "amount", "employee"])
        emp = base["emp"]
        for _ in range(40):
            if variant == "date":
                f["date"] = post - timedelta(days=r.randint(0, 3))
            elif variant == "amount":
                f["amount"] = max(Decimal("5.00"), (f["amount"] + Decimal(r.choice([-1, 1])) * self.amt(1, 12)).quantize(CENT))
                if f["amount"] > LIMITS["receipt"] and not f["receipt"]:
                    f["receipt"] = True
            else:
                emp = r.choice([s for s in self.submitters if s is not base["emp"]])
            if f["date"] <= post and not self.is_repost(emp["email"], f["date"], f["amount"]):
                break
        else:
            raise RuntimeError("no near-duplicate found")
        st = self.choose_style(f, spec, post, {"synonym": False, "words": False, "currency": False, "date": False})
        st["template"] = base["spec"].get("style", {}).get("template", "A")
        st["cat_field"] = f["category"]
        if f["date"] != post and st["date"] == "none":
            st["date"] = "iso"
        text, files = self.render(f, spec, st, post)
        spec["style"] = st
        labels.append("near-dup")
        return emp, f, spec, text, files

    def render_repost(self, rc: dict, at: datetime, sub: str):
        r = self.r
        f = dict(rc["facts"])
        post = at.date()
        old = rc["spec"].get("style") or {"template": "A", "amount": "dollar", "date": "iso"}
        st = {"template": r.choice([t for t in "ABCD" if t != old.get("template")]), "cat_field": f["category"],
              "amount": r.choice([s for s in ["dollar", "dollar0", "words", "usd_suffix"] if s != old.get("amount")]),
              "date": r.choice(["iso", "mon", "month", "dmonth"] + (["yesterday"] if f["date"] == post - timedelta(days=1) else [])
                               + (["today"] if f["date"] == post else []))}
        if sub == "repost-fixed":
            f["receipt"] = True
        prefix = r.choice(["Not sure this went through: ", "Sending again in case it got missed: ", "",
                           "Did this one get logged? "])
        if prefix and st["template"] == "A":
            st["template"] = "B"
        spec = dict(rc["spec"])
        if sub == "repost-fixed":
            spec["no_receipt"] = None
        text, files = self.render(f, spec, st, post, prefix=prefix)
        if sub == "repost-fixed" and not files:
            files = [self.new_file()]
            text = text.replace(", receipt: yes", "") + f" [file: {files[0]['name']}]"
        return text, files

    def render_reply(self, p: dict, rc: dict, at: datetime, labels: list[str]):
        r = self.r
        emp = rc["emp"]
        sub = p["sub"]
        files: list[dict] = []
        if p["kind"] == "receipt.corrected":
            cur = rc["cur"]
            if sub == "wrong-person":
                poster = r.choice([s for s in self.submitters if s is not emp])
                p["new"] = {"amount": (cur["amount"] + self.amt(2, 30)).quantize(CENT)}
                text = r.choice([f"Correction: amount should be {money(p['new']['amount'])}",
                                 f"Correction: I think the amount was {money(p['new']['amount'])}"])
                labels.append("wrong-corrector")
                return poster, text, files
            poster = emp
            if sub == "fix-amount":
                for _ in range(40):
                    a = (cur["amount"] + Decimal(r.choice([-1, 1])) * self.amt(1, 40)).quantize(CENT)
                    if Decimal("5") < a <= LIMITS["preapproval"] and (cur["receipt"] or a <= LIMITS["receipt"]) and a != cur["amount"]:
                        break
                p["new"] = {"amount": a}
                text = r.choice([f"Correction: amount should be {self.amount_text(a, r.choice(['dollar', 'dollar', 'words']))}",
                                 f"Correction: the amount was {money(a)} (typo)", f"correction - amount {money(a)}"])
            elif sub == "fix-date":
                while True:
                    nd = at.date() - timedelta(days=r.randint(0, 5))
                    if nd != cur["date"]:
                        break
                p["new"] = {"date": nd}
                text = r.choice([f"Correction: date {nd.isoformat()}", f"Correction: the date should be {MONTHS[nd.month - 1][:3]} {nd.day}",
                                 f"Correction: date was {nd.day} {MONTHS[nd.month - 1]}"])
            elif sub == "fix-category":
                nc = rc["spec"]["true_category"]
                p["new"] = {"category": nc}
                text = r.choice([f"Correction: category should be {nc}", f"Correction: category {nc}",
                                 f"Correction: wrong category, it is {nc}"])
            elif sub == "fix-attendees":
                a = cur["amount"]
                lo = int((a / LIMITS["team_pp"]).to_integral_value(rounding="ROUND_CEILING"))
                n = max(2, lo) + r.randint(0, 2)
                p["new"] = {"attendees": n}
                text = r.choice([f"Correction: there were {n} attendees", f"Correction: attendees: {n}",
                                 f"Correction: {n} people at this one"])
            elif sub == "fix-receipt":
                p["new"] = {"receipt": True}
                if r.random() < 0.75:
                    files = [self.new_file()]
                    text = r.choice(["Correction: receipt attached", "Correction: here is the receipt"]) + \
                        f" [file: {files[0]['name']}]"
                else:
                    text = "Correction: receipt: yes (paper copy dropped at the finance desk)"
            else:
                raise ValueError(sub)
            labels.append("correction")
            return poster, text, files
        # pre-approval replies
        mgr = self.manager_of(emp)
        if sub in ("approve", "again", "negated"):
            poster = mgr
            if sub == "negated":
                text = r.choice(["Not pre-approved yet - please send me the agenda first",
                                 "not pre-approved, this needs the client name"])
                labels.append("approval-negated")
            else:
                text = r.choice(["Pre-approved.", "pre-approved, thanks", "Pre-approved - go ahead"])
                if sub == "again":
                    text = r.choice(["Pre-approved (confirming).", "pre-approved again, sorry for the delay"])
                    labels.append("approval-again")
        else:
            labels.append("wrong-approver")
            if sub == "wrong-self":
                poster = emp
                text = r.choice(["Pre-approved by my manager on our call", "pre-approved (verbally, by my manager)"])
            elif sub == "wrong-finance":
                poster = self.finance if self.finance is not emp and self.finance is not mgr else \
                    r.choice([s for s in self.staff if s is not emp])
                text = "Pre-approved from the finance side"
            elif sub == "wrong-namesake":
                poster = next((s for s in self.people if s.get("namesake_of") == mgr["email"]), None)
                if poster is None or poster is emp:
                    poster = r.choice([m for m in self.managers.values() if m is not mgr and m is not emp])
                else:
                    labels.append("namesake")
                text = r.choice(["Pre-approved.", "pre-approved"])
            else:
                poster = r.choice([m for m in self.managers.values() if m is not mgr and m is not emp])
                text = r.choice(["Pre-approved.", "pre-approved, looks fine to me"])
        return poster, text, files

    # -- canonical handling -------------------------------------------------------------------------------------------
    def handle_top(self, tr: dict, emp: dict, f: dict, spec: dict, ts: str, at: datetime, p: dict):
        ex, labels = tr["expect"], tr["traps"]
        tid = tr["trigger"]
        if emp["role"] == "contractor":
            ex["escalate"] = True
            tr["outcome"] = "escalate"
            labels.append("unknown-poster")
            tr["assertions"].append({"type": "slack_message_exists", "channel_name": REVIEW, "text_contains": tid})
            self.reviews.append(tid)
            return
        repost = self.is_repost(emp["email"], f["date"], f["amount"])
        self.tops.append({"email": emp["email"], "ts": ts, "date": f["date"], "amount": f["amount"]})
        if repost:
            if p["kind"] != "receipt.reposted":
                raise RuntimeError(f"{tid}: an unplanned repost")
            ex["no_row"].append(ts)
            tr["assertions"].append({"type": "google_sheets_row_not_exists", "spreadsheet_id": SS, "worksheet_id": WS_SUB,
                                     "cell_contains": {"Message TS": ts}})
            return
        if p["kind"] == "receipt.reposted":
            raise RuntimeError(f"{tid}: a planned repost is not one")
        other = self.cap_other(emp["name"], f["date"], None) if individual(f) else Decimal("0")
        status, reason, rule = decide(f, other)
        self.receipt_labels(f, spec, emp, status, reason, other, labels)
        text = reply_text(status, reason, f)
        row = None
        if status:
            cells = row_cells(ts, at.date().isoformat(), emp["name"], f, status)
            row = self.append_row(cells)
            ex["new_rows"].append({"cells": dict(cells)})
            tr["assertions"].append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_SUB,
                                     "cell_contains": {k: cells[k] for k in ("Message TS", "Amount", "Category", "Status")}})
        else:
            ex["no_row"].append(ts)
            tr["assertions"].append({"type": "google_sheets_row_not_exists", "spreadsheet_id": SS, "worksheet_id": WS_SUB,
                                     "cell_contains": {"Message TS": ts}})
        self.reply(tr, ts, text)
        tr["outcome"] = "act"
        self.receipts[ts] = {"ts": ts, "emp": emp, "at": at, "facts": dict(f), "cur": dict(f), "spec": spec, "row": row,
                             "status": status, "reason": reason, "preapproved": False, "history": False,
                             "intent": p.get("intent")}

    def receipt_labels(self, f, spec, emp, status, reason, other, labels):
        if f["alcohol"]:
            labels.append("drinks")
        if f["hotel"] is not None and f["hotel"]["intl"]:
            labels.append("hotel-intl")
        if f["flight"] is not None and f["flight"]["cabin"] != "economy":
            labels.append("flight-six" if f["flight"]["hours"] == LIMITS["flight_hours"] else
                          ("flight-long" if f["flight"]["hours"] > LIMITS["flight_hours"] else "rule-flight"))
        if reason == "Over daily meal cap":
            labels.append("meal-cap")
        elif individual(f) and status and other > 0 and other + f["amount"] >= Decimal("75"):
            labels.append("cap-under")
        if reason == "Over daily meal cap" or (individual(f) and other > 0):
            hist_rows = [row for row in self.rows if row["cells"]["Employee"] == emp["name"]
                         and row["cells"]["Date"] == f["date"].isoformat() and row["cells"]["Category"] == "Meals"
                         and self.receipts.get(row["cells"]["Message TS"], {}).get("history")]
            if hist_rows:
                labels.append("cap-history")
        if status and emp["slack_name"] != emp["name"]:
            labels.append("display-name")
        if status == PENDING:
            labels.append("pending")
        if status and f["category"] == "Meals" and not individual(f) and f["amount"] > LIMITS["cap"]:
            labels.append("team-meal")
        if reason and reason.endswith("needs VP pre-approval"):
            labels.append("rule-category")
        elif reason == "Receipt required":
            labels.append("rule-receipt")
        elif reason in ("Attendees required", "Over individual meal limit", "Over team meal limit"):
            labels.append("rule-meal")
        elif reason == "Over hotel nightly limit":
            labels.append("rule-hotel")

    def reply(self, tr: dict, thread_ts: str, text: str):
        tr["expect"]["replies"].append({"thread_ts": thread_ts, "text": text})
        head, rest = text.split(": ", 1)
        parts = [head + ":"] + ([rest] if head == "Rejected" else rest.split(" ", 1))
        tr["assertions"].append({"type": "slack_message_exists", "channel_name": CHAN, "text_contains": parts})
        self.bot_replies.append({"thread_ts": thread_ts, "text": text})

    def handle_correction(self, tr: dict, rc: dict, poster: dict, p: dict, at: datetime, labels: list[str]):
        ex = tr["expect"]
        if poster is not rc["emp"]:
            return
        cur = dict(rc["cur"])
        cur.update(p["new"])
        if "category" in p["new"] and cur["category"] != "Meals":
            cur["attendees"] = None
        rc["cur"] = cur
        emp = rc["emp"]
        other = self.cap_other(emp["name"], cur["date"], rc["ts"]) if individual(cur) else Decimal("0")
        status, reason, rule = decide(cur, other)
        if status == PENDING and rc["preapproved"]:
            status = APPROVED
        if rc["row"] is not None:
            row = rc["row"]
            new = dict(row["cells"])
            fresh = row_cells(rc["ts"], new["Submitted"], new["Employee"], cur, status or REJECTED)
            for k in ("Date", "Amount", "Category", "Attendees", "Status"):
                new[k] = fresh[k]
            row["cells"] = new
            ex["set_rows"].append({"message_ts": rc["ts"], "cells": dict(new)})
            rc["corrected_row"] = True
            tr["assertions"].append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_SUB,
                                     "cell_contains": {k: new[k] for k in ("Message TS", "Amount", "Category", "Status")}})
        elif status:
            cells = row_cells(rc["ts"], rc["at"].date().isoformat(), emp["name"], cur, status)
            rc["row"] = self.append_row(cells)
            ex["new_rows"].append({"cells": dict(cells)})
            labels.append("correction-fix")
            rc["corrected_row"] = True
            tr["assertions"].append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_SUB,
                                     "cell_contains": {k: cells[k] for k in ("Message TS", "Amount", "Category", "Status")}})
        else:
            ex["no_row"].append(rc["ts"])
        rc["status"], rc["reason"] = status, reason
        if ex["new_rows"] and emp["slack_name"] != emp["name"]:
            labels.append("display-name")
        self.reply(tr, rc["ts"], reply_text(status, reason, cur))
        tr["outcome"] = "act"

    def handle_approval(self, tr: dict, rc: dict, poster: dict, p: dict, labels: list[str]):
        mgr = self.manager_of(rc["emp"])
        ok_text = p["sub"] in ("approve", "again")
        row = rc["row"]
        if not (ok_text and poster is mgr and row is not None and row["cells"]["Status"] == PENDING):
            return
        new = dict(row["cells"], Status=APPROVED)
        row["cells"] = new
        rc["status"], rc["preapproved"], rc["approved_now"] = APPROVED, True, True
        tr["expect"]["set_rows"].append({"message_ts": rc["ts"], "cells": dict(new)})
        tr["assertions"].append({"type": "google_sheets_row_exists", "spreadsheet_id": SS, "worksheet_id": WS_SUB,
                                 "cell_contains": {"Message TS": rc["ts"], "Status": APPROVED}})
        labels.append("approval")
        if rc["history"]:
            labels.append("approval-history")
        if mgr["slack_name"] != mgr["name"]:
            labels.append("manager-display-name")
        f = {"amount": Decimal(new["Amount"]), "category": new["Category"]}
        self.reply(tr, rc["ts"], reply_text(APPROVED, None, f))
        tr["outcome"] = "act"

    # -- world ----------------------------------------------------------------------------------------------------------
    def world_dict(self) -> dict:
        created0 = "2025-01-06T09:00:00"
        users = []
        for p in sorted(self.people + [self.contractor], key=lambda x: x["slack_id"]):
            first, last = p["slack_name"].split(" ", 1)
            users.append({"id": p["slack_id"], "name": p["slack_name"], "username": f"{first}.{last}".lower(),
                          "email": p["email"], "first_name": first, "last_name": last,
                          "title": {"director": "Operations Director", "manager": f"{p['dept']} Manager",
                                    "finance": "Finance Specialist", "staff": p.get("dept") or "",
                                    "contractor": "Contractor (Northwind Studio)"}[p["role"]]})
        members = [u["id"] for u in users]
        channels = [{"id": self.chan[CHAN], "name": CHAN, "topic": "Post one receipt per message",
                     "member_ids": members, "created": created0},
                    {"id": self.chan[REVIEW], "name": REVIEW, "topic": "Items the automations could not decide",
                     "member_ids": members, "created": created0},
                    {"id": self.chan[GENERAL], "name": GENERAL, "topic": "Company-wide", "member_ids": members,
                     "created": created0, "is_general": True}]
        msgs = []
        replies: dict[str, int] = {}
        for m in self.msgs0:
            if m.get("thread_ts"):
                replies[m["thread_ts"]] = replies.get(m["thread_ts"], 0) + 1
        for m in self.msgs0:
            rec = {"ts": m["ts"], "channel_id": self.chan[m["channel"]], "user_id": m["user"], "text": m["text"],
                   "is_bot": m["bot"], "created_at": naive(m["at"]), "attachments": m["attachments"],
                   "reply_count": replies.get(m["ts"], 0)}
            if m.get("thread_ts"):
                rec["thread_ts"] = m["thread_ts"]
            if m["bot"]:
                rec["bot_name"] = "Zapier"
            msgs.append(rec)
        emp_rows = [p for p in self.people]
        order = list(range(len(emp_rows)))
        self.r.shuffle(order)
        emp_sheet = []
        for k, i in enumerate(order):
            p = emp_rows[i]
            emp_sheet.append({"id": self.hexid(), "row_id": k + 2,
                              "cells": {"Employee": p["name"], "Email": p["email"], "Department": p["dept"],
                                        "Manager": p["manager_name"], "Manager Email": p["manager_email"]}})
        pol = [{"id": self.hexid(), "row_id": i + 2, "cells": dict(zip(POL_HEADERS, row))}
               for i, row in enumerate(POLICY_ROWS)]
        sub_rows = [{"id": row["id"], "row_id": row["row_id"], "cells": dict(row["cells"])} for row in self.rows0]
        sheets = [{"id": SS, "title": SS_TITLE, "worksheets": [
            {"id": WS_SUB, "title": WS_TITLE[WS_SUB], "headers": SUB_HEADERS, "rows": sub_rows},
            {"id": WS_EMP, "title": WS_TITLE[WS_EMP], "headers": EMP_HEADERS, "rows": emp_sheet},
            {"id": WS_POL, "title": WS_TITLE[WS_POL], "headers": POL_HEADERS, "rows": pol}]}]
        return {"meta": {"schema_version": "0.1.0", "current_time": iso_z(self.monday + timedelta(hours=7)),
                         "allowed_services": list(APPS)},
                "slack": {"channels": channels, "users": users, "messages": msgs},
                "google_sheets": {"spreadsheets": sheets},
                "gmail": {"messages": copy.deepcopy(self.mail0), "labels": [], "drafts": []}}

    def run(self) -> dict:
        r = self.r
        self.chan = {c: self.uid("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789", 10, "C") for c in (CHAN, REVIEW, GENERAL)}
        self.build_people()
        # the cap-history scenario (d2: half the seeds, d3: always): last Thursday or Friday
        self.cap_hist = None
        if self.d == "d3" or (self.d == "d2" and r.random() < 0.5):
            emp = r.choice(self.staff)
            while True:
                a1, a2 = self.amt(30, 47), self.amt(30, 47)
                final = self.amt(float(max(Decimal("26"), LIMITS["cap"] - a1 - a2 + 1)), 50)
                if len({a1, a2, final}) == 3:
                    break
            self.cap_hist = {"emp": emp, "date": (self.monday - timedelta(days=r.choice([3, 4]))).date(),
                             "setup": [a1, a2], "final": final}
        self.build_history()
        self.rows0 = copy.deepcopy(self.rows)
        self.plan_week()
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
                              "slack": {}, "google_sheets": {}, "gmail": {}}}
    return {"example_id": trigger["index"],
            "prompt": [{"role": "system", "content": "standing automation " + FAMILY},
                       {"role": "user", "content": policy + "\n\nTrigger:\n" + canon(trigger["payload"])}],
            "answer": "", "info": json.dumps(info)}


TRAP_KIND = {"synonym": "T-format", "words-amount": "T-format", "currency-format": "T-format",
             "date-format": "T-format", "drinks": "T-format", "hotel-intl": "T-format", "flight-long": "T-format",
             "flight-six": "T-format", "declared-category": "T-format",
             "wrong-corrector": "T-authority", "wrong-approver": "T-authority", "unknown-poster": "T-authority",
             "namesake": "T-lookalike", "display-name": "T-lookalike", "manager-display-name": "T-lookalike",
             "approval-negated": "T-format",
             "repost": "T-repeat", "repost-history": "T-repeat", "repost-fixed": "T-repeat", "near-dup": "T-repeat",
             "approval-again": "T-repeat",
             "meal-cap": "T-state", "cap-history": "T-state", "cap-under": "T-state", "correction": "T-state",
             "correction-fix": "T-state", "approval": "T-state", "approval-history": "T-state",
             "pending-at-close": "T-state", "approved-last-week": "T-state", "corrected-total": "T-state",
             "pending": "context", "team-meal": "context", "week-total": "context", "rule-category": "context", "rule-receipt": "context", "rule-meal": "context",
             "rule-hotel": "context", "rule-flight": "context"}
# Labels that are context rather than a trap the trigger must resolve (they do not count toward the trap share).
CONTEXT_LABELS = {k for k, v in TRAP_KIND.items() if v == "context"}


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
    rc = [t for t in out["truth"] if t["kind"] == "receipt.posted"]

    def trapped(t):
        return bool(set(t["traps"]) - CONTEXT_LABELS)
    out["meta"] = {"family": FAMILY, "version": VERSION, "seed": seed, "difficulty": difficulty,
                   "week": out["end"]["week_start"], "n_triggers": len(out["truth"]), "kinds": dict(sorted(kinds.items())),
                   "outcomes": dict(sorted(outcomes.items())), "traps": dict(sorted(traps.items())),
                   "receipt_trap_share": round(sum(1 for t in rc if trapped(t)) / max(1, len(rc)), 3),
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
                                      "receipt_trap_share", "trigger_trap_share")}))


if __name__ == "__main__":
    main()
