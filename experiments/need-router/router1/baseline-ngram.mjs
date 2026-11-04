// ROUTER-1 addendum (review 2026-11-04, finding m11): a $0 LEARNED baseline, so that "a hand-written lexicon fails" can be told
// apart from "any $0 text classifier fails". Character n-gram TF-IDF + L2 logistic regression, trained on the DEV split only.
//
// Everything that can be tuned is fixed here and chosen on dev only, and this file was committed with its dev output BEFORE its
// first test read (the commit message says so). It is still POST-HOC with respect to PREREG-ROUTER-1: the baseline was added
// after the test split had been read for the other systems. Read its test numbers as a diagnostic baseline, not as held-out
// evidence of the same grade as the preregistered systems.
//
//   node experiments/need-router/router1/baseline-ngram.mjs --split dev    # 5-fold dev cluster CV: lambda choice + OOF threshold -> results/ngram-dev.json
//   node experiments/need-router/router1/baseline-ngram.mjs --split test   # fit on all dev, score test once -> results/ngram-test.json
//
// Fixed design (no test-dependent choice):
//   text      lowercased, whitespace collapsed, clipped to 8,000 characters (the judge prompt's clip), padded with one space
//   features  character n-grams, n = 3, 4, 5; kept if they occur in >= 2 training documents; tf = 1 + ln(count);
//             idf = ln((1 + N) / (1 + df)) + 1; each document L2-normalised
//   model     logistic regression, bias unpenalised, 0.5 * lambda * |w|^2 + sum of log losses, full-batch gradient descent with
//             backtracking (convex; 3,000 iterations or a 1e-9 loss change)
//   lambda    from LAMBDAS by the highest out-of-fold AUROC in 5-fold dev cluster CV (fold = sha256('router1-cv:' + cluster) mod 5,
//             the fit.mjs folds); ties -> the larger lambda
//   threshold the never-trigger rule applied to OUT-OF-FOLD dev scores (review M5): t = max OOF dev-negative score + 0.02
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadSet } from './judges.mjs';
import { confusion, auroc, cpUpper, RESULTS } from './eval-router1.mjs';

// The grid was [0.01 .. 1] first; its best dev OOF AUROC was at the edge (lambda 1), so it was extended once to 10, on dev only,
// before any test read.
export const LAMBDAS = Object.freeze([0.01, 0.03, 0.1, 0.3, 1, 3, 10]);
export const NGRAMS = Object.freeze([3, 4, 5]);
export const MIN_DF = 2, MARGIN = 0.02, CLIP = 8000, ITERS = 3000, K = 5;
export const CONFIG = Object.freeze({ schema: 'foundry.need-router.ngram-baseline/1', lambdas: LAMBDAS, ngrams: NGRAMS, minDf: MIN_DF, margin: MARGIN, clip: CLIP, iters: ITERS, folds: K });

export function normalize(text) { return ` ${String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, CLIP)} `; }
export function grams(text) {
  const t = normalize(text), counts = new Map();
  for (const n of NGRAMS) for (let i = 0; i + n <= t.length; i++) { const g = t.slice(i, i + n); counts.set(g, (counts.get(g) ?? 0) + 1); }
  return counts;
}

/** Vocabulary and idf from TRAINING documents only. */
export function vectorizer(trainTexts) {
  const docs = trainTexts.map(grams), df = new Map();
  for (const d of docs) for (const g of d.keys()) df.set(g, (df.get(g) ?? 0) + 1);
  const vocab = new Map(); const idf = [];
  for (const [g, c] of [...df].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (c >= MIN_DF) { vocab.set(g, idf.length); idf.push(Math.log((1 + docs.length) / (1 + c)) + 1); }
  const transform = text => {
    const idx = [], val = [];
    for (const [g, c] of grams(text)) { const j = vocab.get(g); if (j !== undefined) { idx.push(j); val.push((1 + Math.log(c)) * idf[j]); } }
    const norm = Math.sqrt(val.reduce((s, x) => s + x * x, 0)) || 1;
    return { idx, val: val.map(x => x / norm) };
  };
  return { size: idf.length, transform };
}

function dot(w, x) { let s = 0; for (let k = 0; k < x.idx.length; k++) s += w[x.idx[k]] * x.val[k]; return s; }

/** L2 logistic regression on sparse rows; returns { w, b }. */
export function fitLr(X, y, size, lambda) {
  let w = new Float64Array(size), b = 0, step = 1;
  const loss = (w, b) => { let L = 0; for (let j = 0; j < size; j++) L += 0.5 * lambda * w[j] * w[j];
    for (let i = 0; i < X.length; i++) { const z = b + dot(w, X[i]); L += Math.log1p(Math.exp(-Math.abs(z))) + Math.max(0, z) - y[i] * z; } return L; };
  let L = loss(w, b);
  for (let it = 0; it < ITERS; it++) {
    const gw = new Float64Array(size); let gb = 0;
    for (let j = 0; j < size; j++) gw[j] = lambda * w[j];
    for (let i = 0; i < X.length; i++) { const r = 1 / (1 + Math.exp(-(b + dot(w, X[i])))) - y[i]; gb += r; const x = X[i]; for (let k = 0; k < x.idx.length; k++) gw[x.idx[k]] += r * x.val[k]; }
    let accepted = false;
    for (let tries = 0; tries < 50; tries++) {
      const w2 = new Float64Array(size); for (let j = 0; j < size; j++) w2[j] = w[j] - step * gw[j];
      const b2 = b - step * gb, L2 = loss(w2, b2);
      if (L2 <= L - 1e-12 || step < 1e-12) { const done = Math.abs(L - L2) < 1e-9; w = w2; b = b2; L = L2; accepted = true; step *= 1.5; if (done) it = ITERS; break; }
      step *= 0.5;
    }
    if (!accepted) break;
  }
  return { w, b };
}

export function trainScore(trainItems, scoreItems, lambda) {
  const v = vectorizer(trainItems.map(it => it.text));
  const m = fitLr(trainItems.map(it => v.transform(it.text)), trainItems.map(it => (it.gold.needsWorkflow ? 1 : 0)), v.size, lambda);
  return scoreItems.map(it => 1 / (1 + Math.exp(-(m.b + dot(m.w, v.transform(it.text))))));
}

export const fold = it => parseInt(createHash('sha256').update(`router1-cv:${it.cluster}`).digest('hex').slice(0, 8), 16) % K;

/** Out-of-fold dev scores for one lambda. */
export function oofScores(dev, lambda) {
  const s = new Map();
  for (let f = 0; f < K; f++) { const held = dev.filter(it => fold(it) === f); trainScore(dev.filter(it => fold(it) !== f), held, lambda).forEach((p, i) => s.set(held[i].id, p)); }
  return dev.map(it => s.get(it.id));
}

/** The whole dev-only procedure: lambda by OOF AUROC (ties -> larger), threshold by the OOF never-trigger rule. */
export function chooseOnDev(dev) {
  const g = dev.map(it => it.gold.needsWorkflow);
  const grid = LAMBDAS.map(lambda => { const s = oofScores(dev, lambda); return { lambda, oofAuroc: auroc(g, s), scores: s }; });
  const best = [...grid].sort((a, b) => b.oofAuroc - a.oofAuroc || b.lambda - a.lambda)[0];
  const negMax = Math.max(...best.scores.filter((_, i) => !g[i]));
  const t = Math.min(0.99, negMax + MARGIN);
  const oof = confusion(g, best.scores.map(p => p >= t));
  return { lambda: best.lambda, threshold: Math.round(t * 1e6) / 1e6, oofNegMax: negMax, grid: grid.map(({ lambda, oofAuroc }) => ({ lambda, oofAuroc })), devOof: { ...oof, auroc: best.oofAuroc } };
}

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (import.meta.url === `file://${process.argv[1]}`) {
  const split = arg('--split', 'dev');
  const set = loadSet(), dev = set.filter(it => it.split === 'dev');
  const choice = chooseOnDev(dev);
  const out = { config: CONFIG, choice };
  if (split === 'test') {
    const test = set.filter(it => it.split === 'test');
    const t0 = process.hrtime.bigint();
    const scores = trainScore(dev, test, choice.lambda);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const g = test.map(it => it.gold.needsWorkflow), c = confusion(g, scores.map(p => p >= choice.threshold));
    out.test = { ...c, negatives: g.filter(x => !x).length, fpRateUpper95: cpUpper(c.fp, g.filter(x => !x).length), auroc: auroc(g, scores), msTotalFitAndScore: Math.round(ms) };
    out.rows = test.map((it, i) => ({ id: it.id, p: Math.round(scores[i] * 1e6) / 1e6 }));
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(path.join(RESULTS, 'ngram-test.json'), JSON.stringify(out, null, 1) + '\n');
  } else if (split === 'dev') { mkdirSync(RESULTS, { recursive: true }); writeFileSync(path.join(RESULTS, 'ngram-dev.json'), JSON.stringify(out, null, 1) + '\n'); }
  else throw new Error('--split dev|test');
  console.log(JSON.stringify({ ...out, rows: undefined }, null, 1));
}
