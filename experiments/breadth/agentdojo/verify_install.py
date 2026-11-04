# AgentDojo install check (BG-0; research/breadth-20261021/agentdojo/ACQUISITION.md). Reads only: the download record
# (downloads.json, written by acquire.py) and the venv's site-packages. Checks that exactly the 72 pinned distributions
# are installed at their pinned versions and that every installed file still has the sha256 its wheel's RECORD lists
# (wheel RECORD hashes are the wheel author's; a changed, missing or extra file shows up here). Stdlib only.
#
#   /usr/bin/python3 -I verify_install.py <downloads.json> <site-packages>      -> one JSON line on stdout
import base64
import hashlib
import json
import os
import re
import sys


# The two files `uv venv` (0.11.32) seeds into every venv's site-packages (its distutils patch), pinned by sha256.
VENV_SEED = {"_virtualenv.pth": "69ac3d8f27e679c81b94ab30b3b56e9cd138219b1ba94a1fa3606d5a76a1433d",
             "_virtualenv.py": "cfb3db86aaa53bb62b5ff764970bec2d71c9228590a0ebec57f6ec926cc0bf1a"}


def norm(n):
    return re.sub(r"[-_.]+", "-", n).lower()


def main(downloads, site):
    dl = json.load(open(downloads, encoding="utf-8"))
    inst = {}
    for d in sorted(os.listdir(site)):
        if not d.endswith(".dist-info"):
            continue
        meta = open(os.path.join(site, d, "METADATA"), encoding="utf-8", errors="replace").read()
        name = re.search(r"^Name: (.+)$", meta, re.M).group(1).strip()
        ver = re.search(r"^Version: (.+)$", meta, re.M).group(1).strip()
        inst[norm(name)] = (ver, d)
    want = {norm(w["name"]): w["version"] for w in dl["wheels"]}
    missing = sorted(k for k in want if k not in inst)
    wrong = sorted([k, want[k], inst[k][0]] for k in want if k in inst and inst[k][0] != want[k])
    extra = sorted(k for k in inst if k not in want)
    bad, checked, listed = [], 0, set()
    for _, (_, d) in sorted(inst.items()):
        for line in open(os.path.join(site, d, "RECORD"), encoding="utf-8"):
            parts = line.rstrip("\n").rsplit(",", 2)
            if len(parts) != 3:
                continue
            p, h, _ = parts
            fp = os.path.normpath(os.path.join(site, p))
            listed.add(fp)
            if not h:
                continue
            algo, dig = h.split("=", 1)
            if not os.path.exists(fp):
                bad.append(["missing", p])
                continue
            with open(fp, "rb") as fh:
                got = base64.urlsafe_b64encode(hashlib.new(algo, fh.read()).digest()).rstrip(b"=").decode()
            checked += 1
            if got != dig:
                bad.append(["hash", p])
    # files under site-packages that no RECORD lists (bytecode caches excluded: Python writes them at import time)
    unlisted = []
    for root, dirs, files in os.walk(site):
        dirs[:] = [x for x in dirs if x != "__pycache__"]
        for f in files:
            fp = os.path.normpath(os.path.join(root, f))
            if fp in listed or f.endswith(".pyc"):
                continue
            rel = os.path.relpath(fp, site)
            if rel in VENV_SEED:
                with open(fp, "rb") as fh:
                    if hashlib.sha256(fh.read()).hexdigest() == VENV_SEED[rel]:
                        continue
            unlisted.append(rel)
    out = {"pinned": len(want), "installed": len(inst), "missing": missing, "wrongVersion": wrong, "extra": extra,
           "recordFilesChecked": checked, "recordMismatches": bad[:20], "nRecordMismatches": len(bad),
           "unlistedFiles": sorted(unlisted)[:20], "nUnlistedFiles": len(unlisted),
           "downloadsSha256": hashlib.sha256(open(downloads, "rb").read()).hexdigest(),
           "wheelCount": dl.get("count"), "wheelBytes": dl.get("total_bytes"), "lockSha256": dl.get("lock_sha256")}
    out["pass"] = not missing and not wrong and not extra and not bad and not unlisted and len(want) == dl.get("count")
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
