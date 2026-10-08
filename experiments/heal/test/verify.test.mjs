import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verify, gradersHash, pinChain } from '../verify.mjs';
import { decide, Lineage } from '../promote.mjs';
import { Budget } from '../budget.mjs';
import { mechanicalProposal } from '../propose.mjs';
import { openCtx, replayRun } from '../replay.mjs';
import { digest } from '../ir.mjs';
import { REPO } from '../kit.mjs';
import { world, skipReason, journalScript, notesKey } from './helpers.mjs';
import { incidentFor, recordsFlip, envOf, proposalFrom, freshHook, runVerify } from './fixtures.mjs';

const C0 = path.join(REPO, 'experiments/runs/c0-dev/journal.sqlite');
const KEY = 'F-haiku/records:test:d3:s6001/0';
const KSAMPLE = [{ op: 'k_sample_agreement', node: 'conf', k: 2, onDisagree: 'escalate' }];
const fixBd = v => { const o = structuredClone(v); o.orders.find(x => x.system === 'BRIGHTDESK').numeric_order = 'DMY'; return o; };
const breakAtlas = v => { const o = structuredClone(v), a = o.orders.find(x => x.system === 'ATLAS'); a.numeric_order = a.numeric_order === 'DMY' ? 'MDY' : 'DMY'; return o; };
const script = (kit, opts) => new kit.ScriptedProvider(journalScript(kit, C0, 'conf', { keyOf: notesKey, ...opts }));

test('records: a k-sample agreement patch passes V0-V8 on the recorded runs and a scripted model; the open lint debt blocks promotion', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'records', recordsFlip), { kit, wf, incident } = w;
  assert.deepEqual(incident.failing.map(t => t.key), ['F-haiku/records:test:d3:s6001/0', 'F-haiku/records:test:d3:s6001/1']);
  assert.equal(incident.passing.length, 9, '6 passing test trials + 3 construction probes'); assert.deepEqual(incident.excluded, []);
  const provider = script(kit, { fixRuns: new Set(incident.failing.map(t => t.runId)), fix: fixBd });
  const proposal = proposalFrom(w, wf.records, KSAMPLE), budget = new Budget(1);
  const v = await verify({ kit, gate: w.gate, budget, base: { workflow: wf.records, hash: digest(wf.records) }, proposal, incident, sourcePolicy: w.policy, providers: { 'claude-cli': provider }, policy: { lintDebt: 'defer', fresh: { enabled: true, n: 4, k: 1 } }, hooks: freshHook() });
  assert.deepEqual(v.stages.map(s => [s.id, s.ok]), ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'].map(id => [id, true]), JSON.stringify(v.stages.filter(s => s.ok !== true)));
  assert.equal(v.ok, true); assert.equal(v.lintDebtOpen, true);
  const v3 = v.stages.find(s => s.id === 'V3'); assert.equal(v3.trials.length, 2); assert.ok(v3.trials.every(t => t.replicas === 3), 'K = 3 replicas, each on its own journal copy');
  assert.ok(v.data.replicas.every(r => r.rows.every(x => x.pass && x.liveCalls === 2)), 'reader 1 replays; reader 2 and the escalated read go live');
  assert.deepEqual([...new Set(provider.calls.map(c => c.modelId))].sort(), ['claude-haiku-5-5', 'claude-sonnet-5-5'], 'class M for the sibling, class L for the escalation, from the owner policy');
  assert.equal(v.stages.find(s => s.id === 'V4').n, 9);
  assert.ok(budget.spent > 0 && budget.spent < 0.2, `live spend is counted: ${budget.spent}`);
  const d = decide(v, proposal); assert.equal(d.decision, 'blocked'); assert.match(d.reasons[0], /lint debt/);
});

test('records: the same patch under strict lint is refused until the lint debt is healed (V1); an escalate_class that adds a check-less node is refused too', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'records', recordsFlip), { wf } = w;
  const proposal = proposalFrom(w, wf.records, KSAMPLE);
  const v = await runVerify(w, { base: wf.records, proposal, extra: { stages: ['V0', 'V1'], policy: { lintDebt: 'strict' } } });
  assert.equal(v.rejectCode, 'HEAL_LINT_ERRORS'); assert.equal(v.stages.at(-1).id, 'V1');
  const esc = proposalFrom(w, wf.records, [{ op: 'escalate_class', node: 'conf', class: 'L', justification: 'M misread a convention' }]);
  const v2 = await runVerify(w, { base: wf.records, proposal: esc, extra: { stages: ['V0', 'V1'], policy: { lintDebt: 'defer' } } });
  assert.equal(v2.rejectCode, 'HEAL_LINT_NOT_CLEARED', 'a heal of a node named by ESCALATION_WITHOUT_CHECKS must clear that finding'); assert.match(v2.stages.at(-1).detail, /ESCALATION_WITHOUT_CHECKS@conf/);
  const noWaiver = { ...esc, waivers: [], touched: [] };
  const v3 = await runVerify(w, { base: wf.records, proposal: noWaiver, extra: { stages: ['V0', 'V1'], policy: { lintDebt: 'defer' } } });
  assert.equal(v3.rejectCode, 'HEAL_LINT_NEW_WARNING'); assert.match(v3.stages.at(-1).detail, /CLASS_ABOVE_DEFAULT_UNJUSTIFIED@conf/);
});

test('records: V0 rejects a literal leak, an unsafe addition and a candidate that is not the compilation of its ops', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'records', recordsFlip), { wf, trial, incident } = w;
  const task = incident.tasks[trial.key].task;
  const sentence = task.inputs.source_notes.split('\n').find(l => /BRIGHTDESK/.test(l) && l.length > 60).slice(0, 160);
  const leaky = proposalFrom(w, wf.records, [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: `Remember: ${sentence}` }]);
  const v = await runVerify(w, { base: wf.records, proposal: leaky, extra: { stages: ['V0'] } });
  assert.equal(v.rejectCode, 'HEAL_LITERAL_LEAK'); assert.match(v.stages[0].detail, /rule 1/);
  const pair = proposalFrom(w, wf.records, [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'BRIGHTDESK is always DMY, so read its numeric dates day first.' }]);
  assert.equal((await runVerify(w, { base: wf.records, proposal: pair, extra: { stages: ['V0'] } })).rejectCode, 'HEAL_LITERAL_LEAK');
  const general = proposalFrom(w, wf.records, [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'A worked example in the notes decides a system numeric date order; the name of a locale does not.' }]);
  assert.equal((await runVerify(w, { base: wf.records, proposal: general, extra: { stages: ['V0'] } })).stages[0].ok, true, 'a general rule passes the scan');
  const forged = { ...general, workflow: { ...general.workflow, title: 'forged' } };
  assert.equal((await runVerify(w, { base: wf.records, proposal: forged, extra: { stages: ['V0'] } })).rejectCode, 'HEAL_COMPILE_INVALID');
  const unsafe = proposalFrom(w, wf.records, [{ op: 'patch_code_node', node: 'split', source: wf.records.nodes.find(n => n.id === 'split').source + '\nconst x = eval("1");\n', assertionTrial: KEY, assertionPath: 'ids', assertionEqualsJson: '[]' }]);
  assert.equal((await runVerify(w, { base: wf.records, proposal: unsafe, extra: { stages: ['V0'] } })).rejectCode, 'HEAL_CODE_UNSAFE');
});

test('records: a patch whose live answers are wrong fails V3; one that breaks a passing run fails V4 as a regression', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'records', recordsFlip), { kit, wf, incident } = w;
  const proposal = proposalFrom(w, wf.records, KSAMPLE), policy = { lintDebt: 'defer' };
  const wrong = script(kit, {});   // the recorded (wrong) answers: the two readers agree on MDY and the failing case still fails
  const v3 = await runVerify(w, { base: wf.records, proposal, extra: { providers: { 'claude-cli': wrong }, policy, stages: ['V0', 'V1', 'V2', 'V3'] } });
  assert.equal(v3.rejectCode, 'HEAL_FAILING_CASE_STILL_FAILS'); assert.match(v3.stages.at(-1).detail, /s6001/);
  const failing = new Set(incident.failing.map(t => t.runId)), victim = incident.passing.find(t => t.key.includes('s6002/0')), victimNotes = (await w.ctx0.journal.forRun(victim.runId)).find(r => r.nodeKey === 'root/conf').request.prompt;
  const key = notesKey({ prompt: victimNotes });
  const broken = script(kit, { fixRuns: failing, fix: fixBd, override: (args, v, k) => k === key ? breakAtlas(v) : undefined });
  const v4 = await runVerify(w, { base: wf.records, proposal, extra: { providers: { 'claude-cli': broken }, policy, stages: ['V0', 'V1', 'V2', 'V3', 'V4'] } });
  assert.equal(v4.rejectCode, 'HEAL_REGRESSION', JSON.stringify(v4.stages.at(-1))); assert.match(v4.stages.at(-1).detail, /s6002/);
  assert.equal(decide(v4, proposal).decision, 'reject');
});

test('records: with no provider a changed model node leaves V3 pending (never a pass); the decision is pending', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'records', recordsFlip), { wf } = w;
  const proposal = proposalFrom(w, wf.records, KSAMPLE);
  const v = await runVerify(w, { base: wf.records, proposal, extra: { policy: { lintDebt: 'defer' }, stages: ['V0', 'V1', 'V2', 'V3'] } });
  assert.equal(v.ok, false); assert.equal(v.pending, true); assert.equal(v.rejectCode, null);
  assert.equal(v.stages.at(-1).ok, null); assert.equal(v.stages.at(-1).code, 'HEAL_NEEDS_LIVE');
  assert.deepEqual(decide(v, proposal), { decision: 'pending', reasons: ['V3:HEAL_NEEDS_LIVE'] });
  const noFresh = await runVerify(w, { base: wf.records, proposal: proposalFrom(w, wf.records, [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'A worked example decides a system numeric date order.' }]), extra: { providers: null, stages: ['V7'], policy: { fresh: { enabled: false } } } });
  assert.equal(noFresh.pending, true); assert.equal(noFresh.stages.at(-1).code, 'HEAL_FRESH_NOT_RUN');
});

test('records: the mechanical lint-debt proposal passes every stage, V5 shows the acceptance now discriminates, and the lineage head moves by compare-and-swap', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'records', recordsFlip), { kit, wf, gate } = w;
  const m = mechanicalProposal({ base: wf.records, baseHash: digest(wf.records), lint: gate.lintWorkflow(wf.records, { modelPolicy: w.policy }), env: envOf(w) }), proposal = m.proposal;
  assert.equal(proposal.kind, 'lint-debt');
  const v = await runVerify(w, { base: wf.records, proposal, extra: { policy: { fresh: { enabled: true, n: 4, k: 1 } }, hooks: freshHook() } });
  assert.deepEqual(v.stages.filter(s => s.ok !== true).map(s => [s.id, s.code, s.detail]), [], 'every stage passes');
  const v5 = v.stages.find(s => s.id === 'V5'); assert.equal(v5.grade, 'gating'); assert.ok(v5.rejectsBad >= 1, `the gating acceptance rejects ${v5.rejectsBad} of ${v5.badControls} bad controls`);
  const d = decide(v, proposal); assert.equal(d.decision, 'promote');
  const dir = mkdtempSync(path.join(tmpdir(), 'heal-lin-')), lineage = new Lineage({ kit, dir, file: path.join(dir, 'lineage.jsonl') });
  try {
    lineage.open(wf.records);
    const r = lineage.promote({ proposal, verification: v, decision: d, kitHash: kit.kitHash, lintPin: { commit: gate.commit }, policyHash: kit.ownerPolicyHash });
    assert.equal(r.version, 2); assert.equal(gate.lintWorkflow(lineage.head(wf.records.id).workflow, { modelPolicy: w.policy }).counts.error, 0, 'the promoted head has no lint errors');
    assert.equal(lineage.lines()[0].proposer.mechanical.length, 3);
    const head = lineage.head(wf.records.id).workflow, ctx = await openCtx(w.trial.source, { kit, name: 'head' });
    try { const passing = w.incident.passing.find(t => t.key.includes('s6002/0')), r2 = await replayRun(ctx, head, passing); assert.equal(gate.verdictOf(r2.run, { workflow: head }).verdict, 'pass', 'a recorded passing run can now be called a pass'); } finally { ctx.close(); }
  } finally { lineage.close(); }
});

test('V5 pins the answer chain: records pins merge, codefix pins fix, repair and answer; unrelated nodes keep replaying', { skip: skipReason }, async () => {
  const { wf } = await world();
  const outputs = { merge: { records: [], expected_active: [1] }, split: { ids: [1] } };
  const r = pinChain(wf.records, outputs, ['records'], { records: [{ a: 1 }] });
  assert.deepEqual(r.pinned.sort(), ['answer', 'merge']);
  assert.equal(r.workflow.nodes.find(n => n.id === 'merge').kind, 'code'); assert.match(r.workflow.nodes.find(n => n.id === 'merge').source, /expected_active/, 'other recorded fields stay');
  assert.equal(r.workflow.nodes.find(n => n.id === 'conf').kind, 'agent');
  const c = pinChain(wf.codefix, { check1: { ok: true } }, ['patched_source'], { patched_source: 'x' });
  assert.deepEqual(c.pinned.sort(), ['answer', 'fix', 'repair']);
  assert.deepEqual(c.workflow.nodes.find(n => n.id === 'repair').when, wf.codefix.nodes.find(n => n.id === 'repair').when, 'a pinned node keeps its when and join');
  assert.equal(c.workflow.nodes.find(n => n.id === 'answer').join, 'all_resolved');
});

test('V8: the grader hash covers the bed, the shared libraries and the pinned gate; a changed grader rejects', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'records', recordsFlip), { wf } = w;
  const a = gradersHash('records'), b = gradersHash('records'), c = gradersHash('codefix');
  assert.equal(a.hash, b.hash); assert.notEqual(a.hash, c.hash); assert.ok(a.files > 10);
  const proposal = proposalFrom(w, wf.records, [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'A worked example decides the order.' }]);
  const v = await runVerify(w, { base: wf.records, proposal, extra: { stages: ['V8'], hooks: { graders: () => ({ hash: 'changed', files: 1 }) } } });
  assert.equal(v.rejectCode, 'HEAL_GRADER_CHANGED');
  const same = await runVerify(w, { base: wf.records, proposal, extra: { stages: ['V8'] } });
  assert.equal(same.stages.at(-1).ok, true);
});
