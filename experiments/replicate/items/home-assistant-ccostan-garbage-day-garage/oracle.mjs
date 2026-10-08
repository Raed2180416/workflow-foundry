// The oracle for the garbage-day job. Host code: solvers never see it.
// It replays the episode record (the solver's calls, in order) against fresh mock Home Assistants on a virtual clock and judges the
// EFFECTS: the successful service calls the mock recorded, normalised (trace.mjs), against the trace each scenario expects, with every
// call within +-1 s of its nominal instant, nothing missing and nothing extra. It does not look at how the solution is built, at the
// order of calls made at the same instant, or at the solver's own bookkeeping (wake-ups, reads), except for the T3 cost target.
import { replay, scenarioList } from './env.mjs';
import { matchTraces, normalizeCall } from './trace.mjs';
import { SPEC, T3_COST } from './spec.mjs';

const OUTPUT_KEYS = new Set(['actions', 'meta']);

export function checkOutput(output) {
  const errs = [];
  if (!output || typeof output !== 'object' || Array.isArray(output)) return ['output must be an object {actions: [...]}'];
  for (const k of Object.keys(output)) if (!OUTPUT_KEYS.has(k)) errs.push(`unexpected property ${k}`);
  if (!Array.isArray(output.actions)) errs.push('actions must be an array');
  else {
    if (output.actions.length > 100000) errs.push('actions has more than 100000 entries');
    output.actions.forEach((a, i) => {
      if (!a || typeof a !== 'object' || Array.isArray(a)) { errs.push(`actions[${i}] must be an object`); return; }
      if (typeof a.call !== 'string' || a.call.length > 64) errs.push(`actions[${i}].call must be a string of at most 64 characters`);
      if (a.args !== undefined && (typeof a.args !== 'object' || a.args === null || Array.isArray(a.args))) errs.push(`actions[${i}].args must be an object`);
      for (const k of Object.keys(a)) if (k !== 'call' && k !== 'args') errs.push(`actions[${i}] has unexpected property ${k}`);
    });
  }
  if (output.meta !== undefined && (typeof output.meta !== 'object' || output.meta === null)) errs.push('meta must be an object');
  return errs.slice(0, 10);
}

const slim = x => ({ t: x.t, ...x.norm });

export function judgeScenario(sc, rec) {
  const got = rec.calls.filter(c => c.status < 400).map(c => ({ t: c.t, norm: normalizeCall(c) }));
  const m = matchTraces(sc.expect, got);
  const refused = rec.calls.filter(c => c.status >= 400);
  const pass = m.ok && !rec.stats.capped;
  return {
    id: sc.id, kind: sc.kind, pass,
    expected: sc.expect.length, got: got.length, maxTimingError: Number(m.maxErr.toFixed(3)),
    missing: m.missing.slice(0, 6).map(slim), extra: m.extra.slice(0, 6).map(slim), timingErrors: m.timing.slice(0, 6),
    capped: rec.stats.capped, refusedCalls: refused.length,
    refusedServices: [...new Set(refused.filter(c => c.status === 404).map(c => c.service))].slice(0, 5),
    work: rec.stats.work + rec.wakes.length,
  };
}

export function oracle(task, output) {
  const schemaErrors = checkOutput(output);
  if (schemaErrors.length) return { pass: false, score: 0, details: { schemaErrors } };
  const scenarios = scenarioList(task);
  const { env, replayed, unansweredRuns } = replay(task, output.actions, scenarios);
  const recs = env._records();
  const per = scenarios.map((sc, i) => judgeScenario(sc, recs[i]));
  const core = per.filter(s => s.kind === 'core'), probes = per.filter(s => s.kind === 'probe');
  const passed = per.filter(s => s.pass).length;
  const out = { replayedActions: replayed, ignoredActions: output.actions.length - replayed, unansweredRuns, core: `${core.filter(s => s.pass).length}/${core.length}`, scenarios: per };
  if (task.variant !== 'T3') {
    out.failed = per.filter(s => !s.pass).map(s => s.id);
    return { pass: passed === per.length, score: passed / per.length, details: out };
  }
  const cost = core.reduce((a, s) => a + s.work, 0);
  const cap = T3_COST.cap;
  out.probes = `${probes.filter(s => s.pass).length}/${probes.length}`;
  out.cost = { selfInflictedWork: cost, cap, ok: cost <= cap, note: 'sched.set + sched.cancel + ha.get_state + wake-ups delivered, over the core scenarios (kv is not counted)' };
  out.failed = per.filter(s => !s.pass).map(s => s.id);
  const ok = passed === per.length && cost <= cap;
  return { pass: ok, score: (passed + (cost <= cap ? 1 : 0)) / (per.length + 1), details: out };
}
