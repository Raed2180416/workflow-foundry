import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { OpenCodeV2FreeProvider } from '/home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs';
const base = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(base, `offline-provider-check-${randomUUID()}`);
mkdirSync(root, { mode: 0o700 });
const catalog = readFileSync(path.join(base, 'remote-catalog.json'));
const sse = readFileSync(path.join(base, 'offline-replay-952eeb90-b2ba-4e69-81b1-3dd281e1aaed/SUPPLIED-provider-response.sse'));
const nativeFetch = globalThis.fetch;
const outcomes = [];
try {
  for (const [name, status, expectedCode] of [['success', 200, null], ['rate-limit', 429, 'MODEL_RATE_LIMIT'], ['auth-refusal', 403, 'MODEL_AUTH_REQUIRED']]) {
    let inferenceFetches = 0, catalogFetches = 0;
    globalThis.fetch = async (url, options) => {
      if (url === 'https://models.opencode.ai/api.json') { catalogFetches++; return new Response(catalog, { status: 200 }); }
      assert.equal(url, 'https://opencode.ai/zen/v1/chat/completions');
      inferenceFetches++;
      assert.equal(inferenceFetches, 1);
      assert.equal(options.headers['user-agent'], 'opencode/latest/2.0.5/cli');
      assert.equal(options.headers['x-opencode-client'], 'cli');
      const content = status === 200 ? sse : JSON.stringify({ error: { type: name, message: 'SUPPLIED offline transport fixture' } });
      return new Response(content, { status, headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json', ...(status === 429 ? { 'retry-after': '600' } : {}) } });
    };
    const provider = new OpenCodeV2FreeProvider({ timeoutMs: 15000, maxOutputTokens: 512 });
    let response, failure;
    try { response = await provider.generate({ prompt: 'Return exactly this JSON object and nothing else: {"ok":true}', directory: path.join(root, name) }); }
    catch (error) { failure = error; }
    if (expectedCode) assert.equal(failure?.code, expectedCode);
    else { if (failure) throw failure; assert.deepEqual(JSON.parse(response.text), { ok: true }); }
    assert.equal(catalogFetches, 1); assert.equal(inferenceFetches, 1);
    const receipts = response?.evidence.receipts ?? failure.receipts;
    const transport = JSON.parse(readFileSync(path.join(receipts, 'transport.json')));
    assert.equal(transport.forwarded, 1); assert.equal(transport.attempts, 1);
    outcomes.push({ name, status: 'PASS', expectedCode, receipts, transport, interceptedCatalogFetches: catalogFetches, interceptedInferenceFetches: inferenceFetches, externalNetworkCalls: 0 });
  }
} finally { globalThis.fetch = nativeFetch; }
const result = { status: 'PASS', kind: 'SUPPLIED transport responses; full production adapter and actual v2 CLI/server; no external network or inference', root, outcomes };
writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
