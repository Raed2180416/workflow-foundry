import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Foundry } from '../src/foundry.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { digest, FoundryError } from '../src/data.mjs';
import { composeObjectiveCandidate, extractRequirements, OBJECTIVE_TEXTS } from '../src/construction-objective.mjs';

// Exposed regression fixtures for the regex compiler and native runtime.
// Supplied claim/identity values are not independently grounded evidence.
// Failure capabilities below exercise control flow without any network.
const suppliedClaim = { grounded: true };
const branchObjective = OBJECTIVE_TEXTS.ObjHttpBranch;
const mapBranchObjective = 'Fetch each item over HTTP and branch on error';
const compose = text => composeObjectiveCandidate(text).workflow;

async function execute(t, workflow, input, registry = createDefaultRegistry()) {
  // Optional receipts retain passing and failing executions during an audit.
  const evidenceRoot = process.env.FOUNDRY_CONSEQUENCE_RECEIPTS;
  if (evidenceRoot) mkdirSync(evidenceRoot, { recursive: true });
  const workspace = mkdtempSync(path.join(evidenceRoot ?? os.tmpdir(), 'foundry-consequences-'));
  const foundry = new Foundry(workspace, { registry });
  t.after(async () => {
    await foundry.close();
    if (!evidenceRoot) rmSync(workspace, { recursive: true, force: true });
  });
  const receipt = (name, value) => {
    if (evidenceRoot) writeFileSync(path.join(workspace, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  };
  receipt('CASE.json', { test: t.name, input, workflowHash: digest(workflow), registryHash: registry.hash() });
  receipt('CANDIDATE.json', workflow);
  receipt('REGISTRY.json', registry.list());
  foundry.save(workflow);
  const created = foundry.createRun(workflow.id, input);
  const run = foundry.publicRun(await foundry.startRun(created.id));
  const events = foundry.store.events(run.id);
  receipt('RESULT.json', run);
  receipt('TRACE.json', events);
  assert.equal(run.workflowHash, digest(workflow));
  assert.equal(run.registryHash, registry.hash());
  assert.equal(run.independentTaskVerified, false);
  assert.equal(events.length, run.eventHead.seq);
  return { run, events, artifact: path.join(foundry.store.directory, 'artifacts', run.id, 'receipt.json') };
}

function injectFailure(node, message) {
  assert.ok(node, 'Replace an existing task without changing its dependencies or guards');
  node.tool = 'core.fail';
  node.args = { message };
}

test('composed success branch executes and joins the skipped error output as null', async t => {
  const { run, events, artifact } = await execute(t, compose(branchObjective), { claim: suppliedClaim });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.nodes.fetch.status, 'completed');
  assert.equal(run.nodes.okPath.status, 'completed');
  assert.equal(run.nodes.errPath.status, 'skipped');
  assert.deepEqual(run.outputs.join.items, ['ok', null]);
  assert.equal(Object.hasOwn(run.outputs, 'errPath'), false);
  assert.ok(events.some(e => e.type === 'tool.intent' && e.nodeKey === 'root/fetch' && e.tool === 'core.identity'));
  assert.ok(existsSync(artifact));
});

test('an actual failed fetch executes the error branch after its bounded retries', async t => {
  const workflow = compose(branchObjective);
  const fetch = workflow.nodes.find(n => n.id === 'fetch');
  injectFailure(fetch, 'upstream failure witness');
  const { run, events } = await execute(t, workflow, { claim: suppliedClaim });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.nodes.fetch.status, 'handled_error');
  assert.equal(run.nodes.fetch.attempts, fetch.retry.maxAttempts);
  assert.equal(run.outputs.fetch.error.code, 'INJECTED_FAILURE');
  assert.equal(run.nodes.okPath.status, 'skipped');
  assert.equal(run.nodes.errPath.status, 'completed');
  assert.deepEqual(run.outputs.join.items, [null, 'error']);
  assert.equal(events.filter(e => e.type === 'tool.failed' && e.nodeKey === 'root/fetch').length, fetch.retry.maxAttempts);
  assert.ok(events.some(e => e.type === 'node.completed' && e.nodeKey === 'root/errPath'));
});

test('failure in the selected error handler does not produce a success receipt', async t => {
  const workflow = compose(branchObjective);
  injectFailure(workflow.nodes.find(n => n.id === 'fetch'), 'upstream failure witness');
  injectFailure(workflow.nodes.find(n => n.id === 'errPath'), 'handler failure witness');
  const { run, events, artifact } = await execute(t, workflow, { claim: suppliedClaim });
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'INJECTED_FAILURE');
  assert.equal(run.error.message, 'handler failure witness');
  assert.ok(events.some(e => e.type === 'tool.failed' && e.nodeKey === 'root/errPath'));
  assert.equal(Object.hasOwn(run.outputs, 'verify'), false);
  assert.equal(existsSync(artifact), false);
});

test('explicit true passes the local claim gate without independent qualification', async t => {
  const { run, artifact } = await execute(t, compose(OBJECTIVE_TEXTS.ObjResearchCite), { claim: suppliedClaim });
  assert.equal(run.status, 'succeeded');
  assert.equal(run.outputs.validate.valid, true);
  assert.equal(run.outputs.verify.passed, true);
  assert.deepEqual(JSON.parse(readFileSync(artifact, 'utf8')), { status: 'composed' });
});

for (const [label, input] of [
  ['false', { claim: { grounded: false } }],
  ['absent claim', {}],
  ['absent grounded field', { claim: {} }],
  ['string true', { claim: { grounded: 'true' } }],
  ['numeric one', { claim: { grounded: 1 } }],
  ['null grounded field', { claim: { grounded: null } }],
  ['null claim', { claim: null }]
]) {
  test(`claim gate rejects ${label} before writing a receipt`, async t => {
    const { run, artifact } = await execute(t, compose(OBJECTIVE_TEXTS.ObjResearchCite), input);
    assert.equal(run.status, 'failed', JSON.stringify(run.error));
    assert.equal(run.outputs.validate.valid, false);
    assert.equal(run.error.code, 'ASSERTION_FAILED');
    assert.equal(Object.hasOwn(run.outputs, 'verify'), false);
    assert.equal(Object.hasOwn(run.outputs, 'artifact'), false);
    assert.equal(existsSync(artifact), false);
  });
}

test('a skipped verification node cannot satisfy workflow acceptance by fallback', async t => {
  const workflow = compose(OBJECTIVE_TEXTS.ObjResearchCite);
  workflow.nodes.find(n => n.id === 'verify').when = { op: 'eq', left: true, right: false };
  const { run, artifact } = await execute(t, workflow, { claim: suppliedClaim });
  assert.equal(run.nodes.verify.status, 'skipped');
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'ACCEPTANCE_FAILED');
  assert.equal(existsSync(artifact), false);
});

test('each map item selects its own branch and retains its own input and output', async t => {
  const items = [{ id: 'a', ok: true }, { id: 'b', ok: false }, { id: 'c', ok: true }];
  const { run } = await execute(t, compose(mapBranchObjective), { matches: items, claim: suppliedClaim });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.outputs.matches.count, items.length);
  assert.deepEqual(run.outputs.matches.items.map(x => x.fetch), items);
  assert.deepEqual(run.outputs.matches.items.map(x => x.join.items), [['ok', null], [null, 'error'], ['ok', null]]);
  for (let index = 0; index < items.length; index++) {
    const frame = run.frames[`root/matches:${index}`];
    assert.equal(frame.nodes.okPath.status, items[index].ok ? 'completed' : 'skipped');
    assert.equal(frame.nodes.errPath.status, items[index].ok ? 'skipped' : 'completed');
  }
  assert.equal(Object.hasOwn(run.nodes, 'fetch'), false);
});

test('all 32 map items can execute with mixed real fetch failures and scoped recovery', async t => {
  const workflow = compose(mapBranchObjective);
  const map = workflow.nodes.find(n => n.kind === 'map');
  assert.ok(map, 'The conditional must be inside the map body');
  const fetch = map.body.nodes.find(n => n.id === 'fetch');
  assert.ok(fetch);
  const calls = [];
  const registry = createDefaultRegistry().register({
    name: 'diagnostic.item-fetch', version: '1', description: 'Local per-item failure witness; no external fetch',
    effects: 'none', risk: 'low', requiresApproval: false, cost: 0, maxTimeoutMs: 5000,
    inputSchema: { type: 'object', required: ['id', 'fail'], additionalProperties: false, properties: { id: { type: 'string' }, fail: { type: 'boolean' } } },
    outputSchema: { type: 'object', required: ['id', 'ok'], additionalProperties: false, properties: { id: { type: 'string' }, ok: { const: true } } },
    execute: async ({ id, fail }) => {
      calls.push(id);
      if (fail) throw new FoundryError('FETCH_WITNESS_FAILURE', id);
      return { id, ok: true };
    }
  });
  // Change only the capability binding; retain all compiler-emitted item
  // arguments, dependencies, retry bounds, guards, joins and acceptance.
  fetch.tool = 'diagnostic.item-fetch';
  const items = Array.from({ length: 32 }, (_, index) => ({ id: `item-${index}`, fail: index % 2 === 1 }));
  const { run, events } = await execute(t, workflow, { matches: items, claim: suppliedClaim }, registry);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.outputs.matches.count, 32);
  assert.ok(run.steps > 80, 'Exercise the added per-item step budget');
  assert.ok(run.steps <= workflow.budget.maxSteps);
  for (let index = 0; index < items.length; index++) {
    const item = items[index], key = `root/matches:${index}`, frame = run.frames[key];
    assert.equal(calls.filter(id => id === item.id).length, item.fail ? fetch.retry.maxAttempts : 1);
    assert.equal(frame.nodes.fetch.status, item.fail ? 'handled_error' : 'completed');
    assert.equal(frame.nodes.errPath.status, item.fail ? 'completed' : 'skipped');
    assert.equal(frame.nodes.okPath.status, item.fail ? 'skipped' : 'completed');
    assert.deepEqual(frame.outputs.join.items, item.fail ? [null, 'error'] : ['ok', null]);
    assert.deepEqual(run.outputs.matches.items[index], frame.outputs);
    if (item.fail) assert.ok(events.some(e => e.type === 'node.handled_error' && e.nodeKey === `${key}/fetch`));
    else assert.equal(frame.outputs.fetch.id, item.id);
  }
});

test('an empty map is empty and does not run a root-level fetch', async t => {
  const { run, events } = await execute(t, compose(mapBranchObjective), { matches: [], claim: suppliedClaim });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(run.outputs.matches, { count: 0, items: [] });
  assert.equal(events.some(e => e.type === 'tool.intent' && e.nodeKey.endsWith('/fetch')), false);
});

for (const [label, input] of [
  ['missing item array', { claim: suppliedClaim }],
  ['33 items', { matches: Array.from({ length: 33 }, () => ({ ok: true })), claim: suppliedClaim }]
]) {
  test(`map rejects ${label} before producing a receipt`, async t => {
    const { run, artifact } = await execute(t, compose(mapBranchObjective), input);
    assert.equal(run.status, 'failed');
    assert.equal(Object.hasOwn(run.outputs, 'matches'), false);
    assert.equal(existsSync(artifact), false);
  });
}

test('the existing map and loop fixture still executes through the local claim gate', async t => {
  const { run } = await execute(t, compose(OBJECTIVE_TEXTS.ObjGameEval), { matches: ['a', 'b'], claim: suppliedClaim });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.outputs.matches.count, 2);
  assert.deepEqual(run.outputs.matches.items.map(x => x.score), [{ scored: true }, { scored: true }]);
  assert.equal(run.outputs.retryFlaky.iterations, 1);
});

for (const spelling of ['30 days', '30-days', 'thirty days', 'thirty-days']) {
  test(`${spelling} is explicitly named unsupported while the bounded wait only pauses`, async t => {
    const text = `Wait ${spelling} then verify`;
    const workflow = compose(text);
    const extracted = extractRequirements(text);
    const { run, events, artifact } = await execute(t, workflow, { claim: suppliedClaim });
    assert.ok(extracted.requestedBeyondIr.some(r => r.limit === 'delayMsMax' && r.requested === 'days-or-months-scale'));
    assert.ok(workflow.envelope.unsupported.includes('requested:days-or-months-scale;limit:delayMsMax'));
    assert.equal(run.status, 'waiting');
    assert.ok(events.some(e => e.type === 'node.waiting' && e.nodeKey === 'root/pause'));
    assert.equal(Object.hasOwn(run.outputs, 'verify'), false);
    assert.equal(existsSync(artifact), false);
  });
}
