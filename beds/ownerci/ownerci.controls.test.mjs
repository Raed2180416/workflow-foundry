// ownerci oracle health: referenceSolve passes on 30 test-split seeds at d1, d3 and d5 and 20 at
// d2 and d4; every bad control fails on 30 seeds at d1, d3 and d5 plus 6 at d2 and d4 (102 tasks);
// controls fail for the documented reason; fixing only the visibly failing mutants fails at d4-d5;
// oracle time. Oracle runs go through oracleAsync with a small worker pool (same verdicts as
// oracle(), see the equality check below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { applyEdits } from './mutate.mjs';

export const REFERENCE_SEEDS = { 1: 30, 2: 20, 3: 30, 4: 20, 5: 30 };
export const CONTROL_SEEDS = { 1: 30, 2: 6, 3: 30, 4: 6, 5: 30 };
const DIFFS = [1, 2, 3, 4, 5];
const CONCURRENCY = 4;
const wall = [];

async function pool(jobs, worker, n = CONCURRENCY) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await worker(jobs[i]); }
  }));
  return out;
}
const tasksFor = (counts, from) => DIFFS.flatMap(difficulty => Array.from({ length: counts[difficulty] }, (_, i) => bed.generate({ seed: from + i, split: 'test', difficulty })));

test('referenceSolve passes with score 1 (30 seeds at d1/d3/d5, 20 at d2/d4)', async () => {
  const tasks = tasksFor(REFERENCE_SEEDS, 1);
  const results = await pool(tasks, async task => {
    const t0 = performance.now();
    const out = await bed.oracleAsync(task, bed.referenceSolve(task));
    wall.push(performance.now() - t0);
    return { task, out };
  });
  const problems = results.filter(({ out }) => !out.pass || out.score !== 1).map(({ task, out }) => `${task.id}: ${JSON.stringify(out.details)}`);
  assert.deepEqual(problems, []);
  assert.equal(results.length, 130);
});

test('oracleAsync and oracle give identical verdicts', async () => {
  for (const [seed, difficulty] of [[3, 1], [4, 3], [5, 5]]) {
    const task = bed.generate({ seed, split: 'dev', difficulty });
    for (const output of [bed.referenceSolve(task), { patched_source: task.inputs.module_source }, { patched_source: '' }]) {
      const a = bed.oracle(task, output), b = await bed.oracleAsync(task, output);
      assert.deepEqual([a.pass, a.score, a.details.reason], [b.pass, b.score, b.details.reason], task.id);
    }
  }
});

test('every bad control fails on 102 tasks (30 seeds at d1/d3/d5, 6 at d2/d4) for the documented reason', async () => {
  const tasks = tasksFor(CONTROL_SEEDS, 101);
  const jobs = tasks.flatMap(task => bed.badControls.map(control => ({ task, control })));
  const results = await pool(jobs, async ({ task, control }) => ({ task, control, out: await bed.oracleAsync(task, control.make(task)) }));
  const problems = [];
  const scores = Object.fromEntries(bed.badControls.map(c => [c.name, []]));
  const reasons = Object.fromEntries(bed.badControls.map(c => [c.name, new Set()]));
  const fails = Object.fromEntries(bed.badControls.map(c => [c.name, 0]));
  const hiddenFails = [];
  for (const { task, control, out } of results) {
    scores[control.name].push(out.score);
    reasons[control.name].add(out.details.reason);
    if (out.pass) problems.push(`bad control ${control.name} passed ${task.id}`); else fails[control.name]++;
    if (out.score >= 1) problems.push(`bad control ${control.name} scored 1 on ${task.id}`);
    if (control.name === 'try-catch-defaults') hiddenFails.push(out.details.tests?.hiddenFailedCount ?? 0);
  }
  assert.deepEqual(problems, []);
  for (const c of bed.badControls) assert.equal(fails[c.name], tasks.length, `${c.name} failed ${fails[c.name]}/${tasks.length}`);
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.equal(mean(scores.empty), 0);
  assert.deepEqual([...reasons['export-removed']], ['diff guard violated']);
  assert.deepEqual([...reasons['test-detection-hack']], ['diff guard violated']);
  assert.deepEqual([...reasons['assert-monkeypatch']], ['diff guard violated']);
  // a truncated module either loses an export (static guard) or no longer parses
  assert.ok([...reasons['shuffled-or-corrupted']].every(r => ['module failed to load (no test could run)', 'diff guard violated'].includes(r)));
  assert.deepEqual([...reasons['try-catch-defaults']], ['tests failed'], 'the try/catch wrapper keeps the guard and must be caught by tests');
  assert.ok(hiddenFails.every(n => n > 0), `try/catch control must fail hidden tests: ${hiddenFails}`);
  // Plausible near misses: most tests still pass.
  assert.ok(mean(scores['near-miss-fix-one']) > 0.5, `near-miss mean score ${mean(scores['near-miss-fix-one'])}`);
  assert.ok(mean(scores['unchanged-mutated']) > 0.5, `unchanged mean score ${mean(scores['unchanged-mutated'])}`);
});

test('d4-d5: fixing only the visibly failing mutants still fails the hidden suite', async () => {
  const tasks = [4, 5].flatMap(difficulty => [201, 202, 203, 204, 205].map(seed => bed.generate({ seed, split: 'dev', difficulty })));
  const results = await pool(tasks, async task => {
    const inst = bed.instance(task);
    const silent = inst.mutants.filter(m => !m.visibleFailing.length);
    return { task, out: await bed.oracleAsync(task, { patched_source: applyEdits(inst.original, silent.map(m => m.edit)) }) };
  });
  for (const { task, out } of results) {
    assert.equal(out.pass, false, task.id);
    assert.deepEqual(out.details.tests.visibleFailed, [], `${task.id}: visible suite should be green`);
    assert.ok(out.details.tests.hiddenFailedCount > 0, task.id);
  }
});

test('oracle runs isolated and within the time budget', () => {
  assert.ok(wall.length > 0);
  const sorted = [...wall].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  // wall times above were measured with CONCURRENCY parallel runs; a single run is faster
  assert.ok(med < 2000 * CONCURRENCY, `median oracle time ${med} ms under ${CONCURRENCY}-way concurrency`);
  const task = bed.generate({ seed: 1, split: 'dev', difficulty: 5 });
  const t0 = performance.now();
  const out = bed.oracle(task, bed.referenceSolve(task));
  const single = performance.now() - t0;
  assert.ok(single < 2000, `single oracle call took ${Math.round(single)} ms`);
  assert.equal(out.details.sandbox, bed.sandboxAvailable() ? 'unshare' : 'plain-child');
});
