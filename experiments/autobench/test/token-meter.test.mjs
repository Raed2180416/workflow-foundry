// The token meter (research/mercury-20261021/): a model listed at $0 never meets the dollar ledger, so a run books tokens too.
// $0: scripted sessions only (no model).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VENV_PY, readJson, scriptedRunner } from '../lib.mjs';
import { DEFAULT_SESSION_TOKENS, makeTokenMeter, remoteSessionExecutor, runTasks, tokensOf } from '../run.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { runOpenAIChat } from '../../../src/executors/openai-chat.mjs';

const tmp = p => mkdtempSync(path.join(os.tmpdir(), `autobench-${p}-`));
const HAVE_VENV = existsSync(VENV_PY);

test('makeTokenMeter: a session starts only if spent + reserved + its budget fits; it settles at what it reported, or at its budget', async () => {
  const m = makeTokenMeter(1000);
  assert.equal(m.tryReserve(400), true); assert.equal(m.tryReserve(400), true); assert.equal(m.tryReserve(400), false, '800 reserved + 400 > 1000');
  m.settle(400, 100);
  assert.deepEqual([m.spent, m.reserved], [100, 400]);
  assert.equal(m.tryReserve(400), true, '100 + 400 + 400 <= 1000');
  m.settle(400, null);
  assert.deepEqual([m.spent, m.reserved, m.unknown], [500, 400, 1], 'an unreported session is booked at its budget');
  m.settle(400, 0);
  assert.equal(await m.reserve(600), false, 'nothing in flight and 500 + 600 > 1000: refused, not waited on');
  assert.equal(await m.reserve(500), true);
  assert.equal(DEFAULT_SESSION_TOKENS, 400_000);
});

test('tokensOf: the remote executor\'s token report, or the claude executor\'s stream usage with cache reads and writes as input', () => {
  assert.deepEqual(tokensOf({ tokens: { input: 900, output: 100, cachedInput: 600, reasoning: 40, total: 1000, budget: 400000, usageMissing: false } }), { input: 900, output: 100, cachedInput: 600, total: 1000 });
  assert.deepEqual(tokensOf({ tokens: { input: 5, output: 1, cachedInput: 0, total: 6, usageMissing: true } }), { input: 5, output: 1, cachedInput: 0, total: 6, usageMissing: true });
  assert.deepEqual(tokensOf({ streamUsage: { inputTokens: 10, outputTokens: 7, cacheReadTokens: 100, cacheWriteTokens: 20 } }), { input: 130, output: 7, cachedInput: 100, total: 137 });
  assert.equal(tokensOf({ costUsd: 0 }), null); assert.equal(tokensOf(null), null);
});

test('the Mercury hook: an executorModels model selects the remote executor, needs --token-cap, and is refused by pipeline arms', async () => {
  const { policy } = loadPolicy();
  const remote = remoteSessionExecutor(policy, 'mercury-3');
  assert.equal(remote.kind, 'openai-chat'); assert.equal(remote.run, runOpenAIChat); assert.equal(remote.manifestPolicy.provider.kind, 'openai-chat-https');
  assert.equal(remoteSessionExecutor(policy, 'claude-haiku-5-5'), null, 'claude-cli models keep runClaudeCode');
  assert.throws(() => remoteSessionExecutor(policy, 'mercury-3', { pipeline: true }), /not wired into the pipeline arms/);
  assert.throws(() => remoteSessionExecutor(policy, 'gpt-4o'), /not listed in the model policy/);
  const live = tmp('tokcap-required');
  await assert.rejects(runTasks({ model: 'mercury-3', tasks: ['simple.x'], capUsd: 1, liveRoot: live, outDir: null, log: () => {} }), /--token-cap .* is required for mercury-3/);
  await assert.rejects(runTasks({ model: 'mercury-3', tasks: ['simple.x'], capUsd: 1, liveRoot: live, outDir: null, log: () => {}, harness: 'codeowned' }), /pipeline arms|not listed|claude-cli/);
});

const PHONE_TASK = 'simple.email_sf_contact_phone_update';
const read = () => ({ name: 'api_search', arguments: JSON.stringify({ query: 'salesforce contact' }) });
test('end to end: the token cap stops a run like the dollar cap (no headline, exit kind cap); a resume may raise it; every fork records its tokens', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 300_000 }, async () => {
  const live = tmp('tokcap');
  const TASKS = [PHONE_TASK, 'simple.email_sf_contact_email_update', 'simple.slack_office_closure'];
  const inner = scriptedRunner(() => [{ calls: [read()] }]);
  const calls = [];
  const metered = async args => { calls.push(args.task.name); return { ...(await inner(args)), costUsd: 0, tokens: { input: 250, output: 50, cachedInput: 100, reasoning: 0, total: 300, usageMissing: false } }; };
  const base = { tasks: TASKS, domains: ['simple'], det: 'record', concurrency: 1, liveRoot: live, outDir: path.join(live, 'out'), sessionTokens: 300, log: () => {}, runner: metered };
  const first = await runTasks({ ...base, tokenCap: 700 });
  assert.match(first.stopped, /^the token cap \(token cap: spent 600 \+ reserved 0 \+ 300 > 700\)/);
  assert.equal(first.stopKind, 'cap'); assert.equal(first.summary.spentTokens, 600);
  assert.deepEqual(calls, TASKS.slice(0, 2), 'the third session never started');
  assert.deepEqual(first.results.map(r => r.forks[0].tokens), [{ input: 250, output: 50, cachedInput: 100, total: 300 }, { input: 250, output: 50, cachedInput: 100, total: 300 }]);
  assert.deepEqual(readJson(path.join(live, 'launch.json')).tokenCap, 700);
  await assert.rejects(runTasks({ ...base, tokenCap: 600, resume: true }), /the token cap can only be raised/);
  calls.length = 0;
  const second = await runTasks({ ...base, tokenCap: 2000, resume: true });
  assert.equal(second.stopped, undefined); assert.deepEqual(calls, [TASKS[2]]);
  const t = second.summary.tokens;
  assert.deepEqual({ total: t.total, input: t.input, output: t.output, cachedInput: t.cachedInput, sessions: t.sessions, cap: t.cap, meterSpent: t.meterSpent }, { total: 900, input: 750, output: 150, cachedInput: 300, sessions: 3, cap: 2000, meterSpent: 900 });
  assert.equal(t.meanPerTask, 300);
  assert.deepEqual(readJson(path.join(live, 'launch.json')).history.at(-1).tokenCap, [700, 2000]);
  assert.equal(JSON.parse(readFileSync(path.join(live, 'out', 'summary.json'), 'utf8')).tokens.total, 900);
  // Without --token-cap a scripted run books nothing, but forks still record what sessions report.
  const plain = await runTasks({ ...base, tasks: [PHONE_TASK], liveRoot: tmp('tokplain'), outDir: null });
  assert.equal(plain.summary.tokens.total, 300); assert.equal(plain.summary.tokens.cap, null); assert.equal(plain.summary.tokens.meterSpent, null);
});

test('a rerun after an environment fault audits its own transcript: the faulted session\'s copy is kept beside it, not reused', { skip: !HAVE_VENV && 'AutomationBench venv missing', timeout: 300_000 }, async () => {
  const { writeFileSync, readdirSync } = await import('node:fs');
  const live = tmp('stale');
  const inner = scriptedRunner(() => [{ calls: [read()] }]);
  const session = (id, fault) => async args => {
    const r = await inner(args);
    writeFileSync(path.join(args.workdir, '.executor-transcript.jsonl'), JSON.stringify({ type: 'assistant', message: { id, model: 'stand-in', content: [{ type: 'text', text: id }] } }) + '\n');
    return { ...r, costUsd: 0, ...(fault ? { error: { code: 'MODEL_RATE_LIMIT' } } : {}) };
  };
  const base = { tasks: [PHONE_TASK], domains: ['simple'], det: 'record', concurrency: 1, liveRoot: live, outDir: null, log: () => {} };
  const first = await runTasks({ ...base, runner: session('faulted-session', true) });
  assert.match(first.stopped, /MODEL_RATE_LIMIT/);
  const second = await runTasks({ ...base, runner: session('rerun-session', false), resume: true });
  const host = path.join(live, 'host', PHONE_TASK, 'fork-0');
  assert.match(readFileSync(path.join(host, 'transcript.jsonl'), 'utf8'), /rerun-session/);
  const prior = readdirSync(host).filter(f => /^transcript\.prior-\d+\.jsonl$/.test(f));
  assert.equal(prior.length, 1); assert.match(readFileSync(path.join(host, prior[0]), 'utf8'), /faulted-session/);
  assert.equal(second.results[0].forks[0].session.modelResponses, 1);
});
