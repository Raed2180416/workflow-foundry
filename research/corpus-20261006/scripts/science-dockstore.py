#!/usr/bin/env python3
"""Dockstore WDL entries (fetched by science-fetch-dockstore.py) -> foundry-corpus-item/1.
Run with /opt/corpus/.venv-science/bin/python -I (needs miniwdl). Nothing is executed.

For each files-manifest.json record with a PRIMARY_DESCRIPTOR, the primary .wdl is loaded with miniwdl
using the local-only reader of science-wdl.py rooted at files/<n>/ (imports resolve only against the
SECONDARY_DESCRIPTORs Dockstore served; remote imports are refused and recorded as failures).
Licence: Dockstore entry `licenseInformation.licenseName` (GitHub-detected licence of the source repo),
mapped to SPDX; 'Other' and missing -> unknown (non-redistributable: URL + graph features only).
Oracle: TRS TEST_FILE parameter JSONs are input fixtures only (no expected outputs) -> test-profile;
inputs pointing at gs:// / s3:// / drs:// need cloud access, recorded in the notes.
Output: /opt/corpus/science-work/dockstore.jsonl (+ -stats.json with failures)
"""
import collections, glob, importlib.util, json, os, re, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


sc = load("science_common", "science-common.py")
wd = load("science_wdl", "science-wdl.py")
bd = load("science_builders", "science-builders.py")
ROOT = "/opt/corpus/dockstore"
GH_LICENSE = {
    "MIT License": "MIT", 'BSD 3-Clause "New" or "Revised" License': "BSD-3-Clause", "BSD 3-Clause Clear License": "BSD-3-Clause-Clear",
    'BSD 2-Clause "Simplified" License': "BSD-2-Clause", "Apache License 2.0": "Apache-2.0", "GNU General Public License v3.0": "GPL-3.0",
    "GNU General Public License v2.0": "GPL-2.0", "GNU Affero General Public License v3.0": "AGPL-3.0", "Mozilla Public License 2.0": "MPL-2.0",
    "Creative Commons Zero v1.0 Universal": "CC0-1.0", "The Unlicense": "Unlicense", "Other": "unknown", None: "unknown",
}


def oracle_for(rec):
    tests = [t for t in rec.get("tests") or []]
    local = []
    for t in tests:
        p = os.path.realpath(os.path.join(rec["path"], t.lstrip("/")))
        if p.startswith(rec["path"] + os.sep) and os.path.isfile(p):
            local.append(p)
    cloud = 0
    for p in local:
        txt = open(p, errors="replace").read()
        if re.search(r'"(gs|s3|drs)://', txt):
            cloud += 1
    if not tests:
        return {"kind": "none", "notes": "Dockstore TRS listing has no TEST_FILE for this version; no expected outputs. Not run here."}
    return {"kind": "test-profile",
            "notes": sc.trim(f"Dockstore TRS TEST_FILE parameter JSON(s): {len(tests)} listed, {len(local)} retrieved; {cloud} reference "
                             f"gs:// / s3:// / drs:// inputs (need cloud credentials/egress). Input fixtures only, no expected outputs "
                             f"(a run would be a smoke test, not output-equivalence). Not run here.", 600)}


def main():
    man = json.load(open(f"{ROOT}/files-manifest.json"))
    items, fails, stats = [], {}, collections.Counter()
    for rec in man:
        stats["entries"] += 1
        if rec.get("status") != "ok" or not rec.get("primary"):
            fails[rec["name"]] = f"no primary descriptor ({rec.get('status')})"
            continue
        root = os.path.realpath(rec["path"])
        rec["path"] = root
        main_f = os.path.join(root, rec["primary"])
        trs = rec["id"].replace("#workflow/", "")
        m = re.match(r"github\.com/([^/]+)/([^/]+)", trs)
        owner_repo = f"{m.group(1)}/{m.group(2)}" if m else None
        try:
            g, doc = wd.analyze_file(main_f, root, sc.classify_step, owner_repo)
        except Exception as e:
            fails[rec["name"]] = f"{type(e).__name__}: {str(e)[:160]}"
            continue
        if g is None:
            fails[rec["name"]] = "no workflow in primary descriptor"
            continue
        if len(g.nodes) < 2:
            fails[rec["name"]] = f"trivial graph ({len(g.nodes)} call)"
            continue
        spdx = GH_LICENSE.get(rec.get("license"), sc.norm_spdx(rec.get("license")))
        wf = doc.workflow
        meta = dict(getattr(wf, "meta", {}) or {})
        desc = str(meta.get("description") or rec.get("description") or "")
        url = f"https://dockstore.org/workflows/{trs}:{urllib.parse.quote(rec['version'], safe='')}"
        item = bd.wdl_item(g, sid=f"{trs}:{rec['version']}", url=url,
                           revision=f"Dockstore version {rec['version']}" + (" (verified)" if rec.get("verified") else "") +
                                    (f", commit {rec['commit']}" if rec.get("commit") else ""),
                           license=spdx,
                           license_evidence=f"https://dockstore.org/api/workflows/path/entry/{urllib.parse.quote(trs, safe='')}/published "
                                            f"licenseInformation.licenseName={rec.get('license')!r} (GitHub-detected licence of {rec.get('gitUrl')})",
                           raw_path=main_f, title=f"{wf.name} ({rec['name']}, Dockstore)", description=desc,
                           oracle=oracle_for(rec), topic_text=" ".join([rec["name"], str(rec.get("topic") or "")]), platform="wdl")
        item["ir"]["notes"] = sc.trim("Dockstore TRS entry. " + item["ir"]["notes"], 600)
        items.append(item)
        stats["converted"] += 1
    stats["failed"] = len(fails)
    sc.save_work("dockstore", items, {"counts": dict(stats), "failures": fails})
    print(dict(stats))
    for k, v in fails.items():
        print(" FAIL", k, "->", v)


if __name__ == "__main__":
    main()
