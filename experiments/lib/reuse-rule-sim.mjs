// M3 operating-characteristic simulation (ATTACK-20261014 §3 M3; PROOF-LEDGER K1; LIBRARY-TESTS L4). $0, no model call,
// seeded and deterministic. For each true wrong-reuse rate p and parent intraclass correlation rho it draws admitted
// reuse decisions clustered by parent and reports, per rule, P(serve), P(kill) and P(no decision):
//   false kill = P(not served) at p ≤ 0.01 (a 'no-decision' also leaves reuse off, so it counts);
//   miss       = P(served)     at p ≥ 0.05.
// The M3 criterion: false kill ≤ 5% at p ≤ 0.01 and miss ≤ 5% at p ≥ 0.05, at L4's scale (about 580 decisions).
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
import { wilson, reuseBoundRule, reuseSprt, reuseSamplingPlan, binomCdf, RHO_REUSE_FLOOR } from './stats.mjs';

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
  a: { label: '(a) one-sided Wilson ≤ 0.05, Deff ρ = max(0.1, ρ̂)', run: c => reuseBoundRule(c) },
  b: { label: '(b) SPRT 0.01/0.05, α = β = 0.05, Deff ρ = max(0.1, ρ̂)', run: c => reuseSprt(c) },
  c: { label: '(c) plan n = 181, c = 4 in effective units, Deff ρ = max(0.1, ρ̂)', run: c => reuseSamplingPlan(c) },
  a0: { label: '(a) without Deff', run: c => reuseBoundRule(c, NAIVE) },
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
export function nNeeded({ reps = 10000, seed = 'm3-n', parents = [10, 20, 30, 40, 50, 60, 70, 80, 96, 120], m = 6, rhos = [0, 0.1, 0.2], rules = ['a', 'b', 'c'] } = {}) {
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

// ------------------------------------------------------------------------------------------------ CLI
const pct = x => (100 * x).toFixed(1);
export function renderMarkdown({ reps, seed, grid, need, exact }) {
  const L = [];
  L.push(`# M3 reuse acceptance rule: operating characteristics`, '');
  L.push(`*Generated by \`node experiments/lib/reuse-rule-sim.mjs --reps ${reps} --seed ${seed}\`. $0, no model call, seeded `
    + `(beds/lib/rng.mjs). Simulation, not evidence about any gate. Monte Carlo SE at 5% is ±${pct(Math.sqrt(0.05 * 0.95 / reps))} points. `
    + `Floor ρ = ${RHO_REUSE_FLOOR}; Deff uses ρ = max(floor, ρ̂). false kill = P(not served) at p ≤ 0.01; miss = P(served) at p = 0.05.*`, '');
  L.push('## Rules', '');
  for (const [k, v] of Object.entries(RULES)) L.push(`- \`${k}\`: ${v.label}`);
  L.push('', '## Exact check (independent decisions, n = 576), against the simulator', '');
  L.push('| rule | p | exact P(serve) | simulated P(serve) |', '|---|---|---|---|');
  for (const e of exact) L.push(`| ${e.rule} | ${e.p} | ${pct(e.exact.serve)}% | ${pct(e.sim.serve)}% |`);
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
  const reps = Number(arg('reps', 20000)), seed = arg('seed', 'm3');
  const exact = [];
  for (const rule of ['v1', 'a', 'b', 'c']) for (const p of [0.01, 0.05]) {
    exact.push({ rule, p, exact: exactIndependent(rule, 576, p), sim: simulate({ p, rho: 0, sizes: SCENARIOS['L4-indep'].sizes, reps, seed, rules: [rule] })[rule] });
  }
  const grid = runGrid({ reps, seed });
  const need = nNeeded({ reps: Math.min(reps, 10000) });
  const out = { generatedBy: `node experiments/lib/reuse-rule-sim.mjs --reps ${reps} --seed ${seed}`, reps, seed, rhoFloor: RHO_REUSE_FLOOR,
    planCheck: { n: 181, c: 4, falseKillAt001: 1 - binomCdf(4, 181, 0.01), missAt005: binomCdf(4, 181, 0.05) }, exact, grid, need };
  const md = renderMarkdown(out);
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify(out, null, 1) + '\n');
  if (arg('md')) writeFileSync(arg('md'), md);
  if (!arg('json') && !arg('md')) process.stdout.write(md);
}
