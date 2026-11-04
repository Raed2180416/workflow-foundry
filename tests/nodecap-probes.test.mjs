// Node capabilities spike, P0 day-one probes (research/nodecap-20261021/ARCHITECTURE.md §3.1). Each probe is a gate for the design:
// G1 a capability can chain a decision mid-run; G2 the tool-node lowering runs on the existing loop node with a scripted model;
// G4 an approval-gated dispatcher parks, resumes on a user decision, and its approval id moves with the registry hash.
// (G3, Chromium from an explicit executablePath, is exercised by tests/nodecap-cua.test.mjs.)
// Scripted provider only: no network, no model spend. Development evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { verifyRun } from '../src/verify-run.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';

const loaded = loadPolicy();
const M = loaded.policy.models.find(m => m.class === 'M').id;
const ref = ($ref, ...fallback) => ({ $ref, ...(fallback.length ? { default: fallback[0] } : {}) });
const base = (nodes, acceptance, extra = {}) => ({ schemaVersion: '1.0', id: 'NodecapProbe', version: 1, title: 'Nodecap probe', goal: 'Exercise the nodecap lowering on synthetic data',
  domain: 'diagnostic', envelope: { assumptions: ['Synthetic local capabilities only'], risks: [], successCriteria: ['The probe invariant holds'] },
  budget: { maxSteps: 200, maxConcurrency: 2, maxDurationMs: 60000, maxCost: 0 }, nodes, acceptance, ...extra });
const task = (id, tool, args, needs = [], extra = {}) => ({ id, kind: 'task', needs, description: `Probe task ${id}`, tool, args, timeoutMs: 5000, retry: { maxAttempts: 1 }, ...extra });
const spec = (name, execute, extra = {}) => ({ name, description: 'Synthetic probe capability', version: '1', implementation: `nodecap-probe/${name}`, inputSchema: {}, outputSchema: {},
  effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 5000, cost: 0, cancellation: 'cooperative', execute, ...extra });

function harness(t, workflow, { registry, script, input = {} }) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-nodecap-probe-'));
  const store = new Store(root), provider = new ScriptedProvider(script ?? (() => { throw new Error('no model call expected'); }));
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
  const runtime = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxCost: 0 }, { models, modelPolicy: loaded });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const validation = validateWorkflow(workflow, { registry, modelPolicy: loaded });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  store.saveWorkflow(workflow);
  const run = runtime.create(workflow, input);
  return { store, provider, runtime, run };
}

test('G1: a capability records a decision mid-run; it is chained and verify-run passes', async t => {
  const registry = createDefaultRegistry();
  registry.register(spec('probe.decide', async (args, ctx) => {
    const header = ctx.store.rows.header(ctx.runId);
    ctx.store.recordDecision(ctx.runId, { schema: 'foundry-decision/1', id: `${ctx.runId}/nodecap/probe/1`, at: Date.now(), kind: 'adaptation', identity: header.identity,
      features: { probe: 'G1' }, action: { grant: 'mcp.crm.search_contacts' }, alternatives: [], propensity: 1, rationale: 'probe', costUsd: 0 });
    return { recorded: true };
  }));
  const h = harness(t, base([task('decide', 'probe.decide', {})], [{ op: 'eq', left: ref('nodes.decide.recorded'), right: true }]), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  const chained = h.store.events(run.id).filter(e => e.type === 'decision.recorded').map(e => e.kind);
  assert.deepEqual(chained, ['adaptation', 'verdict'], 'the mid-run decision enters the hash chain');
  const report = verifyRun(h.store, run.id);
  assert.equal(report.ok, true, JSON.stringify(report).slice(0, 2000));
  assert.equal(report.checks.decisions === null ? 0 : 1, 1, "verify-run checked the decision rows");
});

test('G2: a three-turn tool loop lowers onto the existing loop node (previous.<node>, {$ref, default})', async t => {
  const registry = createDefaultRegistry();
  const calls = [];
  registry.register(spec('probe.do', async ({ step }) => { calls.push(step.tool); return { ok: true, result: { n: calls.length } }; }));
  registry.register(spec('probe.log', async ({ step, done: result, previous }) => {
    const transcript = [...previous.transcript, { action: step.action, tool: step.tool, result }];
    return { transcript, done: step.action === 'done', answer: step.answer ?? null };
  }));
  const decision = { type: 'object', additionalProperties: false, required: ['action', 'tool', 'args'], properties: {
    action: { enum: ['read', 'done'] }, tool: { enum: ['crm_search', 'none'] }, args: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } },
    answer: { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', maxLength: 200 } } } } };
  const loop = { id: 'work__loop', kind: 'loop', needs: [], description: 'Lowered tool node', maxIterations: 4, initial: { log: { transcript: [], done: false } },
    until: { op: 'eq', left: ref('nodes.log.done'), right: true },
    body: { nodes: [
      { id: 'step', kind: 'agent', needs: [], description: 'One tool-loop turn', role: 'plan', instructions: 'Pick the next action.', returns: decision, model: { class: 'M' },
        context: { inputs: [{ name: 'transcript', ref: 'previous.log.transcript', label: 'untrusted:nodecap.work', render: 'json' }] } },
      task('do', 'probe.do', { step: ref('nodes.step') }, ['step'], { when: { op: 'eq', left: ref('nodes.step.action'), right: 'read' } }),
      task('log', 'probe.log', { step: ref('nodes.step'), done: ref('nodes.do', null), previous: ref('previous.log') }, ['step', 'do'], { join: 'all_resolved' })
    ], acceptance: [{ op: 'exists', value: ref('nodes.log.done') }] } };
  const workflow = base([loop], [{ op: 'eq', left: ref('nodes.work__loop.last.log.answer.email'), right: 'ada@example.test' }]);
  const script = { [M]: [{ value: { action: 'read', tool: 'crm_search', args: { query: 'Ada' } } }, { value: { action: 'read', tool: 'crm_search', args: { query: 'Ada L' } } },
    { value: { action: 'done', tool: 'none', args: {}, answer: { email: 'ada@example.test' } } }] };
  const h = harness(t, workflow, { registry, script });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(calls.length, 2);
  assert.equal(h.provider.calls.length, 3);
  assert.equal(run.outputs.work__loop.iterations, 3);
  assert.equal(run.outputs.work__loop.last.log.transcript.length, 3);
  // The third prompt carries the transcript of two turns, fenced as untrusted data.
  assert.match(h.provider.calls[2].prompt, /untrusted data/);
  assert.match(h.provider.calls[2].prompt, /crm_search/);
  // The loop's output is untrusted: the transcript context input carries an untrusted label.
  assert.match(run.nodes.work__loop.outputLabel ?? '', /untrusted:nodecap\.work/);
});

test('G4: an approval-gated dispatcher parks, resumes on a user decision, and the approval id moves with the registry hash', async t => {
  const make = implementation => {
    const registry = createDefaultRegistry();
    let sent = 0;
    registry.register(spec('probe.act', async () => ({ sent: ++sent }), { effects: 'non-idempotent', risk: 'high', requiresApproval: true, implementation }));
    return { registry, sent: () => sent };
  };
  const workflow = base([task('act', 'probe.act', { to: 'ops' })], [{ op: 'eq', left: ref('nodes.act.sent'), right: 1 }]);
  const a = make('lock-A'), h = harness(t, workflow, { registry: a.registry });
  let run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'awaiting_approval');
  assert.equal(a.sent(), 0);
  const [approvalA] = Object.keys(run.approvals);
  h.runtime.approve(run.id, approvalA, true, 'user');
  run = await h.runtime.execute(run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(a.sent(), 1);
  const b = make('lock-B'), h2 = harness(t, workflow, { registry: b.registry });
  const parked = await h2.runtime.execute(h2.run.id);
  const [approvalB] = Object.keys(parked.approvals);
  assert.notEqual(approvalA, approvalB, 'an approval binds the registry hash, so a changed pin is a different approval');
  assert.throws(() => h.runtime.approve(run.id, approvalB, true, 'model'), /explicit user approval/);
});
