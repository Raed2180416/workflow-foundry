"""WDL workflow -> call-level graph using miniwdl's parser/type-checker (pinned in science-requirements.txt;
run with /opt/corpus/.venv-science/bin/python -I). Nothing is executed and no import is fetched over the
network: a local-only read_source maps relative imports (and https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
imports of the same repository) to the checked-out tree and refuses everything else.

  * call -> task node (action/model/transform via science-common.classify_step; package from the runtime
    docker image or the command's first word); call of a sub-workflow -> inlined with prefix (outer
    upstream calls wired to the sub-workflow's entry calls, its exit calls to the outer consumers)
  * edges: call B depends on call A when B's inputs reach A's outputs through declarations, gathers
    and section expressions (miniwdl workflow_node_dependencies, projected onto calls); `after` -> control
  * scatter section -> one runtime fan-out (map); conditional section gating >=1 call -> one decision point
"""
import asyncio, os, re

import WDL


def make_reader(root, owner_repo=None):
    root = os.path.realpath(root)

    async def read_source(uri, path, importer):
        if uri.startswith(("http://", "https://")):
            m = re.match(r"https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/[^/]+/(.+)$", uri)
            if m and owner_repo and f"{m.group(1)}/{m.group(2)}".lower() == owner_repo.lower():
                p = os.path.join(root, m.group(3))
            else:
                raise FileNotFoundError(f"remote import not fetched: {uri}")
        else:
            base = os.path.dirname(importer.pos.abspath) if importer else root
            p = os.path.normpath(os.path.join(base, uri))
            if not os.path.isfile(p):
                cands = [os.path.normpath(os.path.join(d, uri)) for d in path + [root]]
                p = next((c for c in cands if os.path.isfile(c)), p)
        p = os.path.realpath(p)
        if not p.startswith(root) or not os.path.isfile(p):
            raise FileNotFoundError(uri)
        with open(p, encoding="utf-8", errors="replace") as fh:
            return WDL.ReadSourceResult(source_text=fh.read(), abspath=p)

    return read_source


class WdlGraph:
    def __init__(self):
        self.nodes, self.edges = {}, []
        self.guards, self.fanout, self.subworkflow_calls = set(), 0, 0
        self.packages, self.services = set(), set()
        self.retries = 0
        self.max_depth = 0
        self.notes = set()

    def add(self, nid, typ, cat, eff, summary):
        k, n = nid, 2
        while k in self.nodes:
            k = f"{nid}#{n}"; n += 1
        self.nodes[k] = {"id": k, "type": typ, "category": cat, "effects": eff, "summary": summary}
        return k

    def edge(self, a, b, kind="data"):
        if a in self.nodes and b in self.nodes and a != b:
            self.edges.append({"from": a, "to": b, "kind": kind})


def _walk(body, section=None, out=None, parent_sections=()):
    out = out if out is not None else {}
    for n in body:
        out[n.workflow_node_id] = (n, parent_sections)
        if isinstance(n, (WDL.Tree.Scatter, WDL.Tree.Conditional)):
            for gth in n.gathers.values():
                out[gth.workflow_node_id] = (gth, parent_sections)
            _walk(n.body, n, out, parent_sections + (n.workflow_node_id,))
    return out


def task_info(task):
    img = ""
    rt = getattr(task, "runtime", {}) or {}
    for k in ("docker", "container"):
        if k in rt:
            img = str(rt[k])
    cmd = str(getattr(task, "command", "") or "")
    retries = 1 if "maxRetries" in rt else 0
    words = [w for w in re.findall(r"(?m)^\s*([A-Za-z][\w.+-]*)\b(?!\s*=)(?!\s*\()", cmd)
             if w not in ("import", "from", "def", "print", "return", "with", "try", "except", "class", "assert", "raise", "pass")]
    words = [w for w in words
             if w.lower() not in ("set", "echo", "if", "then", "fi", "else", "mkdir", "cd", "export", "for", "do", "done", "cp", "mv",
                                  "ln", "rm", "touch", "python", "python3", "bash", "sh", "cat", "while", "java", "rscript", "perl", "gsutil", "ls", "tar", "gunzip", "zcat", "wc", "printf", "declare", "local", "elif", "case", "esac")]
    lit = img.strip().strip('"\'')
    # runtime docker given as an expression/variable (e.g. gatk_docker) carries no image name
    imgpkg = re.sub(r"[:@].*$", "", lit.split("/")[-1]) if lit and re.search(r"[/:.]", lit) and not re.search(r"[\s(\[]", lit) else ""
    pkg = (imgpkg or (words[0] if words else task.name)).lower()
    pkg = re.sub(r"[^a-z0-9_.+-]", "", pkg)[:40] or task.name.lower()
    return pkg, img, cmd, retries


def add_workflow(wf, classify, g, prefix="", depth=0):
    g.max_depth = max(g.max_depth, depth)
    nodes = _walk(wf.body)
    call_node = {}       # workflow_node_id -> (entry set, exit set)
    for nid_, (n, secs) in nodes.items():
        if isinstance(n, WDL.Tree.Scatter):
            g.fanout += 1
        if not isinstance(n, WDL.Tree.Call):
            continue
        callee = n.callee
        if isinstance(callee, WDL.Tree.Workflow) and depth < 6:
            g.subworkflow_calls += 1
            before = set(g.nodes)
            add_workflow(callee, classify, g, prefix=f"{prefix}{n.name}/", depth=depth + 1)
            created = set(g.nodes) - before
            has_in = {e["to"] for e in g.edges if e["from"] in created and e["to"] in created}
            has_out = {e["from"] for e in g.edges if e["from"] in created and e["to"] in created}
            entry = {c for c in created if c not in has_in} or created
            exit_ = {c for c in created if c not in has_out} or created
            call_node[nid_] = (entry, exit_)
            for s in secs:
                if s.startswith("if-") and created:
                    g.guards.add(prefix + s)
            continue
        if isinstance(callee, WDL.Tree.Task):
            pkg, img, cmd, retries = task_info(callee)
            g.retries += retries
            text = f"{callee.name} {n.name} {img} {cmd[:2000]}"
            cat, eff, svcs = classify(text, pkg, curated=True)
            g.packages.add(pkg)
            g.services |= set(svcs)
            typ = f"wdl.task:{callee.name}"
        else:
            pkg, img, cat, eff, typ = "", "", "subworkflow", "write", "wdl.workflow"
        guarded = [s for s in secs if s.startswith("if-")]
        scattered = [s for s in secs if s.startswith("scatter-")]
        summ = f"call {n.name} -> {callee.name if callee else '?'}" + (f" ({img.strip(chr(34))[:60]})" if img else "") + \
               (" [scatter]" if scattered else "") + (" [conditional]" if guarded else "")
        k = g.add(prefix + n.name, typ, cat, eff, summ)
        for s in guarded:
            g.guards.add(prefix + s)
        call_node[nid_] = ({k}, {k})
    # dependency projection onto calls
    deps = {}
    for nid_, (n, secs) in nodes.items():
        d = set(n.workflow_node_dependencies)
        d |= set(secs)          # body nodes depend on their enclosing section's expression
        deps[nid_] = d
    for nid_, (n, secs) in nodes.items():
        if nid_ not in call_node:
            continue
        seen, stack, ups = set(), list(deps.get(nid_, ())), set()
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            if x in call_node and x != nid_:
                ups.add(x)
                continue
            if x.startswith("gather-"):
                ref = nodes.get(x)
                if ref:
                    stack.append(ref[0].referee.workflow_node_id)
                continue
            stack.extend(deps.get(x, ()))
        after = set(getattr(n, "_after_node_ids", set()) or set())
        for u in ups:
            for a in call_node[u][1]:
                for b in call_node[nid_][0]:
                    g.edge(a, b, "control" if u in after else "data")
    return g


def analyze_file(path, root, classify, owner_repo=None):
    doc = WDL.load(path, path=[root], check_quant=False, read_source=make_reader(root, owner_repo))
    if doc.workflow is None:
        return None, doc
    g = WdlGraph()
    add_workflow(doc.workflow, classify, g)
    g.doc = doc
    return g, doc
