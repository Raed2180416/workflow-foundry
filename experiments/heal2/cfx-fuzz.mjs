// H-cfx differential-fuzz gate (ATTACK.md Move 8 $0 step; research/blockers-20261021/MOVE2-COMP.md). $0, no model.
// The 2026-10-08 codefix incident H-cfx: the workflow's deterministic check node (check1) refused fixes whose only API
// change was a documented default value ("min_count is inclusive (default 2)"). Three proposers (Sonnet r2, Haiku r3,
// Opus r4) each wrote a replacement check (op relax_check, justified class "default-value-changed"). This file fuzzes
// the base check and the three stored candidates on generated (source, candidate) Python module pairs and gates each
// candidate with experiments/lib/difffuzz.mjs:
//   - the generator builds a structured module (public and private functions with positional, keyword-only, *args and
//     **kwargs parameters and defaults; classes with __init__, public and private methods; imports), renders it to
//     Python, applies 1-3 random edits (default values, parameter adds/removes/renames, defaults added or removed,
//     *args/**kwargs, kind changes function <-> class, removed/renamed/added names, new imports, private changes,
//     syntax errors) and renders the edited copy;
//   - the justified class is computed from the two structured models, never from the edit labels: "every public API
//     difference is a positional default value, nothing else changed" (the candidate's own justification quote);
//     outside the class the base check is the oracle, inside it the intended verdict is "ok";
//   - each check script runs in the repository's executor sandbox (user, mount, pid and network namespaces; host paths
//     hidden) under python3 -I, one process per script over a JSONL batch; an exception is a crash.
// Nothing here reads or imports the frozen heal kit: the stored records are read as data (read-only), and the scripts
// are executed only inside the sandbox.
//   nice -n 15 node experiments/heal2/cfx-fuzz.mjs [--n 5000] [--seed 20261028] [--out research/blockers-20261021/move8/cfx-fuzz.json]
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { maskSteps, sandboxScript, UNSHARE_ARGS, DEFAULT_HIDDEN, binaryKeeps, sandboxAvailable } from '../../src/executors/claude-code.mjs';
import { differentialGate, pairwise, ddmin, gateTable } from '../lib/difffuzz.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const sha = s => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------------------------------------------------------------
// Stored scripts (read-only data)

export const SOURCES = Object.freeze({
  workflow: 'research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json',
  sonnet: 'experiments/heal/runs/live-20261008-r2/cfx.json',
  haiku: 'experiments/heal/runs/live-20261008-r3/cfx.json',
  opus: 'experiments/heal/runs/live-20261008-r4/cfx.json',
});

/** { base, sonnet, haiku, opus } check-script sources, plus provenance. */
export function loadScripts(root = ROOT) {
  const wf = JSON.parse(readFileSync(path.join(root, SOURCES.workflow), 'utf8'));
  const node = wf.nodes.find(n => n.id === 'check1');
  if (!node || typeof node.source !== 'string') throw new Error('check1 not found in the codefix workflow');
  const out = { base: node.source }, meta = { base: { file: SOURCES.workflow, node: 'check1' } };
  for (const who of ['sonnet', 'haiku', 'opus']) {
    const rec = JSON.parse(readFileSync(path.join(root, SOURCES[who]), 'utf8'));
    const op = rec.proposals?.[0]?.ops?.find(o => o.op === 'relax_check' && o.node === 'check1');
    if (!op) throw new Error(`${who}: no relax_check op on check1`);
    out[who] = op.source;
    meta[who] = { file: SOURCES[who], proposal: rec.proposals[0].id, justifiedClass: op.justifiedClass, quote: op.justificationQuote };
  }
  for (const k of Object.keys(out)) meta[k].sha256 = sha(out[k]);
  return { scripts: out, meta };
}

// ---------------------------------------------------------------------------------------------------------------------
// Generator

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const copy = v => JSON.parse(JSON.stringify(v));
const LITERALS = ['0', '1', '2', '3', '10', '-1', '0.5', '2.0', 'None', 'True', 'False', '"a"', '"x"', '""', '()', '(1, 2)'];
const PARAMS = ['x', 'y', 'n', 'k', 'items', 'count', 'min_count', 'limit', 'key', 'value', 'data', 'flag', 'scale', 'sep'];
const FUNCS = ['compute', 'parse', 'merge', 'score', 'tally', 'normalise', 'top_k', 'window', 'split_words', 'dedupe'];
const CLASSES = ['Store', 'Counter', 'Ledger', 'Window', 'Index'];
const IMPORTS = ['import re', 'import math', 'from collections import Counter', 'import json', 'from typing import List'];

const freshName = (r, pool, used) => { for (let i = 0; i < 50; i++) { const n = pick(r, pool); if (!used.has(n)) return n; } let i = 2; while (used.has(`${pool[0]}${i}`)) i++; return `${pool[0]}${i}`; };

function genFunc(r, name) {
  const used = new Set();
  const nPos = Math.floor(r() * 4), nDef = Math.min(nPos, Math.floor(r() * 3));
  const pos = Array.from({ length: nPos }, (_, i) => { const p = freshName(r, PARAMS, used); used.add(p); return { name: p, def: i >= nPos - nDef ? pick(r, LITERALS) : null }; });
  const star = r() < 0.25 ? (used.add('args'), 'args') : null;
  const kwonly = Array.from({ length: r() < 0.3 ? 1 + Math.floor(r() * 2) : 0 }, () => { const p = freshName(r, PARAMS, used); used.add(p); return { name: p, def: r() < 0.6 ? pick(r, LITERALS) : null }; });
  const kw = r() < 0.2 ? 'kwargs' : null;
  return { kind: 'func', name, pos, star, kwonly, kw };
}

export function genModule(r) {
  const used = new Set();
  const defs = [];
  const n = 2 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const roll = r();
    if (roll < 0.2) { const nm = freshName(r, ['_helper', '_cache', '_norm', '_impl'], used); used.add(nm); defs.push(genFunc(r, nm)); continue; }
    if (roll < 0.45) {
      const nm = freshName(r, CLASSES, used); used.add(nm);
      const methods = [];
      if (r() < 0.7) methods.push(genFunc(r, '__init__'));
      const mu = new Set(['__init__']);
      for (let j = Math.floor(r() * 3); j > 0; j--) { const m = freshName(r, [...FUNCS, '_private'], mu); mu.add(m); methods.push(genFunc(r, m)); }
      defs.push({ kind: 'class', name: nm, methods });
      continue;
    }
    const nm = freshName(r, FUNCS, used); used.add(nm); defs.push(genFunc(r, nm));
  }
  const imports = IMPORTS.filter(() => r() < 0.3);
  return { imports, defs, syntax: false };
}

function renderParams(f, self) {
  const ps = [];
  if (self) ps.push('self');
  for (const p of f.pos) ps.push(p.def === null ? p.name : `${p.name}=${p.def}`);
  if (f.star) ps.push(`*${f.star}`);
  else if (f.kwonly.length) ps.push('*');
  for (const p of f.kwonly) ps.push(p.def === null ? p.name : `${p.name}=${p.def}`);
  if (f.kw) ps.push(`**${f.kw}`);
  return ps.join(', ');
}

export function render(m) {
  const lines = [...m.imports, ''];
  for (const d of m.defs) {
    if (d.kind === 'func') lines.push(`def ${d.name}(${renderParams(d, false)}):`, '    return None', '');
    else {
      lines.push(`class ${d.name}:`);
      if (!d.methods.length) lines.push('    pass');
      for (const f of d.methods) lines.push(`    def ${f.name}(${renderParams(f, true)}):`, '        return None');
      lines.push('');
    }
  }
  if (m.syntax) lines.push('def broken(:', '    pass');
  return lines.join('\n');
}

const publicFuncs = m => m.defs.filter(d => d.kind === 'func' && !d.name.startsWith('_'));
const allSigs = m => [...m.defs.filter(d => d.kind === 'func'), ...m.defs.filter(d => d.kind === 'class').flatMap(c => c.methods)];

/** Edit operators: each returns true when it applied (it may refuse when the module has nothing to edit). */
export const EDITS = {
  'pos-default-value': (r, m) => { const fs = allSigs(m).filter(f => f.pos.some(p => p.def !== null) && (!f.name.startsWith('_') || f.name === '__init__')); if (!fs.length) return false; const f = pick(r, fs); const p = pick(r, f.pos.filter(x => x.def !== null)); const v = pick(r, LITERALS.filter(l => l !== p.def)); p.def = v; return true; },
  'kwonly-default-value': (r, m) => { const fs = allSigs(m).filter(f => f.kwonly.some(p => p.def !== null)); if (!fs.length) return false; const p = pick(r, pick(r, fs).kwonly.filter(x => x.def !== null)); p.def = pick(r, LITERALS.filter(l => l !== p.def)); return true; },
  'add-param': (r, m) => { const fs = allSigs(m); if (!fs.length) return false; const f = pick(r, fs); const used = new Set([...f.pos, ...f.kwonly].map(p => p.name)); f.pos.push({ name: freshName(r, PARAMS, used), def: pick(r, LITERALS) }); return true; },
  'remove-param': (r, m) => { const fs = allSigs(m).filter(f => f.pos.length); if (!fs.length) return false; const f = pick(r, fs); f.pos.splice(Math.floor(r() * f.pos.length), 1); return true; },
  'rename-param': (r, m) => { const fs = allSigs(m).filter(f => f.pos.length + f.kwonly.length); if (!fs.length) return false; const f = pick(r, fs); const all = [...f.pos, ...f.kwonly]; const used = new Set(all.map(p => p.name)); pick(r, all).name = freshName(r, PARAMS, used); return true; },
  'add-default': (r, m) => { const fs = allSigs(m).filter(f => f.pos.some(p => p.def === null)); if (!fs.length) return false; const f = pick(r, fs); const ps = f.pos.filter(p => p.def === null); ps.at(-1).def = pick(r, LITERALS); return true; },
  'remove-default': (r, m) => { const fs = allSigs(m).filter(f => f.pos.some(p => p.def !== null)); if (!fs.length) return false; const f = pick(r, fs); f.pos.find(p => p.def !== null).def = null; return true; },
  'add-star': (r, m) => { const fs = allSigs(m).filter(f => !f.star); if (!fs.length) return false; pick(r, fs).star = 'args'; return true; },
  'remove-star': (r, m) => { const fs = allSigs(m).filter(f => f.star); if (!fs.length) return false; pick(r, fs).star = null; return true; },
  'add-kwonly': (r, m) => { const fs = allSigs(m); if (!fs.length) return false; const f = pick(r, fs); const used = new Set([...f.pos, ...f.kwonly].map(p => p.name)); f.kwonly.push({ name: freshName(r, PARAMS, used), def: r() < 0.5 ? pick(r, LITERALS) : null }); return true; },
  'toggle-kw': (r, m) => { const fs = allSigs(m); if (!fs.length) return false; const f = pick(r, fs); f.kw = f.kw ? null : 'kwargs'; return true; },
  'func-to-class': (r, m) => { const fs = publicFuncs(m); if (!fs.length) return false; const f = pick(r, fs); const i = m.defs.indexOf(f); m.defs[i] = { kind: 'class', name: f.name, methods: r() < 0.6 ? [{ ...copy(f), name: '__init__' }] : [] }; return true; },
  'class-to-func': (r, m) => { const cs = m.defs.filter(d => d.kind === 'class'); if (!cs.length) return false; const c = pick(r, cs); const i = m.defs.indexOf(c); m.defs[i] = genFunc(r, c.name); return true; },
  'remove-name': (r, m) => { const ds = m.defs.filter(d => !d.name.startsWith('_')); if (!ds.length) return false; m.defs.splice(m.defs.indexOf(pick(r, ds)), 1); return true; },
  'rename-name': (r, m) => { const ds = m.defs.filter(d => !d.name.startsWith('_')); if (!ds.length) return false; const used = new Set(m.defs.map(d => d.name)); const d = pick(r, ds); d.name = freshName(r, d.kind === 'class' ? CLASSES : FUNCS, used); return true; },
  'add-name': (r, m) => { const used = new Set(m.defs.map(d => d.name)); m.defs.push(genFunc(r, freshName(r, FUNCS, used))); return true; },
  'add-import': (r, m) => { const left = IMPORTS.filter(i => !m.imports.includes(i)); if (!left.length) return false; m.imports.push(pick(r, left)); return true; },
  'private-change': (r, m) => { const fs = m.defs.filter(d => d.kind === 'func' && d.name.startsWith('_')); if (!fs.length) return false; const f = pick(r, fs); const used = new Set([...f.pos, ...f.kwonly].map(p => p.name)); f.pos.push({ name: freshName(r, PARAMS, used), def: '0' }); return true; },
  'method-to-private': (r, m) => { const cs = m.defs.filter(d => d.kind === 'class' && d.methods.some(f => !f.name.startsWith('_'))); if (!cs.length) return false; const f = pick(r, pick(r, cs).methods.filter(x => !x.name.startsWith('_'))); f.name = `_${f.name}`; return true; },
  syntax: (r, m) => { m.syntax = true; return true; },
};
// Edit draw weights: default-value edits are frequent so the justified class is well populated.
const WEIGHTS = Object.entries({ 'pos-default-value': 8, 'kwonly-default-value': 2, 'add-param': 2, 'remove-param': 2, 'rename-param': 2, 'add-default': 2,
  'remove-default': 2, 'add-star': 1, 'remove-star': 1, 'add-kwonly': 1, 'toggle-kw': 1, 'func-to-class': 2, 'class-to-func': 2, 'remove-name': 1,
  'rename-name': 1, 'add-name': 2, 'add-import': 1, 'private-change': 2, 'method-to-private': 1, syntax: 0.3 });
const drawEdit = r => { const tot = WEIGHTS.reduce((a, [, w]) => a + w, 0); let x = r() * tot; for (const [k, w] of WEIGHTS) { x -= w; if (x < 0) return k; } return WEIGHTS.at(-1)[0]; };

// ---------------------------------------------------------------------------------------------------------------------
// The class oracle: from the two structured models, never from the edit labels. Mirrors what the base check calls the
// public API (public top-level functions; classes as a kind marker; their public methods and __init__) and imports.

const sigOf = f => ({ args: f.pos.map(p => p.name), defaults: f.pos.filter(p => p.def !== null).map(p => p.def), kwonly: f.kwonly.map(p => p.name), star: f.star, kw: f.kw });
export function apiOf(m) {
  const api = new Map();
  for (const d of m.defs) {
    if (d.name.startsWith('_')) continue;
    if (d.kind === 'func') api.set(d.name, sigOf(d));
    else {
      api.set(d.name, 'class');
      for (const f of d.methods) if (!f.name.startsWith('_') || f.name === '__init__') api.set(`${d.name}.${f.name}`, { ...sigOf(f), args: ['self', ...sigOf(f).args] });
    }
  }
  return api;
}

/** 'syntax' | 'identical' | 'default-values-only' | 'other' (what changed in the public API, by the models). */
export function changeClass(src, cand) {
  if (cand.syntax) return 'syntax';
  if (cand.imports.some(i => !src.imports.includes(i))) return 'other';
  const a = apiOf(src), b = apiOf(cand);
  let defaults = false;
  for (const [k, s] of a) {
    if (!b.has(k)) return 'other';
    const t = b.get(k);
    if (s === 'class') continue;                              // the base compares no class marker (only its methods)
    if (t === 'class') return 'other';
    if (JSON.stringify([s.args, s.kwonly, s.star, s.kw, s.defaults.length]) !== JSON.stringify([t.args, t.kwonly, t.star, t.kw, t.defaults.length])) return 'other';
    if (JSON.stringify(s.defaults) !== JSON.stringify(t.defaults)) defaults = true;
  }
  return defaults ? 'default-values-only' : 'identical';
}

/** n fuzzed inputs: [{ id, edits, cls, input: { source, candidate, tests, module_path }, models }]. */
export function generate(n, seed) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = genModule(r);
    const cand = copy(src);
    const edits = [];
    for (let k = 1 + Math.floor(r() * 3); k > 0; k--) { const e = drawEdit(r); if (EDITS[e](r, cand)) edits.push(e); }
    out.push({ id: `f${String(i).padStart(5, '0')}`, edits, cls: changeClass(src, cand), input: { source: render(src), candidate: render(cand), tests: '', module_path: 'module.py' }, models: { src, cand } });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sandboxed runner

// The stored check scripts are model-written: besides the namespace sandbox with the network off, the runner caps the
// process before it loads one (review 2026-11-04, D13): 2 GiB of address space, 1 MiB per written file, 900 s of CPU
// (the wall-clock timeout stays the host's), and RLIMIT_NPROC 0. Measured on this host: the first three hold; NPROC does
// not, because the sandbox maps to the real uid 0, which the kernel exempts from RLIMIT_NPROC. So process creation is
// also refused at the Python level (os.fork/exec*/spawn*/system/posix_spawn*, subprocess): defence in depth, not a
// boundary (a script can reach the raw syscalls through ctypes); the pid namespace and the group kill bound the rest.
export const RUNNER = `import json, sys, traceback, resource
def _cap(r, v):
    try:
        resource.setrlimit(r, (v, v))
    except (ValueError, OSError) as e:
        sys.stderr.write('runner: cannot set rlimit ' + str(r) + ': ' + str(e) + '\\n')
        sys.exit(3)
_cap(resource.RLIMIT_AS, 2 << 30)
_cap(resource.RLIMIT_NPROC, 0)
_cap(resource.RLIMIT_FSIZE, 1 << 20)
_cap(resource.RLIMIT_CPU, 900)
import os, subprocess
def _refuse(*a, **k):
    raise PermissionError('process creation is not allowed in a check script')
for _n in ['fork', 'forkpty', 'system', 'popen', 'posix_spawn', 'posix_spawnp', 'execv', 'execve', 'execl', 'execle', 'execlp', 'execlpe', 'execvp', 'execvpe', 'spawnv', 'spawnve', 'spawnl', 'spawnle', 'spawnlp', 'spawnlpe', 'spawnvp', 'spawnvpe']:
    if hasattr(os, _n):
        setattr(os, _n, _refuse)
subprocess.Popen = _refuse
src = open(sys.argv[1]).read()
ns = {'__name__': 'checker'}
exec(compile(src, 'checker.py', 'exec'), ns)
main = ns['main']
for line in sys.stdin:
    rec = json.loads(line)
    try:
        out = main(rec['input'])
        print(json.dumps({'id': rec['id'], 'verdict': bool(out.get('ok')), 'problems': out.get('problems'), 'compile_error': out.get('compile_error')}))
    except Exception as e:
        print(json.dumps({'id': rec['id'], 'crash': type(e).__name__ + ': ' + str(e)[:200]}))
    sys.stdout.flush()
`;

/** Run one check script over inputs in the sandbox: { id: { verdict, problems } | { crash } }. */
export async function runScript(script, inputs, { workRoot = '/var/tmp/foundry-work/heal2-fuzz', timeoutMs = 600_000 } = {}) {
  if (!sandboxAvailable()) throw new Error('sandbox unavailable: user/mount/pid namespaces are required to run stored check scripts');
  mkdirSync(workRoot, { recursive: true });
  const dir = mkdtempSync(path.join(workRoot, 'run-'));
  try {
    writeFileSync(path.join(dir, 'runner.py'), RUNNER);
    writeFileSync(path.join(dir, 'checker.py'), script);
    const script2 = sandboxScript(maskSteps({ workdir: dir, hidden: DEFAULT_HIDDEN, keepRo: binaryKeeps(['python3']) }), dir, ['python3', '-I', 'runner.py', 'checker.py']);
    const child = spawn('unshare', [...UNSHARE_ARGS, '--net', 'sh', '-c', script2], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { if (err.length < 16384) err += d; });
    const done = new Promise((resolve, reject) => {
      const t = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } reject(new Error('runner timeout')); }, timeoutMs);
      child.on('close', code => { clearTimeout(t); resolve(code); });
    });
    for (const x of inputs) child.stdin.write(JSON.stringify({ id: x.id, input: x.input }) + '\n');
    child.stdin.end();
    const code = await done;
    const res = {};
    for (const line of out.split('\n')) if (line.trim()) { const o = JSON.parse(line); res[o.id] = o; }
    const missing = inputs.filter(x => !res[x.id]);
    if (missing.length) throw new Error(`runner exit ${code}: ${missing.length} input(s) unanswered; stderr: ${err.slice(-600)}`);
    return res;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Shrink a failing input to a minimal module pair (ddmin over the source's definitions, kept by name in both). */
export async function shrink(x, script, isFailure) {
  const names = x.models.src.defs.map(d => d.name);
  const keep = sub => {
    const s = copy(x.models.src), c = copy(x.models.cand);
    s.defs = s.defs.filter(d => sub.includes(d.name));
    c.defs = c.defs.filter(d => sub.includes(d.name) || !names.includes(d.name));
    return { id: `${x.id}-min`, input: { source: render(s), candidate: render(c), tests: '', module_path: 'module.py' }, models: { src: s, cand: c } };
  };
  const { items, tests } = await ddmin(names, async sub => isFailure((await runScript(script, [keep(sub)]))[`${x.id}-min`]));
  const min = keep(items);
  return { names: items, tests, source: min.input.source, candidate: min.input.candidate, cls: changeClass(min.models.src, min.models.cand) };
}

export async function cfxFuzz({ n = 5000, seed = 20261028, log = console.log } = {}) {
  const { scripts, meta } = loadScripts();
  const xs = generate(n, seed);
  const ids = xs.map(x => x.id);
  const byId = Object.fromEntries(xs.map(x => [x.id, x]));
  const outputs = {};
  for (const [who, s] of Object.entries(scripts)) { const t = Date.now(); outputs[who] = await runScript(s, xs); log(`${who}: ${n} inputs in ${Date.now() - t} ms`); }
  // Harness sanity: the base must agree with the model oracle where the oracle is unambiguous.
  const sanity = { identicalNotOk: ids.filter(id => byId[id].cls === 'identical' && outputs.base[id].verdict !== true).length,
    defaultsOk: ids.filter(id => byId[id].cls === 'default-values-only' && outputs.base[id].verdict !== false).length,
    syntaxOk: ids.filter(id => byId[id].cls === 'syntax' && outputs.base[id].verdict !== false).length, baseCrashes: ids.filter(id => outputs.base[id].crash).length };
  const classes = ids.reduce((o, id) => { o[byId[id].cls] = (o[byId[id].cls] ?? 0) + 1; return o; }, {});
  const edits = xs.reduce((o, x) => { for (const e of new Set(x.edits)) o[e] = (o[e] ?? 0) + 1; return o; }, {});
  const certs = {};
  for (const who of ['sonnet', 'haiku', 'opus']) {
    certs[who] = differentialGate({ ids, inClass: id => byId[id].cls === 'default-values-only', intended: () => true, base: outputs.base, candidate: outputs[who] });
  }
  // the base as its own candidate: never exercises the repair (inconclusive by construction)
  certs.base = differentialGate({ ids, inClass: id => byId[id].cls === 'default-values-only', intended: () => true, base: outputs.base, candidate: outputs.base });
  const pw = pairwise(ids, { sonnet: outputs.sonnet, haiku: outputs.haiku, opus: outputs.opus });
  // crash anatomy and shrunk notices
  const anatomy = {};
  for (const who of ['sonnet', 'haiku', 'opus']) {
    const crashed = ids.filter(id => outputs[who][id].crash);
    const byEdit = {}, byMsg = {};
    for (const id of crashed) { for (const e of new Set(byId[id].edits)) byEdit[e] = (byEdit[e] ?? 0) + 1; const m = outputs[who][id].crash.split(':')[0]; byMsg[m] = (byMsg[m] ?? 0) + 1; }
    const kindChanged = crashed.filter(id => byId[id].edits.includes('func-to-class')).length;
    const withFtc = ids.filter(id => byId[id].edits.includes('func-to-class') && !outputs.base[id].crash).length;
    anatomy[who] = { crashes: crashed.length, byEdit, byMessage: byMsg, crashesWithFuncToClass: kindChanged, inputsWithFuncToClass: withFtc, example: crashed[0] ? { id: crashed[0], crash: outputs[who][crashed[0]].crash, edits: byId[crashed[0]].edits } : null };
    if (crashed.length) anatomy[who].shrunk = await shrink(byId[crashed[0]], scripts[who], o => !!o?.crash);
  }
  return { evidence: 'development, $0 (stored candidate scripts executed in the executor sandbox on generated inputs; no model call)', n, seed, scripts: meta,
    generator: { classes, edits }, sanity, gate: gateTable(certs), certificates: certs, pairwise: pw, anatomy };
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.chdir(ROOT);
  const res = await cfxFuzz({ n: Number(arg('--n', '5000')), seed: Number(arg('--seed', '20261028')) });
  const out = path.resolve(ROOT, arg('--out', 'research/blockers-20261021/move8/cfx-fuzz.json'));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ sanity: res.sanity, classes: res.generator.classes, gate: res.gate, pairwise: res.pairwise, anatomy: Object.fromEntries(Object.entries(res.anatomy).map(([k, v]) => [k, { crashes: v.crashes, byMessage: v.byMessage, crashesWithFuncToClass: v.crashesWithFuncToClass, inputsWithFuncToClass: v.inputsWithFuncToClass, shrunk: v.shrunk ? { names: v.shrunk.names, cls: v.shrunk.cls } : null }])) }, null, 1));
}
