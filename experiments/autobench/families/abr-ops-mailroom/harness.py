#!/usr/bin/env python3
"""abr-ops-mailroom stream harness ($0, no model): generate a stream, run a code solver trigger by trigger through
AutomationBench's own tool path, grade every trigger with the oracle. Runs inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-ops-mailroom/harness.py \
        run --solver reference --seeds 610-614 [--mode both|carry|rebased] [--out DIR] [--failures]

Tool path. Each trigger's tool calls go through `bridge.Rollout.batch` (experiments/autobench/bridge.py), i.e. the
official AutomationBenchEnv.env_response with the 'api' toolset (api_search, api_fetch, base64_encode), exactly the
code `bridge.py serve` runs for a model arm, with the determinism shim in seed mode (ids and clock seeded per trigger,
clock = the trigger time, so a Slack post's ts falls on the trigger's day). The difference from serve is transport
only: a code solver calls the tools in process (ctx.fetch) instead of through the file mailbox, and the world carries
over between triggers in one process. Model arms use `bridge.py serve --input <serve-input row> --world world_t.json`
per trigger (gen.serve_input writes the row).

Per trigger: apply the trigger's delta (a new package row, a changed Notes or directory Status cell, a human Slack
message; validated through WorldState), set meta.current_time to the trigger time, snapshot world_before, run the
solver with (payload, ctx), snapshot world_after, grade. The solver sees the payload and the tools only; the truth,
the delta and the generator stay host-side in this process.

Modes (RECURRING-DESIGN §3.6): carry - the solver's world evolves with its own effects; rebased - before each trigger
the world is replaced by the reference run's world at that point (the reference passes every practice and dev trigger,
so that world is the truth's correct-history world).

Which number is which (review 2026-10-21). The truth of a trigger is a snapshot of the correct history, so in carry
mode one earlier miss also fails every later trigger that depends on it (that day's day.close, a later release) even
when the solver acts correctly on its own world: carry double-counts errors per trigger. So:
  - the per-trigger rate is the REBASED rate (each trigger graded once, on the world it should have seen);
  - clean weeks come from CARRY (a week is clean only if the solver's own world stays right all week);
  - the carry per-trigger rate is reported beside them, with `inherited` = triggers that fail in carry but pass rebased.
`--mode both` (the CLI default) runs both and reports exactly that.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUTOBENCH = HERE.parents[1]
os.environ["TZ"] = "UTC"          # the shim's naive now() is local time: pin it for determinism
time.tzset()
for p in (str(HERE), str(AUTOBENCH)):
    if p not in sys.path:
        sys.path.insert(0, p)

import gen  # noqa: E402
import oracle  # noqa: E402

MAX_STEPS = 50                    # the official loop: 50 model steps, so at most 49 tool-call steps per trigger
_BRIDGE = None


import sys as _b0_sys  # B0: experiments/autobench on the path for the shared abr.lib
from pathlib import Path as _B0Path
if str(_B0Path(__file__).resolve().parents[2]) not in _b0_sys.path:
    _b0_sys.path.append(str(_B0Path(__file__).resolve().parents[2]))
from abr.lib import common as _abr_common  # noqa: E402
from abr.lib import host as _abr_host  # noqa: E402


bridge = _abr_host.bridge


StepBudgetExceeded = _abr_host.StepBudgetExceeded


Ctx = _abr_host.Ctx


load_solver = _abr_host.load_solver


def apply_delta(world: dict, delta: list, at: str) -> dict:
    """Host-only world ops before a trigger fires, then meta.current_time = trigger time; validated by WorldState.
    Ops: insert {app, collection, record}; set_cells {spreadsheet_id, worksheet_id, row_id, cells}. In carry mode a
    solver may have removed the row a set_cells op names: the op is then skipped (a consequence of that solver's run)."""
    from automationbench.schema.world import WorldState
    w = json.loads(json.dumps(world))
    for op in delta:
        if op["op"] == "insert":
            w[op["app"]][op["collection"]].append(json.loads(json.dumps(op["record"])))
        elif op["op"] == "set_cells":
            row = next((r for r in w["google_sheets"]["rows"] if r["spreadsheet_id"] == op["spreadsheet_id"]
                        and r["worksheet_id"] == op["worksheet_id"] and r["row_id"] == op["row_id"]), None)
            if row is not None:
                row["cells"].update(op["cells"])
        else:
            raise ValueError(f"unsupported delta op {op['op']!r}")
    w["meta"]["current_time"] = at
    with bridge().SHIM.active():
        return WorldState(**w).model_dump(mode="json")


trigger_seed = _abr_host.make_trigger_seed(gen.FAMILY)


def run_stream(stream: dict, solver, mode: str = "carry", ref_befores: list | None = None, grader=None,
               keep_worlds: bool = False) -> dict:
    """Run one generated stream (gen.generate output) with a solver. Returns rows and, optionally, the worlds."""
    b = bridge()
    from automationbench.schema.world import WorldState
    grader = grader or oracle.Grader()
    seed = stream["meta"]["seed"]
    row = gen.serve_input(seed, stream["triggers"][0])
    r = b.Rollout(row, MAX_STEPS, stream["world0"], 0)
    asyncio.run(r.setup())
    world = stream["world0"]
    rows, befores, afters = [], [], []
    for trig, truth in zip(stream["triggers"], stream["truth"]):
        assert trig["trigger"] == truth["trigger"]
        if mode == "rebased":
            before = ref_befores[trig["index"] - 1]
        else:
            before = apply_delta(world, trig["delta"], trig["at"])
        with b.SHIM.active():
            r.state["world"] = WorldState(**before)
        at = datetime.fromisoformat(trig["at"].replace("Z", "+00:00"))
        b.SHIM.reset(trigger_seed(seed, trig["trigger"]), at)
        r.steps, r.log = 0, []
        ctx = Ctx(r, trig["payload"])
        err = None
        t0 = time.time()
        try:
            solver(json.loads(json.dumps(trig["payload"])), ctx)
        except Exception as e:  # noqa: BLE001  (a crashing solver is a failed trigger, never a crashed stream)
            err = f"{type(e).__name__}: {e}"
            if os.environ.get("ABR_DEBUG"):
                traceback.print_exc()
        ms = int((time.time() - t0) * 1000)
        after = r.world()
        last = trig is stream["triggers"][-1]
        v = grader.grade(truth, before, after, end=stream["end"] if last else None,
                         world0=stream["world0"] if last else None)
        rows.append({"taskKey": f"s{seed}/t{trig['index']:02d}", "stream": seed, "trigger": trig["index"],
                     "kind": trig["kind"], "sub": trig["sub"], "difficulty": stream["meta"]["difficulty"],
                     "pass": v["pass"], "pass_core": v["pass_core"], "outcome": v["outcome"], "score": v["score"],
                     "expected": v["expected"], "steps": ctx.steps, "ms": ms, "costUsd": 0.0, "error": err,
                     "traps": trig["traps"], "failed": v["failed"]})
        if keep_worlds:
            befores.append(before)
            afters.append(after)
        world = after
    out = {"seed": seed, "difficulty": stream["meta"]["difficulty"], "rows": rows,
           "clean_week": all(x["pass"] for x in rows),
           "first_failure": next((x["trigger"] for x in rows if not x["pass"]), None)}
    if keep_worlds:
        out["befores"], out["afters"] = befores, afters
    return out


def parse_seeds(s: str) -> list[int]:
    out = []
    for part in s.split(","):
        if "-" in part:
            a, z = part.split("-")
            out += list(range(int(a), int(z) + 1))
        elif part:
            out.append(int(part))
    if any(not 601 <= x <= 650 for x in out):
        raise SystemExit("this harness runs practice and dev seeds 601-650 only; held-out seeds run only under a preregistration")
    return out


def summarize(results: list[dict]) -> dict:
    rows = [x for res in results for x in res["rows"]]
    outcomes = {}
    for x in rows:
        outcomes[x["outcome"]] = outcomes.get(x["outcome"], 0) + 1
    by_kind = {}
    for x in rows:
        v = by_kind.setdefault(x["kind"], [0, 0])
        v[0] += x["pass"]
        v[1] += 1
    trapped = [x for x in rows if x["traps"]]
    return {"triggers": len(rows), "passed": sum(x["pass"] for x in rows),
            "pass_rate": round(sum(x["pass"] for x in rows) / max(1, len(rows)), 4),
            "pass_core_rate": round(sum(x["pass_core"] for x in rows) / max(1, len(rows)), 4),
            "trapped_pass_rate": round(sum(x["pass"] for x in trapped) / max(1, len(trapped)), 4),
            "clean_weeks": sum(res["clean_week"] for res in results), "streams": len(results),
            "outcomes": dict(sorted(outcomes.items())), "by_kind": {k: f"{a}/{n}" for k, (a, n) in sorted(by_kind.items())},
            "errors": sum(1 for x in rows if x["error"]), "max_steps": max((x["steps"] for x in rows), default=0),
            "per_stream": {res["seed"]: f"{sum(x['pass'] for x in res['rows'])}/{len(res['rows'])} ({res['difficulty']})"
                           for res in results}}


_REF_BEFORES: dict[int, tuple] = {}


def reference_befores(stream: dict, grader=None) -> list:
    """The reference run's world_before per trigger (the rebased worlds), cached per stream object."""
    hit = _REF_BEFORES.get(id(stream))
    if hit is None or hit[0] is not stream:
        import reference
        res = run_stream(stream, reference.handle, grader=grader, keep_worlds=True)
        if not res["clean_week"]:
            raise RuntimeError(f"the reference fails stream {stream['meta']['seed']}: no rebased worlds")
        hit = _REF_BEFORES[id(stream)] = (stream, res["befores"])
    return hit[1]


def summarize_both(carry: list[dict], rebased: list[dict]) -> dict:
    """Headline numbers: per-trigger from rebased, clean weeks from carry; carry per-trigger beside them."""
    c, r = summarize(carry), summarize(rebased)
    inherited = sum(1 for rc, rr in zip(carry, rebased) for xc, xr in zip(rc["rows"], rr["rows"])
                    if not xc["pass"] and xr["pass"])
    return {"triggers": r["triggers"], "passed": r["passed"], "pass_rate": r["pass_rate"],
            "pass_core_rate": r["pass_core_rate"], "trapped_pass_rate": r["trapped_pass_rate"],
            "clean_weeks": c["clean_weeks"], "streams": c["streams"],
            "passed_carry": c["passed"], "pass_rate_carry": c["pass_rate"], "inherited": inherited,
            "outcomes": r["outcomes"], "outcomes_carry": c["outcomes"], "by_kind": r["by_kind"],
            "errors": r["errors"] + c["errors"], "max_steps": max(r["max_steps"], c["max_steps"]),
            "per_stream": {s: f"{r['per_stream'][s]} rebased; {c['per_stream'][s]} carry" for s in r["per_stream"]}}


def run(solver_name: str, seeds: list[int], mode: str = "carry", difficulty: str | None = None,
        streams: dict | None = None) -> tuple[dict, list]:
    """mode carry | rebased: (summary, per-stream results). mode both: (summarize_both, carry results + rebased
    results), the carry results first."""
    solver = load_solver(solver_name)
    grader = oracle.Grader()
    carry, rebased = [], []
    for s in seeds:
        stream = (streams or {}).get(s) or gen.generate(s, difficulty)
        if mode in ("carry", "both"):
            carry.append(run_stream(stream, solver, "carry", None, grader))
        if mode in ("rebased", "both"):
            rebased.append(run_stream(stream, solver, "rebased", reference_befores(stream, grader), grader))
    if mode == "both":
        return summarize_both(carry, rebased), carry + rebased
    results = carry or rebased
    return summarize(results), results


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-ops-mailroom stream harness ($0)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("run")
    s.add_argument("--solver", default="reference")
    s.add_argument("--seeds", default="610-614")
    s.add_argument("--mode", choices=["both", "carry", "rebased"], default="both",
                   help="both (default): per-trigger rate from rebased, clean weeks from carry")
    s.add_argument("--difficulty", choices=["d1", "d2", "d3"])
    s.add_argument("--out", help="host-only directory for results.jsonl and summary.json")
    s.add_argument("--failures", action="store_true", help="print failed checks")
    a = ap.parse_args(argv)
    summary, results = run(a.solver, parse_seeds(a.seeds), a.mode, a.difficulty)
    summary = {"family": gen.FAMILY, "version": gen.VERSION, "solver": a.solver, "mode": a.mode, **summary}
    if a.out:
        d = Path(a.out)
        d.mkdir(parents=True, exist_ok=True)
        n = len(results) // 2 if a.mode == "both" else 0
        with open(d / "results.jsonl", "w") as f:
            for i, res in enumerate(results):
                mode = a.mode if a.mode != "both" else ("carry" if i < n else "rebased")
                for x in res["rows"]:
                    f.write(json.dumps({k: v for k, v in x.items() if k != "failed"} | {"mode": mode, "failedChecks": [c["name"] for c in x["failed"]]}) + "\n")
        (d / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    if a.failures:
        n = len(results) // 2 if a.mode == "both" else 0
        for i, res in enumerate(results):
            mode = a.mode if a.mode != "both" else ("carry" if i < n else "rebased")
            for x in res["rows"]:
                if not x["pass"]:
                    print(f"[{mode}] {x['taskKey']} {x['kind']}/{x['sub']} {x['outcome']} err={x['error']}")
                    for c in x["failed"]:
                        print(f"   - {c['name']}: {c['detail']}")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
