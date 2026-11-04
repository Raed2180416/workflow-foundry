#!/usr/bin/env python3
"""Frozen public-holiday tables for factory family specs, from `holidays` 0.107 (MIT) in the D16 factory venv:

    /var/tmp/foundry-work/benches/factory/venv/bin/python -I experiments/autobench/abr/tools/holiday_table.py OUT.json

Tables (2026-2028): DE (nationwide only, no subdivision), GB-ENG (England), US (federal). The specs carry these dates,
so streams never depend on an installed package; tests/golden re-derive and compare when the venv is present.
"""
import json
import sys

import holidays

YEARS = (2026, 2027, 2028)
TABLES = {
    "DE": lambda: holidays.Germany(years=YEARS),
    "GB-ENG": lambda: holidays.UnitedKingdom(subdiv="ENG", years=YEARS),
    "US": lambda: holidays.US(years=YEARS),
}


def tables():
    return {k: {d.isoformat(): n for d, n in sorted(f().items())} for k, f in TABLES.items()}


if __name__ == "__main__":
    out = {"source": f"holidays {holidays.__version__} (MIT), years {list(YEARS)}", "tables": tables()}
    text = json.dumps(out, indent=1, ensure_ascii=False) + "\n"
    if len(sys.argv) > 1:
        open(sys.argv[1], "w").write(text)
    print(text[:600])
