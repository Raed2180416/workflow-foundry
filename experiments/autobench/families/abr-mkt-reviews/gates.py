#!/usr/bin/env python3
"""abr-mkt-reviews $0 validity gates (RECURRING-DESIGN §3.11), run inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I -B experiments/autobench/families/abr-mkt-reviews/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR]

Exit 0 only when every gate passes.

  determinism   two generations give identical hashes; every world_t after its delta validates and round-trips
  leakage       payloads, serve rows and world0 carry no truth, expected strings or this week's records; the reference
                imports no host-side module
  solvability   the observable-only reference passes every trigger and every week (practice + dev seeds)
  controls      every bad control fails; null passes exactly the no-op triggers; naive < 60% at d3
  traps         every trap kind appears at least 5 times on the four dev label streams 610-613
  clauses       every d3 week has a review that each floor clause decides (gen.FLOOR), and the d3 label weeks amend
                both parameters between them (added 2026-10-21); every d2/d3 week has a repeat update from a reviewer
                ticketed earlier that week and every d3 week a malformed notification (gen.WEEK_FLOOR, review fixes 2026-10-21)
  mutation      single-fault mutants of the reference's correct worlds are rejected (score >= 0.95)
  specificity   policy-neutral variants of the reference's correct worlds are accepted (no false rejects)
  probes        whole-stream oracle probes (probes.py, review fixes 2026-10-21): every WRONG probe fails on its own triggers, every
                CORRECT probe passes every trigger
"""
from __future__ import annotations

import argparse
import ast
import copy
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import harness  # noqa: E402  (pins TZ=UTC and finds bridge.py)
import gen  # noqa: E402
import lib as L  # noqa: E402
import oracle  # noqa: E402

LABEL = [610, 611, 612, 613]
BAD_CONTROLS = ["null", "echo", "naive", "intern-policy", "ignore-notes", "subject-rating", "no-dedupe",
                "substring-dedupe", "rolling-week", "no-crash-rule", "substring-crash", "old-dates",
                "any-sender-amend", "no-amendments", "stale-code", "count-all",
                # added 2026-10-21
                "no-abuse", "no-bot", "crash-rating-only", "crash-thanks", "eng-email", "comp-email",
                "ticket-amend-ignored", "eng-no-ticket", "comp-no-ticket", "base-forms", "no-escalate",
                "oldest-amendment", "thanks-amend-ignored", "week-count", "reply-requester", "any-poster-code",
                "updated-ignored"]
# controls that break a gen.FLOOR clause: each must fail on every d3 week
FLOOR_CONTROLS = {"no-abuse": "abuse", "no-bot": "bot", "crash-rating-only": "crash-high-rating",
                  "crash-thanks": "crash-high-rating", "eng-email": "eng-high", "comp-email": "comp-high"}
# controls that break a gen.WEEK_FLOOR rule (review fixes 2026-10-21): each must fail on every week of these difficulties, on a
# trigger carrying the trap
WEEK_FLOOR_CONTROLS = {"no-dedupe": ("T-repeat:ticket-this-week", ("d2", "d3")),
                       "no-escalate": ("T-format:no-rating", ("d3",))}
PAYLOAD_KEYS = {"trigger", "at", "app", "event", "data"}
DATA_KEYS = {"message_id", "thread_id", "from", "to", "subject", "snippet"}


import sys as _b0_sys  # B0: experiments/autobench on the path for the shared abr.lib
from pathlib import Path as _B0Path
if str(_B0Path(__file__).resolve().parents[2]) not in _b0_sys.path:
    _b0_sys.path.append(str(_B0Path(__file__).resolve().parents[2]))
from abr.lib import common as _abr_common  # noqa: E402
from abr.lib import host as _abr_host  # noqa: E402


stream_hashes = _abr_common.make_stream_hashes(gen.sha)


def gate_determinism(seeds: list[int]) -> dict:
    from automationbench.schema.world import WorldState
    problems, hashes = [], {}
    for s in seeds:
        a, b = gen.generate(s), gen.generate(s)
        ha, hb = stream_hashes(a), stream_hashes(b)
        if ha != hb:
            problems.append(f"{s}: regenerated stream differs in {[k for k in ha if ha[k] != hb[k]]}")
        hashes[s] = ha["triggers"]
        w = a["world0"]
        for t in a["triggers"]:
            w = harness.apply_delta(w, t["delta"], t["at"])
            with harness.bridge().SHIM.active():
                again = WorldState(**w).model_dump(mode="json")
            if gen.canon(again) != gen.canon(w):
                problems.append(f"{s}/{t['trigger']}: world_t does not round-trip")
                break
    if len(set(hashes.values())) != len(hashes):
        problems.append("two seeds produced the same trigger stream")
    return {"pass": not problems, "seeds": seeds, "problems": problems}


# ---------------------------------------------------------------------------------------------------------------------
# leakage
# ---------------------------------------------------------------------------------------------------------------------
TRUTH_WORDS = ("variant", "traps", "truth", "expect", "guards", "T-repeat", "T-lookalike", "T-stale", "T-note",
               "T-format", "T-authority", "amend:applies", "after:")


def expected_strings(out: dict) -> set[str]:
    """Strings only a correct arm writes this week: ticket subjects, summary lines and acknowledgements."""
    toks = set()
    for t in out["truth"]:
        for x in t["expect"]["tickets"]:
            toks.add(x["subject"])
        for m in t["expect"]["emails"]:
            if m["kind"] == "summary":
                toks.add(m["body"])
        for sp in t["expect"]["slack"]:
            toks.add(sp["text"])
    return toks


def gate_leakage(seeds: list[int]) -> dict:
    problems = []
    policy = (HERE / "POLICY.md").read_text()
    for s in seeds:
        out = gen.generate(s)
        toks = expected_strings(out)
        w0 = out["world0"]
        w0blob = gen.canon(w0)
        week_ms = oracle._ms(out["end"]["week_start"])
        w0_ids = {m["id"] for m in w0["gmail"]["messages"]} | {t["id"] for t in w0["hubspot"]["tickets"]}
        for trig, payload in zip(out["triggers"], out["payloads"]):
            if trig["payload"] != payload:
                problems.append(f"{trig['trigger']}: payloads.jsonl differs from the trigger's payload")
            if set(payload) != PAYLOAD_KEYS or not set(payload["data"]) <= DATA_KEYS:
                problems.append(f"{trig['trigger']}: unexpected payload keys {sorted(payload)} / {sorted(payload['data'])}")
            blob = gen.canon(payload)
            leaked = sorted(x for x in toks | set(TRUTH_WORDS) if x and x in blob)
            if leaked:
                problems.append(f"{trig['trigger']}: payload carries hidden strings {leaked[:3]}")
            for op in trig["delta"]:
                if op["record"].get("id") in w0_ids:
                    problems.append(f"{trig['trigger']}: a delta record is already in world0")
            row = gen.serve_input(s, trig)
            info = json.loads(row["info"])
            if info["assertions"] or any(info["initial_state"][a] for a in gen.APPS):
                problems.append(f"{trig['trigger']}: the serve-input row carries assertions or world records")
            if row["prompt"][1]["content"] != policy + "\n\nTrigger:\n" + gen.canon(payload):
                problems.append(f"{trig['trigger']}: the serve prompt holds more than POLICY.md and the payload")
        for x in sorted(toks):
            if x in w0blob:
                problems.append(f"{s}: world0 already holds {x!r}")
        for word in TRUTH_WORDS:
            if f'"{word}"' in w0blob or (word.endswith(":") and word in w0blob):
                problems.append(f"{s}: world0 mentions {word!r}")
        if any(str(t["created_at"]) >= out["end"]["week_start"].replace("Z", "") for t in w0["hubspot"]["tickets"]):
            problems.append(f"{s}: world0 holds a ticket created this week")
        if any(oracle.is_sent(m) and int(m["date"]) >= week_ms for m in w0["gmail"]["messages"]):
            problems.append(f"{s}: world0 holds mail sent this week")
    tree = ast.parse((HERE / "reference.py").read_text())
    imported = {n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else a.name.split(".")[0]
                for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in (n.names if isinstance(n, ast.Import) else [n])}
    host = imported & {"gen", "oracle", "harness", "gates", "controls", "lib", "automationbench", "bridge"}
    if host:
        problems.append(f"reference.py imports host-side modules {sorted(host)}")
    return {"pass": not problems, "seeds": seeds, "problems": problems[:20], "n_problems": len(problems)}


# ---------------------------------------------------------------------------------------------------------------------
# solvability, controls, traps
# ---------------------------------------------------------------------------------------------------------------------
def gate_solvability(seeds: list[int]) -> dict:
    summary, _ = harness.run("reference", seeds)
    return {"pass": summary["passed"] == summary["triggers"] and summary["clean_weeks"] == summary["streams"],
            **{k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "streams", "per_stream",
                                       "by_variant")}}


def gate_controls(seeds: list[int], d3_seeds: list[int]) -> dict:
    res, problems = {}, []
    noop = sum(1 for s in seeds for t in gen.generate(s)["truth"] if t["outcome"] == "no-op")
    for name in BAD_CONTROLS:
        summary, _ = harness.run(name, seeds)
        res[name] = {k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "outcomes")}
        if summary["passed"] == summary["triggers"] or summary["clean_weeks"] == summary["streams"]:
            problems.append(f"{name} does not fail")
    if res["null"]["passed"] != noop:
        problems.append(f"null passes {res['null']['passed']} triggers, the no-op share is {noop}")
    d3_runs = {}
    for name in FLOOR_CONTROLS:
        _, results = harness.run(name, d3_seeds)
        d3_runs[name] = [r["seed"] for r in results if r["clean_week"]]
        if d3_runs[name]:
            problems.append(f"{name} passes the d3 weeks {d3_runs[name]}")
    week_runs = {}
    for name, (trap, diffs) in WEEK_FLOOR_CONTROLS.items():
        _, results = harness.run(name, seeds)
        week_runs[name] = [r["seed"] for r in results if r["difficulty"] in diffs
                           and not any(not x["pass"] and trap in x["traps"] for x in r["rows"])]
        if week_runs[name]:
            problems.append(f"{name} never fails on {trap} in the weeks {week_runs[name]}")
    naive_d3, _ = harness.run("naive", d3_seeds)
    if naive_d3["pass_rate"] >= 0.6:
        problems.append(f"naive scores {naive_d3['pass_rate']} at d3")
    import controls
    if controls.NAIVE_LINES > 40:
        problems.append(f"naive has {controls.NAIVE_LINES} lines (> 40)")
    return {"pass": not problems, "seeds": seeds, "noop_triggers": noop, "controls": res,
            "floor_controls_clean_d3_weeks": d3_runs, "week_floor_controls_unhit_weeks": week_runs,
            "naive_d3": {"seeds": d3_seeds, "pass_rate": naive_d3["pass_rate"], "lines": controls.NAIVE_LINES},
            "problems": problems}


def gate_traps(seeds: list[int]) -> dict:
    kinds, ids = Counter(), Counter()
    for s in seeds:
        for t in gen.generate(s)["truth"]:
            for x in t["traps"]:
                kinds[x.split(":")[0]] += 1
                ids[x] += 1
    short = [k for k in gen.TRAP_KINDS if kinds[k] < 5]
    return {"pass": not short, "seeds": seeds, "by_kind": dict(sorted(kinds.items())), "by_id": dict(sorted(ids.items())),
            "short": short}


def gate_clauses(seeds: list[int]) -> dict:
    """Every d3 week decides each floor clause on at least one review; the d3 label weeks amend both parameters."""
    problems, floor, params = [], {}, {}
    for s in seeds:
        out = gen.generate(s, validate=False)
        if out["meta"]["difficulty"] != "d3":
            continue
        g = gen.Gen(s, "d3")
        g.build_staff()
        g.history()
        g.plan_week()
        for t in gen.FLOOR["d3"]:
            n = sum(1 for p in g.plans if g.floor_covers(p, t))
            floor.setdefault(t, {})[s] = n
            if n < 1:
                problems.append(f"{s}: no review decides T-note:{t}")
        params[s] = out["meta"]["amend_param"]
    week = {}
    for s in seeds:
        d = gen.default_difficulty(s)
        g = gen.Gen(s, d)
        g.build_staff()
        g.history()
        g.plan_week()
        for t in gen.WEEK_FLOOR[d]:
            ok = g.week_floor_covers(t)
            week.setdefault(t, {})[s] = ok
            if not ok:
                problems.append(f"{s} ({d}): the week floor {t!r} does not hold")
    label_d3 = [s for s in LABEL if s in params]
    if len(label_d3) >= 2 and set(params[s] for s in label_d3) != set(L.PARAMS):
        problems.append(f"d3 label weeks amend only {sorted(set(params[s] for s in label_d3))}")
    return {"pass": not problems, "seeds": sorted(params), "floor": floor, "amend_param": params, "week_floor": week,
            "problems": problems}


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score and specificity
# ---------------------------------------------------------------------------------------------------------------------
def _new(before: dict, after: dict, app: str, coll: str) -> list[str]:
    ids = {r.get("id") for r in before[app][coll]}
    return [r["id"] for r in after[app][coll] if r.get("id") not in ids]


def _new_slack(before: dict, after: dict) -> list[str]:
    old = {(m["channel_id"], m["ts"]) for m in before["slack"]["messages"]}
    return [m["ts"] for m in after["slack"]["messages"] if (m["channel_id"], m["ts"]) not in old]


def _find(world: dict, app: str, coll: str, rid: str):
    return next((r for r in world[app][coll] if r.get("id") == rid), None)


def _slack(world: dict, ts: str):
    return next(m for m in world["slack"]["messages"] if m["ts"] == ts)


_chan = _abr_common._chan


def _now_ms(w: dict) -> int:
    return oracle._ms(w["meta"]["current_time"])


def _now_naive(w: dict) -> str:
    return str(w["meta"]["current_time"]).replace("Z", "").split("+")[0]


def add_mail(w: dict, to: str, subject: str, body: str, k: int):
    m = copy.deepcopy(next(x for x in w["gmail"]["messages"] if oracle.is_sent(x)))
    m.update({"id": f"mut{k:013d}", "thread_id": f"mut{k:013d}", "to": [to], "cc": [], "bcc": [], "subject": subject,
              "body_plain": body, "body_html": None, "snippet": body[:100], "label_ids": ["SENT"], "date": _now_ms(w),
              "internal_date": _now_ms(w)})
    w["gmail"]["messages"].append(m)


def add_ticket(w: dict, subject: str, content: str, k: int):
    t = copy.deepcopy(w["hubspot"]["tickets"][0])
    t.update({"id": f"9{k:010d}", "subject": subject, "content": content, "created_at": _now_naive(w),
              "updated_at": _now_naive(w)})
    w["hubspot"]["tickets"].append(t)


def add_post(w: dict, channel: str, text: str, k: int):
    m = copy.deepcopy(w["slack"]["messages"][0])
    m.update({"id": f"MUT{k}", "channel_id": _chan(w, channel), "text": text, "ts": f"{_now_ms(w) // 1000}.{k:06d}"})
    w["slack"]["messages"].append(m)


def mutants(before: dict, after: dict, truth: dict, world0: dict):
    """Single-fault mutants of a correct after-world. Returns [(name, mutated_after)]."""
    exp, out, k = truth["expect"], [], [0]
    new_t = _new(before, after, "hubspot", "tickets")
    new_m = [i for i in _new(before, after, "gmail", "messages") if oracle.is_sent(_find(after, "gmail", "messages", i))]
    new_s = _new_slack(before, after)
    reviewer = next((g for g in truth["guards"]["no_email_to"]), None)

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        if fn(w) is not False:
            out.append((name, w))

    # -- generic faults, every trigger ---------------------------------------------------------------------------
    m("extra-ticket", lambda w: add_ticket(w, f"App review 2{L.STAR} - someone@post.example.com - TRIAGE-100-W01",
                                           "Extra.", k[0]))
    m("extra-email", lambda w: add_mail(w, "someone@post.example.com", L.THANKS_SUBJECT, "Thank you!", k[0]))
    m("extra-post-app-reviews", lambda w: add_post(w, L.APP_REVIEWS, "Handled a review.", k[0]))
    m("extra-escalation", lambda w: add_post(w, L.REVIEW, f"{truth['trigger']}: not sure", k[0]))
    w0_ticket = world0["hubspot"]["tickets"][0]["id"]
    m("edit-old-ticket", lambda w: _find(w, "hubspot", "tickets", w0_ticket).update(subject="Closed"))
    m("delete-old-ticket", lambda w: w["hubspot"]["tickets"].remove(_find(w, "hubspot", "tickets", w0_ticket)))
    w0_mail = world0["gmail"]["messages"][0]["id"]
    m("trash-old-mail", lambda w: _find(w, "gmail", "messages", w0_mail).update(
        label_ids=_find(w, "gmail", "messages", w0_mail)["label_ids"] + ["TRASH"]))
    m("delete-old-mail", lambda w: w["gmail"]["messages"].remove(_find(w, "gmail", "messages", w0_mail)))
    m("edit-old-post", lambda w: w["slack"]["messages"][0].update(text="edited"))
    if reviewer:
        m("email-protected", lambda w: add_mail(w, reviewer, L.THANKS_SUBJECT, "Thank you for your review!", k[0]))
        m("reply-protected", lambda w: add_mail(w, reviewer, "Re: your review", "We saw your message.", k[0]))
    for g in truth["guards"]["no_ticket_for"]:
        m("ticket-protected", lambda w, g=g: add_ticket(w, f"App review 1{L.STAR} - {g} - TRIAGE-100-W01", "x", k[0]))
        break

    # -- tickets -------------------------------------------------------------------------------------------------
    for tid in new_t[:1]:
        def t(w, tid=tid):
            return _find(w, "hubspot", "tickets", tid)
        subj = t(after)["subject"]
        m("drop-ticket", lambda w: w["hubspot"]["tickets"].remove(t(w)))
        m("dup-ticket", lambda w: w["hubspot"]["tickets"].append(dict(copy.deepcopy(t(w)), id="88" + tid[2:])))
        rating = subj.split(L.STAR)[0][-1]
        other = "3" if rating != "3" else "1"
        m("ticket-wrong-rating", lambda w: t(w).update(subject=subj.replace(f"{rating}{L.STAR}", f"{other}{L.STAR}")))
        m("ticket-no-star", lambda w: t(w).update(subject=subj.replace(L.STAR, " stars")))
        rv = subj.split(" - ")[1]
        m("ticket-wrong-reviewer", lambda w: t(w).update(subject=subj.replace(rv, "x" + rv)))
        code = subj.split(" - ")[-1]
        m("ticket-wrong-code", lambda w: t(w).update(subject=subj.replace(code, code[:-1] + ("9" if code[-1] != "9" else "8"))))
        m("ticket-no-code", lambda w: t(w).update(subject=subj.replace(" - " + code, "")))
        m("ticket-code-lowercase", lambda w: t(w).update(subject=subj.replace(code, code.lower())))   # review fixes 2026-10-21
        m("ticket-prefix-case", lambda w: t(w).update(subject=subj.replace("App review", "App Review")))
        if subj.startswith(L.HIGH):
            m("ticket-high-case", lambda w: t(w).update(subject=subj.replace(L.HIGH, "[High Priority] ")))
        m("ticket-content-in-description", lambda w: t(w).update(
            content=None, properties=dict(t(w).get("properties") or {}, description=t(w)["content"])))
        if subj.startswith(L.HIGH):
            m("ticket-drop-high", lambda w: t(w).update(subject=subj[len(L.HIGH):]))
        else:
            m("ticket-add-high", lambda w: t(w).update(subject=L.HIGH + subj))
        m("ticket-content", lambda w: t(w).update(content="See the store notification."))

    # -- emails --------------------------------------------------------------------------------------------------
    for mid in new_m[:1]:
        def e(w, mid=mid):
            return _find(w, "gmail", "messages", mid)
        msg = e(after)
        m("drop-email", lambda w: w["gmail"]["messages"].remove(e(w)))
        m("dup-email", lambda w: w["gmail"]["messages"].append(dict(copy.deepcopy(e(w)), id="dup" + mid[3:])))
        m("email-wrong-to", lambda w: e(w).update(to=["x" + msg["to"][0]]))
        m("email-extra-cc", lambda w: e(w).update(cc=["marketing@company.example.com"]))
        m("email-wrong-subject", lambda w: e(w).update(subject="Re: " + msg["subject"]))
        m("email-draft-not-sent", lambda w: e(w).update(label_ids=["DRAFT"]))
        if msg["subject"] == L.THANKS_SUBJECT:
            m("thanks-no-thank-you", lambda w: e(w).update(body_plain="We appreciate it.", body_html=None))
        else:
            body = msg["body_plain"]
            line = next(x["body"] for x in exp["emails"] if x["kind"] == "summary")
            code, rest = line.split(": ", 1)
            n = int(rest.split("tickets ")[1].split(",")[0])
            mm = int(rest.split("thank-yous ")[1])
            m("summary-tickets+1", lambda w: e(w).update(body_plain=body.replace(line, L.summary_line(code, n + 1, mm))))
            if n:
                m("summary-tickets-1", lambda w: e(w).update(body_plain=body.replace(line, L.summary_line(code, n - 1, mm))))
            m("summary-thanks+1", lambda w: e(w).update(body_plain=body.replace(line, L.summary_line(code, n, mm + 1))))
            m("summary-thanks*10", lambda w: e(w).update(body_plain=body.replace(line, L.summary_line(code, n, mm * 10 + 1))))
            m("summary-wrong-code", lambda w: e(w).update(body_plain=body.replace(code, "TRIAGE-QA-31")))
            m("summary-hedged", lambda w: e(w).update(body_plain=body + "\n" + L.summary_line(code, n + 1, mm)))
            m("summary-stale-code-line", lambda w: e(w).update(body_plain=body + "\nTRIAGE-100-W01: " + line.split(": ", 1)[1]))
            # review fixes 2026-10-21: hedges and second figures in other words, a count line that is not on its own, a code in
            # another case
            for op, extra in (("summary-hedge-words", f"\nRecount pending: possibly tickets {n + 1} and thank-yous "
                                                      f"{mm + 1} once late reviews are included."),
                              ("summary-hedge-numbers", f"\nRecount pending: possibly {n + 1} and {mm + 1}."),
                              ("summary-hedge-caveat", "\nThese counts may be off by one until the late reviews are in."),
                              ("summary-week-to-date", f"\nWeek to date: tickets {n + 4}, thank-yous {mm + 6}"),
                              ("summary-same-in-words", f"\nToday we opened {n} tickets and sent {mm} thank-you emails.")):
                m(op, lambda w, extra=extra: e(w).update(body_plain=body + extra))
            m("summary-hedge-inline", lambda w: e(w).update(body_plain=body.replace(
                line, line + " (or one more ticket if the late crash review counts)")))
            m("summary-line-prefixed", lambda w: e(w).update(body_plain=body.replace(line, "Today's counts: " + line)))
            m("summary-code-lowercase", lambda w: e(w).update(body_plain=body.replace(code, code.lower())))
            m("summary-wrong-date", lambda w: e(w).update(subject=msg["subject"][:-1] + ("0" if msg["subject"][-1] != "0" else "1")))

    # -- slack ---------------------------------------------------------------------------------------------------
    for ts in new_s[:1]:
        text = _slack(after, ts)["text"]
        m("drop-post", lambda w: w["slack"]["messages"].remove(_slack(w, ts)))
        m("post-deleted", lambda w: _slack(w, ts).update(is_deleted=True))
        m("post-wrong-channel", lambda w: _slack(w, ts).update(channel_id=_chan(w, "marketing")))
        if exp["slack"]:
            val = exp["slack"][0]["text"].split(" = ")[1]
            m("ack-wrong-value", lambda w: _slack(w, ts).update(text=text.replace(" = " + val, " = 1-2" if val != "1-2" else " = 1-3")))
        if exp["escalate"]:
            m("escalation-without-id", lambda w: _slack(w, ts).update(text="Cannot decide this one."))

    # -- a no-op trigger handled as if it were a plain review ------------------------------------------------------
    if truth["outcome"] == "no-op" and truth["kind"].startswith("review") and reviewer:
        m("noop-ticketed", lambda w: add_ticket(w, f"App review 1{L.STAR} - {reviewer} - TRIAGE-100-W01", "x", k[0]))
    return out


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects): fields
    the policy leaves open, harmless mail housekeeping, and wording around the exact strings it prescribes."""
    out = []
    new_t = _new(before, after, "hubspot", "tickets")
    new_m = [i for i in _new(before, after, "gmail", "messages") if oracle.is_sent(_find(after, "gmail", "messages", i))]
    new_s = _new_slack(before, after)
    trig_mail = [i for i in _new(before, after, "gmail", "messages") if not oracle.is_sent(_find(after, "gmail", "messages", i))]
    trig_mail = trig_mail or [m["id"] for m in before["gmail"]["messages"] if "INBOX" in (m.get("label_ids") or [])][-1:]

    def m(name, fn):
        w = copy.deepcopy(after)
        fn(w)
        out.append((name, w))

    for mid in trig_mail[:1]:
        def tm(w, mid=mid):
            return _find(w, "gmail", "messages", mid)
        m("mark-read", lambda w: tm(w).update(is_read=True, label_ids=[x for x in tm(w)["label_ids"] if x != "UNREAD"]))
        m("label-and-star", lambda w: tm(w).update(is_starred=True, label_ids=tm(w)["label_ids"] + ["Label_triaged"]))
    for tid in new_t[:1]:
        def t(w, tid=tid):
            return _find(w, "hubspot", "tickets", tid)
        m("ticket-priority-high", lambda w: t(w).update(hs_ticket_priority="HIGH"))
        m("ticket-content-with-context", lambda w: t(w).update(content="Review comment: " + t(w)["content"] + " (iOS)"))
        # review fixes 2026-10-21: the subject's literal parts keep their case (POLICY.md §3 step 5); only the address may change
        m("ticket-address-case", lambda w: t(w).update(subject=" - ".join(
            x.upper() if "@" in x else x for x in t(w)["subject"].split(" - "))))
    for mid in new_m[:1]:
        def e(w, mid=mid):
            return _find(w, "gmail", "messages", mid)
        m("email-longer-body", lambda w: e(w).update(body_plain="Hello,\n\n" + e(w)["body_plain"] + "\n\nKind regards,\nMarketing"))
        if e(after)["subject"].startswith(L.SUMMARY_SUBJECT):
            # other figures that are not ticket or thank-you figures (review fixes 2026-10-21: no longer "2 tickets reopened",
            # which POLICY.md §4 now rules out), markdown, HTML, a greeting and a sign-off
            m("summary-other-words", lambda w: e(w).update(body_plain=e(w)["body_plain"] + "\nWeek so far: 40 reviews "
                                                           "read, 3 escalations."))
            line = next(x["body"] for x in truth["expect"]["emails"] if x["kind"] == "summary")
            m("summary-markdown", lambda w: e(w).update(body_plain=f"## Review triage summary\n\n- **{line}**\n\n"
                                                        "_Sent by the review triage automation._"))
            m("summary-html", lambda w: e(w).update(body_plain=f"<html><body><p>Hi team,</p><p><b>{line}</b></p>"
                                                    "<p>Thank you,<br>Automation</p></body></html>"))
            m("summary-greeting-signoff", lambda w: e(w).update(body_plain=f"Hi team,\n\n{line}.\n\nPolicy in force: "
                                                                "Ticket ratings = 1-2.\n\nThank you,\nAutomation"))
        m("email-display-name", lambda w: e(w).update(to=[f"Reviewer <{e(w)['to'][0]}>"]))
    for ts in new_s[:1]:
        m("post-extra-words", lambda w: _slack(w, ts).update(text="FYI " + _slack(w, ts)["text"] + " (thanks)."))
    return out


def _reference_runs(seeds: list[int], grader):
    import reference
    for s in seeds:
        stream = gen.generate(s)
        res = harness.run_stream(stream, reference.handle, grader=grader, keep_worlds=True)
        assert res["clean_week"], f"reference failed on {s}"
        yield stream, res


def gate_mutation(seeds: list[int]) -> dict:
    grader = oracle.Grader()
    total, killed, survived, by_op = 0, 0, [], Counter()
    for stream, res in _reference_runs(seeds, grader):
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            for name, w in mutants(before, after, truth, stream["world0"]):
                total += 1
                v = grader.grade(truth, before, w, end=stream["end"] if last else None,
                                 world0=stream["world0"] if last else None)
                by_op[name] += 1
                if v["pass"]:
                    survived.append(f"{truth['trigger']} {truth['variant']} {name}")
                else:
                    killed += 1
    return {"pass": total > 0 and killed / total >= 0.95, "seeds": seeds, "mutants": total, "killed": killed,
            "score": round(killed / max(1, total), 4), "survived": survived[:20], "n_survived": len(survived),
            "operators": dict(sorted(by_op.items()))}


def gate_specificity(seeds: list[int]) -> dict:
    grader = oracle.Grader()
    total, rejected = 0, []
    for stream, res in _reference_runs(seeds, grader):
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            for name, w in equivalents(before, after, truth):
                total += 1
                v = grader.grade(truth, before, w, end=stream["end"] if last else None,
                                 world0=stream["world0"] if last else None)
                if not v["pass"]:
                    rejected.append(f"{truth['trigger']} {name}: {[c['name'] + ': ' + c['detail'][:80] for c in v['failed']]}")
    return {"pass": total > 0 and not rejected, "seeds": seeds, "variants": total, "accepted": total - len(rejected),
            "rejected": rejected[:20]}


def gate_probes(seeds: list[int]) -> dict:
    """Whole-stream oracle probes (probes.py), run through the real tool path and Grader in carry mode: each WRONG probe
    fails somewhere, and on at least one trigger of its own variant (probes.WRONG_ON) in every stream that has one;
    each CORRECT probe passes every trigger of every stream."""
    import probes
    grader = oracle.Grader()
    streams = {s: gen.generate(s) for s in seeds}
    res, problems = {}, []
    for name, fn in probes.PROBES.items():
        runs = [harness.run_stream(streams[s], fn, grader=grader) for s in seeds]
        rows = [x for r in runs for x in r["rows"]]
        res[name] = {"passed": sum(x["pass"] for x in rows), "triggers": len(rows),
                     "clean_weeks": sum(r["clean_week"] for r in runs), "errors": sum(1 for x in rows if x["error"])}
        if res[name]["errors"]:
            problems.append(f"{name} raised on {res[name]['errors']} triggers")
        if name in probes.CORRECT:
            if res[name]["passed"] != len(rows):
                bad = [f"{x['taskKey']} {[c['name'] for c in x['failed']]}" for x in rows if not x["pass"]][:3]
                problems.append(f"{name} (correct) rejected: {bad}")
            continue
        want = probes.WRONG_ON[name]
        for r in runs:
            mine = [x for x in r["rows"] if want == "any" or x["variant"] == want]
            if mine and want != "any" and not any(not x["pass"] for x in mine):
                problems.append(f"{name} passes every {want} trigger of {r['seed']}")
        if res[name]["passed"] == len(rows):
            problems.append(f"{name} (wrong) passes every trigger")
    return {"pass": not problems, "seeds": seeds, "probes": res, "problems": problems}


def run_all(seeds: list[int], practice: list[int]) -> dict:
    d3 = [s for s in seeds if gen.default_difficulty(s) == "d3"]
    g = {"determinism": gate_determinism(seeds[:3]),
         "leakage": gate_leakage(seeds),
         "solvability": gate_solvability(practice + seeds),
         "controls": gate_controls(seeds, d3),
         "traps": gate_traps(LABEL),
         "clauses": gate_clauses(practice + seeds),
         "mutation": gate_mutation(seeds),
         "specificity": gate_specificity(seeds),
         "probes": gate_probes(seeds)}
    return {"family": gen.FAMILY, "version": gen.VERSION, "pass": all(x["pass"] for x in g.values()), "gates": g}


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-mkt-reviews $0 validity gates")
    ap.add_argument("--seeds", default="610-614")
    ap.add_argument("--practice", default="601-609")
    ap.add_argument("--out", help="host-only directory for gates.json")
    a = ap.parse_args(argv)
    res = run_all(harness.parse_seeds(a.seeds), harness.parse_seeds(a.practice))
    if a.out:
        Path(a.out).mkdir(parents=True, exist_ok=True)
        (Path(a.out) / "gates.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps(res, ensure_ascii=False))
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
