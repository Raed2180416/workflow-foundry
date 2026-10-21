// ROUTER-1 step 1-2 (PREREG-ROUTER-1.md §3): fit the need router's logistic weights on the DEV split only, then set the default
// threshold by the never-trigger rule t_default = (highest p among dev negatives) + 0.02. Writes src/need/params.json.
// The test split is never read here: items are filtered to split === 'dev' before any feature is computed.
//
//   node experiments/need-router/router1/fit.mjs            # fit, write params.json, print dev diagnostics
//   node experiments/need-router/router1/fit.mjs --diag     # print dev features and p under the current params; write nothing
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPrimitives, FEATURES, PRIMITIVES, DAMPENERS, DETECTOR_VERSION } from '../../../src/need/primitives.mjs';
import { scoreFeatures, paramsSha, validateParams } from '../../../src/need/router.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PARAMS_FILE = path.join(ROOT, 'src/need/params.json');
export const LAMBDA = 1, MARGIN = 0.02;

export function devItems() {
  return readFileSync(path.join(ROOT, 'research/need-router-20261014/router1/SET.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.split === 'dev');
}

/** L2-regularised logistic regression (sklearn convention: 0.5 * lambda * |w|^2 + sum of log losses; bias unpenalised), with
 * primitive weights projected to >= 0 and dampener weights to <= 0 after every step. Convex: projected gradient descent with
 * a backtracking step converges to the constrained optimum. */
export function fitLogistic(X, y, { lambda = LAMBDA, iters = 20000, tol = 1e-10 } = {}) {
  const k = FEATURES.length, n = X.length;
  let w = new Array(k).fill(0), b = 0;
  const sign = FEATURES.map(f => (PRIMITIVES.includes(f) ? 1 : -1));
  const project = v => v.map((x, j) => (sign[j] > 0 ? Math.max(0, x) : Math.min(0, x)));
  const loss = (w, b) => {
    let L = 0.5 * lambda * w.reduce((s, x) => s + x * x, 0);
    for (let i = 0; i < n; i++) { const z = b + X[i].reduce((s, x, j) => s + x * w[j], 0); L += Math.log1p(Math.exp(-Math.abs(z))) + Math.max(0, z) - y[i] * z; }
    return L;
  };
  let L = loss(w, b), step = 1, it = 0;
  for (; it < iters; it++) {
    const gw = w.map(x => lambda * x); let gb = 0;
    for (let i = 0; i < n; i++) { const z = b + X[i].reduce((s, x, j) => s + x * w[j], 0), r = 1 / (1 + Math.exp(-z)) - y[i]; gb += r; for (let j = 0; j < k; j++) gw[j] += r * X[i][j]; }
    let accepted = false;
    for (let tries = 0; tries < 50; tries++) {
      const w2 = project(w.map((x, j) => x - step * gw[j])), b2 = b - step * gb, L2 = loss(w2, b2);
      if (L2 <= L - 1e-12 || step < 1e-12) { const done = Math.abs(L - L2) < tol; w = w2; b = b2; L = L2; accepted = true; step *= 1.5; if (done) it = iters; break; }
      step *= 0.5;
    }
    if (!accepted) break;
  }
  return { weights: Object.fromEntries(FEATURES.map((f, j) => [f, round(w[j])])), bias: round(b), loss: round(L), iters: it };
}

const round = x => Math.round(x * 1e6) / 1e6;

export function fit(items = devItems()) {
  const rows = items.map(it => ({ it, d: detectPrimitives(it.text) }));
  const X = rows.map(r => FEATURES.map(f => r.d.features[f])), y = rows.map(r => (r.it.gold.needsWorkflow ? 1 : 0));
  const m = fitLogistic(X, y);
  const base = { weights: m.weights, bias: m.bias };
  const ps = rows.map(r => scoreFeatures(r.d.features, base));
  const negMax = Math.max(...ps.filter((_, i) => !y[i]));
  const tDefault = round(Math.min(0.99, negMax + MARGIN));
  const pos = ps.filter((_, i) => y[i]);
  const params = {
    schema: 'foundry.need-router-params/1', detector: DETECTOR_VERSION, features: [...FEATURES], weights: m.weights, bias: m.bias, tDefault,
    modeRules: { recurrenceMin: 0.5, irreversibleMin: 0.8, dampenerMax: 0.5 },
    middle: { judge: null, delta: 0 },
    fit: { split: 'dev', n: items.length, positives: y.filter(Boolean).length, lambda: LAMBDA, margin: MARGIN, loss: m.loss, iters: m.iters,
      devNegMaxP: round(negMax), devRecallAtDefault: round(pos.filter(p => p >= tDefault).length / pos.length), rule: 'PREREG-ROUTER-1 §3 steps 1-2' }
  };
  const problems = validateParams(params);
  if (problems.length) throw new Error(problems.join('; '));
  return { params, rows, ps, y };
}

function diag({ rows, ps, y, params }) {
  const order = rows.map((r, i) => i).sort((a, b) => ps[b] - ps[a]);
  for (const i of order) {
    const r = rows[i], f = r.d.features;
    const on = FEATURES.filter(k => f[k] > 0.05).map(k => `${k}=${f[k].toFixed(2)}`).join(' ');
    const flag = (ps[i] >= params.tDefault) !== !!y[i] ? (y[i] ? 'FN' : 'FP') : '  ';
    console.log(`${flag} ${ps[i].toFixed(3)} ${r.it.gold.mode.padEnd(9)} ${r.it.id.padEnd(46)} ${on}`);
  }
  console.log(JSON.stringify({ weights: params.weights, bias: params.bias, tDefault: params.tDefault, fit: params.fit }, null, 1));
}

/** Development diagnostic: k-fold CV over dev clusters (fit weights and the never-trigger threshold on k-1 folds, score the
 * held-out fold). Optimistic, because the detectors were written while reading all of dev; it estimates only how fragile the
 * max-negative threshold rule is to unseen negatives. */
export function crossValidate(items = devItems(), k = 5) {
  const fold = it => parseInt(createHash('sha256').update(`router1-cv:${it.cluster}`).digest('hex').slice(0, 8), 16) % k;
  let fp = 0, neg = 0, tp = 0, pos = 0;
  const misses = [];
  for (let f = 0; f < k; f++) {
    const train = items.filter(it => fold(it) !== f), held = items.filter(it => fold(it) === f);
    const { params } = fit(train);
    for (const it of held) {
      const p = scoreFeatures(detectPrimitives(it.text).features, params), yes = p >= params.tDefault;
      if (it.gold.needsWorkflow) { pos++; if (yes) tp++; else misses.push(`FN ${it.id} p=${p.toFixed(3)} t=${params.tDefault}`); }
      else { neg++; if (yes) { fp++; misses.push(`FP ${it.id} p=${p.toFixed(3)} t=${params.tDefault}`); } }
    }
  }
  return { k, fp, neg, recall: round(tp / pos), tp, pos, misses };
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--cv')) {
  console.log(JSON.stringify(crossValidate(), null, 1));
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const r = fit();
  diag({ ...r, params: r.params });
  if (!process.argv.includes('--diag')) {
    writeFileSync(PARAMS_FILE, JSON.stringify(r.params, null, 1) + '\n');
    console.log(`wrote ${path.relative(ROOT, PARAMS_FILE)} sha256(canonical) ${paramsSha(r.params)}`);
  }
}
