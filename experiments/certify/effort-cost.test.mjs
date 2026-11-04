// Tests for the effort cost model (effort-cost.mjs): it projects only through a measured dose and never fills in an
// unrecorded effort. nice -n 15 node --test --test-concurrency=1 experiments/certify/effort-cost.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { armProfile, policyPrices, projectCost, readerDose } from './effort-cost.mjs';

test('projectCost refuses an unmeasured dose (teeth: a variant that defaults the multiplier to 1 projects anyway)', () => {
  const doses = [{ model: 'claude-haiku-5-5', from: 'low', to: 'medium', costRatio: 1.2 }];
  const ok = projectCost({ nodeCostPerTask: 0.01, otherCostPerTask: 0.005, model: 'claude-haiku-5-5', from: 'low', to: 'medium' }, doses);
  assert.ok(Math.abs(ok.usdPerTask - 0.017) < 1e-12);
  assert.equal(ok.measured, true);
  const no = projectCost({ nodeCostPerTask: 0.01, model: 'claude-haiku-5-5', from: 'UNSET', to: 'max' }, doses);
  assert.equal(no.usdPerTask, null);
  assert.equal(no.measured, false);
  const naive = ({ nodeCostPerTask }, ds) => ({ usdPerTask: nodeCostPerTask * (ds.find(() => false)?.costRatio ?? 1) });
  assert.notEqual(naive({ nodeCostPerTask: 0.01 }, doses).usdPerTask, no.usdPerTask);
  assert.equal(projectCost({ nodeCostPerTask: 0.01, model: 'm', from: 'high', to: 'high' }, []).usdPerTask, 0.01);
});

test('readerDose pairs calls of the same task and reader index; the ratio and its task-cluster interval', () => {
  const rows = [];
  for (let t = 0; t < 4; t++) for (let r = 0; r < 3; r++) {
    rows.push({ ok: true, version: 'rl2-extract-v3', task: `t${t}`, reader: `haiku:${r}`, usage: { outputTokens: 1000 }, costUsd: 0.001 });
    rows.push({ ok: true, version: 'rl2-extract-v3', task: `t${t}`, reader: `haikum:${r}`, usage: { outputTokens: 1500 + 100 * t }, costUsd: 0.0012 });
  }
  rows.push({ ok: true, version: 'rl2-extract-v3', task: 'x', reader: 'haiku:0', usage: { outputTokens: 99999 }, costUsd: 1 });   // unpaired: ignored
  const d = readerDose(rows, { B: 300 });
  assert.equal(d.pairs, 12);
  assert.equal(d.tasks, 4);
  assert.ok(Math.abs(d.outputRatio - 1.65) < 1e-9);
  assert.ok(Math.abs(d.costRatio - 1.2) < 1e-9);
  assert.ok(d.outputRatioCI.lo >= 1.5 - 1e-9 && d.outputRatioCI.hi <= 1.8 + 1e-9);
  assert.equal(readerDose([]).pairs, 0);
});

test('armProfile reads only dev60 runs and keeps an unset effort unset', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'effort-'));
  try {
    for (const run of ['x-dev60-dn', 'x-look2-1']) {
      mkdirSync(path.join(root, run), { recursive: true });
      writeFileSync(path.join(root, run, 'launch.json'), JSON.stringify({ model: 'claude-haiku-5-5', effort: null, budgetUsd: 0.75, capUsd: 3 }));
      writeFileSync(path.join(root, run, 'results.jsonl'), [JSON.stringify({ task: 'a.b', forks: [{ costUsd: 0.01, tokens: { input: 1000, output: 10, cachedInput: 500 } }] }),
        JSON.stringify({ task: 'a.c', forks: [{ costUsd: 0.03, tokens: { input: 3000, output: 30, cachedInput: 0 } }] })].join('\n') + '\n');
    }
    const p = armProfile(root, ['x-dev60-dn'], policyPrices());
    assert.equal(p.tasks, 2);
    assert.ok(Math.abs(p.usdPerTask - 0.02) < 1e-12);
    assert.equal(p.conforming, false);
    assert.match(p.manifest[0], /@UNSET\//, 'unset effort is reported, never filled with a CLI default');
    assert.ok(p.accounting.meanImpliedOutputUpper > p.accounting.meanRecordedOutput);
    assert.throws(() => armProfile(root, ['x-look2-1'], policyPrices()), /not on the dev60 allowlist/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('prices come from the owner policy file only', () => {
  const p = policyPrices();
  assert.deepEqual(p['claude-haiku-5-5'], { in: 0.1, out: 0.5 });
  assert.ok(p['claude-opus-5-5'].out > p['claude-sonnet-5-5'].out);
});
