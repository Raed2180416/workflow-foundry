// Shared oracle-health suite, one test file per difficulty (codefix.controls-d*.test.mjs).
// referenceSolve must pass on REFERENCE_SEEDS seeds per difficulty; every bad control must fail
// on CONTROL_SEEDS seeds per difficulty (5 x 10 = 50 tasks per control overall).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as bed from './index.mjs';

export const REFERENCE_SEEDS = 20;
export const CONTROL_SEEDS = 10;

export function controlSuite(difficulty) {
  test(`codefix d${difficulty}: referenceSolve passes (${REFERENCE_SEEDS} seeds) and every bad control fails (${CONTROL_SEEDS} seeds)`, () => {
    const problems = [];
    const scores = Object.fromEntries(bed.badControls.map(c => [c.name, []]));
    for (let seed = 1; seed <= REFERENCE_SEEDS; seed++) {
      const split = seed % 2 ? 'dev' : 'test';
      const task = bed.generate({ seed, split, difficulty });
      const ref = bed.oracle(task, bed.referenceSolve(task));
      if (!ref.pass || ref.score !== 1) problems.push(`reference failed ${task.id}: ${JSON.stringify(ref.details)}`);
      if (seed > CONTROL_SEEDS) continue;
      for (const control of bed.badControls) {
        const out = bed.oracle(task, control.make(task));
        scores[control.name].push(out.score);
        if (out.pass) problems.push(`bad control ${control.name} passed ${task.id}`);
        if (out.score >= 1) problems.push(`bad control ${control.name} scored 1 on ${task.id}`);
      }
    }
    assert.deepEqual(problems, []);
    // Near misses must look plausible (most hidden cases still pass), not trivially broken.
    const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(mean(scores['near-miss-fix-one']) > 0.5, `near-miss mean score ${mean(scores['near-miss-fix-one'])}`);
    assert.equal(mean(scores.empty), 0);
  });
}
