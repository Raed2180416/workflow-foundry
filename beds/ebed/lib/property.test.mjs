// Property tests for the oracle-side libraries (E-BED §9.2 clock laws and conservation, §9.3 MR3/MR8/MR11). Seeded
// from the E-bed dev block (1001-1199, SEED-LEDGER `ebed-dev`, allow jit-dev) with beds/lib/rng.mjs; no wall clock, no
// model. Each library is compared with a deliberately naive model written here from the raw inputs:
//   calendar / clock  minute-by-minute stepping in UTC with the local wall clock from offsetAt (itself checked against
//                     Intl in calendar.test.mjs); business hours parsed from the raw calendar text, not calendar.mjs;
//   decision tables   tests generated as structured objects, rendered to S-FEEL text for the library and evaluated
//                     directly here; hit policies re-implemented from DMN 1.3 §8.2.10 in a few lines;
//   saga / ledger     sets and orders computed from the generated execution, and mutated trajectories.
// Business hours in the random calendars start at 04:00 or later, so no interval touches a DST transition hour (all
// listed zones switch between 01:00 and 03:00 local); transition-hour behaviour is pinned by hand in calendar.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../lib/rng.mjs';
import { offsetAt, formatInstant, transitionsOf, fromLocal, localParts, parseDate, dateOf, DAY, HOUR, MINUTE } from './time.mjs';
import { businessMs, addBusinessMs, addBusinessDays, businessDaysBetween, isBusinessDay, nextBusinessDay } from './calendar.mjs';
import { clockAt } from './clock.mjs';
import { decide, checkTable } from './dtable.mjs';
import { planSaga, compensationEffects } from './saga.mjs';
import { matchEffects, balance835 } from './ledger.mjs';
import { EbedLibError } from './errors.mjs';

const SEEDS = n => Array.from({ length: n }, (_, i) => 1001 + i); // dev block ebed-dev
const R = (part, seed) => rng('ebed', 'lib', part, 'dev', seed);
const ZONES = ['UTC', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney', 'Pacific/Auckland', 'Asia/Tokyo', 'Asia/Kolkata'];
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const BASE = Date.UTC(2026, 0, 3); // span starts drawn from 2026, crossing every 2026 transition

// ---------------------------------------------------------------------------------------------------------------------
// Random calendars and the minute-stepping model

function randomCalendar(r) {
  const tz = r.pick(ZONES);
  const days = [1, 2, 3, 4, 5, 6, 7].filter(() => r.chance(0.7));
  if (!days.length) days.push(r.int(1, 7));
  // One shape for every listed day (the {days, hours} form): 1-2 intervals at 30-minute granularity from 04:00.
  const s1 = r.int(8, 24) * 30, e1 = s1 + r.int(2, 16) * 30;
  const hours = [[s1, e1]];
  if (r.chance(0.5) && e1 + 60 <= 23 * 60) { const s2 = e1 + r.int(0, 4) * 30, e2 = Math.min(s2 + r.int(2, 8) * 30, 1440); if (s2 < e2) hours.push([s2, e2]); }
  const start = BASE + r.int(0, 355) * DAY;
  const holidays = [];
  for (let k = r.int(0, 6); k > 0; k--) {
    const date = dateOf(Math.floor(start / DAY) + r.int(-2, 20));
    if (r.chance(0.5)) holidays.push({ date });
    else { const a = r.int(8, 46) * 30, b = Math.min(a + r.int(1, 12) * 30, 1440); holidays.push({ date, from: hhmm(a), to: b === 1440 ? '24:00' : hhmm(b) }); }
  }
  const input = { tz, businessHours: { days, hours: hours.map(([a, b]) => [hhmm(a), b === 1440 ? '24:00' : hhmm(b)]) }, holidays };
  return { input, start, raw: rawModel(input) };
}

// The naive model reads the raw text again (no calendar.mjs code).
function rawModel(input) {
  const toMin = s => (s === '24:00' ? 1440 : Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)));
  const hours = input.businessHours.hours.map(([a, b]) => [toMin(a), toMin(b)]);
  const closures = new Map();
  for (const h of input.holidays) {
    const iv = h.from === undefined ? [0, 1440] : [toMin(h.from), toMin(h.to)];
    closures.set(h.date, [...(closures.get(h.date) ?? []), iv]);
  }
  return { tz: input.tz, days: new Set(input.businessHours.days), hours, closures, off: new Map() };
}
function local(raw, ms) {
  const hour = Math.floor(ms / HOUR);
  if (!raw.off.has(hour)) raw.off.set(hour, offsetAt(raw.tz, hour * HOUR));
  const l = ms + raw.off.get(hour) * MINUTE;
  const day = Math.floor(l / DAY);
  const iso = new Date(day * DAY).toISOString().slice(0, 10);
  const wd = new Date(day * DAY).getUTCDay() || 7;
  return { iso, wd, minute: Math.floor((l - day * DAY) / MINUTE) };
}
const inAny = (ivs, m) => ivs.some(([a, b]) => m >= a && m < b);
function bizMinute(raw, ms) {
  const { iso, wd, minute } = local(raw, ms);
  return raw.days.has(wd) && inAny(raw.hours, minute) && !inAny(raw.closures.get(iso) ?? [], minute);
}
const bruteBizMinutes = (raw, a, b) => { let n = 0; for (let t = a; t < b; t += MINUTE) if (bizMinute(raw, t)) n++; return n; };
function bruteIsBusinessDay(raw, date) {
  const wd = new Date(parseDate(date) * DAY).getUTCDay() || 7;
  if (!raw.days.has(wd)) return false;
  const cl = raw.closures.get(date) ?? [];
  for (let m = 0; m < 1440; m++) if (inAny(raw.hours, m) && !inAny(cl, m)) return true;
  return false;
}

test('calendar: business time equals minute stepping; additive, bounded, offset-invariant', () => {
  for (const seed of SEEDS(60)) {
    const r = R('cal-ms', seed);
    const { input, start, raw } = randomCalendar(r);
    const a = start + r.int(0, 2 * 1440) * MINUTE, b = a + r.int(0, 5 * 1440) * MINUTE, c = b + r.int(0, 2 * 1440) * MINUTE;
    const ab = businessMs(input, a, b);
    assert.equal(ab, bruteBizMinutes(raw, a, b) * MINUTE, `seed ${seed} ${input.tz}`);
    assert.equal(businessMs(input, a, c), ab + businessMs(input, b, c), `additivity seed ${seed}`);
    assert.ok(ab >= 0 && ab <= b - a);
    assert.equal(businessMs(input, formatInstant(a, 'Asia/Kolkata'), formatInstant(b, 'America/Los_Angeles')), ab, `representation seed ${seed}`);
  }
});

test('calendar: addBusinessMs is the exact, minimal inverse of businessMs', () => {
  for (const seed of SEEDS(60)) {
    const r = R('cal-add', seed);
    const { input, start, raw } = randomCalendar(r);
    const a = start + r.int(0, 1440) * MINUTE;
    const d = r.int(0, 30 * 60) * MINUTE;
    const u = addBusinessMs(input, a, d);
    assert.equal(businessMs(input, a, u), d, `seed ${seed}`);
    if (d > 0) {
      assert.ok(businessMs(input, a, u - MINUTE) < d, `minimal seed ${seed}`);
      assert.ok(bizMinute(raw, u - MINUTE), `ends on a business minute seed ${seed}`);
    } else assert.equal(u, a);
  }
});

test('calendar: business days match the model; addBusinessDays and businessDaysBetween are inverse; MR8', () => {
  for (const seed of SEEDS(80)) {
    const r = R('cal-days', seed);
    const { input, start, raw } = randomCalendar(r);
    const a = dateOf(Math.floor(start / DAY) + r.int(0, 3));
    for (let k = -2; k <= 25; k++) { const d = dateOf(parseDate(a) + k); assert.equal(isBusinessDay(input, d), bruteIsBusinessDay(raw, d), `seed ${seed} ${d}`); }
    const n = r.int(0, 12);
    const b = addBusinessDays(input, a, n);
    assert.equal(businessDaysBetween(input, a, b), n, `seed ${seed}`);
    if (n > 0) {
      assert.equal(isBusinessDay(input, b), true);
      assert.equal(addBusinessDays(input, b, -n) <= a, true); // back n business days lands on or before a
    }
    // MR8: a whole-day holiday on a non-business day changes nothing; on a business day in (a, b] it moves b to the
    // next business day after b.
    if (n > 0) {
      const span = Array.from({ length: parseDate(b) - parseDate(a) }, (_, i) => dateOf(parseDate(a) + 1 + i));
      const off = span.filter(d => !isBusinessDay(input, d));
      const on = span.filter(d => isBusinessDay(input, d));
      if (off.length) assert.equal(addBusinessDays({ ...input, holidays: [...input.holidays, { date: r.pick(off) }] }, a, n), b, `MR8 off seed ${seed}`);
      const extra = { ...input, holidays: [...input.holidays, { date: r.pick(on) }] };
      assert.equal(addBusinessDays(extra, a, n), nextBusinessDay(extra, b), `MR8 on seed ${seed}`);
    }
  }
});

test('calendar: MR3 week shift and 24x7 equals elapsed', () => {
  for (const seed of SEEDS(60)) {
    const r = R('cal-mr3', seed);
    const { input, start } = randomCalendar(r);
    const a = start + r.int(0, 1440) * MINUTE, b = a + r.int(0, 4 * 1440) * MINUTE;
    const W = 7 * DAY;
    const shifted = { ...input, holidays: input.holidays.map(h => ({ ...h, date: dateOf(parseDate(h.date) + 7) })) };
    // A UTC shift of one week keeps local wall times only when no DST transition lies in [a, b + 1 week].
    const y = new Date(a).getUTCFullYear();
    const crosses = [y, y + 1].flatMap(yy => transitionsOf(input.tz, yy)).some(t => t.at >= a - DAY && t.at <= b + W + DAY);
    if (!crosses) assert.equal(businessMs(shifted, a + W, b + W), businessMs(input, a, b), `MR3 seed ${seed} ${input.tz}`);
    assert.equal(businessMs({ tz: input.tz, businessHours: '24x7' }, a, b), b - a, `24x7 seed ${seed}`);
  }
});

test('time: local <-> instant round trip; gap times move later by the gap', () => {
  for (const seed of SEEDS(200)) {
    const r = R('tz-round', seed);
    const tz = r.pick(ZONES);
    const year = r.int(2020, 2037);
    // Half the draws sit on a transition date so gaps and folds are exercised.
    const trs = transitionsOf(tz, year);
    const day = trs.length && r.chance(0.5) ? localParts(r.pick(trs).at, tz).day : Math.floor(Date.UTC(year, 0, 1) / DAY) + r.int(0, 364);
    const minute = r.int(0, 1439);
    const t = fromLocal(day, minute * MINUTE, tz);
    const lp = localParts(t, tz);
    let gap = false;
    try { fromLocal(day, minute * MINUTE, tz, 'reject'); } catch (e) { if (!(e instanceof EbedLibError)) throw e; gap = e.code === 'TZ_GAP'; }
    if (gap) assert.equal(lp.day * 1440 + lp.minuteOfDay, day * 1440 + minute + 60, `gap ${tz} ${dateOf(day)} ${minute}`);
    else assert.deepEqual([lp.day, lp.minuteOfDay], [day, minute], `${tz} ${dateOf(day)} ${minute}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Obligation clock against a minute-stepping model

function randomHistory(r, start) {
  const h = [{ at: start, op: 'start' }];
  let t = start, running = true;
  for (let k = r.int(0, 5); k > 0; k--) {
    t += r.int(1, 2 * 1440) * MINUTE;
    h.push({ at: t, op: running ? 'pause' : 'resume' });
    running = !running;
  }
  if (r.chance(0.3)) { t += r.int(1, 1440) * MINUTE; h.push({ at: t, op: 'stop' }); }
  return h;
}
function bruteClock(raw, business, history, target, at) {
  // Active minutes up to `at`, and the end of the minute in which active time reaches the target (projected past `at`
  // only while running at `at`).
  const ops = history.filter(o => o.at <= at);
  const stateAt = t => { let s = 'idle'; for (const o of ops) { if (o.at > t) break; s = { start: 'running', pause: 'paused', resume: 'running', stop: 'stopped' }[o.op]; } return s; };
  let active = 0, due = null;
  const counts = t => stateAt(t) === 'running' && (!business || bizMinute(raw, t));
  const t0 = history[0].at;
  for (let t = t0; t < at; t += MINUTE) if (counts(t)) { active++; if (active === target && due === null) due = t + MINUTE; }
  if (due === null && stateAt(at) === 'running') {
    let acc = active;
    for (let t = at; t < at + 120 * DAY; t += MINUTE) if (!business || bizMinute(raw, t)) { acc++; if (acc === target) { due = t + MINUTE; break; } }
  }
  return { active, due };
}

test('clock: active time and due instant equal minute stepping; clock laws hold', () => {
  for (const seed of SEEDS(70)) {
    const r = R('clock', seed);
    const { input, start, raw } = randomCalendar(r);
    const business = r.chance(0.75);
    const targetMin = r.int(1, 48) * 15;
    const def = { target: { amount: targetMin, unit: business ? 'business-minutes' : 'minutes' }, calendar: input, warnings: [{ id: 'a', percent: 50 }, { id: 'b', percent: 75 }] };
    const history = randomHistory(r, start + r.int(0, 1440) * MINUTE);
    const at = history[history.length - 1].at + r.int(0, 3 * 1440) * MINUTE;
    const s = clockAt(def, history, at);
    const want = bruteClock(raw, business, history, targetMin, at);
    assert.equal(s.activeMs, want.active * MINUTE, `active seed ${seed}`);
    assert.equal(s.dueAt, want.due, `due seed ${seed} state ${s.state}`);
    // Laws: business elapsed <= actual elapsed; elapsed + pause = total; warnings ordered and not after due.
    assert.ok(s.businessElapsedMs <= s.actualElapsedMs);
    assert.equal(s.actualElapsedMs + s.actualPauseMs, s.totalMs);
    if (s.warnings[0].at !== null && s.warnings[1].at !== null) assert.ok(s.warnings[0].at <= s.warnings[1].at);
    if (s.dueAt !== null && s.warnings[1].at !== null) assert.ok(s.warnings[1].at <= s.dueAt);
    // A stopped clock does not change after its stop.
    if (s.state === 'stopped') assert.deepEqual(clockAt(def, history, at + 10 * DAY), s);
  }
});

test('clock: an added pause never increases elapsed business time and never brings the due instant forward', () => {
  for (const seed of SEEDS(70)) {
    const r = R('clock-mono', seed);
    const { input, start } = randomCalendar(r);
    const def = { target: { amount: r.int(1, 40) * 30, unit: 'business-minutes' }, calendar: input };
    const t0 = start + r.int(0, 1440) * MINUTE;
    const p = t0 + r.int(0, 3 * 1440) * MINUTE, q = p + r.int(1, 2 * 1440) * MINUTE;
    const plain = [{ at: t0, op: 'start' }];
    const paused = [{ at: t0, op: 'start' }, { at: p, op: 'pause' }, { at: q, op: 'resume' }];
    for (const at of [p, q, q + r.int(0, 4 * 1440) * MINUTE]) {
      const a = clockAt(def, plain, at), b = clockAt(def, paused, at);
      assert.ok(b.activeMs <= a.activeMs, `seed ${seed}`);
      if (a.dueAt !== null && b.dueAt !== null) assert.ok(b.dueAt >= a.dueAt, `due seed ${seed}`);
      if (b.breached) assert.ok(a.breached, `breach monotone seed ${seed}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Decision tables against a direct evaluation of structured tests

const STR = ['A', 'B', 'C'];
function randomTest(r, kind) {
  if (r.chance(0.25)) return { k: 'any', text: '-', f: () => true }; // grid inputs are never null
  let units;
  if (kind === 'int') {
    units = Array.from({ length: r.int(1, 2) }, () => {
      const x = r.int(-5, 15), y = x + r.int(0, 8);
      switch (r.int(0, 3)) {
        case 0: return { f: v => v === x, text: `${x}` };
        case 1: { const op = r.pick(['<', '<=', '>', '>=']); return { f: v => ({ '<': v < x, '<=': v <= x, '>': v > x, '>=': v >= x })[op], text: `${op} ${x}` }; }
        default: { const li = r.chance(0.5), hi = r.chance(0.5); return { f: v => (li ? v >= x : v > x) && (hi ? v <= y : v < y), text: `${li ? '[' : '('}${x}..${y}${hi ? ']' : ')'}` }; }
      }
    });
  } else if (kind === 'str') units = r.sample(STR, r.int(1, 2)).map(s => ({ f: v => v === s, text: `"${s}"` }));
  else { const b = r.chance(0.5); units = [{ f: v => v === b, text: `${b}` }]; }
  const pos = v => units.some(u => u.f(v));
  if (kind !== 'bool' && r.chance(0.2)) return { k: 'not', f: v => !pos(v), text: `not(${units.map(u => u.text).join(', ')})` };
  return { k: 'list', f: pos, text: units.map(u => u.text).join(', ') };
}
function randomTable(r) {
  const kinds = r.sample(['int', 'str', 'bool'], r.int(1, 3));
  const inputs = kinds.map((k, i) => ({ name: `x${i}`, type: { int: 'integer', str: 'string', bool: 'boolean' }[k] }));
  const hp = r.pick(['U', 'A', 'P', 'F', 'R', 'O', 'C', 'C+', 'C#', 'C<', 'C>']);
  const prio = r.shuffle([1, 2, 3, 4]);
  const rules = Array.from({ length: r.int(1, 6) }, () => ({ tests: kinds.map(k => randomTest(r, k)), out: r.int(1, 4) }));
  const table = {
    id: 'rand', hitPolicy: hp, inputs, outputs: [{ name: 'y', type: 'integer', ...(hp === 'P' || hp === 'O' || r.chance(0.3) ? { values: prio } : {}) }],
    rules: rules.map(x => ({ when: x.tests.map(t => t.text), then: x.out })),
  };
  if (r.chance(0.2)) table.default = r.pick(prio);
  return { table, rules, kinds, prio };
}
// DMN 1.3 §8.2.10 / §10.3.2.9, restated for one integer output.
function bruteDecide({ table, rules, prio }, xs) {
  const matched = rules.map((x, i) => (x.tests.every((t, k) => t.f(xs[k])) ? i : -1)).filter(i => i >= 0);
  if (!matched.length) return { result: table.default ?? null };
  const outs = matched.map(i => rules[i].out);
  const rank = o => (table.outputs[0].values ? prio.indexOf(o) : 0);
  const byPrio = [...matched].sort((a, b) => rank(rules[a].out) - rank(rules[b].out) || a - b).map(i => rules[i].out);
  switch (table.hitPolicy) {
    case 'U': return matched.length > 1 ? { error: true } : { result: outs[0] };
    case 'A': return new Set(outs).size > 1 ? { error: true } : { result: outs[0] };
    case 'P': return { result: byPrio[0] };
    case 'F': return { result: outs[0] };
    case 'R': case 'C': return { result: outs };
    case 'O': return { result: byPrio };
    case 'C+': return { result: outs.reduce((a, b) => a + b, 0) };
    case 'C#': return { result: outs.length };
    case 'C<': return { result: Math.min(...outs) };
    case 'C>': return { result: Math.max(...outs) };
    default: throw new Error(table.hitPolicy);
  }
}
const GRID = { int: Array.from({ length: 25 }, (_, i) => i - 7), str: [...STR, 'D'], bool: [true, false] };
function* grid(kinds, k = 0, acc = []) { if (k === kinds.length) { yield acc; return; } for (const v of GRID[kinds[k]]) yield* grid(kinds, k + 1, [...acc, v]); }
const asInput = (table, xs) => Object.fromEntries(table.inputs.map((inp, k) => [inp.name, xs[k]]));
function libDecide(table, xs) {
  try { return { result: decide(table, asInput(table, xs)).result }; } catch (e) { if (e instanceof EbedLibError && e.code === 'HIT_POLICY') return { error: true }; throw e; }
}

test('decision tables: every hit policy equals the direct model on the whole input grid', () => {
  let cells = 0;
  for (const seed of SEEDS(150)) {
    const t = randomTable(R('dt', seed));
    for (const xs of grid(t.kinds)) { assert.deepEqual(libDecide(t.table, xs), bruteDecide(t, xs), `seed ${seed} ${t.table.hitPolicy} ${JSON.stringify(xs)}`); cells++; }
  }
  assert.ok(cells > 10000);
});

test('decision tables: the static checker is exact (gaps, overlaps, conflicts) on the grid', () => {
  for (const seed of SEEDS(150)) {
    const t = randomTable(R('dt-check', seed));
    const issues = checkTable(t.table);
    const matchedAt = xs => t.rules.map((x, i) => (x.tests.every((q, k) => q.f(xs[k])) ? i : -1)).filter(i => i >= 0);
    let gap = false;
    const overlap = new Set(), conflict = new Set();
    for (const xs of grid(t.kinds)) {
      const m = matchedAt(xs);
      if (!m.length) gap = true;
      for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
        overlap.add(`${m[i] + 1},${m[j] + 1}`);
        if (t.rules[m[i]].out !== t.rules[m[j]].out) conflict.add(`${m[i] + 1},${m[j] + 1}`);
      }
    }
    const reported = code => new Set(issues.filter(i => i.code === code && i.rules).map(i => i.rules.join(',')));
    assert.equal(issues.some(i => i.code === 'TABLE_GAP'), gap && t.table.default === undefined, `gap seed ${seed}`);
    if (t.table.hitPolicy === 'U') assert.deepEqual(reported('TABLE_OVERLAP'), overlap, `overlap seed ${seed}`);
    else if (t.table.hitPolicy === 'A') assert.deepEqual(reported('TABLE_OVERLAP'), conflict, `conflict seed ${seed}`);
    else assert.equal(reported('TABLE_OVERLAP').size, 0);
    for (const i of issues.filter(x => x.witness && x.code !== 'TABLE_SHADOWED')) {
      const xs = t.table.inputs.map(inp => i.witness[inp.name]);
      const m = matchedAt(xs);
      if (i.code === 'TABLE_GAP') assert.equal(m.length, 0, `gap witness seed ${seed}`);
      else assert.ok(i.rules.every(id => m.includes(Number(id) - 1)), `witness seed ${seed}`);
    }
  }
});

test('decision tables: rule order matters only for FIRST and RULE ORDER (DMN 1.3 §8.2.10 Note 2)', () => {
  for (const seed of SEEDS(150)) {
    const r = R('dt-perm', seed);
    const t = randomTable(r);
    if (['F', 'R'].includes(t.table.hitPolicy)) continue;
    const order = r.shuffle(t.table.rules.map((_, i) => i));
    const permuted = { ...t.table, rules: order.map(i => t.table.rules[i]) };
    const tieFree = !checkTable(t.table).some(i => i.code === 'HIT_POLICY');
    for (const xs of grid(t.kinds)) {
      const a = libDecide(t.table, xs), b = libDecide(permuted, xs);
      if (t.table.hitPolicy === 'C' && Array.isArray(a.result) && Array.isArray(b.result)) assert.deepEqual([...a.result].sort(), [...b.result].sort(), `seed ${seed}`);
      else if ((t.table.hitPolicy !== 'P' && t.table.hitPolicy !== 'O') || tieFree) assert.deepEqual(a, b, `seed ${seed} ${t.table.hitPolicy}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Saga planner and ledger grading

function randomSaga(r) {
  const n = r.int(1, 6);
  const pivot = r.chance(0.3) ? r.int(0, n - 1) : -1;
  const steps = Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, kind: pivot < 0 || i < pivot ? 'compensable' : i === pivot ? 'pivot' : 'retriable',
    do: { system: `sys${i % 3}`, op: `do${i}` }, undo: i < pivot || pivot < 0 ? (r.chance(0.85) ? { system: `sys${i % 3}`, op: `undo${i}` } : null) : null,
    subject: { order: 'O-9', step: i }, itemArg: 'item',
  }));
  return { id: `saga-${r.int(1, 999)}`, steps };
}
function randomExecution(r, saga) {
  // Sequential execution up to step k; step k ends in a random way; items on some steps (all committed before k).
  const n = saga.steps.length, k = r.int(0, n);
  const steps = {}, committed = [];
  saga.steps.forEach((s, i) => {
    const items = r.chance(0.3) ? ['a', 'b', 'c'].slice(0, r.int(1, 3)) : null;
    const unit = ending => (items ? { items: Object.fromEntries(items.map((it, j) => [it, j === 0 ? ending : r.pick([{ outcome: 'ok' }, ending])])) } : ending);
    if (i < k) { steps[s.id] = unit({ outcome: 'ok' }); }
    else if (i === k) steps[s.id] = unit(r.pick([{ outcome: 'error' }, { outcome: 'unknown', status: 'committed' }, { outcome: 'unknown', status: 'not-found' }, { outcome: 'unknown' }, { outcome: 'ok' }]));
    else steps[s.id] = { outcome: 'not-started' };
    const o = steps[s.id];
    for (const [item, u] of o.items ? Object.entries(o.items) : [[null, o]]) {
      if (u.outcome === 'ok' || (u.outcome === 'unknown' && u.status === 'committed')) committed.push({ step: s, i, item });
    }
  });
  return { observed: { steps }, committed, abort: r.chance(0.3) ? { reason: 'cancel' } : null };
}

test('saga: plans equal the set/order model; keys deterministic and distinct', () => {
  const seen = new Map();
  for (const seed of SEEDS(199)) {
    const r = R('saga', seed);
    const saga = randomSaga(r);
    const { observed, committed, abort } = randomExecution(r, saga);
    const plan = planSaga(saga, observed, { abort });
    assert.deepEqual(planSaga(saga, observed, { abort }), plan, 'deterministic');
    seen.set(plan.action, (seen.get(plan.action) ?? 0) + 1);
    const units = Object.entries(observed.steps).flatMap(([id, o]) => (o.items ? Object.entries(o.items).map(([it, u]) => [id, it, u]) : [[id, null, o]]));
    const unknown = units.filter(([, , u]) => u.outcome === 'unknown' && !u.status);
    if (unknown.length) { assert.equal(plan.action, 'query-status'); assert.deepEqual(plan.units.map(u => [u.step, u.item]), unknown.map(([s, it]) => [s, it])); continue; }
    const failed = units.some(([, , u]) => u.outcome === 'error');
    const pivot = saga.steps.findIndex(s => s.kind === 'pivot');
    const pivotDone = pivot >= 0 && committed.some(c => c.i === pivot) && units.filter(([s]) => s === `s${pivot}`).every(([, , u]) => u.outcome === 'ok' || u.status === 'committed');
    if (abort && pivotDone) { assert.equal(plan.action, 'abort-refused'); continue; }
    if (!failed && !abort) { assert.ok(['complete', 'continue'].includes(plan.action), plan.action); continue; }
    const failIdx = units.findIndex(([, , u]) => u.outcome === 'error');
    if (failed && pivotDone && Number(units[failIdx][0].slice(1)) > pivot) { assert.equal(plan.action, 'retry-forward'); continue; }
    assert.equal(plan.action, 'compensate', `seed ${seed}`);
    const want = [...committed].reverse().filter(c => c.step.undo).map(c => `${c.step.id}/${c.item}`);
    assert.deepEqual(plan.compensations.map(c => `${c.step}/${c.item}`), want, `seed ${seed}`);
    assert.equal(new Set(plan.compensations.map(c => c.key)).size, plan.compensations.length);
  }
  for (const a of ['compensate', 'query-status', 'continue']) assert.ok((seen.get(a) ?? 0) >= 5, `action ${a} exercised: ${seen.get(a) ?? 0}`);
});

test('ledger: an exact compensation trajectory passes; each single mistake is caught with its code', () => {
  let graded = 0;
  for (const seed of SEEDS(199)) {
    const r = R('saga-ledger', seed);
    const saga = randomSaga(r);
    const { observed, abort } = randomExecution(r, saga);
    const plan = planSaga(saga, observed, { abort });
    if (plan.action !== 'compensate' || plan.compensations.length < 2) continue;
    graded++;
    const t0 = Date.UTC(2026, 5, 1, 12);
    const expected = compensationEffects(saga, plan, { window: { earliest: t0, latest: t0 + HOUR } });
    const rows = plan.compensations.map((c, i) => ({ at: t0 + (i + 1) * MINUTE, system: c.system, op: c.op, key: `k${i}`, args: c.subject, committed: true }));
    const g = rows2 => matchEffects({ expected, rows: rows2, end: t0 + DAY });
    assert.equal(g(rows).ok, true, `seed ${seed}`);
    const i = r.int(0, rows.length - 2);
    const swapped = rows.map(x => ({ ...x }));
    [swapped[i].system, swapped[i].op, swapped[i].args, swapped[i + 1].system, swapped[i + 1].op, swapped[i + 1].args] = [rows[i + 1].system, rows[i + 1].op, rows[i + 1].args, rows[i].system, rows[i].op, rows[i].args];
    assert.ok(g(swapped).divergences.some(d => d.code === 'order'), `swap seed ${seed}`);
    const dropped = rows.filter((_, j) => j !== i);
    assert.ok(g(dropped).divergences.some(d => d.code === 'missed' && d.lid === expected[i].lid), `drop seed ${seed}`);
    const dup = [...rows, { ...rows[i], at: t0 + 30 * MINUTE, key: 'fresh' }];
    assert.deepEqual(g(dup).divergences.map(d => d.code), ['key-split', 'duplicate'], `dup seed ${seed}`);
    const stray = [...rows, { at: t0 + 31 * MINUTE, system: 'sysX', op: 'undoX', args: { order: 'O-9' }, committed: true }];
    assert.deepEqual(g(stray).divergences.map(d => d.code), ['outside-allowed'], `stray seed ${seed}`);
    const early = rows.map((x, j) => (j === 0 ? { ...x, at: t0 - MINUTE } : x));
    assert.equal(g(early).first.code, 'early', `early seed ${seed}`);
  }
  assert.ok(graded >= 15, `graded ${graded}`);
});

test('835: random balanced remittances balance; any single amount off by one is caught', () => {
  for (const seed of SEEDS(100)) {
    const r = R('835', seed);
    const claims = Array.from({ length: r.int(1, 4) }, (_, ci) => {
      const lines = Array.from({ length: r.int(0, 3) }, (_, li) => {
        const svc02 = r.int(1000, 50000), adjustments = Array.from({ length: r.int(0, 3) }, () => ({ group: r.pick(['CO', 'PR', 'OA']), reason: String(r.int(1, 200)), amount: r.int(-500, 5000) }));
        return { id: `L${li}`, svc02, svc03: svc02 - adjustments.reduce((a, x) => a + x.amount, 0), adjustments };
      });
      const adjustments = Array.from({ length: r.int(0, 2) }, () => ({ group: 'CO', reason: '45', amount: r.int(0, 3000) }));
      const clp03 = lines.length ? lines.reduce((a, l) => a + l.svc02, 0) : r.int(1000, 90000);
      const lineAdj = lines.reduce((a, l) => a + l.adjustments.reduce((b, x) => b + x.amount, 0), 0);
      return { id: `C${ci}`, clp03, clp04: clp03 - adjustments.reduce((a, x) => a + x.amount, 0) - lineAdj, adjustments, lines };
    });
    const plb = Array.from({ length: r.int(0, 3) }, () => ({ reason: r.pick(['L6', 'WO', 'FB']), amount: r.int(-2000, 2000) || 1 }));
    const remit = { bpr02: claims.reduce((a, c) => a + c.clp04, 0) - plb.reduce((a, p) => a + p.amount, 0), claims, plb };
    assert.deepEqual(balance835(remit), [], `seed ${seed}`);
    // Every amount takes part in at least one identity: perturb each in turn.
    const paths = [['bpr02']];
    claims.forEach((c, ci) => {
      paths.push(['claims', ci, 'clp03'], ['claims', ci, 'clp04']);
      c.adjustments.forEach((_, ai) => paths.push(['claims', ci, 'adjustments', ai, 'amount']));
      c.lines.forEach((l, li) => { paths.push(['claims', ci, 'lines', li, 'svc02'], ['claims', ci, 'lines', li, 'svc03']); l.adjustments.forEach((_, ai) => paths.push(['claims', ci, 'lines', li, 'adjustments', ai, 'amount'])); });
    });
    plb.forEach((_, pi) => paths.push(['plb', pi, 'amount']));
    for (const p of paths) {
      const m = structuredClone(remit);
      let o = m; for (const k of p.slice(0, -1)) o = o[k];
      o[p[p.length - 1]] += r.chance(0.5) ? 1 : -1;
      assert.ok(balance835(m).length > 0, `seed ${seed} ${p.join('.')}`);
    }
  }
});
