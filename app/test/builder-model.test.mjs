// The model builder over the template library, with a scripted ModelPort ($0, no network). node --test app/test/builder-model.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Journal } from '../../src/journal.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelBuilder, createBuilderPort, SELECT_SYSTEM, FILL_SYSTEM } from '../core/builder-model.mjs';
import { loadLibrary, practiceOf } from '../core/library.mjs';
import { FoundryApp } from '../core/service.mjs';
import { serveAppMcp } from '../mcp/server.mjs';

const library = loadLibrary();
// A scripted model: `select` answers the template, `fills` answers each fill call in turn (a function of the prompt, or a value).
function scripted({ select, fills }) {
  const seen = [];
  let n = 0;
  const provider = new ScriptedProvider(args => {
    seen.push({ system: args.system, prompt: args.prompt, schema: args.schema });
    if (args.system === SELECT_SYSTEM) return { value: typeof select === 'string' ? { template: select, reason: 'test', notCovered: [] } : select, usage: { inputTokens: 1000, outputTokens: 50 }, costUsd: 0.001 };
    assert.equal(args.system, FILL_SYSTEM);
    const f = fills[Math.min(n++, fills.length - 1)];
    return { value: typeof f === 'function' ? f(args.prompt) : f, usage: { inputTokens: 1500, outputTokens: 200 }, costUsd: 0.002 };
  });
  const port = new ModelPort({ policy: loadPolicy().policy, providers: { 'claude-cli': provider }, journal: new Journal(new DatabaseSync(':memory:')) });
  return { port, seen };
}
const fill = (slots, extra = {}) => ({ slots, notStated: [], questions: [], assumptions: ['test'], ...extra });
const weekly = (recipient, more = {}) => fill({ team: 'Platform', recipient, listOpen: false, listBlocked: false, ...more });

test('select -> fill -> the one question whose wrong guess would send data somewhere -> answer -> a practised, ready flow', async () => {
  const { port, seen } = scripted({ select: 'weekly-report', fills: [weekly('', {}), weekly('boss@example.com')] });
  const builder = new ModelBuilder({ port });
  const q = await builder.build({ request: 'ugh can u make something that tells my boss what we got done each week for the Platform team' });
  assert.equal(q.status, 'needs_answers'); assert.deepEqual(q.questions.map(x => x.slot), ['recipient']);
  assert.equal(q.buildReport.calls, 2); assert.match(q.builder, /claude-haiku-5-5; 7 templates/);
  const r = await builder.build({ request: 'ugh can u make something that tells my boss what we got done each week for the Platform team', answers: { recipient: 'boss@example.com' } });
  assert.equal(r.status, 'ready'); assert.equal(r.template, 'weekly-report');
  assert.equal(r.workflow.id, 'weekly-report-platform'); assert.ok(r.workflow.metadata.tags.includes(`builder:${builder.id}`));
  assert.equal(r.practice.passed, true); assert.deepEqual(r.buildReport.practiceRuns.map(p => p.passed), [true]);
  assert.ok(r.willDo.some(w => /boss@example.com only/.test(w)));
  assert.ok(r.buildReport.costUsd > 0 && r.buildReport.inputTokens > 0);
  assert.match(seen.at(-1).prompt, /answers to earlier questions:\n- recipient: boss@example.com/);
});

test('an address the person never wrote is not used: it is asked about', async () => {
  const { port } = scripted({ select: 'weekly-report', fills: [weekly('boss@company.com')] });
  const r = await new ModelBuilder({ port }).build({ request: 'weekly summary of platform work to my boss pls' });
  assert.equal(r.status, 'needs_answers'); assert.deepEqual(r.understood.ungrounded, [{ slot: 'recipient', value: 'boss@company.com' }]);
});

test('"none fits" is an answer: nothing is filled, nothing is created', async () => {
  const { port, seen } = scripted({ select: { template: 'none', reason: 'Paying people is not something these flows do.', notCovered: [] }, fills: [] });
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-none-'));
  const app = new FoundryApp({ workspace: dir, builder: new ModelBuilder({ port }) });
  try {
    const r = await app.propose({ request: 'pay my contractors every friday from the bank' });
    assert.equal(r.status, 'unsupported'); assert.match(r.reply, /Nothing was created/); assert.equal(r.build.calls, 1);
    assert.equal(seen.length, 1); assert.equal(app.foundry.store.proposals().length, 0);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the repair loop: a failed check goes back to the model, at most 3 rounds, then an honest failure', async () => {
  const inv = s => fill({ firstAfterDays: 7, secondAfterDays: 14, finalAfterDays: 30, signature: 'Bloom', sendSummary: false, summaryTo: '', ...s });
  const { port, seen } = scripted({ select: 'invoice-chase', fills: [inv({ secondAfterDays: 5 }), inv({})] });
  const r = await new ModelBuilder({ port }).build({ request: 'chase late invoices, second reminder 5 days... no, 2 weeks' });
  assert.equal(r.status, 'ready'); assert.deepEqual(r.buildReport.repairs.map(x => x.kind), ['slots']);
  assert.match(seen.at(-1).prompt, /did not pass the checks[\s\S]*secondAfterDays must be later/);
  const bad = scripted({ select: 'invoice-chase', fills: [inv({ secondAfterDays: 5 })] });
  const f = await new ModelBuilder({ port: bad.port }).build({ request: 'chase late invoices' });
  assert.equal(f.status, 'build_failed'); assert.equal(f.buildReport.repairs.length, 4); assert.match(f.reply, /Nothing was created/);
});

test('a schema failure is retried at most twice, then the build stops in words', async () => {
  const { port } = scripted({ select: 'weekly-report', fills: [{ slots: { team: 'x' } }] });
  await assert.rejects(new ModelBuilder({ port }).build({ request: 'weekly report to a@b.example' }), { code: 'BUILDER_MODEL' });
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-schema-'));
  const app = new FoundryApp({ workspace: dir, builder: new ModelBuilder({ port: scripted({ select: 'weekly-report', fills: [{ slots: {} }] }).port }) });
  try { const r = await app.propose({ request: 'weekly report to a@b.example' }); assert.equal(r.ok, false); assert.match(r.problem.what, /could not give a usable answer/); }
  finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('product path with the model builder: propose -> practice on template data -> person turns it on -> live run asks before each send -> verified', async () => {
  const t = library.find(x => x.id === 'invoice-chase');
  const { port } = scripted({ select: 'invoice-chase', fills: [fill({ firstAfterDays: 7, secondAfterDays: 14, finalAfterDays: 30, signature: 'Maria, Bloom Bakery', sendSummary: true, summaryTo: 'maria@bloom.example' })] });
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-app-'));
  const builder = new ModelBuilder({ port });
  const app = new FoundryApp({ workspace: dir, builder });
  try {
    const p = await app.propose({ request: 'chase customers who havent paid, nicely at first. send me a summary at maria@bloom.example. sign it Maria, Bloom Bakery' });
    assert.equal(p.status, 'proposed'); assert.equal(p.builder, builder.id); assert.equal(p.template, 'invoice-chase'); assert.equal(p.build.calls, 2);
    assert.match(app.foundry.store.proposal(p.proposalId).rationale, /model-template-builder\/1/);
    const d = await app.dryRun({ proposalId: p.proposalId });
    assert.equal(d.passed, true); assert.equal(d.wouldDo.filter(w => w.action === 'send').length, 4);
    const a = app.requestApproval({ proposalId: p.proposalId });
    assert.equal(app.decideActivation(a.approvalId, true, { channel: 'dashboard' }).status, 'approved');
    // The person's real data: the workspace's own sheet.
    mkdirSync(path.join(dir, 'world', 'sheets'), { recursive: true });
    writeFileSync(path.join(dir, 'world', 'sheets', 'invoices.json'), JSON.stringify([{ invoice: 'A-1', customer: 'Cafe', email: 'cafe@x.example', amount: 50, due: '2026-10-01', status: 'open' }, { invoice: 'A-2', customer: 'Gym', email: 'gym@x.example', amount: 90, due: '2026-10-01', status: 'paid' }]));
    let r = await app.run({ flowId: p.flowId, input: { now: '2026-10-21T09:00:00Z' } });
    let asked = 0;
    while (r.status === 'awaiting_approval') { asked++; r = await app.decideAction(r.runId, r.pendingApprovals[0].approvalId, true, { channel: 'dashboard' }); }
    assert.equal(r.status, 'succeeded'); assert.equal(r.verdict, 'pass'); assert.equal(asked, 2, 'one reminder (Cafe, second stage) and one summary, each asked');
    assert.equal(practiceOf(t).input.now < '2026-10-21', true);
    // A revision keeps the slots it was not asked to change (no model call to re-select), and only the target changes.
    const { port: port2 } = scripted({ select: 'none', fills: [fill({ firstAfterDays: 7, secondAfterDays: 14, finalAfterDays: 30, signature: 'Maria, Bloom Bakery', sendSummary: true, summaryTo: 'books@bloom.example' }, { notStated: ['firstAfterDays', 'secondAfterDays', 'finalAfterDays', 'signature', 'sendSummary'] })] });
    app.builder = new ModelBuilder({ port: port2 });
    const v2 = await app.propose({ request: 'send the summary to books@bloom.example instead', flowId: p.flowId });
    assert.equal(v2.status, 'proposed'); assert.equal(v2.version, 2); assert.equal(v2.build.calls, 1, 'no select call for an existing flow');
    assert.deepEqual(v2.changes.changed.sort(), ['audit', 'sendSummary']);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('MCP propose_flow and dry_run work unchanged over a model-built library flow', async () => {
  const { port } = scripted({ select: 'oncall-digest', fills: [fill({ channel: '#ops', windowHours: 24, minSeverity: 'warning', page: false, pageTo: '' })] });
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-mcp-'));
  const app = new FoundryApp({ workspace: dir, builder: new ModelBuilder({ port }) });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await serveAppMcp(app, { transport: s });
  const client = new Client({ name: 't', version: '1' }); await client.connect(c);
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  try {
    const p = await call('propose_flow', { request: 'every morning post the unresolved alerts in #ops' });
    assert.equal(p.status, 'proposed'); assert.match(p.say, /It will not/);
    const d = await call('dry_run', { proposalId: p.proposalId });
    assert.equal(d.passed, true); assert.match(d.say, /posted to #ops/);
    const r = await call('run_flow', { flowId: p.flowId, input: { now: '2026-10-21T09:00:00Z' } });
    assert.equal(r.problem.code, 'NOT_APPROVED');
  } finally { await client.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('model choice comes from the owner policy; Mercury needs a token cap and keeps Haiku listed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bm-port-'));
  try {
    await assert.rejects(createBuilderPort({ model: 'mercury-3', journalFile: path.join(dir, 'j.sqlite') }), { code: 'BUILDER_TOKEN_CAP' });
    const m = await createBuilderPort({ model: 'mercury-3', journalFile: path.join(dir, 'm.sqlite'), tokenCap: 1000, callTokens: 500 });
    assert.deepEqual(Object.keys(m.port.providers).sort(), ['claude-cli', 'inception']); assert.equal(m.tokens().inception.cap, 1000);
    m.db.close();
    await assert.rejects(createBuilderPort({ model: 'gpt-9', journalFile: path.join(dir, 'x.sqlite') }), /not in the owner policy/);
    const h = await createBuilderPort({ journalFile: path.join(dir, 'h.sqlite') });
    assert.deepEqual(Object.keys(h.port.providers), ['claude-cli']); h.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
