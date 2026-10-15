#!/usr/bin/env python3
"""AutomationBench bridge (experiments/autobench, research/automationbench-20261014/NOTES.md).

Runs ONLY inside AutomationBench's own venv, isolated mode, from a neutral working directory:

    corpus/AutomationBench/.venv/bin/python -I experiments/autobench/bridge.py <command> ...

It loads tasks exactly as the official eval does (automationbench.scripts.eval: get_combined_dataset, the --tasks
filter, AutomationBenchEnv(toolset="api", max_turns=50), the verifiers input rows), and replaces only the model loop:

  prepare   official dataset -> one directory per task: input.json (the exact rollout input), prompt.json (what the
            agent sees: system + user content), catalog.json (the 'api' tool defs as the env hands them to a client),
            world0.json (the initial world after the env's own setup_state), meta.json (contract sha256, services).
  serve     one rollout: the env's setup_state, then tool-call batches read from a file mailbox are run through the
            env's own env_response (argument parsing, {} stripping, world injection, error formatting), until the
            host says stop on stdin; then the official rubric (create_rubric) grades the live world. Grades, the
            final world and the call log go to a HOST-ONLY directory, never into the mailbox.
  replay    the same as serve, with the batches read from a file instead of a mailbox (in-process, for tests).
  official  the reference path for parity: AutomationBenchEnv.evaluate() with a scripted vf.Client that returns
            the given tool calls as model responses (no model, no mailbox).
  vote      N-version majority over forks: canonical final-state diffs (generator outputs masked), largest group.
  grade     grade an exported world (diagnostic; the run path grades the live world in serve).

Determinism (--det): AutomationBench's simulated apps draw ids from uuid4/random and timestamps from the wall clock,
so two official runs of the same action sequence differ in those values. The shim below makes those draws visible:
  record  (default) real values, every draw by automationbench code is logged (vote masks exactly those values);
  seed    draws come from a seeded RNG and a logical clock (task current_time + 1 ms per read), for exact parity;
  off     nothing is patched.
The shim is caller-aware (only frames in automationbench.* get shimmed values) and is applied identically to the
bridge path and the official path.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as _dt_mod
import hashlib
import importlib
import inspect
import json
import os
import pkgutil
import random as _random_mod
import re
import secrets
import select
import stat as _stat
import sys
import time as _time_mod
import traceback
import uuid as _uuid_mod
from pathlib import Path

PROTO = "@@bridge "
REAL_DT = _dt_mod.datetime
REAL_UUID4 = _uuid_mod.uuid4
REAL_TIME = _time_mod.time
RANDOM_FUNCS = ("random", "randint", "randrange", "choice", "choices", "sample", "shuffle", "uniform", "getrandbits")
REAL_RANDOM = {n: getattr(_random_mod, n) for n in RANDOM_FUNCS}
MAX_REQUEST_BYTES = 1_000_000


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256((obj if isinstance(obj, str) else canon(obj)).encode("utf-8")).hexdigest()


def emit(kind: str, **data):
    sys.stdout.write(PROTO + canon({"kind": kind, **data}) + "\n")
    sys.stdout.flush()


def write_json(path: Path, obj, indent=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=indent, sort_keys=indent is not None))
    os.replace(tmp, path)


# ----------------------------------------------------------------------------------------------------------------
# Determinism shim
# ----------------------------------------------------------------------------------------------------------------

def _is_ab(frame) -> bool:
    return str(frame.f_globals.get("__name__", "")).startswith("automationbench")


class _DTMeta(type):
    def __instancecheck__(cls, obj):
        return isinstance(obj, REAL_DT)

    def __subclasscheck__(cls, sub):
        return issubclass(sub, REAL_DT)


class ShimDatetime(REAL_DT, metaclass=_DTMeta):
    """Stands in for datetime.datetime inside automationbench modules. It is never instantiated: every constructor
    returns a real datetime, so values and types are unchanged; only now/utcnow/today read the shim's clock."""

    def __new__(cls, *a, **k):
        return REAL_DT(*a, **k)

    @classmethod
    def now(cls, tz=None):
        return SHIM.now(tz) if _is_ab(sys._getframe(1)) else REAL_DT.now(tz)

    @classmethod
    def utcnow(cls):
        return SHIM.utcnow() if _is_ab(sys._getframe(1)) else REAL_DT.now(_dt_mod.timezone.utc).replace(tzinfo=None)

    @classmethod
    def today(cls):
        return SHIM.now(None) if _is_ab(sys._getframe(1)) else REAL_DT.today()

    @classmethod
    def fromisoformat(cls, s):
        return REAL_DT.fromisoformat(s)

    @classmethod
    def strptime(cls, s, f):
        return REAL_DT.strptime(s, f)

    @classmethod
    def fromtimestamp(cls, *a, **k):
        return REAL_DT.fromtimestamp(*a, **k)

    @classmethod
    def utcfromtimestamp(cls, t):
        return REAL_DT.fromtimestamp(t, _dt_mod.timezone.utc).replace(tzinfo=None)

    @classmethod
    def combine(cls, *a, **k):
        return REAL_DT.combine(*a, **k)

    @classmethod
    def fromordinal(cls, n):
        return REAL_DT.fromordinal(n)

    @classmethod
    def fromisocalendar(cls, *a):
        return REAL_DT.fromisocalendar(*a)

    @classmethod
    def __get_pydantic_core_schema__(cls, source, handler):
        return handler(REAL_DT)


class Shim:
    def __init__(self):
        self.mode = "off"
        self.installed = False
        self.reset(0, None)

    # -- state ---------------------------------------------------------------------------------------------------
    def reset(self, seed: int, base: REAL_DT | None):
        self.seed = seed
        self.rng = _random_mod.Random(seed)
        self.urng = _random_mod.Random(seed ^ 0x5EED5EED)
        self.base = base or REAL_DT(2026, 1, 1, tzinfo=_dt_mod.timezone.utc)
        self.tick = 0
        self.wall0 = REAL_TIME()
        self.gen = {"uuid": [], "rand": [], "clock": []}

    def _clock(self) -> REAL_DT:
        t = self.base + _dt_mod.timedelta(milliseconds=self.tick)
        self.tick += 1
        return t

    def now(self, tz=None):
        if self.mode == "seed":
            t = self._clock()
            v = t.astimezone(tz) if tz is not None else t.astimezone().replace(tzinfo=None)
        else:
            v = REAL_DT.now(tz)
        self.gen["clock"].append(v.timestamp())
        return v

    def utcnow(self):
        if self.mode == "seed":
            v = self._clock().replace(tzinfo=None)
            self.gen["clock"].append(v.replace(tzinfo=_dt_mod.timezone.utc).timestamp())
            return v
        v = REAL_DT.now(_dt_mod.timezone.utc)
        self.gen["clock"].append(v.timestamp())
        return v.replace(tzinfo=None)

    def time(self):
        v = self._clock().timestamp() if self.mode == "seed" else REAL_TIME()
        self.gen["clock"].append(v)
        return v

    def uuid4(self):
        v = _uuid_mod.UUID(int=self.urng.getrandbits(128), version=4) if self.mode == "seed" else REAL_UUID4()
        self.gen["uuid"].append(v.hex)
        return v

    def rand(self, name, *a, **k):
        v = getattr(self.rng, name)(*a, **k) if self.mode == "seed" else REAL_RANDOM[name](*a, **k)
        self.gen["rand"].append(v if name != "shuffle" else None)
        return v

    def generated(self):
        return {"mode": self.mode, "seed": self.seed, "base": self.base.isoformat(), "ticks": self.tick,
                "wall0": self.wall0, "wall1": REAL_TIME(), **{k: list(v) for k, v in self.gen.items()}}

    # -- install -------------------------------------------------------------------------------------------------
    def install(self, mode: str):
        if mode not in ("off", "record", "seed"):
            raise SystemExit(f"--det must be off, record or seed (got {mode})")
        self.mode = mode
        if mode == "off" or self.installed:
            return
        self.installed = True
        _import_all_automationbench()
        # 1. pydantic default factories bound to the C datetime.now at import time: replace, then rebuild the models
        #    (dependencies first) BEFORE module names are swapped, so annotations still resolve to the real datetime.
        from pydantic import BaseModel
        models = sorted({v for m in list(sys.modules.values()) if getattr(m, "__name__", "").startswith("automationbench")
                         for v in vars(m).values() if inspect.isclass(v) and issubclass(v, BaseModel)
                         and v.__module__.startswith("automationbench")}, key=lambda c: (c.__module__, c.__qualname__))
        factory = lambda: SHIM.now(None)  # noqa: E731  (datetime.now() with no tz: local naive)
        bound = 0
        for cls in models:
            for fi in cls.model_fields.values():
                f = fi.default_factory
                if getattr(f, "__self__", None) is REAL_DT and getattr(f, "__name__", "") == "now":
                    fi.default_factory = factory
                    bound += 1
        deps = {c: {d for d in models if d is not c and any(d.__name__ in repr(fi.annotation) for fi in c.model_fields.values())} for c in models}
        done, order = set(), []

        def visit(c, stack=()):
            if c in done or c in stack:
                return
            for d in sorted(deps[c], key=lambda x: (x.__module__, x.__qualname__)):
                visit(d, stack + (c,))
            done.add(c)
            order.append(c)
        for c in models:
            visit(c)
        for c in order:
            c.model_rebuild(force=True)
        self.bound_factories = bound
        # 2. module-level names inside automationbench: `from datetime import datetime`, `from uuid import uuid4`.
        for name, m in list(sys.modules.items()):
            if not name.startswith("automationbench") or m is None:
                continue
            d = vars(m)
            if d.get("datetime") is REAL_DT:
                m.datetime = ShimDatetime
            if d.get("uuid4") is REAL_UUID4:
                m.uuid4 = lambda: SHIM.uuid4()
        # 3. module attributes read at call time (`import uuid; uuid.uuid4()`, `random.randint`, `time.time()`), caller-aware.

        def uuid4():
            return SHIM.uuid4() if _is_ab(sys._getframe(1)) else REAL_UUID4()
        _uuid_mod.uuid4 = uuid4

        def timefn():
            return SHIM.time() if _is_ab(sys._getframe(1)) else REAL_TIME()
        _time_mod.time = timefn
        for n in RANDOM_FUNCS:
            def w(*a, _n=n, **k):
                return SHIM.rand(_n, *a, **k) if _is_ab(sys._getframe(1)) else REAL_RANDOM[_n](*a, **k)
            setattr(_random_mod, n, w)

    class _Active:
        def __enter__(self):
            if SHIM.installed:
                self.prev = _dt_mod.datetime
                _dt_mod.datetime = ShimDatetime  # function-local `from datetime import datetime` (quickbooks/xero/wave tools)
            return self

        def __exit__(self, *exc):
            if SHIM.installed:
                _dt_mod.datetime = self.prev
            return False

    def active(self):
        return Shim._Active()


SHIM = Shim()


def _import_all_automationbench():
    import automationbench
    skip = ("automationbench.scripts", "automationbench.batch", "automationbench.clients", "automationbench.console",
            "automationbench.export", "automationbench.usage", "automationbench.pricing")
    for m in pkgutil.walk_packages(automationbench.__path__, "automationbench."):
        if m.name.startswith(skip):
            continue
        importlib.import_module(m.name)


def task_seed(task_name: str, fork: int = 0) -> int:
    return int(hashlib.sha256(f"{task_name}#{fork}".encode()).hexdigest()[:12], 16)


def task_base_time(info: dict) -> REAL_DT | None:
    cur = ((info.get("initial_state") or {}).get("meta") or {}).get("current_time")
    if not cur:
        return None
    try:
        t = REAL_DT.fromisoformat(str(cur).replace("Z", "+00:00"))
        return t if t.tzinfo else t.replace(tzinfo=_dt_mod.timezone.utc)
    except ValueError:
        return None


# ----------------------------------------------------------------------------------------------------------------
# Official environment access
# ----------------------------------------------------------------------------------------------------------------

def official_modules():
    from automationbench.domains import DEFAULT_DOMAINS, DOMAINS, get_combined_dataset
    from automationbench.rubric import create_rubric
    from automationbench.runner import AutomationBenchEnv
    from automationbench.scripts.eval import _task_name
    from automationbench.task_contract import task_contract_sha256
    return dict(DEFAULT_DOMAINS=DEFAULT_DOMAINS, DOMAINS=DOMAINS, get_combined_dataset=get_combined_dataset,
                create_rubric=create_rubric, AutomationBenchEnv=AutomationBenchEnv, _task_name=_task_name,
                task_contract_sha256=task_contract_sha256)


def official_dataset(domains: list[str], tasks: list[str] | None):
    """eval.py run_evaluation: get_combined_dataset(domains), then the --tasks filter (same code)."""
    o = official_modules()
    dataset = o["get_combined_dataset"](domains)
    if tasks:
        indices = [i for i, row in enumerate(dataset) if o["_task_name"](row) in tasks]
        missing = set(tasks) - {o["_task_name"](dataset[i]) for i in indices}
        if missing:
            raise SystemExit(f"tasks not found in domains {domains}: {sorted(missing)}")
        dataset = dataset.select(indices)
    return dataset


def make_env(dataset, max_steps: int):
    """eval.py: AutomationBenchEnv(dataset, rubric=create_rubric(), max_turns=max_steps, toolset=toolset)."""
    o = official_modules()
    return o["AutomationBenchEnv"](dataset=dataset, rubric=o["create_rubric"](), max_turns=max_steps, toolset="api")


def hook_env(env, fork: int = 0):
    """Identical hooks for the bridge path and the official path: reset the shim per rollout, and mark tool execution
    as active (function-local datetime imports). The wrapped methods are the env's own."""
    setup, respond = env.setup_state, env.env_response

    def task_of(state):
        info = state.get("info", {})
        return json.loads(info) if isinstance(info, str) else info

    async def setup_state(state, **kw):
        info = task_of(state)
        SHIM.reset(task_seed(info.get("task_name", "?"), fork), task_base_time(info))
        with SHIM.active():
            out = await setup(state, **kw)
        GEN_SNAPSHOTS[info.get("task_name", "?")] = SHIM.generated()
        return out

    async def env_response(messages, state, **kw):
        with SHIM.active():
            out = await respond(messages, state, **kw)
        GEN_SNAPSHOTS[task_of(state).get("task_name", "?")] = SHIM.generated()
        return out
    env.setup_state, env.env_response = setup_state, env_response
    return env


GEN_SNAPSHOTS: dict[str, dict] = {}  # generator draws per task up to its last tool step (official path: one process, many tasks)


def _vf():
    import verifiers as vf
    from verifiers.clients import Client
    from verifiers.types import AssistantMessage, Response, ResponseMessage, ToolCall, Usage
    return vf, Client, AssistantMessage, Response, ResponseMessage, ToolCall, Usage


def make_scripted_client(scripts: dict[str, list[dict]]):
    """A vf.Client whose 'model' replays scripted steps: step i of a task is returned as the i-th model response.
    A step is {"calls": [{"name", "arguments"(str)}]} (tool calls) or {"final": text}; past the end: final."""
    vf, Client, AssistantMessage, Response, ResponseMessage, ToolCall, Usage = _vf()

    class ScriptedClient(Client):
        def __init__(self):
            super().__init__(object())

        def setup_client(self, config):
            return None

        async def to_native_tool(self, tool):
            return tool

        async def to_native_prompt(self, messages):
            return messages, {}

        async def get_native_response(self, prompt, model, sampling_args, tools=None, **kwargs):
            state = kwargs.get("state")
            name = state["info"]["task_name"]
            i = len(state["trajectory"])
            steps = scripts.get(name, [])
            step = steps[i] if i < len(steps) else {"final": "done"}
            return {"i": i, **step}

        async def raise_from_native_response(self, response):
            return None

        async def from_native_response(self, step):
            i = step["i"]
            if step.get("calls"):
                calls = [ToolCall(id=f"call_{i}_{j}", name=c["name"], arguments=c["arguments"]) for j, c in enumerate(step["calls"])]
                msg = ResponseMessage(content=None, tool_calls=calls, finish_reason="tool_calls", is_truncated=False)
            else:
                msg = ResponseMessage(content=step.get("final", "done"), tool_calls=None, finish_reason="stop", is_truncated=False)
            return Response(id=f"scripted-{i}", created=0, model="scripted", message=msg,
                            usage=Usage(prompt_tokens=0, reasoning_tokens=0, completion_tokens=0, total_tokens=0))

        async def close(self):
            return None

    return ScriptedClient()


class Rollout:
    """One rollout without a model loop: the env's init_state + setup_state, batches through env.env_response, the
    official rubric on the live world."""

    def __init__(self, input_row: dict, max_steps: int = 50, world_dump: dict | None = None, fork: int = 0):
        from datasets import Dataset
        self.input = input_row
        self.max_steps = max_steps
        self.env = hook_env(make_env(Dataset.from_list([input_row]), max_steps), fork)
        self.steps = 0
        self.log = []
        self.world_dump = world_dump
        self.fork = fork

    async def setup(self):
        client = make_scripted_client({})  # never asked for a response: the model loop is the mailbox
        state = await self.env.init_state(self.input, client, model="bridge", sampling_args=None)
        st = await self.env.setup_state(state)
        self.state = st if st is not None else state
        if self.world_dump is not None:
            from automationbench.schema.world import WorldState
            with SHIM.active():
                self.state["world"] = WorldState(**self.world_dump)
        return self.state

    @property
    def contract(self):
        return self.state.get("_task_contract_sha256")

    def catalog(self):
        return [{"name": t.name, "description": t.description, "parameters": t.parameters} for t in self.state["tool_defs"]]

    async def batch(self, calls: list[dict]) -> dict:
        """Run one model step's tool calls. The official env executes the tool calls of model responses 1..max-1; the
        response that reaches max_turns ends the rollout before its calls run."""
        _, _, AssistantMessage, _, _, ToolCall, _ = _vf()
        if self.steps >= self.max_steps - 1:
            return {"error": f"step budget exhausted: the environment allows {self.max_steps} model steps, so at most "
                             f"{self.max_steps - 1} tool-call steps run; this step was not executed"}
        self.steps += 1
        n = self.steps
        tcs = [ToolCall(id=f"call_{n}_{j}", name=str(c.get("name", "")), arguments=c.get("arguments") if isinstance(c.get("arguments"), str) else canon(c.get("arguments", {})))
               for j, c in enumerate(calls)]
        msg = AssistantMessage(content=None, tool_calls=tcs)
        out = await self.env.env_response([msg], self.state)
        results = [{"name": tc.name, "content": m.content if isinstance(m.content, str) else canon(m.content)} for tc, m in zip(tcs, out)]
        self.log.append({"step": n, "t": REAL_TIME(), "calls": [{"name": tc.name, "arguments": tc.arguments} for tc in tcs], "results": [r["content"] for r in results]})
        return {"step": n, "stepsLeft": self.max_steps - 1 - n, "results": results}

    def world(self) -> dict:
        return self.state["world"].model_dump(mode="json")

    async def grade(self) -> dict:
        rubric = official_modules()["create_rubric"]()
        err = None
        try:
            await rubric.score_rollout(self.state)
        except Exception as e:  # noqa: BLE001  (score_rollout already maps reward-function errors to 0.0)
            err = f"{type(e).__name__}: {e}"
        metrics = self.state.get("metrics") or {}
        ar = self.state.get("_assertion_results") or []
        return {"partial_credit": metrics.get("partial_credit", 0.0), "task_completed_correctly": metrics.get("task_completed_correctly", 0.0),
                "reward": self.state.get("reward"), "assertion_results": ar,
                "n_scored": sum(1 for a in ar if not a.get("excluded")), "n_passed": sum(1 for a in ar if not a.get("excluded") and a.get("passed")),
                "error": err, "contract_sha256": self.contract, "steps": self.steps}

    def finish(self, host: Path, grade: dict, generated: dict):
        """generated: the generator log snapshotted BEFORE grading. The rubric itself draws ids and clock reads (it
        rebuilds the initial world), and the vote masks with this log, so a post-grading snapshot would let the grader
        shape the vote's input."""
        write_json(host / "final-world.json", self.world())
        write_json(host / "grade.json", grade, indent=1)
        write_json(host / "generated.json", generated)
        with open(host / "calls.jsonl", "w") as f:
            for r in self.log:
                f.write(canon(r) + "\n")


def load_json(p):
    return json.loads(Path(p).read_text())


# ----------------------------------------------------------------------------------------------------------------
# Commands
# ----------------------------------------------------------------------------------------------------------------

def cmd_list(a):
    o = official_modules()
    domains = a.domains.split(",") if a.domains else list(o["DEFAULT_DOMAINS"])
    for d in domains:
        ds = o["DOMAINS"][d]()
        for row in ds:
            info = json.loads(row["info"])
            services = sorted(k for k in info["initial_state"] if k != "meta")
            print(canon({"task": info["task_name"], "domain": d, "example_id": row["example_id"],
                         "n_assertions": len(info["assertions"]), "services": services}))


def cmd_stats(a):
    """Per-domain task statistics (NOTES.md §2): assertion counts, guardrail share, assertions already true at start
    (excluded from scoring unless broken), services per task, current_time pinning, prompt length."""
    import statistics as st
    o = official_modules()
    from automationbench.rubric.registry import AssertionRegistry
    from automationbench.runner import compute_allowed_services
    from automationbench.schema.world import WorldState
    domains = a.domains.split(",") if a.domains else list(o["DOMAINS"])
    neg = lambda t: "_not_" in t or t.endswith("_not_exists") or t.startswith("no_")  # noqa: E731
    for d in domains:
        rows = list(o["DOMAINS"][d]())
        na, nn, free, svc, plen, pinned = [], [], [], [], [], 0
        for r in rows:
            info = json.loads(r["info"])
            A = info["assertions"]
            na.append(len(A))
            nn.append(sum(1 for x in A if neg(x["type"])))
            w0 = WorldState(**info["initial_state"])
            free.append(sum(1 for x in A if x.get("scored") is not False and x.get("excluded") is None and AssertionRegistry.check(w0, x)))
            svc.append(len(compute_allowed_services(info["initial_state"], A, info["zapier_tools"])))
            plen.append(sum(len(m["content"]) for m in r["prompt"] if m["role"] == "user"))
            pinned += 1 if (info["initial_state"].get("meta") or {}).get("current_time") else 0
        print(canon({"domain": d, "tasks": len(rows), "assertions_mean": round(st.mean(na), 1), "assertions_max": max(na),
                     "guardrail_share": round(sum(nn) / sum(na), 2), "true_at_start_mean": round(st.mean(free), 1),
                     "scored_at_start_mean": round(st.mean(na) - st.mean(free), 1), "services_mean": round(st.mean(svc), 1),
                     "services_max": max(svc), "current_time_pinned": pinned, "user_prompt_chars_median": int(st.median(plen)),
                     "user_prompt_chars_max": max(plen), "uses_excluded_or_scored_flags": sum(1 for r in rows for x in json.loads(r["info"])["assertions"] if "excluded" in x or "scored" in x)}))


def cmd_prepare(a):
    """One official dataset build for all selected tasks -> per-task directories under --out."""
    SHIM.install(a.det)
    o = official_modules()
    domains = a.domains.split(",") if a.domains else list(o["DEFAULT_DOMAINS"])
    tasks = [t for t in a.tasks.split(",") if t] if a.tasks else None
    dataset = official_dataset(domains, tasks)
    env = make_env(dataset, a.max_steps)
    inputs = env._get_eval_inputs(-1, 1)
    # api_search caches its BM25 index in the package directory (index.txt). Warm it once here, so that concurrent
    # serve processes only ever read a complete file.
    from automationbench.tools.api import api_search
    api_search("messages send", top_k=1)
    out = Path(a.out)
    names = []
    for row in inputs:
        info = json.loads(row["info"]) if isinstance(row["info"], str) else row["info"]
        name = info["task_name"]
        r = Rollout(row, a.max_steps)
        asyncio.run(r.setup())
        d = out / name
        prompt = [{"role": m.role, "content": m.content} for m in r.state["prompt"]]
        write_json(d / "input.json", row)
        write_json(d / "prompt.json", {"system": next((m["content"] for m in prompt if m["role"] == "system"), None),
                                       "user": "\n\n".join(m["content"] for m in prompt if m["role"] == "user"),
                                       "messages": prompt})
        write_json(d / "catalog.json", r.catalog())
        write_json(d / "world0.json", {"task": name, "contract_sha256": r.contract, "world": r.world()})
        write_json(d / "meta.json", {"task": name, "domain": name.split(".")[0], "example_id": row["example_id"],
                                     "contract_sha256": r.contract, "n_assertions": len(info["assertions"]),
                                     "services": r.state["world"].meta.allowed_services, "max_steps": a.max_steps})
        names.append(name)
    print(canon({"prepared": names, "out": str(out)}))


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


def _serve_loop(r: Rollout, box: Mailbox, poll: float):
    """Serve req-<n>.json files (complete, atomically renamed by tool.mjs) in numeric order; answer res-<n>.json.
    The host ends the rollout by writing 'stop' to stdin (or closing it). An answer carries only the tool results (the
    official loop does not tell the model its step count either); step accounting stays in the host-only call log."""
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
                out = asyncio.run(r.batch(calls))
                res = {"error": out["error"]} if "error" in out else {"results": out["results"]}
            except Exception as e:  # noqa: BLE001
                res = {"error": f"{type(e).__name__}: {e}"}
            box.answer(n, res)
        if stop:
            return
        ready, _, _ = select.select([sys.stdin], [], [], poll)
        if ready:
            line = sys.stdin.readline()
            if line == "" or line.strip() == "stop":
                stop = True  # one more pass: answer anything that arrived before the stop


def load_world(p):
    """A world file is either prepare's {"task", "contract_sha256", "world"} or a raw dump (final-world.json)."""
    w = load_json(p)
    return w["world"] if isinstance(w, dict) and set(w) >= {"world", "task"} else w


def cmd_serve(a):
    SHIM.install(a.det)
    row = load_json(a.input)
    world = load_world(a.world) if a.world else None
    r = Rollout(row, a.max_steps, world, a.fork)
    asyncio.run(r.setup())
    if a.expect_contract and r.contract != a.expect_contract:
        emit("error", error=f"task contract drift: {r.contract} != {a.expect_contract}")
        sys.exit(3)
    host = Path(a.host)
    box = Mailbox(Path(a.mailbox))  # opened before 'ready', i.e. before the session can touch the workdir
    emit("ready", contract=r.contract, pid=os.getpid())
    _serve_loop(r, box, a.poll)
    gen = SHIM.generated()
    grade = asyncio.run(r.grade())
    r.finish(host, grade, gen)
    emit("done", steps=r.steps, partial_credit=grade["partial_credit"], task_completed_correctly=grade["task_completed_correctly"])


def cmd_replay(a):
    SHIM.install(a.det)
    row = load_json(a.input)
    world = load_world(a.world) if a.world else None
    r = Rollout(row, a.max_steps, world, a.fork)
    asyncio.run(r.setup())
    for step in load_json(a.steps):
        if step.get("calls"):
            asyncio.run(r.batch(step["calls"]))
    gen = SHIM.generated()
    grade = asyncio.run(r.grade())
    r.finish(Path(a.host), grade, gen)
    print(canon({"steps": r.steps, "partial_credit": grade["partial_credit"], "task_completed_correctly": grade["task_completed_correctly"]}))


def cmd_official(a):
    """Reference path: the official env's evaluate() with a scripted client, exactly as eval.py drives it."""
    SHIM.install(a.det)
    o = official_modules()
    scripts = load_json(a.scripts)
    domains = a.domains.split(",") if a.domains else sorted({t.split(".")[0] for t in scripts})
    dataset = official_dataset(domains, list(scripts))
    env = hook_env(make_env(dataset, a.max_steps), 0)
    results = asyncio.run(env.evaluate(client=make_scripted_client(scripts), model="scripted", sampling_args=None, num_examples=-1,
                                       rollouts_per_example=1, max_concurrent=1,
                                       state_columns=["_usage", "_debug", "_assertion_results", "_end_state", "_perf"],
                                       on_start=lambda *x: None, on_progress=lambda *x: None))
    out = {}
    for ro in results["outputs"]:
        name = o["_task_name"](ro)
        tool_msgs = []
        for m in ro.get("completion") or []:
            role = m.get("role") if isinstance(m, dict) else getattr(m, "role", None)
            if role == "tool":
                c = m.get("content") if isinstance(m, dict) else m.content
                tool_msgs.append(c if isinstance(c, str) else canon(c))
        metrics = ro.get("metrics") or {}
        out[name] = {"partial_credit": metrics.get("partial_credit"), "task_completed_correctly": metrics.get("task_completed_correctly"),
                     "reward": ro.get("reward"), "assertion_results": ro.get("_assertion_results"), "final_world": ro.get("_end_state"),
                     "tool_results": tool_msgs, "error": str(ro.get("error")) if ro.get("error") else None,
                     "stop_condition": ro.get("stop_condition"), "generated": GEN_SNAPSHOTS.get(name)}
    write_json(Path(a.out), out)
    print(canon({"tasks": sorted(out), "out": a.out}))


# -- voting --------------------------------------------------------------------------------------------------------

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$")


_UUIDISH = re.compile(r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}")
_HEXRUN = re.compile(r"[0-9A-Fa-f](?:[0-9A-Fa-f-]*[0-9A-Fa-f])?")
_DIGITS5 = re.compile(r"(?<![0-9])[0-9]{5,}(?![0-9])")


class Volatile:
    """What AutomationBench's generators produced in one rollout, for masking a fork's final world before voting.

    Whole leaves (is_vol): a random int draw, a clock read (ISO string, date, epoch s/ms/us) within the rollout's clock
    window, a numeric string equal to an int draw. Fragments inside strings (sub): a hex run containing an 8-char window
    of a uuid4 drawn in the rollout, a uuid-shaped token that is not in the base world (ids built from other draws, e.g.
    Xero's hex-formatted randints), a joined random string draw, the id of a record the rollout created (new_ids), and
    a 5+ digit run equal to an int draw. A fragment is replaced by '<gen>' and the rest of the string is kept, so two
    forks that wrote different text around a fresh id do NOT agree (whole-leaf masking would have merged them)."""

    def __init__(self, gen: dict, base_tokens: set | None = None, new_ids: set | None = None):
        self.win8 = {h[i:i + 8] for h in gen.get("uuid", []) for i in range(len(h) - 7)}
        ints, strs = set(), set()
        for v in gen.get("rand", []):
            if isinstance(v, bool) or v is None:
                continue
            if isinstance(v, int):
                ints.add(v)
            elif isinstance(v, str) and len(v) >= 4:
                strs.add(v)
            elif isinstance(v, list) and v and all(isinstance(x, str) for x in v):
                j = "".join(v)
                if len(j) >= 4:
                    strs.add(j)
        # Only id-like new ids (no whitespace, a digit): an id an app derives from agent-written content (a title)
        # must not mask that content.
        strs |= {i for i in (new_ids or ()) if isinstance(i, str) and re.fullmatch(r"[\w.:-]{4,}", i) and re.search(r"\d", i)}
        self.ints = ints
        self.strs = sorted(strs, key=len, reverse=True)
        self.base_tokens = base_tokens or set()
        clock = gen.get("clock", [])
        self.clock = bool(clock)
        self.lo = min(clock + [gen.get("wall0", 0)]) - 2
        self.hi = max(clock + [gen.get("wall1", 0)]) + 2
        if gen.get("mode") == "seed" and clock:
            self.lo, self.hi = min(clock) - 0.002, max(clock) + 0.002
        self.days = set()
        if clock:
            for t in (self.lo, self.hi):
                for tz in (_dt_mod.timezone.utc, None):
                    self.days.add(REAL_DT.fromtimestamp(t, tz).date().isoformat())

    def in_window(self, x: float) -> bool:
        return any(self.lo <= x / s <= self.hi for s in (1, 1e3, 1e6)) if self.clock else False

    def is_vol(self, v) -> bool:
        if isinstance(v, bool) or v is None:
            return False
        if isinstance(v, (int, float)):
            return (isinstance(v, int) and v in self.ints) or self.in_window(float(v))
        if not isinstance(v, str):
            return False
        s = v.strip()
        if re.fullmatch(r"-?\d+", s) and int(s) in self.ints:
            return True
        if re.fullmatch(r"\d{9,17}(\.\d+)?", s):
            return self.in_window(float(s))
        if _ISO.match(s):
            if len(s) == 10:
                return s in self.days
            try:
                t = REAL_DT.fromisoformat(s.replace("Z", "+00:00"))
                t = t if t.tzinfo else t.replace(tzinfo=_dt_mod.timezone.utc)
                return self.in_window(t.timestamp())
            except ValueError:
                return False
        return False

    def _hex(self, m):
        run = m.group(0)
        flat = run.replace("-", "").lower()
        if len(flat) >= 8 and self.win8 and any(flat[i:i + 8] in self.win8 for i in range(len(flat) - 7)):
            return "<gen>"
        return _UUIDISH.sub(lambda u: u.group(0) if u.group(0).lower() in self.base_tokens else "<gen>", run)

    def sub(self, v: str) -> str:
        out = _HEXRUN.sub(self._hex, v)
        for s in self.strs:
            if s in out:
                out = out.replace(s, "<gen>")
        if self.ints:
            out = _DIGITS5.sub(lambda m: "<gen>" if int(m.group(0)) in self.ints else m.group(0), out)
        return out

    def touches(self, v) -> bool:
        """The value is, or contains, a generator output (shim neutrality: a difference it explains)."""
        return self.is_vol(v) or (isinstance(v, str) and self.sub(v) != v)


def volatile_matcher(gen: dict, base_tokens: set | None = None, new_ids: set | None = None) -> Volatile:
    return Volatile(gen, base_tokens, new_ids)


def mask(v, vol: Volatile):
    if isinstance(v, dict):
        return {k: mask(x, vol) for k, x in v.items()}
    if isinstance(v, list):
        return [mask(x, vol) for x in v]
    if vol.is_vol(v):
        return "<gen>"
    return vol.sub(v) if isinstance(v, str) else v


def _record_key(a: list, b: list):
    """The key that identifies records in a list of dicts: 'id', else the record's own first field when it is named
    like an id (contact_id, invoice_id, ...). Every record must carry it and its values must be unique in a and in b."""
    if not isinstance(a, list) or not isinstance(b, list) or not (a or b):
        return None
    if not all(isinstance(i, dict) for i in a + b):
        return None
    first = next(iter((b or a)[0]), None)
    for k in ["id"] + ([first] if first and first != "id" and (first.endswith("_id") or first.endswith("Id")) else []):
        if all(k in i for i in a + b) and len({str(i[k]) for i in a}) == len(a) and len({str(i[k]) for i in b}) == len(b):
            return k
    return None


def new_record_ids(a, b, out=None) -> set:
    """Ids of records that exist in world b and not in base a (their values were assigned by the apps)."""
    out = set() if out is None else out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in b:
            if k in a:
                new_record_ids(a[k], b[k], out)
            elif isinstance(b[k], (dict, list)):
                new_record_ids({} if isinstance(b[k], dict) else [], b[k], out)
        return out
    key = _record_key(a, b) if isinstance(a, list) and isinstance(b, list) else None
    if key:
        ia = {str(i[key]): i for i in a}
        for i in b:
            k = str(i[key])
            if k in ia:
                new_record_ids(ia[k], i, out)
            else:
                out.add(k)
                new_record_ids({}, i, out)
    return out


def uuid_tokens(obj) -> set:
    return {t.lower() for t in _UUIDISH.findall(canon(obj))}


def state_diff(a, b, vol: Volatile, path="$"):
    """Canonical diff of world b against base a: changed leaves (masked), added/removed keys, and record lists matched
    by their key ('id' or an <x>_id first field; added records as a masked multiset, so creation order and fresh ids do
    not matter)."""
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in b:
                out.append(["del", f"{path}.{k}"])
            elif k not in a:
                out.append(["add", f"{path}.{k}", mask(b[k], vol)])
            else:
                out += state_diff(a[k], b[k], vol, f"{path}.{k}")
        return out
    key = _record_key(a, b)
    if key:
        ia, ib = {str(i[key]): i for i in a}, {str(i[key]): i for i in b}
        added = sorted(canon(mask(ib[k], vol)) for k in ib if k not in ia)
        if added:
            out.append(["add-records", path, added])
        for k in sorted(ia):
            if k not in ib:
                out.append(["del-record", path, k])
            else:
                out += state_diff(ia[k], ib[k], vol, f"{path}[{key}={k}]")
        return out
    if a != b:
        out.append(["set", path, mask(b, vol)])
    return out


def fork_signature(base: dict, final: dict, gen: dict):
    """(sha, diff) of one fork's effects: the masked diff of its final world against the shared initial world. Inputs
    are the fork's own world and generator log only: no assertion, grade or other fork's data."""
    vol = Volatile(gen, uuid_tokens(base), new_record_ids(base, final))
    d = state_diff(base, final, vol)
    return sha(d), d


def cmd_vote(a):
    base = load_json(a.base)["world"]
    forks = []
    for h in a.forks.split(","):
        hp = Path(h)
        fw, gen = hp / "final-world.json", hp / "generated.json"
        if not fw.exists():
            forks.append({"host": h, "sig": None, "error": "no final world"})
            continue
        sig, d = fork_signature(base, load_json(fw), load_json(gen))
        forks.append({"host": h, "sig": sig, "n_changes": len(d), "diff": d})
    groups = {}
    for i, f in enumerate(forks):
        if f["sig"] is not None:
            groups.setdefault(f["sig"], []).append(i)
    ranked = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[1][0]))
    winner = ranked[0][1][0] if ranked else None
    size = len(ranked[0][1]) if ranked else 0
    res = {"k": len(forks), "groups": [{"sig": s, "forks": ix} for s, ix in ranked], "winner": winner,
           "agreement": size / len(forks) if forks else 0, "majority": size * 2 > len(forks),
           "forks": [{k: v for k, v in f.items() if k != "diff"} for f in forks],
           "winner_diff": forks[winner]["diff"] if winner is not None else None}
    write_json(Path(a.out), res, indent=1)
    print(canon({k: res[k] for k in ("k", "winner", "agreement", "majority")}))


def _leaf_diffs(x, y, path="$"):
    """Leaves where two JSON trees differ (structure differences are reported with their path and kind)."""
    if isinstance(x, dict) and isinstance(y, dict):
        if set(x) != set(y):
            return [("keys", path, sorted(set(x) ^ set(y)), None)]
        return [d for k in sorted(x) for d in _leaf_diffs(x[k], y[k], f"{path}.{k}")]
    if isinstance(x, list) and isinstance(y, list):
        if len(x) != len(y):
            return [("length", path, len(x), len(y))]
        return [d for i, (u, v) in enumerate(zip(x, y)) for d in _leaf_diffs(u, v, f"{path}[{i}]")]
    if type(x) is not type(y) and not (isinstance(x, (int, float)) and isinstance(y, (int, float))):
        return [("type", path, x, y)]
    return [] if x == y else [("value", path, x, y)]


def _maybe_json(s):
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return s


def cmd_neutral(a):
    """Shim neutrality: run A (--det off, no patches) vs run B (--det record) of the same scripts through the official
    path. Every difference must be a leaf whose B value is a recorded generator draw; scores and assertion verdicts
    must be equal."""
    A, B = load_json(a.a), load_json(a.b)
    report = {}
    for name in sorted(set(A) | set(B)):
        x, y = A.get(name), B.get(name)
        if x is None or y is None:
            report[name] = {"ok": False, "why": "missing"}
            continue
        vol = volatile_matcher(y.get("generated") or {})
        diffs = _leaf_diffs(x["final_world"], y["final_world"])
        tr = [d for u, v in zip(x["tool_results"], y["tool_results"]) for d in _leaf_diffs(_maybe_json(u), _maybe_json(v))]
        alld = diffs + tr
        unexplained = [d for d in alld if d[0] != "value" or not vol.touches(d[3])]
        verdicts = lambda r: [(q["type"], q["passed"], q["excluded"]) for q in (r.get("assertion_results") or [])]  # noqa: E731
        same_scores = (x["partial_credit"], x["task_completed_correctly"]) == (y["partial_credit"], y["task_completed_correctly"])
        report[name] = {"ok": not unexplained and same_scores and verdicts(x) == verdicts(y) and len(x["tool_results"]) == len(y["tool_results"]),
                        "world_leaves_differing": len(diffs), "tool_result_leaves_differing": len(tr), "explained_by_generators": len(alld) - len(unexplained),
                        "unexplained": [list(map(str, d))[:4] for d in unexplained[:10]], "same_scores": same_scores,
                        "same_verdicts": verdicts(x) == verdicts(y)}
    write_json(Path(a.out), report, indent=1)
    print(canon({"tasks": len(report), "ok": all(r["ok"] for r in report.values())}))


def cmd_grade(a):
    SHIM.install(a.det)
    row = load_json(a.input)
    r = Rollout(row, a.max_steps, load_world(a.world))
    asyncio.run(r.setup())
    g = asyncio.run(r.grade())
    write_json(Path(a.out), g, indent=1)
    print(canon({k: g[k] for k in ("partial_credit", "task_completed_correctly", "n_scored", "n_passed")}))


def cmd_roundtrip(a):
    """Self-test: for every task, the initial world after setup survives dump -> load -> dump unchanged (forking)."""
    SHIM.install(a.det)
    o = official_modules()
    from automationbench.schema.world import WorldState
    domains = a.domains.split(",") if a.domains else list(o["DOMAINS"])
    env = make_env(official_dataset(domains, None), a.max_steps)
    bad, n = [], 0
    for row in env._get_eval_inputs(-1, 1):
        r = Rollout(row, a.max_steps)
        asyncio.run(r.setup())
        d1 = r.world()
        with SHIM.active():
            d2 = WorldState(**json.loads(json.dumps(d1))).model_dump(mode="json")
        n += 1
        if canon(d1) != canon(d2):
            bad.append(json.loads(row["info"])["task_name"] if isinstance(row["info"], str) else row["info"]["task_name"])
    print(canon({"tasks": n, "roundtrip_mismatch": bad}))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def common(sp, det="record"):
        sp.add_argument("--det", default=det, choices=["off", "record", "seed"])
        sp.add_argument("--max-steps", type=int, default=50)
    s = sub.add_parser("list")
    s.add_argument("--domains")
    s.set_defaults(fn=cmd_list)
    s = sub.add_parser("stats")
    s.add_argument("--domains")
    s.set_defaults(fn=cmd_stats)
    s = sub.add_parser("prepare")
    common(s)
    s.add_argument("--domains")
    s.add_argument("--tasks")
    s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_prepare)
    for name, fn in (("serve", cmd_serve), ("replay", cmd_replay)):
        s = sub.add_parser(name)
        common(s)
        s.add_argument("--input", required=True)
        s.add_argument("--world")
        s.add_argument("--fork", type=int, default=0)
        s.add_argument("--host", required=True)
        if name == "serve":
            s.add_argument("--mailbox", required=True)
            s.add_argument("--poll", type=float, default=0.05)
            s.add_argument("--expect-contract")
        else:
            s.add_argument("--steps", required=True)
        s.set_defaults(fn=fn)
    s = sub.add_parser("official")
    common(s)
    s.add_argument("--scripts", required=True)
    s.add_argument("--domains")
    s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_official)
    s = sub.add_parser("vote")
    s.add_argument("--base", required=True)
    s.add_argument("--forks", required=True)
    s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_vote)
    s = sub.add_parser("neutral")
    s.add_argument("--a", required=True)
    s.add_argument("--b", required=True)
    s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_neutral)
    s = sub.add_parser("grade")
    common(s)
    s.add_argument("--input", required=True)
    s.add_argument("--world", required=True)
    s.add_argument("--out", required=True)
    s.set_defaults(fn=cmd_grade)
    s = sub.add_parser("roundtrip")
    common(s)
    s.add_argument("--domains")
    s.set_defaults(fn=cmd_roundtrip)
    a = p.parse_args()
    try:
        a.fn(a)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        emit("error", error=f"{type(e).__name__}: {e}", trace=traceback.format_exc()[-4000:])
        sys.exit(2)


if __name__ == "__main__":
    main()
