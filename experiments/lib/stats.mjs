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
export function reuseBoundRule(clusters, { bound = 0.05, z = 1.645, level = 0.95, method = 'wilson', minN = 60, rho = RHO_REUSE_FLOOR, estimateRho = true } = {}) {
  const s = clusterDeff(clusters, { rho, estimateRho });
  if (!s.n) return { rule: 'bound', decision: 'no-decision', reason: 'no admitted decisions', method, ...s };
  if (method !== 'wilson' && method !== 'exact') throw new Error(`reuseBoundRule: unknown method ${method}`);
  const x = s.wrongEff, n = s.nEff;
  const w = method === 'exact' ? exactBinomialBounds(x, n, { level }) : wilson(x, n, z);
  // The exact decision is read off the beta tail at the bound itself (upper ≤ bound ⟺ I_bound(x + 1, n − x) ≥ level;
  // lower > bound ⟺ I_bound(x, n − x + 1) < 1 − level), so it does not depend on the bisection's precision.
  const under = method === 'exact' ? x < n && betaInc(bound, x + 1, n - x) >= level : w.hi <= bound;
  const over = method === 'exact' ? x > 0 && betaInc(bound, x, n - x + 1) < 1 - level : w.lo > bound;
  const decision = s.n >= minN && under ? 'serve' : over ? 'kill' : 'no-decision';
  return { rule: 'bound', decision, upper: w.hi, lower: w.lo, bound, method, ...(method === 'exact' ? { level } : { z }), minN, ...s };
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
