#!/usr/bin/env python3
"""abr-sales-dealdesk stream harness ($0, no model): runs a code solver over generated weeks and grades every trigger.

    corpus/AutomationBench/.venv/bin/python -I harness.py <command> [--seeds 610-614] [--difficulty d2|d3] ...

Runs only inside AutomationBench's own venv (pinned by its uv.lock). Everything happens in one process: the
generator's world0 is validated as AutomationBench's WorldState; for each trigger the host-only delta is applied
through the app's pydantic models and meta.current_time is set; the solver gets ONLY the arm-visible payload and an
`api` port whose fetch() is AutomationBench's own api_fetch on the live world (the routing behind the agent's
api_fetch tool, incl. service gating); the oracle grades world_before vs world_after against the truth.

Commands (each prints one JSON object):
  run          --solver ref|<control> [--mode carry|rebased]   per-trigger rows and per-stream summary
  controls     every control in controls.py, carry and rebased, against the same streams
  gates        determinism + round trip, leakage, solvability (ref), non-triviality (null/controls), trap coverage,
               oracle mutation score; the $0 validity gates of RECURRING-DESIGN section 3.11
  mutation     oracle mutation score only
  export       --seed S --out DIR: write the generated files (host-only) for inspection

Seeds: only the practice and dev blocks (601-650) are accepted here; held-out seeds (8801+) are refused.
"""
from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import controls as C  # noqa: E402
import gen as G  # noqa: E402
import lib as L  # noqa: E402
import oracle as O  # noqa: E402
import reference as R  # noqa: E402

ALLOWED_SEEDS = range(601, 651)
_AB = {}


def ab():
    if not _AB:
        from automationbench.schema.docusign import Envelope
        from automationbench.schema.gmail import Message
        from automationbench.schema.google_sheets import Row
        from automationbench.schema.world import WorldState
        from automationbench.tools.api.fetch import api_fetch
        _AB.update(World=WorldState, fetch=api_fetch, Envelope=Envelope, Message=Message, Row=Row)
    return _AB


def parse_seeds(s: str) -> list[int]:
    out = []
    for part in s.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a), int(b) + 1))
        elif part:
            out.append(int(part))
    bad = [x for x in out if x not in ALLOWED_SEEDS]
    if bad:
        raise SystemExit(f"seeds {bad} refused: this harness runs practice/dev seeds 601-650 only (held-out stays sealed)")
    return out


def to_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class Api:
    """The solver's only port to the world: AutomationBench's api_fetch (JSON-string arguments, as the tool takes)."""

    def __init__(self, world):
        self._world = world
        self.calls = 0

    def fetch(self, method: str, url: str, params=None, body=None):
        self.calls += 1
        p = params if params is None or isinstance(params, str) else json.dumps(params)
        b = body if body is None or isinstance(body, str) else json.dumps(body)
        out = ab()["fetch"](self._world, method, url, p, b)
        try:
            return json.loads(out)
        except ValueError:
            return {"raw": out}


def new_world(d: dict):
    return ab()["World"](**copy.deepcopy(d))


def apply_delta(world, delta: list[dict], at: str):
    """Host-only world changes that make the trigger's event true, through the apps' own pydantic models."""
    A = ab()
    world.meta.current_time = to_dt(at)
    for op in delta:
        kind = op["op"]
        if kind == "upsert_envelope":
            env = A["Envelope"](**copy.deepcopy(op["envelope"]))
            envs = world.docusign.envelopes
            idx = next((i for i, e in enumerate(envs) if e.id == env.id), None)
            if idx is None:
                envs.append(env)
            else:
                envs[idx] = env
        elif kind == "set_opportunity":
            rec = world.salesforce.get_by_id("opportunities", op["id"])
            if rec is not None:
                for k, v in op["fields"].items():
                    setattr(rec, k, v)
                rec.last_modified_date = to_dt(at)
        elif kind == "append_row":
            if any(r.id == op["id"] for r in world.google_sheets.rows):
                continue
            ids = [r.row_id for r in world.google_sheets.rows if r.spreadsheet_id == op["spreadsheet_id"]
                   and r.worksheet_id == op["worksheet_id"] and isinstance(r.row_id, int)]
            world.google_sheets.rows.append(A["Row"](id=op["id"], spreadsheet_id=op["spreadsheet_id"], worksheet_id=op["worksheet_id"],
                                                     row_id=max(ids, default=1) + 1, cells=dict(op["cells"])))
        elif kind == "add_email":
            world.gmail.messages.append(A["Message"](**copy.deepcopy(op["message"])))
        else:
            raise ValueError(f"unknown delta op {kind}")


SOLVERS = {"ref": R.handle, **C.CONTROLS}


def run_stream(solver: str, seed: int, difficulty: str | None = None, mode: str = "carry", g: dict | None = None,
               rebase: list[dict] | None = None, keep: bool = False) -> dict:
    g = g or G.generate(seed, difficulty)
    fn = SOLVERS[solver]
    world = new_world(g["world0"])
    w0 = world.model_dump(mode="json")
    rows, afters = [], []
    t0 = time.time()
    for k, (trig, truth) in enumerate(zip(g["triggers"], g["truth"])):
        if mode == "rebased" and k > 0:
            world = new_world(rebase[k - 1])
        apply_delta(world, trig["delta"], trig["at"])
        before = world.model_dump(mode="json")
        api = Api(world)
        err = None
        try:
            fn(copy.deepcopy(trig["payload"]), api)
        except Exception as e:  # noqa: BLE001  a crash is a row with error, never a dropped trigger
            err = f"{type(e).__name__}: {e}"[:400]
        after = world.model_dump(mode="json")
        v = O.grade_trigger(before, after, truth, trig["payload"])
        if trig["kind"] == "week.close":
            e = O.grade_end(w0, after, g["end"])
            if not e["pass"]:
                v["failed"] += [("end:" + n, d) for n, d in e["failed"]]
                v["pass"] = False
                v["outcome"] = "wrong" if v["effects"] else "miss"
            v["end_pass"] = e["pass"]
        rows.append({"taskKey": trig["trigger"], "stream": seed, "trigger": k + 1,
                     "kind": trig["kind"], "sub": trig["sub"], "truth": truth["outcome"], "traps": trig["traps"],
                     "pass": v["pass"], "outcome": v["outcome"], "score": v["score"], "calls": api.calls, "error": err,
                     "failed": [[n, _short(d)] for n, d in v["failed"]][:8]})
        if keep or solver == "ref":
            afters.append(after)
    first_fail = next((r["trigger"] for r in rows if not r["pass"]), None)
    res = {"solver": solver, "seed": seed, "difficulty": g["meta"]["difficulty"], "mode": mode, "rows": rows,
           "n": len(rows), "passed": sum(r["pass"] for r in rows), "clean_week": all(r["pass"] for r in rows),
           "first_failure": first_fail, "seconds": round(time.time() - t0, 1),
           "outcomes": dict(Counter(r["outcome"] for r in rows))}
    if keep or solver == "ref":
        res["afters"] = afters
    return res


def _short(d, n=300):
    s = json.dumps(d, default=str, ensure_ascii=False)
    return s if len(s) <= n else s[:n] + "..."


def summarize(results: list[dict]) -> dict:
    rows = [r for res in results for r in res["rows"]]
    by_kind = {}
    for r in rows:
        k = by_kind.setdefault(r["kind"], [0, 0])
        k[0] += r["pass"]
        k[1] += 1
    trap_rows = [r for r in rows if r["traps"]]
    return {"triggers": len(rows), "passed": sum(r["pass"] for r in rows),
            "pass_rate": round(sum(r["pass"] for r in rows) / max(1, len(rows)), 4),
            "clean_weeks": sum(res["clean_week"] for res in results), "weeks": len(results),
            "by_kind": {k: f"{a}/{b}" for k, (a, b) in sorted(by_kind.items())},
            "trapped_pass_rate": round(sum(r["pass"] for r in trap_rows) / max(1, len(trap_rows)), 4),
            "outcomes": dict(Counter(r["outcome"] for r in rows)),
            "errors": sum(1 for r in rows if r["error"]), "max_calls": max((r["calls"] for r in rows), default=0)}


# ---------------------------------------------------------------------------------------------- gates
def gate_determinism(seed: int, difficulty: str | None) -> dict:
    a = G.generate(seed, difficulty)
    b = G.generate(seed, difficulty)
    h = lambda g: {k: hashlib.sha256(L.canon(g[k]).encode()).hexdigest() for k in ("world0", "triggers", "truth", "end")}  # noqa: E731
    ha, hb = h(a), h(b)
    d1 = new_world(a["world0"]).model_dump(mode="json")
    d2 = new_world(d1).model_dump(mode="json")
    return {"seed": seed, "identical": ha == hb, "roundtrip": L.canon(d1) == L.canon(d2), "hash": ha["truth"][:16]}


FORBIDDEN = re.compile(r"\b(trap|decoy|distractor|truth|expected|look-?alike|stale|future-dated|escalate-|sub-kind|oracle)\b", re.I)
PAYLOAD_KEYS = {"trigger", "at", "app", "event", "data"}
DATA_KEYS = {"envelope_completed": {"event_id", "envelope_id", "deal_name", "amount", "currency", "completed_at"},
             "opportunity_stage_changed": {"event_id", "opportunity_id", "opportunity_name", "old_stage", "new_stage", "changed_by", "changed_at"},
             "new_row": {"spreadsheet_id", "spreadsheet", "worksheet", "row"},
             "new_email": {"message_id", "from", "subject", "snippet"},
             "week_close": {"week_start", "week_end"}}


def gate_leakage(g: dict) -> dict:
    bad = []
    for t in g["triggers"]:
        p = t["payload"]
        if set(p) != PAYLOAD_KEYS or set(p["data"]) != DATA_KEYS.get(p["event"], set()):
            bad.append(("payload-keys", t["trigger"], sorted(p), sorted(p["data"])))
        txt = L.canon(p)
        if FORBIDDEN.search(txt) or t["kind"] in txt or t["sub"] in ("retry", "won-after-signed") and t["sub"] in txt:
            bad.append(("payload-text", t["trigger"], FORBIDDEN.search(txt).group(0) if FORBIDDEN.search(txt) else t["kind"]))
        for op in t["delta"]:
            if FORBIDDEN.search(L.canon(op)):
                bad.append(("delta-text", t["trigger"], FORBIDDEN.search(L.canon(op)).group(0)))
    w = L.canon(g["world0"])
    m = FORBIDDEN.search(w)
    if m:
        bad.append(("world0-text", m.group(0), w[max(0, m.start() - 60): m.end() + 60]))
    # the reference imports nothing but the standard library
    tree = ast.parse((HERE / "reference.py").read_text())
    mods = sorted({n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else a.name.split(".")[0]
                   for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                   for a in (n.names if isinstance(n, ast.Import) else [None])} - {None})
    std = {"__future__", "base64", "re", "datetime", "decimal", "urllib", "json"}
    if set(mods) - std:
        bad.append(("reference-imports", sorted(set(mods) - std)))
    return {"ok": not bad, "problems": bad[:10], "reference_imports": mods}


# -- oracle mutation score: mutate a correct (reference) after-world, the oracle must flag it ---------------------------
def _new(before: dict, after: dict, path: tuple[str, str], key) -> list[int]:
    """Indexes of records in `after` that are not in `before`, matched as a multiset by `key`."""
    seen = Counter(key(x) for x in before[path[0]][path[1]])
    out = []
    for i, x in enumerate(after[path[0]][path[1]]):
        k = key(x)
        if seen[k] > 0:
            seen[k] -= 1
        else:
            out.append(i)
    return out


def mutations(before: dict, after: dict, truth: dict) -> list[tuple[str, dict]]:
    out = []
    em = _new(before, after, ("gmail", "messages"), lambda m: m["id"])
    sl = _new(before, after, ("slack", "messages"), L.canon)
    rw = _new(before, after, ("google_sheets", "rows"), lambda r: r["id"])

    def mut(name, fn):
        a = copy.deepcopy(after)
        if fn(a) is not False:
            out.append((name, a))
    if em:
        mut("drop-email", lambda a: a["gmail"]["messages"].pop(em[0]))
        mut("dup-email", lambda a: a["gmail"]["messages"].append(dict(a["gmail"]["messages"][em[0]], id="mutdup0000000001")))
        exp = set((truth["expect"].get("closing") or {}).get("recipients", []))
        other = next(x for x in L.TEAM_MAILBOXES if x not in exp)
        mut("wrong-recipient", lambda a: a["gmail"]["messages"][em[0]].__setitem__("to", [other] + a["gmail"]["messages"][em[0]]["to"][1:]))
        mut("extra-recipient", lambda a: a["gmail"]["messages"][em[0]].__setitem__("cc", [other]))
        mut("email-amount-format", lambda a: _sub(a["gmail"]["messages"][em[0]], "body_plain", r"\$(\d{1,3}),(\d{3})", r"$\1\2"))
        mut("email-subject", lambda a: a["gmail"]["messages"][em[0]].__setitem__("subject", "Deal closed"))
        mut("email-subject-case", lambda a: a["gmail"]["messages"][em[0]].__setitem__("subject", L.SUBJECT.lower()))
        cl = truth["expect"].get("closing") or {}
        if cl.get("tier"):
            tier = cl["tier"]
            wrong_tier = next(t for t in O.TIER_WORDS if t != tier)
            far = "Strategic" if tier != "Strategic" else "Enterprise"
            mut("email-other-tier", lambda a: _sub(a["gmail"]["messages"][em[0]], "body_plain", r"$", f"\nSalesforce tier: {wrong_tier}"))
            # hedges (review of v1.1.0): another tier in lower case next to the right one, and a capitalised one far from 'tier'
            mut("email-other-tier-lower", lambda a: _sub(a["gmail"]["messages"][em[0]], "body_plain", rf"Tier: {re.escape(tier)}\n",
                                                         f"Tier: {tier} (previously {wrong_tier.lower()})\n"))
            mut("email-other-tier-far", lambda a: _sub(a["gmail"]["messages"][em[0]], "body_plain", r"$",
                                                       f"\nNote: Salesforce still has this account classified as {far}."))
            # no tier line: the deal's name may contain the tier word ('... - Enterprise Platform'), which does not count
            mut("email-omit-tier", lambda a: _sub(a["gmail"]["messages"][em[0]], "body_plain", rf"Tier: {re.escape(tier)}\n", ""))
            mut("email-name-case", lambda a: _sub(a["gmail"]["messages"][em[0]], "body_plain", re.escape(cl["name"]), cl["name"].lower()))
            mut("email-other-amount", lambda a: _sub(a["gmail"]["messages"][em[0]], "body_plain", r"$", "\nList price: $1,000"))
    if sl:
        mut("drop-slack", lambda a: a["slack"]["messages"].pop(sl[-1]))
        mut("dup-slack", lambda a: a["slack"]["messages"].append(dict(a["slack"]["messages"][sl[0]], ts="1999999999.000001")))
        mut("slack-amount", lambda a: _sub(a["slack"]["messages"][sl[0]], "text", r"\$(\d)", r"$9\1"))
        mut("slack-format", lambda a: _sub(a["slack"]["messages"][sl[0]], "text", r" \| ", " / "))
        mut("slack-tier", lambda a: _sub(a["slack"]["messages"][sl[0]], "text", r"\| (Enterprise|Mid-Market|SMB|Strategic|Partner|Growth) \|", "| Gold |"))
        mut("slack-channel", lambda a: a["slack"]["messages"][sl[0]].__setitem__("channel_id", L.CHANNELS["team-updates"]))
    if rw:
        mut("drop-row", lambda a: a["google_sheets"]["rows"].pop(rw[0]))
        mut("row-cell", lambda a: _cell(a["google_sheets"]["rows"][rw[0]]))
        mut("dup-row", lambda a: a["google_sheets"]["rows"].append(dict(a["google_sheets"]["rows"][rw[0]], id="mutduprow0000001", row_id=9999)))
    c = truth["expect"].get("closing")
    if c:
        def stage(a, v):
            o = next(o for o in a["salesforce"]["opportunities"] if o["id"] == c["opp"])
            o["stage_name"] = v
        mut("stage-wrong", lambda a: stage(a, "Closed Lost"))

        def undo_desc(a):
            o = next(o for o in a["salesforce"]["opportunities"] if o["id"] == c["opp"])
            b = next(o for o in before["salesforce"]["opportunities"] if o["id"] == c["opp"])
            o["description"] = b.get("description")
        mut("drop-description", undo_desc)

        def opp_set(a, field, value):
            o = next(o for o in a["salesforce"]["opportunities"] if o["id"] == c["opp"])
            if field == "description":
                v = (o.get("description") or "").replace("\nAnnounced in #deal-wins", " Announced in #deal-wins")
                if v == o.get("description"):
                    return False
                value = v
            o[field] = value
        mut("description-same-line", lambda a: opp_set(a, "description", None))
        mut("sf-closedate", lambda a: opp_set(a, "close_date", "2020-01-01T00:00:00"))
        mut("sf-probability", lambda a: opp_set(a, "probability", 3))
        if c["set_fields"]:
            def amount(a):
                o = next(o for o in a["salesforce"]["opportunities"] if o["id"] == c["opp"])
                o["amount"] = (o["amount"] or 0) + 500.0
            mut("sf-amount", amount)
    # writes no trigger should make
    old = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["id"] in {x["id"] for x in before["google_sheets"]["rows"]}
           and O.sheet_of(after, r) == "log" and r["cells"].get("Status") == "Announced"]
    if old and not truth["expect"].get("retract"):
        mut("edit-old-log-row", lambda a: a["google_sheets"]["rows"][old[0]]["cells"].__setitem__("USD", "1"))
    mut("extra-post", lambda a: a["slack"]["messages"].append({**copy.deepcopy(a["slack"]["messages"][0]), "ts": "1999999999.000002",
                                                               "channel_id": L.CHANNELS["deal-wins"], "text": "Big win today!"}))

    def other_opp(a):
        o = next(o for o in a["salesforce"]["opportunities"] if o["id"] != (c or {}).get("opp"))
        o["description"] = (o.get("description") or "") + " touched"
    mut("extra-sf-write", other_opp)
    mut("post-then-delete", lambda a: a["slack"]["messages"].append({**copy.deepcopy(a["slack"]["messages"][0]), "ts": "1999999999.000004",
                                                                    "channel_id": L.CHANNELS["exec-wins"], "text": "CLOSED: test", "is_deleted": True}))
    mut("sink-post", lambda a: a["slack"]["messages"].append({**copy.deepcopy(a["slack"]["messages"][0]), "ts": "1999999999.000003",
                                                             "channel_id": L.CHANNELS["automation-review"], "text": "checked"}))
    # moving inbox mail is a write, not housekeeping (review of v1.1.0): trash or archive the newest inbox email
    inbox = [i for i, m in enumerate(after["gmail"]["messages"]) if "INBOX" in (m.get("label_ids") or [])]
    if inbox:
        def relabel(a, add):
            m = a["gmail"]["messages"][inbox[-1]]
            m["label_ids"] = [x for x in m["label_ids"] if x != "INBOX"] + add
        mut("trash-mail", lambda a: relabel(a, ["TRASH"]))
        mut("archive-mail", lambda a: relabel(a, []))
    return out


def _sub(rec: dict, field: str, pat: str, rep: str):
    new = re.sub(pat, rep, rec.get(field) or "", count=1)
    if new == rec.get(field):
        return False
    rec[field] = new
    if field == "body_plain" and rec.get("body_html"):
        rec["body_html"] = re.sub(pat, rep, rec["body_html"], count=1)


def _cell(row: dict):
    k = next((k for k in ("USD", "Tier", "Value", "Status") if k in row["cells"]), None)
    if k is None:
        return False
    row["cells"][k] = str(row["cells"][k]) + "0"


def gate_mutation(seeds: list[int], difficulty: str | None) -> dict:
    flagged, total, by = 0, 0, {}
    missed = []
    for s in seeds:
        g = G.generate(s, difficulty)
        world = new_world(g["world0"])
        w0 = world.model_dump(mode="json")
        for trig, truth in zip(g["triggers"], g["truth"]):
            apply_delta(world, trig["delta"], trig["at"])
            before = world.model_dump(mode="json")
            R.handle(copy.deepcopy(trig["payload"]), Api(world))
            after = world.model_dump(mode="json")
            for name, a in mutations(before, after, truth):
                v = O.grade_trigger(before, a, truth, trig["payload"])
                if trig["kind"] == "week.close" and v["pass"]:
                    v["pass"] = O.grade_end(w0, a, g["end"])["pass"]
                total += 1
                hit = not v["pass"]
                flagged += hit
                b = by.setdefault(name, [0, 0])
                b[0] += hit
                b[1] += 1
                if not hit:
                    missed.append((trig["trigger"], trig["kind"], name))
    return {"score": round(flagged / max(1, total), 4), "flagged": flagged, "total": total,
            "by_mutation": {k: f"{a}/{b}" for k, (a, b) in sorted(by.items())}, "missed": missed[:12]}


def gate_traps(gens: list[dict]) -> dict:
    c = Counter()
    rates = []
    for g in gens:
        for t in g["truth"]:
            c.update(set(t["traps"]))
        rates.append({"seed": g["meta"]["seed"], "difficulty": g["meta"]["difficulty"], "planted": g["meta"]["trap_rate_planted"],
                      "closings": g["meta"]["trap_rate_closings"],
                      "deal_triggers": g["meta"]["trap_rate_deal_triggers"], "n": g["meta"]["n_triggers"]})
    kinds6 = {"T-lookalike": c["lookalike-account"] + c["won-lookalike"] + c["signer-lookalike"],
              "T-stale": c["stale-hierarchy"] + c["future-hierarchy"] + c["future-fx"],
              "T-note": c["case-decoy"] + c["parent-case"],
              "T-authority": c["authority-note"] + c["authority"],
              "T-format": c["currency"] + c["euro-decimal"] + c["typed-name"] + c["envelope-amount"],
              "T-repeat": c["repeat"]}
    return {"labels": dict(sorted(c.items())), "kinds": kinds6, "all_kinds_ge5": all(v >= 5 for v in kinds6.values()), "streams": rates}


# ---------------------------------------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["run", "controls", "gates", "mutation", "export"])
    ap.add_argument("--seeds", default="610-614")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--difficulty", choices=["d1", "d2", "d3"])
    ap.add_argument("--solver", default="ref", choices=sorted(SOLVERS))
    ap.add_argument("--mode", default="carry", choices=["carry", "rebased"])
    ap.add_argument("--rows", action="store_true", help="include per-trigger rows in the output")
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.command == "export":
        parse_seeds(str(a.seed))
        meta = G.write_out(G.generate(a.seed, a.difficulty), Path(a.out))
        print(L.canon({"out": a.out, "meta": meta}))
        return
    seeds = parse_seeds(a.seeds)
    if a.command == "run":
        res = []
        for s in seeds:
            g = G.generate(s, a.difficulty)
            reb = run_stream("ref", s, g=g)["afters"] if a.mode == "rebased" else None
            r = run_stream(a.solver, s, g=g, mode=a.mode, rebase=reb)
            r.pop("afters", None)
            res.append(r)
        out = {"solver": a.solver, "mode": a.mode, "summary": summarize(res), "streams": res}  # summary over every row
        if not a.rows:
            for r in res:
                r["rows"] = [x for x in r["rows"] if not x["pass"]]
    elif a.command == "controls":
        out = {"controls": {}}
        gens = {s: G.generate(s, a.difficulty) for s in seeds}
        refs = {s: run_stream("ref", s, g=gens[s]) for s in seeds}
        out["ref"] = summarize(list(refs.values()))
        null_ok = sum(1 for s in seeds for t in gens[s]["truth"] if t["outcome"] == "no-op")
        out["noop_share"] = round(null_ok / sum(len(gens[s]["truth"]) for s in seeds), 4)
        for name in C.CONTROLS:
            row = {}
            for mode in ("carry", "rebased"):
                rs = [run_stream(name, s, g=gens[s], mode=mode, rebase=refs[s]["afters"]) for s in seeds]
                row[mode] = summarize(rs)
            out["controls"][name] = row
    elif a.command == "mutation":
        out = gate_mutation(seeds, a.difficulty)
    else:  # gates
        gens = [G.generate(s, a.difficulty) for s in seeds]
        out = {"determinism": [gate_determinism(s, a.difficulty) for s in seeds],
               "leakage": [dict(seed=g["meta"]["seed"], **gate_leakage(g)) for g in gens],
               "traps": gate_traps(gens)}
        refs = [run_stream("ref", g["meta"]["seed"], g=g) for g in gens]
        for r in refs:
            r.pop("afters", None)
        out["solvability"] = summarize(refs)
        out["solvability"]["failed_rows"] = [x for r in refs for x in r["rows"] if not x["pass"]][:10]
        nulls = [run_stream("null", g["meta"]["seed"], g=g) for g in gens]
        out["null"] = summarize(nulls)
        out["null"]["noop_share"] = round(sum(1 for g in gens for t in g["truth"] if t["outcome"] == "no-op")
                                          / sum(len(g["truth"]) for g in gens), 4)
        out["mutation"] = gate_mutation(seeds, a.difficulty)
    text = json.dumps(out, ensure_ascii=False, default=str)
    if a.out:
        Path(a.out).write_text(text)
    print(text)


if __name__ == "__main__":
    main()
