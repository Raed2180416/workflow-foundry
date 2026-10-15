#!/usr/bin/env python3
"""abr-ops-mailroom: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-ops-mailroom/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR]

Prints one JSON object (exit 0 only when every gate passes). No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; every world_t (after each delta) validates as WorldState and
                survives dump -> load -> dump.
  leakage       what an arm sees carries no hidden truth: the payload's cells equal the world's cells after the delta
                (a new package: the inserted row; an update: the row's key and changed cells, never a package
                Status, which is the arm's own state), payload keys are fixed per event, no truth vocabulary in payloads or world0, a package
                row arrives with the trigger (never in world0) and with an empty Status, the serve-input row holds
                only POLICY.md and the payload with no assertions, and the reference imports no host module.
  solvability   the observable-only reference passes every trigger (and every week) of the practice and dev streams,
                in carry mode and in rebased mode; generator and reference therefore agree on every effect (gate 3).
  controls      every bad control fails; null passes exactly the no-op triggers; the <= 40-line naive heuristic
                scores below 60% per trigger at d3.
  traps         each trap kind appears at least five times across the four dev label streams 610-613.
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects.
  specificity   the oracle accepts policy-neutral variants (no false rejects): a trailing period or newline on a post
                or SMS, Status in lower or upper case, another From number or SMS status, another bot name; and an
                equivalent solver that writes the Status through A1 notation and names the channel by id passes every
                trigger. (Padded cells and doubled inner spaces are not counted as neutral: AutomationBench's own
                handlers, reused unchanged, reject them.)
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
             "day_close": {"date"}}
BAD_CONTROLS = ["null", "echo", "naive", "name-only", "leave-as-skip", "no-dock", "case-notes", "no-release",
                "release-by-name", "count-sheet", "count-all", "sms-floor", "returned-skip", "no-recheck",
                "customs-first"]
TRAP_KINDS = ["T-lookalike", "T-note", "T-format", "T-repeat", "T-state"]
TRUTH_WORDS = ["traps", "truth", "expect", "decoy", "lookalike", "look-alike", "stale", "oracle", "precedence",
               "requeue", "rescan", "package.received", "customs.cleared", "employee.returned", "day.close",
               "T-repeat", "T-lookalike", "T-note", "T-format", "T-state"]


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
                ws = gen.WS_PKG if d["worksheet"] == gen.WS_TITLE[gen.WS_PKG] else gen.WS_EMP
                row = next((r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == ws and r["row_id"] == d["row_id"]), None)
                if row is None or any(row["cells"].get(k) != v for k, v in d["row"].items()):
                    problems.append(f"{tid}: the payload's cells are not the world's cells after the delta")
                if payload["event"] == "row_updated" and ws == gen.WS_PKG and "Status" in d["row"]:
                    problems.append(f"{tid}: a package update payload carries the Status (the arm's own state)")
                if payload["event"] == "new_row" and row is not None and row["cells"] != d["row"]:
                    problems.append(f"{tid}: a new package payload is not the inserted row")
            if payload["event"] == "new_row":
                if d["row"].get("Status"):
                    problems.append(f"{tid}: a new package arrives with a Status")
                if any(op.get("record", {}).get("id") in w0_rows for op in trig["delta"]):
                    problems.append(f"{tid}: the new package row is already in world0")
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
    std = {"__future__", "json", "re", "datetime", "urllib"}
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
                     "package": out["meta"]["package_trap_share"]}
    short = [k for k in TRAP_KINDS if kinds[k] < 5]
    return {"pass": not short, "seeds": seeds, "by_kind": dict(sorted(kinds.items())), "by_id": dict(sorted(ids.items())),
            "short": short, "shares": shares}


# ---------------------------------------------------------------------------------------------------------------------
# oracle mutation score
# ---------------------------------------------------------------------------------------------------------------------
def _chan(world: dict, name: str) -> str:
    return next(c["id"] for c in world["slack"]["channels"] if c["name"] == name)


def _new_msgs(before: dict, after: dict) -> list[int]:
    old = {(m["channel_id"], m["ts"]) for m in before["slack"]["messages"]}
    return [i for i, m in enumerate(after["slack"]["messages"]) if (m["channel_id"], m["ts"]) not in old]


def _new_sms(before: dict, after: dict) -> list[int]:
    old = {m["sid"] for m in before["twilio"]["sms_messages"]}
    return [i for i, m in enumerate(after["twilio"]["sms_messages"]) if m["sid"] not in old]


def _changed_rows(before: dict, after: dict) -> list[int]:
    old = {r["id"]: r for r in before["google_sheets"]["rows"]}
    return [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["id"] in old and gen.canon(r) != gen.canon(old[r["id"]])]


def _post(world: dict, channel: str, text: str, k: int):
    world["slack"]["messages"].append({"ts": f"{9000000000 + k}.000001", "channel_id": _chan(world, channel),
                                       "user_id": "USLACKBOT", "text": text, "is_bot": True, "bot_name": "Zapier"})


def _sms(world: dict, to: str, body: str, k: int):
    m = {"sid": f"SMmut{k:027d}", "account_sid": "ACmut", "from_number": gen.MAILROOM_NUMBER, "to_number": to, "body": body,
         "status": "queued", "direction": "outbound-api", "date_created": "2026-01-01T00:00:00",
         "date_updated": "2026-01-01T00:00:00", "num_segments": 1, "price": None, "price_unit": "USD"}
    world["twilio"]["sms_messages"].append(m)


OTHER_STATUS = {"routed": "Skipped", "skipped": "Routed", "held - on leave": "Held - Customs", "held - customs": "Held - On Leave"}


def mutants(before: dict, after: dict, truth: dict):
    """Single-fault mutants of a correct after-world. Yields (name, mutated_after); ops that do not apply are skipped."""
    k = [0]
    msgs, sms, rows = _new_msgs(before, after), _new_sms(before, after), _changed_rows(before, after)
    mailroom = _chan(after, gen.MAILROOM)
    posts = [i for i in msgs if after["slack"]["messages"][i]["channel_id"] == mailroom]
    route = [i for i in posts if gen.ARROW in after["slack"]["messages"][i]["text"]]
    total = [i for i in posts if after["slack"]["messages"][i]["text"].startswith("Routed today:")]

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        if fn(w) is not False:
            yield name, w

    def text_sub(i, pat, rep, field="text", coll=("slack", "messages")):
        def f(w):
            rec = w[coll[0]][coll[1]][i]
            new = re.sub(pat, rep, rec[field], count=1)
            if new == rec[field]:
                return False
            rec[field] = new
        return f
    out = []
    if posts:
        out += m("drop-post", lambda w: w["slack"]["messages"].pop(posts[0]))
        out += m("dup-post", lambda w: w["slack"]["messages"].append(dict(w["slack"]["messages"][posts[0]], ts="9100000000.000001")))
        out += m("post-channel", lambda w: w["slack"]["messages"][posts[0]].__setitem__("channel_id", _chan(w, gen.GENERAL)))
    if route:
        i = route[0]
        out += m("post-floor", text_sub(i, r"Floor (\d)", lambda mm: f"Floor {int(mm.group(1)) % 9 + 1}"))
        out += m("post-dock", text_sub(i, r"Loading Dock B", "Floor 1"))
        out += m("post-department", text_sub(i, r", ([^)]+)\)$", lambda mm: ", Facilities)"))
        out += m("post-name", text_sub(i, r"\(([^,]+),", "(A. Person,"))
        out += m("post-arrow", text_sub(i, gen.ARROW, "->"))
        out += m("post-tracking", text_sub(i, r"TRK-(\d)", lambda mm: f"TRK-{(int(mm.group(1)) + 1) % 10}"))
    if total:
        out += m("total-off-by-one", text_sub(total[0], r"(\d+)$", lambda mm: str(int(mm.group(1)) + 1)))
        out += m("total-format", text_sub(total[0], r"^Routed today: ", "Routed: "))
    if sms:
        out += m("drop-sms", lambda w: w["twilio"]["sms_messages"].pop(sms[0]))
        out += m("dup-sms", lambda w: w["twilio"]["sms_messages"].append(dict(w["twilio"]["sms_messages"][sms[0]], sid="SMdup" + "0" * 27)))
        out += m("sms-number", text_sub(sms[0], r"(\d)$", lambda mm: str((int(mm.group(1)) + 1) % 10), "to_number", ("twilio", "sms_messages")))
        out += m("sms-location", text_sub(sms[0], r"(Floor \d|Loading Dock B)$", lambda mm: "Floor 9" if mm.group(1) != "Floor 9" else "Floor 8",
                                          "body", ("twilio", "sms_messages")))
        out += m("sms-tracking", text_sub(sms[0], r"TRK-(\d)", lambda mm: f"TRK-{(int(mm.group(1)) + 1) % 10}", "body", ("twilio", "sms_messages")))
    elif route:
        to = before["google_sheets"]["rows"][0]["cells"].get("Phone") or next(
            r["cells"]["Phone"] for r in before["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_EMP)
        trk = after["slack"]["messages"][route[0]]["text"].split(" ")[0]
        out += m("extra-sms", lambda w: _sms(w, to, f"Package {trk} ready at Floor 1", k[0]))
    if rows:
        i = rows[0]

        def wrong(w):
            c = w["google_sheets"]["rows"][i]["cells"]
            c["Status"] = OTHER_STATUS.get(gen.norm(c["Status"]), "Routed")
        out += m("status-wrong", wrong)
        out += m("status-revert", lambda w: w["google_sheets"]["rows"].__setitem__(i, copy.deepcopy(
            next(r for r in before["google_sheets"]["rows"] if r["id"] == w["google_sheets"]["rows"][i]["id"]))))
        out += m("status-format", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__(
            "Status", w["google_sheets"]["rows"][i]["cells"]["Status"].replace(" - ", " (") + ")"
            if " - " in w["google_sheets"]["rows"][i]["cells"]["Status"] else w["google_sheets"]["rows"][i]["cells"]["Status"] + "!"))
        out += m("status-and-notes", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Notes", "routed by automation"))
        out += m("status-and-format", lambda w: w["google_sheets"]["rows"][i].__setitem__("background_color", "#00FF00"))
    # writes no trigger asks for
    pk = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_PKG and i not in rows]
    if pk:
        def other_row(w):
            c = w["google_sheets"]["rows"][pk[0]]["cells"]
            c["Status"] = OTHER_STATUS.get(gen.norm(c["Status"]), "Skipped")
        out += m("edit-other-package", other_row)
    emp = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_EMP]
    out += m("edit-directory", lambda w: w["google_sheets"]["rows"][emp[0]]["cells"].__setitem__("Floor", "12"))
    out += m("append-row", lambda w: w["google_sheets"]["rows"].append(dict(copy.deepcopy(w["google_sheets"]["rows"][pk[0] if pk else 0]),
                                                                           id="mutrow" + "0" * 26, row_id=999)))
    out += m("extra-mailroom-post", lambda w: _post(w, gen.MAILROOM, "Package received, routing shortly", k[0]))
    out += m("sink-post", lambda w: _post(w, gen.REVIEW, f"{truth['trigger']}: checked", k[0]))
    out += m("delete-old-message", lambda w: w["slack"]["messages"].pop(0))
    return out


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects)."""
    out = []
    msgs, sms, rows = _new_msgs(before, after), _new_sms(before, after), _changed_rows(before, after)

    def m(name, fn):
        w = copy.deepcopy(after)
        fn(w)
        out.append((name, w))
    if msgs:
        i = msgs[0]
        m("post-trailing-period", lambda w: w["slack"]["messages"][i].__setitem__("text", w["slack"]["messages"][i]["text"] + "."))
        m("post-trailing-newline", lambda w: w["slack"]["messages"][i].__setitem__("text", w["slack"]["messages"][i]["text"] + "\n"))
        m("post-bot-name", lambda w: w["slack"]["messages"][i].__setitem__("bot_name", "Mailroom Bot"))
    if sms:
        i = sms[0]
        m("sms-trailing-period", lambda w: w["twilio"]["sms_messages"][i].__setitem__("body", w["twilio"]["sms_messages"][i]["body"] + "."))
        m("sms-other-from", lambda w: w["twilio"]["sms_messages"][i].__setitem__("from_number", "+15550100299"))
        m("sms-status-sent", lambda w: w["twilio"]["sms_messages"][i].__setitem__("status", "sent"))
    if rows:
        i = rows[0]
        m("status-lower-case", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Status", w["google_sheets"]["rows"][i]["cells"]["Status"].lower()))
        m("status-upper-case", lambda w: w["google_sheets"]["rows"][i]["cells"].__setitem__("Status", w["google_sheets"]["rows"][i]["cells"]["Status"].upper()))
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
    from reference import SHEETS, SLACK, SS, Mailroom

    class Equivalent(Mailroom):
        """Writes through other tool paths the policy leaves open: A1 notation for the Status cell, the channel id."""
        def set_status(self, row_no, status):
            self.call("PUT", f"{SHEETS}{SS}/values/Incoming%20Packages!G{row_no}", {"valueInputOption": "RAW"},
                      {"values": [[status]]})

        def post(self, text, channel="mailroom"):
            chans = self.call("GET", SLACK + "conversations.list", {"limit": 200}).get("channels", [])
            cid = next(c["id"] for c in chans if c["name"] == channel)
            self.call("POST", SLACK + "chat.postMessage", None, {"channel": cid, "text": text})

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
         "leakage": gate_leakage(seeds),
         "solvability": gate_solvability(practice + seeds, rebased=seeds),
         "controls": gate_controls(seeds, d3, streams),
         "traps": gate_traps([s for s in LABEL if s in seeds] or seeds),
         "mutation": gate_mutation(seeds),
         "specificity": gate_specificity(seeds)}
    return {"family": gen.FAMILY, "version": gen.VERSION, "pass": all(x["pass"] for x in g.values()), "gates": g}


def main(argv=None):
    ap = argparse.ArgumentParser(description="abr-ops-mailroom $0 validity gates")
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
