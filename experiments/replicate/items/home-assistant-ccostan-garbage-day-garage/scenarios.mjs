// The scenarios: scripted people and devices (garage doors, phone taps) against a fresh mock Home Assistant, each with the
// expected trace written next to it as plain data. A scenario is a pure function of (seed, split, difficulty): the seed moves the
// day and time of day, the opening times and the margins; the kinds of situation are fixed: 15 core scenarios and 4 reliability probes (T3 only).
//
// Timing margins: every door or phone event is at least 2 s away from every wake-up the reference handler schedules (the closest pair is the
// 1-2 s flap in wed-reopen-restarts-run), so no scenario depends on how a tie between a person and a timer is broken. The tolerance is +-1 s,
// so the windows never overlap. Verified for all seeds, both splits, difficulties 1, 3, 5 by item.test.mjs (margin test).
import { rng } from '../../../../beds/lib/rng.mjs';
import { SPEC } from './spec.mjs';
import { E } from './trace.mjs';

const A = SPEC.announceOffsets;                       // [30, 90, 180]
const DEBOUNCE = SPEC.debounceSeconds;
const BASE_MONDAY = Date.UTC(2026, 9, 5);             // Monday 2026-10-05
const IDX = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const dateOf = (wd, week) => new Date(BASE_MONDAY + (IDX[wd] + 7 * week) * 86400000).toISOString().slice(0, 10);
const hms = s => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const morning = rn => hms(rn.int(6 * 3600, 21 * 3600 + 3599));
// Local start such that midnight falls `m` seconds into the scenario, on the evening of weekday `wd`.
const beforeMidnight = (wd, week, m) => `${dateOf(wd, week)}T${hms(86400 - m)}`;

const cover = (t, door, state) => ({ t, do: 'cover', door, state });
const tap = (t, key) => ({ t, do: 'tap', button: SPEC.buttons[key] });
const foreign = (t, action) => ({ t, do: 'foreign_action', action });
const externalSnooze = (t, seconds) => ({ t, do: 'timer_start', seconds });
const open = (t, door) => cover(t, door, 'open');
const close = (t, door) => cover(t, door, 'closed');
const sequence = (R, wd, announcements = A.length) => [E.push(R, wd), E.speech(R, wd), ...A.slice(0, announcements).map(a => E.announce(R + a, wd))];
const snooze = (t, key) => [E.timerStart(t, key), E.logbook(t, key)];
const other = door => (door === 'large' ? 'small' : 'large');

// Each core builder: (rn, week, door) -> {start, script, until, expect, faults?}. R is the instant the reminder starts.
const CORE = [
  ['mon-open', 'Monday: the door opens and stays open; it is not a garbage day.', (rn, week, door) => {
    const o = rn.int(3, 9);
    return { start: `${dateOf('mon', week)}T${morning(rn)}`, script: [open(o, door)], until: o + 420, expect: [] };
  }],
  ['wed-flap', 'Wednesday: the door flaps open for 10-15 s three times; it never stays open for 20 s.', (rn, week, door) => {
    const o = rn.int(3, 9), d1 = rn.int(10, 15), d2 = rn.int(10, 15), d3 = rn.int(10, 15), g1 = rn.int(8, 20), g2 = rn.int(8, 20);
    const t2 = o + d1 + g1, t3 = t2 + d2 + g2;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), close(o + d1, door), open(t2, door), close(t2 + d2, door), open(t3, door), close(t3 + d3, door)], until: t3 + d3 + 400, expect: [] };
  }],
  ['wed-full', 'Wednesday: the door opens and stays open. Push and speech, then three announcements.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door)], until: R + 240, expect: sequence(R, 'wed') };
  }],
  ['sun-full', 'Sunday: the same, and the message does not mention recycling.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('sun', week)}T${morning(rn)}`, script: [open(o, door)], until: R + 240, expect: sequence(R, 'sun') };
  }],
  ['wed-stop-then-reopen', 'Wednesday: the door closes after the first announcement and is closed at the second check, so the run ends; it reopens before the third check would have been due and a new reminder starts 20 s later.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE, c = R + rn.int(40, 80), r = R + rn.int(165, 175), R2 = r + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), close(c, door), open(r, door)], until: R2 + 240, expect: [...sequence(R, 'wed', 1), ...sequence(R2, 'wed')] };
  }],
  ['wed-close-before-first', 'Wednesday: the door closes 8-20 s after the reminder started, before the first announcement is due.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), close(R + rn.int(8, 20), door)], until: R + 240, expect: sequence(R, 'wed', 0) };
  }],
  ['wed-snooze30-then-expiry', 'Wednesday: Snooze 30m is tapped between the first and the second announcement; a reopening inside the half hour is ignored; one after the snooze ran out starts a new reminder.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE, X = R + rn.int(40, 80);
    const c1 = R + rn.int(195, 240), r1 = c1 + rn.int(20, 60);       // the door stays open through the checks the snooze is meant to cancel
    const c2 = X + 1800 + rn.int(60, 300), r2 = c2 + rn.int(30, 100), R3 = r2 + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), tap(X, '30m'), close(c1, door), open(r1, door), close(c2, door), open(r2, door)], until: R3 + 240, expect: [...sequence(R, 'wed', 1), ...snooze(X, '30m'), ...sequence(R3, 'wed')] };
  }],
  ['sun-snooze2h', 'Sunday: Snooze 2h is tapped between the second and the third announcement; a reopening about an hour later is ignored; one after two hours starts a new reminder.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE, X = R + rn.int(100, 170);
    const c1 = R + rn.int(195, 240), r1 = X + rn.int(3000, 4000);
    const c2 = X + 7200 + rn.int(100, 400), r2 = c2 + rn.int(30, 120), R4 = r2 + DEBOUNCE;
    return { start: `${dateOf('sun', week)}T${morning(rn)}`, script: [open(o, door), tap(X, '2h'), close(c1, door), open(r1, door), close(c2, door), open(r2, door)], until: R4 + 240, expect: [...sequence(R, 'sun', 2), ...snooze(X, '2h'), ...sequence(R4, 'sun')] };
  }],
  ['wed-snooze-after-run-ended', 'Wednesday: the run is already over (door closed early) when Snooze 30m is tapped on the old notification; the snooze must still be recorded and a reopening afterwards is ignored.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE, c = R + rn.int(8, 20), X = R + rn.int(250, 400), r = X + rn.int(40, 120);
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), close(c, door), tap(X, '30m'), open(r, door)], until: r + DEBOUNCE + 300, expect: [...sequence(R, 'wed', 0), ...snooze(X, '30m')] };
  }],
  ['wed-external-snooze', 'Wednesday: something else (another automation) starts the shared snooze timer between the first and the second announcement; the next check sees it running and the run ends.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE, X = R + rn.int(40, 80);
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), externalSnooze(X, 600)], until: R + 400, expect: sequence(R, 'wed', 1) };
  }],
  ['wed-midnight-ends-sequence', 'Wednesday evening: midnight falls between the first and the second announcement; the day is no longer a garbage day at the second check.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE, m = R + rn.int(35, 85);
    return { start: beforeMidnight('wed', week, m), script: [open(o, door)], until: R + 240, expect: sequence(R, 'wed', 1) };
  }],
  ['tue-midnight-starts-wed', 'Tuesday night: the door opens before midnight and the 20 s debounce ends after it; the day is judged when the reminder would start.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE, m = o + rn.int(4, 16);
    return { start: beforeMidnight('tue', week, m), script: [open(o, door)], until: R + 240, expect: sequence(R, 'wed') };
  }],
  ['wed-reopen-restarts-run', 'Wednesday: the door closes for 1-2 s and reopens while the first run is still waiting for its first announcement; a new reminder starts and the old run must not announce.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE, c = R + rn.int(2, 3), r = c + rn.int(1, 2), R2 = r + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), close(c, door), open(r, door)], until: R2 + 240, expect: [...sequence(R, 'wed', 0), ...sequence(R2, 'wed')] };
  }],
  ['wed-foreign-phone-action', 'Wednesday: other apps\' notification actions arrive during the sequence (one named almost like a snooze); they change nothing.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), foreign(R + rn.int(35, 80), 'URI_OPEN_DOORBELL'), foreign(R + rn.int(100, 170), 'SNOOZE_GARBAGE_REMINDERS_1H')], until: R + 240, expect: sequence(R, 'wed') };
  }],
  ['wed-two-doors', 'Wednesday: the second door opens (the group stays open) and the first closes; the group is still open at every check.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door), open(R + rn.int(10, 20), other(door)), close(R + rn.int(40, 80), door), close(R + 300, other(door))], until: R + 400, expect: sequence(R, 'wed') };
  }],
];

// Reliability probes (T3 only): the core "wed-full" / "sun-full" timeline with one service in an outage window. A failed call is
// not retried; the rest of the sequence goes ahead on schedule. The original stops at the first failed action.
const PROBES = [
  ['p1-speech-outage', 'Wednesday: the inside speech call fails. Push and the three announcements still happen.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door)], until: R + 240, faults: [{ service: 'script.speech_engine', from: R - 1.5, to: R + 1.5 }], expect: sequence(R, 'wed').filter(e => e.norm.service !== 'script.speech_engine') };
  }],
  ['p2-first-announcement-outage', 'Sunday: the first Alexa announcement fails. The second and third still happen.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('sun', week)}T${morning(rn)}`, script: [open(o, door)], until: R + 240, faults: [{ service: 'notify.alexa_media_garage', from: R + A[0] - 1.5, to: R + A[0] + 1.5 }], expect: sequence(R, 'sun').filter(e => e.t !== R + A[0]) };
  }],
  ['p3-push-outage', 'Wednesday: the phone push fails. Speech and the three announcements still happen.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('wed', week)}T${morning(rn)}`, script: [open(o, door)], until: R + 240, faults: [{ service: 'script.notify_engine_two_button', from: R - 1.5, to: R + 1.5 }], expect: sequence(R, 'wed').filter(e => e.norm.service !== 'script.notify_engine_two_button') };
  }],
  ['p4-alexa-down-then-up', 'Sunday: Alexa is down for the first two announcements and back for the third.', (rn, week, door) => {
    const o = rn.int(3, 9), R = o + DEBOUNCE;
    return { start: `${dateOf('sun', week)}T${morning(rn)}`, script: [open(o, door)], until: R + 240, faults: [{ service: 'notify.alexa_media_garage', from: R + A[0] - 2, to: R + A[1] + 5 }], expect: sequence(R, 'sun').filter(e => e.t === R || e.t === R + A[2]) };
  }],
];

const FOREIGN_POOL = ['URI_OPEN_DOORBELL', 'ALARM_SILENCE', 'REPLY_TO_MESSAGE', 'THERMOSTAT_AWAY', 'OPEN_GARAGE_LARGE'];

function build(table, { seed, split, difficulty }, kind) {
  return table.map(([id, summary, fn]) => {
    const rn = rng('ha-garbage', split, seed, id);
    const week = rn.int(0, 25), door = rn.pick(['large', 'small']);
    const sc = fn(rn, week, door);
    // difficulty > 1 adds notification actions from other apps at random instants; they never change the expectation.
    const extra = [];
    for (let i = 0; i < difficulty - 1; i++) extra.push(foreign(rn.int(1, Math.floor(sc.until) - 1), rn.pick(FOREIGN_POOL)));
    const script = [...sc.script, ...extra].sort((a, b) => a.t - b.t);
    return { id, kind, summary, start: sc.start, until: sc.until, script, faults: sc.faults ?? [], expect: [...sc.expect].sort((a, b) => a.t - b.t) };
  });
}

export function scenariosFor({ seed, split = 'dev', difficulty = 3 }) {
  return { core: build(CORE, { seed, split, difficulty }, 'core'), probes: build(PROBES, { seed, split, difficulty }, 'probe') };
}
export const CORE_IDS = CORE.map(c => c[0]);
export const PROBE_IDS = PROBES.map(c => c[0]);

// Worked examples for the T2 task: a different data set (fixed dates, different structure). Their expectations are NOT used by the
// oracle; the example traces are produced by running the reference handler (see examples.mjs), so they cannot drift from the env.
export function exampleScenarios() {
  const mk = (id, summary, start, script, until) => ({ id, kind: 'example', summary, start, until, script, faults: [], expect: [] });
  return [
    mk('ex-thursday', 'Thursday evening: the small door opens and stays open.', '2026-10-15T18:42:10', [open(7, 'small')], 400),
    mk('ex-sunday', 'Sunday morning: the small door opens and stays open.', '2026-11-08T09:05:30', [open(7, 'small')], 300),
    mk('ex-wed-snooze-2h', 'Wednesday: Snooze 2h is tapped during the sequence; the door closes and reopens inside the snooze.', '2026-11-04T16:20:00', [open(5, 'large'), tap(70, '2h'), close(100, 'large'), open(400, 'large')], 700),
    mk('ex-wed-flap-then-close', 'Wednesday: two short flaps, then the door stays open and is closed after the first announcement.', '2026-11-11T07:55:45', [open(4, 'large'), close(15, 'large'), open(29, 'large'), close(41, 'large'), open(60, 'large'), close(140, 'large')], 400),
  ];
}
