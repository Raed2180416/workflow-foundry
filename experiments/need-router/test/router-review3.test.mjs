// Regression tests for the third adversarial review of the v1 router and its decision card (2026-10-15), one test per
// fix: R1 a cascade attached to a pure-mode choice; R2 the probe gate pricing single-mode plans instead of the
// preregistered bundle, and k capped by H; R3 probe observations with no provenance (any mode, any draws, any passes);
// R4 two lists of frozen files; R5 H0's tie rule (both outcomes pinned); R6 the kNN stage imputing a missing feature;
// R7 routerSha missing features.mjs, the probe prior and the mapping; R9 two probe priors; R10 negative derived stats
// clamped; R11 an empty probe accepted. $0, synthetic and planted data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  fitNeedRouter, fitStructuralRule, intrinsicOf, trainItem, probeRecord, probeProblems, probeFromRows, verifyProbeRows, probePriors, leafPrior, itemsFromContext,
  nrStaticPolicy, FROZEN_FILES, PROBEABLE, PROBE_BUNDLE, PROBE_SIGNALS, PROBE_MAPPING, THETA_TIES,
} from '../router.mjs';
import { decisionCard, validateCard, probePlan, routerSha, codeShas, CODE_FILES } from '../card.mjs';
import { bundleValue, probeValue, betaBinomial } from '../voi.mjs';
import { ROUTER_FILES, makeContext, publicView } from '../evaluate.mjs';
import { HEADLINE, CASCADES, makeCell, withCascades, needLabels, GRID } from '../metrics.mjs';
import { needsWorkflow as plantedNeed, plantedWorld } from './worlds.mjs';
import { plantedRouter, V1_MODES, probeFor } from './router-fixtures.mjs';

const P = plantedRouter();
const job = (j, over = {}) => { const v = P.view(j); return { id: v.id, features: v.features, requirements: v.requirements, verifier: v.verifier, modes: v.modes, ...over }; };
const SMALL = P.EVAL.find(j => !plantedNeed(P.W.meta[j].features)), BIG = P.EVAL.find(j => plantedNeed(P.W.meta[j].features));
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const st = (s, q, c, B = 0) => ({ s, q, c, B });
const item = (id, cluster, tok, stats, label) => ({ id, cluster, features: { logInputTokens: tok, maxListLength: 0 }, stats, label: () => ({ label, confident: true }) });

// ------------------------------------------------------------------------------------------------------------- R1
test('R1 a cascade rides the choice only when the chosen mode is the cascade, priced from its own rows; a pure choice runs pure', () => {
  // The reviewer's case: a TRAIN leaf {c, d} where pure construct-H is best. It was chosen with cascade
  // construct-H->agent-H attached while the card priced pure construct-H (usdPerTask 0.275 = c 0.05 + B 2.25/10).
  const casc = st(0.97, 0, 0.05 + 0.05 * 0.12, 2.25);   // the derived rows: 5% fall back to agent-H and pay for it
  const small = { 'direct-H': st(0.9, 0.05, 0.02), 'agent-H': st(0.9, 0.05, 0.12), 'construct-H': st(0.8, 0.05, 0.05, 2.25), 'construct-H->agent-H': st(0.82, 0.05, 0.06, 2.25) };
  const big = { 'direct-H': st(0.1, 0.5, 0.03), 'agent-H': st(0.6, 0.1, 0.12), 'construct-H': st(0.95, 0, 0.05, 2.25), 'construct-H->agent-H': casc };
  const train = [item('a', 'A', 2, small, 'no-workflow'), item('b', 'B', 3, small, 'no-workflow'), item('c', 'C', 5, big, 'workflow'), item('d', 'D', 6, big, 'workflow')];
  const x = { id: 'x', features: { logInputTokens: 5.5, maxListLength: 0 } };
  // Pure modes only in the order (as evaluate's fixed MODES list): construct-H is chosen and runs pure.
  const pure = fitNeedRouter(train, { modes: ['direct-H', 'agent-H', 'construct-H'] }), dp = pure.decide(x, HEADLINE), cp = decisionCard(pure, x, HEADLINE);
  assert.equal(dp.mode, 'construct-H'); assert.equal(dp.cascade, null); assert.equal(dp.checkpoint, null);
  assert.equal(cp.choice.cascade, null); assert.equal(cp.choice.checkpoint, null); close(cp.pred['construct-H'].usdPerTask, 0.275);
  // The cascade id in the order (evaluate's context carries the derived cascade rows): it is priced from its own rows and
  // wins here; the card's cascade, checkpoint and prediction are all the cascade's, so the E2E lane runs what was priced.
  const both = fitNeedRouter(train), d = both.decide(x, HEADLINE), card = decisionCard(both, x, HEADLINE);
  assert.ok(both.order.includes('construct-H->agent-H'));
  assert.equal(d.mode, 'construct-H->agent-H'); assert.equal(card.class, 'workflow'); assert.equal(card.kind, 'built');
  const spec = CASCADES.find(s => s.id === 'construct-H->agent-H');
  assert.deepEqual(card.choice.cascade, { id: spec.id, primary: spec.primary, fallback: spec.fallback, on: [...spec.on] });
  assert.deepEqual(card.choice.checkpoint, { afterTask: 4, switchTo: 'agent-H', when: 'at least half of the tasks so far fell back' });
  close(card.pred['construct-H->agent-H'].usdPerTask, casc.c + casc.B / HEADLINE.N); close(card.pred['construct-H->agent-H'].p, 0.97);
  assert.deepEqual(validateCard(card), { ok: true, problems: [] });
  // A cascade whose fallback the job cannot run is never on the menu: the pure primary runs pure.
  const noAgent = both.decide({ ...x, modes: ['direct-H', 'construct-H'] }, HEADLINE);
  assert.equal(noAgent.mode, 'construct-H'); assert.equal(noAgent.cascade, null); assert.equal(noAgent.checkpoint, null);
  // Inside evaluate's context (cascades derived from the paired rows, withCascades), every decision's cascade is its mode's.
  const W = plantedWorld({ train: 4, heldout: 3, seed: 5 }), table = withCascades(W.rows, W.builds), labels = needLabels(table, { cells: [HEADLINE], reps: 60, seed: 1 });
  const TRAIN = table.jobs.filter(j => W.meta[j].split === 'train'), EVAL = table.jobs.filter(j => W.meta[j].split === 'heldout');
  const modes = table.modes.filter(m => !m.startsWith('build') && !m.startsWith('ref'));
  assert.ok(modes.some(m => m.includes('->')), modes.join(', '));
  const ctx = makeContext(labels, TRAIN, W.meta, { modes }), ch = nrStaticPolicy().fit(ctx);
  for (const j of EVAL) for (const c of [HEADLINE, makeCell(1, 100, 1), makeCell(10, 1, 0)]) {
    const view = publicView(j, W.meta[j], labels.modesOf(j).filter(m => modes.includes(m))), dd = ch.router.decide(view, c);
    assert.equal(dd.cascade === null, !dd.mode.includes('->'), `${j} ${c.key}: ${dd.mode} with cascade ${dd.cascade?.id}`);
    if (dd.cascade) assert.equal(dd.cascade.id, dd.mode);
    assert.equal(ch(view, c).mode, dd.mode);
  }
});

// ------------------------------------------------------------------------------------------------------------- R2
test('R2 the probe gate prices the preregistered bundle (two direct-H draws, one agent-H run) jointly; an example probe is not capped by H', () => {
  // voi.mjs bundleValue: with one mode it is probeValue exactly; the joint outcome probabilities sum to 1.
  const modes = [{ id: 'd', a: 3, b: 4, c: 0.03, wq: 0.2, F: 0 }, { id: 'a', a: 5, b: 3, c: 0.1, wq: 0.05, F: 0 }, { id: 'b', a: 2, b: 1, c: 0.02, F: 1.5 }];
  for (const [j, k] of [['d', 1], ['d', 2], ['a', 1], ['b', 3]]) for (const H of [1, 10, 100]) {
    const one = bundleValue(modes, { [j]: k }, { V: 1, H }), pv = probeValue(modes, j, k, { V: 1, H });
    close(one.evsi, pv.evsi, 1e-9); close(one.cost, pv.cost); close(one.net, pv.net, 1e-9);
  }
  const B = bundleValue(modes, { d: 2, a: 1 }, { V: 1, H: 50, cVerify: 0.01 });
  assert.equal(B.after.length, 3 * 2); close(B.after.reduce((s, x) => s + x.prob, 0), 1, 1e-9); assert.ok(B.evsi >= -1e-9);
  close(B.cost, 2 * (0.03 + 0.01) + (0.1 + 0.01)); assert.equal(B.k, 3);
  // The joint EVSI is the expectation over the product of the two Beta-Binomials (independent priors).
  const pd = betaBinomial(2, 3, 4), pa = betaBinomial(1, 5, 3);
  for (const o of B.after) close(o.prob, pd[o.s.d] * pa[o.s.a], 1e-12);
  assert.throws(() => bundleValue(modes, {}, { V: 1, H: 5 }), /at least one drawn mode/);
  assert.throws(() => bundleValue(modes, { d: 0 }, { V: 1, H: 5 }), /integers >= 1/);
  assert.throws(() => bundleValue(modes, { d: 2, a: 1 }, { V: 1, H: 2, deliverable: true }), /sum k <= H/);
  // The reviewer's case: one TRAIN job (direct-H $0.03, agent-H $0.10), V = $1, N = 100. The gate recommended two agent-H
  // runs priced $0.20, which label-run never draws; the bundle it does draw costs 2 × 0.03 + 0.10 = $0.16.
  const x = { id: 'x', features: { logInputTokens: 2, maxListLength: 0 } };
  const R = fitNeedRouter([{ id: 'a', cluster: 'A', features: x.features, stats: { 'direct-H': st(0.5, 0.3, 0.03), 'agent-H': st(0.6, 0.1, 0.1) }, labels: {} }], { modes: ['direct-H', 'agent-H'], tasksPerJob: 1 });
  for (const N of [1, 10, 100]) {
    const plan = probePlan(R, x, makeCell(1, N, 1));
    close(plan.cost, 0.16); assert.deepEqual(plan.bundle.draws, { ...PROBE_BUNDLE.draws });
    assert.ok(plan.probe === null || (plan.probe.id === PROBE_BUNDLE.id && plan.net > 0), JSON.stringify(plan.probe));
    assert.ok(!('j' in (plan.probe ?? {})), 'the gate is never a single-mode plan');
    // Example probes are not bounded by the horizon: two-draw single-mode plans are priced (a sensitivity) even at N = 1.
    assert.deepEqual([...new Set(plan.plans.map(p => p.k))].sort(), [1, 2]);
  }
  assert.equal(probePlan(R, x, makeCell(1, 100, 1)).probe?.id, PROBE_BUNDLE.id);
  // A mode the job cannot run is not drawn: a masked direct-H leaves the agent-H run only.
  const masked = probePlan(R, { ...x, modes: ['agent-H'] }, makeCell(1, 100, 1));
  assert.deepEqual(masked.bundle.draws, { 'agent-H': 1 }); close(masked.cost, 0.1);
  assert.throws(() => probePlan(R, x, HEADLINE, { probeable: ['construct-H'] }), /not a probeable mode/);
});

// ------------------------------------------------------------------------------------------------------------- R3
test('R3 a probe must name its probeable modes, the bundle\'s draws, its signal kind and its probe rows; the card carries them; rows are checkable', () => {
  const R = fitNeedRouter(P.items, { modes: V1_MODES }), j = job(SMALL), id = j.id;
  // The reviewer's case: a construct-H "probe" with oracle-looking passes moved construct-H's p to 0.871. Refused.
  assert.throws(() => R.decide(j, HEADLINE, { probe: { observations: { 'construct-H': { passes: 5, n: 5 } }, costUsd: 0.01 } }), /not a probeable mode/);
  const bad = [
    ['ceiling arm', { 'build-O': { passes: 1, n: 1, signal: 'schemaValid', rows: [`${id}|build-O|0`] } }, /not a probeable mode/],
    ['no signal', { 'direct-H': { passes: 1, n: 2, rows: [`${id}|direct-H|0`, `${id}|direct-H|1`] } }, /signal kind/],
    ['unknown signal', { 'direct-H': { passes: 1, n: 2, signal: 'oracle', rows: [`${id}|direct-H|0`, `${id}|direct-H|1`] } }, /signal kind/],
    ['no rows', { 'direct-H': { passes: 1, n: 2, signal: 'schemaValid' } }, /must name its probe rows/],
    ['too few rows', { 'direct-H': { passes: 1, n: 2, signal: 'schemaValid', rows: [`${id}|direct-H|0`] } }, /read 2 row\(s\), it names 1/],
    ['two agent-H runs', { 'agent-H': { passes: 2, n: 2, signal: 'schemaValid', rows: [`${id}|agent-H|0`, `${id}|agent-H|1`] } }, /exceed the preregistered bundle's 1/],
    ['three direct-H draws', { 'direct-H': { passes: 3, n: 3, signal: 'schemaValid', rows: [0, 1, 2].map(d => `${id}|direct-H|${d}`) } }, /exceed the preregistered bundle's 2/],
    ['a draw outside the bundle', { 'agent-H': { passes: 1, n: 1, signal: 'schemaValid', rows: [`${id}|agent-H|3`] } }, /outside the bundle's 1 draw/],
    ['row of another mode', { 'agent-H': { passes: 1, n: 1, signal: 'schemaValid', rows: [`${id}|direct-H|0`] } }, /names a direct-H row/],
    ['row of another job', { 'direct-H': { passes: 1, n: 1, signal: 'schemaValid', rows: ['other-job|direct-H|0'] } }, /not .*'s|rows are job other-job's/],
    ['duplicate row', { 'direct-H': { passes: 1, n: 2, signal: 'schemaValid', rows: [`${id}|direct-H|0`, `${id}|direct-H|0`] } }, /names a probe row twice/],
    ['agreement on agent-H', { 'agent-H': { passes: 1, n: 1, signal: 'agreement', rows: [`${id}|agent-H|0`, `${id}|agent-H|1`] } }, /reads direct-H only/],
    ['malformed row id', { 'direct-H': { passes: 1, n: 1, signal: 'schemaValid', rows: ['direct-H-0'] } }, /not a probe-row id/],
  ];
  for (const [what, observations, re] of bad) assert.throws(() => R.decide(j, HEADLINE, { probe: { observations, costUsd: 0.1 } }), re, what);
  assert.throws(() => R.decide(j, HEADLINE, { probe: { ...probeFor(id, { 'direct-H': [1, 2] }, 0.1), k: 4 } }), /probe\.k must be an integer in \[max\(1, rows drawn 2\), 3\]/);
  // A valid probe: the card carries its bundle, signal kinds and rows; validateCard applies the same rules to a card edited later.
  const pr = probeFor(id, { 'direct-H': [1, 1, 'agreement'], 'agent-H': [1, 1] }, 0.16);
  const card = decisionCard(R, j, HEADLINE, { probe: pr });
  assert.deepEqual(card.probe.observations, { 'agent-H': { passes: 1, n: 1, signal: 'schemaValid', rows: [`${id}|agent-H|0`] }, 'direct-H': { passes: 1, n: 1, signal: 'agreement', rows: [`${id}|direct-H|0`, `${id}|direct-H|1`] } });
  assert.equal(card.probe.bundle, PROBE_BUNDLE.id); assert.equal(card.probe.k, 3);
  assert.deepEqual(validateCard(card), { ok: true, problems: [] });
  const tamper = f => { const c = structuredClone(card); f(c); return validateCard(c); };
  assert.ok(tamper(c => { c.probe.observations['agent-H'].rows = [`${id}|agent-H|0`, `${id}|agent-H|1`]; c.probe.observations['agent-H'].n = 2; }).problems.some(p => /exceed the preregistered bundle/.test(p)));
  assert.ok(tamper(c => { c.probe.observations['construct-H'] = { passes: 1, n: 1, signal: 'schemaValid', rows: [`${id}|construct-H|0`] }; }).problems.some(p => /not a probeable mode/.test(p)));
  assert.ok(tamper(c => { delete c.probe.observations['agent-H']; }).problems.some(p => /name different modes/.test(p)));
  assert.equal(tamper(c => { c.probe.modes = ['construct-H']; }).ok, false);
  assert.ok(tamper(c => { c.job.id = 'another-job'; }).problems.some(p => /probe rows are .*'s, not another-job's/.test(p)), 'a card\'s probe rows name its own job');
  assert.throws(() => decisionCard(R, { ...j, id: undefined }, HEADLINE, { probe: pr }), /needs the job id its probe rows name/);
  // probeFromRows reads label-run's need-probe-row/1 rows (deployable signals only); verifyProbeRows checks a card against them.
  const row = (mode, draw, extra = {}) => ({ schema: 'need-probe-row/1', job: id, mode, draw, delivered: true, schemaValid: true, deployableVerdict: 'pass', outputHash: `h${draw}`, usdReported: 0.03, usdRepriced: 0.028, usdImputed: 0, ...extra });
  const rows = [row('direct-H', 0, { outputHash: 'same' }), row('direct-H', 1, { outputHash: 'same' }), row('agent-H', 0, { schemaValid: false, deployableVerdict: 'fail', usdReported: 0.1, usdRepriced: 0.11 })];
  const built = probeFromRows(rows, { job: id, signals: { 'direct-H': 'agreement', 'agent-H': 'schemaValid' } });
  assert.deepEqual(built.observations, { 'direct-H': { passes: 1, n: 1, signal: 'agreement', rows: [`${id}|direct-H|0`, `${id}|direct-H|1`] }, 'agent-H': { passes: 0, n: 1, signal: 'schemaValid', rows: [`${id}|agent-H|0`] } });
  close(built.costUsd, 0.03 + 0.03 + 0.11); assert.equal(built.k, 3); assert.equal(built.disagree, false);
  const bc = decisionCard(R, j, HEADLINE, { probe: built });
  assert.deepEqual(verifyProbeRows(bc.probe, rows), { ok: true, problems: [] });
  assert.ok(verifyProbeRows({ ...bc.probe, observations: { ...bc.probe.observations, 'agent-H': { ...bc.probe.observations['agent-H'], passes: 1 } } }, rows).problems.some(p => /reads 0 pass\(es\)/.test(p)));
  assert.ok(verifyProbeRows(bc.probe, rows.slice(0, 2)).problems.some(p => /not in probes\.jsonl/.test(p)));
  assert.ok(verifyProbeRows({ ...bc.probe, costUsd: 0.05 }, rows).problems.some(p => /metered on its rows/.test(p)));
  assert.ok(verifyProbeRows(bc.probe, rows.map(r => ({ ...r, pass: true }))).problems.some(p => /oracle field/.test(p)));
  assert.throws(() => probeFromRows(rows.map(r => ({ ...r, score: 1 })), { job: id }), /oracle field\(s\) score/);
  assert.throws(() => probeFromRows([...rows, row('construct-H', 0)], { job: id }), /not a probeable mode/);
  assert.equal(probeFromRows([row('direct-H', 0), row('direct-H', 1)], { job: id }).disagree, true, 'two different direct-H answers disagree');
  // The pass-to-success mapping is part of the fitted router: another mapping, another routerSha.
  assert.deepEqual(R.fitted.probe.mapping, { id: PROBE_MAPPING.id, frozen: false });
  assert.notEqual(routerSha(fitNeedRouter(P.items, { modes: V1_MODES, probeMapping: { id: 'frozen-v1', frozen: true } })).sha, routerSha(R).sha);
  assert.throws(() => fitNeedRouter(P.items, { probeMapping: { id: '' } }), /probeMapping/);
  assert.deepEqual(Object.keys(PROBE_SIGNALS).sort(), ['agreement', 'deployableVerdict', 'schemaValid']);
  assert.deepEqual([...PROBEABLE], ['direct-H', 'agent-H']);
});

// ------------------------------------------------------------------------------------------------------------- R4
test('R4 one list of frozen files (PREREG §6 "Shas", seven): card.mjs CODE_FILES, evaluate.mjs ROUTER_FILES and router.mjs FROZEN_FILES agree', () => {
  assert.equal(CODE_FILES, FROZEN_FILES);
  assert.deepEqual([...ROUTER_FILES], [...FROZEN_FILES], 'evaluate.mjs seals the same files card.mjs hashes');
  const prereg = readFileSync(new URL('../../../research/need-router-20261014/PREREG-NEED-V1.md', import.meta.url), 'utf8');
  const shasRow = prereg.split('\n').find(l => /^\|\s*Shas\s*\|/.test(l));
  assert.ok(shasRow, 'PREREG §6 has a Shas row');
  assert.deepEqual([...new Set([...shasRow.matchAll(/`([a-z-]+\.mjs)`/g)].map(m => m[1]))].sort(), [...FROZEN_FILES].sort());
  const stages = JSON.parse(readFileSync(new URL('../../../research/need-router-20261014/prereg/stages.json', import.meta.url), 'utf8'));
  assert.deepEqual(stages.engineStamp.analysis.files.map(f => f.split('/').pop()).sort(), [...FROZEN_FILES].sort());
  assert.deepEqual(Object.keys(codeShas()), [...FROZEN_FILES]);
});

// ------------------------------------------------------------------------------------------------------------- R5
test('R5 H0\'s tie rule: PREREG §6 (lexicographic, the default) and DESIGN §3 (fewest calls) pinned on the planted world', () => {
  const items = P.items.map(trainItem), off = th => P.EVAL.filter(j => !!intrinsicOf(P.view(j).features, th).intrinsic !== plantedNeed(P.W.meta[j].features)).length;
  const pre = fitStructuralRule(items), few = fitStructuralRule(items, { tie: 'fewest-calls' });
  // PREREG §6 as written: θ = (4.705, 0.886), 9 TRAIN workflow calls, 4 of 24 held-out jobs off their planted class.
  close(pre.thresholds.logInputTokens, 4.7047, 1e-3); close(pre.thresholds.maxListLength, 0.8861, 1e-3);
  assert.equal(pre.workflowCalls, 9); assert.equal(off(pre.thresholds), 4); assert.equal(pre.tie, 'prereg');
  // DESIGN §3 ("ties go to the larger threshold (fewer workflow calls)"): θ = (4.207, 1.956), 8 calls, none off. Both fit
  // the confident TRAIN items perfectly: only the tie rule differs.
  close(few.thresholds.logInputTokens, 4.2074, 1e-3); close(few.thresholds.maxListLength, 1.9564, 1e-3);
  assert.equal(few.workflowCalls, 8); assert.equal(off(few.thresholds), 0); assert.equal(few.tie, 'fewest-calls');
  assert.equal(pre.trainBalancedAccuracy, 1); assert.equal(few.trainBalancedAccuracy, 1);
  // The router's default is PREREG's; the option carries into LOCO (each fold refits under the same tie) and routerSha.
  const Rp = fitNeedRouter(P.items, { modes: V1_MODES }), Rf = fitNeedRouter(P.items, { modes: V1_MODES, thetaTie: 'fewest-calls' });
  assert.deepEqual(Rp.rule.thresholds, pre.thresholds); assert.deepEqual(Rf.rule.thresholds, few.thresholds);
  assert.equal(Rp.loco.balancedAccuracy, 0.6875); assert.equal(Rf.loco.balancedAccuracy, 1); assert.deepEqual(Rf.loco.counts, { tp: 8, fn: 0, tn: 2, fp: 0 });
  assert.equal(Rp.fitted.rule.tie, 'prereg'); assert.equal(Rf.fitted.rule.tie, 'fewest-calls'); assert.notEqual(routerSha(Rp).sha, routerSha(Rf).sha);
  assert.deepEqual([...THETA_TIES], ['prereg', 'fewest-calls']);
  assert.throws(() => fitNeedRouter(P.items, { thetaTie: 'smallest' }), /thetaTie must be one of/);
  // Among equally few calls the larger thresholds win: two separable jobs keep θ at the upper midpoint.
  const two = [['a', 2, 'no-workflow'], ['b', 3, 'no-workflow'], ['c', 4, 'workflow'], ['d', 5, 'workflow']].map(([i, t, l]) => trainItem(item(i, i, t, { 'agent-H': st(0.5, 0, 0.1) }, l)));
  assert.equal(fitStructuralRule(two, { tie: 'fewest-calls' }).thresholds.logInputTokens, 3.5);
});

// ------------------------------------------------------------------------------------------------------------- R6
test('R6 the kNN stage abstains (structure-unknown, pooled stats) when a trusted feature it reads is missing; it never imputes the TRAIN mean', () => {
  const K = fitNeedRouter(P.items, { modes: V1_MODES, stage: 'knn' });
  // The reviewer's case: features { logInputTokens: 5.1 } only gave construct-H with abstain null.
  const d = K.decide({ id: 'x', features: { logInputTokens: 5.1 } }, HEADLINE);
  assert.ok(d.abstain, 'abstains'); assert.match(d.abstain.reasons[0], /^structure-unknown: kNN feature\(s\) .*maxListLength.* missing/); assert.equal(d.abstain.fallback, 'pooled');
  assert.equal(d.needsWorkflow, null); assert.equal(d.source.leaf, 'pooled'); assert.equal(d.source.neighbours, null);
  const pooled = fitNeedRouter(P.items, { modes: V1_MODES }).decide({ id: 'x', features: {} }, HEADLINE);
  assert.equal(d.mode, pooled.mode, 'the pooled TRAIN stats decide, as on the leaf stage');
  const card = decisionCard(K, { id: 'x', features: { logInputTokens: 5.1 } }, HEADLINE);
  assert.deepEqual(validateCard(card), { ok: true, problems: [] }); assert.equal(card.structure.neighbours, null); assert.equal(card.policy, 'NR-knn');
  // A typed requirement still forces the workflow class; a job with every feature is routed by its neighbours as before.
  assert.equal(K.decide({ id: 'x', features: { logInputTokens: 5.1 }, requirements: ['schedule'] }, HEADLINE).needsWorkflow, true);
  for (const j of P.EVAL.slice(0, 6)) { const full = K.decide(P.view(j), HEADLINE); assert.equal(full.abstain, null); assert.equal(full.source.neighbours.length, K.k); }
});

// ------------------------------------------------------------------------------------------------------------- R7
test('R7 routerSha names features.mjs, the probe prior kind, the mapping and the bundle: a features.mjs edit after load stops cards', () => {
  assert.ok(CODE_FILES.includes('features.mjs') && CODE_FILES.includes('evaluate.mjs'));
  const R = fitNeedRouter(P.items, { modes: V1_MODES });
  assert.deepEqual(R.fitted.probe, { prior: 'pooled-tasks', mapping: { id: PROBE_MAPPING.id, frozen: false }, bundle: { id: PROBE_BUNDLE.id, draws: { 'direct-H': 2, 'agent-H': 1 } }, probeable: ['direct-H', 'agent-H'], signals: Object.keys(PROBE_SIGNALS) });
  assert.notEqual(routerSha(fitNeedRouter(P.items, { modes: V1_MODES, probePrior: 'empirical-bayes' })).sha, routerSha(R).sha);
  assert.throws(() => fitNeedRouter(P.items, { probePrior: 'flat' }), /probePrior must be one of/);
  // features.mjs is hashed at load like router.mjs (test/router-review.test.mjs D4): an edit on disk after load refuses cards.
  const cardUrl = new URL('../card.mjs', import.meta.url).href, routerUrl = new URL('../router.mjs', import.meta.url).href;
  const script = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { decisionCard } from ${JSON.stringify(cardUrl)};
    import { fitNeedRouter } from ${JSON.stringify(routerUrl)};
    const real = fs.readFileSync;
    fs.readFileSync = function (p, ...rest) { const x = real.call(this, p, ...rest); return String(p).endsWith('/features.mjs') ? Buffer.concat([Buffer.from(x), Buffer.from('\\n// edited\\n')]) : x; };
    syncBuiltinESMExports();
    const R = fitNeedRouter([{ id: 'a', cluster: 'A', features: { logInputTokens: 2, maxListLength: 0 }, stats: { 'agent-H': { s: 0.5, q: 0.1, c: 0.1, B: 0 } }, labels: {} }]);
    let err = null; try { decisionCard(R, { id: 'x', features: { logInputTokens: 2, maxListLength: 0 } }); } catch (e) { err = e.message; }
    process.stdout.write(JSON.stringify({ err }));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60000 });
  assert.equal(out.status, 0, out.stderr);
  assert.match(JSON.parse(out.stdout).err ?? '', /router sources changed on disk since they were loaded \(features\.mjs\)/);
});

// ------------------------------------------------------------------------------------------------------------- R9
test('R9 one probe prior: decide\'s update and probePlan\'s EVSI read the same probePriors, under either prior kind', () => {
  const x = P.view(SMALL);
  for (const kind of ['pooled-tasks', 'empirical-bayes']) {
    const R = fitNeedRouter(P.items, { modes: V1_MODES, probePrior: kind }), d = R.decide(x, HEADLINE);
    const leafItems = P.items.map(trainItem).filter(it => intrinsicOf(it.features, R.rule.thresholds).intrinsic === false);
    const want = probePriors(leafItems, Object.keys(d.pred), { kind, tasksPerJob: 12 });
    for (const m of Object.keys(d.pred)) {
      close(d.priors[m].a, want[m].a); close(d.priors[m].b, want[m].b); assert.equal(d.priors[m].kind, kind);
      const lp = leafPrior(leafItems.map(it => it.statsMap.get(m).s), { kind, tasksPerJob: 12 }); close(lp.a, want[m].a);
    }
    if (kind === 'pooled-tasks') for (const m of Object.keys(d.pred)) { const T = d.pred[m].n * 12; close(d.priors[m].a, 1 + d.pred[m].p * T, 1e-9); close(d.priors[m].b, 1 + (1 - d.pred[m].p) * T, 1e-9); }
    // probePlan prices with exactly these priors ...
    for (const m of probePlan(R, x, HEADLINE).modes) { close(m.a, d.priors[m.id].a); close(m.b, d.priors[m.id].b); }
    // ... and the probe update starts from them: p = (a + passes)/(a + b + n).
    const probed = R.decide(x, HEADLINE, { probe: probeFor(x.id, { 'direct-H': [2, 2] }, 0.06) });
    close(probed.pred['direct-H'].p, (d.priors['direct-H'].a + 2) / (d.priors['direct-H'].a + d.priors['direct-H'].b + 2));
    assert.equal(R.fitted.probe.prior, kind);
  }
  // The kNN stage takes no probe and carries no prior.
  assert.equal(fitNeedRouter(P.items, { modes: V1_MODES, stage: 'knn' }).decide(x, HEADLINE).priors, null);
});

// ------------------------------------------------------------------------------------------------------------ R10
test('R10 itemsFromContext refuses a negative derived q, c or B (an accounting error) and clamps only float noise', () => {
  const ctxOf = ({ s = 0.5, uW0 = 0.4, uWV = 0.35, usd1 = 0.1, usd2 = 0.1 }) => ({ train: [{ view: { id: 'a', features: { logInputTokens: 2 } }, cluster: 'A', modes: ['agent-H'], s: () => s,
    u: (cell, m) => (cell.N === 1 && cell.wOverV === 0 ? uW0 : cell.N === 1 ? uWV : uW0 - (usd2 - usd1)), usd: (cell, m) => (cell.N === 1 ? usd1 : usd2), label: () => null }] });
  const ok = itemsFromContext(ctxOf({}))[0].stats['agent-H'];
  close(ok.s, 0.5); close(ok.q, 0.05, 1e-12); close(ok.c, 0.1); assert.equal(ok.B, 0);
  // u at W = V above u at W = 0: q = -0.05 (it used to become 0 silently).
  assert.throws(() => itemsFromContext(ctxOf({ uWV: 0.45 })), /derives q = -0\.0(5|49+)\d* < 0/);
  // usd at N = 2 above usd at N = 1: B < 0 (and c > usd).
  assert.throws(() => itemsFromContext(ctxOf({ uW0: 0.4, usd1: 0.1, usd2: 0.2 })), /derives B = -0\.(2|19+)\d* < 0/);
  // Float noise is clamped to 0.
  assert.equal(itemsFromContext(ctxOf({ uWV: 0.4 + 1e-12 }))[0].stats['agent-H'].q, 0);
});

// ------------------------------------------------------------------------------------------------------------ R11
test('R11 a probe that is not null observes at least one mode with k >= 1; an empty probe is refused, never carded as NR-probe', () => {
  const R = fitNeedRouter(P.items, { modes: V1_MODES }), j = job(SMALL);
  // The reviewer's case: { observations: {}, costUsd: 0 } was carded NR-probe with ran: true, k 0 and $0.
  assert.throws(() => decisionCard(R, j, HEADLINE, { probe: { observations: {}, costUsd: 0 } }), /no observation is no probe|at least one probeable mode/);
  assert.throws(() => R.decide(j, HEADLINE, { probe: { observations: {}, costUsd: 0.16 } }), /at least one probeable mode/);
  assert.throws(() => R.decide(j, HEADLINE, { probe: { observations: {}, k: 0, costUsd: 0.01 } }), /at least one probeable mode/);
  assert.throws(() => R.decide(j, HEADLINE, { probe: { observations: { 'direct-H': { passes: 0, n: 0, signal: 'schemaValid', rows: [] } }, costUsd: 0.01 } }), /n >= 1/);
  assert.equal(probeRecord(null), null); assert.equal(R.decide(j, HEADLINE, { probe: null }).probe, null);
  assert.deepEqual(probeProblems({}), ['a probe that ran must observe at least one probeable mode (no observation is no probe: pass probe null)']);
  // A card forged to an empty probe fails validation (schema: k >= 1, at least one mode; and the provenance rules).
  const card = decisionCard(R, j, HEADLINE, { probe: probeFor(j.id, { 'agent-H': [1, 1] }, 0.1) }), forged = structuredClone(card);
  forged.probe.modes = []; forged.probe.observations = {}; forged.probe.k = 0;
  assert.equal(validateCard(forged).ok, false);
});
