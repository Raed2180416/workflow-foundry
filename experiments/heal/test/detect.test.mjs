import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, classifyEarly, classifyLate, checkVacuity, checkDisagreements, THRESHOLDS } from '../detect.mjs';
import { openCtx, replayRun, fidelity } from '../replay.mjs';
import { world, skipReason, byKey } from './helpers.mjs';

async function run(key, wfName, opts = {}) {
  const { kit, gate, trials, wf } = await world(), trial = byKey(trials, key), ctx = await openCtx(trial.source, { kit, name: 'det' });
  try {
    const base = await replayRun(ctx, wf[wfName], trial);
    const population = trials.filter(t => t.source === trial.source && t.armId === trial.armId && t.family === trial.family);
    const d = await detect({ trial, workflow: wf[wfName], base, population, kit, ctx, gate, ...opts });
    return { trial, base, d, early: classifyEarly({ trial, fidelity: fidelity(trial, base), base }) };
  } finally { ctx.close(); }
}

test('H-cfx failed trial: oracle, verdict mismatch, unverified verdict, lint error and cost/latency outliers fire; the incident is a candidate', { skip: skipReason }, async () => {
  const { d, early } = await run('F-haiku/codefix:test:d3:s6004/0', 'codefix', { withVacuity: false });
  for (const k of ['ORACLE_FAILED', 'VERDICT_ORACLE_MISMATCH', 'UNVERIFIED_VERDICT', 'LINT_FINDING', 'COST_OUTLIER', 'LATENCY_OUTLIER']) assert.ok(d.byKind[k] >= 1, k);
  assert.equal(d.verdict.verdict, 'unverified'); assert.equal(d.verdict.code, 'ACCEPTANCE_EXISTENCE_ONLY');
  assert.equal(d.signals.find(s => s.kind === 'LINT_FINDING').detail.code, 'ACCEPTANCE_EXISTENCE_ONLY');
  assert.equal(early.class, 'candidate'); assert.equal(early.heal, true);
  const cost = d.signals.find(s => s.kind === 'COST_OUTLIER').detail;
  assert.ok(cost.costUsd > THRESHOLDS.costOutlier * cost.p25);
  assert.ok(d.signals.every(s => s.schema === 'heal-signal/1' && s.workflow.hash && s.run.runId));
});

test('H-cfx lucky pass (s6001 t1): no oracle failure, yet the cost outlier and a check/model disagreement fire (the repair returned the flagged fix unchanged)', { skip: skipReason }, async () => {
  const { d } = await run('F-haiku/codefix:test:d3:s6001/1', 'codefix', { withVacuity: false });
  assert.equal(d.byKind.ORACLE_FAILED, undefined);
  assert.ok(d.byKind.COST_OUTLIER >= 1);
  const dis = d.signals.find(s => s.kind === 'CHECK_MODEL_DISAGREEMENT');
  assert.ok(dis, 'CHECK_MODEL_DISAGREEMENT'); assert.deepEqual([dis.detail.node, dis.detail.flaggedNode, dis.detail.field], ['repair', 'fix', 'patched_source']);
});

test('H-rec s6004 t1: Haiku dropped a row, the id-echo check fired and Sonnet redid the batch: working as designed, not a defect', { skip: skipReason }, async () => {
  const { d, early } = await run('F-haiku/records:test:d3:s6004/1', 'records', { withVacuity: false });
  assert.ok(d.byKind.CHECK_FAILED >= 1, 'the check-triggered escalation is a signal');
  assert.equal(early.class, 'working-as-designed'); assert.equal(early.heal, false);
});

test('H-rec failed trial is a candidate; every run of the existence-only workflow is unverified', { skip: skipReason }, async () => {
  const { d, early, base } = await run('F-haiku/records:test:d3:s6001/0', 'records', { withVacuity: false });
  assert.equal(early.class, 'candidate');
  assert.ok(d.byKind.ORACLE_FAILED && d.byKind.VERDICT_ORACLE_MISMATCH && d.byKind.UNVERIFIED_VERDICT);
  assert.equal(d.lint.counts.error, 3);
  assert.equal(base.verdict, 'pass', 'the frozen runtime said pass on a failed answer: the false pass that motivates the whole loop');
});

test('P1: the check-vacuity trace finds that 59 of 90 status judgments were checked without looking at meaning', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const peers = trials.filter(t => t.armId === 'fhand-haiku');
  const ctx = await openCtx('p1', { kit, name: 'vac' });
  try {
    const rows = checkVacuity({ workflow: wf.p1, journal: ctx.journal, runIds: peers.map(t => t.runId), kit });
    const meaning = rows.find(r => r.node === 'judge' && r.field === 'meaning' && r.nodeKey.includes('statuses'));
    assert.ok(meaning, JSON.stringify(rows.map(r => `${r.nodeKey}.${r.field}`)));
    assert.equal(meaning.outputs, 90); assert.equal(meaning.unconstrained, 59); assert.equal(meaning.distinctValues, 2);
    assert.ok(meaning.share > 0.25);
    assert.ok(!rows.some(r => r.field === 'compared_with' && r.nodeKey.includes('statuses')), 'a field that is constant where unchecked is not vacuous');
  } finally { ctx.close(); }
});

test('classifyEarly: infidelity, environment faults and sealed families are never healed', () => {
  const trial = { family: 'records', split: 'test', pass: false, row: {} };
  assert.equal(classifyEarly({ trial, fidelity: { identical: false, checks: { score: false, taskHash: true } }, base: { events: [] } }).class, 'replay-infidelity');
  assert.deepEqual(classifyEarly({ trial, fidelity: { identical: false, checks: { score: false, taskHash: true } }, base: { events: [] } }).reasons, ['score']);
  const env = { ...trial, row: { error: { code: 'MODEL_RATE_LIMIT' } } };
  assert.equal(classifyEarly({ trial: env, fidelity: { identical: true }, base: { events: [] } }).class, 'env');
  assert.equal(classifyEarly({ trial: { ...trial, family: 'sealed-2' }, fidelity: { identical: true }, base: { events: [] } }).class, 'refused-sealed');
  assert.equal(classifyEarly({ trial, fidelity: { identical: true }, base: { events: [] } }).class, 'candidate');
});

test('classifyLate: unknown, needs-live, contract-unsatisfiable, model-variance and workflow-defect', () => {
  const root = { node: 'a' };
  assert.equal(classifyLate({ localisation: { blocked: 'REPLAY_INFIDELITY' } }).class, 'replay-infidelity');
  assert.equal(classifyLate({ localisation: { root: null, needsLive: 3, note: 'n' } }).class, 'needs-live');
  assert.equal(classifyLate({ localisation: { root: null, needsLive: 0, note: 'n' } }).class, 'unknown');
  assert.equal(classifyLate({ localisation: { root }, contract: { referenceAccepted: false } }).class, 'contract-unsatisfiable');
  const v = classifyLate({ localisation: { root }, variance: { class: 'model-variance', wilsonLower: 0.4, tau: 0.2 } });
  assert.equal(v.class, 'model-variance'); assert.equal(v.allocatorOnly, true);
  assert.equal(classifyLate({ localisation: { root }, variance: { class: 'workflow-defect', wilsonLower: 0.05, tau: 0.2 } }).allocatorOnly, false);
  assert.equal(classifyLate({ localisation: { root, variance: { decisive: false, wilsonLower: 0.9, tau: 0.2 } } }).class, 'workflow-defect', 'two recorded samples are not decisive');
  assert.equal(classifyLate({ localisation: { root, variance: { decisive: true, wilsonLower: 0.5, tau: 0.2 } } }).class, 'model-variance');
});

test('checkDisagreements: only a replacement that returns the flagged candidate byte-identically', () => {
  const wf = { nodes: [{ id: 'fix', kind: 'agent' }, { id: 'check', kind: 'code' }, { id: 'repair', kind: 'agent', when: { op: 'eq', left: { $ref: 'nodes.check.ok' }, right: false }, context: { inputs: [{ name: 'prev', ref: 'nodes.fix.src' }] } }] };
  assert.equal(checkDisagreements({ workflow: wf, outputs: { fix: { src: 'a' }, repair: { src: 'a' } } }).length, 1);
  assert.equal(checkDisagreements({ workflow: wf, outputs: { fix: { src: 'a' }, repair: { src: 'b' } } }).length, 0);
  assert.equal(checkDisagreements({ workflow: wf, outputs: { fix: { src: 'a' } } }).length, 0);
});
