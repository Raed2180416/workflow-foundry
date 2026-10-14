// D1: shortcut audit (DESIGN §7 M0 item 10, §6 "the router learns size, not need"). Does logInputTokens alone reproduce the
// preregistered hypotheses table (PREREG-NEED-V1 §1.1 = prereg/stages.json jobs[].hypothesis)? If one token threshold sorts the
// table into workflow and no-workflow, the table is a size table in disguise and the router's structure features cannot be
// told apart from a size rule on it; the jobs a threshold gets wrong are exactly the shortcut breakers that must carry the test.
//   Table 1  every TRAIN and HELD-OUT job with a measured max example token count (stages.json maxExampleTokens, ceil(bytes/4)):
//            best single threshold on log10(1 + tokens) for the N = 1 and N = 10 class hypotheses (balanced accuracy, ties to the
//            larger threshold as the preregistration says), the same fitted leave-one-cluster-out, and the fixed size rule of
//            DESIGN §6 (< 2K direct-H, 2-30K agent-H, > 30K construct-H) as class and as mode.
//   Table 2  the jobs that also have a feature row (census d3/d5 or the anchor beds computed now): token-only, fan-out-only
//            (maxListLength) and the preregistered OR rule H0 = tokens >= theta_tok OR maxListLength >= theta_fan, each best-fit.
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

export function runD1({ stagesInfo = loadStages(), census = loadCensus(), anchors = {} } = {}) {
  const jobs = hypothesisJobs(stagesInfo.stages);
  const tables = {};
  const rules = {};
  for (const N of ['n1', 'n10']) {
    const truth = p => p[N].class;
    const nWf = jobs.filter(p => truth(p) === WF).length;
    const fit = bestThreshold(jobs, p => p.x, truth);
    const sizeClass = confusion(jobs, p => p.tokens > SIZE_RULE.constructAbove, truth);
    const modeAgree = jobs.filter(p => sizeMode(p.tokens) === p[N].mode).length;
    const train = jobs.filter(p => p.split === 'train'), held = jobs.filter(p => p.split === 'heldout');
    const trainFit = bestThreshold(train, p => p.x, truth);
    const heldOut = confusion(held, p => p.x >= trainFit.theta, truth);
    tables[N] = {
      jobs: jobs.length, workflowJobs: nWf, noWorkflowJobs: jobs.length - nWf,
      tokenThreshold: slim(fit), loco: slimC(locoThreshold(jobs, p => p.x, truth)),
      trainToHeldout: { trainTheta: num(trainFit.theta), trainThetaTokens: num(trainFit.thetaTokens), trainBalancedAccuracy: round(trainFit.ba, 3), heldOutJobs: held.length, ...slimC(heldOut) },
      tokenOrder: [...jobs].sort((a, b) => a.tokens - b.tokens).map(p => `${p.id} (${p.tokens})${p[N].class === WF ? ' W' : ''}`),
      fixedSizeRule: { ...slimC(sizeClass), modeAgreement: modeAgree, modes: jobs.length },
      majorityBalancedAccuracy: 0.5,
      perJob: jobs.map(p => ({ id: p.id, tokens: p.tokens, hypothesis: p[N].class, mode: p[N].mode, byThreshold: p.x >= fit.theta ? WF : 'no-workflow', bySizeRule: sizeMode(p.tokens) })),
    };
  }
  // Table 2: jobs with a census-style feature row.
  const idx = featureIndex(census, anchors);
  const bedOf = f => ANCHOR_BEDS[f] ?? f;
  const rows = [];
  for (const j of jobs) { const row = jobFeatureRow(j, idx, bedOf); if (row) rows.push({ ...j, ...row, computedFromBed: !!ANCHOR_BEDS[j.family] }); }
  const missing = jobs.filter(j => !rows.some(r => r.id === j.id)).map(j => j.id);
  for (const N of ['n1', 'n10']) {
    const truth = p => p[N].class;
    rules[N] = {
      jobs: rows.length, workflowJobs: rows.filter(p => truth(p) === WF).length,
      tokenOnly: slim(bestThreshold(rows, p => p.logInputTokens, truth)),
      fanOutOnly: slim(bestThreshold(rows, p => p.maxListLength, truth)),
      orRule: (() => {
        const r = bestOrRule(rows, p => p.logInputTokens, p => p.maxListLength, truth);
        const loco = locoOrRule(rows, p => p.logInputTokens, p => p.maxListLength, truth);
        return { thetaTok: num(r.thetaA), thetaTokTokens: num(Math.round(10 ** r.thetaA - 1)), thetaFan: num(r.thetaB), thetaFanItems: num(Math.round(10 ** r.thetaB - 1)),
          balancedAccuracy: round(r.ba, 3), accuracy: round(r.accuracy, 3), tp: r.tp, fp: r.fp, tn: r.tn, fn: r.fn, wrong: r.wrong, perfect: r.perfect, loco: slimC(loco) };
      })(),
    };
  }
  const perfect1 = tables.n1.tokenThreshold.perfect, perfect10 = tables.n10.tokenThreshold.perfect;
  return {
    id: 'D1', grade: 'dev', question: 'Does logInputTokens alone reproduce the hypotheses table?',
    sources: [stagesInfo.source, census.source],
    note: 'The hypotheses are expectations written before any label (PREREG-NEED-V1 §1.1), not labels. Jobs: TRAIN and HELD-OUT with a measured max example token count; forced, pending, conditional and unmeasured jobs are left out.',
    jobs: jobs.map(j => ({ id: j.id, cluster: j.cluster, split: j.split, tokens: j.tokens, n1: j.n1, n10: j.n10 })),
    tokenOnly: tables, featureRows: rows.map(r => ({ id: r.id, family: r.family, difficulties: r.difficulties, proxy: r.proxy, computedFromBed: r.computedFromBed, logInputTokens: round(r.logInputTokens, 4), maxListLength: round(r.maxListLength, 4) })),
    withFanOut: rules, jobsWithoutFeatureRow: missing,
    summary: {
      jobs: jobs.length, reproducedN1: perfect1, reproducedN10: perfect10,
      balancedAccuracyN1: tables.n1.tokenThreshold.balancedAccuracy, balancedAccuracyN10: tables.n10.tokenThreshold.balancedAccuracy,
      errorsN1: tables.n1.tokenThreshold.wrong, errorsN10: tables.n10.tokenThreshold.wrong,
      orRuleReproducedN1: rules.n1.orRule.perfect, orRuleReproducedN10: rules.n10.orRule.perfect, orRuleErrorsN1: rules.n1.orRule.wrong, orRuleErrorsN10: rules.n10.orRule.wrong,
    },
  };
}
