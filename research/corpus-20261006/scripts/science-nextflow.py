"""Static, heuristic analysis of Nextflow DSL2 pipelines into a process-level dataflow graph.

Nothing is executed: .nf files are read as text. The analysis
  * strips comments (string-aware) and blanks string literals for structure detection,
  * resolves `include { A; B as C } from '<path>'` (modules -> process, subworkflows/workflows ->
    parsed recursively and INLINED with their take: inputs bound positionally to the call's
    arguments and their emit: names mapped to inner channel sources),
  * walks each workflow's main: section statement by statement (continuation lines joined),
    tracking channel variables (assignment, .set{}, .tap{}), process/sub-workflow calls and
    if/else chains (each chain gating >=1 process is one decision point; gated nodes carry it),
  * turns `.branch{}` / `.multiMap{}` into condition nodes and recognises nf-schema validation,
    samplesheet parsing and completion/onError hooks as synthetic nodes,
  * counts dataflow operators (join, groupTuple, combine, collect, mix, flatten, splitX, ...).
`versions` channels (software-version provenance plumbing) are ignored when wiring edges.
Known limitations: dynamic process selection via closures, channel references hidden in helper
functions, `.out[0]` positional emits of sub-workflows (mapped to all emits), and features of
Nextflow syntax newer than the parser (typed workflows/record types) are approximated.
"""
import os, re

CALL_RX = re.compile(r"(?<![\w.$])([A-Za-z_]\w*)\s*\(")
IDENT_RX = re.compile(r"(?<![\w$])([A-Za-z_]\w*)((?:\s*\.\s*out)(?:\s*\.\s*(\w+)|\s*\[\s*\d+\s*\])?)?")
OPS = ["join", "groupTuple", "combine", "collect", "mix", "flatten", "flatMap", "transpose", "splitCsv", "splitFasta",
       "splitFastq", "splitText", "branch", "multiMap", "filter", "map", "cross", "concat", "collectFile", "toList",
       "toSortedList", "unique", "distinct", "first", "last", "until", "recurse", "buffer", "collate", "merge",
       "ifEmpty", "reduce", "count", "dump", "view", "subscribe"]
OP_RX = re.compile(r"\.\s*(" + "|".join(OPS) + r")\b")
FANOUT_OPS = {"flatten", "flatMap", "transpose", "splitCsv", "splitFasta", "splitFastq", "splitText"}
CHANNEL_FACTORY_RX = re.compile(r"(?:Channel|channel)\s*\.\s*(fromFilePairs|fromPath|fromSRA|fromList|of|value|watchPath|fromLineage|topic|empty|fromSamplesheet)\b")


def strip_comments(src):
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('"""', i) or src.startswith("'''", i):
            q = src[i:i + 3]
            j = src.find(q, i + 3)
            j = n if j < 0 else j + 3
            out.append(src[i:j]); i = j; continue
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1]); i = j + 1; continue
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            seg = src[i: (n if j < 0 else j + 2)]
            out.append("\n" * seg.count("\n"))
            i = n if j < 0 else j + 2
            continue
        out.append(c); i += 1
    return "".join(out)


def blank_strings(src):
    """Replace string-literal contents (and slashy regex literals after ~) by nothing, keeping quotes."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('"""', i) or src.startswith("'''", i):
            q = src[i:i + 3]
            j = src.find(q, i + 3)
            j = n if j < 0 else j + 3
            out.append(q + q + "\n" * src[i:j].count("\n")); i = j; continue
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            out.append(c + c); i = j + 1; continue
        if c == "~":
            k = i + 1
            while k < n and src[k] == " ":
                k += 1
            if k < n and src[k] == "/":
                j = k + 1
                while j < n and src[j] != "/" and src[j] != "\n":
                    j += 2 if src[j] == "\\" else 1
                out.append("~''"); i = j + 1; continue
        out.append(c); i += 1
    return "".join(out)


def match_close(s, i, o="{", c="}"):
    d = 0
    for j in range(i, len(s)):
        if s[j] == o:
            d += 1
        elif s[j] == c:
            d -= 1
            if d == 0:
                return j
    return len(s) - 1


def balance(s):
    d = 0
    for ch in s:
        if ch in "([{":
            d += 1
        elif ch in ")]}":
            d -= 1
    return d


def split_top(s, sep=","):
    parts, d, cur = [], 0, []
    for ch in s:
        if ch in "([{":
            d += 1
        elif ch in ")]}":
            d -= 1
        if ch == sep and d == 0:
            parts.append("".join(cur)); cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        parts.append("".join(cur))
    return parts


class NfFile:
    def __init__(self, path):
        self.path = path
        raw = open(path, encoding="utf-8", errors="replace").read()
        self.text = strip_comments(raw)                     # strings kept (includes, script bodies)
        self.struct = blank_strings_keep_len(self.text)     # same length, string contents blanked
        self.includes = {}                                  # alias -> (orig, path)
        for m in re.finditer(r"include\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]", self.text):
            for mm in re.finditer(r"([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?", m.group(1)):
                self.includes[mm.group(2) or mm.group(1)] = (mm.group(1), m.group(2))
        self.workflows, self.processes = {}, {}
        for m in re.finditer(r"(?m)^\s*(workflow|process)\s+([A-Za-z_]\w*)?\s*\{", self.struct):
            b = m.end() - 1
            e = match_close(self.struct, b)
            name = m.group(2) or ""
            (self.workflows if m.group(1) == "workflow" else self.processes)[name] = {
                "struct": self.struct[b + 1:e], "text": self.text[b + 1:e], "start": b}


def blank_strings_keep_len(src):
    """Same as blank_strings but preserves length (replaces string contents by spaces)."""
    out, i, n = list(src), 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('"""', i) or src.startswith("'''", i):
            j = src.find(src[i:i + 3], i + 3)
            j = n if j < 0 else j + 3
            for k in range(i + 3, max(i + 3, j - 3)):
                if out[k] != "\n":
                    out[k] = " "
            i = j; continue
        if c in "\"'":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            for k in range(i + 1, min(j, n)):
                out[k] = " "
            i = j + 1; continue
        if c == "~":
            k = i + 1
            while k < n and src[k] == " ":
                k += 1
            if k < n and src[k] == "/":
                j = k + 1
                while j < n and src[j] != "/" and src[j] != "\n":
                    j += 2 if src[j] == "\\" else 1
                for q in range(k, min(j + 1, n)):
                    out[q] = " "
                i = j + 1; continue
        i += 1
    return "".join(out)


def sections(body):
    """Split a workflow body into take/main/emit/publish sections."""
    labels = list(re.finditer(r"(?m)^\s*(take|main|emit|publish)\s*:\s*", body))
    if not labels:
        return {"main": body}
    out = {}
    pre = body[:labels[0].start()]
    if pre.strip():
        out["main"] = pre
    for i, m in enumerate(labels):
        end = labels[i + 1].start() if i + 1 < len(labels) else len(body)
        out[m.group(1)] = out.get(m.group(1), "") + "\n" + body[m.end():end]
    return out


def logical_statements(text):
    """Yield ('stmt', text) | ('open', kind) | ('close',) events from a block of Groovy statements."""
    lines = [l.strip() for l in text.split("\n")]
    lines = [l for l in lines if l]
    buf, ctrl = [], False
    i = 0
    cont_start = (".", "?", ":", "|", "+", "&&", "||", "*")
    cont_end = ("=", ",", "(", ".", "?", ":", "+", "&&", "||", "|", "->", "[", "{")
    while i < len(lines):
        s = lines[i]
        i += 1
        if not buf:
            if s == "}":
                yield ("close",); continue
            m = re.match(r"^\}\s*else\s+if\s*\(", s) or re.match(r"^else\s+if\s*\(", s)
            if m:
                if s.startswith("}"):
                    yield ("close",)
                buf, ctrl = [re.sub(r"^\}\s*", "", s)], "elseif"
            elif re.match(r"^\}?\s*else\s*\{$", s):
                if s.startswith("}"):
                    yield ("close",)
                yield ("open", "else"); continue
            elif re.match(r"^if\s*\(", s):
                buf, ctrl = [s], "if"
            else:
                buf, ctrl = [s], False
        else:
            buf.append(s)
        joined = " ".join(buf)
        if ctrl:
            # control header complete when the condition parens close and the line ends with '{'
            head = re.sub(r"^(else\s+)?if\s*", "", joined)
            if head.startswith("("):
                e = match_close(head, 0, "(", ")")
                if e < len(head) - 1 or balance(head) == 0:
                    rest = head[e + 1:].strip()
                    if rest == "{":
                        yield ("open", ctrl); buf, ctrl = [], False; continue
                    if rest.startswith("{") and balance(rest) == 0:
                        # one-line if { ... }
                        yield ("open", ctrl)
                        for ev in logical_statements(rest[1:rest.rfind("}")].replace(";", "\n")):
                            yield ev
                        yield ("close",); buf, ctrl = [], False; continue
                    if rest and not rest.startswith("{") and balance(head) == 0:
                        yield ("open", ctrl); yield ("stmt", rest); yield ("close",)
                        buf, ctrl = [], False; continue
            if balance(joined) > 1 or (balance(joined) == 1 and not joined.endswith("{")):
                continue
            continue
        nxt = lines[i] if i < len(lines) else ""
        if balance(joined) <= 0 and not nxt.startswith(cont_start) and not joined.endswith(cont_end):
            yield ("stmt", joined)
            buf = []
    if buf:
        yield ("stmt", " ".join(buf))


class Graph:
    def __init__(self):
        self.nodes, self.edges = {}, []
        self.guards = set()          # decision-point ids that gate >= 1 node
        self.chain_counter = 0
        self.ops = {}
        self.fanout = 0
        self.subworkflow_calls = 0
        self.hooks = set()
        self.unresolved = set()
        self.packages = set()
        self.services = set()
        self.channel_factories = set()
        self.notes = set()

    def add(self, nid, ntype, cat, eff, summary, guards=()):
        k, base = nid, nid
        n = 2
        while k in self.nodes:
            k = f"{base}#{n}"; n += 1
        self.nodes[k] = {"id": k, "type": ntype, "category": cat, "effects": eff, "summary": summary}
        for g in guards:
            self.guards.add(g)
        return k

    def edge(self, a, b, kind="data"):
        if a in self.nodes and b in self.nodes and a != b:
            self.edges.append({"from": a, "to": b, "kind": kind})


class Scope:
    def __init__(self, prefix, takes=None):
        self.prefix = prefix
        self.vars = {}
        self.recs = {}       # var -> callable name whose whole output record was bound to the var
        self.takes = takes or {}
        self.calls = {}      # callable name -> {"kind": process|workflow, "node": id} | {"emits": {...}, "all": set}


class Analyzer:
    def __init__(self, repo, classify, max_depth=8):
        self.repo = os.path.realpath(repo)
        self.files = {}
        self.g = Graph()
        self.classify = classify
        self.max_depth = max_depth

    def load(self, path):
        path = os.path.realpath(path)
        if not path.startswith(self.repo):
            return None
        if path not in self.files:
            self.files[path] = NfFile(path) if os.path.isfile(path) else None
        return self.files[path]

    def resolve(self, nf, alias):
        """-> ("process", info) | ("workflow", (NfFile, name)) | ("function", name) | None"""
        if alias in nf.processes:
            return ("process", {"file": nf, "name": alias, "path": nf.path})
        if alias in nf.workflows and alias:
            return ("workflow", (nf, alias))
        if alias not in nf.includes:
            return None
        orig, rel = nf.includes[alias]
        if rel.startswith("plugin/"):
            return ("function", orig)
        base = os.path.normpath(os.path.join(os.path.dirname(nf.path), rel))
        cands = [base + ".nf", os.path.join(base, "main.nf"), base] if not base.endswith(".nf") else [base]
        target = None
        for c in cands:
            if os.path.isfile(c):
                target = self.load(c)
                if target:
                    break
        if target:
            if orig in target.workflows:
                return ("workflow", (target, orig))
            if orig in target.processes:
                return ("process", {"file": target, "name": orig, "path": target.path, "rel": rel})
            if orig[:1].islower():
                return ("function", orig)
        if orig[:1].islower():
            return ("function", orig)
        # module not checked out (nf-core/modules are not in the sparse checkout): a process
        return ("process", {"file": None, "name": orig, "path": base, "rel": rel})

    # ---------------------------------------------------------------- sources
    def sources(self, expr, scope):
        out = set()
        for m in IDENT_RX.finditer(expr):
            name, outpart, emit = m.group(1), m.group(2), m.group(3)
            if "versions" in name.lower() or (emit and "versions" in emit.lower()):
                continue
            if name in scope.recs and name not in scope.vars:
                c = scope.calls.get(scope.recs[name], {"all": set(), "emits": {}})
                fm = re.match(r"\s*\.\s*(\w+)", expr[m.end():])
                if fm and fm.group(1) in c.get("emits", {}):
                    out |= c["emits"][fm.group(1)]
                else:
                    out |= c.get("all", set())
                continue
            if name in scope.calls:
                c = scope.calls[name]
                if "node" in c:
                    out.add(c["node"])
                else:
                    if emit and emit in c["emits"]:
                        out |= c["emits"][emit]
                    else:
                        out |= c["all"]
            elif name in scope.vars:
                out |= scope.vars[name]
            elif name in scope.takes:
                out |= scope.takes[name]
        return out

    # ---------------------------------------------------------------- workflow
    def run_workflow(self, nf, name, scope, guards, depth, stack):
        wf = nf.workflows.get(name)
        if wf is None:
            return {}, set()
        secs = sections(wf["struct"])
        if "main" in secs:
            self.run_block(nf, secs["main"], scope, guards, depth, stack)
        emits, all_ = {}, set()
        for kind, stmt in [(e[0], e[1] if len(e) > 1 else None) for e in logical_statements(secs.get("emit", ""))]:
            if kind != "stmt":
                continue
            m = re.match(r"^([A-Za-z_]\w*)\s*(?::\s*[\w<>\[\], ]+)?\s*=\s*(.+)$", stmt)
            if m:
                src = self.sources(m.group(2), scope)
                emits[m.group(1)] = src
            else:
                nm = re.match(r"^([A-Za-z_]\w*)", stmt)
                src = self.sources(stmt, scope)
                if nm:
                    emits[nm.group(1)] = src
            all_ |= src
        if not all_:
            # no emit section: everything produced inside is reachable
            pre = scope.prefix
            all_ = {k for k in self.g.nodes if k.startswith(pre)}
        return emits, all_

    def run_block(self, nf, text, scope, guards, depth, stack):
        gstack = list(guards)
        chain_ids = []
        last_closed = None
        for ev in logical_statements(text):
            if ev[0] == "open":
                if ev[1] == "if":
                    self.g.chain_counter += 1
                    cid = f"{scope.prefix}if{self.g.chain_counter}"
                elif ev[1] in ("else", "elseif"):
                    cid = last_closed or f"{scope.prefix}else{self.g.chain_counter}"
                chain_ids.append(cid)
                gstack.append(cid)
            elif ev[0] == "close":
                if len(gstack) > len(guards):
                    last_closed = gstack.pop()
                    chain_ids.pop()
            else:
                self.statement(nf, ev[1], scope, tuple(gstack), depth, stack)

    def statement(self, nf, s, scope, guards, depth, stack):
        g = self.g
        for op in OP_RX.findall(s):
            g.ops[op] = g.ops.get(op, 0) + 1
            if op in FANOUT_OPS:
                g.fanout += 1
            if op in ("until", "recurse"):
                g.fanout += 1
                g.notes.add("iteration-operator")
        for f in CHANNEL_FACTORY_RX.findall(s):
            g.channel_factories.add(f)
            if f in ("fromFilePairs", "fromSRA", "watchPath"):
                g.fanout += 1
        if f"workflow.onComplete" in s or "workflow.onError" in s or re.search(r"\bonComplete\s*\{|\bonError\s*\{", s):
            self.hooks(s, scope, guards)
            return
        created = set()
        # synthetic nodes for well-known functions
        if re.search(r"\bvalidateParameters\s*\(|\bvalidateParameters\b", s):
            created.add(g.add(scope.prefix + "validateParameters", "nf-schema.validateParameters", "other", "none",
                              "assert: pipeline params validated against nextflow_schema.json", guards))
        if re.search(r"\b(samplesheetToList|fromSamplesheet)\b", s):
            nid = g.add(scope.prefix + "samplesheet", "nf-schema.samplesheetToList", "transform", "read",
                        "parse + validate input samplesheet (assets/schema_input.json) into per-sample channel items", guards)
            created.add(nid)
            g.fanout += 1
        # callable invocations (inner calls first)
        calls = []
        sb = s
        for m in CALL_RX.finditer(sb):
            name = m.group(1)
            if name in ("if", "for", "while", "switch", "return", "file", "files", "log", "println", "error"):
                continue
            r = self.resolve(nf, name)
            if not r or r[0] == "function":
                if r is None and re.match(r"^[A-Z][A-Z0-9_]+$", name) and name not in ("UTILS",):
                    g.unresolved.add(name)
                continue
            p = m.end() - 1
            e = match_close(sb, p, "(", ")")
            calls.append((e, m.start(), name, sb[p + 1:e], r))
        pipe = re.findall(r"\|\s*([A-Z][A-Z0-9_]*)\b", s)
        calls.sort()
        for e, st, name, args, r in calls:
            if name in scope.calls and "node" in scope.calls[name]:
                continue
            created |= self.invoke(nf, name, args, r, scope, guards, depth, stack)
        for name in pipe:
            r = self.resolve(nf, name)
            if r and r[0] != "function" and name not in scope.calls:
                created |= self.invoke(nf, name, s.split("|")[0], r, scope, guards, depth, stack)
        # branch / multiMap -> condition node
        target = None
        m = re.match(r"^(?:def\s+)?([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$", s)
        setm = re.search(r"\.\s*(?:set|tap)\s*\{\s*([A-Za-z_]\w*)\s*\}", s)
        if m:
            target, rhs = m.group(1), m.group(2)
        elif setm:
            target, rhs = setm.group(1), s[:setm.start()]
        else:
            rhs = s
        if target and "versions" in target.lower():
            return
        if re.search(r"\.\s*(branch|multiMap)\s*\{", rhs):
            kind = re.search(r"\.\s*(branch|multiMap)\s*\{", rhs).group(1)
            pre = rhs[:re.search(r"\.\s*(branch|multiMap)\s*\{", rhs).start()]
            src = self.sources(pre, scope)
            bm = re.search(r"\.\s*(branch|multiMap)\s*\{", rhs)
            body = rhs[bm.end():match_close(rhs, bm.end() - 1)]
            labels = re.findall(r"(?m)(?:^|[;\s{])([A-Za-z_]\w*)\s*:", body)
            nid = g.add(scope.prefix + (target or "branch") + "." + kind, f"operator.{kind}",
                        "condition" if kind == "branch" else "transform", "none",
                        f"channel .{kind} into {sorted(set(labels))[:6]}", guards)
            for x in src:
                g.edge(x, nid)
            if target:
                scope.vars[target] = {nid}
            return
        if target:
            rm = re.match(r"^\s*([A-Za-z_]\w*)\s*\(", rhs)
            if rm and rm.group(1) in scope.calls and "emits" in scope.calls[rm.group(1)]:
                e = match_close(rhs, rm.end() - 1, "(", ")")
                if re.fullmatch(r"\s*(\.\s*out\s*)?", rhs[e + 1:]):
                    scope.recs[target] = rm.group(1)
                    scope.vars.pop(target, None)
                    return
            if target in scope.recs:
                del scope.recs[target]
            src = self.sources(rhs, scope)
            for c in created:
                src.add(c) if c in g.nodes and not scope.calls.get(c) else None
            if guards and target in scope.vars:
                scope.vars[target] = scope.vars[target] | src
            else:
                scope.vars[target] = src

    def invoke(self, nf, name, args, r, scope, guards, depth, stack):
        g = self.g
        created = set()
        arg_list = split_top(args)
        if r[0] == "workflow":
            tf, wname = r[1]
            key = (tf.path, wname)
            if depth >= self.max_depth or key in stack:
                nid = g.add(scope.prefix + name, "nextflow.workflow", "subworkflow", "write",
                            f"sub-workflow {wname} (not expanded: depth/cycle)", guards)
                for x in self.sources(args, scope):
                    g.edge(x, nid)
                scope.calls[name] = {"node": nid}
                return {nid}
            g.subworkflow_calls += 1
            wf = tf.workflows[wname]
            secs = sections(wf["struct"])
            take_names = []
            for ev in logical_statements(secs.get("take", "")):
                if ev[0] == "stmt":
                    mm = re.match(r"^([A-Za-z_]\w*)", ev[1])
                    if mm:
                        take_names.append(mm.group(1))
            takes = {}
            for i, t in enumerate(take_names):
                takes[t] = self.sources(arg_list[i], scope) if i < len(arg_list) else set()
            sub = Scope(scope.prefix + name + "/", takes)
            before = set(g.nodes)
            emits, all_ = self.run_workflow(tf, wname, sub, guards, depth + 1, stack | {key})
            created = set(g.nodes) - before
            if not created:
                # utility sub-workflow without processes: keep a marker only when it has a visible role
                pass
            scope.calls[name] = {"emits": emits, "all": all_}
            return created
        info = r[1]
        rel = info.get("rel") or info.get("path") or ""
        mod = re.search(r"modules/(?:nf-core|local|[\w-]+)/(.+?)(?:/main)?(?:\.nf)?$", rel.replace("\\", "/"))
        modpath = mod.group(1) if mod else (info["name"].lower())
        local = "/modules/nf-core/" not in ("/" + rel) and "modules/nf-core" not in rel
        package = modpath.split("/")[0].lower()
        body = ""
        if info.get("file") is not None and info["name"] in info["file"].processes:
            body = info["file"].processes[info["name"]].get("text") or ""
        text = f"{modpath} {info['name']} {body[:4000] if local else ''}"
        cat, eff, svcs = self.classify(text, package, curated=not local)
        if local and cat == "action":
            cat = "code"
        if re.search(r"(?m)^\s*exec\s*:", body):
            cat = "code"
        g.packages.add(package if not local else f"local:{package}")
        g.services |= set(svcs)
        typ = ("nf-core.module:" if not local else "nextflow.process:") + modpath
        summ = f"{'nf-core module' if not local else 'pipeline-local process'} {modpath} as {name}"
        if guards:
            summ += " (conditional)"
        nid = g.add(scope.prefix + name, typ, cat, eff, summ, guards)
        for x in self.sources(args, scope):
            g.edge(x, nid)
        scope.calls[name] = {"node": nid}
        return {nid}

    def hooks(self, s, scope, guards):
        g = self.g
        sinks = [k for k in g.nodes if not any(e["from"] == k for e in g.edges)]
        if "onError" in s:
            nid = g.add(scope.prefix + "onError", "nextflow.workflow.onError", "error-handler", "none",
                        "workflow.onError hook: log failure / pipeline-level error handling", guards)
            g.hooks.add("onError")
        if "onComplete" in s:
            g.hooks.add("onComplete")
            if re.search(r"completionEmail|sendMail|sendmail", s):
                nid = g.add(scope.prefix + "completionEmail", "nf-core.completionEmail", "action", "external",
                            "on completion: send summary e-mail (params.email / email_on_fail)", guards)
                g.services.add("email")
                for k in sinks:
                    g.edge(k, nid, "control")
            if re.search(r"imNotification|hook_url", s):
                nid = g.add(scope.prefix + "imNotification", "nf-core.imNotification", "action", "external",
                            "on completion: post summary to Slack/Teams webhook (params.hook_url)", guards)
                g.services.add("im-webhook")
                for k in sinks:
                    g.edge(k, nid, "control")
            if "completionSummary" in s:
                g.hooks.add("completionSummary")


def analyze_repo(repo, classify, entry_candidates=("main.nf",)):
    a = Analyzer(repo, classify)
    entry = None
    for c in entry_candidates:
        p = os.path.join(repo, c)
        if os.path.isfile(p):
            entry = a.load(p)
            break
    if entry is None:
        return None
    root = Scope("")
    name = "" if "" in entry.workflows else (sorted(entry.workflows)[0] if entry.workflows else None)
    if name is None:
        return None
    if name == "" and entry.workflows.get("", {}).get("struct", "").strip() == "":
        return None
    a.run_workflow(entry, name, root, (), 0, frozenset())
    g = a.g
    g.files_parsed = sum(1 for f in a.files.values() if f)
    return g


# ------------------------------------------------------------------------------------- DSL1
def _script_tool(body):
    m = re.search(r"(?s)(?:script|shell)\s*:.*?(?:\"\"\"|''')(.*?)(?:\"\"\"|''')", body)
    if not m:
        return ""
    for line in m.group(1).split("\n"):
        line = line.strip()
        if not line or line.startswith(("#", "def ", "if ", "echo", "mkdir", "ln ", "cp ", "mv ", "cat ", "export", "}", "{", "rm ", "touch", "printf", "zcat", "gunzip", "tar ", "$")):
            continue
        w = re.match(r"([A-Za-z][\w.+-]*)", line)
        if w:
            return w.group(1).lower()
    return ""


def analyze_dsl1(repo, classify, entry="main.nf"):
    path = os.path.join(repo, entry)
    if not os.path.isfile(path):
        return None
    nf = NfFile(path)
    if not nf.processes:
        return None
    g = Graph()
    produced, consumed, procs = {}, {}, []
    for name, p in sorted(nf.processes.items(), key=lambda kv: kv[1]["start"]):
        st, tx = p["struct"], p["text"]
        secs = {}
        labels = list(re.finditer(r"(?m)^\s*(input|output|when|script|shell|exec|stub)\s*:", st))
        for i, m in enumerate(labels):
            end = labels[i + 1].start() if i + 1 < len(labels) else len(st)
            secs[m.group(1)] = st[m.end():end]
        tool = _script_tool(tx)
        text = f"{name} {tool} {tx[:3000]}"
        cat, eff, svcs = classify(text, tool, curated=False)
        if cat == "action":
            cat = "code"
        if "exec" in secs:
            cat = "code"
        guard = ()
        if secs.get("when", "").strip():
            g.chain_counter += 1
            guard = (f"when{g.chain_counter}",)
        g.packages.add(tool or f"local:{name.lower()}")
        g.services |= set(svcs)
        nid = g.add(name, "nextflow.dsl1.process" + (f":{tool}" if tool else ""), cat, eff,
                    f"DSL1 process {name}" + (f" (runs {tool})" if tool else "") + (" (conditional: when:)" if guard else ""), guard)
        procs.append(nid)
        for v in re.findall(r"\bfrom\s+([A-Za-z_]\w*)\b", secs.get("input", "")):
            consumed.setdefault(nid, set()).add(v)
        for grp in re.findall(r"\binto\s+\(?\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)", secs.get("output", "")):
            for v in re.split(r"\s*,\s*", grp):
                produced.setdefault(v, set()).add(nid)
        if re.search(r"\bfrom\s+(file|Channel|channel)\b", secs.get("input", "")):
            pass
    # top-level channel derivations (process bodies removed)
    top = nf.struct
    for name, p in sorted(nf.processes.items(), key=lambda kv: -kv[1]["start"]):
        b = p["start"]
        e = match_close(top, b)
        top = top[:b] + "{}" + top[e + 1:]
    derive = []
    for ev in logical_statements(top):
        if ev[0] != "stmt":
            continue
        s = ev[1]
        for op in OP_RX.findall(s):
            g.ops[op] = g.ops.get(op, 0) + 1
            if op in FANOUT_OPS:
                g.fanout += 1
        for f in CHANNEL_FACTORY_RX.findall(s):
            g.channel_factories.add(f)
            if f in ("fromFilePairs", "fromSRA", "watchPath"):
                g.fanout += 1
        targets = []
        m = re.match(r"^(?:def\s+)?([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$", s)
        rhs = s
        if m:
            targets, rhs = [m.group(1)], m.group(2)
        for im in re.finditer(r"\.\s*(?:into|set|tap)\s*\{([^}]*)\}", s):
            targets += [t for t in re.split(r"[;,\s]+", im.group(1)) if t]
            rhs = s[:im.start()] if not m else rhs
        for im in re.finditer(r"\.\s*into\s*\(\s*([^)]*)\)", s):
            targets += [t for t in re.split(r"[;,\s]+", im.group(1)) if t]
        srcs = {x.group(1) for x in re.finditer(r"(?<![\w.$])([A-Za-z_]\w*)", rhs)}
        for t in targets:
            derive.append((t, srcs - {t}))
    memo = {}

    def src_of(v, seen=frozenset()):
        if v in memo:
            return memo[v]
        out = set(produced.get(v, set()))
        if v in seen:
            return out
        for t, srcs in derive:
            if t == v:
                for s2 in srcs:
                    out |= src_of(s2, seen | {v})
        memo[v] = out
        return out

    for nid, vs in consumed.items():
        for v in vs:
            for x in src_of(v):
                g.edge(x, nid)
    if re.search(r"workflow\.onComplete", nf.struct):
        g.hooks.add("onComplete")
        sinks = [k for k in g.nodes if not any(e["from"] == k for e in g.edges)]
        if re.search(r"sendMail|sendmail|\bmail\b", nf.text):
            nid = g.add("completionEmail", "nf-core.completionEmail", "action", "external", "on completion: send summary e-mail")
            g.services.add("email")
            for k in sinks:
                g.edge(k, nid, "control")
    if re.search(r"workflow\.onError", nf.struct):
        g.hooks.add("onError")
        g.add("onError", "nextflow.workflow.onError", "error-handler", "none", "workflow.onError hook")
    g.files_parsed = 1
    g.notes.add("dsl1")
    return g
