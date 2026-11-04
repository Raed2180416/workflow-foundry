#!/usr/bin/env python3
"""Golden and property tests for the factory clock engine (abr/lib/factory/clock.py) and the reg-incident-clock
reference's own calendar arithmetic (N-version). Golden cases are the spec's public-rule-text examples; properties run
with Hypothesis 6.170.5 when it is importable (the D16 factory venv), and are skipped otherwise.

    /var/tmp/foundry-work/benches/factory/venv/bin/python -I experiments/breadth/factory/test/clock_props.py
Prints one JSON line {golden, properties, holidays}; exit 0 only when everything ran passes.
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
AB = ROOT / "experiments" / "autobench"
sys.path.append(str(AB))
sys.path.append(str(AB / "families" / "abr-reg-incident-clock"))

from abr.lib.factory import clock as C  # noqa: E402

UTC = timezone.utc
HOL = json.loads((AB / "abr/lib/factory/holidays.json").read_text())["tables"]


def golden_reg() -> list[str]:
    spec = json.loads((AB / "families/abr-reg-incident-clock/family.spec.json").read_text())
    import reference as R  # the reference's own arithmetic, not the clock engine
    fails = []
    for g in spec["golden"]:
        i, want = g["input"], g["expect"]
        if "months" in i:
            got = C.add_months_clipped(date.fromisoformat(i["from"]), i["months"]).isoformat()
        elif "day" in i:
            got = C.roll_forward(date.fromisoformat(i["day"]), frozenset(HOL[i["holidays"]])).isoformat()
        elif "aware" in i:
            got = C.iso_z(C.parse_instant(i["aware"]) + timedelta(hours=i["hours"]))
            ref = R.z(R.when(i["aware"]) + timedelta(hours=i["hours"]))
            if ref != want:
                fails.append(f"{g['id']}: reference {ref} != {want}")
        else:
            notified = C.parse_instant(i["notified"])
            d = C.roll_forward(C.add_months_clipped(notified.astimezone(C.ZoneInfo(i["tz"])).date(), 1), frozenset(HOL[i["holidays"]]))
            got = C.iso_z(C.end_of_local_day(d, i["tz"]))
            ref = R.z(R.Ref.final_due(type("X", (), {"flags": set(), "working": R.Ref.working})(), notified, set(HOL[i["holidays"]])))
            if ref != want:
                fails.append(f"{g['id']}: reference {ref} != {want}")
        if got != want:
            fails.append(f"{g['id']}: clock engine {got} != {want}")
    return fails


def golden_p2p() -> list[str]:
    from decimal import ROUND_HALF_UP, Decimal
    spec = json.loads((AB / "families/abr-p2p-audit/family.spec.json").read_text())
    fails = []
    for g in spec["golden"]:
        i = g["input"]
        if "po" in i:
            lim_engine = (int(Decimal(i["po"]) * 100) * (100 + i["tol"]) + 50) // 100              # model.py's integer rule
            lim_ref = (Decimal(i["po"]) * (100 + i["tol"]) / 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)  # reference's
            got_e = "PRICE" if int(Decimal(i["invoice"]) * 100) > lim_engine else "pass"
            got_r = "PRICE" if Decimal(i["invoice"]) > lim_ref else "pass"
            if not got_e == got_r == g["expect"]:
                fails.append(f"{g['id']}: engine {got_e}, reference {got_r}, want {g['expect']}")
        else:
            got = "QTY" if i["invoice"] + i["approved"] > i["received"] else "pass"
            if got != g["expect"]:
                fails.append(f"{g['id']}: {got} != {g['expect']}")
    return fails


def golden_itsm() -> list[str]:
    sys.path.insert(0, str(AB / "families/abr-itsm-queue"))
    import importlib.util
    spec_ = importlib.util.spec_from_file_location("itsm_ref", AB / "families/abr-itsm-queue/reference.py")
    ref = importlib.util.module_from_spec(spec_)
    spec_.loader.exec_module(ref)
    spec = json.loads((AB / "families/abr-itsm-queue/family.spec.json").read_text())
    fails = []
    for g in spec["golden"]:
        i = g["input"]
        if "impact" in i:
            s = ref.level(i["impact"]) + ref.level(i["urgency"])
            got = {2: "P1", 3: "P2", 4: "P3"}.get(s, "P4")
        elif "due" in i:
            got = ref.z(ref.when(i["due"]) + (ref.when(i["resumed"]) - ref.when(i["paused"])))
        else:
            got = g["expect"]          # mined thresholds: checked against the params file in factory.test.mjs
        if got != g["expect"]:
            fails.append(f"{g['id']}: {got} != {g['expect']}")
    return fails


def properties() -> dict:
    try:
        from hypothesis import given, settings
        from hypothesis import strategies as st
    except ImportError:
        return {"ran": False, "why": "hypothesis not importable (run with the D16 factory venv)"}
    out = {"ran": True, "failures": []}
    days = st.dates(min_value=date(2026, 1, 1), max_value=date(2028, 11, 30))
    hol = frozenset(HOL["DE"])

    @settings(max_examples=400, deadline=None, derandomize=True)
    @given(days, st.integers(min_value=1, max_value=12))
    def months_never_overflow(d, n):
        m = C.add_months_clipped(d, n)
        assert (m.year * 12 + m.month) - (d.year * 12 + d.month) == n
        assert m.day == d.day or m.day < d.day and (m + timedelta(days=1)).day == 1

    @settings(max_examples=400, deadline=None, derandomize=True)
    @given(days)
    def roll_is_working_and_minimal(d):
        r = C.roll_forward(d, hol)
        assert C.is_business_day(r, hol) and r >= d
        assert all(not C.is_business_day(d + timedelta(days=k), hol) for k in range((r - d).days))

    @settings(max_examples=400, deadline=None, derandomize=True)
    @given(days)
    def end_of_day_is_next_local_midnight(d):
        e = C.end_of_local_day(d, "Europe/Berlin").astimezone(C.ZoneInfo("Europe/Berlin"))
        assert (e.hour, e.minute) == (0, 0) and e.date() == d + timedelta(days=1)

    @settings(max_examples=400, deadline=None, derandomize=True)
    @given(st.datetimes(min_value=datetime(2026, 1, 1), max_value=datetime(2028, 12, 1), timezones=st.just(UTC)),
           st.sampled_from(["Europe/Berlin", "America/New_York", "Europe/London"]))
    def render_parse_round_trip(t, tz):
        t = t.replace(second=0, microsecond=0)
        assert C.parse_instant(C.render_local(t, tz)) == t

    for f in (months_never_overflow, roll_is_working_and_minimal, end_of_day_is_next_local_midnight, render_parse_round_trip):
        try:
            f()
        except Exception as e:  # noqa: BLE001
            out["failures"].append(f"{f.__name__}: {type(e).__name__}: {str(e)[:200]}")
    return out


def holiday_table() -> dict:
    try:
        import holidays
    except ImportError:
        return {"ran": False, "why": "holidays not importable (run with the D16 factory venv)"}
    sys.path.append(str(AB / "abr/tools"))
    import holiday_table as T
    same = T.tables() == HOL
    return {"ran": True, "version": holidays.__version__, "frozen_table_matches": same}


if __name__ == "__main__":
    gold = golden_reg() + golden_p2p() + golden_itsm()
    props = properties()
    hol = holiday_table()
    ok = not gold and not props.get("failures") and hol.get("frozen_table_matches", True)
    print(json.dumps({"golden_failures": gold, "properties": props, "holidays": hol, "pass": ok}))
    sys.exit(0 if ok else 1)
