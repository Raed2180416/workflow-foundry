"""CWL (v1.0-v1.2) workflow -> step-level graph. Pure parsing with yaml.safe_load; nothing executed,
no remote $import/run references are fetched (they are recorded as unresolved sub-workflow references).

  * steps -> nodes; `run:` CommandLineTool -> action (package from baseCommand / Docker image),
    ExpressionTool -> code, Operation -> other, Workflow -> inlined (sub-workflow inputs bound to the
    step's `in` sources, `outputSource`s mapped back to the inner producer nodes)
  * `in` sources "step/out" -> data edges; `scatter` -> one runtime fan-out (map) per scattered step;
    `when` (v1.2) -> one decision point per step; `pickValue` -> merge semantics noted
  * `$graph` packed documents are indexed by id ("#main", "#tool.cwl")
"""
import os, re, yaml


class Loader:
    def __init__(self, root):
        self.root = os.path.realpath(root)
        self.cache = {}

    def load(self, path):
        path = os.path.realpath(path)
        if not path.startswith(self.root) or not os.path.isfile(path):
            return None
        if path not in self.cache:
            try:
                txt = open(path, encoding="utf-8", errors="replace").read()
                if txt.startswith("#!"):
                    txt = txt.split("\n", 1)[1] if "\n" in txt else ""
                doc = yaml.safe_load(txt)
            except Exception:
                doc = None
            self.cache[path] = doc
        return self.cache[path]


def graph_index(doc):
    idx = {}
    if isinstance(doc, dict) and isinstance(doc.get("$graph"), list):
        for d in doc["$graph"]:
            if isinstance(d, dict) and d.get("id"):
                idx[str(d["id"]).lstrip("#")] = d
    return idx


def as_list(x, key="id"):
    if x is None:
        return []
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        out = []
        for k, v in x.items():
            if isinstance(v, dict):
                v = dict(v)
                v.setdefault(key, k)
            else:
                v = {key: k, "source": v} if key == "id" else {key: k, "value": v}
            out.append(v)
        return out
    return []


def short(x):
    return str(x).split("#")[-1].split("/")[-1] if x is not None else ""


def src_split(s):
    s = str(s).lstrip("#")
    if "/" in s:
        parts = s.split("/")
        if len(parts) >= 2:
            return parts[-2], parts[-1]
    return None, s


class CwlGraph:
    def __init__(self):
        self.nodes, self.edges = {}, []
        self.guards, self.fanout, self.subworkflow_calls = set(), 0, 0
        self.packages, self.services = set(), set()
        self.unresolved = set()
        self.reqs = set()
        self.max_depth = 0
        self.expr_inputs = 0
        self.pick_value = 0
        self.inputs = 0

    def add(self, nid, typ, cat, eff, summary):
        k, n = nid, 2
        while k in self.nodes:
            k = f"{nid}#{n}"; n += 1
        self.nodes[k] = {"id": k, "type": typ, "category": cat, "effects": eff, "summary": summary}
        return k

    def edge(self, a, b, kind="data"):
        if a in self.nodes and b in self.nodes and a != b:
            self.edges.append({"from": a, "to": b, "kind": kind})


def reqs_of(d):
    out = set()
    for k in ("requirements", "hints"):
        r = d.get(k)
        if isinstance(r, dict):
            out |= set(r.keys())
        elif isinstance(r, list):
            out |= {x.get("class") for x in r if isinstance(x, dict) and x.get("class")}
    return out


def docker_image(d):
    for k in ("requirements", "hints"):
        r = d.get(k)
        items = [dict(v, **{"class": c}) for c, v in r.items() if isinstance(v, dict)] if isinstance(r, dict) else (r or [])
        for x in items:
            if isinstance(x, dict) and x.get("class") == "DockerRequirement":
                return str(x.get("dockerPull") or x.get("dockerImageId") or "")
    return ""


def tool_package(d, run_ref):
    bc = d.get("baseCommand")
    if isinstance(bc, list):
        bc = [str(x) for x in bc if x]
        first = bc[0] if bc else ""
    else:
        first = str(bc or "")
    img = docker_image(d)
    pkg = os.path.basename(first) if first else ""
    if pkg in ("", "bash", "sh", "python", "python3", "Rscript", "perl", "java", "node", "/bin/bash", "/bin/sh"):
        if img:
            pkg = re.sub(r"[:@].*$", "", img.split("/")[-1])
        elif run_ref:
            pkg = re.sub(r"\.cwl$", "", os.path.basename(str(run_ref)))
    return pkg.lower(), img, first


def resolve_run(run, base_dir, loader, gidx):
    if isinstance(run, dict):
        return run, base_dir, None
    if not isinstance(run, str):
        return None, base_dir, None
    if run.startswith("#"):
        return gidx.get(run.lstrip("#")), base_dir, run
    if re.match(r"^[a-z]+://", run):
        return None, base_dir, run
    p = os.path.join(base_dir, run.split("#")[0])
    doc = loader.load(p)
    if isinstance(doc, dict) and "$graph" in doc:
        gi = graph_index(doc)
        frag = run.split("#")[1] if "#" in run else "main"
        return gi.get(frag) or gi.get("main"), os.path.dirname(p), run
    return doc, os.path.dirname(p), run


def run_workflow(wf, base_dir, loader, classify, g=None, prefix="", bound=None, depth=0, gidx=None, stack=()):
    g = g or CwlGraph()
    g.max_depth = max(g.max_depth, depth)
    gidx = gidx if gidx is not None else {}
    g.reqs |= reqs_of(wf)
    inputs = {short(x.get("id")): x for x in as_list(wf.get("inputs")) if isinstance(x, dict)}
    if bound is None:
        g.inputs += len(inputs)
    env = {k: set((bound or {}).get(k, set())) for k in inputs}
    step_out = {}   # step name -> {out name: set(nodes)} or {"*": set}
    steps = as_list(wf.get("steps"))
    # process in dependency order (CWL steps are unordered): simple topological pass
    names = [short(s.get("id")) for s in steps if isinstance(s, dict)]
    deps = {}
    for s in steps:
        if not isinstance(s, dict):
            continue
        n = short(s.get("id"))
        ds = set()
        for i in as_list(s.get("in")):
            srcs = i.get("source") if isinstance(i, dict) else None
            for x in (srcs if isinstance(srcs, list) else [srcs]):
                if x is None:
                    continue
                st, _ = src_split(x)
                if st in names:
                    ds.add(st)
        deps[n] = ds
    order, seen = [], set()

    def visit(n, path=()):
        if n in seen or n in path:
            return
        for d in deps.get(n, ()):
            visit(d, path + (n,))
        seen.add(n)
        order.append(n)

    for n in names:
        visit(n)
    by_name = {short(s.get("id")): s for s in steps if isinstance(s, dict)}

    def sources_of(srcs):
        out = set()
        for x in (srcs if isinstance(srcs, list) else [srcs]):
            if x is None:
                continue
            st, o = src_split(x)
            if st and st in step_out:
                so = step_out[st]
                out |= so.get(o, so.get("*", set()))
            elif o in env:
                out |= env[o]
        return out

    for n in order:
        s = by_name[n]
        nid = f"{prefix}{n}"
        ins = as_list(s.get("in"))
        in_src = {}
        for i in ins:
            if not isinstance(i, dict):
                continue
            iname = short(i.get("id"))
            in_src[iname] = sources_of(i.get("source"))
            if "valueFrom" in i:
                g.expr_inputs += 1
            if "pickValue" in i:
                g.pick_value += 1
        doc, ddir, ref = resolve_run(s.get("run"), base_dir, loader, gidx)
        if isinstance(doc, dict) and isinstance(doc.get("$graph"), list) and not doc.get("class"):
            gi = graph_index(doc)
            doc = gi.get("main") or next(iter(gi.values()), None)
        scatter = s.get("scatter")
        if scatter:
            g.fanout += 1
        when = s.get("when")
        if when:
            g.guards.add(nid)
        cls = doc.get("class") if isinstance(doc, dict) else None
        suffix = (" [scatter]" if scatter else "") + (" [when]" if when else "")
        if cls == "Workflow" and depth < 8 and (ref or nid) not in stack:
            g.subworkflow_calls += 1
            res = run_workflow(doc, ddir, loader, classify, g, prefix=nid + "/", bound=in_src, depth=depth + 1,
                               gidx=gidx if not ref or ref.startswith("#") else graph_index(loader.load(os.path.join(base_dir, ref.split('#')[0])) or {}),
                               stack=stack + ((ref or nid),))
            if when:
                g.guards.add(nid)
            step_out[n] = res
            continue
        if doc is None:
            g.unresolved.add(str(s.get("run"))[:120])
            node = g.add(nid, "cwl.unresolved", "other", "write",
                         f"step {n} -> unresolved run {str(s.get('run'))[:80]}{suffix}")
        elif cls == "ExpressionTool":
            node = g.add(nid, "cwl.ExpressionTool", "code", "none", f"step {n}: JavaScript expression tool{suffix}")
        elif cls == "Operation":
            node = g.add(nid, "cwl.Operation", "other", "none", f"step {n}: abstract operation{suffix}")
        elif cls == "Workflow":
            node = g.add(nid, "cwl.Workflow", "subworkflow", "write", f"step {n}: nested workflow (not expanded){suffix}")
        else:
            pkg, img, first = tool_package(doc, ref)
            text = f"{n} {pkg} {img} {first} {ref or ''} {doc.get('label', '')}"
            r = reqs_of(doc)
            g.reqs |= r
            cat, eff, svcs = classify(text, pkg, curated=True)
            if "NetworkAccess" in r and eff == "write":
                eff = "read"
                svcs = svcs or ["http-download"]
            g.packages.add(pkg)
            g.services |= set(svcs)
            node = g.add(nid, f"cwl.CommandLineTool:{pkg}" if pkg else "cwl.CommandLineTool", cat, eff,
                         f"step {n}: {pkg or 'tool'}{(' (' + img.split('/')[-1][:60] + ')') if img else ''}{suffix}")
        for i, srcs in in_src.items():
            for x in srcs:
                g.edge(x, node, "control" if i == "when" else "data")
        if when:
            for v in re.findall(r"inputs\.(\w+)", str(when)):
                for x in in_src.get(v, set()):
                    g.edge(x, node, "control")
        step_out[n] = {"*": {node}}
    outs = {}
    all_ = set()
    for o in as_list(wf.get("outputs")):
        if not isinstance(o, dict):
            continue
        srcs = sources_of(o.get("outputSource"))
        outs[short(o.get("id"))] = srcs
        all_ |= srcs
    if not all_:
        has_out = {e["from"] for e in g.edges}
        all_ = {k for k in g.nodes if k.startswith(prefix) and k not in has_out}
    outs["*"] = all_
    return outs if depth else {"outputs": outs, "graph": g}


def analyze_file(path, root, classify):
    loader = Loader(root)
    doc = loader.load(path)
    gidx = graph_index(doc) if isinstance(doc, dict) else {}
    if isinstance(doc, dict) and "$graph" in doc:
        doc = gidx.get("main") or next((d for d in gidx.values() if d.get("class") == "Workflow"), None)
    if not isinstance(doc, dict) or doc.get("class") != "Workflow":
        return None
    res = run_workflow(doc, os.path.dirname(path), loader, classify, gidx=gidx)
    g = res["graph"]
    g.doc = doc
    return g


def is_workflow_file(path):
    try:
        head = open(path, encoding="utf-8", errors="replace").read(200000)
    except OSError:
        return False
    return bool(re.search(r"(?m)^\s*\"?class\"?\s*:\s*\"?Workflow\b", head))


def referenced_runs(path):
    """Relative .cwl paths referenced by `run:` in a file (used to find top-level workflows)."""
    try:
        t = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return set()
    out = set()
    for m in re.finditer(r"(?m)^\s*\"?run\"?\s*:\s*\"?([^\s\"#]+\.cwl)", t):
        out.add(os.path.realpath(os.path.join(os.path.dirname(path), m.group(1))))
    return out
