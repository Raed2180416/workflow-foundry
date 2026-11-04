#!/usr/bin/env python3
"""abr-p2p-audit observable-only reference workflow (author-written code, no model). Sees the payload, the policy
constants (family.spec.json) and the tools only; does its own money parsing and calendar arithmetic (N-version against
model.py). `Ref(off=..., flags=...)` builds the controls."""
from __future__ import annotations

import calendar
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE.parents[1]) not in sys.path:
    sys.path.append(str(HERE.parents[1]))
from abr.lib.factory.store import store_for  # noqa: E402

SPEC = json.loads((HERE / "family.spec.json").read_text())
UTC = timezone.utc
CH, CAL, P, ORG = SPEC["channels"], SPEC["calendar"], SPEC["params"], SPEC["org"]
SS, SSP = ORG["ss"], ORG["ss_policy"]
RELEASABLE = ("NO-GR", "QTY", "PRICE")


def when(s):
    m = re.match(r"^\s*(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?\s*(Z|UTC)?\s*$", str(s or ""), re.I)
    if not m:
        return None
    y, mo, d, h, mi, se, _ = m.groups()
    return datetime(int(y), int(mo), int(d), int(h), int(mi), int(se or 0), tzinfo=UTC)


def z(t):
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def money(s, naive=False) -> Decimal | None:
    t = str(s or "").strip()
    if naive:
        try:
            return Decimal(t)
        except ArithmeticError:
            return None
    t = re.sub(r"^(USD|US\$|\$)\s*", "", t, flags=re.I).replace(",", "")
    try:
        return Decimal(t).quantize(Decimal("0.01"))
    except ArithmeticError:
        return None


def m2(d: Decimal) -> str:
    return f"{d.quantize(Decimal('0.01')):.2f}"


def addr(s):
    m = re.search(r"<([^>]+)>", s or "")
    return (m.group(1) if m else (s or "")).strip().lower()


class Ref:
    def __init__(self, payload, ctx, off=frozenset(), flags=frozenset()):
        self.p, self.st = payload, store_for(ctx)
        self.now = when(payload.get("at"))
        self.off, self.flags = set(off), set(flags)

    def on(self, c):
        return c not in self.off

    def state(self, row, col):
        return "" if "memoryless" in self.flags else row.get(col, "").strip()

    def run(self):
        d = self.p.get("data") or {}
        ev, ws = (self.p.get("app"), self.p.get("event")), d.get("worksheet")
        if ev == ("google_sheets", "new_row") and ws == "Invoices":
            self.arrival(d.get("row") or {})
        elif (ev == ("google_sheets", "new_row") and ws == "Goods Receipts") or (ev == ("google_sheets", "updated_row") and ws == "Purchase Orders"):
            self.release((d.get("row") or {}).get("PO ID", "").strip())
        elif ev == ("schedule", "payment_run"):
            self.payment_run()
        elif ev == ("schedule", "daily_close"):
            self.close()
        elif ev == ("gmail", "new_email"):
            self.email()
        self.st.flush()

    # -- reads -----------------------------------------------------------------------------------------------------------
    def tables(self):
        return (self.st.rows(SS, "Purchase Orders"), self.st.rows(SS, "Goods Receipts"), self.st.rows(SS, "Invoices"))

    def tolerance(self, d: date) -> int:
        rows = [r for r in self.st.rows(SSP, "Policy Log") if " ".join(r["Parameter"].split()).lower() == P["amend_param"].lower()]
        if "trap_stale_policy" in self.flags:
            return int(re.sub(r"\D", "", rows[0]["Value"]))
        live = []
        for r in rows:
            try:
                eff = date.fromisoformat(r["Effective"].strip())
            except ValueError:
                continue
            if eff <= d:
                live.append((eff, int(re.sub(r"\D", "", r["Edition"]) or 0), int(re.sub(r"\D", "", r["Value"]))))
        return max(live)[2]

    def check(self, inv, pos, grs, invs, skip_dup=False):
        key = lambda s: re.sub(r"\s+", "", s).lower()  # noqa: E731
        me = inv["Invoice ID"].strip()
        mine_at = when(inv["Received At"])
        if not skip_dup and "trap_no_dedupe" not in self.flags:
            for x in invs:
                if x["Invoice ID"].strip() != me and when(x["Received At"]) and when(x["Received At"]) < mine_at \
                        and x["Supplier ID"].strip() == inv["Supplier ID"].strip() and key(x["Supplier Invoice No"]) == key(inv["Supplier Invoice No"]):
                    return "DUPLICATE"
        po = next((x for x in pos if x["PO ID"].strip() == inv["PO ID"].strip()), None)
        rec = [g for g in grs if po and g["PO ID"].strip() == po["PO ID"].strip()]
        by = inv["Entered By"].strip().lower()
        if po and "trap_no_sod" not in self.flags and (by == po["Created By"].strip().lower() or any(g["Posted By"].strip().lower() == by for g in rec)):
            return "SOD"
        if po is None:
            return "SUPPLIER"
        if "trap_lookalike" in self.flags:
            if re.sub(r"\W", "", po["Supplier Name"].lower())[:8] != re.sub(r"\W", "", inv["Supplier Name"].lower())[:8]:
                return "SUPPLIER"
        elif po["Supplier ID"].strip() != inv["Supplier ID"].strip():
            return "SUPPLIER"
        if not rec:
            return "NO-GR"
        approved = sum(int(x["Quantity"]) for x in invs if x["Invoice ID"].strip() != me and x["PO ID"].strip() == po["PO ID"].strip()
                       and x.get("Status", "").strip() in ("Approved", "Paid"))
        if int(inv["Quantity"]) + approved > sum(int(g["Quantity"]) for g in rec):
            return "QTY"
        naive = "trap_naive_money" in self.flags
        price, po_price = money(inv["Unit Price"], naive), money(po["Unit Price"], naive)
        if price is None or po_price is None:
            return "PRICE"
        tol = 0 if "trap_no_tolerance" in self.flags else self.tolerance(mine_at.date())
        lim = (po_price * (100 + tol) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if price > lim:
            return "PRICE"
        return None

    # -- invoice arrival --------------------------------------------------------------------------------------------------
    def arrival(self, row):
        if not self.on("A1"):
            return
        pos, grs, invs = self.tables()
        iid = row.get("Invoice ID", "").strip()
        inv = next((x for x in invs if x["Invoice ID"].strip() == iid), None)
        if inv is None:
            return
        reason = self.check(inv, pos, grs, invs)
        if reason is None:
            self.st.set_cells(SS, "Invoices", "Invoice ID", iid, {"Status": "Approved", "Decided At": z(self.now)}, row_id=inv["_row_id"])
            return
        self.st.set_cells(SS, "Invoices", "Invoice ID", iid, {"Status": "Hold", "Hold Reason": reason, "Decided At": z(self.now)}, row_id=inv["_row_id"])
        self.st.post(CH["holds"], f"HOLD {iid} {reason}")
        if reason == "SOD":
            audit = next((r["Value"].strip() for r in self.st.rows(SS, "Config") if r["Setting"].strip() == "Internal Audit"), "")
            self.st.mail(audit, f"SOD {iid}", f"Invoice {iid} was entered by someone who also bought or received on its PO.")

    # -- release ------------------------------------------------------------------------------------------------------------
    def release(self, po_id):
        if not self.on("A2") or "trap_no_release" in self.flags:
            return
        pos, grs, invs = self.tables()
        held = sorted((x for x in invs if x["PO ID"].strip() == po_id and self.state(x, "Status") == "Hold"
                       and self.state(x, "Hold Reason") in RELEASABLE), key=lambda x: when(x["Received At"]))
        for inv in held:
            if self.check(inv, pos, grs, invs, skip_dup=True) is None:
                self.st.set_cells(SS, "Invoices", "Invoice ID", inv["Invoice ID"].strip(), {"Status": "Approved", "Decided At": z(self.now)},
                                  row_id=inv["_row_id"])
                self.st.post(CH["holds"], f"RELEASE {inv['Invoice ID'].strip()}")
                inv["Status"] = "Approved"

    # -- schedules -----------------------------------------------------------------------------------------------------------
    def payment_run(self):
        if not self.on("A3"):
            return
        invs = self.st.rows(SS, "Invoices")
        due = sorted((x for x in invs if x.get("Status", "").strip() == "Approved"), key=lambda x: when(x["Received At"]))
        if "memoryless" in self.flags:
            due = sorted((x for x in invs if x.get("Status", "").strip() in ("Approved", "Paid")), key=lambda x: when(x["Received At"]))
        total = Decimal("0.00")
        for x in due:
            amt = money(x["Amount"], "trap_naive_money" in self.flags) or Decimal("0")
            total += amt
            self.st.append(SS, "Payment Runs", [self.now.date().isoformat(), x["Invoice ID"].strip(), m2(amt)])
            self.st.set_cells(SS, "Invoices", "Invoice ID", x["Invoice ID"].strip(), {"Status": "Paid", "Paid At": z(self.now)}, row_id=x["_row_id"])
        if due:
            self.st.post(CH["payments"], f"PAYMENT RUN {self.now.date().isoformat()} count={len(due)} total={m2(total)}")

    def close(self):
        if not self.on("A5"):
            return
        hol = {r["Date"].strip() for r in self.st.rows(SS, "Holidays")}
        d = date(self.now.year, self.now.month, calendar.monthrange(self.now.year, self.now.month)[1])
        while d.weekday() >= 5 or d.isoformat() in hol:
            d -= timedelta(days=1)
        if d != self.now.date():
            return
        held = [x for x in self.st.rows(SS, "Invoices") if x.get("Status", "").strip() == "Hold"]
        amt = sum((money(x["Amount"]) or Decimal(0) for x in held), Decimal("0.00"))
        self.st.post(CH["reports"], f"MONTH-END {self.now:%Y-%m} held={len(held)} held_amount={m2(amt)}")
        ctrl = next((r["Value"].strip() for r in self.st.rows(SS, "Config") if r["Setting"].strip() == "AP Controller"), "")
        self.st.mail(ctrl, f"AP month-end {self.now:%Y-%m}", f"{len(held)} invoices on hold, {m2(amt)} in total.")

    # -- email -----------------------------------------------------------------------------------------------------------------
    def email(self):
        if not self.on("A4"):
            return
        msg = self.st.message((self.p.get("data") or {}).get("message_id"))
        sender, text = addr(msg.get("from")), f"{msg.get('subject') or ''}\n{msg.get('body_plain') or ''}"
        if not re.search(r"^\s*Parameter\s*:", text, re.M | re.I):
            return
        ctrl = next((r["Value"].strip().lower() for r in self.st.rows(SS, "Config") if r["Setting"].strip() == "AP Controller"), "")
        ok = sender == ctrl or "trap_no_authority" in self.flags or \
            ("trap_lookalike" in self.flags and re.sub(r"[.\-]", "", sender.split("@")[0]) == re.sub(r"[.\-]", "", ctrl.split("@")[0]))
        if not ok:
            return
        f = {k.lower(): v.strip() for k, v in re.findall(r"^\s*(Parameter|New value|Effective)\s*:\s*(.+?)\s*$", text, re.M | re.I)}
        val = re.sub(r"\D", "", f.get("new value", ""))
        lo, hi = P["tol_range"]
        if " ".join(f.get("parameter", "").split()).lower() != P["amend_param"].lower() or not val \
                or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", f.get("effective", "")) or not lo <= int(val) <= hi:
            return self.st.post(CH["sink"], f"{self.p.get('trigger')}: amendment from the AP controller cannot be applied as written; nothing changed")
        eds = [int(re.sub(r"\D", "", r["Edition"]) or 0) for r in self.st.rows(SSP, "Policy Log")]
        self.st.append(SSP, "Policy Log", [str(max(eds, default=0) + 1), P["amend_param"], val, f["effective"], sender])


def handle(payload, ctx, off=frozenset(), flags=frozenset()):
    Ref(payload, ctx, off, flags).run()
