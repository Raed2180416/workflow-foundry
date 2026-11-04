#!/usr/bin/env python3
"""abr-hr-inbox: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-hr-inbox/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR] [--only determinism,leakage,...]

Prints one JSON object (exit 0 only when every gate passes). No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; every world_t (after each delta) validates as WorldState and
                survives dump -> load -> dump.
  leakage       what an arm sees carries no hidden truth: a new email's payload equals the message the delta inserted
                (id, From, subject, snippet), a new Grievance Tracker row's payload equals the row in the world, payload
                keys are fixed per event, no truth vocabulary in payloads or world0, a new email or row arrives with
                its trigger (never in world0), the serve-input row holds only POLICY.md and the payload with no
                assertions and no world records, and the reference imports only the standard library.
  solvability   the observable-only reference passes every trigger (and every week) of the practice and dev streams,
                in carry mode and in rebased mode; generator and reference therefore agree on every effect (gate 3).
  controls      every bad control fails; null passes exactly the no-op triggers; the <= 40-line naive heuristic
                scores below 60% per trigger at d3.
  traps         each trap kind appears at least five times across the four dev label streams 610-613.
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects (a mutant at the week
                close counts as flagged when its trigger or the end-of-week verdict fails). Since v1.1.0 the operators
                include the review's shapes: a prefixed or two-category forward subject, an acknowledgement naming a
                second category or claiming the change was made, a bare fraud subject or a fraud report claiming an
                update, reordered or extra summary count lines, and grievance details in an escalation (Description,
                name, Employee ID, `case 141`, `GR 2026 141`).
  specificity   the oracle accepts policy-neutral variants (no false rejects): letter case, a trailing period or
                spaces, recipient address case, extra body text, harmless label changes, bullets in the summary, a
                minute-precision Effective, and (v1.1.0) a summary greeting and sign-off, spaces around the forward
                subject's ':', conditional wording in an acknowledgement, extra text after a fraud subject, a reworded
                grievance escalation; and an equivalent solver (one email per recipient for a two-handler route,
                another Effective format, the escalation channel by id) passes every trigger and week.
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
DATA_KEYS = {"new_email": {"message_id", "from", "subject", "snippet"},
             "new_row": {"spreadsheet_id", "worksheet", "row_id", "row"},
             "week_close": {"date"}}
TRAP_KINDS = ["T-format", "T-lookalike", "T-authority", "T-note", "T-stale"]
TRUTH_WORDS = ["traps", "truth", "expect", "decoy", "lookalike", "oracle", "T-format", "T-lookalike",
               "T-note", "T-stale", "T-authority", "T-state", "request.email", "grievance.filed", "policy.amendment",
               "week.close", "signoff-keyword", "quoted-keyword", "manager-witness", "about-manager",
               "discrimination-override", "payroll-override", "policy-log-future", "policy-log-unapproved",
               "amend-unauthorized", "amend-lookalike", "personal-nonbank", "no-category", "stale-manager",
               "unknown-severity", "subject-collision", "week-boundary", "slack_secret", "slack_secrets"]
STD = {"__future__", "base64", "json", "re", "datetime", "urllib"}


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
def reference_imports() -> set[str]:
    tree = ast.parse((HERE / "reference.py").read_text())
    return {n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else a.name.split(".")[0]
            for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
            for a in (n.names if isinstance(n, ast.Import) else [n])}


def gate_leakage(seeds: list[int]) -> dict:
    problems = []
    policy = (HERE / "POLICY.md").read_text()
    words = re.compile("|".join(re.escape(w) for w in TRUTH_WORDS), re.I)
    m = words.search(policy)
    if m:
        problems.append(f"POLICY.md mentions {m.group(0)!r}")
    for s in seeds:
        out = gen.generate(s)
        w = out["world0"]
        m = words.search(gen.canon(w))
        if m:
            problems.append(f"{s}: world0 mentions {m.group(0)!r}")
        msgs0 = {x["id"] for x in w["gmail"]["messages"]}
        rows0 = {(r["worksheet_id"], r["row_id"]) for r in w["google_sheets"]["rows"]}
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
            if payload["event"] == "new_email":
                rec = next((x for x in w["gmail"]["messages"] if x["id"] == d["message_id"]), None)
                if rec is None or rec["from_"] != d["from"] or rec["subject"] != d["subject"] \
                        or d["snippet"] != " ".join(str(rec["body_plain"]).split())[:100]:
                    problems.append(f"{tid}: the email payload is not the inserted message")
                if d["message_id"] in msgs0:
                    problems.append(f"{tid}: the new email is already in world0")
            elif payload["event"] == "new_row":
                row = next((r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_GRIEV and r["row_id"] == d["row_id"]), None)
                if row is None or row["cells"] != d["row"]:
                    problems.append(f"{tid}: the row payload is not the world's row after the delta")
                if (gen.WS_GRIEV, d["row_id"]) in rows0:
                    problems.append(f"{tid}: the new row is already in world0")
            row_in = gen.serve_input(s, trig)
            info = json.loads(row_in["info"])
            if info["assertions"] or any(info["initial_state"][a] for a in gen.APPS):
                problems.append(f"{tid}: the serve-input row carries assertions or world records")
            if row_in["prompt"][1]["content"] != policy + "\n\nTrigger:\n" + gen.canon(payload):
                problems.append(f"{tid}: the serve prompt holds more than POLICY.md and the payload")
    imported = reference_imports()
    if imported - STD:
        problems.append(f"reference.py imports beyond the standard library: {sorted(imported - STD)}")
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
    import controls
    streams = streams or {s: gen.generate(s) for s in seeds}
    res, problems = {}, []
    noop = sum(1 for s in seeds for t in streams[s]["truth"] if t["outcome"] == "no-op")
    for name in controls.CONTROLS:
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
    return {"pass": not problems, "seeds": seeds, "noop_triggers": noop, "controls": res,
            "naive_d3": {"seeds": d3_seeds, "pass_rate": naive_d3["pass_rate"], "lines": controls.NAIVE_LINES},
            "problems": problems}


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
                     "event": out["meta"]["event_trap_share"]}
    short = [k for k in TRAP_KINDS if kinds[k] < 5]
    return {"pass": not short, "seeds": seeds, "by_kind": dict(sorted(kinds.items())), "by_id": dict(sorted(ids.items())),
            "short": short, "shares": shares}


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score
# ---------------------------------------------------------------------------------------------------------------------
_chan = _abr_common._chan


def _new(before: dict, after: dict, app: str, coll: str) -> list[int]:
    old = {oracle._key(app, coll, m) for m in before[app][coll]}
    return [i for i, m in enumerate(after[app][coll]) if oracle._key(app, coll, m) not in old]


def _changed_rows(before: dict, after: dict, ws: str) -> list[int]:
    old = {r["id"]: r for r in before["google_sheets"]["rows"]}
    return [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == ws and r["id"] in old
            and old[r["id"]]["cells"] != r["cells"]]


def _post(world: dict, channel: str, text: str, k: int):
    world["slack"]["messages"].append({"ts": f"{9000000000 + k}.000001", "channel_id": _chan(world, channel),
                                       "user_id": "USLACKBOT", "text": text, "is_bot": True, "bot_name": "Zapier"})


def _mail(to: list[str], subject: str, body: str, k: int, cc=None) -> dict:
    return {"id": f"ffff{k:012d}", "thread_id": f"eeee{k:012d}", "from_": "hr-requests@company.example.com", "to": to,
            "cc": cc or [], "bcc": [], "subject": subject, "body_plain": body, "label_ids": ["SENT"], "is_read": True,
            "date": 1767225600000, "internal_date": 1767225600000}


OTHER_BOX = {"benefits-team": "it-helpdesk", "it-helpdesk": "benefits-team", "employee-records": "leave-admin",
             "leave-admin": "employee-records", "security-team": "it-helpdesk", "hr-bp": "legal", "legal": "hr-bp",
             "hr-director": "hr-bp", "hr-ops": "hr-bp"}
OTHER_CAT = {"Benefits": "IT Access", "IT Access": "Benefits", "Address Change": "Payroll", "Payroll": "Address Change",
             "Leave / PTO": "Payroll", "Security": "IT Access"}
OTHER_STATUS = {"routed to hrbp": "Routed to Legal and HR Director", "routed to legal and hr director": "Routed to HRBP"}


def mutants(before: dict, after: dict, truth: dict):
    """Single-fault mutants of a correct after-world. Yields (name, mutated_after); ops that do not apply are skipped."""
    k = [0]
    out = []

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        if fn(w) is not False:
            out.append((name, w))
    sent = _new(before, after, "gmail", "messages")
    msgs = _new(before, after, "slack", "messages")
    person = next(r["cells"] for r in after["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_DIR)
    pol = _new(before, after, "google_sheets", "rows")
    rows = _changed_rows(before, after, gen.WS_GRIEV)
    for i in sent[:2]:
        rec = after["gmail"]["messages"][i]
        tag = str(rec.get("subject") or "")

        def other_to(w, i=i):
            x = w["gmail"]["messages"][i]["to"][0]
            local, _, dom = x.partition("@")
            if local in OTHER_BOX:
                w["gmail"]["messages"][i]["to"][0] = f"{OTHER_BOX[local]}@{dom}"
            else:
                w["gmail"]["messages"][i]["to"][0] = f"someone.else@{dom}"

        def sub_body(pat, rep, i=i, flags=0):
            def f(w):
                b = w["gmail"]["messages"][i]["body_plain"] or ""
                new = re.sub(pat, rep, b, count=1, flags=flags)
                if new == b:
                    return False
                w["gmail"]["messages"][i]["body_plain"] = new
                w["gmail"]["messages"][i]["body_html"] = None
            return f

        def sub_subject(pat, rep, i=i):
            def f(w):
                s = w["gmail"]["messages"][i]["subject"] or ""
                new = re.sub(pat, rep, s, count=1)
                if new == s:
                    return False
                w["gmail"]["messages"][i]["subject"] = new
            return f
        m("email-drop", lambda w, i=i: w["gmail"]["messages"].pop(i))
        m("email-dup", lambda w, i=i: w["gmail"]["messages"].append(dict(w["gmail"]["messages"][i], id="dddd000000000001")))
        m("email-wrong-recipient", other_to)
        m("email-cc-legal", lambda w, i=i: w["gmail"]["messages"][i].__setitem__("cc", ["legal@company.example.com"]))
        m("email-extra-recipient", lambda w, i=i: w["gmail"]["messages"][i]["to"].append("hr-ops@company.example.com"
                                                                                           if "hr-ops@company.example.com" not in w["gmail"]["messages"][i]["to"] else "hr-bp@company.example.com"))
        m("email-not-sent", lambda w, i=i: w["gmail"]["messages"][i].__setitem__("label_ids", ["DRAFT"]))
        m("body-drop-id", sub_body(r"(?i)EMP-\d{4}", "the employee"))
        m("body-drop-case", sub_body(r"GR-\d{4}-\d{3}", "the case"))
        m("body-drop-name", sub_body(r"Employee: [^\n(]+", "Employee: "))
        m("body-wrong-category", sub_body(r"routed to (Benefits|IT Access|Address Change|Payroll|Leave / PTO|Security)",
                                          lambda mm: "routed to " + OTHER_CAT[mm.group(1)]))
        m("subject-wrong-category", sub_subject(r": (Benefits|IT Access|Address Change|Payroll|Leave / PTO|Security)$",
                                                lambda mm: ": " + OTHER_CAT[mm.group(1)]))
        m("subject-wrong-case-id", sub_subject(r"GR-(\d{4})-(\d{3})", lambda mm: f"GR-{mm.group(1)}-{int(mm.group(2)) + 1:03d}"))
        m("summary-count-off", sub_body(r"^(Payroll|Benefits|IT Access): (\d+)$", lambda mm: f"{mm.group(1)}: {int(mm.group(2)) + 1}", flags=re.M))
        m("summary-line-missing", sub_body(r"^Fraud reports: \d+\n?", "", flags=re.M))
        m("summary-names", sub_body(r"^(Grievances: \d+)$", lambda mm: mm.group(1) + "\nFiled by: " + person["Name"], flags=re.M) if "HR inbox week" in tag else (lambda w: False))
        m("summary-employee-id", sub_body(r"^(Grievances: \d+)$", lambda mm: mm.group(1) + "\nSee " + person["Employee ID"], flags=re.M) if "HR inbox week" in tag else (lambda w: False))
        m("summary-case-id", sub_body(r"^(Grievances: \d+)$", lambda mm: mm.group(1) + "\nCases: GR-2026-901", flags=re.M) if "HR inbox week" in tag else (lambda w: False))
        # added after review (2026-10-21): shapes the per-trigger checks must reject
        m("summary-reordered", (lambda w, i=i: w["gmail"]["messages"][i].__setitem__("body_plain", "\n".join(
            reversed(str(w["gmail"]["messages"][i]["body_plain"]).splitlines())))) if "HR inbox week" in tag else (lambda w: False))
        m("summary-extra-count-line", sub_body(r"^(Grievances: \d+)$", lambda mm: mm.group(1) + "\nTotal requests: 30", flags=re.M)
          if "HR inbox week" in tag else (lambda w: False))
        m("forward-subject-prefixed", sub_subject(r"^(HR request .*)$", lambda mm: "Fwd: " + mm.group(1)))
        m("forward-subject-extra-category", sub_subject(r"^(HR request EMP-\d{4}: (?:Benefits|IT Access|Address Change|Payroll|Leave / PTO|Security))$",
                                                        lambda mm: mm.group(1) + " / Security"))
        m("ack-two-categories", sub_body(r"routed to (Benefits|IT Access|Address Change|Payroll|Leave / PTO|Security)\.",
                                         lambda mm: f"routed to {mm.group(1)} and {OTHER_CAT[mm.group(1)]}."))
        m("ack-other-category-named", sub_body(r"routed to (Benefits|IT Access|Address Change|Payroll|Leave / PTO|Security)\.",
                                               lambda mm: f"routed to {mm.group(1)}. {OTHER_CAT[mm.group(1)]} has a copy."))
        m("ack-claims-resolved", sub_body(r"(routed to (?:Benefits|IT Access|Address Change|Payroll|Leave / PTO|Security)\.)",
                                          lambda mm: mm.group(1) + " I have also gone ahead and made the change you asked for."))
        m("fraud-subject-bare", sub_subject(r"^Possible fraud: .*$", "Possible fraud"))
        m("fraud-claims-update", (lambda w, i=i: w["gmail"]["messages"][i].__setitem__(
            "body_plain", str(w["gmail"]["messages"][i]["body_plain"]) + "\nI have also updated the bank details as asked."))
          if tag.startswith("Possible fraud") else (lambda w: False))
    for i in rows[:1]:
        def status(w, i=i):
            c = w["google_sheets"]["rows"][i]["cells"]
            c["Status"] = OTHER_STATUS.get(oracle.wsk(c["Status"]), "Routed to HRBP")
        m("status-wrong-handler", status)
        m("status-revert", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Status", "Pending"))
        m("status-other-cell", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Notes", "routed by the automation"))
    for i in pol[:1]:
        m("policy-drop", lambda w, i=i: w["google_sheets"]["rows"].pop(i))
        m("policy-wrong-value", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Value", "payroll-team@company.example.com"))
        m("policy-wrong-approver", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Approved by", "payroll-lead@company.example.com"))
        m("policy-wrong-time", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Effective", "2026-01-01T00:00:00Z"))
    for i in msgs[:1]:
        m("escalation-drop", lambda w, i=i: w["slack"]["messages"].pop(i))
        m("escalation-channel", lambda w, i=i: w["slack"]["messages"][i].__setitem__("channel_id", _chan(w, gen.HR_GENERAL)))
        m("escalation-no-trigger-id", lambda w, i=i: w["slack"]["messages"][i].__setitem__("text", "could not decide this one"))
        m("escalation-case-id", lambda w, i=i: w["slack"]["messages"][i].__setitem__("text", w["slack"]["messages"][i]["text"] + " GR-2026-999"))
        sec = truth["expect"].get("slack_secret")
        if sec:                                   # a grievance escalation: its details, without the Case ID pattern
            num = sec["case_id"].rsplit("-", 1)[1].lstrip("0")
            tid = truth["trigger"]
            m("escalation-description", lambda w, i=i: w["slack"]["messages"][i].__setitem__("text", f"{tid}: {sec['description']}"))
            m("escalation-employee-name", lambda w, i=i: w["slack"]["messages"][i].__setitem__(
                "text", w["slack"]["messages"][i]["text"] + f" (filed by {sec['names'][0]})"))
            m("escalation-employee-id", lambda w, i=i: w["slack"]["messages"][i].__setitem__(
                "text", w["slack"]["messages"][i]["text"] + f" ({sec['employee_ids'][0]})"))
            m("escalation-case-number", lambda w, i=i: w["slack"]["messages"][i].__setitem__(
                "text", w["slack"]["messages"][i]["text"] + f" (case {num})"))
            m("escalation-case-spaced", lambda w, i=i: w["slack"]["messages"][i].__setitem__(
                "text", w["slack"]["messages"][i]["text"] + " " + sec["case_id"].replace("-", " ")))
    # writes no trigger asks for
    dir_rows = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_DIR]
    rule_rows = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_RULES]
    m("edit-directory", lambda w: w["google_sheets"]["rows"][dir_rows[0]]["cells"].__setitem__("Email", "changed@company.example.com"))
    m("edit-routing-rules", lambda w: w["google_sheets"]["rows"][rule_rows[2]]["cells"].__setitem__("Route To", "payroll-ops@company.example.com"))
    m("extra-email", lambda w: w["gmail"]["messages"].append(_mail(["hr-ops@company.example.com"], "FYI", "Handled.", k[0])))
    m("extra-cc-legal-email", lambda w: w["gmail"]["messages"].append(_mail(["legal@company.example.com"], "FYI", "For your records.", k[0])))
    m("extra-post", lambda w: _post(w, gen.HR_GENERAL, "HR inbox: one more request handled", k[0]))
    m("case-id-post", lambda w: _post(w, gen.HR_GENERAL, "Grievance GR-2026-123 routed", k[0]))
    m("sink-post", lambda w: _post(w, gen.REVIEW, f"{truth['trigger']}: checked", k[0]))
    m("extra-policy-row", lambda w: w["google_sheets"]["rows"].append({"id": "ffffffffffffffffffffffff", "spreadsheet_id": gen.SS,
                                                                       "worksheet_id": gen.WS_POLICY, "row_id": 99,
                                                                       "cells": {"Effective": truth["at"], "Parameter": "Payroll mailbox",
                                                                                 "Value": "payroll-fasttrack@company.example.com",
                                                                                 "Approved by": "hr-director@company.example.com"}}))
    m("delete-old-message", lambda w: w["slack"]["messages"].pop(0))
    m("edit-old-email", lambda w: w["gmail"]["messages"][0].__setitem__("subject", "edited"))
    return out


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects)."""
    out = []

    def m(name, fn):
        w = copy.deepcopy(after)
        if fn(w) is not False:
            out.append((name, w))
    sent = _new(before, after, "gmail", "messages")
    pol = _new(before, after, "google_sheets", "rows")
    rows = _changed_rows(before, after, gen.WS_GRIEV)
    inbound = [i for i, x in enumerate(after["gmail"]["messages"]) if "INBOX" in (x.get("label_ids") or []) and not x.get("is_read")]
    for i in sent[:2]:
        m("subject-upper", lambda w, i=i: w["gmail"]["messages"][i].__setitem__("subject", w["gmail"]["messages"][i]["subject"].upper()))
        m("body-trailing-period", lambda w, i=i: w["gmail"]["messages"][i].__setitem__("body_plain", w["gmail"]["messages"][i]["body_plain"] + "."))
        m("body-extra-text", lambda w, i=i: w["gmail"]["messages"][i].__setitem__("body_plain", "Hello,\n\n" + w["gmail"]["messages"][i]["body_plain"] + "\n\nThanks"))
        m("body-extra-spaces", lambda w, i=i: w["gmail"]["messages"][i].__setitem__("body_plain", w["gmail"]["messages"][i]["body_plain"].replace(" ", "  ")))
        m("recipient-case", lambda w, i=i: w["gmail"]["messages"][i].__setitem__("to", [x.upper() for x in w["gmail"]["messages"][i]["to"]]))
        m("summary-bullets", lambda w, i=i: (w["gmail"]["messages"][i].__setitem__(
            "body_plain", re.sub(r"(?m)^", "- ", w["gmail"]["messages"][i]["body_plain"])) if "HR inbox week" in str(w["gmail"]["messages"][i]["subject"]) else False))
        # added after review (2026-10-21): what the stricter per-trigger checks must still accept
        subj = str(after["gmail"]["messages"][i].get("subject") or "")
        if "HR inbox week" in subj:
            m("summary-greeting-signoff", lambda w, i=i: w["gmail"]["messages"][i].__setitem__(
                "body_plain", "Hello team,\n\nHere are this week's numbers:\n\n" + w["gmail"]["messages"][i]["body_plain"]
                + "\n\nThanks,\nHR Operations"))
        if subj.startswith("HR request"):
            m("forward-subject-spacing", lambda w, i=i: w["gmail"]["messages"][i].__setitem__(
                "subject", w["gmail"]["messages"][i]["subject"].replace(" ", "  ").replace(":", " :")))
        if subj.startswith("Re:"):
            m("ack-conditional-wording", lambda w, i=i: w["gmail"]["messages"][i].__setitem__(
                "body_plain", w["gmail"]["messages"][i]["body_plain"] + "\n\nThe team will let you know once your request has "
                "been approved or the change has been made. We have received your email and forwarded it."))
        if subj.startswith("Possible fraud"):
            m("fraud-subject-extra", lambda w, i=i: w["gmail"]["messages"][i].__setitem__(
                "subject", w["gmail"]["messages"][i]["subject"] + " (outside sender)"))
    two = [i for i in sent if len(after["gmail"]["messages"][i]["to"]) == 2]
    for i in two[:1]:
        def split(w, i=i):
            rec = w["gmail"]["messages"][i]
            a, b = rec["to"]
            rec["to"] = [a]
            w["gmail"]["messages"].append(dict(copy.deepcopy(rec), id="cccc000000000001", thread_id="cccc000000000002", to=[b]))
        m("split-recipients", split)
    for i in rows[:1]:
        m("status-lower", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Status", w["google_sheets"]["rows"][i]["cells"]["Status"].lower()))
    for i in pol[:1]:
        m("effective-minute", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Effective", truth["at"][:16].replace("T", " ")))
        m("value-case", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Value", w["google_sheets"]["rows"][i]["cells"]["Value"].upper()))
    sec = truth["expect"].get("slack_secret")
    msgs = _new(before, after, "slack", "messages")
    if sec:
        for i in msgs[:1]:
            m("escalation-reworded", lambda w, i=i: w["slack"]["messages"][i].__setitem__(
                "text", f"Could not decide trigger {truth['trigger']}: the Severity cell is not Level 1, 2 or 3, so I did nothing."))
    for i in inbound[:1]:
        m("mark-read", lambda w, i=i: (w["gmail"]["messages"][i].__setitem__("is_read", True),
                                       w["gmail"]["messages"][i].__setitem__("label_ids", [x for x in w["gmail"]["messages"][i]["label_ids"] if x != "UNREAD"])))
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


def _accepted(v: dict) -> bool:
    """A variant is accepted when its trigger passes and, at the week close, the end-of-week verdict passes too."""
    return v["pass"] and v.get("week", {"pass": True})["pass"]


def gate_mutation(seeds: list[int]) -> dict:
    total, graded, by = _grade_all(seeds, mutants)
    survived = [n for n, v in graded if _accepted(v)]
    killed = total - len(survived)
    return {"pass": total > 0 and killed / total >= 0.95, "seeds": seeds, "mutants": total, "killed": killed,
            "score": round(killed / max(1, total), 4), "survived": survived[:20], "n_survived": len(survived),
            "operators": dict(sorted(by.items()))}


def gate_specificity(seeds: list[int]) -> dict:
    total, graded, by = _grade_all(seeds, equivalents)
    rejected = [f"{n}: {[c['name'] for c in v['failed'] + v.get('week', {}).get('failed', [])]}" for n, v in graded if not _accepted(v)]
    from reference import LEGAL, SHEETS, SLACK, SS, WS_POLICY, Inbox

    class Equivalent(Inbox):
        """Other choices the policy leaves open: one email per recipient for a two-handler grievance route, the
        Effective as 'YYYY-MM-DD HH:MM', the escalation channel named by its id."""
        def send_spec(self, to, subject, body):
            return super().send_spec(to, subject, body)

        def calls(self, specs):
            out = []
            for s in specs:
                body = s[3] if len(s) > 3 else None
                if s[1].endswith("messages/send") and isinstance(body, dict) and "raw" in body:
                    import base64
                    raw = base64.urlsafe_b64decode(body["raw"]).decode()
                    to_line = re.search(r"^To: (.*)$", raw, re.M).group(1)
                    tos = [x.strip() for x in to_line.split(",")]
                    if len(tos) > 1 and LEGAL in tos:
                        for x in tos:
                            r2 = raw.replace(f"To: {to_line}", f"To: {x}", 1)
                            out.append((s[0], s[1], None, {"raw": base64.urlsafe_b64encode(r2.encode()).decode()}))
                        continue
                if s[1] == SLACK + "chat.postMessage":
                    chans = self.call("GET", SLACK + "conversations.list", {"limit": 200}).get("channels", [])
                    cid = next(c["id"] for c in chans if c["name"] == body["channel"])
                    out.append((s[0], s[1], None, dict(body, channel=cid)))
                    continue
                if s[1].endswith(f"{WS_POLICY}:append"):
                    v = body["values"][0]
                    out.append((s[0], s[1], s[2], {"values": [[v[0][:16].replace("T", " ")] + v[1:]]}))
                    continue
                out.append(s)
            return super().calls(out)

    def solver(trigger, ctx):
        return Equivalent(trigger, ctx).run()
    grader = oracle.Grader()
    results = [harness.run_stream(gen.generate(s), solver, grader=grader) for s in seeds]
    summ = harness.summarize(results)
    return {"pass": total > 0 and not rejected and summ["passed"] == summ["triggers"] and summ["clean_weeks"] == summ["streams"],
            "seeds": seeds, "variants": total,
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
    ap = argparse.ArgumentParser(description="abr-hr-inbox $0 validity gates")
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
