"""Tests for abr-mkt-suppression ($0: no model is called anywhere).

Run inside AutomationBench's own venv (pinned by its uv.lock), from the repository root:

    corpus/AutomationBench/.venv/bin/python -I -m pytest -p no:cacheprovider -q \
        experiments/autobench/families/abr-mkt-suppression/tests

Dev seeds 610-614 (610 d2, 611 d3, 612 d2, 613 d3, 614 d2). Held-out seeds are never generated here.
"""
from __future__ import annotations

import ast
import copy
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pytest

FAM = Path(__file__).resolve().parents[1]
if str(FAM) not in sys.path:
    sys.path.insert(0, str(FAM))

import controls as C  # noqa: E402
import gen as G  # noqa: E402
import harness as H  # noqa: E402
import lib as L  # noqa: E402
import oracle as O  # noqa: E402
import reference as R  # noqa: E402

DEV = [610, 611, 612, 613, 614]
LABEL = [610, 611, 612, 613]
BAD = list(C.CONTROLS)
# one-defect variants: the trap labels on which their broken clause bites
BITES = {"nodedupe": {"retry"}, "fuzzy": {"plus-address", "digit-domain", "soft-lookalike", "am-lookalike"},
         "nohold": {"hold", "hold-release"}, "nopremium": {"premium"}, "nowindow": {"window-boundary-out"},
         "confirmall": {"recent-confirm", "reprocess"}, "anyauthor": {"unauthorized-amendment"}, "noreprocess": {"reprocess"},
         "noskip": {"resolved", "retracted", "pre-migration"}}
# variants whose clause exists only in some weeks (amendments and reprocess at d3, window edges, recent confirmations)
NARROW = {"anyauthor", "noreprocess", "nowindow", "confirmall"}


@pytest.fixture(scope="module")
def gens():
    return {s: G.generate(s) for s in DEV}


@pytest.fixture(scope="module")
def refs(gens):
    return {s: H.run_stream("ref", s, g=gens[s]) for s in DEV}


@pytest.fixture(scope="module")
def bad(gens):
    return {name: {s: H.run_stream(name, s, g=gens[s]) for s in LABEL} for name in BAD}


def world0_rows(g, key):
    sh = L.SHEETS[key]
    return [r["cells"] for ss in g["world0"]["google_sheets"]["spreadsheets"] if ss["id"] == sh["ss"]
            for ws in ss["worksheets"] for r in ws["rows"]]


# ---------------------------------------------------------------------------------------------- generator
def test_generation_is_deterministic_and_worlds_round_trip():
    for s in (610, 611):
        r = H.gate_determinism(s, None)
        assert r["identical"] and r["roundtrip"] and r["roundtrip_world_t"], r
    a, b = G.generate(610), G.generate(612)
    assert L.canon(a["truth"]) != L.canon(b["truth"])


def test_stream_shape_matches_the_family_spec(gens):
    spec = json.loads((FAM / "family.json").read_text())
    for s, g in gens.items():
        d = g["meta"]["difficulty"]
        assert d == ("d2" if s % 2 == 0 else "d3")
        lo, hi = spec["triggersPerWeek"][d]
        assert lo <= g["meta"]["n_triggers"] <= hi and 40 <= g["meta"]["n_triggers"] <= 60, (s, g["meta"]["n_triggers"])
        kinds = Counter(t["kind"] for t in g["triggers"])
        for kind, rng in spec["triggerKinds"].items():
            assert rng[d][0] <= kinds.get(kind, 0) <= rng[d][1], (s, kind, kinds.get(kind, 0), rng[d])
        closes = [t for t in g["triggers"] if t["kind"] == "day.close"]
        assert [t["at"][11:] for t in closes] == ["17:00:00Z"] * 5 and g["triggers"][-1] is closes[-1]
        ats = [t["at"] for t in g["triggers"]]
        assert ats == sorted(ats) and len(set(ats)) == len(ats)
        subs = sorted(t["sub"] for t in g["triggers"] if t["kind"] == "policy.amendment")
        assert subs == ([] if d == "d2" else ["authorized", "unauthorized"])


def test_trap_rates_and_coverage(gens):
    for g in gens.values():
        lo, hi = (0.38, 0.56) if g["meta"]["difficulty"] == "d2" else (0.66, 0.86)
        assert lo <= g["meta"]["trap_rate_events"] <= hi, g["meta"]
    r = H.gate_traps([gens[s] for s in LABEL])
    assert r["all_kinds_ge5"], r["kinds"]
    # every trap the truth names is a catalogue label
    assert set(r["labels"]) <= set(G.TRAP_KIND)


def test_write_out_files_and_hashes(tmp_path):
    meta = G.write_out(G.generate(610), tmp_path)
    for name in ("world0.json", "triggers.jsonl", "truth.jsonl", "end.json"):
        assert hashlib.sha256((tmp_path / name).read_bytes()).hexdigest() == meta["sha256"][name]
    assert json.loads((tmp_path / "meta.json").read_text())["seed"] == 610


def test_world0_history_is_consistent(gens):
    """Earlier weeks are a coherent history: an arm reading the logs, the mailbox or Mailchimp sees the same facts."""
    for g in gens.values():
        monday = g["meta"]["week_start"]
        log = world0_rows(g, "log")
        sent = Counter((m["to"][0], m["date"][:10]) for m in g["world0"]["gmail"]["messages"]
                       if "SENT" in m["label_ids"] and m["subject"] == L.CONFIRM_SUBJECT)
        assert sent == Counter((r["Email"], r["Date"]) for r in log if r["Confirmation"] == "Sent")
        status = {(m["list_id"], m["email"].lower()): m["status"] for m in g["world0"]["mailchimp"]["subscribers"]}
        names = {a["name"]: a["id"] for a in g["world0"]["mailchimp"]["audiences"]}
        for r in log:
            assert r["Date"] < monday
            for n in filter(None, (x.strip() for x in r["Lists"].split(";"))):
                assert status[(names[n], r["Email"])] == "archived", r
        refs = {r["Ref"] for r in log}
        for key in ("requests", "bounces"):
            for c in world0_rows(g, key):
                hd = L.hold_date(c["Notes"])
                if hd and hd < monday:
                    assert c[L.SHEETS[key]["id"]] in refs, c  # no hold from an earlier week left unreleased
        blog = world0_rows(g, "bouncelog")
        for r in blog:  # under the threshold of the time (3 in 30 days), no earlier soft bounce should have archived
            n = sum(1 for x in blog if x["Email"] == r["Email"] and L.in_window(x["Date"], r["Date"], 30))
            assert n < 3, r


# ---------------------------------------------------------------------------------------------- leakage
def test_no_hidden_truth_in_what_the_arm_sees(gens):
    for g in gens.values():
        r = H.gate_leakage(g)
        assert r["ok"], r["problems"]
        for t in g["triggers"]:
            assert set(t["payload"]) == {"trigger", "at", "app", "event", "data"}
            text = L.canon(t["payload"])
            for hidden in ('"traps"', '"expect"', '"delta"', '"outcome"', '"kind"', '"sub"', "unsub.request", "bounce.",
                           "authorized", "escalate"):
                assert hidden not in text, (t["trigger"], hidden)


def test_reference_imports_only_the_standard_library():
    tree = ast.parse((FAM / "reference.py").read_text())
    mods = {(n.module if isinstance(n, ast.ImportFrom) else a.name).split(".")[0]
            for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
            for a in (n.names if isinstance(n, ast.Import) else [None])}
    assert mods <= {"__future__", "base64", "re", "datetime", "urllib"}, mods


def test_heldout_seeds_are_refused():
    with pytest.raises(SystemExit):
        H.parse_seeds("8801")
    with pytest.raises(SystemExit):
        H.parse_seeds("610-614,8803")
    assert H.parse_seeds("610-614") == DEV


# ---------------------------------------------------------------------------------------------- reference (solvability)
def test_reference_passes_every_dev_trigger(refs):
    rows = [r for res in refs.values() for r in res["rows"]]
    rate = sum(r["pass"] for r in rows) / len(rows)
    assert rate >= 0.95, [(r["taskKey"], r["failed"]) for r in rows if not r["pass"]][:5]
    assert rate == 1.0 and all(res["clean_week"] for res in refs.values())
    assert not any(r["error"] for r in rows)
    assert {r["kind"] for r in rows} == {"unsub.request", "bounce.hard", "bounce.soft", "bounce.other", "repeat",
                                         "policy.amendment", "day.close"}
    assert {r["truth"] for r in rows} == {"act", "no-op", "escalate"}


def test_reference_rebased_mode(gens, refs):
    res = H.run_stream("ref", 611, g=gens[611], mode="rebased", rebase=refs[611]["afters"])
    assert res["clean_week"]


# ---------------------------------------------------------------------------------------------- bad controls
def test_do_nothing_passes_only_the_noop_triggers(gens, bad):
    for s, res in bad["null"].items():
        for row, truth in zip(res["rows"], gens[s]["truth"]):
            assert row["pass"] == (truth["outcome"] == "no-op"), row
            if truth["outcome"] != "no-op":
                assert row["outcome"] == "miss"
        assert not res["clean_week"]


def test_echo_fails_every_trigger(bad):
    rows = [r for res in bad["echo"].values() for r in res["rows"]]
    assert not any(r["pass"] for r in rows)
    assert {r["outcome"] for r in rows} == {"wrong"}


@pytest.mark.parametrize("name", BAD)
def test_every_bad_control_fails(bad, name):
    """Every control fails the bar the reference meets (every trigger, every week clean). The narrow one-defect
    variants only bite where their clause applies, so some of their weeks may be clean; the others stay below 95%."""
    rows = [r for res in bad[name].values() for r in res["rows"]]
    rate = sum(r["pass"] for r in rows) / len(rows)
    assert rate < 1.0 and not all(res["clean_week"] for res in bad[name].values()), (name, rate)
    if name not in NARROW:
        assert rate < 0.95, (name, rate)


def test_naive_heuristic_scores_below_60_percent_at_d3(bad):
    rows = [r for s in (611, 613) for r in bad["naive"][s]["rows"]]
    assert sum(r["pass"] for r in rows) / len(rows) < 0.6


@pytest.mark.parametrize("name", sorted(BITES))
def test_one_defect_variants_fail_where_their_clause_bites(bad, name):
    """Each plausible-but-wrong variant breaks one policy clause; the oracle flags it on that clause's triggers."""
    rows = [r for res in bad[name].values() for r in res["rows"]]
    hit = [r for r in rows if not r["pass"] and BITES[name] & set(r["traps"])]
    assert hit, (name, Counter(t for r in rows if not r["pass"] for t in r["traps"]))


# ---------------------------------------------------------------------------------------------- oracle
def test_oracle_mutation_score():
    r = H.gate_mutation([610, 611], None)
    assert r["total"] > 1000 and r["score"] >= 0.95, r
    assert all(int(v.split("/")[0]) > 0 for v in r["by_mutation"].values()), r["by_mutation"]


def test_oracle_accepts_policy_neutral_variants():
    r = H.gate_specificity([610, 611], None)
    assert r["summary"]["pass_rate"] == 1.0, r["false_rejects"]


def _trigger_world(g, idx):
    world = H.new_world(g["world0"])
    for k in range(idx + 1):
        if k:
            R.handle(copy.deepcopy(g["triggers"][k - 1]["payload"]), H.Api(world))
        H.apply_delta(world, g["triggers"][k]["delta"], g["triggers"][k]["at"])
    return world


def _grade_one(g, idx, fn):
    world = _trigger_world(g, idx)
    before = world.model_dump(mode="json")
    fn(copy.deepcopy(g["triggers"][idx]["payload"]), H.Api(world))
    return O.grade_trigger(before, world.model_dump(mode="json"), g["truth"][idx], g["triggers"][idx]["payload"])


def test_oracle_rejects_a_right_looking_run_on_a_look_alike(gens):
    """Plausible but wrong: the house format everywhere, but a plus-address or digit look-alike is matched loosely."""
    seen = 0
    for s in LABEL:
        g = gens[s]
        for idx, t in enumerate(g["triggers"]):
            if t["kind"] == "unsub.request" and {"plus-address", "digit-domain"} & set(t["traps"]):
                v = _grade_one(g, idx, C.variant(C.Fuzzy))
                assert v["outcome"] == "wrong" and "mailchimp.archived" in {n for n, _ in v["failed"]}, (t["trigger"], v["failed"])
                seen += 1
    assert seen >= 2


def test_oracle_rejects_a_second_confirmation_within_30_days(gens):
    g = gens[611]
    idx = next(i for i, t in enumerate(g["triggers"]) if "recent-confirm" in t["traps"] or t["sub"] == "reprocess")
    v = _grade_one(g, idx, C.variant(C.ConfirmAll))
    names = {n for n, _ in v["failed"]}
    assert v["outcome"] == "wrong" and "email.exact" in names and "ab:gmail_message_not_sent_to" in names, v["failed"]


def test_oracle_escalation_and_abstention(gens):
    g = gens[611]
    esc = next(i for i, t in enumerate(g["truth"]) if t["outcome"] == "escalate")
    act = next(i for i, t in enumerate(g["truth"]) if t["outcome"] == "act" and t["kind"] == "bounce.hard")
    for idx, want in ((esc, "correct"), (act, "abstained")):
        world = _trigger_world(g, idx)
        before = world.model_dump(mode="json")
        p = g["triggers"][idx]["payload"]
        H.Api(world).fetch("POST", f"{R.SLACK}/chat.postMessage", None, {"channel": "automation-review", "text": f"{p['trigger']}: cannot decide"})
        v = O.grade_trigger(before, world.model_dump(mode="json"), g["truth"][idx], p)
        assert v["outcome"] == want, (idx, v["failed"])


def test_end_of_week_catches_a_duplicate_confirmation_and_an_edited_log_row(gens, refs):
    g = gens[610]
    w0 = H.new_world(g["world0"]).model_dump(mode="json")
    final = refs[610]["afters"][-1]
    assert O.grade_end(w0, final, g["end"])["pass"]
    dup = copy.deepcopy(final)
    m = next(x for x in dup["gmail"]["messages"] if x["subject"] == L.CONFIRM_SUBJECT and "SENT" in x["label_ids"]
             and x["id"] not in {y["id"] for y in w0["gmail"]["messages"]})
    dup["gmail"]["messages"].append(dict(m, id="dupconfirm000001"))
    assert "end.confirmations" in {n for n, _ in O.grade_end(w0, dup, g["end"])["failed"]}
    ed = copy.deepcopy(final)
    row = next(r for r in ed["google_sheets"]["rows"] if r["spreadsheet_id"] == L.SHEETS["log"]["ss"])
    row["cells"]["Action"] = "Skipped" if row["cells"]["Action"] != "Skipped" else "Archived"
    names = {n for n, _ in O.grade_end(w0, ed, g["end"])["failed"]}
    assert {"end.log", "end.append-only"} <= names, names


# ---------------------------------------------------------------------------------------------- helpers and docs
def test_helpers_agree_between_the_two_implementations():
    s = R.Suppression(None)
    for subj, want in (("Unsubscribe", True), ("Re: UNSUBSCRIBE", True), ("RE: unsubscribe ", True), ("Fwd: Re: unsubscribe", True),
                       ("unsubscribe me", False), ("Suppression policy amendment", False), ("", False)):
        assert L.is_unsub_subject(subj) == s.unsub_subject(subj) == want, subj
    for notes in ("HOLD until 2026-03-06 (account dispute)", "Temporary hold until 2026-03-06, do not archive", "hold", ""):
        assert L.hold_date(notes) == s.hold_until(notes)
    for notes in ("RESOLVED - DNS corrected", "pre-migration", "Retracted by subscriber", "Premium-tier subscriber", "Duplicate entry"):
        assert L.is_invalid(notes) == s.invalid(notes) and L.is_duplicate(notes) == s.duplicate(notes)
    assert L.in_window("2026-03-02", "2026-03-31", 30) and not L.in_window("2026-03-01", "2026-03-31", 30)
    assert R.window_start("2026-03-31", 30) == "2026-03-02"
    assert L.addr("Ann Lee <Ann.Lee@X.example.com>") == R.email_addr("Ann Lee <Ann.Lee@X.example.com>") == "ann.lee@x.example.com"
    assert L.daily_text("2026-03-04", 5, 1, 3) == "2026-03-04: archived 5, escalated 1, confirmations 3"


def test_policy_and_family_files_agree_with_the_code():
    policy = (FAM / "POLICY.md").read_text()
    for p, v in L.DEFAULTS.items():
        assert re.search(rf"\|\s*{re.escape(p)}\s*\|\s*{re.escape(v)}\b", policy), p
    for x in (L.COMPLIANCE, L.INBOX, L.CONFIRM_SUBJECT, L.AM_SUBJECT_PREFIX.strip(), "<YYYY-MM-DD>: archived <N>, escalated <M>, confirmations <K>"):
        assert x in policy, x
    for sh in L.SHEETS.values():
        assert f"`{sh['ss']}`" in policy and f"`{sh['ws_title']}`" in policy and ", ".join(sh["headers"]) in policy, sh["title"]
    for a in L.ACTIONS + L.EVENTS:
        assert f"`{a}`" in policy, a
    spec = json.loads((FAM / "family.json").read_text())
    assert spec["id"] == L.FAMILY and spec["version"] == L.VERSION and sorted(spec["apps"]) == sorted(L.APPS)
    assert [a["parameter"] for a in spec["amendable"]] == L.PARAMS and spec["hardRequirements"] == []
    readme = (FAM / "README.md").read_text()
    for gnd in spec["grounding"]:
        assert gnd["task"] in readme and gnd["span"] in readme


def test_smoke_difficulty_d1_has_no_traps_and_is_solved():
    g = G.generate(631, "d1")
    assert not any(t["traps"] for t in g["triggers"]) and not any(t["kind"] in ("repeat", "policy.amendment") for t in g["triggers"])
    assert H.run_stream("ref", 631, g=g)["clean_week"]
