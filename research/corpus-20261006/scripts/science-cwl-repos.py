#!/usr/bin/env python3
"""Public CWL workflow repositories (cloned by science-fetch-git.py) -> foundry-corpus-item/1.

Top-level workflows = files with `class: Workflow` not referenced by any other file's `run:`; test,
unit-test, deprecated and pilot/dev scratch paths are skipped; up to MAX_PER_REPO per repository,
largest first. Licence from the repository LICENSE file at the cloned commit.
Output: /opt/corpus/science-work/cwl-repos.jsonl
"""
import glob, importlib.util, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


sc = load("science_common", "science-common.py")
cw = load("science_cwl", "science-cwl.py")
bd = load("science_builders", "science-builders.py")
MAX_PER_REPO = 8
SKIP = re.compile(r"(?i)(^|/)(tests?|unit_tests|deprecated|pilot-run|examples?|old|archive|draft)(/|$)")


def license_of(repo):
    for f in sorted(glob.glob(f"{repo}/LICEN[CS]E*") + glob.glob(f"{repo}/COPYING*")):
        if os.path.isfile(f):
            t = open(f, errors="replace").read()
            spdx = sc.classify_license_text(t)
            if spdx == "unknown" and re.search(r"(?i)public\s+domain|united\s+states\s+government\s+work", t):
                spdx = "LicenseRef-US-Government-Public-Domain"
            return spdx, os.path.basename(f)
    return "unknown", None


def main():
    man = json.load(open("/opt/corpus/science-work/git-manifest.json"))
    items, stats = [], {}
    for rec in man:
        if rec["platform"] != "cwl" or rec["status"] != "ok":
            continue
        repo = rec["path"]
        files = [f for f in glob.glob(repo + "/**/*.cwl", recursive=True)]
        wfs = [f for f in files if cw.is_workflow_file(f) and not SKIP.search(os.path.relpath(f, repo))]
        refd = set()
        for f in files:
            refd |= cw.referenced_runs(f)
        top = [f for f in wfs if os.path.realpath(f) not in refd]
        rows = []
        for f in top:
            g = cw.analyze_file(f, repo, sc.classify_step)
            if g is None or len(g.nodes) < 3:
                continue
            rows.append((len(g.nodes), f, g))
        rows.sort(key=lambda r: -r[0])
        spdx, lf = license_of(repo)
        listing = json.load(open(repo + ".files.json")) if os.path.exists(repo + ".files.json") else []
        for n, f, g in rows[:MAX_PER_REPO]:
            rel = os.path.relpath(f, repo)
            doc = g.doc
            label = doc.get("label") or os.path.basename(rel)
            desc = doc.get("doc") or doc.get("label") or ""
            if isinstance(desc, list):
                desc = " ".join(map(str, desc))
            d = os.path.dirname(rel)
            near = [x for x in listing if x.startswith(d + "/") or not d] if d else listing
            item = bd.cwl_item(g, sid=f"{rec['repo']}/{rel}", url=f"https://github.com/{rec['repo']}/blob/{rec['head']}/{rel}",
                               revision=f"commit {rec['head']} ({rec.get('date')})", license=spdx,
                               license_evidence=f"{lf or 'no LICENSE file'} at github.com/{rec['repo']}@{rec['head'][:12]}",
                               raw_path=f, title=f"{label} ({rec['repo']})", description=str(desc),
                               oracle=bd.files_oracle(near), topic_text=rec["repo"] + " " + rel)
            items.append(item)
        stats[rec["repo"]] = {"cwlFiles": len(files), "workflows": len(wfs), "topLevel": len(top), "kept": min(len(rows), MAX_PER_REPO),
                              "license": spdx}
    sc.save_work("cwl-repos", items, stats)
    print(len(items), "CWL repo items", json.dumps(stats))


if __name__ == "__main__":
    main()
