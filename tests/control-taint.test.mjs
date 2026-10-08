// Control-flow (program-counter) taint: an effect whose FIRING depends on untrusted data is rejected the same
// way an effect whose ARGUMENTS depend on it is (ROADMAP §2.9; review-20261007/07 finding 3 and S2; lane-7 probe A.3).
// The first two tests are the lane-7 probe; the rest pin the propagation rules and the declassification routes.
// Local mock tools and the scripted provider only: no network, no model spend. Development/diagnostic evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateWorkflow } from '../src/validate.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';

const loaded = loadPolicy();
const registry = createDefaultRegistry();
// A mock outbound-notice capability. The default registry has no approval-gated effect, so tests add one.
const notifyTool = (extra = {}) => ({ name: 'test.notify', version: '1', implementation: 'control-taint-test', description: 'Mock outbound notice',
  inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, effects: 'idempotent', risk: 'low', requiresApproval: true, maxTimeoutMs: 1000, cost: 0,
  cancellation: 'cooperative', execute: async () => ({ sent: true }), ...extra });
const withNotify = extra => createDefaultRegistry().register(notifyTool(extra));

const flow = (nodes, extra = {}) => ({ schemaVersion: '1.0', id: 'ControlTaint', version: 1, title: 'Control taint probe', goal: 'Probe one control-flow taint rule',
  domain: 'general', envelope: { assumptions: ['Synthetic'], risks: [], successCriteria: ['The probed rule holds'] },
  budget: { maxSteps: 50, maxConcurrency: 2, maxDurationMs: 60000 }, nodes,
  acceptance: [{ op: 'exists', value: { $ref: `nodes.${nodes[0].id}` } }], ...extra });
const check = (workflow, options = {}) => validateWorkflow(workflow, { registry, modelPolicy: loaded, ...options });
const codes = (workflow, options) => check(workflow, options).errors.map(e => e.code);
const policyErrors = (workflow, options) => check(workflow, options).errors.filter(e => e.code === 'LABEL_POLICY');
const rules = (workflow, options) => policyErrors(workflow, options).map(e => `${e.rule}@${e.path}`);
const task = (id, tool, args, extra = {}) => ({ id, kind: 'task', needs: [], description: `Run ${id}`, tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...extra });
const ref = (path, extra = {}) => ({ $ref: path, ...extra });
const eq = (path, right) => ({ op: 'eq', left: ref(path), right });
const untrustedDoc = { 'input.doc': 'untrusted:web' };

// Lane-7 probe A.3: input `doc` is untrusted:web; `read` is core.identity on input.doc; `write` is core.artifact
// (effects idempotent, risk low, no approval).
const read = task('read', 'core.identity', { value: ref('input.doc') });
const fixedWrite = (extra = {}) => task('write', 'core.artifact', { name: 'note.txt', content: 'fixed text' }, extra);
const guarded = extra => fixedWrite({ needs: ['read'], when: eq('nodes.read.value', 'go'), ...extra });

// Declassification routes: a quarantined judgment with a bounded enum, and a human answer.
const judge = (extra = {}) => ({ id: 'judge', kind: 'agent', needs: [], description: 'Decide whether to proceed', role: 'judge', instructions: 'Answer go or stop.',
  context: { inputs: [{ name: 'doc', ref: 'input.doc', render: 'text' }] }, returns: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { type: 'string', enum: ['go', 'stop'] } } },
  model: { class: 'S', maxClass: 'M' }, quarantined: true, ...extra });
const ask = (extra = {}) => ({ id: 'ask', kind: 'human', needs: [], description: 'A person decides', question: 'Proceed with the write?', answerSchema: { type: 'boolean' }, ...extra });

test('probe A.3 case A (control): untrusted data in the effect arguments is rejected', () => {
  const write = task('write', 'core.artifact', { name: 'note.txt', content: ref('nodes.read.value') }, { needs: ['read'] });
  const result = check(flow([read, write], { labels: untrustedDoc }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.code === 'LABEL_POLICY' && e.rule === 'UNTRUSTED_EFFECT_ARGS'), JSON.stringify(result.errors));
});

test('probe A.3 case B: a fixed-argument effect gated by `when` on an untrusted-derived value is rejected', () => {
  const result = check(flow([read, guarded()], { labels: untrustedDoc }));
  assert.equal(result.valid, false, 'the validator accepted an effect whose firing is decided by untrusted data');
  const policy = result.errors.find(e => e.code === 'LABEL_POLICY');
  assert.ok(policy, JSON.stringify(result.errors));
  assert.deepEqual([policy.rule, policy.path, policy.label], ['UNTRUSTED_CONTROL', 'workflow.write', 'untrusted:web']);
  assert.match(policy.via[0], /write is guarded by a when that reads nodes\.read\.value/, 'the finding names the control edge a repair must cut');
  assert.ok(result.errors.some(e => e.code === 'UNTRUSTED_CONTROL'), 'the rule code is also reported as a code of its own, as UNTRUSTED_EFFECT_ARGS is');
});

test('a guard on the untrusted input itself is control too, and an untrusted guard on a non-effect is allowed', () => {
  assert.deepEqual(rules(flow([fixedWrite({ when: eq('input.doc', 'go') })], { labels: untrustedDoc })), ['UNTRUSTED_CONTROL@workflow.write']);
  assert.deepEqual(codes(flow([task('peek', 'core.identity', { value: 1 }, { when: eq('input.doc', 'go') })], { labels: untrustedDoc })), [], 'identity has no effects: only effects are gated');
});

test('both rules are reported when arguments and firing both depend on untrusted data', () => {
  const write = task('write', 'core.artifact', { name: 'note.txt', content: ref('nodes.read.value') }, { needs: ['read'], when: eq('nodes.read.value', 'go') });
  assert.deepEqual(rules(flow([read, write], { labels: untrustedDoc })), ['UNTRUSTED_EFFECT_ARGS@workflow.write', 'UNTRUSTED_CONTROL@workflow.write']);
});

test('trusted guards are unaffected, including a trusted guard next to an untrusted input', () => {
  const trusted = fixedWrite({ when: eq('input.mode', 'go') });
  assert.deepEqual(codes(flow([trusted])), []);
  assert.deepEqual(codes(flow([read, { ...trusted, needs: ['read'] }], { labels: untrustedDoc })), [], 'the label is on input.doc, not input.mode');
  assert.deepEqual(codes(flow([read, guarded()])), [], 'the same graph over unlabelled input is valid');
});

// ---- declassification routes -----------------------------------------------------------------------------------------

test('route 1: a quarantined bounded-enum judgment declassifies the decision', () => {
  const write = fixedWrite({ needs: ['judge'], when: eq('nodes.judge.verdict', 'go') });
  assert.deepEqual(codes(flow([judge(), write], { labels: untrustedDoc })), []);
  assert.deepEqual(rules(flow([judge({ quarantined: false }), write], { labels: untrustedDoc })), ['UNTRUSTED_CONTROL@workflow.write'], 'the same judgment without quarantine is an untrusted guard');
});

test('route 2: a human answer declassifies the decision', () => {
  const write = fixedWrite({ needs: ['ask'], when: eq('nodes.ask.answer', true) });
  assert.deepEqual(codes(flow([read, ask({ needs: ['read'] }), write], { labels: untrustedDoc })), []);
});

test('route 3: an approval-gated capability may be controlled by untrusted data, because a person approves the call', () => {
  for (const gate of [{ requiresApproval: true }, { requiresApproval: false, risk: 'high' }]) {
    const notify = task('notify', 'test.notify', { text: 'review the document' }, { needs: ['read'], when: eq('nodes.read.value', 'go') });
    assert.deepEqual(codes(flow([read, notify], { labels: untrustedDoc }), { registry: withNotify(gate) }), [], JSON.stringify(gate));
  }
  const open = task('notify', 'test.notify', { text: 'review the document' }, { needs: ['read'], when: eq('nodes.read.value', 'go') });
  assert.deepEqual(rules(flow([read, open], { labels: untrustedDoc }), { registry: withNotify({ requiresApproval: false }) }), ['UNTRUSTED_CONTROL@workflow.notify'], 'the same capability without an approval gate is rejected');
});

test('declassifying the data does not declassify a guard that was already untrusted', () => {
  // The judge runs only when untrusted data says so; that it ran at all is itself a read of the guard.
  const gatedJudge = judge({ needs: ['read'], when: eq('nodes.read.value', 'go') });
  const write = fixedWrite({ needs: ['judge'], when: eq('nodes.judge.verdict', 'go') });
  assert.deepEqual(rules(flow([read, gatedJudge, write], { labels: untrustedDoc })), ['UNTRUSTED_CONTROL@workflow.write']);
});

// ---- propagation through needs ---------------------------------------------------------------------------------------

test('a skip decided by untrusted data propagates through needs, directly and transitively', () => {
  const gate = task('gate', 'core.identity', { value: 1 }, { needs: ['read'], when: eq('nodes.read.value', 'go') });
  const direct = fixedWrite({ needs: ['gate'] });
  const result = check(flow([read, gate, direct], { labels: untrustedDoc }));
  assert.deepEqual(rules(flow([read, gate, direct], { labels: untrustedDoc })), ['UNTRUSTED_CONTROL@workflow.write']);
  assert.match(result.errors.find(e => e.code === 'LABEL_POLICY').via[0], /write needs gate <- gate is guarded by a when that reads nodes\.read\.value/);
  const middle = task('middle', 'core.identity', { value: 2 }, { needs: ['gate'] });
  assert.deepEqual(rules(flow([read, gate, middle, fixedWrite({ needs: ['middle'] })], { labels: untrustedDoc })), ['UNTRUSTED_CONTROL@workflow.write']);
});

test('plain data dependence on an untrusted node is not a control dependence', () => {
  // The write runs whenever the read succeeded, whatever the document says. Termination is not a tracked channel.
  assert.deepEqual(codes(flow([read, fixedWrite({ needs: ['read'] })], { labels: untrustedDoc })), []);
  const open = { id: 'open', kind: 'agent', needs: [], description: 'Summarise', role: 'generate', instructions: 'Summarise the document.', context: { inputs: [{ name: 'doc', ref: 'input.doc', render: 'text' }] },
    returns: { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string', maxLength: 200 } } }, model: { class: 'S', maxClass: 'M' } };
  assert.deepEqual(codes(flow([open, fixedWrite({ needs: ['open'] })], { labels: untrustedDoc })), [], 'an untrusted-reading agent that nothing branches on does not control the write');
});

test('a join of all_resolved is not decided by its predecessors, but a read of a skipped output is', () => {
  const gate = task('gate', 'core.identity', { value: 1 }, { needs: ['read'], when: eq('nodes.read.value', 'go') });
  assert.deepEqual(codes(flow([read, gate, fixedWrite({ needs: ['gate'], join: 'all_resolved' })], { labels: untrustedDoc })), [], 'it runs after the gate whether the gate ran or was skipped');
  const readsGate = task('write', 'core.artifact', { name: 'note.txt', content: ref('nodes.gate.value', { default: 'skipped' }) }, { needs: ['gate'], join: 'all_resolved' });
  assert.deepEqual(rules(flow([read, gate, readsGate], { labels: untrustedDoc })), ['UNTRUSTED_EFFECT_ARGS@workflow.write'], 'a default stands in only when the gate was skipped, so the value reveals the guard');
  const probe = fixedWrite({ needs: ['gate'], join: 'all_resolved', when: { op: 'exists', value: ref('nodes.gate.value') } });
  assert.deepEqual(rules(flow([read, gate, probe], { labels: untrustedDoc })), ['UNTRUSTED_CONTROL@workflow.write'], 'exists on a skipped output reads the guard');
});

test('onError continue lets the predecessor data decide whether the next node runs', () => {
  const risky = task('risky', 'core.validate', { value: ref('input.doc'), schema: { type: 'string', minLength: 3 } }, { onError: 'continue' });
  const afterRisky = { ...fixedWrite({ needs: ['risky'] }) };
  assert.deepEqual(rules(flow([risky, afterRisky], { labels: untrustedDoc })), ['UNTRUSTED_CONTROL@workflow.write']);
  assert.match(policyErrors(flow([risky, afterRisky], { labels: untrustedDoc }))[0].via[0], /risky continues on error over untrusted:web data/);
  assert.deepEqual(codes(flow([{ ...risky, onError: 'stop' }, afterRisky], { labels: untrustedDoc })), [], 'without continuation a failure stops the run: no skip channel');
});

// ---- maps and loops --------------------------------------------------------------------------------------------------

const mapOver = (items, body, extra = {}) => ({ id: 'each', kind: 'map', needs: [], description: 'Visit each item', items, maxItems: 5, body: { nodes: body, acceptance: [{ op: 'exists', value: ref(`nodes.${body[0].id}`) }] }, ...extra });

test('map: the item array decides how often a body effect fires', () => {
  const body = [task('mark', 'core.artifact', { name: 'mark.txt', content: 'fixed text' })];
  const untrusted = flow([mapOver(ref('input.doc'), body)], { labels: { 'input.doc': 'untrusted:web' } });
  assert.deepEqual(rules(untrusted), ['UNTRUSTED_CONTROL@workflow.each.body.mark']);
  assert.match(policyErrors(untrusted)[0].via[0], /map each iterates over input\.doc/);
  assert.deepEqual(codes(flow([mapOver(ref('input.rows'), body)], { labels: { 'input.doc': 'untrusted:web' } })), [], 'trusted items');
  assert.deepEqual(codes(flow([mapOver(ref('input.doc'), [task('peek', 'core.identity', { value: ref('item') })])], { labels: untrustedDoc })), [], 'no effect in the body');
});

test('map: a guard on the item inside the body, and the map count read downstream, are control', () => {
  const inBody = [task('mark', 'core.artifact', { name: 'mark.txt', content: 'fixed text' }, { when: { op: 'eq', left: ref('item'), right: 'go' } })];
  assert.deepEqual(rules(flow([mapOver(ref('input.rows'), inBody)], { labels: { 'input.rows': 'untrusted:csv' } })), ['UNTRUSTED_CONTROL@workflow.each.body.mark']);
  const counted = fixedWrite({ needs: ['each'], when: { op: 'gt', left: ref('nodes.each.count'), right: 2 } });
  assert.deepEqual(rules(flow([mapOver(ref('input.rows'), [task('peek', 'core.identity', { value: 1 })]), counted], { labels: { 'input.rows': 'untrusted:csv' } })), ['UNTRUSTED_CONTROL@workflow.write']);
});

test('map: a control label set by an enclosing guard reaches the body effect', () => {
  const body = [task('mark', 'core.artifact', { name: 'mark.txt', content: 'fixed text' })];
  const nested = flow([read, mapOver(ref('input.rows'), body, { needs: ['read'], when: eq('nodes.read.value', 'go') })], { labels: untrustedDoc });
  assert.deepEqual(rules(nested), ['UNTRUSTED_CONTROL@workflow.each.body.mark']);
});

const loopOver = (body, until, extra = {}) => ({ id: 'again', kind: 'loop', needs: [], description: 'Repeat until done', maxIterations: 3, initial: { seed: 0 }, until, body: { nodes: body, acceptance: [{ op: 'exists', value: ref(`nodes.${body[0].id}`) }] }, ...extra });

test('loop: an until decided by untrusted data decides how often a body effect fires', () => {
  const body = [task('check', 'core.identity', { value: ref('input.doc') }), task('mark', 'core.artifact', { name: 'mark.txt', content: 'fixed text' })];
  const untrustedUntil = flow([loopOver(body, eq('nodes.check.value', 'done'))], { labels: untrustedDoc });
  assert.deepEqual(rules(untrustedUntil), ['UNTRUSTED_CONTROL@workflow.again.body.mark']);
  assert.match(policyErrors(untrustedUntil)[0].via[0], /loop again exits on nodes\.check\.value/);
  assert.deepEqual(codes(flow([loopOver(body, { op: 'gte', left: ref('iteration'), right: 1 })], { labels: untrustedDoc })), [], 'an iteration-count until is trusted');
});

test('loop: the until label found in one fixpoint pass feeds the body in the next', () => {
  // Pass 1 sees a trusted until for `mark`; only after `check` is known to read the carried untrusted state does mark become control-dependent.
  const body = [task('check', 'core.identity', { value: ref('previous.seed') }), task('mark', 'core.artifact', { name: 'mark.txt', content: 'fixed text' })];
  const result = flow([loopOver(body, eq('nodes.check.value', 'done'), { initial: ref('input.doc') })], { labels: untrustedDoc });
  assert.deepEqual(rules(result), ['UNTRUSTED_CONTROL@workflow.again.body.mark']);
});

test('loop: a quarantined verdict as the until is a declassified decision, and the loop output carries the until label', () => {
  const body = [judge({ context: { inputs: [{ name: 'doc', ref: 'input.doc', render: 'text' }] } }), task('mark', 'core.artifact', { name: 'mark.txt', content: 'fixed text' })];
  assert.deepEqual(codes(flow([loopOver(body, eq('nodes.judge.verdict', 'go'))], { labels: untrustedDoc })), []);
  const counted = fixedWrite({ needs: ['again'], when: { op: 'gt', left: ref('nodes.again.iterations'), right: 1 } });
  const untrusted = loopOver([task('check', 'core.identity', { value: ref('input.doc') })], eq('nodes.check.value', 'done'));
  assert.deepEqual(rules(flow([untrusted, counted], { labels: untrustedDoc })), ['UNTRUSTED_CONTROL@workflow.write'], 'the iteration count is a function of the untrusted until');
});

// ---- no false positives on honest workflows --------------------------------------------------------------------------

test('the shipped example workflows still validate (no new LABEL_POLICY rejections)', () => {
  const directory = new URL('../examples/', import.meta.url);
  const examples = readdirSync(directory).filter(name => name.endsWith('.json'));
  let checked = 0;
  for (const name of examples) {
    const workflow = JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
    if (!workflow.nodes || !workflow.schemaVersion) continue;
    checked++;
    const result = check(workflow);
    assert.deepEqual(result.errors.filter(e => /LABEL_POLICY|UNTRUSTED_/.test(e.code)), [], name);
  }
  assert.ok(checked >= 1, 'at least one example workflow was checked');
});

// ---- runtime: the same decision, mirrored where the effect is dispatched ---------------------------------------------

function environment(t, makeRegistry = createDefaultRegistry) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-control-taint-'));
  const store = new Store(root), reg = makeRegistry();
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, registry: reg, runtime: new Runtime(store, reg, { maxCost: 0 }) };
}
async function run(env, workflow, input) {
  env.store.saveWorkflow(workflow);
  const created = env.runtime.create(workflow, input);
  return env.runtime.execute(created.id);
}
const allStates = r => [...Object.entries(r.nodes), ...Object.entries(r.frames).flatMap(([key, frame]) => Object.entries(frame.nodes).map(([id, state]) => [`${key}/${id}`, state]))];

test('runtime: a trusted run records no control label anywhere', async t => {
  const env = environment(t);
  const result = await run(env, flow([task('peek', 'core.identity', { value: 1 }), fixedWrite({ needs: ['peek'], when: eq('input.mode', 'go') })]), { mode: 'go' });
  assert.equal(result.status, 'succeeded', JSON.stringify(result.error));
  assert.deepEqual(allStates(result).filter(([, s]) => 'controlLabel' in s || 'outputLabel' in s), [], 'trusted state is byte-identical to before the change');
});

test('runtime: an untrusted guard labels the node, the skip, and what depends on the skip', async t => {
  const env = environment(t);
  const gate = task('gate', 'core.identity', { value: 1 }, { when: eq('input.doc', 'go') });
  const after = task('after', 'core.identity', { value: 2 }, { needs: ['gate'] });
  const result = await run(env, flow([gate, after], { labels: untrustedDoc, acceptance: [{ op: 'exists', value: ref('input.doc') }] }), { doc: 'stop' });
  assert.equal(result.status, 'succeeded', JSON.stringify(result.error));
  assert.deepEqual([result.nodes.gate.status, result.nodes.gate.controlLabel, result.nodes.gate.outputLabel], ['skipped', 'untrusted:web', 'untrusted:web']);
  assert.deepEqual([result.nodes.after.status, result.nodes.after.controlLabel], ['skipped', 'untrusted:web'], 'skipped because its predecessor was skipped');
  const ran = await run(environment(t), flow([gate, after], { labels: untrustedDoc, acceptance: [{ op: 'exists', value: ref('input.doc') }] }), { doc: 'go' });
  assert.deepEqual([ran.nodes.gate.status, ran.nodes.gate.controlLabel, ran.nodes.after.controlLabel, ran.nodes.after.outputLabel], ['completed', 'untrusted:web', 'untrusted:web', 'untrusted:web']);
});

test('runtime: a map over untrusted items labels every body node, and a quarantined-style trusted map does not', async t => {
  const body = [task('mark', 'core.identity', { value: 1 })];
  const labelled = await run(environment(t), flow([mapOver(ref('input.rows'), body)], { labels: { 'input.rows': 'untrusted:csv' } }), { rows: ['a', 'b'] });
  assert.equal(labelled.status, 'succeeded', JSON.stringify(labelled.error));
  const frames = allStates(labelled).filter(([key]) => key.includes('each:'));
  assert.equal(frames.length, 2);
  assert.ok(frames.every(([, s]) => s.controlLabel === 'untrusted:csv'), JSON.stringify(frames));
  assert.equal(labelled.nodes.each.outputLabel, 'untrusted:csv');
  const plain = await run(environment(t), flow([mapOver(ref('input.rows'), body)]), { rows: ['a', 'b'] });
  assert.deepEqual(allStates(plain).filter(([, s]) => 'controlLabel' in s), []);
});

test('runtime: a loop whose until reads untrusted data labels the iterations that follow the first decision, and its own output', async t => {
  // check carries the untrusted document; until reads check, so it is untrusted. Iteration 0 runs unconditionally; iteration 1 runs
  // because iteration 0's untrusted until said "again". (The validator is stricter and treats every iteration as controlled.)
  const body = [task('check', 'core.identity', { n: ref('iteration'), doc: ref('input.doc') })];
  const result = await run(environment(t), flow([loopOver(body, { op: 'gte', left: ref('nodes.check.n'), right: 1 })], { labels: untrustedDoc }), { doc: 'text' });
  assert.equal(result.status, 'succeeded', JSON.stringify(result.error));
  assert.equal(result.outputs.again.iterations, 2);
  assert.deepEqual([result.frames['root/again:0'].nodes.check.controlLabel, result.frames['root/again:1'].nodes.check.controlLabel], [undefined, 'untrusted:web']);
  assert.equal(result.nodes.again.outputLabel, 'untrusted:web');
});

test('runtime: an approval-gated effect controlled by untrusted data pauses for approval with the label recorded', async t => {
  const notify = task('notify', 'test.notify', { text: 'review the document' }, { when: eq('input.doc', 'go') });
  const env = environment(t, () => withNotify());
  const paused = await run(env, flow([notify], { labels: untrustedDoc }), { doc: 'go' });
  assert.equal(paused.status, 'awaiting_approval', JSON.stringify(paused.error));
  const [approvalId] = Object.keys(paused.approvals);
  assert.deepEqual([paused.approvals[approvalId].controlLabel, paused.approvals[approvalId].argsLabel], ['untrusted:web', undefined], 'the approver is told why the call was requested');
  env.runtime.approve(paused.id, approvalId, true);
  const done = await env.runtime.execute(paused.id);
  assert.equal(done.status, 'succeeded', JSON.stringify(done.error));
  assert.deepEqual([done.nodes.notify.controlLabel, done.nodes.notify.outputLabel], ['untrusted:web', 'untrusted:web']);
});

// Defence in depth: the validator is the first line, the dispatcher the second. A capability whose metadata changes between the
// two (a registry bug, a reload) must still not run an ungated effect on untrusted data or control. The registry below arms itself
// on the second hash() call, which Runtime.execute makes right after its validation pass.
class DriftingRegistry {
  constructor() { this.inner = withNotify(); this.hashCalls = 0; this.armed = false; }
  get(name) { const cap = this.inner.get(name); return this.armed && name === 'test.notify' ? { ...cap, requiresApproval: false } : cap; }
  list() { return this.inner.list(); }
  hash() { if (++this.hashCalls >= 2) this.armed = true; return this.inner.hash(); }
  execute(...args) { return this.inner.execute(...args); }
}
for (const [label, notify, rule] of [
  ['firing', task('notify', 'test.notify', { text: 'review the document' }, { when: eq('input.doc', 'go') }), 'UNTRUSTED_CONTROL'],
  ['arguments', task('notify', 'test.notify', { text: ref('input.doc') }), 'UNTRUSTED_EFFECT_ARGS']]) {
  test(`runtime: ${label} of an effect that became ungated after validation is refused with LABEL_POLICY (${rule})`, async t => {
    const env = environment(t, () => new DriftingRegistry());
    const result = await run(env, flow([notify], { labels: untrustedDoc }), { doc: 'go' });
    assert.equal(result.status, 'failed');
    assert.deepEqual([result.error.code, env.registry.armed], ['LABEL_POLICY', true]);
    assert.equal(result.nodes.notify.status, 'failed');
    assert.equal(env.store.events(result.id).some(e => e.type === 'tool.intent'), false, 'the effect was never dispatched');
  });
}
