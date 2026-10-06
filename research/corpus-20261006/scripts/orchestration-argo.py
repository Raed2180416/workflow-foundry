#!/usr/bin/env python3
"""Argo Workflows examples -> foundry-corpus-item/1 (YAML parsed as data; nothing is submitted).

Input : /opt/corpus/argo/extracted/github.com/argoproj/argo-workflows/v3@<ver>/examples/**/*.yaml
        (module zip from proxy.golang.org, see orchestration-fetch-goproxy.sh)
Output: candidates JSON (argv[1]).
Needs PyYAML (pinned in orchestration-requirements.txt). Run with the venv python and -I.

Graph model: templates are inlined from the entrypoint (steps groups become parallel fan-out /
fan-in; dag tasks follow dependencies/depends); leaf templates (container, script, resource,
suspend, http, plugin, containerSet, data) become nodes; templateRef calls become subworkflow
nodes; self/mutual recursion becomes a loop node with a back-edge of kind "loop"; workflow
onExit and lifecycle hooks become error-handler nodes reached by "error" edges.
"""
import glob, importlib.util, json, os, re, sys
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("oc", os.path.join(HERE, "orchestration-common.py"))
oc = importlib.util.module_from_spec(spec); spec.loader.exec_module(oc)

VER = "v3.7.18"
ROOT = f"/opt/corpus/argo/extracted/github.com/argoproj/argo-workflows/v3@{VER}"
MAN = json.load(open(glob.glob("/opt/corpus/argo/*.manifest.json")[0]))
SHA = MAN["info"]["Origin"]["Hash"]
EXTERNAL_IMG = re.compile(r"(?i)curl|wget|kubectl|aws|gcloud|gsutil|azure|\baz\b|docker|git\b|helm|mc\b|minio|http")
MODEL_IMG = re.compile(r"(?i)tensorflow|pytorch|torch|sklearn|huggingface|transformers|openai|llm|model")


class Ctx:
    def __init__(self, templates):
        self.t = {t["name"]: t for t in templates if isinstance(t, dict) and "name" in t}
        self.nodes, self.edges = {}, []
        self.guards = self.loops = self.subs = 0
        self.async_kinds, self.connectors = [], []
        self.needs = set()
        self.retries = 0
        self.notes = set()

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


def artifacts_connectors(tpl):
    out = []
    for side in ("inputs", "outputs"):
        for a in (tpl.get(side) or {}).get("artifacts") or []:
            for k in ("s3", "gcs", "git", "http", "hdfs", "oss", "azure", "artifactory", "huggingFace"):
                if isinstance(a, dict) and k in a:
                    out.append(f"artifact:{k}")
    return out


def leaf(ctx, tpl, nid, call_summary):
    name = tpl.get("name", "?")
    retry = tpl.get("retryStrategy")
    if retry:
        ctx.retries += 1
    rs = f" retry={retry.get('limit', '?')}" if isinstance(retry, dict) else ""
    ctx.connectors += artifacts_connectors(tpl)
    if tpl.get("memoize"):
        ctx.notes.add("memoize")
    if tpl.get("synchronization"):
        ctx.notes.add("synchronization(mutex/semaphore)")
    if "suspend" in tpl:
        dur = (tpl.get("suspend") or {}).get("duration")
        if dur:
            ctx.async_kinds.append("wait")
            return ctx.add(nid, "suspend(duration)", "wait", "none", f"suspend {dur}{call_summary}")
        ctx.async_kinds.append("wait")
        return ctx.add(nid, "suspend", "human", "none", f"manual resume / approval gate (template {name}){call_summary}")
    if "resource" in tpl:
        r = tpl["resource"] or {}
        act = r.get("action", "create")
        ctx.connectors.append("kubernetes")
        kind = ""
        m = re.search(r"kind:\s*(\w+)", str(r.get("manifest", "")))
        if m:
            kind = m.group(1)
        if r.get("successCondition") or r.get("failureCondition"):
            ctx.async_kinds.append("poll")
        eff = "read" if act == "get" else "write"
        return ctx.add(nid, f"resource:{act}", "action", eff, f"k8s {act} {kind} (template {name}){rs}{call_summary}")
    if "http" in tpl:
        h = tpl["http"] or {}
        ctx.connectors.append("http")
        meth = h.get("method", "GET")
        return ctx.add(nid, "http", "action", "read" if meth == "GET" else "external",
                       f"HTTP {meth} (template {name}){rs}{call_summary}")
    if "plugin" in tpl:
        p = list((tpl["plugin"] or {}).keys())
        ctx.connectors += [f"plugin:{x}" for x in p]
        return ctx.add(nid, f"plugin:{','.join(p)}", "action", "external", f"executor plugin {p}{call_summary}")
    if "data" in tpl:
        return ctx.add(nid, "data", "transform", "read", f"data template (source+transformations) {name}{call_summary}")
    if "containerSet" in tpl:
        cs = tpl["containerSet"] or {}
        n = len(cs.get("containers") or [])
        return ctx.add(nid, "containerSet", "code", "none", f"container set of {n} containers (template {name}){rs}{call_summary}")
    if "script" in tpl or "container" in tpl:
        c = tpl.get("script") or tpl.get("container") or {}
        img = str(c.get("image", ""))
        cmd = " ".join(str(x) for x in (c.get("command") or []) + (c.get("args") or []))[:300] + str(c.get("source", ""))[:300]
        eff = "external" if EXTERNAL_IMG.search(img + " " + cmd) else "none"
        cat = "model" if MODEL_IMG.search(img) else "code"
        typ = "script" if "script" in tpl else "container"
        for side in tpl.get("sidecars") or []:
            ctx.notes.add("sidecars")
        return ctx.add(nid, typ, cat, eff, f"{typ} image={img.split('@')[0]} (template {name}){rs}{call_summary}")
    return ctx.add(nid, "unknown-template", "other", "none", f"template {name}{call_summary}")


def call_mods(ctx, call):
    bits = []
    if call.get("when"):
        ctx.guards += 1
        bits.append(f" when={oc.trim(call['when'], 60)}")
    for k in ("withItems", "withParam", "withSequence"):
        if k in call:
            ctx.loops += 1
            bits.append(f" {k} (map)")
    if call.get("continueOn"):
        bits.append(f" continueOn={call['continueOn']}")
    if call.get("onExit"):
        bits.append(f" onExit={call['onExit']}")
    if call.get("hooks"):
        bits.append(" lifecycle hooks")
    return "".join(bits)


def invoke(ctx, call, prefix, stack):
    """Inline one step/task invocation. Returns (entries, exits)."""
    nm = call.get("name", "step")
    nid = f"{prefix}{nm}"
    summ = call_mods(ctx, call)
    if "templateRef" in call:
        tr = call["templateRef"] or {}
        ctx.subs += 1
        k = ctx.add(nid, "templateRef", "subworkflow", "external",
                    f"call {'Cluster' if tr.get('clusterScope') else ''}WorkflowTemplate {tr.get('name')}/{tr.get('template')}{summ}")
        return [k], [k]
    if "inline" in call:
        tpl = dict(call["inline"]); tpl.setdefault("name", nm)
        ent, ex = expand(ctx, tpl, nid + ".", stack, summ, nid)
    else:
        tname = call.get("template")
        if tname in stack:
            ctx.loops += 1
            k = ctx.add(nid, f"recurse:{tname}", "loop", "none", f"recursive call of template {tname}{summ}")
            ctx.edges.append({"from": k, "to": stack[tname][0] if stack[tname] else k, "kind": "loop"})
            return [k], [k]
        tpl = ctx.t.get(tname)
        if tpl is None:
            k = ctx.add(nid, "missing-template", "other", "none", f"unresolved template {tname}")
            return [k], [k]
        ent, ex = expand(ctx, tpl, nid + ".", stack, summ, nid)
    # per-call exit/lifecycle hooks
    hooks = []
    if call.get("onExit"):
        hooks.append(call["onExit"])
    for h in (call.get("hooks") or {}).values():
        if isinstance(h, dict) and h.get("template"):
            hooks.append(h["template"])
    for hname in hooks:
        tpl = ctx.t.get(hname)
        if tpl is not None and hname not in stack:
            he, hx = expand(ctx, tpl, nid + ".onExit.", stack, " (exit/lifecycle hook)", nid + ".onExit")
            for x in he:
                if ctx.nodes[x]["category"] in ("code", "action", "other"):
                    ctx.nodes[x]["category"] = "error-handler"
            ctx.link(ex, he, "error")
            ctx.needs.add("error-branches")
    return ent, ex


def expand(ctx, tpl, prefix, stack, call_summary, leaf_id):
    name = tpl.get("name")
    stack = dict(stack)
    frame = []
    stack[name] = frame
    if "steps" in tpl:
        prev, first = [], None
        for gi, group in enumerate(tpl.get("steps") or []):
            if isinstance(group, dict):
                group = [group]
            ents, exs = [], []
            for call in group or []:
                e, x = invoke(ctx, call, prefix, stack)
                ents += e; exs += x
                if call.get("continueOn"):
                    ctx.notes.add("continueOn")
            if first is None:
                first = ents
                frame += ents
            kind = "control"
            ctx.link(prev, ents, kind)
            prev = exs if exs else prev
        if tpl.get("retryStrategy"):
            ctx.retries += 1
        return first or [], prev
    if "dag" in tpl:
        tasks = (tpl.get("dag") or {}).get("tasks") or []
        io = {}
        for t in tasks:
            io[t.get("name")] = invoke(ctx, t, prefix, stack)
        roots, used = [], set()
        for t in tasks:
            deps = list(t.get("dependencies") or [])
            dep_expr = t.get("depends")
            if dep_expr:
                deps += re.findall(r"([A-Za-z0-9_-]+)(?:\.(?:Succeeded|Failed|Errored|Skipped|Omitted|Daemoned|AnySucceeded|AllFailed))?", dep_expr)
                if re.search(r"\.(Failed|Errored|AllFailed)", dep_expr):
                    ctx.needs.add("error-branches")
                if re.search(r"\|\||\.(Failed|Errored|Skipped|Omitted|AnySucceeded|AllFailed)", dep_expr):
                    ctx.guards += 1
            deps = [x for x in deps if x in io]
            args_txt = json.dumps(t.get("arguments") or {}) + json.dumps(t.get("withParam") or "")
            for dname in dict.fromkeys(deps):
                kind = "data" if re.search(r"tasks\.%s\.outputs" % re.escape(dname), args_txt) else "control"
                if dep_expr and re.search(r"%s\.(Failed|Errored|AllFailed)" % re.escape(dname), dep_expr):
                    kind = "error"
                ctx.link(io[dname][1], io[t.get("name")][0], kind)
                used.add(dname)
            if not deps:
                roots += io[t.get("name")][0]
        frame += roots
        target = (tpl.get("dag") or {}).get("target")
        if target:
            ctx.notes.add("dag target")
        exits = []
        for t in tasks:
            if t.get("name") not in used:
                exits += io[t.get("name")][1]
        return roots, exits
    k = leaf(ctx, tpl, leaf_id, call_summary)
    frame.append(k)
    return [k], [k]


def wf_spec(doc):
    kind = doc.get("kind")
    spec = doc.get("spec") or {}
    if kind == "CronWorkflow":
        return spec.get("workflowSpec") or {}, spec
    return spec, None


def convert(path, doc, idx, ndocs):
    kind = doc.get("kind")
    meta = doc.get("metadata") or {}
    spec, cron = wf_spec(doc)
    templates = spec.get("templates") or []
    ctx = Ctx(templates)
    entry = spec.get("entrypoint")
    if spec.get("workflowTemplateRef"):
        ref = spec["workflowTemplateRef"]
        k = ctx.add("workflowTemplateRef", "workflowTemplateRef", "subworkflow", "external",
                    f"run WorkflowTemplate {ref.get('name')}")
        ctx.subs += 1
        ents, exits = [k], [k]
    elif entry and entry in ctx.t:
        ents, exits = expand(ctx, ctx.t[entry], "", {}, "", entry)
    elif kind in ("WorkflowTemplate", "ClusterWorkflowTemplate") and templates:
        # library of templates without entrypoint: inline each top-level template
        ents, exits = [], []
        for t in templates:
            e, x = expand(ctx, t, t["name"] + ".", {}, "", t["name"])
            ents += e; exits += x
        ctx.notes.add("template library (no entrypoint): templates inlined side by side")
    else:
        return None
    on_exit = spec.get("onExit")
    if on_exit and on_exit in ctx.t:
        he, hx = expand(ctx, ctx.t[on_exit], "onExit.", {}, " (workflow exit handler)", "onExit")
        for nid in list(ctx.nodes):
            if nid.startswith("onExit") and ctx.nodes[nid]["category"] in ("code", "action", "other"):
                ctx.nodes[nid]["category"] = "error-handler"
        ctx.link(exits, he, "error")
        ctx.needs.add("error-branches")
    for h in (spec.get("hooks") or {}).values():
        if isinstance(h, dict) and h.get("template") in ctx.t:
            he, hx = expand(ctx, ctx.t[h["template"]], "hook.", {}, " (workflow lifecycle hook)", "hook")
            ctx.link(exits, he, "error")
            ctx.needs.add("error-branches")
    nodes = list(ctx.nodes.values())
    edges = oc.dedupe_edges(ctx.edges)
    if cron is not None:
        sched = cron.get("schedule") or ",".join(cron.get("schedules") or [])
        roots = [n["id"] for n in nodes if not any(e["to"] == n["id"] for e in edges)]
        nodes.insert(0, {"id": "__trigger__", "type": "cron", "category": "trigger", "effects": "none",
                         "summary": f"CronWorkflow schedule {sched} concurrencyPolicy={cron.get('concurrencyPolicy', 'Allow')}"})
        edges = [{"from": "__trigger__", "to": r, "kind": "control"} for r in roots] + edges
        ctx.async_kinds.append("schedule"); ctx.needs.add("triggers")
    if any(n["category"] == "human" for n in nodes) or any(n["type"] == "suspend" for n in nodes):
        pass
    if ctx.subs:
        ctx.needs.add("subworkflow-call")
    if spec.get("podGC") or spec.get("ttlStrategy"):
        ctx.notes.add("podGC/ttlStrategy")
    if spec.get("parallelism"):
        ctx.notes.add(f"parallelism={spec['parallelism']}")
    if spec.get("activeDeadlineSeconds"):
        ctx.notes.add("activeDeadlineSeconds")
    rel = os.path.relpath(path, ROOT)
    labels = meta.get("labels") or {}
    tested = "workflows.argoproj.io/test" in labels
    name = meta.get("name") or meta.get("generateName", "").rstrip("-") or os.path.basename(path)[:-5]
    ann = meta.get("annotations") or {}
    desc = ann.get("workflows.argoproj.io/description") or ""
    if not desc:
        # leading YAML comment block is the example's documentation
        lines = []
        for ln in open(path, encoding="utf-8").read().splitlines():
            if ln.startswith("#"):
                lines.append(ln.lstrip("# "))
            elif ln.strip() == "" and not lines:
                continue
            else:
                break
        desc = " ".join(lines)
    text = " ".join([rel, name, desc, " ".join(n["summary"] for n in nodes)])
    features = oc.compute_features(nodes, edges, guards=ctx.guards, loops=ctx.loops,
                                   async_kinds=ctx.async_kinds, connectors=ctx.connectors,
                                   domains=oc.domains_for(text, ["k8s-orchestration"]))
    notes = (f"Templates inlined from entrypoint ({len(templates)} templates); retryStrategy sites: {ctx.retries}; "
             f"other: {', '.join(sorted(ctx.notes)) or 'none'}. Map = withItems/withParam/withSequence; "
             "suspend without duration = human resume.")
    ir = oc.ir_verdict(features, needs=sorted(ctx.needs), notes=notes)
    oracle = ({"kind": "test-profile", "notes": "Labelled workflows.argoproj.io/test: submitted by test/e2e/examples_test.go (build tag 'examples') and must reach Succeeded on a cluster."}
              if tested else {"kind": "none", "notes": "Example manifest; argo lint validates schema only."})
    sid = rel.replace("examples/", "", 1)[:-5] + (f"#{idx}" if ndocs > 1 else "")
    return oc.make_item(
        platform="argo", sid=sid,
        url=f"https://github.com/argoproj/argo-workflows/blob/{VER}/{rel}",
        revision=f"{VER} ({SHA}); module zip sha256:{MAN['sha256']}", retrieved=MAN["retrievedAt"],
        license="Apache-2.0", license_evidence=f"LICENSE at module root (argo-workflows {VER}); proxy.golang.org module zip",
        redistributable=True, raw_path=path, title=f"{name} ({kind})", description=desc,
        desc_provenance="original", nodes=nodes, edges=edges, features=features, ir=ir, oracle=oracle)


def main():
    out = sys.argv[1]
    items, errors = [], []
    files = sorted(glob.glob(f"{ROOT}/examples/**/*.yaml", recursive=True))
    for p in files:
        try:
            docs = [d for d in yaml.safe_load_all(open(p, encoding="utf-8")) if isinstance(d, dict)]
            wdocs = [d for d in docs if d.get("kind") in ("Workflow", "WorkflowTemplate", "ClusterWorkflowTemplate", "CronWorkflow")]
            for i, d in enumerate(wdocs):
                it = convert(p, d, i, len(wdocs))
                if it is None:
                    errors.append({"file": p, "error": "no entrypoint/templates"})
                elif it["features"]["nodeCount"] == 0:
                    errors.append({"file": p, "error": "empty graph"})
                else:
                    items.append(it)
            if not wdocs:
                errors.append({"file": p, "error": "no workflow kind: " + ",".join(str(d.get('kind')) for d in docs)})
        except Exception as e:
            errors.append({"file": p, "error": f"{type(e).__name__}: {e}"})
    json.dump({"items": items, "errors": errors, "files": len(files)}, open(out, "w"))
    print(f"argo: files={len(files)} items={len(items)} errors={len(errors)}")


if __name__ == "__main__":
    main()
