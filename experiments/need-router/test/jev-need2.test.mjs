// J-NEED-2 tests ($0: no model or API calls). node --test experiments/need-router/test/jev-need2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPTIONS, QUESTION_IDS, PERMUTATIONS, PROPERTY_QUESTIONS, NO_MATCH, PREDICTION, permutations, jevQuestions, buildJevRequest, readJevAnswers, averagePerms,
  buildHaikuRequest, haikuDist, HAIKU_SCHEMA, auroc, matchedAccuracy, fitLogistic, predictLogistic, standardizer, lofoHead, clusterBootstrap,
  propertyAccuracy, parseTruth, decide, kotteFloor, abstentionNote, orderEffects, servedVersions, analyze, renderReport, labelsFromRows, taskKeysOf,
  parseKey, dryPlan, completeJevRow, evaluateHeads, CODE_KEYS,
} from '../jev-need2.mjs';
import { auroc as aurocSlow, stateOf } from '../jev-need.mjs';
import { rng } from '../metrics.mjs';
import { makeTasks } from '../../lib/beds.mjs';
import { checkPortableSchema } from '../../../src/models/port.mjs';

const gauss = r => () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const dist = (yes, no, ct) => ({ yes, no, cannot_tell: ct });

// ---- questions and permutations -------------------------------------------------------------------------------------------

test('six option orders, each a permutation of yes/no/cannot_tell, the first the identity', () => {
  assert.equal(PERMUTATIONS.length, 6);
  assert.deepEqual([...PERMUTATIONS[0]], [...OPTIONS]);
  assert.equal(new Set(PERMUTATIONS.map(p => p.join())).size, 6);
  for (const p of PERMUTATIONS) assert.deepEqual([...p].sort(), [...OPTIONS].sort());
  assert.equal(permutations([1, 2, 3, 4]).length, 24);
});

test('every question offers the three options, a no-match option, and descriptions that follow the option names in any order', () => {
  assert.deepEqual(QUESTION_IDS, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  for (const order of PERMUTATIONS) {
    const qs = jevQuestions(order);
    assert.deepEqual(Object.keys(qs), [...QUESTION_IDS]);
    for (const id of QUESTION_IDS) {
      assert.equal(qs[id].type, 'choice');
      assert.deepEqual(Object.keys(qs[id].criteria), [...order], 'criteria keys follow the requested order');
      assert.equal(qs[id].criteria.yes, PROPERTY_QUESTIONS[id].yes);
      assert.equal(qs[id].criteria.no, PROPERTY_QUESTIONS[id].no);
      assert.equal(qs[id].criteria.cannot_tell, NO_MATCH);
      assert.equal(qs[id].instructions, PROPERTY_QUESTIONS[id].question);
    }
  }
  assert.throws(() => jevQuestions(['yes', 'no', 'maybe']));
});

test('permutation mapping round-trip: probabilities return to option names whatever order was shown', () => {
  const truth = Object.fromEntries(QUESTION_IDS.map((id, k) => [id, dist(0.1 + 0.1 * k, 0.6 - 0.05 * k, 0.3 - 0.05 * k)]));
  for (const order of PERMUTATIONS) {
    const req = buildJevRequest({ prompt: 'p' }, order);
    // a server answers with a probability per offered option name, listed in the order it was shown
    const body = { model: 'jev-1.13.0', answers: Object.fromEntries(QUESTION_IDS.map(id => [id, { type: 'choice', probabilities: Object.fromEntries(Object.keys(req.questions[id].criteria).map(o => [o, truth[id][o]])) }])) };
    const back = readJevAnswers(body);
    for (const id of QUESTION_IDS) for (const o of OPTIONS) close(back[id][o], truth[id][o] / (truth[id].yes + truth[id].no + truth[id].cannot_tell));
  }
  // an answer that does not cover exactly the offered names is refused, never silently remapped
  assert.throws(() => readJevAnswers({ answers: { ...Object.fromEntries(QUESTION_IDS.map(id => [id, { type: 'choice', probabilities: { yes: 1, no: 0, cannot_tell: 0 } }])), S3: { type: 'choice', probabilities: { a: 1, b: 0, c: 0 } } } }));
  assert.throws(() => readJevAnswers({ answers: {} }));
});

test('averaging over the six orders cancels a position bias and keeps the named signal', () => {
  const d = dist(0.7, 0.2, 0.1);
  // each order: 60% the named distribution, 40% on whichever option is shown first
  const perms = PERMUTATIONS.map(order => Object.fromEntries(QUESTION_IDS.map(id => [id, Object.fromEntries(OPTIONS.map(o => [o, 0.6 * d[o] + (order[0] === o ? 0.4 : 0)]))])));
  const avg = averagePerms(perms);
  for (const id of QUESTION_IDS) for (const o of OPTIONS) close(avg[id][o], 0.6 * d[o] + 0.4 / 3);
  for (const id of QUESTION_IDS) close(avg[id].yes + avg[id].no + avg[id].cannot_tell, 1);
  assert.throws(() => averagePerms([]));
  const rows = [{ perms: PERMUTATIONS.map((order, k) => ({ order: [...order], model: 'jev-1.13.0', probs: perms[k] })), mean: avg }];
  const oe = orderEffects(rows);
  close(oe.S1.meanPByPosition[0], 0.6 * (d.yes + d.no + d.cannot_tell) / 3 + 0.4, 1e-4);   // first position carries the bias
  close(oe.S1.meanSpreadPYes, 0.4);
  assert.deepEqual(servedVersions(rows), { versions: { 'jev-1.13.0': 6 }, single: true });
  rows[0].perms[3].model = 'jev-1.14.0';
  assert.equal(servedVersions(rows).single, false);
  assert.ok(completeJevRow({ perms: rows[0].perms, mean: avg }));
  assert.ok(!completeJevRow({ perms: rows[0].perms.slice(1), mean: avg }));
});

// ---- statistics -----------------------------------------------------------------------------------------------------------

test('AUROC (rank form) equals the pairwise definition, ties counting half', () => {
  const r = rng(5);
  for (let t = 0; t < 20; t++) {
    const n = 30 + Math.floor(r() * 40), s = Array.from({ length: n }, () => Math.round(r() * 8) / 8), y = Array.from({ length: n }, () => r() < 0.4);
    const a = auroc(s, y), b = aurocSlow(s, y);
    if (b === null) assert.equal(a, null); else close(a, b, 1e-12);
  }
  assert.equal(auroc([1, 2], [true, true]), null);
});

test('matched-threshold accuracy calls as many positives as there are, ties broken at random in expectation', () => {
  assert.equal(matchedAccuracy([0.9, 0.8, 0.2, 0.1], [true, true, false, false]), 1);
  assert.equal(matchedAccuracy([0.1, 0.2, 0.8, 0.9], [true, true, false, false]), 0);
  // all tied: 2 of 4 called positive at random -> expected accuracy 0.5
  close(matchedAccuracy([0.5, 0.5, 0.5, 0.5], [true, true, false, false]), 0.5);
  // top one certain, then a tie of two for the remaining slot (one pos, one neg): expected 1 + 0.5 + 0.5 + 1 = 3 of 4
  close(matchedAccuracy([0.9, 0.5, 0.5, 0.1], [true, true, false, false]), 0.75);
});

test('the logistic head recovers a planted signal and ignores noise', () => {
  const r = rng(11), g = gauss(r), n = 600;
  const X = Array.from({ length: n }, () => [g(), g(), g()]);
  const y = X.map(x => (r() < 1 / (1 + Math.exp(-(2 * x[0] - 0.5))) ? 1 : 0));
  const m = fitLogistic(X, y, { lambda: 0.01 });
  assert.ok(Math.abs(m.w[0] - 2) < 0.4, `w0 ${m.w[0]}`);
  assert.ok(Math.abs(m.w[1]) < 0.3 && Math.abs(m.w[2]) < 0.3, `noise weights ${m.w}`);
  assert.ok(Math.abs(m.b + 0.5) < 0.3, `b ${m.b}`);
  assert.ok(auroc(X.map(x => predictLogistic(m, x)), y.map(Boolean)) > 0.8);
  // L2 shrinks; separable data stays finite
  const strong = fitLogistic(X, y, { lambda: 50 });
  assert.ok(Math.abs(strong.w[0]) < Math.abs(m.w[0]));
  const sep = fitLogistic([[-2], [-1], [1], [2]], [0, 0, 1, 1], { lambda: 1 });
  assert.ok(Number.isFinite(sep.w[0]) && sep.w[0] > 0);
});

test('standardizer: training mean and sd; constant columns map to zero', () => {
  const st = standardizer([[1, 5], [3, 5]]);
  assert.deepEqual(st.mean, [2, 5]); assert.deepEqual(st.sd, [1, 0]);
  assert.deepEqual(st.apply([[4, 9]]), [[2, 0]]);
});

const synthItems = ({ fams = 8, per = 12, signal = true, seed = 3 } = {}) => {
  const r = rng(seed), g = gauss(r), items = [];
  for (let f = 0; f < fams; f++) {
    const pass = f % 2 === 0;
    for (let k = 0; k < per; k++) items.push({ taskKey: `fam${f}:dev:d3:s${k}`, family: `fam${f}`, difficulty: 3, label: pass,
      x: [signal ? (pass ? 1 : -1) + 0.6 * g() : g(), g()] });
  }
  return items;
};

test('LOFO never trains on the held-out family, and standardizes on the training families only', () => {
  const items = synthItems();
  const seen = [];
  const spy = (X, y, opts) => { seen.push(X.length); return fitLogistic(X, y, opts); };
  const { scores, folds } = lofoHead(items, i => i.x, { fit: spy });
  assert.equal(folds.length, 8); assert.equal(scores.size, items.length);
  for (const f of folds) {
    const train = new Set(f.train);
    assert.ok(items.filter(i => i.family === f.family).every(i => !train.has(i.taskKey)), `fold ${f.family} trained on its own family`);
    assert.deepEqual(f.test.sort(), items.filter(i => i.family === f.family).map(i => i.taskKey).sort());
    const tr = items.filter(i => i.family !== f.family);
    close(f.mean[0], tr.reduce((s, i) => s + i.x[0], 0) / tr.length, 1e-12);
  }
  assert.deepEqual(seen, folds.map(f => f.train.length));
  // a held-out family whose feature is shifted far away changes only its own scores, never the other folds' models
  const shifted = items.map(i => (i.family === 'fam0' ? { ...i, x: [i.x[0] + 100, i.x[1]] } : i));
  const b = lofoHead(shifted, i => i.x);
  const fold0 = lofoHead(items, i => i.x).folds.find(f => f.family === 'fam0'), fold0b = b.folds.find(f => f.family === 'fam0');
  assert.deepEqual(fold0.mean, fold0b.mean);
  assert.deepEqual(fold0.model.w, fold0b.model.w);
});

test('LOFO head: a planted family-level signal generalizes; pure noise does not', () => {
  const good = synthItems({ signal: true });
  const s = lofoHead(good, i => i.x).scores;
  assert.ok(auroc(good.map(i => s.get(i.taskKey)), good.map(i => i.label)) > 0.9);
  const noise = synthItems({ signal: false, seed: 9 });
  const n = lofoHead(noise, i => i.x).scores;
  assert.ok(auroc(noise.map(i => n.get(i.taskKey)), noise.map(i => i.label)) < 0.7);
});

test('family-cluster bootstrap is seeded and brackets the point estimate', () => {
  const items = synthItems().map(i => ({ ...i, s: i.x[0] }));
  const stat = s => ({ auroc: auroc(s.map(i => i.s), s.map(i => i.label)) });
  const a = clusterBootstrap(items, stat, { reps: 300, seed: 4 }), b = clusterBootstrap(items, stat, { reps: 300, seed: 4 });
  assert.deepEqual(a, b);
  const p = stat(items).auroc;
  assert.ok(a.auroc.lo <= p && p <= a.auroc.hi);
  assert.ok(a.auroc.n <= 300);          // replicates with one class are dropped
});

// ---- property accuracy, decision, notes -----------------------------------------------------------------------------------

test('property accuracy on a toy table: argmax per family, cannot_tell and ties are misses', () => {
  const one = (S1, S2) => ({ ...Object.fromEntries(QUESTION_IDS.map(id => [id, dist(0.2, 0.7, 0.1)])), S1, S2 });
  const items = [
    { family: 'A', jev: one(dist(0.8, 0.1, 0.1), dist(0.2, 0.2, 0.6)) },
    { family: 'A', jev: one(dist(0.6, 0.3, 0.1), dist(0.3, 0.2, 0.5)) },
    { family: 'B', jev: one(dist(0.4, 0.4, 0.2), dist(0.1, 0.8, 0.1)) },
    { family: 'C', jev: null },
  ];
  const truth = parseTruth({ families: { A: { S1: 'yes', S2: 'no', S3: 'no', evidence: 'x' }, B: { S1: 'yes', S2: 'no' }, _note: 'ignored' } });
  const r = propertyAccuracy(items, truth, 'jev');
  const cell = (f, q) => r.cells.find(c => c.family === f && c.q === q);
  assert.equal(cell('A', 'S1').said, 'yes'); assert.equal(cell('A', 'S1').correct, true);
  assert.equal(cell('A', 'S2').said, 'cannot_tell'); assert.equal(cell('A', 'S2').correct, false);
  assert.equal(cell('A', 'S3').correct, true);
  assert.equal(cell('B', 'S1').said, 'tie'); assert.equal(cell('B', 'S1').correct, false);
  assert.equal(cell('B', 'S2').correct, true);
  assert.deepEqual(r.pooled, { correct: 3, n: 5, accuracy: 0.6 });
  assert.deepEqual(r.perQuestion.S1, { correct: 1, n: 2, accuracy: 0.5 });
  assert.deepEqual(r.misses.sort(), ['A/S2', 'B/S1']);
  assert.deepEqual(r.taskLevel, { correct: 5, n: 8, accuracy: 0.625 });   // S1: A 2/2, B 0/1 (tie); S2: A 0/2, B 1/1; S3: A 2/2
  // Haiku answers are one-hot
  assert.deepEqual(haikuDist({ S1: 'yes', S2: 'cannot_tell', S3: 'no', S4: 'no', S5: 'no', S6: 'yes' }).S2, dist(0, 0, 1));
});

test('decision rule branches, Kotte floor and the abstention note', () => {
  assert.equal(decide({ auroc: 0.80, matchedAccuracy: 0.70 }), 'NR-static');
  assert.equal(decide({ auroc: 0.80, matchedAccuracy: 0.60 }), 'NR-knn');
  assert.equal(decide({ auroc: 0.65, matchedAccuracy: 0.90 }), 'NR-knn');
  assert.equal(decide({ auroc: 0.60, matchedAccuracy: 0.50 }), 'NR-knn');
  assert.equal(decide({ auroc: 0.59, matchedAccuracy: 0.90 }), 'out');
  assert.equal(decide({ auroc: null }), 'not-evaluable');
  close(kotteFloor(0.774), (0.226 - 0.05) / 0.95, 1e-12);
  assert.equal(kotteFloor(0.99), 0);
  const mean = Object.fromEntries(QUESTION_IDS.map((id, k) => [id, k < 3 ? dist(0.5, 0.3, 0.2) : dist(0.9, 0.05, 0.05)]));
  const n = abstentionNote([{ mean, perms: [] }]);
  assert.equal(n.averaged.share, 0.5); assert.equal(n.perQuestion.S1, 1); assert.equal(n.perQuestion.S6, 0);
});

test('labels: a task passes when one call passed at either effort', () => {
  const m = labelsFromRows([
    { taskKey: 'a:dev:d3:s1', family: 'a', pass: false, error: { code: 'MODEL_TIMEOUT' } }, { taskKey: 'a:dev:d3:s1', family: 'a', pass: true },
    { taskKey: 'a:dev:d3:s2', family: 'a', pass: false }, { taskKey: 'a:dev:d3:s2', family: 'a', pass: false },
  ]);
  assert.equal(m.get('a:dev:d3:s1').pass, true); assert.equal(m.get('a:dev:d3:s1').timeouts, 1);
  assert.equal(m.get('a:dev:d3:s2').pass, false);
  assert.deepEqual(parseKey('wbed-r3p:dev:d5:s481'), { family: 'wbed-r3p', split: 'dev', difficulty: 5, seed: 481 });
});

test('analysis end to end on synthetic rows: heads, decision, predictions and a report quoting the prediction verbatim', () => {
  const r = rng(21), items = [], labels = new Map(), jevRows = [];
  for (let f = 0; f < 8; f++) for (let k = 0; k < 10; k++) {
    const key = `w-r${f}:dev:d${k < 6 ? 3 : 5}:s${k}`, pass = f < 4 ? r() < 0.85 : r() < 0.15;
    const code = Object.fromEntries(CODE_KEYS.map(c => [c, r()]));
    const mean = Object.fromEntries(QUESTION_IDS.map(id => { const y = id === 'S2' ? (f < 4 ? 0.2 : 0.8) : 0.5; return [id, dist(y, 0.9 - y, 0.1)]; }));
    items.push({ taskKey: key, family: `w-r${f}`, difficulty: k < 6 ? 3 : 5, code, jev: mean, haiku: null });
    labels.set(key, { pass, timeouts: 0 });
    jevRows.push({ taskKey: key, jevModel: 'jev-latest', mean, perms: [], usage: { input_tokens: 10, output_tokens: 1 } });
  }
  const truth = parseTruth({ families: Object.fromEntries(Array.from({ length: 8 }, (_, f) => [`w-r${f}`, { S2: f < 4 ? 'no' : 'yes' }])) });
  const res = analyze({ items, labelSets: { m1: labels, m1r: null }, truth, jevRows, reps: 200 });
  const all = res.heads.m1['d3+d5'].heads;
  assert.ok(all['code+jev'].auroc > all.code.auroc, 'the planted S2 property adds to random code features');
  assert.ok(all['code+jev'].auroc > 0.75);
  assert.equal(all['code+haiku'].skipped !== undefined, true);
  assert.equal(res.primary.decision.labels, 'm1');
  assert.equal(res.primary.decision.branch, decide(all['code+jev']));
  assert.equal(res.properties.jev.pooled.accuracy, 1);
  // a perfect table meets the accuracy part but not "misses on S4 and S6"
  assert.equal(res.predictions['P-a'].accuracyAtLeast075, true);
  assert.equal(res.predictions['P-a'].missesOnlyOnS4S6, true);
  assert.equal(res.predictions['P-a'].missOnS4, false);
  assert.equal(res.predictions['P-a'].held, false);
  assert.ok(['NR-static', 'NR-knn', 'out'].includes(res.primary.decision.branch));
  const md = renderReport(res, { date: '2026-10-15' });
  assert.ok(md.includes(`> ${PREDICTION}`));
  assert.ok(md.includes(`**Branch: ${res.primary.decision.branch}.**`));
  assert.ok(!JSON.stringify(res).includes('"task":'), 'no task bodies in the result');
  // the heads see no outcome in their features: shuffling labels changes nothing in the feature vectors
  const h = evaluateHeads(items.map(i => ({ ...i, label: labels.get(i.taskKey).pass })), { reps: 50 });
  assert.ok(h['size-rule'].auroc !== null);
});

// ---- request bodies never carry a label, an outcome or identity (real tasks, $0) ------------------------------------------

const ALLOWED_KEYS = new Set(['state', 'questions', ...QUESTION_IDS, 'type', 'instructions', 'criteria', ...OPTIONS]);
const keysOf = (o, acc = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); keysOf(v, acc); } return acc; };

test('no label, outcome or identity field ever appears in a Jev or Haiku request body (real M1 tasks)', async () => {
  const keys = taskKeysOf();
  assert.equal(keys.length, 144);
  const pick = ['wbed-r0:dev:d3', 'wbed-r2:dev:d3', 'wbed-r3p:dev:d5', 'wbed-r6:dev:d5'].map(p => keys.find(k => k.startsWith(`${p}:`)));
  for (const key of pick) {
    const { family, split, difficulty, seed } = parseKey(key);
    const t = (await makeTasks(family, { split, seeds: [seed], difficulty }))[0];
    for (const order of PERMUTATIONS) {
      const req = buildJevRequest(t.task, order), text = JSON.stringify(req);
      assert.deepEqual(Object.keys(req).sort(), ['questions', 'state']);
      for (const k of keysOf(req)) assert.ok(ALLOWED_KEYS.has(k), `unexpected key ${k} in a Jev request`);
      assert.equal(req.state, stateOf(t.task));
      for (const banned of [key, t.taskHash, 'oneCallPass', '"pass"', '"label"', '"outcome"', '"score"', '"oracle']) assert.ok(!text.includes(banned), `${banned} in a Jev request for ${key}`);
      assert.ok(!text.includes(`${family}:`), 'no family task key prefix');
    }
    // fields a caller might attach to the task (outcome, answer, oracle) never reach the request
    const tainted = { ...t.task, oneCallPass: true, pass: true, answer: { secret: 'ANSWER-123' }, expected: 'EXPECTED-456', oracle: 'ORACLE-789', family: 'X', id: 'Y' };
    assert.deepEqual(buildJevRequest(tainted, OPTIONS), buildJevRequest(t.task, OPTIONS));
    assert.deepEqual(buildHaikuRequest(tainted), buildHaikuRequest(t.task));
    const h = buildHaikuRequest(t.task);
    assert.deepEqual(Object.keys(h).sort(), ['prompt', 'schema', 'system']);
    assert.ok(h.prompt.startsWith(stateOf(t.task)));
    for (const id of QUESTION_IDS) { assert.ok(h.prompt.includes(PROPERTY_QUESTIONS[id].question)); assert.ok(h.prompt.includes(PROPERTY_QUESTIONS[id].yes)); }
    for (const banned of [key, t.taskHash, 'oneCallPass', 'ANSWER-123', 'EXPECTED-456', 'ORACLE-789']) assert.ok(!JSON.stringify(h).includes(banned));
  }
  checkPortableSchema(HAIKU_SCHEMA);
  assert.deepEqual(HAIKU_SCHEMA.required, [...QUESTION_IDS]);
});

test('dry plan: six requests per task, priced at the Jev input rate', async () => {
  const t = (await makeTasks('wbed-r0', { split: 'dev', seeds: [379], difficulty: 3 }))[0];
  const p = dryPlan([{ task: t.task }, { task: t.task }], { policyHaikuPrice: 0.1 });
  assert.equal(p.tasks, 2); assert.equal(p.jevRequests, 12); assert.equal(p.haikuCalls, 2);
  close(p.jevUsd, p.jevTokens * 0.042 / 1e6, 1e-15);
  assert.ok(p.jevTokens > 12 * 300);
});

// ---- the metered paths, offline (injected client and port; no network, no key) --------------------------------------------

import { mkdtempSync, readFileSync as readF, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import pathMod from 'node:path';
import { runJev, runHaiku } from '../jev-need2.mjs';

const lines = f => { try { return readF(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const fakeTasks = n => Array.from({ length: n }, (_, k) => ({ taskKey: `fake-r${k % 2}:dev:d3:s${k}`, family: `fake-r${k % 2}`, difficulty: 3, task: { prompt: `Task ${k}: add the numbers.` } }));
// A served stand-in: a named signal (yes 0.5 / no 0.3 / cannot_tell 0.2) plus a 0.3 bonus on whichever option is shown first.
function fakeServed({ failFirst = null } = {}) {
  const calls = [];
  return { calls, served: { async ask(req) {
    calls.push(req);
    if (failFirst && calls.length === 1) { const e = new Error('rate limited'); e.code = failFirst; throw e; }
    const answers = Object.fromEntries(Object.entries(req.questions).map(([id, q]) => {
      const shown = Object.keys(q.criteria), base = { yes: 0.5, no: 0.3, cannot_tell: 0.2 };
      return [id, { type: 'choice', probabilities: Object.fromEntries(shown.map((o, k) => [o, (0.7 * base[o] + (k === 0 ? 0.3 : 0))])) }];
    }));
    return { model: 'jev-1.13.0', usage: { input_tokens: 100, output_tokens: 6 }, answers };
  } }, config: { model: 'jev-latest' } };
}

test('Jev pass offline: six orders per task, averaged by name, ledger per attempt, raw journal, resume and the cap', async () => {
  const live = mkdtempSync(pathMod.join(tmpdir(), 'jn2-')), quiet = () => {};
  try {
    const f = fakeServed();
    assert.equal(await runJev({ tasks: fakeTasks(3), live, cap: 100, concurrency: 2, client: f, log: quiet }), 0);
    assert.equal(f.calls.length, 18);
    for (const c of f.calls) assert.deepEqual(Object.keys(c).sort(), ['questions', 'state']);
    const rows = lines(pathMod.join(live, 'rows.jsonl'));
    assert.equal(rows.length, 3);
    for (const r of rows) {
      assert.equal(r.perms.length, 6); assert.deepEqual(r.models, ['jev-1.13.0']); assert.deepEqual(r.usage, { input_tokens: 600, output_tokens: 36 });
      assert.equal(r.jevModel, 'jev-latest');
      for (const id of QUESTION_IDS) { close(r.mean[id].yes, 0.7 * 0.5 + 0.1, 1e-9); close(r.mean[id].cannot_tell, 0.7 * 0.2 + 0.1, 1e-9); }
      assert.ok(!('oneCallPass' in r) && !('pass' in r));
      for (const pr of r.perms) close(pr.rawProbs.S1[pr.order[0]], 0.7 * { yes: 0.5, no: 0.3, cannot_tell: 0.2 }[pr.order[0]] + 0.3, 1e-12);
    }
    assert.equal(lines(pathMod.join(live, 'requests.jsonl')).length, 18);
    assert.equal(lines(pathMod.join(live, 'rows.raw.jsonl')).filter(x => x.ok).length, 18);
    assert.ok(!readF(pathMod.join(live, 'requests.jsonl'), 'utf8').includes('"state"'), 'the ledger holds no request body');
    // resume: done tasks are skipped
    const g = fakeServed();
    assert.equal(await runJev({ tasks: fakeTasks(3), live, cap: 100, client: g, log: quiet }), 0);
    assert.equal(g.calls.length, 0);
    // a run that would pass the cap is refused before any request
    const h = fakeServed();
    assert.equal(await runJev({ tasks: fakeTasks(6), live, cap: 30, client: h, log: quiet }), 4);
    assert.equal(h.calls.length, 0);
  } finally { rmSync(live, { recursive: true, force: true }); }
});

test('Jev pass offline: a retryable error is retried and counted; a refused credential is a fault, never a row', async () => {
  const quiet = () => {};
  let live = mkdtempSync(pathMod.join(tmpdir(), 'jn2-'));
  try {
    const f = fakeServed({ failFirst: 'MODEL_QUOTA' });
    assert.equal(await runJev({ tasks: fakeTasks(1), live, cap: 10, concurrency: 1, client: f, backoffMs: 1, log: quiet }), 0);
    assert.equal(lines(pathMod.join(live, 'requests.jsonl')).length, 7);
    assert.equal(lines(pathMod.join(live, 'rows.raw.jsonl')).filter(x => !x.ok).length, 1);
    assert.equal(lines(pathMod.join(live, 'rows.jsonl')).length, 1);
  } finally { rmSync(live, { recursive: true, force: true }); }
  live = mkdtempSync(pathMod.join(tmpdir(), 'jn2-'));
  try {
    const f = fakeServed({ failFirst: 'MODEL_AUTH' });
    assert.equal(await runJev({ tasks: fakeTasks(1), live, cap: 10, concurrency: 1, client: f, backoffMs: 1, log: quiet }), 3);
    assert.equal(f.calls.length, 1);
    assert.equal(lines(pathMod.join(live, 'rows.jsonl')).length, 0);
    assert.equal(lines(pathMod.join(live, 'rows.faults.jsonl'))[0].error, 'MODEL_AUTH');
  } finally { rmSync(live, { recursive: true, force: true }); }
});

test('Haiku arm offline: one typed call per task through the port, rows, resume and a hard $ cap', async () => {
  const live = mkdtempSync(pathMod.join(tmpdir(), 'jn2-')), quiet = () => {}, calls = [];
  const port = { async call(req) {
    calls.push(req);
    return { ok: true, value: Object.fromEntries(QUESTION_IDS.map(id => [id, 'no'])), costUsd: 0.05, imputedUsd: 0, latencyMs: 1, modelId: 'claude-haiku-5-5', engineVersion: 'cli-x', usage: { inputTokens: 10, outputTokens: 5 } };
  } };
  try {
    // cap $0.3 with $0.2 reserved per call in flight: calls at spent 0, 0.05, 0.10 fit; at 0.15 the reserve passes the cap
    assert.equal(await runHaiku({ tasks: fakeTasks(5), live, capUsd: 0.3, concurrency: 1, port, log: quiet }), 4);
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.equal(c.modelId, 'claude-haiku-5-5'); assert.equal(c.decoding.reasoning, 'none'); assert.deepEqual(c.schema, HAIKU_SCHEMA);
      assert.ok(c.prompt.includes(PROPERTY_QUESTIONS.S4.question));
    }
    const rows = lines(pathMod.join(live, 'haiku-rows.jsonl'));
    assert.equal(rows.length, 3); assert.equal(rows[0].answers.S1, 'no'); assert.equal(rows[0].engineVersion, 'cli-x');
    // resume counts the earlier spend against the cap and skips done tasks
    calls.length = 0;
    assert.equal(await runHaiku({ tasks: fakeTasks(5), live, capUsd: 1, concurrency: 1, port, log: quiet }), 0);
    assert.equal(calls.length, 2);
    assert.equal(lines(pathMod.join(live, 'haiku-rows.jsonl')).length, 5);
  } finally { rmSync(live, { recursive: true, force: true }); }
});

// ---- review fixes (2026-10-15) --------------------------------------------------------------------------------------------

import { checkPredictions, reviewerSensitivity, TRUTH_FILE, JEV_ATTEMPTS } from '../jev-need2.mjs';

test('P-a holds only with accuracy >= 0.75 and misses on S4 and on S6 and nowhere else', () => {
  const at = misses => checkPredictions({ properties: { jev: { pooled: { n: 48, correct: 48 - misses.length, accuracy: (48 - misses.length) / 48 }, misses } } })['P-a'];
  assert.equal(at(['wbed-r1/S4', 'wbed-r2/S6']).held, true);
  assert.equal(at(['wbed-r1/S4']).held, false, 'no miss on S6');
  assert.equal(at(['wbed-r1/S4', 'wbed-r2/S6', 'wbed-r3/S1']).held, false, 'a miss outside S4/S6');
  assert.equal(at(Array.from({ length: 13 }, (_, k) => `f${k}/${k % 2 ? 'S4' : 'S6'}`)).held, false, 'accuracy below 0.75');
  assert.equal(checkPredictions({})['P-a'].held, null);
});

test('truth table: the labeller\'s cells are the truth; reviewer readings apply only in the sensitivity view', () => {
  const json = JSON.parse(readF(TRUTH_FILE, 'utf8'));
  const base = parseTruth(json), alt = parseTruth(json, { reviewer: true });
  assert.equal([...base.values()].reduce((s, r) => s + Object.keys(r).length, 0), 48);
  assert.ok(!base.has('reviewerDisagreements'));
  for (const d of json.reviewerDisagreements ?? []) {
    assert.ok(QUESTION_IDS.includes(d.q) && base.get(d.family)?.[d.q] === d.label, `${d.family}/${d.q} records the labeller's label`);
    assert.equal(alt.get(d.family)[d.q], d.reviewerReading === 'yes' || d.reviewerReading === 'no' ? d.reviewerReading : d.label);
  }
  // without the families wrapper, a top-level reviewerDisagreements list is never read as a family
  assert.deepEqual([...parseTruth({ A: { S1: 'yes' }, reviewerDisagreements: [{ family: 'A', q: 'S1', reviewerReading: 'no' }] }).keys()], ['A']);
  const items = [{ family: 'wbed-r3', jev: Object.fromEntries(QUESTION_IDS.map(id => [id, dist(0.8, 0.1, 0.1)])) }];
  const s = reviewerSensitivity(items, json);
  assert.ok(s.changed.every(c => / -> (yes|no)$/.test(c)));
  assert.equal(s.jev.n, 6);
});

test('Jev pass offline: an order that fails every attempt costs JEV_ATTEMPTS ledger lines and no wait after the last', async () => {
  const live = mkdtempSync(pathMod.join(tmpdir(), 'jn2-'));
  try {
    const calls = [];
    const client = { config: { model: 'jev-latest' }, served: { async ask(req) { calls.push(req); const e = new Error('rate limited'); e.code = 'MODEL_QUOTA'; throw e; } } };
    const t0 = Date.now();
    assert.equal(await runJev({ tasks: fakeTasks(1), live, cap: 10, concurrency: 1, client, backoffMs: 150, log: () => {} }), 3);
    const ms = Date.now() - t0;
    assert.equal(calls.length, JEV_ATTEMPTS);
    assert.equal(lines(pathMod.join(live, 'requests.jsonl')).length, JEV_ATTEMPTS);
    assert.equal(lines(pathMod.join(live, 'rows.faults.jsonl'))[0].error, 'MODEL_QUOTA');
    assert.ok(ms < 150 * (2 ** (JEV_ATTEMPTS - 1) - 1) + 600, `waited ${ms} ms: a backoff ran after the last attempt`);
  } finally { rmSync(live, { recursive: true, force: true }); }
});
