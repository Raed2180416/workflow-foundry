// The need router on the product surface: app/core/need.mjs, the app MCP tool need_check, the propose_flow advice field and the
// engine MCP tool foundry_need_check. $0, no model, loopback only. node --test app/test/need.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FoundryApp } from '../core/service.mjs';
import { serveAppMcp } from '../mcp/server.mjs';
import { needAdvice, needToolSpec } from '../core/need.mjs';
import { toolDefinitions as engineTools } from '../../src/mcp.mjs';
import { validateData } from '../../src/validate.mjs';

const MESSY = 'can you send my boss a weekly summary of what the Platform team finished? only to her: boss@example.com';

async function withApp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'need-app-'));
  const app = new FoundryApp({ workspace: dir });
  try { await fn(app); } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}
async function connect(app) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await serveAppMcp(app, { transport: serverSide });
  const client = new Client({ name: 'need-test', version: '1' }, { capabilities: {} });
  await client.connect(clientSide);
  return { client, call: async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { ...JSON.parse(r.content[0].text), isError: !!r.isError }; } };
}

test('needAdvice: plain-words reply, reasons, slider', async () => {
  const a = await needAdvice({ request: 'Every Monday at 9, pull last week\'s signups from Stripe, post the count to #growth and email the CFO.' });
  assert.equal(a.ok, true); assert.equal(a.needsWorkflow, true); assert.equal(a.mode, 'recurring');
  assert.match(a.say, /recurring workflow/); assert.ok(a.reasons.some(r => r.signal === 'recurrence'));
  assert.equal(a.router.costUsd, 0);
  const q = await needAdvice({ request: 'What is the capital of Peru?' });
  assert.equal(q.needsWorkflow, false); assert.equal(q.mode, 'none'); assert.match(q.say, /No workflow needed/);
  assert.equal((await needAdvice({ request: 'What is the capital of Peru?', sensitivity: 1 })).needsWorkflow, true);
});

test('tool spec: arguments are validated against the advertised schema', () => {
  const spec = needToolSpec();
  assert.doesNotThrow(() => validateData(spec.inputSchema, { request: 'x', sensitivity: 0.3, context: { recurrence: 'weekly', systems: ['slack'] } }, 'args'));
  assert.throws(() => validateData(spec.inputSchema, { request: 'x', sensitivity: 2 }, 'args'));
  assert.throws(() => validateData(spec.inputSchema, { request: 'x', extra: 1 }, 'args'));
  assert.throws(() => validateData(spec.inputSchema, { sensitivity: 0.5 }, 'args'));
});

test('app MCP: need_check is read-only and answers; propose_flow carries the advice', async () => withApp(async app => {
  const { client, call } = await connect(app);
  const { tools } = await client.listTools();
  const t = tools.find(x => x.name === 'need_check');
  assert.ok(t); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.inputSchema.additionalProperties, false);
  const r = await call('need_check', { request: 'Fix the typo in the README.' });
  assert.equal(r.isError, false); assert.equal(r.mode, 'none'); assert.equal(r.say, 'No workflow needed: just do it directly.');
  const bad = await call('need_check', { request: 'x', sensitivity: 7 });
  assert.equal(bad.isError, true);
  const p = await call('propose_flow', { request: MESSY });
  assert.equal(p.status, 'proposed'); assert.equal(typeof p.need.needsWorkflow, 'boolean'); assert.ok(['none', 'checklist', 'workflow', 'recurring'].includes(p.need.mode));
  await client.close();
}));

test('engine MCP: foundry_need_check is listed read-only and returns the same advice', async () => {
  const tool = engineTools({ registry: { list: () => [], hash: () => 'h' }, store: {} }).find(x => x.name === 'foundry_need_check');
  assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false);
  const r = await tool.execute({ request: 'Whenever a new invoice lands in the AP inbox, match it to the PO, route it for approval and pay it once approved.' });
  assert.equal(r.needsWorkflow, true);
});
