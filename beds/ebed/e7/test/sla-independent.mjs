// An independent evaluator of the E7 SLA engine (SPEC-E R0, R4.1-R4.6, R5.1, S2-S6, S12-S15), for N-version checks of
// the oracle's sla.mjs on fuzzed histories (test/e7.test.mjs; review 2026-10-15 round 2). Test fixture, $0. Written from
// the spec, not from sla.mjs, and built differently on purpose:
//   - the incident's history is a field timeline: snapshot i holds over [at_i, at_i+1);
//   - a retroactive pause (R4.3) is a maximal run of the pause condition on that timeline, clipped to [startAt, x); the
//     run that reaches x stays open when the condition still holds at x (S14) and is closed at x when it does not;
//   - an SLA is kept as pause intervals plus an end, and its records (start, pause, resume, stop, cancel) are derived at
//     the end;
//   - R0 picks the edition from the rulebook files itself (the generator's local date), not through the transition;
//   - business time is the generator's own clock (world.mjs addBiz/bizBetween: its own zone table and interval walk), not
//     lib/calendar.
// Output per SLA: { id, definition, generation, attachAt, startAt, schedule, timezone, ops: [{ op, at, x, reason? }],
// stage, D, breached, thresholds: [{ percent, at }], elapsedMinutes, businessElapsedMinutes, planned: { start, resumes } },
// the same names as sla.mjs so a test can compare the two field by field.
import { addBiz, bizBetween, localDate } from '../world.mjs';

const MIN = 60_000;

/** Every { field, in } of a non-empty list holds on the fields (R4.1: a list with no condition never holds). */
const allHold = (when, f) => Array.isArray(when) && when.length > 0 && when.every(c => c.in.some(v => (v ?? null) === (f[c.field] ?? null)));

/** R0 over the rulebook files: the definitions of the edition in force at an instant (latest effectiveFrom on or before its local date). */
function editionsOf(world) {
  const eds = world.rulebook.editions.map(e => ({ effectiveFrom: JSON.parse(e.files['edition.json']).effectiveFrom, policy: JSON.parse(e.files['policy.json']),
    defs: JSON.parse(e.files['sla-definitions.json']) }));
  const tz = eds[0].policy.systemTimeZone;
  return atMs => {
    const day = localDate(atMs, tz);
    const inForce = eds.filter(e => e.effectiveFrom <= day).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
    if (!inForce.length) throw new Error(`independent: no edition on ${day}`);
    return inForce[0].defs;
  };
}

/** independentSlas(world, { number, openedAt, callerTz, ciTz }, snaps [{ at, fields }] merged per instant, ascending). */
export function independentSlas(world, incident, snaps) {
  const defsAt = editionsOf(world);
  const services = new Map(world.master.services.map(s => [s.service, s]));
  const groups = new Map(world.master.groups.map(g => [g.group, g]));
  const slas = [];
  const inFlight = id => slas.some(s => s.definition === id && s.end === null);

  const attach = (def, i) => {
    const x = snaps[i].at, F = snaps[i].fields;
    const retro = def.start.from === 'openedAt';
    const startAt = retro ? incident.openedAt : x;
    const src = def.schedule?.source ?? 'none';
    const schedule = src === 'none' ? null : src === 'calendar' ? def.schedule.calendar : src === 'service' ? services.get(F.service).supportSchedule : groups.get(F.assignmentGroup).schedule;
    let timezone = null, cal = null;
    if (schedule !== null) {
      cal = world.calendars[schedule];
      const zoneOf = { caller: incident.callerTz ?? null, ci: incident.ciTz ?? null, definition: def.timezone?.definition ?? null };
      timezone = cal.tz ?? (def.timezone?.sources ?? []).map(k => zoneOf[k]).find(z => z) ?? null;
      if (!timezone) throw new Error(`independent: no zone for ${def.id}`);
    }
    const pauses = [];
    if (def.pause) {
      if (retro && def.start.retroactivePause) {
        // The runs of the pause condition over [startAt, x) (snapshot j holds over [at_j, at_j+1)).
        for (let j = 0; j < i; j++) {
          const a = Math.max(snaps[j].at, startAt), b = Math.min(snaps[j + 1].at, x);
          if (b <= a || !allHold(def.pause.when, snaps[j].fields)) continue;
          const last = pauses.at(-1);
          if (last && last.to === a) last.to = b;
          else pauses.push({ from: a, to: b, x, toX: x });
        }
      }
      if (allHold(def.pause.when, F)) {
        const last = pauses.at(-1);
        if (last && last.to === x) { last.to = null; last.toX = null; }            // still paused at x: open from where it began
        else pauses.push({ from: x, to: null, x, toX: null });                       // S14: attaches paused at x
      }
    }
    slas.push({ def, definition: def.id, generation: 1 + slas.filter(s => s.definition === def.id).length, attachAt: x, startAt, schedule, timezone,
      cal: schedule === null ? null : cal, pauses, end: null });
  };

  for (let i = 0; i < snaps.length; i++) {
    const x = snaps[i].at, F = snaps[i].fields, P = i ? snaps[i - 1].fields : null;
    const changed = f => P !== null && (P[f] ?? null) !== (F[f] ?? null);
    // R4.2/S5: the SLAs attached before x, each the first of cancel, stop, reset, pause/resume.
    for (const s of slas) {
      if (s.end !== null || s.attachAt >= x) continue;
      const d = s.def;
      const reason = allHold(d.cancel?.when, F) ? 'cancelled' : d.cancel?.whenStartFails && !allHold(d.start.when, F) ? 'start-failed' : null;
      if (reason) { s.end = { op: 'cancel', at: x, reason }; continue; }
      if (allHold(d.stop?.when, F)) { s.end = { op: 'stop', at: x, reason: null }; continue; }
      if (d.reset && changed(d.reset.onChangeOf)) { s.end = { op: 'cancel', at: x, reason: 'reset' }; continue; }      // re-attached below (S15)
      if (d.pause) {
        const open = s.pauses.length > 0 && s.pauses.at(-1).to === null;
        const h = allHold(d.pause.when, F);
        if (h && !open) s.pauses.push({ from: x, to: null, x, toX: null });
        else if (!h && open) { s.pauses.at(-1).to = x; s.pauses.at(-1).toX = x; }
      }
    }
    // Then attach (edition at x): the start condition became true here (or holds at creation), or the reset field changed.
    for (const def of defsAt(x)) {
      if (inFlight(def.id) || !allHold(def.start.when, F) || allHold(def.stop?.when, F)) continue;
      const becameTrue = P === null || !allHold(def.start.when, P);
      const reset = !!def.reset && changed(def.reset.onChangeOf);
      if (becameTrue || reset) attach(def, i);
    }
  }
  return slas.map(evaluate);

  function evaluate(s) {
    const T = s.def.target.minutes;
    const tz = s.timezone, cal = s.cal;
    // Running intervals: from startAt, minus the pauses, until the end (or open).
    const runs = [];
    let from = s.startAt;
    for (const p of s.pauses) {
      if (from !== null) runs.push([from, p.from]);
      from = p.to;
    }
    if (from !== null) runs.push([from, s.end ? s.end.at : null]);
    const reach = (rs, need) => {
      let acc = 0;
      for (const [a, b] of rs) {
        const span = b === null ? Infinity : bizBetween(cal, tz, a, b);
        if (acc + span >= need) return addBiz(cal, tz, a, need - acc);
        acc += span;
      }
      return null;
    };
    const D = reach(runs, T);
    const thresholds = (s.def.escalations ?? []).map(e => {
      const at = reach(runs, Math.floor((T * e.percent) / 100));
      return { percent: e.percent, at: at !== null && s.end && at > s.end.at ? null : at };
    });
    const ops = [{ op: 'start', at: s.startAt, x: s.attachAt }];
    for (const p of s.pauses) {
      ops.push({ op: 'pause', at: p.from, x: p.x });
      if (p.to !== null) ops.push({ op: 'resume', at: p.to, x: p.toX });
    }
    if (s.end) ops.push({ op: s.end.op, at: s.end.at, x: s.end.at, ...(s.end.reason ? { reason: s.end.reason } : {}) });
    const resumes = new Map();
    for (const p of s.pauses) if (p.to !== null) resumes.set(p.to, reach([...runs.filter(([, b]) => b !== null && b <= p.to), [p.to, null]], T));
    const closed = runs.filter(([, b]) => b !== null);
    const stopped = s.end?.op === 'stop';
    return {
      id: `${incident.number}/${s.definition}/${s.generation}`, definition: s.definition, generation: s.generation, attachAt: s.attachAt, startAt: s.startAt,
      schedule: s.schedule, timezone: s.timezone, ops,
      stage: s.end ? (stopped ? 'completed' : 'cancelled') : s.pauses.length && s.pauses.at(-1).to === null ? 'paused' : 'inProgress',
      D, breached: s.end !== null && D !== null && D <= s.end.at, thresholds,
      elapsedMinutes: stopped ? closed.reduce((n, [a, b]) => n + (b - a) / MIN, 0) : null,
      businessElapsedMinutes: stopped ? closed.reduce((n, [a, b]) => n + bizBetween(cal, tz, a, b), 0) : null,
      planned: { start: addBiz(cal, tz, s.startAt, T), resumes },
    };
  }
}

/** The fields of an SLA both engines produce, in one comparable shape (sla.mjs output or independentSlas output). */
export function comparable(s) {
  return {
    id: s.id, attachAt: s.attachAt, startAt: s.startAt, schedule: s.schedule, timezone: s.timezone, stage: s.stage,
    ops: s.ops.map(o => `${o.op}@${o.at}/${o.x}${o.reason ? `/${o.reason}` : ''}`),
    D: s.D, breached: s.breached, thresholds: s.thresholds.map(t => `${t.percent}@${t.at}`),
    elapsedMinutes: s.elapsedMinutes, businessElapsedMinutes: s.businessElapsedMinutes,
    plannedStart: s.planned.start, plannedResumes: [...s.planned.resumes.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fuzzed incident histories for the N-version check: field snapshots at change instants (merged per instant), on a
// world's services, groups and three zones, from 2026-03-02 for up to ~40 days (inside the generator clock's range).

const ZONES = ['Europe/Amsterdam', 'America/New_York', 'Australia/Sydney'];
const HOLDS = ['awaitingCaller', 'awaitingCaller', 'awaitingVendor', 'awaitingChange'];
const NEXT = { assigned: ['inProgress', 'onHold', 'resolved', 'cancelled'], inProgress: ['onHold', 'resolved', 'cancelled'], onHold: ['inProgress', 'resolved', 'cancelled'], resolved: ['closed'] };

/**
 * fuzzHistory(world, r) -> { incident, snaps, merged }. Up to 10 change instants 1 to 3000 minutes apart; each instant
 * applies 1-3 changes at once (state moves, holds, reclassifications, reassignments, a major declaration), and a reply
 * on an awaiting-caller hold is often merged with a reclassification or a declaration (a retroactive SLA attached at the
 * end of a pause, R4.3). Histories are plausible, not rule-exact: the engines are pure functions of the snapshots.
 */
export function fuzzHistory(world, r) {
  const svc = r.pick(world.master.services);
  const source = r.pick(['report', 'alert']);
  let at = Date.parse('2026-03-02T00:00:00+01:00') + r.int(0, 40 * 1440) * MIN;
  const f = { priority: r.int(1, 5), impact: svc.impact, urgency: r.int(1, 3), state: 'assigned', holdReason: null, source, service: svc.service,
    assignmentGroup: r.pick(world.master.groups).group, major: false };
  const snaps = [{ at, fields: { ...f } }];
  const reprio = () => { f.priority = r.int(1, 5); f.urgency = r.int(1, 3); };
  let merged = 0;
  for (let j = 0, n = r.int(0, 10); j < n && f.state !== 'closed' && f.state !== 'cancelled'; j++) {
    at += r.pick([1, 1, 5, 15, 30, 60, 120, 240, 600, 1440, 2000, 3000]) * MIN;
    if (f.state === 'onHold' && f.holdReason === 'awaitingCaller' && r.chance(0.35)) {
      f.state = 'inProgress'; f.holdReason = null;
      if (r.chance(0.5)) reprio(); else f.major = true;
      merged++;
    } else {
      const k = r.pick([1, 1, 1, 2, 2, 3]);
      if (k > 1) merged++;
      for (let m = 0; m < k; m++) {
        const c = r.int(0, 9);
        if (c <= 4) {
          const opts = NEXT[f.state] ?? [];
          if (!opts.length) continue;
          f.state = r.pick(opts);
          f.holdReason = f.state === 'onHold' ? r.pick(HOLDS) : null;
        } else if (c <= 6) reprio();
        else if (c === 7) { if (NEXT[f.state] && f.state !== 'resolved') { f.assignmentGroup = r.pick(world.master.groups).group; f.state = 'assigned'; f.holdReason = null; } }
        else if (c === 8) f.major = true;
        else if (f.state === 'onHold') { f.state = 'inProgress'; f.holdReason = null; }
      }
    }
    snaps.push({ at, fields: { ...f } });
  }
  return { snaps, incident: { number: 'INC-F', openedAt: snaps[0].at, callerTz: source === 'report' ? r.pick(ZONES) : null, ciTz: r.pick(ZONES) }, merged: merged > 0 };
}
