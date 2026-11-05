// PREREG-TRACKER-H §5 rules as code (experiments/tracker-v2/decide-h.mjs): each rule must flip on the exact boundary it states.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, SAMPLES, PROSE_FILE } from '../decide-h.mjs';

const M = 'claude-haiku-5-5';
const arm = (caught, fa, defective = 30, builds = 100) => ({ builds, defective, caught, falseAlarms: fa, precision: caught + fa ? caught / (caught + fa) : null, falseAlarmIds: [] });
function scores({ solo = arm(20, 0), t0 = arm(5, 0), both = arm(25, 0), v1solo = arm(20, 3), t1 = arm(22, 10), recall = 0.95 } = {}) {
  const arms = {};
  for (const s of SAMPLES) {
    arms[`judge-v3-${M}-${s}__${M}.json`] = { T0: t0, T2solo: solo, 'T0+T2solo': both, T2: solo, T2noG3: solo, 'T0+T2': both };
    arms[`judge-v1-${M}-${s}__${M}.json`] = { T0: t0, T2solo: v1solo, 'T0+T2solo': both };
  }
  arms[PROSE_FILE] = { T1: t1 };
  return { arms, recall: Object.fromEntries(SAMPLES.map(s => [`capture-${M}-${s}.json`, { recall, covered: 1, total: 1 }])) };
}

test('every rule is met by a clean result', () => {
  const r = decide(scores()).rules;
  for (const h of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) assert.equal(r[h].all, true, h);
});

test('H1 and H2: one false alarm in 20 flags meets H1 (0.952) but fails H2; two fail both', () => {
  let r = decide(scores({ solo: arm(20, 1) })).rules;
  assert.equal(r.H1.all, true);
  assert.equal(r.H2.all, false);
  r = decide(scores({ solo: arm(20, 2) })).rules;
  assert.equal(r.H1.all, false);
  assert.equal(r.H1.s0.precision, 20 / 22);
});

test('H1 is not met when nothing is flagged (precision undefined)', () => {
  const r = decide(scores({ solo: arm(0, 0), both: arm(5, 0) })).rules;
  assert.equal(r.H1.all, false);
  assert.equal(r.H2.all, true);
  assert.equal(r.H3.all, false);
});

test('H3 needs at least 10 more catches than T0 alone', () => {
  assert.equal(decide(scores({ t0: arm(5, 0), both: arm(15, 0) })).rules.H3.all, true);
  assert.equal(decide(scores({ t0: arm(5, 0), both: arm(14, 0) })).rules.H3.all, false);
});

test('H4 needs both precision >= T1 and false alarms <= T1', () => {
  assert.equal(decide(scores({ solo: arm(20, 2), t1: arm(20, 2) })).rules.H4.all, true);
  assert.equal(decide(scores({ solo: arm(20, 3), t1: arm(20, 2) })).rules.H4.all, false);
  assert.equal(decide(scores({ solo: arm(10, 1), t1: arm(30, 4) })).rules.H4.all, true, 'fewer catches, fewer false alarms and higher precision (0.909 vs 0.882) meets H4');
  assert.equal(decide(scores({ solo: arm(10, 1), t1: arm(30, 1) })).rules.H4.all, false, 'same false alarms, lower precision (0.909 vs 0.968) does not');
});

test('H5 boundary at 0.90; H6 compares v3 with v1 on the same binding', () => {
  assert.equal(decide(scores({ recall: 0.9 })).rules.H5.all, true);
  assert.equal(decide(scores({ recall: 0.899 })).rules.H5.all, false);
  assert.equal(decide(scores({ solo: arm(20, 4), v1solo: arm(20, 3) })).rules.H6.all, false);
});

test('a missing sample fails every rule for that sample instead of passing silently', () => {
  const s = scores();
  delete s.arms[`judge-v3-${M}-s2__${M}.json`];
  const r = decide(s).rules;
  for (const h of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) { assert.equal(r[h].s2.pass, false, h); assert.equal(r[h].all, false, h); }
});
