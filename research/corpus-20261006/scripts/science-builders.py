"""Item builders shared by the science-cluster drivers for CWL, WDL and generic (non-nf-core) Nextflow
graphs. Galaxy and Snakemake builders live in science-iwc.py / science-snakemake-catalog.py.
Pure functions; nothing executed."""
import importlib.util, os, re

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name, f):
    sp = importlib.util.spec_from_file_location(name, os.path.join(HERE, f))
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


sc = load("science_common", "science-common.py")


def _common(platform, sid, url, revision, license, license_evidence, raw_path, title, description, nodes, edges,
            feats, ir, oracle, desc_provenance="original"):
    spdx = sc.norm_spdx(license)
    return sc.make_item(platform=platform, sid=sid, url=url, revision=revision, retrieved=sc.RETRIEVED, license=spdx,
                        license_evidence=license_evidence, redistributable=sc.redistributable_license(spdx), raw_path=raw_path,
                        title=title, description=description or "", desc_provenance=desc_provenance, nodes=nodes, edges=edges,
                        features=feats, ir=ir, oracle=oracle)


def cwl_item(g, *, sid, url, revision, license, license_evidence, raw_path, title, description, oracle, topic_text="", platform="cwl"):
    nodes = list(g.nodes.values())
    edges = sc.dedupe_edges(g.edges)
    pk = sorted(p for p in g.packages if p and len(p) > 1)
    connectors = [f"tool:{p}" for p in pk] + [f"service:{s}" for s in sorted(g.services)]
    doms = sc.domains_for(" ".join([title, description or "", topic_text, " ".join(pk), " ".join(g.nodes)]), base=("science",))
    feats = sc.compute_features(nodes, edges, guards=len(g.guards), loops=g.fanout, async_kinds=[], connectors=connectors,
                                domains=doms, extra_subworkflows=g.subworkflow_calls)
    needs = []
    if g.unresolved:
        needs.append("subworkflow-call")
    notes = (f"CWL Workflow; {g.subworkflow_calls} sub-workflow step(s) inlined (max depth {g.max_depth}); {g.inputs} workflow inputs (not nodes). "
             f"scatter -> IR map ({g.fanout}); `when` (CWL v1.2) -> when guards ({len(g.guards)}); pickValue inputs: {g.pick_value}; "
             f"valueFrom/JS expressions on step inputs: {g.expr_inputs} (-> code nodes or arg templating); "
             f"CommandLineTools run in Docker -> task over a container-exec capability. Requirements seen: {sorted(x for x in g.reqs if x)[:10]}. "
             + (f"Unresolved run references: {sorted(g.unresolved)[:3]}." if g.unresolved else ""))
    ir = sc.ir_verdict(feats, needs=needs, notes=notes)
    return _common(platform, sid, url, revision, license, license_evidence, raw_path, title, description, nodes, edges, feats, ir, oracle)


def wdl_item(g, *, sid, url, revision, license, license_evidence, raw_path, title, description, oracle, topic_text="", platform="wdl"):
    nodes = list(g.nodes.values())
    edges = sc.dedupe_edges(g.edges)
    pk = sorted(p for p in g.packages if p and len(p) > 1)
    connectors = [f"tool:{p}" for p in pk] + [f"service:{s}" for s in sorted(g.services)]
    doms = sc.domains_for(" ".join([title, description or "", topic_text, " ".join(pk), " ".join(g.nodes)]), base=("science",))
    feats = sc.compute_features(nodes, edges, guards=len(g.guards), loops=g.fanout, async_kinds=[], connectors=connectors,
                                domains=doms, extra_subworkflows=g.subworkflow_calls)
    notes = (f"WDL workflow parsed and type-checked with miniwdl 1.15.0 (imports resolved locally only); {g.subworkflow_calls} sub-workflow "
             f"call(s) inlined (max depth {g.max_depth}). scatter -> IR map ({g.fanout}); if-sections -> when guards ({len(g.guards)}); "
             f"tasks with runtime maxRetries: {g.retries} (fixed-count retry = IR retry); tasks run in Docker -> task over a container-exec capability.")
    ir = sc.ir_verdict(feats, needs=[], notes=notes)
    return _common(platform, sid, url, revision, license, license_evidence, raw_path, title, description, nodes, edges, feats, ir, oracle)


def nextflow_item(g, *, sid, url, revision, license, license_evidence, raw_path, title, description, oracle, dsl, repo,
                  topic_text="", platform="nextflow"):
    nodes = list(g.nodes.values())
    edges = sc.dedupe_edges(g.edges)
    noise = {"i", "ls", "bam", "echo", "set", "cd", "python", "python3", "rscript", "r", "bash", "sh", "perl", "java", "awk", "grep", "sed", "git"}
    pk = sorted(p for p in g.packages if p and p.split(":")[-1] not in noise and len(p.split(":")[-1]) > 2)
    connectors = [f"tool:{p}" for p in pk] + [f"service:{s}" for s in sorted(g.services)]
    doms = sc.domains_for(" ".join([title, description or "", topic_text, " ".join(pk)]), base=("science",))
    async_kinds = ["event"] if "watchPath" in g.channel_factories else []
    feats = sc.compute_features(nodes, edges, guards=len(g.guards), loops=g.fanout, async_kinds=async_kinds, connectors=connectors,
                                domains=doms, extra_subworkflows=g.subworkflow_calls)
    needs = []
    base_cfg = os.path.join(repo, "conf", "base.config")
    cfg_text = ""
    for c in [base_cfg, os.path.join(repo, "nextflow.config")]:
        if os.path.exists(c):
            cfg_text += open(c, errors="replace").read()
    if "task.attempt" in cfg_text and "retry" in cfg_text:
        needs.append("retry-policy")
    if "onComplete" in g.hooks and g.services & {"email", "im-webhook"}:
        needs.append("completion-hook")
    if "onError" in g.hooks:
        needs.append("error-branch")
    if async_kinds:
        needs.append("event-trigger")
    if "iteration-operator" in g.notes:
        needs.append("dynamic-dag")
    ops = ", ".join(f"{k}x{v}" for k, v in sorted(g.ops.items(), key=lambda kv: -kv[1])[:8])
    notes = (f"Static Nextflow {dsl.upper()} analysis ({getattr(g, 'files_parsed', 0)} .nf files); {g.subworkflow_calls} sub-workflow calls inlined; "
             f"edges are may-flow. Processes map over channel items -> IR map; params-gated if-blocks -> when guards. Operators: {ops or 'none'}.")
    ir = sc.ir_verdict(feats, needs=needs, notes=notes)
    return _common(platform, sid, url, revision, license, license_evidence, raw_path, title, description, nodes, edges, feats, ir, oracle)


def files_oracle(files, extra_kind=None, extra_notes=""):
    """Oracle from a repository file listing (tree objects) or a crate's test entities."""
    f = files or []
    planemo = [x for x in f if re.search(r"-tests?\.ya?ml$", x)]
    cwltest = [x for x in f if re.search(r"(^|/)(tests?|conformance)[^/]*\.ya?ml$|cwltest", x)]
    jobs = [x for x in f if re.search(r"(job|input|params?)[^/]*\.(ya?ml|json)$", x, re.I)]
    nftest = [x for x in f if x.endswith(".nf.test")]
    snaps = [x for x in f if x.endswith(".nf.test.snap")]
    smk = [x for x in f if x.startswith((".test/", ".tests/"))]
    testcfg = [x for x in f if re.search(r"conf/test[^/]*\.config$", x)]
    tdata = [x for x in f if re.search(r"(^|/)(test[-_]?data|tests?/data|testdata)/", x, re.I)]
    expected = [x for x in f if re.search(r"(expected|truth|golden|(^|/)ref_output/|(^|/)verification/(Verify|test-wdls/Test))", x, re.I)]
    testin = [x for x in f if re.search(r"(^|/)(test_inputs|test_workflow|example_input_json)/.*\.(json|ya?ml)$", x)]
    if extra_kind:
        kind = extra_kind
    elif snaps or (planemo and expected) or (cwltest and expected) or (testin and expected):
        kind = "output-equivalence"
    elif planemo or cwltest or nftest or smk or testcfg or testin or (jobs and tdata):
        kind = "test-profile"
    else:
        kind = "none"
    notes = (f"repo listing: planemo tests {len(planemo)}, cwltest/test yml {len(cwltest)}, job/param files {len(jobs)}, nf-test {len(nftest)} "
             f"(snapshots {len(snaps)}), Snakemake .test files {len(smk)}, test configs {len(testcfg)}, test-input sets {len(testin)}, test-data files {len(tdata)}, "
             f"expected/truth files {len(expected)}. {extra_notes} Not run here.")
    return {"kind": kind, "notes": sc.trim(notes, 600)}
