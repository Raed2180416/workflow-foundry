// A1-C with roles mapped to an executor model (research/mercury-20261021/): per-node dispatch, the task's token pool, every
// call counted toward the 50 responses, tokens by model in the records and the summary. $0: a loopback endpoint and stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VENV_PY } from '../lib.mjs';
import { DEFAULT_CALL_TOKENS, meteredTokens, pipelineDispatch, runTasks } from '../run.mjs';
import { auditSession, readStream } from '../accounting.mjs';
import { nodeTokens } from '../harness/codeowned.mjs';
import { stubNodeRunner, stubSessionRunner } from '../harness/codeowned-stubs.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-cr-${p}-`));
const HAVE_VENV = existsSync(VENV_PY);
const KEY = 'test-only-key-not-a-secret-41aa';

async function fakeEndpoint(t, reply) {
  const requests = [];
  const server = http.createServer((q, s) => {
    let b = ''; q.on('data', d => { b += d; });
    q.on('end', () => {
      requests.push(JSON.parse(b));
      s.writeHead(200, { 'content-type': 'application/json' });
      s.end(JSON.stringify({ id: 'x', model: 'mercury-3', choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 100 } }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

test('pipelineDispatch: remote model nodes are one request on their own call budget; claude nodes are untouched; the pool refuses without a request', { skip: !sandboxAvailable() && 'no user namespaces' }, async t => {
  const { policy } = loadPolicy();
  const ep = await fakeEndpoint(t, '```json\n{"requirements": []}\n```');
  const claudeCalls = [];
  const claude = async args => { claudeCalls.push(args); return { ok: true, costUsd: 0.001, streamUsage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 } }; };
  const d = pipelineDispatch({ policy, taskTokens: 2500, callTokens: 1500, claude, remoteArgs: { baseUrl: ep.baseUrl, hostEnv: { ...process.env, INCEPTION_API_KEY: KEY } } });
  const root = tmp('disp'); t.after(() => rmSync(root, { recursive: true, force: true }));
  const node = name => { const w = path.join(root, name); mkdirSync(w); return { prompt: 'Read the request.', systemPrompt: 'Return JSON.', workdir: w, files: {}, budgetUsd: 0.05, timeoutMs: 30_000, tools: [], task: { name: 'ledger', fork: 0 }, maxTurns: 1, binary: '/x/claude-guard' }; };
  const a = await d.run({ ...node('a'), model: 'mercury-3' });
  assert.equal(a.ok, true, JSON.stringify(a.error)); assert.equal(a.turns, 1); assert.equal(a.result, '```json\n{"requirements": []}\n```');
  assert.equal(a.tokens.budget, 1500, 'a model node gets min(callTokens, what the pool has left)');
  assert.equal(ep.requests.length, 1); assert.ok(!('tools' in ep.requests[0]), 'a model node offers no tools');
  // Counted like a claude node: one response in its transcript, served by the model it named.
  const audit = auditSession({ events: readStream(a.transcript), calls: [], maxSteps: 50, expectModel: 'mercury-3' });
  assert.equal(audit.modelResponses, 1); assert.deepEqual(audit.violations, []);
  // 1000 spent of 2500: the next node gets 1500, then 500 is left, too little for its prompt (stopped before a request), then nothing.
  const b = await d.run({ ...node('b'), model: 'mercury-3' });
  assert.equal(b.ok, true); assert.equal(d.pool.spent, 2000);
  const c = await d.run({ ...node('c'), model: 'mercury-3', prompt: 'Read the request. '.repeat(200) });
  assert.equal(c.error.code, 'EXECUTOR_BUDGET'); assert.equal(ep.requests.length, 2, 'stopped by its token budget before any request');
  d.pool.spent = 2500;
  const e = await d.run({ ...node('e'), model: 'mercury-3' });
  assert.equal(e.error.code, 'EXECUTOR_BUDGET'); assert.equal(d.pool.refused, 1); assert.equal(e.tokens.total, 0);
  // A claude-cli model goes to runClaudeCode's stand-in with its arguments unchanged (no token budget added).
  const h = await d.run({ ...node('h'), model: 'claude-haiku-5-5' });
  assert.equal(h.ok, true); assert.equal(claudeCalls.length, 1); assert.equal('tokenBudget' in claudeCalls[0], false); assert.equal(claudeCalls[0].binary, '/x/claude-guard');
  assert.equal(DEFAULT_CALL_TOKENS, 100_000);
});

test('nodeTokens and meteredTokens: remote tokens as reported, claude tokens from stream usage; the meter books only remote models when any is named', () => {
  assert.deepEqual(nodeTokens({ tokens: { input: 900, output: 100, cachedInput: 0, reasoning: 0, total: 1000 } }), { input: 900, output: 100, cachedInput: 0, total: 1000 });
  assert.deepEqual(nodeTokens({ streamUsage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 2 } }), { input: 112, output: 5, cachedInput: 100, total: 117 });
  const t = { total: 5000, byModel: { 'mercury-3': { total: 3000 }, 'claude-haiku-5-5': { total: 2000 } } };
  assert.equal(meteredTokens(t, new Set(['mercury-3'])), 3000);
  assert.equal(meteredTokens(t, new Set()), 5000);
  assert.equal(meteredTokens({ total: 7 }, new Set(['mercury-3'])), 7, 'a single-session remote run has no per-model split');
  assert.equal(meteredTokens(null, new Set()), null);
});

const PHONE_TASK = 'simple.email_sf_contact_phone_update';
test('end to end (A1-C, scripted): ledger and checker roles on mercury-3, act on haiku; every call counted; tokens by model in the record and the summary', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 600_000 }, async () => {
  const live = tmp('e2e');
  const seen = [];
  const node = stubNodeRunner({ seen });
  const nodeRunner = async args => ({ ...(await node(args)), ...(args.model === 'mercury-3' ? { tokens: { input: 900, output: 100, cachedInput: 0, reasoning: 0, total: 1000, budget: 100000, usageMissing: false } } : {}) });
  const session = stubSessionRunner();
  const runner = async args => ({ ...(await session(args)), streamUsage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 400, cacheWriteTokens: 0 } });
  const { summary, results } = await runTasks({ tasks: [PHONE_TASK], domains: ['simple'], harness: 'codeowned', det: 'record', liveRoot: live, outDir: null, log: () => {},
    model: 'claude-haiku-5-5', nodeModels: { ledger: 'mercury-3', checker: 'mercury-3' }, runner, nodeRunner });
  const f = results[0].forks[0];
  assert.deepEqual([...new Set(seen.filter(s => s.node === 'ledger').map(s => s.model))], ['mercury-3']);
  assert.equal(f.session.modelResponses >= 4, true); assert.deepEqual(f.session.violations, []);
  assert.deepEqual(f.session.models.sort(), ['claude-haiku-5-5', 'mercury-3'], 'each node audited against the model its role names');
  assert.equal(f.tokens.byModel['mercury-3'].total, 3000, 'three ledger readers'); assert.equal(f.tokens.byModel['mercury-3'].nodes, 3);
  assert.equal(f.tokens.byModel['claude-haiku-5-5'].total, 470); assert.equal(f.tokens.total, 3470);
  assert.deepEqual(summary.tokens.byModel, { 'mercury-3': { input: 2700, output: 300, cachedInput: 0, total: 3000 }, 'claude-haiku-5-5': { input: 450, output: 20, cachedInput: 400, total: 470 } });
  assert.ok(f.pipeline.nodes.filter(n => n.model === 'mercury-3').every(n => n.tokens === 1000));
});
