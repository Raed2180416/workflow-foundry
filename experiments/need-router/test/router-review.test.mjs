// Regression tests for the adversarial review of the v1 router and its decision card (2026-10-15), one test per defect:
// D1 a probe's cost booked as $0; D2 probePlan pricing every probe k·W·q too high; D3 leaf stats comparing modes on
// different TRAIN jobs; D4 routerSha missing classes, kinds, cascades and the checkpoint, and hashing code lazily; D5 a
// plain cell's W read as W = V; D6 monotonicity (N under δ ties; raw p across V at W = V); D7 H0 silently "no workflow"
// when it cannot be fitted; D8 the δ-tie choice against the exact-best SBS-train yardstick; D9 kNN needsWorkflow moving
// with the slider, and probe labels. $0, synthetic and planted data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fitNeedRouter, decideModes, resolveCell, ruleFitStatus, ruleLoco, trainItem, probeRecord, N1, RULE_MINIMUM } from '../router.mjs';
import { decisionCard, validateCard, probePlan, routerSha, codeShas } from '../card.mjs';
import { expectedUtilities, probeValue, bestProbe } from '../voi.mjs';
import { thetaFitStatus } from '../prereg-rules.mjs';
import { HEADLINE, DELTA, CASCADES, makeCell, cellKey, classOf, modeInfo, rankModes, needUtility, perTaskUsd } from '../metrics.mjs';
import { needsWorkflow as plantedNeed } from './worlds.mjs';
import { plantedRouter, realisticModes, generalModes, rng, NON_MONOTONE_N, V1_MODES } from './router-fixtures.mjs';

const P = plantedRouter();
const job = (j, over = {}) => { const v = P.view(j); return { id: v.id, features: v.features, requirements: v.requirements, verifier: v.verifier, modes: v.modes, ...over }; };
const SMALL = P.EVAL.find(j => !plantedNeed(P.W.meta[j].features)), BIG = P.EVAL.find(j => plantedNeed(P.W.meta[j].features));
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
/** A synthetic TRAIN item with a confident N = 1 label. */
const item = (id, cluster, tok, stats, label, confident = true) => ({ id, cluster, features: { logInputTokens: tok, maxListLength: 0 }, stats, label: () => ({ label, confident }) });
const st = (s, q, c, B = 0) => ({ s, q, c, B });

// ------------------------------------------------------------------------------------------------------------- D1
test('D1 a probe\'s cost is never booked as $0: no cost, a $0 cost after drawing, or a negative cost is refused; a forged card fails validation', () => {
  const R = fitNeedRouter(P.items, { modes: V1_MODES }), j = job(SMALL), obs = { 'agent-H': { passes: 2, n: 2 } };
  // The reviewer's probe1: observations moved p, no costUsd, and the card validated with routingCostUsd 0 as NR-probe.
  assert.throws(() => decisionCard(R, j, HEADLINE, { probe: { observations: obs } }), /costUsd must be a finite number/);
  assert.throws(() => R.decide(j, HEADLINE, { probe: { observations: obs } }), /costUsd must be a finite number/);
  for (const bad of [-0.2, NaN, Infinity, '0.16', null]) assert.throws(() => decisionCard(R, j, HEADLINE, { probe: { observations: obs, costUsd: bad } }), /costUsd must be a finite number/, String(bad));
  for (const p of [{ observations: obs, costUsd: 0 }, { observations: { 'agent-H': { passes: 0, n: 0 } }, costUsd: 0 }, { observations: {}, k: 1, costUsd: 0 }]) assert.throws(() => R.decide(j, HEADLINE, { probe: p }), /cannot cost \$0/, JSON.stringify(p));
  // A negative probe cost is refused even when routingUsd would cover it (the sum used to be checked, not the parts).
  assert.throws(() => R.decide(j, HEADLINE, { routingUsd: 0.5, probe: { observations: {}, costUsd: -0.2 } }), /costUsd must be a finite number/);
  assert.throws(() => R.decide(j, HEADLINE, { routingUsd: -0.1 }), /routingUsd must be a finite number/);
  assert.throws(() => R.decide(j, HEADLINE, { probe: { observations: obs, costUsd: 0.1, k: 1 } }), /probe\.k must be an integer >= the observed draws/);
  assert.throws(() => R.decide(j, HEADLINE, { probe: { observations: obs, costUsd: 0.1, tasksPerJob: 3 } }), /tasksPerJob 3 differs/);
  // A priced probe is charged in full: routing = routingUsd + costUsd, every U lowered by r/(N·V).
  const base = R.decide(j, HEADLINE), card = decisionCard(R, j, HEADLINE, { probe: { observations: obs, costUsd: 0.16 } });
  assert.equal(card.policy, 'NR-probe'); assert.equal(card.routingCostUsd, 0.16); assert.equal(card.probe.costUsd, 0.16); assert.equal(card.probe.k, 2);
  close(base.U['direct-H'] - card.U['direct-H'], 0.16 / (HEADLINE.N * HEADLINE.V));
  assert.equal(R.decide(j, HEADLINE, { routingUsd: 0.04, probe: { observations: obs, costUsd: 0.16 } }).routingCostUsd, 0.2);
  assert.deepEqual(validateCard(card), { ok: true, problems: [] });
  // A card forged to book the probe at $0 is schema-valid but fails the cross-field check.
  const forged = structuredClone(card); forged.probe.costUsd = 0; forged.routingCostUsd = 0;
  const v = validateCard(forged);
  assert.equal(v.ok, false); assert.ok(v.problems.some(p => /must carry its cost/.test(p)), v.problems.join('; '));
  // probeRecord is the one gate both entry points use.
  assert.equal(probeRecord(null), null);
  assert.deepEqual(probeRecord({ observations: obs, costUsd: 0.16, signals: { agree: true } }), { observations: obs, costUsd: 0.16, k: 2, modes: ['agent-H'], signals: { agree: true }, disagree: false });
});

// ------------------------------------------------------------------------------------------------------------- D2
test('D2 a non-deliverable probe is priced at its dollars, k·(c + cVerify), never k·W·q; the decision after it still charges W·q', () => {
  const x = { id: 'x', features: { logInputTokens: 2, maxListLength: 0 } };
  const thin = stats => fitNeedRouter([{ id: 'a', cluster: 'A', features: x.features, stats, labels: {} }], { modes: ['direct-H', 'agent-H'], tasksPerJob: 1 });
  // The reviewer's case: direct-H c 0.05, q 0.55 at W = V = 1 was priced 0.600 for k = 1 (12 times its $0.05).
  const R = thin({ 'direct-H': st(0.45, 0.55, 0.05), 'agent-H': st(0.5, 0.2, 0.12) });
  for (const w of [0, 1, 10]) {
    const plan = probePlan(R, x, makeCell(1, 100, w), { cVerify: 0.01 });
    assert.equal(plan.plans.length, 4);
    for (const p of plan.plans) close(p.cost, p.k * ((p.j === 'direct-H' ? 0.05 : 0.12) + 0.01));
    for (const m of plan.modes) { close(m.c, m.id === 'direct-H' ? 0.05 : 0.12); close(m.wq, w * (m.id === 'direct-H' ? 0.55 : 0.2)); }
  }
  close(probePlan(R, x, makeCell(1, 100, 1)).plans.find(p => p.j === 'direct-H' && p.k === 1).cost, 0.05);
  // Against the old fold (c + W·q as the probe's cost): the same post-probe choices and EVSI, and a net that differs by
  // exactly k·W·q, the over-charge.
  const modes = probePlan(R, x, makeCell(1, 100, 1)).modes, folded = modes.map(m => ({ ...m, c: m.c + m.wq, wq: 0 }));
  for (const k of [1, 2]) {
    const a = probeValue(modes, 'direct-H', k, { V: 1, H: 100 }), b = probeValue(folded, 'direct-H', k, { V: 1, H: 100 });
    close(a.net - b.net, k * 0.55, 1e-9); close(a.evsi, b.evsi, 1e-9); assert.deepEqual(a.after.map(s => s.choose), b.after.map(s => s.choose));
  }
  // The bias flipped decisions: here the corrected price probes direct-H twice, the fold never probed (net 0).
  const R2 = thin({ 'direct-H': st(0.3, 0.2, 0.03), 'agent-H': st(0.4, 0.05, 0.12) }), c10 = makeCell(1, 10, 1);
  const now = probePlan(R2, x, c10), old = bestProbe(now.modes.map(m => ({ ...m, c: m.c + m.wq, wq: 0 })), { V: 1, H: 10, kMax: 2, probeable: ['direct-H', 'agent-H'] });
  assert.deepEqual(now.probe, { j: 'direct-H', k: 2 }); assert.ok(now.net > 0.2, String(now.net));
  assert.equal(old.probe, null);
  // voi's wq: utilities subtract H·wq; a deliverable probe's delivered value is k·(V·p̂ − wq); wq defaults to 0.
  const m1 = [{ id: 'a', a: 3, b: 1, c: 0.2, wq: 0.1, F: 1 }];
  close(expectedUtilities(m1, { V: 2, H: 10 }).get('a'), 10 * (2 * 0.75 - 0.2 - 0.1) - 1);
  close(expectedUtilities([{ ...m1[0], wq: undefined }], { V: 2, H: 10 }).get('a'), 10 * (2 * 0.75 - 0.2) - 1);
  const two = [{ id: 'a', a: 3, b: 3, c: 0.1, wq: 0.2, F: 0 }, { id: 'b', a: 9, b: 1, c: 0.6, wq: 0.05, F: 0 }];
  const del = probeValue(two, 'a', 3, { V: 1, H: 40, deliverable: true }), nd = probeValue(two, 'a', 3, { V: 1, H: 40 });
  close(del.delivered, 3 * (1 * 0.5 - 0.2)); close(del.cost, 3 * 0.1); close(nd.cost, 3 * 0.1); assert.equal(nd.delivered, 0);
  // Not on the kNN stage, and not with a prior weight other than the one the update uses.
  assert.throws(() => probePlan(fitNeedRouter(P.items, { modes: V1_MODES, stage: 'knn' }), job(SMALL)), /kNN stage takes no probe/);
  assert.throws(() => probePlan(R, x, HEADLINE, { tasksPerJob: 12 }), /tasksPerJob 12 differs/);
});

// ------------------------------------------------------------------------------------------------------------- D3
test('D3 leaf stats compare modes on the same TRAIN jobs: a mode missing from any leaf job is not priced there and is listed', () => {
  // The reviewer's probe2: leaf "not" holds an easy job with direct-H and a hard job without it. Averaged over the jobs
  // that had it, direct-H read p = 1 (n 1) against agent-H's 0.725 (n 2) and won.
  const train = [
    item('a', 'A', 2, { 'direct-H': st(1, 0, 0.02), 'agent-H': st(0.9, 0.05, 0.1) }, 'no-workflow'),
    item('b', 'B', 2.2, { 'agent-H': st(0.55, 0.1, 0.1) }, 'no-workflow'),
    item('c', 'C', 5, { 'agent-H': st(0.5, 0.1, 0.1), 'construct-H': st(0.9, 0, 0.02, 1) }, 'workflow'),
    item('d', 'D', 5.2, { 'agent-H': st(0.5, 0.1, 0.1), 'construct-H': st(0.9, 0, 0.02, 1) }, 'workflow'),
  ];
  const R = fitNeedRouter(train), d = R.decide({ id: 'x', features: { logInputTokens: 2.1, maxListLength: 0 } }, HEADLINE);
  assert.equal(R.rule.fitted, true); assert.equal(d.source.leaf, 'not');
  assert.equal(d.mode, 'agent-H'); assert.ok(!Object.hasOwn(d.pred, 'direct-H')); assert.ok(d.unsupported.includes('direct-H'));
  close(d.pred['agent-H'].p, 0.725); assert.equal(d.pred['agent-H'].n, 2);
  assert.deepEqual(R.fitted.leaves.not.dropped, ['direct-H']); assert.deepEqual(R.fitted.leaves.intrinsic.dropped, []);
  assert.deepEqual(R.fitted.leaves.pooled.dropped, ['construct-H', 'direct-H']);
  // A job without agent-H on its menu: nothing comparable is left in its leaf, so the router abstains to the default
  // rather than pricing direct-H from one easy job.
  const lone = R.decide({ id: 'y', features: { logInputTokens: 2.1, maxListLength: 0 }, modes: ['direct-H', 'agent-O', 'agent-H'] }, HEADLINE);
  assert.equal(lone.mode, 'agent-H');
  assert.throws(() => R.decide({ id: 'z', features: { logInputTokens: 2.1, maxListLength: 0 }, modes: ['agent-O'] }, HEADLINE), /no mode this router knows/);
  const noAgent = fitNeedRouter(train, { modes: ['direct-H', 'agent-H', 'agent-O', 'construct-H'] }).decide({ id: 'y', features: { logInputTokens: 2.1, maxListLength: 0 }, modes: ['direct-H', 'agent-O'] }, HEADLINE);
  assert.match(noAgent.abstain.reasons[0], /^no-supported-mode/); assert.deepEqual(noAgent.unsupported, ['direct-H', 'agent-O']);
  // With direct-H on both jobs it is priced over both.
  const both = fitNeedRouter(train.map(x => (x.id === 'b' ? { ...x, stats: { ...x.stats, 'direct-H': st(0.2, 0.6, 0.02) } } : x)));
  const d2 = both.decide({ id: 'x', features: { logInputTokens: 2.1, maxListLength: 0 } }, HEADLINE);
  close(d2.pred['direct-H'].p, 0.6); assert.equal(d2.pred['direct-H'].n, 2); assert.equal(d2.mode, 'agent-H');
  // The planted world has every mode on every job: nothing dropped, so nothing changes there.
  const RP = fitNeedRouter(P.items, { modes: V1_MODES });
  for (const L of Object.values(RP.fitted.leaves)) assert.deepEqual(L.dropped, []);
});

// ------------------------------------------------------------------------------------------------------------- D4
test('D4 routerSha names the whole decision procedure (classes, kinds, cascades, checkpoint); code shas are taken at load', () => {
  const base = fitNeedRouter(P.items, { modes: V1_MODES }), s0 = routerSha(base).sha;
  // The reviewer's probe2: classOf -> workflow, no cascades, checkpoint after 9 gave the same sha and different cards.
  const odd = fitNeedRouter(P.items, { modes: V1_MODES, classOf: () => 'workflow', cascades: [], checkpointAfter: 9 });
  assert.notEqual(routerSha(odd).sha, s0);
  const a = decisionCard(base, job(BIG), HEADLINE), b = decisionCard(odd, job(BIG), HEADLINE);
  assert.notDeepEqual(a.choice.cascade, b.choice.cascade); assert.notEqual(a.routerSha, b.routerSha);
  for (const [what, opts] of [['classOf', { classOf: m => (m === 'agent-O' ? 'workflow' : classOf(m)) }], ['kindOf', { kindOf: m => (m === 'agent-H+proc' ? 'built' : modeInfo(m).kind) }],
    ['cascades', { cascades: CASCADES.slice(1) }], ['no cascades', { cascades: [] }], ['checkpointAfter', { checkpointAfter: 9 }], ['acceptDelta', { acceptDelta: 0.05 }], ['tasksPerJob', { tasksPerJob: 6 }]]) {
    assert.notEqual(routerSha(fitNeedRouter(P.items, { modes: V1_MODES, ...opts })).sha, s0, what);
  }
  // The same values through another function give the same sha: what is hashed is the resolved map, not the code of a closure.
  assert.equal(routerSha(fitNeedRouter(P.items, { modes: V1_MODES, classOf: m => classOf(m), kindOf: m => modeInfo(m).kind })).sha, s0);
  assert.deepEqual(base.fitted.classes['construct-H'], { class: 'workflow', kind: 'built' });
  assert.deepEqual(base.fitted.classes['agent-O'], { class: 'no-workflow', kind: 'none' });
  assert.deepEqual(base.fitted.checkpoint, { afterTask: 4, from: 'construct-H', switchTo: 'agent-H' });
  assert.deepEqual(base.fitted.cascades.map(x => x.id), CASCADES.map(x => x.id));
  // Decisions read the frozen map: a classOf that changes its answers after the fit changes nothing.
  let flip = false;
  const R = fitNeedRouter(P.items, { modes: V1_MODES, classOf: m => (flip ? 'workflow' : classOf(m)) }), before = R.decide(job(SMALL), HEADLINE);
  flip = true;
  assert.deepEqual(R.decide(job(SMALL), HEADLINE), before);
  assert.throws(() => fitNeedRouter(P.items, { modes: V1_MODES, classOf: () => 'maybe' }), /classOf\(direct-H\) must be workflow or no-workflow/);
  assert.throws(() => fitNeedRouter(P.items, { modes: V1_MODES, kindOf: () => 'deluxe' }), /kindOf/);
  assert.throws(() => fitNeedRouter(P.items, { modes: V1_MODES, checkpointAfter: 0 }), /checkpointAfter/);
  assert.throws(() => fitNeedRouter(P.items, { modes: V1_MODES, cascades: [{ id: 'x' }] }), /cascades must be/);
  // Code shas: a child process edits router.mjs "on disk" (fs.readFileSync patched) after importing card.mjs and before
  // its first card. codeShas() still names the loaded code, and decisionCard refuses to write a card.
  const card = new URL('../card.mjs', import.meta.url).href, router = new URL('../router.mjs', import.meta.url).href;
  const script = `
    import fs from 'node:fs';
    import { createHash } from 'node:crypto';
    import { syncBuiltinESMExports } from 'node:module';
    import { codeShas, decisionCard } from ${JSON.stringify(card)};
    import { fitNeedRouter } from ${JSON.stringify(router)};
    const real = fs.readFileSync, loaded = createHash('sha256').update(real(new URL(${JSON.stringify(router)}))).digest('hex');
    fs.readFileSync = function (p, ...rest) { const x = real.call(this, p, ...rest); return String(p).endsWith('/router.mjs') ? Buffer.concat([Buffer.from(x), Buffer.from('\\n// edited after import\\n')]) : x; };
    syncBuiltinESMExports();
    const R = fitNeedRouter([{ id: 'a', cluster: 'A', features: { logInputTokens: 2, maxListLength: 0 }, stats: { 'agent-H': { s: 0.5, q: 0.1, c: 0.1, B: 0 } }, labels: {} }]);
    let err = null; try { decisionCard(R, { id: 'x', features: { logInputTokens: 2, maxListLength: 0 } }); } catch (e) { err = e.message; }
    process.stdout.write(JSON.stringify({ loadedSha: codeShas()['router.mjs'] === loaded, err }));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60000 });
  assert.equal(out.status, 0, out.stderr);
  const r = JSON.parse(out.stdout);
  assert.equal(r.loadedSha, true, 'codeShas must be the shas of the code loaded, not of a later edit');
  assert.match(r.err ?? '', /router sources changed on disk since they were loaded \(router\.mjs\)/);
  // In this process nothing changed: cards are written and their code part is the load-time shas.
  assert.deepEqual(decisionCard(base, job(SMALL), HEADLINE).routerShaParts.code, { ...codeShas() });
  assert.equal(codeShas(), codeShas());
});

// ------------------------------------------------------------------------------------------------------------- D5
test('D5 a plain cell\'s W is honoured (W/V from W when wOverV is absent); a W, wOverV or key that disagree is refused', () => {
  const R = fitNeedRouter(P.items, { modes: V1_MODES }), j = job(SMALL);
  // The reviewer's case: { V: 1, N: 10, W: 0 } was decided, and carded, as W = V.
  assert.equal(R.decide(j, { V: 1, N: 10, W: 0 }).cell.key, 'V=1 N=10 W=0V');
  assert.deepEqual(R.decide(j, { V: 1, N: 10, W: 0 }), R.decide(j, makeCell(1, 10, 0)));
  const card = decisionCard(R, j, { V: 1, N: 10, W: 0 });
  assert.equal(card.cell.key, cellKey({ V: 1, N: 10, W: 0 })); assert.equal(card.cell.W, 0); assert.equal(card.job.W, 0); assert.equal(card.cell.wOverV, 0);
  assert.deepEqual(validateCard(card), { ok: true, problems: [] });
  for (const x of Object.values(card.pred)) close(x.EU, x.p - x.c - x.F / 10);   // no silent-miss term at W = 0
  for (const m of probePlan(R, j, { V: 1, N: 100, W: 0 }).modes) assert.equal(m.wq, 0);
  assert.equal(resolveCell({ V: 2, N: 10, W: 20 }).key, makeCell(2, 10, 10).key);
  assert.equal(resolveCell({ V: 1, N: 10 }).key, HEADLINE.key);                 // no W given: W = V, the headline
  assert.equal(resolveCell({ V: 1, N: 10, W: 1, wOverV: 1 }).key, HEADLINE.key);
  assert.equal(resolveCell(HEADLINE).key, HEADLINE.key);
  assert.throws(() => resolveCell({ V: 1, N: 10, W: 0, wOverV: 1 }), /disagree/);
  assert.throws(() => resolveCell({ V: 1, N: 10, key: 'V=1 N=10 W=0V' }), /does not name its V, N and W/);
  assert.throws(() => resolveCell({ ...HEADLINE, W: 0 }), /disagree/);
  assert.throws(() => resolveCell({ V: 0, N: 10 }), /V > 0/);
  assert.throws(() => resolveCell({ V: 1, N: 10, W: -1 }), /W must be a finite number/);
  assert.throws(() => resolveCell(null), /cell must be an object/);
  assert.throws(() => R.decide(j, { V: 1, N: 10, W: 0, wOverV: 1 }), /disagree/);
  assert.throws(() => decisionCard(R, j, { V: 1, N: 10, W: 0, wOverV: 1 }), /disagree/);
});

// ------------------------------------------------------------------------------------------------------------- D6
const N_GRID = [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 100, 300, 1000];
test('D6 monotonicity: the router\'s default choice keeps a chosen workflow at every larger N; across V it is p − (W/V)·q, not p, that never falls', () => {
  // N: random v1-shaped mode sets (every mode with a build cost is a workflow mode), the router's default rule (delta 0).
  const r = rng(23);
  let checked = 0;
  for (let t = 0; t < 4000; t++) {
    const pred = realisticModes(r), w = [0, 1, 10][t % 3];
    for (const V of [0.1, 0.5, 1, 2, 10]) {
      let seen = null;
      for (const N of N_GRID) {
        const m = decideModes(pred, makeCell(V, N, w), { delta: 0 }).mode, wf = classOf(m) === 'workflow';
        if (seen !== null) { assert.ok(wf, `workflow at N ${seen}, ${m} at N ${N} (V ${V}, W ${w}V)`); checked += 1; }
        if (wf && seen === null) seen = N;
      }
    }
  }
  assert.ok(checked > 5000, `only ${checked} continuations checked`);
  // The pinned δ-tie counterexample (workflow at N = 1, no workflow at N = 2) is monotone under the router's default.
  const nm = [0, 1, 2, 3].map(i => item(`n${i}`, `C${i}`, 2 + i, Object.fromEntries(NON_MONOTONE_N), i < 2 ? 'no-workflow' : 'workflow'));
  const R = fitNeedRouter(nm, { modes: [...NON_MONOTONE_N.keys()] });
  const x = { id: 'x', features: { logInputTokens: 2.5, maxListLength: 0 } };
  const classes = N_GRID.map(N => R.decide(x, makeCell(1, N, 0)).class), first = classes.indexOf('workflow');
  assert.ok(first >= 0 && classes.slice(first).every(c => c === 'workflow'), classes.join(' '));
  assert.equal(R.decide(x, makeCell(1, 1, 0)).mode, 'agent-O'); assert.equal(R.decide(x, makeCell(1, 2, 0)).mode, 'construct-H');
  const Rd = fitNeedRouter(nm, { modes: [...NON_MONOTONE_N.keys()], delta: DELTA });
  assert.deepEqual([1, 2].map(N => Rd.decide(x, makeCell(1, N, 0)).class), ['workflow', 'no-workflow'], 'the δ-tie option keeps the known violation');
  // V, at the headline W = V: the reviewer's pair. A correct router picks p 0.7 at V = $1 and p 0.6 at V = $10, so raw
  // realised p falls; the success-equivalent value p − (W/V)·q rises (0.4 -> 0.6), as the theorem says.
  const pair = new Map([['loud', st(0.7, 0.3, 0.01)], ['careful', st(0.6, 0, 0.5)]]);
  const at = V => { const c = makeCell(V, 10, 1), d = decideModes(pair, c, { delta: 0 }), s = pair.get(d.mode); return { mode: d.mode, p: s.s, value: s.s - c.wOverV * s.q, u: d.U }; };
  const lo = at(1), hi = at(10);
  assert.equal(lo.mode, 'loud'); assert.equal(hi.mode, 'careful');
  close(lo.u.get('loud'), 0.39); close(lo.u.get('careful'), 0.1); close(hi.u.get('loud'), 0.399); close(hi.u.get('careful'), 0.55);
  assert.ok(hi.p < lo.p, 'raw p falls: a slider check on raw p (F7) would trip on a correct router');
  assert.ok(hi.value > lo.value, 'p − (W/V)·q rises');
  // At W = 0 the same router never lowers p across V.
  const w0 = V => pair.get(decideModes(pair, makeCell(V, 10, 0), { delta: 0 }).mode).s;
  assert.ok(w0(10) >= w0(1));
});

// ------------------------------------------------------------------------------------------------------------- D7
test('D7 H0 below the PREREG §6 fitting minimum is not fitted: structure unknown, abstain rule-unfitted, one pooled leaf, never a silent "no workflow"', () => {
  const S = tok => ({ 'direct-H': st(tok > 4 ? 0.2 : 0.9, 0.1, 0.02), 'agent-H': st(0.6, 0.1, 0.12), 'construct-H': st(tok > 4 ? 0.9 : 0.8, 0.05, 0.02, 1) });
  const mk = (rows) => rows.map(([id, cluster, tok, label, confident = true]) => item(id, cluster, tok, S(tok), label, confident));
  const x = { id: 'x', features: { logInputTokens: 5, maxListLength: 0 } };
  for (const [what, rows, why] of [
    ['no confident label', [['a', 'A', 2, 'no-workflow', false], ['b', 'B', 3, 'no-workflow', false], ['c', 'C', 5, 'workflow', false], ['d', 'D', 6, 'workflow', false]], /0 confident positive\(s\) < 2/],
    ['one class only', [['a', 'A', 2, 'no-workflow'], ['b', 'B', 3, 'no-workflow'], ['c', 'C', 5, 'no-workflow'], ['d', 'D', 6, 'no-workflow']], /0 confident positive\(s\) < 2/],
    ['one positive', [['a', 'A', 2, 'no-workflow'], ['b', 'B', 3, 'no-workflow'], ['c', 'C', 5, 'workflow'], ['d', 'D', 6, 'either', false]], /1 confident positive\(s\) < 2/],
    ['positives in one cluster', [['a', 'A', 2, 'no-workflow'], ['b', 'B', 3, 'no-workflow'], ['c', 'C', 5, 'workflow'], ['d', 'C', 6, 'workflow']], /positives in 1 cluster\(s\) < 2/],
  ]) {
    const R = fitNeedRouter(mk(rows), { modes: ['direct-H', 'agent-H', 'construct-H'] }), d = R.decide(x, HEADLINE);
    assert.equal(R.rule.fitted, false, what); assert.match(R.rule.why, why, what); assert.equal(R.fitted.rule.fitted, false);
    assert.equal(d.structure.intrinsic, null, what); assert.match(d.structure.reason, /^rule-unfitted: H0 not fitted/);
    assert.equal(d.needsWorkflow, null, what);
    assert.match(d.abstain.reasons[0], /^rule-unfitted: H0 not fitted/); assert.equal(d.abstain.fallback, 'pooled'); assert.equal(d.source.leaf, 'pooled');
    assert.deepEqual(Object.keys(R.leafTable([HEADLINE])), ['pooled'], 'one leaf');
    // The single leaf's mode is SBS-train's: the exact best mean TRAIN utility.
    const items = mk(rows).map(trainItem), e = ['direct-H', 'agent-H', 'construct-H'].map(m => ({ mode: m, u: items.reduce((a, it) => a + needUtility(it.statsMap.get(m), HEADLINE), 0) / items.length, usd: items.reduce((a, it) => a + perTaskUsd(it.statsMap.get(m), HEADLINE), 0) / items.length }));
    assert.equal(d.mode, rankModes(e)[0], what);
    // A typed requirement still forces the workflow class; the card validates and says why.
    assert.equal(R.decide({ ...x, requirements: ['schedule'] }, HEADLINE).needsWorkflow, true);
    const card = decisionCard(R, x, HEADLINE);
    assert.deepEqual(validateCard(card), { ok: true, problems: [] }); assert.equal(card.structure.intrinsic, null); assert.equal(card.needsWorkflow, null);
  }
  // At the minimum the rule is fitted as before (and the planted world is well above it).
  const ok = fitNeedRouter(mk([['a', 'A', 2, 'no-workflow'], ['b', 'B', 3, 'no-workflow'], ['c', 'C', 5, 'workflow'], ['d', 'D', 6, 'workflow']]));
  assert.equal(ok.rule.fitted, true); close(ok.rule.thresholds.logInputTokens, 4); assert.equal(ok.decide(x, HEADLINE).needsWorkflow, true);
  assert.equal(fitNeedRouter(P.items, { modes: V1_MODES }).rule.fitted, true);
  // LOCO: a fold whose training part is below the minimum is undefined, listed and excluded (never scored at θ = +∞).
  const loco = ruleLoco(mk([['a', 'A', 2, 'no-workflow'], ['b', 'B', 3, 'no-workflow'], ['c', 'C', 5, 'workflow'], ['d', 'D', 6, 'workflow'], ['e', 'E', 2.5, 'no-workflow']]).map(trainItem));
  assert.equal(loco.folds.length, 5); assert.equal(loco.undefined, 2); assert.equal(loco.defined, 3);
  assert.deepEqual(loco.folds.filter(f => !f.defined).map(f => f.heldOutCluster), ['C', 'D']);
  assert.equal(loco.confident, 3); assert.equal(loco.balancedAccuracy, 1);
  // The minimum is prereg-rules.mjs thetaFitStatus, case for case.
  const r = rng(7);
  for (let t = 0; t < 2000; t++) {
    const n = Math.floor(r() * 8), xs = Array.from({ length: n }, (_, i) => ({ job: `j${i}`, cluster: `C${Math.floor(r() * 3)}`, workflow: r() < 0.5 }));
    assert.deepEqual(ruleFitStatus(xs), thetaFitStatus(xs));
  }
  assert.deepEqual({ ...RULE_MINIMUM }, { minPos: 2, minPosClusters: 2, minNeg: 2, minNegClusters: 2 });
});

// ------------------------------------------------------------------------------------------------------------- D8
test('D8 the router\'s default choice is the exact best, the SBS-train yardstick\'s own rule; δ ties stay an option and A is still reported', () => {
  // Random mode sets: the default choice is rankModes' first (the yardstick's tie rule), and it sits in the δ set A.
  const r = rng(31);
  for (let t = 0; t < 3000; t++) {
    const pred = t % 2 ? realisticModes(r) : generalModes(r), c = makeCell([0.1, 1, 10][t % 3], [1, 10, 100][(t >> 1) % 3], [0, 1, 10][(t >> 2) % 3]);
    const d = decideModes(pred, c, { delta: 0, acceptDelta: DELTA }), e = [...pred].map(([mode, s]) => ({ mode, u: needUtility(s, c), usd: perTaskUsd(s, c) }));
    assert.equal(d.mode, rankModes(e)[0]); assert.equal(d.tie, false); assert.ok(d.acceptable.includes(d.mode));
    const top = Math.max(...e.map(x => x.u));
    assert.deepEqual([...d.acceptable].sort(), e.filter(x => x.u >= top - DELTA - 1e-12).map(x => x.mode).sort());
  }
  // A leaf whose best mode is SBS-train's: the default router takes it (Δ = 0 against SBS-train); δ ties gave away 0.01.
  const stats = { 'agent-H': st(0.66, 0.02, 0.1), 'direct-H': st(0.6, 0.04, 0.03) };   // u 0.54 against 0.53 at the headline
  const train = [['a', 'A', 2, 'no-workflow'], ['b', 'B', 3, 'no-workflow'], ['c', 'C', 5, 'workflow'], ['d', 'D', 6, 'workflow']].map(([id, cl, tok, l]) => item(id, cl, tok, stats, l));
  const x = { id: 'x', features: { logInputTokens: 2.5, maxListLength: 0 } };
  const R = fitNeedRouter(train), Rd = fitNeedRouter(train, { delta: DELTA });
  const sbs = rankModes(Object.entries(stats).map(([mode, s]) => ({ mode, u: needUtility(s, HEADLINE), usd: perTaskUsd(s, HEADLINE) })))[0];
  assert.equal(sbs, 'agent-H'); assert.equal(R.decide(x, HEADLINE).mode, sbs); assert.equal(Rd.decide(x, HEADLINE).mode, 'direct-H');
  close(needUtility(stats[R.decide(x, HEADLINE).mode], HEADLINE) - needUtility(stats[sbs], HEADLINE), 0);
  close(needUtility(stats[Rd.decide(x, HEADLINE).mode], HEADLINE) - needUtility(stats[sbs], HEADLINE), -0.01, 1e-9);
  const card = decisionCard(R, x, HEADLINE);
  assert.equal(card.choice.rule, 'exact: the best predicted utility, ties to the cheaper'); assert.equal(card.choice.delta, 0); assert.equal(card.choice.acceptDelta, DELTA);
  assert.deepEqual(card.acceptable, ['agent-H', 'direct-H']); assert.equal(card.choice.tie, false);
  assert.match(decisionCard(Rd, x, HEADLINE).choice.rule, /^δ ties/);
  assert.equal(fitNeedRouter(P.items, { modes: V1_MODES }).delta, 0);
  assert.throws(() => fitNeedRouter(train, { acceptDelta: -1 }), /acceptDelta/);
});

// ------------------------------------------------------------------------------------------------------------- D9
test('D9 kNN needsWorkflow is read at the intrinsic-need cell whatever the slider; a probe is NR-probe on the leaf stage only', () => {
  const K = fitNeedRouter(P.items, { modes: V1_MODES, stage: 'knn' }), L = fitNeedRouter(P.items, { modes: V1_MODES });
  let moved = 0;
  for (const j of P.EVAL) {
    const v = P.view(j), want = K.decide(v, N1).class === 'workflow';
    if (new Set([0.1, 1, 10].map(V => K.decide(v, makeCell(V, 1, 1)).class)).size > 1) moved += 1;   // the old reading moved with V here
    for (const c of [HEADLINE, makeCell(0.1, 1, 1), makeCell(10, 1, 1), makeCell(0.1, 10, 1), makeCell(10, 100, 10), makeCell(1, 1, 0)]) assert.equal(K.decide(v, c).needsWorkflow, want, `${j} ${c.key}`);
  }
  assert.ok(moved >= 3, `${moved} jobs whose N = 1 class moves with V`);
  assert.equal(K.fitted.ruleCell, N1.key);
  // A probe on the kNN stage is refused (decide, card); the card label follows the probe and the stage.
  const probe = { observations: { 'direct-H': { passes: 1, n: 2 } }, costUsd: 0.05 };
  assert.throws(() => K.decide(P.view(SMALL), HEADLINE, { probe }), /kNN stage takes no probe/);
  assert.throws(() => decisionCard(K, job(SMALL), HEADLINE, { probe }), /kNN stage takes no probe/);
  assert.equal(decisionCard(K, job(SMALL), HEADLINE).policy, 'NR-knn');
  assert.equal(decisionCard(L, job(SMALL), HEADLINE, { probe }).policy, 'NR-probe');
  assert.throws(() => decisionCard(L, job(SMALL), HEADLINE, { probe, policy: 'NR-static' }), /must be labelled NR-probe/);
  assert.throws(() => decisionCard(L, job(SMALL), HEADLINE, { policy: 'NR-probe' }), /needs the probe it ran/);
  assert.throws(() => decisionCard(L, job(SMALL), HEADLINE, { policy: 'NR-knn' }), /NR-knn is the kNN stage/);
  assert.throws(() => decisionCard(K, job(SMALL), HEADLINE, { policy: 'NR-static' }), /NR-static is the leaf stage/);
  // validateCard checks the same on a card edited after the fact.
  const base = decisionCard(L, job(SMALL), HEADLINE), knn = decisionCard(K, job(SMALL), HEADLINE), probed = decisionCard(L, job(SMALL), HEADLINE, { probe });
  for (const [what, bad, re] of [
    ['probe relabelled', { ...structuredClone(probed), policy: 'NR-static' }, /must be labelled NR-probe/],
    ['NR-probe without a probe', { ...structuredClone(base), policy: 'NR-probe' }, /needs the probe it ran/],
    ['kNN card labelled static', { ...structuredClone(knn), policy: 'NR-static' }, /NR-static is the leaf stage/],
    ['probe on a kNN card', { ...structuredClone(knn), probe: structuredClone(probed.probe), policy: 'NR-probe', routingCostUsd: 0.05 }, /kNN stage takes no probe/],
  ]) { const v = validateCard(bad); assert.equal(v.ok, false, what); assert.ok(v.problems.some(p => re.test(p)), `${what}: ${v.problems.join('; ')}`); }
});
