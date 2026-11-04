#!/usr/bin/env python3
"""Generate node V's 24 sealed streams host-only and record their hashes (never their content).

    python3 -I experiments/breadth/factory/seal.py [--out /var/tmp/foundry-work/benches/factory/sealed] \
        --hashes research/breadth-20261021/factory/SEALED-HASHES.json

Family and intake per seed come from SPLIT.json (split.py). Streams are written under --out (outside the repository,
mode 0600, never committed); this script prints counts and hashes only, so the author never sees a sealed stream. A
messy-intake stream also gets intake.json (the request text rendered from the phrasebank, intake version
v0-prepanel). Re-running with the same generator versions must reproduce every hash (checked with --verify).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AB = ROOT / "experiments" / "autobench"
sys.path.append(str(AB))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import split  # noqa: E402
from abr.lib.factory import intake  # noqa: E402
from abr.lib.factory.harness import Family  # noqa: E402


def canon(x) -> str:
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def write_private(p: Path, text: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(text)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/var/tmp/foundry-work/benches/factory/sealed")
    ap.add_argument("--hashes", default=str(ROOT / "research/breadth-20261021/factory/SEALED-HASHES.json"))
    ap.add_argument("--verify", action="store_true", help="regenerate in memory and compare with --hashes; write nothing")
    a = ap.parse_args(argv)
    rows, fams = [], {}
    for fam_name, seeds in split.assignment().items():
        fam = fams.setdefault(fam_name, Family(fam_name))
        for row in seeds:
            s = row["seed"]
            st = fam.model.generate(s, allow_sealed=True)
            rec = {"family": fam_name, "seed": s, "intake": row["intake"], "generator": fam.model.VERSION,
                   "triggers": st["meta"]["triggers"], "sha256": st["meta"]["sha256"],
                   "stream_sha256": hashlib.sha256(canon({k: st[k] for k in ("world0", "triggers", "truth", "end")}).encode()).hexdigest()}
            if row["intake"] == "messy":
                it = intake.render(fam_name, s)
                rec["intake_version"], rec["intake_sha256"] = it["intake_version"], it["sha256"]
            rows.append(rec)
            if not a.verify:
                d = Path(a.out) / fam_name / str(s)
                for k in ("world0", "end", "meta"):
                    write_private(d / f"{k}.json", canon(st[k]) + "\n")
                for k in ("triggers", "truth"):
                    write_private(d / f"{k}.jsonl", "".join(canon(x) + "\n" for x in st[k]))
                write_private(d / "injections.json", canon(st.get("injections", [])) + "\n")
                if row["intake"] == "messy":
                    write_private(d / "intake.json", canon(it) + "\n")
    doc = {"schema": "factory-v-sealed/1", "split": "research/breadth-20261021/factory/SPLIT.json",
           "location": "host-only, " + a.out + " (mode 0600; never committed; read only by the PREREG-V-1 runner)",
           "streams": rows,
           "summary": {f: {"streams": sum(1 for r in rows if r["family"] == f), "messy": sum(1 for r in rows if r["family"] == f and r["intake"] == "messy"),
                           "triggers": sum(r["triggers"] for r in rows if r["family"] == f)} for f in fams}}
    if a.verify:
        old = json.loads(Path(a.hashes).read_text())
        same = [r["stream_sha256"] for r in old["streams"]] == [r["stream_sha256"] for r in rows]
        print(json.dumps({"verify": same}))
        sys.exit(0 if same else 1)
    text = json.dumps(doc, indent=1) + "\n"
    Path(a.hashes).write_text(text)
    print(json.dumps({"written": len(rows), "summary": doc["summary"], "sha256_of_hash_file": hashlib.sha256(text.encode()).hexdigest()}))


if __name__ == "__main__":
    main()
