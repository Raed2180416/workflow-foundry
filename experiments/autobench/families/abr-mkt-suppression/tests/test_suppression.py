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
from datetime import timedelta
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
         "confirmall": {"recent-confirm", "reprocess", "in-week-confirm"}, "anyauthor": {"unauthorized-amendment"},
         "noreprocess": {"reprocess"}, "noskip": {"resolved", "retracted", "pre-migration"}, "effectivenow": {"future-parameter"},
         "cachedlog": {"in-week-confirm"}}
# variants whose clause exists only in some weeks (amendments and reprocess at d3, window edges, recent confirmations,
# invalid-note rows, the in-week re-opt-in at d3)
NARROW = {"anyauthor", "noreprocess", "nowindow", "confirmall", "noskip", "effectivenow", "cachedlog"}


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
        lo, hi = (0.40, 0.62) if g["meta"]["difficulty"] == "d2" else (0.66, 0.86)  # 601-650: d2 0.45-0.58, d3 0.73-0.81
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


def test_ignoring_effective_dates_fails_every_week(gens):
    """The world0 Policy Log holds a row Compliance approved for a date after the week (d2 and d3). A solver that ignores
    the Effective date applies it at once; the generator keeps a row that changes at least one outcome every week."""
    for s, g in gens.items():
        fr = g["meta"]["future_row"]
        assert fr and fr["Effective"] > g["triggers"][-1]["at"][:10] and fr["discriminating"] >= 1, (s, fr)
        assert sum("future-parameter" in t["traps"] for t in g["triggers"]) == fr["discriminating"]
        res = H.run_stream("effectivenow", s, g=g)
        assert not res["clean_week"], s
        assert any(not r["pass"] and "future-parameter" in r["traps"] for r in res["rows"]), s
    assert G.generate(631, "d1")["meta"]["future_row"] is None


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
                       ("FW: unsubscribe", True), ("Fw: RE: UNSUBSCRIBE", True), ("Re: Unsubscribe confirmation", False),
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



# ---------------------------------------------------------------------------------------------- review 2026-10-21
# Regression tests for the defects a review found on 2026-10-21 (README "Changes"). Test-only one-defect variants of
# the reference stand for the probe solvers the review used.
def _variant_run(cls, seed, g):
    return H.run_stream(cls.__name__, seed, g=g, fn=C.variant(cls))


def _failed_names(rows):
    return Counter(n for r in rows if not r["pass"] for n, _ in r["failed"])


def _section(policy: str, n: int) -> str:
    return " ".join(policy.split(f"## {n}.")[1].split(f"## {n + 1}.")[0].split())


def test_policy_states_the_clauses_the_review_found_missing():
    policy = (FAM / "POLICY.md").read_text()
    s5, s6, s7, s8, s9 = (_section(policy, n) for n in (5, 6, 7, 8, 9))
    # 1: which events get a Compliance Log row
    assert "Every Unsubscribe Requests row, Email Bounces row or unsubscribe email that this policy handles appends exactly one" in s6
    assert "not a daily close" in s6 and "not an amendment (Compliance's included)" in s6 and "cannot decide" in s6
    # 2, 4: the confirmation body is a fixed sentence, checkable without a model
    assert f"`<address> {L.CONFIRM_PHRASE}.`" in s5 and "names no individual list" in s5
    # 7: an undecidable released row at a daily close
    assert "one post per such row" in s7 and "go on with the close" in s7 and "tries it again" in s7 and "section 7" in s9
    # 8: FW prefixes
    assert "`Re:`, `Fw:` or `Fwd:`" in s5
    # 10: repeated deliveries of a close and of an amendment
    assert "this close has already run: do nothing" in s7 and "(a repeated delivery), do nothing" in s8


def test_truth_writes_no_log_row_for_closes_and_amendments(gens):
    """POLICY.md section 6 (defect 1): amendments write no Compliance Log row, and a daily close writes only the rows of
    the holds it releases."""
    for g in gens.values():
        for t, tr in zip(g["triggers"], g["truth"]):
            log = tr["expect"]["rows"]["log"]
            if t["kind"] == "policy.amendment":
                assert not log, t["trigger"]
            elif t["kind"] == "day.close" and log:
                assert "hold-release" in tr["traps"], t["trigger"]


def test_confirmation_content_check_follows_the_policy_sentence():
    a = "ann.lee@riverside.example.com"
    good = [f"Hello,\n\n{a} has been removed from all our mailing lists. You will not receive marketing email from us again.\n",
            f"Hi,\n\nThis confirms that {a.title()} has been removed\nfrom all our mailing lists\n\nThanks",
            f"<p>Good news: <b>{a}</b> has been removed from all our mailing lists.</p>"]
    bad = [f"{a} has been unsubscribed from every one of our mailing lists.",  # paraphrase (the policy fixes the sentence)
           f"We have not removed {a} from all our mailing lists; it was removed from the Newsletter only and stays on the others.",
           f"It is not true that {a} has been removed from all our mailing lists.",
           f"{a} has been removed from all our mailing lists except Partner Offers.",
           f"{a} has been removed from all our mailing lists. You stay on Product Updates.",
           f"x{a} has been removed from all our mailing lists."]
    assert all(O.confirmation_ok(b, a) for b in good)
    assert not any(O.confirmation_ok(b, a) for b in bad)


class _Paraphrase(R.Suppression):
    def send(self, to, subject, body):
        if subject == R.CONFIRM_SUBJECT:
            body = f"Hello,\n\n{to} has been unsubscribed from every one of our mailing lists.\n"
        super().send(to, subject, body)


class _NotRemoved(R.Suppression):
    def send(self, to, subject, body):
        if subject == R.CONFIRM_SUBJECT:
            body = (f"We have not removed {to} from all our mailing lists; it was removed from the Newsletter only and stays "
                    f"on the others.")
        super().send(to, subject, body)


class _SemicolonCc(R.Suppression):
    def send(self, to, subject, body):
        if subject == R.CONFIRM_SUBJECT:
            to = f"Subscriber <{to}>; marketing-ops@company.example.com"  # the old Q4 email's trap
        super().send(to, subject, body)


class _SubjectCase(R.Suppression):
    def send(self, to, subject, body):
        super().send(to, subject.upper(), body)


class _LogEmailUpper(R.Suppression):
    def log(self, today, email, event, action, ref, lists=(), conf=""):
        super().log(today, email.upper(), event, action, ref, lists, conf)


class _PostThenDelete(R.Suppression):
    def handle(self, p):
        r = self.call("POST", f"{R.SLACK}/chat.postMessage", None, {"channel": "marketing", "text": f"handling {p['data']}"[:200]})
        self.call("POST", f"{R.SLACK}/chat.delete", None, {"channel": "marketing", "ts": r["ts"]})
        super().handle(p)


class _FwStrict(R.Suppression):
    def unsub_subject(self, subject):
        s = (subject or "").strip()
        while (m := re.match(r"(?i)\s*(re|fwd)\s*:\s*", s)):
            s = s[m.end():]
        return s.strip().lower() == "unsubscribe"


def test_oracle_rejects_confirmations_the_policy_does_not_allow(gens):
    """Defects 2 and 4: a paraphrase without the policy's sentence, and a body that contradicts it, fail exactly on the
    confirmation triggers."""
    g = gens[610]
    conf = {t["trigger"] for t in g["truth"] if any(e["kind"] == "confirmation" for e in t["expect"]["emails"])}
    assert conf
    for cls in (_Paraphrase, _NotRemoved):
        res = _variant_run(cls, 610, g)
        bad = [r for r in res["rows"] if not r["pass"]]
        assert {r["taskKey"] for r in bad} == conf, cls.__name__
        assert all("email.content:confirmation" in {n for n, _ in r["failed"]} for r in bad), (cls.__name__, _failed_names(bad))


def test_oracle_rejects_a_semicolon_joined_recipient(gens):
    """Defect 3: 'Subscriber <ann@x>; marketing-ops@...' is stored as one To entry; it is two recipients."""
    assert O.parse_recipient("Subscriber <ann@x.example.com>; marketing-ops@company.example.com") == [
        "ann@x.example.com", "marketing-ops@company.example.com"]
    assert O.parse_recipient('"Lee, Ann" <Ann@X.example.com>') == ["ann@x.example.com"]
    assert O.parse_recipient("ann@x.example.com please")[0].startswith("invalid:")
    g = gens[610]
    res = _variant_run(_SemicolonCc, 610, g)
    names = _failed_names(res["rows"])
    assert not res["clean_week"] and names["email.exact"] > 0, names
    assert res["rows"][-1]["failed"] and "end:end.never-recipients" in {n for n, _ in res["rows"][-1]["failed"]}


def test_oracle_holds_subjects_and_log_addresses_to_the_policy_wording(gens):
    """Defect 9: 'Subject exactly' and 'Write addresses in lower case' are checked as written (other log values keep
    their documented leniency; the specificity gate covers that)."""
    g = gens[610]
    for cls, check in ((_SubjectCase, "email.exact"), (_LogEmailUpper, "rows.log")):
        res = _variant_run(cls, 610, g)
        assert not res["clean_week"] and _failed_names(res["rows"])[check] > 0, cls.__name__


def test_a_post_deleted_again_is_still_a_write(gens):
    """Defect 5: a Slack post followed by chat.delete in the same trigger is an envelope effect."""
    res = _variant_run(_PostThenDelete, 610, gens[610])
    assert not any(r["pass"] for r in res["rows"])
    assert _failed_names(res["rows"])["envelope"] == len(res["rows"])


def test_fw_prefixed_unsubscribe_emails_are_requests(gens):
    """Defect 8: every d2/d3 week carries one FW-prefixed unsubscribe email, and a reader that strips only Re:/Fwd:
    fails on it."""
    for s, g in gens.items():
        fw = [t for t in g["triggers"] if "fw-prefix" in t["traps"]]
        assert len(fw) == 1 and re.match(r"(?i)fw\s*:", fw[0]["payload"]["data"]["subject"]), s
    res = _variant_run(_FwStrict, 611, gens[611])
    assert any(not r["pass"] and "fw-prefix" in r["traps"] for r in res["rows"])


def test_a_reply_to_a_confirmation_is_not_a_request(gens, bad):
    """d2 weeks carry 'Re: Unsubscribe confirmation' from an address confirmed earlier that week: nothing to do."""
    for s in (610, 612, 614):
        g = gens[s]
        idx = [i for i, t in enumerate(g["triggers"]) if "confirm-reply" in t["traps"]]
        assert len(idx) == 1 and g["truth"][idx[0]]["outcome"] == "no-op", s
        addr = L.addr(g["triggers"][idx[0]]["payload"]["data"]["from"])
        assert any(e["to"] == addr and e["kind"] == "confirmation" for t in g["truth"][:idx[0]] for e in t["expect"]["emails"]), s
    rows = [r for s in (610, 612) for r in bad["naive"][s]["rows"]]
    assert any(not r["pass"] and "confirm-reply" in r["traps"] for r in rows)


def test_in_week_confirmation_comes_from_this_weeks_own_row(gens, bad):
    """Defect 6: at d3 an address confirmed early in the week re-opts in (host-side delta) and asks again: archive, no
    confirmation, and the only Sent row that says so is the one written by this week's first request."""
    for s in (611, 613):
        g = gens[s]
        idx = [i for i, t in enumerate(g["truth"]) if "in-week-confirm" in t["traps"]]
        assert len(idx) == 1, s
        i = idx[0]
        tr, trig = g["truth"][i], g["triggers"][i]
        row = tr["expect"]["rows"]["log"][0]
        assert tr["expect"]["archive"] and not tr["expect"]["emails"] and row["Action"] == "Archived" and row["Confirmation"] == ""
        assert trig["delta"][0]["op"] == "set_member" and trig["delta"][0]["email"] == row["Email"]
        assert not any(r["Email"] == row["Email"] for r in world0_rows(g, "log"))
        assert any(r["Email"] == row["Email"] and r["Confirmation"] == "Sent" and r["Date"] < row["Date"]
                   for t in g["truth"][:i] for r in t["expect"]["rows"]["log"])
    for name in ("cachedlog", "confirmall"):
        assert any(not r["pass"] and "in-week-confirm" in r["traps"] for s in (611, 613) for r in bad[name][s]["rows"]), name


class _HeldPremiumGen(G.Gen):
    """A world0 Email Bounces row that is both on hold until Monday and Premium-tier, with no Account Managers row: the
    hard-bounce rule cannot decide it when Monday's daily close releases it (defect 7; the stream generator never plants
    this)."""

    def plan_preheld(self, n):
        super().plan_preheld(n)
        e = self.fresh()
        self.held_premium = e
        self.h_bounce_row(e, self.monday - timedelta(days=3), "Hard", f"Temporary hold until {G.ds(self.monday)}, Premium-tier subscriber")


class _CloseStops(R.Suppression):
    """Reads section 9 alone: at the first undecidable released row it escalates and does nothing else."""

    def on_close(self, p, today):
        for key, ref in (("requests", R.REQUESTS), ("bounces", R.BOUNCES)):
            for cells in self.sheet(ref)[1]:
                if self.releasable(cells, self.sheet(R.COMPLIANCE_LOG)[1], today, key):
                    self.apply_rule(key, cells, today)  # Undecidable propagates: handle() escalates, no post
        super().on_close(p, today)


def test_an_undecidable_release_at_a_daily_close_is_escalated_and_the_close_goes_on():
    gen = _HeldPremiumGen(611, "d3")
    g = gen.run()
    closes = [(t, tr) for t, tr in zip(g["triggers"], g["truth"]) if t["kind"] == "day.close"]
    for t, tr in closes:  # unhandled, so every close tries it again
        assert tr["outcome"] == "act" and len(tr["expect"]["sink"]) == 1 and gen.held_premium in tr["expect"]["sink"][0], t["trigger"]
        assert [ch for ch, _ in tr["expect"]["slack"]] == ["compliance"]
    assert {t["trigger"] for t, _ in closes} <= set(g["end"]["escalations"])
    assert H.run_stream("ref", 611, g=g)["clean_week"]
    res = H.run_stream("closestops", 611, g=g, fn=C.variant(_CloseStops))
    first = next(r for r in res["rows"] if r["kind"] == "day.close")
    assert not first["pass"] and "slack.exact" in {n for n, _ in first["failed"]}
    # an extra or missing escalation post at that close is caught too
    ci = next(i for i, t in enumerate(g["triggers"]) if t["kind"] == "day.close")
    w = _trigger_world(g, ci)
    before = w.model_dump(mode="json")
    p = g["triggers"][ci]["payload"]
    R.handle(copy.deepcopy(p), H.Api(w))
    H.Api(w).fetch("POST", f"{R.SLACK}/chat.postMessage", None, {"channel": "automation-review", "text": f"{p['trigger']}: again"})
    v = O.grade_trigger(before, w.model_dump(mode="json"), g["truth"][ci], p)
    assert not v["pass"] and "slack.sink" in {n for n, _ in v["failed"]}


class _RetryGen(G.Gen):
    """Adds a repeated webhook delivery of the authorized amendment and of Monday's daily close (defect 10; the stream
    generator does not plant these)."""

    def build_noise(self):
        super().build_noise()
        amend = next(e for e in self.events if e["kind"] == "policy.amendment" and e["sub"] == "authorized")
        close = next(e for e in self.events if e["kind"] == "day.close")
        for orig, dt in ((amend, timedelta(minutes=1)), (close, timedelta(minutes=5))):
            t = orig["t"] + dt
            while self.minute_of(t) in self.used_minutes:
                t += timedelta(minutes=1)
            self.used_minutes.add(self.minute_of(t))
            self.events.append({**{k: copy.deepcopy(orig[k]) for k in ("app", "event", "data")}, "kind": "repeat", "sub": "retry",
                                "t": t, "traps": ["retry"], "delta": [], "addr": orig["addr"], "guard": [], "msg": orig.get("msg"),
                                "amend": orig.get("amend")})


class _NoCloseDedupe(R.Suppression):
    def closed(self, today):
        return False


class _NoAmendmentDedupe(R.Suppression):
    def amendment_logged(self, eff, param, value):
        return False


def test_repeated_deliveries_of_a_close_and_an_amendment_change_nothing():
    g = _RetryGen(611, "d3").run()
    rep = {t["payload"]["event"]: (i, t) for i, t in enumerate(g["triggers"]) if t["kind"] == "repeat" and t["payload"]["event"] in
           ("daily_close", "new_email") and (t["payload"]["event"] == "daily_close" or "amendment" in t["payload"]["data"]["subject"])}
    assert set(rep) == {"daily_close", "new_email"}
    for i, t in rep.values():
        assert g["truth"][i]["outcome"] == "no-op", t["trigger"]
    assert H.run_stream("ref", 611, g=g)["clean_week"]
    for cls, ev in ((_NoCloseDedupe, "daily_close"), (_NoAmendmentDedupe, "new_email")):
        res = H.run_stream(cls.__name__, 611, g=g, fn=C.variant(cls))
        assert not res["rows"][rep[ev][0]]["pass"], cls.__name__


def test_new_mutation_operators_are_all_flagged():
    r = H.gate_mutation([610, 611], None)
    for name in ("semicolon-cc", "subject-case", "confirm-paraphrase", "confirm-negated", "confirm-names-list", "row-email-case",
                 "post-then-delete"):
        hit, total = map(int, r["by_mutation"][name].split("/"))
        assert total > 0 and hit == total, (name, r["by_mutation"][name])
