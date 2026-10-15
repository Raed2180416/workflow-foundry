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
import { loadLegacyJobs, loadConstructions, loadJitJobs, loadArmDef, jitRowBound, toMatrix, labelSetsOf, LEGACY_REGISTRY, LEGACY_JOB_DEFS, P1_HAND_AUTHORING, pairJob, normaliseRunRow, schemaValidOf, ceilingRule, CHEAP_BUILDER, JIT_EXPERIMENTS, P1_MODES } from './legacy.mjs';
import { nearest, TRUSTED8, loadCensus, loadStages } from './census.mjs';
import { chanceShare, runD0, collapseFamilies, anchorEntries } from './d0-knn.mjs';
import { bestThreshold, bestOrRule, hypothesisJobs, runD1, jobFeatureRow, featureIndex } from './d1-shortcut.mjs';
import { coFailure, failureShares, runD2 } from './d2-cofailure.mjs';
import { postHocSignals, evaluateGroup, selfVerdictRates, runD3, structureOf, archivedSeedRefusals, assertArchivedSeeds, EXCLUSION_REASON, POSTHOC_NAMES } from './d3-signals.mjs';
import { recordsPassAt, kineticsPassAt, fragilityOfJob, runD4 } from './d4-fragility.mjs';
import { guardCues, graphTruth, scoreCorpus, loadOverlay, runPartB, timeDeclarations, typedFieldsE8, typedFieldsRunbook } from './d5-guard.mjs';
import { bedStamp, bedGeneratorFiles } from './anchors.mjs';
import { splitProvenance, compareCurrency, describeCurrency } from './currency.mjs';
import { loadLedger } from '../../jit/seeds.mjs';
import { buildMeterGate } from '../meter-gate.mjs';
import { priceTokens, priceTable, builderCheck, repriceSession, eraOf, runD6, meterImpact } from './d6-cost.mjs';
import { runAll, planRun, ALL, MODULES } from './run.mjs';
import { cacheRateOf, measureTranscripts, summariseLaunchEnv, readLaunchEnv, LAUNCH_ENV_FILE, finalResult, LAUNCH_ENV_SCHEMA } from './launch-env.mjs';
import { parseMeterGate } from '../meter-gate.mjs';
import { execFileSync } from 'node:child_process';
import { renderReport } from './report.mjs';
import { harvest, readStreams, assertNotLegacy, isLegacy, LEGACY_TAG } from '../harvest.mjs';
import { labelTable, labelSetModes, needTable, needLabels, makeCell, HEADLINE } from '../metrics.mjs';
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
  assert.deepEqual(L.notes.map(n => n.replace(/ \$[\d.]+/g, ' $')), [
    'jit-dev-records-1 jit-HH records:dev:d4:s223: costUnknown, recorded $; already at or above the $ per-task bound (arm.json agentBudgetUsd), nothing to impute',
    'jit-r0-kinetics jit-OH kinetics:dev:d4:s228: costUnknown, recorded $; imputed $ up to the $ per-task bound (arm.json agentBudgetUsd)',
  ], 'the only notes are the two unobserved-cost stream rows: every input loaded and every LEGACY job has rows');
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
  const rows = Array.from({ length: 10 }, (_, i) => [mk('agent-H', i, near, 0.03), mk('script-H', i, good, 0.01)]).flat();
  const job = { id: 'syn', oracle: 'records', family: 'records', rows, builds: [{ mode: 'script-H', usd: 0.01 }], pairing: { modes: ['agent-H', 'script-H'], paired: 10 }, sources: [] };
  const f = fragilityOfJob(job);
  assert.equal(f.reproduction.mismatches, 0);
  assert.equal(f.headline['1'].label, 'workflow');
  assert.equal(f.headline['2'].label, 'either', 'at x2 the agent passes too and the acceptable set holds both classes');
  assert.equal(f.grid.fragile, true);
  assert.equal(f.rowFlips.gainedAtDouble, 10);
});

test('D4 on the archive: nominal flags reproduce for all 616 rows; two jobs have a flipping L_today label, among those that have a workflow arm there', () => {
  const d = runD4(legacy().jobs);
  assert.equal(d.summary.nominalReproduced, true);
  assert.equal(d.summary.rowsTotal, 616);
  // The L_today / L_ceiling split is one rule (the author of the workflow): jit-OH and jit-SH are ceiling arms like wf-O and script-O, so jit-r0-kinetics (agent-H and jit-OH) is vacuous
  // in L_today and its flip there is gone, while jit-dev-records-1 keeps its two Haiku-written workflow arms (jit-HH, static-b1h) against its agents.
  assert.deepEqual(d.summary.fragileJobs, ['jit-dev-records-1', 'jit-r0-records']);
  assert.deepEqual(d.summary.vacuousJobs, ['p1-records', 'jit-r0-kinetics']);
  assert.deepEqual(d.summary.ceilingJobs, ['p1-records', 'c0-dev-records', 'jit-dev-records-1', 'jit-dev-kinetics-1', 'jit-r0-kinetics']);
  assert.deepEqual([d.summary.lostAtHalf, d.summary.gainedAtDouble], [17, 45]);
  assert.equal(d.jobs.find(j => j.job === 'jit-dev-kinetics-1').failuresWithWrongExclusion, 16);
  assert.ok(d.jobs.every(j => j.reproduction.mismatches === 0));
  assert.equal(d.summary.cells, 162); assert.equal(d.summary.unlabelledCells, 21); assert.equal(d.summary.labelledCells, 141);
  assert.deepEqual(Object.fromEntries(Object.entries(d.summary.unlabelledByJob).filter(([, v]) => v.today || v.ceiling).map(([j, v]) => [j, [v.today, v.ceiling]])), { 'p1-records': [21, 15] });
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
  // E8's schedule is searched for in its typed declarations (the timedOut order status: the customer deadline race), not assumed absent.
  assert.ok(b.e8.typed.schedule.evidence.some(e => /timedOut/.test(e)) && b.e8.typed.schedule.searched.includes('schemas'));
  assert.equal(b.e8.recall.typed, 1);
  assert.deepEqual(b.runbook.typed.schedule.evidence, []); assert.deepEqual(b.runbook.typed.schedule.searched, ['outputSchema', 'family']);
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

test('the committed REPORT.md renders the committed diagnostics.json, and its numbers reproduce (results compared apart from input hashes)', async t => {
  const dir = path.join(REPO, 'research/need-router-20261014/analysis/m0');
  const jf = path.join(dir, 'diagnostics.json'), rf = path.join(dir, 'REPORT.md');
  if (!existsSync(jf) || !existsSync(rf)) return;   // before the first run
  const committed = JSON.parse(readFileSync(jf, 'utf8'));
  assert.equal(readFileSync(rf, 'utf8'), renderReport(committed), 'REPORT.md is exactly the rendering of diagnostics.json');
  const cur = compareCurrency(committed, await everything());
  // A real mismatch: a section whose numbers differ although none of its inputs moved (not reproducible, or the file predates a change of code).
  assert.deepEqual(cur.resultsDiffer, [], `${describeCurrency(cur)}: re-run run.mjs --report`);
  // Inputs that moved (a cap added to stages.json, a line edited in SPEC-E.md, an anchor bed revised) make the file out of date whether or not its numbers
  // changed; that is a re-run, not a failed mismatch, so it is reported as a TODO and does not break the suite.
  if (cur.status !== 'current') t.todo(describeCurrency(cur));
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

// =====================================================================================================================================
// Regressions for the adversarial review of the diagnostics (one block per defect).
// =====================================================================================================================================

// ------------------------------------------------------------------------------------------------ P1 hand workflows carry their authoring cost
test('P1 hand workflows: ceiling arms charged the >= $24.91 authoring cost; free of it they would make P1 a workflow job at hand-H', () => {
  const p1 = legacy().jobs.find(j => j.id === 'p1-records');
  assert.deepEqual(p1.builds.map(b => [b.mode, b.usd, b.lowerBound]), [['hand-H', 24.91, true], ['hand-S', 24.91, true]]);
  assert.equal(P1_HAND_AUTHORING.usd, 24.91); assert.equal(P1_HAND_AUTHORING.lowerBound, true);
  assert.match(P1_HAND_AUTHORING.source, /README\.md:307/, 'the figure is in the README cost ledger; research/core-20261006/REPORT.md does not contain it');
  assert.ok(!/core-20261006\/REPORT\.md/.test(P1_HAND_AUTHORING.source));
  assert.ok(Object.entries(LEGACY_REGISTRY).every(([, r]) => !r.prebuilt), 'no LEGACY mode switches off metrics.needTable\'s build-row guard');
  assert.deepEqual(['hand-H', 'hand-S', 'wf-O', 'script-O', 'jit-OH', 'jit-SH'].map(m => LEGACY_REGISTRY[m].ceiling), [true, true, true, true, true, true]);
  assert.ok(['agent-H', 'wf-H', 'script-H', 'static-b1h', 'jit-HH'].every(m => !LEGACY_REGISTRY[m].ceiling));
  const { rows, builds } = toMatrix(p1);
  assert.throws(() => needTable(rows, [], { registry: LEGACY_REGISTRY }), /guided mode with no build row/, 'the guard is live: the missing P1 build row is refused');
  const label = bs => needLabels(needTable(rows, bs, { registry: LEGACY_REGISTRY }), { reps: 0, cells: [HEADLINE] }).at('p1-records', HEADLINE);
  const free = label(builds.map(b => ({ ...b, usd: 0 })));   // what the report said before: no authoring cost
  assert.deepEqual([free.label, free.top], ['workflow', 'hand-H']);
  approx(free.u.get('hand-H'), 0.929, 5e-4);
  const full = label(builds);
  assert.deepEqual([full.label, full.top], ['no-workflow', 'agent-H']);
  approx(full.u.get('hand-H'), -1.562, 5e-4); approx(full.u.get('agent-H'), 0.5, 5e-4);
  approx(free.u.get('hand-H') - full.u.get('hand-H'), 24.91 / 10, 1e-9);   // exactly B / (N V)
  const half = label(builds.map(b => ({ ...b, usd: 24.91 / 2 })));
  assert.deepEqual([half.label, half.top], ['no-workflow', 'agent-H'], 'even half the authoring cost flips the label to agent-H');
  approx(half.u.get('hand-H'), -0.317, 5e-4);
  // L_today leaves the ceiling arms out, so P1 has no workflow arm there; L_ceiling keeps them.
  const sets = labelSetsOf(p1.pairing.modes);
  assert.ok(!sets.today.modes.some(m => m.startsWith('hand')) && sets.today.vacuous && sets.today.workflowModes.length === 0);
  assert.deepEqual([...sets.ceiling.extra].sort(), ['hand-H', 'hand-S']);
  assert.equal(labelSetsOf(['agent-H', 'wf-H']).ceiling, null);
  assert.ok(labelSetModes(p1.pairing.modes, 'today', LEGACY_REGISTRY).every(m => !m.startsWith('hand')));
});

test('D4 reports P1 under both label sets: vacuous in L_today, the headline cell UNLABELLED in both (imputed dollars over 0.3 in direct-H-med), workflow only at large N or V', () => {
  const p1 = runD4(legacy().jobs).jobs.find(j => j.job === 'p1-records');
  assert.equal(p1.labelSets.today.vacuous, true); assert.equal(p1.labelCounts.workflow, 0);
  assert.deepEqual(p1.builds.map(b => [b.mode, b.usd]), [['hand-H', 24.91], ['hand-S', 24.91]]);
  // The headline cell has no label: direct-H-med's 11 timeouts are charged at the $1 bound, so more than 30% of its dollars are imputed (DESIGN §2).
  for (const h of [p1.headline['1'], p1.ceiling.headline['1']]) { assert.equal(h.label, 'unlabelled'); assert.equal(h.top, null); assert.match(h.unlabelled, /^imputed dollars over 0\.3 in direct-H-med/); }
  assert.deepEqual(['0.5', '1', '2'].map(f => p1.headline[f].label), ['no-workflow', 'unlabelled', 'unlabelled'], 'at x0.5 fewer passes keep direct-H-med out of reach, so that one cell is labelled');
  assert.deepEqual(p1.headlineFlips, { half: false, double: false }, 'a cell that is unlabelled on one side is not a flip');
  assert.deepEqual([p1.grid.unlabelled, p1.ceiling.grid.unlabelled], [21, 15]);
  assert.equal(p1.grid.labelled + p1.grid.unlabelled, p1.grid.cells);
  assert.equal(Object.values(p1.labelCounts).reduce((a, x) => a + x, 0), p1.grid.labelled, 'label counts cover labelled cells only');
  assert.equal(Object.values(p1.ceiling.labelCounts).reduce((a, x) => a + x, 0), 12); assert.equal(p1.ceiling.labelCounts.workflow, 7);
  assert.ok(Object.keys(p1.grid.unlabelledReasons).every(r => /^imputed dollars over 0\.3 in /.test(r)));
  approx(p1.ceiling.headline['1'].u['hand-H'], -1.5623, 5e-4);
  assert.ok(p1.ceiling.workflowCells.includes('V=1 N=100 W=1V') && !p1.ceiling.workflowCells.includes('V=1 N=10 W=1V'), 'the hand workflow pays back between N = 10 and N = 100 at V = $1');
  assert.equal(p1.ceiling.grid.flipped, 1, 'one labelled L_ceiling cell flips; the unlabelled ones cannot');
  assert.equal(runD4(legacy().jobs).jobs.find(j => j.job === 'jit-r0-records').ceiling, null, 'only a job with a ceiling arm has an L_ceiling view');
  assert.ok(runD4(legacy().jobs).jobs.find(j => j.job === 'jit-dev-records-1').ceiling, 'jit-OH and jit-SH are ceiling arms');
});

test('D4 on a synthetic job: a charged ceiling workflow stays out of L_today, and a build that costs more than the gain cannot win the ceiling label', () => {
  const mk = (mode, i, pass, cost) => ({ mode, unit: `t${i}`, taskKey: `t${i}`, seed: 100 + i, taskHash: `h${i}`, pass, score: null, delivered: true, schemaValid: true, error: null, usdReported: cost, usdImputed: 0, details: { entities: 40, extra: 0, missing: 0, fieldAccuracy: pass ? 0.99 : 0.9, pairF1: 1 } });
  const rows = Array.from({ length: 10 }, (_, i) => [mk('agent-H', i, i < 6, 0.05), mk('hand-H', i, true, 0.01)]).flat();
  const job = { id: 'syn', oracle: 'records', family: 'records', rows, builds: [{ mode: 'hand-H', usd: 10 }], pairing: { modes: ['agent-H', 'hand-H'], paired: 10 }, sources: [] };
  const f = fragilityOfJob(job);
  assert.deepEqual([f.headline['1'].label, f.headline['1'].top], ['no-workflow', 'agent-H']);   // L_today: only agent-H
  assert.equal(f.labelSets.today.vacuous, true);
  assert.deepEqual([f.ceiling.headline['1'].label, f.ceiling.headline['1'].top], ['no-workflow', 'agent-H'], 'a $10 build at N = 10 and V = $1 costs 1.0 success-equivalents a task, more than the 0.85 hand-H gains over agent-H');
  const cheap = fragilityOfJob({ ...job, builds: [{ mode: 'hand-H', usd: 1 }] });
  assert.deepEqual([cheap.ceiling.headline['1'].label, cheap.ceiling.headline['1'].top], ['workflow', 'hand-H'], 'with a small build the ceiling label is workflow');
  assert.equal(cheap.headline['1'].label, 'no-workflow', 'and L_today still cannot say workflow');
});

// ------------------------------------------------------------------------------------------------ unobserved stream costs are imputed to the arm bound
function streamTree(rowsByArm) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jit-runs-'));
  for (const [arm, { kind, def, rows }] of Object.entries(rowsByArm)) {
    const dir = path.join(root, 'exp1', arm);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'arm.json'), JSON.stringify({ kind, def }));
    writeFileSync(path.join(dir, 'results.jsonl'), rows.map(r => JSON.stringify({ costBreakdown: {}, orphanUsd: 0, pass: true, error: null, ...r })).join('\n') + '\n');
  }
  return root;
}
test('loadJitJobs imputes a costUnknown stream row up to the arm\'s per-task bound, as normaliseRunRow does for P1 and C0, and lists it', () => {
  const def = { perTaskUsd: 1, agentBudgetUsd: 2 }, interpret = [{ kind: 'interpret', role: 'interpreter' }], tk = n => `records:dev:d3:s${n}`;
  const root = streamTree({
    'agent-claude-haiku-5-5': { kind: 'agent', def, rows: [1, 2, 3, 4].map(n => ({ taskKey: tk(n), costUsd: 0.1, taskHash: `h${n}` })) },
    'jit-claude-opus-5-5--claude-haiku-5-5': { kind: 'jit', def, rows: [
      { taskKey: tk(1), costUsd: 0.66, costUnknown: true, taskHash: 'h1', events: interpret },                  // an agent session of unknown cost: bound 2
      { taskKey: tk(2), costUsd: 2.5, costUnknown: true, taskHash: 'h2', events: interpret },                   // already above the bound: nothing to impute
      { taskKey: tk(3), costUsd: 0.2, costUnknown: true, taskHash: 'h3', events: [{ kind: 'compiled' }] },     // gateway only: the per-task bound 1
      { taskKey: tk(4), costUsd: 0.3, taskHash: 'h4', events: interpret }] },                                    // observed: untouched
  });
  const j = loadJitJobs(root, { experiments: ['exp1'] }).jobs.get('exp1');
  const by = n => j.rows.find(r => r.mode === 'jit-OH' && r.taskKey === tk(n));
  approx(by(1).usdImputed, 1.34, 1e-9); approx(by(1).usdReported + by(1).usdImputed, 2, 1e-9);
  assert.equal(by(2).usdImputed, 0); approx(by(3).usdImputed, 0.8, 1e-9); assert.equal(by(4).usdImputed, 0);
  assert.equal(by(1).boundUsd, 2); assert.equal(by(3).boundUsd, 1);
  assert.deepEqual(j.costNotes.map(n => n.replace(/\$[\d.]+/g, '$')), [
    'exp1 jit-OH records:dev:d3:s1: costUnknown, recorded $; imputed $ up to the $ per-task bound (arm.json agentBudgetUsd)',
    'exp1 jit-OH records:dev:d3:s2: costUnknown, recorded $; already at or above the $ per-task bound (arm.json agentBudgetUsd), nothing to impute',
    'exp1 jit-OH records:dev:d3:s3: costUnknown, recorded $; imputed $ up to the $ per-task bound (arm.json perTaskUsd)',
  ]);
  assert.deepEqual(jitRowBound(null, {}), null); assert.deepEqual(jitRowBound({ kind: 'agent', perTaskUsd: 1, agentBudgetUsd: 2 }, {}), { usd: 2, field: 'agentBudgetUsd' });
  assert.equal(loadArmDef(root, 'exp1', 'agent-claude-haiku-5-5').kind, 'agent');
  // The committed archive: the two unobserved rows of the paired label rows are now imputed (or already at the bound).
  const kin = legacy().jobs.find(j => j.id === 'jit-r0-kinetics').rows.find(r => r.costUnknown);
  approx(kin.usdReported + kin.usdImputed, 2, 1e-9);
  const rec = legacy().jobs.find(j => j.id === 'jit-dev-records-1').rows.find(r => r.costUnknown);
  assert.ok(rec.usdReported >= 2 && rec.usdImputed === 0);
});

// ------------------------------------------------------------------------------------------------ rows, modes and jobs dropped are reported
test('what pairing, the harvest and the job table drop is carried into the results and the report', async () => {
  const all = await everything();
  const kin = all.inputs.jobs.find(j => j.id === 'jit-dev-kinetics-1');
  assert.deepEqual(kin.harvest.notes.map(n => n.replace(/^(\S+): (\d+) .*$/, '$1 $2')), ['agent-haiku 12', 'agent-sonnet 12', 'jit-OH 7', 'jit-SH 1'], 'the harvest notes the reviewer found lost');
  assert.deepEqual(all.inputs.jobs.find(j => j.id === 'jit-r0-kinetics').harvest.notes.map(n => n.split(':')[0]), ['agent-haiku']);
  assert.deepEqual(all.inputs.jobs.find(j => j.id === 'jit-r0-records').harvest.notes.length, 1);
  assert.ok(all.inputs.jobs.find(j => j.id === 'jit-dev-records-1').harvest.notes.some(n => /static-b1h: \+\$1\.372 build/.test(n)));
  assert.ok(!all.inputs.jobs.some(j => (j.harvest?.notes ?? []).some(n => /booked as recorded/.test(n))), 'superseded by the imputation notes');
  assert.equal(all.inputs.p1Authoring.usd, 24.91);
  const md = renderReport(all);
  assert.ok(md.includes('Pairing and harvest notes') && md.includes('agent-sonnet: 12 task(s) outside the paired set') && md.includes('jit-OH: 7 task(s) outside the paired set'));
  assert.ok(md.includes('imputed $1.340 up to the $2 per-task bound'));
  assert.ok(md.includes('hand-H $24.91+'));
  // A job that yields no rows leaves a note instead of disappearing.
  const empty = mkdtempSync(path.join(os.tmpdir(), 'jit-empty-'));
  const L = loadLegacyJobs({ jitRoot: empty });
  const jitDefs = LEGACY_JOB_DEFS.filter(d => d.kind === 'jit').map(d => d.id);
  assert.deepEqual(L.jobs.map(j => j.id).filter(id => jitDefs.includes(id)), []);
  for (const id of jitDefs) assert.ok(L.notes.some(n => n.startsWith(`${id} (jit): no rows`)), `a note for ${id}`);
});

test('D3 lists the modes it does not score instead of dropping them, and counts every group', async () => {
  const d = (await everything()).d3;
  assert.equal(d.summary.groupsExcluded, 9); assert.equal(d.summary.groupsTotal, d.summary.groups + 9);
  assert.deepEqual(d.summary.excludedModes, ['jit-HH', 'jit-OH', 'jit-SH', 'static-b1h']);
  assert.ok(d.excluded.every(x => x.rows > 0 && x.reason.length > 20 && !d.groups.some(g => g.job === x.job && g.mode === x.mode)));
  assert.match(EXCLUSION_REASON('jit-OH'), /several paths/); assert.match(EXCLUSION_REASON('static-b1h'), /static solver/);
  assert.ok(renderReport(await everything()).includes('**Not scored:** 9 further groups'));
});

// ------------------------------------------------------------------------------------------------ D3 never regenerates a reserved or held-out seed
test('D3 seed gate: spent test seeds and archive-purpose dev seeds pass; held-out, reserved, unspent and unledgered seeds are refused before any task is generated', async () => {
  const led = loadLedger(), why = (bed, split, seed) => archivedSeedRefusals(led, { bed, split, seed });
  assert.deepEqual([why('records', 'test', 5003), why('codefix', 'test', 6002), why('records', 'dev', 210), why('kinetics', 'dev', 230)], [[], [], [], []]);
  for (const seed of [8801, 8812, 8848]) assert.ok(why('records', 'test', seed).some(r => /held-out range/.test(r)) && why('records', 'test', seed).some(r => /need-heldout/.test(r)), `s${seed}`);
  assert.ok(why('records', 'test', 8101).some(r => /held-out range/.test(r)), 'the other held-out ranges');
  assert.ok(why('records', 'dev', 605).some(r => /need-example/.test(r)) && why('records', 'dev', 640).some(r => /need-label/.test(r)));
  assert.ok(why('records', 'test', 7300).some(r => /clean, not a spent/.test(r)), 'an unspent clean test range');
  assert.ok(why('records', 'test', 4242).some(r => /no ledger range/.test(r)));
  assert.ok(why('records', 'dev', 1.5).length && why('records', 'oos', 1).length);
  await assert.rejects(structureOf([{ taskKey: 'records:test:d3:s8803', taskHash: 'x' }]), e => e.code === 'SEED_REFUSED' && e.details[0].taskKey === 'records:test:d3:s8803' && /need-heldout/.test(e.message));
  assert.throws(() => assertArchivedSeeds(['records:test:d3:s5001', 'kinetics:dev:d3:s601']), e => e.code === 'SEED_REFUSED' && e.details.length === 1 && e.details[0].taskKey === 'kinetics:dev:d3:s601');
  await assert.rejects(runD3([{ id: 'x', allRows: [{ mode: 'agent-H', delivered: true, taskKey: 'records:test:d4:s8830', taskHash: null, pass: true }], rows: [], sources: [] }], { boot: 1 }), e => e.code === 'SEED_REFUSED');
  const keys = [...new Set(legacy().jobs.flatMap(j => j.allRows.map(r => r.taskKey)))];
  assert.ok(assertArchivedSeeds(keys) === keys.length && keys.length > 100, 'every archived task key passes today');
});

// ------------------------------------------------------------------------------------------------ D0 anchors, D1 bed versions and hashes
test('D0 anchor sensitivity: anchors join their clusters, need-qa is a fourth TRAIN cluster and need-constraint a held-out query; the census-only primary does not move', async () => {
  const { ANCHOR_BEDS } = await import('./d1-shortcut.mjs');
  const { KEYS12 } = await import('./census.mjs');
  const beds = [...new Set(Object.values(ANCHOR_BEDS))];
  const anchors = { features: Object.fromEntries(beds.map((b, bi) => [b, Object.fromEntries([3, 5].map(d => [d, Object.fromEntries(KEYS12.map((k, i) => [k, (bi + 1) * 0.37 + d * 0.11 + i * 0.013]))]))])), errors: [] };
  const info = loadStages();
  const ae = anchorEntries(anchors, info);
  assert.equal(ae.entries.length, 12); assert.ok(ae.entries.every(e => e.anchor === true && /@d[35]$/.test(e.id)));
  assert.deepEqual(ae.skipped, []);
  assert.deepEqual(new Set(ae.entries.map(e => info.familyCluster.get(e.family))), new Set(['W', 'codefix', 'need-qa', 'need-constraint']));
  assert.deepEqual(anchorEntries({ features: { 'need-qa': anchors.features['need-qa'] } }, info).skipped.map(x => x.jobFamily).sort(), ['codefix-notests', 'need-constraint', 'need-r0pad', 'need-r3mini', 'need-stage']);
  const base = runD0(), withA = runD0({ anchors });
  assert.equal(JSON.stringify(withA.primary), JSON.stringify(base.primary), 'the census-only primary result is untouched');
  assert.equal(base.anchorSensitivity, null);
  const s = withA.anchorSensitivity;
  assert.deepEqual(s.pool.clusterSizes, { W: 18, kinetics: 2, codefix: 4, 'need-qa': 2 });
  assert.equal(s.pool.trainEntries, 26); assert.ok(s.pool.queries.includes('need-constraint@d3') && s.pool.queries.length === 10);
  assert.deepEqual(s.primary.map(p => p.k), [3, 5]);
  assert.ok(s.primary.every(p => p.design.queries === 10 && p.loco.queries === 36));
  assert.ok(withA.sensitivities.length > base.sensitivities.length && withA.sensitivities.some(v => v.level === 'entries+anchors'));
  const real = (await everything()).d0.anchorSensitivity;
  assert.equal(real.pool.trainEntries, 26); assert.equal(real.anchors.length, 12); assert.equal(real.primary[0].design.queries, 10);
});

test('bedStamp hashes the module graph a bed loads: edits to the bed or what it imports move it; tests, READMEs, unimported files and beds/sealed do not', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'beds-'));
  const w = (f, t) => { mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); writeFileSync(path.join(repo, f), t); };
  w('beds/x/index.mjs', "import { u } from './util.mjs';\nimport '../lib/c.mjs';\nimport s from '../sealed/secret.mjs';\nexport const family = { version: '1.2.3' };\n");
  w('beds/x/util.mjs', 'export const u = 1;\n'); w('beds/lib/c.mjs', 'export const c = 1;\n'); w('beds/sealed/secret.mjs', 'export default 1;\n');
  w('beds/x/x.test.mjs', 'test\n'); w('beds/x/README.md', 'readme\n'); w('beds/x/unused.mjs', 'export const z = 1;\n');
  assert.deepEqual(bedGeneratorFiles('x', { repo }), ['beds/lib/c.mjs', 'beds/x/index.mjs', 'beds/x/util.mjs']);
  const a = bedStamp('x', { repo, version: '1.2.3' });
  assert.deepEqual([a.bed, a.version, a.files, Object.keys(a.dirs)], ['x', '1.2.3', 3, ['lib', 'x']]);
  assert.match(a.sha256, /^[0-9a-f]{16}$/);
  w('beds/x/unused.mjs', 'export const z = 2;\n'); w('beds/x/README.md', 'changed\n'); w('beds/x/x.test.mjs', 'changed\n'); w('beds/sealed/secret.mjs', 'export default 2;\n');
  assert.deepEqual(bedStamp('x', { repo, version: '1.2.3' }), a, 'files nothing imports, tests, READMEs and sealed beds are not part of the stamp');
  w('beds/x/util.mjs', 'export const u = 2;\n');
  const b = bedStamp('x', { repo, version: '1.2.3' });
  assert.notEqual(b.sha256, a.sha256); assert.notEqual(b.dirs.x.sha256, a.dirs.x.sha256); assert.equal(b.dirs.lib.sha256, a.dirs.lib.sha256);
  w('beds/lib/c.mjs', 'export const c = 2;\n');
  const c = bedStamp('x', { repo, version: '1.2.3' });
  assert.notEqual(c.dirs.lib.sha256, b.dirs.lib.sha256); assert.equal(c.dirs.x.sha256, b.dirs.x.sha256);
});

test('D1 records each anchor bed\'s version and module-graph hash; a changed hash reads as "inputs moved", explicitly', async () => {
  const all = await everything();
  const beds = all.d1.anchorBeds.beds;
  assert.deepEqual(Object.keys(beds).sort(), ['need-codefix-noverifier', 'need-constraint', 'need-qa', 'need-r0pad', 'need-r3mini', 'need-stage']);
  for (const b of Object.values(beds)) { assert.match(b.sha256, /^[0-9a-f]{16}$/); assert.match(b.version, /^\d+\.\d+\.\d+$/); assert.ok(b.files > 0 && Object.keys(b.dirs).length > 0); }
  assert.equal(all.d1.anchorBeds.errors.length, 0);
  const moved = JSON.parse(JSON.stringify(all));
  moved.d1.anchorBeds.beds['need-qa'].sha256 = '0'.repeat(16);
  const r = compareCurrency(all, moved);
  assert.equal(r.status, 'inputs-moved'); assert.deepEqual(r.inputsMoved.map(m => m.at), ['d1.anchorBeds.beds.need-qa']); assert.deepEqual(r.resultsDiffer, []);
  assert.match(describeCurrency(r), /^inputs moved, re-run run\.mjs --report: inputs moved: d1\.anchorBeds\.beds\.need-qa/);
  // D5 records the module graph of the E8 and runbook beds beside the SPEC-E.md hash.
  assert.match(all.d5.e8AndRunbook.e8.bed.sha256, /^[0-9a-f]{16}$/); assert.match(all.d5.e8AndRunbook.runbook.bed.sha256, /^[0-9a-f]{16}$/);
});

// ------------------------------------------------------------------------------------------------ currency: results apart from input hashes
test('compareCurrency: moved input hashes say "inputs moved, re-run"; only numbers that differ with nothing of theirs moved are a mismatch', () => {
  const doc = {
    schema: 's', code: { 'd0-knn.mjs': 'aaaa', 'report.mjs': 'bbbb' },
    inputs: { legacySources: [{ path: 'archive/p1.jsonl', sha256: '11', bytes: 5, rescued: true }], notes: [] },
    d0: { id: 'D0', sources: [{ path: 'census.json', sha256: '22', bytes: 7 }, { path: 'stages.json', sha256: '33', bytes: 9 }], summary: { x: 1 } },
    d4: { id: 'D4', summary: { y: 2 } },
    d5: { id: 'D5', e8AndRunbook: { e8: { text: { what: 'spec', sha256: '44', chars: 100 }, bed: { bed: 'ebed/e8', version: '1.0.0', files: 3, dirs: { ebed: { files: 3, sha256: '55' } }, sha256: '66' }, recall: 1 } } },
  };
  const edit = f => { const c = JSON.parse(JSON.stringify(doc)); f(c); return c; };
  const sp = splitProvenance(doc);
  assert.ok(!JSON.stringify(sp.results).includes('"sha256"') && !('code' in sp.results) && sp.hashes['d0.sources[1]'].sha256 === '33' && sp.hashes.code['d0-knn.mjs'] === 'aaaa');
  assert.equal(sp.results.d0.sources[1].path, 'stages.json', 'the path stays in the results: a file added or removed is a result difference');
  assert.equal(sp.hashes['d5.e8AndRunbook.e8.bed'].version, '1.0.0');
  assert.equal(compareCurrency(doc, doc).status, 'current');
  // stages.json edited (a stage cap): the numbers are unchanged, the file is out of date. Not a mismatch.
  const caps = compareCurrency(doc, edit(c => { c.d0.sources[1].sha256 = '99'; c.d0.sources[1].bytes = 10; }));
  assert.equal(caps.status, 'inputs-moved'); assert.deepEqual(caps.resultsDiffer, []); assert.deepEqual(caps.inputsMoved.map(m => m.at), ['d0.sources[1]']);
  assert.match(describeCurrency(caps), /^inputs moved, re-run run\.mjs --report/);
  // numbers differ with no input moved: a real mismatch.
  const bad = compareCurrency(doc, edit(c => { c.d0.summary.x = 2; }));
  assert.equal(bad.status, 'results-differ'); assert.deepEqual(bad.resultsDiffer, ['d0']); assert.match(describeCurrency(bad), /^MISMATCH/);
  // numbers differ because the section's own input moved (SPEC-E.md edited, E8 cues change): stale, not a mismatch.
  const stale = compareCurrency(doc, edit(c => { c.d5.e8AndRunbook.e8.text.sha256 = '77'; c.d5.e8AndRunbook.e8.recall = 0.67; }));
  assert.equal(stale.status, 'inputs-moved'); assert.deepEqual(stale.staleBecauseInputsMoved, ['d5']); assert.deepEqual(stale.resultsDiffer, []);
  // an archive hash moved: the sections that read the archive are stale with it; D0 (census) is not.
  const arch = compareCurrency(doc, edit(c => { c.inputs.legacySources[0].sha256 = '88'; c.d4.summary.y = 3; }));
  assert.deepEqual([arch.status, arch.staleBecauseInputsMoved, arch.resultsDiffer], ['inputs-moved', ['d4'], []]);
  const d0only = compareCurrency(doc, edit(c => { c.inputs.legacySources[0].sha256 = '88'; c.d0.summary.x = 3; }));
  assert.deepEqual([d0only.status, d0only.resultsDiffer], ['results-differ', ['d0']]);
  // code moved with equal numbers: re-run; code moved with different numbers and nothing else moved: a mismatch (the file predates the change).
  assert.deepEqual([compareCurrency(doc, edit(c => { c.code['d0-knn.mjs'] = 'cccc'; })).status, compareCurrency(doc, edit(c => { c.code['d0-knn.mjs'] = 'cccc'; })).codeMoved], ['inputs-moved', true]);
  assert.equal(compareCurrency(doc, edit(c => { c.code['d0-knn.mjs'] = 'cccc'; c.d0.summary.x = 5; })).status, 'results-differ');
});

test('an edit to stages.json no longer breaks the currency check: the committed diagnostics.json against itself with a moved stages.json hash is "inputs moved"', () => {
  const jf = path.join(REPO, 'research/need-router-20261014/analysis/m0/diagnostics.json');
  if (!existsSync(jf)) return;
  const committed = JSON.parse(readFileSync(jf, 'utf8'));
  const edited = JSON.parse(JSON.stringify(committed));
  let n = 0;
  for (const sec of ['d0', 'd1', 'd6']) for (const src of edited[sec].sources ?? []) if (/prereg\/stages\.json$/.test(src.path)) { src.sha256 = 'f'.repeat(64); src.bytes += 1234; n += 1; }
  assert.ok(n >= 3, 'stages.json is a recorded input of D0, D1 and D6');
  const r = compareCurrency(committed, edited);
  assert.deepEqual([r.status, r.resultsDiffer], ['inputs-moved', []]);
  assert.equal(r.inputsMoved.length, n);
});

// ------------------------------------------------------------------------------------------------ D5: E8 schedule is searched, not hard-coded
test('timeDeclarations finds typed timer, deadline and schedule declarations (keys and enum values), never prose', () => {
  const tree = { a: { description: 'a deadline in prose', deadlineAt: { type: 'string' }, status: { enum: ['open', 'timedOut'] }, kind: 'timer', note: 'every day' }, b: [{ cronSpec: 1 }] };
  assert.deepEqual(timeDeclarations(tree, 'x'), ['x.a.deadlineAt', 'x.a.status.enum[1] = "timedOut"', 'x.b[0].cronSpec']);
  assert.deepEqual(timeDeclarations({ a: { description: 'deadline', text: 'schedule' } }, 'x'), []);
  assert.equal(timeDeclarations(tree, 'x', { limit: 1 }).length, 1);
  const none = typedFieldsE8({ schemas: { humanTasks: {}, effects: {}, sor: {} }, systems: [], family: { clock: { horizon: { length: 14, unit: 'calendar-day' } }, profile: 'p' } });
  assert.deepEqual(none.schedule, { evidence: [], searched: ['family', 'schemas', 'systems'], note: none.schedule.note }, 'a bed with no typed time field is searched and reports none');
  const some = typedFieldsE8({ schemas: { humanTasks: {}, effects: { 'x.y': { args: { properties: { dueAt: {} } } } }, sor: {} }, systems: [], family: { clock: {}, profile: 'p' } });
  assert.deepEqual(some.schedule.evidence, ['schemas.effects.x.y.args.properties.dueAt']);
  const rb = typedFieldsRunbook({ outputSchema: { properties: { actions: { items: { properties: { op: { enum: ['wait', 'restart'] }, runAt: {} } } } } }, family: {} });
  assert.deepEqual(rb.schedule.evidence, [], 'a runAt field is not a timer, a deadline or a schedule by name');
  assert.deepEqual(rb.schedule.searched, ['outputSchema', 'family']);
  const rb2 = typedFieldsRunbook({ outputSchema: { properties: { schedule: { type: 'string' } } }, family: {} });
  assert.deepEqual(rb2.schedule.evidence, ['outputSchema.properties.schedule']);
  assert.ok(!/461/.test(readFileSync(path.join(here, 'd5-guard.mjs'), 'utf8')), 'the header no longer says 461 written descriptions (the corpus has 1,046)');
});

// ------------------------------------------------------------------------------------------------ D6: the cost-meter gate
test('D6 emits a machine-readable cost-meter gate: block-until-verified on the archived evidence, with its reasons and the way to clear it', async () => {
  const d = (await everything()).d6, g = d.summary.meterGate;
  assert.equal(g.schema, 'need-meter-gate/1'); assert.equal(g.status, 'block-until-verified');
  assert.deepEqual(g.reasons.map(r => r.code), ['OUTPUT_TOKENS_UNDER_RECORDED', 'REPRICE_OFF_REPORTED']);
  assert.equal(g.reasons[0].of, 8); assert.equal(g.reasons[0].sessions, 8); assert.ok(g.reasons[0].medianRecordedOverFinal < 0.01);
  const off = Object.fromEntries(g.reasons[1].groups.map(x => [x.key, x.ratioReportedOverReprice]));
  assert.ok(off['claude-opus-5-5 | post-flag'] > 2.9 && off['claude-opus-5-5 | pre-flag'] > 2.1 && off['claude-sonnet-5-5 | post-flag'] > 2.6);
  assert.match(g.clearedBy, /meter-gate-cli\.mjs --verify/); assert.equal(g.rule.outputTolerance, 0.05);
  assert.equal(JSON.stringify(d.summary.meterGate), JSON.stringify(buildMeterGate({ outputRatios: d.builderSessions.sessions.map(r => ({ label: r.label, model: r.model, recorded: r.outputTokensStreamUsage, final: r.outputTokensFinal })), eraRatios: d.agentSessions.byModelEra.map(m => ({ key: m.key, sessions: m.sessions, ratio: m.ratioReportedOverEra })) })), 'derived from D6\'s own checks');
  const md = renderReport(await everything());
  assert.ok(md.includes('The meter is now a gate, not a recommendation') && md.includes('**block-until-verified**') && md.includes('refuses to start a paid stage with an agent arm'));
  assert.ok(!md.includes('a flag, not a finding'));
});

test('D6 label impact is reported for L_today and L_ceiling; the gate is clear when the recorded output matches the final usage', async () => {
  const d = (await everything()).d6;
  const p1 = d.meterImpact.find(i => i.job === 'p1-records');
  // P1's headline cell is unlabelled under every meter (imputed dollars in direct-H-med): no label, no best mode, in either label set.
  for (const h of [p1.reported, p1.p5, p1.p1h, p1.ceiling.reported, p1.ceiling.p5, p1.ceiling.p1h]) { assert.equal(h.headlineLabel, 'unlabelled'); assert.equal(h.headlineTop, null); assert.match(h.headlineUnlabelled, /imputed dollars over 0\.3 in direct-H/); }
  assert.equal(p1.reported.unlabelledCells, 21); assert.equal(p1.ceiling.reported.unlabelledCells, 15);
  assert.ok(p1.p5.comparableCells <= 27 - 21, 'a flip or a best-mode change is counted only on cells labelled under both meters');
  assert.ok(d.meterImpact.find(i => i.job === 'jit-dev-records-1').ceiling, 'jit-OH and jit-SH are ceiling arms, so the job has an L_ceiling view');
  assert.equal(d.meterImpact.find(i => i.job === 'jit-r0-records').ceiling, null);
  assert.equal(buildMeterGate({ outputRatios: [{ recorded: 970, final: 1000 }], eraRatios: [{ key: 'k', sessions: 9, ratio: 1.03 }] }).status, 'clear');
});

// =====================================================================================================================================
// Regressions for the second adversarial review of the diagnostics (2026-10-15): unlabelled cells, the ceiling rule, the allow-listed
// stream loader, D3 signal hygiene, the fail-closed meter gate and the reproducible launch-environment measurement.
// =====================================================================================================================================

// ------------------------------------------------------------------------------------------------ D4 and D6 read `unlabelled`
const recRow = (mode, i, pass, usd, imputed = 0, extra = {}) => ({ mode, unit: `t${i}`, taskKey: `t${i}`, seed: 100 + i, taskHash: `h${i}`, pass, score: null, delivered: true, schemaValid: true, error: null, usdReported: usd, usdImputed: imputed, details: { entities: 40, extra: 0, missing: 0, fieldAccuracy: pass ? 0.99 : 0.9, pairF1: 1 }, ...extra });
test('D4 leaves unlabelled cells out: no label, no best mode, no count, no flip, no fragility (a mode with over 30% imputed dollars contends)', () => {
  const mk = imputed => {
    const rows = Array.from({ length: 10 }, (_, i) => [recRow('agent-H', i, i < 6, 0.05), recRow('direct-H', i, true, 0.01, imputed), recRow('script-H', i, i < 8, 0.01)]).flat();
    return { id: 'syn-unl', oracle: 'records', family: 'records', rows, builds: [{ mode: 'script-H', usd: 0.01 }], pairing: { modes: ['agent-H', 'direct-H', 'script-H'], paired: 10 }, sources: [] };
  };
  const f = fragilityOfJob(mk(0.5));   // direct-H books $0.51 a task, $0.50 of it imputed: it would win at $0.01, so the label rests on imputed dollars everywhere
  assert.equal(f.grid.unlabelled, 27); assert.equal(f.grid.labelled, 0);
  assert.deepEqual(f.labelCounts, { workflow: 0, 'no-workflow': 0, either: 0 }, 'an unlabelled cell is in no label count');
  assert.deepEqual(f.workflowCells, []);
  assert.equal(f.headline['1'].label, 'unlabelled'); assert.equal(f.headline['1'].top, null); assert.match(f.headline['1'].unlabelled, /^imputed dollars over 0\.3 in direct-H/);
  assert.deepEqual([f.grid.flipped, f.grid.topChangedCells, f.grid.fragile, f.headlineFlips.half, f.headlineFlips.double], [0, 0, false, false, false], 'nothing to flip or compare on a cell without a label');
  assert.deepEqual(Object.values(f.grid.unlabelledReasons), [27]);
  // The same job with its dollars observed is labelled everywhere: the difference is the flag, not the data.
  const ok = fragilityOfJob(mk(0));
  assert.equal(ok.grid.unlabelled, 0); assert.equal(Object.values(ok.labelCounts).reduce((a, x) => a + x, 0), 27);
  assert.notEqual(ok.headline['1'].label, 'unlabelled');
  // The summary counts them and the report prints the reason, not a label.
  const d = runD4([mk(0.5)]);
  assert.deepEqual([d.summary.cells, d.summary.unlabelledCells, d.summary.labelledCells, d.summary.flippedCells, d.summary.topChangedCells], [27, 27, 0, 0, 0]);
  assert.deepEqual(d.summary.unlabelledByJob, { 'syn-unl': { today: 27, ceiling: null } });
});

test('D4: a cell unlabelled at x1 is not a flip even when the tolerance factor gives it a different label', () => {
  // direct-H passes at x1 and x2 (field accuracy 0.975 against 0.97 and 0.94) but fails at x0.5 (0.985): at x1 it contends on imputed dollars (unlabelled), at x0.5 it is out
  // of the running and the cell is labelled workflow. The old code compared the raw x1 label (no-workflow) with it and called the job fragile.
  const rows = Array.from({ length: 10 }, (_, i) => [recRow('agent-H', i, i < 6, 0.05), recRow('direct-H', i, true, 0.01, 0.5, { details: { entities: 40, extra: 0, missing: 0, fieldAccuracy: 0.975, pairF1: 1 } }), recRow('script-H', i, i < 8, 0.01)]).flat();
  const job = { id: 'syn-flip', oracle: 'records', family: 'records', rows, builds: [{ mode: 'script-H', usd: 0.01 }], pairing: { modes: ['agent-H', 'direct-H', 'script-H'], paired: 10 }, sources: [] };
  const f = fragilityOfJob(job);
  assert.equal(f.reproduction.mismatches, 0);
  assert.deepEqual([f.headline['0.5'].label, f.headline['1'].label, f.headline['2'].label], ['workflow', 'unlabelled', 'unlabelled']);
  assert.equal(f.grid.unlabelled, 27);
  assert.deepEqual([f.grid.flipped, f.grid.fragile, f.headlineFlips.half, f.grid.topChangedCells, f.headlineTopChanges.half], [0, false, false, 0, false], 'unlabelled at x1: nothing to flip from');
});

test('D6 meterImpact counts a label flip or a best-mode change only on cells labelled under both meters, and reports the unlabelled ones', () => {
  const table = priceTable();
  const su = { inputTokens: 1.5e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };   // p5 re-prices it at the upper Haiku tier: $0.75 against the reported $0.01
  const mk = withDirect => {
    const rows = Array.from({ length: 10 }, (_, i) => [
      recRow('agent-H', i, true, 0.01, 0, { streamUsage: su, model: 'claude-haiku-5-5' }), recRow('script-H', i, i < 8, 0.01),
      ...(withDirect ? [recRow('direct-H', i, true, 0.01, 0.5)] : [])]).flat();
    return { id: 'syn-d6', oracle: 'records', rows, builds: [{ mode: 'script-H', usd: 0.01 }], pairing: { modes: withDirect ? ['agent-H', 'script-H', 'direct-H'] : ['agent-H', 'script-H'], paired: 10 }, sources: [] };
  };
  const [clean] = meterImpact([mk(false)], table), [dirty] = meterImpact([mk(true)], table);
  assert.ok(clean.p5.labelFlips > 0 && clean.p5.topChanges > 0, 'with observed dollars the re-price moves the best mode from agent-H to script-H, and the class with it');
  assert.equal(clean.p5.comparableCells, 27); assert.equal(clean.reported.unlabelledCells, 0);
  assert.deepEqual([dirty.p5.labelFlips, dirty.p5.topChanges, dirty.p5.comparableCells, dirty.p5.unlabelledCells, dirty.reported.unlabelledCells], [0, 0, 0, 27, 27],
    'direct-H is over 30% imputed and contends under both meters: every cell is unlabelled, so none is compared');
  assert.equal(dirty.reported.headlineLabel, 'unlabelled'); assert.equal(dirty.reported.headlineTop, null); assert.match(dirty.reported.headlineUnlabelled, /imputed dollars over 0\.3 in direct-H/);
  assert.equal(dirty.p5.headlineLabel, 'unlabelled');
});

test('the committed D4 and D6 sections count P1\'s unlabelled cells and the report prints a reason, never a label, for the headline', async () => {
  const r = await everything(), md = renderReport(r);
  const p1 = r.d4.jobs.find(j => j.job === 'p1-records');
  assert.equal(p1.headline['1'].label, 'unlabelled');
  assert.ok(md.includes('unlabelled (imputed dollars over 0.3 in direct-H-med)'), 'the findings and tables print the reason');
  assert.ok(!/L_ceiling says no-workflow at the headline/.test(md) && !/L_ceiling's headline label is \*\*no-workflow\*\*/.test(md), 'the old claim about P1\'s ceiling label is gone');
  assert.ok(md.includes('P1\'s headline cell is then unlabelled: imputed dollars over 0.3 in direct-H-med'));
  assert.match(md, /Why cells are unlabelled \(21 of 162 job-by-cell cells in L_today\)/);
});

// ------------------------------------------------------------------------------------------------ the ceiling rule: one field, the author
test('LEGACY_REGISTRY: ceiling is derived from who wrote the workflow; jit-OH (Opus) and jit-SH (Sonnet) are ceiling arms, so L_today is vacuous for an agent-H + jit-OH job', async () => {
  const wf = Object.entries(LEGACY_REGISTRY).filter(([, r]) => r.cls === 'workflow');
  assert.ok(wf.length >= 10 && wf.every(([, r]) => typeof r.builder === 'string'), 'every workflow mode says who wrote its workflow');
  assert.ok(wf.every(([, r]) => !!r.ceiling === (r.builder !== CHEAP_BUILDER)), 'ceiling is exactly "not written by the cheap builder"');
  assert.equal(CHEAP_BUILDER, 'haiku');
  assert.deepEqual(wf.filter(([, r]) => !r.ceiling).map(([m]) => m).sort(), ['jit-HH', 'script-H', 'static-b1h', 'wf-H']);
  assert.deepEqual(wf.filter(([, r]) => r.ceiling).map(([m]) => m).sort(), ['hand-H', 'hand-S', 'jit-OH', 'jit-SH', 'script-O', 'wf-O']);
  assert.deepEqual(['jit-HH', 'jit-OH', 'jit-SH'].map(m => LEGACY_REGISTRY[m].builder), ['haiku', 'opus', 'sonnet']);
  const rule = ceilingRule();
  assert.deepEqual(rule.ceilingBuilders, ['opus', 'sonnet']); assert.deepEqual(rule.byBuilder.sonnet, ['jit-SH']);
  // The label sets of the two kinetics jobs: jit-r0-kinetics ran agent-H and jit-OH only.
  const r0 = labelSetsOf(['agent-H', 'jit-OH']);
  assert.equal(r0.today.vacuous, true); assert.deepEqual(r0.today.modes, ['agent-H']); assert.deepEqual(r0.ceiling.extra, ['jit-OH']);
  const dev = labelSetsOf(['agent-H', 'agent-S', 'jit-HH', 'jit-OH', 'jit-SH']);
  assert.equal(dev.today.vacuous, false); assert.deepEqual(dev.today.workflowModes, ['jit-HH']); assert.deepEqual(dev.ceiling.extra, ['jit-OH', 'jit-SH']);
  // On the archive.
  const jobs = Object.fromEntries(runD4(legacy().jobs).jobs.map(j => [j.job, j]));
  assert.equal(jobs['jit-r0-kinetics'].labelSets.today.vacuous, true, 'jit-r0-kinetics has no Haiku-written workflow arm, so its L_today says nothing about need');
  assert.equal(jobs['jit-r0-kinetics'].grid.flipped, 0, 'and its L_today can no longer flip');
  assert.equal(jobs['jit-dev-kinetics-1'].labelSets.today.vacuous, false);
  assert.deepEqual(jobs['jit-dev-kinetics-1'].labelSets.today.workflowModes, ['jit-HH']);
  const md = renderReport(await everything());
  assert.ok(md.includes('sonnet: jit-SH') && md.includes('opus: hand-H, hand-S, wf-O, script-O, jit-OH'), 'the report states the rule and which modes it puts where');
});

// ------------------------------------------------------------------------------------------------ the loader reads only the experiments the job definitions name
test('loadJitJobs opens only the experiments the LEGACY job definitions name: a held-out stream under the same root is skipped, listed, and never read', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jit-allow-'));
  const arm = (exp, slug, rows, kind = 'agent') => {
    const dir = path.join(root, exp, slug); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'arm.json'), JSON.stringify({ kind, def: { perTaskUsd: 1, agentBudgetUsd: 2 } }));
    writeFileSync(path.join(dir, 'results.jsonl'), rows);
  };
  const row = n => JSON.stringify({ taskKey: `records:dev:d3:s${n}`, taskHash: `h${n}`, costUsd: 0.1, costBreakdown: {}, orphanUsd: 0, pass: true, error: null });
  arm('jit-dev-records-1', 'agent-claude-haiku-5-5', `${row(1)}\n${row(2)}\n`);
  // A held-out stream (test seeds in the held-out range): its file would not even parse, so any read of it throws.
  arm('jit-a11-heldout', 'agent-claude-haiku-5-5', '{"taskKey": "records:test:d3:s8805", this is not json\n');
  writeFileSync(path.join(root, 'MANIFEST.json'), '{}');
  assert.deepEqual(JIT_EXPERIMENTS, ['jit-dev-records-1', 'jit-r0-records', 'jit-dev-kinetics-1', 'jit-r0-kinetics']);
  const loaded = loadJitJobs(root);
  assert.deepEqual([...loaded.jobs.keys()], ['jit-dev-records-1']);
  assert.deepEqual(loaded.skipped.map(x => x.experiment), ['jit-a11-heldout']);
  assert.match(loaded.skipped[0].reason, /not read/);
  assert.ok(loaded.sources.every(p => !p.includes('jit-a11-heldout')), 'it is not among the hashed sources');
  assert.ok([...loaded.jobs.values()].every(j => j.allRows.every(r => !String(r.taskKey).includes('8805'))));
  // Opening it explicitly (a caller that names it) is the only way to read it; that read does throw here.
  assert.throws(() => loadJitJobs(root, { experiments: ['jit-a11-heldout'] }), /JSON|Unexpected|Expected/);
  // readStreams, the shared reader, takes the same restriction.
  assert.deepEqual(readStreams(root, { only: ['jit-dev-records-1'] }).map(s => s.family), ['jit-dev-records-1']);
  // The real runs root: nothing is skipped today, and every run names its skipped streams in the results.
  assert.deepEqual(loadJitJobs().skipped, []);
});

// ------------------------------------------------------------------------------------------------ D3 signal hygiene
test('D3: "not recorded" is not a zero. Schema validity is null without oracle details, a partly recorded signal is left out of the arm, never scored as 0', () => {
  assert.equal(schemaValidOf(null), null); assert.equal(schemaValidOf(undefined), null); assert.equal(schemaValidOf({}), true);
  assert.equal(schemaValidOf({ reason: 'schema-invalid' }), false); assert.equal(schemaValidOf({ reason: 'row-in-multiple-records' }), true);
  const base = { arm: 'b0call-haiku-none', experiment: 'p1', family: 'records', taskKey: 'records:dev:d3:s301', taskHash: 'h', trial: 0, pass: true, costUsd: 0.1 };
  const norm = r => normaliseRunRow({ ...base, ...r }, { modes: P1_MODES, source: 'x' });
  assert.equal(norm({}).schemaValid, null, 'no oracleDetails: not recorded');
  assert.equal(norm({ oracleDetails: null }).schemaValid, null);
  assert.equal(norm({ oracleDetails: JSON.stringify({ fieldAccuracy: 1 }) }).schemaValid, true);
  assert.equal(norm({ oracleDetails: JSON.stringify({ reason: 'schema-invalid' }) }).schemaValid, false);
  assert.equal(postHocSignals({ schemaValid: null }).schemaInvalid, null); assert.equal(postHocSignals({}).schemaInvalid, null);
  assert.equal(postHocSignals({ schemaValid: true }).schemaInvalid, 0); assert.equal(postHocSignals({ schemaValid: false }).schemaInvalid, 1);
  // A group where turns are recorded for half the rows: the old code scored the missing half as 0 (an artificial split of passes from failures); now the signal is skipped and listed.
  const struct = new Map(), rows = [];
  for (let i = 0; i < 24; i++) {
    const key = `t${i}`; struct.set(key, { vector: TRUSTED8.map((_, j) => (j === 0 ? 3.8 + (i % 5) * 0.001 : 1)), hashOk: true });
    const pass = i % 2 === 0;
    rows.push({ taskKey: key, pass, difficulty: 3, schemaValid: i < 12 ? true : null, usdReported: pass ? 0.01 : 0.2 + i * 0.001, turns: i % 2 === 0 ? null : 7, tools: pass ? 3 : 5 });
  }
  const g = evaluateGroup(rows, struct, { boot: 50 });
  assert.deepEqual(g.postHocPartlyRecorded.logTurns, { missing: 12, of: 24 }, 'turns recorded on the 12 failing rows only');
  assert.deepEqual(g.postHocPartlyRecorded.schemaInvalid, { missing: 12, of: 24 });
  assert.ok(!('logTurns' in g.postHocAuc) && !('schemaInvalid' in g.postHocAuc), 'partly recorded signals get no AUC');
  assert.ok('logTools' in g.postHocAuc && 'logCost' in g.postHocAuc, 'fully recorded ones do');
  // The old scoring would have given logTurns a perfect AUC from the artifact alone (missing = 0 on every pass, 7 on every failure).
  assert.equal(g.primary.postHoc, 1);
  const none = evaluateGroup(rows.map(r => ({ ...r, turns: null, schemaValid: true })), struct, { boot: 50 });
  assert.deepEqual(none.postHocPartlyRecorded, {}, 'a signal no row records is simply not one of the arm\'s signals');
});

test('D3 results list partly recorded signals; the archive has none today and the report says nothing about them', async () => {
  const d = (await everything()).d3;
  assert.deepEqual(d.summary.postHocPartlyRecorded, []);
  assert.ok(d.groups.every(g => !g.postHocAuc || g.postHocPartlyRecorded));
});

// ------------------------------------------------------------------------------------------------ run.mjs may not switch the meter gate off
test('run.mjs: a subset of the diagnostics may not rewrite analysis/m0; it needs another --out, and --check takes the full set', () => {
  const OUT = path.join(C.REPO, 'research/need-router-20261014/analysis/m0'), tmpOut = mkdtempSync(path.join(os.tmpdir(), 'm0-'));
  assert.deepEqual(planRun({ only: ALL, outDir: OUT }).errors, []);
  assert.equal(planRun({ only: ALL, outDir: OUT }).full, true);
  const sub = planRun({ only: ['d0'], outDir: OUT });
  assert.equal(sub.errors.length, 1); assert.match(sub.errors[0], /would rewrite the committed .*diagnostics\.json without d1, d2, d3, d4, d5, d6/); assert.match(sub.errors[0], /meter gate|gate/);
  assert.deepEqual(planRun({ only: ['d0', 'd3'], outDir: tmpOut }).errors, [], 'a subset is fine elsewhere');
  assert.equal(planRun({ only: ['d0'], outDir: tmpOut }).full, false);
  assert.match(planRun({ only: ['d0'], outDir: tmpOut, check: true }).errors[0], /--check .* cannot take --only/);
  assert.match(planRun({ only: ['d0', 'nope'], outDir: tmpOut }).errors[0], /unknown diagnostic\(s\) nope/);
  assert.equal(planRun({ only: ['d6', 'd0'], outDir: path.join(OUT, '.') }).errors.length, 1, 'the same directory spelled another way');
  assert.ok(MODULES.includes('launch-env.mjs'));
});

test('run.mjs --only against the committed analysis/m0 exits 2 before computing anything and leaves diagnostics.json byte for byte as it was', () => {
  const file = path.join(C.REPO, 'research/need-router-20261014/analysis/m0/diagnostics.json');
  const before = readFileSync(file);
  let code = 0, err = '';
  try { execFileSync(process.execPath, [path.join(here, 'run.mjs'), '--only', 'd0'], { cwd: C.REPO, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 20000 }); }
  catch (e) { code = e.status; err = String(e.stderr); }
  const after = readFileSync(file);
  if (Buffer.compare(before, after) !== 0) { writeFileSync(file, before); assert.fail('run.mjs --only rewrote the committed diagnostics.json (restored)'); }
  assert.equal(code, 2); assert.match(err, /refused: --only d0 would rewrite/);
});

test('a subset run names itself partial, and the gate reader finds no gate in it (so label-run refuses an agent stage on it)', async () => {
  const r = await runAll({ only: ['d2'] });
  assert.deepEqual(r.partial, { ran: ['d2'], notRun: ['d0', 'd1', 'd3', 'd4', 'd5', 'd6'] });
  const g = parseMeterGate(JSON.stringify(r));
  assert.equal(g.gate, null); assert.match(g.problem, /partial run \(d2 only\)/);
  assert.equal((await everything()).partial, undefined, 'the full run carries no partial marker');
  assert.deepEqual(parseMeterGate(JSON.stringify(await everything())).problem, null);
  assert.deepEqual((await everything()).inputs.skippedStreams, []);
});

// ------------------------------------------------------------------------------------------------ the launch-environment measurement is a committed file
test('launch-env: cacheRateOf prices a session at the 1-hour and the 5-minute cache-write rate and says which the CLI billed; the summary counts them', () => {
  const table = priceTable();
  const result = (model, { w1 = 0, w5 = 0, cost = null, out = 5000, input = 20, read = 100000 } = {}) => {
    const u = { input_tokens: input, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: w1 + w5, cache_creation: { ephemeral_1h_input_tokens: w1, ephemeral_5m_input_tokens: w5 } };
    const at1 = priceTokens(table, model, { input, output: out, cacheRead: read, cacheWrite1h: w1 + w5 }).usd;
    return { type: 'result', usage: u, total_cost_usd: cost ?? at1, modelUsage: { [model]: {} } };
  };
  const opus1h = cacheRateOf(result('claude-opus-5-5', { w1: 50000 }), table);
  assert.equal(opus1h.exact1h, true); assert.equal(opus1h.exact5m, false); assert.equal(opus1h.cacheWrite1hShare, 1);
  approx(opus1h.ratio1hOverReported, 1, 1e-6); assert.ok(opus1h.ratio5mOverReported < 0.9 && opus1h.ratio5mOverReported > 0.7);
  const opus5m = cacheRateOf(result('claude-opus-5-5', { w5: 50000, cost: priceTokens(table, 'claude-opus-5-5', { input: 20, output: 5000, cacheRead: 100000, cacheWrite5m: 50000 }).usd }), table);
  assert.equal(opus5m.exact5m, true); assert.equal(opus5m.exact1h, false); assert.equal(opus5m.cacheWrite1hShare, 0);
  assert.match(cacheRateOf({ type: 'result', usage: {}, total_cost_usd: 0, modelUsage: {} }, table).skipped, /no usage or no CLI-reported cost/);
  assert.match(cacheRateOf({ ...result('claude-opus-5-5', { w1: 1 }), modelUsage: { 'claude-opus-5-5': {}, 'claude-haiku-5-5': {} } }, table).skipped, /more than one model/);
  assert.match(cacheRateOf({ ...result('claude-opus-5-5', { w1: 1 }), modelUsage: { 'claude-future-9': {} } }, table).skipped, /not in the pinned price table/);
  // Transcripts: the last result event wins, a torn last line is ignored, a transcript with no result is skipped with its hash.
  const line = o => JSON.stringify(o);
  const t1 = [line({ type: 'assistant' }), line(result('claude-sonnet-5-5', { w1: 1000, cost: 1 })), line(result('claude-sonnet-5-5', { w1: 1000 })), '{"type":"result","usage":{'].join('\n');
  assert.equal(finalResult(t1).modelUsage['claude-sonnet-5-5'] !== undefined, true);
  const files = { '/x/a/.executor-transcript.jsonl': t1, '/x/b/.executor-transcript.jsonl': line({ type: 'assistant' }) };
  const recs = measureTranscripts(Object.keys(files).map(file => ({ file, bytes: files[file].length, mtime: '2026-10-09T00:00:00.000Z' })), table, { root: '/x', read: f => files[f] });
  assert.deepEqual(recs.map(r => r.path), ['a/.executor-transcript.jsonl', 'b/.executor-transcript.jsonl']);
  assert.ok(recs.every(r => /^[0-9a-f]{16}$/.test(r.sha256)));
  assert.equal(recs[0].exact1h, true); assert.match(recs[1].skipped, /no final result event/);
  const sum = summariseLaunchEnv(recs);
  assert.deepEqual([sum.transcripts, sum.withFinalUsage, sum.skipped], [2, 1, 1]);
  assert.deepEqual([sum.byModel['claude-sonnet-5-5'].sessions, sum.byModel['claude-sonnet-5-5'].exact1h, sum.byModel['claude-sonnet-5-5'].exact5m, sum.byModel['claude-sonnet-5-5'].allWritesOneHour], [1, 1, 0, 1]);
});

test('launch-env.json is the committed record behind the D6 launch-environment paragraph: self-consistent, hashed per transcript, rendered with no number written by hand', async () => {
  const le = readLaunchEnv();
  assert.ok(le, 'analysis/m0/launch-env.json is committed'); assert.equal(le.schema, LAUNCH_ENV_SCHEMA);
  assert.ok(le.transcripts.length > 0 && le.transcripts.every(t => /^[0-9a-f]{16}$/.test(t.sha256) && t.path && Number.isFinite(t.bytes) && Date.parse(t.mtime) >= Date.parse(le.after)));
  assert.deepEqual(summariseLaunchEnv(le.transcripts), le.summary, 'the summary is recomputed from the per-transcript records');
  assert.equal(le.summary.transcripts, le.transcripts.length);
  const r = await everything();
  assert.deepEqual(r.d6.launchEnv.summary, le.summary); assert.equal(r.d6.launchEnv.source.path, 'research/need-router-20261014/analysis/m0/launch-env.json');
  assert.match(r.d6.launchEnv.source.sha256, /^[0-9a-f]{64}$/);
  const md = renderReport(r);
  const total = le.summary.withFinalUsage, opus = le.summary.byModel['claude-opus-5-5'];
  assert.ok(md.includes(`Of the ${le.summary.transcripts} CLI transcripts`) && md.includes(`${total} have a final usage record`));
  assert.ok(md.includes(`${opus.exact1h} of ${opus.sessions} opus`));
  // Without the committed measurement the paragraph says so and states no session count.
  const without = renderReport({ ...r, d6: { ...r.d6, launchEnv: null } });
  assert.ok(without.includes('No launch-environment measurement is committed') && !without.includes('CLI transcripts under'));
  // The old hand-measured, unreproducible figures are not in the report source.
  const src = readFileSync(path.join(here, 'report.mjs'), 'utf8');
  for (const gone of ['336 final-usage records', 'to within 1% for all 76 Opus', 'not reproduced by', 'Every number in the report is read from']) assert.ok(!src.includes(gone), gone);
});
