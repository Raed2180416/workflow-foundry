import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseOpenCodeV2Events, validateOpenCodeV2Export, OpenCodeV2FreeProvider } from '/home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(base, 'native-header-review-001');
const live = path.join(base, 'native-header-recheck-001/opencode-v2-4f4c8d87-5755-426b-91db-c6d78cb166d1');
mkdirSync(root, { mode: 0o700 });
const sha = value => createHash('sha256').update(value).digest('hex');
const save = (name, data) => writeFileSync(path.join(root, name), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o400, flag: 'wx' });
const prompt = readFileSync(path.join(live, 'task/prompt.txt'), 'utf8');
const generation = JSON.parse(readFileSync(path.join(live, 'state/generation.json')));
const session = JSON.parse(JSON.parse(readFileSync(path.join(live, 'state/session-export.json'))).stdout);
const source = readFileSync('/home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs');
save('adapter.mjs', source);
save('tests.mjs', readFileSync('/home/raed/Projects/workflow-foundry/tests/opencode-v2-free.test.mjs'));
const parsed = parseOpenCodeV2Events(generation.stdout, { allowProjection: true });
const verified = validateOpenCodeV2Export(session, parsed, prompt);
assert.equal(generation.code, 0);
assert.deepEqual(JSON.parse(verified.text), { ok: true });
save('SAVED-LIVE-REVALIDATION.json', {
  status: 'PASS_SAVED_LIVE_COMPLETION', receipt: path.relative(base, live), verified,
  originalInvocationStatus: 'Preserved HOLD/PROCESS_FAILED: old adapter required a finish event missing from the native event projection.',
  sourceSHA256: sha(source), streamedEvents: parsed.events.map(event => event.type),
  completionWitness: 'Actual native session export: exact prompt/model/text/tokens, finish stop, zero cost and terminal succeeded.',
  nativeSource: { file: 'upstream/packages/cli/src/run/noninteractive.ts', lines: [[224, 247], [526, 552], [719, 743]] },
  newModelCalls: 0,
});
const catalog = readFileSync(path.join(live, 'task/catalog.json'));
const sse = readFileSync(path.join(live, 'wire-response.txt'));
const originalFetch = globalThis.fetch;
const intercepted = { catalog: 0, inference: 0, blocked: 0 };
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://models.opencode.ai/api.json') {
    intercepted.catalog++; return new Response(catalog, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url) === 'https://opencode.ai/zen/v1/chat/completions') {
    assert.equal(++intercepted.inference, 1);
    assert.equal(JSON.parse(options.body).model, 'big-pickle');
    assert.equal(options.headers['user-agent'], 'opencode/latest/2.0.5/cli');
    assert.equal(options.headers['x-opencode-client'], 'cli');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  intercepted.blocked++; throw new Error('Offline replay forbids all other fetches');
};
try {
  const result = await new OpenCodeV2FreeProvider({ timeoutMs: 90000, maxOutputTokens: 512 }).generate({ prompt, directory: root });
  assert.deepEqual(JSON.parse(result.text), { ok: true });
  assert.equal(intercepted.inference, 1);
  assert.equal(sha(readFileSync('/home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs')), sha(source));
  save('RESULT.json', { status: 'PASS_FULL_ADAPTER_OFFLINE_NATIVE_REPLAY', intercepted, externalNetworkCalls: 0,
    newModelCalls: 0, sourceSHA256: sha(source), response: result,
    scope: 'Actual installed CLI/server + final production adapter with recorded live SSE supplied locally. Original live process failure stays unchanged.' });
  console.log(JSON.stringify({ status: 'PASS', root, savedLiveTokens: verified.tokens, savedLiveCost: verified.reportedCost, externalNetworkCalls: 0, newModelCalls: 0 }));
} finally { globalThis.fetch = originalFetch; }
