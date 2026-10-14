import test from 'node:test';
import assert from 'node:assert/strict';
import { labelTable, cellUtility, utilities, singleBest, score, bootstrap, labelConfidence, sliderSweep, calibration, baselines, leakTest, rng } from '../metrics.mjs';

// Three families x three modes, 10 paired tasks each. Hand-set so the answers are known:
//   oneoff:  direct 9/10 at $0.01, agent 10/10 at $0.20, construct 10/10 at $0.02 + $5 build   -> direct (or agent at high V)
//   records: direct 2/10 at $0.01, agent 7/10 at $0.30,  construct 10/10 at $0.02 + $1 build   -> construct
//   saga:    direct 0/10,          agent 4/10 at $0.50,  construct 9/10 at $0.05 + $2 build    -> construct
function rows() {
  const out = [];
  const add = (family, mode, k, cost) => { for (let i = 0; i < 10; i++) out.push({ family, mode, task: `t${i}`, success: i < k, costUsd: cost }); };
  add('oneoff', 'direct', 9, 0.01); add('oneoff', 'agent', 10, 0.2); add('oneoff', 'construct', 10, 0.02);
  add('records', 'direct', 2, 0.01); add('records', 'agent', 7, 0.3); add('records', 'construct', 10, 0.02);
  add('saga', 'direct', 0, 0.01); add('saga', 'agent', 4, 0.5); add('saga', 'construct', 9, 0.05);
  return out;
}
const fixed = [{ family: 'oneoff', mode: 'construct', fixedUsd: 5 }, { family: 'records', mode: 'construct', fixedUsd: 1 }, { family: 'saga', mode: 'construct', fixedUsd: 2 }];
const T = labelTable(rows(), fixed);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('utility = H * (V * p - mean cost) - fixed cost, paired task ids', () => {
  close(cellUtility(T.cell('records', 'construct'), T.taskIds('records'), 1), 10 * (1 - 0.02) - 1);
  close(cellUtility(T.cell('oneoff', 'direct'), T.taskIds('oneoff'), 1), 10 * (0.9 - 0.01));
  // A longer horizon amortises the build: construct wins one-off only when the family recurs enough.
  const short = utilities(T, 1).get('oneoff'), long = utilities(T, 1, { horizon: 1000 }).get('oneoff');
  assert.equal([...short].sort((a, b) => b[1] - a[1])[0][0], 'direct');
  assert.equal([...long].sort((a, b) => b[1] - a[1])[0][0], 'construct');
});

test('labels must be paired and complete; bad rows throw instead of being dropped', () => {
  assert.throws(() => labelTable([...rows(), { family: 'saga', mode: 'agent', task: 't0', success: true, costUsd: 1 }]), /duplicate/);
  assert.throws(() => labelTable(rows().filter(r => !(r.family === 'saga' && r.mode === 'agent' && r.task === 't3'))), /unpaired/);
  assert.throws(() => labelTable(rows().filter(r => !(r.family === 'saga' && r.mode === 'agent'))), /lacks a mode/);
  assert.throws(() => labelTable([{ family: 'a', mode: 'm', task: 't', success: 1, costUsd: 0 }]), /bad label/);
  assert.throws(() => labelTable(rows(), [{ family: 'nope', mode: 'direct', fixedUsd: 1 }]), /unlabelled/);
});

test('VBS, SBS, regret and closed gap on a known table', () => {
  const U = utilities(T, 1);
  assert.equal(singleBest(U), 'construct');
  const oracle = (f, V) => [...utilities(T, V).get(f)].sort((a, b) => b[1] - a[1])[0][0];
  const s = score(U, oracle, 1);
  close(s.regret, 0); close(s.closedGap, 1); assert.equal(s.accuracy, 1);
  const sbs = score(U, () => 'construct', 1);
  close(sbs.closedGap, 0);
  // oneoff: direct 8.9 vs construct 4.8 -> headroom 4.1; a router that gets oneoff right and nothing else wrong closes it.
  close(s.headroom, (10 * 0.89) - (10 * 0.98 - 5));
  const bad = score(U, () => 'direct', 1);
  assert.ok(bad.closedGap < 0, 'always-direct is worse than the SBS');
  // The SBS chosen on training families is used when given, and flagged.
  const t = score(U, oracle, 1, { sbsMode: 'agent' });
  assert.equal(t.sbsFromTraining, true); assert.equal(t.sbsMode, 'agent'); assert.equal(t.sbsInSample, 'construct');
});

test('no headroom: the closed gap is undefined, not 0 or 1', () => {
  const r = rows().filter(x => x.family !== 'oneoff');
  const s = score(utilities(labelTable(r, fixed.slice(1)), 1), () => 'construct', 1);
  assert.equal(s.closedGap, null);
  close(s.headroom, 0);
});

test('routing cost is charged to the router', () => {
  const U = utilities(T, 1);
  const s = score(U, () => 'construct', 1, { routingCostUsd: () => 0.5 });
  close(s.router, s.sbs - 1.5);
});

test('the bootstrap is deterministic, brackets the point estimate, and needs many families to exclude zero', () => {
  const oracle = (f, V) => [...utilities(T, V).get(f)].sort((a, b) => b[1] - a[1])[0][0];
  const a = bootstrap(T, oracle, 1, { reps: 400, seed: 11 });
  const b = bootstrap(T, oracle, 1, { reps: 400, seed: 11 });
  assert.deepEqual(a.ci, b.ci);
  assert.ok(a.ci.router.lo <= a.point.router && a.point.router <= a.ci.router.hi);
  // Always-direct is the oracle on one family in three: with 3 families a resample of only that family is likely enough
  // (1/27) that the 95% regret interval reaches 0. With the same mix over 30 families it no longer does.
  const d = bootstrap(T, () => 'direct', 1, { reps: 400, seed: 11 });
  assert.ok(d.ci.regret.lo >= 0 && d.ci.regret.hi > 0);
  const many = labelTable(Array.from({ length: 10 }, (_, k) => rows().map(r => ({ ...r, family: `${r.family}-${k}` }))).flat(),
    Array.from({ length: 10 }, (_, k) => fixed.map(x => ({ ...x, family: `${x.family}-${k}` }))).flat());
  assert.ok(bootstrap(many, () => 'direct', 1, { reps: 400, seed: 11 }).ci.regret.lo > 0);
});

test('label confidence flags families whose best mode is uncertain', () => {
  // records at V=1: construct 8.8 vs agent 4 and direct 1.9 -> confident. A near-tie family is not.
  const near = [];
  for (let i = 0; i < 6; i++) { near.push({ family: 'tie', mode: 'a', task: `t${i}`, success: i % 2 === 0, costUsd: 0.1 }); near.push({ family: 'tie', mode: 'b', task: `t${i}`, success: i % 3 !== 0, costUsd: 0.12 }); }
  const L = labelConfidence(labelTable(near), 1, { reps: 500 });
  assert.equal(L[0].confident, false);
  assert.deepEqual([...L[0].acceptable].sort(), ['a', 'b']);
  const L2 = labelConfidence(T, 1, { reps: 300 });
  assert.equal(L2.find(x => x.family === 'records').confident, true);
  assert.equal(L2.find(x => x.family === 'records').top, 'construct');
});

test('slider sweep: an oracle router moves to more reliable modes as V rises; a perverse one is flagged', () => {
  const oracle = (f, V) => [...utilities(T, V).get(f)].sort((a, b) => b[1] - a[1])[0][0];
  const sw = sliderSweep(T, oracle, [0.05, 0.5, 1, 5, 50]);
  assert.equal(sw.rows.length, 5);
  assert.deepEqual(sw.violations, []);
  for (const r of sw.rows) close(r.regret, 0);
  const perverse = (f, V) => (V > 1 ? 'direct' : 'construct');
  assert.ok(sliderSweep(T, perverse, [0.5, 5]).violations.length >= 2);
});

test('calibration: perfect predictions score Brier = Bernoulli variance and zero cost error', () => {
  const truth = (f, m) => { const c = T.cell(f, m); const v = [...c.tasks.values()]; return { p: v.filter(x => x.success).length / v.length, costUsd: v.reduce((s, x) => s + x.costUsd, 0) / v.length }; };
  const c = calibration(T, truth);
  close(c.costLogErr, 0);
  const worse = calibration(T, (f, m) => ({ p: 0.5, costUsd: truth(f, m).costUsd * 2 }));
  assert.ok(worse.brier > c.brier);
  close(worse.costLogErr, Math.log(2));
});

test('baselines are label-free and deterministic; the random router is reproducible', () => {
  const B = baselines(T.modes);
  assert.deepEqual(Object.keys(B).sort(), ['always-agent', 'always-construct', 'always-direct', 'random']);
  assert.equal(B.random('saga', 1), B.random('saga', 1));
  const picks = new Set(['oneoff', 'records', 'saga', 'x', 'y', 'z', 'w'].map(f => B.random(f, 1)));
  assert.ok(picks.size >= 2);
});

test('leak test: a feature-only router passes; a router that peeks at labels is caught', () => {
  const features = { oneoff: { volume: 1 }, records: { volume: 500 }, saga: { volume: 200 } };
  const clean = () => (f) => (features[f].volume > 50 ? 'construct' : 'direct');
  assert.equal(leakTest(T, clean, [1, 5]).ok, true);
  const peek = table => (f, V) => [...utilities(table, V).get(f)].sort((a, b) => b[1] - a[1])[0][0];
  const r = leakTest(T, peek, [1, 5]);
  assert.equal(r.ok, false);
  assert.ok(r.diffs.length > 0);
});

test('rng is deterministic and roughly uniform', () => {
  const r = rng(5), xs = Array.from({ length: 5000 }, r);
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(m - 0.5) < 0.02);
  assert.equal(rng(5)(), xs[0]);
});
