#!/usr/bin/env python3
"""Frozen node-V split (PLAN §6.4-6.6, OD-10): which family each sealed seed belongs to and which sealed streams start
from a messy request. Decided by a hash rule over the seed numbers and a salt fixed before any generation or model run
(the repository HEAD at registration, 78f90d08...). Content never enters the rule, so the rule cannot be steered by
looking at streams.

    python3 -I experiments/breadth/factory/split.py --write research/breadth-20261021/factory/SPLIT.json

Rule (v1): order the 24 seeds 8850-8873 by sha256("factory-v-split-v1|<salt>|<seed>"); positions 0-7 -> abr-itsm-queue,
8-15 -> abr-p2p-audit, 16-23 -> abr-reg-incident-clock. Within each family, the 4 seeds with the smallest
sha256("factory-v-messy-v1|<salt>|<seed>") start from a messy request (12 of 24). Dev streams: any family on seeds
2113-2160; practice 2101-2112 (SEED-LEDGER factory-v-dev). If B4 swaps abr-itsm-queue for abr-erp-dunning, the swap
inherits the itsm seeds unchanged (recorded by dated amendment, never re-hashed).
"""
from __future__ import annotations

import argparse
import hashlib
import json

SALT = "78f90d085a83ef324b4be42b697d6595b8c6e0e4"
FAMILIES = ["abr-itsm-queue", "abr-p2p-audit", "abr-reg-incident-clock"]
SEALED = list(range(8850, 8874))
DEV = list(range(2113, 2161))
PRACTICE = list(range(2101, 2113))


def h(tag: str, seed: int) -> str:
    return hashlib.sha256(f"{tag}|{SALT}|{seed}".encode()).hexdigest()


def assignment() -> dict:
    order = sorted(SEALED, key=lambda s: h("factory-v-split-v1", s))
    out = {}
    for k, fam in enumerate(FAMILIES):
        seeds = sorted(order[8 * k: 8 * k + 8])
        messy = set(sorted(seeds, key=lambda s: h("factory-v-messy-v1", s))[:4])
        out[fam] = [{"seed": s, "intake": "messy" if s in messy else "policy"} for s in seeds]
    return out


def family_of(seed: int) -> str | None:
    for fam, rows in assignment().items():
        if any(r["seed"] == seed for r in rows):
            return fam
    return None


def doc() -> dict:
    return {
        "schema": "factory-v-split/1", "rule": "v1 (experiments/breadth/factory/split.py docstring)", "salt": SALT,
        "salt_is": "repository HEAD at seed registration (2026-11-04), before any V generator existed",
        "ledger": "research/jit-20261008/SEED-LEDGER.json ranges factory-v-dev, factory-v-sealed, factory-heldout",
        "practice": [PRACTICE[0], PRACTICE[-1]], "dev": [DEV[0], DEV[-1]], "sealed": [SEALED[0], SEALED[-1]],
        "sealed_by_family": assignment(),
        "sealed_policy": "generated host-only under /var/tmp/foundry-work/benches/factory/sealed/ (never committed); "
                         "per-stream sha256 in SEALED-HASHES.json; read only by the PREREG-V-1 runner",
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write")
    a = ap.parse_args()
    text = json.dumps(doc(), indent=1) + "\n"
    if a.write:
        open(a.write, "w").write(text)
    print(text if not a.write else hashlib.sha256(text.encode()).hexdigest())
