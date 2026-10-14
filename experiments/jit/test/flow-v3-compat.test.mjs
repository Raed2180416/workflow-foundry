// flow-v3.mjs byte compatibility (FLOW-V3 §5 step 3): a solver that uses only flow-v2 primitives gets, under flow-v3, the
// same stdout, exit code, deopt.json and trace.jsonl (minus the `at` and `ms` fields) as under flow-v2, and no span or
// parent key anywhere. The scenarios are the flow-v2 fixtures of flow.test.mjs and flow-override.test.mjs (every v2
// primitive, every exit path, flags, autoFlag, the event cap, the override hook). Stub gateway as there; no model calls.
// flow-v2.mjs itself is untouched: its pin stays in compile.test.mjs and ENGINE-FREEZE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MODEL_TOOL } from '../../c0/construct.mjs';

const FLOW_V2 = new URL('../flow-v2.mjs', import.meta.url).pathname, FLOW_V3 = new URL('../flow-v3.mjs', import.meta.url).pathname;
const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5', TOKEN = 'test-token';
const FLOW_V2_SHA256 = '5dde46668c10c338074ee4a1ec1115632f18ddca4773a71024b4b6ee18fb5223';   // ENGINE-FREEZE E1

let handler = () => ({ body: { ok: true, value: {}, costUsd: 0 } });
const counts = new Map();
const server = http.createServer((req, res) => {
  let text = '';
  req.on('data', c => { text += c; });
  req.on('end', async () => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('{}'); }
    const body = JSON.parse(text), key = `${body.model}\0${body.prompt}`, n = counts.get(key) ?? 0;
    counts.set(key, n + 1);
    const r = await handler(body, n);
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const ok = (value, costUsd = 0.01) => ({ body: { ok: true, value, costUsd, spentUsd: 0 } });

// Runs are sequential (one stub handler at a time).
async function run(t, flowFile, { source, task = { prompt: 'p', inputs: { xs: [1, 2, 3, 4, 5] } }, on, override = null }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jit-v3c-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'tools'));
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(flowFile, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url, token: TOKEN }));
  if (override != null) writeFileSync(path.join(dir, 'tools/flow-override.mjs'), override);
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify(task));
  writeFileSync(path.join(dir, 'solve.mjs'), `import { createFlow } from './tools/flow.mjs';\n${source}`);
  handler = on ? on() : () => ok({}); counts.clear();
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  const raw = existsSync(path.join(dir, 'trace.jsonl')) ? readFileSync(path.join(dir, 'trace.jsonl'), 'utf8') : '';
  const deopt = existsSync(path.join(dir, 'deopt.json')) ? readFileSync(path.join(dir, 'deopt.json'), 'utf8') : null;
  return { code, stdout, stderr, raw, deopt, dir };
}

// Normalisation: drop `at` and `ms` (top level); a stack trace names the run directory and the SDK's own line numbers,
// which differ between the two files by construction, so both are masked.
const mask = (s, dir) => s.split(dir).join('<dir>').replace(/flow\.mjs:\d+:\d+/g, 'flow.mjs:L:C');
const norm = (r, { unordered = false } = {}) => {
  const lines = r.raw.split('\n').filter(Boolean).map(l => { const { at, ms, ...rest } = JSON.parse(mask(l, r.dir)); return JSON.stringify(rest); });
  const d = r.deopt == null ? null : (() => { const { at, ...rest } = JSON.parse(r.deopt); return rest; })();
  return { code: r.code, stdout: r.stdout, deopt: d, trace: unordered ? [...lines].sort() : lines };
};

const SCHEMA = { type: 'object', properties: { quote: { type: 'string' } }, required: ['quote'], additionalProperties: false };
const judgeSrc = (opts = '', flowOpts = '{ budgetUsd: 1 }') => `const flow = createFlow(${flowOpts});
const text = 'hello world';
const v = await flow.judge('find-quote', { tiers: ['${HAIKU}', '${SONNET}'], system: 'sys', prompt: 'find a quote', schema: ${JSON.stringify(SCHEMA)},
  check: v => text.includes(v.quote) ? null : 'quote not in text'${opts} });
flow.done(v);`;

const SCENARIOS = {
  'steps, map, guard and invariant passes, note, done': { source: `const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const xs = flow.step('parse', () => task.inputs.xs);
const doubled = await flow.step('double', async () => xs.map(x => x * 2));
const out = await flow.map(doubled, async x => { await new Promise(r => setTimeout(r, 5)); return x + 1; }, { concurrency: 2 });
flow.guard('numbers', xs.every(Number.isFinite), { xs });
flow.invariant('same-length', out.length === xs.length);
flow.note('seen', { n: xs.length, nested: { deep: [1, 2] } });
console.log('a debug line before the answer');
flow.done({ out, spent: flow.spent() });` },
  'a failed guard deopts': { source: `const flow = createFlow();
const task = flow.input();
flow.guard('known-systems', task.inputs.xs.length < 3, { unseen: ['VENDEX'] });
flow.done('never');` },
  'a failed invariant deopts (lazy detail)': { source: `const flow = createFlow();
flow.invariant('rows-conserved', 2 + 2 === 5, () => ({ merged: 2, dropped: 2, rows: 5 }));
flow.done('never');` },
  'judge escalates on a failed check': { source: judgeSrc(), on: () => b => (b.model === HAIKU ? ok({ quote: 'nope' }, 0.01) : ok({ quote: 'hello' }, 0.05)) },
  'judge escalates on a failed call': { source: judgeSrc(), on: () => b => (b.model === HAIKU ? { body: { ok: false, error: { code: 'MODEL_SCHEMA' }, costUsd: 0.002 } } : ok({ quote: 'world' })) },
  'judge exhausts its tiers and deopts': { source: judgeSrc(), on: () => () => ok({ quote: 'nope' }) },
  'samples: a majority wins': { source: judgeSrc(', samples: 3'), on: () => (b, n) => ok(n === 2 ? { quote: 'world' } : n === 0 ? { quote: 'hello' } : JSON.parse('{"quote":"hello"}'), 0.001) },
  'samples: no majority escalates': { source: judgeSrc(', samples: 3'), on: () => (b, n) => ok(b.model === HAIKU ? { quote: ['hello', 'world', 'hello world'][n] } : { quote: 'lo w' }, 0.001) },
  'soft budget deopts': { source: `const flow = createFlow({ budgetUsd: 0.015 });
const schema = { type: 'object', properties: { quote: { type: 'string' } }, required: ['quote'] };
const a = await flow.judge('first', { tiers: ['${HAIKU}'], prompt: 'one', schema });
const b = await flow.judge('second', { tiers: ['${HAIKU}'], prompt: 'two', schema });
flow.done([a, b]);`, on: () => () => ok({ quote: 'x' }, 0.02) },
  'gateway 402 deopts with kind budget': { source: judgeSrc(), on: () => () => ({ status: 402, body: { error: 'budget exhausted', spentUsd: 1, capUsd: 1 } }) },
  'an uncaught exception is a crash': { source: `const flow = createFlow();
flow.step('parse', () => JSON.parse('{oops'));
flow.done(1);` },
  'ending without done() is a crash': { source: `const flow = createFlow();\nflow.input();\nflow.note('n', 1);` },
  'done once, createFlow once, stale files cleared': { source: `import { writeFileSync } from 'node:fs';
writeFileSync('deopt.json', '{"kind":"guard"}'); writeFileSync('trace.jsonl', '{"kind":"stale"}\\n');
const flow = createFlow();
flow.done({ a: 1 });
try { flow.done({ a: 2 }); } catch (e) { process.stderr.write('second: ' + e.message + '\\n'); }
try { createFlow(); } catch (e) { process.stderr.write('again: ' + e.message + '\\n'); }` },
  'a judge prompt over 64 KB is truncated in the trace': { source: `const flow = createFlow();
const v = await flow.judge('big', { tiers: ['${HAIKU}'], system: 's'.repeat(70000), prompt: 'x'.repeat(70000), schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } });
flow.done(v);`, on: () => () => ok({ ok: true }) },
  'judges inside map, concurrently': { unordered: true, source: `const flow = createFlow({ budgetUsd: 1 });
const schema = { type: 'object', properties: { i: { type: 'integer' } }, required: ['i'] };
const out = await flow.map([0, 1, 2, 3, 4, 5], i => flow.judge('item', { tiers: ['${HAIKU}'], prompt: 'item ' + i, schema, check: v => (v.i === i ? null : 'wrong item') }), { concurrency: 3 });
flow.done(out.map(v => v.i));`, on: () => async b => { const i = Number(b.prompt.split(' ')[1]); await new Promise(res => setTimeout(res, 5 + ((i * 7) % 4) * 15)); return ok({ i }, (i + 1) / 1000); } },
  'a failing map body is rethrown (crash)': { source: `const flow = createFlow();
await flow.map([1, 2, 3], async x => { if (x === 2) throw new Error('bad item ' + x); return x; }, { name: 'items', concurrency: 1 });
flow.done(1);` },
  'flags and autoFlag': { source: `const flow = createFlow({ budgetUsd: 1, autoFlag: true });
const task = flow.input();
flow.flag('weak-name-match', { score: 0.8 }); flow.flag('weak-name-match', () => ({ score: 0.7 })); flow.flag('default-used'); flow.flag(null, () => { throw new Error('x'); });
const text = 'hello world';
const v = await flow.judge('find-quote', { tiers: ['${HAIKU}', '${SONNET}'], prompt: 'q', schema: ${JSON.stringify(SCHEMA)}, check: v => text.includes(v.quote) ? null : 'no' });
const w = await flow.judge('vote', { tiers: ['${HAIKU}'], prompt: 'vote', schema: ${JSON.stringify(SCHEMA)}, samples: 3 });
flow.done({ v, w, n: task.inputs.xs.length });`, on: () => (b, n) => (b.prompt === 'vote' ? ok({ quote: n === 1 ? 'y' : 'x' }, 0.001) : ok({ quote: b.model === HAIKU ? 'nope' : 'hello' })) },
  'flags are counted in a deopt': { source: `const flow = createFlow();
flow.flag('weak', { a: 1 });
flow.guard('g', false, { why: 'test' });
flow.done(1);` },
  'the event cap: flags past it are counted in the totals': { source: `const flow = createFlow(); const task = flow.input();
for (let i = 0; i < 5005; i++) flow.step('s', () => i);
flow.flag('weak-name-match', { i: 1 }); flow.flag('weak-name-match', { i: 2 });
flow.done({ n: task.inputs.xs.length });` },
  'the override hook answers judges at $0': { override: `export default (callSite, request) => (callSite.name === 'fixed' ? { value: { quote: 'hello' } } : callSite.name === 'broken' ? { nope: 1 } : undefined);`,
    source: `const flow = createFlow({ budgetUsd: 1 });
const schema = ${JSON.stringify(SCHEMA)};
const a = await flow.judge('fixed', { tiers: ['${HAIKU}'], prompt: 'a', schema });
const b = await flow.judge('live', { tiers: ['${HAIKU}'], prompt: 'b', schema });
const c = await flow.judge('broken', { tiers: ['${HAIKU}', '${SONNET}'], prompt: 'c', schema, maxTokens: 300, reasoning: 'low' });
flow.done({ a, b, c });`, on: () => () => ok({ quote: 'live' }, 0.003) },
};

for (const [name, sc] of Object.entries(SCENARIOS)) {
  test(`flow-v3 = flow-v2 for a v2-only solver: ${name}`, async t => {
    const v2 = await run(t, FLOW_V2, sc), v3 = await run(t, FLOW_V3, sc);
    assert.ok(v2.raw.length > 0 || v2.code !== 0, 'the scenario wrote a trace');
    assert.deepEqual(norm(v3, sc), norm(v2, sc));
    // For scenarios whose calls run concurrently (unordered), the per-call '[model]' lines arrive in completion order, which
    // the scheduler decides: they are compared as a sorted list (FLOW-V3-SLICE2 §5: the known order flake), everything else
    // in order.
    const err = r => { const lines = mask(r.stderr.replace(/"at":"[^"]*"/g, ''), r.dir).split('\n'); return sc.unordered ? [...lines.filter(l => !l.startsWith('[model] ')), ...lines.filter(l => l.startsWith('[model] ')).sort()].join('\n') : lines.join('\n'); };
    assert.equal(err(v3), err(v2), 'stderr matches too (model call lines, messages, stacks)');
    for (const line of v3.raw.split('\n').filter(Boolean)) {
      const e = JSON.parse(line);
      assert.equal('span' in e || 'parent' in e, false, `no span/parent outside a call scope: ${line.slice(0, 120)}`);
    }
  });
}

test('flow-v3 exports every flow-v2 export with the same behaviour, plus the call-protocol constants; flow-v2 keeps its E1 bytes', async () => {
  const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
  assert.equal(sha(FLOW_V2), FLOW_V2_SHA256, 'flow-v2.mjs is frozen (ENGINE-FREEZE E1)');
  const names = src => [...src.matchAll(/^export (?:const|function|async function) (\w+)/gm)].map(m => m[1]).concat(
    [...src.matchAll(/^export const (\w+) = [^;]*?, (\w+) = [^;]*?, (\w+) = /gm)].flatMap(m => [m[2], m[3]]));
  const v2 = names(readFileSync(FLOW_V2, 'utf8')), v3 = names(readFileSync(FLOW_V3, 'utf8'));
  for (const n of v2) assert.ok(v3.includes(n), `flow-v3 exports ${n}`);
  for (const n of ['CALL_MODEL', 'ROOT_SPAN', 'CALL_PROTOCOL', 'callKeyOf', 'inputDigestOf']) assert.ok(v3.includes(n), `flow-v3 exports ${n}`);
  // The pure helpers agree byte for byte (imported from copies beside a stub model.mjs; the SDK reads tools/ at import).
  const dir = mkdtempSync(path.join(tmpdir(), 'jit-v3e-'));
  try {
    for (const [f, as] of [[FLOW_V2, 'v2.mjs'], [FLOW_V3, 'v3.mjs']]) copyFileSync(f, path.join(dir, as));
    writeFileSync(path.join(dir, 'model.mjs'), 'export const callModel = async () => { throw new Error("no model"); };');
    const a = await import(path.join(dir, 'v2.mjs')), b = await import(path.join(dir, 'v3.mjs'));
    const v = { b: [2, { z: 1, a: undefined, y: [null, 'x'] }], a: 1.5 };
    assert.equal(b.canonical(v), a.canonical(v));
    const req = { model: HAIKU, system: 's', prompt: 'p', schema: SCHEMA, reasoning: 'low', maxTokens: 9 };
    assert.deepEqual(b.requestOf(req), a.requestOf(req)); assert.equal(b.requestDigest(b.requestOf(req)), a.requestDigest(a.requestOf(req)));
    assert.equal(b.DEOPT_EXIT, a.DEOPT_EXIT);
    const host = await import('../call-host.mjs');
    const k = { callee: 'sha256:abc', inputDigest: b.inputDigestOf(v), parentPath: 'root/call:x#0' };
    assert.equal(b.inputDigestOf(v), host.inputDigestOf(v), 'SDK and host input digests agree');
    assert.equal(b.callKeyOf(k), host.callKeyOf(k), 'SDK and host idempotency keys agree');
    assert.equal(b.CALL_MODEL, host.CALL_MODEL); assert.equal(b.ROOT_SPAN, host.ROOT_SPAN); assert.equal(b.CALL_PROTOCOL, host.CALL_PROTOCOL);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
