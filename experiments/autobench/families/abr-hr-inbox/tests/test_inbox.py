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
    """The end state is a separate end-of-week verdict (`week`), never part of the close trigger's own pass."""
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
        v = grader.grade(truth, before, after, stream["end"], stream["world0"])
        assert v["pass"] and v["week"]["pass"] and v["week"]["n_checks"] >= 10
        assert not any(c["group"] == "end" for c in v["failed"])
        # a grievance whose Status was set back to Pending
        w = copy.deepcopy(after)
        row = next(r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_GRIEV and r["cells"]["Status"].startswith("Routed")
                   and r["cells"]["Filed"] >= stream["end"]["week_start"])
        row["cells"]["Status"] = "Pending"
        v = grader.grade(truth, before, w, stream["end"], stream["world0"])
        assert any(c["name"] == "end.grievances" for c in v["week"]["failed"])
        # a forward sent twice earlier in the week (exactly once)
        w = copy.deepcopy(after)
        ids0 = {m["id"] for m in stream["world0"]["gmail"]["messages"]}
        fwd = next(m for m in w["gmail"]["messages"] if m["id"] not in ids0 and str(m["subject"]).startswith("HR request"))
        w["gmail"]["messages"].append(dict(copy.deepcopy(fwd), id="abababababababab"))
        v = grader.grade(truth, w, w, stream["end"], stream["world0"])
        assert any(c["name"] == "end.mail-counts" for c in v["week"]["failed"])
        assert not any(c["name"].startswith("end.") for c in v["failed"])


# -- review fixes (2026-10-21) ----------------------------------------------------------------------------------------
# Probe solvers in the shape of the reviewer's probes (scratchpad attack.py / attack2.py). W = wrong, C = correct.
class W1TwoCategories(reference.Inbox):
    """Forward subject and acknowledgement name every matched category."""
    def route(self, sender, subject, text, emp, cat, mailbox):
        rules = self.read(reference.WS_RULES)[reference.WS_RULES]
        others = [c["Category"] for _, c in rules if c["Category"] != cat
                  and any(reference.phrase(x.strip()).search(text) for x in c["Keywords"].split(",") if x.strip())]
        eid = reference.employee_id(emp["Employee ID"])
        ack = f"Your request has been routed to {cat}" + (f" and {' and '.join(others)}." if others else ".")
        self.calls([self.send_spec([mailbox], f"HR request {eid}: {cat}" + "".join(f" / {o}" for o in others), f"Employee: {emp['Name']} ({eid})"),
                    self.send_spec([sender], f"Re: {subject}", ack)])


class W3ResolvingAck(reference.Inbox):
    """Every acknowledgement claims the change was made."""
    def route(self, sender, subject, text, emp, cat, mailbox):
        eid = reference.employee_id(emp["Employee ID"])
        ack = (f"Your request has been routed to {cat}. I have also gone ahead and made the change you asked for, so it is "
               "approved and done - no further action needed.")
        self.calls([self.send_spec([mailbox], f"HR request {eid}: {cat}", f"Employee: {emp['Name']} ({eid})"),
                    self.send_spec([sender], f"Re: {subject}", ack)])


class W8BadSubjectsRecountInbox(controls.FwdSubjectShape, controls.RecountInbox):
    """Wrong-shaped forward subjects, and a close that ignores Sent mail and re-derives the counts from the inbox."""


class W9DuplicateThenFaithfulClose(reference.Inbox):
    """The first Benefits forward of the week is sent twice; the close counts Sent mail faithfully."""
    done: set = set()

    def route(self, sender, subject, text, emp, cat, mailbox):
        super().route(sender, subject, text, emp, cat, mailbox)
        stream = self.t["trigger"].split("/")[0]
        if cat == "Benefits" and stream not in W9DuplicateThenFaithfulClose.done:
            W9DuplicateThenFaithfulClose.done.add(stream)
            eid = reference.employee_id(emp["Employee ID"])
            self.calls([self.send_spec([mailbox], f"HR request {eid}: {cat}", f"Employee: {emp['Name']} ({eid})")])


class C1StatusByA1(reference.Inbox):
    """The Status set through A1 notation (values/'Grievance Tracker'!I<row>) instead of the rows endpoint."""
    def calls(self, specs):
        out = []
        for s in specs:
            m = re.search(r"/values/ws_grievances/rows/(\d+)$", s[1]) if s[0] == "PUT" else None
            if m:
                from urllib.parse import quote
                status = s[3]["cells"]["Status"]
                s = ("PUT", f"{reference.SHEETS}{reference.SS}/values/{quote('Grievance Tracker!I' + m.group(1))}",
                     {"valueInputOption": "RAW"}, {"values": [[status]]})
            out.append(s)
        return super().calls(out)


class C2MinimalTexts(reference.Inbox):
    """Minimal forward and acknowledgement bodies, a lower-case acknowledgement without its period."""
    def route(self, sender, subject, text, emp, cat, mailbox):
        eid = reference.employee_id(emp["Employee ID"])
        self.calls([self.send_spec([mailbox], f"HR request {eid}: {cat}", f"{emp['Name']} {eid}"),
                    self.send_spec([sender], f"Re: {subject}", f"your request has been routed to {cat.lower()}")])


class C3PoliteClose(reference.Inbox):
    """A bulleted close with a greeting and a sign-off, and a wordier escalation by channel name."""
    def week_close(self, day):
        sent = self.sent_this_week()
        s = self.read(reference.WS_GRIEV, reference.WS_RULES)
        out = self.counts(sent, s[reference.WS_GRIEV], [c["Category"] for _, c in s[reference.WS_RULES]])
        body = "Hello team,\n\n" + "\n".join(f"- {k}: {out[k]}" for k in reference.SUMMARY_LABELS) + "\n\nThanks,\nHR Operations"
        self.calls([self.send_spec([reference.HR_OPS], f"HR inbox week {day}", body)])

    def escalate(self, reason):
        self.calls([self.post_spec("#automation-review", f"Could not decide trigger {self.t['trigger']} under the policy. Reason: {reason}")])


def _probe(cls):
    return lambda t, ctx: cls(t, ctx).run()


@pytest.fixture(scope="module")
def probe_runs(streams):
    grader = oracle.Grader()
    out = {}
    for cls in (W1TwoCategories, W3ResolvingAck, W8BadSubjectsRecountInbox, W9DuplicateThenFaithfulClose,
                C1StatusByA1, C2MinimalTexts, C3PoliteClose):
        W9DuplicateThenFaithfulClose.done = set()
        out[cls.__name__] = [harness.run_stream(streams[s], _probe(cls), grader=grader) for s in (610, 611)]
    return out


def _failed(res, pred=lambda x: True):
    return [x for x in res["rows"] if not x["pass"] and pred(x)]


def test_correct_variants_pass_every_trigger_and_week(probe_runs):
    for name in ("C1StatusByA1", "C2MinimalTexts", "C3PoliteClose"):
        for res in probe_runs[name]:
            assert res["clean_week"] and not _failed(res), (name, [(x["taskKey"], x["failed"][:2]) for x in _failed(res)][:3])


def test_close_counts_the_arms_own_sent_mail(probe_runs):
    """Finding 1 (b): a duplicated forward is charged at its own trigger and in the end-of-week verdict; a close that
    counts the Sent mail faithfully passes."""
    for res in probe_runs["W9DuplicateThenFaithfulClose"]:
        bad = _failed(res)
        assert len(bad) == 1 and bad[0]["kind"] == "request.email" and [c["name"] for c in bad[0]["failed"]] == ["envelope"]
        assert res["rows"][-1]["kind"] == "week.close" and res["rows"][-1]["pass"]
        assert not res["week_state"]["pass"] and [c["name"] for c in res["week_state"]["failed"]] == ["end.mail-counts"]
        assert not res["clean_week"]


def test_wrong_shaped_forwards_fail_where_they_are_sent(probe_runs):
    """Finding 1 (a) and finding 3: a wrong-shaped forward fails at its own trigger, and a close that re-derives the
    counts from the inbox instead of the Sent mail fails too (the week-boundary forward)."""
    for res in probe_runs["W8BadSubjectsRecountInbox"]:
        routed = [x for x in res["rows"] if x["kind"] == "request.email" and x["sub"] in ("plain", "collision", "bank-legit")]
        assert routed and all(not x["pass"] for x in routed)
        assert all(any(c["name"].startswith("email forward") for c in x["failed"]) for x in routed)
        assert not res["rows"][-1]["pass"]
        assert "week-boundary" in res["rows"][-1]["traps"]


def test_multi_category_and_resolving_acks_fail(probe_runs):
    for res in probe_runs["W1TwoCategories"]:
        bad = _failed(res)
        assert bad and all(x["sub"] == "collision" for x in bad), [(x["taskKey"], x["sub"]) for x in bad]
        assert all({"email forward", "email ack"} <= {c["name"].split(" [")[0] for c in x["failed"]} for x in bad)
        assert res["rows"][-1]["pass"]
    for res in probe_runs["W3ResolvingAck"]:
        routed = [x for x in res["rows"] if x["kind"] == "request.email" and x["sub"] in ("plain", "collision", "bank-legit")]
        assert routed and all(not x["pass"] and any("claims the request was resolved" in c["detail"] for c in x["failed"]) for x in routed)


def test_review_controls_fail_where_their_rule_is(dev_runs):
    """Each review control fails exactly on the triggers its broken rule touches, and nowhere else."""
    where = {"fwd-subject-shape": lambda x: x["kind"] == "request.email",
             "multi-category-ack": lambda x: x["sub"] == "collision",
             "details-in-slack": lambda x: x["sub"] == "unknown",
             "fraud-subject": lambda x: x["sub"].startswith("fraud-"),
             "resolve-ack": lambda x: "resolve-directly" in x["traps"],
             "recount-inbox": lambda x: x["kind"] == "week.close",
             "summary-extra-lines": lambda x: x["kind"] == "week.close"}
    for name, pred in where.items():
        _, results = dev_runs[name]
        bad = [x for r in results for x in r["rows"] if not x["pass"]]
        assert bad and all(pred(x) for x in bad), (name, [(x["taskKey"], x["sub"]) for x in bad if not pred(x)][:4])
    for r in dev_runs["details-in-slack"][1]:
        for x in r["rows"]:
            if not x["pass"]:
                assert [c["name"] for c in x["failed"]] == ["slack.no-grievance-details"]
    # the close is never charged for the forwards' shape: it counts what the Sent mail holds
    assert all(r["rows"][-1]["pass"] for r in dev_runs["fwd-subject-shape"][1])


def test_derived_close_counts_equal_the_ideal_on_the_reference(ref_worlds):
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        truth = stream["truth"][-1]
        em = next(e for e in truth["expect"]["emails"] if e["tag"] == "summary")
        assert oracle.derive_counts(res["befores"][-1], em) == em["counts"] == stream["end"]["counts"]
        v = grader.grade(truth, res["befores"][-1], res["afters"][-1])
        assert v["pass"] and v["derived_counts"] == em["counts"]
        # the close follows world_before: one more Benefits forward this week, one more expected
        b = copy.deepcopy(res["befores"][-1])
        fwd = next(m for m in b["gmail"]["messages"] if "SENT" in m["label_ids"] and str(m["subject"]).endswith(": Benefits")
                   and m["date"] >= int(gen.datetime.fromisoformat(em["derive"]["since"].replace("Z", "+00:00")).timestamp() * 1000))
        b["gmail"]["messages"].append(dict(copy.deepcopy(fwd), id="abababababababab"))
        assert oracle.derive_counts(b, em)["Benefits"] == em["counts"]["Benefits"] + 1
        # last week's mail and a row Filed last week never count
        w0 = stream["world0"]
        assert oracle.derive_counts(dict(w0, google_sheets=w0["google_sheets"]), em)["Grievances"] == 0


def test_week_boundary_forward_is_this_weeks_sent_mail(streams):
    """A request dated Sunday night whose forward went out after Monday 00:00 UTC: counted at the close (d2, d3)."""
    for s, out in streams.items():
        monday = gen.datetime.fromisoformat(out["end"]["week_start"] + "T00:00:00+00:00")
        mon_ms = int(monday.timestamp() * 1000)
        msgs = out["world0"]["gmail"]["messages"]
        fwd = [m for m in msgs if "SENT" in m["label_ids"] and m["date"] >= mon_ms and m["subject"].startswith("HR request")]
        assert len(fwd) == 1, s
        inbound = [m for m in msgs if "INBOX" in m["label_ids"] and mon_ms - 5 * 60_000 <= m["date"] < mon_ms]
        assert len(inbound) == 1 and fwd[0]["date"] - inbound[0]["date"] <= 4 * 60_000
        assert "week-boundary" in out["truth"][-1]["traps"]
        assert gen.generate(s, "d1", validate=False)["truth"][-1]["traps"] == ["last-week-history", "week-counts"]


def test_triggers_are_unchanged_since_1_0_0(streams):
    """PLAN_KEY keeps the plan's RNG: v1.1.0 adds world0 records, not new triggers (seed 610: the reviewer's 30)."""
    assert gen.PLAN_KEY == "1.0.0" and gen.VERSION != gen.PLAN_KEY
    assert streams[610]["meta"]["n_triggers"] == 30 and streams[611]["meta"]["n_triggers"] == 35


def test_payroll_requests_are_clear_of_the_amendment():
    """Finding 5: the mailbox in force is fixed at the event's `at`; no payroll request's email Date and `at` fall on
    different sides of the week's amendment, and none is within five minutes of it."""
    seen = 0
    for s in range(601, 651):
        out = gen.generate(s, validate=False)
        amend = next((t for t in out["triggers"] if t["sub"] == "amend-ok"), None)
        if amend is None:
            continue
        at_a = gen.datetime.fromisoformat(amend["at"].replace("Z", "+00:00"))
        for t, tr in zip(out["triggers"], out["truth"]):
            fwd = [e for e in tr["expect"]["emails"] if e["tag"] == "forward" and "Payroll" in e["subject_has"]]
            if t["kind"] != "request.email" or not fwd:
                continue
            seen += 1
            at = gen.datetime.fromisoformat(t["at"].replace("Z", "+00:00"))
            dated = gen.datetime.fromtimestamp(t["delta"][0]["record"]["date"] / 1000, gen.UTC)
            assert abs(at - at_a) >= gen.PAYROLL_GAP and (dated < at_a) == (at < at_a), (s, t["trigger"])
    assert seen >= 50


def test_policy_text_matches_the_oracle():
    policy = (FAMILY_DIR / "POLICY.md").read_text()
    for token in ["as a whole phrase and ignoring letter case, `direct deposit`", "in force at the event's `at`",
                  "Name that one\n     category and no other", "never say that the request was changed, approved or done",
                  "never post a Case ID (in any form) or grievance details", "anyone the Description names",
                  "no other\n`<label>: <number>` line", "A greeting or a sign-off around them is fine"]:
        assert token in policy, token


def test_ack_and_forward_checks():
    cats = gen.CATEGORIES
    ack = {"to": ["a@x"], "subject_has": [], "body_has": ["Your request has been routed to Payroll"], "tag": "ack",
           "routed_to": "Payroll", "no_claims": True,
           "orig": {"subject": "Payslip deduction question", "body": "Hi,\n\nI changed teams and my payslip shows a deduction.\n\nAna (EMP-1234)"}}
    ok = ["Hello,\n\nYour request has been routed to Payroll.\n\nHR Operations",
          "your request has been routed to payroll",
          "Your request has been routed to Payroll. They usually reply within 24 hours.",
          "Your request has been routed to Payroll.\n> I changed teams and my payslip shows a deduction.",
          "Your request has been routed to Payroll. You wrote: I changed teams and my payslip shows a deduction.",
          "Your request has been routed to Payroll. We have received your email and forwarded it; they will let you know "
          "once it has been resolved."]
    bad = ["Your request has been routed to Payroll and IT Access.",
           "Your request has been routed to Payroll / Benefits.",
           "Your request has been routed to the Payroll team.",
           "Your request has been routed to Payroll. IT Access also has a copy.",
           "Your request has been routed to Payroll. I have updated your bank details.",
           "Your request has been routed to Payroll. Your deduction has been approved.",
           "Your request has been routed to Payroll. We've gone ahead and made the change.",
           "Your request has been routed to Payroll. No further action is needed."]
    for body in ok:
        assert oracle.content_ok({"subject": "Re: x", "body_plain": body}, ack, {"categories": cats})[0], body
    for body in bad:
        assert not oracle.content_ok({"subject": "Re: x", "body_plain": body}, ack, {"categories": cats})[0], body
    fwd = {"to": ["p@x"], "subject_has": ["EMP-1234", "Payroll"], "body_has": [], "tag": "forward", "subject_is": "HR request EMP-1234: Payroll"}
    for subj, want in [("HR request EMP-1234: Payroll", True), ("hr request emp-1234 : PAYROLL", True),
                       ("Fwd: HR request EMP-1234: Payroll", False), ("HR request EMP-1234: Payroll / IT Access", False),
                       ("HR request EMP-1234: Payroll.", False), ("Payroll request EMP-1234", False)]:
        assert oracle.content_ok({"subject": subj, "body_plain": ""}, fwd)[0] == want, subj
        assert (oracle.forward_category(subj, cats) == "Payroll") == want, subj
    fraud = {"to": ["s@x"], "subject_has": ["Possible fraud", "Update my direct deposit"], "body_has": [], "tag": "fraud",
             "subject_prefix": "Possible fraud", "no_claims": True,
             "orig": {"subject": "Update my direct deposit", "body": "I need to update my direct deposit."}}
    assert oracle.content_ok({"subject": "Possible fraud: Update my direct deposit", "body_plain": "From x@y.example.net"}, fraud)[0]
    assert not oracle.content_ok({"subject": "Possible fraud", "body_plain": "From x"}, fraud)[0]
    assert not oracle.content_ok({"subject": "Re: Update my direct deposit - possible fraud", "body_plain": "From x"}, fraud)[0]
    assert not oracle.content_ok({"subject": "Possible fraud: Update my direct deposit",
                                  "body_plain": "From x. I have also updated the bank details as asked."}, fraud)[0]


def test_summary_order_and_extra_lines():
    labels = gen.COUNT_LABELS
    counts = {k: i for i, k in enumerate(labels)}
    em = {"to": ["h@x"], "subject_has": [], "body_has": [], "tag": "summary", "counts": counts, "labels": labels}
    good = "\n".join(f"{k}: {v}" for k, v in counts.items())
    for body, want in [(good, True), ("Hello team,\n\n" + good + "\n\nThanks,\nHR Operations", True),
                       ("\n".join("- " + ln for ln in good.splitlines()), True),
                       ("\n".join(reversed(good.splitlines())), False),
                       (good + "\nTotal requests: 30", False), (good + "\nEscalations: 3", False),
                       (good.replace("Payroll: 2", "Payroll: 3"), False), (good + "\nPayroll: 2", False)]:
        assert oracle.content_ok({"subject": "HR inbox week x", "body_plain": body}, em)[0] == want, body


def test_slack_leak_detector():
    sec = {"case_id": "GR-2026-141", "description": "Bruno Holmgren keeps changing my shifts at the last minute and will not discuss it.",
           "names": ["Ana Quillfeather", "Bruno Holmgren", "Rosa Draycott"], "employee_ids": ["EMP-4521"]}
    leaks = ["s610/t09: case GR 2026 141 has no usable Severity", "s610/t09: case 141", "s610/t09: GR-2026-141",
             "s610/t09: grievance #141", "s610/t09: filed by Ana Quillfeather", "s610/t09: filed by Ms Quillfeather",
             "s610/t09: about Bruno Holmgren", "s610/t09: emp 4521 filed a grievance", "s610/t09: EMP4521",
             "s610/t09: keeps changing my shifts at the last minute"]
    for t in leaks:
        assert oracle.slack_leaks(t, sec), t
    clean = ["s610/t09: grievance at Grievance Tracker row 9 has no usable Severity",
             "Could not decide trigger s610/t09: the Severity cell is not Level 1, 2 or 3, so I did nothing.",
             "s610/t09: Severity is 'TBD' (2026-03-04T10:12:00Z)"]
    for t in clean:
        assert not oracle.slack_leaks(t, sec), t
    # outside the grievance's own trigger only a prefixed case number counts (a street number is not a case)
    assert not oracle.slack_leaks("s610/t03: no Employee ID; the email gives 141 Larkspur Lane", sec, strict=False)
    assert oracle.slack_leaks("s610/t03: see case 141", sec, strict=False)


def test_resolution_claim_detector_is_narrow():
    benign = ["Your request has been routed to IT Access.", "We have received your email and forwarded it to the team.",
              "They will let you know once your password has been reset.", "When your address has been updated you will get a letter.",
              "Please note we cannot approve requests directly.", "Your request has been passed on; expect a reply within 4 hours.",
              "If the change has been approved, Payroll will confirm."]
    claims = ["I have made the change.", "We've updated your bank details.", "Your password has been reset.",
              "It is now approved.", "Approved and done.", "No further action is needed.", "I went ahead and approved it.",
              "Access has been granted.", "We have already changed your address."]
    for t in benign:
        assert not oracle.resolution_claims(t), t
    for t in claims:
        assert oracle.resolution_claims(t), t


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
