#!/usr/bin/env python3
"""abr-fin-receipts: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-fin-receipts/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR] [--only controls,traps]

Prints one JSON object (exit 0 only when every gate passes). No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; every world_t (after each delta) validates as WorldState and
                survives dump -> load -> dump.
  leakage       what an arm sees carries no hidden truth: a message payload equals the message the delta inserted (the
                same ts, user, text, thread and files), the week close carries only its dates, payload keys are fixed
                per event, no truth vocabulary in payloads or world0, a trigger's message is not in world0, the
                serve-input row holds only POLICY.md and the payload with no assertions, and the reference imports no
                host module.
  solvability   the observable-only reference passes every trigger (and every week) of the practice and dev streams,
                in carry mode and in rebased mode; generator and reference therefore agree on every effect (gate 3).
  controls      every bad control fails; null passes exactly the no-op triggers; the <= 40-line naive heuristic
                scores below 60% per trigger at d3. The two rarer-rule controls (travel-facts-kept, cabin-anywhere: their
                traps are drawn at random, not every week) must fail on the first two dev-range seeds (601-650) whose
                stream carries their trap.
  traps         each trap kind appears at least five times across the four dev label streams 610-613, and every d3
                stream carries each state the 1.1.0 review asked for (a correction whose re-check changes the outcome,
                the cap's own-row rule, two corrections in a thread, a relative date in a correction, a pre-approval
                that survives a correction and one given while not pending, a Rejected row in a later cap and in the
                weekly totals, a repeated and a not-pending approval, reposts and a near-duplicate read relative to
                their own dates).
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects (since 1.1.0 also an Amount
                cell as `$1,975.89`, `1,975.89`, `145.000` or `145`, and wrong or extra email lines behind list markers
                or HTML).
  specificity   the oracle accepts policy-neutral variants (no false rejects): a trailing period, other letter case or
                extra spaces in a reply, `$1250.00` for `$1,250.00`, an Amount cell as a number, another bot name, an
                email with a greeting, a dated header, its lines in another order, behind list markers (`- `, `* `,
                `• `, `1. `) or as HTML (`<br>`, `<p>`, an HTML-only body); and an equivalent solver that updates rows
                by row id, names the channel by id and writes the email body with blank lines passes every trigger.
"""
from __future__ import annotations

import argparse
import ast
import copy
import json
import re
import sys
from collections import Counter
from decimal import Decimal
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
DATA_KEYS = {"new_message": {"channel", "channel_id", "ts", "thread_ts", "user", "text", "attachments"},
             "week_close": {"week_start", "date"}}
BAD_CONTROLS = ["null", "echo", "naive", "no-dedupe", "no-cap", "cap-all-meals", "cap-week-only", "any-corrector",
                "any-approver", "name-approver", "contains-approved", "field-category", "digits-only", "drinks-ok",
                "slack-name", "no-preapproval", "top-level-reply", "log-rejected", "total-all-weeks", "no-receipt-rule",
                "domestic-only", "cabin-ignored", "six-hours-ok", "correction-append", "unknown-logged", "date-posted",
                "no-recheck", "no-pending-check", "repost-rel-now", "category-first", "cap-counts-rejected",
                "total-counts-rejected", "cap-counts-own-row", "latest-correction-only", "correction-receipt-day",
                "preapproval-forgotten", "preapproval-any-time"]
# Controls whose trap is drawn at random (not every week): checked on the dev-range seeds that carry the trap.
RARE_CONTROLS = {"travel-facts-kept": "correction-travel-facts", "cabin-anywhere": "cabin-lookalike"}
DEV_RANGE = list(range(601, 651))
# Every d3 week carries these states (generator 1.1.0; review 2026-10-21).
D3_REQUIRED = ["correction-recheck", "correction-own-row", "correction-multi", "correction-relative-date",
               "correction-preapproved", "correction-early-approval", "cap-rejected-row", "total-rejected-row",
               "approval-again", "approval-not-pending", "repost-relative", "near-dup-relative"]
TRAP_KINDS = ["T-format", "T-authority", "T-repeat", "T-lookalike", "T-state"]
TRUTH_WORDS = ["traps", "truth", "expect", "lookalike", "look-alike", "oracle", "repost", "near-dup", "namesake",
               "wrong-approver", "wrong-corrector", "meal-cap", "cap-history", "cap-under", "display-name",
               "receipt.posted", "receipt.corrected", "receipt.reposted", "preapproval.reply", "week.close",
               "T-repeat", "T-lookalike", "T-format", "T-state", "T-authority", "fixable", "cap-setup", "decoy"]


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
def gate_leakage(seeds: list[int]) -> dict:
    problems = []
    policy = (HERE / "POLICY.md").read_text()
    words = re.compile("|".join(re.escape(w) for w in TRUTH_WORDS), re.I)
    for s in seeds:
        out = gen.generate(s)
        w = out["world0"]
        m = words.search(gen.canon(w))
        if m:
            problems.append(f"{s}: world0 mentions {m.group(0)!r}")
        w0_ts = {(x["channel_id"], x["ts"]) for x in w["slack"]["messages"]}
        for trig, payload in zip(out["triggers"], out["payloads"]):
            tid = trig["trigger"]
            if trig["payload"] != payload:
                problems.append(f"{tid}: payloads.jsonl differs from the trigger's payload")
            if set(payload) != PAYLOAD_KEYS or set(payload["data"]) != DATA_KEYS.get(payload["event"], set()):
                problems.append(f"{tid}: unexpected payload keys {sorted(payload)} / {sorted(payload['data'])}")
            m = words.search(gen.canon(payload))
            if m:
                problems.append(f"{tid}: payload carries {m.group(0)!r}")
            w = harness.apply_delta(w, trig["delta"], trig["at"])
            d = payload["data"]
            if payload["event"] == "new_message":
                rec = next((x for x in w["slack"]["messages"] if x["channel_id"] == d["channel_id"] and x["ts"] == d["ts"]), None)
                if rec is None or rec["user_id"] != d["user"] or rec["text"] != d["text"] \
                        or rec.get("thread_ts") != d["thread_ts"] or rec.get("attachments") != d["attachments"]:
                    problems.append(f"{tid}: the payload is not the inserted message")
                if (d["channel_id"], d["ts"]) in w0_ts:
                    problems.append(f"{tid}: the trigger's message is already in world0")
                ch = next(c for c in w["slack"]["channels"] if c["id"] == d["channel_id"])
                if ch["name"] != d["channel"]:
                    problems.append(f"{tid}: channel name and id disagree")
            elif payload["event"] == "week_close":
                if d != {"week_start": out["end"]["week_start"], "date": out["end"]["friday"]}:
                    problems.append(f"{tid}: the week close carries more than its dates")
            row = gen.serve_input(s, trig)
            info = json.loads(row["info"])
            if info["assertions"] or any(info["initial_state"][a] for a in gen.APPS):
                problems.append(f"{tid}: the serve-input row carries assertions or world records")
            if row["prompt"][1]["content"] != policy + "\n\nTrigger:\n" + gen.canon(payload):
                problems.append(f"{tid}: the serve prompt holds more than POLICY.md and the payload")
    tree = ast.parse((HERE / "reference.py").read_text())
    imported = {n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else a.name.split(".")[0]
                for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                for a in (n.names if isinstance(n, ast.Import) else [n])}
    std = {"__future__", "base64", "json", "re", "datetime", "decimal", "urllib"}
    if imported - std:
        problems.append(f"reference.py imports beyond the standard library: {sorted(imported - std)}")
    return {"pass": not problems, "seeds": seeds, "problems": problems[:20], "n_problems": len(problems),
            "reference_imports": sorted(imported)}


# ---------------------------------------------------------------------------------------------------------------------
# solvability, controls, traps
# ---------------------------------------------------------------------------------------------------------------------
def gate_solvability(seeds: list[int], rebased: list[int] | None = None) -> dict:
    summary, _ = harness.run("reference", seeds)
    out = {"pass": summary["passed"] == summary["triggers"] and summary["clean_weeks"] == summary["streams"],
           **{k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "streams", "per_stream", "by_kind",
                                      "max_steps")}}
    if rebased:
        rs, _ = harness.run("reference", rebased, mode="rebased")
        out["rebased"] = {k: rs[k] for k in ("triggers", "passed", "clean_weeks", "streams")}
        out["pass"] = out["pass"] and rs["passed"] == rs["triggers"]
    return out


def gate_controls(seeds: list[int], d3_seeds: list[int], streams: dict | None = None) -> dict:
    streams = streams or {s: gen.generate(s) for s in seeds}
    res, problems = {}, []
    noop = sum(1 for s in seeds for t in streams[s]["truth"] if t["outcome"] == "no-op")
    for name in BAD_CONTROLS:
        summary, results = harness.run(name, seeds, streams=streams)
        failed_kinds = Counter(x["kind"] for r in results for x in r["rows"] if not x["pass"])
        res[name] = {**{k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "outcomes")},
                     "failed_by_kind": dict(sorted(failed_kinds.items()))}
        if summary["passed"] == summary["triggers"] or summary["clean_weeks"] == summary["streams"]:
            problems.append(f"{name} does not fail")
    if res["null"]["passed"] != noop:
        problems.append(f"null passes {res['null']['passed']} triggers, the no-op share is {noop}")
    naive_d3, _ = harness.run("naive", d3_seeds, streams=streams)
    if naive_d3["pass_rate"] >= 0.6:
        problems.append(f"naive scores {naive_d3['pass_rate']} at d3")
    rare = {}
    for name, label in RARE_CONTROLS.items():
        found = rare_seeds(label)
        summary, results = harness.run(name, found)
        hit = [x["taskKey"] for r in results for x in r["rows"] if not x["pass"] and label in x["traps"]]
        rare[name] = {"label": label, "seeds": found, "passed": summary["passed"], "triggers": summary["triggers"],
                      "clean_weeks": summary["clean_weeks"], "failed_on_label": hit}
        if len(found) < 2 or summary["clean_weeks"] > 0 or not hit:
            problems.append(f"{name} does not fail on its trap {label} (seeds {found})")
    import controls
    return {"pass": not problems, "seeds": seeds, "noop_triggers": noop, "controls": res, "rare": rare,
            "naive_d3": {"seeds": d3_seeds, "pass_rate": naive_d3["pass_rate"], "lines": controls.NAIVE_LINES},
            "problems": problems}


def rare_seeds(label: str, k: int = 2) -> list[int]:
    """The first k dev-range seeds (601-650) whose stream carries the trap label."""
    out = []
    for s in DEV_RANGE:
        if any(label in t["traps"] for t in gen.generate(s, validate=False)["truth"]):
            out.append(s)
            if len(out) == k:
                break
    return out


def gate_traps(seeds: list[int]) -> dict:
    kinds, ids, shares = Counter(), Counter(), {}
    for s in seeds:
        out = gen.generate(s)
        for t in out["truth"]:
            for x in t["traps"]:
                if x in gen.CONTEXT_LABELS:
                    continue
                kinds[gen.TRAP_KIND[x]] += 1
                ids[x] += 1
        shares[s] = {"difficulty": out["meta"]["difficulty"], "trigger": out["meta"]["trigger_trap_share"],
                     "receipt": out["meta"]["receipt_trap_share"]}
    short = [k for k in TRAP_KINDS if kinds[k] < 5]
    d3_missing = {}
    for s in seeds:
        out = gen.generate(s)
        if out["meta"]["difficulty"] != "d3":
            continue
        labs = {x for t in out["truth"] for x in t["traps"]}
        miss = [x for x in D3_REQUIRED if x not in labs]
        if miss:
            d3_missing[s] = miss
    return {"pass": not short and not d3_missing, "seeds": seeds, "by_kind": dict(sorted(kinds.items())),
            "by_id": dict(sorted(ids.items())), "short": short, "d3_missing": d3_missing, "shares": shares}


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score
# ---------------------------------------------------------------------------------------------------------------------
def _chan(world: dict, name: str) -> str:
    return next(c["id"] for c in world["slack"]["channels"] if c["name"] == name)


def _new_msgs(before: dict, after: dict) -> list[int]:
    old = {(m["channel_id"], m["ts"]) for m in before["slack"]["messages"]}
    return [i for i, m in enumerate(after["slack"]["messages"]) if (m["channel_id"], m["ts"]) not in old]


def _sub_rows(world: dict) -> list[int]:
    return [i for i, r in enumerate(world["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_SUB]


def _changed_rows(before: dict, after: dict) -> tuple[list[int], list[int]]:
    old = {r["id"]: r for r in before["google_sheets"]["rows"]}
    new, changed = [], []
    for i in _sub_rows(after):
        r = after["google_sheets"]["rows"][i]
        if r["id"] not in old:
            new.append(i)
        elif gen.canon(old[r["id"]]) != gen.canon(r):
            changed.append(i)
    return new, changed


def _post(world: dict, channel: str, text: str, k: int, thread_ts=None):
    rec = {"ts": f"{9000000000 + k}.000001", "channel_id": _chan(world, channel), "user_id": "USLACKBOT", "text": text,
           "is_bot": True, "bot_name": "Zapier"}
    if thread_ts:
        rec["thread_ts"] = thread_ts
    world["slack"]["messages"].append(rec)


def _new_mail(before: dict, after: dict) -> list[int]:
    old = {m["id"] for m in before["gmail"]["messages"]}
    return [i for i, m in enumerate(after["gmail"]["messages"]) if m["id"] not in old]


OTHER_CAT = {"Travel": "Meals", "Meals": "Travel", "Office Supplies": "Software", "Software": "Office Supplies",
             "Consulting": "Software"}


def mutants(before: dict, after: dict, truth: dict):
    """Single-fault mutants of a correct after-world. Yields (name, mutated_after); ops that do not apply are skipped."""
    k = [0]
    msgs = _new_msgs(before, after)
    chan = _chan(after, gen.CHAN)
    replies = [i for i in msgs if after["slack"]["messages"][i]["channel_id"] == chan]
    new_rows, changed_rows = _changed_rows(before, after)
    mails = _new_mail(before, after)

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        if fn(w) is not False:
            return [(name, w)]
        return []

    def cell(i, key, fn):
        def f(w):
            c = w["google_sheets"]["rows"][i]["cells"]
            new = fn(c.get(key))
            if new == c.get(key):
                return False
            c[key] = new
        return f

    def sub_text(i, pat, rep):
        def f(w):
            rec = w["slack"]["messages"][i]
            new = re.sub(pat, rep, rec["text"], count=1)
            if new == rec["text"]:
                return False
            rec["text"] = new
        return f

    def bump(v):
        try:
            return f"{float(v) + 1:.2f}"
        except (TypeError, ValueError):
            return "1.00"
    out = []
    for i in (new_rows[:1] + changed_rows[:1]):
        out += m("row-amount", cell(i, "Amount", bump))
        out += m("row-category", cell(i, "Category", lambda v: OTHER_CAT.get(v, "Travel")))
        out += m("row-status", cell(i, "Status", lambda v: gen.PENDING if v == gen.APPROVED else gen.APPROVED))
        out += m("row-date", cell(i, "Date", lambda v: (v[:8] + f"{int(v[8:]) % 27 + 1:02d}") if v else "2026-01-01"))
        out += m("row-employee", cell(i, "Employee", lambda v: (v or "") + "s"))
        out += m("row-attendees", cell(i, "Attendees", lambda v: "" if v else "1"))
        out += m("row-ts", cell(i, "Message TS", lambda v: (v or "")[:-1] + ("0" if (v or "x")[-1] != "0" else "1")))
        out += m("row-submitted", cell(i, "Submitted", lambda v: (v[:8] + f"{int(v[8:]) % 27 + 1:02d}") if v else "2026-01-01"))
        # the Amount cell's format (POLICY.md section 4: `1250.00`, no `$`, no commas)
        out += m("row-amount-dollar", cell(i, "Amount", lambda v: f"${Decimal(str(v)):,.2f}"))
        out += m("row-amount-3dp", cell(i, "Amount", lambda v: f"{Decimal(str(v)):.3f}"))
        out += m("row-amount-commas", cell(i, "Amount", lambda v: f"{Decimal(str(v)):,.2f}"))
        out += m("row-amount-no-decimals", cell(i, "Amount", lambda v: f"{Decimal(str(v)):.0f}"
                                                  if Decimal(str(v)) == Decimal(str(v)).to_integral_value() else v))
    if new_rows:
        i = new_rows[0]
        out += m("row-drop", lambda w: w["google_sheets"]["rows"].pop(i))
        out += m("row-dup", lambda w: w["google_sheets"]["rows"].append(dict(copy.deepcopy(w["google_sheets"]["rows"][i]),
                                                                            id="dup" + w["google_sheets"]["rows"][i]["id"][3:],
                                                                            row_id=999)))
    if changed_rows:
        i = changed_rows[0]
        rid = after["google_sheets"]["rows"][i]["id"]
        old = next(r for r in before["google_sheets"]["rows"] if r["id"] == rid)
        out += m("update-revert", lambda w: w["google_sheets"]["rows"].__setitem__(i, copy.deepcopy(old)))
        out += m("update-as-append", lambda w: (w["google_sheets"]["rows"].__setitem__(i, copy.deepcopy(old)),
                                                w["google_sheets"]["rows"].append(dict(copy.deepcopy(after["google_sheets"]["rows"][i]),
                                                                                        id="app" + rid[3:], row_id=998))))
    if replies:
        i = replies[0]
        out += m("reply-drop", lambda w: w["slack"]["messages"].pop(i))
        out += m("reply-dup", lambda w: w["slack"]["messages"].append(dict(w["slack"]["messages"][i], ts="9100000000.000001")))
        out += m("reply-top-level", lambda w: w["slack"]["messages"][i].pop("thread_ts", None) and None)
        out += m("reply-other-thread", lambda w: w["slack"]["messages"][i].__setitem__("thread_ts", "1000000000.000001"))
        out += m("reply-channel", lambda w: w["slack"]["messages"][i].__setitem__("channel_id", _chan(w, gen.GENERAL)))
        out += m("reply-amount", sub_text(i, r"\$([\d,]+)\.(\d\d)", lambda mm: f"${mm.group(1)}.{(int(mm.group(2)) + 1) % 100:02d}"))
        out += m("reply-category", sub_text(i, r"(Travel|Meals|Office Supplies|Software|Consulting)$",
                                            lambda mm: OTHER_CAT[mm.group(1)]))
        out += m("reply-verb", sub_text(i, r"^(Logged|Pending pre-approval|Rejected)",
                                        lambda mm: {"Logged": "Pending pre-approval", "Pending pre-approval": "Logged",
                                                    "Rejected": "Logged"}[mm.group(1)]))
        out += m("reply-reason", sub_text(i, r"^Rejected: .*$", "Rejected: Over policy"))
    if mails:
        i = mails[0]

        def body(fn):
            def f(w):
                mm = w["gmail"]["messages"][i]
                new = fn(mm["body_plain"] or "")
                if new == mm["body_plain"]:
                    return False
                mm["body_plain"] = new
            return f
        out += m("mail-drop", lambda w: w["gmail"]["messages"].pop(i))
        out += m("mail-dup", lambda w: w["gmail"]["messages"].append(dict(w["gmail"]["messages"][i], id="dupmail0001")))
        out += m("mail-to", lambda w: w["gmail"]["messages"][i].__setitem__("to", ["accounting@company.example.com"]))
        out += m("mail-cc", lambda w: w["gmail"]["messages"][i].__setitem__("cc", ["ceo@company.example.com"]))
        out += m("mail-subject", lambda w: w["gmail"]["messages"][i].__setitem__("subject", "Weekly expense totals"))
        out += m("mail-total", body(lambda b: re.sub(r"Total: \$([\d,]+)\.(\d\d)", lambda mm: f"Total: ${mm.group(1)}.{(int(mm.group(2)) + 1) % 100:02d}", b)))
        out += m("mail-pending", body(lambda b: re.sub(r"Pending pre-approval: (\d+)", lambda mm: f"Pending pre-approval: {int(mm.group(1)) + 1}", b)))
        out += m("mail-drop-line", body(lambda b: "\n".join(b.splitlines()[1:])))
        out += m("mail-extra-line", body(lambda b: "Someone Else: $10.00\n" + b))
        out += m("mail-line-amount", body(lambda b: re.sub(r"^([^:\n]+): \$([\d,]+)\.(\d\d)", lambda mm: f"{mm.group(1)}: ${mm.group(2)}.{(int(mm.group(3)) + 1) % 100:02d}", b, count=1)))
        # list markers and HTML must not hide a wrong or extra line
        out += m("mail-extra-bullet", body(lambda b: "\n".join("- " + x for x in b.splitlines()) + "\n- Someone Else: $10.00"))
        out += m("mail-bullet-wrong-total", body(lambda b: "\n".join("* " + x for x in re.sub(
            r"Total: \$([\d,]+)\.(\d\d)", lambda mm: f"Total: ${mm.group(1)}.{(int(mm.group(2)) + 1) % 100:02d}", b).splitlines())))
        out += m("mail-html-wrong-pending", body(lambda b: "<p>" + re.sub(
            r"Pending pre-approval: (\d+)", lambda mm: f"Pending pre-approval: {int(mm.group(1)) + 1}", b).replace("\n", "<br>") + "</p>"))
        out += m("mail-html-drop-line", body(lambda b: "<p>" + "<br>".join(b.splitlines()[1:]) + "</p>"))
    # writes no trigger asks for
    olds = [i for i in _sub_rows(after) if after["google_sheets"]["rows"][i]["id"] in {r["id"] for r in before["google_sheets"]["rows"]}
            and i not in changed_rows]
    if olds:
        j = olds[0]
        out += m("edit-old-row", lambda w: w["google_sheets"]["rows"][j]["cells"].__setitem__("Status", gen.REJECTED))
        out += m("delete-old-row", lambda w: w["google_sheets"]["rows"].pop(j))
    emp = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_EMP]
    out += m("edit-employees", lambda w: w["google_sheets"]["rows"][emp[0]]["cells"].__setitem__("Manager Email", "x@company.example.com"))
    out += m("extra-row", lambda w: w["google_sheets"]["rows"].append({"id": "extrarow0001", "spreadsheet_id": gen.SS,
                                                                       "worksheet_id": gen.WS_SUB, "row_id": 997,
                                                                       "cells": {"Message TS": "1.0", "Status": gen.APPROVED}}))
    out += m("extra-reply", lambda w: _post(w, gen.CHAN, "Logged: $1.00 Travel", k[0], thread_ts=truth["trigger"]))
    out += m("extra-top-post", lambda w: _post(w, gen.CHAN, "Receipts processed", k[0]))
    out += m("sink-post", lambda w: _post(w, gen.REVIEW, f"{truth['trigger']}: checked", k[0]))
    out += m("delete-old-message", lambda w: w["slack"]["messages"].pop(0))
    out += m("edit-old-message", lambda w: w["slack"]["messages"][0].__setitem__("text", "edited"))
    out += m("extra-mail", lambda w: w["gmail"]["messages"].append({"id": "extramail001", "thread_id": "t1", "from_": "x",
                                                                    "to": ["someone@company.example.com"], "subject": "FYI",
                                                                    "body_plain": "hello", "label_ids": ["SENT"]}))
    return out


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects)."""
    out = []
    msgs = _new_msgs(before, after)
    chan = _chan(after, gen.CHAN)
    replies = [i for i in msgs if after["slack"]["messages"][i]["channel_id"] == chan]
    new_rows, changed_rows = _changed_rows(before, after)
    mails = _new_mail(before, after)

    def m(name, fn):
        w = copy.deepcopy(after)
        fn(w)
        out.append((name, w))
    if replies:
        i = replies[0]

        def t(w):
            return w["slack"]["messages"][i]
        m("reply-trailing-period", lambda w: t(w).__setitem__("text", t(w)["text"] + "."))
        m("reply-case", lambda w: t(w).__setitem__("text", t(w)["text"].upper()))
        m("reply-spaces", lambda w: t(w).__setitem__("text", t(w)["text"].replace(": ", ":  ") + " "))
        m("reply-no-grouping", lambda w: t(w).__setitem__("text", re.sub(r"(?<=\d),(?=\d{3})", "", t(w)["text"])))
        m("reply-bot-name", lambda w: t(w).__setitem__("bot_name", "Expense Bot"))
    for i in new_rows[:1] + changed_rows[:1]:
        def c(w, i=i):
            return w["google_sheets"]["rows"][i]["cells"]
        m("row-amount-number", lambda w, c=c: c(w).__setitem__("Amount", float(c(w)["Amount"])))
        m("row-status-case", lambda w, c=c: c(w).__setitem__("Status", c(w)["Status"].upper()))
        m("row-attendees-int", lambda w, c=c: c(w).__setitem__("Attendees", int(c(w)["Attendees"]) if c(w)["Attendees"] else ""))
    if mails:
        i = mails[0]

        def b(w):
            return w["gmail"]["messages"][i]
        m("mail-greeting", lambda w: b(w).__setitem__("body_plain", "Hi Finance,\n\n" + b(w)["body_plain"] + "\n\nThanks"))
        m("mail-reordered", lambda w: b(w).__setitem__("body_plain", "\n".join(reversed(b(w)["body_plain"].splitlines()))))
        m("mail-display-name", lambda w: b(w).__setitem__("to", [f"Finance <{gen.FINANCE}>"]))
        # layouts POLICY.md section 6 leaves open (review 2026-10-21): a dated header, list markers, HTML
        m("mail-header-date", lambda w: b(w).__setitem__("body_plain", f"Weekly expense totals for the week of {truth['expect']['email']['subject'].split()[-1]}:\n" + b(w)["body_plain"]))
        m("mail-bullets-dash", lambda w: b(w).__setitem__("body_plain", "\n".join("- " + x for x in b(w)["body_plain"].splitlines())))
        m("mail-bullets-star", lambda w: b(w).__setitem__("body_plain", "\n".join("* " + x for x in b(w)["body_plain"].splitlines())))
        m("mail-bullets-dot", lambda w: b(w).__setitem__("body_plain", "\n".join("\u2022 " + x for x in b(w)["body_plain"].splitlines())))
        m("mail-numbered", lambda w: b(w).__setitem__("body_plain", "\n".join(f"{n}. {x}" for n, x in enumerate(b(w)["body_plain"].splitlines(), 1))))
        m("mail-html-only", lambda w: b(w).update(body_html="<p>" + b(w)["body_plain"].replace("\n", "<br>") + "</p>", body_plain=None))
        m("mail-html-in-plain", lambda w: b(w).__setitem__("body_plain", "<html><body><ul>" + "".join(f"<li>{x}</li>" for x in b(w)["body_plain"].splitlines()) + "</ul></body></html>"))
    return out


def _grade_all(seeds: list[int], fn) -> tuple[int, list, Counter]:
    """Grade fn(before, after, truth) variants of the reference's correct worlds; returns (n, [(name, verdict)], ops)."""
    grader = oracle.Grader()
    import reference
    total, graded, by = 0, [], Counter()
    for s in seeds:
        stream = gen.generate(s)
        res = harness.run_stream(stream, reference.handle, grader=grader, keep_worlds=True)
        assert res["clean_week"], f"reference failed on {s}"
        for k, (truth, before, after) in enumerate(zip(stream["truth"], res["befores"], res["afters"])):
            last = k == len(stream["truth"]) - 1
            for name, w in fn(before, after, truth):
                total += 1
                by[name] += 1
                v = grader.grade(truth, before, w, end=stream["end"] if last else None, world0=stream["world0"] if last else None)
                graded.append((f"{truth['trigger']} {truth['kind']} {name}", v))
    return total, graded, by


def gate_mutation(seeds: list[int]) -> dict:
    total, graded, by = _grade_all(seeds, mutants)
    survived = [n for n, v in graded if v["pass"]]
    killed = total - len(survived)
    return {"pass": total > 0 and killed / total >= 0.95, "seeds": seeds, "mutants": total, "killed": killed,
            "score": round(killed / max(1, total), 4), "survived": survived[:20], "n_survived": len(survived),
            "operators": dict(sorted(by.items()))}


def gate_specificity(seeds: list[int]) -> dict:
    total, graded, by = _grade_all(seeds, equivalents)
    rejected = [f"{n}: {[c['name'] for c in v['failed']]}" for n, v in graded if not v["pass"]]
    from reference import CHAN, GMAIL, SHEETS, SLACK, SS, SUBMISSIONS, Receipts
    import base64

    class Equivalent(Receipts):
        """Writes through other tool paths the policy leaves open: the row-by-id update, the channel id, and an email
        body with blank lines between its lines."""
        def update_row(self, row_no, cells):
            self.call("PUT", f"{SHEETS}{SS}/values/ws_submissions/rows/{row_no}", None, {"cells": cells})

        def post(self, text, thread_ts=None, channel=CHAN):
            chans = self.call("GET", SLACK + "conversations.list", {"limit": 200}).get("channels", [])
            cid = next(c["id"] for c in chans if c["name"] == channel)
            body = {"channel": cid, "text": text}
            if thread_ts:
                body["thread_ts"] = thread_ts
            self.call("POST", SLACK + "chat.postMessage", None, body)

        def send(self, to, subject, body):
            raw = f"To: {to}\r\nSubject: {subject}\r\n\r\n" + body.replace("\n", "\n\n")
            self.call("POST", GMAIL + "messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode()).decode()})

    def solver(trigger, ctx):
        return Equivalent(trigger, ctx).run()
    grader = oracle.Grader()
    results = [harness.run_stream(gen.generate(s), solver, grader=grader) for s in seeds]
    summ = harness.summarize(results)
    assert SUBMISSIONS
    return {"pass": total > 0 and not rejected and summ["passed"] == summ["triggers"], "seeds": seeds, "variants": total,
            "accepted": total - len(rejected), "rejected": rejected[:20], "operators": dict(sorted(by.items())),
            "equivalent_solver": {k: summ[k] for k in ("triggers", "passed", "clean_weeks")}}


def run_all(seeds: list[int], practice: list[int]) -> dict:
    d3 = [s for s in seeds if gen.default_difficulty(s) == "d3"]
    streams = {s: gen.generate(s) for s in seeds}
    g = {"determinism": gate_determinism(seeds[:3]),
         "leakage": gate_leakage(seeds),
         "solvability": gate_solvability(practice + seeds, rebased=seeds),
         "controls": gate_controls(seeds, d3, streams),
         "traps": gate_traps([s for s in LABEL if s in seeds] or seeds),
         "mutation": gate_mutation(seeds),
         "specificity": gate_specificity(seeds)}
    return {"family": gen.FAMILY, "version": gen.VERSION, "pass": all(x["pass"] for x in g.values()), "gates": g}


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-fin-receipts $0 validity gates")
    ap.add_argument("--seeds", default="610-614")
    ap.add_argument("--practice", default="601-609")
    ap.add_argument("--out", help="host-only directory for gates.json")
    ap.add_argument("--only", help="comma-separated gate names to run")
    a = ap.parse_args(argv)
    seeds, practice = harness.parse_seeds(a.seeds), harness.parse_seeds(a.practice)
    if a.only:
        d3 = [s for s in seeds if gen.default_difficulty(s) == "d3"]
        fns = {"determinism": lambda: gate_determinism(seeds[:3]), "leakage": lambda: gate_leakage(seeds),
               "solvability": lambda: gate_solvability(practice + seeds, rebased=seeds),
               "controls": lambda: gate_controls(seeds, d3), "traps": lambda: gate_traps([s for s in LABEL if s in seeds] or seeds),
               "mutation": lambda: gate_mutation(seeds), "specificity": lambda: gate_specificity(seeds)}
        g = {n: fns[n]() for n in a.only.split(",")}
        res = {"family": gen.FAMILY, "version": gen.VERSION, "pass": all(x["pass"] for x in g.values()), "gates": g}
    else:
        res = run_all(seeds, practice)
    if a.out:
        Path(a.out).mkdir(parents=True, exist_ok=True)
        (Path(a.out) / "gates.json").write_text(json.dumps(res, indent=1) + "\n")
    print(json.dumps(res))
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
