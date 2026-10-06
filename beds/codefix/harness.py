# codefix harness: reads one JSON request on stdin, writes one marked JSON line on stdout.
# Request: {"inspect": [source, ...], "jobs": [{"source": str, "cases": [case, ...]}, ...],
#           "case_seconds": float}
# A case is {"title": str, "steps": [step, ...]}; steps are
#   ["new", var, cls, args, kwargs]          construct mod.cls(*args, **kwargs) into env[var]
#   ["call", var, meth, args, kwargs, as?]   record env[var].meth(*args, **kwargs)
#   ["fn", name, args, kwargs, as?]          record mod.name(*args, **kwargs)
#   ["get", var, attr]                       record env[var].attr
# Argument values may be {"$ref": var} (an env value) or {"$tuple": [...]}.
# Untrusted sources only ever run inside the namespace sandbox (see sandbox.mjs).
import ast
import dataclasses
import io
import json
import math
import signal
import sys
import types

MARK = "@@CODEFIX-RESULT@@"


class CaseTimeout(BaseException):
    pass


def _alarm(signum, frame):
    raise CaseTimeout()


def norm(v, depth=0):
    if depth > 12:
        return {"__deep__": True}
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v if abs(v) < 2 ** 52 else {"__bigint__": str(v)}
    if isinstance(v, float):
        if math.isnan(v):
            return {"__float__": "nan"}
        if math.isinf(v):
            return {"__float__": "inf" if v > 0 else "-inf"}
        r = round(v, 6)
        return 0.0 if r == 0 else r
    if isinstance(v, str):
        return v if len(v) <= 4000 else v[:4000] + "<truncated>"
    if isinstance(v, tuple) and not hasattr(v, "_fields"):
        return {"__tuple__": [norm(x, depth + 1) for x in v[:500]]}
    if isinstance(v, (list, tuple)):
        return [norm(x, depth + 1) for x in v[:500]]
    if isinstance(v, dict):
        return {"__map__": [[norm(k, depth + 1), norm(x, depth + 1)] for k, x in list(v.items())[:500]]}
    if isinstance(v, (set, frozenset)):
        items = [norm(x, depth + 1) for x in v]
        return {"__set__": sorted(items, key=lambda x: json.dumps(x, sort_keys=True))[:500]}
    if dataclasses.is_dataclass(v) and not isinstance(v, type):
        out = {"__type__": type(v).__name__}
        for f in dataclasses.fields(v):
            out[f.name] = norm(getattr(v, f.name, None), depth + 1)
        return out
    return {"__type__": type(v).__name__}


def conv(value, env):
    if isinstance(value, list):
        return [conv(x, env) for x in value]
    if isinstance(value, dict):
        if "$ref" in value and len(value) == 1:
            return env[value["$ref"]]
        if "$tuple" in value and len(value) == 1:
            return tuple(conv(x, env) for x in value["$tuple"])
        return {k: conv(x, env) for k, x in value.items()}
    return value


def load(source, name):
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    exec(compile(source, name + ".py", "exec"), mod.__dict__)
    return mod


def run_case(mod, case, seconds):
    env = {}
    out = []
    for step in case["steps"]:
        signal.setitimer(signal.ITIMER_REAL, seconds)
        try:
            kind = step[0]
            if kind == "new":
                _, var, cls, args, kw = step
                env[var] = getattr(mod, cls)(*conv(args, env), **conv(kw, env))
                out.append(None)
            elif kind == "call":
                var, meth, args, kw = step[1:5]
                value = getattr(env[var], meth)(*conv(args, env), **conv(kw, env))
                if len(step) > 5 and step[5]:
                    env[step[5]] = value
                out.append(norm(value))
            elif kind == "fn":
                name, args, kw = step[1:4]
                value = getattr(mod, name)(*conv(args, env), **conv(kw, env))
                if len(step) > 4 and step[4]:
                    env[step[4]] = value
                out.append(norm(value))
            elif kind == "get":
                out.append(norm(getattr(env[step[1]], step[2])))
            else:
                out.append({"__raise__": "BadStep", "__msg__": str(kind)})
        except CaseTimeout:
            out.append({"__raise__": "Timeout", "__msg__": "step exceeded time limit"})
            signal.setitimer(signal.ITIMER_REAL, 0)
            break
        except RecursionError as e:
            out.append({"__raise__": "RecursionError", "__msg__": str(e)[:200]})
        except Exception as e:
            out.append({"__raise__": type(e).__name__, "__msg__": str(e)[:200]})
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
    return out


def run_job(job, index, seconds):
    name = job.get("module", "candidate_%d" % index)
    signal.setitimer(signal.ITIMER_REAL, seconds * 2)
    try:
        mod = load(job["source"], name)
    except CaseTimeout:
        return {"loadError": "Timeout: module import exceeded time limit"}
    except BaseException as e:
        return {"loadError": "%s: %s" % (type(e).__name__, str(e)[:300])}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    return {"results": [run_case(mod, case, seconds) for case in job["cases"]]}


def sig(args):
    pos = list(args.posonlyargs) + list(args.args)
    return {
        "pos": [a.arg for a in pos],
        "nposonly": len(args.posonlyargs),
        "vararg": args.vararg.arg if args.vararg else None,
        "kwonly": [a.arg for a in args.kwonlyargs],
        "kwarg": args.kwarg.arg if args.kwarg else None,
        "ndefaults": len(args.defaults),
        "kwdefaults": [d is not None for d in args.kw_defaults],
    }


def inspect_source(source):
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return {"syntaxError": "%s (line %s)" % (e.msg, e.lineno)}
    except Exception as e:
        return {"syntaxError": "%s: %s" % (type(e).__name__, str(e)[:200])}
    defs = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not node.name.startswith("_"):
            defs[node.name] = {"kind": "function", "sig": sig(node.args)}
        elif isinstance(node, ast.ClassDef) and not node.name.startswith("_"):
            methods = {}
            fields = []
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    if not item.name.startswith("_") or item.name == "__init__":
                        methods[item.name] = sig(item.args)
                elif isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                    fields.append(item.target.id)
            defs[node.name] = {
                "kind": "class",
                "bases": [ast.unparse(b) for b in node.bases],
                "methods": methods,
                "fields": fields,
            }
    imports, names, attrs, strings = set(), set(), set(), []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            imports.add("." if node.level else (node.module or "").split(".")[0])
        elif isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            attrs.add(node.attr)
        elif isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            low = node.value.lower()
            if "pytest" in low or "unittest" in low:
                strings.append(node.value[:80])
    return {
        "defs": defs,
        "imports": sorted(imports),
        "names": sorted(names),
        "attrs": sorted(attrs),
        "suspiciousStrings": strings,
    }


def main():
    real_stdout = sys.stdout
    request = json.loads(sys.stdin.read())
    sys.stdout = io.StringIO()
    sys.setrecursionlimit(2000)
    signal.signal(signal.SIGALRM, _alarm)
    seconds = float(request.get("case_seconds", 0.5))
    response = {
        "inspect": [inspect_source(s) for s in request.get("inspect", [])],
        "jobs": [run_job(job, i, seconds) for i, job in enumerate(request.get("jobs", []))],
    }
    sys.stdout = real_stdout
    real_stdout.write(MARK + json.dumps(response) + "\n")
    real_stdout.flush()


main()
