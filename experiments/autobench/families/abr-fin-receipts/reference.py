"""abr-fin-receipts reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch / ctx.batch -> AutomationBench's api_fetch on the simulated apps). It never imports the generator or the
oracle, and it keeps no private state: the #expense-submissions channel (receipts and their threads), the Submissions
and Employees worksheets and the Slack profiles are the state of record, read back on every trigger. Receipts are read
from their free text with a small parser (POLICY.md section 7) where a workflow arm would use one typed model call.

`Receipts` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
Entry point: handle(trigger, ctx).
"""
from __future__ import annotations

import base64
import json
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import quote

SLACK = "https://slack.com/api/"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/"
SS = "ss_expense_tracker"
SUBMISSIONS, EMPLOYEES = "Submissions", "Employees"
COLUMNS = ["Message TS", "Submitted", "Employee", "Date", "Amount", "Category", "Attendees", "Status"]
CHAN, REVIEW = "expense-submissions", "automation-review"
FINANCE = "finance@company.example.com"
APPROVED, PENDING, REJECTED = "Approved", "Pending Pre-Approval", "Rejected"

# POLICY.md section 7
CATEGORIES = {
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
NOT_ALLOWED = ("Entertainment", "Personal", "Gifts")
ALCOHOL = ["drinks", "wine", "beer", "cocktails", "bar tab", "happy hour"]
COUNTRIES = ["canada", "mexico", "france", "ireland", "japan", "germany", "netherlands", "spain", "australia",
             "united kingdom", "uk", "england", "scotland", "italy", "portugal", "brazil", "india", "china",
             "singapore", "switzerland", "sweden", "norway", "denmark", "belgium", "austria", "new zealand"]
MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                           "september", "october", "november", "december"])}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})
MONTHS["sept"] = 9
MONTH_RE = "|".join(sorted(MONTHS, key=len, reverse=True))
NUM = {w: i for i, w in enumerate(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                                    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
                                    "seventeen", "eighteen", "nineteen"])}
NUM.update({w: 10 * (i + 2) for i, w in enumerate(["twenty", "thirty", "forty", "fifty", "sixty", "seventy",
                                                    "eighty", "ninety"])})
MONEY_NUM = r"(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"
LIMIT = {"receipt": Decimal("25"), "individual": Decimal("50"), "attendees": Decimal("75"), "team": Decimal("75"),
         "cap": Decimal("100"), "hotel": Decimal("250"), "hotel_intl": Decimal("350"), "hours": Decimal("6"),
         "preapproval": Decimal("500")}


def norm(s) -> str:
    return " ".join(str(s or "").split()).lower()


def has_word(text: str, words) -> bool:
    low = text.lower()
    return any(re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", low) for w in words)


def ts_date(ts: str) -> date:
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).date()


def money(a: Decimal) -> str:
    return f"${a:,.2f}"


def words_number(tokens: list[str]) -> int | None:
    total, cur, seen = 0, 0, False
    for t in tokens:
        if t == "and":
            continue
        if t in NUM:
            cur += NUM[t]
        elif t == "hundred":
            cur = (cur or 1) * 100
        elif t == "thousand":
            total += (cur or 1) * 1000
            cur = 0
        else:
            return None
        seen = True
    return total + cur if seen else None


VOCAB = set(NUM) | {"hundred", "thousand", "and"}


def words_money(text: str) -> tuple[int, Decimal] | None:
    """(position, amount) of a money amount written in words: '<number words> dollars [and <number words> cents]'."""
    low = re.sub(r"(?<=[a-z])-(?=[a-z])", " ", text.lower())
    for m in re.finditer(r"\bdollars?\b", low):
        before = re.findall(r"[a-z]+|[^\sa-z]", low[:m.start()])
        k = len(before)
        while k > 0 and before[k - 1] in VOCAB:
            k -= 1
        words = before[k:]
        while words and words[0] == "and":
            words = words[1:]
        n = words_number(words)
        if n is None:
            continue
        cents = 0
        cm = re.match(r"\s+and\s+([a-z ]+?)\s+cents?\b", low[m.end():])
        if cm:
            c = words_number(cm.group(1).split())
            cents = c or 0
        start = low.find(" ".join(words)) if words else m.start()
        return start, Decimal(n) + Decimal(cents) / 100
    return None


def parse_amount(text: str) -> Decimal | None:
    """POLICY.md section 7: $45, $45.00, $1,250.00, 45.00 USD, USD 45, or words."""
    found = []
    for rx in (r"\$\s?" + MONEY_NUM, MONEY_NUM + r"\s*USD\b", r"\bUSD\s*" + MONEY_NUM):
        for m in re.finditer(rx, text):
            found.append((m.start(), Decimal(m.group(1).replace(",", ""))))
    w = words_money(text)
    if w:
        found.append(w)
    if not found:
        return None
    return min(found, key=lambda x: x[0])[1].quantize(Decimal("0.01"))


def parse_date(text: str, posted: date, default: bool = True) -> date | None:
    """POLICY.md section 7: 2026-03-04, Mar 4, March 4, 4 March (the message's year), today, yesterday."""
    low = text.lower()
    found = []
    for m in re.finditer(r"\b(\d{4})-(\d{2})-(\d{2})\b", low):
        found.append((m.start(), date(int(m.group(1)), int(m.group(2)), int(m.group(3)))))
    for m in re.finditer(r"\b(" + MONTH_RE + r")\.?\s+(\d{1,2})\b", low):
        try:
            found.append((m.start(), date(posted.year, MONTHS[m.group(1)], int(m.group(2)))))
        except ValueError:
            pass
    for m in re.finditer(r"\b(\d{1,2})\s+(" + MONTH_RE + r")\b", low):
        try:
            found.append((m.start(), date(posted.year, MONTHS[m.group(2)], int(m.group(1)))))
        except ValueError:
            pass
    for m in re.finditer(r"\btoday\b", low):
        found.append((m.start(), posted))
    for m in re.finditer(r"\byesterday\b", low):
        found.append((m.start(), posted - timedelta(days=1)))
    if found:
        return min(found, key=lambda x: x[0])[1]
    return posted if default else None


def categories_of(text: str) -> list[str]:
    return [c for c, words in CATEGORIES.items() if has_word(text, [c.lower()] + words)]


def parse_attendees(text: str) -> int | None:
    low = text.lower()
    for rx in (r"\b(\d+)\s+(?:attendees|people|guests)\b", r"\battendees:\s*(\d+)", r"\bteam of (\d+)\b",
               r"\bparty of (\d+)\b"):
        m = re.search(rx, low)
        if m:
            return int(m.group(1))
    return None


class Undecidable(Exception):
    pass


class Receipts:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx
        self._emps = None
        self._history = None

    # -- tools ----------------------------------------------------------------------------------------------------------
    def call(self, method: str, url: str, params=None, body=None):
        out = self.ctx.fetch_json(method, url, params, body)
        if isinstance(out, dict) and (out.get("error") or out.get("ok") is False):
            raise RuntimeError(f"{method} {url}: {out}")
        return out

    def sheet(self, title: str) -> list[tuple[int, dict]]:
        """(A1 row number, cells) for every data row. Rows come back in order; the header is row 1."""
        out = self.call("GET", f"{SHEETS}{SS}/values/{quote(title)}")
        values = out.get("values") or []
        if not values:
            return []
        hdr = values[0]
        rows = [(i + 2, dict(zip(hdr, [str(v) for v in row] + [""] * (len(hdr) - len(row))))) for i, row in enumerate(values[1:])]
        last = re.search(r"(\d+)$", out.get("range", ""))
        if last and rows and int(last.group(1)) != rows[-1][0]:
            raise RuntimeError(f"row numbering does not match the returned range {out.get('range')}")
        return rows

    def append_row(self, cells: dict):
        self.call("POST", f"{SHEETS}{SS}/values/{quote(SUBMISSIONS)}:append", {"valueInputOption": "RAW"},
                  {"values": [[cells.get(c, "") for c in COLUMNS]]})

    def update_row(self, row_no: int, cells: dict):
        rng = f"{SUBMISSIONS}!A{row_no}:H{row_no}"
        self.call("PUT", f"{SHEETS}{SS}/values/{quote(rng)}", {"valueInputOption": "RAW"},
                  {"values": [[cells.get(c, "") for c in COLUMNS]]})

    def post(self, text: str, thread_ts: str | None = None, channel: str = CHAN):
        body = {"channel": channel, "text": text}
        if thread_ts:
            body["thread_ts"] = thread_ts
        self.call("POST", SLACK + "chat.postMessage", None, body)

    def send(self, to: str, subject: str, body: str):
        raw = f"To: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        self.call("POST", GMAIL + "messages/send", None,
                  {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})

    def escalate(self, reason: str):
        self.post(f"{self.t['trigger']}: {reason}", channel=REVIEW)

    def email_of(self, user_id: str) -> str | None:
        out = self.ctx.fetch_json("GET", SLACK + "users.info", {"user": user_id})
        if not isinstance(out, dict) or not out.get("ok"):
            return None
        return norm((out.get("user") or {}).get("profile", {}).get("email")) or None

    def employees(self) -> dict[str, dict]:
        if self._emps is None:
            self._emps = {norm(c.get("Email")): c for _, c in self.sheet(EMPLOYEES) if c.get("Email")}
        return self._emps

    def history(self) -> list[dict]:
        if self._history is None:
            out = self.call("GET", SLACK + "conversations.history", {"channel": CHAN, "limit": 1000})
            self._history = sorted(out.get("messages") or [], key=lambda m: float(m["ts"]))
        return self._history

    def replies(self, ts: str) -> list[dict]:
        out = self.call("GET", SLACK + "conversations.replies", {"channel": CHAN, "ts": ts, "limit": 1000})
        return sorted(out.get("messages") or [], key=lambda m: float(m["ts"]))

    # -- entry ----------------------------------------------------------------------------------------------------------
    def run(self):
        app, ev, d = self.t.get("app"), self.t.get("event"), self.t.get("data") or {}
        if app == "schedule" and ev == "week_close":
            return self.week_close(d["week_start"], d["date"])
        if app == "slack" and ev == "new_message" and norm(d.get("channel")) in (CHAN, norm(d.get("channel_id"))):
            try:
                if d.get("thread_ts"):
                    return self.thread_reply(d)
                return self.top_level(d)
            except Undecidable as e:
                return self.escalate(str(e))
        return None

    # -- section 7: reading a receipt ----------------------------------------------------------------------------------
    def category(self, text: str) -> str:
        m = re.search(r"\bcategory:\s*([^,()\n]+)", text, re.I)
        if m:
            got = categories_of(m.group(1))
        else:
            got = categories_of(text)
        if len(got) != 1:
            raise Undecidable(f"cannot tell the category of {text[:60]!r}")
        return got[0]

    def has_receipt(self, text: str, attachments) -> bool:
        return bool(attachments) or re.search(r"\breceipt:\s*yes\b", text, re.I) is not None

    def is_alcohol(self, text: str) -> bool:
        return has_word(text, ALCOHOL)

    def client(self, text: str) -> str | None:
        m = re.search(r"\bclient:\s*([^,\n]+)", text, re.I)
        return m.group(1).strip() if m and m.group(1).strip() else None

    def hotel(self, text: str, cat: str) -> dict | None:
        if cat != "Travel" or not has_word(text, ["hotel", "lodging"]):
            return None
        nights = 1
        m = re.search(r"\b(\d+|" + "|".join(NUM) + r")[\s-]+nights?\b", text.lower())
        if m:
            nights = int(m.group(1)) if m.group(1).isdigit() else NUM[m.group(1)]
        return {"nights": max(1, nights), "intl": self.international(text)}

    def international(self, text: str) -> bool:
        return has_word(text, ["international"] + COUNTRIES)

    def flight(self, text: str, cat: str) -> dict | None:
        if cat != "Travel" or not has_word(text, ["flight", "airfare"]):
            return None
        low = text.lower()
        cabin = "economy"
        if "premium economy" in low or has_word(low, ["business", "first class"]):
            cabin = "other"
        hours = None
        m = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b(?:\s*(\d+)\s*(?:m|min|mins|minutes)\b)?", low)
        if m:
            hours = Decimal(m.group(1)) + (Decimal(m.group(2)) / 60 if m.group(2) else 0)
        return {"cabin": cabin, "hours": hours}

    def read(self, text: str, attachments, posted: date) -> dict | None:
        amount = parse_amount(text)
        if amount is None:
            return None
        cat = self.category(text)
        return {"amount": amount, "date": parse_date(text, posted), "category": cat,
                "attendees": parse_attendees(text), "receipt": self.has_receipt(text, attachments),
                "alcohol": self.is_alcohol(text), "client": self.client(text), "hotel": self.hotel(text, cat),
                "flight": self.flight(text, cat)}

    # -- section 8: rules --------------------------------------------------------------------------------------------
    def individual(self, f: dict) -> bool:
        return f["category"] == "Meals" and (f["attendees"] is None or f["attendees"] == 1)

    def cap_other(self, rows, name: str, d: date, exclude_ts: str | None) -> Decimal:
        s = Decimal("0")
        for _, c in rows:
            if (norm(c.get("Employee")) == norm(name) and norm(c.get("Category")) == "meals"
                    and c.get("Date", "").strip() == d.isoformat() and self.att_value(c.get("Attendees")) == 1
                    and norm(c.get("Status")) != norm(REJECTED) and c.get("Message TS", "").strip() != (exclude_ts or "")):
                try:
                    s += Decimal(str(c.get("Amount")).replace("$", "").replace(",", ""))
                except InvalidOperation:
                    pass
        return s

    @staticmethod
    def att_value(v) -> int | None:
        try:
            return int(Decimal(str(v).strip()))
        except (InvalidOperation, ValueError):
            return None

    def meal_rule(self, f: dict, cap_other: Decimal) -> str | None:
        a, n = f["amount"], f["attendees"]
        if n is None and a > LIMIT["attendees"]:
            return "Attendees required"
        if (n is None or n == 1) and a > LIMIT["individual"]:
            return "Over individual meal limit"
        if n is not None and n >= 2 and a / n > LIMIT["team"]:
            return "Over team meal limit"
        if (n is None or n == 1) and cap_other + a > LIMIT["cap"]:
            return "Over daily meal cap"
        return None

    def hotel_rule(self, f: dict) -> str | None:
        h = f["hotel"]
        if h is None:
            return None
        lim = LIMIT["hotel_intl"] if h["intl"] else LIMIT["hotel"]
        return "Over hotel nightly limit" if f["amount"] / h["nights"] > lim else None

    def flight_rule(self, f: dict) -> str | None:
        fl = f["flight"]
        if fl is None or fl["cabin"] == "economy":
            return None
        if fl["hours"] is not None and fl["hours"] > LIMIT["hours"]:
            return None
        return "Economy only for flights up to 6 hours"

    def check(self, f: dict, cap_other: Decimal) -> tuple[str | None, str | None]:
        """(status, reason): the first failing rule of section 8, else Approved or Pending Pre-Approval."""
        if f["category"] in NOT_ALLOWED:
            return None, f"{f['category']} needs VP pre-approval"
        if f["amount"] > LIMIT["receipt"] and not f["receipt"]:
            return None, "Receipt required"
        if f["alcohol"] and not f["client"]:
            return None, "Alcohol needs a client name"
        if f["category"] == "Meals":
            why = self.meal_rule(f, cap_other)
            if why:
                return None, why
        for rule in (self.hotel_rule, self.flight_rule):
            why = rule(f)
            if why:
                return None, why
        return (PENDING if f["amount"] > LIMIT["preapproval"] else APPROVED), None

    def outcome_text(self, status, reason, amount: Decimal, category: str) -> str:
        if status is None:
            return f"Rejected: {reason}"
        if status == PENDING:
            return f"Pending pre-approval: {money(amount)} {category}"
        return f"Logged: {money(amount)} {category}"

    def row_for(self, ts: str, submitted: str, name: str, f: dict, status: str) -> dict:
        return {"Message TS": ts, "Submitted": submitted, "Employee": name, "Date": f["date"].isoformat(),
                "Amount": f"{f['amount']:.2f}", "Category": f["category"],
                "Attendees": str(f["attendees"] or 1) if f["category"] == "Meals" else "", "Status": status}

    # -- section 4: a top-level message --------------------------------------------------------------------------------
    def poster(self, user_id: str) -> dict | None:
        email = self.email_of(user_id)
        return self.employees().get(email) if email else None

    def is_repost(self, d: dict, f: dict) -> bool:
        for m in self.history():
            if float(m["ts"]) >= float(d["ts"]) or m.get("user_id") != d["user"] or m.get("is_bot"):
                continue
            a = parse_amount(m.get("text") or "")
            if a is None:
                continue
            if a == f["amount"] and parse_date(m.get("text") or "", ts_date(m["ts"])) == f["date"]:
                return True
        return False

    def top_level(self, d: dict):
        text = d.get("text") or ""
        if parse_amount(text) is None:
            return None
        emp = self.poster(d["user"])
        if emp is None:
            return self.escalate(f"the poster ({d['user']}) is not in Employees")
        f = self.read(text, d.get("attachments") or [], ts_date(d["ts"]))
        if self.is_repost(d, f):
            return None
        rows = self.sheet(SUBMISSIONS)
        other = self.cap_other(rows, emp["Employee"], f["date"], None) if self.individual(f) else Decimal("0")
        status, reason = self.check(f, other)
        if status:
            self.append_row(self.row_for(d["ts"], ts_date(d["ts"]).isoformat(), emp["Employee"], f, status))
        self.post(self.outcome_text(status, reason, f["amount"], f["category"]), thread_ts=d["ts"])

    # -- section 5: replies in a thread -------------------------------------------------------------------------------
    def parent(self, thread_ts: str) -> dict | None:
        return next((m for m in self.history() if m["ts"] == thread_ts), None)

    def thread_reply(self, d: dict):
        text = (d.get("text") or "").strip()
        parent = self.parent(d["thread_ts"])
        if parent is None or parent.get("is_bot"):
            return None
        if re.match(r"correction\b", text, re.I):
            return self.correction(d, parent)
        if re.match(r"pre-approved\b", text, re.I):
            return self.preapproval(d, parent)
        return None

    def apply_correction(self, f: dict, text: str, attachments, posted: date) -> dict:
        f = dict(f)
        low = text.lower()
        if "amount" in low or parse_amount(text) is not None:
            a = parse_amount(text)
            if a is not None:
                f["amount"] = a
        nd = parse_date(text, posted, default=False)
        if nd is not None:
            f["date"] = nd
        m = re.search(r"\bcategory\b(.*)$", text, re.I | re.S)
        if m:
            got = [(re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", m.group(1).lower()), c)
                   for c, words in CATEGORIES.items() for w in [c.lower()] + words]
            got = sorted((x.start(), c) for x, c in got if x)
            if got:
                f["category"] = got[0][1]
                if f["category"] != "Meals":
                    f["attendees"] = None
        n = parse_attendees(text)
        if n is not None:
            f["attendees"] = n
        if self.has_receipt(text, attachments):
            f["receipt"] = True
        f["hotel"] = f["hotel"] if f["category"] == "Travel" else None
        f["flight"] = f["flight"] if f["category"] == "Travel" else None
        return f

    def correction(self, d: dict, parent: dict):
        if d["user"] != parent.get("user_id"):
            return None                                      # 5.1: only the receipt's own poster corrects it
        emp = self.poster(parent["user_id"])
        if emp is None:
            raise Undecidable("a correction on a receipt whose poster is not in Employees")
        f = self.read(parent.get("text") or "", parent.get("attachments") or [], ts_date(parent["ts"]))
        if f is None:
            return None
        thread = self.replies(parent["ts"])
        preapproved = False
        for m in thread:
            if float(m["ts"]) > float(d["ts"]):
                break
            body = (m.get("text") or "").strip()
            if m.get("user_id") == parent.get("user_id") and re.match(r"correction\b", body, re.I):
                f = self.apply_correction(f, body, m.get("attachments") or [], ts_date(m["ts"]))
            elif re.match(r"pre-approved\b", body, re.I) and self.is_manager(m.get("user_id"), emp):
                preapproved = True
        rows = self.sheet(SUBMISSIONS)
        mine = next(((n, c) for n, c in rows if c.get("Message TS", "").strip() == parent["ts"]), None)
        other = self.cap_other(rows, emp["Employee"], f["date"], parent["ts"]) if self.individual(f) else Decimal("0")
        status, reason = self.check(f, other)
        if status == PENDING and preapproved:
            status = APPROVED
        if mine is not None:
            n, cells = mine
            fresh = self.row_for(parent["ts"], cells.get("Submitted", ""), cells.get("Employee", ""), f, status or REJECTED)
            new = dict(cells)
            for k in ("Date", "Amount", "Category", "Attendees", "Status"):
                new[k] = fresh[k]
            self.update_row(n, new)
        elif status:
            self.append_row(self.row_for(parent["ts"], ts_date(parent["ts"]).isoformat(), emp["Employee"], f, status))
        self.post(self.outcome_text(status, reason, f["amount"], f["category"]), thread_ts=parent["ts"])

    def is_manager(self, user_id: str | None, emp: dict) -> bool:
        if not user_id:
            return False
        email = self.email_of(user_id)
        return bool(email) and email == norm(emp.get("Manager Email"))

    def preapproval(self, d: dict, parent: dict):
        emp = self.poster(parent["user_id"])
        if emp is None or not self.is_manager(d["user"], emp):
            return None
        rows = self.sheet(SUBMISSIONS)
        mine = next(((n, c) for n, c in rows if c.get("Message TS", "").strip() == parent["ts"]), None)
        if mine is None or norm(mine[1].get("Status")) != norm(PENDING):
            return None
        n, cells = mine
        self.update_row(n, dict(cells, Status=APPROVED))
        amount = Decimal(str(cells.get("Amount")).replace("$", "").replace(",", ""))
        self.post(self.outcome_text(APPROVED, None, amount, cells.get("Category", "")), thread_ts=parent["ts"])

    # -- section 6: week close ------------------------------------------------------------------------------------------
    def week_lines(self, rows, week_start: str, friday: str) -> list[str]:
        totals: dict[str, Decimal] = {}
        pending = 0
        for _, c in rows:
            st = norm(c.get("Status"))
            if st == norm(PENDING):
                pending += 1
            sub = c.get("Submitted", "").strip()
            if st == norm(APPROVED) and week_start <= sub <= friday:
                name = c.get("Employee", "").strip()
                totals[name] = totals.get(name, Decimal("0")) + Decimal(str(c.get("Amount")).replace("$", "").replace(",", ""))
        lines = [f"{name}: {money(totals[name])}" for name in sorted(totals)]
        lines.append(f"Total: {money(sum(totals.values(), Decimal('0')))}")
        lines.append(f"Pending pre-approval: {pending}")
        return lines

    def week_close(self, week_start: str, friday: str):
        lines = self.week_lines(self.sheet(SUBMISSIONS), week_start, friday)
        self.send(FINANCE, f"Weekly expense totals {week_start}", "\n".join(lines))


def handle(trigger: dict, ctx):
    return Receipts(trigger, ctx).run()
