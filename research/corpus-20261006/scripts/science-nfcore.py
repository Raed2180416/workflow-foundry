#!/usr/bin/env python3
"""nf-core -> foundry-corpus-item/1 (science cluster).

Input: /opt/corpus/nf-core/fetch-manifest.json + pipelines.json + sparse clones (science-fetch-nfcore.py).
Each released pipeline at its latest release tag becomes one item. The graph comes from the static
DSL2 analysis in science-nextflow.py (sub-workflows inlined; DSL1 pipelines use the from/into analysis).
Licence is read from each clone's LICENSE file. Oracle: conf/test*.config profiles (test data pinned
in nf-core/test-datasets) and nf-test snapshots (tests/*.nf.test.snap). Nothing is executed.
Output: /opt/corpus/science-work/nf-core.jsonl
"""
import glob, importlib.util, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


sc = load("science_common", "science-common.py")
nfa = load("science_nextflow", "science-nextflow.py")
ROOT = "/opt/corpus/nf-core"
NOISE = {"i", "ls", "bam", "echo", "set", "cd", "python", "python3", "rscript", "r", "bash", "sh", "perl", "java", "awk", "grep", "sed", "git"}


def oracle_for(repo):
    profiles = sorted(os.path.basename(p)[:-7] for p in glob.glob(f"{repo}/conf/test*.config"))
    tests = glob.glob(f"{repo}/tests/**/*.nf.test", recursive=True)
    snaps = glob.glob(f"{repo}/tests/**/*.nf.test.snap", recursive=True)
    md5 = 0
    for s in snaps:
        try:
            t = open(s, errors="replace").read()
        except OSError:
            continue
        md5 += len(re.findall(r"md5,[0-9a-f]{32}", t))
    data_hosts = set()
    for p in glob.glob(f"{repo}/conf/test*.config"):
        for h in re.findall(r"https?://([^/'\"]+)/([^/'\"]+/[^/'\"]+)", open(p, errors="replace").read()):
            data_hosts.add(h[0] + "/" + h[1] if "githubusercontent" in h[0] else h[0])
    if snaps and md5:
        kind = "output-equivalence"
    elif profiles or tests:
        kind = "test-profile"
    else:
        kind = "none"
    notes = (f"profiles {profiles[:8]}; nf-test files {len(tests)}, snapshots {len(snaps)} with {md5} md5 entries; "
             f"test data from {sorted(data_hosts)[:4]}. Needs Nextflow + a container engine (Docker/Singularity); "
             f"not run here (no container daemon). nf-test snapshots compare output md5s and file lists; stub runs exist for some.")
    return {"kind": kind, "notes": sc.trim(notes, 600)}, {"profiles": profiles, "nftests": len(tests), "snaps": len(snaps), "md5": md5}


def retry_policy(repo):
    p = f"{repo}/conf/base.config"
    if not os.path.exists(p):
        return False, False
    t = open(p, errors="replace").read()
    adaptive = "task.attempt" in t and "retry" in t
    ignore = False
    for c in glob.glob(f"{repo}/conf/*.config") + [f"{repo}/nextflow.config"]:
        if os.path.exists(c) and re.search(r"errorStrategy\s*=\s*['\"]ignore['\"]", open(c, errors="replace").read()):
            ignore = True
    return adaptive, ignore


def main():
    man = json.load(open(f"{ROOT}/fetch-manifest.json"))
    idx = {p["name"]: p for p in json.load(open(f"{ROOT}/pipelines.json"))["remote_workflows"]}
    items, stats = [], {}
    for rec in man["items"]:
        if rec["status"] != "ok":
            stats[rec["name"]] = {"skipped": rec["status"]}
            continue
        name, repo = rec["name"], rec["path"]
        meta = idx.get(name, {})
        g = nfa.analyze_repo(repo, sc.classify_step)
        dsl = "dsl2"
        if g is None or not g.nodes:
            g = nfa.analyze_dsl1(repo, sc.classify_step)
            dsl = "dsl1"
        if g is None or not g.nodes:
            stats[name] = {"skipped": "no graph"}
            continue
        nodes = list(g.nodes.values())
        edges = sc.dedupe_edges(g.edges)
        lic_txt = ""
        for lf in ("LICENSE", "LICENCE", "LICENSE.md"):
            if os.path.exists(f"{repo}/{lf}"):
                lic_txt = open(f"{repo}/{lf}", errors="replace").read()
                break
        spdx = sc.classify_license_text(lic_txt)
        oracle, ost = oracle_for(repo)
        adaptive, ignore = retry_policy(repo)
        async_kinds = ["event"] if "watchPath" in g.channel_factories else []
        pk = sorted(p for p in g.packages if p and p.split(":")[-1] not in NOISE and len(p.split(":")[-1]) > 2)
        connectors = [f"tool:{p}" for p in pk] + [f"service:{s}" for s in sorted(g.services)]
        desc = meta.get("description") or ""
        topics = meta.get("topics") or []
        if isinstance(topics, str):
            topics = re.findall(r"'([^']+)'", topics)
        doms = sc.domains_for(" ".join([name, desc, " ".join(topics)]) + " " + " ".join(pk[:60]), base=("science", "bioinformatics"))
        feats = sc.compute_features(nodes, edges, guards=len(g.guards), loops=g.fanout, async_kinds=async_kinds,
                                    connectors=connectors, domains=doms, extra_subworkflows=g.subworkflow_calls)
        needs = []
        if adaptive:
            needs.append("retry-policy")
        if "onComplete" in g.hooks and g.services & {"email", "im-webhook"}:
            needs.append("completion-hook")
        if "onError" in g.hooks:
            needs.append("error-branch")
        if async_kinds:
            needs.append("event-trigger")
        if g.notes & {"iteration-operator"}:
            needs.append("dynamic-dag")
        params = 0
        try:
            sch = json.load(open(f"{repo}/nextflow_schema.json"))
            for d in list((sch.get("$defs") or sch.get("definitions") or {}).values()):
                params += len(d.get("properties", {}))
            params += len(sch.get("properties", {}))
        except Exception:
            pass
        ops = ", ".join(f"{k}x{v}" for k, v in sorted(g.ops.items(), key=lambda kv: -kv[1])[:8])
        notes = (f"Static {dsl.upper()} analysis; {g.subworkflow_calls} sub-workflow calls inlined; edges are may-flow "
                 f"(conditional channel reassignments unioned; versions channels ignored). Every process is implicitly mapped over "
                 f"channel items (samples) -> IR map with when-guards on params; keyed join/groupTuple regrouping -> code nodes "
                 f"between maps; each process runs a containerised tool -> task over a container-exec capability. "
                 f"Operators: {ops}. Params in schema: {params}."
                 + (" base.config retries with task.attempt-scaled cpus/memory/time (IR retry has fixed attempts only)." if adaptive else "")
                 + (" Some processes use errorStrategy 'ignore' (= onError continue)." if ignore else ""))
        ir = sc.ir_verdict(feats, needs=needs, notes=notes)
        title = f"nf-core/{name} {rec['tag']}" + (" (archived)" if rec.get("archived") else "")
        item = sc.make_item(
            platform="nf-core", sid=f"{name}@{rec['tag']}", url=f"https://nf-co.re/{name}/{rec['tag']}",
            revision=f"tag {rec['tag']} commit {rec['sha']} (published {rec.get('publishedAt')})",
            retrieved=sc.RETRIEVED, license=spdx,
            license_evidence=f"LICENSE at github.com/nf-core/{name}@{rec['sha'][:12]} (classified {spdx}); nf-core org policy is MIT",
            redistributable=sc.redistributable_license(spdx), raw_path=repo, title=title,
            description=desc + (f" Topics: {', '.join(topics[:10])}." if topics else ""), desc_provenance="original",
            nodes=nodes, edges=edges, features=feats, ir=ir, oracle=oracle)
        items.append(item)
        stats[name] = {"dsl": dsl, "nodes": len(nodes), "edges": len(edges), "unresolved": sorted(g.unresolved),
                       "files": getattr(g, "files_parsed", 0), **ost}
    sc.save_work("nf-core", items, stats)
    print(len(items), "nf-core items;", sum(1 for s in stats.values() if "skipped" in s), "skipped")


if __name__ == "__main__":
    main()
