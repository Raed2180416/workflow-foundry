import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { OllamaLocalProvider } from '../src/ollama-local.mjs';

const model = 'qwen3.5-9b:itb';
const expectedDigest = '2afe0596021d6625b47a72567b3ce6692c2afa73a686d8bda8bd820c0b1710fb';
const prompt = 'Return exactly {"ok":true}';
const reply = () => ({ model, done: true, done_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' },
  prompt_eval_count: 100, eval_count: 5, total_duration: 1000, load_duration: 100, prompt_eval_duration: 200, eval_duration: 700 });

// All transport and GPU observations below are supplied fixtures. No actual
// Ollama call, model load, model pull or provider request is permitted by tests.
function fixture(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-ollama-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = []; let tagReads = 0;
  const originalRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => file === '/proc/meminfo' ? `MemAvailable: ${options.memoryKB ?? 8388608} kB\n` : originalRead(file, ...args));
  t.mock.method(childProcess, 'spawnSync', (binary, args) => {
    assert.equal(binary, '/usr/bin/nvidia-smi');
    assert.deepEqual(args, ['--query-gpu=memory.free', '--format=csv,noheader,nounits']);
    return options.gpu ?? { status: 0, stdout: '8192\n', stderr: '' };
  });
  t.mock.method(globalThis, 'fetch', async (url, request = {}) => {
    assert.ok(String(url).startsWith('http://127.0.0.1:11434/api/'));
    assert.equal(request.redirect, 'error');
    const route = String(url).slice('http://127.0.0.1:11434/api/'.length);
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({ route, body, method: request.method });
    assert.ok(!request.headers?.authorization);
    let value;
    if (route === 'version') value = { version: options.version ?? '0.31.1' };
    else if (route === 'tags') {
      const digest = (++tagReads === 1 ? options.beforeDigest : options.afterDigest) ?? expectedDigest;
      value = { models: [{ name: model, digest, size: 5680522838 }] };
    } else if (route === 'show') value = { details: { quantization_level: 'Q4_K_M' }, template: 'fixture-template', parameters: 'num_ctx 8192',
      model_info: { 'general.architecture': 'qwen35', 'general.parameter_count': 8953803264, 'qwen35.full_attention_interval': 4, 'qwen35.context_length': 262144 }, ...options.show };
    else if (route === 'ps') value = { models: options.resident ?? [] };
    else if (route === 'chat') {
      assert.equal(calls.filter(call => call.route === 'chat').length, 1, 'no retry');
      if (options.chat) return options.chat(request);
      value = options.response ?? reply();
    } else assert.fail(`Unpermitted local route: ${route}`);
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return {
    directory, calls, provider: new OllamaLocalProvider({ expectedDigest, timeoutMs: 1000 }),
    receipts: () => path.join(directory, readdirSync(directory)[0]),
  };
}

test('local provider constructor is inert, identified and rejects unbounded or unknown configurations', () => {
  const provider = new OllamaLocalProvider({ expectedDigest });
  assert.equal(provider.identity.expectedDigest, expectedDigest);
  assert.equal(provider.identity.numCtx, 32768);
  assert.equal(provider.identity.maxOutputTokens, 8192);
  for (const options of [{ expectedDigest: undefined }, { model: 'guessed:cloud' }, { numCtx: 262144 }, { maxOutputTokens: -1 },
    { timeoutMs: Infinity }, { seed: 2 }, { temperature: 0.3 }, { numCtx: 8192, maxOutputTokens: 8192 }])
    assert.throws(() => new OllamaLocalProvider({ expectedDigest, ...options }));
});

test('one loopback request binds prompt and manifest, declares no tools, unload intent and token/latency evidence', async t => {
  const f = fixture(t);
  const result = await f.provider.generate({ prompt, directory: f.directory });
  assert.equal(result.text, '{"ok":true}');
  const chat = f.calls.filter(call => call.route === 'chat');
  assert.equal(chat.length, 1);
  assert.deepEqual(chat[0].body, { model, messages: [{ role: 'user', content: prompt }], tools: [], stream: false, think: false, keep_alive: 0,
    options: { num_ctx: 32768, num_predict: 8192, seed: 0, temperature: 0 } });
  assert.equal(result.evidence.manifestDigestBefore, expectedDigest);
  assert.equal(result.evidence.manifestDigestAfter, expectedDigest);
  assert.equal(result.evidence.promptEvalCount, 100);
  assert.match(result.evidence.inputTruncation, /^unknown:/);
  assert.equal(result.evidence.inferenceCalls, 1);
  assert.equal(readFileSync(path.join(f.receipts(), 'prompt.txt'), 'utf8'), prompt);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.receipts(), 'raw-response.json'))), reply());
  assert.deepEqual(f.calls.map(call => call.route), ['version', 'tags', 'show', 'ps', 'chat', 'tags', 'ps']);
});

for (const [name, options, code] of [
  ['manifest drift before dispatch', { beforeDigest: '0'.repeat(64) }, 'MODEL_DIGEST_DRIFT'],
  ['version drift', { version: '0.32.0' }, 'MODEL_VERSION_DRIFT'],
  ['cloud routing metadata', { show: { remote_host: 'https://example.invalid' } }, 'MODEL_METADATA_DRIFT'],
  ['missing context metadata', { show: { model_info: { 'general.architecture': 'qwen35', 'general.parameter_count': 8953803264, 'qwen35.full_attention_interval': 4 } } }, 'MODEL_METADATA_DRIFT'],
  ['unavailable NVML', { gpu: { status: 18, stdout: 'NVML mismatch' } }, 'MODEL_GPU_PREFLIGHT'],
  ['insufficient GPU reserve', { gpu: { status: 0, stdout: '5000\n' } }, 'MODEL_GPU_PREFLIGHT'],
  ['insufficient host reserve', { memoryKB: 1048576 }, 'MODEL_MEMORY_PREFLIGHT'],
  ['already resident target', { resident: [{ name: model, digest: expectedDigest }] }, 'MODEL_BUSY'],
  ['already resident other model', { resident: [{ name: 'someone-elses-model' }] }, 'MODEL_BUSY'],
]) test(`local preflight stops ${name} without chat or unload`, async t => {
  const f = fixture(t, options);
  await assert.rejects(f.provider.generate({ prompt, directory: f.directory }), { code });
  assert.equal(f.calls.filter(call => call.route === 'chat').length, 0);
  assert.equal(JSON.parse(readFileSync(path.join(f.receipts(), 'failure.json'))).inferenceCalls, 0);
});

test('post-call digest drift rejects otherwise green text and preserves response without retry', async t => {
  const f = fixture(t, { afterDigest: '0'.repeat(64) });
  await assert.rejects(f.provider.generate({ prompt, directory: f.directory }), { code: 'MODEL_DIGEST_DRIFT' });
  assert.equal(f.calls.filter(call => call.route === 'chat').length, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.receipts(), 'raw-response.json'))), reply());
});

for (const [name, modify, code] of [
  ['length termination', response => { response.done_reason = 'length'; }, 'MODEL_INCOMPLETE'],
  ['tools', response => { response.message.tool_calls = [{ function: { name: 'run' } }]; }, 'MODEL_TOOL_ATTEMPT'],
  ['wrong model', response => { response.model = 'other'; }, 'MODEL_PROTOCOL'],
  ['missing completion', response => { response.done = false; }, 'MODEL_PROTOCOL'],
  ['missing usage', response => { delete response.prompt_eval_count; }, 'MODEL_USAGE_UNKNOWN'],
  ['context pressure', response => { response.prompt_eval_count = 32700; }, 'MODEL_CONTEXT_LIMIT'],
  ['output over budget', response => { response.eval_count = 8193; }, 'MODEL_CONTEXT_LIMIT'],
  ['empty final text', response => { response.message.content = ''; }, 'MODEL_INCOMPLETE'],
]) test(`local response rejects ${name}, retaining measured bytes and no retry`, async t => {
  const response = reply(); modify(response);
  const f = fixture(t, { response });
  await assert.rejects(f.provider.generate({ prompt, directory: f.directory }), { code });
  assert.equal(f.calls.filter(call => call.route === 'chat').length, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.receipts(), 'raw-response.json'))), response);
});

test('cancellation before dispatch makes no metadata or inference request', async t => {
  const f = fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.provider.generate({ prompt, directory: f.directory, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(f.calls.length, 0);
});

test('cancellation during the one request records read-only after checks and never sends a separate unload', async t => {
  const controller = new AbortController();
  const f = fixture(t, { chat: async request => { controller.abort(); assert.equal(request.signal.aborted, true); throw new DOMException('aborted', 'AbortError'); } });
  await assert.rejects(f.provider.generate({ prompt, directory: f.directory, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(f.calls.filter(call => call.route === 'chat').length, 1);
  assert.deepEqual(f.calls.slice(-2).map(call => call.route), ['tags', 'ps']);
  assert.equal(JSON.parse(readFileSync(path.join(f.receipts(), 'failure.json'))).inferenceCalls, 1);
});

test('local HTTP refusal is terminal with one request, no fallback and preserved failure', async t => {
  const f = fixture(t, { chat: async () => new Response('{"error":"unavailable"}', { status: 503 }) });
  await assert.rejects(f.provider.generate({ prompt, directory: f.directory }), { code: 'MODEL_HTTP' });
  assert.equal(f.calls.filter(call => call.route === 'chat').length, 1);
  assert.equal(f.provider.active, false);
});
