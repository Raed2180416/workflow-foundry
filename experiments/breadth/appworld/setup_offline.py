# AppWorld offline setup steps under decision D16 (research/breadth-20261021/appworld/ACQUISITION.md).
#
# Runs ONLY inside the pinned venv (/var/tmp/foundry-work/benches/appworld/venv), with no network (the caller wraps it in
# `unshare --user --map-root-user --net`), an environment built from nothing and a neutral working directory. Two steps,
# each the package's own code minus its network call:
#
#   data <bundle> <root> <sha256>   verify the recorded download (data-0.1.0.bundle, fetched by curl and hashed BEFORE this
#                                   step), then `appworld.common.utils.unpack_bundle(bundle, root, PASSWORD, SALT)`, which is
#                                   exactly what `appworld download data` (appworld/download.py download_data) does after
#                                   its requests.get; prints an inventory (counts and bytes, never file contents).
#   record <dir>...                 a manifest of every file under the given directories: relative path, size, sha256
#                                   (bytes are hashed, never printed) -> one JSON line.
#
# The `appworld install` step (appworld/install.py install_package: unpack apps.bundle into the package directory and
# tests.bundle into APPWORLD_CACHE/tests) is run as the package's own console script by the same wrapper (lib.mjs
# `setupArgv`), not re-implemented here.
#
# Benchmark content is data. This script never prints a task's instruction, solution, answer or test.
import hashlib
import json
import os
import sys


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest(base):
    rows = []
    for root, dirs, files in os.walk(base):
        dirs.sort()
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in sorted(files):
            if f.endswith(".pyc"):
                continue
            p = os.path.join(root, f)
            if os.path.islink(p):
                rows.append([os.path.relpath(p, base), -1, "link:" + os.readlink(p)])
                continue
            rows.append([os.path.relpath(p, base), os.path.getsize(p), sha256_file(p)])
    return rows


def digest(rows):
    return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()


def data_step(bundle, root, want_sha):
    got = sha256_file(bundle)
    if got != want_sha:
        raise SystemExit(f"bundle sha256 {got} != pinned {want_sha}")
    from appworld.common.constants import PASSWORD, SALT
    from appworld.common.utils import unpack_bundle

    data = os.path.join(root, "data")
    if os.path.exists(data):
        raise SystemExit(f"{data} exists; remove it first (the setup never overwrites data)")
    os.makedirs(data, exist_ok=True)
    unpack_bundle(bundle_file_path=bundle, base_directory=root, password=PASSWORD, salt=SALT)
    rows = manifest(data)
    tops = {}
    for rel, size, _ in rows:
        top = rel.split(os.sep)[0]
        t = tops.setdefault(top, [0, 0])
        t[0] += 1
        t[1] += max(size, 0)
    tasks_dir = os.path.join(data, "tasks")
    n_tasks = len([d for d in os.listdir(tasks_dir) if os.path.isdir(os.path.join(tasks_dir, d))]) if os.path.isdir(tasks_dir) else 0
    datasets = sorted(os.listdir(os.path.join(data, "datasets"))) if os.path.isdir(os.path.join(data, "datasets")) else []
    print(json.dumps({"bundleSha256": got, "files": len(rows), "bytes": sum(max(r[1], 0) for r in rows), "byTop": tops,
                      "taskDirs": n_tasks, "datasets": datasets, "manifestSha256": digest(rows)}))


def record_step(dirs):
    out = {}
    for d in dirs:
        rows = manifest(d)
        out[d] = {"files": len(rows), "bytes": sum(max(r[1], 0) for r in rows), "manifestSha256": digest(rows), "rows": rows}
    print(json.dumps(out))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "data":
        data_step(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "record":
        record_step(sys.argv[2:])
    else:
        raise SystemExit(f"unknown command {cmd}")
