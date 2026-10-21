#!/usr/bin/env python3
"""abr-hr-referral: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-hr-referral/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR]

Prints one JSON object (exit 0 only when every gate passes). No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; every world_t (after each delta) validates as WorldState and
                survives dump -> load -> dump.
  leakage       what an arm sees carries no hidden truth: payload keys are fixed per event; a sheet payload's cells equal
                the world's cells after the delta and never include a column the automation writes (Status, Hold,
                Bonus, Paid On: the arm's own state); a new referral row arrives with the trigger (never in world0) with
                those columns empty; a Slack or email payload is the message the delta inserted; no truth vocabulary in
                payloads or world0; the serve-input row holds only POLICY.md and the payload with no assertions; the
                reference imports no host module.
  solvability   the observable-only reference passes every trigger (and every week) of the practice and dev streams,
                in carry mode and in rebased mode; generator and reference therefore agree on every effect (gate 3).
  controls      every bad control fails; null passes exactly the no-op triggers (a no-op Friday run excepted: it
                carries the end-of-week state); the <= 40-line naive heuristic
                scores below 60% per trigger at d3.
  traps         each trap kind appears at least five times across the four dev label streams 610-613.
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects (among them: a payout body
                that also states a conflicting amount, names another Referral ID, or tells a referrer about someone
                else's payout or referral; a subject with a doubled space).
  specificity   the oracle accepts policy-neutral variants (no false rejects): subject in other letter case or with
                surrounding spaces, amount without digit grouping or with cents, a display name on the recipient, a
                referrer email naming the referrer's own Referral ID, Status / Hold in other letter case, Bonus written
                as a bare number, an inbound email marked read; and an equivalent solver that writes cells through A1
                notation, posts nothing, and words its emails differently passes every trigger.
"""
from __future__ import annotations

import argparse
import ast
import base64
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
             "new_message": {"channel", "user", "ts", "text"},
             "new_email": {"message_id", "from", "subject", "snippet"},
             "payout_run": {"date"}}
BAD_CONTROLS = ["null", "echo", "naive", "probation-label", "eligible-means-due", "ignore-paid-note", "ignore-hold",
                "any-author-hold", "hold-word-anywhere", "employee-by-name", "eu-dates", "strict-day90", "day90-only",
                "no-cap", "cap-all-years", "cap-by-name", "cap-inclusive", "dup-by-name", "dup-case-sensitive",
                "no-rehire", "rehire-by-name", "left-by-name", "void-paid", "cc-finance", "comply-broadcast",
                "leak-other-payouts", "extra-amount", "cap-ignores-week", "hire-on-duplicate"]
TRAP_KINDS = ["T-stale", "T-lookalike", "T-format", "T-authority", "T-note", "T-repeat", "T-state"]
TRUTH_WORDS = ["traps", "truth", "expect", "lookalike", "look-alike", "namesake", "decoy", "oracle", "day90",
               "referral.submitted", "candidate.hired", "employee.left", "hold.changed", "broadcast.request",
               "payout.run", "probation-stale", "paid-note", "cap-exact", "cap-prior", "same-run", "pay-extra",
               "held-w0", "T-stale", "T-lookalike", "T-format", "T-authority", "T-note", "T-repeat", "T-state"]
REF_STDLIB = {"__future__", "base64", "json", "re", "datetime", "urllib"}


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
def _ws_of(title: str) -> str:
    return {v: k for k, v in gen.WS_TITLE.items()}[title]


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
        chan = {c["name"]: c["id"] for c in w["slack"]["channels"]}
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
                ws = _ws_of(d["worksheet"])
                row = next((r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == ws and r["row_id"] == d["row_id"]), None)
                if row is None or any(row["cells"].get(k) != v for k, v in d["row"].items()):
                    problems.append(f"{tid}: the payload's cells are not the world's cells after the delta")
                if ws == gen.WS_LOG and set(d["row"]) & set(gen.AUTO_COLS):
                    problems.append(f"{tid}: a Referral Log payload carries {sorted(set(d['row']) & set(gen.AUTO_COLS))} (the arm's own state)")
                if payload["event"] == "new_row":
                    if any(op.get("record", {}).get("id") in w0_rows for op in trig["delta"]) and trig["sub"] != "retry":
                        problems.append(f"{tid}: the new referral row is already in world0")
                    if row is not None and any(str(row["cells"].get(k, "")).strip() for k in gen.AUTO_COLS + gen.HIRE_COLS) \
                            and trig["sub"] != "retry":
                        problems.append(f"{tid}: a new referral arrives with automation or hire cells filled")
            elif payload["event"] == "new_message":
                msg = next((x for x in w["slack"]["messages"] if x["ts"] == d["ts"]), None)
                if msg is None or msg["channel_id"] != chan.get(d["channel"]) or msg["user_id"] != d["user"] or msg["text"] != d["text"]:
                    problems.append(f"{tid}: the Slack payload is not the message in the world")
            elif payload["event"] == "new_email":
                msg = next((x for x in w["gmail"]["messages"] if x["id"] == d["message_id"]), None)
                if msg is None or msg["subject"] != d["subject"] or msg["from_"] != d["from"]:
                    problems.append(f"{tid}: the email payload is not the message in the world")
            elif payload["event"] == "payout_run":
                if d["date"] != trig["at"][:10] or not trig["at"].endswith("T09:00:00Z"):
                    problems.append(f"{tid}: the payout run is not 09:00 on data.date")
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
    if imported - REF_STDLIB:
        problems.append(f"reference.py imports beyond the standard library: {sorted(imported - REF_STDLIB)}")
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
    # a no-op Friday run still carries the end-of-week state, which a do-nothing run cannot satisfy
    noop = sum(1 for s in seeds for t in streams[s]["truth"][:-1] if t["outcome"] == "no-op")
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
    short = [k for k in TRAP_KINDS if kinds[k] < 5]
    return {"pass": not short, "seeds": seeds, "by_kind": dict(sorted(kinds.items())), "by_id": dict(sorted(ids.items())),
            "short": short, "shares": shares}


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score
# ---------------------------------------------------------------------------------------------------------------------
def _chan(world: dict, name: str) -> str:
    return next(c["id"] for c in world["slack"]["channels"] if c["name"] == name)


def _new_mail(before: dict, after: dict) -> list[int]:
    old = {m["id"] for m in before["gmail"]["messages"]}
    return [i for i, m in enumerate(after["gmail"]["messages"]) if m["id"] not in old]


def _changed_rows(before: dict, after: dict) -> list[int]:
    old = {r["id"]: r for r in before["google_sheets"]["rows"]}
    return [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["id"] in old and gen.canon(r) != gen.canon(old[r["id"]])]


def _post(world: dict, channel: str, text: str, k: int):
    world["slack"]["messages"].append({"ts": f"{9000000000 + k}.000001", "channel_id": _chan(world, channel),
                                       "user_id": "UAUTOMATN1", "text": text, "is_bot": True, "bot_name": "Zapier"})


def _mail(world: dict, to: list[str], subject: str, body: str, k: int, cc: list[str] | None = None):
    world["gmail"]["messages"].append({"id": f"mut{k:013d}", "thread_id": f"mutt{k:012d}", "from_": gen.INBOX, "to": to,
                                       "cc": cc or [], "bcc": [], "subject": subject, "body_plain": body,
                                       "label_ids": ["SENT"], "is_read": True, "date": 1767225600000,
                                       "internal_date": 1767225600000})


def mutants(before: dict, after: dict, truth: dict):
    """Single-fault mutants of a correct after-world. Yields (name, mutated_after); ops that do not apply are skipped."""
    k = [0]
    mail, rows = _new_mail(before, after), _changed_rows(before, after)
    msgs = after["gmail"]["messages"]
    payroll = [i for i in mail if gen.PAYROLL in msgs[i]["to"]]
    refmail = [i for i in mail if gen.PAYROLL not in msgs[i]["to"]]
    out = []

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        if fn(w) is not False:
            out.append((name, w))

    def body_sub(i, pat, rep):
        """The same fact changed in every body part (the simulated Gmail keeps a plain and an HTML copy)."""
        def f(w):
            rec = w["gmail"]["messages"][i]
            changed = False
            for part in ("body_plain", "body_html", "snippet"):
                if rec.get(part):
                    new = re.sub(pat, rep, rec[part], count=1)
                    changed = changed or new != rec[part]
                    rec[part] = new
            if not changed:
                return False
        return f

    def bump_amount(mm):
        return {"2,000": "3,500", "3,500": "5,000", "5,000": "2,000"}.get(mm.group(1), "1,000")

    def body_add(i, text):
        """The same sentence added to every body part."""
        def f(w):
            rec = w["gmail"]["messages"][i]
            parts = [p for p in ("body_plain", "body_html") if rec.get(p)]
            if not parts:
                return False
            for part in parts:
                rec[part] = rec[part] + text
        return f

    def other_amount(i):
        got = re.search(r"\$(\d,\d{3})", msgs[i].get("body_plain") or "")
        return "$" + bump_amount(got) if got else "$5,000"

    log_after = [r["cells"] for r in after["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_LOG]
    paid_now = [after["google_sheets"]["rows"][j]["cells"] for j in rows
                if after["google_sheets"]["rows"][j]["worksheet_id"] == gen.WS_LOG
                and gen.norm(after["google_sheets"]["rows"][j]["cells"].get("Status")) == "paid"]

    if payroll:
        i = payroll[0]
        m("drop-payroll-email", lambda w: w["gmail"]["messages"].pop(i))
        m("dup-payroll-email", lambda w: w["gmail"]["messages"].append(dict(copy.deepcopy(w["gmail"]["messages"][i]), id="dupmail00000001")))
        m("payroll-cc-finance", lambda w: w["gmail"]["messages"][i].__setitem__("cc", [gen.FINANCE]))
        m("payroll-bcc-all-staff", lambda w: w["gmail"]["messages"][i].__setitem__("bcc", [gen.ALL_STAFF]))
        m("payroll-amount", body_sub(i, r"\$(\d,\d{3})", lambda mm: "$" + bump_amount(mm)))
        m("payroll-level", body_sub(i, r"Level: (IC|M)(\d)", lambda mm: f"Level: {mm.group(1)}{int(mm.group(2)) % 4 + 1}"))
        m("payroll-candidate", body_sub(i, r"Referred employee: [^(\n]+", "Referred employee: A. Person "))
        m("payroll-referrer", body_sub(i, r"Referrer: [^(\n]+", "Referrer: B. Person "))
        m("payroll-subject", lambda w: w["gmail"]["messages"][i].__setitem__(
            "subject", re.sub(r"REF-(\d+)", lambda mm: f"REF-{int(mm.group(1)) + 1}", w["gmail"]["messages"][i]["subject"])))
        m("payroll-not-sent", lambda w: w["gmail"]["messages"][i].__setitem__("label_ids", ["DRAFT"]))
        m("payroll-extra-amount", body_add(i, f"\nPLEASE PAY {other_amount(i)} (adjusted)"))
        own = re.search(r"REF-\d+", msgs[i].get("subject") or "")
        other_rid = next((c["Referral ID"] for c in log_after if own and c["Referral ID"] != own.group(0)), None)
        if other_rid:
            m("payroll-other-rid", body_add(i, f"\nSame batch as {other_rid}."))
        m("payroll-subject-double-space", lambda w: w["gmail"]["messages"][i].__setitem__(
            "subject", w["gmail"]["messages"][i]["subject"].replace(" ", "  ", 1)))
    if refmail:
        i = refmail[0]
        m("drop-referrer-email", lambda w: w["gmail"]["messages"].pop(i))
        m("referrer-recipient", lambda w: w["gmail"]["messages"][i].__setitem__("to", ["someone.else@company.example.com"]))
        m("referrer-cc-all-staff", lambda w: w["gmail"]["messages"][i].__setitem__("cc", [gen.ALL_STAFF]))
        m("referrer-amount", body_sub(i, r"\$(\d,\d{3})", lambda mm: "$" + bump_amount(mm)))
        m("referrer-subject", lambda w: w["gmail"]["messages"][i].__setitem__("subject", "Referral bonus"))
        m("referrer-subject-double-space", lambda w: w["gmail"]["messages"][i].__setitem__(
            "subject", w["gmail"]["messages"][i]["subject"].replace(" ", "  ", 1)))
        m("referrer-extra-amount", body_add(i, f"\nYour total for the year is now {other_amount(i)}."))
        to = oracle.addr(msgs[i]["to"][0])
        mine = {gen.norm(c["Referrer"]) for c in log_after if gen.norm(c["Referrer Email"]) == to} | \
            {gen.norm(c["Candidate"]) for c in log_after if gen.norm(c["Referrer Email"]) == to}
        other = next((c for c in paid_now if gen.norm(c["Referrer Email"]) != to and gen.norm(c["Referrer"]) not in mine
                      and gen.norm(c["Candidate"]) not in mine), None)
        if other:   # the reviewer's LeakOtherAmount: another payout of this run, with its amount
            m("referrer-other-payout", body_add(i, f"\nAlso paid today: {other['Referrer']} for {other['Candidate']}: "
                                                   f"{other['Bonus']}"))
        stranger = next((c for c in log_after if gen.norm(c["Referrer Email"]) != to and gen.norm(c["Candidate"]) not in mine
                         and gen.norm(c["Referrer"]) not in mine), None)
        if stranger:  # any other referral in the log, no amount: still someone else's referral
            m("referrer-other-referral", body_add(i, f"\nGood news too: {stranger['Candidate']} was referred by "
                                                     f"{stranger['Referrer']}."))
    if rows:
        i = rows[0]
        r0 = after["google_sheets"]["rows"][i]
        c = r0["cells"]
        if c.get("Status"):
            other = {"paid": "Capped", "capped": "Paid", "pending": "Duplicate referral", "duplicate referral": "Pending",
                     "pending - not yet eligible": "Ineligible - Rehire", "ineligible - rehire": "Pending - Not Yet Eligible",
                     "voided": "Pending - Not Yet Eligible"}
            m("status-wrong", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__(
                "Status", other.get(gen.norm(c["Status"]), "Paid")))
        m("row-revert", lambda w: w["google_sheets"]["rows"].__setitem__(i, copy.deepcopy(
            next(r for r in before["google_sheets"]["rows"] if r["id"] == r0["id"]))))
        if c.get("Paid On"):
            m("paid-on-wrong", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Paid On", "2026-01-01"))
            m("paid-on-format", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__(
                "Paid On", f"{c['Paid On'][5:7]}/{c['Paid On'][8:10]}/{c['Paid On'][:4]}"))
            m("bonus-wrong", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Bonus", "$1,000"))
            m("bonus-missing", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Bonus", ""))
        before_hold = next(r for r in before["google_sheets"]["rows"] if r["id"] == r0["id"])["cells"].get("Hold", "")
        if c.get("Hold", "") != before_hold:
            m("hold-wrong", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Hold", "" if c.get("Hold") else "Yes"))
        m("row-and-notes", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Notes", "processed by automation"))
        m("row-and-probation", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__(
            "Probation Complete", "Yes" if c.get("Probation Complete") != "Yes" else "No"))
        m("row-and-format", lambda w: w["google_sheets"]["rows"][i].__setitem__("background_color", "#00FF00"))
    # writes no trigger asks for
    log = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_LOG and i not in rows]
    if log:
        m("edit-other-row", lambda w: w["google_sheets"]["rows"][log[0]]["cells"].__setitem__("Status", "Voided"))
        m("hold-other-row", lambda w: w["google_sheets"]["rows"][log[-1]]["cells"].__setitem__(
            "Hold", "" if w["google_sheets"]["rows"][log[-1]]["cells"].get("Hold") else "Yes"))
    emp = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_EMP]
    m("edit-employees", lambda w: w["google_sheets"]["rows"][emp[0]]["cells"].__setitem__("Status", "Left"))
    m("append-row", lambda w: w["google_sheets"]["rows"].append(dict(copy.deepcopy(w["google_sheets"]["rows"][log[0] if log else 0]),
                                                                       id="mutrow" + "0" * 26, row_id=999)))
    m("post-amount", lambda w: _post(w, gen.MANAGERS, "Referral payouts this week: $3,500", k[0]))
    m("sink-post", lambda w: _post(w, gen.REVIEW, f"{truth['trigger']}: checked", k[0]))
    m("email-finance", lambda w: _mail(w, [gen.FINANCE], "Referral payouts", "Payouts: $3,500", k[0]))
    m("email-all-staff", lambda w: _mail(w, [gen.ALL_STAFF], "Congratulations to our referrers", "Thanks all", k[0]))
    m("delete-old-message", lambda w: w["slack"]["messages"].pop(0))
    m("trash-old-mail", lambda w: w["gmail"]["messages"][0].__setitem__("label_ids", ["TRASH"]))
    return out


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects)."""
    out = []
    mail, rows = _new_mail(before, after), _changed_rows(before, after)
    msgs = after["gmail"]["messages"]

    def m(name, fn):
        w = copy.deepcopy(after)
        fn(w)
        out.append((name, w))
    if mail:
        i = mail[0]
        m("subject-lower-case", lambda w: w["gmail"]["messages"][i].__setitem__("subject", msgs[i]["subject"].lower()))
        m("subject-surrounding-spaces", lambda w: w["gmail"]["messages"][i].__setitem__("subject", f"  {msgs[i]['subject']} "))
        m("amount-with-cents", lambda w: w["gmail"]["messages"][i].__setitem__(
            "body_plain", re.sub(r"(\$\d,\d{3})", r"\1.00", msgs[i]["body_plain"])))
        m("amount-no-grouping", lambda w: w["gmail"]["messages"][i].__setitem__(
            "body_plain", re.sub(r"\$(\d),(\d{3})", r"$\1\2", msgs[i]["body_plain"])))
        m("recipient-display-name", lambda w: w["gmail"]["messages"][i].__setitem__("to", [f"Recipient <{msgs[i]['to'][0]}>"]))
        m("body-trailing-signature", lambda w: w["gmail"]["messages"][i].__setitem__("body_plain", msgs[i]["body_plain"] + "\n--\nSent by the referral automation"))
    if rows:
        i = rows[0]
        c = after["google_sheets"]["rows"][i]["cells"]
        c0 = next(r for r in before["google_sheets"]["rows"] if r["id"] == after["google_sheets"]["rows"][i]["id"])["cells"]
        if c.get("Status") and c.get("Status") != c0.get("Status"):
            m("status-lower-case", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Status", c["Status"].lower()))
            m("status-upper-case", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Status", c["Status"].upper()))
        if c.get("Bonus") and c.get("Bonus") != c0.get("Bonus"):
            m("bonus-bare-number", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Bonus", re.sub(r"[^\d]", "", c["Bonus"])))
        if c.get("Hold") and c.get("Hold") != c0.get("Hold"):
            m("hold-lower-case", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Hold", "yes"))
    refmail = [i for i in mail if gen.PAYROLL not in msgs[i]["to"]]
    if refmail:
        i = refmail[0]
        to = oracle.addr(msgs[i]["to"][0])
        own = next((after["google_sheets"]["rows"][j]["cells"]["Referral ID"] for j in rows
                    if gen.norm(after["google_sheets"]["rows"][j]["cells"].get("Referrer Email")) == to), None)
        if own:
            m("referrer-own-referral-id", lambda w: w["gmail"]["messages"][i].__setitem__(
                "body_plain", msgs[i]["body_plain"] + f"\n(Your referral {own}.)"))
    inbox = [i for i, x in enumerate(after["gmail"]["messages"]) if "INBOX" in x.get("label_ids", []) and not x.get("is_read")]
    if inbox:
        m("inbound-marked-read", lambda w: w["gmail"]["messages"][inbox[0]].__setitem__("is_read", True))
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
    from reference import GMAIL, SHEETS, SS, Referral

    class Equivalent(Referral):
        """Other tool paths and wording the policy leaves open: A1-notation cell writes, a display name on the
        recipient, other email text with the same facts."""
        COL = {"Hold": "K", "Status": "L", "Bonus": "M", "Paid On": "N"}

        def set_cells(self, row_no, cells):
            for k, v in cells.items():
                self.call("PUT", f"{SHEETS}{SS}/values/Referral%20Log!{self.COL[k]}{row_no}", {"valueInputOption": "RAW"},
                          {"values": [[v]]})

        def send(self, to, subject, body):
            body = "Hello,\n\nPlease note the following.\n\n" + body.replace("Referral bonus payout ", "Payout reference: ")
            raw = f"To: Referral Automation Recipient <{to}>\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
            self.call("POST", GMAIL + "messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")})

    def solver(trigger, ctx):
        return Equivalent(trigger, ctx).run()
    grader = oracle.Grader()
    results = [harness.run_stream(gen.generate(s), solver, grader=grader) for s in seeds]
    summ = harness.summarize(results)
    return {"pass": total > 0 and not rejected and summ["passed"] == summ["triggers"], "seeds": seeds, "variants": total,
            "accepted": total - len(rejected), "rejected": rejected[:20], "operators": dict(sorted(by.items())),
            "equivalent_solver": {k: summ[k] for k in ("triggers", "passed", "clean_weeks")}}


def run_all(seeds: list[int], practice: list[int]) -> dict:
    d3 = [s for s in seeds if gen.default_difficulty(s) == "d3"]
    streams = {s: gen.generate(s) for s in seeds}
    g = {"determinism": gate_determinism(seeds[:3]),
         "leakage": gate_leakage(practice + seeds),
         "solvability": gate_solvability(practice + seeds, rebased=seeds),
         "controls": gate_controls(seeds, d3, streams),
         "traps": gate_traps([s for s in LABEL if s in seeds] or seeds),
         "mutation": gate_mutation(seeds),
         "specificity": gate_specificity(seeds)}
    return {"family": gen.FAMILY, "version": gen.VERSION, "pass": all(x["pass"] for x in g.values()), "gates": g}


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-hr-referral $0 validity gates")
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
