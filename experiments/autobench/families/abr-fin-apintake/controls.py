"""abr-fin-apintake bad controls (code, no model). Each must FAIL the family; together they show the oracle rejects a
do-nothing run, an echo, and plausible-but-wrong runs, and that every policy rule they break is load-bearing.

  null               does nothing at all
  echo               repeats every trigger's data back into #accounts-payable
  naive              the <= 40-line "ignore every note and authority rule" heuristic (RECURRING-DESIGN §3.11 gate 4):
                     logs every invoice email (no blocklist, duplicate or PO check, no corrections, no receiving), sets
                     the approver from fixed 5,000 / 25,000 bands and the first matching Approvers row, takes an
                     approval from anyone who writes `Approved <Invoice #>`, pays every Open row whose amount is within
                     2% of its PO at the payment run, and totals every row at the week close
  one-defect variants of the observable-only reference (plausible but wrong; each breaks exactly one rule):
    any-approver       accepts `Approved <Invoice #>` from any sender (wrong department head, look-alike domain, ...)
    display-first      reads the sender as the first address-like text of the From header (display-name spoof)
    fuzzy-vendor       compares vendor names by their first word (look-alike vendors are the same vendor)
    no-blocklist       ignores Blocked Vendors (logs and pays blocked vendors)
    any-block-row      counts Lifted Blocked Vendors rows as blocks
    no-dedupe          logs a second notice or a re-issued invoice as a new invoice
    dedupe-number      treats only the same Invoice # as a duplicate (misses a re-issue under a new number)
    dedupe-any-date    treats the same amount as a duplicate whatever the Invoice Dates
    no-weekend         keeps weekend due dates
    stale-bands        reads the first Policy Log row of each parameter
    last-row-bands     reads the last Policy Log row of each parameter, even when it takes effect in the future
    inactive-approver  takes the first Department Head row of the department, Active or not
    any-correction     accepts an amount correction from anyone in #accounts-payable
    any-amendment      accepts an `AP policy amendment` from anyone (Approved by = its sender)
    no-early-correction ignores AP lead corrections posted before the invoice arrived
    ignore-partial     ignores `Partial - Expected` (a partial delivery is a quantity discrepancy)
    strict-variance    a variance of exactly 2% (or 5%) falls in the next band
    no-match-email     never emails ap-lead about holds and reviews
    pay-unapproved     the payment run ignores Approval (pays rows still awaiting approval)
    pay-blocked        the payment run ignores Blocked Vendors
    pay-bill-total     pays the QuickBooks bill's total instead of the row's (corrected) Amount
    po-any-vendor      accepts a PO that belongs to another vendor
    case-po            compares PO numbers with letter case and spaces
    total-all          the week close totals every logged row, not this week's
"""
from __future__ import annotations

import inspect
import json
import re

from reference import (APPROVED, AWAIT_RECEIPT, AWAITING, GMAIL, MATCHED, NOT_REQUIRED, OPEN, P_APPROVAL, P_CFO, PROCESSING, PV_REVIEW,
                       QB, REJECTED, REVIEW, SLACK, WS_APPROVERS, WS_PENDING, WS_PO, WS_POLICY, Ap, approves, cents, key, money, norm,
                       sender, usd)


def null(trigger, ctx):
    return None


def echo(trigger, ctx):
    text = json.dumps(trigger.get("data") or {}, sort_keys=True, ensure_ascii=False)
    ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": "accounts-payable", "text": text})


def naive(trigger, ctx):  # <= 40 lines: the shortcut a careless automation takes
    a, d, ev = Ap(trigger, ctx), trigger.get("data") or {}, trigger.get("event")
    if ev == "new_email":
        m = a.call("GET", GMAIL + f"messages/{d['message_id']}")
        f = a.parse_invoice(m.get("body_plain") or "")
        if f is None:
            for n, c in a.sheet(WS_PENDING):
                if c.get("Approval") == AWAITING and approves(f"{m.get('subject')}\n{m.get('body_plain')}", c["Invoice #"]):
                    a.update(WS_PENDING, n, {"Approval": APPROVED})
            return None
        s = a.read(WS_PO, WS_APPROVERS, "vendors")
        po = next((c for _, c in s[WS_PO] if key(c["PO #"]) == key(f["po"])), {"Department": "", "Amount": "0"})
        role = "none" if f["amount"] < 500000 else ("department head" if f["amount"] <= 2500000 else "cfo")
        hit = next((c["Email"] for _, c in s[WS_APPROVERS] if norm(c["Role"]) == role and (role == "cfo" or norm(c["Department"]) == norm(po["Department"]))), "none")
        a.append(WS_PENDING, a.headers(WS_PENDING), {"Logged": a.today, "Vendor": f["vendor"], "Invoice #": f["inv"], "Invoice Date": f["date"].isoformat(),
                 "Due Date": f["due"].isoformat(), "Amount": money(f["amount"]), "Qty": str(f["qty"]), "PO #": f["po"], "Approver": hit,
                 "Match": AWAIT_RECEIPT, "Approval": NOT_REQUIRED if hit == "none" else AWAITING, "Status": OPEN, "Notes": ""})
        v = next(x for x in s["vendors"] if norm(x["DisplayName"]) == norm(f["vendor"]))
        return a.call("POST", QB + "bill", None, {"VendorRef": {"value": v["Id"]}, "DocNumber": f["inv"], "TxnDate": f["date"].isoformat(),
                                                   "DueDate": f["due"].isoformat(), "Line": [{"Amount": money(f["amount"])}]})
    if ev == "payment_run":
        s = a.read(WS_PENDING, WS_PO, "vendors", "bills")
        for n, c in s[WS_PENDING]:
            po = next((p for _, p in s[WS_PO] if key(p["PO #"]) == key(c["PO #"])), None)
            if c.get("Status") != OPEN or po is None or a.variance(cents(c["Amount"]), cents(po["Amount"])) != MATCHED:
                continue
            v = next(x for x in s["vendors"] if norm(x["DisplayName"]) == norm(c["Vendor"]))
            b = next(x for x in s["bills"] if x.get("DocNumber") == c["Invoice #"])
            a.call("POST", QB + "billpayment", None, {"VendorRef": {"value": v["Id"]}, "Line": [{"Amount": c["Amount"], "LinkedTxn": [{"TxnId": b["Id"], "TxnType": "Bill"}]}]})
            a.send(v.get("PrimaryEmailAddr__Address"), f"Payment processing for {c['Invoice #']}", f"Paying {c['Invoice #']}: {usd(cents(c['Amount']))}")
            a.update(WS_PENDING, n, {"Status": PROCESSING})
    if ev == "week_close":
        rows = [c for _, c in a.sheet(WS_PENDING)]
        x, y = sum(cents(c["Amount"]) for c in rows), sum(cents(c["Amount"]) for c in rows if c["Status"] == PROCESSING)
        a.send("ap-lead@company.example.com", f"AP week close {d['date']}",
               f"Logged total: {usd(x)}; Processing total: {usd(y)}; Awaiting approval: {sum(c['Approval'] == AWAITING for c in rows)}")


NAIVE_LINES = len(inspect.getsource(naive).splitlines()) - 1      # the def line and the body, minus the def line


# ---------------------------------------------------------------------------------------------------------------------
# one-defect variants
# ---------------------------------------------------------------------------------------------------------------------
class AnyApprover(Ap):
    def on_approval(self, m, text):
        hits = [(n, c) for n, c in self.sheet(WS_PENDING) if norm(c.get("Status")) == "open"
                and norm(c.get("Approval")) == norm(AWAITING) and c.get("Invoice #", "").strip() and approves(text, c["Invoice #"])]
        for row_no, _ in hits:
            self.update(WS_PENDING, row_no, {"Approval": APPROVED})


class DisplayFirst(Ap):
    def from_address(self, m):
        hit = re.search(r"[\w.+-]+@[\w.-]+", str(m.get("from") or ""))
        return hit.group(0).lower() if hit else ""


class FuzzyVendor(Ap):
    def same_vendor(self, a, b):
        return norm(a).split()[:1] == norm(b).split()[:1]


class NoBlocklist(Ap):
    def blocked(self, vendor, rows):
        return False


class AnyBlockRow(Ap):
    def blocked(self, vendor, rows):
        return any(self.same_vendor(c.get("Vendor Name"), vendor) for _, c in rows)


class NoDedupe(Ap):
    def duplicate_of(self, f, rows):
        return None


class DedupeNumber(Ap):
    def duplicate_of(self, f, rows):
        for row_no, c in rows:
            if norm(c.get("Status")) != norm(REJECTED) and self.same_vendor(c.get("Vendor"), f["vendor"]) and key(c.get("Invoice #")) == key(f["inv"]):
                return row_no, c
        return None


class DedupeAnyDate(Ap):
    def within_window(self, a, b):
        return True


class NoWeekend(Ap):
    def move_weekend(self, d):
        return d


class StaleBands(Ap):
    def thresholds(self, policy_rows):
        out = {}
        for p in (P_APPROVAL, P_CFO):
            out[p] = next(cents(c.get("Value")) for _, c in policy_rows if norm(c.get("Parameter")) == norm(p))
        return out


class LastRowBands(Ap):
    def thresholds(self, policy_rows):
        out = {}
        for _, c in policy_rows:
            if norm(c.get("Parameter")) in (norm(P_APPROVAL), norm(P_CFO)):
                out[P_APPROVAL if norm(c.get("Parameter")) == norm(P_APPROVAL) else P_CFO] = cents(c.get("Value"))
        return out


class InactiveApprover(Ap):
    def approver_for(self, amount, dept, approvers, policy_rows):
        th = self.thresholds(policy_rows)
        if amount < th[P_APPROVAL]:
            return "none"
        role = "department head" if amount <= th[P_CFO] else "cfo"
        hit = next(c for _, c in approvers if norm(c.get("Role")) == role and (role == "cfo" or norm(c.get("Department")) == norm(dept)))
        return str(hit.get("Email")).strip().lower()


class AnyCorrection(Ap):
    def is_ap_lead(self, email):
        return True


class AnyAmendment(Ap):
    def on_amendment(self, m, body):
        param = re.search(r"(?im)^\s*Parameter\s*:\s*(.+?)\s*$", body)
        value = re.search(r"(?im)^\s*Value\s*:\s*(.+?)\s*$", body)
        if not param or not value or norm(param.group(1)) not in (norm(P_APPROVAL), norm(P_CFO)) or cents(value.group(1)) is None:
            return None
        name = P_APPROVAL if norm(param.group(1)) == norm(P_APPROVAL) else P_CFO
        v = cents(value.group(1))
        self.append(WS_POLICY, self.headers(WS_POLICY), {"Effective": self.t["at"], "Parameter": name,
                                                         "Value": str(v // 100) if v % 100 == 0 else money(v),
                                                         "Approved by": sender(m.get("from"))})


class NoEarlyCorrection(Ap):
    def corrected(self, inv, history):
        return None


class IgnorePartial(Ap):
    def partial_expected(self, note):
        return False


class StrictVariance(Ap):
    def variance(self, amount, po_amount):
        diff = abs(amount - po_amount)
        if diff * 100 < 2 * po_amount:
            return MATCHED
        if diff * 100 < 5 * po_amount:
            return PV_REVIEW
        return "Price Variance - Hold"


class NoMatchEmail(Ap):
    def match_email(self, cells):
        return None


class PayUnapproved(Ap):
    def payable(self, c, blocked_rows):
        return norm(c.get("Status")) == "open" and norm(c.get("Match")) == norm(MATCHED) and not self.blocked(c.get("Vendor"), blocked_rows)


class PayBlocked(Ap):
    def payable(self, c, blocked_rows):
        return (norm(c.get("Status")) == "open" and norm(c.get("Match")) == norm(MATCHED)
                and norm(c.get("Approval")) in (norm(NOT_REQUIRED), norm(APPROVED)))


class PayBillTotal(Ap):
    def payment_run(self, day):
        s = self.read(WS_PENDING, "ws_blocked", "vendors", "bills")
        for n, c in s[WS_PENDING]:
            if not self.payable(c, s["ws_blocked"]):
                continue
            v = self.qb_vendor(c["Vendor"], s["vendors"])
            b = next(x for x in s["bills"] if x.get("VendorRef__value") == v["Id"] and key(x.get("DocNumber")) == key(c["Invoice #"]))
            amt = cents(b["TotalAmt"])
            self.call("POST", QB + "billpayment", None, {"VendorRef": {"value": v["Id"]}, "TotalAmt": money(amt),
                                                          "Line": [{"Amount": money(amt), "LinkedTxn": [{"TxnId": b["Id"], "TxnType": "Bill"}]}]})
            self.send(v.get("PrimaryEmailAddr__Address"), f"Payment processing for {c['Invoice #']}",
                      f"Payment for invoice {c['Invoice #']} ({usd(amt)}) is being processed.")
            self.update(WS_PENDING, n, {"Status": PROCESSING})


class PoAnyVendor(Ap):
    def po_for(self, number, vendor, rows):
        hits = [c for _, c in rows if key(c.get("PO #")) == key(number)]
        return hits[0] if hits else None


class CasePo(Ap):
    def three_way(self, cells, po, receiving):
        exact = [(n, c) for n, c in receiving if str(c.get("PO #")) == str(cells["PO #"])]
        return super().three_way(cells, po, exact)

    def on_receiving(self, row_no):
        s = self.read("ws_receiving")
        row = dict(s["ws_receiving"]).get(row_no) or {}
        if str(row.get("PO #")) != str(row.get("PO #", "")).strip().upper():
            return None                     # a PO number typed another way matches nothing
        return super().on_receiving(row_no)


class TotalAll(Ap):
    def week_close(self, day):
        rows = self.sheet(WS_PENDING)
        logged = sum(cents(c.get("Amount")) or 0 for _, c in rows if norm(c.get("Status")) != norm(REJECTED))
        processing = sum(cents(c.get("Amount")) or 0 for _, c in rows if norm(c.get("Status")) == norm(PROCESSING))
        waiting = sum(1 for _, c in rows if norm(c.get("Status")) == "open" and norm(c.get("Approval")) == norm(AWAITING))
        self.send("ap-lead@company.example.com", f"AP week close {day}",
                  f"Logged total: {usd(logged)}; Processing total: {usd(processing)}; Awaiting approval: {waiting}")


def _wrap(cls):
    def solver(trigger, ctx):
        try:
            return cls(trigger, ctx).run()
        except LookupError as e:
            ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": REVIEW, "text": f"{trigger.get('trigger')}: {e}"})
    solver.__name__ = cls.__name__
    return solver


CONTROLS = {
    "null": null, "echo": echo, "naive": naive,
    "any-approver": _wrap(AnyApprover), "display-first": _wrap(DisplayFirst), "fuzzy-vendor": _wrap(FuzzyVendor),
    "no-blocklist": _wrap(NoBlocklist), "any-block-row": _wrap(AnyBlockRow), "no-dedupe": _wrap(NoDedupe),
    "dedupe-number": _wrap(DedupeNumber), "dedupe-any-date": _wrap(DedupeAnyDate), "no-weekend": _wrap(NoWeekend),
    "stale-bands": _wrap(StaleBands), "last-row-bands": _wrap(LastRowBands), "inactive-approver": _wrap(InactiveApprover),
    "any-correction": _wrap(AnyCorrection), "any-amendment": _wrap(AnyAmendment), "no-early-correction": _wrap(NoEarlyCorrection), "ignore-partial": _wrap(IgnorePartial),
    "strict-variance": _wrap(StrictVariance), "no-match-email": _wrap(NoMatchEmail), "pay-unapproved": _wrap(PayUnapproved),
    "pay-blocked": _wrap(PayBlocked), "pay-bill-total": _wrap(PayBillTotal), "po-any-vendor": _wrap(PoAnyVendor),
    "case-po": _wrap(CasePo), "total-all": _wrap(TotalAll),
}
