#!/usr/bin/env python3
"""Move 4 (ATTACK §6, D28): replay edited call logs through the OFFICIAL AutomationBench env and rubric, in batch, $0.

Runs ONLY inside AutomationBench's own venv, isolated mode, from a neutral working directory (like bridge.py):

    corpus/AutomationBench/.venv/bin/python -I replay_batch.py --jobs <jobs.jsonl> --out <out.jsonl> [--worlds <dir>]

One job per input line:
    {"id": str, "input": <prep input.json path>, "world0": <initial world JSON or .json.gz path, or null>,
     "steps": [{"calls": [{"name": str, "arguments": str, "orig": <the stored result string, or null>}]}]}

Per job, exactly bridge.py's Rollout: the env's own init_state + setup_state; the initial world replaced by `world0` when
given (the stored session's own initial world, or a world twin); every step's calls through the env's own env_response;
then the official rubric (create_rubric) grades the live world. Nothing of bridge.py is changed or copied: it is imported
from its path as a module (bridge.py is pinned by the A1-C manifests and the look-2 runners).

Id carry-forward. The simulated apps draw fresh ids for what a session creates (bridge.py --det record: real uuid4 and
clock values), so a stored call that names an id an earlier call created would miss on replay. For every replayed call
that carries its stored result (`orig`), the stored and the replayed result are walked in parallel; where an id-like key
(below) holds different scalar values, the stored value maps to the replayed one, and every later call's argument text is
rewritten through that map (longest stored id first). Calls a mutation inserted carry `orig: null` and add no mapping.

Output: one JSON line per job, and nothing else on stdout:
    {"id", "ok", "error", "steps", "pass", "pc", "nScored", "nPassed", "failedByClass": {class: n}, "remapped": n,
     "callErrors": n, "world0Sha", "finalSha"}
With --worlds, the initial and final worlds (<id>.world0.json.gz, <id>.final.json.gz) and the world diff computed by the
verifier lab's own differ (verifier/live/build-live.py world_diff; <id>.diff.json.gz) are written for the verifiers.

Hygiene: grader assertion texts are never written. A failed assertion is reported only as a count per generic class
(content, prohibition, flag, action-key, existence, other; the ATTACK §3 attribution classes). Those counts are labels
for scoring and never reach a verifier. Task and world text are untrusted data: nothing in them is executed.
"""
from __future__ import annotations

import argparse
import asyncio
import gzip
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRIDGE_PATH = HERE.parent.parent / "bridge.py"
DIFFER_PATH = HERE.parent / "live" / "build-live.py"
VERSION = "mutlab-replay-v1"

ID_KEY = re.compile(r"(^|_)(id|ids|uuid|ts|sid|key)$|[a-z](Id|Ids|Ts|Sid)$|^(threadId|historyId|messageId)$", re.I)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def assertion_class(t) -> str:
    """Generic class of a grader assertion TYPE name (schema vocabulary, never task text). Scoring only."""
    t = str(t or "").lower()
    if "not_" in t or t.endswith("_not") or "not_in" in t:
        return "prohibition"
    if any(k in t for k in ("contains", "body", "cell", "field", "value", "column", "title", "subject", "text")):
        return "content"
    if any(k in t for k in ("is_read", "has_tag", "has_label", "tag", "label", "starred", "archived")):
        return "flag"
    if "action" in t:
        return "action-key"
    if any(k in t for k in ("exists", "sent", "created", "posted", "scheduled", "event", "updated", "deleted")):
        return "existence"
    return "other"


def parse_json(s):
    if not isinstance(s, str):
        return s
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


def id_pairs(o, n, key=None, out=None):
    """Stored -> replayed values at the same path under id-like keys."""
    if out is None:
        out = {}
    if isinstance(o, dict) and isinstance(n, dict):
        for k, v in o.items():
            if k in n:
                id_pairs(v, n[k], k, out)
    elif isinstance(o, list) and isinstance(n, list) and len(o) == len(n):
        for a, b in zip(o, n):
            id_pairs(a, b, key, out)
    elif isinstance(o, (str, int)) and isinstance(n, (str, int)) and not isinstance(o, bool) and o != n:
        so, sn = str(o), str(n)
        if key is not None and ID_KEY.search(str(key)) and len(so) >= 4:
            out[so] = sn
    return out


def remap_text(s: str, idmap: dict) -> str:
    for k in sorted(idmap, key=len, reverse=True):
        if k in s:
            s = s.replace(k, idmap[k])
    return s


def load_world(p):
    if p is None:
        return None
    p = Path(p)
    raw = gzip.open(p, "rt", encoding="utf-8").read() if p.suffix == ".gz" else p.read_text(encoding="utf-8")
    w = json.loads(raw)
    return w["world"] if isinstance(w, dict) and set(w) >= {"world", "task"} else w


def sha(o) -> str:
    return hashlib.sha256(json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def run_job(bridge, differ, job: dict, worlds_dir: Path | None) -> dict:
    row = json.loads(Path(job["input"]).read_text(encoding="utf-8"))
    bridge.pin_timezone(row)
    r = bridge.Rollout(row, int(job.get("maxSteps", 50)), load_world(job.get("world0")))
    asyncio.run(r.setup())
    w0 = json.loads(json.dumps(r.world()))
    idmap, call_errors = {}, 0
    for step in job["steps"]:
        calls = step.get("calls") or []
        if not calls:
            continue
        sent = [{"name": c["name"], "arguments": remap_text(c["arguments"], idmap) if isinstance(c.get("arguments"), str) else c.get("arguments")} for c in calls]
        res = asyncio.run(r.batch(sent))
        if "error" in res:
            call_errors += len(calls)
            continue
        for c, got in zip(calls, res["results"]):
            content = got.get("content")
            if isinstance(content, str) and content.lstrip().startswith('{"error"'):
                call_errors += 1
            if c.get("orig") is not None:
                id_pairs(parse_json(c["orig"]), parse_json(content), None, idmap)
    gen = bridge.SHIM.generated()
    grade = asyncio.run(r.grade())
    final = r.world()
    scored = [a for a in (grade.get("assertion_results") or []) if not a.get("excluded")]
    failed = {}
    for a in scored:
        if not a.get("passed"):
            k = assertion_class(a.get("type"))
            failed[k] = failed.get(k, 0) + 1
    out = {"id": job["id"], "ok": grade.get("error") is None, "error": grade.get("error"), "steps": r.steps,
           "pass": int(round(grade.get("task_completed_correctly") or 0)), "pc": grade.get("partial_credit"),
           "nScored": len(scored), "nPassed": len(scored) - sum(failed.values()), "failedByClass": dict(sorted(failed.items())),
           "remapped": len(idmap), "callErrors": call_errors, "world0Sha": sha(w0), "finalSha": sha(final), "version": VERSION,
           "generatedDraws": len(gen) if hasattr(gen, "__len__") else None}
    if worlds_dir is not None:
        d, _ = differ.world_diff(w0, final)
        for name, obj in (("world0", w0), ("final", final), ("diff", d)):
            with gzip.open(worlds_dir / f"{job['id']}.{name}.json.gz", "wt", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--jobs", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--worlds")
    p.add_argument("--det", default="record", choices=["off", "record", "seed"])
    p.add_argument("--skip-done", action="store_true", help="skip job ids already present in --out (resume)")
    a = p.parse_args()
    bridge = _load("ab_bridge", BRIDGE_PATH)
    differ = _load("vl_build_live", DIFFER_PATH)
    bridge.SHIM.install(a.det)
    worlds_dir = Path(a.worlds) if a.worlds else None
    if worlds_dir:
        worlds_dir.mkdir(parents=True, exist_ok=True)
    done = set()
    outp = Path(a.out)
    if a.skip_done and outp.exists():
        for line in outp.read_text(encoding="utf-8").splitlines():
            try:
                done.add(json.loads(line)["id"])
            except (ValueError, KeyError):
                pass
    with open(a.jobs, encoding="utf-8") as jf, open(outp, "a", encoding="utf-8") as of:
        for line in jf:
            if not line.strip():
                continue
            job = json.loads(line)
            if job["id"] in done:
                continue
            try:
                res = run_job(bridge, differ, job, worlds_dir)
            except Exception as e:  # noqa: BLE001  (one bad job never stops the batch; it is recorded)
                res = {"id": job["id"], "ok": False, "error": f"{type(e).__name__}: {str(e)[:300]}", "version": VERSION}
            of.write(json.dumps(res, sort_keys=True) + "\n")
            of.flush()


if __name__ == "__main__":
    main()
