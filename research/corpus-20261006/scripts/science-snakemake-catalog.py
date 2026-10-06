#!/usr/bin/env python3
"""Snakemake workflow catalog repos -> foundry-corpus-item/1 (science cluster).

Input: /opt/corpus/snakemake/fetch-manifest.json and sparse clones from science-fetch-snakemake.py.
Graph: science-snakemake.py static rule analysis. Licence: the repository LICENSE/COPYING file at the
cloned commit (classified to SPDX). Oracle: `.test/` configs (CI test profile, listed from git tree
objects), `.tests/unit/` generated unit tests with expected outputs (output-equivalence). Not run.
`build_item()` is reused by the WorkflowHub converter.
Output: /opt/corpus/science-work/snakemake-catalog.jsonl
"""
import glob, importlib.util, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


sc = load("science_common", "science-common.py")
sm = load("science_snakemake", "science-snakemake.py")
ROOT = "/opt/corpus/snakemake"


def license_of(repo):
    for f in sorted(glob.glob(f"{repo}/LICEN[CS]E*") + glob.glob(f"{repo}/COPYING*")):
        if os.path.isfile(f):
            return sc.classify_license_text(open(f, errors="replace").read()), os.path.basename(f)
    return "unknown", None


def oracle_for(files, repo):
    test_files = [f for f in files if f.startswith((".test/", "test/", "tests/", ".tests/"))]
    unit = [f for f in files if f.startswith(".tests/unit/") and f.endswith(".py")]
    expected = [f for f in files if "/expected/" in f]
    ci = []
    for f in glob.glob(f"{repo}/.github/workflows/*.y*ml"):
        t = open(f, errors="replace").read()
        if "snakemake" in t.lower() and (".test" in t or "--directory" in t or "snakemake-github-action" in t):
            ci.append(os.path.basename(f))
    data = [f for f in test_files if not re.search(r"\.(ya?ml|tsv|csv|md|txt|json)$", f)]
    if unit and expected:
        kind = "output-equivalence"
    elif test_files or ci:
        kind = "test-profile"
    else:
        kind = "none"
    notes = (f"{len(test_files)} files under test dirs ({len(data)} data files), {len(unit)} generated unit tests "
             f"({len(expected)} expected-output files); CI workflows running the test profile: {ci[:4]}. "
             f"Needs snakemake + conda/apptainer; not run here.")
    return {"kind": kind, "notes": sc.trim(notes, 600)}


def build_item(res, *, platform, sid, url, revision, license, license_evidence, raw_path, title, description,
               oracle, topic_text="", desc_provenance="original"):
    nodes = list(res["nodes"].values())
    edges = sc.dedupe_edges(res["edges"])
    st = res["stats"]
    services = set(st["services"])
    for s in st["storage"]:
        services.add({"http": "http-download", "s3": "igenomes-s3", "ftp": "http-download", "HTTP": "http-download",
                      "S3": "igenomes-s3", "FTP": "http-download", "NCBI": "ncbi", "GS": "gcs", "gcs": "gcs"}.get(s, s))
    connectors = [f"tool:{p}" for p in sorted(st["packages"]) if len(p) > 2] + [f"service:{s}" for s in sorted(services)]
    doms = sc.domains_for(" ".join([title, description or "", topic_text, " ".join(res["nodes"].keys())]), base=("science",))
    loops = st["expand"] + st["checkpoints"]
    feats = sc.compute_features(nodes, edges, guards=st["guards"], loops=loops, async_kinds=[], connectors=connectors,
                                domains=doms, extra_subworkflows=st["use_from_module"])
    needs = []
    if st["checkpoints"]:
        needs.append("dynamic-dag")
    if st["modules"] or st["use_from_module"]:
        needs.append("subworkflow-call")
    if "onerror" in st["handlers"]:
        needs.append("error-branch")
    if st["attempt_resources"]:
        needs.append("retry-policy")
    if any(n["type"] == "snakemake.onsuccess" and n["effects"] == "external" for n in nodes):
        needs.append("completion-hook")
    notes = (f"Static Snakefile analysis from {res['entry']} ({st['files']} files, {st['rules']} rules, {st['checkpoints']} checkpoints, "
             f"{st['wrappers']} wrapper rules). Edges inferred by matching input to output path patterns "
             f"({st['pattern_edges']} pattern, {st['explicit_edges']} rules.X.output, {st['fallback_edges']} basename fallback); "
             f"{st['dynamic_inputs']} input functions/lambdas only partly resolvable statically. Wildcard rules aggregated by expand() "
             f"-> IR map over the config-defined sample set; checkpoints re-evaluate the DAG at run time (dynamic-dag); "
             f"retries:{st['retries']}; storage providers: {st['storage'] or 'none'}.")
    ir = sc.ir_verdict(feats, needs=needs, notes=notes)
    spdx = sc.norm_spdx(license)
    return sc.make_item(platform=platform, sid=sid, url=url, revision=revision, retrieved=sc.RETRIEVED, license=spdx,
                        license_evidence=license_evidence, redistributable=sc.redistributable_license(spdx), raw_path=raw_path,
                        title=title, description=description or "", desc_provenance=desc_provenance, nodes=nodes, edges=edges,
                        features=feats, ir=ir, oracle=oracle)


def main():
    man = json.load(open(f"{ROOT}/fetch-manifest.json"))
    items, stats = [], {}
    for rec in man["items"]:
        if rec["status"] != "ok":
            stats[rec["full_name"]] = {"skipped": rec["status"]}
            continue
        repo = rec["path"]
        res = sm.analyze(repo, sc.classify_step)
        if res is None or len([n for n in res["nodes"].values() if n["category"] != "other"]) < 2:
            stats[rec["full_name"]] = {"skipped": "no parsable rules"}
            continue
        files = json.load(open(repo + ".files.json")) if os.path.exists(repo + ".files.json") else []
        spdx, lf = license_of(repo)
        topics = rec.get("topics") or []
        tag = rec["ref"].replace("refs/tags/", "") if rec["ref"].startswith("refs/tags/") else None
        item = build_item(res, platform="snakemake", sid=rec["full_name"] + (f"@{tag}" if tag else ""),
                          url=f"https://github.com/{rec['full_name']}/tree/{rec['head']}",
                          revision=f"{'tag ' + tag + ' ' if tag else 'default branch '}commit {rec['head']} ({rec.get('date')})",
                          license=spdx, license_evidence=f"{lf or 'no LICENSE file'} at github.com/{rec['full_name']}@{rec['head'][:12]}",
                          raw_path=repo, title=f"{rec['full_name']}" + (f" {tag}" if tag else ""),
                          description=(rec.get("description") or "") + (f" Topics: {', '.join(topics[:10])}." if topics else ""),
                          oracle=oracle_for(files, repo), topic_text=" ".join(topics))
        items.append(item)
        stats[rec["full_name"]] = {"nodes": item["features"]["nodeCount"], "edges": item["features"]["edgeCount"], "license": spdx}
    sc.save_work("snakemake-catalog", items, stats)
    print(len(items), "snakemake catalog items;", sum(1 for s in stats.values() if "skipped" in s), "skipped")


if __name__ == "__main__":
    main()
