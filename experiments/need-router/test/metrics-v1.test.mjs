import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rng, needTable, withCascades, withoutSelfCheckCredit, cellStats, needUtility, needLabels, crossFitJob, makeCell, HEADLINE, GRID, SLIDER_CELLS, DELTA,
  sbsPerCell, sbsGlobal, coverage, fragility, selfTestRates, envFaults, signFlipTest, clusterBootstrapDelta, bootstrap, labelTable, bestOf, classOf,
} from '../metrics.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
// One row helper: outcome 'P' pass, 'W' delivered wrong, 'N' no answer.
const row = (job, mode, task, rep, o, usd, extra = {}) => ({ job, mode, task, rep, pass: o === 'P', delivered: o !== 'N', schemaValid: true, usdRepriced: usd, ...extra });
const rowsOf = (job, mode, pattern, usd, extra = {}) => pattern.map((reps, t) => [...reps].map((o, rep) => row(job, mode, `t${t}`, rep, o, usd, { seed: 610 + t, ...extra }))).flat();

test('needTable refuses malformed, duplicated or unpaired matrices instead of dropping rows', () => {
  const ok = [...rowsOf('j', 'direct-H', ['PP', 'PW'], 0.01), ...rowsOf('j', 'agent-H', ['PP', 'PP'], 0.1)];
  assert.doesNotThrow(() => needTable(ok));
  assert.throws(() => needTable([{ ...ok[0], delivered: undefined }]), /delivered must be a boolean/);
  assert.throws(() => needTable([{ ...ok[0], delivered: false }]), /a pass with no delivered answer/);
  assert.throws(() => needTable([...ok, ok[0]]), /duplicate/);
  assert.throws(() => needTable(ok.filter(r => !(r.mode === 'agent-H' && r.task === 't1'))), /unpaired/);
  assert.throws(() => needTable([...ok, row('j', 'construct-H', 't0', 0, 'P', 0.01), row('j', 'construct-H', 't1', 0, 'P', 0.01)]), /no build row/);
  assert.throws(() => needTable([...ok, row('j', 'construct-H', 't0', 1, 'P', 0.01), row('j', 'construct-H', 't1', 0, 'P', 0.01)], [{ job: 'j', mode: 'construct-H', rep: 0, usd: 1 }]), /lineage 1, which has no build row/);
  assert.throws(() => needTable([...ok, ...rowsOf('j', 'mystery', ['P', 'P'], 0)]), /unknown mode/);
  assert.throws(() => needTable(ok.map((r, i) => ({ ...r, taskHash: i === 0 ? 'x' : `h-${r.task}` }))), /taskHash pairing/);
  assert.throws(() => needTable(ok.map((r, i) => (i === 0 ? { ...r, seed: 999 } : r))), /seed pairing/);
  assert.throws(() => needTable([row('j', 'construct-H', 't0', 0, 'P', 0)], [{ job: 'j', mode: 'construct-H', rep: 0, usd: 1, failed: true }]), /failed build but a passing row/);
});

test('utility charges the build over N·V, silent misses at W/V and routing over N·V; an abstention costs only its dollars', () => {
  // direct-H: 4 tasks x 2 draws: 5 passes, 2 delivered-wrong, 1 abstention, $0.02 each.
  const rows = [...rowsOf('j', 'direct-H', ['PP', 'PW', 'WN', 'PP'], 0.02),
    // construct-H: 2 lineages ($1.00 and $0.50 builds), every task passes, $0.01 per task.
    ...rowsOf('j', 'construct-H', ['PP', 'PP', 'PP', 'PP'], 0.01)];
  const T = needTable(rows, [{ job: 'j', mode: 'construct-H', rep: 0, usd: 1 }, { job: 'j', mode: 'construct-H', rep: 1, usd: 0.5 }]);
  const d = cellStats(T, 'j', 'direct-H'), b = cellStats(T, 'j', 'construct-H');
  close(d.s, 5 / 8); close(d.q, 2 / 8); close(d.c, 0.02); close(d.B, 0);
  close(b.s, 1); close(b.q, 0); close(b.B, 0.75);
  close(needUtility(d, HEADLINE), 5 / 8 - 0.02 - 2 / 8);              // W = V: each silent miss costs one success
  close(needUtility(d, makeCell(1, 10, 0)), 5 / 8 - 0.02);            // W = 0: silent misses are free
  close(needUtility(d, makeCell(1, 10, 10)), 5 / 8 - 0.02 - 10 * 2 / 8);
  close(needUtility(d, makeCell(0.1, 10)), 5 / 8 - 0.2 - 2 / 8);      // dollars count ten times more at V = $0.10
  close(needUtility(b, HEADLINE), 1 - 0.01 - 0.75 / 10);
  close(needUtility(b, makeCell(1, 1)), 1 - 0.01 - 0.75);             // N = 1 pays the whole build
  close(needUtility(b, HEADLINE, 0.5), 1 - 0.01 - 0.75 / 10 - 0.05);  // routing dollars r/(N·V)
  // The abstention (N) costs its $0.02 and nothing else: drop it from the wrong count, keep its dollars.
  const noMiss = needTable(rowsOf('k', 'direct-H', ['N'], 0.02));
  close(needUtility(cellStats(noMiss, 'k', 'direct-H'), HEADLINE), -0.02);
});

test('a failed self-check withholds the answer; F11 withdraws that credit and scores deliveries as unverified', () => {
  // construct-H, 1 lineage, 12 tasks: 10 wrong answers of which the self-check passes 4 (false pass 0.4), and 2 right answers of which it fails 1.
  const self = ['pass', 'pass', 'pass', 'pass', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'pass', 'fail'];
  const rows = self.map((v, t) => row('j', 'construct-H', `t${t}`, 0, t < 10 ? 'W' : 'P', 0.01, { selfVerdict: v, seed: 610 + t }));
  const T = needTable(rows, [{ job: 'j', mode: 'construct-H', rep: 0, usd: 0 }]);
  const withCredit = cellStats(T, 'j', 'construct-H');
  close(withCredit.s, 1 / 12); close(withCredit.q, 4 / 12);            // 6 wrong answers withheld; one right answer withheld too
  const st = selfTestRates(T);
  assert.equal(st.lineages.length, 1);
  close(st.lineages[0].falsePassRate, 0.4); close(st.lineages[0].falseFailRate, 0.5);
  assert.equal(st.lineages[0].f11, true); assert.deepEqual(st.f11, ['construct-H']);
  const noCredit = cellStats(withoutSelfCheckCredit(T, ['j|construct-H|0']), 'j', 'construct-H');
  close(noCredit.s, 2 / 12); close(noCredit.q, 10 / 12);
  // Under 10 oracle failures F11 cannot trip, whatever the rate.
  assert.equal(selfTestRates(needTable(rows.slice(4), [{ job: 'j', mode: 'construct-H', rep: 0, usd: 0 }])).f11.length, 0);
});

test('a failed build fails its lineage at its cost; a voided lineage is listed and scores as failures (or is dropped)', () => {
  const rows = [...rowsOf('j', 'direct-H', ['P', 'P'], 0.01), ...[0, 1].map(t => row('j', 'construct-H', `t${t}`, 0, 'P', 0.01, { seed: 610 + t }))];
  const builds = [{ job: 'j', mode: 'construct-H', rep: 0, usd: 0.4 }, { job: 'j', mode: 'construct-H', rep: 1, usd: 0.6, failed: true }];
  const T = needTable(rows, builds);
  const s = cellStats(T, 'j', 'construct-H');
  close(s.s, 0.5); close(s.B, 0.5); close(s.q, 0);
  assert.equal(T.cell('j', 'construct-H').byTask.get('t0').get(1).error, 'BUILD_FAILED');
  const voidB = [{ job: 'j', mode: 'construct-H', rep: 0, usd: 0.4, nestedModelAttempts: 2 }, { job: 'j', mode: 'construct-H', rep: 1, usd: 0.6 },];
  const rows2 = [...rows, ...[0, 1].map(t => row('j', 'construct-H', `t${t}`, 1, 'P', 0.01, { seed: 610 + t }))];
  const V = needTable(rows2, voidB);
  assert.deepEqual(V.voided.map(v => [v.rep, v.reasons[0]]), [[0, 'nestedModelAttempts=2']]);
  close(cellStats(V, 'j', 'construct-H').s, 0.5);
  const D = needTable(rows2, voidB, { voidPolicy: 'drop' });
  close(cellStats(D, 'j', 'construct-H').s, 1); close(cellStats(D, 'j', 'construct-H').B, 0.6);
});

test('cascades are derived at $0 from the paired rows: the fallback runs only on a deployable trigger and both are paid', () => {
  const rows = [
    ...rowsOf('j', 'direct-H', ['NP', 'WP'], 0.02),                    // t0 rep0 null -> fallback; t1 rep0 delivered wrong -> no trigger (not observable)
    ...rowsOf('j', 'agent-H', ['PW', 'PP'], 0.1),
    ...[0, 1].map(t => row('j', 'construct-H', `t${t}`, 0, 'W', 0.01, { seed: 610 + t, selfVerdict: t === 0 ? 'fail' : 'pass' })),
  ];
  const builds = [{ job: 'j', mode: 'construct-H', rep: 0, usd: 1 }, { job: 'j', mode: 'construct-H', rep: 1, usd: 2, failed: true }];
  const T = withCascades(rows, builds);
  assert.ok(T.modes.includes('direct-H->agent-H') && T.modes.includes('construct-H->agent-H') && T.modes.includes('agent-H->agent-O') === false);
  const c = T.cell('j', 'direct-H->agent-H');
  const x = c.byTask.get('t0').get(0);
  assert.equal(x.pass, true); close(x.usd, 0.12);                       // agent-H rep 0 of t0, both paid
  assert.equal(c.byTask.get('t1').get(0).pass, false); close(c.byTask.get('t1').get(0).usd, 0.02);
  const k = T.cell('j', 'construct-H->agent-H');
  assert.equal(k.byTask.get('t0').get(0).pass, true);                   // self-check failed -> agent-H rep 0 passes
  assert.equal(k.byTask.get('t1').get(0).pass, false);                  // self-check passed a wrong answer: delivered
  assert.equal(k.byTask.get('t0').get(1).pass, false);                  // failed build: every task falls back; lineage 1 pairs with agent-H rep 1 (W on t0)
  assert.equal(k.byTask.get('t1').get(1).pass, true);                   // ... and agent-H rep 1 passes t1
  close(cellStats(T, 'j', 'construct-H->agent-H').B, 1.5);              // both builds paid
  assert.equal(classOf('construct-H->agent-H'), 'workflow'); assert.equal(classOf('direct-H->agent-H'), 'no-workflow');
});

test('acceptable set, NEED label and ties: A = {u >= u_max - δ}; one class -> that label, else either; exact ties go to the cheaper mode', () => {
  const det = (job, mode, k, n, usd) => Array.from({ length: n }, (_, t) => row(job, mode, `t${t}`, 0, t < k ? 'P' : 'N', usd, { seed: 610 + t }));
  const rows = [
    ...det('wf', 'direct-H', 2, 10, 0.01), ...det('wf', 'agent-H', 5, 10, 0.1), ...det('wf', 'construct-H', 10, 10, 0.01),
    ...det('nw', 'direct-H', 10, 10, 0.01), ...det('nw', 'agent-H', 10, 10, 0.1), ...det('nw', 'construct-H', 10, 10, 0.01),
    ...det('ei', 'direct-H', 9, 10, 0.01), ...det('ei', 'agent-H', 9, 10, 0.1), ...det('ei', 'construct-H', 10, 10, 0.01),
  ];
  const builds = ['wf', 'nw', 'ei'].map(job => ({ job, mode: 'construct-H', rep: 0, usd: job === 'nw' ? 5 : job === 'ei' ? 1.1 : 0.1 }));
  const L = needLabels(needTable(rows, builds), { cells: [HEADLINE], reps: 0 });
  assert.equal(L.at('wf', HEADLINE).label, 'workflow'); assert.deepEqual(L.at('wf', HEADLINE).acceptable, ['construct-H']);
  assert.equal(L.at('nw', HEADLINE).label, 'no-workflow'); assert.equal(L.at('nw', HEADLINE).top, 'direct-H');
  // ei: direct 0.89, construct 1 - 0.01 - 0.11 = 0.88: within δ -> either.
  assert.equal(L.at('ei', HEADLINE).label, 'either'); assert.deepEqual(L.at('ei', HEADLINE).acceptable, ['direct-H', 'construct-H']);
  assert.equal(L.at('ei', HEADLINE).confident, false);                  // reps 0: nothing is confident
  // Exact tie: the cheaper mode wins.
  assert.equal(bestOf([{ mode: 'a', u: 0.9, usd: 0.1 }, { mode: 'b', u: 0.9, usd: 0.0 }]).mode, 'b');
  assert.equal(bestOf([{ mode: 'a', u: 0.9, usd: 0.1 }, { mode: 'b', u: 0.9 + 1e-6, usd: 0.5 }]).mode, 'b');
  close(DELTA, 0.03);
});

test('label confidence is seeded, separates clear jobs from near ties, and imputed dollars over 30% leave a job unlabelled', () => {
  const r = rng(9), rows = [];
  const gen = (job, mode, p, usd, reps = 2, imputed = 0) => { for (let t = 0; t < 12; t++) for (let k = 0; k < reps; k++) rows.push(row(job, mode, `t${t}`, k, r() < p ? 'P' : 'N', usd, { seed: 610 + t, usdImputed: imputed })); };
  gen('clear', 'direct-H', 0.95, 0.01); gen('clear', 'agent-H', 0.3, 0.1);
  gen('tie', 'direct-H', 0.6, 0.01); gen('tie', 'agent-H+proc', 0.62, 0.02);
  gen('imp', 'direct-H', 0.95, 0.01, 2, 0.01); gen('imp', 'agent-H', 0.3, 0.1);
  const builds = [{ job: 'tie', mode: 'agent-H+proc', rep: 0, usd: 0 }, { job: 'tie', mode: 'agent-H+proc', rep: 1, usd: 0 }];
  const T = needTable(rows, builds);
  const a = needLabels(T, { cells: [HEADLINE], reps: 400, seed: 4 }), b = needLabels(T, { cells: [HEADLINE], reps: 400, seed: 4 });
  assert.deepEqual(a.at('tie', HEADLINE).pBest, b.at('tie', HEADLINE).pBest);
  assert.equal(a.at('clear', HEADLINE).confident, true); assert.ok(a.at('clear', HEADLINE).pBest['no-workflow'] >= 0.99);
  assert.equal(a.at('tie', HEADLINE).confident, false);
  assert.match(a.at('imp', HEADLINE).unlabelled, /imputed/); assert.equal(a.at('imp', HEADLINE).confident, false);
  const cov = coverage(a, ['clear', 'tie', 'imp'], HEADLINE);
  assert.equal(cov.confident, 1); assert.equal(cov.unlabelled, 1); close(cov.coverage, 1 / 3);
});

test('cross-fitted VBS*: never above VBS when both directions are used, below it on average under the primary scheme, equal without noise', () => {
  const r = rng(21), modes = ['direct-H', 'agent-H', 'agent-O'];
  let sumStar = 0, sumVbs = 0, n = 0;
  for (let job = 0; job < 60; job++) {
    const rows = [];
    for (const m of modes) { const p = 0.3 + 0.5 * r(), c = 0.2 * r(); for (let t = 0; t < 12; t++) for (let k = 0; k < 2; k++) rows.push(row(`j${job}`, m, `t${t}`, k, r() < p ? 'P' : r() < 0.5 ? 'W' : 'N', c, { seed: 610 + t })); }
    const T = needTable(rows);
    const two = crossFitJob(T, `j${job}`, modes, GRID, { scheme: 'two-way' });
    const L = needLabels(T, { cells: GRID, reps: 0, crossFit: 'primary' });
    for (const c of GRID) {
      assert.ok(two.get(c.key).vbsStar <= L.at(`j${job}`, c).vbs + 1e-12, 'two-way VBS* <= VBS, exactly');
      sumStar += L.at(`j${job}`, c).vbsStar; sumVbs += L.at(`j${job}`, c).vbs; n += 1;
    }
  }
  assert.ok(sumStar / n < sumVbs / n, `primary VBS* ${sumStar / n} vs VBS ${sumVbs / n}`);
  // Identical replicates: selecting on one and scoring on the other changes nothing.
  const same = needTable(modes.flatMap((m, i) => Array.from({ length: 6 }, (_, t) => [0, 1].map(k => row('z', m, `t${t}`, k, t < 2 + i ? 'P' : 'N', 0.01 * i, { seed: 610 + t }))).flat()));
  const Z = needLabels(same, { cells: [HEADLINE], reps: 0 });
  close(Z.at('z', HEADLINE).vbsStar, Z.at('z', HEADLINE).vbs);
  // Lineage modes rotate (select on two lineages, score on the third): K = 3 gives 3 folds.
  const lin = [...rowsOf('q', 'direct-H', Array(6).fill('PP'), 0.01), ...Array.from({ length: 6 }, (_, t) => [0, 1, 2].map(k => row('q', 'construct-H', `t${t}`, k, 'P', 0.01, { seed: 610 + t }))).flat()];
  const Q = needTable(lin, [0, 1, 2].map(k => ({ job: 'q', mode: 'construct-H', rep: k, usd: 0.3 })));
  assert.equal(crossFitJob(Q, 'q', ['direct-H', 'construct-H'], [HEADLINE]).get(HEADLINE.key).folds.length, 3);
});

test('SBS per cell follows the slider; SBS-global is one mode for every cell', () => {
  const det = (job, mode, k, usd) => Array.from({ length: 10 }, (_, t) => row(job, mode, `t${t}`, 0, t < k ? 'P' : 'N', usd, { seed: 610 + t }));
  const rows = ['a', 'b'].flatMap(j => [...det(j, 'direct-H', 6, 0.001), ...det(j, 'agent-O', 10, 1.0)]);
  const L = needLabels(needTable(rows), { cells: GRID, reps: 0 });
  assert.equal(sbsPerCell(L, ['a', 'b'], makeCell(0.1, 10)), 'direct-H');
  assert.equal(sbsPerCell(L, ['a', 'b'], makeCell(10, 10)), 'agent-O');
  const g = sbsGlobal(L, ['a', 'b']);
  assert.ok(['direct-H', 'agent-O'].includes(g));
  assert.equal(SLIDER_CELLS.length, 9); assert.ok(SLIDER_CELLS.every(c => c.wOverV === 1));
  assert.equal(GRID.length, 27); assert.equal(GRID[0].key, HEADLINE.key);
});

test('fragility: a label resting on the 0.97 tolerance flips at half or double tolerance; a robust one does not', () => {
  const mk = (job, scores, mode, usd) => scores.map((s, t) => ({ job, mode, task: `t${t}`, rep: 0, seed: 610 + t, pass: s >= 0.97, delivered: true, score: s, usdRepriced: usd }));
  const edge = Array(10).fill(0.975), robust = Array(10).fill(1);
  // direct-H at 0.975 passes the 0.97 rule but not the halved tolerance (0.985), where construct-H (a workflow) takes over.
  const rows = [...mk('edge', edge, 'direct-H', 0.01), ...mk('edge', Array(10).fill(1), 'construct-H', 0.01),
    ...mk('rob', robust, 'direct-H', 0.01), ...mk('rob', robust, 'construct-H', 0.01)];
  const builds = ['edge', 'rob'].map(job => ({ job, mode: 'construct-H', rep: 0, usd: 0.5 }));
  const F = fragility(rows, builds, { tolerance: () => ({ scoreThreshold: 0.97 }), cells: [HEADLINE] });
  assert.deepEqual(F.jobs.find(j => j.job === 'edge').cells[0], { cell: HEADLINE.key, nominal: 'no-workflow', at: { 0.5: 'workflow', 2: 'no-workflow' } });
  assert.deepEqual(F.fragile, ['edge']);
  // label-run's own recomputation (passAt) takes precedence over the score rule
  const F2 = fragility(rows.map(r => ({ ...r, passAt: { 0.5: r.pass, 2: r.pass } })), builds, { tolerance: () => ({ scoreThreshold: 0.97 }), cells: [HEADLINE] });
  assert.deepEqual(F2.fragile, []);
});

test('the exact sign-flip test: p, test-inversion bounds and the 5-cluster floor', () => {
  const all = [0.05, 0.02, 0.08, 0.01, 0.04, 0.06, 0.03];
  const t7 = signFlipTest(all, { alpha: 0.025 });
  close(t7.p, 1 / 128); assert.ok(t7.lo > 0); assert.equal(t7.exact, true);
  const t5 = signFlipTest(all.slice(0, 5), { alpha: 0.025 });
  close(t5.p, 1 / 32); assert.equal(t5.lo, -Infinity);                  // with 5 clusters no reading can exclude 0 at Holm's first step
  // p equals brute-force enumeration of sign patterns; lo > 0 iff p <= α; bounds invert the test; hi mirrors lo.
  const r = rng(77);
  for (let k = 0; k < 40; k++) {
    const d = Array.from({ length: 6 }, () => Math.round((r() - 0.35) * 100) / 1000);
    let ge = 0;
    for (let mask = 0; mask < 64; mask++) { let s = 0; d.forEach((x, i) => { s += (mask >> i) & 1 ? -x : x; }); if (s / 6 >= d.reduce((a, x) => a + x, 0) / 6 - 1e-12) ge += 1; }
    const t = signFlipTest(d, { alpha: 0.05 });
    close(t.p, ge / 64);
    assert.equal(t.lo > 0, t.p <= 0.05);
    if (Number.isFinite(t.lo)) { assert.ok(signFlipTest(d, { theta: t.lo - 1e-6, alpha: 0.05 }).p <= 0.05); assert.ok(signFlipTest(d, { theta: t.lo, alpha: 0.05 }).p > 0.05); }
    close(signFlipTest(d.map(x => -x), { alpha: 0.05 }).hi, -t.lo);
  }
  // Monte Carlo above exactMax approximates the exact answer.
  const d12 = Array.from({ length: 12 }, (_, i) => (i % 3 === 0 ? -0.01 : 0.02) * (1 + i / 10));
  const ex = signFlipTest(d12, { alpha: 0.05 }), mc = signFlipTest(d12, { alpha: 0.05, exactMax: 8, draws: 100000 });
  assert.equal(mc.exact, false); close(mc.p, ex.p, 0.003); close(mc.lo, ex.lo, 0.002);
  assert.equal(signFlipTest([]).p, 1);
});

test('the cluster bootstrap of Δ is seeded and brackets the point estimate; the v0 bootstrap gains a cluster level', () => {
  const r = rng(5), rows = [];
  for (const c of ['A', 'B', 'C', 'D']) for (const j of [0, 1]) for (const [m, p] of [['direct-H', 0.5], ['agent-H', 0.7]]) for (let t = 0; t < 10; t++) rows.push(row(`${c}${j}`, m, `t${t}`, 0, r() < p ? 'P' : 'N', 0.01, { seed: 610 + t }));
  const T = needTable(rows), L = needLabels(T, { cells: [HEADLINE], reps: 0 });
  const items = T.jobs.map(job => ({ job, cluster: job[0], a: 'agent-H', b: 'direct-H' }));
  const point = ['A', 'B', 'C', 'D'].map(c => items.filter(x => x.cluster === c).reduce((s, x) => s + L.u(x.job, HEADLINE, 'agent-H') - L.u(x.job, HEADLINE, 'direct-H'), 0) / 2).reduce((a, x) => a + x, 0) / 4;
  const a = clusterBootstrapDelta(T, items, HEADLINE, { reps: 2000, seed: 3 }), b = clusterBootstrapDelta(T, items, HEADLINE, { reps: 2000, seed: 3 });
  assert.deepEqual(a, b); assert.ok(a.lo <= point && point <= a.hi, `${a.lo} <= ${point} <= ${a.hi}`);
  // v0 API: a cluster level resamples clusters with all their families.
  const v0 = labelTable(['f1', 'f2', 'f3'].flatMap(f => ['x', 'y'].flatMap(m => Array.from({ length: 5 }, (_, t) => ({ family: f, mode: m, task: `t${t}`, success: (t + (m === 'x' ? 0 : 1)) % 2 === 0, costUsd: 0.01 })))));
  const c1 = bootstrap(v0, () => 'x', 1, { reps: 200, seed: 2, clusterOf: f => (f === 'f3' ? 'K2' : 'K1') });
  assert.deepEqual(c1.ci, bootstrap(v0, () => 'x', 1, { reps: 200, seed: 2, clusterOf: f => (f === 'f3' ? 'K2' : 'K1') }).ci);
});

test('an arm over 25% environment faults is invalid', () => {
  const rows = [...Array.from({ length: 8 }, (_, t) => row('j', 'agent-H', `t${t}`, 0, t < 3 ? 'N' : 'P', 0.1, { seed: 610 + t, error: t < 3 ? { code: 'MODEL_UNAVAILABLE' } : null })),
    ...Array.from({ length: 8 }, (_, t) => row('j', 'direct-H', `t${t}`, 0, t < 2 ? 'N' : 'P', 0.1, { seed: 610 + t, error: t < 2 ? 'MODEL_RATE_LIMIT' : null }))];
  const E = envFaults(needTable(rows));
  assert.equal(E.find(x => x.mode === 'agent-H').invalid, true);         // 3/8 = 0.375
  assert.equal(E.find(x => x.mode === 'direct-H').invalid, false);       // 2/8 = 0.25, not over
});
