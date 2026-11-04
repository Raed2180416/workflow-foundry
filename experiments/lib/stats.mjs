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
// constructionUsd { [arm]: { [family]: usd } } adds each arm's one-off construction cost to its CPS: a family's cost is
// spread evenly over that family's shared tasks, so the full-sample point estimate counts it exactly once and every
// resampled task carries its share.
export function pairedBootstrap(records, armA, armB, { iterations = 10000, seed = 'bootstrap', includeImputed = false, constructionUsd = null } = {}) {
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
  const share = (arm, t) => { const f = A.get(t).family ?? 'all'; return (constructionUsd?.[arm]?.[f] ?? 0) / families.get(f).length; };
  const stat = taskIds => {
    let an = 0, ac = 0, bn = 0, bc = 0, acost = 0, bcost = 0;
    for (const t of taskIds) {
      const a = A.get(t).trials, b = B.get(t).trials;
      an += a.length; ac += a.filter(x => x.pass).length; acost += totalCost(a, { includeImputed }) + share(armA, t);
      bn += b.length; bc += b.filter(x => x.pass).length; bcost += totalCost(b, { includeImputed }) + share(armB, t);
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

// ------------------------------------------------------------------------------------------------ reuse acceptance (M3)
// ATTACK-20261014 §3 M3; PROOF-LEDGER K1; LIBRARY-TESTS L4. The L4 rule "95% Wilson upper bound ≤ 0.05 at ≥ 60 admitted
// decisions" fails a perfect gate at 60 (0/60 → 0.0602). These are the three candidate replacements, for the question
// "may this gate configuration serve production reuse?", over ADMITTED reuse decisions (wrong = admitted and the oracle
// fails, `classifyReuse` 'wrong'; correct = 'correct'; LIBRARY §9). Decisions cluster by parent (the calling task: every
// entry offered to one task sees the same input), so each rule takes clusters in arrival order, [{ n, wrong }]
// (`clustersOf` groups raw decisions), and corrects for clustering with Kish's design effect
//   Deff = 1 + (m* − 1)·ρ,  m* = Σm²/Σm (= m for equal sizes),  ρ = max(rho, ρ̂),
// where ρ̂ is the ANOVA intraclass correlation of the clusters seen so far (`iccAnova`; null, i.e. ignored, when not
// estimable) and `rho` a floor that is an assumption (default RHO_REUSE_FLOOR 0.1, the value of
// experiments/jit/stats.mjs RHO_PREREG; never measured for reuse). Counts are rescaled Rao–Scott style: x/Deff of n/Deff.
//   (a) reuseBoundRule     one-sided 95% Wilson upper bound (z 1.645) of the effective counts ≤ 0.05; read once, on all
//                          admitted decisions; kill if the one-sided lower bound > 0.05;
//   (b) reuseSprt          Wald SPRT, p0 0.01 vs p1 0.05, α = β = 0.05: +ln(p1/p0) per wrong, +ln((1−p1)/(1−p0)) per
//                          clean, the sum divided by Deff and compared with ln((1−β)/α) (kill) and ln(β/(1−α)) (serve)
//                          after each parent; truncated at the end of the decisions (no crossing → no decision);
//   (c) reuseSamplingPlan  single sampling n = 181, c = 4 (`samplingPlanDesign`) in effective units: read parents until
//                          n/Deff ≥ 181, then serve iff x/Deff ≤ 4.
// Every rule returns { decision: 'serve' | 'kill' | 'no-decision', n (decisions read), wrong, deff, ... }; only 'serve'
// turns reuse on. Operating characteristics: experiments/lib/reuse-rule-sim.mjs.
export const RHO_REUSE_FLOOR = 0.1;

export function binomPmf(k, n, p) {
  if (k < 0 || k > n) return 0;
  return Math.exp(logChoose(n, k) + (k ? k * Math.log(p) : 0) + (n - k ? (n - k) * Math.log(1 - p) : 0));
}
// P(X ≤ k) for X ~ Binomial(n, p).
export function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) s += binomPmf(i, n, p);
  return Math.min(1, s);
}

// Group admitted reuse decisions into clusters by `key` (default 'parent'), in order of first appearance. A decision is
// { parent, wrong: boolean } or { parent, label: 'correct' | 'wrong' } (classifyReuse); anything else is refused, so a
// refusal or a deopt cannot be counted as a clean reuse by accident.
export function clustersOf(decisions, { key = 'parent' } = {}) {
  const out = new Map();
  for (const d of decisions) {
    const id = d?.[key];
    if (id == null) throw new Error(`clustersOf: decision without ${key}`);
    const w = typeof d.wrong === 'boolean' ? d.wrong : d.label === 'wrong' ? true : d.label === 'correct' ? false : null;
    if (w == null) throw new Error('clustersOf: each decision needs wrong: boolean or label correct|wrong (admitted decisions only)');
    if (!out.has(id)) out.set(id, { [key]: id, n: 0, wrong: 0 });
    const c = out.get(id); c.n++; if (w) c.wrong++;
  }
  return [...out.values()];
}

// Kish design effect and effective n for cluster sizes and an intraclass correlation rho.
export function kishDeff(sizes, rho) {
  let N = 0, N2 = 0;
  for (const m of sizes) { N += m; N2 += m * m; }
  return N ? 1 + (N2 / N - 1) * rho : 1;
}
export function kishEffectiveN(sizes, rho) { const N = sizes.reduce((a, m) => a + m, 0); return N / kishDeff(sizes, rho); }

// Running sums over clusters: everything Deff and the ANOVA ICC need, O(1) per cluster.
function clusterSums() {
  const s = { k: 0, N: 0, X: 0, sumY2n: 0, sumN2: 0 };
  s.add = c => { if (!c.n) return s; s.k++; s.N += c.n; s.X += c.wrong; s.sumY2n += (c.wrong * c.wrong) / c.n; s.sumN2 += c.n * c.n; return s; };
  return s;
}
// ANOVA estimator of the intraclass correlation for binary data (Fleiss; Ridout, Demétrio & Firth 1999), clamped to
// [0, 1]; null when not estimable (fewer than 2 clusters, every cluster of size 1, or no variation at all).
function iccFromSums({ k, N, X, sumY2n, sumN2 }) {
  if (k < 2 || N - k < 1) return null;
  const msb = (sumY2n - (X * X) / N) / (k - 1);
  const msw = (X - sumY2n) / (N - k);
  const n0 = (N - sumN2 / N) / (k - 1);
  const den = msb + (n0 - 1) * msw;
  if (!(den > 0)) return null;
  return Math.min(1, Math.max(0, (msb - msw) / den));
}
export function iccAnova(clusters) { const s = clusterSums(); for (const c of clusters) s.add(c); return iccFromSums(s); }

function deffFromSums(s, { rho = RHO_REUSE_FLOOR, estimateRho = true } = {}) {
  const mStar = s.N ? s.sumN2 / s.N : 1;
  const rhoHat = estimateRho ? iccFromSums(s) : null;
  const rhoUsed = Math.max(rho, rhoHat ?? 0);
  const deff = 1 + (mStar - 1) * rhoUsed;
  return { n: s.N, wrong: s.X, parents: s.k, mStar, rhoHat, rhoUsed, deff, nEff: s.N / deff, wrongEff: s.X / deff };
}
// Deff, effective n and effective wrong count of a cluster list under the M3 policy ρ = max(rho, ρ̂).
export function clusterDeff(clusters, opts = {}) { const s = clusterSums(); for (const c of clusters) s.add(c); return deffFromSums(s, opts); }

// Regularized incomplete beta I_x(a, b) (continued fraction, modified Lentz; Numerical Recipes §6.4) and the exact
// (Clopper–Pearson) one-sided bounds it gives for x successes of n, which also accept the non-integer effective counts
// x/Deff of n/Deff (the beta form of the bound). level 0.95: P(upper < p) ≤ 0.05 under independent decisions, exactly.
function logGamma(z) {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < 8; i++) x += g[i] / (z + i + 1);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function betaCf(x, a, b) {
  const tiny = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < tiny ? tiny : d); c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < tiny ? tiny : d); c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
export function betaInc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(x, a, b)) / a : 1 - (front * betaCf(1 - x, b, a)) / b;
}
export function exactBinomialBounds(x, n, { level = 0.95 } = {}) {
  if (!(n > 0)) return { lo: NaN, hi: NaN };
  const alpha = 1 - level;
  const solve = (f, target) => { let lo = 0, hi = 1; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) < target) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  // upper: the u with P(X ≤ x | u) = alpha, i.e. I_u(x + 1, n − x) = 1 − alpha; lower: I_l(x, n − x + 1) = alpha.
  const hi = x >= n ? 1 : solve(u => betaInc(u, x + 1, n - x), 1 - alpha);
  const lo = x <= 0 ? 0 : solve(l => betaInc(l, x, n - x + 1), alpha);
  return { lo, hi };
}

// (a) One-sided 95% bound on the effective counts, read once on all admitted decisions. method 'wilson' (z 1.645, the
// ATTACK's 0/60 → 0.043) or 'exact' (Clopper–Pearson at `level`, 0/60 → 0.0487; its miss never exceeds 1 − level under
// independent decisions).
// bounds: false skips the reported exact interval (the exact decision does not use it; M3b simulation speed).
export function reuseBoundRule(clusters, { bound = 0.05, z = 1.645, level = 0.95, method = 'wilson', minN = 60, rho = RHO_REUSE_FLOOR, estimateRho = true, bounds = true } = {}) {
  const s = clusterDeff(clusters, { rho, estimateRho });
  if (!s.n) return { rule: 'bound', decision: 'no-decision', reason: 'no admitted decisions', method, ...s };
  if (method !== 'wilson' && method !== 'exact') throw new Error(`reuseBoundRule: unknown method ${method}`);
  const x = s.wrongEff, n = s.nEff;
  const w = method === 'exact' ? (bounds ? exactBinomialBounds(x, n, { level }) : { lo: null, hi: null }) : wilson(x, n, z);
  // The exact decision is read off the beta tail at the bound itself (upper ≤ bound ⟺ I_bound(x + 1, n − x) ≥ level;
  // lower > bound ⟺ I_bound(x, n − x + 1) < 1 − level), so it does not depend on the bisection's precision.
  const under = method === 'exact' ? x < n && betaInc(bound, x + 1, n - x) >= level : w.hi <= bound;
  const over = method === 'exact' ? x > 0 && betaInc(bound, x, n - x + 1) < 1 - level : w.lo > bound;
  const decision = s.n >= minN && under ? 'serve' : over ? 'kill' : 'no-decision';
  return { rule: 'bound', decision, upper: w.hi, lower: w.lo, bound, method, ...(method === 'exact' ? { level } : { z }), minN, ...s };
}

// ------------------------------------------------------------------------------------------------ crossed clustering (M3b)
// research/jit-20261008/DEV-NOTES.md D31; PROOF-LEDGER K1; LIBRARY-TESTS L4 (amended 2026-10-14, M3b). L4 offers each
// parent (task) several library entries and each entry to many parents, so admitted decisions cluster two ways, crossed:
// by parent (one input, seen by every entry offered to it) and by entry (one artefact, seen by every parent it is offered
// to; a near-miss variant the gate cannot tell apart is wrong on many parents at once). `reuseBoundRule` corrects for the
// parent axis only. Under an additive crossed variance-components model on the probability scale (every decision has
// variance p(1 − p); two decisions sharing a parent have covariance ρ_P·p(1 − p), sharing an entry ρ_E·p(1 − p), sharing
// neither 0) the variance of the total is exactly N·p(1 − p)·Deff₂ with
//   Deff₂ = 1 + (m*_P − 1)·ρ_P + (m*_E − 1)·ρ_E,   m*_P = Σ n_parent² / N,  m*_E = Σ n_entry² / N
// (each (parent, entry) pair is offered at most once). ρ_P = max(rhoParent, ρ̂_P) and ρ_E = max(rhoEntry, ρ̂_E), each ρ̂
// the one-way ANOVA ICC over that axis's clusters (`iccAnova`), each floor an assumption: RHO_REUSE_FLOOR 0.1 for parents
// (M3) and RHO_ENTRY_FLOOR 0.1 for entries (never measured; the top of the plausible range in D31). combine 'max' takes
// the larger one-way Deff instead (a D31 candidate: admissible, not chosen; kept for the record).
export const RHO_ENTRY_FLOOR = 0.1;

// Parent and entry clusters of one list of admitted decisions ({ parent, entry, wrong | label }).
export function crossedOf(decisions, { rowKey = 'parent', colKey = 'entry' } = {}) {
  return { rows: clustersOf(decisions, { key: rowKey }), cols: clustersOf(decisions, { key: colKey }) };
}

// Two-way Kish design effect for parent sizes, entry sizes and the two ICCs.
export function kishDeff2(parentSizes, entrySizes, rhoParent, rhoEntry) {
  const mStar = sizes => { let N = 0, N2 = 0; for (const m of sizes) { N += m; N2 += m * m; } return N ? N2 / N : 1; };
  return 1 + (mStar(parentSizes) - 1) * rhoParent + (mStar(entrySizes) - 1) * rhoEntry;
}

export function clusterDeff2({ rows, cols }, { rhoParent = RHO_REUSE_FLOOR, rhoEntry = RHO_ENTRY_FLOOR, estimateRho = true, combine = 'sum' } = {}) {
  const sp = clusterSums(), se = clusterSums();
  for (const c of rows) sp.add(c);
  for (const c of cols) se.add(c);
  if (sp.N !== se.N || sp.X !== se.X) throw new Error('clusterDeff2: parent and entry clusters disagree on the decisions');
  const mStarParent = sp.N ? sp.sumN2 / sp.N : 1, mStarEntry = se.N ? se.sumN2 / se.N : 1;
  const rhoHatParent = estimateRho ? iccFromSums(sp) : null, rhoHatEntry = estimateRho ? iccFromSums(se) : null;
  const rhoParentUsed = Math.max(rhoParent, rhoHatParent ?? 0), rhoEntryUsed = Math.max(rhoEntry, rhoHatEntry ?? 0);
  const dP = (mStarParent - 1) * rhoParentUsed, dE = (mStarEntry - 1) * rhoEntryUsed;
  if (combine !== 'sum' && combine !== 'max') throw new Error(`clusterDeff2: unknown combine ${combine}`);
  const deff = 1 + (combine === 'sum' ? dP + dE : Math.max(dP, dE));
  return { n: sp.N, wrong: sp.X, parents: sp.k, entries: se.k, mStarParent, mStarEntry, rhoHatParent, rhoHatEntry, rhoParentUsed,
    rhoEntryUsed, combine, deff, nEff: sp.N / deff, wrongEff: sp.X / deff };
}

// The amended L4 rule (M3b): the one-sided exact bound of `reuseBoundRule` on the two-way effective counts x/Deff₂ of
// n/Deff₂, read once over all admitted decisions. entryGuard (a D31 candidate that never met the false-kill half; off)
// also kills when any one entry's own one-sided exact lower bound, at level 1 − (1 − guardLevel)/entries (Bonferroni), is
// above `bound` on its raw counts. bounds: false skips the reported interval (the decision does not use it; for speed).
export function reuseBoundRule2(crossed, { bound = 0.05, level = 0.95, minN = 60, rhoParent = RHO_REUSE_FLOOR, rhoEntry = RHO_ENTRY_FLOOR,
  estimateRho = true, combine = 'sum', entryGuard = false, guardLevel = 0.95, bounds = true } = {}) {
  const s = clusterDeff2(crossed, { rhoParent, rhoEntry, estimateRho, combine });
  if (!s.n) return { rule: 'bound2', decision: 'no-decision', reason: 'no admitted decisions', ...s };
  const x = s.wrongEff, n = s.nEff;
  const under = x < n && betaInc(bound, x + 1, n - x) >= level;
  const over = x > 0 && betaInc(bound, x, n - x + 1) < 1 - level;
  let guard = null;
  if (entryGuard) {
    const a = (1 - guardLevel) / crossed.cols.length;
    guard = crossed.cols.filter(c => c.wrong > 0 && betaInc(bound, c.wrong, c.n - c.wrong + 1) < a).length;
  }
  const decision = guard ? 'kill' : s.n >= minN && under ? 'serve' : over ? 'kill' : 'no-decision';
  const w = bounds ? exactBinomialBounds(x, n, { level }) : { lo: null, hi: null };
  return { rule: 'bound2', decision, ...(guard ? { reason: `entry guard: ${guard} entr${guard === 1 ? 'y' : 'ies'} confirmed above ${bound}` } : {}),
    upper: w.hi, lower: w.lo, bound, method: 'exact', level, minN, ...(entryGuard ? { guardEntries: guard } : {}), ...s };
}

// (b) Wald SPRT design: per-decision log-likelihood-ratio steps and the two boundaries.
export function sprtDesign({ p0 = 0.01, p1 = 0.05, alpha = 0.05, beta = 0.05 } = {}) {
  if (!(p0 > 0 && p0 < p1 && p1 < 1)) throw new Error('sprtDesign: need 0 < p0 < p1 < 1');
  if (!(alpha > 0 && alpha < 1 && beta > 0 && beta < 1)) throw new Error('sprtDesign: need 0 < alpha, beta < 1');
  return {
    p0, p1, alpha, beta,
    wrongStep: Math.log(p1 / p0), cleanStep: Math.log((1 - p1) / (1 - p0)),
    killAt: Math.log((1 - beta) / alpha), serveAt: Math.log(beta / (1 - alpha)),
  };
}
export function reuseSprt(clusters, { p0 = 0.01, p1 = 0.05, alpha = 0.05, beta = 0.05, rho = RHO_REUSE_FLOOR, estimateRho = true, maxN = Infinity } = {}) {
  const d = sprtDesign({ p0, p1, alpha, beta });
  const s = clusterSums();
  let llr = 0, last = deffFromSums(s, { rho, estimateRho }), statistic = 0;
  for (const c of clusters) {
    if (s.N + c.n > maxN) break;
    s.add(c);
    llr += c.wrong * d.wrongStep + (c.n - c.wrong) * d.cleanStep;
    last = deffFromSums(s, { rho, estimateRho });
    statistic = llr / last.deff;
    if (statistic >= d.killAt) return { rule: 'sprt', decision: 'kill', statistic, llr, design: d, ...last };
    if (statistic <= d.serveAt) return { rule: 'sprt', decision: 'serve', statistic, llr, design: d, ...last };
  }
  return { rule: 'sprt', decision: 'no-decision', reason: 'truncated: no boundary crossed', statistic, llr, design: d, ...last };
}

// (c) The smallest single sampling plan (n, c) with P(kill | p0) ≤ alpha and P(serve | p1) ≤ beta (serve iff x ≤ c).
export function samplingPlanDesign({ p0 = 0.01, p1 = 0.05, alpha = 0.05, beta = 0.05, maxN = 5000 } = {}) {
  for (let n = 1; n <= maxN; n++) {
    let c = 0, cdf0 = binomCdf(0, n, p0);
    while (1 - cdf0 > alpha && c < n) cdf0 = binomCdf(++c, n, p0);
    const miss = binomCdf(c, n, p1);
    if (miss <= beta) return { n, c, falseKill: 1 - cdf0, miss, p0, p1, alpha, beta };
  }
  return null;
}
export function reuseSamplingPlan(clusters, { n: planN = 181, c = 4, rho = RHO_REUSE_FLOOR, estimateRho = true } = {}) {
  const s = clusterSums();
  let last = deffFromSums(s, { rho, estimateRho });
  for (const cl of clusters) {
    s.add(cl);
    last = deffFromSums(s, { rho, estimateRho });
    if (last.nEff >= planN) return { rule: 'plan', decision: last.wrongEff <= c ? 'serve' : 'kill', planN, c, ...last };
  }
  return { rule: 'plan', decision: 'no-decision', reason: `effective n ${last.nEff.toFixed(1)} < plan n ${planN}`, planN, c, ...last };
}

// ------------------------------------------------------------------------------------------------ group-sequential (A4, B7)
// research/compromises-20261021/FIXES.md §2 actions 6 and 7 (register A4, B7). One sequential core for both: the
// AutomationBench dev design (experiments/autobench/sequential.mjs: looks over batches of new tasks, paired at k = 1)
// and the build-level rule (experiments/lib/stats-builds.mjs: looks over blocks of builds). $0, pure, seeded.
//
// Boundaries are two-sided and symmetric, for a statistic that is standard normal under H0 at each look with
// independent increments (the canonical joint distribution; Jennison & Turnbull 2000, ch. 2-3). At information fractions
// t_1 < … < t_K = 1 the test stops at the first look k with |Z_k| ≥ z_k:
//   O'Brien-Fleming (classical)  z_k = C / sqrt(t_k)    (C_B(5, 0.05) = 2.040: nominal .000005/.0013/.0085/.0226/.0413)
//   Pocock                       z_k = c                (C_P(5, 0.05) = 2.413: nominal .0158 at every look)
// C (c) is solved so that P(any crossing | H0) = alpha, by numerical integration of the score process S_k = Z_k·sqrt(t_k)
// over the continuation region (Armitage, McPherson & Rowe 1969; Simpson's rule on a grid). `nominal[k]` is the two-sided
// p-value threshold at look k: a test whose p-value is below it crosses. Exact discrete tests (McNemar, permutation) used
// with these nominal levels are conservative or close to nominal; experiments/autobench/test/sequential.test.mjs and
// experiments/lib/stats-builds.test.mjs measure the realised type-I error by simulation.
//
// Also here: the Beta-mixture e-value for paired binary outcomes (anytime-valid; reported, never the decision), the
// paired sign-flip permutation test (the co-primary partial-credit test of PREREG-AB-v1-AMEND-1) and paired Bayes
// intervals (Dirichlet for binary pairs, Bayesian bootstrap for continuous differences; Bowyer et al. 2025 2503.01747:
// exact/Bayes intervals, not CLT bars, at n < 200).

// erfc with fractional error < 1.2e-7 everywhere (Numerical Recipes §6.2 erfcc), so tail probabilities near 1e-6 keep
// their relative precision (the A&S 7.1.26 form in experiments/jit/stats.mjs is accurate in absolute terms only).
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
/** Standard normal CDF and upper tail with small relative error in the tails. */
export const normalCdf = x => 0.5 * erfc(-x / Math.SQRT2);
export const normalUpper = x => 0.5 * erfc(x / Math.SQRT2);
const normalPdf = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
/** Two-sided p-value of a standard normal statistic. */
export const twoSidedP = z => Math.min(1, 2 * normalUpper(Math.abs(z)));

function infoFractions(looks, fractions) {
  if (!(Number.isInteger(looks) && looks >= 1)) throw new Error(`group-sequential: looks must be a positive integer, got ${looks}`);
  const t = fractions ? [...fractions] : Array.from({ length: looks }, (_, i) => (i + 1) / looks);
  if (t.length !== looks) throw new Error(`group-sequential: ${t.length} fractions for ${looks} looks`);
  for (let i = 0; i < t.length; i++) if (!(t[i] > 0 && (i === 0 || t[i] > t[i - 1]))) throw new Error('group-sequential: fractions must be positive and strictly increasing');
  const last = t[t.length - 1];
  return t.map(x => x / last);
}
const simpson = (n, h) => { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = ((i === 0 || i === n - 1) ? 1 : i % 2 ? 4 : 2) * h / 3; return w; };

/**
 * P(|Z_k| ≥ z[k] at some look k | H0) for two-sided boundaries z at information fractions t (t[K-1] = 1), and the
 * crossing probability at each look. z[k] = Infinity means no stopping at look k. grid: Simpson points per look (odd).
 */
export function crossingProbability(z, t, { grid = 201 } = {}) {
  const K = z.length, n = grid % 2 ? grid : grid + 1;
  if (t.length !== K) throw new Error('crossingProbability: z and t differ in length');
  const half = k => (Number.isFinite(z[k]) ? z[k] : 8) * Math.sqrt(t[k]);   // continuation half-width on the score scale
  const perLook = [Number.isFinite(z[0]) ? 2 * normalUpper(z[0]) : 0];
  let a = half(0), h = (2 * a) / (n - 1), w = simpson(n, h);
  let xs = Float64Array.from({ length: n }, (_, i) => -a + i * h);
  let f = xs.map(s => normalPdf(s / Math.sqrt(t[0])) / Math.sqrt(t[0]));
  for (let k = 1; k < K; k++) {
    const sd = Math.sqrt(t[k] - t[k - 1]), ak = half(k);
    let p = 0;
    if (Number.isFinite(z[k])) for (let i = 0; i < n; i++) p += w[i] * f[i] * (normalUpper((ak - xs[i]) / sd) + normalUpper((ak + xs[i]) / sd));
    perLook.push(p);
    if (k === K - 1) break;
    const hk = (2 * ak) / (n - 1), ys = Float64Array.from({ length: n }, (_, j) => -ak + j * hk), g = new Float64Array(n);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += w[i] * f[i] * normalPdf((ys[j] - xs[i]) / sd); g[j] = s / sd; }
    xs = ys; f = g; w = simpson(n, hk);
  }
  return { total: perLook.reduce((s, x) => s + x, 0), perLook };
}

const boundaryCache = new Map();
function solveBoundary(type, looks, { alpha = 0.05, fractions = null, grid = 201 } = {}) {
  if (!(alpha > 0 && alpha < 1)) throw new Error(`group-sequential: alpha must be in (0, 1), got ${alpha}`);
  const t = infoFractions(looks, fractions);
  const key = JSON.stringify([type, alpha, t, grid]);
  if (boundaryCache.has(key)) return boundaryCache.get(key);
  const shape = type === 'obrien-fleming' ? t.map(x => 1 / Math.sqrt(x)) : t.map(() => 1);
  let lo = 0.1, hi = 12;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (crossingProbability(shape.map(s => mid * s), t, { grid }).total > alpha) lo = mid; else hi = mid;
  }
  const constant = (lo + hi) / 2, z = shape.map(s => constant * s);
  const cp = crossingProbability(z, t, { grid });
  let cum = 0;
  const out = Object.freeze({
    type, alpha, looks, fractions: t, constant, z, nominal: z.map(twoSidedP), alphaAtLook: cp.perLook,
    cumulativeAlpha: cp.perLook.map(p => (cum += p)), totalAlpha: cp.total,
  });
  boundaryCache.set(key, out);
  return out;
}
/** Classical O'Brien-Fleming boundary: z_k = C/sqrt(t_k), two-sided total alpha. looks: K; fractions: optional t_1..t_K. */
export const obrienFlemingBoundary = (looks, opts = {}) => solveBoundary('obrien-fleming', looks, opts);
/** Pocock boundary: one constant z at every look, two-sided total alpha. */
export const pocockBoundary = (looks, opts = {}) => solveBoundary('pocock', looks, opts);
/** Does a two-sided p-value cross the boundary at look k (1-based)? Strict: p < nominal. */
export const crossesAt = (boundary, look, p) => p < boundary.nominal[look - 1];

/**
 * Beta(1, 1)-mixture e-value for b "A only" and c "B only" discordant pairs against H0: P(A only | discordant) = 1/2:
 * E = ∫ q^b (1 − q)^c dq / 2^-n = 2^n / ((n + 1)·C(n, b)), n = b + c. Computed after every pair it is a nonnegative
 * martingale under H0, so P(sup E ≥ 1/alpha) ≤ alpha at any stopping time (Ville). mixtureEvalue(12, 2) = 12.0,
 * mixtureEvalue(12, 3) = 4.5: below 20, where the fixed-n McNemar p is 0.013 and 0.035. Reported beside the planned looks
 * (an unplanned look may cite only the e-value); never the planned decision.
 */
export function mixtureEvalue(b, c) {
  if (!(Number.isInteger(b) && Number.isInteger(c) && b >= 0 && c >= 0)) throw new Error('mixtureEvalue: b and c must be non-negative integers');
  const n = b + c;
  return Math.exp(n * Math.log(2) - Math.log(n + 1) - logChoose(n, b));
}

const pairedDiffs = (x, y) => {
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) throw new Error('paired: x and y must be arrays of equal length (one entry per paired task)');
  return x.map((v, i) => {
    const d = v - y[i];
    if (!Number.isFinite(d)) throw new Error(`paired: entry ${i} is not a finite number`);
    return d;
  });
};

/**
 * Paired sign-flip permutation test of mean(x − y) = 0, two-sided (x, y: per-task outcomes of arms A and B on the same
 * tasks, e.g. official partial credit). Under H0 each task's difference is symmetric about 0, so its sign is
 * exchangeable. p = P(|Σ s_i d_i| ≥ |Σ d_i|). Exact over all 2^m sign vectors of the m non-zero differences when
 * m ≤ exactMax (Gray-code enumeration), else Monte Carlo with B seeded draws, p = (hits + 1)/(B + 1) (valid at any B).
 */
export function pairedPermutation(x, y, { exactMax = 24, iterations = 100000, seed = 'paired-permutation' } = {}) {
  const d = pairedDiffs(x, y), nz = d.filter(v => v !== 0), m = nz.length;
  const obs = nz.reduce((s, v) => s + v, 0), absObs = Math.abs(obs);
  const scale = nz.reduce((s, v) => s + Math.abs(v), 0), tol = 1e-9 * Math.max(1, scale);
  const base = { n: d.length, nonZero: m, meanDiff: d.length ? obs / d.length : NaN, sumDiff: obs };
  if (m === 0) return { ...base, p: 1, method: 'exact', combinations: 1 };
  if (m <= exactMax) {
    // Gray code: step i flips the sign of item ctz(i); the running sum starts with every sign +1.
    const total = 2 ** m;
    let s = obs, hits = 0;
    const sign = new Int8Array(m).fill(1);
    for (let i = 0; i < total; i++) {
      if (i) {
        let j = 0; while (!((i >>> j) & 1)) j++;
        s -= 2 * sign[j] * nz[j]; sign[j] = -sign[j];
        if ((i & 0xffff) === 0) { s = 0; for (let q = 0; q < m; q++) s += sign[q] * nz[q]; } // re-anchor the float sum
      }
      if (Math.abs(s) >= absObs - tol) hits++;
    }
    return { ...base, p: hits / total, method: 'exact', combinations: total };
  }
  const r = rng(seed, m, obs);
  let hits = 0;
  for (let b = 0; b < iterations; b++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += r.next() < 0.5 ? nz[i] : -nz[i];
    if (Math.abs(s) >= absObs - tol) hits++;
  }
  return { ...base, p: (hits + 1) / (iterations + 1), method: 'monte-carlo', iterations, seed };
}

/** Large-sample form of the sign-flip test: z = Σd / sqrt(Σd²) (for simulations; the analysis uses pairedPermutation). */
export function pairedSignFlipZ(x, y) {
  const d = pairedDiffs(x, y);
  const s = d.reduce((a, v) => a + v, 0), q = d.reduce((a, v) => a + v * v, 0);
  return q > 0 ? s / Math.sqrt(q) : 0;
}

// Gamma(shape, 1) draw (Marsaglia & Tsang 2000; shape < 1 by the boost u^(1/shape)).
function gammaDraw(r, shape) {
  if (shape < 1) return gammaDraw(r, shape + 1) * Math.pow(r.next(), 1 / shape);
  const dd = shape - 1 / 3, c = 1 / Math.sqrt(9 * dd);
  for (;;) {
    let z, v;
    do { z = r.normal(); v = 1 + c * z; } while (v <= 0);
    v = v * v * v;
    const u = r.next();
    if (u < 1 - 0.0331 * z ** 4 || Math.log(u) < 0.5 * z * z + dd * (1 - v + Math.log(v))) return dd * v;
  }
}
const quantileSorted = (s, p) => { if (!s.length) return NaN; const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (s[hi] - s[lo]) * (h - lo); };

/**
 * Paired Bayes interval for mean(x) − mean(y) over paired tasks.
 *   binary (every value 0 or 1): the 2×2 table (both, A only, B only, neither) gets a Dirichlet(1, 1, 1, 1) prior; the
 *     difference is θ = P(A only) − P(B only) under the Dirichlet posterior (bayes_evals' paired comparison).
 *   continuous (e.g. partial credit): Bayesian bootstrap (Rubin 1981), θ = Σ w_i d_i with w ~ Dirichlet(1, …, 1).
 * Returns the posterior mean, the equal-tailed interval at `level` and P(θ > 0), from `draws` seeded draws.
 */
export function pairedBayesInterval(x, y, { kind = 'auto', level = 0.95, draws = 20000, seed = 'paired-bayes' } = {}) {
  const d = pairedDiffs(x, y);
  const binary = [...x, ...y].every(v => v === 0 || v === 1);
  const k = kind === 'auto' ? (binary ? 'binary' : 'continuous') : kind;
  if (k === 'binary' && !binary) throw new Error('pairedBayesInterval: kind binary needs 0/1 outcomes');
  if (k !== 'binary' && k !== 'continuous') throw new Error(`pairedBayesInterval: unknown kind ${kind}`);
  if (!d.length) return { kind: k, n: 0, mean: NaN, lo: NaN, hi: NaN, level, pPositive: NaN, draws: 0, seed };
  const r = rng(seed, k, d.length);
  const out = new Float64Array(draws);
  let table = null;
  if (k === 'binary') {
    table = { both: 0, aOnly: 0, bOnly: 0, neither: 0 };
    x.forEach((a, i) => { const b = y[i]; table[a && b ? 'both' : a ? 'aOnly' : b ? 'bOnly' : 'neither']++; });
    const shapes = [table.both + 1, table.aOnly + 1, table.bOnly + 1, table.neither + 1];
    for (let i = 0; i < draws; i++) {
      const g = shapes.map(s => gammaDraw(r, s)), tot = g[0] + g[1] + g[2] + g[3];
      out[i] = (g[1] - g[2]) / tot;
    }
  } else {
    for (let i = 0; i < draws; i++) {
      let tot = 0, s = 0;
      for (let j = 0; j < d.length; j++) { const w = -Math.log(1 - r.next()); tot += w; s += w * d[j]; }
      out[i] = s / tot;
    }
  }
  const sorted = Float64Array.from(out).sort();
  const a = (1 - level) / 2;
  let mean = 0, pos = 0;
  for (const v of out) { mean += v; if (v > 0) pos++; }
  return { kind: k, n: d.length, ...(table ? { table } : {}), mean: mean / draws,
    lo: quantileSorted(sorted, a), hi: quantileSorted(sorted, 1 - a), level, pPositive: pos / draws, draws, seed };
}

/** Exact two-sided McNemar on discordant counts (binomial at 1/2, the smaller tail doubled, capped at 1). */
export function mcnemarExactCounts(b, c) {
  const n = b + c, k = Math.min(b, c);
  if (!n) return { aOnly: b, bOnly: c, p: 1 };
  let p = 0;
  for (let i = 0; i <= k; i++) p += Math.exp(logChoose(n, i) - n * Math.log(2));
  return { aOnly: b, bOnly: c, p: Math.min(1, 2 * p) };
}

/** Student t CDF (via the regularized incomplete beta) and quantile, for small-sample build-level MDEs. */
export function studentTCdf(t, df) {
  if (!(df > 0)) throw new Error('studentTCdf: df must be positive');
  const x = df / (df + t * t), tail = 0.5 * betaInc(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}
export function studentTQuantile(p, df) {
  if (!(p > 0 && p < 1)) throw new Error('studentTQuantile: p must be in (0, 1)');
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (studentTCdf(m, df) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
