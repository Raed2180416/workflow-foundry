// The MCP surface and the dashboard over one real workspace ($0, no model, loopback only). node --test app/test/mcp-dashboard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { FoundryApp } from '../core/service.mjs';
import { serveAppMcp } from '../mcp/server.mjs';
import { createDashboard, diffVersions } from '../dashboard/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MESSY = 'can you send my boss a weekly summary of what the Platform team finished? only to her: boss@example.com';
const WEEK = { weekOf: '2026-10-19', items: [{ title: 'Ship login fix', status: 'done' }, { title: 'Billing table', status: 'open' }] };

async function connect(app, { elicit = null, dialog = true } = {}) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await serveAppMcp(app, { transport: serverSide, dialog });
  const client = new Client({ name: 'surface-test', version: '1' }, { capabilities: elicit ? { elicitation: { form: {} } } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, elicit);
  await client.connect(clientSide);
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { ...JSON.parse(r.content[0].text), isError: !!r.isError }; };
  return { client, call };
}
async function withWorkspace(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'surface-mcp-'));
  const app = new FoundryApp({ workspace: dir });
  try { await fn(app, dir); } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('tools/list: thirteen typed tools (construction_guide for the free-form front door, need_check for ROUTER-1, list_waiting/answer_waiting for human tasks, conditions/edit_conditions for the tracker); the person-only tools demand a person in Claude Code', async () => withWorkspace(async app => {
  const { client } = await connect(app);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name), ['construction_guide', 'propose_flow', 'explain_flow', 'dry_run', 'ask_person_to_turn_on', 'run_flow', 'flow_status', 'list_flows', 'need_check', 'list_waiting', 'answer_waiting', 'conditions', 'edit_conditions']);
  for (const name of ['ask_person_to_turn_on', 'answer_waiting', 'edit_conditions']) assert.equal(tools.find(t => t.name === name)._meta['anthropic/requiresUserInteraction'], true);
  assert.equal(Object.keys(tools.find(t => t.name === 'answer_waiting').inputSchema.properties).join(), 'taskId', 'the model passes only the task id, never an answer');
  for (const t of tools) { assert.equal(t.inputSchema.type, 'object'); assert.equal(t.inputSchema.additionalProperties, false); }
  await client.close();
}));

test('an agent without a person in the loop can propose and practise, never turn on or run', async () => withWorkspace(async app => {
  const { call, client } = await connect(app);
  const p = await call('propose_flow', { request: MESSY });
  assert.equal(p.status, 'proposed'); assert.match(p.say, /will not/i);
  const d = await call('dry_run', { proposalId: p.proposalId });
  assert.equal(d.passed, true); assert.match(d.say, /Nothing real was sent/);
  const a = await call('ask_person_to_turn_on', { proposalId: p.proposalId });
  assert.equal(a.status, 'awaiting_human'); assert.match(a.how, /cannot decide for them/);
  const r = await call('run_flow', { flowId: p.flowId, input: WEEK });
  assert.equal(r.isError, true); assert.equal(r.problem.code, 'NOT_APPROVED');
  // Arguments are checked against the advertised schema: a stringified object is refused, not coerced.
  const bad = await call('run_flow', { flowId: p.flowId, input: JSON.stringify(WEEK) });
  assert.equal(bad.isError, true);
  // The person approves in their own channel; then the agent can run, and the send still waits for the person.
  app.decideActivation(a.approvalId, true, { channel: 'dashboard' });
  const run = await call('run_flow', { flowId: p.flowId, input: WEEK });
  assert.equal(run.status, 'awaiting_approval'); assert.match(run.say, /must approve/);
  const listed = await call('list_flows');
  assert.equal(listed.waitingForYou, 1);
  await client.close();
}));

test('with a client that shows the person a dialog (elicitation), the person decides there', async () => withWorkspace(async app => {
  const seen = [];
  const { call, client } = await connect(app, { elicit: async request => { seen.push(request.params.message); return { action: 'accept', content: { decision: 'approve' } }; } });
  const p = await call('propose_flow', { request: MESSY });
  await call('dry_run', { proposalId: p.proposalId });
  const a = await call('ask_person_to_turn_on', { proposalId: p.proposalId });
  assert.equal(a.status, 'approved'); assert.equal(a.channel, 'mcp-elicitation');
  assert.match(seen[0], /Turn on/); assert.match(seen[0], /makes and sends nothing/); assert.equal(/the delivered of|equals true/.test(seen[0]), false, 'no machine text in the dialog (P1 walkthrough M6)');
  const run = await call('run_flow', { flowId: p.flowId, input: WEEK });
  assert.equal(run.status, 'awaiting_approval');
  // A declined dialog turns nothing on and opens no browser (P1 walkthrough M5). It comes from the client and may be automatic (Codex
  // rejects dialogs it is not set to allow; a hook can decline), so it is not recorded as the person's no: the request stays waiting for
  // them in the page, and the decision log says the client declined (honesty review M2).
  const p2 = await call('propose_flow', { request: MESSY.replace('boss@example.com', 'cto@example.com'), flowId: p.flowId });
  assert.equal((await call('dry_run', { proposalId: p2.proposalId })).passed, true, 'a version-2 draft is practised as itself');
  await client.close();
  const logged = [];
  app.onDecision = entry => logged.push(entry);
  const { call: call2, client: client2 } = await connect(app, { elicit: async () => ({ action: 'decline' }) });
  const a2 = await call2('ask_person_to_turn_on', { proposalId: p2.proposalId });
  assert.equal(a2.status, 'declined_by_client', JSON.stringify(a2)); assert.match(a2.say, /may have been automatic/); assert.doesNotMatch(a2.say, /said no/);
  assert.equal(app.ledger.forFlow(p2.flowId).find(x => x.proposalId === p2.proposalId)?.status, 'pending', 'not recorded as the person\'s no');
  assert.deepEqual(logged.map(e => [e.kind, e.by]), [['dialog-declined', 'the coding agent\'s client']]);
  delete app.onDecision;
  await client2.close();
  // A local hook could answer the dialog for the person (SPEC K12): with dialog off, nothing is shown to the client and the person decides elsewhere.
  let asked = 0;
  const { call: call3, client: client3 } = await connect(app, { dialog: false, elicit: async () => { asked += 1; return { action: 'accept', content: { decision: 'approve' } }; } });
  const p3 = await call3('propose_flow', { request: MESSY.replace('boss@example.com', 'ceo@example.com'), flowId: p.flowId });
  await call3('dry_run', { proposalId: p3.proposalId });
  const a3 = await call3('ask_person_to_turn_on', { proposalId: p3.proposalId });
  assert.equal(a3.status, 'awaiting_human'); assert.equal(asked, 0, 'no dialog a hook could answer');
  await client3.close();
}));

test('dashboard: token and host checks, overview, verified run record, version diff, the person decides', async () => withWorkspace(async app => {
  const p = await app.propose({ request: MESSY });
  await app.dryRun({ proposalId: p.proposalId });
  const pending = app.requestApproval({ proposalId: p.proposalId });
  const dash = createDashboard(app);
  const { port, url } = await dash.listen(0);
  const base = `http://127.0.0.1:${port}`, headers = { 'x-foundry-token': dash.token };
  try {
    assert.equal(url, `${base}/`, 'the address it prints lets nobody in');
    assert.match(dash.openUrl(), /^http:\/\/127\.0\.0\.1:\d+\/#\/\?c=[A-Za-z0-9_-]{43}$/, 'a one-time code travels in the fragment, never a key');
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(/boss@example|Platform/.test(await page.text()), false, 'the static page holds no workspace data');
    assert.equal((await fetch(`${base}/api/overview`)).status, 401);
    // fetch() cannot set Host; a raw request can, as a DNS-rebinding page would.
    const rebound = await new Promise((resolve, reject) => request({ host: '127.0.0.1', port, path: '/api/overview', headers: { ...headers, host: `evil.example:${port}` } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end());
    assert.equal(rebound, 421);
    let o = await (await fetch(`${base}/api/overview`, { headers })).json();
    assert.equal(o.inbox.activations.length, 1); assert.equal(o.inbox.activations[0].approvalId, pending.approvalId);
    const decide = body => fetch(`${base}/api/decide`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    assert.equal((await decide({ kind: 'activation', approvalId: pending.approvalId, decision: 'approve' })).status, 'approved');
    const run = await app.run({ flowId: p.flowId, input: WEEK });
    o = await (await fetch(`${base}/api/overview`, { headers })).json();
    assert.equal(o.inbox.actions.length, 1); assert.equal(o.runs[0].chainVerified, true);
    const after = await decide({ kind: 'action', runId: run.runId, approvalId: o.inbox.actions[0].approvalId, decision: 'approve' });
    assert.equal(after.status, 'succeeded');
    const detail = await (await fetch(`${base}/api/runs/${run.runId}`, { headers })).json();
    assert.equal(detail.chain.verified, true); assert.ok(detail.timeline.length > 10);
    assert.deepEqual(detail.checks.map(c => c.passed), [true, true, true, true, true]);
    assert.equal(detail.modelCalls.count, 0, 'no model was called');
    const v2 = await app.propose({ request: MESSY.replace('boss@example.com', 'cto@example.com'), flowId: p.flowId });
    const flow = await (await fetch(`${base}/api/flows/${p.flowId}`, { headers })).json();
    assert.deepEqual(flow.versions.map(v => [v.version, v.state, v.active]), [[1, 'version', true], [2, 'draft', false]]);
    assert.deepEqual(flow.versions[1].diffFromPrevious.changed.map(c => [c.id, c.fields.sort().join(',')]), [['send', 'args,description']]);
    assert.ok(v2.proposalId);
  } finally { await dash.close(); }
}));

test('diffVersions names added, removed and changed steps and a changed definition of done', () => {
  const a = { nodes: [{ id: 'x', description: 'X', kind: 'task' }, { id: 'y', description: 'Y', kind: 'task' }], acceptance: [{ op: 'exists', value: 1 }], budget: {} };
  const b = { nodes: [{ id: 'x', description: 'X2', kind: 'task' }, { id: 'z', description: 'Z', kind: 'task' }], acceptance: [{ op: 'exists', value: 2 }], budget: {} };
  const d = diffVersions(a, b);
  assert.deepEqual([d.added.map(x => x.id), d.removed.map(x => x.id), d.changed.map(x => x.id), d.checksChanged], [['z'], ['y'], ['x'], true]);
});

test('stdio: the real CLI entry serves MCP with a clean stdout', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'surface-stdio-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'cli.mjs'), 'mcp', '--workspace', dir], env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-test', version: '1' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 13);
    const r = await client.callTool({ name: 'propose_flow', arguments: { request: 'what is the weather' } });
    assert.equal(JSON.parse(r.content[0].text).status, 'unsupported');
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the dashboard page renders workspace text only as text', () => {
  const js = readFileSync(path.join(here, '..', 'dashboard', 'dashboard.js'), 'utf8');
  assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(js), false);
});
