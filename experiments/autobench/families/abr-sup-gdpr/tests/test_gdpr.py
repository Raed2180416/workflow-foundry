"""abr-sup-gdpr tests ($0, no model). Run inside AutomationBench's own venv (pinned by its uv.lock):

    corpus/AutomationBench/.venv/bin/python -I -B -m pytest -q -p no:cacheprovider \
        experiments/autobench/families/abr-sup-gdpr/tests

Seeds used: practice 601-609 and dev 610-614 only (RECURRING-DESIGN §3.9); held-out seeds are never generated here.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
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
FAMILY = json.loads((FAMILY_DIR / "family.json").read_text())
REPO = FAMILY_DIR.parents[3]
BRIDGE = FAMILY_DIR.parents[1] / "bridge.py"
# mutation operators added after the 2026-10-21 review (tag case, prefix spacing, trashed sends, exact texts and At)
REVIEW_OPERATORS = {"ticket-tag-case", "ticket-other-tags-case", "ticket-prefix-spacing", "ticket-subject-padded",
                    "trash-own-sent", "post-trailing-period", "post-double-space", "log-at-seconds",
                    "log-request-id-case", "log-request-id-padded", "log-reference-case", "log-transition-case",
                    "log-reference-semicolon"}
# control -> trap labels (or trigger kinds) its broken rule must show up on
ONE_DEFECT = {
    "any-sender": {"spoof-lookalike", "spoof-forward", "spoof-display", "spoof-colleague", "wrong-id"},
    "display-first": {"spoof-display"},
    "fuzzy-address": {"lookalike-domain", "hold-lookalike", "spoof-lookalike"},
    "case-sensitive": {"case-address", "case-sender", "duplicate-case"},
    "no-hold": {"on-hold"},
    "any-hold-row": {"hold-lifted-row"},
    "no-lift": {"hold-lift"},
    "text-search": {"cc-user"},
    "org-purge": {"org-domain"},
    "name-match": {"same-name"},
    "replace-tags": {"keep-tags"},
    "edit-log": {"verification.reply", "legal_hold.changed", "day.close"},
    "skip-verified": {"verification.reply"},
    "no-dedupe": {"duplicate-open", "duplicate-blocked", "duplicate-purged"},
    "dedupe-any": {"re-request"},
    "exact-deadline": {"deadline-late"},
    "late-deadline": {"deadline"},
    "close-held": {"deadline-held"},
    "count-all": {"day.close"},
    "stale-batch": {"day.close"},
    "snippet-only": {"id-in-body"},
    "at-date": {"erasure.requested"},
}


@pytest.fixture(scope="module")
def streams():
    return {s: gen.generate(s) for s in DEV}


@pytest.fixture(scope="module")
def dev_runs(streams):
    """(summary, per-stream results) for the reference and every bad control on the five dev streams."""
    return {name: harness.run(name, DEV, streams=streams) for name in ["reference"] + gates.BAD_CONTROLS}


# -- generator ---------------------------------------------------------------------------------------------------------
def test_determinism_and_round_trip():
    g = gates.gate_determinism([610, 611])
    assert g["pass"], g["problems"]


def test_stream_shape_matches_family_json(streams):
    for s, out in streams.items():
        d = out["meta"]["difficulty"]
        assert d == {610: "d2", 611: "d3", 612: "d2", 613: "d3", 614: "d2"}[s]
        lo, hi = FAMILY["triggersPerWeek"][d]
        assert lo <= out["meta"]["n_triggers"] <= hi and 20 <= out["meta"]["n_triggers"] <= 35
        kinds = Counter(t["kind"] for t in out["triggers"])
        for kind, spec in FAMILY["triggerKinds"].items():
            assert spec[d][0] <= kinds[kind] <= spec[d][1], (s, kind, kinds[kind])
            assert spec["perWeek"][0] <= kinds[kind] <= spec["perWeek"][1]
        ats = [t["at"] for t in out["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        last = out["triggers"][-1]
        assert last["kind"] == "day.close" and last["at"].endswith("T17:00:00Z")


def test_trap_rates_near_design(streams):
    for out in streams.values():
        share = out["meta"]["trigger_trap_share"]
        if out["meta"]["difficulty"] == "d2":
            assert 0.38 <= share <= 0.66, share
        else:
            assert 0.68 <= share <= 0.88, share


def test_trap_coverage_on_dev_label_streams():
    g = gates.gate_traps([610, 611, 612, 613])
    assert g["pass"], g
    assert set(g["by_kind"]) >= {"T-lookalike", "T-authority", "T-note", "T-repeat", "T-timing", "T-state"}


def test_pre_seeded_requests_reach_the_deadline(streams):
    """The spec: pre-seeded open requests are at most 29 days old when the week starts and reach day 30 during it;
    every stream closes at least one request, and only at a daily close."""
    from datetime import date
    for out in streams.values():
        mon = date.fromisoformat(out["end"]["week_start"])
        states = {}
        for c in out["end"]["log0"]:
            states[c["Request ID"]] = c["Transition"]
        ages = [(mon - date.fromisoformat(v["date"])).days for rid, v in out["end"]["requests"].items() if states.get(rid) == gen.VS]
        assert ages and max(ages) <= 29, ages
        closes = [t for t in out["truth"] if any(x["Transition"] == gen.CLOSED for x in t["expect"]["log"])]
        assert closes, out["meta"]
        assert all(t["kind"] == "day.close" for t in closes)


def test_fictional_entities_only(streams):
    reserved = re.compile(r"@[a-z0-9.-]*\bexample\.(com|net|org)$")
    for out in streams.values():
        w = out["world0"]
        emails = [u["email"] for u in w["zendesk"]["users"]] + [u["email"] for u in w["slack"]["users"]]
        emails += [r["cells"]["Email"] for r in w["google_sheets"]["rows"] if r["cells"].get("Email")]
        for o in w["zendesk"]["organizations"]:
            assert all(d.endswith(".example.com") for d in o["domain_names"])
        for t in out["triggers"]:
            if t["kind"] == "verification.reply":
                emails.append(oracle.addr(t["payload"]["data"]["from"]))
            elif t["payload"]["data"].get("row", {}).get("Email"):
                emails.append(t["payload"]["data"]["row"]["Email"])
        for e in emails:
            assert reserved.search(e.strip().lower()), e


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


def test_truth_logs_one_row_per_transition(streams):
    """Every expected log row is a named transition; a verification logs Verified and then exactly one outcome."""
    for out in streams.values():
        for t in out["truth"]:
            trs = [x["Transition"] for x in t["expect"]["log"]]
            assert all(x in gen.TRANSITIONS for x in trs)
            if gen.VERIFIED in trs:
                i = trs.index(gen.VERIFIED)
                assert trs[i + 1] in (gen.PURGED, gen.BLOCKED)
        assert not [x for x in out["end"]["log_week"] if x["Transition"] == gen.VERIFIED
                    and not any(y["Request ID"] == x["Request ID"] and y["Transition"] in (gen.PURGED, gen.BLOCKED)
                                for y in out["end"]["log_week"])]


def test_world0_has_no_overdue_open_request(streams):
    """Last week's closes ran: no world0 request is 30+ days old at last Friday and still Verification Sent."""
    from datetime import date, timedelta
    for out in streams.values():
        fri0 = date.fromisoformat(out["end"]["week_start"]) - timedelta(days=3)
        states = {}
        for c in out["end"]["log0"]:
            states[c["Request ID"]] = c["Transition"]
        for rid, v in out["end"]["requests"].items():
            if rid in states and states[rid] == gen.VS:
                assert (fri0 - date.fromisoformat(v["date"])).days < 30, rid


def test_held_requests_past_day_30_are_not_closed(streams):
    """deadline-held (added 2026-10-21): a request blocked by a legal hold reaches day 30 at a daily close. It is verified
    and answered, so the truth closes only requests in Verification Sent, and the exposure is at a close."""
    exposed = [t for out in streams.values() for t in out["truth"] if "deadline-held" in t["traps"]]
    assert exposed and all(t["kind"] == "day.close" for t in exposed)
    for out in streams.values():
        state = {}
        for c in out["end"]["log0"]:
            state[c["Request ID"]] = c["Transition"]
        for t in out["truth"]:
            for x in t["expect"]["log"]:
                if x["Transition"] == gen.CLOSED:
                    assert state.get(x["Request ID"]) == gen.VS, (t["trigger"], x["Request ID"], state.get(x["Request ID"]))
                state[x["Request ID"]] = x["Transition"]


# -- leakage -----------------------------------------------------------------------------------------------------------
def test_no_hidden_truth_reaches_the_arm():
    g = gates.gate_leakage(DEV)
    assert g["pass"], g["problems"]


def test_payload_is_zap_shaped(streams):
    for out in streams.values():
        for p in out["payloads"]:
            assert set(p) == gates.PAYLOAD_KEYS
            assert set(p["data"]) == gates.DATA_KEYS[p["event"]]


# -- reference (solvability) -------------------------------------------------------------------------------------------
def test_reference_passes_dev_gate(dev_runs):
    """The deliverable bar: >= 95% of triggers on 5 dev seeds. Measured: every trigger, every week."""
    summary, results = dev_runs["reference"]
    assert summary["pass_rate"] >= 0.95
    assert summary["passed"] == summary["triggers"], [(x["taskKey"], x["failed"]) for r in results for x in r["rows"] if not x["pass"]][:3]
    assert summary["clean_weeks"] == 5 and summary["errors"] == 0
    assert summary["max_steps"] <= 49


def test_reference_rebased_and_practice():
    s, _ = harness.run("reference", [601, 602, 603])
    assert s["passed"] == s["triggers"]
    r, _ = harness.run("reference", [611], mode="rebased")
    assert r["passed"] == r["triggers"]


def test_reference_is_observable_only():
    src = (FAMILY_DIR / "reference.py").read_text()
    assert "import gen" not in src and "import oracle" not in src and "harness" not in src
    assert "truth" not in src.lower()


# -- controls ----------------------------------------------------------------------------------------------------------
def test_every_control_fails(dev_runs):
    for name in gates.BAD_CONTROLS:
        summary, _ = dev_runs[name]
        assert summary["passed"] < summary["triggers"], name
        assert summary["clean_weeks"] < summary["streams"], name


def test_null_passes_only_no_op_triggers(dev_runs, streams):
    noop = sum(1 for s in DEV for t in streams[s]["truth"] if t["outcome"] == "no-op")
    summary, results = dev_runs["null"]
    assert summary["passed"] == noop
    assert all(x["outcome"] in ("correct", "miss") for r in results for x in r["rows"])


def test_echo_is_rejected_everywhere(dev_runs):
    summary, _ = dev_runs["echo"]
    assert summary["passed"] == 0


def test_naive_heuristic_below_60_percent_at_d3(streams):
    s, _ = harness.run("naive", [611, 613], streams=streams)
    assert s["pass_rate"] < 0.6
    import controls
    assert controls.NAIVE_LINES <= 40


def test_each_one_defect_control_fails_on_its_own_trap(dev_runs):
    for name, marks in ONE_DEFECT.items():
        _, results = dev_runs[name]
        failed = [x for r in results for x in r["rows"] if not x["pass"]]
        hit = [x for x in failed if marks & (set(x["traps"]) | {x["kind"]})]
        assert hit, (name, [(x["taskKey"], x["traps"]) for x in failed][:5])


def test_audit_requirement_is_checked(dev_runs):
    """edit-log rewrites the request's latest row instead of appending: the append-only check itself fails."""
    _, results = dev_runs["edit-log"]
    names = {c["name"] for r in results for x in r["rows"] for c in x["failed"]}
    assert "audit.append-only" in names and "end.log-history-unchanged" in names
    _, results = dev_runs["skip-verified"]
    assert any(c["name"].endswith(" Verified") for r in results for x in r["rows"] for c in x["failed"])


def test_statutory_deadline_is_checked_from_the_arms_world(dev_runs):
    _, results = dev_runs["late-deadline"]
    ends = [r["rows"][-1] for r in results]
    assert any("end.statutory-deadline" in {c["name"] for c in x["failed"]} for x in ends)
    _, results = dev_runs["reference"]
    assert all(r["rows"][-1]["pass"] for r in results)


def test_spoofed_verification_is_a_wrong_delivery(streams):
    """Rebased (per-trigger) mode: in carry mode an earlier accepted spoof can already have purged the request, so a
    later spoof for it is correctly a no-op (a cascade, reported as such by the harness)."""
    _, results = harness.run("any-sender", DEV, mode="rebased", streams=streams)
    spoofs = [x for r in results for x in r["rows"] if {"spoof-lookalike", "spoof-forward", "spoof-display"} & set(x["traps"])]
    assert spoofs and all(not x["pass"] and x["outcome"] == "wrong" for x in spoofs)


# -- oracle ------------------------------------------------------------------------------------------------------------
def test_oracle_mutation_score():
    """Every single-fault mutant is killed, including the operators added after the 2026-10-21 review (each of them
    applies on 610-611)."""
    g = gates.gate_mutation([610, 611])
    assert g["pass"] and g["score"] >= 0.95 and g["n_survived"] == 0, g["survived"]
    assert REVIEW_OPERATORS <= set(g["operators"]), REVIEW_OPERATORS - set(g["operators"])


def test_oracle_specificity():
    g = gates.gate_specificity([610])
    assert g["pass"], (g["rejected"], g["equivalent_failures"])


def test_api_cannot_set_a_ticket_description():
    """The narrowing in family.json: PUT /tickets/{id} with a description leaves the description as it was."""
    stream = gen.generate(610)
    b = harness.bridge()
    import asyncio
    r = b.Rollout(gen.serve_input(610, stream["triggers"][0]), harness.MAX_STEPS, stream["world0"], 0)
    asyncio.run(r.setup())
    t = stream["world0"]["zendesk"]["tickets"][0]
    ctx = harness.Ctx(r, {})
    ctx.fetch("PUT", reference.ZENDESK + f"tickets/{t['id']}", None, {"ticket": {"description": "[redacted]"}})
    after = next(x for x in r.world()["zendesk"]["tickets"] if x["id"] == t["id"])
    assert after["description"] == t["description"]


@pytest.mark.skipif(not (REPO / "corpus/AutomationBench/automationbench/domains/support/tasks.py").exists(),
                    reason="AutomationBench clone not present")
def test_grounding_span():
    lines = (REPO / "corpus/AutomationBench/automationbench/domains/support/tasks.py").read_text().splitlines()
    span = "\n".join(lines[22600:23005])
    assert '"task": "support.zendesk_gdpr_purge"' in span and "ws_legal_hold" in span
    assert FAMILY["grounding"][0]["span"].endswith("22601-23005")


# -- 2026-10-21 review: the oracle grades the stated contract, through the real tool path ------------------------------
class _OtherTagsUpper(reference.Gdpr):
    """Re-cases the ticket's other tags and adds gdpr-purged in lower case (scratch variant 'other-tags-upper')."""
    def anonymize(self, t):
        tags = [x.upper() for x in t.get("tags") or []] + [reference.TAG]
        self.call("PUT", reference.ZENDESK + f"tickets/{t['id']}", None,
                  {"ticket": {"subject": reference.PREFIX + t["subject"], "tags": tags}})


class _UpperTag(reference.Gdpr):
    """Every tag upper case, the purge tag as 'GDPR-PURGED' (scratch variant 'upper-tag')."""
    def anonymize(self, t):
        tags = [x.upper() for x in t.get("tags") or []] + [reference.TAG.upper()]
        self.call("PUT", reference.ZENDESK + f"tickets/{t['id']}", None,
                  {"ticket": {"subject": reference.PREFIX + t["subject"], "tags": tags}})


class _DoubleSpace(reference.Gdpr):
    """'[GDPR Purged]   Subject' (scratch variant 'double-space')."""
    def anonymize(self, t):
        self.call("PUT", reference.ZENDESK + f"tickets/{t['id']}", None,
                  {"ticket": {"subject": "[GDPR Purged]   " + t["subject"], "tags": list(t.get("tags") or []) + [reference.TAG]}})


class _LeadingSpace(reference.Gdpr):
    """'  [GDPR Purged] Subject  ' (scratch variant 'leading-space')."""
    def anonymize(self, t):
        self.call("PUT", reference.ZENDESK + f"tickets/{t['id']}", None,
                  {"ticket": {"subject": "  " + reference.PREFIX + t["subject"] + "  ", "tags": list(t.get("tags") or []) + [reference.TAG]}})


class _TrashSent(reference.Gdpr):
    """Moves every email it sends to Trash in the same run (scratch variant 'trash-sent')."""
    def call(self, method, url, params=None, body=None):
        out = super().call(method, url, params, body)
        if method == "POST" and url.endswith("messages/send"):
            super().call("POST", reference.GMAIL + f"messages/{out['id']}/trash")
        return out


class _PostPeriod(reference.Gdpr):
    """The #privacy-ops summary with a trailing period (scratch variant 'post-period')."""
    def post(self, text, channel=reference.PRIVACY_OPS):
        return super().post(text + "." if channel == reference.PRIVACY_OPS else text, channel)


class _AtLater(reference.Gdpr):
    """At 50 seconds after the event (scratch variant 'at-later')."""
    def __init__(self, trigger, ctx):
        super().__init__(trigger, ctx)
        self.at = re.sub(r":00Z$", ":50Z", self.at)


class _LowerIds(reference.Gdpr):
    """Request ID and Reference with their letter case changed (log_key folded both before the fix)."""
    def append_log(self, rid, email, transition, reference=""):
        return super().append_log(rid.lower(), email, transition, reference.swapcase())


def _solver(cls):
    def run(trigger, ctx):
        return cls(trigger, ctx).run()
    return run


REVIEW_VARIANTS = {   # variant -> (a failed check it must show, a trap or kind it must fail on)
    "other-tags-upper": (_OtherTagsUpper, "ticket ", "keep-tags"),
    "upper-tag": (_UpperTag, "ticket ", "verification.reply"),
    "double-space": (_DoubleSpace, "ticket ", "verification.reply"),
    "leading-space": (_LeadingSpace, "ticket ", "verification.reply"),
    "trash-sent": (_TrashSent, "email ", "erasure.requested"),
    "post-period": (_PostPeriod, "post ", "day.close"),
    "at-later": (_AtLater, "log ", "erasure.requested"),
    "lower-ids": (_LowerIds, "log ", "erasure.requested"),
}


@pytest.mark.parametrize("name", sorted(REVIEW_VARIANTS))
def test_review_variants_are_rejected(name, streams):
    """Each variant passed 77/77 on 610-612 before the fix (tags and subjects compared after case folding and whitespace
    collapsing, a trashed sent email matched, a trailing period and an At within the minute tolerated, ids case-folded).
    Run through AutomationBench's tool path on the d3 dev stream 611, each now fails where its rule applies."""
    cls, check, where = REVIEW_VARIANTS[name]
    res = harness.run_stream(streams[611], _solver(cls))
    failed = [x for x in res["rows"] if not x["pass"]]
    assert failed and not res["clean_week"], name
    hit = [x for x in failed if where in set(x["traps"]) | {x["kind"]} and any(c["name"].startswith(check) for c in x["failed"])]
    assert hit, (name, [(x["taskKey"], [c["name"] for c in x["failed"]]) for x in failed][:4])
    if name == "trash-sent":                    # the trashed email is overreach as well as a missing email
        assert any(c["name"] == "envelope" and "TRASH" in c["detail"] for x in failed for c in x["failed"])


def test_exact_tags_and_subjects_in_the_week_close(streams):
    """end.tickets compares subjects and tags exactly too: re-casing a purged ticket's tags or padding its subject in
    the final world fails the week close, while reordering its tags does not."""
    out = streams[611]
    res = harness.run_stream(out, reference.handle, keep_worlds=True)
    assert res["clean_week"]
    before, after, truth = res["befores"][-1], res["afters"][-1], out["truth"][-1]
    grader = oracle.Grader(use_ab=False)
    purged = [t for t in after["zendesk"]["tickets"] if reference.TAG in t["tags"] and len(t["tags"]) > 1]
    assert purged

    def end_ok(w):
        v = grader.grade(truth, before, w, end=out["end"], world0=out["world0"])
        return not [c for c in v["failed"] if c["name"] == "end.tickets"]
    import copy
    for fn in (lambda t: t.__setitem__("tags", [x.upper() for x in t["tags"]]),
               lambda t: t.__setitem__("subject", t["subject"].replace("] ", "]  ", 1)),
               lambda t: t.__setitem__("subject", " " + t["subject"])):
        w = copy.deepcopy(after)
        fn(next(t for t in w["zendesk"]["tickets"] if t["id"] == purged[0]["id"]))
        assert not end_ok(w)
    w = copy.deepcopy(after)
    t = next(t for t in w["zendesk"]["tickets"] if t["id"] == purged[0]["id"])
    t["tags"] = list(reversed(t["tags"]))
    assert end_ok(w)


def test_inweek_hold_lift_reads_a_blocked_row_written_this_week(streams, dev_runs):
    """hold-lift-inweek (added 2026-10-21): a request verified while on hold this week, then its hold lifted later the
    same week. The lift purges from a Blocked row the automation wrote this week, never one pre-seeded in world0."""
    hits = []
    for s, out in streams.items():
        log0 = {c["Request ID"] for c in out["end"]["log0"]}
        for k, t in enumerate(out["truth"]):
            if "hold-lift-inweek" not in t["traps"]:
                continue
            assert t["kind"] == "legal_hold.changed" and "hold-lift" in t["traps"]
            purged = [x for x in t["expect"]["log"] if x["Transition"] == gen.PURGED]
            assert purged and t["expect"]["delete_users"]
            for x in purged:
                assert x["Request ID"] not in log0
                assert any(y["Request ID"] == x["Request ID"] and y["Transition"] == gen.BLOCKED
                           for u in out["truth"][:k] for y in u["expect"]["log"])
            hits.append((s, t["trigger"]))
    assert hits, "no in-week hold lift on the dev streams"
    _, results = dev_runs["no-lift"]
    assert any(not x["pass"] and "hold-lift-inweek" in x["traps"] for r in results for x in r["rows"])
    summary, results = dev_runs["reference"]
    assert all(x["pass"] for r in results for x in r["rows"] if "hold-lift-inweek" in x["traps"])


def test_trigger_ids_and_prompt_carry_no_host_identity(streams):
    """Opaque trigger ids (2026-10-21 review): the payload named the seed and the position ('s613/t01') and the system
    line named the family. Now neither the payload nor the prompt does; the mapping stays host-side."""
    for s, out in streams.items():
        ids = [p["trigger"] for p in out["payloads"]]
        assert len(set(ids)) == len(ids)
        for t, p in zip(out["triggers"], out["payloads"]):
            assert re.fullmatch(r"[0-9a-f]{10}", p["trigger"]) and p["trigger"] == t["trigger"]
            assert not gates.host_identity(s, t["index"]).search(gen.canon(p)), (s, t["index"])
            row = gen.serve_input(s, t)
            assert row["prompt"][0] == {"role": "system", "content": "standing automation"}
            assert not gates.host_identity(s, t["index"]).search(json.dumps(row["prompt"]))
    first = streams[613]["payloads"][0]
    assert not first["trigger"].startswith("s613")
    assert gates.host_identity(613, 1).search(gen.canon(dict(first, trigger="s613/t01")))   # the old form is caught


@pytest.mark.skipif(not Path("/usr/share/zoneinfo/Pacific/Auckland").exists(), reason="no tz database")
def test_serve_process_is_pinned_to_utc(tmp_path, streams):
    """bridge.py serve/replay set TZ from the row's info.tz (gen.serve_input writes UTC): the shim's naive clock is local
    time, so under another host zone a ticket's updated_at would not fall on the trigger time. Run in a separate
    process with TZ=Pacific/Auckland: pinned, updated_at is the trigger minute; without info.tz it is not."""
    out = streams[610]
    trig = out["triggers"][0]
    world = harness.apply_delta(out["world0"], trig["delta"], trig["at"])
    t = world["zendesk"]["tickets"][0]
    args = harness.Ctx.fetch_args("PUT", reference.ZENDESK + f"tickets/{t['id']}", None, {"ticket": {"status": t["status"]}})
    (tmp_path / "world.json").write_text(json.dumps(world))
    (tmp_path / "steps.json").write_text(json.dumps([{"calls": [{"name": "api_fetch", "arguments": json.dumps(args)}]}]))
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "TZ": "Pacific/Auckland", "HOME": str(tmp_path / "home"),
           "HF_HOME": str(tmp_path / "hf"), "HF_DATASETS_OFFLINE": "1", "HF_HUB_OFFLINE": "1", "TQDM_DISABLE": "1"}

    def updated_at(row, name):
        (tmp_path / f"{name}.json").write_text(json.dumps(row))
        host = tmp_path / f"host-{name}"
        r = subprocess.run([sys.executable, "-I", "-B", str(BRIDGE), "replay", "--input", str(tmp_path / f"{name}.json"),
                            "--world", str(tmp_path / "world.json"), "--steps", str(tmp_path / "steps.json"),
                            "--host", str(host), "--det", "seed"], cwd=tmp_path, env=env, capture_output=True, text=True,
                           timeout=900)
        assert r.returncode == 0, r.stderr[-2000:]
        w = json.loads((host / "final-world.json").read_text())
        return next(x for x in w["zendesk"]["tickets"] if x["id"] == t["id"])["updated_at"]

    row = gen.serve_input(610, trig)
    assert json.loads(row["info"])["tz"] == "UTC"
    assert updated_at(row, "pinned").startswith(trig["at"][:16])            # YYYY-MM-DDTHH:MM, the trigger minute
    info = json.loads(row["info"])
    del info["tz"]
    assert not updated_at(dict(row, info=json.dumps(info)), "unpinned").startswith(trig["at"][:16])
