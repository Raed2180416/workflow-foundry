// Constitution v0 data and the registry's change-control gate (C3). $0, pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, INSTANCES, docHash, docProblems, renderText, rolesOf, holds, boundProblems } from '../constitution.mjs';
import { buildRegistry, practiceRegistry, verifyRegistryChain, Registry, DAY7, DAY9 } from '../registry.mjs';
import { schemaProblems } from '../../../beds/ebed/host/schema.mjs';

test('the schema is in the portable subset and v1, v2 are well formed; the planted v3 breaks the org-policy bound', () => {
  assert.deepEqual(schemaProblems(SCHEMA), []);
  assert.deepEqual(docProblems(INSTANCES.v1), []);
  assert.deepEqual(docProblems(INSTANCES.v2), []);
  const p3 = docProblems(INSTANCES.v3);
  assert.equal(p3.length, 1);
  assert.match(p3[0], /above the org-policy bound B1 .*a lower layer may only narrow/);
});

test('every clause has an owner, a layer, an assurance class, exceptions and evidence; versions chain by hash', () => {
  for (const doc of Object.values(INSTANCES)) {
    for (const id of ['C1', 'C2', 'C3']) {
      const c = doc.clauses.find(x => x.id === id);
      assert.ok(c && c.owner.role && c.owner.principal && c.layer && c.assurance.length && Array.isArray(c.exceptions) && c.evidence.length, id);
    }
  }
  assert.equal(INSTANCES.v1.supersedes, null);
  assert.equal(INSTANCES.v2.supersedes, docHash(INSTANCES.v1));
  assert.equal(INSTANCES.v3.supersedes, docHash(INSTANCES.v2));
  assert.equal(INSTANCES.v1.parameters.refundApprovalThresholdMinor, 50000);
  assert.equal(INSTANCES.v2.parameters.refundApprovalThresholdMinor, 25000);
  assert.ok(holds(INSTANCES.v3, 'u-cs1', 'controller') && !holds(INSTANCES.v2, 'u-cs1', 'controller'), 'v3 grants its own proposer the controller role');
  assert.deepEqual(rolesOf(INSTANCES.v1, 'cust:C-0007'), ['customer']);
  assert.match(renderText(INSTANCES.v2), /threshold T = 25000 minor units/);
});

test('a lower layer may only narrow: raising T above the bound is a bound problem, lowering it is not', () => {
  const up = { ...structuredClone(INSTANCES.v2), parameters: { ...INSTANCES.v2.parameters, refundApprovalThresholdMinor: 100001 } };
  const down = { ...structuredClone(INSTANCES.v2), parameters: { ...INSTANCES.v2.parameters, refundApprovalThresholdMinor: 100 } };
  assert.equal(boundProblems(up).length, 1);
  assert.deepEqual(boundProblems(down), []);
});

test('the gate accepts v1 and v2 and refuses the planted v3 with every reason', () => {
  const r = buildRegistry();
  assert.deepEqual(r.versions.map(v => v.decision), ['accepted', 'accepted', 'refused']);
  const reasons = r.byVersion(3).reasons.join(' | ');
  for (const re of [/approver u-cs1 does not hold controller under the version in force/, /approver u-cs1 is the proposer/, /proposer u-cs1 holds none of finance, controller/, /bound: C2/, /self-grant: proposer u-cs1 gains controller/]) assert.match(reasons, re);
});

test('in force: v1 until day 7, v2 from day 7 and after the planted change; nothing before 2026-01-01', () => {
  const r = buildRegistry();
  assert.equal(r.inForceAt('2025-12-31T23:59:00+01:00'), null);
  assert.equal(r.inForceAt('2026-01-01T00:00:00+01:00').version, 1);
  assert.equal(r.inForceAt('2026-03-08T23:59:59+01:00').version, 1);
  assert.equal(r.inForceAt(DAY7).version, 2);
  assert.equal(r.inForceAt(DAY9).version, 2);
  assert.equal(r.inForceAt('2026-03-16T00:00:00+01:00').version, 2);
});

test('the registry journal is hash-chained and tamper-evident', () => {
  const r = buildRegistry();
  assert.equal(verifyRegistryChain(r.journal()), true);
  const bad = r.journal();
  const gate = bad.findIndex(x => x.type === 'gate' && x.version === 3);
  bad[gate] = { ...bad[gate], decision: 'accepted', reasons: [] };
  assert.throws(() => verifyRegistryChain(bad), /chain broken/);
});

test('arm-visible files are time-gated and carry no gate decision', () => {
  const r = buildRegistry();
  const before = r.filesAt('2026-03-11T08:59:00+01:00'), after = r.filesAt('2026-03-11T09:06:00+01:00'), t0 = r.filesAt('2026-03-02T00:00:00+01:00');
  assert.equal(Object.keys(t0).filter(p => p.startsWith('constitution/versions/') && p.endsWith('.json')).length, 1);
  assert.equal(Object.keys(before).filter(p => p.startsWith('constitution/versions/v3')).length, 0);
  assert.equal(Object.keys(after).filter(p => p.startsWith('constitution/versions/v3')).length, 2);
  const log = JSON.parse(after['constitution/log.json']);
  assert.deepEqual([...new Set(log.map(x => x.type))].sort(), ['approval', 'proposed']);
  assert.ok(log.every(x => typeof x.hash === 'string' && x.hash.length === 64));
});

test('change-rule edge cases: approval after effectiveFrom, a self-approved genesis, a forked supersedes', () => {
  const late = new Registry();
  late.propose({ at: '2025-12-15T10:00:00+01:00', version: 1, doc: INSTANCES.v1, by: 'u-fin1' });
  late.approve({ at: '2026-01-02T10:00:00+01:00', version: 1, by: 'u-ctl1' });
  assert.match(late.byVersion(1).reasons.join(), /after its effectiveFrom/);
  const self = new Registry();
  self.propose({ at: '2025-12-15T10:00:00+01:00', version: 1, doc: INSTANCES.v1, by: 'u-ctl1' });
  self.approve({ at: '2025-12-16T10:00:00+01:00', version: 1, by: 'u-ctl1' });
  assert.match(self.byVersion(1).reasons.join(), /is the proposer/);
  const fork = buildRegistry({ timeline: [
    { at: '2025-12-15T10:00:00+01:00', type: 'proposed', version: 1, doc: 'v1', by: 'u-fin1' },
    { at: '2025-12-18T15:00:00+01:00', type: 'approval', version: 1, by: 'u-ctl1' },
    { at: '2026-03-05T10:00:00+01:00', type: 'proposed', version: 3, doc: 'v3', by: 'u-fin1' },
    { at: '2026-03-06T10:00:00+01:00', type: 'approval', version: 3, by: 'u-ctl1' },
  ] });
  assert.match(fork.byVersion(3).reasons.join(), /supersedes .* but the latest accepted version is/);
});

test('the practice registry differs from the grading one in every later version', () => {
  const g = buildRegistry(), p = practiceRegistry();
  assert.equal(p.byVersion(1).hash, g.byVersion(1).hash);
  assert.notEqual(p.byVersion(2).hash, g.byVersion(2).hash);
  assert.equal(p.byVersion(2).decision, 'accepted');
  assert.equal(p.byVersion(3).decision, 'refused');
  assert.notEqual(p.byVersion(2).doc.parameters.refundApprovalThresholdMinor, g.byVersion(2).doc.parameters.refundApprovalThresholdMinor);
});
