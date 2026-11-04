# AppWorld bridge (experiments/breadth/appworld; research/breadth-20261021/appworld/NOTES.md).
#
# The ONLY code that imports the pinned appworld package (0.1.3.post1, data 0.1.0). It runs in the venv outside the repo
# (/var/tmp/foundry-work/benches/appworld/venv, decision D16) as `python -P -s`, in an environment built from nothing
# (PATH, LANG, a private HOME, APPWORLD_ROOT/APPWORLD_CACHE), with no network, reached only from the host process
# (lib.mjs). Commands, one per process:
#
#   inventory <data-dir>     ids per official split, read from data/datasets/*.txt only (no task file is opened)
#   serve                    THE ARM-FACING PROCESS. Runs inside the executor sandbox (lib.mjs serveArgv: private user,
#                            mount, pid and network namespaces; host read-only; /home, /root, /tmp, /var/tmp ... masked;
#                            only the pinned venv and a per-unit PUBLIC VIEW of the data are visible, and the view has
#                            no ground_truth directory at all). The working directory is the APPWORLD_ROOT; its `data`
#                            is a link to the public view. Worlds are opened with load_ground_truth=False, so no ground
#                            truth is ever in this process. JSON-lines ops on stdin:
#                              open {taskId, settings}  -> a fresh AppWorld world for the task (one world at a time)
#                              execute {code}           -> world.execute(code) output; refused once the task is completed
#                                                          (the official agent loop stops at world.task_completed())
#                              docs {appName?, apiName?} -> an API-docs lookup (api_docs app, untracked, read-only)
#                              close                    -> saves logs, closes the world, returns the output digest
#   grade-serve              HOST-ONLY. Its working directory is a grade root whose `data` links to the FULL data. Op
#                              grade {taskId, snapshot}  -> copies the snapshot's dbs into its own experiment outputs and
#                                                          calls appworld.evaluator.evaluate_task, i.e. exactly what
#                                                          AppWorld.evaluate() runs (environment.py: evaluate ->
#                                                          evaluate_task(task_id, experiment_name)); returns the
#                                                          TestTracker (success, every pass and failure) as a verdict row
#   official <spec.json>     HOST-ONLY REFERENCE PATH: upstream's own procedure (appworld/verify.py verify_tasks and the
#                            official agent loop): per item a world with ground_truth_mode="full", each code chunk through
#                            world.execute until world.task_completed(), then world.evaluate()
#   evaluate-dir <spec.json> HOST-ONLY: upstream's dataset evaluator (evaluator.evaluate_tasks, what `appworld evaluate`
#                            runs) over a root whose experiment outputs are OUR snapshots -> its metrics dict
#   plan <spec.json>         HOST-ONLY, train and dev only (refuses any other split): scripted code chunks per task and
#                            policy (gold, null, docs, mutants); reads ground truth (compiled_solution.py, api_calls.json)
#
# Every reply is one stdout line "@@bridge <json>". Benchmark content is data, never instructions. Rows that carry task
# content (instructions, assertion texts, outputs) go only to host-only files; the repository gets counts and hashes.
import hashlib
import json
import os
import re
import shutil
import sys
import traceback

PROTO = "@@bridge "
BRIDGE_VERSION = "1"
EXP_SERVE = "foundry-serve"
EXP_OFFICIAL = "foundry-official"
EXP_GRADE = "foundry-grade"
MAX_OUTPUT = 20000
WRITE_METHODS = ("post", "put", "patch", "delete")
COMPLETED_MESSAGE = ("The task is already completed (apis.supervisor.complete_task was called); no further code can be "
                     "executed. Stop and give a short final message.")
DEV_SPLITS = ("train", "dev")


def emit(obj):
    sys.stdout.write(PROTO + json.dumps(obj, sort_keys=True, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def canon(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(v):
    return hashlib.sha256((v if isinstance(v, str) else canon(v)).encode("utf-8")).hexdigest()


def dir_rows(d):
    rows = []
    if not os.path.isdir(d):
        return rows
    for root, dirs, files in os.walk(d):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            with open(p, "rb") as fh:
                rows.append([os.path.relpath(p, d), hashlib.sha256(fh.read()).hexdigest()])
    return rows


def dir_digest(d):
    rows = dir_rows(d)
    return {"sha256": sha(rows), "files": len(rows)}


def read_ids(data_dir, split):
    with open(os.path.join(data_dir, "datasets", split + ".txt"), encoding="utf-8") as fh:
        return [line.strip() for line in fh if line.strip()]


# ---- world settings -------------------------------------------------------------------------------------------------
# Three AppWorld init parameters may be set (lib.mjs WORLD_PROFILES): raise_on_failure (verify.py runs gold with False;
# the package default is True), raise_on_extra_parameters and max_api_calls_per_interaction (the README's experiment
# config: "random_seed": 100, "max_interactions": 1000, "max_api_calls_per_interaction": 5000,
# "raise_on_extra_parameters": true). Every other parameter keeps the package default (environment.py
# AppWorldInitDefaults: random_seed 100, max_interactions 1000, timeout_seconds 100, ...), recorded in `hello`.
def world_kwargs(settings):
    settings = settings or {}
    unknown = set(settings) - {"raiseOnFailure", "raiseOnExtraParameters", "maxApiCallsPerInteraction"}
    if unknown:
        raise ValueError(f"unknown world settings {sorted(unknown)}")
    kw = {"raise_on_failure": bool(settings.get("raiseOnFailure", True))}
    if "raiseOnExtraParameters" in settings:
        kw["raise_on_extra_parameters"] = bool(settings["raiseOnExtraParameters"])
    if "maxApiCallsPerInteraction" in settings:
        kw["max_api_calls_per_interaction"] = int(settings["maxApiCallsPerInteraction"])
    return kw


def init_defaults():
    from appworld.environment import AppWorld
    return json.loads(AppWorld.init_defaults.json())


def tracker_row(tracker):
    d = tracker.to_dict()
    passes = [{"requirement": p.get("requirement"), "label": p.get("label")} for p in d.get("passes", [])]
    failures = [{"requirement": f.get("requirement"), "label": f.get("label"), "trace": str(f.get("trace", ""))[-1500:]} for f in d.get("failures", [])]
    return {"success": bool(d.get("success")), "passCount": len(passes), "failCount": len(failures), "numTests": d.get("num_tests"),
            "difficulty": d.get("difficulty"), "passes": passes, "failures": failures,
            # order-free assertion fingerprints (requirement text hashed): what the parity check compares
            "passSha256": sha(sorted(sha(p["requirement"] or "") for p in passes)),
            "failSha256": sha(sorted(sha(f["requirement"] or "") for f in failures))}


# ---- inventory --------------------------------------------------------------------------------------------------------
def inventory(data_dir):
    out = {}
    for split in ("train", "dev", "test_normal", "test_challenge"):
        ids = read_ids(data_dir, split)
        scen = sorted({i.rsplit("_", 1)[0] for i in ids})
        out[split] = {"n": len(ids), "scenarios": len(scen), "idsSha256": sha("\n".join(sorted(ids))), "ids": ids if split in DEV_SPLITS or split == "test_normal" else None}
    emit({"kind": "inventory", "splits": out})


# ---- serve (arm-facing, sandboxed) ------------------------------------------------------------------------------------
def serve():
    from appworld import AppWorld
    from appworld.common.path_store import path_store
    import appworld

    root = os.getcwd()
    path_store.update_root(root)
    emit({"kind": "hello", "bridge": BRIDGE_VERSION, "appworld": appworld.__version__, "defaults": init_defaults()})
    cur = None  # {"handle", "world", "taskId", "completed", "executes"}

    def out_dir(task_id):
        return os.path.join(path_store.experiment_outputs, EXP_SERVE, "tasks", task_id)

    for line in sys.stdin:
        if not line.strip():
            continue
        op = json.loads(line)
        h = op.get("handle")
        try:
            kind = op["op"]
            if kind == "quit":
                break
            if kind == "open":
                if cur is not None:
                    raise RuntimeError("a world is already open in this process")
                task_id = str(op["taskId"])
                if not re.fullmatch(r"[0-9a-f]{7}_[1-9]", task_id):
                    raise ValueError("bad task id")
                w = AppWorld(task_id=task_id, experiment_name=EXP_SERVE, load_ground_truth=False, **world_kwargs(op.get("settings")))
                cur = {"handle": h, "world": w, "taskId": task_id, "completed": False, "executes": 0}
                sup = w.task.supervisor
                emit({"kind": "ready", "handle": h, "taskId": task_id, "instruction": w.task.instruction,
                      "supervisor": {"first_name": sup.first_name, "last_name": sup.last_name, "email": sup.email, "phone_number": sup.phone_number},
                      "datetime": w.task.datetime.isoformat(), "appDescriptions": w.task.app_descriptions,
                      "groundTruthLoaded": w.task.ground_truth is not None, "preDigest": dir_digest(os.path.join(out_dir(task_id), "dbs"))})
                continue
            if cur is None or cur["handle"] != h:
                raise RuntimeError("no open world for this handle")
            w = cur["world"]
            if kind == "execute":
                code = str(op.get("code", ""))
                if cur["completed"]:
                    emit({"kind": "output", "handle": h, "output": COMPLETED_MESSAGE, "refused": True, "completed": True, "truncated": False})
                    continue
                text = w.execute(code)
                cur["executes"] += 1
                cur["completed"] = bool(w.task_completed())
                emit({"kind": "output", "handle": h, "output": text[-MAX_OUTPUT:], "truncated": len(text) > MAX_OUTPUT, "refused": False,
                      "completed": cur["completed"]})
            elif kind == "docs":
                app, api = op.get("appName"), op.get("apiName")
                if app and api:
                    r = w.requester.request("api_docs", "show_api_doc", track=False, raise_on_failure=False, app_name=str(app), api_name=str(api))
                elif app:
                    r = w.requester.request("api_docs", "show_api_descriptions", track=False, raise_on_failure=False, app_name=str(app))
                else:
                    r = w.requester.request("api_docs", "show_app_descriptions", track=False, raise_on_failure=False)
                emit({"kind": "docs", "handle": h, "output": json.dumps(r, indent=1, ensure_ascii=False)[-MAX_OUTPUT:]})
            elif kind == "close":
                w.save_logs()
                completed = cur["completed"] or bool(w.task_completed())
                w.close()
                d = out_dir(cur["taskId"])
                emit({"kind": "closed", "handle": h, "taskId": cur["taskId"], "executes": cur["executes"], "completed": completed,
                      "postDigest": dir_digest(os.path.join(d, "dbs")), "apiCallsDigest": dir_digest(os.path.join(d, "logs")),
                      "outputRel": os.path.relpath(d, root)})
                cur = None
            else:
                raise ValueError(f"unknown op {kind}")
        except Exception as e:  # reported to the host; the host decides whether it is an environment fault
            emit({"kind": "error", "handle": h, "error": f"{type(e).__name__}: {e}"[:2000], "trace": traceback.format_exc()[-4000:]})


# ---- grade-serve (host-only) ------------------------------------------------------------------------------------------
def grade_serve():
    from appworld.common.path_store import path_store
    from appworld.evaluator import evaluate_task
    from appworld.apps.model_lib import CachedDBHandler
    import appworld

    root = os.getcwd()
    path_store.update_root(root)
    emit({"kind": "hello", "bridge": BRIDGE_VERSION, "appworld": appworld.__version__, "role": "grade"})
    for line in sys.stdin:
        if not line.strip():
            continue
        op = json.loads(line)
        h = op.get("handle")
        try:
            if op["op"] == "quit":
                break
            if op["op"] != "grade":
                raise ValueError(f"unknown op {op['op']}")
            task_id = str(op["taskId"])
            snap = str(op["snapshot"])
            dst = os.path.join(path_store.experiment_outputs, EXP_GRADE, "tasks", task_id)
            shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(os.path.join(snap, "dbs"), os.path.join(dst, "dbs"))
            tracker = evaluate_task(task_id=task_id, experiment_name=EXP_GRADE, suppress_errors=True, save_report=False)
            CachedDBHandler.reset()
            row = tracker_row(tracker)
            row.update({"taskId": task_id, "postDigest": dir_digest(os.path.join(dst, "dbs"))})
            shutil.rmtree(dst, ignore_errors=True)
            emit({"kind": "graded", "handle": h, "row": row})
        except Exception as e:
            emit({"kind": "error", "handle": h, "error": f"{type(e).__name__}: {e}"[:2000], "trace": traceback.format_exc()[-4000:]})


# ---- official reference path (host-only) ------------------------------------------------------------------------------
def official(spec_path):
    from appworld import AppWorld
    from appworld.common.path_store import path_store
    import appworld

    spec = json.load(open(spec_path, encoding="utf-8"))
    path_store.update_root(os.getcwd())
    emit({"kind": "hello", "bridge": BRIDGE_VERSION, "appworld": appworld.__version__, "role": "official", "defaults": init_defaults()})
    for item in spec["items"]:
        key = item["key"]
        try:
            task_id = item["taskId"]
            with AppWorld(task_id=task_id, experiment_name=EXP_OFFICIAL, ground_truth_mode="full", **world_kwargs(item.get("settings"))) as w:
                executes = 0
                outs = []
                for chunk in item["chunks"]:
                    if w.task_completed():  # the official agent loop stops here
                        break
                    outs.append(sha(w.execute(chunk)))
                    executes += 1
                completed = bool(w.task_completed())
                tracker = w.evaluate()
                w.save_logs()
            d = os.path.join(path_store.experiment_outputs, EXP_OFFICIAL, "tasks", task_id)
            row = tracker_row(tracker)
            row.update({"taskId": task_id, "executes": executes, "completed": completed, "outputsSha256": sha(outs),
                        "postDigest": dir_digest(os.path.join(d, "dbs"))})
            shutil.rmtree(d, ignore_errors=True)
            emit({"kind": "official", "key": key, "row": row})
        except Exception as e:
            emit({"kind": "official", "key": key, "error": f"{type(e).__name__}: {e}"[:2000], "trace": traceback.format_exc()[-3000:]})
    emit({"kind": "done"})


# ---- upstream's dataset evaluator over our snapshots (host-only) -------------------------------------------------------
def evaluate_dir(spec_path):
    from appworld.common.path_store import path_store
    from appworld.evaluator import evaluate_tasks
    import appworld

    spec = json.load(open(spec_path, encoding="utf-8"))
    path_store.update_root(os.getcwd())
    metrics = evaluate_tasks(task_ids=spec["taskIds"], experiment_name=spec["experimentName"], suppress_errors=True,
                             include_details=True, save_reports=False)
    agg = metrics.get("aggregate", {})
    individual = metrics.get("individual", {})
    per_task = {k: bool(v.get("success")) for k, v in individual.items()}
    emit({"kind": "evaluated", "appworld": appworld.__version__, "aggregate": agg, "perTaskSuccess": per_task})


# ---- scripted plans (host-only, train/dev only) ------------------------------------------------------------------------
def load_docs(data_dir):
    docs = {}
    std = os.path.join(data_dir, "api_docs", "standard")
    for f in sorted(os.listdir(std)):
        if f.endswith(".json"):
            docs[f[:-5]] = json.load(open(os.path.join(std, f), encoding="utf-8"))
    return docs


def is_write(call):
    url = call["url"]
    return call["method"] in WRITE_METHODS and not url.startswith("/supervisor/") and "/auth/" not in url


def match_api(docs, method, url):
    app = url.strip("/").split("/")[0]
    for name, d in docs.get(app, {}).items():
        if d["method"].lower() != method:
            continue
        pat = "^" + re.sub(r"\\\{[^}]+\\\}", "[^/]+", re.escape(d["path"])) + "$"
        if re.match(pat, url):
            return app, name, d
    return app, None, None


# The mutant code is plain AppWorld code: a prefix chunk that wraps the requester's write methods for this world, then
# the gold chunk. Writes are counted with is_write's rule; the supervisor's complete_task (POST /supervisor/message) is
# the hook for the after-the-fact operators, so every mutation lands BEFORE the task is completed (both paths stop
# executing at completion). A write is recorded with a COPY of its body taken before the call and every replay sends a
# fresh copy: the requester's prepare() pops access_token out of the body it is given (requester.py `prepare`), so a
# replay of the same dict goes out unauthenticated and fails (the first version of these operators did exactly that,
# which made every repeat-last-write mutant a silent no-op).
MUTANT_PRELUDE = '''
_fm_state = {"n": 0, "writes": [], "done": False}
def _fm_copy(d):
    return dict(d) if isinstance(d, dict) else d
_fm_orig = {m: getattr(requester, "_" + m) for m in ("post", "put", "patch", "delete")}
def _fm_is_write(m, url):
    return m in ("post", "put", "patch", "delete") and not url.startswith("/supervisor/") and "/auth/" not in url
def _fm_wrap(m):
    def f(url, data=None, **kw):
        if _fm_is_write(m, url):
            _fm_state["n"] += 1
            data = _fm_on_write(m, url, data, _fm_state["n"])
            saved = dict(data) if isinstance(data, dict) else data
            r = _fm_orig[m](url, data=data, **kw)
            _fm_state["writes"].append((m, url, saved))
            return r
        if m == "post" and url.startswith("/supervisor/message") and not _fm_state["done"]:
            _fm_state["done"] = True
            _fm_before_complete()
        return _fm_orig[m](url, data=data, **kw)
    return f
for _fm_m in _fm_orig:
    setattr(requester, "_" + _fm_m, _fm_wrap(_fm_m))
'''

MUTANT_OPS = {
    # the gold's last write is issued a second time, unchanged, just before completion
    "repeat-last-write": '''
def _fm_on_write(m, url, data, n):
    return data
def _fm_before_complete():
    if _fm_state["writes"]:
        m, url, data = _fm_state["writes"][-1]
        try:
            r = _fm_orig[m](url, data=_fm_copy(data), raise_on_failure=False)
            _fm_state["replayStatus"] = getattr(r, "status_code", None)
        except Exception:
            pass
''',
    # the gold's last write carries one documented optional field the gold did not set (EXTRA_FIELD = VALUE)
    "extra-field": '''
def _fm_on_write(m, url, data, n):
    if n == _FM_K:
        data = dict(data or {})
        data[_FM_FIELD] = _FM_VALUE
    return data
def _fm_before_complete():
    pass
''',
    # just before completion, the gold's last id-bearing write is replayed against a NEIGHBOURING record id (same
    # endpoint, same body); the first neighbour the API accepts is the touched record. Without an id-bearing write, a
    # note in simple_note that the gold did not write is re-pinned (a collateral write in the supervisor's own data).
    "touch-other-record": '''
def _fm_on_write(m, url, data, n):
    return data
def _fm_before_complete():
    import re as _re
    touched = {u for (_, u, _) in _fm_state["writes"]}
    for m, url, data in reversed(_fm_state["writes"]):
        ms = list(_re.finditer(r"/(\\d+)(?=/|$)", url))
        if not ms:
            continue
        mm = ms[-1]
        for d in (1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 10, -10, 20, -20):
            v = int(mm.group(1)) + d
            if v <= 0:
                continue
            u2 = url[:mm.start(1)] + str(v) + url[mm.end(1):]
            if u2 in touched:
                continue
            try:
                r = _fm_orig[m](u2, data=_fm_copy(data), raise_on_failure=False)
            except Exception:
                continue
            if 200 <= getattr(r, "status_code", 0) < 300:
                _fm_state["touched"] = u2
                return
        break
    try:
        prof = requester.request("supervisor", "show_profile", track=False)
        pw = {a["account_name"]: a["password"] for a in requester.request("supervisor", "show_account_passwords", track=False)}
        tok = requester.request("simple_note", "login", track=False, username=prof["email"], password=pw["simple_note"])["access_token"]
        notes = requester.request("simple_note", "search_notes", track=False, access_token=tok, page_limit=20)
        mine = {int(x) for (_, u, _) in _fm_state["writes"] for x in _re.findall(r"/simple_note/notes/(\\d+)", u)}
        for note in notes:
            if note["note_id"] not in mine:
                requester.request("simple_note", "update_note", track=False, note_id=note["note_id"], pinned=not note.get("pinned", False), access_token=tok)
                _fm_state["touched"] = "simple_note:" + str(note["note_id"])
                return
    except Exception:
        pass
''',
}


def extra_field_choice(docs, writes):
    """The last write's API and one documented optional body field the gold did not set, with a non-default value."""
    if not writes:
        return None
    k = len(writes)
    call = writes[-1]
    app, name, d = match_api(docs, call["method"], call["url"])
    if not d:
        return {"k": k, "api": None, "reason": "unmatched endpoint"}
    path_params = set(re.findall(r"\{([^}]+)\}", d["path"]))
    for p in d["parameters"]:
        n, t = p["name"], p["type"]
        if p["required"] or n in path_params or n == "access_token" or n in (call.get("data") or {}):
            continue
        dflt = p.get("default")
        if t == "string":
            v = "foundry mutant extra field"
        elif t == "boolean":
            v = not bool(dflt)
        elif t == "integer":
            v = (dflt if isinstance(dflt, int) else 0) + 1
        elif t == "number":
            v = (dflt if isinstance(dflt, (int, float)) else 0) + 1.5
        elif t == "list[string]":
            v = ["foundry-mutant"]
        else:
            continue
        return {"k": k, "api": f"{app}.{name}", "field": n, "value": v}
    return {"k": k, "api": f"{app}.{name}", "reason": "no optional field of a supported type"}


def plan(spec_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    data_dir = spec["dataDir"]
    allowed = set(read_ids(data_dir, "train")) | set(read_ids(data_dir, "dev"))
    docs = load_docs(data_dir)
    for task_id in spec["taskIds"]:
        try:
            if task_id not in allowed:
                raise ValueError("plans exist for train and dev tasks only")
            gt = os.path.join(data_dir, "tasks", task_id, "ground_truth")
            with open(os.path.join(gt, "compiled_solution.py"), encoding="utf-8") as fh:
                compiled = fh.read()
            compiled = "\n".join(l for l in compiled.splitlines() if not l.startswith("# Canary String")).strip()
            gold = compiled + "\nsolution(apis, requester)"
            calls = json.load(open(os.path.join(gt, "api_calls.json"), encoding="utf-8"))
            writes = [c for c in calls if is_write(c)]
            used = []
            for c in calls:
                app, name, _ = match_api(docs, c["method"], c["url"])
                if name and (app, name) not in used and app != "api_docs":
                    used.append((app, name))
            apps = []
            for app, _ in used:
                if app not in apps:
                    apps.append(app)
            docs_chunks = ["print(apis.api_docs.show_app_descriptions())"]
            docs_chunks += [f"print(apis.api_docs.show_api_descriptions(app_name={json.dumps(a)}))" for a in apps]
            docs_chunks += [f"print(apis.api_docs.show_api_doc(app_name={json.dumps(a)}, api_name={json.dumps(n)}))" for a, n in used]
            docs_chunks.append("apis.supervisor.complete_task()")
            plans = {"gold": [gold], "null": [], "docs": docs_chunks}
            meta = {"goldCalls": len(calls), "goldWrites": len(writes), "goldApis": len(used), "goldChars": len(gold)}
            if writes:
                plans["mut:repeat-last-write"] = [MUTANT_PRELUDE + MUTANT_OPS["repeat-last-write"], gold]
                plans["mut:touch-other-record"] = [MUTANT_PRELUDE + MUTANT_OPS["touch-other-record"], gold]
            ch = extra_field_choice(docs, writes)
            meta["extraField"] = ch
            if ch and ch.get("field"):
                plans["mut:extra-field"] = [MUTANT_PRELUDE + MUTANT_OPS["extra-field"].replace("_FM_K", str(ch["k"]))
                                            .replace("_FM_FIELD", json.dumps(ch["field"])).replace("_FM_VALUE", repr(ch["value"])), gold]
            emit({"kind": "plan", "taskId": task_id, "plans": plans, "meta": meta})
        except Exception as e:
            emit({"kind": "plan", "taskId": task_id, "error": f"{type(e).__name__}: {e}"[:1000]})
    emit({"kind": "done"})


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if cmd == "inventory":
            inventory(sys.argv[2])
        elif cmd == "serve":
            serve()
        elif cmd == "grade-serve":
            grade_serve()
        elif cmd == "official":
            official(sys.argv[2])
        elif cmd == "evaluate-dir":
            evaluate_dir(sys.argv[2])
        elif cmd == "plan":
            plan(sys.argv[2])
        else:
            raise SystemExit(f"unknown command {cmd!r}")
    except SystemExit:
        raise
    except Exception as e:
        emit({"kind": "error", "error": f"{type(e).__name__}: {e}"[:2000], "trace": traceback.format_exc()[-4000:]})
        sys.exit(1)
