#!/usr/bin/env python3
"""abr-p2p-audit: seeded generator + truth engine (host-only). A clean P2P population whose rates and lags come from the
ProcureChange OCEL (Zenodo 22079246, CC BY 4.0; parameters only), plus injected violations with exact labels (the
injection log is the family's third oracle: at arrival, the truth's holds equal the injections). Amounts are fictional.

    python3 -I model.py --seed 2113
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
AB = HERE.parents[1]
if str(AB) not in sys.path:
    sys.path.append(str(AB))

from abr.lib.factory import clock as C  # noqa: E402
from abr.lib.factory import genbase as G  # noqa: E402
from abr.lib.factory import world as W  # noqa: E402

SPEC = json.loads((HERE / "family.spec.json").read_text())
_COMPILED = json.loads((HERE / "compiled.json").read_text())
SPEC.update({k: _COMPILED[k] for k in ("attribution", "hard_clauses", "sink", "controls")})
FAMILY, VERSION = SPEC["id"], SPEC["version"]
UTC = timezone.utc
ORG, CH, CAL, P = SPEC["org"], SPEC["channels"], SPEC["calendar"], SPEC["params"]
HOL = json.loads((AB / "abr" / "lib" / "factory" / "holidays.json").read_text())["tables"][CAL["holidays"]]
HOLS = frozenset(HOL)
SS, SSP = ORG["ss"], ORG["ss_policy"]
APPS = SPEC["host"]["apps"]
SEALED = range(8850, 8874)
TOL = P["tolerance"]
SUPPLIERS = [("SUP-1042", "Acme Industrial GmbH"), ("SUP-1107", "Borealis Fasteners Ltd"), ("SUP-1213", "Castell Hydraulics"),
             ("SUP-1288", "Delmont Packaging"), ("SUP-1350", "Erlen Electrical Supply"), ("SUP-1419", "Fjord Polymers AS"),
             ("SUP-1502", "Granite Valve Co"), ("SUP-1577", "Halvard Bearings")]
LOOKALIKE = {"SUP-1042": ("SUP-1940", "Acme Industrail GmbH"), "SUP-1213": ("SUP-1231", "Castell Hydraulic"),
             "SUP-1502": ("SUP-1520", "Granite Valve Co.")}
BUYERS, POSTERS, CLERKS = ["b.lang", "m.ortiz", "s.kim"], ["w.ito", "w.berg"], ["a.diaz", "r.osei", "t.nguyen"]
# ProcureChange lags (days, p25/p50/p75): PO -> release 3.0/5.0/6.4, release -> receipt 4.3/6.0/7.7, receipt -> invoice 4.2/6.0/8.0


def cents(x: int) -> str:
    return f"{x // 100}.{x % 100:02d}"


def limit(po_cents: int, tol: int) -> int:
    return (po_cents * (100 + tol) + 50) // 100


class Gen(G.Gen):
    FAMILY, VERSION, SPEC = FAMILY, VERSION, SPEC
    KIND_ORDER = {"email": 0, "opened": 1, "updated": 2, "check": 3}

    def plan(self):
        r = self.rng
        start = date(2027, 1, 4) + timedelta(weeks=r.randint(1, 46), days=self.shift_days)
        self.start, self.start_dt = start, datetime(start.year, start.month, start.day, tzinfo=UTC)
        self.days = [start + timedelta(days=k) for k in range(28)]
        bdays = C.business_days(start, 28, HOLS)
        self.pay_times = [datetime(d.year, d.month, d.day, 15, 0, tzinfo=UTC) for d in bdays if d.weekday() in CAL["payment_days"]]
        self.close_times = [datetime(d.year, d.month, d.day, 17, 0, tzinfo=UTC) for d in bdays]
        self.month_end_days = C.month_ends_in(self.days, HOLS)
        self.policy = [{"ed": 0, "val": TOL["stale"], "eff": date(2025, 2, 1)}, {"ed": 1, "val": TOL["edition1"], "eff": date(2026, 1, 1)}]
        self.pfx = "" if not self.rename else "X"
        self.pos, self.grs, self.invs = [], [], []
        self.n_po, self.n_gr, self.n_inv = r.randint(4100, 4900), r.randint(7100, 7900), r.randint(91000, 99000)
        # purchase orders: created 5 weeks before start .. week 3; receipts and invoices follow the OCEL lags
        for k in range(r.randint(40, 48)):
            created = self.start_dt + timedelta(days=r.uniform(-34, 18), hours=0)
            self.po(created.replace(minute=0, second=0, microsecond=0, hour=r.randint(8, 16)))
        self.plan_emails()
        self.inject()
        for t in self.pay_times:
            self.event(t, "check", "schedule", "payment_run", {"schedule": "15:00 UTC Tuesdays and Thursdays (working days)"},
                       [], (), "payment-run")
        for t in self.close_times:
            me = t.date() in self.month_end_days
            self.event(t, "check", "schedule", "daily_close", {"schedule": "17:00 UTC working days"}, [], (),
                       "month-end" if me else "close", month_end=me)

    def money_text(self, c: int) -> tuple[str, list]:
        style = self.rng.choices(["plain", "comma", "dollar", "usd"], [0.55, 0.2, 0.15, 0.1])[0]
        s = cents(c)
        if style == "plain":
            return s, []
        whole, frac = s.split(".")
        wc = f"{int(whole):,}"
        if style == "comma":
            return f"{wc}.{frac}", (["T-format"] if "," in wc else [])
        if style == "dollar":
            return f"${wc}.{frac}", ["T-format"]
        return f"USD {whole}.{frac.rstrip('0') or '0'}", ["T-format"]

    def po(self, created):
        r = self.rng
        sid, sname = r.choice(SUPPLIERS)
        price = r.choice([1250, 4999, 3333, 18800, 249000, 7450, 99900, 15625, 60000, 2875])
        qty = r.choice([10, 12, 20, 25, 40, 50, 100, 120, 200])
        self.n_po += r.randint(1, 9)
        p = {"id": f"{self.pfx}PO-{self.n_po}", "sid": sid, "sname": sname, "by": r.choice(BUYERS), "price": price, "qty": qty,
             "price_text": self.money_text(price)[0], "created": created, "rid": f"po{len(self.pos):03d}s{self.seed}",
             "price_changes": []}
        self.pos.append(p)
        rel = created + timedelta(days=r.uniform(3, 6.4))
        rec = (rel + timedelta(days=r.uniform(4.3, 7.7))).replace(minute=0, second=0, microsecond=0, hour=r.randint(7, 16))
        parts = [qty] if r.random() > P["partial_receipt_rate"] else [qty // 2, qty - qty // 2]
        t = rec
        for q in parts:
            self.gr(p, q, t)
            t = t + timedelta(days=r.uniform(1, 4))
            t = t.replace(minute=0, second=0, microsecond=0, hour=r.randint(7, 16))
        inv_at = (rec + timedelta(days=r.uniform(4.2, 8.0))).replace(second=0, microsecond=0, minute=r.randrange(0, 60, 5), hour=r.randint(8, 17))
        if parts == [qty] or r.random() < 0.5:
            self.invoice(p, qty, p["price"], inv_at)
        else:
            self.invoice(p, parts[0], p["price"], inv_at)

    def gr(self, p, q, at, by=None):
        self.n_gr += self.rng.randint(1, 5)
        g = {"id": f"{self.pfx}GR-{self.n_gr}", "po": p["id"], "qty": q, "by": by or self.rng.choice(POSTERS), "at": at,
             "rid": f"gr{len(self.grs):03d}s{self.seed}"}
        self.grs.append(g)
        return g

    def invoice(self, p, qty, price, at, sid=None, sname=None, by=None, sinv=None, label=None, traps=()):
        r = self.rng
        self.n_inv += r.randint(1, 7)
        amount = qty * price
        ptxt, t1 = self.money_text(price)
        atxt, t2 = self.money_text(amount)
        i = {"id": f"{self.pfx}INV-{self.n_inv}", "sid": sid or p["sid"], "sname": sname or p["sname"],
             "sinv": sinv or f"{r.choice(['A', 'F', 'R', 'INV'])}{r.randint(10000, 99999)}", "po": p["id"], "qty": qty,
             "price": price, "amount": amount, "price_text": ptxt, "amount_text": atxt, "at": at, "by": by or r.choice(CLERKS),
             "rid": f"inv{len(self.invs):03d}s{self.seed}", "label": label, "traps": list(traps) + t1 + t2,
             "status": None, "reason": None, "decided": None, "paid": None}
        self.invs.append(i)
        return i

    def in_stream(self, t):
        return self.start_dt < t < self.start_dt + timedelta(days=25, hours=17)

    def inject(self):
        """Planted violations (exact labels). ~20-25% of in-stream invoices, every kind at least once."""
        r = self.rng
        live = [i for i in self.invs if self.in_stream(i["at"])]
        r.shuffle(live)
        kinds = ["PRICE", "PRICE-conflict", "QTY", "NO-GR", "SOD-buyer", "SOD-poster", "SUPPLIER", "DUPLICATE", "AT-LIMIT", "DUPLICATE"]
        for kind, i in zip(kinds, live):
            p = next(x for x in self.pos if x["id"] == i["po"])
            tol = TOL["edition2"] if i["at"].date() >= self.amend_eff else TOL["edition1"]
            if kind in ("PRICE", "PRICE-conflict"):
                i["price"] = limit(p["price"], tol) + r.choice([1, 7, 50, 120])
                i["label"], i["traps"] = "PRICE", i["traps"] + ["T-match"]
                if kind == "PRICE-conflict":
                    newp = i["price"] + r.choice([0, 100])
                    p["price_changes"].append((i["at"] + timedelta(hours=r.randint(6, 40)), newp))
                    i["traps"].append("T-conflict")
            elif kind == "AT-LIMIT":
                i["price"] = limit(p["price"], tol)                          # exactly the limit: passes
                i["traps"].append("T-match")
            elif kind == "QTY":
                rec = sum(g["qty"] for g in self.grs if g["po"] == p["id"] and g["at"] <= i["at"])
                i["qty"] = rec + r.randint(1, 5)
                i["label"], i["traps"] = "QTY", i["traps"] + ["T-match"]
            elif kind == "NO-GR":
                for g in self.grs:
                    if g["po"] == p["id"]:
                        g["at"] = i["at"] + timedelta(hours=r.randint(20, 60))
                        g["at"] = g["at"].replace(minute=0, second=0)
                i["label"], i["traps"] = "NO-GR", i["traps"] + ["T-match", "T-conflict"]
            elif kind == "SOD-buyer":
                i["by"], i["label"], i["traps"] = p["by"], "SOD", i["traps"] + ["T-sod"]
            elif kind == "SOD-poster":
                g = next((g for g in self.grs if g["po"] == p["id"]), None)
                if g:
                    i["by"], i["label"], i["traps"] = g["by"], "SOD", i["traps"] + ["T-sod"]
            elif kind == "SUPPLIER":
                la = LOOKALIKE.get(p["sid"])
                if la:
                    i["sid"], i["sname"] = la
                else:
                    i["sid"] = "SUP-" + str(int(p["sid"][4:]) + 1)
                i["label"], i["traps"] = "SUPPLIER", i["traps"] + ["T-lookalike"]
            elif kind == "DUPLICATE":
                src = next((x for x in self.invs if x is not i and x["at"] < i["at"] and x["label"] is None), None)
                if src:
                    dup = self.invoice(next(x for x in self.pos if x["id"] == src["po"]), src["qty"], src["price"],
                                       i["at"] + timedelta(minutes=r.randint(5, 300)), sid=src["sid"], sname=src["sname"],
                                       sinv=" " + src["sinv"].lower() + " ", label="DUPLICATE", traps=["T-replay"])
                    dup["amount"] = src["amount"]
            i["amount"] = i["qty"] * i["price"]
            i["price_text"], t1 = self.money_text(i["price"])
            i["amount_text"], t2 = self.money_text(i["amount"])
            i["traps"] += t1 + t2
        # a few injected PO price drift corrections without holds (quiet PO updates)
        for p in r.sample(self.pos, k=min(3, len(self.pos))):
            t = self.start_dt + timedelta(days=r.uniform(1, 24))
            if not p["price_changes"]:
                p["price_changes"].append((t.replace(minute=0, second=0, microsecond=0), p["price"]))
        for i in self.invs:
            if i["label"]:
                self.injections.append({"invoice": i["id"], "label": i["label"]})

    def plan_emails(self):
        r = self.rng
        week3 = [d for d in self.days[14:21] if C.is_business_day(d, HOLS)]
        day = r.choice(week3[1:3] or week3)
        eff = day if r.random() < 0.6 else day + timedelta(days=7 - day.weekday())
        self.amend_eff = eff
        self.email_event(datetime(day.year, day.month, day.day, r.randint(9, 14), r.randrange(0, 60), tzinfo=UTC), ORG["controller"],
                         ORG["inbox"], "AP policy edition 2",
                         f"Hi,\n\nParameter: {P['amend_param']}\nNew value: {TOL['edition2']}\nEffective: {eff.isoformat()}\n\nAP Controller\n",
                         ["T-stale"], "amendment", amend={"val": TOL["edition2"], "eff": eff, "ok": True})
        bad = r.choice(ORG["lookalike_controller"])
        d2 = self.days[r.randint(7, 11)]
        self.email_event(datetime(d2.year, d2.month, d2.day, 11, r.randrange(0, 60), tzinfo=UTC), bad, ORG["inbox"], "Tolerance",
                         f"Parameter: {P['amend_param']}\nNew value: 9\nEffective: {d2.isoformat()}\n", ["T-lookalike"], "amendment-unauthorized",
                         amend={"ok": False})
        if r.random() < 0.5:
            d3 = self.days[r.randint(22, 24)]
            self.email_event(datetime(d3.year, d3.month, d3.day, 10, 0, tzinfo=UTC), ORG["controller"], ORG["inbox"], "Tolerance",
                             f"Parameter: {P['amend_param']}\nNew value: 15\nEffective: {d3.isoformat()}\n", [], "amendment-out-of-range",
                             amend={"ok": "range"})
        d4 = self.days[r.randint(0, 24)]
        self.email_event(datetime(d4.year, d4.month, d4.day, 9, 30, tzinfo=UTC), "statements@borealis-fasteners.example.net", ORG["inbox"],
                         "Statement of account", "Please find our statement attached. Kindly pay outstanding items.\n", [], "noise")

    # -- rendering -------------------------------------------------------------------------------------------------------
    def po_cells(self, p, at):
        price = p["price"]
        txt = p["price_text"]
        for t, newp in p["price_changes"]:
            if t <= at:
                price, txt = newp, cents(newp)
        return {"PO ID": p["id"], "Supplier ID": p["sid"], "Supplier Name": p["sname"], "Created By": p["by"],
                "Unit Price": txt, "Quantity": str(p["qty"])}

    def po_price(self, p, at):
        price = p["price"]
        for t, newp in p["price_changes"]:
            if t <= at:
                price = newp
        return price

    def gr_cells(self, g):
        return {"GR ID": g["id"], "PO ID": g["po"], "Quantity": str(g["qty"]), "Posted By": g["by"], "Posted At": C.iso_z(g["at"])}

    def inv_cells(self, i):
        return {"Invoice ID": i["id"], "Supplier ID": i["sid"], "Supplier Name": i["sname"], "Supplier Invoice No": i["sinv"],
                "PO ID": i["po"], "Quantity": str(i["qty"]), "Unit Price": i["price_text"], "Amount": i["amount_text"],
                "Received At": C.iso_z(i["at"]), "Entered By": i["by"]}

    def triggers(self):
        end = self.close_times[-1]
        t0 = self.start_dt
        for p in self.pos:
            if t0 < p["created"] <= end:
                self.event(p["created"], "opened", "google_sheets", "new_row", {"spreadsheet_id": SS, "worksheet": "Purchase Orders",
                           "row": self.po_cells(p, p["created"])},
                           [{"op": "insert_row", "ss": SS, "sheet": "Purchase Orders", "rid": p["rid"], "cells": self.po_cells(p, p["created"])}],
                           (), "po")
            for t, _ in p["price_changes"]:
                if t0 < t <= end and t > p["created"]:
                    self.event(t, "updated", "google_sheets", "updated_row", {"spreadsheet_id": SS, "worksheet": "Purchase Orders",
                               "row": self.po_cells(p, t)},
                               [{"op": "update_row", "ss": SS, "sheet": "Purchase Orders", "key_col": "PO ID", "key": p["id"],
                                 "cells": self.po_cells(p, t)}], (), "po-change", po=p["id"])
        for g in self.grs:
            if t0 < g["at"] <= end:
                self.event(g["at"], "opened", "google_sheets", "new_row", {"spreadsheet_id": SS, "worksheet": "Goods Receipts", "row": self.gr_cells(g)},
                           [{"op": "insert_row", "ss": SS, "sheet": "Goods Receipts", "rid": g["rid"], "cells": self.gr_cells(g)}], (), "receipt",
                           po=g["po"])
        for i in self.invs:
            if t0 < i["at"] <= end:
                self.event(i["at"], "opened", "google_sheets", "new_row", {"spreadsheet_id": SS, "worksheet": "Invoices", "row": self.inv_cells(i)},
                           [{"op": "insert_row", "ss": SS, "sheet": "Invoices", "rid": i["rid"], "cells": self.inv_cells(i)}], i["traps"],
                           "invoice", inv=i["id"])
        self.events = [e for e in self.events if e["at"] <= end]
        return super().triggers()

    def world0(self):
        t0 = self.start_dt
        # history before the stream, decided by the same model (prefix of the truth engine), so world0 is consistent
        hist = [i for i in self.invs if i["at"] <= t0]
        for i in sorted(hist, key=lambda x: x["at"]):
            self.decide_invoice(i, i["at"])
        for i in hist:
            if i["status"] == "Approved" and self.rng.random() < 0.6 and i["decided"] + timedelta(days=2) < t0:
                i["status"], i["paid"] = "Paid", i["decided"] + timedelta(days=2)
        po_rows = [(p["rid"], self.po_cells(p, t0)) for p in self.pos if p["created"] <= t0]
        gr_rows = [(g["rid"], self.gr_cells(g)) for g in self.grs if g["at"] <= t0]
        inv_rows = [(i["rid"], {**self.inv_cells(i), "Status": i["status"], "Hold Reason": i["reason"] or "",
                                "Decided At": C.iso_z(i["decided"]), "Paid At": C.iso_z(i["paid"]) if i["paid"] else ""}) for i in hist]
        cfg = [("Former AP Controller (until 2026-08-31)", "ap-office@corvane.example.com"), ("AP Controller", ORG["controller"]),
               ("Internal Audit", ORG["audit"]), ("Holds Channel", "#" + CH["holds"]), ("Payments Channel", "#" + CH["payments"]),
               ("Reports Channel", "#" + CH["reports"]), ("Review Channel", "#" + CH["sink"])]
        pol = sorted(self.policy, key=lambda p: (self.rng.random(), p["ed"]))
        sheets = W.sheets([
            {"id": SS, "title": "Accounts Payable", "worksheets": [
                {"id": "ws-po", "title": "Purchase Orders", "headers": SPEC["sheets"]["Purchase Orders"]["human"], "rows": po_rows},
                {"id": "ws-gr", "title": "Goods Receipts", "headers": SPEC["sheets"]["Goods Receipts"]["human"], "rows": gr_rows},
                {"id": "ws-inv", "title": "Invoices", "headers": SPEC["sheets"]["Invoices"]["human"] + SPEC["sheets"]["Invoices"]["state"], "rows": inv_rows},
                {"id": "ws-pay", "title": "Payment Runs", "headers": ["Run Date", "Invoice ID", "Amount"], "rows": []},
                {"id": "ws-config", "title": "Config", "headers": ["Setting", "Value"],
                 "rows": [(f"cfg{i:02d}", {"Setting": a, "Value": b}) for i, (a, b) in enumerate(cfg)]},
                {"id": "ws-holidays", "title": "Holidays", "headers": ["Date", "Name"],
                 "rows": [(f"hol{i:02d}", {"Date": d, "Name": n}) for i, (d, n) in enumerate(sorted(HOL.items()))]}]},
            {"id": SSP, "title": "AP Policy Log", "worksheets": [
                {"id": "ws-policy", "title": "Policy Log", "headers": ["Edition", "Parameter", "Value", "Effective", "Approved by"],
                 "rows": [(f"pol{k}", {"Edition": str(p["ed"]), "Parameter": P["amend_param"], "Value": str(p["val"]),
                                       "Effective": p["eff"].isoformat(), "Approved by": ORG["controller"] if p["ed"] else "ap-office@corvane.example.com"})
                          for k, p in enumerate(pol)]}]}])
        users = [W.slack_user("U0APBOT001", "ap-bot", "AP Automation", is_bot=True),
                 W.slack_user("U0APCTRL01", "controller", "Mira Solberg", ORG["controller"])]
        cids = {CH["holds"]: "C0APHOLDS1", CH["payments"]: "C0APPAYS01", CH["reports"]: "C0APREPS01", CH["sink"]: "C0AUTOREV1"}
        chans = [W.slack_channel(cid, n, [u["id"] for u in users], n) for n, cid in cids.items()]
        return {"meta": {"schema_version": "0.1.0", "current_time": C.iso_z(t0), "allowed_services": sorted(APPS), "no_same_sender_noise": False},
                "google_sheets": sheets, "slack": {"channels": chans, "messages": [], "users": users, "dms": []},
                "gmail": {"messages": [], "labels": [], "drafts": [], "attachments": [], "threads": []}}

    # -- truth engine --------------------------------------------------------------------------------------------------
    def tol_at(self, d):
        live = [p for p in self.policy if p["eff"] <= d]
        return max(live, key=lambda p: (p["eff"], p["ed"]))["val"]

    def failing(self, i, now, skip_dup=False):
        p = next((x for x in self.pos if x["id"] == i["po"] and x["created"] <= now), None)
        if not skip_dup:
            norm = lambda s: "".join(s.split()).lower()  # noqa: E731
            if any(x is not i and x["at"] < i["at"] and x["sid"] == i["sid"] and norm(x["sinv"]) == norm(i["sinv"]) for x in self.invs
                   if x["at"] <= now):
                return "DUPLICATE"
        grs = [g for g in self.grs if p and g["po"] == p["id"] and g["at"] <= now]
        if p and (i["by"] == p["by"] or any(g["by"] == i["by"] for g in grs)):
            return "SOD"
        if p is None or p["sid"] != i["sid"]:
            return "SUPPLIER"
        if not grs:
            return "NO-GR"
        approved = sum(x["qty"] for x in self.invs if x is not i and x["po"] == p["id"] and x["status"] in ("Approved", "Paid"))
        if i["qty"] + approved > sum(g["qty"] for g in grs):
            return "QTY"
        if i["price"] > limit(self.po_price(p, now), self.tol_at(i["at"].date())):
            return "PRICE"
        return None

    def decide_invoice(self, i, now):
        reason = self.failing(i, now)
        i["status"], i["reason"], i["decided"] = ("Hold", reason, now) if reason else ("Approved", None, now)
        return reason

    def inv_eff(self, i, cells, clause):
        return {"t": "cells", "ss": SS, "ws_id": "ws-inv", "sheet": "Invoices", "key_col": "Invoice ID", "key": i["id"], "cells": cells,
                "instants": [c for c in cells if c in ("Decided At", "Paid At")], "clause": clause}

    def decide(self, trig):
        e = trig["_e"]
        now = datetime.fromisoformat(trig["at"].replace("Z", "+00:00"))
        info = {"traps": set()}
        out = []
        if e["kind"] == "opened" and e["sub"] == "invoice":
            i = next(x for x in self.invs if x["id"] == e["inv"])
            reason = self.decide_invoice(i, now)
            cells = {"Status": i["status"], "Hold Reason": reason or "", "Decided At": C.iso_z(now)}
            if not reason:
                cells.pop("Hold Reason")
            out.append(self.inv_eff(i, cells, "A1"))
            if reason:
                out.append({"t": "post", "channel": CH["holds"], "text": f"HOLD {i['id']} {reason}", "clause": "A1"})
                if reason == "SOD":
                    out.append({"t": "mail", "to": ORG["audit"], "subject": f"SOD {i['id']}", "clause": "A1"})
            po_price = self.po_price(next(p for p in self.pos if p["id"] == i["po"]), now)
            over = {t: i["price"] > limit(po_price, t) for t in (TOL["stale"], TOL["edition1"], TOL["edition2"])}
            if len(set(over.values())) > 1:
                info["traps"].add("T-stale")      # some tolerance edition other than the one in force decides differently
            info["traps"].update(t for t in i["traps"] if t in ("T-format", "T-match", "T-sod", "T-lookalike", "T-replay"))
        elif e["sub"] in ("receipt", "po-change"):
            po = e["po"]
            for i in sorted((x for x in self.invs if x["po"] == po and x["status"] == "Hold" and x["reason"] in ("NO-GR", "QTY", "PRICE")
                             and x["at"] <= now), key=lambda x: x["at"]):
                if self.failing(i, now, skip_dup=True) is None:
                    i["status"], i["decided"] = "Approved", now
                    out.append(self.inv_eff(i, {"Status": "Approved", "Decided At": C.iso_z(now)}, "A2"))
                    out.append({"t": "post", "channel": CH["holds"], "text": f"RELEASE {i['id']}", "clause": "A2"})
                    info["traps"].add("T-conflict")
        elif e["sub"] == "payment-run":
            pay = sorted((x for x in self.invs if x["status"] == "Approved" and x["at"] <= now), key=lambda x: x["at"])
            for i in pay:
                i["status"], i["paid"] = "Paid", now
                out.append({"t": "append", "ss": SS, "ws_id": "ws-pay", "sheet": "Payment Runs",
                            "cells": {"Run Date": now.date().isoformat(), "Invoice ID": i["id"], "Amount": cents(i["amount"])}, "clause": "A3"})
                out.append(self.inv_eff(i, {"Status": "Paid", "Paid At": C.iso_z(now)}, "A3"))
                info["traps"].update(t for t in i["traps"] if t == "T-format")
            if pay:
                out.append({"t": "post", "channel": CH["payments"],
                            "text": f"PAYMENT RUN {now.date().isoformat()} count={len(pay)} total={cents(sum(i['amount'] for i in pay))}", "clause": "A3"})
        elif e["sub"] == "month-end":
            held = [x for x in self.invs if x["status"] == "Hold" and x["at"] <= now]
            out.append({"t": "post", "channel": CH["reports"],
                        "text": f"MONTH-END {now:%Y-%m} held={len(held)} held_amount={cents(sum(x['amount'] for x in held))}", "clause": "A5"})
            out.append({"t": "mail", "to": ORG["controller"], "subject": f"AP month-end {now:%Y-%m}", "clause": "A5"})
        elif e["kind"] == "email" and e["sub"].startswith("amendment"):
            a = e["amend"]
            if e["data"]["from"] == ORG["controller"]:
                if a["ok"] == "range":
                    out.append({"t": "post", "channel": CH["sink"], "contains": [trig["trigger"]], "clause": "A4"})
                else:
                    ed = max(p["ed"] for p in self.policy) + 1
                    self.policy.append({"ed": ed, "val": a["val"], "eff": a["eff"]})
                    out.append({"t": "append", "ss": SSP, "ws_id": "ws-policy", "sheet": "Policy Log",
                                "cells": {"Edition": str(ed), "Parameter": P["amend_param"], "Value": str(a["val"]),
                                          "Effective": a["eff"].isoformat(), "Approved by": ORG["controller"]}, "clause": "A4"})
        # merge cells effects on the same row (release then pay in one trigger cannot happen: different triggers)
        return out, info

    def end_tables(self):
        end = self.close_times[-1]
        rows = {i["id"]: {"Status": i["status"] or "", "Hold Reason": i["reason"] or "", "Decided At": C.iso_z(i["decided"]) if i["decided"] else "",
                          "Paid At": C.iso_z(i["paid"]) if i["paid"] else ""} for i in self.invs if i["at"] <= end}
        return [{"ss": SS, "sheet": "Invoices", "key_col": "Invoice ID", "rows": rows, "instants": ["Decided At", "Paid At"], "clause": "A1"},
                {"ss": SS, "sheet": "Payment Runs", "key_col": "Invoice ID",
                 "rows": {i["id"]: {"Amount": cents(i["amount"])} for i in self.invs if i["paid"] and i["paid"] > self.start_dt},
                 "count": sum(1 for i in self.invs if i["paid"] and i["paid"] > self.start_dt), "clause": "A3"},
                {"ss": SSP, "sheet": "Policy Log", "key_col": "Edition", "rows": {str(p["ed"]): {"Value": str(p["val"])} for p in self.policy},
                 "count": len(self.policy), "clause": "A4"}]


def generate(seed: int, rename: bool = False, shift_days: int = 0, allow_sealed: bool = False) -> dict:
    if seed in SEALED and not allow_sealed:
        raise SystemExit(f"seed {seed} is sealed (SEED-LEDGER factory-v-sealed): only experiments/breadth/factory/seal.py generates it")
    return Gen(seed, rename, shift_days).run()


def serve_input(seed: int, trigger: dict, intake: str = "policy", intake_text: str | None = None) -> dict:
    return G.serve_input(FAMILY, (HERE / "POLICY.md").read_text(), APPS, seed, trigger, intake_text if intake == "messy" else None)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    a = ap.parse_args()
    out = generate(a.seed)
    print(json.dumps(out["meta"], default=str), len(out["injections"]))
