import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const fraud = moduleHarness('fraud');
const NOW = '2026-03-02T10:00:00+01:00';
const P = '2026-03-02T09:30:00+01:00';
const files = { 'rulebook/ed-2026-1/policy.json': JSON.stringify({ customerActionHours: 4, fraudReviewHours: 24, collectionCutoffMinutes: 30 }) };
const check = verdict => ({ type: 'effect.result', at: NOW, payload: { key: 'check', system: 'fraud', op: 'check', status: 'ok', verdict } });
const started = () => fraud.step({ op: 'start', orderId: 'ORD-1', placedAt: P, edition: 'ed-2026-1' }, { key: 'ORD-1', state: null, now: NOW, files });

test('a new order is checked for fraud (R2.1)', () => {
  const r = started();
  assert.deepEqual(r.effects.map(e => `${e.system}.${e.op}`), ['fraud.check']);
  assert.equal(r.output.state, 'checking');
});

test('pass clears the order at p (R2.1)', () => {
  const r = fraud.onEvent(check('pass'), { key: 'ORD-1', state: started().state, now: NOW, files });
  assert.equal(r.output.state, 'cleared');
  assert.equal(r.output.at, P);
});

test('reject cancels for fraud (R2.1)', () => {
  const r = fraud.onEvent(check('reject'), { key: 'ORD-1', state: started().state, now: NOW, files });
  assert.equal(r.output.state, 'cancel');
  assert.equal(r.output.reason, 'fraud');
});

test('review opens one fraudReview task, due at the review deadline, and a wake-up after it (R2.2)', () => {
  const r = fraud.onEvent(check('review'), { key: 'ORD-1', state: started().state, now: NOW, files });
  assert.equal(r.humanTasks.length, 1);
  assert.equal(r.humanTasks[0].kind, 'fraudReview');
  assert.equal(r.humanTasks[0].role, 'fraudAnalyst');
  assert.equal(r.humanTasks[0].dueAt, '2026-03-03T09:00:00.000Z');
  assert.equal(r.obligations.upsert[0].id, 'deadline');
  assert.ok(Date.parse(r.obligations.upsert[0].dueAt) > Date.parse(r.humanTasks[0].dueAt));
});

const reviewing = () => fraud.onEvent(check('review'), { key: 'ORD-1', state: started().state, now: NOW, files }).state;
const answer = (decision, at) => ({ type: 'humanTask.answered', at, payload: { taskId: 'ORD-1/K/review-1', user: 'u', answer: { decision } } });

test('an approve at the deadline still counts (R2.2)', () => {
  const r = fraud.onEvent(answer('approve', '2026-03-03T09:00:00.000Z'), { key: 'ORD-1', state: reviewing(), now: '2026-03-03T09:00:00.000Z', files });
  assert.equal(r.output.state, 'cleared');
});

test('an answer after the deadline changes nothing; the timeout cancels after it (R2.2)', () => {
  const late = fraud.onEvent(answer('approve', '2026-03-03T09:00:01.000Z'), { key: 'ORD-1', state: reviewing(), now: '2026-03-03T09:00:01.000Z', files });
  assert.equal(late.output.state, 'review');
  const timeout = fraud.onEvent({ type: 'timer.fired', at: '2026-03-03T09:30:00.000Z', payload: { obligationId: 'ORD-1/K/deadline' } },
    { key: 'ORD-1', state: reviewing(), now: '2026-03-03T09:30:00.000Z', files });
  assert.equal(timeout.output.state, 'cancel');
  assert.equal(timeout.output.reason, 'fraud-review-timeout');
});

test('asking again opens a new task and keeps the deadline (R2.2, S3)', () => {
  const r = fraud.onEvent({ type: 'humanTask.answerRejected', at: NOW, payload: { taskId: 'ORD-1/K/review-1' } },
    { key: 'ORD-1', state: reviewing(), now: NOW, files });
  assert.equal(r.humanTasks[0].id, 'review-2');
  assert.equal(r.humanTasks[0].dueAt, '2026-03-03T09:00:00.000Z');
});

test('a stop from cancellation ends the review: a later answer changes nothing (R6.4)', () => {
  const s = fraud.step({ op: 'stop' }, { key: 'ORD-1', state: reviewing(), now: NOW, files });
  const r = fraud.onEvent(answer('approve', NOW), { key: 'ORD-1', state: s.state, now: NOW, files });
  assert.equal(r.output.state, 'stopped');
  assert.deepEqual(s.obligations.cancel, ['deadline']);
});
