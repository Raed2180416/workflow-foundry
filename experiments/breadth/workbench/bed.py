"""WorkBench bed process for the breadth facade (experiments/breadth/workbench; notes:
research/breadth-20261021/workbench/ACQUISITION.md).

Runs WorkBench's own tool, state and evaluator code from the pinned clone (--root, olly-styles/WorkBench @49c7dfd0),
with `python -I` from the isolated venv. Nothing here edits the clone. Imports avoid src/evals/agent.py and
src/evals/inference.py (they import `openai`, which is not installed: no model client exists in this process).

Subcommands (all output is JSON; `serve` speaks JSON lines on stdin/stdout):
  tasks                 every shipped task with its template id and ground truth (host-only listing)
  serve                 one world: reset / catalog / call / snapshot / quit (the facade host drives it)
  grade  --tasks F --in T --out V
                        host-only grading of facade trajectories: WorkBench's own is_correct / has_side_effects /
                        is_exact_match on the logged action strings, plus an independent check of the live end state
  replay --tasks F --in T --out V
                        evaluator-level replay (no facade): is_correct on action lists, plus full-state equivalence
  mutants --tasks F --out M
                        deterministic mutants of each gold action list (operators: drop_last, wrong_argument,
                        extra_write, duplicate_write)
  regen  --seed S --per-template N --out F
                        WorkBench's own task generators with our seed (shipped data unchanged); writes host-only
  published --models a,b --out F
                        per-task verdicts of the shipped published results, scored by WorkBench's own metrics code

The process prints nothing but its protocol on stdout: WorkBench's own prints go to stderr.
"""
from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import io
import json
import logging
import os
import random
import re
import sys
import warnings

PROTO_OUT = sys.stdout
sys.stdout = sys.stderr  # anything WorkBench prints goes to stderr
warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)
csv.field_size_limit(sys.maxsize)

DOMAINS = ["analytics", "calendar", "customer_relationship_manager", "email", "multi_domain", "project_management"]
MUTABLE = ("calendar_events", "emails", "plots_data", "project_tasks", "crm_data")  # actions.EXECUTED_STATE_FIELDS
ALL_STATE = ("calendar_events", "emails", "analytics_data", "plots_data", "project_tasks", "crm_data", "directory_emails")
CASE_SENSITIVE = ("status", "list_name", "board")  # evaluation.CASE_SENSITIVE_FIELDS
GENERATOR_MODULES = [  # src/cli.py generate_data order
    ("analytics", "generate_analytics_task_and_outcome", "ANALYTICS_TEMPLATES"),
    ("calendar", "generate_calendar_task_and_outcome", "CALENDAR_TEMPLATES"),
    ("customer_relationship_manager", "generate_customer_relationship_manager_task_and_outcome", "CRM_TEMPLATES"),
    ("email", "generate_email_task_and_outcome", "EMAIL_TEMPLATES"),
    ("project_management", "generate_project_management_task_and_outcome", "PROJECT_MANAGEMENT_TEMPLATES"),
    ("multi_domain", "generate_multi_domain_task_and_outcome", "MULTI_DOMAIN_TEMPLATES"),
]


def emit(obj) -> None:
    PROTO_OUT.write(json.dumps(obj, ensure_ascii=False, sort_keys=True) + "\n")
    PROTO_OUT.flush()


def sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def template_id(domain: str, base_template: str) -> str:
    return f"{domain}/{sha(base_template)[:10]}"


def boot(root: str) -> None:
    root = os.path.realpath(root)
    os.chdir(root)  # WorkBench reads its CSVs by relative path (src/tools/state.py)
    sys.path.insert(0, root)


# --- the official pieces --------------------------------------------------------------------------------------------
def official():
    from src.evals import actions, evaluation
    from src.tools import state, toolkits
    from src.tools.tool import tool_to_openai_schema

    return actions, evaluation, state, toolkits, tool_to_openai_schema


def sanitize(name: str) -> str:
    """src/evals/agent.py _sanitize_tool_name (re-stated: importing agent.py needs `openai`)."""
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)


def load_tasks() -> list[dict]:
    rows = []
    for dom in DOMAINS:
        path = os.path.join("data", "processed", "tasks_and_outcomes", f"{dom}_tasks_and_outcomes.csv")
        with open(path, newline="", encoding="utf-8") as f:
            for i, r in enumerate(csv.DictReader(f)):
                outcome = ast.literal_eval(r["outcome"])
                rows.append({
                    "id": f"{dom}-{i:03d}", "domain": dom, "row": i, "template_id": template_id(dom, r["base_template"]),
                    "base_template": r["base_template"], "chosen_template": r["chosen_template"], "task": r["task"],
                    "domains": ast.literal_eval(r["domains"]), "outcome": outcome,
                })
    return rows


def is_write(action: str, side_effect_names: set[str]) -> bool:
    return ".".join(action.split("(")[0].split(".")[:2]) in side_effect_names


# --- state digests --------------------------------------------------------------------------------------------------
def _norm_rows(df, lower: bool) -> list[str]:
    cols = list(df.columns)
    out = []
    for rec in df.astype(object).where(df.notna(), None).itertuples(index=False, name=None):
        cells = []
        for c, v in zip(cols, rec):
            v = "" if v is None else str(v)
            if lower and c not in CASE_SENSITIVE:
                v = v.lower()
            cells.append(v)
        out.append(json.dumps(cells, ensure_ascii=False))
    return [json.dumps(cols)] + sorted(out)


def table_digest(df, lower: bool) -> str:
    return sha("\n".join(_norm_rows(df, lower)))


def state_digests(st) -> dict:
    """norm: the official comparison's view (5 mutable tables, case-folded except status/list_name/board, row order
    ignored); raw: every table of the world, exact text, row order ignored."""
    return {
        "norm": {n: table_digest(getattr(st, n), True) for n in MUTABLE},
        "raw": {n: table_digest(getattr(st, n), False) for n in ALL_STATE},
    }


def combined(d: dict) -> str:
    return sha(json.dumps(d, sort_keys=True))


# --- an independent executor (for equivalence and the native check) ---------------------------------------------------
def parse_action(action: str, allowed: set[str]):
    """Action string -> (dotted tool name, kwargs as strings). Same grammar as the official strings; written here
    independently of src/evals/actions.py so the native check does not share its code."""
    tree = ast.parse(action, mode="eval")
    call = tree.body
    if not isinstance(call, ast.Call):
        raise ValueError("not a call")
    parts, node = [], call.func
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    parts.reverse()
    if len(parts) >= 3 and parts[-1] == "func":
        parts = parts[:-1]
    name = ".".join(parts)
    if name not in allowed:
        raise ValueError(f"unknown tool {name}")
    if call.args:
        raise ValueError("positional arguments")
    return name, {kw.arg: str(ast.literal_eval(kw.value)) for kw in call.keywords if kw.arg is not None}


def run_actions(actions_list: list[str], st_mod, dispatch: dict) -> tuple[bool, object]:
    """Execute on a fresh world with our own parser; returns (all succeeded, state copy)."""
    st_mod.reset_state()
    ok = True
    for a in actions_list:
        try:
            name, kw = parse_action(a, set(dispatch))
            dispatch[name](**kw)
        except Exception:  # noqa: BLE001 - any failure is a failed action, as in the official replay
            ok = False
    s = st_mod.get_state().copy()
    st_mod.reset_state()
    return ok, s


# --- serve ----------------------------------------------------------------------------------------------------------
def cmd_serve(args) -> None:
    actions, evaluation, st_mod, toolkits, to_schema = official()
    tools = {t.name: t for t in toolkits.all_tools}
    side = {t.name for t in toolkits.tools_with_side_effects}
    st_mod.reset_state()
    emit({"kind": "ready", "tools": len(tools)})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            op = req.get("op")
            if op == "quit":
                emit({"kind": "bye"})
                return
            if op == "catalog":
                cat = []
                for t in toolkits.all_tools:
                    s = to_schema(t)["function"]
                    cat.append({"name": t.name, "mcpName": sanitize(t.name), "description": s["description"],
                                "inputSchema": s["parameters"], "write": t.name in side})
                emit({"kind": "catalog", "tools": cat})
            elif op == "reset":
                st_mod.reset_state()
                emit({"kind": "reset", "task": req.get("task"), "seed": req.get("seed"),
                      "digest": combined(state_digests(st_mod.get_state()))})
            elif op == "call":
                name, raw = req["name"], req.get("args") or {}
                if name not in tools:
                    emit({"kind": "call", "error": f"Tool '{name}' not found.", "fatal": False, "action": None})
                    continue
                if not isinstance(raw, dict):
                    raw = {"input": raw}
                # The official structured harness: every argument value becomes str(value); the logged action is
                # convert_intermediate_step_to_function_call(tool_name, action_input).
                str_input = {str(k): str(v) for k, v in raw.items()}
                action = actions.convert_intermediate_step_to_function_call(name, raw)
                try:
                    obs = str(tools[name](**str_input))
                    emit({"kind": "call", "text": obs, "action": action, "fatal": False, "write": name in side})
                except Exception as e:  # noqa: BLE001 - the official loop lets this end the task with an error
                    emit({"kind": "call", "error": f"{type(e).__name__}: {e}", "action": action, "fatal": True,
                          "write": name in side})
            elif op == "snapshot":
                d = state_digests(st_mod.get_state())
                emit({"kind": "snapshot", "digests": d, "digest": combined(d)})
            else:
                emit({"kind": "error", "error": f"unknown op {op!r}"})
        except Exception as e:  # noqa: BLE001
            emit({"kind": "error", "error": f"{type(e).__name__}: {e}"})


# --- grading --------------------------------------------------------------------------------------------------------
def _gold_cache(st_mod, dispatch):
    cache = {}

    def gold(task):
        key = json.dumps(task["outcome"])
        if key not in cache:
            ok, s = run_actions(task["outcome"], st_mod, dispatch)
            cache[key] = (ok, state_digests(s))
        return cache[key]

    return gold


def read_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(x) for x in f if x.strip()]


def load_task_file(path: str) -> dict:
    return {t["id"]: t for t in read_jsonl(path)}


def cmd_grade(args) -> None:
    """Facade trajectories -> verdicts. Input lines: {id, actions, error, fatal, live: {norm, raw} | null}."""
    actions, evaluation, st_mod, toolkits, _ = official()
    dispatch = {t.name: t for t in toolkits.all_tools}
    tasks = load_task_file(args.tasks)
    gold = _gold_cache(st_mod, dispatch)
    out = []
    for tr in read_jsonl(args.input):
        t = tasks[tr["id"]]
        gt = [a.replace("\n", "\\n") for a in t["outcome"]]
        pred = [a.replace("\n", "\\n") for a in tr.get("actions", [])]  # metrics.compute_metrics does the same
        err = tr.get("error") or ""
        correct_state = evaluation.is_correct(pred, gt, "")
        correct = bool(correct_state and not err)  # metrics.compute_metrics: correct = state match and no error
        rec = {"id": t["id"], "correct": correct, "correct_state": bool(correct_state),
               "side_effects": bool(evaluation.has_side_effects(pred, correct_state)),
               "exact_match": bool(evaluation.is_exact_match(pred, gt)), "error": err or None,
               "n_actions": len(pred), "gt_len": len(gt)}
        live = tr.get("live")
        if live:
            gok, gd = gold(t)
            native = bool(gok and not err and live["norm"] == gd["norm"])
            _, replay = run_actions(pred, st_mod, dispatch)
            rd = state_digests(replay)
            rec.update({"native_correct": native, "live_matches_replay": rd["raw"] == live["raw"],
                        "agree": native == correct})
        out.append(rec)
    with open(args.out, "w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, sort_keys=True) + "\n")
    emit({"kind": "graded", "n": len(out), "correct": sum(r["correct"] for r in out)})


def cmd_replay(args) -> None:
    """Evaluator-level replay of action lists (no facade). Input lines: {id, key, actions}."""
    actions, evaluation, st_mod, toolkits, _ = official()
    dispatch = {t.name: t for t in toolkits.all_tools}
    tasks = load_task_file(args.tasks)
    gold = _gold_cache(st_mod, dispatch)
    out = []
    for tr in read_jsonl(args.input):
        t = tasks[tr["id"]]
        gt = [a.replace("\n", "\\n") for a in t["outcome"]]
        pred = [a.replace("\n", "\\n") for a in tr["actions"]]
        correct = bool(evaluation.is_correct(pred, gt, ""))
        _, gd = gold(t)
        ok, s = run_actions(pred, st_mod, dispatch)
        md = state_digests(s)
        out.append({"id": t["id"], "key": tr.get("key"), "op": tr.get("op"), "correct": correct,
                    "equivalent_raw": bool(ok and md["raw"] == gd["raw"]),
                    "equivalent_norm": bool(ok and md["norm"] == gd["norm"]), "executes": ok})
    with open(args.out, "w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, sort_keys=True) + "\n")
    emit({"kind": "replayed", "n": len(out)})


# --- mutants --------------------------------------------------------------------------------------------------------
def _h(*parts) -> int:
    return int(sha("\x1f".join(map(str, parts)))[:12], 16)


def _shift_date(v: str, days: int) -> str | None:
    import pandas as pd

    try:
        ts = pd.Timestamp(v)
    except Exception:  # noqa: BLE001
        return None
    fmt = "%Y-%m-%d %H:%M:%S" if (" " in v or "T" in v) else "%Y-%m-%d"
    return (ts + pd.Timedelta(days=days)).strftime(fmt)


def _fmt_action(name: str, kw: dict) -> str:
    from src.evals.actions import convert_intermediate_step_to_function_call

    return convert_intermediate_step_to_function_call(name, kw)


def mutate_value(tool: str, key: str, value: str, st, seed: int) -> str:
    """A plausible wrong value for one argument (never a case-only change, never the official chart end-date
    tolerance 2023-11-29 <-> 2023-11-30)."""
    ids = {"event_id": ("calendar_events", "event_id"), "email_id": ("emails", "email_id"),
           "task_id": ("project_tasks", "task_id"), "customer_id": ("crm_data", "customer_id")}
    if key in ids:
        tab, col = ids[key]
        pool = sorted(set(getattr(st, tab)[col].astype(str)) - {value})
        return pool[seed % len(pool)]
    if "email" in key or key == "recipient":
        pool = sorted(set(st.directory_emails["email_address"].astype(str)) - {value.lower(), value})
        return pool[seed % len(pool)]
    if key in ("event_start", "due_date", "time_min", "time_max", "last_contact_date", "follow_up_by", "date_min",
               "date_max"):
        s = _shift_date(value, 2)
        if s is not None and s != value:
            return s
    if key == "duration" and value.isdigit():
        return str(int(value) + 15)
    if key in ("new_value",):
        s = _shift_date(value, 2) if re.match(r"^\d{4}-\d{2}-\d{2}", value) else None
        if s:
            return s
        if value.isdigit():
            return str(int(value) + 1)
        for tab, col in (("crm_data", "status"), ("project_tasks", "list_name"), ("project_tasks", "board"),
                         ("crm_data", "product_interest")):
            vals = set(getattr(st, tab)[col].astype(str))
            if value in vals:
                pool = sorted(v for v in vals if v.lower() != value.lower())
                return pool[seed % len(pool)]
        if "@" in value:
            pool = sorted(set(st.directory_emails["email_address"].astype(str)) - {value.lower(), value})
            return pool[seed % len(pool)]
    if key in ("status", "list_name", "board", "product_interest", "plot_type", "value_to_plot", "field"):
        domains = {"plot_type": ["bar", "line", "scatter", "histogram"],
                   "value_to_plot": ["total_visits", "session_duration_seconds", "user_engaged", "visits_direct",
                                     "visits_referral", "visits_search_engine", "visits_social_media"]}
        if key in domains:
            pool = [v for v in domains[key] if v != value]
            return pool[seed % len(pool)]
        if key == "field":
            return value  # changing which field an update writes is covered by new_value; keep the field
        for tab in ("crm_data", "project_tasks"):
            df = getattr(st, tab)
            if key in df.columns:
                pool = sorted(v for v in set(df[key].astype(str)) if v.lower() != value.lower())
                return pool[seed % len(pool)]
    return value + " (revised)"


def cmd_mutants(args) -> None:
    actions, evaluation, st_mod, toolkits, _ = official()
    side = {t.name for t in toolkits.tools_with_side_effects}
    allowed = {t.name for t in toolkits.all_tools}
    tasks = read_jsonl(args.tasks)
    st_mod.reset_state()
    st = st_mod.get_state().copy()
    domain_extra = {
        "calendar": ("calendar.delete_event", "event_id", "calendar_events"),
        "email": ("email.delete_email", "email_id", "emails"),
        "project_management": ("project_management.delete_task", "task_id", "project_tasks"),
        "customer_relationship_manager": ("customer_relationship_manager.delete_customer", "customer_id", "crm_data"),
    }
    out = []
    for t in tasks:
        gt = t["outcome"]
        writes = [i for i, a in enumerate(gt) if is_write(a, side)]
        # drop_last: the earlier probe's operator, kept for continuity
        if gt:
            out.append({"id": t["id"], "op": "drop_last", "key": f"{t['id']}:drop_last", "actions": gt[:-1]})
        # wrong_argument: one argument of one write action takes a plausible wrong value
        if writes:
            i = writes[_h(t["id"], "wa-i") % len(writes)]
            name, kw = parse_action(gt[i], allowed)
            keys = [k for k in kw if not (name.endswith("update_event") or name.endswith("update_task")
                                          or name.endswith("update_customer")) or k == "new_value"] or list(kw)
            k = keys[_h(t["id"], "wa-k") % len(keys)]
            kw2 = dict(kw)
            kw2[k] = mutate_value(name, k, kw[k], st, _h(t["id"], "wa-v"))
            m = list(gt)
            m[i] = _fmt_action(name, kw2)
            out.append({"id": t["id"], "op": "wrong_argument", "key": f"{t['id']}:wrong_argument", "actions": m,
                        "detail": {"tool": name, "arg": k}})
        # extra_write: one collateral write the task did not ask for (a deletion of an untouched record; for
        # analytics, an extra chart)
        doms = [d for d in t["domains"] if d in domain_extra or d == "analytics"] or ["calendar"]
        d = doms[_h(t["id"], "ew-d") % len(doms)]
        if d == "analytics":
            extra = _fmt_action("analytics.create_plot", {"time_min": "2023-11-01", "time_max": "2023-11-15",
                                                          "value_to_plot": "visits_social_media", "plot_type": "scatter"})
        else:
            tool, key, tab = domain_extra[d]
            touched = " ".join(gt)
            pool = sorted(i for i in set(getattr(st, tab)[key].astype(str)) if i not in touched)
            extra = _fmt_action(tool, {key: pool[_h(t["id"], "ew-i") % len(pool)]})
        out.append({"id": t["id"], "op": "extra_write", "key": f"{t['id']}:extra_write", "actions": gt + [extra],
                    "detail": {"domain": d}})
        # duplicate_write: one write action issued twice in a row
        if writes:
            i = writes[_h(t["id"], "dw-i") % len(writes)]
            m = gt[: i + 1] + [gt[i]] + gt[i + 1:]
            out.append({"id": t["id"], "op": "duplicate_write", "key": f"{t['id']}:duplicate_write", "actions": m,
                        "detail": {"tool": gt[i].split("(")[0].rsplit(".func", 1)[0]}})
    with open(args.out, "w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")
    emit({"kind": "mutants", "n": len(out)})


# --- regeneration ---------------------------------------------------------------------------------------------------
def generate(seed: int, per_template: int) -> dict:
    """WorkBench's generators, called the way src/cli.py generate_data calls them (same module order, one
    np/random seed per module before its templates), with our seed in place of their fixed 42. The shipped sandbox
    databases are not regenerated: every instance runs in the shipped world."""
    import importlib

    import numpy as np
    import pandas as pd

    from src.data_generation import data_generation_utils as dgu
    from src.tools import state as st_mod

    out = {}
    for dom, mod_name, var in GENERATOR_MODULES:
        st_mod.reset_state()
        mod = importlib.import_module(f"scripts.data_generation.task_outcome_generation.{mod_name}")
        if dom == "multi_domain":
            mod.load_data()
            for sub in ("analytics_qa", "calendar_qa", "crm_qa", "pm_qa"):
                getattr(mod, sub).load_data()
        else:
            mod.load_data()
        np.random.seed(seed)
        random.seed(seed)
        rows = dgu.generate_all_tasks_and_outcomes(getattr(mod, var), per_template)
        buf = io.StringIO()
        pd.DataFrame(rows).to_csv(buf, index=False, quoting=csv.QUOTE_ALL)
        out[dom] = {"rows": rows, "csv": buf.getvalue()}
    st_mod.reset_state()
    return out


def cmd_regen(args) -> None:
    g = generate(args.seed, args.per_template)
    recs = []
    for dom in DOMAINS:
        for i, r in enumerate(g[dom]["rows"]):
            recs.append({"id": f"{dom}-s{args.seed}-{i:03d}", "domain": dom, "row": i,
                         "template_id": template_id(dom, r["base_template"]), "base_template": r["base_template"],
                         "chosen_template": r["chosen_template"], "task": r["task"], "domains": r["domains"],
                         "outcome": r["outcome"], "seed": args.seed})
    with open(args.out, "w", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")
    shipped = {}
    for dom in DOMAINS:
        with open(os.path.join("data", "processed", "tasks_and_outcomes", f"{dom}_tasks_and_outcomes.csv"),
                  encoding="utf-8", newline="") as f:
            shipped[dom] = f.read()
    emit({"kind": "regen", "seed": args.seed, "n": len(recs),
          "csv_sha256": {d: sha(g[d]["csv"]) for d in DOMAINS},
          "identical_to_shipped_csv": {d: g[d]["csv"] == shipped[d] for d in DOMAINS}})


# --- published results ----------------------------------------------------------------------------------------------
def cmd_published(args) -> None:
    from src.evals import metrics

    tasks = load_tasks()
    by_text = {(t["domain"], t["task"]): t["id"] for t in tasks}
    out, summary = [], {}
    for model in args.models.split(","):
        for dom in DOMAINS:
            found = metrics.get_latest_results_path(os.path.join("data", "results"), model, dom, True)
            if not found:
                summary.setdefault(model, {})[dom] = None
                continue
            res_path, gt_path = found
            df = metrics.load_and_score_results(res_path, gt_path)
            n_mapped = 0
            for _, r in df.iterrows():
                tid = by_text.get((dom, r["task"]))
                n_mapped += tid is not None
                out.append({"model": model, "domain": dom, "id": tid, "correct": bool(r["correct"]),
                            "side_effects": bool(r["unwanted_side_effects"]), "file": os.path.basename(res_path),
                            "gt_version": metrics.ground_truth_version_for_results(res_path)})
            summary.setdefault(model, {})[dom] = {"n": int(len(df)), "mapped": n_mapped, "correct": int(df["correct"].sum()),
                                                  "file": os.path.basename(res_path),
                                                  "gt_version": metrics.ground_truth_version_for_results(res_path)}
    with open(args.out, "w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, sort_keys=True) + "\n")
    emit({"kind": "published", "summary": summary})


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--root", required=True)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tasks")
    sub.add_parser("serve")
    g = sub.add_parser("grade")
    g.add_argument("--tasks", required=True)
    g.add_argument("--in", dest="input", required=True)
    g.add_argument("--out", required=True)
    r = sub.add_parser("replay")
    r.add_argument("--tasks", required=True)
    r.add_argument("--in", dest="input", required=True)
    r.add_argument("--out", required=True)
    m = sub.add_parser("mutants")
    m.add_argument("--tasks", required=True)
    m.add_argument("--out", required=True)
    rg = sub.add_parser("regen")
    rg.add_argument("--seed", type=int, required=True)
    rg.add_argument("--per-template", type=int, default=10)
    rg.add_argument("--out", required=True)
    pb = sub.add_parser("published")
    pb.add_argument("--models", required=True)
    pb.add_argument("--out", required=True)
    a = p.parse_args()
    boot(a.root)
    if a.cmd == "tasks":
        for t in load_tasks():
            emit(t)
    elif a.cmd == "serve":
        cmd_serve(a)
    elif a.cmd == "grade":
        cmd_grade(a)
    elif a.cmd == "replay":
        cmd_replay(a)
    elif a.cmd == "mutants":
        cmd_mutants(a)
    elif a.cmd == "regen":
        cmd_regen(a)
    elif a.cmd == "published":
        cmd_published(a)


if __name__ == "__main__":
    main()
