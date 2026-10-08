// Acceptance must gate (R-15, R-17): the strict construction lint, the acceptance grade and the run verdict.
// Development/diagnostic evidence about the checker itself. The lint rules come from the C0 dev artifacts, so
// these tests show that the rules fire as specified, not that they predict failures on new constructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { Foundry } from '../src/foundry.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow, validateDecision, workflowSchema } from '../src/validate.mjs';
import { lintWorkflow, LINT_RULES, LINT_PROFILE } from '../src/lint.mjs';
import { assessWorkflow, gradeAcceptance, isStrong } from '../src/acceptance.mjs';
import { verdictOf } from '../src/verdict.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loaded = loadPolicy(), registry = createDefaultRegistry();
const ref = r => ({ $ref: r });
const exists = r => ({ op: 'exists', value: ref(r) });
const eq = (left, right) => ({ op: 'eq', left: typeof left === 'string' ? ref(left) : left, right });

const wf = (nodes, acceptance, extra = {}) => ({ schemaVersion: '1.0', id: 'LintProbe', version: 1, title: 'Lint probe', goal: 'Probe the strict construction lint',
  domain: 'general', envelope: { assumptions: [], risks: [], successCriteria: ['probe'] }, budget: { maxSteps: 100, maxConcurrency: 2, maxDurationMs: 60000 }, nodes, acceptance, ...extra });
const code = (id, needs = [], args = {}, extra = {}) => ({ id, kind: 'code', needs, description: `code ${id}`, lang: 'js', source: `export default function main(input) { return { id: "${id}", value: 1, input }; }`, args, timeoutMs: 1000, ...extra });
const verify = (id, needs, subject, extra = {}) => ({ id, kind: 'verify', needs, description: `verify ${id}`, method: 'code', lang: 'js', source: 'export default ({ subject }) => ({ pass: true, score: 1, reasons: [] })', subject, independence: 'execution', timeoutMs: 1000, ...extra });
const returns = { type: 'object', additionalProperties: false, required: ['x'], properties: { x: { type: 'string', maxLength: 100 } } };
const agent = (id, extra = {}) => ({ id, kind: 'agent', needs: [], description: `agent ${id}`, role: 'extract', instructions: 'Read the thing.', returns, model: { class: 'M' }, ...extra });
const map = (id, needs, items, extra = {}) => ({ id, kind: 'map', needs, description: `map ${id}`, items, maxItems: 10, body: { nodes: [code('w')], acceptance: [exists('nodes.w')] }, ...extra });

const strict = (workflow, options = {}) => validateWorkflow(workflow, { registry, modelPolicy: loaded, strict: true, ...options });
const plain = workflow => validateWorkflow(workflow, { registry, modelPolicy: loaded });
const codesOf = result => result.lint.findings.map(f => f.code);
const find = (result, code) => result.lint.findings.filter(f => f.code === code);

test('acceptance: presence predicates are not gates, however they are spelled', () => {
  const weak = [
    exists('nodes.answer.records'),
    exists('nodes.check.pass'),                                                        // the key exists even when pass is false
    { op: 'ne', left: ref('nodes.answer.records'), right: null },
    { op: 'ne', left: '', right: ref('nodes.answer.text') },
    { op: 'ne', left: ref('nodes.answer.records'), right: [] },
    { op: 'gt', left: ref('nodes.answer.records.length'), right: 0 },
    { op: 'gte', left: ref('nodes.answer.count'), right: 1 },
    { op: 'lt', left: 0, right: ref('nodes.answer.records.length') },
    eq('nodes.answer.records', ref('nodes.answer.records')),                          // a value compared with itself
    { op: 'eq', left: 1, right: 1 },                                                     // constants say nothing about the run
    { op: 'all', conditions: [exists('nodes.a'), exists('nodes.b')] },
    { op: 'any', conditions: [exists('nodes.a'), eq('nodes.b.total', 3)] },              // a disjunction is as weak as its weakest branch
    { op: 'not', condition: { op: 'not', condition: exists('nodes.a') } }
  ];
  weak.forEach((condition, i) => assert.equal(isStrong(condition), false, `weak ${i}: ${JSON.stringify(condition)}`));
  const strong = [
    eq('nodes.check.pass', true),
    eq('nodes.answer.count', 3),
    { op: 'gte', left: ref('nodes.answer.count'), right: 3 },
    { op: 'gt', left: ref('nodes.answer.total'), right: 0 },
    { op: 'eq', left: ref('nodes.answer.count'), right: ref('input.expected') },
    { op: 'contains', left: ref('nodes.answer.ids'), right: 7 },
    { op: 'all', conditions: [exists('nodes.a'), eq('nodes.b.total', 3)] },
    { op: 'any', conditions: [eq('nodes.a.x', 1), eq('nodes.b.x', 2)] },
    { op: 'not', condition: exists('nodes.answer.error') },                              // "must be absent" can fail
    { op: 'not', condition: { op: 'ne', left: ref('nodes.a.x'), right: null } },
    { op: 'not', condition: { op: 'any', conditions: [exists('nodes.a'), eq('nodes.b.x', 1)] } }
  ];
  strong.forEach((condition, i) => assert.equal(isStrong(condition), true, `strong ${i}: ${JSON.stringify(condition)}`));
});

test('acceptance grade: a strong predicate, a strong assert or an independent gating verify that the answer depends on is a gate', () => {
  const answer = needs => code('answer', needs, { v: ref('nodes.merge.value') });
  const nodes = (...extra) => [code('merge'), ...extra, answer(['merge', ...extra.map(n => n.id)])];
  const grade = (flowNodes, acceptance, extra) => gradeAcceptance(wf(flowNodes, acceptance, extra));

  assert.equal(grade(nodes(), [exists('nodes.answer.v')]).grade, 'existence-only');
  assert.equal(grade(nodes(), [eq('nodes.answer.v', 1)]).grade, 'gating');
  const asserted = { id: 'inv', kind: 'assert', needs: ['merge'], description: 'invariant', checks: [eq('nodes.merge.value', 1)] };
  assert.deepEqual(grade(nodes(asserted), [exists('nodes.answer.v')]).gates.map(g => g.type), ['assert']);

  // A verify gates by default; it vouches for the answer only when the acceptance depends on what it checked.
  const gating = verify('check', ['merge'], ref('nodes.merge'));
  assert.deepEqual(grade(nodes(gating), [exists('nodes.answer.v')]).gates, [{ type: 'verify', node: 'check', independence: 'execution' }]);
  assert.equal(grade(nodes(verify('check', ['merge'], ref('nodes.merge'), { gate: false })), [exists('nodes.answer.v')]).grade, 'existence-only', 'a non-gating verify blocks nothing');
  assert.equal(grade(nodes(verify('check', ['merge'], { constant: 1 })), [exists('nodes.answer.v')]).grade, 'existence-only', 'verifying a constant vouches for nothing');
  const sameModel = grade(nodes({ id: 'check', kind: 'verify', needs: ['merge'], description: 'model check', method: 'agent', instructions: 'Is it right?', independence: 'same-model', subject: ref('nodes.merge'), model: { class: 'M' } }), [exists('nodes.answer.v')]);
  assert.equal(sameModel.grade, 'existence-only', 'the producer cannot certify itself');
  assert.deepEqual(sameModel.sameModel, ['check']);
  const stranger = [code('merge'), code('other'), verify('check', ['other'], ref('nodes.other')), answer(['merge'])];
  assert.equal(grade(stranger, [exists('nodes.answer.v')]).grade, 'existence-only', 'a verify of something the answer does not depend on is not a gate for it');
  assert.equal(grade(stranger, [exists('nodes.answer.v')]).grade, 'existence-only');
  const different = { id: 'check', kind: 'verify', needs: ['merge'], description: 'other family', method: 'agent', instructions: 'Is it right?', independence: 'different-model', subject: ref('nodes.merge'), model: { class: 'M' } };
  assert.equal(grade(nodes(different), [exists('nodes.answer.v')]).grade, 'gating');

  // A verify inside a body the answer depends on gates every item; under a collecting map its failures are only collected.
  const bodied = (collect, gate) => [map('rows', [], { $ref: 'input.items' }, { failure: collect, body: { nodes: [code('w'), verify('each', ['w'], ref('nodes.w'), { gate })], acceptance: [exists('nodes.w')] } }),
    code('answer', ['rows'], { n: ref('nodes.rows.count') })];
  assert.deepEqual(grade(bodied('fail_fast', true), [exists('nodes.answer.n')]).gates, [{ type: 'verify', node: 'rows.each', independence: 'execution' }]);
  assert.equal(grade(bodied('collect', true), [exists('nodes.answer.n')]).grade, 'existence-only', 'collected failures block nothing');
  assert.equal(grade(bodied('fail_fast', false), [exists('nodes.answer.n')]).grade, 'existence-only');

  // The explicit mode is its own grade, whatever else the acceptance holds.
  const none = { mode: 'none', reason: 'No executable oracle exists for a free-text summary; a person reads it.' };
  const declared = grade(nodes(), [exists('nodes.answer.v')], { oracle: none });
  assert.deepEqual([declared.grade, declared.code], ['no-oracle', 'NO_ORACLE_DECLARED']);
  assert.match(declared.reason, /free-text summary/);
  assert.equal(grade(nodes(), [eq('nodes.answer.v', 1)], { oracle: none }).grade, 'no-oracle');

  for (const bad of [undefined, null, {}, { acceptance: [] }, { acceptance: 'x' }]) assert.equal(gradeAcceptance(bad).grade, 'unassessed');
});

test('lint ACCEPTANCE_EXISTENCE_ONLY: an error in strict mode only; a strong predicate or the documented no-oracle mode clears it', () => {
  const weak = wf([code('answer')], [exists('nodes.answer.value')]);
  assert.equal(plain(weak).valid, true, 'default validation is unchanged, so frozen workflows still load');
  assert.equal(plain(weak).lint, undefined);
  const result = strict(weak);
  assert.equal(result.valid, false);
  assert.equal(result.strict, true);
  const [f] = find(result, 'ACCEPTANCE_EXISTENCE_ONLY');
  assert.equal(f.severity, 'error');
  assert.equal(f.path, 'workflow.acceptance');
  assert.equal(f.repair.action, 'strengthen-acceptance');
  assert.deepEqual(f.details.weak, ['exists nodes.answer.value']);
  assert.ok(result.errors.some(e => e.code === 'ACCEPTANCE_EXISTENCE_ONLY'), 'the error is in errors, so valid is false');
  assert.equal(result.hash, undefined, 'a workflow with strict errors has no hash');

  assert.equal(strict(wf([code('answer')], [eq('nodes.answer.value', 1)])).valid, true);

  const declared = strict(wf([code('answer')], [exists('nodes.answer.value')], { oracle: { mode: 'none', reason: 'No oracle exists: the answer is a free-text brief that a person reads.' } }));
  assert.equal(declared.valid, true, JSON.stringify(declared.errors));
  assert.deepEqual(codesOf(declared), ['NO_ORACLE_DECLARED']);
  assert.equal(declared.lint.findings[0].severity, 'warning');
  assert.equal(declared.lint.acceptance.grade, 'no-oracle');
  assert.ok(declared.warnings.some(w => w.code === 'NO_ORACLE_DECLARED'));

  const redundant = strict(wf([code('answer')], [eq('nodes.answer.value', 1)], { oracle: { mode: 'none', reason: 'Declared although the acceptance compares a value.' } }));
  assert.deepEqual(codesOf(redundant).sort(), ['NO_ORACLE_DECLARED', 'ORACLE_DECLARATION_REDUNDANT']);
});

test('lint VERIFY_NOT_GATING: a verify with gate:false that nothing reads cannot block the answer', () => {
  const nodes = [code('merge'), verify('check', ['merge'], ref('nodes.merge'), { gate: false }), code('answer', ['merge', 'check'], { v: ref('nodes.merge.value') })];
  const decorative = strict(wf(nodes, [eq('nodes.answer.v', 1)]));
  assert.equal(decorative.valid, false);
  const [f] = find(decorative, 'VERIFY_NOT_GATING');
  assert.deepEqual([f.severity, f.path, f.node, f.repair.action], ['error', 'workflow.check', 'check', 'gate-verify']);
  assert.equal(plain(wf(nodes, [eq('nodes.answer.v', 1)])).valid, true);

  // exists(check.pass) is satisfied by pass:false, so it does not count as reading the result.
  assert.equal(codesOf(strict(wf(nodes, [exists('nodes.check.pass')]))).includes('VERIFY_NOT_GATING'), true);
  // Reading the result through acceptance, an assert node or a when condition makes it a gate or control.
  assert.equal(codesOf(strict(wf(nodes, [eq('nodes.check.pass', true)]))).includes('VERIFY_NOT_GATING'), false);
  const asserted = [...nodes, { id: 'inv', kind: 'assert', needs: ['check'], description: 'must pass', checks: [eq('nodes.check.pass', true)] }];
  assert.equal(codesOf(strict(wf(asserted, [eq('nodes.answer.v', 1)]))).includes('VERIFY_NOT_GATING'), false);
  const routed = [nodes[0], nodes[1], { ...code('review', ['check']), when: eq('nodes.check.pass', false) }, code('answer', ['merge', 'check'], { v: ref('nodes.merge.value') })];
  assert.equal(codesOf(strict(wf(routed, [eq('nodes.answer.v', 1)]))).includes('VERIFY_NOT_GATING'), false, 'a failed verify that routes to review is not decorative');
  // The default is gating.
  assert.equal(codesOf(strict(wf([nodes[0], verify('check', ['merge'], ref('nodes.merge')), nodes[2]], [eq('nodes.answer.v', 1)]))).includes('VERIFY_NOT_GATING'), false);
  // In declared no-oracle mode an advisory verifier is a warning; in a discovery workflow the confirmer feeds the findings ledger.
  const advisory = strict(wf(nodes, [exists('nodes.answer.v')], { oracle: { mode: 'none', reason: 'Advisory check only; a person reads the brief.' } }));
  assert.deepEqual(find(advisory, 'VERIFY_NOT_GATING').map(x => x.severity), ['warning']);
  assert.equal(codesOf(strict(wf(nodes, [exists('nodes.answer.v')], { discovery: true }))).includes('VERIFY_NOT_GATING'), false);
  // A loop body is a flow of its own: until reads the verify.
  const loop = { id: 'again', kind: 'loop', needs: [], description: 'repair loop', maxIterations: 3, initial: 0, until: eq('nodes.check.pass', true),
    body: { nodes: [code('try'), verify('check', ['try'], ref('nodes.try'), { gate: false })], acceptance: [eq('nodes.check.pass', true)] } };
  assert.equal(codesOf(strict(wf([loop], [eq('nodes.again.iterations', 1)]))).includes('VERIFY_NOT_GATING'), false);
});

test('lint ERROR_COLLECTION: a map that collects failures needs a gate on the recorded failed count', () => {
  const nodes = collect => [code('prep'), map('rows', ['prep'], ref('nodes.prep.input'), { failure: 'collect', ...collect }), code('answer', ['rows'], { n: ref('nodes.rows.count') })];
  const silent = strict(wf(nodes(), [eq('nodes.answer.n', 1)]));
  assert.equal(silent.valid, false);
  const [f] = find(silent, 'ERROR_COLLECTION');
  assert.deepEqual([f.severity, f.path, f.node, f.repair.action], ['error', 'workflow.rows', 'rows', 'gate-failed-count']);
  assert.match(f.repair.hint, /nodes\.rows\.failed/);
  assert.equal(silent.warnings.filter(w => w.code === 'ERROR_COLLECTION').length, 0, 'the advisory warning of the same code is replaced, not duplicated');
  assert.equal(plain(wf(nodes(), [eq('nodes.answer.n', 1)])).warnings.filter(w => w.code === 'ERROR_COLLECTION').length, 1, 'default validation still only warns');

  const gated = [
    [[eq('nodes.rows.failed', 0)], nodes()],
    [[{ op: 'lte', left: ref('nodes.rows.failed'), right: 2 }], nodes()],
    [[eq('nodes.answer.n', 1)], [...nodes(), { id: 'cap', kind: 'assert', needs: ['rows'], description: 'at most one failure', checks: [{ op: 'lte', left: ref('nodes.rows.failed'), right: 1 }] }]],
    [[eq('nodes.answer.n', 1)], [...nodes(), verify('inspect', ['rows'], ref('nodes.rows'))]],
    [[eq('nodes.answer.n', 1)], [nodes()[0], nodes()[1], { ...code('retry', ['rows']), when: { op: 'gt', left: ref('nodes.rows.failed'), right: 0 } }, nodes()[2]]]
  ];
  gated.forEach(([acceptance, flowNodes], i) => assert.equal(codesOf(strict(wf(flowNodes, acceptance))).includes('ERROR_COLLECTION'), false, `gated ${i}`));
  // Reading the failed count through exists, or reading a different count, is not a gate.
  assert.equal(codesOf(strict(wf(nodes(), [exists('nodes.rows.failed')]))).includes('ERROR_COLLECTION'), true);
  assert.equal(codesOf(strict(wf(nodes(), [eq('nodes.rows.count', 1)]))).includes('ERROR_COLLECTION'), true);
  assert.equal(codesOf(strict(wf(nodes({ failure: 'fail_fast' }), [eq('nodes.answer.n', 1)]))).includes('ERROR_COLLECTION'), false);
});

test('lint ESCALATION_WITHOUT_CHECKS: check-triggered escalation or resampling needs checks that can fail', () => {
  const dead = agent('read', { escalation: { schemaRetries: 1, onCheckFail: 'escalate', maxEscalations: 1 }, model: { class: 'M', maxClass: 'L' } });
  const result = strict(wf([dead, code('answer', ['read'], { x: ref('nodes.read.x') })], [eq('nodes.answer.id', 'answer')]));
  const [f] = find(result, 'ESCALATION_WITHOUT_CHECKS');
  assert.deepEqual([f.severity, f.path, f.node, f.repair.action, f.details.onCheckFail], ['warning', 'workflow.read', 'read', 'add-checks-or-drop-escalation', 'escalate']);
  assert.equal(result.valid, true, 'a warning does not reject');
  const flow = node => wf([node, code('answer', [node.id], { x: ref(`nodes.${node.id}.x`) })], [eq('nodes.answer.id', 'answer')]);
  const fires = node => codesOf(strict(flow(node))).includes('ESCALATION_WITHOUT_CHECKS');
  assert.equal(fires({ ...dead, checks: [{ op: 'ne', left: ref('output.x'), right: '' }] }), false, 'with a check it can fire');
  assert.equal(fires({ ...dead, escalation: { onCheckFail: 'resample', maxResamples: 2 } }), true);
  assert.equal(fires({ ...dead, escalation: { schemaRetries: 2 } }), false, 'schema retries do not need checks');
  assert.equal(fires({ ...dead, escalation: { onCheckFail: 'fail' } }), false);
  const { escalation, ...unconfigured } = dead;
  assert.equal(fires(unconfigured), false, 'maxClass alone escalates on schema failure');
});

test('lint GLOBAL_READ_UNGUARDED: one read that conditions every item needs an evidence quote that is checked, agreement, or a stronger class', () => {
  const config = (extra = {}) => agent('config', { role: 'extract', ...extra });
  const flow = (read, extraNodes = [], acceptance = [eq('nodes.answer.id', 'answer')]) => wf([read, ...extraNodes,
    code('items'), map('rows', ['items'], ref('nodes.items.input'), { failure: 'fail_fast' }),
    code('answer', ['config', 'rows'], { config: ref('nodes.config'), items: ref('nodes.rows.items') })], acceptance);
  const unguarded = strict(flow(config()));
  const [f] = find(unguarded, 'GLOBAL_READ_UNGUARDED');
  assert.deepEqual([f.severity, f.path, f.node, f.repair.action], ['warning', 'workflow.config', 'config', 'guard-global-read']);
  assert.deepEqual(f.details.missing, ['evidence-quote', 'k-sample-agreement', 'stronger-class']);
  assert.deepEqual(f.details.consumers, ['answer']);

  const quoted = { type: 'object', additionalProperties: false, required: ['x', 'evidence'], properties: { x: { type: 'string', maxLength: 50 }, evidence: { type: 'string', maxLength: 200 } } };
  const sourceCheck = { op: 'contains', left: ref('input.notes'), right: ref('output.evidence') };
  const globalFires = result => codesOf(result).includes('GLOBAL_READ_UNGUARDED');
  assert.equal(globalFires(strict(flow(config({ returns: quoted, checks: [sourceCheck] })))), false, 'a checked verbatim quote guards it');
  const unchecked = strict(flow(config({ returns: quoted })));
  assert.equal(globalFires(unchecked), true, 'a quote field nobody checks is decoration');
  assert.deepEqual(find(unchecked, 'GLOBAL_READ_UNGUARDED')[0].details.evidenceFields, ['evidence']);
  // A gating verify over the read counts as the check on its evidence.
  assert.equal(globalFires(strict(flow(config({ returns: quoted }), [verify('audit', ['config'], ref('nodes.config'))]))), false);

  // A stronger class than the workflow default guards it (and then needs its justification, see the class rule).
  const cheap = agent('cheap', { role: 'classify' });
  const stronger = strict(wf([config({ model: { class: 'L', justification: 'M misread the convention on 3 of 5 probes; L did not' } }), cheap, code('items'), map('rows', ['items'], ref('nodes.items.input'), { failure: 'fail_fast' }),
    code('answer', ['config', 'rows', 'cheap'], { config: ref('nodes.config'), items: ref('nodes.rows.items') })], [eq('nodes.answer.id', 'answer')]));
  assert.equal(globalFires(stronger), false);
  assert.equal(codesOf(stronger).includes('CLASS_ABOVE_DEFAULT_UNJUSTIFIED'), false);

  // Two independent reads of the same fact that a later node compares are k-sample agreement.
  const twin = id => ({ ...config(), id });
  const agreed = wf([twin('config'), twin('config_b'), code('items'), map('rows', ['items'], ref('nodes.items.input'), { failure: 'fail_fast' }),
    code('answer', ['config', 'config_b', 'rows'], { a: ref('nodes.config'), b: ref('nodes.config_b'), items: ref('nodes.rows.items') })], [eq('nodes.answer.id', 'answer')]);
  assert.equal(globalFires(strict(agreed)), false);
  const lonely = wf([twin('config'), twin('config_b'), code('items'), map('rows', ['items'], ref('nodes.items.input'), { failure: 'fail_fast' }),
    code('answer', ['config', 'config_b', 'rows'], { a: ref('nodes.config'), items: ref('nodes.rows.items') })], [eq('nodes.answer.id', 'answer')]);
  assert.equal(globalFires(strict(lonely)), true, 'two reads that nothing compares are not agreement');

  // Not a read, or not read by anything that fans out: no finding.
  assert.equal(globalFires(strict(flow(config({ role: 'code_edit' })))), false);
  const isolated = wf([config(), code('items'), map('rows', ['items'], ref('nodes.items.input'), { failure: 'fail_fast' }), code('answer', ['config'], { config: ref('nodes.config') })], [eq('nodes.answer.id', 'answer')]);
  assert.equal(globalFires(strict(isolated)), false);
  // A map whose input is the read output is the other way to condition every item.
  const feeding = wf([config(), map('rows', ['config'], ref('nodes.config.x'), { failure: 'fail_fast' }), code('answer', ['rows'], { n: ref('nodes.rows.count') })], [eq('nodes.answer.n', 1)]);
  assert.equal(globalFires(strict(feeding)), true);
});

test('lint CLASS_ABOVE_DEFAULT_UNJUSTIFIED: a model node above the workflow default says why', () => {
  const nodes = [agent('cheap'), agent('strong', { model: { class: 'L' } }), code('answer', ['cheap', 'strong'], { a: ref('nodes.cheap.x'), b: ref('nodes.strong.x') })];
  const accept = [eq('nodes.answer.id', 'answer')];
  const result = strict(wf(nodes, accept));
  const [f] = find(result, 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED');
  assert.deepEqual([f.severity, f.path, f.node, f.details.class, f.details.defaultClass, f.repair.action], ['warning', 'workflow.strong', 'strong', 'L', 'M', 'justify-class']);
  assert.match(f.details.defaultSource, /derived/);
  assert.equal(find(result, 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED').length, 1, 'only the node above the default');

  const justified = [nodes[0], agent('strong', { model: { class: 'L', justification: 'M failed 5 of 8 probe items on the convention read' } }), nodes[2]];
  assert.equal(codesOf(strict(wf(justified, accept))).includes('CLASS_ABOVE_DEFAULT_UNJUSTIFIED'), false);
  assert.equal(strict(wf(justified, accept)).valid, true, 'the schema accepts model.justification');
  // A blank justification is none (it satisfies the schema's length but says nothing); the model id form is judged by its class.
  assert.deepEqual(find(strict(wf([nodes[0], agent('strong', { model: { class: 'L', justification: '          ' } }), nodes[2]], accept)), 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED').map(x => x.node), ['strong']);
  const byId = strict(wf([nodes[0], agent('strong', { model: { id: 'claude-sonnet-5-5' } }), nodes[2]], accept));
  assert.deepEqual(find(byId, 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED').map(x => x.node), ['strong']);
  // A declared default replaces the derived one.
  assert.equal(codesOf(strict(wf(nodes, accept, { defaultClass: 'L' }))).includes('CLASS_ABOVE_DEFAULT_UNJUSTIFIED'), false);
  assert.deepEqual(find(strict(wf(nodes, accept, { defaultClass: 'S' })), 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED').map(x => x.node).sort(), ['cheap', 'strong']);
  const unknown = strict(wf(nodes, accept, { defaultClass: 'Q' }));
  assert.equal(unknown.valid, false);
  assert.ok(unknown.errors.some(e => e.code === 'MODEL_CLASS_UNKNOWN' && e.path === '/defaultClass'), 'an unknown class is a base error, with or without strict');
  assert.ok(plain(wf(nodes, accept, { defaultClass: 'Q' })).errors.some(e => e.code === 'MODEL_CLASS_UNKNOWN'));
  // One class everywhere: nothing to justify.
  assert.equal(codesOf(strict(wf([agent('a'), agent('b'), code('answer', ['a', 'b'], {})], accept))).includes('CLASS_ABOVE_DEFAULT_UNJUSTIFIED'), false);
});

test('lint output is machine readable: stable codes, severities, paths, repairs and counts', () => {
  const workflow = wf([agent('read', { escalation: { onCheckFail: 'escalate' } }), code('items'), map('rows', ['items'], ref('nodes.items.input'), { failure: 'collect' }),
    verify('check', ['rows'], ref('nodes.rows'), { gate: false }), code('answer', ['read', 'rows', 'check'], { r: ref('nodes.read.x'), n: ref('nodes.rows.count') })], [exists('nodes.answer.id')]);
  const result = strict(workflow);
  const lint = lintWorkflow(workflow, { modelPolicy: loaded });
  assert.deepEqual(result.lint, lint, 'validate --strict reports the same lint as lintWorkflow');
  assert.equal(lint.profile, LINT_PROFILE);
  assert.equal(lint.ok, false);
  assert.deepEqual(Object.keys(lint.codes).sort(), ['ACCEPTANCE_EXISTENCE_ONLY', 'ERROR_COLLECTION', 'ESCALATION_WITHOUT_CHECKS', 'GLOBAL_READ_UNGUARDED', 'VERIFY_NOT_GATING']);
  assert.deepEqual(lint.counts, { error: 3, warning: 2 });
  for (const f of lint.findings) {
    assert.ok(Object.hasOwn(LINT_RULES, f.code), f.code);
    assert.equal(f.severity, LINT_RULES[f.code].severity);
    assert.match(f.path, /^workflow(\.|$)/);
    assert.equal(typeof f.message, 'string');
    assert.equal(typeof f.repair.action, 'string'); assert.equal(typeof f.repair.hint, 'string');
  }
  assert.equal(result.errors.length, lint.counts.error); assert.equal(result.warnings.filter(w => LINT_RULES[w.code]).length, lint.counts.warning);
  assert.deepEqual(JSON.parse(JSON.stringify(lint)), lint, 'the report is plain JSON');
  // Every rule has a documented summary and the docs list every code.
  const docs = readFileSync(path.join(root, 'docs/LINT.md'), 'utf8');
  for (const code of Object.keys(LINT_RULES)) assert.ok(docs.includes(`\`${code}\``), `docs/LINT.md documents ${code}`);
});

test('lint: a rule that cannot run is reported, not swallowed, and malformed input never crashes the validator', () => {
  const broken = wf([code('answer', [], { v: { $ref: 'nodes' } })], [eq('nodes.answer.id', 'answer')]);
  const result = strict(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.code === 'BROAD_REFERENCE'), 'the base validator names the real problem');
  assert.ok(result.lint, 'the lint still ran');
  const notWorkflow = validateWorkflow({ nodes: [] }, { registry, modelPolicy: loaded, strict: true });
  assert.equal(notWorkflow.valid, false);
  assert.equal(notWorkflow.lint, undefined, 'a workflow that fails its schema is not linted');
});

test('malformed workflows fail closed: assessed as unassessed, never pass, and neither the lint nor the verdict throws', () => {
  for (const bad of [{ acceptance: [exists('nodes.a.x')], nodes: [null] }, { acceptance: [exists('nodes.a.x')], nodes: [{ id: 'a', kind: 'map', body: {} }] }, { acceptance: [{ op: 'exists' }], nodes: 'x' }]) {
    assert.equal(assessWorkflow(bad).acceptance.grade === 'existence-only' || assessWorkflow(bad).acceptance.grade === 'unassessed', true);
    assert.notEqual(verdictOfSucceeded(bad), 'pass');
  }
  assert.equal(assessWorkflow({ acceptance: [exists('nodes.a.x')], nodes: [{ id: 'a', kind: 'map', body: {} }] }).acceptance.grade, 'unassessed');
  const report = lintWorkflow({ nodes: 'x', acceptance: [] });
  assert.deepEqual([report.codes, report.acceptance.grade], [{ LINT_RULE_SKIPPED: 1 }, 'unassessed']);
});
const verdictOfSucceeded = workflow => verdictOf({ status: 'succeeded' }, { workflow }).verdict;

test('schema: the oracle declaration needs a reason, only the none mode exists, and model.justification is bounded', () => {
  const ok = wf([code('answer')], [exists('nodes.answer.id')], { oracle: { mode: 'none', reason: 'No executable oracle exists for this brief.' } });
  assert.equal(plain(ok).valid, true);
  for (const oracle of [{ mode: 'none' }, { mode: 'none', reason: 'short' }, { mode: 'maybe', reason: 'No executable oracle exists for this brief.' }, { reason: 'No executable oracle exists for this brief.' },
    { mode: 'none', reason: 'No executable oracle exists for this brief.', extra: 1 }]) {
    assert.equal(plain({ ...ok, oracle }).valid, false, JSON.stringify(oracle));
  }
  assert.ok(workflowSchema.properties.oracle && workflowSchema.properties.defaultClass);
  assert.ok(workflowSchema.definitions.modelChoice.properties.justification);
  const withModel = justification => wf([agent('a', { model: { class: 'M', justification } }), code('answer', ['a'])], [eq('nodes.answer.id', 'answer')]);
  assert.equal(plain(withModel('x'.repeat(1001))).valid, false);
  assert.equal(plain(withModel('too short')).valid, false);
});

function cli(args, input) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-lint-cli-'));
  try {
    const file = path.join(dir, 'workflow.json'); writeFileSync(file, JSON.stringify(input));
    const run = spawnSync(process.execPath, [path.join(root, 'bin/foundry.mjs'), ...args.map(a => a === '@file' ? file : a)], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
    let out = null; try { out = JSON.parse(run.stdout); } catch {}
    return { status: run.status, out, stderr: run.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('CLI: foundry lint and validate --strict print the coded report and exit non-zero on a strict error', () => {
  const weak = wf([code('answer')], [exists('nodes.answer.value')]);
  const lint = cli(['lint', '@file'], weak);
  assert.equal(lint.status, 1, lint.stderr);
  assert.equal(lint.out.valid, false);
  assert.deepEqual(lint.out.lint.codes, { ACCEPTANCE_EXISTENCE_ONLY: 1 });
  const viaValidate = cli(['validate', '@file', '--strict'], weak);
  assert.equal(viaValidate.status, 1);
  assert.deepEqual(viaValidate.out.lint, lint.out.lint);
  const lax = cli(['validate', '@file'], weak);
  assert.equal(lax.status, 0, 'validate without --strict is unchanged');
  assert.equal(lax.out.valid, true); assert.equal(lax.out.lint, undefined);

  const good = wf([code('answer')], [eq('nodes.answer.value', 1)]);
  assert.equal(cli(['lint', '@file'], good).status, 0);
  // Warnings reject only on request.
  const warned = wf([agent('read', { escalation: { onCheckFail: 'escalate' } }), code('answer', ['read'], { x: ref('nodes.read.x') })], [eq('nodes.answer.id', 'answer')]);
  assert.equal(cli(['lint', '@file'], warned).status, 0);
  assert.equal(cli(['lint', '@file', '--fail-on', 'warning'], warned).status, 1);
  assert.notEqual(cli(['lint', '@file', '--fail-on', 'nope'], warned).status, 0);
  assert.notEqual(cli(['validate', '@file', '--fail-on', 'warning'], warned).status, 0, '--fail-on belongs to lint');
  assert.notEqual(cli(['lint', '@file', '--strict'], warned).status, 0, 'lint is always strict; the flag belongs to validate');
});

test('Foundry.validate passes strict through (the MCP foundry_validate tool uses it)', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-lint-mcp-'));
  const foundry = new Foundry(dir);
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  const weak = wf([code('answer')], [exists('nodes.answer.value')]);
  assert.equal(foundry.validate(weak).valid, true);
  assert.equal(foundry.validate(weak, { strict: true }).valid, false);
  const { toolDefinitions } = await import('../src/mcp.mjs');
  const tool = toolDefinitions(foundry).find(d => d.name === 'foundry_validate');
  assert.equal(tool.inputSchema.properties.strict.type, 'boolean');
  assert.equal(tool.execute({ workflow: weak, strict: true }).lint.codes.ACCEPTANCE_EXISTENCE_ONLY, 1);
  assert.equal(tool.execute({ workflow: weak }).lint, undefined);
});

// ---- run verdicts -----------------------------------------------------------------------------------------------------------------

const fakeCode = (bySource, record = []) => async spec => {
  record.push(spec.source);
  const next = bySource.get(spec.source);
  if (next === undefined) throw new Error(`no scripted code result for ${spec.source.slice(0, 60)}`);
  return { value: typeof next === 'function' ? next(spec) : next, stderr: '', elapsedMs: 0 };
};
function harness(t, workflow, { script = {}, codeRunner, input = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-acceptance-'));
  const store = new Store(dir), provider = new ScriptedProvider(script);
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
  const runtime = new Runtime(store, registry, { maxCost: 0, allowedCapabilities: registry.list().filter(c => c.risk === 'low').map(c => c.name) }, { models, modelPolicy: loaded, codeRunner });
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const validation = validateWorkflow(workflow, { registry, modelPolicy: loaded });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  store.saveWorkflow(workflow);
  const run = runtime.create(workflow, input, {});
  return { store, runtime, run, events: type => store.events(run.id).filter(e => e.type === type) };
}

test('runtime verdict: a succeeded run with existence-only acceptance is unverified, never pass; a gating acceptance passes', async t => {
  const answer = code('answer');
  const results = new Map([[answer.source, { id: 'answer', value: 41 }]]);   // the "answer" is wrong, and nothing checks it

  const weak = harness(t, wf([answer], [exists('nodes.answer.value')]), { codeRunner: fakeCode(results) });
  const run = await weak.runtime.execute(weak.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual({ verdict: run.verdict.verdict, code: run.verdict.code, authority: run.verdict.authority, acceptance: run.verdict.acceptance, grants: run.verdict.grantsActionAuthority, completes: run.verdict.establishesCompletion },
    { verdict: 'unverified', code: 'ACCEPTANCE_EXISTENCE_ONLY', authority: 'unresolved', acceptance: 'existence-only', grants: false, completes: false });
  assert.deepEqual(weak.events('run.verdict').map(e => e.verdict), ['unverified'], 'the sealed event carries it');
  const [decision] = weak.store.decisions(run.id);
  assert.equal(validateDecision(decision).action, 'unverified');
  assert.equal(decision.features.acceptance, 'existence-only');

  // The same wrong answer under an acceptance that checks the value: the run fails instead of passing.
  const strong = harness(t, wf([answer], [eq('nodes.answer.value', 42)]), { codeRunner: fakeCode(results) });
  const failed = await strong.runtime.execute(strong.run.id);
  assert.deepEqual([failed.status, failed.error.code, failed.verdict.verdict], ['failed', 'ACCEPTANCE_FAILED', 'inconclusive']);
  // And the right answer passes.
  const right = harness(t, wf([answer], [eq('nodes.answer.value', 41)]), { codeRunner: fakeCode(results) });
  const passed = await right.runtime.execute(right.run.id);
  assert.deepEqual([passed.status, passed.verdict.verdict, passed.verdict.acceptance, passed.verdict.code], ['succeeded', 'pass', 'gating', null]);

  const declared = harness(t, wf([answer], [exists('nodes.answer.value')], { oracle: { mode: 'none', reason: 'No oracle exists for this synthetic answer; a person reads it.' } }), { codeRunner: fakeCode(results) });
  const unverified = await declared.runtime.execute(declared.run.id);
  assert.deepEqual([unverified.verdict.verdict, unverified.verdict.code, unverified.verdict.acceptance], ['unverified', 'NO_ORACLE_DECLARED', 'no-oracle']);
  assert.match(unverified.verdict.reason, /No oracle exists for this synthetic answer/);
});

test('runtime verdict: a gate:false verify that said fail, or silently collected map failures, keep a run from passing', async t => {
  const prep = code('prep'), item = { ...code('w'), source: 'export default function main(input) { return { v: input }; }' };
  const answer = code('answer', ['check'], { v: ref('nodes.prep.value') });
  const checkNode = verify('check', ['prep'], ref('nodes.prep'), { gate: false });
  const results = pass => new Map([[prep.source, { id: 'prep', value: 1 }], [checkNode.source, { pass, score: pass ? 1 : 0, reasons: pass ? [] : ['wrong'] }], [answer.source, { id: 'answer', value: 1 }]]);

  // The accepted answer is checked against a constant the run happens to produce, so only the failing verify can speak.
  const accept = [eq('nodes.answer.value', 1)];
  const bad = harness(t, wf([prep, checkNode, answer], accept), { codeRunner: fakeCode(results(false)) });
  const run = await bad.runtime.execute(bad.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual([run.verdict.verdict, run.verdict.code], ['unverified', 'VERIFY_FAILED_NONBLOCKING']);
  assert.match(run.verdict.reason, /verify node check recorded a failure/);
  // Reading its result in acceptance is the author's gate: the run then fails instead.
  const read = harness(t, wf([prep, checkNode, answer], [eq('nodes.check.pass', true)]), { codeRunner: fakeCode(results(false)) });
  assert.equal((await read.runtime.execute(read.run.id)).error.code, 'ACCEPTANCE_FAILED');
  // A verify that passed leaves the verdict to the acceptance.
  const good = harness(t, wf([prep, checkNode, answer], accept), { codeRunner: fakeCode(results(true)) });
  assert.equal((await good.runtime.execute(good.run.id)).verdict.verdict, 'pass');

  // Collected failures: three of four items fail and the answer still exists.
  const mapNode = map('rows', [], { $ref: 'input.items' }, { failure: 'collect', body: { nodes: [{ ...item, args: { x: ref('item') } }], acceptance: [exists('nodes.w')] } });
  const collectResults = new Map([[item.source, spec => { if (spec.input.x !== 1) throw new Error('item failed'); return { v: spec.input.x }; }]]);
  const makeCollect = acceptance => wf([mapNode, code('final', ['rows'], { n: ref('nodes.rows.count') })], acceptance, { budget: { maxSteps: 100, maxConcurrency: 1, maxDurationMs: 60000 }, inputSchema: { type: 'object' } });
  const finalNode = makeCollect([eq('nodes.final.value', 1)]).nodes[1];
  collectResults.set(finalNode.source, { id: 'final', value: 1 });
  const silent = harness(t, makeCollect([eq('nodes.final.value', 1)]), { codeRunner: fakeCode(collectResults), input: { items: [1, 2, 3, 4] } });
  const dropped = await silent.runtime.execute(silent.run.id);
  assert.equal(dropped.status, 'succeeded', JSON.stringify(dropped.error));
  assert.equal(dropped.nodes.rows.failedItems, 3);
  assert.deepEqual([dropped.verdict.verdict, dropped.verdict.code], ['unverified', 'ERROR_COLLECTED']);
  assert.match(dropped.verdict.reason, /rows \(3 failed\)/);
  // With a gate on the failed count the author owns the tolerance, and a run within it passes.
  const owned = harness(t, makeCollect([eq('nodes.final.value', 1), { op: 'lte', left: ref('nodes.rows.failed'), right: 3 }]), { codeRunner: fakeCode(collectResults), input: { items: [1, 2, 3, 4] } });
  assert.equal((await owned.runtime.execute(owned.run.id)).verdict.verdict, 'pass');
});

// The C0 dev round's F-haiku `records` workflow: acceptance is `exists answer.records`, its verify has gate:false, its map collects
// failures and its merge drops them. Its recorded run verdict was "pass" on all 16 F-haiku trials, including the 5 that failed the oracle.
test('regression: the C0 F-haiku records workflow can no longer turn a wrong answer into a pass', async t => {
  const workflow = JSON.parse(readFileSync(path.join(root, 'research/construction-20261006/artifacts/F-haiku-records-k1/workflow.json'), 'utf8'));
  const source = id => workflow.nodes.find(n => n.id === id).source;
  const verifySource = source('verify');
  const row = id => ({ row_id: id, system: 'BRIGHTDESK', void: false, void_reason: '', family_name: 'Doe', given_name: 'Jo', birth_as_written: null, birth_date: null, country: null,
    phone_as_written: null, balance_as_written: null, balance: null, currency: null, update_as_written: null, update_date: null, update_is_real: false });
  const wrong = { records: [{ entity_id: 'WRONG', given_name: 'Jo', family_name: 'Doe' }] };   // a wrong answer: the oracle would fail it
  const outputs = verdict => new Map([
    [source('split'), { batches: [{ ids: [1, 2], lines: 'first batch', notes: 'n', spec: 's' }, { ids: [3, 4], lines: 'second batch', notes: 'n', spec: 's' }], spec: 's', ids: [1, 2, 3, 4] }],
    [source('merge'), wrong], [verifySource, verdict], [source('answer'), wrong]]);
  // The scripted model answers by schema and batch, so the order of concurrent calls does not matter. A bad second batch fails on every class.
  const script = badSecondBatch => args => {
    if (args.schema.properties.orders) return { value: { orders: [{ system: 'BRIGHTDESK', numeric_order: 'DMY', sign_flip: 1 }] } };
    if (args.prompt.includes('second batch')) return badSecondBatch ? { value: { not: 'rows' } } : { value: { row_ids: [3, 4], rows: [row(3), row(4)] } };
    return { value: { row_ids: [1, 2], rows: [row(1), row(2)] } };
  };
  const verdicts = {};
  for (const [name, verdict, bad, expected] of [
    ['clean model run, verify happy', { pass: true, score: 1, reasons: [] }, false, 'ACCEPTANCE_EXISTENCE_ONLY'],
    ['verify said fail', { pass: false, score: 0, reasons: ['entity ids look wrong'] }, false, 'VERIFY_FAILED_NONBLOCKING'],
    ['a batch failed and was dropped', { pass: true, score: 1, reasons: [] }, true, 'ERROR_COLLECTED']
  ]) {
    const h = harness(t, workflow, { script: script(bad), codeRunner: fakeCode(outputs(verdict)), input: { inputs: { export: 'x', source_notes: 'n', spec: 's' } } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'succeeded', `${name}: ${JSON.stringify(run.error)}`);
    assert.notEqual(run.verdict.verdict, 'pass', name);
    assert.equal(run.verdict.verdict, 'unverified', name);
    assert.equal(run.verdict.code, expected, name);
    verdicts[name] = run.verdict.code;
  }
  assert.equal(Object.keys(verdicts).length, 3);
  // And the validator rejects the artifact outright in strict mode, with the codes a constructor repairs from.
  const result = strict(workflow);
  assert.equal(result.valid, false);
  assert.deepEqual([...new Set(result.lint.findings.map(f => f.code))].sort(), ['ACCEPTANCE_EXISTENCE_ONLY', 'ERROR_COLLECTION', 'ESCALATION_WITHOUT_CHECKS', 'GLOBAL_READ_UNGUARDED', 'VERIFY_NOT_GATING']);
});

test('retro-audit: the lint over the four C0 dev F workflows fires existence-only acceptance on every one of them', () => {
  const dir = path.join(root, 'research/construction-20261006/artifacts');
  const expected = {
    'F-haiku-codefix-k1': ['ACCEPTANCE_EXISTENCE_ONLY', 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED'],
    'F-haiku-records-k1': ['ACCEPTANCE_EXISTENCE_ONLY', 'ERROR_COLLECTION', 'ESCALATION_WITHOUT_CHECKS', 'GLOBAL_READ_UNGUARDED', 'VERIFY_NOT_GATING'],
    'F-opus-codefix-k1': ['ACCEPTANCE_EXISTENCE_ONLY', 'ESCALATION_WITHOUT_CHECKS', 'VERIFY_NOT_GATING'],
    'F-opus-records-k1': ['ACCEPTANCE_EXISTENCE_ONLY', 'CLASS_ABOVE_DEFAULT_UNJUSTIFIED', 'ERROR_COLLECTION', 'ESCALATION_WITHOUT_CHECKS', 'GLOBAL_READ_UNGUARDED', 'VERIFY_NOT_GATING']
  };
  // F-opus records: the `config` read is on class F, a stronger class than the rest, so it is guarded; the rule fires on `countries`.
  for (const [name, codes] of Object.entries(expected)) {
    const workflow = JSON.parse(readFileSync(path.join(dir, name, 'workflow.json'), 'utf8'));
    assert.equal(plain(workflow).valid, true, `${name} is valid without strict`);
    const result = strict(workflow);
    assert.equal(result.valid, false, name);
    assert.equal(result.lint.acceptance.grade, 'existence-only', name);
    assert.deepEqual(Object.keys(result.lint.codes).sort(), codes, name);
    assert.equal(assessWorkflow(workflow).acceptance.grade, 'existence-only');
  }
});
