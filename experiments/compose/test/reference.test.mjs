// The scripted composed reference and its mis-composed variants (HARNESS.md §5). $0, no model calls, dev seeds.
//   node --test --test-concurrency=1 experiments/compose/test/reference.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { runComposedReference, assess, poolsFor } from '../run.mjs';
import { REFERENCE_MANIFEST, ownerOfLid } from '../reference.mjs';
import { manifestProblems } from '../runtime.mjs';

const world = e8.generateWorld({ seed: 1162, difficulty: 3, mix: 'tail', size: 30 });
let pools;
const run = async (opts = {}) => { pools ??= (await poolsFor(world)).pools; const r = await runComposedReference({ world, ...opts }); return assess({ world, rows: r.rows, pools, manifest: r.manifest }); };

test('the reference manifest is a valid composition over E8 and every lid family has one owner', () => {
  assert.deepEqual(manifestProblems(REFERENCE_MANIFEST, { ops: Object.keys(e8.schemas.effects), taskKinds: ['fraudReview'] }), []);
  for (const [lid, m] of [['create:O', 'intake'], ['ost:O:cancelled', 'order'], ['rsv:F:S', 'saga'], ['fst:F:dispatched', 'saga'], ['fst:F:failed', 'compensation'], ['rf:F', 'compensation'], ['ntf:O:order-cancelled', 'notify']]) assert.equal(ownerOfLid(lid), m, lid);
});

test('composed reference: the oracle, every capability contract, no interface violation, both timings', async () => {
  for (const timing of ['earliest', 'latest']) {
    const a = await run({ timing });
    assert.equal(a.oracle.passed, a.oracle.completed, `${timing}: ${JSON.stringify(a.oracle.failing[0])}`);
    assert.equal(a.capabilities.passed, a.capabilities.completed, `${timing}: ${JSON.stringify(a.capabilities.failing[0])}`);
    assert.equal(a.interface.violations, 0);
    assert.equal(a.interface.integrity.length, 0);
    assert.ok(Object.keys(a.interface.calls).some(k => k === 'parent->saga'), 'per-fulfilment saga instances are called');
  }
});

test('mis-composed variants are caught by the intended signal', async () => {
  // Compensation inside the payment module, ignoring the fulfilment's other steps: interface-honest, a business failure.
  const pc = await run({ variant: 'payment-compensates' });
  assert.equal(pc.interface.violations, 0);
  assert.ok(pc.faults.compensation.complete < pc.faults.compensation.due);
  assert.ok(pc.capabilities.failing.some(c => c.violations.compensation));
  assert.ok(pc.oracle.passed < pc.oracle.completed);
  // A module writing outside its interface: audit mode shows it on the interface signal alone; strict mode drops it,
  // and the business consequence appears.
  const uwA = await run({ variant: 'undeclared-write', mode: 'audit' });
  assert.ok(uwA.interface.violationsByCode['effect-undeclared'] > 0);
  assert.equal(uwA.oracle.passed, uwA.oracle.completed);
  const uwS = await run({ variant: 'undeclared-write', mode: 'strict' });
  assert.ok(uwS.interface.dropped > 0 && uwS.oracle.passed < uwS.oracle.completed);
  // A parent emitting effects itself, and a module calling outside the graph.
  assert.ok((await run({ variant: 'parent-direct', mode: 'audit' })).interface.violationsByCode['parent-effect-undeclared'] > 0);
  const cg = await run({ variant: 'call-outside-graph' });
  assert.ok(cg.interface.violationsByCode['call-undeclared'] > 0);
  assert.equal(cg.oracle.passed, cg.oracle.completed);
});
