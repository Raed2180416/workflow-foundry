#!/usr/bin/env python3
"""Airflow example/system-test DAGs -> foundry-corpus-item/1 (static AST analysis only).

Input : /opt/corpus/airflow/extracted/<sdist>/... (from orchestration-fetch-pypi.py + tar extract of
        example_dags/*.py and tests/system/**/example_*.py), /opt/corpus/airflow/pypi-manifest.json
Output: JSON list of candidate items on stdout-file (argv[1]); selection happens in
        orchestration-assemble.py.
The DAG files are parsed with `ast` as text. They are never imported or executed.

Run: python3 -I orchestration-airflow.py /path/to/airflow-candidates.json
"""
import ast, glob, importlib.util, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("oc", os.path.join(HERE, "orchestration-common.py"))
oc = importlib.util.module_from_spec(spec); spec.loader.exec_module(oc)

ROOT = "/opt/corpus/airflow"
MANIFEST = json.load(open(os.path.join(ROOT, "pypi-manifest.json")))
BY_FILE = {v["filename"][: -len(".tar.gz")]: v for v in MANIFEST.values() if v.get("filename")}

SENSOR_TIME = {"TimeDeltaSensor", "TimeDeltaSensorAsync", "DateTimeSensor", "DateTimeSensorAsync",
               "TimeSensor", "TimeSensorAsync", "DayOfWeekSensor", "WaitSensor"}
BRANCH_OPS = {"BranchPythonOperator", "BranchSQLOperator", "BranchDateTimeOperator",
              "BranchDayOfWeekOperator", "ShortCircuitOperator", "BranchExternalPythonOperator",
              "BranchPythonVirtualenvOperator", "HITLBranchOperator", "LLMBranchOperator"}
HITL_OPS = {"HITLOperator", "ApprovalOperator", "HITLBranchOperator", "HITLEntryOperator"}
CODE_OPS = {"PythonOperator", "PythonVirtualenvOperator", "ExternalPythonOperator", "BashOperator",
            "DockerOperator", "KubernetesPodOperator", "SSHOperator", "DockerSwarmOperator",
            "SingularityOperator", "PapermillOperator", "GKEStartPodOperator", "EksPodOperator",
            "AzureContainerInstancesOperator", "EcsRunTaskOperator", "SparkSubmitOperator",
            "KubernetesJobOperator", "WinRMOperator", "PsrpOperator", "CloudRunExecuteJobOperator"}
EXTERNAL_CODE = {"BashOperator", "DockerOperator", "KubernetesPodOperator", "SSHOperator",
                 "DockerSwarmOperator", "SingularityOperator", "GKEStartPodOperator", "EksPodOperator",
                 "AzureContainerInstancesOperator", "EcsRunTaskOperator", "SparkSubmitOperator",
                 "KubernetesJobOperator", "WinRMOperator", "PsrpOperator", "CloudRunExecuteJobOperator"}
SUBDAG_OPS = {"TriggerDagRunOperator", "SubDagOperator"}
MODEL_RX = re.compile(r"(?i)openai|cohere|bedrock|generativemodel|gen_?ai|llm|textembedding|"
                      r"anthropic|gemini|sagemaker.*(endpoint|transform|inference)|vertexai.*(predict|generate)|"
                      r"embedding|agent")
DECORATOR_KINDS = {"task", "setup", "teardown", "task_group", "dag", "asset"}


def dotted(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        b = dotted(node.value)
        return f"{b}.{node.attr}" if b else node.attr
    if isinstance(node, ast.Call):
        return dotted(node.func)
    return None


class Dag:
    def __init__(self, dag_id):
        self.dag_id = dag_id
        self.nodes = {}      # id -> dict
        self.edges = []
        self.groups = {}     # gid -> {"members": [ids], "parent": gid|None}
        self.schedule = None
        self.description = None
        self.mapped = 0
        self.parse_time_loops = 0
        self.callbacks = set()
        self.teardowns = 0
        self.setups = 0


class Extractor:
    def __init__(self, path, src):
        self.path, self.src = path, src
        self.tree = ast.parse(src)
        self.consts = {}
        self.imports = {}
        self.taskfns = {}   # fn name -> (kind, FunctionDef)
        self.dags = []
        self._collect_module()

    # ---- module-level facts -------------------------------------------------------------
    def _collect_module(self):
        for st in ast.walk(self.tree):
            if isinstance(st, ast.ImportFrom) and st.module:
                for a in st.names:
                    self.imports[a.asname or a.name] = f"{st.module}.{a.name}"
            elif isinstance(st, ast.Import):
                for a in st.names:
                    self.imports[a.asname or a.name] = a.name
        for st in self.tree.body:
            if isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name):
                v = self.strval(st.value)
                if v is not None:
                    self.consts[st.targets[0].id] = v
        for st in ast.walk(self.tree):
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
                k = self.deco_kind(st)
                if k:
                    self.taskfns[st.name] = (k, st)

    def strval(self, node, depth=0):
        if depth > 4 or node is None:
            return None
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name):
            return self.consts.get(node.id) if hasattr(self, "consts") else None
        if isinstance(node, ast.JoinedStr):
            out = []
            for v in node.values:
                if isinstance(v, ast.Constant):
                    out.append(str(v.value))
                elif isinstance(v, ast.FormattedValue):
                    s = self.strval(v.value, depth + 1)
                    out.append(s if s is not None else "{" + (dotted(v.value) or "x") + "}")
            return "".join(out)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            a, b = self.strval(node.left, depth + 1), self.strval(node.right, depth + 1)
            if a is not None and b is not None:
                return a + b
        if isinstance(node, ast.Call):
            fn = dotted(node.func) or ""
            if fn.endswith("environ.get") or fn.endswith("getenv"):
                if len(node.args) > 1:
                    return self.strval(node.args[1], depth + 1)
        return None

    def deco_kind(self, fn):
        for d in fn.decorator_list:
            name = dotted(d.func if isinstance(d, ast.Call) else d) or ""
            parts = name.split(".")
            head = parts[0]
            if head in self.imports:
                full = self.imports[head]
                head_name = full.split(".")[-1]
            else:
                head_name = head
            if head_name in DECORATOR_KINDS:
                sub = ".".join(parts[1:])
                return head_name + ("." + sub if sub else "")
        return None

    def class_module(self, cls):
        return self.imports.get(cls.split(".")[0], "")

    # ---- DAG discovery -------------------------------------------------------------------
    def is_dag_call(self, call):
        if not isinstance(call, ast.Call):
            return False
        n = dotted(call.func) or ""
        return n.split(".")[-1] == "DAG"

    def run(self):
        for st in self.tree.body:
            self._discover(st, top=True)
        if not self.dags:
            # legacy style: dag = DAG(...) with operators taking dag=dag at module level
            for st in self.tree.body:
                if isinstance(st, ast.Assign) and self.is_dag_call(st.value):
                    d = self.new_dag(st.value)
                    self.walk(d, [s for s in self.tree.body if s is not st], scope={})
                    break
        return self.dags

    def _discover(self, st, top=False):
        if isinstance(st, ast.With):
            for item in st.items:
                if self.is_dag_call(item.context_expr):
                    d = self.new_dag(item.context_expr)
                    self.walk(d, st.body, scope={})
                    return
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
            k = self.deco_kind(st)
            if k and k.startswith("dag"):
                deco = next(dd for dd in st.decorator_list if (dotted(dd.func if isinstance(dd, ast.Call) else dd) or "").split(".")[0] in ("dag",) or self.imports.get((dotted(dd.func if isinstance(dd, ast.Call) else dd) or "").split(".")[0], "").endswith(".dag"))
                call = deco if isinstance(deco, ast.Call) else ast.Call(func=deco, args=[], keywords=[])
                d = self.new_dag(call, default_id=st.name, doc=ast.get_docstring(st))
                self.walk(d, st.body, scope={})
                return
        if isinstance(st, (ast.If, ast.Try)):
            for s in getattr(st, "body", []) + getattr(st, "orelse", []):
                self._discover(s)

    def new_dag(self, call, default_id=None, doc=None):
        kw = {k.arg: k.value for k in call.keywords if k.arg}
        dag_id = self.strval(kw.get("dag_id")) or (self.strval(call.args[0]) if call.args else None) or default_id
        if not dag_id:
            dag_id = os.path.basename(self.path)[:-3]
        d = Dag(dag_id)
        for key in ("schedule", "schedule_interval", "timetable"):
            if key in kw:
                d.schedule = self.schedule_kind(kw[key])
                break
        desc = self.strval(kw.get("description")) or self.strval(kw.get("doc_md")) or doc or ast.get_docstring(self.tree)
        d.description = desc
        for cbk in ("on_failure_callback", "on_success_callback", "sla_miss_callback"):
            if cbk in kw:
                d.callbacks.add(cbk)
        da = kw.get("default_args")
        if isinstance(da, ast.Name):
            name = da.id
            for st in self.tree.body:
                if isinstance(st, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in st.targets):
                    da = st.value
                    break
        if isinstance(da, ast.Dict):
            for k in da.keys:
                if isinstance(k, ast.Constant) and k.value in ("on_failure_callback", "on_retry_callback"):
                    d.callbacks.add(k.value)
        self.dags.append(d)
        return d

    def schedule_kind(self, node):
        if isinstance(node, ast.Constant):
            if node.value is None:
                return None
            v = str(node.value)
            if v in ("@once",):
                return ("schedule", v)
            if v == "@continuous":
                return ("schedule", v)
            return ("schedule", v)
        name = dotted(node) or ""
        txt = ast.unparse(node)
        if re.search(r"Asset|Dataset|AssetAlias|AssetWatcher", txt) or isinstance(node, (ast.List, ast.BinOp)) and re.search(r"Asset|Dataset|\[", txt):
            if "Timetable" in txt and ("Asset" in txt or "Dataset" in txt):
                return ("schedule+event", "asset-or-time")
            return ("event", "asset")
        if "timedelta" in txt or "Timetable" in txt or "cron" in txt.lower() or name:
            return ("schedule", oc.trim(txt, 60))
        return ("schedule", oc.trim(txt, 60))

    # ---- body walk -----------------------------------------------------------------------
    def add_node(self, d, base_id, ntype, category, effects, summary, group=None, extra=None):
        nid = base_id or ntype
        if group:
            nid = f"{group}.{nid}" if not nid.startswith(group + ".") else nid
        k, i = nid, 1
        while k in d.nodes:
            k = f"{nid}__{i}"; i += 1
        d.nodes[k] = {"id": k, "type": ntype, "category": category, "effects": effects,
                      "summary": summary, "_extra": extra or {}}
        if group:
            d.groups[group]["members"].append(k)
        return k

    def classify_operator(self, cls, kw):
        short = cls.split(".")[-1]
        mod = self.class_module(cls)
        connector = None
        m = re.match(r"airflow\.providers\.(.+?)\.(operators|sensors|transfers|decorators|triggers|hooks|notifications)\.([a-z0-9_]+)", mod)
        if m and not m.group(1).startswith("standard") and not m.group(1).startswith("common.compat"):
            connector = m.group(1).replace(".", "-") + ":" + m.group(3)
        async_kind = None
        if short in HITL_OPS:
            cat, eff, async_kind = "human", "external", "wait"
        elif short in BRANCH_OPS:
            cat, eff = "condition", "none"
        elif short in SUBDAG_OPS:
            cat, eff = "subworkflow", "external"
        elif short in SENSOR_TIME:
            cat, eff, async_kind = "wait", "none", "wait"
        elif short.endswith("Sensor") or short.endswith("SensorAsync") or "Sensor" in short:
            cat, eff = "wait", "read"
            dfr = kw.get("deferrable")
            async_kind = "event" if (short.endswith("Async") or (isinstance(dfr, ast.Constant) and dfr.value)) else "poll"
            if short in ("ExternalTaskSensor", "ExternalTaskSensorAsync"):
                async_kind = "event"
        elif short in ("EmptyOperator", "DummyOperator", "LatestOnlyOperator"):
            cat, eff = ("condition", "none") if short == "LatestOnlyOperator" else ("other", "none")
        elif short in CODE_OPS:
            cat = "code"
            eff = "external" if short in EXTERNAL_CODE else "none"
        elif MODEL_RX.search(short) or (connector and MODEL_RX.search(connector)):
            cat, eff = "model", "external"
        elif re.search(r"(?i)email|slack|discord|telegram|pagerduty|opsgenie|sendgrid|teams|apprise|notif", short):
            cat, eff = "action", "external"
        elif re.search(r"(?i)check|validat|assert", short) and "SQL" in short.upper():
            cat, eff = "action", "read"
        else:
            cat, eff = "action", oc.effects_from_name(short.replace("Operator", "").replace("Async", ""))
        return cat, eff, connector, async_kind

    def walk(self, d, body, scope, group=None, in_loop=False):
        for st in body:
            self.stmt(d, st, scope, group, in_loop)

    def stmt(self, d, st, scope, group, in_loop):
        if isinstance(st, ast.Assign):
            refs = self.expr(d, st.value, scope, group, in_loop)
            for t in st.targets:
                self.bind(t, refs, scope)
        elif isinstance(st, ast.AnnAssign) and st.value is not None:
            self.bind(st.target, self.expr(d, st.value, scope, group, in_loop), scope)
        elif isinstance(st, ast.Expr):
            self.expr(d, st.value, scope, group, in_loop)
        elif isinstance(st, ast.Return) and st.value is not None:
            scope["__return__"] = self.expr(d, st.value, scope, group, in_loop)
        elif isinstance(st, (ast.With, ast.AsyncWith)):
            gid = None
            for item in st.items:
                cname = (dotted(item.context_expr) or "").split(".")[-1] if isinstance(item.context_expr, ast.Call) else ""
                if cname == "TaskGroup":
                    call = item.context_expr
                    kw = {k.arg: k.value for k in call.keywords if k.arg}
                    gname = self.strval(kw.get("group_id")) or (self.strval(call.args[0]) if call.args else None) or "group"
                    gid = f"{group}.{gname}" if group else gname
                    d.groups.setdefault(gid, {"members": [], "parent": group})
                    if group:
                        d.groups[group]["members"].append(gid)
                    if item.optional_vars is not None:
                        self.bind(item.optional_vars, [gid], scope)
                elif self.is_dag_call(item.context_expr):
                    pass
                else:
                    self.expr(d, item.context_expr, scope, group, in_loop)
            self.walk(d, st.body, scope, gid or group, in_loop)
        elif isinstance(st, (ast.For, ast.AsyncFor, ast.While)):
            d.parse_time_loops += 1
            if isinstance(st, (ast.For, ast.AsyncFor)):
                self.bind(st.target, [], scope)
            self.walk(d, st.body, scope, group, True)
            self.walk(d, st.orelse, scope, group, in_loop)
        elif isinstance(st, ast.If):
            self.walk(d, st.body, scope, group, in_loop)
            self.walk(d, st.orelse, scope, group, in_loop)
        elif isinstance(st, ast.Try):
            self.walk(d, st.body + st.orelse + st.finalbody, scope, group, in_loop)
        elif isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
            k = self.deco_kind(st)
            if k:
                self.taskfns[st.name] = (k, st)

    def bind(self, target, refs, scope):
        if isinstance(target, ast.Name):
            scope[target.id] = list(refs or [])
        elif isinstance(target, (ast.Tuple, ast.List)):
            for t in target.elts:
                self.bind(t, refs, scope)

    def lookup(self, name, scope):
        return scope.get(name)

    def connect(self, d, a, b, kind="control"):
        for x in a or []:
            for y in b or []:
                if x != y:
                    d.edges.append({"from": x, "to": y, "kind": kind})

    def expr(self, d, node, scope, group, in_loop):
        """Evaluate expression; return list of task/group ids it denotes (or [])."""
        if node is None:
            return []
        if isinstance(node, ast.Name):
            return list(scope.get(node.id, []))
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.RShift, ast.LShift)):
            left = self.expr(d, node.left, scope, group, in_loop)
            right = self.expr(d, node.right, scope, group, in_loop)
            if isinstance(node.op, ast.RShift):
                self.connect(d, left, right)
            else:
                self.connect(d, right, left)
            return right
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            out = []
            for e in node.elts:
                out += self.expr(d, e, scope, group, in_loop)
            return out
        if isinstance(node, ast.Starred):
            return self.expr(d, node.value, scope, group, in_loop)
        if isinstance(node, (ast.ListComp, ast.GeneratorExp, ast.SetComp)):
            d.parse_time_loops += 1
            for gen in node.generators:
                self.bind(gen.target, [], scope)
            return self.expr(d, node.elt, scope, group, True)
        if isinstance(node, ast.DictComp):
            return self.expr(d, node.value, scope, group, True)
        if isinstance(node, ast.Dict):
            out = []
            for v in node.values:
                out += self.expr(d, v, scope, group, in_loop)
            return out
        if isinstance(node, ast.Subscript):
            return self.expr(d, node.value, scope, group, in_loop)
        if isinstance(node, ast.Attribute):
            base = self.expr(d, node.value, scope, group, in_loop)
            return base if node.attr in ("output", "outputs") or base else []
        if isinstance(node, ast.Call):
            return self.call(d, node, scope, group, in_loop)
        if isinstance(node, ast.IfExp):
            return self.expr(d, node.body, scope, group, in_loop) + self.expr(d, node.orelse, scope, group, in_loop)
        if isinstance(node, ast.JoinedStr):
            out = []
            for v in node.values:
                if isinstance(v, ast.FormattedValue):
                    out += self.expr(d, v.value, scope, group, in_loop)
            return out
        return []

    def arg_refs(self, d, call, scope, group, in_loop):
        refs = []
        for a in call.args:
            refs += self.expr(d, a, scope, group, in_loop)
        for k in call.keywords:
            if k.arg in ("task_id", "dag", "trigger_rule", "retries"):
                continue
            refs += self.expr(d, k.value, scope, group, in_loop)
        return refs

    def call(self, d, node, scope, group, in_loop):
        fn = node.func
        fname = dotted(fn) or ""
        last = fname.split(".")[-1]
        # chaining helpers
        if last in ("chain", "chain_linear"):
            parts = [self.expr(d, a, scope, group, in_loop) for a in node.args]
            for a, b in zip(parts, parts[1:]):
                if last == "chain" and len(a) == len(b) and len(a) > 1:
                    for x, y in zip(a, b):
                        self.connect(d, [x], [y])
                else:
                    self.connect(d, a, b)
            return parts[-1] if parts else []
        if last == "cross_downstream" and len(node.args) >= 2:
            a = self.expr(d, node.args[0], scope, group, in_loop)
            b = self.expr(d, node.args[1], scope, group, in_loop)
            self.connect(d, a, b)
            return b
        if isinstance(fn, ast.Attribute) and fn.attr in ("set_downstream", "set_upstream"):
            base = self.expr(d, fn.value, scope, group, in_loop)
            other = []
            for a in node.args:
                other += self.expr(d, a, scope, group, in_loop)
            if fn.attr == "set_downstream":
                self.connect(d, base, other)
            else:
                self.connect(d, other, base)
            return base
        if isinstance(fn, ast.Attribute) and fn.attr in ("as_teardown", "as_setup"):
            base = self.expr(d, fn.value, scope, group, in_loop)
            for b in base:
                if b in d.nodes:
                    d.nodes[b]["_extra"]["role"] = "teardown" if fn.attr == "as_teardown" else "setup"
            kw = {k.arg: k.value for k in node.keywords if k.arg}
            if "setups" in kw:
                self.connect(d, self.expr(d, kw["setups"], scope, group, in_loop), base)
            return base
        # TaskFlow: f(...), f.override(...)(...), f.expand(...), f.partial(...).expand(...)
        root, mods, override_kw = fn, [], {}
        while True:
            if isinstance(root, ast.Call) and isinstance(root.func, ast.Attribute) and root.func.attr in ("override", "partial"):
                mods.append(root.func.attr)
                if root.func.attr == "override":
                    override_kw = {k.arg: k.value for k in root.keywords if k.arg}
                root = root.func.value
            elif isinstance(root, ast.Attribute) and root.attr in ("expand", "expand_kwargs", "override", "partial"):
                mods.append(root.attr)
                root = root.value
            elif isinstance(root, ast.Call) and isinstance(root.func, ast.Attribute) and root.func.attr in ("expand", "expand_kwargs"):
                mods.append(root.func.attr); root = root.func.value
            else:
                break
        rname = root.id if isinstance(root, ast.Name) else None
        if rname and rname in self.taskfns:
            kind, fdef = self.taskfns[rname]
            if kind.startswith("dag"):
                return []
            if kind.startswith("task_group"):
                gname = self.strval(override_kw.get("group_id")) or rname
                gid = f"{group}.{gname}" if group else gname
                k, i = gid, 1
                while k in d.groups:
                    k = f"{gid}__{i}"; i += 1
                gid = k
                d.groups[gid] = {"members": [], "parent": group}
                if group:
                    d.groups[group]["members"].append(gid)
                inner = dict(scope)
                argrefs = []
                for p, a in zip(fdef.args.args, node.args):
                    r = self.expr(d, a, scope, group, in_loop); argrefs += r
                    inner[p.arg] = r
                for kwd in node.keywords:
                    if kwd.arg:
                        r = self.expr(d, kwd.value, scope, group, in_loop); argrefs += r
                        inner[kwd.arg] = r
                if "expand" in mods or "expand_kwargs" in mods:
                    d.mapped += 1
                self.walk(d, fdef.body, inner, gid, in_loop)
                return [gid]
            return [self.taskflow_node(d, node, kind, fdef, mods, override_kw, scope, group, in_loop)]
        # Operator instantiation (possibly .partial(...).expand(...))
        ocall = node
        cls = fname
        mapped = False
        if isinstance(fn, ast.Attribute) and fn.attr in ("expand", "expand_kwargs") and isinstance(fn.value, ast.Call) \
                and isinstance(fn.value.func, ast.Attribute) and fn.value.func.attr == "partial":
            ocall = fn.value
            cls = dotted(fn.value.func.value) or ""
            mapped = True
        short = cls.split(".")[-1]
        mod = self.class_module(cls)
        if short and (short.endswith(("Operator", "Sensor", "SensorAsync", "OperatorAsync")) or
                      (mod.startswith("airflow.") and ("operators" in mod or "sensors" in mod) and short[:1].isupper())):
            return [self.operator_node(d, ocall, node if mapped else None, short, cls, scope, group, in_loop, mapped)]
        # unknown call: still evaluate arguments to find nested task creation
        out = []
        for a in node.args:
            out += self.expr(d, a, scope, group, in_loop)
        for k in node.keywords:
            out += self.expr(d, k.value, scope, group, in_loop)
        if isinstance(fn, ast.Attribute):
            out += self.expr(d, fn.value, scope, group, in_loop)
        return out if last in ("XComArg", "list", "tuple", "zip") else []

    def taskflow_node(self, d, node, kind, fdef, mods, override_kw, scope, group, in_loop):
        name = self.strval(override_kw.get("task_id")) or fdef.name
        sub = kind.split(".", 1)[1] if "." in kind else ""
        body_txt = ast.unparse(fdef)
        connector, async_kind = None, None
        if kind.startswith("setup") or kind.startswith("teardown"):
            cat, eff = ("error-handler" if kind.startswith("teardown") else "code"), "none"
        elif sub in ("branch", "short_circuit", "branch_virtualenv", "branch_external_python", "llm_branch") or sub.startswith("branch"):
            cat, eff = "condition", "none"
        elif sub in ("sensor",):
            cat, eff, async_kind = "wait", "read", "poll"
        elif sub in ("llm", "llm_sql", "agent", "llm_branch", "llm_file_analysis", "llm_schema_compare") or sub.startswith("llm") or sub.startswith("agent"):
            cat, eff = "model", "external"
        elif sub in ("bash", "docker", "kubernetes", "virtualenv", "external_python", "pyspark", "kubernetes_cmd", "snowpark", "sql", "run_if", "skip_if", "databricks"):
            cat, eff = "code", "external" if sub in ("bash", "docker", "kubernetes", "pyspark", "kubernetes_cmd", "snowpark", "sql", "databricks") else "none"
        else:
            cat, eff = "code", "none"
            if re.search(r"Hook\(|requests\.|urlopen|boto3|httpx|smtplib", body_txt):
                eff = "external"
            if MODEL_RX.search(body_txt) and re.search(r"(?i)openai|cohere|bedrock|anthropic|generative|llm", body_txt):
                cat = "model"
        hooks = set(re.findall(r"\b([A-Z][A-Za-z0-9]+Hook)\(", body_txt))
        for h in hooks:
            m = self.class_module(h)
            mm = re.match(r"airflow\.providers\.(.+?)\.hooks\.([a-z0-9_]+)", m)
            connector = (mm.group(1).replace(".", "-") + ":" + mm.group(2)) if mm else None
        mapped = "expand" in mods or "expand_kwargs" in mods
        if mapped:
            d.mapped += 1
        summ = f"@{kind} {fdef.name}" + (" (mapped .expand)" if mapped else "") + (" (parse-time loop)" if in_loop else "")
        doc = ast.get_docstring(fdef)
        if doc:
            summ += ": " + doc
        nid = self.add_node(d, name, f"@{kind}", cat, eff, summ, group,
                            {"connector": connector, "async": async_kind, "mapped": mapped,
                             "role": "teardown" if kind.startswith("teardown") else ("setup" if kind.startswith("setup") else None)})
        if kind.startswith("teardown"):
            d.teardowns += 1
        if kind.startswith("setup"):
            d.setups += 1
        refs = self.arg_refs(d, node, scope, group, in_loop)
        self.connect(d, refs, [nid], "data")
        return nid

    def operator_node(self, d, call, expand_call, short, cls, scope, group, in_loop, mapped):
        kw = {k.arg: k.value for k in call.keywords if k.arg}
        tid = self.strval(kw.get("task_id")) or short
        cat, eff, connector, async_kind = self.classify_operator(cls, kw)
        tr = kw.get("trigger_rule")
        trig = None
        if tr is not None:
            trig = self.strval(tr) or (dotted(tr) or "").split(".")[-1].lower()
        bits = [short]
        if trig:
            bits.append(f"trigger_rule={trig}")
        for k in ("retries", "deferrable", "mode", "wait_for_completion", "poke_interval", "timeout"):
            if k in kw:
                try:
                    bits.append(f"{k}={oc.trim(ast.unparse(kw[k]), 30)}")
                except Exception:
                    pass
        if mapped:
            bits.append("mapped .partial().expand()")
            d.mapped += 1
        if in_loop:
            bits.append("parse-time loop")
        nid = self.add_node(d, tid, short, cat, eff, "; ".join(bits), group,
                            {"connector": connector, "async": async_kind, "trigger_rule": trig, "mapped": mapped})
        # data edges: .output / XComArg / task refs passed as arguments; xcom_pull in templates
        refs = []
        for k, v in kw.items():
            if k in ("dag", "task_id", "trigger_rule", "task_group"):
                continue
            refs += self.expr(d, v, scope, group, in_loop)
        for a in call.args:
            refs += self.expr(d, a, scope, group, in_loop)
        if expand_call is not None:
            refs += self.arg_refs(d, expand_call, scope, group, in_loop)
        self.connect(d, [r for r in refs if r in d.nodes or r in d.groups], [nid], "data")
        txt = ast.unparse(call)
        for m in re.finditer(r"xcom_pull\(\s*(?:task_ids\s*=\s*)?\[?['\"]([A-Za-z0-9_.\-]+)['\"]", txt):
            src = m.group(1)
            cand = [n for n in d.nodes if n == src or n.endswith("." + src)]
            if cand:
                self.connect(d, cand[:1], [nid], "data")
        return nid


def finalize(d):
    """Expand TaskGroup references into member roots/leaves; drop group pseudo-ids."""
    def members_closure(g):
        out = []
        for m in d.groups[g]["members"]:
            out += members_closure(m) if m in d.groups else [m]
        return out

    def ends(g, which):
        mem = set(members_closure(g))
        inner = [e for e in d.edges if e["from"] in mem and e["to"] in mem]
        if which == "roots":
            res = [m for m in mem if not any(e["to"] == m for e in inner)]
        else:
            res = [m for m in mem if not any(e["from"] == m for e in inner)]
        return sorted(res)

    edges = []
    for e in d.edges:
        srcs = ends(e["from"], "leaves") if e["from"] in d.groups else [e["from"]]
        dsts = ends(e["to"], "roots") if e["to"] in d.groups else [e["to"]]
        for s in srcs:
            for t in dsts:
                if s in d.nodes and t in d.nodes and s != t:
                    edges.append({"from": s, "to": t, "kind": e["kind"]})
    # trigger rules / teardown: error edges into failure handlers
    for e in edges:
        tgt = d.nodes[e["to"]]
        tr = tgt["_extra"].get("trigger_rule")
        if tr in ("one_failed", "all_failed", "one_done") or (tr or "").endswith("failed"):
            e["kind"] = "error"
            tgt["category"] = "error-handler"
    for n in d.nodes.values():
        tr = n["_extra"].get("trigger_rule")
        if n["_extra"].get("role") == "teardown":
            n["category"] = "error-handler"
        if n["category"] == "other" and tr in ("all_done", "none_failed", "none_failed_min_one_success", "one_success", "none_skipped", "all_done_setup_success"):
            n["category"] = "merge"
    indeg = {}
    for e in edges:
        indeg[e["to"]] = indeg.get(e["to"], 0) + 1
    for n in d.nodes.values():
        if n["category"] == "other" and indeg.get(n["id"], 0) > 1:
            n["category"] = "merge"
    return oc.dedupe_edges(edges)


def to_item(path, d, pkg_dir):
    man = BY_FILE[pkg_dir]
    member = path.split(f"/extracted/{pkg_dir}/", 1)[1]
    nodes_raw = list(d.nodes.values())
    edges = finalize(d)
    async_kinds, connectors, guards, needs = [], [], 0, []
    for n in nodes_raw:
        ex = n["_extra"]
        if ex.get("async"):
            async_kinds.append(ex["async"])
        if ex.get("connector"):
            connectors.append(ex["connector"])
        if ex.get("trigger_rule") and ex["trigger_rule"] not in ("all_success",):
            guards += 1
        if n["type"] in BRANCH_OPS and n["category"] != "condition":
            guards += 1  # e.g. HITLBranchOperator: a human choice that is also a branch point
    nodes = [{k: v for k, v in n.items() if k != "_extra"} for n in nodes_raw]
    if d.schedule:
        sk, sv = d.schedule
        trig = {"id": "__trigger__", "type": f"schedule:{sv}" if sk == "schedule" else f"{sk}:{sv}",
                "category": "trigger", "effects": "none", "summary": f"DAG trigger ({sk}: {sv})"}
        roots = [n["id"] for n in nodes if not any(e["to"] == n["id"] for e in edges)]
        nodes.insert(0, trig)
        edges = [{"from": "__trigger__", "to": r, "kind": "control"} for r in roots] + edges
        async_kinds += ["schedule"] if sk == "schedule" else (["event"] if sk == "event" else ["schedule", "event"])
        needs.append("triggers")
    cats = [n["category"] for n in nodes]
    if any(e["kind"] == "error" for e in edges) or d.callbacks:
        needs.append("error-branches")
    if "subworkflow" in cats:
        needs.append("subworkflow-call")
    if "event" in async_kinds:
        needs.append("signals")
    if d.teardowns:
        needs.append("setup-teardown(as all_resolved join; teardown scoping is an extension)")
    loops = d.mapped
    text = " ".join([d.dag_id, member, " ".join(connectors), " ".join(n["type"] for n in nodes)])
    base_dom = ["data-orchestration"]
    features = oc.compute_features(nodes, edges, guards=guards, loops=loops, async_kinds=async_kinds,
                                   connectors=connectors, domains=oc.domains_for(text, base_dom))
    is_system = "/tests/system/" in "/" + member
    notes = (f"Static AST extraction (not executed). TaskGroups expanded: {len(d.groups)}; dynamic task "
             f"mapping (.expand) sites: {d.mapped}; parse-time Python loops/comprehensions: {d.parse_time_loops} "
             f"(replicated at parse time, each creation site counted once). Callbacks: {sorted(d.callbacks) or 'none'}. "
             "Retries map to IR retry; sensors map to loop(wait+check) unless deferrable (signal).")
    ir = oc.ir_verdict(features, needs=needs, notes=notes)
    oracle = ({"kind": "test-profile", "notes": "Airflow provider system test (tests/system): run via pytest with a watcher task that fails the run if any task fails; needs real external credentials/resources, so not runnable offline."}
              if is_system else {"kind": "none", "notes": "Example DAG shipped with Airflow; no success oracle beyond task states."})
    lic = man.get("licenseExpression") or "Apache-2.0"
    sid = f"{man['package']}/{member.replace('/tests/system/', '/').replace('src/airflow/example_dags/', 'example_dags/').replace('airflow/example_dags/', 'example_dags/')}#{d.dag_id}"
    sid = re.sub(r"\.py#", "#", sid)
    return oc.make_item(
        platform="airflow", sid=sid, url=f"{man['url']}#{member}",
        revision=f"{man['package']}=={man['version']} sdist sha256:{man['sha256']}",
        retrieved=man["retrievedAt"], license=lic,
        license_evidence=f"PyPI metadata license_expression/classifiers for {man['package']}=={man['version']}; LICENSE file in sdist",
        redistributable=True, raw_path=path, title=f"{d.dag_id} ({man['package'].replace('apache-airflow-providers-', 'provider:')})",
        description=d.description or "", desc_provenance="original", nodes=nodes, edges=edges,
        features=features, ir=ir, oracle=oracle)


def main():
    out = sys.argv[1]
    items, errors = [], []
    files = sorted(glob.glob(f"{ROOT}/extracted/*/**/example_dags/*.py", recursive=True) +
                   glob.glob(f"{ROOT}/extracted/*/**/tests/system/**/example_*.py", recursive=True))
    files = sorted(set(files))
    for p in files:
        if os.path.basename(p) == "__init__.py":
            continue
        pkg_dir = p.split("/extracted/", 1)[1].split("/", 1)[0]
        try:
            src = open(p, encoding="utf-8").read()
            ex = Extractor(p, src)
            dags = ex.run()
            for d in dags:
                if not d.nodes:
                    errors.append({"file": p, "dag": d.dag_id, "error": "no tasks extracted"})
                    continue
                items.append(to_item(p, d, pkg_dir))
        except Exception as e:  # keep raw failures
            errors.append({"file": p, "error": f"{type(e).__name__}: {e}"})
    json.dump({"items": items, "errors": errors, "files": len(files)}, open(out, "w"))
    print(f"airflow: files={len(files)} items={len(items)} errors={len(errors)}")


if __name__ == "__main__":
    main()
