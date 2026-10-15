"""abr-sales-noshow tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-sales-noshow/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import copy
import json
import re
import sys
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


@pytest.fixture(scope="module")
def grader():
    return oracle.Grader()


@pytest.fixture(scope="module")
def dev_runs():
    """(summary, per-stream results) for the reference and every bad control on the five dev streams."""
    out = {"reference": harness.run("reference", DEV)}
    for name in gates.BAD_CONTROLS:
        out[name] = harness.run(name, DEV)
    return out


@pytest.fixture(scope="module")
def ref_worlds(grader):
    """The reference's per-trigger world_before / world_after on one d2 and one d3 dev stream."""
    out = []
    for s in (610, 611):
        stream = gen.generate(s)
        res = harness.run_stream(stream, reference.handle, grader=grader, keep_worlds=True)
        out.append((stream, res))
    return out


# -- generator ---------------------------------------------------------------------------------------------------------
def test_determinism_and_round_trip():
    g = gates.gate_determinism([610, 611])
    assert g["pass"], g["problems"]


def test_stream_shape_matches_family_json():
    kinds = FAMILY["triggerKinds"]
    for s in PRACTICE + DEV:
        out = gen.generate(s, validate=False)
        d = out["meta"]["difficulty"]
        assert d == gen.default_difficulty(s)
        trig = out["triggers"]
        assert 15 <= len(trig) <= 25, (s, len(trig))
        assert trig[-1]["kind"] == "week.close" and trig[-1]["payload"]["event"] == "week_close"
        assert [t["at"] for t in trig] == sorted(t["at"] for t in trig) and len({t["at"] for t in trig}) == len(trig)
        week0 = out["end"]["week_start"]
        assert all(week0 <= t["at"] <= trig[-1]["at"] for t in trig)
        n = {k: sum(1 for t in trig if t["kind"] == k) for k in kinds}
        for k, spec in kinds.items():
            lo, hi = spec.get(d, spec["perWeek"])
            assert lo <= n[k] <= hi, (s, k, n[k], (lo, hi))
        assert [t["trigger"] for t in trig] == [f"s{s}/t{i:02d}" for i in range(1, len(trig) + 1)]


def test_trap_rates_near_design():
    shares = {"d2": [], "d3": []}
    for s in PRACTICE + DEV:
        m = gen.generate(s, validate=False)["meta"]
        shares[m["difficulty"]].append(m["trigger_trap_share"])
    d2, d3 = (sum(v) / len(v) for v in (shares["d2"], shares["d3"]))
    assert 0.3 <= d2 <= 0.55 and 0.6 <= d3 <= 0.85 and d3 > d2, (d2, d3)
    for s in (610, 612):          # d1 is smoke only: no planted traps on handled reports
        assert all(not t["traps"] for t in gen.generate(s, "d1", validate=False)["truth"] if t["variant"] == "act")


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert all(g["by_kind"][k] >= 5 for k in gen.TRAP_KINDS)


def test_fictional_entities_only():
    out = gen.generate(610)
    w = out["world0"]
    emails = [c["email"] for c in w["salesforce"]["contacts"]] + [i["email"] for i in w["calendly"]["invitees"]] + \
        [u["email"] for u in w["slack"]["users"]]
    assert emails and all(e.split("@")[1].endswith("example.com") for e in emails)
    assert all(a["website"].endswith(".example.com") for a in w["salesforce"]["accounts"])


def test_heldout_seeds_refused(tmp_path):
    with pytest.raises(SystemExit):
        gen.main(["--seed", "8801", "--out", str(tmp_path)])
    with pytest.raises(SystemExit):
        harness.parse_seeds("610,8802")
    assert not any(tmp_path.iterdir())


def test_write_is_host_only_and_hashed(tmp_path):
    meta = gen.write(gen.generate(610), tmp_path)
    names = {"world0.json", "payloads.jsonl", "triggers.jsonl", "truth.jsonl", "end.json", "serve-inputs.jsonl"}
    assert set(meta["sha256"]) == names and (tmp_path / "meta.json").exists()
    rows = [json.loads(x) for x in (tmp_path / "serve-inputs.jsonl").read_text().splitlines()]
    assert all(json.loads(r["info"])["assertions"] == [] for r in rows)


# -- leakage -----------------------------------------------------------------------------------------------------------
def test_no_hidden_truth_reaches_the_arm():
    g = gates.gate_leakage(DEV)
    assert g["pass"], g["problems"]


def test_payload_is_zap_shaped():
    out = gen.generate(611, validate=False)
    for p in out["payloads"]:
        assert set(p) == {"trigger", "at", "app", "event", "data"}
        if p["app"] == "slack":
            assert p["event"] == "new_message" and p["data"]["channel"] == "sales-alerts"
        else:
            assert (p["app"], p["event"], p["data"]) == ("schedule", "week_close", {})


# -- reference ---------------------------------------------------------------------------------------------------------
def test_reference_passes_dev_seeds(dev_runs):
    summary, results = dev_runs["reference"]
    assert summary["pass_rate"] >= 0.95
    assert summary["passed"] == summary["triggers"] and summary["clean_weeks"] == len(DEV), summary


def test_reference_passes_practice_seeds_and_rebased_mode():
    summary, _ = harness.run("reference", PRACTICE)
    assert summary["passed"] == summary["triggers"], summary
    rebased, _ = harness.run("reference", [612], mode="rebased")
    assert rebased["passed"] == rebased["triggers"], rebased


def test_reference_is_observable_only():
    src = (FAMILY_DIR / "reference.py").read_text()
    assert not re.search(r"^\s*(from|import)\s+(gen|oracle|harness|gates|controls|automationbench|bridge)\b", src, re.M)
    assert not re.search(r"\b(truth|delta|traps|variant)\b", src)


# -- bad controls ------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("name", gates.BAD_CONTROLS)
def test_every_bad_control_fails(dev_runs, name):
    summary, _ = dev_runs[name]
    ref, _ = dev_runs["reference"]
    assert summary["passed"] < ref["passed"], summary
    assert summary["clean_weeks"] < len(DEV), summary


def test_gross_controls(dev_runs):
    noop = sum(1 for s in DEV for t in gen.generate(s, validate=False)["truth"] if t["outcome"] == "no-op")
    assert dev_runs["null"][0]["passed"] == noop                    # do-nothing: only the no-op triggers pass
    assert dev_runs["null"][0]["outcomes"].get("miss", 0) == dev_runs["null"][0]["triggers"] - noop
    assert dev_runs["echo"][0]["passed"] == 0                       # echo: every trigger rejected
    assert dev_runs["naive"][0]["pass_rate"] < 0.6
    naive_d3, _ = harness.run("naive", [s for s in DEV if gen.default_difficulty(s) == "d3"])
    assert naive_d3["pass_rate"] < 0.6
    import controls
    assert controls.NAIVE_LINES <= 40


# Each plausible-but-wrong control breaks one policy rule; the oracle must reject it for that rule, on the triggers
# where the rule matters (not merely through some side effect).
EXPECTED_FAILURE = {
    "stale-threshold": ({"act"}, {"task.priority"}),
    "no-repeat": ({"act"}, {"task.priority", "task.repeat"}),
    "latest-event": ({"act", "escalate:cancelled-only"}, {"guards", "escalate", "flag", "envelope"}),
    "all-opps": ({"act"}, {"task.pipeline", "task.priority"}),
    "chatter-as-report": ({"chatter"}, {"envelope"}),
    "no-dedupe": ({"duplicate"}, {"envelope"}),
    "contact-by-surname": ({"act"}, {"task.create"}),
    "retract-by-surname": ({"retraction"}, {"retract.update"}),
}


@pytest.mark.parametrize("name", sorted(EXPECTED_FAILURE))
def test_plausible_controls_fail_for_their_rule(dev_runs, name):
    variants, checks = EXPECTED_FAILURE[name]
    _, results = dev_runs[name]
    hits = [r for res in results for r in res["rows"] if not r["pass"] and r["variant"] in variants
            and {c["name"].split(" ")[0] for c in r["failed"]} & checks]
    assert hits, f"{name}: no failure on {variants} through {checks}"


# -- oracle ------------------------------------------------------------------------------------------------------------
def test_oracle_accepts_reference_and_rejects_null_and_echo(ref_worlds, grader):
    stream, res = ref_worlds[0]
    for truth, before, after in zip(stream["truth"], res["befores"], res["afters"]):
        assert grader.grade(truth, before, after)["pass"], truth["trigger"]
        nothing = grader.grade(truth, before, copy.deepcopy(before))
        if truth["outcome"] == "no-op":
            assert nothing["pass"], truth["trigger"]
        else:
            assert not nothing["pass"] and nothing["outcome"] == "miss", truth["trigger"]
        echo = copy.deepcopy(after)
        gates._post(echo, "sales-alerts", "echo: " + truth["trigger"], 1)
        assert not grader.grade(truth, before, echo)["pass"]


def test_oracle_mutation_score(ref_worlds, grader):
    total, killed = 0, 0
    for stream, res in ref_worlds:
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            for name, w in gates.mutants(before, after, truth):
                total += 1
                v = grader.grade(truth, before, w, end=stream["end"] if last else None,
                                 world0=stream["world0"] if last else None)
                killed += not v["pass"]
    assert total >= 300 and killed / total >= 0.95, (killed, total)


def test_oracle_specificity_no_false_rejects():
    g = gates.gate_specificity([610, 611])
    assert g["pass"] and g["variants"] >= 30, g


def test_oracle_token_boundaries():
    assert oracle.has_token("No-shows this week: 12.", "No-shows this week: 12")
    assert not oracle.has_token("No-shows this week: 12", "No-shows this week: 1")
    assert not oracle.has_token("Account pipeline: $1,250,000", "Account pipeline: $1,250")
    assert oracle.has_token("Account pipeline: $1,250 | Repeat no-show", "Account pipeline: $1,250")
    assert not oracle.has_token("s610/t012 cannot decide", "s610/t01")


def test_end_of_week_is_graded_at_week_close(ref_worlds, grader):
    stream, res = ref_worlds[1]
    truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
    ok = grader.grade(truth, before, after, end=stream["end"], world0=stream["world0"])
    assert ok["pass"] and ok["n_checks"] > grader.grade(truth, before, after)["n_checks"]
    bad = copy.deepcopy(after)              # a handled no-show's flag silently removed during the week
    flagged = stream["end"]["flagged"]
    inv = next(i for i in bad["calendly"]["invitees"] if i["id"] == flagged[-1])
    inv["is_no_show"] = False
    v = grader.grade(truth, before, bad, end=stream["end"], world0=stream["world0"])
    assert not v["pass"] and any(c["name"] == "end.flags" for c in v["failed"])


# -- policy text -------------------------------------------------------------------------------------------------------
def test_policy_states_the_parameters_the_generator_uses():
    policy = (FAMILY_DIR / "POLICY.md").read_text().replace("\\|", "|")     # table cells escape the pipe
    for s in ["$50,000", "3 hours", "14 days", "`Follow up on missed call - <Event Name>`", "`Not Started`",
              "` | Repeat no-show`", "` | Retracted: joined late`", "`No-shows this week: <N>`", "company.example.com",
              "#automation-review", "trigger id"]:
        assert s in policy, s
    assert gen.THRESHOLD == reference.THRESHOLD == 50_000
    assert gen.WINDOW == reference.WINDOW and gen.REPEAT_WINDOW == reference.REPEAT_WINDOW
    assert gen.SUBJECT_PREFIX == reference.PREFIX and gen.RETRACT_SUFFIX == reference.RETRACT_SUFFIX
