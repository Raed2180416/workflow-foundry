// Business calendar with holidays and time zones (gap G16; E-BED §2.1, §9.2 clock laws, MR3, MR8). Pure functions over a
// calendar value; every result is exact (integer milliseconds, civil dates). Oracle-side: written without reference to
// the library cards (experiments/library/cards/P58-P60) and sharing no code with them.
//
// Calendar input (BED-CONTRACT v1.1 §2 world.calendars[id]):
//   { id?, tz, businessHours, holidays?: [{ date: 'YYYY-MM-DD', name?, from?: 'HH:MM', to?: 'HH:MM' }] }
//   businessHours: '24x7'
//                | { days: [1..7], hours: [['09:00', '17:00'], ...] }          (ISO weekdays, 1 = Monday)
//                | { mon|tue|...|sun or '1'..'7': [['09:00', '12:00'], ['13:00', '17:30']] }
//   A holiday without from/to closes the whole day; with them it closes [from, to) local time (a half day). Closures on
//   one date are unioned. Intervals are local wall-clock times, end exclusive, '24:00' allowed as an end; overlapping
//   intervals within a day are refused (adjacent ones are merged).
//
// Readings (stated here once; every function follows them):
//   - business day: a date with non-zero business time after holiday closures (a half-day holiday leaves a business day;
//     a closure covering all of the day's hours does not);
//   - addBusinessDays(d, n), n > 0: the n-th business day strictly after d (d itself never counts, whether or not it is
//     a business day); n = 0 returns d unchanged; n < 0 counts backwards;
//   - businessDaysBetween(a, b): the number of business days in (a, b] (negative when b < a);
//   - business time between instants: the length of the intersection with business intervals, where a local interval
//     [s, e) on date d runs from the first instant the wall clock reads s on d to the first instant it reads e
//     (time.mjs wallStart): a spring-forward day loses the skipped hour, a fall-back day keeps the repeated hour once
//     in an interval that spans it;
//   - addBusinessMs(t, x): the earliest instant u >= t with businessMs(t, u) = x (lands on an interval end, never on
//     the next opening, when the budget runs out exactly at a close); x = 0 returns t.
import { fail } from './errors.mjs';
import { DAY, toDay, dateOf, weekdayOf, parseClock, toMs, wallStart, localParts, zoneOf } from './time.mjs';

const TAG = Symbol('ebed.calendar');
const NAMES = Object.freeze({ mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 });
const SEARCH_DAYS = 3660; // ten years: a calendar with no business time in that span is refused, never looped on
const cache = new WeakMap();

function intervalsOf(list, where) {
  if (!Array.isArray(list)) fail('CAL_INVALID', `${where}: intervals must be an array of [from, to]`);
  const iv = list.map(p => {
    if (!Array.isArray(p) || p.length !== 2) fail('CAL_INVALID', `${where}: interval must be [from, to]: ${JSON.stringify(p)}`);
    const s = parseClock(p[0]), e = parseClock(p[1], { allow24: true });
    if (!(s < e)) fail('CAL_INVALID', `${where}: interval ${p[0]}-${p[1]} is empty or reversed`);
    return [s, e];
  }).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of iv) {
    const last = out[out.length - 1];
    if (last && s < last[1]) fail('CAL_INVALID', `${where}: overlapping intervals`);
    if (last && s === last[1]) last[1] = e; else out.push([s, e]);
  }
  return out;
}

function hoursOf(bh) {
  const hours = [null, [], [], [], [], [], [], []];
  if (bh === '24x7') { for (let d = 1; d <= 7; d++) hours[d] = [[0, DAY]]; return hours; }
  if (!bh || typeof bh !== 'object' || Array.isArray(bh)) fail('CAL_INVALID', `businessHours must be '24x7' or an object`);
  if ('days' in bh || 'hours' in bh) {
    if (!Array.isArray(bh.days) || !bh.days.length) fail('CAL_INVALID', 'businessHours.days must be a non-empty array of ISO weekdays');
    const iv = intervalsOf(bh.hours, 'businessHours.hours');
    for (const d of bh.days) {
      if (!Number.isInteger(d) || d < 1 || d > 7) fail('CAL_INVALID', `bad weekday ${d}`);
      if (hours[d].length) fail('CAL_INVALID', `weekday ${d} listed twice`);
      hours[d] = iv.map(x => [...x]);
    }
    return hours;
  }
  for (const [k, v] of Object.entries(bh)) {
    const d = Object.hasOwn(NAMES, k) ? NAMES[k] : /^[1-7]$/.test(k) ? +k : fail('CAL_INVALID', `bad weekday key ${k}`);
    if (hours[d].length) fail('CAL_INVALID', `weekday ${k} listed twice`);
    hours[d] = intervalsOf(v, `businessHours.${k}`);
  }
  return hours;
}

/** Normalise and validate a calendar (memoised per input object). Returns a frozen value accepted by every function. */
export function calendar(input) {
  if (input && input[TAG]) return input;
  if (input && typeof input === 'object' && cache.has(input)) return cache.get(input);
  if (!input || typeof input !== 'object') fail('CAL_INVALID', 'calendar must be an object');
  zoneOf(input.tz);
  const hours = hoursOf(input.businessHours);
  const closures = new Map();
  for (const h of input.holidays ?? []) {
    if (!h || typeof h !== 'object') fail('CAL_INVALID', `bad holiday ${JSON.stringify(h)}`);
    const day = toDay(h.date);
    if ((h.from === undefined) !== (h.to === undefined)) fail('CAL_INVALID', `holiday ${h.date}: give both from and to, or neither`);
    const iv = h.from === undefined ? [[0, DAY]] : intervalsOf([[h.from, h.to]], `holiday ${h.date}`);
    const merged = [...(closures.get(day) ?? []), ...iv].sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [s, e] of merged) { const l = out[out.length - 1]; if (l && s <= l[1]) l[1] = Math.max(l[1], e); else out.push([s, e]); }
    closures.set(day, out);
  }
  const cal = Object.freeze({
    [TAG]: true, id: input.id ?? null, tz: input.tz,
    hours: Object.freeze(hours.map(x => (x ? Object.freeze(x.map(p => Object.freeze(p))) : x))),
    closures, hasHours: hours.some(x => x && x.length),
  });
  cache.set(input, cal);
  return cal;
}

function subtract(intervals, cuts) {
  let out = intervals.map(x => [...x]);
  for (const [cs, ce] of cuts) {
    const next = [];
    for (const [s, e] of out) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (s < cs) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    out = next;
  }
  return out;
}

/** Local business intervals of one date after holiday closures: [[fromMs, toMs]] in ms since local midnight. */
export function wallIntervals(cal, date) {
  const c = calendar(cal);
  const day = toDay(date);
  const base = c.hours[weekdayOf(day)];
  const cuts = c.closures.get(day);
  return cuts ? subtract(base, cuts) : base.map(x => [...x]);
}

export const isBusinessDay = (cal, date) => wallIntervals(cal, date).length > 0;

function step(cal, day, dir, inclusive) {
  const c = calendar(cal);
  if (!c.hasHours) fail('CAL_NO_BUSINESS_TIME', `calendar ${c.id ?? ''} has no business hours`);
  let d = inclusive ? day : day + dir;
  for (let i = 0; i <= SEARCH_DAYS; i++, d += dir) if (isBusinessDay(c, d)) return d;
  return fail('CAL_NO_BUSINESS_TIME', `no business day within ${SEARCH_DAYS} days of ${dateOf(day)}`);
}

/** The first business day after `date` (or on it, when inclusive). */
export const nextBusinessDay = (cal, date, { inclusive = false } = {}) => dateOf(step(cal, toDay(date), 1, inclusive));
/** The last business day before `date` (or on it, when inclusive). */
export const previousBusinessDay = (cal, date, { inclusive = false } = {}) => dateOf(step(cal, toDay(date), -1, inclusive));

/** The n-th business day after `date` (n > 0), before it (n < 0), or `date` itself (n = 0). */
export function addBusinessDays(cal, date, n) {
  if (!Number.isSafeInteger(n)) fail('CAL_INVALID', `business-day count must be an integer: ${n}`);
  let d = toDay(date);
  const dir = n < 0 ? -1 : 1;
  for (let k = 0; k < Math.abs(n); k++) d = step(cal, d, dir, false);
  return dateOf(d);
}

/** Number of business days in (a, b]; negative when b < a. */
export function businessDaysBetween(cal, a, b) {
  const da = toDay(a), db = toDay(b);
  if (db < da) return -businessDaysBetween(cal, b, a);
  calendar(cal);
  let n = 0;
  for (let d = da + 1; d <= db; d++) if (isBusinessDay(cal, d)) n++;
  return n;
}

/** Business-day roll of a date: 'none' | 'following' | 'preceding' | 'modifiedFollowing' | 'modifiedPreceding'. */
export function rollDate(cal, date, convention) {
  const day = toDay(date);
  const month = d => dateOf(d).slice(0, 7);
  switch (convention) {
    case 'none': return dateOf(day);
    case 'following': return nextBusinessDay(cal, day, { inclusive: true });
    case 'preceding': return previousBusinessDay(cal, day, { inclusive: true });
    case 'modifiedFollowing': { const f = nextBusinessDay(cal, day, { inclusive: true }); return f.slice(0, 7) === month(day) ? f : previousBusinessDay(cal, day, { inclusive: true }); }
    case 'modifiedPreceding': { const p = previousBusinessDay(cal, day, { inclusive: true }); return p.slice(0, 7) === month(day) ? p : nextBusinessDay(cal, day, { inclusive: true }); }
    default: return fail('CAL_INVALID', `unknown roll convention ${convention}`);
  }
}

/** Business intervals of one local date as instants [[startMs, endMs)], empty ones dropped. */
function dayInstants(c, day) {
  const out = [];
  for (const [s, e] of wallIntervals(c, day)) {
    const S = wallStart(day, s, c.tz), E = wallStart(day, e, c.tz);
    if (E > S) out.push([S, E]);
  }
  return out;
}

/** Business intervals intersecting [from, to) as instants [[startMs, endMs)], clipped, merged, ascending. */
export function businessIntervals(cal, from, to) {
  const c = calendar(cal);
  const a = toMs(from), b = toMs(to);
  if (b <= a) return [];
  const first = localParts(a, c.tz).day - 1, last = localParts(b, c.tz).day + 1;
  const out = [];
  for (let d = first; d <= last; d++) {
    for (const [S, E] of dayInstants(c, d)) {
      const s = Math.max(S, a), e = Math.min(E, b);
      if (e <= s) continue;
      const l = out[out.length - 1];
      if (l && s <= l[1]) l[1] = Math.max(l[1], e); else out.push([s, e]);
    }
  }
  return out;
}

/** Business milliseconds in [from, to); negative when to < from. */
export function businessMs(cal, from, to) {
  const a = toMs(from), b = toMs(to);
  if (b < a) return -businessMs(cal, b, a);
  let n = 0;
  for (const [s, e] of businessIntervals(cal, a, b)) n += e - s;
  return n;
}

/** The earliest instant u >= from with businessMs(from, u) = ms (ms >= 0). */
export function addBusinessMs(cal, from, ms) {
  const c = calendar(cal);
  const a = toMs(from);
  if (!Number.isSafeInteger(ms) || ms < 0) fail('CAL_INVALID', `business duration must be a non-negative integer of ms: ${ms}`);
  if (ms === 0) return a;
  if (!c.hasHours) fail('CAL_NO_BUSINESS_TIME', `calendar ${c.id ?? ''} has no business hours`);
  let acc = 0, idle = 0;
  for (let d = localParts(a, c.tz).day - 1; idle <= SEARCH_DAYS; d++) {
    const iv = dayInstants(c, d);
    let any = false;
    for (const [S, E] of iv) {
      const s = Math.max(S, a);
      if (E <= s) continue;
      any = true;
      if (acc + (E - s) >= ms) return s + (ms - acc);
      acc += E - s;
    }
    idle = any ? 0 : idle + 1;
  }
  return fail('CAL_NO_BUSINESS_TIME', `no business time within ${SEARCH_DAYS} days after ${a}`);
}

/**
 * Bind a time zone by precedence (E7: "time-zone precedence"): `candidates` maps a source name to a zone id or null;
 * the first source in `precedence` with a zone wins. Returns { tz, source }; TZ_UNBOUND when none has one.
 */
export function bindTimeZone(candidates, precedence) {
  for (const source of precedence) {
    const tz = candidates[source];
    if (tz !== undefined && tz !== null) { zoneOf(tz); return { tz, source }; }
  }
  return fail('TZ_UNBOUND', `no time zone among ${precedence.join(', ')}`);
}
