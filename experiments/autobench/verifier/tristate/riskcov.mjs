// Move 3: risk–coverage of a release rule, leave-one-task-out, certified with experiments/lib/certify.mjs. Pure.
//
// items = [{ task, y (official pass: true/false), v (a verdictOf result) }]. A release rule at threshold theta releases
// a run when FAILED is empty and its UNKNOWN share is at most theta (verdict.mjs releasedAt). For each theta:
//   coverage  released / all            risk  failing released / released  (1 - release precision)
//   joint     failing released / all    (the false-release rate)
// Rows cluster by task (several arms per task), so every count carries the Kish n_eff over task clusters
// (certify.effectiveN, ICC floor 0.1, ANOVA estimate when larger) and every bound is read at n_eff.
//
// Leave-one-task-out: for each task, the threshold is chosen on the other tasks by Learn-then-Test (certify
// learnThenTest, Hoeffding–Bentkus p-values, fixed-sequence from the strictest theta up, family-wise delta) at a target
// risk alpha on the RELEASED rows (n = their n_eff; conditioning on release makes this an approximation, stated), taking
// the most permissive certified theta; with none certified the task's runs are all held (abstain). The held-out task is
// then released by that theta. The pooled result is the honest operating point: no task chose its own threshold.
import { clopperPearson, effectiveN, learnThenTest } from '../../../lib/certify.mjs';
import { releasedAt } from './verdict.mjs';

export const RISKCOV_VERSION = 'tristate-riskcov-v1';
export const THETAS = Object.freeze([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1]);

function clustersOf(items, pick) {
  const by = new Map();
  for (const it of items) { if (!by.has(it.task)) by.set(it.task, { n: 0, wrong: 0 }); const c = by.get(it.task); if (pick(it)) { c.n++; if (!it.y) c.wrong++; } }
  return [...by.values()].filter(c => c.n > 0);
}
export function nEffOf(items, pick = () => true) {
  const cl = clustersOf(items, pick);
  if (!cl.length) return { n: 0, nEff: 0 };
  const n = cl.reduce((a, c) => a + c.n, 0);
  if (cl.length === 1) return { n, nEff: 1 };
  const e = effectiveN(cl);
  return { n, nEff: Math.min(n, e.nEff), rhoUsed: e.rhoUsed, rhoHat: e.rhoHat };
}

/** One point of the curve. */
export function pointAt(items, theta) {
  const rel = items.filter(it => releasedAt(it.v, theta));
  const bad = rel.filter(it => !it.y).length;
  const eff = nEffOf(items, it => releasedAt(it.v, theta));
  const nE = Math.max(1, Math.floor(eff.nEff));
  const riskHat = rel.length ? bad / rel.length : 0;
  // the exact bound read at n_eff: scale the failure count to the effective size
  const badE = Math.min(nE, Math.round(riskHat * nE));
  return { theta, n: items.length, released: rel.length, failingReleased: bad, coverage: items.length ? rel.length / items.length : 0, risk: riskHat,
    joint: items.length ? bad / items.length : 0, nEffReleased: eff.nEff, riskUpper: rel.length ? clopperPearson(badE, nE, { sides: 1 }).hi : null };
}
export const curve = (items, thetas = THETAS) => thetas.map(t => pointAt(items, t));

/**
 * Learn-then-Test choice of theta on calibration items: the most permissive theta certified at risk <= alpha.
 * method 'bonferroni_holm' (default) tests every grid point with at least minNeff effective released rows; the first run
 * (2026-11-04) used 'fixed_sequence' from the strictest theta, where a 2-row first point stopped every sequence: that
 * method stays available and is reported beside the default, never in its place.
 */
export function chooseTheta(cal, { alpha = 0.2, delta = 0.1, thetas = THETAS, method = 'bonferroni_holm', minNeff = 5 } = {}) {
  const pts = thetas.map(t => pointAt(cal, t));
  // release sets are nested in theta, so equal counts are the same set: one hypothesis each (the most permissive theta)
  const distinct = [...new Map(pts.map(p => [p.released, p])).values()];
  const usable = distinct.filter(p => p.released > 0 && (method === 'fixed_sequence' || p.nEffReleased >= minNeff));
  if (!usable.length) return { theta: null, pts };
  const ltt = learnThenTest({ risks: usable.map(p => p.risk), n: usable.map(p => Math.max(1, Math.floor(p.nEffReleased))), alpha, delta, binary: true, method });
  if (!ltt.valid.length) return { theta: null, pts, ltt };
  const best = Math.max(...ltt.valid.map(i => usable[i].theta));
  return { theta: best, pts, ltt };
}

/** Leave-one-task-out operating point of the LTT-chosen release rule. */
export function loto(items, opts = {}) {
  const tasks = [...new Set(items.map(it => it.task))].sort();
  const per = [];
  for (const t of tasks) {
    const cal = items.filter(it => it.task !== t), test = items.filter(it => it.task === t);
    const { theta } = chooseTheta(cal, opts);
    const rel = theta === null ? [] : test.filter(it => releasedAt(it.v, theta));
    per.push({ task: t, theta, n: test.length, released: rel.length, failingReleased: rel.filter(it => !it.y).length, items: test.map(it => ({ y: it.y, released: rel.includes(it) })) });
  }
  const released = per.reduce((a, p) => a + p.released, 0), bad = per.reduce((a, p) => a + p.failingReleased, 0), n = items.length;
  const cl = per.filter(p => p.released).map(p => ({ n: p.released, wrong: p.failingReleased }));
  const nEff = cl.length > 1 ? Math.min(released, effectiveN(cl).nEff) : released;
  const nE = Math.max(1, Math.floor(nEff)), badE = released ? Math.min(nE, Math.round((bad / released) * nE)) : 0;
  const thetas = per.map(p => p.theta);
  return {
    alpha: opts.alpha ?? 0.2, delta: opts.delta ?? 0.1, method: opts.method ?? 'bonferroni_holm', n, released, failingReleased: bad, coverage: n ? released / n : 0,
    precision: released ? 1 - bad / released : null, risk: released ? bad / released : null, nEffReleased: nEff,
    riskUpper: released ? clopperPearson(badE, nE, { sides: 1 }).hi : null, precisionLower: released ? 1 - clopperPearson(badE, nE, { sides: 1 }).hi : null,
    abstainedTasks: thetas.filter(t => t === null).length, thetaCounts: thetas.reduce((m, t) => ({ ...m, [String(t)]: (m[String(t)] ?? 0) + 1 }), {}),
    passesHeld: per.reduce((a, p) => a + p.items.filter(x => x.y && !x.released).length, 0),
    // per-task thresholds only on request (they carry task names; result files keep counts only)
    ...(opts.keepPerTask ? { perTask: per.map(p => ({ task: p.task, theta: p.theta })) } : {}),
  };
}

/** Row-level three-valued summary: precision of each row verdict and coverage of SUPPORTED. */
export function rowSummary(items) {
  const by = { SUPPORTED: [], UNKNOWN: [], FAILED: [] };
  for (const it of items) by[it.v.row].push(it);
  const prec = xs => (xs.length ? xs.filter(it => it.y).length / xs.length : null);
  const sup = by.SUPPORTED, supBad = sup.filter(it => !it.y).length;
  const e = nEffOf(items, it => it.v.row === 'SUPPORTED');
  const nE = Math.max(1, Math.floor(e.nEff));
  return {
    n: items.length, supported: sup.length, unknown: by.UNKNOWN.length, failed: by.FAILED.length,
    supportedPrecision: prec(sup), unknownPassRate: prec(by.UNKNOWN), failedPassRate: prec(by.FAILED),
    coverage: items.length ? sup.length / items.length : 0, nEffSupported: e.nEff,
    supportedPrecisionLower: sup.length ? 1 - clopperPearson(Math.min(nE, Math.round((supBad / sup.length) * nE)), nE, { sides: 1 }).hi : null,
    released: items.filter(it => it.v.release).length, releasedPrecision: prec(items.filter(it => it.v.release)),
  };
}
