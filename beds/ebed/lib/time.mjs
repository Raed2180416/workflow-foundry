// Instants, civil dates and time zones for the E-bed oracle-side libraries (E-BED §2.1, §9.2 clock laws; gap G16).
//
// Representation (the same as the E-bed host, beds/ebed/host/time.mjs, without sharing its code):
//   instant  integer epoch milliseconds inside; ISO 8601 with an explicit offset ('2026-03-08T03:30:00-04:00') at the
//            interface. A string without an offset is refused: a bare local time names no instant.
//   date     a civil date 'YYYY-MM-DD'; internally a day number (days since 1970-01-01, proleptic Gregorian).
//
// Time zones come from a pinned rule table, not from the host's ICU data: the oracle must give byte-identical results
// on every machine and Node version, and tzdata releases change. Each named zone is a standard offset plus one of four
// daylight-saving rules, valid for instants whose local (wall-clock) date lies in 2020-2037 (rules unchanged in that
// span for every listed zone; outside it the zone throws TZ_RANGE), including both edge days: 2020-01-01 and
// 2037-12-31 have full day bounds and business time (review fix: they threw because the year was probed on a
// neighbouring instant). The end of 2037-12-31 (24:00) is computable although that instant's own local date is
// 2038-01-01. UTC and fixed offsets ('UTC+05:30') are valid for 1900-2199. The tests compare every zone with Intl over
// 2020-2037 (differential, skipped when Intl lacks the zone).
//
// Local-to-instant disambiguation follows the Temporal proposal's names: 'compatible' (a time in a spring-forward gap
// moves later by the gap; a time in a fall-back fold takes the earlier instant), 'earlier', 'later', 'reject'. Interval
// endpoints use `wallStart`: the first instant at which the local wall clock reads at least the given time (a time in
// a gap maps to the transition instant), which is what "business hours 09:00-17:00" means on a transition day.
import { fail } from './errors.mjs';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const YEAR_MIN = 1900, YEAR_MAX = 2199;
const RULE_YEAR_MIN = 2020, RULE_YEAR_MAX = 2037;

const pad = (n, w = 2) => String(n).padStart(w, '0');
const mod = (a, n) => ((a % n) + n) % n;

// ---------------------------------------------------------------------------------------------------------------------
// Civil dates

/** Days in month m (1-12) of year y. */
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Day number of a civil date. */
export const dayNumber = (y, m, d) => Date.UTC(y, m - 1, d) / DAY;
/** ISO weekday of a day number: 1 = Monday ... 7 = Sunday (1970-01-01, day 0, was a Thursday). */
export const weekdayOf = day => mod(day + 3, 7) + 1;

/** Parse 'YYYY-MM-DD' to a day number; refuses impossible dates. */
export function parseDate(text) {
  const m = typeof text === 'string' ? DATE.exec(text) : null;
  if (!m) fail('DATE_INVALID', `not a date YYYY-MM-DD: ${JSON.stringify(text)}`);
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < YEAR_MIN || y > YEAR_MAX || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) fail('DATE_INVALID', `impossible date ${text}`);
  return dayNumber(y, mo, d);
}

/** Day number -> 'YYYY-MM-DD'. */
export function dateOf(day) {
  if (!Number.isSafeInteger(day)) fail('DATE_INVALID', `not a day number: ${day}`);
  const t = new Date(day * DAY);
  const y = t.getUTCFullYear();
  if (y < YEAR_MIN || y > YEAR_MAX) fail('DATE_INVALID', `day ${day} outside ${YEAR_MIN}-${YEAR_MAX}`);
  return `${y}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** A date string or a day number -> day number. */
export function toDay(x) {
  if (typeof x === 'number') { dateOf(x); return x; }
  return parseDate(x);
}

/** Calendar-day arithmetic on dates: 'YYYY-MM-DD' + n days. */
export const addCalendarDays = (date, n) => {
  if (!Number.isSafeInteger(n)) fail('DATE_INVALID', `day count must be an integer: ${n}`);
  return dateOf(toDay(date) + n);
};

/** Parse a wall-clock time 'HH:MM' or 'HH:MM:SS' to milliseconds since local midnight. '24:00' only when allowed. */
export function parseClock(text, { allow24 = false } = {}) {
  const m = typeof text === 'string' ? CLOCK.exec(text) : null;
  if (!m) fail('TIME_INVALID', `not a wall-clock time HH:MM[:SS]: ${JSON.stringify(text)}`);
  const h = +m[1], mi = +m[2], s = m[3] === undefined ? 0 : +m[3];
  if (allow24 && h === 24 && mi === 0 && s === 0) return DAY;
  if (h > 23 || mi > 59 || s > 59) fail('TIME_INVALID', `impossible wall-clock time ${text}`);
  return h * HOUR + mi * MINUTE + s * SECOND;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instants

/** Parse an ISO 8601 date-time with an explicit offset (or Z) to epoch milliseconds. */
export function parseInstant(text) {
  const m = typeof text === 'string' ? ISO.exec(text) : null;
  if (!m) fail('TIME_INVALID', `not an ISO date-time with offset: ${JSON.stringify(text)}`);
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = m[6] === undefined ? 0 : +m[6];
  const frac = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  if (y < YEAR_MIN || y > YEAR_MAX || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) {
    fail('TIME_INVALID', `impossible date-time ${text}`);
  }
  let off = 0;
  if (m[8] !== 'Z') {
    const oh = +m[8].slice(1, 3), om = +m[8].slice(4, 6);
    if (oh > 18 || om > 59) fail('TIME_INVALID', `impossible offset in ${text}`);
    off = (m[8][0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  return Date.UTC(y, mo - 1, d, h, mi, s, frac) - off * MINUTE;
}

/** An ISO string or an epoch-ms integer -> epoch ms. Never compares strings: '...T10:00+02:00' < '...T09:00Z'. */
export function toMs(x) {
  if (typeof x === 'number') {
    if (!Number.isSafeInteger(x)) fail('TIME_INVALID', `not an integer epoch-ms instant: ${x}`);
    return x;
  }
  return parseInstant(x);
}

/** Latest / earliest of several instants (ISO or ms), as epoch ms ("the later of" anchors). */
export const laterOf = (...xs) => { if (!xs.length) fail('TIME_INVALID', 'laterOf of nothing'); return Math.max(...xs.map(toMs)); };
export const earlierOf = (...xs) => { if (!xs.length) fail('TIME_INVALID', 'earlierOf of nothing'); return Math.min(...xs.map(toMs)); };
export const compareInstants = (a, b) => Math.sign(toMs(a) - toMs(b));

// ---------------------------------------------------------------------------------------------------------------------
// Time zones

const nthSunday = (y, m, n) => { const first = dayNumber(y, m, 1); return first + mod(7 - weekdayOf(first), 7) + 7 * (n - 1); };
const lastSunday = (y, m) => { const last = dayNumber(y, m, daysInMonth(y, m)); return last - mod(weekdayOf(last), 7); };

// Daylight-saving rules: each returns { start, end } as UTC epoch ms of the transitions into and out of DST for local
// year y, for a zone with standard offset `std` (minutes east of UTC); every listed rule saves 60 minutes.
//   US  (Energy Policy Act 2005, since 2007): second Sunday of March 02:00 standard -> first Sunday of November 02:00 daylight
//   EU  (Directive 2000/84/EC): last Sunday of March 01:00 UTC -> last Sunday of October 01:00 UTC
//   AU  (NSW, VIC, ACT, TAS since 2008): first Sunday of October 02:00 standard -> first Sunday of April 03:00 daylight
//   NZ  (since 2007): last Sunday of September 02:00 standard -> first Sunday of April 03:00 daylight
const RULES = Object.freeze({
  US: (y, std) => ({ start: nthSunday(y, 3, 2) * DAY + 2 * HOUR - std * MINUTE, end: nthSunday(y, 11, 1) * DAY + 2 * HOUR - (std + 60) * MINUTE }),
  EU: (y) => ({ start: lastSunday(y, 3) * DAY + 1 * HOUR, end: lastSunday(y, 10) * DAY + 1 * HOUR }),
  AU: (y, std) => ({ start: nthSunday(y, 10, 1) * DAY + 2 * HOUR - std * MINUTE, end: nthSunday(y, 4, 1) * DAY + 3 * HOUR - (std + 60) * MINUTE }),
  NZ: (y, std) => ({ start: lastSunday(y, 9) * DAY + 2 * HOUR - std * MINUTE, end: nthSunday(y, 4, 1) * DAY + 3 * HOUR - (std + 60) * MINUTE }),
});
const SAVE = 60;

/** Named zones: [standard offset in minutes east of UTC, DST rule or null]. Valid for local years 2020-2037. */
export const ZONES = Object.freeze({
  'America/New_York': [-300, 'US'], 'America/Toronto': [-300, 'US'], 'America/Chicago': [-360, 'US'],
  'America/Denver': [-420, 'US'], 'America/Phoenix': [-420, null], 'America/Los_Angeles': [-480, 'US'],
  'America/Anchorage': [-540, 'US'], 'Pacific/Honolulu': [-600, null], 'America/Sao_Paulo': [-180, null],
  'Europe/London': [0, 'EU'], 'Europe/Dublin': [0, 'EU'], 'Europe/Lisbon': [0, 'EU'],
  'Europe/Paris': [60, 'EU'], 'Europe/Berlin': [60, 'EU'], 'Europe/Amsterdam': [60, 'EU'], 'Europe/Brussels': [60, 'EU'],
  'Europe/Zurich': [60, 'EU'], 'Europe/Madrid': [60, 'EU'], 'Europe/Rome': [60, 'EU'], 'Europe/Warsaw': [60, 'EU'],
  'Europe/Stockholm': [60, 'EU'], 'Europe/Helsinki': [120, 'EU'], 'Europe/Athens': [120, 'EU'],
  'Africa/Johannesburg': [120, null], 'Asia/Dubai': [240, null], 'Asia/Kolkata': [330, null],
  'Asia/Singapore': [480, null], 'Asia/Shanghai': [480, null], 'Asia/Hong_Kong': [480, null],
  'Asia/Tokyo': [540, null], 'Asia/Seoul': [540, null], 'Australia/Brisbane': [600, null],
  'Australia/Sydney': [600, 'AU'], 'Australia/Melbourne': [600, 'AU'], 'Pacific/Auckland': [720, 'NZ'],
});

const FIXED = /^UTC([+-])(\d{2}):(\d{2})$/;
const zoneCache = new Map();
/** Resolve a zone id to { id, std, rule, bounded }. Throws TZ_UNKNOWN for anything not in the table. */
export function zoneOf(tz) {
  if (zoneCache.has(tz)) return zoneCache.get(tz);
  let z;
  if (tz === 'UTC' || tz === 'Etc/UTC') z = { id: tz, std: 0, rule: null, bounded: false };
  else if (typeof tz === 'string' && FIXED.test(tz)) {
    const [, sign, hh, mm] = FIXED.exec(tz);
    if (+hh > 18 || +mm > 59) fail('TZ_UNKNOWN', `impossible fixed offset ${tz}`);
    z = { id: tz, std: (sign === '-' ? -1 : 1) * (+hh * 60 + +mm), rule: null, bounded: false };
  } else if (typeof tz === 'string' && Object.hasOwn(ZONES, tz)) {
    const [std, rule] = ZONES[tz];
    z = { id: tz, std, rule, bounded: true };
  } else fail('TZ_UNKNOWN', `time zone not in the pinned table: ${JSON.stringify(tz)}`);
  zoneCache.set(tz, Object.freeze(z));
  return zoneCache.get(tz);
}

function checkYear(z, y) {
  if (y < YEAR_MIN || y > YEAR_MAX) fail('TZ_RANGE', `year ${y} outside ${YEAR_MIN}-${YEAR_MAX}`);
  if (z.bounded && (y < RULE_YEAR_MIN || y > RULE_YEAR_MAX)) fail('TZ_RANGE', `${z.id}: local year ${y} outside the pinned rule span ${RULE_YEAR_MIN}-${RULE_YEAR_MAX}`);
}

// Offset of zone z at instant t under the DST rule of `ruleYear`, without a range check. No listed rule has a
// transition within two months of 1 January, so the rules of two adjacent years agree on instants near the new year:
// evaluating either is exact there.
function ruleOffset(z, t, ruleYear) {
  if (!z.rule) return z.std;
  const { start, end } = RULES[z.rule](ruleYear, z.std);
  const dst = start < end ? (t >= start && t < end) : (t < end || t >= start);
  return dst ? z.std + SAVE : z.std;
}
const yearOfMs = ms => new Date(ms).getUTCFullYear();
const clampRuleYear = y => Math.min(Math.max(y, RULE_YEAR_MIN), RULE_YEAR_MAX);

/** Offset (minutes east of UTC) in effect at instant `ms` in zone `tz`; the instant's local year must be in range. */
export function offsetAt(tz, ms) {
  const z = zoneOf(tz);
  const t = toMs(ms);
  const off = ruleOffset(z, t, clampRuleYear(yearOfMs(t + z.std * MINUTE)));
  checkYear(z, yearOfMs(t + off * MINUTE));
  return off;
}

/** DST transitions of `tz` in local year `year`, ascending: [{ at, before, after }] (offsets in minutes). */
export function transitionsOf(tz, year) {
  const z = zoneOf(tz);
  checkYear(z, year);
  if (!z.rule) return [];
  const { start, end } = RULES[z.rule](year, z.std);
  return [{ at: start, before: z.std, after: z.std + SAVE }, { at: end, before: z.std + SAVE, after: z.std }].sort((a, b) => a.at - b.at);
}

/** Local view of an instant: { day, date, weekday, msOfDay, minuteOfDay, offset }. */
export function localParts(ms, tz) {
  const t = toMs(ms);
  const offset = offsetAt(tz, t);
  const local = t + offset * MINUTE;
  const day = Math.floor(local / DAY);
  const msOfDay = local - day * DAY;
  return { day, date: dateOf(day), weekday: weekdayOf(day), msOfDay, minuteOfDay: Math.floor(msOfDay / MINUTE), offset };
}

/** The civil date of an instant in a zone. */
export const localDate = (ms, tz) => localParts(ms, tz).date;

/** Format an instant as 'YYYY-MM-DDTHH:MM:SS±HH:MM' in `tz` (milliseconds appended only when non-zero). */
export function formatInstant(ms, tz = 'UTC') {
  const t = toMs(ms);
  const { date, msOfDay, offset } = localParts(t, tz);
  const h = Math.floor(msOfDay / HOUR), mi = Math.floor((msOfDay % HOUR) / MINUTE), s = Math.floor((msOfDay % MINUTE) / SECOND), f = msOfDay % SECOND;
  const a = Math.abs(offset);
  return `${date}T${pad(h)}:${pad(mi)}:${pad(s)}${f ? `.${pad(f, 3)}` : ''}${offset < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

// Instants at which the wall clock reads `localMs` (ms since 1970-01-01 local), judged with the rule of `ruleYear`: the
// wall-clock year, range-checked by the caller (for 24:00 the year of the day that ends).
function localCandidates(z, localMs, ruleYear) {
  const offsets = z.rule ? [z.std, z.std + SAVE] : [z.std];
  const valid = [];
  for (const o of offsets) {
    const t = localMs - o * MINUTE;
    if (ruleOffset(z, t, ruleYear) === o) valid.push(t);
  }
  return { valid: [...new Set(valid)].sort((a, b) => a - b), lo: localMs - Math.max(...offsets) * MINUTE, hi: localMs - Math.min(...offsets) * MINUTE };
}
function wallYear(z, day) {
  const y = yearOfMs(day * DAY);
  checkYear(z, y);
  return z.bounded ? y : clampRuleYear(y);
}

const toMsOfDay = time => (typeof time === 'number' ? time : parseClock(time));

/**
 * The instant at which the local wall clock in `tz` shows `time` on `date`. `time` is 'HH:MM[:SS]' or ms since local
 * midnight (0 <= time < 24 h). Disambiguation: 'compatible' (default) | 'earlier' | 'later' | 'reject'.
 */
export function fromLocal(date, time, tz, disambiguation = 'compatible') {
  const z = zoneOf(tz);
  const msOfDay = toMsOfDay(time);
  if (!Number.isSafeInteger(msOfDay) || msOfDay < 0 || msOfDay >= DAY) fail('TIME_INVALID', `time of day out of range: ${time}`);
  const day = toDay(date);
  const { valid, lo, hi } = localCandidates(z, day * DAY + msOfDay, wallYear(z, day));
  if (!['compatible', 'earlier', 'later', 'reject'].includes(disambiguation)) fail('TIME_INVALID', `unknown disambiguation ${disambiguation}`);
  if (valid.length === 1) return valid[0];
  if (valid.length === 2) {
    if (disambiguation === 'reject') fail('TZ_AMBIGUOUS', `${dateOf(toDay(date))} ${time} occurs twice in ${tz}`);
    return disambiguation === 'later' ? valid[1] : valid[0];
  }
  if (disambiguation === 'reject') fail('TZ_GAP', `${dateOf(toDay(date))} ${time} does not exist in ${tz}`);
  return disambiguation === 'earlier' ? lo : hi;
}

/**
 * The first instant at which the local wall clock in `tz` reads at least `time` on `date` (the interval-endpoint
 * mapping). `time` may be 24:00 (= the next day's 00:00). In a spring-forward gap this is the transition instant; in a
 * fall-back fold it is the earlier occurrence.
 */
export function wallStart(date, time, tz) {
  const z = zoneOf(tz);
  let day = toDay(date);
  let msOfDay = typeof time === 'number' ? time : parseClock(time, { allow24: true });
  const ruleYear = wallYear(z, day); // 24:00 ends `date`: judged with the rule (and range) of `date`'s year
  if (msOfDay === DAY) { day += 1; msOfDay = 0; }
  if (!Number.isSafeInteger(msOfDay) || msOfDay < 0 || msOfDay >= DAY) fail('TIME_INVALID', `time of day out of range: ${time}`);
  const { valid, lo, hi } = localCandidates(z, day * DAY + msOfDay, ruleYear);
  if (valid.length) return valid[0];
  const year = new Date(day * DAY).getUTCFullYear();
  const tr = [year - 1, year, year + 1].flatMap(y => { try { return transitionsOf(tz, y); } catch { return []; } }).find(x => x.at > lo && x.at <= hi);
  if (!tr) fail('TZ_GAP', `no transition found for the gap at ${dateOf(day)} in ${tz}`);
  return tr.at;
}

/** Local midnight-to-midnight bounds of a date: { start, end } (end exclusive, = next day's start). */
export const dayBounds = (date, tz) => ({ start: wallStart(date, 0, tz), end: wallStart(date, DAY, tz) });
