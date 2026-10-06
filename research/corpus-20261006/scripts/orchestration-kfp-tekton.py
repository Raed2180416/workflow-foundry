#!/usr/bin/env python3
"""Kubeflow Pipelines compiled IR (PipelineSpec YAML) and Tekton PipelineRun/Pipeline examples ->
foundry-corpus-item/1. YAML is parsed as data; nothing is compiled, submitted or executed.

Inputs (module zips from proxy.golang.org, see orchestration-fetch-goproxy.sh):
  /opt/corpus/kubeflow/extracted/github.com/kubeflow/pipelines@<pseudo>/test_data/sdk_compiled_pipelines/**/*.yaml
  /opt/corpus/tekton/extracted/github.com/tektoncd/pipeline@<ver>/examples/**/*.yaml
Usage: <venv python> -I orchestration-kfp-tekton.py kfp|tekton <out.json>
"""
import glob, importlib.util, json, os, re, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("oc", os.path.join(HERE, "orchestration-common.py"))
oc = importlib.util.module_from_spec(spec); spec.loader.exec_module(oc)


class G:
    def __init__(self):
        self.nodes, self.edges = {}, []
        self.guards = self.loops = self.subs = 0
        self.async_kinds, self.connectors, self.needs, self.notes = [], [], set(), set()

    def add(self, nid, ntype, cat, eff, summary):
        k, i = nid, 1
        while k in self.nodes:
            k = f"{nid}__{i}"; i += 1
        self.nodes[k] = {"id": k, "type": ntype, "category": cat, "effects": eff, "summary": summary}
        return k

    def link(self, a, b, kind="control"):
        for x in a:
            for y in b:
                if x != y:
                    self.edges.append({"from": x, "to": y, "kind": kind})


# ----------------------------------------------------------------------------------- KFP ----
KFP_DIR = glob.glob("/opt/corpus/kubeflow/extracted/github.com/kubeflow/pipelines@*")[0]
KFP_MAN = json.load(open(glob.glob("/opt/corpus/kubeflow/*.manifest.json")[0]))
KFP_SHA = KFP_MAN["info"]["Origin"]["Hash"]


def kfp_exec_node(g, nid, comp, execs, task, summ):
    label = comp.get("executorLabel")
    ex = execs.get(label) or {}
    if "importer" in ex:
        g.connectors.append("kfp:importer")
        return g.add(nid, "importer", "action", "read", f"import artifact{summ}")
    if "resolver" in ex:
        return g.add(nid, "resolver", "action", "read", f"resolve artifacts{summ}")
    c = ex.get("container") or {}
    img = str(c.get("image", ""))
    cmd = " ".join(str(x) for x in (c.get("command") or []) + (c.get("args") or []))
    txt = img + " " + cmd
    if "google-cloud-pipeline-components" in txt or "google_cloud_pipeline_components" in txt:
        g.connectors.append("gcp:" + (re.search(r"google_cloud_pipeline_components\.[\w.]+", txt) or [""])[0].split(".")[-1])
        return g.add(nid, "gcpc-container", "action", "external", f"GCPC component image={img.split('@')[0]}{summ}")
    cat = "model" if re.search(r"(?i)tensorflow|torch|transformers|vllm|llm|openai|huggingface|modelcar", txt) else "code"
    eff = "external" if re.search(r"(?i)requests\.|urllib|boto3|google\.cloud|kubernetes|curl|wget|gsutil|s3://|gs://", cmd) else "none"
    kind = "python-component" if "kfp" in cmd and ("executor_main" in cmd or "ephemeral_component" in cmd) else "container"
    if task.get("retryPolicy"):
        summ += f" retry={task['retryPolicy'].get('maxRetryCount', '?')}"
    return g.add(nid, kind, cat, eff, f"{kind} image={img.split('@')[0]}{summ}")


def kfp_dag(g, dag, comps, execs, prefix, stack):
    tasks = dag.get("tasks") or {}
    io = {}
    for tname, t in tasks.items():
        cref = (t.get("componentRef") or {}).get("name")
        comp = comps.get(cref) or {}
        nid = prefix + tname
        bits = []
        cond = (t.get("triggerPolicy") or {}).get("condition")
        if cond:
            g.guards += 1
            bits.append(" when=" + oc.trim(cond, 60))
        strat = (t.get("triggerPolicy") or {}).get("strategy")
        if strat == "ALL_UPSTREAM_TASKS_COMPLETED":
            bits.append(" runs after upstream completes (exit handler)")
        if t.get("parameterIterator") or t.get("artifactIterator"):
            g.loops += 1
            lim = (t.get("iteratorPolicy") or {}).get("parallelismLimit")
            bits.append(" ParallelFor (map)" + (f" parallelism={lim}" if lim else ""))
        if (t.get("cachingOptions") or {}).get("enableCache"):
            g.notes.add("caching")
        summ = "".join(bits)
        if "dag" in comp:
            if cref in stack:
                k = g.add(nid, "recurse", "loop", "none", f"recursive {cref}"); io[tname] = ([k], [k]); continue
            if not re.match(r"comp-(condition|for-loop|exit-handler|condition-branches)", cref or ""):
                g.subs += 1
                g.notes.add("nested pipeline inlined")
            ent, ex = kfp_dag(g, comp["dag"], comps, execs, nid + ".", stack | {cref})
            if re.match(r"comp-exit-handler", cref or ""):
                g.notes.add("dsl.ExitHandler")
            io[tname] = (ent, ex)
            if not ent:
                k = g.add(nid, "empty-group", "other", "none", f"empty group{summ}"); io[tname] = ([k], [k])
        else:
            k = kfp_exec_node(g, nid, comp, execs, t, summ)
            if strat == "ALL_UPSTREAM_TASKS_COMPLETED":
                g.nodes[k]["category"] = "error-handler"
            io[tname] = ([k], [k])
    roots, used = [], set()
    for tname, t in tasks.items():
        deps = [d for d in (t.get("dependentTasks") or []) if d in io]
        producers = set()
        for side in ("parameters", "artifacts"):
            for v in ((t.get("inputs") or {}).get(side) or {}).values():
                for key in ("taskOutputParameter", "taskOutputArtifact"):
                    p = (v.get(key) or {}).get("producerTask") if isinstance(v, dict) else None
                    if p:
                        producers.add(p)
        strat = (t.get("triggerPolicy") or {}).get("strategy")
        for dname in dict.fromkeys(deps + [p for p in producers if p in io]):
            kind = "error" if strat == "ALL_UPSTREAM_TASKS_COMPLETED" else ("data" if dname in producers else "control")
            if kind == "error":
                g.needs.add("error-branches")
            g.link(io[dname][1], io[tname][0], kind)
            used.add(dname)
        if not deps and not (producers & set(io)):
            roots += io[tname][0]
    exits = []
    for tname in tasks:
        if tname not in used:
            exits += io[tname][1]
    return roots, exits


def kfp_items():
    items, errors = [], []
    files = sorted(glob.glob(f"{KFP_DIR}/test_data/sdk_compiled_pipelines/**/*.yaml", recursive=True))
    for p in files:
        rel = os.path.relpath(p, KFP_DIR)
        try:
            docs = [d for d in yaml.safe_load_all(open(p, encoding="utf-8")) if isinstance(d, dict)]
            doc = next((d for d in docs if "root" in d and "components" in d or "pipelineSpec" in d), None)
            if doc is None:
                errors.append({"file": rel, "error": "not a PipelineSpec"}); continue
            if "pipelineSpec" in doc:
                doc = doc["pipelineSpec"]
            g = G()
            comps = doc.get("components") or {}
            execs = ((doc.get("deploymentSpec") or {}).get("executors")) or {}
            kfp_dag(g, (doc.get("root") or {}).get("dag") or {}, comps, execs, "", set())
            platform_spec = next((d for d in docs if "platforms" in d), None)
            if platform_spec:
                g.notes.add("kubernetes platform spec (pvc/secrets/node selectors)")
                g.connectors.append("kubernetes")
            nodes = list(g.nodes.values())
            edges = oc.dedupe_edges(g.edges)
            if not nodes:
                errors.append({"file": rel, "error": "empty"}); continue
            name = (doc.get("pipelineInfo") or {}).get("name") or os.path.basename(p)[:-5]
            desc = (doc.get("pipelineInfo") or {}).get("description") or ""
            py = p[:-5] + ".py"
            if not desc and os.path.exists(py):
                m = re.search(r'^\s*"""(.*?)"""', open(py, encoding="utf-8").read(), re.S)
                desc = m.group(1).strip() if m else ""
            if g.subs:
                g.needs.add("subworkflow-call(inlined at compile time)")
            text = " ".join([rel, name, desc, " ".join(g.connectors)])
            features = oc.compute_features(nodes, edges, guards=g.guards, loops=g.loops, async_kinds=g.async_kinds,
                                           connectors=g.connectors, domains=oc.domains_for(text, ["ml-pipelines"]))
            ir = oc.ir_verdict(features, needs=sorted(g.needs),
                               notes=f"KFP v2 IR (PipelineSpec) compiled golden file; condition/for-loop/exit-handler groups inlined; other: {', '.join(sorted(g.notes)) or 'none'}.")
            has_py = os.path.exists(py)
            oracle = {"kind": "output-equivalence" if has_py else "none",
                      "notes": ("Golden compiled IR paired with DSL source " + os.path.basename(py) +
                                "; KFP SDK tests recompile and compare. Directories critical/essential/failing are also run by backend e2e tests on a cluster.")
                      if has_py else "Compiled IR without paired source."}
            items.append(oc.make_item(
                platform="kubeflow", sid=rel.replace("test_data/sdk_compiled_pipelines/", "")[:-5],
                url=f"https://github.com/kubeflow/pipelines/blob/{KFP_SHA}/{rel}",
                revision=f"{KFP_SHA} (module {KFP_MAN['version']}); zip sha256:{KFP_MAN['sha256']}",
                retrieved=KFP_MAN["retrievedAt"], license="Apache-2.0",
                license_evidence="LICENSE at kubeflow/pipelines module root (proxy.golang.org zip)",
                redistributable=True, raw_path=p, title=f"{name} (KFP compiled pipeline)", description=desc,
                desc_provenance="original", nodes=nodes, edges=edges, features=features, ir=ir, oracle=oracle))
        except Exception as e:
            errors.append({"file": rel, "error": f"{type(e).__name__}: {e}"})
    return items, errors, len(files)


# -------------------------------------------------------------------------------- Tekton ----
TK_DIR = glob.glob("/opt/corpus/tekton/extracted/github.com/tektoncd/pipeline@*")[0]
TK_MAN = json.load(open(glob.glob("/opt/corpus/tekton/*.manifest.json")[0]))
TK_SHA = TK_MAN["info"]["Origin"]["Hash"]
TK_VER = TK_MAN["version"]


def tk_task_node(g, nid, t, summ):
    ref = t.get("taskRef") or {}
    if t.get("pipelineRef") or t.get("pipelineSpec"):
        g.subs += 1
        return g.add(nid, "pipeline-in-pipeline", "subworkflow", "external", f"child pipeline{summ}")
    if ref.get("apiVersion") or ref.get("kind") not in (None, "Task", "ClusterTask"):
        kind = ref.get("kind") or "CustomRun"
        if re.search(r"(?i)wait", str(ref)):
            g.async_kinds.append("wait")
            return g.add(nid, f"custom:{kind}", "wait", "none", f"custom task {kind}{summ}")
        g.connectors.append(f"custom-task:{kind}")
        return g.add(nid, f"custom:{kind}", "action", "external", f"custom task {kind} {ref.get('apiVersion', '')}{summ}")
    if ref.get("resolver"):
        g.connectors.append(f"resolver:{ref['resolver']}")
        params = {p.get("name"): p.get("value") for p in ref.get("params") or [] if isinstance(p, dict)}
        nm = params.get("name") or params.get("pathInRepo") or "?"
        return g.add(nid, f"resolver:{ref['resolver']}", "code", "external", f"task via {ref['resolver']} resolver: {nm}{summ}")
    ts = t.get("taskSpec") or {}
    steps = ts.get("steps") or []
    imgs = [str(s.get("image", "")) for s in steps if isinstance(s, dict)]
    script = " ".join(str(s.get("script", ""))[:300] for s in steps if isinstance(s, dict))
    eff = "external" if re.search(r"(?i)curl|wget|kubectl|git |gcloud|aws |docker|kaniko|buildah|push", " ".join(imgs) + script) else "none"
    if steps:
        return g.add(nid, "taskSpec", "code", eff, f"inline task, {len(steps)} step(s) images={','.join(sorted(set(i.split('@')[0] for i in imgs)))[:80]}{summ}")
    return g.add(nid, "taskRef", "code", "none", f"task {ref.get('name', '?')}{summ}")


def tk_pipeline(g, ps):
    tasks = ps.get("tasks") or []
    fin = ps.get("finally") or []
    io, names = {}, {}
    for t in tasks + fin:
        bits = []
        if t.get("when"):
            g.guards += 1
            bits.append(f" when x{len(t['when'])}")
        if t.get("matrix"):
            g.loops += 1
            bits.append(" matrix (fan-out)")
        if t.get("retries"):
            bits.append(f" retries={t['retries']}")
        if t.get("timeout"):
            bits.append(" timeout")
        if t.get("onError"):
            bits.append(f" onError={t['onError']}")
        nid = t.get("name", "task")
        k = tk_task_node(g, nid, t, "".join(bits))
        if t in fin:
            g.nodes[k]["category"] = "error-handler"
            g.nodes[k]["summary"] = "finally: " + g.nodes[k]["summary"]
        io[t.get("name")] = k
    used = set()
    for t in tasks:
        txt = json.dumps(t)
        deps = list(t.get("runAfter") or [])
        refs = set(re.findall(r"\$\(tasks\.([A-Za-z0-9_-]+)\.(?:results|status)", txt))
        for dname in dict.fromkeys(deps + sorted(refs)):
            if dname in io:
                g.link([io[dname]], [io[t.get("name")]], "data" if dname in refs else "control")
                used.add(dname)
    leaves = [io[t.get("name")] for t in tasks if t.get("name") not in used]
    for t in fin:
        g.link(leaves, [io[t.get("name")]], "error")
        g.needs.add("finally(error-branches)")
        txt = json.dumps(t)
        if re.search(r"\$\(tasks\.(status|[A-Za-z0-9_-]+\.status)", txt):
            g.notes.add("finally reads task status")


def tekton_items():
    items, errors = [], []
    files = sorted(glob.glob(f"{TK_DIR}/examples/**/*.yaml", recursive=True))
    for p in files:
        rel = os.path.relpath(p, TK_DIR)
        try:
            docs = [d for d in yaml.safe_load_all(open(p, encoding="utf-8")) if isinstance(d, dict)]
            pipelines = {d["metadata"]["name"]: d for d in docs if d.get("kind") == "Pipeline" and d.get("metadata", {}).get("name")}
            runs = [d for d in docs if d.get("kind") == "PipelineRun"]
            targets = []
            for r in runs:
                sp = (r.get("spec") or {})
                if sp.get("pipelineSpec"):
                    targets.append((r, sp["pipelineSpec"]))
                elif (sp.get("pipelineRef") or {}).get("name") in pipelines:
                    targets.append((r, pipelines[sp["pipelineRef"]["name"]].get("spec") or {}))
            if not runs:
                targets += [(d, d.get("spec") or {}) for d in pipelines.values()]
            if not targets:
                continue
            for i, (doc, ps) in enumerate(targets):
                g = G()
                tk_pipeline(g, ps)
                nodes = list(g.nodes.values())
                edges = oc.dedupe_edges(g.edges)
                if not nodes:
                    continue
                meta = doc.get("metadata") or {}
                name = meta.get("name") or meta.get("generateName", "").rstrip("-") or os.path.basename(p)[:-5]
                desc = ps.get("description") or ""
                if g.subs:
                    g.needs.add("subworkflow-call")
                text = " ".join([rel, name, desc, " ".join(g.connectors)])
                features = oc.compute_features(nodes, edges, guards=g.guards, loops=g.loops, async_kinds=g.async_kinds,
                                               connectors=g.connectors, domains=oc.domains_for(text, ["ci-cd"]))
                no_ci = "/no-ci/" in rel
                ir = oc.ir_verdict(features, needs=sorted(g.needs),
                                   notes=f"Tekton {rel.split('/')[1]} pipeline; runAfter/results refs as edges, finally tasks as error-handler; other: {', '.join(sorted(g.notes)) or 'none'}.")
                oracle = {"kind": "none" if no_ci else "test-profile",
                          "notes": "examples/ outside no-ci/ are applied by Tekton's examples e2e test (test/examples_test.go) and must succeed on a cluster." if not no_ci else "no-ci example: not run in CI."}
                items.append(oc.make_item(
                    platform="tekton", sid=rel.replace("examples/", "")[:-5] + (f"#{i}" if len(targets) > 1 else ""),
                    url=f"https://github.com/tektoncd/pipeline/blob/{TK_VER}/{rel}",
                    revision=f"{TK_VER} ({TK_SHA}); zip sha256:{TK_MAN['sha256']}", retrieved=TK_MAN["retrievedAt"],
                    license="Apache-2.0", license_evidence="LICENSE at tektoncd/pipeline module root (proxy.golang.org zip)",
                    redistributable=True, raw_path=p, title=f"{name} (Tekton {doc.get('kind')})", description=desc,
                    desc_provenance="original", nodes=nodes, edges=edges, features=features, ir=ir, oracle=oracle))
        except Exception as e:
            errors.append({"file": rel, "error": f"{type(e).__name__}: {e}"})
    return items, errors, len(files)


if __name__ == "__main__":
    which, out = sys.argv[1], sys.argv[2]
    items, errors, n = (kfp_items() if which == "kfp" else tekton_items())
    json.dump({"items": items, "errors": errors, "files": n}, open(out, "w"))
    print(f"{which}: files={n} items={len(items)} errors={len(errors)}")
