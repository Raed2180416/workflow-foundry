// D2: co-failure (DESIGN §7 M0 item 10; §3 secondary 6 "portfolio-by-disagreement"). Do two modes fail on the same tasks more
// often than independence predicts? Primary: P(agent-H wrong AND static-b1h wrong) against P(agent-H wrong) x P(static-b1h wrong)
// on the records dev stream (jit-dev-records-1, 24 paired tasks). If they fail together, agreement between modes cannot serve as
// a verifier (Knight and Leveson 1986: independently written versions fail together).
//
// Unit: the task. For a mode, f(t) is the share of its trials on task t that were wrong (wrong = oracle pass false, including a
// timeout or a refusal: "not a verified success"). With one trial per task f is 0 or 1. Under the null that the two modes'
// failures are independent across tasks, E[both wrong] = mean(fA) x mean(fB); the observed joint is mean_t fA(t) fB(t). So
//   lift = mean_t(fA fB) / (mean fA x mean fB)      (1 = independent; > 1 = fail together)
// The p-value is a permutation test that shuffles B's per-task failure shares across tasks (exact when n! <= 40320, else 20,000
// seeded draws); for single-trial binary data it equals the one-sided Fisher exact test (reported beside it as a cross-check).
// The interval is a seeded percentile bootstrap over tasks. Evidence grade: LEGACY/dev (K = 1 stream, dev seeds).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { mean, sum, quantile, round, fisherUpper, rng, REPO, sourceOf } from './common.mjs';

const PERM_EXACT_MAX = 8, PERM_DRAWS = 20000, BOOT_REPS = 2000;

/** Failure share per task for one mode: Map(taskKey -> share wrong) from LEGACY rows. */
export function failureShares(rows, mode) {
  const by = new Map();
  for (const r of rows) if (r.mode === mode) { const a = by.get(r.taskKey) ?? { n: 0, wrong: 0 }; a.n += 1; a.wrong += r.pass ? 0 : 1; by.set(r.taskKey, a); }
  return new Map([...by].map(([t, a]) => [t, a.wrong / a.n]));
}

function stat(fa, fb) { return mean(fa.map((x, i) => x * fb[i])); }
function* permutations(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  function* rec(k) { if (k === n) { yield [...a]; return; } for (let i = k; i < n; i++) { [a[k], a[i]] = [a[i], a[k]]; yield* rec(k + 1); [a[k], a[i]] = [a[i], a[k]]; } }
  yield* rec(0);
}

/**
 * Co-failure of two failure-share vectors (aligned by task). Returns the joint, the independence expectation, the lift, the
 * conditional rates, the permutation p (positive association), a bootstrap interval for the lift and, for binary data, Fisher.
 */
export function coFailure(fa, fb, { seed = 20261014, perm = PERM_DRAWS, boot = BOOT_REPS } = {}) {
  if (fa.length !== fb.length) throw new Error('coFailure: vectors must be aligned');
  const n = fa.length, pA = mean(fa), pB = mean(fb), pAB = stat(fa, fb), expected = pA * pB;
  const lift = expected > 0 ? pAB / expected : null;
  const sd = x => Math.sqrt(mean(x.map(v => (v - mean(x)) ** 2)));
  const phi = sd(fa) > 0 && sd(fb) > 0 ? (pAB - pA * pB) / (sd(fa) * sd(fb)) : null;
  // Permutation test of the joint failure rate.
  const obs = pAB - 1e-12;
  let ge = 0, total = 0;
  if (n <= PERM_EXACT_MAX) { for (const p of permutations(n)) { total += 1; if (stat(fa, p.map(i => fb[i])) >= obs) ge += 1; } }
  else {
    const r = rng(seed), idx = Array.from({ length: n }, (_, i) => i);
    for (let k = 0; k < perm; k++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      total += 1; if (stat(fa, idx.map(i => fb[i])) >= obs) ge += 1;
    }
  }
  // Exact: the identity permutation is one of the n!; Monte Carlo: add-one so a p-value is never 0.
  const pPerm = n <= PERM_EXACT_MAX ? ge / total : (ge + 1) / (total + 1);
  // Bootstrap of the lift over tasks.
  const r2 = rng(seed + 1), lifts = [];
  for (let k = 0; k < boot; k++) {
    const ix = Array.from({ length: n }, () => Math.floor(r2() * n)), a = ix.map(i => fa[i]), b = ix.map(i => fb[i]);
    const e = mean(a) * mean(b);
    if (e > 0) lifts.push(stat(a, b) / e);
  }
  const binary = [...fa, ...fb].every(x => x === 0 || x === 1);
  let fisher = null;
  if (binary) {
    const a = sum(fa.map((x, i) => x * fb[i])), b = sum(fa) - a, c = sum(fb) - a, d = n - a - b - c;
    fisher = { both: a, onlyA: b, onlyB: c, neither: d, p: fisherUpper(a, b, c, d) };
  }
  return {
    tasks: n, pA: round(pA), pB: round(pB), pBoth: round(pAB), expectedIfIndependent: round(expected), excess: round(pAB - expected),
    liftMax: expected > 0 ? round(Math.min(pA, pB) / expected, 3) : null, lift: lift === null ? null : round(lift, 3),
    liftCI: lifts.length ? [round(quantile(lifts, 0.025), 3), round(quantile(lifts, 0.975), 3)] : null, phi: phi === null ? null : round(phi, 3),
    pBgivenAWrong: sum(fa) > 0 ? round(sum(fa.map((x, i) => x * fb[i])) / sum(fa)) : null,
    pBgivenARight: sum(fa.map(x => 1 - x)) > 0 ? round(sum(fa.map((x, i) => (1 - x) * fb[i])) / sum(fa.map(x => 1 - x))) : null,
    pPermutation: round(pPerm, 4), permutations: n <= PERM_EXACT_MAX ? 'exact' : `${total} seeded draws`, fisher,
    verdict: lift === null ? 'undefined (a mode never failed)' : pPerm <= 0.05 && lift > 1 ? 'fail together (p <= 0.05)' : lift > 1 ? 'lift above 1, not significant' : 'no excess co-failure',
  };
}

/** The pair (a, b) within one LEGACY job (paired tasks). */
export function pairOfJob(job, a, b, opts) {
  const fa = failureShares(job.rows, a), fb = failureShares(job.rows, b);
  const tasks = [...fa.keys()].filter(t => fb.has(t)).sort();
  if (!tasks.length) return null;
  const trials = Math.max(...job.rows.filter(r => r.mode === a).map(r => r.trial + 1));
  return { job: job.id, a, b, trialsPerTask: trials, ...coFailure(tasks.map(t => fa.get(t)), tasks.map(t => fb.get(t)), opts) };
}

/** Pass flags per solver of the committed N-version probe (4 compiled records solvers x 24 dev tasks). */
export function nversionPairs(file = path.join(REPO, 'research/jit-20261008/nversion-records-dev.json'), opts) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const solvers = Object.keys(j.summary.solvers);
  const rows = j.rows.flatMap(r => solvers.filter(s => r.runs[s]).map(s => ({ mode: s, taskKey: r.taskKey, trial: 0, pass: r.runs[s].pass === true })));
  const tasks = [...new Set(j.rows.filter(r => solvers.every(s => r.runs[s])).map(r => r.taskKey))].sort();
  const sh = Object.fromEntries(solvers.map(s => [s, failureShares(rows, s)]));
  const pairs = [];
  for (let i = 0; i < solvers.length; i++) for (let k = i + 1; k < solvers.length; k++) {
    pairs.push({ job: 'nversion-records-dev', a: solvers[i], b: solvers[k], trialsPerTask: 1, ...coFailure(tasks.map(t => sh[solvers[i]].get(t)), tasks.map(t => sh[solvers[k]].get(t)), opts) });
  }
  return { source: sourceOf(file), tasks: tasks.length, solvers, unanimous: j.summary.unanimous, disagree: j.summary.disagree, pairs };
}

export const PRIMARY = Object.freeze({ job: 'jit-dev-records-1', a: 'agent-H', b: 'static-b1h' });
export const SECONDARY_PAIRS = Object.freeze([
  { job: 'p1-records', a: 'direct-H', b: 'hand-H' }, { job: 'p1-records', a: 'direct-H', b: 'agent-H' }, { job: 'p1-records', a: 'agent-H', b: 'hand-H' },
  { job: 'c0-dev-records', a: 'agent-H', b: 'script-H' }, { job: 'c0-dev-records', a: 'agent-H', b: 'wf-H' },
  { job: 'c0-dev-codefix', a: 'agent-H', b: 'script-H' }, { job: 'c0-dev-codefix', a: 'agent-H', b: 'wf-H' },
  { job: 'jit-dev-kinetics-1', a: 'agent-H', b: 'jit-OH' }, { job: 'jit-r0-kinetics', a: 'agent-H', b: 'jit-OH' }, { job: 'jit-r0-records', a: 'agent-H', b: 'jit-HH' },
]);

export function runD2(jobs, { nversionFile } = {}) {
  const byId = new Map(jobs.map(j => [j.id, j]));
  const get = ({ job, a, b }) => { const j = byId.get(job); return j ? pairOfJob(j, a, b) : null; };
  const primary = get(PRIMARY);
  const records = byId.get(PRIMARY.job);
  const allPairs = [];
  if (records) {
    const modes = records.pairing.modes;
    for (let i = 0; i < modes.length; i++) for (let k = i + 1; k < modes.length; k++) allPairs.push(pairOfJob(records, modes[i], modes[k]));
  }
  const secondary = SECONDARY_PAIRS.map(get).filter(Boolean);
  const nv = nversionPairs(nversionFile);
  const all = [...allPairs, ...secondary, ...(nv?.pairs ?? [])].filter(p => p.lift !== null);
  return {
    id: 'D2', grade: 'LEGACY/dev', question: 'P(agent-H wrong and static-b1h wrong) against the product of the two rates, records dev stream',
    primary, recordsStreamPairs: allPairs, secondary, nversion: nv,
    summary: {
      primaryLift: primary?.lift ?? null, primaryP: primary?.pPermutation ?? null, primaryVerdict: primary?.verdict ?? null,
      pairsTotal: all.length, pairsLiftAbove1: all.filter(p => p.lift > 1).length, pairsSignificant: all.filter(p => p.lift > 1 && p.pPermutation <= 0.05).length,
      medianLift: all.length ? round(quantile(all.map(p => p.lift), 0.5), 3) : null,
    },
  };
}
