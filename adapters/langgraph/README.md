# Qualified LangGraph export

This package contains a real serial LangGraph graph and the exact exported workflow. It supports task, assert and human nodes, conditions, dependency references/defaults and final acceptance. It rejects map, loop, wait, parallel execution, retries and continue-on-error. Human workflows must be totally ordered so an interrupt does not silently change independent-work scheduling. A skipped prerequisite propagates skipping under the default `all_success` join. Use `all_resolved` explicitly for alternative branches that may proceed after a skip.

The qualified environment is Linux/POSIX with CPython 3.14 and LangGraph 1.2.11. The dependency lock was resolved for Python 3.14. Other interpreter/platform combinations require their own resolution and qualification. JSON processing is synchronous: deadlines are checked at boundaries and again before final acceptance, but a stalled coordinator cannot provide operating-system-level preemption of its own validation work.

Task bindings must be trusted, pure, zero-cost, low-risk and require no approval. The exporter does not turn arbitrary JavaScript tools into Python tools. Missing bindings block graph construction. A binding specifies `entrypoint: "capabilities.py:echo"`, the file's trusted SHA-256, input/output schemas and maximum timeout. The file must be inside this export directory. The worker executes those exact bytes in a child process with a minimal environment, bounded output, 512 MiB address-space limit and POSIX process-group termination. This is **not a filesystem or network security sandbox**. The host remains responsible for trusting and isolating capability code and its imports. Never bind model-supplied code merely by hashing it.

Install only from the pinned lock in an isolated environment. `requirements.in` is the human-readable direct dependency list; `requirements.txt` is the fully resolved lock with package hashes. Do not install from the research corpus.

```sh
uv venv .venv
uv pip sync --python .venv/bin/python --require-hashes --only-binary=:all: requirements.txt
```

Minimal trusted entrypoint:

```python
def echo(arguments, context):
    return arguments
```

A graph caller owns the checkpointer and must supply a unique thread ID per run. Increase LangGraph's recursion limit to cover the graph's internal nodes; the workflow's own step and wall-time limits are checked separately. The in-memory saver below demonstrates resumability in one process, not durable storage across process loss.

```python
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from foundry_langgraph import build_graph

graph = build_graph("workflow.json", checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "unique-run-identifier"}, "recursion_limit": 512}
result = graph.invoke({"input": {"value": 7}}, config)
if "__interrupt__" in result:
    question = result["__interrupt__"][0].value
    response = {key: question[key] for key in ("workflowHash", "runId", "nodeId")}
    response["answer"] = True  # Must satisfy the pending answerSchema.
    result = graph.invoke(Command(resume=response), config)
```

Schema support is the explicit `portable-draft7-v1` subset: primitive/union types, object properties/required/additionalProperties, homogeneous items, cardinality/length/numeric bounds, uniqueItems, enum/const and allOf/anyOf/oneOf/not. Regex, remote/local `$ref`, custom keywords, schema-driven coercion and format validation are not supported. Numeric data must be finite; integer values must be within JavaScript's safe integer range. Output and state byte/complexity bounds can reject otherwise valid large workflows.

Each node's preparation and step charge are checkpointed before its action. Human answers must match workflow hash, run ID and node ID, and the deadline includes time spent paused. Completed nodes are retained by the checkpointer. The managed wrapper only accepts a fresh `{input: ...}` run or the pending human `Command(resume=...)`; it rejects state edits, jumps, checkpoint rewinds and replay of failed tasks. An invalid answer terminates this target invocation rather than leaving a retryable question. The host must not expose the underlying checkpointer or bindings to model input and must provide a single owner per thread. Do not reuse a thread ID with a different workflow.

Only synchronous `invoke`, read-only `get_state` and graph inspection are exposed. Crashed task invocations require a fresh run; this export does not claim automatic native-runtime recovery. The supported Unicode profile excludes unpaired surrogates to preserve cross-language string semantics.

This adapter does not migrate Foundry's event hash chain, compare-and-swap store, approvals, in-flight effects or audit receipts. An exception is a failed invocation and must not be relabeled successful by a caller. Checkpointer persistence, crash recovery, dependency drift outside the pinned entrypoint file and deployment isolation require their own integration tests. Neither this export nor its local fixtures establish hosted-service or native-runtime parity.
