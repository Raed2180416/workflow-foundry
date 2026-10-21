#!/usr/bin/env python3
"""abr-mkt-suppression stream harness ($0, no model): runs a code solver over generated weeks and grades every trigger.

    corpus/AutomationBench/.venv/bin/python -I harness.py <command> [--seeds 610-614] [--difficulty d2|d3] ...

Runs only inside AutomationBench's own venv (pinned by its uv.lock). Everything happens in one process: the
generator's world0 is validated as AutomationBench's WorldState; for each trigger the host-only delta is applied
through the apps' pydantic models and meta.current_time is set; the solver gets ONLY the arm-visible payload and an
`api` port whose fetch() is AutomationBench's own api_fetch on the live world (the routing behind the agent's
api_fetch tool, incl. service gating); the oracle grades world_before vs world_after against the truth.

Commands (each prints one JSON object):
  run          --solver ref|<control> [--mode carry|rebased]   per-trigger rows and per-stream summary
  controls     every control in controls.py, carry and rebased, against the same streams
  gates        determinism + round trip, leakage, solvability (ref), non-triviality (null/controls), trap coverage,
               oracle mutation score, oracle specificity; the $0 validity gates of RECURRING-DESIGN section 3.11
  mutation     oracle mutation score only
  export       --seed S --out DIR: write the generated files (host-only) for inspection

Seeds: only the practice and dev blocks (601-650) are accepted here; held-out seeds (8801+) are refused.
"""
from __future__ import annotations

import argparse
import ast
import base64
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
        from automationbench.schema.gmail import Message
        from automationbench.schema.google_sheets import Row
        from automationbench.schema.mailchimp import MailchimpSubscriber
        from automationbench.schema.world import WorldState
        from automationbench.tools.api.fetch import api_fetch
        _AB.update(World=WorldState, fetch=api_fetch, Message=Message, Row=Row, Member=MailchimpSubscriber)
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
        if kind == "append_row":
            if any(r.id == op["id"] for r in world.google_sheets.rows):
                continue
            ids = [r.row_id for r in world.google_sheets.rows if r.spreadsheet_id == op["spreadsheet_id"]
                   and r.worksheet_id == op["worksheet_id"] and isinstance(r.row_id, int)]
            world.google_sheets.rows.append(A["Row"](id=op["id"], spreadsheet_id=op["spreadsheet_id"], worksheet_id=op["worksheet_id"],
                                                     row_id=max(ids, default=1) + 1, cells=dict(op["cells"])))
        elif kind == "update_row":
            row = next(r for r in world.google_sheets.rows if r.id == op["id"])
            row.cells = dict(row.cells, **op["cells"])
        elif kind == "add_email":
            world.gmail.messages.append(A["Message"](**copy.deepcopy(op["message"])))
        elif kind == "set_member":  # a Mailchimp change made outside the automation (a preference-center re-opt-in)
            email = op["email"].strip().lower()
            m = next((x for x in world.mailchimp.subscribers if x.list_id == op["list_id"] and x.email.strip().lower() == email), None)
            if m is None:
                world.mailchimp.subscribers.append(A["Member"](id=L.member_id(email), email=email, list_id=op["list_id"],
                                                               status=op["status"], created_at=to_dt(at), updated_at=to_dt(at)))
            else:
                m.status = op["status"]
                m.updated_at = to_dt(at)
        else:
            raise ValueError(f"unknown delta op {kind}")


SOLVERS = {"ref": R.handle, **C.CONTROLS}


def run_stream(solver: str, seed: int, difficulty: str | None = None, mode: str = "carry", g: dict | None = None,
               rebase: list[dict] | None = None, keep: bool = False, fn=None) -> dict:
    g = g or G.generate(seed, difficulty)
    fn = fn or SOLVERS[solver]
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
        if k == len(g["triggers"]) - 1:  # the last daily close is the week close
            e = O.grade_end(w0, after, g["end"])
            if not e["pass"]:
                v["failed"] += [("end:" + n, d) for n, d in e["failed"]]
                v["pass"] = False
                v["outcome"] = "wrong" if v["effects"] else "miss"
            v["end_pass"] = e["pass"]
        rows.append({"taskKey": trig["trigger"], "stream": seed, "trigger": k + 1, "kind": trig["kind"], "sub": trig["sub"],
                     "truth": truth["outcome"], "traps": trig["traps"], "pass": v["pass"], "outcome": v["outcome"],
                     "score": v["score"], "calls": api.calls, "error": err,
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


def _jsonable(x):
    if isinstance(x, dict):
        return {(k if isinstance(k, (str, int, float, bool)) or k is None else " | ".join(map(str, k)) if isinstance(k, tuple) else str(k)):
                _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple, set, frozenset)):
        return [_jsonable(v) for v in x]
    return x


def _short(d, n=300):
    s = json.dumps(_jsonable(d), default=str, ensure_ascii=False)
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
    # every world_t (after each delta) validates and round-trips too
    w, ok_t = new_world(a["world0"]), True
    for t in a["triggers"]:
        apply_delta(w, t["delta"], t["at"])
        x = w.model_dump(mode="json")
        ok_t = ok_t and L.canon(new_world(x).model_dump(mode="json")) == L.canon(x)
    return {"seed": seed, "identical": ha == hb, "roundtrip": L.canon(d1) == L.canon(d2), "roundtrip_world_t": ok_t,
            "hash": ha["truth"][:16]}


FORBIDDEN = re.compile(r"\b(trap|decoy|distractor|truth|expected|look-?alike|stale|future-dated|escalate-|sub-kind|oracle|"
                       r"lookalike|boundary|plus-address|digit-domain)\b", re.I)
PAYLOAD_KEYS = {"trigger", "at", "app", "event", "data"}
DATA_KEYS = {"new_row": {"spreadsheet_id", "spreadsheet", "worksheet", "row"},
             "updated_row": {"spreadsheet_id", "spreadsheet", "worksheet", "row"},
             "new_email": {"message_id", "from", "subject", "snippet"},
             "daily_close": {"date"}}
ROW_KEYS = {L.SHEETS["requests"]["ss"]: set(L.SHEETS["requests"]["headers"]), L.SHEETS["bounces"]["ss"]: set(L.SHEETS["bounces"]["headers"])}
STD = {"__future__", "base64", "re", "datetime", "urllib", "json"}


def gate_leakage(g: dict) -> dict:
    bad = []
    for t in g["triggers"]:
        p = t["payload"]
        if set(p) != PAYLOAD_KEYS or set(p["data"]) != DATA_KEYS.get(p["event"], set()):
            bad.append(("payload-keys", t["trigger"], sorted(p), sorted(p["data"])))
        if p["event"] in ("new_row", "updated_row") and set(p["data"]["row"]) != ROW_KEYS.get(p["data"]["spreadsheet_id"]):
            bad.append(("row-keys", t["trigger"], sorted(p["data"]["row"])))
        txt = L.canon(p)
        m = FORBIDDEN.search(txt)
        if m or t["kind"] in txt or (t["sub"] not in ("email", "close") and re.search(rf"\b{re.escape(t['sub'])}\b", txt) and t["sub"] in (
                "retry", "rebounce", "second-request", "chain-first", "recent-confirm", "old-confirm", "keep-note", "premium-noam")):
            bad.append(("payload-text", t["trigger"], m.group(0) if m else t["kind"]))
        for op in t["delta"]:
            m = FORBIDDEN.search(L.canon(op))
            if m:
                bad.append(("delta-text", t["trigger"], m.group(0)))
    w = L.canon(g["world0"])
    m = FORBIDDEN.search(w)
    if m:
        bad.append(("world0-text", m.group(0), w[max(0, m.start() - 60): m.end() + 60]))
    # world0 holds no record a trigger is meant to create: no row whose id a delta appends, no message a delta adds
    w0_rows = {r["id"] for ss in g["world0"]["google_sheets"]["spreadsheets"] for ws in ss["worksheets"] for r in ws["rows"]}
    w0_msgs = {x["id"] for x in g["world0"]["gmail"]["messages"]}
    for t in g["triggers"]:
        for op in t["delta"]:
            if op["op"] == "append_row" and op["id"] in w0_rows or op["op"] == "add_email" and op["message"]["id"] in w0_msgs:
                bad.append(("world0-has-delta", t["trigger"]))
    tree = ast.parse((HERE / "reference.py").read_text())
    mods = sorted({n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else a.name.split(".")[0]
                   for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                   for a in (n.names if isinstance(n, ast.Import) else [None])} - {None})
    if set(mods) - STD:
        bad.append(("reference-imports", sorted(set(mods) - STD)))
    return {"ok": not bad, "problems": bad[:10], "reference_imports": mods}


# -- oracle mutation score: mutate a correct (reference) after-world, the oracle must flag it ---------------------------
def _new(before: dict, after: dict, path: tuple[str, str], key) -> list[int]:
    seen = {key(x) for x in before[path[0]][path[1]]}
    return [i for i, x in enumerate(after[path[0]][path[1]]) if key(x) not in seen]


def mutations(before: dict, after: dict, truth: dict) -> list[tuple[str, dict]]:
    out = []
    em = _new(before, after, ("gmail", "messages"), lambda m: m["id"])
    sl = _new(before, after, ("slack", "messages"), lambda m: (m["channel_id"], m["ts"]))
    rw = _new(before, after, ("google_sheets", "rows"), lambda r: r["id"])
    bsub = {O.mkey(m): m for m in before["mailchimp"]["subscribers"]}
    arch = [i for i, m in enumerate(after["mailchimp"]["subscribers"]) if m["status"] == "archived" and bsub[O.mkey(m)]["status"] != "archived"]
    live = [i for i, m in enumerate(after["mailchimp"]["subscribers"]) if m["status"] != "archived"]

    def mut(name, fn):
        a = copy.deepcopy(after)
        if fn(a) is not False:
            out.append((name, a))

    def subs(a):
        return a["mailchimp"]["subscribers"]
    if arch:
        mut("unarchive-one", lambda a: subs(a)[arch[0]].__setitem__("status", bsub[O.mkey(subs(a)[arch[0]])]["status"]))
        mut("unsubscribed-not-archived", lambda a: subs(a)[arch[-1]].__setitem__("status", "unsubscribed"))
    if live:
        tgt = [i for i in live if O.mkey(after["mailchimp"]["subscribers"][i])[1] in {x[1] for x in truth["expect"]["archive"]}
               or any(g.get("email", "").lower() == O.mkey(after["mailchimp"]["subscribers"][i])[1] for g in truth["assertions"]
                      if g["type"] == "mailchimp_subscriber_in_list")] or live
        mut("archive-extra", lambda a: subs(a)[tgt[0]].__setitem__("status", "archived"))
        mut("member-note", lambda a: subs(a)[tgt[-1]].__setitem__("notes", ["suppressed"]))
    if em:
        mut("drop-email", lambda a: a["gmail"]["messages"].pop(em[0]))
        mut("dup-email", lambda a: a["gmail"]["messages"].append(dict(a["gmail"]["messages"][em[0]], id="mutdup0000000001")))
        mut("cc-recipient", lambda a: a["gmail"]["messages"][em[0]].__setitem__("cc", [f"marketing-ops@{L.ORG}"]))
        mut("wrong-recipient", lambda a: a["gmail"]["messages"][em[0]].__setitem__(
            "to", [re.sub(r"@", "+x@", a["gmail"]["messages"][em[0]]["to"][0], count=1)]))
        mut("email-subject", lambda a: a["gmail"]["messages"][em[0]].__setitem__("subject", "You have been unsubscribed"))
        mut("email-body", lambda a: a["gmail"]["messages"][em[0]].update(body_plain="Done.", body_html="<p>Done.</p>"))
        # one To entry that hides a second address behind ';' (AutomationBench splits recipients on ',' only)
        mut("semicolon-cc", lambda a: a["gmail"]["messages"][em[0]].__setitem__(
            "to", [f"Subscriber <{a['gmail']['messages'][em[0]]['to'][0]}>; marketing-ops@{L.ORG}"]))
        mut("subject-case", lambda a: a["gmail"]["messages"][em[0]].__setitem__("subject", a["gmail"]["messages"][em[0]]["subject"].upper()))
        conf = [i for i in em if after["gmail"]["messages"][i]["subject"] == L.CONFIRM_SUBJECT]
        if conf:
            to = L.addr(after["gmail"]["messages"][conf[0]]["to"][0])
            for name, body in (("confirm-paraphrase", f"Hi,\n\n{to} has been unsubscribed from every one of our mailing lists.\n"),
                               ("confirm-negated", f"We have not removed {to} from all our mailing lists; it was removed from the "
                                                   f"Newsletter only and stays on the others."),
                               ("confirm-names-list", f"{to} has been removed from all our mailing lists. You stay on Product Updates.")):
                mut(name, lambda a, body=body: a["gmail"]["messages"][conf[0]].update(body_plain=body, body_html=None))
    if sl:
        mut("drop-slack", lambda a: a["slack"]["messages"].pop(sl[-1]))
        mut("dup-slack", lambda a: a["slack"]["messages"].append(dict(a["slack"]["messages"][sl[0]], ts="1999999999.000001")))
        mut("slack-count", lambda a: _sub(a["slack"]["messages"][sl[0]], "text", r"archived (\d+)", lambda m: f"archived {int(m.group(1)) + 1}"))
        mut("slack-format", lambda a: _sub(a["slack"]["messages"][sl[0]], "text", r", ", "; "))
        mut("slack-channel", lambda a: a["slack"]["messages"][sl[0]].__setitem__("channel_id", L.CHANNELS["marketing"]))
    if rw:
        mut("drop-row", lambda a: a["google_sheets"]["rows"].pop(rw[0]))
        mut("row-action", lambda a: _cell(a["google_sheets"]["rows"][rw[0]], ("Action", "Bounce ID", "Value")))
        mut("row-date", lambda a: _cell(a["google_sheets"]["rows"][rw[0]], ("Date", "Effective"), "1999-01-01"))
        mut("row-lists", lambda a: _cell(a["google_sheets"]["rows"][rw[-1]], ("Lists",), "Newsletter; Partner Offers; Product Updates"))
        mut("row-confirmation", lambda a: _cell(a["google_sheets"]["rows"][rw[-1]], ("Confirmation",), "Sent", flip=True))
        lg = [i for i in rw if O.sheet_of(after, after["google_sheets"]["rows"][i]) in ("log", "bouncelog")]
        if lg:
            mut("row-email-case", lambda a: _cell(a["google_sheets"]["rows"][lg[0]], ("Email",),
                                                  a["google_sheets"]["rows"][lg[0]]["cells"]["Email"].upper()))
        mut("dup-row", lambda a: a["google_sheets"]["rows"].append(dict(a["google_sheets"]["rows"][rw[0]], id="mutduprow0000001", row_id=9999)))
    # writes no trigger should make
    old = [i for i, r in enumerate(after["google_sheets"]["rows"]) if r["id"] in {x["id"] for x in before["google_sheets"]["rows"]}
           and O.sheet_of(after, r) in ("log", "bouncelog")]
    if old:
        mut("edit-old-log-row", lambda a: a["google_sheets"]["rows"][old[0]]["cells"].__setitem__("Email", "x@" + L.ORG))
        mut("delete-old-log-row", lambda a: a["google_sheets"]["rows"].pop(old[-1]))
    src = [i for i, r in enumerate(after["google_sheets"]["rows"]) if O.sheet_of(after, r) in ("requests", "bounces")]
    if src:
        mut("mark-source-row", lambda a: a["google_sheets"]["rows"][src[-1]]["cells"].__setitem__("Notes", "processed"))
    mut("extra-post", lambda a: a["slack"]["messages"].append({**copy.deepcopy(a["slack"]["messages"][0]), "ts": "1999999999.000002",
                                                               "channel_id": L.CHANNELS["compliance"], "text": "All clear today."}))
    mut("sink-post", lambda a: a["slack"]["messages"].append({**copy.deepcopy(a["slack"]["messages"][0]), "ts": "1999999999.000003",
                                                             "channel_id": L.CHANNELS["automation-review"], "text": "checked"}))
    # a post the solver deleted again within the trigger (a real Slack delivered it already)
    mut("post-then-delete", lambda a: a["slack"]["messages"].append({**copy.deepcopy(a["slack"]["messages"][0]), "ts": "1999999999.000004",
                                                                    "channel_id": L.CHANNELS["marketing"], "is_deleted": True,
                                                                    "text": "unsubscribe batch: " + L.canon(truth["expect"]["archive"])[:80]}))
    mut("extra-email", lambda a: a["gmail"]["messages"].append({**copy.deepcopy(a["gmail"]["messages"][0]), "id": "mutextra00000001",
                                                                "label_ids": ["SENT"], "to": [f"listdesk@bulkmail-partners.example.com"],
                                                                "subject": "Contacts restored"}))
    return out


def _sub(rec: dict, field: str, pat: str, rep):
    new = re.sub(pat, rep, rec.get(field) or "", count=1)
    if new == rec.get(field):
        return False
    rec[field] = new


def _cell(row: dict, keys: tuple, value: str | None = None, flip: bool = False):
    k = next((k for k in keys if k in row["cells"]), None)
    if k is None:
        return False
    if flip:
        row["cells"][k] = "" if str(row["cells"][k]).strip() else value
    elif value is not None:
        if row["cells"][k] == value:
            return False
        row["cells"][k] = value
    else:
        row["cells"][k] = str(row["cells"][k]) + "0" if k != "Action" else ("Skipped" if row["cells"][k] != "Skipped" else "Logged")


def gate_mutation(seeds: list[int], difficulty: str | None) -> dict:
    flagged, total, by = 0, 0, {}
    missed = []
    for s in seeds:
        g = G.generate(s, difficulty)
        world = new_world(g["world0"])
        w0 = world.model_dump(mode="json")
        last = len(g["triggers"]) - 1
        for k, (trig, truth) in enumerate(zip(g["triggers"], g["truth"])):
            apply_delta(world, trig["delta"], trig["at"])
            before = world.model_dump(mode="json")
            R.handle(copy.deepcopy(trig["payload"]), Api(world))
            after = world.model_dump(mode="json")
            for name, a in mutations(before, after, truth):
                v = O.grade_trigger(before, a, truth, trig["payload"])
                if k == last and v["pass"]:
                    v["pass"] = O.grade_end(w0, a, g["end"])["pass"]
                total += 1
                hit = not v["pass"]
                flagged += hit
                b = by.setdefault(name, [0, 0])
                b[0] += hit
                b[1] += 1
                if not hit:
                    missed.append((trig["trigger"], trig["kind"], trig["sub"], name))
    return {"score": round(flagged / max(1, total), 4), "flagged": flagged, "total": total,
            "by_mutation": {k: f"{a}/{b}" for k, (a, b) in sorted(by.items())}, "missed": missed[:12]}


# -- oracle specificity: policy-neutral variants of the reference's effects must still pass ------------------------------
class Variant(R.Suppression):
    """Policy-neutral differences: another confirmation wording and layout around POLICY.md's sentence (a lead-in on
    the same line, the sentence wrapped over two lines, no final period), display-name recipients, mixed-case list names
    in another order with a comma separator, an archive by PATCH status instead of DELETE, and other-case Event, Action
    and Confirmation values. Addresses and subjects stay as POLICY.md writes them (lower case; "exactly")."""

    def send(self, to, subject, body):
        if subject == R.CONFIRM_SUBJECT:
            body = (f"Hi there,\n\nGood news: {to} has been removed\nfrom all our mailing lists\n\n"
                    f"We are sorry to see you go.\nThe Marketing Team\n")
        else:
            body = body.replace("Hello,", "Hi there,")
        raw = (f"To: Subscriber <{to}>\r\nSubject: {subject}\r\nMIME-Version: 1.0\r\n"
               f"Content-Type: text/plain; charset=utf-8\r\n\r\n{body}")
        self.call("POST", f"{R.GMAIL}/messages/send", None, {"raw": base64.urlsafe_b64encode(raw.encode()).decode()})

    def archive(self, email, lists):
        from urllib.parse import quote
        for lid, _ in lists:
            self.call("PATCH", f"{R.MAILCHIMP}/lists/{lid}/members/{quote(email, safe='')}", None, {"status": "archived"})
        return sorted(name for _, name in lists)

    def log(self, today, email, event, action, ref, lists=(), conf=""):
        self.append(R.COMPLIANCE_LOG, {"Date": today, "Email": email, "Event": event.lower(),
                                       "Action": action.upper(), "Lists": ", ".join(sorted((x.upper() for x in lists), reverse=True)),
                                       "Confirmation": conf.upper(), "Ref": ref})


def gate_specificity(seeds: list[int], difficulty: str | None) -> dict:
    res = [run_stream("variant", s, g=G.generate(s, difficulty), fn=lambda p, api: Variant(api).handle(p)) for s in seeds]
    for r in res:
        r.pop("afters", None)
    return {"summary": summarize(res), "false_rejects": [x for r in res for x in r["rows"] if not x["pass"]][:5]}


def gate_traps(gens: list[dict]) -> dict:
    labels, kinds = Counter(), Counter()
    rates = []
    for g in gens:
        for t in g["truth"]:
            labels.update(set(t["traps"]))
            kinds.update({G.TRAP_KIND[x] for x in t["traps"]})
        rates.append({"seed": g["meta"]["seed"], "difficulty": g["meta"]["difficulty"], "n": g["meta"]["n_triggers"],
                      "event_triggers_with_trap": g["meta"]["trap_rate_events"]})
    return {"labels": dict(sorted(labels.items())), "kinds": dict(sorted(kinds.items())),
            "all_kinds_ge5": len(kinds) == 6 and all(v >= 5 for v in kinds.values()), "streams": rates}


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
        out["noop_share"] = round(sum(1 for s in seeds for t in gens[s]["truth"] if t["outcome"] == "no-op")
                                  / sum(len(gens[s]["truth"]) for s in seeds), 4)
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
        out["specificity"] = gate_specificity(seeds, a.difficulty)
    text = json.dumps(out, ensure_ascii=False, default=str)
    if a.out:
        Path(a.out).write_text(text)
    print(text)


if __name__ == "__main__":
    main()
