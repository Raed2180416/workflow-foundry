"""Run one explicitly bound, hash-pinned, trusted Python capability.

This process is a lifecycle boundary, not a filesystem/network security sandbox.
Workflow text cannot supply code. Only the host-provided binding file is loaded.
"""
import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import sys
import types


def main() -> None:
    request = json.loads(sys.stdin.buffer.read(2 * 1024 * 1024 + 1))
    root = Path(request["root"]).resolve()
    file_name, function = request["binding"]["entrypoint"].split(":")
    code_path = (root / file_name).resolve()
    if not code_path.is_relative_to(root) or code_path == root:
        raise ValueError("Entrypoint escapes export directory")
    source = code_path.read_bytes()
    if len(source) > 1024 * 1024 or hashlib.sha256(source).hexdigest() != request["binding"]["codeSha256"]:
        raise ValueError("Entrypoint revision changed")
    memory_limit = 512 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (memory_limit, memory_limit))
    cpu_limit = max(1, math.ceil(request["timeoutMs"] / 1000) + 1)
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit, cpu_limit))
    module = types.ModuleType("foundry_trusted_capability")
    module.__file__ = str(code_path)
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        exec(compile(source, str(code_path), "exec"), module.__dict__)
        output = getattr(module, function)(request["args"], request["context"])
    encoded = json.dumps({"ok": True, "output": output}, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode()
    if len(encoded) > 512 * 1024:
        raise ValueError("Capability output exceeds limit")
    sys.stdout.buffer.write(encoded)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Do not expose capability arguments or arbitrary exception payloads.
        print(json.dumps({"ok": False, "errorType": type(error).__name__}))
        sys.exit(1)
