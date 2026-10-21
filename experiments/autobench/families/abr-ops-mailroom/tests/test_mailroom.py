"""abr-ops-mailroom tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-ops-mailroom/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import copy
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
PRACTICE = list(range(601, 610))
FAMILY = json.loads((FAMILY_DIR / "family.json").read_text())
ONE_DEFECT = {  # control -> trap labels (or trigger kinds) its broken rule must show up on
    "name-only": {"lookalike", "wrong-dept"}, "leave-as-skip": {"on-leave", "precedence", "release"},
    "no-dock": {"oversized", "oversized-sms"}, "case-notes": {"notes-variant"}, "no-release": {"release"},
    "release-by-name": {"release-lookalike"}, "count-sheet": {"count-release"}, "count-all": {"count-noise"},
    "sms-floor": {"oversized-sms"}, "returned-skip": {"returned"}, "no-recheck": {"requeue"},
    "customs-first": {"precedence"},
    # review 2026-10-21
    "stateless": {"already-routed", "skipped-active", "other-change"}, "nostatus": {"already-routed", "skipped-active"},
    "exact-match": {"spelling"}, "post-as-written": {"spelling"}, "type-exact": {"type-variant"},
    "no-escalate": {"ambiguous"}}


@pytest.fixture(scope="module")
def streams():
    return {s: gen.generate(s) for s in DEV}


@pytest.fixture(scope="module")
def dev_runs(streams):
    """name -> (summary, carry results, rebased results) for the reference and every bad control on the five dev
    streams. The summary is harness.summarize_both: per-trigger numbers from rebased, clean weeks from carry."""
    out = {}
    for name in ["reference"] + gates.BAD_CONTROLS:
        summary, results = harness.run(name, DEV, mode="both", streams=streams)
        out[name] = (summary, results[:len(DEV)], results[len(DEV):])
    return out


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
        assert lo <= out["meta"]["n_triggers"] <= hi and 40 <= out["meta"]["n_triggers"] <= 60
        kinds = Counter(t["kind"] for t in out["triggers"])
        for kind, spec in FAMILY["triggerKinds"].items():
            assert spec[d][0] <= kinds[kind] <= spec[d][1], (s, kind, kinds[kind])
            assert spec["perWeek"][0] <= kinds[kind] <= spec["perWeek"][1]
        ats = [t["at"] for t in out["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        last = out["triggers"][-1]
        assert last["kind"] == "day.close" and last["at"].endswith("T17:00:00Z")
        assert [t["payload"]["data"]["date"] for t in out["triggers"] if t["kind"] == "day.close"] == \
            sorted({t["at"][:10] for t in out["triggers"] if t["kind"] == "day.close"})


def test_trap_rates_near_design(streams):
    for out in streams.values():
        share = out["meta"]["trigger_trap_share"]
        if out["meta"]["difficulty"] == "d2":
            assert 0.30 <= share <= 0.48, share       # design 0.35; package.updated triggers are traps by construction
        else:
            assert 0.55 <= share <= 0.70, share       # design 0.60


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert set(g["by_kind"]) >= {"T-lookalike", "T-note", "T-format", "T-repeat"}


def test_fictional_entities_only(streams):
    for out in streams.values():
        w = out["world0"]
        for r in w["google_sheets"]["rows"]:
            phone = r["cells"].get("Phone")
            if phone:
                assert re.fullmatch(r"\+1\d{3}55501\d{2}", phone), phone      # the 555-01xx fiction range
        for u in w["slack"]["users"]:
            assert u["email"].endswith("@company.example.com")
        for m in w["twilio"]["sms_messages"]:
            assert re.fullmatch(r"\+1\d{3}55501\d{2}", m["to_number"]) and m["from_number"] == gen.MAILROOM_NUMBER


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


def test_truth_is_a_snapshot_per_trigger(streams):
    """A package held at its own trigger still expects its hold there, even when a later trigger releases it."""
    seen = 0
    for out in streams.values():
        released = {st["id"] for t in out["truth"] if t["kind"] == "employee.returned" for st in t["expect"]["status"]}
        for t in out["truth"]:
            if t["kind"] == "package.received":
                for st in t["expect"]["status"]:
                    if st["id"] in released:
                        assert st["status"] == gen.HELD_LEAVE
                        seen += 1
    assert seen >= 1


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
            if p["event"] == "row_updated" and p["data"]["worksheet"] == "Incoming Packages":
                assert "Status" not in p["data"]["row"]          # the arm's own state never arrives in a payload


# -- reference -----------------------------------------------------------------------------------------------------------
def test_reference_passes_dev_seeds(dev_runs):
    summary, carry, rebased = dev_runs["reference"]
    assert summary["passed"] == summary["triggers"] and summary["clean_weeks"] == len(DEV), summary
    assert summary["passed_carry"] == summary["triggers"] and summary["inherited"] == 0
    assert summary["max_steps"] <= 49


def test_reference_passes_practice_seeds_and_rebased_mode():
    s, _ = harness.run("reference", PRACTICE)
    assert s["passed"] == s["triggers"] and s["clean_weeks"] == len(PRACTICE), s
    s, _ = harness.run("reference", [610, 611], mode="rebased")
    assert s["passed"] == s["triggers"], s


def test_reference_is_observable_only():
    g = gates.gate_leakage([610])
    assert set(g["reference_imports"]) <= {"__future__", "json", "re", "datetime", "urllib"}
    src = (FAMILY_DIR / "reference.py").read_text()
    for host in ("import gen", "import oracle", "truth", "world0", "delta"):
        assert host not in src


# -- controls ------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("name", gates.BAD_CONTROLS)
def test_every_bad_control_fails(dev_runs, name):
    """Per trigger in rebased mode (the per-trigger number) and as weeks in carry mode."""
    summary, _, _ = dev_runs[name]
    assert summary["passed"] < summary["triggers"] and summary["clean_weeks"] < len(DEV), summary


def test_gross_controls(dev_runs, streams):
    noop = sum(1 for s in DEV for t in streams[s]["truth"] if t["outcome"] == "no-op")
    null, _, _ = dev_runs["null"]
    assert null["passed"] == noop and null["passed_carry"] == noop and set(null["outcomes"]) <= {"correct", "miss"}
    echo, _, _ = dev_runs["echo"]
    assert echo["passed"] == 0 and set(echo["outcomes"]) == {"wrong"}
    import controls
    src = (FAMILY_DIR / "controls.py").read_text()
    body = src[src.index("def naive("): src.index("NAIVE_LINES")].strip().splitlines()
    assert len(body) <= 40 and controls.NAIVE_LINES >= len(body) - 1
    d3, _ = harness.run("naive", [611, 613], streams=streams)
    assert d3["pass_rate"] < 0.6, d3


@pytest.mark.parametrize("name", sorted(ONE_DEFECT))
def test_plausible_controls_fail_for_their_rule(dev_runs, name):
    """Each one-defect control fails, in rebased mode (so not by inheritance), on at least one trigger carrying the
    trap its broken rule resolves."""
    _, _, rebased = dev_runs[name]
    failed = [x for r in rebased for x in r["rows"] if not x["pass"]]
    assert any(set(x["traps"]) & ONE_DEFECT[name] for x in failed), (name, [(x["taskKey"], x["traps"]) for x in failed][:6])
    assert all(x["error"] is None for x in failed)


# -- review 2026-10-21: the Status column decides (defect 1) --------------------------------------------------------
def test_status_guard_is_load_bearing(dev_runs, streams):
    """The review's 'stateless' and 'nostatus' solvers passed every trigger of v1.0.0. Now each fails every dev week
    (carry) and fails per trigger (rebased) only on triggers where the Status column is what decides."""
    for name in ("stateless", "nostatus"):
        summary, carry, rebased = dev_runs[name]
        assert summary["clean_weeks"] == 0, (name, summary)
        failed = [x for r in rebased for x in r["rows"] if not x["pass"]]
        assert failed and all({"already-routed", "skipped-active", "other-change"} & set(x["traps"]) for x in failed), \
            (name, [(x["taskKey"], x["traps"]) for x in failed if not {"already-routed", "skipped-active"} & set(x["traps"])])
    # every package.updated trigger is a no-op whose only reason is the Status column (or the changed column)
    for out in streams.values():
        upd = [t for t in out["truth"] if t["kind"] == "package.updated"]
        assert upd and all(t["outcome"] == "no-op" for t in upd)
        assert all({"already-routed", "skipped-active", "other-change"} & set(t["traps"]) for t in upd)
        rets = [t for t in out["truth"] if t["kind"] == "employee.returned"]
        assert any("already-routed" in t["traps"] for t in rets)      # a returning employee with a Routed package


def test_reference_ignores_a_non_notes_package_change():
    """'Any other row change: do nothing' (POLICY.md section 4): no tool call at all on a Department change."""
    class NoTools:
        def fetch_json(self, *a, **k):
            raise AssertionError("the reference called a tool for a non-Notes change")
        fetch = fetch_json
    for changed in (["Department"], ["Package Type"], ["Status"]):
        trig = {"trigger": "s610/t99", "app": "google_sheets", "event": "row_updated",
                "data": {"spreadsheet_id": gen.SS, "worksheet": "Incoming Packages", "row_id": 5, "changed": changed,
                         "row": {"Tracking Number": "TRK-11111", changed[0]: "x"}}}
        assert reference.handle(trig, NoTools()) is None


# -- review 2026-10-21: SMS From number and top-level posts (defects 2 and 3) -----------------------------------------
def test_sms_from_number_is_graded(ref_worlds):
    assert oracle.MAILROOM_NUMBER == gen.MAILROOM_NUMBER and f"`{gen.MAILROOM_NUMBER}`" in (FAMILY_DIR / "POLICY.md").read_text()
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        k = next(i for i, t in enumerate(stream["truth"]) if t["expect"]["sms"])
        before, after = res["befores"][k], copy.deepcopy(res["afters"][k])
        sid = next(m["sid"] for m in after["twilio"]["sms_messages"] if m["sid"] not in {x["sid"] for x in before["twilio"]["sms_messages"]})
        for from_number in ("+15559999999", ""):
            w = copy.deepcopy(after)
            next(m for m in w["twilio"]["sms_messages"] if m["sid"] == sid)["from_number"] = from_number
            v = grader.grade(stream["truth"][k], before, w)
            assert not v["pass"] and any(c["name"].startswith("sms ") for c in v["failed"]), v["failed"]
        # and at the week's end: a week SMS from another number fails end.sms
        last = len(stream["truth"]) - 1
        w0, w1 = copy.deepcopy(res["befores"][last]), copy.deepcopy(res["afters"][last])
        for w in (w0, w1):
            next(m for m in w["twilio"]["sms_messages"] if m["sid"] == sid)["from_number"] = "+15559999999"
        v = grader.grade(stream["truth"][last], w0, w1, stream["end"], stream["world0"])
        assert any(c["name"] in ("end.sms", "end.ab") for c in v["failed"])
    # another From number is a mutant now, no longer a policy-neutral variant
    stream, res = ref_worlds[0]
    k = next(i for i, t in enumerate(stream["truth"]) if t["expect"]["sms"])
    names = [n for n, _ in gates.mutants(res["befores"][k], res["afters"][k], stream["truth"][k])]
    assert "sms-from" in names
    assert all(n != "sms-other-from" for n, _ in gates.equivalents(res["befores"][k], res["afters"][k], stream["truth"][k]))


def test_thread_reply_posts_are_rejected(ref_worlds):
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        for kind in ("package.received", "day.close"):
            k = next(i for i, t in enumerate(stream["truth"][:-1]) if t["kind"] == kind and t["expect"]["posts"])
            before, after = res["befores"][k], copy.deepcopy(res["afters"][k])
            mailroom = oracle._chan_id(after, gen.MAILROOM)
            old = {(m["channel_id"], m["ts"]) for m in before["slack"]["messages"]}
            parent = next(m["ts"] for m in after["slack"]["messages"] if m["channel_id"] == mailroom)
            for m in after["slack"]["messages"]:
                if (m["channel_id"], m["ts"]) not in old:
                    m["thread_ts"] = parent
            v = grader.grade(stream["truth"][k], before, after)
            assert not v["pass"] and any(c["name"].startswith("post ") for c in v["failed"]), (kind, v["failed"])


# -- review 2026-10-21: policy clauses exercised (defect 4) ---------------------------------------------------------
def test_policy_clauses_are_exercised(streams, dev_runs):
    labels = Counter(x for out in streams.values() for t in out["truth"] for x in t["traps"])
    for lab in ("spelling", "type-variant", "other-change", "ambiguous", "already-routed", "skipped-active"):
        assert labels[lab] >= 2, (lab, labels[lab])
    spelled = 0
    for out in streams.values():
        for t, tr in zip(out["triggers"], out["truth"]):
            if "spelling" in t["traps"]:
                row = t["payload"]["data"]["row"]
                (post,) = [p for p in tr["expect"]["posts"]]
                assert f"({row['Recipient Name']}, {row['Department']})" not in post   # the directory spelling, not the cell's
                spelled += 1
            if "type-variant" in t["traps"]:
                assert t["payload"]["data"]["row"]["Package Type"] not in ("Refrigerated", "Hazardous") and tr["expect"]["sms"]
            if "ambiguous" in t["traps"]:
                assert tr["outcome"] == "escalate" and tr["expect"]["escalate"] and not tr["expect"]["posts"]
    assert spelled >= 2
    # the escalation clause is graded: the reference escalates (correct), doing nothing is a miss, routing is wrong
    _, carry, _ = dev_runs["reference"]
    esc = [x for r in carry for x in r["rows"] if x["expected"] == "escalate"]
    assert esc and all(x["pass"] for x in esc)
    _, _, rebased = dev_runs["no-escalate"]
    assert all(not x["pass"] and x["outcome"] == "wrong" for r in rebased for x in r["rows"] if x["expected"] == "escalate")
    _, _, rebased = dev_runs["null"]
    assert all(x["outcome"] == "miss" for r in rebased for x in r["rows"] if x["expected"] == "escalate")


def test_generator_and_reference_normalise_package_type_alike():
    for t in ("refrigerated", " HAZARDOUS", "Refrigerated  ", "hazardous"):
        cells = {"Tracking Number": "TRK-1", "Recipient Name": "A B", "Department": "IT", "Package Type": t, "Notes": ""}
        emp = {"Name": "A B", "Department": "IT", "Floor": "1", "Phone": "+12125550100", "Status": "Active"}
        assert gen.decide(cells, [emp]).get("sms")
        assert reference.Mailroom({}, None).needs_sms(cells)


# -- review 2026-10-21: the policy sheet agrees with section 4 (defect 5) -------------------------------------------
def test_policy_sheet_agrees_with_policy_md():
    rows = dict((p, rule) for p, rule, _ in gen.POLICY_ROWS)
    assert "decided again" in rows["Customs Hold"] and "routed." not in rows["Customs Hold"]
    assert "any letter case" in rows["Notifications"]


# -- review 2026-10-21: per-trigger numbers are rebased (defect 6) ---------------------------------------------------
def test_per_trigger_rate_is_rebased_and_carry_double_counts(dev_runs):
    for name in ("no-release", "leave-as-skip"):
        summary, carry, rebased = dev_runs[name]
        r = sum(x["pass"] for res in rebased for x in res["rows"])
        c = sum(x["pass"] for res in carry for x in res["rows"])
        assert summary["passed"] == r and summary["passed_carry"] == c
        assert summary["inherited"] > 0 and c < r, (name, summary)     # carry fails triggers the solver got right
        assert summary["clean_weeks"] == sum(res["clean_week"] for res in carry)


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
            gates._post(echoed, gen.MAILROOM, json.dumps(truth["trigger"]), 1)
            assert not grader.grade(truth, before, echoed)["pass"]


def test_oracle_mutation_score():
    g = gates.gate_mutation([610, 611])
    assert g["pass"] and g["score"] >= 0.95, g
    assert len(g["operators"]) >= 20


def test_oracle_specificity_no_false_rejects():
    g = gates.gate_specificity([610])
    assert g["pass"], g["rejected"]


def test_abstention_is_not_credit(ref_worlds):
    grader = oracle.Grader()
    stream, res = ref_worlds[0]
    k = next(i for i, t in enumerate(stream["truth"]) if t["kind"] == "package.received" and t["outcome"] == "act")
    before = res["befores"][k]
    w = copy.deepcopy(before)
    gates._post(w, gen.REVIEW, f"{stream['truth'][k]['trigger']}: not sure about this package", 1)
    v = grader.grade(stream["truth"][k], before, w)
    assert not v["pass"] and v["outcome"] == "abstained"


def test_end_of_week_is_graded_at_the_last_trigger(ref_worlds):
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
        ok = grader.grade(truth, before, after, stream["end"], stream["world0"])
        plain = grader.grade(truth, before, after)
        assert ok["pass"] and ok["n_checks"] - plain["n_checks"] == 7     # the seven end-of-week checks ran and passed
        # an earlier routed package silently set back to a hold in the final world: invisible per trigger, caught at week end
        w0, w1 = copy.deepcopy(before), copy.deepcopy(after)
        routed = next(r for r in w1["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_PKG and r["cells"]["Status"] == gen.ROUTED)
        for w in (w0, w1):
            next(r for r in w["google_sheets"]["rows"] if r["id"] == routed["id"])["cells"]["Status"] = gen.HELD_CUSTOMS
        v = grader.grade(truth, w0, w1, stream["end"], stream["world0"])
        assert not v["pass"] and any(c["name"] == "end.packages" for c in v["failed"])
        # a week's SMS missing from the final world
        w0, w1 = copy.deepcopy(before), copy.deepcopy(after)
        sid = next(m["sid"] for m in w1["twilio"]["sms_messages"] if m["sid"] not in {x["sid"] for x in stream["world0"]["twilio"]["sms_messages"]})
        for w in (w0, w1):
            w["twilio"]["sms_messages"] = [m for m in w["twilio"]["sms_messages"] if m["sid"] != sid]
        v = grader.grade(truth, w0, w1, stream["end"], stream["world0"])
        assert not v["pass"] and any(c["name"] in ("end.sms", "end.ab") for c in v["failed"])


# -- policy and grounding ----------------------------------------------------------------------------------------------
def test_policy_states_the_parameters_the_generator_uses():
    policy = (FAMILY_DIR / "POLICY.md").read_text()
    for s in (gen.SS, gen.WS_PKG, gen.WS_EMP, gen.DOCK, gen.MAILROOM_NUMBER, gen.ARROW, gen.ROUTED, gen.SKIPPED,
              gen.HELD_LEAVE, gen.HELD_CUSTOMS, "Routed today: <N>", "returned to sender", "customs hold", "oversized",
              "Refrigerated", "Hazardous", "#mailroom", "#automation-review", "Package <Tracking Number> ready at <location>"):
        assert s in policy, s
    for h in gen.PKG_HEADERS + gen.EMP_HEADERS:
        assert h in policy, h
    for d in gen.DECOYS:                      # no decoy note contains a policy keyword
        assert not any(kw in d.lower() for kw in (gen.KW_RETURNED, gen.KW_CUSTOMS, gen.KW_OVERSIZED)), d


def test_grounding_span_points_at_the_public_task():
    tasks = FAMILY_DIR.parents[3] / "corpus" / "AutomationBench" / "automationbench" / "domains" / "operations" / "tasks.py"
    if not tasks.exists():
        pytest.skip("corpus/AutomationBench not cloned")
    lines = tasks.read_text().splitlines()
    span = FAMILY["grounding"][0]["span"].split(":")[1]
    a, b = (int(x) for x in span.split("-"))
    assert lines[a - 1].startswith("def get_ops_mailroom_package_routing_task")
    assert '"operations.mailroom_package_routing"' in "\n".join(lines[a - 1:b])
