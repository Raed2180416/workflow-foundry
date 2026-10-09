// Stage B driver and analysis, $0: every interpretation here is the stub or a scripted fake (no model call).
//   node --max-old-space-size=1024 --test research/jit-20261008/analysis/kinetics-gauge/stage-b.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, parseSeeds, buildPlan, actualCost, runStageB, stubMode } from './stage-b.mjs';
import { analyze, sigDigits, matchesUpToRounding, pairCause } from './stage-b-analyze.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stage-b-test-'));
const quiet = () => {};

test('arguments: seeds, defaults, concurrency clamp, stub output dir', () => {
  assert.deepEqual(parseSeeds('201-203,210'), [201, 202, 203, 210]);
  const o = parseArgs([]);
  assert.equal(o.n, 2); assert.equal(o.cap, 0.45); assert.equal(o.spendStop, 5); assert.equal(o.model, 'claude-haiku-5-5'); assert.match(o.out, /out\/stage-b$/);
  assert.equal(parseArgs(['--concurrency', '6']).concurrency, 2);
  assert.match(parseArgs(['--stub']).out, /out\/stage-b-stub$/);
  assert.match(o.work, /^\/var\/tmp\/foundry-work\/kinetics-stage-b\/[0-9a-f]{10}$/);
  assert.equal(parseArgs(['--stub']).work, path.join(parseArgs(['--stub']).out, 'sessions'));
  assert.throws(() => parseArgs(['--cap', '5']), /cap/);
});

test('plan mirrors dev-kinetics-1: d4 for 201-216, d5 for 217-224; other seeds refused', async () => {
  const p = await buildPlan({ seeds: '215-218', n: 2 });
  assert.deepEqual(p.tasks.map(t => t.taskKey), ['kinetics:dev:d4:s215', 'kinetics:dev:d4:s216', 'kinetics:dev:d5:s217', 'kinetics:dev:d5:s218']);
  assert.equal(p.jobs.length, 8);
  assert.deepEqual(p.jobs.slice(0, 2).map(j => j.key), ['215:0', '215:1']);
  assert.equal(p.timeoutMs, 15 * 60 * 1000);
  await assert.rejects(buildPlan({ seeds: '224-225', n: 1 }), /seed guard/);
  await assert.rejects(buildPlan({ seeds: '7001', n: 1 }), /seed guard/);
});

test('actual cost: reported, unknown with zero tokens, unknown with tokens', () => {
  assert.deepEqual(actualCost({ costUsd: 0.12, costUnknown: false }, 0.45), { actualUsd: 0.12, actualBasis: 'reported' });
  assert.equal(actualCost({ costUsd: 0.45, costUnknown: true, streamUsage: { inputTokens: 0, outputTokens: 0 } }, 0.45).actualUsd, 0);
  assert.equal(actualCost({ costUsd: 0.45, costUnknown: true, streamUsage: { inputTokens: 10, outputTokens: 0 } }, 0.45).actualUsd, 0.45);
  assert.equal(actualCost({ costUsd: 0.45, costUnknown: true, streamUsage: null }, 0.45).actualUsd, 0.45);
});

test('stub run is resumable, labelled, and analysable', async () => {
  const out = tmp();
  const base = { ...parseArgs(['--stub', '--seeds', '201-203', '--out', out]) };
  const s1 = await runStageB(base, { log: quiet });
  assert.equal(s1.recorded, 6); assert.equal(s1.finishedNow, 6);
  const s2 = await runStageB(base, { log: quiet });
  assert.equal(s2.finishedNow, 0); assert.equal(s2.recorded, 6);
  assert.ok(fs.existsSync(path.join(out, 'STUB-DATA-NOT-LIVE.txt')));
  const rows = fs.readFileSync(path.join(out, 'sessions.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.ok(rows.every(r => r.stub === true && r.costUsd === 0.01 && fs.existsSync(path.join(out, r.tracePath))));
  await assert.rejects(runStageB({ ...base, stub: false }, { log: quiet }), /holds a stub run/);
  const { out: a, md } = await analyze(out);
  assert.equal(a.sessions.n, 6);
  assert.match(md, /STUB DATA, NOT LIVE/);
  assert.match(md, /dev calibration, not a freeze/);
  assert.equal(a.item1.pairs.length, [201, 202, 203].filter(s => rows.filter(r => r.seed === s && r.oracle.pass).length === 2).length);
});

test('environment faults: retried once, not recorded as sessions, $0 actual when no tokens, streak stops the run', async () => {
  const out = tmp();
  let calls = 0;
  const fault = async ({ workdir, budgetUsd }) => { calls++; fs.writeFileSync(path.join(workdir, 'trace.json'), '{}');
    return { answer: null, costUsd: budgetUsd, costUnknown: true, streamUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, error: { code: 'EXECUTOR_PROTOCOL', stderr: 'root check' } }; };
  const opts = { ...parseArgs(['--seeds', '201-224', '--out', out, '--work', path.join(out, 'w'), '--concurrency', '1', '--max-env-faults', '2']), stub: false };
  const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN; process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-placeholder';
  try {
    const s = await runStageB(opts, { interpretFn: fault, log: quiet });
    assert.equal(s.recorded, 0); assert.equal(calls, 4); assert.equal(s.spentActualUsd, 0); assert.equal(s.spentBookedUsd, 1.8);
    assert.match(s.stopReason, /environment faults/);
    assert.equal(fs.readFileSync(path.join(out, 'faults.jsonl'), 'utf8').trim().split('\n').length, 4);
  } finally { if (saved == null) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved; }
});

test('spend stop on the actual ledger', async () => {
  const out = tmp();
  const pricey = async ({ workdir }) => { fs.writeFileSync(path.join(workdir, 'trace.json'), '{}'); return { answer: null, costUsd: 0.3, costUnknown: false, streamUsage: null, error: null }; };
  const opts = { ...parseArgs(['--seeds', '201-224', '--out', out, '--work', path.join(out, 'w'), '--concurrency', '1', '--spend-stop', '0.5']), stub: false };
  const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN; process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-placeholder';
  try {
    const s = await runStageB(opts, { interpretFn: pricey, log: quiet });
    assert.equal(s.recorded, 2); assert.match(s.stopReason, /spend stop/);
    const rows = fs.readFileSync(path.join(out, 'sessions.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.ok(rows.every(r => r.oracle.pass === false && r.oracle.score === 0 && r.oracle.reason === 'no-output'));
  } finally { if (saved == null) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved; }
});

test('live mode refuses to start without the token variable', async () => {
  const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN; delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try { await assert.rejects(runStageB({ ...parseArgs(['--seeds', '201', '--out', tmp(), '--work', tmp()]) }, { log: quiet, interpretFn: async () => { throw new Error('must not run'); } }), /CLAUDE_CODE_OAUTH_TOKEN is not set/); }
  finally { if (saved != null) process.env.CLAUDE_CODE_OAUTH_TOKEN = saved; }
});

test('cause helpers', () => {
  assert.equal(sigDigits(12.34), 4); assert.equal(sigDigits(0.00120), 2); assert.equal(sigDigits(1 / 3), 16);
  const t = { conditions: [{ condition_id: 'C1', vmax: 1.23456, km: 10.0004 }] };
  assert.ok(matchesUpToRounding({ conditions: [{ condition_id: 'C1', vmax: 1.23, km: 10 }] }, t));
  assert.ok(!matchesUpToRounding({ conditions: [{ condition_id: 'C1', vmax: 1.25, km: 10 }] }, t));
  assert.equal(pairCause(false, { cls: 'sop' }, { cls: 'sop' }), 'exclusion-set');
  assert.equal(pairCause(true, { cls: 'sop-rounded-3sf' }, { cls: 'sop' }), 'precision/rounding');
  assert.equal(pairCause(true, { cls: 'estimator:hanes' }, { cls: 'sop' }), 'estimator');
  assert.equal(pairCause(true, { cls: 'estimator:hanes' }, { cls: 'other' }), 'non-convergence/other');
  assert.equal(stubMode({ ord: 6, seed: 201, session: 0 }, 7), 'near-miss:km+12%-one-condition');
});

test('a harness throw is charged at the cap in the ledger and stops the run', async () => {
  const out = tmp();
  const saved = process.env.CLAUDE_CODE_OAUTH_TOKEN; process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-placeholder';
  try {
    await assert.rejects(runStageB({ ...parseArgs(['--seeds', '201', '--out', out, '--work', path.join(out, 'w'), '--concurrency', '1']) }, { log: quiet, interpretFn: async () => { throw new Error('boom'); } }), /boom/);
    const led = fs.readFileSync(path.join(out, 'ledger.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(led.length, 1); assert.equal(led[0].error, 'HARNESS_THROW'); assert.equal(led[0].actualUsd, 0.45);
  } finally { if (saved == null) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved; }
});
