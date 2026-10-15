"""abr-sup-routing tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-sup-routing/tests

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
ONE_DEFECT = {  # control -> trap labels its broken rule must show up on
    "substring-company": {"lookalike", "release-lookalike"}, "domain-company": {"domain"},
    "contains-hold": {"release"}, "ignore-hold": {"held"}, "no-release": {"release"},
    "ignore-effective": {"effective-future", "no-tier-yet"}, "desc-area": {"tags-vs-desc", "multi-area", "tag-lookalike"},
    "tag-order": {"multi-area"}, "priority-only": {"records-complex", "systems-complex"},
    "any-number": {"number-decoy"}, "count-mentions": {"systems-decoy"}, "route-assigned": {"assigned"},
    "release-assigned": {"assigned-held"}, "route-not-open": {"not-open"}, "count-all-notes": {"count-noise"},
    "held-today": {"held-count"}, "stale-hold": {"stale-hold-note"}, "slack-authority": {"authority"}}


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
        assert last["kind"] == "day.close" and last["at"].endswith("T17:00:00Z")
        assert sum(1 for t in out["triggers"] if t["sub"] == "release") >= 1


def test_trap_rates_near_design(streams):
    for out in streams.values():
        share = out["meta"]["trigger_trap_share"]
        if out["meta"]["difficulty"] == "d2":
            assert 0.30 <= share <= 0.55, share
        else:
            assert 0.58 <= share <= 0.78, share


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert set(g["by_kind"]) >= set(gates.TRAP_KINDS)


def test_fictional_entities_only(streams):
    for out in streams.values():
        w = out["world0"]
        for c in w["freshdesk"]["contacts"]:
            assert c["email"].endswith(".example.com"), c["email"]
        for c in w["freshdesk"]["companies"]:
            assert all(d.endswith(".example.com") for d in c["domains"])
        for u in w["slack"]["users"]:
            assert u["email"].endswith("@company.example.com")
        for t in w["freshdesk"]["tickets"] + [p["data"]["ticket"] for p in out["payloads"] if p["event"] == "ticket_created"]:
            caps = set(re.findall(r"\b[A-Z][a-zA-Z]+[A-Z][a-zA-Z]*\b|\b(?:Salesforce|Xero|Zendesk|Jira|Mailchimp|Asana|Airtable|Trello|Twilio|Calendly|Intercom)\b", t["description"]))
            assert caps <= set(gen.INTEGRATIONS) | {"API"}, caps     # only AutomationBench's own simulated apps


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
    """A ticket held at its own trigger expects nothing there, and is routed by the later trigger that lifts the hold."""
    seen = 0
    for out in streams.values():
        released = {r["ticket_id"]: t["index"] for t in out["truth"] if t["kind"] == "tier.changed" for r in t["expect"]["routes"]}
        for t in out["truth"]:
            if t["kind"] == "ticket.created" and "held" in t["traps"]:
                tid = next(p["data"]["ticket"]["id"] for p in out["payloads"] if p["trigger"] == t["trigger"])
                assert t["outcome"] == "no-op" and not t["expect"]["routes"]
                if tid in released:
                    assert released[tid] > t["index"]
                    seen += 1
    assert seen >= 1


def test_queue_config_is_fourteen_rows_and_reads_like_the_canonical_rule():
    """The reference parses the Condition column; on every (tier, complex, tags) case it agrees with gen.route."""
    assert len(gen.QUEUE_ROWS) == 14
    config = [dict(zip(gen.QUEUE_HEADERS, row)) for row in gen.QUEUE_ROWS]
    router = reference.Router({"at": "2026-03-02T10:00:00Z"}, None)
    tag_sets = [[], ["api"], ["billing"], ["integration"], ["billing", "api"], ["integration", "billing"],
                ["API"], ["api-docs"], ["integration", "api"], ["sso", "Billing"]]
    for tier in [None, "Enterprise", "Premium", "Standard"]:
        for cx in (False, True):
            for tags in tag_sets:
                ticket = {"id": "1", "status": 2, "group_id": None, "tags": tags, "priority": 4 if cx else 1, "description": ""}
                assert router.decide(ticket, tier, config) == gen.route(tier, cx, tags), (tier, cx, tags)
    assert router.decide({"status": 2, "group_id": "grp_api", "tags": []}, "Enterprise", config) is None
    assert router.decide({"status": 5, "group_id": None, "tags": []}, "Enterprise", config) is None


def test_complexity_reading_agrees_with_the_generators_parts():
    """The narrow judgment: the reference's text reading equals the structural truth on every description built."""
    n = Counter()
    router = reference.Router({"at": "2026-03-02T10:00:00Z"}, None)
    for s in PRACTICE + DEV:
        g = gen.Gen(s, gen.default_difficulty(s))
        g.run()
        descs = [p["desc"] for p in g.plans if p["kind"] == "ticket.created"] + [t["_desc"] for t in g.tickets0]
        for d in descs:
            want = d.is_complex(1)[0]
            assert router.is_complex({"priority": 1, "description": d.text}) == want, d.text
            n[want] += 1
            n["records"] += any(p["kind"] == "records" for p in d.parts)
            n["systems"] += any(p["kind"] in ("sys", "sys-neg") for p in d.parts)
    assert n[True] >= 20 and n[False] >= 200 and n["records"] >= 20 and n["systems"] >= 20, n


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
            if p["event"] == "ticket_created":
                assert set(p["data"]["ticket"]) == gates.TICKET_KEYS


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
    assert set(g["reference_imports"]) <= {"__future__", "json", "re", "urllib"}
    src = (FAMILY_DIR / "reference.py").read_text()
    for host in ("import gen", "import oracle", "truth", "world0", "delta"):
        assert host not in src


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


def test_public_note_control_fails_every_route(dev_runs):
    summary, results = dev_runs["public-note"]
    rows = [x for r in results for x in r["rows"]]
    routed = [x for x in rows if x["kind"] == "ticket.created" and x["expected"] == "act"]
    assert routed and not any(x["pass"] for x in routed)


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
            gates._post(echoed, gen.ROUTING, json.dumps(truth["trigger"]), 1)
            assert not grader.grade(truth, before, echoed)["pass"]


def test_oracle_rejects_a_plausible_wrong_route(ref_worlds):
    """The reference's own world with one routed ticket sent to the neighbouring queue (the note left as it is)."""
    grader = oracle.Grader()
    n = 0
    for stream, res in ref_worlds:
        for truth, before, after in zip(stream["truth"], res["befores"], res["afters"]):
            for rt in truth["expect"]["routes"]:
                w = copy.deepcopy(after)
                t = next(x for x in w["freshdesk"]["tickets"] if x["id"] == rt["ticket_id"])
                t["group_id"] = gates.OTHER_GROUP.get(t["group_id"], "grp_general")
                v = grader.grade(truth, before, w)
                assert not v["pass"] and v["outcome"] == "wrong"
                n += 1
    assert n >= 40


def test_oracle_mutation_score():
    g = gates.gate_mutation([610, 611])
    assert g["pass"] and g["score"] >= 0.95, g
    assert len(g["operators"]) >= 25


def test_oracle_specificity_no_false_rejects():
    g = gates.gate_specificity([610])
    assert g["pass"], g["rejected"]


def test_abstention_is_not_credit(ref_worlds):
    grader = oracle.Grader()
    stream, res = ref_worlds[0]
    k = next(i for i, t in enumerate(stream["truth"]) if t["kind"] == "ticket.created" and t["outcome"] == "act")
    before = res["befores"][k]
    w = copy.deepcopy(before)
    gates._post(w, gen.REVIEW, f"{stream['truth'][k]['trigger']}: not sure which queue", 1)
    v = grader.grade(stream["truth"][k], before, w)
    assert not v["pass"] and v["outcome"] == "abstained"


def test_end_of_week_is_graded_at_the_last_trigger(ref_worlds):
    grader = oracle.Grader()
    for stream, res in ref_worlds:
        truth, before, after = stream["truth"][-1], res["befores"][-1], res["afters"][-1]
        ok = grader.grade(truth, before, after, stream["end"], stream["world0"])
        plain = grader.grade(truth, before, after)
        assert ok["pass"] and ok["n_checks"] - plain["n_checks"] == 7     # the seven end-of-week checks ran and passed
        # an earlier routed ticket silently moved to another queue in the final world: invisible per trigger,
        # caught at week end
        w0, w1 = copy.deepcopy(before), copy.deepcopy(after)
        routed = next(t for t in w1["freshdesk"]["tickets"] if any(n["body"].startswith("routed to") for n in t["notes"])
                      and t["id"] in {r["ticket_id"] for x in stream["truth"] for r in x["expect"]["routes"]})
        for w in (w0, w1):
            next(t for t in w["freshdesk"]["tickets"] if t["id"] == routed["id"])["group_id"] = "grp_billing" \
                if routed["group_id"] != "grp_billing" else "grp_api"
        v = grader.grade(truth, w0, w1, stream["end"], stream["world0"])
        assert not v["pass"] and any(c["name"] in ("end.tickets", "end.ab") for c in v["failed"])
        # a held ticket silently routed in the final world
        w0, w1 = copy.deepcopy(before), copy.deepcopy(after)
        held = [t for t in w1["freshdesk"]["tickets"] if t["status"] == 2 and not t["group_id"]]
        if held:
            for w in (w0, w1):
                next(t for t in w["freshdesk"]["tickets"] if t["id"] == held[0]["id"])["group_id"] = "grp_general"
            v = grader.grade(truth, w0, w1, stream["end"], stream["world0"])
            assert not v["pass"] and any(c["name"] == "end.tickets" for c in v["failed"])


# -- policy and grounding ----------------------------------------------------------------------------------------------
def test_policy_states_the_parameters_the_generator_uses():
    policy = (FAMILY_DIR / "POLICY.md").read_text()
    for s in (gen.SS, gen.WS_TIERS, gen.WS_QUEUE, gen.FD_BASE, "#support-routing", "#automation-review",
              "routed to <Queue_Group_ID> (<Rule>)", "<YYYY-MM-DD>: routed <N>, held <M>", "HOLD", "SUSPENDED",
              "10,000", "records", "NexaGen", "first", "Effective Date", "Previous Tier"):
        assert s in policy, s
    for h in gen.TIER_HEADERS + gen.QUEUE_HEADERS:
        assert h in policy, h
    for sysname in gen.INTEGRATIONS:
        assert sysname in policy, sysname
    for text in gen.DECOY_NOTES + gen.LIFTED + gen.BENIGN_TIER_NOTES:      # no decoy or lifted note holds a customer
        assert not gen.on_hold(text), text
    for text in gen.HOLD_NOTES:
        assert gen.on_hold(text), text


def test_grounding_spans_point_at_the_public_tasks():
    tasks = FAMILY_DIR.parents[3] / "corpus" / "AutomationBench" / "automationbench" / "domains" / "support" / "tasks.py"
    if not tasks.exists():
        pytest.skip("corpus/AutomationBench not cloned")
    lines = tasks.read_text().splitlines()
    for g, fn in zip(FAMILY["grounding"], ("def get_support_freshdesk_multi_queue_routing_task",
                                           "def get_support_intercom_multi_product_routing_task")):
        a, b = (int(x) for x in g["span"].split(":")[1].split("-"))
        assert lines[a - 1].startswith(fn), (g["task"], lines[a - 1])
        assert f'"{g["task"]}"' in "\n".join(lines[a - 1:b])
