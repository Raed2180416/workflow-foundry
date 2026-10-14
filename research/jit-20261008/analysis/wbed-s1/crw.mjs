// Rule CR-W of PREREG-WBED-SLICE1 §7.1 (steady-state cost ratios at K = 2), its planning numbers and its operating
// characteristics. $0, pure functions, no model call; the only data read are committed R0 records rows.
//
//   node research/jit-20261008/analysis/wbed-s1/crw.mjs plan [--json]    planning projection from R0 records (§7.1)
//   node research/jit-20261008/analysis/wbed-s1/crw.mjs oc [--json]      false-decision rates under the null (§7.1)
//   node research/jit-20261008/analysis/wbed-s1/crw.mjs anchors [--json] the committed runs behind σ_L = 0.5 (§7.1)
//   node research/jit-20261008/analysis/wbed-s1/crw.mjs kill [--json]    rung kill rule KR-1, per-lineage and pooled (§9.1)
//   node research/jit-20261008/analysis/wbed-s1/crw.mjs decide <armX> <armY> <runDirA> <runDirB> [--lineage-arms n] [--json]
//                                                                        the rule over the slice's stream run directories
//
// Why two verdicts (review of 2026-10-14, finding 4). At K = 2 the between-lineage variance of a lineage-built arm's cost
// (one compiled solver or one (e) build per lineage) cannot be estimated, and compiled cost varies 20–40× within one
// compiler (W-BED O4). A CI built from tasks alone is therefore valid only for the builds the two lineages happened to
// produce. So rule CR-W reports:
//   conditional  "X is cheaper (dearer) than Y on the builds realized in these lineages": V, K, F and C, where C's CI is
//                the wider of the two-stage cluster bootstrap and the task bootstrap widened by sqrt(Deff), ρ = 0.1, as in
//                experiments/jit/stats.mjs (the structure of DECISION_RULE, applied to the log ratio of summed costs);
//   process      "Haiku construction gives a cheaper (dearer) arm": the same, with a declared lineage floor σ_L = 0.5 per
//                lineage-built arm in the pair added in quadrature: SE_P² = SE_C² + n_L·σ_L²/K.
// Only the process verdict may be read as a claim about building with Haiku; the conditional one is about two builds.
//
// V also changed (review finding 9): pairs are the intersection of idx 3–23 rows both arms have in a stream, and each
// stream must keep at least 75% of its planned steady-state tasks (the truncation rule), so a spend stop late in a
// stream no longer voids every cost decision.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../../../../beds/lib/rng.mjs';
import { normQuantile, designEffect, RHO_PREREG, envFaultCheck } from '../../../../experiments/jit/stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../../../..');
export const CR_FAMILY = 3;                          // CR1, CR2, CR3 per rung (Bonferroni)
export const CR_LEVEL = 1 - 0.05 / CR_FAMILY;        // 98.33% two-sided
export const SIGMA_LINEAGE = 0.5;                    // declared floor: SD of a lineage-built arm's log-cost lineage effect
export const MIN_PAIRED_SHARE = 0.75;                // V: ≥ 75% of planned steady-state tasks paired in every stream
export const TRUNCATION_LIMIT = 0.25;                // §9.4 (ATTACK §5 decision 11): > 25% of planned tasks missing = invalid
export const STEADY = Object.freeze({ from: 3, to: 23 });
export const PLANNED_STEADY = STEADY.to - STEADY.from + 1;   // 21

// PREREG §6: steady-state $ of a row = costUsd minus compile spend (costBreakdown keys that start with 'compile', except
// 'compiled'); for a row with no breakdown, costUsd.
export function steadyUsd(row) {
  const b = row.costBreakdown;
  if (!b || !Object.keys(b).length) return row.costUsd ?? 0;
  return Object.entries(b).filter(([k]) => !(k.startsWith('compile') && k !== 'compiled')).reduce((s, [, v]) => s + v, 0);
}

// The pairs of one stream: the intersection, by idx inside the steady window, of the rows both arms have.
export function pairsOf(rowsX, rowsY, { stream = 'A', from = STEADY.from, to = STEADY.to, costX = steadyUsd, costY = steadyUsd } = {}) {
  const ys = new Map(rowsY.filter(r => r.idx >= from && r.idx <= to).map(r => [r.idx, r]));
  return rowsX.filter(r => r.idx >= from && r.idx <= to && ys.has(r.idx)).sort((a, b) => a.idx - b.idx)
    .map(r => ({ stream, idx: r.idx, x: costX(r), y: costY(ys.get(r.idx)) }));
}

const logRatio = ps => Math.log(ps.reduce((s, p) => s + p.x, 0) / ps.reduce((s, p) => s + p.y, 0));
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
const groupBy = (xs, f) => { const m = new Map(); for (const x of xs) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

// Percentile CIs of the pooled log ratio: the two-stage cluster bootstrap (streams, then tasks within each drawn stream) and
// the task bootstrap stratified by stream (each stream keeps its size).
export function bootstrapLogRatio(pairs, { iterations = 10000, seed = 'crw', level = CR_LEVEL } = {}) {
  const streams = [...groupBy(pairs, p => p.stream).values()], rc = rng(seed, 'cluster'), ri = rng(seed, 'iid');
  const a = (1 - level) / 2, cl = [], iid = [];
  for (let i = 0; i < iterations; i++) {
    let sx = 0, sy = 0;
    for (let j = 0; j < streams.length; j++) { const s = streams[rc.int(0, streams.length - 1)]; for (let t = 0; t < s.length; t++) { const p = s[rc.int(0, s.length - 1)]; sx += p.x; sy += p.y; } }
    cl.push(Math.log(sx / sy));
    let tx = 0, ty = 0;
    for (const s of streams) for (let t = 0; t < s.length; t++) { const p = s[ri.int(0, s.length - 1)]; tx += p.x; ty += p.y; }
    iid.push(Math.log(tx / ty));
  }
  cl.sort((x, y) => x - y); iid.sort((x, y) => x - y);
  return { cluster: { lo: quantile(cl, a), hi: quantile(cl, 1 - a) }, iid: { lo: quantile(iid, a), hi: quantile(iid, 1 - a) }, streams: streams.length, meanStreamSize: pairs.length / Math.max(1, streams.length) };
}

// Rule CR-W on one pair of arms (X vs Y) over K streams. lineageArms: how many of X, Y are built per lineage ((a) and (e):
// 1 each; (c) and (d): 0). invalid: arms that failed the env-fault or truncation rule (§9.3–§9.4).
export function crw(pairs, { lineageArms = 1, level = CR_LEVEL, rho = RHO_PREREG, iterations = 10000, seed = 'crw', sigmaLineage = SIGMA_LINEAGE,
  planned = PLANNED_STEADY, minShare = MIN_PAIRED_SHARE, invalid = [] } = {}) {
  const byStream = groupBy(pairs, p => p.stream), streams = [...byStream.keys()].sort();
  const need = Math.ceil(minShare * planned);
  const perStream = streams.map(s => { const ps = byStream.get(s); return { stream: s, n: ps.length, logRatio: logRatio(ps), ratio: Math.exp(logRatio(ps)) }; });
  const L = pairs.length ? logRatio(pairs) : NaN, sign = Math.sign(L);
  let ci = null;
  if (pairs.length) {
    const bs = bootstrapLogRatio(pairs, { iterations, seed, level });
    const deff = lineageArms > 0 ? designEffect(bs.meanStreamSize, rho) : 1, w = Math.sqrt(deff);
    const widened = { lo: L - (L - bs.iid.lo) * w, hi: L + (bs.iid.hi - L) * w };
    const conditional = { lo: Math.min(bs.cluster.lo, widened.lo), hi: Math.max(bs.cluster.hi, widened.hi) };
    const z = normQuantile(1 - (1 - level) / 2), sigmaP = sigmaLineage * Math.sqrt(lineageArms / Math.max(1, streams.length));
    const process = { lo: L - Math.hypot(L - conditional.lo, z * sigmaP), hi: L + Math.hypot(conditional.hi - L, z * sigmaP) };
    ci = { level, deff, rho: lineageArms > 0 ? rho : 0, clusterBootstrap: bs.cluster, iidBootstrap: bs.iid, widened, conditional, process, sigmaLineage, lineageArms, sigmaP };
  }
  const excl = c => !!c && (c.lo > 0 || c.hi < 0);
  const checks = {
    V: !invalid.length && perStream.every(s => s.n >= need),
    K: streams.length >= 2,
    F: pairs.length > 0 && sign !== 0 && perStream.every(s => Math.sign(s.logRatio) === sign),
    C: excl(ci?.conditional),
    P: excl(ci?.process),
  };
  const word = sign < 0 ? 'cheaper' : 'dearer';
  const verdictOf = key => (invalid.length ? 'invalid' : checks.V && checks.K && checks.F && checks[key] ? `X ${word} than Y` : 'directional, no decision');
  return { pooled: { n: pairs.length, logRatio: L, ratio: Math.exp(L) }, perStream, need, checks, ci,
    verdict: { conditional: verdictOf('C'), process: verdictOf('P') }, failed: Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k) };
}

// The rule over K stream run directories (stream.mjs layout; one directory per lineage, in stream order A, B, …). Per arm
// and stream: "invalid: env faults" by stats.mjs envFaultCheck, else "invalid: truncated" when the rows missing without a
// fault line exceed 25% of the planned tasks (§9.4). lineageArms is declared per pair (§7.1: CR1 1, CR2 1, CR3 2); by
// default it counts the jit: arms, because a static: spec cannot say whether its script was built per lineage.
export async function decideRuns(armX, armY, dirs, { lineageArms = null, planned = null, from = STEADY.from, to = STEADY.to, ...opts } = {}) {
  const { loadRun } = await import('../../../../experiments/jit/report.mjs');
  const pairs = [], invalid = [], validity = [];
  for (const [i, dir] of dirs.entries()) {
    const stream = String.fromCharCode(65 + i), arms = loadRun(dir), A = arms.find(a => a.meta.spec === armX), B = arms.find(a => a.meta.spec === armY);
    if (!A || !B) throw new Error(`${dir}: missing arm ${!A ? armX : armY}`);
    const N = planned ?? Math.max(0, ...arms.flatMap(a => a.rows.map(r => r.idx + 1)));
    for (const [arm, spec] of [[A, armX], [B, armY]]) {
      const ef = envFaultCheck({ ...arm, planned: N, kind: arm.meta.kind }), truncated = N ? ef.missingOther.length / N : 0;
      const status = ef.invalid ? 'invalid: env faults' : truncated > TRUNCATION_LIMIT ? 'invalid: truncated' : 'valid';
      validity.push({ arm: spec, stream, planned: N, impaired: ef.impaired, missingOther: ef.missingOther.length, status });
      if (status !== 'valid') invalid.push(`${spec}@${stream}: ${status}`);
    }
    pairs.push(...pairsOf(A.rows, B.rows, { stream, from, to }));
  }
  const n = lineageArms ?? [armX, armY].filter(s => /^jit:/.test(s)).length;
  return { armX, armY, lineageArms: n, validity, ...crw(pairs, { ...opts, lineageArms: n, planned: to - from + 1, invalid }) };
}

// ------------------------------------------------------------------------------------------------ operating characteristics
// The review's null model (finding 4): per task a shared log difficulty t ~ N(0, 0.3); per stream a lineage effect
// u ~ N(0, σ_L) on each lineage-built arm; per task and arm noise e ~ N(0, σ_e); x = exp(t + u_X + e), y = exp(t + u_Y + e').
// No arm is cheaper as a process. A conditional decision is wrong when its sign differs from the realized builds' effect,
// log(mean_s e^{u_X,s}) − log(mean_s e^{u_Y,s}) (a decision when that is exactly 0, σ_L = 0, is wrong).
export function simulate({ sigmaLineage, sigmaTask = 0.5, lineageArms = 1, trials = 1000, iterations = 300, m = PLANNED_STEADY, K = 2, seed = 'crw-oc', floor = SIGMA_LINEAGE, level = CR_LEVEL } = {}) {
  const r = rng(seed, sigmaLineage, sigmaTask, lineageArms, m, K);
  let condAny = 0, condWrong = 0, procAny = 0;
  for (let i = 0; i < trials; i++) {
    const uX = Array.from({ length: K }, () => (lineageArms >= 1 ? r.normal(0, sigmaLineage) : 0));
    const uY = Array.from({ length: K }, () => (lineageArms >= 2 ? r.normal(0, sigmaLineage) : 0));
    const pairs = [];
    for (let s = 0; s < K; s++) for (let j = 0; j < m; j++) { const t = r.normal(0, 0.3); pairs.push({ stream: String(s), idx: j, x: Math.exp(t + uX[s] + r.normal(0, sigmaTask)), y: Math.exp(t + uY[s] + r.normal(0, sigmaTask)) }); }
    const res = crw(pairs, { lineageArms, iterations, seed: `${seed}:${i}`, sigmaLineage: floor, planned: m, level });
    const truth = Math.log(uX.reduce((a, u) => a + Math.exp(u), 0) / K) - Math.log(uY.reduce((a, u) => a + Math.exp(u), 0) / K);
    const decided = res.verdict.conditional !== 'directional, no decision', sign = Math.sign(res.pooled.logRatio);
    if (decided) { condAny++; if (truth === 0 || Math.sign(truth) !== sign) condWrong++; }
    if (res.verdict.process !== 'directional, no decision') procAny++;
  }
  return { sigmaLineage, sigmaTask, lineageArms, trials, iterations, m, K, floor, level, conditionalDecided: condAny / trials, conditionalWrongSign: condWrong / trials, processDecided: procAny / trials };
}

export function ocTable({ trials = 1000, iterations = 300 } = {}) {
  const out = [];
  for (const lineageArms of [1, 2]) for (const sigmaLineage of [0, 0.25, 0.5, 1.0]) for (const sigmaTask of [0.5, 0.75]) out.push(simulate({ sigmaLineage, sigmaTask, lineageArms, trials, iterations }));
  return out;
}

// ------------------------------------------------------------------------------------------------ planning projection
// PREREG-stream §0.2's method on R0 records (dev 225–236; H/H truncated at 12, so 9 steady-state pairs): the task-bootstrap
// SD of the log ratio, scaled to K = 2 streams × 21 tasks and widened by sqrt(Deff) at ρ = 0.1; then the decidable ratios at
// 80% power for the conditional and the process verdicts. Records, not R1, and one lineage: a planning number only.
const RUNS = path.join(REPO, 'research/jit-20261008/runs');
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export function r0Pairs() {
  const hh = readJsonl(path.join(RUNS, 'jit-r0-records/jit-claude-haiku-5-5--claude-haiku-5-5/results.jsonl'));
  const ag = readJsonl(path.join(RUNS, 'jit-r0-records/agent-claude-haiku-5-5/results.jsonl'));
  return pairsOf(hh, ag, { stream: 'r0' });
}
export function planning({ pairs = r0Pairs(), iterations = 20000, seed = 'crw-plan', K = 2, m = PLANNED_STEADY, rho = RHO_PREREG, sigmaLineage = SIGMA_LINEAGE, power = 0.8 } = {}) {
  const r = rng(seed), logs = [];
  for (let b = 0; b < iterations; b++) { let sx = 0, sy = 0; for (let t = 0; t < pairs.length; t++) { const p = pairs[r.int(0, pairs.length - 1)]; sx += p.x; sy += p.y; } logs.push(Math.log(sx / sy)); }
  const mean = logs.reduce((a, v) => a + v, 0) / logs.length, sd = Math.sqrt(logs.reduce((a, v) => a + (v - mean) ** 2, 0) / (logs.length - 1));
  const L = logRatio(pairs), deff = designEffect(m, rho), seC = sd * Math.sqrt(pairs.length / (K * m)) * Math.sqrt(deff);
  const zB = normQuantile(1 - (1 - CR_LEVEL) / 2), z95 = normQuantile(0.975), zP = normQuantile(power);
  const seP = n => Math.hypot(seC, sigmaLineage * Math.sqrt(n / K));
  const ci = (z, se) => ({ lo: Math.exp(L - z * se), hi: Math.exp(L + z * se) });
  const mde = se => ({ below: Math.exp(-(zB + zP) * se), above: Math.exp((zB + zP) * se) });
  const mean$ = k => pairs.reduce((s, p) => s + p[k], 0) / pairs.length;
  return { pairs: pairs.length, hhSteadyUsdPerTask: mean$('x'), agentUsdPerTask: mean$('y'), ratio: Math.exp(L), logSdK1: sd, K, m, rho, deff,
    conditional: { se: seC, ci9833: ci(zB, seC), ci95: ci(z95, seC), mde80: mde(seC) },
    process: { sigmaLineage, oneLineageArm: { se: seP(1), ci9833: ci(zB, seP(1)), mde80: mde(seP(1)) }, twoLineageArms: { se: seP(2), ci9833: ci(zB, seP(2)), mde80: mde(seP(2)) } } };
}

// The anchors behind σ_L = 0.5 (§7.1): the steady-state log cost ratio of a JIT arm against the Haiku agent, for the same
// arm on the same family in two committed runs (and for three compilers on the same seeds). Each difference also holds
// task noise and config changes, so it overstates the lineage effect.
export const ANCHOR_RUNS = Object.freeze([
  ['jit-dev-records-1', 'jit-claude-haiku-5-5--claude-haiku-5-5'], ['jit-r0-records', 'jit-claude-haiku-5-5--claude-haiku-5-5'],
  ['jit-dev-records-1', 'jit-claude-sonnet-5-5--claude-haiku-5-5'], ['jit-dev-records-1', 'jit-claude-opus-5-5--claude-haiku-5-5'],
  ['jit-dev-kinetics-1', 'jit-claude-haiku-5-5--claude-haiku-5-5'], ['jit-dev-kinetics-1', 'jit-claude-sonnet-5-5--claude-haiku-5-5'],
  ['jit-dev-kinetics-1', 'jit-claude-opus-5-5--claude-haiku-5-5'], ['jit-r0-kinetics', 'jit-claude-opus-5-5--claude-haiku-5-5']]);
export function lineageAnchors() {
  return ANCHOR_RUNS.map(([run, slug]) => {
    const ps = pairsOf(readJsonl(path.join(RUNS, run, slug, 'results.jsonl')), readJsonl(path.join(RUNS, run, 'agent-claude-haiku-5-5', 'results.jsonl')), { stream: run, to: Infinity });
    return { run, arm: slug, pairs: ps.length, logRatio: ps.length ? logRatio(ps) : null };
  });
}

// ------------------------------------------------------------------------------------------------ rung kill rule KR-1
// PAUSE §6 per-lineage form: H/H's second-half success (12 tasks) is more than 10 points below the reference's (≥ 2 of 12)
// in both lineages; W-BED §3.1's pooled reading: ≥ 3 of 24 pooled. Independent binomials (an upper bound on the false kill
// when the two arms' outcomes are positively correlated per task).
const lchoose = (n, k) => { let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; };
const pmf = (k, n, p) => Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
const pAtLeastBelow = (n, gap, pRef, pJit) => { let s = 0; for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) if (b - a >= gap) s += pmf(a, n, pJit) * pmf(b, n, pRef); return s; };
export function killRuleTable({ pRefs = [0.6, 0.8, 0.9], gaps = [0, 0.1, 0.2, 0.3] } = {}) {
  const out = [];
  for (const d of gaps) for (const pRef of pRefs) {
    const pJit = Math.max(0.001, pRef - d), one = pAtLeastBelow(12, 2, pRef, pJit);
    out.push({ trueGap: -d, pRef, perLineage: one * one, pooled: pAtLeastBelow(24, 3, pRef, pJit) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] ?? 'plan', json = process.argv.includes('--json');
  const pc = x => `${(100 * x).toFixed(1)}%`, f2 = x => x.toFixed(2), f3 = x => x.toFixed(3);
  if (cmd === 'plan') {
    const p = planning();
    if (json) console.log(JSON.stringify(p, null, 1));
    else console.log([`R0 records, ${p.pairs} steady-state pairs: H/H $${p.hhSteadyUsdPerTask.toFixed(4)} vs Haiku agent $${p.agentUsdPerTask.toFixed(4)} per task, ratio ${f2(p.ratio)}; task-bootstrap SD(log) ${f3(p.logSdK1)}`,
      `conditional (these builds): SE(log) at K = 2 ${f3(p.conditional.se)}; 98.33% CI ${f2(p.conditional.ci9833.lo)}–${f2(p.conditional.ci9833.hi)}; decidable at 80% power: ≤ ${f2(p.conditional.mde80.below)} or ≥ ${f2(p.conditional.mde80.above)}`,
      `process, one lineage-built arm (CR1, CR2): SE ${f3(p.process.oneLineageArm.se)}; 98.33% CI ${f2(p.process.oneLineageArm.ci9833.lo)}–${f2(p.process.oneLineageArm.ci9833.hi)}; decidable: ≤ ${f2(p.process.oneLineageArm.mde80.below)} or ≥ ${f2(p.process.oneLineageArm.mde80.above)}`,
      `process, two lineage-built arms (CR3): SE ${f3(p.process.twoLineageArms.se)}; decidable: ≤ ${f2(p.process.twoLineageArms.mde80.below)} or ≥ ${f2(p.process.twoLineageArms.mde80.above)}`].join('\n'));
  } else if (cmd === 'oc') {
    const t = ocTable({ trials: Number(process.env.CRW_TRIALS ?? 1000) });
    if (json) console.log(JSON.stringify(t, null, 1));
    else { console.log('| lineage-built arms | σ_L (true) | σ_task | conditional decided | conditional wrong sign | process decided (floor 0.5) |\n|---|---|---|---|---|---|');
      for (const r of t) console.log(`| ${r.lineageArms} | ${r.sigmaLineage} | ${r.sigmaTask} | ${pc(r.conditionalDecided)} | ${pc(r.conditionalWrongSign)} | ${pc(r.processDecided)} |`); }
  } else if (cmd === 'anchors') {
    const t = lineageAnchors();
    if (json) console.log(JSON.stringify(t, null, 1));
    else for (const r of t) console.log(`${r.run} ${r.arm}: ${r.pairs} pairs, log ratio vs the Haiku agent ${r.logRatio?.toFixed(3)}`);
  } else if (cmd === 'kill') {
    const t = killRuleTable();
    if (json) console.log(JSON.stringify(t, null, 1));
    else for (const r of t) console.log(`gap ${r.trueGap} pRef ${r.pRef}: per-lineage ${pc(r.perLineage)}, pooled ${pc(r.pooled)}`);
  } else if (cmd === 'decide' && process.argv.length >= 7) {
    const args = process.argv.slice(3).filter(a => a !== '--json'), li = args.indexOf('--lineage-arms');
    const lineageArms = li >= 0 ? Number(args.splice(li, 2)[1]) : null;
    const [armX, armY, ...dirs] = args;
    const r = await decideRuns(armX, armY, dirs.map(d => path.resolve(d)), { lineageArms });
    if (json) console.log(JSON.stringify(r, null, 1));
    else console.log([`${armX} vs ${armY} (lineage-built arms: ${r.lineageArms})`, `conditional (these builds): ${r.verdict.conditional}; process (σ_L ${SIGMA_LINEAGE}): ${r.verdict.process}`,
      `pooled ratio ${r.pooled.ratio.toFixed(3)} over ${r.pooled.n} pairs; per stream ${r.perStream.map(s => `${s.stream} ${s.ratio.toFixed(3)} (n ${s.n})`).join(', ')}`,
      r.ci ? `98.33% CI of the ratio: conditional ${Math.exp(r.ci.conditional.lo).toFixed(2)}–${Math.exp(r.ci.conditional.hi).toFixed(2)}; process ${Math.exp(r.ci.process.lo).toFixed(2)}–${Math.exp(r.ci.process.hi).toFixed(2)}` : 'no pairs',
      `checks ${JSON.stringify(r.checks)}; validity ${r.validity.map(v => `${v.arm}@${v.stream} ${v.status}`).join('; ')}`].join('\n'));
  } else { console.error('usage: crw.mjs plan|oc|kill [--json] | crw.mjs decide <armX> <armY> <runDirA> <runDirB>... [--lineage-arms n] [--json]'); process.exit(2); }
}
