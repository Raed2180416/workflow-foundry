// The condition tracker end to end in the app, with a scripted model ($0, no network): the person's words become conditions, each
// bound to a template check by pointing into the vocabulary, checked on practice data; edits are version-bound proposals only a person
// decides; a waiver needs a person and a reason and lapses with a new flow version. MCP and dashboard faces included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Journal } from '../../../src/journal.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelBuilder, SELECT_SYSTEM, FILL_SYSTEM } from '../../core/builder-model.mjs';
import { CAPTURE_SYSTEM, BIND_SYSTEM } from '../../core/tracker/model.mjs';
import { FoundryApp } from '../../core/service.mjs';
import { toolDefinitions } from '../../mcp/server.mjs';
import { createDashboard } from '../../dashboard/server.mjs';

const REQUEST = 'weekly report for the Platform team to boss@example.com every friday. list whats done and whats blocked';
const nul = { values: null, source: null, column: null, filterPath: null, filterOp: null, filterValue: null, itemPath: null };
const cond = (path, op, value, extra = {}) => ({ path, op, value, ...nul, ...extra });
const entry = (id, o) => ({ id, decision: 'check', why: null, question: null, template: null, channel: null, where: [], source: null, filter: [], linkItem: null, linkEffect: null, linkOp: null,
  require: [], countOp: null, n: null, windowAnchor: null, windowMin: null, windowMax: null, forbidChannel: null, forbidWhere: [], thenChannel: null, thenWhere: [], linkThen: null, ...o });

function scriptedPort({ listBlocked = false } = {}) {
  const calls = [];
  const provider = new ScriptedProvider(args => {
    calls.push(args.system);
    const usage = { inputTokens: 1000, outputTokens: 100 };
    if (args.system === SELECT_SYSTEM) return { value: { template: 'weekly-report', reason: 'test', notCovered: [] }, usage, costUsd: 0.001 };
    if (args.system === FILL_SYSTEM) return { value: { slots: { team: 'Platform', recipient: 'boss@example.com', listOpen: false, listBlocked }, notStated: [], questions: [], assumptions: [] }, usage, costUsd: 0.001 };
    if (args.system === CAPTURE_SYSTEM) return { value: { conditions: [
      { quote: 'to boss@example.com', summary: 'The report goes to boss@example.com', kind: 'must', checkable: true, why: null },
      { quote: 'every friday', summary: 'It runs every Friday', kind: 'schedule', checkable: false, why: 'one run cannot show a schedule' },
      { quote: 'list whats done and whats blocked', summary: 'The report lists every done and every blocked item', kind: 'must', checkable: true, why: null },
      { quote: 'a sentence the person never wrote', summary: 'invented', kind: 'must', checkable: true, why: null }] }, usage, costUsd: 0.001 };
    if (args.system === BIND_SYSTEM) {
      const ids = [...args.prompt.matchAll(/^- (C-\d+): /gm)].map(m => m[1]);
      const by = { 'The report goes': entry(null, { template: 'present', channel: 'email', where: [cond('to', 'eq', 'boss@example.com')] }),
        'The report lists': entry(null, { template: 'count', channel: 'email', where: [cond('to', 'eq', 'boss@example.com')], source: 'tracker', filter: [cond('status', 'in', null, { values: ['done', 'blocked'] })],
          linkItem: 'title', linkEffect: 'body', linkOp: 'mentions', countOp: 'atLeast', n: 1 }),
        'Invented': entry(null, { template: 'present', channel: 'slack', where: [] }) };
      const checks = ids.map(id => {
        const line = args.prompt.split('\n').find(l => l.startsWith(`- ${id}: `)) ?? '';
        const key = Object.keys(by).find(k => line.includes(k));
        return key ? { ...by[key], id } : entry(id, { decision: 'inspection', why: 'no listed field records this' });
      });
      return { value: { checks }, usage, costUsd: 0.002 };
    }
    throw new Error(`unexpected system prompt: ${args.system.slice(0, 40)}`);
  });
  return { port: new ModelPort({ policy: loadPolicy().policy, providers: { 'claude-cli': provider }, journal: new Journal(new DatabaseSync(':memory:')) }), calls };
}

async function withApp(fn, opts) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tracker-app-'));
  const { port, calls } = scriptedPort(opts);
  const app = new FoundryApp({ workspace: dir, builder: new ModelBuilder({ port }), trackerPort: port });
  try { await fn(app, calls); } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('words -> conditions -> checks -> statuses on practice data; a defect the practice run passes is caught', async () => withApp(async (app, calls) => {
  const p = await app.propose({ request: REQUEST });
  assert.equal(p.status, 'proposed');
  assert.deepEqual([p.conditions.count, p.conditions.unconfirmed], [3, 3], 'the invented quote is dropped; the other three are logged, unconfirmed');
  const before = app.conditions({ proposalId: p.proposalId });
  assert.deepEqual(before.conditions.map(c => [c.quote, c.status, c.reason]),
    [['to boss@example.com', 'unknown', 'not-run'], ['every friday', 'unknown', 'unverifiable'], ['list whats done and whats blocked', 'unknown', 'not-run']]);
  assert.match(before.conditions[2].check, /Each tracker item where status is “done” or “blocked” gets at least 1 email/);
  const dry = await app.dryRun({ proposalId: p.proposalId });
  assert.equal(dry.passed, true, 'the flow passes its own practice checks');
  const r = await app.checkConditions({ proposalId: p.proposalId });
  const by = Object.fromEntries(r.conditions.map(c => [c.quote, c]));
  assert.equal(by['to boss@example.com'].status, 'met');
  assert.equal(by['list whats done and whats blocked'].status, 'unmet', 'the blocked item is not in the report: the person said to list it');
  assert.match(by['list whats done and whats blocked'].evidence[0].why, /0 email effect\(s\) name it; want atLeast 1/);
  assert.deepEqual([r.tally.met, r.tally.unmet, r.tally.unknown], [1, 1, 1]);
  assert.deepEqual(calls.filter(s => s === CAPTURE_SYSTEM || s === BIND_SYSTEM).length, 2, 'one capture call, one bind call');
}));

test('the same words over a build that lists blocked items: met', async () => withApp(async app => {
  const p = await app.propose({ request: REQUEST });
  const r = await app.checkConditions({ proposalId: p.proposalId });
  assert.deepEqual(r.conditions.map(c => c.status), ['met', 'unknown', 'met']);
}, { listBlocked: true }));

test('edits are version-bound proposals; only a person decides; a waiver needs a reason and lapses with a new version', async () => withApp(async app => {
  const p = await app.propose({ request: REQUEST });
  const flowId = p.flowId;
  await assert.rejects(app.proposeConditionEdit({ flowId, changes: [{ op: 'add', quote: 'and also cc the CEO' }] }), /not in the person's words/, 'a model cannot invent words');
  const e = await app.proposeConditionEdit({ flowId, changes: [{ op: 'remove', conditionId: 'C-002' }] });
  assert.equal(e.status, 'proposed');
  await assert.rejects(app.decideCondition({ flowId, action: 'accept', proposalId: e.proposal.id, channel: 'mcp' }), /Only a person/);
  const ok = await app.decideCondition({ flowId, action: 'accept', proposalId: e.proposal.id, channel: 'dashboard' });
  assert.equal(ok.proposal.status, 'accepted');
  assert.deepEqual(app.conditions({ flowId }).conditions.map(c => c.id), ['C-001', 'C-003']);
  const stale = await app.proposeConditionEdit({ flowId, changes: [{ op: 'change', conditionId: 'C-001', summary: 'only to my boss' }] });
  await app.proposeConditionEdit({ flowId, changes: [{ op: 'change', conditionId: 'C-001', summary: 'to boss@example.com' }], by: 'person', channel: 'dashboard' });
  await assert.rejects(app.decideCondition({ flowId, action: 'accept', proposalId: stale.proposal.id, channel: 'dashboard' }), /changed since this edit was proposed/, 'compare-and-swap on the condition version');
  const added = await app.proposeConditionEdit({ flowId, changes: [{ op: 'add', quote: 'never email anyone outside the company' }], by: 'person', channel: 'cli' });
  assert.equal(added.status, 'accepted', 'a person may add new words');
  assert.equal(app.conditions({ flowId }).words.at(-1).kind, 'edit');
  const checked = await app.checkConditions({ proposalId: p.proposalId });
  const c3 = checked.conditions.find(c => c.id === 'C-003');
  assert.equal(c3.status, 'unmet');
  await assert.rejects(app.decideCondition({ flowId, action: 'waive', conditionId: 'C-003', why: '', channel: 'dashboard' }), /Say why/);
  await assert.rejects(app.decideCondition({ flowId, action: 'waive', conditionId: 'C-003', why: 'fine for now', channel: 'mcp' }), /Only a person/);
  await app.decideCondition({ flowId, action: 'waive', conditionId: 'C-003', why: 'blocked items go in the standup instead', channel: 'dashboard', workflowHash: p.workflowHash });
  assert.equal(app.conditions({ proposalId: p.proposalId }).conditions.find(c => c.id === 'C-003').status, 'waived');
  assert.equal(app.tracker.view({ flowId, workflowHash: 'another-version' }).conditions.find(c => c.id === 'C-003').status, 'unknown', 'a waiver covers one exact version');
  await app.decideCondition({ flowId, action: 'confirm', conditionId: 'C-001', channel: 'dashboard' });
  assert.equal(app.conditions({ flowId }).conditions.find(c => c.id === 'C-001').confirmed, true);
}));

test('MCP: conditions reads and checks; edit_conditions only proposes; there is no tool to waive or confirm', async () => withApp(async app => {
  const tools = Object.fromEntries(toolDefinitions(app).map(t => [t.name, t]));
  assert.ok(!Object.keys(tools).some(n => /waive|confirm|decide/.test(n)));
  const p = await app.propose({ request: REQUEST });
  const read = await tools.conditions.execute({ flowId: p.flowId });
  assert.equal(read.conditions.length, 3);
  const checked = await tools.conditions.execute({ proposalId: p.proposalId, check: true });
  assert.equal(checked.tally.unmet, 1);
  const e = await tools.edit_conditions.execute({ flowId: p.flowId, changes: [{ op: 'remove', conditionId: 'C-001' }] }, {});
  assert.equal(e.status, 'proposed'); assert.match(e.how, /decide in the page|dashboard/);
  assert.equal(app.conditions({ flowId: p.flowId }).pending.length, 1);
}));

test('MCP edit_conditions: the client dialog is used only when the host vouches for it (H3), exactly as for ask_person_to_turn_on', async () => withApp(async app => {
  const p = await app.propose({ request: REQUEST });
  let asked = 0;
  // A client that offers elicitation and would accept every change: without the host's vouching it must never be asked.
  const server = { getClientCapabilities: () => ({ elicitation: { form: {} } }), elicitInput: async () => { asked++; return { action: 'accept', content: { decision: 'accept' } }; } };
  for (const dialog of [false, () => ({ ok: false }), () => { throw new Error('check failed'); }]) {
    const tools = Object.fromEntries(toolDefinitions(app, { dialog }).map(t => [t.name, t]));
    const e = await tools.edit_conditions.execute({ flowId: p.flowId, changes: [{ op: 'remove', conditionId: 'C-001' }] }, { server });
    assert.equal(e.status, 'proposed'); assert.equal(asked, 0, 'no dialog without the H3 check');
  }
  assert.equal(app.conditions({ flowId: p.flowId }).pending.length, 3, 'each model edit waits for the person');
  const vouched = Object.fromEntries(toolDefinitions(app, { dialog: () => ({ ok: true }) }).map(t => [t.name, t]));
  const d = await vouched.edit_conditions.execute({ flowId: p.flowId, changes: [{ op: 'change', conditionId: 'C-002', summary: 'a shorter summary' }] }, { server });
  assert.equal(asked, 1); assert.equal(d.status, 'accepted');
  assert.equal(toolDefinitions(app).find(t => t.name === 'edit_conditions')._meta['anthropic/requiresUserInteraction'], true);
}));

test('dashboard: the person reads, confirms and waives; a request without the page token is refused', async () => withApp(async app => {
  const p = await app.propose({ request: REQUEST });
  const dash = createDashboard(app);
  const { port } = await dash.listen(0);
  const call = (pathname, body, token = dash.token) => fetch(`http://127.0.0.1:${port}${pathname}`, { method: body ? 'POST' : 'GET',
    headers: { 'x-foundry-token': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    assert.equal((await call(`/api/conditions/${p.flowId}`, null, 'wrong')).status, 401);
    const got = await (await call(`/api/conditions/${p.flowId}`)).json();
    assert.equal(got.conditions.length, 3);
    const c = await (await call('/api/conditions', { action: 'confirm', flowId: p.flowId, conditionId: 'C-001' })).json();
    assert.equal(c.condition.confirmed, true);
    const checked = await (await call('/api/conditions', { action: 'check', flowId: p.flowId })).json();
    assert.equal(checked.tally.unmet, 1);
    const w = await (await call('/api/conditions', { action: 'waive', flowId: p.flowId, conditionId: 'C-003', why: 'not this week' })).json();
    assert.equal(w.waiver.channel, 'dashboard');
  } finally { await dash.close(); }
}));

test('live runs: after a real run the same checks read what THAT run did; a condition practice data never reached can turn unmet live', async () => withApp(async app => {
  const p = await app.propose({ request: REQUEST });
  assert.equal((await app.dryRun({ proposalId: p.proposalId })).passed, true);
  const a = app.requestApproval({ proposalId: p.proposalId });
  assert.equal(app.decideActivation(a.approvalId, true, { channel: 'dashboard' }).status, 'approved');
  // The person's real tracker export: one blocked item, which this build (listBlocked false) leaves out of the report.
  mkdirSync(path.join(app.worldDir, 'sheets'), { recursive: true });
  writeFileSync(path.join(app.worldDir, 'sheets', 'tracker.json'), JSON.stringify([{ title: 'Ship the billing export', status: 'done', owner: 'Ana' },
    { title: 'Rotate the API keys', status: 'done', owner: 'Bo' }, { title: 'Vendor SSO contract', status: 'blocked', owner: 'Cy' }, { title: 'Write the runbook', status: 'open', owner: 'Di' }]));
  let r = await app.run({ flowId: p.flowId, input: { weekOf: '2026-10-19', items: [] } });
  if (!r.ok) r = await app.run({ flowId: p.flowId, input: { now: '2026-10-23T17:00:00Z' } });
  while (r.status === 'awaiting_approval') r = await app.decideAction(r.runId, r.pendingApprovals[0].approvalId, true, { channel: 'dashboard' });
  assert.equal(r.status, 'succeeded');
  assert.ok(r.conditions?.tally, 'the finished run carries its live check');
  const live = await app.checkRun({ runId: r.runId });
  const by = Object.fromEntries(live.conditions.map(c => [c.quote, c]));
  assert.equal(live.live, true);
  assert.equal(by['to boss@example.com'].status, 'met');
  assert.equal(by['list whats done and whats blocked'].status, 'unmet', 'the blocked item of the live data is missing from the live report');
  assert.match(by['list whats done and whats blocked'].evidence[0].why, /0 email effect\(s\) name it/);
  assert.equal(by['every friday'].status, 'unknown');
  // What the person sees: the practice status beside the last live one.
  const seen = app.conditions({ flowId: p.flowId }).conditions.find(c => c.quote === 'list whats done and whats blocked');
  assert.equal(seen.lastLive.status, 'unmet'); assert.equal(seen.lastLive.runId, r.runId);
  // MCP reads the same through the conditions tool with a runId.
  const tools = Object.fromEntries(toolDefinitions(app).map(t => [t.name, t]));
  assert.equal((await tools.conditions.execute({ runId: r.runId })).tally.unmet, 1);
  // A run that has not ended is not checked.
  const pending = await app.checkRun({ runId: r.runId }).then(() => null);
  assert.equal(pending, null);
}));

test('a run resumed by a person through the human-task path (answer_waiting, the live page) also carries its live condition check', async () => withApp(async app => {
  const { decideApproval } = await import('../../core/human-tasks.mjs');
  const p = await app.propose({ request: REQUEST });
  assert.equal((await app.dryRun({ proposalId: p.proposalId })).passed, true);
  const a = app.requestApproval({ proposalId: p.proposalId });
  assert.equal(app.decideActivation(a.approvalId, true, { channel: 'dashboard' }).status, 'approved');
  mkdirSync(path.join(app.worldDir, 'sheets'), { recursive: true });
  writeFileSync(path.join(app.worldDir, 'sheets', 'tracker.json'), JSON.stringify([{ title: 'Ship the billing export', status: 'done', owner: 'Ana' }, { title: 'Vendor SSO contract', status: 'blocked', owner: 'Cy' }]));
  let r = await app.run({ flowId: p.flowId, input: { weekOf: '2026-10-19', items: [] } });
  if (!r.ok) r = await app.run({ flowId: p.flowId, input: { now: '2026-10-23T17:00:00Z' } });
  let d = null;
  while (r.status === 'awaiting_approval') {
    d = await decideApproval(app, { runId: r.runId, approvalId: r.pendingApprovals[0].approvalId, approved: true, channel: 'dashboard', waitMs: Infinity });
    r = d.run;
  }
  assert.ok(d, 'the run paused for the person at least once');
  assert.equal(r.status, 'succeeded');
  assert.equal(r.conditions?.tally?.unmet, 1, 'the resumed run reports the condition it broke');
}));
