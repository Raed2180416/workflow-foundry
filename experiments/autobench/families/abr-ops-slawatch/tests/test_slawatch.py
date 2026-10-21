"""abr-ops-slawatch tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-ops-slawatch/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import copy
import json
import re
import sys
from datetime import timedelta
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

# Which planted traps each plausible-but-wrong control is built to fall for (its failures must include them).
CONTROL_TRAPS = {
    "no-hold": {"T-note:legal-hold"},
    "utc-naive": {"T-format:offset"},
    "status-blind": {"T-repeat:closed-duplicate", "T-note:waiting"},
    "no-reassign": {"T-repeat:reassigned"},
    "warn-once": {"T-repeat:extended"},
    "strict-window": {"T-timing:exact-window", "T-timing:exact-deadline"},
    "raw-phone": {"T-format:phone"},
    "any-amendment": {"T-authority:unauthorized-amendment", "T-lookalike:sender"},
    "fixed-window": {"T-stale:window-amended"},
    "eager": {"T-timing:eager-open", "T-timing:eager-update"},
    "memoryless": {"T-repeat:reassigned", "T-repeat:reopened-late", "T-stale:window-straddle"},
    "no-escalate": {"T-format:unreadable-phone", "T-authority:out-of-range-amendment"},
}
# Controls that may reach 95% per trigger because the rule they break bites on few triggers a week; each still keeps
# no week (or almost no week) clean, which is this family's headline.
NEAR_MISS = ("no-reassign", "warn-once", "any-amendment", "slack-dedupe", "no-hold", "no-escalate")


@pytest.fixture(scope="module")
def grader():
    return oracle.Grader()


@pytest.fixture(scope="module")
def streams():
    return {s: gates.stream(s) for s in DEV}


@pytest.fixture(scope="module")
def dev_runs(streams):
    """(summary, per-stream results) for the reference and every bad control on the five dev streams."""
    out = {"reference": harness.run("reference", DEV, streams=streams)}
    for name in gates.BAD_CONTROLS:
        out[name] = harness.run(name, DEV, streams=streams)
    return out


@pytest.fixture(scope="module")
def ref_worlds(grader, streams):
    """The reference's per-trigger world_before / world_after on one d2 and one d3 dev stream."""
    return [(streams[s], harness.run_stream(streams[s], reference.handle, grader=grader, keep_worlds=True)) for s in (610, 611)]


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
        assert 50 <= len(trig) <= 60, (s, len(trig))
        assert [t["trigger"] for t in trig] == [f"s{s}/t{i:02d}" for i in range(1, len(trig) + 1)]
        ats = [L.parse_instant(t["at"]) for t in trig]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        ticks = [a for t, a in zip(trig, ats) if t["kind"] == "tick"]
        assert len(ticks) == 40 and all(a.weekday() < 5 and 10 <= a.hour <= 17 and a.minute == 0 for a in ticks)
        assert trig[-1]["kind"] == "tick" and ats[-1].weekday() == 4 and ats[-1].hour == 17
        assert all(t["kind"] == "tick" or a.minute != 0 for t, a in zip(trig, ats))
        n = {k: sum(1 for t in trig if t["kind"] == k) for k in kinds}
        for k, spec in kinds.items():
            lo, hi = spec.get(d, spec["perWeek"])
            assert lo <= n[k] <= hi, (s, k, n[k], (lo, hi))
        w0 = out["world0"]
        open0 = [r for r in w0["google_sheets"]["spreadsheets"][0]["worksheets"][0]["rows"]
                 if r["cells"]["Status"].strip().lower() in ("open", "in progress", "waiting on customer")]
        assert 10 <= len(open0) <= 14 + 2, (s, len(open0))       # + closed-duplicate bases and open look-alikes


def test_generator_refuses_heldout_seeds():
    with pytest.raises(SystemExit):
        gen.main(["--seed", "8801", "--out", "/nonexistent"])
    with pytest.raises(SystemExit):
        harness.parse_seeds("8801-8804")


def test_write_files_and_hashes(tmp_path):
    meta = gen.write(gen.generate(610), tmp_path)
    for f in ("world0.json", "payloads.jsonl", "triggers.jsonl", "truth.jsonl", "end.json", "serve-inputs.jsonl", "meta.json"):
        assert (tmp_path / f).exists()
    assert set(meta["sha256"]) == {"world0.json", "payloads.jsonl", "triggers.jsonl", "truth.jsonl", "end.json", "serve-inputs.jsonl"}
    payloads = [json.loads(x) for x in (tmp_path / "payloads.jsonl").read_text().splitlines()]
    assert all(set(p) == gates.PAYLOAD_KEYS for p in payloads)


def test_leakage():
    g = gates.gate_leakage(DEV)
    assert g["pass"], g["problems"]


def test_policy_states_every_literal_the_oracle_checks():
    policy = (FAMILY_DIR / "POLICY.md").read_text()
    for lit in ("SLA warning <Ticket ID>: due <HH:MM> UTC", "<Ticket ID> \\| <Subject> \\| due <HH:MM> UTC \\| <Assigned Agent>",
                "`BREACHED <Ticket ID>`", "`SLA breach <Ticket ID>`", "`SLA warning <Ticket ID>`", L.SMS_FROM, "`SUPPORT`",
                "`Warning window`", L.MANAGER, "Warned Deadline", "ws-open-tickets", "#support-escalation", "#automation-review",
                "60 to 180"):
        assert lit in policy, lit


def test_hard_requirements_are_typed():
    assert FAMILY["hardRequirements"] == ["schedule", "durable-wait"]
    assert FAMILY["controls"] == gates.BAD_CONTROLS


def test_trap_coverage_and_rates():
    g = gates.gate_traps(gates.LABEL)
    assert g["pass"], g["short"]
    shares = {}
    for s in range(601, 631):
        m = gates.stream(s)["meta"] if s in gates._STREAMS else gen.generate(s, validate=False)["meta"]
        shares.setdefault(m["difficulty"], []).append(m["trigger_trap_share"])
    mean = {d: sum(v) / len(v) for d, v in shares.items()}
    # design: 40% / 70%. Since 1.1.0 the state stories expose traps at more checks, so d2 runs near 50% (README)
    assert 0.35 <= mean["d2"] <= 0.55 and 0.6 <= mean["d3"] <= 0.8, mean


def test_generator_plants_state_dependent_triggers():
    """Since 1.1.0 every stream has several triggers whose correct handling needs the tracker's state columns: the
    generator's memoryless counterfactual (clock only, no state read) acts differently there."""
    per = {}
    for s in PRACTICE + DEV:
        m = gates.stream(s)["meta"] if s in gates._STREAMS else gen.generate(s, validate=False)["meta"]
        per[s] = (m["difficulty"], m["needs_state"])
    assert all(n >= 4 for _, n in per.values()), per
    assert sum(n for _, n in per.values()) / len(per) >= 6, per


def test_escalations_are_generated(streams):
    """POLICY.md section 7 is exercised: every stream has a ticket whose phone cannot be read (escalated at each check
    that would warn it), and every d3 stream an out-of-range amendment from the support manager (escalated once)."""
    for s, out in streams.items():
        esc = [t for t in out["truth"] if t["expect"]["escalate"]]
        assert any(t["kind"] == "tick" for t in esc), s
        assert all(t["outcome"] in ("escalate", "act") for t in esc)
        assert all("T-format:unreadable-phone" in t["traps"] for t in esc if t["kind"] == "tick")
        amend = [t for t in out["truth"] if t["kind"] == "policy.amendment"]
        if out["meta"]["difficulty"] == "d3":
            oor = [t for t in amend if t["sub"] == "out-of-range"]
            assert len(oor) == 1 and oor[0]["expect"]["escalate"] and oor[0]["outcome"] == "escalate", s
            assert "T-authority:out-of-range-amendment" in oor[0]["traps"]


def test_truth_is_mostly_quiet_checks_with_effects_on_some(streams):
    for s, out in streams.items():
        ticks = [t for t in out["truth"] if t["kind"] == "tick"]
        act = sum(1 for t in ticks if t["outcome"] == "act")
        assert 10 <= act <= 30 and len(ticks) - act >= 10, (s, act)
        assert all(t["outcome"] == "no-op" for t in out["truth"] if t["kind"] in ("ticket.opened", "ticket.updated"))
        for t in out["truth"]:
            if t["kind"] == "policy.amendment":
                assert t["outcome"] == {"authorized": "act", "unauthorized": "no-op", "out-of-range": "escalate"}[t["sub"]]


# -- reference and gates ------------------------------------------------------------------------------------------------
def test_reference_passes_the_dev_gate(dev_runs):
    summary, results = dev_runs["reference"]
    assert summary["pass_rate"] >= 0.95, summary
    assert summary["passed"] == summary["triggers"] and summary["clean_weeks"] == len(DEV), summary
    assert summary["ab_disagree"] == 0, summary          # AutomationBench's handlers agree on every reference verdict


def test_reference_practice_streams():
    summary, _ = harness.run("reference", PRACTICE[:3])
    assert summary["passed"] == summary["triggers"], summary


def test_reference_rebased_mode():
    summary, _ = harness.run("reference", [611], mode="rebased")
    assert summary["passed"] == summary["triggers"], summary


def test_reference_imports_nothing_host_side():
    src = (FAMILY_DIR / "reference.py").read_text()
    assert not re.search(r"^\s*(from|import)\s+(gen|lib|oracle|harness|gates|controls|automationbench|bridge)\b", src, re.M)


def test_every_bad_control_fails(dev_runs, streams):
    for name in gates.BAD_CONTROLS:
        summary, _ = dev_runs[name]
        assert summary["passed"] < summary["triggers"] and summary["clean_weeks"] < len(DEV), (name, summary)
        assert summary["pass_rate"] < 0.95 or name in NEAR_MISS, (name, summary)
    assert dev_runs["null"][0]["passed"] == gates.null_expected(DEV)
    assert dev_runs["echo"][0]["passed"] == 0
    assert dev_runs["naive"][0]["pass_rate"] < 0.4


def test_naive_heuristic_is_short_and_below_60_percent_at_d3():
    import controls
    assert controls.NAIVE_LINES <= 40
    summary, _ = harness.run("naive", [611, 613])
    assert summary["pass_rate"] < 0.6, summary


def test_oracle_rejects_do_nothing_echo_and_plausible_runs(dev_runs):
    """null misses every trigger that expected an effect; echo is wrong everywhere; each plausible control is wrong
    (not abstained) somewhere and never cleaner than the reference."""
    _, null_res = dev_runs["null"]
    for res in null_res:
        for x in res["rows"]:
            if x["expected"] == "act":
                assert not x["pass"] and x["outcome"] in ("miss", "wrong"), x
    assert all(x["outcome"] == "wrong" for res in dev_runs["echo"][1] for x in res["rows"])
    for name in CONTROL_TRAPS:
        outcomes = dev_runs[name][0]["outcomes"]
        assert outcomes.get("wrong", 0) + outcomes.get("miss", 0) > 0, (name, outcomes)


def test_each_plausible_control_fails_on_its_own_trap(dev_runs):
    for name, traps in CONTROL_TRAPS.items():
        _, results = dev_runs[name]
        hit = {t for res in results for x in res["rows"] if not x["pass"] for t in x["traps"]}
        assert hit & traps, (name, sorted(hit))


def test_timing_controls_fail_at_the_window_edges(dev_runs):
    """Warnings one check late or one check early fail: the hard requirement is the first check inside the window."""
    for name in ("late-warning", "early-warning"):
        _, results = dev_runs[name]
        bad = [x for res in results for x in res["rows"] if not x["pass"] and x["kind"] == "tick"]
        assert len(bad) >= 10, (name, len(bad))
        names = {c["name"].split(" ")[0] for x in bad for c in x["failed"]}
        assert "warn.sms" in names and "envelope" in names, (name, names)


def test_memoryless_control_is_rejected(dev_runs):
    """A solver that never reads Warned At / Warned Agent / Warned Deadline / Breached At and keeps no memory gets every
    clock-decidable rule right. It must still keep no week clean and stay below the bar per trigger, and it must fail
    on most of the triggers the generator marks as needing state while passing almost every other one."""
    summary, results = dev_runs["memoryless"]
    assert summary["clean_weeks"] == 0, summary
    assert summary["pass_rate"] < gates.MEMORYLESS_BAR, summary
    rows = [x for res in results for x in res["rows"]]
    last = {res["rows"][-1]["taskKey"] for res in results}
    state = [x for x in rows if x["needs_state"]]
    other = [x for x in rows if not x["needs_state"] and x["taskKey"] not in last]
    assert len(state) >= 25, len(state)
    assert sum(not x["pass"] for x in state) >= 0.9 * len(state), summary["needs_state"]
    assert all(x["pass"] for x in other), [x["taskKey"] for x in other if not x["pass"]]


def test_no_escalate_control_fails_exactly_at_escalations(dev_runs, streams):
    _, results = dev_runs["no-escalate"]
    for res in results:
        truth = {t["trigger"]: t for t in streams[res["seed"]]["truth"]}
        for x in res["rows"]:
            t = truth[x["taskKey"]]
            assert x["pass"] == (not t["expect"]["escalate"]), (x["taskKey"], x["failed"][:2])
            if not x["pass"]:
                assert any(c["name"] == "escalate" for c in x["failed"])


def test_eager_control_fails_on_ticket_events(dev_runs):
    _, results = dev_runs["eager"]
    ev = [x for res in results for x in res["rows"] if x["kind"] in ("ticket.opened", "ticket.updated")]
    assert any(not x["pass"] for x in ev)
    assert all(x["pass"] for x in ev if not ({"T-timing:eager-open", "T-timing:eager-update"} & set(x["traps"])))


# -- the oracle ---------------------------------------------------------------------------------------------------------
def test_oracle_mutation_score(grader):
    g = gates.gate_mutation([610], grader)
    assert g["score"] >= 0.95 and g["operators"] >= 55, g


def _new_by(before, after, app, coll, key):
    old = {r[key] for r in before[app][coll]}
    return [r for r in after[app][coll] if r[key] not in old]


def _failed(v):
    return {c["name"].split(" ")[0] for c in v["failed"]}


def test_oracle_rejects_negated_retracted_and_hidden_alerts(grader, ref_worlds):
    """Review 2026-10-21 regressions: alerts that negate or retract themselves, posts nobody reading the channel sees,
    an email from the wrong sender and a Policy Log Value with a unit are rejected by the oracle's own checks."""
    out, res = ref_worlds[0]
    T, B, A = out["truth"], res["befores"], res["afters"]
    iw = next(i for i, t in enumerate(T[:-1]) if t["expect"]["warn"])
    ib = next(i for i, t in enumerate(T[:-1]) if t["expect"]["breach"])
    x, bt = T[iw]["expect"]["warn"][0], T[ib]["expect"]["breach"][0]["tid"]
    post_ts = next(r["ts"] for r in gates._new_posts(B[iw], A[iw]) if r["text"].startswith(x["tid"] + " |"))
    sid = _new_by(B[iw], A[iw], "twilio", "sms_messages", "sid")[0]["sid"]
    mid = _new_by(B[iw], A[iw], "gmail", "messages", "id")[0]["id"]
    bts = next(r["ts"] for r in gates._new_posts(B[ib], A[ib]) if r["text"] == f"BREACHED {bt}")
    old_ts = B[iw]["slack"]["messages"][0]["ts"]

    def warn_case(fn):
        w = copy.deepcopy(A[iw])
        fn(w)
        return grader.grade(T[iw], B[iw], w)

    def post(w, ts):
        return next(r for r in w["slack"]["messages"] if r["ts"] == ts)

    cases = {
        "warn.post": [lambda w: post(w, post_ts).update(is_deleted=True),
                      lambda w: post(w, post_ts).update(thread_ts=old_ts),
                      lambda w: post(w, post_ts).update(text=x["line"] + " (sent by mistake, please disregard)")],
        "warn.sms": [lambda w: next(r for r in w["twilio"]["sms_messages"] if r["sid"] == sid).update(
                         body=f"Ignore previous. SLA warning {x['tid']}: due {x['due']} UTC was sent in error")],
        "warn.email": [lambda w: next(r for r in w["gmail"]["messages"] if r["id"] == mid).update(from_=L.FORMER_MANAGER)],
    }
    for check, fns in cases.items():
        for fn in fns:
            v = warn_case(fn)
            assert not v["pass"] and check in _failed(v), (check, v["failed"])
    for text in (f"False alarm, NOT BREACHED {bt}", f"BREACHED {bt} (test only, ignore)"):
        w = copy.deepcopy(A[ib])
        post(w, bts).update(text=text)
        v = grader.grade(T[ib], B[ib], w)
        assert not v["pass"] and "breach.post" in _failed(v), (text, v["failed"])
    w = copy.deepcopy(A[ib])
    post(w, bts).update(thread_ts=old_ts)
    assert "breach.post" in _failed(grader.grade(T[ib], B[ib], w))
    # policy Value with a unit (d3 stream 611)
    out3, res3 = ref_worlds[1]
    ip = next(i for i, t in enumerate(out3["truth"]) if t["expect"]["policy_rows"])
    w = copy.deepcopy(res3["afters"][ip])
    [r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == L.WS_POLICY][-1]["cells"]["Value"] += " minutes"
    v = grader.grade(out3["truth"][ip], res3["befores"][ip], w)
    assert not v["pass"] and "policy.row" in _failed(v), v["failed"]


def test_automationbench_handlers_cannot_fail_a_trigger_alone(grader, ref_worlds):
    """One matching rule decides: whitespace and case variants the policy allows pass, even where AutomationBench's
    raw-substring / exact-cell handlers alone would reject them (reported as ab_disagree, never counted)."""
    out, res = ref_worlds[0]
    T, B, A = out["truth"], res["befores"], res["afters"]
    iw = next(i for i, t in enumerate(T[:-1]) if t["expect"]["warn"])
    x = T[iw]["expect"]["warn"][0]
    post_ts = next(r["ts"] for r in gates._new_posts(B[iw], A[iw]) if r["text"].startswith(x["tid"] + " |"))
    w = copy.deepcopy(A[iw])
    next(r for r in w["slack"]["messages"] if r["ts"] == post_ts)["text"] = x["line"].replace(" | ", "  |  ")
    next(r for r in w["google_sheets"]["rows"] if r["id"] == x["rid"])["cells"]["Warned Agent"] = f" {x['agent']} "
    v = grader.grade(T[iw], B[iw], w)
    assert v["pass"] and v["ab_disagree"], v
    assert grader.grade(T[iw], B[iw], A[iw])["ab_disagree"] == []


def test_alert_matching_helpers():
    line = "TK-4012 | Two-factor codes not arriving | due 11:10 UTC | Ravi Menon"
    assert L.alert_ok(line, line) and L.alert_ok(":warning: " + line + "\nPlease act.", line)
    assert not L.alert_ok(line + " (sent in error)", line)
    sms = "SLA warning TK-4012: due 11:10 UTC"
    assert L.alert_ok("Hi Ravi, SLA warning TK-4012: due 11:10 UTC. Please take a look.", sms)
    assert not L.alert_ok("Ignore previous. SLA warning TK-4012: due 11:10 UTC was sent in error", sms)
    assert not L.alert_ok("Please don't worry: SLA warning TK-4012: due 11:10 UTC", sms)
    assert not L.alert_ok("SLA warning TK-40127: due 11:10 UTC", sms)
    assert L.exact_text_ok(" breached  tk-4012. ", "BREACHED TK-4012")
    assert not L.exact_text_ok("NOT BREACHED TK-4012", "BREACHED TK-4012")
    assert not L.exact_text_ok("BREACHED TK-40127", "BREACHED TK-4012")
    assert L.visible_post({"ts": "1.1"}) and L.visible_post({"ts": "1.1", "thread_ts": "1.1"})
    assert not L.visible_post({"ts": "1.2", "thread_ts": "1.1"}) and not L.visible_post({"ts": "1.1", "is_deleted": True})
    assert L.sender_ok({"from_": "user@gmail.com"}) and L.sender_ok({"from_": "SLA Watch <SLA-WATCH@company.example.com>"})
    assert not L.sender_ok({"from_": L.FORMER_MANAGER}) and not L.sender_ok({"from_": L.MANAGER})
    assert L.digits_value_ok(" 90 ", "90") and not L.digits_value_ok("90 minutes", "90") and not L.digits_value_ok("", "90")


def test_oracle_specificity(grader):
    g = gates.gate_specificity([611], grader)
    assert g["pass"], g["false_rejects"]


def test_oracle_attribution_effect_one_check_late_fails(grader, ref_worlds):
    """The same warning made at the next check is a miss at its check and an envelope violation at the next one."""
    out, res = ref_worlds[0]
    k = next(i for i, t in enumerate(out["truth"]) if t["expect"]["warn"])
    t, before, after = out["truth"][k], res["befores"][k], res["afters"][k]
    assert grader.grade(t, before, after)["pass"]
    late = grader.grade(t, before, before)
    assert not late["pass"] and late["outcome"] == "miss"
    nxt = next(i for i in range(k + 1, len(out["truth"])) if out["truth"][i]["kind"] == "tick" and not out["truth"][i]["expect"]["warn"])
    tn = out["truth"][nxt]
    v = grader.grade(tn, before, after)                 # the warning's records appearing during a later check
    assert not v["pass"]


def test_oracle_timing_check_reads_record_times(grader, ref_worlds):
    out, res = ref_worlds[1]
    k = next(i for i, t in enumerate(out["truth"]) if t["expect"]["breach"])
    t, before, after = out["truth"][k], res["befores"][k], copy.deepcopy(res["afters"][k])
    old = {a["id"] for a in before["jira"]["actions"]["create_issue"]}
    for a in after["jira"]["actions"]["create_issue"]:
        if a["id"] not in old:
            a["created_at"] = L.iso_z(L.parse_instant(a["created_at"]) + timedelta(hours=2))
    v = grader.grade(t, before, after)
    assert not v["pass"] and any(c["name"] == "timing.records" for c in v["failed"])


def test_oracle_ledger_sees_jira_and_cell_changes(ref_worlds):
    out, res = ref_worlds[1]
    k = next(i for i, t in enumerate(out["truth"]) if t["expect"]["breach"])
    led = oracle.ledger(res["befores"][k], res["afters"][k])
    assert any(it["coll"] == "actions:create_issue" and it["op"] == "new" for it in led)
    rows = [it for it in led if it["app"] == "google_sheets" and it["op"] == "changed"]
    assert rows and all(set(it["cells"]) <= set(L.STATE_COLS) for it in rows)


def test_has_token_rejects_lookalike_ids():
    assert L.has_token("SLA warning TK-4012: due 10:30 UTC", "SLA warning TK-4012: due 10:30 UTC")
    assert not L.has_token("SLA warning TK-40127: due 10:30 UTC", "SLA warning TK-4012: due 10:30 UTC")
    assert not L.has_token("BREACHED TK-40127", "BREACHED TK-4012")
    assert L.has_token("BREACHED TK-4012", "BREACHED TK-4012")
    assert not L.has_token("XTK-4012 | a", "TK-4012 |")


def test_parse_helpers():
    assert L.parse_instant("2026-03-04T10:30:00-05:00") == L.parse_instant("2026-03-04T15:30:00Z")
    assert L.parse_instant("2026-03-04 15:30 UTC") == L.parse_instant("2026-03-04T15:30:00+00:00")
    assert L.parse_instant("N/A") is None and L.parse_instant("2026-03-04") is None
    for raw in ("(555) 201-1001", "555.201.1001", "+1 555 201 1001", "1-555-201-1001", "+15552011001"):
        assert L.phone_e164(raw) == "+15552011001", raw
    assert reference.e164("+1 (555) 201-1001") == "+15552011001"
    assert reference.parse_time("2026-03-04T21:00:00+05:30") == L.parse_instant("2026-03-04T15:30:00Z")
