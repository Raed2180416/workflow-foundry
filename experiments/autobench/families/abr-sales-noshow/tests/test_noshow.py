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


def test_stream_story_is_coherent_and_off_the_repeat_boundary():
    """Review 2026-10-21 defects 5 and 7, over the practice, dev, top-up and rehearsal seeds at d1/d2/d3: a duplicate
    report never follows the retraction of the same no-show (a retraction may follow a duplicate), and no earlier
    no-show of an act's invitee sits on the 14-day repeat boundary (calendar day 14 days back or within 12 h of it), so
    the repeat verdict does not depend on how 'in the 14 days before' is read. compute_truth asserts both."""
    dup_then_ret = in_week = 0
    for s in range(601, 651):
        for d in ("d1", "d2", "d3"):
            g = gen.Gen(s, d)
            g.run()
            for p in g.plans:
                if p["variant"] == "duplicate" and p["of"].get("retract_at"):
                    assert p["of"]["retract_at"] > p["at"], (s, d, p["tid"])
                    dup_then_ret += 1
                if p["variant"] == "act":
                    in_week += "T-repeat:in-week" in p["traps"]
                    for q in g.prior.get(p["contact"]["email"], []):
                        if q["start"] < p["event"]["start"]:
                            assert not gen.near_repeat_boundary(p["event"]["start"], q["start"]), (s, d, p["tid"])
    assert dup_then_ret > 0 and in_week > 50, (dup_then_ret, in_week)
    from datetime import datetime, timezone
    at = datetime(2026, 8, 28, 13, 30, tzinfo=timezone.utc)
    assert gen.near_repeat_boundary(at, datetime(2026, 8, 14, 13, 30, tzinfo=timezone.utc))      # s615/t22 (1.0.0)
    assert gen.near_repeat_boundary(at, datetime(2026, 8, 14, 9, 0, tzinfo=timezone.utc))
    assert not gen.near_repeat_boundary(at, datetime(2026, 8, 15, 15, 30, tzinfo=timezone.utc))
    assert not gen.near_repeat_boundary(at, datetime(2026, 8, 13, 8, 0, tzinfo=timezone.utc))


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
                killed += not oracle.verdict_ok(v)
    assert total >= 300 and killed / total >= 0.95, (killed, total)


# Wrong outputs the 2026-10-21 review found the oracle accepting (substring matching). Each must now be rejected on
# every trigger where it applies, and each must apply somewhere on the d2 and d3 dev streams.
REVIEW_MUTANTS = {
    "description-fields-reordered": "act", "pipeline-with-cents": "act", "description-junk-prefix": "act",
    "description-conflicting-pipeline": "act", "task-what-id-other-account": "act",
    "task-closed-while-not-started": "act", "retraction-marker-prepended": "retraction",
    "retraction-wrong-wording": "retraction", "retraction-not-retracted": "retraction",
    "count-contradicted": "week_close", "count-decimal": "week_close", "end-earlier-task-redescribed": "week_close",
}


def test_oracle_kills_every_review_mutant(ref_worlds, grader):
    seen, survived = {k: 0 for k in REVIEW_MUTANTS}, []
    for stream, res in ref_worlds:
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            for name, w in gates.mutants(before, after, truth):
                if name not in REVIEW_MUTANTS:
                    continue
                assert truth["variant"] == REVIEW_MUTANTS[name], (name, truth["variant"])
                seen[name] += 1
                v = grader.grade(truth, before, w, end=stream["end"] if last else None,
                                 world0=stream["world0"] if last else None)
                if oracle.verdict_ok(v):
                    survived.append(f"{truth['trigger']} {name}")
    assert all(seen.values()), {k: n for k, n in seen.items() if not n}
    assert not survived, survived


def _first(ref_worlds, variant):
    for stream, res in ref_worlds:
        for k, truth in enumerate(stream["truth"]):
            if truth["variant"] == variant:
                return stream, truth, res["befores"][k], res["afters"][k]
    raise AssertionError(f"no {variant} trigger on the dev streams")


def test_oracle_review_probes_exact_strings(ref_worlds, grader):
    """The reviewer's probes W1-W9 (scratchpad mut.py), written out: wrong outputs rejected, correct variants kept."""
    stream, truth, before, after = _first(ref_worlds, "act")
    tid = gates._new_ids(before, after, "salesforce", "tasks")[0]
    good = next(t for t in after["salesforce"]["tasks"] if t["id"] == tid)["description"]

    def with_desc(d):
        w = copy.deepcopy(after)
        next(t for t in w["salesforce"]["tasks"] if t["id"] == tid)["description"] = d
        return grader.grade(truth, before, w)
    sched, pipe = good.split(" | ")[:2]
    for bad in (" | ".join([pipe, sched] + good.split(" | ")[2:]),              # W1 reordered
                re.sub(r"(\$[\d,]+)", r"\1.00", good),                          # W2 cents
                "IGNORE: " + good + " | Account pipeline: $999,999",             # W8 junk + second value
                good + " | Account pipeline: $999,999",
                good.replace("Scheduled", "scheduled")):
        v = with_desc(bad)
        assert not v["pass"] and "task.description" in {c["name"] for c in v["failed"]}, bad
    for ok in (good + ".", good.replace(" | ", "  | "), " " + good + " "):
        assert with_desc(ok)["pass"], ok

    stream, truth, before, after = _first(ref_worlds, "retraction")
    tid = gates._changed_ids(before, after, "salesforce", "tasks")[0]
    orig = next(t for t in before["salesforce"]["tasks"] if t["id"] == tid)["description"]
    for bad in ("RETRACTED?? (not sure) " + orig, orig + " | Not retracted",          # W3, W4
                orig + " | retracted: joined late", "Retracted: joined late | " + orig):
        w = copy.deepcopy(after)
        next(t for t in w["salesforce"]["tasks"] if t["id"] == tid)["description"] = bad
        v = grader.grade(truth, before, w)
        assert not v["pass"] and "retract.description" in {c["name"] for c in v["failed"]}, bad

    stream, truth, before, after = _first(ref_worlds, "week_close")
    n = int(truth["expect"]["slack_post"][0]["text"].rsplit(" ", 1)[-1])
    post_ts = next(x["ts"] for x in after["slack"]["messages"]
                   if x["ts"] not in {y["ts"] for y in before["slack"]["messages"]})

    def with_post(text):
        w = copy.deepcopy(after)
        next(x for x in w["slack"]["messages"] if x["ts"] == post_ts)["text"] = text
        return grader.grade(truth, before, w)
    assert not with_post(f"No-shows this week: {n} (actually {n + 1})")["pass"]                # W9
    assert not with_post(f"No-shows this week: {n}. No-shows this week: {n + 2}")["pass"]
    assert with_post(f"No-shows this week: {n} (Mon-Fri, retractions excluded)")["pass"]
    assert with_post(f"No-shows this week: {n}. No-shows this week: {n}.")["pass"]


def test_oracle_new_task_fields(ref_worlds, grader):
    """W5/W7: a WhatId on another company's account and IsClosed=True on a Not Started task are wrong writes; the
    contact's own account as WhatId stays policy-neutral."""
    stream, truth, before, after = _first(ref_worlds, "act")
    tid = gates._new_ids(before, after, "salesforce", "tasks")[0]

    def graded(**fields):
        w = copy.deepcopy(after)
        next(t for t in w["salesforce"]["tasks"] if t["id"] == tid).update(fields)
        return grader.grade(truth, before, w)
    t = next(t for t in after["salesforce"]["tasks"] if t["id"] == tid)
    own = next(c["account_id"] for c in after["salesforce"]["contacts"] if c["id"] == t["contact_id"])
    other = next(a["id"] for a in after["salesforce"]["accounts"] if a["id"] != own)
    v = graded(related_to_id=other)
    assert not v["pass"] and {c["name"] for c in v["failed"]} == {"task.what-id"}
    v = graded(is_closed=True)
    assert not v["pass"] and {c["name"] for c in v["failed"]} == {"task.is-closed"}
    assert graded(related_to_id=own)["pass"]


def test_oracle_specificity_no_false_rejects():
    g = gates.gate_specificity([610, 611])
    assert g["pass"] and g["variants"] >= 30, g


def test_oracle_token_boundaries():
    assert oracle.has_token("No-shows this week: 12.", "No-shows this week: 12")
    assert not oracle.has_token("No-shows this week: 12", "No-shows this week: 1")
    assert not oracle.has_token("Account pipeline: $1,250,000", "Account pipeline: $1,250")
    assert oracle.has_token("Account pipeline: $1,250 | Repeat no-show", "Account pipeline: $1,250")
    assert not oracle.has_token("s610/t012 cannot decide", "s610/t01")


def test_oracle_exact_string_helpers():
    d = "Scheduled: 2026-08-28 13:30 UTC | Account pipeline: $87,000 | Repeat no-show"
    assert oracle.desc_eq(d, d) and oracle.desc_eq(d + ".", d) and oracle.desc_eq("  " + d.replace(" | ", "   | "), d)
    assert not oracle.desc_eq(d.replace("$87,000", "$87,000.00"), d)
    assert not oracle.desc_eq("Account pipeline: $87,000 | Scheduled: 2026-08-28 13:30 UTC | Repeat no-show", d)
    assert not oracle.desc_eq(d + " | Account pipeline: $1", d) and not oracle.desc_eq(d + "..", d)
    assert oracle.is_retracted(d + oracle.RETRACT_SUFFIX) and oracle.is_retracted(d + oracle.RETRACT_SUFFIX + ".")
    assert not oracle.is_retracted(d + " | Not retracted") and not oracle.is_retracted("Retracted: joined late | " + d)
    assert not oracle.is_retracted(d + " | retracted: joined late")
    tok = "No-shows this week: 3"
    assert oracle.count_post_ok(tok, tok) and oracle.count_post_ok("no-shows this week: 3.", tok)
    assert oracle.count_post_ok(tok + " (week of 2026-08-24, s610/t19, 17:00 UTC)", tok, allow=("s610/t19",))
    for bad in (tok + " (actually 4)", tok + ".5", tok + " of 12", "No-shows this week: 4", tok + "0"):
        assert not oracle.count_post_ok(bad, tok), bad
    assert oracle.RETRACT_SUFFIX == gen.RETRACT_SUFFIX == reference.RETRACT_SUFFIX


def test_end_of_week_is_graded_at_week_close(ref_worlds, grader):
    stream, res = ref_worlds[1]
    truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
    ok = grader.grade(truth, before, after, end=stream["end"], world0=stream["world0"])
    assert ok["pass"] and ok["week"]["pass"] and ok["week"]["n_checks"] >= 3
    assert "week" not in grader.grade(truth, before, after)
    bad = copy.deepcopy(after)              # a handled no-show's flag silently removed during the week
    flagged = stream["end"]["flagged"]
    inv = next(i for i in bad["calendly"]["invitees"] if i["id"] == flagged[-1])
    inv["is_no_show"] = False
    v = grader.grade(truth, before, bad, end=stream["end"], world0=stream["world0"])
    assert not v["week"]["pass"] and any(c["name"] == "end.flags" for c in v["week"]["failed"])
    assert not oracle.verdict_ok(v)


def test_week_close_trigger_is_graded_on_its_post_only(ref_worlds, grader):
    """An earlier act's mistake is charged once, to that act: the week-close trigger with the right post passes, and
    the end-of-week state is a separate week verdict (review 2026-10-21, defect 6)."""
    stream, res = ref_worlds[0]
    truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
    bad = copy.deepcopy(after)
    week = [t for t in bad["salesforce"]["tasks"] if (t["subject"] or "").startswith(gen.SUBJECT_PREFIX)
            and str(t["created_date"]) >= stream["end"]["week_start"]]
    week[0]["priority"] = "Normal" if week[0]["priority"] == "High" else "High"
    b = copy.deepcopy(before)               # the wrong priority was written before the week close (an earlier act)
    next(t for t in b["salesforce"]["tasks"] if t["id"] == week[0]["id"])["priority"] = week[0]["priority"]
    v = grader.grade(truth, b, bad, end=stream["end"], world0=stream["world0"])
    assert v["pass"] and v["outcome"] == "correct", v["failed"]
    assert not v["week"]["pass"] and [c["name"] for c in v["week"]["failed"]] == ["end.week-tasks"]


def test_harness_reports_the_week_apart(dev_runs):
    summary, results = dev_runs["stale-threshold"]
    assert "week_state_ok" in summary and summary["week_state_ok"] < summary["streams"]
    for res in results:
        close = res["rows"][-1]
        assert close["variant"] == "week_close"
        assert not any(c["name"].startswith("end.") for c in close["failed"]), close["failed"]
        assert res["clean_week"] == (all(r["pass"] for r in res["rows"]) and res["week_state"]["pass"])
    assert all(r["rows"][-1]["pass"] for r in results), "stale-threshold posts the right count every week"


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
