// Fan-out sizing from measured probes (src/sizing.mjs). $0, synthetic probes; development evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planFanOut, recallLowerBound } from '../src/sizing.mjs';

const close = (a, b, eps = 5e-4) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('recall lower bound: exact Clopper-Pearson one-sided 95% values', () => {
  close(recallLowerBound(20, 20), 0.05 ** (1 / 20));   // all found: alpha^(1/n)
  close(recallLowerBound(59, 59), 0.05 ** (1 / 59));   // the rule of 59: 0.9505
  close(recallLowerBound(9, 10), 0.6058);              // published two-sided 90% lower limit for 9/10
  assert.equal(recallLowerBound(0, 30), 0);
  assert.throws(() => recallLowerBound(3, 2)); assert.throws(() => recallLowerBound(1, 0));
});

const probe = (modelClass, shardSize, known, found, costUsd) => ({ modelClass, shardSize, known, found, costUsd });

test('the plan uses the largest probed size whose recall bound meets the bar, and sizes the count from the work', () => {
  const plan = planFanOut({ units: 1000, budgetUsd: 10, recallBar: 0.9, probes: [
    probe('S', 10, 100, 100, 0.01), probe('S', 40, 100, 99, 0.03), probe('S', 80, 100, 80, 0.05)] });
  assert.equal(plan.decision, 'fan-out'); assert.equal(plan.modelClass, 'S'); assert.equal(plan.shardSize, 40);
  assert.equal(plan.shardCount, 25); close(plan.estCostUsd, 0.75, 1e-9);
  assert.equal(plan.evaluated.find(e => e.shardSize === 80).meetsBar, false);
});

test('few known items are not evidence: a perfect probe on 5 items cannot certify a size', () => {
  const plan = planFanOut({ units: 100, budgetUsd: 10, recallBar: 0.9, probes: [probe('S', 50, 5, 5, 0.01)] });
  assert.equal(plan.decision, 'refuse'); assert.equal(plan.reason, 'no-size-meets-recall'); assert.match(plan.why, /fewer than 20 known items/);
  // 59 of 59 found certifies 0.95; 58 of 58 does not.
  assert.equal(planFanOut({ units: 100, budgetUsd: 10, recallBar: 0.95, probes: [probe('S', 50, 59, 59, 0.01)] }).decision, 'fan-out');
  assert.equal(planFanOut({ units: 100, budgetUsd: 10, recallBar: 0.95, probes: [probe('S', 50, 58, 58, 0.01)] }).decision, 'refuse');
});

test('a class is used only up to its first failing size: a lucky large probe does not rescue it', () => {
  const plan = planFanOut({ units: 400, budgetUsd: 10, recallBar: 0.9, probes: [
    probe('S', 10, 100, 70, 0.01), probe('S', 40, 100, 100, 0.03)] });
  assert.equal(plan.decision, 'refuse');
  assert.equal(plan.evaluated.find(e => e.shardSize === 40).meetsBar, true); assert.equal(plan.evaluated.find(e => e.shardSize === 40).usable, false);
});

test('the cheapest total wins across classes; a stronger class can be cheaper through larger shards', () => {
  const probes = [probe('S', 20, 100, 99, 0.02), probe('S', 40, 100, 80, 0.03), probe('M', 20, 100, 100, 0.05), probe('M', 200, 100, 99, 0.12)];
  const plan = planFanOut({ units: 2000, budgetUsd: 50, recallBar: 0.9, probes, classOrder: ['S', 'M', 'L'] });
  // S: 100 shards x $0.02 = $2.00; M: 10 shards x $0.12 = $1.20.
  assert.equal(plan.modelClass, 'M'); assert.equal(plan.shardSize, 200); assert.equal(plan.shardCount, 10); close(plan.estCostUsd, 1.2, 1e-9);
  assert.equal(plan.alternatives[0].modelClass, 'S');
});

test('work that fits one usable shard is not fanned out', () => {
  const plan = planFanOut({ units: 30, budgetUsd: 1, recallBar: 0.9, probes: [probe('S', 40, 100, 99, 0.03)] });
  assert.equal(plan.decision, 'single'); assert.equal(plan.shardCount, 1); assert.match(plan.why, /no fan-out/);
});

test('over budget refuses with the cheapest plan and the alternatives to filter or sample', () => {
  const plan = planFanOut({ units: 100000, budgetUsd: 5, recallBar: 0.9, probes: [probe('S', 40, 100, 99, 0.03)] });
  assert.equal(plan.decision, 'refuse'); assert.equal(plan.reason, 'over-budget'); assert.equal(plan.cheapest.shardCount, 2500);
  assert.match(plan.why, /\$75\.00/); assert.ok(plan.instead.some(s => /filter/.test(s)) && plan.instead.some(s => /sample/.test(s)));
});

test('never extrapolates past the largest probed size, however much work remains', () => {
  const plan = planFanOut({ units: 1_000_000, budgetUsd: 1e6, recallBar: 0.9, probes: [probe('S', 40, 100, 100, 0.03)] });
  assert.equal(plan.shardSize, 40); assert.equal(plan.shardCount, 25000);
});

test('bad inputs are refused before any plan is made', () => {
  assert.throws(() => planFanOut({ units: 10, budgetUsd: 1, recallBar: 0.9, probes: [] }), /measured probes/);
  assert.throws(() => planFanOut({ units: 0, budgetUsd: 1, recallBar: 0.9, probes: [probe('S', 1, 20, 20, 0)] }), /units/);
  assert.throws(() => planFanOut({ units: 10, budgetUsd: 1, recallBar: 1.5, probes: [probe('S', 1, 20, 20, 0)] }), /recallBar/);
  assert.throws(() => planFanOut({ units: 10, budgetUsd: 1, recallBar: 0.9, probes: [probe('S', 1, 20, 21, 0)] }), /probe 0/);
});

test('the sizing tool prints the plan and exits 0 for a plan, 2 for a refusal, 1 for bad input', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-sizing-')), file = path.join(dir, 'probes.json');
  try {
    writeFileSync(file, JSON.stringify([probe('S', 40, 100, 99, 0.03)]));
    const tool = new URL('../tools/sizing/plan.mjs', import.meta.url).pathname;
    const run = args => spawnSync(process.execPath, [tool, '--probes', file, ...args], { encoding: 'utf8', timeout: 20000 });
    const ok = run(['--units', '1000', '--budget', '5', '--recall', '0.9']);
    assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).shardCount, 25);
    assert.equal(run(['--units', '1000000', '--budget', '5', '--recall', '0.9']).status, 2);
    const bad = run(['--units', 'x', '--budget', '5', '--recall', '0.9']);
    assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stderr).error.code, 'SIZING_INPUT');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
