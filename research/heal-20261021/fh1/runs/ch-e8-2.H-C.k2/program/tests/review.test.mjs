import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const review = moduleHarness('review');
const NOW = '2026-03-02T10:00:00+01:00';
const opened = () => review.step({ op: 'open', orderId: 'ORD-1', reviewHours: 24 }, { key: 'ORD-1', state: null, now: NOW });

test('R2.2: the review task has the analyst role, the order as subject, and the answer schema', () => {
  const r = opened();
  assert.equal(r.violations.length, 0);
  assert.equal(r.humanTasks.length, 1);
  const t = r.humanTasks[0];
  assert.equal(t.kind, 'fraudReview');
  assert.equal(t.role, 'fraudAnalyst');
  assert.equal(t.subject, 'ORD-1');
  assert.equal(t.dueAt, '2026-03-03T09:01:00.000Z');
  assert.deepEqual(t.answerSchema.properties.decision.enum, ['approve', 'reject']);
});

test('R2.2: an approve before the deadline is the decision, and the deadline timer is cancelled', () => {
  const s = opened();
  const r = review.onEvent({ type: 'humanTask.answered', at: '2026-03-02T12:00:00+01:00', payload: { taskId: 'task-1', answer: { decision: 'approve' } } },
    { key: 'ORD-1', state: s.state, now: '2026-03-02T12:00:00+01:00' });
  assert.equal(r.output.phase, 'approved');
  assert.deepEqual(r.obligations.cancel, ['deadline']);
});

test('R2.2: an unusable answer is asked again with a new task id and the same deadline', () => {
  const s = opened();
  const r = review.onEvent({ type: 'humanTask.answered', at: '2026-03-02T12:00:00+01:00', payload: { taskId: 'task-1', answer: { note: 'looks fine' } } },
    { key: 'ORD-1', state: s.state, now: '2026-03-02T12:00:00+01:00' });
  assert.equal(r.output.phase, 'reask');
  assert.equal(r.humanTasks.length, 1);
  assert.equal(r.humanTasks[0].id, 'task-2');
  assert.equal(r.humanTasks[0].dueAt, '2026-03-03T09:01:00.000Z');
});

test('R2.2: no usable answer by the deadline times the review out (cancel)', () => {
  const s = opened();
  const r = review.onEvent({ type: 'timer.fired', at: '2026-03-03T10:01:00+01:00', payload: { obligationId: 'deadline', onDue: 'deadline' } },
    { key: 'ORD-1', state: s.state, now: '2026-03-03T10:01:00+01:00' });
  assert.equal(r.output.phase, 'timed-out');
});

test('R2.2: an answer after the deadline changes nothing (timed out)', () => {
  const s = opened();
  const r = review.onEvent({ type: 'humanTask.answered', at: '2026-03-03T10:30:00+01:00', payload: { taskId: 'task-1', answer: { decision: 'reject' } } },
    { key: 'ORD-1', state: s.state, now: '2026-03-03T10:30:00+01:00' });
  assert.equal(r.output.phase, 'timed-out');
});
