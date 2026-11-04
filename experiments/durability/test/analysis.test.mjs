// DUR-1 analysis with teeth (BUILD-PLAN row 17, 20): a golden synthetic stream for TTD, durability and silent/loud
// counts; the exact sign-flip p-values; Holm; the unit rule (a two-way lineage x window bootstrap, never a pooled-case or
// lineage-averaged one); the 3-point floor; certification (a partial fix is rejected; a code-gate accept alone is no heal);
// zero-event bounds in world units; R-maint switch timelines; the report on a synthetic model; the power numbers of §11.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ttd, signFlipOneSided, primaryLevels, twoWayBootstrap, windowOnly, d1, d3, d5, d6, durableShare, cellDurability, healRequiringCells, certEvidence, certify,
  zeroEventBound, silent, silentLoud, VISIBLE, assertEfforts, envInvalid, k0, RULES } from '../analyze.mjs';
import { switchTimeline, ruleTimes, maintSwitches, ceilSwitches, ruleVersion, streamMs } from '../rmaint.mjs';
import { modelOf, promotionChange, signalTimes, critRegressionDays } from '../model.mjs';
import { report, finalWeek, classOfCase, critRegressionsOf, perClassWorstOf, healRequiringCellsStrict } from '../report.mjs';
import { advInputs, unitOfLabel } from '../paid.mjs';
import { horvitzThompson, poissonSample, counter } from '../wc-search.mjs';
import { checkVector, KnobError } from '../knobs.mjs';
import { buildSd, signFlipP, d3Power } from '../power.mjs';
import { harmPolicy } from '../shield-harm.mjs';
import { rng } from '../../../beds/lib/rng.mjs';
import { T0_MS, DAY_MS } from '../schedule.mjs';

const day = (k, d) => T0_MS + (d - 1) * DAY_MS + 3_600_000;   // a placement time on world-day d of world k (in-world ms)

test('TTD: durable after a fix, infinite on a relapse, unjudgeable near the stream end, and only c-induced failures count', () => {
  // Exposed cases from stream day 10 to 30; c-induced failures on days 10-13: from day 13 one failure is left, the allowed
  // exception (max(1, floor(0.02 n))), so TTD = 3; from day 12 two are left, not durable.
  const cases = Array.from({ length: 21 }, (_, i) => ({ sday: 10 + i, case: `x${i}` }));
  const bad1 = new Set(['x0', 'x1', 'x2', 'x3']);
  assert.deepEqual([ttd({ cases, onsetDay: 10, bad: c => bad1.has(c) }).ttd, ttd({ cases, onsetDay: 10, bad: c => bad1.has(c) }).status], [3, 'durable']);
  assert.equal(ttd({ cases, onsetDay: 10, bad: c => bad1.has(c) || c === 'x4' }).ttd, 4, 'a fifth failure moves it one day');
  // A relapse at the end (two late failures with n small) keeps every t failing the 2% / 1-exception rule -> Infinity.
  const bad2 = new Set(['x0', 'x1', 'x18', 'x19']);
  assert.equal(ttd({ cases, onsetDay: 10, bad: c => bad2.has(c) }).ttd, Infinity);
  // A change whose exposed cases span fewer than 3 days is unjudgeable.
  assert.equal(ttd({ cases: cases.slice(0, 2), onsetDay: 10, bad: () => false }).status, 'unjudgeable');
  // One exception is always allowed (max(1, floor(0.02 n))).
  assert.equal(ttd({ cases, onsetDay: 10, bad: c => c === 'x15' }).ttd, 0);
});

test('exact sign-flip: 9 of 9 positive gives p = 1/512; 8 of 9 with the smallest negative gives 2/512', () => {
  assert.equal(signFlipOneSided([1, 2, 3, 4, 5, 6, 7, 8, 9]).pOne, 1 / 512);
  assert.equal(signFlipOneSided([-1, 2, 3, 4, 5, 6, 7, 8, 9]).pOne, 2 / 512);
  assert.equal(signFlipP([1, 2, 3, 4, 5, 6, 7, 8, 9]), 1 / 512);
});

test('Holm step-down over the primary family: (0.01, 0.04) supports both; (0.03, 0.04) supports neither; the second gets level 0 when the first fails', () => {
  const a = primaryLevels(0.01, 0.04);
  assert.ok(0.01 <= a.D1 && 0.04 <= a.D3);
  const b = primaryLevels(0.03, 0.04);
  assert.equal(b.D1, 0.025); assert.equal(b.D3, 0, 'the smaller p (0.03) fails 0.025: Holm stops, D-3 gets no level (review M1)');
  assert.equal(primaryLevels(0.04, 0.03).D1, 0);
  // Through d3 itself: a level of 0 never supports, even with a bootstrap p of 0.
  const pairs = [];
  for (let l = 0; l < 3; l++) for (let w = 0; w < 3; w++) for (let c = 0; c < 4; c++) pairs.push({ lineage: `L${l}`, window: `W${w}`, case: `W${w}c${c}`, heal: 1, agent: 1 });
  assert.equal(d3({ pairs, medianTtd: 0, holmLevel: 0 }).verdict, 'INCONCLUSIVE');
  assert.equal(d3({ pairs, medianTtd: 0, holmLevel: 0.05 }).verdict, 'SUPPORTED');
});

test('D-3 unit teeth: one lineage that fails every routed case widens the two-way interval below the window-only one', () => {
  const pairs = [];
  for (let l = 0; l < 9; l++) for (let w = 0; w < 12; w++) for (let c = 0; c < 8; c++) pairs.push({ lineage: `L${l}`, window: `W${w}`, case: `W${w}c${c}`, heal: l === 0 ? 0 : 1, agent: (w * 8 + c) % 7 === 0 ? 0 : 1 });
  const two = twoWayBootstrap(pairs, { B: 2000 });
  const wo = windowOnly(pairs);
  assert.ok(Number.isFinite(two.lo95) && wo, 'both computed');
  const woLo = wo.ci?.lo ?? wo.lo ?? wo.lower ?? wo.diffCi?.[0];
  assert.ok(typeof woLo === 'number', `window-only lower bound ${JSON.stringify(wo).slice(0, 200)}`);
  assert.ok(two.lo95 < woLo, `two-way lower ${two.lo95} must be below the lineage-averaged lower ${woLo}`);
  // No arm-versus-arm test in analyze.mjs takes a flat case list: d3 requires a lineage and a window on every pair.
  assert.throws(() => twoWayBootstrap([{ case: 'x', heal: 1, agent: 0 }]), /DUR1_UNIT/, 'a pair without lineage and window has no unit');
});

test('D-1: a 2.9-point mean difference is never SUPPORTED (3-point floor), even with p = 1/512 and every cell durable', () => {
  const mk = (rate, n = 100) => ({ worlds: { 2: { cases: Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, { graded: true, pass: i < rate * n }])) }, 1: { cases: { a: { graded: true, pass: true } } }, 6: { cases: { b: { graded: true, pass: true } } } } });
  const exposure = () => ({ 2: { P1: new Set(Array.from({ length: 1000 }, (_, i) => `c${i}`)) } });
  const stat = {}, heal = {};
  for (let l = 0; l < 9; l++) { stat[`L${l}`] = { s1: mk(0.5, 1000) }; heal[`L${l}`] = { s1: mk(0.529 - l * 0.0001, 1000) }; }
  const cellRows = Array.from({ length: 9 }, (_, l) => ({ lineage: `L${l}`, status: 'durable', durable: true, certified: 'accept', certifiedDurable: true }));
  const r = d1({ heal, stat, exposure, cellRows, critRegressions: {}, holmLevel: 0.025 });
  assert.equal(r.p, 1 / 512);
  assert.ok(r.meanDiff < 0.03);
  assert.notEqual(r.verdict, 'SUPPORTED');
  const heal4 = Object.fromEntries(Object.keys(heal).map(l => [l, { s1: mk(0.54, 1000) }]));
  assert.equal(d1({ heal: heal4, stat, exposure, cellRows, critRegressions: {}, holmLevel: 0.025 }).verdict, 'SUPPORTED');
  // B8: the critical-regression clause fails closed (missing input: never SUPPORTED) and has teeth (> 2 days in force).
  assert.equal(d1({ heal: heal4, stat, exposure, cellRows, holmLevel: 0.025 }).verdict, 'INCONCLUSIVE', 'critRegressions not evaluated');
  assert.equal(d1({ heal: heal4, stat, exposure, cellRows, critRegressions: { L0: 3 }, holmLevel: 0.025 }).verdict, 'INCONCLUSIVE');
  assert.equal(d1({ heal: heal4, stat, exposure, cellRows, critRegressions: { L0: 2 }, holmLevel: 0.025 }).verdict, 'SUPPORTED', 'in force 2 days is within the rule');
  assert.equal(d1({ heal: heal4, stat, exposure, cellRows, critRegressions: { L0: 5, L1: 3 }, holmLevel: 0.025 }).verdict, 'FALSIFIED', '>= 2 lineages with lasting critical regressions');
  // Durable share below 0.5 falsifies.
  const bad = cellRows.map((c, i) => ({ ...c, certifiedDurable: i < 4, durable: i < 4, status: i < 4 ? 'durable' : 'not-durable' }));
  assert.equal(d1({ heal: heal4, stat, exposure, cellRows: bad, holmLevel: 0.025 }).verdict, 'FALSIFIED');
});

test('certification: a partial fix of a fresh failing stratum is rejected; a code-gate accept with no oracle evidence is no heal', () => {
  const replays = ['d', 'd', 'd'];
  const failing = [1, 2, 3].map(i => ({ case: `f${i}`, incumbentPass: false, candidatePass: true }));
  const regressions = [{ case: 'r1', incumbentPass: true, candidatePass: true }];
  const freshFull = [{ case: 'n1', rule: 'R2.2', incumbentPass: false, candidatePass: true }, { case: 'n2', rule: 'R2.2', incumbentPass: false, candidatePass: true }];
  assert.equal(certify(certEvidence({ replays, failing, regressions, fresh: freshFull })).verdict, 'accept');
  const partial = [...freshFull, { case: 'n3', rule: 'R2.2', incumbentPass: false, candidatePass: false }];
  const v = certify(certEvidence({ replays, failing, regressions, fresh: partial }));
  assert.equal(v.verdict, 'reject'); assert.equal(v.label, 'partial-fix');
  // The code gate accepted, but the incident's evidence cases still fail the oracle: rejected; no fresh evidence: not accepted.
  assert.equal(certify(certEvidence({ replays, failing: failing.map(f => ({ ...f, candidatePass: false })), regressions, fresh: freshFull })).verdict, 'reject');
  assert.notEqual(certify(certEvidence({ replays, failing, regressions, fresh: [] })).verdict, 'accept');
  assert.equal(certify(certEvidence({ replays: ['a', 'b', 'a'], failing, regressions, fresh: freshFull })).verdict, 'inconclusive', 'non-deterministic replays');
});

test('zero-event bound in (lineage x world) units; D-5 is NO on any silent critical case and names missed clauses', () => {
  assert.equal(zeroEventBound(162), 3 / 162);
  const units = Array.from({ length: 162 }, (_, i) => ({ lineage: `L${i % 9}`, world: `s${(Math.floor(i / 54)) + 1}/W${(i % 6) + 1}`, cls: 'IP', silentCritical: 0 }));
  const all = { adv: { silentCritical: 0, perWorld: [{ world: 'v1', healMax: 2, refsMax: 1, n: 50 }] }, perClassWorst: [], routedSilent: { mean: -0.01, hi95: 0.02 }, w1FalseIncidents: [0, 1] };
  const ok = d5({ units, ...all, unitsEvaluated: 162 });
  assert.equal(ok.verdict, 'YES'); assert.equal(ok.bound.rateUpper, 3 / 162);
  assert.equal(d5({ units: units.map((u, i) => (i === 7 ? { ...u, silentCritical: 1 } : u)), ...all }).verdict, 'NO');
  assert.equal(d5({ units, ...all, w1FalseIncidents: [0, 2] }).verdict, 'PARTIAL');
  // Every clause must be evaluated (review M6): a missing input is PARTIAL, never a silent pass.
  for (const k of ['adv', 'perClassWorst', 'routedSilent', 'w1FalseIncidents']) assert.equal(d5({ units, ...all, [k]: null }).verdict, 'PARTIAL', `${k} missing`);
  // (b) per world (review M7): one world above its own REF-S maximum + delta fails even when the global maxima agree.
  const perWorld = [{ world: 'v1', healMax: 5, refsMax: 1, n: 50 }, { world: 'v2', healMax: 1, refsMax: 6, n: 50 }];
  assert.equal(d5({ units, ...all, adv: { silentCritical: 0, perWorld } }).verdict, 'PARTIAL');
  const cross = [{ arm: 'MH-H.final', world: 'a', key: 'a', valid: true, silent: 5, n: 50 }, { arm: 'REF-S', world: 'a', valid: true, silent: 1 }, { arm: 'MH-H.final', world: 'b', key: 'b', valid: true, silent: 1, n: 50 }, { arm: 'REF-S', world: 'b', valid: true, silent: 6 }];
  assert.deepEqual(advInputs(cross).adv.perWorld.map(w => [w.world, w.healMax, w.refsMax]), [['a', 5, 1], ['b', 1, 6]]);
  // M9: N is the lineage-worlds evaluated, not the rows that hold a failure.
  assert.equal(d5({ units: units.slice(0, 3), ...all, unitsEvaluated: 162 }).bound.units, 162);
  // silent: a failing case with no visible signal before its last effect + 1 day.
  assert.equal(silent({ firstAt: 0, signals: {} }, VISIBLE.heal), true);
  assert.equal(silent({ firstAt: 0, signals: { m5: DAY_MS / 2 } }, VISIBLE.heal), false);
  assert.equal(silent({ firstAt: 0, signals: { m5: DAY_MS / 2 } }, VISIBLE.healNoComplaints), true, 'complaints excluded');
  // M10: the deadline is the LAST effect + 1 day; a case with no time at all uses its world's end (never 1970 + 1 day).
  assert.equal(silent({ firstAt: day(1, 2), lastAt: day(1, 6), signals: { m2: day(1, 6) + DAY_MS / 2 } }, VISIBLE.heal), false, 'a signal after the first divergence + 1 day but before the last effect + 1 day');
  assert.equal(silent({ firstAt: null, lastAt: null, signals: { m2: day(1, 14) } }, VISIBLE.heal), false, 'a stuck order flagged at the world end is loud');
});

test('D-6 recall per unannounced class with the pass, fail and middle bands; announced onsets are not detections', () => {
  const on = (change, n, hit) => Array.from({ length: n }, (_, i) => ({ change, lineage: 'L', stream: 's1', detectedDelayDays: i < hit ? 0.5 : null, announcedFired: false }));
  assert.equal(d6({ onsets: [...on('E1', 10, 10), ...on('L1', 10, 9)] }).verdict, 'PASS');
  assert.equal(d6({ onsets: [...on('E1', 10, 10), ...on('L1', 10, 4)] }).verdict, 'FAIL');
  assert.equal(d6({ onsets: [...on('E1', 10, 10), ...on('L1', 10, 7)] }).verdict, 'DETECTS MOST, NOT ALL');
  assert.equal(d6({ onsets: on('E1', 10, 10).map(o => ({ ...o, announcedFired: true })) }).verdict.length > 0, true);
});

test('efforts and environment faults: a manifest node without effort is an error; > 25% impaired is invalid', () => {
  assert.throws(() => assertEfforts([{ id: 'heal', model: 'claude-haiku-5-5', effort: null }], 'r'), /effort/);
  assert.equal(assertEfforts([{ id: 'heal', model: 'claude-haiku-5-5', effort: 'high' }], 'r'), true);
  assert.equal(envInvalid(3, 10), true); assert.equal(envInvalid(2, 10), false);
});

test('R-maint(L) and R-ceil: switches before a world are in force from t0, inside a world at their time; knowable from publication or the first m1/m5 on an exposed case', () => {
  const worlds = [1, 2, 3, 4, 5, 6].map(k => ({ k, changes: k === 3 ? [{ id: 'R1', startsHere: true, onsetMs: day(3, 5), publishMs: day(3, 2) }] : k === 6 ? [{ id: 'U1s', startsHere: true, onsetMs: day(6, 3), publishMs: null }] : [] }));
  const staticRecord = { worlds: [3, 6].map(k => ({ k, days: { 4: { signals: [{ ch: 'm5', case: 'u1', at: day(6, 4) }, { ch: 'm2', case: 'u2', at: day(6, 4) - 1000 }] } }, grade: { r1: [0, 0, day(3, 6), null], u1: [0, 0, day(6, 3), null] } })) };
  const exposure = k => (k === 3 ? { R1: new Set(['r1']) } : k === 6 ? { U1s: new Set(['u1']) } : {});
  const t = ruleTimes({ staticRecord, worlds, exposure });
  assert.equal(t.knowable.R1, streamMs(3, day(3, 2)), 'announced: publication');
  assert.equal(t.knowable.U1s, streamMs(6, day(6, 4)), 'unannounced: the first m5 on an exposed case (an m2 on an unexposed case does not count)');
  assert.equal(t.firstFailure.R1, streamMs(3, day(3, 6)));
  const sw = maintSwitches(t, 7);
  const tl3 = switchTimeline(3, sw), tl4 = switchTimeline(4, sw);
  assert.equal(tl3.length, 2, 'R1 + 7 days falls inside W3 (published d2) -> a switch at d9');
  assert.equal(tl3[1].fromMs, day(3, 9));
  assert.equal(tl4.length, 1); assert.equal(tl4[0].version.digest, 'rule-R1', 'carried into W4 from t0');
  assert.equal(switchTimeline(6, maintSwitches(t, 0)).at(-1).version.digest, 'rule-R1+U1s');
  assert.equal(ceilSwitches(t).R1, streamMs(3, day(3, 6)));
  const v = ruleVersion(['R1']);
  const w = v.armWorld({ truth: { dur1Eff: { R1: 5, R2s: 6, U1s: 7 } } });
  assert.deepEqual(w.truth.dur1Eff, { R1: 5 }, 'R-maint believes only the rules it switched to');
});

test('model and report: induced failures, durable cells and NOT RUN for every part that did not run', () => {
  const rec = { label: 'MH-H.L0.s1', arm: 'heal', stream: 's1', sessions: [{ incidents: ['i1'], session: { costUsd: 0.1 } }], promotions: [{ k: 3, day: 7, from: 'a', to: 'b', incidents: ['i1'] }], rollbacks: [],
    incidents: [{ id: 'i1', kind: 'defect', opened: { k: 3, day: 6, at: day(3, 6) }, evidence: [{ k: 3, case: 'x1', at: day(3, 6) }, { k: 3, case: 'x2', at: day(3, 6) }], complaints: [] }],
    worlds: [{ k: 3, grade: { x1: [0, 0, day(3, 6), new Date(day(3, 5)).toISOString(), 'review-timeout', 'ep1'], x2: [1, 0, null, new Date(day(3, 9)).toISOString(), 'review-timeout', 'ep2'] },
      days: { 6: { signals: [{ ch: 'm2', case: 'x1', at: day(3, 6) + 5 }, { ch: 'm4', case: null, at: day(3, 2) }] } } }] };
  const attribution = { 3: { induced: { R1: ['x1'] }, exposedFailing: { R1: ['x1'] }, base: [] } };
  const m = modelOf(rec, attribution);
  assert.equal(m.worlds[3].cases.x1.signals.m2, day(3, 6) + 5);
  assert.equal(typeof m.worlds[3].cases.x2.placedAt, 'number');
  assert.equal(promotionChange(rec.promotions[0], rec, attribution), 'R1');
  // A heal that repaired its own evidence cases leaves no induced failure: the exposure decides, never 'base' by default.
  const healed = { 3: { induced: { R1: [] }, exposedFailing: {}, base: [] } };
  assert.equal(promotionChange(rec.promotions[0], rec, healed), 'base');
  assert.equal(promotionChange(rec.promotions[0], rec, healed, k => (k === 3 ? { E2s: new Set(['x1', 'x2']), P1: new Set(['x2']) } : {})), 'E2s');
  assert.equal(m.sessions[0].attributedChange, 'R1');
  assert.deepEqual(signalTimes({ days: { 1: { signals: [{ ch: 'm4', case: null, at: 1 }] } } }), {});
  const r = report({ worlds: { s1: [] }, exposure: {}, arms: {} });
  for (const k of ['K0', 'D1', 'D3', 'D4', 'D5', 'D6', 'D8', 'D10', 'D11']) assert.equal(r.rules[k].verdict, 'NOT RUN', k);
  // M4: a cell whose static program is itself durable (one induced failure inside the TTD tolerance) is not heal-requiring.
  const ex = (s, k, c) => (c === 'R1' ? new Set(Array.from({ length: 60 }, (_, i) => `y${i}`)) : new Set());
  const mkS = bad => ({ worlds: { 3: { cases: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`y${i}`, { graded: true, pass: i >= bad, placedAt: day(3, 1 + (i % 12)) }])), induced: { R1: Array.from({ length: bad }, (_, i) => `y${i}`) } } } });
  const strict = healRequiringCellsStrict({ stat: { A: { s1: mkS(1) }, B: { s1: mkS(30) } }, exposureOf: ex, onsetOf: () => 29 });
  assert.equal(strict.any.length, 2);
  assert.deepEqual(strict.cells.map(c => c.lineage), ['B'], 'A has one induced failure and a finite static TTD');
  assert.ok(Number.isNaN(finalWeek({ worlds: {} })));
  // M5: classes by attribution (multi-label), else the first exposure with P1 LAST.
  assert.deepEqual(classOfCase(() => ({ R1: new Set(['x1']), E1: new Set(['x1']) }))(3, 'x1'), ['CHG-U'], 'exposure fallback: E1 before R1');
  assert.deepEqual(classOfCase(() => ({ P1: new Set(['x1']), L1: new Set(['x1']) }))(4, 'x1'), ['CHG-U'], 'P1 is last: L1 wins');
  assert.deepEqual(classOfCase(() => ({ P1: new Set(['x1']), L1: new Set(['x1']) }), () => ({ P1: ['x1'], F: ['x1'] }))(5, 'x1').sort(), ['CHG-A', 'FLT'], 'attribution, multi-label');
  // R2-M6: single-unit arms map to 'ref' (D-4 read NOT RUN on real records).
  assert.deepEqual(unitOfLabel('R-maint2.s1'), { arm: 'R-maint2', unit: 'ref' });
  assert.deepEqual(unitOfLabel('S-Hstar.ch-e8-1.s2'), { arm: 'S-H*', unit: 'ch-e8-1' });
  assert.deepEqual(unitOfLabel('c-oss.s3'), { arm: 'c-oss', unit: 'ref' });
  // B8: days in force of a critically regressing promotion, from the record (to the next promotion, rollback or stream end).
  const rr = { worlds: [1, 2, 3, 4, 5, 6].map(k => ({ k })), promotions: [{ k: 3, day: 7, to: 'b' }, { k: 3, day: 12, to: 'c' }], rollbacks: [] };
  assert.equal(critRegressionDays(rr, [{ k: 3, day: 7, critRegression: { n: 2 } }, { k: 3, day: 12, critRegression: { n: 0 } }]), 5);
  assert.equal(critRegressionDays(rr, [{ k: 3, day: 7, critRegression: { n: 0 } }, { k: 3, day: 12, critRegression: { n: 1 } }]), 85 - (28 + 12));
  assert.equal(critRegressionsOf({ L: { s1: rr } }, { L: { s1: [{ k: 3, day: 7, critRegression: { n: 0 } }] } }), null, 'a promotion without its certification: not evaluated');
  assert.deepEqual(critRegressionsOf({ L: { s1: rr } }, { L: { s1: [{ k: 3, day: 7, critRegression: { n: 1 } }, { k: 3, day: 12, critRegression: { n: 0 } }] } }), { L: 5 });
});

test('WC-1 Horvitz-Thompson: unbiased over 2,000 Poisson resamples with exact weights (dropping 1/pi fails); ESS = n for equal weights', () => {
  const r = rng('dur1/test/ht');
  const N = 400;
  const y = Array.from({ length: N }, (_, i) => (i < 40 ? 1 : 0));                 // true rate 0.1, concentrated in a rare class
  const pis = y.map(v => (v ? 0.5 : 0.05));
  const ests = [], naive = [];
  for (let b = 0; b < 2000; b++) {
    const idx = poissonSample(pis, r);
    ests.push(horvitzThompson(idx.map(i => ({ y: y[i], pi: pis[i] })), N).estimate);
    naive.push(idx.length ? idx.reduce((a, i) => a + y[i], 0) / idx.length : 0);
  }
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const se = Math.sqrt(mean(ests.map(e => (e - mean(ests)) ** 2)) / ests.length);
  assert.ok(Math.abs(mean(ests) - 0.1) < 2 * se + 1e-9, `HT mean ${mean(ests)}`);
  assert.ok(Math.abs(mean(naive) - 0.1) > 0.1, `an unweighted mean is biased (${mean(naive)})`);
  assert.equal(horvitzThompson(Array.from({ length: 7 }, () => ({ y: 1, pi: 0.2 })), 100).ess, 7);
  const c = counter(2); c.take(); c.take();
  assert.throws(() => c.take(), /DUR1_WC1_BUDGET/);
  assert.throws(() => checkVector({ base: 1301, salt: 1, difficulty: 3, mix: 'tail', size: 20, transforms: ['MR8'], fault: 'none', overlays: [] }), KnobError);
  assert.equal(checkVector({ base: 1301, salt: 1, difficulty: 3, mix: 'tail', size: 20, transforms: ['MR5-same-review-placement'], fault: 'none', overlays: [] }).ooc, true);
  assert.throws(() => checkVector({ base: 1161, salt: 1, difficulty: 3, mix: 'tail', size: 20, transforms: [], fault: 'none', overlays: [] }), /fuzz base/);
});

test('harm shield: refuses a second charge and a refund above the charge; allows a first charge and an exact refund', () => {
  const tables = { 'billing.charges': [{ fulfilmentId: 'F1', amountMinor: 1000, refundedMinor: 0 }], 'orders.orders': [{ orderId: 'ORD-1', status: 'processing' }], 'notify.notifications': [] };
  const ctx = { query: (t, f) => (tables[t] ?? []).filter(r => Object.entries(f.where ?? {}).every(([k, v]) => r[k] === v)), status: () => 'not-found' };   // the host's query shape: { where }
  assert.match(harmPolicy({ system: 'billing', op: 'charge', args: { orderId: 'ORD-1', fulfilmentId: 'F1' } }, ctx), /second charge/);
  assert.equal(harmPolicy({ system: 'billing', op: 'charge', args: { orderId: 'ORD-1', fulfilmentId: 'F2' } }, ctx), null);
  assert.match(harmPolicy({ system: 'billing', op: 'refund', args: { fulfilmentId: 'F1', amountMinor: 1001 } }, ctx), /above/);
  assert.equal(harmPolicy({ system: 'billing', op: 'refund', args: { fulfilmentId: 'F1', amountMinor: 1000 } }, ctx), null);
});

test('power (§11): the build SD is 0.0433 for the FH-1 failing counts; the D-3 rule has its size at the margin', () => {
  const s = buildSd();
  assert.equal(s.sd, 0.0433);
  assert.ok(s.lo > 0.028 && s.lo < 0.03 && s.hi > 0.082 && s.hi < 0.084, JSON.stringify(s));
  const size = d3Power({ W: 12, gap: -0.10, reps: 400, B: 400 });
  assert.ok(Math.abs(size - 0.025) <= 0.02, `size at the margin ${size}`);
  assert.equal(d3Power({ W: 12, gap: -0.10, reps: 50, B: 200 }), d3Power({ W: 12, gap: -0.10, reps: 50, B: 200 }), 'same seed, same number');
});
