"""abr-fin-receipts tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-fin-receipts/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import copy
import json
import re
import sys
from collections import Counter
from datetime import date
from decimal import Decimal
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
    "no-dedupe": {"repost", "repost-history", "repost-fixed"}, "no-cap": {"meal-cap"},
    "cap-all-meals": {"team-meal", "cap-under"}, "cap-week-only": {"cap-history"},
    "any-corrector": {"wrong-corrector"}, "any-approver": {"wrong-approver"}, "name-approver": {"namesake"},
    "contains-approved": {"approval-negated"}, "field-category": {"synonym"}, "digits-only": {"words-amount"},
    "drinks-ok": {"drinks"}, "slack-name": {"display-name"}, "no-preapproval": {"pending"},
    "log-rejected": {"rule-category", "rule-receipt", "rule-meal", "rule-hotel", "rule-flight", "meal-cap"},
    "total-all-weeks": {"week-total"}, "no-receipt-rule": {"rule-receipt"}, "domestic-only": {"hotel-intl"},
    "cabin-ignored": {"rule-flight", "flight-six"}, "six-hours-ok": {"flight-six"}, "correction-append": {"correction"},
    "unknown-logged": {"unknown-poster"}, "date-posted": {"date-format", "cap-history", "near-dup"}}


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
        assert lo <= out["meta"]["n_triggers"] <= hi and 30 <= out["meta"]["n_triggers"] <= 50
        kinds = Counter(t["kind"] for t in out["triggers"])
        for kind, spec in FAMILY["triggerKinds"].items():
            assert spec[d][0] <= kinds[kind] <= spec[d][1], (s, kind, kinds[kind])
            assert spec["perWeek"][0] <= kinds[kind] <= spec["perWeek"][1]
        ats = [t["at"] for t in out["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        last = out["triggers"][-1]
        assert last["kind"] == "week.close" and last["at"].endswith("T16:00:00Z")
        assert date.fromisoformat(last["at"][:10]).weekday() == 4
        assert all(date.fromisoformat(t["at"][:10]).weekday() < 5 for t in out["triggers"])


def test_d1_smoke_stream_plants_no_format_traps():
    out = gen.generate(605, "d1")
    labels = {x for t in out["truth"] for x in t["traps"]}
    assert not labels & {"synonym", "words-amount", "currency-format", "date-format", "drinks", "hotel-intl",
                         "flight-six", "near-dup", "unknown-poster", "namesake", "display-name"}, labels


def test_trap_rates_near_design(streams):
    for out in streams.values():
        r, t = out["meta"]["receipt_trap_share"], out["meta"]["trigger_trap_share"]
        if out["meta"]["difficulty"] == "d2":
            assert 0.15 <= r <= 0.50 and 0.30 <= t <= 0.65, (r, t)
        else:
            assert 0.45 <= r <= 0.80 and 0.55 <= t <= 0.85, (r, t)


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert set(g["by_kind"]) >= set(gates.TRAP_KINDS)


def test_fictional_entities_only(streams):
    for out in streams.values():
        w = out["world0"]
        for u in w["slack"]["users"]:
            assert u["email"].endswith(".example.com"), u["email"]
        for r in w["google_sheets"]["rows"]:
            for k in ("Email", "Manager Email"):
                if k in r["cells"]:
                    assert r["cells"][k].endswith("@company.example.com")
        for m in w["gmail"]["messages"]:
            assert all(a.endswith("@company.example.com") for a in m["to"] + [m["from_"]])


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


def test_truth_follows_the_state_across_triggers(streams):
    """Pending receipts are approved by a later trigger; rejected ones are logged by a later correction; reposts and
    wrong-person replies expect nothing at all."""
    approved = fixed = quiet = 0
    for out in streams.values():
        pend = {r["cells"]["Message TS"]: t["index"] for t in out["truth"] for r in t["expect"]["new_rows"]
                if r["cells"]["Status"] == gen.PENDING}
        rejected = {x: t["index"] for t in out["truth"] if t["kind"] == "receipt.posted" for x in t["expect"]["no_row"]}
        for t in out["truth"]:
            if "approval" in t["traps"]:
                (u,) = t["expect"]["set_rows"]
                assert u["cells"]["Status"] == gen.APPROVED
                if u["message_ts"] in pend:
                    assert pend[u["message_ts"]] < t["index"]
                approved += 1
            if "correction-fix" in t["traps"]:
                (row,) = t["expect"]["new_rows"]
                assert rejected[row["cells"]["Message TS"]] < t["index"]
                fixed += 1
            if t["kind"] == "receipt.reposted" or set(t["traps"]) & {"wrong-corrector", "wrong-approver", "approval-negated",
                                                                    "approval-again"}:
                ex = t["expect"]
                assert t["outcome"] == "no-op" and not (ex["new_rows"] or ex["set_rows"] or ex["replies"] or ex["email"])
                quiet += 1
    assert approved >= 5 and fixed >= 3 and quiet >= 15, (approved, fixed, quiet)


def test_canonical_rules_at_the_boundaries():
    """POLICY.md section 8: 'over' is strictly more."""
    base = {"category": "Meals", "amount": Decimal("50.00"), "date": date(2026, 3, 4), "attendees": None,
            "receipt": True, "alcohol": False, "client": None, "hotel": None, "flight": None}
    assert gen.decide(base, Decimal("0"))[0] == gen.APPROVED
    assert gen.decide(dict(base, amount=Decimal("50.01")), Decimal("0"))[1] == "Over individual meal limit"
    assert gen.decide(dict(base, amount=Decimal("75.01")), Decimal("0"))[1] == "Attendees required"
    assert gen.decide(dict(base, amount=Decimal("300.00"), attendees=4), Decimal("0"))[0] == gen.APPROVED
    assert gen.decide(dict(base, amount=Decimal("300.04"), attendees=4), Decimal("0"))[1] == "Over team meal limit"
    assert gen.decide(dict(base, amount=Decimal("40.00")), Decimal("60.00"))[0] == gen.APPROVED
    assert gen.decide(dict(base, amount=Decimal("40.01")), Decimal("60.00"))[1] == "Over daily meal cap"
    assert gen.decide(dict(base, amount=Decimal("300.00"), attendees=4), Decimal("90.00"))[0] == gen.APPROVED
    assert gen.decide(dict(base, category="Travel", amount=Decimal("25.00"), receipt=False), Decimal("0"))[0] == gen.APPROVED
    assert gen.decide(dict(base, category="Travel", amount=Decimal("25.01"), receipt=False), Decimal("0"))[1] == "Receipt required"
    fl = {"cabin": "business", "hours": Decimal("6")}
    assert gen.decide(dict(base, category="Travel", amount=Decimal("900"), flight=fl), Decimal("0"))[1].startswith("Economy only")
    fl = {"cabin": "business", "hours": Decimal("6.25")}
    assert gen.decide(dict(base, category="Travel", amount=Decimal("900"), flight=fl), Decimal("0"))[0] == gen.PENDING
    h = {"nights": 2, "intl": False}
    assert gen.decide(dict(base, category="Travel", amount=Decimal("500.00"), hotel=h), Decimal("0"))[0] == gen.APPROVED
    assert gen.decide(dict(base, category="Travel", amount=Decimal("500.02"), hotel=h), Decimal("0"))[1] == "Over hotel nightly limit"
    assert gen.decide(dict(base, category="Travel", amount=Decimal("680"), hotel={"nights": 2, "intl": True}), Decimal("0"))[0] == gen.PENDING
    assert gen.decide(dict(base, alcohol=True, attendees=3, amount=Decimal("90")), Decimal("0"))[1] == "Alcohol needs a client name"
    assert gen.decide(dict(base, alcohol=True, client="Corvane Media", attendees=3, amount=Decimal("90")), Decimal("0"))[0] == gen.APPROVED
    assert gen.decide(dict(base, category="Gifts"), Decimal("0"))[1] == "Gifts needs VP pre-approval"
    assert gen.decide(dict(base, category="Consulting", amount=Decimal("500.00")), Decimal("0"))[0] == gen.APPROVED
    assert gen.decide(dict(base, category="Consulting", amount=Decimal("500.01")), Decimal("0"))[0] == gen.PENDING


def test_reading_agrees_with_the_generators_facts():
    """The narrow judgment: the reference's text reading of every receipt (world0 and the week, practice and dev seeds)
    equals the structured facts the truth was computed from."""
    n = Counter()
    for s in PRACTICE + DEV:
        g = gen.Gen(s, gen.default_difficulty(s))
        out = g.run()
        texts = {m["ts"]: (m["text"], m.get("attachments") or []) for m in out["world0"]["slack"]["messages"]}
        texts.update({p["data"]["ts"]: (p["data"]["text"], p["data"]["attachments"]) for p in out["payloads"]
                      if p["app"] == "slack"})
        rd = reference.Receipts({"trigger": "x"}, None)
        for ts, rc in g.receipts.items():
            text, att = texts[ts]
            f, want = rd.read(text, att, reference.ts_date(ts)), rc["facts"]
            assert f is not None, text
            for k in ("amount", "date", "category", "attendees", "receipt", "alcohol"):
                assert f[k] == want[k], (k, text, f[k], want[k])
            assert bool(f["client"]) == bool(want["client"]), text
            assert (f["hotel"] is None) == (want["hotel"] is None), text
            if want["hotel"]:
                assert f["hotel"] == want["hotel"], text
            assert (f["flight"] is None) == (want["flight"] is None), text
            if want["flight"]:
                assert (f["flight"]["cabin"] == "economy") == (want["flight"]["cabin"] == "economy"), text
                assert (f["flight"]["hours"] > 6) == (want["flight"]["hours"] > 6), text
            n["receipts"] += 1
            n["words"] += "dollars" in text
            n["no-category"] += "category:" not in text
    assert n["receipts"] >= 400 and n["words"] >= 15 and n["no-category"] >= 15, n


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
            # the kind of a message (receipt, repost, correction, approval) is never in the payload
            assert "kind" not in json.dumps(p) and "sub" not in p


# -- reference -----------------------------------------------------------------------------------------------------------
def test_reference_passes_dev_seeds(dev_runs):
    summary, results = dev_runs["reference"]
    assert summary["pass_rate"] >= 0.95                                  # the acceptance bar
    assert summary["passed"] == summary["triggers"] and summary["clean_weeks"] == len(DEV), summary
    assert summary["max_steps"] <= 49


def test_reference_passes_practice_seeds_and_rebased_mode():
    s, _ = harness.run("reference", PRACTICE)
    assert s["passed"] == s["triggers"] and s["clean_weeks"] == len(PRACTICE), s
    s, _ = harness.run("reference", [610, 611], mode="rebased")
    assert s["passed"] == s["triggers"], s


def test_reference_is_observable_only():
    g = gates.gate_leakage([610])
    assert set(g["reference_imports"]) <= {"__future__", "base64", "json", "re", "datetime", "decimal", "urllib"}
    src = (FAMILY_DIR / "reference.py").read_text()
    for host in (r"import gen\b", r"import oracle\b", r"\btruth\b", r"\bworld0\b", r"\bdelta\b"):
        assert not re.search(host, src), host


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


def test_top_level_reply_control_fails_every_reply(dev_runs):
    _, results = dev_runs["top-level-reply"]
    rows = [x for r in results for x in r["rows"] if x["kind"] == "receipt.posted" and x["expected"] == "act"]
    assert rows and not any(x["pass"] for x in rows)


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
            if truth["outcome"] != "no-op":
                assert v["outcome"] == "miss"
            echoed = copy.deepcopy(before)
            gates._post(echoed, gen.CHAN, json.dumps(truth["trigger"]), 1)
            assert not grader.grade(truth, before, echoed)["pass"]


def test_oracle_rejects_plausible_but_wrong_runs(ref_worlds):
    """The reference's own world with one plausible slip: a logged amount one cent off, the reply in the channel
    instead of the thread, or a rejected receipt logged anyway. Each is graded wrong."""
    grader = oracle.Grader()
    n = Counter()
    for stream, res in ref_worlds:
        for truth, before, after in zip(stream["truth"], res["befores"], res["afters"]):
            new, _ = gates._changed_rows(before, after)
            for i in new[:1]:
                w = copy.deepcopy(after)
                c = w["google_sheets"]["rows"][i]["cells"]
                c["Amount"] = f"{Decimal(c['Amount']) + Decimal('0.01'):.2f}"
                v = grader.grade(truth, before, w)
                assert not v["pass"] and v["outcome"] == "wrong"
                n["amount"] += 1
            for i in [j for j in gates._new_msgs(before, after) if after["slack"]["messages"][j].get("thread_ts")][:1]:
                w = copy.deepcopy(after)
                w["slack"]["messages"][i].pop("thread_ts")
                v = grader.grade(truth, before, w)
                assert not v["pass"] and v["outcome"] == "wrong"
                n["thread"] += 1
            if truth["kind"] == "receipt.posted" and truth["expect"]["no_row"] and truth["expect"]["replies"]:
                w = copy.deepcopy(after)
                ts = truth["expect"]["no_row"][0]
                w["google_sheets"]["rows"].append({"id": "plausible0001", "spreadsheet_id": gen.SS, "worksheet_id": gen.WS_SUB,
                                                   "row_id": 990, "cells": {"Message TS": ts, "Status": gen.APPROVED}})
                v = grader.grade(truth, before, w)
                assert not v["pass"] and v["outcome"] == "wrong"
                n["logged-rejected"] += 1
    assert n["amount"] >= 30 and n["thread"] >= 40 and n["logged-rejected"] >= 10, n


def test_oracle_mutation_score():
    g = gates.gate_mutation([610, 611])
    assert g["pass"] and g["score"] >= 0.95, g
    assert len(g["operators"]) >= 30


def test_oracle_specificity_no_false_rejects():
    g = gates.gate_specificity([610])
    assert g["pass"], g["rejected"]


def test_abstention_is_not_credit(ref_worlds):
    grader = oracle.Grader()
    stream, res = ref_worlds[0]
    k = next(i for i, t in enumerate(stream["truth"]) if t["kind"] == "receipt.posted" and t["outcome"] == "act")
    before = res["befores"][k]
    w = copy.deepcopy(before)
    gates._post(w, gen.REVIEW, f"{stream['truth'][k]['trigger']}: not sure about this receipt", 1)
    v = grader.grade(stream["truth"][k], before, w)
    assert not v["pass"] and v["outcome"] == "abstained"


def test_escalation_truth_needs_the_sink_post(streams):
    """An unknown poster's receipt expects exactly one #automation-review post naming the trigger, and nothing else."""
    grader = oracle.Grader()
    seen = 0
    for s in (611, 613):
        stream = streams[s]
        res = harness.run_stream(stream, reference.handle, grader=grader, keep_worlds=True)
        for k, t in enumerate(stream["truth"]):
            if t["outcome"] != "escalate":
                continue
            before, after = res["befores"][k], res["afters"][k]
            assert grader.grade(t, before, after)["pass"]
            v = grader.grade(t, before, before)
            assert not v["pass"] and v["outcome"] == "miss"
            seen += 1
    assert seen == 2


def test_end_of_week_is_graded_at_the_last_trigger(ref_worlds):
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
        ok = grader.grade(truth, before, after, stream["end"], stream["world0"])
        plain = grader.grade(truth, before, after)
        assert ok["pass"] and ok["n_checks"] - plain["n_checks"] == 9     # the nine end-of-week checks ran and passed
        # an earlier logged row silently changed in the final world: invisible to the week-close trigger, caught at
        # week end
        w0, w1 = copy.deepcopy(before), copy.deepcopy(after)
        for w in (w0, w1):
            row = next(r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_SUB
                       and r["cells"]["Status"] == gen.APPROVED and r["cells"]["Submitted"] >= stream["end"]["week_start"])
            row["cells"]["Category"] = "Consulting" if row["cells"]["Category"] != "Consulting" else "Travel"
        v = grader.grade(truth, w0, w1, stream["end"], stream["world0"])
        assert not v["pass"] and any(c["name"] in ("end.submissions", "end.ab") for c in v["failed"])
        # an earlier automation reply deleted
        w0, w1 = copy.deepcopy(before), copy.deepcopy(after)
        human = {tuple(x) for x in stream["end"]["human"]}
        bot = [m for m in w1["slack"]["messages"] if m.get("thread_ts") and (m["channel_id"], m["ts"]) not in human
               and m["ts"] not in {x["ts"] for x in stream["world0"]["slack"]["messages"]}]
        for w in (w0, w1):
            w["slack"]["messages"] = [m for m in w["slack"]["messages"] if m["ts"] != bot[0]["ts"]]
        v = grader.grade(truth, w0, w1, stream["end"], stream["world0"])
        assert not v["pass"] and any(c["name"] == "end.replies" for c in v["failed"])


# -- policy and grounding ----------------------------------------------------------------------------------------------
def test_policy_states_the_parameters_the_generator_uses():
    policy = (FAMILY_DIR / "POLICY.md").read_text()
    for s in (gen.SS, gen.WS_SUB, gen.WS_EMP, gen.WS_POL, "#expense-submissions", "#automation-review", gen.FINANCE,
              "Logged: $<amount> <Category>", "Pending pre-approval: $<amount> <Category>", "Rejected: <reason>",
              "Weekly expense totals <week_start>", "Pending pre-approval: <N>", "Total: $", "thread_ts", "[file: <name>]",
              "receipt: yes", "client: <name>", "pre-approved", "Correction", "$1,250.00", "1250.00"):
        assert s in policy, s
    for h in gen.SUB_HEADERS + gen.EMP_HEADERS:
        assert h in policy, h
    for cat, words in gen.CATEGORY_WORDS.items():
        assert cat in policy
        for w in words:
            assert w in policy, w
    for w in gen.ALCOHOL_WORDS:
        assert w.split()[0] in policy, w
    for reason in ("needs VP pre-approval", "Receipt required", "Alcohol needs a client name", "Attendees required",
                   "Over individual meal limit", "Over team meal limit", "Over daily meal cap", "Over hotel nightly limit",
                   "Economy only for flights up to 6 hours"):
        assert reason in policy, reason
    for limit in ("$25", "$50", "$75", "$100", "$250", "$350", "$500", "6 hours"):
        assert limit in policy, limit


def test_policy_sheet_matches_the_policy():
    """The Expense Policy worksheet is a summary for people; its numbers must not contradict POLICY.md."""
    text = " ".join(d for _, d in gen.POLICY_ROWS)
    for limit in ("$75", "$50", "$100", "$250", "$350", "6 hours", "$500", "$25"):
        assert limit in text, limit
    assert set(re.findall(r"\$\d+", text)) <= {"$75", "$50", "$100", "$250", "$350", "$500", "$25"}


def test_grounding_spans_point_at_the_public_tasks():
    tasks = FAMILY_DIR.parents[3] / "corpus" / "AutomationBench" / "automationbench" / "domains" / "finance" / "tasks.py"
    if not tasks.exists():
        pytest.skip("corpus/AutomationBench not cloned")
    lines = tasks.read_text().splitlines()
    for g, fn in zip(FAMILY["grounding"], ("def get_fin_slack_receipt_capture_task",
                                           "def get_fin_expense_policy_violation_task")):
        a, b = (int(x) for x in g["span"].split(":")[1].split("-"))
        assert lines[a - 1].startswith(fn), (g["task"], lines[a - 1])
        assert f'"{g["task"]}"' in "\n".join(lines[a - 1:b])
