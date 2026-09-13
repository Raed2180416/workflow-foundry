"""Original deterministic adapter fixtures; no models, network or corpus code."""
import importlib.metadata
import json
from pathlib import Path
import sys
import time

root = Path(sys.argv[1])
network_attempts = []


def block_coordinator_network(event, arguments):
    if event in ("socket.connect", "socket.getaddrinfo", "socket.sendto"):
        network_attempts.append(event)
        raise RuntimeError("Adapter fixture coordinator network is disabled")


sys.addaudithook(block_coordinator_network)
sys.path.insert(0, str(root / "basic"))
from foundry_langgraph import build_graph
import foundry_langgraph as runtime_module
from foundry_values import FoundryError
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

passed = []


def graph(name):
    return build_graph(root / name / "workflow.json", checkpointer=InMemorySaver())


def config(name):
    return {"configurable": {"thread_id": name}}


def expect_error(code, function):
    try:
        function()
    except FoundryError as error:
        assert error.code == code, (code, error.code)
    else:
        raise AssertionError(f"Expected {code}")


basic = graph("basic")
result = basic.invoke({"input": {"value": 7}}, config("basic"))
assert result["status"] == "succeeded" and result["outputs"]["sample"] == {"value": 7} and result["steps"] == 2
passed.append("typed_task_and_acceptance")
expect_error("RUN_CLOSED", lambda: basic.invoke(None, config("basic")))
passed.append("terminal_replay_rejected")

for name, status, steps in [("skip", "skipped", 0), ("fallback", "completed", 1)]:
    result = graph(name).invoke({"input": {"value": 7}}, config(name))
    assert result["status"] == "succeeded" and result["statuses"]["verify"] == status and result["steps"] == steps
    assert "sample" not in result["outputs"]
    passed.append(name + "_join")

expect_error("SCHEMA_MISMATCH", lambda: graph("basic").invoke({"input": {"value": "7"}}, config("invalid-input")))
expect_error("SCHEMA_MISMATCH", lambda: graph("output").invoke({"input": {"value": 7}}, config("invalid-output")))
passed.append("input_output_validation")

human = graph("human")
cfg = config("human")
paused = human.invoke({"input": {"value": 7}}, cfg)
assert "__interrupt__" in paused and paused["steps"] == 2
prior = paused["outputs"]["sample"]
question = paused["__interrupt__"][0].value
response = {key: question[key] for key in ("workflowHash", "runId", "nodeId")}
response["answer"] = True
result = human.invoke(Command(resume=response), cfg)
assert result["status"] == "succeeded" and result["steps"] == 3 and result["outputs"]["sample"] == prior
passed.append("human_resume_preserves_completed_work_and_budget")

wrong = graph("human")
cfg = config("wrong-answer")
paused = wrong.invoke({"input": {"value": 7}}, cfg)
question = paused["__interrupt__"][0].value
answer = {key: question[key] for key in ("workflowHash", "runId", "nodeId")}
answer.update({"runId": "other-run", "answer": True})
expect_error("ANSWER_CONFLICT", lambda: wrong.invoke(Command(resume=answer), cfg))
expect_error("RUN_CLOSED", lambda: wrong.invoke(Command(resume=answer), cfg))
passed.append("wrong_run_answer_is_terminal")

invalid_answer = graph("human")
cfg = config("invalid-answer")
paused = invalid_answer.invoke({"input": {"value": 7}}, cfg)
question = paused["__interrupt__"][0].value
answer = {key: question[key] for key in ("workflowHash", "runId", "nodeId")}
answer["answer"] = "yes"
expect_error("SCHEMA_MISMATCH", lambda: invalid_answer.invoke(Command(resume=answer), cfg))
passed.append("human_answer_schema_checked")

expiring = graph("human-deadline")
cfg = config("human-deadline")
paused = expiring.invoke({"input": {"value": 7}}, cfg)
question = paused["__interrupt__"][0].value
answer = {key: question[key] for key in ("workflowHash", "runId", "nodeId")}
answer["answer"] = True
time.sleep(max(0, paused["deadline"] / 1000 - time.time() + 0.01))
expect_error("DEADLINE", lambda: expiring.invoke(Command(resume=answer), cfg))
passed.append("human_pause_does_not_reset_deadline")

original_condition = runtime_module.condition


def delayed_acceptance(check, context):
    result = original_condition(check, context)
    if check.get("left") == {"$ref": "nodes.verify.passed"}:
        time.sleep(1.01)
    return result


runtime_module.condition = delayed_acceptance
try:
    expect_error("DEADLINE", lambda: graph("acceptance-deadline").invoke({"input": {"value": 7}}, config("acceptance-deadline")))
finally:
    runtime_module.condition = original_condition
passed.append("slow_acceptance_cannot_pass_after_deadline")

state_edit = graph("human")
cfg = config("state-edit")
state_edit.invoke({"input": {"value": 7}}, cfg)
expect_error("UNSUPPORTED_RESUME", lambda: state_edit.invoke(Command(resume=True, update={"steps": -1}), cfg))
passed.append("state_edit_command_rejected")

expect_error("INPUT_ENVELOPE", lambda: graph("basic").invoke({"input": {"value": 7}, "steps": -1}, config("bad-envelope")))
passed.append("internal_state_input_rejected")

limited = graph("step")
cfg = config("steps")
expect_error("STEP_BUDGET", lambda: limited.invoke({"input": {"value": 7}}, cfg))
expect_error("RUN_CLOSED", lambda: limited.invoke(None, cfg))
passed.append("step_budget_and_failed_replay")

timeout = graph("timeout")
cfg = config("timeout")
started = time.monotonic()
expect_error("TOOL_TIMEOUT", lambda: timeout.invoke({"input": {"value": 7}}, cfg))
assert time.monotonic() - started < 3
assert timeout.get_state(cfg).values["steps"] == 1
expect_error("RUN_CLOSED", lambda: timeout.invoke(None, cfg))
passed.append("process_timeout_and_persisted_attempt")

expect_error("CAPABILITY_DRIFT", lambda: graph("tamper"))
passed.append("capability_tamper_rejected")

changed = root / "basic/workflow.json"
specification = json.loads(changed.read_text())
specification["workflow"]["budget"]["maxSteps"] += 1
changed.write_text(json.dumps(specification))
expect_error("WORKFLOW_DRIFT", lambda: graph("basic"))
passed.append("workflow_identity_tamper_rejected")

print(json.dumps({"passed": len(passed), "cases": passed,
                  "langgraph": importlib.metadata.version("langgraph"),
                  "python": sys.version.split()[0], "modelsCalled": 0,
                  "coordinatorNetworkAttemptsBlocked": len(network_attempts),
                  "networkMonitoringScope": "Python coordinator socket audit; child fixture source uses no network capabilities",
                  "checkpointer": "InMemorySaver", "durableCrashRecoveryTested": False}))
