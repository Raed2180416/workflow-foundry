#!/usr/bin/env python3
"""abr-sup-routing: the $0 validity gates of RECURRING-DESIGN §3.11, runnable inside AutomationBench's venv:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/families/abr-sup-routing/gates.py \
        [--seeds 610-614] [--practice 601-609] [--out HOSTDIR]

Prints one JSON object (exit 0 only when every gate passes). No model is called. The gates:
  determinism   two generations of a seed give identical sha256 for world0, payloads, triggers, truth and end;
                different seeds give different streams; every world_t (after each delta) validates as WorldState and
                survives dump -> load -> dump.
  leakage       what an arm sees carries no hidden truth: a new ticket's payload equals the ticket the delta inserted
                (and its requester's email the contact's), a person's change and a Customer Tiers change equal the
                world after the delta, payload keys are fixed per event, no truth vocabulary in payloads or world0, a
                new ticket arrives with the trigger (never in world0), the serve-input row holds only POLICY.md and the
                payload with no assertions, and the reference imports no host module.
  solvability   the observable-only reference passes every trigger (and every week) of the practice and dev streams,
                in carry mode and in rebased mode; generator and reference therefore agree on every effect (gate 3).
  controls      every bad control fails; null passes exactly the no-op triggers; the <= 40-line naive heuristic
                scores below 60% per trigger at d3.
  traps         each trap kind appears at least five times across the four dev label streams 610-613.
  mutation      the oracle flags >= 95% of single-fault mutants of the reference's effects.
  specificity   the oracle accepts policy-neutral variants (no false rejects): a trailing period or newline, other
                letter case or extra spaces in a note or post, another bot name; and an equivalent solver that sets
                the group with PATCH, adds the note through /conversations and names the channel by id passes every
                trigger.
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
DATA_KEYS = {"ticket_created": {"ticket", "requester_email"},
             "ticket_updated": {"ticket_id", "changed", "group_id", "updated_by"},
             "row_updated": {"spreadsheet_id", "worksheet", "row_id", "row", "changed"},
             "day_close": {"date"}}
TICKET_KEYS = {"id", "subject", "description", "status", "priority", "requester_id", "group_id", "tags", "created_at"}
BAD_CONTROLS = ["null", "echo", "naive", "substring-company", "domain-company", "contains-hold", "ignore-hold",
                "no-release", "ignore-effective", "desc-area", "tag-order", "priority-only", "any-number",
                "count-mentions", "route-assigned", "release-assigned", "route-not-open", "count-all-notes",
                "held-today", "public-note", "stale-hold", "slack-authority"]
TRAP_KINDS = ["T-lookalike", "T-note", "T-format", "T-repeat", "T-stale", "T-authority", "T-state"]
TRUTH_WORDS = ["traps", "truth", "expect", "decoy", "lookalike", "look-alike", "oracle", "effective-future",
               "no-tier-yet", "cue-nonpremium", "count-noise", "assigned-held", "person-assigned", "held-count",
               "ticket.created", "tier.changed", "ticket.assigned", "day.close", "T-repeat", "T-lookalike", "T-note",
               "T-format", "T-state", "T-stale", "T-authority"]


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
        w0_tickets = {t["id"] for t in w["freshdesk"]["tickets"]}
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
            if payload["event"] == "ticket_created":
                t = d["ticket"]
                rec = next((x for x in w["freshdesk"]["tickets"] if x["id"] == t["id"]), None)
                if set(t) != TICKET_KEYS or rec is None or any(gen.canon(rec[k]) != gen.canon(v) for k, v in t.items()):
                    problems.append(f"{tid}: the ticket payload is not the inserted ticket")
                if t["id"] in w0_tickets:
                    problems.append(f"{tid}: the new ticket is already in world0")
                ct = next((c for c in w["freshdesk"]["contacts"] if rec and c["id"] == rec["requester_id"]), None)
                if ct is None or ct["email"] != d["requester_email"]:
                    problems.append(f"{tid}: requester_email is not the requester's email")
                if rec is not None and rec["notes"]:
                    problems.append(f"{tid}: a new ticket arrives with notes")
            elif payload["event"] == "ticket_updated":
                rec = next((x for x in w["freshdesk"]["tickets"] if x["id"] == d["ticket_id"]), None)
                if rec is None or rec["group_id"] != d["group_id"]:
                    problems.append(f"{tid}: the person's change is not in the world")
            elif payload["event"] == "row_updated":
                row = next((r for r in w["google_sheets"]["rows"] if r["worksheet_id"] == gen.WS_TIERS and r["row_id"] == d["row_id"]), None)
                if row is None or any(row["cells"].get(k) != v for k, v in d["row"].items()):
                    problems.append(f"{tid}: the payload's cells are not the world's cells after the delta")
                if set(d["row"]) - {"Company"} != set(d["changed"]):
                    problems.append(f"{tid}: the row payload carries more than the key and the changed cells")
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
    std = {"__future__", "json", "re", "urllib"}
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
                if x in gen.CONTEXT_LABELS:
                    continue
                kinds[gen.TRAP_KIND[x]] += 1
                ids[x] += 1
        shares[s] = {"difficulty": out["meta"]["difficulty"], "trigger": out["meta"]["trigger_trap_share"],
                     "ticket": out["meta"]["ticket_trap_share"]}
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


def _routed(before: dict, after: dict) -> list[int]:
    """Indices of tickets in `after` that gained a note in this trigger."""
    old = {t["id"]: {n["id"] for n in t["notes"]} for t in before["freshdesk"]["tickets"]}
    return [i for i, t in enumerate(after["freshdesk"]["tickets"]) if t["id"] in old and any(n["id"] not in old[t["id"]] for n in t["notes"])]


def _post(world: dict, channel: str, text: str, k: int):
    world["slack"]["messages"].append({"ts": f"{9000000000 + k}.000001", "channel_id": _chan(world, channel),
                                       "user_id": "USLACKBOT", "text": text, "is_bot": True, "bot_name": "Zapier"})


def _note(body: str, k: int, private: bool = True) -> dict:
    return {"id": f"9{k:09d}", "body": body, "private": private, "created_at": "2026-01-01T00:00:00"}


OTHER_GROUP = {"grp_api": "grp_senior_api", "grp_senior_api": "grp_api", "grp_billing": "grp_senior_billing",
               "grp_senior_billing": "grp_billing", "grp_general": "grp_senior_general",
               "grp_senior_general": "grp_general", "grp_senior_integrations": "grp_general"}
OTHER_RULE = {"Enterprise": "Premium complex", "Premium complex": "Enterprise", "Non-senior": "Premium complex",
              "General fallback": "Unknown tier", "Unknown tier": "General fallback"}


def mutants(before: dict, after: dict, truth: dict):
    """Single-fault mutants of a correct after-world. Yields (name, mutated_after); ops that do not apply are skipped."""
    k = [0]
    msgs, routed = _new_msgs(before, after), _routed(before, after)
    routing = _chan(after, gen.ROUTING)
    posts = [i for i in msgs if after["slack"]["messages"][i]["channel_id"] == routing]
    tickets0 = {t["id"]: t for t in before["freshdesk"]["tickets"]}

    def m(name, fn):
        w = copy.deepcopy(after)
        k[0] += 1
        if fn(w) is not False:
            return [(name, w)]
        return []

    def last_note(w, i):
        return w["freshdesk"]["tickets"][i]["notes"][-1]

    def sub_note(i, pat, rep):
        def f(w):
            n = last_note(w, i)
            new = re.sub(pat, rep, n["body"], count=1)
            if new == n["body"]:
                return False
            n["body"] = new
        return f

    def sub_post(i, pat, rep):
        def f(w):
            rec = w["slack"]["messages"][i]
            new = re.sub(pat, rep, rec["text"], count=1)
            if new == rec["text"]:
                return False
            rec["text"] = new
        return f
    out = []
    if routed:
        i = routed[0]
        tid = after["freshdesk"]["tickets"][i]["id"]
        out += m("route-drop-group", lambda w: w["freshdesk"]["tickets"][i].__setitem__("group_id", tickets0[tid]["group_id"]))
        out += m("route-wrong-group", lambda w: w["freshdesk"]["tickets"][i].__setitem__(
            "group_id", OTHER_GROUP.get(w["freshdesk"]["tickets"][i]["group_id"], "grp_general")))
        out += m("route-drop-note", lambda w: w["freshdesk"]["tickets"][i]["notes"].pop())
        out += m("route-dup-note", lambda w: w["freshdesk"]["tickets"][i]["notes"].append(dict(last_note(w, i), id="8000000001")))
        out += m("route-revert", lambda w: w["freshdesk"]["tickets"].__setitem__(i, copy.deepcopy(tickets0[tid])))
        out += m("note-queue", sub_note(i, r"grp_\w+", lambda mm: OTHER_GROUP.get(mm.group(0), "grp_general")))
        out += m("note-rule", sub_note(i, r"\((Enterprise|Premium complex|Non-senior|General fallback|Unknown tier)",
                                       lambda mm: "(" + OTHER_RULE[mm.group(1)]))
        out += m("note-area", sub_note(i, r"\+ (api|billing|integration|other)\)", lambda mm: "+ " + {"api": "billing", "billing": "api", "integration": "other", "other": "api"}[mm.group(1)] + ")"))
        out += m("note-public", lambda w: last_note(w, i).__setitem__("private", False))
        out += m("note-extra-text", lambda w: last_note(w, i).__setitem__("body", last_note(w, i)["body"] + " by the automation"))
        out += m("note-missing-rule", sub_note(i, r" \(.*\)$", ""))
        out += m("ticket-priority", lambda w: w["freshdesk"]["tickets"][i].__setitem__("priority", 4 if w["freshdesk"]["tickets"][i]["priority"] != 4 else 1))
        out += m("ticket-status", lambda w: w["freshdesk"]["tickets"][i].__setitem__("status", 3))
        out += m("ticket-tags", lambda w: w["freshdesk"]["tickets"][i]["tags"].append("routed"))
        out += m("ticket-responder", lambda w: w["freshdesk"]["tickets"][i].__setitem__("responder_id", "999"))
    if posts:
        i = posts[0]
        out += m("drop-post", lambda w: w["slack"]["messages"].pop(i))
        out += m("dup-post", lambda w: w["slack"]["messages"].append(dict(w["slack"]["messages"][i], ts="9100000000.000001")))
        out += m("post-channel", lambda w: w["slack"]["messages"][i].__setitem__("channel_id", _chan(w, gen.GENERAL)))
        out += m("post-routed-off", sub_post(i, r"routed (\d+)", lambda mm: f"routed {int(mm.group(1)) + 1}"))
        out += m("post-held-off", sub_post(i, r"held (\d+)", lambda mm: f"held {int(mm.group(1)) + 1}"))
        out += m("post-date", sub_post(i, r"^(\d{4}-\d{2}-)(\d{2})", lambda mm: f"{mm.group(1)}{int(mm.group(2)) % 28 + 1:02d}"))
        out += m("post-format", sub_post(i, r"routed (\d+), held", r"routed \1 tickets, held"))
    # writes no trigger asks for
    waiting = [i for i, t in enumerate(after["freshdesk"]["tickets"]) if t["status"] == 2 and not t["group_id"] and i not in routed]
    if waiting:
        j = waiting[0]
        out += m("route-held-ticket", lambda w: (w["freshdesk"]["tickets"][j].__setitem__("group_id", "grp_general"),
                                                 w["freshdesk"]["tickets"][j]["notes"].append(_note("routed to grp_general (General fallback)", k[0]))))
    others = [i for i, t in enumerate(after["freshdesk"]["tickets"]) if i not in routed and t["group_id"]]
    if others:
        j = others[-1]
        out += m("regroup-assigned", lambda w: w["freshdesk"]["tickets"][j].__setitem__("group_id", OTHER_GROUP.get(w["freshdesk"]["tickets"][j]["group_id"], "grp_general")))
        out += m("note-other-ticket", lambda w: w["freshdesk"]["tickets"][j]["notes"].append(_note("routed to grp_general (General fallback)", k[0])))
    olds = [(i, j) for i, t in enumerate(after["freshdesk"]["tickets"]) for j, n in enumerate(t["notes"]) if t["id"] in tickets0 and n["id"] in {x["id"] for x in tickets0[t["id"]]["notes"]}]
    if olds:
        i, j = olds[0]
        out += m("edit-old-note", lambda w: w["freshdesk"]["tickets"][i]["notes"][j].__setitem__("body", "edited"))
    tiers = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_TIERS]
    out += m("edit-tiers", lambda w: w["google_sheets"]["rows"][tiers[0]]["cells"].__setitem__("Notes", "HOLD - set by the automation"))
    conf = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["worksheet_id"] == gen.WS_QUEUE]
    out += m("edit-config", lambda w: w["google_sheets"]["rows"][conf[-1]]["cells"].__setitem__("Queue_Group_ID", "grp_api"))
    out += m("edit-contact", lambda w: w["freshdesk"]["contacts"][0].__setitem__("company_id", None))
    out += m("new-ticket", lambda w: w["freshdesk"]["tickets"].append(dict(copy.deepcopy(w["freshdesk"]["tickets"][0]), id="99999999")))
    out += m("extra-routing-post", lambda w: _post(w, gen.ROUTING, "Routing done for this ticket", k[0]))
    out += m("sink-post", lambda w: _post(w, gen.REVIEW, f"{truth['trigger']}: checked", k[0]))
    out += m("delete-old-message", lambda w: w["slack"]["messages"].pop(0))
    return out


def equivalents(before: dict, after: dict, truth: dict):
    """Policy-neutral variants of a correct after-world that the oracle must still accept (no false rejects)."""
    out = []
    msgs, routed = _new_msgs(before, after), _routed(before, after)

    def m(name, fn):
        w = copy.deepcopy(after)
        fn(w)
        out.append((name, w))
    if msgs:
        i = msgs[0]
        m("post-trailing-period", lambda w: w["slack"]["messages"][i].__setitem__("text", w["slack"]["messages"][i]["text"] + "."))
        m("post-trailing-newline", lambda w: w["slack"]["messages"][i].__setitem__("text", w["slack"]["messages"][i]["text"] + "\n"))
        m("post-bot-name", lambda w: w["slack"]["messages"][i].__setitem__("bot_name", "Routing Bot"))
        m("post-capitalized", lambda w: w["slack"]["messages"][i].__setitem__("text", w["slack"]["messages"][i]["text"].replace("routed", "Routed").replace("held", "Held")))
    if routed:
        i = routed[0]

        def note(w):
            return w["freshdesk"]["tickets"][i]["notes"][-1]
        m("note-trailing-period", lambda w: note(w).__setitem__("body", note(w)["body"] + "."))
        m("note-capitalized", lambda w: note(w).__setitem__("body", "R" + note(w)["body"][1:]))
        m("note-extra-spaces", lambda w: note(w).__setitem__("body", note(w)["body"].replace(" (", "  (") + " "))
        m("ticket-updated-at", lambda w: w["freshdesk"]["tickets"][i].__setitem__("updated_at", "2026-01-01T00:00:00"))
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
    from reference import FD, SLACK, Router

    class Equivalent(Router):
        """Writes through other tool paths the policy leaves open: PATCH for the group, /conversations for the note,
        the channel id for the post."""
        def set_group(self, ticket_id, group):
            self.call("PATCH", f"{FD}tickets/{ticket_id}", None, {"group_id": group})

        def add_note(self, ticket_id, body):
            self.call("POST", f"{FD}tickets/{ticket_id}/conversations", None, {"body": body})

        def post(self, text, channel="support-routing"):
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
    ap = argparse.ArgumentParser(description="abr-sup-routing $0 validity gates")
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
