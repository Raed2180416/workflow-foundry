#!/usr/bin/env python3
"""abr-ops-slawatch: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I -B experiments/autobench/families/abr-ops-slawatch/gates.py \
        [--seeds 610-614] [--practice 601-609] [--only NAME,...]

Prints one JSON object; exit 0 only when every gate passes. No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; world0 and every world_t (each delta applied in turn)
                validate as WorldState and survive dump -> load -> dump.
  leakage       what an arm sees carries no hidden truth: payloads hold only the Zap-style keys, ticket rows carry the
                ticket columns only (never the state columns), no truth vocabulary or trap ids; world0 holds no row or
                email the week adds and no state written this week; serve-input rows carry no assertions or world
                records; the reference imports no host module.
  solvability   the observable-only reference passes every trigger and every week of the practice and dev streams, so
                generator and reference agree on every effect.
  controls      every bad control fails (below 100% of triggers and not every week clean); null passes exactly the
                no-op triggers apart from week-close checks that end a week with expected effects; the <= 40-line
                naive heuristic scores below 60% per trigger at d3; the memoryless control (clock only, no state
                read) keeps no week clean and stays below MEMORYLESS_BAR per trigger.
  traps         each trap kind appears at least five times across the four dev label streams 610-613.
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects (drop, duplicate, wrong
                recipient / number / sender / channel / due time / id / agent / project, timestamps an hour off, extra
                writes, edited or removed pre-existing records, early or late effects, wrong Policy Log row, negated or
                retracted alerts, deleted or thread-reply posts, a wrong email sender, a Value with a unit, a dropped
                or misplaced escalation). AutomationBench's handlers never gate, so every kill is the oracle's own.
  specificity   the oracle accepts policy-neutral variants of the reference's effects (greetings around the SMS text,
                extra email lines, subject case, other ISO forms of the written times, Jira issue type and
                description, reading the inbound email, whitespace and case variants of posts, cells and the Policy
                Log Value, an explicit inbox sender, one escalation post per item): no false rejects.
"""
from __future__ import annotations

import argparse
import ast
import copy
import json
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import harness  # noqa: E402  (pins TZ=UTC and puts experiments/autobench on sys.path)
import gen  # noqa: E402
import lib as L  # noqa: E402
import oracle  # noqa: E402

DEV = [610, 611, 612, 613, 614]
LABEL = [610, 611, 612, 613]
PRACTICE = list(range(601, 610))
PAYLOAD_KEYS = {"trigger", "at", "app", "event", "data"}
DATA_KEYS = {"spreadsheet_id", "worksheet", "row", "changed", "message_id", "from", "subject", "snippet"}
BAD_CONTROLS = ["null", "echo", "naive", "eager", "no-hold", "utc-naive", "status-blind", "no-reassign", "warn-once",
                "strict-window", "slack-dedupe", "raw-phone", "any-amendment", "fixed-window", "late-warning",
                "early-warning", "memoryless", "no-escalate"]
MEMORYLESS_BAR = 0.90         # per-trigger pass rate the clock-only control must stay below on the dev streams
_STREAMS: dict = {}


def stream(seed: int) -> dict:
    if seed not in _STREAMS:
        _STREAMS[seed] = gen.generate(seed)
    return _STREAMS[seed]


# ---------------------------------------------------------------------------------------------------------------------
# determinism and round trip
# ---------------------------------------------------------------------------------------------------------------------
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
                again = WorldState(**copy.deepcopy(w)).model_dump(mode="json")
            if gen.canon(again) != gen.canon(w):
                problems.append(f"{s}/{t['trigger']}: world_t does not round-trip")
                break
    if len(set(hashes.values())) != len(hashes):
        problems.append("two seeds produced the same trigger stream")
    return {"pass": not problems, "seeds": seeds, "problems": problems}


# ---------------------------------------------------------------------------------------------------------------------
# leakage
# ---------------------------------------------------------------------------------------------------------------------
TRUTH_WORDS = ["traps", "expect", "guards", "outcome", "T-lookalike", "T-stale", "T-note", "T-authority", "T-format",
               "T-repeat", "T-timing", "decoy", "story", "needs_state", "Warned At", "Warned Agent", "Warned Deadline",
               "Breached At"]


def gate_leakage(seeds: list[int]) -> dict:
    problems = []
    policy = (HERE / "POLICY.md").read_text()
    for s in seeds:
        out = stream(s)
        w0 = out["world0"]
        week = L.parse_instant(out["end"]["week_start"])
        added_rows = {op["id"] for t in out["triggers"] for op in t["delta"] if op["op"] == "insert_row"}
        added_mail = {op["message"]["id"] for t in out["triggers"] for op in t["delta"] if op["op"] == "add_email"}
        for trig, payload in zip(out["triggers"], out["payloads"]):
            if trig["payload"] != payload:
                problems.append(f"{trig['trigger']}: payloads.jsonl differs from the trigger's payload")
            if set(payload) != PAYLOAD_KEYS or not set(payload["data"]) <= DATA_KEYS:
                problems.append(f"{trig['trigger']}: unexpected payload keys {sorted(payload)} / {sorted(payload['data'])}")
            row = payload["data"].get("row")
            if row is not None and set(row) != set(L.TICKET_COLS):
                problems.append(f"{trig['trigger']}: payload row carries {sorted(set(row) - set(L.TICKET_COLS))}")
            blob = gen.canon(payload)
            leaked = [x for x in TRUTH_WORDS if x in blob]
            if leaked:
                problems.append(f"{trig['trigger']}: payload carries truth vocabulary {leaked[:4]}")
            if any(rid in blob for rid in out["end"]["rows"]):
                problems.append(f"{trig['trigger']}: payload carries a tracker record id")
            sr = gen.serve_input(s, trig)
            info = json.loads(sr["info"])
            if info["assertions"] or any(info["initial_state"][a] for a in gen.APPS):
                problems.append(f"{trig['trigger']}: the serve-input row carries assertions or world records")
            if sr["prompt"][1]["content"] != policy + "\n\nTrigger:\n" + gen.canon(payload):
                problems.append(f"{trig['trigger']}: the serve prompt holds more than POLICY.md and the payload")
        rows = w0["google_sheets"]["rows"]
        if any(r["id"] in added_rows for r in rows):
            problems.append(f"{s}: world0 already holds a row the week opens")
        if any(m["id"] in added_mail for m in w0["gmail"]["messages"]):
            problems.append(f"{s}: world0 already holds an email the week delivers")
        for r in rows:
            for col in ("Warned At", "Breached At"):
                v = L.parse_instant((r.get("cells") or {}).get(col))
                if v is not None and v >= week:
                    problems.append(f"{s}: world0 row {r['cells'].get('Ticket ID')} has {col} this week")
        for m in w0["twilio"]["sms_messages"]:
            if L.parse_instant(m["date_created"]) >= week:
                problems.append(f"{s}: world0 holds an SMS from this week")
        w0blob = gen.canon(w0)
        for word in TRUTH_WORDS[:12]:
            if f'"{word}"' in w0blob:
                problems.append(f"{s}: world0 mentions {word!r}")
    tree = ast.parse((HERE / "reference.py").read_text())
    imported = {n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else a.name.split(".")[0]
                for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in (n.names if isinstance(n, ast.Import) else [n])}
    host = imported & {"gen", "lib", "oracle", "harness", "gates", "controls", "automationbench", "bridge"}
    if host:
        problems.append(f"reference.py imports host-side modules {sorted(host)}")
    return {"pass": not problems, "seeds": seeds, "problems": problems[:20], "n_problems": len(problems)}


# ---------------------------------------------------------------------------------------------------------------------
# solvability, controls, traps
# ---------------------------------------------------------------------------------------------------------------------
def gate_solvability(seeds: list[int]) -> dict:
    """The reference passes every trigger and week, and AutomationBench's handlers agree with every verdict (they are a
    cross-check, never gating: a disagreement on the reference would mean the truth's assertion dicts are off)."""
    summary, _ = harness.run("reference", seeds, streams={s: stream(s) for s in seeds})
    return {"pass": summary["passed"] == summary["triggers"] and summary["clean_weeks"] == summary["streams"]
            and summary["ab_disagree"] == 0,
            **{k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "streams", "ab_disagree",
                                       "per_stream", "by_kind")}}


def null_expected(seeds: list[int]) -> int:
    """Triggers a do-nothing run passes: the no-op triggers, except a week-close check that ends a week with effects."""
    n = 0
    for s in seeds:
        tr = stream(s)["truth"]
        n += sum(1 for t in tr[:-1] if t["outcome"] == "no-op")
        n += 1 if tr[-1]["outcome"] == "no-op" and not any(t["outcome"] == "act" for t in tr) else 0
    return n


def gate_controls(seeds: list[int], d3_seeds: list[int]) -> dict:
    res, problems = {}, []
    streams = {s: stream(s) for s in seeds}
    for name in BAD_CONTROLS:
        summary, _ = harness.run(name, seeds, streams=streams)
        res[name] = {k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "outcomes")}
        if summary["passed"] == summary["triggers"] or summary["clean_weeks"] == summary["streams"]:
            problems.append(f"{name} does not fail")
    if res["null"]["passed"] != null_expected(seeds):
        problems.append(f"null passes {res['null']['passed']} triggers, expected {null_expected(seeds)}")
    if res["memoryless"]["pass_rate"] >= MEMORYLESS_BAR or res["memoryless"]["clean_weeks"]:
        problems.append(f"memoryless scores {res['memoryless']['pass_rate']} with {res['memoryless']['clean_weeks']} clean "
                        f"weeks (bar: < {MEMORYLESS_BAR}, 0 clean weeks)")
    naive_d3, _ = harness.run("naive", d3_seeds, streams={s: stream(s) for s in d3_seeds})
    if naive_d3["pass_rate"] >= 0.6:
        problems.append(f"naive scores {naive_d3['pass_rate']} at d3")
    import controls
    return {"pass": not problems, "seeds": seeds, "null_expected": null_expected(seeds), "controls": res,
            "naive_d3": {"seeds": d3_seeds, "pass_rate": naive_d3["pass_rate"], "lines": controls.NAIVE_LINES},
            "problems": problems}


def gate_traps(seeds: list[int]) -> dict:
    kinds, ids = Counter(), Counter()
    shares = {}
    for s in seeds:
        out = stream(s)
        shares[s] = out["meta"]["trigger_trap_share"]
        for t in out["truth"]:
            for x in t["traps"]:
                ids[x] += 1
            kinds.update({x.split(":")[0] for x in t["traps"]})
    short = [k for k in gen.TRAP_KINDS if kinds[k] < 5]
    return {"pass": not short, "seeds": seeds, "by_kind": dict(sorted(kinds.items())), "by_id": dict(sorted(ids.items())),
            "trigger_trap_share": shares, "short": short}


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score and specificity
# ---------------------------------------------------------------------------------------------------------------------
def _new(before: dict, after: dict, app: str, coll: str, key: str) -> list[dict]:
    old = {r.get(key) for r in before[app][coll]}
    return [r for r in after[app][coll] if r.get(key) not in old]


def _new_posts(before, after):
    old = {(m["channel_id"], m["ts"]) for m in before["slack"]["messages"]}
    return [m for m in after["slack"]["messages"] if (m["channel_id"], m["ts"]) not in old]


def _new_issues(before, after):
    old = {a["id"] for a in before["jira"]["actions"].get("create_issue", [])}
    return [a for a in after["jira"]["actions"].get("create_issue", []) if a["id"] not in old]


def _row(world: dict, rid: str) -> dict:
    return next(r for r in world["google_sheets"]["rows"] if r["id"] == rid)


def _shift(s: str, hours: int = 1) -> str:
    dt = L.parse_instant(s)
    return L.iso_z(dt + timedelta(hours=hours)) if dt else s


def _ms_shift(ms: int, hours: int = 1) -> int:
    return int(ms) + hours * 3600 * 1000


def _sms_template(world: dict, at: str) -> dict:
    base = world["twilio"]["sms_messages"][0] if world["twilio"]["sms_messages"] else None
    t = L.parse_instant(at).strftime("%Y-%m-%dT%H:%M:%S.000500")
    rec = copy.deepcopy(base) if base else {"account_sid": "AC" + "0" * 32, "status": "queued", "direction": "outbound-api",
                                            "num_segments": 1, "price": None, "price_unit": "USD"}
    rec.update({"sid": "SMmut" + "0" * 27, "from_number": L.SMS_FROM, "date_created": t, "date_updated": t})
    return rec


def _post(world: dict, channel: str, text: str, at: str, k: int):
    cid = next(c["id"] for c in world["slack"]["channels"] if c["name"] == channel)
    ts = int(L.parse_instant(at).timestamp())
    world["slack"]["messages"].append({"id": f"MMUT{k:05d}", "ts": f"{ts}.9{k:05d}", "channel_id": cid,
                                       "user_id": "U0SLAWATCH1", "text": text})


def _mail(world: dict, to: list, subject: str, body: str, at: str, k: int):
    ms = int(L.parse_instant(at).timestamp() * 1000)
    world["gmail"]["messages"].append({"id": f"mut{k:013d}", "thread_id": f"mutt{k:012d}", "from_": L.INBOX, "to": to,
                                       "subject": subject, "body_plain": body, "date": ms, "internal_date": ms,
                                       "label_ids": ["SENT"], "is_read": True})


def mutants(before: dict, after: dict, truth: dict, is_last: bool, k0: int = 0):
    """Single-fault mutants of a correct after-world. Yields (name, mutated_after)."""
    exp, at = truth["expect"], truth["at"]
    k = [k0]
    out = []

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        if fn(w) is not False:
            out.append((name, w))

    sms_new = _new(before, after, "twilio", "sms_messages", "sid")
    posts_new = _new_posts(before, after)
    mail_new = _new(before, after, "gmail", "messages", "id")
    issues_new = _new_issues(before, after)
    tracker = [r for r in after["google_sheets"]["rows"] if r["worksheet_id"] == L.WS_OPEN]
    acted = {x["rid"] for x in exp["warn"] + exp["reassign"] + exp["breach"]}
    other = next((r for r in tracker if r["id"] not in acted and L.parse_instant(r["cells"].get("SLA Deadline"))), None)
    phones = sorted({"+1" + "".join(ch for ch in r["cells"].get("Agent Phone", "") if ch.isdigit())[-10:] for r in tracker})

    # -- generic faults, every trigger ---------------------------------------------------------------------------------
    def extra_sms(w):
        rec = _sms_template(w, at)
        rec.update(to_number=phones[0], body=f"SLA warning {other['cells']['Ticket ID'] if other else 'TK-0000'}: due 12:00 UTC")
        w["twilio"]["sms_messages"].append(rec)
    m("extra-sms", extra_sms)
    m("extra-post", lambda w: _post(w, L.ESC, "Checking in on the queue this hour.", at, k[0]))
    old_ts = before["slack"]["messages"][0]["ts"] if before["slack"]["messages"] else "1.000100"
    if not exp["escalate"]:
        m("unwarranted-escalation", lambda w: _post(w, L.SINK, f"{truth['trigger']}: unsure about a ticket", at, k[0]))
    m("extra-email", lambda w: _mail(w, [L.MANAGER], "SLA summary", "All quiet.", at, k[0]))

    def extra_jira(w):
        w["jira"]["actions"].setdefault("create_issue", []).append(
            {"id": f"jira_mut{k[0]:026d}", "action_key": "create_issue", "created_at": L.iso_z(L.parse_instant(at)),
             "params": {"project": L.JIRA_PROJECT, "issuetype": "Task",
                        "summary": f"SLA breach {other['cells']['Ticket ID'] if other else 'TK-0000'}"}})
    m("extra-jira", extra_jira)
    if other:
        m("warn-state-on-other-row", lambda w: _row(w, other["id"])["cells"].update({"Warned At": L.iso_z(L.parse_instant(at)),
                                                                                    "Warned Agent": other["cells"]["Assigned Agent"],
                                                                                    "Warned Deadline": other["cells"]["SLA Deadline"]}))
        m("edit-ticket-status", lambda w: _row(w, other["id"])["cells"].update(
            Status="Closed" if other["cells"]["Status"] != "Closed" else "Open"))
        m("edit-ticket-notes", lambda w: _row(w, other["id"])["cells"].update(Notes=(other["cells"].get("Notes") or "") + " (checked)"))
        m("delete-tracker-row", lambda w: w["google_sheets"]["rows"].remove(_row(w, other["id"])))
    if before["slack"]["messages"]:
        m("edit-old-post", lambda w: w["slack"]["messages"][0].update(text=w["slack"]["messages"][0]["text"] + " (edited)"))
    if before["twilio"]["sms_messages"]:
        m("remove-old-sms", lambda w: w["twilio"]["sms_messages"].pop(0))
    if not exp["policy_rows"]:
        def extra_policy(w):
            pol = [r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == L.WS_POLICY]
            w["google_sheets"]["rows"].append({"id": f"polmut{k[0]}", "spreadsheet_id": L.POLICY_SS, "worksheet_id": L.WS_POLICY,
                                               "row_id": len(pol) + 2, "cells": {"Effective": at[:10], "Parameter": L.PARAM,
                                                                                 "Value": "90", "Approved by": L.MANAGER}})
        m("extra-policy-row", extra_policy)

    # -- warnings ----------------------------------------------------------------------------------------------------
    for x in exp["warn"]:
        tid, rid = x["tid"], x["rid"]
        sms = next(r for r in sms_new if r["to_number"] == x["to"] and f"SLA warning {tid}:" in r["body"])
        post = next(r for r in posts_new if r["text"].startswith(f"{tid} |"))
        mail = next(r for r in mail_new if r.get("subject") == f"SLA warning {tid}")

        def find_sms(w, sid=sms["sid"]):
            return next(r for r in w["twilio"]["sms_messages"] if r["sid"] == sid)

        def find_post(w, ts=post["ts"]):
            return next(r for r in w["slack"]["messages"] if r["ts"] == ts)

        def find_mail(w, mid=mail["id"]):
            return next(r for r in w["gmail"]["messages"] if r["id"] == mid)
        m("warn-drop-sms", lambda w: w["twilio"]["sms_messages"].remove(find_sms(w)))
        m("warn-drop-post", lambda w: w["slack"]["messages"].remove(find_post(w)))
        m("warn-drop-email", lambda w: w["gmail"]["messages"].remove(find_mail(w)))
        m("warn-drop-row", lambda w: _row(w, rid)["cells"].update({"Warned At": _row(before, rid)["cells"].get("Warned At", ""),
                                                                   "Warned Agent": _row(before, rid)["cells"].get("Warned Agent", ""),
                                                                   "Warned Deadline": _row(before, rid)["cells"].get("Warned Deadline", "")}))

        def dup_sms(w):
            r = copy.deepcopy(find_sms(w))
            r["sid"] = r["sid"][:-3] + "dup"
            w["twilio"]["sms_messages"].append(r)
        m("warn-dup-sms", dup_sms)

        def dup_post(w):
            r = copy.deepcopy(find_post(w))
            r["ts"] = r["ts"][:-3] + "999"
            r["id"] = (r.get("id") or "M") + "dup"
            w["slack"]["messages"].append(r)
        m("warn-dup-post", dup_post)

        def dup_mail(w):
            r = copy.deepcopy(find_mail(w))
            r["id"] = r["id"][:-3] + "dup"
            w["gmail"]["messages"].append(r)
        m("warn-dup-email", dup_mail)
        others = [p for p in phones if p != x["to"]]
        if others:
            m("sms-wrong-number", lambda w: find_sms(w).update(to_number=others[0]))
        m("sms-unnormalized-number", lambda w: find_sms(w).update(to_number=x["to"][2:]))
        m("sms-wrong-sender", lambda w: find_sms(w).update(from_number="+15550002222"))
        hh = (int(x["due"][:2]) + 1) % 24
        m("sms-wrong-due", lambda w: find_sms(w).update(body=f"SLA warning {tid}: due {hh:02d}:{x['due'][3:]} UTC"))
        m("sms-lookalike-id", lambda w: find_sms(w).update(body=f"SLA warning {tid}0: due {x['due']} UTC"))
        m("sms-an-hour-late", lambda w: find_sms(w).update(date_created=_shift(find_sms(w)["date_created"]).rstrip("Z")))
        m("post-wrong-channel", lambda w: find_post(w).update(channel_id=L.CHANNELS[L.GENERAL]))
        m("post-wrong-agent", lambda w: find_post(w).update(text=x["line"].rsplit("|", 1)[0] + "| Someone Else"))
        m("post-no-subject", lambda w: find_post(w).update(text=f"{tid} | due {x['due']} UTC | {x['agent']}"))
        m("post-wrong-due", lambda w: find_post(w).update(text=x["line"].replace(f"due {x['due']}", f"due {hh:02d}:{x['due'][3:]}")))
        m("email-wrong-recipient", lambda w: find_mail(w).update(to=[L.FORMER_MANAGER]))
        m("email-extra-cc", lambda w: find_mail(w).update(cc=[f"support-team@{L.ORG}"]))
        m("email-lookalike-subject", lambda w: find_mail(w).update(subject=f"SLA warning {tid}0"))
        m("email-no-line", lambda w: find_mail(w).update(body_plain=f"Ticket {tid} is close to its deadline."))
        m("email-an-hour-late", lambda w: find_mail(w).update(date=_ms_shift(find_mail(w)["date"]),
                                                               internal_date=_ms_shift(find_mail(w)["internal_date"])))
        m("email-wrong-sender", lambda w: find_mail(w).update(from_=L.FORMER_MANAGER))
        m("sms-retracted", lambda w: find_sms(w).update(
            body=f"Ignore previous. SLA warning {tid}: due {x['due']} UTC was sent in error"))
        m("sms-long-preamble", lambda w: find_sms(w).update(
            body=f"Status digest for the whole queue this afternoon, nothing urgent: SLA warning {tid}: due {x['due']} UTC"))
        m("post-retracted", lambda w: find_post(w).update(text=x["line"] + " (sent by mistake, please disregard)"))
        m("post-deleted", lambda w: find_post(w).update(is_deleted=True))
        m("post-thread-reply", lambda w: find_post(w).update(thread_ts=old_ts))
        m("warned-at-wrong-hour", lambda w: _row(w, rid)["cells"].update({"Warned At": _shift(at)}))
        m("warned-at-is-deadline", lambda w: _row(w, rid)["cells"].update({"Warned At": x["deadline"]}))
        m("warned-agent-wrong", lambda w: _row(w, rid)["cells"].update({"Warned Agent": "Someone Else"}))
        m("warned-deadline-wrong", lambda w: _row(w, rid)["cells"].update({"Warned Deadline": _shift(x["deadline"])}))
        m("warn-also-breached", lambda w: _row(w, rid)["cells"].update({"Breached At": L.iso_z(L.parse_instant(at))}))
        m("warn-edits-status", lambda w: _row(w, rid)["cells"].update(Status="Escalated"))

    # -- reassignments ---------------------------------------------------------------------------------------------
    for x in exp["reassign"]:
        tid, rid = x["tid"], x["rid"]
        sms = next(r for r in sms_new if r["to_number"] == x["to"] and f"SLA warning {tid}:" in r["body"])

        def find_rs(w, sid=sms["sid"]):
            return next(r for r in w["twilio"]["sms_messages"] if r["sid"] == sid)
        old = _row(before, rid)["cells"]
        m("reassign-drop-sms", lambda w: w["twilio"]["sms_messages"].remove(find_rs(w)))
        m("reassign-sms-to-old-agent", lambda w: find_rs(w).update(to_number=next(
            (p for p in phones if p != x["to"]), "+15559999999")))
        m("reassign-agent-not-updated", lambda w: _row(w, rid)["cells"].update({"Warned Agent": old.get("Warned Agent", "")}))
        m("reassign-rewarns-at", lambda w: _row(w, rid)["cells"].update({"Warned At": L.iso_z(L.parse_instant(at))}))
        m("reassign-reposts", lambda w: _post(w, L.ESC, f"{tid} | x | due {x['due']} UTC | {x['agent']}", at, k[0]))
        m("reassign-reemails", lambda w: _mail(w, [L.MANAGER], f"SLA warning {tid}", f"{tid} | reassigned", at, k[0]))

    # -- breaches ----------------------------------------------------------------------------------------------------
    for x in exp["breach"]:
        tid, rid = x["tid"], x["rid"]
        iss = next(a for a in issues_new if a["params"].get("summary") == f"SLA breach {tid}")
        post = next(r for r in posts_new if r["text"] == f"BREACHED {tid}")

        def find_iss(w, i=iss["id"]):
            return next(a for a in w["jira"]["actions"]["create_issue"] if a["id"] == i)

        def find_bp(w, ts=post["ts"]):
            return next(r for r in w["slack"]["messages"] if r["ts"] == ts)
        m("breach-drop-jira", lambda w: w["jira"]["actions"]["create_issue"].remove(find_iss(w)))
        m("breach-drop-post", lambda w: w["slack"]["messages"].remove(find_bp(w)))
        m("breach-drop-row", lambda w: _row(w, rid)["cells"].update({"Breached At": ""}))

        def dup_iss(w):
            a = copy.deepcopy(find_iss(w))
            a["id"] = a["id"] + "dup"
            w["jira"]["actions"]["create_issue"].append(a)
        m("breach-dup-jira", dup_iss)
        m("breach-wrong-project", lambda w: find_iss(w)["params"].update(project="OPS"))
        m("breach-lookalike-summary", lambda w: find_iss(w)["params"].update(summary=f"SLA breach {tid}0"))
        m("breach-lookalike-post", lambda w: find_bp(w).update(text=f"BREACHED {tid}0"))
        m("breach-post-wrong-channel", lambda w: find_bp(w).update(channel_id=L.CHANNELS[L.GENERAL]))
        m("breach-post-negated", lambda w: find_bp(w).update(text=f"False alarm, NOT BREACHED {tid}"))
        m("breach-post-extra-words", lambda w: find_bp(w).update(text=f"BREACHED {tid} (test only, ignore)"))
        m("breach-post-deleted", lambda w: find_bp(w).update(is_deleted=True))
        m("breach-post-thread-reply", lambda w: find_bp(w).update(thread_ts=old_ts))
        m("breach-jira-an-hour-late", lambda w: find_iss(w).update(created_at=_shift(find_iss(w)["created_at"])))
        m("breached-at-wrong-hour", lambda w: _row(w, rid)["cells"].update({"Breached At": _shift(at, -1)}))

        def breach_also_warns(w):
            rec = _sms_template(w, at)
            r = _row(w, rid)["cells"]
            rec.update(to_number=L.phone_e164(r.get("Agent Phone")) or phones[0], body=f"SLA warning {tid}: due 00:00 UTC")
            w["twilio"]["sms_messages"].append(rec)
        m("breach-also-texts", breach_also_warns)

    # -- amendments ----------------------------------------------------------------------------------------------------
    for p in exp["policy_rows"]:
        def prow(w):
            return next(r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == L.WS_POLICY
                        and r["cells"].get("Effective") == p["Effective"] and r["id"] not in
                        {x["id"] for x in before["google_sheets"]["rows"]})
        m("policy-drop-row", lambda w: w["google_sheets"]["rows"].remove(prow(w)))
        m("policy-wrong-value", lambda w: prow(w)["cells"].update(Value=str(int(p["Value"]) + 15)))
        m("policy-wrong-approver", lambda w: prow(w)["cells"].update({"Approved by": "avery.cole@company.example.com"}))
        m("policy-wrong-effective", lambda w: prow(w)["cells"].update(Effective="2026-01-01"))
        m("policy-value-with-unit", lambda w: prow(w)["cells"].update(Value=f"{p['Value']} minutes"))

    # -- escalations -----------------------------------------------------------------------------------------------
    if exp["escalate"]:
        esc_ts = [r["ts"] for r in posts_new if r["channel_id"] == L.CHANNELS[L.SINK] and truth["trigger"] in r["text"]]

        def drop_esc(w):
            w["slack"]["messages"] = [r for r in w["slack"]["messages"] if r["ts"] not in esc_ts]
        m("escalate-drop", drop_esc)

        def move_esc(w):
            for r in w["slack"]["messages"]:
                if r["ts"] in esc_ts:
                    r["channel_id"] = L.CHANNELS[L.ESC]
        m("escalate-wrong-channel", move_esc)
        m("escalate-thread-reply", lambda w: [r.update(thread_ts=old_ts) for r in w["slack"]["messages"] if r["ts"] in esc_ts])

    # -- end of week ---------------------------------------------------------------------------------------------------
    if is_last:
        week_sms = [r for r in after["twilio"]["sms_messages"] if r["sid"] not in {x["sid"] for x in before["twilio"]["sms_messages"]}
                    or L.parse_instant(r["date_created"]) >= L.parse_instant(at) - timedelta(days=4, hours=9)]
        if week_sms:
            def dup_week_sms(w, sid=week_sms[0]["sid"]):
                r = copy.deepcopy(next(x for x in w["twilio"]["sms_messages"] if x["sid"] == sid))
                r["sid"] = r["sid"][:-4] + "wdup"
                w["twilio"]["sms_messages"].append(r)
            m("end-earlier-sms-duplicated", dup_week_sms)
        warned_rows = [r for r in tracker if r["cells"].get("Warned At") and L.parse_instant(r["cells"]["Warned At"])
                       and L.parse_instant(r["cells"]["Warned At"]) >= L.parse_instant(at) - timedelta(days=4, hours=9)]
        if warned_rows:
            m("end-state-cleared", lambda w: _row(w, warned_rows[0]["id"])["cells"].update({"Warned At": ""}))
    return out


def gate_mutation(seeds: list[int], grader=None) -> dict:
    grader = grader or oracle.Grader()
    import reference
    killed, total, survivors, by_op = 0, 0, [], Counter()
    for s in seeds:
        out = stream(s)
        res = harness.run_stream(out, reference.handle, grader=grader, keep_worlds=True)
        last = len(out["truth"]) - 1
        for i, (truth, before, after) in enumerate(zip(out["truth"], res["befores"], res["afters"])):
            end = out["end"] if i == last else None
            w0 = out["world0"] if i == last else None
            for name, w in mutants(before, after, truth, i == last, k0=i * 1000):
                total += 1
                by_op[name] += 1
                v = grader.grade(truth, before, w, end=end, world0=w0)
                if not v["pass"]:
                    killed += 1
                else:
                    survivors.append(f"s{s}/{truth['trigger']}: {name}")
    score = killed / max(1, total)
    return {"pass": score >= 0.95, "seeds": seeds, "mutants": total, "killed": killed, "score": round(score, 4),
            "operators": len(by_op), "survivors": survivors[:20], "n_survivors": len(survivors)}


def variants(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world: each must still pass."""
    exp, at = truth["expect"], truth["at"]
    out = []

    def v(name, fn):
        w = copy.deepcopy(after)
        if fn(w) is not False:
            out.append((name, w))

    sms_new = _new(before, after, "twilio", "sms_messages", "sid")
    mail_new = _new(before, after, "gmail", "messages", "id")
    issues_new = _new_issues(before, after)
    for x in exp["warn"]:
        tid, rid = x["tid"], x["rid"]
        sid = next(r["sid"] for r in sms_new if r["to_number"] == x["to"] and f"SLA warning {tid}:" in r["body"])
        mid = next(r["id"] for r in mail_new if r.get("subject") == f"SLA warning {tid}")
        v("sms-greeting", lambda w: next(r for r in w["twilio"]["sms_messages"] if r["sid"] == sid).update(
            body=f"Hi {x['agent'].split()[0]}, SLA warning {tid}: due {x['due']} UTC. Please take a look."))
        v("email-subject-case", lambda w: next(r for r in w["gmail"]["messages"] if r["id"] == mid).update(
            subject=f"sla warning {tid}"))
        v("email-short-body", lambda w: next(r for r in w["gmail"]["messages"] if r["id"] == mid).update(body_plain=x["line"]))
        v("warned-at-offset-form", lambda w: _row(w, rid)["cells"].update(
            {"Warned At": L.parse_instant(at).strftime("%Y-%m-%dT%H:%M:%S+00:00")}))
        v("warned-at-space-utc", lambda w: _row(w, rid)["cells"].update(
            {"Warned At": L.parse_instant(at).strftime("%Y-%m-%d %H:%M UTC")}))
        v("warned-deadline-as-written", lambda w: _row(w, rid)["cells"].update(
            {"Warned Deadline": _row(w, rid)["cells"]["SLA Deadline"]}))
        ts = next(r["ts"] for r in _new_posts(before, after) if r["text"].startswith(f"{tid} |"))
        v("post-double-spaces", lambda w: next(r for r in w["slack"]["messages"] if r["ts"] == ts).update(
            text=x["line"].replace(" | ", "  |  ")))
        v("post-emoji-prefix", lambda w: next(r for r in w["slack"]["messages"] if r["ts"] == ts).update(
            text=":warning: " + x["line"] + "\nPlease act."))
        v("warned-agent-padded", lambda w: _row(w, rid)["cells"].update({"Warned Agent": "  " + x["agent"] + " "}))
        v("warned-agent-upper", lambda w: _row(w, rid)["cells"].update({"Warned Agent": x["agent"].upper()}))
        v("sms-trailing-dot", lambda w: next(r for r in w["twilio"]["sms_messages"] if r["sid"] == sid).update(
            body=f"SLA warning {tid}: due {x['due']} UTC."))
        v("email-explicit-sender", lambda w: next(r for r in w["gmail"]["messages"] if r["id"] == mid).update(
            from_="SLA Watch <sla-watch@company.example.com>"))
    for x in exp["breach"]:
        iid = next(a["id"] for a in issues_new if a["params"].get("summary") == f"SLA breach {x['tid']}")
        v("jira-bug-type", lambda w: next(a for a in w["jira"]["actions"]["create_issue"] if a["id"] == iid)["params"].update(
            issuetype="Bug", description="Deadline passed during the hourly check."))
        v("breached-at-offset-form", lambda w: _row(w, x["rid"])["cells"].update(
            {"Breached At": L.parse_instant(at).strftime("%Y-%m-%dT%H:%M:%S+00:00")}))
        bts = next(r["ts"] for r in _new_posts(before, after) if r["text"] == f"BREACHED {x['tid']}")
        v("breach-post-case-punct", lambda w: next(r for r in w["slack"]["messages"] if r["ts"] == bts).update(
            text=f"breached {x['tid']}."))
        v("breach-post-spaces", lambda w: next(r for r in w["slack"]["messages"] if r["ts"] == bts).update(
            text=f" BREACHED  {x['tid']} "))
        v("jira-summary-case-spaces", lambda w: next(a for a in w["jira"]["actions"]["create_issue"] if a["id"] == iid)[
            "params"].update(summary=f"sla breach  {x['tid']}"))
    for p in exp["policy_rows"]:
        old_ids = {x["id"] for x in before["google_sheets"]["rows"]}
        v("policy-value-spaces", lambda w: next(r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == L.WS_POLICY
                                                and r["id"] not in old_ids)["cells"].update(Value=f" {p['Value']} "))
    if exp["escalate"]:
        v("escalation-two-posts", lambda w: _post(w, L.SINK, f"{truth['trigger']}: second item could not be decided",
                                                  at, 99))
    if truth["kind"] == "policy.amendment":
        inbound = [m for m in after["gmail"]["messages"] if "INBOX" in (m.get("label_ids") or []) and not m.get("is_read")]
        if inbound:
            v("read-inbound-email", lambda w: next(m for m in w["gmail"]["messages"] if m["id"] == inbound[-1]["id"]).update(
                is_read=True, label_ids=["INBOX"]))
    return out


def gate_specificity(seeds: list[int], grader=None) -> dict:
    grader = grader or oracle.Grader()
    import reference
    accepted, total, rejects, ab_disagree = 0, 0, [], Counter()
    for s in seeds:
        out = stream(s)
        res = harness.run_stream(out, reference.handle, grader=grader, keep_worlds=True)
        last = len(out["truth"]) - 1
        for i, (truth, before, after) in enumerate(zip(out["truth"], res["befores"], res["afters"])):
            for name, w in variants(before, after, truth):
                total += 1
                vv = grader.grade(truth, before, w, end=out["end"] if i == last else None,
                                  world0=out["world0"] if i == last else None)
                if vv["pass"]:
                    accepted += 1
                    if vv["ab_disagree"]:
                        ab_disagree[name] += 1
                else:
                    rejects.append(f"s{s}/{truth['trigger']}: {name}: {[c['name'] for c in vv['failed']][:3]}")
    return {"pass": accepted == total and total > 0, "seeds": seeds, "variants": total, "accepted": accepted,
            "false_rejects": rejects[:20],
            # accepted variants that AutomationBench's raw-substring / exact-cell handlers alone would have rejected
            "ab_would_reject": dict(sorted(ab_disagree.items()))}


# ---------------------------------------------------------------------------------------------------------------------
def run_all(seeds: list[int], practice: list[int], only: set | None = None) -> dict:
    d3 = [s for s in seeds if stream(s)["meta"]["difficulty"] == "d3"] or [611, 613]
    gates = {
        "determinism": lambda: gate_determinism(seeds[:2] + practice[:1]),
        "leakage": lambda: gate_leakage(seeds),
        "solvability": lambda: gate_solvability(practice + seeds),
        "controls": lambda: gate_controls(seeds, d3),
        "traps": lambda: gate_traps(LABEL),
        "mutation": lambda: gate_mutation(seeds),
        "specificity": lambda: gate_specificity(seeds),
    }
    out = {}
    for name, fn in gates.items():
        if only and name not in only:
            continue
        out[name] = fn()
    out["pass"] = all(g["pass"] for g in out.values())
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-ops-slawatch $0 validity gates")
    ap.add_argument("--seeds", default="610-614")
    ap.add_argument("--practice", default="601-609")
    ap.add_argument("--only", help="comma-separated gate names")
    a = ap.parse_args(argv)
    res = run_all(harness.parse_seeds(a.seeds), harness.parse_seeds(a.practice),
                  set(a.only.split(",")) if a.only else None)
    print(json.dumps(res, indent=1, default=str))
    sys.exit(0 if res["pass"] else 1)


if __name__ == "__main__":
    main()
