#!/usr/bin/env python3
"""Snakemake workflow catalog acquisition (science cluster).

Catalog: github.com/snakemake/snakemake-workflow-catalog (data.json; clone pinned in the ledger) at
/opt/corpus/snakemake/catalog. Picks the top-N *standardized* workflows by stars (the catalog's own
template repository is excluded) and makes a shallow, blob-filtered, sparse clone of each at its latest
release tag (else default-branch HEAD) into /opt/corpus/snakemake/repos/<owner>__<repo>.
Only workflow definition files are checked out (Snakefile, *.smk, rules/, workflow/, config/, .test/,
.tests/, .github/workflows/, LICENSE*). No LFS/submodules, hooks disabled, nothing executed.
Usage: python3 -I science-fetch-snakemake.py [N]
"""
import concurrent.futures as cf, json, os, subprocess, sys

ROOT = "/opt/corpus/snakemake"
GIT = ["git", "-c", "core.hooksPath=/dev/null", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false",
       "-c", "protocol.file.allow=never"]
SPARSE = ["/Snakefile", "/snakefile", "/*.smk", "/*.snakefile", "/rules/", "/workflow/", "/config/", "/.test/", "/.tests/",
          "/.github/workflows/", "/LICENSE", "/LICENSE.*", "/LICENCE", "/COPYING", "/README.md", "/test/", "/tests/"]
EXCLUDE = {"snakemake-workflows/snakemake-workflow-template"}


def clone(full, tag):
    d = f"{ROOT}/repos/{full.replace('/', '__')}"
    url = f"https://github.com/{full}"
    try:
        if not os.path.isdir(f"{d}/.git"):
            os.makedirs(d, exist_ok=True)
            subprocess.run(GIT + ["init", "-q", d], check=True)
            subprocess.run(GIT + ["-C", d, "remote", "add", "origin", url], check=True)
        subprocess.run(GIT + ["-C", d, "sparse-checkout", "set", "--no-cone", *SPARSE], check=True)
        ref = f"refs/tags/{tag}" if tag else "HEAD"
        r = subprocess.run(GIT + ["-C", d, "fetch", "-q", "--depth", "1", "--filter=blob:limit=2m", "--no-recurse-submodules",
                                  "origin", ref], timeout=600, capture_output=True, text=True)
        if r.returncode != 0 and tag:
            ref = "HEAD"
            subprocess.run(GIT + ["-C", d, "fetch", "-q", "--depth", "1", "--filter=blob:limit=2m", "--no-recurse-submodules",
                                  "origin", "HEAD"], check=True, timeout=600)
        elif r.returncode != 0:
            raise RuntimeError(r.stderr.strip()[:200])
        subprocess.run(GIT + ["-C", d, "checkout", "-q", "FETCH_HEAD"], check=True, timeout=600)
        head = subprocess.run(["git", "-C", d, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        date = subprocess.run(["git", "-C", d, "log", "-1", "--format=%cI"], capture_output=True, text=True).stdout.strip()
        return {"status": "ok", "head": head, "ref": ref, "date": date, "path": d}
    except Exception as e:
        return {"status": f"error: {str(e)[:200]}", "path": d}


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 70
    data = json.load(open(f"{ROOT}/catalog/data.json"))
    std = [r for r in data if r.get("standardized") and r["full_name"] not in EXCLUDE]
    std.sort(key=lambda r: -(r.get("stargazers_count") or 0))
    pick = std[:n]
    out = []
    with cf.ThreadPoolExecutor(4) as ex:
        futs = {ex.submit(clone, r["full_name"], r.get("latest_release")): r for r in pick}
        for f in cf.as_completed(futs):
            r = futs[f]
            res = f.result()
            out.append({"full_name": r["full_name"], "stars": r.get("stargazers_count"), "release": r.get("latest_release"),
                        "topics": r.get("topics"), "description": r.get("description"), **res})
            print(r["full_name"], res["status"], flush=True)
    out.sort(key=lambda x: -(x.get("stars") or 0))
    json.dump({"catalog": "https://github.com/snakemake/snakemake-workflow-catalog", "standardized": len(std), "items": out},
              open(f"{ROOT}/fetch-manifest.json", "w"), indent=1)


if __name__ == "__main__":
    main()
