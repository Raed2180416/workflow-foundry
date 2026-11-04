#!/usr/bin/env python3
"""Host-side steps for experiments/breadth/factory/run.mjs (one JSON command per call, AutomationBench venv for `before`
validation and `grade --ab`). Truth, deltas and grades stay in --host (outside the arm's sandbox); the arm only ever
receives the serve-input row (policy or intake text + payload) and the tools.

  init    --family F --seed S --host DIR [--sealed-from DIR]   generate (dev) or load (sealed, host-only copy) a stream
  before  --host DIR --k K --world W.json --out DIR             apply trigger K's delta to W -> world_t.json + input.json
  grade   --host DIR --k K --before B.json --after A.json [--ab] verdict for trigger K (+ end checks at the last trigger)
  solve   --host DIR --k K --world W.json --solver PATH[:fn] --out A.json [--mode fast|ab]   a code solver on one trigger
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(ROOT / "experiments" / "autobench"))

from abr.lib.factory import harness as H  # noqa: E402
from abr.lib.factory import intake  # noqa: E402
from abr.lib.factory.oracle import ABCheck, Grader  # noqa: E402
from abr.lib.factory.world import apply_delta  # noqa: E402


def canon(x):
    return json.dumps(x, sort_keys=True, separators=(",", ":"), default=str)


def load_host(host: Path):
    meta = json.loads((host / "meta.json").read_text())
    trig = [json.loads(line) for line in (host / "triggers.jsonl").read_text().splitlines()]
    truth = [json.loads(line) for line in (host / "truth.jsonl").read_text().splitlines()]
    return meta, trig, truth


def cmd_init(a):
    host = Path(a.host)
    host.mkdir(parents=True, exist_ok=True)
    if a.sealed_from:
        src = Path(a.sealed_from)
        for f in ("world0.json", "end.json", "meta.json", "triggers.jsonl", "truth.jsonl", "intake.json"):
            if (src / f).exists():
                (host / f).write_text((src / f).read_text())
        meta = json.loads((host / "meta.json").read_text())
    else:
        fam = H.Family(a.family)
        st = fam.generate(a.seed)
        for k in ("world0", "end", "meta"):
            (host / f"{k}.json").write_text(canon(st[k]) + "\n")
        for k in ("triggers", "truth"):
            (host / f"{k}.jsonl").write_text("".join(canon(x) + "\n" for x in st[k]))
        if a.intake == "messy":
            (host / "intake.json").write_text(canon(intake.render(a.family, a.seed)) + "\n")
        meta = st["meta"]
    print(json.dumps({"triggers": meta["triggers"], "family": meta["family"], "seed": meta["seed"],
                      "weeks": sorted({t["week"] for t in load_host(host)[1]})}))


def cmd_before(a):
    meta, trig, _ = load_host(Path(a.host))
    t = trig[a.k]
    world = json.loads(Path(a.world).read_text())
    before = apply_delta(world, t["delta"], t["at"])
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "world_t.json").write_text(canon(before))
    fam = H.Family(meta["family"])
    it = Path(a.host) / "intake.json"
    text = json.loads(it.read_text())["text"] if it.exists() else None
    row = fam.model.serve_input(meta["seed"], t, intake="messy" if text else "policy", intake_text=text)
    (out / "input.json").write_text(json.dumps(row))
    print(json.dumps({"k": a.k, "trigger": t["trigger"], "at": t["at"], "kind": t["kind"], "week": t["week"]}))


def cmd_grade(a):
    meta, trig, truth = load_host(Path(a.host))
    fam = H.Family(meta["family"])
    before, after = json.loads(Path(a.before).read_text()), json.loads(Path(a.after).read_text())
    if set(before) != set(after):                 # the app path dumps every app: normalise both sides the same way
        from automationbench.schema.world import WorldState
        before, after = (WorldState(**w).model_dump(mode="json") for w in (before, after))
    last = a.k == len(trig) - 1
    end = json.loads((Path(a.host) / "end.json").read_text()) if last else None
    v = Grader(fam.spec).grade(truth[a.k], before, after, end=end)
    abd = ABCheck().failures(after, truth[a.k]) if a.ab and v["pass"] else []
    print(json.dumps({"k": a.k, "trigger": trig[a.k]["trigger"], "week": trig[a.k]["week"], "pass": v["pass"],
                      "pass_core": v["pass_core"], "outcome": v["outcome"], "hard_violations": v["hard_violations"],
                      "matched": v["matched"], "missed": v["missed"], "spurious": v["spurious"], "ab_disagree": len(abd),
                      "failedChecks": [c["name"] for c in v["failed"]][:12]}))


def cmd_solve(a):
    import copy
    from abr.lib.factory import store as S
    meta, trig, _ = load_host(Path(a.host))
    fam = H.Family(meta["family"])
    t = trig[a.k]
    world = json.loads(Path(a.world).read_text())
    solver = fam.solver(a.solver)
    err = None
    if a.mode == "fast":
        ctx = S.FastCtx(copy.deepcopy(world), t["at"], H.trigger_seed(fam.name, meta["seed"], t["trigger"]))
        try:
            solver(copy.deepcopy(t["payload"]), ctx)
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"[:300]
        after = ctx.store.world
    else:
        stream = {"meta": meta, "world0": world, "triggers": [t]}
        host = H.ABHost(fam, stream)
        after, _, err = host.run(world, t["at"], H.trigger_seed(fam.name, meta["seed"], t["trigger"]), solver, t["payload"])
    Path(a.out).write_text(canon(after))
    print(json.dumps({"k": a.k, "error": err}))


def cmd_catalog(a):
    """The api toolset definitions as the env hands them to a client, for one serve-input row (AutomationBench venv)."""
    import asyncio
    from abr.lib import host
    b = host.bridge()
    row = json.loads(Path(a.out).read_text()) if a.out and Path(a.out).exists() else None
    r = b.Rollout(row, host.MAX_STEPS, json.loads(Path(a.world).read_text()) if a.world else None, 0)
    asyncio.run(r.setup())
    print(json.dumps(r.catalog()))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["init", "before", "grade", "solve", "catalog"])
    ap.add_argument("--family")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--intake", default="policy")
    ap.add_argument("--host")
    ap.add_argument("--sealed-from")
    ap.add_argument("--k", type=int)
    ap.add_argument("--world")
    ap.add_argument("--before")
    ap.add_argument("--after")
    ap.add_argument("--out")
    ap.add_argument("--solver")
    ap.add_argument("--mode", default="fast")
    ap.add_argument("--ab", action="store_true")
    a = ap.parse_args(argv)
    {"init": cmd_init, "before": cmd_before, "grade": cmd_grade, "solve": cmd_solve, "catalog": cmd_catalog}[a.cmd](a)


if __name__ == "__main__":
    main()
