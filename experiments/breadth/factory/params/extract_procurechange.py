#!/usr/bin/env python3
"""Extract P2P stream PARAMETERS (aggregates only) from the ProcureChange reference OCEL (Zenodo 22079246, CC BY 4.0).

Only `procurechange.jsonocel.gz` (7,393,340 B) is read; nothing else from the 1,158 MB record is fetched. Output keeps
rates, lags and role statistics only: no object id, business key, actor id or row (THESIS D10). Run:

    python3 -I experiments/breadth/factory/params/extract_procurechange.py procurechange.jsonocel.gz OUT.json
"""
from __future__ import annotations

import gzip
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime


def t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return round(xs[lo] + (xs[hi] - xs[lo]) * (k - lo), 2)


def main(path, out):
    d = json.load(gzip.open(path))
    by_obj = defaultdict(list)                  # object id -> [(time, event type, actor, role)]
    otype = {o["id"]: o["type"] for o in d["objects"]}
    po_of_inv = {}
    for o in d["objects"]:
        if o["type"] == "Invoice":
            for r in o.get("relationships", []):
                if otype.get(r["objectId"]) == "PurchaseOrder":
                    po_of_inv[o["id"]] = r["objectId"]
    ev_types = Counter()
    role_by_type = defaultdict(Counter)
    exc_by_type = Counter()
    week = Counter()
    for e in d["events"]:
        a = {x["name"]: x["value"] for x in e.get("attributes", [])}
        ev_types[e["type"]] += 1
        role_by_type[e["type"]][a.get("actor_role", "?")] += 1
        if a.get("is_exception"):
            exc_by_type[e["type"]] += 1
        when = t(e["time"])
        if e["type"] == "Invoice Received":
            week[when.isocalendar()[:2]] += 1
        for r in e.get("relationships", []):
            by_obj[r["objectId"]].append((when, e["type"], a.get("actor"), a.get("actor_role")))
    inv = [k for k, v in otype.items() if v == "Invoice"]
    pos = [k for k, v in otype.items() if v == "PurchaseOrder"]

    def share(objs, etype):
        return round(sum(1 for o in objs if any(x[1] == etype for x in by_obj[o])) / max(1, len(objs)), 4)

    inv_rates = {k: share(inv, k) for k in ("Three-Way Match Failed", "Three-Way Match Passed", "Invoice Blocked",
                                            "Invoice Unblocked", "Invoice Parked", "Invoice Changed",
                                            "Credit Memo Posted", "Payment Executed", "Payment Reversed")}
    po_rates = {k: share(pos, k) for k in ("PO Price Changed", "PO Quantity Changed", "Partial Receipt Posted",
                                           "Goods Receipt Reversed", "Return to Supplier Posted",
                                           "Quality Inspection Failed", "PO Rejected", "PO Item Deleted")}
    # lags in days along the P2P spine, measured per PO (first occurrence of each milestone among its events)
    spine = ("Purchase Order Created", "PO Released", "Goods Receipt Posted", "Invoice Received", "Invoice Posted",
             "Payment Executed")
    lags = defaultdict(list)
    sod = Counter()
    for o in pos:
        first = {}
        actors = defaultdict(set)
        for when, et, actor, role in sorted(by_obj[o], key=lambda x: x[0]):
            first.setdefault(et, when)
            if actor:
                actors[et].add(actor)
        for a, b in zip(spine, spine[1:]):
            if a in first and b in first and first[b] >= first[a]:
                lags[f"{a} -> {b}"].append((first[b] - first[a]).total_seconds() / 86400)
        # separation-of-duties pairs observed in the reference log (same actor on both sides)
        for a, b in (("Purchase Order Created", "Goods Receipt Posted"), ("Purchase Order Created", "Invoice Posted"),
                     ("PO Released", "Purchase Order Created"), ("Invoice Posted", "Payment Executed")):
            if actors.get(a) and actors.get(b):
                sod[f"{a} & {b}"] += 1
                if actors[a] & actors[b]:
                    sod[f"{a} & {b} :same_actor"] += 1
    inv_per_po = Counter(Counter(po_of_inv.values()).values())
    sod_rates = {k: round(sod.get(k + " :same_actor", 0) / v, 4) for k, v in sod.items() if not k.endswith(":same_actor")}
    wk = sorted(week.values())
    res = {
        "source": {"record": "Zenodo 22079246 (Berti, A., Synthetic relational databases and reference OCELs, 2026-08-24)",
                   "doi": "10.5281/zenodo.22079246", "file": "procurechange.jsonocel.gz", "bytes": 7393340,
                   "sha256": "6ace16482a80393854b5075f8255326f8cbf0f1463ada1d43601e9d9a980ebd8",
                   "url": "https://zenodo.org/api/records/22079246/files/procurechange.jsonocel.gz/content",
                   "licence": "CC BY 4.0", "events": len(d["events"]), "objects": len(d["objects"])},
        "note": "aggregates only; no identifier, business key or actor id is kept (THESIS D10). The OCEL carries no "
                "amounts, so amounts and tolerances in abr-p2p-audit are fictional policy values",
        "counts": {"invoices": len(inv), "purchase_orders": len(pos),
                   "suppliers": sum(1 for v in otype.values() if v == "Supplier")},
        "invoice_event_rates": inv_rates, "po_event_rates": po_rates,
        "invoices_per_po": {str(k): v for k, v in sorted(inv_per_po.items())},
        "invoices_received_per_week": {"weeks": len(wk), "p10": q(wk, .1), "p50": q(wk, .5), "p90": q(wk, .9)},
        "lag_days": {k: {"n": len(v), "p25": q(v, .25), "p50": q(v, .5), "p75": q(v, .75), "p90": q(v, .9)}
                     for k, v in lags.items()},
        "sod_same_actor_rate": sod_rates,
        "actor_roles_by_event": {k: dict(v.most_common(3)) for k, v in sorted(role_by_type.items())
                                 if k in spine or k.startswith(("Invoice", "Three-Way", "Payment"))},
        "exception_flagged_events": dict(exc_by_type.most_common(12)),
        "event_type_counts": dict(ev_types.most_common()),
    }
    with open(out, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps({"invoices": len(inv), "pos": len(pos), "match_failed": inv_rates["Three-Way Match Failed"],
                      "blocked": inv_rates["Invoice Blocked"], "sod": sod_rates}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
