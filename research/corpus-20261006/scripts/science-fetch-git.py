#!/usr/bin/env python3
"""Shallow, blob:none, sparse clones of public CWL / WDL workflow repositories for the science cluster.

Only definition files are checked out (CWL: *.cwl + small job/test YAML; WDL: *.wdl + *.json inputs);
blobs are fetched lazily for those paths only; the full file list is written next to each clone
(<dir>.files.json, from tree objects) so test data can be recorded without downloading it.
No LFS, no submodules, hooks disabled, nothing built or executed.
Raw -> /opt/corpus/<platform>/repos/<owner>__<repo>.  `--pin` checks out the SHAs in the ledger.
Usage: python3 -I science-fetch-git.py [--pin]
"""
import concurrent.futures as cf, json, os, subprocess, sys

GIT = ["git", "-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false",
       "-c", "protocol.file.allow=never"]
CWL = ["*.cwl", "*.cwl.yml", "*.cwl.yaml", "*job*.yml", "*job*.yaml", "*job*.json", "*test*.yml", "*test*.yaml",
       "/LICENSE*", "/LICENCE*", "/COPYING*", "/README*", "!**/test-data/", "!**/data/"]
WDL = ["*.wdl", "*.inputs.json", "*input*.json", "*test*.json", "/LICENSE*", "/LICENCE*", "/COPYING*", "/README*",
       "!**/test-data/", "!**/data/"]
REPOS = [
    ("cwl", "EBI-Metagenomics/pipeline-v5", CWL),
    ("cwl", "ncbi/pgap", CWL),
    ("cwl", "kids-first/kf-somatic-workflow", CWL),
    ("cwl", "kids-first/kf-alignment-workflow", CWL),
    ("cwl", "kids-first/kf-germline-workflow", CWL),
    ("cwl", "nci-gdc/gdc-dnaseq-cwl", CWL),
    ("cwl", "Barski-lab/workflows", CWL),
    ("cwl", "hubmapconsortium/salmon-rnaseq", CWL),
    ("cwl", "common-workflow-library/bio-cwl-tools", CWL),
    ("cwl", "mskcc/ACCESS-Pipeline", CWL),
    ("wdl", "broadinstitute/warp", WDL),
    ("wdl", "ENCODE-DCC/atac-seq-pipeline", WDL),
    ("wdl", "ENCODE-DCC/chip-seq-pipeline2", WDL),
    ("wdl", "gatk-workflows/gatk4-somatic-snvs-indels", WDL),
]


def clone(platform, full, sparse, sha=None):
    d = f"/opt/corpus/{platform}/repos/{full.replace('/', '__')}"
    try:
        if not os.path.isdir(f"{d}/.git"):
            os.makedirs(d, exist_ok=True)
            subprocess.run(GIT + ["init", "-q", d], check=True)
            subprocess.run(GIT + ["-C", d, "remote", "add", "origin", f"https://github.com/{full}"], check=True)
        subprocess.run(GIT + ["-C", d, "sparse-checkout", "set", "--no-cone", *sparse], check=True)
        subprocess.run(GIT + ["-C", d, "fetch", "-q", "--depth", "1", "--filter=blob:none", "--no-recurse-submodules",
                              "origin", sha or "HEAD"], check=True, timeout=900)
        subprocess.run(GIT + ["-C", d, "checkout", "-q", "FETCH_HEAD"], check=True, timeout=1800)
        head = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        date = subprocess.run(["git", "-C", d, "log", "-1", "--format=%cI"], capture_output=True, text=True).stdout.strip()
        files = subprocess.run(["git", "-C", d, "ls-tree", "-r", "--name-only", "HEAD"], capture_output=True, text=True).stdout.split("\n")
        json.dump([f for f in files if f], open(f"{d}.files.json", "w"))
        return {"status": "ok", "head": head, "date": date, "path": d}
    except Exception as e:
        return {"status": f"error: {str(e)[:200]}", "path": d}


def main():
    pins = {}
    if "--pin" in sys.argv and os.path.exists("/opt/corpus/science-work/git-pins.json"):
        pins = json.load(open("/opt/corpus/science-work/git-pins.json"))
    out = []
    with cf.ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(clone, p, r, s, pins.get(r)): (p, r) for p, r, s in REPOS}
        for f in cf.as_completed(futs):
            p, r = futs[f]
            res = f.result()
            out.append({"platform": p, "repo": r, **res})
            print(p, r, res["status"], res.get("head", ""), flush=True)
    os.makedirs("/opt/corpus/science-work", exist_ok=True)
    json.dump(sorted(out, key=lambda x: x["repo"]), open("/opt/corpus/science-work/git-manifest.json", "w"), indent=1)


if __name__ == "__main__":
    main()
