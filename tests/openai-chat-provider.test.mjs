// The ModelPort provider for remote chat endpoints (src/models/providers/openai-chat.mjs; research/mercury-20261021/):
// typed calls on an executor model named explicitly, never by class; per-call and per-run token caps; the error mapping,
// redaction, journal and replay. $0: every endpoint is a loopback fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPolicy, portModelById, resolve, modelsForClass, nextClass, modelById } from '../src/models/policy.mjs';
import { ModelPort, modelDigestOf } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { OpenAIChatProvider, DEFAULT_CALL_TOKENS } from '../src/models/providers/openai-chat.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { createModelPort, subsetPolicy } from '../experiments/lib/models.mjs';
import { startServices, Ledger } from '../experiments/lib/services.mjs';

const { policy } = loadPolicy();
const KEY = 'test-only-key-not-a-secret-9c1d';
const env = { ...process.env, INCEPTION_API_KEY: KEY };
const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const FAST = { attempts: 3, baseDelayMs: 10, maxDelayMs: 50 };

async function fakeEndpoint(t, script) {
  const requests = [];
  const server = http.createServer((q, s) => {
    let b = ''; q.on('data', d => { b += d; });
    q.on('end', () => {
      let body = null; try { body = JSON.parse(b); } catch {}
      requests.push({ authorization: q.headers.authorization, body });
      const raw = script[Math.min(requests.length - 1, script.length - 1)];
      const step = typeof raw === 'function' ? raw(body, requests.length - 1) : raw;
      s.writeHead(step.status ?? 200, { 'content-type': 'application/json', ...(step.headers ?? {}) });
      s.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {}));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests };
}
const answer = (content, { usage = { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 } }, model = 'mercury-3', finish = 'stop' } = {}) =>
  ({ body: { id: 'x', model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }], usage } });
const portWith = (provider, { mode = 'live', journal = new Journal(new DatabaseSync(':memory:')) } = {}) =>
  ({ port: new ModelPort({ policy, providers: { inception: provider, 'claude-cli': new ScriptedProvider(() => ({ value: { answer: 'haiku' } })) }, journal, mode }), journal });
const provider = (baseUrl, extra = {}) => new OpenAIChatProvider({ policy, providerName: 'inception', baseUrl, hostEnv: env, retry: FAST, runTokenCap: 100_000, ...extra });
const req = (prompt = 'Say hi.', extra = {}) => ({ runId: 'r', nodeKey: 'n', modelId: 'mercury-3', system: 'Reply in JSON.', prompt, schema, ...extra });

test('explicit only: ModelPort serves an executor model when a call names it; class resolution, escalation and verifier choice never reach one', () => {
  assert.equal(portModelById(policy, 'mercury-3').provider, 'inception');
  assert.equal(portModelById(policy, 'claude-haiku-5-5').provider, 'claude-cli');
  assert.throws(() => portModelById(policy, 'mercury-2'), { code: 'MODEL_NOT_IN_POLICY' });
  assert.throws(() => modelById(policy, 'mercury-3'), { code: 'MODEL_NOT_IN_POLICY' }, 'workflow IR nodes still resolve models[] only');
  for (const cls of policy.classOrder) {
    assert.ok(!modelsForClass(policy, cls).some(m => m.provider === 'inception'), cls);
    assert.ok(!modelsForClass(policy, cls, { excludeFamily: 'claude' }).some(m => m.provider === 'inception'), `${cls}: a different-family verifier never moves to Mercury`);
  }
  assert.equal(resolve(policy, { class: 'M' }).id, 'claude-haiku-5-5');
  assert.equal(nextClass(policy, 'S'), 'M');
  // No earlier replay key moved: the fields modelDigestOf now leaves out exist on no models[] entry and no ModelPort provider.
  for (const m of policy.models) for (const k of ['note', 'contextTokens', 'maxOutputTokens']) assert.ok(!(k in m), `${m.id}.${k}`);
  for (const n of ['claude-cli', 'llama-server']) for (const k of ['docs', 'credentialEnv']) assert.ok(!(k in policy.providers[n]), `${n}.${k}`);
  const haiku = modelById(policy, 'claude-haiku-5-5');
  assert.match(modelDigestOf(haiku, policy.providers['claude-cli']), /^[0-9a-f]{64}$/);
});

test('a typed call: one structured-output request, no tools, the key only in its header; usage, cost and the journal row', async t => {
  const ep = await fakeEndpoint(t, [answer('{"answer":"hi"}')]);
  const p = provider(ep.baseUrl);
  const { port, journal } = portWith(p);
  const r = await port.call(req());
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.deepEqual(r.value, { answer: 'hi' }); assert.equal(r.modelId, 'mercury-3'); assert.equal(r.provider, 'inception');
  assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 0 }, 'uncached input, cached input apart (the port\'s convention)');
  assert.equal(r.costUsd, 0);
  const sent = ep.requests[0];
  assert.equal(sent.authorization, `Bearer ${KEY}`);
  assert.equal(sent.body.model, 'mercury-3'); assert.ok(!('tools' in sent.body)); assert.ok(!('reasoning_effort' in sent.body)); assert.ok(!('temperature' in sent.body));
  assert.deepEqual(sent.body.response_format, { type: 'json_schema', json_schema: { name: 'output', schema, strict: true } });
  assert.deepEqual(sent.body.messages, [{ role: 'system', content: 'Reply in JSON.' }, { role: 'user', content: 'Say hi.' }]);
  assert.deepEqual({ ...p.tokens }, { cap: 100_000, callCap: DEFAULT_CALL_TOKENS, spent: 150, reserved: 0, calls: 1, refused: 0, unknown: 0 });
  const row = journal.forAttempt('r', 'n', 0).at(-1);
  assert.equal(row.ok, true); assert.equal(row.provider, 'inception'); assert.equal(row.request.providerRequest.credentialEnv, 'INCEPTION_API_KEY');
  assert.ok(!JSON.stringify(row).includes(KEY), 'the key never reaches the journal');
  // Replay: no provider, no request, the same answer at $0.
  const replay = new ModelPort({ policy, providers: {}, journal, mode: 'replay' });
  const again = await replay.call(req());
  assert.equal(again.replayed, true); assert.deepEqual(again.value, { answer: 'hi' }); assert.equal(again.costUsd, 0); assert.equal(again.replayKey, r.replayKey);
  assert.equal(ep.requests.length, 1);
  // Decoding: reasoning is sent as reasoning_effort, temperature and maxTokens when asked; each changes the replay key.
  const ep2 = await fakeEndpoint(t, [answer('{"answer":"x"}')]);
  const { port: p2 } = portWith(provider(ep2.baseUrl));
  const d = await p2.call(req('Say hi.', { decoding: { reasoning: 'high', temperature: 0.2, maxTokens: 500 } }));
  assert.equal(d.ok, true); assert.notEqual(d.replayKey, r.replayKey);
  assert.deepEqual([ep2.requests[0].body.reasoning_effort, ep2.requests[0].body.temperature, ep2.requests[0].body.max_tokens], ['high', 0.2, 500]);
});

test('a priced executor model is charged from its usage (cached input at the cache-read price)', async t => {
  const ep = await fakeEndpoint(t, [answer('{"answer":"y"}', { model: 'mercury-2.5', usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 500_000 } } })]);
  const { port } = portWith(provider(ep.baseUrl, { runTokenCap: 10_000_000 }));
  const r = await port.call(req('x', { modelId: 'mercury-2.5' }));
  assert.equal(r.ok, true); assert.ok(Math.abs(r.costUsd - (0.1 + 0.01 + 0.75)) < 1e-9, String(r.costUsd));
});

test('token caps: a call over the per-call cap or past the run cap is refused MODEL_BUDGET before any request', async t => {
  const ep = await fakeEndpoint(t, [answer('{"answer":"ok"}', { usage: { prompt_tokens: 3000, completion_tokens: 500 } })]);
  const big = provider(ep.baseUrl, { callTokens: 5_000 });
  const { port } = portWith(big);
  const r = await port.call(req('x'.repeat(30_000)));
  assert.equal(r.ok, false); assert.equal(r.error.code, 'MODEL_BUDGET'); assert.match(r.error.message, /per-call cap of 5000/); assert.equal(ep.requests.length, 0);
  // Run cap 20,000: each call projects ~8.1K (its input + an 8K output allowance) and spends 3.5K. Calls 1-4 fit (at most
  // 10.5K spent + 8.1K); the fifth (14K spent + 8.1K) would pass the cap and is refused without a request.
  const ep2 = await fakeEndpoint(t, [answer('{"answer":"ok"}', { usage: { prompt_tokens: 3000, completion_tokens: 500 } })]);
  const capped = provider(ep2.baseUrl, { runTokenCap: 20_000 });
  const { port: p2 } = portWith(capped);
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await p2.call(req(`call ${i}`, { nodeKey: `n${i}` }))).error?.code ?? 'ok');
  assert.deepEqual(codes, ['ok', 'ok', 'ok', 'ok', 'MODEL_BUDGET']);
  assert.equal(ep2.requests.length, 4); assert.equal(capped.tokens.spent, 14_000); assert.equal(capped.tokens.refused, 1);
  assert.throws(() => new OpenAIChatProvider({ policy, providerName: 'inception', baseUrl: ep2.baseUrl }), /runTokenCap .* is required/);
  assert.throws(() => new OpenAIChatProvider({ policy, providerName: 'inception', baseUrl: 'https://elsewhere.example/v1', runTokenCap: 1 }), { code: 'EXECUTOR_OPTION' }, 'the endpoint comes from the policy');
});

test('errors map to the ModelPort codes after bounded retries; the key is redacted; no silent substitution; schema and truncation are checked', async t => {
  const cases = [
    [[{ status: 429, body: `rate limited for ${KEY}`, headers: { 'retry-after': '0' } }], 'MODEL_RATE_LIMIT', 3],
    [[{ status: 503, body: 'busy' }], 'MODEL_UNAVAILABLE', 3],
    [[{ status: 401, body: 'bad key' }], 'MODEL_UNAVAILABLE', 1],
    [[{ status: 400, body: 'response_format unsupported' }], 'MODEL_PROTOCOL', 1],
    [[{ body: 'not json' }], 'MODEL_PROTOCOL', 1],
    [[answer('{"answer":"x"}', { model: 'other-model' })], 'MODEL_PROTOCOL', 1],
    [[answer('{"wrong":1}')], 'MODEL_SCHEMA', 1],
    [[answer('{"answer":', { finish: 'length' })], 'MODEL_TRUNCATED', 1],
    [[{ status: 500, body: 'x' }, answer('{"answer":"after a retry"}')], null, 2],
  ];
  for (const [script, code, n] of cases) {
    const ep = await fakeEndpoint(t, script);
    const journal = new Journal(new DatabaseSync(':memory:'));
    const { port } = portWith(provider(ep.baseUrl), { journal });
    const r = await port.call(req());
    assert.equal(r.error?.code ?? null, code, JSON.stringify(r.error)); assert.equal(ep.requests.length, n, `${code}: requests`);
    assert.ok(!JSON.stringify(r).includes(KEY) && !JSON.stringify(journal.forAttempt('r', 'n', 0)).includes(KEY), `${code}: key redacted`);
  }
  // No credential: MODEL_UNAVAILABLE without a request.
  const ep = await fakeEndpoint(t, [answer('{"answer":"x"}')]);
  const { port } = portWith(new OpenAIChatProvider({ policy, providerName: 'inception', baseUrl: ep.baseUrl, hostEnv: { ...process.env, INCEPTION_API_KEY: '' }, retry: FAST, runTokenCap: 100_000 }));
  assert.equal((await port.call(req())).error.code, 'MODEL_UNAVAILABLE'); assert.equal(ep.requests.length, 0);
});

test('createModelPort: the remote provider is registered only when allowedModels names one of its models, and then needs tokenCap', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-ocp-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => createModelPort({ journalFile: path.join(dir, 'a.sqlite'), allowedModels: ['claude-haiku-5-5', 'mercury-3'] }), /need tokenCap/);
  const withCap = createModelPort({ journalFile: path.join(dir, 'b.sqlite'), allowedModels: ['claude-haiku-5-5', 'mercury-3'], tokenCap: 50_000, callTokens: 20_000 });
  assert.ok(withCap.port.providers.inception instanceof OpenAIChatProvider);
  assert.deepEqual(withCap.tokens(), { inception: { cap: 50_000, callCap: 20_000, spent: 0, reserved: 0, calls: 0, refused: 0, unknown: 0 } });
  assert.deepEqual(withCap.policy.executorModels.map(m => m.id), ['mercury-3']);
  const owner = createModelPort({ journalFile: path.join(dir, 'c.sqlite') });
  assert.equal(owner.port.providers.inception, undefined, 'the owner policy registers no remote provider: a call naming mercury-3 is MODEL_PROVIDER_MISSING');
  const haikuOnly = subsetPolicy(policy, ['claude-haiku-5-5']);
  assert.equal('executorModels' in haikuOnly, false); assert.equal('inception' in haikuOnly.providers, false);
  for (const db of [withCap.db, owner.db]) db.close();
});

test('the gateway serves a named executor model to a solver and books its tokens per model on the ledger', async t => {
  const ep = await fakeEndpoint(t, [answer('{"answer":"from mercury"}')]);
  const { port } = portWith(provider(ep.baseUrl));
  const ledger = new Ledger({ capUsd: 1, label: 'test' });
  const svc = await startServices({ modelPort: port, ledger, allowedModels: ['mercury-3', 'claude-haiku-5-5'] });
  t.after(() => svc.close());
  const post = body => fetch(`${svc.url}/model`, { method: 'POST', headers: { authorization: `Bearer ${svc.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const m = await post({ model: 'mercury-3', system: 's', prompt: 'p', schema });
  const h = await post({ model: 'claude-haiku-5-5', system: 's', prompt: 'p', schema });
  assert.deepEqual([m.ok, m.value, m.modelId], [true, { answer: 'from mercury' }, 'mercury-3']);
  assert.equal(h.ok, true);
  assert.deepEqual(ledger.usageByModel['mercury-3'], { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 0, calls: 1 });
  assert.equal(ledger.usageByModel['claude-haiku-5-5'].calls, 1);
  const refused = await fetch(`${svc.url}/model`, { method: 'POST', headers: { authorization: `Bearer ${svc.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'mercury-2.5', system: 's', prompt: 'p', schema }) });
  assert.equal(refused.status, 403, 'a model the session does not allow is refused before the port');
});

// research/mercury-20261021/PORT-PROBE.md finding 1 (engine bump 2026-10-21, item 5): a Mercury-only session subset. models[] is empty, the
// executor model is listed by id, and nothing resolves by class: class routing can never reach an executor model.
test('a Mercury-only subset is a valid policy; calls that name mercury-3 are served; class resolution reaches nothing', async t => {
  const only = subsetPolicy(policy, ['mercury-3']);
  assert.deepEqual([only.models, only.executorModels.map(m => m.id), Object.keys(only.providers)], [[], ['mercury-3'], ['inception']]);
  for (const cls of policy.classOrder) assert.deepEqual(modelsForClass(only, cls), [], `class ${cls} resolves to no model`);
  assert.throws(() => resolve(only, { class: policy.classOrder[0] }), { code: 'MODEL_CLASS_EMPTY' });
  assert.equal(nextClass(only, policy.classOrder[0]), null);
  assert.throws(() => modelById(only, 'mercury-3'), { code: 'MODEL_NOT_IN_POLICY' }, 'workflow IR nodes resolve models[] only');
  assert.equal(portModelById(only, 'mercury-3').provider, 'inception');
  const ep = await fakeEndpoint(t, [answer('{"answer":"only mercury"}')]);
  const port = new ModelPort({ policy: only, providers: { inception: new OpenAIChatProvider({ policy: only, providerName: 'inception', baseUrl: ep.baseUrl, hostEnv: env, retry: FAST, runTokenCap: 100_000 }) }, journal: new Journal(new DatabaseSync(':memory:')) });
  const r = await port.call(req());
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.deepEqual(r.value, { answer: 'only mercury' });
  await assert.rejects(port.call(req('x', { modelId: 'claude-haiku-5-5' })), { code: 'MODEL_NOT_IN_POLICY' }, 'a class model is not in a Mercury-only session');
  assert.equal(ep.requests.length, 1);
  // createModelPort builds it (the remote provider still needs its token cap) and registers no claude-cli provider.
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-ocp-only-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => createModelPort({ journalFile: path.join(dir, 'a.sqlite'), allowedModels: ['mercury-3'] }), /need tokenCap/);
  const built = createModelPort({ journalFile: path.join(dir, 'b.sqlite'), allowedModels: ['mercury-3'], tokenCap: 50_000 });
  assert.deepEqual(Object.keys(built.port.providers), ['inception']); built.db.close();
  // Only a session subset may be executor-only: the owner policy (and the Runtime) still need models[], and so does a subset without one.
  const { validatePolicy } = await import('../src/models/policy.mjs');
  assert.throws(() => validatePolicy({ ...structuredClone(policy), models: [] }), { code: 'MODEL_POLICY_INVALID' });
  assert.throws(() => validatePolicy({ ...structuredClone(policy), models: [], executorModels: [] }, { executorOnly: true }), { code: 'MODEL_POLICY_INVALID' });
});
