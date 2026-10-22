import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const fraud = moduleHarness('fraud');
const PLACED = '2026-03-02T10:00:00+01:00';
const files = { 'rulebook/ed-2026-01/policy.json': { customerActionHours: 48, fraudReviewHours: 24 } };
const started = () => fraud.step({ op: 'start', placedAt: PLACED, edition: 'ed-2026-01' }, { key: 'ORD-1', state: null, now: PLACED, files });
const check = (verdict, state, now = '2026-03-02T10:01:00+01:00') =>
  fraud.onEvent({ type: 'effect.result', at: now, payload: { key: 'check', system: 'fraud', op: 'check', status: 'ok', result: { verdict } } }, { key: 'ORD-1', state, now, files });

test('start emits the fraud check once', () => {
  const r = started();
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'check');
  assert.equal(r.output.state, 'checking');
});

test('pass clears the order at p; reject cancels it for fraud at p', () => {
  const pass = check('pass', started().state);
  assert.equal(pass.output.state, 'cleared');
  assert.equal(pass.output.at, PLACED);
  const reject = check('reject', started().state);
  assert.equal(reject.output.state, 'cancel');
  assert.equal(reject.output.reason, 'fraud');
});

test('review creates one task whose deadline is fraudReviewHours from now, with a wake-up after it', () => {
  const r = check('review', started().state, '2026-03-02T10:01:00+01:00');
  assert.equal(r.output.state, 'review');
  assert.equal(r.humanTasks.length, 1);
  assert.equal(r.humanTasks[0].kind, 'fraudReview');
  assert.equal(r.humanTasks[0].dueAt, '2026-03-03T10:01:00+01:00');
  assert.equal(r.obligations.upsert[0].id, 'deadline');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-03T10:02:00+01:00');
});

test('an approve exactly at the deadline counts; a later answer changes nothing', () => {
  const r = check('review', started().state, '2026-03-02T10:01:00+01:00');
  const deadline = '2026-03-03T10:01:00+01:00';
  const at = fraud.onEvent({ type: 'humanTask.answered', at: deadline, payload: { taskId: 'review-1', answer: { decision: 'approve' } } }, { key: 'ORD-1', state: r.state, now: deadline, files });
  assert.equal(at.output.state, 'cleared');
  assert.equal(at.output.at, deadline);
  const late = fraud.onEvent({ type: 'humanTask.answered', at: '2026-03-03T10:01:30+01:00', payload: { taskId: 'review-1', answer: { decision: 'reject' } } }, { key: 'ORD-1', state: r.state, now: deadline, files });
  assert.equal(late.output.state, 'review');
});

test('asking again keeps the deadline and does not extend it', () => {
  const r = check('review', started().state, '2026-03-02T10:01:00+01:00');
  const again = fraud.onEvent({ type: 'humanTask.withdrawn', at: '2026-03-02T12:00:00+01:00', payload: { taskId: 'review-1' } }, { key: 'ORD-1', state: r.state, now: '2026-03-02T12:00:00+01:00', files });
  assert.equal(again.humanTasks.length, 1);
  assert.equal(again.humanTasks[0].id, 'review-2');
  assert.equal(again.humanTasks[0].dueAt, '2026-03-03T10:01:00+01:00');
});

test('no usable answer: the deadline wake-up cancels for fraud-review-timeout', () => {
  const r = check('review', started().state, '2026-03-02T10:01:00+01:00');
  const t = fraud.onEvent({ type: 'timer.fired', at: '2026-03-03T10:02:00+01:00', payload: { obligationId: 'deadline', onDue: 'deadline' } }, { key: 'ORD-1', state: r.state, now: '2026-03-03T10:02:00+01:00', files });
  assert.equal(t.output.state, 'cancel');
  assert.equal(t.output.reason, 'fraud-review-timeout');
});

test('stop ends the review and cancels its wake-up', () => {
  const r = check('review', started().state, '2026-03-02T10:01:00+01:00');
  const s = fraud.step({ op: 'stop' }, { key: 'ORD-1', state: r.state, now: PLACED, files });
  assert.equal(s.output.state, 'stopped');
  assert.deepEqual(s.obligations.cancel, ['deadline']);
});
