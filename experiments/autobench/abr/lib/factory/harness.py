#!/usr/bin/env python3
"""Factory stream runner ($0, no model): generate a family's stream, run a code solver trigger by trigger, grade every
trigger with the generic oracle.

    python3 -I experiments/autobench/abr/lib/factory/harness.py --family abr-reg-incident-clock \
        run --solver reference --seeds 2113-2116 [--mode fast|ab] [--failures] [--out DIR]

Modes: fast (default) applies the solver's reads and writes to the world dict (WorldStore, abr-apply; standard library
only); ab runs them through AutomationBench's own tools (bridge.Rollout + the determinism shim, clock = trigger time;
the AutomationBench venv), the path a model arm uses. Gate G12 proves the two give the same worlds.
Carry mode only (the solver's world evolves with its own effects; the headline). Seeds: practice and dev only (the
SEED-LEDGER factory-v-dev range); sealed seeds are refused here and generated only by experiments/breadth/factory/seal.py.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import sys
import time
import traceback
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUTOBENCH = HERE.parents[2]
FAMILIES = AUTOBENCH / "families"
if str(AUTOBENCH) not in sys.path:
    sys.path.append(str(AUTOBENCH))

from abr.lib.factory import store as S  # noqa: E402
from abr.lib.factory.oracle import Grader  # noqa: E402
from abr.lib.factory.world import apply_delta  # noqa: E402

DEV_SEEDS = range(2101, 2161)


class Family:
    """A factory family loaded from its directory: model (generator + truth engine), reference, controls, spec."""

    def __init__(self, name: str):
        self.name, self.dir = name, FAMILIES / name
        if str(self.dir) not in sys.path:
            sys.path.insert(0, str(self.dir))
        self.model = self._load("model")
        self.spec = self.model.SPEC
        self._ref = None
        self._controls = None

    def _load(self, mod: str):
        spec = importlib.util.spec_from_file_location(f"{self.name.replace('-', '_')}_{mod}", self.dir / f"{mod}.py")
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        return m

    @property
    def reference(self):
        if self._ref is None:
            self._ref = self._load("reference")
        return self._ref

    def controls(self) -> dict:
        if self._controls is None:
            from abr.lib.factory.controls import build_controls
            self._controls = build_controls(self)
        return self._controls

    def solver(self, name: str):
        if name == "reference":
            return self.reference.handle
        c = self.controls()
        if name in c:
            return c[name]
        path, _, fn = name.partition(":")
        spec = importlib.util.spec_from_file_location("solver_mod", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return getattr(mod, fn or "handle")

    def generate(self, seed: int, **kw) -> dict:
        return self.model.generate(seed, **kw)


def trigger_seed(family: str, seed: int, tid: str) -> int:
    return int(hashlib.sha256(f"{family}:{seed}:{tid}".encode()).hexdigest()[:12], 16)


class ABHost:
    """AutomationBench's tool path for one stream (the app's own model path)."""

    def __init__(self, fam: Family, stream: dict):
        import asyncio
        from abr.lib import host
        self.asyncio, self.host = asyncio, host
        self.b = host.bridge()
        from automationbench.schema.world import WorldState
        self.WS = WorldState
        row = fam.model.serve_input(stream["meta"]["seed"], stream["triggers"][0], intake="policy")
        self.r = self.b.Rollout(row, host.MAX_STEPS, stream["world0"], 0)
        asyncio.run(self.r.setup())

    def run(self, before: dict, at: str, seed: int, solver, payload) -> tuple[dict, object]:
        from datetime import datetime
        with self.b.SHIM.active():
            self.r.state["world"] = self.WS(**before)
        self.b.SHIM.reset(seed, datetime.fromisoformat(at.replace("Z", "+00:00")))
        self.r.steps, self.r.log = 0, []
        ctx = self.host.Ctx(self.r, payload)
        err = None
        try:
            solver(copy.deepcopy(payload), ctx)
        except Exception as e:  # noqa: BLE001  (a crashing solver is a failed trigger, never a crashed stream)
            err = f"{type(e).__name__}: {e}"[:400]
        return self.r.world(), ctx, err


def run_stream(fam: Family, stream: dict, solver, mode: str = "fast", grader: Grader | None = None,
               keep_worlds: bool = False, ab_check=None) -> dict:
    grader = grader or Grader(fam.spec)
    seed = stream["meta"]["seed"]
    world = stream["world0"]
    host = ABHost(fam, stream) if mode == "ab" else None
    rows, worlds = [], []
    last = len(stream["triggers"]) - 1
    for k, (trig, truth) in enumerate(zip(stream["triggers"], stream["truth"])):
        assert trig["trigger"] == truth["trigger"]
        before = apply_delta(world, trig["delta"], trig["at"])
        tseed = trigger_seed(fam.name, seed, trig["trigger"])
        t0 = time.time()
        err = None
        if host is None:
            ctx = S.FastCtx(copy.deepcopy(before), trig["at"], tseed)
            try:
                solver(copy.deepcopy(trig["payload"]), ctx)
            except Exception as e:  # noqa: BLE001
                err = f"{type(e).__name__}: {e}"[:400]
                if os.environ.get("ABR_DEBUG"):
                    traceback.print_exc()
            after = ctx.store.world
        else:
            after, ctx, err = host.run(before, trig["at"], tseed, solver, trig["payload"])
        v = grader.grade(truth, before, after, end=stream["end"] if k == last else None)
        abd = []
        if ab_check is not None and v["pass"]:
            abd = ab_check.failures(after, truth)
        rows.append({"taskKey": f"{fam.name}/s{seed}/t{trig['index']:03d}", "stream": seed, "trigger": trig["index"],
                     "week": trig["week"], "kind": trig["kind"], "pass": v["pass"], "pass_core": v["pass_core"],
                     "outcome": v["outcome"], "expected": v["expected"], "error": err, "traps": trig["traps"],
                     "clauses": truth.get("clauses", []), "needs_state": truth.get("needs_state", False),
                     "matched": v["matched"], "missed": v["missed"], "spurious": v["spurious"],
                     "hard_violations": v["hard_violations"], "ab_disagree": abd, "failed": v["failed"],
                     "steps": getattr(ctx, "steps", 0), "ms": int((time.time() - t0) * 1000)})
        if keep_worlds:
            worlds.append((before, after))
        world = after
    weeks = sorted({r["week"] for r in rows})
    out = {"seed": seed, "family": fam.name, "rows": rows,
           "clean_weeks": sum(all(r["pass"] for r in rows if r["week"] == w) for w in weeks), "weeks": len(weeks),
           "clean_stream": all(r["pass"] for r in rows) and sum(r["hard_violations"] for r in rows) == 0,
           "hard_violations": sum(r["hard_violations"] for r in rows),
           "first_failure": next((r["trigger"] for r in rows if not r["pass"]), None)}
    if keep_worlds:
        out["worlds"] = worlds
    return out


def summarize(results: list[dict]) -> dict:
    rows = [x for res in results for x in res["rows"]]
    by_kind, clause = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    for x in rows:
        by_kind[x["kind"]][0] += x["pass"]
        by_kind[x["kind"]][1] += 1
        for c in x["matched"]:
            clause[c][0] += 1
            clause[c][1] += 1
        for c in x["missed"] + x["spurious"]:
            clause[c][1] += 1
    noop = [x for x in rows if x["expected"] == "no-op"]
    return {"streams": len(results), "clean_streams": sum(r["clean_stream"] for r in results),
            "clean_weeks": f"{sum(r['clean_weeks'] for r in results)}/{sum(r['weeks'] for r in results)}",
            "triggers": len(rows), "passed": sum(x["pass"] for x in rows),
            "pass_rate": round(sum(x["pass"] for x in rows) / max(1, len(rows)), 4),
            "pass_core_rate": round(sum(x["pass_core"] for x in rows) / max(1, len(rows)), 4),
            "noop_share": round(len(noop) / max(1, len(rows)), 4),
            "hard_violations": sum(x["hard_violations"] for x in rows),
            "needs_state": f"{sum(x['pass'] for x in rows if x['needs_state'])}/{sum(1 for x in rows if x['needs_state'])}",
            "ab_disagree": sum(1 for x in rows if x["ab_disagree"]),
            "errors": sum(1 for x in rows if x["error"]),
            "outcomes": dict(Counter(x["outcome"] for x in rows)),
            "by_kind": {k: f"{a}/{n}" for k, (a, n) in sorted(by_kind.items())},
            "clause_accuracy": {k: round(a / n, 4) for k, (a, n) in sorted(clause.items())},
            "per_stream": {r["seed"]: f"{sum(x['pass'] for x in r['rows'])}/{len(r['rows'])} clean_weeks={r['clean_weeks']}"
                           for r in results}}


def parse_seeds(s: str, allowed=DEV_SEEDS) -> list[int]:
    out = []
    for part in str(s).split(","):
        if "-" in part:
            a, z = part.split("-")
            out += list(range(int(a), int(z) + 1))
        elif part:
            out.append(int(part))
    bad = [x for x in out if x not in allowed]
    if bad:
        raise SystemExit(f"seeds {bad} refused: practice/dev seeds 2101-2160 only (sealed streams stay host-only)")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="factory stream harness ($0)")
    ap.add_argument("--family", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("run")
    s.add_argument("--solver", default="reference")
    s.add_argument("--seeds", default="2113-2116")
    s.add_argument("--mode", choices=["fast", "ab"], default="fast")
    s.add_argument("--ab-check", action="store_true", help="AutomationBench handler cross-check (AutomationBench venv)")
    s.add_argument("--out")
    s.add_argument("--failures", action="store_true")
    a = ap.parse_args(argv)
    fam = Family(a.family)
    solver = fam.solver(a.solver)
    abc = None
    if a.ab_check:
        from abr.lib.factory.oracle import ABCheck
        abc = ABCheck()
    results = [run_stream(fam, fam.generate(sd), solver, a.mode, ab_check=abc) for sd in parse_seeds(a.seeds)]
    summary = {"family": fam.name, "version": fam.model.VERSION, "solver": a.solver, "mode": a.mode, **summarize(results)}
    if a.out:
        d = Path(a.out)
        d.mkdir(parents=True, exist_ok=True)
        with open(d / "results.jsonl", "w") as f:
            for res in results:
                for x in res["rows"]:
                    f.write(json.dumps({k: v for k, v in x.items() if k != "failed"} | {"failedChecks": [c["name"] for c in x["failed"]]}) + "\n")
        (d / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    if a.failures:
        for res in results:
            for x in res["rows"]:
                if not x["pass"]:
                    print(f"{x['taskKey']} {x['kind']} {x['outcome']} err={x['error']}")
                    for c in x["failed"][:6]:
                        print(f"   - {c['name']}: {str(c['detail'])[:260]}")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
