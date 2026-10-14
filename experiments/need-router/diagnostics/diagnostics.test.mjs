// Tests for the M0 diagnostics D0-D6 (research/need-router-20261014/DESIGN.md §7 M0 item 10), the archive rescue and the LEGACY tag.
//   node --test experiments/need-router/diagnostics/diagnostics.test.mjs
// Unit tests use synthetic inputs with known answers; regression tests pin the numbers of the committed archive, census and job table.
// No model call, no network. Tests that need a file absent from a checkout (the unpacked corpus, the E8 and runbook beds) skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as C from './common.mjs';
import { rescue, scanSecrets, RESCUE_FILES } from './rescue.mjs';
import { loadLegacyJobs, loadConstructions, toMatrix, LEGACY_REGISTRY, pairJob } from './legacy.mjs';
import { nearest, TRUSTED8, loadCensus, loadStages } from './census.mjs';
import { chanceShare, runD0, collapseFamilies } from './d0-knn.mjs';
import { bestThreshold, bestOrRule, hypothesisJobs, runD1, jobFeatureRow, featureIndex } from './d1-shortcut.mjs';
import { coFailure, failureShares, runD2 } from './d2-cofailure.mjs';
import { postHocSignals, evaluateGroup, selfVerdictRates, runD3, POSTHOC_NAMES } from './d3-signals.mjs';
import { recordsPassAt, kineticsPassAt, fragilityOfJob, runD4 } from './d4-fragility.mjs';
import { guardCues, graphTruth, scoreCorpus, loadOverlay, runPartB } from './d5-guard.mjs';
import { priceTokens, priceTable, builderCheck, repriceSession, eraOf, runD6 } from './d6-cost.mjs';
import { runAll } from './run.mjs';
import { renderReport } from './report.mjs';
import { harvest, readStreams, assertNotLegacy, isLegacy, LEGACY_TAG } from '../harvest.mjs';
import { labelTable } from '../metrics.mjs';
import { knnPredictor } from '../router.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = C.REPO;
let _legacy; const legacy = () => (_legacy ??= loadLegacyJobs());
let _all; const everything = async () => (_all ??= await runAll());
const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ------------------------------------------------------------------------------------------------------------- common
test('auc: separation, reversal, ties, strata and the no-pair case', () => {
  assert.equal(C.auc([3, 4, 1, 2], [1, 1, 0, 0]), 1);
  assert.equal(C.auc([1, 2, 3, 4], [1, 1, 0, 0]), 0);
  assert.equal(C.auc([1, 1, 1, 1], [1, 0, 1, 0]), 0.5);
  assert.equal(C.auc([1, 2], [1, 1]), null);
  // Within strata only: each positive beats its own stratum's negative (AUC 1). Pooled, the stratum-b positive (1) sits below the
  // stratum-a negative (4), so the unstratified AUC is 0.75.
  assert.equal(C.auc([5, 4, 1, 0], [1, 0, 1, 0], ['a', 'a', 'b', 'b']), 1);
  assert.equal(C.auc([5, 4, 1, 0], [1, 0, 1, 0]), 0.75);
  assert.equal(C.auc([5, 0], [1, 0], ['a', 'b']), null);
});

test('fisherUpper reproduces the hypergeometric tail and permutations enumerate exactly', () => {
  approx(C.fisherUpper(3, 1, 1, 3), 17 / 70);          // (C(4,3) C(4,1) + C(4,4)) / C(8,4)
  approx(C.fisherUpper(5, 0, 0, 5), 1 / 252);
  approx(C.fisherUpper(0, 3, 3, 0), 1);                // a = 0 is the whole distribution
  assert.equal([...C.combinations(6, 3)].length, 20);
  assert.deepEqual([...C.combinations(4, 2)][0], [0, 1]);
  approx(C.quantile([1, 2, 3, 4], 0.5), 2.5);
});

// ------------------------------------------------------------------------------------------------------------- rescue
test('scanSecrets flags credential shapes and ignores digests', () => {
  assert.deepEqual(scanSecrets('x sk-ant-api03-abcdefghijklmnop y'), ['anthropic-key']);
  assert.ok(scanSecrets('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij').includes('jwt'));
  assert.deepEqual(scanSecrets(`"sha256":"${'a1'.repeat(32)}"`), []);
  assert.deepEqual(scanSecrets('plain model output about keys and tokens'), []);
});

test('rescue copies once, is idempotent, never overwrites a different file, refuses secrets and reports a missing source', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'rescue-'));
  const repo = path.join(tmp, 'repo'), dest = path.join(tmp, 'archive');
  mkdirSync(path.join(repo, 'experiments/runs/p1'), { recursive: true });
  mkdirSync(path.join(repo, 'experiments/runs/c0-dev'), { recursive: true });
  writeFileSync(path.join(repo, 'experiments/runs/p1/results.jsonl'), '{"a":1}\n{"a":2}\n');
  writeFileSync(path.join(repo, 'experiments/runs/p1/journal.sqlite'), 'binary');
  writeFileSync(path.join(repo, 'experiments/runs/c0-dev/results.jsonl'), '{"k":"sk-ant-api03-abcdefghijklmnop"}\n');
  const files = RESCUE_FILES.slice(0, 3);
  const r1 = rescue({ repo, destDir: dest, files, dirs: ['experiments/runs/p1'], now: new Date('2026-10-14T00:00:00Z') });
  assert.deepEqual(r1.files.map(f => f.status), ['copied', 'refused-secret', 'missing']);
  assert.equal(readFileSync(path.join(dest, 'p1/results.jsonl'), 'utf8'), '{"a":1}\n{"a":2}\n');
  assert.equal(existsSync(path.join(dest, 'c0-dev/results.jsonl')), false);
  assert.deepEqual(r1.manifest.files.map(f => [f.path.split('/').pop(), f.lines]), [['results.jsonl', 2]]);
  assert.ok(r1.notRescued.some(n => n.path.endsWith('journal.sqlite') && /SQLite/.test(n.reason)));
  const r2 = rescue({ repo, destDir: dest, files, dirs: [] });
  assert.equal(r2.files[0].status, 'identical');
  writeFileSync(path.join(repo, 'experiments/runs/p1/results.jsonl'), '{"a":3}\n');
  const r3 = rescue({ repo, destDir: dest, files, dirs: [] });
  assert.equal(r3.files[0].status, 'conflict');
  assert.equal(readFileSync(path.join(dest, 'p1/results.jsonl'), 'utf8'), '{"a":1}\n{"a":2}\n', 'a conflicting file is never overwritten');
  const dry = rescue({ repo, destDir: path.join(tmp, 'other'), files, dirs: [], dry: true });
  assert.equal(dry.files[0].status, 'would-copy');
  assert.equal(existsSync(path.join(tmp, 'other')), false);
});

test('the committed archive matches its manifest and the expected row counts', () => {
  const mf = JSON.parse(readFileSync(path.join(C.ARCHIVE_DIR, 'MANIFEST.json'), 'utf8'));
  assert.equal(mf.evidence, 'LEGACY');
  assert.deepEqual(mf.files.map(f => [path.posix.relative('research/need-router-20261014/archive', f.path), f.lines]),
    [['p1/results.jsonl', 288], ['c0-dev/results.jsonl', 96], ['c0-dev/probes.jsonl', 24], ['c0-dev/constructions.jsonl', 8]]);
  for (const f of mf.files) assert.equal(C.sha256File(path.join(REPO, f.path)), f.sha256, `${f.path} differs from its manifest`);
  assert.ok(mf.notRescued.every(n => /sqlite|log/.test(n.path)), 'only journals and logs were left behind');
});

// ------------------------------------------------------------------------------------------------------------- LEGACY tag
test('harvest tags every row, fixed cost and report entry LEGACY with its source path; assertNotLegacy refuses pooling', () => {
  const row = (taskKey, pass) => ({ taskKey, pass, costUsd: 0.1, costBreakdown: {}, orphanUsd: 0 });
  const h = harvest([{ family: 'f', arm: 'agent-claude-haiku-5-5', mode: 'agent-haiku', rows: [row('a', true), row('b', false)], source: 'x/y/results.jsonl' }]);
  assert.ok(h.rows.every(r => r.legacy === true && r.evidence === 'LEGACY' && r.source === 'x/y/results.jsonl'));
  assert.ok(h.fixed.every(f => isLegacy(f)));
  assert.ok(h.report.every(r => r.legacy === true && r.sources[0] === 'x/y/results.jsonl'));
  assert.throws(() => assertNotLegacy(h.rows, 'v1 labels'), /LEGACY row/);
  assert.equal(assertNotLegacy([{ a: 1 }]).length, 1);
  labelTable(h.rows, h.fixed);   // the extra fields do not disturb the v0 label table
  const streams = readStreams(path.join(REPO, 'research/jit-20261008/runs'));
  assert.ok(streams.length > 0 && streams.every(s => s.legacy === true && !path.isAbsolute(s.source) && s.source.startsWith('research/jit-20261008/runs/')));
  assert.equal(LEGACY_TAG.evidence, 'LEGACY');
});

// ------------------------------------------------------------------------------------------------------------- LEGACY loaders
test('loadLegacyJobs: seven paired jobs, every row tagged, P1 timeouts charged at the $1 bound, builds from constructions and stream compiles', () => {
  const L = legacy();
  assert.deepEqual(L.jobs.map(j => [j.id, j.pairing.paired]), [['p1-records', 36], ['c0-dev-records', 8], ['c0-dev-codefix', 8], ['jit-dev-records-1', 24], ['jit-r0-records', 12], ['jit-dev-kinetics-1', 12], ['jit-r0-kinetics', 14]]);
  assert.ok(L.jobs.every(j => j.allRows.every(r => r.legacy === true && r.evidence === 'LEGACY' && r.source)));
  assert.deepEqual(L.notes, []);
  const p1 = L.jobs[0];
  const timeouts = p1.rows.filter(r => r.error === 'MODEL_TIMEOUT');
  assert.equal(timeouts.length, 30, 'the P1 report counts 30 timed-out single calls');
  assert.ok(timeouts.every(r => r.delivered === false && r.usdReported + r.usdImputed >= 1 - 1e-9));
  approx(L.jobs.find(j => j.id === 'jit-dev-records-1').builds.find(b => b.mode === 'static-b1h').usd, 1.372);
  const c0 = L.jobs.find(j => j.id === 'c0-dev-records');
  assert.deepEqual(c0.builds.map(b => b.mode).sort(), ['script-H', 'script-O', 'wf-H', 'wf-O']);
  assert.equal(loadConstructions().builds.length, 8);
});

test('every LEGACY job builds a valid v1 matrix (paired, registry modes, no gap)', async () => {
  const { needTable, needLabels, HEADLINE } = await import('../metrics.mjs');
  for (const job of legacy().jobs) {
    const { rows, builds } = toMatrix(job);
    const t = needTable(rows, builds, { registry: LEGACY_REGISTRY });
    const e = needLabels(t, { reps: 0, cells: [HEADLINE] }).at(job.id, HEADLINE);
    assert.ok(['workflow', 'no-workflow', 'either'].includes(e.label), job.id);
  }
});

test('pairJob keeps modes with half the units and restricts to the common ones, reporting what it drops', () => {
  const r = (mode, unit) => ({ mode, unit });
  const p = pairJob([r('a', 1), r('a', 2), r('a', 3), r('a', 4), r('b', 1), r('b', 2), r('b', 3), r('c', 1)]);
  assert.deepEqual(p.report.modes, ['a', 'b']);
  assert.deepEqual(p.report.dropped, [{ mode: 'c', units: 1 }]);
  assert.equal(p.report.paired, 3);
  assert.equal(p.report.outOfPair, 1);
});

// ------------------------------------------------------------------------------------------------------------- D0
test('nearest uses the metric and weights of router.knnPredictor', () => {
  const cost = { a: 1, b: 2, c: 3, d: 10, e: 20 };
  const features = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, c: { x: 0, y: 2 }, d: { x: 5, y: 5 }, e: { x: 6, y: 5 }, q: { x: 0.4, y: 0.2 } };
  const rows = Object.keys(cost).flatMap(f => ['t1', 't2'].map(t => ({ family: f, mode: 'm', task: t, success: true, costUsd: cost[f] })));
  const train = labelTable(rows);
  for (const k of [1, 2, 3, 5]) {
    const pred = knnPredictor(train, features, { k, keys: ['x', 'y'] })('q').get('m').perTaskUsd;
    const pool = Object.keys(cost).map(f => ({ id: f, features: features[f] }));
    const nn = nearest(pool, { features: features.q }, { k, keys: ['x', 'y'] });
    const w = nn.map(x => 1 / (1 + x.d));
    approx(pred, w.reduce((s, wi, i) => s + wi * cost[nn[i].id], 0) / w.reduce((a, b) => a + b, 0), 1e-9);
  }
  assert.deepEqual(nearest(Object.keys(cost).map(f => ({ id: f, features: features[f] })), { features: features.q }, { k: 2, keys: ['x', 'y'] }).map(x => x.id), ['a', 'b']);
});

test('chanceShare enumerates exactly', () => {
  const c = chanceShare(['A', 'A', 'B'], 2);
  approx(c.meanShare, 2 / 3); approx(c.dominant, 1 / 3); approx(c.single, 1 / 3);
  const all = chanceShare(['A', 'A', 'A', 'A'], 3);
  assert.deepEqual([all.meanShare, all.dominant, all.single], [1, 1, 1]);
});

test('D0 on the committed census: pool of 16 TRAIN entries in 3 clusters, 8 held-out queries, L8 does not trip, r4 and r5 excluded', () => {
  const d = runD0();
  assert.deepEqual(d.pool.clusterSizes, { W: 12, kinetics: 2, codefix: 2 });
  assert.equal(d.pool.trainEntries, 16);
  assert.equal(d.pool.queries.length, 8);
  assert.ok(!d.pool.queries.some(q => /r4|r5/.test(q)));
  const [p3, p5] = d.primary;
  assert.deepEqual([p3.design.stats.dominant, p3.design.stats.single, p5.design.stats.dominant], [4, 4, 4]);
  assert.equal(p3.design.stats.l8Trips, false);
  assert.equal(p5.design.stats.modalClusterCounts.W, 8, 'at k = 5 the plurality cluster is W for every held-out entry');
  assert.equal(p3.loco.stats.queries, 24);
  assert.ok(d.primary.every(p => p.design.jobs.every(j => j.neighbours.length === p.k && j.neighbours.every(n => n.cluster))));
  assert.ok(collapseFamilies(loadCensus().entries).length === 14);
});

test('D0 flags L8 when the neighbours really are one cluster, and not when they interleave (synthetic census)', () => {
  const entry = (family, v) => ({ id: `${family}@d3`, family, difficulty: 3, features: Object.fromEntries(TRUSTED8.map(k => [k, v])) });
  const src = { path: 'x', sha256: '0' };
  const stagesInfo = { stages: { clusters: { T: { split: 'train' }, U: { split: 'train' }, H: { split: 'heldout' } } }, familyCluster: new Map([['t1', 'T'], ['t2', 'T'], ['t3', 'T'], ['u1', 'U'], ['h1', 'H'], ['h2', 'H']]), source: src };
  const pure = { entries: [entry('t1', 0), entry('t2', 0.1), entry('t3', 0.2), entry('u1', 9), entry('h1', 0.05), entry('h2', 0.15)], errors: [], source: src };
  const dp = runD0({ census: pure, stagesInfo, ks: [3] });
  assert.equal(dp.primary[0].design.stats.dominantShare, 1);
  assert.equal(dp.primary[0].design.stats.single, 2);
  assert.equal(dp.primary[0].design.stats.l8Trips, true);
  const mixed = { entries: [entry('t1', 0), entry('t2', 0.1), entry('u1', 0.12), entry('t3', 5), entry('h1', 0.05), entry('h2', 0.11)], errors: [], source: src };
  const dm = runD0({ census: mixed, stagesInfo, ks: [3] });
  assert.equal(dm.primary[0].design.stats.dominantShare, 0);
  assert.equal(dm.primary[0].design.stats.l8Trips, false);
  assert.deepEqual(dm.primary[0].design.jobs.map(j => j.modalShare), [0.667, 0.667]);
});

// ------------------------------------------------------------------------------------------------------------- D1
test('bestThreshold finds a perfect split, ties go to the larger threshold, and reports the errors otherwise', () => {
  const pts = [{ id: 'a', v: 1, c: 'no-workflow' }, { id: 'b', v: 2, c: 'no-workflow' }, { id: 'c', v: 5, c: 'workflow' }, { id: 'd', v: 6, c: 'workflow' }];
  const r = bestThreshold(pts, p => p.v, p => p.c);
  assert.equal(r.perfect, true); assert.equal(r.theta, 3.5); assert.equal(r.ba, 1);
  const noisy = [...pts, { id: 'e', v: 5.5, c: 'no-workflow' }];
  const n = bestThreshold(noisy, p => p.v, p => p.c);
  assert.equal(n.perfect, false); assert.deepEqual(n.wrong, ['e']);
  // Tie: one workflow point at 3 and one no-workflow at 3.5 and 4: thresholds 3.25 (fn 0, fp 1)... a tie between two cuts goes to the larger.
  const tie = [{ id: 'x', v: 1, c: 'no-workflow' }, { id: 'y', v: 2, c: 'workflow' }, { id: 'z', v: 3, c: 'no-workflow' }, { id: 'w', v: 4, c: 'workflow' }];
  const t = bestThreshold(tie, p => p.v, p => p.c);
  assert.ok(Number.isFinite(t.theta) && t.theta >= 3.5, `tie went to the larger cut (${t.theta})`);
  const or = bestOrRule([{ a: 1, b: 9, c: 'workflow' }, { a: 9, b: 1, c: 'workflow' }, { a: 1, b: 1, c: 'no-workflow' }, { a: 2, b: 2, c: 'no-workflow' }], p => p.a, p => p.b, p => p.c);
  assert.equal(or.perfect, true, 'the OR rule fits a case neither single feature separates');
});

test('hypothesisJobs keeps measured TRAIN and held-out jobs with definite classes', () => {
  const { stages } = loadStages();
  const jobs = hypothesisJobs(stages);
  assert.equal(jobs.length, 21);
  assert.ok(!jobs.some(j => ['runbook', 'e8', 'gameqa', 'far-1', 'owner-dev', 'sealed-1'].includes(j.id)));
  assert.equal(jobs.filter(j => j.n1.class === 'workflow').length, 2);
  assert.equal(jobs.filter(j => j.n10.class === 'workflow').length, 4);
});

test('D1: on the committed job table no token threshold reproduces either column; incident breaks every fit', () => {
  const anchors = Object.fromEntries(['need-r0pad', 'need-r3mini', 'need-stage', 'need-codefix-noverifier', 'need-qa', 'need-constraint'].map(b => [b, { 3: Object.fromEntries(TRUSTED8.map(k => [k, 1])), 5: Object.fromEntries(TRUSTED8.map(k => [k, 1])) }]));
  const d = runD1({ anchors });
  const M = d.maxExample;
  assert.equal(M.n1.tokenThreshold.perfect, false); assert.equal(M.n10.tokenThreshold.perfect, false);
  assert.deepEqual(M.n1.tokenThreshold.wrong, ['wbed-r6', 'incident']);
  assert.deepEqual(M.n10.tokenThreshold.wrong, ['incident', 'ownerci']);
  approx(M.n1.tokenThreshold.balancedAccuracy, 0.947, 5e-4); approx(M.n10.tokenThreshold.balancedAccuracy, 0.941, 5e-4);
  assert.equal(M.n10.fixedSizeRule.modes, 21);
  assert.equal(d.jobsWithoutFeatureRow.length, 0);
  assert.equal(d.featureRows.length, 21);
  assert.ok(d.summary.maxExample.errorsN1.includes('incident') && d.summary.maxExample.errorsN10.includes('incident'));
  for (const N of ['n1', 'n10']) assert.ok(typeof JSON.stringify(d.withFanOut[N].orRule) === 'string' && !JSON.stringify(d).includes('Infinity'));
});

test('jobFeatureRow averages the census difficulties inside the band and falls back to the nearest', () => {
  const f = v => ({ logInputTokens: v, maxListLength: v / 2 });
  const idx = featureIndex({ entries: [{ family: 'x', difficulty: 3, features: f(2) }, { family: 'x', difficulty: 5, features: f(4) }] });
  assert.equal(jobFeatureRow({ family: 'x', band: [3, 4, 5] }, idx).logInputTokens, 3);
  assert.equal(jobFeatureRow({ family: 'x', band: [4, 5] }, idx).logInputTokens, 4);
  const low = jobFeatureRow({ family: 'x', band: [1, 2] }, idx);
  assert.equal(low.logInputTokens, 2); assert.equal(low.proxy, true);
  assert.equal(jobFeatureRow({ family: 'nope', band: [3] }, idx), null);
});

// ------------------------------------------------------------------------------------------------------------- D2
test('coFailure: independence, perfect co-failure, no variance and the Fisher cross-check', () => {
  const ind = coFailure([1, 1, 0, 0], [1, 0, 1, 0]);
  assert.equal(ind.lift, 1); assert.equal(ind.phi, 0);
  assert.equal(ind.permutations, 'exact'); assert.ok(ind.pPermutation > 0.5, 'a table at independence is not significant');
  const joint = coFailure([1, 1, 0, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(joint.lift, 4);
  assert.ok(joint.pPermutation <= 1 / 28 + 1e-9, 'identical failure sets are rare among the 8! relabellings');
  assert.equal(joint.pBgivenAWrong, 1); assert.equal(joint.pBgivenARight, 0);
  const none = coFailure([0, 0, 0, 0], [1, 0, 1, 0]);
  assert.equal(none.lift, null); assert.equal(none.pPermutation, 1);
  const a = Array.from({ length: 24 }, (_, i) => (i < 9 ? 1 : 0)), b = Array.from({ length: 24 }, (_, i) => (i < 4 || (i >= 9 && i < 13) ? 1 : 0));
  const m = coFailure(a, b);
  assert.ok(Math.abs(m.pPermutation - m.fisher.p) < 0.02, `permutation ${m.pPermutation} against Fisher ${m.fisher.p}`);
  const again = coFailure(a, b);
  assert.deepEqual(again, m, 'seeded: reruns are identical');
});

test('failureShares averages trials per task', () => {
  const s = failureShares([{ mode: 'a', taskKey: 't1', pass: true }, { mode: 'a', taskKey: 't1', pass: false }, { mode: 'a', taskKey: 't2', pass: false }, { mode: 'b', taskKey: 't1', pass: true }], 'a');
  assert.deepEqual([...s], [['t1', 0.5], ['t2', 1]]);
});

test('D2 on the records dev stream: 3 joint failures of 24, lift exactly 1, no excess co-failure', () => {
  const d = runD2(legacy().jobs);
  const p = d.primary;
  assert.deepEqual([p.job, p.a, p.b, p.tasks], ['jit-dev-records-1', 'agent-H', 'static-b1h', 24]);
  assert.deepEqual([p.fisher.both, p.fisher.onlyA, p.fisher.onlyB, p.fisher.neither], [3, 6, 5, 10]);
  assert.equal(p.lift, 1); assert.equal(p.verdict, 'no excess co-failure');
  assert.equal(d.nversion.tasks, 24);
  assert.equal(d.nversion.pairs.length, 6);
  assert.ok(d.nversion.pairs.every(q => q.lift >= 1), 'the compiled solvers fail together at least as often as independence predicts');
});

// ------------------------------------------------------------------------------------------------------------- D3
test('post-hoc signals read no oracle field: poisoning score, pass and details changes nothing', () => {
  const row = { pass: true, score: 1, details: { fieldAccuracy: 1 }, schemaValid: true, turns: 5, tools: 4, usdReported: 0.1, tokensOut: 100, calls: 3, escalations: 1, verdict: 'pass', latencyMs: 9 };
  const poisoned = { ...row, pass: false, score: 0, details: { reason: 'schema-invalid', fieldAccuracy: 0 } };
  assert.deepEqual(postHocSignals(poisoned), postHocSignals(row));
  assert.deepEqual(Object.keys(postHocSignals(row)).sort(), [...POSTHOC_NAMES].sort());
  assert.equal(postHocSignals({ ...row, verdict: 'fail' }).verdictFail, 1);
  assert.equal(postHocSignals({ ...row, schemaValid: false }).schemaInvalid, 1);
});

test('evaluateGroup: skips thin groups and finds a planted signal and a planted non-signal', () => {
  const struct = new Map(), rows = [];
  for (let i = 0; i < 24; i++) {
    const key = `t${i}`; struct.set(key, { vector: TRUSTED8.map((_, j) => (j === 0 ? 3.8 + (i % 5) * 0.001 : 1)), hashOk: true });
    rows.push({ taskKey: key, pass: i % 2 === 0, difficulty: 3, schemaValid: true, usdReported: i % 2 === 0 ? 0.01 : 0.2 + i * 0.001, turns: null, tools: null });
  }
  const g = evaluateGroup(rows, struct, { boot: 200 });
  assert.equal(g.primary.postHoc, 1, 'cost separates the planted failures');
  assert.ok(g.primary.exAnte >= 0 && g.primary.exAnte <= 1);
  approx(g.primary.delta, g.primary.postHoc - g.primary.exAnte, 1e-3);
  const thin = evaluateGroup(rows.slice(0, 5).map(r => ({ ...r, pass: true })), struct);
  assert.match(thin.skipped, /needs >= 4 passes/);
});

test('selfVerdictRates counts false passes and false fails among delivered answers', () => {
  const r = (pass, verdict) => ({ delivered: true, pass, verdict });
  const s = selfVerdictRates([r(false, 'pass'), r(false, 'pass'), r(false, 'fail'), r(true, 'pass'), r(true, 'fail'), { delivered: false, pass: false, verdict: 'pass' }]);
  assert.deepEqual([s.oracleFail, s.falsePass, s.oraclePass, s.falseFail], [3, 2, 2, 1]);
  approx(s.falsePassRate, 0.667, 1e-3);
  assert.equal(selfVerdictRates([{ delivered: true, pass: true, verdict: null }]), null);
});

test('D3 on the archive: task hashes match, 12 arms qualify, the workflows\' own verdict passed all 6 oracle failures', async () => {
  const d = (await everything()).d3;
  assert.equal(d.hashesChecked, true); assert.equal(d.taskCount, 116);
  assert.equal(d.summary.groupsScored, 12);
  assert.deepEqual([d.summary.selfVerdict.arms, d.summary.selfVerdict.oracleFailures, d.summary.selfVerdict.falsePass], [3, 6, 6]);
  assert.ok(d.groups.every(g => g.selfVerdict === null || g.selfVerdict.f11Trips === false), 'no arm has the 10 failures F11 needs');
  assert.ok(d.groups.filter(g => g.family === 'records' && g.structureKeysThatVary).every(g => g.structureKeysThatVary.length <= 1), 'within records only the token count varies');
});

// ------------------------------------------------------------------------------------------------------------- D4
test('recordsPassAt follows the oracle rule at factors 0.5, 1 and 2', () => {
  const d = (over = {}) => ({ entities: 50, extra: 0, missing: 0, fieldAccuracy: 0.975, pairF1: 0.99, ...over });
  assert.deepEqual([0.5, 1, 2].map(f => recordsPassAt(d(), f)), [false, true, true]);
  assert.deepEqual([0.5, 1, 2].map(f => recordsPassAt(d({ fieldAccuracy: 0.96 }), f)), [false, false, true]);
  assert.deepEqual([0.5, 1, 2].map(f => recordsPassAt(d({ extra: 1 }), f)), [false, true, true], 'one extra entity of 50: slack floor(0.02 E) = 1 at x1, 0 at x0.5');
  assert.deepEqual([0.5, 1, 2].map(f => recordsPassAt(d({ entities: 40, extra: 1 }), f)), [false, false, true], 'floor(0.02 x 40) = 0 at x1, 1 at x2');
  assert.equal(recordsPassAt({ reason: 'schema-invalid' }, 2), false);
  assert.equal(recordsPassAt(null, 1), null);
  assert.equal(recordsPassAt({ entities: 5 }, 1), null);
});

test('kineticsPassAt scales the tolerance, the evaluator check and respects the exclusion set', () => {
  const d = (over = {}) => ({ evaluatorValid: true, excluded: { exact: true }, unknownConditions: [], duplicateConditions: [], referenceRelErrors: [{ vmax: 0.02, km: 0.04 }], perCondition: [{ vmaxRelErr: 0.07, kmRelErr: 0.02 }], ...over });
  assert.deepEqual([0.5, 1, 2].map(f => kineticsPassAt(d(), f)), [false, true, true]);
  assert.deepEqual([0.5, 1, 2].map(f => kineticsPassAt(d({ excluded: { exact: false } }), f)), [false, false, false]);
  assert.deepEqual([0.5, 1, 2].map(f => kineticsPassAt(d({ perCondition: [{ vmaxRelErr: 0.15, kmRelErr: 0 }] }), f)), [false, false, true]);
  assert.equal(kineticsPassAt(d({ referenceRelErrors: [{ vmax: 0.06, km: 0 }], perCondition: [{ vmaxRelErr: 0.01, kmRelErr: 0 }] }), 0.5), false, 'a reference fit over the halved tolerance invalidates the evaluator');
  assert.equal(kineticsPassAt(null, 1), null);
});

test('fragilityOfJob flags a label that flips with the tolerance (synthetic job)', () => {
  const mk = (mode, i, details, cost) => ({ mode, unit: `t${i}`, taskKey: `t${i}`, seed: 100 + i, taskHash: `h${i}`, pass: recordsPassAt(details, 1), score: null, delivered: true, schemaValid: true, error: null, usdReported: cost, usdImputed: 0, details });
  const near = { entities: 40, extra: 0, missing: 0, fieldAccuracy: 0.96, pairF1: 1 }, good = { entities: 40, extra: 0, missing: 0, fieldAccuracy: 0.99, pairF1: 1 };
  const rows = Array.from({ length: 10 }, (_, i) => [mk('agent-H', i, near, 0.03), mk('hand-H', i, good, 0.01)]).flat();
  const job = { id: 'syn', oracle: 'records', family: 'records', rows, builds: [], pairing: { modes: ['agent-H', 'hand-H'], paired: 10 }, sources: [] };
  const f = fragilityOfJob(job);
  assert.equal(f.reproduction.mismatches, 0);
  assert.equal(f.headline['1'].label, 'workflow');
  assert.equal(f.headline['2'].label, 'either', 'at x2 the agent passes too and the acceptable set holds both classes');
  assert.equal(f.grid.fragile, true);
  assert.equal(f.rowFlips.gainedAtDouble, 10);
});

test('D4 on the archive: nominal flags reproduce for all 616 rows; one job has a flipping label', () => {
  const d = runD4(legacy().jobs);
  assert.equal(d.summary.nominalReproduced, true);
  assert.equal(d.summary.rowsTotal, 616);
  assert.deepEqual(d.summary.fragileJobs, ['jit-r0-records']);
  assert.deepEqual([d.summary.lostAtHalf, d.summary.gainedAtDouble], [17, 45]);
  assert.equal(d.jobs.find(j => j.job === 'jit-dev-kinetics-1').failuresWithWrongExclusion, 16);
  assert.ok(d.jobs.every(j => j.reproduction.mismatches === 0));
});

// ------------------------------------------------------------------------------------------------------------- D5
test('guardCues finds the code-defined cues and nothing else', () => {
  assert.deepEqual(Object.entries(guardCues('A manager must approve the request.')).filter(([, v]) => v).map(([k]) => k), ['human', 'any']);
  const t = guardCues('Wait 30 days, then send the email every day.');
  assert.ok(t.wait && t.schedule && t.effects && t.any);
  assert.equal(guardCues('Summarise this paper.').any, false);
  assert.equal(guardCues('').any, false);
  assert.equal(guardCues(undefined).any, false);
});

test('graphTruth reads the graph, never the text', () => {
  const item = { features: { async: ['schedule', 'webhook'], humanSteps: 1, effects: { read: 2, write: 0, external: 1 } }, graph: { nodes: [{ category: 'wait' }] } };
  assert.deepEqual(graphTruth(item), { human: true, wait: true, schedule: true, effects: true, trigger: true, any: true });
  assert.equal(graphTruth({ features: { async: [], humanSteps: 0, effects: { read: 1, write: 0, external: 0 } }, graph: { nodes: [] } }).any, false);
});

test('scoreCorpus computes recall and precision against graph truth', () => {
  const items = [
    { id: 1, platform: 'p', text: 'approve it', truth: { human: true, wait: false, schedule: false, effects: false, trigger: false, any: true } },
    { id: 2, platform: 'p', text: 'approve it too', truth: { human: false, wait: false, schedule: false, effects: false, trigger: false, any: false } },
    { id: 3, platform: 'q', text: 'plain', truth: { human: true, wait: false, schedule: false, effects: false, trigger: false, any: true } },
    { id: 4, platform: 'q', text: 'plain', truth: { human: false, wait: false, schedule: false, effects: false, trigger: true, any: false } },
  ];
  const s = scoreCorpus(items);
  assert.deepEqual([s.classes.human.truthPositives, s.classes.human.cueFires, s.classes.human.truePositives], [2, 2, 1]);
  assert.equal(s.classes.human.recall.rate, 0.5); assert.equal(s.classes.human.precision.rate, 0.5);
  assert.match(s.classes.human.verdict090, /ask/);
  assert.equal(s.askRate, 0.5);
  assert.equal(s.classes.trigger.truthPositives, 1);
});

test('D5 on the corpus overlay: 449 original descriptions, cue recall far under 0.9 for every class', { skip: !(existsSync(path.join(C.REPO, 'research/corpus-20261006/items.jsonl')) || existsSync(path.join(C.REPO, 'research/corpus-20261006/items.jsonl.gz'))) }, async () => {
  const d = (await everything()).d5;
  assert.equal(d.corpus.items, 449);
  assert.deepEqual(d.corpus.provenanceCounts, { written: 1046, original: 449, 'recovered-by-model': 64 });
  assert.deepEqual([d.corpus.classes.any.truthPositives, d.corpus.classes.any.truePositives], [367, 45]);
  assert.deepEqual(d.summary.guardAsksInsteadOfInferring, ['human', 'wait', 'schedule', 'effects']);
  assert.ok(d.corpus.classes.any.recall.wilson[1] < 0.2);
});

test('D5 Part B: typed fields evidence the declared requirements of E8 and runbook, and the ones PREREG does not list', async () => {
  const b = await runPartB();
  if (b.e8.error || b.runbook.error) return;   // a bed that does not load in this checkout
  assert.ok(b.e8.typed.human.evidence.some(e => /fraudReview/.test(e)));
  assert.ok(b.e8.typed.effects.evidence.some(e => /billing\.charge/.test(e)));
  assert.equal(b.e8.typed.schedule.evidence.length, 0);
  assert.ok(b.runbook.typed.wait.evidence.length > 0 && b.runbook.typed.effects.evidence.length > 0);
  assert.ok(b.e8.typedNotDeclared.some(x => x.class === 'human'));
  assert.ok(b.runbook.typedNotDeclared.some(x => x.class === 'wait'));
  assert.equal(b.runbook.recall.typed, 1);
});

// ------------------------------------------------------------------------------------------------------------- D6
test('priceTokens: tiers, the 1-hour cache write rate and unknown models', () => {
  const T = priceTable();
  approx(priceTokens(T, 'claude-opus-5-5', { input: 1e6 }).usd, 4);
  approx(priceTokens(T, 'claude-opus-5-5', { cacheWrite5m: 1e6 }).usd, 5);
  approx(priceTokens(T, 'claude-opus-5-5', { cacheWrite1h: 1e6 }).usd, 8);
  approx(priceTokens(T, 'claude-opus-5-5', { output: 1e6, cacheRead: 1e6 }).usd, 20.2);
  approx(priceTokens(T, 'claude-haiku-5-5', { input: 50000, cacheRead: 40000 }).usd, (50000 * 0.1 + 40000 * 0.01) / 1e6);
  approx(priceTokens(T, 'claude-haiku-5-5', { input: 150000 }).usd, 150000 * 0.5 / 1e6, 1e-12);
  approx(priceTokens(T, 'claude-haiku-5-5', { input: 150000 }, { low: true }).usd, 150000 * 0.1 / 1e6, 1e-12);
  assert.equal(priceTokens(T, 'claude-haiku-4-5-20251001', { input: 1 }), null);
});

test('builderCheck: a session billed at the 1-hour rate reproduces its reported cost exactly', () => {
  const T = priceTable();
  const u = { input_tokens: 54, output_tokens: 55000, cache_read_input_tokens: 1.5e6, cache_creation_input_tokens: 100000, cache_creation: { ephemeral_1h_input_tokens: 100000, ephemeral_5m_input_tokens: 0 } };
  const reported = priceTokens(T, 'claude-opus-5-5', { input: 54, output: 55000, cacheRead: 1.5e6, cacheWrite1h: 100000 }).usd;
  const c = builderCheck([{ label: 'x', builderModel: 'claude-opus-5-5', builderUsage: u, builderCostUsd: reported, builderStreamUsage: { outputTokens: 250 } }], T);
  assert.equal(c.sessions[0].ratioReportedOverBilledRate, 1);
  assert.ok(c.sessions[0].ratioReportedOverP5 > 1);
  assert.equal(c.exact, 1);
});

test('repriceSession: the implied output tokens recover a planted number, and the era follows the cache flag', () => {
  const T = priceTable();
  const su = { inputTokens: 10, outputTokens: 40, cacheReadTokens: 200000, cacheWriteTokens: 50000 };
  const planted = 12000;
  const reported = priceTokens(T, 'claude-opus-5-5', { input: 10, output: planted, cacheRead: 200000, cacheWrite1h: 50000 }).usd;
  const r = repriceSession({ model: 'claude-opus-5-5', reported, streamUsage: su, at: '2026-10-07T12:00:00Z' }, T);
  assert.equal(r.era, 'pre-flag');
  assert.ok(Math.abs(r.impliedOutputTokensEra - planted) < 1);
  const post = repriceSession({ model: 'claude-opus-5-5', reported, streamUsage: su, at: '2026-10-09T12:00:00Z' }, T);
  assert.equal(post.era, 'post-flag'); assert.ok(post.impliedOutputTokensEra > planted, 'the cheaper 5-minute write leaves more of the bill to output');
  assert.equal(eraOf(null), 'unknown');
});

test('the 5-minute price formula agrees with label-run.priceUsage on a session aggregate', async () => {
  let priceUsage; try { ({ priceUsage } = await import('../label-run.mjs')); } catch { return; }
  if (typeof priceUsage !== 'function') return;
  const T = priceTable();
  for (const [model, su] of [['claude-opus-5-5', { inputTokens: 12, outputTokens: 3000, cacheReadTokens: 71231, cacheWriteTokens: 34734 }], ['claude-haiku-5-5', { inputTokens: 16, outputTokens: 63, cacheReadTokens: 313606, cacheWriteTokens: 81899 }]]) {
    approx(priceUsage(T, model, su), priceTokens(T, model, { input: su.inputTokens, output: su.outputTokens, cacheRead: su.cacheReadTokens, cacheWrite5m: su.cacheWriteTokens }).usd, 1e-12);
  }
});

test('D6 on the archive: 8 builder sessions (5 exact, 8 in the bracket), 290 agent sessions, Opus agents under-priced from stream usage', async () => {
  const d = (await everything()).d6;
  assert.deepEqual([d.builderSessions.total, d.builderSessions.exact, d.builderSessions.inBracket], [8, 5, 8]);
  assert.equal(d.builderSessions.byModel['claude-opus-5-5'].ratioReportedOverBilledRate, 1);
  assert.equal(d.agentSessions.count, 290);
  assert.ok(d.summary.byModel['claude-opus-5-5'].ratioReportedOverP5 > 2.5);
  assert.ok(d.agentSessions.byModelEra.every(x => x.key.includes('pre-flag') || x.key.includes('post-flag')));
  assert.ok(d.summary.meterChangesLabels && d.summary.jobsAffected.includes('jit-dev-records-1'));
  assert.ok(d.meterImpact.every(i => i.cells === 27));
});

// ------------------------------------------------------------------------------------------------------------- run and report
test('runAll: every diagnostic present, grades stated, JSON-safe and reproducible (fast subset run twice)', async () => {
  const r = await everything();
  for (const k of ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']) assert.ok(r[k]?.id === k.toUpperCase(), k);
  assert.ok(['d2', 'd3', 'd4', 'd6'].every(k => r[k].grade === 'LEGACY/dev') && ['d0', 'd1', 'd5'].every(k => r[k].grade === 'dev'));
  const text = JSON.stringify(r);
  assert.ok(!/Infinity|NaN/.test(text), 'no non-finite number leaks into the JSON');
  const a = await runAll({ only: ['d0', 'd2', 'd4', 'd6'] }), b = await runAll({ only: ['d0', 'd2', 'd4', 'd6'] });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a.d4), JSON.stringify(r.d4));
});

test('renderReport: a pure function of the results; every section, grade and source list is present', async () => {
  const r = await everything();
  const md = renderReport(r);
  assert.equal(md, renderReport(r));
  for (const h of ['## Findings at a glance', '## What these numbers change in the plan', '## Inputs', '## D0.', '## D1.', '## D2.', '## D3.', '## D4.', '## D5.', '## D6.', '## Not done, and what could be wrong']) assert.ok(md.includes(h), h);
  assert.equal((md.match(/\*\*Grade: (LEGACY\/dev|dev)\.\*\*/g) ?? []).length, 7);
  assert.ok((md.match(/^Sources:$/gm) ?? []).length >= 7);
  assert.ok(md.includes(`${C.fmt.n(r.d1.router.n10.tokenThreshold.balancedAccuracy, 3)}`));
  assert.ok(md.includes('LEGACY') && md.includes('never pooled'));
  assert.ok(!/undefined|NaN|\[object/.test(md), 'no template leaks');
});

test('the committed diagnostics.json and REPORT.md are current', async () => {
  const dir = path.join(REPO, 'research/need-router-20261014/analysis/m0');
  const jf = path.join(dir, 'diagnostics.json'), rf = path.join(dir, 'REPORT.md');
  if (!existsSync(jf) || !existsSync(rf)) return;   // before the first run
  const committed = JSON.parse(readFileSync(jf, 'utf8'));
  assert.equal(readFileSync(rf, 'utf8'), renderReport(committed), 'REPORT.md is exactly the rendering of diagnostics.json');
  // The diagnostics that read only committed files must match a fresh run; D1 (anchor beds) and D5 (E8 and runbook beds, the unpacked corpus) read files still in flux.
  const fresh = await everything();
  for (const k of ['d0', 'd2', 'd3', 'd4', 'd6']) assert.equal(JSON.stringify(fresh[k]), JSON.stringify(committed[k]), `${k} differs from the committed diagnostics.json: re-run run.mjs --report`);
  assert.equal(JSON.stringify(fresh.inputs), JSON.stringify(committed.inputs));
});

test('the diagnostics make no model call and no network request, and read no sealed or credential file', () => {
  const base = /child_process|node:http|node:https|node:net|\bfetch\s*\(|XMLHttpRequest|src\/models|claude-cli|beds\/sealed/;
  const secrets = /credential|\.env\b|CLAUDE_CODE_OAUTH/;   // rescue.mjs names token shapes it refuses to copy; no other module may touch them
  for (const f of readdirSync(here).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))) {
    const text = readFileSync(path.join(here, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert.equal(text.match(base), null, `${f} mentions ${text.match(base)?.[0]}`);
    if (f !== 'rescue.mjs') assert.equal(text.match(secrets), null, `${f} mentions ${text.match(secrets)?.[0]}`);
  }
});
