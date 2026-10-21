import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const fr = moduleHarness('fraud');
const K = 'ORD-1';
const PLACED = '2026-03-02T10:00:00+01:00';
const files = { 'rulebook/ED1/policy.json': { customerActionHours: 72, fraudReviewHours: 24 } };
const result = (verdict) => ({ type: 'effect.result', at: '2026-03-02T10:01:00+01:00', payload: { key: 'check', system: 'fraud', op: 'check', status: 'ok', result: { verdict } } });

function started() {
  const r = fr.step({ op: 'start', orderId: K, placedAt: PLACED, edition: 'ED1' }, { key: K, state: null, now: PLACED, files });
  return r;
}

test('start reads the verdict once (R2.1)', () => {
  const r = started();
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'check');
  assert.equal(r.output.state, 'checking');
  assert.equal(started().effects.length, 1);
  assert.equal(fr.step({ op: 'start', orderId: K, placedAt: PLACED, edition: 'ED1' }, { key: K, state: r.state, now: PLACED, files }).effects.length, 0);
});

test('pass clears at the placement time; reject cancels for fraud (R2.1)', () => {
  const s = started().state;
  const pass = fr.onEvent(result('pass'), { key: K, state: s, now: '2026-03-02T10:01:00+01:00', files });
  assert.equal(pass.output.state, 'cleared');
  assert.equal(pass.output.at, PLACED);
  const rej = fr.onEvent(result('reject'), { key: K, state: s, now: '2026-03-02T10:01:00+01:00', files });
  assert.equal(rej.output.state, 'cancel');
  assert.equal(rej.output.reason, 'fraud');
});

test('review: one task, deadline fraudReviewHours from its creation, wake-up after the deadline (R2.2)', () => {
  const s = started().state;
  const now = '2026-03-02T10:01:00+01:00';
  const r = fr.onEvent(result('review'), { key: K, state: s, now, files });
  assert.equal(r.humanTasks.length, 1);
  assert.equal(r.humanTasks[0].id, 'review-1');
  assert.equal(r.humanTasks[0].kind, 'fraudReview');
  assert.equal(r.humanTasks[0].dueAt, '2026-03-03T10:01:00+01:00');
  assert.equal(r.obligations.upsert[0].id, 'deadline');
  assert.ok(Date.parse(r.obligations.upsert[0].dueAt) > Date.parse(r.humanTasks[0].dueAt));
  return r;
});

test('an approve exactly at the deadline counts; a later one changes nothing', () => {
  const r = fr.onEvent(result('review'), { key: K, state: started().state, now: '2026-03-02T10:01:00+01:00', files }).state;
  const dl = '2026-03-03T10:01:00+01:00';
  const at = { type: 'humanTask.answered', at: dl, payload: { taskId: 'review-1', answer: { decision: 'approve' } } };
  const ok = fr.onEvent(at, { key: K, state: r, now: dl, files });
  assert.equal(ok.output.state, 'cleared');
  assert.equal(ok.output.at, dl);
  const late = { type: 'humanTask.answered', at: '2026-03-03T10:02:00+01:00', payload: { taskId: 'review-1', answer: { decision: 'reject' } } };
  assert.equal(fr.onEvent(late, { key: K, state: r, now: '2026-03-03T10:02:00+01:00', files }).output.state, 'review');
});

test('no usable answer: cleared at the deadline when the wake-up fires; a free-text answer asks again with the same deadline', () => {
  const r = fr.onEvent(result('review'), { key: K, state: started().state, now: '2026-03-02T10:01:00+01:00', files }).state;
  const free = { type: 'humanTask.answered', at: '2026-03-02T11:00:00+01:00', payload: { taskId: 'review-1', answer: { text: 'looks fine' } } };
  const again = fr.onEvent(free, { key: K, state: r, now: '2026-03-02T11:00:00+01:00', files });
  assert.equal(again.humanTasks[0].id, 'review-2');
  assert.equal(again.humanTasks[0].dueAt, '2026-03-03T10:01:00+01:00');
  const fired = fr.onEvent({ type: 'timer.fired', at: '2026-03-03T11:01:00+01:00', payload: { obligationId: 'deadline' } },
    { key: K, state: again.state, now: '2026-03-03T11:01:00+01:00', files });
  assert.equal(fired.output.state, 'cleared');
  assert.equal(fired.output.at, '2026-03-03T10:01:00+01:00');
  assert.equal(fired.output.reason, null);
});

test('the wake-up is after the deadline and within R4.1 of it, so the clearing never acts at the deadline (R2.2)', () => {
  const r = fr.onEvent(result('review'), { key: K, state: started().state, now: '2026-03-02T10:01:00+01:00', files });
  const deadlineMs = Date.parse(r.humanTasks[0].dueAt);
  const wakeMs = Date.parse(r.obligations.upsert[0].dueAt);
  assert.ok(wakeMs > deadlineMs);
  assert.ok(wakeMs <= deadlineMs + 60 * 60000);
});

test('after the timeout clearing, a later answer changes nothing', () => {
  const r = fr.onEvent(result('review'), { key: K, state: started().state, now: '2026-03-02T10:01:00+01:00', files }).state;
  const fired = fr.onEvent({ type: 'timer.fired', at: '2026-03-03T10:31:00+01:00', payload: { obligationId: 'deadline' } },
    { key: K, state: r, now: '2026-03-03T10:31:00+01:00', files });
  assert.equal(fired.output.state, 'cleared');
  const late = { type: 'humanTask.answered', at: '2026-03-03T10:00:00+01:00', payload: { taskId: 'review-1', answer: { decision: 'reject' } } };
  assert.equal(fr.onEvent(late, { key: K, state: fired.state, now: '2026-03-03T10:31:00+01:00', files }).output.state, 'cleared');
});

test('stop (R6.4) closes the review: a later answer changes nothing', () => {
  const r = fr.onEvent(result('review'), { key: K, state: started().state, now: '2026-03-02T10:01:00+01:00', files }).state;
  const stopped = fr.step({ op: 'stop' }, { key: K, state: r, now: '2026-03-02T10:30:00+01:00', files });
  assert.equal(stopped.output.state, 'stopped');
  const ans = { type: 'humanTask.answered', at: '2026-03-02T10:40:00+01:00', payload: { taskId: 'review-1', answer: { decision: 'approve' } } };
  assert.equal(fr.onEvent(ans, { key: K, state: stopped.state, now: '2026-03-02T10:40:00+01:00', files }).output.state, 'stopped');
});
