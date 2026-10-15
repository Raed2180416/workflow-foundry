import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluate, commitDecisions, verifyEnvelope, loadLabels, publicView, shortcutView, TRUSTED_FEATURES, PROSE_FEATURES, N1, defaultPolicies, nrStatic,
  readingOf as readingOf0, powerSimulation, metamorphic, importPurity, seedChecks, buildIsolation, nearestClusterTest, upperHull, hullAt, sliderCalibration, gateG1,
  randomMatched, decideFolds, makeContext, fitRule, syntheticWorld,
} from '../evaluate.mjs';
import { HEADLINE, makeCell, needTable, needLabels, withCascades, GRID } from '../metrics.mjs';
import { plantedWorld, judgeAlwaysAgent, needsWorkflow, SMALL, BIG, features } from './worlds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAST = { reps: 200, bootReps: 0, l2Perms: 0, randomDraws: 100, attacks: false };
const trainOnly = W => ({ rows: W.rows.filter(r => W.meta[r.job].split === 'train'), builds: W.builds.filter(b => W.meta[b.job].split === 'train') });

// One planted evaluation shared by several tests (the leak tests and attacks on, small replicate counts).
const W = plantedWorld({ near: 7 });
const recorded = judgeAlwaysAgent(W.meta);
const committed = commitDecisions({ ...trainOnly(W), meta: W.meta, recorded, reps: 200, createdAt: '2026-10-24T00:00:00Z' });
const R = evaluate({ ...W, recorded, committed, split: 'heldout', reps: 200, bootReps: 1000, l2Perms: 60, randomDraws: 400 });

test('planted optima: NR-static recovers the planted thresholds and sends every held-out job to its planted class', () => {
  const [rule] = R.fittedRule;
  assert.ok(rule.thresholds.logInputTokens > 3.8 && rule.thresholds.logInputTokens <= 4.6, `θ_tok ${rule.thresholds.logInputTokens}`);
  assert.ok(rule.thresholds.maxListLength > 1.5 && rule.thresholds.maxListLength <= 2.6, `θ_fan ${rule.thresholds.maxListLength}`);
  const s = R.scores['NR-static'][HEADLINE.key];
  for (const x of s.perJob) assert.equal(x.workflow === 1, needsWorkflow(W.meta[x.job].features), `${x.job} routed ${x.mode}`);
  assert.ok(s.delta > 0.03 && s.lo > 0);
  assert.equal(R.primary['NR-static'].reading, 'SUPPORTED', JSON.stringify(R.primary['NR-static'].unmet));
  assert.equal(R.primary['NR-probe'].reading, 'NOT RUN');
  // The size-only rule misses the wide jobs; the structural rule beats it, and C7a reads at diagnostic grade.
  assert.ok(R.primary['NR-static'].vsTuned.lo > 0);
  assert.equal(R.c7a.reading, 'SUPPORTED-DIAGNOSTIC');
  assert.equal(R.c7a['NR-static'].N1.balancedAccuracy.point, 1);
  assert.ok(R.c7a['tuned-size-rule'].N1.balancedAccuracy.point < 0.8);
});

test('scorer anchors: the peek router scores 1, a constant SBS scores 0, VBS* <= VBS', () => {
  const peek = R.scores.peek[HEADLINE.key], sbs = R.scores['SBS-train'][HEADLINE.key];
  assert.ok(Math.abs(peek.closedGapVBS - 1) < 1e-12, `peek closed gap ${peek.closedGapVBS}`);
  assert.equal(peek.modeAccuracy, 1);
  assert.equal(sbs.delta, 0); assert.equal(sbs.closedGap, 0); assert.equal(sbs.lo, 0); assert.equal(sbs.hi, 0);
  for (const c of GRID) assert.ok(R.scores['SBS-train'][c.key].vbsStar <= R.scores['SBS-train'][c.key].vbs + 1e-12, c.key);
  // A constant SBS chosen on TRAIN is the yardstick itself; the fixed mode it picks scores Δ = 0 too.
  const m = R.scores['SBS-train'][HEADLINE.key].perJob[0].sbs;
  if (R.scores[`always-${m}`]) assert.ok(Math.abs(R.scores[`always-${m}`][HEADLINE.key].delta) < 1e-12);
});

test('random routing at the router\'s mode mix scores its analytic expectation', () => {
  const p = R.primary['NR-static'].random;
  assert.ok(Math.abs(p.mean - p.expectation) <= 4 * p.sd / Math.sqrt(p.draws) + 1e-9, `${p.mean} vs ${p.expectation} (sd ${p.sd})`);
  assert.ok(R.primary['NR-static'].headline.mean > p.q95, 'the planted router beats random routing at its own mix');
});

test('leak tests on a clean evaluation: L1-L8 pass, the shuffled-label null sits at or below 0, and the real router beats it', () => {
  const L = R.leaks;
  assert.equal(L.f6, false, JSON.stringify(Object.fromEntries(Object.entries(L).filter(([, v]) => v?.ok === false))));
  for (const k of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']) assert.notEqual(L[k].ok, false, k);
  assert.ok(L.L2.nullMean <= 0.01 && L.L2.realExceeds95 === true, JSON.stringify(L.L2));
  assert.ok(L.L3.assessed && L.L3.delta <= 1e-9);
  assert.ok(L.L6.compared > 0);
  assert.equal(R.blocked.length, 0);
});

test('L4 and L7 catch seed misuse; L5 catches a bed scorer import; L6 catches a changed or missing envelope', () => {
  const T = needTable(W.rows, W.builds);
  const badMeta = { ...W.meta, 'T0-j0': { ...W.meta['T0-j0'], exampleSeeds: [610] } };
  assert.match(seedChecks(T, badMeta).problems.join('\n'), /example seed 610 outside .* also an evaluation seed|example seed 610/);
  const moved = needTable(W.rows.map(r => (r.job === 'H0-j0' && r.task === 't00' ? { ...r, seed: 601 } : r)), W.builds);
  assert.match(seedChecks(moved, W.meta).problems.join('\n'), /seed 601 outside the heldout range/);
  assert.equal(buildIsolation(W.builds.map((b, i) => (i === 0 ? { ...b, scoreChecks: 12 } : b)), T, W.meta).ok, false);
  assert.match(buildIsolation(W.builds.map((b, i) => (i === 0 ? { ...b, probeSeeds: [610] } : b)), T, W.meta).problems.join('\n'), /seed 610/);
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-l5-'));
  writeFileSync(path.join(dir, 'bad.mjs'), "import { score } from '../lib/beds.mjs';\nimport { oracle } from './x.mjs';\nexport const f = 1;\n");
  writeFileSync(path.join(dir, 'ok.mjs'), "import { score } from './metrics.mjs';\nexport const g = 1;\n");
  assert.equal(importPurity({ files: [path.join(dir, 'bad.mjs')] }).problems.length, 2);
  assert.deepEqual(importPurity({ files: [path.join(dir, 'ok.mjs')] }).problems, []);
  assert.deepEqual(importPurity().problems, []);
  // Envelope: no envelope, a tampered payload, and a decision that changed after the commit all fail.
  const fresh = commitDecisions({ ...trainOnly(W), meta: W.meta, recorded, reps: 200, createdAt: committed.createdAt });
  assert.equal(fresh.sha256, committed.sha256, 'decisions are a deterministic function of TRAIN labels and the code');
  assert.equal(verifyEnvelope(null, fresh).ok, false);
  const tampered = structuredClone(committed); tampered.payload.decisions[0].mode = tampered.payload.decisions[0].mode === 'direct-H' ? 'agent-H' : 'direct-H';
  assert.match(verifyEnvelope(tampered, fresh).problems.join('\n'), /does not match its sha256/);
  assert.ok(verifyEnvelope(tampered, fresh).problems.some(p => /changed after commit/.test(p)));
  assert.equal(verifyEnvelope(committed, fresh, { firstHeldoutRowAt: '2026-10-23T00:00:00Z' }).ok, false, 'an envelope dated after the first held-out row fails');
  assert.equal(verifyEnvelope(committed, fresh, { firstHeldoutRowAt: '2026-10-25T00:00:00Z' }).ok, true);
  assert.equal(committed.payload.reps, 200);
  assert.throws(() => commitDecisions({ rows: W.rows, builds: W.builds, meta: W.meta }), /non-TRAIN row/);
});

test('decisions never read held-out labels: flipping every held-out outcome leaves every decision unchanged', () => {
  const flipped = W.rows.map(r => (W.meta[r.job].split === 'heldout' ? { ...r, pass: !r.pass, delivered: true, usdRepriced: r.usdRepriced * 3 + 0.1 } : r));
  const a = evaluate({ ...W, recorded, split: 'heldout', ...FAST, leak: false });
  const b = evaluate({ ...W, rows: flipped, recorded, split: 'heldout', ...FAST, leak: false });
  for (const n of Object.keys(a.scores).filter(n => !['peek', 'SBS-test'].includes(n))) {
    assert.deepEqual(a.scores[n][HEADLINE.key].perJob.map(x => x.mode), b.scores[n][HEADLINE.key].perJob.map(x => x.mode), n);
  }
  assert.notDeepEqual(a.scores.peek[HEADLINE.key].perJob.map(x => x.mode), b.scores.peek[HEADLINE.key].perJob.map(x => x.mode), 'the peek control does read them');
});

test('policies see only the public view: opaque id, trusted features, requirements, verifier, modes', () => {
  const v = publicView('records-hi', { family: 'records', kind: 'oneshot', text: 'Sum the rows', features: { logInputTokens: 3, effectVerbs: 2, promptWords: 1, maxListLength: 1 } }, ['direct-H']);
  assert.deepEqual(Object.keys(v).sort(), ['features', 'id', 'modes', 'requirements', 'verifier']);
  assert.deepEqual(Object.keys(v.features).sort(), ['logInputTokens', 'maxListLength']);
  assert.ok(!v.id.includes('records'));
  assert.equal(TRUSTED_FEATURES.length, 8); assert.ok(PROSE_FEATURES.every(k => !TRUSTED_FEATURES.includes(k)));
  const s = shortcutView('records-hi', { family: 'records', kind: 'oneshot', text: 'Sum the rows', features: { effectVerbs: 2 } }, ['direct-H']);
  assert.equal(s.family, 'records'); assert.equal(s.prose.effectVerbs, 2);
  // A non-shortcut policy is never handed the shortcut view.
  const seen = [];
  const spy = { name: 'spy', role: 'baseline', fit: () => (view, cell, sv) => { seen.push(sv); return { mode: view.modes[0] }; } };
  evaluate({ ...W, split: 'heldout', ...FAST, leak: false, policies: [...defaultPolicies(), spy] });
  assert.ok(seen.length > 0 && seen.every(x => x === undefined));
});

test('false SUPPORTED stays at or under 5% under null simulations', () => {
  // (a) Δ level at the planned sizes: exact sign-flip test, Holm over the two co-primaries.
  const P = powerSimulation({ clusters: [5, 6, 7, 8], deltas: [0], sims: 2000, seed: 5 });
  for (const r of P.rows) assert.ok(r.pAnySupportedDelta <= 0.05, `${r.clusters} clusters: ${r.pAnySupportedDelta}`);
  assert.equal(P.rows.find(r => r.clusters === 5).pAnySupportedDelta, 0, 'with 5 clusters nothing can be SUPPORTED');
  // ... and the test has power against a large planted effect.
  const A = powerSimulation({ clusters: [8], deltas: [0.15], sims: 400, seed: 6 });
  assert.ok(A.rows[0].pSupportedDelta > 0.8, `power ${A.rows[0].pSupportedDelta}`);
  // (b) the whole pipeline on null worlds (structure carries no information about the best mode).
  let supported = 0;
  const sims = 40;
  for (let s = 0; s < sims; s++) {
    const N = plantedWorld({ seed: 100 + s, informative: false });
    const r = evaluate({ ...N, recorded: judgeAlwaysAgent(N.meta), split: 'heldout', reps: 80, bootReps: 0, l2Perms: 0, randomDraws: 10, attacks: false, leak: false });
    if (r.primary['NR-static'].reading === 'SUPPORTED') supported += 1;
  }
  assert.ok(supported / sims <= 0.05, `${supported}/${sims} null worlds read SUPPORTED`);
});

test('readings follow the preregistered table', () => {
  // holmReject: the co-primary's Holm decision is an input of the reading (review 2026-10-15; see evaluate-review.test.mjs).
  const readingOf = x => readingOf0({ holmReject: true, ...x });
  const ok = { complete: true, lo: 0.01 }, cal = { calibrated: true, predicted: true };
  const perV = [{ V: 0.1, lo: 0.01, hi: 0.2 }, { V: 1, lo: 0.01, hi: 0.2 }, { V: 10, lo: 0.01, hi: 0.2 }];
  assert.equal(readingOf({ headline: { mean: 0.08, lo: 0.04, hi: 0.12 }, perV, vsTuned: ok, vsJudge: ok, slider: cal }).reading, 'SUPPORTED');
  assert.equal(readingOf({ headline: { mean: 0.08, lo: 0.04, hi: 0.12 }, perV, vsTuned: ok, vsJudge: ok, slider: cal }).usefulSizeShown, true);
  assert.equal(readingOf({ headline: { mean: 0.08, lo: 0.01, hi: 0.12 }, perV, vsTuned: ok, vsJudge: ok, slider: cal }).usefulSizeShown, false);
  assert.equal(readingOf({ headline: { mean: 0.02, lo: 0.005, hi: 0.04 }, perV, vsTuned: ok, vsJudge: ok, slider: cal }).reading, 'SUPERIOR, BELOW USEFUL EFFECT');
  assert.equal(readingOf({ headline: { mean: 0.08, lo: 0.04, hi: 0.12 }, perV, vsTuned: ok, vsJudge: null, slider: cal }).reading, 'INCONCLUSIVE');
  assert.equal(readingOf({ headline: { mean: 0.08, lo: 0.04, hi: 0.12 }, perV, vsTuned: ok, vsJudge: ok, slider: { calibrated: false, predicted: false } }).reading, 'INCONCLUSIVE');
  assert.equal(readingOf({ headline: { mean: 0.08, lo: 0.04, hi: 0.12 }, perV, vsTuned: ok, vsJudge: ok, slider: cal, withoutNear: { mean: -0.01 } }).reading, 'INCONCLUSIVE');
  assert.deepEqual(readingOf({ headline: { mean: -0.01, lo: -0.05, hi: 0.02 }, perV: [{ V: 0.1, hi: -0.01 }, { V: 1, hi: 0.02 }, { V: 10, hi: 0.1 }] }).disabledPositions, [0.1]);
  assert.equal(readingOf({ headline: { mean: -0.01, lo: -0.05, hi: 0.02 }, perV: [{ V: 0.1, hi: -0.01 }, { V: 1, hi: 0.02 }, { V: 10, hi: 0.1 }] }).reading, 'HARMFUL');
  assert.equal(readingOf({ headline: { mean: 0, lo: -0.02, hi: 0.02 }, perV: [{ V: 0.1, hi: 0.01 }, { V: 1, hi: 0.02 }, { V: 10, hi: 0.025 }] }).reading, 'REFUTED');
  assert.equal(readingOf({ headline: { mean: 0.05, lo: -0.02, hi: 0.1 }, perV: [{ V: 0.1, hi: 0.1 }, { V: 1, hi: 0.1 }, { V: 10, hi: 0.1 }] }).reading, 'INCONCLUSIVE');
  assert.equal(readingOf({ headline: { mean: 0.08, lo: 0.04, hi: 0.12 }, perV, vsTuned: ok, vsJudge: ok, slider: cal, g1: 'REFUTED-PREMISE' }).reading, 'REFUTED');
});

test('metamorphic runner: pairs, padding, keyword injection, N off by 10x and monotonicity in N', () => {
  const meta = {
    r0: { cluster: 'W', split: 'train', features: { logInputTokens: 2.6, maxListLength: 0.5 }, text: 'Answer one question.' },
    'r0-pad': { cluster: 'W', split: 'train', features: { logInputTokens: 4.4, maxListLength: 0.5 }, text: 'Answer one question.', metamorph: { of: 'r0', expect: 'same' } },
    r3: { cluster: 'W', split: 'train', features: { logInputTokens: 4.8, maxListLength: 3.2 }, text: 'Reconcile statements.' },
    'r3-mini': { cluster: 'W', split: 'train', features: { logInputTokens: 2.8, maxListLength: 0.5 }, text: 'Reconcile statements.', metamorph: { of: 'r3', expect: 'different' } },
  };
  const modesOf = () => ['direct-H', 'agent-H', 'construct-H'];
  const size = (view) => ({ mode: view.features.logInputTokens >= 4.3 ? 'construct-H' : 'direct-H' });
  const fan = (view) => ({ mode: view.features.maxListLength >= 2 ? 'construct-H' : 'direct-H' });
  const kw = (view, cell, sv) => ({ mode: /workflow|pipeline/i.test(sv?.text ?? '') ? 'construct-H' : 'direct-H' });
  const jobs = Object.keys(meta);
  const S = metamorphic(size, jobs, { meta, modesOf }), F = metamorphic(fan, jobs, { meta, modesOf }), K = metamorphic(kw, jobs, { meta, modesOf, policy: { shortcut: true } });
  assert.equal(S.pairs.find(p => p.job === 'r0-pad').ok, false, 'a size router splits r0 from r0-pad');
  assert.equal(F.pairsOk, true, 'a fan-out router keeps r0 with r0-pad and separates r3-mini from r3');
  assert.ok(S.pad.flipRate > 0 && F.pad.flipRate === 0);
  assert.ok(K.inject.flipRate >= 0.5 && K.f5 === true && F.inject.flipRate === 0);
  // Monotonicity in N: a policy that drops the workflow at a larger N is caught.
  const perverse = (view, cell) => ({ mode: cell.N >= 10 && cell.N < 50 ? 'construct-H' : 'direct-H' });
  assert.ok(metamorphic(perverse, jobs, { meta, modesOf }).monotone.violations > 0);
  assert.equal(metamorphic(size, jobs, { meta, modesOf }).monotone.violations, 0);
  // N off by 10x: regret against the labels at the true cell (here the planted evaluation's NR-static).
  assert.ok(R.metamorph['NR-static'].nOff.x10.n > 0 && R.metamorph['NR-static'].nOff.x10.meanRegret >= -1e-9);
});

test('slider calibration, convex hull of fixed modes, gate G1', () => {
  const h = upperHull([{ x: 0.01, y: 0.5 }, { x: 0.1, y: 0.9 }, { x: 0.05, y: 0.6 }, { x: 1, y: 0.95 }, { x: 0.5, y: 0.8 }]);
  assert.deepEqual(h.map(p => p.x), [0.01, 0.1, 1]);
  assert.ok(Math.abs(hullAt(h, 0.055) - 0.7) < 1e-9); assert.equal(hullAt(h, 0.001), null); assert.equal(hullAt(h, 5), 0.95);
  assert.ok(R.hull.gap['NR-static'].aboveHull >= -1e-9, 'the planted router is on or above the hull of the fixed modes');
  const sl = R.primary['NR-static'].slider;
  assert.equal(sl.calibrated, true); assert.equal(sl.positions.length, 3);
  // Predictions 0.2 off in success at two positions: uncalibrated.
  const T = withCascades(W.rows, W.builds), L = needLabels(T, { cells: GRID, reps: 0 });
  const jobs = T.jobs.filter(j => W.meta[j].split === 'heldout');
  const dec = new Map(jobs.map(j => [j, new Map(GRID.map(c => [c.key, { mode: 'construct-H', routingUsd: 0, pred: { p: c.V === 10 ? 0.95 : 0.5, usd: L.usd(j, c, 'construct-H') } }]))]));
  assert.equal(sliderCalibration(L, dec, jobs).calibrated, false);
  // Monotonicity in V, on a stub: the mode chosen at V = 0.1, 1, 10 has the given realised success and $ per task.
  const slider = (ps, us, opts) => {
    const modes = ['m0', 'm1', 'm2'], P = Object.fromEntries(modes.map((m, i) => [m, ps[i]])), U = Object.fromEntries(modes.map((m, i) => [m, us[i]]));
    const stub = { stats: (j, m) => ({ s: P[m] }), usd: (j, c, m) => U[m] };
    const d = new Map([['j', new Map([0.1, 1, 10].map((V, i) => [makeCell(V, 10).key, { mode: modes[i], routingUsd: 0, pred: { p: ps[i], usd: us[i] } }]))]]);
    return sliderCalibration(stub, d, ['j'], opts);
  };
  // The preregistered rule is literal (non-decreasing; review 2026-10-15): a 0.4-point fall is a decrease. A tolerance is a sensitivity only.
  assert.equal(slider([0.95, 0.96, 0.956], [0.1, 0.2, 0.3]).monotone, false, 'the literal rule is the default');
  assert.equal(slider([0.95, 0.96, 0.956], [0.1, 0.2, 0.3], { monotoneTolP: 0.03 }).calibrated, true, 'a 0.03 tolerance, as a sensitivity, absorbs it');
  assert.equal(slider([0.95, 0.96, 0.956], [0.1, 0.2, 0.3], { monotoneTolP: 0 }).monotone, false, 'the literal rule');
  assert.equal(slider([0.95, 0.96, 0.92], [0.1, 0.2, 0.3]).monotone, false);
  assert.equal(slider([0.9, 0.95, 0.97], [0.1, 0.3, 0.2]).monotone, false, 'dollars are strict');
  // G1 with 4 TRAIN clusters cannot continue or refute on the exact test; with 7 clusters and planted headroom it continues.
  assert.equal(R.g1.verdict, 'OWNER-DECIDES'); assert.match(R.g1.note, /1\/16/);
  const W7 = plantedWorld({ train: 7, heldout: 2, seed: 8 }), T7 = withCascades(W7.rows, W7.builds), L7 = needLabels(T7, { cells: GRID, reps: 0 });
  assert.equal(gateG1(L7, T7.jobs.filter(j => W7.meta[j].split === 'train'), j => W7.meta[j].cluster).verdict, 'CONTINUE');
  // A world where one mode is best on every job, without noise, has no headroom at all: the premise is refuted. (With noisy
  // outcomes it cannot be: at V = $10 the second bar, 20% of the SBS cost in success-equivalents, is about 0.0004.)
  const FLAT = Object.fromEntries(Object.entries(SMALL).map(([m, t]) => [m, { ...t, p: 1, q: 0 }]));
  const flat = syntheticWorld({ seed: 2, clusters: Array.from({ length: 7 }, (_, i) => ({ id: `F${i}`, split: 'train', jobs: 2 })), features, truth: () => FLAT });
  const TF = withCascades(flat.rows, flat.builds), LF = needLabels(TF, { cells: GRID, reps: 0 });
  assert.equal(gateG1(LF, TF.jobs, j => flat.meta[j].cluster).verdict, 'REFUTED-PREMISE');
});

test('L8: NR-knn whose neighbours all come from one TRAIN cluster is demoted to the family-majority baseline', () => {
  const fake = { k: 3, neighbours: () => ['W', 'W', 'W'] };
  const views = ['a', 'b', 'c', 'd', 'e'].map(job => ({ job, view: publicView(job, { features: {} }, ['direct-H']) }));
  assert.equal(nearestClusterTest(fake, views).demote, true);
  assert.equal(nearestClusterTest({ k: 3, neighbours: v => (v.id < 'm' ? ['W', 'K', 'W'] : ['W', 'W', 'W']) }, views).singleClusterShare < 0.8, true);
  assert.ok(R.leaks.L8.assessed && typeof R.leaks.L8.singleClusterShare === 'number');
});

test('the CLI: --commit-decisions seals TRAIN-only decisions, --split heldout verifies them, reports are byte-identical on rerun, --power runs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nr-cli-'));
  const labels = path.join(root, 'runs'), cli = path.join(here, '..', 'evaluate.mjs');
  const small = plantedWorld({ train: 4, heldout: 6, seed: 12 });
  for (const [stage, split] of [['nl1', 'train'], ['nl2', 'heldout']]) {
    const dir = path.join(labels, stage); mkdirSync(dir, { recursive: true });
    const jobs = Object.keys(small.meta).filter(j => small.meta[j].split === split);
    writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(Object.fromEntries(jobs.map(j => [j, small.meta[j]]))));
    writeFileSync(path.join(dir, 'matrix.jsonl'), small.rows.filter(r => jobs.includes(r.job)).map(r => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(path.join(dir, 'builds.jsonl'), small.builds.filter(b => jobs.includes(b.job)).map(b => JSON.stringify(b)).join('\n') + '\n');
    if (split === 'heldout') writeFileSync(path.join(dir, 'decisions.jsonl'), judgeAlwaysAgent(small.meta).map(d => JSON.stringify(d)).join('\n') + '\n');
  }
  const L = loadLabels(labels, { trainOnly: true });
  assert.equal(L.rows.every(r => small.meta[r.job].split === 'train'), true); assert.equal(L.skipped.stages.length, 1);
  const env = path.join(root, 'envelope', 'decisions.json');
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 120000 });
  const c = run(['--labels', labels, '--commit-decisions', env, '--reps', '150']);
  assert.equal(c.status, 0, c.stderr); assert.match(c.stdout, /sealed \d+ decisions .* skipped 1 stage/);
  assert.ok(existsSync(`${env}.sha256`));
  assert.equal(run(['--labels', labels, '--commit-decisions', env]).status, 3, 'a sealed envelope is never overwritten');
  const args = out => ['--labels', labels, '--split', 'heldout', '--decisions', env, '--report', out, '--reps', '150', '--boot', '300', '--perms', '20'];
  const a = run(args(path.join(root, 'a'))), b = run(args(path.join(root, 'b')));
  assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
  assert.equal(readFileSync(path.join(root, 'a', 'report.json'), 'utf8'), readFileSync(path.join(root, 'b', 'report.json'), 'utf8'));
  assert.equal(readFileSync(path.join(root, 'a', 'report.txt'), 'utf8'), readFileSync(path.join(root, 'b', 'report.txt'), 'utf8'));
  const rep = JSON.parse(readFileSync(path.join(root, 'a', 'report.json'), 'utf8'));
  assert.equal(rep.leaks.L6.ok, true, JSON.stringify(rep.leaks.L6)); assert.equal(rep.split, 'heldout');
  const dev = run(['--labels', labels, '--split', 'train', '--reps', '150', '--boot', '0', '--perms', '0']);
  assert.equal(dev.status, 0, dev.stderr); assert.match(dev.stdout, /development \(leave-one-cluster-out on TRAIN\)/);
  const pw = run(['--power', '--sims', '200']);
  assert.equal(pw.status, 0, pw.stderr); assert.match(pw.stdout, /clusters 5 {2}Δ 0\.00 {2}P\(SUPPORTED-Δ\) 0\.000/);
});

test('the loader reads label-run --out names (rows.jsonl, builds.final.jsonl over the builds.jsonl log)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-load-'));
  const small = plantedWorld({ train: 2, heldout: 0, jobs: 1, seed: 4 });
  writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(small.meta));
  writeFileSync(path.join(dir, 'rows.jsonl'), small.rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'builds.jsonl'), [...small.builds, { ...small.builds[0], usd: 99 }].map(b => JSON.stringify(b)).join('\n') + '\n');
  writeFileSync(path.join(dir, 'builds.final.jsonl'), small.builds.map(b => JSON.stringify(b)).join('\n') + '\n');
  const L = loadLabels(dir);
  assert.equal(L.rows.length, small.rows.length); assert.equal(L.builds.length, small.builds.length);
  assert.doesNotThrow(() => withCascades(L.rows, L.builds));
});

test('development split: leave-one-cluster-out fits each fold on the other TRAIN clusters only', () => {
  const D = evaluate({ ...W, split: 'train', ...FAST, leak: false });
  assert.equal(D.folds.length, 4); assert.ok(D.folds.every(f => f.train === 9 && f.eval === 3));
  assert.equal(D.fittedRule.length, 4);
  assert.match(D.grade, /development/);
  // A policy fitted inside a fold never sees that fold's jobs.
  const sawIds = [];
  const spy = { name: 'spy', role: 'baseline', fit: ctx => { sawIds.push(new Set(ctx.train.map(it => it.view.id))); return view => { assert.ok(!sawIds[sawIds.length - 1].has(view.id)); return { mode: view.modes[0] }; }; } };
  evaluate({ ...W, split: 'train', ...FAST, leak: false, policies: [...defaultPolicies(), spy] });
  assert.equal(sawIds.length, 4);
});

test('the fitted rule prefers fewer workflow calls on ties and never fits on unconfident labels', () => {
  const T = withCascades(W.rows, W.builds), L = needLabels(T, { cells: GRID, reps: 200 });
  const train = T.jobs.filter(j => W.meta[j].split === 'train'), ctx = makeContext(L, train, W.meta, { modes: T.modes.filter(m => !m.startsWith('build')) });
  const r = fitRule(ctx, ['logInputTokens', 'maxListLength']);
  assert.equal(r.trainBalancedAccuracy, 1); assert.equal(r.confident, train.filter(j => L.at(j, N1).confident).length);
  // Only one class among confident labels: the rule never calls a workflow (θ = +∞).
  const onlySmall = makeContext(L, train.filter(j => !needsWorkflow(W.meta[j].features)), W.meta, { modes: ctx.modes });
  assert.deepEqual(Object.values(fitRule(onlySmall, ['logInputTokens', 'maxListLength']).thresholds), [Infinity, Infinity]);
  assert.ok(BIG && nrStatic().fit);
});
