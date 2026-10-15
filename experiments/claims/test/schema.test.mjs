// claim-row/0 validator and coverage ($0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyRow, validateClaimRow, validateRows, fieldCoverage, TRACKED, ORIGIN_GROUPS, policyModelIds } from '../schema.mjs';
import { ORIGINS, census, originOf } from '../origin.mjs';

/** A minimal valid derived row: every tracked field accounted for. */
function validRow() {
  const r = emptyRow();
  Object.assign(r, { id: 'x1', experiment: 'exp', arm: 'arm', run: 'run' });
  r.models = [{ role: 'executor', id: 'claude-haiku-5-5' }];
  r.harness.hashes = { runner: 'abc' };
  r.task = { key: 'bed:t1', bed: 'wbed', family: 'f', unit: 'task', split: 'dev', cases: 1 };
  const o = originOf('wbed'); r.origin = o.origin; r.fidelity = o.fidelity;
  r.evidence = { class: 'development', K: 1 };
  r.verdict = { kind: 'binary', pass: true, successes: 1, total: 1, score: 1, censored: false, excluded: false, oracle: { id: 'o', sha256: null } };
  Object.assign(r.usd, { reported: 0.01, bound: 1, charged: 0.01, observed: true, starts: 1 });
  r.timing.wallMs = 100; r.timing.timeToDoneMs = 100; r.timing.timeToFirstEffectMs = 100; r.timing.stages = [{ stage: 'call', ms: 100 }];
  r.timing.components.modelMs = 100; r.timing.components.nonModelMs = 0; r.timing.components.toolMs = 0; r.timing.components.mockMs = 0;
  r.timing.concurrency = { configured: 4, observedMax: 4 };
  r.envFaults = [];
  r.source = { adapter: 'test@0', files: [] };
  for (const f of TRACKED) r.provenance[f] = { kind: 'computed', rule: 'test' };
  for (const f of ['usd.repriced', 'usd.build', 'usd.world', 'timing.components.waits', 'timing.businessTime.simulatedMs']) r.provenance[f] = { kind: 'missing', why: 'test' };
  return r;
}

test('a complete derived row validates', () => {
  assert.deepEqual(validateClaimRow(validRow(), { modelIds: new Set(['claude-haiku-5-5']) }), []);
});

test('provenance must account for every tracked field and agree with the value', () => {
  const a = validRow(); delete a.provenance['timing.wallMs'];
  assert.ok(validateClaimRow(a).some(e => e.includes('provenance missing for timing.wallMs')));
  const b = validRow(); b.provenance['timing.wallMs'] = { kind: 'missing', why: 'no clock' };
  assert.ok(validateClaimRow(b).some(e => e.includes('marked missing but has a value')));
  const c = validRow(); c.timing.wallMs = null;
  assert.ok(validateClaimRow(c).some(e => e.includes('marked computed but has no value')));
  const d = validRow(); d.provenance['usd.world'] = { kind: 'missing' };
  assert.ok(validateClaimRow(d).some(e => e.includes('needs a why')));
  const e = validRow(); e.provenance['usd.reported'] = { kind: 'copied' };
  assert.ok(validateClaimRow(e).some(x => x.includes('needs a from')));
});

test('consistency rules: verdict counts, meter floor, timing order, origin group, model ids', () => {
  const a = validRow(); a.verdict = { ...a.verdict, kind: 'count', pass: false, successes: 5, total: 4 };
  assert.ok(validateClaimRow(a).some(e => e.includes('0 <= successes <= total')));
  const b = validRow(); b.usd.charged = 0.001;
  assert.ok(validateClaimRow(b).some(e => e.includes('usd.charged must be >= usd.reported')));
  const c = validRow(); Object.assign(c.usd, { reported: 0, charged: 0, observed: false, bound: 1 });
  assert.ok(validateClaimRow(c).some(e => e.includes('charged at least its bound')));
  const d = validRow(); d.timing.timeToFirstEffectMs = 200;
  assert.ok(validateClaimRow(d).some(e => e.includes('cannot exceed time to done')));
  const f = validRow(); f.origin = { class: 'outside-world-outside-grader', group: 'our-bed' };
  assert.ok(validateClaimRow(f).some(e => e.includes('origin.group must be third-party')));
  const g = validRow(); g.models = [{ role: 'executor', id: 'gpt-x' }];
  assert.ok(validateClaimRow(g, { modelIds: new Set(['claude-haiku-5-5']) }).some(e => e.includes('not in policy/models.json')));
  const n = validRow(); Object.assign(n.usd, { reported: 0, charged: 0, observed: false, bound: null });
  assert.ok(validateClaimRow(n).some(e => e.includes('unobserved row needs a numeric usd.bound')), 'a timeout with no bound would be booked at $0');
  const dl = validRow(); dl.timing.deadline = { ms: 300000, hit: 'yes' };
  assert.ok(validateClaimRow(dl).some(e => e.includes('timing.deadline')));
  const dk = validRow(); dk.timing.deadline = { ms: 300000, hit: false };
  assert.deepEqual(validateClaimRow(dk), []);
  const h = validRow(); h.rowKind = 'set-aside';
  assert.ok(validateClaimRow(h).some(e => e.includes('set-aside row is excluded')));
  assert.equal(validateRows([validRow(), validRow()]).length, 1, 'duplicate ids are reported');
});

test('origin classes are one table; census counts groups, excludes superseded verdicts, reports real-log zero', () => {
  assert.deepEqual(ORIGINS, ORIGIN_GROUPS);
  const a = validRow(), b = validRow(), c = validRow();
  b.id = 'x2'; const o = originOf('automationbench'); b.origin = o.origin; b.task.bed = 'automationbench';
  c.id = 'x3'; c.refs.supersededBy = 'x1';
  const cen = census([a, b, c]);
  assert.equal(cen.byGroup['our-bed'].rows, 2);
  assert.equal(cen.byGroup['our-bed'].verdictRows, 1);
  assert.equal(cen.byGroup['third-party'].verdictRows, 1);
  assert.equal(cen.byGroup['real-log'].rows, 0);
  assert.equal(cen.shares.thirdPartyVerdictRows, 0.5);
});

test('field coverage counts supplied values by provenance kind', () => {
  const cov = fieldCoverage([validRow()]);
  assert.equal(cov['timing.wallMs'].supplied, 1);
  assert.equal(cov['usd.world'].supplied, 0);
  assert.equal(cov['usd.world'].byKind.missing, 1);
});

test('policy model ids include judgment models', () => {
  const ids = policyModelIds({ models: [{ id: 'a' }], judgmentModels: [{ id: 'jev-1.13.0' }] });
  assert.ok(ids.has('a') && ids.has('jev-1.13.0'));
});
