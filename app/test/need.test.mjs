// The need router on the product surface: app/core/need.mjs, the app MCP tool need_check, the propose_flow advice field and the
// engine MCP tool foundry_need_check. $0, no model, loopback only. node --test app/test/need.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FoundryApp } from '../core/service.mjs';
import { serveAppMcp, toolDefinitions } from '../mcp/server.mjs';
import { needAdvice, needToolSpec } from '../core/need.mjs';
import { toolDefinitions as engineTools } from '../../src/mcp.mjs';
import { validateData } from '../../src/validate.mjs';

const MESSY = 'can you send my boss a weekly summary of what the Platform team finished? only to her: boss@example.com';

async function withApp(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'need-app-'));
  const app = new FoundryApp({ workspace: dir });
  try { await fn(app); } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}
async function connect(app, { needJudge = null } = {}) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await serveAppMcp(app, { transport: serverSide, needJudge });
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
  assert.equal(q.needsWorkflow, false); assert.equal(q.mode, 'none'); assert.match(q.say, /^Code-only hint \(no model judged it\): No workflow needed/);
  assert.equal(q.hint, true); assert.match(q.reliability, /Treat it as a hint/);
  assert.equal((await needAdvice({ request: 'What is the capital of Peru?', sensitivity: 1 })).needsWorkflow, true);
  assert.equal((await needAdvice({ request: 'Every Monday at 9, email the CFO the signups.', sensitivity: 0 })).needsWorkflow, false);
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
  assert.match(t.description, /only a HINT/, 'code only: the tool says so'); assert.doesNotMatch(t.description, /tuned so requests that do not need a workflow do not trigger/);
  const r = await call('need_check', { request: 'Fix the typo in the README.' });
  assert.equal(r.isError, false); assert.equal(r.mode, 'none'); assert.equal(r.say, 'Code-only hint (no model judged it): No workflow needed: just do it directly.');
  const bad = await call('need_check', { request: 'x', sensitivity: 7 });
  assert.equal(bad.isError, true);
  const p = await call('propose_flow', { request: MESSY });
  assert.equal(p.status, 'proposed'); assert.equal(typeof p.need.needsWorkflow, 'boolean'); assert.ok(['none', 'checklist', 'workflow', 'recurring'].includes(p.need.mode));
  assert.equal(p.need.basis, 'code'); assert.doesNotMatch(p.say, /Note:/, 'no "no workflow needed" note on the code-only hint (review M3)');
  await client.close();
}));

// A stub judge for the host plug: a fixed answer, counted.
function stubJudge(answer, model = 'claude-haiku-5-5') { const j = Object.assign(async () => { j.calls++; return { ...answer, model, costUsd: 0.0002 }; }, { calls: 0, model }); return j; }

test('app MCP with a host judge: need_check runs the cascade; propose_flow notes "no workflow" only on a judged decision', async () => withApp(async app => {
  const judge = stubJudge({ mode: 'none', p: 0.05 });
  const { client, call } = await connect(app, { needJudge: judge });
  const { tools } = await client.listTools();
  const t = tools.find(x => x.name === 'need_check');
  assert.match(t.description, /a cheap model \(claude-haiku-5-5\) judges the rest/);
  const r = await call('need_check', { request: 'Send the price-increase email to all 3,000 customers today.' });
  assert.equal(r.basis, 'cascade'); assert.equal(r.decidedBy, 'judge:claude-haiku-5-5'); assert.equal(r.hint, false); assert.equal(judge.calls, 1);
  assert.equal(r.probability, 0.05); assert.equal(r.threshold, 0.5);
  const p = await call('propose_flow', { request: MESSY });
  assert.equal(p.status, 'proposed'); assert.equal(p.need.basis, 'cascade');
  assert.match(p.say, /Note: No workflow needed/, 'a judged "none" is relayed');
  await client.close();
}));

test('toolDefinitions: propose_flow keeps its advice when found by name', () => withApp(async app => {
  const defs = toolDefinitions(app);
  assert.deepEqual(defs.map(d => d.name), ['propose_flow', 'explain_flow', 'dry_run', 'ask_person_to_turn_on', 'run_flow', 'flow_status', 'list_flows', 'list_templates', 'need_check', 'list_waiting', 'answer_waiting', 'conditions', 'edit_conditions']);
  const propose = defs.find(d => d.name === 'propose_flow');
  const r = await propose.execute({ request: MESSY });
  assert.equal(r.status, 'proposed'); assert.ok(r.need && typeof r.need.needsWorkflow === 'boolean');
}));

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');
test('CLI need: prints the decision, the decider and its reliability; refuses bad arguments; touches no workspace without --judge', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'need-cli-'));
  rmSync(home, { recursive: true, force: true });
  const env = { ...process.env, FOUNDRY_HOME: home };
  try {
    const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, timeout: 60000 });
    const ok = run('need', 'What is the capital of Peru?');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^NONE {2}decided by code at sensitivity 0\.5: code p=/);
    assert.match(ok.stdout, /Code-only hint/); assert.match(ok.stdout, /Reliability: Code only, sensitivity 0\.5/);
    const always = run('need', 'What is the capital of Peru?', '--sensitivity', '1');
    assert.equal(always.status, 0); assert.match(always.stdout, /^WORKFLOW {2}decided by slider \(1: always\)/);
    assert.equal(run('need').status, 2);
    assert.equal(run('need', 'x', '--sensitivity', '2').status, 2);
    assert.equal(run('need', 'x', '--judge', 'gpt').status, 2);
    assert.equal(existsSync(home), false, 'code only: no workspace was created');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('engine MCP: foundry_need_check is listed read-only and returns the same advice', async () => {
  const tool = engineTools({ registry: { list: () => [], hash: () => 'h' }, store: {} }).find(x => x.name === 'foundry_need_check');
  assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false);
  const r = await tool.execute({ request: 'Whenever a new invoice lands in the AP inbox, match it to the PO, route it for approval and pay it once approved.' });
  assert.equal(r.needsWorkflow, true);
});
