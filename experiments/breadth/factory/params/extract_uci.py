#!/usr/bin/env python3
"""Extract stream PARAMETERS (aggregates only) from the UCI incident management event log (dataset 498, CC BY 4.0).

THESIS D10 / PLAN §6.2: only parameters cross from real logs; no row, id, caller, group or text is kept. The CSV is
deleted after this runs (DISPOSALS.md). Run with the system python, isolated, the CSV path as an argument:

    python3 -I experiments/breadth/factory/params/extract_uci.py /var/tmp/.../incident_event_log.csv OUT.json

Output: weekly arrival profile (weekday x hour share), priority mix, per-priority resolution-time quantiles, the mined
SLA threshold per priority (the duration that best separates made_sla true from false), reassignment and reopen
distributions, the share of incidents that ever enter an Awaiting state (the SLA pause analogue) and the pause count,
and the problem / change (rfc) linkage shares. Every number is rounded; nothing identifies a row.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime


def ts(s: str):
    s = (s or "").strip()
    if not s or s == "?":
        return None
    return datetime.strptime(s, "%d/%m/%Y %H:%M")


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def best_threshold(pairs):
    """Duration threshold h (hours) maximising accuracy of 'made_sla == (duration <= h)'; pairs = [(hours, made)]."""
    pairs = sorted(pairs)
    n = len(pairs)
    if not n:
        return None, None
    total_false = sum(1 for _, m in pairs if not m)
    best = (total_false, 0.0)        # threshold below everything: all predicted False
    true_le = false_le = 0
    for i, (h, m) in enumerate(pairs):
        if m:
            true_le += 1
        else:
            false_le += 1
        if i + 1 < n and pairs[i + 1][0] == h:
            continue
        correct = true_le + (total_false - false_le)
        if correct > best[0]:
            best = (correct, h)
    return best[1], best[0] / n


def main(path: str, out: str):
    rows_by = defaultdict(list)
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            rows_by[r["number"]].append(r)
    inc = []
    for num, rs in rows_by.items():
        last = max(rs, key=lambda r: int(r["sys_mod_count"] or 0))
        states = [r["incident_state"] for r in sorted(rs, key=lambda r: int(r["sys_mod_count"] or 0))]
        pauses, prev = 0, None
        for s in states:
            if s.startswith("Awaiting") and not (prev or "").startswith("Awaiting"):
                pauses += 1
            prev = s
        opened, resolved = ts(last["opened_at"]), ts(last["resolved_at"])
        inc.append({
            "opened": opened, "resolved": resolved, "priority": last["priority"].strip(),
            "made_sla": last["made_sla"].strip().lower() == "true",
            "reassign": int(last["reassignment_count"] or 0), "reopen": int(last["reopen_count"] or 0),
            "pauses": pauses, "problem": last["problem_id"].strip() not in ("", "?"),
            "rfc": last["rfc"].strip() not in ("", "?"), "contact": last["contact_type"].strip(),
        })
    n = len(inc)
    wk = Counter()
    for x in inc:
        if x["opened"]:
            wk[(x["opened"].weekday(), x["opened"].hour)] += 1
    wk_total = sum(wk.values())
    weekday_share = {d: round(sum(v for (dd, _), v in wk.items() if dd == d) / wk_total, 4) for d in range(7)}
    bh = sum(v for (d, h), v in wk.items() if d < 5 and 9 <= h < 18)
    hour_share_weekdays = {h: round(sum(v for (d, hh), v in wk.items() if d < 5 and hh == h) /
                                    max(1, sum(v for (d, _), v in wk.items() if d < 5)), 4) for h in range(24)}
    first = min(x["opened"] for x in inc if x["opened"])
    last_open = max(x["opened"] for x in inc if x["opened"])
    weeks = max(1.0, (last_open - first).days / 7)
    pri = Counter(x["priority"] for x in inc)
    per_pri = {}
    for p in sorted(pri):
        durs = [((x["resolved"] - x["opened"]).total_seconds() / 3600, x["made_sla"]) for x in inc
                if x["priority"] == p and x["opened"] and x["resolved"] and x["resolved"] >= x["opened"]]
        hs = [h for h, _ in durs]
        thr, acc = best_threshold(durs)
        per_pri[p] = {
            "share": round(pri[p] / n, 4), "n_resolved": len(durs),
            "made_sla_rate": round(sum(1 for x in inc if x["priority"] == p and x["made_sla"]) / pri[p], 4),
            "resolve_hours_q": {k: (round(q(hs, v), 2) if hs else None)
                                for k, v in (("p10", .1), ("p25", .25), ("p50", .5), ("p75", .75), ("p90", .9))},
            "mined_sla_threshold_hours": round(thr, 2) if thr is not None else None,
            "mined_threshold_accuracy": round(acc, 4) if acc is not None else None,
        }

    def dist(key, cap):
        c = Counter(min(x[key], cap) for x in inc)
        return {f"{k}{'+' if k == cap else ''}": round(c[k] / n, 4) for k in sorted(c)}

    res = {
        "source": {"dataset": "UCI Machine Learning Repository, ID 498: Incident management process enriched event log",
                   "url": "https://archive.ics.uci.edu/static/public/498/incident+management+process+enriched+event+log.zip",
                   "zip_sha256": "6294e29a311647306bfdfc85783f7df66517c197b9cd49aa5ee36ba9c525d1d6",
                   "licence": "CC BY 4.0", "doi": "10.24432/C57S4H",
                   "attribution": "Amaral, C., Fantinato, M., & Peres, S. (2018). Incident management process enriched "
                                  "event log [Dataset]. UCI Machine Learning Repository.",
                   "rows_read": sum(len(v) for v in rows_by.values()), "incidents": n},
        "note": "aggregates only; no row, identifier or free text is kept (THESIS D10)",
        "arrivals": {"incidents_per_week_mean": round(n / weeks, 1), "observed_weeks": round(weeks, 1),
                     "weekday_share": weekday_share, "weekday_hour_share": hour_share_weekdays,
                     "business_hours_share_mon_fri_9_18": round(bh / wk_total, 4)},
        "priority": per_pri,
        "reassignment_count": dist("reassign", 5),
        "reopen_count": dist("reopen", 2),
        "awaiting_pause_episodes": dist("pauses", 3),
        "ever_paused_share": round(sum(1 for x in inc if x["pauses"]) / n, 4),
        "problem_linked_share": round(sum(1 for x in inc if x["problem"]) / n, 4),
        "change_linked_share": round(sum(1 for x in inc if x["rfc"]) / n, 4),
        "made_sla_rate": round(sum(1 for x in inc if x["made_sla"]) / n, 4),
        "contact_type_share": {k: round(v / n, 4) for k, v in Counter(x["contact"] for x in inc).most_common()},
    }
    with open(out, "w") as f:
        json.dump(res, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps({"incidents": n, "weeks": res["arrivals"]["observed_weeks"],
                      "per_week": res["arrivals"]["incidents_per_week_mean"],
                      "thresholds": {p: v["mined_sla_threshold_hours"] for p, v in per_pri.items()}}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
