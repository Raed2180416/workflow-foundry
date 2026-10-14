// need-qa subtype (c) "calendar": date arithmetic in a stated fictional calendar with a business-day rule.
// size scales the calendar (months) and the festival table (rows); steps scales the rule load:
//   steps 1: date N days after a date, same year
//   steps 2: date N days after a date, crossing a year boundary
//   steps 3: weekday of the date N days after a date (weekday cycle given, anchored on day 1 of the first year)
//   steps 4: Nth business day after a date (two stated rest days; every 4th year has one extra day in the last month)
//   steps 5: festival days recur yearly and are not business days; Nth business day after a date, or a business-day count
import { uniqueNames, weekdayNames, ordinal, composePrompt, FORM } from './core.mjs';

const N_MONTHS = [4, 5, 6, 7, 8];
const N_FESTIVALS = [3, 5, 8, 12, 18];

/** The calendar as pure functions of an offset (days since day 1 of month 1 of year Y0). */
function makeCalendar({ months, Y0, W, anchor }, leap) {
  const last = months.length - 1;
  const dim = (y, m) => months[m].days + (leap && m === last && y % 4 === 0 ? 1 : 0);
  const yearLen = y => months.reduce((s, _, m) => s + dim(y, m), 0);
  const offsetOf = ({ y, m, d }) => {
    let off = 0;
    for (let yy = Y0; yy < y; yy++) off += yearLen(yy);
    for (let mm = 0; mm < m; mm++) off += dim(y, mm);
    return off + d - 1;
  };
  const dateOf = off => {
    let y = Y0;
    while (off >= yearLen(y)) { off -= yearLen(y); y++; }
    let m = 0;
    while (off >= dim(y, m)) { off -= dim(y, m); m++; }
    return { y, m, d: off + 1 };
  };
  const weekdayOf = off => (anchor + off) % W;
  return { dim, yearLen, offsetOf, dateOf, weekdayOf };
}

export function buildCalendar(r, { size, steps }) {
  const used = new Set();
  const [calName] = uniqueNames(r, 1, used);
  const monthNames = uniqueNames(r, N_MONTHS[size - 1], used);
  const months = monthNames.map(month => ({ month, days: r.int(20, 34) }));
  const W = r.pick([5, 6, 7]);
  const weekdays = weekdayNames(r, W);
  const Y0 = r.int(200, 480);
  const anchor = r.int(0, W - 1);
  const leap = steps >= 4;
  const world = { months, Y0, W, anchor };
  const cal = makeCalendar(world, leap);
  const noLeap = makeCalendar(world, false);

  // festivals recur on the same month/day every year; one table row each
  const nFest = N_FESTIVALS[size - 1];
  const festDays = new Set();
  for (let guard = 0; festDays.size < nFest; guard++) {
    if (guard > 5000) return null;
    const m = r.int(0, months.length - 1);
    festDays.add(`${m}:${r.int(1, months[m].days)}`);
  }
  const festNames = uniqueNames(r, nFest, used);
  const festivals = [...festDays].sort((a, b) => { const [am, ad] = a.split(':').map(Number), [bm, bd] = b.split(':').map(Number); return am - bm || ad - bd; })
    .map((k, i) => { const [m, d] = k.split(':').map(Number); return { festival: festNames[i], month: months[m].month, day: d }; });
  const isFestival = off => { const { m, d } = cal.dateOf(off); return festDays.has(`${m}:${d}`); };

  const rest = new Set(r.sample([...Array(W).keys()], 2));
  const fmt = ({ y, m, d }) => `${months[m].month} ${d}, year ${y}`;
  const isBusiness = (off, useFestivals, useRest = true) => !(useRest && rest.has(cal.weekdayOf(off))) && !(useFestivals && isFestival(off));
  const nthBusiness = (start, n, useFestivals, useRest = true) => { let off = start, left = n; while (left > 0) { off++; if (isBusiness(off, useFestivals, useRest)) left--; } return off; };
  const countBusiness = (a, b, useFestivals, useRest = true) => { let c = 0; for (let off = a; off <= b; off++) if (isBusiness(off, useFestivals, useRest)) c++; return c; };
  const dateTruth = off => ({ kind: 'date', value: fmt(cal.dateOf(off)) });

  const ruleLines = [];
  if (steps >= 4) ruleLines.push(`${weekdays[Math.min(...rest)]} and ${weekdays[Math.max(...rest)]} are rest days; every other weekday is a business day unless a rule below says otherwise.`);
  if (steps >= 5) ruleLines.push('A festival day listed in "festivals" is never a business day.');
  else ruleLines.push('The "festivals" table is background information and does not affect this question.');
  if (leap) ruleLines.push(`Every year divisible by 4 has one extra day at the end of its last month, ${months[months.length - 1].month}.`);
  const intro = `Dates in the ${calName} calendar. inputs.json "calendar" lists the months of a year in order with their lengths in days, and the ${W} weekday names in order; weekdays repeat in that order without interruption, across month and year boundaries. Day 1 of the first month of year ${Y0} is a ${weekdays[anchor]}. "festivals" lists festival days, which recur every year on the same month and day. ${ruleLines.join(' ')}`;
  const inputs = { calendar: { months, weekdays }, festivals };

  const yearStartOffset = y => cal.offsetOf({ y, m: 0, d: 1 });
  const randomDate = (y, loFrac, hiFrac) => {
    const len = cal.yearLen(y);
    return yearStartOffset(y) + r.int(Math.floor(len * loFrac), Math.floor(len * hiFrac));
  };

  let question, truth, alternatives = [], form = FORM.date, derived = true, allowTextInPrompt = false;
  const near = [];
  const pushNear = (name, t) => { if (t && t.value !== truth.value && !near.some(x => x.truth.value === t.value)) near.push({ name, truth: t }); };

  if (steps === 1) {
    const start = randomDate(Y0, 0, 0.5);
    const n = r.int(3, Math.floor(months[0].days * 1.5));
    const end = start + n;
    if (cal.dateOf(end).y !== Y0) return null;
    question = `What is the date ${n} days after ${fmt(cal.dateOf(start))}? The start date counts as day 0.`;
    truth = dateTruth(end);
    pushNear('start-counted-as-day-1', dateTruth(end - 1));
    pushNear('one-day-too-many', dateTruth(end + 1));
  } else if (steps === 2) {
    const y = Y0 + r.int(0, 1);
    const start = randomDate(y, 0.6, 0.95);
    const n = r.int(Math.floor(cal.yearLen(y) * 0.3), Math.floor(cal.yearLen(y) * 0.9));
    const end = start + n;
    if (cal.dateOf(end).y === cal.dateOf(start).y) return null;
    question = `What is the date ${n} days after ${fmt(cal.dateOf(start))}? The start date counts as day 0.`;
    truth = dateTruth(end);
    pushNear('start-counted-as-day-1', dateTruth(end - 1));
    pushNear('one-day-too-many', dateTruth(end + 1));
  } else if (steps === 3) {
    const y = Y0 + r.int(0, 1);
    const start = randomDate(y, 0, 1);
    const n = r.int(10, Math.floor(cal.yearLen(y) * 1.1));
    const end = start + n;
    const name = i => weekdays[((i % W) + W) % W];
    question = `Which day of the week is the date ${n} days after ${fmt(cal.dateOf(start))}? The start date counts as day 0.`;
    truth = { kind: 'text', value: name(cal.weekdayOf(end)) };
    form = FORM.text; derived = false; allowTextInPrompt = true;
    pushNear('weekday-of-start-date', { kind: 'text', value: name(cal.weekdayOf(start)) });
    pushNear('one-weekday-late', { kind: 'text', value: name(cal.weekdayOf(end) + 1) });
    pushNear('one-weekday-early', { kind: 'text', value: name(cal.weekdayOf(end) - 1) });
    alternatives = weekdays.filter(w => w !== truth.value).map(value => ({ kind: 'text', value }));
  } else if (steps === 4 || (steps === 5 && r.chance(0.5))) {
    const useFest = steps === 5;
    const y = Y0 + r.int(0, 1);
    let start = randomDate(y, 0, 0.9);
    const n = r.int(5, 14);
    if (useFest) {
      // plant a festival inside the window so ignoring festivals changes the answer
      const inWindow = [];
      for (let off = start + 1; off <= start + 22; off++) if (isFestival(off) && !rest.has(cal.weekdayOf(off))) inWindow.push(off);
      if (!inWindow.length) return null;
    }
    const end = nthBusiness(start, n, useFest);
    question = `Starting on ${fmt(cal.dateOf(start))}, what is the date of the ${ordinal(n)} business day after it? The start date itself is not counted, even if it is a business day.`;
    truth = dateTruth(end);
    if (useFest) pushNear('ignored-festivals', dateTruth(nthBusiness(start, n, false)));
    pushNear('counted-calendar-days', dateTruth(start + n));
    pushNear('start-counted-as-first', dateTruth(nthBusiness(start, n - 1, useFest)));
    pushNear('one-business-day-too-many', dateTruth(nthBusiness(start, n + 1, useFest)));
    if (leap) {
      // a solver that forgets the extra day of leap years: same offsets, calendar without the rule
      const startNoLeap = noLeap.offsetOf(cal.dateOf(start));
      const endNoLeap = (() => { let off = startNoLeap, left = n; while (left > 0) { off++; const wd = noLeap.weekdayOf(off); const d = noLeap.dateOf(off); if (!rest.has(wd) && !(useFest && festDays.has(`${d.m}:${d.d}`))) left--; } return off; })();
      pushNear('forgot-leap-day', { kind: 'date', value: fmt(noLeap.dateOf(endNoLeap)) });
    }
  } else {
    const y = Y0 + r.int(0, 1);
    const a = randomDate(y, 0, 0.9);
    const b = a + r.int(14, 40);
    if (![...Array(b - a + 1).keys()].some(i => isFestival(a + i) && !rest.has(cal.weekdayOf(a + i)))) return null;
    question = `How many business days are there from ${fmt(cal.dateOf(a))} to ${fmt(cal.dateOf(b))}, counting both ends if they are business days?`;
    truth = { kind: 'int', value: String(countBusiness(a, b, true)) };
    form = FORM.number;
    pushNear('ignored-festivals', { kind: 'int', value: String(countBusiness(a, b, false)) });
    pushNear('excluded-both-ends', { kind: 'int', value: String(countBusiness(a + 1, b - 1, true)) });
    pushNear('counted-calendar-days', { kind: 'int', value: String(b - a + 1) });
    pushNear('excluded-first-day', { kind: 'int', value: String(countBusiness(a + 1, b, true)) });
  }
  if (!near.length) return null;
  if (steps === 5 && !near.some(x => x.name === 'ignored-festivals')) return null;   // the festival rule must change the answer
  return { prompt: composePrompt(intro, question, form), inputs, truth, near, alternatives, derived, allowTextInPrompt };
}
