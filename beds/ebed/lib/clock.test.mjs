// Unit tests for clock.mjs: hand-derived obligation-clock timelines on a New York business calendar with Thanksgiving
// (Thu 2026-11-26 closed) and a half day (Fri 2026-11-27, 09:00-13:00). No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineClock, clockAt, dueByDays } from './clock.mjs';
import { formatInstant, parseInstant, HOUR, MINUTE } from './time.mjs';
import { codeOf } from './errors.mjs';

const NY = 'America/New_York';
const AP = { id: 'ap', tz: NY, businessHours: { days: [1, 2, 3, 4, 5], hours: [['09:00', '17:00']] },
  holidays: [{ date: '2026-11-26' }, { date: '2026-11-27', from: '13:00', to: '17:00' }, { date: '2026-12-25' }] };
const fmt = ms => (ms === null ? null : formatInstant(ms, NY));
const T = s => `2026-11-${s}-05:00`;
const SLA8 = { id: 'resolve', target: { amount: 8, unit: 'business-hours' }, calendar: AP, warnings: [{ id: 'w75', percent: 75 }, { id: 'w50', percent: 50 }] };

test('running clock: due instant, warnings, inclusive and exclusive breach', () => {
  const h = [{ at: T('24T15:00:00'), op: 'start' }];
  // 8 business hours from Tue 15:00: Tue 15-17 (2) + Wed 09-15 (6) -> Wed 15:00. 50% = 4 h -> Wed 11:00; 75% -> 13:00.
  const s = clockAt(SLA8, h, T('25T12:00:00'));
  assert.equal(fmt(s.dueAt), '2026-11-25T15:00:00-05:00');
  assert.deepEqual(s.warnings.map(w => [w.id, fmt(w.at), w.reached]), [['w50', '2026-11-25T11:00:00-05:00', true], ['w75', '2026-11-25T13:00:00-05:00', false]]);
  assert.deepEqual([s.state, s.outcome, s.breached], ['running', 'pending', false]);
  assert.equal(s.businessElapsedMs, 5 * HOUR);
  assert.equal(s.activeMs, 5 * HOUR);
  assert.equal(s.remainingMs, 3 * HOUR);
  assert.equal(s.actualElapsedMs, 21 * HOUR); // Tue 15:00 -> Wed 12:00
  assert.equal(s.totalMs, 21 * HOUR);
  assert.equal(clockAt(SLA8, h, T('25T15:00:00')).breached, false); // inclusive: due by 15:00
  assert.deepEqual([clockAt(SLA8, h, T('25T15:00:01')).breached, clockAt(SLA8, h, T('25T15:00:01')).outcome], [true, 'breached']);
  assert.equal(clockAt({ ...SLA8, boundary: 'exclusive' }, h, T('25T15:00:00')).breached, true);
  assert.equal(clockAt(SLA8, h, T('24T14:00:00')).outcome, 'not-started'); // history after the query time is ignored
});

test('stopped clock: outcome compares the stop instant with the due instant', () => {
  const start = { at: T('24T15:00:00'), op: 'start' };
  const met = clockAt(SLA8, [start, { at: T('25T15:00:00'), op: 'stop' }], T('30T09:00:00'));
  assert.deepEqual([met.state, met.outcome, met.breached, met.activeMs, fmt(met.endedAt)], ['stopped', 'met', false, 8 * HOUR, '2026-11-25T15:00:00-05:00']);
  const late = clockAt(SLA8, [start, { at: T('25T15:01:00'), op: 'stop' }], T('30T09:00:00'));
  assert.deepEqual([late.outcome, late.breached, late.activeMs], ['breached', true, 8 * HOUR + MINUTE]);
  assert.equal(clockAt({ ...SLA8, boundary: 'exclusive' }, [start, { at: T('25T15:00:00'), op: 'stop' }], T('30T09:00:00')).outcome, 'breached');
  // Stopped after hours: 8 business hours from Mon 09:00 are reached at 17:00; a stop at 18:00 is late although no
  // business time passed after 17:00.
  const after = clockAt(SLA8, [{ at: T('23T09:00:00'), op: 'start' }, { at: T('23T18:00:00'), op: 'stop' }], T('24T09:00:00'));
  assert.deepEqual([fmt(after.dueAt), after.activeMs, after.remainingMs, after.outcome], ['2026-11-23T17:00:00-05:00', 8 * HOUR, 0, 'breached']);
  const early = clockAt(SLA8, [start, { at: T('25T10:00:00'), op: 'stop' }], T('30T09:00:00'));
  assert.deepEqual([early.dueAt, early.outcome, early.warnings.map(w => w.reached)], [null, 'met', [false, false]]);
});

test('pause and resume across a holiday and a half day', () => {
  const h = [{ at: T('24T15:00:00'), op: 'start' }, { at: T('25T10:00:00'), op: 'pause' }, { at: T('27T10:00:00'), op: 'resume' }];
  // Paused on Thanksgiving: 3 business hours used (Tue 2 + Wed 1); due unknown while paused.
  const p = clockAt(SLA8, h, T('26T12:00:00'));
  assert.deepEqual([p.state, p.dueAt, p.outcome, p.activeMs, p.remainingMs], ['paused', null, 'pending', 3 * HOUR, 5 * HOUR]);
  assert.equal(p.actualElapsedMs, 19 * HOUR); // Tue 15:00 -> Wed 10:00
  assert.equal(p.actualPauseMs, 26 * HOUR); // Wed 10:00 -> Thu 12:00
  assert.equal(p.businessPauseMs, 7 * HOUR); // Wed 10-17; Thursday closed
  assert.equal(p.totalMs, 45 * HOUR);
  assert.deepEqual(p.warnings.map(w => [w.id, w.at]), [['w50', null], ['w75', null]]);
  // Resumed Fri 10:00 with 5 h left: Fri 10-13 (3), Mon 09-11 (2) -> Mon 11:00.
  const r = clockAt(SLA8, h, T('27T10:00:00'));
  assert.equal(fmt(r.dueAt), '2026-11-30T11:00:00-05:00');
  assert.equal(r.businessPauseMs, 8 * HOUR); // + Fri 09-10
  assert.deepEqual(r.warnings.map(w => fmt(w.at)), ['2026-11-27T11:00:00-05:00', '2026-11-27T13:00:00-05:00']); // 4 h, 6 h
  assert.equal(clockAt(SLA8, h, T('30T11:00:00')).breached, false);
  assert.equal(clockAt(SLA8, h, T('30T11:00:01')).breached, true);
  // Pausing never brings the due instant forward: without the pause it was Wed 15:00.
  assert.ok(r.dueAt > parseInstant(T('25T15:00:00')));
});

test('reset, cancel, wall-clock targets across DST', () => {
  const reset = clockAt(SLA8, [{ at: T('23T09:00:00'), op: 'start' }, { at: T('24T09:00:00'), op: 'reset' }], T('24T10:00:00'));
  assert.deepEqual([reset.resets, fmt(reset.startedAt), reset.activeMs, reset.totalMs, fmt(reset.dueAt)], [1, '2026-11-24T09:00:00-05:00', HOUR, HOUR, '2026-11-24T17:00:00-05:00']);
  const cancelled = clockAt(SLA8, [{ at: T('23T09:00:00'), op: 'start' }, { at: T('23T10:00:00'), op: 'cancel' }], '2026-12-31T00:00:00-05:00');
  assert.deepEqual([cancelled.outcome, cancelled.breached, cancelled.dueAt, cancelled.warnings.map(w => w.at)], ['cancelled', false, null, [null, null]]);
  // 24 wall-clock hours from Sat 2026-03-07 12:00 EST end at Sun 13:00 EDT (the day has 23 hours).
  const wall = clockAt({ target: { amount: 24, unit: 'hours' } }, [{ at: '2026-03-07T12:00:00-05:00', op: 'start' }], '2026-03-07T13:00:00-05:00');
  assert.equal(formatInstant(wall.dueAt, NY), '2026-03-08T13:00:00-04:00');
  assert.equal(wall.businessElapsedMs, null); // no calendar
  const mins = clockAt({ target: { amount: 90, unit: 'minutes' } }, [{ at: '2026-03-07T12:00:00Z', op: 'start' }, { at: '2026-03-07T12:30:00Z', op: 'pause' }, { at: '2026-03-07T14:00:00Z', op: 'resume' }], '2026-03-07T14:00:00Z');
  assert.equal(formatInstant(mins.dueAt, 'UTC'), '2026-03-07T15:00:00+00:00');
});

test('illegal operations, ordering and definitions are refused', () => {
  const t = T('24T15:00:00');
  assert.equal(codeOf(() => clockAt(SLA8, [{ at: t, op: 'pause' }], t)), 'CLOCK_ILLEGAL');
  assert.equal(codeOf(() => clockAt(SLA8, [{ at: t, op: 'start' }, { at: t, op: 'start' }], t)), 'CLOCK_ILLEGAL');
  assert.equal(codeOf(() => clockAt(SLA8, [{ at: t, op: 'start' }, { at: t, op: 'stop' }, { at: t, op: 'resume' }], t)), 'CLOCK_ILLEGAL');
  assert.equal(codeOf(() => clockAt(SLA8, [{ at: t, op: 'start' }, { at: T('24T14:00:00'), op: 'stop' }], t)), 'CLOCK_ORDER');
  assert.equal(codeOf(() => clockAt(SLA8, [{ at: t, op: 'hold' }], t)), 'CLOCK_INVALID');
  const skip = clockAt(SLA8, [{ at: t, op: 'pause' }, { at: t, op: 'start' }, { at: t, op: 'resume' }], T('24T16:00:00'), { onIllegal: 'skip' });
  assert.deepEqual([skip.state, skip.activeMs, skip.anomalies], ['running', HOUR, [{ index: 0, op: 'pause', state: 'idle' }, { index: 2, op: 'resume', state: 'running' }]]);
  for (const bad of [
    { target: { amount: 8, unit: 'business-hours' } }, { target: { amount: 0, unit: 'hours' } }, { target: { amount: 1.5, unit: 'hours' } },
    { target: { amount: 8, unit: 'days' } }, { ...SLA8, warnings: [{ id: 'a', percent: 0 }] }, { ...SLA8, warnings: [{ id: 'a', percent: 50 }, { id: 'a', percent: 60 }] },
    { ...SLA8, boundary: 'half-open' },
  ]) assert.equal(codeOf(() => defineClock(bad)), 'CLOCK_INVALID', JSON.stringify(bad.target));
  // Thresholds are exact: 33% of 8 h = 9,504,000 ms (floor of 2.64 h).
  assert.equal(defineClock({ ...SLA8, warnings: [{ id: 'w', percent: 33 }] }).warnings[0].thresholdMs, 9504000);
});

test('day-count deadlines: business and calendar days, rolls, end of day', () => {
  const d = (anchor, n, o) => { const r = dueByDays(AP, anchor, n, o); return [r.date, fmt(r.dueAt)]; };
  // 10 business days after Fri 2026-11-20 (Thanksgiving skipped) -> Mon 2026-12-07, due by 23:59:59 local.
  assert.deepEqual(d('2026-11-20T15:00:00-05:00', 10), ['2026-12-07', '2026-12-07T23:59:59-05:00']);
  assert.deepEqual(d('2026-11-21T02:00:00Z', 10), ['2026-12-07', '2026-12-07T23:59:59-05:00']); // = Fri 21:00 in New York
  // The anchor's date is taken in the calendar's zone (mutant K6 survivor -> this golden): 2026-11-24T03:00Z is Mon
  // 22:00 in New York; from Mon 23: 24 25 27 30 1 2 3 4 7 8 -> Tue Dec 8 (from the UTC date, Tue 24, it would be Dec 9).
  assert.deepEqual(d('2026-11-24T03:00:00Z', 10), ['2026-12-08', '2026-12-08T23:59:59-05:00']);
  assert.deepEqual(d('2026-11-20T15:00:00-05:00', 10, { at: '17:00' }), ['2026-12-07', '2026-12-07T17:00:00-05:00']);
  assert.deepEqual(d('2026-11-20', 45, { unit: 'calendar' }), ['2027-01-04', '2027-01-04T23:59:59-05:00']);
  assert.deepEqual(d('2026-10-02', 30, { unit: 'calendar' }), ['2026-11-01', '2026-11-01T23:59:59-05:00']); // a Sunday, 25-hour day
  assert.deepEqual(d('2026-10-02', 30, { unit: 'calendar', roll: 'following' }), ['2026-11-02', '2026-11-02T23:59:59-05:00']);
  assert.deepEqual(d('2026-10-01', 30, { unit: 'calendar', roll: 'modifiedFollowing' }), ['2026-10-30', '2026-10-30T23:59:59-04:00']); // Sat 31 -> Fri 30
  assert.equal(codeOf(() => dueByDays(AP, '2026-11-20', 10, { roll: 'following' })), 'CLOCK_INVALID');
  assert.equal(codeOf(() => dueByDays(AP, '2026-11-20', -1)), 'CLOCK_INVALID');
  assert.equal(codeOf(() => dueByDays(AP, '2026-11-20', 1, { unit: 'weeks' })), 'CLOCK_INVALID');
});
