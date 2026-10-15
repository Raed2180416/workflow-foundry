#!/usr/bin/env python3
"""abr-ops-slawatch stream harness ($0, no model): generate a stream, run a code solver trigger by trigger through
AutomationBench's own tool path, grade every trigger with the oracle. Runs inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I -B experiments/autobench/families/abr-ops-slawatch/harness.py \
        run --solver reference --seeds 610-614 [--mode carry|rebased] [--difficulty d2] [--out DIR] [--failures]

Tool path. Each trigger's tool calls go through `bridge.Rollout.batch` (experiments/autobench/bridge.py): the official
AutomationBenchEnv.env_response with the `api` toolset (api_search, api_fetch, base64_encode), the code `bridge.py
serve` runs for a model arm, with the determinism shim in seed mode (ids seeded per trigger, clock = the trigger time,
+1 ms per read). That clock is what makes the oracle's timing check meaningful: an SMS, post, email or Jira issue made
while handling a check carries the check's time. The only difference from serve is transport: a code solver calls the
tools in process (ctx.fetch) instead of through the file mailbox, and the world carries over in one process. Model arms
use `bridge.py serve --input <serve-inputs row> --world world_t.json` per trigger (gen.py writes the rows).

Per trigger: apply the trigger's delta (insert/update a tracker row, deliver an email; validated through WorldState),
set meta.current_time to the trigger time, snapshot world_before, run the solver with (payload, ctx), snapshot
world_after, grade. The solver sees the payload and the tools only; the truth, the delta and the generator stay here.

Modes (RECURRING-DESIGN §3.6): carry (headline) - the solver's world evolves with its own effects; rebased
(diagnostic) - before each trigger the world is replaced by the reference run's world at that point.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
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
ALLOWED_SEEDS = range(601, 651)   # practice and dev blocks only; held-out seeds never run from here
_BRIDGE = None


def bridge():
    """Import bridge.py once and install the determinism shim in seed mode (imports all of AutomationBench)."""
    global _BRIDGE
    if _BRIDGE is None:
        import bridge as b
        b.SHIM.install("seed")
        _BRIDGE = b
    return _BRIDGE


class StepBudgetExceeded(RuntimeError):
    pass


class Ctx:
    """What a code solver gets besides the payload: the tools, and nothing else."""

    def __init__(self, rollout, trigger: dict):
        self._r = rollout
        self.trigger = trigger
        self.steps = 0
        self.calls = 0

    def batch(self, calls: list[dict]) -> list[str]:
        """One step: several tool calls in order (as parallel tool calls in one model response). Returns contents."""
        norm = [{"name": c["name"], "arguments": c["arguments"] if isinstance(c["arguments"], str) else json.dumps(c["arguments"])}
                for c in calls]
        out = asyncio.run(self._r.batch(norm))
        if "error" in out:
            raise StepBudgetExceeded(out["error"])
        self.steps += 1
        self.calls += len(calls)
        return [x["content"] for x in out["results"]]

    def call(self, name: str, arguments: dict) -> str:
        return self.batch([{"name": name, "arguments": arguments}])[0]

    @staticmethod
    def fetch_args(method: str, url: str, params=None, body=None) -> dict:
        a = {"method": method, "url": url}
        if params is not None:
            a["params"] = json.dumps(params)
        if body is not None:
            a["body"] = json.dumps(body)
        return a

    def fetch(self, method: str, url: str, params=None, body=None) -> str:
        return self.call("api_fetch", self.fetch_args(method, url, params, body))

    def fetch_json(self, method: str, url: str, params=None, body=None):
        return json.loads(self.fetch(method, url, params, body))

    def fetch_many(self, reqs: list[tuple]) -> list:
        """Several api_fetch calls in ONE step; each req is (method, url[, params[, body]]). Returns parsed JSON."""
        outs = self.batch([{"name": "api_fetch", "arguments": self.fetch_args(*r)} for r in reqs])
        res = []
        for o in outs:
            try:
                res.append(json.loads(o))
            except ValueError:
                res.append({"raw": o})
        return res

    def search(self, query: str, top_k: int = 5) -> str:
        return self.call("api_search", {"query": query, "top_k": top_k})


def load_solver(name: str):
    """'reference', a control name from controls.CONTROLS, or path/to/module.py[:function] (default handle)."""
    if name == "reference":
        import reference
        return reference.handle
    import controls
    if name in controls.CONTROLS:
        return controls.CONTROLS[name]
    path, _, fn = name.partition(":")
    spec = importlib.util.spec_from_file_location("solver_mod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, fn or "handle")


def apply_delta(world: dict, delta: list, at: str) -> dict:
    """Host-only world ops before a trigger fires (a new tracker row, a support-team edit of ticket columns, an inbound
    email), then meta.current_time = trigger time; validated through AutomationBench's WorldState."""
    from automationbench.schema.world import WorldState
    w = copy.deepcopy(world)
    rows = w["google_sheets"]["rows"]
    for op in delta:
        if op["op"] == "insert_row":
            if any(r["id"] == op["id"] for r in rows):
                raise ValueError(f"row {op['id']} already exists")
            ids = [r["row_id"] for r in rows if r["spreadsheet_id"] == op["spreadsheet_id"]
                   and r["worksheet_id"] == op["worksheet_id"] and isinstance(r["row_id"], int)]
            rows.append({"id": op["id"], "spreadsheet_id": op["spreadsheet_id"], "worksheet_id": op["worksheet_id"],
                         "row_id": max(ids, default=1) + 1, "cells": dict(op["cells"])})
        elif op["op"] == "update_row":
            row = next((r for r in rows if r["id"] == op["id"]), None)
            if row is None:       # the arm deleted the row: the support team's edit recreates nothing, loudly
                raise ValueError(f"row {op['id']} to update is missing")
            row["cells"] = dict(row["cells"], **op["cells"])
        elif op["op"] == "add_email":
            w["gmail"]["messages"].append(copy.deepcopy(op["message"]))
        else:
            raise ValueError(f"unsupported delta op {op['op']!r}")
    w["meta"]["current_time"] = at
    with bridge().SHIM.active():
        return WorldState(**w).model_dump(mode="json")


def trigger_seed(seed: int, tid: str) -> int:
    return int(hashlib.sha256(f"{gen.FAMILY}:{seed}:{tid}".encode()).hexdigest()[:12], 16)


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
    last = len(stream["triggers"]) - 1
    for k, (trig, truth) in enumerate(zip(stream["triggers"], stream["truth"])):
        assert trig["trigger"] == truth["trigger"]
        if mode == "rebased":
            before = ref_befores[k]
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
            solver(copy.deepcopy(trig["payload"]), ctx)
        except Exception as e:  # noqa: BLE001  (a crashing solver is a failed trigger, never a crashed stream)
            err = f"{type(e).__name__}: {e}"[:400]
            if os.environ.get("ABR_DEBUG"):
                traceback.print_exc()
        ms = int((time.time() - t0) * 1000)
        after = r.world()
        v = grader.grade(truth, before, after, end=stream["end"] if k == last else None,
                         world0=stream["world0"] if k == last else None)
        rows.append({"taskKey": f"s{seed}/t{trig['index']:02d}", "stream": seed, "trigger": trig["index"],
                     "kind": trig["kind"], "sub": trig["sub"], "difficulty": stream["meta"]["difficulty"],
                     "pass": v["pass"], "pass_core": v["pass_core"], "outcome": v["outcome"], "score": v["score"],
                     "expected": v["expected"], "steps": ctx.steps, "calls": ctx.calls, "ms": ms, "costUsd": 0.0,
                     "error": err, "traps": trig["traps"], "failed": v["failed"]})
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
    for part in str(s).split(","):
        if "-" in part:
            a, z = part.split("-")
            out += list(range(int(a), int(z) + 1))
        elif part:
            out.append(int(part))
    bad = [x for x in out if x not in ALLOWED_SEEDS]
    if bad:
        raise SystemExit(f"seeds {bad} refused: this harness runs practice/dev seeds 601-650 only (held-out stays sealed)")
    return out


def summarize(results: list[dict]) -> dict:
    rows = [x for res in results for x in res["rows"]]
    outcomes, by_kind, by_sub = {}, {}, {}
    for x in rows:
        outcomes[x["outcome"]] = outcomes.get(x["outcome"], 0) + 1
        for key, d in ((x["kind"], by_kind), (f"{x['kind']}/{x['expected']}", by_sub)):
            v = d.setdefault(key, [0, 0])
            v[0] += x["pass"]
            v[1] += 1
    return {"triggers": len(rows), "passed": sum(x["pass"] for x in rows),
            "pass_rate": round(sum(x["pass"] for x in rows) / max(1, len(rows)), 4),
            "pass_core_rate": round(sum(x["pass_core"] for x in rows) / max(1, len(rows)), 4),
            "clean_weeks": sum(res["clean_week"] for res in results), "streams": len(results),
            "outcomes": outcomes, "by_kind": {k: f"{a}/{n}" for k, (a, n) in sorted(by_kind.items())},
            "by_expected": {k: f"{a}/{n}" for k, (a, n) in sorted(by_sub.items())},
            "per_stream": {res["seed"]: f"{sum(x['pass'] for x in res['rows'])}/{len(res['rows'])} ({res['difficulty']})"
                           for res in results}}


def run(solver_name: str, seeds: list[int], mode: str = "carry", difficulty: str | None = None,
        streams: dict | None = None) -> tuple[dict, list]:
    solver = load_solver(solver_name)
    grader = oracle.Grader()
    results = []
    for s in seeds:
        stream = (streams or {}).get(s) or gen.generate(s, difficulty)
        ref_befores = None
        if mode == "rebased":
            import reference
            ref_befores = run_stream(stream, reference.handle, grader=grader, keep_worlds=True)["befores"]
        results.append(run_stream(stream, solver, mode, ref_befores, grader))
    return summarize(results), results


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-ops-slawatch stream harness ($0)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("run")
    s.add_argument("--solver", default="reference")
    s.add_argument("--seeds", default="610-614")
    s.add_argument("--mode", choices=["carry", "rebased"], default="carry")
    s.add_argument("--difficulty", choices=["d1", "d2", "d3"])
    s.add_argument("--out", help="host-only directory for results.jsonl and summary.json")
    s.add_argument("--failures", action="store_true", help="print failed checks")
    a = ap.parse_args(argv)
    summary, results = run(a.solver, parse_seeds(a.seeds), a.mode, a.difficulty)
    summary = {"family": gen.FAMILY, "version": gen.VERSION, "solver": a.solver, "mode": a.mode, **summary}
    if a.out:
        d = Path(a.out)
        d.mkdir(parents=True, exist_ok=True)
        with open(d / "results.jsonl", "w") as f:
            for res in results:
                for x in res["rows"]:
                    f.write(json.dumps({k: v for k, v in x.items() if k != "failed"}
                                       | {"failedChecks": [c["name"] for c in x["failed"]]}) + "\n")
        (d / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    if a.failures:
        for res in results:
            for x in res["rows"]:
                if not x["pass"]:
                    print(f"{x['taskKey']} {x['kind']}/{x['sub']} expected={x['expected']} {x['outcome']} err={x['error']}")
                    for c in x["failed"][:8]:
                        print(f"   - {c['name']}: {str(c['detail'])[:300]}")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
