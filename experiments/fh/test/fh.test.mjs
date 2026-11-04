// FH-1 unit tests ($0, no world runs): the gate, failure classes, case comparison, N-version disagreements, the sign test, the
// environment-fault rule and the freeze list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gateDecision, contractClasses, failureGroups, nversionDisagreements, ENV_FAULTS, healTask, INCIDENTS, ENSEMBLE } from '../heal.mjs';
import { compare, GRADING, PRACTICE, worldOf } from '../grade.mjs';
import { signTest } from '../analyse.mjs';
import { FROZEN } from '../freeze.mjs';
import { BUILDS } from '../baseline.mjs';

const W = '1235:d2';
const grading = (cases, armErrors = 0) => ({ worlds: [{ world: W, armErrors, cases }] });
const c = (id, { oracle = true, contracts = true, failed = [], v = {} } = {}) => ({ case: id, order: `ORD-${id}`, class: 'x', oracle, contracts, failedContracts: failed, violations: v });

test('compare: recoveries, regressions and still-failing cases, keyed by world and case', () => {
  const before = grading([c('a', { oracle: false }), c('b'), c('c', { oracle: false })]);
  const after = grading([c('a'), c('b', { oracle: false }), c('c', { oracle: false })]);
  const r = compare(before, after);
  assert.deepEqual([r.nRecovered, r.nRegressed, r.nStillFailing, r.net], [1, 1, 1, 0]);
  assert.equal(compare(before, after, { by: 'contracts' }).net, 0);
});

test('gate H-C: accepts only a strict contract improvement on practice with no regression and no new arm error', () => {
  const before = grading([c('a', { contracts: false }), c('b')]);
  assert.equal(gateDecision('H-C', { loads: true, before, after: grading([c('a'), c('b')]) }).accept, true);
  assert.match(gateDecision('H-C', { loads: true, before, after: grading([c('a'), c('b', { contracts: false })]) }).reason, /newly fail/);
  assert.match(gateDecision('H-C', { loads: true, before, after: grading([c('a', { contracts: false }), c('b')]) }).reason, /no failing practice order recovered/);
  assert.match(gateDecision('H-C', { loads: true, before, after: grading([c('a'), c('b')], 1) }).reason, /arm errors/);
  assert.equal(gateDecision('H-C', { loads: false, before, after: null }).accept, false);
});

test('gate H-N: accepts when a disagreement is settled and none is new; H-0 accepts any loading program', () => {
  const d = (o) => ({ world: W, order: o });
  const g = grading([c('a')]);
  assert.equal(gateDecision('H-N', { loads: true, before: g, after: g, nvBefore: [d('1'), d('2')], nvAfter: [d('2')] }).accept, true);
  assert.equal(gateDecision('H-N', { loads: true, before: g, after: g, nvBefore: [d('1')], nvAfter: [d('2')] }).accept, false);
  assert.equal(gateDecision('H-N', { loads: true, before: g, after: g, nvBefore: [d('1')], nvAfter: [d('1')] }).accept, false);
  assert.equal(gateDecision('H-0', { loads: true, before: g, after: g }).accept, true);
});

test('contractClasses: one class per contract, rule and normalised finding; ids, times and numbers are normalised away', () => {
  const v1 = { intake: [['R1.1', 'create missing for ORD-1235-0001 at 2026-03-02T08:00:00Z (3 items)']] };
  const v2 = { intake: [['R1.1', 'create missing for ORD-1235-0042 at 2026-03-04T09:30:00Z (5 items)']] };
  const v3 = { tracking: [['R4.4', 'status missing']] };
  const practice = grading([c('a', { contracts: false, failed: ['intake'], v: v1 }), c('b', { contracts: false, failed: ['intake'], v: v2 }), c('c', { contracts: false, failed: ['tracking'], v: v3 }), c('d')]);
  const k = contractClasses(practice, { modules: { intake: { rules: ['R1'] }, ship: { rules: ['R4.4'] } } });
  assert.equal(k.length, 2);
  assert.deepEqual([k[0].contract, k[0].rule, k[0].n], ['intake', 'R1.1', 2]);
  assert.deepEqual(k[0].owners, ['intake']);
  assert.deepEqual(k[1].owners, ['ship']);
});

test('failureGroups: classes sharing an order (transitively) form one likely cause', () => {
  const k = (...orders) => ({ orders: orders.map(order => ({ world: W, order })) });
  const g = failureGroups([k('o1', 'o2'), k('o2', 'o3'), k('o9'), k('o3')]);
  assert.deepEqual(g, [{ classes: [0, 1, 3], orders: [`${W}/o1`, `${W}/o2`, `${W}/o3`] }, { classes: [2], orders: [`${W}/o9`] }]);
});

test('nversionDisagreements: the incident is a suspect only against a strict majority', () => {
  const sig = s => ({ [W]: { o1: s } });
  const ens = { a: sig('X'), b: sig('X'), c: sig('Y') };
  assert.deepEqual(nversionDisagreements(ens, 'c').map(x => x.order), ['o1']);
  assert.deepEqual(nversionDisagreements(ens, 'a'), []);
  // no strict majority: unresolved, never a suspect
  assert.deepEqual(nversionDisagreements({ a: sig('X'), b: sig('Y') }, 'a'), []);
  // a build that never touches the order (∅) is a suspect against a majority that does
  assert.deepEqual(nversionDisagreements({ a: { [W]: {} }, b: sig('X'), c: sig('X') }, 'a').map(x => x.order), ['o1']);
});

test('signTest: exact two-sided', () => {
  assert.equal(signTest(0, 0), 1);
  assert.equal(signTest(8, 0), 2 / 256);
  assert.equal(signTest(4, 4), 1);
});

test('frozen design facts: worlds disjoint, incidents and ensemble are recorded builds, no oracle words in any task text', () => {
  const g = new Set(GRADING.map(w => w.seed)), p = new Set(PRACTICE.map(w => w.seed));
  assert.equal([...p].filter(s => g.has(s)).length, 0);
  for (const b of [...INCIDENTS, ...ENSEMBLE]) assert.ok(BUILDS[b], b);
  assert.ok(!INCIDENTS.includes('b1lh-e8-1'));
  assert.throws(() => worldOf({ seed: 1161, d: 2 }), /FH_SEED_REFUSED/);
  for (const arm of ['H-C', 'H-N', 'H-0']) for (const kind of ['composed', 'monolith']) {
    const t = healTask(arm, kind);
    assert.doesNotMatch(t, /oracle|grading world|1232|1233|1234|truth/i, `${arm} ${kind}`);
  }
  assert.deepEqual([...ENV_FAULTS].sort(), ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE']);
  assert.ok(FROZEN.includes('research/heal-20261021/PREREG-FH1.md') && FROZEN.includes('experiments/fh/heal.mjs'));
});
