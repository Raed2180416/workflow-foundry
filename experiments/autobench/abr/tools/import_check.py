#!/usr/bin/env python3
"""Import every AB-R family's modules in a fresh interpreter each (AutomationBench venv) and report failures. $0."""
import json
import subprocess
import sys
from pathlib import Path

AB = Path(__file__).resolve().parents[2]
PY = sys.executable
res = {}
for fam in sorted((AB / "families").glob("abr-*")):
    mods = [m for m in ("harness", "gen", "oracle", "reference", "controls", "gates") if (fam / f"{m}.py").exists()]
    code = ("import sys; sys.path[:0]=[%r, %r]\n" % (str(fam), str(AB))) + "".join(f"import {m}\n" for m in mods)
    if (fam / "harness.py").exists():
        code += "import harness; harness.trigger_seed(601, 't00') if hasattr(harness, 'trigger_seed') else None\n"
    p = subprocess.run([PY, "-I", "-B", "-c", code], capture_output=True, text=True, cwd="/tmp")
    res[fam.name] = "ok" if p.returncode == 0 else p.stderr.strip().splitlines()[-1][:200]
print(json.dumps(res, indent=1))
sys.exit(0 if all(v == "ok" for v in res.values()) else 1)
