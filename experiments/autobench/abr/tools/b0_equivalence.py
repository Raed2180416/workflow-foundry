#!/usr/bin/env python3
"""B0 targeted equivalence ($0, AutomationBench venv): for every AB-R family, run the same probe in a fresh interpreter
against two copies of experiments/autobench (before and after the extraction) and compare digests:

  gen      sha256 of the canonical generator output for practice seed 601 (world validated by WorldState): exercises
           every extracted generator helper (canon, sha, iso_z, ms, PlanError) and the meta hashes;
  hashes   gates.stream_hashes on that output (where the family has gates.py);
  seeds    harness.trigger_seed for the first 10 triggers;
  solvers  the names load_solver resolves for 'reference' and every control.
  oracle   _chan_id / canon / is_sent / body_of applied to world0 and its messages (where defined).

This is not the plan's falsifier (every family's full gate JSON before and after, about a CPU-hour per family and copy,
which the shared machine could not give this session); it checks every replaced definition on real inputs.

    <AutomationBench venv python> -I -B b0_equivalence.py BEFORE_AUTOBENCH AFTER_AUTOBENCH [--out OUT.json]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

PROBE = r'''
import sys, json, hashlib, inspect
fam, ab = sys.argv[1], sys.argv[2]
sys.path[:0] = [f"{ab}/families/{fam}", ab]
import gen, harness
out = {}
g = gen.generate(601)
canon = lambda x: json.dumps(x, sort_keys=True, separators=(",", ":"), default=str)
out["gen"] = hashlib.sha256(canon({k: v for k, v in g.items() if k != "meta"}).encode()).hexdigest()
out["meta"] = hashlib.sha256(canon(g.get("meta")).encode()).hexdigest()
try:
    import gates
    if hasattr(gates, "stream_hashes"):
        out["hashes"] = gates.stream_hashes(g)
except Exception as e:
    out["hashes"] = f"error {type(e).__name__}"
if hasattr(harness, "trigger_seed"):
    out["seeds"] = [harness.trigger_seed(601, t["trigger"]) for t in g["triggers"][:10]]
if hasattr(harness, "load_solver"):
    import controls
    names = ["reference"] + sorted(getattr(controls, "CONTROLS", {}))
    out["solvers"] = {n: getattr(harness.load_solver(n), "__qualname__", repr(harness.load_solver(n))) for n in names}
import oracle
w0 = g["world0"]
probe = {}
for name in ("_chan_id", "canon", "is_sent", "body_of"):
    f = getattr(oracle, name, None)
    if f is None:
        continue
    if name == "_chan_id":
        probe[name] = [f(w0, c.get("name")) for c in w0.get("slack", {}).get("channels", [])]
    elif name == "canon":
        probe[name] = hashlib.sha256(f(w0).encode()).hexdigest()
    else:
        probe[name] = [f(m) for m in w0.get("gmail", {}).get("messages", [])]
out["oracle"] = hashlib.sha256(canon(probe).encode()).hexdigest()
print(json.dumps(out))
'''


def run(fam: str, ab: str) -> dict:
    p = subprocess.run([sys.executable, "-I", "-B", "-c", PROBE, fam, ab], capture_output=True, text=True, cwd="/tmp")
    if p.returncode:
        return {"error": p.stderr.strip().splitlines()[-1][:300] if p.stderr.strip() else f"rc {p.returncode}"}
    return json.loads(p.stdout.strip().splitlines()[-1])


def main():
    before, after = sys.argv[1], sys.argv[2]
    out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
    fams = sorted(p.name for p in Path(after, "families").glob("abr-*") if (Path(before, "families", p.name)).exists())
    res = {}
    for f in fams:
        b, a = run(f, before), run(f, after)
        res[f] = {"identical": b == a and "error" not in b, "checked": sorted(k for k in a if k != "error"),
                  **({"before": b, "after": a} if b != a or "error" in b else {})}
        print(f, res[f]["identical"], res[f]["checked"], flush=True)
    doc = {"families": len(fams), "identical": sum(r["identical"] for r in res.values()), "results": res}
    if out_path:
        Path(out_path).write_text(json.dumps(doc, indent=1) + "\n")
    print(json.dumps({k: doc[k] for k in ("families", "identical")}))


if __name__ == "__main__":
    main()
