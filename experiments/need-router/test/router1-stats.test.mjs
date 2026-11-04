// ROUTER-1 statistics with teeth (review m6): confusion, AUROC, Clopper-Pearson, exact McNemar, the paired bootstrap, the step-4
// middle-band choice and the dev length threshold of eval-router1.mjs, and the $0 learned baseline of baseline-ngram.mjs.
// Every expected value is computed here independently (closed forms or brute force), never by calling the code under test. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { confusion, auroc, cpUpper, mcnemar, bootstrapDeltaF1, selectMiddle, lengthThreshold } from '../router1/eval-router1.mjs';
import { vectorizer, trainScore, normalize, grams } from '../router1/baseline-ngram.mjs';
import { assignSplit, generationCluster } from '../router1/build-set.mjs';

function choose(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
function binomCdf(x, n, p) { let s = 0; for (let k = 0; k <= x; k++) s += choose(n, k) * p ** k * (1 - p) ** (n - k); return s; }

test('confusion: counts, precision, recall, F1, accuracy', () => {
  const g = [true, true, true, false, false, false, false], p = [true, true, false, true, false, false, false];
  const c = confusion(g, p);
  assert.deepEqual([c.tp, c.fp, c.fn, c.tn], [2, 1, 1, 3]);
  assert.equal(c.precision, 0.6667); assert.equal(c.recall, 0.6667); assert.equal(c.f1, 0.6667); assert.equal(c.accuracy, 0.7143);
  assert.equal(confusion([false, false], [false, false]).recall, null, 'no positives: recall undefined');
  assert.equal(confusion([true], [false]).f1, 0);
});

test('auroc: separation, reversal, ties, and a brute-force pair count', () => {
  assert.equal(auroc([true, true, false, false], [0.9, 0.8, 0.2, 0.1]), 1);
  assert.equal(auroc([true, true, false, false], [0.1, 0.2, 0.8, 0.9]), 0);
  assert.equal(auroc([true, false], [0.5, 0.5]), 0.5);
  assert.equal(auroc([true, true], [0.1, 0.2]), null);
  const g = [true, false, true, false, true, false, false], s = [0.7, 0.6, 0.6, 0.1, 0.3, 0.3, 0.9];
  let pairs = 0, wins = 0;
  g.forEach((a, i) => g.forEach((b, j) => { if (a && !b) { pairs++; wins += s[i] > s[j] ? 1 : s[i] === s[j] ? 0.5 : 0; } }));
  assert.equal(auroc(g, s), Math.round((wins / pairs) * 1e4) / 1e4);
});

test('cpUpper: zero events has the closed form 1 - (alpha/2)^(1/n); otherwise the binomial CDF at the bound is alpha/2', () => {
  for (const n of [10, 84, 132]) assert.ok(Math.abs(cpUpper(0, n) - (1 - 0.025 ** (1 / n))) < 1e-4, `n = ${n}`);
  for (const [x, n] of [[1, 20], [5, 132], [9, 132], [27, 132]]) {
    const u = cpUpper(x, n);
    assert.ok(Math.abs(binomCdf(x, n, u) - 0.025) < 1e-3, `${x}/${n}: CDF at ${u} is ${binomCdf(x, n, u)}`);
    assert.ok(u > x / n);
  }
  assert.equal(cpUpper(5, 5), 1);
  assert.ok(cpUpper(9, 132) > cpUpper(5, 132), 'monotone in x');
});

test('mcnemar: exact two-sided binomial on the discordant pairs', () => {
  const a = [...Array(4).fill(true), ...Array(26).fill(false), ...Array(10).fill(true)];
  const b = [...Array(4).fill(false), ...Array(26).fill(true), ...Array(10).fill(true)];
  const m = mcnemar(a, b);
  assert.equal(m.aOnly, 4); assert.equal(m.bOnly, 26);
  assert.equal(m.p, Math.round(Math.min(1, 2 * binomCdf(4, 30, 0.5)) * 1e4) / 1e4);
  assert.equal(mcnemar(b, a).p, m.p, 'symmetric');
  assert.equal(mcnemar([true, false], [false, true]).p, 1, 'balanced discordance');
  assert.equal(mcnemar([true, true], [true, true]).p, 1, 'no discordant pairs');
});

test('bootstrapDeltaF1: deterministic, zero for identical predictions, positive and excluding 0 for a clearly better system', () => {
  const g = Array.from({ length: 60 }, (_, i) => i % 3 === 0);
  const perfect = [...g], none = g.map(() => false), noisy = g.map((x, i) => (i % 7 === 0 ? !x : x));
  const same = bootstrapDeltaF1(g, noisy, noisy, { reps: 300 });
  assert.deepEqual([same.delta, same.lo, same.hi], [0, 0, 0]);
  const a = bootstrapDeltaF1(g, perfect, none, { reps: 300 }), b = bootstrapDeltaF1(g, perfect, none, { reps: 300 });
  assert.deepEqual(a, b, 'seeded');
  assert.equal(a.delta, 1); assert.ok(a.lo > 0);
  const c = bootstrapDeltaF1(g, perfect, noisy, { reps: 500 });
  assert.ok(c.lo <= c.delta && c.delta <= c.hi);
});

test('selectMiddle: highest dev recall at 0 FP; a band that adds a false trigger is refused; ties go to the cheaper judge, then the smaller band', () => {
  const params = { tDefault: 0.5 };
  // Items: two positives just below the threshold (p 0.45, 0.35), one negative in the band (0.42), one clear negative, one clear positive.
  const items = [true, true, false, false, true].map(g => ({ gold: { needsWorkflow: g } }));
  const router = [0.45, 0.35, 0.42, 0.05, 0.9].map(p => ({ p, needsWorkflow: p >= 0.5, mode: p >= 0.5 ? 'workflow' : 'none' }));
  const ans = ys => ys.map(y => ({ needsWorkflow: y, mode: y ? 'workflow' : 'none' }));
  const missing = items.map(() => ({ missing: true }));
  // haiku: right on everything; mercury: right on positives but says yes to the band negative.
  const out = { router, haiku: ans([true, true, false, false, true]), mercury: ans([true, true, true, false, true]), jev: missing };
  const sel = selectMiddle(items, out, params);
  assert.deepEqual(sel.choice, { judge: 'haiku', delta: 0.2 }, 'haiku at 0.2 reaches both positives with 0 FP; mercury adds a FP');
  assert.ok(sel.table.some(r => r.judge === 'mercury' && r.delta === 0.1 && r.fp === 1));
  // When a cheaper judge is as good, it wins the tie; with no band that helps, the choice is code only.
  const tie = selectMiddle(items, { ...out, mercury: out.haiku }, params);
  assert.deepEqual(tie.choice, { judge: 'mercury', delta: 0.2 });
  const useless = selectMiddle(items, { ...out, haiku: ans([false, false, true, false, true]), mercury: missing }, params);
  assert.deepEqual(useless.choice, { judge: null, delta: 0 });
});

test('lengthThreshold: the dev F1-max character count', () => {
  const dev = [['short', false], ['tiny', false], ['a much longer request text', true], ['another fairly long one', true], ['mid sized', false]].map(([text, g]) => ({ text, gold: { needsWorkflow: g } }));
  assert.equal(lengthThreshold(dev), 'another fairly long one'.length);
});

test('n-gram baseline: vocabulary and idf come from training text only; scores separate a separable toy set; deterministic', () => {
  assert.equal(normalize('  Every   MONDAY\n'), ' every monday ');
  assert.ok(grams('abcd').has(' ab') && grams('abcd').has('abcd ') && !grams('abcd').has('ab'));
  const v = vectorizer(['every monday send', 'every monday post', 'what is a mutex', 'what is a lock']);
  const unseen = v.transform('zzzzqqqq');
  assert.equal(unseen.idx.length, 0, 'n-grams absent from training contribute nothing');
  const x = v.transform('every monday');
  assert.ok(Math.abs(Math.sqrt(x.val.reduce((s, a) => s + a * a, 0)) - 1) < 1e-9, 'L2-normalised');
  const mk = (text, y) => ({ text, gold: { needsWorkflow: y } });
  const train = [mk('every monday email the report to the team', true), mk('every friday post the numbers to slack', true), mk('each morning send the summary to the lead', true),
    mk('what is the capital of peru', false), mk('explain how a mutex works', false), mk('what does this error mean', false)];
  const s = trainScore(train, [mk('every monday post the summary', true), mk('what is a mutex', false)], 0.1);
  assert.ok(s[0] > s[1], `${s}`);
  assert.deepEqual(trainScore(train, [mk('every monday post the summary', true)], 0.1), [s[0]]);
});

test('assignSplit: the frozen rule is unchanged; generationCluster keeps every request of one Mercury generation call on one side (review m1)', () => {
  const items = [];
  for (const cat of ['m-a', 'm-b', 'm-c', 'm-d', 'm-e']) for (let k = 1; k <= 8; k++) items.push({ id: `me-${cat}-${k}`, source: 'mercury', category: cat, cluster: `me-${cat}-${k}`, gold: { needsWorkflow: k % 2 === 0 } });
  const perItem = assignSplit(items), perCall = assignSplit(items, { clusterOf: generationCluster });
  const sides = split => Object.values(split.reduce((m, it) => ((m[it.category] ??= new Set()).add(it.split), m), {}));
  assert.ok(sides(perItem).some(s => s.size === 2), 'one cluster per item puts a call on both sides');
  assert.ok(sides(perCall).every(s => s.size === 1), 'one cluster per call keeps it whole');
  assert.ok(perCall.some(it => it.split === 'dev') && perCall.some(it => it.split === 'test'));
});
