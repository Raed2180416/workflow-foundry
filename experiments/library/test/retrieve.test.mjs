// T9 (LIBRARY-TESTS §2; BUILD-ORDER step 5): shape features and the code ranker (LIBRARY §4.2–4.3), and the L2 code arms
// over the corpus and the W-bed fixture tasks. T9 has no pass threshold (the numbers are baselines); these tests check
// that the ranker follows §4.3 step by step and that the harness computes what LIBRARY-TESTS L2 names. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadL1 } from '../cards.mjs';
import { openLibrary } from '../store.mjs';
import { buildIndex, shapeOf, tableOf } from '../index.mjs';
import { candidates, bm25Index, rankNormalise, tokenize, topCompanion, rulesHit, firedFeatures, hardFilter, itemMetrics, clusterMean, MAX_CANDIDATES, WEIGHTS } from '../retrieve.mjs';
import { corpusTasks, wbedTasks, scoreArms, stripStructural, runL2, WBED_GOLD } from '../l2.mjs';
import { tmp, clock, registerSum, makeKept, sampleTasks } from './helpers.mjs';

const l1 = loadL1();

test('T9: BM25 ranks the document that holds the rare query term first; rank normalisation gives the top row 1', () => {
  const e = bm25Index([{ id: 'a', text: 'invoice ledger close totals' }, { id: 'b', text: 'route each message by kind' }, { id: 'c', text: 'ledger ledger dedupe customers' }]);
  const s = e.score('dedupe the customer ledger');
  assert.deepEqual([...s.keys()].sort(), ['a', 'c']);
  assert.ok(s.get('c') > s.get('a'));
  const n = rankNormalise(s);
  assert.equal(n.get('c'), 1); assert.equal(n.get('a'), 0.5);
  assert.deepEqual(tokenize('The 2 invoices, and an ATLAS export!'), ['invoices', 'atlas', 'export']);
});

test('T9: tabular text is an item list with header keys; prose is not', () => {
  const csv = 'invoice_no,account_row,invoice_date,amount_usd,status\n' + Array.from({ length: 8 }, (_, i) => `BD-${100 + i},${10 + i},05/0${i + 1}/2024,"${i}.00",open`).join('\n');
  assert.deepEqual(tableOf(csv), { n: 9, keys: ['invoice_no', 'account_row', 'invoice_date', 'amount_usd', 'status'] });
  assert.equal(tableOf('This is a note.\nIt has several lines.\nNone of them are records.\nStill prose here.\nAnd a fifth line.'), null);
  const s = shapeOf({ prompt: 'Return only JSON of the form {"a":1}.', inputs: { a: csv, b: csv.replace('BD-', 'XX-'), note: 'Dates in this export are written day first, as DD/MM/YYYY, by every system we use here.' } });
  assert.equal(s.itemLists.count, 2); assert.equal(s.multiSource.pairs, 1); assert.equal(s.freeText.count, 1); assert.equal(s.verifiable, true);
});

test('T9 §4.3 step 1: hard filters drop tiers the host lacks, L2 items not kept / shadow, revoked items and disallowed effects', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const cand = registerSum(lib), kept = registerSum(lib, { name: 'sum-rows-kept', contract: { input: { type: 'object' }, output: { type: 'object' }, taskTemplate: 'Sum the rows again.' } });
  makeKept(lib, kept.hash);
  const rows = buildIndex({ l1, library: lib, write: false, bindings: [{ tool: 'mail.send', effect: { kind: 'send', reversible: false, external: true } }] });
  const { rows: S, dropped } = hardFilter(rows, { tiers: ['S'], effects: ['none'] }, lib);
  assert.ok(S.every(r => r.layer !== 'L1' || r.tier === 'S' || r.tier == null));
  assert.ok(S.some(r => r.id === kept.hash), 'a kept L2 item passes');
  assert.ok(!S.some(r => r.id === cand.hash), 'a candidate L2 item is filtered (status)');
  assert.ok(!S.some(r => r.id === 'B:mail.send'), 'a send binding is filtered by the effect policy');
  assert.ok(dropped.tier > 0 && dropped.status === 1 && dropped.effect === 1);
  lib.revoke(kept.hash, 'test');
  const after = buildIndex({ l1: [], library: lib, write: false });
  assert.ok(!after.some(r => r.id === kept.hash), 'a revoked item has left the index');
});

test('T9 §4.3 steps 2-6: rules, BM25, companions, profile pre-check, cut to 20 by the fixed score, order logged', t => {
  const lib = openLibrary(tmp(t), { now: clock() });
  const e = registerSum(lib); makeKept(lib, e.hash);
  const task = { prompt: 'Sum the rows of each ledger and report totals.', inputs: { rows: [{ amount: 1 }, { amount: 2 }] } };
  const r = candidates({ task, l1, library: lib });
  assert.ok(r.candidates.length <= MAX_CANDIDATES && r.order.length === r.candidates.length);
  assert.deepEqual(r.order, r.candidates.map(c => c.id));
  for (let i = 1; i < r.candidates.length; i++) assert.ok(r.candidates[i - 1].score >= r.candidates[i].score, 'ranked by score');
  for (const c of r.candidates) {
    const expect = WEIGHTS.rule * c.rules + WEIGHTS.bm25 * c.bm25Norm + (c.companionOf ? WEIGHTS.companion : 0);
    assert.ok(Math.abs(c.score - expect) < 1e-5, `${c.id}: score ${c.score} = 2 x rules + BM25 rank-normalised + 0.5 x companion (${expect})`);
    if (c.bm25Rank == null) assert.equal(c.bm25Norm, 0);
    if (c.layer === 'L1') assert.equal(c.rules, rulesHit(c.id, r.fired));
  }
  // itemLists and outputShape fired: P12 (rules 2: item lists + output shape) is in; the L2 component's profile is recorded.
  assert.ok(r.fired.includes('itemLists') && r.fired.includes('outputShape'));
  assert.equal(r.candidates.find(c => c.id === 'P12')?.rules, 2);
  const own = r.candidates.find(c => c.id === e.hash);
  assert.ok(own, 'the kept component is a candidate (BM25 on its task template)');
  assert.deepEqual(Object.keys(own.profile).sort(), ['novel', 'score']);
  // Companions: every companion added names an L1 pattern of the initial set whose top companion by lift it is.
  for (const c of r.candidates.filter(c => c.companionOf)) assert.equal(topCompanion(l1.find(p => p.id === c.companionOf)), c.id);
  assert.equal(topCompanion(l1.find(p => p.id === 'P03')), 'P05', 'P03 -> P05 by lift (LIBRARY §4.3 example)');
  assert.equal(r.log.cut, r.candidates.length);
  // Deterministic.
  assert.deepEqual(candidates({ task, l1, library: lib }).order, r.order);
});

test('T9: per-item metrics and the cluster bootstrap', () => {
  const m = itemMetrics(['P01', 'P07', 'P09', 'P12', 'P13', 'P20'], ['P09', 'P20']);
  assert.equal(m['recall@3'], 0.5); assert.equal(m['recall@5'], 0.5); assert.equal(m['recall@20'], 1); assert.equal(m['precision@5'], 0.2); assert.equal(m.rr, 1 / 3);
  const rows = Array.from({ length: 40 }, (_, i) => ({ cluster: `p${i % 4}`, m: { x: i % 2 } }));
  const c = clusterMean(rows, 'x', { B: 500 });
  assert.equal(c.mean, 0.5); assert.ok(c.lo <= c.mean && c.mean <= c.hi); assert.equal(c.clusters, 4);
});

test('T9: clusterMean is exact after a first call on rows of another shape (the Node 24.21 computed-key anomaly, retrieve.mjs)', () => {
  clusterMean(Array.from({ length: 40 }, (_, i) => ({ cluster: `p${i % 4}`, m: { x: i % 2 } })), 'x', { B: 300 });
  const { tasks } = corpusTasks();
  const r = scoreArms(tasks.slice(0, 600), { B: 300, keepItems: true });
  for (const k of ['recall@3', 'recall@5', 'recall@20', 'precision@5']) {
    const direct = r.perItem.A1.reduce((a, x) => a + x.m[k], 0) / r.perItem.A1.length;
    assert.equal(r.arms.A1[k].mean, Math.round(direct * 1e4) / 1e4, k);
  }
});

test('T9: corpus task sets: gold is census L1 needs only (no L0, no removed detector), the stripped variant drops structural words', () => {
  const { tasks, l0only, refused } = corpusTasks();
  assert.equal(refused, 49, 'census revision 1 refuses 49');
  assert.equal(tasks.length + l0only, 1510, 'every non-refused item is a task or L0-only');
  const removed = ['P02', 'P16', 'P17', 'P18', 'P30', 'P49'];
  for (const t of tasks) { assert.ok(t.gold.length && t.gold.every(g => /^P\d\d$/.test(g) && !removed.includes(g))); }
  assert.equal(stripStructural('n8n workflow. 6 nodes, 5 edges. trigger: form. 1 wait.'), 'n8n . , . : form. .');
  const s = corpusTasks({ variant: 'stripped' }).tasks;
  assert.equal(s.length, tasks.length);
});

test('T9: the L2 code arms over the corpus and W-bed (numbers reported; no threshold); falsifier computed', async t => {
  const wb = await wbedTasks();
  assert.equal(wb.length, 18);
  for (const x of wb) assert.deepEqual(x.gold, WBED_GOLD[x.cluster]);
  const r = await runL2({ B: 500 });
  for (const set of ['corpus', 'stripped', 'wbed']) for (const [arm, m] of Object.entries(r[set].arms)) {
    for (const k of ['recall@3', 'recall@5', 'recall@20', 'precision@5', 'mrr']) assert.ok(m[k].mean >= 0 && m[k].mean <= 1 && m[k].lo <= m[k].mean + 1e-9 && m[k].mean <= m[k].hi + 1e-9, `${set} ${arm} ${k}`);
    assert.ok(m['recall@3'].mean <= m['recall@5'].mean + 1e-9 && m['recall@5'].mean <= m['recall@20'].mean + 1e-9, `${set} ${arm}: ${m['recall@3'].mean} ${m['recall@5'].mean} ${m['recall@20'].mean}`);
    if (arm === 'A2') assert.ok(m.meanListLength <= MAX_CANDIDATES);
  }
  assert.equal(r.costUsd, 0); assert.equal(r.modelCalls, 0); assert.equal(r.jevCalls, 0);
  assert.equal(typeof r.falsifier.met, 'boolean');
  const f = s => Object.fromEntries(Object.entries(s.arms).map(([a, m]) => [a, `r@5 ${m['recall@5'].mean} r@20 ${m['recall@20'].mean} mrr ${m.mrr.mean}`]));
  t.diagnostic(`corpus n=${r.corpus.n}: ${JSON.stringify(f(r.corpus))}`);
  t.diagnostic(`stripped: ${JSON.stringify(f(r.stripped))}`);
  t.diagnostic(`wbed n=${r.wbed.n}: ${JSON.stringify(f(r.wbed))}; falsifier (A2 r@5 < 0.7) met: ${r.falsifier.met}`);
  // Arms are deterministic.
  const again = scoreArms(wb, { B: 100 });
  assert.equal(again.arms.A2['recall@5'].mean, r.wbed.arms.A2['recall@5'].mean);
});
