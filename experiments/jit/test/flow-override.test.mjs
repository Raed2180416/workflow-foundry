// flow-v2.mjs replay override (S0-2): tools/flow-override.mjs (or createFlow({ override })) answers judge calls by a stable
// call-site id, so a replay can hold every judge fixed while one varies. Stub gateway as in flow.test.mjs; no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODEL_TOOL } from '../../c0/construct.mjs';
import { requestDigestOf } from '../run-compiled.mjs';

const FLOW_V2 = new URL('../flow-v2.mjs', import.meta.url).pathname;
const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5', TOKEN = 'test-token';

let handler = () => ({ body: { ok: true, value: {}, costUsd: 0 } });
const requests = [];
const server = http.createServer((req, res) => {
  let text = '';
  req.on('data', c => { text += c; });
  req.on('end', async () => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('{}'); }
    const body = JSON.parse(text); requests.push(body);
    const r = await handler(body);
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const ok = (value, costUsd = 0.01) => ({ body: { ok: true, value, costUsd, spentUsd: 0 } });

async function run(t, source, { override = null, data, on } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jit-ovr-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'tools'));
  writeFileSync(path.join(dir, 'tools/model.mjs'), MODEL_TOOL); copyFileSync(FLOW_V2, path.join(dir, 'tools/flow.mjs'));
  writeFileSync(path.join(dir, 'tools/gateway.json'), JSON.stringify({ url, token: TOKEN }));
  if (override != null) writeFileSync(path.join(dir, 'tools/flow-override.mjs'), override);
  if (data !== undefined) writeFileSync(path.join(dir, 'tools/flow-override.json'), JSON.stringify(data));
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ prompt: 'p', inputs: {} }));
  writeFileSync(path.join(dir, 'solve.mjs'), `import { createFlow } from './tools/flow.mjs';\n${source}`);
  handler = on ?? (() => ok({ quote: 'live' })); requests.length = 0;
  const child = spawn(process.execPath, ['solve.mjs', 'task.json'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  const trace = existsSync(path.join(dir, 'trace.jsonl')) ? readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const last = stdout.trim().split('\n').filter(Boolean).at(-1);
  const seen = existsSync(path.join(dir, 'seen.jsonl')) ? readFileSync(path.join(dir, 'seen.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { code, stderr, trace, output: last === undefined ? undefined : JSON.parse(last), seen, requests: requests.slice() };
}

const SCHEMA = { type: 'object', properties: { quote: { type: 'string' } }, required: ['quote'], additionalProperties: false };
// Two judges ('a' twice on one prompt, 'b' with 3 samples) and a third on another tier list.
const SOLVER = `const flow = createFlow({ budgetUsd: 1 });
const schema = ${JSON.stringify(SCHEMA)};
const a1 = await flow.judge('a', { tiers: ['${HAIKU}', '${SONNET}'], system: 'sys', prompt: 'pa', schema });
const a2 = await flow.judge('a', { tiers: ['${HAIKU}', '${SONNET}'], system: 'sys', prompt: 'pa', schema });
const b = await flow.judge('b', { tiers: ['${HAIKU}'], prompt: { ask: 'pb' }, schema, samples: 3, maxTokens: 200 });
const c = await flow.judge('c', { tiers: ['${HAIKU}', '${SONNET}'], prompt: 'pc', schema, check: v => v.quote === 'good' ? null : 'bad' });
flow.done({ a1, a2, b, c });`;
// An override that logs every call site and answers from flow-override.json by name ('*' = everything), else live.
const LOGGING = `import { appendFileSync, readFileSync } from 'node:fs';
const table = JSON.parse(readFileSync(new URL('./flow-override.json', import.meta.url), 'utf8'));
export default (site, request) => {
  appendFileSync('seen.jsonl', JSON.stringify({ site, request }) + '\\n');
  const r = [site.id, site.name, '*'].map(k => (k in table ? table[k] : undefined)).find(x => x !== undefined);
  return r === null ? undefined : r;
};
`;

test('override: every judge call is answered by the hook ($0, no gateway call); call-site ids are name#ordinal:digest16; the digest is the host memo digest', async t => {
  const r = await run(t, SOLVER, { override: LOGGING, data: { '*': { value: { quote: 'good' } } } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.output, { a1: { quote: 'good' }, a2: { quote: 'good' }, b: { quote: 'good' }, c: { quote: 'good' } });
  assert.equal(r.requests.length, 0, 'no model call reached the gateway');
  const sites = r.seen.map(s => s.site);
  assert.deepEqual(sites.map(s => [s.name, s.ordinal, s.tier, s.tierIndex, s.sample]),
    [['a', 0, HAIKU, 0, 0], ['a', 1, HAIKU, 0, 0], ['b', 0, HAIKU, 0, 0], ['b', 1, HAIKU, 0, 1], ['b', 2, HAIKU, 0, 2], ['c', 0, HAIKU, 0, 0]],
    'the ordinal counts earlier calls with the same name and request; samples get theirs in sample order');
  for (const s of r.seen) {
    assert.equal(s.site.id, `${s.site.name}#${s.site.ordinal}:${s.site.digest.slice(0, 16)}`);
    assert.equal(s.site.digest, requestDigestOf(s.request), 'flow-v2 requestDigest = run-compiled requestDigestOf (salt-free)');
  }
  assert.deepEqual(r.seen[0].request, { model: HAIKU, system: 'sys', prompt: 'pa', schema: SCHEMA, decoding: { reasoning: 'none' } });
  assert.deepEqual(r.seen[2].request.decoding, { reasoning: 'none', maxTokens: 200 }); assert.equal(r.seen[2].request.prompt, '{"ask":"pb"}');
  assert.equal(sites[0].digest, sites[1].digest); assert.notEqual(sites[0].digest, sites[5].digest);
  const judges = r.trace.filter(e => e.kind === 'judge');
  assert.deepEqual(judges.map(j => [j.overridden, j.costUsd, j.ok]), [[1, 0, true], [1, 0, true], [3, 0, true], [1, 0, true]]);
  assert.equal(r.trace.at(-1).calls, 0); assert.equal(r.trace.at(-1).spentUsd, 0);
});

test('override: hold every judge fixed and vary one (undefined = call the model); the request the gateway sees has the same digest', async t => {
  const r = await run(t, SOLVER, { override: LOGGING, data: { '*': { value: { quote: 'good' } }, c: null }, on: () => ok({ quote: 'good' }, 0.02) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.requests.length, 1, 'only judge c went live'); assert.equal(r.requests[0].prompt, 'pc');
  const live = r.requests[0];
  assert.equal(requestDigestOf({ modelId: live.model, system: live.system, prompt: live.prompt, schema: live.schema, decoding: live.decoding }), r.seen.at(-1).site.digest,
    'the gateway (and so the memo port) computes the same digest for the varied call');
  const c = r.trace.filter(e => e.kind === 'judge').at(-1);
  assert.equal(c.overridden, undefined); assert.equal(c.costUsd, 0.02);
});

test('override: an {error} response, a throwing hook and a malformed response are call failures: the judge escalates as it would on a live failure', async t => {
  // Judge c: a scripted error on haiku, then the live gateway on sonnet.
  const failing = `export default (site) => site.name !== 'c' ? { value: { quote: 'good' } } : site.tier === '${HAIKU}' ? { error: 'scripted failure' } : undefined;`;
  const e = await run(t, SOLVER, { override: failing, on: () => ok({ quote: 'good' }) });
  assert.equal(e.code, 0, e.stderr);
  const c = e.trace.filter(x => x.kind === 'judge').at(-1);
  assert.equal(c.escalations, 1); assert.deepEqual(c.tiersTried.map(x => [x.model, x.ok, x.error ?? null]), [[HAIKU, false, 'scripted failure'], [SONNET, true, null]]);
  assert.equal(e.requests.length, 1); assert.equal(e.requests[0].model, SONNET);
  const throwing = await run(t, SOLVER, { override: `export default () => { throw new Error('hook broke'); };` });
  assert.equal(throwing.code, 75, 'every tier failed: a judge deopt'); assert.match(JSON.stringify(throwing.trace.find(x => x.kind === 'judge')), /override threw: hook broke/);
  const malformed = await run(t, SOLVER, { override: `export default () => ({ quote: 'bare value' });` });
  assert.equal(malformed.code, 75); assert.match(JSON.stringify(malformed.trace.find(x => x.kind === 'judge')), /override returned neither/);
  const notFn = await run(t, SOLVER, { override: `export default 42;` });
  assert.equal(notFn.code, 1); assert.match(notFn.stderr, /flow-override\.mjs must export a default function/);
});

test('override: createFlow({ override }) in process; without a hook nothing changes (no overridden field, the gateway answers)', async t => {
  const inproc = await run(t, `const flow = createFlow({ budgetUsd: 1, override: (site) => site.name === 'x' ? { value: { quote: 'held' } } : undefined });
const schema = ${JSON.stringify(SCHEMA)};
const x = await flow.judge('x', { tiers: ['${HAIKU}'], prompt: 'px', schema });
const y = await flow.judge('y', { tiers: ['${HAIKU}'], prompt: 'py', schema });
flow.done({ x, y });`);
  assert.equal(inproc.code, 0, inproc.stderr); assert.deepEqual(inproc.output, { x: { quote: 'held' }, y: { quote: 'live' } }); assert.equal(inproc.requests.length, 1);
  const plain = await run(t, SOLVER, { on: () => ok({ quote: 'good' }) });
  assert.equal(plain.code, 0, plain.stderr); assert.equal(plain.requests.length, 6);
  assert.ok(plain.trace.filter(e => e.kind === 'judge').every(j => !('overridden' in j)));
  const bad = await run(t, `createFlow({ override: 'nope' });`);
  assert.equal(bad.code, 1); assert.match(bad.stderr, /createFlow\(\{ override \}\) must be a function/);
});
