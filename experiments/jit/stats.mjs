// Analysis instrument for JIT stream comparisons (BLOCKER-SYNTHESIS §2.1 row 1; PREREG-stream §4–§6). $0, pure functions,
// no model calls. report.mjs prints a single stream with it; `decide` reads K streams and applies the decision rule.
//
//   node experiments/jit/stats.mjs power [--json]                         the power table (K × δ × ρ)
//   node experiments/jit/stats.mjs decide <armX> <armY> <runDir>...        the decision rule over K stream run directories
//
// Units. A "point" is one percentage point of pass rate. report.mjs:10 (NOISE_SUCCESSES) counts tasks per stream; PREREG
// §4 and the owner's floor (HANDOFF §0; ROADMAP:889) count points. Every output here prints both and names the rule that
// decided: the task rule is shown for continuity only and never decides.
//
// Decision rule (DECISION_RULE below; PREREG-stream §4). For arms X and Y in one family, over K streams (one compiled-
// solver lineage per JIT arm per stream, the same task order for every arm within a stream):
//   V  validity   neither arm is "invalid: env faults" in any stream (envFaultCheck), and the paired task sets match;
//   K  lineages   K >= 2 (owner rule: no K=1 claims);
//   F  floor      the pooled gap is >= 3 points, and in every stream the gap has the pooled sign and is >= 3 points;
//   T  test       the exact two-sided McNemar test on the pooled discordant pairs gives p < 0.05;
//   C  CI         the 95% lineage-clustered CI of the pooled paired difference excludes 0.
// An effect is reported only if V, K, F, T and C all hold; otherwise "directional, no decision" (or "invalid: env
// faults" when V fails on faults). "In both streams" is read as F per stream plus T and C pooled: a per-stream test
// cannot see between-lineage variance (one lineage per stream), and requiring a test in every stream would make power
// fall as K grows.
//
// Lineage-clustered CI. Cluster = the compiled-solver lineage for a JIT arm (one arm's stream: v1 and every recompile
// descend from the same state, so they are one lineage; `lineageOf`), and the task for an agent or static arm (each run
// is independent). A pair X–Y is clustered by the JIT side's lineage (both sides', if both are JIT; they share the
// stream). The CI is the wider of
//   (a) a two-stage percentile bootstrap: resample clusters, then tasks within each drawn cluster, keeping pairs;
//   (b) the i.i.d. paired-task bootstrap widened about the point estimate by sqrt(Deff), Deff = 1 + (m − 1)·ρ (Kish),
//       with m the mean tasks per cluster and ρ = RHO_PREREG, an assumption (ρ has never been measured; DEV-NOTES D12).
// (b) applies only when a JIT arm is in the pair. (a) cannot see between-lineage variance with fewer than about 3
// clusters per arm, so (b) is what binds at K = 2 until ρ is measured (synthesis rows 16, 31) and amended.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wilson } from '../lib/stats.mjs';
import { rng } from '../../beds/lib/rng.mjs';

export { wilson };
export const FLOOR_POINTS = 3;          // owner floor: gaps under 3 points are noise (HANDOFF §0; ROADMAP:889)
export const ALPHA = 0.05;
export const RHO_PREREG = 0.1;          // assumed within-lineage ICC of the paired difference (dossier 1 §B9.1); unmeasured
export const ENV_FAULT_LIMIT = 0.25;    // PREREG §6: an arm whose env-impaired tasks exceed 25% of planned tasks is invalid
// The environment-fault codes stream.mjs retries once and then records in faults.jsonl (experiments/lib/runner.mjs
// ENV_FAULTS; the test pins this copy to it). A faults.jsonl line is written only for these.
export const ENV_FAULT_CODES = Object.freeze(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE', 'EXECUTOR_LAUNCH', 'EXECUTOR_PROTOCOL']);

export const DECISION_RULE = 'Effect reported only if: no arm invalid by the 25% env-fault rule; K >= 2 streams; pooled gap >= 3 points and every '
  + 'stream\'s gap >= 3 points in the same direction; exact two-sided McNemar p < 0.05 on pooled pairs; and the 95% lineage-clustered CI '
  + `(wider of two-stage cluster bootstrap and Deff-widened task bootstrap, rho ${RHO_PREREG}) excludes 0. Otherwise "directional, no decision".`;

// ------------------------------------------------------------------------------------------------ exact tests
const logChoose = (n, k) => { if (k < 0 || k > n) return -Infinity; let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; };
const binomPmf = (k, n, p) => Math.exp(logChoose(n, k) + (k ? k * Math.log(p) : 0) + (n - k ? (n - k) * Math.log(1 - p) : 0));

// Exact two-sided binomial test at p = 0.5 (doubling the smaller tail, capped at 1).
export function binomTwoSided(k, n) {
  if (!n) return 1;
  let lo = 0, hi = 0;
  for (let i = 0; i <= k; i++) lo += binomPmf(i, n, 0.5);
  for (let i = k; i <= n; i++) hi += binomPmf(i, n, 0.5);
  return Math.min(1, 2 * Math.min(lo, hi));
}

// Exact McNemar: b = pairs where only X passed, c = pairs where only Y passed; binomial on the b + c discordant pairs.
export function mcnemarExact(b, c) { return { xOnly: b, yOnly: c, discordant: b + c, p: binomTwoSided(Math.min(b, c), b + c) }; }

// One-sided Fisher (hypergeometric upper tail): P(X >= a) for a joint count a, margins r1 (row) and c1 (column), total N.
export function fisherUpper(a, r1, c1, N) {
  let p = 0;
  for (let x = a; x <= Math.min(r1, c1); x++) p += Math.exp(logChoose(r1, x) + logChoose(N - r1, c1 - x) - logChoose(N, c1));
  return Math.min(1, p);
}

// ------------------------------------------------------------------------------------------------ normal helpers
export function normCdf(x) {
  // Abramowitz–Stegun 7.1.26 on erf; |error| < 1.5e-7, enough for a power table.
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
export function normQuantile(p) { let lo = -10, hi = 10; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (normCdf(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }

// ------------------------------------------------------------------------------------------------ power table
export const designEffect = (m, rho) => 1 + (m - 1) * rho;

// Power of the pooled paired comparison for K lineages × m tasks at a true gap δ (a proportion), within-lineage ICC ρ.
// Formula (stated in PREREG §4):
//   pX = pRef + δ/2, pY = pRef − δ/2; discordance ψ = pX(1 − pY) + pY(1 − pX) (arms independent given the task: a
//   conservative assumption; positively correlated arms have a smaller ψ and more power);
//   Var(d_i) = ψ − δ²; Deff = 1 + (m − 1)ρ; SE = sqrt(Var(d_i) · Deff / (K·m));
//   power(T) = Φ(δ/SE − z_{1−α/2}) + Φ(−δ/SE − z_{1−α/2})  (normal approximation to the McNemar / paired test; exact
//   McNemar at these n is a little more conservative);
//   P(F per stream) = Φ((δ − floor)/SE_s)^K with SE_s = sqrt(Var(d_i) · Deff / m) (streams independent);
//   power(rule) ≈ power(T) · P(F per stream), a lower bound because the two events are positively correlated. C is taken
//   to coincide with T (both use the Deff-scaled SE at K < 3).
// K = 1 is never a decision (owner rule); its numbers are shown for scale only.
export function pairedPower({ K, m = 24, delta, rho, pRef = 0.8, alpha = ALPHA, floor = FLOOR_POINTS / 100 }) {
  const pX = Math.min(1, pRef + delta / 2), pY = Math.max(0, pRef - delta / 2);
  const psi = pX * (1 - pY) + pY * (1 - pX), v = Math.max(1e-12, psi - delta * delta), deff = designEffect(m, rho);
  const se = Math.sqrt(v * deff / (K * m)), seS = Math.sqrt(v * deff / m), z = normQuantile(1 - alpha / 2);
  const test = normCdf(delta / se - z) + normCdf(-delta / se - z);
  const floorEvery = normCdf((delta - floor) / seS) ** K;
  return { K, m, delta, rho, deff, effectiveN: (K * m) / deff, psi, se, test, floorEvery, rule: K < 2 ? 0 : test * floorEvery };
}

// Smallest δ with rule power >= target (bisection on δ in (0, 0.6]); null if none.
export function minimumDetectable({ K, m = 24, rho, target = 0.8, pRef = 0.8 }) {
  if (K < 2) return null;
  const f = d => pairedPower({ K, m, delta: d, rho, pRef }).rule;
  if (f(0.6) < target) return null;
  let lo = 0.0, hi = 0.6;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) >= target) hi = mid; else lo = mid; }
  return hi;
}

export function powerTable({ Ks = [1, 2, 3, 4], deltas = [0.03, 0.05, 0.10], rhos = [0, 0.1, 0.3], m = 24, pRef = 0.8 } = {}) {
  const cells = [];
  for (const rho of rhos) for (const K of Ks) for (const delta of deltas) cells.push(pairedPower({ K, m, delta, rho, pRef }));
  const mde = [];
  for (const rho of rhos) for (const K of Ks) mde.push({ K, rho, mde80: minimumDetectable({ K, m, rho, pRef }) });
  return { m, pRef, alpha: ALPHA, floor: FLOOR_POINTS, cells, mde };
}

export function renderPowerTable(t = powerTable()) {
  const pc = x => `${(100 * x).toFixed(0)}%`;
  const deltas = [...new Set(t.cells.map(c => c.delta))], Ks = [...new Set(t.cells.map(c => c.K))], rhos = [...new Set(t.cells.map(c => c.rho))];
  const L = [`m = ${t.m} tasks per lineage (stream), pRef = ${t.pRef}, two-sided α = ${t.alpha}, floor ${t.floor} points. Cell: power of the full rule (T and F in every stream) [power of the pooled test alone]. K = 1 is never a decision.`, '',
    `| ρ | Deff | K | ${deltas.map(d => `δ = ${Math.round(100 * d)} pts`).join(' | ')} | effective n | MDE at 80% (rule) |`, `|---|---|---|${deltas.map(() => '---').join('|')}|---|---|`];
  for (const rho of rhos) for (const K of Ks) {
    const row = deltas.map(d => t.cells.find(c => c.rho === rho && c.K === K && c.delta === d));
    const mde = t.mde.find(x => x.rho === rho && x.K === K).mde80;
    L.push(`| ${rho} | ${row[0].deff.toFixed(1)} | ${K} | ${row.map(c => (K < 2 ? `– [${pc(c.test)}]` : `${pc(c.rule)} [${pc(c.test)}]`)).join(' | ')} | ${row[0].effectiveN.toFixed(1)} | ${mde == null ? (K < 2 ? 'never (K=1)' : '> 60 pts') : `${(100 * mde).toFixed(0)} pts`} |`);
  }
  return L.join('\n');
}

// ------------------------------------------------------------------------------------------------ pairs and CIs
// The lineage of a JIT arm's row: one arm's stream (all versions of one stream descend from one compile state).
export const lineageOf = (stream, armSpec) => `${stream}::${armSpec}`;
const isJit = spec => /^jit:/.test(spec ?? '');

// Pair two arms' rows by taskKey within one stream. Each pair: { stream, cluster, task, x, y } with x, y in {0, 1}.
export function pairRows(rowsX, rowsY, { stream = 'A', armX = 'X', armY = 'Y', kindX = isJit(armX) ? 'jit' : 'agent', kindY = isJit(armY) ? 'jit' : 'agent' } = {}) {
  const ys = new Map(rowsY.map(r => [r.taskKey ?? r.idx, r]));
  const out = [];
  for (const r of rowsX) {
    const k = r.taskKey ?? r.idx, o = ys.get(k);
    if (!o) continue;
    const jitSides = [kindX === 'jit' ? lineageOf(stream, armX) : null, kindY === 'jit' ? lineageOf(stream, armY) : null].filter(Boolean);
    out.push({ stream, task: `${stream}::${k}`, cluster: jitSides.length ? jitSides.join('|') : `${stream}::${k}`, jit: jitSides.length > 0, x: r.pass ? 1 : 0, y: o.pass ? 1 : 0 });
  }
  return out;
}

const meanDiff = ps => (ps.length ? ps.reduce((s, p) => s + p.x - p.y, 0) / ps.length : NaN);
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

// Two-stage cluster bootstrap and the i.i.d. task bootstrap of the paired difference (proportions).
export function bootstrapCIs(pairs, { iterations = 10000, seed = 'stats', level = 0.95 } = {}) {
  const byCluster = new Map();
  for (const p of pairs) { if (!byCluster.has(p.cluster)) byCluster.set(p.cluster, []); byCluster.get(p.cluster).push(p); }
  const clusters = [...byCluster.values()], r = rng(seed, 'cluster'), r2 = rng(seed, 'iid');
  const a = (1 - level) / 2, cl = [], iid = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0, n = 0;
    for (let j = 0; j < clusters.length; j++) { const c = clusters[r.int(0, clusters.length - 1)]; for (let t = 0; t < c.length; t++) { const p = c[r.int(0, c.length - 1)]; s += p.x - p.y; n++; } }
    cl.push(s / n);
    let s2 = 0;
    for (let t = 0; t < pairs.length; t++) { const p = pairs[r2.int(0, pairs.length - 1)]; s2 += p.x - p.y; }
    iid.push(s2 / pairs.length);
  }
  cl.sort((x, y) => x - y); iid.sort((x, y) => x - y);
  return { clusters: clusters.length, meanClusterSize: pairs.length / Math.max(1, clusters.length), cluster: { lo: quantile(cl, a), hi: quantile(cl, 1 - a) }, iid: { lo: quantile(iid, a), hi: quantile(iid, 1 - a) } };
}

// The paired comparison of one set of pairs (one stream, or K streams pooled), in both units.
export function pairedComparison(pairs, { rho = RHO_PREREG, iterations = 10000, seed = 'stats', floorPoints = FLOOR_POINTS, taskRule = 3 } = {}) {
  const n = pairs.length, b = pairs.filter(p => p.x && !p.y).length, c = pairs.filter(p => !p.x && p.y).length;
  const d = meanDiff(pairs), xs = pairs.reduce((s, p) => s + p.x, 0), ys = pairs.reduce((s, p) => s + p.y, 0);
  const streams = [...new Set(pairs.map(p => p.stream))];
  const out = { n, streams: streams.length, xPass: xs, yPass: ys, gapTasks: xs - ys, gapPoints: n ? 100 * d : null, gapTasksPerStream: streams.length ? (xs - ys) / streams.length : null, mcnemar: mcnemarExact(b, c) };
  if (!n) return { ...out, ci: null };
  const bs = bootstrapCIs(pairs, { iterations, seed });
  const jit = pairs.some(p => p.jit), deff = jit ? designEffect(bs.meanClusterSize, rho) : 1, w = Math.sqrt(deff);
  const widened = { lo: d - (d - bs.iid.lo) * w, hi: d + (bs.iid.hi - d) * w };
  const ci = { lo: Math.min(bs.cluster.lo, widened.lo), hi: Math.max(bs.cluster.hi, widened.hi) };
  return { ...out, ci: { ...ci, points: { lo: 100 * ci.lo, hi: 100 * ci.hi }, clusterBootstrap: bs.cluster, iidBootstrap: bs.iid, deffWidened: widened, deff, rho: jit ? rho : 0, clusters: bs.clusters, excludesZero: ci.lo > 0 || ci.hi < 0 },
    floorPoints: Math.abs(100 * d) >= floorPoints, taskRule: Math.abs(out.gapTasksPerStream) >= taskRule };
}

// The decision rule over K streams. pairs carry their stream; invalid lists "<arm>@<stream>" entries that failed the
// env-fault rule (envFaultCheck); mismatched lists task-set mismatches.
export function decide(pairs, { invalid = [], mismatched = [], ...opts } = {}) {
  const pooled = pairedComparison(pairs, opts), floor = opts.floorPoints ?? FLOOR_POINTS, alpha = opts.alpha ?? ALPHA;
  const streams = [...new Set(pairs.map(p => p.stream))].sort();
  const per = streams.map(s => { const ps = pairs.filter(p => p.stream === s), d = meanDiff(ps); return { stream: s, n: ps.length, gapTasks: ps.reduce((a, p) => a + p.x - p.y, 0), gapPoints: 100 * d, mcnemarP: mcnemarExact(ps.filter(p => p.x && !p.y).length, ps.filter(p => !p.x && p.y).length).p }; });
  const sign = Math.sign(pooled.gapPoints ?? 0);
  const checks = {
    V: !invalid.length && !mismatched.length,
    K: streams.length >= 2,
    F: pooled.n > 0 && Math.abs(pooled.gapPoints) >= floor && per.every(s => Math.sign(s.gapPoints) === sign && Math.abs(s.gapPoints) >= floor),
    T: pooled.mcnemar.p < alpha,
    C: !!pooled.ci?.excludesZero,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const verdict = invalid.length ? 'invalid: env faults' : failed.length ? 'directional, no decision' : sign > 0 ? 'effect: X better' : 'effect: Y better';
  return { rule: DECISION_RULE, verdict, checks, failed, invalid, mismatched, K: streams.length, perStream: per, pooled,
    units: `gap ${pooled.gapTasks >= 0 ? '+' : ''}${pooled.gapTasks} tasks over ${pooled.n} paired tasks (${pooled.gapPoints?.toFixed(1)} points); `
      + `decided by the point floor + McNemar + clustered CI (stats.mjs); the report.mjs task rule (|gap| >= 3 tasks per stream) is shown, not applied` };
}

// ------------------------------------------------------------------------------------------------ env-fault rule
// PREREG §6, made precise:
// - Planned tasks N: the stream's task list (idx 0..N−1); the denominator.
// - Fault event: one faults.jsonl line, i.e. an ENV_FAULT_CODES fault that survived its one in-place retry (stream.mjs
//   `retrying`). `fault-retry` events (recovered on the retry) are counted as transient and never count against the arm.
// - Env-impaired task: (a) unresolved: a planned idx with no result row at the end of the run (after every resume)
//   that has a fault line, or, for a JIT arm, any missing idx at or after a missing idx with a fault line (the stream
//   stops at the fault, so later tasks never ran); (b) degraded: a row whose shadow or adjudicator faulted
//   ('shadow-fault', 'adjudicator-fault'), so the verification the config schedules did not happen.
// - A fault that a resume later resolved is not an impaired task: faults are never outcomes and the resumed task runs
//   from the persisted state. Its count is still reported (faultEvents, stressed), because resumed tasks ran later.
// - Rule: impaired / N > 25% => "invalid: env faults" for that arm in that stream. Missing rows without a fault are
//   reported as missingOther (they break pairing, which the decision rule checks separately).
export function envFaultCheck({ rows = [], events = [], faults = [], planned, kind } = {}) {
  const idxs = Array.isArray(planned) ? planned : Array.from({ length: planned ?? (rows.length ? Math.max(...rows.map(r => r.idx)) + 1 : 0) }, (_, i) => i);
  const N = idxs.length, have = new Set(rows.map(r => r.idx)), faultAt = new Set(faults.map(f => f.idx));
  const missing = idxs.filter(i => !have.has(i)).sort((a, b) => a - b);
  const unresolved = new Set(missing.filter(i => faultAt.has(i)));
  if ((kind ?? (isJit(rows[0]?.arm) ? 'jit' : null)) === 'jit') { const first = missing.find(i => faultAt.has(i)); if (first != null) for (const i of missing) if (i >= first) unresolved.add(i); }
  const has = (r, k) => (r.events ?? []).some(e => e.kind === k);
  const degraded = rows.filter(r => has(r, 'shadow-fault') || has(r, 'adjudicator-fault')).map(r => r.idx);
  const impaired = new Set([...unresolved, ...degraded]);
  const code = f => f.error?.code ?? f.builderError?.code ?? (Object.keys(f.metaErrors ?? {}).join(',') || 'unknown');
  const byCode = {};
  for (const f of faults) byCode[code(f)] = (byCode[code(f)] ?? 0) + 1;
  const transient = rows.reduce((s, r) => s + (r.events ?? []).filter(e => e.kind === 'fault-retry').length, 0) + events.filter(e => e.kind === 'fault-retry').length;
  const rate = N ? impaired.size / N : 0;
  return { planned: N, faultEvents: faults.length, faultEventRate: N ? faults.length / N : 0, transientRetries: transient, byCode,
    unresolved: [...unresolved].sort((a, b) => a - b), degraded, impaired: impaired.size, impairedRate: rate, missingOther: missing.filter(i => !unresolved.has(i)),
    invalid: rate > ENV_FAULT_LIMIT, stressed: N ? faults.length / N > ENV_FAULT_LIMIT : false, verdict: rate > ENV_FAULT_LIMIT ? 'invalid: env faults' : 'valid' };
}

// ------------------------------------------------------------------------------------------------ IPW miss estimates
// System-view (oracle-free) miss estimate from verified compiled deliveries with logged propensities. items:
// [{ verified, propensity, wrong }] over compiled deliveries (wrong is read only where verified).
// - Point: Horvitz–Thompson, M̂ = Σ_verified wrong/π, rate = M̂ / deliveries (unbiased whenever every π > 0 is fixed
//   before its coin flip, adaptive propensities included).
// - CI (finite = true, the default: the estimand is this stream's realised miss rate). Per propensity stratum h with N_h
//   deliveries, n_h verified and w_h wrong among them: given n_h, the verified items are a simple random sample of the
//   stratum, so the stratum's miss total W_h has the exact hypergeometric interval {W : P(X >= w_h | W) > α/2 and
//   P(X <= w_h | W) > α/2}, X ~ Hypergeometric(N_h, W, n_h). An unverified stratum is [0, N_h]; a fully verified one is
//   known exactly. Stratum bounds are summed (conservative with more than one partly verified stratum).
//   finite = false treats each stratum as a sample from a superpopulation (N_h · Wilson(w_h, n_h)).
export function hypergeomTotalCI(w, n, N, alpha = ALPHA) {
  if (n >= N) return { lo: w, hi: w };
  if (!n) return { lo: 0, hi: N };
  const pmf = (x, W) => Math.exp(logChoose(W, x) + logChoose(N - W, n - x) - logChoose(N, n));
  const ok = [];
  for (let W = w; W <= w + (N - n); W++) {
    let le = 0, ge = 0;
    for (let x = Math.max(0, n - (N - W)); x <= Math.min(n, W); x++) { const p = pmf(x, W); if (x <= w) le += p; if (x >= w) ge += p; }
    if (le > alpha / 2 && ge > alpha / 2) ok.push(W);
  }
  return ok.length ? { lo: ok[0], hi: ok.at(-1) } : { lo: w, hi: w + (N - n) };
}

export function ipwMissEstimate(items, { z = 1.96, finite = true } = {}) {
  const D = items.length;
  if (!D) return { deliveries: 0, rate: null, lo: null, hi: null, verified: 0 };
  let ht = 0, verified = 0;
  const strata = new Map();
  for (const it of items) {
    const k = Number(it.propensity).toFixed(6);
    if (!strata.has(k)) strata.set(k, { n: 0, v: 0, w: 0 });
    const s = strata.get(k); s.n++;
    if (it.verified) { verified++; s.v++; if (it.wrong) { s.w++; ht += 1 / it.propensity; } }
  }
  let lo = 0, hi = 0;
  for (const s of strata.values()) {
    if (finite) { const ci = hypergeomTotalCI(s.w, s.v, s.n); lo += ci.lo; hi += ci.hi; continue; }
    if (!s.v) { hi += s.n; continue; }
    const ci = wilson(s.w, s.v, z); lo += s.n * ci.lo; hi += s.n * ci.hi;
  }
  return { deliveries: D, verified, misses: ht, rate: ht / D, lo: lo / D, hi: hi / D };
}

// ------------------------------------------------------------------------------------------------ CLI
async function cliDecide(armX, armY, dirs) {
  const { loadRun } = await import('./report.mjs');
  const pairs = [], invalid = [], mismatched = [];
  for (const [i, dir] of dirs.entries()) {
    const stream = String.fromCharCode(65 + i), arms = loadRun(dir), A = arms.find(a => a.meta.spec === armX), B = arms.find(a => a.meta.spec === armY);
    if (!A || !B) throw new Error(`${dir}: missing arm ${!A ? armX : armY}`);
    const planned = Math.max(0, ...arms.flatMap(a => a.rows.map(r => r.idx + 1)));
    for (const [arm, spec] of [[A, armX], [B, armY]]) if (envFaultCheck({ ...arm, planned, kind: arm.meta.kind }).invalid) invalid.push(`${spec}@${stream}`);
    if (A.rows.length !== B.rows.length) mismatched.push(`${stream}: ${A.rows.length} vs ${B.rows.length} rows`);
    pairs.push(...pairRows(A.rows, B.rows, { stream, armX, armY, kindX: A.meta.kind, kindY: B.meta.kind }));
  }
  return decide(pairs, { invalid, mismatched });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), json = rest.includes('--json'), args = rest.filter(a => a !== '--json');
  if (cmd === 'power') { const t = powerTable(); console.log(json ? JSON.stringify(t, null, 1) : renderPowerTable(t)); }
  else if (cmd === 'decide' && args.length >= 3 && args.slice(2).every(d => existsSync(d))) {
    const r = await cliDecide(args[0], args[1], args.slice(2).map(d => path.resolve(d)));
    if (json) console.log(JSON.stringify(r, null, 1));
    else console.log(`${r.verdict}\n${r.units}\nchecks ${JSON.stringify(r.checks)}; McNemar p = ${r.pooled.mcnemar.p.toFixed(4)}; 95% clustered CI ${r.pooled.ci ? `${r.pooled.ci.points.lo.toFixed(1)} to ${r.pooled.ci.points.hi.toFixed(1)} points` : '–'}\nrule: ${r.rule}`);
  } else { console.error('usage: stats.mjs power [--json] | stats.mjs decide <armX> <armY> <runDir>... [--json]'); process.exit(2); }
}
