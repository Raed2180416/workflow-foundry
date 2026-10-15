#!/usr/bin/env python3
"""abr-sup-gdpr: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-sup-gdpr/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR] [--only determinism,leakage,...]

Prints one JSON object (exit 0 only when every gate passes). No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; every world_t (after each delta) validates as WorldState and
                survives dump -> load -> dump.
  leakage       what an arm sees carries no hidden truth: payload keys are fixed per event; a sheet payload's cells
                equal the world's cells after the delta; an email payload equals the inbound message; no truth
                vocabulary (trap ids, kinds, plan words) in payloads or world0; a request row and an inbound email
                arrive with their trigger (never in world0); the serve-input row holds only POLICY.md and the payload
                with no assertions; the reference imports no host module.
  solvability   the observable-only reference passes every trigger (and every week) of the practice and dev streams,
                in carry mode and in rebased mode; generator and reference therefore agree on every effect (gate 3).
  controls      every bad control fails; null passes exactly the no-op triggers; the <= 40-line naive heuristic
                scores below 60% per trigger at d3.
  traps         each trap kind appears at least five times across the four dev label streams 610-613.
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects.
  specificity   the oracle accepts policy-neutral variants (no false rejects), and an equivalent solver that uses
                other tool paths the policy leaves open passes every trigger.
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
             "day_close": {"date"}}
BAD_CONTROLS = ["null", "echo", "naive", "any-sender", "display-first", "fuzzy-address", "case-sensitive", "no-hold",
                "any-hold-row", "no-lift", "text-search", "org-purge", "name-match", "replace-tags", "edit-log",
                "skip-verified", "no-dedupe", "dedupe-any", "exact-deadline", "late-deadline", "count-all",
                "stale-batch", "snippet-only", "at-date"]
DESIGN_TRAP_KINDS = ["T-lookalike", "T-authority", "T-note", "T-repeat"]
TRUTH_WORDS = sorted(set([k for k in gen.TRAP_KIND if "-" in k] + list(set(gen.TRAP_KIND.values())) + [
    "traps", "truth", "expect", "spoof", "lookalike", "look-alike", "decoy", "oracle", "genuine",
    "erasure.requested", "verification.reply", "legal_hold.changed", "erasure.duplicate", "day.close"]))


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
                ws = gen.WS_REQ if d["worksheet"] == gen.WS_TITLE[gen.WS_REQ] else gen.WS_HOLD
                row = next((r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == ws and r["row_id"] == d["row_id"]), None)
                if row is None or any(row["cells"].get(k) != v for k, v in d["row"].items()):
                    problems.append(f"{tid}: the payload's cells are not the world's cells after the delta")
                if payload["event"] == "new_row" and (row is None or row["cells"] != d["row"]):
                    problems.append(f"{tid}: a new-row payload is not the inserted row")
                if payload["event"] == "new_row" and any(op.get("record", {}).get("id") in w0_rows for op in trig["delta"]):
                    problems.append(f"{tid}: the new row is already in world0")
            if payload["event"] == "new_email":
                msg = next((x for x in w["gmail"]["messages"] if x["id"] == d["message_id"]), None)
                if msg is None or msg["from_"] != d["from"] or msg["subject"] != d["subject"] or msg.get("snippet") != d["snippet"]:
                    problems.append(f"{tid}: the email payload is not the inbound message")
                if d["message_id"] in w0_msgs:
                    problems.append(f"{tid}: the inbound email is already in world0")
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
        res[name] = {**{k: summary[k] for k in ("triggers", "passed", "pass_rate", "clean_weeks", "outcomes", "errors")},
                     "failed_by_kind": dict(sorted(failed_kinds.items()))}
        if summary["passed"] == summary["triggers"] or summary["clean_weeks"] == summary["streams"]:
            problems.append(f"{name} does not fail")
    if res["null"]["passed"] != noop:
        problems.append(f"null passes {res['null']['passed']} triggers, the no-op share is {noop}")
    naive_d3, _ = harness.run("naive", d3_seeds, streams=streams)
    if naive_d3["pass_rate"] >= 0.6:
        problems.append(f"naive scores {naive_d3['pass_rate']} at d3")
    import controls
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
                     "event": out["meta"]["event_trap_share"]}
    short = [k for k in DESIGN_TRAP_KINDS if kinds[k] < 5]
    return {"pass": not short, "seeds": seeds, "by_kind": dict(sorted(kinds.items())), "by_id": dict(sorted(ids.items())),
            "short": short, "shares": shares}


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score
# ---------------------------------------------------------------------------------------------------------------------
def _chan(world: dict, name: str) -> str:
    return next(c["id"] for c in world["slack"]["channels"] if c["name"] == name)


def _new(before: dict, after: dict, app: str, coll: str, key="id") -> list[int]:
    old = {gen.canon(oracle._key(app, coll, r)) for r in before[app][coll]}
    return [i for i, r in enumerate(after[app][coll]) if gen.canon(oracle._key(app, coll, r)) not in old]


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


def mutants(before: dict, after: dict, truth: dict):
    """Single-fault mutants of a correct after-world. Returns [(name, mutated_after)]; ops that do not apply are skipped."""
    k = [0]
    out = []
    rows_new = [i for i in _new(before, after, "google_sheets", "rows")
                if after["google_sheets"]["rows"][i]["worksheet_id"] == gen.WS_LOG]
    log_old = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_LOG and i not in rows_new]
    mails = [i for i in _new(before, after, "gmail", "messages") if "SENT" in after["gmail"]["messages"][i]["label_ids"]]
    tix = _changed(before, after, "zendesk", "tickets")
    gone = [u for u in before["zendesk"]["users"] if u["id"] not in {x["id"] for x in after["zendesk"]["users"]}]
    ops = _chan(after, gen.PRIVACY_OPS)
    posts = [i for i in _new(before, after, "slack", "messages") if after["slack"]["messages"][i]["channel_id"] == ops]

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
    if rows_new:
        i = rows_new[-1]
        m("log-drop", lambda w: w["google_sheets"]["rows"].pop(i))
        m("log-dup", lambda w: w["google_sheets"]["rows"].append(dict(copy.deepcopy(w["google_sheets"]["rows"][i]),
                                                                      id="mutdup" + "0" * 18, row_id=999)))
        m("log-transition", cell(i, "Transition", lambda v: {"Purged": "Erased", "Verified": "Confirmed",
                                                               "Verification Sent": "Received"}.get(v, v + " (auto)")))
        m("log-request-id", cell(i, "Request ID", lambda v: re.sub(r"(\d)$", lambda mm: str((int(mm.group(1)) + 1) % 10), v)))
        m("log-email", cell(i, "Email", lambda v: v.replace(".example.", ".example-mail.") if "@" in v else "x@y.example.com"))
        m("log-at-day", cell(i, "At", lambda v: re.sub(r"T(\d\d)", lambda mm: f"T{(int(mm.group(1)) + 5) % 24:02d}", v)))
        m("log-at-missing", cell(i, "At", lambda v: ""))
        m("log-reference", cell(i, "Reference", lambda v: (v.split(",")[0] if "," in v else (v + "x" if v else "n/a"))))
        m("log-extra-cell", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Notes", "auto"))
        same = [j for j in rows_new if j != i and after["google_sheets"]["rows"][j]["cells"]["Request ID"]
                == after["google_sheets"]["rows"][i]["cells"]["Request ID"]]
        if same:
            def swap(w, j=same[0]):
                a, b = w["google_sheets"]["rows"][i], w["google_sheets"]["rows"][j]
                a["row_id"], b["row_id"] = b["row_id"], a["row_id"]
            m("log-order", swap)
    if log_old:
        j = log_old[-1]
        m("log-edit-old", cell(j, "Transition", lambda v: "Purged" if v != "Purged" else "Closed - Unverified"))
        m("log-delete-old", lambda w: w["google_sheets"]["rows"].pop(j))
        m("log-touch-old-at", cell(j, "At", lambda v: v.replace("Z", "+00:00") + " "))
    if mails:
        i = mails[0]
        g = after["gmail"]["messages"][i]
        m("email-drop", lambda w: w["gmail"]["messages"].pop(i))
        m("email-dup", lambda w: w["gmail"]["messages"].append(dict(copy.deepcopy(w["gmail"]["messages"][i]), id="mutdupmail0000000")))
        m("email-recipient", lambda w: w["gmail"]["messages"][i].__setitem__("to", [g["to"][0].replace("@", "+x@")]))
        m("email-cc", lambda w: w["gmail"]["messages"][i].__setitem__("cc", ["privacy-office@company.example.com"]))
        m("email-subject", lambda w: w["gmail"]["messages"][i].__setitem__("subject", g["subject"].replace("erasure", "deletion")
                                                                             if "erasure" in g["subject"] else g["subject"] + " (2)"))
        rid = re.search(r"GDPR-\d+", g["subject"]).group(0)
        m("email-body-no-id", lambda w: [w["gmail"]["messages"][i].__setitem__(f, (g.get(f) or "").replace(rid, "your request") or None)
                                          for f in ("body_plain", "body_html")])
    else:
        to = next((u["email"] for u in after["zendesk"]["users"] if u["role"] == "end-user"), "a@b.example.com")
        m("email-extra", lambda w: _sent(w, to, "Verify your erasure request GDPR-0000", "GDPR-0000", k[0]))
    if tix:
        i = tix[0]
        t0 = next(t for t in before["zendesk"]["tickets"] if t["id"] == after["zendesk"]["tickets"][i]["id"])
        m("ticket-revert", lambda w: w["zendesk"]["tickets"].__setitem__(i, copy.deepcopy(t0)))
        m("ticket-prefix", lambda w: w["zendesk"]["tickets"][i].__setitem__("subject", "[GDPR] " + t0["subject"]))
        m("ticket-no-tag", lambda w: w["zendesk"]["tickets"][i].__setitem__("tags", list(t0["tags"])))
        if t0["tags"]:
            m("ticket-replace-tags", lambda w: w["zendesk"]["tickets"][i].__setitem__("tags", ["gdpr-purged"]))
        m("ticket-comment", lambda w: w["zendesk"]["tickets"][i]["comments"].append(
            {"id": "mutcmt", "body": "[redacted]", "public": False, "author_id": None, "created_at": "2026-01-01T00:00:00"}))
        m("ticket-status", lambda w: w["zendesk"]["tickets"][i].__setitem__("status", "closed" if t0["status"] != "closed" else "solved"))
    others = [i for i, t in enumerate(after["zendesk"]["tickets"]) if i not in tix and "[GDPR Purged]" not in t["subject"]]
    if others:
        i = others[0]
        m("ticket-other", lambda w: w["zendesk"]["tickets"][i].__setitem__("subject", "[GDPR Purged] " + w["zendesk"]["tickets"][i]["subject"]))
    if gone:
        m("user-not-deleted", lambda w: w["zendesk"]["users"].append(copy.deepcopy(gone[0])))
    live = [i for i, u in enumerate(after["zendesk"]["users"]) if u["role"] == "end-user"]
    if live:
        m("user-other-deleted", lambda w: w["zendesk"]["users"].pop(live[0]))
    if posts:
        i = posts[0]
        txt = after["slack"]["messages"][i]["text"]
        m("post-drop", lambda w: w["slack"]["messages"].pop(i))
        m("post-dup", lambda w: w["slack"]["messages"].append(dict(w["slack"]["messages"][i], ts="9100000000.000001")))
        m("post-purged-count", lambda w: w["slack"]["messages"][i].__setitem__("text", re.sub(r": (\d+) purged", lambda mm: f": {int(mm.group(1)) + 1} purged", txt)))
        m("post-blocked-count", lambda w: w["slack"]["messages"][i].__setitem__("text", re.sub(r"(\d+) blocked", lambda mm: f"{int(mm.group(1)) + 1} blocked", txt)))
        m("post-batch", lambda w: w["slack"]["messages"][i].__setitem__("text", re.sub(r"batch \S+", "batch GDPR-BATCH-00000000", txt)))
        m("post-date", lambda w: w["slack"]["messages"][i].__setitem__("text", re.sub(r"^(\d{4}-\d\d-)(\d\d)", lambda mm: f"{mm.group(1)}{(int(mm.group(2)) % 28) + 1:02d}", txt)))
        m("post-channel", lambda w: w["slack"]["messages"][i].__setitem__("channel_id", _chan(w, gen.GENERAL)))
    reqs = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_REQ]
    holds = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_HOLD]
    cfg = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_CFG]
    m("edit-request-row", cell(reqs[-1], "Source", lambda v: "Processed"))
    if holds:
        m("edit-hold-row", cell(holds[0], "Status", lambda v: "Lifted" if v == "Active" else "Active"))
    m("edit-config", cell(cfg[0], "Value", lambda v: v + "-x"))
    m("extra-privacy-post", lambda w: _post(w, gen.PRIVACY_OPS, "Erasure processed.", k[0]))
    m("sink-post", lambda w: _post(w, gen.REVIEW, f"{truth['trigger']}: checked", k[0]))
    m("delete-old-message", lambda w: w["slack"]["messages"].pop(0))
    m("trash-inbound", lambda w: w["gmail"]["messages"][0].__setitem__("label_ids", ["TRASH"]))
    return out


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects)."""
    out = []
    rows_new = [i for i in _new(before, after, "google_sheets", "rows")
                if after["google_sheets"]["rows"][i]["worksheet_id"] == gen.WS_LOG]
    mails = [i for i in _new(before, after, "gmail", "messages") if "SENT" in after["gmail"]["messages"][i]["label_ids"]]
    tix = _changed(before, after, "zendesk", "tickets")
    ops = _chan(after, gen.PRIVACY_OPS)
    posts = [i for i in _new(before, after, "slack", "messages") if after["slack"]["messages"][i]["channel_id"] == ops]
    inbound = [i for i, x in enumerate(after["gmail"]["messages"]) if "UNREAD" in (x.get("label_ids") or [])]

    def m(name, fn):
        w = copy.deepcopy(after)
        if fn(w) is not False:
            out.append((name, w))
    if rows_new:
        i = rows_new[0]
        c = after["google_sheets"]["rows"][i]["cells"]
        m("log-at-offset", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("At", c["At"].replace("Z", "+00:00")))
        m("log-at-no-seconds", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("At", c["At"][:16].replace("T", " ")))
        m("log-transition-case", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Transition", c["Transition"].upper()))
        m("log-email-case", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Email", c["Email"].upper()))
        multi = [j for j in rows_new if "," in (after["google_sheets"]["rows"][j]["cells"].get("Reference") or "")]
        if multi:
            j = multi[0]
            ref = after["google_sheets"]["rows"][j]["cells"]["Reference"]
            m("log-reference-order", lambda w: w["google_sheets"]["rows"][j]["cells"].__setitem__(
                "Reference", ";".join(reversed([x.strip() for x in ref.split(",")]))))
    if mails:
        i = mails[0]
        g = after["gmail"]["messages"][i]
        m("email-display-name", lambda w: w["gmail"]["messages"][i].__setitem__("to", [f"Requester <{g['to'][0]}>"]))
        m("email-upper-recipient", lambda w: w["gmail"]["messages"][i].__setitem__("to", [g["to"][0].upper()]))
        m("email-longer-body", lambda w: w["gmail"]["messages"][i].__setitem__("body_plain", (g.get("body_plain") or "") + "\n\nKind regards"))
        m("email-subject-padded", lambda w: w["gmail"]["messages"][i].__setitem__("subject", "  " + g["subject"] + " "))
    if tix:
        i = tix[0]
        m("ticket-tags-order", lambda w: w["zendesk"]["tickets"][i].__setitem__("tags", list(reversed(w["zendesk"]["tickets"][i]["tags"]))))
    if posts:
        i = posts[0]
        m("post-trailing-period", lambda w: w["slack"]["messages"][i].__setitem__("text", w["slack"]["messages"][i]["text"] + "."))
        m("post-bot-name", lambda w: w["slack"]["messages"][i].__setitem__("bot_name", "Privacy Bot"))
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
    from reference import SHEETS, SLACK, SS, TAG, WS_LOG, ZENDESK, Gdpr

    class Equivalent(Gdpr):
        """Other tool paths the policy leaves open: append by worksheet title, the tags endpoint, the channel id,
        a lower-case Transition and an At with an explicit offset, the ticket ids separated by semicolons (and reads
        its own rows back accordingly)."""
        def state(self, rid, log):
            rows = [c for c in log if c.get("Request ID", "").strip() == rid]
            s = " ".join(rows[-1].get("Transition", "").split()).lower() if rows else None
            return next((t for t in ("Verification Sent", "Verified", "Blocked - Legal Hold", "Purged", "Not Found",
                                     "Duplicate", "Closed - Unverified") if t.lower() == s), s)

        def count(self, log, transition, day):
            from reference import utc_date
            return sum(1 for c in log if c.get("Transition", "").strip().lower() == transition.lower() and utc_date(c.get("At")) == day)

        def append_log(self, rid, email, transition, reference=""):
            hdr = self.headers(WS_LOG)
            cells = {"Request ID": rid, "Email": email.strip(), "Transition": transition.lower(),
                     "At": self.at.replace("Z", "+00:00"), "Reference": reference.replace(", ", ";")}
            self.call("POST", f"{SHEETS}{SS}/values/Compliance%20Log!A1:E1:append", {"valueInputOption": "RAW"},
                      {"values": [[cells.get(h, "") for h in hdr]]})

        def anonymize(self, t):
            self.call("PUT", ZENDESK + f"tickets/{t['id']}", None, {"ticket": {"subject": "[GDPR Purged] " + t["subject"]}})
            self.call("PUT", ZENDESK + f"tickets/{t['id']}/tags", None, {"tags": [TAG]})

        def post(self, text, channel="privacy-ops"):
            chans = self.call("GET", SLACK + "conversations.list", {"limit": 200}).get("channels", [])
            cid = next(c["id"] for c in chans if c["name"] == channel)
            self.call("POST", SLACK + "chat.postMessage", None, {"channel": cid, "text": text})

    def solver(trigger, ctx):
        return Equivalent(trigger, ctx).run()
    grader = oracle.Grader()
    results = [harness.run_stream(gen.generate(s), solver, grader=grader) for s in seeds]
    summ = harness.summarize(results)
    failures = [f"{x['taskKey']}: {[c['name'] for c in x['failed']]}" for r in results for x in r["rows"] if not x["pass"]]
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
    ap = argparse.ArgumentParser(description="abr-sup-gdpr $0 validity gates")
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
