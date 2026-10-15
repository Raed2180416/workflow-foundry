#!/usr/bin/env python3
"""abr-fin-apintake: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-fin-apintake/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR] [--only determinism,leakage,...]

Prints one JSON object (exit 0 only when every gate passes). No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; every world_t (after each delta) validates as WorldState and
                survives dump -> load -> dump.
  leakage       what an arm sees carries no hidden truth: payload keys are fixed per event; a sheet payload's cells
                equal the world's cells after the delta; an email or Slack payload equals the inbound record; no truth
                vocabulary (trap ids, kinds, plan words) in payloads or world0; inbound records arrive with their trigger
                (never in world0); the serve-input row holds only POLICY.md and the payload with no assertions; the
                reference imports only the standard library.
  solvability   the observable-only reference passes every trigger (and every week) of the practice and dev streams,
                in carry mode and in rebased mode; generator and reference therefore agree on every effect (gate 3).
  controls      every bad control fails; null passes exactly the no-op triggers; the <= 40-line naive heuristic
                scores below 60% per trigger at d3; the approval controls trip the hard requirement.
  traps         each design trap kind appears at least five times across the four dev label streams 610-613.
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects.
  specificity   the oracle accepts policy-neutral variants (no false rejects), and an equivalent solver that uses
                other tool paths and cell formats the policy leaves open passes every trigger.
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
DATA_KEYS = {"new_row": {"spreadsheet_id", "worksheet", "row_id", "row"},
             "row_updated": {"spreadsheet_id", "worksheet", "row_id", "row", "changed"},
             "new_email": {"message_id", "from", "subject", "snippet"},
             "new_message": {"channel", "user_id", "text", "ts"},
             "payment_run": {"date"}, "week_close": {"date"}}
BAD_CONTROLS = ["null", "echo", "naive", "any-approver", "display-first", "fuzzy-vendor", "no-blocklist", "any-block-row",
                "no-dedupe", "dedupe-number", "dedupe-any-date", "no-weekend", "stale-bands", "last-row-bands",
                "inactive-approver", "any-correction", "no-early-correction", "ignore-partial", "strict-variance",
                "no-match-email", "pay-unapproved", "pay-blocked", "pay-bill-total", "po-any-vendor", "case-po", "total-all"]
HARD_CONTROLS = ["naive", "any-approver", "pay-unapproved"]          # must cause a payment without a valid approval
DESIGN_TRAP_KINDS = ["T-lookalike", "T-authority", "T-repeat", "T-note", "T-format"]
STORY_WORDS = ["fine-lookalike", "future-band", "band-edge", "var-edge", "amend-auth", "amend-unauth", "blocked-old",
               "hist-paid", "hist-processing", "hist-awaiting", "hist-rejected", "hist-review", "hist-old", "before-invoice",
               "after-invoice", "short-other"]
TRUTH_WORDS = sorted(set([k for k in gen.TRAP_KIND if "-" in k] + list(set(gen.TRAP_KIND.values())) + STORY_WORDS + [
    "traps", "truth", "oracle", "decoy", "spoof", "lookalike", "look-alike", "genuine",
    "invoice.received", "receiving.report", "approval.reply", "invoice.resent", "vendor.blocklist", "payment.run",
    "week.close", "inbox.other", "policy.amendment"]))


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
        w0_rows = {r["id"] for r in w["google_sheets"]["rows"]}
        w0_msgs = {m["id"] for m in w["gmail"]["messages"]}
        w0_posts = {m["ts"] for m in w["slack"]["messages"]}
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
            if payload["event"] in ("new_row", "row_updated"):
                ws = next(k for k, v in gen.WS_TITLE.items() if v == d["worksheet"])
                row = next((r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == ws and r["row_id"] == d["row_id"]), None)
                if row is None or row["cells"] != d["row"]:
                    problems.append(f"{tid}: the payload's cells are not the world's cells after the delta")
                if payload["event"] == "new_row" and any(op.get("record", {}).get("id") in w0_rows for op in trig["delta"]):
                    problems.append(f"{tid}: the new row is already in world0")
            if payload["event"] == "new_email":
                msg = next((x for x in w["gmail"]["messages"] if x["id"] == d["message_id"]), None)
                if msg is None or msg["from_"] != d["from"] or msg["subject"] != d["subject"] or msg.get("snippet") != d["snippet"]:
                    problems.append(f"{tid}: the email payload is not the inbound message")
                if d["message_id"] in w0_msgs:
                    problems.append(f"{tid}: the inbound email is already in world0")
            if payload["event"] == "new_message":
                msg = next((x for x in w["slack"]["messages"] if x["ts"] == d["ts"]), None)
                if msg is None or msg["text"] != d["text"] or msg["user_id"] != d["user_id"]:
                    problems.append(f"{tid}: the Slack payload is not the posted message")
                if d["ts"] in w0_posts:
                    problems.append(f"{tid}: the Slack message is already in world0")
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
    std = {"__future__", "base64", "json", "re", "datetime", "urllib"}
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
                                      "max_steps", "hard_violations")}}
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
        res[name] = {**{k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "outcomes", "errors",
                                                "hard_violations")},
                     "failed_by_kind": dict(sorted(failed_kinds.items()))}
        if summary["passed"] == summary["triggers"] or summary["clean_weeks"] == summary["streams"]:
            problems.append(f"{name} does not fail")
    if res["null"]["passed"] != noop:
        problems.append(f"null passes {res['null']['passed']} triggers, the no-op share is {noop}")
    for name in HARD_CONTROLS:
        if res[name]["hard_violations"] == 0:
            problems.append(f"{name} never trips the approval requirement")
    if res["null"]["hard_violations"]:
        problems.append("null trips the approval requirement")
    naive_d3, _ = harness.run("naive", d3_seeds, streams=streams)
    if naive_d3["pass_rate"] >= 0.6:
        problems.append(f"naive scores {naive_d3['pass_rate']} at d3")
    import controls
    if controls.NAIVE_LINES > 40:
        problems.append(f"naive is {controls.NAIVE_LINES} lines")
    return {"pass": not problems, "seeds": seeds, "noop_triggers": noop, "controls": res,
            "naive_d3": {"seeds": d3_seeds, "pass_rate": naive_d3["pass_rate"], "lines": controls.NAIVE_LINES},
            "problems": problems}


def gate_traps(seeds: list[int]) -> dict:
    kinds, ids, shares = Counter(), Counter(), {}
    for s in seeds:
        out = gen.generate(s)
        for t in out["truth"]:
            for x in t["traps"]:
                kinds[gen.TRAP_KIND[x]] += 1
                ids[x] += 1
        shares[s] = {"difficulty": out["meta"]["difficulty"], "trigger": out["meta"]["trigger_trap_share"],
                     "misleading": out["meta"]["misleading_trigger_share"], "event": out["meta"]["event_trap_share"]}
    short = [k for k in DESIGN_TRAP_KINDS if kinds[k] < 5]
    return {"pass": not short, "seeds": seeds, "by_kind": dict(sorted(kinds.items())), "by_id": dict(sorted(ids.items())),
            "short": short, "shares": shares}


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score
# ---------------------------------------------------------------------------------------------------------------------
def _chan(world: dict, name: str) -> str:
    return next(c["id"] for c in world["slack"]["channels"] if c["name"] == name)


def _new(before: dict, after: dict, app: str, coll: str) -> list[int]:
    old = {oracle._key(app, coll, r) for r in before[app][coll]}
    return [i for i, r in enumerate(after[app][coll]) if oracle._key(app, coll, r) not in old]


def _changed(before: dict, after: dict, app: str, coll: str) -> list[int]:
    old = {r["id"]: r for r in before[app][coll]}
    return [i for i, r in enumerate(after[app][coll]) if r["id"] in old and gen.canon(r) != gen.canon(old[r["id"]])]


def _post(world: dict, channel: str, text: str, k: int):
    world["slack"]["messages"].append({"ts": f"{9000000000 + k}.000001", "channel_id": _chan(world, channel),
                                       "user_id": "USLACKBOT", "text": text, "is_bot": True, "bot_name": "Zapier"})


def _sent(world: dict, to: str, subject: str, body: str, k: int):
    world["gmail"]["messages"].append({"id": f"mut{k:013d}", "thread_id": f"mut{k:013d}", "from_": gen.INBOX, "to": [to],
                                       "cc": [], "bcc": [], "subject": subject, "body_plain": body, "label_ids": ["SENT"],
                                       "is_read": True, "date": 1700000000000, "internal_date": 1700000000000})


def _bump_day(v: str, n: int = 1) -> str:
    from datetime import date, timedelta
    try:
        return (date.fromisoformat(v) + timedelta(days=n)).isoformat()
    except ValueError:
        return v + "x"


def _cents_str(v: str, delta: int) -> str:
    c = oracle.cents(v)
    if not isinstance(c, int):
        return v + "1"
    c += delta
    return f"{c // 100}.{c % 100:02d}"


ROW_CELL_OPS = {
    "Logged": lambda v: _bump_day(v), "Vendor": lambda v: v.replace(" ", "  ").rstrip() + " Group", "Invoice #": lambda v: v + "0",
    "Invoice Date": lambda v: _bump_day(v, -1), "Due Date": lambda v: _bump_day(v, -1), "Amount": lambda v: _cents_str(v, 1),
    "Qty": lambda v: str(int(float(v)) + 1) if v.strip() else "1", "PO #": lambda v: v + "1",
    "Approver": lambda v: "none" if "@" in v else "cfo@company.example.com",
    "Match": lambda v: "Matched" if v != "Matched" else "Price Variance - Review",
    "Approval": lambda v: "Approved" if v != "Approved" else "Awaiting Approval",
    "Status": lambda v: "Processing" if v != "Processing" else "Open", "Notes": lambda v: (v + "; " if v else "") + "checked",
}


def mutants(before: dict, after: dict, truth: dict):
    """Single-fault mutants of a correct after-world. Returns [(name, mutated_after)]; ops that do not apply are skipped."""
    k = [0]
    out = []
    rows = after["google_sheets"]["rows"]
    new_rows = [i for i in _new(before, after, "google_sheets", "rows") if rows[i]["worksheet_id"] == gen.WS_PENDING]
    new_pol = [i for i in _new(before, after, "google_sheets", "rows") if rows[i]["worksheet_id"] == gen.WS_POLICY]
    ch_rows = [i for i in _changed(before, after, "google_sheets", "rows") if rows[i]["worksheet_id"] == gen.WS_PENDING]
    old_rows = [i for i, r in enumerate(rows) if r["worksheet_id"] == gen.WS_PENDING and i not in new_rows and i not in ch_rows]
    mails = [i for i in _new(before, after, "gmail", "messages") if "SENT" in after["gmail"]["messages"][i]["label_ids"]]
    bills = _new(before, after, "quickbooks", "bills")
    pays = _new(before, after, "quickbooks", "payments")
    review = _chan(after, gen.REVIEW)
    posts = [i for i in _new(before, after, "slack", "messages") if after["slack"]["messages"][i]["channel_id"] == review]

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        if fn(w) is not False:
            out.append((name, w))

    def cell(i, col, fn):
        def f(w):
            c = w["google_sheets"]["rows"][i]["cells"]
            new = fn(str(c.get(col, "")))
            if new == c.get(col):
                return False
            c[col] = new
        return f
    for i in new_rows[:2]:
        m("row-drop", lambda w, i=i: w["google_sheets"]["rows"].pop(i))
        m("row-dup", lambda w, i=i: w["google_sheets"]["rows"].append(dict(copy.deepcopy(w["google_sheets"]["rows"][i]), id="mutdup" + "0" * 18, row_id=999)))
        for col, fn in ROW_CELL_OPS.items():
            if col in ("Approver", "Match", "Approval", "Notes") and not rows[i]["cells"].get("Status", "").startswith("Open"):
                continue
            m(f"row-{col.lower().replace(' ', '-').replace('#', 'no')}", cell(i, col, fn))
        m("row-extra-cell", lambda w, i=i: w["google_sheets"]["rows"][i]["cells"].__setitem__("Reviewed", "yes"))
    for i in ch_rows:
        b = next(r for r in before["google_sheets"]["rows"] if r["id"] == rows[i]["id"])
        changed = [c for c in rows[i]["cells"] if rows[i]["cells"].get(c) != b["cells"].get(c)]
        m("update-revert", lambda w, i=i, b=b: w["google_sheets"]["rows"].__setitem__(i, copy.deepcopy(b)))
        for col in changed:
            if col in ROW_CELL_OPS:
                m(f"update-{col.lower().replace(' ', '-')}-wrong", cell(i, col, ROW_CELL_OPS[col]))
        other = next((c for c in ("Due Date", "Qty", "PO #") if c not in changed), None)
        if other:
            m("update-extra-cell", cell(i, other, ROW_CELL_OPS[other]))
    if old_rows:
        j = old_rows[0]
        m("old-row-edit", cell(j, "Amount", lambda v: _cents_str(v, 100)))
        m("old-row-delete", lambda w: w["google_sheets"]["rows"].pop(j))
        if rows[j]["cells"].get("Status") == "Open":
            m("old-row-processing", cell(j, "Status", lambda v: "Processing"))
    for i in new_pol:
        m("policy-drop", lambda w, i=i: w["google_sheets"]["rows"].pop(i))
        m("policy-value", cell(i, "Value", lambda v: str(int(float(v)) + 1000)))
        m("policy-effective", cell(i, "Effective", lambda v: v[:11] + "00:00:00Z"))
        m("policy-approved-by", cell(i, "Approved by", lambda v: "controller@company.example.com"))
    pol_old = [i for i, r in enumerate(rows) if r["worksheet_id"] == gen.WS_POLICY and i not in new_pol]
    if pol_old:
        m("policy-old-edit", cell(pol_old[-1], "Value", lambda v: str(int(float(v)) + 500)))
    vendors = after["quickbooks"]["vendors"]
    for i in bills:
        bl = after["quickbooks"]["bills"][i]
        other = next(v["id"] for v in vendors if v["id"] != bl.get("vendor_id"))
        m("bill-drop", lambda w, i=i: w["quickbooks"]["bills"].pop(i))
        m("bill-dup", lambda w, i=i: w["quickbooks"]["bills"].append(dict(copy.deepcopy(w["quickbooks"]["bills"][i]), id="99999")))
        m("bill-total", lambda w, i=i: w["quickbooks"]["bills"][i].__setitem__("total_amt", _cents_str(bl["total_amt"], 100)))
        m("bill-vendor", lambda w, i=i, o=other: w["quickbooks"]["bills"][i].__setitem__("vendor_id", o))
        m("bill-due", lambda w, i=i: w["quickbooks"]["bills"][i].__setitem__("due_date", _bump_day(str(bl.get("due_date")), -1)))
        m("bill-doc", lambda w, i=i: w["quickbooks"]["bills"][i].__setitem__("doc_number", str(bl.get("doc_number")) + "A"))
    for i in pays:
        p = after["quickbooks"]["payments"][i]
        m("pay-drop", lambda w, i=i: w["quickbooks"]["payments"].pop(i))
        m("pay-dup", lambda w, i=i: w["quickbooks"]["payments"].append(dict(copy.deepcopy(w["quickbooks"]["payments"][i]), id="99998")))
        m("pay-amount", lambda w, i=i: w["quickbooks"]["payments"][i].__setitem__("total_amt", _cents_str(p["total_amt"], -100)))
        m("pay-unlinked", lambda w, i=i: w["quickbooks"]["payments"][i].__setitem__("invoice_id", None))
    open_awaiting = [i for i, r in enumerate(rows) if r["worksheet_id"] == gen.WS_PENDING and r["cells"].get("Status") == "Open"
                     and r["cells"].get("Approval") == "Awaiting Approval" and r["cells"].get("Match") == "Matched"]
    if open_awaiting:
        j = open_awaiting[0]
        c = rows[j]["cells"]
        bill = next((b for b in after["quickbooks"]["bills"] if gen.num_key(b.get("doc_number")) == gen.num_key(c["Invoice #"])), None)
        if bill:
            m("pay-unapproved", lambda w: w["quickbooks"]["payments"].append(
                {"id": "99997", "customer_id": bill["vendor_id"], "customer_name": bill.get("vendor_name"), "total_amt": c["Amount"],
                 "unapplied_amt": "0", "txn_date": "2026-01-01", "invoice_id": bill["id"], "created_time": "2026-01-01T00:00:00",
                 "last_updated_time": "2026-01-01T00:00:00"}))
    for i in mails[:3]:
        g = after["gmail"]["messages"][i]
        m("email-drop", lambda w, i=i: w["gmail"]["messages"].pop(i))
        m("email-dup", lambda w, i=i: w["gmail"]["messages"].append(dict(copy.deepcopy(w["gmail"]["messages"][i]), id="mutdupmail0000000")))
        m("email-recipient", lambda w, i=i, g=g: w["gmail"]["messages"][i].__setitem__("to", [g["to"][0].replace("@", "+x@")]))
        m("email-cc", lambda w, i=i: w["gmail"]["messages"][i].__setitem__("cc", ["controller@company.example.com"]))
        m("email-subject", lambda w, i=i, g=g: w["gmail"]["messages"][i].__setitem__("subject", g["subject"] + " (2)"))
        inv = re.search(r"[A-Z]{3}-\d+", g["subject"])
        if inv:
            m("email-body-no-invoice", lambda w, i=i, g=g, inv=inv.group(0): [w["gmail"]["messages"][i].__setitem__(f, (g.get(f) or "").replace(inv, "the invoice") or None)
                                                                                for f in ("body_plain", "body_html")])
        amt = re.search(r"\$([\d,]+\.\d\d)", g.get("body_plain") or "")
        if amt and ("Payment processing" in g["subject"] or "week close" in g["subject"]):   # amounts the policy names
            m("email-body-amount", lambda w, i=i, g=g, a=amt.group(1): [w["gmail"]["messages"][i].__setitem__(
                f, (g.get(f) or "").replace(a, a[:-1] + str((int(a[-1]) + 1) % 10)) or None) for f in ("body_plain", "body_html")])
    if not mails:
        m("email-extra", lambda w: _sent(w, "ap-lead@company.example.com", "AP update", "nothing", k[0]))
    for i in posts:
        m("post-drop", lambda w, i=i: w["slack"]["messages"].pop(i))
        m("post-no-trigger", lambda w, i=i: w["slack"]["messages"][i].__setitem__("text", "could not decide"))
    statics = {ws: [i for i, r in enumerate(rows) if r["worksheet_id"] == ws] for ws in (gen.WS_PO, gen.WS_RECV, gen.WS_APPROVERS, gen.WS_BLOCKED)}
    if statics[gen.WS_PO]:
        m("edit-po", cell(statics[gen.WS_PO][0], "Amount", lambda v: _cents_str(v, 100)))
    if statics[gen.WS_RECV]:
        m("edit-receiving", cell(statics[gen.WS_RECV][-1], "Received Qty", lambda v: str(int(float(v)) + 1)))
    m("edit-approvers", cell(statics[gen.WS_APPROVERS][0], "Active", lambda v: "No" if v == "Yes" else "Yes"))
    m("edit-blocked", cell(statics[gen.WS_BLOCKED][0], "Status", lambda v: "Lifted" if v == "Active Block" else "Active Block"))
    m("extra-ap-post", lambda w: _post(w, gen.AP_CHANNEL, "Invoice processed.", k[0]))
    if not truth["expect"]["escalate"]:
        m("sink-post", lambda w: _post(w, gen.REVIEW, f"{truth['trigger']}: checked", k[0]))
    m("delete-old-message", lambda w: w["slack"]["messages"].pop(0))
    m("trash-inbound", lambda w: w["gmail"]["messages"][0].__setitem__("label_ids", ["TRASH"]))
    return out


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects)."""
    out = []
    rows = after["google_sheets"]["rows"]
    new_rows = [i for i in _new(before, after, "google_sheets", "rows") if rows[i]["worksheet_id"] == gen.WS_PENDING]
    new_pol = [i for i in _new(before, after, "google_sheets", "rows") if rows[i]["worksheet_id"] == gen.WS_POLICY]
    mails = [i for i in _new(before, after, "gmail", "messages") if "SENT" in after["gmail"]["messages"][i]["label_ids"]]
    bills = _new(before, after, "quickbooks", "bills")
    inbound = [i for i, x in enumerate(after["gmail"]["messages"]) if "UNREAD" in (x.get("label_ids") or [])]

    def m(name, fn):
        w = copy.deepcopy(after)
        if fn(w) is not False:
            out.append((name, w))

    def setc(i, col, v):
        return lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__(col, v)
    if new_rows:
        i = new_rows[0]
        c = rows[i]["cells"]
        a = oracle.cents(c["Amount"])
        m("row-amount-dollar", setc(i, "Amount", f"${a // 100:,}.{a % 100:02d}"))
        m("row-amount-number", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Amount", a / 100))
        m("row-vendor-spaces", setc(i, "Vendor", "  " + c["Vendor"].upper().replace(" ", "  ") + " "))
        m("row-status-case", setc(i, "Status", c["Status"].lower()))
        m("row-invoice-case", setc(i, "Invoice #", c["Invoice #"].lower()))
        m("row-qty-number", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Qty", int(c["Qty"])))
        if "@" in c.get("Approver", ""):
            m("row-approver-case", setc(i, "Approver", c["Approver"].upper()))
        if c.get("Match"):
            m("row-match-case", setc(i, "Match", c["Match"].upper()))
    for i in new_pol:
        c = rows[i]["cells"]
        m("policy-offset", setc(i, "Effective", c["Effective"].replace("Z", "+00:00")))
        m("policy-value-decimals", setc(i, "Value", c["Value"] + ".00"))
    for i in mails[:2]:
        g = after["gmail"]["messages"][i]
        m("email-display-name", lambda w, i=i, g=g: w["gmail"]["messages"][i].__setitem__("to", [f"Recipient <{g['to'][0]}>"]))
        m("email-upper-recipient", lambda w, i=i, g=g: w["gmail"]["messages"][i].__setitem__("to", [g["to"][0].upper()]))
        m("email-longer-body", lambda w, i=i, g=g: w["gmail"]["messages"][i].__setitem__("body_plain", (g.get("body_plain") or "") + "\n\nKind regards"))
        m("email-subject-padded", lambda w, i=i, g=g: w["gmail"]["messages"][i].__setitem__("subject", " " + g["subject"] + " "))
        amt = re.search(r"\$([\d,]+\.\d\d)", g.get("body_plain") or "")
        if amt and "Payment processing" in g["subject"]:
            m("email-amount-plain", lambda w, i=i, g=g, a=amt.group(0): w["gmail"]["messages"][i].__setitem__(
                "body_plain", (g.get("body_plain") or "").replace(a, a.replace(",", "").replace("$", "USD "))))
    for i in bills:
        m("bill-vendor-name", lambda w, i=i: w["quickbooks"]["bills"][i].__setitem__("vendor_name", "Typed name"))
        m("bill-memo", lambda w, i=i: w["quickbooks"]["bills"][i].__setitem__("memo", "Logged by the AP automation"))
    if inbound:
        i = inbound[-1]
        m("inbound-marked-read", lambda w: (w["gmail"]["messages"][i].__setitem__("is_read", True),
                                            w["gmail"]["messages"][i].__setitem__("label_ids", ["INBOX"])))
    return out


def _grade_all(seeds: list[int], fn) -> tuple[int, list, Counter]:
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
    from reference import GMAIL, QB, SHEETS, SLACK, SS, Ap, usd

    class Equivalent(Ap):
        """Other tool paths and cell formats the policy leaves open: append by worksheet title, amounts written as
        $4,750.00 and Status / Match / Approval in lower case in the sheet, Gmail's flat to/subject/body send, the
        channel id for posts, a VendorRef with the vendor's name, a bill payment without TotalAmt."""
        def append(self, ws, headers, cells):
            title = {"ws_pending": "Pending Invoices", "ws_policy_log": "Policy Log"}[ws]
            cells = dict(cells)
            if "Amount" in cells and cells["Amount"]:
                from reference import cents
                cells["Amount"] = usd(cents(cells["Amount"]))
            for col in ("Status", "Match", "Approval"):
                if cells.get(col):
                    cells[col] = cells[col].lower()
            self.call("POST", f"{SHEETS}{SS}/values/{title.replace(' ', '%20')}!A1:M1:append", {"valueInputOption": "USER_ENTERED"},
                      {"values": [[cells.get(h, "") for h in headers]]})

        def update(self, ws, row_no, cells):
            cells = {k: (v.lower() if k in ("Status", "Match", "Approval") else v) for k, v in cells.items()}
            super().update(ws, row_no, cells)

        def send(self, to, subject, body):
            import base64
            self.call("POST", GMAIL + "messages/send", None, {"payload": {
                "headers": [{"name": "To", "value": f"Accounts <{to}>"}, {"name": "Subject", "value": subject}],
                "body": {"data": base64.urlsafe_b64encode(body.encode("utf-8")).decode("ascii")}}})

        def post(self, channel, text):
            chans = self.call("GET", SLACK + "conversations.list", {"limit": 200}).get("channels", [])
            cid = next(c["id"] for c in chans if c["name"] == channel)
            self.call("POST", SLACK + "chat.postMessage", None, {"channel": cid, "text": text})

        def call(self, method, url, params=None, body=None):
            if url == QB + "bill" and body:
                body = dict(body, VendorRef=dict(body["VendorRef"], name="(from the invoice)"))
            return super().call(method, url, params, body)

        def calls(self, specs):
            specs = [(s[0], s[1], s[2] if len(s) > 2 else None, {k: v for k, v in s[3].items() if k != "TotalAmt"})
                     if len(s) > 3 and s[1] == QB + "billpayment" else s for s in specs]
            return super().calls(specs)

    def solver(trigger, ctx):
        try:
            return Equivalent(trigger, ctx).run()
        except LookupError as e:
            ctx.fetch("POST", SLACK + "chat.postMessage", None, {"channel": "automation-review", "text": f"{trigger.get('trigger')}: {e}"})
    grader = oracle.Grader()
    results = [harness.run_stream(gen.generate(s), solver, grader=grader) for s in seeds]
    summ = harness.summarize(results)
    failures = [f"{x['taskKey']}: {[(c['name'], c['detail'][:160]) for c in x['failed']]}" for r in results for x in r["rows"] if not x["pass"]]
    return {"pass": total > 0 and not rejected and summ["passed"] == summ["triggers"], "seeds": seeds, "variants": total,
            "accepted": total - len(rejected), "rejected": rejected[:20], "operators": dict(sorted(by.items())),
            "equivalent_solver": {k: summ[k] for k in ("triggers", "passed", "clean_weeks")}, "equivalent_failures": failures[:10]}


GATES = ["determinism", "leakage", "solvability", "controls", "traps", "mutation", "specificity"]


def run_all(seeds: list[int], practice: list[int], only: list[str] | None = None) -> dict:
    only = only or GATES
    d3 = [s for s in seeds if gen.default_difficulty(s) == "d3"]
    streams = {s: gen.generate(s) for s in seeds} if "controls" in only else None
    g = {}
    if "determinism" in only:
        g["determinism"] = gate_determinism(seeds[:3])
    if "leakage" in only:
        g["leakage"] = gate_leakage(seeds)
    if "solvability" in only:
        g["solvability"] = gate_solvability(practice + seeds, rebased=seeds)
    if "controls" in only:
        g["controls"] = gate_controls(seeds, d3, streams)
    if "traps" in only:
        g["traps"] = gate_traps([s for s in LABEL if s in seeds] or seeds)
    if "mutation" in only:
        g["mutation"] = gate_mutation(seeds)
    if "specificity" in only:
        g["specificity"] = gate_specificity(seeds)
    return {"family": gen.FAMILY, "version": gen.VERSION, "pass": all(x["pass"] for x in g.values()), "gates": g}


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-fin-apintake $0 validity gates")
    ap.add_argument("--seeds", default="610-614")
    ap.add_argument("--practice", default="601-609")
    ap.add_argument("--only", help="comma-separated subset of " + ",".join(GATES))
    ap.add_argument("--out", help="host-only directory for gates.json")
    a = ap.parse_args(argv)
    res = run_all(harness.parse_seeds(a.seeds), harness.parse_seeds(a.practice), a.only.split(",") if a.only else None)
    if a.out:
        Path(a.out).mkdir(parents=True, exist_ok=True)
        (Path(a.out) / "gates.json").write_text(json.dumps(res, indent=1) + "\n")
    print(json.dumps(res))
    return 0 if res["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
