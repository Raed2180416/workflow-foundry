#!/usr/bin/env python3
"""SOP-Bench bridge (experiments/sopbench; research/sopbench-20261021/NOTES.md, ACQUISITION.md).

Runs ONLY in the pinned tool venv, isolated mode, from a neutral working directory, with the clone passed as data:

    corpus/sop-bench-venv/bin/python -I experiments/sopbench/bridge.py <command> --upstream corpus/sop-bench ...

Upstream modules are loaded by file path with stub packages (upstream.py): no package __init__, CLI, model client,
dotenv or rich ever runs. The SOP's own tools.py runs exactly as upstream's loader runs it, with one change: its `pd`
module attribute is a proxy whose read_csv serves the SOP's CSV files from a host-side cache, FILTERED to the rows the
run may see (the "world"). A dev world holds only the SPLIT.json dev rows of that SOP, so a tool call naming a sealed
row's key finds nothing; the full (upstream-identical) world needs --sealed with a freeze file.

Commands:
  stats     per SOP: rows, columns, input/output columns, tools (stubs counted), upstream-loader outcome, input leaks,
            key uniqueness, world files and their row alignment, aggregate label statistics (no row values printed)
  rows      per SOP: row ids and content hashes (input of split.mjs)
  prepare   rows of one SOP -> sop.txt, catalog.json (tool definitions as upstream's function-calling agent builds
            them), meta.json; per row task.json (inputs + the exact upstream task text) and expected.json (HOST-ONLY)
  serve     one row: tool-call batches from a file mailbox (tool.mjs) run through upstream's ToolManager on the world,
            until the host writes 'stop'; the call log goes to a HOST-ONLY directory
  replay    the same as serve, batches read from a file (tests)
  grade     final texts -> upstream verdict (the real Evaluator.run_single_task with a scripted agent) + strict verdict
  official  the reference path: upstream's own loader, ToolManager on the unfiltered world and Evaluator.run_single_task
            with a scripted agent that issues the given calls and returns the given text (parity)
  probe     tool determinism: every tool called twice with the row's own column values (dev rows only)

Row ids are upstream task ids: the 0-based row index of test_set_with_outputs.csv (loader.py:205-243).
"""
from __future__ import annotations

import argparse
import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import math
import os
import re
import secrets
import select
import stat as _stat
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True  # leave the clone untouched: no __pycache__ beside upstream files
PROTO = "@@bridge "
MAX_REQUEST_BYTES = 1_000_000
TEST_FILE = "test_set_with_outputs.csv"
NULLS = {"none", "null", "na", "n/a", "nan", "unknown", ""}


def _load_sibling(name):
    spec = importlib.util.spec_from_file_location(f"sopbench_{name}", Path(__file__).with_name(f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=py_default)


def sha(obj) -> str:
    data = obj if isinstance(obj, bytes) else (obj if isinstance(obj, str) else canon(obj)).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def file_sha(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def emit(kind: str, **data):
    sys.stdout.write(PROTO + canon({"kind": kind, **data}) + "\n")
    sys.stdout.flush()


def write_json(path: Path, obj, indent=1):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=indent, default=py_default) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def load_json(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def jsonsafe(v):
    """A JSON value JS can parse: numpy scalars as Python values, NaN/inf floats as null."""
    if isinstance(v, dict):
        return {str(k): jsonsafe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonsafe(x) for x in v]
    if not isinstance(v, (str, int, float, bool, type(None))):
        v = py_default(v)
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def py_default(o):
    """JSON for numpy/pandas scalars (numpy.bool_, numpy.int64, Timestamp...): their Python value, else str()."""
    item = getattr(o, "item", None)
    if callable(item):
        try:
            return item()
        except Exception:  # noqa: BLE001
            pass
    return str(o)


# ----------------------------------------------------------------------------------------------------------------
# SOP data (pandas only for reading, exactly as upstream reads: pd.read_csv(path) with default arguments)
# ----------------------------------------------------------------------------------------------------------------

class Sop:
    """One SOP directory: metadata, test rows (as upstream's loader reads them), our input columns."""

    def __init__(self, data_dir: Path, name: str):
        import pandas as pd
        self.pd = pd
        self.name = name
        self.dir = Path(data_dir) / name
        if not (self.dir / "metadata.json").is_file():
            raise FileNotFoundError(f"unknown SOP {name}")
        self.meta = load_json(self.dir / "metadata.json")
        self.output_columns = list(self.meta.get("output_columns") or [])
        self.df = pd.read_csv(self.dir / TEST_FILE)
        # Rows exactly as upstream's loader builds them: iterrows + to_dict (loader.py:205-207).
        self.rows = [r.to_dict() for _, r in self.df.iterrows()]
        cols = list(self.df.columns)
        meta_inputs = list(self.meta.get("input_columns") or [])
        # Upstream (loader.py:210-237): with output_columns AND input_columns, inputs = the input columns in CSV order;
        # otherwise ("legacy mode") inputs = the WHOLE row, outputs included, and expected = 'expected_output' or
        # 'final_decision'. We keep upstream's inputs where they are defined; where upstream leaks (legacy mode), our
        # inputs are the columns of the SOP's own output-free file (test_set_without_outputs.csv, else data.csv), which
        # excludes every output and intermediate column.
        if self.output_columns and meta_inputs:
            self.input_columns = [c for c in cols if c in meta_inputs and c not in self.output_columns]
            self.inputs_source = "metadata.input_columns"
        else:
            src = None
            for f in ("test_set_without_outputs.csv", "data.csv"):
                fp = self.dir / f
                if fp.is_file():
                    other = list(pd.read_csv(fp, nrows=0).columns)
                    if not any(c in other for c in self.output_columns):
                        src = (f, other)
                        break
            if src is None:
                raise ValueError(f"{name}: no output-free column source for inputs")
            self.input_columns = [c for c in cols if c in src[1] and c not in self.output_columns]
            self.inputs_source = f"columns of {src[0]} (upstream legacy mode would pass the whole row)"
        self.toolspecs = load_json(self.dir / "toolspecs.json")
        self.tool_names = [(s.get("toolSpec") or s).get("name") for s in self.toolspecs]

    @property
    def n(self):
        return len(self.df)

    def row(self, rid: int):
        if not (0 <= rid < self.n):
            raise KeyError(f"{self.name}: no row {rid}")
        return self.rows[rid]

    def inputs(self, rid: int) -> dict:
        r = self.row(rid)
        return {c: r[c] for c in r if c in self.input_columns}

    def task_text(self, rid: int) -> str:
        """Exactly what upstream's function-calling and ReAct agents put in the prompt (function_calling.py:203,
        react.py:487): one 'key: value' line per input, Python str() of the pandas value."""
        return "\n".join(f"{k}: {v}" for k, v in self.inputs(rid).items())

    def expected(self, rid: int):
        r = self.row(rid)
        return {c: r[c] for c in self.output_columns}

    def expected_export(self, rid: int) -> dict:
        exp = self.expected(rid)
        return {c: {"str": str(v), "isna": bool(self.pd.isna(v)), "pytype": type(v).__name__} for c, v in exp.items()}

    def row_hash(self, rid: int) -> str:
        r = self.row(rid)
        return sha({c: (None if self.pd.isna(v) else str(v)) for c, v in r.items()})

    def contract(self) -> dict:
        files = sorted(p.name for p in self.dir.iterdir() if p.is_file() and p.suffix in (".txt", ".json", ".py", ".csv"))
        return {"sop": self.name, "files": {f: file_sha(self.dir / f) for f in files}}

    def catalog(self) -> list:
        """Tool definitions exactly as upstream's function-calling agent sends them (function_calling.py:113-135)."""
        out = []
        for spec in self.toolspecs:
            if "toolSpec" in spec:
                t = spec["toolSpec"]
                out.append({"name": t["name"], "description": t["description"], "input_schema": t["inputSchema"]["json"]})
            else:
                out.append({"name": spec["name"], "description": spec["description"], "input_schema": spec.get("inputSchema", {}).get("json", {})})
        return out


def list_sops(data_dir: Path):
    return sorted(p.name for p in Path(data_dir).iterdir() if p.is_dir() and not p.name.startswith(".") and (p / "metadata.json").is_file())


# ----------------------------------------------------------------------------------------------------------------
# Split and freeze (sealed rows are refused in code)
# ----------------------------------------------------------------------------------------------------------------

def load_split(path: Path) -> dict:
    s = load_json(path)
    for name, e in s["sops"].items():
        for k in ("build", "repair", "sealed"):
            if sha(e[k]) != e[f"{k}Sha256"]:
                raise ValueError(f"SPLIT {name}.{k}: list does not match its sha256")
    lists = {n: {k: e[k] for k in ("build", "repair", "sealed")} for n, e in s["sops"].items()}
    if sha(lists) != s["splitSha256"]:
        raise ValueError("SPLIT: splitSha256 does not match the lists")
    return s


def allowed_rows(split: dict, sop: str, *, sealed: bool, freeze: Path | None):
    """The rows a command may touch: the dev rows (build + repair), or every row with --sealed and a valid freeze."""
    if sop not in split["sops"]:
        raise PermissionError(f"{sop} is not in the split")
    e = split["sops"][sop]
    if not sealed:
        return set(e["build"]) | set(e["repair"])
    if freeze is None:
        raise PermissionError("--sealed needs --freeze <file>")
    f = load_json(freeze)
    if f.get("kind") != "sopbench-freeze":
        raise PermissionError("freeze file: kind must be 'sopbench-freeze'")
    if f.get("splitSha256") != split["splitSha256"]:
        raise PermissionError("freeze file: names another split")
    if sop not in (f.get("sops") or []):
        raise PermissionError(f"freeze file: {sop} is not frozen")
    return None  # every row


def check_rows(rows, allowed, sop):
    if allowed is None:
        return
    bad = [r for r in rows if r not in allowed]
    if bad:
        raise PermissionError(f"{sop}: row(s) {bad[:5]} are sealed (not dev rows); sealed rows need --sealed --freeze")


# ----------------------------------------------------------------------------------------------------------------
# World: the SOP's tools on a row-filtered view of its CSV files
# ----------------------------------------------------------------------------------------------------------------

class PdProxy:
    """Stands in for the `pd` module inside one tools.py. read_csv(path) of a known SOP file returns a copy of the
    host-cached, row-filtered frame (parsed once with upstream's own call, pd.read_csv(path)); any other read_csv is
    refused. Every other attribute is real pandas."""

    def __init__(self, real, frames: dict):
        self._real = real
        self._frames = frames
        self.reads = []

    def read_csv(self, path, *a, **k):
        key = os.path.realpath(str(path))
        if a or k or key not in self._frames:
            raise PermissionError(f"world: read_csv refused for {Path(str(path)).name}")
        self.reads.append(Path(key).name)
        return self._frames[key].copy(deep=True)

    def __getattr__(self, name):
        return getattr(self._real, name)


class World:
    def __init__(self, up, sop: Sop, allowed):
        import pandas as pd
        self.up, self.sop, self.allowed = up, sop, allowed
        self.alignment = {}
        frames = {}
        test = sop.df
        for p in sorted(sop.dir.glob("*.csv")):
            try:
                full = pd.read_csv(p)
            except Exception as e:  # noqa: BLE001  (upstream's own read of this file fails the same way)
                self.alignment[p.name] = f"unparseable by pd.read_csv ({type(e).__name__}); not served"
                continue
            if allowed is None:
                frames[os.path.realpath(p)] = full
                self.alignment[p.name] = "full"
                continue
            if p.name == TEST_FILE:
                aligned = True
            else:
                shared = [c for c in full.columns if c in test.columns]
                aligned = len(full) == len(test) and bool(shared) and all(
                    full[c].astype(str).tolist() == test[c].astype(str).tolist() for c in shared)
            self.alignment[p.name] = "row-aligned" if aligned else "not aligned (refused in a dev world)"
            if aligned:
                frames[os.path.realpath(p)] = full.iloc[sorted(allowed)]
        self.proxy = PdProxy(pd, frames)
        self.instance = self._load_tools()
        self.tm = up.manager.ToolManager(self.instance, sop.toolspecs)

    def _load_tools(self):
        """upstream BenchmarkLoader.load_tools (loader.py:254-302), with the module's `pd` replaced before the
        Manager is instantiated (one SOP reads its CSV in __init__)."""
        path = self.sop.dir / "tools.py"
        mod_name = f"benchmark_tools_{self.sop.dir.name}"
        spec = importlib.util.spec_from_file_location(mod_name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = module
        with contextlib.redirect_stdout(sys.stderr):
            spec.loader.exec_module(module)
            if hasattr(module, "pd"):
                module.pd = self.proxy
            manager_class = None
            for attr_name in dir(module):
                if attr_name.endswith("Manager") and not attr_name.startswith("_"):
                    manager_class = getattr(module, attr_name)
                    break
            if manager_class is None:
                raise ImportError(f"No Manager class found in {path}")
            return manager_class()

    def call(self, name, arguments) -> dict:
        """One tool call as upstream's function-calling agent runs it (function_calling.py:260-285): ToolManager.
        execute_tool, then json.dumps(result) or 'Error: <message>'. Two upstream behaviours that END the agent's
        whole task are made non-fatal here and flagged in the host-only log (upstreamFatal): an unknown tool name
        (execute_tool raises before its try, manager.py:120-125) and a result json.dumps cannot encode (numpy
        scalars, function_calling.py:283)."""
        rec = {"name": name, "t": time.time()}
        try:
            params = json.loads(arguments) if isinstance(arguments, str) else arguments
        except Exception as e:  # noqa: BLE001
            rec.update(error="arguments", content=f"Error: arguments are not valid JSON ({e})")
            return rec
        if not isinstance(params, dict):
            rec.update(error="arguments", content="Error: arguments must be a JSON object")
            return rec
        rec["arguments"] = params
        if not self.tm.has_tool(name):
            rec.update(error="unknown_tool", upstreamFatal="unknown tool: ToolManager.execute_tool raises outside its try (manager.py:120-125)",
                       content=f"Error: Tool '{name}' not found. Available tools: {', '.join(self.tm.get_tool_names())}")
            return rec
        with contextlib.redirect_stdout(sys.stderr):
            tc = self.tm.execute_tool(name, params)
        if tc.success:
            try:
                rec["content"] = json.dumps(tc.result)
            except (TypeError, ValueError) as e:
                rec["content"] = json.dumps(tc.result, default=py_default)
                rec["upstreamFatal"] = f"json.dumps of the result raises ({type(e).__name__}; function_calling.py:283)"
            rec["ok"] = True
        else:
            rec.update(ok=False, error="tool", content=f"Error: {tc.error}")
        return rec


# ----------------------------------------------------------------------------------------------------------------
# Scoring
# ----------------------------------------------------------------------------------------------------------------

def py_str_json(v) -> str:
    """str() of a json.loads value (what upstream's parser does with <final_output> values, parser.py:145)."""
    return str(v)


FINAL_RE = re.compile(r'<final_output>\s*(\{.*?\})\s*</final_output>', re.DOTALL | re.IGNORECASE)


FLOAT_RE = re.compile(r"[+-]?(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?", re.ASCII)


def _num(s: str):
    """A finite number written with ASCII digits (Python float() syntax minus inf/nan/Unicode digits), else None."""
    if not FLOAT_RE.fullmatch(s):
        return None
    x = float(s.replace("_", ""))
    return x if math.isfinite(x) else None


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("_", " ").replace("-", " ")).strip()


def strict_field(p_str: str, e: dict) -> bool:
    p_raw, e_raw = p_str.strip(), e["str"].strip()
    p_low, e_low = p_raw.lower(), e_raw.lower()
    p_null, e_null = p_low in NULLS, e["isna"] or e_low in NULLS
    if p_null or e_null:
        return p_null and e_null
    pn, en = _num(p_raw), _num(e_raw)
    if pn is not None and en is not None:
        return pn == en
    return _norm_text(p_low) == _norm_text(e_low)


def strict_verdict(text: str, expected: dict, output_columns: list) -> dict:
    """Our strict metric (research/sopbench-20261021/NOTES.md §4): the LAST <final_output>{json}</final_output> must
    parse and hold every output column (case-insensitive key) with a scalar value; per column the value equals the
    ground truth: both null-like, or both finite numbers with the same value, or the same text after lower-casing,
    '_'/'-' -> space, whitespace collapsing and trimming. No substring containment, no fallback parsers, no tool
    results. Identical to scorer.mjs strictVerdict (parity-tested)."""
    m = FINAL_RE.findall(text or "")
    if not m:
        return {"pass": False, "reason": "no <final_output> JSON"}
    try:
        obj = json.loads(m[-1].strip())
    except Exception:  # noqa: BLE001
        return {"pass": False, "reason": "final_output is not valid JSON"}
    low = {str(k).lower(): v for k, v in obj.items()}
    fields = {}
    for c in output_columns:
        v = low.get(c.lower(), _MISSING)
        fields[c] = False if v is _MISSING or isinstance(v, (list, dict)) else strict_field(str(v), expected[c])
    return {"pass": all(fields.values()), "fields": fields}


_MISSING = object()


class ScriptedAgent:
    """A BaseAgent for upstream's Evaluator: issues the given calls through the given ToolManager and returns the
    given text as output and as reasoning trace (upstream parses the trace for multi-field SOPs, evaluator.py:313-318;
    here both are the same final text)."""

    def __new__(cls, up, calls, text):
        base = up.agents_base

        class _A(base.BaseAgent):
            def execute(self, sop, task, tools):
                log = []
                for c in calls:
                    name, args = c["name"], c.get("arguments", "{}")
                    try:
                        params = json.loads(args) if isinstance(args, str) else args
                    except Exception as e:  # noqa: BLE001
                        log.append({"name": name, "error": "arguments", "content": f"Error: arguments are not valid JSON ({e})"})
                        continue
                    if not isinstance(params, dict):
                        log.append({"name": name, "error": "arguments", "content": "Error: arguments must be a JSON object"})
                        continue
                    try:
                        with contextlib.redirect_stdout(sys.stderr):
                            tc = tools.execute_tool(name, params)
                    except ValueError as e:  # unknown tool: fatal in upstream's agent
                        log.append({"name": name, "arguments": params, "error": "unknown_tool", "upstreamFatal": "unknown tool", "content": f"Error: {e}"})
                        continue
                    if tc.success:
                        try:
                            content, fatal = json.dumps(tc.result), None
                        except (TypeError, ValueError) as e:
                            content, fatal = json.dumps(tc.result, default=py_default), f"json.dumps raises ({type(e).__name__})"
                        r = {"name": name, "arguments": params, "ok": True, "content": content}
                        if fatal:
                            r["upstreamFatal"] = fatal
                        log.append(r)
                    else:
                        log.append({"name": name, "arguments": params, "ok": False, "error": "tool", "content": f"Error: {tc.error}"})
                self.log = log
                return base.AgentResult(output=text, tool_calls=[], reasoning_trace=text, success=True, error=None)

        return _A(model_id="scripted")


def upstream_verdict(up, sop: Sop, rid: int, text: str, *, benchmark=None, calls=(), tools=None):
    """The real Evaluator.run_single_task (evaluator.py:273-384) on one task, with a scripted agent. Without a
    benchmark from upstream's loader, the Task is built from our reading of the same CSV (identical values: the same
    pd.read_csv call; upstream's loader cannot load every SOP, see stats)."""
    ev_mod, types_mod = up.evaluator, up.types
    if benchmark is None:
        exp = sop.expected(rid)
        expected = exp[sop.output_columns[0]] if len(sop.output_columns) == 1 else exp
        task = types_mod.Task(task_id=str(rid), inputs=sop.inputs(rid), expected_output=expected, metadata={"row_index": rid})

        class _Meta:
            output_columns = sop.output_columns

        class _Bench:
            metadata = _Meta()
            sop_text = ""

        benchmark = _Bench()
        benchmark.tools = tools
    else:
        task = benchmark.tasks[rid]
    ev = object.__new__(ev_mod.Evaluator)
    ev.benchmark, ev.parser, ev.config = benchmark, up.output_parser(), up.evaluator.get_config()
    agent = ScriptedAgent(up, list(calls), text)
    ev.agent = agent
    with contextlib.redirect_stdout(sys.stderr):
        res = ev.run_single_task(task)
    pred = res.predicted_output
    return {"pass": bool(res.success), "predicted": pred if isinstance(pred, (dict, str, type(None))) else str(pred),
            "error": (res.error or "")[:300] or None}, getattr(agent, "log", [])


# ----------------------------------------------------------------------------------------------------------------
# Mailbox (verbatim from experiments/autobench/bridge.py Mailbox: the agent controls every name in the directory)
# ----------------------------------------------------------------------------------------------------------------

class Mailbox:
    """The agent-writable mailbox, seen from the host. The bridge runs OUTSIDE the executor sandbox with the host's
    rights, and the agent controls every name in this directory, so nothing here may follow a link: the directory is
    opened once (before the session starts) and every later access is relative to that descriptor; requests are opened
    O_NOFOLLOW|O_NONBLOCK and must be regular files with one link; answers are written to a fresh exclusive temp name
    and renamed into place. A planted symlink, FIFO, directory or hard link gets the same refusal whatever it points at,
    so the mailbox is neither a write-anywhere primitive nor an existence oracle for host paths."""

    REQ = re.compile(r"req-(\d+)\.json")

    def __init__(self, box: Path):
        box.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(box, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def requests(self):
        return sorted(int(m.group(1)) for f in os.listdir(self.fd) if (m := self.REQ.fullmatch(f)))

    def answered(self, n: int) -> bool:
        try:
            os.stat(f"res-{n}.json", dir_fd=self.fd, follow_symlinks=False)
            return True
        except FileNotFoundError:
            return False

    def read(self, n: int) -> bytes:
        try:
            fd = os.open(f"req-{n}.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0), dir_fd=self.fd)
        except OSError:
            raise ValueError("request refused: not a regular file") from None
        try:
            st = os.fstat(fd)
            if not _stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
                raise ValueError("request refused: not a regular file")
            if st.st_size > MAX_REQUEST_BYTES:
                raise ValueError(f"request larger than {MAX_REQUEST_BYTES} bytes")
            chunks, size = [], 0
            while (b := os.read(fd, 65536)):
                chunks.append(b)
                size += len(b)
                if size > MAX_REQUEST_BYTES:
                    raise ValueError(f"request larger than {MAX_REQUEST_BYTES} bytes")
            return b"".join(chunks)
        finally:
            os.close(fd)

    def answer(self, n: int, obj):
        tmp = f".bridge-res-{n}-{secrets.token_hex(8)}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0), 0o644, dir_fd=self.fd)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(obj, ensure_ascii=False))
            os.replace(tmp, f"res-{n}.json", src_dir_fd=self.fd, dst_dir_fd=self.fd)  # replaces a planted link itself
        except OSError:
            try:
                os.unlink(tmp, dir_fd=self.fd)
            except OSError:
                pass


class Rollout:
    """One row's tool session. A step is one request (one `call` or `batch` of the client); at most max_steps steps
    run (upstream's function-calling agent: 10 model calls, function_calling.py:228)."""

    def __init__(self, world: World, max_steps: int):
        self.world, self.max_steps = world, max_steps
        self.steps, self.log = 0, []

    def batch(self, calls: list) -> dict:
        if self.steps >= self.max_steps:
            self.log.append({"refused": "step limit", "t": time.time(), "calls": len(calls)})
            return {"error": f"step limit reached: this task allows {self.max_steps} tool steps"}
        self.steps += 1
        out = []
        for c in calls:
            if not isinstance(c, dict) or not isinstance(c.get("name"), str):
                rec = {"name": None, "error": "request", "content": "Error: each call is {\"name\": ..., \"arguments\": ...}", "t": time.time()}
            else:
                rec = self.world.call(c["name"], c.get("arguments", "{}"))
            rec["step"] = self.steps
            self.log.append(rec)
            out.append({"name": rec.get("name"), "content": rec["content"]})
        return {"results": out}


def _serve_loop(r: Rollout, box: Mailbox, poll: float):
    served, stop = set(), False
    while True:
        for n in box.requests():
            if n in served or box.answered(n):
                continue
            served.add(n)
            try:
                req = json.loads(box.read(n).decode("utf-8"))
                calls = req.get("calls") if isinstance(req, dict) else None
                if not isinstance(calls, list) or not calls or not all(isinstance(c, dict) for c in calls):
                    raise ValueError("a request is {\"calls\": [{\"name\": ..., \"arguments\": \"<json>\"}, ...]}")
                res = r.batch(calls)
            except Exception as e:  # noqa: BLE001
                res = {"error": f"{type(e).__name__}: {e}"}
            box.answer(n, res)
        if stop:
            return
        ready, _, _ = select.select([sys.stdin], [], [], poll)
        if ready:
            line = sys.stdin.readline()
            if line == "" or line.strip() == "stop":
                stop = True


# ----------------------------------------------------------------------------------------------------------------
# Commands
# ----------------------------------------------------------------------------------------------------------------

def _up(a):
    return _load_sibling("upstream").Upstream(a.upstream)


def _data_dir(a, up=None):
    return Path(a.data_dir) if a.data_dir else (up.data if up else Path(a.upstream).resolve() / "src" / "amazon_sop_bench" / "benchmarks" / "data")


def _stub_tools(path: Path):
    """Tool methods whose body is only `pass` (after the docstring): they return None (static, nothing runs)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            body = [b for b in node.body if not (isinstance(b, ast.Expr) and isinstance(getattr(b, "value", None), ast.Constant))]
            if len(body) == 1 and isinstance(body[0], ast.Pass):
                out.append(node.name)
    return out


def _compare_single(pred: str, exp_str: str, exp_isna: bool) -> bool:
    """parser.py:464-519, used only for the aggregate label statistics in `stats` (grading calls upstream itself)."""
    p = pred.lower().strip()
    e = exp_str.lower().strip()
    if (p in NULLS) and (exp_isna or e in NULLS):
        return True
    if (p in NULLS) or (exp_isna or e in NULLS):
        return False
    if p == e:
        return True
    pc, ec = p.replace("_", " ").replace("-", " "), e.replace("_", " ").replace("-", " ")
    return pc == ec or pc in ec or ec in pc


def cmd_stats(a):
    up = _up(a)
    data = _data_dir(a, up)
    loader = up.benchmark_loader()
    out = []
    for name in list_sops(data):
        sop = Sop(data, name)
        rec = {"sop": name, "rows": sop.n, "columns": len(sop.df.columns), "output_columns": sop.output_columns,
               "input_columns": len(sop.input_columns), "inputs_source": sop.inputs_source, "tools": len(sop.tool_names),
               "stub_tools": _stub_tools(sop.dir / "tools.py"), "sop_chars": len((sop.dir / "sop.txt").read_text(encoding="utf-8", errors="replace")),
               "files": sorted(p.name for p in sop.dir.iterdir() if p.is_file() and not p.name.endswith(".jpg"))}
        try:
            with contextlib.redirect_stdout(sys.stderr):
                b = loader.load(name)
            leak = sorted({c for t in b.tasks for c in t.inputs if c in sop.output_columns})
            rec["upstream_loader"] = {"ok": True, "tasks": len(b.tasks), "inputs_per_task": len(b.tasks[0].inputs), "outputs_in_inputs": leak}
        except Exception as e:  # noqa: BLE001
            rec["upstream_loader"] = {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}
        first = sop.df.columns[0]
        idcols = [c for c in sop.df.columns if c == first or re.search(r"(^|_)id$", c, re.I)]
        rec["key_duplicates"] = {c: int(sop.df[c].duplicated().sum()) for c in idcols}
        # Aggregate label statistics (counts only; no row value is printed).
        labels = {}
        for c in sop.output_columns:
            col = sop.df[c]
            vals = [("" if sop.pd.isna(v) else str(v)) for v in col]
            distinct = sorted(set(vals))
            pairs = [(x, y) for x in distinct for y in distinct if x != y and _compare_single(x.lower(), y, y == "")]
            labels[c] = {"distinct": len(distinct), "null_like": sum(1 for v, raw in zip(vals, col) if sop.pd.isna(raw) or v.lower().strip() in NULLS),
                         "fuzzy_collision_pairs": len(pairs), "majority_share": round(max(vals.count(v) for v in distinct) / len(vals), 3)}
        rec["labels"] = labels
        rec["dtypes_of_outputs"] = {c: str(sop.df[c].dtype) for c in sop.output_columns}
        out.append(rec)
    print(json.dumps(out, indent=1, default=py_default))


def cmd_rows(a):
    data = _data_dir(a)
    out = {}
    for name in (a.sops.split(",") if a.sops else list_sops(data)):
        sop = Sop(data, name)
        out[name] = {"n": sop.n, "testFileSha256": file_sha(sop.dir / TEST_FILE), "rowHashes": [sop.row_hash(i) for i in range(sop.n)],
                     "output_columns": sop.output_columns}
    print(json.dumps(out))


def _parse_rows(s):
    return [int(x) for x in str(s).split(",") if x.strip() != ""]


def cmd_prepare(a):
    data = _data_dir(a)
    split = load_split(Path(a.split))
    sop = Sop(data, a.sop)
    rows = _parse_rows(a.rows)
    allowed = allowed_rows(split, a.sop, sealed=a.sealed, freeze=Path(a.freeze) if a.freeze else None)
    check_rows(rows, allowed, a.sop)
    out = Path(a.out)
    (out / "rows").mkdir(parents=True, exist_ok=True)
    (out / "sop.txt").write_text((sop.dir / "sop.txt").read_text(encoding="utf-8", errors="replace"), encoding="utf-8")
    write_json(out / "catalog.json", sop.catalog())
    contract = sop.contract()
    meta = {"sop": a.sop, "output_columns": sop.output_columns, "input_columns": sop.input_columns, "inputs_source": sop.inputs_source,
            "n": sop.n, "contract_sha256": sha(contract), "contract": contract, "splitSha256": split["splitSha256"], "sealed": bool(a.sealed)}
    write_json(out / "meta.json", meta)
    for rid in rows:
        d = out / "rows" / str(rid)
        write_json(d / "task.json", {"sop": a.sop, "row": rid, "inputs": jsonsafe(sop.inputs(rid)), "task_text": sop.task_text(rid), "output_columns": sop.output_columns,
                                     "row_sha256": sop.row_hash(rid)})
        write_json(d / "expected.json", {"sop": a.sop, "row": rid, "output_columns": sop.output_columns, "expected": sop.expected_export(rid)})
    emit("prepared", sop=a.sop, rows=len(rows), contract=meta["contract_sha256"])


def _world(a, up, sop_name):
    data = _data_dir(a, up)
    split = load_split(Path(a.split))
    sop = Sop(data, sop_name)
    allowed = allowed_rows(split, sop_name, sealed=a.sealed, freeze=Path(a.freeze) if a.freeze else None)
    return sop, allowed, World(up, sop, allowed)


def _finish(host: Path, r: Rollout, world: World, meta: dict):
    host.mkdir(parents=True, exist_ok=True)
    with open(host / "calls.jsonl", "w", encoding="utf-8") as f:
        for rec in r.log:
            f.write(json.dumps(jsonsafe(rec), ensure_ascii=False) + "\n")
    write_json(host / "serve.json", {**meta, "steps": r.steps, "calls": sum(1 for x in r.log if "name" in x),
                                     "upstreamFatal": sum(1 for x in r.log if x.get("upstreamFatal")), "worldReads": sorted(set(world.proxy.reads)),
                                     "alignment": world.alignment})


def cmd_serve(a):
    up = _up(a)
    sop, allowed, world = _world(a, up, a.sop)
    rid = int(a.row)
    check_rows([rid], allowed, a.sop)
    r = Rollout(world, a.max_steps)
    box = Mailbox(Path(a.mailbox))  # opened before 'ready', i.e. before the session can touch the workdir
    emit("ready", sop=a.sop, row=rid, pid=os.getpid())
    _serve_loop(r, box, a.poll)
    _finish(Path(a.host), r, world, {"sop": a.sop, "row": rid, "sealed": bool(a.sealed), "maxSteps": a.max_steps})
    emit("done", steps=r.steps)


def cmd_replay(a):
    up = _up(a)
    sop, allowed, world = _world(a, up, a.sop)
    rid = int(a.row)
    check_rows([rid], allowed, a.sop)
    r = Rollout(world, a.max_steps)
    results = []
    for step in load_json(a.steps):
        if step.get("calls"):
            results.append(r.batch(step["calls"]))
    _finish(Path(a.host), r, world, {"sop": a.sop, "row": rid, "sealed": bool(a.sealed), "maxSteps": a.max_steps})
    print(canon({"steps": r.steps, "results": results}))


def cmd_grade(a):
    """Input: JSONL of {"sop", "row", "text"}. Output: JSONL of {"sop", "row", "upstream": {...}, "strict": {...}}."""
    up = _up(a)
    data = _data_dir(a, up)
    split = load_split(Path(a.split))
    sops, allowed = {}, {}
    out = []
    for line in Path(a.answers).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        q = json.loads(line)
        name, rid = q["sop"], int(q["row"])
        if name not in sops:
            sops[name] = Sop(data, name)
            allowed[name] = allowed_rows(split, name, sealed=a.sealed, freeze=Path(a.freeze) if a.freeze else None)
        check_rows([rid], allowed[name], name)
        sop = sops[name]
        uv, _ = upstream_verdict(up, sop, rid, q.get("text") or "")
        out.append({"sop": name, "row": rid, "id": q.get("id"), "upstream": uv,
                    "strict": strict_verdict(q.get("text") or "", sop.expected_export(rid), sop.output_columns)})
    with open(a.out, "w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(jsonsafe(r), ensure_ascii=False) + "\n")
    emit("graded", n=len(out))


def cmd_official(a):
    """Reference path for parity. Input JSONL {"sop","row","calls":[...],"text"}; dev rows only unless sealed+freeze.
    Uses upstream's own BenchmarkLoader (unfiltered world, upstream's task construction) where it loads the SOP;
    where it cannot (stats: upstream_loader.ok false), upstream's tools on the unfiltered world with our Task."""
    up = _up(a)
    data = _data_dir(a, up)
    split = load_split(Path(a.split))
    loader = up.benchmark_loader()
    benches, out = {}, []
    for line in Path(a.answers).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        q = json.loads(line)
        name, rid = q["sop"], int(q["row"])
        check_rows([rid], allowed_rows(split, name, sealed=a.sealed, freeze=Path(a.freeze) if a.freeze else None), name)
        if name not in benches:
            sop = Sop(data, name)
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    b = loader.load(name)
                benches[name] = (sop, b, None)
            except Exception as e:  # noqa: BLE001
                w = World(up, sop, None)  # unfiltered: the upstream-identical world
                benches[name] = (sop, None, (w.tm, f"{type(e).__name__}: {str(e)[:160]}"))
        sop, b, fb = benches[name]
        if b is not None:
            uv, log = upstream_verdict(up, sop, rid, q.get("text") or "", benchmark=b, calls=q.get("calls") or [], tools=b.tools)
            # Upstream's own task inputs for this row (legacy mode passes the whole row).
            task_inputs = sorted(b.tasks[rid].inputs.keys())
        else:
            uv, log = upstream_verdict(up, sop, rid, q.get("text") or "", calls=q.get("calls") or [], tools=fb[0])
            task_inputs = None
        out.append({"sop": name, "row": rid, "id": q.get("id"), "upstream": uv, "calls": [{k: v for k, v in c.items() if k != "t"} for c in log],
                    "loader": "upstream" if b is not None else f"ours (upstream loader failed: {fb[1]})", "upstreamTaskInputs": task_inputs})
    with open(a.out, "w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(jsonsafe(r), ensure_ascii=False) + "\n")
    emit("official", n=len(out))


def cmd_probe(a):
    """Tool determinism on dev rows: each tool whose parameters can all be filled from the row's own columns (the full
    row: intermediate values included, so downstream tools can be reached) is called twice; the two JSON results are
    compared. Prints per SOP and tool: calls, errors, nondeterministic count, and the upstreamFatal count."""
    up = _up(a)
    data = _data_dir(a, up)
    split = load_split(Path(a.split))
    report = {}
    for name in (a.sops.split(",") if a.sops else sorted(split["sops"])):
        sop, allowed, world = _world(a, up, name)
        rows = sorted(allowed)
        per = {}
        for spec in sop.catalog():
            props = spec["input_schema"].get("properties", {}) or {}
            req = spec["input_schema"].get("required", list(props))
            st = {"calls": 0, "errors": 0, "nondeterministic": 0, "upstreamFatal": 0, "skipped": 0, "none_results": 0}
            for rid in rows:
                row = sop.row(rid)
                if not all(p in row for p in req):
                    st["skipped"] += 1
                    continue
                args = {p: (py_default(row[p]) if not isinstance(row[p], str) else row[p]) for p in props if p in row}
                args = {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in args.items()}
                r1, r2 = world.call(spec["name"], dict(args)), world.call(spec["name"], dict(args))
                st["calls"] += 1
                st["errors"] += int(not r1.get("ok"))
                st["upstreamFatal"] += int(bool(r1.get("upstreamFatal")))
                st["none_results"] += int(r1.get("content") == "null")
                st["nondeterministic"] += int(r1.get("content") != r2.get("content"))
            per[spec["name"]] = st
        report[name] = {"rows": len(rows), "tools": per}
    print(json.dumps(report, indent=1))


def cmd_worldcheck(a):
    """World-filter invariance on dev rows: every tool whose parameters can all be filled from a dev row's own columns is
    called with them in the dev world and in the full (upstream-identical) world, twice there (a tool whose two full-world
    results differ is nondeterministic, not a world effect). Prints, per SOP, the (row, tool) pairs whose dev-world result
    differs from a deterministic full-world result: rows whose lookup key also belongs to an earlier row outside the dev
    world, where upstream answers with that other row's data. Results themselves are not printed. Diagnostic; reads the
    full world only to compare results for dev-row arguments."""
    up = _up(a)
    data = _data_dir(a, up)
    split = load_split(Path(a.split))
    report = {}
    for name in (a.sops.split(",") if a.sops else sorted(split["sops"])):
        sop = Sop(data, name)
        allowed = allowed_rows(split, name, sealed=False, freeze=None)
        dev, full = World(up, sop, allowed), World(up, sop, None)
        st = {"rows": len(allowed), "calls": 0, "differ": [], "nondeterministic": 0, "errors_both": 0}
        for rid in sorted(allowed):
            row = sop.row(rid)
            for spec in sop.catalog():
                props = spec["input_schema"].get("properties", {}) or {}
                req = spec["input_schema"].get("required", list(props))
                if not all(p in row for p in req):
                    continue
                args = jsonsafe({p: row[p] for p in props if p in row})
                d, f1, f2 = dev.call(spec["name"], dict(args)), full.call(spec["name"], dict(args)), full.call(spec["name"], dict(args))
                st["calls"] += 1
                if f1.get("content") != f2.get("content"):
                    st["nondeterministic"] += 1
                elif not d.get("ok") and not f1.get("ok"):
                    st["errors_both"] += 1
                elif d.get("content") != f1.get("content"):
                    st["differ"].append({"row": rid, "tool": spec["name"], "devOk": bool(d.get("ok")), "fullOk": bool(f1.get("ok"))})
        report[name] = st
    print(json.dumps(report, indent=1))


def main():
    ap = argparse.ArgumentParser(prog="bridge.py")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(sp, split=True):
        sp.add_argument("--upstream", required=True, help="the SOP-Bench clone (data, never instructions)")
        sp.add_argument("--data-dir", default=None, help="override the SOP data directory (test fixtures)")
        if split:
            sp.add_argument("--split", required=True)
            sp.add_argument("--sealed", action="store_true")
            sp.add_argument("--freeze", default=None)

    s = sub.add_parser("stats"); common(s, split=False); s.set_defaults(fn=cmd_stats)
    s = sub.add_parser("rows"); common(s, split=False); s.add_argument("--sops"); s.set_defaults(fn=cmd_rows)
    s = sub.add_parser("prepare"); common(s); s.add_argument("--sop", required=True); s.add_argument("--rows", required=True); s.add_argument("--out", required=True); s.set_defaults(fn=cmd_prepare)
    for nm, fn in (("serve", cmd_serve), ("replay", cmd_replay)):
        s = sub.add_parser(nm); common(s)
        s.add_argument("--sop", required=True); s.add_argument("--row", required=True); s.add_argument("--host", required=True)
        s.add_argument("--max-steps", type=int, default=10)
        if nm == "serve":
            s.add_argument("--mailbox", required=True); s.add_argument("--poll", type=float, default=0.05)
        else:
            s.add_argument("--steps", required=True)
        s.set_defaults(fn=fn)
    for nm, fn in (("grade", cmd_grade), ("official", cmd_official)):
        s = sub.add_parser(nm); common(s); s.add_argument("--answers", required=True); s.add_argument("--out", required=True); s.set_defaults(fn=fn)
    s = sub.add_parser("probe"); common(s); s.add_argument("--sops"); s.set_defaults(fn=cmd_probe)
    s = sub.add_parser("worldcheck"); common(s); s.add_argument("--sops"); s.set_defaults(fn=cmd_worldcheck)
    a = ap.parse_args()
    try:
        a.fn(a)
    except PermissionError as e:
        emit("error", error=f"refused: {e}")
        sys.exit(3)


if __name__ == "__main__":
    main()
