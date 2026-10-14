// Obligation clock (gap G15; BAR-SET §3 "P60, obligation clock"; E-BED §2.8 layer 3, §9.2 clock laws). A pure function
// of a clock definition and a history of clock operations: it never schedules anything. Oracle-side; written without
// reference to the library cards (experiments/library/cards/P58-P60), sharing no code with them.
//
// Definition:  defineClock({ id, target: { amount, unit }, calendar?, warnings?: [{ id, percent }], boundary? })
//   unit       'minutes' | 'hours' (wall time) | 'business-minutes' | 'business-hours' (time inside the calendar's
//              business intervals; calendar.mjs readings). Day-count deadlines ("10 business days", "45 calendar
//              days") are not durations on a running clock: use dueByDays, which refuses pauses by construction.
//   warnings   percentages of the target (integers 1-100); threshold = floor(target * percent / 100) ms, exact.
//   boundary   'inclusive' (default): the obligation is met by a stop at or before the due instant D and breached at
//              any query time after D; 'exclusive': met only by a stop before D and breached from D on.
// History:     [{ at, op }] with op in start | pause | resume | stop | reset | cancel, in non-decreasing `at` order
//              (equal times keep list order). Retroactive operations are just operations with an earlier `at`; the
//              caller orders the history, this module refuses an unordered one (CLOCK_ORDER).
// State machine (anything else is CLOCK_ILLEGAL, or recorded as an anomaly and skipped with onIllegal: 'skip'):
//   idle --start--> running;  running --pause--> paused --resume--> running;
//   running|paused --stop--> stopped (terminal), --cancel--> cancelled (terminal),
//   --reset--> running (a new generation: elapsed and pause totals restart from zero at the reset instant).
// Readings: the due instant D is the earliest instant at which active time (running time, measured in the clock's
// unit) reaches the target; while running, D is projected assuming no further pause; while paused, D is known only if
// it was reached before the pause (else null, "unknown until resumed"). A stopped clock's outcome compares the stop
// instant with D, so a ticket stopped at 18:00 against a D of 17:00 is breached even though no business time passed
// after 17:00.
// Monotone breach (review fix, 2026-10-14; BED-CONTRACT v1.1 §5.3 "monotone clocks"): stop, cancel and reset all
// close a generation at their instant e, and a closed generation is breached iff e > D (inclusive; e >= D exclusive),
// as for stop. `breached` and `breachedAt` cover every generation, so for a fixed history `breached` never turns
// false as the query time grows: cancelling or resetting an SLA after its due instant does not erase the breach.
// Warnings reached before a cancel stay reached; a reset keeps the closed generation's record in `generations`.
// `outcome` describes the current generation only.
import { fail } from './errors.mjs';
import { toMs, MINUTE, HOUR, localDate, dayBounds, fromLocal, addCalendarDays } from './time.mjs';
import { calendar, businessMs, addBusinessMs, addBusinessDays, rollDate } from './calendar.mjs';

const UNITS = Object.freeze({ minutes: [MINUTE, false], hours: [HOUR, false], 'business-minutes': [MINUTE, true], 'business-hours': [HOUR, true] });
const NEXT = Object.freeze({
  idle: { start: 'running' },
  running: { pause: 'paused', stop: 'stopped', reset: 'running', cancel: 'cancelled' },
  paused: { resume: 'running', stop: 'stopped', reset: 'running', cancel: 'cancelled' },
  stopped: {}, cancelled: {},
});
const OPS = new Set(['start', 'pause', 'resume', 'stop', 'reset', 'cancel']);
const TAG = Symbol('ebed.clock');

/** Validate a clock definition; returns a frozen value accepted by clockAt. */
export function defineClock(def) {
  if (def && def[TAG]) return def;
  if (!def || typeof def !== 'object') fail('CLOCK_INVALID', 'clock definition must be an object');
  const { target } = def;
  if (!target || !Object.hasOwn(UNITS, target.unit)) fail('CLOCK_INVALID', `target.unit must be one of ${Object.keys(UNITS).join(', ')}`);
  if (!Number.isSafeInteger(target.amount) || target.amount <= 0) fail('CLOCK_INVALID', 'target.amount must be a positive integer');
  const [scale, business] = UNITS[target.unit];
  const targetMs = target.amount * scale;
  if (!Number.isSafeInteger(targetMs)) fail('CLOCK_INVALID', 'target too large');
  if (business && !def.calendar) fail('CLOCK_INVALID', `${target.unit} needs a calendar`);
  const boundary = def.boundary ?? 'inclusive';
  if (boundary !== 'inclusive' && boundary !== 'exclusive') fail('CLOCK_INVALID', `boundary must be inclusive or exclusive`);
  const ids = new Set();
  const warnings = (def.warnings ?? []).map(w => {
    if (!w || typeof w.id !== 'string' || ids.has(w.id)) fail('CLOCK_INVALID', `warnings need unique string ids: ${JSON.stringify(w)}`);
    ids.add(w.id);
    if (!Number.isInteger(w.percent) || w.percent < 1 || w.percent > 100) fail('CLOCK_INVALID', `warning ${w.id}: percent must be an integer 1-100`);
    return Object.freeze({ id: w.id, percent: w.percent, thresholdMs: Number((BigInt(targetMs) * BigInt(w.percent)) / 100n) });
  }).sort((a, b) => a.percent - b.percent || (a.id < b.id ? -1 : 1));
  return Object.freeze({ [TAG]: true, id: def.id ?? null, targetMs, business, cal: def.calendar ? calendar(def.calendar) : null, warnings: Object.freeze(warnings), boundary });
}

function replay(def, history, at, onIllegal) {
  if (!Array.isArray(history)) fail('CLOCK_INVALID', 'history must be an array of { at, op }');
  let last = -Infinity;
  const ops = history.map((h, index) => {
    if (!h || !OPS.has(h.op)) fail('CLOCK_INVALID', `unknown clock op ${JSON.stringify(h && h.op)}`);
    const t = toMs(h.at);
    if (t < last) fail('CLOCK_ORDER', `history out of order at index ${index}`);
    last = t;
    return { index, op: h.op, t };
  });
  const st = { state: 'idle', startedAt: null, endedAt: null, segStart: null, pauseStart: null, segments: [], pauses: [], resets: 0, anomalies: [], generations: [] };
  for (const { index, op, t } of ops) {
    if (t > at) break;
    const next = NEXT[st.state][op];
    if (!next) {
      if (onIllegal === 'skip') { st.anomalies.push({ index, op, state: st.state }); continue; }
      fail('CLOCK_ILLEGAL', `${op} is not allowed in state ${st.state} (history index ${index})`, { index, op, state: st.state });
    }
    switch (op) {
      case 'start': st.startedAt = t; st.segStart = t; break;
      case 'pause': st.segments.push([st.segStart, t]); st.segStart = null; st.pauseStart = t; break;
      case 'resume': st.pauses.push([st.pauseStart, t]); st.pauseStart = null; st.segStart = t; break;
      case 'stop': case 'cancel':
        if (st.state === 'running') st.segments.push([st.segStart, t]); else st.pauses.push([st.pauseStart, t]);
        st.segStart = null; st.pauseStart = null; st.endedAt = t; break;
      case 'reset':
        // Close the current generation at t and keep it (its breach and warnings stay reached), then start afresh.
        if (st.state === 'running') st.segments.push([st.segStart, t]); else st.pauses.push([st.pauseStart, t]);
        st.generations.push({ startedAt: st.startedAt, endedAt: t, segments: st.segments, pauses: st.pauses });
        st.segments = []; st.pauses = []; st.startedAt = t; st.segStart = t; st.pauseStart = null; st.resets += 1; break;
      default: break;
    }
    st.state = next;
  }
  return st;
}

const measureOf = (def, s, e) => (def.business ? businessMs(def.cal, s, e) : e - s);
const positionOf = (def, s, x) => (def.business ? addBusinessMs(def.cal, s, x) : s + x);

/** Earliest instant at which active time reaches `need`, or null when it cannot be known from this history. */
function reach(def, st, need) {
  let acc = 0;
  for (const [s, e] of st.segments) {
    const m = measureOf(def, s, e);
    if (acc + m >= need) return positionOf(def, s, need - acc);
    acc += m;
  }
  if (st.state === 'running') return positionOf(def, st.segStart, need - acc);
  return null;
}

/**
 * Due instant, breach and warnings of one generation. `gen` is { state, segments, segStart } (a closed generation has
 * state 'closed'); `until` is the instant its breach is judged at: the query time while it is open, its end (stop,
 * cancel or reset) once closed. breachedAt is the earliest query time at which `breached` reads true.
 */
function judge(def, gen, until) {
  const dueAt = reach(def, gen, def.targetMs);
  const inclusive = def.boundary === 'inclusive';
  const breached = dueAt !== null && (inclusive ? until > dueAt : until >= dueAt);
  const warnings = def.warnings.map(w => {
    const wAt = reach(def, gen, w.thresholdMs);
    return { id: w.id, percent: w.percent, at: wAt, reached: wAt !== null && wAt <= until };
  });
  return { dueAt, breached, breachedAt: breached ? (inclusive ? dueAt + 1 : dueAt) : null, warnings };
}

/**
 * Snapshot of a clock at instant `at` (ISO or ms), counting only history entries with at <= `at`:
 *   { id, state, startedAt, endedAt, resets, totalMs, actualElapsedMs, actualPauseMs, businessElapsedMs,
 *     businessPauseMs, targetMs, activeMs, remainingMs, dueAt, breached, breachedAt, outcome, warnings: [{ id,
 *     percent, at, reached }], generations: [{ startedAt, endedAt, dueAt, breached, breachedAt, warnings }], anomalies }
 * Instants are epoch ms; business fields are null without a calendar. Every field except `breached`, `breachedAt` and
 * `generations` describes the current generation (since the last reset). outcome (current generation):
 * 'not-started' | 'pending' | 'met' | 'breached' | 'cancelled' (a cancelled clock may still be `breached`).
 * `breached` is true iff some generation, this one included, breached by `at`; it is monotone in `at`.
 */
export function clockAt(definition, history, at, { onIllegal = 'throw' } = {}) {
  const def = defineClock(definition);
  const now = toMs(at);
  if (onIllegal !== 'throw' && onIllegal !== 'skip') fail('CLOCK_INVALID', `onIllegal must be throw or skip`);
  const st = replay(def, history, now, onIllegal);
  const segs = [...st.segments, ...(st.state === 'running' ? [[st.segStart, now]] : [])];
  const pauses = [...st.pauses, ...(st.state === 'paused' ? [[st.pauseStart, now]] : [])];
  const sumWall = xs => xs.reduce((a, [s, e]) => a + (e - s), 0);
  const sumBiz = xs => (def.cal ? xs.reduce((a, [s, e]) => a + businessMs(def.cal, s, e), 0) : null);
  const actualElapsedMs = sumWall(segs), actualPauseMs = sumWall(pauses);
  const businessElapsedMs = sumBiz(segs), businessPauseMs = sumBiz(pauses);
  const activeMs = def.business ? businessElapsedMs : actualElapsedMs;
  const started = st.state !== 'idle';
  const closed = st.state === 'stopped' || st.state === 'cancelled';
  const cur = started ? judge(def, st, closed ? st.endedAt : now) : { dueAt: null, breached: false, breachedAt: null, warnings: def.warnings.map(w => ({ id: w.id, percent: w.percent, at: null, reached: false })) };
  const generations = st.generations.map(g => ({ startedAt: g.startedAt, endedAt: g.endedAt, ...judge(def, { state: 'closed', segments: g.segments }, g.endedAt) }));
  let outcome;
  if (!started) outcome = 'not-started';
  else if (st.state === 'cancelled') outcome = 'cancelled';
  else if (st.state === 'stopped') outcome = cur.breached ? 'breached' : 'met';
  else outcome = cur.breached ? 'breached' : 'pending';
  const breachTimes = [...generations, cur].filter(g => g.breached).map(g => g.breachedAt);
  return {
    id: def.id, state: st.state, startedAt: st.startedAt, endedAt: st.endedAt, resets: st.resets,
    totalMs: started ? (st.endedAt ?? now) - st.startedAt : 0,
    actualElapsedMs, actualPauseMs, businessElapsedMs, businessPauseMs,
    targetMs: def.targetMs, activeMs, remainingMs: Math.max(0, def.targetMs - activeMs),
    dueAt: cur.dueAt, breached: breachTimes.length > 0, breachedAt: breachTimes.length ? Math.min(...breachTimes) : null,
    outcome, warnings: cur.warnings, generations, anomalies: st.anomalies,
  };
}

/**
 * A day-count deadline: n business days (calendar's business-day reading) or n calendar days after the anchor's local
 * date in the calendar's zone, optionally rolled ('none' | 'following' | 'preceding' | 'modifiedFollowing' |
 * 'modifiedPreceding'; calendar days only), due at the end of that local day (its last millisecond, inclusive: any
 * instant on the due date is on time; review fix, it was the last whole second) or at a given local time 'HH:MM'.
 * Returns { date, dueAt } (dueAt in epoch ms).
 */
export function dueByDays(cal, anchor, n, { unit = 'business', roll = 'none', at = 'end-of-day' } = {}) {
  const c = calendar(cal);
  if (!Number.isSafeInteger(n) || n < 0) fail('CLOCK_INVALID', `day count must be a non-negative integer: ${n}`);
  const anchorDate = typeof anchor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? anchor : localDate(anchor, c.tz);
  let date;
  if (unit === 'business') {
    if (roll !== 'none') fail('CLOCK_INVALID', 'a business-day count lands on a business day; roll applies to calendar days');
    date = addBusinessDays(c, anchorDate, n);
  } else if (unit === 'calendar') date = rollDate(c, addCalendarDays(anchorDate, n), roll);
  else fail('CLOCK_INVALID', `unit must be business or calendar, not ${unit}`);
  const dueAt = at === 'end-of-day' ? dayBounds(date, c.tz).end - 1 : fromLocal(date, at, c.tz);
  return { date, dueAt };
}
