// Decision card need-decision/1 (card.mjs): schema (own validator and Ajv on the same schema), cross-field invariants,
// content (per-mode p, c, F, EU; choice with cascade fallback; needsWorkflow; routing cost; routerSha), untrusted text,
// canonical hashing and the NR-probe plan. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { decisionCard, validateCard, CARD_SCHEMA, CARD_SCHEMA_ID, canonicalJson, sha256, routerSha, codeShas, CODE_FILES, textCues, proseCues, probePlan } from '../card.mjs';
import { fitNeedRouter, N1, TRUSTED_FEATURES } from '../router.mjs';
import { INJECTIONS } from '../evaluate.mjs';
import { HEADLINE, makeCell, CASCADES, DELTA } from '../metrics.mjs';
import { needsWorkflow as plantedNeed } from './worlds.mjs';
import { plantedRouter, V1_MODES } from './router-fixtures.mjs';

const ajvCheck = new Ajv({ allErrors: true, strictSchema: true, strictTypes: false, strictTuples: false, strictRequired: false, allowUnionTypes: true }).compile(CARD_SCHEMA);
const both = card => { const own = validateCard(card), ajv = ajvCheck(card); return { own: own.ok, ajv, problems: own.problems, ajvErrors: ajvCheck.errors }; };
const P = plantedRouter();
const R = { leaf: fitNeedRouter(P.items, { modes: V1_MODES }), knn: fitNeedRouter(P.items, { modes: V1_MODES, stage: 'knn' }) };
const job = (j, over = {}) => { const v = P.view(j); return { id: v.id, features: v.features, requirements: v.requirements, verifier: v.verifier, modes: v.modes, ...over }; };
const BIG = P.EVAL.find(j => plantedNeed(P.W.meta[j].features)), SMALL = P.EVAL.find(j => !plantedNeed(P.W.meta[j].features));

function allCards() {
  const out = [];
  for (const stage of ['leaf', 'knn']) for (const j of P.EVAL) for (const c of [HEADLINE, N1, makeCell(0.1, 100, 0), makeCell(10, 1, 10)]) out.push(decisionCard(R[stage], job(j), c));
  const r = R.leaf, e8 = { requirements: ['durable wait', 'schedule', 'effects with authority'] };
  out.push(decisionCard(r, job(SMALL, e8), HEADLINE));
  out.push(decisionCard(fitNeedRouter(P.items, { modes: V1_MODES, engine: ['state'] }), job(SMALL, e8), HEADLINE));
  out.push(decisionCard(r, job(SMALL, { requirements: ['human approval'], modes: ['direct-H', 'agent-H'] }), HEADLINE));
  out.push(decisionCard(r, job(SMALL, { features: { verifiable: 1 } }), HEADLINE));
  out.push(decisionCard(r, job(SMALL, { modes: ['agent-H', 'mystery-mode'] }), HEADLINE));
  out.push(decisionCard(r, job(BIG), makeCell(0.1, 1, 1)));
  out.push(decisionCard(r, job(SMALL), HEADLINE, { text: 'Wait 30 days, then ask a reviewer to approve and send the refund.' }));
  out.push(decisionCard(r, job(SMALL), HEADLINE, { probe: { observations: { 'direct-H': { passes: 1, n: 2 }, 'agent-H': { passes: 1, n: 1 } }, costUsd: 0.16, signals: { schemaValid: [true, true], agree: false }, disagree: true } }));
  return out;
}
const CARDS = allCards();

test('card schema: every card the router writes validates, under card.mjs\'s validator and under Ajv', () => {
  assert.equal(CARDS.length, 2 * P.EVAL.length * 4 + 8);
  for (const card of CARDS) {
    const b = both(card);
    assert.ok(b.own && b.ajv, `${card.job.id} ${card.cell.key}: ${b.problems.join('; ')} ${JSON.stringify(b.ajvErrors)}`);
    assert.equal(card.schema, CARD_SCHEMA_ID); assert.equal(card.propensity, 1);
    // DESIGN §1's fields are all there.
    for (const k of ['job', 'features', 'featuresHash', 'guard', 'structure', 'probe', 'pred', 'U', 'choice', 'needsWorkflow', 'class', 'askFlag', 'routingCostUsd', 'routerSha', 'propensity']) assert.ok(Object.hasOwn(card, k), k);
    for (const k of ['forced', 'requirement', 'engineSupport']) assert.ok(Object.hasOwn(card.guard, k), k);
    for (const k of ['intrinsic', 'reason']) assert.ok(Object.hasOwn(card.structure, k), k);
    for (const k of ['mode', 'cascade']) assert.ok(Object.hasOwn(card.choice, k), k);
    assert.deepEqual(Object.keys(card.features).filter(k => !TRUSTED_FEATURES.includes(k)), []);
    // Cards are plain JSON: a round trip changes nothing.
    assert.deepEqual(JSON.parse(JSON.stringify(card)), card);
  }
  // Every abstention kind and both stages appear in the sample.
  const reasons = CARDS.flatMap(c => c.abstain?.reasons ?? []).map(r => r.split(':')[0]);
  for (const r of ['structure-unknown', 'forced-without-workflow-mode', 'no-mode-pays']) assert.ok(reasons.includes(r), r);
  assert.ok(CARDS.some(c => c.policy === 'NR-knn') && CARDS.some(c => c.policy === 'NR-probe'));
});

test('card schema rejects malformed cards under both validators; the cross-field invariants catch schema-valid inconsistencies', () => {
  const base = decisionCard(R.leaf, job(BIG), HEADLINE);
  const mutate = f => { const c = structuredClone(base); f(c); return c; };
  for (const [what, bad] of [
    ['missing field', mutate(c => { delete c.routerSha; })], ['extra field', mutate(c => { c.text = 'the task'; })],
    ['p above 1', mutate(c => { c.pred['construct-H'].p = 1.5; })], ['untrusted feature', mutate(c => { c.features.family = 3; })],
    ['bad sha', mutate(c => { c.routerSha = 'abc'; })], ['unknown requirement', mutate(c => { c.guard.requirements = ['pipeline']; })],
    ['bad class', mutate(c => { c.class = 'maybe'; })], ['propensity', mutate(c => { c.propensity = 0.5; })], ['bad cue', mutate(c => { c.guard.ask.cues = ['branching']; })],
  ]) { const b = both(bad); assert.equal(b.own, false, what); assert.equal(b.ajv, false, what); }
  for (const [what, bad] of [
    ['forced but no-workflow', mutate(c => { c.guard.forced = true; c.guard.requirement = 'schedule'; c.guard.requirements = ['schedule']; c.class = 'no-workflow'; })],
    ['askFlag without a reason', mutate(c => { c.askFlag = true; })],
    ['features tampered', mutate(c => { c.features.logInputTokens += 1; })],
    ['routerSha tampered', mutate(c => { c.routerShaParts.fitted = '0'.repeat(64); })],
    ['choice not runnable', mutate(c => { c.job.modes = ['direct-H']; })],
    ['EU differs from U', mutate(c => { c.pred['construct-H'].EU += 0.1; })],
    ['abstain share wrong', mutate(c => { c.pred['construct-H'].abstain = 0.5; })],
    ['job and cell disagree', mutate(c => { c.job.V = 10; })],
  ]) { const b = both(bad); assert.equal(b.ajv, true, `${what}: schema-valid`); assert.equal(b.own, false, what); }
});

test('card content: per-mode p, c, F, EU; the choice with its cascade fallback; needsWorkflow; routing cost; routerSha', () => {
  for (const [j, want] of [[BIG, 'construct-H'], [SMALL, 'direct-H']]) {
    const card = decisionCard(R.leaf, job(j), HEADLINE);
    assert.equal(card.choice.mode, want); assert.equal(card.needsWorkflow, want === 'construct-H'); assert.equal(card.class, want === 'construct-H' ? 'workflow' : 'no-workflow');
    for (const [m, x] of Object.entries(card.pred)) {
      for (const k of ['p', 'c', 'F', 'EU']) assert.ok(Number.isFinite(x[k]), `${m}.${k}`);
      const c = card.cell;
      assert.ok(Math.abs(x.EU - (x.p - x.c / c.V - x.F / (c.N * c.V) - c.wOverV * x.q)) < 1e-12, m);
      assert.ok(Math.abs(x.usdPerTask - (x.c + x.F / c.N)) < 1e-12, m);
    }
    const spec = CASCADES.find(s => s.primary === want);
    assert.deepEqual(card.choice.cascade, { id: spec.id, primary: spec.primary, fallback: spec.fallback, on: [...spec.on] });
    assert.deepEqual(card.choice.checkpoint, want === 'construct-H' ? { afterTask: 4, switchTo: 'agent-H', when: 'at least half of the tasks so far fell back' } : null);
    assert.equal(card.routingCostUsd, 0); assert.equal(card.policy, 'NR-static');
  }
  // No runnable fallback, no cascade.
  const lone = decisionCard(R.leaf, job(BIG, { modes: ['direct-H', 'construct-H'] }), HEADLINE);
  assert.equal(lone.choice.mode, 'construct-H'); assert.equal(lone.choice.cascade, null); assert.equal(lone.choice.checkpoint, null);
  // A probe's dollars are routing dollars, charged in U as r/(N·V).
  const pr = decisionCard(R.leaf, job(SMALL), HEADLINE, { probe: { observations: { 'direct-H': { passes: 2, n: 2 } }, costUsd: 0.16 } });
  assert.equal(pr.policy, 'NR-probe'); assert.equal(pr.routingCostUsd, 0.16); assert.deepEqual(pr.probe, { ran: true, modes: ['direct-H'], k: 2, signals: null, costUsd: 0.16, disagree: false });
  // routerSha: stable for identical fits; moves with the TRAIN labels, δ or the stage; its code part hashes the module sources.
  const s0 = routerSha(R.leaf), again = routerSha(fitNeedRouter([...P.items].reverse(), { modes: V1_MODES }));
  assert.equal(again.sha, s0.sha); assert.match(s0.sha, /^[0-9a-f]{64}$/);
  for (const other of [fitNeedRouter(P.items.slice(1), { modes: V1_MODES }), fitNeedRouter(P.items, { modes: V1_MODES, delta: DELTA }), R.knn]) assert.notEqual(routerSha(other).sha, s0.sha);
  assert.deepEqual(Object.keys(codeShas()), [...CODE_FILES]);
  for (const f of CODE_FILES) assert.equal(codeShas()[f], sha256(readFileSync(new URL(`../${f}`, import.meta.url))));
  assert.equal(decisionCard(R.leaf, job(BIG), HEADLINE).routerSha, s0.sha);
});

test('untrusted text: word cues raise "ask", never change the choice, and the text never enters the card', () => {
  const marker = 'ZEBRA-7781';
  for (const j of P.EVAL.slice(0, 10)) for (const c of [HEADLINE, N1]) {
    const plain = decisionCard(R.leaf, job(j), c), cued = decisionCard(R.leaf, job(j), c, { text: `${marker}: wait 30 days for the reviewer to approve, then send the refund` });
    assert.equal(cued.choice.mode, plain.choice.mode); assert.equal(cued.needsWorkflow, plain.needsWorkflow); assert.deepEqual(cued.U, plain.U);
    assert.equal(cued.askFlag, true); assert.equal(cued.guard.forced, false);
    assert.ok(!JSON.stringify(cued).includes(marker));
    const viaJob = decisionCard(R.leaf, job(j, { text: `${marker} approve` }), c);
    assert.ok(!JSON.stringify(viaJob).includes(marker)); assert.equal(viaJob.askFlag, true);
    for (const s of INJECTIONS) assert.equal(decisionCard(R.leaf, job(j), c, { text: s }).choice.mode, plain.choice.mode);
  }
  assert.deepEqual(textCues('Wait 30 days, then ask a reviewer to approve and send the refund.'), ['durable-wait', 'effectVerbs', 'high-risk-not-model-owned', 'human-gate', 'humanWords']);
  assert.deepEqual(textCues('Sum the rows.'), []);
  assert.deepEqual(textCues(null), []);
  assert.deepEqual(proseCues({ effectVerbs: 2, timeWords: 0, humanWords: 1, logInputTokens: 3 }), ['humanWords', 'effectVerbs']);
  // A declared requirement silences its own cue.
  assert.equal(decisionCard(R.leaf, job(SMALL, { requirements: ['human approval'] }), HEADLINE, { text: 'approve it' }).askFlag, false);
});

test('canonical JSON: key order free; non-finite numbers and non-plain values refused', () => {
  assert.equal(canonicalJson({ b: 1, a: [1, { d: null, c: 'x' }], u: undefined }), '{"a":[1,{"c":"x","d":null}],"b":1}');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  for (const bad of [NaN, Infinity, { x: -Infinity }, new Map(), new Date(0), () => 1]) assert.throws(() => canonicalJson(bad), /canonicalJson/);
  const card = decisionCard(R.leaf, job(SMALL), HEADLINE);
  assert.equal(card.featuresHash, sha256(canonicalJson(card.features)));
  assert.equal(card.structure.thresholds.logInputTokens, R.leaf.rule.thresholds.logInputTokens);
});

test('NR-probe plan (voi.mjs bestProbe on the router\'s predictions): no probe when a mode dominates; k capped at H when N = 1', () => {
  // Confident TRAIN predictions (12 tasks per job, several jobs): nothing worth buying.
  assert.equal(probePlan(R.leaf, job(SMALL), HEADLINE).probe, null);
  // One thin TRAIN job per leaf with close rates: probing direct-H can pay at a large N.
  const thin = fitNeedRouter([
    { id: 'a', cluster: 'A', features: { logInputTokens: 2, maxListLength: 0 }, stats: { 'direct-H': { s: 0.55, q: 0.1, c: 0.02, B: 0 }, 'agent-H': { s: 0.7, q: 0.05, c: 0.12, B: 0 } }, labels: {} },
  ], { modes: ['direct-H', 'agent-H'], tasksPerJob: 2 });
  const plan = probePlan(thin, { id: 'x', features: { logInputTokens: 2, maxListLength: 0 } }, makeCell(1, 100, 1));
  assert.ok(plan.probe && ['direct-H', 'agent-H'].includes(plan.probe.j) && plan.probe.k <= 2, JSON.stringify(plan.probe));
  assert.ok(plan.net > 0);
  // voi.mjs bounds k by the horizon even for example-only probes: at N = 1 only k = 1 is priced (review finding V2).
  const one = probePlan(thin, { id: 'x', features: { logInputTokens: 2, maxListLength: 0 } }, makeCell(1, 1, 1));
  assert.ok(one.plans.every(p => p.k === 1));
});
