// M3 operating-characteristic simulation (ATTACK-20261014 §3 M3; PROOF-LEDGER K1; LIBRARY-TESTS L4). $0, no model call,
// seeded and deterministic. For each true wrong-reuse rate p and parent intraclass correlation rho it draws admitted
// reuse decisions clustered by parent and reports, per rule, P(serve), P(kill) and P(no decision):
//   false kill = P(not served) at p ≤ 0.01 (a 'no-decision' also leaves reuse off, so it counts);
//   miss       = P(served)     at p ≥ 0.05.
// The M3 criterion: false kill ≤ 5% at p ≤ 0.01 and miss ≤ 5% at p ≥ 0.05, at L4's scale (about 580 decisions).
// `decide` applies it mechanically (binding cells, then a declared tie-break; see there).
//
// Parent clustering model (explicit). Parent j has m_j admitted decisions. Its own wrong rate is p_j ~ Beta(a, b) with
// mean p and ICC rho (a = p(1 − rho)/rho, b = (1 − p)(1 − rho)/rho; rho = 0 or p ∈ {0, 1} gives p_j = p), and its
// decisions are Bernoulli(p_j) given p_j (beta-binomial). Marginally every decision is wrong with probability p, and two
// decisions of one parent are correlated by rho, so the true Kish design effect is 1 + (m* − 1)·rho. Parents arrive in
// draw order, all of a parent's decisions together (the sequential rules look once per parent).
//
//   node experiments/lib/reuse-rule-sim.mjs [--reps 20000] [--seed m3] [--json out.json] [--md out.md]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rng } from '../../beds/lib/rng.mjs';
import { wilson, reuseBoundRule, reuseBoundRule2, reuseSprt, reuseSamplingPlan, binomCdf, RHO_REUSE_FLOOR } from './stats.mjs';

// ------------------------------------------------------------------------------------------------ samplers
// Marsaglia–Tsang gamma; shape < 1 by the U^(1/a) boost.
export function gammaSample(r, a) {
  if (!(a > 0)) throw new Error('gammaSample: shape must be > 0');
  if (a < 1) return gammaSample(r, a + 1) * Math.pow(Math.max(r.next(), 1e-300), 1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = r.normal(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.max(r.next(), 1e-300);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export function betaSample(r, a, b) {
  const x = gammaSample(r, a), y = gammaSample(r, b);
  return x + y > 0 ? x / (x + y) : (r.next() < a / (a + b) ? 1 : 0);
}

// One data set: clusters [{ n, wrong }] for the given sizes.
export function drawClusters(r, { p, rho, sizes }) {
  const clustered = rho > 0 && p > 0 && p < 1;
  const a = clustered ? (p * (1 - rho)) / rho : 0, b = clustered ? ((1 - p) * (1 - rho)) / rho : 0;
  const out = new Array(sizes.length);
  for (let j = 0; j < sizes.length; j++) {
    const pj = clustered ? betaSample(r, a, b) : p;
    let w = 0;
    for (let i = 0; i < sizes[j]; i++) if (r.next() < pj) w++;
    out[j] = { n: sizes[j], wrong: w };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ rules
// The rule L4 has today (LIBRARY-TESTS.md L4 "Decision" before 2026-10-14, LIBRARY.md §9 kill): kill as soon as ≥ 20
// decisions have a point estimate > 0.10; else serve iff ≥ 60 decisions and the two-sided 95% Wilson upper bound ≤ 0.05
// (kill if the bound is above 0.05 at ≥ 60). No clustering correction.
export function reuseRuleV1(clusters, { bound = 0.05, minN = 60, earlyN = 20, earlyPoint = 0.1 } = {}) {
  let n = 0, x = 0;
  for (const c of clusters) {
    n += c.n; x += c.wrong;
    if (n >= earlyN && x / n > earlyPoint) return { rule: 'v1', decision: 'kill', reason: 'early-kill', n, wrong: x };
  }
  const w = wilson(x, n);
  const decision = n < minN ? 'no-decision' : w.hi <= bound ? 'serve' : 'kill';
  return { rule: 'v1', decision, reason: 'bound', upper: w.hi, n, wrong: x };
}

const NAIVE = { rho: 0, estimateRho: false };
export const RULES = {
  v1: { label: 'current: two-sided Wilson ≤ 0.05 at ≥ 60, early kill > 0.10 at ≥ 20, no Deff', run: c => reuseRuleV1(c) },
  a: { label: '(a) one-sided 95% Wilson bound ≤ 0.05 (the ATTACK form), Deff ρ = max(0.1, ρ̂)', run: c => reuseBoundRule(c) },
  aE: { label: '(a) one-sided 95% exact (Clopper–Pearson) bound ≤ 0.05, Deff ρ = max(0.1, ρ̂)', run: c => reuseBoundRule(c, { method: 'exact' }) },
  b: { label: '(b) SPRT 0.01/0.05, α = β = 0.05, Deff ρ = max(0.1, ρ̂)', run: c => reuseSprt(c) },
  c: { label: '(c) plan n = 181, c = 4 in effective units, Deff ρ = max(0.1, ρ̂)', run: c => reuseSamplingPlan(c) },
  a0: { label: '(a) Wilson without Deff', run: c => reuseBoundRule(c, NAIVE) },
  aE0: { label: '(a) exact without Deff', run: c => reuseBoundRule(c, { ...NAIVE, method: 'exact' }) },
  b0: { label: '(b) without Deff', run: c => reuseSprt(c, NAIVE) },
  c0: { label: '(c) without Deff', run: c => reuseSamplingPlan(c, NAIVE) },
};

const rep = (xs, k) => Array.from({ length: k }, () => xs).flat();
export const SCENARIOS = {
  'L4-parent': { sizes: Array(96).fill(6), note: 'L4 scale: 24 tasks × 4 rungs = 96 parents × 6 admitted offers = 576' },
  'L4-parent-unequal': { sizes: rep([1, 11, 2, 10, 3, 9, 4, 8, 5, 7, 6, 6], 8), note: '96 parents, sizes 1–11 (mean 6, m* 7.83), 576' },
  'L4-indep': { sizes: Array(576).fill(1), note: '576 independent decisions (no clustering possible)' },
  'L4-entry': { sizes: Array(24).fill(24), note: 'sensitivity: clustered by library entry instead, 24 entries × 24 tasks = 576' },
  'mid-parent': { sizes: Array(30).fill(6), note: '30 parents × 6 = 180 (a gate that admits about a third of the offers)' },
  'small-parent': { sizes: Array(10).fill(6), note: 'small n: 10 parents × 6 = 60' },
  'small-indep': { sizes: Array(60).fill(1), note: 'small n: 60 independent decisions' },
};
export const P_GRID = [0, 0.01, 0.03, 0.05];
export const RHO_GRID = [0, 0.05, 0.1, 0.2];

// ------------------------------------------------------------------------------------------------ simulation
export function simulate({ p, rho, sizes, reps = 10000, seed = 'm3', rules = Object.keys(RULES) }) {
  const r = rng(seed, 'p', p, 'rho', rho, 'sizes', sizes.join(','));
  const t = Object.fromEntries(rules.map(k => [k, { serve: 0, kill: 0, none: 0, used: 0 }]));
  for (let i = 0; i < reps; i++) {
    const clusters = drawClusters(r, { p, rho, sizes });
    for (const k of rules) {
      const d = RULES[k].run(clusters), x = t[k];
      if (d.decision === 'serve') x.serve++; else if (d.decision === 'kill') x.kill++; else x.none++;
      x.used += d.n;
    }
  }
  return Object.fromEntries(rules.map(k => [k, { serve: t[k].serve / reps, kill: t[k].kill / reps, none: t[k].none / reps, meanDecisions: t[k].used / reps }]));
}

// Exact operating characteristic for independent decisions (every parent of size 1, so Deff = 1 whatever ρ): a dynamic
// program over (decisions read, wrong so far) that calls the real rule functions on the aggregate counts at each step.
// The sequential rules absorb at a crossing; (a) and v1's bound read at the end; (c) reads at its plan n.
export function exactIndependent(ruleKey, N, p) {
  const one = (n, x) => [{ n, wrong: x }];
  const step = {
    v1: (n, x) => (n < N ? (reuseRuleV1(one(n, x)).reason === 'early-kill' ? 'kill' : null) : reuseRuleV1(one(n, x)).decision),
    a: (n, x) => (n < N ? null : reuseBoundRule(one(n, x), NAIVE).decision),
    aE: (n, x) => (n < N ? null : reuseBoundRule(one(n, x), { ...NAIVE, method: 'exact' }).decision),
    b: (n, x) => reuseSprt(one(n, x), NAIVE).decision,
    c: (n, x) => (n < N && n < 181 ? null : reuseSamplingPlan(one(n, x), NAIVE).decision),
  }[ruleKey];
  if (!step) throw new Error(`exactIndependent: no exact form for rule ${ruleKey}`);
  let dist = new Float64Array(N + 1); dist[0] = 1;
  let serve = 0, kill = 0;
  for (let n = 1; n <= N; n++) {
    const next = new Float64Array(N + 1);
    for (let x = 0; x < n; x++) { const q = dist[x]; if (q) { next[x] += q * (1 - p); next[x + 1] += q * p; } }
    for (let x = 0; x <= n; x++) {
      if (!next[x]) continue;
      const d = step(n, x);
      if (d === 'serve') { serve += next[x]; next[x] = 0; } else if (d === 'kill') { kill += next[x]; next[x] = 0; }
    }
    dist = next;
    if (ruleKey === 'c' && n >= 181) break;
  }
  return { serve, kill, none: Math.max(0, 1 - serve - kill) };
}

// The M3 criterion on one scenario's results: worst false kill over p ≤ 0.01, worst miss over p ≥ 0.05.
export function criterion(byP, { killMax = 0.05, missMax = 0.05 } = {}) {
  const ps = Object.keys(byP).map(Number);
  const falseKill = Math.max(...ps.filter(p => p <= 0.01).map(p => 1 - byP[p].serve));
  const miss = Math.max(...ps.filter(p => p >= 0.05).map(p => byP[p].serve));
  return { falseKill, miss, pass: falseKill <= killMax && miss <= missMax };
}

export function runGrid({ reps = 10000, seed = 'm3', scenarios = Object.keys(SCENARIOS), rhos = RHO_GRID, ps = P_GRID } = {}) {
  const rows = [];
  for (const sc of scenarios) {
    const { sizes } = SCENARIOS[sc];
    const clustered = sizes.some(m => m > 1);
    for (const rho of clustered ? rhos : [0]) {
      const byRule = {};
      for (const p of ps) {
        const res = simulate({ p, rho, sizes, reps, seed });
        for (const [k, v] of Object.entries(res)) (byRule[k] ??= {})[p] = v;
      }
      for (const [rule, byP] of Object.entries(byRule)) rows.push({ scenario: sc, n: sizes.reduce((a, m) => a + m, 0), parents: sizes.length, rho, rule, byP, ...criterion(byP) });
    }
  }
  return rows;
}

// How many parents of 6 the rules need: P(serve) at p ∈ {0, 0.01, 0.05} as the number of parents grows.
export function nNeeded({ reps = 10000, seed = 'm3-n', parents = [10, 20, 30, 40, 50, 60, 70, 80, 96, 120], m = 6, rhos = [0, 0.1, 0.2], rules = ['aE', 'a', 'b', 'c'] } = {}) {
  const rows = [];
  for (const rho of rhos) for (const J of parents) {
    const sizes = Array(J).fill(m), byRule = {};
    for (const p of [0, 0.01, 0.05]) {
      const res = simulate({ p, rho, sizes, reps, seed, rules });
      for (const [k, v] of Object.entries(res)) (byRule[k] ??= {})[p] = v;
    }
    for (const [rule, byP] of Object.entries(byRule)) rows.push({ parents: J, n: J * m, rho, rule, byP, ...criterion(byP) });
  }
  return rows;
}

// The decision procedure. It was fixed after the first grid run (2026-10-14) and before any L4 data exist; the exact
// variant aE was added at the same point (research/jit-20261008/DEV-NOTES.md D26 says why):
//   binding  every L4-scale parent-clustered cell at rho ≤ RHO_REUSE_FLOOR (0.1, the programme's assumed ICC), equal and
//            unequal parent sizes, meets the criterion (simulated), and the independent limit (n = 576, m = 1) meets it
//            EXACTLY (`exactIndependent`, no Monte Carlo);
//   tie-break among rules that pass the binding set: the most robustness cells met (L4 scale at rho 0.2, the by-entry
//            sensitivity at every rho, the 180-decision scenario at every rho); then the lower worst false kill there.
export const BINDING_SCENARIOS = ['L4-parent', 'L4-parent-unequal'];
export const ROBUSTNESS = r => (BINDING_SCENARIOS.includes(r.scenario) && r.rho > RHO_REUSE_FLOOR) || r.scenario === 'L4-entry' || r.scenario === 'mid-parent';
export function decide(grid, exact, { candidates = ['a', 'aE', 'b', 'c'], missMax = 0.05, killMax = 0.05 } = {}) {
  const out = [];
  for (const rule of candidates) {
    const rows = grid.filter(r => r.rule === rule);
    const binding = rows.filter(r => BINDING_SCENARIOS.includes(r.scenario) && r.rho <= RHO_REUSE_FLOOR);
    const ex = Object.fromEntries(exact.filter(e => e.rule === rule).map(e => [e.p, e.exact]));
    const exactPass = ex[0.01] && ex[0.05] ? 1 - ex[0.01].serve <= killMax && ex[0.05].serve <= missMax : null;
    const failed = binding.filter(r => !r.pass).map(r => `${r.scenario} rho ${r.rho} (false kill ${(100 * r.falseKill).toFixed(1)}%, miss ${(100 * r.miss).toFixed(1)}%)`);
    if (exactPass === false) failed.push(`independent n 576 exact (false kill ${(100 * (1 - ex[0.01].serve)).toFixed(2)}%, miss ${(100 * ex[0.05].serve).toFixed(2)}%)`);
    const robust = rows.filter(ROBUSTNESS);
    out.push({ rule, passesBinding: exactPass !== null && failed.length === 0, failedBinding: failed,
      robustnessMet: robust.filter(r => r.pass).length, robustnessCells: robust.length,
      worstRobustFalseKill: Math.max(...robust.map(r => r.falseKill)) });
  }
  const ok = out.filter(o => o.passesBinding).sort((x, y) => y.robustnessMet - x.robustnessMet || x.worstRobustFalseKill - y.worstRobustFalseKill);
  return { candidates: out, chosen: ok[0]?.rule ?? null };
}

// ================================================================================================ M3b: crossed clustering
// research/jit-20261008/DEV-NOTES.md D31; PROOF-LEDGER K1; LIBRARY-TESTS L4 (amended again 2026-10-14, M3b). The M3
// verifier (workflow wf_6272b7d3-7af) showed that when wrong reuses cluster by LIBRARY ENTRY (L4 offers each of 96 parents
// about 6 of about 12 entries, 9 of them near-miss variants), the parent-only rule above serves a p = 0.05 gate about 11%
// of the time. This section models parent × entry clustering, crossed.
//
// Crossed model (explicit). P parents, E entries; parent i is offered `perParent` distinct entries (allocation below), and
// each offer is admitted independently with probability `admit` (a selective gate admits fewer). A decision is wrong when
// either of two independent mechanisms fires (noisy-OR): the parent's input defeats the reused artefact (rate u_i) or the
// entry is defective for this kind of input (rate v_j), so q_ij = 1 − (1 − u_i)(1 − v_j), always in [0, 1]. Then exactly
//   E[q] = 1 − (1 − μ_u)(1 − μ_v) = p,
//   Cov(two decisions of one parent) = Var(u)·(1 − μ_v)²,  Cov(two decisions of one entry) = Var(v)·(1 − μ_u)²,  else 0,
// so with ρ_P = Var(u)(1 − μ_v)² / p(1 − p) and ρ_E = Var(v)(1 − μ_u)² / p(1 − p) (probability-scale ICCs) stats.mjs Deff₂ is
// the exact design effect of the wrong count. Shapes:
//   'beta'   u_i ~ Beta and v_j ~ Beta. The mean splits by the ICCs, 1 − μ_u = (1 − p)^s and 1 − μ_v = (1 − p)^(1 − s) with
//            s = ρ_P/(ρ_P + ρ_E), and each variance is set to hit its ICC. At ρ_E = 0 this is M3's beta-binomial parent
//            model exactly (v ≡ 0, u ~ Beta(mean p, ICC ρ_P)); at ρ_P = 0 the same model by entry.
//   'blind'  a stress shape for the near-miss structure: entry j is independently a blind spot with probability π, and then
//            v_j = qb = 0.5 (wrong on half its admitted decisions), else v_j = 0; u_i ~ Beta with 1 − μ_u = (1 − p)^½ and the
//            parent ICC ρ_P; π = (1 − (1 − p)^½)/qb, so the mean is p. Its entry ICC (`trueIccs`) is ≈ 0.24, far outside
//            the plausible range; the rhoE argument is ignored.
// (A first draft, never run on the grid, used q = min(1, a_i·b_j/p) with a, b ~ Beta(mean p); its cap removed 18–19% of the
// mean at p = 0.01 with both ICCs 0.1, and at p = 0.05 with both 0.2. D31 §7.)
// Allocations:
//   'balanced'  random permutations of the E entries are dealt `perParent` at a time, so every entry is offered equally
//               often and parents overlap at random (E divisible by perParent; otherwise the remainder is skipped);
//   'solver'    entries 0–2 stand for the three accepted solvers: parent i is offered solver i mod 3 plus perParent − 1
//               distinct others drawn uniformly, so entry sizes are unequal.
// Estimands. The L4 question, "may this gate configuration serve production reuse?", is about parents AND entries the gate
// has not seen, so p is the mean over the entry population (entries random). The diagnostic θ_lib = mean over admitted
// decisions of 1 − (1 − μ_u)(1 − v_j) is the rate on THIS library (entries fixed, parents random); a parent-only rule bounds
// θ_lib, not p.
export const BLIND_QB = 0.5;
// Generator parameters for one cell: the two mechanism means and variances, and the probability-scale ICCs they give.
export function crossedParams({ p, rhoP = 0, rhoE = 0, shape = 'beta' }) {
  if (!(p > 0 && p < 1)) return { live: false, muU: p, muV: 0, varU: 0, varV: 0, pi: 0, iccP: 0, iccE: 0 };
  const v = p * (1 - p);
  if (shape === 'beta') {
    const s = rhoP + rhoE > 0 ? rhoP / (rhoP + rhoE) : 1;
    const muU = 1 - Math.pow(1 - p, s), muV = 1 - Math.pow(1 - p, 1 - s);
    const varU = (rhoP * v) / (1 - muV) ** 2, varV = (rhoE * v) / (1 - muU) ** 2;
    if (varU >= muU * (1 - muU) && rhoP > 0) throw new Error(`crossedParams: parent ICC ${rhoP} unreachable at p ${p}`);
    if (varV >= muV * (1 - muV) && rhoE > 0) throw new Error(`crossedParams: entry ICC ${rhoE} unreachable at p ${p}`);
    return { live: true, shape, muU, muV, varU, varV, pi: 0, iccP: rhoP, iccE: rhoE };
  }
  if (shape === 'blind') {
    const muU = 1 - Math.sqrt(1 - p), pi = (1 - Math.sqrt(1 - p)) / BLIND_QB, muV = pi * BLIND_QB;
    const varU = (rhoP * v) / (1 - muV) ** 2, varV = pi * (1 - pi) * BLIND_QB ** 2;
    if (varU >= muU * (1 - muU) && rhoP > 0) throw new Error(`crossedParams: parent ICC ${rhoP} unreachable at p ${p}`);
    return { live: true, shape, muU, muV, varU, varV, pi, iccP: rhoP, iccE: (varV * (1 - muU) ** 2) / v };
  }
  throw new Error(`crossedParams: unknown shape ${shape}`);
}
// Probability-scale ICCs of the generator (the reference rule uses them).
export function trueIccs(cell) { const g = crossedParams(cell); return { rhoP: g.iccP, rhoE: g.iccE }; }

// Beta with a given mean and variance (variance 0 gives the constant).
function betaMV(r, mu, varx) {
  if (!(varx > 0) || mu <= 0 || mu >= 1) return mu;
  const k = (mu * (1 - mu)) / varx - 1;
  return betaSample(r, mu * k, (1 - mu) * k);
}

// One data set: { rows: parent clusters, cols: entry clusters, n, wrong, qSum, thetaLib, decisions? }.
export function drawCrossed(r, { p, rhoP = 0, rhoE = 0, parents = 96, entries = 12, perParent = 6, admit = 1, shape = 'beta', alloc = 'balanced', decisions = false }) {
  if (!(perParent >= 1 && perParent <= entries)) throw new Error('drawCrossed: need 1 ≤ perParent ≤ entries');
  if (alloc === 'solver' && entries < perParent + 2) throw new Error('drawCrossed: solver allocation needs entries ≥ perParent + 2');
  const g = crossedParams({ p, rhoP, rhoE, shape });
  const u = new Float64Array(parents), v = new Float64Array(entries);
  if (g.live) {
    for (let i = 0; i < parents; i++) u[i] = betaMV(r, g.muU, g.varU);
    for (let j = 0; j < entries; j++) v[j] = shape === 'blind' ? (r.next() < g.pi ? BLIND_QB : 0) : betaMV(r, g.muV, g.varV);
  }
  const perm = Int32Array.from({ length: entries }, (_, k) => k);
  const shuffle = (arr, lo, hi) => { for (let k = hi - 1; k > lo; k--) { const j = lo + Math.floor(r.next() * (k - lo + 1)); const t = arr[k]; arr[k] = arr[j]; arr[j] = t; } };
  let pos = entries;
  const colN = new Int32Array(entries), colX = new Int32Array(entries), rows = [], list = decisions ? [] : null;
  let n = 0, wrong = 0, qSum = 0, thetaSum = 0;
  for (let i = 0; i < parents; i++) {
    let set;
    if (alloc === 'balanced') {
      if (pos + perParent > entries) { shuffle(perm, 0, entries); pos = 0; }
      set = perm.subarray(pos, pos + perParent); pos += perParent;
    } else if (alloc === 'solver') {
      // perm[3..] holds the non-solver entries; a partial Fisher–Yates draws perParent − 1 of them.
      const m = entries - 3;
      for (let k = 0; k < perParent - 1; k++) { const j = 3 + k + Math.floor(r.next() * (m - k)); const t = perm[3 + k]; perm[3 + k] = perm[j]; perm[j] = t; }
      set = [i % 3, ...perm.subarray(3, 3 + perParent - 1)];
    } else throw new Error(`drawCrossed: unknown alloc ${alloc}`);
    let ni = 0, xi = 0;
    for (const j of set) {
      if (admit < 1 && r.next() >= admit) continue;
      const q = g.live ? 1 - (1 - u[i]) * (1 - v[j]) : p;
      const w = q > 0 && r.next() < q ? 1 : 0;
      ni++; xi += w; colN[j]++; colX[j] += w; qSum += q; thetaSum += g.live ? 1 - (1 - g.muU) * (1 - v[j]) : p;
      if (list) list.push({ parent: i, entry: j, wrong: w === 1 });
    }
    if (ni) rows.push({ n: ni, wrong: xi });
    n += ni; wrong += xi;
  }
  const cols = [];
  for (let j = 0; j < entries; j++) if (colN[j]) cols.push({ n: colN[j], wrong: colX[j] });
  return { rows, cols, n, wrong, qSum, thetaLib: n ? thetaSum / n : NaN, ...(list ? { decisions: list } : {}) };
}

// Rules on crossed data. `truth` (trueIccs) is used only by the non-deployable reference.
const FAST = { method: 'exact', bounds: false };
export const RULES2 = {
  aE: { label: 'the M3 rule as written into L4: one-sided exact bound, Deff by parent only, ρ_P = max(0.1, ρ̂_P)', run: c => reuseBoundRule(c.rows, FAST) },
  aE0: { label: 'one-sided exact bound, no Deff', run: c => reuseBoundRule(c.rows, { ...FAST, rho: 0, estimateRho: false }) },
  aEe: { label: 'Deff by entry only, ρ_E = max(0.1, ρ̂_E) (the verifier\'s "by entry")', run: c => reuseBoundRule(c.cols, FAST) },
  aEx: { label: 'the larger of the two one-way Deffs, floors 0.1 and 0.1', run: c => reuseBoundRule2(c, { combine: 'max', bounds: false }) },
  aE2: { label: 'two-way Deff₂ = 1 + (m*_P − 1)ρ_P + (m*_E − 1)ρ_E, ρ_P = max(0.1, ρ̂_P), ρ_E = max(0.1, ρ̂_E)', run: c => reuseBoundRule2(c, { bounds: false }) },
  aE2h: { label: 'two-way Deff₂ with the entry floor at 0.05', run: c => reuseBoundRule2(c, { rhoEntry: 0.05, bounds: false }) },
  aE2g: { label: 'aE2 plus a per-entry guard (kill if any entry\'s Bonferroni exact lower bound > 0.05)', run: c => reuseBoundRule2(c, { entryGuard: true, bounds: false }) },
  ref: { label: 'reference, not deployable: Deff₂ at the generator\'s true ICCs (no floor, no estimate)', run: (c, t) => reuseBoundRule2(c, { rhoParent: t.rhoP, rhoEntry: t.rhoE, estimateRho: false, bounds: false }) },
};
export const CANDIDATES2 = ['aE', 'aEe', 'aEx', 'aE2', 'aE2h', 'aE2g'];

export function simulateCrossed({ reps = 10000, seed = 'm3b', rules = Object.keys(RULES2), ...cell }) {
  const { p, rhoP = 0, rhoE = 0, parents = 96, entries = 12, perParent = 6, admit = 1, shape = 'beta', alloc = 'balanced' } = cell;
  const r = rng(seed, 'crossed', p, rhoP, rhoE, parents, entries, perParent, admit, shape, alloc);
  const truth = trueIccs({ p, rhoP, rhoE, shape });
  const t = Object.fromEntries(rules.map(k => [k, { serve: 0, kill: 0, none: 0, serveLibBad: 0, notServeLibGood: 0 }]));
  let nSum = 0, qSum = 0, libBad = 0, libGood = 0;
  for (let i = 0; i < reps; i++) {
    const c = drawCrossed(r, { p, rhoP, rhoE, parents, entries, perParent, admit, shape, alloc });
    nSum += c.n; qSum += c.qSum;
    const bad = c.thetaLib >= 0.05, good = c.thetaLib <= 0.01;
    if (bad) libBad++; if (good) libGood++;
    for (const k of rules) {
      const d = RULES2[k].run(c, truth).decision, x = t[k];
      if (d === 'serve') { x.serve++; if (bad) x.serveLibBad++; } else { if (good) x.notServeLibGood++; if (d === 'kill') x.kill++; else x.none++; }
    }
  }
  const byRule = Object.fromEntries(rules.map(k => [k, { serve: t[k].serve / reps, kill: t[k].kill / reps, none: t[k].none / reps,
    serveIfLibBad: libBad ? t[k].serveLibBad / libBad : null, notServedIfLibGood: libGood ? t[k].notServeLibGood / libGood : null }]));
  return { byRule, meanAdmitted: nSum / reps, meanQ: nSum ? qSum / nSum : NaN, libBadShare: libBad / reps, libGoodShare: libGood / reps, truth };
}

// The grid. Plausible (binding) range, declared before the grid was run: shape 'beta', balanced allocation, ρ_P ∈ {0, 0.1}
// (M3's binding range), ρ_E ∈ {0, 0.02, 0.05, 0.1} (the verifier's range; no reuse ICC has been measured), at L4's 96
// parents × 6 offers, every E in E_GRID and admitted share 1 or 0.5. Robustness (admitted share 1): ρ_P 0.2; ρ_E 0.2;
// the 'blind' shape; the 'solver' allocation.
export const CROSSED = {
  parents: 96, perParent: 6, entries: [12, 24, 48, 96], admit: [1, 0.5], ps: [0, 0.01, 0.05],
  binding: { shape: 'beta', alloc: 'balanced', rhoP: [0, 0.1], rhoE: [0, 0.02, 0.05, 0.1] },
  robustness: [
    { name: 'rhoP 0.2', shape: 'beta', alloc: 'balanced', rhoP: [0.2], rhoE: [0, 0.05, 0.1] },
    { name: 'rhoE 0.2', shape: 'beta', alloc: 'balanced', rhoP: [0, 0.1], rhoE: [0.2] },
    { name: 'blind spots', shape: 'blind', alloc: 'balanced', rhoP: [0.1], rhoE: [0] },
    { name: 'solver-heavy', shape: 'beta', alloc: 'solver', rhoP: [0.1], rhoE: [0, 0.05, 0.1] },
  ],
};

function criterionRow(base, byP, rule, { killMax = 0.05, missMax = 0.05 } = {}) {
  const v = p => byP[p].byRule[rule];
  const falseKill = 1 - v(0.01).serve, miss = v(0.05).serve;
  return { ...base, rule, serve: Object.fromEntries(Object.keys(byP).map(p => [p, v(p).serve])), falseKill, miss,
    pass: falseKill <= killMax && miss <= missMax, libMiss: v(0.05).serveIfLibBad, libFalseKill: v(0.01).notServedIfLibGood,
    meanAdmitted: byP[0.05].meanAdmitted, meanQ: byP[0.05].meanQ, truth: byP[0.05].truth, libBadShare: byP[0.05].libBadShare };
}

export function runCrossedGrid({ reps = 10000, seed = 'm3b', spec = CROSSED, rules = Object.keys(RULES2) } = {}) {
  const configs = [];
  for (const E of spec.entries) for (const admit of spec.admit) for (const rhoP of spec.binding.rhoP) for (const rhoE of spec.binding.rhoE) {
    configs.push({ tier: 'binding', name: 'plausible', shape: spec.binding.shape, alloc: spec.binding.alloc, entries: E, admit, rhoP, rhoE });
  }
  for (const rb of spec.robustness) for (const E of spec.entries) for (const rhoP of rb.rhoP) for (const rhoE of rb.rhoE) {
    configs.push({ tier: 'robustness', name: rb.name, shape: rb.shape, alloc: rb.alloc, entries: E, admit: 1, rhoP, rhoE });
  }
  const rows = [];
  for (const cfg of configs) {
    const byP = {};
    for (const p of spec.ps) {
      byP[p] = simulateCrossed({ reps: p === 0 ? Math.min(reps, 500) : reps, seed, rules, p, rhoP: cfg.rhoP, rhoE: cfg.rhoE, parents: spec.parents,
        entries: cfg.entries, perParent: spec.perParent, admit: cfg.admit, shape: cfg.shape, alloc: cfg.alloc });
    }
    for (const rule of rules) rows.push(criterionRow({ ...cfg, parents: spec.parents, perParent: spec.perParent }, byP, rule));
  }
  return rows;
}

// The decision procedure, fixed before the grid was run (2026-10-14):
//   safety     a candidate is admissible iff its miss is ≤ 5% in EVERY binding cell (every E and admitted share), so it is
//              safe whatever library size L4 ends up with;
//   design     E needed (per admitted share) = the smallest E in the grid at which, and at every larger E, every binding
//              cell meets the whole criterion (false kill ≤ 5% and miss ≤ 5%); null if none;
//   choice     among admissible candidates: the smallest E needed at share 1, then at share 0.5 (null = never), then the
//              most robustness cells with miss ≤ 5%, then the most robustness cells meeting both halves, then the lowest
//              worst binding false kill at share 1 and E needed.
// The reference rule (true ICCs) is scored the same way to show what the information allows; it is not a candidate.
export function decide2(grid, { candidates = CANDIDATES2, killMax = 0.05, missMax = 0.05, entries = CROSSED.entries, admits = CROSSED.admit } = {}) {
  const summarize = rule => {
    const rows = grid.filter(r => r.rule === rule), binding = rows.filter(r => r.tier === 'binding'), robust = rows.filter(r => r.tier === 'robustness');
    const unsafe = binding.filter(r => r.miss > missMax);
    const worstMiss = binding.reduce((w, r) => (r.miss > (w?.miss ?? -1) ? r : w), null);
    const eNeeded = Object.fromEntries(admits.map(adm => {
      const ok = E => binding.filter(r => r.admit === adm && r.entries === E).every(r => r.falseKill <= killMax && r.miss <= missMax);
      let need = null;
      for (let k = entries.length - 1; k >= 0 && ok(entries[k]); k--) need = entries[k];
      return [adm, need];
    }));
    const atNeed = binding.filter(r => r.admit === admits[0] && r.entries === (eNeeded[admits[0]] ?? entries[entries.length - 1]));
    return { rule, admissible: unsafe.length === 0, unsafeCells: unsafe.length, bindingCells: binding.length,
      worstMiss: worstMiss && { miss: worstMiss.miss, entries: worstMiss.entries, admit: worstMiss.admit, rhoP: worstMiss.rhoP, rhoE: worstMiss.rhoE },
      eNeeded, robustSafe: robust.filter(r => r.miss <= missMax).length, robustMet: robust.filter(r => r.pass).length, robustCells: robust.length,
      worstFalseKillAtNeed: Math.max(...atNeed.map(r => r.falseKill)) };
  };
  const out = candidates.map(summarize);
  const inf = x => x ?? Infinity;
  const ok = out.filter(o => o.admissible).sort((x, y) => inf(x.eNeeded[admits[0]]) - inf(y.eNeeded[admits[0]]) || inf(x.eNeeded[admits[1]]) - inf(y.eNeeded[admits[1]])
    || y.robustSafe - x.robustSafe || y.robustMet - x.robustMet || x.worstFalseKillAtNeed - y.worstFalseKillAtNeed);
  return { candidates: out, reference: grid.some(r => r.rule === 'ref') ? summarize('ref') : null, chosen: ok[0]?.rule ?? null };
}

// Decisions needed: for a rule, the criterion over parents × entries at the two ends of the plausible range.
export function crossedNeeded({ reps = 4000, seed = 'm3b-n', rules = ['aE2', 'ref'], parents = [48, 96, 144, 192], entries = CROSSED.entries, admits = [1, 0.5],
  rhos = [[0, 0], [0.1, 0.1]], perParent = 6 } = {}) {
  const rows = [];
  for (const [rhoP, rhoE] of rhos) for (const admit of admits) for (const P of parents) for (const E of entries) {
    const byP = {};
    for (const p of [0.01, 0.05]) byP[p] = simulateCrossed({ reps, seed, rules, p, rhoP, rhoE, parents: P, entries: E, perParent, admit });
    for (const rule of rules) rows.push(criterionRow({ rhoP, rhoE, admit, parents: P, entries: E, perParent }, byP, rule));
  }
  return rows;
}

export function renderCrossedMarkdown({ reps, seed, grid, need, decision, generatedBy }) {
  const L = [], f = x => (x == null ? '–' : (100 * x).toFixed(1));
  const rules = Object.keys(RULES2);
  L.push('# M3b reuse acceptance rule under crossed parent × entry clustering', '');
  L.push(`*Generated by \`${generatedBy}\`. $0, no model call, seeded (beds/lib/rng.mjs). Simulation, not evidence about any gate. `
    + `Monte Carlo SE at 5% is ±${(100 * Math.sqrt(0.05 * 0.95 / reps)).toFixed(2)} points (${reps} draws per cell; p = 0 cells use 500). `
    + `false kill = P(not served) at p = 0.01; miss = P(served) at p = 0.05. Model, allocations and estimands: the M3b header in `
    + `experiments/lib/reuse-rule-sim.mjs; research/jit-20261008/DEV-NOTES.md D31.*`, '');
  L.push('## Rules', '');
  for (const k of rules) L.push(`- \`${k}\`: ${RULES2[k].label}`);
  L.push('', '## Decision (`decide2`)', '');
  L.push('| rule | admissible: miss ≤ 5% in every binding cell | binding cells with miss > 5% | worst binding miss (E, admitted share, ρ_P, ρ_E) | E needed, share 1 / 0.5 | robustness: miss ≤ 5% / both halves | worst binding false kill at E needed (share 1) |');
  L.push('|---|---|---|---|---|---|---|');
  for (const c of [...decision.candidates, ...(decision.reference ? [decision.reference] : [])]) {
    const w = c.worstMiss;
    L.push(`| ${c.rule}${c.rule === 'ref' ? ' (reference)' : ''} | ${c.admissible ? 'yes' : 'no'} | ${c.unsafeCells} / ${c.bindingCells} | ${f(w?.miss)}% (${w?.entries}, ${w?.admit}, ${w?.rhoP}, ${w?.rhoE}) | ${c.eNeeded[1] ?? 'none'} / ${c.eNeeded[0.5] ?? 'none'} | ${c.robustSafe} / ${c.robustMet} of ${c.robustCells} | ${f(c.worstFalseKillAtNeed)}% |`);
  }
  L.push('', `Chosen: **${decision.chosen ?? 'none'}**.`, '');
  L.push('## Grid: false kill / miss (%) by rule', '');
  L.push(`Each cell is "false kill / miss". 96 parents × 6 offers. "true ICC" is the generator's (parent, entry). "mean q" is the realized mean wrong probability at p = 0.05 (a check on the generator). "lib bad" is P(θ_lib ≥ 0.05) at p = 0.05.`, '');
  L.push(`| tier | case | E | share | ρ_P | ρ_E | true ICC | admitted | mean q | lib bad | ${rules.join(' | ')} |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|${rules.map(() => '---').join('|')}|`);
  const cfgKey = r => [r.tier, r.name, r.shape, r.alloc, r.entries, r.admit, r.rhoP, r.rhoE].join('|');
  const byCfg = new Map();
  for (const r of grid) { const k = cfgKey(r); if (!byCfg.has(k)) byCfg.set(k, {}); byCfg.get(k)[r.rule] = r; }
  for (const cell of byCfg.values()) {
    const r0 = Object.values(cell)[0];
    L.push(`| ${r0.tier} | ${r0.name} | ${r0.entries} | ${r0.admit} | ${r0.rhoP} | ${r0.shape === 'blind' ? '–' : r0.rhoE} | ${r0.truth.rhoP.toFixed(3)}, ${r0.truth.rhoE.toFixed(3)} | ${r0.meanAdmitted.toFixed(0)} | ${(r0.meanQ).toFixed(4)} | ${f(r0.libBadShare)} | `
      + rules.map(k => (cell[k] ? `${f(cell[k].falseKill)} / ${f(cell[k].miss)}${cell[k].pass ? '' : ' ✗'}` : '–')).join(' | ') + ' |');
  }
  L.push('', '## Perfect gate (p = 0): P(serve) %', '');
  L.push(`| E | share | ${rules.join(' | ')} |`, `|---|---|${rules.map(() => '---').join('|')}|`);
  for (const E of CROSSED.entries) for (const adm of CROSSED.admit) {
    const cells = grid.filter(r => r.tier === 'binding' && r.entries === E && r.admit === adm && r.rhoP === 0.1 && r.rhoE === 0.1);
    L.push(`| ${E} | ${adm} | ${rules.map(k => f(cells.find(c => c.rule === k)?.serve[0])).join(' | ')} |`);
  }
  L.push('', '## Fixed library vs random entries (binding cells, p = 0.05 and 0.01)', '');
  L.push('P(served | θ_lib ≥ 0.05) at p = 0.05 and P(not served | θ_lib ≤ 0.01) at p = 0.01, i.e. the two errors judged against the rate on the library actually drawn. A parent-only rule controls these, not the random-entry miss.', '');
  L.push('| E | share | ρ_P | ρ_E | aE: miss / lib miss | aE2: miss / lib miss | aE: false kill / lib false kill | aE2: false kill / lib false kill |', '|---|---|---|---|---|---|---|---|');
  for (const r of grid.filter(x => x.tier === 'binding' && x.rule === 'aE' && x.rhoE > 0)) {
    const r2 = grid.find(x => x.tier === 'binding' && x.rule === 'aE2' && x.entries === r.entries && x.admit === r.admit && x.rhoP === r.rhoP && x.rhoE === r.rhoE);
    L.push(`| ${r.entries} | ${r.admit} | ${r.rhoP} | ${r.rhoE} | ${f(r.miss)} / ${f(r.libMiss)} | ${f(r2?.miss)} / ${f(r2?.libMiss)} | ${f(r.falseKill)} / ${f(r.libFalseKill)} | ${f(r2?.falseKill)} / ${f(r2?.libFalseKill)} |`);
  }
  if (need?.length) {
    L.push('', '## Parents × entries needed (false kill / miss, %; 6 offers per parent)', '');
    const nr = [...new Set(need.map(r => r.rule))];
    for (const rule of nr) for (const [rhoP, rhoE] of [...new Set(need.map(r => `${r.rhoP},${r.rhoE}`))].map(s => s.split(',').map(Number))) for (const adm of [...new Set(need.map(r => r.admit))]) {
      L.push(`**${rule}${rule === 'ref' ? ' (reference)' : ''}, ρ_P ${rhoP}, ρ_E ${rhoE}, admitted share ${adm}**`, '');
      const Es = [...new Set(need.map(r => r.entries))];
      L.push(`| parents | admitted | ${Es.map(E => `E ${E}`).join(' | ')} |`, `|---|---|${Es.map(() => '---').join('|')}|`);
      for (const P of [...new Set(need.map(r => r.parents))]) {
        const cells = need.filter(r => r.rule === rule && r.rhoP === rhoP && r.rhoE === rhoE && r.admit === adm && r.parents === P);
        L.push(`| ${P} | ${cells[0]?.meanAdmitted.toFixed(0)} | ${Es.map(E => { const c = cells.find(x => x.entries === E); return c ? `${f(c.falseKill)} / ${f(c.miss)}${c.pass ? '' : ' ✗'}` : '–'; }).join(' | ')} |`);
      }
      L.push('');
    }
  }
  return L.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------ CLI
const pct = x => (100 * x).toFixed(1);
export function renderMarkdown({ reps, seed, grid, need, exact, decision }) {
  const L = [];
  L.push(`# M3 reuse acceptance rule: operating characteristics`, '');
  L.push(`*Generated by \`node experiments/lib/reuse-rule-sim.mjs --reps ${reps} --seed ${seed}\`. $0, no model call, seeded `
    + `(beds/lib/rng.mjs). Simulation, not evidence about any gate. Monte Carlo SE at 5% is ±${pct(Math.sqrt(0.05 * 0.95 / reps))} points. `
    + `Floor ρ = ${RHO_REUSE_FLOOR}; Deff uses ρ = max(floor, ρ̂). false kill = P(not served) at p ≤ 0.01; miss = P(served) at p = 0.05.*`, '');
  L.push('## Rules', '');
  for (const [k, v] of Object.entries(RULES)) L.push(`- \`${k}\`: ${v.label}`);
  L.push('', '## Exact check (independent decisions, n = 576), against the simulator', '');
  L.push('| rule | p | exact P(serve) | simulated P(serve) |', '|---|---|---|---|');
  for (const e of exact) L.push(`| ${e.rule} | ${e.p} | ${(100 * e.exact.serve).toFixed(2)}% | ${pct(e.sim.serve)}% |`);
  L.push('', '## Decision (`decide`)', '');
  L.push('| rule | passes the binding cells | binding cells failed | robustness cells met | worst false kill in them |', '|---|---|---|---|---|');
  for (const c of decision.candidates) L.push(`| ${c.rule} | ${c.passesBinding ? 'yes' : 'no'} | ${c.failedBinding.join('; ') || '–'} | ${c.robustnessMet} / ${c.robustnessCells} | ${pct(c.worstRobustFalseKill)}% |`);
  L.push('', `Chosen: **${decision.chosen ?? 'none'}**.`);
  L.push('', '## Grid: P(serve) by true wrong-reuse rate p, and the criterion', '');
  L.push('| scenario | n | ρ | rule | p=0 | p=0.01 | p=0.03 | p=0.05 | false kill | miss | meets | mean decisions read at p=0.01 / 0.05 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of grid) {
    const s = p => pct(r.byP[p].serve);
    L.push(`| ${r.scenario} | ${r.n} | ${r.rho} | ${r.rule} | ${s(0)} | ${s(0.01)} | ${s(0.03)} | ${s(0.05)} | ${pct(r.falseKill)} | ${pct(r.miss)} | ${r.pass ? 'yes' : 'no'} | ${r.byP[0.01].meanDecisions.toFixed(0)} / ${r.byP[0.05].meanDecisions.toFixed(0)} |`);
  }
  L.push('', '## Parents of 6 needed', '');
  L.push('| parents | n | ρ | rule | P(serve) p=0 | p=0.01 | p=0.05 | false kill | miss | meets |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const r of need) L.push(`| ${r.parents} | ${r.n} | ${r.rho} | ${r.rule} | ${pct(r.byP[0].serve)} | ${pct(r.byP[0.01].serve)} | ${pct(r.byP[0.05].serve)} | ${pct(r.falseKill)} | ${pct(r.miss)} | ${r.pass ? 'yes' : 'no'} |`);
  return L.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
  if (process.argv.includes('--crossed')) {
    // M3b: node experiments/lib/reuse-rule-sim.mjs --crossed [--reps 10000] [--seed m3b] [--need-reps 4000] [--json f] [--md f]
    const reps = Number(arg('reps', 10000)), seed = arg('seed', 'm3b'), needReps = Number(arg('need-reps', 4000));
    const generatedBy = `node experiments/lib/reuse-rule-sim.mjs --crossed --reps ${reps} --seed ${seed} --need-reps ${needReps}`;
    const grid = runCrossedGrid({ reps, seed });
    const decision = decide2(grid);
    const need = crossedNeeded({ reps: needReps, rules: [...new Set([decision.chosen ?? 'aE2', 'ref'])] });
    const out = { generatedBy, reps, seed, needReps, design: CROSSED, decision, grid, need };
    const md = renderCrossedMarkdown(out);
    if (arg('json')) writeFileSync(arg('json'), JSON.stringify(out, null, 1) + '\n');
    if (arg('md')) writeFileSync(arg('md'), md);
    if (!arg('json') && !arg('md')) process.stdout.write(md);
    process.exit(0);
  }
  const reps = Number(arg('reps', 20000)), seed = arg('seed', 'm3');
  const exact = [];
  for (const rule of ['v1', 'a', 'aE', 'b', 'c']) for (const p of [0.01, 0.05]) {
    exact.push({ rule, p, exact: exactIndependent(rule, 576, p), sim: simulate({ p, rho: 0, sizes: SCENARIOS['L4-indep'].sizes, reps, seed, rules: [rule] })[rule] });
  }
  const grid = runGrid({ reps, seed });
  const need = nNeeded({ reps: Math.min(reps, 10000) });
  const decision = decide(grid, exact);
  const out = { generatedBy: `node experiments/lib/reuse-rule-sim.mjs --reps ${reps} --seed ${seed}`, reps, seed, rhoFloor: RHO_REUSE_FLOOR,
    planCheck: { n: 181, c: 4, falseKillAt001: 1 - binomCdf(4, 181, 0.01), missAt005: binomCdf(4, 181, 0.05) }, decision, exact, grid, need };
  const md = renderMarkdown(out);
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify(out, null, 1) + '\n');
  if (arg('md')) writeFileSync(arg('md'), md);
  if (!arg('json') && !arg('md')) process.stdout.write(md);
}
