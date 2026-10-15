// J-NEED-2 (need router; research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.1 and §5 row 5; decision 12 in
// research/need-router-20261014/DECISIONS-ADOPTED.md). Can Jev (TypeSafe's hosted System One: typed questions in, a
// probability per option out) read task PROPERTIES that help predict whether ONE Haiku call solves a task, beyond the
// code-only pre-execution features? Jev is never the mode picker (decision 12): this only decides whether Jev property
// features enter NR-static, NR-knn or neither.
//
// Six typed property questions (S1..S6), each with the no-match option `cannot_tell`, asked of Jev about each of the 144 M1
// tasks the way a router sees the task before execution (jev-need.mjs stateOf: the prompt, truncated, plus size facts; never
// the answer, the oracle or the outcome). Every option order is asked (N7: 6 permutations of the 3 options, each applied to
// all 6 questions, one request per permutation) and the probabilities, mapped back to option names, are averaged. A Haiku
// typed arm (--haiku) answers the identical questions once per task through the journaled ModelPort.
// The outcome label per task is "passed by one call at either effort": --labels m1 (runs/m1 + runs/m1-d5) or --labels m1r
// (runs/m1-r/merged.jsonl, where the 54 timeouts are re-run at 600 s); --analyze reports both when both exist.
//
// Analysis ($0, pure, exported, unit-tested): (a) property accuracy against the family truth table (truth.json; cannot_tell
// counts as a miss); (b) leave-one-family-out L2 logistic heads (standardization fitted on the training folds only): code-only
// vs code + Jev p(yes) vs code + Haiku answers, pooled out-of-fold AUROC with a family-cluster bootstrap interval, on d3 and on
// d3+d5; (c) accuracy at the base-rate-matched threshold against the probe baselines (deployable 0.625, oracle-checked 0.827);
// (d) the pre-registered decision rule; (e) Kotte's abstention floor note (F22).
// With 8 family clusters every result is diagnostic (development evidence, never held-out).
//
// PREDICTION, quoted verbatim from the J-NEED-2 spec (recorded 2026-10-14 before any property request; not blind to M1 labels):
//   P-a Jev property answers match family truth on >= 0.75 of cells, misses on S4 and S6; P-b LOFO AUROC on d3 0.40-0.60
//   code-only, 0.45-0.65 code+Jev, neither reaches 0.70; P-c neither beats the deployable probe by more than noise; P-d with d5
//   added code-only 0.60-0.75, Jev adds <= 0.03.
//
// METERED (pennies): Jev 144 x 6 = 864 requests, request ledger with a hard cap (--cap, default 1000; retries count); the
// Haiku arm one call per task, hard $ cap (--haiku-cap, default 2). The Jev key comes only from the environment variable
// FOUNDRY_SYSTEMONE_API_KEY (via jevClient); it is never printed, logged or written. Live files stay under /var/tmp and are
// copied into research/need-router-20261014/runs/jev-need2/ at the end.
//   node experiments/need-router/jev-need2.mjs --dry                       # build every request, counts and cost, no network
//   FOUNDRY_SYSTEMONE_API_KEY=... node experiments/need-router/jev-need2.mjs [--cap 1000] [--concurrency 2] [--limit N]
//   node experiments/need-router/jev-need2.mjs --haiku [--haiku-cap 2]
//   node experiments/need-router/jev-need2.mjs --analyze [--labels m1|m1r] [--truth <truth.json>] [--reps 2000]
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { makeTasks, loadFamily } from '../lib/beds.mjs';
import { toSystemOneQuestion, fromSystemOneAnswer } from '../../src/judgment.mjs';
import { stateOf } from './jev-need.mjs';
import { readRows } from '../kev-data/score-served.mjs';
import { taskFeatures, WHITELIST } from './features.mjs';
import { rng } from './metrics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RUNS_DIR = path.join(ROOT, 'research/need-router-20261014/runs');
export const OUT_DIR = path.join(RUNS_DIR, 'jev-need2');
export const TRUTH_FILE = path.join(ROOT, 'research/need-router-20261014/jneed2/truth.json');
export const LIVE_DIR = '/var/tmp/foundry-work/need/jev-need2';
export const HAIKU_MODEL = 'claude-haiku-5-5';
export const JEV_USD_PER_MTOK = 0.042;            // policy judgmentModels price.inputPerMTok (second-hand, unverified)
export const DEPLOYABLE_PROBE = 0.625;            // need-router design: deployable one-example probe accuracy
export const ORACLE_PROBE = 0.827;                // need-router design: oracle-checked probe accuracy
export const LAMBDA = 1;                          // L2 penalty on standardized weights (intercept free); fixed, never tuned
export const RETRYABLE = Object.freeze(['MODEL_QUOTA', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT']);
export const ABSTAIN_P = 0.6;                     // Kotte note: share of answers whose max probability is below this
export const KOTTE_ALPHA = 0.05;

export const PREDICTION = 'Prediction recorded 2026-10-14 before any property request (not blind to M1 labels): P-a Jev property answers match family truth on >= 0.75 of cells, misses on S4 and S6; P-b LOFO AUROC on d3 0.40-0.60 code-only, 0.45-0.65 code+Jev, neither reaches 0.70; P-c neither beats the deployable probe by more than noise; P-d with d5 added code-only 0.60-0.75, Jev adds <= 0.03.';

// ---- the questions ------------------------------------------------------------------------------------------------------

export const OPTIONS = Object.freeze(['yes', 'no', 'cannot_tell']);
export const QUESTION_IDS = Object.freeze(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
export const NO_MATCH = 'cannot tell from the text';

export const PROPERTY_QUESTIONS = Object.freeze({
  S1: { question: 'Is the branching in this task (which rule, category or path applies to an item) decided by interpreting the meaning of text, rather than by reading an explicit field, code or value?',
    yes: 'branching is decided by meaning: free text, descriptions or intent must be interpreted to choose the path',
    no: 'branching is decided by explicit fields, codes or values, or the task has no branching' },
  S2: { question: 'Does handling one item require looking at other items (joining records, removing duplicates, consolidating or reconciling across items)?',
    yes: 'items must be joined, de-duplicated, consolidated or reconciled with other items',
    no: 'each item can be handled on its own, without the other items' },
  S3: { question: 'Is every field of the required output scored exactly (no tolerance, no partial credit, no free wording)?',
    yes: 'every output field must match exactly',
    no: 'some output fields allow tolerance, partial credit or free wording' },
  S4: { question: 'Does the input give control totals, counts or other figures that a program could use to check the answer?',
    yes: 'the input states totals, counts or checkable figures the answer must agree with',
    no: 'the input gives nothing a program could check the answer against' },
  S5: { question: 'Must an irregular, legacy or non-standard format be decoded to read the input (for example fixed-width records, custom encodings, mixed date or number formats)?',
    yes: 'an irregular or legacy format must be decoded',
    no: 'the input is in a regular, standard format' },
  S6: { question: 'Do conventions stated in prose (rules, exceptions or definitions written in the text) govern many items, so the whole text must be read and applied globally?',
    yes: 'conventions written in prose apply across many items (a global read)',
    no: 'rules are local to each item or given as explicit structure' },
});

export const optionDescriptions = id => ({ yes: PROPERTY_QUESTIONS[id].yes, no: PROPERTY_QUESTIONS[id].no, cannot_tell: NO_MATCH });

/** All orderings of xs (lexicographic by index; the first is the identity). */
export function permutations(xs) {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]));
}
export const PERMUTATIONS = Object.freeze(permutations(OPTIONS).map(p => Object.freeze(p)));

/** The six System One questions with the options in `order` (criteria keys follow the order; descriptions follow the names). */
export function jevQuestions(order = OPTIONS) {
  if ([...order].sort().join() !== [...OPTIONS].sort().join()) throw new Error(`order must be a permutation of ${OPTIONS.join(', ')}`);
  return Object.fromEntries(QUESTION_IDS.map(id => [id, toSystemOneQuestion({ question: PROPERTY_QUESTIONS[id].question, options: [...order], optionDescriptions: optionDescriptions(id) })]));
}

/** One Jev request body (SystemOneClient adds the model): the router's view of the task and the six questions. Nothing else. */
export function buildJevRequest(task, order = OPTIONS) {
  return { state: stateOf(task), questions: jevQuestions(order) };
}

/** A Jev response -> { S1: {yes, no, cannot_tell}, ... } by option NAME (any order the request used), normalized. */
export function readJevAnswers(body, ids = QUESTION_IDS) {
  if (!body?.answers || typeof body.answers !== 'object') throw new Error('Jev response has no answers');
  return Object.fromEntries(ids.map(id => [id, fromSystemOneAnswer(body.answers[id], [...OPTIONS]).probabilities]));
}

/** Average per-permutation distributions ({S: {option: p}}[]) option by option, by name. */
export function averagePerms(perms, ids = QUESTION_IDS) {
  if (!perms.length) throw new Error('nothing to average');
  return Object.fromEntries(ids.map(id => [id, Object.fromEntries(OPTIONS.map(o => [o, perms.reduce((s, p) => s + p[id][o], 0) / perms.length]))]));
}

// ---- the Haiku typed arm (identical questions) ----------------------------------------------------------------------------

export const HAIKU_SYSTEM = 'You read a task description and answer typed questions about properties of the task. Do not solve the task. Answer every question with exactly one of its options; answer cannot_tell when the text does not let you decide. Return only JSON matching the schema.';
export const HAIKU_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.fromEntries(QUESTION_IDS.map(id => [id, { type: 'string', enum: [...OPTIONS] }])),
  required: [...QUESTION_IDS],
  additionalProperties: false,
});

export function haikuPrompt(task) {
  const qs = jevQuestions(OPTIONS);
  const lines = [stateOf(task), '', 'QUESTIONS (answer each with exactly one option name)'];
  for (const id of QUESTION_IDS) {
    lines.push('', `${id}. ${qs[id].instructions}`);
    for (const [o, d] of Object.entries(qs[id].criteria)) lines.push(`  - ${o}: ${d}`);
  }
  return lines.join('\n');
}
export function buildHaikuRequest(task) {
  return { system: HAIKU_SYSTEM, prompt: haikuPrompt(task), schema: HAIKU_SCHEMA };
}
/** Haiku's categorical answers as one-hot distributions, the same shape as Jev's. */
export function haikuDist(answers, ids = QUESTION_IDS) {
  return Object.fromEntries(ids.map(id => [id, Object.fromEntries(OPTIONS.map(o => [o, answers?.[id] === o ? 1 : 0]))]));
}

// ---- tasks and labels -----------------------------------------------------------------------------------------------------

export const parseKey = k => { const [family, split, d, s] = k.split(':'); return { family, split, difficulty: Number(d.slice(1)), seed: Number(s.slice(1)) }; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);

/** The 144 task keys: every task M1 ran (runs/m1 + runs/m1-d5); the task list never depends on outcomes. */
export function taskKeysOf(runsDir = RUNS_DIR) {
  const keys = new Set();
  for (const r of ['m1', 'm1-d5']) for (const x of readJsonl(path.join(runsDir, r, 'results.jsonl'))) keys.add(x.taskKey);
  return [...keys].sort();
}

/** One-call outcome per task: passed by one call at either effort. Rows: M1 result rows (one per task x arm). */
export function labelsFromRows(rows) {
  const m = new Map();
  for (const x of rows) {
    const cur = m.get(x.taskKey) ?? { taskKey: x.taskKey, family: x.family, pass: false, n: 0, timeouts: 0 };
    cur.pass ||= !!x.pass; cur.n += 1; cur.timeouts += x.error?.code === 'MODEL_TIMEOUT' ? 1 : 0;
    m.set(x.taskKey, cur);
  }
  return m;
}

/** Labelling `kind` ('m1' | 'm1r') or null when its files are absent. */
export function loadLabels(kind, runsDir = RUNS_DIR) {
  if (kind === 'm1') {
    const files = ['m1', 'm1-d5'].map(r => path.join(runsDir, r, 'results.jsonl'));
    if (!files.every(existsSync)) return null;
    return labelsFromRows(files.flatMap(readJsonl));
  }
  if (kind === 'm1r') {
    const f = path.join(runsDir, 'm1-r', 'merged.jsonl');
    return existsSync(f) ? labelsFromRows(readJsonl(f)) : null;
  }
  throw new Error(`unknown labelling ${kind} (m1 | m1r)`);
}

/** Regenerate the tasks (pure, $0) with their code-only features. */
export async function loadTasks(keys) {
  const out = [];
  for (const k of keys) {
    const { family, split, difficulty, seed } = parseKey(k);
    const t = (await makeTasks(family, { split, seeds: [seed], difficulty }))[0];
    if (t.taskKey !== k) throw new Error(`task key mismatch ${t.taskKey} vs ${k}`);
    const fam = await loadFamily(family);
    out.push({ taskKey: k, family, difficulty, task: t.task, taskHash: t.taskHash, code: taskFeatures(t.task, fam.outputSchema) });
  }
  return out;
}

// ---- statistics (pure) ----------------------------------------------------------------------------------------------------

/** AUROC (Mann-Whitney, ties count half) in O(n log n); null without both classes. */
export function auroc(scores, labels) {
  const n = scores.length, idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
  let nPos = 0, rankSum = 0;
  for (let i = 0; i < n;) {
    let j = i; while (j + 1 < n && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (labels[idx[k]]) { nPos++; rankSum += avg; }
    i = j + 1;
  }
  const nNeg = n - nPos;
  if (!nPos || !nNeg) return null;
  return (rankSum - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}

/** Expected accuracy when exactly as many tasks are called positive as there are positives (base-rate-matched threshold);
 *  ties at the threshold are broken at random (the expectation is exact). */
export function matchedAccuracy(scores, labels) {
  const n = scores.length; if (!n) return null;
  const k = labels.filter(Boolean).length;
  const idx = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  let correct = 0, taken = 0;
  for (let i = 0; i < n;) {
    let j = i; while (j + 1 < n && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const m = j - i + 1, pos = idx.slice(i, j + 1).filter(t => labels[t]).length, neg = m - pos;
    const r = Math.max(0, Math.min(m, k - taken));            // how many of this tie group are called positive
    correct += (r / m) * pos + ((m - r) / m) * neg;
    taken += r; i = j + 1;
  }
  return correct / n;
}

const sigmoid = z => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const log1pexp = z => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));

/** Solve A x = b (Gaussian elimination, partial pivoting). */
export function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) throw new Error('singular system');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

/** L2-regularized logistic regression by Newton/IRLS with step halving. X: n x d (already standardized), y: 0/1.
 *  Objective: -loglik + lambda/2 * |w|^2 (the intercept is not penalized). Returns { b, w, iterations, objective }. */
export function fitLogistic(X, y, { lambda = LAMBDA, maxIter = 100, tol = 1e-10 } = {}) {
  const n = X.length, d = n ? X[0].length : 0, D = d + 1;
  const row = i => [1, ...X[i]];
  let beta = new Array(D).fill(0);
  const objective = bt => {
    let s = 0;
    for (let i = 0; i < n; i++) { const z = row(i).reduce((a, v, j) => a + v * bt[j], 0); s += log1pexp(z) - y[i] * z; }
    for (let j = 1; j < D; j++) s += lambda / 2 * bt[j] ** 2;
    return s;
  };
  let obj = objective(beta), it = 0;
  for (; it < maxIter; it++) {
    const g = new Array(D).fill(0), H = Array.from({ length: D }, () => new Array(D).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = row(i), p = sigmoid(xi.reduce((a, v, j) => a + v * beta[j], 0)), w = Math.max(p * (1 - p), 1e-10);
      for (let a = 0; a < D; a++) { g[a] += (p - y[i]) * xi[a]; for (let c = a; c < D; c++) H[a][c] += w * xi[a] * xi[c]; }
    }
    for (let a = 0; a < D; a++) for (let c = 0; c < a; c++) H[a][c] = H[c][a];
    for (let j = 1; j < D; j++) { g[j] += lambda * beta[j]; H[j][j] += lambda; }
    H[0][0] += 1e-9;                                            // keeps the system solvable when every p saturates
    const step = solve(H, g);
    let t = 1, next, nextObj;
    for (let h = 0; h < 30; h++) { next = beta.map((v, j) => v - t * step[j]); nextObj = objective(next); if (nextObj <= obj + 1e-12) break; t /= 2; }
    const moved = Math.max(...step.map(v => Math.abs(v * t)));
    beta = next; const dObj = obj - nextObj; obj = nextObj;
    if (moved < tol || Math.abs(dObj) < tol) { it++; break; }
  }
  return { b: beta[0], w: beta.slice(1), iterations: it, objective: obj };
}
export const predictLogistic = (model, x) => sigmoid(model.b + x.reduce((a, v, j) => a + v * model.w[j], 0));

/** Column means and sds of a training matrix; constant columns (sd ~ 0) map to 0. */
export function standardizer(X) {
  const d = X[0]?.length ?? 0, n = X.length;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / n));
  return { mean, sd, apply: M => M.map(r => r.map((v, j) => (sd[j] > 1e-12 ? (v - mean[j]) / sd[j] : 0))) };
}

/** Leave-one-family-out head: for each family, fit the standardizer and the logistic head on the OTHER families only and score
 *  the held-out family. Items: { taskKey, family, label }. Returns { scores: Map(taskKey -> p), folds }. */
export function lofoHead(items, featureFn, { lambda = LAMBDA, fit = fitLogistic } = {}) {
  const fams = [...new Set(items.map(i => i.family))].sort();
  const scores = new Map(), folds = [];
  for (const f of fams) {
    const train = items.filter(i => i.family !== f), test = items.filter(i => i.family === f);
    const Xtr = train.map(featureFn), ytr = train.map(i => (i.label ? 1 : 0)), st = standardizer(Xtr);
    let model = null, predict;
    if (new Set(ytr).size < 2) { const c = ytr.reduce((a, b) => a + b, 0) / Math.max(1, ytr.length); predict = () => c; }
    else { model = fit(st.apply(Xtr), ytr, { lambda }); predict = x => predictLogistic(model, st.apply([x])[0]); }
    for (const t of test) scores.set(t.taskKey, predict(featureFn(t)));
    folds.push({ family: f, train: train.map(i => i.taskKey), test: test.map(i => i.taskKey), mean: st.mean, sd: st.sd, model });
  }
  return { scores, folds };
}

const quantile = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; };

/** Family-cluster bootstrap of statistics over fixed out-of-fold scores. `stat(sample)` -> {name: number|null}, where a sample
 *  is the list of items of the drawn families (a family drawn twice appears twice). Returns {name: {lo, hi, n}}. */
export function clusterBootstrap(items, stat, { reps = 2000, seed = 1, alpha = 0.05 } = {}) {
  const r = rng(seed), fams = [...new Set(items.map(i => i.family))].sort();
  const byFam = new Map(fams.map(f => [f, items.filter(i => i.family === f)]));
  const acc = {};
  for (let i = 0; i < reps; i++) {
    const sample = fams.flatMap(() => byFam.get(fams[Math.floor(r() * fams.length)]));
    for (const [k, v] of Object.entries(stat(sample))) if (v !== null && v !== undefined && Number.isFinite(v)) (acc[k] ??= []).push(v);
  }
  return Object.fromEntries(Object.entries(acc).map(([k, xs]) => [k, { lo: quantile(xs, alpha / 2), hi: quantile(xs, 1 - alpha / 2), n: xs.length, reps }]));
}

// ---- heads ----------------------------------------------------------------------------------------------------------------

export const CODE_KEYS = WHITELIST;      // taskFeatures numeric fields; logInputTokens is the log token count
const codeX = i => CODE_KEYS.map(k => i.code[k]);
const propX = src => i => QUESTION_IDS.map(id => i[src][id].yes);
export const HEADS = Object.freeze({
  code: { needs: [], x: codeX },
  'code+jev': { needs: ['jev'], x: i => [...codeX(i), ...propX('jev')(i)] },
  'code+haiku': { needs: ['haiku'], x: i => [...codeX(i), ...propX('haiku')(i)] },
  jev: { needs: ['jev'], x: propX('jev'), diagnostic: true },
  haiku: { needs: ['haiku'], x: propX('haiku'), diagnostic: true },
});

/** Every head on one item set: pooled out-of-fold AUROC, matched-threshold accuracy, the paired increment over code-only on the
 *  same tasks, and family-bootstrap intervals; plus the size rule (smaller input -> one call; no fitting) as a reference. */
export function evaluateHeads(items, { reps = 2000, seed = 1, lambda = LAMBDA } = {}) {
  const out = {};
  const sizeScores = items.map(i => -i.code.logInputTokens), y = items.map(i => i.label);
  const sizeCi = clusterBootstrap(items.map((i, k) => ({ ...i, s: sizeScores[k] })), s => ({ auroc: auroc(s.map(i => i.s), s.map(i => i.label)), matchedAccuracy: matchedAccuracy(s.map(i => i.s), s.map(i => i.label)) }), { reps, seed });
  out['size-rule'] = { n: items.length, auroc: auroc(sizeScores, y), ci: sizeCi.auroc ?? null, matchedAccuracy: matchedAccuracy(sizeScores, y), matchedCi: sizeCi.matchedAccuracy ?? null, fitted: false };
  for (const [name, h] of Object.entries(HEADS)) {
    const set = items.filter(i => h.needs.every(k => i[k]));
    const fams = new Set(set.map(i => i.family));
    if (set.length < 10 || fams.size < 3 || new Set(set.map(i => i.label)).size < 2) { out[name] = { n: set.length, skipped: 'too few tasks, families or classes' }; continue; }
    const oof = lofoHead(set, h.x, { lambda });
    const base = name === 'code' ? oof : lofoHead(set, HEADS.code.x, { lambda });
    const rows = set.map(i => ({ taskKey: i.taskKey, family: i.family, label: i.label, s: oof.scores.get(i.taskKey), c: base.scores.get(i.taskKey) }));
    const stat = s => {
      const ys = s.map(r => r.label), a = auroc(s.map(r => r.s), ys), c = auroc(s.map(r => r.c), ys);
      return { auroc: a, matchedAccuracy: matchedAccuracy(s.map(r => r.s), ys), delta: a === null || c === null ? null : a - c };
    };
    const point = stat(rows), ci = clusterBootstrap(rows, stat, { reps, seed });
    out[name] = {
      n: set.length, families: fams.size, positives: set.filter(i => i.label).length, diagnostic: !!h.diagnostic,
      auroc: point.auroc, ci: ci.auroc ?? null, matchedAccuracy: point.matchedAccuracy, matchedCi: ci.matchedAccuracy ?? null,
      beatsDeployable: point.matchedAccuracy > DEPLOYABLE_PROBE, beatsDeployableBeyondNoise: (ci.matchedAccuracy?.lo ?? -1) > DEPLOYABLE_PROBE,
      beatsOracleProbe: point.matchedAccuracy > ORACLE_PROBE,
      codeOnSameSet: name === 'code' ? null : auroc(rows.map(r => r.c), rows.map(r => r.label)),
      deltaVsCode: name === 'code' ? null : point.delta, deltaCi: name === 'code' ? null : ci.delta ?? null,
      folds: oof.folds.map(f => ({ family: f.family, nTrain: f.train.length, nTest: f.test.length, w: f.model ? f.model.w.map(v => +v.toFixed(4)) : null, b: f.model ? +f.model.b.toFixed(4) : null })),
      scores: Object.fromEntries(rows.map(r => [r.taskKey, +r.s.toFixed(6)])),
    };
  }
  return out;
}

/** The pre-registered rule: AUROC >= 0.75 and beats the deployable probe at the matched threshold -> NR-static; AUROC in
 *  [0.60, 0.75) -> NR-knn only; < 0.60 -> stay out. An AUROC >= 0.75 that does not beat the probe falls to NR-knn. */
export function decide({ auroc: a, matchedAccuracy: m }, { probe = DEPLOYABLE_PROBE } = {}) {
  if (a === null || a === undefined) return 'not-evaluable';
  if (a >= 0.75 && m > probe) return 'NR-static';
  if (a >= 0.60) return 'NR-knn';
  return 'out';
}

// ---- property accuracy against the family truth table ---------------------------------------------------------------------

/** truth.json: { families: { <family>: { S1: 'yes'|'no', ... } } } or { <family>: {...} }; a cell may be { answer }.
 *  Keys starting with '_' are notes. Returns Map(family -> {S: 'yes'|'no'}). */
export function parseTruth(json) {
  const fams = json?.families ?? json ?? {}, m = new Map();
  for (const [f, cells] of Object.entries(fams)) {
    if (f.startsWith('_') || !cells || typeof cells !== 'object') continue;
    const row = {};
    for (const id of QUESTION_IDS) { const v = typeof cells[id] === 'object' && cells[id] !== null ? cells[id].answer : cells[id]; if (v === 'yes' || v === 'no') row[id] = v; }
    m.set(f, row);
  }
  return m;
}
const argmax = dist => { const best = Math.max(...OPTIONS.map(o => dist[o])); const top = OPTIONS.filter(o => Math.abs(dist[o] - best) < 1e-12); return top.length === 1 ? top[0] : 'tie'; };

/** Per family, the mean distribution over its tasks; the family's answer is the argmax (cannot_tell or a tie is a miss).
 *  Also the task-level accuracy (each task's own argmax vs its family truth). items: { family, [src]: {S: dist} }. */
export function propertyAccuracy(items, truth, src = 'jev') {
  const cells = [], perQuestion = Object.fromEntries(QUESTION_IDS.map(id => [id, { correct: 0, n: 0 }]));
  let taskCorrect = 0, taskN = 0;
  const fams = [...new Set(items.filter(i => i[src]).map(i => i.family))].sort();
  for (const f of fams) {
    const rows = items.filter(i => i.family === f && i[src]), t = truth.get(f);
    if (!t) continue;
    for (const id of QUESTION_IDS) {
      if (!t[id]) continue;
      const mean = Object.fromEntries(OPTIONS.map(o => [o, rows.reduce((s, r) => s + r[src][id][o], 0) / rows.length]));
      const said = argmax(mean), ok = said === t[id];
      cells.push({ family: f, q: id, truth: t[id], said, pYes: +mean.yes.toFixed(4), pNo: +mean.no.toFixed(4), pCannot: +mean.cannot_tell.toFixed(4), correct: ok });
      perQuestion[id].n++; perQuestion[id].correct += ok ? 1 : 0;
      for (const r of rows) { taskN++; taskCorrect += argmax(r[src][id]) === t[id] ? 1 : 0; }
    }
  }
  for (const v of Object.values(perQuestion)) v.accuracy = v.n ? v.correct / v.n : null;
  const correct = cells.filter(c => c.correct).length;
  return { cells, perQuestion, pooled: { correct, n: cells.length, accuracy: cells.length ? correct / cells.length : null },
    taskLevel: { correct: taskCorrect, n: taskN, accuracy: taskN ? taskCorrect / taskN : null }, misses: cells.filter(c => !c.correct).map(c => `${c.family}/${c.q}`) };
}

/** Kotte's abstention floor (F22): the abstention share forced at risk alpha by an error rate err: max(0, (err - alpha)/(1 - alpha)). */
export const kotteFloor = (accuracy, alpha = KOTTE_ALPHA) => (accuracy === null || accuracy === undefined ? null : Math.max(0, (1 - accuracy - alpha) / (1 - alpha)));

/** Share of Jev answers (task x question) whose max probability is below `p`, on the order-averaged and the raw answers. */
export function abstentionNote(jevRows, p = ABSTAIN_P) {
  const avg = [], raw = [], perQ = Object.fromEntries(QUESTION_IDS.map(id => [id, { low: 0, n: 0 }]));
  for (const r of jevRows) for (const id of QUESTION_IDS) {
    const m = Math.max(...OPTIONS.map(o => r.mean[id][o])); avg.push(m); perQ[id].n++; perQ[id].low += m < p ? 1 : 0;
    for (const pr of r.perms ?? []) raw.push(Math.max(...OPTIONS.map(o => pr.probs[id][o])));
  }
  const share = xs => (xs.length ? xs.filter(m => m < p).length / xs.length : null);
  return { threshold: p, averaged: { n: avg.length, share: share(avg) }, raw: { n: raw.length, share: share(raw) },
    perQuestion: Object.fromEntries(Object.entries(perQ).map(([k, v]) => [k, v.n ? v.low / v.n : null])) };
}

/** Order effects: per question, the mean over tasks of the spread (max - min) of p(yes) across the six orders, and the mean
 *  probability given to the option shown first / second / third. */
export function orderEffects(jevRows) {
  const out = {};
  for (const id of QUESTION_IDS) {
    const spreads = [], pos = [0, 0, 0]; let n = 0;
    for (const r of jevRows) {
      const ys = (r.perms ?? []).map(p => p.probs[id].yes); if (ys.length) spreads.push(Math.max(...ys) - Math.min(...ys));
      for (const p of r.perms ?? []) { p.order.forEach((o, k) => { pos[k] += p.probs[id][o]; }); n++; }
    }
    out[id] = { meanSpreadPYes: spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null, meanPByPosition: n ? pos.map(v => +(v / n).toFixed(4)) : null };
  }
  return out;
}

/** Served versions over every permutation response: { versions: {v: count}, single: bool }. */
export function servedVersions(jevRows) {
  const v = {};
  for (const r of jevRows) for (const p of r.perms ?? []) { const k = p.model ?? '(none)'; v[k] = (v[k] ?? 0) + 1; }
  return { versions: v, single: Object.keys(v).length <= 1 };
}

// ---- the analysis ---------------------------------------------------------------------------------------------------------

/** items: [{ taskKey, family, difficulty, code, jev?: {S: dist}, haiku?: {S: dist} }] (no labels); labelSets: {name: Map}.
 *  Pure apart from the bootstrap's seeded PRNG. */
export function analyze({ items, labelSets, primaryLabels = 'm1', truth = null, jevRows = [], haikuRows = [], reps = 2000, seed = 1, lambda = LAMBDA }) {
  const heads = {}, decisions = [];
  for (const [lname, labels] of Object.entries(labelSets)) {
    if (!labels) continue;
    heads[lname] = {};
    const labelled = items.filter(i => labels.has(i.taskKey)).map(i => ({ ...i, label: labels.get(i.taskKey).pass }));
    for (const [sname, keep] of [['d3', i => i.difficulty === 3], ['d3+d5', () => true]]) {
      const set = labelled.filter(keep);
      const h = evaluateHeads(set, { reps, seed, lambda });
      heads[lname][sname] = { n: set.length, positives: set.filter(i => i.label).length, baseRate: set.length ? set.filter(i => i.label).length / set.length : null, heads: h };
      const j = h['code+jev'];
      if (j && !j.skipped) decisions.push({ labels: lname, set: sname, auroc: j.auroc, ci: j.ci, matchedAccuracy: j.matchedAccuracy, branch: decide(j),
        deltaVsCode: j.deltaVsCode, deltaCi: j.deltaCi, codeAuroc: h.code?.auroc ?? null, incrementPositiveBeyondNoise: (j.deltaCi?.lo ?? -1) > 0 });
    }
  }
  const primary = decisions.find(d => d.labels === primaryLabels && d.set === 'd3+d5') ?? null;
  const properties = truth ? { jev: propertyAccuracy(items, truth, 'jev'), haiku: propertyAccuracy(items, truth, 'haiku') } : null;
  const abstention = abstentionNote(jevRows);
  const floor = properties?.jev.taskLevel.accuracy ?? null;
  const res = {
    schema: 'jev-need2/result@1', diagnostic: true, note: 'development/diagnostic evidence: 8 family clusters, leave-one-family-out, never held-out',
    prediction: PREDICTION,
    jev: { rows: jevRows.length, requested: [...new Set(jevRows.map(r => r.jevModel))], served: servedVersions(jevRows),
      usage: jevRows.reduce((u, r) => ({ input_tokens: u.input_tokens + (r.usage?.input_tokens ?? 0), output_tokens: u.output_tokens + (r.usage?.output_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0 }) },
    haiku: { rows: haikuRows.length, spentUsd: haikuRows.reduce((s, r) => s + (r.costUsd ?? 0) + (r.imputedUsd ?? 0), 0), engines: [...new Set(haikuRows.map(r => r.engineVersion))] },
    labels: Object.fromEntries(Object.entries(labelSets).map(([k, m]) => [k, m ? { tasks: m.size, pass: [...m.values()].filter(x => x.pass).length, timeouts: [...m.values()].reduce((s, x) => s + x.timeouts, 0) } : null])),
    primary: { labels: primaryLabels, set: 'd3+d5', rule: 'LOFO AUROC >= 0.75 and matched accuracy > 0.625 -> NR-static; 0.60-0.75 -> NR-knn only; < 0.60 -> out', decision: primary },
    decisions, heads,
    properties, truthCells: truth ? [...truth.values()].reduce((s, r) => s + Object.keys(r).length, 0) : 0,
    abstention: { ...abstention, kotteFloor: floor === null ? null : { alpha: KOTTE_ALPHA, taskLevelAccuracy: floor, floor: kotteFloor(floor) } },
    orderEffects: orderEffects(jevRows),
    baselines: { deployableProbe: DEPLOYABLE_PROBE, oracleProbe: ORACLE_PROBE },
    lambda, reps, seed,
  };
  res.predictions = checkPredictions(res, primaryLabels);
  return res;
}

const within = (x, lo, hi) => x !== null && x !== undefined && x >= lo && x <= hi;
/** The four recorded predictions, checked under the given labelling (null = not evaluable yet). */
export function checkPredictions(res, labels = 'm1') {
  const H = s => res.heads?.[labels]?.[s]?.heads ?? {};
  const d3 = H('d3'), all = H('d3+d5'), ok = h => h && !h.skipped;
  const pa = res.properties?.jev?.pooled?.n ? res.properties.jev : null;
  return {
    labels,
    'P-a': pa ? { held: pa.pooled.accuracy >= 0.75 && pa.misses.every(m => /\/S[46]$/.test(m)), pooled: pa.pooled.accuracy, misses: pa.misses } : { held: null, why: 'no truth table or no Jev rows' },
    'P-b': ok(d3.code) && ok(d3['code+jev']) ? { held: within(d3.code.auroc, 0.40, 0.60) && within(d3['code+jev'].auroc, 0.45, 0.65) && d3.code.auroc < 0.70 && d3['code+jev'].auroc < 0.70, code: d3.code.auroc, codeJev: d3['code+jev'].auroc }
      : { held: null, why: 'd3 heads not evaluable', code: ok(d3.code) ? d3.code.auroc : null },
    'P-c': ok(all.code) && ok(all['code+jev']) ? { held: !all.code.beatsDeployableBeyondNoise && !all['code+jev'].beatsDeployableBeyondNoise, code: all.code.matchedCi, codeJev: all['code+jev'].matchedCi }
      : { held: null, why: 'd3+d5 heads not evaluable' },
    'P-d': ok(all.code) && ok(all['code+jev']) ? { held: within(all.code.auroc, 0.60, 0.75) && all['code+jev'].deltaVsCode <= 0.03, code: all.code.auroc, delta: all['code+jev'].deltaVsCode }
      : { held: null, why: 'd3+d5 heads not evaluable', code: ok(all.code) ? all.code.auroc : null },
  };
}

const f2 = x => (x === null || x === undefined ? '–' : Number(x).toFixed(2));
const f3 = x => (x === null || x === undefined ? '–' : Number(x).toFixed(3));
const iv = c => (c ? `[${f2(c.lo)}, ${f2(c.hi)}]` : '–');

/** REPORT.md from a result (pure). */
export function renderReport(res, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const L = [];
  L.push(`# J-NEED-2: do Jev's task properties help predict whether one Haiku call solves a task? (${date}, dev, diagnostic)`, '');
  L.push('Design: `research/architecture-20261014/MEMORY-ROUTING-RECURSION.md` §3.1 and §5 row 5; decision 12 (Jev is never the mode picker; this only decides whether Jev property features enter NR-static, NR-knn or neither). Code: `experiments/need-router/jev-need2.mjs`. Development/diagnostic evidence only: 8 family clusters, leave-one-family-out; nothing here is held-out.', '');
  L.push('## Prediction (quoted verbatim from the spec)', '', `> ${res.prediction}`, '');
  const d = res.primary.decision;
  L.push('## Decision', '');
  L.push(`Rule (pre-registered): ${res.primary.rule}. Primary: labels \`${res.primary.labels}\`, all tasks (d3+d5), head code + Jev p(yes).`, '');
  if (d) {
    L.push(`**Branch: ${d.branch}.** code+Jev LOFO AUROC ${f3(d.auroc)} ${iv(d.ci)} (family bootstrap); accuracy at the base-rate-matched threshold ${f3(d.matchedAccuracy)} vs deployable probe ${DEPLOYABLE_PROBE} and oracle-checked probe ${ORACLE_PROBE}. Increment over code-only on the same tasks: ${f3(d.deltaVsCode)} ${iv(d.deltaCi)} (code-only ${f3(d.codeAuroc)}).`);
    if (d.branch !== 'out' && !d.incrementPositiveBeyondNoise) L.push('', `Caveat: the rule as written scores the head, not the increment; the Jev increment over code-only is not above noise (its interval includes 0), so the branch is carried by the code features, not by Jev.`);
  } else L.push('**Branch: not evaluable** (no Jev rows for the primary labelling yet).');
  L.push('', '| labels | set | code+Jev AUROC | 95% interval | matched acc | branch | Δ vs code | Δ interval |', '|---|---|---|---|---|---|---|---|');
  for (const x of res.decisions) L.push(`| ${x.labels} | ${x.set} | ${f3(x.auroc)} | ${iv(x.ci)} | ${f3(x.matchedAccuracy)} | ${x.branch} | ${f3(x.deltaVsCode)} | ${iv(x.deltaCi)} |`);
  L.push('', '## Heads (pooled out-of-fold, leave-one-family-out)', '');
  L.push(`L2 logistic regression (λ = ${res.lambda}, intercept free, IRLS), features standardized on the training families only. Code features: ${CODE_KEYS.join(', ')} (taskFeatures; logInputTokens is the log token count). Jev/Haiku features: p(yes) for S1..S6 (Haiku one-hot). Intervals: ${res.reps} family-cluster bootstrap replicates over the fixed out-of-fold scores (they omit refitting variability). "Matched acc": accuracy when as many tasks are called one-call-solvable as truly are (ties at random).`, '');
  L.push('| labels | set | n (pos) | head | n | AUROC | 95% interval | matched acc | 95% interval | > 0.625 | > 0.827 | Δ vs code | Δ interval |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [lname, sets] of Object.entries(res.heads)) for (const [sname, s] of Object.entries(sets)) for (const [h, r] of Object.entries(s.heads)) {
    if (r.skipped) { L.push(`| ${lname} | ${sname} | ${s.n} (${s.positives}) | ${h} | ${r.n} | skipped: ${r.skipped} | | | | | | | |`); continue; }
    L.push(`| ${lname} | ${sname} | ${s.n} (${s.positives}) | ${h}${r.diagnostic ? ' (diag.)' : ''}${r.fitted === false ? ' (no fit)' : ''} | ${r.n} | ${f3(r.auroc)} | ${iv(r.ci)} | ${f3(r.matchedAccuracy)} | ${iv(r.matchedCi)} | ${r.matchedAccuracy > DEPLOYABLE_PROBE ? 'yes' : 'no'} | ${r.matchedAccuracy > ORACLE_PROBE ? 'yes' : 'no'} | ${f3(r.deltaVsCode)} | ${iv(r.deltaCi)} |`);
  }
  L.push('', '## Property accuracy against the family truth table', '');
  if (!res.properties) L.push('Not scored: the truth table (`research/need-router-20261014/jneed2/truth.json`) is absent.');
  else {
    L.push(`Family answer = argmax of the mean distribution over the family's tasks (cannot_tell or a tie is a miss); ${res.truthCells} truth cells.`, '');
    L.push('| question | Jev | Haiku |', '|---|---|---|');
    for (const id of QUESTION_IDS) { const j = res.properties.jev.perQuestion[id], h = res.properties.haiku.perQuestion[id]; L.push(`| ${id} | ${j.correct}/${j.n} | ${h.correct}/${h.n} |`); }
    const j = res.properties.jev, h = res.properties.haiku;
    L.push(`| pooled cells | ${j.pooled.correct}/${j.pooled.n} (${f2(j.pooled.accuracy)}) | ${h.pooled.correct}/${h.pooled.n} (${f2(h.pooled.accuracy)}) |`);
    L.push(`| task-level answers | ${j.taskLevel.correct}/${j.taskLevel.n} (${f2(j.taskLevel.accuracy)}) | ${h.taskLevel.correct}/${h.taskLevel.n} (${f2(h.taskLevel.accuracy)}) |`, '');
    const missText = x => (x.pooled.n ? x.misses.join(', ') || 'none' : 'not scored (no rows)');
    L.push(`Jev misses: ${missText(j)}. Haiku misses: ${missText(h)}.`);
  }
  const a = res.abstention;
  L.push('', "## Kotte's abstention floor (F22)", '');
  L.push(`Share of Jev answers whose max probability is below ${a.threshold}: ${f2(a.averaged.share)} of ${a.averaged.n} order-averaged answers, ${f2(a.raw.share)} of ${a.raw.n} single-order answers (per question: ${QUESTION_IDS.map(id => `${id} ${f2(a.perQuestion[id])}`).join(', ')}).` +
    (a.kotteFloor ? ` At the task-level property accuracy ${f2(a.kotteFloor.taskLevelAccuracy)}, the floor at α = ${a.kotteFloor.alpha} is (1 − acc − α)/(1 − α) = ${f2(a.kotteFloor.floor)}.` : ' The formula floor needs the truth table.'));
  L.push('', '## Order effects (N7)', '', '| question | mean spread of p(yes) over the 6 orders | mean p by shown position (1st, 2nd, 3rd) |', '|---|---|---|');
  for (const id of QUESTION_IDS) { const o = res.orderEffects[id]; L.push(`| ${id} | ${f3(o.meanSpreadPYes)} | ${o.meanPByPosition ? o.meanPByPosition.join(', ') : '–'} |`); }
  L.push('', '## Predictions checked', '', `Under labels \`${res.predictions.labels}\`.`, '');
  for (const k of ['P-a', 'P-b', 'P-c', 'P-d']) { const p = res.predictions[k]; L.push(`- **${k}**: ${p.held === null ? 'not evaluable' : p.held ? 'held' : 'did not hold'}. ${JSON.stringify(Object.fromEntries(Object.entries(p).filter(([q]) => q !== 'held')))}`); }
  L.push('', '## Provenance', '');
  L.push(`Jev: ${res.jev.rows} task rows; requested ${res.jev.requested.join(', ') || '–'}; served ${Object.entries(res.jev.served.versions).map(([v, n]) => `${v} x${n}`).join(', ') || '–'}${res.jev.served.single ? '' : ' (**more than one served version**)'}; usage ${res.jev.usage.input_tokens} input / ${res.jev.usage.output_tokens} output tokens. Haiku arm: ${res.haiku.rows} rows, $${res.haiku.spentUsd.toFixed(4)}, engines ${res.haiku.engines.join(', ') || '–'}.`);
  L.push(`Labels: ${Object.entries(res.labels).map(([k, v]) => (v ? `${k} ${v.pass}/${v.tasks} one-call solvable (${v.timeouts} timed-out trials)` : `${k} absent`)).join('; ')}.`);
  L.push('', 'Caveats: families stand in for clusters (if two families share a world, as R3 and R3′ may, the folds are optimistic); the outcome is mostly constant within a family, so a head is close to a family classifier fitted on 7 points; the bootstrap holds the out-of-fold scores fixed; the truth table is authored per family, not per task or difficulty.');
  return L.join('\n') + '\n';
}

// ---- I/O (metered paths) --------------------------------------------------------------------------------------------------

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Rows of a complete Jev task (all six orders answered). */
export const completeJevRow = r => r && Array.isArray(r.perms) && r.perms.length === PERMUTATIONS.length && r.mean && QUESTION_IDS.every(id => r.mean[id]);

/** Latest complete row per task. */
export function latestRows(rows, ok = () => true) {
  const m = new Map(); for (const r of rows) if (ok(r)) m.set(r.taskKey, r); return m;
}

async function pool(items, n, fn) {
  let i = 0, stop = null;
  const worker = async () => { while (!stop && i < items.length) { const it = items[i++]; try { await fn(it); } catch (e) { stop = e; } } };
  await Promise.all(Array.from({ length: Math.max(1, n) }, worker));
  if (stop) throw stop;
}

/** The metered Jev pass (resumable). `client` ({ served, config }) is injectable for $0 tests; by default jevClient builds it
 *  from the policy and the environment variable it names. Returns an exit code: 0 done, 3 faults, 4 cap. */
export async function runJev({ tasks, live, cap, concurrency = 2, jevModel, client = null, backoffMs = 2000, log = console.log }) {
  const { jevClient, requestLedger } = await import('../kev-data/score-served.mjs');
  mkdirSync(live, { recursive: true });
  const rowsFile = path.join(live, 'rows.jsonl'), rawFile = path.join(live, 'rows.raw.jsonl'), faultsFile = path.join(live, 'rows.faults.jsonl');
  const done = latestRows(readRows(rowsFile, { repair: true }), completeJevRow);
  const todo = tasks.filter(t => !done.has(t.taskKey));
  const ledger = requestLedger({ file: path.join(live, 'requests.jsonl'), cap });
  const planned = todo.length * PERMUTATIONS.length;
  log(`Jev: ${tasks.length} tasks, ${done.size} done, ${todo.length} to ask = ${planned} requests; ledger ${ledger.count} of cap ${cap}`);
  if (!ledger.room(planned)) { log(`REFUSED: ${planned} requests would take the ledger past its cap of ${cap} (${ledger.count} used); raise --cap or use --limit`); return 4; }
  if (!todo.length) return 0;
  const { served, config } = client ?? jevClient({ model: jevModel });
  const seen = new Set();
  let faults = 0, capped = false;
  await pool(todo, concurrency, async t => {
    const perms = [];
    for (const order of PERMUTATIONS) {
      const req = buildJevRequest(t.task, order), hash = sha(JSON.stringify(req));
      let body = null, err = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        ledger.take({ tag: 'jev-need2', id: `${t.taskKey}|${order.join(',')}`, attempt, requestHash: hash });
        try { body = await served.ask(req); appendFileSync(rawFile, JSON.stringify({ taskKey: t.taskKey, order, attempt, at: new Date().toISOString(), requestHash: hash, ok: true, body }) + '\n'); break; }
        catch (e) {
          err = e.code ?? 'ERROR';
          appendFileSync(rawFile, JSON.stringify({ taskKey: t.taskKey, order, attempt, at: new Date().toISOString(), requestHash: hash, ok: false, error: { code: err, status: e.details?.status ?? e.status ?? null, message: String(e.message ?? e).slice(0, 300) } }) + '\n');
          if (err === 'REQUEST_CAP') throw e;
          if (!RETRYABLE.includes(err)) break;
          await sleep(backoffMs * 2 ** attempt);
        }
      }
      let probs = null;
      if (body) { try { probs = readJevAnswers(body); } catch (e) { err = `PROTOCOL: ${String(e.message).slice(0, 200)}`; } }
      if (!probs) { faults++; appendFileSync(faultsFile, JSON.stringify({ taskKey: t.taskKey, order, error: err, at: new Date().toISOString() }) + '\n'); return; }
      if (body.model && !seen.has(body.model)) { seen.add(body.model); if (seen.size > 1) log(`WARNING: responses name more than one version: ${[...seen].join(', ')}`); }
      // probs: normalized and keyed by option name; rawProbs: the response's probabilities exactly as served
      perms.push({ order: [...order], model: body.model ?? null, usage: body.usage ?? null, probs, rawProbs: Object.fromEntries(QUESTION_IDS.map(id => [id, body.answers[id].probabilities])) });
    }
    const usage = perms.reduce((u, p) => ({ input_tokens: u.input_tokens + (p.usage?.input_tokens ?? 0), output_tokens: u.output_tokens + (p.usage?.output_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0 });
    const row = { taskKey: t.taskKey, family: t.family, difficulty: t.difficulty, jevModel: config.model, models: [...new Set(perms.map(p => p.model))], usage, perms, mean: averagePerms(perms.map(p => p.probs)), at: new Date().toISOString() };
    appendFileSync(rowsFile, JSON.stringify(row) + '\n');
    log(`  ${t.taskKey.padEnd(26)} ${QUESTION_IDS.map(id => `${id} ${row.mean[id].yes.toFixed(2)}`).join(' ')}`);
  }).catch(e => { if (e.code === 'REQUEST_CAP') { capped = true; log(`CAP: ${e.message}; complete tasks so far are kept`); return; } throw e; });
  log(`Jev: ${capped ? 'stopped at the cap' : 'done'}; ${faults} task(s) with a failed order (in rows.faults.jsonl; re-run to resume); served ${[...seen].join(', ') || '–'}`);
  return capped ? 4 : faults ? 3 : 0;
}

/** The metered Haiku typed arm (resumable, hard $ cap with the per-call budget reserved for calls in flight). `port` is
 *  injectable for $0 tests; by default a journaled ModelPort restricted to Haiku. Returns 0 done, 3 faults, 4 cap. */
export async function runHaiku({ tasks, live, capUsd = 2, concurrency = 4, port: injected = null, log = console.log }) {
  mkdirSync(live, { recursive: true });
  const rowsFile = path.join(live, 'haiku-rows.jsonl'), faultsFile = path.join(live, 'haiku-rows.faults.jsonl');
  const prior = readRows(rowsFile, { repair: true }), done = latestRows(prior, r => r.ok);
  let spent = prior.reduce((s, r) => s + (r.costUsd ?? 0) + (r.imputedUsd ?? 0), 0) + readRows(faultsFile, { repair: true }).reduce((s, r) => s + (r.costUsd ?? 0) + (r.imputedUsd ?? 0), 0);
  const todo = tasks.filter(t => !done.has(t.taskKey));
  const maxPerCall = 0.2;
  log(`Haiku: ${tasks.length} tasks, ${done.size} done, ${todo.length} to ask; spent $${spent.toFixed(4)} of cap $${capUsd} (<= $${maxPerCall} per call)`);
  if (!todo.length) return 0;
  const port = injected ?? (await import('../lib/models.mjs')).createModelPort({ journalFile: path.join(live, 'haiku.sqlite'), allowedModels: [HAIKU_MODEL], maxBudgetUsdPerCall: maxPerCall }).port;
  let inflight = 0, capped = false, faults = 0;
  await pool(todo, concurrency, async t => {
    if (capped) return;
    if (spent + (inflight + 1) * maxPerCall > capUsd + 1e-9) { capped = true; log(`CAP: $${spent.toFixed(4)} spent + ${inflight + 1} x $${maxPerCall} reserved > $${capUsd}; stopping (rows so far are kept)`); return; }
    inflight++;
    let r;
    try {
      const req = buildHaikuRequest(t.task);
      r = await port.call({ runId: `jev-need2-haiku:${t.taskKey}`, nodeKey: 'properties', modelId: HAIKU_MODEL, system: req.system, prompt: req.prompt, schema: req.schema,
        decoding: { maxTokens: 2000, reasoning: 'none' }, salt: 'jev-need2-haiku' });
    } catch (e) {     // a port refusal or cancellation is a fault row (its journaled spend, if any, still counts)
      r = { ok: false, modelId: HAIKU_MODEL, error: { code: e.code ?? 'ERROR', message: String(e.message ?? e).slice(0, 300) }, costUsd: e.details?.costUsd ?? 0, imputedUsd: e.details?.imputedUsd ?? 0, latencyMs: e.details?.latencyMs ?? null };
    } finally { inflight--; }
    spent += (r.costUsd ?? 0) + (r.imputedUsd ?? 0);
    const row = { taskKey: t.taskKey, family: t.family, difficulty: t.difficulty, ok: !!r.ok, modelId: r.modelId, engineVersion: r.engineVersion ?? null, answers: r.ok ? r.value : null,
      usage: r.usage ?? null, costUsd: r.costUsd ?? 0, imputedUsd: r.imputedUsd ?? 0, latencyMs: r.latencyMs, error: r.ok ? null : r.error, journalId: r.journalId ?? null, at: new Date().toISOString() };
    if (r.ok) appendFileSync(rowsFile, JSON.stringify(row) + '\n'); else { faults++; appendFileSync(faultsFile, JSON.stringify(row) + '\n'); }
    log(`  ${t.taskKey.padEnd(26)} ${r.ok ? QUESTION_IDS.map(id => `${id} ${r.value[id]}`).join(' ') : `ERROR ${r.error?.code}`}  $${(r.costUsd ?? 0).toFixed(4)}`);
  });
  log(`Haiku: spent $${spent.toFixed(4)} of $${capUsd}; ${faults} fault(s)`);
  return capped ? 4 : faults ? 3 : 0;
}

const LIVE_FILES = ['rows.jsonl', 'rows.raw.jsonl', 'rows.faults.jsonl', 'requests.jsonl', 'haiku-rows.jsonl', 'haiku-rows.faults.jsonl'];
function copyIn(live, out) {
  mkdirSync(out, { recursive: true });
  for (const f of LIVE_FILES) if (existsSync(path.join(live, f))) copyFileSync(path.join(live, f), path.join(out, f));
}

async function runAnalysis({ out, truthFile, primaryLabels, reps }) {
  const keys = taskKeysOf();
  const tasks = await loadTasks(keys);
  const jevRows = [...latestRows(readJsonl(path.join(out, 'rows.jsonl')), completeJevRow).values()];
  const haikuRows = [...latestRows(readJsonl(path.join(out, 'haiku-rows.jsonl')), r => r.ok).values()];
  const jev = new Map(jevRows.map(r => [r.taskKey, r.mean])), haiku = new Map(haikuRows.map(r => [r.taskKey, haikuDist(r.answers)]));
  const items = tasks.map(t => ({ taskKey: t.taskKey, family: t.family, difficulty: t.difficulty, code: t.code, jev: jev.get(t.taskKey) ?? null, haiku: haiku.get(t.taskKey) ?? null }));
  const labelSets = { m1: loadLabels('m1'), m1r: loadLabels('m1r') };
  if (!labelSets[primaryLabels]) throw new Error(`labelling ${primaryLabels} is not available`);
  const truth = existsSync(truthFile) ? parseTruth(JSON.parse(readFileSync(truthFile, 'utf8'))) : null;
  const res = analyze({ items, labelSets, primaryLabels, truth, jevRows, haikuRows, reps });
  res.truthFile = truth ? path.relative(ROOT, truthFile) : null;
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'result.json'), JSON.stringify(res, null, 1) + '\n');
  writeFileSync(path.join(out, 'REPORT.md'), renderReport(res));
  const d = res.primary.decision;
  console.log(`analysis: ${items.length} tasks; Jev rows ${jevRows.length}, Haiku rows ${haikuRows.length}; truth ${truth ? `${res.truthCells} cells` : 'absent'}; labels ${Object.entries(res.labels).map(([k, v]) => `${k} ${v ? `${v.pass}/${v.tasks}` : 'absent'}`).join(', ')}`);
  for (const [l, sets] of Object.entries(res.heads)) for (const [s, x] of Object.entries(sets)) console.log(`  ${l} ${s.padEnd(5)} ${Object.entries(x.heads).map(([h, r]) => `${h} ${r.skipped ? 'skip' : f3(r.auroc)}`).join('  ')}`);
  console.log(`decision (${res.primary.labels}, d3+d5): ${d ? `${d.branch} (AUROC ${f3(d.auroc)} ${iv(d.ci)}, matched acc ${f3(d.matchedAccuracy)}, Δ vs code ${f3(d.deltaVsCode)} ${iv(d.deltaCi)})` : 'not evaluable (no Jev rows)'}`);
  console.log(`Kotte note: ${f2(res.abstention.averaged.share)} of order-averaged Jev answers have max p < ${ABSTAIN_P}${res.abstention.kotteFloor ? `; floor at alpha ${KOTTE_ALPHA} = ${f2(res.abstention.kotteFloor.floor)}` : ''}`);
  console.log(`wrote ${path.relative(ROOT, path.join(out, 'result.json'))} and REPORT.md`);
  return 0;
}

/** --dry: every request built, counted and priced; no network, no key. */
export function dryPlan(tasks, { policyHaikuPrice = null, jevModel = 'jev-latest' } = {}) {
  let jevChars = 0, jevN = 0, haikuChars = 0;
  for (const t of tasks) {
    for (const order of PERMUTATIONS) { jevChars += JSON.stringify({ ...buildJevRequest(t.task, order), model: jevModel }).length; jevN++; }
    const h = buildHaikuRequest(t.task); haikuChars += h.system.length + h.prompt.length + JSON.stringify(h.schema).length;
  }
  const jevTokens = Math.ceil(jevChars / 4), haikuTokens = Math.ceil(haikuChars / 4);
  return { tasks: tasks.length, jevRequests: jevN, jevTokens, jevUsd: jevTokens * JEV_USD_PER_MTOK / 1e6, haikuCalls: tasks.length, haikuInputTokens: haikuTokens,
    haikuInputUsdAtList: policyHaikuPrice ? haikuTokens * policyHaikuPrice / 1e6 : null };
}

function defaultJevModel() {
  return import('../../src/models/policy.mjs').then(({ loadPolicy }) => {
    const ids = (loadPolicy().policy.judgmentModels ?? []).map(m => m.id).filter(id => /^jev-/.test(id));
    return ids.find(id => /^jev-\d+\.\d+\.\d+$/.test(id)) ?? (ids.includes('jev-latest') ? 'jev-latest' : ids[0]);
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const has = k => argv.includes(k);
  const live = arg('--live', LIVE_DIR), out = path.resolve(arg('--out', OUT_DIR)), truthFile = path.resolve(arg('--truth', TRUTH_FILE));
  const primaryLabels = arg('--labels', 'm1');
  if (!['m1', 'm1r'].includes(primaryLabels)) throw new Error('--labels is m1 or m1r');
  const reps = Number(arg('--reps', '2000'));
  if (has('--analyze')) { if (existsSync(live)) copyIn(live, out); return runAnalysis({ out, truthFile, primaryLabels, reps }); }
  let keys = taskKeysOf();
  const limit = Number(arg('--limit', '0')); if (limit > 0) keys = keys.slice(0, limit);
  const tasks = await loadTasks(keys);
  const jevModel = arg('--jev-model', await defaultJevModel());
  if (has('--dry')) {
    const { loadPolicy } = await import('../../src/models/policy.mjs');
    const price = loadPolicy().policy.models.find(m => m.id === HAIKU_MODEL)?.price?.inputPerMTok ?? null;
    const p = dryPlan(tasks, { policyHaikuPrice: price, jevModel });
    const fams = tasks.reduce((m, t) => { m[`${t.family}@d${t.difficulty}`] = (m[`${t.family}@d${t.difficulty}`] ?? 0) + 1; return m; }, {});
    console.log(`DRY (no network): ${p.tasks} tasks (${Object.entries(fams).map(([k, n]) => `${k} ${n}`).join(', ')})`);
    console.log(`  Jev ${jevModel}: ${p.jevRequests} requests (${PERMUTATIONS.length} option orders x ${QUESTION_IDS.length} questions each); ~${p.jevTokens} input tokens (chars/4); ~$${p.jevUsd.toFixed(4)} at $${JEV_USD_PER_MTOK}/M input; cap ${arg('--cap', '1000')} requests`);
    console.log(`  Haiku ${HAIKU_MODEL}: ${p.haikuCalls} calls; ~${p.haikuInputTokens} prompt tokens (chars/4) ~$${p.haikuInputUsdAtList?.toFixed(4) ?? '?'} input at list price, before the CLI's own prompt and output; cap $${arg('--haiku-cap', '2')}`);
    console.log(`  labels: m1 ${loadLabels('m1') ? 'present' : 'absent'}, m1r ${loadLabels('m1r') ? 'present' : 'absent (runs/m1-r/merged.jsonl)'}; truth ${existsSync(truthFile) ? 'present' : `absent (${path.relative(ROOT, truthFile)})`}`);
    console.log('--- first Jev request (order yes,no,cannot_tell), state truncated ---');
    const r0 = buildJevRequest(tasks[0].task, OPTIONS);
    console.log(JSON.stringify({ ...r0, state: r0.state.slice(0, 400) + (r0.state.length > 400 ? ' ...' : '') }, null, 1).slice(0, 2400));
    return 0;
  }
  mkdirSync(live, { recursive: true });
  let code;
  if (has('--haiku')) code = await runHaiku({ tasks, live, capUsd: Number(arg('--haiku-cap', '2')), concurrency: Number(arg('--concurrency', '4')) });
  else code = await runJev({ tasks, live, cap: Number(arg('--cap', '1000')), concurrency: Number(arg('--concurrency', '2')), jevModel });
  copyIn(live, out);
  await runAnalysis({ out, truthFile, primaryLabels, reps });
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
