// Statistics for Foundry experiments (ROADMAP §4.3, R05 §3). Pure functions, no deps.
// Every comparative claim must come from these functions over raw per-trial records.
import { rng } from '../../beds/lib/rng.mjs';

// log C(n,k) via log-gamma-free summation (n is small: trials per task).
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

// Unbiased estimators from n trials with c successes (Chen et al. 2021; tau-bench pass^k).
export const passAtK = (n, c, k) => (n - c < k ? 1 : 1 - Math.exp(logChoose(n - c, k) - logChoose(n, k)));
export const passHatK = (n, c, k) => (c < k ? 0 : Math.exp(logChoose(c, k) - logChoose(n, k)));

// Wilson score interval for a binomial proportion.
export function wilson(successes, n, z = 1.96) {
  if (!n) return { p: NaN, lo: NaN, hi: NaN };
  const p = successes / n, d = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / d;
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

// Group raw trial records { arm, task, family, trial, pass, costUsd, imputedUsd? } by arm → task.
export function byArmTask(records) {
  const out = new Map();
  for (const r0 of records) {
    const r = r0.task ? r0 : { ...r0, task: r0.taskKey };
    if (!out.has(r.arm)) out.set(r.arm, new Map());
    const tasks = out.get(r.arm);
    if (!tasks.has(r.task)) tasks.set(r.task, { task: r.task, family: r.family, trials: [] });
    tasks.get(r.task).trials.push(r);
  }
  return out;
}

const totalCost = (trials, { includeImputed = false } = {}) =>
  trials.reduce((s, t) => s + (t.costUsd ?? 0) + (includeImputed ? (t.imputedUsd ?? 0) : 0), 0);

// Per-arm summary: success rate, pass^k (mean over tasks), CPS = all dollars / verified successes.
export function summarizeArm(taskMap, { k = 3, includeImputed = false, extraCostUsd = 0 } = {}) {
  const tasks = [...taskMap.values()];
  let n = 0, c = 0, cost = extraCostUsd;
  const hat = [], at = [];
  for (const t of tasks) {
    const tn = t.trials.length, tc = t.trials.filter(x => x.pass).length;
    n += tn; c += tc; cost += totalCost(t.trials, { includeImputed });
    if (tn >= k) { hat.push(passHatK(tn, tc, k)); at.push(passAtK(tn, tc, k)); }
  }
  const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    tasks: tasks.length, trials: n, successes: c, successRate: n ? c / n : NaN, ci: wilson(c, n),
    [`passHat${k}`]: mean(hat), [`passAt${k}`]: mean(at), costUsd: cost,
    cps: c ? cost / c : Infinity, costPerTrial: n ? cost / n : NaN,
  };
}

// Family-clustered paired bootstrap of (A − B) success rate and log CPS ratio (A/B).
// Resamples families, then tasks within each family, keeping A and B paired per task.
export function pairedBootstrap(records, armA, armB, { iterations = 10000, seed = 'bootstrap', includeImputed = false } = {}) {
  const grouped = byArmTask(records);
  const A = grouped.get(armA), B = grouped.get(armB);
  if (!A || !B) throw new Error(`missing arm ${!A ? armA : armB}`);
  const shared = [...A.keys()].filter(t => B.has(t));
  const families = new Map();
  for (const t of shared) {
    const f = A.get(t).family ?? 'all';
    if (!families.has(f)) families.set(f, []);
    families.get(f).push(t);
  }
  const famList = [...families.keys()];
  const stat = taskIds => {
    let an = 0, ac = 0, bn = 0, bc = 0, acost = 0, bcost = 0;
    for (const t of taskIds) {
      const a = A.get(t).trials, b = B.get(t).trials;
      an += a.length; ac += a.filter(x => x.pass).length; acost += totalCost(a, { includeImputed });
      bn += b.length; bc += b.filter(x => x.pass).length; bcost += totalCost(b, { includeImputed });
    }
    const diff = ac / an - bc / bn;
    const cpsA = ac ? acost / ac : Infinity, cpsB = bc ? bcost / bc : Infinity;
    return { diff, logCpsRatio: Number.isFinite(cpsA) && Number.isFinite(cpsB) ? Math.log(cpsA / cpsB) : NaN };
  };
  const point = stat(shared);
  const r = rng(seed, armA, armB);
  const diffs = [], ratios = [];
  for (let i = 0; i < iterations; i++) {
    const sample = [];
    for (let j = 0; j < famList.length; j++) {
      const fam = families.get(famList[r.int(0, famList.length - 1)]);
      for (let m = 0; m < fam.length; m++) sample.push(fam[r.int(0, fam.length - 1)]);
    }
    const s = stat(sample);
    diffs.push(s.diff);
    if (Number.isFinite(s.logCpsRatio)) ratios.push(s.logCpsRatio);
  }
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] : NaN; };
  return {
    armA, armB, tasks: shared.length, families: famList.length, iterations,
    successDiff: { point: point.diff, lo: q(diffs, 0.025), hi: q(diffs, 0.975) },
    cpsRatio: {
      point: Math.exp(point.logCpsRatio), lo: Math.exp(q(ratios, 0.025)), hi: Math.exp(q(ratios, 0.975)),
      finiteResamples: ratios.length,
    },
  };
}

// Exact McNemar test on per-task majority outcome (paired), two-sided.
export function mcnemar(records, armA, armB) {
  const g = byArmTask(records), A = g.get(armA), B = g.get(armB);
  let b10 = 0, b01 = 0;
  for (const [t, a] of A) {
    if (!B.has(t)) continue;
    const pa = a.trials.filter(x => x.pass).length * 2 >= a.trials.length;
    const pb = B.get(t).trials.filter(x => x.pass).length * 2 >= B.get(t).trials.length;
    if (pa && !pb) b10++; else if (!pa && pb) b01++;
  }
  const n = b10 + b01, k = Math.min(b10, b01);
  let p = 0;
  for (let i = 0; i <= k; i++) p += Math.exp(logChoose(n, i) - n * Math.log(2));
  return { aOnly: b10, bOnly: b01, p: Math.min(1, 2 * p) };
}
