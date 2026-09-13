import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectTransportCatalog, inspectModelChain, inventory, originalTask, taskPermissionAliases } from '../evals/mcp-typed-tui.mjs';

// Evaluator adversarial fixtures; never actual model construction evidence.
const tool = (name, input, value) => ({ type: 'tool', tool: name === 'skill' ? name : 'workflow-foundry_' + name, state: { status: 'completed', input, output: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] }) } });
function fixture(route = 'object') {
  const workflow = { id: 'NumericRollup', version: 1, nodes: [] };
  const locator = { requestId: 'request', proposalId: 'proposal', workflowId: workflow.id, runId: 'run' };
  const proposal = { id: 'proposal', requestId: 'request', status: 'applied', workflow, workflowHash: 'hash' };
  const parts = [
    tool('skill', { name: 'workflow-foundry' }, {}),
    tool('foundry_design_context', { requestId: 'request' }, { requestId: 'request', contextHash: 'context' }),
    tool('foundry_validate', { workflow }, { valid: true }),
    tool('foundry_propose', { requestId: 'request', workflow }, { id: 'proposal' }),
    tool('foundry_apply_proposal', { proposalId: 'proposal' }, { status: 'applied' }),
    tool(route === 'object' ? 'foundry_run' : 'foundry_run_json', { workflowId: workflow.id, ...(route === 'object' ? { input: { values: [3, 7, 11] } } : { inputJson: '{"values":[3,7,11]}' }) }, { id: 'run', status: 'succeeded', workflowHash: 'hash' }),
    tool('foundry_inspect', { runId: 'run' }, { id: 'run', workflowHash: 'hash', events: [] }),
  ];
  return { manifest: { requestId: 'request' }, session: { messages: [{ parts }] }, state: { requests: [{ id: 'request', status: 'applied' }], proposals: [proposal], runs: [{ id: 'run', workflowId: workflow.id, status: 'succeeded' }] }, locator };
}
test('typed campaign chain distinguishes exact object and explicit JSON-text routes', () => {
  for (const route of ['object', 'text']) {
    const result = inspectModelChain(fixture(route));
    assert.equal(result.passed, true);
    assert.equal(result.transport, route === 'object' ? 'object' : 'explicit-json-text');
  }
});
test('successful unrelated tool responses cannot qualify the model chain', () => {
  for (const corrupt of [
    value => { value.locator.runId = 'unrelated'; },
    value => { value.session.messages[0].parts[2].state.input = { workflow: { id: 'other' } }; },
    value => { value.session.messages[0].parts[4].state.input.proposalId = 'other'; },
    value => { value.session.messages[0].parts[5].state.input.input = '{"values":[3,7,11]}'; },
    value => { value.session.messages[0].parts[5].state.input.input.values = [2, 5]; },
    value => { value.session.messages[0].parts[6].state.input.runId = 'other'; },
    value => { value.state.proposals[0].workflow = { id: 'forged' }; },
    value => { value.state.requests[0].status = 'pending'; },
    value => { value.session.messages[0].parts.shift(); },
    value => { delete value.locator; },
  ]) {
    const value = fixture(); corrupt(value);
    assert.equal(inspectModelChain(value).passed, false);
  }
});
test('explicit text path rejects double-encoded sample despite success prose', () => {
  const value = fixture('text');
  value.session.messages[0].parts[5].state.input.inputJson = JSON.stringify('{"values":[3,7,11]}');
  assert.equal(inspectModelChain(value).passed, false);
});
test('incomplete locator still reports successful partial calls without whole-path success', () => {
  const value = fixture(); delete value.locator;
  const result = inspectModelChain(value);
  assert.equal(result.passed, false);
  assert.equal(result.partial.foundry_propose, 1);
  assert.equal(result.partial.foundry_apply_proposal, 1);
});
test('transport catalog gate rejects unconstrained input, optional input and authority tools', () => {
  const tools = [
    { name: 'foundry_run', inputSchema: { properties: { input: { type: 'object' } }, required: ['workflowId', 'input'] } },
    { name: 'foundry_run_json', inputSchema: { properties: { inputJson: { type: 'string' } }, required: ['workflowId', 'inputJson'] } },
  ];
  assert.equal(inspectTransportCatalog({ tools }).passed, true);
  for (const mutate of [
    value => { value[0].inputSchema.properties.input = {}; },
    value => { value[0].inputSchema.required = ['workflowId']; },
    value => { value.push({ name: 'foundry_approve' }); },
    value => { value.push({ name: 'foundry_shell' }); },
  ]) {
    const value = structuredClone(tools); mutate(value);
    assert.equal(inspectTransportCatalog({ tools: value }).passed, false);
  }
});
test('frozen inventory detects dependency byte changes and rejects external symlinks', t => {
  const base = mkdtempSync(path.join(tmpdir(), 'foundry-typed-evaluator-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(path.join(base, 'node_modules'));
  writeFileSync(path.join(base, 'node_modules/pkg.js'), 'original');
  const before = inventory(base);
  writeFileSync(path.join(base, 'node_modules/pkg.js'), 'changed');
  assert.notDeepEqual(inventory(base), before);
  symlinkSync('pkg.js', path.join(base, 'node_modules/internal'));
  assert.equal(inventory(base)['node_modules/internal'].target, 'pkg.js');
  symlinkSync('/etc/passwd', path.join(base, 'node_modules/external'));
  assert.throws(() => inventory(base), /External snapshot symlink/);
});
test('original task retains numeric validation, actual artifact and execution budget constraints', () => {
  assert.match(originalTask, /at most 100 actual numbers/);
  assert.match(originalTask, /Missing, non-array or nonnumeric values must fail/);
  assert.match(originalTask, /actual UTF-8 JSON artifact named totals.json/);
  assert.match(originalTask, /at most 12 steps/);
});
test('global-worktree aliases preserve narrow read/write boundaries and original rules', () => {
  const permission = { '*': 'deny', read: { '*': 'deny', '/task/output.json': 'allow' }, edit: { '*': 'deny', '/task/output.json': 'allow' }, skill: { '*': 'deny', 'workflow-foundry': 'allow' } };
  const result = taskPermissionAliases(permission);
  assert.equal(result.edit['task/output.json'], 'allow');
  assert.equal(result.read['task/output.json'], 'allow');
  assert.equal(result.edit['*'], 'deny');
  assert.equal(result.read['*'], 'deny');
  assert.deepEqual(Object.keys(result.edit).sort(), ['*', '/task/output.json', 'task/output.json']);
  assert.deepEqual(result.skill, permission.skill);
  assert.equal(permission.edit['task/output.json'], undefined);
});
