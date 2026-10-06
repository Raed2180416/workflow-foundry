import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort, checkPortableSchema, classifyError, normalizeDecoding } from '../src/models/port.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { ClaudeCliProvider, interpretResult } from '../src/models/providers/claude-cli.mjs';
import { LlamaServerProvider } from '../src/models/providers/llama-server.mjs';
import { LlamaSupervisor } from '../src/models/llama-supervisor.mjs';
import { Journal } from '../src/journal.mjs';

// All providers here are scripted doubles or local fake binaries. No network, no model weights.
const { policy } = loadPolicy();
const HAIKU = 'claude-haiku-4-5-20251001', QWEN = 'qwen3.5-2b-q4km', GRANITE = 'granite-4.2-3b-q4km';
const schema = { type: 'object', properties: { label: { type: 'string', enum: ['pos', 'neg', 'neu'] }, score: { type: 'number', minimum: 0, maximum: 1 } },
  required: ['label'], additionalProperties: false };
const journalOf = () => new Journal(new DatabaseSync(':memory:'));
const label = prompt => (/love|great/.test(prompt) ? 'pos' : /hate|awful/.test(prompt) ? 'neg' : 'neu');
const echo = () => new ScriptedProvider(args => ({ value: { label: label(args.prompt) }, usage: { inputTokens: 100, outputTokens: 10 } }));
const portOf = (options = {}) => new ModelPort({ policy, journal: options.journal ?? journalOf(), providers: options.providers ?? { 'claude-cli': echo(), 'llama-server': echo() }, ...options });
const req = (over = {}) => ({ runId: 'run-1', nodeKey: 'classify', attempt: 1, sampleIndex: 0, modelId: QWEN, system: 'You classify sentiment.',
  prompt: 'I love this product', schema, decoding: { maxTokens: 64, reasoning: 'none' }, receiptHash: 'a'.repeat(64), ...over });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('replay determinism: a live run replays to identical values with zero provider calls', async () => {
  const journal = journalOf(), prompts = ['I love it', 'I hate it', 'It is a chair', 'great value', 'awful smell'];
  const live = portOf({ journal, salt: 'trial:0' });
  const recorded = [];
  for (const [i, prompt] of prompts.entries()) for (const modelId of [QWEN, HAIKU]) recorded.push(await live.call(req({ prompt, modelId, nodeKey: `n${i}` })));
  assert.ok(recorded.every(r => r.ok && !r.replayed));
  assert.equal(live.providers['llama-server'].calls.length + live.providers['claude-cli'].calls.length, 10);

  const providers = { 'claude-cli': echo(), 'llama-server': echo() };
  const replay = portOf({ journal, salt: 'trial:0', mode: 'replay', providers });
  const replayed = [];
  for (const [i, prompt] of prompts.entries()) for (const modelId of [QWEN, HAIKU]) replayed.push(await replay.call(req({ runId: 'run-2', prompt, modelId, nodeKey: `n${i}` })));
  assert.deepEqual(replayed.map(r => r.value), recorded.map(r => r.value));
  assert.deepEqual(replayed.map(r => r.replayKey), recorded.map(r => r.replayKey));
  assert.deepEqual(replayed.map(r => r.replayedFrom), recorded.map(r => r.journalId));
  assert.ok(replayed.every(r => r.replayed && r.costUsd === 0 && r.imputedUsd === 0));
  assert.equal(providers['claude-cli'].calls.length + providers['llama-server'].calls.length, 0, 'zero provider calls on replay');
  assert.equal(journal.forRun('run-2').length, 10, 'replayed calls are journaled for the replaying run');
  assert.equal(journal.costForRun('run-2').costUsd, 0);
});

test('strict replay miss is REPLAY_MISS and never reaches a provider', async () => {
  const journal = journalOf(), providers = { 'claude-cli': echo(), 'llama-server': echo() };
  await portOf({ journal, salt: 's' }).call(req());
  const replay = portOf({ journal, salt: 's', mode: 'replay', providers });
  await assert.rejects(replay.call(req({ prompt: 'unseen prompt' })), { code: 'REPLAY_MISS' });
  await assert.rejects(replay.call(req({ modelId: GRANITE })), { code: 'REPLAY_MISS' });
  await assert.rejects(replay.call(req({ decoding: { maxTokens: 65, reasoning: 'none' } })), { code: 'REPLAY_MISS' });
  await assert.rejects(replay.call(req({ salt: 'other' })), { code: 'REPLAY_MISS' });
  assert.equal(providers['llama-server'].calls.length, 0);
  assert.equal((await replay.call(req())).value.label, 'pos');
});

test('a resample changes the replay key: it is a new candidate, never a cached hit', async () => {
  const journal = journalOf();
  let n = 0;
  const providers = { 'llama-server': new ScriptedProvider(() => ({ value: { label: ['pos', 'neg', 'neu'][n++ % 3] } })) };
  const port = portOf({ journal, providers, mode: 'replay-or-live', salt: 'trial:1' });
  const s0 = await port.call(req({ sampleIndex: 0 })), s1 = await port.call(req({ sampleIndex: 1 })), again = await port.call(req({ sampleIndex: 0 }));
  assert.notEqual(s0.replayKey, s1.replayKey);
  assert.equal(s0.promptHash, s1.promptHash, 'same prompt, different sample');
  assert.equal(providers['llama-server'].calls.length, 2, 'sample 1 was called live, sample 0 replayed');
  assert.deepEqual([s0.value.label, s1.value.label], ['pos', 'neg']);
  assert.equal(again.replayed, true); assert.deepEqual(again.value, s0.value);
  const otherTrial = await portOf({ journal, providers, mode: 'replay-or-live', salt: 'trial:2' }).call(req({ runId: 'run-9', sampleIndex: 0 }));
  assert.notEqual(otherTrial.replayKey, s0.replayKey, 'the salt separates trials');
  assert.equal(providers['llama-server'].calls.length, 3);
  const defaultSalt = await portOf({ journal, providers }).call(req({ runId: 'run-x' }));
  assert.equal(journal.get(defaultSalt.journalId).request.salt, 'run-x', 'salt defaults to the runId');
});

test('schema-invalid, non-JSON, truncated and refused outputs are classified and journaled', async () => {
  const journal = journalOf();
  const outputs = {
    invalid: { value: { label: 'ecstatic' } },
    extra: { value: { label: 'pos', why: 'x' } },
    text: { text: 'Sure! The label is pos.' },
    proto: { text: '{"label":"pos","__proto__":{"x":1}}' },
    truncated: { text: '{"label":"po', finishReason: 'length' },
    refusal: { text: '', finishReason: 'refusal' },
  };
  const providers = { 'llama-server': new ScriptedProvider(args => outputs[args.prompt]) };
  const port = portOf({ journal, providers });
  const expected = { invalid: 'MODEL_SCHEMA', extra: 'MODEL_SCHEMA', text: 'MODEL_SCHEMA', proto: 'MODEL_SCHEMA', truncated: 'MODEL_TRUNCATED', refusal: 'MODEL_REFUSAL' };
  for (const [prompt, code] of Object.entries(expected)) {
    const r = await port.call(req({ prompt, nodeKey: prompt }));
    assert.equal(r.ok, false, prompt); assert.equal(r.error.code, code, prompt); assert.equal(r.value, undefined);
    const row = journal.get(r.journalId);
    assert.equal(row.ok, false); assert.equal(row.errorCode, code);
    assert.equal(row.response.text, outputs[prompt].text ?? JSON.stringify(outputs[prompt].value), 'raw output preserved');
  }
  const invalid = journal.forAttempt('run-1', 'invalid', 1)[0];
  assert.deepEqual(invalid.response.rejectedValue, { label: 'ecstatic' });
  assert.match(invalid.response.error.message, /must be equal to one of the allowed values/);
  // A schema failure replays as recorded (it is model behaviour, not an outage).
  const replay = await portOf({ journal, mode: 'replay', providers: {} }).call(req({ prompt: 'invalid', nodeKey: 'invalid' }));
  assert.equal(replay.ok, false); assert.equal(replay.error.code, 'MODEL_SCHEMA'); assert.equal(replay.replayed, true);
});

test('provider faults are classified, journaled before return, and environment faults never replay', async () => {
  const journal = journalOf();
  const faults = {
    rate: () => { throw new Error('API Error: 529 {"type":"overloaded_error"}'); },
    coded: { error: { code: 'MODEL_RATE_LIMIT', message: 'HTTP 429' } },
    refused: () => { throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8402'), { code: 'ECONNREFUSED' }); },
    odd: () => { throw new Error('something unexpected'); },
  };
  const providers = { 'llama-server': new ScriptedProvider(args => typeof faults[args.prompt] === 'function' ? faults[args.prompt]() : faults[args.prompt]) };
  const port = portOf({ journal, providers });
  const codes = {};
  for (const prompt of Object.keys(faults)) {
    const r = await port.call(req({ prompt, nodeKey: prompt }));
    codes[prompt] = r.error.code;
    assert.equal(journal.get(r.journalId).errorCode, r.error.code);
  }
  assert.deepEqual(codes, { rate: 'MODEL_RATE_LIMIT', coded: 'MODEL_RATE_LIMIT', refused: 'MODEL_UNAVAILABLE', odd: 'MODEL_PROTOCOL' });
  await assert.rejects(portOf({ journal, mode: 'replay' }).call(req({ prompt: 'rate', nodeKey: 'rate' })), { code: 'REPLAY_MISS' });
  assert.equal(classifyError({ name: 'TimeoutError' }), 'MODEL_TIMEOUT');
  assert.equal(classifyError({ code: 'PROCESS_LAUNCH' }), 'MODEL_UNAVAILABLE');

  const failing = { record() { throw new Error('disk full'); }, lookup: () => null, forAttempt: () => [] };
  await assert.rejects(portOf({ journal: failing }).call(req()), /disk full/, 'an unjournaled result is never returned');
});

test('timeouts and cancellation are journaled; cancellation throws', async () => {
  const journal = journalOf();
  const providers = { 'llama-server': new ScriptedProvider(() => ({ value: { label: 'pos' }, delayMs: 2000 })) };
  const port = portOf({ journal, providers });
  const slow = await port.call(req({ timeoutMs: 50 }));
  assert.equal(slow.ok, false); assert.equal(slow.error.code, 'MODEL_TIMEOUT');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(port.call(req({ nodeKey: 'cancel', signal: controller.signal })), { code: 'CANCELLED' });
  assert.deepEqual(journal.forRun('run-1').map(r => r.errorCode), ['MODEL_TIMEOUT', 'CANCELLED']);
});

test('portable schema subset is enforced before any provider call', async () => {
  const journal = journalOf(), providers = { 'claude-cli': echo(), 'llama-server': echo() };
  const port = portOf({ journal, providers });
  const leaf = extra => ({ type: 'object', properties: { x: { type: 'string', ...extra } } });
  const rejected = {
    pattern: leaf({ pattern: '^a' }), format: leaf({ format: 'email' }), uniqueItems: { type: 'object', properties: { x: { type: 'array', uniqueItems: true } } },
    oneOf: { type: 'object', oneOf: [{ required: ['a'] }] }, anyOf: leaf({ anyOf: [{ type: 'string' }] }), allOf: { type: 'object', allOf: [] },
    not: leaf({ not: { const: 'a' } }), $ref: { type: 'object', properties: { x: { $ref: '#/$defs/x' } }, $defs: { x: { type: 'string' } } },
    patternProperties: { type: 'object', patternProperties: { '^a': { type: 'string' } } }, if: leaf({ if: { const: 'a' }, then: { maxLength: 1 } }),
    tuple: { type: 'object', properties: { x: { type: 'array', items: [{ type: 'string' }] } } }, rootArray: { type: 'array', items: { type: 'string' } },
    nestedAdditional: { type: 'object', additionalProperties: { type: 'string', pattern: 'x' } }, title: { type: 'object', title: 'T' },
    badType: { type: 'object', properties: { x: { type: 'date' } } },
  };
  for (const [name, bad] of Object.entries(rejected)) {
    assert.throws(() => checkPortableSchema(bad), { code: 'UNSUPPORTED_SCHEMA' }, name);
    for (const modelId of [QWEN, HAIKU]) await assert.rejects(port.call(req({ schema: bad, modelId })), { code: 'UNSUPPORTED_SCHEMA' }, name);
  }
  assert.equal(providers['llama-server'].calls.length + providers['claude-cli'].calls.length, 0);
  assert.equal(journal.forRun('run-1').length, 0);
  const portable = { type: 'object', description: 'd', required: ['a'], additionalProperties: false, properties: {
    a: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', properties: { k: { const: 'x' }, n: { type: ['integer', 'null'], minimum: 0, maximum: 9 } } } },
    s: { type: 'string', minLength: 1, maxLength: 80, enum: ['x', 'y'] }, b: { type: 'boolean' } } };
  assert.equal(checkPortableSchema(portable), portable);
});

test('requests are validated: decoding fields, reasoning levels and identifiers', async () => {
  const port = portOf();
  await assert.rejects(port.call(req({ decoding: { topP: 0.9 } })), { code: 'MODEL_REQUEST' });
  await assert.rejects(port.call(req({ decoding: { reasoning: 'max' } })), { code: 'MODEL_REQUEST' });
  await assert.rejects(port.call(req({ decoding: { maxTokens: 0 } })), { code: 'MODEL_REQUEST' });
  await assert.rejects(port.call(req({ runId: '' })), { code: 'MODEL_REQUEST' });
  await assert.rejects(port.call(req({ sampleIndex: -1 })), { code: 'MODEL_REQUEST' });
  await assert.rejects(port.call(req({ mode: 'cache' })), { code: 'MODEL_REQUEST' });
  await assert.rejects(portOf({ providers: { 'claude-cli': echo() } }).call(req()), { code: 'MODEL_PROVIDER_MISSING' });
  assert.deepEqual(normalizeDecoding({}), { maxTokens: null, reasoning: 'none', temperature: null });
  assert.equal(portOf().call.length, 1);
  assert.throws(() => new ModelPort({ policy, providers: {} }), { code: 'MODEL_PORT' });
  const a = await port.call(req({ decoding: {} })), b = await port.call(req({ decoding: { reasoning: 'none' }, nodeKey: 'other' }));
  assert.equal(a.replayKey, b.replayKey, 'normalised decoding: omitted defaults hash identically');
});

test('per-provider concurrency caps hold: hosted pool and one slot per local model', async () => {
  const active = {}, peak = {};
  const tracked = () => new ScriptedProvider(async args => {
    const id = args.modelEntry.id, p = args.modelEntry.provider;
    active[id] = (active[id] ?? 0) + 1; active[p] = (active[p] ?? 0) + 1;
    peak[id] = Math.max(peak[id] ?? 0, active[id]); peak[p] = Math.max(peak[p] ?? 0, active[p]);
    await sleep(25);
    active[id]--; active[p]--;
    return { value: { label: 'neu' } };
  });
  const port = portOf({ providers: { 'claude-cli': tracked(), 'llama-server': tracked() }, concurrency: { 'claude-cli': 2 } });
  const calls = [];
  for (let i = 0; i < 6; i++) calls.push(port.call(req({ modelId: HAIKU, nodeKey: `h${i}` })));
  for (let i = 0; i < 3; i++) calls.push(port.call(req({ modelId: QWEN, nodeKey: `q${i}` })), port.call(req({ modelId: GRANITE, nodeKey: `g${i}` })));
  const results = await Promise.all(calls);
  assert.ok(results.every(r => r.ok));
  assert.equal(peak['claude-cli'], 2, 'hosted cap respected and reached');
  assert.equal(peak[QWEN], 1); assert.equal(peak[GRANITE], 1);
  assert.equal(peak['llama-server'], 2, 'different local models run side by side');
  const queued = portOf({ providers: { 'llama-server': new ScriptedProvider(() => ({ value: { label: 'pos' }, delayMs: 200 })) } });
  const first = queued.call(req());
  const controller = new AbortController();
  const second = queued.call(req({ nodeKey: 'queued', signal: controller.signal }));
  controller.abort();
  await assert.rejects(second, { code: 'CANCELLED' });
  assert.equal((await first).ok, true);
});

test('cost accounting: hosted list price or reported cost, local imputed compute, summed per run', async () => {
  let clock = 1_000_000;
  const journal = journalOf();
  const providers = {
    'claude-cli': new ScriptedProvider(args => args.prompt === 'reported'
      ? { value: { label: 'pos' }, usage: { inputTokens: 1842, outputTokens: 134 }, costUsd: 0.002512 }
      : { value: { label: 'pos' }, usage: { inputTokens: 1000, outputTokens: 200 } }),
    'llama-server': new ScriptedProvider(() => { clock += 18000; return { value: { label: 'pos' }, usage: { inputTokens: 30, outputTokens: 7 } }; }),
  };
  const port = portOf({ journal, providers, now: () => clock });
  const hosted = await port.call(req({ modelId: HAIKU, nodeKey: 'h' }));
  assert.ok(Math.abs(hosted.costUsd - (1000 * 1 + 200 * 5) / 1e6) < 1e-12); assert.equal(hosted.imputedUsd, 0);
  const reported = await port.call(req({ modelId: HAIKU, nodeKey: 'r', prompt: 'reported' }));
  assert.equal(reported.costUsd, 0.002512, 'provider-reported cost wins over list price');
  const local = await port.call(req({ modelId: QWEN, nodeKey: 'l' }));
  assert.equal(local.costUsd, 0); assert.equal(local.latencyMs, 18000);
  assert.ok(Math.abs(local.imputedUsd - 18 / 3600 * policy.providers['llama-server'].imputedComputeUsdPerHour) < 1e-12);
  assert.deepEqual(local.usage, { inputTokens: 30, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const total = journal.costForRun('run-1');
  assert.equal(total.calls, 3);
  assert.ok(Math.abs(total.costUsd - (0.002 + 0.002512)) < 1e-12);
  assert.ok(Math.abs(total.imputedUsd - 0.001) < 1e-12);
  assert.equal(total.inputTokens, 1000 + 1842 + 30);
});

test('crash recovery: a journaled call in the same attempt is recovered without a provider call', async () => {
  const journal = journalOf(), providers = { 'llama-server': echo() };
  const before = await portOf({ journal, providers }).call(req());
  const resumed = portOf({ journal, providers });
  const recovered = await resumed.call(req());
  assert.equal(recovered.recovered, true); assert.deepEqual(recovered.value, before.value);
  assert.equal(recovered.journalId, before.journalId);
  assert.equal(providers['llama-server'].calls.length, 1);
  assert.equal(journal.forRun('run-1').length, 1, 'recovery writes no duplicate row');
  assert.deepEqual(resumed.recover({ runId: 'run-1', nodeKey: 'classify', attempt: 1 }).map(r => r.value), [before.value]);
  await resumed.call(req({ attempt: 2 }));
  assert.equal(providers['llama-server'].calls.length, 2, 'a new attempt is a new call');
  const flaky = { 'llama-server': new ScriptedProvider([{ error: 'MODEL_UNAVAILABLE' }, { value: { label: 'neg' } }]) };
  const j2 = journalOf();
  assert.equal((await portOf({ journal: j2, providers: flaky }).call(req())).error.code, 'MODEL_UNAVAILABLE');
  assert.equal((await portOf({ journal: j2, providers: flaky }).call(req())).value.label, 'neg', 'outages are re-called, not recovered');
});

// ---- claude-cli provider against a local fake binary (no network, no model) ----
const FAKE_CLAUDE = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2), log = process.env.FAKE_CLAUDE_LOG;
if (argv[0] === '--version') { fs.appendFileSync(log, JSON.stringify({ version: true }) + '\n'); console.log('9.9.9 (Claude Code)'); process.exit(0); }
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const at = f => argv[argv.indexOf(f) + 1], scenario = process.env.FAKE_CLAUDE_SCENARIO, model = at('--model');
  fs.appendFileSync(log, JSON.stringify({ argv, stdin: input, cwd: process.cwd(), entries: fs.readdirSync('.'), gh: 'GH_TOKEN' in process.env, pid: process.pid, scenario }) + '\n');
  if (scenario === 'hang') { setInterval(() => {}, 1000); return; }
  if (scenario === 'garbage') { process.stderr.write('API Error: 529 overloaded\n'); process.stdout.write('not json'); process.exit(1); }
  const usage = { input_tokens: 1842, output_tokens: 134, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 };
  const base = { type: 'result', subtype: 'success', is_error: false, api_error_status: null, stop_reason: 'tool_use', terminal_reason: 'completed', num_turns: 2,
    total_cost_usd: 0.002512, usage, modelUsage: { [model]: { costUSD: 0.002512, canonicalModel: model.replace(/-\d{8}$/, ''), costBasis: 'list' } } };
  const out = {
    ok: { ...base, result: '{"label":"pos"}', structured_output: { label: 'pos' } },
    invalid: { ...base, result: '{"label":"great"}', structured_output: { label: 'great' } },
    ratelimit: { ...base, is_error: true, api_error_status: 429, result: 'API Error: 429 rate_limit_error' },
    overloaded: { ...base, is_error: true, api_error_status: 529, result: 'API Error: 529 overloaded_error' },
    budget: { ...base, is_error: true, subtype: 'error_max_budget_usd', result: '' },
    server: { ...base, is_error: true, api_error_status: 500, result: 'API Error: 500' },
    retries: { ...base, is_error: true, subtype: 'error_max_structured_output_retries', result: '' },
    maxtokens: { ...base, stop_reason: 'max_tokens', result: '{"label":"po' },
    wrongmodel: { ...base, modelUsage: { 'claude-opus-5-5': { costUSD: 0.01, canonicalModel: 'claude-opus-5-5' } }, structured_output: { label: 'pos' }, result: '' },
  }[scenario];
  process.stdout.write(JSON.stringify(out)); process.exit(out.is_error ? 1 : 0);
});
`;

function fakeDir(t, prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('claude-cli provider: argv, stdin prompt, empty throwaway cwd, parsing and classification', async t => {
  const dir = fakeDir(t, 'foundry-fake-claude-');
  const binary = path.join(dir, 'claude'), log = path.join(dir, 'log.jsonl');
  writeFileSync(binary, FAKE_CLAUDE); chmodSync(binary, 0o755); writeFileSync(log, '');
  const journal = journalOf();
  const provider = (scenario, options = {}) => new ClaudeCliProvider({ policy, binary, env: { ...process.env, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_SCENARIO: scenario, GH_TOKEN: 'placeholder' }, ...options });
  const callWith = (scenario, over = {}, options = {}) => portOf({ journal, providers: { 'claude-cli': provider(scenario, options) } }).call(req({ modelId: HAIKU, nodeKey: scenario, ...over }));
  const entries = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(e => !e.version);

  const ok = await callWith('ok', { decoding: { reasoning: 'high', maxTokens: 64 } });
  assert.equal(ok.ok, true); assert.deepEqual(ok.value, { label: 'pos' });
  assert.equal(ok.costUsd, 0.002512); assert.equal(ok.engineVersion, 'claude-code 9.9.9');
  assert.deepEqual(ok.usage, { inputTokens: 1842, outputTokens: 134, cacheReadTokens: 10, cacheWriteTokens: 5 });
  const seen = entries()[0];
  assert.equal(seen.stdin, 'I love this product', 'prompt travels on stdin');
  assert.deepEqual(seen.argv.slice(0, policy.providers['claude-cli'].invocation.length), policy.providers['claude-cli'].invocation);
  const at = f => seen.argv[seen.argv.indexOf(f) + 1];
  assert.equal(at('--model'), HAIKU); assert.equal(at('--system-prompt'), 'You classify sentiment.'); assert.deepEqual(JSON.parse(at('--json-schema')), schema);
  assert.equal(at('--effort'), 'high'); assert.equal(at('--max-budget-usd'), '1');
  assert.ok(!seen.argv.some(a => a.includes('fallback')), 'never --fallback-model');
  assert.equal(seen.gh, false, 'repository credentials are scrubbed');
  assert.deepEqual(seen.entries, [], 'cwd is an empty directory');
  assert.ok(path.basename(seen.cwd).startsWith('foundry-claude-')); assert.equal(existsSync(seen.cwd), false, 'cwd removed afterwards');
  const row = journal.get(ok.journalId);
  assert.equal(row.request.providerRequest.temperature, 'provider-default');
  assert.ok(row.request.providerRequest.args.includes('<system>'));
  assert.equal(row.response.meta.servedModels[0], HAIKU);

  for (const [reasoning, effort] of [['none', 'low'], ['low', 'low'], ['medium', 'medium']]) {
    await callWith('ok', { decoding: { reasoning }, nodeKey: `effort-${reasoning}` });
    assert.equal(entries().at(-1).argv.at(entries().at(-1).argv.indexOf('--effort') + 1), effort);
  }
  await callWith('ok', { nodeKey: 'cap' }, { maxBudgetUsd: 0.25 });
  assert.equal(entries().at(-1).argv.at(entries().at(-1).argv.indexOf('--max-budget-usd') + 1), '0.25');

  const codes = {};
  for (const scenario of ['invalid', 'ratelimit', 'overloaded', 'budget', 'server', 'retries', 'maxtokens', 'wrongmodel', 'garbage']) {
    const r = await callWith(scenario);
    codes[scenario] = r.error?.code;
    assert.equal(journal.get(r.journalId).errorCode, r.error.code);
  }
  assert.deepEqual(codes, { invalid: 'MODEL_SCHEMA', ratelimit: 'MODEL_RATE_LIMIT', overloaded: 'MODEL_RATE_LIMIT', budget: 'MODEL_BUDGET', server: 'MODEL_UNAVAILABLE',
    retries: 'MODEL_SCHEMA', maxtokens: 'MODEL_TRUNCATED', wrongmodel: 'MODEL_PROTOCOL', garbage: 'MODEL_RATE_LIMIT' });
  assert.equal(journal.forAttempt('run-1', 'ratelimit', 1)[0].costUsd, 0.002512, 'cost of a failed hosted call is still recorded');

  const hung = await callWith('hang', { timeoutMs: 2000 });
  assert.equal(hung.error.code, 'MODEL_TIMEOUT');
  const { pid } = entries().find(e => e.scenario === 'hang');
  for (let i = 0; i < 40; i++) { try { process.kill(pid, 0); } catch { break; } await sleep(50); }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'the process group was killed');
  const versionProbes = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.version).length;
  assert.equal(versionProbes, 1, 'claude --version runs once per binary');

  const missing = await portOf({ journal, providers: { 'claude-cli': new ClaudeCliProvider({ policy, binary: path.join(dir, 'nope') }) } }).call(req({ modelId: HAIKU, nodeKey: 'missing' }));
  assert.equal(missing.error.code, 'MODEL_UNAVAILABLE');
  await assert.rejects(provider('ok').complete({ modelEntry: { id: 'gpt-4o', provider: 'claude-cli' }, system: '', prompt: '', schema }), { code: 'MODEL_NOT_IN_POLICY' });
  assert.throws(() => interpretResult({ type: 'other' }), { code: 'MODEL_PROTOCOL' });
});

// ---- llama-server provider and supervisor against a local fake server ----
const FAKE_LLAMA = String.raw`#!/usr/bin/env node
const http = require('node:http');
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stderr.write('version: 0.0.0-fake (build 1, commit fake)\nbuilt with test\n'); process.exit(0); }
const at = f => argv[argv.indexOf(f) + 1], port = Number(at('--port')), model = at('-m'), readyAt = Date.now() + 300;
console.log(JSON.stringify({ argv, env: Object.keys(process.env).sort(), pid: process.pid }));
http.createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/health') return Date.now() < readyAt ? send(503, { error: { message: 'Loading model' } }) : send(200, { status: 'ok' });
  if (req.url === '/props') return send(200, { model_path: model, build_info: 'fake', total_slots: 1 });
  if (req.url === '/v1/chat/completions') {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      const body = JSON.parse(b);
      const fine = body.response_format.type === 'json_schema' && body.response_format.json_schema.strict === true && body.chat_template_kwargs.enable_thinking === false && body.temperature === 0;
      send(200, { model, system_fingerprint: 'fake', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ label: fine ? 'pos' : 'neg' }) } }],
        usage: { prompt_tokens: 30, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 3 } } });
    });
    return;
  }
  send(404, {});
}).listen(port, '127.0.0.1');
`;
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('llama-server provider + supervisor: on-demand detached start, strict json_schema request, served-model check, stop', async t => {
  const dir = fakeDir(t, 'foundry-fake-llama-');
  const binary = path.join(dir, 'llama-server');
  writeFileSync(binary, FAKE_LLAMA); chmodSync(binary, 0o755);
  const local = structuredClone(policy);
  for (const m of local.models.filter(m => m.provider === 'llama-server')) { m.port = await freePort(); writeFileSync(path.join(dir, m.weights.file), ''); }
  const supervisor = new LlamaSupervisor({ policy: local, binary, modelsDir: dir, logDir: dir, startTimeoutMs: 10000 });
  t.after(() => supervisor.stopAll());
  const journal = journalOf();
  const port = new ModelPort({ policy: local, journal, providers: { 'llama-server': new LlamaServerProvider({ policy: local, supervisor }) } });
  const entry = local.models.find(m => m.id === QWEN);

  assert.equal(await supervisor.health(entry), false);
  const first = await port.call(req());
  assert.equal(first.ok, true, JSON.stringify(first.error)); assert.deepEqual(first.value, { label: 'pos' });
  assert.equal(first.engineVersion, 'llama-server 0.0.0-fake (build 1, commit fake)');
  assert.ok(first.imputedUsd > 0); assert.equal(first.costUsd, 0);
  assert.deepEqual(first.usage, { inputTokens: 30, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 0 });
  const row = journal.get(first.journalId);
  assert.equal(row.response.meta.server.started, true); assert.equal(row.response.meta.servedModel, entry.weights.file);
  assert.equal(row.request.providerRequest.enable_thinking, false); assert.equal(row.request.providerRequest.max_tokens, 64);
  const launched = JSON.parse(readFileSync(path.join(dir, `foundry-llama-${entry.port}.log`), 'utf8').split('\n')[0]);
  assert.deepEqual(launched.argv, ['-m', path.join(dir, entry.weights.file), '--host', '127.0.0.1', '--port', String(entry.port), '-c', '8192', '-t', '4', '-np', '1', '--jinja']);
  assert.deepEqual(launched.env, ['LANG', 'PATH'], 'the server gets a scoped environment');
  const second = await port.call(req({ nodeKey: 'again' }));
  assert.equal(journal.get(second.journalId).response.meta.server.started, false, 'a healthy server is reused');

  // A healthy port serving other weights is refused, never silently used.
  const impostor = structuredClone(local); impostor.models.find(m => m.id === QWEN).weights.file = 'Other.gguf';
  const other = new LlamaSupervisor({ policy: impostor, binary, modelsDir: dir, logDir: dir, stopOnExit: false });
  await assert.rejects(other.ensureServer(impostor.models.find(m => m.id === QWEN)), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(await other.stopServer(entry), false, 'a supervisor never stops a server it did not start');
  assert.equal(await supervisor.health(entry), true);

  await assert.rejects(supervisor.ensureServer({ ...entry, id: 'qwen3.5-9b:itb' }), { code: 'MODEL_NOT_IN_POLICY' });
  const granite = await port.call(req({ modelId: GRANITE, nodeKey: 'g' }));
  assert.equal(granite.ok, true, 'a second local model gets its own server on its own port');
  // After a crash a fresh supervisor re-owns the server through its pid file and can stop it.
  const graniteEntry = local.models.find(m => m.id === GRANITE);
  const successor = new LlamaSupervisor({ policy: local, binary, modelsDir: dir, logDir: dir, stopOnExit: false });
  assert.equal((await successor.ensureServer(graniteEntry)).adopted, true);
  assert.equal(await successor.stopServer(graniteEntry), true);
  assert.equal(await supervisor.health(graniteEntry), false);
  assert.equal(existsSync(successor.pidFile(graniteEntry)), false);
  assert.equal(supervisor.started.has(graniteEntry.port), false, 'the original owner saw its child exit');
  assert.equal(await supervisor.stopAll(), 1);
  assert.equal(await supervisor.health(entry), false);
  rmSync(path.join(dir, entry.weights.file));
  const noWeights = await port.call(req({ nodeKey: 'no-weights' }));
  assert.equal(noWeights.error.code, 'MODEL_UNAVAILABLE');
});

test('llama-server provider: request body, finish=length, HTTP faults and substituted weights', async t => {
  const entry = policy.models.find(m => m.id === QWEN);
  const responses = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    responses.push({ url, body });
    const next = responses.length;
    const ok = content => new Response(JSON.stringify({ model: `/opt/models/${entry.weights.file}`, choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200 });
    if (next === 1) return ok('{"label":"neu"}');
    if (next === 2) return new Response(JSON.stringify({ model: entry.weights.file, choices: [{ finish_reason: 'length', message: { content: '{"label":"n' } }] }), { status: 200 });
    if (next === 3) return new Response('{"error":"busy"}', { status: 503 });
    if (next === 4) return new Response(JSON.stringify({ model: '/opt/models/Other.gguf', choices: [{ finish_reason: 'stop', message: { content: '{"label":"neu"}' } }] }), { status: 200 });
    if (next === 5) return new Response('{"error":"bad schema"}', { status: 400 });
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  });
  const provider = new LlamaServerProvider({ policy, autoStart: false, supervisor: { engineVersion: async () => 'llama-server fake' } });
  const port = portOf({ providers: { 'llama-server': provider } });
  const first = await port.call(req({ decoding: { reasoning: 'low', maxTokens: 32, temperature: 0.7 } }));
  assert.equal(first.ok, true);
  const { url, body } = responses[0];
  assert.equal(url, `http://127.0.0.1:${entry.port}/v1/chat/completions`);
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'output', schema, strict: true } });
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true });
  assert.equal(body.temperature, 0.7); assert.equal(body.max_tokens, 32); assert.equal(body.model, QWEN);
  assert.deepEqual(body.messages.map(m => m.role), ['system', 'user']);
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await port.call(req({ nodeKey: `f${i}` }))).error?.code);
  assert.deepEqual(codes, ['MODEL_TRUNCATED', 'MODEL_UNAVAILABLE', 'MODEL_PROTOCOL', 'MODEL_PROTOCOL', 'MODEL_UNAVAILABLE']);
  assert.equal(responses[1].body.temperature, 0, 'temperature defaults to 0'); assert.equal(responses[1].body.chat_template_kwargs.enable_thinking, false);
});
