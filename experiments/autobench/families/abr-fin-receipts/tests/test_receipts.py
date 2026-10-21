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
    "unknown-logged": {"unknown-poster"}, "date-posted": {"date-format", "cap-history", "near-dup"},
    # generator 1.1.0 (review 2026-10-21)
    "no-recheck": {"correction-recheck"}, "no-pending-check": {"approval-again", "approval-not-pending"},
    "repost-rel-now": {"repost-relative", "near-dup-relative"}, "category-first": {"repost-terse"},
    "cap-counts-rejected": {"cap-rejected-row"}, "total-counts-rejected": {"total-rejected-row"},
    "cap-counts-own-row": {"correction-own-row"}, "latest-correction-only": {"correction-multi"},
    "correction-receipt-day": {"correction-relative-date"}, "preapproval-forgotten": {"correction-preapproved"},
    "preapproval-any-time": {"correction-early-approval"}}


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
        assert lo <= out["meta"]["n_triggers"] <= hi and 30 <= out["meta"]["n_triggers"] <= 60
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
                                                                    "approval-again", "approval-not-pending"}:
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


# -- review 2026-10-21 regressions (generator 1.1.0) ---------------------------------------------------------------------
def test_d3_weeks_carry_every_correction_state():
    """Every d3 week exercises the POLICY.md 5.1 / 5.2 branches 1.0.0 never generated: a re-check that changes the
    outcome (to Pending and to Rejected), the cap's own-row rule, two corrections in a thread, a relative date in a
    correction, a pre-approval that survives a correction and one given while the row was not pending, a Rejected row
    in a later cap and in the weekly totals, a repeated and a not-pending approval, and reposts and a near-duplicate
    read relative to their own dates."""
    for s in range(601, 651):
        if gen.default_difficulty(s) != "d3":
            continue
        out = gen.generate(s, validate=False)
        labels = Counter(x for t in out["truth"] for x in t["traps"])
        assert not [x for x in gates.D3_REQUIRED if not labels[x]], (s, [x for x in gates.D3_REQUIRED if not labels[x]])
        corr = [t for t in out["truth"] if t["kind"] == "receipt.corrected" and t["expect"]["replies"]]
        texts = [t["expect"]["replies"][0]["text"] for t in corr]
        assert any(x.startswith("Rejected:") for x in texts) and any(x.startswith("Pending pre-approval:") for x in texts), (s, texts)
        statuses = {r["cells"]["Status"] for t in corr for r in t["expect"]["set_rows"]}
        assert {gen.REJECTED, gen.PENDING, gen.APPROVED} <= statuses, (s, statuses)


def test_d2_weeks_plant_approval_again_in_about_half():
    d2 = [s for s in range(601, 651) if gen.default_difficulty(s) == "d2"]
    again = sum(any("approval-again" in t["traps"] for t in gen.generate(s, validate=False)["truth"]) for s in d2)
    assert 0.3 <= again / len(d2) <= 0.7, (again, len(d2))


def test_rejected_row_reaches_a_later_cap_and_the_weekly_email(streams):
    """A correction rejects a logged individual meal (row Status Rejected); a later meal of the same employee and day
    passes only when the Rejected row is not counted, and the week's totals leave it out."""
    seen = 0
    for s in (611, 613):
        out = streams[s]
        tr = next(t for t in out["truth"] if "cap-rejected-row" in t["traps"])
        (row,) = tr["expect"]["new_rows"]
        assert row["cells"]["Status"] == gen.APPROVED and row["cells"]["Category"] == "Meals"
        rejected = [r for ts, r in out["end"]["rows"].items() if r["Status"] == gen.REJECTED
                    and r["Employee"] == row["cells"]["Employee"] and r["Date"] == row["cells"]["Date"]]
        assert rejected
        rej_corr = next(t for t in out["truth"] if t["kind"] == "receipt.corrected"
                        and any(u["message_ts"] == rejected[0]["Message TS"] for u in t["expect"]["set_rows"]))
        assert rej_corr["index"] < tr["index"]
        assert Decimal(rejected[0]["Amount"]) + Decimal(row["cells"]["Amount"]) > 100
        close = out["truth"][-1]
        assert "total-rejected-row" in close["traps"]
        want_total = sum(Decimal(r["Amount"]) for r in out["end"]["rows"].values() if r["Status"] == gen.APPROVED
                         and out["end"]["week_start"] <= r["Submitted"] <= out["end"]["friday"])
        assert f"Total: ${want_total:,.2f}" in close["expect"]["email"]["lines"]
        seen += 1
    assert seen == 2


def test_no_recheck_control_fails_every_d3_week(dev_runs):
    """The review's control: apply the corrected values, never re-check a rule. It passed 1,186/1,186 triggers on
    1.0.0; now it fails every d3 week, on triggers labelled correction-recheck."""
    _, results = dev_runs["no-recheck"]
    for res in results:
        failed = [x for x in res["rows"] if not x["pass"]]
        if res["difficulty"] == "d3":
            assert not res["clean_week"]
            assert any("correction-recheck" in x["traps"] for x in failed), res["seed"]


def test_no_pending_check_control_fails_on_approval_again(dev_runs):
    _, results = dev_runs["no-pending-check"]
    failed = [x for r in results for x in r["rows"] if not x["pass"]]
    assert any("approval-again" in x["traps"] for x in failed)
    assert any("approval-not-pending" in x["traps"] for x in failed)


@pytest.mark.parametrize("name", sorted(gates.RARE_CONTROLS))
def test_rarer_rule_controls_fail_on_their_traps(name):
    """travel-facts-kept and cabin-anywhere are the 1.0.0 reference's own departures from POLICY.md 5.1 and 7; their
    traps are drawn at random, so they are checked on the first dev-range seeds that carry them."""
    label = gates.RARE_CONTROLS[name]
    seeds = gates.rare_seeds(label)
    assert len(seeds) == 2, (label, seeds)
    ref, _ = harness.run("reference", seeds)
    assert ref["passed"] == ref["triggers"], ref
    summary, results = harness.run(name, seeds)
    failed = [x for r in results for x in r["rows"] if not x["pass"]]
    assert summary["clean_weeks"] == 0 and any(label in x["traps"] for x in failed), (name, seeds, summary)


def test_reference_follows_the_policy_text_where_the_review_found_departures():
    """(a) a category corrected to Travel re-reads the hotel; (c) the repost check comes before the category; (d) a
    'business' that is not a cabin is economy. (b), a pre-approval given while not pending, is covered by the
    preapproval-any-time control."""
    rd = reference.Receipts({"trigger": "x"}, None)
    day = date(2026, 6, 23)
    text = "Expense: Harborview Hotel in Denver, 2 nights, $612.40, category: Consulting, receipt: yes"
    f = rd.read(text, [], day)
    assert f["category"] == "Consulting" and f["hotel"] is None
    g = rd.apply_correction(f, "Correction: category should be Travel", [], day, text)
    assert g["category"] == "Travel" and g["hotel"] == {"nights": 2, "intl": False}
    assert rd.check(g, Decimal("0")) == (None, "Over hotel nightly limit")
    assert rd.head("Did my $45.00 from Jun 22 get logged?", day) == {"amount": Decimal("45.00"), "date": date(2026, 6, 22)}
    with pytest.raises(reference.Undecidable):
        rd.category("Did my $45.00 from Jun 22 get logged?")
    for desc, cabin in (("Flight Denver to Boston for a business meeting, 4h", "economy"),
                        ("Airfare Austin - Seattle (business trip), 3h 30m", "economy"),
                        ("Flight Denver to Boston, business, 4h", "other"),
                        ("Flight Denver to Boston, business class, 4h", "other"),
                        ("Flight Denver to Boston, first class, 4h", "other"),
                        ("Flight Denver to Boston, premium economy, 4h", "other")):
        assert rd.flight(desc, "Travel")["cabin"] == cabin, desc


def test_correction_replay_counts_a_preapproval_only_on_a_pending_row():
    """5.2: the manager's 'pre-approved' given while the row was Approved never counts, even after a later correction
    makes the receipt pending; one given while pending still counts after a correction (5.1)."""
    for s in (611, 613):
        out = gen.generate(s, validate=False)
        early = [t for t in out["truth"] if "correction-early-approval" in t["traps"]]
        kept = [t for t in out["truth"] if "correction-preapproved" in t["traps"]]
        assert early and all(t["expect"]["replies"][0]["text"].startswith("Pending pre-approval:") for t in early)
        assert kept and all(t["expect"]["replies"][0]["text"].startswith("Logged:") for t in kept)


def _weekly_email_world(ref_worlds):
    stream, res = ref_worlds[1]
    k = len(stream["truth"]) - 1
    before, after = res["befores"][k], res["afters"][k]
    i = gates._new_mail(before, after)[0]
    return stream, k, before, after, i


def test_oracle_accepts_email_layouts_the_policy_leaves_open(ref_worlds):
    """Review defect: a dated header line, list markers and an HTML body were graded wrong. POLICY.md section 6 lists
    the required lines and forbids none of these, so they pass; wrong or extra lines behind them still fail."""
    grader = oracle.Grader()
    stream, k, before, after, i = _weekly_email_world(ref_worlds)
    truth, week = stream["truth"][k], stream["end"]["week_start"]
    plain = after["gmail"]["messages"][i]["body_plain"]
    lines = plain.splitlines()
    ok = {"header": f"Weekly expense totals for the week of {week}:\n" + plain,
          "dash": "\n".join("- " + x for x in lines), "star": "\n".join("* " + x for x in lines),
          "dot": "\n".join("• " + x for x in lines), "numbered": "\n".join(f"{n}. {x}" for n, x in enumerate(lines, 1)),
          "html-in-plain": "<p>" + "<br>".join(lines) + "</p>",
          "greeting": "Hi Finance,\n\n" + "\n".join(reversed(lines)) + "\n\nThanks"}
    for name, body in ok.items():
        w = copy.deepcopy(after)
        w["gmail"]["messages"][i]["body_plain"] = body
        v = grader.grade(truth, before, w)
        assert v["pass"], (name, v["failed"])
    w = copy.deepcopy(after)
    w["gmail"]["messages"][i].update(body_plain=None, body_html="<p>" + "<br>".join(lines) + "</p>")
    assert grader.grade(truth, before, w)["pass"]
    bad = {"extra-bullet": "\n".join("- " + x for x in lines) + "\n- Someone Else: $10.00",
           "wrong-total-html": "<p>" + "<br>".join(re.sub(r"Total: \$([\d,]+)\.(\d\d)", lambda m: f"Total: ${m.group(1)}.{(int(m.group(2)) + 1) % 100:02d}", x)
                                                    for x in lines) + "</p>",
           "missing-line": "\n".join("* " + x for x in lines[1:]),
           "money-header": f"Weekly total for {week}: $1.00\n" + plain}
    for name, body in bad.items():
        w = copy.deepcopy(after)
        w["gmail"]["messages"][i]["body_plain"] = body
        v = grader.grade(truth, before, w)
        assert not v["pass"] and v["outcome"] == "wrong", name


def test_oracle_enforces_the_amount_cell_format(ref_worlds):
    """Review defect: POLICY.md section 4 writes Amount as `1250.00` (no `$`, no commas, two decimals). Text cells in
    any other format fail, at the trigger and at week end; a number cell of the same value passes."""
    grader = oracle.Grader()
    stream, res = ref_worlds[1]
    n = 0
    for truth, before, after in zip(stream["truth"], res["befores"], res["afters"]):
        new, _ = gates._changed_rows(before, after)
        if not new:
            continue
        i = new[0]
        a = Decimal(after["google_sheets"]["rows"][i]["cells"]["Amount"])
        for bad in (f"${a:,.2f}", f"{a:.3f}", f"${a:.2f}", f"{a:.1f}") + ((f"{a:,.2f}",) if a >= 1000 else ()):
            w = copy.deepcopy(after)
            w["google_sheets"]["rows"][i]["cells"]["Amount"] = bad
            v = grader.grade(truth, before, w)
            assert not v["pass"] and v["outcome"] == "wrong", (truth["trigger"], bad)
        for good in (float(a), f" {a:.2f} "):
            w = copy.deepcopy(after)
            w["google_sheets"]["rows"][i]["cells"]["Amount"] = good
            assert grader.grade(truth, before, w)["pass"], (truth["trigger"], good)
        n += 1
    assert n >= 20
    assert not oracle.cells_equal({"Amount": "$145"}, {"Amount": "145.00"}) == []
    assert oracle.amount_cell_ok(145, "145.00") and not oracle.amount_cell_ok("145", "145.00")
    assert not oracle.amount_cell_ok(True, "1.00")
