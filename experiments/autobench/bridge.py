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
import select
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

    async def setup_state(state, **kw):
        info = state.get("info", {})
        info = json.loads(info) if isinstance(info, str) else info
        SHIM.reset(task_seed(info.get("task_name", "?"), fork), task_base_time(info))
        with SHIM.active():
            return await setup(state, **kw)

    async def env_response(messages, state, **kw):
        with SHIM.active():
            return await respond(messages, state, **kw)
    env.setup_state, env.env_response = setup_state, env_response
    return env


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
        vf = _vf()[0]
        client = make_scripted_client({})
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

    def finish(self, host: Path, grade: dict):
        write_json(host / "final-world.json", self.world())
        write_json(host / "grade.json", grade, indent=1)
        write_json(host / "generated.json", SHIM.generated())
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


def _serve_loop(r: Rollout, box: Path, poll: float):
    """Serve req-<n>.json files (complete, atomically renamed by tool.mjs) in numeric order; answer res-<n>.json.
    The host ends the rollout by writing 'stop' to stdin (or closing it)."""
    box.mkdir(parents=True, exist_ok=True)
    served, stop = set(), False
    while True:
        reqs = sorted((int(m.group(1)), p) for p in box.iterdir() if (m := re.fullmatch(r"req-(\d+)\.json", p.name)))
        for n, p in reqs:
            if n in served or (box / f"res-{n}.json").exists():
                continue
            served.add(n)
            try:
                if p.stat().st_size > MAX_REQUEST_BYTES:
                    raise ValueError(f"request larger than {MAX_REQUEST_BYTES} bytes")
                req = json.loads(p.read_text())
                calls = req.get("calls")
                if not isinstance(calls, list) or not calls or not all(isinstance(c, dict) for c in calls):
                    raise ValueError("a request is {\"calls\": [{\"name\": ..., \"arguments\": \"<json>\"}, ...]}")
                res = asyncio.run(r.batch(calls))
            except Exception as e:  # noqa: BLE001
                res = {"error": f"{type(e).__name__}: {e}"}
            write_json(box / f"res-{n}.json", res)
        if stop:
            return
        ready, _, _ = select.select([sys.stdin], [], [], poll)
        if ready:
            line = sys.stdin.readline()
            if line == "" or line.strip() == "stop":
                stop = True  # one more pass: answer anything that arrived before the stop


def cmd_serve(a):
    SHIM.install(a.det)
    row = load_json(a.input)
    world = load_json(a.world)["world"] if a.world else None
    r = Rollout(row, a.max_steps, world, a.fork)
    asyncio.run(r.setup())
    if a.expect_contract and r.contract != a.expect_contract:
        emit("error", error=f"task contract drift: {r.contract} != {a.expect_contract}")
        sys.exit(3)
    host = Path(a.host)
    emit("ready", contract=r.contract, pid=os.getpid())
    _serve_loop(r, Path(a.mailbox), a.poll)
    grade = asyncio.run(r.grade())
    r.finish(host, grade)
    emit("done", steps=r.steps, partial_credit=grade["partial_credit"], task_completed_correctly=grade["task_completed_correctly"])


def cmd_replay(a):
    SHIM.install(a.det)
    row = load_json(a.input)
    world = load_json(a.world)["world"] if a.world else None
    r = Rollout(row, a.max_steps, world, a.fork)
    asyncio.run(r.setup())
    for step in load_json(a.steps):
        if step.get("calls"):
            asyncio.run(r.batch(step["calls"]))
    grade = asyncio.run(r.grade())
    r.finish(Path(a.host), grade)
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
                     "stop_condition": ro.get("stop_condition")}
    write_json(Path(a.out), out)
    print(canon({"tasks": sorted(out), "out": a.out}))


# -- voting --------------------------------------------------------------------------------------------------------

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$")


def volatile_matcher(gen: dict):
    """True for a leaf value that AutomationBench's generators produced in this rollout: a uuid4 (or a slice of its hex,
    8+ chars), a random draw, or a clock read (ISO string, date, epoch s/ms/us) within the rollout's clock window."""
    win8 = {h[i:i + 8] for h in gen.get("uuid", []) for i in range(len(h) - 7)}
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
    clock = gen.get("clock", [])
    lo = min(clock + [gen.get("wall0", 0)]) - 2
    hi = max(clock + [gen.get("wall1", 0)]) + 2
    if gen.get("mode") == "seed" and clock:
        lo, hi = min(clock) - 0.002, max(clock) + 0.002
    days = set()
    if clock:
        for t in (lo, hi):
            for tz in (_dt_mod.timezone.utc, None):
                days.add(REAL_DT.fromtimestamp(t, tz).date().isoformat())

    def in_window(x: float) -> bool:
        return any(lo <= x / s <= hi for s in (1, 1e3, 1e6)) if clock else False

    def is_vol(v) -> bool:
        if isinstance(v, bool) or v is None:
            return False
        if isinstance(v, (int, float)):
            return (isinstance(v, int) and v in ints) or in_window(float(v))
        if not isinstance(v, str):
            return False
        flat = v.replace("-", "")
        if win8 and any(flat[i:i + 8] in win8 for i in range(len(flat) - 7)):
            return True
        if any(s in v for s in strs):
            return True
        s = v.strip()
        if re.fullmatch(r"-?\d+", s) and int(s) in ints:
            return True
        if re.fullmatch(r"\d{9,17}(\.\d+)?", s):
            return in_window(float(s))
        if _ISO.match(s):
            if len(s) == 10:
                return s in days
            try:
                t = REAL_DT.fromisoformat(s.replace("Z", "+00:00"))
                t = t if t.tzinfo else t.replace(tzinfo=_dt_mod.timezone.utc)
                return in_window(t.timestamp())
            except ValueError:
                return False
        return False
    return is_vol


def mask(v, is_vol):
    if isinstance(v, dict):
        return {k: mask(x, is_vol) for k, x in v.items()}
    if isinstance(v, list):
        return [mask(x, is_vol) for x in v]
    return "<gen>" if is_vol(v) else v


def state_diff(a, b, is_vol, path="$"):
    """Canonical diff of world b against base a: changed leaves (masked), added/removed keys, and id-keyed record
    lists matched by id (added records as a masked multiset, so creation order and fresh ids do not matter)."""
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in b:
                out.append(["del", f"{path}.{k}"])
            elif k not in a:
                out.append(["add", f"{path}.{k}", mask(b[k], is_vol)])
            else:
                out += state_diff(a[k], b[k], is_vol, f"{path}.{k}")
        return out
    keyed = lambda x: isinstance(x, list) and all(isinstance(i, dict) and "id" in i for i in x)  # noqa: E731
    if keyed(a) and keyed(b) and (a or b):
        ia, ib = {str(i["id"]): i for i in a}, {str(i["id"]): i for i in b}
        if len(ia) == len(a) and len(ib) == len(b):
            added = sorted(canon(mask(ib[k], is_vol)) for k in ib if k not in ia)
            if added:
                out.append(["add-records", path, added])
            for k in sorted(ia):
                if k not in ib:
                    out.append(["del-record", path, k])
                else:
                    out += state_diff(ia[k], ib[k], is_vol, f"{path}[id={k}]")
            return out
    if a != b:
        out.append(["set", path, mask(b, is_vol)])
    return out


def cmd_vote(a):
    base = load_json(a.base)["world"]
    forks = []
    for h in a.forks.split(","):
        hp = Path(h)
        fw, gen = hp / "final-world.json", hp / "generated.json"
        if not fw.exists():
            forks.append({"host": h, "sig": None, "error": "no final world"})
            continue
        d = state_diff(base, load_json(fw), volatile_matcher(load_json(gen)))
        forks.append({"host": h, "sig": sha(d), "n_changes": len(d), "diff": d})
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


def cmd_grade(a):
    SHIM.install(a.det)
    row = load_json(a.input)
    w = load_json(a.world)
    r = Rollout(row, a.max_steps, w["world"] if isinstance(w, dict) and set(w) >= {"world", "task"} else w)
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
