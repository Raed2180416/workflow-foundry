// E7 N-version SLA clock (DESIGN.md §10 first bullet; README K1 "N-version"; review 2026-10-15): an independent
// business-time calculator that steps minute by minute with Intl.DateTimeFormat (Node's ICU zone data), written from
// SPEC-E R4.4 alone, compared with the oracle's SLA engine (sla.mjs, which counts business time with
// beds/ebed/lib/calendar.mjs on lib/time.mjs's pinned zone rules) on
//   1. every SLA of every incident of the dev worlds (default 1001-1012 at d1-d5) on the world's planned timeline, with
//      the approval task created at its earliest instant and answered by the world's incident-manager plan: segments,
//      breach instant D, every escalation threshold, the planned breach of the start record and of each resume, the
//      elapsed and business-elapsed values of a stop, and the breach flag; and every R6 deadline (the caller deadline
//      after an awaiting-caller hold, the confirmation deadline after a resolution) against transition.mjs
//      businessDaysAfter;
//   2. a fuzz of SLA lifecycles across the 2026 clock changes of the three zones, on the world calendars and on
//      synthetic calendars whose intervals contain the clock change (the night-shift form of golden G21), with Sunday
//      business hours (every 2026 clock change of these zones falls on a Sunday) and partial-day holidays.
// $0, no model calls. Shares no code with sla.mjs, lib/calendar.mjs or lib/time.mjs: it imports sla.mjs and
// transition.mjs only as the system under test, and controls.mjs only for the planned view.
//
// R4.4 as implemented here, minute by minute: every real minute [m, m + 1 min) gets the local date, ISO weekday and wall
// clock that Intl gives for its first instant in the schedule's zone. On a local date d of a business weekday that is
// not a whole-day holiday, an interval [s, e) runs from the first minute of d whose wall clock reads at least s to the
// first minute of d whose wall clock reads at least e (the end of d for 24:00): "from the instant the local clock first
// reads its start to the instant it first reads its end, and each real instant in between counts once". A partial
// holiday [from, to) of d is cut out the same way. 24x7 counts every running minute. D (and each threshold) is the end of
// the minute in which business time first reaches its amount (S4: at a closing time, not at the next opening).
//
//   node beds/ebed/e7/tools/nversion.mjs [--seeds 1001-1012] [--difficulties 1-5] [--fuzz 2000] [--json out.json]
// Fuzz salt: ebed-fuzz/e7/intl-nversion/<dev seed>/<i> over the dev seeds given (the run uses only dev seeds 1001-1199).
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../world.mjs';
import { actors } from '../actors.mjs';
import { plannedView } from '../controls.mjs';
import { historyOf, editionAt, businessDaysAfter } from '../transition.mjs';
import { slaTimeline } from '../sla.mjs';
import { rng } from '../../../lib/rng.mjs';

const MIN = 60_000;
const DAY = 1440 * MIN;
const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const RE = /^(\w{3}), (\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2})$/;
const clockMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const isoZ = m => (m === null || m === undefined ? null : new Date(m).toISOString().replace('.000Z', 'Z'));

// ---------------------------------------------------------------------------------------------------------------------
// The minute stepper.

/**
 * A minute grid [from, to) (whole minutes) with, per zone, each minute's local date, ISO weekday and wall clock from
 * Intl.DateTimeFormat, and, per (calendar, zone), the prefix sums of its business minutes. Queries outside the grid's
 * inner part (two days from either edge) throw: a date at the grid's edge may be incomplete.
 */
export class MinuteStepper {
  constructor({ from = Date.UTC(2026, 0, 20), to = Date.UTC(2026, 11, 1) } = {}) {
    this.base = Math.floor(from / MIN) * MIN;
    this.n = Math.floor((to - this.base) / MIN);
    this.zones = new Map();
    this.cals = new Map();
    this.formatCalls = 0;
  }
  idx(ms) {
    const i = (ms - this.base) / MIN;
    if (!Number.isInteger(i)) throw new Error(`stepper: ${isoZ(ms)} is not a whole minute`);
    if (i < 2 * 1440 || i > this.n - 2 * 1440) throw new RangeError(`stepper: ${isoZ(ms)} outside the grid`);
    return i;
  }
  /** Per-minute local date (days since 1970-01-01), wall-clock minute of the day and ISO weekday in `tz` (Intl). */
  zone(tz) {
    let z = this.zones.get(tz);
    if (z) return z;
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const day = new Int32Array(this.n), tod = new Int16Array(this.n), wd = new Int8Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const s = f.format(this.base + i * MIN);
      const m = RE.exec(s);
      if (!m) throw new Error(`stepper: unexpected Intl output ${JSON.stringify(s)}`);
      day[i] = Date.UTC(+m[4], +m[2] - 1, +m[3]) / DAY;
      tod[i] = +m[5] * 60 + +m[6];
      wd[i] = WD[m[1]];
      if (i && day[i] < day[i - 1]) throw new Error(`stepper: local date goes back in ${tz} at ${isoZ(this.base + i * MIN)}`);
    }
    this.formatCalls += this.n;
    // The index range [lo, hi) of every local date.
    const range = new Map();
    for (let i = 0; i < this.n; i++) {
      const r = range.get(day[i]);
      if (r) r[1] = i + 1; else range.set(day[i], [i, i + 1]);
    }
    z = { tz, day, tod, wd, range };
    this.zones.set(tz, z);
    return z;
  }
  /** Prefix sums of business minutes of `cal` (`{ businessHours, holidays }`, '24x7' allowed) bound to `tz`. */
  calendar(cal, tz) {
    const key = `${tz}\u0000${JSON.stringify({ b: cal.businessHours, h: cal.holidays ?? [] })}`;
    let c = this.cals.get(key);
    if (c) return c;
    const z = this.zone(tz);
    const open = new Uint8Array(this.n);
    const bh = cal.businessHours;
    if (bh === '24x7') open.fill(1);
    else {
      const first = (lo, hi, t) => { for (let i = lo; i < hi; i++) if (z.tod[i] >= t) return i; return hi; };
      const holidays = new Map();
      for (const h of cal.holidays ?? []) {
        const d = Date.parse(`${h.date}T00:00:00Z`) / DAY;
        if (!holidays.has(d)) holidays.set(d, []);
        holidays.get(d).push(h.from === undefined ? null : [clockMin(h.from), clockMin(h.to)]);
      }
      for (const [d, [lo, hi]] of z.range) {
        if (!bh.days.includes(z.wd[lo])) continue;
        const hs = holidays.get(d) ?? [];
        if (hs.includes(null)) continue;                                         // a whole-day holiday closes the date
        for (const [s, e] of bh.hours) {
          const S = first(lo, hi, clockMin(s)), E = clockMin(e) >= 1440 ? hi : first(lo, hi, clockMin(e));
          for (let i = S; i < E; i++) open[i] = 1;
        }
        for (const [f, t] of hs) {                                              // a partial holiday cuts [from, to)
          const S = first(lo, hi, f), E = t >= 1440 ? hi : first(lo, hi, t);
          for (let i = S; i < E; i++) open[i] = 0;
        }
      }
    }
    const cum = new Int32Array(this.n + 1);
    for (let i = 0; i < this.n; i++) cum[i + 1] = cum[i] + open[i];
    c = { cum, tz };
    this.cals.set(key, c);
    return c;
  }
  /** Business minutes of [a, b) (wall minutes when `c` is null, 24x7). */
  minutes(c, a, b) {
    if (b <= a) return 0;
    if (c === null) return (b - a) / MIN;
    return c.cum[this.idx(b)] - c.cum[this.idx(a)];
  }
  /** The first instant u >= a at which business time since a reaches `need` minutes. */
  reach(c, a, need) {
    if (!Number.isInteger(need) || need < 0) throw new Error(`stepper: bad amount ${need}`);
    if (c === null) return a + need * MIN;
    const ia = this.idx(a);
    if (need === 0) return a;
    const want = c.cum[ia] + need;
    let lo = ia + 1, hi = this.n - 2 * 1440;
    if (c.cum[hi] < want) throw new RangeError(`stepper: ${need} business minutes from ${isoZ(a)} reach beyond the grid`);
    while (lo < hi) { const mid = (lo + hi) >> 1; if (c.cum[mid] >= want) hi = mid; else lo = mid + 1; }
    return this.base + lo * MIN;
  }
  /** Over running segments [[s, e]] (the last may be [s, null], open): the instant business time reaches `need`, or null. */
  reachOver(c, segs, need) {
    let acc = 0;
    for (const [s, e] of segs) {
      if (e === null) return this.reach(c, s, need - acc);
      const m = this.minutes(c, s, e);
      if (acc + m >= need) return this.reach(c, s, need - acc);
      acc += m;
    }
    return null;
  }
}

/** The 2026 clock changes of a zone, found with Intl itself (an offset change between two consecutive hours). */
export function clockChanges(tz, from = Date.UTC(2026, 0, 1), to = Date.UTC(2027, 0, 1)) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const off = ms => { const m = /^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2})$/.exec(f.format(ms)); return (Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]) - ms) / MIN; };
  const out = [];
  let prev = off(from);
  for (let t = from + 60 * MIN; t < to; t += 60 * MIN) { const o = off(t); if (o !== prev) out.push({ at: t, from: prev, to: o }); prev = o; }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// An SLA re-evaluated by the stepper from its records (R4.4, R4.6, R5.1, S2-S4, S13).

/**
 * `ops` are sla.mjs's records ({ op, at }), `end` its end ({ at } or null), `T` the target in minutes, `percents` the
 * escalation percents; `c` the stepper calendar (null for 24x7). Returns the stepper's view of the same SLA.
 */
export function stepSla(stepper, c, { ops, startAt, end, T, percents }) {
  const segs = [];
  let from = null;
  for (const o of ops) {
    if (o.op === 'start' || o.op === 'resume') from = o.at;
    else if ((o.op === 'pause' || o.op === 'stop' || o.op === 'cancel') && from !== null) { segs.push([from, o.at]); from = null; }
  }
  if (from !== null) segs.push([from, null]);
  const D = stepper.reachOver(c, segs, T);
  const thresholds = percents.map(p => {
    const need = Math.floor((T * p) / 100);
    let at = need >= T ? D : stepper.reachOver(c, segs, need);
    if (at !== null && end && at > end.at) at = null;
    return { percent: p, at };
  });
  const planned = { start: stepper.reach(c, startAt, T), resumes: [] };
  for (const o of ops) if (o.op === 'resume') planned.resumes.push([o.at, stepper.reachOver(c, [...segs.filter(([, b]) => b !== null && b <= o.at), [o.at, null]], T)]);
  const closed = segs.filter(([, b]) => b !== null);
  const stopped = end?.op === 'stop';
  return {
    segments: segs, D, thresholds, planned, breached: end !== null && end !== undefined && D !== null,
    elapsedMinutes: stopped ? closed.reduce((n, [a, b]) => n + (b - a) / MIN, 0) : null,
    businessElapsedMinutes: stopped ? closed.reduce((n, [a, b]) => n + stepper.minutes(c, a, b), 0) : null,
  };
}

/** Field-by-field differences between sla.mjs's SLA object and the stepper's re-evaluation. */
export function slaDiffs(s, mine) {
  const out = [];
  const eq = (k, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, sla: a, intl: b }); };
  eq('segments', s.segments, mine.segments);
  eq('D', isoZ(s.D), isoZ(mine.D));
  for (const t of mine.thresholds) eq(`threshold ${t.percent}%`, isoZ(s.thresholds.find(x => x.percent === t.percent)?.at ?? null), isoZ(t.at));
  eq('planned start', isoZ(s.planned.start), isoZ(mine.planned.start));
  for (const [at, p] of mine.planned.resumes) eq(`planned resume ${isoZ(at)}`, isoZ(s.planned.resumes.get(at) ?? null), isoZ(p));
  eq('breached', s.breached, mine.breached);
  eq('elapsedMinutes', s.elapsedMinutes, mine.elapsedMinutes);
  eq('businessElapsedMinutes', s.businessElapsedMinutes, mine.businessElapsedMinutes);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The world's planned timeline with the approval (shared with metamorphic.mjs).

/**
 * The planned view of a case (controls.mjs plannedView) at instant `at` (default the horizon), with the approval task
 * created at its earliest instant (when the priority first became 1, R7.1) and answered as the world's incident-manager
 * plan says (actors.mjs; no host noise): what the reference policy does on the world's own timeline.
 */
export function planView(world, c, at = null) {
  const v = plannedView(world, c);
  const t = v.truth;
  const out = { ...v, tasks: [], taskEvents: [] };
  if (t.subject !== null) {
    const H = historyOf(world, v);
    const x = H?.appr?.x ?? null;
    if (x !== null && (H.appr.moot === null || H.appr.moot > x) && !(t.backlog && x < Date.parse(world.t0))) {
      const id = `mia:${t.subject}#1`;
      const seqAt = v.events.filter(e => e.at <= x).length - 0.5;           // after every event of its instant
      out.tasks = [{ at: x, seq: seqAt, instance: 'plan', task: { id, kind: 'majorIncidentApproval' }, case: c, ordinal: 1, user: null }];
      const a = actors.answer(world, { kind: 'majorIncidentApproval', case: c, ordinal: 1 });
      if (a) out.taskEvents = [{ at: x + a.delayMinutes * MIN, seq: 1e6, type: 'humanTask.answered', payload: { taskId: id, answer: a.value }, instance: 'plan', case: c }];
    }
  }
  if (at === null) return out;
  const before = e => e.at <= at;
  return { ...out, at, events: out.events.filter(before), tasks: out.tasks.filter(before), taskEvents: out.taskEvents.filter(before) };
}

/** sla.mjs's SLAs of a history, built the way transition.mjs builds them (snapshots merged per instant). */
export function slasOf(world, H) {
  const snaps = [];
  for (const ch of H.changes) {
    if (snaps.length && snaps.at(-1).at === ch.at) snaps[snaps.length - 1] = { at: ch.at, fields: ch.fields };
    else snaps.push({ at: ch.at, fields: ch.fields });
  }
  const svc = new Map(world.master.services.map(s => [s.service, s])), grp = new Map(world.master.groups.map(g => [g.group, g]));
  const ctx = { world, defsAt: x => editionAt(world, x).defs, scheduleOf: { service: id => svc.get(id).supportSchedule, group: id => grp.get(id).schedule } };
  return slaTimeline(ctx, { number: H.inc.number, openedAt: H.inc.openedAt, callerTz: H.inc.caller?.timezone ?? null, ciTz: H.inc.ciRow?.timezone ?? null }, snaps);
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 1: every SLA and R6 deadline of a world.

/** The time-zone binding of R4.3, written here again: the calendar's own tz, else the first source with a zone. */
function bindTz(world, s, H) {
  if (s.schedule === null) return null;
  const cal = world.calendars[s.schedule];
  if (cal.tz) return cal.tz;
  const zones = { caller: H.inc.caller?.timezone ?? null, ci: H.inc.ciRow?.timezone ?? null, definition: s.def.timezone?.definition ?? null };
  return (s.def.timezone?.sources ?? []).map(k => zones[k] ?? null).find(z => z !== null) ?? null;
}

export function checkWorld(world, stepper, { maxDiffs = 20 } = {}) {
  const out = { world: world.id, cases: 0, slas: 0, byDef: {}, schedules: {}, dstSpanning: 0, stops: 0, thresholds: 0, resumes: 0, deadlines: 0, diffs: [] };
  const changes = ['Europe/Amsterdam', 'America/New_York', 'Australia/Sydney'].flatMap(tz => clockChanges(tz).map(x => ({ tz, at: x.at })));
  const push = d => { if (out.diffs.length < maxDiffs) out.diffs.push(d); else out.more = (out.more ?? 0) + 1; };
  for (const [c, t] of Object.entries(world.truth.cases)) {
    if (t.subject === null) continue;
    const view = planView(world, c);
    const H = historyOf(world, view);
    if (!H?.inc?.opened) continue;
    out.cases++;
    for (const s of slasOf(world, H)) {
      out.slas++;
      out.byDef[s.definition] = (out.byDef[s.definition] ?? 0) + 1;
      const key = `${s.schedule ?? '24x7'}@${s.timezone ?? '-'}`;
      out.schedules[key] = (out.schedules[key] ?? 0) + 1;
      const tz = bindTz(world, s, H);
      if (tz !== s.timezone) push({ case: c, sla: s.id, field: 'timezone', sla: s.timezone, intl: tz });
      const cal = s.schedule === null ? null : stepper.calendar(world.calendars[s.schedule], tz);
      let mine;
      try {
        mine = stepSla(stepper, cal, { ops: s.ops, startAt: s.startAt, end: s.end, T: s.def.target.minutes, percents: (s.def.escalations ?? []).map(e => e.percent) });
      } catch (e) { push({ case: c, sla: s.id, field: 'stepper', error: String(e.message) }); continue; }
      for (const d of slaDiffs(s, mine)) push({ case: c, sla: s.id, schedule: key, ...d });
      if (s.end?.op === 'stop') out.stops++;
      out.thresholds += mine.thresholds.filter(x => x.at !== null).length;
      out.resumes += mine.planned.resumes.length;
      const last = Math.max(s.end?.at ?? 0, s.D ?? 0, s.startAt);
      if (cal && changes.some(x => x.tz === s.timezone && x.at > s.startAt && x.at < last)) out.dstSpanning++;
    }
    // R6: the caller deadline D (callerReplyDays after an awaiting-caller hold) and D2 (resolvedCloseDays after a
    // resolution) on the service desk calendar, against businessDaysAfter.
    for (const l of H.lids) {
      const field = l.op === 'hold' && l.match.reason === 'awaitingCaller' ? 'callerReplyDays' : l.op === 'resolve' ? 'resolvedCloseDays' : null;
      if (!field) continue;
      const pol = editionAt(world, l.at).policy;
      const sd = world.calendars[pol.serviceDeskCalendar];
      const mine = stepper.reach(stepper.calendar(sd, sd.tz ?? pol.systemTimeZone), l.at, pol[field] * pol.businessDayMinutes);
      const theirs = businessDaysAfter(world, l.at, field);
      out.deadlines++;
      if (mine !== theirs) push({ case: c, field, from: isoZ(l.at), sla: isoZ(theirs), intl: isoZ(mine) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 2: the fuzz across the clock changes.

const ZONES = ['Europe/Amsterdam', 'America/New_York', 'Australia/Sydney'];
const ALL = [1, 2, 3, 4, 5, 6, 7];
/** Calendar templates (the world's three, the floating extended one, and synthetic ones with intervals over the change). */
const TEMPLATES = {
  'std-0900-1700': { businessHours: { days: [1, 2, 3, 4, 5], hours: [['09:00', '17:00']] } },
  'us-0800-1700': { businessHours: { days: [1, 2, 3, 4, 5], hours: [['08:00', '17:00']] } },
  'au-0830-1700': { businessHours: { days: [1, 2, 3, 4, 5], hours: [['08:30', '17:00']] } },
  'ext-0700-1900': { businessHours: { days: [1, 2, 3, 4, 5, 6], hours: [['07:00', '19:00']] } },
  'night-0130-0330': { businessHours: { days: ALL, hours: [['01:30', '03:30']] } },
  'all-day': { businessHours: { days: ALL, hours: [['00:00', '24:00']] } },
  'sun-0100-0400': { businessHours: { days: [7], hours: [['01:00', '04:00']] } },
  'split-0000-0230-0300-0500': { businessHours: { days: ALL, hours: [['00:00', '02:30'], ['03:00', '05:00']] } },
  'edges-0200-0230-0245-0315': { businessHours: { days: ALL, hours: [['02:00', '02:30'], ['02:45', '03:15']] } },
};
/** A random calendar: 1-3 intervals on a 15-minute grid in 00:00-06:00 or over the whole day, Sunday always included. */
function randomCalendar(r) {
  const k = r.int(1, 3);
  const cuts = new Set();
  const span = r.chance(0.7) ? 24 : 96;                                // quarter hours: 00:00-06:00 or the whole day
  while (cuts.size < 2 * k) cuts.add(r.int(0, span));
  const q = [...cuts].sort((a, b) => a - b);
  const hm = x => `${String(Math.floor(x / 4)).padStart(2, '0')}:${String((x % 4) * 15).padStart(2, '0')}`;
  const hours = [];
  for (let i = 0; i < q.length; i += 2) hours.push([hm(q[i]), hm(q[i + 1])]);
  const days = [...new Set([7, ...ALL.filter(() => r.chance(0.5))])].sort((a, b) => a - b);
  return { businessHours: { days, hours } };
}

export function fuzzDst(stepper, { seeds = [1001], n = 500, maxDiffs = 20 } = {}) {
  const out = { cases: 0, skipped: 0, crossing: 0, inInterval: 0, partialHoliday: 0, byZone: {}, diffs: [] };
  const changes = Object.fromEntries(ZONES.map(tz => [tz, clockChanges(tz)]));
  const push = d => { if (out.diffs.length < maxDiffs) out.diffs.push(d); else out.more = (out.more ?? 0) + 1; };
  const AWAIT = { when: [{ field: 'state', in: ['onHold'] }, { field: 'holdReason', in: ['awaitingCaller'] }] };
  for (const seed of seeds) {
    for (let i = 0; i < n; i++) {
      const r = rng('ebed-fuzz', 'e7', 'intl-nversion', seed, i);
      const tz = r.pick(ZONES);
      const ch = r.pick(changes[tz]);
      const tname = r.chance(0.25) ? 'random' : r.pick(Object.keys(TEMPLATES));
      const cal = structuredClone(tname === 'random' ? randomCalendar(r) : TEMPLATES[tname]);
      const changeDate = new Date(ch.at + ch.from * MIN).toISOString().slice(0, 10);
      cal.holidays = [];
      if (r.chance(0.2)) cal.holidays.push({ date: changeDate, from: r.pick(['00:30', '01:45', '02:15', '02:30']), to: r.pick(['02:45', '03:15', '03:30', '04:00']) });
      if (r.chance(0.15)) cal.holidays.push({ date: new Date(ch.at + (ch.from + r.pick([-1, 1]) * 1440) * MIN).toISOString().slice(0, 10) });
      cal.holidays = cal.holidays.filter(h => h.from === undefined || clockMin(h.from) < clockMin(h.to));
      cal.id = 'FZ'; cal.tz = tz;
      const world = { calendars: { FZ: cal } };
      // A lifecycle around the change: open 0-3 days before it, holds and resumes, maybe a stop.
      let at = ch.at - r.int(0, 3 * 1440) * MIN - r.int(0, 59) * MIN;
      at = Math.floor(at / MIN) * MIN;
      const F = state => ({ priority: 3, state, holdReason: state === 'onHold' ? 'awaitingCaller' : null });
      const snaps = [{ at, fields: F('assigned') }];
      for (let j = 0, k = r.int(0, 4); j < k; j++) { at += r.int(1, 1800) * MIN; snaps.push({ at, fields: F(j % 2 === 0 ? 'onHold' : 'inProgress') }); }
      if (r.chance(0.6)) { at += r.int(1, 2400) * MIN; snaps.push({ at, fields: F('resolved') }); }
      const sched = r.chance(0.1) ? null : 'FZ';
      const T = r.int(1, 900);
      const def = { id: 'FUZZ', target: { minutes: T }, start: { when: [{ field: 'priority', in: [3] }], from: 'openedAt', retroactivePause: true }, pause: AWAIT,
        stop: { when: [{ field: 'state', in: ['resolved'] }] }, cancel: { whenStartFails: false, when: [{ field: 'state', in: ['cancelled'] }] }, reset: null,
        schedule: sched ? { source: 'calendar', calendar: sched } : { source: 'none' }, timezone: { sources: ['definition'], definition: tz },
        escalations: [{ percent: 50, notify: 'group' }, { percent: 75, notify: 'group' }, { percent: 100, notify: 'group' }] };
      const ctx = { world, defsAt: () => [def], scheduleOf: { service: () => null, group: () => null } };
      let s, mine;
      try {
        [s] = slaTimeline(ctx, { number: 'INC-FZ', openedAt: snaps[0].at, callerTz: null, ciTz: null }, snaps);
        mine = stepSla(stepper, sched ? stepper.calendar(cal, tz) : null, { ops: s.ops, startAt: s.startAt, end: s.end, T, percents: [50, 75, 100] });
      } catch (e) {
        if (e instanceof RangeError || /no business time|CAL_NO_BUSINESS_TIME/.test(String(e.message))) { out.skipped++; continue; }
        push({ seed, i, tz, calendar: tname, error: String(e.message) }); continue;
      }
      out.cases++;
      out.byZone[tz] = (out.byZone[tz] ?? 0) + 1;
      const last = Math.max(s.end?.at ?? 0, s.D ?? 0, ...s.segments.map(([a, b]) => b ?? a));
      if (ch.at > s.startAt && ch.at < last) out.crossing++;
      if (sched) {
        // Does a business interval contain the change (the in-interval clause of R4.4)?
        const c = stepper.calendar(cal, tz);
        const k = stepper.idx(ch.at);
        if (c.cum[k + 1] - c.cum[k] === 1 && c.cum[k] - c.cum[k - 1] === 1) out.inInterval++;
      }
      if (cal.holidays.some(h => h.from !== undefined)) out.partialHoliday++;
      const d = slaDiffs(s, mine);
      if (d.length) push({ seed, i, tz, change: isoZ(ch.at), calendar: tname, businessHours: cal.businessHours, holidays: cal.holidays, schedule: sched, target: T,
        ops: s.ops.map(o => `${o.op}@${isoZ(o.at)}`), diffs: d });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI.

const range = s => { const [a, b] = String(s).split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); };

export function runNversion({ seeds = range('1001-1012'), difficulties = range('1-5'), fuzz = 2000, fuzzSeeds = seeds, log = () => {} } = {}) {
  for (const s of [...seeds, ...fuzzSeeds]) if (s < 1001 || s > 1199) throw new Error(`seed ${s} is outside the dev block 1001-1199`);
  const t0 = Date.now();
  const stepper = new MinuteStepper();
  const worlds = [];
  for (const d of difficulties) for (const seed of seeds) {
    const t = Date.now();
    const w = generateWorld({ seed, difficulty: d });
    const r = checkWorld(w, stepper);
    r.ms = Date.now() - t;
    worlds.push(r);
    log(`${w.id}: ${r.cases} incidents, ${r.slas} SLAs (${r.dstSpanning} across a clock change), ${r.deadlines} R6 deadlines, ${r.diffs.length + (r.more ?? 0)} differences (${r.ms} ms)`);
  }
  const tw = Date.now();
  const perSeed = Math.max(1, Math.ceil(fuzz / fuzzSeeds.length));
  const f = fuzzDst(stepper, { seeds: fuzzSeeds, n: perSeed });
  const fuzzMs = Date.now() - tw;
  log(`fuzz: ${f.cases} lifecycles (${f.skipped} skipped), ${f.crossing} across a clock change, ${f.inInterval} with an interval containing it, ${f.partialHoliday} with a partial holiday; ${f.diffs.length + (f.more ?? 0)} differences (${fuzzMs} ms)`);
  const sum = k => worlds.reduce((n, w) => n + w[k], 0);
  return {
    worlds, fuzz: f,
    totals: { worlds: worlds.length, cases: sum('cases'), slas: sum('slas'), dstSpanning: sum('dstSpanning'), stops: sum('stops'), thresholds: sum('thresholds'), resumes: sum('resumes'),
      deadlines: sum('deadlines'), worldDiffs: worlds.reduce((n, w) => n + w.diffs.length + (w.more ?? 0), 0), fuzzDiffs: f.diffs.length + (f.more ?? 0) },
    intlFormatCalls: stepper.formatCalls, icu: process.versions.icu, tzdata: process.versions.tz, ms: { total: Date.now() - t0, fuzz: fuzzMs },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
  const res = runNversion({ seeds: range(arg('seeds', '1001-1012')), difficulties: range(arg('difficulties', '1-5')), fuzz: Number(arg('fuzz', 2000)),
    log: m => console.log(m) });
  console.log(JSON.stringify({ totals: res.totals, ms: res.ms, intlFormatCalls: res.intlFormatCalls, icu: res.icu, tzdata: res.tzdata }, null, 1));
  const diffs = [...res.worlds.flatMap(w => w.diffs.map(d => ({ world: w.world, ...d }))), ...res.fuzz.diffs];
  if (diffs.length) console.log('first differences:', JSON.stringify(diffs.slice(0, 5), null, 1));
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify(res, null, 1));
  process.exitCode = diffs.length ? 1 : 0;
}
