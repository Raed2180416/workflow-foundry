// The OT-0 world overlay: principals, plants, the binding and the "E8 + C2 overlay" oracle. $0; in process (the
// analyst-side reference policy), no sandbox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as e8 from '../../../beds/ebed/e8/index.mjs';
import { runReference } from '../../../beds/ebed/oracle/policy.mjs';
import { hashOf } from '../../../beds/lib/canonical.mjs';
import { indexJournal, caseView } from '../../../beds/ebed/oracle/view.mjs';
import { OT0_WORLDS, baseWorld, overlayWorld, overlayBinding, overlayTransition, overlayOracle, fulfilmentAmounts, POOLS, APPROVAL_KIND } from '../overlay.mjs';
import { buildRegistry } from '../registry.mjs';

const SIZED = { seed: 1232, d: 2, size: 12 };

test('only the dev rehearsal worlds 1232-1234 are accepted', () => {
  assert.equal(OT0_WORLDS.length, 10);
  assert.throws(() => baseWorld({ seed: 1235, d: 2 }), /1232-1234/);
  assert.throws(() => baseWorld({ seed: 9101, d: 2 }), /1232-1234/);
});

test('the overlay keeps every E8 draw (world id, public id) and only adds principals, pools and its own truth', () => {
  const B = baseWorld(SIZED), before = hashOf(B);
  const W = overlayWorld(B);
  assert.equal(hashOf(B), before, 'the base world is not mutated');
  assert.equal(W.id, B.id);
  assert.equal(W.publicId, B.publicId);
  assert.deepEqual(W.actorsPool, { ...B.actorsPool, ...POOLS });
  const acts = W.arrivals.filter(a => a.type === 'customer.action');
  assert.ok(acts.length > 0 && acts.every(a => typeof a.payload.enteredBy === 'string'));
  const strip = w => ({ ...w, arrivals: w.arrivals.map(a => (a.type === 'customer.action' ? { ...a, payload: (({ enteredBy, ...p }) => p)(a.payload) } : a)), actorsPool: B.actorsPool, truth: { ...w.truth, ot0: undefined } });
  assert.equal(hashOf(strip(W)), hashOf(strip(B)), 'nothing else changes');
});

test('the planted SoD trap: on the sized world it is o0012, whose cancel u-cs1 entered', () => {
  const W = overlayWorld(baseWorld(SIZED));
  const p = W.truth.ot0.plant;
  assert.equal(p.case, 'o0012');
  assert.equal(p.thresholdMinor, 25000);
  assert.ok(p.maxAmountMinor > p.thresholdMinor);
  for (const id of p.events) assert.equal(W.truth.ot0.enteredBy[id], 'u-cs1');
  assert.equal(fulfilmentAmounts(W, 'ORD-1232-0012', W.truth.cases.o0012.placedAt)['ORD-1232-0012-F2'], 43793);
});

test('every OT-0 world has a trap of a refund-bearing class (never cancel-at-collection)', () => {
  for (const spec of OT0_WORLDS) {
    const p = overlayWorld(baseWorld(spec)).truth.ot0.plant;
    assert.ok(p && ['cancel-processing', 'amend-then-cancel'].includes(p.class), JSON.stringify(spec));
  }
});

test('the binding adds the refundApproval kind and a scripted approver; E8 analysts answer as before', () => {
  assert.ok(overlayBinding.schemas.humanTasks[APPROVAL_KIND]);
  assert.ok(overlayBinding.schemas.humanTasks.fraudReview);
  const W = overlayWorld(baseWorld(SIZED));
  const a = overlayBinding.actors.answer(W, { case: 'o0012', kind: APPROVAL_KIND, role: 'finance-approver', ordinal: 1, subject: 'ORD-1232-0012-F2' });
  assert.equal(a.value.decision, 'approve');
  assert.ok(a.delayMinutes >= 5 && a.delayMinutes <= 30);
  const ctx = { case: 'o0001', kind: 'fraudReview', role: 'fraudAnalyst', ordinal: 1 };
  assert.deepEqual(overlayBinding.actors.answer(W, ctx), e8.actors.answer(W, ctx));
});

test('the overlay is invisible to E8: the reference policy is graded identically on the base and overlay worlds', async () => {
  const B = baseWorld(SIZED), W = overlayWorld(B);
  const rb = await runReference({ item: e8.oracleItem, binding: e8.binding, world: B, timing: 'earliest' });
  const rw = await runReference({ item: e8.oracleItem, binding: overlayBinding, world: W, timing: 'earliest' });
  const vb = e8.oracle(B, rb.rows), vw = e8.oracle(W, rw.rows), vo = overlayOracle(W, rw.rows);
  assert.deepEqual(vw.cases.map(c => [c.case, c.pass, c.complete]), vb.cases.map(c => [c.case, c.pass, c.complete]));
  assert.deepEqual(vo.cases.map(c => [c.case, c.pass, c.complete]), vb.cases.map(c => [c.case, c.pass, c.complete]), 'without approval tasks the two oracles agree');
});

test('E8 + C2 overlay: the approval task is permitted and a waiting refund window runs to the answer + 120 min', async () => {
  const W = overlayWorld(baseWorld(SIZED));
  const rw = await runReference({ item: e8.oracleItem, binding: overlayBinding, world: W, timing: 'earliest' });
  const idx = indexJournal(W, rw.rows, { canonicalArgs: e8.canonicalArgs });
  const t = Date.parse(W.truth.cases.o0012.actions.find(a => a.action === 'cancel').at) + 60_000;    // just after the counted cancel
  const view = caseView(idx, 'o0012', t);
  const E0 = e8.referenceTransition(W, view), E = overlayTransition(W, view);
  assert.ok(E.humanTasks.permitted.some(p => p.kind === APPROVAL_KIND && p.role === 'finance-approver'));
  const rf0 = E0.effects.required.find(e => e.op === 'refund' && e.match.fulfilmentId === 'ORD-1232-0012-F2');
  assert.ok(rf0, 'the cancel requires the refund');
  const answered = t + 30 * 60_000;
  const fake = { ...view, tasks: [{ seq: 1, at: t, task: { id: 'ot0:C2:h1:1', kind: APPROVAL_KIND, subject: 'ORD-1232-0012-F2' } }],
    taskEvents: [{ seq: 2, at: answered, type: 'humanTask.answered', payload: { taskId: 'ot0:C2:h1:1', answer: { decision: 'approve' } } }] };
  const E1 = overlayTransition(W, fake);
  const rf1 = E1.effects.required.find(e => e.op === 'refund' && e.match.fulfilmentId === 'ORD-1232-0012-F2');
  assert.equal(rf1.window.latest, Math.max(rf0.window.latest, answered + 120 * 60_000));
  const other = E1.effects.required.find(e => e.op === 'refund' && e.match.fulfilmentId !== 'ORD-1232-0012-F2');
  if (other) assert.equal(other.window.latest, E0.effects.required.find(e => e.lid === other.lid).window.latest, 'other fulfilments keep their windows');
  const fst = E1.effects.required.find(e => e.lid === 'fst:ORD-1232-0012-F2:cancelled');
  if (fst) {
    assert.equal(fst.window.latest, E0.effects.required.find(e => e.lid === fst.lid).window.latest, 'the declared overlay leaves the status window alone');
    assert.ok(overlayTransition(W, fake, { wide: true }).effects.required.find(e => e.lid === fst.lid).window.latest >= answered + 120 * 60_000, 'the post-hoc wide variant moves it');
  }
  const open = { ...fake, taskEvents: [] };
  assert.equal(overlayTransition(W, open).effects.required.find(e => e.op === 'refund' && e.match.fulfilmentId === 'ORD-1232-0012-F2').window.latest, Date.parse(W.horizonEnd), 'an open approval defers the refund to the horizon');
});

test('the registry thresholds pinned at placement drive the plant: v1 before day 7, v2 after', () => {
  const r = buildRegistry();
  const W = overlayWorld(baseWorld({ seed: 1234, d: 2 }), { registry: r });
  const p = W.truth.ot0.plant;
  assert.equal(p.thresholdMinor, r.inForceAt(W.truth.cases[p.case].placedAt).doc.parameters.refundApprovalThresholdMinor);
});
