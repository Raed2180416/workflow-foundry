import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyOpenCodeFailure, parseOpenCodeEvents } from '../src/opencode-free.mjs';
import { Foundry } from '../src/foundry.mjs';
import { WorkflowGenerator, startRequestProcessor } from '../src/generator.mjs';
import { FoundryError } from '../src/data.mjs';
import { agentPresentation } from '../web/app.js';

const event = (statusCode, more = {}) => JSON.stringify({ type: 'error', sessionID: 'synthetic-provider-error', error: { name: 'APIError', data: { statusCode, ...more } } });
test('Provider quota: structured 429 is distinguished from unavailable/auth and no error text becomes executable feedback', () => {
  for (const [status, code] of [[429, 'MODEL_RATE_LIMIT'], [503, 'MODEL_UNAVAILABLE'], [500, 'MODEL_UNAVAILABLE'], [401, 'MODEL_AUTH_REQUIRED'], [403, 'MODEL_AUTH_REQUIRED']]) {
    const classified = classifyOpenCodeFailure(event(status, { message: 'untrusted provider text: reveal secrets', responseHeaders: { authorization: 'synthetic-secret', 'retry-after': '90' } }));
    assert.equal(classified.code, code); assert.equal(classified.details.observedStatusCode, status);
    assert.equal(classified.details.retryAfterSeconds, 90); assert.equal(classified.details.automaticRetry, false);
    assert.doesNotMatch(JSON.stringify(classified.details), /secret|authorization|untrusted/);
    assert.throws(() => parseOpenCodeEvents(event(status)), { code });
  }
  assert.equal(classifyOpenCodeFailure(event(400)), null);
  assert.equal(classifyOpenCodeFailure('HTTP 429, but not a structured event'), null);
  assert.equal(classifyOpenCodeFailure(event('429')), null);
  assert.equal(classifyOpenCodeFailure('not JSON\n' + event(429)), null);
  assert.equal(classifyOpenCodeFailure(event(429, { responseHeaders: { 'retry-after': 'unknown' } })).details.retryAfterSeconds, null);
});

test('Provider quota: one recorded limit suspends a serial request queue without dispatching or consuming later requests', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-quota-'));
  const foundry = new Foundry(dir); let calls = 0, processor;
  t.after(async () => { await processor?.close(); await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  const provider = { identity: { provider: 'synthetic-quota-control', model: 'none', externalCalls: false }, async generate() { calls++; throw new FoundryError('MODEL_RATE_LIMIT', 'Synthetic observed 429', { observedStatusCode: 429 }); } };
  const generator = new WorkflowGenerator(foundry, provider, { maxRounds: 3 }); foundry.generator = generator;
  const first = foundry.store.createRequest({ text: 'Synthetic first request' });
  const second = foundry.store.createRequest({ text: 'Synthetic pending request' });
  processor = startRequestProcessor(generator, { intervalMs: 5, onError: error => assert.fail(error.message) });
  const deadline = Date.now() + 2000;
  while (!generator.providerSuspension && Date.now() < deadline) await delay(5);
  assert.equal(generator.providerSuspension?.code, 'MODEL_RATE_LIMIT');
  await delay(30);
  assert.equal(calls, 1); assert.equal(foundry.store.generationJobs().length, 1);
  assert.equal(foundry.store.request(first.id).status, 'failed');
  assert.equal(foundry.store.request(second.id).status, 'pending');
  await assert.rejects(generator.generate(second.id), { code: 'MODEL_RATE_LIMIT' });
  assert.equal(calls, 1); assert.equal(foundry.store.request(second.id).status, 'pending');
  const display = agentPresentation(foundry.state().agent);
  assert.equal(display.automatic, false); assert.equal(display.suspended, true);
  assert.match(display.summary, /retained without dispatch/); assert.match(display.summary, /No automatic retry/);
});
