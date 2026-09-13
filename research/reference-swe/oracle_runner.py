"""Runs only inside no-network bubblewrap; expected values live in the host."""
import contextlib
import importlib.util
import io
import json
import sys

request = json.loads(sys.stdin.read(32768))
spec = importlib.util.spec_from_file_location("candidate", "/candidate.py")
module = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    spec.loader.exec_module(module)
    fn = getattr(module, request["function"])
    result = [fn(*args) for args in request["args"]]
sys.stdout.write(json.dumps({"values": result, "argsAfter": request["args"]}, allow_nan=False))
