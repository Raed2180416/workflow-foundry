"""abr-sup-gdpr tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-sup-gdpr/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pytest

FAMILY_DIR = Path(__file__).resolve().parents[1]
if str(FAMILY_DIR) not in sys.path:
    sys.path.insert(0, str(FAMILY_DIR))

import gates  # noqa: E402  (imports harness, which pins TZ=UTC and finds bridge.py)
import gen  # noqa: E402
import harness  # noqa: E402
import oracle  # noqa: E402
import reference  # noqa: E402

DEV = [610, 611, 612, 613, 614]
FAMILY = json.loads((FAMILY_DIR / "family.json").read_text())
REPO = FAMILY_DIR.parents[3]
# control -> trap labels (or trigger kinds) its broken rule must show up on
ONE_DEFECT = {
    "any-sender": {"spoof-lookalike", "spoof-forward", "spoof-display", "spoof-colleague", "wrong-id"},
    "display-first": {"spoof-display"},
    "fuzzy-address": {"lookalike-domain", "hold-lookalike", "spoof-lookalike"},
    "case-sensitive": {"case-address", "case-sender", "duplicate-case"},
    "no-hold": {"on-hold"},
    "any-hold-row": {"hold-lifted-row"},
    "no-lift": {"hold-lift"},
    "text-search": {"cc-user"},
    "org-purge": {"org-domain"},
    "name-match": {"same-name"},
    "replace-tags": {"keep-tags"},
    "edit-log": {"verification.reply", "legal_hold.changed", "day.close"},
    "skip-verified": {"verification.reply"},
    "no-dedupe": {"duplicate-open", "duplicate-blocked", "duplicate-purged"},
    "dedupe-any": {"re-request"},
    "exact-deadline": {"deadline-late"},
    "late-deadline": {"deadline"},
    "close-held": {"deadline-held"},
    "count-all": {"day.close"},
    "stale-batch": {"day.close"},
    "snippet-only": {"id-in-body"},
    "at-date": {"erasure.requested"},
}


@pytest.fixture(scope="module")
def streams():
    return {s: gen.generate(s) for s in DEV}


@pytest.fixture(scope="module")
def dev_runs(streams):
    """(summary, per-stream results) for the reference and every bad control on the five dev streams."""
    return {name: harness.run(name, DEV, streams=streams) for name in ["reference"] + gates.BAD_CONTROLS}


# -- generator ---------------------------------------------------------------------------------------------------------
def test_determinism_and_round_trip():
    g = gates.gate_determinism([610, 611])
    assert g["pass"], g["problems"]


def test_stream_shape_matches_family_json(streams):
    for s, out in streams.items():
        d = out["meta"]["difficulty"]
        assert d == {610: "d2", 611: "d3", 612: "d2", 613: "d3", 614: "d2"}[s]
        lo, hi = FAMILY["triggersPerWeek"][d]
        assert lo <= out["meta"]["n_triggers"] <= hi and 20 <= out["meta"]["n_triggers"] <= 35
        kinds = Counter(t["kind"] for t in out["triggers"])
        for kind, spec in FAMILY["triggerKinds"].items():
            assert spec[d][0] <= kinds[kind] <= spec[d][1], (s, kind, kinds[kind])
            assert spec["perWeek"][0] <= kinds[kind] <= spec["perWeek"][1]
        ats = [t["at"] for t in out["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        last = out["triggers"][-1]
        assert last["kind"] == "day.close" and last["at"].endswith("T17:00:00Z")


def test_trap_rates_near_design(streams):
    for out in streams.values():
        share = out["meta"]["trigger_trap_share"]
        if out["meta"]["difficulty"] == "d2":
            assert 0.38 <= share <= 0.66, share
        else:
            assert 0.68 <= share <= 0.88, share


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert set(g["by_kind"]) >= {"T-lookalike", "T-authority", "T-note", "T-repeat", "T-timing", "T-state"}


def test_pre_seeded_requests_reach_the_deadline(streams):
    """The spec: pre-seeded open requests are at most 29 days old when the week starts and reach day 30 during it;
    every stream closes at least one request, and only at a daily close."""
    from datetime import date
    for out in streams.values():
        mon = date.fromisoformat(out["end"]["week_start"])
        states = {}
        for c in out["end"]["log0"]:
            states[c["Request ID"]] = c["Transition"]
        ages = [(mon - date.fromisoformat(v["date"])).days for rid, v in out["end"]["requests"].items() if states.get(rid) == gen.VS]
        assert ages and max(ages) <= 29, ages
        closes = [t for t in out["truth"] if any(x["Transition"] == gen.CLOSED for x in t["expect"]["log"])]
        assert closes, out["meta"]
        assert all(t["kind"] == "day.close" for t in closes)


def test_fictional_entities_only(streams):
    reserved = re.compile(r"@[a-z0-9.-]*\bexample\.(com|net|org)$")
    for out in streams.values():
        w = out["world0"]
        emails = [u["email"] for u in w["zendesk"]["users"]] + [u["email"] for u in w["slack"]["users"]]
        emails += [r["cells"]["Email"] for r in w["google_sheets"]["rows"] if r["cells"].get("Email")]
        for o in w["zendesk"]["organizations"]:
            assert all(d.endswith(".example.com") for d in o["domain_names"])
        for t in out["triggers"]:
            if t["kind"] == "verification.reply":
                emails.append(oracle.addr(t["payload"]["data"]["from"]))
            elif t["payload"]["data"].get("row", {}).get("Email"):
                emails.append(t["payload"]["data"]["row"]["Email"])
        for e in emails:
            assert reserved.search(e.strip().lower()), e


def test_heldout_seeds_refused(tmp_path):
    with pytest.raises(SystemExit):
        gen.main(["--seed", "8801", "--out", str(tmp_path / "x")])
    with pytest.raises(SystemExit):
        harness.parse_seeds("8801-8804")
    assert not (tmp_path / "x").exists()


def test_write_is_host_only_and_hashed(tmp_path):
    out = gen.generate(610)
    meta = gen.write(out, tmp_path / "s610")
    for name, h in meta["sha256"].items():
        assert gen.sha((tmp_path / "s610" / name).read_text()) == h
    rows = [json.loads(x) for x in (tmp_path / "s610" / "serve-inputs.jsonl").read_text().splitlines()]
    assert len(rows) == len(out["triggers"]) and all(json.loads(r["info"])["assertions"] == [] for r in rows)


def test_truth_logs_one_row_per_transition(streams):
    """Every expected log row is a named transition; a verification logs Verified and then exactly one outcome."""
    for out in streams.values():
        for t in out["truth"]:
            trs = [x["Transition"] for x in t["expect"]["log"]]
            assert all(x in gen.TRANSITIONS for x in trs)
            if gen.VERIFIED in trs:
                i = trs.index(gen.VERIFIED)
                assert trs[i + 1] in (gen.PURGED, gen.BLOCKED)
        assert not [x for x in out["end"]["log_week"] if x["Transition"] == gen.VERIFIED
                    and not any(y["Request ID"] == x["Request ID"] and y["Transition"] in (gen.PURGED, gen.BLOCKED)
                                for y in out["end"]["log_week"])]


def test_world0_has_no_overdue_open_request(streams):
    """Last week's closes ran: no world0 request is 30+ days old at last Friday and still Verification Sent."""
    from datetime import date, timedelta
    for out in streams.values():
        fri0 = date.fromisoformat(out["end"]["week_start"]) - timedelta(days=3)
        states = {}
        for c in out["end"]["log0"]:
            states[c["Request ID"]] = c["Transition"]
        for rid, v in out["end"]["requests"].items():
            if rid in states and states[rid] == gen.VS:
                assert (fri0 - date.fromisoformat(v["date"])).days < 30, rid


# -- leakage -----------------------------------------------------------------------------------------------------------
def test_no_hidden_truth_reaches_the_arm():
    g = gates.gate_leakage(DEV)
    assert g["pass"], g["problems"]


def test_payload_is_zap_shaped(streams):
    for out in streams.values():
        for p in out["payloads"]:
            assert set(p) == gates.PAYLOAD_KEYS
            assert set(p["data"]) == gates.DATA_KEYS[p["event"]]


# -- reference (solvability) -------------------------------------------------------------------------------------------
def test_reference_passes_dev_gate(dev_runs):
    """The deliverable bar: >= 95% of triggers on 5 dev seeds. Measured: every trigger, every week."""
    summary, results = dev_runs["reference"]
    assert summary["pass_rate"] >= 0.95
    assert summary["passed"] == summary["triggers"], [(x["taskKey"], x["failed"]) for r in results for x in r["rows"] if not x["pass"]][:3]
    assert summary["clean_weeks"] == 5 and summary["errors"] == 0
    assert summary["max_steps"] <= 49


def test_reference_rebased_and_practice():
    s, _ = harness.run("reference", [601, 602, 603])
    assert s["passed"] == s["triggers"]
    r, _ = harness.run("reference", [611], mode="rebased")
    assert r["passed"] == r["triggers"]


def test_reference_is_observable_only():
    src = (FAMILY_DIR / "reference.py").read_text()
    assert "import gen" not in src and "import oracle" not in src and "harness" not in src
    assert "truth" not in src.lower()


# -- controls ----------------------------------------------------------------------------------------------------------
def test_every_control_fails(dev_runs):
    for name in gates.BAD_CONTROLS:
        summary, _ = dev_runs[name]
        assert summary["passed"] < summary["triggers"], name
        assert summary["clean_weeks"] < summary["streams"], name


def test_null_passes_only_no_op_triggers(dev_runs, streams):
    noop = sum(1 for s in DEV for t in streams[s]["truth"] if t["outcome"] == "no-op")
    summary, results = dev_runs["null"]
    assert summary["passed"] == noop
    assert all(x["outcome"] in ("correct", "miss") for r in results for x in r["rows"])


def test_echo_is_rejected_everywhere(dev_runs):
    summary, _ = dev_runs["echo"]
    assert summary["passed"] == 0


def test_naive_heuristic_below_60_percent_at_d3(streams):
    s, _ = harness.run("naive", [611, 613], streams=streams)
    assert s["pass_rate"] < 0.6
    import controls
    assert controls.NAIVE_LINES <= 40


def test_each_one_defect_control_fails_on_its_own_trap(dev_runs):
    for name, marks in ONE_DEFECT.items():
        _, results = dev_runs[name]
        failed = [x for r in results for x in r["rows"] if not x["pass"]]
        hit = [x for x in failed if marks & (set(x["traps"]) | {x["kind"]})]
        assert hit, (name, [(x["taskKey"], x["traps"]) for x in failed][:5])


def test_audit_requirement_is_checked(dev_runs):
    """edit-log rewrites the request's latest row instead of appending: the append-only check itself fails."""
    _, results = dev_runs["edit-log"]
    names = {c["name"] for r in results for x in r["rows"] for c in x["failed"]}
    assert "audit.append-only" in names and "end.log-history-unchanged" in names
    _, results = dev_runs["skip-verified"]
    assert any(c["name"].endswith(" Verified") for r in results for x in r["rows"] for c in x["failed"])


def test_statutory_deadline_is_checked_from_the_arms_world(dev_runs):
    _, results = dev_runs["late-deadline"]
    ends = [r["rows"][-1] for r in results]
    assert any("end.statutory-deadline" in {c["name"] for c in x["failed"]} for x in ends)
    _, results = dev_runs["reference"]
    assert all(r["rows"][-1]["pass"] for r in results)


def test_spoofed_verification_is_a_wrong_delivery(streams):
    """Rebased (per-trigger) mode: in carry mode an earlier accepted spoof can already have purged the request, so a
    later spoof for it is correctly a no-op (a cascade, reported as such by the harness)."""
    _, results = harness.run("any-sender", DEV, mode="rebased", streams=streams)
    spoofs = [x for r in results for x in r["rows"] if {"spoof-lookalike", "spoof-forward", "spoof-display"} & set(x["traps"])]
    assert spoofs and all(not x["pass"] and x["outcome"] == "wrong" for x in spoofs)


# -- oracle ------------------------------------------------------------------------------------------------------------
def test_oracle_mutation_score():
    g = gates.gate_mutation([610, 611])
    assert g["pass"] and g["score"] >= 0.95, g["survived"]


def test_oracle_specificity():
    g = gates.gate_specificity([610])
    assert g["pass"], (g["rejected"], g["equivalent_failures"])


def test_api_cannot_set_a_ticket_description():
    """The narrowing in family.json: PUT /tickets/{id} with a description leaves the description as it was."""
    stream = gen.generate(610)
    b = harness.bridge()
    import asyncio
    r = b.Rollout(gen.serve_input(610, stream["triggers"][0]), harness.MAX_STEPS, stream["world0"], 0)
    asyncio.run(r.setup())
    t = stream["world0"]["zendesk"]["tickets"][0]
    ctx = harness.Ctx(r, {})
    ctx.fetch("PUT", reference.ZENDESK + f"tickets/{t['id']}", None, {"ticket": {"description": "[redacted]"}})
    after = next(x for x in r.world()["zendesk"]["tickets"] if x["id"] == t["id"])
    assert after["description"] == t["description"]


@pytest.mark.skipif(not (REPO / "corpus/AutomationBench/automationbench/domains/support/tasks.py").exists(),
                    reason="AutomationBench clone not present")
def test_grounding_span():
    lines = (REPO / "corpus/AutomationBench/automationbench/domains/support/tasks.py").read_text().splitlines()
    span = "\n".join(lines[22600:23005])
    assert '"task": "support.zendesk_gdpr_purge"' in span and "ws_legal_hold" in span
    assert FAMILY["grounding"][0]["span"].endswith("22601-23005")
