import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RULES, lessonFor, writeLesson, population, measureRule, severityFor, LESSON_OF } from '../learn.mjs';
import * as L1 from '../lessons/rules/fragile-global-read.mjs';
import * as L2 from '../lessons/rules/check-veto-ungated.mjs';
import * as L3 from '../lessons/rules/check-self-exemption.mjs';
import { compileOps } from '../ops.mjs';
import { acceptedCalls, openCtx } from '../replay.mjs';
import { clone } from '../ir.mjs';
import { world, skipReason, modelIds, byKey } from './helpers.mjs';

const envOf = (kit, gate) => { const policy = kit.sessionPolicy(modelIds); return { classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong }; };

test('L-1 FRAGILE_GLOBAL_READ fires on the records base (an error once the probe measures >= 5%), and is quiet on the healed heads', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), env = envOf(kit, gate);
  assert.equal(L1.check(wf.records)[0].severity, 'warning', 'structural only');
  assert.equal(L1.check(wf.records, { fragility: { conf: 0.31 } })[0].severity, 'error');
  assert.equal(L1.check(wf.records, { fragility: { conf: 0.01 } })[0].severity, 'warning');
  const k = compileOps(wf.records, [{ op: 'k_sample_agreement', node: 'conf', k: 2, onDisagree: 'escalate' }], env).workflow;
  const e = compileOps(wf.records, [{ op: 'add_evidence_field', node: 'conf', field: 'evidence', maxLength: 400, instruction: 'Quote the deciding sentence.', source: 'input.inputs.source_notes' }], env).workflow;
  assert.deepEqual(L1.check(k, { fragility: { conf: 0.31 } }), [], 'k-sample agreement guards the read');
  assert.deepEqual(L1.check(e, { fragility: { conf: 0.31 } }), [], 'an evidence check guards the read');
  assert.deepEqual(L1.check(wf.codefix), []); assert.deepEqual(L1.check(wf.p1), []);
  assert.deepEqual(L1.conventionLeaves(wf.records.nodes.find(n => n.id === 'conf').returns).map(l => l.field), ['numeric_order', 'sign_flip']);
});

test('L-1 PROBE_VALUE_COVERAGE on the recorded C0 construction probes: no BRIGHTDESK numeric order other than MDY was ever exercised', { skip: skipReason }, async () => {
  const { kit, trials, wf } = await world();
  const probes = trials.filter(t => t.armId === 'F-haiku' && t.family === 'records' && t.kind === 'probes');
  assert.equal(probes.length, 3);
  const ctx = await openCtx('c0-dev', { kit, name: 'cov' });
  try {
    const outputs = probes.flatMap(t => acceptedCalls(ctx.journal, t.runId).filter(r => r.nodeKey === 'root/conf').map(r => r.response.value));
    const cov = L1.coverage(wf.records.nodes.find(n => n.id === 'conf').returns, outputs);
    assert.equal(cov.probes, 3);
    const bd = cov.rows.find(r => r.entity === 'BRIGHTDESK' && r.field === 'numeric_order');
    assert.deepEqual(bd.values, ['MDY'], 'the probes only ever showed MDY for BRIGHTDESK: the DMY branch was never exercised');
    assert.equal(bd.covered, false);
    assert.ok(cov.uncovered.includes('BRIGHTDESK.numeric_order'));
  } finally { ctx.close(); }
});

test('L-2 CHECK_VETO_UNGATED fires on the codefix base and is quiet once a gate reads the check', { skip: skipReason }, async () => {
  const { wf } = await world();
  const f = L2.check(wf.codefix);
  assert.equal(f.length, 1); assert.equal(f[0].node, 'check1'); assert.deepEqual(f[0].details, { router: 'repair', selectors: ['answer'] });
  const gated = clone(wf.codefix); gated.acceptance.push({ op: 'eq', left: { $ref: 'nodes.check1.failed' }, right: [] });
  assert.deepEqual(L2.check(gated), []);
  assert.deepEqual(L2.check(wf.records), []); assert.deepEqual(L2.check(wf.p1), []);
});

test('L-3 CHECK_SELF_EXEMPTION fires on records-v3 (relation none exempts meaning) and is quiet once every branch reads the decision field', { skip: skipReason }, async () => {
  const { wf } = await world();
  const f = L3.check(wf.p1).filter(x => x.path.endsWith('statuses.judge'));
  assert.equal(f.length, 1); assert.equal(f[0].details.exemptedBy, 'relation'); assert.ok(f[0].details.fields.includes('meaning'));
  const healed = clone(wf.p1), judge = healed.nodes.find(n => n.id === 'statuses').body.nodes.find(n => n.id === 'judge');
  const any = judge.checks[2];
  any.conditions[0] = { op: 'all', conditions: [any.conditions[0], { op: 'eq', left: { $ref: 'output.compared_with' }, right: 'none' }, { op: 'any', conditions: [{ op: 'eq', left: { $ref: 'output.meaning' }, right: 'void' }, { op: 'eq', left: { $ref: 'output.meaning' }, right: 'live' }] }] };
  assert.deepEqual(L3.check(healed).filter(x => x.path.endsWith('statuses.judge')), []);
  assert.deepEqual(L3.check(wf.records), []); assert.deepEqual(L3.check(wf.codefix), []);
});

test('lessonFor: pattern, rule spec with a reference implementation, template diff (not applied), probe requirement and measured firing', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), env = envOf(kit, gate);
  const healed = compileOps(wf.records, [{ op: 'k_sample_agreement', node: 'conf', k: 2, onDisagree: 'escalate' }], env).workflow;
  const pop = [...population(), { name: 'records-v3', workflow: wf.p1 }];
  assert.ok(pop.length >= 7);
  const lesson = lessonFor({ incidentId: 'records-x', classes: [{ code: 'UNGUARDED_GLOBAL_READ', node: 'conf' }], base: wf.records, healed, population: pop, fragility: { conf: 0.31 }, signalCounts: { ORACLE_FAILED: 2 } });
  assert.equal(lesson.schema, 'heal-lesson/1'); assert.equal(lesson.lesson, 'L-1'); assert.equal(lesson.status, 'proposed'); assert.equal(lesson.templateDiff.applied, false);
  assert.equal(lesson.firing.firesOnBase, true); assert.equal(lesson.firing.quietOnHealed, true);
  assert.ok(lesson.firing.population.fires >= 1 && lesson.firing.population.n === pop.length);
  assert.equal(lesson.lintRule.implementation, 'experiments/heal/lessons/rules/fragile-global-read.mjs');
  assert.equal(lesson.pattern.signature.node, 'conf');
  assert.match(lesson.templateDiff.text, /skills\/micro-harness/); assert.match(lesson.probeRequirement, /PROBE_VALUE_COVERAGE/);
  assert.ok(lesson.caveats.some(c => /predicts nothing/.test(c)) && lesson.caveats.some(c => /new kit hash/.test(c)));
  const dir = mkdtempSync(path.join(tmpdir(), 'heal-lessons-')), file = writeLesson(lesson, dir);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).id, lesson.id);
  assert.equal(lessonFor({ incidentId: 'x', classes: [{ code: 'MODEL_VARIANCE' }], base: wf.records }), null, 'no lesson for a pattern that has none');
  assert.deepEqual(Object.keys(LESSON_OF).sort(), ['CHECK_ESCAPE_HATCH', 'CHECK_VETO_ROUTING', 'OVERSTRICT_CHECK', 'UNGUARDED_GLOBAL_READ', 'UNGUARDED_ITEM_READ']);
});

test('severityFor: a rule that fires on most working workflows is downgraded, then dropped', () => {
  assert.equal(severityFor(0.05), 'error'); assert.equal(severityFor(0.25), 'warning'); assert.equal(severityFor(0.5), 'warning'); assert.equal(severityFor(0.75), 'dropped');
  assert.deepEqual(measureRule({ check: w => w.bad ? [1] : [] }, [{ name: 'a', workflow: { bad: 1 } }, { name: 'b', workflow: {} }]), { n: 2, fires: 1, share: 0.5, where: ['a'] });
});
