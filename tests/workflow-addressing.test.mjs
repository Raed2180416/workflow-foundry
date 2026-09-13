import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../src/foundry.mjs';
import { digest } from '../src/data.mjs';

test('a generated workflow id cannot shadow an existing immutable workflow hash', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-addressing-'));
  const foundry = new Foundry(directory);
  t.after(async () => { await foundry.close(); rmSync(directory, { recursive: true, force: true }); });
  const workflow = { schemaVersion: '1.0', id: 'Original', version: 1, title: 'Original immutable workflow', goal: 'Preserve exact program addressing', domain: 'general',
    envelope: { assumptions: ['Local fixture'], risks: ['Ambiguous id/hash namespaces'], successCriteria: ['The run remains bound to the original program'] },
    budget: { maxSteps: 3, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
    nodes: [{ id: 'echo', kind: 'task', description: 'Echo the input', needs: [], tool: 'core.identity', args: { $ref: 'input' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    acceptance: [{ op: 'eq', left: { $ref: 'nodes.echo' }, right: { $ref: 'input' } }] };
  // A hash starting a-f also satisfies the historical workflow id regex. Find
  // such a neutral title deterministically instead of relying on a fixed digest.
  let hash;
  for (let i = 0; i < 100; i++) { workflow.title = `Original immutable workflow ${i}`; hash = digest(workflow); if (/^[a-f]/.test(hash)) break; }
  assert.match(hash, /^[a-f]/);
  foundry.save(workflow);
  const collision = structuredClone(workflow); collision.id = hash; collision.title = 'Must not shadow hash addressing';
  assert.throws(() => foundry.save(collision), error => error.code === 'INVALID_WORKFLOW' && error.details.some(d => d.code === 'AMBIGUOUS_WORKFLOW_ID'));
  assert.equal(foundry.store.workflow(hash).workflow.id, 'Original');
  const run = foundry.runtime.create(workflow, { marker: 'original' });
  assert.equal(run.workflowId, 'Original');
  assert.equal((await foundry.startRun(run.id)).status, 'succeeded');
});
