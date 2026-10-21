#!/usr/bin/env python3
"""abr-sales-noshow: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-sales-noshow/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR]

Prints one JSON object. No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; world0 and every world_t (after each delta) validate as
                WorldState and survive dump -> load -> dump.
  leakage       what an arm sees (the payload, the serve-input row, world0 through the tools) carries no hidden truth:
                no truth/variant/trap fields, no Calendly or Salesforce ids, no expected descriptions; world0 holds no
                trigger message, no flag or task the week is meant to create; the reference imports no host module.
  solvability   the observable-only reference passes every trigger (and every week) of the practice and dev streams;
                generator and reference therefore agree on every effect (gate 3).
  controls      every bad control fails; null passes exactly the no-op triggers; the <= 40-line naive heuristic
                scores below 60% per trigger at d3.
  traps         each trap kind appears at least five times across the four dev label streams 610-613.
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects (drop, duplicate, wrong
                recipient/record, wrong priority/status/subject/time/amount/format, description fields reordered,
                cents, junk or a second conflicting value, WhatId on another account, IsClosed contradicting the
                status, retraction marker prepended/reworded/negated, extra write, decoy flag, edited or removed
                pre-existing record, missing/unnamed escalation, wrong or contradicted count). A mutant is killed when
                the trigger verdict or, at week close, the separate week verdict fails (oracle.verdict_ok).
  specificity   the oracle accepts policy-neutral variants of the reference's effects (fields the policy leaves open,
                punctuation and case around the prescribed strings): no false rejects.
"""
from __future__ import annotations

import argparse
import ast
import copy
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import harness  # noqa: E402  (pins TZ=UTC and puts experiments/autobench on sys.path)
import gen  # noqa: E402
import oracle  # noqa: E402

DEV = [610, 611, 612, 613, 614]
LABEL = [610, 611, 612, 613]
PRACTICE = list(range(601, 610))
PAYLOAD_KEYS = {"trigger", "at", "app", "event", "data"}
DATA_KEYS = {"channel", "channel_id", "message_id", "ts", "user_id", "user_name", "text"}
BAD_CONTROLS = ["null", "echo", "naive", "stale-threshold", "no-repeat", "latest-event", "all-opps",
                "chatter-as-report", "no-dedupe", "contact-by-surname", "retract-by-surname"]


# ---------------------------------------------------------------------------------------------------------------------
# determinism and round trip
# ---------------------------------------------------------------------------------------------------------------------
def stream_hashes(out: dict) -> dict:
    return {k: gen.sha(out[k]) for k in ("world0", "payloads", "triggers", "truth", "end")}


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
        for t in a["triggers"]:                     # every world_t after its delta validates and round-trips
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
def hidden_tokens(out: dict) -> set[str]:
    """Strings an arm must never receive in a payload: every record id of the world (the payload names people by
    email and name only), the expected descriptions, and the truth's own vocabulary."""
    w = out["world0"]
    toks = {r["id"] for app in ("calendly", "salesforce") for coll in w[app].values() if isinstance(coll, list)
            for r in coll if isinstance(r, dict) and r.get("id")}
    for t in out["truth"]:
        for tc in t["expect"]["task_create"]:
            toks |= {tc["description"], tc["scheduled"], f"Account pipeline: {tc['pipeline']}"}
    toks |= {"variant", "traps", "truth", "expect", "guards", "decoy", "T-repeat", "T-lookalike", "T-stale",
             "T-note", "T-format", "T-history", "T-boundary", "escalate:"}
    return {x for x in toks if x}


def gate_leakage(seeds: list[int]) -> dict:
    problems = []
    policy = (HERE / "POLICY.md").read_text()
    for s in seeds:
        out = gen.generate(s)
        toks = hidden_tokens(out)
        w0 = out["world0"]
        w0_msgs = {(m["id"], m["ts"]) for m in w0["slack"]["messages"]}
        for trig, payload in zip(out["triggers"], out["payloads"]):
            if trig["payload"] != payload:
                problems.append(f"{trig['trigger']}: payloads.jsonl differs from the trigger's payload")
            if set(payload) != PAYLOAD_KEYS or not set(payload["data"]) <= DATA_KEYS:
                problems.append(f"{trig['trigger']}: unexpected payload keys {sorted(payload)} / {sorted(payload['data'])}")
            blob = gen.canon(payload)
            leaked = sorted(x for x in toks if x in blob)
            if leaked:
                problems.append(f"{trig['trigger']}: payload carries hidden tokens {leaked[:4]}")
            for op in trig["delta"]:             # the trigger's own record arrives with the trigger, never before
                if (op["record"].get("id"), op["record"].get("ts")) in w0_msgs:
                    problems.append(f"{trig['trigger']}: the trigger message is already in world0")
            row = gen.serve_input(s, trig)
            info = json.loads(row["info"])
            if info["assertions"] or any(info["initial_state"][a] for a in gen.APPS):
                problems.append(f"{trig['trigger']}: the serve-input row carries assertions or world records")
            if row["prompt"][1]["content"] != policy + "\n\nTrigger:\n" + gen.canon(payload):
                problems.append(f"{trig['trigger']}: the serve prompt holds more than POLICY.md and the payload")
        week = out["end"]["week_start"]
        if any(i["is_no_show"] for i in w0["calendly"]["invitees"]
               if i["id"] in {x for t in out["truth"] for x in t["expect"]["noshow"]}):
            problems.append(f"{s}: world0 already flags an invitee the week must flag")
        if any(str(t["created_date"]) >= week for t in w0["salesforce"]["tasks"]):
            problems.append(f"{s}: world0 holds a task created this week")
        w0blob = gen.canon(w0)
        for word in ("variant", "traps", "truth", "decoy", "T-repeat", "T-lookalike"):
            if f'"{word}"' in w0blob or word + ":" in w0blob:
                problems.append(f"{s}: world0 mentions {word!r}")
    tree = ast.parse((HERE / "reference.py").read_text())
    imported = {n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else a.name.split(".")[0]
                for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in (n.names if isinstance(n, ast.Import) else [n])}
    host = imported & {"gen", "oracle", "harness", "gates", "controls", "automationbench", "bridge"}
    if host:
        problems.append(f"reference.py imports host-side modules {sorted(host)}")
    return {"pass": not problems, "seeds": seeds, "problems": problems[:20], "n_problems": len(problems)}


# ---------------------------------------------------------------------------------------------------------------------
# solvability, controls, traps
# ---------------------------------------------------------------------------------------------------------------------
def gate_solvability(seeds: list[int]) -> dict:
    summary, _ = harness.run("reference", seeds)
    return {"pass": summary["passed"] == summary["triggers"] and summary["clean_weeks"] == summary["streams"],
            **{k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "week_state_ok", "streams",
                                       "per_stream", "by_variant")}}


def gate_controls(seeds: list[int], d3_seeds: list[int]) -> dict:
    res, problems = {}, []
    noop = sum(1 for s in seeds for t in gen.generate(s)["truth"] if t["outcome"] == "no-op")
    for name in BAD_CONTROLS:
        summary, _ = harness.run(name, seeds)
        res[name] = {k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "week_state_ok", "outcomes")}
        if summary["passed"] == summary["triggers"] or summary["clean_weeks"] == summary["streams"]:
            problems.append(f"{name} does not fail")
    if res["null"]["passed"] != noop:
        problems.append(f"null passes {res['null']['passed']} triggers, the no-op share is {noop}")
    naive_d3, _ = harness.run("naive", d3_seeds)
    if naive_d3["pass_rate"] >= 0.6:
        problems.append(f"naive scores {naive_d3['pass_rate']} at d3")
    import controls
    return {"pass": not problems, "seeds": seeds, "noop_triggers": noop, "controls": res,
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


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score
# ---------------------------------------------------------------------------------------------------------------------
def _find(world: dict, app: str, coll: str, rid: str):
    return next((r for r in world[app][coll] if r.get("id") == rid), None)


def _chan(world: dict, name: str) -> str:
    return next(c["id"] for c in world["slack"]["channels"] if c["name"] == name)


def _post(world: dict, channel: str, text: str, k: int):
    msgs = world["slack"]["messages"]
    m = copy.deepcopy(msgs[-1])
    m.update({"id": f"MMUT{k:06d}", "ts": f"{9000000000 + k}.000001", "channel_id": _chan(world, channel), "text": text,
              "thread_ts": None, "reactions": [], "attachments": []})
    msgs.append(m)


def _new_ids(before: dict, after: dict, app: str, coll: str) -> list[str]:
    old = {r.get("id") for r in before[app][coll]}
    return [r["id"] for r in after[app][coll] if r.get("id") not in old]


def _changed_ids(before: dict, after: dict, app: str, coll: str) -> list[str]:
    old = {r.get("id"): r for r in before[app][coll]}
    return [r["id"] for r in after[app][coll] if r.get("id") in old
            and gen.canon(oracle._stable(old[r["id"]])) != gen.canon(oracle._stable(r))]


def _sub_desc(t: dict, pat: str, fn) -> bool:
    d = t.get("description") or ""
    nd = re.sub(pat, fn, d, count=1)
    if nd == d:
        return False
    t["description"] = nd
    return True


def mutants(before: dict, after: dict, truth: dict):
    """Single-fault mutants of a correct after-world. Yields (name, mutated_after); None-returning ops are skipped."""
    v, exp = truth["variant"], truth["expect"]
    k = [0]

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        ok = fn(w)
        return (name, w) if ok is not False else None

    out = []
    new_tasks = _new_ids(before, after, "salesforce", "tasks")
    changed_tasks = _changed_ids(before, after, "salesforce", "tasks")
    review, alerts = _chan(after, "automation-review"), _chan(after, "sales-alerts")
    new_msgs = [x for x in after["slack"]["messages"] if (x["channel_id"], x["ts"]) not in
                {(y["channel_id"], y["ts"]) for y in before["slack"]["messages"]}]

    # -- generic faults, every trigger -----------------------------------------------------------------------------
    def flag_other(w):
        cands = [g for g in truth["guards"]["not_noshow"]] + \
                [i["id"] for i in w["calendly"]["invitees"] if not i["is_no_show"] and i["id"] not in exp["noshow"]]
        for g in cands:
            i = _find(w, "calendly", "invitees", g)
            if i and not i["is_no_show"]:
                i["is_no_show"], i["no_show_marked_at"] = True, truth_time(truth, w)
                return True
        return False
    out.append(m("flag-other-invitee", flag_other))
    out.append(m("extra-post-alerts", lambda w: _post(w, "sales-alerts", "Following up on this one.", k[0])))
    if v != "week_close":
        out.append(m("week-count-posted-early", lambda w: _post(w, "sales-alerts", "No-shows this week: 1", k[0])))

    def extra_task(w):
        c = w["salesforce"]["contacts"][0]
        t = copy.deepcopy(w["salesforce"]["tasks"][-1])
        t.update({"id": "00TMUT000000001", "subject": "Follow up on missed call - Product Demo", "contact_id": c["id"],
                  "status": "Not Started", "priority": "Normal", "description": "Scheduled: x | Account pipeline: $0"})
        w["salesforce"]["tasks"].append(t)
    out.append(m("extra-task", extra_task))

    def touch_opp(w):
        o = w["salesforce"]["opportunities"][0]
        o["stage_name"] = "Closed Lost" if o["stage_name"] != "Closed Lost" else "Prospecting"
    out.append(m("touch-opportunity", touch_opp))

    def remove_task(w):
        old = [t for t in w["salesforce"]["tasks"] if t["id"] not in new_tasks]
        w["salesforce"]["tasks"].remove(old[0])
    out.append(m("remove-preexisting-task", remove_task))

    def edit_old_task(w):
        old = [t for t in w["salesforce"]["tasks"] if t["id"] not in new_tasks + changed_tasks]
        old[0]["status"] = "Completed" if old[0]["status"] != "Completed" else "Not Started"
    out.append(m("edit-preexisting-task", edit_old_task))

    # -- act: a handled no-show report -----------------------------------------------------------------------------
    if v == "act":
        tid = new_tasks[0]
        inv = exp["noshow"][0]
        tc = exp["task_create"][0]

        def task(w):
            return _find(w, "salesforce", "tasks", tid)

        def drop_flag(w):
            i = _find(w, "calendly", "invitees", inv)
            i["is_no_show"], i["no_show_marked_at"] = False, None
        out.append(m("drop-flag", drop_flag))
        out.append(m("drop-task", lambda w: w["salesforce"]["tasks"].remove(task(w))))

        def dup_task(w):
            t = copy.deepcopy(task(w))
            t["id"] = t["id"][:-3] + "DUP"
            w["salesforce"]["tasks"].append(t)
        out.append(m("duplicate-task", dup_task))

        def flip_prio(w):
            t = task(w)
            t["priority"] = "Normal" if t["priority"] == "High" else "High"
        out.append(m("wrong-priority", flip_prio))
        out.append(m("wrong-status", lambda w: task(w).update(status="In Progress")))

        def wrong_contact(w):
            t = task(w)
            other = next(c for c in w["salesforce"]["contacts"] if c["id"] != t["contact_id"])
            t["contact_id"] = other["id"]
        out.append(m("wrong-contact", wrong_contact))

        def wrong_subject(w):
            t = task(w)
            names = sorted({e["name"] for e in w["calendly"]["scheduled_events"]} - {t["subject"][len(gen.SUBJECT_PREFIX):]})
            t["subject"] = gen.SUBJECT_PREFIX + names[0]
        out.append(m("wrong-event-in-subject", wrong_subject))
        out.append(m("subject-without-prefix", lambda w: task(w).update(subject=task(w)["subject"][len(gen.SUBJECT_PREFIX):])))
        out.append(m("wrong-hour", lambda w: _sub_desc(task(w), r"(\d{2}):(\d{2}) UTC",
                                                       lambda mm: f"{(int(mm.group(1)) + 1) % 24:02d}:{mm.group(2)} UTC")))
        out.append(m("wrong-date", lambda w: _sub_desc(task(w), r"\d{4}-\d{2}-(\d{2})",
                                                       lambda mm: mm.group(0)[:-2] + f"{(int(mm.group(1)) % 28) + 1:02d}")))
        out.append(m("12-hour-clock", lambda w: _sub_desc(task(w), r" (\d{2}):(\d{2}) UTC",
                                                          lambda mm: f" {int(mm.group(1)) % 12 or 12}:{mm.group(2)} "
                                                                     f"{'PM' if int(mm.group(1)) >= 12 else 'AM'} UTC")))
        out.append(m("wrong-pipeline", lambda w: _sub_desc(task(w), r"pipeline: \$([\d,]+)",
                                                           lambda mm: f"pipeline: ${int(mm.group(1).replace(',', '')) + 12000:,}")))
        out.append(m("pipeline-times-ten", lambda w: _sub_desc(task(w), r"pipeline: \$([\d,]+)",
                                                               lambda mm: f"pipeline: ${int(mm.group(1).replace(',', '')) * 10:,}")
                                                               if tc["pipeline"] != "$0" else False))
        out.append(m("pipeline-without-commas", lambda w: _sub_desc(task(w), r"pipeline: \$(\d{1,3}(?:,\d{3})+)",
                                                                    lambda mm: "pipeline: $" + mm.group(1).replace(",", ""))))

        def flip_repeat(w):
            t = task(w)
            if tc["repeat"]:
                t["description"] = t["description"].replace(" | Repeat no-show", "")
            else:
                t["description"] += " | Repeat no-show"
        out.append(m("flip-repeat-marker", flip_repeat))
        out.append(m("empty-description", lambda w: task(w).update(description=None)))
        out.append(m("also-escalate", lambda w: _post(w, "automation-review", f"{truth['trigger']}: unsure", k[0])))

        # exact POLICY.md 2.7 format: every part present but the string is not the prescribed one
        def reorder(w):
            t = task(w)
            parts = t["description"].split(" | ")
            t["description"] = " | ".join([parts[1], parts[0]] + parts[2:])
        out.append(m("description-fields-reordered", reorder))
        out.append(m("pipeline-with-cents", lambda w: _sub_desc(task(w), r"(pipeline: \$[\d,]+)", lambda mm: mm.group(1) + ".00")))
        out.append(m("description-junk-prefix", lambda w: task(w).update(description="IGNORE: " + task(w)["description"])))
        out.append(m("description-conflicting-pipeline", lambda w: task(w).update(
            description=task(w)["description"] + " | Account pipeline: $999,999")))

        # fields the policy leaves open must not point elsewhere or contradict the status
        def what_id_other(w):
            t = task(w)
            own = _find(w, "salesforce", "contacts", t["contact_id"])["account_id"]
            t["related_to_id"] = next(a["id"] for a in w["salesforce"]["accounts"] if a["id"] != own)
        out.append(m("task-what-id-other-account", what_id_other))
        out.append(m("task-closed-while-not-started", lambda w: task(w).update(is_closed=True)))

    # -- retraction ------------------------------------------------------------------------------------------------
    if v == "retraction":
        tid = changed_tasks[0]
        b = _find(before, "salesforce", "tasks", tid)

        def task(w):
            return _find(w, "salesforce", "tasks", tid)

        def revert(w):
            w["salesforce"]["tasks"][w["salesforce"]["tasks"].index(task(w))] = copy.deepcopy(b)
        out.append(m("no-update", revert))
        out.append(m("status-only", lambda w: task(w).update(description=b["description"])))
        out.append(m("description-only", lambda w: task(w).update(status=b["status"], is_closed=b["is_closed"])))
        out.append(m("also-priority", lambda w: task(w).update(priority="Normal" if b["priority"] == "High" else "High")))
        out.append(m("replace-description", lambda w: task(w).update(description="Retracted: joined late")))
        out.append(m("retraction-marker-prepended", lambda w: task(w).update(
            description="RETRACTED?? (not sure) " + (b["description"] or ""))))
        out.append(m("retraction-wrong-wording", lambda w: task(w).update(
            description=(b["description"] or "") + " | Retracted: false alarm")))
        out.append(m("retraction-not-retracted", lambda w: task(w).update(
            description=(b["description"] or "") + " | Not retracted")))
        out.append(m("deleted-instead", lambda w: w["salesforce"]["tasks"].remove(task(w))))

        def wrong_task(w):
            others = [t for t in w["salesforce"]["tasks"] if t["id"] != tid and t["status"] == "Not Started"
                      and (t["subject"] or "").startswith(gen.SUBJECT_PREFIX)]
            if not others:
                return False
            revert(w)
            others[0].update(status="Completed", description=(others[0]["description"] or "") + gen.RETRACT_SUFFIX)
        out.append(m("wrong-task-retracted", wrong_task))

        def unflag(w):
            c = task(w)["contact_id"]
            email = _find(w, "salesforce", "contacts", c)["email"]
            hit = [i for i in w["calendly"]["invitees"] if i["email"] == email and i["is_no_show"]]
            if not hit:
                return False
            hit[-1]["is_no_show"], hit[-1]["no_show_marked_at"] = False, None
        out.append(m("unflag-in-calendly", unflag))

    # -- escalation ------------------------------------------------------------------------------------------------
    if v.startswith("escalate:"):
        post = next(x for x in new_msgs if x["channel_id"] == review)

        def drop_post(w):
            w["slack"]["messages"] = [x for x in w["slack"]["messages"] if x["ts"] != post["ts"]]
        out.append(m("no-escalation", drop_post))

        def unnamed(w):
            next(x for x in w["slack"]["messages"] if x["ts"] == post["ts"])["text"] = "could not decide this one"
        out.append(m("escalation-without-trigger-id", unnamed))

        def wrong_channel(w):
            next(x for x in w["slack"]["messages"] if x["ts"] == post["ts"])["channel_id"] = alerts
        out.append(m("escalation-in-wrong-channel", wrong_channel))

        def also_task(w):
            extra_task(w)
        out.append(m("escalate-and-create-task", also_task))

    # -- week close ------------------------------------------------------------------------------------------------
    if v == "week_close":
        post = next(x for x in new_msgs if x["channel_id"] == alerts)
        n = truth.get("expect")["slack_post"][0]["text"].rsplit(" ", 1)[-1]

        def settext(text):
            def f(w):
                next(x for x in w["slack"]["messages"] if x["ts"] == post["ts"])["text"] = text
            return f

        def drop_post(w):
            w["slack"]["messages"] = [x for x in w["slack"]["messages"] if x["ts"] != post["ts"]]
        out.append(m("no-week-post", drop_post))
        out.append(m("count-plus-one", settext(f"No-shows this week: {int(n) + 1}")))
        out.append(m("count-minus-one", settext(f"No-shows this week: {int(n) - 1}") if int(n) > 0 else (lambda w: False)))
        out.append(m("count-digit-appended", settext(f"No-shows this week: {n}0")))
        out.append(m("count-contradicted", settext(f"No-shows this week: {n} (actually {int(n) + 1})")))
        out.append(m("count-decimal", settext(f"No-shows this week: {n}.5")))
        out.append(m("week-post-in-review", lambda w: next(x for x in w["slack"]["messages"]
                                                           if x["ts"] == post["ts"]).update(channel_id=review)))
        out.append(m("week-post-twice", lambda w: _post(w, "sales-alerts", f"No-shows this week: {n}", k[0])))

        def end_reprioritize(w):        # an earlier week task silently changed (graded by the end-of-week check)
            week = [t for t in w["salesforce"]["tasks"] if (t["subject"] or "").startswith(gen.SUBJECT_PREFIX)
                    and str(t["created_date"]) >= truth_week(w)]
            if not week:
                return False
            week[0]["priority"] = "Normal" if week[0]["priority"] == "High" else "High"
        out.append(m("end-earlier-task-reprioritized", end_reprioritize))

        def end_redescribe(w):          # an earlier week task's description silently changed (week verdict)
            week = [t for t in w["salesforce"]["tasks"] if (t["subject"] or "").startswith(gen.SUBJECT_PREFIX)
                    and str(t["created_date"]) >= truth_week(w)]
            if not week:
                return False
            week[0]["description"] = (week[0]["description"] or "") + " | Repeat no-show?"
        out.append(m("end-earlier-task-redescribed", end_redescribe))
    return [x for x in out if x is not None]


def truth_time(truth, w) -> str:
    return w["meta"]["current_time"].replace("Z", "")


def truth_week(w) -> str:
    from datetime import datetime, timedelta
    now = datetime.fromisoformat(w["meta"]["current_time"].replace("Z", "+00:00"))
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return monday.strftime("%Y-%m-%dT%H:%M:%SZ")


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects): fields
    the policy leaves open, and punctuation around the exact strings it prescribes."""
    v, out = truth["variant"], []
    new_tasks = _new_ids(before, after, "salesforce", "tasks")
    changed_tasks = _changed_ids(before, after, "salesforce", "tasks")
    new_msgs = [x["ts"] for x in after["slack"]["messages"] if (x["channel_id"], x["ts"]) not in
                {(y["channel_id"], y["ts"]) for y in before["slack"]["messages"]}]

    def m(name, fn):
        w = copy.deepcopy(after)
        fn(w)
        out.append((name, w))

    def msg(w):
        return next(x for x in w["slack"]["messages"] if x["ts"] == new_msgs[0])
    if v == "act":
        def task(w):
            return _find(w, "salesforce", "tasks", new_tasks[0])

        def what_id(w):
            t = task(w)
            t["related_to_id"] = _find(w, "salesforce", "contacts", t["contact_id"])["account_id"]
        m("task-with-account-as-what-id", what_id)
        m("task-with-due-date", lambda w: task(w).update(due_date=w["meta"]["current_time"]))
        m("description-trailing-period", lambda w: task(w).update(description=task(w)["description"] + "."))
        m("description-extra-whitespace", lambda w: task(w).update(description=task(w)["description"].replace(" | ", "  |  ")))
    if v == "retraction":
        m("retracted-task-closed", lambda w: _find(w, "salesforce", "tasks", changed_tasks[0]).update(is_closed=True))
        m("retraction-trailing-period", lambda w: _find(w, "salesforce", "tasks", changed_tasks[0]).update(
            description=_find(w, "salesforce", "tasks", changed_tasks[0])["description"] + "."))
    if v.startswith("escalate:"):
        m("escalation-other-wording", lambda w: msg(w).update(
            text=f"Escalating {truth['trigger']} - I cannot decide this report under the policy."))
    if v == "week_close":
        m("week-post-trailing-period", lambda w: msg(w).update(text=msg(w)["text"] + "."))
        m("week-post-lowercase", lambda w: msg(w).update(text=msg(w)["text"].lower()))
        m("week-post-with-explanation", lambda w: msg(w).update(text=msg(w)["text"] + " (Mon-Fri, retractions excluded)"))
        m("week-post-with-week-and-trigger", lambda w: msg(w).update(
            text=msg(w)["text"] + f" (week of {truth_week(w)[:10]}, {truth['trigger']}, as of 17:00 UTC)"))
    return out


def gate_specificity(seeds: list[int]) -> dict:
    grader = oracle.Grader()
    import reference
    total, rejected = 0, []
    for s in seeds:
        stream = gen.generate(s)
        res = harness.run_stream(stream, reference.handle, grader=grader, keep_worlds=True)
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            for name, w in equivalents(before, after, truth):
                total += 1
                v = grader.grade(truth, before, w, end=stream["end"] if last else None,
                                 world0=stream["world0"] if last else None)
                if not oracle.verdict_ok(v):
                    rejected.append(f"{truth['trigger']} {name}: "
                                    f"{[c['name'] for c in v['failed'] + v.get('week', {}).get('failed', [])]}")
    return {"pass": total > 0 and not rejected, "seeds": seeds, "variants": total, "accepted": total - len(rejected),
            "rejected": rejected[:20]}


def gate_mutation(seeds: list[int]) -> dict:
    grader = oracle.Grader()
    import reference
    total, killed, survived, by_op = 0, 0, [], Counter()
    for s in seeds:
        stream = gen.generate(s)
        res = harness.run_stream(stream, reference.handle, grader=grader, keep_worlds=True)
        assert res["clean_week"], f"reference failed on {s}"
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            for name, w in mutants(before, after, truth):
                total += 1
                v = grader.grade(truth, before, w, end=stream["end"] if last else None,
                                 world0=stream["world0"] if last else None)
                by_op[name] += 1
                if oracle.verdict_ok(v):
                    survived.append(f"{truth['trigger']} {truth['variant']} {name}")
                else:
                    killed += 1
    return {"pass": total > 0 and killed / total >= 0.95, "seeds": seeds, "mutants": total, "killed": killed,
            "score": round(killed / max(1, total), 4), "survived": survived[:20], "n_survived": len(survived),
            "operators": dict(sorted(by_op.items()))}


def run_all(seeds: list[int], practice: list[int]) -> dict:
    d3 = [s for s in seeds if gen.default_difficulty(s) == "d3"]
    g = {"determinism": gate_determinism(seeds[:3]),
         "leakage": gate_leakage(seeds),
         "solvability": gate_solvability(practice + seeds),
         "controls": gate_controls(seeds, d3),
         "traps": gate_traps(LABEL),
         "mutation": gate_mutation(seeds),
         "specificity": gate_specificity(seeds)}
    return {"family": gen.FAMILY, "version": gen.VERSION, "pass": all(x["pass"] for x in g.values()), "gates": g}


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-sales-noshow $0 validity gates")
    ap.add_argument("--seeds", default="610-614")
    ap.add_argument("--practice", default="601-609")
    ap.add_argument("--out", help="host-only directory for gates.json")
    a = ap.parse_args(argv)
    res = run_all(harness.parse_seeds(a.seeds), harness.parse_seeds(a.practice))
    if a.out:
        Path(a.out).mkdir(parents=True, exist_ok=True)
        (Path(a.out) / "gates.json").write_text(json.dumps(res, indent=1) + "\n")
    print(json.dumps(res))
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
