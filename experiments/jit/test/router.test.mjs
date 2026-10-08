import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeKey, decide, sliderParams, sampled, expectedRemaining } from '../router.mjs';

test('shapeKey ignores values but not structure', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } } };
  const t1 = { prompt: 'Merge 38 rows from "BRIGHTDESK" by 2026-01-04.', inputs: { rows: [{ id: 1, name: 'x' }], notes: 'abc' } };
  const t2 = { prompt: 'Merge 41 rows from "LEDGR" by 2027-03-09.', inputs: { rows: [{ id: 9, name: 'y' }, { id: 3, name: 'z' }], notes: 'other' } };
  const t3 = { prompt: 'Fix the failing tests.', inputs: { files: ['a.py'] } };
  assert.equal(shapeKey(t1, schema), shapeKey(t2, schema));
  assert.notEqual(shapeKey(t1, schema), shapeKey(t3, schema));
  assert.notEqual(shapeKey(t1, schema), shapeKey(t1, { type: 'object' }));
});

test('warmup, then compile only when it pays back', () => {
  assert.equal(decide({ stats: { seen: 1, traces: 1, agentCostMean: 0.2 }, expectedRemaining: 100 }).action, 'interpret');
  const go = decide({ stats: { seen: 4, traces: 4, agentCostMean: 0.2 }, expectedRemaining: 40 });
  assert.equal(go.action, 'compile');
  // codefix-like: the agent is already cheap, so compiling never pays back
  const cheap = decide({ stats: { seen: 4, traces: 4, agentCostMean: 0.015 }, expectedRemaining: 40 });
  assert.equal(cheap.action, 'interpret');
  assert.match(cheap.reason, /not worth/);
  // a one-off shape is not compiled for
  assert.equal(decide({ stats: { seen: 4, traces: 4, agentCostMean: 0.5 }, expectedRemaining: 1 }).action, 'interpret');
});

test('the slider moves warmup, payback and shadow rate', () => {
  const cheap = sliderParams(0), safe = sliderParams(1);
  assert.ok(cheap.warmup < safe.warmup && cheap.payback < safe.payback && cheap.shadowBase < safe.shadowBase && cheap.maxDeoptRate > safe.maxDeoptRate);
});

test('compiled versions are shadowed more when they disagree, and benched when they deopt a lot', () => {
  const base = { seen: 20, traces: 5, agentCostMean: 0.2, compiled: { version: 2, accepted: true, runs: 10, deopts: 1, shadows: 4, disagreements: 0 } };
  const quiet = decide({ taskId: 't', stats: base, slider: 0.5 });
  const noisy = decide({ taskId: 't', stats: { ...base, compiled: { ...base.compiled, disagreements: 2 } }, slider: 0.5 });
  assert.equal(quiet.action, 'run-compiled');
  assert.ok(noisy.shadowP > quiet.shadowP);
  const benched = decide({ taskId: 't', stats: { ...base, compiled: { ...base.compiled, deopts: 7 } }, slider: 0.5 });
  assert.equal(benched.action, 'interpret');
  assert.equal(benched.recompile, true);
});

test('sampling is deterministic and close to its rate', () => {
  assert.equal(sampled('abc', 0.3), sampled('abc', 0.3));
  const hits = Array.from({ length: 2000 }, (_, i) => sampled(`task-${i}`, 0.25)).filter(Boolean).length;
  assert.ok(hits > 400 && hits < 600, `hits=${hits}`);
  assert.equal(sampled('x', 0), false);
  assert.equal(sampled('x', 1), true);
});

test('expectedRemaining scales with the shape share', () => {
  assert.equal(expectedRemaining({ shapeCount: 5, totalCount: 10, horizon: 40 }), 20);
  assert.equal(expectedRemaining({ shapeCount: 0, totalCount: 0, horizon: 40 }), 0);
});
