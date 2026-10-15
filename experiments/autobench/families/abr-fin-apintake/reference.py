"""abr-fin-apintake reference workflow (observable-only, author-written code, no model).

It implements POLICY.md and sees only what every arm sees: the trigger payload, the policy's constants, and the tools
(ctx.fetch -> AutomationBench's api_fetch on the simulated Gmail, Google Sheets, QuickBooks and Slack). It never imports
the generator or the oracle and keeps no private state: Pending Invoices (invoice state), Blocked Vendors, Purchase
Orders, Receiving, Approvers, the Policy Log, #accounts-payable and QuickBooks are the state of record, read back on
every trigger.

`Ap` exposes one method per policy rule so that controls.py can break exactly one rule at a time.
Entry point: handle(trigger, ctx).
"""
from __future__ import annotations

import base64
import json
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/"
SLACK = "https://slack.com/api/"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/"
QB = "https://quickbooks.api.intuit.com/v3/company/ap/"
SS = "ss_ap"
WS_PENDING, WS_BLOCKED, WS_PO = "ws_pending", "ws_blocked", "ws_po"
WS_RECV, WS_APPROVERS, WS_POLICY = "ws_receiving", "ws_approvers", "ws_policy_log"
AP_CHANNEL, REVIEW = "accounts-payable", "automation-review"
AP_LEAD = "ap-lead@company.example.com"
CFO = "cfo@company.example.com"
OPEN, PROCESSING, REJECTED = "Open", "Processing", "Rejected - Blocked"
AWAIT_RECEIPT, MATCHED = "Awaiting Receipt", "Matched"
PV_REVIEW, PV_HOLD, QD_HOLD = "Price Variance - Review", "Price Variance - Hold", "Quantity Discrepancy - Hold"
NOTIFY = (QD_HOLD, PV_REVIEW, PV_HOLD)
NOT_REQUIRED, AWAITING, APPROVED = "Not Required", "Awaiting Approval", "Approved"
P_APPROVAL, P_CFO = "Approval threshold", "CFO threshold"
LABELS = {"vendor": ("vendor",), "inv": ("invoice number", "invoice #", "invoice no"), "date": ("invoice date", "date"),
          "due": ("due date", "due"), "po": ("po number", "po #", "purchase order"), "qty": ("quantity", "qty"),
          "amount": ("amount", "amount due", "total due")}
DATE_FORMATS = ("%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%d %B %Y")


def norm(s) -> str:
    """POLICY section 3: names, statuses and labels compare ignoring letter case and runs of spaces."""
    return " ".join(str(s or "").split()).lower()


def address(s) -> str:
    return str(s or "").strip().lower()


def sender(header) -> str:
    """The address of a From header: the part in angle brackets, else the whole value."""
    m = re.search(r"<([^<>]+)>\s*$", str(header or ""))
    return address(m.group(1) if m else header)


def key(s) -> str:
    """Invoice and PO numbers compare ignoring letter case and surrounding spaces."""
    return str(s or "").strip().upper()


def cents(s) -> int | None:
    """'$4,750.00', '$4750', 'USD 4,750.00', '4,750.00 USD', '4750.00' -> 475000."""
    t = re.sub(r"(?i)usd|\$|,|\s", "", str(s or ""))
    m = re.fullmatch(r"(\d+)(?:\.(\d{1,2}))?", t)
    if not m:
        return None
    return int(m.group(1)) * 100 + int(((m.group(2) or "") + "00")[:2])


def money(c: int) -> str:
    return f"{c // 100}.{c % 100:02d}"


def usd(c: int) -> str:
    return f"${c // 100:,}.{c % 100:02d}"


def parse_day(s) -> date | None:
    t = " ".join(str(s or "").split())
    for f in DATE_FORMATS:
        try:
            return datetime.strptime(t, f).date()
        except ValueError:
            continue
    return None


def parse_time(s) -> datetime:
    dt = datetime.fromisoformat(str(s).strip().replace("Z", "+00:00").replace(" ", "T", 1))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def names_number(text: str, number: str) -> bool:
    return re.search(rf"(?<![A-Za-z0-9-]){re.escape(number.strip())}(?![A-Za-z0-9-])", text or "", re.I) is not None


def approves(text: str, number: str) -> bool:
    """POLICY section 7: 'Approved' directly followed by the Invoice # (optional ':' or '-'), not 'Not approved'."""
    pat = re.compile(rf"\b(not\s+)?approved\s*[:\-]?\s*{re.escape(number.strip())}(?![A-Za-z0-9-])", re.I)
    return any(m.group(1) is None for m in pat.finditer(text or ""))


def correction_amount(text: str) -> int | None:
    m = re.search(r"the correct amount is\s*((?:USD\s*)?\$?\s*[\d,]+(?:\.\d{1,2})?)", text or "", re.I)
    return cents(m.group(1)) if m else None


class Ap:
    def __init__(self, trigger: dict, ctx):
        self.t, self.ctx = trigger, ctx
        self.at = parse_time(trigger.get("at"))
        self.today = self.at.date().isoformat()

    # -- tools ----------------------------------------------------------------------------------------------------------
    def call(self, method: str, url: str, params=None, body=None):
        out = self.ctx.fetch_json(method, url, params, body)
        if isinstance(out, dict) and (out.get("error") or out.get("ok") is False or out.get("Fault")):
            raise RuntimeError(f"{method} {url}: {out}")
        return out

    def calls(self, specs: list[tuple]) -> list:
        """One step: several reads at once (as parallel tool calls)."""
        outs = self.ctx.batch([{"name": "api_fetch", "arguments": self.ctx.fetch_args(*s)} for s in specs])
        res = []
        for s, o in zip(specs, outs):
            v = json.loads(o)
            if isinstance(v, dict) and (v.get("error") or v.get("ok") is False or v.get("Fault")):
                raise RuntimeError(f"{s[0]} {s[1]}: {v}")
            res.append(v)
        return res

    @staticmethod
    def sheet_spec(ws: str) -> tuple:
        return ("GET", f"{SHEETS}{SS}/values/{quote(ws)}")

    @staticmethod
    def rows_of(values_out: dict) -> list[tuple[int, dict]]:
        """(A1 row number, cells) for every data row, in sheet order; the header is row 1."""
        values = values_out.get("values") or []
        if not values:
            return []
        hdr = values[0]
        return [(i + 2, dict(zip(hdr, [str(v) for v in row] + [""] * (len(hdr) - len(row))))) for i, row in enumerate(values[1:])]

    def sheet(self, ws: str) -> list[tuple[int, dict]]:
        return self.rows_of(self.call(*self.sheet_spec(ws)))

    def read(self, *names: str) -> dict:
        """Several worksheets (and 'vendors', 'bills', 'ap-history') in one step."""
        specs = []
        for n in names:
            if n == "vendors":
                specs.append(("POST", QB + "query", None, {"query": "select * from Vendor"}))
            elif n == "bills":
                specs.append(("POST", QB + "query", None, {"query": "select * from Bill"}))
            elif n == "ap-history":
                specs.append(("GET", SLACK + "conversations.history", {"channel": AP_CHANNEL, "limit": 200}))
            else:
                specs.append(self.sheet_spec(n))
        out = {}
        for n, v in zip(names, self.calls(specs)):
            if n == "vendors":
                out[n] = v.get("QueryResponse", {}).get("Vendor", [])
            elif n == "bills":
                out[n] = v.get("QueryResponse", {}).get("Bill", [])
            elif n == "ap-history":
                out[n] = v.get("messages", [])
            else:
                out[n] = self.rows_of(v)
        return out

    def append(self, ws: str, headers: list[str], cells: dict):
        self.call("POST", f"{SHEETS}{SS}/values/{ws}:append", {"valueInputOption": "RAW"},
                  {"values": [[cells.get(h, "") for h in headers]]})

    def update(self, ws: str, row_no: int, cells: dict):
        self.call("PUT", f"{SHEETS}{SS}/values/{ws}/rows/{row_no}", None, {"cells": cells})

    def send(self, to: str, subject: str, body: str):
        raw = f"To: {to.strip()}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
        self.call("POST", GMAIL + "messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})

    def post(self, channel: str, text: str):
        self.call("POST", SLACK + "chat.postMessage", None, {"channel": channel, "text": text})

    def headers(self, ws: str) -> list[str]:
        out = self.call("GET", f"{SHEETS}{SS}/values/{quote(ws)}")
        return (out.get("values") or [[]])[0]

    # -- entry ----------------------------------------------------------------------------------------------------------
    def run(self):
        app, ev, d = self.t.get("app"), self.t.get("event"), self.t.get("data") or {}
        if app == "gmail" and ev == "new_email":
            return self.on_email(d["message_id"])
        if app == "google_sheets" and ev == "new_row" and norm(d.get("worksheet")) in ("receiving", WS_RECV):
            return self.on_receiving(int(d["row_id"]))
        if app == "slack" and ev == "new_message" and norm(d.get("channel")) == AP_CHANNEL:
            return self.on_message(d.get("user_id"), d.get("text") or "")
        if app == "schedule" and ev == "payment_run":
            return self.payment_run(d["date"])
        if app == "schedule" and ev == "week_close":
            return self.week_close(d["date"])
        return None                    # a Blocked Vendors change, or anything else: nothing now (section 1)

    # -- section 4: what an email is --------------------------------------------------------------------------------------
    def on_email(self, message_id: str):
        m = self.call("GET", GMAIL + f"messages/{message_id}")
        subject = str(m.get("subject") or "")
        body = str(m.get("body_plain") or "") or re.sub(r"<[^>]+>", " ", str(m.get("body_html") or ""))
        if norm(subject).startswith("ap policy amendment"):
            return self.on_amendment(m, body)
        fields = self.parse_invoice(body)
        if fields is not None:
            return self.on_invoice(m, fields)
        return self.on_approval(m, subject + "\n" + body)

    def parse_invoice(self, body: str) -> dict | None:
        got = {}
        for line in body.splitlines():
            mm = re.match(r"^\s*([A-Za-z#][A-Za-z #]*?)\s*:\s*(.+?)\s*$", line)
            if not mm:
                continue
            label = norm(mm.group(1))
            for k, labels in LABELS.items():
                if label in labels and k not in got:
                    got[k] = mm.group(2)
        if set(got) != set(LABELS):
            return None
        f = {"vendor": " ".join(got["vendor"].split()), "inv": got["inv"].strip(), "po": got["po"].strip(),
             "date": parse_day(got["date"]), "due": parse_day(got["due"]), "amount": cents(got["amount"])}
        try:
            f["qty"] = int(cents(got["qty"]) // 100) if cents(got["qty"]) is not None else None
        except TypeError:
            f["qty"] = None
        if None in (f["date"], f["due"], f["amount"], f["qty"]):
            raise LookupError(f"an invoice email with an unreadable field: {got}")
        return f

    # -- section 5: an invoice --------------------------------------------------------------------------------------------
    def on_invoice(self, m: dict, f: dict):
        s = self.read(WS_PENDING, WS_BLOCKED, WS_PO, WS_RECV, WS_APPROVERS, WS_POLICY, "vendors", "ap-history")
        vendor, inv = f["vendor"], f["inv"]
        due = self.move_weekend(f["due"])
        if self.blocked(vendor, s[WS_BLOCKED]):
            return self.reject(m, f, due, s)
        dup = self.duplicate_of(f, s[WS_PENDING])
        if dup is not None:
            row_no, cells = dup
            notes = cells.get("Notes", "")
            return self.update(WS_PENDING, row_no, {"Notes": (notes.strip() + "; " if notes.strip() else "") + f"Duplicate: {inv}"})
        po = self.po_for(f["po"], vendor, s[WS_PO])
        if po is None:
            raise LookupError(f"invoice {inv} from {vendor} cites PO {f['po']}, which is not a purchase order of that vendor")
        amount = self.corrected(inv, s["ap-history"])
        amount = f["amount"] if amount is None else amount
        approver = self.approver_for(amount, po["Department"], s[WS_APPROVERS], s[WS_POLICY])
        cells = {"Logged": self.today, "Vendor": vendor, "Invoice #": inv, "Invoice Date": f["date"].isoformat(),
                 "Due Date": due.isoformat(), "Amount": money(amount), "Qty": str(f["qty"]), "PO #": f["po"],
                 "Approver": approver, "Match": AWAIT_RECEIPT,
                 "Approval": NOT_REQUIRED if approver == "none" else AWAITING, "Status": OPEN, "Notes": ""}
        match = self.three_way(cells, po, s[WS_RECV])
        if match is not None:
            cells["Match"] = match
        self.append(WS_PENDING, self.headers(WS_PENDING), cells)
        qbv = self.qb_vendor(vendor, s["vendors"])
        self.call("POST", QB + "bill", None, {"VendorRef": {"value": qbv["Id"]}, "DocNumber": inv,
                                               "TxnDate": f["date"].isoformat(), "DueDate": due.isoformat(),
                                               "Line": [{"Amount": money(amount), "DetailType": "AccountBasedExpenseLineDetail",
                                                         "Description": f"Invoice {inv}"}]})
        if match in NOTIFY:
            self.match_email(cells)

    def move_weekend(self, d: date) -> date:
        return d + timedelta(days=7 - d.weekday()) if d.weekday() >= 5 else d

    def blocked(self, vendor: str, rows) -> bool:
        return any(self.same_vendor(c.get("Vendor Name"), vendor) and norm(c.get("Status")) == "active block" for _, c in rows)

    def same_vendor(self, a, b) -> bool:
        return norm(a) == norm(b)

    def reject(self, m: dict, f: dict, due: date, s: dict):
        amount = self.corrected(f["inv"], s["ap-history"])
        amount = f["amount"] if amount is None else amount
        self.send(sender(m.get("from")), f"Invoice {f['inv']}: vendor relationship suspended",
                  f"Hello,\n\nThe vendor relationship with {f['vendor']} is suspended, so invoice {f['inv']} will not be "
                  f"processed.\n\nAccounts Payable")
        self.append(WS_PENDING, self.headers(WS_PENDING),
                    {"Logged": self.today, "Vendor": f["vendor"], "Invoice #": f["inv"], "Invoice Date": f["date"].isoformat(),
                     "Due Date": due.isoformat(), "Amount": money(amount), "Qty": str(f["qty"]), "PO #": f["po"],
                     "Approver": "", "Match": "", "Approval": "", "Status": REJECTED, "Notes": ""})

    def duplicate_of(self, f: dict, rows) -> tuple[int, dict] | None:
        for row_no, c in rows:
            if norm(c.get("Status")) == norm(REJECTED) or not self.same_vendor(c.get("Vendor"), f["vendor"]):
                continue
            if key(c.get("Invoice #")) == key(f["inv"]):
                return row_no, c
            d0 = parse_day(c.get("Invoice Date"))
            if cents(c.get("Amount")) == f["amount"] and d0 is not None and self.within_window(d0, f["date"]):
                return row_no, c
        return None

    def within_window(self, a: date, b: date) -> bool:
        return abs((a - b).days) <= 7

    def po_for(self, number: str, vendor: str, rows) -> dict | None:
        hits = [c for _, c in rows if key(c.get("PO #")) == key(number)]
        if len(hits) != 1 or not self.same_vendor(hits[0].get("Vendor"), vendor):
            return None
        return hits[0]

    def qb_vendor(self, vendor: str, vendors: list[dict]) -> dict:
        hits = [v for v in vendors if self.same_vendor(v.get("DisplayName"), vendor)]
        if len(hits) != 1:
            raise LookupError(f"{len(hits)} QuickBooks vendors named {vendor}")
        return hits[0]

    # -- section 8: corrections -------------------------------------------------------------------------------------------------
    def corrected(self, inv: str, history: list[dict]) -> int | None:
        """The latest AP lead correction for this Invoice # already in #accounts-payable (history is newest first)."""
        cands = [msg for msg in history if names_number(msg.get("text"), inv) and correction_amount(msg.get("text")) is not None]
        if not cands:
            return None
        emails = self.poster_emails(sorted({msg.get("user") for msg in cands if msg.get("user")}))
        for msg in cands:
            if self.is_ap_lead(emails.get(msg.get("user"), "")):
                return correction_amount(msg.get("text"))
        return None

    def poster_emails(self, user_ids: list[str]) -> dict[str, str]:
        if not user_ids:
            return {}
        outs = self.calls([("GET", SLACK + "users.info", {"user": u}) for u in user_ids])
        return {u: address((o.get("user") or {}).get("profile", {}).get("email")) for u, o in zip(user_ids, outs)}

    def is_ap_lead(self, email: str) -> bool:
        return address(email) == AP_LEAD

    def on_message(self, user_id: str, text: str):
        amount = correction_amount(text)
        if amount is None or not user_id:
            return None
        if not self.is_ap_lead(self.poster_emails([user_id]).get(user_id, "")):
            return None
        s = self.read(WS_PENDING, WS_PO, WS_RECV)
        rows = [(n, c) for n, c in s[WS_PENDING] if names_number(text, c.get("Invoice #", "")) and c.get("Invoice #", "").strip()]
        opened = [(n, c) for n, c in rows if norm(c.get("Status")) == "open"]
        if not opened:
            return None
        if len({key(c.get("Invoice #")) for _, c in opened}) > 1:
            raise LookupError("a correction names several open invoices")
        row_no, cells = opened[0]
        changes = {"Amount": money(amount)}
        if norm(cells.get("Match")) != norm(AWAIT_RECEIPT):
            po = self.po_for(cells["PO #"], cells["Vendor"], s[WS_PO])
            new = self.three_way(dict(cells, Amount=money(amount)), po, s[WS_RECV]) if po else None
            if new is not None and norm(new) != norm(cells.get("Match")):
                changes["Match"] = new
        self.update(WS_PENDING, row_no, changes)
        if changes.get("Match") in NOTIFY:
            self.match_email(dict(cells, **changes))

    # -- section 6: bands and amendments -----------------------------------------------------------------------------------------
    def thresholds(self, policy_rows) -> dict[str, int]:
        out = {}
        for p in (P_APPROVAL, P_CFO):
            best = None
            for _, c in policy_rows:
                if norm(c.get("Parameter")) != norm(p):
                    continue
                eff = parse_time(c.get("Effective"))
                if eff <= self.at and (best is None or eff > best[0]):
                    best = (eff, cents(c.get("Value")))
            if best is None or best[1] is None:
                raise LookupError(f"no {p} in force")
            out[p] = best[1]
        return out

    def approver_for(self, amount: int, dept: str, approvers, policy_rows) -> str:
        th = self.thresholds(policy_rows)
        if amount < th[P_APPROVAL]:
            return "none"
        if amount <= th[P_CFO]:
            hits = [c for _, c in approvers if norm(c.get("Role")) == "department head" and norm(c.get("Department")) == norm(dept)
                    and norm(c.get("Active")) == "yes"]
        else:
            hits = [c for _, c in approvers if norm(c.get("Role")) == "cfo" and norm(c.get("Active")) == "yes"]
        if len(hits) != 1:
            raise LookupError(f"{len(hits)} active approvers for {dept} at {usd(amount)}")
        return address(hits[0].get("Email"))

    def on_amendment(self, m: dict, body: str):
        if sender(m.get("from")) != CFO:
            return None
        param = re.search(r"(?im)^\s*Parameter\s*:\s*(.+?)\s*$", body)
        value = re.search(r"(?im)^\s*Value\s*:\s*(.+?)\s*$", body)
        if not param or not value or norm(param.group(1)) not in (norm(P_APPROVAL), norm(P_CFO)) or cents(value.group(1)) is None:
            raise LookupError("an amendment from the CFO that names no listed parameter and value")
        name = P_APPROVAL if norm(param.group(1)) == norm(P_APPROVAL) else P_CFO
        v = cents(value.group(1))
        self.append(WS_POLICY, self.headers(WS_POLICY), {"Effective": self.t["at"], "Parameter": name,
                                                         "Value": str(v // 100) if v % 100 == 0 else money(v), "Approved by": CFO})

    # -- section 7: approvals ------------------------------------------------------------------------------------------------
    def on_approval(self, m: dict, text: str):
        frm = self.from_address(m)
        hits = [(n, c) for n, c in self.sheet(WS_PENDING) if address(c.get("Approver")) == frm and norm(c.get("Status")) == "open"
                and norm(c.get("Approval")) == norm(AWAITING) and c.get("Invoice #", "").strip() and approves(text, c["Invoice #"])]
        for row_no, _ in hits:
            self.update(WS_PENDING, row_no, {"Approval": APPROVED})

    def from_address(self, m: dict) -> str:
        return sender(m.get("from"))

    # -- section 9: three-way match ----------------------------------------------------------------------------------------------
    def three_way(self, cells: dict, po: dict, receiving) -> str | None:
        recs = [(i, c) for i, (_, c) in enumerate(receiving) if key(c.get("PO #")) == key(cells["PO #"])]
        if not recs:
            return None
        received = sum(int(cents(c.get("Received Qty")) // 100) for _, c in recs)
        newest = max(recs, key=lambda x: (str(x[1].get("Received Date")), x[0]))[1]
        po_qty = int(cents(po.get("Qty")) // 100)
        if received < po_qty and self.partial_expected(newest.get("Note")):
            return None
        if not (int(cells["Qty"]) == po_qty == received):
            return QD_HOLD
        return self.variance(cents(cells["Amount"]), cents(po.get("Amount")))

    def partial_expected(self, note) -> bool:
        return "partial - expected" in norm(note)

    def variance(self, amount: int, po_amount: int) -> str:
        diff = abs(amount - po_amount)
        if diff * 100 <= 2 * po_amount:
            return MATCHED
        if diff * 100 <= 5 * po_amount:
            return PV_REVIEW
        return PV_HOLD

    def match_email(self, cells: dict):
        self.send(AP_LEAD, f"{cells['Match']}: {cells['Invoice #']}",
                  f"Invoice {cells['Invoice #']} from {cells['Vendor']} (PO {cells['PO #']}) is {cells['Match']}.\n\n"
                  f"Amount: {usd(cents(cells['Amount']))}\n\nAP automation")

    def on_receiving(self, row_no: int):
        s = self.read(WS_RECV, WS_PENDING, WS_PO)
        row = dict(s[WS_RECV]).get(row_no)
        if row is None:
            raise LookupError(f"no Receiving row {row_no}")
        rows = [(n, c) for n, c in s[WS_PENDING] if key(c.get("PO #")) == key(row.get("PO #")) and norm(c.get("Status")) == "open"
                and norm(c.get("Match")) == norm(AWAIT_RECEIPT)]
        if not rows:
            return None
        n, cells = rows[0]
        po = self.po_for(cells["PO #"], cells["Vendor"], s[WS_PO])
        if po is None:
            raise LookupError(f"row {n}: no purchase order {cells['PO #']}")
        match = self.three_way(cells, po, s[WS_RECV])
        if match is None:
            return None
        self.update(WS_PENDING, n, {"Match": match})
        if match in NOTIFY:
            self.match_email(dict(cells, Match=match))

    # -- section 10: payment run and week close ----------------------------------------------------------------------------------
    def payable(self, c: dict, blocked_rows) -> bool:
        return (norm(c.get("Status")) == "open" and norm(c.get("Match")) == norm(MATCHED)
                and norm(c.get("Approval")) in (norm(NOT_REQUIRED), norm(APPROVED)) and not self.blocked(c.get("Vendor"), blocked_rows))

    def payment_run(self, day: str):
        s = self.read(WS_PENDING, WS_BLOCKED, "vendors", "bills")
        due = [(n, c) for n, c in s[WS_PENDING] if self.payable(c, s[WS_BLOCKED])]
        pays, mails, ups = [], [], []
        for n, c in due:
            v = self.qb_vendor(c["Vendor"], s["vendors"])
            bills = [b for b in s["bills"] if b.get("VendorRef__value") == v["Id"] and key(b.get("DocNumber")) == key(c["Invoice #"])]
            if len(bills) != 1:
                raise LookupError(f"{len(bills)} QuickBooks bills for {c['Vendor']} {c['Invoice #']}")
            amt = cents(c["Amount"])
            pays.append(("POST", QB + "billpayment", None, {"VendorRef": {"value": v["Id"]}, "TotalAmt": money(amt), "PayType": "Check",
                                                            "Line": [{"Amount": money(amt), "LinkedTxn": [{"TxnId": bills[0]["Id"], "TxnType": "Bill"}]}]}))
            mails.append((v.get("PrimaryEmailAddr__Address"), c["Invoice #"], amt))
            ups.append(n)
        if pays:
            self.calls(pays)
        for to, inv, amt in mails:
            if not to:
                raise LookupError(f"no QuickBooks email for the vendor of {inv}")
            self.send(to, f"Payment processing for {inv}",
                      f"Hello,\n\nPayment for invoice {inv} ({usd(amt)}) is being processed.\n\nAccounts Payable")
        for n in ups:
            self.update(WS_PENDING, n, {"Status": PROCESSING})

    def week_close(self, day: str):
        rows = self.sheet(WS_PENDING)
        d = date.fromisoformat(day)
        monday = d - timedelta(days=d.weekday())
        logged = sum(cents(c.get("Amount")) or 0 for _, c in rows if norm(c.get("Status")) != norm(REJECTED)
                     and parse_day(c.get("Logged")) is not None and monday <= parse_day(c.get("Logged")) <= d)
        processing = sum(cents(c.get("Amount")) or 0 for _, c in rows if norm(c.get("Status")) == norm(PROCESSING))
        waiting = sum(1 for _, c in rows if norm(c.get("Status")) == "open" and norm(c.get("Approval")) == norm(AWAITING))
        self.send(AP_LEAD, f"AP week close {day}",
                  f"Hello,\n\nLogged total: {usd(logged)}; Processing total: {usd(processing)}; Awaiting approval: {waiting}\n\n"
                  f"AP automation")


def handle(trigger: dict, ctx):
    try:
        return Ap(trigger, ctx).run()
    except LookupError as e:                                     # section 11: cannot decide -> escalate, nothing else
        ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": REVIEW, "text": f"{trigger.get('trigger')}: {e}"})
        return None


if __name__ == "__main__":
    print(json.dumps({"entry": "handle(trigger, ctx)"}))
