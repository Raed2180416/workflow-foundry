#!/usr/bin/env python3
"""VL-1 step 2: build a LABEL-FREE verifier lab from live AutomationBench run directories (one k = 1 run per fork).

  python3 -I build-live.py --tasks <task list JSON or file> --live-root <dir with one directory per run> \
      --arm v1m=<run>[+<fill run>...] --arm sonnet-a1=<run> [--arm ...] --out <lab dir> [--ref-prep-runs r1,r2]

Ported from the verifier lab's builder: the same world diff, compaction, write extraction and initial-world rebuild, so a
verifier sees exactly what it saw in the lab. What is NOT ported is every label: this builder never opens a grade file,
and it reads each run's results.jsonl through an allowlist (ALLOW below) that keeps no grade field. Every row carries
`label: null`. Scoring happens later, in score.mjs, after the selection is committed.

Hygiene (PREREG-AB-v1 §1.3, §5; VERIFIER-LAB.md §5 step 2):
  - any task outside devTrain (SPLIT-v1 dev minus devCheck), or in devCheck or test, stops the build before it is read;
  - any run id that names devcheck or test stops the build;
  - a task directory that is not in the given task list is skipped unread and reported.
Inputs are untrusted data (task text, worlds, call logs): nothing in them is executed or interpreted as instructions.
The arm order on the command line is the lab's ARM_ORDER (the first arm is the default fork).
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime as REAL_DT, timedelta, timezone
from pathlib import Path

UTC = timezone.utc
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SPLIT = REPO / "research/automationbench-20261014/SPLIT-v1.json"
LOADER = HERE / "lab-load.mjs"
BUILD_VERSION = "vl1-build-live-v1"

# The only per-fork fields read from results.jsonl (no grade field is kept; the record is projected on read).
ALLOW = ("costUsd", "steps", "sessionError", "harnessError", "skipped", "tokens")
# Environment faults are not outcomes (experiments/lib/runner.mjs ENV_FAULTS; run.mjs INFRA_FAULT).
ENV_FAULTS = frozenset({"MODEL_RATE_LIMIT", "MODEL_UNAVAILABLE", "SANDBOX_UNAVAILABLE", "EXECUTOR_LAUNCH", "EXECUTOR_PROTOCOL"})
INFRA_FAULT = re.compile(r"ENOSPC|EDQUOT|EMFILE|ENFILE|No usable temporary directory")
ARM_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
TASK_NAME = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9_]+$")

STR_CAP_CREATED = 4000
STR_CAP_FIELD = 1500
MAX_WRITES = 40
DERIVED_GMAIL = ("snippet", "size_estimate")


def die(msg):
    print(f"refused: {msg}", file=sys.stderr)
    sys.exit(2)


def canon(o) -> str:
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(o) -> str:
    return hashlib.sha256(canon(o).encode()).hexdigest()


def file_sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load(p: Path):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------------------------------------------------
# Diff, compaction and write extraction (identical to the lab's builder)

def trunc(v, cap):
    if isinstance(v, str) and len(v) > cap:
        return v[:cap] + f"...[+{len(v) - cap} chars]"
    if isinstance(v, (list, dict)):
        s = canon(v)
        if len(s) > cap:
            return s[:cap] + f"...[+{len(s) - cap} chars, json]"
    return v


def empty(v):
    return v is None or v == "" or v == [] or v == {}


def compact_record(rec: dict, cap=STR_CAP_CREATED) -> dict:
    out = {}
    plain = rec.get("body_plain")
    for k, v in rec.items():
        if empty(v):
            continue
        if k in DERIVED_GMAIL:
            continue
        if k == "body_html" and isinstance(plain, str) and plain.strip():
            continue
        out[k] = compact_value(v, cap)
    return out


def compact_value(v, cap):
    if isinstance(v, str):
        return trunc(v, cap)
    if isinstance(v, dict):
        return {k: compact_value(x, cap) for k, x in v.items() if not empty(x)}
    if isinstance(v, list):
        return [compact_value(x, cap) for x in v]
    return v


REF_KEYS = ("name", "title", "subject", "email", "summary", "item_name", "first_name", "last_name", "Name", "Title",
            "Subject", "Email", "status", "channel", "spreadsheet_id", "worksheet_id", "row_number", "action_key")


def ref_of(rec: dict) -> dict:
    r = {}
    for k in REF_KEYS:
        v = rec.get(k)
        if not empty(v) and isinstance(v, (str, int, float, bool)):
            r[k] = trunc(v, 120)
        if len(r) >= 4:
            break
    return r


def field_diff(a, b, path="", out=None):
    if out is None:
        out = {}
    if isinstance(a, dict) and isinstance(b, dict):
        for k in list(a.keys()) + [k for k in b.keys() if k not in a]:
            if a.get(k) != b.get(k):
                field_diff(a.get(k), b.get(k), f"{path}.{k}" if path else str(k), out)
        return out
    out[path or "."] = [trunc(compact_value(a, STR_CAP_FIELD), STR_CAP_FIELD), trunc(compact_value(b, STR_CAP_FIELD), STR_CAP_FIELD)]
    return out


def is_id_records(lst):
    return isinstance(lst, list) and lst and all(isinstance(x, dict) and "id" in x for x in lst) \
        and len({canon(x["id"]) for x in lst}) == len(lst)


def diff_collection(app, coll, a, b, changes, stats):
    a = a if a is not None else []
    b = b if b is not None else []
    if isinstance(a, list) and isinstance(b, list):
        if (is_id_records(a) or not a) and (is_id_records(b) or not b) and (a or b):
            A = {canon(x["id"]): x for x in a}
            B = {canon(x["id"]): x for x in b}
            created = [B[k] for k in B if k not in A]
            deleted = [A[k] for k in A if k not in B]
            dsig = Counter(canon({k: v for k, v in x.items() if k != "id"}) for x in deleted)
            for x in created:
                s = canon({k: v for k, v in x.items() if k != "id"})
                if dsig.get(s):
                    stats["idDriftPairs"] += 1
                    dsig[s] -= 1
            for x in created:
                changes.append({"app": app, "coll": coll, "op": "created", "id": x["id"], "record": compact_record(x)})
            for k in A:
                if k in B and A[k] != B[k]:
                    changes.append({"app": app, "coll": coll, "op": "updated", "id": B[k]["id"], "ref": ref_of(B[k]),
                                    "fields": field_diff(A[k], B[k])})
            for x in deleted:
                changes.append({"app": app, "coll": coll, "op": "deleted", "id": x["id"], "ref": ref_of(x),
                                "record": compact_record(x, STR_CAP_FIELD)})
            return
        if all(isinstance(x, dict) for x in a + b):
            ca, cb = Counter(canon(x) for x in a), Counter(canon(x) for x in b)
            for s, n in (cb - ca).items():
                for _ in range(n):
                    changes.append({"app": app, "coll": coll, "op": "created", "id": None, "record": compact_record(json.loads(s))})
            for s, n in (ca - cb).items():
                for _ in range(n):
                    changes.append({"app": app, "coll": coll, "op": "deleted", "id": None, "record": compact_record(json.loads(s), STR_CAP_FIELD)})
            return
        changes.append({"app": app, "coll": coll, "op": "set", "from": trunc(a, STR_CAP_FIELD), "to": trunc(b, STR_CAP_FIELD)})
        return
    if isinstance(a, dict) and isinstance(b, dict):
        vals = list(a.values()) + list(b.values())
        if vals and all(isinstance(v, list) for v in vals):
            for k in list(a.keys()) + [k for k in b.keys() if k not in a]:
                if a.get(k) != b.get(k):
                    diff_collection(app, f"{coll}.{k}", a.get(k), b.get(k), changes, stats)
            return
        changes.append({"app": app, "coll": coll, "op": "updated", "id": None, "ref": {}, "fields": field_diff(a, b)})
        return
    changes.append({"app": app, "coll": coll, "op": "set", "from": trunc(a, STR_CAP_FIELD), "to": trunc(b, STR_CAP_FIELD)})


def world_diff(w0: dict, w1: dict):
    changes, stats = [], Counter()
    for app in list(w0.keys()) + [k for k in w1.keys() if k not in w0]:
        if app == "meta":
            if w0.get("meta") != w1.get("meta"):
                changes.append({"app": "meta", "coll": "meta", "op": "updated", "id": None, "ref": {}, "fields": field_diff(w0.get("meta"), w1.get("meta"))})
            continue
        a, b = w0.get(app), w1.get(app)
        if a == b:
            continue
        if isinstance(a, dict) and isinstance(b, dict):
            for coll in list(a.keys()) + [k for k in b.keys() if k not in a]:
                if a.get(coll) != b.get(coll):
                    diff_collection(app, coll, a.get(coll), b.get(coll), changes, stats)
        else:
            changes.append({"app": app, "coll": "", "op": "set", "from": trunc(a, STR_CAP_FIELD), "to": trunc(b, STR_CAP_FIELD)})
    summary = defaultdict(lambda: Counter())
    for c in changes:
        summary[c["app"]][c["op"]] += 1
    action_records = [{"app": c["app"], "action": c["coll"].split(".", 1)[1], "id": c["id"],
                       "params": c["record"].get("params"), "created_at": c["record"].get("created_at")}
                      for c in changes if c["op"] == "created" and c["coll"].startswith("actions.")]
    return {"summary": {k: dict(v) for k, v in sorted(summary.items())}, "nChanges": len(changes), "changes": changes,
            "actionRecords": action_records}, stats


def write_calls(calls_path: Path):
    """The agent's own non-read calls with the head of each result (its action log, not world state)."""
    out, n = [], 0
    if not calls_path.exists():
        return None
    with open(calls_path, encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            for c, r in zip(d.get("calls", []), d.get("results", [])):
                name = c.get("name")
                if name in ("api_search", "base64_encode"):
                    continue
                method = url = body = None
                if name == "api_fetch":
                    try:
                        a = json.loads(c.get("arguments") or "{}")
                    except Exception:  # noqa: BLE001
                        a = {"raw": c.get("arguments")}
                    method = a.get("method")
                    if method == "GET":
                        continue
                    url, body = a.get("url"), a.get("body")
                else:
                    body = c.get("arguments")
                n += 1
                if len(out) < MAX_WRITES:
                    rs = r if isinstance(r, str) else canon(r)
                    out.append({"step": d.get("step"), "tool": name, "method": method, "url": url,
                                "body": trunc(body, 500) if body is not None else None,
                                "looksError": rs.lstrip().startswith('{"error"') or rs.startswith("Error") or rs.startswith("'"),
                                "result": trunc(rs, 200)})
    return {"n": n, "shown": len(out), "calls": out}


def pipeline_selfcheck(pipe: Path):
    """A code-owned pipeline's own final checks (its postconditions file and last check round)."""
    checks = sorted(pipe.glob("check-*.json"), key=lambda x: int(x.stem.split("-")[1])) if pipe.is_dir() else []
    if not checks:
        return None
    final = load(checks[-1])
    pcs = {}
    pcp = pipe / "postconditions.json"
    if pcp.exists():
        for pc in load(pcp).get("pcs", []):
            pcs[pc.get("id")] = pc
    rows = []
    for c in final:
        pc = pcs.get(c.get("id"), {})
        rows.append({"id": c.get("id"), "hard": c.get("hard"), "type": c.get("type"), "pass": c.get("pass"), "by": c.get("by"),
                     "polarity": pc.get("polarity"), "statement": trunc(pc.get("statement"), 400), "evidence": trunc(c.get("evidence"), 400)})
    return {"kind": "a1c-checks", "checkRound": len(checks) - 1, "nChecks": len(rows),
            "nFail": sum(1 for r in rows if r["pass"] is False), "nUndecided": sum(1 for r in rows if r["pass"] not in (True, False)),
            "hardFail": sum(1 for r in rows if r["hard"] and r["pass"] is not True), "allPass": all(r["pass"] is True for r in rows),
            "checks": rows}


def prose_selfcheck(fork_dir: Path):
    p = fork_dir / "ledger.md"
    if not p.exists():
        return None
    text = p.read_text(encoding="utf-8", errors="replace")
    ver = None
    i = text.find("## Verification")
    if i >= 0:
        j = text.find("\n## ", i + 5)
        ver = text[i: j if j > 0 else len(text)].strip()
    return {"kind": "a1-prose-ledger", "verification": trunc(ver, 2500) if ver else None, "ledger": trunc(text, 6000), "ledgerChars": len(text)}


# ---------------------------------------------------------------------------------------------------------------------
# Initial-world rebuild for a run whose prep was rewritten after its sessions ran (identical to the lab's builder)

def reconstruct_world0(w0: dict, w1: dict, generated: dict, ref_w0: dict | None = None):
    gen = [g for g in (generated.get("uuid") or []) if isinstance(g, str)]
    gen_set = set(gen)

    def session_made(i):
        s = str(i)
        return s in gen_set or any(g.startswith(s) or g.replace("-", "").startswith(s) for g in gen)

    w0 = json.loads(json.dumps(w0))
    st = Counter()
    for app, A in w0.items():
        if app == "meta" or not isinstance(A, dict) or not isinstance(w1.get(app), dict):
            continue
        for coll, L0 in A.items():
            L1 = w1[app].get(coll)
            if not (isinstance(L0, list) and isinstance(L1, list) and is_id_records(L0) and (is_id_records(L1) or not L1)):
                continue
            ids0 = {canon(x["id"]) for x in L0}
            ids1 = {canon(x["id"]) for x in L1}
            orphans = [x for x in L1 if canon(x["id"]) not in ids0 and not session_made(x["id"])]
            missing = [x for x in L0 if canon(x["id"]) not in ids1]
            if not orphans or not missing:
                continue
            by_content = defaultdict(list)
            for x in missing:
                by_content[canon({k: v for k, v in x.items() if k != "id"})].append(x)
            left = []
            for o in orphans:
                c = by_content.get(canon({k: v for k, v in o.items() if k != "id"}))
                if c:
                    c.pop(0)["id"] = o["id"]
                    st["rekeyedByContent"] += 1
                else:
                    left.append(o)
            still = [x for x in missing if canon(x["id"]) not in {canon(o["id"]) for o in orphans}]
            nk = ("spreadsheet_id", "worksheet_id", "row_id")
            by_key = defaultdict(list)
            for x in still:
                if all(k in x for k in nk):
                    by_key[tuple(canon(x[k]) for k in nk)].append(x)
            for o in left:
                key = tuple(canon(o.get(k)) for k in nk) if all(k in o for k in nk) else None
                c = by_key.get(key) if key else None
                if c and len(c) == 1:
                    c.pop(0)["id"] = o["id"]
                    st["rekeyedByNaturalKey"] += 1
                else:
                    st["unresolvedOrphans"] += 1
    if ref_w0 is not None:
        restore_generated_values(w0, ref_w0, w1, st)
    rebase_setup_clock(w0, w1, generated, st)
    return w0, st


def restore_generated_values(w0: dict, ref: dict, w1: dict, st: Counter):
    def walk(x0, xr, x1, holder, key):
        if isinstance(x0, dict) and isinstance(xr, dict):
            for k in list(x0.keys()):
                walk(x0[k], xr.get(k), x1.get(k) if isinstance(x1, dict) else None, x0, k)
        elif isinstance(x0, list) and isinstance(xr, list):
            if len(x0) != len(xr):
                st["genShapeMismatch"] += 1
                return
            if is_id_records(x0):
                m = {canon(y["id"]): y for y in x1 if isinstance(y, dict) and "id" in y} if isinstance(x1, list) else {}
                for i, y in enumerate(x0):
                    walk(y, xr[i], m.get(canon(y["id"])), x0, i)
            else:
                for i, y in enumerate(x0):
                    walk(y, xr[i], x1[i] if isinstance(x1, list) and i < len(x1) else None, x0, i)
        elif x0 != xr and not isinstance(x0, (dict, list)) and _ts(x0) is None:
            if key == "id":
                return
            if x1 is not None and not isinstance(x1, (dict, list)):
                if holder[key] != x1:
                    holder[key] = x1
                    st["genRecovered"] += 1
            else:
                st["genUnresolved"] += 1

    walk(w0, ref, w1, None, None)


def _ts(v):
    if isinstance(v, str) and len(v) >= 19 and v[4:5] == "-" and v[10:11] == "T":
        try:
            d = REAL_DT.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=UTC)
        except ValueError:
            return None
    return None


def _fmt_like(orig: str, d) -> str:
    s = d.astimezone(UTC).replace(tzinfo=None).isoformat(timespec="microseconds" if "." in orig else "seconds")
    return s + ("Z" if orig.endswith("Z") else ("+00:00" if orig.endswith("+00:00") else ""))


def rebase_setup_clock(w0: dict, w1: dict, generated: dict, st: Counter):
    wall0, wall1 = generated.get("wall0"), generated.get("wall1")
    if not wall0 or not wall1:
        st["noWallClock"] += 1
        return
    lo = REAL_DT.fromtimestamp(wall1, UTC)
    hi = lo + timedelta(hours=12)
    start = REAL_DT.fromtimestamp(wall0, UTC)
    pending, deltas = [], []

    def walk(x0, x1, holder, key):
        if isinstance(x0, dict):
            for k in list(x0.keys()):
                walk(x0[k], x1.get(k) if isinstance(x1, dict) else None, x0, k)
        elif isinstance(x0, list):
            if is_id_records(x0):
                m = {canon(y["id"]): y for y in x1 if isinstance(y, dict) and "id" in y} if isinstance(x1, list) else {}
                for i, y in enumerate(x0):
                    walk(y, m.get(canon(y["id"])), x0, i)
            else:
                for i, y in enumerate(x0):
                    walk(y, x1[i] if isinstance(x1, list) and i < len(x1) else None, x0, i)
        else:
            d0 = _ts(x0)
            if d0 is None or not (lo <= d0 <= hi):
                return
            d1 = _ts(x1)
            if d1 is not None and d1 < start:
                holder[key] = x1
                deltas.append((d0 - d1).total_seconds())
                st["tsRecovered"] += 1
            else:
                pending.append((holder, key, x0, d0))

    walk(w0, w1, None, None)
    if pending:
        if deltas:
            off = timedelta(seconds=sorted(deltas)[len(deltas) // 2])
            for holder, key, orig, d0 in pending:
                holder[key] = _fmt_like(orig, d0 - off)
                st["tsShiftedApprox"] += 1
        else:
            st["tsUnresolved"] += len(pending)


# ---------------------------------------------------------------------------------------------------------------------

def read_task_list(p: Path):
    text = p.read_text(encoding="utf-8")
    try:
        j = json.loads(text)
        tasks = j["tasks"] if isinstance(j, dict) else j
    except json.JSONDecodeError:
        tasks = [x.strip() for x in re.split(r"[\s,]+", text) if x.strip()]
    if not isinstance(tasks, list) or not tasks or not all(isinstance(t, str) and TASK_NAME.match(t) for t in tasks):
        die(f"{p}: no task list")
    return tasks


def results_allowlisted(path: Path):
    """task -> {forks: [{ALLOW fields}]}; every other field of the record is dropped as the line is read."""
    out = {}
    if not path.exists():
        return out
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            d = json.loads(line)
            out[d["task"]] = {"forks": [{k: fk.get(k) for k in ALLOW} for fk in d.get("forks", [])]}
            del d
    return out


def is_outcome(rec):
    """A recorded task-run the runner scores: not skipped, no host error, no environment fault. A session that ended on
    another error (a timeout, the session budget) is an outcome: its world is what the run left, and the headline grades it."""
    if not rec:
        return False
    f = (rec.get("forks") or [{}])[0]
    if f.get("skipped") or f.get("harnessError") or f.get("sessionError") in ENV_FAULTS:
        return False
    return True


def fault_kind(rec):
    if not rec:
        return "no record"
    f = (rec.get("forks") or [{}])[0]
    if f.get("skipped"):
        return "skipped"
    if f.get("sessionError") in ENV_FAULTS or INFRA_FAULT.search(str(f.get("harnessError") or "")):
        return "environment fault"
    if f.get("harnessError"):
        return "host error"
    if f.get("sessionError"):
        return f"session error {f.get('sessionError')}"
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--live-root", required=True)
    ap.add_argument("--arm", action="append", required=True, help="name=run[+run...]; later runs supersede earlier ones")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ref-prep-runs", default=None, help="independent prepares for the initial-world rebuild (default: the other runs, in arm order)")
    ap.add_argument("--split", default=str(SPLIT))
    a = ap.parse_args()

    live_root = Path(a.live_root).resolve()
    out = Path(a.out).resolve()
    if out == live_root or live_root in out.parents:
        die("--out must not lie inside the live root")
    split = load(Path(a.split))
    dev, test, devcheck = set(split["dev"]), set(split["test"]), set(split["devCheck"])
    devtrain = dev - devcheck
    tasks = read_task_list(Path(a.tasks))
    bad = [t for t in tasks if t not in devtrain or t in test or t in devcheck]
    if bad:
        die(f"{len(bad)} listed task(s) outside devTrain")
    task_set = set(tasks)
    list_sha = hashlib.sha256(json.dumps(sorted(tasks), separators=(",", ":")).encode()).hexdigest()

    arms = []
    for spec in a.arm:
        if "=" not in spec:
            die(f"--arm {spec}: expected name=run[+run]")
        name, runs = spec.split("=", 1)
        runs = [r for r in runs.split("+") if r]
        if not ARM_NAME.match(name) or not runs:
            die(f"--arm {spec}: bad arm name or no run")
        if name in [x[0] for x in arms]:
            die(f"arm {name} given twice")
        for r in runs:
            if not RUN_ID.match(r) or "devcheck" in r.lower() or "test" in r.lower():
                die(f"run id {r} refused")
            if not (live_root / r / "host").is_dir():
                die(f"run {r}: no host directory under the live root")
        arms.append((name, runs))
    all_runs = [r for _, rs in arms for r in rs]
    if len(set(all_runs)) != len(all_runs):
        die("a run belongs to two arms")
    ref_runs = [r for r in (a.ref_prep_runs.split(",") if a.ref_prep_runs else all_runs) if r]
    for r in ref_runs:
        if not RUN_ID.match(r) or "devcheck" in r.lower() or "test" in r.lower():
            die(f"reference run id {r} refused")

    # Every task directory of every run is checked against the split before anything is read.
    report = {"skippedNotListed": [], "missingWorld": [], "notOutcome": [], "idDriftRows": [], "world0Rebuilt": []}
    for r in all_runs:
        for sub in ("host", "prep"):
            d = live_root / r / sub
            if not d.is_dir():
                continue
            for t in os.listdir(d):
                if not TASK_NAME.match(t):
                    continue
                if t not in devtrain or t in test or t in devcheck:
                    die(f"run {r} holds a task outside devTrain")
                if t not in task_set and sub == "host":
                    report["skippedNotListed"].append([r, t])

    if out.exists():
        shutil.rmtree(out)
    (out / "worlds").mkdir(parents=True)
    rows = []
    sources = {}
    for arm, runs in arms:
        for i, run in enumerate(runs):
            res = results_allowlisted(live_root / run / "results.jsonl")
            launch = live_root / run / "launch.json"
            if launch.exists():
                L = load(launch)
                sources[run] = {"arm": arm, "model": L.get("model"), "harness": L.get("harness"), "effort": L.get("effort"),
                                "budgetUsd": L.get("budgetUsd"), "runnerSha256": L.get("runnerSha256"), "dateNote": L.get("dateNote"),
                                "launchSha256": file_sha(launch)}
            else:
                sources[run] = {"arm": arm, "launch": None}
            later = set()
            for r2 in runs[i + 1:]:
                later |= {t for t in os.listdir(live_root / r2 / "host") if t in task_set}
            for task in sorted(t for t in os.listdir(live_root / run / "host") if t in task_set):
                fork_dir = live_root / run / "host" / task / "fork-0"
                fw = fork_dir / "final-world.json"
                rec = res.get(task)
                if not fw.exists():
                    report["missingWorld"].append([run, task, fault_kind(rec)])
                    continue
                prep = live_root / run / "prep" / task
                W0 = load(prep / "world0.json")
                prompt = load(prep / "prompt.json")
                meta = load(prep / "meta.json")
                if W0.get("task") != task:
                    die(f"world0 task mismatch in run {run}")
                w0, w1 = W0["world"], load(fw)
                rebuilt = None
                if (prep / "world0.json").stat().st_mtime > fw.stat().st_mtime:
                    # the prep was rewritten after this session ran: its setup-generated values are not the session's
                    ref = None
                    for rr in ref_runs:
                        rp0 = live_root / rr / "prep" / task / "world0.json"
                        if rr != run and rp0.exists():
                            ref = load(rp0)["world"]
                            break
                    w0, rst = reconstruct_world0(w0, w1, load(fork_dir / "generated.json"), ref)
                    rebuilt = dict(rst)
                    report["world0Rebuilt"].append([run, task, rebuilt])
                outcome = is_outcome(rec)
                if not outcome:
                    report["notOutcome"].append([run, task, fault_kind(rec)])
                diff, dstats = world_diff(w0, w1)
                if dstats["idDriftPairs"]:
                    report["idDriftRows"].append([run, task, dstats["idDriftPairs"]])
                pipe = fork_dir / "pipeline"
                selfc = pipeline_selfcheck(pipe) if pipe.is_dir() else prose_selfcheck(fork_dir)
                wd = out / "worlds" / run
                wd.mkdir(exist_ok=True)
                with gzip.open(wd / f"{task}.world0.json.gz", "wt", encoding="utf-8") as f:
                    json.dump(w0, f, separators=(",", ":"))
                with gzip.open(wd / f"{task}.final.json.gz", "wt", encoding="utf-8") as f:
                    json.dump(w1, f, separators=(",", ":"))
                fork = (rec or {}).get("forks", [{}])[0] if rec else {}
                rows.append({
                    "rowId": f"{run}/{task}",
                    "task": task,
                    "domain": task.split(".", 1)[0],
                    "arm": arm,
                    "run": run,
                    "outcome": outcome,
                    "canonical": outcome and task not in later,
                    "fold": None,
                    "prompt": {"system": prompt["system"], "user": prompt["user"]},
                    "today": (w0.get("meta") or {}).get("current_time"),
                    "services": (w0.get("meta") or {}).get("allowed_services"),
                    "world0Sha256": sha(w0),
                    "finalSha256": sha(w1),
                    "worlds": {"initial": f"worlds/{run}/{task}.world0.json.gz", "final": f"worlds/{run}/{task}.final.json.gz",
                               "initialRebuilt": rebuilt},
                    "diff": diff,
                    "writes": write_calls(fork_dir / "calls.jsonl"),
                    "selfCheck": selfc,
                    "steps": fork.get("steps"),
                    "costUsd": fork.get("costUsd"),
                    "tokens": fork.get("tokens"),
                    "source": {"contract_sha256": W0.get("contract_sha256"), "example_id": meta.get("example_id")},
                    "label": None,
                })
    with open(out / "dataset.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    order = [name for name, _ in arms]
    src = LOADER.read_text(encoding="utf-8")
    marker = "export const ARM_ORDER = [];"
    if src.count(marker) != 1:
        die("lab-load.mjs has no ARM_ORDER marker")
    (out / "load.mjs").write_text(src.replace(marker, f"export const ARM_ORDER = {json.dumps(order)};"), encoding="utf-8")
    canon_rows = [r for r in rows if r["canonical"]]
    per_task = defaultdict(set)
    for r in canon_rows:
        per_task[r["task"]].add(r["arm"])
    manifest = {
        "version": BUILD_VERSION,
        "evidence": "label-free: no grade file opened; results.jsonl read through the allowlist " + ",".join(ALLOW),
        "tasks": len(tasks), "listSha256": list_sha,
        "armOrder": order, "arms": {name: runs for name, runs in arms}, "refPrepRuns": ref_runs, "sources": sources,
        "rows": len(rows), "canonicalRows": len(canon_rows),
        "canonicalByArm": dict(Counter(r["arm"] for r in canon_rows)),
        "tasksWithoutCandidate": sorted(task_set - set(per_task)),
        "tasksMissingArm": {name: sorted(t for t in task_set if name not in per_task.get(t, set())) for name in order},
        "report": report,
        "builder": {"file": "experiments/autobench/verifier/live/build-live.py", "sha256": file_sha(Path(__file__).resolve()),
                    "loaderSha256": file_sha(LOADER)},
        "datasetSha256": file_sha(out / "dataset.jsonl"),
    }
    with open(out / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps({k: manifest[k] for k in ("tasks", "listSha256", "armOrder", "rows", "canonicalRows", "canonicalByArm", "tasksWithoutCandidate")}
                     | {"missingWorld": len(report["missingWorld"]), "notOutcome": len(report["notOutcome"]), "world0Rebuilt": len(report["world0Rebuilt"]),
                        "skippedNotListed": len(report["skippedNotListed"])}, indent=1))


if __name__ == "__main__":
    main()
