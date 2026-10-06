#!/usr/bin/env python3
"""Galaxy IWC (Intergalactic Workflow Commission) -> foundry-corpus-item/1 (science cluster).

Acquisition (reproducible):
  git -c core.hooksPath=/dev/null clone --depth 1 --filter=blob:limit=1m --no-recurse-submodules \
      https://github.com/galaxyproject/iwc /opt/corpus/galaxy/iwc
  (pinned run: fc190a435262bb61ba29f316e987aa492eb5d18b, 2026-10-01). Then `git -C … checkout <sha>` to reproduce.
Every workflows/**/*.ga becomes one item. Licence: the .ga `license` field (SPDX), per workflow.
Oracle: the sibling <name>-tests.yml (planemo workflow tests): output-equivalence when an output is
compared to a file/checksum, test-profile when only content assertions exist. Not run (needs Galaxy).
Output: /opt/corpus/science-work/galaxy-iwc.jsonl
"""
import glob, importlib.util, json, os, re, subprocess, yaml

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


sc = load("science_common", "science-common.py")
gx = load("science_galaxy", "science-galaxy.py")
ROOT = "/opt/corpus/galaxy/iwc"


def planemo_oracle(test_path):
    if not test_path or not os.path.exists(test_path):
        return {"kind": "none", "notes": "no planemo test file next to the workflow"}, {}
    try:
        tests = yaml.safe_load(open(test_path)) or []
    except Exception as e:
        return {"kind": "none", "notes": f"test file unparsable: {type(e).__name__}"}, {}
    if isinstance(tests, dict):
        tests = [tests]
    n_out, n_file, n_assert, hosts = 0, 0, 0, set()
    raw = open(test_path, errors="replace").read()
    for h in re.findall(r"https?://([^/\s'\"]+)", raw):
        hosts.add(h)
    for t in tests:
        for name, spec in ((t or {}).get("outputs") or {}).items():
            n_out += 1
            s = json.dumps(spec)
            if re.search(r'"(file|checksum|location|path)"', s) or '"compare"' in s:
                n_file += 1
            if re.search(r'"(asserts|has_|element_tests|has_text|has_n_)', s):
                n_assert += 1
    kind = "output-equivalence" if n_file else ("test-profile" if n_out else "none")
    local = os.path.isdir(os.path.join(os.path.dirname(test_path), "test-data"))
    notes = (f"planemo tests: {len(tests)} case(s), {n_out} checked outputs ({n_file} vs reference files/checksums, "
             f"{n_assert} with content assertions); inputs from {sorted(hosts)[:4]}{' + local test-data/' if local else ''}. "
             f"Requires a Galaxy server with the pinned tool versions (planemo test); not run here.")
    return {"kind": kind, "notes": sc.trim(notes, 600)}, {"cases": len(tests), "outputs": n_out, "fileCompare": n_file}


def build_item(ga, *, platform, sid, url, revision, license, license_evidence, raw_path, oracle, extra_notes="",
               topic_text="", title=None):
    res = gx.run(ga, sc.classify_step)
    g = res["graph"]
    nodes = list(g.nodes.values())
    edges = sc.dedupe_edges(g.edges)
    tags = ga.get("tags") or []
    pk = sorted(p for p in g.packages if p)
    connectors = [f"tool:{p}" for p in pk] + [f"service:{s}" for s in sorted(g.services)]
    doms = sc.domains_for(" ".join([ga.get("name") or "", ga.get("annotation") or "", " ".join(map(str, tags)), topic_text, " ".join(pk)]),
                          base=("science", "bioinformatics"))
    feats = sc.compute_features(nodes, edges, guards=len(g.guards), loops=g.fanout, async_kinds=sorted(g.async_kinds),
                                connectors=connectors, domains=doms, extra_subworkflows=g.subworkflow_calls)
    needs = []
    if "subworkflow-by-reference" in g.notes:
        needs.append("subworkflow-call")
    pja = ", ".join(f"{k}x{v}" for k, v in sorted(g.pja.items(), key=lambda kv: -kv[1]))
    notes = (f"Galaxy native workflow; {g.subworkflow_calls} embedded sub-workflow(s) inlined (max depth {g.max_depth}). "
             f"Implicit mapping over dataset collections -> IR map; conditional steps (`when` on boolean params) -> when guards; "
             f"pick_value -> merge; tools are pinned ToolShed versions -> task over a galaxy-tool capability. "
             f"Post-job actions: {pja or 'none'}. {extra_notes}")
    ir = sc.ir_verdict(feats, needs=needs, notes=notes)
    spdx = sc.norm_spdx(license)
    red = sc.redistributable_license(spdx)
    return sc.make_item(platform=platform, sid=sid, url=url, revision=revision, retrieved=sc.RETRIEVED, license=spdx,
                        license_evidence=license_evidence, redistributable=red, raw_path=raw_path,
                        title=title or (ga.get("name") or sid), description=(ga.get("annotation") or "") + (f" Tags: {', '.join(map(str, tags[:10]))}." if tags else ""),
                        desc_provenance="original", nodes=nodes, edges=edges, features=feats, ir=ir, oracle=oracle)


def main():
    sha = subprocess.run(["git", "-C", ROOT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    items, stats = [], {}
    for path in sorted(glob.glob(f"{ROOT}/workflows/**/*.ga", recursive=True)):
        rel = os.path.relpath(path, ROOT)
        ga = json.load(open(path))
        base = path[:-3]
        tp = next((p for p in (base + "-tests.yml", base + "-test.yml", base + "-tests.yaml") if os.path.exists(p)), None)
        oracle, ost = planemo_oracle(tp)
        cat_dir = rel.split("/")[1]
        wf_dir = rel.split("/")[-2]
        item = build_item(ga, platform="galaxy", sid=f"iwc/{wf_dir}/{os.path.basename(path)[:-3]}",
                          url=f"https://github.com/galaxyproject/iwc/blob/{sha}/{rel}",
                          revision=f"iwc commit {sha}; workflow release {ga.get('release') or ga.get('version')}",
                          license=ga.get("license"),
                          license_evidence=f"`license` field of {rel} at galaxyproject/iwc@{sha[:12]}",
                          raw_path=path, oracle=oracle, topic_text=cat_dir,
                          title=f"{ga.get('name')} (IWC {cat_dir}, v{ga.get('release') or '?'})")
        items.append(item)
        stats[rel] = {"nodes": item["features"]["nodeCount"], **ost}
    sc.save_work("galaxy-iwc", items, stats)
    print(len(items), "IWC items")


if __name__ == "__main__":
    main()
