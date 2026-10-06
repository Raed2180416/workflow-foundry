"""Static, heuristic analysis of a Snakemake workflow into a rule-level graph.

Nothing is executed or imported: Snakefiles are read as text. The analysis
  * follows `include:` statements from workflow/Snakefile (or Snakefile) recursively,
  * extracts rules/checkpoints and `use rule ... as ... with:` derivations, their directives
    (input/output/shell/script/run/notebook/wrapper/cwl/retries/resources/localrule/group),
  * collects string literals of input/output directives, resolves bare names and input functions to
    the string literals in the corresponding module-level assignment or `def` body,
  * infers edges producer->consumer when an input path pattern can match an output pattern
    (wildcards and f-string placeholders both treated as `.+`, tested in both directions), plus
    explicit `rules.<name>.output` references; a basename-level match is used as a may-flow fallback,
  * records checkpoints, onstart/onsuccess/onerror handlers, module imports (`module X:` / `use rule * from X`),
    storage/remote providers, wrappers (curated tool wrappers) and expand() aggregations.
Known limitations: input functions that compute paths dynamically (beyond literal strings in their body),
paths assembled with os.path.join/config values, and rules generated in Python loops are approximated.
"""
import os, re

DIRECTIVES = {"input", "output", "params", "log", "threads", "resources", "conda", "container", "singularity",
              "wrapper", "shell", "script", "run", "notebook", "cwl", "localrule", "group", "retries", "message",
              "benchmark", "priority", "wildcard_constraints", "handover", "default_target", "cache", "envmodules",
              "shadow", "version", "template_engine", "name"}
STR_RX = re.compile(r"""(?s)(?P<pre>[rRbBfF]{0,2})(?P<q>\"\"\"|'''|\"|')(?P<body>.*?)(?<!\\)(?P=q)""")
INTERP = {"python", "python3", "rscript", "bash", "sh", "perl", "java", "awk", "sed", "cat", "echo", "mkdir", "cp", "mv",
          "ln", "rm", "touch", "zcat", "gzip", "gunzip", "tar", "cd", "set", "export", "printf", "cut", "sort", "head",
          "tail", "paste", "grep", "wget", "curl", "tee", "xargs", "ls", "find", "true", "if", "for", "while"}


def strings_in(text):
    out = []
    for m in STR_RX.finditer(text):
        out.append(m.group("body"))
    return out


def read(path):
    try:
        return open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return ""


def normalize_joins(text):
    """os.path.join("a", X, "b") -> "a/{X}/b" so that joined paths become single patterns."""
    out, i = [], 0
    while True:
        m = re.search(r"os\.path\.join\s*\(", text[i:])
        if not m:
            out.append(text[i:])
            break
        st = i + m.start()
        p = i + m.end() - 1
        d, e = 0, p
        for e in range(p, len(text)):
            if text[e] == "(":
                d += 1
            elif text[e] == ")":
                d -= 1
                if d == 0:
                    break
        args, cur, dd = [], [], 0
        for ch in text[p + 1:e]:
            if ch in "([{":
                dd += 1
            elif ch in ")]}":
                dd -= 1
            if ch == "," and dd == 0:
                args.append("".join(cur)); cur = []
            else:
                cur.append(ch)
        if "".join(cur).strip():
            args.append("".join(cur))
        parts = []
        for a in args:
            ss = strings_in(a)
            parts.append(ss[0] if len(ss) == 1 and re.fullmatch(r"\s*[fFrR]?(\"|')[^\"']*(\"|')\s*", a) else "{" + re.sub(r"\W+", "_", a.strip())[:20] + "}")
        out.append(text[i:st] + '"' + "/".join(parts) + '"')
        i = e + 1
    return "".join(out)


def strip_py_comments(src):
    out = []
    for line in src.split("\n"):
        # remove trailing comments that are not inside quotes (approximate: only when no quote before '#')
        i = line.find("#")
        if i >= 0 and line[:i].count('"') % 2 == 0 and line[:i].count("'") % 2 == 0:
            line = line[:i]
        out.append(line.rstrip())
    return "\n".join(out)


class Rule:
    def __init__(self, name, kind, file):
        self.name, self.kind, self.file = name, kind, file
        self.d = {}
        self.base = None
        self.guarded = False


def parse_files(entry, max_files=200):
    files, order, seen = {}, [], set()
    stack = [entry]
    while stack and len(order) < max_files:
        p = os.path.realpath(stack.pop(0))
        if p in seen or not os.path.isfile(p):
            continue
        seen.add(p)
        src = strip_py_comments(read(p))
        files[p] = src
        order.append(p)
        for m in re.finditer(r"(?m)^\s*include\s*:\s*(.+)$", src):
            parts = strings_in(m.group(1))
            if not parts:
                continue
            rel = "/".join(parts) if "join" in m.group(1) else parts[0]
            stack.append(os.path.join(os.path.dirname(p), rel))
    return files, order


def parse_rules(src, path):
    lines = src.split("\n")
    rules, i = [], 0
    if_stack = []   # (indent) of enclosing top-level-ish if blocks
    handlers = {}
    modules = []
    while i < len(lines):
        line = lines[i]
        ind = len(line) - len(line.lstrip())
        s = line.strip()
        while if_stack and s and ind <= if_stack[-1]:
            if_stack.pop()
        m = re.match(r"^(rule|checkpoint)\s+(\w+)?\s*:", s)
        u = re.match(r"^use\s+rule\s+(\*|[\w, ]+?)\s+(?:from\s+(\w+)\s+)?(?:as\s+(\S+)\s*)?(?:with\s*)?:?\s*$", s)
        h = re.match(r"^(onstart|onsuccess|onerror)\s*:", s)
        mod = re.match(r"^module\s+(\w+)\s*:", s)
        if re.match(r"^(if|elif|else)\b.*:\s*$", s):
            if_stack.append(ind)
        if m or u or h or mod:
            j = i + 1
            body = []
            tq = None
            while j < len(lines):
                l2 = lines[j]
                if tq is None and l2.strip() and (len(l2) - len(l2.lstrip())) <= ind:
                    break
                for q in ('"""', "'''"):
                    if tq in (None, q) and l2.count(q) % 2 == 1:
                        tq = q if tq is None else None
                body.append(l2)
                j += 1
            # drop a leading docstring (it may contain `input:`/`output:` prose)
            k = 0
            while k < len(body) and not body[k].strip():
                k += 1
            if k < len(body) and body[k].strip().startswith(('"""', "'''")):
                q = body[k].strip()[:3]
                e = k if body[k].strip().count(q) >= 2 and len(body[k].strip()) > 3 else next((x for x in range(k + 1, len(body)) if q in body[x]), k)
                body = body[:k] + body[e + 1:]
            text = "\n".join(body)
            if m:
                r = Rule(m.group(2) or f"anon{len(rules)}", m.group(1), path)
                r.d = directives(text)
                r.guarded = bool(if_stack)
                rules.append(r)
            elif u:
                names, frm, alias = u.group(1), u.group(2), u.group(3)
                if frm:
                    modules.append({"module": frm, "rules": names.strip(), "alias": alias, "with": directives(text) if s.endswith(":") else {}})
                else:
                    for nm in [x.strip() for x in names.split(",") if x.strip()]:
                        r = Rule(alias or nm, "use", path)
                        r.base = nm
                        r.d = directives(text) if s.endswith(":") else {}
                        r.guarded = bool(if_stack)
                        rules.append(r)
            elif h:
                handlers[h.group(1)] = text
            elif mod:
                modules.append({"module": mod.group(1), "decl": directives(text)})
            i = j
            continue
        i += 1
    return rules, handlers, modules


def directives(text):
    out, cur, buf, dind = {}, None, [], None
    for line in text.split("\n"):
        if not line.strip():
            if cur:
                buf.append("")
            continue
        ind = len(line) - len(line.lstrip())
        m = re.match(r"^\s*(\w+)\s*:(.*)$", line)
        if m and m.group(1) in DIRECTIVES and (dind is None or ind <= dind):
            if cur:
                out[cur] = "\n".join(buf)
            cur, dind = m.group(1), ind
            buf = [m.group(2)]
        elif cur:
            buf.append(line)
    if cur:
        out[cur] = "\n".join(buf)
    return out


def module_defs(src):
    """name -> list of string literals for module-level assignments and def bodies."""
    out = {}
    lines = src.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^def\s+(\w+)\s*\(", line)
        a = re.match(r"^([A-Za-z_]\w*)\s*=\s*(.+)$", line)
        if m:
            j = i + 1
            body = []
            while j < len(lines) and (not lines[j].strip() or lines[j].startswith((" ", "\t"))):
                body.append(lines[j]); j += 1
            out.setdefault(m.group(1), []).extend(strings_in("\n".join(body)))
            out[m.group(1) + "()"] = ["<func>"]
            i = j
            continue
        if a:
            rhs = a.group(2)
            j = i + 1
            depth = rhs.count("(") + rhs.count("[") + rhs.count("{") - rhs.count(")") - rhs.count("]") - rhs.count("}")
            while depth > 0 and j < len(lines):
                rhs += "\n" + lines[j]
                depth += lines[j].count("(") + lines[j].count("[") + lines[j].count("{") - lines[j].count(")") - lines[j].count("]") - lines[j].count("}")
                j += 1
            out.setdefault(a.group(1), []).extend(strings_in(rhs))
            i = j
            continue
        i += 1
    return out


def pattern_regex(p):
    parts = re.split(r"\{[^{}]*\}", p)
    return "^" + ".+".join(re.escape(x) for x in parts) + "$"


def placeholder(p):
    return re.sub(r"\{[^{}]*\}", "\x00", p)


def path_like(s):
    s = s.strip()
    return bool(s) and len(s) < 300 and "\n" not in s and (("/" in s) or re.search(r"\.\w{1,8}(\.gz)?$", s) or "{" in s) and \
        not s.startswith(("http://", "https://", "ftp://", "s3://", "gs://")) and " " not in s.strip()


def analyze(repo, classify, entry=None):
    cands = [entry] if entry else ["workflow/Snakefile", "Snakefile", "snakefile", "workflow/snakefile", "workflow/Snakefile.smk",
                                   "Snakefile.smk", "main.smk", "workflow/main.smk"]
    ent = None
    for c in cands:
        if c and os.path.isfile(os.path.join(repo, c)):
            ent = os.path.join(repo, c)
            break
    if ent is None:
        smks = [os.path.join(dp, f) for dp, _, fs in os.walk(repo) if "/.git" not in dp for f in fs
                if f == "Snakefile" or f.endswith(".smk") or f.lower() == "snakefile"]
        if not smks:
            return None
        ent = sorted(smks, key=lambda p: (p.count("/"), len(p)))[0]
    files, order = parse_files(ent)
    rules, handlers, modules, defs = [], {}, [], {}
    for p in order:
        r, h, mods = parse_rules(files[p], p)
        rules += r
        handlers.update(h)
        modules += mods
        for k, v in module_defs(files[p]).items():
            defs.setdefault(k, []).extend(v)
    allsrc = "\n".join(files[p] for p in order)
    byname = {r.name: r for r in rules}
    # resolve `use rule A as B with:` -> inherit directives
    for r in rules:
        if r.kind == "use" and r.base in byname and byname[r.base] is not r:
            base = dict(byname[r.base].d)
            base.update(r.d)
            r.d = base
    nodes, edges = {}, []
    stats = {"rules": len(rules), "checkpoints": sum(1 for r in rules if r.kind == "checkpoint"), "expand": 0, "wrappers": 0,
             "retries": 0, "attempt_resources": False, "fallback_edges": 0, "explicit_edges": 0, "pattern_edges": 0,
             "guards": 0, "modules": len([m for m in modules if "decl" in m]), "use_from_module": len([m for m in modules if "rules" in m]),
             "handlers": sorted(handlers), "files": len(order), "storage": set(), "packages": set(), "services": set(),
             "dynamic_inputs": 0}
    outs, ins = {}, {}
    for r in rules:
        d = r.d
        d["output"] = normalize_joins(d.get("output", ""))
        d["input"] = normalize_joins(d.get("input", ""))
        o_strs = [s for s in strings_in(d.get("output", "")) if path_like(s)]
        i_text = d.get("input", "")
        i_strs = [s for s in strings_in(i_text) if path_like(s)]
        names = set(re.findall(r"(?<![\w.\"'])([A-Za-z_]\w*)\b(?!\s*=)", re.sub(STR_RX, "''", i_text)))
        dyn = 0
        for nm in names:
            if nm in defs and nm not in ("expand", "temp", "protected", "directory", "ancient", "multiext", "lambda", "wildcards", "config", "rules", "checkpoints", "local", "lookup", "branch", "storage", "access", "unpack", "glob_wildcards", "os", "path"):
                vals = [s for s in defs[nm] if path_like(s)]
                i_strs += vals
                if nm + "()" in defs:
                    dyn += 1
        if "lambda" in i_text:
            dyn += 1
        stats["dynamic_inputs"] += dyn
        stats["expand"] += i_text.count("expand(")
        if re.search(r"\bif\b.+\belse\b|\bbranch\s*\(", i_text):
            stats["guards"] += 1
        if r.guarded:
            stats["guards"] += 1
        outs[r.name] = o_strs
        ins[r.name] = (i_strs, re.findall(r"\brules\.(\w+)\.output", i_text) + re.findall(r"\bcheckpoints\.(\w+)\.get", i_text))
        wrapper = " ".join(strings_in(d.get("wrapper", "")))
        shell = " ".join(strings_in(d.get("shell", "")))
        script = " ".join(strings_in(d.get("script", "")))
        pkg, typ = "", "snakemake.rule"
        if wrapper:
            stats["wrappers"] += 1
            wm = re.search(r"(?:bio|utils)/([\w.-]+)", wrapper)
            pkg = (wm.group(1) if wm else wrapper.split("/")[-1]).lower()
            typ = f"snakemake.wrapper:{'/'.join(wrapper.split('/')[-3:]) if wrapper else ''}"
            curated = True
        elif shell:
            first = re.findall(r"(?:^|[;&|(]\s*|\n\s*)([A-Za-z][\w.+-]*)", shell)
            tools = [w for w in first if w.lower() not in INTERP and not w.startswith(("{", "$"))]
            pkg = tools[0].lower() if tools else ""
            typ = "snakemake.shell" + (f":{pkg}" if pkg else "")
            curated = bool(pkg)
        elif script or "notebook" in d or "run" in d:
            typ = "snakemake.script" if script else ("snakemake.notebook" if "notebook" in d else "snakemake.run")
            pkg = ""
            curated = False
        else:
            curated = True
        text = " ".join([r.name, wrapper, shell[:1500], script, i_text[:500]])
        if re.search(r"storage\.\w+\(|storage\(|\.remote\(|HTTP\.|S3\.|FTP\.|GS\.|NCBI\.", i_text + d.get("output", "")):
            sm_ = re.findall(r"storage\.(\w+)|(\w+)\.remote", i_text + d.get("output", ""))
            stats["storage"].add((sm_[0][0] or sm_[0][1]) if sm_ else "remote")
            text += " download"
        cat, eff, svcs = classify(text, pkg, curated=curated)
        if cat == "action" and not curated:
            cat = "code"
        if not o_strs and not wrapper and not shell and not script and "run" not in d and "notebook" not in d:
            cat, eff, typ = "other", "none", "snakemake.target"
        if "retries" in d:
            stats["retries"] += 1
        if re.search(r"\battempt\b", d.get("resources", "")):
            stats["attempt_resources"] = True
        if pkg:
            stats["packages"].add(pkg)
        stats["services"] |= set(svcs)
        summary = f"{'checkpoint' if r.kind == 'checkpoint' else 'rule'} {r.name}" + (f" via wrapper {pkg}" if wrapper else (f" runs {pkg}" if pkg else (" (script)" if script else ""))) + \
                  (" [conditional]" if r.guarded else "") + (f" -> {o_strs[0]}" if o_strs else "")
        nodes[r.name] = {"id": r.name, "type": typ + (":checkpoint" if r.kind == "checkpoint" else ""), "category": cat,
                         "effects": eff, "summary": summary}
    # edges
    out_rx = {n: [(re.compile(pattern_regex(p)), placeholder(p), p) for p in ps] for n, ps in outs.items()}
    out_base = {n: [(re.compile(pattern_regex(os.path.basename(p))), p) for p in ps if "." in os.path.basename(p) and len(os.path.basename(p)) >= 5]
                for n, ps in outs.items()}
    for n, (istrs, refs) in ins.items():
        for ref in refs:
            if ref in nodes and ref != n:
                edges.append({"from": ref, "to": n, "kind": "data"}); stats["explicit_edges"] += 1
        for s in istrs:
            ph = placeholder(s)
            try:
                irx = re.compile(pattern_regex(s))
            except re.error:
                irx = None
            lit_in = len(re.sub(r"[/._-]", "", re.sub(r"\{[^{}]*\}", "", s)))
            best, cands_ = -1, []
            for m, lst in out_rx.items():
                if m == n:
                    continue
                for rx, pph, p in lst:
                    lit_out = len(re.sub(r"[/._-]", "", re.sub(r"\{[^{}]*\}", "", p)))
                    ok = (lit_out >= 3 and rx.match(ph)) or (lit_in >= 3 and irx is not None and irx.match(pph))
                    if ok:
                        score = min(lit_out, lit_in) * 2 + lit_out
                        if score > best:
                            best, cands_ = score, [m]
                        elif score == best and m not in cands_:
                            cands_.append(m)
                        break
            found = bool(cands_)
            for m in cands_:
                edges.append({"from": m, "to": n, "kind": "data"}); stats["pattern_edges"] += 1
            # basename fallback (may-flow) only when no full-pattern producer was found for this input string
            if not found and "." in os.path.basename(s):
                bn = placeholder(os.path.basename(s))
                for m, lst in out_base.items():
                    if m == n:
                        continue
                    for rx, p in lst:
                        if rx.match(bn) and not os.path.basename(p).startswith("{"):
                            edges.append({"from": m, "to": n, "kind": "data"}); stats["fallback_edges"] += 1
                            break
    for hname, body in handlers.items():
        hid = f"__{hname}__"
        if hname == "onerror":
            nodes[hid] = {"id": hid, "type": "snakemake.onerror", "category": "error-handler", "effects": "none",
                          "summary": "onerror handler (runs when any job fails)"}
        else:
            ext = bool(re.search(r"mail|slack|teams|webhook|requests\.post|curl", body, re.I))
            nodes[hid] = {"id": hid, "type": f"snakemake.{hname}", "category": "action" if ext else "code",
                          "effects": "external" if ext else "none", "summary": f"{hname} handler" + (" (sends notification)" if ext else "")}
            if ext:
                stats["services"].add("email" if re.search(r"mail", body, re.I) else "im-webhook")
            if hname == "onsuccess":
                sinks = [k for k in nodes if not k.startswith("__") and not any(e["from"] == k for e in edges)]
                for k in sinks:
                    edges.append({"from": k, "to": hid, "kind": "control"})
    for i, m in enumerate(modules):
        if "decl" in m:
            sf = " ".join(strings_in(m["decl"].get("snakefile", "")))
            mid = f"__module_{m['module']}__"
            nodes[mid] = {"id": mid, "type": "snakemake.module", "category": "subworkflow", "effects": "write",
                          "summary": f"module {m['module']} imported from {sf[:120] or 'external snakefile'}"}
    stats["storage"] = sorted(stats["storage"])
    return {"nodes": nodes, "edges": edges, "stats": stats, "entry": os.path.relpath(ent, repo), "src": allsrc}
