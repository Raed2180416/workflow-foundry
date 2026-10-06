#!/usr/bin/env python3
"""Code-defined orchestrations -> foundry-corpus-item/1 by static analysis (never imported/run).

  dagster  : /opt/corpus/dagster/dagster-io__dagster@<oid>/examples/<project>/**.py
             one item per example project (asset graph + op jobs + schedules/sensors)
  prefect  : /opt/corpus/prefect/PrefectHQ__prefect@<oid>/examples/*.py, docs/v3/**.mdx (python
             code blocks), /opt/corpus/prefect/PrefectHQ__prefect-recipes@<oid>/**.py; one item per
             file (or mdx page) holding a @flow
  temporal : /opt/corpus/temporal/temporalio__samples-python@<oid>/<sample>/**.py (Python AST) and
             samples-go module zip extract (Go source, brace-aware regex scan); one item per sample
Usage: python3 -I orchestration-pycode.py dagster|prefect|temporal <out.json>
"""
import ast, glob, importlib.util, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("oc", os.path.join(HERE, "orchestration-common.py"))
oc = importlib.util.module_from_spec(spec); spec.loader.exec_module(oc)

MODEL_RX = re.compile(r"(?i)\b(openai|anthropic|ChatOpenAI|chat\.completions|messages\.create|bedrock|cortex|"
                      r"llm|langchain|dspy|marvin|controlflow|gemini|vertexai|huggingface|transformers|ollama|litellm)\b")
EXT_RX = re.compile(r"(?i)\b(requests\.|httpx\.|urllib|boto3|s3\.|aiohttp|smtplib|slack|sendgrid|twilio|"
                    r"snowflake|bigquery|psycopg|sqlalchemy|duckdb|databricks|kubernetes|subprocess|stripe|github)\b")


class G:
    def __init__(self):
        self.nodes, self.edges = {}, []
        self.guards = self.loops = self.subs = 0
        self.async_kinds, self.connectors, self.needs, self.notes = [], [], set(), set()

    def add(self, nid, ntype, cat, eff, summary):
        nid = str(nid)
        k, i = nid, 1
        while k in self.nodes:
            k = f"{nid}__{i}"; i += 1
        self.nodes[k] = {"id": k, "type": ntype, "category": cat, "effects": eff, "summary": summary}
        return k

    def link(self, a, b, kind="control"):
        for x in a:
            for y in b:
                if x != y and x in self.nodes and y in self.nodes:
                    self.edges.append({"from": x, "to": y, "kind": kind})


def dotted(n):
    if isinstance(n, ast.Name):
        return n.id
    if isinstance(n, ast.Attribute):
        b = dotted(n.value)
        return f"{b}.{n.attr}" if b else n.attr
    if isinstance(n, ast.Call):
        return dotted(n.func)
    return None


def deco_names(fn):
    out = []
    for d in fn.decorator_list:
        name = dotted(d.func if isinstance(d, ast.Call) else d) or ""
        out.append((name.split(".")[-1], d))
    return out


def kwargs(call):
    return {k.arg: k.value for k in call.keywords if k.arg} if isinstance(call, ast.Call) else {}


def sval(n):
    if isinstance(n, ast.Constant) and isinstance(n.value, str):
        return n.value
    if isinstance(n, ast.JoinedStr):
        return "".join(str(v.value) if isinstance(v, ast.Constant) else "{x}" for v in n.values)
    return None


def connectors_from_imports(tree, prefix_rx):
    out = set()
    for st in ast.walk(tree):
        mods = []
        if isinstance(st, ast.ImportFrom) and st.module:
            mods = [st.module]
        elif isinstance(st, ast.Import):
            mods = [a.name for a in st.names]
        for m in mods:
            mm = re.match(prefix_rx, m)
            if mm:
                out.add(mm.group(1))
            top = m.split(".")[0]
            if top in ("openai", "anthropic", "boto3", "snowflake", "duckdb", "psycopg2", "sqlalchemy", "requests",
                       "httpx", "slack_sdk", "google", "databricks", "pyspark", "dbt", "dlt", "great_expectations",
                       "wandb", "mlflow", "langchain", "dspy", "polars", "pandas", "kubernetes", "modal", "marvin",
                       "controlflow", "pinecone", "weaviate", "chromadb", "stripe", "github", "tweepy"):
                out.add(top)
    return out


def parse(path, src=None):
    try:
        return ast.parse(src if src is not None else open(path, encoding="utf-8", errors="replace").read())
    except SyntaxError:
        return None


# ================================================================== Dagster ==================
DG_ROOT = glob.glob("/opt/corpus/dagster/dagster-io__dagster@*/")[0].rstrip("/")
DG_MAN = json.load(open(DG_ROOT + ".manifest.json"))


def dagster_project(pdir):
    files = [f for f in sorted(glob.glob(f"{pdir}/**/*.py", recursive=True))
             if not re.search(r"/(tests?|.*_tests|docs_snippets_tests)/|/test_[^/]*\.py$|conftest\.py$|/setup\.py$", f)]
    g = G()
    assets, asset_params, asset_deps = {}, {}, {}
    ops, jobs_src, checks, triggers = {}, [], [], []
    resource_keys = set()
    trees = []
    for f in files:
        t = parse(f)
        if t is None:
            continue
        trees.append((f, t))
        for n in ast.walk(t):
            if isinstance(n, ast.Call) and (dotted(n.func) or "").split(".")[-1] == "Definitions":
                r = kwargs(n).get("resources")
                if isinstance(r, ast.Dict):
                    for k in r.keys:
                        if sval(k):
                            resource_keys.add(sval(k))
    conns = set()
    for f, t in trees:
        conns |= connectors_from_imports(t, r"^dagster_([a-z0-9_]+)")
    for f, t in trees:
        src = open(f, encoding="utf-8", errors="replace").read()
        for fn in ast.walk(t):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dname, d in deco_names(fn):
                kw = kwargs(d)
                body = ast.unparse(fn)
                if dname in ("asset", "multi_asset", "graph_asset", "graph_multi_asset", "observable_source_asset",
                             "dbt_assets", "dlt_assets", "sling_assets", "airbyte_assets", "fivetran_assets",
                             "dbt_cloud_assets", "databricks_assets", "sigma_assets", "looker_assets", "powerbi_assets",
                             "tableau_assets", "openai_assets"):
                    key = sval(kw.get("name")) or fn.name
                    cat, eff = "action", "write"
                    typ = "@" + dname
                    if dname.startswith(("graph_",)):
                        cat = "subworkflow"; g.subs += 1
                    elif dname == "observable_source_asset":
                        eff = "read"
                    elif dname.endswith("_assets") and dname != "multi_asset":
                        conns.add(dname.replace("_assets", ""))
                        eff = "external"
                    if MODEL_RX.search(body):
                        cat, eff = "model", "external"
                    elif EXT_RX.search(body) and cat == "action":
                        eff = "external" if re.search(r"(?i)requests\.|httpx|slack|sendgrid|twilio|post\(", body) else "write"
                    bits = [typ]
                    if "partitions_def" in kw:
                        pd = ast.unparse(kw["partitions_def"])
                        bits.append("partitioned")
                        if "Dynamic" in pd or "Dynamic" in src:
                            pass
                    if "automation_condition" in kw or "auto_materialize_policy" in kw:
                        bits.append("declarative automation")
                        g.async_kinds.append("event")
                        triggers.append(("automation", key))
                    if "freshness_policy" in kw or "freshness" in body[:0]:
                        bits.append("freshness policy")
                    if "retry_policy" in kw:
                        bits.append("retry")
                    if "check_specs" in kw:
                        bits.append("inline checks")
                    doc = ast.get_docstring(fn)
                    nid = g.add(key, typ, cat, eff, "; ".join(bits) + (": " + doc if doc else ""))
                    assets[key] = nid
                    assets.setdefault(fn.name, nid)
                    # multi_asset outs/specs keys also resolve to this node
                    for k in ("outs", "specs"):
                        v = kw.get(k)
                        if isinstance(v, ast.Dict):
                            for kk in v.keys:
                                if sval(kk):
                                    assets.setdefault(sval(kk), nid)
                        if isinstance(v, (ast.List, ast.Tuple)):
                            for e in v.elts:
                                if isinstance(e, ast.Call) and e.args and sval(e.args[0]):
                                    assets.setdefault(sval(e.args[0]), nid)
                    params = []
                    for a in fn.args.args + fn.args.kwonlyargs:
                        ann = ast.unparse(a.annotation) if a.annotation else ""
                        if a.arg in ("context", "config", "self") or a.arg in resource_keys or \
                                re.search(r"Resource|Client|Connection|IOManager|Config|Context", ann):
                            continue
                        params.append(a.arg)
                    deps = []
                    if "deps" in kw:
                        v = kw["deps"]
                        for e in (v.elts if isinstance(v, (ast.List, ast.Tuple)) else [v]):
                            deps.append(sval(e) or dotted(e) or (sval(e.args[0]) if isinstance(e, ast.Call) and e.args else None))
                    if "ins" in kw and isinstance(kw["ins"], ast.Dict):
                        for kk, vv in zip(kw["ins"].keys, kw["ins"].values):
                            k2 = sval(kwargs(vv).get("key")) if isinstance(vv, ast.Call) else None
                            params.append(k2 or sval(kk))
                    asset_params[nid] = params
                    asset_deps[nid] = [d for d in deps if d]
                elif dname in ("op",):
                    ops[fn.name] = fn
                elif dname in ("job", "graph"):
                    jobs_src.append((dname, fn))
                elif dname in ("asset_check", "multi_asset_check"):
                    tgt = kw.get("asset")
                    checks.append((sval(kw.get("name")) or fn.name, sval(tgt) or dotted(tgt)))
                elif dname in ("schedule",):
                    triggers.append(("schedule", sval(kw.get("cron_schedule")) or "?"))
                elif dname in ("sensor", "asset_sensor", "multi_asset_sensor", "run_status_sensor",
                               "run_failure_sensor", "freshness_policy_sensor"):
                    triggers.append((dname, fn.name))
        for n in ast.walk(t):
            if isinstance(n, ast.Call):
                cn = (dotted(n.func) or "").split(".")[-1]
                if cn == "ScheduleDefinition" or cn == "build_schedule_from_partitioned_job":
                    triggers.append(("schedule", sval(kwargs(n).get("cron_schedule")) or "partitioned"))
                elif cn in ("AssetSpec", "SourceAsset") and n.args and sval(n.args[0]):
                    key = sval(n.args[0])
                    if key not in assets:
                        nid = g.add(key, cn, "action", "read", f"{cn} (external/source asset)")
                        assets[key] = nid
                        deps = kwargs(n).get("deps")
                        asset_deps[nid] = [sval(e) or dotted(e) for e in deps.elts] if isinstance(deps, (ast.List, ast.Tuple)) else []
                        asset_params[nid] = []
                elif cn == "DynamicPartitionsDefinition":
                    g.loops += 1; g.notes.add("dynamic partitions")
                elif cn in ("DailyPartitionsDefinition", "HourlyPartitionsDefinition", "WeeklyPartitionsDefinition",
                            "MonthlyPartitionsDefinition", "StaticPartitionsDefinition", "MultiPartitionsDefinition",
                            "TimeWindowPartitionsDefinition"):
                    g.notes.add("partitions")
                elif cn in ("AutomationCondition", "AutoMaterializePolicy") or (dotted(n.func) or "").startswith("AutomationCondition."):
                    g.notes.add("declarative automation")
                elif cn == "load_assets_from_dbt_project" or cn == "DbtProject":
                    conns.add("dbt")
                elif cn == "define_asset_job":
                    g.notes.add("asset jobs")
                elif cn == "RetryPolicy":
                    g.notes.add("retry policy")
    # asset edges
    for nid, params in asset_params.items():
        for p in params + asset_deps.get(nid, []):
            if p and p.split(".")[-1] in assets:
                src_id = assets[p.split(".")[-1]]
                g.link([src_id], [nid], "data" if p in params else "control")
    for name, tgt in checks:
        cid = g.add(name, "@asset_check", "action", "read", f"asset check on {tgt}")
        if tgt and tgt.split(".")[-1] in assets:
            g.link([assets[tgt.split(".")[-1]]], [cid], "data")
    # op jobs/graphs
    for kind, fn in jobs_src:
        env = {}
        prev = None

        def ev(e):
            if isinstance(e, ast.Name):
                return env.get(e.id, [])
            if isinstance(e, ast.Call):
                fname = dotted(e.func) or ""
                last = fname.split(".")[-1]
                base = fname.split(".")[0]
                if last in ("map",) and isinstance(e.func, ast.Attribute):
                    srcs = ev(e.func.value)
                    g.loops += 1
                    out = []
                    for a in e.args:
                        nm = dotted(a) or "lambda"
                        k = g.add(f"{fn.name}.{nm}", "op(mapped)", "code", "none", f"dynamic map over DynamicOut in {kind} {fn.name}")
                        g.link(srcs, [k], "data"); out.append(k)
                    return out
                if last == "collect" and isinstance(e.func, ast.Attribute):
                    srcs = ev(e.func.value)
                    return srcs
                if base in ops or last in ops:
                    op = ops.get(base) or ops.get(last)
                    body = ast.unparse(op)
                    cat = "model" if MODEL_RX.search(body) else "code"
                    eff = "external" if EXT_RX.search(body) else "none"
                    k = g.add(f"{fn.name}.{op.name}", "@op", cat, eff, f"op in {kind} {fn.name}")
                    for a in list(e.args) + [kk.value for kk in e.keywords]:
                        g.link(ev(a), [k], "data")
                    return [k]
                out = []
                for a in e.args:
                    out += ev(a)
                return out
            if isinstance(e, (ast.Tuple, ast.List)):
                out = []
                for x in e.elts:
                    out += ev(x)
                return out
            if isinstance(e, ast.Subscript):
                return ev(e.value)
            return []
        for st in fn.body:
            if isinstance(st, ast.Assign):
                r = ev(st.value)
                for tg in st.targets:
                    for nm in ([tg] if isinstance(tg, ast.Name) else getattr(tg, "elts", [])):
                        if isinstance(nm, ast.Name):
                            env[nm.id] = r
            elif isinstance(st, (ast.Expr, ast.Return)) and st.value is not None:
                ev(st.value)
    # triggers
    trig_ids = []
    for kind, val in triggers:
        if kind == "automation":
            continue
        if kind == "schedule":
            trig_ids.append(g.add(f"schedule:{val}", "schedule", "trigger", "none", f"cron {val}"))
            g.async_kinds.append("schedule")
        elif kind in ("run_failure_sensor",) or (kind == "run_status_sensor"):
            k = g.add(val, f"@{kind}", "error-handler", "external", f"{kind} reacting to run status")
            g.needs.add("error-branches")
            g.async_kinds.append("event")
        else:
            trig_ids.append(g.add(val, f"@{kind}", "trigger", "read", f"{kind} (polling evaluation)"))
            g.async_kinds.append("poll")
    if trig_ids or any(k == "automation" for k, _ in triggers):
        g.needs.add("triggers")
    nodes = list(g.nodes.values())
    roots = [n["id"] for n in nodes if n["category"] not in ("trigger",) and not any(e["to"] == n["id"] for e in g.edges)]
    for t in trig_ids:
        g.link([t], roots[:50], "control")
    g.connectors += sorted(c for c in conns if c not in ("dagster", "pandas", "polars", "test", "shared", "components", "dg", "graphql"))
    return g, files


def dagster_items():
    items, errors = [], []
    ex = f"{DG_ROOT}/examples"
    projects = [d for d in sorted(glob.glob(f"{ex}/*/")) if not d.rstrip("/").endswith(("docs_snippets", "docs_projects", "experimental", "use_case_repository"))]
    projects += sorted(glob.glob(f"{ex}/docs_projects/*/")) + sorted(glob.glob(f"{ex}/experimental/*/"))
    projects += sorted(glob.glob(f"{ex}/use_case_repository/use_case_repository/guides/")) if False else []
    for pdir in projects:
        rel = os.path.relpath(pdir, DG_ROOT).rstrip("/")
        try:
            g, files = dagster_project(pdir)
            if not g.nodes:
                errors.append({"file": rel, "error": "no assets/ops found"}); continue
            readme = next(iter(glob.glob(f"{pdir}/README.md")), None)
            desc = ""
            if readme:
                txt = open(readme, encoding="utf-8", errors="replace").read()
                paras = [p.strip() for p in re.split(r"\n\s*\n", txt) if p.strip() and not p.strip().startswith(("#", "!", "[", "<", "```", "|"))]
                desc = paras[0] if paras else ""
            items.append(finish(g, platform="dagster", sid=rel.replace("examples/", ""),
                                url=f"https://github.com/dagster-io/dagster/tree/{DG_MAN['oid']}/{rel}",
                                revision=DG_MAN["oid"], retrieved=DG_MAN["retrievedAt"], lic="Apache-2.0",
                                ev=f"https://raw.githubusercontent.com/dagster-io/dagster/{DG_MAN['oid']}/LICENSE",
                                raw=pdir, title=f"{os.path.basename(rel)} (Dagster example project, {len(files)} py files)",
                                desc=desc, base_dom=["data-orchestration"],
                                note="Project-level static extraction: @asset/@multi_asset params+deps+ins as edges, @op graphs, schedules/sensors as triggers, asset checks as read nodes.",
                                oracle={"kind": "test-profile" if glob.glob(f"{pdir}/**/test*.py", recursive=True) else "none",
                                        "notes": "Example ships pytest tests (materialize/execute in-process with local resources); not run here." if glob.glob(f"{pdir}/**/test*.py", recursive=True) else "No tests shipped."}))
        except Exception as e:
            errors.append({"file": rel, "error": f"{type(e).__name__}: {e}"})
    return items, errors, len(projects)


def finish(g, *, platform, sid, url, revision, retrieved, lic, ev, raw, title, desc, base_dom, note, oracle, redis=True):
    nodes = list(g.nodes.values())
    edges = oc.dedupe_edges(g.edges)
    if g.subs:
        g.needs.add("subworkflow-call")
    if "event" in g.async_kinds and platform != "dagster":
        g.needs.add("signals")
    text = " ".join([sid, title, desc[:300], " ".join(g.connectors)])
    features = oc.compute_features(nodes, edges, guards=g.guards, loops=g.loops, async_kinds=g.async_kinds,
                                   connectors=g.connectors, domains=oc.domains_for(text, base_dom))
    ir = oc.ir_verdict(features, needs=sorted(g.needs), notes=f"{note} Other: {', '.join(sorted(g.notes)) or 'none'}.")
    return oc.make_item(platform=platform, sid=sid, url=url, revision=revision, retrieved=retrieved, license=lic,
                        license_evidence=ev, redistributable=redis, raw_path=raw, title=title, description=desc,
                        desc_provenance="original" if desc else "written", nodes=nodes, edges=edges,
                        features=features, ir=ir, oracle=oracle)


# ================================================================== Prefect ==================
def prefect_flow_graph(tree, src):
    """Return G for the richest top-level flow in a module (subflows inlined as subworkflow nodes)."""
    tasks, flows = {}, {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dname, d in deco_names(fn):
                if dname == "task" or dname.endswith("_task"):
                    tasks[fn.name] = (fn, d)
                elif dname == "flow":
                    flows[fn.name] = (fn, d)
    if not flows:
        return None
    called = set()
    for name, (fn, d) in flows.items():
        for n in ast.walk(fn):
            if isinstance(n, ast.Call) and (dotted(n.func) or "").split(".")[0] in flows and (dotted(n.func) or "").split(".")[0] != name:
                called.add((dotted(n.func) or "").split(".")[0])
    tops = [f for f in flows if f not in called] or list(flows)
    best = None
    for top in tops:
        g = G()
        fn, d = flows[top]
        conns = connectors_from_imports(tree, r"^prefect_([a-z0-9_]+)")
        g.connectors += sorted(conns - {"prefect"})
        for hook in ("on_failure", "on_crashed", "on_cancellation"):
            if hook in kwargs(d):
                k = g.add(f"{top}.{hook}", hook, "error-handler", "external", f"flow {hook} hook")
                g.needs.add("error-branches")
        if "retries" in kwargs(d):
            g.notes.add("flow retries")
        walk_flow(g, fn, tasks, flows, top, depth=0)
        for n in ast.walk(tree):
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("serve", "deploy", "to_deployment"):
                kw = kwargs(n)
                for key, kind in (("cron", "schedule"), ("interval", "schedule"), ("rrule", "schedule"),
                                  ("schedule", "schedule"), ("schedules", "schedule"), ("triggers", "event")):
                    if key in kw:
                        k = g.add(f"trigger:{key}", key, "trigger", "none", f"deployment {key}")
                        g.async_kinds.append(kind)
                        g.needs.add("triggers")
                        roots = [x for x in g.nodes if g.nodes[x]["category"] != "trigger" and not any(e["to"] == x for e in g.edges)]
                        g.link([k], roots[:20], "control")
        sc = oc.complexity({"features": oc.compute_features(list(g.nodes.values()), g.edges, guards=g.guards, loops=g.loops,
                                                            async_kinds=g.async_kinds, connectors=g.connectors, domains=[])})
        if best is None or sc > best[0]:
            best = (sc, g, top, ast.get_docstring(fn) or "")
    return best


def walk_flow(g, fn, tasks, flows, prefix, depth):
    env = {}
    state = {"prev": []}

    def task_call(call):
        """Recognise t(...), t.submit(...), t.map(...), t.with_options(..)(..), flow calls."""
        f = call.func
        mode = "call"
        base = f
        if isinstance(f, ast.Attribute) and f.attr in ("submit", "map", "fn", "delay"):
            mode, base = f.attr, f.value
        if isinstance(base, ast.Call) and isinstance(base.func, ast.Attribute) and base.func.attr == "with_options":
            base = base.func.value
        if isinstance(base, ast.Attribute) and base.attr == "with_options":
            base = base.value
        name = dotted(base)
        if name in tasks:
            return "task", name, mode
        if name in flows:
            return "flow", name, mode
        last = (name or "").split(".")[-1]
        if last in ("pause_flow_run", "suspend_flow_run", "wait_for_input", "receive_input"):
            return "human", last, mode
        if last in ("run_deployment",):
            return "deployment", last, mode
        if last in ("sleep",) and (name or "").split(".")[0] in ("time", "asyncio", "anyio"):
            return "sleep", last, mode
        if last in ("emit_event",):
            return "event", last, mode
        return None, None, None

    def refs_in(node):
        out = []
        for n in ast.walk(node):
            if isinstance(n, ast.Name) and n.id in env:
                out += env[n.id]
        return out

    def make(call, in_loop, guard, in_except):
        kind, name, mode = task_call(call)
        if kind is None:
            return None
        bits = []
        if kind == "task":
            tfn, td = tasks[name]
            body = ast.unparse(tfn)
            cat = "model" if MODEL_RX.search(body) else "code"
            eff = "external" if EXT_RX.search(body) else "none"
            if re.search(r"(?i)(write|save|upload|insert|to_csv|to_parquet|put_object|load_to)", body):
                eff = "write" if eff == "none" else eff
            tkw = kwargs(td)
            if "retries" in tkw:
                bits.append("retries")
            if "cache_key_fn" in tkw or "cache_policy" in tkw:
                bits.append("cached")
            typ = "@task"
        elif kind == "flow":
            cat, eff, typ = "subworkflow", "none", "@flow(subflow)"
            g.subs += 1
        elif kind == "human":
            cat, eff, typ = "human", "none", name
            g.async_kinds.append("wait")
        elif kind == "deployment":
            cat, eff, typ = "subworkflow", "external", "run_deployment"
            g.subs += 1
        elif kind == "sleep":
            cat, eff, typ = "wait", "none", "sleep"
            g.async_kinds.append("wait")
        else:
            cat, eff, typ = "action", "external", name
            g.async_kinds.append("event")
        if mode == "map":
            g.loops += 1
            bits.append(".map (fan-out)")
        elif mode == "submit":
            bits.append(".submit (concurrent)")
        if in_loop:
            bits.append("inside loop")
        if guard:
            bits.append("guarded by if")
        if in_except:
            cat = "error-handler" if cat in ("code", "action") else cat
            bits.append("in except/finally")
        k = g.add(f"{prefix}.{name}" if depth else name, typ, cat, eff, "; ".join(bits) or typ)
        deps = refs_in(call)
        for kw in call.keywords:
            if kw.arg == "wait_for":
                for r in refs_in(kw.value):
                    g.link([r], [k], "control")
        g.link(deps, [k], "data")
        if mode == "call" and state["prev"]:
            g.link(state["prev"], [k], "error" if in_except else "control")
        if mode == "call":
            state["prev"] = [k]
        return k

    def visit_expr(e, in_loop, guard, in_except):
        made = []
        for n in ast.walk(e):
            if isinstance(n, ast.Call):
                k = make(n, in_loop, guard, in_except)
                if k:
                    made.append(k)
        if any(isinstance(n, ast.Call) and (dotted(n.func) or "").endswith("gather") for n in ast.walk(e)):
            g.notes.add("asyncio.gather")
        return made

    def visit(stmts, in_loop=False, guard=False, in_except=False):
        for st in stmts:
            if isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                made = visit_expr(st.value, in_loop, guard, in_except) if st.value is not None else []
                tgts = st.targets if isinstance(st, ast.Assign) else [st.target]
                for t in tgts:
                    for nm in ast.walk(t):
                        if isinstance(nm, ast.Name):
                            env[nm.id] = (made or refs_in(st.value)) if st.value is not None else []
            elif isinstance(st, (ast.Expr, ast.Return)) and st.value is not None:
                visit_expr(st.value, in_loop, guard, in_except)
            elif isinstance(st, (ast.For, ast.AsyncFor, ast.While)):
                before = len(g.nodes)
                loop_entry_prev = list(state["prev"])
                if isinstance(st, (ast.For, ast.AsyncFor)):
                    srcs = refs_in(st.iter)
                    for nm in ast.walk(st.target):
                        if isinstance(nm, ast.Name):
                            env[nm.id] = srcs
                visit(st.body, True, guard, in_except)
                if len(g.nodes) > before:
                    g.loops += 1
                    new = list(g.nodes)[before:]
                    if new and len(new) >= 1:
                        g.edges.append({"from": new[-1], "to": new[0], "kind": "loop"})
                visit(st.orelse, in_loop, guard, in_except)
            elif isinstance(st, ast.If):
                before = len(g.nodes)
                visit(st.body, in_loop, True, in_except)
                visit(st.orelse, in_loop, True, in_except)
                if len(g.nodes) > before:
                    g.guards += 1
            elif isinstance(st, ast.Try):
                visit(st.body, in_loop, guard, in_except)
                for h in st.handlers:
                    before = len(g.nodes)
                    visit(h.body, in_loop, guard, True)
                    if len(g.nodes) > before:
                        g.needs.add("error-branches")
                visit(st.orelse, in_loop, guard, in_except)
                visit(st.finalbody, in_loop, guard, True)
            elif isinstance(st, (ast.With, ast.AsyncWith)):
                visit(st.body, in_loop, guard, in_except)
    visit(fn.body)


PF_ROOTS = sorted(glob.glob("/opt/corpus/prefect/PrefectHQ__prefect*@*/"))


def prefect_items():
    items, errors, n = [], [], 0
    for root in PF_ROOTS:
        man = json.load(open(root.rstrip("/") + ".manifest.json"))
        repo = man["repo"]
        lic_txt = open(f"{root}/LICENSE", encoding="utf-8", errors="replace").read() if os.path.exists(f"{root}/LICENSE") else ""
        spdx = oc.classify_license_text(lic_txt)
        for f in sorted(glob.glob(f"{root}/**/*.py", recursive=True) + glob.glob(f"{root}/**/*.mdx", recursive=True)):
            rel = os.path.relpath(f, root)
            if re.search(r"(^|/)tests?/|conftest", rel):
                continue
            n += 1
            try:
                if f.endswith(".mdx"):
                    txt = open(f, encoding="utf-8", errors="replace").read()
                    blocks = re.findall(r"```python[^\n]*\n(.*?)```", txt, re.S)
                    cands = []
                    for b in blocks:
                        if "@flow" not in b:
                            continue
                        t = parse(None, b)
                        if t is None:
                            continue
                        r = prefect_flow_graph(t, b)
                        if r:
                            cands.append(r)
                    if not cands:
                        continue
                    best = max(cands, key=lambda r: r[0])
                    m = re.search(r"^title:\s*(.+)$", txt, re.M)
                    title = (m.group(1).strip().strip('"') if m else rel) + " (Prefect docs example)"
                    md = re.search(r"^description:\s*(.+)$", txt, re.M)
                    desc = md.group(1).strip().strip('"') if md else ""
                else:
                    src = open(f, encoding="utf-8", errors="replace").read()
                    if "prefect" not in src or "flow" not in src:
                        continue
                    t = parse(f)
                    if t is None:
                        errors.append({"file": rel, "error": "syntax"}); continue
                    best = prefect_flow_graph(t, src)
                    if not best:
                        continue
                    title = f"{best[2]} ({repo.split('/')[1]}:{rel})"
                    desc = best[3] or (ast.get_docstring(t) or "")
                sc, g, top, _ = best
                if len(g.nodes) == 0:
                    errors.append({"file": rel, "error": "flow without recognised task calls"}); continue
                items.append(finish(g, platform="prefect", sid=f"{repo.split('/')[1]}/{rel}",
                                    url=f"https://github.com/{repo}/blob/{man['oid']}/{rel}", revision=man["oid"],
                                    retrieved=man["retrievedAt"], lic=spdx,
                                    ev=f"https://raw.githubusercontent.com/{repo}/{man['oid']}/{(man.get('license') or {}).get('path', 'LICENSE')}",
                                    raw=f, title=title, desc=desc, base_dom=["data-orchestration"],
                                    note="Flow body walked statically: direct task calls chained in order, .submit/.map concurrent, if/for/try mapped to guard/loop/error edges, subflows and run_deployment as subworkflow, pause/suspend/wait_for_input as human.",
                                    oracle={"kind": "none", "notes": "Example/recipe; no shipped oracle."},
                                    redis=oc.redistributable_license(spdx)))
            except Exception as e:
                errors.append({"file": rel, "error": f"{type(e).__name__}: {e}"})
    return items, errors, n


# ================================================================== Temporal =================
TP_ROOT = glob.glob("/opt/corpus/temporal/temporalio__samples-python@*/")[0].rstrip("/")
TP_MAN = json.load(open(TP_ROOT + ".manifest.json"))
TG_DIR = glob.glob("/opt/corpus/temporal/extracted/github.com/temporalio/samples-go@*/")[0].rstrip("/")
TG_MAN = json.load(open(glob.glob("/opt/corpus/temporal/github.com_temporalio_samples-go@*.manifest.json")[0]))


def temporal_py_sample(sdir, only=None):
    files = [f for f in sorted(glob.glob(f"{sdir}/**/*.py", recursive=True)) if not re.search(r"/tests?/|test_", f)]
    if only:
        files = [only]
    trees = [(f, parse(f)) for f in files]
    trees = [(f, t) for f, t in trees if t is not None]
    acts, wfs = {}, {}
    signals, updates = [], []
    for f, t in trees:
        for n in ast.walk(t):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dname, d in deco_names(n):
                    full = dotted(d.func if isinstance(d, ast.Call) else d) or ""
                    if full.endswith("activity.defn"):
                        acts[n.name] = n
                    elif full.endswith("workflow.signal"):
                        signals.append(n.name)
                    elif full.endswith("workflow.update"):
                        updates.append(n.name)
            if isinstance(n, ast.ClassDef):
                for dname, d in deco_names(n):
                    full = dotted(d.func if isinstance(d, ast.Call) else d) or ""
                    if full.endswith("workflow.defn"):
                        wfs[n.name] = n
    if not wfs:
        return None
    g = G()
    conns = set()
    for f, t in trees:
        conns |= connectors_from_imports(t, r"^temporalio\.contrib\.([a-z0-9_]+)")
    g.connectors += sorted(conns)
    for s in signals:
        g.async_kinds.append("event")
    if signals or updates:
        g.needs.add("signals")
        g.notes.add(f"signal handlers: {len(signals)}, update handlers: {len(updates)}")
    for wname, cls in wfs.items():
        run = next((m for m in cls.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and
                    any((dotted(d.func if isinstance(d, ast.Call) else d) or "").endswith("workflow.run") for d in m.decorator_list)), None)
        if run is None:
            continue
        prefix = wname if len(wfs) > 1 else ""
        temporal_py_walk(g, run, acts, wfs, prefix, signals + updates)
    return g, files


def temporal_py_walk(g, fn, acts, wfs, prefix, handlers):
    env, state = {}, {"prev": []}

    def classify(call):
        name = dotted(call.func) or ""
        last = name.split(".")[-1]
        a0 = call.args[0] if call.args else None
        target = (dotted(a0) or sval(a0) or "?") if a0 is not None else "?"
        if last in ("execute_activity", "start_activity", "execute_activity_method", "start_activity_method",
                    "execute_local_activity", "start_local_activity", "execute_local_activity_method"):
            tname = target.split(".")[-1]
            body = ast.unparse(acts[tname]) if tname in acts else ""
            cat = "model" if MODEL_RX.search(body + " " + tname) else "action"
            eff = "external" if (EXT_RX.search(body) or cat == "model") else ("write" if re.search(r"(?i)write|save|create|insert|update|delete|charge|refund|book|cancel|send|transfer|withdraw|deposit", tname) else "read" if re.search(r"(?i)get|fetch|read|list|query|lookup", tname) else "external")
            return ("activity", tname, cat, eff, "start" if last.startswith("start") else "exec")
        if last in ("execute_child_workflow", "start_child_workflow"):
            return ("child", target.split(".")[0], "subworkflow", "none", "start" if last.startswith("start") else "exec")
        if last == "wait_condition":
            return ("wait_condition", "wait_condition", "wait", "none", "exec")
        if last == "sleep" and name.split(".")[0] in ("asyncio", "workflow"):
            return ("sleep", "timer", "wait", "none", "exec")
        if last in ("continue_as_new",):
            return ("can", "continue_as_new", "loop", "none", "exec")
        if last in ("execute_operation", "start_operation"):
            return ("nexus", target.split(".")[-1], "action", "external", "exec")
        if last in ("execute_update", "signal") and isinstance(call.func, ast.Attribute):
            return ("ext-signal", last, "action", "external", "exec")
        return None

    def refs_in(node):
        out = []
        for n in ast.walk(node):
            if isinstance(n, ast.Name) and n.id in env:
                out += env[n.id]
        return out

    def make(call, in_loop, guard, in_except):
        c = classify(call)
        if not c:
            return None
        kind, name, cat, eff, mode = c
        bits = []
        if kind == "wait_condition":
            g.async_kinds.append("event" if handlers else "wait")
            src = ast.unparse(call)
            if re.search(r"(?i)approv|confirm|review|human|accept|reject|decision", src + " ".join(handlers)):
                cat = "human"
                bits.append("waits for approval signal/update")
            else:
                bits.append("waits for signal/condition")
            if any(k.arg == "timeout" for k in call.keywords):
                bits.append("with timeout")
        if kind == "sleep":
            g.async_kinds.append("wait")
            bits.append("durable timer")
        if kind == "child":
            g.subs += 1
        if kind == "can":
            g.loops += 1
            bits.append("continue-as-new (unbounded loop)")
        kws = kwargs(call)
        if "retry_policy" in kws:
            bits.append("retry policy")
        if "heartbeat_timeout" in kws:
            bits.append("heartbeat")
        if mode == "start":
            bits.append("started async (future)")
        if in_loop:
            bits.append("inside loop")
        if guard:
            bits.append("guarded")
        if in_except:
            bits.append("compensation/except path")
            if cat in ("action", "model"):
                cat = "error-handler"
                g.needs.add("sagas/compensation")
        k = g.add(f"{prefix}.{name}" if prefix else name, f"{kind}", cat, eff, "; ".join(bits) or kind)
        if kind == "can" and g.nodes:
            first = next(iter(g.nodes))
            g.edges.append({"from": k, "to": first, "kind": "loop"})
        g.link(refs_in(call), [k], "data")
        if state["prev"]:
            g.link(state["prev"], [k], "error" if in_except else "control")
        if mode != "start":
            state["prev"] = [k]
        else:
            state.setdefault("pending", []).append(k)
        return k

    def visit_expr(e, in_loop, guard, in_except):
        made = []
        calls = [n for n in ast.walk(e) if isinstance(n, ast.Call)]
        gather = any((dotted(n.func) or "").endswith("gather") for n in calls)
        if gather:
            saved = list(state["prev"])
            g.notes.add("asyncio.gather fan-out")
            comp = any(isinstance(n, (ast.ListComp, ast.GeneratorExp)) for n in ast.walk(e))
            if comp:
                g.loops += 1
        for n in calls:
            if gather:
                state["prev"] = saved
            k = make(n, in_loop, guard, in_except)
            if k:
                made.append(k)
        if gather and made:
            state["prev"] = made
        return made

    def visit(stmts, in_loop=False, guard=False, in_except=False):
        for st in stmts:
            if isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)) and st.value is not None:
                made = visit_expr(st.value, in_loop, guard, in_except)
                tg = st.targets if isinstance(st, ast.Assign) else [st.target]
                for t in tg:
                    for nm in ast.walk(t):
                        if isinstance(nm, ast.Name):
                            env[nm.id] = made or refs_in(st.value)
            elif isinstance(st, (ast.Expr, ast.Return)) and st.value is not None:
                visit_expr(st.value, in_loop, guard, in_except)
            elif isinstance(st, (ast.For, ast.AsyncFor, ast.While)):
                before = len(g.nodes)
                visit(st.body, True, guard, in_except)
                if len(g.nodes) > before:
                    g.loops += 1
                    new = list(g.nodes)[before:]
                    g.edges.append({"from": new[-1], "to": new[0], "kind": "loop"})
                visit(st.orelse, in_loop, guard, in_except)
            elif isinstance(st, ast.If):
                before = len(g.nodes)
                visit(st.body, in_loop, True, in_except)
                visit(st.orelse, in_loop, True, in_except)
                if len(g.nodes) > before:
                    g.guards += 1
            elif isinstance(st, ast.Try):
                visit(st.body, in_loop, guard, in_except)
                for h in st.handlers:
                    visit(h.body, in_loop, guard, True)
                visit(st.orelse, in_loop, guard, in_except)
                visit(st.finalbody, in_loop, guard, True)
            elif isinstance(st, (ast.With, ast.AsyncWith)):
                visit(st.body, in_loop, guard, in_except)
            elif isinstance(st, ast.Match):
                before = len(g.nodes)
                for case in st.cases:
                    visit(case.body, in_loop, True, in_except)
                if len(g.nodes) > before:
                    g.guards += 1
    visit(fn.body)


GO_CALLS = [
    (r"workflow\.ExecuteActivity\(\s*\w+\s*,\s*([\w.]+)", "activity", "action"),
    (r"workflow\.ExecuteLocalActivity\(\s*\w+\s*,\s*([\w.]+)", "local-activity", "action"),
    (r"workflow\.ExecuteChildWorkflow\(\s*\w+\s*,\s*([\w.]+)", "child", "subworkflow"),
    (r"workflow\.Sleep\(", "sleep", "wait"),
    (r"workflow\.NewTimer\(", "timer", "wait"),
    (r"workflow\.GetSignalChannel\(\s*\w+\s*,\s*([\w.\"]+)", "signal", "wait"),
    (r"workflow\.Await(?:WithTimeout)?\(", "await", "wait"),
    (r"workflow\.NewContinueAsNewError\(", "continue_as_new", "loop"),
    (r"workflow\.ExecuteNexusOperation|\.ExecuteOperation\(", "nexus", "action"),
    (r"workflow\.SignalExternalWorkflow\(", "signal-external", "action"),
    (r"workflow\.RequestCancelExternalWorkflow\(", "cancel-external", "action"),
]


def temporal_go_sample(sdir):
    files = [f for f in sorted(glob.glob(f"{sdir}/**/*.go", recursive=True))
             if not f.endswith("_test.go") and "/starter" not in f and "/worker" not in f]
    g = G()
    found = False
    for f in files:
        src = open(f, encoding="utf-8", errors="replace").read()
        for m in re.finditer(r"func\s+(\w+)\s*\(\s*ctx\s+workflow\.Context[^)]*\)[^{]*\{", src):
            found = True
            wname = m.group(1)
            # brace-matched body
            i, depth = m.end(), 1
            while i < len(src) and depth:
                depth += {"{": 1, "}": -1}.get(src[i], 0); i += 1
            body = src[m.end():i - 1]
            events = []
            for rx, kind, cat in GO_CALLS:
                for mm in re.finditer(rx, body):
                    events.append((mm.start(), kind, cat, mm.group(1) if mm.groups() else kind))
            events.sort()
            loop_spans = []
            for lm in re.finditer(r"\bfor\b[^{]*\{", body):
                j, dd = lm.end(), 1
                while j < len(body) and dd:
                    dd += {"{": 1, "}": -1}.get(body[j], 0); j += 1
                loop_spans.append((lm.start(), j))
            go_spans = [mm.start() for mm in re.finditer(r"workflow\.Go\(", body)]
            sel = len(re.findall(r"workflow\.NewSelector\(", body))
            ifs = len(re.findall(r"\bif\b(?![^{\n]*\berr\s*!=\s*nil)|\bswitch\b", body))
            prev = []
            first_in_wf = None
            for pos, kind, cat, name in events:
                inloop = any(a <= pos < b for a, b in loop_spans)
                bits = [kind]
                eff = "none"
                if cat == "action":
                    eff = "external"
                if kind == "signal":
                    g.async_kinds.append("event")
                    g.needs.add("signals")
                    if re.search(r"(?i)approv|confirm|review|human", name):
                        cat = "human"
                if kind in ("sleep", "timer", "await"):
                    g.async_kinds.append("wait")
                if kind == "child":
                    g.subs += 1
                if inloop:
                    bits.append("inside loop")
                if kind == "continue_as_new":
                    g.loops += 1
                k = g.add(f"{wname}.{name.strip(chr(34)).split('.')[-1]}", kind, cat, eff, "; ".join(bits))
                if first_in_wf is None:
                    first_in_wf = k
                if kind == "continue_as_new":
                    g.edges.append({"from": k, "to": first_in_wf, "kind": "loop"})
                g.link(prev, [k], "control")
                prev = [k]
            for a, b in loop_spans:
                inside = [k for (pos, kind, cat, name), k in zip(events, list(g.nodes)[-len(events):] if events else []) if a <= pos < b]
                if inside:
                    g.loops += 1
                    g.edges.append({"from": inside[-1], "to": inside[0], "kind": "loop"})
            g.guards += min(ifs, 20) if events else 0
            if go_spans:
                g.notes.add("workflow.Go coroutines")
            if sel:
                g.notes.add("selectors")
            if re.search(r"(?i)compensat|saga", body):
                g.needs.add("sagas/compensation")
                g.notes.add("saga/compensation")
    return (g, files) if found and g.nodes else None


def temporal_items():
    items, errors, n = [], [], 0
    lic_py = oc.classify_license_text(open(f"{TP_ROOT}/LICENSE", encoding="utf-8", errors="replace").read())
    for sdir in sorted(d for d in glob.glob(f"{TP_ROOT}/*/") if not os.path.basename(d.rstrip("/")).startswith((".", "tests", "_"))):
        subs = [sdir] + [d for d in sorted(glob.glob(f"{sdir}*/")) if glob.glob(f"{d}*workflow*.py") and not glob.glob(f"{sdir}*workflow*.py")]
        units = []
        for d in (subs[1:] if len(subs) > 1 else subs):
            wf_files = [f for f in sorted(glob.glob(f"{d}*.py")) if "@workflow.defn" in open(f, encoding="utf-8", errors="replace").read()]
            if len(wf_files) >= 4:
                units += [(d, f) for f in wf_files]  # self-contained one-file samples (e.g. hello/)
            else:
                units.append((d, None))
        for d, only in units:
            rel = os.path.relpath(only or d, TP_ROOT).rstrip("/")
            if rel.endswith(".py"):
                rel = rel[:-3]
            n += 1
            try:
                r = temporal_py_sample(d, only)
                if not r:
                    continue
                g, files = r
                if not g.nodes:
                    continue
                readme = os.path.join(d, "README.md")
                desc = ""
                if os.path.exists(readme):
                    paras = [p.strip() for p in re.split(r"\n\s*\n", open(readme, encoding="utf-8", errors="replace").read()) if p.strip() and not p.strip().startswith(("#", "```", "!", "<", "|"))]
                    desc = paras[0] if paras else ""
                items.append(finish(g, platform="temporal", sid=f"samples-python/{rel}",
                                    url=f"https://github.com/temporalio/samples-python/tree/{TP_MAN['oid']}/{rel}",
                                    revision=TP_MAN["oid"], retrieved=TP_MAN["retrievedAt"], lic=lic_py,
                                    ev=f"https://raw.githubusercontent.com/temporalio/samples-python/{TP_MAN['oid']}/LICENSE",
                                    raw=d, title=f"{rel} (Temporal Python sample)", desc=desc, base_dom=["durable-execution"],
                                    note="@workflow.run bodies walked statically: awaited activities chained, start_* futures concurrent, gather fan-out, loops/if/try mapped; signals/updates as events.",
                                    oracle={"kind": "test-profile" if glob.glob(f"{TP_ROOT}/tests/{rel.split('/')[0]}*") else "none",
                                            "notes": "samples-python tests/ run the sample against a Temporal test server (time-skipping) with mocked activities where provided." if glob.glob(f"{TP_ROOT}/tests/{rel.split('/')[0]}*") else "No test found for this sample."},
                                    redis=oc.redistributable_license(lic_py)))
            except Exception as e:
                errors.append({"file": rel, "error": f"{type(e).__name__}: {e}"})
    lic_go = oc.classify_license_text(open(f"{TG_DIR}/LICENSE", encoding="utf-8", errors="replace").read()) if os.path.exists(f"{TG_DIR}/LICENSE") else "MIT"
    sha = TG_MAN["info"]["Origin"]["Hash"]
    for d in sorted(glob.glob(f"{TG_DIR}/*/")):
        rel = os.path.relpath(d, TG_DIR).rstrip("/")
        if rel.startswith((".", "test")):
            continue
        n += 1
        try:
            r = temporal_go_sample(d)
            if not r:
                continue
            g, files = r
            readme = os.path.join(d, "README.md")
            desc = ""
            if os.path.exists(readme):
                paras = [p.strip() for p in re.split(r"\n\s*\n", open(readme, encoding="utf-8", errors="replace").read()) if p.strip() and not p.strip().startswith(("#", "```", "!", "<", "|"))]
                desc = paras[0] if paras else ""
            items.append(finish(g, platform="temporal", sid=f"samples-go/{rel}",
                                url=f"https://github.com/temporalio/samples-go/tree/{sha}/{rel}", revision=f"{sha} (Go module {TG_MAN['version']})",
                                retrieved=TG_MAN["retrievedAt"], lic=lic_go,
                                ev="LICENSE at samples-go module root (proxy.golang.org zip)", raw=d,
                                title=f"{rel} (Temporal Go sample)", desc=desc, base_dom=["durable-execution"],
                                note="Go workflow functions scanned with brace-aware regexes (approximate): calls chained in source order, for-blocks as loops, if/switch counted as guards.",
                                oracle={"kind": "test-profile" if glob.glob(f"{d}*_test.go") else "none",
                                        "notes": "Sample ships Go tests using the Temporal testsuite (mocked activities, time skipping)." if glob.glob(f"{d}*_test.go") else "No test file."},
                                redis=oc.redistributable_license(lic_go)))
        except Exception as e:
            errors.append({"file": rel, "error": f"{type(e).__name__}: {e}"})
    return items, errors, n


if __name__ == "__main__":
    which, out = sys.argv[1], sys.argv[2]
    items, errors, n = {"dagster": dagster_items, "prefect": prefect_items, "temporal": temporal_items}[which]()
    json.dump({"items": items, "errors": errors, "files": n}, open(out, "w"))
    print(f"{which}: units={n} items={len(items)} errors={len(errors)}")
