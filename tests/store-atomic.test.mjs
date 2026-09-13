import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Foundry } from '../src/foundry.mjs';
import { Store } from '../src/store.mjs';
import { digest } from '../src/data.mjs';

const makeWorkflow = () => ({ schemaVersion: '1.0', id: 'AtomicProposal', version: 1,
  title: 'Atomic revision publication', goal: 'Preserve one version-bound program and request commit.', domain: 'general',
  envelope: { assumptions: [], risks: ['Partial metadata publication'], successCriteria: ['Echo the actual input'] },
  budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
  nodes: [{ id: 'echo', kind: 'task', needs: [], description: 'Return actual input.', tool: 'core.identity', args: { $ref: 'input' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.echo' }, right: { $ref: 'input' } }]
});
async function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-atomic-'));
  const foundry = new Foundry(dir);
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  const original = makeWorkflow(), { hash } = foundry.save(original);
  const request = foundry.store.createRequest({ workflowId: original.id, baseHash: hash, text: 'Improve the node description.' });
  const revision = structuredClone(original); revision.version = 2; revision.nodes[0].description = 'Echo the exact typed input; preserve all its fields.';
  return { foundry, dir, original, hash, request, revision };
}

test('Store atomicity: failed request-state write cannot leave a detached proposal', async t => {
  const { foundry, request, revision } = await setup(t);
  foundry.store.db.exec("CREATE TRIGGER fail_request_update BEFORE UPDATE ON requests BEGIN SELECT RAISE(ABORT,'injected request write failure'); END");
  assert.throws(() => foundry.propose({ requestId: request.id, workflow: revision, rationale: 'Clarify the current contract.' }), /injected/);
  assert.equal(foundry.store.proposals().length, 0);
  assert.equal(foundry.store.request(request.id).status, 'pending');
});

test('Store atomicity: application metadata failure rolls back the workflow head and inserted version', async t => {
  const { foundry, request, revision, hash, original } = await setup(t);
  const proposal = foundry.propose({ requestId: request.id, workflow: revision, rationale: 'Clarify the current contract.' });
  foundry.store.db.exec("CREATE TRIGGER fail_proposal_update BEFORE UPDATE ON proposals BEGIN SELECT RAISE(ABORT,'injected application write failure'); END");
  assert.throws(() => foundry.apply(proposal.id), /injected/);
  assert.equal(foundry.store.workflow(original.id).hash, hash);
  assert.equal(foundry.store.proposal(proposal.id).status, 'proposed');
  assert.equal(foundry.store.request(request.id).status, 'proposed');
  assert.throws(() => foundry.store.workflow(digest(revision)), { code: 'NOT_FOUND' });
  foundry.store.db.exec('DROP TRIGGER fail_proposal_update');
  assert.equal(foundry.apply(proposal.id).status, 'applied');
  assert.equal(foundry.store.workflow(original.id).hash, digest(revision));
  assert.equal(foundry.store.request(request.id).status, 'applied');
});

test('Store atomicity: actual process death before application commit leaves all prior state recoverable', async t => {
  const { foundry, dir, request, revision, hash, original } = await setup(t);
  const run = foundry.createRun(original.id, { marker: 'old pinned run' });
  const proposal = foundry.propose({ requestId: request.id, workflow: revision, rationale: 'Clarify the current contract.' });
  const moduleUrl = new URL('../src/store.mjs', import.meta.url).href;
  const source = `
    import { Store } from ${JSON.stringify(moduleUrl)};
    const store = new Store(${JSON.stringify(dir)});
    const raw = store.db;
    store.db = new Proxy(raw, { get(target, key) {
      if (key === 'prepare') return sql => {
        const statement = target.prepare(sql);
        if (sql.startsWith('UPDATE proposals SET')) return { run() { process.kill(process.pid, 'SIGKILL'); } };
        return statement;
      };
      const value = Reflect.get(target,key,target);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
    store.applyProposal(${JSON.stringify(proposal.id)});
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' }, timeout: 5000, encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  const reopened = new Store(dir);
  try {
    assert.equal(reopened.workflow(original.id).hash, hash);
    assert.equal(reopened.proposal(proposal.id).status, 'proposed');
    assert.equal(reopened.request(request.id).status, 'proposed');
    assert.throws(() => reopened.workflow(digest(revision)), { code: 'NOT_FOUND' });
    reopened.applyProposal(proposal.id);
    assert.equal(reopened.workflow(original.id).hash, digest(revision));
    assert.equal(reopened.run(run.id).workflowHash, hash);
    assert.equal(reopened.workflow(hash).workflow.version, 1);
  } finally { reopened.close(); }
});

test('Store atomicity: two competing proposals cannot both consume one request', async t => {
  const { foundry, dir, request, revision } = await setup(t);
  const a = foundry.propose({ requestId: request.id, workflow: revision, rationale: 'First candidate.' });
  const alternative = structuredClone(revision); alternative.title = 'Alternative description';
  const b = foundry.propose({ requestId: request.id, workflow: alternative, rationale: 'Competing candidate.' });
  const second = new Store(dir);
  try {
    foundry.apply(a.id);
    assert.throws(() => second.applyProposal(b.id), { code: 'REQUEST_CLOSED' });
    assert.equal(second.workflow(revision.id).hash, digest(revision));
    assert.equal(second.proposal(b.id).status, 'proposed');
    assert.equal(second.request(request.id).status, 'applied');
  } finally { second.close(); }
});
