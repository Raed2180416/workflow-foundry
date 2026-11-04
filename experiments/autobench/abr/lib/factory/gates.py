#!/usr/bin/env python3
"""Oracle-validity gates G0-G12 for a factory family (PLAN §6.3), $0 except G8/G9/G11 (paid or another session: this
script prints their exact commands and marks them pending; it never calls a model).

    <python> -I experiments/autobench/abr/lib/factory/gates.py --family abr-reg-incident-clock \
        [--seeds 2113-2116] [--practice 2101-2104] [--only G2,G5] [--out DIR]

Run with AutomationBench's venv python for the full set: G1's WorldState round trip, G10's AutomationBench handler
cross-check (ab_disagree) and G12's parity between abr-apply (WorldStore) and the app's own model path (ToolStore
through bridge.Rollout) need it; under any other python those three sub-checks report "skipped: needs the
AutomationBench venv" and the gate does not pass. Prints aggregates only (admission rule: a session that did not write
the family runs this and reports aggregates).
"""
from __future__ import annotations

import argparse
import copy
import json
import random
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUTOBENCH = HERE.parents[2]
if str(AUTOBENCH) not in sys.path:
    sys.path.append(str(AUTOBENCH))

from abr.lib.factory import harness as H  # noqa: E402
from abr.lib.factory.oracle import Grader, canon  # noqa: E402
from abr.lib.factory.spec import compile_family, lint  # noqa: E402


def have_ab() -> bool:
    try:
        import automationbench  # noqa: F401
        return True
    except ImportError:
        return False


class Gates:
    def __init__(self, family: str, seeds: list[int], practice: list[int]):
        self.fam = H.Family(family)
        self.seeds, self.practice = seeds, practice
        self.grader = Grader(self.fam.spec)
        self._streams: dict = {}
        self._runs: dict = {}

    def stream(self, s, **kw):
        key = (s, tuple(sorted(kw.items())))
        if key not in self._streams:
            self._streams[key] = self.fam.generate(s, **kw)
        return self._streams[key]

    def run(self, solver_name: str, s: int, keep=False, **kw):
        key = (solver_name, s, keep, tuple(sorted(kw.items())))
        if key not in self._runs:
            self._runs[key] = H.run_stream(self.fam, self.stream(s, **kw), self.fam.solver(solver_name), "fast",
                                           self.grader, keep_worlds=keep)
        return self._runs[key]

    # -- G0 ------------------------------------------------------------------------------------------------------------
    def g0(self):
        problems = lint(self.fam.spec)
        try:
            compile_family(self.fam.dir, check=True)
        except SystemExit as e:
            problems.append(str(e))
        clauses = Counter(c for s in self.seeds for t in self.stream(s)["truth"] for c in t["clauses"])
        quiet = {c["id"] for c in self.fam.spec["clauses"] if "Quiet" in c["title"]}
        unexercised = [c["id"] for c in self.fam.spec["clauses"] if c["id"] not in clauses and c["id"] not in quiet]
        problems += [f"clause {c} never exercised on dev streams" for c in unexercised]
        return {"pass": not problems, "problems": problems, "clause_counts": dict(clauses)}

    # -- G1 ------------------------------------------------------------------------------------------------------------
    def g1(self):
        problems, hashes = [], {}
        for s in self.seeds:
            a, b = self.fam.generate(s), self.fam.generate(s)
            if a["meta"]["sha256"] != b["meta"]["sha256"]:
                problems.append(f"{s}: regenerated stream differs")
            hashes[s] = a["meta"]["sha256"]["triggers"]
        if len(set(hashes.values())) != len(hashes):
            problems.append("two seeds produced the same trigger stream")
        rt = "skipped: needs the AutomationBench venv"
        if have_ab():
            bad = []
            for s in self.seeds:
                if not round_trips(self.stream(s)["world0"]):
                    bad.append(s)
                res = self.run("reference", s, keep=True)
                for before, after in res["worlds"][::7]:
                    if not round_trips(after):
                        bad.append(f"{s}:after")
                        break
            rt = "ok" if not bad else f"not round-tripping: {bad[:5]}"
            if bad:
                problems.append(f"WorldState round trip: {bad[:5]}")
        else:
            problems.append(rt)
        return {"pass": not problems, "problems": problems, "round_trip": rt}

    # -- G2 / G4 -------------------------------------------------------------------------------------------------------
    def g2(self):
        out = {}
        for s in self.practice + self.seeds:
            r = self.run("reference", s)
            out[s] = f"{sum(x['pass'] for x in r['rows'])}/{len(r['rows'])}"
        bad = {s: v for s, v in out.items() if v.split("/")[0] != v.split("/")[1]}
        return {"pass": not bad, "per_stream": out, "failing": bad}

    def g4(self):
        """N-version agreement: the truth engine's effects equal the observable-only reference's ledger on every dev
        stream (a trigger agrees when the oracle finds exactly the expected effects and nothing else)."""
        agree = tot = 0
        sig = Counter()
        for s in self.seeds:
            r = self.run("reference", s)
            for x, t in zip(r["rows"], self.stream(s)["truth"]):
                tot += 1
                agree += x["pass"]
                for e in t["expect"]:
                    sig[e["t"] + ":" + e.get("clause", "?")] += 1
        return {"pass": agree == tot, "agreement": f"{agree}/{tot}", "effect_signatures": dict(sorted(sig.items()))}

    # -- G3 ------------------------------------------------------------------------------------------------------------
    def g3(self):
        problems, killed, tried = [], 0, 0
        for s in self.seeds[:2]:
            st = self.stream(s)
            res = self.run("reference", s, keep=True)
            for (before, after), truth in zip(res["worlds"], st["truth"]):
                for i in range(len(truth["expect"])):
                    t2 = dict(truth, expect=truth["expect"][:i] + truth["expect"][i + 1:])
                    tried += 1
                    killed += not self.grader.grade(t2, before, after)["pass"]
        if killed != tried:
            problems.append(f"dropping an expected effect went unnoticed {tried - killed}/{tried} times")
        dec = []
        for c in self.fam.spec["clauses"]:
            fails = sum(sum(not x["pass"] for x in self.run(f"clause_{c['id']}", s)["rows"]) for s in self.seeds)
            if fails == 0:
                dec.append(c["id"])
        if dec:
            problems.append(f"decorative clauses (their removal fails nothing): {dec}")
        return {"pass": not problems, "problems": problems, "effect_drop_killed": f"{killed}/{tried}"}

    # -- G5 ------------------------------------------------------------------------------------------------------------
    def g5(self):
        rows, problems = {}, []
        # the last trigger of a stream also carries the end-of-stream checks, so a null solver cannot pass it
        noop = sum(t["expect"] == [] for s in self.seeds for t in self.stream(s)["truth"][:-1]) / \
            sum(len(self.stream(s)["truth"]) for s in self.seeds)
        acting = {(s, i) for s in self.seeds for i, t in enumerate(self.stream(s)["truth"]) if t["expect"]}
        for name in self.fam.controls():
            rs = [self.run(name, s) for s in self.seeds]
            trig = [x for r in rs for x in r["rows"]]
            rate = sum(x["pass"] for x in trig) / len(trig)
            cw = sum(r["clean_weeks"] for r in rs)
            act = [x for s, r in zip(self.seeds, rs) for i, x in enumerate(r["rows"]) if (s, i) in acting]
            rows[name] = {"pass_rate": round(rate, 4), "clean_weeks": f"{cw}/{sum(r['weeks'] for r in rs)}",
                          "acting_pass_rate": round(sum(x["pass"] for x in act) / max(1, len(act)), 4),
                          "clean_streams": sum(r["clean_stream"] for r in rs), "detected": rate < 1.0,
                          "hard_violations": sum(r["hard_violations"] for r in rs)}
            if rate >= 1.0:
                problems.append(f"control {name} is not detected (passes every trigger)")
        bars = {"null == no-op share": abs(rows["null"]["pass_rate"] - round(noop, 4)) < 1e-3,
                "echo == 0": rows["echo"]["pass_rate"] == 0.0,
                "naive < 0.60 per trigger": rows.get("naive", {"pass_rate": 0})["pass_rate"] < 0.60,
                "naive keeps no clean stream": rows.get("naive", {"clean_streams": 0})["clean_streams"] == 0,
                "memoryless < 0.90 and no clean week": rows["memoryless"]["pass_rate"] < 0.90 and rows["memoryless"]["clean_weeks"].startswith("0/")}
        problems += [f"bar missed: {k}" for k, ok in bars.items() if not ok]
        # reported beside the plan's bar, never replacing it: with a no-op share near 0.8 the per-trigger bar measures
        # the stream's quiet share, so the triviality question is also asked on the acting triggers (owner decision OD-F1)
        nv = rows.get("naive", {"acting_pass_rate": 1.0, "clean_weeks": "1/"})
        info = {"naive_acting_pass_rate": nv["acting_pass_rate"],
                "proposed_bar_OD-F1": "naive < 0.60 on acting triggers and zero clean weeks",
                "proposed_bar_met": nv["acting_pass_rate"] < 0.60 and nv["clean_weeks"].startswith("0/")}
        return {"pass": not problems, "problems": problems, "noop_share": round(noop, 4), "bars": bars, "info": info,
                "controls": rows}

    # -- G6 ------------------------------------------------------------------------------------------------------------
    def g6(self):
        problems, out = [], {}
        for t in self.fam.spec["traps"]:
            exposed = [(s, i) for s in self.seeds for i, tr in enumerate(self.stream(s)["triggers"]) if t["id"] in tr["traps"]]
            ref_ok = all(self.run("reference", s)["rows"][i]["pass"] for s, i in exposed)
            fail_exposed = sum(not self.run(t["control"], s)["rows"][i]["pass"] for s, i in exposed)
            fail_any = sum(sum(not x["pass"] for x in self.run(t["control"], s)["rows"]) for s in self.seeds)
            out[t["id"]] = {"exposed": len(exposed), "control": t["control"], "control_fails_on_exposed": fail_exposed,
                            "control_fails_anywhere": fail_any, "reference_passes_exposed": ref_ok}
            if len(exposed) < 5:
                problems.append(f"{t['id']} exposed {len(exposed)} times over {len(self.seeds)} dev streams (< 5)")
            if fail_exposed == 0 or not ref_ok:
                problems.append(f"{t['id']} is not fail-to-pass on its exposed triggers")
        return {"pass": not problems, "problems": problems, "traps": out}

    # -- G7 ------------------------------------------------------------------------------------------------------------
    def g7(self):
        out, problems = {}, []
        for label, kw in (("rename", {"rename": True}), ("shift+7d", {"shift_days": 7}), ("shift+364d", {"shift_days": 364})):
            for s in self.seeds[:2]:
                r = self.run("reference", s, **kw)
                ok = all(x["pass"] for x in r["rows"])
                out[f"{label}/{s}"] = f"{sum(x['pass'] for x in r['rows'])}/{len(r['rows'])}"
                if not ok:
                    problems.append(f"{label} on {s}: reference not at 100%")
        out["permute"] = "not implemented: same-instant independent events are rare in these streams (gap)"
        return {"pass": not problems, "problems": problems, "variants": out}

    # -- G10 -----------------------------------------------------------------------------------------------------------
    def g10(self):
        rng = random.Random(f"g10:{self.fam.name}")
        killed = tried = neutral_ok = neutral_tried = 0
        by_op = defaultdict(lambda: [0, 0])
        for s in self.seeds[:2]:
            st = self.stream(s)
            res = self.run("reference", s, keep=True)
            for (before, after), truth in zip(res["worlds"], st["truth"]):
                for op, mut in mutants(before, after, truth, rng):
                    v = self.grader.grade(truth, before, mut)["pass"]
                    if op.startswith("neutral"):
                        neutral_tried += 1
                        neutral_ok += v
                    else:
                        tried += 1
                        killed += not v
                        by_op[op][0] += not v
                        by_op[op][1] += 1
        score = killed / max(1, tried)
        abd = "skipped: needs the AutomationBench venv"
        problems = []
        if have_ab():
            from abr.lib.factory.oracle import ABCheck
            abc = ABCheck()
            n = 0
            for s in self.seeds:
                r = H.run_stream(self.fam, self.stream(s), self.fam.solver("reference"), "fast", self.grader, ab_check=abc)
                n += sum(1 for x in r["rows"] if x["ab_disagree"])
            abd = n
            if n:
                problems.append(f"ab_disagree = {n}")
        else:
            problems.append(abd)
        if score < 0.95:
            problems.append(f"mutation score {score:.3f} < 0.95")
        if neutral_ok != neutral_tried:
            problems.append(f"policy-neutral variants rejected {neutral_tried - neutral_ok}/{neutral_tried}")
        return {"pass": not problems, "problems": problems, "mutation_score": round(score, 4), "killed": f"{killed}/{tried}",
                "neutral_accepted": f"{neutral_ok}/{neutral_tried}", "ab_disagree": abd,
                "by_operator": {k: f"{a}/{n}" for k, (a, n) in sorted(by_op.items())}}

    # -- G12 -----------------------------------------------------------------------------------------------------------
    def g12(self):
        problems = []
        ref_src = (self.fam.dir / "reference.py").read_text()
        imports = re.findall(r"^\s*(?:from|import)\s+([\w.]+)", ref_src, re.M)
        banned = [m for m in imports if m.split(".")[-1] in ("model", "oracle", "genbase", "clock", "gates", "harness", "world")]
        if banned:
            problems.append(f"reference imports host-only modules: {banned}")
        leak_keys = {"expect", "clauses", "needs_state", "traps", "delta", "truth"}
        for s in self.seeds:
            for p in self.stream(s)["payloads"]:
                if leak_keys & set(json.dumps(p).replace('"', " ").split()):
                    problems.append(f"payload {p['trigger']} carries a host-only key")
                    break
        parity = "skipped: needs the AutomationBench venv"
        if have_ab():
            parity = abr_apply_parity(self.fam, self.seeds[:2], self.grader)
            if parity["differences"]:
                problems.append(f"abr-apply differs from the app's own model path: {parity['differences'][:3]}")
        else:
            problems.append(parity)
        return {"pass": not problems, "problems": problems, "parity": parity}

    def pending(self, gid):
        cmds = {
            "G8": f"NOT BUILT: run.mjs mode blind refuses (no tools may be given); needs a no-tool Haiku session per sampled dev "
                  f"trigger of {self.fam.name}, about $0.05-0.15 for 200 triggers; bar: pass rate below the no-op share + 0.15",
            "G9": f"MANUAL: a session that did not write {self.fam.name} reads POLICY.md and practice worlds (seeds 2101-2104) and "
                  f"writes the effects of 20 sampled triggers; compare host-side with the truth; about $1",
            "G11": f"node experiments/breadth/factory/run.mjs --arm A-H --family {self.fam.name} --seeds 2113 --cap 2 ; "
                   f"node experiments/breadth/factory/run.mjs --arm A-S --family {self.fam.name} --seeds 2113 --cap 25 "
                   f"(flag if A-H beats A-S by more than 0.10 in clean-week share); $5-24",
        }
        return {"pass": None, "status": "pending: paid or needs another session; not run here ($0 rule)", "command": cmds[gid]}


def mutants(before: dict, after: dict, truth: dict, rng):
    """Mutation operators on the reference's world_after (oracle sensitivity) and policy-neutral variants (must pass)."""
    out = []
    bmsg = {(m["channel_id"], m["ts"]) for m in before["slack"]["messages"]}
    new_posts = [i for i, m in enumerate(after["slack"]["messages"]) if (m["channel_id"], m["ts"]) not in bmsg]
    bmail = {m["id"] for m in before["gmail"]["messages"]}
    new_mail = [i for i, m in enumerate(after["gmail"]["messages"]) if m["id"] not in bmail]
    brow = {r["id"]: r for r in before["google_sheets"]["rows"]}
    changed = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["id"] in brow and r["cells"] != brow[r["id"]]["cells"]]
    appended = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["id"] not in brow]
    chans = [c["id"] for c in after["slack"]["channels"]]

    def m(fn, op):
        w = copy.deepcopy(after)
        fn(w)
        out.append((op, w))

    for i in new_posts:
        m(lambda w, i=i: w["slack"]["messages"].pop(i), "drop-post")
        m(lambda w, i=i: w["slack"]["messages"].append(copy.deepcopy(w["slack"]["messages"][i]) | {"ts": w["slack"]["messages"][i]["ts"] + "9"}), "duplicate-post")
        m(lambda w, i=i: w["slack"]["messages"][i].update(text=w["slack"]["messages"][i]["text"] + " X1"), "alter-post-text")
        m(lambda w, i=i: w["slack"]["messages"][i].update(channel_id=next(c for c in chans if c != w["slack"]["messages"][i]["channel_id"])), "wrong-channel")
        m(lambda w, i=i: w["slack"]["messages"][i].update(created_at="2020-01-01T00:00:00.000000"), "wrong-time")
        m(lambda w, i=i: w["slack"]["messages"][i].update(text="  " + w["slack"]["messages"][i]["text"].lower() + " "), "neutral-case-space")
    for i in new_mail:
        m(lambda w, i=i: w["gmail"]["messages"].pop(i), "drop-mail")
        m(lambda w, i=i: w["gmail"]["messages"][i].update(to=["someone.else@example.org"]), "wrong-recipient")
        m(lambda w, i=i: w["gmail"]["messages"][i].update(subject=w["gmail"]["messages"][i]["subject"] + " (2)"), "alter-subject")
        m(lambda w, i=i: w["gmail"]["messages"][i].update(to=w["gmail"]["messages"][i]["to"] + ["cc@example.org"]), "extra-recipient")
    for i in changed:
        def alter(w, i=i):
            r = w["google_sheets"]["rows"][i]
            col = next(c for c in r["cells"] if r["cells"][c] != brow[r["id"]]["cells"].get(c))
            r["cells"][col] = (r["cells"][col] or "") + "1"
        m(alter, "alter-cell")

        def revert(w, i=i):
            r = w["google_sheets"]["rows"][i]
            r["cells"] = dict(brow[r["id"]]["cells"])
        m(revert, "drop-cell-write")

        def extra(w, i=i):
            r = w["google_sheets"]["rows"][i]
            col = next((c for c in r["cells"] if r["cells"][c] == brow[r["id"]]["cells"].get(c)), None)
            if col:
                r["cells"][col] = (r["cells"][col] or "") + "x"
        m(extra, "extra-cell")

        def iso_variant(w, i=i):
            r = w["google_sheets"]["rows"][i]
            for c, v in r["cells"].items():
                if v != brow[r["id"]]["cells"].get(c) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", v or ""):
                    r["cells"][c] = v.replace("T", " ").replace("Z", " UTC")
        m(iso_variant, "neutral-iso-form")
    for i in appended:
        m(lambda w, i=i: w["google_sheets"]["rows"].pop(i), "drop-append")
    # side effects on a trigger that should touch other records
    others = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["id"] in brow and r["cells"] == brow[r["id"]]["cells"]]
    if others:
        j = rng.choice(others)
        m(lambda w, j=j: w["google_sheets"]["rows"][j]["cells"].update({next(iter(w["google_sheets"]["rows"][j]["cells"])): "touched"}), "touch-other-row")
    old_posts = [i for i, msg in enumerate(after["slack"]["messages"]) if (msg["channel_id"], msg["ts"]) in bmsg]
    if old_posts and rng.random() < 0.3:
        m(lambda w, i=old_posts[0]: w["slack"]["messages"][i].update(is_deleted=True), "delete-old-post")
    if rng.random() < 0.15 and chans:
        from abr.lib.factory.world import slack_message
        m(lambda w: w["slack"]["messages"].append(slack_message("1999999999.000001", chans[0], "USLACKBOT", "stray",
                                                                w["meta"]["current_time"].replace("Z", ""), is_bot=True)), "stray-post")
    return out


def abr_apply_parity(fam, seeds, grader) -> dict:
    """G12: abr-apply (WorldStore) vs the app's own model path (ToolStore via bridge.Rollout): per trigger, the two
    worlds after the reference ran must be equal once generated ids and clock fields are masked."""
    diffs, n = [], 0
    for s in seeds:
        st = fam.generate(s)
        fast = H.run_stream(fam, st, fam.solver("reference"), "fast", grader, keep_worlds=True)
        slow = H.run_stream(fam, st, fam.solver("reference"), "ab", grader, keep_worlds=True)
        apps = fam.spec["host"]["apps"]
        for k, ((_, a), (_, b)) in enumerate(zip(fast["worlds"], slow["worlds"])):
            n += 1
            pa, pb = mask(project(a, apps)), mask(project(b, apps))
            if canon(pa) != canon(pb):
                diffs.append(f"{s}/t{k:03d}: {first_diff(pa, pb)}")
            elif not round_trips(project(b, apps) | {"meta": b["meta"]}):
                diffs.append(f"{s}/t{k:03d}: the app path's world does not round-trip through WorldState")
        if not all(x["pass"] for x in slow["rows"]):
            diffs.append(f"{s}: reference fails on the AutomationBench path {sum(not x['pass'] for x in slow['rows'])} times")
    return {"streams": seeds, "triggers_compared": n, "differences": diffs[:20], "n_differences": len(diffs)}


def round_trips(w: dict) -> bool:
    """WorldState(w) dumps back to w on every app w defines, and every other app comes back as AutomationBench's empty
    default (the dump always lists all apps; a family world lists only its own)."""
    from automationbench.schema.world import WorldState
    d = WorldState(**copy.deepcopy(w)).model_dump(mode="json")
    if canon({k: d.get(k) for k in w}) != canon(w):
        return False
    empty = WorldState(meta=w["meta"]).model_dump(mode="json")
    return all(canon(d[k]) == canon(empty.get(k)) for k in d if k not in w)


def project(w: dict, apps) -> dict:
    return {k: w[k] for k in apps if k in w}


def mask(w: dict) -> dict:
    w = copy.deepcopy(w)
    w.pop("meta", None)
    for m in w["slack"]["messages"]:
        m["ts"] = m["ts"].split(".")[0][:8]
        m["created_at"] = (m.get("created_at") or "")[:16]
    w["slack"]["messages"].sort(key=lambda m: (m["channel_id"], m["ts"], m["text"]))
    for m in w["gmail"]["messages"]:
        if "SENT" in (m.get("label_ids") or []):
            m["id"] = m["thread_id"] = "masked"
            m["date"] = m["internal_date"] = int(m["date"]) // 60000
            m["snippet"] = None
    w["gmail"]["messages"].sort(key=lambda m: (m["date"], m["subject"] or ""))
    for a in w.get("jira", {}).get("actions", {}).get("create_issue", []):
        a["id"], a["created_at"] = "masked", a["created_at"][:16]
    for r in w["google_sheets"]["rows"]:
        if re.fullmatch(r"[0-9a-f]{32}", r["id"]):          # an id the app (or abr-apply) generated for an appended row
            r["id"] = "masked"
    w["google_sheets"]["rows"].sort(key=lambda r: (r["spreadsheet_id"], r["worksheet_id"], r["row_id"]))
    return w


def first_diff(a, b, path=""):
    if type(a) is not type(b):
        return f"{path}: {str(a)[:80]} != {str(b)[:80]}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if canon(a.get(k)) != canon(b.get(k)):
                return first_diff(a.get(k), b.get(k), f"{path}.{k}")
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: len {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            if canon(x) != canon(y):
                return first_diff(x, y, f"{path}[{i}]")
    return f"{path}: {str(a)[:80]} != {str(b)[:80]}"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--family", required=True)
    ap.add_argument("--seeds", default="2113-2116")
    ap.add_argument("--practice", default="2101-2104")
    ap.add_argument("--only")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    g = Gates(a.family, H.parse_seeds(a.seeds), H.parse_seeds(a.practice))
    order = ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"]
    only = set(a.only.split(",")) if a.only else set(order)
    res, t0 = {}, time.time()
    for gid in order:
        if gid not in only:
            continue
        if gid in ("G8", "G9", "G11"):
            res[gid] = g.pending(gid)
        else:
            res[gid] = getattr(g, gid.lower())()
    run = [k for k, v in res.items() if v["pass"] is not None]
    out = {"family": a.family, "version": g.fam.model.VERSION, "seeds": a.seeds, "practice": a.practice,
           "python_has_automationbench": have_ab(), "secs": int(time.time() - t0),
           "pass_run_gates": all(res[k]["pass"] for k in run), "pending": [k for k, v in res.items() if v["pass"] is None],
           "gates": res}
    text = json.dumps(out, indent=1, default=str)
    if a.out:
        Path(a.out).mkdir(parents=True, exist_ok=True)
        (Path(a.out) / f"gates-{a.family}.json").write_text(text + "\n")
    print(json.dumps({k: (v["pass"] if isinstance(v, dict) else v) for k, v in res.items()} | {"pass_run_gates": out["pass_run_gates"]}))
    sys.exit(0 if out["pass_run_gates"] else 1)


if __name__ == "__main__":
    main()
