// Unit tests for time.mjs, calendar.mjs and editions.mjs (E-BED §8.1 step 3). Every expected value is derived by hand
// in the comment beside it (weekday arithmetic from 2026-01-01 = Thursday), not computed by the code under test.
// No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstant, formatInstant, toMs, compareInstants, laterOf, earlierOf, offsetAt, transitionsOf, fromLocal, wallStart,
  localParts, dayBounds, parseDate, dateOf, weekdayOf, addCalendarDays, ZONES, HOUR, MINUTE,
} from './time.mjs';
import {
  calendar, isBusinessDay, addBusinessDays, businessDaysBetween, nextBusinessDay, previousBusinessDay, rollDate,
  businessMs, addBusinessMs, businessIntervals, wallIntervals, bindTimeZone,
} from './calendar.mjs';
import { selectEdition, checkEditions } from './editions.mjs';
import { codeOf } from './errors.mjs';

const NY = 'America/New_York';
const fmt = ms => formatInstant(ms, NY);
// Mon-Fri 09:00-17:00 New York; Thanksgiving Thu 2026-11-26 closed; Fri 2026-11-27 closes at 13:00; Christmas Fri.
const AP = { id: 'ap', tz: NY, businessHours: { days: [1, 2, 3, 4, 5], hours: [['09:00', '17:00']] },
  holidays: [{ date: '2026-11-26' }, { date: '2026-11-27', from: '13:00', to: '17:00' }, { date: '2026-12-25' }] };

test('civil dates: weekdays, month lengths, refusals', () => {
  assert.equal(weekdayOf(parseDate('1970-01-01')), 4); // Thursday
  assert.equal(weekdayOf(parseDate('2026-01-01')), 4); // Thursday
  assert.equal(weekdayOf(parseDate('2026-03-01')), 7); // Jan 31 + Feb 28 = 59 days = 8 weeks + 3 -> Sunday
  assert.equal(weekdayOf(parseDate('2026-11-26')), 4); // Thanksgiving: fourth Thursday of November
  assert.equal(dateOf(parseDate('2028-02-29')), '2028-02-29');
  assert.equal(addCalendarDays('2026-11-20', 45), '2027-01-04'); // 10 to Nov 30, 31 to Dec 31, 4 more
  assert.equal(addCalendarDays('2026-03-01', -1), '2026-02-28');
  for (const bad of ['2026-02-29', '2026-13-01', '2026-1-01', '26-01-01', '2026-04-31']) assert.equal(codeOf(() => parseDate(bad)), 'DATE_INVALID', bad);
});

test('instants: offsets required, exact parse and format, no string comparison', () => {
  assert.equal(parseInstant('2026-01-01T00:00:00Z'), Date.UTC(2026, 0, 1));
  assert.equal(parseInstant('2026-01-01T10:00+02:00'), Date.UTC(2026, 0, 1, 8));
  assert.equal(parseInstant('2026-01-01T00:00:00.5Z'), Date.UTC(2026, 0, 1) + 500);
  for (const bad of ['2026-01-01T10:00:00', '2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01 10:00Z', '2026-01-01T10:00:00+19:00']) {
    assert.equal(codeOf(() => parseInstant(bad)), 'TIME_INVALID', bad);
  }
  // '...T10:00+02:00' sorts after '...T09:00Z' as text but is an hour earlier as an instant.
  assert.equal(compareInstants('2026-01-01T10:00:00+02:00', '2026-01-01T09:00:00Z'), -1);
  assert.equal(laterOf('2026-01-01T10:00:00+02:00', '2026-01-01T09:00:00Z'), Date.UTC(2026, 0, 1, 9));
  assert.equal(earlierOf('2026-01-01T10:00:00+02:00', '2026-01-01T09:00:00Z'), Date.UTC(2026, 0, 1, 8));
  assert.equal(formatInstant(Date.UTC(2026, 6, 1, 12), NY), '2026-07-01T08:00:00-04:00');
  assert.equal(formatInstant(Date.UTC(2026, 0, 1, 12), 'Asia/Kolkata'), '2026-01-01T17:30:00+05:30');
  assert.equal(formatInstant(Date.UTC(2026, 0, 1, 12), 'UTC'), '2026-01-01T12:00:00+00:00');
  assert.equal(formatInstant(Date.UTC(2026, 0, 1, 12) + 7, 'UTC+01:00'), '2026-01-01T13:00:00.007+01:00');
  assert.equal(toMs(fmt(1798000000000)), 1798000000000);
  assert.equal(codeOf(() => toMs(1.5)), 'TIME_INVALID');
});

test('zones: 2026 transitions by hand', () => {
  const at = (tz, y) => transitionsOf(tz, y).map(t => formatInstant(t.at, 'UTC'));
  // US: second Sunday of March (Mar 1 is a Sunday -> Mar 8) 02:00 EST = 07:00Z; first Sunday of November (Nov 1)
  // 02:00 EDT = 06:00Z.
  assert.deepEqual(at(NY, 2026), ['2026-03-08T07:00:00+00:00', '2026-11-01T06:00:00+00:00']);
  // EU: last Sundays of March (29) and October (25), 01:00 UTC.
  assert.deepEqual(at('Europe/London', 2026), ['2026-03-29T01:00:00+00:00', '2026-10-25T01:00:00+00:00']);
  assert.deepEqual(at('Europe/Berlin', 2026), ['2026-03-29T01:00:00+00:00', '2026-10-25T01:00:00+00:00']);
  // AU: first Sunday of April (Apr 5) 03:00 AEDT = 16:00Z Apr 4; first Sunday of October (Oct 4) 02:00 AEST = 16:00Z Oct 3.
  assert.deepEqual(at('Australia/Sydney', 2026), ['2026-04-04T16:00:00+00:00', '2026-10-03T16:00:00+00:00']);
  // NZ: first Sunday of April 03:00 NZDT (+13) = 14:00Z Apr 4; last Sunday of September (Sep 27) 02:00 NZST = 14:00Z Sep 26.
  assert.deepEqual(at('Pacific/Auckland', 2026), ['2026-04-04T14:00:00+00:00', '2026-09-26T14:00:00+00:00']);
  assert.deepEqual(transitionsOf('Asia/Tokyo', 2026), []);
  assert.equal(offsetAt(NY, Date.UTC(2026, 2, 8, 7) - 1), -300);
  assert.equal(offsetAt(NY, Date.UTC(2026, 2, 8, 7)), -240);
  assert.equal(offsetAt('Australia/Sydney', Date.UTC(2026, 0, 15)), 660); // southern summer: daylight time
  assert.equal(offsetAt('Australia/Sydney', Date.UTC(2026, 6, 15)), 600);
  assert.equal(codeOf(() => offsetAt('Mars/Olympus', 0)), 'TZ_UNKNOWN');
  assert.equal(codeOf(() => offsetAt(NY, Date.UTC(2019, 5, 1))), 'TZ_RANGE');
  assert.equal(offsetAt('UTC-03:30', Date.UTC(1950, 0, 1)), -210);
});

test('zones: local times in gaps and folds', () => {
  // 2026-03-08 02:30 does not exist in New York (02:00 EST -> 03:00 EDT).
  assert.equal(fmt(fromLocal('2026-03-08', '02:30', NY)), '2026-03-08T03:30:00-04:00'); // compatible = later
  assert.equal(fmt(fromLocal('2026-03-08', '02:30', NY, 'later')), '2026-03-08T03:30:00-04:00');
  assert.equal(fmt(fromLocal('2026-03-08', '02:30', NY, 'earlier')), '2026-03-08T01:30:00-05:00');
  assert.equal(codeOf(() => fromLocal('2026-03-08', '02:30', NY, 'reject')), 'TZ_GAP');
  assert.equal(fmt(wallStart('2026-03-08', '02:30', NY)), '2026-03-08T03:00:00-04:00'); // the transition instant
  // 2026-11-01 01:30 occurs twice (EDT, then EST).
  assert.equal(fmt(fromLocal('2026-11-01', '01:30', NY)), '2026-11-01T01:30:00-04:00');
  assert.equal(fmt(fromLocal('2026-11-01', '01:30', NY, 'later')), '2026-11-01T01:30:00-05:00');
  assert.equal(codeOf(() => fromLocal('2026-11-01', '01:30', NY, 'reject')), 'TZ_AMBIGUOUS');
  assert.equal(fmt(wallStart('2026-11-01', '01:30', NY)), '2026-11-01T01:30:00-04:00');
  assert.equal(fmt(wallStart('2026-11-01', '24:00', NY)), '2026-11-02T00:00:00-05:00');
  const b = dayBounds('2026-11-01', NY);
  assert.equal((b.end - b.start) / HOUR, 25);
  const s = dayBounds('2026-03-08', NY);
  assert.equal((s.end - s.start) / HOUR, 23);
  const lp = localParts(parseInstant('2026-11-01T06:30:00Z'), NY); // second 01:30
  assert.deepEqual([lp.date, lp.minuteOfDay, lp.offset, lp.weekday], ['2026-11-01', 90, -300, 7]);
});

test('calendar: business days around Thanksgiving with a half day', () => {
  assert.equal(isBusinessDay(AP, '2026-11-25'), true);
  assert.equal(isBusinessDay(AP, '2026-11-26'), false); // holiday
  assert.equal(isBusinessDay(AP, '2026-11-27'), true); // half day still a business day
  assert.equal(isBusinessDay(AP, '2026-11-28'), false); // Saturday
  assert.deepEqual(wallIntervals(AP, '2026-11-27'), [[9 * HOUR, 13 * HOUR]]);
  // Tue 24 + 3: Wed 25 (1), Thu holiday, Fri 27 (2), Mon 30 (3).
  assert.equal(addBusinessDays(AP, '2026-11-24', 3), '2026-11-30');
  assert.equal(addBusinessDays(AP, '2026-11-30', -3), '2026-11-24'); // Fri 27, Wed 25, Tue 24
  assert.equal(addBusinessDays(AP, '2026-11-28', 1), '2026-11-30'); // from a Saturday
  assert.equal(addBusinessDays(AP, '2026-11-28', 0), '2026-11-28'); // n = 0 is the date itself
  // 10 business days after Fri 2026-11-20: 23 24 25 27 30 1 2 3 4 7 -> Mon 2026-12-07.
  assert.equal(addBusinessDays(AP, '2026-11-20', 10), '2026-12-07');
  assert.equal(businessDaysBetween(AP, '2026-11-24', '2026-11-30'), 3);
  assert.equal(businessDaysBetween(AP, '2026-11-30', '2026-11-24'), -3);
  assert.equal(businessDaysBetween(AP, '2026-11-24', '2026-11-24'), 0);
  assert.equal(nextBusinessDay(AP, '2026-11-25'), '2026-11-27');
  assert.equal(nextBusinessDay(AP, '2026-11-25', { inclusive: true }), '2026-11-25');
  assert.equal(previousBusinessDay(AP, '2026-11-30'), '2026-11-27');
  assert.equal(previousBusinessDay(AP, '2026-12-26'), '2026-12-24'); // Sat 26 <- Fri 25 holiday <- Thu 24
  // MR8: a holiday on a Saturday changes nothing; one on Tue 2026-12-01 inside the span moves the deadline one day.
  assert.equal(addBusinessDays({ ...AP, holidays: [...AP.holidays, { date: '2026-11-28' }] }, '2026-11-20', 10), '2026-12-07');
  assert.equal(addBusinessDays({ ...AP, holidays: [...AP.holidays, { date: '2026-12-01' }] }, '2026-11-20', 10), '2026-12-08');
  // A closure covering all of a day's hours removes the business day.
  assert.equal(isBusinessDay({ ...AP, holidays: [{ date: '2026-11-25', from: '08:00', to: '18:00' }] }, '2026-11-25'), false);
});

test('calendar: roll conventions', () => {
  assert.equal(rollDate(AP, '2026-10-31', 'following'), '2026-11-02'); // Sat -> Mon
  assert.equal(rollDate(AP, '2026-10-31', 'modifiedFollowing'), '2026-10-30'); // Mon is in November -> Fri
  assert.equal(rollDate(AP, '2026-11-01', 'modifiedFollowing'), '2026-11-02');
  assert.equal(rollDate(AP, '2026-11-01', 'preceding'), '2026-10-30');
  assert.equal(rollDate(AP, '2026-11-01', 'modifiedPreceding'), '2026-11-02'); // Fri Oct 30 is in October -> Mon
  assert.equal(rollDate(AP, '2026-11-26', 'following'), '2026-11-27');
  assert.equal(rollDate(AP, '2026-11-25', 'following'), '2026-11-25');
  assert.equal(rollDate(AP, '2026-11-28', 'none'), '2026-11-28');
  assert.equal(codeOf(() => rollDate(AP, '2026-11-28', 'nearest')), 'CAL_INVALID');
});

test('calendar: business time between instants and adding business time', () => {
  const h = (a, b) => businessMs(AP, a, b) / HOUR;
  // Tue 16-17 (1) + Wed (8) + Thu (0) + Fri 9-13 (4) + Mon 9-10 (1) = 14.
  assert.equal(h('2026-11-24T16:00:00-05:00', '2026-11-30T10:00:00-05:00'), 14);
  assert.equal(h('2026-11-30T10:00:00-05:00', '2026-11-24T16:00:00-05:00'), -14);
  assert.equal(h('2026-11-28T10:00:00-05:00', '2026-11-29T10:00:00-05:00'), 0); // weekend
  assert.equal(h('2026-11-27T12:30:00-05:00', '2026-11-27T15:00:00-05:00'), 0.5); // half day closes at 13:00
  assert.equal(fmt(addBusinessMs(AP, '2026-11-27T12:00:00-05:00', 2 * HOUR)), '2026-11-30T10:00:00-05:00');
  assert.equal(fmt(addBusinessMs(AP, '2026-11-25T09:00:00-05:00', 8 * HOUR)), '2026-11-25T17:00:00-05:00'); // lands on the close
  assert.equal(fmt(addBusinessMs(AP, '2026-11-28T12:00:00-05:00', HOUR)), '2026-11-30T10:00:00-05:00'); // from a Saturday
  assert.equal(addBusinessMs(AP, '2026-11-28T12:00:00-05:00', 0), parseInstant('2026-11-28T12:00:00-05:00')); // 0 = the instant
  assert.equal(fmt(addBusinessMs(AP, '2026-11-25T16:59:00-05:00', 2 * MINUTE)), '2026-11-27T09:01:00-05:00');
  assert.deepEqual(businessIntervals(AP, '2026-11-25T16:00:00-05:00', '2026-11-27T10:00:00-05:00').map(([a, b]) => [fmt(a), fmt(b)]),
    [['2026-11-25T16:00:00-05:00', '2026-11-25T17:00:00-05:00'], ['2026-11-27T09:00:00-05:00', '2026-11-27T10:00:00-05:00']]);
  // Across the spring-forward weekend: Fri 16-17 EST (1) + Mon 09-10 EDT (1).
  assert.equal(h('2026-03-06T16:00:00-05:00', '2026-03-09T10:00:00-04:00'), 2);
  // 24x7: a spring-forward day has 23 hours, a fall-back day 25.
  const c24 = { tz: NY, businessHours: '24x7' };
  assert.equal(businessMs(c24, '2026-03-07T12:00:00-05:00', '2026-03-08T12:00:00-04:00') / HOUR, 23);
  assert.equal(businessMs(c24, '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00') / HOUR, 25);
  // Hours 00:00-02:30 on the spring-forward Sunday: the clock skips 02:00-03:00, so 2 hours of business time.
  assert.equal(businessMs({ tz: NY, businessHours: { sun: [['00:00', '02:30']] } }, '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00') / MINUTE, 120);
  // Representation invariance: the same instants written with different offsets.
  assert.equal(businessMs(AP, '2026-11-24T21:00:00Z', '2026-11-30T15:00:00Z'), 14 * HOUR);
});

test('calendar: shapes, validation and time-zone binding', () => {
  const split = { tz: 'Europe/Berlin', businessHours: { mon: [['08:00', '12:00'], ['13:00', '17:30']], '2': [['08:00', '17:30']] } };
  assert.deepEqual(wallIntervals(split, '2026-11-23'), [[8 * HOUR, 12 * HOUR], [13 * HOUR, 17.5 * HOUR]]); // Monday
  assert.equal(isBusinessDay(split, '2026-11-25'), false); // Wednesday has no hours
  assert.equal(calendar(split), calendar(split)); // memoised
  assert.deepEqual(wallIntervals({ tz: 'UTC', businessHours: { mon: [['09:00', '12:00'], ['12:00', '17:00']] } }, '2026-11-23'), [[9 * HOUR, 17 * HOUR]]);
  for (const [bad, code] of [
    [{ tz: 'UTC', businessHours: { mon: [['09:00', '12:00'], ['11:00', '17:00']] } }, 'CAL_INVALID'],
    [{ tz: 'UTC', businessHours: { mon: [['17:00', '09:00']] } }, 'CAL_INVALID'],
    [{ tz: 'UTC', businessHours: { funday: [['09:00', '17:00']] } }, 'CAL_INVALID'],
    [{ tz: 'UTC', businessHours: '9to5' }, 'CAL_INVALID'],
    [{ tz: 'UTC', businessHours: '24x7', holidays: [{ date: '2026-01-01', from: '09:00' }] }, 'CAL_INVALID'],
    [{ tz: 'Atlantis/Central', businessHours: '24x7' }, 'TZ_UNKNOWN'],
  ]) assert.equal(codeOf(() => calendar(bad)), code, JSON.stringify(bad));
  assert.equal(codeOf(() => addBusinessDays({ tz: 'UTC', businessHours: {} }, '2026-01-01', 1)), 'CAL_NO_BUSINESS_TIME');
  assert.equal(codeOf(() => addBusinessMs({ tz: 'UTC', businessHours: {} }, '2026-01-01T00:00:00Z', 1)), 'CAL_NO_BUSINESS_TIME');
  assert.deepEqual(bindTimeZone({ caller: null, location: 'Europe/Paris', system: 'UTC' }, ['caller', 'location', 'system']), { tz: 'Europe/Paris', source: 'location' });
  assert.equal(codeOf(() => bindTimeZone({ caller: null }, ['caller', 'location'])), 'TZ_UNBOUND');
  assert.equal(codeOf(() => bindTimeZone({ caller: 'Nowhere/Land' }, ['caller'])), 'TZ_UNKNOWN');
});

test('editions: anchor date decides, effectiveTo exclusive, published filters, no latest-wins', () => {
  const eds = [
    { id: 'v1', effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' },
    { id: 'v2', effectiveFrom: '2026-07-01', effectiveTo: null, published: '2026-07-15T00:00:00Z' },
  ];
  assert.equal(selectEdition(eds, '2026-06-30').id, 'v1');
  assert.equal(selectEdition(eds, '2026-07-01').id, 'v2'); // effectiveTo is exclusive
  assert.equal(selectEdition(eds, '2027-03-01').id, 'v2');
  assert.equal(codeOf(() => selectEdition(eds, '2025-12-31')), 'EDITION_UNRESOLVED');
  // A retroactive edition not yet published: as of 2026-07-10 nothing is known to be in force on 2026-07-05.
  assert.equal(codeOf(() => selectEdition(eds, '2026-07-05', { asOf: '2026-07-10T00:00:00Z' })), 'EDITION_UNRESOLVED');
  assert.equal(selectEdition(eds, '2026-07-05', { asOf: '2026-07-15T00:00:00Z' }).id, 'v2');
  const overlap = [...eds, { id: 'v2b', effectiveFrom: '2026-09-01' }];
  assert.equal(codeOf(() => selectEdition(overlap, '2026-09-02')), 'EDITION_UNRESOLVED');
  assert.deepEqual(checkEditions(overlap).map(i => [i.code, i.severity]), [['EDITION_UNRESOLVED', 'error']]);
  const gap = [{ id: 'a', effectiveFrom: '2026-01-01', effectiveTo: '2026-03-01' }, { id: 'b', effectiveFrom: '2026-04-01' }];
  assert.deepEqual(checkEditions(gap).map(i => [i.code, i.severity, i.gap]), [['EDITION_UNRESOLVED', 'warning', { from: '2026-03-01', to: '2026-04-01' }]]);
  assert.equal(codeOf(() => checkEditions([{ id: 'x', effectiveFrom: '2026-02-01', effectiveTo: '2026-02-01' }])), 'EDITION_INVALID');
  assert.deepEqual(checkEditions([...gap, { id: 'a', effectiveFrom: '2027-01-01' }]).map(i => i.code).sort(), ['EDITION_INVALID', 'EDITION_UNRESOLVED', 'EDITION_UNRESOLVED']);
});

// Differential check of the pinned zone table against the host's ICU tzdata (Node 24: full ICU). Skipped per zone when
// Intl does not know it. Checks every transition +-1 ms and +-1 h for 2020-2037 and 40 instants per year.
const intlFormats = new Map();
function intlOffset(tz, ms) {
  if (!intlFormats.has(tz)) intlFormats.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }));
  const part = intlFormats.get(tz).formatToParts(new Date(ms)).find(p => p.type === 'timeZoneName').value;
  if (part === 'GMT') return 0;
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part);
  return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
}

test('zones: pinned rules equal Intl tzdata for every listed zone, 2020-2037', t => {
  let checked = 0;
  for (const tz of Object.keys(ZONES)) {
    try { intlOffset(tz, 0); } catch { t.diagnostic(`skip ${tz}: not in Intl`); continue; }
    for (let y = 2020; y <= 2037; y++) {
      const probes = [];
      for (const tr of transitionsOf(tz, y)) probes.push(tr.at - HOUR, tr.at - 1, tr.at, tr.at + 1, tr.at + HOUR);
      for (let k = 0; k < 40; k++) probes.push(Date.UTC(y, 0, 1, 12) + k * 9 * 86400000 + k * 3599000);
      for (const ms of probes) {
        if (new Date(ms + ZONES[tz][0] * MINUTE).getUTCFullYear() !== y) continue;
        assert.equal(offsetAt(tz, ms), intlOffset(tz, ms), `${tz} at ${new Date(ms).toISOString()}`);
        checked++;
      }
    }
  }
  t.diagnostic(`offsets checked against Intl: ${checked}`);
  assert.ok(checked > 20000);
});
