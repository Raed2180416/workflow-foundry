// node tools/check-traces.mjs [--only 0,3,case-1] [--max <n>] [--jobs <n>] [--timeout <seconds>] [--out <dir>]
// Differential test (research/jit-20261008/SPEC.md §3.3): runs ./solve.mjs on every trace (traces/trace-<i>/) and
// regression case (regressions/case-<i>/) exactly as ./tools/run-solver does: a fresh copy of the task files only, solve.mjs,
// tools/model.mjs + tools/flow.mjs + tools/gateway.json beside it, PATH=/opt/node24/bin:/usr/local/bin:/usr/bin:/bin,
// HOME = the run directory and no other environment. Each case's run directory (stdout, stderr, trace.jsonl, deopt.json)
// is kept under --out (default .check/). Model calls are real and cost money: use --only and --max while iterating.
// The output is compared with agent-answer.json (or expected.json) by a generic deep diff on canonical JSON. It prints
// a table, then one aggregate JSON line (always the last stdout line).
// Opt-in (JIT v2.1): --tolerant [--rel-tol r] [--abs-tol a] compares with ./compare.mjs (numbers within tolerance, strings
// trimmed, arrays as multisets) instead; a check-traces.json beside this file ({"compare":"tolerant","relTol":..,"absTol":..})
// makes that the default here, and --exact restores canonical comparison. Without either, nothing changes.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, copyFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEOPT_EXIT = 75;
export const TASK_FILES = ['prompt.md', 'inputs.json', 'task.json', 'files'];   // never the label files
const RUN_PATH = '/opt/node24/bin:/usr/local/bin:/usr/bin:/bin';
const MISSING = '<missing>', EXTRA = '<not expected>';

export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
// A leaf is a primitive or an empty container; a container counts the leaves inside it.
export function leaves(v) {
  if (Array.isArray(v)) return v.length ? v.reduce((s, x) => s + leaves(x), 0) : 1;
  if (isObj(v)) { const ks = Object.keys(v); return ks.length ? ks.reduce((s, k) => s + leaves(v[k]), 0) : 1; }
  return 1;
}

// Deep diff of an output (got) against a label (want). exact: equal canonical JSON. partial: matched leaves / compared
// leaves, where objects compare key by key (a missing or extra key counts its leaves as misses) and array items are
// paired by best overlap (equal items first, then the pairs that share the most leaves); unpaired items are misses.
export function compare(got, want, { maxDiffs = 20 } = {}) {
  const memo = new WeakMap();
  const canon = v => { if (v === null || typeof v !== 'object') return canonical(v); let c = memo.get(v); if (c === undefined) { c = canonical(v); memo.set(v, c); } return c; };
  const diffs = [];
  const note = (p, g, w) => { if (diffs.length < maxDiffs) diffs.push({ path: p, got: g, want: w }); };
  function cmp(a, b, p, record) {
    if (canon(a) === canon(b)) { const n = leaves(b); return { m: n, n }; }
    if (isObj(a) && isObj(b)) {
      let m = 0, n = 0;
      for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
        const kp = /^[A-Za-z_$][\w$]*$/.test(k) ? `${p}.${k}` : `${p}[${JSON.stringify(k)}]`;
        if (!Object.hasOwn(a, k)) { n += leaves(b[k]); if (record) note(kp, MISSING, b[k]); }
        else if (!Object.hasOwn(b, k)) { n += leaves(a[k]); if (record) note(kp, a[k], EXTRA); }
        else { const r = cmp(a[k], b[k], kp, record); m += r.m; n += r.n; }
      }
      return { m, n };
    }
    if (Array.isArray(a) && Array.isArray(b)) return cmpArrays(a, b, p, record);
    if (record) note(p, a, b);
    return { m: 0, n: Math.max(leaves(a), leaves(b)) };
  }
  function cmpArrays(a, b, p, record) {
    let m = 0, n = 0;
    const freeA = new Map();   // canonical -> unpaired indexes of a
    a.forEach((x, i) => { const k = canon(x); freeA.set(k, [...(freeA.get(k) ?? []), i]); });
    const restB = [];
    b.forEach((y, j) => { const list = freeA.get(canon(y)); if (list?.length) { list.shift(); const l = leaves(y); m += l; n += l; } else restB.push(j); });
    const restA = [...freeA.values()].flat().sort((x, y) => x - y);
    const pairs = [];
    if (restA.length && restB.length) {
      if (restA.length * restB.length <= 40000) {
        const cand = [];
        for (const i of restA) for (const j of restB) { const r = cmp(a[i], b[j], '', false); if (r.m > 0) cand.push({ i, j, m: r.m, f: r.m / r.n }); }
        cand.sort((x, y) => y.m - x.m || y.f - x.f || Math.abs(x.i - x.j) - Math.abs(y.i - y.j));
        const usedA = new Set(), usedB = new Set();
        for (const c of cand) if (!usedA.has(c.i) && !usedB.has(c.j)) { usedA.add(c.i); usedB.add(c.j); pairs.push(c); }
      } else for (let k = 0; k < Math.min(restA.length, restB.length); k++) pairs.push({ i: restA[k], j: restB[k] });   // too large: by position
    }
    const pairedA = new Set(pairs.map(c => c.i)), pairedB = new Set(pairs.map(c => c.j));
    for (const c of pairs.sort((x, y) => x.j - y.j)) { const r = cmp(a[c.i], b[c.j], `${p}[${c.j}]`, record); m += r.m; n += r.n; }
    for (const j of restB) if (!pairedB.has(j)) { n += leaves(b[j]); if (record) note(`${p}[${j}]`, MISSING, b[j]); }
    for (const i of restA) if (!pairedA.has(i)) { n += leaves(a[i]); if (record) note(`${p}[got ${i}]`, a[i], EXTRA); }
    return { m, n };
  }
  const r = cmp(got, want, '$', true);
  return { exact: canon(got) === canon(want), partial: r.n ? r.m / r.n : 1, matched: r.m, compared: r.n, diffs };
}

const short = (v, n = 80) => { const s = typeof v === 'string' && (v === MISSING || v === EXTRA) ? v : canonical(v); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const readJson = file => { try { return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) }; } catch { return { ok: false }; } };

export function listCases(root) {
  const cases = [];
  const scan = (sub, prefix, kind, label) => {
    const dir = path.join(root, sub);
    if (!existsSync(dir)) return;
    const names = readdirSync(dir).filter(d => new RegExp(`^${prefix}-\\d+$`).test(d)).sort((x, y) => Number(x.split('-')[1]) - Number(y.split('-')[1]));
    for (const id of names) cases.push({ id, kind, dir: path.join(dir, id), labelFile: path.join(dir, id, label) });
  };
  // Regression cases first: each one must pass, so a capped run (--max) checks them before the traces.
  scan('regressions', 'case', 'regression', 'expected.json');
  scan('traces', 'trace', 'trace', 'agent-answer.json');
  return cases;
}

// The gateway config for a run directory: a unix socket path is relative to the tools directory that holds it.
function gatewayFor(toolsDir, runTools) {
  const cfg = JSON.parse(readFileSync(path.join(toolsDir, 'gateway.json'), 'utf8'));
  return cfg.socket ? { ...cfg, socket: path.relative(runTools, path.resolve(toolsDir, cfg.socket)) } : cfg;
}

// Tolerant comparison (opt-in): compare.mjs is loaded only then, so a canonical run needs nothing beside this file.
async function tolerantCompare(output, label, cmp) {
  let mod;
  try { mod = await import(new URL('./compare.mjs', import.meta.url).href); }
  catch (e) { throw new Error(`tolerant comparison needs compare.mjs beside check-traces.mjs (${e.message})`); }
  const d = mod.tolerantAgreement(output, label, { relTol: cmp.relTol, absTol: cmp.absTol });
  return { ...d, canonicalExact: compare(output, label, { maxDiffs: 0 }).exact };
}

export async function runCase(c, { root, out, toolsDir, timeoutMs, cmp = null }) {
  const dir = path.resolve(out, c.id), tools = path.join(dir, 'tools');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(tools, { recursive: true });
  for (const f of TASK_FILES) if (existsSync(path.join(c.dir, f))) cpSync(path.join(c.dir, f), path.join(dir, f), { recursive: true });
  copyFileSync(path.join(root, 'solve.mjs'), path.join(dir, 'solve.mjs'));
  for (const f of ['model.mjs', 'flow.mjs']) if (existsSync(path.join(toolsDir, f))) copyFileSync(path.join(toolsDir, f), path.join(tools, f));
  writeFileSync(path.join(tools, 'gateway.json'), JSON.stringify(gatewayFor(toolsDir, tools)));
  const started = Date.now();
  const child = spawn('node', ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: RUN_PATH, LANG: 'C.UTF-8', HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', d => { if (stdout.length < 8 * 1024 * 1024) stdout += d; });
  child.stderr.on('data', d => { if (stderr.length < 256 * 1024) stderr += d; });
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
  const code = await new Promise(resolve => { child.on('error', () => resolve(-1)); child.on('close', c2 => resolve(c2)); });
  clearTimeout(timer);
  writeFileSync(path.join(dir, '.stdout'), stdout); writeFileSync(path.join(dir, '.stderr'), stderr);
  let costUsd = 0;
  try { for (const l of readFileSync(path.join(tools, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean)) costUsd += JSON.parse(l).costUsd ?? 0; } catch {}
  const base = { id: c.id, kind: c.kind, exitCode: code, ms: Date.now() - started, costUsd: Math.round(costUsd * 1e6) / 1e6 };
  // The error line of a crash (Node prints the stack, then its version): the last 'SomeError: ...' line, else the last line.
  const lines = stderr.trim().split('\n').filter(l => l.trim() && !l.startsWith('[model]') && !/^Node\.js v\d/.test(l) && !/^\s+at /.test(l));
  const tail = [...lines].reverse().find(l => /^\w*Error\b|^Uncaught/.test(l)) ?? lines.at(-1) ?? '';
  if (timedOut) return { ...base, status: 'timeout', note: `killed after ${Math.round(timeoutMs / 1000)} s` };
  if (code === DEOPT_EXIT) {
    const d = readJson(path.join(dir, 'deopt.json'));
    const deopt = d.ok ? { kind: d.value.kind ?? 'unknown', name: d.value.name ?? null } : { kind: 'unknown', name: null };
    return { ...base, status: 'deopt', deopt, note: `${deopt.kind}:${deopt.name ?? '?'} ${d.ok ? short(d.value.detail, 100) : 'no deopt.json'}` };
  }
  if (code !== 0) return { ...base, status: 'crash', note: `exit ${code}: ${tail.slice(0, 160)}` };
  let output;
  try { output = JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1)); } catch { return { ...base, status: 'crash', note: 'exit 0 but the last stdout line is not JSON' }; }
  const label = readJson(c.labelFile);
  if (!label.ok || label.value === null) return { ...base, status: 'unlabeled', note: `no usable ${path.basename(c.labelFile)}` };
  const d = cmp?.mode === 'tolerant' ? await tolerantCompare(output, label.value, cmp) : compare(output, label.value);
  return { ...base, status: d.exact ? 'exact' : 'diff', exact: d.exact, partial: Math.round(d.partial * 1000) / 1000,
    ...(cmp?.mode === 'tolerant' ? { canonicalExact: d.canonicalExact, ...(d.approx ? { approx: d.approx } : {}) } : {}),
    diffs: d.diffs.slice(0, 5).map(x => ({ path: x.path, got: short(x.got, 120), want: short(x.want, 120) })),
    ...(d.exact ? {} : { note: d.diffs.slice(0, 2).map(x => `${x.path}: got ${short(x.got, 40)} want ${short(x.want, 40)}`).join('; ') + (d.diffs.length > 2 ? `; +${d.diffs.length - 2} more` : '') }) };
}

export function aggregate(perCase, { total, cmp = null }) {
  const labeled = perCase.filter(c => c.status !== 'unlabeled');
  const count = s => perCase.filter(c => c.status === s).length;
  const deoptKinds = {};
  for (const c of perCase) if (c.status === 'deopt') deoptKinds[c.deopt.kind] = (deoptKinds[c.deopt.kind] ?? 0) + 1;
  const regs = perCase.filter(c => c.kind === 'regression');
  const exact = count('exact'), crashes = count('crash'), timeouts = count('timeout'), deopts = count('deopt');
  const complete = perCase.length === total;
  return {
    cases: perCase.length, total, complete, labeled: labeled.length, exact, exactRate: labeled.length ? Math.round((exact / labeled.length) * 1000) / 1000 : null,
    partial: labeled.length ? Math.round((labeled.reduce((s, c) => s + (c.partial ?? 0), 0) / labeled.length) * 1000) / 1000 : null,
    diffs: count('diff'), deopts, deoptKinds, crashes, timeouts, regressions: regs.length, regressionsPassed: regs.filter(c => c.status === 'exact').length,
    // Acceptance (SPEC addendum 4): every case ran, none crashed, deopted or timed out, and every regression case passes.
    // Disagreements with agent answers are a diagnostic; each must be explained in BUILD-NOTES.md.
    clean: complete && crashes + timeouts + deopts === 0 && regs.every(c => c.status === 'exact'),
    costUsd: Math.round(perCase.reduce((s, c) => s + c.costUsd, 0) * 1e6) / 1e6,
    // Tolerant runs only: the comparison used, and how many cases are also exact under canonical JSON (a diagnostic).
    ...(cmp?.mode === 'tolerant' ? { compare: { mode: 'tolerant', relTol: cmp.relTol, absTol: cmp.absTol }, canonicalExact: perCase.filter(c => c.canonicalExact).length } : {}),
    perCase,
  };
}

export function table(perCase) {
  const rows = [['case', 'status', 'partial', '$', 's', 'note']];
  for (const c of perCase) rows.push([c.id, c.status, c.partial == null ? '-' : `${Math.round(c.partial * 100)}%`, c.costUsd.toFixed(4), (c.ms / 1000).toFixed(1), c.note ?? '']);
  const w = rows[0].map((_, k) => Math.max(...rows.map(r => (k === 5 ? 0 : String(r[k]).length))));
  return rows.map(r => r.map((x, k) => (k === 5 ? x : String(x).padEnd(w[k]))).join('  ').trimEnd()).join('\n');
}

export function parseArgs(argv) {
  const o = { only: null, max: Infinity, jobs: 3, timeout: 600, out: '.check' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--only') { o.only = String(v).split(',').map(s => s.trim()).filter(Boolean).map(s => (/^\d+$/.test(s) ? `trace-${s}` : s)); i++; }
    else if (a === '--max') { o.max = Number(v); i++; }
    else if (a === '--jobs') { o.jobs = Math.max(1, Number(v) || 1); i++; }
    else if (a === '--timeout') { o.timeout = Number(v); i++; }
    else if (a === '--out') { o.out = v; i++; }
    else if (a === '--tolerant') o.compare = 'tolerant';
    else if (a === '--exact') o.compare = 'canonical';
    else if (a === '--rel-tol' || a === '--abs-tol') {
      const x = Number(v);
      if (v == null || !Number.isFinite(x) || x < 0) throw new Error(`${a} needs a finite number >= 0`);
      o[a === '--rel-tol' ? 'relTol' : 'absTol'] = x; i++;
    }
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

// The comparison for a run: the options, else check-traces.json beside this file, else canonical (null).
export function comparisonOf(o, defaults = null) {
  const mode = o.compare ?? defaults?.compare ?? 'canonical';
  if (mode !== 'tolerant') {
    if (o.relTol != null || o.absTol != null) throw new Error('--rel-tol and --abs-tol need --tolerant');
    return null;
  }
  const relTol = o.relTol ?? defaults?.relTol ?? 0.01, absTol = o.absTol ?? defaults?.absTol ?? 1e-9;
  for (const [k, x] of [['relTol', relTol], ['absTol', absTol]]) if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new Error(`${k} must be a finite number >= 0`);
  return { mode: 'tolerant', relTol, absTol };
}
const readDefaults = toolsDir => { const f = path.join(toolsDir, 'check-traces.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };

export async function main(argv = process.argv.slice(2), { root = process.cwd(), toolsDir = path.dirname(fileURLToPath(import.meta.url)) } = {}) {
  let o;
  let cmp;
  try { o = parseArgs(argv); cmp = comparisonOf(o, readDefaults(toolsDir)); }
  catch (e) { console.error(`${e.message}\nusage: node tools/check-traces.mjs [--only 0,3,case-1] [--max n] [--jobs n] [--timeout s] [--out dir] [--tolerant [--rel-tol r] [--abs-tol a] | --exact]`); return 2; }
  if (!existsSync(path.join(root, 'solve.mjs'))) { console.error('no ./solve.mjs to check'); console.log(JSON.stringify({ error: 'no solve.mjs', cases: 0 })); return 2; }
  const all = listCases(root);
  let cases = o.only ? all.filter(c => o.only.includes(c.id)) : all;
  cases = cases.slice(0, Number.isFinite(o.max) ? o.max : cases.length);
  const perCase = new Array(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(o.jobs, cases.length) }, async () => {
    while (next < cases.length) { const i = next++; perCase[i] = await runCase(cases[i], { root, out: path.resolve(root, o.out), toolsDir, timeoutMs: o.timeout * 1000, cmp }); }
  }));
  const agg = aggregate(perCase, { total: all.length, cmp });
  console.log(table(perCase));
  if (cmp) console.log(`comparison: tolerant (numbers within max(absTol ${cmp.absTol}, relTol ${cmp.relTol} x the larger magnitude), strings trimmed, arrays as multisets); `
    + `${agg.canonicalExact}/${agg.labeled} also exact under canonical JSON`);
  console.log(`${agg.exact}/${agg.labeled} exact, mean partial ${agg.partial == null ? '-' : Math.round(agg.partial * 100) + '%'}, ${agg.deopts} deopt, ${agg.crashes} crash, ${agg.timeouts} timeout; `
    + `regressions ${agg.regressionsPassed}/${agg.regressions}; $${agg.costUsd}${agg.complete ? '' : ` (ran ${agg.cases} of ${agg.total} cases)`}; run dirs in ${o.out}/`);
  console.log(JSON.stringify(agg));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
