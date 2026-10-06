"""Galaxy workflow (.ga native JSON, and gxformat2 YAML converted to the same shape) -> graph.

Pure function over parsed JSON/YAML. Embedded sub-workflows are inlined: the sub-workflow's input
steps are bound to the parent step's input_connections (by input label, else by order), and parent
consumers of `output_name` are wired to the inner step whose workflow_outputs carries that label
(else to every inner sink). Steps:
  data_input / data_collection_input / parameter_input -> no node (workflow interface; counted in
  notes; each top-level collection input counts as one runtime fan-out because Galaxy maps tools
  over collection elements implicitly)
  tool -> action (curated Galaxy tool) / transform (collection ops, text utilities) /
          model (ML inference tools) / error-handler (__FILTER_FAILED_DATASETS__, __KEEP_SUCCESS_DATASETS__) /
          condition (__FILTER_EMPTY_DATASETS__, __FILTER_FROM_FILE__) / merge (pick_value, __MERGE_COLLECTION__) /
          human (interactive tools)
  pause -> human (and async wait)
  `when` on a step -> guard; one decision point per distinct controlling parameter
  post_job_actions EmailAction -> extra notification node (external)
"""
import re

COLLECTION_OPS = {"__APPLY_RULES__", "__BUILD_LIST__", "__ZIP_COLLECTION__", "__UNZIP_COLLECTION__", "__FLATTEN__",
                  "__RELABEL_FROM_FILE__", "__SORTLIST__", "__EXTRACT_DATASET__", "__TAG_FROM_FILE__",
                  "__HARMONIZELISTS__", "__DUPLICATE_FILE_TO_COLLECTION__", "__SPLIT_PAIRED_AND_UNPAIRED__",
                  "__CROSS_PRODUCT_FLAT__", "__CROSS_PRODUCT_NESTED__", "__NEST__", "__IDENTIFIERS_FROM_FILE__"}
FANOUT_TOOLS = re.compile(r"(?i)__APPLY_RULES__|__SPLIT_|split_file_to_collection|__DUPLICATE_FILE_TO_COLLECTION__|"
                          r"__CROSS_PRODUCT|seqkit_split|fasta_splitter|split_fastq|bam_split|splitter")
ERROR_TOOLS = {"__FILTER_FAILED_DATASETS__", "__KEEP_SUCCESS_DATASETS__"}
COND_TOOLS = {"__FILTER_EMPTY_DATASETS__", "__FILTER_FROM_FILE__", "Filter1", "Grep1"}
MERGE_TOOLS = {"pick_value", "__MERGE_COLLECTION__", "cat1", "tp_cat", "__ZIP_COLLECTION__"}


def tool_package(tool_id):
    t = tool_id or ""
    m = re.match(r"^[^/]+/repos/([^/]+)/([^/]+)/([^/]+)/", t)
    if m:
        return m.group(2), m.group(3), m.group(1)   # repo, tool, owner
    return t, t, ""


class GxGraph:
    def __init__(self):
        self.nodes, self.edges = {}, []
        self.guards = set()
        self.fanout = 0
        self.subworkflow_calls = 0
        self.packages, self.services = set(), set()
        self.async_kinds = set()
        self.pja = {}
        self.notes = set()
        self.max_depth = 0
        self.inputs = {}

    def add(self, nid, typ, cat, eff, summary):
        k, n = nid, 2
        while k in self.nodes:
            k = f"{nid}#{n}"; n += 1
        self.nodes[k] = {"id": k, "type": typ, "category": cat, "effects": eff, "summary": summary}
        return k

    def edge(self, a, b, kind="data"):
        if a in self.nodes and b in self.nodes and a != b:
            self.edges.append({"from": a, "to": b, "kind": kind})


def _conns(step):
    out = []
    for name, v in (step.get("input_connections") or {}).items():
        for c in (v if isinstance(v, list) else [v]):
            if isinstance(c, dict) and "id" in c:
                out.append((name, str(c["id"]), c.get("output_name")))
    return out


def run(ga, classify, g=None, prefix="", bound=None, depth=0):
    """Add the workflow `ga` into graph g. bound: {input-label-or-step-id: set(parent node ids)}.
    Returns {"outputs": {label: set(node ids)}, "sinks": set}."""
    g = g or GxGraph()
    g.max_depth = max(g.max_depth, depth)
    steps = ga.get("steps") or {}
    produced = {}      # step id -> set(node ids)   (what consumers of that step connect to)
    out_labels = {}    # workflow output label -> set(node ids)
    order = sorted(steps.items(), key=lambda kv: int(kv[0]) if str(kv[0]).isdigit() else 0)
    sub_out = {}       # step id -> {"outputs":..., "sinks":...}
    input_ids = {}     # input step id -> guard key
    for sid, st in order:
        sid = str(sid)
        typ = st.get("type")
        label = st.get("label") or st.get("name") or ""
        nid_base = f"{prefix}s{sid}"
        if typ in ("data_input", "data_collection_input", "parameter_input"):
            # workflow inputs are interface, not processing steps: no node; consumers are wired to
            # whatever the parent bound to this input (inlined sub-workflow) or to nothing (top level)
            if bound is not None:
                b = bound.get(label)
                if b is None:
                    b = bound.get(sid)
                produced[sid] = set(b or set())
            else:
                produced[sid] = set()
                g.inputs[typ] = g.inputs.get(typ, 0) + 1
                if typ == "data_collection_input":
                    g.fanout += 1
            input_ids[sid] = f"{prefix}input:{label}"
            continue
        if typ == "subworkflow":
            sub = st.get("subworkflow")
            g.subworkflow_calls += 1
            if not isinstance(sub, dict):
                nid = g.add(nid_base, "galaxy.subworkflow-ref", "subworkflow", "write", f"sub-workflow by reference: {label}")
                g.notes.add("subworkflow-by-reference")
                for name, src, on in _conns(st):
                    for x in produced.get(src, set()):
                        g.edge(x, nid)
                produced[sid] = {nid}
                continue
            b = {}
            sub_inputs = [s for _, s in sorted((sub.get("steps") or {}).items(), key=lambda kv: int(kv[0]) if str(kv[0]).isdigit() else 0)
                          if s.get("type") in ("data_input", "data_collection_input", "parameter_input")]
            conns = _conns(st)
            for name, src, on in conns:
                srcs = set(produced.get(src, set()))
                if src in sub_out and on:
                    srcs = sub_out[src]["outputs"].get(on, sub_out[src]["sinks"])
                b.setdefault(name, set()).update(srcs)
            # also bind by order for unlabeled inputs (legacy numeric keys)
            for i, s in enumerate(sub_inputs):
                lab = s.get("label") or s.get("name") or ""
                if lab not in b and str(s.get("id")) in b:
                    b[lab] = b[str(s.get("id"))]
            res = run(sub, classify, g, prefix=f"{nid_base}/", bound=b, depth=depth + 1)
            sub_out[sid] = res
            produced[sid] = res["sinks"] or set()
            for o in st.get("workflow_outputs") or []:
                if o.get("label"):
                    out_labels[o["label"]] = res["outputs"].get(o.get("output_name"), res["sinks"])
            continue
        if typ == "pause":
            nid = g.add(nid_base, "galaxy.pause", "human", "none", f"pause for manual review/resume: {label}")
            g.async_kinds.add("wait")
        else:
            tool_id = st.get("tool_id") or st.get("content_id") or ""
            repo, tname, owner = tool_package(tool_id)
            base = tname
            text = f"{tool_id} {st.get('name', '')}"
            cat, eff, svcs = classify(text, repo, curated=True)
            if base in ERROR_TOOLS:
                cat, eff = "error-handler", "write"
            elif base in COND_TOOLS:
                cat = "condition"
            elif base in MERGE_TOOLS:
                cat = "merge"
            elif base in COLLECTION_OPS or base in ("param_value_from_file", "map_param_value", "compose_text_param"):
                cat = "transform"
            if base.startswith("interactive_tool") or "interactive_tool" in tool_id:
                cat, eff = "human", "write"
            if FANOUT_TOOLS.search(tool_id):
                g.fanout += 1
            g.packages.add(repo.lower())
            g.services |= set(svcs)
            ver = st.get("tool_version") or ""
            nid = g.add(nid_base, f"galaxy.tool:{repo}/{tname}" if owner else f"galaxy.tool:{tname}", cat, eff,
                        f"{st.get('name') or tname} {ver} ({owner + '/' if owner else ''}{repo}){' — ' + label if label and label != st.get('name') else ''}")
        for name, src, on in _conns(st):
            srcs = produced.get(src, set())
            if src in sub_out and on:
                srcs = sub_out[src]["outputs"].get(on, sub_out[src]["sinks"])
            kind = "control" if name == "when" else "data"
            for x in srcs:
                g.edge(x, nid, kind)
            if name == "when":
                g.guards.update(srcs or {input_ids.get(src, f"{nid}:when")})
        if st.get("when") and not any(n == "when" for n, _, _ in _conns(st)):
            g.guards.add(f"{nid}:when")
        for a in (st.get("post_job_actions") or {}).values():
            at = a.get("action_type") or "?"
            g.pja[at] = g.pja.get(at, 0) + 1
            if at == "EmailAction":
                e = g.add(f"{nid}/email", "galaxy.pja:EmailAction", "action", "external", "post-job action: e-mail the user when this step finishes")
                g.services.add("email")
                g.edge(nid, e, "control")
        produced[sid] = {nid}
        for o in st.get("workflow_outputs") or []:
            if o.get("label"):
                out_labels[o["label"]] = {nid}
    mine = {k for k in g.nodes if k.startswith(prefix)} if prefix else set(g.nodes)
    has_out = {e["from"] for e in g.edges}
    sinks = {k for k in mine if k not in has_out}
    return {"outputs": out_labels, "sinks": sinks, "graph": g}


# ---------------------------------------------------------------- gxformat2 -> native-ish
def from_gxformat2(doc):
    """Convert a gxformat2 GalaxyWorkflow dict into the native step dict shape used by run()."""
    steps, label_to_id = {}, {}
    i = 0
    inputs = doc.get("inputs") or {}
    if isinstance(inputs, list):
        inputs = {(x.get("id") or x.get("label") or f"in{k}"): x for k, x in enumerate(inputs)}
    for lab, spec in inputs.items():
        spec = spec if isinstance(spec, dict) else {"type": spec}
        t = str(spec.get("type", "data"))
        typ = "data_collection_input" if "collection" in t else ("data_input" if t in ("data", "File", "data_input") else "parameter_input")
        steps[str(i)] = {"id": i, "type": typ, "label": lab, "input_connections": {}, "tool_state": {"parameter_type": t}}
        label_to_id[lab] = i
        i += 1
    raw = doc.get("steps") or {}
    if isinstance(raw, list):
        raw = {(s.get("label") or s.get("id") or f"step{k}"): s for k, s in enumerate(raw)}
    for lab, s in raw.items():
        label_to_id[lab] = i
        st = {"id": i, "label": lab, "input_connections": {}}
        if isinstance(s.get("run"), dict) and s["run"].get("class") == "GalaxyWorkflow":
            st["type"] = "subworkflow"
            st["subworkflow"] = from_gxformat2(s["run"])
        elif s.get("type") == "pause":
            st["type"] = "pause"
        else:
            st["type"] = "tool"
            st["tool_id"] = s.get("tool_id") or ""
            st["tool_version"] = s.get("tool_version") or ""
            st["name"] = s.get("tool_id") or lab
        st["_in"] = s.get("in") or {}
        st["when"] = s.get("when")
        steps[str(i)] = st
        i += 1
    for st in steps.values():
        ins = st.pop("_in", {}) or {}
        if isinstance(ins, list):
            ins = {x.get("id"): x.get("source") for x in ins if isinstance(x, dict)}
        for name, src in ins.items():
            if isinstance(src, dict):
                src = src.get("source")
            for one in (src if isinstance(src, list) else [src]):
                if not one:
                    continue
                parts = str(one).split("/")
                sid = label_to_id.get(parts[0])
                if sid is None:
                    continue
                st["input_connections"].setdefault(name, []).append({"id": sid, "output_name": "/".join(parts[1:]) or "output"})
    return {"name": doc.get("label") or doc.get("name") or "", "annotation": doc.get("doc") or "", "steps": steps,
            "license": doc.get("license"), "tags": doc.get("tags") or []}
