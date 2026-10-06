#!/usr/bin/env python3
"""Public WDL workflow repositories (cloned by science-fetch-git.py) -> foundry-corpus-item/1.
Run with /opt/corpus/.venv-science/bin/python -I (needs miniwdl). Every .wdl file that defines a
`workflow` and is not under tests/verification/deprecated paths is loaded; files miniwdl rejects
(import missing, type-check error, remote import) are recorded as failures with the reason.
Output: /opt/corpus/science-work/wdl-repos.jsonl (+ -stats.json with failures)
"""
import glob, importlib.util, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


sc = load("science_common", "science-common.py")
wd = load("science_wdl", "science-wdl.py")
bd = load("science_builders", "science-builders.py")
SKIP = re.compile(r"(?i)(^|/)(tests?|verification|deprecated|scripts|website|examples?|projects|all_of_us|beta-pipelines/.*/test)(/|$)|Test[A-Z]\w*\.wdl$")


def license_of(repo):
    for f in sorted(glob.glob(f"{repo}/LICEN[CS]E*") + glob.glob(f"{repo}/COPYING*")):
        if os.path.isfile(f):
            return sc.classify_license_text(open(f, errors="replace").read()), os.path.basename(f)
    return "unknown", None


def main():
    man = json.load(open("/opt/corpus/science-work/git-manifest.json"))
    items, stats = [], {}
    for rec in man:
        if rec["platform"] != "wdl" or rec["status"] != "ok":
            continue
        repo = rec["path"]
        spdx, lf = license_of(repo)
        listing = json.load(open(repo + ".files.json")) if os.path.exists(repo + ".files.json") else []
        fails, kept = {}, 0
        for f in sorted(glob.glob(repo + "/**/*.wdl", recursive=True)):
            rel = os.path.relpath(f, repo)
            if SKIP.search(rel):
                continue
            src = open(f, errors="replace").read()
            if not re.search(r"(?m)^\s*workflow\s+\w+\s*\{", src):
                continue
            try:
                g, doc = wd.analyze_file(f, repo, sc.classify_step, rec["repo"])
            except Exception as e:
                fails[rel] = f"{type(e).__name__}: {str(e)[:160]}"
                continue
            if g is None or len(g.nodes) < 3:
                continue
            wf = doc.workflow
            meta = dict(getattr(wf, "meta", {}) or {})
            desc = str(meta.get("description") or "")
            d = os.path.dirname(rel)
            near = [x for x in listing if x.startswith(d + "/")] if d else listing
            items.append(bd.wdl_item(g, sid=f"{rec['repo']}/{rel}", url=f"https://github.com/{rec['repo']}/blob/{rec['head']}/{rel}",
                                     revision=f"commit {rec['head']} ({rec.get('date')})", license=spdx,
                                     license_evidence=f"{lf or 'no LICENSE file'} at github.com/{rec['repo']}@{rec['head'][:12]}",
                                     raw_path=f, title=f"{wf.name} ({rec['repo']})", description=desc,
                                     oracle=bd.files_oracle(near), topic_text=rec["repo"] + " " + rel))
            kept += 1
        stats[rec["repo"]] = {"kept": kept, "failures": fails, "license": spdx}
    sc.save_work("wdl-repos", items, stats)
    print(len(items), "WDL repo items;", {k: (v["kept"], len(v["failures"])) for k, v in stats.items()})


if __name__ == "__main__":
    main()
