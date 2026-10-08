import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOp, compileOps, mechanicalOps, OPS, FORBIDDEN_OP_NAMES, allowedOpsFor, reviewReasons } from '../ops.mjs';
import { weakening, scanLeaks, buildLeakIndex, unsafeAdditions, codeSafety, quoteInContract, addedContent } from '../scan.mjs';
import { tightenProof, mutantBattery } from '../proofs.mjs';
import { clone, digest } from '../ir.mjs';
import { world, skipReason } from './helpers.mjs';

const envOf = (kit, gate) => { const policy = kit.sessionPolicy(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']); return { policy, env: { classOrder: policy.classOrder, classOf: id => kit.policy.modelById(policy, id).class, isStrong: gate.isStrong } }; };
const compileOk = (kit, base, ops, env, policy) => {
  const c = compileOps(base, ops, env);
  assert.deepEqual(c.errors, [], JSON.stringify(c.errors));
  const v = kit.validateWorkflow(c.workflow, policy);
  assert.equal(v.valid, true, JSON.stringify(v.errors?.slice(0, 3)));
  assert.equal(c.workflow.version, base.version + 1);
  return c;
};

test('validateOp: unknown, forbidden and malformed operations are rejected; there is no delete/weaken/declassify op', () => {
  for (const name of FORBIDDEN_OP_NAMES) assert.match(validateOp({ op: name })[0], /HEAL_FORBIDDEN_OP/);
  assert.match(validateOp({ op: 'frobnicate' })[0], /HEAL_OP_UNKNOWN/);
  assert.ok(validateOp({ op: 'add_check', node: 'conf', conditionJson: 'not json' }).some(p => p.startsWith('conditionJson')));
  assert.ok(validateOp({ op: 'escalate_class', node: 'conf', class: 'Z', justification: 'x' }).length);
  assert.ok(validateOp({ op: 'gate_verify', node: 'v', extra: 1 }).some(p => p.startsWith('extra')));
  assert.deepEqual(validateOp({ op: 'gate_verify', node: 'verify' }), []);
  for (const name of Object.keys(OPS)) assert.ok(!/delete|remove|weaken|declass|disable/.test(name), name);
});

test('mechanical ops from the pinned lint repair actions clear the lint debt of the records base', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), { policy, env } = envOf(kit, gate);
  const lint = gate.lintWorkflow(wf.records, { modelPolicy: policy });
  const m = mechanicalOps(lint, wf.records);
  assert.deepEqual(m.ops.map(o => o.op).sort(), ['gate_failed_count', 'gate_verify', 'strengthen_acceptance']);
  assert.deepEqual(m.needsProposer, []);
  const c = compileOk(kit, wf.records, m.ops, env, policy);
  const after = gate.lintWorkflow(c.workflow, { modelPolicy: policy });
  assert.equal(after.counts.error, 0, JSON.stringify(after.codes));
  assert.equal(after.acceptance.grade, 'gating');
  // codefix has no verify node: the acceptance cannot be strengthened mechanically
  const cf = mechanicalOps(gate.lintWorkflow(wf.codefix, { modelPolicy: policy }), wf.codefix);
  assert.deepEqual(cf.needsProposer, ['ACCEPTANCE_EXISTENCE_ONLY']);
  assert.deepEqual(cf.ops, []);
});

test('add_evidence_field + edit_instructions compile on the records conf node and clear nothing silently', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), { policy, env } = envOf(kit, gate);
  const ops = [{ op: 'add_evidence_field', node: 'conf', field: 'evidence', maxLength: 600, instruction: 'Quote, character for character, the sentence of source_notes that decides each system numeric date order.', source: 'input.inputs.source_notes' },
    { op: 'edit_instructions', node: 'conf', mode: 'append', text: 'A worked example in the notes decides the order; the name of a locale does not.' }];
  const c = compileOk(kit, wf.records, ops, env, policy), conf = c.workflow.nodes.find(n => n.id === 'conf');
  assert.ok(conf.returns.properties.evidence && conf.returns.required.includes('evidence'));
  assert.deepEqual(conf.checks, [{ op: 'contains', left: { $ref: 'input.inputs.source_notes' }, right: { $ref: 'output.evidence' } }]);
  assert.deepEqual(weakening(wf.records, c.workflow), []);
  // the source must be something the node reads
  assert.equal(compileOps(wf.records, [{ ...ops[0], source: 'input.inputs.spec' }], env).errors[0].code, 'HEAL_OP_INVALID');
  // the pinned lint now sees an evidence field with a check that reads it
  assert.equal(gate.lintWorkflow(c.workflow, { modelPolicy: policy }).findings.some(f => f.code === 'GLOBAL_READ_UNGUARDED'), false);
});

test('k_sample_agreement keeps the original id on the final pick, gives each sibling a distinct reader tag, and clears GLOBAL_READ_UNGUARDED', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), { policy, env } = envOf(kit, gate);
  for (const onDisagree of ['escalate', 'fail']) {
    const c = compileOk(kit, wf.records, [{ op: 'k_sample_agreement', node: 'conf', k: 3, onDisagree }], env, policy), ids = c.workflow.nodes.map(n => n.id);
    assert.ok(['conf', 'conf__s1', 'conf__s2', 'conf__s3', 'conf__agree'].every(id => ids.includes(id)), ids.join());
    const readers = ['conf__s1', 'conf__s2', 'conf__s3'].map(id => c.workflow.nodes.find(n => n.id === id).instructions);
    assert.equal(new Set(readers).size, 3, 'reader tags make the prompts distinct (replay keys omit the node id)');
    assert.equal(readers[0], wf.records.nodes.find(n => n.id === 'conf').instructions, 'reader 1 keeps the original prompt so its recorded calls still replay');
    assert.equal(c.workflow.nodes.find(n => n.id === 'conf').kind, 'code');
    assert.equal(c.workflow.nodes.find(n => n.id === 'merge').needs.includes('conf'), true, 'downstream references are untouched');
    assert.deepEqual(weakening(wf.records, c.workflow), []);
    const lint = gate.lintWorkflow(c.workflow, { modelPolicy: policy });
    assert.equal(lint.findings.some(f => f.code === 'GLOBAL_READ_UNGUARDED'), false, JSON.stringify(lint.codes));
    if (onDisagree === 'escalate') assert.equal(c.workflow.nodes.find(n => n.id === 'conf__esc').model.class, 'L');
    else assert.equal(c.workflow.nodes.find(n => n.id === 'conf__ok').kind, 'assert');
  }
  // it also works on a map body node (P1): the structure stays inside the body
  const c = compileOk(kit, wf.p1, [{ op: 'k_sample_agreement', in: 'statuses', node: 'judge', k: 2, onDisagree: 'escalate', compare: ['meaning'] }], env, policy);
  assert.ok(c.workflow.nodes.find(n => n.id === 'statuses').body.nodes.some(n => n.id === 'judge__agree'));
});

test('escalate_class goes up only, carries its justification as a waiver, and class F is an owner-review reason', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), { policy, env } = envOf(kit, gate);
  const c = compileOk(kit, wf.records, [{ op: 'escalate_class', node: 'conf', class: 'L', justification: 'M misread a convention on 2 of 8 recorded trials' }], env, policy);
  assert.equal(c.workflow.nodes.find(n => n.id === 'conf').model.class, 'L');
  assert.deepEqual(c.waivers.map(w => w.code), ['CLASS_ABOVE_DEFAULT_UNJUSTIFIED']);
  assert.equal(compileOps(wf.records, [{ op: 'escalate_class', node: 'conf', class: 'M', justification: 'no change at all' }], env).errors[0].code, 'HEAL_OP_INVALID');
  assert.deepEqual(reviewReasons([{ op: 'escalate_class', class: 'F' }]).length, 1);
  assert.deepEqual(reviewReasons([{ op: 'escalate_class', class: 'L' }]), []);
  assert.equal(reviewReasons([{ op: 'add_check' }], { costRatio: 1.3 }).length, 1);
});

test('locus and allowed-op rules reject ops outside the defect class or the locus', { skip: skipReason }, async () => {
  const { kit, gate, wf } = await world(), { env } = envOf(kit, gate);
  const op = { op: 'edit_instructions', node: 'split', mode: 'append', text: 'x' };
  assert.equal(compileOps(wf.records, [op], { ...env, locus: new Set(['conf']) }).errors[0].code, 'HEAL_LOCUS_EXCEEDED');
  assert.equal(compileOps(wf.records, [{ op: 'gate_verify', node: 'verify' }], { ...env, allowed: new Set(['add_check']) }).errors[0].code, 'HEAL_OP_NOT_ALLOWED');
  assert.deepEqual(allowedOpsFor(['UNGUARDED_GLOBAL_READ'], { allocatorOnly: true }), ['k_sample_agreement', 'escalate_class']);
  assert.ok(allowedOpsFor(['OVERSTRICT_CHECK']).includes('relax_check'));
  assert.ok(!allowedOpsFor(['UNGUARDED_GLOBAL_READ']).includes('relax_check'));
});

test('weakening: every way of loosening a workflow is rejected with its own code', { skip: skipReason }, async () => {
  const { wf } = await world();
  const base = wf.records, cand = f => { const c = clone(base); f(c); return c; };
  const codes = c => weakening(base, c).map(v => v.code);
  assert.deepEqual(codes(clone(base)), []);
  assert.ok(codes(cand(c => { c.nodes = c.nodes.filter(n => n.id !== 'verify'); })).includes('HEAL_CHECK_REMOVED'));
  assert.ok(codes(cand(c => { c.acceptance = [{ op: 'exists', value: { $ref: 'nodes.answer' } }]; })).includes('HEAL_ACCEPTANCE_WEAKENED'));
  assert.ok(codes(cand(c => { c.nodes.find(n => n.id === 'extract').failure = 'collect'; c.nodes.find(n => n.id === 'extract').failure = 'collect'; })).length === 0, 'collect was already the base value');
  assert.ok(codes(cand(c => { c.nodes.find(n => n.id === 'answer').onError = 'continue'; })).includes('HEAL_GATE_LOOSENED'));
  assert.ok(codes(cand(c => { c.labels = {}; })).includes('HEAL_FORBIDDEN_FIELD'));
  assert.ok(codes(cand(c => { c.labels['input.inputs.export'] = 'trusted'; })).includes('HEAL_FORBIDDEN_FIELD'));
  assert.ok(codes(cand(c => { c.oracle = { mode: 'none', reason: 'x' }; })).includes('HEAL_FORBIDDEN_FIELD'));
  assert.ok(codes(cand(c => { c.nodes.push({ id: 'tool1', kind: 'task', needs: [], description: 'x', tool: 'fs.write', args: {}, timeoutMs: 1000, retry: { maxAttempts: 1 } }); })).includes('HEAL_FORBIDDEN_FIELD'));
  assert.ok(codes(cand(c => { c.budget.maxCost = c.budget.maxCost * 2; })).includes('HEAL_FORBIDDEN_FIELD'));
  assert.ok(codes(cand(c => { c.nodes.find(n => n.id === 'conf').model.maxClass = 'M'; })).includes('HEAL_GATE_LOOSENED'));
  assert.ok(codes(cand(c => { c.nodes.find(n => n.id === 'conf').escalation.maxEscalations = 0; })).includes('HEAL_GATE_LOOSENED'));
  assert.ok(codes(cand(c => { c.nodes.find(n => n.id === 'conf').context.inputs[0].label = 'trusted'; })).includes('HEAL_FORBIDDEN_FIELD'));
  assert.ok(codes(cand(c => { delete c.nodes.find(n => n.id === 'extract').body.nodes.find(n => n.id === 'rows').checks; })).includes('HEAL_CHECK_REMOVED'), 'a check inside a map body counts too');
  // a gating verify made non-gating
  const gated = clone(base); gated.nodes.find(n => n.id === 'verify').gate = true;
  const loosened = clone(gated); loosened.nodes.find(n => n.id === 'verify').gate = false;
  assert.ok(weakening(gated, loosened).some(v => v.code === 'HEAL_GATE_LOOSENED'));
});

test('weakening: a check replaced by an unproven or unverified one is a removal; a verified tighten is not', async () => {
  const mk = checks => ({ id: 'w', version: 1, schemaVersion: '1.0', domain: 'd', budget: { maxSteps: 10, maxCost: 1, maxDurationMs: 1000, maxConcurrency: 1 }, acceptance: [{ op: 'eq', left: { $ref: 'nodes.a.x' }, right: 1 }],
    nodes: [{ id: 'a', kind: 'agent', needs: [], description: 'd', instructions: 'i', returns: { type: 'object' }, model: { class: 'M' }, checks }] });
  const old = { op: 'eq', left: { $ref: 'output.a' }, right: 1 }, tighter = { op: 'all', conditions: [old, { op: 'eq', left: { $ref: 'output.b' }, right: 2 }] };
  assert.equal(weakening(mk([old]), mk([tighter])).length, 1);
  assert.equal(weakening(mk([old]), mk([tighter]), { proofs: [{ type: 'tighten', node: 'a', index: 0, verified: false }] }).length, 1);
  assert.equal(weakening(mk([old]), mk([tighter]), { proofs: [{ type: 'tighten', node: 'a', index: 0, verified: true }] }).length, 0);
});

test('tightenProof: implication over the enumerated decision space and recorded outputs', { skip: skipReason }, async () => {
  const { kit } = await world();
  const returns = { type: 'object', required: ['relation', 'meaning'], properties: { relation: { enum: ['none', 'same_as'] }, meaning: { enum: ['live', 'void'] }, quote: { type: 'string' } } };
  const old = { op: 'any', conditions: [{ op: 'eq', left: { $ref: 'output.relation' }, right: 'none' }, { op: 'eq', left: { $ref: 'output.meaning' }, right: 'void' }] };
  const tighter = { op: 'all', conditions: [old, { op: 'ne', left: { $ref: 'output.meaning' }, right: 'live' }] };   // rejects meaning live whatever the relation
  const wrong = [{ relation: 'none', meaning: 'live', quote: 'q' }], accepted = [{ relation: 'none', meaning: 'void', quote: 'q' }];
  const good = tightenProof({ old, next: tighter, returns, templates: accepted, wrong, accepted, kit });
  assert.equal(good.implies, true); assert.equal(good.rejectsWrong, 1); assert.equal(good.ok, true); assert.equal(good.rejectsAccepted, 0);
  const looser = { op: 'any', conditions: [old, { op: 'eq', left: { $ref: 'output.relation' }, right: 'same_as' }] };   // accepts something old rejected
  const bad = tightenProof({ old, next: looser, returns, templates: accepted, wrong, accepted, kit });
  assert.equal(bad.implies, false); assert.equal(bad.ok, false);
  const inert = tightenProof({ old, next: old, returns, templates: accepted, wrong, accepted, kit });
  assert.equal(inert.implies, true); assert.equal(inert.rejectsWrong, 0); assert.equal(inert.ok, false, 'a check that rejects no recorded wrong output proves nothing');
});

test('mutantBattery: signature mutants of a Python module, including the justified default-value class', () => {
  const src = 'class Vocabulary:\n    def __init__(self, tokens, min_count=1, lowercase=True):\n        pass\n\n    def encode(self, text):\n        return []\n\ndef ngrams(tokens, n=2):\n    return []\n';
  const battery = mutantBattery(src);
  const classes = new Set(battery.map(m => m.class));
  for (const c of ['renamed', 'reordered', 'removed', 'added', 'default_count', 'default_value']) assert.ok(classes.has(c), c);
  const dv = battery.find(m => m.class === 'default_value' && m.line === 2);
  assert.match(dv.text, /lowercase=False/);
  assert.equal(digest(battery) === digest(mutantBattery(src)), true, 'deterministic');
});

test('scanLeaks catches planted literals and lets generic rules through', () => {
  const base = { id: 'w', version: 1, nodes: [{ id: 'conf', kind: 'agent', instructions: 'Read the source notes. State how each system writes numeric dates.', returns: {}, checks: [] }], acceptance: [] };
  const withText = t => { const c = clone(base); c.version = 2; c.nodes[0].instructions += `\n${t}`; return c; };
  const task = { prompt: 'Merge the export.', inputs: { source_notes: 'BRIGHTDESK keeps customers in the legacy billing database. Dates there were typed by the Dublin office on 31/07/2005 and the ledger id is 48213. VENDEX writes balances in cents.' } };
  const idx = buildLeakIndex({ tasks: [task], outputs: [], truthPairs: [{ id: 'BRIGHTDESK', value: 'DMY' }], publicTexts: ['Merge the export.'], baseWorkflow: base });
  const rule = c => scanLeaks(base, c, idx).map(l => l.rule);
  assert.deepEqual(rule(withText('A system enters dates the way its notes show by example.')), [], 'a general rule is not a leak');
  assert.ok(rule(withText('Remember: the legacy billing database holds BRIGHTDESK customers.')).includes(1), 'rule 1: text copied from the failing task');
  assert.ok(rule(withText('Ledger id 48213 is special.')).includes(2), 'rule 2: a 3+ digit value of the failing task');
  assert.ok(rule(withText('BRIGHTDESK is always DMY.')).includes(3), 'rule 3: a task variable next to its hidden value');
  const table = Array.from({ length: 10 }, (_, i) => `'${['legacy', 'billing', 'database', 'dublin', 'office', 'ledger', 'customers', 'balances', 'cents', 'typed'][i]}'`).join(', ');
  const code = clone(base); code.version = 2; code.nodes.push({ id: 'k', kind: 'code', lang: 'js', needs: [], source: `export default function main() { return [${table}]; }` });
  assert.ok(scanLeaks(base, code, idx).some(l => l.rule === 4), 'rule 4: a literal table drawn from the task');
  const clean = clone(base); clean.version = 2; clean.nodes.push({ id: 'k', kind: 'code', lang: 'js', needs: [], source: 'export default function main(input) { return input.a === input.b; }' });
  assert.deepEqual(scanLeaks(base, clean, idx), []);
  assert.ok(addedContent(base, code).length > 0);
});

test('codeSafety flags new escapes in added code and ignores the pre-existing ones', () => {
  assert.deepEqual(codeSafety('def f(x):\n    return x + 1\n', 'python'), []);
  assert.ok(codeSafety('import os\nprint(os.listdir("/"))', 'python').length >= 1);
  assert.ok(codeSafety('x = eval("1")', 'python').length === 1);
  assert.ok(codeSafety('y = obj.__subclasses__()', 'python').length === 1);
  assert.deepEqual(codeSafety('import re\nimport json', 'python'), []);
  assert.ok(codeSafety('const x = require("fs")', 'js').length === 1);
  assert.deepEqual(codeSafety('export default function main(i) { return i.a; }', 'js'), []);
  const base = { id: 'w', nodes: [{ id: 'c', kind: 'code', lang: 'python', source: 'import sys\nimport traceback\ndef main(i):\n    return sys.version\n' }], acceptance: [] };
  const same = clone(base); same.nodes[0].source += '\n# comment\n';
  assert.deepEqual(unsafeAdditions(base, same), [], 'existing imports and comments are not additions');
  const bad = clone(base); bad.nodes[0].source += '\nimport subprocess\n';
  assert.equal(unsafeAdditions(base, bad)[0].code, 'HEAL_CODE_UNSAFE');
});

test('quoteInContract: a relaxation must quote the task, not paraphrase it', () => {
  const texts = ['Intro.', 'Issue #447: Vocabulary default min_count is wrong. With the default min_count, tokens that occur 2 times are left out.'];
  assert.equal(quoteInContract('Vocabulary default min_count is wrong', texts), true);
  assert.equal(quoteInContract('vocabulary   DEFAULT min_count is wrong', texts), true, 'whitespace and case are normalised');
  assert.equal(quoteInContract('the default may change freely', texts), false);
  assert.equal(quoteInContract('short', ['short']), false, 'a quote under 20 characters proves nothing');
});
