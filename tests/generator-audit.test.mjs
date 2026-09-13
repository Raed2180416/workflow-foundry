import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { Foundry } from '../src/foundry.mjs';
import { WorkflowGenerator, startRequestProcessor } from '../src/generator.mjs';
import { suiteEvaluator } from '../src/evaluation.mjs';
import { digest, FoundryError } from '../src/data.mjs';

// Hand-authored adversarial CONTROL fixtures. Providers below are deterministic
// stubs, not models. No network, paid provider, actual TUI, or benchmark arm runs.
const audit = (name, fn) => test(`generator audit: ${name}`, { timeout: 10000 }, fn);
const ref = ($ref, ...fallback) => ({ $ref, ...(fallback.length ? { default: fallback[0] } : {}) });
const eq = (left, right) => ({ op: 'eq', left, right });
const task = (id, tool, args, needs = []) => ({ id, kind: 'task', description: `Synthetic audit ${id}`, needs, tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 } });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function workflow(value) {
  return {
    schemaVersion: '1.0', id: 'GeneratorAudit', version: 1,
    title: 'Deterministic generator control fixture', domain: 'diagnostic',
    goal: 'Return the sum of the supplied numbers under an independent host oracle.',
    envelope: { assumptions: ['Synthetic local control only'], risks: [], successCriteria: ['Independently computed sum matches.'] },
    budget: { maxSteps: 20, maxConcurrency: 2, maxDurationMs: 4000, maxCost: 0 },
    nodes: [value === undefined ? task('sum', 'core.aggregate', { operation: 'sum', values: ref('input.values') }) : task('sum', 'core.identity', { value })],
    acceptance: [{ op: 'exists', value: ref('nodes.sum.value') }]
  };
}
const response = w => ({ text: JSON.stringify({ workflow: w, rationale: 'Deterministic control fixture; no model-performance claim.' }), evidence: { provider: 'deterministic-audit-stub', measuredModelPerformance: false } });
function stub(sequence) {
  const calls = [];
  return { identity: { provider: 'deterministic-audit-stub', model: 'none', measuredModelPerformance: false }, calls,
    async generate(args) { const index = calls.length; calls.push(args); const value = sequence[Math.min(index, sequence.length - 1)]; return typeof value === 'function' ? await value(args) : structuredClone(value); }
  };
}
function harness(t) {
  const root = fileURLToPath(new URL('../evals/runs/', import.meta.url));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(path.join(root, 'generator-audit-'));
  const foundry = new Foundry(directory);
  t.after(async () => { await foundry.close(); rmSync(directory, { recursive: true, force: true }); });
  return foundry;
}
function request(foundry, options = {}) { return foundry.store.createRequest({ text: 'Compute the sum of the supplied input.values. Synthetic audit task.', ...options }); }
function hostReceipt(foundry, w, overrides = {}) {
  return { evaluatorId: 'deterministic-host-audit', passed: true, workflowHash: digest(w), registryHash: foundry.registry.hash(), envelope: ['Synthetic fixture only'], ...overrides };
}
const sumSuite = () => ({ schemaVersion: '1.0', id: 'generator-sum-control', split: 'diagnostic', task: 'Return the arithmetic sum.', envelope: ['Two enumerated numeric inputs'], cases: [
  { id: 'five', input: { values: [2, 3] }, expect: { statuses: ['succeeded'], checks: [eq(ref('nodes.sum.value'), 5)] } },
  { id: 'seven', input: { values: [1, 6] }, expect: { statuses: ['succeeded'], checks: [eq(ref('nodes.sum.value'), 7)] } }
] });

audit('malformed JSON is repaired within the explicit round budget and raw response is retained', async t => {
  const f = harness(t), p = stub([{ text: '{broken' }, response(workflow())]);
  const job = await new WorkflowGenerator(f, p, { maxRounds: 2 }).generate(request(f).id);
  assert.equal(job.status, 'proposed'); assert.equal(p.calls.length, 2);
  assert.match(p.calls[1].prompt, /CANDIDATE_FORMAT/);
  assert.equal(job.attempts[0].error.code, 'CANDIDATE_FORMAT');
  assert.equal(JSON.parse(readFileSync(path.join(f.store.directory, 'generation', job.id, '01', 'response.json'))).text, '{broken');
  assert.equal(job.deploymentQualified, false); assert.equal(f.store.workflows().length, 0);
});

audit('schema-invalid candidate is repaired with an independent evaluator configured', async t => {
  const f = harness(t), bad = workflow(); delete bad.nodes[0].tool;
  const p = stub([response(bad), response(workflow())]);
  const job = await new WorkflowGenerator(f, p, { maxRounds: 2, evaluator: suiteEvaluator(sumSuite()) }).generate(request(f).id);
  assert.equal(job.status, 'proposed', JSON.stringify(job.error));
  assert.equal(p.calls.length, 2); assert.match(p.calls[1].prompt, /SCHEMA/);
  assert.equal(job.attempts[0].assessment.validation.valid, false);
  assert.equal(job.deploymentQualified, true);
});

audit('real native counterexamples repair a constant-output impostor', async t => {
  const f = harness(t), p = stub([response(workflow(5)), response(workflow())]);
  const job = await new WorkflowGenerator(f, p, { maxRounds: 2, evaluator: suiteEvaluator(sumSuite()) }).generate(request(f).id);
  assert.equal(job.status, 'proposed', JSON.stringify(job.error)); assert.equal(p.calls.length, 2);
  const rejected = job.attempts[0].assessment.evaluation;
  assert.equal(rejected.passed, false); assert.equal(rejected.metrics.falseSuccessCount, 1);
  assert.match(p.calls[1].prompt, /falseSuccess/);
  assert.equal(f.store.qualifications(job.workflowHash).length, 1);
});

audit('exhaustion never requeues a failed request or exceeds the configured rounds', async t => {
  const f = harness(t), p = stub([{ text: 'bad JSON' }]), r = request(f);
  const g = new WorkflowGenerator(f, p, { maxRounds: 2 });
  const job = await g.generate(r.id);
  assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'GENERATION_EXHAUSTED');
  assert.equal(p.calls.length, 2); assert.equal(f.store.request(r.id).status, 'failed');
  await assert.rejects(g.generate(r.id), { code: 'REQUEST_NOT_PENDING' });
  assert.equal(f.store.proposals().length, 0);
});

audit('a provider failure is terminal instead of consuming repair rounds', async t => {
  const f = harness(t), p = stub([() => { throw new FoundryError('MODEL_FAILED', 'Synthetic provider outage'); }]);
  const job = await new WorkflowGenerator(f, p, { maxRounds: 3 }).generate(request(f).id);
  assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'MODEL_FAILED'); assert.equal(p.calls.length, 1);
});

audit('duplicate jobs across two generators are excluded before a second provider dispatch', async t => {
  const f = harness(t), entered = deferred(), release = deferred();
  const p = stub([async () => { entered.resolve(); await release.promise; return response(workflow()); }]);
  const r = request(f), g = new WorkflowGenerator(f, p), other = new WorkflowGenerator(f, p);
  const running = g.generate(r.id); await entered.promise;
  try { await assert.rejects(other.generate(r.id), { code: 'REQUEST_NOT_PENDING' }); }
  finally { release.resolve(); await running; }
  assert.equal(p.calls.length, 1); assert.equal(f.store.generationJobs().length, 1);
});

audit('a stale generation cannot overwrite a concurrently advanced workflow head', async t => {
  const f = harness(t), initial = workflow(), saved = f.save(initial);
  const r = request(f, { workflowId: initial.id });
  const edited = { ...workflow(99), version: 2 }, candidate = { ...workflow(), version: 2 };
  const p = stub([() => { f.save(edited, saved.hash); return response(candidate); }]);
  const job = await new WorkflowGenerator(f, p, { autoApply: true }).generate(r.id);
  assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'STALE_WORKFLOW');
  assert.equal(f.store.workflow(initial.id).hash, digest(edited));
  assert.ok(!f.store.proposals().some(item => item.status === 'applied'));
});

audit('pre-cancelled generation never invokes the provider', async t => {
  const f = harness(t), p = stub([response(workflow())]), c = new AbortController(); c.abort();
  const job = await new WorkflowGenerator(f, p).generate(request(f).id, { signal: c.signal });
  assert.equal(job.status, 'cancelled'); assert.equal(p.calls.length, 0);
});

audit('cancellation while evaluation is pending cannot publish or qualify its late receipt', async t => {
  const f = harness(t), entered = deferred(), release = deferred(), c = new AbortController();
  const evaluator = { id: 'deterministic-host-audit', async evaluate({ workflow: w }) { entered.resolve(); await release.promise; return hostReceipt(f, w); } };
  const g = new WorkflowGenerator(f, stub([response(workflow())]), { evaluator, autoApply: true });
  const pending = g.generate(request(f).id, { signal: c.signal }); await entered.promise;
  c.abort(); release.resolve(); const job = await pending;
  assert.equal(job.status, 'cancelled', 'A late valid evaluator receipt cannot revive cancelled generation.');
  assert.equal(f.store.proposals().length, 0); assert.equal(f.store.qualifications().length, 0);
});

audit('generation deadline also covers the evaluator await', async t => {
  const f = harness(t);
  const evaluator = { id: 'deterministic-host-audit', async evaluate({ workflow: w }) { await delay(160); return hostReceipt(f, w); } };
  const g = new WorkflowGenerator(f, stub([response(workflow())]), { evaluator, autoApply: true, maxDurationMs: 60 });
  const job = await g.generate(request(f).id);
  assert.equal(job.status, 'cancelled'); assert.equal(f.store.workflows().length, 0);
});

audit('an uncooperative provider cannot hold generation open beyond its host deadline', async t => {
  const f = harness(t), entered = deferred(), release = deferred();
  const p = stub([async () => { entered.resolve(); await release.promise; return response(workflow()); }]);
  const g = new WorkflowGenerator(f, p, { maxDurationMs: 30 });
  const pending = g.generate(request(f).id); await entered.promise;
  const outcome = await Promise.race([pending.then(job => ({ job })), delay(220).then(() => ({ stalled: true }))]);
  release.resolve(); await pending;
  assert.equal(outcome.stalled, undefined, 'Host generation must settle without waiting for an uncooperative callback.');
  assert.equal(outcome.job.status, 'cancelled'); assert.equal(f.store.proposals().length, 0);
});

for (const [label, mutate] of [
  ['missing receipt', () => null], ['non-boolean passed', r => ({ ...r, passed: 'true' })],
  ['wrong evaluator identity', r => ({ ...r, evaluatorId: 'another-evaluator' })],
  ['missing workflow binding', r => { delete r.workflowHash; return r; }],
  ['wrong workflow binding', r => ({ ...r, workflowHash: '0'.repeat(64) })],
  ['wrong registry binding', r => ({ ...r, registryHash: 'f'.repeat(64) })]
]) audit(`rejects malformed evaluator receipt: ${label}`, async t => {
  const f = harness(t), p = stub([response(workflow())]);
  const evaluator = { id: 'deterministic-host-audit', async evaluate({ workflow: w }) { return mutate(hostReceipt(f, w)); } };
  const job = await new WorkflowGenerator(f, p, { evaluator, autoApply: true }).generate(request(f).id);
  assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'INVALID_EVALUATOR_RECEIPT');
  assert.equal(p.calls.length, 1); assert.equal(f.store.workflows().length, 0);
});

audit('auto-applied syntax-only candidates remain independently unqualified', async t => {
  const f = harness(t), g = new WorkflowGenerator(f, stub([response(workflow())]), { autoApply: true });
  f.generator = g;
  const job = await g.generate(request(f).id);
  assert.equal(job.status, 'applied'); assert.equal(job.deploymentQualified, false);
  const created = f.createRun('GeneratorAudit', { values: [4, 6] });
  await f.startRun(created.id);
  assert.equal(f.inspectRun(created.id).independentTaskVerified, false);
  assert.equal(f.state().agent.deploymentQualifiedByDefault, false);
});

audit('a configured evaluator is not qualification before it has run', async t => {
  const f = harness(t); f.generator = new WorkflowGenerator(f, stub([response(workflow())]), { evaluator: suiteEvaluator(sumSuite()) });
  assert.equal(f.state().agent.deploymentQualifiedByDefault, false);
});

audit('qualification for a previous version never migrates to a revised workflow hash', async t => {
  const f = harness(t), job = await new WorkflowGenerator(f, stub([response(workflow())]), { autoApply: true, evaluator: suiteEvaluator(sumSuite()) }).generate(request(f).id);
  assert.equal(job.status, 'applied'); assert.equal(job.deploymentQualified, true);
  const next = { ...workflow(999), version: 2 }; f.save(next, job.workflowHash);
  assert.equal(f.store.qualifications(job.workflowHash).length, 1);
  assert.equal(f.store.qualifications(digest(next)).length, 0);
});

audit('receipt-directory failure leaves a failed job instead of a permanently processing request', async t => {
  const f = harness(t), r = request(f), p = stub([response(workflow())]);
  writeFileSync(path.join(f.store.directory, 'generation'), 'Synthetic path-conflict fixture');
  await new WorkflowGenerator(f, p).generate(r.id).catch(() => null);
  assert.equal(f.store.generationJobs()[0].status, 'failed');
  assert.equal(f.store.request(r.id).status, 'failed'); assert.equal(p.calls.length, 0);
});

audit('jobs left by an exited process are surfaced as interrupted', async t => {
  const f = harness(t);
  const script = `import { Store } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
    const store = new Store(process.argv[1]);
    const request = store.createRequest({text: 'Synthetic exited-worker job'});
    const job = store.createGenerationJob(request.id, {provider:'deterministic-audit-stub'}, {maxRounds:1,maxDurationMs:100});
    process.stdout.write(JSON.stringify({id:job.id,requestId:request.id})); store.close();`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, f.store.workspace], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
  const orphan = JSON.parse(child.stdout);
  assert.ok(['interrupted', 'failed'].includes(f.store.generationJob(orphan.id).status), 'A dead owner cannot remain indistinguishable from an active generator.');
});

audit('the processor reaches pending requests older than the public 100-row display window', async t => {
  const f = harness(t), oldest = request(f);
  for (let i = 0; i < 100; i++) {
    const newer = request(f), job = f.store.createGenerationJob(newer.id, { provider: 'deterministic-audit-stub' }, { maxRounds: 1 });
    f.store.updateGenerationJob(job.id, current => { current.status = 'failed'; });
  }
  const p = stub([response(workflow())]);
  const processor = startRequestProcessor(new WorkflowGenerator(f, p), { intervalMs: 5 });
  try { await delay(80); } finally { await processor.close(); }
  assert.equal(f.store.request(oldest.id).status, 'proposed'); assert.equal(p.calls.length, 1);
});
