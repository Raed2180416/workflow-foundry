"""Qualified serial Foundry export built from real LangGraph nodes.

Requires trusted pure, free bindings and a caller-owned checkpointer. It does not
provide Foundry Store/CAS/event-chain parity or a security sandbox for Python.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from typing import Any, TypedDict
import uuid

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from foundry_values import FoundryError, condition, data, equal, resolve, schema_subset, validate


class State(TypedDict, total=False):
    input: Any
    outputs: dict[str, Any]
    statuses: dict[str, str]
    steps: int
    cost: int
    deadline: float
    workflowHash: str
    bindingHash: str
    runId: str
    status: str
    error: dict[str, str]


def build_graph(specification_path: str | Path = "workflow.json", *, checkpointer: Any):
    """Build a fresh graph. Invoke with {'input': data}; resume with Command.

    Bindings are read only from the exported specification, never graph input.
    The caller must keep the checkpointer/configuration private from the model.
    """
    if os.name != "posix":
        raise FoundryError("UNSUPPORTED_PLATFORM", "This profile requires POSIX process-group termination")
    if checkpointer is None:
        raise FoundryError("CHECKPOINTER_REQUIRED", "An explicit checkpointer is required")
    path = Path(specification_path).resolve()
    if path.stat().st_size > 2 * 1024 * 1024:
        raise FoundryError("DATA_LIMIT", "Specification is too large")
    specification = data(json.loads(path.read_text()))
    workflow = specification["workflow"]
    canonical = specification.get("workflowCanonical", "")
    if hashlib.sha256(canonical.encode()).hexdigest() != specification["workflowHash"] or not equal(json.loads(canonical), workflow):
        raise FoundryError("WORKFLOW_DRIFT", "Workflow does not match its exported identity")
    bindings = specification["bindings"]
    nodes = {node["id"]: node for node in workflow["nodes"]}
    order = specification["order"]
    if specification["profile"] != "serial-pure-v1" or workflow["budget"]["maxConcurrency"] != 1:
        raise FoundryError("UNSUPPORTED_EXPORT", "Invalid profile")
    if specification["missingBindings"]:
        raise FoundryError("UNBOUND_CAPABILITIES", "Supply trusted bindings before execution")
    if set(order) != set(nodes) or len(order) != len(nodes):
        raise FoundryError("INVALID_EXPORT", "Export order differs from the workflow")
    pending = list(workflow["nodes"])
    expected, ancestors = [], {}
    while pending:
        ready = next((node for node in pending if all(dep in ancestors for dep in node["needs"])), None)
        if ready is None:
            raise FoundryError("INVALID_EXPORT", "Invalid dependencies")
        reachable = set(ready["needs"])
        for dep in ready["needs"]:
            reachable.update(ancestors[dep])
        ancestors[ready["id"]] = reachable
        expected.append(ready["id"])
        pending.remove(ready)
    if expected != order or (any(n["kind"] == "human" for n in nodes.values()) and any(order[i - 1] not in ancestors[order[i]] for i in range(1, len(order)))):
        raise FoundryError("UNSUPPORTED_EXPORT", "Unsupported execution order")
    if "inputSchema" in workflow:
        schema_subset(workflow["inputSchema"])
    for node in nodes.values():
        if node["kind"] not in ("task", "assert", "human"):
            raise FoundryError("UNSUPPORTED_EXPORT", "Unsupported node kind")
        if node.get("join", "all_success") not in ("all_success", "all_resolved"):
            raise FoundryError("UNSUPPORTED_EXPORT", "Unsupported join semantics")
        if node["kind"] == "human":
            schema_subset(node["answerSchema"])
        if node["kind"] == "task":
            binding = bindings.get(node["tool"], {})
            if binding.get("effects") != "pure" or binding.get("risk") != "low" or binding.get("requiresApproval") is not False or binding.get("cost") != 0 or node["retry"]["maxAttempts"] != 1 or node.get("onError") == "continue":
                raise FoundryError("UNSUPPORTED_BINDING", "Only pure free single-attempt capabilities are supported")
            if node["timeoutMs"] > binding.get("maxTimeoutMs", 0):
                raise FoundryError("UNSUPPORTED_BINDING", "Timeout exceeds capability limit")
            schema_subset(binding["inputSchema"])
            schema_subset(binding["outputSchema"])
            file_name, _ = binding["entrypoint"].split(":")
            code_path = (path.parent / file_name).resolve()
            if not code_path.is_relative_to(path.parent) or not code_path.is_file():
                raise FoundryError("CAPABILITY_PATH", "Entrypoint must be inside the export directory")
            if code_path.stat().st_size > 1024 * 1024:
                raise FoundryError("DATA_LIMIT", "Capability source exceeds limit")
            if hashlib.sha256(code_path.read_bytes()).hexdigest() != binding["codeSha256"]:
                raise FoundryError("CAPABILITY_DRIFT", "Entrypoint revision differs from the binding")
    binding_hash = hashlib.sha256(json.dumps(bindings, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    workflow_hash = specification["workflowHash"]

    def guard(state: State, *, charge: bool = False) -> None:
        if state["workflowHash"] != workflow_hash or state["bindingHash"] != binding_hash:
            raise FoundryError("RESUME_DRIFT", "Workflow or bindings changed during the run")
        if time.time() * 1000 >= state["deadline"]:
            raise FoundryError("DEADLINE", "Run deadline exhausted")
        if charge and state["steps"] >= workflow["budget"]["maxSteps"]:
            raise FoundryError("STEP_BUDGET", "Run step budget exhausted")

    def context(state: State) -> dict[str, Any]:
        return {"input": state["input"], "nodes": state["outputs"]}

    def initialize(state: State) -> State:
        incoming = data(state.get("input", {}))
        if "inputSchema" in workflow:
            validate(workflow["inputSchema"], incoming)
        return {"input": copy.deepcopy(incoming), "outputs": {}, "statuses": {}, "steps": 0,
                "cost": 0, "deadline": time.time() * 1000 + workflow["budget"]["maxDurationMs"],
                "workflowHash": workflow_hash, "bindingHash": binding_hash,
                "runId": uuid.uuid4().hex, "status": "running"}

    def invoke_capability(node: dict[str, Any], state: State) -> Any:
        binding = bindings[node["tool"]]
        args = resolve(node["args"], context(state))
        validate(binding["inputSchema"], args)
        timeout_ms = min(node["timeoutMs"], max(1, state["deadline"] - time.time() * 1000))
        request = {"root": str(path.parent), "binding": binding, "args": args, "timeoutMs": timeout_ms,
                   "context": {"runId": state["runId"], "nodeKey": "root/" + node["id"],
                               "workflowHash": workflow_hash, "deadline": state["deadline"]}}
        data(request)
        worker = Path(__file__).with_name("foundry_worker.py")
        process = subprocess.Popen([sys.executable, "-I", str(worker)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   start_new_session=True,
                                   env={"PATH": os.defpath, "LANG": "C.UTF-8", "PYTHONIOENCODING": "utf-8"})
        try:
            try:
                output, _ = process.communicate(json.dumps(request, allow_nan=False).encode(), timeout=timeout_ms / 1000)
            except subprocess.TimeoutExpired:
                raise FoundryError("TOOL_TIMEOUT", "Capability deadline exhausted") from None
            if len(output) > 512 * 1024:
                raise FoundryError("DATA_LIMIT", "Capability output exceeds limit")
            result = data(json.loads(output))
            if process.returncode != 0 or result.get("ok") is not True or "output" not in result:
                raise FoundryError("CAPABILITY_FAILED", "Capability process failed")
            guard(state)
            validate(binding["outputSchema"], result["output"])
            return result["output"]
        finally:
            # Also clean up accidental same-session children after a normal exit.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate(timeout=2)

    def prepare(node: dict[str, Any]):
        def execute(original: State) -> State:
            state = copy.deepcopy(original)
            guard(state)
            if not all(state["statuses"].get(dep) in ("completed", "skipped") for dep in node["needs"]):
                raise FoundryError("DEPENDENCY", "A dependency is incomplete")
            blocked = node.get("join", "all_success") == "all_success" and any(state["statuses"].get(dep) != "completed" for dep in node["needs"])
            if blocked or ("when" in node and not condition(node["when"], context(state))):
                state["statuses"][node["id"]] = "skipped"
                return state
            guard(state, charge=True)
            state["steps"] += 1
            if node["kind"] == "human":
                state["statuses"][node["id"]] = "awaiting_human"
                state["status"] = "awaiting_human"
                return state
            state["statuses"][node["id"]] = "running"
            return data(state)
        return execute

    def act(node: dict[str, Any]):
        def execute(original: State) -> State:
            state = copy.deepcopy(original)
            guard(state)
            if state["statuses"].get(node["id"]) == "skipped":
                return state
            if node["kind"] == "assert":
                if not all(condition(c, context(state)) for c in node["checks"]):
                    raise FoundryError("ASSERTION_FAILED", "Workflow assertion failed")
                output = {"passed": True}
            else:
                output = invoke_capability(node, state)
            state["outputs"][node["id"]] = data(output, 512 * 1024)
            state["statuses"][node["id"]] = "completed"
            guard(state)
            return data(state)
        return execute

    def answer(node: dict[str, Any]):
        def receive(original: State) -> State:
            state = copy.deepcopy(original)
            guard(state)
            if state["statuses"].get(node["id"]) == "skipped":
                return state
            # This node has no effect before interrupt(), so replay is safe.
            payload = {"workflowHash": workflow_hash, "runId": state["runId"], "nodeId": node["id"],
                       "question": node["question"], "answerSchema": node["answerSchema"]}
            response = data(interrupt(payload))
            if type(response) is not dict or any(response.get(k) != payload[k] for k in ("workflowHash", "runId", "nodeId")) or "answer" not in response:
                raise FoundryError("ANSWER_CONFLICT", "Answer does not match the pending run and question")
            guard(state)
            validate(node["answerSchema"], response["answer"])
            state["outputs"][node["id"]] = {"answer": copy.deepcopy(response["answer"])}
            state["statuses"][node["id"]] = "completed"
            state["status"] = "running"
            return data(state)
        return receive

    def accept(state: State) -> State:
        guard(state)
        if not all(condition(c, context(state)) for c in workflow["acceptance"]):
            raise FoundryError("ACCEPTANCE_FAILED", "Workflow acceptance failed")
        guard(state)
        return {**state, "status": "succeeded"}

    builder = StateGraph(State)
    builder.add_node("foundry_initialize", initialize)
    builder.add_edge(START, "foundry_initialize")
    previous = "foundry_initialize"
    for node_id in order:
        node = nodes[node_id]
        name = "foundry_node_" + node_id
        builder.add_node(name, prepare(node))
        builder.add_edge(previous, name)
        previous = name
        action_name = "foundry_action_" + node_id
        builder.add_node(action_name, answer(node) if node["kind"] == "human" else act(node))
        builder.add_edge(previous, action_name)
        previous = action_name
    builder.add_node("foundry_accept", accept)
    builder.add_edge(previous, "foundry_accept")
    builder.add_edge("foundry_accept", END)
    compiled = builder.compile(checkpointer=checkpointer)

    class ManagedGraph:
        """Fresh runs or the pending human answer; no generic failed-node replay.

        The host supplies one owner per thread. This local lock is not a
        cross-process ownership protocol or a replacement for Foundry Store.
        """
        def __init__(self):
            self._lock = threading.Lock()
            self._failed_threads: set[str] = set()

        def invoke(self, payload: Any, config: dict[str, Any]):
            with self._lock:
                if type(config) is not dict or any(k not in ("configurable", "recursion_limit") for k in config):
                    raise FoundryError("CONFIGURATION", "Only thread identity and recursion limit may be configured")
                options = config.get("configurable", {})
                thread_id = options.get("thread_id")
                if type(thread_id) is not str or not thread_id or set(options) != {"thread_id"}:
                    raise FoundryError("CONFIGURATION", "A unique thread_id is required; checkpoint rewinds are unsupported")
                current_config = {**config, "recursion_limit": config.get("recursion_limit", 2 * len(order) + 8)}
                snapshot = compiled.get_state(current_config)
                previous = snapshot.values
                if thread_id in self._failed_threads or previous.get("status") in ("failed", "succeeded"):
                    raise FoundryError("RUN_CLOSED", "This thread is terminal; start a fresh run")
                if previous:
                    if previous.get("workflowHash") != workflow_hash or previous.get("bindingHash") != binding_hash:
                        raise FoundryError("RESUME_DRIFT", "Thread belongs to a different workflow or capability binding")
                    if previous.get("status") != "awaiting_human" or not isinstance(payload, Command) or payload.update is not None or payload.goto or payload.graph is not None:
                        raise FoundryError("UNSUPPORTED_RESUME", "Only the pending human answer can resume; interrupted tasks cannot be replayed")
                elif type(payload) is not dict or set(payload) != {"input"}:
                    raise FoundryError("INPUT_ENVELOPE", "Start a run with exactly {'input': data}")
                try:
                    return compiled.invoke(payload, current_config)
                except Exception as error:
                    self._failed_threads.add(thread_id)
                    try:
                        compiled.update_state(current_config, {"status": "failed", "error": {"code": getattr(error, "code", "ERROR")}})
                    except Exception:
                        # A damaged checkpoint stays blocked in this owner.
                        pass
                    raise

        def get_state(self, config: dict[str, Any]):
            return compiled.get_state(config)

        def get_graph(self):
            return compiled.get_graph()

    return ManagedGraph()
