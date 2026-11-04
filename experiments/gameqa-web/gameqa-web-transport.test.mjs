// $0 tests for GQA-1 amendment A1: the transport fixes (no CLI budget line, rate-limit retry with spend carried) and the
// analysis rule that excludes a run whose model calls failed for non-model reasons (PREREG-GQA-1 §6).
//   nice -n 15 node --test --test-concurrency=1 experiments/gameqa-web/gameqa-web-transport.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ClaudeCliProvider } from '../../src/models/providers/claude-cli.mjs';
import { subsetPolicy } from '../lib/models.mjs';
import { omitCliBudgetFlag, withRateLimitRetry } from './transport.mjs';
import { loadRuns, transportFailures, compare, summarize } from './analyze.mjs';
import { readFileSync } from 'node:fs';
const FROZEN_BED = JSON.parse(readFileSync(new URL('../../research/gameqa-20261021/FREEZE.json', import.meta.url), 'utf8')).bed.sha256;

const HAIKU = 'claude-haiku-5-5';
const policy = subsetPolicy(loadPolicy().policy, [HAIKU]);
const entry = policy.models.find(m => m.id === HAIKU);
const argsOf = provider => provider.args({ modelEntry: entry, system: 'S', schema: { type: 'object' }, decoding: { reasoning: 'low' } });

test('omitCliBudgetFlag drops --max-budget-usd and its value, and nothing else', () => {
  const provider = new ClaudeCliProvider({ policy, maxBudgetUsd: 0.25 });
  const before = argsOf(provider);
  const i = before.indexOf('--max-budget-usd');
  assert.ok(i >= 0, 'the stock provider passes the flag (the CLI then adds a "USD budget" line to the context)');
  assert.equal(before[i + 1], '0.25');
  const port = { providers: { 'claude-cli': provider } };
  omitCliBudgetFlag(port); omitCliBudgetFlag(port);   // idempotent
  const after = argsOf(provider);
  assert.ok(!after.includes('--max-budget-usd'));
  assert.deepEqual(after, [...before.slice(0, i), ...before.slice(i + 2)]);
  // a second provider of the same class is untouched (instance hook, not a class change)
  assert.ok(argsOf(new ClaudeCliProvider({ policy, maxBudgetUsd: 0.25 })).includes('--max-budget-usd'));
});

test('withRateLimitRetry retries returned and thrown rate limits, carries their spend, and gives up after the waits', async () => {
  const waits = [], logs = [];
  const seq = [{ ok: false, error: { code: 'MODEL_RATE_LIMIT' }, costUsd: 0.001 },
    Object.assign(new Error('429'), { code: 'MODEL_RATE_LIMIT' }),
    { ok: true, value: { x: 1 }, costUsd: 0.002 }];
  let n = 0;
  const port = { providers: {}, call: async () => { const r = seq[n++]; if (r instanceof Error) throw r; return r; } };
  const wrapped = withRateLimitRetry(port, { waitsMs: [5, 7], sleep: async ms => { waits.push(ms); }, log: e => logs.push(e) });
  const r = await wrapped.call({ nodeKey: 'k', attempt: 0 });
  assert.equal(r.ok, true);
  assert.equal(n, 3);
  assert.deepEqual(waits, [5, 7]);
  assert.equal(Math.round(r.costUsd * 1e6), 3000, 'the spend of the retried attempt is carried into the returned result');
  assert.equal(logs.length, 2);
  assert.ok(logs.every(l => l.transport === 'rate-limit-retry'));

  // gives up: the last rate-limited result is returned as is (the run then shows it as a non-model failure)
  let m = 0;
  const always = { providers: {}, call: async () => { m++; return { ok: false, error: { code: 'MODEL_RATE_LIMIT' }, costUsd: 0 }; } };
  const r2 = await withRateLimitRetry(always, { waitsMs: [1], sleep: async () => {} }).call({ nodeKey: 'k' });
  assert.equal(m, 2);
  assert.equal(r2.error.code, 'MODEL_RATE_LIMIT');

  // other failures are never retried
  let k = 0;
  const schema = { providers: {}, call: async () => { k++; return { ok: false, error: { code: 'MODEL_SCHEMA' } }; } };
  await withRateLimitRetry(schema, { waitsMs: [1], sleep: async () => {} }).call({ nodeKey: 'k' });
  assert.equal(k, 1);
});

test('analysis: a run whose model calls failed for non-model reasons is a harness fault, a model failure is not', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gqa1-analyze-'));
  try {
    const score = foundMin => ({ summary: { foundMin, foundMinClass: foundMin, foundAny: foundMin, falseReports: 0, reports: foundMin, duplicates: 0, precision: 1 }, perBug: {} });
    const mk = (name, arm, rep, calls, foundMin) => {
      const d = path.join(dir, name); mkdirSync(d);
      writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ runId: name, arm, rep, dev: false, error: null, bed: FROZEN_BED, wallMs: 1000, cost: { spent: 0 } }));
      writeFileSync(path.join(d, 'score.json'), JSON.stringify(score(foundMin)));
      writeFileSync(path.join(d, 'calls.jsonl'), calls.map(c => JSON.stringify(c)).join('\n'));
    };
    mk('gqa1-workflow-r1', 'workflow', 1, [{ node: 'construct' }, { nodeKey: 'a', ok: true }, { nodeKey: 'b', ok: true }], 8);
    mk('gqa1-workflow-r2', 'workflow', 2, [{ nodeKey: 'construct', ok: false, error: 'MODEL_RATE_LIMIT' }], 0);
    mk('gqa1-workflow-r3', 'workflow', 3, [{ nodeKey: 'a', ok: false, error: 'MODEL_SCHEMA' }, { nodeKey: 'a', ok: false, error: 'MODEL_SCHEMA' }], 0);
    mk('gqa1-workflow-r4', 'workflow', 4, [{ nodeKey: 'a', ok: true }, { nodeKey: 'b', ok: false, error: 'MODEL_RATE_LIMIT' }, { nodeKey: 'c', ok: true },
      { transport: 'rate-limit-retry', nodeKey: 'b' }], 7);
    assert.deepEqual(transportFailures(path.join(dir, 'gqa1-workflow-r4')), { calls: 3, nonModel: 1 });
    const runs = loadRuns(dir), by = Object.fromEntries(runs.map(r => [r.name, r.excluded]));
    assert.equal(by['gqa1-workflow-r1'], null);
    assert.match(by['gqa1-workflow-r2'], /harness fault \(1 of 1 model calls failed for a non-model reason\)/);
    assert.equal(by['gqa1-workflow-r3'], null, 'schema failures are the model\'s: a result, not a harness fault');
    assert.equal(by['gqa1-workflow-r4'], null, 'one rate limit in three calls stays under the 50% rule');
    assert.deepEqual(summarize(runs)['gqa1/workflow'].foundMin, [8, 0, 7]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('analysis: S1/S2 compare two series with all valid reps (independent runs, not paired by rep)', () => {
  const arm = (tag, name, reps, foundMin) => ({ tag, arm: name, reps, foundMin });
  const arms = { 'gqa1/workflow': arm('gqa1', 'workflow', [1, 2, 3], [8, 8, 7]), 'gqa1nb/agent': arm('gqa1nb', 'agent', [4, 5], [2, 1]), 'gqa1/agent': arm('gqa1', 'agent', [1, 2, 3, 4, 5], [1, 1, 1, 1, 1]) };
  const t = Object.fromEntries(compare(arms).map(x => [x.role.slice(0, 2), x]));
  assert.equal(t.S1.nA, 3); assert.equal(t.S1.nB, 2);
  assert.equal(t.S2.nA, 2); assert.equal(t.S2.nB, 5);
  assert.equal(t.H1.nA, 3, 'H1 stays paired on complete reps of one series');
  assert.equal(t.H1.nB, 3);
});
