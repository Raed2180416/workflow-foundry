// Regression tests for the defects the first LIVE heal runs exposed (2026-10-08). None calls a model.
//   1. the literal-leak scanner treated a k-sample clone as new content (rule 3 fired on the schema's own enum values)
//   2. a code-node root (a check) had no journaled prompt, so the proposer's brief carried no evidence at all
//   3. the brief named the fields of each op but not their grammar, so most proposer rounds died at compile
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileOps } from '../ops.mjs';
import { addedContent, scanLeaks, buildLeakIndex } from '../scan.mjs';
import { excerptsFrom, codeRootEvidence, opGuide, EXCERPT_WIDTH } from '../propose.mjs';
import { world, skipReason } from './helpers.mjs';

const envOf = (kit, gate) => { const policy = kit.sessionPolicy(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']); return { policy, env: { classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong } }; };

test('scan: a k-sample clone repeats the base node, so only text the patch really adds is scanned (and a real leak is still caught)', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), { env } = envOf(kit, gate);
  const c = compileOps(wf.records, [{ op: 'k_sample_agreement', node: 'conf', k: 2, onDisagree: 'escalate' }], env);
  assert.deepEqual(c.errors, []);
  // the base conf schema holds the system names next to the order enum: a hidden-truth pair for it would match inside the clone's `returns`
  const index = buildLeakIndex({ tasks: [], truthPairs: [{ id: 'BRIGHTDESK', value: 'DMY' }], publicTexts: [], baseWorkflow: null });
  const added = addedContent(wf.records, c.workflow);
  assert.ok(!added.some(a => a.path === 'conf__s1.returns'), 'the clone of conf does not add its own schema');
  assert.deepEqual(scanLeaks(wf.records, c.workflow, index), [], 'no leak from repeating the base node');
  // text that really is added is still scanned
  const leaky = compileOps(wf.records, [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'BRIGHTDESK writes DMY.' }], env);
  assert.deepEqual(leaky.errors, []);
  assert.equal(scanLeaks(wf.records, leaky.workflow, index)[0]?.rule, 3);
  // and so is text added to a sibling's own instructions
  const sib = structuredClone(c.workflow); sib.nodes.find(n => n.id === 'conf__s2').instructions += '\nBRIGHTDESK uses DMY.';
  assert.equal(scanLeaks(wf.records, sib, index)[0]?.rule, 3);
});

test('excerptsFrom: sources marked always give their first two windows; roundRobin spreads the windows over the sources', () => {
  const statement = 'S'.repeat(1000), long = ('x Vocabulary x '.repeat(80));
  const sources = [{ label: 'task statement', text: statement, always: true }, { label: 'a', text: long }, { label: 'b', text: 'the Vocabulary doc' }, { label: 'c', text: 'no match here' }];
  const flat = excerptsFrom(sources, ['Vocabulary'], { roundRobin: false });
  assert.ok(flat.filter(e => e.label === 'task statement').length === 2, 'two windows of the statement');
  assert.ok(flat.every(e => e.text.length <= EXCERPT_WIDTH));
  const rr = excerptsFrom(sources, ['Vocabulary'], { roundRobin: true });
  assert.deepEqual(rr.map(e => e.label), ['task statement', 'task statement', 'a', 'b'], 'a long source cannot crowd the others out; a source without the token is skipped');
  assert.ok(rr.length <= 8);
});

test('codeRootEvidence: tokens are the identifiers the root\'s own failure report names; the statement and every string input are sources', () => {
  const ev = codeRootEvidence({ task: { prompt: 'fix it', inputs: { source: 'class Vocabulary: pass', n: 3, notes: 'doc' } },
    output: { ok: false, problems: ['signature changed: Vocabulary.__init__'], passed: ['test_everything_here'], failed: [] } });
  assert.deepEqual(ev.tokens.sort(), ['Vocabulary', '__init__']);
  assert.deepEqual(ev.sources.map(s => s.label), ['task statement', 'task input source', 'task input notes']);
  assert.equal(ev.sources[0].always, true);
  assert.deepEqual(codeRootEvidence({ task: { prompt: 'p' }, output: null }).tokens, []);
});

test('opGuide: valid refs and field names come from the locus node; every field of an allowed op is explained', { skip: skipReason }, async () => {
  const { wf } = await world();
  const guide = opGuide({ workflow: wf.records, loci: [{ node: 'conf' }], allowedOps: ['add_evidence_field', 'k_sample_agreement', 'add_check', 'escalate_class', 'edit_instructions', 'add_probe', 'not_an_op'], failingRunKeys: ['arm/key/0'] });
  assert.deepEqual(Object.keys(guide), ['add_evidence_field', 'k_sample_agreement', 'add_check', 'escalate_class', 'edit_instructions', 'add_probe']);
  assert.ok(guide.add_evidence_field.includes('input.inputs.source_notes'), 'the valid context ref is listed');
  assert.ok(guide.k_sample_agreement.includes('"orders"') && /no dots/.test(guide.k_sample_agreement));
  assert.ok(/"\$ref":"output\./.test(guide.add_check) && /cannot iterate/.test(guide.add_check));
  const relax = opGuide({ workflow: wf.codefix, loci: [{ node: 'check1' }], allowedOps: ['relax_check'], failingRunKeys: ['arm/key/0'] });
  assert.ok(relax.relax_check.includes('arm/key/0') && relax.relax_check.includes('default-value-changed'));
});

test('scan precision: a phrase that recurs across the family and a schema bound are not leaks; a task-only phrase and a task-only constant still are', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), { env } = envOf(kit, gate);
  const failing = { prompt: 'Merge the legacy lists.', inputs: { source_notes: 'The system\'s name is printed first. Quarterly zebra ledger amounts: 6417 and 600 units.' }, files: {} };
  const othersTask = { prompt: 'Merge the legacy lists.', inputs: { source_notes: 'The system\'s name is printed first. Another table with 600 rows.' }, files: {} };
  const mk = publicTexts => buildLeakIndex({ tasks: [failing], publicTexts: publicTexts.flatMap(t => taskTextsOf(t)), baseWorkflow: null });
  const taskTextsOf = t => [t.prompt, ...Object.values(t.inputs)];
  const scan = (index, ops) => { const c = compileOps(wf.records, ops, env); assert.deepEqual(c.errors, [], JSON.stringify(c.errors)); return scanLeaks(wf.records, c.workflow, index); };
  const template = [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'Quote the sentence that says how the system\'s name is printed.' }];
  assert.equal(scan(mk([]), template)[0]?.rule, 1, 'without the other tasks the shared phrase looks copied');
  assert.deepEqual(scan(mk([othersTask]), template), [], 'a phrase that also occurs in another task of the family is a template constant');
  const secret = [{ op: 'edit_instructions', node: 'conf', mode: 'append', text: 'Remember the quarterly zebra ledger amounts.' }];
  assert.equal(scan(mk([othersTask]), secret)[0]?.rule, 1, 'a phrase only the failing task has is still a leak');
  const bound = [{ op: 'add_evidence_field', node: 'conf', field: 'order_quote', maxLength: 600, instruction: 'Copy the deciding sentence.', source: 'input.inputs.source_notes' }];
  assert.deepEqual(scan(mk([]), bound), [], 'maxLength 600 is a schema bound, not a number of the failing task');
  const constant = [{ op: 'add_check', node: 'conf', conditionJson: JSON.stringify({ op: 'ne', left: { $ref: 'output.orders' }, right: '6417' }) }];
  assert.equal(scan(mk([]), constant)[0]?.rule, 2, 'a check constant equal to a number of the failing task is still a leak');
});
