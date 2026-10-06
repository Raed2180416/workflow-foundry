import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { OpenCodeV2FreeProvider } from '/home/raed/Projects/workflow-foundry/src/opencode-v2-free.mjs';

// One additive authorization, 2026-09-17T03:24:53Z. The directory itself is the
// one-use ledger: even an interrupted/failed invocation cannot run this twice.
const base = path.dirname(fileURLToPath(import.meta.url));
const repo = '/home/raed/Projects/workflow-foundry';
const root = path.join(base, 'native-header-recheck-001');
const prior = path.join(base, 'tiny-probe-dee7958b-8b95-4dc7-9686-63a7c45ba3d0/opencode-v2-1c89f0f5-dc66-4e69-bf68-afa2f124565e');
const upstream = path.join(base, 'upstream/packages/core/src/session/model-request.ts');
const sha = value => createHash('sha256').update(value).digest('hex');
const current = readFileSync(path.join(repo, 'src/opencode-v2-free.mjs'));
assert.equal(sha(current), 'a4ba3a46724ead16d7a9b57304183f22fec0fffdc2315d44568df983e1e2fdda');
assert.equal(sha(readFileSync(upstream)), 'a9642ef93635e6af641f7adda23db34faff20945469573c4a1ca7d2f48fec81d');
const oldTransport = JSON.parse(readFileSync(path.join(prior, 'transport.json')));
assert.equal(oldTransport.forwarded, 1);
assert.equal(oldTransport.requests[0].statusCode, 403);
let priorPublicCalls = 0;
for (const name of readdirSync(base).filter(name => name.startsWith('tiny-probe-'))) {
  for (const child of readdirSync(path.join(base, name)).filter(name => name.startsWith('opencode-v2-'))) {
    priorPublicCalls += JSON.parse(readFileSync(path.join(base, name, child, 'transport.json'))).forwarded;
  }
}
assert.equal(priorPublicCalls, 1);
mkdirSync(root, { mode: 0o700 });
const save = (name, data) => writeFileSync(path.join(root, name), typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o400, flag: 'wx' });
const sources = [
  ['before-adapter.mjs', path.join(prior, 'task/runtime/opencode-v2-free.mjs')],
  ['after-adapter.mjs', path.join(repo, 'src/opencode-v2-free.mjs')],
  ['after-tests.mjs', path.join(repo, 'tests/opencode-v2-free.test.mjs')],
  ['native-model-request.ts', upstream],
  ['native-model-request.receipt.json', `${upstream}.receipt.json`],
  ['before-transport.json', path.join(prior, 'transport.json')],
  ['before-wire-request.json', path.join(prior, 'wire-request.json')],
  ['before-wire-response.txt', path.join(prior, 'wire-response.txt')],
  ['previous-NOTE.md', path.join(base, 'NOTE.md')],
  ['previous-AUDIT.json', path.join(base, 'AUDIT.json')],
  ['runner.mjs', fileURLToPath(import.meta.url)],
];
const preserved = sources.map(([name, source]) => { const bytes = readFileSync(source); save(name, bytes); return { name, source, sha256: sha(bytes), bytes: bytes.length }; });
const prompt = 'Return exactly this JSON object and nothing else: {"ok":true}';
save('AUTHORIZATION.json', {
  authorizedAt: '2026-09-17T03:24:53Z', reservedAt: new Date().toISOString(),
  callsAuthorized: 1, callsPreviouslyForwarded: priorPublicCalls, prompt, promptSHA256: sha(prompt),
  permittedChange: 'Preserve only the six originally emitted native headers through the existing bridge; patch already present and tested offline.',
  noFurtherRetry: true, noTaskSynthesis: true, noFallback: true,
  provider: 'opencode/big-pickle', timeoutMs: 90000, maxOutputTokens: 512,
});
save('PROVENANCE.json', {
  preserved, nativeSourceRevision: '79169fe966d58fb0e0a5e41133716184a0ab4ca6', nativeSourceLines: [232, 244],
  headers: ['user-agent', 'x-opencode-project', 'x-opencode-session', 'x-opencode-client', 'x-session-id', 'x-session-affinity'],
  provenance: 'Pinned source declares these headers; actual installed CLI emits them into the private bridge. nativeV2Headers copies the received values at both bridge hops; it generates none of their values.',
  beforeWireHeaderCapture: 'Unavailable: the original relay discarded native headers and did not record them. Before-adapter source and refusal are preserved; no historical header values are invented.',
  afterWireHeaderCapture: 'The adapter saves the actual received allowlisted values in wire-native-headers.json before the only forward.',
  binarySourceLimit: 'Installed binary hash is pinned separately; this is not a reproducible source-to-binary attestation.',
});
let result;
try {
  const response = await new OpenCodeV2FreeProvider({ model: 'opencode/big-pickle', timeoutMs: 90000, maxOutputTokens: 512 }).generate({ prompt, directory: root });
  assert.deepEqual(JSON.parse(response.text), { ok: true });
  result = { status: 'PASS_TINY_NATIVE_CALL', text: response.text, evidence: response.evidence, receipts: response.evidence.receipts };
} catch (error) {
  result = { status: 'HOLD', code: error.code ?? 'TINY_RESPONSE_MISMATCH', message: error.message, receipts: error.receipts ?? null };
  process.exitCode = 1;
}
const attemptRoots = readdirSync(root).filter(name => name.startsWith('opencode-v2-'));
const transports = attemptRoots.map(name => ({ path: `${name}/transport.json`, data: JSON.parse(readFileSync(path.join(root, name, 'transport.json'))) }));
const forwarded = transports.reduce((sum, entry) => sum + entry.data.forwarded, 0);
assert.ok(forwarded <= 1);
result.accounting = { previousPublicInferenceHTTPRequests: priorPublicCalls, newlyForwarded: forwarded, totalPublicInferenceHTTPRequests: priorPublicCalls + forwarded, furtherCallsAuthorized: 0, transports };
result.sourceUnchangedDuringProbe = sha(readFileSync(path.join(repo, 'src/opencode-v2-free.mjs'))) === sha(current);
result.completedAt = new Date().toISOString();
save('RESULT.json', result);
console.log(JSON.stringify({ status: result.status, code: result.code, root, receipts: result.receipts, newlyForwarded: forwarded, totalPublicInferenceHTTPRequests: priorPublicCalls + forwarded, sourceUnchangedDuringProbe: result.sourceUnchangedDuringProbe }));
