"""abr-hr-referral tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-hr-referral/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import copy
import json
import re
import sys
from collections import Counter
from datetime import date, timedelta
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
PRACTICE = list(range(601, 610))
FAMILY = json.loads((FAMILY_DIR / "family.json").read_text())
ONE_DEFECT = {  # control -> trap labels its broken rule must show up on
    "probation-label": {"probation-stale"}, "eligible-means-due": {"status-stale"}, "ignore-paid-note": {"paid-note"},
    "ignore-hold": {"held"}, "any-author-hold": {"hold-unauthorized"}, "hold-word-anywhere": {"hold", "hold-multi"},
    "employee-by-name": {"namesake"}, "eu-dates": {"date-format"}, "strict-day90": {"day90-exact"},
    "day90-only": {"weekend", "release"}, "no-cap": {"cap"}, "cap-all-years": {"cap-prior-year"},
    "cap-by-name": {"cap-namesake"}, "cap-inclusive": {"cap-exact"}, "dup-by-name": {"candidate-namesake"},
    "dup-case-sensitive": {"email-case"}, "no-rehire": {"rehire"}, "rehire-by-name": {"rehire-namesake"},
    "left-by-name": {"left-namesake"}, "void-paid": {"left-after-paid"},
    "comply-broadcast": {"broadcast-allstaff", "cc-finance", "post-amounts", "vp-broadcast"}}


@pytest.fixture(scope="module")
def streams():
    return {s: gen.generate(s) for s in DEV}


@pytest.fixture(scope="module")
def dev_runs(streams):
    """(summary, per-stream results) for the reference and every bad control on the five dev streams."""
    return {name: harness.run(name, DEV, streams=streams) for name in ["reference"] + gates.BAD_CONTROLS}


@pytest.fixture(scope="module")
def ref_worlds(streams):
    """The reference's per-trigger world_before / world_after on one d2 and one d3 dev stream."""
    grader = oracle.Grader()
    return [(streams[s], harness.run_stream(streams[s], reference.handle, grader=grader, keep_worlds=True)) for s in (610, 611)]


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
        runs = [t for t in out["triggers"] if t["kind"] == "payout.run"]
        assert [t["at"][11:] for t in runs] == ["09:00:00Z"] * 5
        assert [date.fromisoformat(t["at"][:10]).weekday() for t in runs] == [0, 1, 2, 3, 4]
        assert out["triggers"][-1] is runs[-1]                   # Friday's run closes the week


def test_trap_rates_near_design(streams):
    for out in streams.values():
        share = out["meta"]["trigger_trap_share"]
        if out["meta"]["difficulty"] == "d2":
            assert 0.38 <= share <= 0.58, share
        else:
            assert 0.62 <= share <= 0.80, share


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert set(g["by_kind"]) == set(gates.TRAP_KINDS)


def test_cross_trigger_state_is_seeded(streams):
    """Day 90 of several hires falls inside the week; this year's payouts are pre-seeded; at least one hold is open."""
    for out in streams.values():
        w = out["world0"]
        monday, friday = date.fromisoformat(out["end"]["week_start"]), date.fromisoformat(out["end"]["friday"])
        log = [r["cells"] for r in w["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_LOG]
        due = [c for c in log if c["Status"] in (gen.PNYE, gen.ELIGIBLE) and c["Hire Date"]
               and monday - timedelta(days=2) <= gen.parse_date(c["Hire Date"]) + timedelta(days=90) <= friday]
        assert len(due) >= 4
        ytd = [c for c in log if c["Status"] == gen.PAID and c["Paid On"][:4] == str(monday.year)]
        assert len(ytd) >= 3
        assert any(c["Hold"] == "Yes" for c in log)
        totals = Counter()
        for c in ytd:
            totals[c["Referrer Email"]] += gen.parse_money(c["Bonus"])
        assert max(totals.values()) <= gen.CAP


def test_fictional_entities_only(streams):
    allowed = re.compile(r"@(company\.example\.com|[a-z]+\.example\.(com|net|org))$")
    for out in streams.values():
        w = out["world0"]
        for r in w["google_sheets"]["rows"]:
            for k in ("Referrer Email", "Candidate Email", "Work Email", "Personal Email"):
                if r["cells"].get(k):
                    assert allowed.search(r["cells"][k].lower()), r["cells"][k]
        for u in w["slack"]["users"]:
            assert u["email"].endswith("@company.example.com")
        for m in w["gmail"]["messages"]:
            assert all(allowed.search(oracle.addr(x)) for x in m["to"] + [m["from_"]])


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


# -- leakage -----------------------------------------------------------------------------------------------------------
def test_no_hidden_truth_reaches_the_arm():
    g = gates.gate_leakage(DEV)
    assert g["pass"], g["problems"]


def test_payload_is_zap_shaped(streams):
    for out in streams.values():
        for p in out["payloads"]:
            assert set(p) == gates.PAYLOAD_KEYS
            assert set(p["data"]) == gates.DATA_KEYS[p["event"]]
            assert re.fullmatch(r"s6\d\d/t\d\d", p["trigger"]) and p["at"].endswith("Z")
            if p["app"] == "google_sheets":
                assert not set(p["data"]["row"]) & set(gen.AUTO_COLS)   # the arm's own state never arrives in a payload


# -- reference -----------------------------------------------------------------------------------------------------------
def test_reference_passes_dev_seeds(dev_runs):
    summary, results = dev_runs["reference"]
    assert summary["passed"] == summary["triggers"] and summary["clean_weeks"] == len(DEV), summary
    assert summary["max_steps"] <= 49


def test_reference_passes_practice_seeds_and_rebased_mode():
    s, _ = harness.run("reference", PRACTICE)
    assert s["passed"] == s["triggers"] and s["clean_weeks"] == len(PRACTICE), s
    s, _ = harness.run("reference", [610, 611], mode="rebased")
    assert s["passed"] == s["triggers"], s


def test_reference_is_observable_only():
    g = gates.gate_leakage([610])
    assert set(g["reference_imports"]) <= gates.REF_STDLIB
    src = (FAMILY_DIR / "reference.py").read_text()
    for host in ("import gen", "import oracle", "truth", "world0", "delta"):
        assert host not in src


# -- controls ------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("name", gates.BAD_CONTROLS)
def test_every_bad_control_fails(dev_runs, name):
    summary, _ = dev_runs[name]
    assert summary["passed"] < summary["triggers"] and summary["clean_weeks"] < len(DEV), summary


def test_gross_controls(dev_runs, streams):
    noop = sum(1 for s in DEV for t in streams[s]["truth"] if t["outcome"] == "no-op")
    null, _ = dev_runs["null"]
    assert null["passed"] == noop and set(null["outcomes"]) <= {"correct", "miss"}
    echo, _ = dev_runs["echo"]
    assert echo["passed"] == 0 and set(echo["outcomes"]) == {"wrong"}
    import controls
    src = (FAMILY_DIR / "controls.py").read_text()
    body = src[src.index("def naive("): src.index("NAIVE_LINES")].strip().splitlines()
    assert len(body) <= 40 and controls.NAIVE_LINES >= len(body) - 1
    d3, _ = harness.run("naive", [611, 613], streams=streams)
    assert d3["pass_rate"] < 0.6, d3


@pytest.mark.parametrize("name", sorted(ONE_DEFECT))
def test_plausible_controls_fail_for_their_rule(dev_runs, name):
    """Each one-defect control fails on at least one trigger carrying the trap its broken rule resolves."""
    _, results = dev_runs[name]
    failed = [x for r in results for x in r["rows"] if not x["pass"]]
    assert any(set(x["traps"]) & ONE_DEFECT[name] for x in failed), (name, [(x["taskKey"], x["traps"]) for x in failed][:6])
    assert all(x["error"] is None for x in failed)


# -- oracle --------------------------------------------------------------------------------------------------------------
def test_oracle_accepts_reference_and_rejects_null_and_echo(ref_worlds):
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            end, w0 = (stream["end"], stream["world0"]) if last else (None, None)
            assert grader.grade(truth, before, after, end, w0)["pass"]
            v = grader.grade(truth, before, before, end if not last else None, w0 if not last else None)
            assert v["pass"] == (truth["outcome"] == "no-op")
            if truth["outcome"] == "act":
                assert v["outcome"] == "miss"
            echoed = copy.deepcopy(before)
            gates._post(echoed, gen.MANAGERS, json.dumps(truth["trigger"]), 1)
            assert not grader.grade(truth, before, echoed)["pass"]


def test_oracle_rejects_plausible_but_wrong_payouts(ref_worlds):
    """A payout run that also pays a held referral, or that copies finance on a correct payout, is wrong."""
    grader = oracle.Grader()
    stream, res = ref_worlds[0]
    k = next(i for i, t in enumerate(stream["truth"]) if t["kind"] == "payout.run" and t["expect"]["emails"]
             and i < len(stream["truth"]) - 1)
    truth, before, after = stream["truth"][k], res["befores"][k], res["afters"][k]
    w = copy.deepcopy(after)
    held = next(r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_LOG and r["cells"]["Hold"] == "Yes")
    held["cells"].update({"Status": "Paid", "Bonus": "$2,000", "Paid On": before["meta"]["current_time"][:10]})
    gates._mail(w, [gen.PAYROLL], f"Referral bonus payout: {held['cells']['Referral ID']}", "Amount: $2,000", 7)
    v = grader.grade(truth, before, w)
    assert not v["pass"] and v["outcome"] == "wrong"
    w = copy.deepcopy(after)
    sent = next(m for m in w["gmail"]["messages"] if m["id"] not in {x["id"] for x in before["gmail"]["messages"]}
                and gen.PAYROLL in m["to"])
    sent["cc"] = [gen.FINANCE]
    v = grader.grade(truth, before, w)
    assert not v["pass"] and v["outcome"] == "wrong"
    assert any(c["group"] == "ab" for c in v["failed"])          # AutomationBench's own gmail_message_not_sent_to


def test_oracle_mutation_score():
    g = gates.gate_mutation([610, 611])
    assert g["pass"] and g["score"] >= 0.95, g
    assert len(g["operators"]) >= 25


def test_oracle_specificity_no_false_rejects():
    g = gates.gate_specificity([610])
    assert g["pass"], g["rejected"]


def test_abstention_is_not_credit(ref_worlds):
    grader = oracle.Grader()
    stream, res = ref_worlds[0]
    k = next(i for i, t in enumerate(stream["truth"]) if t["kind"] == "referral.submitted" and t["outcome"] == "act")
    before = res["befores"][k]
    w = copy.deepcopy(before)
    gates._post(w, gen.REVIEW, f"{stream['truth'][k]['trigger']}: not sure about this referral", 1)
    v = grader.grade(stream["truth"][k], before, w)
    assert not v["pass"] and v["outcome"] == "abstained"


def test_end_of_week_is_graded_at_the_last_trigger(ref_worlds):
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
        ok = grader.grade(truth, before, after, stream["end"], stream["world0"])
        plain = grader.grade(truth, before, after)
        assert ok["pass"] and ok["n_checks"] - plain["n_checks"] == 10    # the ten end-of-week checks ran and passed
        # an earlier payout silently reverted in the final world: invisible per trigger, caught at week end
        w0, w1 = copy.deepcopy(before), copy.deepcopy(after)
        paid = next(r for r in w1["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_LOG
                    and r["cells"]["Status"] == gen.PAID and r["cells"]["Paid On"] >= stream["end"]["week_start"])
        for w in (w0, w1):
            next(r for r in w["google_sheets"]["rows"] if r["id"] == paid["id"])["cells"].update({"Status": gen.PNYE, "Bonus": "", "Paid On": ""})
        v = grader.grade(truth, w0, w1, stream["end"], stream["world0"])
        assert not v["pass"] and any(c["name"] == "end.referral-log" for c in v["failed"])
        # a second payroll email for an earlier payout (double pay), present before and after the last trigger
        w0, w1 = copy.deepcopy(before), copy.deepcopy(after)
        for w in (w0, w1):
            gates._mail(w, [gen.PAYROLL], f"Referral bonus payout: {paid['cells']['Referral ID']}", "again", 9)
        v = grader.grade(truth, w0, w1, stream["end"], stream["world0"])
        assert not v["pass"] and {"end.paid-once", "end.emails"} <= {c["name"] for c in v["failed"]}


# -- policy and grounding ----------------------------------------------------------------------------------------------
def test_policy_states_the_parameters_the_generator_uses():
    policy = (FAMILY_DIR / "POLICY.md").read_text()
    for s in (gen.SS, gen.WS_LOG, gen.WS_EMP, gen.WS_POL, gen.PAYROLL, gen.FINANCE, gen.ALL_STAFF, gen.INBOX, gen.VP_ID,
              gen.PENDING, gen.PNYE, gen.ELIGIBLE, gen.PAID, gen.DUPLICATE, gen.REHIRE, gen.VOIDED, gen.CAPPED,
              "Referral bonus payout: <Referral ID>", "Your referral bonus for <Candidate>", "$10,000", "$2,000", "$3,500",
              "$5,000", "`paid out`", "`HOLD`", "`RELEASE`", "#vp-people", "#automation-review", "MM/DD/YYYY",
              "Mar 9, 2026", "9 March 2026", "90 calendar days", "12 months"):
        assert s in policy, s
    for h in gen.LOG_HEADERS + gen.EMP_HEADERS:
        assert h in policy, h
    for note in gen.SUB_NOTES:                # no submission note says a payout happened
        assert gen.KW_PAID not in note.lower(), note
    for text in gen.PEOPLE_CHATTER + gen.MANAGER_CHATTER + gen.GENERAL_CHATTER:
        assert not re.match(r"\s*(hold|release)\b", text, re.I) and "$" not in text, text


def test_grounding_spans_point_at_the_public_tasks():
    tasks = FAMILY_DIR.parents[3] / "corpus" / "AutomationBench" / "automationbench" / "domains" / "hr" / "tasks.py"
    if not tasks.exists():
        pytest.skip("corpus/AutomationBench not cloned")
    lines = tasks.read_text().splitlines()
    for g in FAMILY["grounding"]:
        a, b = (int(x) for x in g["span"].split(":")[1].split("-"))
        assert lines[a - 1].startswith("def get_")
        assert f'"{g["task"]}"' in "\n".join(lines[a - 1:b])
