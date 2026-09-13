"""Original DefaultAgent with documented custom Model/Environment; no agent loop here."""
import json
import sys

# The only package code admitted is the explicitly reviewed, pinned clone.
sys.path.insert(0, "/upstream/src")
from minisweagent.agents.default import DefaultAgent


def rpc(method, params):
    print(json.dumps({"method": method, "params": params}), flush=True)
    response = json.loads(sys.stdin.readline())
    if "error" in response:
        raise RuntimeError(response["error"])
    return response["result"]


class Model:
    config = {}

    def query(self, messages, **kwargs):
        return rpc("query", {"messages": messages})["message"]

    def format_message(self, **kwargs):
        return kwargs

    def format_observation_messages(self, message, outputs, template_vars=None):
        output = outputs[0]
        if output["done"]:
            return [{"role": "exit", "content": "Submitted", "extra": {
                "exit_status": "Submitted", "submission": "candidate.py"}}]
        return [{"role": "user", "content": output["observationText"]}]

    def get_template_vars(self, **kwargs):
        return {}

    def serialize(self):
        return {"adapter": "reviewed-defaultagent-custom-model-rpc-v1"}


class Environment:
    config = {}

    def execute(self, action, cwd=""):
        return rpc("act", {"action": action})

    def get_template_vars(self, **kwargs):
        return {}

    def serialize(self):
        return {"environment": "shared-narrow-synthetic-operations-v1"}


request = json.loads(sys.stdin.readline())
agent = DefaultAgent(Model(), Environment(), system_template="{{ system_prompt }}",
                     instance_template="{{ task }}", step_limit=5, cost_limit=0,
                     wall_time_limit_seconds=300, max_consecutive_format_errors=3)
try:
    outcome = agent.run(request["task"], system_prompt=request["system"])
    print(json.dumps({"method": "result", "result": outcome,
                      "trajectory": agent.serialize()}), flush=True)
except Exception as exc:
    print(json.dumps({"method": "result", "error": str(exc),
                      "trajectory": agent.serialize()}), flush=True)
    sys.exit(1)
