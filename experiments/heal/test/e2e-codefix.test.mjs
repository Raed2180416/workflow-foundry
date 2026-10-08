import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { incidentFor, codefixFlip, proposalFrom, freshHook, runVerify, envOf } from './fixtures.mjs';
import { decide, Lineage } from '../promote.mjs';
import { healIncident } from '../heal.mjs';
import { clone, digest } from '../ir.mjs';
import { skipReason } from './helpers.mjs';

const KEY = 'F-haiku/codefix:test:d3:s6004/0';
// acceptance for the codefix lint debt: the candidate parses, the visible tests pass and the test file loads. A strong, answer-reading check.
const GATE = { op: 'all', conditions: [{ op: 'eq', left: { $ref: 'nodes.check1.compile_error' }, right: null }, { op: 'eq', left: { $ref: 'nodes.check1.failed' }, right: [] }, { op: 'eq', left: { $ref: 'nodes.check1.test_error' }, right: null }] };

// check1 with the signature comparison made shape-only: names, order, kinds and the COUNT of defaults, not default values
const relaxed = src => src.replace('def _run_tests(', 'def _shape(sig):\n    if sig == "class":\n        return sig\n    return {**sig, "defaults": len(sig["defaults"])}\n\n\ndef _run_tests(')
  .replace('elif sig != "class" and cand_api[key] != sig:', 'elif sig != "class" and _shape(cand_api[key]) != _shape(sig):');
const blind = src => src.replace('problems.append("signature changed: " + key)', 'pass');   // over-relaxed: any signature change is accepted
const quoteOf = task => (task.inputs.bug_report.split('\n').find(l => /default/.test(l) && l.length > 40) ?? '').trim();

test('codefix, the designed sequence: lint debt (owner approves) then relax the over-strict check (owner approves); every gate passes on the recorded runs at $0', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'codefix', codefixFlip), { kit, gate, wf, incident } = w;
  assert.deepEqual(incident.failing.map(t => t.key), ['F-haiku/codefix:test:d3:s6001/0', 'F-haiku/codefix:test:d3:s6004/0', 'F-haiku/codefix:test:d3:s6004/1']);
  assert.equal(incident.passing.length, 8);
  const dir = mkdtempSync(path.join(tmpdir(), 'heal-cfx-')), lineage = new Lineage({ kit, dir: path.join(dir, 'state'), file: path.join(dir, 'lineage.jsonl') });
  try {
    lineage.open(wf.codefix);
    // 1. lint debt: the acceptance only checks that an answer exists; the proposer supplies a check a wrong answer can fail
    const debt = proposalFrom(w, wf.codefix, [{ op: 'strengthen_acceptance', via: 'check', conditionJson: JSON.stringify(GATE) }], { kind: 'lint-debt' });
    const v1 = await runVerify(w, { base: wf.codefix, proposal: debt, extra: { hooks: freshHook() } });
    assert.deepEqual(v1.stages.filter(s => s.ok !== true).map(s => [s.id, s.code, s.detail]), []);
    const v5 = v1.stages.find(s => s.id === 'V5'); assert.equal(v5.grade, 'gating'); assert.ok(v5.rejectsBad >= 1);
    const d1 = decide(v1, debt); assert.equal(d1.decision, 'owner-review', 'a proposer-supplied acceptance is beyond the mechanical forms');
    lineage.queueReview({ proposal: debt, verification: v1, decision: d1 });
    assert.equal(lineage.approveReview({ proposal: debt, verification: v1, owner: 'owner' }).version, 2);
    const head = lineage.head(wf.codefix.id);
    assert.equal(gate.lintWorkflow(head.workflow, { modelPolicy: w.policy }).counts.error, 0);

    // 2. the defect: relax the over-strict check, with the task's own words and the mutant battery
    const quote = quoteOf(w.task.task);
    assert.ok(quote.length > 40, quote);
    const relax = proposalFrom(w, head.workflow, [{ op: 'relax_check', node: 'check1', target: 'source', source: relaxed(wf.codefix.nodes.find(n => n.id === 'check1').source), justificationQuote: quote, excerptId: 'bug_report', battery: 'python-signature', justifiedClass: 'default-value-changed' }]);
    assert.deepEqual(relax.touched.sort(), ['check1', 'check2'], 'the clone group is one locus');
    assert.ok(relax.workflow.nodes.find(n => n.id === 'check2').source.includes('_shape'));
    const v2 = await runVerify(w, { base: head.workflow, proposal: relax, extra: { hooks: freshHook() } });
    assert.deepEqual(v2.stages.filter(s => s.ok !== true).map(s => [s.id, s.code, s.detail]), []);
    const proof = v2.stages.find(s => s.id === 'V2').proofs[0]; assert.equal(proof.type, 'relax'); assert.equal(proof.quoteFound, true); assert.ok(proof.mutants >= 6); assert.deepEqual(proof.violations, []);
    const v3 = v2.stages.find(s => s.id === 'V3'); assert.equal(v3.trials.length, 3); assert.ok(v3.trials.every(t => t.deterministic), 'no node prompt changed: every call replays');
    assert.ok(v2.data.replicas.every(r => r.rows.every(x => x.pass && x.liveCalls === 0 && x.calls <= 1)), 'all three failed trials now pass, without the Opus repair');
    assert.ok(v2.costRatio < 1, `the heal makes the workflow cheaper: ratio ${v2.costRatio}`);
    assert.equal(v2.stages.find(s => s.id === 'V4').falseAlarms, 0);
    const d2 = decide(v2, relax); assert.equal(d2.decision, 'owner-review'); assert.match(d2.reasons[0], /relax_check/);
    assert.equal(lineage.head(wf.codefix.id).workflow.version, 2, 'nothing moved before the owner approved');
    lineage.queueReview({ proposal: relax, verification: v2, decision: d2 });
    assert.equal(lineage.approveReview({ proposal: relax, verification: v2, owner: 'owner' }).version, 3);
    assert.deepEqual(lineage.lines().map(l => l.type), ['review', 'promote', 'review', 'promote']);
  } finally { lineage.close(); }
});

test('codefix: an over-relaxed check, an unquoted justification and a patch to an over-strict check are all refused in V2', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'codefix', codefixFlip), { wf } = w, src = wf.codefix.nodes.find(n => n.id === 'check1').source, quote = quoteOf(w.task.task);
  const base = { op: 'relax_check', node: 'check1', target: 'source', excerptId: 'bug_report', battery: 'python-signature', justifiedClass: 'default-value-changed', justificationQuote: quote };
  const stages = ['V0', 'V1', 'V2'], policy = { lintDebt: 'defer' };
  const blindP = proposalFrom(w, wf.codefix, [{ ...base, source: blind(src) }]);
  const v = await runVerify(w, { base: wf.codefix, proposal: blindP, extra: { stages, policy } });
  assert.equal(v.rejectCode, 'HEAL_RELAX_UNPROVEN'); assert.match(v.stages.at(-1).detail, /caught by the old check and is accepted by the new one/);
  const noQuote = proposalFrom(w, wf.codefix, [{ ...base, source: relaxed(src), justificationQuote: 'Default values may change freely whenever a patch seems to need it.' }]);
  const v2 = await runVerify(w, { base: wf.codefix, proposal: noQuote, extra: { stages, policy } });
  assert.equal(v2.rejectCode, 'HEAL_RELAX_UNPROVEN'); assert.match(v2.stages.at(-1).detail, /not in the task contract/);
  const patch = proposalFrom(w, wf.codefix, [{ op: 'patch_code_node', node: 'check1', source: relaxed(src), assertionTrial: KEY, assertionPath: 'ok', assertionEqualsJson: 'true' }]);
  const v3 = await runVerify(w, { base: wf.codefix, proposal: patch, extra: { stages, policy } });
  assert.equal(v3.rejectCode, 'HEAL_RELAX_UNPROVEN'); assert.match(v3.stages.at(-1).detail, /use relax_check/);
  const nope = proposalFrom(w, wf.codefix, [{ ...base, source: relaxed(src) }]);
  nope.workflow.nodes.find(n => n.id === 'check1').source += '\nimport subprocess\n';
  nope.candidateHash = digest(nope.workflow);
  assert.equal((await runVerify(w, { base: wf.codefix, proposal: nope, extra: { stages: ['V0'] } })).rejectCode, 'HEAL_COMPILE_INVALID', 'a candidate that is not the compilation of its ops');
});

test('heal driver on codefix, offline: detect, localise, lint-debt needs a proposer, a scripted relax proposal passes every gate but is blocked by the open lint debt', { skip: skipReason }, async () => {
  const w = await incidentFor(KEY, 'codefix', codefixFlip), { wf } = w, src = wf.codefix.nodes.find(n => n.id === 'check1').source;
  const dir = mkdtempSync(path.join(tmpdir(), 'heal-drv-')), script = path.join(dir, 'proposer.json');
  const ops = [{ op: 'relax_check', node: 'check1', target: 'source', source: relaxed(src), excerptId: 'bug_report', battery: 'python-signature', justifiedClass: 'default-value-changed', justificationQuote: quoteOf(w.task.task) }];
  writeFileSync(script, JSON.stringify([{ rationale: 'The check compares default VALUES; the bug report says a default value is wrong, so only the number of defaults may be compared.', citations: ['F1'], ops }]));
  const out = await healIncident({ run: KEY, workflow: 'research/construction-20261006/artifacts/F-haiku-codefix-k1/workflow.json', budgetUsd: 0.5, proposer: `scripted:${script}`, stateDir: path.join(dir, 'state'), lineageFile: path.join(dir, 'lineage.jsonl'),
    runsDir: path.join(dir, 'runs'), lessonsDir: path.join(dir, 'lessons'), writeLessons: true, vacuity: false, hooks: freshHook() });
  assert.equal(out.classification.class, 'workflow-defect'); assert.equal(out.localisation.root.node, 'check1'); assert.deepEqual(out.localisation.classes.map(c => c.code), ['OVERSTRICT_CHECK', 'CHECK_VETO_ROUTING']);
  assert.deepEqual(out.lintDebt.needsProposer, ['ACCEPTANCE_EXISTENCE_ONLY']); assert.deepEqual(out.lintDebt.ops, []);
  assert.deepEqual(out.proposer.allowed, ['relax_check', 'edit_instructions', 'add_probe']);
  const d = out.decisions.at(-1);
  assert.equal(d.kind, 'defect'); assert.deepEqual(d.stages.map(s => s.ok), Array(9).fill(true), JSON.stringify(d.stages.filter(s => s.ok !== true)));
  assert.equal(d.decision, 'blocked'); assert.equal(out.result.decision, 'blocked');
  assert.equal(out.head.version, 1, 'dry run: nothing promoted'); assert.equal(out.budget.spentUsd, 0, 'no live call, no spend');
  assert.equal(out.lesson.lesson, 'L-2'); assert.equal(out.lesson.firing.firesOnBase, true); assert.equal(out.lesson.firing.quietOnHealed, false, 'the lint rule is about the routing, which the relaxation did not change');
  assert.ok(out.lesson.file.endsWith('.json'));
  assert.equal(out.proposerRounds.length, 1); assert.equal(out.proposerRounds[0].class, 'M');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'state', 'proposals', `${d.proposal}.json`), 'utf8')).decision.decision, 'blocked');
});
