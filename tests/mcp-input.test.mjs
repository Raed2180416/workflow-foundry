import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Foundry } from '../src/foundry.mjs';
import { toolDefinitions, parseRunInputJson } from '../src/mcp.mjs';
import { validateData } from '../src/validate.mjs';

const root = path.resolve(import.meta.dirname, '..');
function workflow(id, inputSchema) {
  return {
    schemaVersion: '1.0', id, version: 1, title: 'Exact MCP input transport',
    goal: 'Preserve and validate the supplied JSON value without coercion.', domain: 'general',
    envelope: { assumptions: ['Local JSON fixture'], risks: ['Object/string or null/default substitution'], successCriteria: ['Echo is deeply equal to input'] },
    inputSchema, budget: { maxSteps: 3, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
    nodes: [{ id: 'echo', kind: 'task', needs: [], description: 'Return the exact supplied JSON.', tool: 'core.identity', args: { $ref: 'input' }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
    acceptance: [{ op: 'eq', left: { $ref: 'nodes.echo' }, right: { $ref: 'input' } }]
  };
}

test('MCP input: object contract is explicit and rejects serialized, missing or scalar inputs before dispatch', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-mcp-schema-'));
  const foundry = new Foundry(dir);
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  const spec = toolDefinitions(foundry).find(x => x.name === 'foundry_run');
  assert.equal(spec.inputSchema.properties.input.type, 'object');
  assert.deepEqual(spec.inputSchema.required, ['workflowId', 'input']);
  for (const args of [{ workflowId: 'Echo' }, ...['{}', 'null', null, false, 0, []].map(input => ({ workflowId: 'Echo', input }))]) {
    assert.throws(() => validateData(spec.inputSchema, args), { code: 'SCHEMA_MISMATCH' });
  }
  validateData(spec.inputSchema, { workflowId: 'Echo', input: { values: [3, 7, 11] } });
  assert.equal(foundry.store.runs().length, 0);
});

test('MCP input: explicitly serialized alternative parses once and retains exact JSON roots', () => {
  for (const value of [null, false, 0, 7, 'hello', [], [1, '2'], { values: [3, 7, 11] }]) {
    assert.deepEqual(parseRunInputJson(JSON.stringify(value)), value);
  }
  assert.equal(parseRunInputJson(JSON.stringify('{"values":[3]}')), '{"values":[3]}', 'Double encoding remains a string, not an object');
  for (const invalid of ['', ' ', '{bad', '{}\n{}', '```json\n{}\n```', 'x'.repeat(524289)]) assert.throws(() => parseRunInputJson(invalid));
  assert.throws(() => parseRunInputJson('{"__proto__":{"admin":true}}'), { code: 'UNSAFE_KEY' });
});

test('MCP input: actual stdio server preserves object/null/array values and rejects incorrect wire arguments', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-mcp-input-'));
  const client = new Client({ name: 'input-wire-audit', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'bin/foundry.mjs'), 'mcp', '--workspace', dir], env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  t.after(async () => { await client.close(); rmSync(dir, { recursive: true, force: true }); });
  await client.connect(transport, { timeout: 5000 });
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
    return { isError: result.isError === true, value: JSON.parse(result.content.find(c => c.type === 'text').text) };
  };
  const catalog = await client.listTools();
  assert.equal(catalog.tools.find(x => x.name === 'foundry_run').inputSchema.properties.input.type, 'object');
  const cases = [
    { id: 'ObjectEcho', schema: { type: 'object', required: ['values'], properties: { values: { type: 'array', items: { type: 'number' } } }, additionalProperties: false }, value: { values: [3, 7, 11] } },
    { id: 'NullEcho', schema: { type: 'null' }, value: null },
    { id: 'ArrayEcho', schema: { type: 'array', items: { type: 'number' } }, value: [2, 5] },
    { id: 'FalseEcho', schema: { type: 'boolean' }, value: false }
  ];
  for (const c of cases) {
    assert.equal((await call('foundry_save', { workflow: workflow(c.id, c.schema) })).isError, false);
    const response = await call('foundry_run_json', { workflowId: c.id, inputJson: JSON.stringify(c.value) });
    assert.equal(response.isError, false, JSON.stringify(response));
    assert.equal(response.value.status, 'succeeded');
    assert.deepEqual(response.value.input, c.value);
    assert.deepEqual(response.value.outputs.echo, c.value);
  }
  const typed = await call('foundry_run', { workflowId: 'ObjectEcho', input: { values: [] } });
  assert.equal(typed.isError, false); assert.deepEqual(typed.value.outputs.echo, { values: [] });
  const before = (await call('foundry_inspect', { runId: typed.value.id })).value;
  for (const args of [{ workflowId: 'ObjectEcho', input: '{"values":[3]}' }, { workflowId: 'ObjectEcho' }, { workflowId: 'ObjectEcho', input: null }]) {
    const rejected = await call('foundry_run', args);
    assert.equal(rejected.isError, true); assert.equal(rejected.value.error.code, 'SCHEMA_MISMATCH');
  }
  for (const inputJson of ['{"values":[1,"2"]}', '"{\\"values\\":[3]}"']) {
    const rejected = await call('foundry_run_json', { workflowId: 'ObjectEcho', inputJson });
    assert.equal(rejected.isError, true); assert.equal(rejected.value.error.code, 'SCHEMA_MISMATCH');
  }
  const after = (await call('foundry_inspect', { runId: typed.value.id })).value;
  assert.deepEqual(after.events, before.events, 'Rejected transport values cannot modify a completed run');
});
