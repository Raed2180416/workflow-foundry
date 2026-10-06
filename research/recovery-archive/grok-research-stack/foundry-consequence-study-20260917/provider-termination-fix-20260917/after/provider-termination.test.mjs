import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { OpenCodeV2FreeProvider } from '../src/opencode-v2-free.mjs';

// Run the actual adapter, bubblewrap, installed CLI and its private server.
// Every parent fetch is supplied here; the child has no external network.
const supported = process.platform === 'linux' && ['/usr/bin/bwrap', '/usr/bin/opencode', '/usr/bin/node'].every(existsSync);
const prompt = 'Return exactly this JSON object and nothing else: {"ok":true}';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.stringify({ opencode: { id: 'opencode', name: 'OpenCode Zen', env: [],
  api: 'https://opencode.ai/zen/v1', npm: '@ai-sdk/openai-compatible', models: {
    'big-pickle': { id: 'big-pickle', name: 'Big Pickle', family: 'big-pickle', attachment: false,
      reasoning: true, tool_call: true, interleaved: { field: 'reasoning_content' }, temperature: true,
      knowledge: '2025-01', release_date: '2025-10-17', last_updated: '2025-10-17',
      modalities: { input: ['text'], output: ['text'] }, open_weights: false,
      limit: { context: 200000, input: 160000, output: 32000 },
      cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } },
  } } });
const chunk = (delta, finish_reason = null, usage) => 'data: ' + JSON.stringify({ id: 'supplied-termination-fixture',
  object: 'chat.completion.chunk', created: 1, model: 'big-pickle',
  choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) }) + '\n\n';
const partial = ': keep-alive\n\n' + chunk({ role: 'assistant', content: '', reasoning_content: 'Supplied unfinished reasoning.' });
const complete = chunk({ role: 'assistant', content: '{"ok":true}' }) + chunk({}, 'stop',
  { prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 }) + 'data: [DONE]\n\n';

async function exercise(t, name, options = {}) {
  const evidenceRoot = process.env.FOUNDRY_TERMINATION_EVIDENCE_ROOT;
  if (evidenceRoot) mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(path.join(evidenceRoot ?? tmpdir(), `termination-${name}-`));
  if (!evidenceRoot) t.after(() => rmSync(directory, { recursive: true, force: true }));
  const timeoutMs = options.timeoutMs ?? 4000, caller = new AbortController();
  const realSetTimeout = globalThis.setTimeout;
  let fireDeadline, catalogCalls = 0, inferenceCalls = 0, sharedSignal, response, failure;
  const cleanup = [];
  // Capture the adapter's actual first deadline callback only for deterministic
  // same-turn race ordering. The normal timer remains installed and is cleared
  // by the adapter; no transport/process implementation is substituted.
  if (options.injectDeadlineAfterAbort) t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    if (!fireDeadline && ms === timeoutMs) fireDeadline = callback;
    return realSetTimeout(callback, ms, ...args);
  });
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    if (String(url) === 'https://models.opencode.ai/api.json') {
      catalogCalls++; return new Response(catalog, { status: 200 });
    }
    assert.equal(String(url), 'https://opencode.ai/zen/v1/chat/completions', 'no unrecognized network destination');
    assert.equal(++inferenceCalls, 1, 'no forwarded retry');
    assert.equal(request.headers['user-agent'], 'opencode/latest/2.0.5/cli');
    assert.equal(request.headers['x-opencode-client'], 'cli');
    const wire = JSON.parse(request.body);
    assert.equal(wire.model, 'big-pickle'); assert.equal(wire.max_tokens, 512);
    assert.deepEqual(wire.tools, []); assert.equal(wire.tool_choice, 'none');
    sharedSignal = request.signal;
    const status = options.status ?? 200;
    const headers = { 'content-type': status === 200 ? 'text/event-stream' : 'application/json',
      ...(status === 429 ? { 'retry-after': '600' } : {}) };
    if (options.complete) return new Response(complete, { status, headers });
    if (options.httpComplete) return new Response('{"error":"SUPPLIED refusal"}', { status, headers });
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(Buffer.from(partial));
      const aborted = () => {
        if (options.callerAfterSharedAbort) caller.abort();
        if (options.injectDeadlineAfterAbort) { assert.equal(typeof fireDeadline, 'function'); fireDeadline(); }
        controller.error(request.signal.reason);
      };
      request.signal.addEventListener('abort', aborted, { once: true });
      cleanup.push(() => request.signal.removeEventListener('abort', aborted));
      if (options.trigger) {
        const timer = realSetTimeout(() => {
          if (options.trigger === 'caller') caller.abort();
          else controller.error(new TypeError('SUPPLIED network read failed', { cause: Object.assign(new Error('SUPPLIED reset'), { code: 'ECONNRESET' }) }));
        }, 30);
        cleanup.push(() => clearTimeout(timer));
      }
    } });
    return new Response(body, { status, headers });
  });
  t.after(() => cleanup.forEach(fn => fn()));
  try {
    response = await new OpenCodeV2FreeProvider({ timeoutMs, maxOutputTokens: 512 }).generate({ prompt, directory, signal: caller.signal });
  } catch (error) { failure = error; }
  const receipts = response?.evidence.receipts ?? failure?.receipts;
  assert.ok(receipts, failure?.stack);
  const load = name => JSON.parse(readFileSync(path.join(receipts, name), 'utf8'));
  const termination = load('termination.json'), transport = load('transport.json');
  const observation = { name, expectedCode: options.expectedCode ?? null, code: failure?.code ?? null,
    receipts, catalogCalls, inferenceCalls, externalNetworkCalls: 0, modelCalls: 0, termination, transport };
  writeFileSync(path.join(directory, 'OBSERVATION.json'), JSON.stringify(observation, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  assert.equal(catalogCalls, 1); assert.equal(inferenceCalls, 1);
  assert.equal(transport.forwarded, 1); assert.equal(transport.attempts, 1);
  if (options.expectedCode) {
    assert.equal(failure?.code, options.expectedCode, failure?.stack ?? 'Unexpected response');
    assert.equal(termination.first.code, options.expectedCode);
    assert.equal(termination.first.kind, options.expectedKind);
    assert.equal(load('failure.json').code, options.expectedCode);
    assert.deepEqual(load('failure.json').termination, termination.first);
    assert.equal(transport.completed, 0);
    assert.equal(sharedSignal.aborted, true);
    assert.ok(termination.first.at <= termination.abortAt);
    if (!options.httpComplete) {
      const saved = readFileSync(path.join(receipts, 'wire-response.txt'));
      assert.equal(saved.toString('utf8'), partial);
      assert.equal(transport.requests[0].responsePartial, true);
      assert.equal(transport.requests[0].responseSHA256, sha(saved));
      assert.equal(transport.requests[0].responseBytes, saved.length);
    }
  } else {
    if (failure) throw failure;
    assert.deepEqual(JSON.parse(response.text), { ok: true });
    assert.equal(response.evidence.reportedCost, 0);
    assert.equal(transport.completed, 1);
    assert.equal(termination.first, null); assert.equal(termination.abortAt, null);
    assert.ok(existsSync(path.join(receipts, 'state/session-export.json')));
  }
  return observation;
}

const opts = { skip: !supported, timeout: 20000 };
test('actual adapter: hanging HTTP200 SSE reaches its own TIMEOUT and retains secondary AbortError', opts, async t => {
  const result = await exercise(t, 'deadline', { expectedCode: 'TIMEOUT', expectedKind: 'deadline' });
  assert.equal(result.transport.requests[0].statusCode, 200);
  assert.equal(result.termination.callerAborted, false);
  assert.ok(result.termination.first.at >= result.termination.deadlineAt);
  assert.ok(result.termination.secondary.some(x => x.kind === 'abort-observation' && x.error.name === 'AbortError' && x.error.code === 20));
});

test('actual adapter: caller cancellation stays CANCELLED after body AbortError', opts, async t => {
  const result = await exercise(t, 'caller', { trigger: 'caller', expectedCode: 'CANCELLED', expectedKind: 'caller' });
  assert.equal(result.termination.callerAborted, true);
  assert.ok(result.termination.first.at < result.termination.deadlineAt);
  assert.ok(result.termination.secondary.some(x => x.error.name === 'AbortError'));
});

test('actual adapter: an earlier network read failure retains its cause and partial bytes', opts, async t => {
  const result = await exercise(t, 'network', { trigger: 'network', expectedCode: 'MODEL_TRANSPORT', expectedKind: 'transport' });
  assert.equal(result.termination.first.error.name, 'TypeError');
  assert.equal(result.termination.first.error.cause.code, 'ECONNRESET');
  assert.equal(result.transport.requests[0].error.cause.code, 'ECONNRESET');
});

for (const [status, code] of [[429, 'MODEL_RATE_LIMIT'], [403, 'MODEL_AUTH_REQUIRED']]) {
  test(`actual adapter: HTTP${status} remains classified without retry`, opts, async t => {
    const result = await exercise(t, `http-${status}`, { status, httpComplete: true, expectedCode: code, expectedKind: 'http' });
    assert.equal(result.transport.requests[0].statusCode, status);
  });
}

test('actual adapter: known HTTP429 precedes a deadline while its body is unfinished', opts, async t => {
  const result = await exercise(t, 'http-before-deadline', { status: 429, expectedCode: 'MODEL_RATE_LIMIT', expectedKind: 'http' });
  assert.ok(result.termination.secondary.some(x => x.kind === 'deadline' && x.code === 'TIMEOUT'));
  assert.ok(result.termination.secondary.some(x => x.error.name === 'AbortError'));
});

test('actual adapter: a caller abort after the deadline cause cannot relabel TIMEOUT', opts, async t => {
  const result = await exercise(t, 'deadline-before-caller', { callerAfterSharedAbort: true, expectedCode: 'TIMEOUT', expectedKind: 'deadline' });
  assert.equal(result.termination.callerAborted, true);
  assert.ok(result.termination.secondary.some(x => x.kind === 'caller' && x.code === 'CANCELLED'));
});

for (const [trigger, code, kind] of [['network', 'MODEL_TRANSPORT', 'transport'], ['caller', 'CANCELLED', 'caller']]) {
  test(`actual adapter: injected later deadline cannot replace first ${kind} cause`, opts, async t => {
    const result = await exercise(t, `${kind}-before-injected-deadline`, { trigger, injectDeadlineAfterAbort: true, expectedCode: code, expectedKind: kind });
    assert.ok(result.termination.secondary.some(x => x.kind === 'deadline' && x.code === 'TIMEOUT'));
  });
}

test('actual adapter: complete supplied response still requires native successful export and zero cost', opts, async t => {
  await exercise(t, 'completed', { complete: true });
});
