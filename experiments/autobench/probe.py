#!/usr/bin/env python3
"""Tool-effect cards for AutomationBench's api toolset (ATTACK.md Move 8 $0 step; research/blockers-20261021/MOVE2-COMP.md).

Runs ONLY in AutomationBench's own venv, isolated mode, from a neutral working directory:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/probe.py --out <dir>

For every write route (POST, PUT, PATCH, DELETE) of every app router under automationbench.tools.api.routes, the probe
calls the route on a fork of a scratch world with synthetic arguments built from the implementing function's signature,
and diffs the world: which app state and which collections changed, which records were added, removed or modified, which
action key was recorded (apps with action-based state), and which argument values were stored, verbatim and under which
field name. One card per route. Never from rubric code and never from a task: the scratch world is WorldState() with a
fixed clock, seeded only by the probe's own create calls; automationbench.runner (which loads the task registry) and the
rubric and domains packages are blocked from import.

Two phases: (1) routes without path ids run on the empty scratch world, and the successful ones are applied in order to
build a seeded world; (2) routes with path ids run on forks of the seeded world, trying up to 6 ids found in the app's
own state. A card records the attempt that succeeded (or the last error).
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import importlib
import inspect
import json
import pkgutil
import re
import sys
import types

# Block the task registry, the rubric and the domain task builders before anything imports them.
for blocked in ("automationbench.runner", "automationbench.rubric", "automationbench.domains"):
    sys.modules[blocked] = types.ModuleType(blocked)

from automationbench.schema.world import WorldState  # noqa: E402
import automationbench.tools.api.routes as routes_pkg  # noqa: E402

WRITE = ("POST", "PUT", "PATCH", "DELETE")
NOW = dt.datetime(2026, 3, 10, 9, 0, 0, tzinfo=dt.timezone.utc)
ID_FIELD = re.compile(r"(^id$|Id$|_id$|^key$|Key$)")


def canon(o) -> str:
    return json.dumps(o, sort_keys=True, separators=(",", ":"), default=str)


def scratch_world() -> WorldState:
    w = WorldState()
    w.meta.current_time = NOW
    return w


def dump(w: WorldState) -> dict:
    return json.loads(canon(w.model_dump(mode="json")))


# ---------------------------------------------------------------------------------------------------------------------
# Routes and their implementing functions

def route_tables():
    out = []
    for m in pkgutil.iter_modules(routes_pkg.__path__):
        mod = importlib.import_module(f"{routes_pkg.__name__}.{m.name}")
        routes, handlers = getattr(mod, "_ROUTES", None), getattr(mod, "_HANDLERS", None)
        router = next((v for k, v in vars(mod).items() if k.startswith("route_") and callable(v)), None)
        if not isinstance(routes, list) or not isinstance(handlers, dict) or router is None:
            out.append({"app": m.name, "unsupported": "no _ROUTES/_HANDLERS table"})
            continue
        for method, pattern, key in routes:
            if method.upper() not in WRITE:
                continue
            out.append({"app": m.name, "method": method.upper(), "pattern": pattern, "handler": key, "fn": handlers.get(key), "module": mod, "router": router})
    return out


def impl_of(entry):
    """The implementing function a handler lambda calls, and the keyword names it passes itself."""
    fn = entry["fn"]
    if fn is None:
        return None, set()
    code = fn.__code__
    names = [n for n in code.co_names if callable(entry["module"].__dict__.get(n)) and not n.startswith("_")]
    impl = entry["module"].__dict__.get(names[0]) if names else None
    passed = set()
    for c in code.co_consts:
        if isinstance(c, tuple) and all(isinstance(x, str) for x in c):
            passed.update(c)
    return impl, passed


def synth(name: str, ann: str, i: int):
    a = (ann or "").lower()
    n = name.lower()
    tag = f"probe-{name}"
    if n == "raw":                                      # an RFC 822 message, base64url (mail send routes)
        import base64
        msg = "To: probe-to@example.com\r\nSubject: probe-subject\r\n\r\nprobe-body\r\n"
        return base64.urlsafe_b64encode(msg.encode()).decode().rstrip("=")
    if "bool" in a:
        return True
    if re.search(r"\bint\b", a):
        return 3 + i
    if "float" in a:
        return 1.5 + i
    if "list" in a or "sequence" in a:
        if "dict" in a:
            return [{"name": tag, "value": tag}]
        if "email" in n or n in ("to", "cc", "bcc", "attendees", "recipients"):
            return [f"{tag}@example.com"]
        return [tag]
    if "dict" in a or "mapping" in a:
        return {"probe": tag}
    if "email" in n or n in ("to", "from", "from_", "sender", "recipient", "cc", "bcc"):
        return f"{tag}@example.com"
    if any(k in n for k in ("date", "time", "start", "end", "due", "deadline")):
        return "2026-03-12T10:00:00Z"
    if "url" in n or "link" in n:
        return f"https://example.com/{tag}"
    return tag


def make_body(impl, passed):
    if impl is None:
        return {}, {}
    sig = inspect.signature(impl)
    full, required = {}, {}
    for i, (pname, p) in enumerate(list(sig.parameters.items())[1:]):   # skip world
        if p.kind in (p.VAR_KEYWORD, p.VAR_POSITIONAL) or pname in passed:
            continue
        v = synth(pname, str(p.annotation), i)
        full[pname] = v
        if p.default is inspect.Parameter.empty:
            required[pname] = v
    return full, required


def fill_path(pattern: str, ids):
    """A string the route pattern matches, with capture group i replaced by ids[i] (re._parser's AST, sampled)."""
    import re._parser as sp
    from re._constants import (LITERAL, NOT_LITERAL, IN, MAX_REPEAT, MIN_REPEAT, SUBPATTERN, BRANCH, ANY, AT, CATEGORY,
                               NEGATE, RANGE, CATEGORY_DIGIT, POSSESSIVE_REPEAT)
    ids = list(ids)

    def one(items):
        out = []
        for op, av in items:
            if op == LITERAL:
                out.append(chr(av))
            elif op == NOT_LITERAL:
                out.append("m" if chr(av) != "m" else "n")
            elif op == ANY:
                out.append("x")
            elif op == AT:
                pass
            elif op == IN:
                if any(o == NEGATE for o, _ in av):
                    out.append("me")
                else:
                    o, v = av[0]
                    out.append(chr(v) if o == LITERAL else chr(v[0]) if o == RANGE else "1" if v == CATEGORY_DIGIT else "x")
            elif op in (MAX_REPEAT, MIN_REPEAT, POSSESSIVE_REPEAT):
                lo, hi, sub = av
                piece = one(sub)
                out.append(piece if piece == "me" else piece * max(lo, 1))
            elif op == SUBPATTERN:
                gid, _, _, sub = av
                if gid is not None and gid - 1 < len(ids):
                    out.append(str(ids[gid - 1]))
                else:
                    out.append(one(sub))
            elif op == BRANCH:
                out.append(one(av[1][0]))
            elif op == CATEGORY:
                out.append("1" if av == CATEGORY_DIGIT else "x")
        return "".join(out)

    return one(sp.parse(pattern))


def n_groups(pattern: str) -> int:
    return re.compile(pattern).groups


# ---------------------------------------------------------------------------------------------------------------------
# World diff

def by_id(xs):
    """{id: record} when every item is a dict with a unique scalar `id`, else None."""
    if not xs or not all(isinstance(x, dict) and isinstance(x.get("id"), (str, int)) and not isinstance(x.get("id"), bool) for x in xs):
        return None if xs else {}
    m = {x["id"]: x for x in xs}
    return m if len(m) == len(xs) else None


def diff(a, b, path=(), out=None, depth=0):
    if out is None:
        out = []
    if a == b:
        return out
    if isinstance(a, dict) and isinstance(b, dict) and depth < 6:
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append(("add", path + (k,), b[k]))
            elif k not in b:
                out.append(("remove", path + (k,), a[k]))
            else:
                diff(a[k], b[k], path + (k,), out, depth + 1)
        return out
    if isinstance(a, list) and isinstance(b, list) and depth < 6:
        ia, ib = by_id(a), by_id(b)
        if ia is not None and ib is not None:
            # records with ids are matched by id, so an update is a change inside one record, not a remove plus an add
            for k in [k for k in ib if k not in ia]:
                out.append(("add-item", path, ib[k]))
            for k in [k for k in ia if k not in ib]:
                out.append(("remove-item", path, ia[k]))
            for k in [k for k in ib if k in ia]:
                diff(ia[k], ib[k], path + (f"#{k}",), out, depth + 1)
            return out
        ka = {canon(x) for x in a}
        kb = {canon(x) for x in b}
        for x in b:
            if canon(x) not in ka:
                out.append(("add-item", path, x))
        for x in a:
            if canon(x) not in kb:
                out.append(("remove-item", path, x))
        return out
    out.append(("change", path, b))
    return out


def leaves(v, prefix=()):
    if isinstance(v, dict):
        for k, x in v.items():
            yield from leaves(x, prefix + (k,))
    elif isinstance(v, list):
        for x in v:
            yield from leaves(x, prefix + ("[]",))
    else:
        yield prefix, v


def summarise(before, after, args):
    d = diff(before, after)
    d = [x for x in d if x[1][:1] != ("meta",)]
    apps = sorted({x[1][0] for x in d if x[1]})
    colls = {}
    changed_records = set()
    for op, p, v in d:
        key = ".".join(str(s) for s in p[:2]) if len(p) >= 2 else ".".join(str(s) for s in p)
        c = colls.setdefault(key, {"add": 0, "remove": 0, "change": 0})
        rec = next((i for i, s in enumerate(p) if isinstance(s, str) and s.startswith("#")), None)
        if rec is not None:                              # a field inside a matched record: one change per record
            if p[:rec + 1] not in changed_records:
                changed_records.add(p[:rec + 1])
                c["change"] += 1
            continue
        c["add" if op in ("add", "add-item") else "remove" if op in ("remove", "remove-item") else "change"] += 1
    # action keys recorded (apps with action-based state: <app>.actions.<action_key>)
    actions = []
    for op, p, v in d:
        if len(p) >= 3 and p[1] == "actions":
            stored = []
            vals = v if isinstance(v, list) else [v]
            for rec in vals:
                if isinstance(rec, dict) and isinstance(rec.get("params"), dict):
                    stored.append(sorted(rec["params"].keys()))
            actions.append({"app": p[0], "action_key": p[2], "op": op, "params": stored[0] if stored else None})
    # verbatim storage: which argument values reappear in the changed state, under which field
    verbatim = {}
    flat = []
    for op, p, v in d:
        if op in ("remove", "remove-item"):
            continue
        for lp, lv in leaves(v):
            flat.append((p + lp, lv))
    for an, av in args.items():
        vals = [av] if not isinstance(av, list) else av
        hits = set()
        for x in vals:
            if not isinstance(x, (str, int, float)) or isinstance(x, bool):
                continue
            for fp, fv in flat:
                if fv == x or (isinstance(fv, list) and x in fv):
                    hits.add(str(fp[-1]) if fp else "?")
        if hits:
            verbatim[an] = sorted(hits)
    return {"apps": apps, "collections": colls, "actions": actions, "verbatim": verbatim, "changes": len(d)}


def is_error(resp: str):
    try:
        o = json.loads(resp)
    except Exception:
        return False, None
    if isinstance(o, dict) and ("error" in o or "errors" in o):
        e = o.get("error") or o.get("errors")
        return True, (json.dumps(e)[:240] if not isinstance(e, str) else e[:240])
    return False, None


_TYPEERR = (re.compile(r"got multiple values for (?:keyword )?argument '(\w+)'"), re.compile(r"unexpected keyword argument '(\w+)'"))
_MISSING = re.compile(r"missing \d+ required (?:positional|keyword-only) arguments?: (.+)$")


def repair(body, err):
    """A body adjusted after an error, or None: a TypeError from the implementing function, or an API message that
    names a field it does not accept ("Unknown name 'x'", dropped together with its plain-text siblings) or the field
    that carries the content ("... in 'raw' ...", added with a synthetic value)."""
    if not err:
        return None
    if "validation error" in err:
        # pydantic: one line per failing field location ("priority", "items.0.name"), each followed by an indented reason;
        # drop those fields (a synthetic value outside a Literal or enum) and keep the rest of the arguments
        lines = err.splitlines()
        locs = {lines[i].strip().split(".")[0] for i in range(1, len(lines) - 1)
                if lines[i] and not lines[i].startswith(" ") and lines[i + 1].startswith("  ")}
        b = {k: v for k, v in body.items() if k not in locs}
        if b != body:
            return b
    if not err.startswith("TypeError"):
        b = dict(body)
        for name in re.findall(r"Unknown name '(\w+)'", err):
            for k in (name, "text", "body", "html"):
                b.pop(k, None)
        for name in re.findall(r"in '(\w+)' \(", err):
            b.setdefault(name, synth(name, "str", 0))
        return b if b != body else None
    for rx in _TYPEERR:
        m = rx.search(err)
        if m and m.group(1) in body:
            b = dict(body)
            b.pop(m.group(1))
            return b
    m = _MISSING.search(err)
    if m:
        b = dict(body)
        for name in re.findall(r"'(\w+)'", m.group(1)):
            b.setdefault(name, f"probe-{name}")
        return b if b != body else None
    return None


def call(entry, world, path, body):
    try:
        resp = entry["router"](world, entry["method"], path, {}, body)
        return (resp if isinstance(resp, str) else json.dumps(resp, default=str)), None
    except Exception as e:  # noqa: BLE001 - a probe records every failure
        return None, f"{type(e).__name__}: {str(e)[:4000]}"


def candidate_ids(state: dict):
    """[(id, collection path)] of id-like string fields in an app's state."""
    ids, seen = [], set()
    for p, v in leaves(state):
        if p and isinstance(v, str) and v and ID_FIELD.search(str(p[-1])) and v not in seen:
            seen.add(v)
            ids.append((v, "/".join(str(x) for x in p[:-1]).lower()))
    return ids


def ranked(ids, hint: str, limit=8):
    """Ids whose collection path shares a word with the route (pattern, handler), first."""
    words = {w.lower().rstrip("s") for w in re.findall(r"[A-Za-z]{3,}", hint)}

    def score(item):
        return -sum(1 for w in words if w and w in item[1])
    return [v for v, _ in sorted(ids, key=score)[:limit]]


ID_PARAM = re.compile(r"(id$|Id$|_id$|^channel$|^list$|^board$|^campaign$|^calendar$|^spreadsheet|^thread|^ticket$|^conversation$)", re.I)


def probe(entry, base_world, ids_by_app):
    impl, passed = impl_of(entry)
    full, required = make_body(impl, passed)
    hint = f"{entry['pattern']} {entry['handler']}"
    pool = ranked(ids_by_app.get(entry["app"], []), hint)
    k = n_groups(entry["pattern"])
    pools = [[]] if k == 0 else [[i] * k for i in (pool or ["probe-id"])]
    bodies = [full] + ([required] if required != full else [])
    # id-like body fields filled from the app's own state (a post needs an existing channel, a card an existing list)
    if pool:
        for b in list(bodies):
            idb = {n: (pool[0] if not isinstance(v, list) else [pool[0]]) for n, v in b.items() if ID_PARAM.search(n)}
            if idb:
                bodies.append({**b, **idb})
    last = None
    for ids in pools:
        for body0 in bodies:
            body = body0
            for _ in range(8):
                w = base_world.model_copy(deep=True)
                before = dump(w)
                path = fill_path(entry["pattern"], ids)
                resp, exc = call(entry, w, path, copy.deepcopy(body))
                err, why = (True, exc) if exc else is_error(resp)
                after = dump(w)
                s = summarise(before, after, {**body, **({f"path[{i}]": v for i, v in enumerate(ids)} if ids else {})})
                last = {"path": path, "ids": ids, "body": body, "error": (why or "")[:240] if err else None, "effect": s, "response": (resp or "")[:300]}
                if not err and s["changes"]:
                    return {**last, "ok": True, "world": w}
                fixed = repair(body, exc or (why if err else None))
                if fixed is None:
                    break
                body = fixed
    return {**(last or {}), "ok": False, "world": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    entries = route_tables()
    base = scratch_world()
    seeded = scratch_world()
    live = [x for x in entries if "unsupported" not in x]
    done = {}

    def ids_now():
        out = {}
        for app, state in dump(seeded).items():
            if app != "meta":
                out[app] = candidate_ids(state)
        for e in live:                                   # routers named unlike their state field
            out.setdefault(e["app"], out.get(e["app"].replace("_", ""), []))
        return out

    # Rounds: each probes the routes not yet probed successfully, on forks of the seeded world (round 1: routes without
    # path ids on the empty world); every success is also applied to the seeded world, so later rounds find entities.
    for rnd in (1, 2, 3):
        ids_by_app = ids_now()
        for e in sorted(live, key=lambda x: n_groups(x["pattern"])):
            key = (e["app"], e["method"], e["pattern"])
            if done.get(key, (None, {}))[1].get("ok"):
                continue
            r = probe(e, base if rnd == 1 and n_groups(e["pattern"]) == 0 else seeded, ids_by_app)
            done[key] = (e, {**r, "round": rnd})
            # only pure creations seed the shared world: an archive, delete or update would change what later probes see
            if r["ok"] and all(c["remove"] == 0 and c["change"] == 0 for c in r["effect"]["collections"].values()):
                call(e, seeded, r["path"], copy.deepcopy(r["body"]))
    cards = [(e, r, r["round"]) for e, r in done.values()]
    out = []
    for e, r, phase in cards:
        impl, passed = impl_of(e)
        out.append({
            "route": f"{e['app']}.{e['handler']}", "app": e["app"], "method": e["method"], "pattern": e["pattern"],
            "impl": getattr(impl, "__name__", None), "params": list(inspect.signature(impl).parameters)[1:] if impl else None,
            "pathParams": sorted(passed), "phase": phase, "ok": r.get("ok", False), "error": r.get("error"),
            "path": r.get("path"), "body": r.get("body"), "effect": r.get("effect"), "response": r.get("response"),
        })
    unsupported = [x["app"] for x in entries if "unsupported" in x]
    norm = lambda s: re.sub(r"[^a-z0-9]", "", str(s).lower())
    ok = [c for c in out if c["ok"]]
    renamed, renamed_norm, stored_any = [], [], 0
    for c in ok:
        pairs = [(p, f) for p, fs in (c["effect"]["verbatim"] or {}).items() if not p.startswith("path[") for f in fs if f != "[]"]
        if pairs:
            stored_any += 1
        mism = sorted({f"{p}->{f}" for p, f in pairs if p != f and not any(q == p for q, g in pairs if g == p)})
        if mism:
            renamed.append({"route": c["route"], "renames": mism})
        if any(norm(p) != norm(f) for p, f in pairs if not any(norm(g) == norm(p) for q, g in pairs if q == p)):
            renamed_norm.append(c["route"])
    summary = {"routes": len(out), "ok": len(ok), "apps": len({c["app"] for c in out}), "unsupported": unsupported,
               "noChange": sum(1 for c in out if not c["ok"] and not c["error"]),
               "withActions": sum(1 for c in ok if c["effect"]["actions"]),
               "actionKeys": len({(c["app"], a["action_key"]) for c in ok for a in c["effect"]["actions"]}),
               "withVerbatim": stored_any, "renamedExact": len(renamed), "renamedBeyondCase": len(renamed_norm),
               "renamedExamples": renamed[:25], "sideEffectsOnOtherApps": sum(1 for c in ok if len(c["effect"]["apps"]) > 1)}
    import os
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "cards.json"), "w") as f:
        json.dump({"evidence": "development, $0: AutomationBench api routes probed on a scratch world (no task, no rubric)", "summary": summary, "cards": out}, f, indent=1, default=str)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
