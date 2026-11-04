"""The AutomationBench host side every AB-R stream harness shared (B0 extraction, 2026-11-04).

bridge(): imports experiments/autobench/bridge.py once and installs its determinism shim in seed mode (ids seeded per
trigger, clock = trigger time). Ctx: what a code solver gets besides the payload, the tools and nothing else (the
superset of the copies the families carried: `calls` and `fetch_many` were present in abr-ops-slawatch only; the other
families never read them, so their outputs are unchanged). Runs inside AutomationBench's venv.
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json

MAX_STEPS = 50                    # the official loop: 50 model steps, so at most 49 tool-call steps per trigger
_BRIDGE = None


def bridge():
    """Import bridge.py once and install the determinism shim in seed mode (imports all of AutomationBench)."""
    global _BRIDGE
    if _BRIDGE is None:
        import bridge as b
        b.SHIM.install("seed")
        _BRIDGE = b
    return _BRIDGE


class StepBudgetExceeded(RuntimeError):
    pass


class Ctx:
    """What a code solver gets besides the payload: the tools, and nothing else."""

    def __init__(self, rollout, trigger: dict):
        self._r = rollout
        self.trigger = trigger
        self.steps = 0
        self.calls = 0

    def batch(self, calls: list[dict]) -> list[str]:
        """One step: several tool calls in order (as parallel tool calls in one model response). Returns contents."""
        norm = [{"name": c["name"], "arguments": c["arguments"] if isinstance(c["arguments"], str) else json.dumps(c["arguments"])}
                for c in calls]
        out = asyncio.run(self._r.batch(norm))
        if "error" in out:
            raise StepBudgetExceeded(out["error"])
        self.steps += 1
        self.calls += len(calls)
        return [x["content"] for x in out["results"]]

    def call(self, name: str, arguments: dict) -> str:
        return self.batch([{"name": name, "arguments": arguments}])[0]

    @staticmethod
    def fetch_args(method: str, url: str, params=None, body=None) -> dict:
        a = {"method": method, "url": url}
        if params is not None:
            a["params"] = json.dumps(params)
        if body is not None:
            a["body"] = json.dumps(body)
        return a

    def fetch(self, method: str, url: str, params=None, body=None) -> str:
        return self.call("api_fetch", self.fetch_args(method, url, params, body))

    def fetch_json(self, method: str, url: str, params=None, body=None):
        return json.loads(self.fetch(method, url, params, body))

    def fetch_many(self, reqs: list[tuple]) -> list:
        """Several api_fetch calls in ONE step; each req is (method, url[, params[, body]]). Returns parsed JSON."""
        outs = self.batch([{"name": "api_fetch", "arguments": self.fetch_args(*r)} for r in reqs])
        res = []
        for o in outs:
            try:
                res.append(json.loads(o))
            except ValueError:
                res.append({"raw": o})
        return res

    def search(self, query: str, top_k: int = 5) -> str:
        return self.call("api_search", {"query": query, "top_k": top_k})


def make_trigger_seed(family: str):
    """harness.trigger_seed bound to the family id (the copies all hashed f"{gen.FAMILY}:{seed}:{tid}")."""
    def trigger_seed(seed: int, tid: str) -> int:
        return int(hashlib.sha256(f"{family}:{seed}:{tid}".encode()).hexdigest()[:12], 16)
    return trigger_seed


def load_solver(name: str):
    """'reference', a control name from controls.CONTROLS, or path/to/module.py[:function] (default handle)."""
    if name == "reference":
        import reference
        return reference.handle
    import controls
    if name in controls.CONTROLS:
        return controls.CONTROLS[name]
    path, _, fn = name.partition(":")
    spec = importlib.util.spec_from_file_location("solver_mod", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, fn or "handle")
