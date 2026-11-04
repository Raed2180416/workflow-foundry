#!/usr/bin/env python3
"""B0 (PLAN §6.4): replace definitions the AB-R families carried as byte-identical copies with the shared ones in
experiments/autobench/abr/lib. Mechanical and conservative: a family definition is replaced only when its source text
equals the reference copy (or, for Ctx, one of the two recorded variants); everything else is left as it was.

    python3 -I experiments/autobench/abr/tools/b0_extract.py [--write] [--report OUT.json]

Falsifier (PLAN §6.4 B0): every family's gate JSON identical before and after (see abr/lib/README.md for the run).
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import sys
from pathlib import Path

AB = Path(__file__).resolve().parents[2]
FAM = AB / "families"
LIB = AB / "abr" / "lib"

BOOT = ("import sys as _b0_sys  # B0: experiments/autobench on the path for the shared abr.lib\n"
        "from pathlib import Path as _B0Path\n"
        "if str(_B0Path(__file__).resolve().parents[2]) not in _b0_sys.path:\n"
        "    _b0_sys.path.append(str(_B0Path(__file__).resolve().parents[2]))\n"
        "from abr.lib import common as _abr_common  # noqa: E402\n"
        "from abr.lib import host as _abr_host  # noqa: E402\n")

# (file, name) -> (replacement, reference family whose copy defines "identical", lib module.name or None for factories)
TARGETS = {
    ("harness.py", "bridge"): ("bridge = _abr_host.bridge", "abr-fin-apintake", "host.bridge"),
    ("harness.py", "StepBudgetExceeded"): ("StepBudgetExceeded = _abr_host.StepBudgetExceeded", "abr-fin-apintake", "host.StepBudgetExceeded"),
    ("harness.py", "Ctx"): ("Ctx = _abr_host.Ctx", "abr-fin-apintake", None),
    ("harness.py", "load_solver"): ("load_solver = _abr_host.load_solver", "abr-fin-apintake", "host.load_solver"),
    ("harness.py", "trigger_seed"): ("trigger_seed = _abr_host.make_trigger_seed(gen.FAMILY)", "abr-fin-apintake", None),
    ("gen.py", "canon"): ("canon = _abr_common.canon", "abr-fin-apintake", "common.canon"),
    ("gen.py", "sha"): ("sha = _abr_common.sha", "abr-fin-apintake", "common.sha"),
    ("gen.py", "iso_z"): ("iso_z = _abr_common.iso_z", "abr-fin-apintake", "common.iso_z"),
    ("gen.py", "ms"): ("ms = _abr_common.ms", "abr-fin-apintake", "common.ms"),
    ("gen.py", "PlanError"): ("PlanError = _abr_common.PlanError", "abr-fin-apintake", "common.PlanError"),
    ("gates.py", "stream_hashes"): ("stream_hashes = _abr_common.make_stream_hashes(gen.sha)", "abr-fin-apintake", None),
    ("gates.py", "_chan"): ("_chan = _abr_common._chan", "abr-fin-apintake", "common._chan"),
    ("oracle.py", "_chan_id"): ("_chan_id = _abr_common._chan_id", "abr-fin-apintake", "common._chan_id"),
    ("oracle.py", "canon"): ("canon = _abr_common.canon", "abr-fin-apintake", "common.canon"),
    ("oracle.py", "is_sent"): ("is_sent = _abr_common.is_sent", "abr-fin-apintake", "common.is_sent"),
    ("oracle.py", "body_of"): ("body_of = _abr_common.body_of", "abr-fin-apintake", "common.body_of"),
    ("lib.py", "canon"): ("canon = _abr_common.canon", "abr-mkt-reviews", "common.canon"),
}
CTX_VARIANT_FAMILY = "abr-ops-slawatch"   # the superset copy (calls + fetch_many) that host.Ctx reproduces


def defs(src: str) -> dict:
    tree = ast.parse(src)
    out = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)):
            out[node.name] = (ast.get_source_segment(src, node), node.lineno, node.end_lineno)
    return out


def lib_text(ref: str) -> str:
    mod, name = ref.split(".")
    return defs((LIB / f"{mod}.py").read_text())[name][0]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    texts = {}
    for f in sorted(FAM.glob("abr-*/*.py")):
        texts[f] = f.read_text()
    canon_text = {}
    for (fname, name), (_, ref_fam, libref) in TARGETS.items():
        t = defs(texts[FAM / ref_fam / fname])[name][0]
        canon_text[(fname, name)] = {t}
        if libref and lib_text(libref) != t:
            raise SystemExit(f"abr/lib {libref} differs from {ref_fam}/{fname}:{name}; refusing")
    canon_text[("harness.py", "Ctx")].add(defs(texts[FAM / CTX_VARIANT_FAMILY / "harness.py"])["Ctx"][0])
    if defs((LIB / "host.py").read_text())["Ctx"][0] not in canon_text[("harness.py", "Ctx")]:
        raise SystemExit("host.Ctx is not one of the recorded variants; refusing")
    report = {"replaced": {}, "kept_variant": {}, "lines_removed": 0}
    for f, src in texts.items():
        d = defs(src)
        hits = []
        for (fname, name), (repl, _, _) in TARGETS.items():
            if f.name != fname or name not in d:
                continue
            text, lo, hi = d[name]
            if text in canon_text[(fname, name)]:
                hits.append((lo, hi, repl, name))
            else:
                report["kept_variant"].setdefault(f.parent.name, []).append(f"{fname}:{name}")
        if not hits:
            continue
        lines = src.splitlines(keepends=True)
        hits.sort()
        first = hits[0][0]
        for lo, hi, repl, name in reversed(hits):
            lines[lo - 1:hi] = [repl + "\n"]
            report["lines_removed"] += (hi - lo + 1) - 1
        boot_at = first - 1
        lines[boot_at:boot_at] = [BOOT, "\n\n"]
        report["lines_removed"] -= BOOT.count("\n") + 2
        report["replaced"].setdefault(f.parent.name, []).extend(f"{f.name}:{h[3]}" for h in hits)
        new = "".join(lines)
        ast.parse(new)
        if a.write:
            f.write_text(new)
    report["sha256_of_targets"] = hashlib.sha256(json.dumps(sorted(map(list, TARGETS)), sort_keys=True).encode()).hexdigest()
    if a.report:
        Path(a.report).write_text(json.dumps(report, indent=1, sort_keys=True) + "\n")
    print(json.dumps({k: (v if k != "replaced" else {f: len(x) for f, x in v.items()}) for k, v in report.items()}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
