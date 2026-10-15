"""abr-hr-inbox tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-hr-inbox/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import copy
import inspect
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
import controls  # noqa: E402

DEV = [610, 611, 612, 613, 614]
PRACTICE = list(range(601, 610))
FAMILY = json.loads((FAMILY_DIR / "family.json").read_text())
REPO = FAMILY_DIR.parents[3]


@pytest.fixture(scope="module")
def streams():
    return {s: gen.generate(s) for s in DEV}


@pytest.fixture(scope="module")
def dev_runs(streams):
    """(summary, per-stream results) for the reference and every bad control on the five dev streams."""
    return {name: harness.run(name, DEV, streams=streams) for name in ["reference"] + list(controls.CONTROLS)}


@pytest.fixture(scope="module")
def ref_worlds(streams):
    """The reference's per-trigger world_before / world_after on one d2 and one d3 dev stream."""
    grader = oracle.Grader()
    return [(streams[s], harness.run_stream(streams[s], reference.handle, grader=grader, keep_worlds=True)) for s in (610, 611)]


def _trigger_worlds(ref_worlds, pred):
    for stream, res in ref_worlds:
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            if pred(truth):
                yield stream, k, truth, before, after


# -- generator ---------------------------------------------------------------------------------------------------------
def test_determinism_and_round_trip():
    g = gates.gate_determinism([610, 611])
    assert g["pass"], g["problems"]


def test_stream_shape_matches_family_json(streams):
    for s, out in streams.items():
        d = out["meta"]["difficulty"]
        assert d == {610: "d2", 611: "d3", 612: "d2", 613: "d3", 614: "d2"}[s]
        lo, hi = FAMILY["triggersPerWeek"][d]
        assert lo <= out["meta"]["n_triggers"] <= hi and 25 <= out["meta"]["n_triggers"] <= 40
        kinds = Counter(t["kind"] for t in out["triggers"])
        for kind, spec in FAMILY["triggerKinds"].items():
            assert spec[d][0] <= kinds[kind] <= spec[d][1], (s, kind, kinds[kind])
            assert spec["perWeek"][0] <= kinds[kind] <= spec["perWeek"][1]
        ats = [t["at"] for t in out["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        last = out["triggers"][-1]
        assert last["kind"] == "week.close" and last["at"].endswith("T17:00:00Z")
        assert out["meta"]["week"] <= last["at"][:10]


def test_trap_rates_near_design(streams):
    for out in streams.values():
        share = out["meta"]["trigger_trap_share"]
        if out["meta"]["difficulty"] == "d2":
            assert 0.25 <= share <= 0.65, share
        else:
            assert 0.55 <= share <= 0.85, share


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert set(g["by_kind"]) >= set(gates.TRAP_KINDS)


def test_every_trap_label_has_a_kind(streams):
    for out in streams.values():
        for t in out["truth"]:
            assert all(x in gen.TRAP_KIND for x in t["traps"]), t["traps"]


def test_fictional_entities_only(streams):
    allowed = re.compile(r"@[a-z0-9.-]+\.example\.(com|net|org)$", re.I)
    for out in streams.values():
        w = out["world0"]
        emails = [r["cells"]["Email"] for r in w["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_DIR]
        emails += [u["email"] for u in w["slack"]["users"]]
        for m in w["gmail"]["messages"]:
            emails += [oracle.addr(m["from_"])] + [oracle.addr(x) for x in m["to"]]
        for p in out["payloads"]:
            if p["event"] == "new_email":
                emails.append(oracle.addr(p["data"]["from"]))
        assert emails and all(allowed.search(e) for e in emails), [e for e in emails if not allowed.search(e)][:3]


def test_heldout_seeds_refused(tmp_path):
    with pytest.raises(SystemExit):
        gen.main(["--seed", "8801", "--out", str(tmp_path / "x")])
    with pytest.raises(SystemExit):
        harness.parse_seeds("8801-8804")
    assert not (tmp_path / "x").exists()


def test_write_is_host_only_and_hashed(tmp_path):
    meta = gen.write(gen.generate(612), tmp_path / "s612")
    files = sorted(p.name for p in (tmp_path / "s612").iterdir())
    assert files == ["end.json", "meta.json", "payloads.jsonl", "serve-inputs.jsonl", "triggers.jsonl", "truth.jsonl", "world0.json"]
    for name, h in meta["sha256"].items():
        assert gen.sha((tmp_path / "s612" / name).read_text(encoding="utf-8")) == h


def test_no_hidden_truth_reaches_the_arm():
    g = gates.gate_leakage([610, 611])
    assert g["pass"], g["problems"]


def test_payload_is_zap_shaped(streams):
    for out in streams.values():
        for p in out["payloads"]:
            assert set(p) == gates.PAYLOAD_KEYS
            assert (p["app"], p["event"]) in {("gmail", "new_email"), ("google_sheets", "new_row"), ("schedule", "week_close")}
            assert set(p["data"]) == gates.DATA_KEYS[p["event"]]


def test_policy_states_the_rules_the_generator_uses():
    policy = (FAMILY_DIR / "POLICY.md").read_text()
    for token in gen.COUNT_LABELS + gen.BANK_MARKERS + [gen.HR_DIRECTOR, gen.HR_BP, gen.LEGAL, gen.HR_OPS, gen.SECURITY_TEAM,
                                                         "Routed to HRBP", "Routed to Legal and HR Director", "HR routing amendment",
                                                         "Automatic reply", "Out of office", gen.PAYROLL_PARAM, "Possible fraud",
                                                         "HR request <Employee ID>: <Category>", "Your request has been routed to",
                                                         "Grievance <Case ID>", "HR inbox week", gen.INBOX]:
        assert token in policy, token
    for ws, title in gen.WS_TITLE.items():
        assert ws in policy and title in policy
        for col in gen.HEADERS[ws]:
            assert col in policy, col


def test_classification_rule_matches_the_policy_example():
    rules = [(i + 2, {"Category": c, "Keywords": ", ".join(k), "Route To": rt, "SLA": sla}) for i, (c, k, rt, sla) in enumerate(gen.RULES)]
    ib = reference.Inbox({"at": "2026-03-02T10:00:00Z"}, None)
    assert ib.category("I can't log in to the pay portal", rules) == "IT Access"
    assert gen.winner(gen.matches("I can't log in to the pay portal")) == "IT Access"
    assert ib.category("my payroll payment", rules) is None            # whole words only
    assert ib.category("My PTO payout was not on my paycheck", rules) == "Payroll"   # equal SLA: the higher row


def test_generator_and_reference_read_every_email_and_grievance_alike(streams):
    """The two classifiers (category, bank change, sign-off) and the two about-manager readings agree everywhere."""
    for s in DEV + PRACTICE:
        out = streams.get(s) or gen.generate(s)
        directory = [(r["row_id"], r["cells"]) for r in out["world0"]["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_DIR]
        rules = [(r["row_id"], r["cells"]) for r in out["world0"]["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_RULES]
        ib = reference.Inbox({"at": "2026-03-02T10:00:00Z"}, None)
        for t in out["triggers"]:
            for op in t["delta"]:
                rec = op["record"]
                if op["app"] == "gmail":
                    subj, body = rec["subject"], rec["body_plain"]
                    assert ib.request_text(subj, body) == gen.request_text(subj, body)
                    assert ib.category(ib.request_text(subj, body), rules) == gen.winner(gen.matches(gen.request_text(subj, body)))
                    assert ib.is_bank_change(ib.request_text(subj, body)) == gen.is_bank_change(gen.request_text(subj, body))
                else:
                    c = rec["cells"]
                    emp = next(x for _, x in directory if x["Employee ID"] == c["Employee ID"])
                    first = ib.first_named(c["Description"], directory)
                    mgr_id = next(x["Employee ID"] for _, x in directory if x["Email"] == emp["Manager Email"])
                    hits = [(m.start(), x["Employee ID"]) for _, x in directory
                            for m in [re.search(r"(?<![A-Za-z])" + re.escape(x["Name"]) + r"(?![A-Za-z])", c["Description"])] if m]
                    gen_first = min(hits)[1] if hits else None
                    assert (first["Employee ID"] if first else None) == gen_first
                    assert ib.about_manager(c, emp, directory) == (gen_first == mgr_id)


# -- reference ---------------------------------------------------------------------------------------------------------
def test_reference_passes_dev_seeds(dev_runs):
    summary, results = dev_runs["reference"]
    assert summary["pass_rate"] >= 0.95                     # the acceptance bar
    assert summary["passed"] == summary["triggers"] and summary["clean_weeks"] == 5, summary
    assert summary["errors"] == 0 and summary["max_steps"] <= 10


def test_reference_passes_practice_seeds_and_rebased_mode():
    s, _ = harness.run("reference", PRACTICE)
    assert s["passed"] == s["triggers"] and s["clean_weeks"] == len(PRACTICE), s
    r, _ = harness.run("reference", [610, 611], mode="rebased")
    assert r["passed"] == r["triggers"], r


def test_reference_is_observable_only():
    assert gates.reference_imports() <= gates.STD
    src = (FAMILY_DIR / "reference.py").read_text()
    assert not re.search(r"\b(gen|oracle|harness|truth|delta)\b\.", src)


# -- controls ----------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("name", list(controls.CONTROLS))
def test_every_bad_control_fails(dev_runs, name):
    summary, _ = dev_runs[name]
    assert summary["passed"] < summary["triggers"] and summary["clean_weeks"] < summary["streams"], (name, summary)


def test_gross_controls(dev_runs, streams):
    noop = sum(1 for s in DEV for t in streams[s]["truth"] if t["outcome"] == "no-op")
    assert dev_runs["null"][0]["passed"] == noop
    assert dev_runs["echo"][0]["passed"] == 0
    d3 = [s for s in DEV if gen.default_difficulty(s) == "d3"]
    naive_d3 = sum(x["pass"] for r in dev_runs["naive"][1] if r["seed"] in d3 for x in r["rows"]) / \
        sum(len(r["rows"]) for r in dev_runs["naive"][1] if r["seed"] in d3)
    assert naive_d3 < 0.6, naive_d3
    lines = inspect.getsource(controls.naive).rstrip().splitlines()
    assert len(lines) <= 40 and controls.NAIVE_LINES == len(lines)


@pytest.mark.parametrize("name", sorted(controls.ONE_DEFECT))
def test_plausible_controls_fail_for_their_rule(dev_runs, name):
    _, results = dev_runs[name]
    labels = controls.ONE_DEFECT[name]
    failed = [x for r in results for x in r["rows"] if not x["pass"]]
    assert any(set(x["traps"]) & labels for x in failed), (name, [(x["taskKey"], x["traps"]) for x in failed][:5])


# -- oracle ------------------------------------------------------------------------------------------------------------
def test_oracle_accepts_reference_and_rejects_null(ref_worlds):
    grader = oracle.Grader()
    for stream, k, truth, before, after in _trigger_worlds(ref_worlds, lambda t: True):
        last = k == len(stream["truth"]) - 1
        end, w0 = (stream["end"], stream["world0"]) if last else (None, None)
        assert grader.grade(truth, before, after, end, w0)["pass"]
        null = grader.grade(truth, before, before, end, w0)
        assert null["pass"] == (truth["outcome"] == "no-op") or last
        if truth["outcome"] != "no-op":
            assert null["outcome"] == "miss"


def test_oracle_rejects_a_plausible_wrong_route(ref_worlds):
    """Every forward re-addressed to another category's mailbox, and every grievance routed to another handler, is wrong."""
    grader = oracle.Grader()
    n = 0
    boxes = {r[0]: r[2] for r in gen.RULES}
    for stream, k, truth, before, after in _trigger_worlds(ref_worlds, lambda t: t["outcome"] == "act" and t["kind"] != "week.close"):
        w = copy.deepcopy(after)
        new = [m for m in w["gmail"]["messages"] if m["id"] not in {x["id"] for x in before["gmail"]["messages"]}]
        fwd = next((m for m in new if str(m["subject"]).startswith("HR request")), None)
        if fwd is not None:
            cat = fwd["subject"].split(": ", 1)[1]
            other = next(c for c in gen.CATEGORIES if c != cat and boxes[c] != fwd["to"][0])
            fwd["to"] = [boxes[other]]
        elif new:
            new[0]["to"] = ["hr-bp@company.example.com"] if new[0]["to"] != ["hr-bp@company.example.com"] else [new[0]["to"][0].replace("hr-bp", "legal")]
        else:
            continue
        v = grader.grade(truth, before, w)
        assert not v["pass"] and v["outcome"] == "wrong", (truth["trigger"], v)
        n += 1
    assert n >= 40


def test_oracle_mutation_score():
    g = gates.gate_mutation([610, 611])
    assert g["pass"] and g["score"] >= 0.95, g


def test_oracle_specificity_no_false_rejects():
    g = gates.gate_specificity([610, 611])
    assert g["pass"], g


def test_abstention_is_not_credit(ref_worlds):
    grader = oracle.Grader()
    stream, k, truth, before, after = next(_trigger_worlds(ref_worlds, lambda t: t["outcome"] == "act" and t["kind"] == "request.email"))
    w = copy.deepcopy(before)
    gates._post(w, gen.REVIEW, f"{truth['trigger']}: not sure", 1)
    v = grader.grade(truth, before, w)
    assert v["outcome"] == "abstained" and not v["pass"]
    stream, k, truth, before, after = next(_trigger_worlds(ref_worlds, lambda t: t["outcome"] == "escalate"))
    assert grader.grade(truth, before, after)["pass"]


def test_no_case_id_in_slack_even_in_an_escalation(ref_worlds):
    grader = oracle.Grader()
    hits = list(_trigger_worlds(ref_worlds, lambda t: t["outcome"] == "escalate" and t["kind"] == "grievance.filed"))
    assert hits
    for stream, k, truth, before, after in hits:
        w = copy.deepcopy(after)
        new = [m for m in w["slack"]["messages"] if (m["channel_id"], m["ts"]) not in {(x["channel_id"], x["ts"]) for x in before["slack"]["messages"]}]
        new[0]["text"] += " " + truth["expect"]["forbid_slack"][0]
        v = grader.grade(truth, before, w)
        assert not v["pass"] and any(c["name"] == "slack.no-case-id" for c in v["failed"])


def test_end_of_week_is_graded_at_the_last_trigger(ref_worlds):
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
        assert grader.grade(truth, before, after, stream["end"], stream["world0"])["pass"]
        # a grievance whose Status was set back to Pending
        w = copy.deepcopy(after)
        row = next(r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_GRIEV and r["cells"]["Status"].startswith("Routed")
                   and r["cells"]["Filed"] >= stream["end"]["week_start"])
        row["cells"]["Status"] = "Pending"
        v = grader.grade(truth, before, w, stream["end"], stream["world0"])
        assert any(c["name"] == "end.grievances" for c in v["failed"])
        # a forward sent twice earlier in the week (exactly once)
        w = copy.deepcopy(after)
        ids0 = {m["id"] for m in stream["world0"]["gmail"]["messages"]}
        fwd = next(m for m in w["gmail"]["messages"] if m["id"] not in ids0 and str(m["subject"]).startswith("HR request"))
        w["gmail"]["messages"].append(dict(copy.deepcopy(fwd), id="abababababababab"))
        v = grader.grade(truth, w, w, stream["end"], stream["world0"])
        assert any(c["name"] == "end.mail-counts" for c in v["failed"])


def test_grounding_spans_point_at_the_public_tasks():
    tasks = REPO / "corpus/AutomationBench/automationbench/domains/hr/tasks.py"
    if not tasks.exists():
        pytest.skip("corpus/AutomationBench is not cloned")
    lines = tasks.read_text().splitlines()
    for g in FAMILY["grounding"]:
        a, z = (int(x) for x in g["span"].rsplit(":", 1)[1].split("-"))
        span = "\n".join(lines[a - 1:z])
        assert f'"task": "{g["task"]}"' in span, g["task"]
        assert lines[a - 1].startswith("def ")
