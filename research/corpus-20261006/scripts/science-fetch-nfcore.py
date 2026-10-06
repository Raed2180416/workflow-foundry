#!/usr/bin/env python3
"""nf-core acquisition for the science cluster (foundry-corpus-item/1).

1. Downloads the nf-core pipeline index https://nf-co.re/pipelines.json (MIT org; per-repo LICENSE
   is still read from each clone) to /opt/corpus/nf-core/pipelines.json and records its sha256.
2. For every pipeline with at least one tagged release, makes a shallow (depth 1), blob-filtered,
   sparse clone of github.com/nf-core/<name> at the latest release's tag SHA into
   /opt/corpus/nf-core/repos/<name>. Only workflow definition files are checked out
   (*.nf, *.config, nextflow_schema.json, conf/, tests/, workflows/, subworkflows/, local modules,
   LICENSE, .nf-core.yml, assets/schema_input.json). No LFS, no submodules, hooks disabled, nothing
   is built, installed or executed (Nextflow is not run).
Writes /opt/corpus/nf-core/fetch-manifest.json (name, tag, sha, clone status).
Usage: python3 -I science-fetch-nfcore.py [--limit N] [--refresh-index]
"""
import concurrent.futures as cf, datetime, hashlib, json, os, subprocess, sys, urllib.request

ROOT = "/opt/corpus/nf-core"
INDEX = "https://nf-co.re/pipelines.json"
GIT = ["git", "-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false",
       "-c", "protocol.file.allow=never"]
SPARSE = ["/*.nf", "/*.config", "/nextflow_schema.json", "/LICENSE", "/LICENCE", "/LICENSE.md", "/.nf-core.yml",
          "/modules.json", "/conf/", "/tests/", "/workflows/", "/subworkflows/", "/modules/local/",
          "/assets/schema_input.json", "/nf-test.config", "/ro-crate-metadata.json"]


def fetch_index(refresh):
    p = f"{ROOT}/pipelines.json"
    if refresh or not os.path.exists(p):
        with urllib.request.urlopen(urllib.request.Request(INDEX, headers={"User-Agent": "foundry-corpus/1"}), timeout=120) as r:
            data = r.read()
        open(p, "wb").write(data)
    data = open(p, "rb").read()
    return json.loads(data), hashlib.sha256(data).hexdigest()


def latest_release(p):
    rel = [r for r in (p.get("releases") or []) if r.get("tag_name") and r["tag_name"] != "dev" and r.get("tag_sha")]
    rel.sort(key=lambda r: r.get("published_at") or "", reverse=True)
    return rel[0] if rel else None


def clone(name, sha):
    d = f"{ROOT}/repos/{name}"
    url = f"https://github.com/nf-core/{name}"
    try:
        if not os.path.isdir(f"{d}/.git"):
            os.makedirs(d, exist_ok=True)
            subprocess.run(GIT + ["init", "-q", d], check=True)
            subprocess.run(GIT + ["-C", d, "remote", "add", "origin", url], check=True)
        subprocess.run(GIT + ["-C", d, "sparse-checkout", "set", "--no-cone", *SPARSE], check=True)
        subprocess.run(GIT + ["-C", d, "fetch", "-q", "--depth", "1", "--filter=blob:limit=2m", "--no-recurse-submodules",
                              "origin", sha], check=True, timeout=600)
        subprocess.run(GIT + ["-C", d, "checkout", "-q", "FETCH_HEAD"], check=True, timeout=600)
        head = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        return {"status": "ok", "head": head, "path": d}
    except Exception as e:  # recorded, never retried silently
        return {"status": f"error: {e}", "path": d}


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    idx, sha = fetch_index("--refresh-index" in sys.argv)
    pipes = idx["remote_workflows"]
    jobs = []
    for p in pipes:
        r = latest_release(p)
        if r:
            jobs.append((p["name"], r["tag_name"], r["tag_sha"], r.get("published_at"), bool(p.get("archived"))))
    if limit:
        jobs = jobs[:limit]
    out = {"index": INDEX, "indexSha256": sha, "retrievedAt": datetime.date.today().isoformat(),
           "pipelinesInIndex": len(pipes), "withRelease": len(jobs), "items": []}
    with cf.ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(clone, n, s): (n, t, s, pub, arch) for n, t, s, pub, arch in jobs}
        for f in cf.as_completed(futs):
            n, t, s, pub, arch = futs[f]
            res = f.result()
            out["items"].append({"name": n, "tag": t, "sha": s, "publishedAt": pub, "archived": arch, **res})
            print(n, t, res["status"], flush=True)
    out["items"].sort(key=lambda x: x["name"])
    json.dump(out, open(f"{ROOT}/fetch-manifest.json", "w"), indent=1)


if __name__ == "__main__":
    main()
