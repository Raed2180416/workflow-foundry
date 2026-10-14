// cusum.mjs (ATTACK-20261014 §3 M9; PROOF-LEDGER K15) at $0: the pure functions (chart weight, chart, count rule,
// logistic fit, AUC, ARL simulation and calibration) against hand values and an exact Markov-chain ARL, then the analysis
// over the committed dev streams under research/jit-20261008/runs/ (260 rows): the as-run count rule replays to the rows'
// own stateAfter, the risk inputs never read the difficulty label, and the section rule's verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  raWeight, runCusum, countRule, logisticFit, predict, sigmoid, auc, mulberry32, makeProcess, simulateRecords, arlAt, calibrateH, calibrateFromSim,
  countRuleArl, featuresOf, eventOf, isMonitored, isFitRow, summarizeAlarms, decide, analyze, DESIGN, VARIANTS,
} from '../cusum.mjs';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''}: ${a} vs ${b}`);

test('RA-CUSUM weight (Steiner et al. 2000): hand values; R_A = 1 gives zero weight', () => {
  close(raWeight(1, 0.1, 2), Math.log(2) - Math.log(1.1), 1e-12, 'fail');
  close(raWeight(0, 0.1, 2), -Math.log(1.1), 1e-12, 'ok');
  assert.equal(raWeight(1, 0.3, 1), 0); assert.equal(raWeight(0, 0.3, 1), 0);
  // A higher expected risk makes a failure less surprising and a success more reassuring.
  assert.ok(raWeight(1, 0.6, 2) < raWeight(1, 0.2, 2));
  assert.ok(raWeight(0, 0.6, 2) < raWeight(0, 0.2, 2));
});

test('runCusum: accumulates, floors at 0, alarms at h, restarts after an alarm and on a version change', () => {
  const wF = Math.log(2) - Math.log(1.5), wO = -Math.log(1.5);
  const seq = [1, 1, 1, 1, 0, 1].map((y, i) => ({ idx: i, y, p: 0.5, version: 1 }));
  const r = runCusum(seq, { h: 0.8, ra: 2 });
  assert.deepEqual(r.alarms, [2]);
  close(r.path[1].s, 2 * wF, 1e-4, 'S after two events');
  close(r.path[3].s, wF, 1e-4, 'restart after the alarm');
  assert.equal(r.path[4].s, 0, 'floored'); assert.ok(wO < -wF);
  const v = runCusum([{ idx: 0, y: 1, p: 0.5, version: 1 }, { idx: 1, y: 1, p: 0.5, version: 2 }], { h: 0.5, ra: 2 });
  close(v.path[1].s, wF, 1e-4, 'version change restarts');
  assert.deepEqual(runCusum([{ idx: 0, y: 1, p: 0.5, version: 1 }, { idx: 1, y: 1, p: 0.5, version: 2 }], { h: 0.5, ra: 2, reset: 'none' }).alarms, [1]);
  assert.throws(() => runCusum(seq, { h: 0 }));
});

test('countRule: as-run (a compile attempt resets the count) and frozen (restart after an alarm)', () => {
  const asRun = [
    { idx: 3, deopt: true, compileBefore: true }, { idx: 4, deopt: true }, { idx: 5, deopt: false, compileBefore: true },
    { idx: 6, deopt: true }, { idx: 7, deopt: false }, { idx: 8, deopt: true }, { idx: 9, deopt: true, compileBefore: true },
  ];
  assert.deepEqual(countRule(asRun, { k: 2 }).alarms, [4, 8]);
  assert.deepEqual(countRule(asRun, { k: 3 }).alarms, []);
  const frozen = [1, 1, 1, 0, 1, 1].map((d, i) => ({ idx: i, deopt: !!d }));
  assert.deepEqual(countRule(frozen, { k: 2, restart: true }).alarms, [1, 4], 'the restart counts idx 2 afresh');
  assert.deepEqual(countRule(frozen, { k: 2 }).alarms, [1], 'without restart or a compile the alarm stays pending');
});

test('logisticFit: intercept-only equals logit(mean); recovers known coefficients on 20,000 synthetic rows', () => {
  const y0 = [1, 0, 0, 1, 0, 0, 0, 1];
  const f0 = logisticFit(y0.map(() => [1]), y0);
  close(f0.beta[0], Math.log(3 / 5), 1e-8, 'logit(3/8)'); assert.ok(f0.converged);
  const rng = mulberry32(7), truth = [-1, 0.8, 0.5], X = [], y = [];
  for (let i = 0; i < 20000; i++) { const x = [1, rng() * 3, Math.floor(rng() * 6)]; X.push(x); y.push(rng() < predict(truth, x) ? 1 : 0); }
  const f = logisticFit(X, y);
  assert.ok(f.converged);
  f.beta.forEach((b, i) => close(b, truth[i], 0.12, `beta ${i}`));
  f.se.forEach(s => assert.ok(s > 0 && s < 0.1));
  close(sigmoid(0), 0.5, 1e-15); close(sigmoid(-800), 0, 1e-300); close(sigmoid(800), 1, 1e-15);
});

test('auc: hand values', () => {
  assert.equal(auc([0.9, 0.8, 0.1, 0.2], [1, 1, 0, 0]), 1);
  assert.equal(auc([0.5, 0.5], [1, 0]), 0.5);
  assert.equal(auc([0.1, 0.9], [1, 0]), 0);
  assert.equal(auc([0.1], [1]), null);
});

// p = 1/3 and R_A = 4 make the weights +log 2 / -log 2, a reflected walk with up-probability 1/3. From 0 the exact ARL
// to 3 net steps is 33 and to 2 net steps is 12 (first-step equations: E2 = 1 + 2/3 E1, E1 = 1 + 1/3 E2 + 2/3 E0,
// E0 = 1 + 1/3 E1 + 2/3 E0).
const walk = () => makeProcess({ beta: [Math.log(0.5)], features: [], noveltyPool: [0], ra: 4, deoptShare: 1 });
test('ARL by simulation matches the exact Markov-chain ARL (33 and 12)', () => {
  const pr = walk();
  close(pr.ps[0], 1 / 3, 1e-12, 'p');
  const sim = simulateRecords({ process: pr, reps: 20000, steps: 2000, seed: 3 });
  close(arlAt(sim, 3 * Math.LN2 - 1e-9).arl, 33, 1.2, 'ARL(3 log 2)');
  close(arlAt(sim, 2 * Math.LN2 - 1e-9).arl, 12, 0.5, 'ARL(2 log 2)');
  assert.ok(arlAt(sim, 3 * Math.LN2 - 1e-9).se < 0.5);
});

test('calibrateH finds the smallest h whose ARL reaches the target (step function at 2 log 2)', () => {
  const c = calibrateH({ process: walk(), target: 20, reps: 20000, steps: 2000, seed: 3 });
  assert.ok(c.h > 2 * Math.LN2 - 1e-9 && c.h <= 2 * Math.LN2 + 1e-3, `h ${c.h}`);
  close(c.arl, 33, 1.2, 'ARL at h');
  // Common random numbers: ARL is monotone in h on one set of paths.
  const sim = simulateRecords({ process: walk(), reps: 2000, steps: 2000, seed: 5 });
  const hs = [0.3, 0.7, 1.0, 1.5, 2.1, 2.8], arls = hs.map(h => arlAt(sim, h).arl);
  for (let i = 1; i < arls.length; i++) assert.ok(arls[i] >= arls[i - 1]);
  assert.equal(calibrateFromSim(sim, 20).target, 20);
});

test('count rule in-control ARL: alarm at the 2nd event is 2/p', () => {
  const r = countRuleArl({ process: walk(), k: 2, reps: 20000, seed: 4 });
  close(r.arl, 6, 0.15, '2 / (1/3)');
});

test('feedback process: history counts simulated deopts in the last window steps', () => {
  // beta: intercept very negative, history slope very positive -> once a deopt happens, the next steps keep failing.
  const pr = makeProcess({ beta: [-30, 0, 60], features: ['novelty', 'history'], noveltyPool: [0], histWindow: 2, deoptShare: 1, ra: 2 });
  const st = pr.start(), rng = mulberry32(1);
  for (let i = 0; i < 10; i++) assert.equal(pr.step(rng, st).y, 0, 'never starts');
  st.ring[0] = 1; st.hist = 1;
  assert.equal(pr.step(rng, st).y, 1, 'history drives risk');
});

test('risk inputs never read the difficulty label, the drift index or the scoring segment', () => {
  const u = { kind: 'jit', attempted: true, deopt: false, disagree: true, delivered: 'compiled', pass: true, novFrozen: 2.308, novVersion: 0.5, hist: 2, difficulty: 3, driftIdx: 16, post: false, taskKey: 'records:dev:d3:s201' };
  const v = { ...u, difficulty: 4, driftIdx: 0, post: true, taskKey: 'records:dev:d4:s217' };
  assert.deepEqual(featuresOf(u), featuresOf(v));
  assert.deepEqual(featuresOf(u), [1, 2.308, 2]);
  assert.deepEqual(featuresOf(u, { noveltyPolicy: 'version' }), [1, 0.5, 2]);
  assert.deepEqual(featuresOf({ ...u, novFrozen: 9 }), [1, DESIGN.noveltyCap, 2], 'capped');
  assert.deepEqual(featuresOf(u, { features: [] }), [1]);
  // Views.
  assert.equal(eventOf(u, 'system'), 1); assert.equal(eventOf({ ...u, disagree: false }, 'system'), 0);
  assert.equal(eventOf({ ...u, disagree: false, pass: false }, 'oracle'), 1, 'silent miss is an oracle event');
  assert.equal(eventOf({ ...u, disagree: false, pass: false }, 'system'), 0, '... and not a system event');
  assert.equal(eventOf({ kind: 'agent', attempted: false, pass: false }, 'system'), null);
  assert.equal(eventOf({ kind: 'agent', attempted: false, pass: false }, 'oracle'), 1);
  assert.equal(isMonitored({ kind: 'static', attempted: true }, 'system'), false);
  assert.equal(isMonitored({ kind: 'static', attempted: true }, 'oracle'), true);
  assert.equal(isFitRow({ kind: 'agent', attempted: false }, 'oracle'), true);
  assert.equal(isFitRow({ kind: 'agent', attempted: false }, 'system'), false);
});

test('summarizeAlarms and decide apply the section rule (<= 4 after the drift index, <= 1 false alarm per stream)', () => {
  const s = summarizeAlarms([5, 18], { driftIdx: 16, firstIdx: 3, lastIdx: 23 });
  assert.deepEqual([s.falseAlarms, s.delay, s.reachesDrift, s.censored], [1, 2, true, false]);
  const n = summarizeAlarms([], { driftIdx: 16, firstIdx: 3, lastIdx: 18 });
  assert.deepEqual([n.delay, n.censored, n.postRows], [null, true, 3]);
  const early = summarizeAlarms([4, 7], { driftIdx: 16, firstIdx: 3, lastIdx: 11 });
  assert.deepEqual([early.falseAlarms, early.reachesDrift], [2, false]);
  const mk = (cusum) => ({ family: 'f', arm: 'a', cusum: { alarms: [], ...cusum } });
  assert.equal(decide([mk(s)], 'cusum').adopt, true);
  assert.equal(decide([mk(s), mk(early)], 'cusum').adopt, false, 'a stream that never reaches the drift still counts for false alarms');
  assert.equal(decide([mk(s), mk(n)], 'cusum').adopt, false, 'censored without an alarm is not a detection');
  assert.equal(decide([mk(summarizeAlarms([21], { driftIdx: 16, firstIdx: 3, lastIdx: 23 }))], 'cusum').adopt, false, 'delay 5');
  assert.equal(decide([mk(summarizeAlarms([20], { driftIdx: 16, firstIdx: 3, lastIdx: 23 }))], 'cusum').adopt, true, 'delay 4');
});

test('committed streams: 260 rows, drift at idx 16, the count rule replays to stateAfter, and the section verdict', async () => {
  const res = await analyze({ sim: { reps: 400, seed: 9, stepsPerTarget: 10 }, variants: VARIANTS.filter(v => ['primary', 'oracle'].includes(v.name)) });
  assert.equal(res.data.rows, 260);
  assert.deepEqual(res.data.byExperiment, { 'jit-dev-records-1': 168, 'jit-dev-kinetics-1': 92 });
  assert.equal(res.data.systemFitRows, 98); assert.equal(res.data.oracleFitRows, 260);
  assert.deepEqual(res.data.drift.map(d => d.driftIdx), [16, 16]);
  assert.deepEqual(res.data.taskProblems, []);
  assert.equal(res.asRunCheck.length, 6);
  for (const c of res.asRunCheck) assert.ok(c.equal, `${c.experiment} ${c.arm}: ${c.replay} vs ${c.logged}`);
  // The count rule's as-run alarms (records H→H 10,16; O→H 5; S→H 17; kinetics H→H 7,11; O→H 8,16,18; S→H 5,8,12).
  assert.deepEqual(res.asRunCheck.map(c => c.logged.join(',')), ['10,16', '5', '17', '7,11', '8,16,18', '5,8,12']);
  // Records d4 tasks share one frozen novelty score; the score comes from task content.
  const rec = res.units.filter(u => u.experiment === 'jit-dev-records-1' && u.arm.startsWith('agent-claude-haiku'));
  assert.equal(new Set(rec.filter(u => u.post).map(u => u.novFrozen)).size, 1);
  const p = res.results.find(r => r.name === 'primary');
  assert.ok(p.parts[0].calibration.h > 2.8 && p.parts[0].calibration.h < 3.8, `h ${p.parts[0].calibration.h}`);
  assert.equal(p.decision.cusum.adopt, false);
  assert.equal(p.decision.cusum.detection.streamsReachingDrift, 4);
  assert.equal(p.decision.count.falseAlarms.total, 8);
  assert.equal(p.decision.count.detection.met, 3);
  assert.equal(p.decision.count.adopt, false, 'the count rule fails the false-alarm half (kinetics H→H 2, S→H 3)');
  assert.ok(p.parts[0].sweep.every(x => !x.adopt), 'no h meets the rule on these rows');
  assert.ok(!p.parts[0].feasibility.reachableFromZero);
  const o = res.results.find(r => r.name === 'oracle');
  assert.equal(o.decision.cusum.detection.streamsReachingDrift, 5, 'the static arm reaches the drift in the oracle view');
  assert.equal(res.frozen.length, 2);
  assert.deepEqual(res.frozen[0].streams.map(s => s.solver).sort(), ['haikuV1', 'opusV1', 'opusV2', 'sonnetV1']);
});
