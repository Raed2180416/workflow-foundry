// D1: shortcut audit (DESIGN §7 M0 item 10, §6 "the router learns size, not need"). Does logInputTokens alone reproduce the
// preregistered hypotheses table (PREREG-NEED-V1 §1.1 = prereg/stages.json jobs[].hypothesis)? If one token threshold sorts the
// table into workflow and no-workflow, the table is a size table in disguise and the router's structure features cannot be
// told apart from a size rule on it; the jobs a threshold gets wrong are exactly the shortcut breakers that must carry the test.
//   Two token measures, same method. `router`: logInputTokens as features.mjs computes it (median over example seeds 601-603, mean over
//            the census difficulties inside the job band; the anchor beds computed now), the input the router actually reads.
//            `maxExample`: the largest example input over the nine example seeds (stages.json maxExampleTokens, ceil(bytes/4)), the
//            measure agent-O budgets use. For each: the best single threshold on log10(1 + tokens) for the N = 1 and N = 10 class
//            hypotheses (balanced accuracy, ties to the larger threshold as the preregistration says), the same fitted
//            leave-one-cluster-out, fitted on TRAIN and applied to the held-out jobs, and the fixed size rule of DESIGN §6
//            (< 2K direct-H, 2-30K agent-H, > 30K construct-H) as class and as mode.
//   Fan-out  on the `router` rows: fan-out only (maxListLength) and the preregistered OR rule H0 = tokens >= theta_tok OR
//            maxListLength >= theta_fan, each best-fit and leave-one-cluster-out.
// The hypotheses are expectations written before any label, not labels: "reproduces" means agrees with the author's expectations.
// Evidence grade: dev (no archived rows; the table is itself unmeasured).
import { loadStages, loadCensus } from './census.mjs';
import { round, mean } from './common.mjs';

export const SIZE_RULE = Object.freeze({ directBelow: 2000, constructAbove: 30000, source: 'DESIGN §6: under 2K tokens direct-H, 2-30K agent-H, over 30K construct-H' });
const sizeMode = tokens => (tokens < SIZE_RULE.directBelow ? 'direct-H' : tokens > SIZE_RULE.constructAbove ? 'construct-H' : 'agent-H');
const WF = 'workflow';

/** Jobs with a measured token count and a definite class hypothesis at both N (pending, forced and unmeasured jobs are left out). */
export function hypothesisJobs(stages) {
  return stages.jobs.filter(j => ['train', 'heldout'].includes(j.split) && Number.isFinite(j.maxExampleTokens) && j.hypothesis
    && [j.hypothesis.n1?.class, j.hypothesis.n10?.class].every(c => c === WF || c === 'no-workflow'))
    .map(j => ({ id: j.id, cluster: j.cluster, split: j.split, family: j.family, band: j.band, tokens: j.maxExampleTokens, x: Math.log10(1 + j.maxExampleTokens),
      n1: j.hypothesis.n1, n10: j.hypothesis.n10 }));
}

const confusion = (pts, predict, truth) => {
  let tp = 0, fp = 0, tn = 0, fn = 0; const wrong = [];
  for (const p of pts) {
    const pr = predict(p), t = truth(p) === WF;
    if (pr && t) tp++; else if (pr && !t) { fp++; wrong.push(p.id); } else if (!pr && !t) tn++; else { fn++; wrong.push(p.id); }
  }
  const rec = tp + fn ? tp / (tp + fn) : null, spec = tn + fp ? tn / (tn + fp) : null;
  return { tp, fp, tn, fn, accuracy: pts.length ? (tp + tn) / pts.length : null, balancedAccuracy: rec !== null && spec !== null ? (rec + spec) / 2 : null, recall: rec, specificity: spec, wrong };
};

/** Best single threshold on feature `get` (predict workflow when value >= theta): maximum balanced accuracy, ties to the larger theta. */
export function bestThreshold(pts, get, truth) {
  const xs = [...new Set(pts.map(get))].sort((a, b) => a - b);
  const cands = [-Infinity, ...xs.slice(1).map((v, i) => (v + xs[i]) / 2), Infinity];
  let best = null;
  for (const theta of cands) {
    const c = confusion(pts, p => get(p) >= theta, truth);
    const ba = c.balancedAccuracy ?? -1;
    if (!best || ba > best.ba + 1e-12 || (Math.abs(ba - best.ba) <= 1e-12 && theta > best.theta)) best = { theta, ba, ...c };
  }
  return { ...best, thetaTokens: Number.isFinite(best.theta) ? Math.round(10 ** best.theta - 1) : best.theta, perfect: best.wrong.length === 0 };
}

/** The OR rule over two features: best (theta_a, theta_b) by balanced accuracy, ties to the larger thetas (a first). */
export function bestOrRule(pts, getA, getB, truth) {
  const vals = get => { const xs = [...new Set(pts.map(get))].sort((a, b) => a - b); return [-Infinity, ...xs.slice(1).map((v, i) => (v + xs[i]) / 2), Infinity]; };
  let best = null;
  for (const ta of vals(getA)) for (const tb of vals(getB)) {
    const c = confusion(pts, p => getA(p) >= ta || getB(p) >= tb, truth), ba = c.balancedAccuracy ?? -1;
    const better = !best || ba > best.ba + 1e-12 || (Math.abs(ba - best.ba) <= 1e-12 && (ta > best.thetaA || (ta === best.thetaA && tb > best.thetaB)));
    if (better) best = { thetaA: ta, thetaB: tb, ba, ...c };
  }
  return { ...best, perfect: best.wrong.length === 0 };
}

/** Leave one cluster out: fit the token threshold on the other clusters, predict the held-out cluster's jobs. */
export function locoThreshold(pts, get, truth) {
  const clusters = [...new Set(pts.map(p => p.cluster))];
  const predicted = new Map();
  for (const c of clusters) {
    const fit = bestThreshold(pts.filter(p => p.cluster !== c), get, truth);
    for (const p of pts.filter(q => q.cluster === c)) predicted.set(p.id, get(p) >= fit.theta);
  }
  return confusion(pts, p => predicted.get(p.id), truth);
}

/** Leave one cluster out for the OR rule. */
export function locoOrRule(pts, getA, getB, truth) {
  const predicted = new Map();
  for (const c of new Set(pts.map(p => p.cluster))) {
    const fit = bestOrRule(pts.filter(p => p.cluster !== c), getA, getB, truth);
    for (const p of pts.filter(q => q.cluster === c)) predicted.set(p.id, getA(p) >= fit.thetaA || getB(p) >= fit.thetaB);
  }
  return confusion(pts, p => predicted.get(p.id), truth);
}

const num = x => (Number.isFinite(x) ? x : x > 0 ? '+inf' : '-inf');   // JSON has no Infinity
const slim = r => ({ theta: num(r.theta), thetaTokens: num(r.thetaTokens), balancedAccuracy: round(r.ba, 3), accuracy: round(r.accuracy, 3), tp: r.tp, fp: r.fp, tn: r.tn, fn: r.fn, wrong: r.wrong, perfect: r.perfect });
const slimC = r => ({ balancedAccuracy: round(r.balancedAccuracy, 3), accuracy: round(r.accuracy, 3), tp: r.tp, fp: r.fp, tn: r.tn, fn: r.fn, wrong: r.wrong });

/** Census-style feature row of a job: mean over the census difficulties (3, 5) inside its band, else the nearest one. */
export function jobFeatureRow(job, featuresByFamily, bedOf = f => f) {
  const fam = featuresByFamily.get(bedOf(job.family));
  if (!fam) return null;
  const inside = [3, 5].filter(d => fam.has(d) && job.band.includes(d));
  const mid = mean(job.band);
  const ds = inside.length ? inside : [[3, 5].filter(d => fam.has(d)).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0]].filter(Boolean);
  if (!ds.length) return null;
  const pick = key => mean(ds.map(d => fam.get(d)[key]));
  return { difficulties: ds, proxy: !inside.length, logInputTokens: pick('logInputTokens'), maxListLength: pick('maxListLength') };
}

/** The bed ids whose features are computed from the anchor beds when the census has no entry (job family -> bed directory). */
export const ANCHOR_BEDS = Object.freeze({ 'need-r0pad': 'need-r0pad', 'need-r3mini': 'need-r3mini', 'need-stage': 'need-stage', 'codefix-notests': 'need-codefix-noverifier', 'need-qa': 'need-qa', 'need-constraint': 'need-constraint' });

/** featuresByFamily: Map(bed family -> Map(difficulty -> features)) from the census plus `anchors` ({bed: {3: features, 5: features}}). */
export function featureIndex(census, anchors = {}) {
  const idx = new Map();
  for (const e of census.entries) (idx.get(e.family) ?? idx.set(e.family, new Map()).get(e.family)).set(e.difficulty, e.features);
  for (const [bed, byD] of Object.entries(anchors)) for (const [d, f] of Object.entries(byD)) (idx.get(bed) ?? idx.set(bed, new Map()).get(bed)).set(Number(d), f);
  return idx;
}

/** One token measure's tables for one hypothesis column (best threshold, LOCO, TRAIN-fit on held-out, the fixed size rule). */
function tokenTable(pts, getX, tokensOf, N) {
  const truth = p => p[N].class;
  const fit = bestThreshold(pts, getX, truth);
  const train = pts.filter(p => p.split === 'train'), held = pts.filter(p => p.split === 'heldout');
  const trainFit = bestThreshold(train, getX, truth);
  const sizeClass = confusion(pts, p => tokensOf(p) > SIZE_RULE.constructAbove, truth);
  return {
    jobs: pts.length, workflowJobs: pts.filter(p => truth(p) === WF).length, tokenThreshold: slim(fit), loco: slimC(locoThreshold(pts, getX, truth)),
    trainToHeldout: { trainTheta: num(trainFit.theta), trainThetaTokens: num(trainFit.thetaTokens), trainBalancedAccuracy: round(trainFit.ba, 3), heldOutJobs: held.length, ...slimC(confusion(held, p => getX(p) >= trainFit.theta, truth)) },
    fixedSizeRule: { ...slimC(sizeClass), modeAgreement: pts.filter(p => sizeMode(tokensOf(p)) === p[N].mode).length, modes: pts.length },
    tokenOrder: [...pts].sort((a, b) => getX(a) - getX(b)).map(p => `${p.id} (${Math.round(tokensOf(p))})${truth(p) === WF ? ' W' : ''}`),
  };
}

export function runD1({ stagesInfo = loadStages(), census = loadCensus(), anchors = {} } = {}) {
  const jobs = hypothesisJobs(stagesInfo.stages);
  const idx = featureIndex(census, anchors);
  const bedOf = f => ANCHOR_BEDS[f] ?? f;
  const rows = [];
  for (const j of jobs) { const row = jobFeatureRow(j, idx, bedOf); if (row) rows.push({ ...j, ...row, computedFromBed: !!ANCHOR_BEDS[j.family] }); }
  const missing = jobs.filter(j => !rows.some(r => r.id === j.id)).map(j => j.id);
  const router = {}, maxExample = {}, fan = {};
  for (const N of ['n1', 'n10']) {
    const truth = p => p[N].class;
    router[N] = tokenTable(rows, p => p.logInputTokens, p => 10 ** p.logInputTokens - 1, N);
    maxExample[N] = tokenTable(jobs, p => p.x, p => p.tokens, N);
    const orFit = bestOrRule(rows, p => p.logInputTokens, p => p.maxListLength, truth), orLoco = locoOrRule(rows, p => p.logInputTokens, p => p.maxListLength, truth);
    fan[N] = {
      jobs: rows.length, workflowJobs: rows.filter(p => truth(p) === WF).length, fanOutOnly: slim(bestThreshold(rows, p => p.maxListLength, truth)),
      orRule: { thetaTok: num(orFit.thetaA), thetaTokTokens: num(Math.round(10 ** orFit.thetaA - 1)), thetaFan: num(orFit.thetaB), thetaFanItems: num(Math.round(10 ** orFit.thetaB - 1)),
        balancedAccuracy: round(orFit.ba, 3), accuracy: round(orFit.accuracy, 3), tp: orFit.tp, fp: orFit.fp, tn: orFit.tn, fn: orFit.fn, wrong: orFit.wrong, perfect: orFit.perfect, loco: slimC(orLoco) },
    };
  }
  const R1 = router.n1.tokenThreshold, R10 = router.n10.tokenThreshold, M1 = maxExample.n1.tokenThreshold, M10 = maxExample.n10.tokenThreshold;
  return {
    id: 'D1', grade: 'dev', question: 'Does logInputTokens alone reproduce the hypotheses table?',
    sources: [stagesInfo.source, census.source],
    note: 'The hypotheses are expectations written before any label (PREREG-NEED-V1 §1.1), not labels. Jobs: TRAIN and HELD-OUT with a measured max example token count; forced, pending, conditional and unmeasured jobs are left out. '
      + 'Two token measures: `router` is logInputTokens as features.mjs computes it (median over example seeds 601-603, mean over the census difficulties inside the job band), the input the router reads; `maxExample` is the largest example input over the nine example seeds (stages.json), the measure agent-O budgets use.',
    jobs: jobs.map(j => ({ id: j.id, cluster: j.cluster, split: j.split, tokens: j.tokens, n1: j.n1, n10: j.n10 })),
    featureRows: rows.map(r => ({ id: r.id, family: r.family, difficulties: r.difficulties, proxy: r.proxy, computedFromBed: r.computedFromBed, logInputTokens: round(r.logInputTokens, 4), tokens: Math.round(10 ** r.logInputTokens - 1), maxListLength: round(r.maxListLength, 4) })),
    router, maxExample, withFanOut: fan, jobsWithoutFeatureRow: missing,
    summary: {
      jobs: jobs.length, jobsWithFeatureRow: rows.length,
      router: { reproducedN1: R1.perfect, reproducedN10: R10.perfect, balancedAccuracyN1: R1.balancedAccuracy, balancedAccuracyN10: R10.balancedAccuracy, errorsN1: R1.wrong, errorsN10: R10.wrong },
      maxExample: { reproducedN1: M1.perfect, reproducedN10: M10.perfect, balancedAccuracyN1: M1.balancedAccuracy, balancedAccuracyN10: M10.balancedAccuracy, errorsN1: M1.wrong, errorsN10: M10.wrong },
      orRuleReproducedN1: fan.n1.orRule.perfect, orRuleReproducedN10: fan.n10.orRule.perfect, orRuleErrorsN1: fan.n1.orRule.wrong, orRuleErrorsN10: fan.n10.orRule.wrong,
    },
  };
}
