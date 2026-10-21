import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const review = moduleHarness('review');
const files = {
  'rulebook/ed1/edition.json': { id: 'ed1', effectiveFrom: '2026-01-01' },
  'rulebook/ed1/policy.json': { fraudReviewHours: 24, customerActionHours: 48 },
};
const p = '2026-03-02T10:00:00+01:00';
const opened = '2026-03-02T10:05:00+01:00';
const deadline = '2026-03-03T10:05:00+01:00';

function open() {
  const r = review.step({ op: 'open', orderId: 'ORD-1', p }, { key: 'ORD-1', files, now: opened });
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.deadline, deadline);
  assert.equal(r.humanTasks.length, 1);
  assert.equal(r.humanTasks[0].kind, 'fraudReview');
  assert.equal(r.humanTasks[0].role, 'fraudAnalyst');
  assert.equal(r.humanTasks[0].subject, 'ORD-1');
  return r;
}

test('opens one fraud review task whose deadline is fraudReviewHours from the task', () => {
  const r = open();
  assert.equal(r.obligations.upsert[0].id, 'deadline');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-03T10:06:00+01:00');
});

test('an approve at the deadline counts', () => {
  const r = open();
  const a = review.onEvent({ id: 'a1', type: 'humanTask.answered', at: deadline, payload: { taskId: 'rv1', answer: { decision: 'approve' } } },
    { key: 'ORD-1', state: r.state, files, now: deadline });
  assert.equal(a.output.decision, 'approve');
  assert.equal(a.output.at, deadline);
});

test('an unusable answer is re-asked as a new task, and the deadline does not move', () => {
  const r = open();
  const a = review.onEvent({ id: 'a1', type: 'humanTask.answered', at: opened, payload: { taskId: 'rv1', answer: { note: 'looks fine' } } },
    { key: 'ORD-1', state: r.state, files, now: opened });
  assert.equal(a.output.status, 'reask');
  assert.equal(a.humanTasks.length, 1);
  assert.equal(a.humanTasks[0].id, 'rv2');
  assert.equal(a.humanTasks[0].dueAt, '2026-03-03T10:06:00+01:00');
});

test('without a usable answer the decision is a timeout, taken after the deadline', () => {
  const r = open();
  const early = review.onEvent({ id: 't0', type: 'timer.fired', at: deadline, payload: { obligationId: 'deadline', onDue: 'deadline' } },
    { key: 'ORD-1', state: r.state, files, now: deadline });
  assert.equal(early.output, null, 'not before the deadline has passed');
  const late = review.onEvent({ id: 't1', type: 'timer.fired', at: '2026-03-03T10:06:00+01:00', payload: { obligationId: 'deadline', onDue: 'deadline' } },
    { key: 'ORD-1', state: r.state, files, now: '2026-03-03T10:06:00+01:00' });
  assert.equal(late.output.decision, 'timeout');
});

test('an answer after the deadline changes nothing', () => {
  const r = open();
  const timeout = review.onEvent({ id: 't1', type: 'timer.fired', at: '2026-03-03T10:06:00+01:00', payload: { obligationId: 'deadline', onDue: 'deadline' } },
    { key: 'ORD-1', state: r.state, files, now: '2026-03-03T10:06:00+01:00' });
  const a = review.onEvent({ id: 'a2', type: 'humanTask.answered', at: '2026-03-03T10:07:00+01:00', payload: { taskId: 'rv1', answer: { decision: 'approve' } } },
    { key: 'ORD-1', state: timeout.state, files, now: '2026-03-03T10:07:00+01:00' });
  assert.equal(a.output, null);
});
