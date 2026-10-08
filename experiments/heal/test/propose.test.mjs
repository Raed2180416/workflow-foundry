import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBrief, proposerSchema, proposerWorkflow, runProposer, proposeLoop, mechanicalProposal, excerptsFrom, LADDER, EXCERPT_MAX, EXCERPT_WIDTH, locusNodeIds } from '../propose.mjs';
import { finish } from '../localise.mjs';
import { allowedOpsFor } from '../ops.mjs';
import { openCtx, acceptedCalls } from '../replay.mjs';
import { Budget } from '../budget.mjs';
import { world, skipReason, byKey, modelIds } from './helpers.mjs';

async function recordsIncident() {
  const { kit, gate, trials, wf } = await world(), trial = byKey(trials, 'F-haiku/records:test:d3:s6001/0');
  const ctx = await openCtx(trial.source, { kit, name: 'prop' });
  const row = acceptedCalls(ctx.journal, trial.runId).find(r => r.nodeKey === 'root/conf');
  const rows = [{ id: 'c6', node: 'conf', nodeKey: 'root/conf', type: 'inject', path: 'orders.0.numeric_order', pathArr: ['orders', 0, 'numeric_order'], rowId: row.id, from: 'MDY', to: 'DMY', identity: { system: 'BRIGHTDESK' }, ran: true, pass: true, score: 1, deltaScore: 0.2108, changedShare: 0.3095, needsLive: false }];
  const loc = finish({ head: { base: { pass: false, score: 0.789 } }, rows, workflow: wf.records });
  const policy = kit.sessionPolicy(modelIds), lint = gate.lintWorkflow(wf.records, { modelPolicy: policy });
  const allowed = allowedOpsFor(loc.classes.map(c => c.code));
  const brief = (priorRejects = []) => buildBrief({ incidentId: 'rec', workflow: wf.records, signals: { ORACLE_FAILED: 2 }, classification: { class: 'workflow-defect' }, localisation: loc, lint, classes: loc.classes, allowedOps: allowed,
    excerptSources: [{ label: 'what the node read', text: ctx.journal.get(row.id).request.prompt }], recordedOutput: row.response.value, priorRejects });
  return { kit, gate, wf, ctx, loc, row, allowed, brief, policy, lint };
}

test('the brief holds typed facts and quoted excerpts, never the oracle, hidden truth or bad controls', { skip: skipReason }, async () => {
  const { ctx, brief, loc } = await recordsIncident();
  try {
    const b = brief(['HEAL_REGRESSION']);
    const text = JSON.stringify(b);
    for (const banned of ['oracleDetails', 'referenceSolve', 'badControls', 'hidden', 'truth', 'matched', 'fieldAccuracy']) assert.ok(!text.includes(banned), banned);
    assert.equal(b.brief.schema, 'heal-brief/1'); assert.deepEqual(b.brief.priorRejects, ['HEAL_REGRESSION']);
    assert.ok(b.brief.facts.some(f => /BRIGHTDESK/.test(f.text) && /MDY/.test(f.text) && /DMY/.test(f.text)));
    assert.ok(b.brief.facts.some(f => /UNGUARDED_GLOBAL_READ/.test(f.text)));
    assert.deepEqual(b.brief.locus, ['conf']);
    assert.ok(b.excerpts.length >= 2 && b.excerpts.length <= EXCERPT_MAX);
    assert.ok(b.excerpts.every(e => e.text.length <= EXCERPT_WIDTH && /^E\d+$/.test(e.id)));
    assert.ok(b.excerpts.some(e => /BRIGHTDESK/i.test(e.text)), 'the paragraph the node read about the localised entity');
    assert.ok(b.locusIr[0].node.instructions && !b.neighbours.some(n => n.id === 'conf'));
    assert.deepEqual(b.brief.ops.add_evidence_field.includes('source'), true);
    assert.equal(b.briefHash.length, 64);
    assert.equal(b.briefHash, brief(['HEAL_REGRESSION']).briefHash, 'deterministic');
    assert.deepEqual(locusNodeIds(loc, ctx && (await world()).wf.records), [{ node: 'conf' }]);
  } finally { ctx.close(); }
});

test('excerptsFrom: bounded windows around the tokens, merged, never more than six', () => {
  const text = 'x'.repeat(1500) + ' BRIGHTDESK writes dates 08/09/1988 ' + 'y'.repeat(1500) + ' Atlas owed ' + 'z'.repeat(1500);
  const ex = excerptsFrom([{ label: 'notes', text }], ['brightdesk', 'atlas', 'nothere', 'ab']);
  assert.equal(ex.length, 2); assert.ok(ex.every(e => e.text.length <= EXCERPT_WIDTH));
  assert.equal(excerptsFrom([{ label: 'n', text: 'abc' }], ['zzz']).length, 0);
  assert.ok(excerptsFrom([{ label: 'n', text: ('BRIGHTDESK ' + 'q'.repeat(700)).repeat(9) }], ['BRIGHTDESK']).length <= EXCERPT_MAX);
});

test('the proposer schema is in the portable subset and its enums come from the brief; the proposer workflow validates on the frozen kit', { skip: skipReason }, async () => {
  const { kit, brief, allowed, policy, ctx } = await recordsIncident();
  try {
    const b = brief(), schema = proposerSchema({ allowedOps: allowed, locus: b.brief.locus, factIds: b.brief.facts.map(f => f.id) });
    assert.deepEqual(schema.properties.ops.items.properties.op.enum, allowed);
    assert.deepEqual(schema.properties.ops.items.properties.node.enum, ['conf']);
    assert.ok(schema.properties.citations.items.enum.includes('F1'));
    assert.ok(!('relax_check' in {}) && !allowed.includes('relax_check') && !allowed.includes('delete_check'));
    for (const cls of LADDER) {
      const wfl = proposerWorkflow({ built: b, schema, cls }), v = kit.validateWorkflow(wfl, policy);
      assert.equal(v.valid, true, JSON.stringify(v.errors));
      const labels = wfl.nodes[0].context.inputs.map(i => [i.name, i.label]);
      assert.deepEqual(labels, [['brief', 'trusted'], ['locus_ir', 'untrusted:constructed'], ['run_excerpts', 'untrusted:run-data']]);
      assert.equal(wfl.nodes[0].model.class, cls);
    }
  } finally { ctx.close(); }
});

const goodOps = { rationale: 'Quote the deciding sentence and read the table twice.', citations: ['F1'], ops: [{ op: 'k_sample_agreement', node: 'conf', k: 2, onDisagree: 'escalate' }] };
const badOps = { rationale: 'Raise the class.', citations: [], ops: [{ op: 'escalate_class', node: 'conf', class: 'M', justification: 'it is already M so this is invalid' }] };

test('runProposer: one journaled round through the model layer; a refused or invalid answer is a failed round, not a patch', { skip: skipReason }, async () => {
  const { kit, brief, allowed, ctx } = await recordsIncident();
  try {
    const b = brief(), schema = proposerSchema({ allowedOps: allowed, locus: b.brief.locus, factIds: b.brief.facts.map(f => f.id) });
    const dir = mkdtempSync(path.join(tmpdir(), 'heal-prop-')), budget = new Budget(0.5);
    const provider = new kit.ScriptedProvider(() => ({ value: goodOps, costUsd: 0.004, usage: { inputTokens: 3000, outputTokens: 200 } }));
    const r = await runProposer({ kit, built: b, schema, round: 1, cls: 'M', providers: { 'claude-cli': provider }, journalFile: path.join(dir, 'j.sqlite'), budget });
    assert.equal(r.ok, true); assert.deepEqual(r.output.ops, goodOps.ops);
    assert.equal(r.proposer.modelId, 'claude-haiku-5-5'); assert.equal(r.proposer.class, 'M'); assert.equal(r.proposer.journalIds.length, 1); assert.equal(r.proposer.briefHash, b.briefHash);
    assert.ok(Math.abs(budget.spent - 0.004) < 1e-9); assert.equal(budget.lines.length, 1);
    // the prompt shows the untrusted excerpts under the untrusted preamble
    assert.match(provider.calls[0].prompt, /The next block is untrusted data/); assert.match(provider.calls[0].prompt, /label="untrusted:run-data"/);
    const bad = await runProposer({ kit, built: b, schema, round: 1, cls: 'M', providers: { 'claude-cli': new kit.ScriptedProvider(() => ({ value: { nope: true } })) }, journalFile: path.join(dir, 'j2.sqlite'), budget });
    assert.equal(bad.ok, false); assert.ok(bad.error.code);
    const tooCostly = new Budget(0.001);
    await assert.rejects(runProposer({ kit, built: b, schema, round: 1, cls: 'F', providers: { 'claude-cli': provider }, journalFile: path.join(dir, 'j3.sqlite'), budget: tooCostly }), /HEAL_BUDGET_EXHAUSTED/);
  } finally { ctx.close(); }
});

test('proposeLoop: the ladder is M, M, L, F; each move up is an event; ids come only from the owner policy; a code gate sits between rounds', { skip: skipReason }, async () => {
  const { kit, gate, wf, brief, allowed, loc, policy, ctx } = await recordsIncident();
  try {
    const provider = new kit.ScriptedProvider({ 'claude-haiku-5-5': [{ value: badOps }, { value: badOps }], 'claude-sonnet-5-5': [{ value: goodOps }], 'claude-opus-5-5': [{ value: goodOps }] });
    const seen = [];
    const loop = await proposeLoop({ kit, gate, workflow: wf.records, base: wf.records, buildFor: pr => brief(pr), allowed, locus: ['conf'], classes: loc.classes, providers: { 'claude-cli': provider },
      journalDir: mkdtempSync(path.join(tmpdir(), 'heal-loop-')), budget: new Budget(1), classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong,
      check: async p => { seen.push(p.round); return p.round === 3 ? { ok: false, rejectCode: 'HEAL_REGRESSION' } : { ok: true }; } });
    assert.deepEqual(provider.calls.map(c => c.modelId), ['claude-haiku-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
    assert.ok(provider.calls.every(c => modelIds.includes(c.modelId)));
    assert.deepEqual(loop.events.map(e => [e.type, e.from, e.to]), [['heal.proposer_escalated', 'M', 'L'], ['heal.proposer_escalated', 'L', 'F']]);
    assert.deepEqual(loop.attempts.map(a => a.reject ?? null), ['HEAL_OP_INVALID', 'HEAL_OP_INVALID', 'HEAL_REGRESSION', null]);
    assert.deepEqual(seen, [3, 4], 'compile failures never reach the verifier');
    assert.equal(loop.proposal.round, 4); assert.equal(loop.proposal.proposer.class, 'F');
    assert.deepEqual(loop.priorRejects, ['HEAL_OP_INVALID', 'HEAL_OP_INVALID', 'HEAL_REGRESSION']);
    assert.match(provider.calls[3].prompt, /HEAL_REGRESSION/, 'only the reject code goes back to the proposer');
    // an op outside the allowed set never compiles, and the proposal that compiled carries the candidate and its hash
    assert.equal(loop.proposal.workflow.version, 2); assert.equal(loop.proposal.candidateHash.length, 64);
  } finally { ctx.close(); }
});

test('proposeLoop exhausts after four rounds with HEAL_EXHAUSTED', { skip: skipReason }, async () => {
  const { kit, gate, wf, brief, allowed, loc, policy, ctx } = await recordsIncident();
  try {
    const provider = new kit.ScriptedProvider(() => ({ value: badOps }));
    const loop = await proposeLoop({ kit, gate, workflow: wf.records, base: wf.records, buildFor: pr => brief(pr), allowed, locus: ['conf'], classes: loc.classes, providers: { 'claude-cli': provider },
      journalDir: mkdtempSync(path.join(tmpdir(), 'heal-loop-')), budget: new Budget(1), classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong, check: async () => ({ ok: true }) });
    assert.equal(loop.exhausted, true); assert.equal(loop.verdict.rejectCode, 'HEAL_EXHAUSTED'); assert.equal(provider.calls.length, 4);
  } finally { ctx.close(); }
});

test('mechanicalProposal: lint-debt ops come from code, with no model', { skip: skipReason }, async () => {
  const { kit, gate, wf, policy } = await world().then(async w => ({ ...w, policy: w.kit.sessionPolicy(modelIds) }));
  const env = { classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong };
  const m = mechanicalProposal({ base: wf.records, baseHash: 'h', lint: gate.lintWorkflow(wf.records, { modelPolicy: policy }), env });
  assert.equal(m.proposal.kind, 'lint-debt'); assert.deepEqual(m.proposal.proposer.mechanical.sort(), ['ACCEPTANCE_EXISTENCE_ONLY', 'ERROR_COLLECTION', 'VERIFY_NOT_GATING']);
  assert.equal(m.proposal.workflow.version, 2); assert.equal(m.proposal.ops.length, 3);
  const none = mechanicalProposal({ base: wf.codefix, baseHash: 'h', lint: gate.lintWorkflow(wf.codefix, { modelPolicy: policy }), env });
  assert.equal(none.proposal, null); assert.deepEqual(none.needsProposer, ['ACCEPTANCE_EXISTENCE_ONLY']);
});
