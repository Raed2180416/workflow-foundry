// code and verify nodes (DESIGN §1.2, §1.3, §5.2). Code runs in the real sandbox where available;
// the model is a scripted double. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow, validateDecision } from '../src/validate.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { runCode, sandboxStatus } from '../src/sandbox.mjs';
import { UNTRUSTED_PREAMBLE } from '../src/context.mjs';

const S = 'qwen3.5-2b-q4km', S2 = 'granite-4.2-3b-q4km', S4 = 'qwen3.5-4b-q4km';
const loaded = loadPolicy();
const sandbox = await sandboxStatus();
const needsSandbox = sandbox.available ? false : `code sandbox unavailable on this host (${sandbox.reason})`;
const base = (nodes, acceptance, extra = {}) => ({ schemaVersion: '1.0', id: 'CodeVerifyProbe', version: 1, title: 'Code and verify probe', goal: 'Total a small synthetic ledger',
  domain: 'general', envelope: { assumptions: ['Synthetic ledger text'], risks: ['Model arithmetic error'], successCriteria: ['Total matches the parsed rows'] },
  budget: { maxSteps: 50, maxConcurrency: 2, maxDurationMs: 60000 }, nodes, acceptance, ...extra });
const total = { type: 'object', additionalProperties: false, required: ['total'], properties: { total: { type: 'number' } } };
const parse = { id: 'parse', kind: 'code', needs: [], description: 'Parse name,amount rows', lang: 'js', args: { text: { $ref: 'input.raw' } },
  source: 'export default function main(input) { return { rows: input.text.trim().split("\\n").map(line => { const [name, n] = line.split(","); return { name, n: Number(n) }; }) }; }',
  returns: { type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: { type: 'object', required: ['name', 'n'], properties: { name: { type: 'string' }, n: { type: 'number' } } } } } } };
const sum = (needs = ['parse'], extra = {}) => ({ id: 'sum', kind: 'agent', needs, description: 'Add the amounts', role: 'synthesis', instructions: 'Return the sum of n over all rows.',
  context: { inputs: [{ name: 'rows', ref: 'nodes.parse.rows', render: 'json' }] }, returns: total, model: { class: 'S' }, ...extra });
const pythonCheck = { id: 'check', kind: 'verify', needs: ['sum', 'parse'], description: 'Recompute the total', method: 'code', lang: 'python', independence: 'execution',
  subject: { total: { $ref: 'nodes.sum.total' }, rows: { $ref: 'nodes.parse.rows' } },
  source: 'def main(input):\n    s = input["subject"]\n    ok = s["total"] == sum(r["n"] for r in s["rows"])\n    return {"pass": ok, "score": 1 if ok else 0, "reasons": [] if ok else ["total differs from the parsed rows"]}\n' };
const passed = id => [{ op: 'eq', left: { $ref: `nodes.${id}.pass` }, right: true }];

function harness(t, workflow, { script = {}, input = { raw: 'a,3\nb,4' }, registry = createDefaultRegistry(), codeRunner, runOptions = {}, policy = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-code-verify-'));
  const store = new Store(root), provider = new ScriptedProvider(script);
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
  const runtime = new Runtime(store, registry, { maxCost: 0, allowedCapabilities: registry.list().filter(c => c.risk === 'low').map(c => c.name), ...policy }, { models, modelPolicy: loaded, ...(codeRunner ? { codeRunner } : {}) });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const validation = validateWorkflow(workflow, { registry, modelPolicy: loaded });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  store.saveWorkflow(workflow);
  const run = runtime.create(workflow, input, runOptions);
  return { store, provider, runtime, run, of: type => store.events(run.id).filter(e => e.type === type) };
}
const codes = workflow => validateWorkflow(workflow, { registry: createDefaultRegistry(), modelPolicy: loaded }).errors.map(e => e.code);
// A codeRunner double for runtime-semantics tests that do not exercise the sandbox itself.
const fakeCode = results => async spec => { const next = results.shift(); if (next instanceof Error) throw next; return { value: typeof next === 'function' ? next(spec) : next, stderr: '', elapsedMs: 0 }; };

test('code -> agent -> verify: sandboxed parse, model sum and an executable python check end to end', { skip: needsSandbox }, async t => {
  const workflow = base([parse, sum(), pythonCheck], passed('check'), { labels: { 'input.raw': 'untrusted:upload' } });
  const h = harness(t, workflow, { script: { [S]: [{ value: { total: 7 } }] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(run.outputs.parse, { rows: [{ name: 'a', n: 3 }, { name: 'b', n: 4 }] });
  assert.deepEqual(run.outputs.sum, { total: 7 });
  assert.deepEqual(run.outputs.check, { pass: true, score: 1, reasons: [], independence: 'execution' });
  assert.equal(run.verdict.verdict, 'pass');
  // Taint flows input.raw -> code output -> agent context; the receipt and prompt say so.
  assert.equal(run.nodes.parse.outputLabel, 'untrusted:upload');
  assert.ok(h.provider.calls[0].prompt.includes(`${UNTRUSTED_PREAMBLE}\n<input name="rows" label="untrusted:upload">`));
  assert.equal(h.of('context.compiled')[0].receipt.inputs[0].sourceRef, 'nodes.parse.rows');
  assert.deepEqual(h.store.decisions(run.id).map(d => validateDecision(d).kind), ['verdict']);
});

test('verify: a failing gate stops the run as inconclusive; gate:false records the verdict and continues', { skip: needsSandbox }, async t => {
  await t.test('gate', async t => {
    const h = harness(t, base([parse, sum(), pythonCheck], passed('check')), { script: { [S]: [{ value: { total: 8 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'failed');
    assert.equal(run.error.code, 'VERIFY_FAILED');
    assert.doesNotMatch(run.error.message, /differs/, 'verifier reasons never enter error text');
    assert.equal(run.verdict.verdict, 'inconclusive');
    assert.deepEqual(run.nodes.check.verdict, { pass: false, score: 0, reasons: ['total differs from the parsed rows'], independence: 'execution' });
    assert.equal(h.of('verify.failed').length, 1);
  });
  await t.test('record only', async t => {
    const recorded = { ...pythonCheck, gate: false };
    const h = harness(t, base([parse, sum(), recorded], [{ op: 'exists', value: { $ref: 'nodes.check.pass' } }]), { script: { [S]: [{ value: { total: 8 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    assert.equal(run.outputs.check.pass, false);
    assert.equal(run.verdict.verdict, 'pass', 'the workflow chose not to gate; its own acceptance decides');
  });
});

test('code: declared returns are enforced and sandbox faults keep their verdict class', { skip: needsSandbox }, async t => {
  await t.test('returns mismatch is CODE_OUTPUT', async t => {
    const wrong = { ...parse, source: 'export default function main() { return { rows: "nope" }; }' };
    const h = harness(t, base([wrong], [{ op: 'exists', value: { $ref: 'nodes.parse.rows' } }]));
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.error.code, 'CODE_OUTPUT');
    assert.equal(run.verdict.verdict, 'harness_fault');
  });
  await t.test('a thrown error is CODE_ERROR', async t => {
    const h = harness(t, base([{ ...parse, source: 'export default function main() { throw new Error("boom"); }' }], [{ op: 'exists', value: { $ref: 'nodes.parse.rows' } }]));
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.error.code, 'CODE_ERROR');
    assert.equal(run.verdict.verdict, 'harness_fault');
  });
  await t.test('a missing sandbox is SANDBOX_UNAVAILABLE, never an unsandboxed run', async t => {
    const h = harness(t, base([parse], [{ op: 'exists', value: { $ref: 'nodes.parse.rows' } }]), { codeRunner: spec => runCode({ ...spec, unshare: '/nonexistent/unshare' }) });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.error.code, 'SANDBOX_UNAVAILABLE');
    assert.equal(run.verdict.verdict, 'env_fault');
  });
  await t.test('timeouts are bounded by the node', async t => {
    const h = harness(t, base([{ ...parse, timeoutMs: 300, source: 'export default async function main() { await new Promise(() => setInterval(() => {}, 1000)); }' }], [{ op: 'exists', value: { $ref: 'nodes.parse.rows' } }]));
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.error.code, 'CODE_TIMEOUT');
  });
});

test('verify: different-model independence picks another family and is enforced statically and at runtime', async t => {
  const producer = sum(['parse'], { model: { id: S } });
  const judge = { id: 'judge', kind: 'verify', needs: ['sum', 'parse'], description: 'Judge the total', method: 'agent', independence: 'different-model',
    instructions: 'Decide whether the total is the sum of the rows.', subject: { $ref: 'nodes.sum' }, context: { inputs: [{ name: 'rows', ref: 'nodes.parse.rows', render: 'json' }] },
    model: { class: 'S' } };
  const code = fakeCode([{ rows: [{ name: 'a', n: 3 }, { name: 'b', n: 4 }] }]);
  const h = harness(t, base([parse, producer, judge], passed('judge')), { codeRunner: code, script: { [S]: [{ value: { total: 7 } }], [S2]: [{ value: { pass: true, score: 0.9, reasons: ['sum checks out'] } }] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(h.provider.calls.map(c => c.modelId), [S, S2], 'the qwen-family producer is judged by the first non-qwen S model');
  assert.deepEqual(run.outputs.judge, { pass: true, score: 0.9, reasons: ['sum checks out'], independence: 'different-model' });
  assert.deepEqual([run.nodes.judge.modelFamily, run.nodes.judge.excludedFamilies], ['granite', ['qwen']]);
  assert.match(h.provider.calls[1].prompt, /<input name="subject" label="trusted">\n\{"total":7\}\n<\/input>/);

  // Static: a pinned same-family verifier is rejected; code verifiers are execution checks only.
  assert.ok(codes(base([parse, producer, { ...judge, model: { id: S4 } }], passed('judge'))).includes('VERIFY_INDEPENDENCE'));
  assert.ok(codes(base([parse, producer, { ...pythonCheck, independence: 'different-model' }], passed('check'))).includes('VERIFY_INDEPENDENCE'));
  assert.ok(codes(base([parse, producer, { ...judge, independence: 'execution' }], passed('judge'))).includes('VERIFY_INDEPENDENCE'));
  assert.ok(codes(base([parse, producer, { ...judge, lang: 'js' }], passed('judge'))).includes('WRONG_NODE_FIELD'));
  assert.ok(codes(base([parse, producer, { ...judge, context: { inputs: [{ name: 'subject', value: 1 }] } }], passed('judge'))).includes('CONTEXT_INPUT'));

  // Runtime: an assignment that would put the verifier back in the producer's family is refused.
  const same = harness(t, base([parse, producer, judge], passed('judge')), { codeRunner: fakeCode([{ rows: [{ name: 'a', n: 7 }] }]), runOptions: { assignment: { judge: S4 } },
    script: { [S]: [{ value: { total: 7 } }], [S4]: [{ value: { pass: true, score: 1, reasons: [] } }] } });
  const refused = await same.runtime.execute(same.run.id);
  assert.equal(refused.error.code, 'VERIFY_INDEPENDENCE');
  assert.equal(refused.verdict.verdict, 'harness_fault');
  assert.deepEqual(same.provider.calls.map(c => c.modelId), [S], 'the same-family verifier is never called');
});

test('verify: a passing verifier in a discovery workflow is a confirmed finding', async t => {
  const candidate = { ...sum(), id: 'candidate' };
  const confirm = { id: 'confirm', kind: 'verify', needs: ['candidate'], description: 'Reproduce the candidate', method: 'code', lang: 'js', independence: 'execution', gate: false,
    subject: { $ref: 'nodes.candidate.total' }, source: 'export default ({ subject }) => ({ pass: subject > 5 })' };
  const acceptance = [{ op: 'exists', value: { $ref: 'nodes.confirm.pass' } }];
  for (const [value, verdict, count] of [[7, 'finding', 1], [3, 'pass', 0]]) {
    await t.test(`${verdict}`, async t => {
      const h = harness(t, base([parse, candidate, confirm], acceptance, { discovery: true }), {
        codeRunner: fakeCode([{ rows: [{ name: 'a', n: 7 }] }, spec => ({ pass: spec.input.subject > 5 })]), script: { [S]: [{ value: { total: value } }] } });
      const run = await h.runtime.execute(h.run.id);
      assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
      assert.equal(run.verdict.verdict, verdict);
      assert.equal((run.findings ?? []).length, count);
      if (count) assert.deepEqual(Object.keys(run.findings[0]).sort(), ['confirmed', 'independence', 'nodeKey', 'subjectHash']);
    });
  }
});

test('verify: a capability oracle must be effect-free and return the verifier contract', async t => {
  const registry = createDefaultRegistry();
  registry.register({ name: 'oracle.parity', description: 'Synthetic parity oracle', version: '1', implementation: 'test/oracle.parity', inputSchema: { type: 'object' },
    outputSchema: { type: 'object' }, effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 2000, cost: 0, cancellation: 'cooperative',
    execute: async ({ value }) => ({ pass: value % 2 === 0, reasons: [`value ${value}`] }) });
  const oracle = { id: 'oracle', kind: 'verify', needs: ['parse'], description: 'Check parity', method: 'capability', independence: 'execution', subject: { $ref: 'nodes.parse.rows' },
    tool: 'oracle.parity', args: { value: { $ref: 'nodes.parse.rows.0.n' } }, timeoutMs: 1000 };
  const h = harness(t, base([parse, oracle], passed('oracle')), { registry, codeRunner: fakeCode([{ rows: [{ name: 'a', n: 4 }] }]) });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(run.outputs.oracle, { pass: true, score: 1, reasons: ['value 4'], independence: 'execution' });
  const effectful = validateWorkflow(base([parse, { ...oracle, tool: 'fixture.remediate', args: { action: 'none' } }], passed('oracle')), { registry, modelPolicy: loaded });
  assert.ok(effectful.errors.some(e => e.code === 'VERIFY_EFFECTS'));
  const malformed = harness(t, base([parse, { ...oracle, tool: 'core.identity', args: { value: 1 } }], passed('oracle')), { codeRunner: fakeCode([{ rows: [{ name: 'a', n: 4 }] }]) });
  const stopped = await malformed.runtime.execute(malformed.run.id);
  assert.equal(stopped.error.code, 'VERIFY_PROTOCOL');
});
