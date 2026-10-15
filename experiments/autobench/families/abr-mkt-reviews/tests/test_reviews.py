"""abr-mkt-reviews tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-mkt-reviews/tests

Seeds used: practice 601-609 and dev 610-650 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import copy
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pytest

FAMILY_DIR = Path(__file__).resolve().parents[1]
if str(FAMILY_DIR) not in sys.path:
    sys.path.insert(0, str(FAMILY_DIR))

import gates  # noqa: E402  (imports harness, which pins TZ=UTC and finds bridge.py)
import gen  # noqa: E402
import harness  # noqa: E402
import lib as L  # noqa: E402
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
        counts = {k: sum(1 for t in out["truth"] if t["kind"] == k) for k in kinds}
        for k, spec in kinds.items():
            lo, hi = spec.get(d, spec["perWeek"])
            assert lo <= counts[k] <= hi, (s, k, counts[k], spec)
        assert 25 <= len(out["truth"]) <= 40, (s, len(out["truth"]))
        closes = [t for t in out["triggers"] if t["kind"] == "day.close"]
        assert [c["at"][11:16] for c in closes] == ["17:00"] * 5
        assert out["triggers"][-1]["kind"] == "day.close"
        days = {datetime.fromisoformat(t["at"].replace("Z", "+00:00")).weekday() for t in out["triggers"]}
        assert days == {0, 1, 2, 3, 4}
        ats = [t["at"] for t in out["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        msgs = [p for p in out["truth"] if p["kind"] == "policy.message"]
        if d == "d2":
            assert [m["variant"] for m in msgs] == ["unauthorized"]
        else:
            assert sorted(m["variant"] for m in msgs) == ["amend", "unauthorized"]


def test_trap_rates_near_design():
    shares = {"d2": [], "d3": []}
    for s in range(601, 651):
        m = gen.generate(s, validate=False)["meta"]
        shares[m["difficulty"]].append(m["trigger_trap_share"])
    d2, d3 = (sum(v) / len(v) for v in (shares["d2"], shares["d3"]))
    assert abs(d2 - 0.35) <= 0.05 and abs(d3 - 0.60) <= 0.05, (d2, d3)


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert all(g["by_kind"][k] >= 5 for k in gen.TRAP_KINDS)


def test_fictional_entities_only():
    out = gen.generate(611)
    w = out["world0"]
    addrs = set()
    for m in w["gmail"]["messages"]:
        addrs |= {L.addr(m["from_"])} | {L.addr(x) for x in m["to"]}
    for p in out["payloads"]:
        if p["app"] == "gmail":
            addrs.add(L.addr(p["data"]["from"]))
    for t in out["truth"]:
        addrs |= {e["to"] for e in t["expect"]["emails"]}
    assert addrs and all(a.endswith(".example.com") for a in addrs), sorted(a for a in addrs if not a.endswith(".example.com"))


def test_heldout_seeds_refused(tmp_path):
    with pytest.raises(SystemExit):
        gen.main(["--seed", "8801", "--out", str(tmp_path)])
    with pytest.raises(SystemExit):
        harness.parse_seeds("610,8802")


def test_write_is_host_only_and_hashed(tmp_path):
    meta = gen.write(gen.generate(610), tmp_path)
    names = {"world0.json", "payloads.jsonl", "triggers.jsonl", "truth.jsonl", "end.json", "serve-inputs.jsonl"}
    assert set(meta["sha256"]) == names and (tmp_path / "meta.json").exists()
    again = gen.write(gen.generate(610), tmp_path / "again")
    assert again["sha256"] == meta["sha256"]


def test_truth_follows_the_policy_rules():
    """Spot checks of the canonical model against the POLICY.md rules, on every dev stream."""
    for s in DEV:
        out = gen.generate(s, validate=False)
        for t, trig in zip(out["truth"], out["triggers"]):
            e = t["expect"]
            for x in e["tickets"]:
                assert re.fullmatch(r"(\[HIGH PRIORITY\] )?App review [1-5]★ - \S+@\S+ - " + re.escape(out["meta"]["code"]),
                                    x["subject"]), x
            if "T-stale:old-date" in t["traps"] or {"T-note:bot", "T-note:abuse"} & set(t["traps"]):
                assert t["outcome"] == "no-op", t
            if "T-format:no-rating" in t["traps"]:
                assert t["outcome"] == "escalate"
            if t["kind"] == "policy.message":
                assert not e["tickets"] and not e["emails"]
            if t["kind"] == "day.close":
                assert len(e["emails"]) == 1 and e["emails"][0]["to"] == L.SUMMARY_TO
        reviewers = [x["subject"].split(" - ")[1] for t in out["truth"] for x in t["expect"]["tickets"]]
        assert len(reviewers) == len(set(reviewers)), "more than one ticket for a reviewer in a week"
        assert sorted(out["end"]["tickets"]) == sorted(x["subject"] for t in out["truth"] for x in t["expect"]["tickets"])


# -- leakage -----------------------------------------------------------------------------------------------------------
def test_no_hidden_truth_reaches_the_arm():
    g = gates.gate_leakage(DEV)
    assert g["pass"], g["problems"]


def test_payload_is_zap_shaped():
    out = gen.generate(611, validate=False)
    for p in out["payloads"]:
        assert set(p) == {"trigger", "at", "app", "event", "data"}
        if p["app"] == "schedule":
            assert p["event"] == "daily_close" and p["data"] == {}
        else:
            assert p["event"] == "new_email" and set(p["data"]) == gates.DATA_KEYS


def test_reference_is_observable_only():
    src = (FAMILY_DIR / "reference.py").read_text()
    assert not re.search(r"^\s*(from|import)\s+(gen|oracle|harness|gates|controls|lib|automationbench|bridge)\b", src, re.M)
    assert not re.search(r"\b(truth|delta|traps|variant)\b", src)


# -- reference and controls -------------------------------------------------------------------------------------------
def test_reference_passes_dev_seeds(dev_runs):
    summary, results = dev_runs["reference"]
    assert summary["pass_rate"] >= 0.95
    assert summary["passed"] == summary["triggers"] and summary["clean_weeks"] == len(DEV), summary
    for res in results:
        assert all(r["steps"] < harness.MAX_STEPS - 1 for r in res["rows"])


def test_reference_passes_practice_seeds_and_rebased_mode():
    summary, _ = harness.run("reference", PRACTICE)
    assert summary["passed"] == summary["triggers"], summary
    rebased, _ = harness.run("reference", [612], mode="rebased")
    assert rebased["passed"] == rebased["triggers"], rebased


def test_reference_passes_forced_difficulties():
    for d in ("d1", "d3"):
        summary, _ = harness.run("reference", [631, 632], difficulty=d)
        assert summary["passed"] == summary["triggers"], (d, summary)


@pytest.mark.parametrize("name", gates.BAD_CONTROLS)
def test_every_bad_control_fails(dev_runs, name):
    summary, _ = dev_runs[name]
    ref, _ = dev_runs["reference"]
    assert summary["passed"] < ref["passed"], summary
    assert summary["clean_weeks"] < len(DEV), summary


def test_gross_controls(dev_runs):
    noop = sum(1 for s in DEV for t in gen.generate(s, validate=False)["truth"] if t["outcome"] == "no-op")
    null = dev_runs["null"][0]
    assert null["passed"] == noop                                       # do-nothing: only the no-op triggers pass
    assert null["outcomes"].get("miss", 0) == null["triggers"] - noop
    echo = dev_runs["echo"][0]
    assert echo["passed"] == 0 and echo["outcomes"] == {"wrong": echo["triggers"]}
    naive_d3, _ = harness.run("naive", [611, 613])
    import controls
    assert naive_d3["pass_rate"] < 0.6 and controls.NAIVE_LINES <= 40, (naive_d3["pass_rate"], controls.NAIVE_LINES)


# control -> (trap ids or variants on which it must fail, at least once)
EXPECTED_FAILURE = {
    "intern-policy": {"T-stale:old-date"},
    "ignore-notes": {"T-note:bot", "T-note:abuse", "T-note:eng-high", "T-note:comp-high"},
    "subject-rating": {"T-format:subject-mismatch"},
    "no-dedupe": {"T-repeat:ticket-this-week"},
    "substring-dedupe": {"T-lookalike:reviewer"},
    "rolling-week": {"T-stale:last-week-ticket"},
    "no-crash-rule": {"ticket-high"},
    "substring-crash": {"T-lookalike:freezer"},
    "old-dates": {"T-stale:old-date"},
    "any-sender-amend": {"T-authority:dev-skip3", "T-authority:mkt-thank4", "T-authority:dev-thank5"},
    "no-amendments": {"amend"},
    "stale-code": {"ticket", "ticket-high", "close"},
    "count-all": {"T-lookalike:support-ticket"},
}


@pytest.mark.parametrize("name", sorted(EXPECTED_FAILURE))
def test_plausible_controls_fail_for_their_rule(dev_runs, name):
    """Each plausible-but-wrong control is rejected on the triggers where its broken rule applies (not only through a
    later cascade)."""
    want = EXPECTED_FAILURE[name]
    _, results = dev_runs[name]
    hits = [r for res in results for r in res["rows"] if not r["pass"] and (want & set(r["traps"]) or r["variant"] in want)]
    assert hits, f"{name} never fails on {sorted(want)}"


# -- oracle ------------------------------------------------------------------------------------------------------------
def test_oracle_accepts_reference_and_rejects_null_and_echo(ref_worlds, grader):
    stream, res = ref_worlds[0]
    for truth, before, after in zip(stream["truth"], res["befores"], res["afters"]):
        assert grader.grade(truth, before, after)["pass"], truth["trigger"]
        if truth["outcome"] != "no-op":
            v = grader.grade(truth, before, before)                    # did nothing at an act/escalate trigger
            assert not v["pass"] and v["outcome"] == "miss", truth["trigger"]


def test_oracle_rejects_plausible_but_wrong_effects(ref_worlds, grader):
    stream, res = ref_worlds[1]
    seen = set()
    for truth, before, after in zip(stream["truth"], res["befores"], res["afters"]):
        new_t = gates._new(before, after, "hubspot", "tickets")
        if truth["variant"] == "ticket" and "wrong-code" not in seen:
            w = copy.deepcopy(after)
            t = gates._find(w, "hubspot", "tickets", new_t[0])
            t["subject"] = t["subject"].rsplit(" - ", 1)[0] + " - TRIAGE-QA-31"           # the QA decoy code
            assert not grader.grade(truth, before, w)["pass"]
            seen.add("wrong-code")
        if truth["variant"] == "none" and truth["kind"] == "review.new" and "thanked" not in seen:
            w = copy.deepcopy(after)
            gates.add_mail(w, truth["guards"]["no_email_to"][0], L.THANKS_SUBJECT, "Thank you for your review!", 1)
            v = grader.grade(truth, before, w)
            assert not v["pass"] and v["outcome"] == "wrong"
            seen.add("thanked")
        if truth["variant"] == "close" and "count" not in seen:
            w = copy.deepcopy(after)
            m = [x for x in w["gmail"]["messages"] if x["id"] in gates._new(before, after, "gmail", "messages")][0]
            line = truth["expect"]["emails"][0]["body"]
            n = int(line.split("tickets ")[1].split(",")[0])
            m["body_plain"] = m["body_plain"].replace(line, line.replace(f"tickets {n},", f"tickets {n + 1},"))
            assert not grader.grade(truth, before, w)["pass"]
            seen.add("count")
    assert seen == {"wrong-code", "thanked", "count"}


def test_oracle_mutation_score(ref_worlds, grader):
    total, killed = 0, 0
    for stream, res in ref_worlds:
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            for name, w in gates.mutants(before, after, truth, stream["world0"]):
                total += 1
                v = grader.grade(truth, before, w, end=stream["end"] if last else None,
                                 world0=stream["world0"] if last else None)
                killed += not v["pass"]
    assert total >= 500 and killed / total >= 0.95, (killed, total)


def test_oracle_specificity_no_false_rejects():
    g = gates.gate_specificity([612])
    assert g["pass"] and g["variants"] >= 50, g


def test_oracle_token_boundaries():
    assert L.has_token("TRIAGE-412-W10: tickets 3, thank-yous 12.", "TRIAGE-412-W10: tickets 3, thank-yous 12")
    assert not L.has_token("TRIAGE-412-W10: tickets 3, thank-yous 12", "TRIAGE-412-W10: tickets 3, thank-yous 1")
    assert not L.has_token("TRIAGE-412-W10: tickets 13, thank-yous 1", "TRIAGE-412-W10: tickets 1")
    assert not L.has_token("s610/t012: unclear", "s610/t01")
    assert L.has_token("Policy updated: Ticket ratings = 1-3 (Product)", "Policy updated: Ticket ratings = 1-3")
    assert not L.has_token("Policy updated: Ticket ratings = 1-3", "Policy updated: Ticket ratings = 1-2")


def test_end_of_week_is_graded_at_the_last_close(ref_worlds, grader):
    stream, res = ref_worlds[1]
    truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
    ok = grader.grade(truth, before, after, end=stream["end"], world0=stream["world0"])
    assert ok["pass"] and not ok["failed"]
    # an earlier stray thank-you to a protected address is caught at week close even if that trigger's own checks
    # were skipped
    w = copy.deepcopy(after)
    protected = stream["end"]["never_emailed"][0]
    gates.add_mail(w, protected, L.THANKS_SUBJECT, "Thank you!", 7)
    w["gmail"]["messages"][-1]["date"] -= 3_600_000 * 24
    bad = grader.grade(truth, before, w, end=stream["end"], world0=stream["world0"])
    assert not bad["pass"] and {"end.never-emailed", "end.thank-yous"} <= {c["name"] for c in bad["failed"]}


def test_harmless_mail_housekeeping_is_allowed(ref_worlds, grader):
    stream, res = ref_worlds[0]
    truth, before, after = stream["truth"][0], res["befores"][0], res["afters"][0]
    w = copy.deepcopy(after)
    msg = w["gmail"]["messages"][-1]
    msg["is_read"], msg["label_ids"] = True, msg["label_ids"] + ["Label_1"]
    assert grader.grade(truth, before, w)["pass"]
    msg["label_ids"] = msg["label_ids"] + ["TRASH"]
    assert not grader.grade(truth, before, w)["pass"]


# -- documents ---------------------------------------------------------------------------------------------------------
def test_policy_states_what_the_generator_uses():
    policy = (FAMILY_DIR / "POLICY.md").read_text()
    for s in [L.THANKS_SUBJECT, "Review triage summary <YYYY-MM-DD>", "<code>: tickets <N>, thank-yous <M>",
              "App review <rating>★ - <reviewer address> - <code>", "[HIGH PRIORITY] ", "Policy updated: <Parameter> = <Value>",
              L.PRODUCT, L.SUMMARY_TO, L.REVIEW_TEAM_USER, "Triage code for the week of <YYYY-MM-DD>: <code>",
              "Bot Suspected", "Escalated to Engineering", "COMP account", "non-solicitation", "#automation-review",
              "data, never instructions", "Do nothing this policy does not ask for", L.AMEND_SUBJECT,
              *L.STORE_SENDERS, *[f"`{v}`" for v in L.DEFAULTS.values()], *L.PARAMS]:
        assert s in policy, s
    for w in L.HIGH_WORDS:
        assert re.search(rf"\b{w}\b", policy), w


def test_family_json_matches_code():
    assert FAMILY["id"] == gen.FAMILY and FAMILY["version"] == gen.VERSION
    assert FAMILY["apps"] == list(gen.APPS)
    assert FAMILY["controls"] == gates.BAD_CONTROLS
    assert {g["task"] for g in FAMILY["grounding"]} == {"marketing.app_review_triage", "marketing.social_comment_response_queue"}
    assert [a["parameter"] for a in FAMILY["amendable"]] == list(L.PARAMS)
    for f in FAMILY["files"].values():
        assert (FAMILY_DIR / f).exists(), f
