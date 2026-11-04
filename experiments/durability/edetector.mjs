// DUR-1 channel m6: the input-profile e-detector (PREREG-DUR-1 §6.1; BUILD-PLAN row 6). $0, oracle-free, MEASURED ONLY:
// it never opens an incident (monitor.mjs rule 5); it is the held-out test of the K15 lead (a frozen input-profile novelty
// detector alarmed one task after drift with 0 false alarms, post hoc and in sample, research/jit-20261008/DEV-NOTES.md:883).
//   unit       one platform instance (what the arm saw as one process: its inbound messages and their documents, in
//              delivery order; effect results, timers and task events are not inputs);
//   score      the number of profile findings (experiments/jit/profile.mjs checkProfile reasons, PARAMS unchanged);
//   p-value    conformal rank against a FIXED calibration (never widened by stream data): p = (#{cal >= s} + 1)/(n + 1)
//              (ties counted in full: a conservative, super-uniform p; the randomised "smoothed" tie-break of the prereg
//              text would make a maximally novel case's p random, and the frozen "alarm after 4 consecutive maximally
//              novel cases" property needs it fixed; disclosed in BUILD-NOTES.md);
//   e-value    power bet e = eps p^(eps-1), eps = 0.3;  e-CUSUM M_t = max(1, M_{t-1}) e_t; alarm at M_t >= h = 10,000;
//              reset after an alarm.
// Calibration: the profile is learned on the reference journals of practice worlds 1235-1237; calibration scores are
// leave-one-world-out (each world's instances scored against the profile of the other two), so they are out of sample.
import { learnProfile, checkProfile, PARAMS } from '../jit/profile.mjs';

export const EPS = 0.3;
export const H = 10_000;
const INBOUND_EXCLUDED = new Set(['effect.result', 'timer.fired', 'sweep.wake', 'migration']);

/** Per-instance input tasks from a journal (and the world's documents for the delivered events). */
export function instanceTasks(rows, world) {
  const docs = new Map((world?.arrivals ?? []).filter(a => typeof a.doc === 'string').map(a => [a.id, a.doc]));
  const by = new Map();
  let now = null;
  for (const r of rows) {
    if (r.type === 'wakeup') now = Date.parse(r.at);
    if (r.type !== 'deliver' || !r.instance || !r.event) continue;
    const ev = r.event;
    if (INBOUND_EXCLUDED.has(ev.type) || ev.type.startsWith('humanTask.')) continue;
    let t = by.get(r.instance);
    if (!t) { t = { instance: r.instance, firstAt: now, events: [] }; by.set(r.instance, t); }
    t.events.push({ type: ev.type, source: ev.source ?? null, payload: ev.payload ?? {}, ...(docs.has(ev.id) ? { doc: docs.get(ev.id) } : {}) });
  }
  return [...by.values()].sort((a, b) => a.firstAt - b.firstAt || (a.instance < b.instance ? -1 : 1))
    .map(t => ({ instance: t.instance, firstAt: t.firstAt, task: { prompt: '', inputs: { events: t.events } } }));
}

export const scoreOf = (profile, task) => checkProfile(profile, task).reasons.length;

/** Conformal p-value of score s against a fixed calibration list (ties counted in full). */
export function conformalP(s, cal) {
  let ge = 0;
  for (const c of cal) if (c >= s) ge += 1;
  return (ge + 1) / (cal.length + 1);
}
export const eValue = (p, eps = EPS) => eps * Math.pow(p, eps - 1);

/** The e-CUSUM detector; step(p) → { M, alarm }. Alarms reset the statistic. */
export class ECusum {
  constructor({ eps = EPS, h = H } = {}) { this.eps = eps; this.h = h; this.M = 1; this.alarms = []; this.n = 0; }
  step(p, meta = null) {
    this.n += 1;
    this.M = Math.max(1, this.M) * eValue(p, this.eps);
    if (this.M >= this.h) { this.alarms.push({ n: this.n, M: this.M, ...(meta ?? {}) }); this.M = 1; return { M: this.h, alarm: true }; }
    return { M: this.M, alarm: false };
  }
}

/**
 * Calibrate on practice journals: [{ rows, world }] (one per practice world). Returns { profile (learned on all), cal
 * (leave-one-world-out scores, frozen), n }.
 */
export function calibrate(practice) {
  const tasksBy = practice.map(p => instanceTasks(p.rows, p.world).map(t => t.task));
  const cal = [];
  for (let i = 0; i < tasksBy.length; i++) {
    const prof = learnProfile(tasksBy.filter((_, j) => j !== i).flat(), PARAMS);
    for (const t of tasksBy[i]) cal.push(scoreOf(prof, t));
  }
  const profile = learnProfile(tasksBy.flat(), PARAMS);
  return Object.freeze({ profile, cal: Object.freeze([...cal]), n: cal.length });
}

/** Run the detector over a stream's instances (in order); returns the alarm list with times and instances. */
export function runDetector(calib, tasks, { detector = new ECusum() } = {}) {
  const trace = [];
  for (const t of tasks) {
    const s = scoreOf(calib.profile, t.task);
    const p = conformalP(s, calib.cal);
    const r = detector.step(p, { at: t.firstAt, instance: t.instance, world: t.world ?? null, score: s });
    trace.push({ at: t.firstAt, instance: t.instance, world: t.world ?? null, score: s, p, M: r.M, alarm: r.alarm });
  }
  return { alarms: detector.alarms, trace, detector };
}
