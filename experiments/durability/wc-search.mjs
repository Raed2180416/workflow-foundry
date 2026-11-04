// DUR-1 WC-1: the $0 worst-case search (PREREG-DUR-1 §8.2; BUILD-PLAN row 14). Targets: every code arm at t0 and at stream
// end. Half the evaluation budget is Poisson sampling from a generated pool with exact inclusion probabilities pi_i (set by
// class composition, min 0.01): Horvitz-Thompson estimates of the natural failure and silent-failure rates, the
// effective sample size and CVaR10% of world failure rates; half is local search with successive halving on the top 10
// vectors (neighbouring salts, one transform or fault). Objective: 10 (silent critical) + 3 (silent failing) + (failing).
// Confirmation: each target's top 10 vectors are re-drawn on 5 fresh salts; confirmed if their class of failure recurs in
// >= 3 of 5. Transfer: confirmed vectors of group A run on group B and vice versa (selection-bias guard). Every world the
// search makes is registered as red-team (it never enters an evidence or regression set). A world whose reference fails is
// a bed finding: reported, excluded.
import { rng } from '../../beds/lib/rng.mjs';
import { vectorBundle, randomVector, vectorClass, neighbours, vectorKey } from './knobs.mjs';
import { registerRedTeam } from './heal-adapter.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { runBundle } from './arms.mjs';
import { signalsOfRun, firstSignals, BASE_READINGS } from './monitor.mjs';
import { silent } from './analyze.mjs';

export const BUDGET = Object.freeze({ groupA: 400, groupB: 150 });
export const GROUP_A = Object.freeze(['b1lh-e8-1', 'ch-e8-1', 'cht-e8-1', 'S2']);
export const OBJECTIVE = Object.freeze({ silentCritical: 10, silent: 3, failing: 1 });
export const CONFIRM = Object.freeze({ salts: 5, need: 3, top: 10 });
export const MIN_PI = 0.01;
export class BudgetExhausted extends Error { constructor(n) { super(`DUR1_WC1_BUDGET: ${n} evaluations used`); this.code = 'DUR1_WC1_BUDGET'; } }

/** An evaluation counter that refuses past its budget. */
export function counter(budget) { let n = 0; return { take() { if (n >= budget) throw new BudgetExhausted(n); n += 1; return n; }, get used() { return n; }, budget }; }

/** Evaluate one target (a version) on one knob vector: validity, failing, silent, silent critical, score, failure classes. */
export async function evaluate(targetId, version, v, { sealed = null, readings = BASE_READINGS, count = null } = {}) {
  count?.take();
  const b = await vectorBundle(targetId, v, { sealed });
  registerRedTeam(b.key);
  const ref = await referencePools(b);
  if (!ref.control.ok) return { key: b.key, vector: v, valid: false, bedFinding: true, problems: ref.control.problems.slice(0, 3), score: -1 };
  const r = await runBundle(b, { version });
  const g = gradeRun(b, r.rows, ref.pools);
  const sig = await signalsOfRun({ bundle: b, rows: r.rows, pools: ref.pools, readings });
  const first = firstSignals(sig.days, ['m1', 'm2', 'm3']);
  let failing = 0, sil = 0, silCrit = 0, n = 0;
  const classes = new Set();
  for (const c of g.cases) {
    if (!c.graded) continue;
    n += 1;
    if (c.pass) continue;
    failing += 1;
    const s = first.get(c.case);
    const isSilent = silent({ ...c, signals: s ? { [s.ch]: s.at } : {} }, ['m1', 'm2', 'm3']);
    if (isSilent) { sil += 1; if (c.critical) silCrit += 1; classes.add(`${c.first?.code}:${c.first?.lid?.split(':')[0] ?? `${c.first?.system}.${c.first?.op}`}`); }
  }
  const score = OBJECTIVE.silentCritical * silCrit + OBJECTIVE.silent * sil + OBJECTIVE.failing * failing;
  return { key: b.key, vector: v, valid: true, ooc: b.ooc, n, failing, silent: sil, silentCritical: silCrit, critical: g.critical, failRate: n ? failing / n : 0, silentRate: n ? sil / n : 0, score, classes: [...classes].sort(), status: r.status };
}

/** Poisson sampling with inclusion probabilities pi (exact): returns the included indices. */
export function poissonSample(pis, r) { return pis.map((p, i) => (r.next() < p ? i : -1)).filter(i => i >= 0); }

/** Horvitz-Thompson mean of y over a population of N from a Poisson sample [{ y, pi }]; ESS = (sum w)^2 / sum w^2. */
export function horvitzThompson(sample, N) {
  const w = sample.map(s => 1 / s.pi);
  const est = sample.reduce((a, s, i) => a + s.y * w[i], 0) / N;
  const sw = w.reduce((a, b) => a + b, 0), sw2 = w.reduce((a, b) => a + b * b, 0);
  // variance of the HT total under Poisson sampling: sum (1 - pi) y^2 / pi^2
  const v = sample.reduce((a, s) => a + ((1 - s.pi) * s.y * s.y) / (s.pi * s.pi), 0) / (N * N);
  return { estimate: est, se: Math.sqrt(v), ess: sw2 ? (sw * sw) / sw2 : 0, n: sample.length };
}

/** Weighted CVaR at level alpha (mean of the worst alpha share of world failure rates, weights 1/pi). */
export function cvar(sample, alpha = 0.1) {
  const s = [...sample].sort((a, b) => b.y - a.y);
  const W = s.reduce((a, x) => a + 1 / x.pi, 0);
  let acc = 0, tot = 0;
  for (const x of s) { const w = 1 / x.pi; const take = Math.min(w, alpha * W - acc); if (take <= 0) break; tot += take * x.y; acc += take; }
  return acc ? tot / acc : null;
}

/**
 * search({ targetId, version, budget, seed, poolSize }) → { evaluated, ht, cvar10, top, bedFindings }. Half the budget
 * importance sampling, half local search (successive halving over the top 10).
 */
export async function search({ targetId, version, budget, seed = 'dur1/wc1', poolSize = 400, sealed = null, readings = BASE_READINGS, maxSize = 200, log = () => {} }) {
  const count = counter(budget);
  const r = rng(seed, targetId);
  const pool = Array.from({ length: poolSize }, () => randomVector(r, { target: targetId, maxSize }));
  const cls = pool.map(vectorClass);
  const share = new Map(); for (const c of cls) share.set(c, (share.get(c) ?? 0) + 1);
  // Class composition: equal expected draws per class (rare classes up-weighted), scaled to half the budget, floor MIN_PI.
  const half = Math.floor(budget / 2);
  const perClass = half / share.size;
  const pis = cls.map(c => Math.min(1, Math.max(MIN_PI, perClass / share.get(c))));
  const idx = poissonSample(pis, r);
  const evaluated = [], bed = [];
  for (const i of idx) {
    if (count.used >= half) break;
    const e = await evaluate(targetId, version, pool[i], { sealed, readings, count });
    if (!e.valid) { bed.push(e); continue; }
    evaluated.push({ ...e, pi: pis[i], phase: 'importance' });
  }
  const ht = { failure: horvitzThompson(evaluated.map(e => ({ y: e.failRate, pi: e.pi })), poolSize), silent: horvitzThompson(evaluated.map(e => ({ y: e.silentRate, pi: e.pi })), poolSize) };
  const cvar10 = cvar(evaluated.map(e => ({ y: e.failRate, pi: e.pi })), 0.1);
  // Local search: successive halving over the top 10 by score.
  let front = [...evaluated].sort((a, b) => b.score - a.score).slice(0, 10).map(e => e.vector);
  while (front.length && count.used < budget) {
    const cand = front.flatMap(v => neighbours(v, r));
    const res = [];
    for (const v of cand) { if (count.used >= budget) break; const e = await evaluate(targetId, version, v, { sealed, readings, count }); if (e.valid) { res.push({ ...e, phase: 'local' }); evaluated.push({ ...e, phase: 'local' }); } else bed.push(e); }
    front = res.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.floor(front.length / 2))).map(e => e.vector);
    if (front.length <= 1 && res.length) break;
  }
  const top = [...evaluated].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, CONFIRM.top);
  log(`WC-1 ${targetId}: ${count.used}/${budget} evaluations, ${bed.length} bed findings, HT failure ${ht.failure.estimate.toFixed(3)} (ESS ${ht.failure.ess.toFixed(1)}), top score ${top[0]?.score ?? '-'}`);
  return { targetId, used: count.used, budget, evaluated: evaluated.map(({ vector, ...e }) => ({ ...e, vector })), ht, cvar10, top, bedFindings: bed };
}

/** Confirmation on fresh salts: a vector is confirmed if its failure classes recur in >= 3 of 5 fresh draws. */
export async function confirm({ targetId, version, top, sealed = null, readings = BASE_READINGS, salts = CONFIRM.salts }) {
  const out = [];
  for (const t of top) {
    if (!t.classes?.length) { out.push({ key: t.key, confirmed: false, recur: 0, reason: 'no silent failure class' }); continue; }
    let recur = 0;
    for (let i = 1; i <= salts; i++) {
      const v = { ...t.vector, salt: (t.vector.salt + 1000 * i + 17) % 10_000 };
      const e = await evaluate(targetId, version, v, { sealed, readings });
      if (e.valid && e.classes.some(c => t.classes.includes(c))) recur += 1;
    }
    out.push({ key: t.key, vector: t.vector, confirmed: recur >= CONFIRM.need, recur, classes: t.classes });
  }
  return out;
}
