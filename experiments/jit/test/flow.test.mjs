// flow.mjs (SPEC §2) against a stub gateway: a loopback node:http server that speaks the /model route the real gateway
// serves. No live model calls. Each test writes a tiny solve.mjs beside tools/{model.mjs, flow.mjs, gateway.json} and runs
// it as a child process exactly as a compiled solver runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_TOOL } from '../../c0/construct.mjs';

const FLOW = new URL('../flow.mjs', import.meta.url).pathname;
const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5';
const TOKEN = 'test-token';

// handler(body, n) -> {status?, body}; n counts calls per (model, prompt) so a test can script a sequence.
let handler = () => ({ body: { ok: true, value: {}, costUsd: 0 } });
const counts = new Map(), requests = [];
const server = http.createServer((req, res) => {
  let text = '';
  req.on('data', c => { text += c; });
  req.on('end', async () => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('{}'); }
    const body = JSON.parse(text), key = `${body.model}\0${body.prompt}`, n = counts.get(key) ?? 0;
    counts.set(key, n + 1); requests.push(body);
    const r = await handler(body, n);
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const ok = (value, costUsd = 0.01) => ({ body: { ok: true, value, costUsd, spentUsd: 0 } });

async function run(t, source, { task = { prompt: 'p', inputs: { xs: [1, 2, 3, 4, 5] } }, on } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jit-flow-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'tools'));
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url, token: TOKEN }));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify(task));
  writeFileSync(path.join(dir, 'solve.mjs'), `import { createFlow } from './tools/flow.mjs';\n${source}`);
  handler = on ?? handler; counts.clear(); requests.length = 0;
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  const trace = existsSync(path.join(dir, 'trace.jsonl')) ? readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const deopt = existsSync(path.join(dir, 'deopt.json')) ? JSON.parse(readFileSync(path.join(dir, 'deopt.json'), 'utf8')) : null;
  const last = stdout.trim().split('\n').filter(Boolean).at(-1);
  return { code, stdout, stderr, trace, deopt, output: last === undefined ? undefined : JSON.parse(last), dir };
}

const SCHEMA = { type: 'object', properties: { quote: { type: 'string' } }, required: ['quote'], additionalProperties: false };
const judgeSrc = (opts = '') => `const flow = createFlow({ budgetUsd: 1 });
const text = 'hello world';
const v = await flow.judge('find-quote', { tiers: ['${HAIKU}', '${SONNET}'], system: 'sys', prompt: 'find a quote', schema: ${JSON.stringify(SCHEMA)},
  check: v => text.includes(v.quote) ? null : 'quote not in text'${opts} });
flow.done(v);`;

test('done() prints the final JSON line; steps, map (bounded concurrency), guard/invariant passes and done are traced', async t => {
  const r = await run(t, `const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const xs = flow.step('parse', () => task.inputs.xs);
const doubled = await flow.step('double', async () => xs.map(x => x * 2));
let active = 0, peak = 0;
const out = await flow.map(doubled, async x => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 20)); active--; return x + 1; }, { concurrency: 2 });
flow.guard('numbers', xs.every(Number.isFinite), { xs });
flow.invariant('same-length', out.length === xs.length);
console.log('a debug line before the answer');
flow.done({ out, peak });`);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.output, { out: [3, 5, 7, 9, 11], peak: 2 }, 'the answer is the last stdout line, and map never ran more than 2 at once');
  assert.equal(r.deopt, null);
  assert.deepEqual(r.trace.map(e => e.kind), ['input', 'step', 'step', 'map', 'done']);
  for (const e of r.trace) { assert.match(e.at, /^\d{4}-\d\d-\d\dT/); assert.equal(typeof e.name, 'string'); }
  const [, parse, double, map, done] = r.trace;
  assert.equal(parse.name, 'parse'); assert.equal(parse.ok, true); assert.equal(parse.n, 5); assert.match(parse.out, /^[0-9a-f]{16}$/);
  assert.equal(double.name, 'double'); assert.notEqual(double.out, parse.out);
  assert.equal(map.n, 5); assert.equal(map.concurrency, 2);
  assert.deepEqual(done.guards, { numbers: 1 }); assert.deepEqual(done.invariants, { 'same-length': 1 }); assert.equal(done.spentUsd, 0);
});

test('a failed guard writes deopt.json and exits 75 before any answer', async t => {
  const r = await run(t, `const flow = createFlow();
const task = flow.input();
flow.guard('known-systems', task.inputs.xs.length < 3, { unseen: ['VENDEX'] });
flow.done('never');`);
  assert.equal(r.code, 75); assert.equal(r.output, undefined);
  assert.equal(r.deopt.kind, 'guard'); assert.equal(r.deopt.name, 'known-systems'); assert.deepEqual(r.deopt.detail, { unseen: ['VENDEX'] });
  const e = r.trace.at(-1);
  assert.equal(e.kind, 'deopt'); assert.equal(e.deopt, 'guard'); assert.equal(e.name, 'known-systems');
});

test('a failed invariant deopts with kind invariant (lazy detail)', async t => {
  const r = await run(t, `const flow = createFlow();
flow.invariant('rows-conserved', 2 + 2 === 5, () => ({ merged: 2, dropped: 2, rows: 5 }));
flow.done('never');`);
  assert.equal(r.code, 75); assert.equal(r.deopt.kind, 'invariant'); assert.deepEqual(r.deopt.detail, { merged: 2, dropped: 2, rows: 5 });
  assert.equal(r.trace.at(-1).deopt, 'invariant');
});

test('judge escalates on a failed check, returns only a checked value and records what tier-down needs', async t => {
  const r = await run(t, judgeSrc(), { on: b => (b.model === HAIKU ? ok({ quote: 'nope' }, 0.01) : ok({ quote: 'hello' }, 0.05)) });
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.output, { quote: 'hello' });
  assert.deepEqual(requests.map(b => b.model), [HAIKU, SONNET]);
  assert.equal(requests[0].decoding.reasoning, 'none'); assert.deepEqual(requests[0].schema, SCHEMA);
  const j = r.trace.find(e => e.kind === 'judge');
  assert.equal(j.name, 'find-quote'); assert.equal(j.ok, true); assert.equal(j.tier, SONNET); assert.equal(j.escalations, 1);
  assert.deepEqual(j.tiersTried, [{ model: HAIKU, ok: false, costUsd: 0.01, problem: 'quote not in text' }, { model: SONNET, ok: true, costUsd: 0.05 }]);
  assert.equal(j.system, 'sys'); assert.equal(j.prompt, 'find a quote'); assert.deepEqual(j.schema, SCHEMA); assert.deepEqual(j.value, { quote: 'hello' });
  assert.equal(j.samples, 1); assert.equal(j.agreement, 1); assert.equal(j.costUsd, 0.06); assert.equal(typeof j.ms, 'number'); assert.equal(j.truncated, undefined);
  assert.equal(r.trace.at(-1).spentUsd, 0.06);
});

test('judge escalates on a failed call too, and records the error', async t => {
  const r = await run(t, judgeSrc(), { on: b => (b.model === HAIKU ? { body: { ok: false, error: { code: 'MODEL_SCHEMA' }, costUsd: 0.002 } } : ok({ quote: 'world' })) });
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.output, { quote: 'world' });
  const j = r.trace.find(e => e.kind === 'judge');
  assert.equal(j.tiersTried[0].ok, false); assert.match(j.tiersTried[0].error, /MODEL_SCHEMA/); assert.equal(j.tiersTried[0].costUsd, 0.002);
});

test('a judge that exhausts its tiers deopts with kind judge and never returns an unchecked value', async t => {
  const r = await run(t, judgeSrc(), { on: () => ok({ quote: 'nope' }) });
  assert.equal(r.code, 75); assert.equal(r.output, undefined);
  assert.equal(r.deopt.kind, 'judge'); assert.equal(r.deopt.name, 'find-quote');
  assert.deepEqual(r.deopt.detail.tiersTried.map(x => [x.model, x.ok, x.problem]), [[HAIKU, false, 'quote not in text'], [SONNET, false, 'quote not in text']]);
  const j = r.trace.find(e => e.kind === 'judge');
  assert.equal(j.ok, false); assert.equal(j.value, undefined); assert.equal(r.trace.at(-1).deopt, 'judge');
});

test('samples > 1: a majority on canonical JSON wins; no majority escalates', async t => {
  // Key order differs between the two agreeing samples: canonical JSON makes them one vote.
  const majority = await run(t, judgeSrc(', samples: 3'), { on: (b, n) => ok(n === 2 ? { quote: 'world' } : n === 0 ? { quote: 'hello' } : JSON.parse('{"quote":"hello"}'), 0.001) });
  assert.equal(majority.code, 0, majority.stderr); assert.deepEqual(majority.output, { quote: 'hello' });
  let j = majority.trace.find(e => e.kind === 'judge');
  assert.equal(j.tier, HAIKU); assert.equal(j.samples, 3); assert.ok(Math.abs(j.agreement - 2 / 3) < 1e-9); assert.deepEqual(j.tiersTried[0].votes, [2, 1]);
  assert.equal(requests.length, 3);
  const tie = await run(t, judgeSrc(', samples: 3'), { on: (b, n) => ok(b.model === HAIKU ? { quote: ['hello', 'world', 'hello world'][n] } : { quote: 'lo w' }, 0.001) });
  assert.equal(tie.code, 0, tie.stderr); assert.deepEqual(tie.output, { quote: 'lo w' });
  j = tie.trace.find(e => e.kind === 'judge');
  assert.equal(j.tier, SONNET); assert.equal(j.escalations, 1); assert.match(j.tiersTried[0].problem, /no majority/); assert.deepEqual(j.tiersTried[0].votes, [1, 1, 1]);
  assert.equal(j.agreement, 1); assert.equal(requests.length, 6);
});

test('budget: a judge after the soft budget is spent deopts with kind budget; a gateway 402 does too', async t => {
  const r = await run(t, `const flow = createFlow({ budgetUsd: 0.015 });
const schema = { type: 'object', properties: { quote: { type: 'string' } }, required: ['quote'] };
const a = await flow.judge('first', { tiers: ['${HAIKU}'], prompt: 'one', schema });
const b = await flow.judge('second', { tiers: ['${HAIKU}'], prompt: 'two', schema });
flow.done([a, b]);`, { on: () => ok({ quote: 'x' }, 0.02) });
  assert.equal(r.code, 75); assert.equal(r.deopt.kind, 'budget'); assert.equal(r.deopt.name, 'second'); assert.equal(r.deopt.spentUsd, 0.02);
  assert.equal(requests.length, 1, 'the second judge made no call');
  const refused = await run(t, judgeSrc(), { on: () => ({ status: 402, body: { error: 'budget exhausted', spentUsd: 1, capUsd: 1 } }) });
  assert.equal(refused.code, 75); assert.equal(refused.deopt.kind, 'budget'); assert.equal(refused.deopt.detail.gateway, 'budget exhausted');
  assert.equal(requests.length, 1, 'no escalation after a gateway budget refusal');
});

test('an uncaught exception is a crash (exit 1, no deopt.json); so is ending without done()', async t => {
  const crash = await run(t, `const flow = createFlow();
flow.step('parse', () => JSON.parse('{oops'));
flow.done(1);`);
  assert.equal(crash.code, 1); assert.equal(crash.deopt, null);
  assert.deepEqual(crash.trace.map(e => [e.kind, e.name, e.ok]), [['step', 'parse', false], ['crash', 'uncaught', undefined]]);
  const silent = await run(t, `const flow = createFlow();\nflow.input();`);
  assert.equal(silent.code, 1); assert.equal(silent.deopt, null); assert.equal(silent.trace.at(-1).name, 'no-done');
});

test('done() may be called once; createFlow() once per process; a stale deopt.json and trace are cleared', async t => {
  const r = await run(t, `import { writeFileSync } from 'node:fs';
writeFileSync('deopt.json', '{"kind":"guard"}'); writeFileSync('trace.jsonl', '{"kind":"stale"}\\n');
const flow = createFlow();
flow.done({ a: 1 });
try { flow.done({ a: 2 }); } catch (e) { process.stderr.write('second: ' + e.message + '\\n'); }
try { createFlow(); } catch (e) { process.stderr.write('again: ' + e.message + '\\n'); }`);
  assert.equal(r.code, 0); assert.deepEqual(r.output, { a: 1 });
  assert.match(r.stderr, /second: flow\.done\(\) may be called only once/); assert.match(r.stderr, /again: createFlow\(\) may be called once/);
  assert.equal(r.deopt, null); assert.deepEqual(r.trace.map(e => e.kind), ['done']);
});

test('a judge prompt over 64 KB is traced as its sha256 plus the first 2 KB, marked truncated', async t => {
  const r = await run(t, `const flow = createFlow();
const v = await flow.judge('big', { tiers: ['${HAIKU}'], prompt: 'x'.repeat(70000), schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } });
flow.done(v);`, { on: () => ok({ ok: true }) });
  assert.equal(r.code, 0, r.stderr);
  const j = r.trace.find(e => e.kind === 'judge');
  assert.equal(j.truncated, true); assert.equal(j.prompt.length, 2048); assert.match(j.promptSha256, /^[0-9a-f]{64}$/); assert.equal(j.system, '');
  assert.equal(requests[0].prompt.length, 70000, 'the model still got the whole prompt');
});

test('judges inside map run concurrently and each is charged its own call; the total is exact', async t => {
  const r = await run(t, `const flow = createFlow({ budgetUsd: 1 });
const schema = { type: 'object', properties: { i: { type: 'integer' } }, required: ['i'] };
const out = await flow.map([0, 1, 2, 3, 4, 5], i => flow.judge('item', { tiers: ['${HAIKU}'], prompt: 'item ' + i, schema, check: v => (v.i === i ? null : 'wrong item') }), { concurrency: 3 });
flow.done(out.map(v => v.i));`, { on: async b => { const i = Number(b.prompt.split(' ')[1]); await new Promise(res => setTimeout(res, 5 + ((i * 7) % 4) * 15)); return ok({ i }, (i + 1) / 1000); } });
  assert.equal(r.code, 0, r.stderr); assert.deepEqual(r.output, [0, 1, 2, 3, 4, 5]);
  const judges = r.trace.filter(e => e.kind === 'judge');
  assert.equal(judges.length, 6);
  for (const j of judges) assert.equal(j.costUsd, (j.value.i + 1) / 1000, `judge ${j.prompt} charged its own call`);
  assert.equal(r.trace.at(-1).spentUsd, 0.021); assert.equal(r.trace.at(-1).calls, 6);
});
