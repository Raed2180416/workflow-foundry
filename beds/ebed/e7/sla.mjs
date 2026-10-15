// E7 oracle-side SLA engine (DESIGN.md §6 step 4; SPEC-E R4, R5). A pure function of an incident's history: every SLA
// instant (attach, start, pause, resume, threshold, breach, stop, cancel) and every elapsed and business-elapsed value is
// computed from the field snapshots at the incident's change instants, the definitions of the edition in force at each
// attach, and the world's calendars. Business time comes from beds/ebed/lib/calendar.mjs (pinned zone rules, exact
// milliseconds); the generator's own clock (world.mjs) and lib/clock.mjs are independent cross-checks (test/e7.test.mjs).
// Imports nothing from the host, the solvers or the controls.
//
// Readings implemented here (SPEC §4.4, §5):
//   R4.2/S5  at each change instant: every change applied first, then each SLA attached before the instant, in the order
//            cancel (cancel condition, or start condition failing with whenStartFails) -> stop -> reset (the reset field
//            changed at this instant: cancel `reset`, attach a new generation now) -> pause/resume; then attach every
//            definition whose start condition holds now and did not hold just before (or holds at creation), that has
//            no SLA in progress or paused, and whose stop condition does not hold; a change of the reset field also
//            attaches a definition whose start holds and that has none in progress or paused (stop not holding).
//   R4.3/S6  generation, startAt (openedAt or the attach instant), schedule and time zone fixed at the attach instant,
//            definition edition at the attach instant; retroactive pause over [startAt, x); an SLA attaches paused when
//            its pause condition holds at x (for a retroactive one the pause starts where the current interval began).
//   R4.4/S4  business time inside the schedule's intervals in its zone (lib/calendar); a target or threshold reached at a
//            closing time is reached there; 24x7 counts wall time.
//   R4.6/S2  breach at target, exclusive boundary: breached iff D <= the stop or cancel instant (a stop at D is a breach).
//   R5.1/S3  threshold = floor(target * percent / 100) business minutes, reached at the first instant business time
//            equals it, also at the very instant of a pause, stop or cancel.
// An empty condition list never holds (no generated definition has one; vacuous truth would attach or stop everything).
import { businessMs, addBusinessMs } from '../lib/calendar.mjs';

const MIN = 60_000;

const sameValue = (a, b) => (a ?? null) === (b ?? null);
/** A list of conditions holds when every { field, in } holds on the fields (an empty list never holds). */
export const holds = (when, f) => Array.isArray(when) && when.length > 0 && when.every(c => Array.isArray(c.in) && c.in.some(v => sameValue(v, f[c.field])));

/**
 * Bound calendars, cached per world object (lib/calendar memoises and deep-freezes its input: the input is a private
 * clone, never the world's own calendar object).
 */
const BOUND = new WeakMap();
export function boundCalendar(world, id, tz) {
  let m = BOUND.get(world);
  if (!m) { m = new Map(); BOUND.set(world, m); }
  const k = `${id}\u0000${tz}`;
  let cal = m.get(k);
  if (!cal) {
    const src = world.calendars?.[id];
    if (!src) throw new Error(`sla: no calendar ${id}`);
    cal = structuredClone({ ...src, tz });
    m.set(k, cal);
  }
  return cal;
}

/** Business (or, for 24x7, wall) milliseconds of [s, e) and the instant x business ms after s (S4: lands on a close). */
const measure = (cal, s, e) => (e <= s ? 0 : cal ? businessMs(cal, s, e) : e - s);
const position = (cal, s, x) => (cal ? addBusinessMs(cal, s, x) : s + x);

/**
 * The first instant at which the running time of `segments` ([[s, e]] closed, the last possibly [s, null] open) reaches
 * `needMs` of business time; null when it is not reached (closed segments only) or cannot be known.
 */
export function reachAt(cal, segments, needMs) {
  let acc = 0;
  for (const [s, e] of segments) {
    if (e === null) return position(cal, s, needMs - acc);
    const m = measure(cal, s, e);
    if (acc + m >= needMs) return position(cal, s, needMs - acc);
    acc += m;
  }
  return null;
}

/**
 * slaTimeline(ctx, incident, snaps, { flags }) -> SLA[] (attach order).
 *   ctx      { world, defsAt(ms) -> definitions in force, scheduleOf: { service(id), group(id) } -> calendar id }
 *   incident { openedAt (ms), callerTz | null, ciTz | null }
 *   snaps    [{ at (ms), fields }] ascending, one per change instant, fields after every change of the instant
 *   flags    analyst-only control switches (controls.mjs `world.controlFlags`; never present in a generated world):
 *            breachAtPlannedPause  an SLA paused across its planned breach is breached (and escalated) at that instant
 *            editionAtStart        a retroactive SLA takes the definition of the edition in force at its startAt (not S6)
 * Each SLA: { id, definition, generation, def, attachAt, startAt, schedule, timezone, cal, ops: [{ op, at, x }],
 *   stage, end, segments, targetMs, D, breached, thresholds: [{ percent, notify, at }], elapsedMinutes,
 *   businessElapsedMinutes, planned: { start, resumes: Map(at -> ms | null) } }. `x` of an op is the change instant
 * that caused it (the attach instant for the start and every retroactive pause or resume).
 */
export function slaTimeline(ctx, incident, snaps, { flags = {} } = {}) {
  const slas = [];
  let prev = null;
  const active = id => slas.find(s => s.definition === id && (s.stage === 'inProgress' || s.stage === 'paused'));
  const attach = (def0, x, F) => {
    // S6: the edition at the attach instant, whatever startAt is (the control `edition-at-start` reads it at startAt).
    const def = flags.editionAtStart && def0.start.from === 'openedAt' ? (ctx.defsAt(incident.openedAt).find(d => d.id === def0.id) ?? def0) : def0;
    const generation = 1 + slas.filter(s => s.definition === def.id).length;
    const retro = def.start.from === 'openedAt';
    const startAt = retro ? incident.openedAt : x;
    let schedule = null;
    const src = def.schedule?.source ?? 'none';
    if (src === 'calendar') schedule = def.schedule.calendar;
    else if (src === 'service') schedule = ctx.scheduleOf.service(F.service);
    else if (src === 'assignmentGroup') schedule = ctx.scheduleOf.group(F.assignmentGroup);
    else if (src !== 'none') throw new Error(`sla: unknown schedule source ${src}`);
    let timezone = null, cal = null;
    if (schedule !== null) {
      const raw = ctx.world.calendars?.[schedule];
      if (!raw) throw new Error(`sla: no calendar ${schedule}`);
      if (raw.tz) timezone = raw.tz;
      else {
        const zones = { caller: incident.callerTz ?? null, ci: incident.ciTz ?? null, definition: def.timezone?.definition ?? null };
        timezone = (def.timezone?.sources ?? []).map(s => zones[s] ?? null).find(z => z !== null) ?? null;
        if (timezone === null) throw new Error(`sla: no time zone for ${def.id} (floating ${schedule})`);
      }
      cal = boundCalendar(ctx.world, schedule, timezone);
    }
    const s = { id: `${incident.number}/${def.id}/${generation}`, definition: def.id, generation, def, attachAt: x, startAt, schedule, timezone, cal,
      ops: [{ op: 'start', at: startAt, x }], stage: 'inProgress', end: null };
    // Retroactive pause (R4.3): paused in every interval of [startAt, x) in which the pause condition held; paused at x
    // when it holds at x (from where the current interval began).
    if (def.pause) {
      let from = null;
      if (retro && def.start.retroactivePause) {
        for (const sn of snaps) {
          if (sn.at >= x) break;
          if (sn.at < startAt) continue;
          const h = holds(def.pause.when, sn.fields);
          if (h && from === null) from = sn.at;
          else if (!h && from !== null) { s.ops.push({ op: 'pause', at: from, x }, { op: 'resume', at: sn.at, x }); from = null; }
        }
      }
      const pausedAtX = holds(def.pause.when, F);
      // A past pause interval that the changes at x itself ended ([from, x), e.g. a reply merged with the reclassification
      // that attaches the SLA): paused over it, running from x (R4.3; review 2026-10-15 round 2).
      if (from !== null && !pausedAtX) { s.ops.push({ op: 'pause', at: from, x }, { op: 'resume', at: x, x }); from = null; }
      if (pausedAtX) { s.ops.push({ op: 'pause', at: from ?? x, x }); s.stage = 'paused'; }
    }
    slas.push(s);
    return s;
  };
  const close = (s, op, x, reason = null) => { s.ops.push({ op, at: x, x, ...(reason ? { reason } : {}) }); s.stage = op === 'stop' ? 'completed' : 'cancelled'; s.end = { op, at: x, reason }; };

  for (const sn of snaps) {
    const F = sn.fields, x = sn.at;
    for (const s of slas.slice()) {
      if (s.attachAt >= x || (s.stage !== 'inProgress' && s.stage !== 'paused')) continue;
      const def = s.def;
      if (holds(def.cancel?.when, F)) { close(s, 'cancel', x, 'cancelled'); continue; }
      if (def.cancel?.whenStartFails && !holds(def.start.when, F)) { close(s, 'cancel', x, 'start-failed'); continue; }
      if (holds(def.stop?.when, F)) { close(s, 'stop', x); continue; }
      const rf = def.reset?.onChangeOf;
      if (rf && prev && !sameValue(F[rf], prev.fields[rf])) {
        close(s, 'cancel', x, 'reset');
        const now = ctx.defsAt(x).find(d => d.id === def.id) ?? def;
        if (holds(now.start.when, F) && !holds(now.stop?.when, F)) attach(now, x, F);
        continue;
      }
      if (def.pause) {
        const h = holds(def.pause.when, F);
        if (s.stage === 'inProgress' && h) { s.ops.push({ op: 'pause', at: x, x }); s.stage = 'paused'; }
        else if (s.stage === 'paused' && !h) { s.ops.push({ op: 'resume', at: x, x }); s.stage = 'inProgress'; }
      }
    }
    for (const def of ctx.defsAt(x)) {
      if (!holds(def.start.when, F) || active(def.id) || holds(def.stop?.when, F)) continue;
      const before = prev ? holds(def.start.when, prev.fields) : false;
      const rf = def.reset?.onChangeOf;
      const resetChange = !!(rf && prev && !sameValue(F[rf], prev.fields[rf]));
      if (before && !resetChange) continue;
      attach(def, x, F);
    }
    prev = sn;
  }
  for (const s of slas) evaluate(s, flags);
  return slas;
}

/** Segments, D, thresholds, breach and the stop values of one SLA (R4.4-R5.1). */
function evaluate(s, flags) {
  const T = s.def.target.minutes;
  s.targetMs = T * MIN;
  const segs = [];
  let from = null;
  for (const o of s.ops) {
    if (o.op === 'start' || o.op === 'resume') from = o.at;
    else if ((o.op === 'pause' || o.op === 'stop' || o.op === 'cancel') && from !== null) { segs.push([from, o.at]); from = null; }
  }
  if (from !== null) segs.push([from, null]);
  s.segments = segs;
  // D: reached over the closed segments, or projected along the open one; a paused SLA has none unless reached (R4.4).
  s.D = reachAt(s.cal, segs, s.targetMs);
  // Planned breach at the start (no pause yet) and at each resume (segments before it, then open).
  s.planned = { start: position(s.cal, s.startAt, s.targetMs), resumes: new Map() };
  for (const o of s.ops) {
    if (o.op !== 'resume') continue;
    const before = segs.filter(([a, b]) => b !== null && b <= o.at);
    s.planned.resumes.set(o.at, reachAt(s.cal, [...before, [o.at, null]], s.targetMs));
  }
  if (flags.breachAtPlannedPause && s.D === null) {
    // Control `breach-at-start-of-pause`: the breach instant planned before a pause is kept, so an SLA paused across its
    // planned breach is breached there (DESIGN §8).
    for (let i = 0; i < segs.length; i++) {
      const [a, b] = segs[i];
      if (b === null) break;
      const planned = reachAt(s.cal, [...segs.slice(0, i), [a, null]], s.targetMs);
      const nextStart = segs[i + 1]?.[0] ?? (s.end ? s.end.at : Infinity);
      if (planned > b && planned < nextStart) { s.D = planned; s.forcedBreach = true; break; }
    }
  }
  // An ended SLA is breached iff D was reached by its end (reachAt over closed segments never passes the end, so D <= end).
  s.breached = s.end !== null && s.D !== null;
  s.thresholds = (s.def.escalations ?? []).map(e => {
    const need = Math.floor((T * e.percent) / 100) * MIN;
    let at = need >= s.targetMs ? s.D : reachAt(s.cal, segs, need);
    if (at !== null && s.end && at > s.end.at && !(s.forcedBreach && need >= s.targetMs)) at = null;
    return { percent: e.percent, notify: e.notify, at };
  });
  if (s.end?.op === 'stop') {
    const ran = segs.filter(([, b]) => b !== null);
    s.elapsedMinutes = ran.reduce((n, [a, b]) => n + (b - a), 0) / MIN;
    s.businessElapsedMinutes = ran.reduce((n, [a, b]) => n + measure(s.cal, a, b), 0) / MIN;
    if (!Number.isInteger(s.elapsedMinutes) || !Number.isInteger(s.businessElapsedMinutes)) throw new Error(`sla: ${s.id} elapsed values are not whole minutes`);
    if (s.businessElapsedMinutes > s.elapsedMinutes) throw new Error(`sla invariant: ${s.id} business elapsed > elapsed`);
  } else { s.elapsedMinutes = null; s.businessElapsedMinutes = null; }
  // Invariants (DESIGN §7.3): thresholds non-decreasing in percent; a breach implies the 100% threshold.
  const ts = s.thresholds.filter(t => t.at !== null).sort((a, b) => a.percent - b.percent);
  if (!s.forcedBreach) for (let i = 1; i < ts.length; i++) if (ts[i].at < ts[i - 1].at) throw new Error(`sla invariant: ${s.id} thresholds out of order`);
}
