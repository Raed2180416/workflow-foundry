import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decide, circuitBreaker, Lineage } from '../promote.mjs';
import { clone, digest } from '../ir.mjs';
import { world, skipReason } from './helpers.mjs';

const ver = (over = {}) => ({ schema: 'heal-verification/1', ok: true, pending: false, rejectCode: null, lintDebtOpen: false, costRatio: 1, stages: [{ id: 'V0', ok: true }], ...over });
const prop = (ops, over = {}) => ({ kind: 'defect', ops, ...over });

test('decide(): a pure function of the verification record', () => {
  assert.deepEqual(decide(ver(), prop([{ op: 'add_check' }])), { decision: 'promote', reasons: [] });
  assert.deepEqual(decide(ver({ rejectCode: 'HEAL_REGRESSION', ok: false }), prop([])), { decision: 'reject', reasons: ['HEAL_REGRESSION'] });
  assert.equal(decide(ver({ ok: false }), prop([])).decision, 'reject');
  assert.equal(decide(null, prop([])).decision, 'reject');
  const pend = decide(ver({ ok: false, pending: true, stages: [{ id: 'V7', ok: null, code: 'HEAL_FRESH_NOT_RUN' }] }), prop([]));
  assert.deepEqual(pend, { decision: 'pending', reasons: ['V7:HEAL_FRESH_NOT_RUN'] });
  assert.equal(decide(ver({ rejectCode: 'HEAL_EXHAUSTED', ok: false }), prop([])).decision, 'exhausted');
  assert.equal(decide(ver({ partial: true }), prop([{ op: 'add_check' }])).decision, 'pending', 'a stage subset can never promote');
  assert.equal(decide(ver(), prop([], { depth: 4 })).decision, 'exhausted');
  // review, never auto-promotion
  assert.equal(decide(ver(), prop([{ op: 'relax_check' }])).decision, 'owner-review');
  assert.equal(decide(ver(), prop([{ op: 'escalate_class', class: 'F' }])).decision, 'owner-review');
  assert.equal(decide(ver(), prop([{ op: 'escalate_class', class: 'L' }])).decision, 'promote');
  assert.equal(decide(ver({ costRatio: 1.3 }), prop([{ op: 'add_check' }])).decision, 'owner-review');
  assert.equal(decide(ver({ costRatio: 1.25 }), prop([{ op: 'add_check' }])).decision, 'promote');
  assert.equal(decide(ver(), prop([{ op: 'strengthen_acceptance', via: 'check' }], { kind: 'lint-debt' })).decision, 'owner-review');
  assert.equal(decide(ver(), prop([{ op: 'strengthen_acceptance', via: 'verify' }], { kind: 'lint-debt' })).decision, 'promote');
  assert.equal(decide(ver({ lintDebtOpen: true }), prop([{ op: 'add_check' }])).decision, 'blocked');
  assert.equal(decide(ver({ lintDebtOpen: true }), prop([{ op: 'gate_verify' }], { kind: 'lint-debt' })).decision, 'promote', 'lint debt itself may leave debt open');
  assert.equal(decide(ver(), prop([{ op: 'add_check' }]), { autoPromote: false }).decision, 'owner-review');
  const a = decide(ver(), prop([{ op: 'add_check' }])), b = decide(clone(ver()), prop([{ op: 'add_check' }]));
  assert.deepEqual(a, b, 'deterministic');
});

test('circuitBreaker: three failures in a row, success <= 0.5 after 5 uses, mismatches above the parent, probe regression, canary', () => {
  const U = (...p) => p.map(x => ({ pass: !!x, mismatch: false }));
  assert.equal(circuitBreaker(U(1, 1, 1, 1, 1)).rollback, false);
  assert.match(circuitBreaker(U(1, 0, 0, 0)).reason, /3 consecutive/);
  assert.equal(circuitBreaker(U(1, 1, 0, 0, 1)).rollback, false, 'two failures in a row, 3/5 successes');
  assert.match(circuitBreaker(U(0, 0, 1, 0, 0)).reason, /success 1\/5/);
  assert.equal(circuitBreaker(U(0, 0, 1, 0, 1)).rollback, true);
  assert.equal(circuitBreaker(U(1, 0, 1, 0)).rollback, false, 'fewer than 5 uses');
  const mm = [1, 1, 1, 1, 1].map((p, i) => ({ pass: true, mismatch: i < 2 }));
  assert.match(circuitBreaker(mm, [{ pass: true, mismatch: false }]).reason, /mismatch/);
  assert.equal(circuitBreaker(mm, mm).rollback, false, 'not above the parent');
  assert.equal(circuitBreaker(U(1), [], { probeRegression: true }).rollback, true);
  assert.match(circuitBreaker(U(1), [], { canaryAccepted: true }).reason, /canary/);
});

test('Lineage: compare-and-swap promotion, lineage record, rollback to the parent content, owner approval', { skip: skipReason }, async () => {
  const { kit, wf } = await world();
  const dir = mkdtempSync(path.join(tmpdir(), 'heal-lineage-')), file = path.join(dir, 'lineage.jsonl');
  const lineage = new Lineage({ kit, dir: path.join(dir, 'state'), file });
  try {
    const base = wf.codefix, head0 = lineage.open(base);
    assert.equal(head0.created, true); assert.equal(head0.hash, digest(base), 'the kit store addresses a workflow by the same digest');
    assert.equal(lineage.open(base).created, false);
    const cand = clone(base); cand.version = 2; cand.nodes.find(n => n.id === 'fix').instructions += '\nExtra.';
    const proposal = { id: 'p1', kind: 'defect', ops: [{ op: 'edit_instructions' }], workflow: cand, proposer: { modelId: 'claude-haiku-5-5', class: 'M', briefHash: 'b' }, waivers: [], probes: [] };
    const verification = ver({ baseHash: head0.hash, candidateHash: digest(cand), costUsd: 0.01, stages: [{ id: 'V0', ok: true }] });
    assert.throws(() => lineage.promote({ proposal: { ...proposal, base: { hash: 'some-other-base' } }, verification, decision: { decision: 'promote' } }), /HEAL_BASE_MISMATCH/, 'a proposal is bound to the base it was verified against');
    assert.throws(() => lineage.promote({ proposal, verification, decision: { decision: 'owner-review' } }), /HEAL_NOT_PROMOTABLE/);
    assert.throws(() => lineage.promote({ proposal, verification: { ...verification, candidateHash: 'x' }, decision: { decision: 'promote' } }), /HEAL_CANDIDATE_CHANGED/);
    const r = lineage.promote({ proposal, verification, decision: decide(verification, proposal), kitHash: kit.kitHash, lintPin: { commit: '13f7664' }, policyHash: 'p' });
    assert.equal(r.version, 2); assert.equal(r.parentHash, head0.hash); assert.equal(lineage.head(base.id).hash, r.hash);
    // a second proposal verified against the old head loses the swap
    const cand2 = clone(base); cand2.version = 2; cand2.nodes.find(n => n.id === 'fix').instructions += '\nOther.';
    assert.throws(() => lineage.promote({ proposal: { ...proposal, id: 'p2', workflow: cand2 }, verification: { ...verification, candidateHash: digest(cand2) }, decision: { decision: 'promote' } }), /STALE_WORKFLOW/);
    const lines = lineage.lines();
    assert.equal(lines.length, 1); assert.equal(lines[0].type, 'promote'); assert.equal(lines[0].parentHash, head0.hash); assert.equal(lines[0].newHash, r.hash); assert.equal(lines[0].proposer.modelId, 'claude-haiku-5-5');
    assert.equal(lineage.depthOf(base.id), 1);
    // breaker -> rollback restores the parent's content as a new version
    for (const pass of [1, 0, 0, 0]) lineage.recordUse(r.hash, { pass: !!pass, mismatch: false });
    const ev = lineage.evaluate({ id: base.id, parentHash: head0.hash });
    assert.equal(ev.rollback, true); assert.equal(ev.rolledBack.version, 3);
    const restored = lineage.head(base.id).workflow;
    assert.deepEqual({ ...restored, version: 1 }, base, 'the parent content is back');
    assert.equal(lineage.lines().at(-1).type, 'rollback');
    // owner review queue: no head change until an explicit approval with an owner name
    const cand3 = clone(restored); cand3.version = 4; cand3.nodes.find(n => n.id === 'fix').instructions += '\nReviewed.';
    const p3 = { id: 'p3', kind: 'defect', ops: [{ op: 'relax_check' }], workflow: cand3, proposer: { mechanical: ['x'] } }, v3 = ver({ baseHash: lineage.head(base.id).hash, candidateHash: digest(cand3) });
    const d3 = decide(v3, p3); assert.equal(d3.decision, 'owner-review');
    lineage.queueReview({ proposal: p3, verification: v3, decision: d3 });
    assert.equal(lineage.head(base.id).workflow.version, 3);
    assert.throws(() => lineage.approveReview({ proposal: p3, verification: v3, owner: '' }), /HEAL_OWNER_REQUIRED/);
    assert.equal(lineage.approveReview({ proposal: p3, verification: v3, owner: 'owner' }).version, 4);
    assert.deepEqual(lineage.lines().map(l => l.type), ['promote', 'rollback', 'review', 'promote']);
    assert.ok(existsSync(file));
  } finally { lineage.close(); }
});
