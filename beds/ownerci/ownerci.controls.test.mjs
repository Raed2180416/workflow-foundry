// ownerci oracle health: referenceSolve passes on 20 seeds per difficulty (100 tasks); every bad
// control fails on 20 seeds (4 per difficulty, all five difficulties); controls fail for the
// documented reason; fixing only the visibly failing mutants fails at d4-d5; oracle time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';
import { applyEdits } from './mutate.mjs';

const DIFFS = [1, 2, 3, 4, 5];
export const REFERENCE_SEEDS = 20;
export const CONTROL_SEEDS_PER_DIFFICULTY = 4;
const splitOf = seed => (seed % 2 ? 'dev' : 'test');
const wall = [];

test(`referenceSolve passes on ${REFERENCE_SEEDS} seeds per difficulty with score 1`, () => {
  const problems = [];
  for (const difficulty of DIFFS) for (let seed = 1; seed <= REFERENCE_SEEDS; seed++) {
    const task = bed.generate({ seed, split: splitOf(seed), difficulty });
    const t0 = performance.now();
    const out = bed.oracle(task, bed.referenceSolve(task));
    wall.push(performance.now() - t0);
    if (!out.pass || out.score !== 1) problems.push(`${task.id}: ${JSON.stringify(out.details)}`);
  }
  assert.deepEqual(problems, []);
});

test(`every bad control fails on ${CONTROL_SEEDS_PER_DIFFICULTY * DIFFS.length} seeds (all difficulties) for the documented reason`, () => {
  const problems = [];
  const scores = Object.fromEntries(bed.badControls.map(c => [c.name, []]));
  const reasons = Object.fromEntries(bed.badControls.map(c => [c.name, new Set()]));
  const hiddenFails = [];
  for (const difficulty of DIFFS) for (let seed = 101; seed < 101 + CONTROL_SEEDS_PER_DIFFICULTY; seed++) {
    const task = bed.generate({ seed, split: splitOf(seed), difficulty });
    for (const control of bed.badControls) {
      const out = bed.oracle(task, control.make(task));
      scores[control.name].push(out.score);
      reasons[control.name].add(out.details.reason);
      if (out.pass) problems.push(`bad control ${control.name} passed ${task.id}`);
      if (out.score >= 1) problems.push(`bad control ${control.name} scored 1 on ${task.id}`);
      if (control.name === 'try-catch-defaults') hiddenFails.push(out.details.tests?.hiddenFailedCount ?? 0);
    }
  }
  assert.deepEqual(problems, []);
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.equal(mean(scores.empty), 0);
  assert.deepEqual([...reasons['export-removed']], ['diff guard violated']);
  assert.deepEqual([...reasons['test-detection-hack']], ['diff guard violated']);
  // a truncated module either loses an export (static guard) or no longer parses
  assert.ok([...reasons['shuffled-or-corrupted']].every(r => ['module failed to load (no test could run)', 'diff guard violated'].includes(r)));
  assert.deepEqual([...reasons['try-catch-defaults']], ['tests failed'], 'the try/catch wrapper keeps the guard and must be caught by tests');
  assert.ok(hiddenFails.every(n => n > 0), `try/catch control must fail hidden tests: ${hiddenFails}`);
  // Plausible near misses: most tests still pass.
  assert.ok(mean(scores['near-miss-fix-one']) > 0.5, `near-miss mean score ${mean(scores['near-miss-fix-one'])}`);
  assert.ok(mean(scores['unchanged-mutated']) > 0.5, `unchanged mean score ${mean(scores['unchanged-mutated'])}`);
});

test('d4-d5: fixing only the visibly failing mutants still fails the hidden suite', () => {
  for (const difficulty of [4, 5]) for (let seed = 201; seed <= 205; seed++) {
    const task = bed.generate({ seed, split: 'dev', difficulty });
    const inst = bed.instance(task);
    const silent = inst.mutants.filter(m => !m.visibleFailing.length);
    const out = bed.oracle(task, { patched_source: applyEdits(inst.original, silent.map(m => m.edit)) });
    assert.equal(out.pass, false, task.id);
    assert.deepEqual(out.details.tests.visibleFailed, [], `${task.id}: visible suite should be green`);
    assert.ok(out.details.tests.hiddenFailedCount > 0, task.id);
  }
});

test('oracle runs isolated and within the time budget', () => {
  assert.ok(wall.length > 0);
  const sorted = [...wall].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  assert.ok(med < 2000, `median oracle time ${med} ms`);
  const task = bed.generate({ seed: 1, split: 'dev', difficulty: 1 });
  const out = bed.oracle(task, bed.referenceSolve(task));
  assert.equal(out.details.sandbox, bed.sandboxAvailable() ? 'unshare' : 'plain-child');
});
