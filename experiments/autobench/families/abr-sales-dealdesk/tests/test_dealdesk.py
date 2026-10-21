"""Tests for abr-sales-dealdesk ($0: no model is called anywhere).

Run inside AutomationBench's own venv (pinned by its uv.lock), from the repository root:

    corpus/AutomationBench/.venv/bin/python -I -m pytest -p no:cacheprovider -q \
        experiments/autobench/families/abr-sales-dealdesk/tests

Dev seeds 610-614 (610 d2, 611 d3, 612 d2, 613 d3, 614 d2). Held-out seeds are never generated here.
"""
from __future__ import annotations

import ast
import copy
import hashlib
import json
import re
import sys
from collections import Counter
from decimal import Decimal
from pathlib import Path

import pytest

FAM = Path(__file__).resolve().parents[1]
if str(FAM) not in sys.path:
    sys.path.insert(0, str(FAM))

import controls as C  # noqa: E402
import gen as G  # noqa: E402
import harness as H  # noqa: E402
import lib as L  # noqa: E402
import oracle as O  # noqa: E402
import reference as R  # noqa: E402

DEV = [610, 611, 612, 613, 614]
BAD = ["null", "echo", "naive", "nodedupe", "asof", "noparent", "anyauthor", "sftier", "nocomma", "noretract"]


@pytest.fixture(scope="module")
def gens():
    return {s: G.generate(s) for s in DEV}


@pytest.fixture(scope="module")
def refs(gens):
    return {s: H.run_stream("ref", s, g=gens[s]) for s in DEV}


@pytest.fixture(scope="module")
def bad(gens):
    return {name: {s: H.run_stream(name, s, g=gens[s]) for s in DEV} for name in BAD}


# ---------------------------------------------------------------------------------------------- generator
def test_generation_is_deterministic_and_world0_round_trips():
    for s in (610, 611):
        r = H.gate_determinism(s, None)
        assert r["identical"] and r["roundtrip"], r
    a, b = G.generate(610), G.generate(612)
    assert L.canon(a["truth"]) != L.canon(b["truth"])


def test_stream_shape_matches_the_family_spec(gens):
    spec = json.loads((FAM / "family.json").read_text())
    for s, g in gens.items():
        d = g["meta"]["difficulty"]
        assert d == ("d2" if s % 2 == 0 else "d3")
        assert 30 <= g["meta"]["n_triggers"] <= 45, (s, g["meta"]["n_triggers"])
        kinds = Counter(t["kind"] for t in g["triggers"])
        for kind, rng in spec["triggerKinds"].items():
            lo, hi = rng[d]
            assert lo <= kinds.get(kind, 0) <= hi, (s, kind, kinds.get(kind, 0), rng[d])
        assert g["triggers"][-1]["kind"] == "week.close" and g["triggers"][-1]["at"].endswith("T17:00:00Z")
        ats = [t["at"] for t in g["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        # amendments only at d3, one authorized and one not
        subs = sorted(t["sub"] for t in g["triggers"] if t["kind"] == "policy.amendment")
        assert subs == ([] if d == "d2" else ["authorized", "unauthorized"])


def test_trap_shares_match_the_spec(gens):
    """Spec: at least one trap on about 50% (d2) / 80% (d3) of deal triggers. The planted share of fresh closings is
    exact per week; repeats, reopens and escalations are traps by construction, so the share of deal triggers is higher."""
    for s, g in gens.items():
        m = g["meta"]
        target = {"d2": 0.5, "d3": 0.8}[m["difficulty"]]
        assert abs(m["trap_rate_planted"] - target) <= 0.03, (s, m["trap_rate_planted"])
        assert target <= m["trap_rate_deal_triggers"] <= target + 0.15, (s, m["trap_rate_deal_triggers"])


def test_pending_envelope_copy_is_not_a_kind_cue():
    """Review of v1.1.0: only fresh signed deals could have a 'sent' copy of their envelope in world0, so a completed
    envelope without one was more likely an escalation or a repeat. Since v1.2.0 every envelope a trigger completes
    gets one at the same rate (gen.PENDING_SHARE)."""
    share = {}
    for s in range(601, 631):  # practice, dev and rehearsal blocks
        g = G.generate(s)
        pending = {e["id"] for e in g["world0"]["docusign"]["envelopes"] if e["status"] == "sent"}
        for t in g["triggers"]:
            for op in t["delta"]:
                if op["op"] == "upsert_envelope":
                    k = share.setdefault("escalate" if t["sub"].startswith("escalate") else t["sub"], [0, 0])
                    k[0] += op["envelope"]["id"] in pending
                    k[1] += 1
    assert set(share) == {"fresh", "escalate", "signed-after-won"}, share
    for sub, (a, n) in share.items():
        assert n >= 25 and abs(a / n - G.PENDING_SHARE) <= 0.12, (sub, a, n)


def test_write_out_files_and_hashes(tmp_path):
    meta = G.write_out(G.generate(610), tmp_path)
    for name in ("world0.json", "triggers.jsonl", "truth.jsonl", "end.json"):
        assert hashlib.sha256((tmp_path / name).read_bytes()).hexdigest() == meta["sha256"][name]
    assert json.loads((tmp_path / "meta.json").read_text())["seed"] == 610


def test_truth_is_a_snapshot_per_trigger(gens):
    """Regression: a closing retracted later in the week still expects an `Announced` row at its own trigger."""
    seen = 0
    for g in gens.values():
        retracted = {t["expect"]["retract"]["event_id"] for t in g["truth"] if t["expect"].get("retract")}
        for t in g["truth"]:
            c = t["expect"].get("closing")
            if c:
                assert c["log_row"]["Status"] == "Announced"
                seen += c["event_id"] in retracted
    assert seen >= 1


def test_no_tie_in_dated_reference_rows(gens):
    for g in gens.values():
        rows = {r["cells"]["Account ID"] + "|" + r["cells"]["Updated"]
                for ss in g["world0"]["google_sheets"]["spreadsheets"] if ss["id"] == "sheet-account-hierarchy"
                for ws in ss["worksheets"] for r in ws["rows"]}
        n = sum(len(ws["rows"]) for ss in g["world0"]["google_sheets"]["spreadsheets"] if ss["id"] == "sheet-account-hierarchy"
                for ws in ss["worksheets"])
        added = [op["cells"]["Account ID"] + "|" + op["cells"]["Updated"] for t in g["triggers"] for op in t["delta"]
                 if op["op"] == "append_row" and op["spreadsheet_id"] == "sheet-account-hierarchy"]
        assert len(rows) == n and not (set(added) & rows) and len(set(added)) == len(added)


# ---------------------------------------------------------------------------------------------- leakage
def test_no_hidden_truth_in_what_the_arm_sees(gens):
    for g in gens.values():
        r = H.gate_leakage(g)
        assert r["ok"], r["problems"]
        for t in g["triggers"]:
            assert set(t["payload"]) == {"trigger", "at", "app", "event", "data"}
            text = L.canon(t["payload"])
            for hidden in ('"traps"', '"expect"', '"delta"', '"outcome"', '"kind"', '"sub"', "deal.repeat", "authorized"):
                assert hidden not in text, (t["trigger"], hidden)


def test_reference_imports_only_the_standard_library():
    tree = ast.parse((FAM / "reference.py").read_text())
    mods = {(n.module if isinstance(n, ast.ImportFrom) else a.name).split(".")[0]
            for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
            for a in (n.names if isinstance(n, ast.Import) else [None])}
    assert mods <= {"__future__", "base64", "re", "datetime", "decimal", "urllib"}, mods


def test_heldout_seeds_are_refused():
    with pytest.raises(SystemExit):
        H.parse_seeds("8801")
    with pytest.raises(SystemExit):
        H.parse_seeds("610-614,8803")
    assert H.parse_seeds("610-614") == DEV


# ---------------------------------------------------------------------------------------------- reference (solvability)
def test_reference_passes_every_dev_trigger(refs):
    rows = [r for res in refs.values() for r in res["rows"]]
    rate = sum(r["pass"] for r in rows) / len(rows)
    assert rate >= 0.95, [(r["taskKey"], r["failed"]) for r in rows if not r["pass"]][:5]
    assert rate == 1.0 and all(res["clean_week"] for res in refs.values())
    assert not any(r["error"] for r in rows)
    kinds = {r["kind"] for r in rows}
    assert kinds == {"deal.signed", "deal.won", "deal.repeat", "deal.reopened", "ref.changed", "policy.amendment", "week.close"}
    assert {r["truth"] for r in rows} == {"act", "no-op", "escalate"}


def test_reference_rebased_mode(gens, refs):
    res = H.run_stream("ref", 611, g=gens[611], mode="rebased", rebase=refs[611]["afters"])
    assert res["clean_week"]


# ---------------------------------------------------------------------------------------------- bad controls
def test_do_nothing_passes_only_the_noop_triggers(gens, bad):
    for s, res in bad["null"].items():
        for row, truth in zip(res["rows"], gens[s]["truth"]):
            assert row["pass"] == (truth["outcome"] == "no-op"), row
            if truth["outcome"] != "no-op":
                assert row["outcome"] == "miss"
        assert not res["clean_week"]


def test_echo_fails_every_trigger(bad):
    rows = [r for res in bad["echo"].values() for r in res["rows"]]
    assert not any(r["pass"] for r in rows)
    assert {r["outcome"] for r in rows} == {"wrong"}


@pytest.mark.parametrize("name", BAD)
def test_every_bad_control_fails(bad, name):
    """Every control fails the bar the reference meets (all triggers, every week clean). anyauthor only bites on
    amendments, which exist at d3 only, so its d2 weeks may be clean; the others stay below 95% per trigger."""
    rows = [r for res in bad[name].values() for r in res["rows"]]
    rate = sum(r["pass"] for r in rows) / len(rows)
    assert rate < 1.0 and not all(res["clean_week"] for res in bad[name].values()), (name, rate)
    if name == "anyauthor":
        assert not bad[name][611]["clean_week"] and not bad[name][613]["clean_week"]
    else:
        assert rate < 0.95, (name, rate)


def test_naive_heuristic_scores_below_60_percent_at_d3(bad):
    rows = [r for s in (611, 613) for r in bad["naive"][s]["rows"]]
    assert sum(r["pass"] for r in rows) / len(rows) < 0.6
    src = (FAM / "controls.py").read_text().split("\ndef naive(", 1)[1].split("\nclass ", 1)[0]
    assert len([x for x in ("def naive(" + src).splitlines() if x.strip()]) <= 40  # the design's <= 40-line heuristic


@pytest.mark.parametrize("name,kind", [("nodedupe", "deal.repeat"), ("noretract", "deal.reopened"),
                                       ("anyauthor", "policy.amendment"), ("nocomma", "deal.won")])
def test_one_defect_variants_fail_where_their_clause_bites(bad, name, kind):
    """Each plausible-but-wrong variant breaks one policy clause; the oracle flags it on that clause's triggers."""
    rows = [r for res in bad[name].values() for r in res["rows"] if r["kind"] == kind]
    assert rows and any(not r["pass"] for r in rows)


@pytest.mark.parametrize("name,trap", [("asof", ("future-hierarchy", "future-fx")), ("noparent", ("parent-case",)),
                                       ("sftier", ("sf-conflict",))])
def test_one_defect_variants_fail_on_their_trap(gens, refs, name, trap):
    hit = 0
    for s in DEV:
        reb = H.run_stream(name, s, g=gens[s], mode="rebased", rebase=refs[s]["afters"])
        hit += sum(1 for r in reb["rows"] if not r["pass"] and any(t in r["traps"] for t in trap))
    assert hit >= 1


# ---------------------------------------------------------------------------------------------- oracle
def test_oracle_mutation_score():
    r = H.gate_mutation([610, 611], None)
    assert r["total"] > 500 and r["score"] >= 0.95, r
    # review of v1.1.0: hedged tiers, a missing tier, case-folded subject and name, and mail moved out of the inbox were
    # graded correct; each operator must now be applied and flagged every time
    for name in ("email-other-tier-lower", "email-other-tier-far", "email-omit-tier", "email-subject-case", "email-name-case",
                 "trash-mail", "archive-mail"):
        flagged, total = map(int, r["by_mutation"][name].split("/"))
        assert total > 0 and flagged == total, (name, r["by_mutation"][name], r["missed"])


def _trigger_world(g, idx):
    world = H.new_world(g["world0"])
    for k in range(idx + 1):
        if k:
            H.R.handle(copy.deepcopy(g["triggers"][k - 1]["payload"]), H.Api(world))
        H.apply_delta(world, g["triggers"][k]["delta"], g["triggers"][k]["at"])
    return world


def test_oracle_rejects_a_right_looking_announcement_to_the_wrong_tier(gens):
    """A plausible-but-wrong run: a closing announced in the house format, but routed by the Salesforce tier."""
    g = gens[613]
    idx = next(i for i, t in enumerate(g["truth"]) if t["expect"].get("closing") and "sf-conflict" in t["traps"])
    world = _trigger_world(g, idx)
    before = world.model_dump(mode="json")
    C.variant(C.SfTier)(copy.deepcopy(g["triggers"][idx]["payload"]), H.Api(world))
    v = O.grade_trigger(before, world.model_dump(mode="json"), g["truth"][idx], g["triggers"][idx]["payload"])
    assert v["outcome"] == "wrong" and not v["pass"]
    names = {n for n, _ in v["failed"]}
    assert "slack.exact" in names and "log.row" in names


def test_oracle_escalation_and_abstention(gens):
    g = gens[611]
    esc = next(i for i, t in enumerate(g["truth"]) if t["outcome"] == "escalate")
    act = next(i for i, t in enumerate(g["truth"]) if t["outcome"] == "act" and t["kind"] == "deal.won")
    for idx, want in ((esc, "correct"), (act, "abstained")):
        world = _trigger_world(g, idx)
        before = world.model_dump(mode="json")
        p = g["triggers"][idx]["payload"]
        H.Api(world).fetch("POST", f"{R.SLACK}/chat.postMessage", None, {"channel": "automation-review", "text": f"{p['trigger']}: cannot decide"})
        v = O.grade_trigger(before, world.model_dump(mode="json"), g["truth"][idx], p)
        assert v["outcome"] == want, (idx, v["failed"])


# ---------------------------------------------------------------------------------------------- helpers and docs
def test_amount_parsing_and_formats_agree_between_the_two_implementations():
    # euro-decimal forms with one or two decimals: lib (the truth) read ',5' as thousands before v1.2.0 (review of v1.1.0)
    for text, want in (("125.000,00", "125000"), ("125,000.00", "125000"), ("125000", "125000"), ("98,500", "98500"),
                       ("1.234.567,50", "1234567.5"), ("125.000,5", "125000.5"), ("125000,5", "125000.5"), ("1.234,56", "1234.56"),
                       ("98,5", "98.5"), (" 125.000,00 ", "125000"), ("1,234,567", "1234567")):
        assert L.parse_amount(text) == R.parse_amount(text) == Decimal(want), text
    assert L.money(1234567) == R.money(1234567) == "$1,234,567"
    assert L.slack_closed("A - B", 156000, "SMB", "Jo Park") == "CLOSED: A - B | $156,000 | SMB | AE: Jo Park"


def test_policy_and_family_files_agree_with_the_code():
    policy = (FAM / "POLICY.md").read_text()
    for p, v in L.DEFAULTS.items():
        assert re.search(rf"\|\s*{re.escape(p)}\s*\|\s*{re.escape(v)}", policy), p
    assert L.SALES_OPS in policy and L.SUBJECT in policy and L.ESCALATION_MAILBOX in policy
    spec = json.loads((FAM / "family.json").read_text())
    assert spec["id"] == L.FAMILY and spec["version"] == L.VERSION and sorted(spec["apps"]) == sorted(L.APPS)
    assert [a["parameter"] for a in spec["amendable"]] == L.PARAMS
    readme = (FAM / "README.md").read_text()
    for gnd in spec["grounding"]:
        assert gnd["task"] in readme and gnd["span"] in readme
