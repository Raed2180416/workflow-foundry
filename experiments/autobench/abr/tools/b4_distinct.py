#!/usr/bin/env python3
"""B4 effective-breadth check (PLAN §6.4): single linkage over clause/trap/state/app signatures, tau = 0.35
(preregistered in PLAN §6.4). Distance = 1 - Jaccard(feature sets). A new family whose nearest neighbour is closer
than tau falls into that neighbour's cluster: the plan's rule is to stop and redirect (for abr-itsm-queue: swap in
abr-erp-dunning when within tau of abr-ops-slawatch or E7).

    python3 -I experiments/autobench/abr/tools/b4_distinct.py [--out OUT.json]

Feature extraction (written before any distance was computed, 2026-11-04):
  app:<name>; trigger:{schedule,row-new,row-update,email}; hard:<requirement>; trap:<T-kind>; mech:<mechanism>, where
  a mechanism is found by keyword in the family's own rule text (AB-R: POLICY.md; V: family.spec.json clause text;
  E7: beds/ebed/e7/spec/SPEC-E.md): deadline-clock, pause-resume, once-only, editions, month-end, holds-release,
  approval, sod, duplicate, grouping, money-tolerance, compensation, priority-matrix, holidays, local-time, escalation,
  reassignment, routing. Inference, not ground truth: the keyword map is ours and coarse; the output lists every
  feature so a reader can audit it.
"""
from __future__ import annotations

import argparse
import itertools
import json
import re
from pathlib import Path

AB = Path(__file__).resolve().parents[2]
ROOT = AB.parents[1]
TAU = 0.35
MECH = {
    "deadline-clock": r"\bdeadline|\bdue\b|\bwithin \d+ (?:hours|minutes|days)|\bSLA\b",
    "pause-resume": r"\bpause|\bresum|waiting on customer|awaiting",
    "once-only": r"\bonce\b|\balready (?:warned|sent|posted|reminded)|not (?:again|twice)",
    "editions": r"policy log|edition|amendment",
    "month-end": r"month-end|end of (?:the )?month|last working day of",
    "holds-release": r"\bhold\b|\brelease",
    "approval": r"\bapprov",
    "sod": r"separation of duties|\bSOD\b",
    "duplicate": r"duplicate|dedup|same .* twice",
    "grouping": r"problem record|same CI|correlat|join(?:s)? one open",
    "money-tolerance": r"tolerance|unit price|amount",
    "compensation": r"retract|compensat|cancel(?:led)? .*refund|reverse",
    "priority-matrix": r"impact|urgency|priority matrix",
    "holidays": r"holiday",
    "local-time": r"time zone|offset|DST|local",
    "escalation": r"escalat",
    "reassignment": r"reassign",
    "routing": r"\broute|routing|assign(?:ment)? (?:by|rule)",
}
TRIG = [(r"^tick$|^check$|schedule|hourly|daily|close|payment_run|\brun\b", "schedule"), (r"opened|new|arriv|intake|alert|receipt|invoice", "row-new"),
        (r"updated|change|edit", "row-update"), (r"email|mail|amend|request|inbox", "email")]


def mechs(text: str) -> set:
    return {f"mech:{k}" for k, rx in MECH.items() if re.search(rx, text, re.I)}


def trig(names) -> set:
    out = set()
    for n in names:
        for rx, f in TRIG:
            if re.search(rx, n, re.I):
                out.add(f"trigger:{f}")
                break
    return out


def abr_family(d: Path) -> set:
    j = json.loads((d / "family.json").read_text())
    f = {f"app:{a}" for a in j.get("apps", [])}
    f |= trig(j.get("triggerKinds", {}).keys())
    f |= {f"hard:{h}" for h in j.get("hardRequirements", [])}
    f |= {f"trap:{t.split(':')[0]}" for t in (j.get("trapCatalogue") or {})}
    f |= mechs((d / "POLICY.md").read_text())
    return f


def v_family(d: Path) -> set:
    s = json.loads((d / "family.spec.json").read_text())
    f = {f"app:{a}" for a in s["host"]["apps"]}
    f |= trig(s["triggers"].keys())
    f |= {f"hard:{h}" for h in s.get("hard_requirements", [])}
    f |= {f"trap:{t['id'].split(':')[0]}" for t in s["traps"]}
    f |= mechs(" ".join(c["text"] for c in s["clauses"]))
    return f


def e7() -> set:
    spec = ROOT / "beds/ebed/e7/spec/SPEC-E.md"
    text = spec.read_text() if spec.exists() else ""
    # E7 runs on its own host (beds/ebed/host), not on AutomationBench's apps; its traps are named in DESIGN.md
    f = {"app:ebed-host", "trigger:row-new", "trigger:row-update", "trigger:schedule", "hard:schedule", "hard:approvals",
         "trap:T-clock", "trap:T-replay", "trap:T-authority", "trap:T-format"}
    return f | mechs(text)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    sig = {}
    for d in sorted((AB / "families").glob("abr-*")):
        if (d / "family.json").exists():
            sig[d.name] = abr_family(d)
        elif (d / "family.spec.json").exists():
            sig[d.name] = v_family(d)
    sig["ebed-e7"] = e7()
    names = sorted(sig)
    dist = {}
    for x, y in itertools.combinations(names, 2):
        j = len(sig[x] & sig[y]) / max(1, len(sig[x] | sig[y]))
        dist[(x, y)] = dist[(y, x)] = round(1 - j, 4)
    # single linkage clusters at tau
    parent = {n: n for n in names}

    def find(n):
        while parent[n] != n:
            n = parent[n]
        return n
    for (x, y), dd in dist.items():
        if dd < TAU:
            parent[find(x)] = find(y)
    clusters = {}
    for n in names:
        clusters.setdefault(find(n), []).append(n)
    v = [n for n in names if (AB / "families" / n / "family.spec.json").exists()]
    report = {}
    for n in v:
        near = sorted(((dist[(n, m)], m) for m in names if m != n))
        report[n] = {"nearest": near[:3], "within_tau": [m for d_, m in near if d_ < TAU],
                     "distinct": all(d_ >= TAU for d_, _ in near)}
    out = {"tau": TAU, "families": len(names), "clusters": sorted(sorted(c) for c in clusters.values()),
           "effective_breadth": len(clusters), "v_families": report,
           "itsm_queue_vs_slawatch": dist.get(("abr-itsm-queue", "abr-ops-slawatch")),
           "itsm_queue_vs_e7": dist.get(("abr-itsm-queue", "ebed-e7")),
           "swap_rule_fires": not report.get("abr-itsm-queue", {"distinct": True})["distinct"]
           and bool(set(report["abr-itsm-queue"]["within_tau"]) & {"abr-ops-slawatch", "ebed-e7"}),
           "features": {n: sorted(sig[n]) for n in names}}
    text = json.dumps(out, indent=1)
    if a.out:
        Path(a.out).write_text(text + "\n")
    print(json.dumps({k: out[k] for k in ("effective_breadth", "itsm_queue_vs_slawatch", "itsm_queue_vs_e7", "swap_rule_fires")}
                     | {"v": {n: (r["nearest"][0], r["distinct"]) for n, r in report.items()}}))


if __name__ == "__main__":
    main()
