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
import probes  # noqa: E402
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


def test_every_d3_week_decides_each_floor_clause():
    """2026-10-21: abuse, bot, crash at 5 stars, Engineering and COMP at 5 stars are decided on every d3 week, and the
    two d3 label weeks amend different parameters (before, both amended Thank-you ratings)."""
    g = gates.gate_clauses(list(range(601, 631)))
    assert g["pass"], g["problems"]
    d3 = [s for s in range(601, 631) if gen.default_difficulty(s) == "d3"]
    assert sorted(g["amend_param"]) == d3 and len(d3) == 14
    for k in L.PARAMS:                                # balanced: 7 weeks each
        assert sum(v == k for v in g["amend_param"].values()) == 7, g["amend_param"]
    assert {gen.generate(s, validate=False)["meta"]["amend_param"] for s in (611, 613)} == set(L.PARAMS)
    for s in (631, 632, 633):                         # forced to d3 (any seed), the floor still holds
        out = gen.generate(s, "d3", validate=False)
        g3 = gen.Gen(s, "d3")
        g3.build_staff()
        g3.history()
        g3.plan_week()
        assert all(any(g3.floor_covers(p, t) for p in g3.plans) for t in gen.FLOOR["d3"]), s
        assert out["meta"]["amend_param"] in L.PARAMS


def test_floor_leaves_d1_streams_alone_and_d2_note_clauses_alone():
    """The d3 clause floor never touches d2; d2 gets only the week floor (a repeat update); d1 nothing."""
    for s in (610, 612, 614):
        m = gen.generate(s, validate=False)["meta"]
        assert m["difficulty"] == "d2" and m["amend_param"] is None
        assert {f["clause"] for f in m["floor"]} <= {"T-repeat:ticket-this-week"}, m["floor"]
    assert gen.generate(611, "d1", validate=False)["meta"]["floor"] == []


def test_week_floor_holds_on_every_week():
    """Review fixes 2026-10-21: every d2/d3 week has an update from a reviewer whose first review that week certainly got a
    ticket (one ticket per reviewer per week), and every d3 week a malformed notification (escalate). Before, 601, 603,
    607, 609 and 610 had no repeat and the d3 dev weeks 611 and 613 no malformed notification."""
    g = gates.gate_clauses(list(range(601, 631)))
    assert g["pass"], g["problems"]
    assert len(g["week_floor"]["repeat"]) == 30 and all(g["week_floor"]["repeat"].values())
    assert sorted(g["week_floor"]["malformed"]) == [s for s in range(601, 631) if gen.default_difficulty(s) == "d3"]
    for s, d in ((631, "d2"), (632, "d3"), (633, "d3"), (634, "d2")):     # forced difficulties too
        out = gen.generate(s, d, validate=False)
        traps = [x for t in out["truth"] for x in t["traps"]]
        assert "T-repeat:ticket-this-week" in traps, (s, d)
        assert (d == "d3") <= any(t["outcome"] == "escalate" for t in out["truth"]), (s, d)
    for s in (610, 611, 612, 613):
        out = gen.generate(s, validate=False)
        rep = [t for t in out["truth"] if "T-repeat:ticket-this-week" in t["traps"]]
        assert rep and all(t["outcome"] == "no-op" and not t["expect"]["tickets"] for t in rep), s


def test_week_floor_converts_reviews_and_keeps_every_other_byte(monkeypatch):
    """The week floor converts existing reviews and draws only from the ...:floor stream: world0 and every trigger it
    does not convert are byte-identical to the stream without it, and the trigger count is unchanged."""
    for s in (601, 610, 611, 613):
        with_floor = gen.generate(s, validate=False)
        monkeypatch.setattr(gen, "WEEK_FLOOR", {"d1": (), "d2": (), "d3": ()})
        without = gen.generate(s, validate=False)
        monkeypatch.undo()
        assert gen.canon(with_floor["world0"]) == gen.canon(without["world0"])
        assert len(with_floor["triggers"]) == len(without["triggers"])
        conv = {f["at"] for f in with_floor["meta"]["floor"] if not f["clause"].startswith("T-note")}
        assert [f for f in with_floor["meta"]["floor"] if f["clause"].startswith("T-note")] == without["meta"]["floor"]
        diff = {a["at"] for a, b in zip(with_floor["triggers"], without["triggers"])
                if gen.canon(a["payload"]) != gen.canon(b["payload"]) or gen.canon(a["delta"]) != gen.canon(b["delta"])}
        assert diff == conv, (s, sorted(diff ^ conv))


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
    "no-abuse": {"T-note:abuse"},
    "no-bot": {"T-note:bot"},
    "crash-rating-only": {"T-note:crash-high-rating"},
    "crash-thanks": {"T-note:crash-high-rating"},
    "eng-email": {"T-note:eng-high"},
    "comp-email": {"T-note:comp-high"},
    "eng-no-ticket": {"T-note:eng-low"},
    "comp-no-ticket": {"T-note:comp-low"},
    "base-forms": {"T-format:crash-form"},
    "no-escalate": {"escalate"},
    "ticket-amend-ignored": {"T-authority:after-dev-skip3", "ticket"},
    "thanks-amend-ignored": {"T-authority:after-mkt-thank4", "none"},
    "oldest-amendment": {"thanks"},
    "week-count": {"close"},
    "reply-requester": {"unauthorized"},
    "any-poster-code": {"ticket", "ticket-high", "close"},
    "updated-ignored": {"T-repeat:updated-positive", "T-repeat:updated-negative", "T-stale:last-week-ticket"},
}


@pytest.mark.parametrize("name", sorted(EXPECTED_FAILURE))
def test_plausible_controls_fail_for_their_rule(dev_runs, name):
    """Each plausible-but-wrong control is rejected on the triggers where its broken rule applies (not only through a
    later cascade)."""
    want = EXPECTED_FAILURE[name]
    _, results = dev_runs[name]
    hits = [r for res in results for r in res["rows"] if not r["pass"] and (want & set(r["traps"]) or r["variant"] in want)]
    assert hits, f"{name} never fails on {sorted(want)}"


@pytest.mark.parametrize("name", sorted(gates.FLOOR_CONTROLS))
def test_floor_controls_fail_every_d3_dev_week(dev_runs, name):
    """A control that breaks a floor clause fails on both d3 dev weeks, on a review carrying that clause."""
    clause = f"T-note:{gates.FLOOR_CONTROLS[name]}"
    _, results = dev_runs[name]
    for res in results:
        if res["difficulty"] == "d3":
            assert any(not r["pass"] and clause in r["traps"] for r in res["rows"]), (name, res["seed"])


@pytest.mark.parametrize("name", sorted(gates.WEEK_FLOOR_CONTROLS))
def test_week_floor_controls_fail_every_dev_week(dev_runs, name):
    """Review fixes 2026-10-21: no-dedupe fails on every dev week and no-escalate on every d3 dev week, each on its own trap (before,
    no-dedupe passed 610 and no-escalate passed both d3 dev weeks)."""
    trap, diffs = gates.WEEK_FLOOR_CONTROLS[name]
    _, results = dev_runs[name]
    for res in results:
        if res["difficulty"] in diffs:
            assert any(not r["pass"] and trap in r["traps"] for r in res["rows"]), (name, res["seed"])


def test_amendment_controls_fail_on_their_parameter_week(dev_runs):
    weeks = {gen.generate(s, validate=False)["meta"]["amend_param"]: s for s in (611, 613)}
    for name, param in (("ticket-amend-ignored", "Ticket ratings"), ("thanks-amend-ignored", "Thank-you ratings")):
        _, results = dev_runs[name]
        assert not next(r for r in results if r["seed"] == weeks[param])["clean_week"], name


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


def test_oracle_rejects_hedged_summaries_and_deleted_posts(ref_worlds, grader):
    """2026-10-21: a summary that also states other counts or another code, and an acknowledgement or escalation
    post deleted again in the same trigger, are rejected; other wording around the summary line is accepted."""
    stream, res = ref_worlds[1]                       # 611 (d3): has an amendment and closes
    seen = set()
    for truth, before, after in zip(stream["truth"], res["befores"], res["afters"]):
        if truth["variant"] == "close" and "summary" not in seen:
            line = truth["expect"]["emails"][0]["body"]
            code, rest = line.split(": ", 1)
            mid = gates._new(before, after, "gmail", "messages")[0]
            # review fixes 2026-10-21: POLICY.md §4 now makes the line the only place for ticket or thank-you figures, so the same
            # counts again and "2 tickets reopened" are rejected too (they were accepted before)
            for extra, ok in ((f"\nToday so far: {rest}", False),                      # the same counts again
                              ("\nWeek so far: 40 reviews read, 2 tickets reopened.", False),
                              ("\nWeek so far: 40 reviews read, 3 escalations.", True),
                              ("\n\nThank you,\nThe review triage automation", True),
                              (f"\n{code}: tickets 99, thank-yous 0", False),
                              ("\nOr maybe: tickets 0, thank-yous 0", False),
                              (f"\nTRIAGE-100-W01: {rest}", False)):
                w = copy.deepcopy(after)
                m = gates._find(w, "gmail", "messages", mid)
                m["body_plain"] += extra
                assert grader.grade(truth, before, w)["pass"] is ok, extra
            seen.add("summary")
        if truth["expect"]["slack"] and "deleted" not in seen:
            w = copy.deepcopy(after)
            ts = gates._new_slack(before, after)[0]
            gates._slack(w, ts)["is_deleted"] = True
            v = grader.grade(truth, before, w)
            assert not v["pass"] and {"post #app-reviews", "envelope"} <= {c["name"] for c in v["failed"]}
            seen.add("deleted")
    assert seen == {"summary", "deleted"}


# review fixes 2026-10-21 (medium): hedges in other words passed; the rule now applies to meaning, POLICY.md §4 states it
SUMMARY_LINE = "TRIAGE-412-W10: tickets 3, thank-yous 5"
SUMMARY_ACCEPT = [
    SUMMARY_LINE,
    SUMMARY_LINE + ".",
    f"Hi team,\n\n{SUMMARY_LINE}\n\nThanks,\nReview Triage Automation",
    f"Hello App Review Team,\n\nHere is the daily review triage summary for 2026-03-04.\n\n{SUMMARY_LINE}\n\nBest regards",
    f"Daily summary (2026-03-04, 17:00 UTC)\n\n**{SUMMARY_LINE}**\n\nThank you,\nAutomation",
    f"# Review triage summary 2026-03-04\n\n- {SUMMARY_LINE}\n",
    f"<html><body><p>Hi team,</p><p>{SUMMARY_LINE}</p><p>Kind regards</p></body></html>",
    f"<div>Summary:</div><div><b>{SUMMARY_LINE}</b></div>",
    f"Summary for today:\n{SUMMARY_LINE}\nNo escalations today.",
    f"{SUMMARY_LINE}\n\nPolicy in force: Ticket ratings = 1-3 (amended by Product on 2026-03-02), Thank-you ratings = 4-5.",
    f"{SUMMARY_LINE}\n\nQuestions? Reply to this email or ask in #app-reviews if anything looks wrong.",
    f"{SUMMARY_LINE}\n\nWeek so far: 40 reviews read, 3 escalations.",
    f"{SUMMARY_LINE}\n{SUMMARY_LINE}",
    f"| {SUMMARY_LINE} |",
    f"> `{SUMMARY_LINE}`",
    f"Summary for TRIAGE-412-W10\n\n{SUMMARY_LINE}\n\nThank you for your attention.",
    f"{SUMMARY_LINE}\nReply if you need more detail.",                       # weak hedge words without a number
    f"{SUMMARY_LINE}\nIf you have questions about these tickets, reply here.",
    f"{SUMMARY_LINE}\nTickets are likely to be triaged tomorrow.",
]
SUMMARY_REJECT = [
    f"{SUMMARY_LINE} (or one more ticket if the late crash review counts)",                       # W-hedge-inline
    f"{SUMMARY_LINE}\nRecount pending: possibly tickets 4 and thank-yous 6 once late reviews are included.",  # W-hedge
    f"{SUMMARY_LINE}\nRecount pending: possibly 4 and 6 once late reviews are in.",
    f"{SUMMARY_LINE}\nThese counts may be off by one.",
    f"{SUMMARY_LINE}\nWeek to date: tickets 9, thank-yous 14",                                    # review (low)
    f"{SUMMARY_LINE}\nToday we opened 3 tickets and sent 5 thank-you emails.",
    f"Counts: {SUMMARY_LINE}",
    f"{SUMMARY_LINE}\nCorrection: tickets 4",
    f"{SUMMARY_LINE}\nNote: one more ticket may arrive late.",
    f"{SUMMARY_LINE}\nThe ticket count could be 4.",
    f"{SUMMARY_LINE}\nAt least 3 tickets, possibly more.",
    f"{SUMMARY_LINE}\nThe numbers above are preliminary.",
    f"{SUMMARY_LINE}\nTotals may change after the late reviews.",
    f"{SUMMARY_LINE}\n(4 if you count the late crash review)",
    f"{SUMMARY_LINE}\nThank-yous: 6 (revised)",
    f"{SUMMARY_LINE}\nAlso: 2 tickets reopened.",
    f"{SUMMARY_LINE}\nTRIAGE-100-W01: tickets 3, thank-yous 5",
    f"{SUMMARY_LINE}?",
    f"{SUMMARY_LINE} or 6",
    f"{SUMMARY_LINE}\nEither way, 3 or 4.",
    "triage-412-w10: tickets 3, thank-yous 5",                                                    # review (low): case
    f"{SUMMARY_LINE}\nTickets may need a recount.",                          # correction words need no number
    f"{SUMMARY_LINE}\nThe total may be higher.",
    f"{SUMMARY_LINE}\nThank-yous: revised count to follow.",
]


@pytest.mark.parametrize("body", SUMMARY_ACCEPT)
def test_summary_rule_accepts_policy_neutral_wording(body):
    assert oracle.summary_problems(oracle.body_text({"body_plain": body}), SUMMARY_LINE) == []


@pytest.mark.parametrize("body", SUMMARY_REJECT)
def test_summary_rule_rejects_hedges_and_second_figures(body):
    assert oracle.summary_problems(oracle.body_text({"body_plain": body}), SUMMARY_LINE)


def test_ticket_subject_case_is_exact_except_the_address(ref_worlds, grader):
    """Review fixes 2026-10-21 (low): a lower-cased code or prefix passed every check; the address may be in any case."""
    stream, res = ref_worlds[0]
    truth, before, after = next((t, b, a) for t, b, a in zip(stream["truth"], res["befores"], res["afters"])
                                if t["expect"]["tickets"])
    tid = gates._new(before, after, "hubspot", "tickets")[0]
    subj = gates._find(after, "hubspot", "tickets", tid)["subject"]
    code, addr = subj.split(" - ")[-1], subj.split(" - ")[1]
    for new, ok in ((subj.replace(code, code.lower()), False), (subj.replace("App review", "app review"), False),
                    (subj.lower(), False), (subj.replace(addr, addr.upper()), True), ("  " + subj + " ", True)):
        w = copy.deepcopy(after)
        gates._find(w, "hubspot", "tickets", tid)["subject"] = new
        assert grader.grade(truth, before, w)["pass"] is ok, new


@pytest.fixture(scope="module")
def probe_runs(grader):
    """Every oracle probe (probes.py) on a d2 and both d3 dev label streams, carry mode, real tool path."""
    streams = {s: gen.generate(s) for s in (610, 611, 613)}
    return {name: [harness.run_stream(streams[s], fn, grader=grader) for s in streams]
            for name, fn in probes.PROBES.items()}


@pytest.mark.parametrize("name", sorted(probes.WRONG))
def test_wrong_probes_are_rejected_on_their_own_triggers(probe_runs, name):
    """The review's rejected wrong outputs (paraphrased content, ack in the wrong channel or for an unauthorized
    request, yesterday's summary, escalate-and-act) and the ones the fixes added (hedges, week-to-date, a lower-cased code
    or subject, the comment in another property): each fails, and on its own kind of trigger."""
    runs = probe_runs[name]
    rows = [x for r in runs for x in r["rows"]]
    assert not any(x["error"] for x in rows), name
    assert not all(x["pass"] for x in rows) and not all(r["clean_week"] for r in runs), name
    want = probes.WRONG_ON[name]
    for r in runs:
        mine = [x for x in r["rows"] if x["variant"] == want]
        if mine and want != "any":
            assert any(not x["pass"] for x in mine), (name, r["seed"])


@pytest.mark.parametrize("name", sorted(probes.CORRECT))
def test_correct_probes_pass_every_trigger(probe_runs, name):
    """The review's accepted variants (C-styled, C-housekeeping, C-thread-reply) and three more (an HTML summary, a
    summary with a greeting, sign-off and other figures, an upper-case address in the subject)."""
    for r in probe_runs[name]:
        assert r["clean_week"], (name, r["seed"], [(x["taskKey"], [c["name"] + ": " + c["detail"][:80] for c in x["failed"]])
                                                    for x in r["rows"] if not x["pass"]][:3])


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
    # review fixes 2026-10-21: the strictness the oracle applies is stated (review findings: hedges, week-to-date figures, case,
    # the ticket property)
    flat = " ".join(policy.split())
    for s in ["on a line of its own", "the only place the summary gives ticket or thank-you figures",
              "no week-to-date figures", "no alternative, estimate, correction or recount",
              "Copy the code exactly as posted, letter case included", "letter case included (`[HIGH PRIORITY]`",
              "Only the reviewer address may be in any case", "the HubSpot ticket property `content`"]:
        assert s in flat, s


def test_family_json_matches_code():
    assert FAMILY["id"] == gen.FAMILY and FAMILY["version"] == gen.VERSION
    assert FAMILY["apps"] == list(gen.APPS)
    assert FAMILY["controls"] == gates.BAD_CONTROLS
    assert {g["task"] for g in FAMILY["grounding"]} == {"marketing.app_review_triage", "marketing.social_comment_response_queue"}
    assert [a["parameter"] for a in FAMILY["amendable"]] == list(L.PARAMS)
    for f in FAMILY["files"].values():
        assert (FAMILY_DIR / f).exists(), f
