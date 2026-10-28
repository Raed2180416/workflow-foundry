import test from 'node:test';
import assert from 'node:assert';
import { moduleHarness } from '../compose-kit/kit.mjs';

const fraud = moduleHarness('fraud');
const files = { 'rulebook/r1/policy.json': { customerActionHours: 48, fraudReviewHours: 24 } };
const P = '2026-03-02T10:00:00+01:00';
const key = 'ORD-1';

test('start asks the fraud service for a check of the order', () => {
  const r = fraud.step({ op: 'start' }, { key, state: null, now: P, files });
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 1);
  assert.deepEqual([r.effects[0].system, r.effects[0].op, r.effects[0].args], ['fraud', 'check', { orderId: key }]);
});

test('pass clears the order at the placement time (R2.1)', () => {
  const s = fraud.step({ op: 'start' }, { key, state: null, now: P, files }).state;
  const r = fraud.step({ op: 'verdict', verdict: 'pass', at: P, edition: 'r1' }, { key, state: s, now: P, files });
  assert.deepEqual(r.output.outcome, { kind: 'cleared', at: P });
});

test('reject cancels for fraud at the placement time (R2.1)', () => {
  const s = fraud.step({ op: 'start' }, { key, state: null, now: P, files }).state;
  const r = fraud.step({ op: 'verdict', verdict: 'reject', at: P, edition: 'r1' }, { key, state: s, now: P, files });
  assert.deepEqual(r.output.outcome, { kind: 'rejected', at: P, reason: 'fraud' });
});

test('review opens one task whose deadline is fraudReviewHours from its creation (R2.2)', () => {
  const now = '2026-03-02T10:01:00+01:00';
  const s = fraud.step({ op: 'start' }, { key, state: null, now: P, files }).state;
  const r = fraud.step({ op: 'verdict', verdict: 'review', at: P, edition: 'r1' }, { key, state: s, now, files });
  assert.equal(r.violations.length, 0);
  assert.equal(r.humanTasks.length, 1);
  const t = r.humanTasks[0];
  assert.equal(t.id, 'review-1');
  assert.equal(t.kind, 'fraudReview');
  assert.equal(t.role, 'fraudAnalyst');
  assert.equal(t.subject, key);
  assert.equal(t.dueAt, '2026-03-03T10:01:00+01:00');
  assert.equal(r.obligations.upsert[0].id, 'review-deadline');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-03T11:01:00+01:00');
});

test('an approve before the deadline clears the order; the timer is then withdrawn', () => {
  const now = '2026-03-02T10:01:00+01:00';
  let s = fraud.step({ op: 'start' }, { key, state: null, now: P, files }).state;
  s = fraud.step({ op: 'verdict', verdict: 'review', at: P, edition: 'r1' }, { key, state: s, now, files }).state;
  const r = fraud.onEvent({ type: 'humanTask.answered', at: '2026-03-02T12:00:00+01:00', payload: { taskId: 'review-1', answer: { decision: 'approve' } } },
    { key, state: s, now: '2026-03-02T12:00:00+01:00', files });
  assert.deepEqual(r.output.outcome, { kind: 'cleared', at: '2026-03-02T12:00:00+01:00' });
  assert.deepEqual(r.obligations.cancel, ['review-deadline']);
});

test('an answer without a decision is unusable: ask again with a new task id, the deadline does not move', () => {
  const now = '2026-03-02T10:01:00+01:00';
  let s = fraud.step({ op: 'start' }, { key, state: null, now: P, files }).state;
  s = fraud.step({ op: 'verdict', verdict: 'review', at: P, edition: 'r1' }, { key, state: s, now, files }).state;
  const r = fraud.onEvent({ type: 'humanTask.answered', at: '2026-03-02T12:00:00+01:00', payload: { taskId: 'review-1', answer: { text: 'looks fine' } } },
    { key, state: s, now: '2026-03-02T12:00:00+01:00', files });
  assert.equal(r.humanTasks.length, 1);
  assert.equal(r.humanTasks[0].id, 'review-2');
  assert.equal(r.humanTasks[0].dueAt, '2026-03-03T10:01:00+01:00');
  assert.equal(r.output.outcome, null);
});

test('no usable answer by the deadline: rejected for fraud-review-timeout at the timer (R2.2)', () => {
  const now = '2026-03-02T10:01:00+01:00';
  let s = fraud.step({ op: 'start' }, { key, state: null, now: P, files }).state;
  s = fraud.step({ op: 'verdict', verdict: 'review', at: P, edition: 'r1' }, { key, state: s, now, files }).state;
  const fire = '2026-03-03T11:01:00+01:00';
  const r = fraud.onEvent({ type: 'timer.fired', payload: { obligationId: 'review-deadline' } }, { key, state: s, now: fire, files });
  assert.deepEqual(r.output.outcome, { kind: 'rejected', at: fire, reason: 'fraud-review-timeout' });
  const late = fraud.onEvent({ type: 'humanTask.answered', at: '2026-03-03T12:00:00+01:00', payload: { taskId: 'review-1', answer: { decision: 'approve' } } },
    { key, state: r.state, now: '2026-03-03T12:00:00+01:00', files });
  assert.equal(late.output.outcome, null);
});
