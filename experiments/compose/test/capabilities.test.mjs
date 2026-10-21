// Capability contracts against the E8 oracle on small dev worlds (HARNESS.md §3). $0, no model calls. Seeds: E-bed dev
// block (composition harness seeds 1161-1168). The full validation table is tools-run (validate.mjs), not a test.
//   node --test --test-concurrency=1 experiments/compose/test/capabilities.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { runControl } from '../../../beds/ebed/e8/controls.mjs';
import { CAPABILITIES, evaluateCapabilities, identityOf } from '../capabilities.mjs';
import { compare } from '../validate.mjs';

const W = [{ seed: 1161, d: 2, size: 24 }, { seed: 1164, d: 5, size: 30 }];
const prep = async ({ seed, d, size }) => { const w = e8.generateWorld({ seed, difficulty: d, mix: 'tail', size }); const ref = await e8.referenceRuns(w); return { w, ref, pools: ref.pools }; };

test('13 capability contracts, each citing SPEC-E rules', () => {
  assert.equal(CAPABILITIES.length, 13);
  for (const c of CAPABILITIES) assert.ok(c.rules.length && c.rules.every(r => /^(R\d|S\d|§)/.test(r)), c.id);
  assert.equal(identityOf({ system: 'billing', op: 'charge', args: { fulfilmentId: 'F' } }), 'charge:F');
});

test('both reference runs satisfy every contract on every completed case', async () => {
  for (const spec of W) {
    const { w, ref, pools } = await prep(spec);
    for (const timing of ['earliest', 'latest']) {
      const ev = evaluateCapabilities(w, ref.runs[timing].rows, { pools, canonicalArgs: e8.canonicalArgs });
      const bad = ev.cases.filter(c => c.pool === 'completed' && !c.pass);
      assert.equal(bad.length, 0, `${spec.seed} ${timing}: ${JSON.stringify(bad[0]?.violations)}`);
    }
  }
});

test('controls: the contracts reject where the oracle rejects (the named capability), and never reject alone', async () => {
  const { w, pools } = await prep(W[1]);
  const expect = { noop: 'intake', 'charge-twice': 'exactly-once', 'no-compensation': 'compensation', 'forward-order-compensation': 'compensation',
    'timer-first': 'customer-action', 'escalate-everything': 'fraud', 'hold-everything': 'fraud', 'no-keys': 'exactly-once', 'last-signal-wins': 'tracking' };
  for (const [id, cap] of Object.entries(expect)) {
    const r = compare(w, await runControl(id, w), pools);
    assert.ok(r.both > 0, `${id}: the contracts catch nothing the oracle rejects`);
    assert.ok(r.capFails[cap] > 0, `${id}: ${cap} not violated (${JSON.stringify(r.capFails)})`);
    assert.equal(r.capsOnly, 0, `${id}: contracts reject a case the oracle passes: ${JSON.stringify(r.extras[0])}`);
  }
});
