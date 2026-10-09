// check-traces (SPEC §3.3): the generic deep diff, and a full run over stub cases with a stub solver. The stub gateway
// listens on a unix socket in tools/ (as in the host-side acceptance check), so the per-run socket rewrite is exercised.
// No live model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_TOOL, taskFiles } from '../../c0/construct.mjs';
import { compare, leaves, parseArgs, listCases } from '../check-traces.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

test('compare: exact under canonical JSON (key order, number spelling), order-sensitive exact, order-free partial', () => {
  assert.deepEqual(compare({ a: 1, b: [1, 2], c: 1.50 }, JSON.parse('{"c":1.5,"b":[1,2],"a":1}')), { exact: true, partial: 1, matched: 4, compared: 4, diffs: [] });
  const swapped = compare([1, 2, 3], [3, 2, 1]);
  assert.equal(swapped.exact, false); assert.equal(swapped.partial, 1, 'array items pair by best overlap, not position');
  assert.equal(leaves({ a: [], b: { c: [1, 2], d: {} } }), 4);
});

test('compare: arrays of objects are matched by best overlap; diff paths use the expected index', () => {
  const want = { records: [{ id: 1, name: 'Ann', amount: 1 }, { id: 2, name: 'Bo', amount: 2 }] };
  const got = { records: [{ id: 2, name: 'Bo', amount: 2 }, { id: 1, name: 'Ann', amount: 9 }] };
  const d = compare(got, want);
  assert.equal(d.exact, false); assert.equal(d.matched, 5); assert.equal(d.compared, 6); assert.ok(Math.abs(d.partial - 5 / 6) < 1e-9);
  assert.deepEqual(d.diffs, [{ path: '$.records[0].amount', got: 9, want: 1 }]);
});

test('compare: missing and extra items and keys, type mismatches and empty containers count as misses', () => {
  const missing = compare([{ id: 1 }], [{ id: 1 }, { id: 2 }]);
  assert.equal(missing.partial, 0.5); assert.deepEqual(missing.diffs, [{ path: '$[1]', got: '<missing>', want: { id: 2 } }]);
  const extra = compare({ a: 1, b: 2 }, { a: 1 });
  assert.equal(extra.partial, 0.5); assert.deepEqual(extra.diffs, [{ path: '$.b', got: 2, want: '<not expected>' }]);
  const extraItem = compare([1, 2, 7], [1, 2]);
  assert.ok(Math.abs(extraItem.partial - 2 / 3) < 1e-9); assert.deepEqual(extraItem.diffs, [{ path: '$[got 2]', got: 7, want: '<not expected>' }]);
  assert.equal(compare({ a: '1' }, { a: 1 }).partial, 0);
  assert.equal(compare({ a: [] }, { a: {} }).partial, 0);
  assert.equal(compare({ 'odd key': 1, toString: 2 }, { 'odd key': 2 }).diffs[0].path, '$["odd key"]', 'inherited names are not keys');
  assert.equal(compare({ toString: 2 }, {}).partial, 0);
  assert.equal(compare(null, null).exact, true);
});

test('parseArgs: --only takes trace numbers and case ids; --max, --jobs, --timeout, --out', () => {
  assert.deepEqual(parseArgs(['--only', '0, 3,case-1', '--max', '2', '--jobs', '1', '--timeout', '5', '--out', 'x']), { only: ['trace-0', 'trace-3', 'case-1'], max: 2, jobs: 1, timeout: 5, out: 'x' });
  assert.throws(() => parseArgs(['--bogus']), /unknown option --bogus/);
});

// The stub solver: each task's inputs.mode picks a behaviour.
const SOLVE = `import { createFlow } from './tools/flow.mjs';
import { existsSync } from 'node:fs';
const flow = createFlow({ budgetUsd: 1 });
const { mode } = flow.input().inputs;
for (const f of ['agent-answer.json', 'expected.json', 'agent-work.md']) if (existsSync(f)) throw new Error('label visible: ' + f);
if (mode === 'deopt') flow.guard('known-mode', false, { mode });
if (mode === 'crash') throw new Error('boom');
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'env') flow.done({ env: Object.keys(process.env).sort(), home: process.env.HOME === process.cwd() });
else if (mode === 'judge') flow.done(await flow.judge('pick', { tiers: ['claude-haiku-5-5'], prompt: 'pick', schema: { type: 'object', properties: { pick: { type: 'string' } }, required: ['pick'] } }));
else flow.done({ records: [{ id: 2, name: 'Bo', amount: 2 }, { id: 1, name: 'Ann', amount: 1 }] });
`;
const GOOD = { records: [{ id: 1, name: 'Ann', amount: 1 }, { id: 2, name: 'Bo', amount: 2 }] };
const CASES = [
  ['trace', 'ok', { records: [GOOD.records[1], GOOD.records[0]] }],
  ['trace', 'ok', { records: [{ id: 1, name: 'Ann', amount: 9 }, GOOD.records[1]] }],
  ['trace', 'deopt', GOOD],
  ['trace', 'crash', GOOD],
  ['trace', 'env', { env: ['HOME', 'LANG', 'PATH'], home: true }],
  ['trace', 'judge', { pick: 'b' }],
  ['trace', 'hang', GOOD],
  ['trace', 'ok', null],
  ['regression', 'ok', { records: [GOOD.records[1], GOOD.records[0]] }],
];

async function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jit-ct-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'tools'));
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL);
  copyFileSync(path.join(here, '../flow.mjs'), path.join(dir, 'tools/flow.mjs'));
  copyFileSync(path.join(here, '../check-traces.mjs'), path.join(dir, 'tools/check-traces.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ socket: 'gw.sock', token: 'tk' }));
  writeFileSync(path.join(dir, 'solve.mjs'), SOLVE);
  let ti = 0, ci = 0;
  for (const [kind, mode, label] of CASES) {
    const prefix = kind === 'trace' ? `traces/trace-${ti++}/` : `regressions/case-${ci++}/`;
    const files = { ...taskFiles({ prompt: `mode ${mode}`, inputs: { mode }, files: { 'note.txt': 'data' } }, prefix),
      [`${prefix}${kind === 'trace' ? 'agent-answer.json' : 'expected.json'}`]: JSON.stringify(label), ...(kind === 'trace' ? { [`${prefix}agent-work.md`]: '# work' } : {}) };
    for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), content); }
  }
  const calls = [];
  const server = http.createServer((req, res) => {
    let text = ''; req.on('data', c => { text += c; });
    req.on('end', () => { calls.push(JSON.parse(text)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value: { pick: 'b' }, costUsd: 0.01 })); });
  });
  await new Promise(resolve => server.listen(path.join(dir, 'tools/gw.sock'), resolve));
  t.after(() => server.close());
  return { dir, calls };
}

const check = (dir, args = []) => new Promise(resolve => {
  const child = spawn(process.execPath, ['tools/check-traces.mjs', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  child.on('close', code => resolve({ code, stdout, stderr, agg: JSON.parse(stdout.trim().split('\n').at(-1)) }));
});

test('check-traces runs every case like run-solver and classifies exact / diff / deopt / crash / timeout / unlabeled', async t => {
  const { dir, calls } = await setup(t);
  assert.deepEqual(listCases(dir).map(c => c.id), ['case-0', ...Array.from({ length: 8 }, (_, i) => `trace-${i}`)], 'regression cases come first');
  const r = await check(dir, ['--timeout', '3', '--jobs', '4']);
  assert.equal(r.code, 0, r.stderr);
  const a = r.agg, by = Object.fromEntries(a.perCase.map(c => [c.id, c]));
  assert.deepEqual(Object.fromEntries(a.perCase.map(c => [c.id, c.status])), { 'case-0': 'exact', 'trace-0': 'exact', 'trace-1': 'diff', 'trace-2': 'deopt', 'trace-3': 'crash',
    'trace-4': 'exact', 'trace-5': 'exact', 'trace-6': 'timeout', 'trace-7': 'unlabeled' });
  assert.equal(by['trace-4'].exact, true, 'env -i: only PATH, LANG and HOME (= the run directory), and no label files beside the solver');
  assert.ok(Math.abs(by['trace-1'].partial - 0.833) < 1e-9); assert.deepEqual(by['trace-1'].diffs, [{ path: '$.records[0].amount', got: '1', want: '9' }]);
  assert.deepEqual(by['trace-2'].deopt, { kind: 'guard', name: 'known-mode' }); assert.equal(by['trace-2'].exitCode, 75);
  assert.match(by['trace-3'].note, /exit 1: .*boom/);
  assert.equal(by['trace-5'].costUsd, 0.01); assert.equal(calls.length, 1, 'the judge reached the gateway through the rewritten socket path');
  assert.deepEqual({ cases: a.cases, total: a.total, complete: a.complete, labeled: a.labeled, exact: a.exact, diffs: a.diffs, deopts: a.deopts, crashes: a.crashes, timeouts: a.timeouts },
    { cases: 9, total: 9, complete: true, labeled: 8, exact: 4, diffs: 1, deopts: 1, crashes: 1, timeouts: 1 });
  assert.deepEqual(a.deoptKinds, { guard: 1 }); assert.equal(a.exactRate, 0.5); assert.equal(a.regressions, 1); assert.equal(a.regressionsPassed, 1);
  assert.equal(a.clean, false); assert.equal(a.costUsd, 0.01);
  assert.match(r.stdout, /trace-2\s+deopt\s+-\s+[\d.]+\s+[\d.]+\s+guard:known-mode/); assert.match(r.stdout, /4\/8 exact/);
  assert.ok(existsSync(path.join(dir, '.check/trace-5/trace.jsonl')), 'run directories are kept'); assert.ok(existsSync(path.join(dir, '.check/trace-0/files/note.txt')));
  assert.equal(JSON.parse(readFileSync(path.join(dir, '.check/trace-5/tools/gateway.json'), 'utf8')).socket, '../../../tools/gw.sock');
});

test('--only and --max select cases; a partial run is never clean; a missing solve.mjs exits 2', async t => {
  const { dir } = await setup(t);
  const only = await check(dir, ['--only', '0,case-0']);
  assert.deepEqual(only.agg.perCase.map(c => c.id), ['case-0', 'trace-0']); assert.equal(only.agg.complete, false); assert.equal(only.agg.clean, false);
  assert.match(only.stdout, /ran 2 of 9 cases/);
  const max = await check(dir, ['--max', '1']);
  assert.deepEqual(max.agg.perCase.map(c => c.id), ['case-0']);
  const clean = await check(dir, ['--only', '0,4,case-0']);
  assert.equal(clean.agg.exact, 3); assert.equal(clean.agg.clean, false, 'clean needs every case');
  rmSync(path.join(dir, 'solve.mjs'));
  const none = await check(dir);
  assert.equal(none.code, 2); assert.equal(none.agg.error, 'no solve.mjs');
});

// ---- JIT v2.1 (opt-in): tolerant comparison. Fitted numbers differ in the last digits; canonical JSON calls that a diff. ----
const FIT_SOLVE = `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 1 });
const { k } = flow.input().inputs;
flow.done({ fits: [{ s: 'B', vmax: 3.31 * k }, { s: 'A', vmax: 4.0213 * k, km: 0.512 }] });
`;
async function fitSetup(t, { withCompare = true, defaults = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jit-ct-tol-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'tools'));
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL);
  copyFileSync(path.join(here, '../flow.mjs'), path.join(dir, 'tools/flow.mjs'));
  copyFileSync(path.join(here, '../check-traces.mjs'), path.join(dir, 'tools/check-traces.mjs'));
  if (withCompare) copyFileSync(path.join(here, '../compare.mjs'), path.join(dir, 'tools/compare.mjs'));
  if (defaults) writeFileSync(path.join(dir, 'tools/check-traces.json'), JSON.stringify(defaults));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ socket: 'gw.sock', token: 'tk' }));
  writeFileSync(path.join(dir, 'solve.mjs'), FIT_SOLVE);
  const labels = [[1, { fits: [{ s: 'A', vmax: 4.0198, km: 0.5101 }, { s: 'B', vmax: 3.3 }] }],     // within 1%: tolerant exact
    [1, { fits: [{ s: 'A', vmax: 4.0213, km: 0.512 }, { s: 'B', vmax: 3.31 }] }],                  // canonical exact too (order aside)
    [2, { fits: [{ s: 'A', vmax: 8.0426, km: 0.9 }, { s: 'B', vmax: 6.62 }] }]];                   // km really differs
  labels.forEach(([k, label], i) => {
    const files = { ...taskFiles({ prompt: `fit ${i}`, inputs: { k } }, `traces/trace-${i}/`), [`traces/trace-${i}/agent-answer.json`]: JSON.stringify(label) };
    for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), content); }
  });
  return dir;
}

test('check-traces --tolerant: near-equal fitted numbers in permuted arrays are exact; a real difference stays a diff; canonical is unchanged', async t => {
  const dir = await fitSetup(t);
  const canon = await check(dir);
  assert.equal(canon.code, 0, canon.stderr);
  assert.deepEqual(canon.agg.perCase.map(c => c.status), ['diff', 'diff', 'diff'], 'canonical: order and last digits both count');
  assert.equal('compare' in canon.agg, false); assert.equal('canonicalExact' in canon.agg.perCase[0], false); assert.doesNotMatch(canon.stdout, /comparison: tolerant/);
  const tol = await check(dir, ['--tolerant']);
  assert.equal(tol.code, 0, tol.stderr);
  const by = Object.fromEntries(tol.agg.perCase.map(c => [c.id, c]));
  assert.deepEqual([by['trace-0'].status, by['trace-1'].status, by['trace-2'].status], ['exact', 'exact', 'diff']);
  assert.deepEqual([by['trace-0'].canonicalExact, by['trace-1'].canonicalExact], [false, false], 'trace-1 differs canonically only by order');
  assert.ok(Math.abs(by['trace-2'].partial - 4 / 5) < 1e-9); assert.deepEqual(by['trace-2'].diffs, [{ path: '$.fits[0].km', got: '0.512', want: '0.9' }]);
  assert.deepEqual(tol.agg.compare, { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }); assert.equal(tol.agg.exact, 2); assert.equal(tol.agg.canonicalExact, 0); assert.equal(tol.agg.clean, true);
  assert.match(tol.stdout, /comparison: tolerant .*0\/3 also exact under canonical JSON/);
  const tight = await check(dir, ['--tolerant', '--rel-tol', '0.0001']);
  assert.deepEqual(tight.agg.perCase.map(c => c.status), ['diff', 'exact', 'diff']);
});

test('check-traces: check-traces.json beside the tool makes tolerant the default; --exact restores canonical; tolerant without compare.mjs fails loudly', async t => {
  const dir = await fitSetup(t, { defaults: { compare: 'tolerant', relTol: 0.01, absTol: 1e-9 } });
  const r = await check(dir);
  assert.equal(r.agg.compare.mode, 'tolerant'); assert.equal(r.agg.exact, 2);
  assert.equal('compare' in (await check(dir, ['--exact'])).agg, false);
  const bare = await fitSetup(t, { withCompare: false });
  const b = await new Promise(resolve => {
    const child = spawn(process.execPath, ['tools/check-traces.mjs', '--tolerant'], { cwd: bare, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', d => { stderr += d; }); child.stdout.resume();
    child.on('close', code => resolve({ code, stderr }));
  });
  assert.notEqual(b.code, 0); assert.match(b.stderr, /tolerant comparison needs compare\.mjs beside check-traces\.mjs/);
});
