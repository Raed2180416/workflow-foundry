# AUDIT step 4 (triviality attack): best-effort heuristic solver, <=40 lines, reads only task.inputs (JSON on stdin). (1) static: a
# signature default that disagrees with "<param> ... default(s) (to) <v>" in docstrings/notes; (2) greedy edit search (comparators, +-1,
# swapped args/operands, ceil-div, range bound, max(0,..) clamp, .lower(), local-name substitution in reported functions) scored on
# executable evidence: visible tests, "For `expr` I expected ..." repro lines and "f(..) == v" doc examples. Run only in the sandbox.
import json, re, sys, types, signal
I = json.load(sys.stdin)['inputs']; MOD = I['module_path'][:-3]; REP = I['bug_report'] + I.get('ci_log', ''); SRC = I['source']
def _alarm(*a): raise TimeoutError()
class approx:
    def __init__(s, v): s.v = v
    def __eq__(s, o): return abs(s.v - o) <= 1e-6 * max(1, abs(s.v))
class raises:
    def __init__(s, e): s.e = e
    def __enter__(s): return s
    def __exit__(s, t, v, tb): assert t is not None; return issubclass(t, s.e)
signal.signal(signal.SIGALRM, _alarm); sys.modules['pytest'] = types.SimpleNamespace(approx=approx, raises=raises)
EXP = re.findall(r'```\n(.*?)```\s*For `(.+?)` I (?:expected|would expect) (?:it to raise (\w+)|`(.+?)`), but', REP, re.S)
EXP += [(f'>>> from {MOD} import *\n>>> {e}', e, '', v) for e, v in re.findall(r'(\w+\([^()\n]*\)) == (\S.*?)(?:\.\s|\.?$)', SRC, re.M)]
def run(f, *a):
    try: return f(*a)
    except TimeoutError: raise
    except BaseException as e: return e
def score(src):
    m = types.ModuleType(MOD); sys.modules[MOD] = m; n = 0; signal.setitimer(signal.ITIMER_REAL, 0.3)
    try:
        exec(compile(src, MOD, 'exec'), m.__dict__); ns = {}; exec(I['visible_tests'], ns)
        n += sum(run(ns[k]) is None for k in list(ns) if k.startswith('test_'))
        for block, expr, exc, val in EXP:
            env = {}; lines = [l[4:] for l in block.split('\n') if l.startswith('>>> ')]
            for l in lines[:next(i for i, l in enumerate(lines) if expr in l)]: run(exec, l, env)
            got = run(eval, expr, env); n += type(got).__name__ == exc if exc else run(lambda: got == eval(val, env)) is True
    except BaseException: n = -1
    finally: signal.setitimer(signal.ITIMER_REAL, 0)
    return n
OPS = [(r'<=', '<'), (r'>=', '>'), (r'(?<![<>-])<(?![=<])', '<='), (r'(?<![<>-])>(?![=>])', '>='), (r'\b(\w+) // ([\w.]+) \+ 1\b', r'-(-\1 // \2)'),
       (r'\b([\w.]+(?:\(\w*\))?), ([\w.]+(?:\(\w*\))?)', r'\2, \1'), (r'\b([\w.]+) - ([\w.]+)\b', r'\2 - \1'), (r'range\(([^()]*(?:\([^()]*\))?[^()]*)\)', r'range(\1 + 1)'),
       (r'(return|=) (.+)$', r'\1 max(0, \2)'), (r'\b(\w+) in (\w+)', r'\1.lower() in \2')]
FOCUS = set(re.findall(r'(\w+)\(\)', REP)) | set(re.findall(r'::test_(\w+?)_', REP))
def edits(src):
    L = src.split('\n'); inside = False; fn = ''; names = []
    for i, l in enumerate(L):
        if l.lstrip().startswith('def '): fn = re.search(r'def (\w+)', l)[1]; names = sorted(set(re.findall(r'\b([a-z_]\w*) =', '\n'.join(L[i:i + 25]))))
        if l.count('"""') % 2: inside = not inside; continue
        if inside or not l.strip() or l.strip().startswith(('#', '"""')): continue
        code = l.split('  #')[0]; subs = [(r'\b%s\b' % a, b) for a in names for b in names if a != b] if any(fn in f or f in fn for f in FOCUS) else []
        for pat, rep in OPS + subs + [(r'\b%d\b' % int(d), str(int(d) + k)) for d in set(re.findall(r'\b\d+\b', code)) for k in (1, -1)]:
            for mt in re.finditer(pat, code): yield '\n'.join(L[:i] + [code[:mt.start()] + mt.expand(rep) + code[mt.end():]] + L[i + 1:])
src = SRC; docs = SRC + I['design_notes']
for name in set(re.findall(r'def \w+\(.*?\b(\w+)=', SRC)) | set(re.findall(r'\b(\w+)=[\w.-]+[,)]', SRC)):
    vals = set(re.findall(r'\b%s\b[^.;]{0,60}?defaults?\s+(?:to\s+|is\s+)?(-?\d+|True|False)\b' % name, docs))
    if len(vals) == 1: src = re.sub(r'(def .*\b%s=)([\w.-]+)' % name, lambda m: m.group(1) + vals.pop() if vals else m.group(0), src)
best = score(src)
for _ in range(4):
    cand = max(((score(s), -k, s) for k, s in enumerate(edits(src))), default=(best, 0, src))
    if cand[0] <= best: break
    best, src = cand[0], cand[2]
print(json.dumps({'patched_source': src}))
