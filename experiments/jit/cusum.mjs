#!/usr/bin/env node
// M9: a risk-adjusted CUSUM instead of `recompileOnDeopts: 2` (research/jit-20261008/ATTACK-20261014.md §3 M9;
// PROOF-LEDGER K15). $0: no model call of any kind. Reads only the committed stream exports under
// research/jit-20261008/runs/ (results.jsonl, arm.json), the committed N-version probe
// (research/jit-20261008/nversion-records-dev.json), and regenerates the dev tasks with the bed generators
// (beds/records, beds/kinetics; dev split only, hashes checked against the rows) so that profile.mjs can score novelty.
//
// DESIGN (fixed 2026-10-14 before any CUSUM statistic was computed on the committed rows; the per-row outcomes had been
// read before, in DEV-NOTES D25 and a row listing, so this is a development analysis, not a preregistered one).
//
// Data. The 260 rows of the two dev streams: jit-dev-records-1 (7 arms x 24 = 168) and jit-dev-kinetics-1 (agents 24 + 24,
// JIT H->H 12, O->H 19, S->H 13 = 92). jit-r0-records is not in the 260 (another engine and seed range) and is not used.
//
// Ground truth, scoring only. The drift index D of a stream is the first idx whose difficulty differs from idx 0's
// (records d3 -> d4 and kinetics d4 -> d5, both at idx 16). It is never a model input. The one design-time use is the
// 'phase1' sensitivity variant, which fits and calibrates on rows with idx < D (flagged as such in every output).
//
// Monitored outcome (two views).
//   system (deployable; the decision view): on a JIT row where compiled code ran (compiledStatus set), y = 1 if the run
//            deopted (compiledStatus != 'ok') or a shadow disagreed with it (a 'disagree' event, which includes every
//            adjudicated regression). This is what a deployed engine observes. Static arms have neither guards nor
//            shadows, so neither rule can fire there; they are reported, not monitored, in this view.
//   oracle   (the experimenter's ceiling): y = 1 if the run deopted, a shadow disagreed, or the compiled answer was
//            delivered and failed the bed oracle (a silent miss); on rows with no compiled run (agent arms, warmup rows)
//            y = 1 if the delivered answer failed. Defined on all 260 rows, which is the ATTACK's pooled fit.
//
// Risk inputs (deployment-available only; never the difficulty label).
//   novelty  profile.mjs checkProfile score of the task against the arm's 'frozen' profile (learnProfile of the arm's
//            first `warmup` tasks, PARAMS v1, all features), capped at `noveltyCap` (3). The tasks are the same for every
//            arm of a stream, so the score is too. Sensitivity 'version': eval-profiles.mjs's version policy for JIT rows.
//   history  the number of deopts among the arm's previous `histWindow` (5) rows.
//   near-band P16 decisions: not journaled in these streams (no P16 card ran; the dev solvers are free-form code), so
//            the input is absent. The journals hold model calls per compiled run, which is not a near-band count; it is
//            not used.
//   Model: logistic regression with an intercept, Newton-Raphson, ridge 1e-6 on the slopes (numerical only).
//   Fits: system view on the compiled-attempt JIT rows of both streams pooled (98 rows); oracle view on all 260 rows.
//
// The chart (Steiner, Cook, Farewell and Treasure 2000). For a monitored row t with predicted risk p_t and outcome y_t,
// W_t = y_t log R_A - log(1 - p_t + R_A p_t), S_t = max(0, S_{t-1} + W_t); alarm when S_t >= h; S resets to 0 after an
// alarm and when the as-run version changes (a new workflow gets a new chart). R_A = 2 (a doubling of the odds).
// h: the smallest h whose in-control average run length ARL0 >= 500 monitored tasks, by Monte Carlo under the fitted
// model: each step draws a novelty value from the monitored rows (the case mix), history counts simulated deopts in the
// last 5 steps, y ~ Bernoulli(p), and an event is a deopt with the monitored rows' deopt share among events ('feedback';
// 'iid' resamples (novelty, history) pairs instead). Common random numbers, so ARL(h) is monotone in h.
//
// The current rule (stream.mjs DEFAULT_JIT recompileOnDeopts 2): count deopts since the last compile attempt; alarm at the
// row where the count reaches 2 (the recompile runs before the next task). Replayed from the rows and checked against the
// rows' own stateAfter.deoptsSinceCompile. The regression trigger (an adjudicated regression recompiles at once) is kept by
// both regimes and is reported beside them, not credited to either.
//
// Metrics per monitored stream (as-run order): false alarms = alarms at idx < D; detection delay = (first alarm at
// idx >= D) - D, censored when the stream ends first; the version in force at D and the as-run recompile after D are
// reported (the as-run stream after an as-run recompile is not what a CUSUM regime would have seen).
// Rule (ATTACK §3 M9): adopt if, in every stream that reaches D, detection comes <= 4 tasks after D, and every stream has
// <= 1 false alarm; otherwise keep the count. A stream that reaches D but ends before an alarm is not a detection.
//
// Supplementary, frozen versions: the N-version probe ran four records solvers (Haiku v1, Opus v1, Opus v2, Sonnet v1) on
// all 24 tasks with no recompile and no shadow. Each is a counterfactual stream of one fixed workflow through the drift,
// scored with the primary models (system: deopt only, as no shadows ran; oracle: deopt or wrong). Both rules restart their
// statistic after an alarm, as if a recompile had kept the same code. Reported beside the decision, not used for it.
//
// Sensitivity variants (reported, never used for the decision): no risk adjustment (intercept only), novelty only,
// history only, version-profile novelty, R_A 3 and 5, no reset at version change, iid calibration, leave-one-family-out
// fit, phase-I fit (label-assisted window).
//
// usage: node experiments/jit/cusum.mjs [--runs <dir>] [--nversion <file>] [--out <dir>] [--reps 10000] [--seed 9] [--json]
//   default --runs research/jit-20261008/runs, --out research/jit-20261008/analysis/cusum/out
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { learnProfile, checkProfile } from './profile.mjs';
import { evaluateArm, parseTaskKey } from './eval-profiles.mjs';
import { loadArms } from './durability.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_RUNS = path.join(REPO, 'research/jit-20261008/runs');
export const DEFAULT_NVERSION = path.join(REPO, 'research/jit-20261008/nversion-records-dev.json');
export const DEFAULT_OUT = path.join(REPO, 'research/jit-20261008/analysis/cusum/out');
export const STREAMS = Object.freeze([
  { experiment: 'jit-dev-records-1', family: 'records' },
  { experiment: 'jit-dev-kinetics-1', family: 'kinetics' },
]);
export const DESIGN = Object.freeze({
  warmup: 3,              // stream.mjs DEFAULT_JIT.warmup
  countK: 2,              // stream.mjs DEFAULT_JIT.recompileOnDeopts
  histWindow: 5,
  noveltyCap: 3,
  ra: 2,
  arl0: 500,
  features: Object.freeze(['novelty', 'history']),
  noveltyPolicy: 'frozen',
  fit: 'pooled',
  reset: 'version',
  calib: 'feedback',
  ridge: 1e-6,
  maxDelay: 4,
  maxFalse: 1,
});
export const SIM = Object.freeze({ reps: 10000, seed: 9, stepsPerTarget: 10 });

const r4 = x => (x == null || !Number.isFinite(x) ? x : Math.round(x * 1e4) / 1e4);
const r3 = x => (x == null || !Number.isFinite(x) ? x : Math.round(x * 1e3) / 1e3);

// ------------------------------------------------------------------------------------------------ random numbers
// mulberry32: a small seeded PRNG (deterministic; Math.random is never used).
export function mulberry32(seed) {
  let a = (typeof seed === 'string' ? [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703) : seed) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------ logistic regression
export const sigmoid = z => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export const predict = (beta, x) => sigmoid(beta.reduce((s, b, i) => s + b * x[i], 0));

// Solve A x = b and invert A (small dense, Gauss-Jordan with partial pivoting). Returns { x, inv } or null if singular.
export function solveSym(A, b) {
  const k = A.length, M = A.map((row, i) => [...row, b[i], ...A.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let j = 0; j < M[c].length; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < M[r].length; j++) M[r][j] -= f * M[c][j]; }
  }
  return { x: M.map(row => row[k]), inv: M.map(row => row.slice(k + 1)) };
}

// X: rows with a leading 1 (intercept), y: 0/1. Ridge applies to the slopes only. Returns beta, standard errors (from the
// inverse of the penalised information), log-likelihood, iterations, converged.
export function logisticFit(X, y, { ridge = DESIGN.ridge, maxIter = 200, tol = 1e-10 } = {}) {
  const n = X.length, k = X[0]?.length ?? 0;
  if (!n || !k) throw new Error('logisticFit: no data');
  const mean = y.reduce((s, v) => s + v, 0) / n;
  const beta = new Array(k).fill(0);
  beta[0] = Math.log(Math.min(Math.max(mean, 1e-6), 1 - 1e-6) / (1 - Math.min(Math.max(mean, 1e-6), 1 - 1e-6)));
  let it = 0, converged = false, inv = null;
  for (; it < maxIter; it++) {
    const g = new Array(k).fill(0), H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      const p = predict(beta, X[i]), w = p * (1 - p);
      for (let a = 0; a < k; a++) {
        g[a] += X[i][a] * (y[i] - p);
        for (let b = 0; b < k; b++) H[a][b] += w * X[i][a] * X[i][b];
      }
    }
    for (let a = 1; a < k; a++) { g[a] -= ridge * beta[a]; H[a][a] += ridge; }
    const s = solveSym(H, g);
    if (!s) break;
    inv = s.inv;
    let step = Math.max(...s.x.map(Math.abs));
    // Damped step: a Newton step larger than 5 in any coordinate is scaled down (separation guard).
    const scale = step > 5 ? 5 / step : 1;
    for (let a = 0; a < k; a++) beta[a] += scale * s.x[a];
    if (step * scale < tol) { converged = true; break; }
  }
  let logLik = 0;
  for (let i = 0; i < n; i++) { const p = predict(beta, X[i]); logLik += y[i] ? Math.log(Math.max(p, 1e-300)) : Math.log(Math.max(1 - p, 1e-300)); }
  return { beta, se: inv ? inv.map((row, i) => Math.sqrt(Math.max(row[i], 0))) : beta.map(() => null), logLik, iterations: it + 1, converged, n, events: y.reduce((s, v) => s + v, 0) };
}

// Mann-Whitney AUC of scores against 0/1 labels (ties count one half).
export function auc(scores, labels) {
  const pos = [], neg = [];
  scores.forEach((s, i) => (labels[i] ? pos : neg).push(s));
  if (!pos.length || !neg.length) return null;
  let u = 0;
  for (const a of pos) for (const b of neg) u += a > b ? 1 : a === b ? 0.5 : 0;
  return u / (pos.length * neg.length);
}

// ------------------------------------------------------------------------------------------------ the charts
// The RA-CUSUM weight of one outcome (Steiner et al. 2000, R_0 = 1).
export const raWeight = (y, p, ra) => (y ? Math.log(ra) : 0) - Math.log(1 - p + ra * p);

// seq: [{ idx, y, p, version }] in stream order. reset 'version' restarts the chart when version changes; 'none' never.
// Returns the chart path and the alarm idxs (the chart restarts after each alarm).
export function runCusum(seq, { h, ra = DESIGN.ra, reset = DESIGN.reset } = {}) {
  if (!(h > 0)) throw new Error('runCusum: h must be > 0');
  let s = 0, prevVersion;
  const pathOut = [], alarms = [];
  for (const e of seq) {
    if (reset === 'version' && prevVersion !== undefined && e.version !== prevVersion) s = 0;
    prevVersion = e.version;
    const w = raWeight(e.y, e.p, ra);
    s = Math.max(0, s + w);
    const alarm = s >= h;
    pathOut.push({ idx: e.idx, y: e.y, p: r4(e.p), w: r4(w), s: r4(s), alarm });
    if (alarm) { alarms.push(e.idx); s = 0; }
  }
  return { path: pathOut, alarms };
}

// The current rule, replayed. seq: [{ idx, deopt, compileBefore }] in stream order; compileBefore (as-run: a compile
// attempt ran at the start of this row) resets the count, as stream.mjs doCompile does. With restart (frozen streams, no
// as-run compiles), the count also resets after an alarm, as the recompile the alarm asks for would.
export function countRule(seq, { k = DESIGN.countK, restart = false } = {}) {
  let c = 0, pending = false;
  const alarms = [];
  for (const e of seq) {
    if (e.compileBefore || (restart && pending)) { c = 0; pending = false; }
    if (e.deopt) { c++; if (c >= k && !pending) { alarms.push(e.idx); pending = true; } }
  }
  return { alarms };
}

// ------------------------------------------------------------------------------------------------ in-control simulation
// An in-control process under a fitted model. features: subset of ['novelty', 'history']; noveltyPool: case-mix novelty
// values (capped); casePool: [{ nov, hist }] for iid mode; deoptShare: P(an event is a deopt) (it drives the history
// covariate and the count rule). ra precomputes the chart weights. step(rng, state) -> { p, y, deopt, w }.
export function makeProcess({ beta, features, noveltyPool, casePool = null, histWindow = DESIGN.histWindow, deoptShare = 1, mode = 'feedback', ra = DESIGN.ra }) {
  const useNov = features.includes('novelty'), useHist = features.includes('history');
  const xOf = (nov, hist) => [1, ...(useNov ? [nov] : []), ...(useHist ? [hist] : [])];
  const cell = p => ({ p, wFail: raWeight(1, p, ra), wOk: raWeight(0, p, ra) });
  if (mode === 'iid' || !useHist) {
    const pool = mode === 'iid' && casePool ? casePool : noveltyPool.map(nov => ({ nov, hist: 0 }));
    const cells = pool.map(c => cell(predict(beta, xOf(c.nov, useHist ? c.hist : 0))));
    return {
      kind: 'iid', ra, ps: cells.map(c => c.p), start: () => null,
      step: rng => { const c = cells[Math.floor(rng() * cells.length)], y = rng() < c.p ? 1 : 0; return { p: c.p, y, deopt: y && rng() < deoptShare ? 1 : 0, w: y ? c.wFail : c.wOk }; },
    };
  }
  // Feedback: a ring buffer of the last histWindow deopts; p looked up by (novelty index, history).
  const table = noveltyPool.map(nov => Array.from({ length: histWindow + 1 }, (_, hh) => cell(predict(beta, xOf(nov, hh)))));
  return {
    kind: 'feedback', ra,
    start: () => ({ ring: new Uint8Array(histWindow), at: 0, hist: 0 }),
    step: (rng, st) => {
      const c = table[Math.floor(rng() * table.length)][st.hist];
      const y = rng() < c.p ? 1 : 0, deopt = y && rng() < deoptShare ? 1 : 0;
      st.hist += deopt - st.ring[st.at]; st.ring[st.at] = deopt; st.at = (st.at + 1) % st.ring.length;
      return { p: c.p, y, deopt, w: y ? c.wFail : c.wOk };
    },
  };
}

// Simulates `reps` in-control paths of `steps` steps each and keeps each path's record highs of S (value, time), so the
// first passage time T(h) for any h is a lookup. Common random numbers: one seed for every h.
export function simulateRecords({ process, reps, steps, seed = SIM.seed }) {
  const rng = mulberry32(seed), out = [];
  for (let r = 0; r < reps; r++) {
    const st = process.start();
    let s = 0, best = 0;
    const vals = [], times = [];
    for (let t = 1; t <= steps; t++) {
      s = Math.max(0, s + process.step(rng, st).w);
      if (s > best) { best = s; vals.push(s); times.push(t); }
    }
    out.push({ vals: Float64Array.from(vals), times: Int32Array.from(times) });
  }
  return { paths: out, steps, reps, seed };
}

// ARL at h from simulated records (a path that never reaches h counts as `steps`: censored, a lower bound).
export function arlAt(sim, h) {
  let sum = 0, sum2 = 0, censored = 0;
  for (const { vals, times } of sim.paths) {
    let lo = 0, hi = vals.length;   // first j with vals[j] >= h (vals increasing)
    while (lo < hi) { const m = (lo + hi) >> 1; if (vals[m] >= h) hi = m; else lo = m + 1; }
    const T = lo < vals.length ? times[lo] : (censored++, sim.steps);
    sum += T; sum2 += T * T;
  }
  const n = sim.paths.length, arl = sum / n;
  return { arl, se: Math.sqrt(Math.max(sum2 / n - arl * arl, 0) / n), censored };
}

// The smallest h (to 1e-4) with ARL(h) >= target, from simulated records.
export function calibrateFromSim(sim, target) {
  let lo = 0, hi = 0.5;
  while (arlAt(sim, hi).arl < target) { lo = hi; hi *= 2; if (hi > 1e3) throw new Error('calibrateH: target not reached (increase steps)'); }
  while (hi - lo > 1e-5) { const m = (lo + hi) / 2; if (arlAt(sim, m).arl >= target) hi = m; else lo = m; }
  const h = Math.ceil(hi * 1e4) / 1e4, at = arlAt(sim, h);
  return { h, target, arl: at.arl, se: at.se, censored: at.censored, reps: sim.reps, steps: sim.steps };
}
export function calibrateH({ process, target = DESIGN.arl0, reps = SIM.reps, seed = SIM.seed, steps = target * SIM.stepsPerTarget }) {
  return { ...calibrateFromSim(simulateRecords({ process, reps, steps, seed }), target), ra: process.ra, seed };
}

// The count rule's in-control ARL under the same process (alarm at the k-th deopt since the last alarm).
export function countRuleArl({ process, k = DESIGN.countK, reps = SIM.reps, seed = SIM.seed, steps = 20000 }) {
  const rng = mulberry32(seed);
  let sum = 0, sum2 = 0, censored = 0;
  for (let r = 0; r < reps; r++) {
    const st = process.start();
    let c = 0, t = 0;
    for (; t < steps; ) { t++; const { deopt } = process.step(rng, st); if (deopt) { c++; if (c >= k) break; } }
    if (c < k) censored++;
    sum += t; sum2 += t * t;
  }
  const arl = sum / reps;
  return { arl, se: Math.sqrt(Math.max(sum2 / reps - arl * arl, 0) / reps), censored, reps };
}

// ------------------------------------------------------------------------------------------------ data
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// One experiment: arms (rows deduped by idx, sorted) and the drift index (scoring only).
export function loadExperiment(runsDir, experiment) {
  const dir = path.join(runsDir, experiment);
  if (!existsSync(dir)) throw new Error(`cusum: ${dir} not found`);
  const arms = loadArms(dir).map(a => {
    const rows = [...new Map(a.rows.map(r => [r.idx, r])).values()].sort((x, y) => x.idx - y.idx);
    return { slug: path.basename(a.dir), spec: a.meta.spec ?? a.meta.slug ?? path.basename(a.dir), kind: a.meta.kind ?? rows[0]?.kind, rows };
  });
  const longest = [...arms].sort((a, b) => b.rows.length - a.rows.length)[0];
  const d0 = longest.rows[0]?.difficulty, drift = longest.rows.find(r => r.difficulty !== d0);
  return { experiment, family: parseTaskKey(longest.rows[0]?.taskKey)?.familyId ?? null, arms, driftIdx: drift ? drift.idx : null, baseDifficulty: d0, driftDifficulty: drift?.difficulty ?? null };
}

// Regenerates every dev task once (hash-checked against the rows). Held-out task text is never opened.
export async function tasksOf(experiments) {
  const { makeTasks } = await import('../lib/beds.mjs');
  const cache = new Map(), problems = [];
  for (const ex of experiments) for (const a of ex.arms) for (const r of a.rows) {
    if (cache.has(r.taskKey)) continue;
    const k = parseTaskKey(r.taskKey);
    if (!k || k.split !== 'dev') throw new Error(`cusum: ${r.taskKey} is not on the dev split`);
    const [t] = await makeTasks(k.familyId, { split: 'dev', seeds: [k.seed], difficulty: k.difficulty });
    if (r.taskHash && t.taskHash !== r.taskHash) { problems.push(`${r.taskKey}: regenerated hash differs`); cache.set(r.taskKey, null); continue; }
    cache.set(r.taskKey, { prompt: t.task.prompt, inputs: t.task.inputs, ...(t.task.files ? { files: t.task.files } : {}) });
  }
  return { taskOf: r => cache.get(r.taskKey) ?? null, problems, count: cache.size };
}

// Novelty scores per arm: frozen (the arm's first `warmup` tasks, every row checked) and version (eval-profiles.mjs's
// version policy for JIT rows at idx >= warmup; frozen elsewhere). Raw scores, 3 decimals.
export function noveltyOf(arm, taskOf, { warmup = DESIGN.warmup } = {}) {
  const tasks = arm.rows.map(taskOf);
  const base = learnProfile(tasks.slice(0, warmup).filter(Boolean));
  const frozen = new Map(arm.rows.map((r, i) => [r.idx, tasks[i] ? r3(checkProfile(base, tasks[i]).score) : null]));
  const version = new Map(frozen);
  if (arm.kind === 'jit') {
    const ev = evaluateArm(arm.rows, taskOf, { warmup, kind: 'jit' });
    for (const v of ev.policies.version.verdicts) if (!v.skipped) version.set(v.idx, v.score);
  }
  return { frozen, version };
}

// One unit per row: the facts the views and the risk inputs need. `post` (idx >= D) is the scoring label; no feature reads it.
export function unitsOf(ex, novelty, { histWindow = DESIGN.histWindow } = {}) {
  const out = [];
  for (const a of ex.arms) {
    const nv = novelty.get(a.slug), deoptAt = new Map();
    for (const r of a.rows) {
      const attempted = r.compiledStatus != null, deopt = attempted && r.compiledStatus !== 'ok', ev = r.events ?? [];
      let hist = 0;
      for (let j = r.idx - histWindow; j < r.idx; j++) hist += deoptAt.get(j) ? 1 : 0;
      out.push({
        experiment: ex.experiment, family: ex.family, arm: a.slug, spec: a.spec, kind: a.kind, idx: r.idx, seed: r.seed,
        version: a.kind === 'static' ? 'static' : r.version ?? null, attempted, deopt, deoptKind: deopt ? r.deoptKind ?? r.compiledStatus : null,
        disagree: ev.some(e => e.kind === 'disagree'), regression: ev.some(e => e.kind === 'regression'), compileBefore: ev.some(e => e.kind === 'compile-attempt'),
        delivered: r.delivered, pass: !!r.pass, novFrozen: nv.frozen.get(r.idx), novVersion: nv.version.get(r.idx), hist,
        asRun: { deoptsSinceCompile: r.stateAfter?.deoptsSinceCompile ?? null, pendingCompile: r.stateAfter?.pendingCompile ?? null },
        driftIdx: ex.driftIdx, post: ex.driftIdx != null && r.idx >= ex.driftIdx,
      });
      deoptAt.set(r.idx, deopt);
    }
  }
  return out;
}

// The monitored outcome of a unit under a view (null: not observed in that view).
export function eventOf(u, view) {
  if (view === 'system') return u.kind === 'jit' && u.attempted ? (u.deopt || u.disagree ? 1 : 0) : null;
  if (view === 'oracle') return u.attempted ? (u.deopt || u.disagree || (u.delivered === 'compiled' && !u.pass) ? 1 : 0) : u.pass ? 0 : 1;
  throw new Error(`cusum: unknown view ${view}`);
}
export const isMonitored = (u, view) => (u.kind === 'jit' && u.attempted) || (view === 'oracle' && u.kind === 'static');
export const isFitRow = (u, view) => (view === 'system' ? u.kind === 'jit' && u.attempted : true);

// The risk-input vector [1, novelty?, history?]. Reads only novelty and history (never difficulty, taskKey or post).
export function featuresOf(u, { features = DESIGN.features, noveltyPolicy = DESIGN.noveltyPolicy, noveltyCap = DESIGN.noveltyCap } = {}) {
  const nov = Math.min(Number(noveltyPolicy === 'version' ? u.novVersion : u.novFrozen) || 0, noveltyCap);
  return [1, ...(features.includes('novelty') ? [nov] : []), ...(features.includes('history') ? [u.hist] : [])];
}

// ------------------------------------------------------------------------------------------------ one variant
const featureNames = features => ['intercept', ...features.filter(f => f === 'novelty'), ...features.filter(f => f === 'history')];

export function fitModel(units, v) {
  const rows = units.filter(u => isFitRow(u, v.view) && (v.fit !== 'phase1' || !u.post));
  const X = rows.map(u => featuresOf(u, v)), y = rows.map(u => eventOf(u, v.view));
  const fit = logisticFit(X, y, { ridge: v.ridge ?? DESIGN.ridge });
  const ps = X.map(x => predict(fit.beta, x));
  const k = fit.beta.length - 1, nonEvents = fit.n - fit.events;
  return { ...fit, names: featureNames(v.features), epv: k ? Math.min(fit.events, nonEvents) / k : null, auc: k ? auc(ps, y) : null, rows: rows.length,
    calibration: calibrationTable(rows, ps, y) };
}

// Observed / expected events by family and drift segment (the scoring label is used here to report, not to fit).
function calibrationTable(rows, ps, y) {
  const cells = new Map();
  rows.forEach((u, i) => {
    const key = `${u.family}:${u.post ? 'post' : 'pre'}`, c = cells.get(key) ?? { family: u.family, segment: u.post ? 'post' : 'pre', n: 0, observed: 0, expected: 0 };
    c.n++; c.observed += y[i]; c.expected += ps[i]; cells.set(key, c);
  });
  return [...cells.values()].map(c => ({ ...c, expected: r3(c.expected), oe: c.expected ? r3(c.observed / c.expected) : null }));
}

function processFor(model, monitoredUnits, v) {
  const events = monitoredUnits.filter(u => eventOf(u, v.view) === 1);
  const deoptShare = events.length ? events.filter(u => u.deopt).length / events.length : 0;
  const novOf = u => featuresOf(u, { ...v, features: ['novelty'] })[1];
  const noveltyPool = monitoredUnits.map(novOf), casePool = monitoredUnits.map(u => ({ nov: novOf(u), hist: u.hist }));
  return { process: makeProcess({ beta: model.beta, features: v.features, noveltyPool, casePool, histWindow: v.histWindow ?? DESIGN.histWindow, deoptShare, mode: v.calib, ra: v.ra }), deoptShare };
}

// Summary of one stream's alarms against its drift index.
export function summarizeAlarms(alarms, { driftIdx, firstIdx, lastIdx }) {
  const pre = alarms.filter(i => i < driftIdx), post = alarms.filter(i => i >= driftIdx);
  const reaches = driftIdx != null && lastIdx >= driftIdx;
  const first = post[0] ?? null;
  return { falseAlarms: pre.length, falseAlarmIdx: pre, firstAlarmAtOrAfterDrift: first, delay: first == null ? null : first - driftIdx,
    reachesDrift: reaches, postRows: reaches ? lastIdx - driftIdx + 1 : 0, censored: reaches && first == null, firstIdx, lastIdx };
}

export function replayStream(streamUnits, model, h, v) {
  const view = v.view, mon = streamUnits.filter(u => isMonitored(u, view));
  const seq = mon.map(u => ({ idx: u.idx, y: eventOf(u, view), p: predict(model.beta, featuresOf(u, v)), version: u.version }));
  const cus = runCusum(seq, { h, ra: v.ra, reset: v.reset });
  const cnt = countRule(streamUnits.filter(u => u.attempted && u.kind === 'jit').map(u => ({ idx: u.idx, deopt: u.deopt, compileBefore: u.compileBefore })), { k: DESIGN.countK });
  const D = streamUnits[0]?.driftIdx ?? null, firstIdx = mon[0]?.idx ?? null, lastIdx = streamUnits.at(-1)?.idx ?? null;
  const atDrift = streamUnits.find(u => u.idx === D);
  const versionChangeAfterDrift = D == null ? null : (streamUnits.find(u => u.idx > D && u.version !== atDrift?.version && u.version != null)?.idx ?? null);
  const regressionAtOrAfterDrift = streamUnits.find(u => D != null && u.idx >= D && u.regression)?.idx ?? null;
  return {
    experiment: streamUnits[0]?.experiment, family: streamUnits[0]?.family, arm: streamUnits[0]?.arm, kind: streamUnits[0]?.kind,
    driftIdx: D, monitored: mon.length, monitoredPre: mon.filter(u => !u.post).length, events: seq.filter(e => e.y).length,
    versionAtDrift: atDrift?.version ?? null, versionChangeAfterDrift, regressionAtOrAfterDrift,
    cusum: { alarms: cus.alarms, ...summarizeAlarms(cus.alarms, { driftIdx: D, firstIdx, lastIdx }), maxS: r4(Math.max(0, ...cus.path.map(x => x.s))), path: cus.path },
    count: streamUnits[0]?.kind === 'jit' ? { alarms: cnt.alarms, ...summarizeAlarms(cnt.alarms, { driftIdx: D, firstIdx, lastIdx }) } : null,
  };
}

// The section's rule over stream summaries (one rule: 'cusum' or 'count').
export function decide(streams, rule, { maxDelay = DESIGN.maxDelay, maxFalse = DESIGN.maxFalse } = {}) {
  const S = streams.map(s => ({ stream: `${s.family} ${shortArm(s.arm)}`, ...s[rule] })).filter(s => s.alarms);
  const reaching = S.filter(s => s.reachesDrift);
  const detectFail = reaching.filter(s => s.delay == null || s.delay > maxDelay), falseFail = S.filter(s => s.falseAlarms > maxFalse);
  return {
    adopt: reaching.length > 0 && !detectFail.length && !falseFail.length,
    detection: { streamsReachingDrift: reaching.length, met: reaching.length - detectFail.length, failing: detectFail.map(s => `${s.stream} (${s.delay == null ? `none in ${s.postRows} post-drift rows` : `delay ${s.delay}`})`) },
    falseAlarms: { streams: S.length, met: S.length - falseFail.length, failing: falseFail.map(s => `${s.stream} (${s.falseAlarms})`), total: S.reduce((t, s) => t + s.falseAlarms, 0) },
  };
}

export const shortArm = slug => {
  const m = /^jit-claude-(\w+)-5-5--claude-(\w+)-5-5$/.exec(String(slug));
  if (m) return `${m[1][0].toUpperCase()}→${m[2][0].toUpperCase()}`;
  if (String(slug).startsWith('static')) return 'static';
  const a = /^agent-claude-(\w+)-5-5$/.exec(String(slug));
  return a ? `${a[1]} agent` : String(slug);
};

const groupStreams = units => {
  const g = new Map();
  for (const u of units) { const k = `${u.experiment}|${u.arm}`; if (!g.has(k)) g.set(k, []); g.get(k).push(u); }
  return [...g.values()].map(us => us.sort((a, b) => a.idx - b.idx));
};

// Runs one variant: fit, calibrate h, replay every monitored stream, decide. arl0 'matchCount' sets the target to the
// count rule's in-control ARL under the same fitted process (a matched-false-alarm comparison). sweep: also replay a grid of
// h values (ARL0 at each from the same simulated paths) to show whether any h meets the rule on these rows.
export function runVariant(units, variant, { sim = SIM } = {}) {
  const v = { ...DESIGN, ...variant };
  const scopes = v.fit === 'lofo' ? [...new Set(units.map(u => u.family))].map(f => ({ family: f, fitUnits: units.filter(u => u.family !== f), monUnits: units.filter(u => u.family === f) }))
    : [{ family: null, fitUnits: units, monUnits: units }];
  const parts = [];
  for (const sc of scopes) {
    const model = fitModel(sc.fitUnits, v);
    const calibUnits = sc.monUnits.filter(u => isMonitored(u, v.view) && (v.fit !== 'phase1' || !u.post));
    const { process, deoptShare } = processFor(model, calibUnits, v);
    const countArl = countRuleArl({ process, k: v.countK, reps: Math.min(sim.reps, 4000), seed: sim.seed });
    const target = v.arl0 === 'matchCount' ? Math.max(2, Math.round(countArl.arl)) : v.arl0;
    const paths = simulateRecords({ process, reps: sim.reps, steps: Math.max(200, target * sim.stepsPerTarget), seed: sim.seed });
    const cal = { ...calibrateFromSim(paths, target), ra: v.ra, seed: sim.seed };
    const groups = groupStreams(sc.monUnits).filter(us => us.some(u => isMonitored(u, v.view)));
    const streams = groups.map(us => replayStream(us, model, cal.h, v));
    // Feasibility: the largest one-event weight on the monitored rows, the events in a row needed to cross h from S = 0,
    // and the most S can gain in the maxDelay + 1 rows from D to D + maxDelay.
    const maxW = Math.max(...calibUnits.map(u => raWeight(1, predict(model.beta, featuresOf(u, v)), v.ra)));
    const feasibility = { maxEventWeight: r4(maxW), eventsInARowNeeded: Math.ceil(cal.h / maxW - 1e-12), reachInWindow: r4((v.maxDelay + 1) * maxW), reachableFromZero: (v.maxDelay + 1) * maxW >= cal.h };
    let sweep = null;
    if (v.sweep) {
      sweep = [];
      for (let h = 0.05; h <= Math.max(cal.h * 1.25, 0.5) + 1e-9; h += 0.05) {
        const hh = Math.round(h * 100) / 100, ss = groups.map(us => replayStream(us, model, hh, v)), d = decide(ss, 'cusum', v);
        sweep.push({ h: hh, arl0: r3(arlAt(paths, hh).arl), falseAlarms: d.falseAlarms.total, worstStream: Math.max(0, ...ss.map(x => x.cusum.falseAlarms)), detected: d.detection.met, reaching: d.detection.streamsReachingDrift, adopt: d.adopt });
      }
    }
    parts.push({ family: sc.family, model, calibration: { ...cal, deoptShare: r3(deoptShare), caseMix: calibUnits.length }, countRuleInControlArl: countArl, feasibility, sweep, streams });
  }
  const streams = parts.flatMap(p => p.streams);
  return { name: v.name, view: v.view, variant: { ...variant }, parts, streams, decision: { cusum: decide(streams, 'cusum', v), count: decide(streams, 'count', v) } };
}

// ------------------------------------------------------------------------------------------------ frozen versions (N-version)
export function nversionUnits(nv, recordsUnits, { histWindow = DESIGN.histWindow } = {}) {
  const idxOf = new Map(recordsUnits.map(u => [u.seed, u])), out = [];
  for (const solver of Object.keys(nv.summary?.solvers ?? {})) {
    const rows = (nv.rows ?? []).map(r => ({ r, k: parseTaskKey(r.taskKey) })).map(({ r, k }) => ({ r, u: idxOf.get(k.seed) })).filter(x => x.u && x.r.runs?.[solver]).sort((a, b) => a.u.idx - b.u.idx);
    const deoptAt = new Map();
    for (const { r, u } of rows) {
      const run = r.runs[solver], deopt = run.status !== 'ok';
      let hist = 0;
      for (let j = u.idx - histWindow; j < u.idx; j++) hist += deoptAt.get(j) ? 1 : 0;
      out.push({ experiment: 'nversion-records-dev', family: 'records', arm: `nv-${solver}`, spec: solver, kind: 'jit', idx: u.idx, seed: u.seed, version: solver,
        attempted: u.idx >= DESIGN.warmup, deopt, disagree: false, regression: false, compileBefore: false, delivered: deopt ? 'interpreter' : 'compiled', pass: !!run.pass,
        novFrozen: u.novFrozen, novVersion: u.novFrozen, hist, driftIdx: u.driftIdx, post: u.post });
      deoptAt.set(u.idx, deopt);
    }
  }
  return out;
}

export function replayFrozen(nvUnits, model, h, v) {
  return groupStreams(nvUnits).map(us => {
    const mon = us.filter(u => u.attempted);
    const seq = mon.map(u => ({ idx: u.idx, y: eventOf(u, v.view), p: predict(model.beta, featuresOf(u, v)), version: u.version }));
    const cus = runCusum(seq, { h, ra: v.ra, reset: v.reset });
    const cnt = countRule(mon.map(u => ({ idx: u.idx, deopt: u.deopt })), { k: DESIGN.countK, restart: true });
    const D = us[0].driftIdx, lastIdx = us.at(-1).idx, firstIdx = mon[0]?.idx ?? null;
    return { arm: us[0].arm, solver: us[0].spec, monitored: mon.length, events: seq.filter(e => e.y).length, deopts: mon.filter(u => u.deopt).length, wrong: mon.filter(u => u.delivered === 'compiled' && !u.pass).length,
      cusum: { alarms: cus.alarms, ...summarizeAlarms(cus.alarms, { driftIdx: D, firstIdx, lastIdx }), maxS: r4(Math.max(0, ...cus.path.map(x => x.s))), path: cus.path },
      count: { alarms: cnt.alarms, ...summarizeAlarms(cnt.alarms, { driftIdx: D, firstIdx, lastIdx }) } };
  });
}

// ------------------------------------------------------------------------------------------------ the analysis
export const VARIANTS = Object.freeze([
  { name: 'primary', view: 'system', sweep: true },
  { name: 'oracle', view: 'oracle', sweep: true },
  { name: 'system: ARL0 matched to the count rule', view: 'system', arl0: 'matchCount' },
  { name: 'oracle: ARL0 matched to the count rule', view: 'oracle', arl0: 'matchCount' },
  ...['system', 'oracle'].flatMap(view => [
    { name: `${view}: no risk adjustment`, view, features: [] },
    { name: `${view}: novelty only`, view, features: ['novelty'] },
    { name: `${view}: history only`, view, features: ['history'] },
    { name: `${view}: version-profile novelty`, view, noveltyPolicy: 'version' },
    { name: `${view}: R_A 3`, view, ra: 3 },
    { name: `${view}: R_A 5`, view, ra: 5 },
    { name: `${view}: no reset at version change`, view, reset: 'none' },
    { name: `${view}: iid calibration`, view, calib: 'iid' },
    { name: `${view}: leave-one-family-out fit`, view, fit: 'lofo' },
    { name: `${view}: phase-I fit (label-assisted window)`, view, fit: 'phase1' },
  ]),
]);

export async function analyze({ runsDir = DEFAULT_RUNS, nversionFile = DEFAULT_NVERSION, sim = SIM, variants = VARIANTS } = {}) {
  const exps = STREAMS.map(s => loadExperiment(runsDir, s.experiment));
  const { taskOf, problems, count } = await tasksOf(exps);
  const units = [];
  for (const ex of exps) {
    const nov = new Map(ex.arms.map(a => [a.slug, noveltyOf(a, taskOf)]));
    units.push(...unitsOf(ex, nov));
  }
  // The as-run count-rule check: replayed alarms equal the rows where stateAfter.deoptsSinceCompile reached k on a deopt.
  const asRunCheck = groupStreams(units.filter(u => u.kind === 'jit')).map(us => {
    const replay = countRule(us.filter(u => u.attempted).map(u => ({ idx: u.idx, deopt: u.deopt, compileBefore: u.compileBefore })), { k: DESIGN.countK }).alarms;
    const logged = us.filter(u => u.deopt && u.asRun.deoptsSinceCompile >= DESIGN.countK).map(u => u.idx);
    return { experiment: us[0].experiment, arm: us[0].arm, replay, logged, equal: JSON.stringify(replay) === JSON.stringify(logged) };
  });
  const results = variants.map(v => runVariant(units, v, { sim }));
  // Frozen versions under the primary system and oracle models.
  let frozen = null;
  if (nversionFile && existsSync(nversionFile)) {
    const nv = JSON.parse(readFileSync(nversionFile, 'utf8'));
    const nvUnits = nversionUnits(nv, units.filter(u => u.experiment === 'jit-dev-records-1'));
    frozen = ['primary', 'oracle'].map(name => {
      const r = results.find(x => x.name === name);
      if (!r) return null;
      const v = { ...DESIGN, ...r.variant }, part = r.parts[0];
      return { name, view: v.view, h: part.calibration.h, note: v.view === 'system' ? 'deopt only: the probe ran no shadows' : 'deopt or wrong compiled answer', streams: replayFrozen(nvUnits, part.model, part.calibration.h, v) };
    }).filter(Boolean);
  }
  const rowsBy = (pred) => units.filter(pred).length;
  return {
    evidence: 'development / diagnostic: dev seeds 201-224, K = 1, as-run streams; $0, no model call',
    design: DESIGN, sim,
    provenance: { profileSha256: sha256(readFileSync(path.join(REPO, 'experiments/jit/profile.mjs'))), evalProfilesSha256: sha256(readFileSync(path.join(REPO, 'experiments/jit/eval-profiles.mjs'))),
      nversionSha256: nversionFile && existsSync(nversionFile) ? sha256(readFileSync(nversionFile)) : null },
    data: { rows: units.length, byExperiment: Object.fromEntries(exps.map(e => [e.experiment, rowsBy(u => u.experiment === e.experiment)])),
      systemFitRows: rowsBy(u => isFitRow(u, 'system')), oracleFitRows: rowsBy(u => isFitRow(u, 'oracle')),
      drift: exps.map(e => ({ experiment: e.experiment, driftIdx: e.driftIdx, from: `d${e.baseDifficulty}`, to: `d${e.driftDifficulty}` })), tasks: count, taskProblems: problems,
      nearBand: 'not journaled (no P16 decisions in these streams); the input is absent' },
    asRunCheck, units, results, frozen,
  };
}

// ------------------------------------------------------------------------------------------------ rendering
const fmtAlarms = xs => (xs?.length ? xs.join(', ') : '–');
const fmtDelay = s => (!s ? '–' : !s.reachesDrift ? `n/a (ends at ${s.lastIdx})` : s.delay == null ? `none in ${s.postRows}` : String(s.delay));
export function renderTables(res) {
  const L = [`# M9 risk-adjusted CUSUM: generated tables`, '', `*${res.evidence}. Generated by \`node experiments/jit/cusum.mjs\`. Do not edit by hand.*`, '',
    `Rows: ${res.data.rows} (${Object.entries(res.data.byExperiment).map(([k, v]) => `${k} ${v}`).join(', ')}). System-view fit rows ${res.data.systemFitRows}; oracle-view fit rows ${res.data.oracleFitRows}. Drift: ${res.data.drift.map(d => `${d.experiment} idx ${d.driftIdx} (${d.from} → ${d.to})`).join('; ')}. Near-band input: ${res.data.nearBand}. Simulation: ${res.sim.reps} paths, seed ${res.sim.seed}.`, '',
    `profile.mjs sha256 ${res.provenance.profileSha256.slice(0, 16)}…, eval-profiles.mjs ${res.provenance.evalProfilesSha256.slice(0, 16)}…`, '',
    '## As-run count rule replay check', '', '| stream | arm | replayed alarms | logged (stateAfter) | equal |', '|---|---|---|---|---|'];
  for (const c of res.asRunCheck) L.push(`| ${c.experiment} | ${shortArm(c.arm)} | ${fmtAlarms(c.replay)} | ${fmtAlarms(c.logged)} | ${c.equal ? 'yes' : '**no**'} |`);
  L.push('', '## Variants: fit, h and the rule', '', 'Feasibility: events in a row needed to cross h from S = 0 at the largest one-event weight; and whether the 5 rows from the drift index to drift + 4 can reach h from S = 0 at all.', '',
    '| variant | view | fit rows | coefficients (SE) | EPV | AUC | target ARL0 | h (ARL0 ± SE) | events in a row needed (reach in 5 rows) | count-rule in-control ARL | CUSUM: false alarms (total, worst) | CUSUM: detection (met / reaching) | CUSUM meets rule? | count: false alarms (total, worst) | count: detection | count meets rule? |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of res.results) {
    const pf = (p, f) => `${p.family ? `${p.family}: ` : ''}${f(p)}`, all = f => r.parts.map(p => pf(p, f)).join('; ');
    const coef = all(p => p.model.names.map((n, i) => `${n} ${p.model.beta[i].toFixed(2)} (${p.model.se[i]?.toFixed(2) ?? '–'})`).join(', '));
    const worst = rule => Math.max(0, ...r.streams.filter(s => s[rule]?.alarms).map(s => s[rule].falseAlarms));
    const d = r.decision.cusum, c = r.decision.count;
    L.push(`| ${r.name} | ${r.view} | ${r.parts.map(p => p.model.rows).join(' / ')} | ${coef} | ${r.parts.map(p => (p.model.epv == null ? '–' : p.model.epv.toFixed(1))).join(' / ')} | ${r.parts.map(p => (p.model.auc == null ? '–' : p.model.auc.toFixed(2))).join(' / ')} | ${all(p => p.calibration.target)} | ${all(p => `${p.calibration.h.toFixed(3)} (${p.calibration.arl.toFixed(p.calibration.target < 50 ? 1 : 0)} ± ${p.calibration.se.toFixed(p.calibration.target < 50 ? 1 : 0)})`)} | ${all(p => `${p.feasibility.eventsInARowNeeded} (${p.feasibility.reachInWindow.toFixed(2)}${p.feasibility.reachableFromZero ? '' : ' < h'})`)} | ${all(p => p.countRuleInControlArl.arl.toFixed(1))} | ${d.falseAlarms.total}, ${worst('cusum')} | ${d.detection.met} / ${d.detection.streamsReachingDrift} | ${d.adopt ? '**yes**' : 'no'} | ${c.falseAlarms.total}, ${worst('count')} | ${c.detection.met} / ${c.detection.streamsReachingDrift} | ${c.adopt ? 'yes' : 'no'} |`);
  }
  for (const name of ['primary', 'oracle']) {
    const r = res.results.find(x => x.name === name);
    if (!r) continue;
    L.push('', `## ${name} (${r.view} view): per stream`, '', '| stream | arm | monitored (pre-drift) | events | drift idx | version at drift → as-run change | regression ≥ drift | CUSUM alarms | CUSUM false | CUSUM delay | max S | count alarms | count false | count delay |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const s of r.streams) L.push(`| ${s.experiment} | ${shortArm(s.arm)} | ${s.monitored} (${s.monitoredPre}) | ${s.events} | ${s.driftIdx} | ${s.versionAtDrift ?? '–'} → ${s.versionChangeAfterDrift ?? '–'} | ${s.regressionAtOrAfterDrift ?? '–'} | ${fmtAlarms(s.cusum.alarms)} | ${s.cusum.falseAlarms} | ${fmtDelay(s.cusum)} | ${s.cusum.maxS} | ${s.count ? fmtAlarms(s.count.alarms) : '–'} | ${s.count ? s.count.falseAlarms : '–'} | ${s.count ? fmtDelay(s.count) : '–'} |`);
    L.push('', `Calibration (observed / expected events by family and segment; the segment label is used only to report):`, '', '| family | segment | n | observed | expected | O/E |', '|---|---|---|---|---|---|');
    for (const c of r.parts[0].model.calibration) L.push(`| ${c.family} | ${c.segment} | ${c.n} | ${c.observed} | ${c.expected} | ${c.oe ?? '–'} |`);
    L.push('', 'Chart paths (idx:y/p/S, * = alarm):', '');
    for (const s of r.streams) L.push(`- ${s.experiment} ${shortArm(s.arm)}: ${s.cusum.path.map(x => `${x.idx}:${x.y}/${x.p.toFixed(2)}/${x.s.toFixed(2)}${x.alarm ? '*' : ''}`).join(' ')}`);
    const sw = r.parts[0].sweep;
    if (sw) {
      const met = sw.filter(x => x.adopt);
      L.push('', `h sweep (same fitted model; ARL0 from the same simulated paths; diagnostic, in-sample; grid 0.05 to 1.25 h in steps of 0.05, rows shown where the outcome changes; the full grid is in cusum.json): ${met.length ? `the rule is met at h ∈ {${met.map(x => x.h).join(', ')}}` : 'no h in the grid meets the rule'}.`, '', '| h | ARL0 | CUSUM false alarms (total, worst stream) | detected within 4 / reaching | meets rule |', '|---|---|---|---|---|');
      const key = x => `${x.falseAlarms}|${x.worstStream}|${x.detected}|${x.adopt}`;
      sw.forEach((x, i) => { if (i === 0 || i === sw.length - 1 || key(x) !== key(sw[i - 1])) L.push(`| ${x.h.toFixed(2)} | ${x.arl0} | ${x.falseAlarms}, ${x.worstStream} | ${x.detected} / ${x.reaching} | ${x.adopt ? '**yes**' : 'no'} |`); });
    }
  }
  if (res.frozen) for (const f of res.frozen) {
    L.push('', `## Frozen versions (N-version probe), ${f.name} model, h ${f.h.toFixed(3)} (${f.note})`, '', '| solver | monitored | deopts | wrong compiled | events | CUSUM alarms | CUSUM false | CUSUM delay | max S | count alarms | count false | count delay |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const s of f.streams) L.push(`| ${s.solver} | ${s.monitored} | ${s.deopts} | ${s.wrong} | ${s.events} | ${fmtAlarms(s.cusum.alarms)} | ${s.cusum.falseAlarms} | ${fmtDelay(s.cusum)} | ${s.cusum.maxS} | ${fmtAlarms(s.count.alarms)} | ${s.count.falseAlarms} | ${fmtDelay(s.count)} |`);
  }
  L.push('', '## Decision detail (primary, oracle and the matched-ARL0 diagnostics)', '');
  for (const r of res.results.filter(x => ['primary', 'oracle'].includes(x.name) || x.variant.arl0 === 'matchCount')) L.push(`- **${r.name}**: CUSUM ${r.decision.cusum.adopt ? 'meets' : 'fails'} the rule (detection ${r.decision.cusum.detection.met}/${r.decision.cusum.detection.streamsReachingDrift}${r.decision.cusum.detection.failing.length ? `; failing ${r.decision.cusum.detection.failing.join(', ')}` : ''}; false alarms ≤ 1 in ${r.decision.cusum.falseAlarms.met}/${r.decision.cusum.falseAlarms.streams}${r.decision.cusum.falseAlarms.failing.length ? `; failing ${r.decision.cusum.falseAlarms.failing.join(', ')}` : ''}).${r.decision.count ? ` Count rule (deopts; the same in both views): detection ${r.decision.count.detection.met}/${r.decision.count.detection.streamsReachingDrift}${r.decision.count.detection.failing.length ? ` (failing ${r.decision.count.detection.failing.join(', ')})` : ''}; false alarms ≤ 1 in ${r.decision.count.falseAlarms.met}/${r.decision.count.falseAlarms.streams}${r.decision.count.falseAlarms.failing.length ? ` (failing ${r.decision.count.falseAlarms.failing.join(', ')})` : ''}.` : ''}`);
  return L.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
  const sim = { ...SIM, reps: Number(arg('reps', SIM.reps)), seed: Number(arg('seed', SIM.seed)) };
  const res = await analyze({ runsDir: path.resolve(arg('runs', DEFAULT_RUNS)), nversionFile: path.resolve(arg('nversion', DEFAULT_NVERSION)), sim });
  const out = path.resolve(arg('out', DEFAULT_OUT));
  mkdirSync(out, { recursive: true });
  const slim = { ...res, units: res.units.map(({ asRun, ...u }) => u) };
  writeFileSync(path.join(out, 'cusum.json'), JSON.stringify(slim, null, 1) + '\n');
  writeFileSync(path.join(out, 'tables.generated.md'), renderTables(res));
  const p = res.results.find(r => r.name === 'primary');
  if (process.argv.includes('--json')) console.log(JSON.stringify(res.results.map(r => ({ name: r.name, decision: r.decision })), null, 1));
  else console.log(`wrote ${path.relative(REPO, out)}/cusum.json and tables.generated.md\nprimary: CUSUM ${p.decision.cusum.adopt ? 'ADOPT' : 'keep the count'}; ` +
    `h ${p.parts[0].calibration.h}; CUSUM false alarms ${p.decision.cusum.falseAlarms.total}, detection ${p.decision.cusum.detection.met}/${p.decision.cusum.detection.streamsReachingDrift}; ` +
    `count rule false alarms ${p.decision.count.falseAlarms.total}, detection ${p.decision.count.detection.met}/${p.decision.count.detection.streamsReachingDrift}`);
}
