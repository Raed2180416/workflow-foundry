// Verification-policy simulator (BLOCKER-SYNTHESIS §2.1 row 5; C10; critique M3, V12). $0, no model calls.
//
// Data: nversion-records-dev.json, 4 compiled records solvers × 24 dev tasks (pass, status and a distinct-answer count per
// task; no answers). Reference: the Opus agent went 24/24 on these tasks (HANDOFF §2), so a verification call (a shadow
// or an adjudication by the reference) reveals exactly whether a compiled delivery was wrong. Each solver is treated as
// one JIT arm's compiled path over a 24-task stream (16 d3, then 8 d4): it delivers on its `ok` tasks; a deopt is visible
// to the system and needs no verification.
//
// Targets are SYSTEM-VIEW (oracle-free) numbers only: the silent-miss rate θ = wrong deliveries / deliveries as the system
// would estimate it from its own verification calls, and system-view durability Q = correct compiled deliveries / 24
// (the per-row quantity durability.mjs's system view averages). The PREREG's silent-miss rate is oracle-scored on every
// delivered answer (durability.mjs:19–20; PREREG §3), so no shadow schedule can bias it; this sizes a floor for
// system-view numbers only.
//
// Policies (per delivery i, verified with propensity π_i):
//   dispute-only   verify iff the 4 versions disagree on the task (distinct >= 2); concordant and single answers are
//                  assumed correct (discrepant analysis). Deterministic.
//   floor+IPW ε    disputes always (π = 1) plus an ε-random floor on every other delivery (π = ε); Horvitz–Thompson.
//   random ε       ε-random on every delivery, no dispute trigger; Horvitz–Thompson.
//   every-4th      stream.mjs's schedule (jit.shadowEvery 4: the 4th, 8th, … compiled ok run), estimated as if π = 1/4;
//                  the stream order is randomised within the d3 and d4 blocks per draw (the dev order is reported too).
//   every-4th+disp every-4th plus every disputed delivery (a stand-in for HANDOFF §3's shadowOnFlags: flags are not in
//                  the data, so "flag = dispute" is an assumption).
//   Z1.4 switching ANSI/ASQ Z1.4-style switching (dossier 6 §B16.4), defined here because Z1.4 inspects lots, not single
//                  answers: states normal (π = 1/4), tightened (π = 1), reduced (π = 1/8); normal → tightened when 2 of
//                  the last 5 inspections found a wrong answer; tightened → normal after 5 consecutive correct
//                  inspections; normal → reduced after 10 consecutive correct inspections; reduced → normal on 1 wrong.
//                  Inspection is randomised with the state's π, logged, and weighted by 1/π (HT stays unbiased under
//                  adaptive propensities that are fixed before each coin flip).
// Estimator for every randomised policy: stats.mjs ipwMissEstimate (HT point; CI from Wilson intervals per propensity
// stratum, an unverified stratum counting as [0, 1]).
//
//   node research/jit-20261008/analysis/verification-policy-sim.mjs [--draws 20000] [--json]
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rng } from '../../../beds/lib/rng.mjs';
import { ipwMissEstimate, wilson } from '../../../experiments/jit/stats.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SOLVERS = ['opusV1', 'opusV2', 'sonnetV1', 'haikuV1'];
export const EPSILONS = [0.05, 0.1, 0.2, 0.25, 0.5, 1];
export const REFERENCE_USD_PER_CALL = 0.56;   // Opus agent $/task on records dev (24/24, $0.56 per success; HANDOFF §2)
export const WINDOW = 6;                      // durability.mjs DEFAULTS.window; minShadows 1
// "Usable" CI for a system-view rate at n = 24 (fixed before reading the results): mean 95% width <= 0.30 (dossier 3
// E-B17-3's falsifier), empirical coverage >= 0.90, and |bias| <= 0.03 (the owner's 3-point floor).
export const USABLE = Object.freeze({ maxWidth: 0.30, minCoverage: 0.90, maxBias: 0.03 });

export function loadTasks(file = path.join(here, '..', 'nversion-records-dev.json')) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return j.rows.map((r, idx) => ({ idx, taskKey: r.taskKey, difficulty: r.difficulty, dispute: r.distinct >= 2,
    runs: Object.fromEntries(SOLVERS.map(s => [s, { delivered: r.runs[s]?.status === 'ok', wrong: r.runs[s]?.status === 'ok' && !r.runs[s].pass }])) }));
}

const blockShuffle = (tasks, r) => {
  const blocks = [...new Set(tasks.map(t => t.difficulty))];
  return blocks.flatMap(d => r.shuffle(tasks.filter(t => t.difficulty === d)));
};

// One draw of a policy on one solver's stream: returns per-delivery items and the verified flags by stream position.
function runPolicy(policy, eps, ordered, solver, r) {
  const items = [], verifiedAt = [];
  let oks = 0, state = 'normal', recent = [], streak = 0;
  const piOf = { normal: 1 / 4, tightened: 1, reduced: 1 / 8 };
  for (const t of ordered) {
    const run = t.runs[solver];
    if (!run.delivered) { verifiedAt.push(false); continue; }
    oks++;
    let pi, verified;
    switch (policy) {
      case 'dispute-only': pi = 1; verified = t.dispute; break;
      case 'floor': pi = t.dispute ? 1 : eps; verified = t.dispute || r.next() < eps; break;
      case 'random': pi = eps; verified = r.next() < eps; break;
      case 'every4': pi = 1 / 4; verified = oks % 4 === 0; break;
      case 'every4+dispute': pi = t.dispute ? 1 : 1 / 4; verified = t.dispute || oks % 4 === 0; break;
      case 'z14': {
        pi = piOf[state]; verified = r.next() < pi;
        if (verified) {
          recent = [...recent, run.wrong].slice(-5); streak = run.wrong ? 0 : streak + 1;
          if (state === 'normal' && recent.filter(Boolean).length >= 2) { state = 'tightened'; streak = 0; }
          else if (state === 'tightened' && streak >= 5) { state = 'normal'; streak = 0; recent = []; }
          else if (state === 'normal' && streak >= 10) { state = 'reduced'; streak = 0; }
          else if (state === 'reduced' && run.wrong) { state = 'normal'; streak = 0; recent = []; }
        }
        break;
      }
      default: throw new Error(`unknown policy ${policy}`);
    }
    items.push({ verified, propensity: pi, wrong: run.wrong });
    verifiedAt.push(verified);
  }
  return { items, verifiedAt };
}

// The naive (discrepant-analysis) estimate for dispute-only: unverified answers count as correct; Wilson CI on the count.
function naive(items) {
  const D = items.length, m = items.filter(i => i.verified && i.wrong).length, ci = wilson(m, D);
  return { rate: m / D, lo: ci.lo, hi: ci.hi, verified: items.filter(i => i.verified).length };
}

const windowsCovered = verifiedAt => {
  let n = 0, c = 0;
  for (let p = 0; p + WINDOW <= verifiedAt.length; p++) { n++; if (verifiedAt.slice(p, p + WINDOW).some(Boolean)) c++; }
  return n ? c / n : null;
};

export function simulate({ tasks = loadTasks(), draws = 20000, seed = 'verification-policy-sim-v1', epsilons = EPSILONS } = {}) {
  const N = tasks.length, out = [];
  const truth = Object.fromEntries(SOLVERS.map(s => {
    const D = tasks.filter(t => t.runs[s].delivered).length, M = tasks.filter(t => t.runs[s].wrong).length;
    return [s, { deliveries: D, wrong: M, theta: D ? M / D : null, Q: (D - M) / N, disputedDeliveries: tasks.filter(t => t.runs[s].delivered && t.dispute).length,
      wrongUndisputed: tasks.filter(t => t.runs[s].wrong && !t.dispute).length }];
  }));
  const specs = [{ policy: 'dispute-only', eps: null }, ...epsilons.map(eps => ({ policy: 'floor', eps })), ...epsilons.filter(e => e < 1).map(eps => ({ policy: 'random', eps })),
    { policy: 'every4', eps: null }, { policy: 'every4+dispute', eps: null }, { policy: 'z14', eps: null }];
  for (const { policy, eps } of specs) for (const s of SOLVERS) {
    const T = truth[s];
    const deterministicOrder = policy === 'dispute-only';
    const n = deterministicOrder ? 1 : draws, r = rng(seed, policy, eps ?? '-', s);
    let sum = 0, sumSq = 0, width = 0, cover = 0, calls = 0, wcov = 0, finite = 0;
    for (let d = 0; d < n; d++) {
      const ordered = policy.startsWith('every4') || policy === 'z14' ? blockShuffle(tasks, r) : tasks;
      const { items, verifiedAt } = runPolicy(policy, eps, ordered, s, r);
      const e = policy === 'dispute-only' ? naive(items) : ipwMissEstimate(items);
      sum += e.rate; sumSq += e.rate * e.rate; width += e.hi - e.lo; cover += T.theta >= e.lo - 1e-12 && T.theta <= e.hi + 1e-12 ? 1 : 0;
      calls += items.filter(i => i.verified).length; wcov += windowsCovered(verifiedAt); finite++;
    }
    const mean = sum / finite, sd = Math.sqrt(Math.max(0, sumSq / finite - mean * mean)), D = T.deliveries;
    const row = { policy, eps, solver: s, deliveries: D, theta: T.theta, meanEstimate: mean, bias: mean - T.theta, sd, meanWidth: width / finite, coverage: cover / finite,
      Q: T.Q, biasQ: -(D / N) * (mean - T.theta), widthQ: (D / N) * (width / finite), calls: calls / finite, usd: (calls / finite) * REFERENCE_USD_PER_CALL, windowsVerified: wcov / finite };
    row.usable = row.meanWidth <= USABLE.maxWidth && row.coverage >= USABLE.minCoverage && Math.abs(row.bias) <= USABLE.maxBias;
    out.push(row);
  }
  // The dev order, for the deterministic every-4th schedule (what the dev streams actually did, without flags).
  const devOrder = SOLVERS.map(s => { const { items } = runPolicy('every4', null, tasks, s, rng('x')); const e = ipwMissEstimate(items); return { solver: s, estimate: e.rate, lo: e.lo, hi: e.hi, verified: e.verified, theta: truth[s].theta }; });
  return { draws, seed, usable: USABLE, truth, rows: out, devOrder };
}

const f2 = x => (x == null ? '–' : x.toFixed(2)), f3 = x => (x == null ? '–' : (x >= 0 ? '+' : '') + x.toFixed(3)), pc = x => (x == null ? '–' : `${Math.round(100 * x)}%`);
const label = r => (r.policy === 'floor' ? `disputes + floor ε=${r.eps}` : r.policy === 'random' ? `random ε=${r.eps}` : r.policy === 'every4' ? 'every 4th (random order)' : r.policy === 'every4+dispute' ? 'every 4th + disputes' : r.policy === 'z14' ? 'Z1.4 switching' : 'dispute-only (naive)');

export function render(res) {
  const L = [];
  L.push('Truth (oracle, from the reference): deliveries, wrong, θ, Q, disputed deliveries, wrong deliveries without a dispute', '',
    '| solver | deliveries | wrong | θ | Q | disputed | wrong, undisputed |', '|---|---|---|---|---|---|---|');
  for (const [s, t] of Object.entries(res.truth)) L.push(`| ${s} | ${t.deliveries} | ${t.wrong} | ${f2(t.theta)} | ${f2(t.Q)} | ${t.disputedDeliveries} | ${t.wrongUndisputed} |`);
  for (const s of SOLVERS) {
    L.push('', `### ${s}`, '', '| policy | calls / 24 tasks | $ (ref.) | bias θ̂ | SD θ̂ | 95% CI width θ | coverage | bias Q̂ | CI width Q | windows verified | usable |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of res.rows.filter(x => x.solver === s)) L.push(`| ${label(r)} | ${r.calls.toFixed(1)} | ${r.usd.toFixed(2)} | ${f3(r.bias)} | ${f2(r.sd)} | ${f2(r.meanWidth)} | ${pc(r.coverage)} | ${f3(r.biasQ)} | ${f2(r.widthQ)} | ${pc(r.windowsVerified)} | ${r.usable ? 'yes' : 'no'} |`);
  }
  L.push('', 'Every-4th in the dev order (deterministic; one realisation):', '', '| solver | verified | θ̂ (as π = 1/4) | 95% CI | θ |', '|---|---|---|---|---|');
  for (const d of res.devOrder) L.push(`| ${d.solver} | ${d.verified} | ${f2(d.estimate)} | ${f2(d.lo)}–${f2(d.hi)} | ${f2(d.theta)} |`);
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), i = args.indexOf('--draws');
  const res = simulate({ draws: i >= 0 ? Number(args[i + 1]) : 20000 });
  console.log(args.includes('--json') ? JSON.stringify(res, null, 1) : render(res));
}
