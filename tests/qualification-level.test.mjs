import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../src/foundry.mjs';
import { WorkflowGenerator } from '../src/generator.mjs';
import { suiteEvaluator } from '../src/evaluation.mjs';
import { digest } from '../src/data.mjs';

const candidate = () => ({ schemaVersion: '1.0', id: 'QualificationLevel', version: 1,
  title: 'Separate construction and outcomes', domain: 'general', goal: 'Echo the exact input value.',
  envelope: { assumptions: ['Synthetic qualification controls'], risks: ['A structural check masquerades as a task oracle'], successCriteria: ['Exact output agrees with independent expected values'] },
  budget: { maxSteps: 3, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
  nodes: [{ id: 'echo', kind: 'task', needs: [], description: 'Echo input without alteration.', tool: 'core.identity', args: { $ref: 'input' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.echo' }, right: { $ref: 'input' } }]
});
async function harness(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-qualification-level-'));
  const foundry = new Foundry(dir);
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  const provider = { identity: { name: 'deterministic qualification control', model: 'none', externalCalls: false }, generate: async () => ({ text: JSON.stringify({ workflow: candidate(), rationale: 'Synthetic local control, not model performance.' }) }) };
  return { foundry, provider, request: foundry.store.createRequest({ text: 'Echo the supplied input exactly.' }) };
}

for (const level of [undefined, 'construction']) test(`Qualification: a passing ${level ?? 'unclassified'} check cannot qualify task outcomes`, async t => {
  const { foundry, provider, request } = await harness(t);
  const evaluator = { id: 'synthetic-shape-check', evaluate: async ({ workflow }) => ({ evaluatorId: 'synthetic-shape-check', passed: true,
    workflowHash: digest(workflow), registryHash: foundry.registry.hash(), ...(level ? { qualificationLevel: level } : {}), envelope: ['Shape/trace check only'] }) };
  const job = await new WorkflowGenerator(foundry, provider, { maxRounds: 1, autoApply: true, evaluator }).generate(request.id);
  assert.equal(job.status, 'applied'); assert.equal(job.deploymentQualified, false); assert.equal(job.taskOutcomeQualified, false);
  assert.equal(job.constructionQualified, level === 'construction'); assert.equal(job.qualificationLevel, level ?? 'unclassified');
  assert.equal(foundry.store.qualifications(job.workflowHash).length, 1, 'Preserve the check without changing its meaning');
});

test('Qualification: the real independent suite explicitly qualifies only its named task-outcome envelope', async t => {
  const { foundry, provider, request } = await harness(t);
  const suite = { schemaVersion: '1.0', id: 'exact-echo-cases', split: 'diagnostic', task: 'Echo input unchanged.', envelope: ['Two exact object inputs'], cases: [
    { id: 'first', input: { value: 3 }, expect: { statuses: ['succeeded'], checks: [{ op: 'eq', left: { $ref: 'nodes.echo.value' }, right: 3 }] } },
    { id: 'second', input: { value: 9 }, expect: { statuses: ['succeeded'], checks: [{ op: 'eq', left: { $ref: 'nodes.echo.value' }, right: 9 }] } }
  ] };
  const job = await new WorkflowGenerator(foundry, provider, { maxRounds: 1, evaluator: suiteEvaluator(suite) }).generate(request.id);
  assert.equal(job.status, 'proposed', JSON.stringify(job.error)); assert.equal(job.qualificationLevel, 'task-outcome');
  assert.equal(job.taskOutcomeQualified, true); assert.equal(job.constructionQualified, true);
  assert.match(job.qualification, /not general deployment readiness/);
  const report = foundry.store.qualifications(job.workflowHash)[0];
  assert.equal(report.metrics.passedCount, 2); assert.deepEqual(report.envelope, ['Two exact object inputs']);
});

test('Qualification: an invalid declared level is a host-evaluator error, not a model-repair round', async t => {
  const { foundry, provider, request } = await harness(t);
  const evaluator = { id: 'bad-host-level', evaluate: async ({ workflow }) => ({ evaluatorId: 'bad-host-level', passed: true, qualificationLevel: 'all-deployments', workflowHash: digest(workflow), registryHash: foundry.registry.hash() }) };
  const job = await new WorkflowGenerator(foundry, provider, { maxRounds: 3, evaluator }).generate(request.id);
  assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'QUALIFICATION');
  assert.equal(job.attempts.length, 1); assert.equal(foundry.store.proposals().length, 0);
});
