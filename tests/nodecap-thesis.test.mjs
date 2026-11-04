// Fixes of the 2026-10-22 review "thesis invariants and correctness" (research/nodecap-20261021/ARCHITECTURE.md §9): one test per fixed
// finding, each asserting what happened (a run created, a member bound, a grant, an approval asked, a value seen), so that it fails on the
// pre-fix code (8b200022) by an assertion and not by a missing export (new modules are imported inside the tests). The calls pass the old
// and the new interface together where they differ, so the same test runs on both. ScriptedProvider and loopback fixtures only; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, symlinkSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { digest } from '../src/data.mjs';
import { checkCatalog, catalogDigest } from '../src/capabilities/catalog.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope, autoBind } from '../src/capabilities/envelope.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { NodecapHost } from '../src/capabilities/host.mjs';
import { loadTypes } from '../src/capabilities/types.mjs';
import { construct, launch, runtimeFor } from '../src/capabilities/launcher.mjs';
import { Dispatcher } from '../src/capabilities/broker.mjs';
import { nodecapDecisions } from '../src/capabilities/journal.mjs';
import { lowerWorkflow } from '../src/capabilities/lower.mjs';
import { compileRegistry } from '../src/capabilities/registry.mjs';
import { programMember } from '../src/capabilities/program.mjs';
import { applyBind, continueRun, nextConstruction } from '../src/capabilities/proposals.mjs';
import { FIXTURES, catalogOf, crmEntry, sheetsEntry, rugpullEntry, stdioSource, workspace, openLedger, approveVersion, decide, approvedBind, person } from './support/nodecap.mjs';

const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const read = (tool, args = {}) => step({ action: 'read', tool, args }), act = (tool, args = {}) => step({ action: 'act', tool, args });
const request = need => step({ action: 'request', need }), done = answer => step({ action: 'done', answer }), stuck = () => step({ action: 'stuck' });
const S = (max = 200) => ({ type: 'string', maxLength: max });
const EMAIL = { type: 'object', additionalProperties: false, required: ['email'], properties: { email: S() } };
const FLOW = 'NodecapThesis';
const flow = (nodes, version = 1) => ({ schemaVersion: '1.0', id: FLOW, version, title: 'Thesis probe', goal: 'Answer with the tools the node acquires', domain: 'diagnostic',
  envelope: { assumptions: ['fixture servers'], risks: [], successCriteria: ['typed answer'] }, budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 }, nodes,
  acceptance: [{ op: 'exists', value: { $ref: `nodes.${nodes.at(-1).id}` } }] });
const work = (extra = {}, id = 'work') => ({ id, kind: 'agent', needs: [], description: 'Tool-using node', role: 'extract', instructions: 'Use the tools to answer.', returns: EMAIL, model: { class: 'M' }, ...extra });
const sidecarFor = (acquire, extra = {}, id = 'work') => ({ schema: 'foundry-nodecap-toolnodes/1', nodes: { [id]: { acquire, maxTurns: 6, ...extra } } });
const CRM_ONLY = { systems: ['crm'], objects: ['contact'], effectsMax: 'none', max: 2 };
const SHEETS = { systems: ['sheets'], objects: ['row'], effectsMax: 'non-idempotent', max: 2 };

async function setup(t, { entries, workflow = flow([work()]), sidecar = sidecarFor(CRM_ONLY), script, dir = workspace(t), env = {} }) {
  const store = new Store(dir), ledger = openLedger(dir);
  const catalog = checkCatalog(catalogOf(...entries));
  const host = new NodecapHost({ catalog, ledger, envelope, env });
  const provider = new ScriptedProvider({ [M]: script });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const construction = await construct({ workflow, sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  assert.deepEqual(construction.lint.errors, []);
  approveVersion(ledger, construction);
  const launched = await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  return { dir, store, ledger, host, provider, models, construction, ...launched, decisions: runId => nodecapDecisions(store, runId ?? launched.run.id) };
}
const turn = (run, i, node = 'work') => run.frames[`root/${node}__loop:${i}`]?.outputs ?? {};

// ============================================== #1 (blocker): approvals bind a version, once ==============================================

/** A run that ended on a typed gap whose proposal offers mcp.sheets.append_row (outside the node's crm-only lock). */
async function gapWorld(t, { continuation = [] } = {}) {
  const h = await setup(t, { entries: [crmEntry(), sheetsEntry()], script: [request({ kind: 'tool', verb: 'create', object: 'other', system: 'other', why: 'append a row to the team sheet' }), stuck(), ...continuation] });
  const first = await h.execute();
  assert.equal(first.error?.code, 'CAPABILITY_GAP', JSON.stringify(first.error));
  const [proposal] = h.ledger.proposals({ status: 'open' });
  assert.deepEqual(proposal.diff.added.map(a => a.member), ['mcp.sheets.append_row']);
  return { ...h, first, proposal };
}
// Both interfaces at once (the fix reads the ledger; the pre-fix code took the caller's proposal object, runtime, workflow and lock).
const bindFrom = (h, proposalId) => applyBind({ ledger: h.ledger, proposalId, proposal: h.ledger.proposal(proposalId), lock: h.construction.lock, members: h.host.members, envelope, workflow: flow([work()]), types });
const nextFrom = (h, proposalId, version = 2) => nextConstruction({ ledger: h.ledger, proposalId, proposal: h.ledger.proposal(proposalId), construction: h.construction, host: h.host, envelope, workflow: flow([work()]), types, version });
async function continueFrom(h, construction, priorRunId) {
  const { runtime } = runtimeFor({ store: h.store, host: h.host, ledger: h.ledger, construction, envelope, models: h.models, modelPolicy: loaded });
  if (h.store.workflow(FLOW).hash !== construction.workflowHash) h.store.saveWorkflow(construction.lowered, { expectedHash: h.store.workflow(FLOW).hash });
  return continueRun({ store: h.store, ledger: h.ledger, host: h.host, construction, envelope, priorRunId, models: h.models, modelPolicy: loaded, runtime, workflow: construction.lowered, lock: construction.lock });
}

test('thesis #1: a continuation runs nothing a person did not approve: lock N+1 without a version approval is refused and no run is created', async t => {
  const h = await gapWorld(t);
  decide(h.ledger, h.proposal, true, 'mcp.sheets.append_row');
  const next = await nextFrom(h, h.proposal.id);
  const before = h.store.runs().length;
  await assert.rejects(async () => continueFrom(h, next, h.first.id), code('LOCK_UNAPPROVED'));
  assert.equal(h.store.runs().length, before, 'no continuation run was created');
});

test('thesis #1: a continuation is refused once the flow moved on since the gap (head compare-and-swap from the gap\'s version)', async t => {
  const h = await gapWorld(t);
  decide(h.ledger, h.proposal, true, 'mcp.sheets.append_row');
  const next = await nextFrom(h, h.proposal.id);
  approveVersion(h.ledger, next);
  // Meanwhile another version became the flow's head (another launch, another continuation).
  const head = h.ledger.head(FLOW);
  h.ledger.setHead(FLOW, { workflowHash: 'f'.repeat(64), lockHash: `sha256:${'f'.repeat(64)}`, expectedRev: head?.rev ?? 0 });
  const before = h.store.runs().length;
  await assert.rejects(async () => continueFrom(h, next, h.first.id), code('CONTINUATION_STALE_HEAD'));
  assert.equal(h.store.runs().length, before, 'no continuation run was created');
});

test('thesis #1: lock N+1 is built only on the flow and the exact lock the proposal was raised on', async t => {
  const h = await gapWorld(t);
  const id = 'mcp.crm.list_deals', m = h.host.member(id), added = [{ member: id, effects: 'none', trust: m.trust, egress: m.egress, implementation: m.implementation }];
  const elsewhere = structuredClone(h.construction.lock); elsewhere.flowId = 'AnotherFlow';
  assert.throws(() => bindFrom(h, approvedBind(h.ledger, elsewhere, added)), code('PROPOSAL_FLOW_MISMATCH'));
  const older = structuredClone(h.construction.lock); older.nodes.work.maxTurns = 99;
  assert.throws(() => bindFrom(h, approvedBind(h.ledger, older, added)), code('PROPOSAL_LOCK_MISMATCH'));
  assert.ok(bindFrom(h, approvedBind(h.ledger, h.construction.lock, added)).lock.nodes.work.bound.includes(id), 'on its own flow and lock it binds');
});

test('thesis #1: a person approves ONE candidate; lock N+1 binds exactly that one, and an approval yields one lock N+1', async t => {
  const h = await gapWorld(t), lock = h.construction.lock;
  const added = ['mcp.crm.list_deals', 'mcp.crm.get_contact'].map(id => ({ member: id, effects: 'none', implementation: h.host.member(id).implementation }));
  const put = () => h.ledger.putProposal({ kind: 'capability.bind', flowId: lock.flowId, fromLockHash: `sha256:${digest(lock)}`, node: 'work', diff: { added } });
  // "Approve the proposal" (no candidate named) is not a decision about any member.
  const whole = put();
  assert.throws(() => h.ledger.decideProposal(whole.id, { person: person(NodecapLedger.proposalSubject(whole), true), expectedRev: whole.rev }), code('PROPOSAL_CHOICE_REQUIRED'));
  const proposal = put();
  decide(h.ledger, proposal, true, 'mcp.crm.get_contact');
  const next = await nextFrom(h, proposal.id);
  assert.ok(next.lock.nodes.work.bound.includes('mcp.crm.get_contact'));
  assert.ok(!next.lock.nodes.work.bound.includes('mcp.crm.list_deals'), 'the candidate the person did not pick is not bound');
  await assert.rejects(async () => nextFrom(h, proposal.id, 3), code('PROPOSAL_NOT_APPROVED'), 'the approval was consumed by the first lock N+1');
});

// =================================================== #2: entry status is the ledger's ===================================================

test('thesis #2: a status move never takes the caller\'s "from": a never-qualified entry is not activated even with a person decision for the claimed status', t => {
  const ledger = openLedger(workspace(t)); t.after(() => ledger.close());
  const claimed = person(NodecapLedger.statusSubject({ entryId: 'never', status: 'quarantined', to: 'active', rev: 0 }), true);
  assert.throws(() => ledger.setStatus('never', { from: 'quarantined', to: 'active', expectedRev: 0, actor: 'model', person: claimed }), error => ['LEDGER_FROM', 'LEDGER_TRANSITION'].includes(error.code));
  assert.equal(ledger.status('never'), null, 'nothing was recorded');
  // A move is a compare-and-swap: without the revision it changes nothing (here: a host quarantine raced it).
  ledger.quarantine('crm', 'DEFINITION_CHANGED', {});
  assert.throws(() => ledger.setStatus('crm', { to: 'revoked', reason: 'stale view' }));
  assert.equal(ledger.status('crm').status, 'quarantined');
  // The first status of an entry is the owner's catalog record (here: qualified), so a person can activate it from there.
  const catalog = checkCatalog(catalogOf({ ...crmEntry({ id: 'books' }), status: 'qualified' }));
  ledger.setStatus('books', { to: 'active', expectedRev: 0, catalog, person: person(NodecapLedger.statusSubject({ entryId: 'books', status: 'qualified', to: 'active', rev: 0 }), true) });
  assert.equal(ledger.status('books').status, 'active');
});

// ============================================ #4: a typed request grants only the top match ============================================

test('thesis #4: a request for a change never grants a read-only tool: it answers needs-approval with the effectful view', async t => {
  const h = await setup(t, { entries: [sheetsEntry()], sidecar: sidecarFor(SHEETS), script: [request({ kind: 'tool', verb: 'create', object: 'row', system: 'sheets', why: 'append a row' }), stuck()] });
  const run = await h.execute();
  const out = turn(run, 0).do;
  assert.deepEqual([out.result, out.tool], ['needs-approval', 'sheets_append_row'], JSON.stringify(out));
  assert.match(out.view, /\[effect: needs approval\]/);
  assert.deepEqual(h.decisions().filter(d => d.action.result === 'granted'), [], 'nothing was granted');
});

test('thesis #4: a single viable candidate below the score threshold is offered, never granted', async t => {
  const h = await setup(t, { entries: [sheetsEntry()], sidecar: sidecarFor(SHEETS), script: [request({ kind: 'tool', verb: 'list', object: 'row', system: 'sheets', why: 'quarterly' }), stuck()] });
  const run = await h.execute();
  assert.equal(turn(run, 0).do.result, 'options', JSON.stringify(turn(run, 0).do));
  assert.deepEqual(h.decisions().filter(d => d.action.result === 'granted'), [], 'nothing was granted');
});

// ===================================== #5: kind is a hint; a gap does not end the node on the spot =====================================

test('thesis #5: find matches computer-use and skill members whatever kind the need names (kind is a ranking hint)', () => {
  const mk = (id, kind, f) => ({ id, entryId: id.split('.')[1], kind, tool: id.split('.').pop(), trust: 'T1', custody: null, cost: 0, risk: 'low', requiresApproval: false, dataClass: 'internal',
    egress: 'local', outputLabel: 'untrusted:x', intents: [], verbs: ['read'], effects: 'none', view: { name: id.replace(/\W/g, '_'), summary: 'Look at the page', inputSchema: { type: 'object' } }, ...f });
  const members = { 'ui.app.observe': mk('ui.app.observe', 'cua', { system: 'app', objects: ['page'] }), 'skill.howto': mk('skill.howto', 'skill', { system: 'policy', objects: ['refund'] }),
    'mcp.sheets.read_range': mk('mcp.sheets.read_range', 'mcp-stdio', { system: 'sheets', objects: ['row'] }) };
  const lock = { flowId: 'F', tier0: {}, members, nodes: { work: { bound: [], skills: [], standby: Object.keys(members), acquire: { max: 4 }, controlLabel: 'untrusted:nodecap.work', maxCallsPerMember: 20 } } };
  const host = { members: new Map(), outsideCandidates: () => [], entry: () => ({ status: 'active' }), ledger: null };
  const d = new Dispatcher({ host, lock, lockHash: 'h', envelope, envelopeDigest: 'e' });
  assert.deepEqual(d.find('work', { verb: 'read', object: 'page', system: 'app', kind: 'tool' }).ranked.map(r => r.id), ['ui.app.observe']);
  assert.deepEqual(d.find('work', {}).ranked.map(r => r.id).sort(), Object.keys(members).sort(), 'an empty need sees every in-lock member');
});

test('thesis #5: a need outside the lock raises a proposal and the node goes on: it can still finish with what it holds', async t => {
  const h = await setup(t, { entries: [crmEntry(), sheetsEntry()],
    script: [request({ kind: 'tool', verb: 'create', object: 'other', system: 'other', why: 'log it in the team sheet' }), read('crm_search_contacts', { query: 'Ada' }), done({ email: 'ada@analytical.example' })] });
  const run = await h.execute();
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(turn(run, 0).do.code, 'CAPABILITY_GAP');
  assert.deepEqual(h.ledger.proposals().map(p => p.status), ['open'], 'the proposal still waits for a person');
});

// ========================================= #6: routing by the tool's effects; checked before a person is asked =========================================

test('thesis #6: an act on an effects-none tool is a read: no person is asked about a call with no effect', async t => {
  const h = await setup(t, { entries: [crmEntry()], script: [act('crm_search_contacts', { query: 'Ada' }), done({ email: 'ada@analytical.example' })] });
  const run = await h.execute();
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(Object.keys(run.approvals ?? {}), [], 'no approval was requested');
  assert.equal(turn(run, 0).do.ok, true);
});

test('thesis #6: an act whose arguments cannot run, or that names no effectful tool, is refused before any person is asked', async t => {
  const h = await setup(t, { entries: [sheetsEntry()], sidecar: sidecarFor(SHEETS),
    script: [act('sheets_append_row', { cells: 'not a list' }), act('none', { cells: ['x'] }), stuck()] });
  const run = await h.execute();
  assert.deepEqual(Object.keys(run.approvals ?? {}), [], 'no approval was requested');
  assert.deepEqual([turn(run, 0).do.code, turn(run, 1).do.code], ['ARGS_INVALID', 'TOOL_ABSENT']);
  assert.match(turn(run, 0).do.signature, /^sheets_append_row\(cells: array/);
  assert.equal(run.error?.code, 'NODE_STUCK');
});

// ======================================= #9: a program is no more trusted than the tools it calls =======================================

test('thesis #9: a program wrapping a T2, high-risk, C2 tool is T2, high-risk and C2 itself, so it is never auto-bound', () => {
  const PROGRAM = path.join(FIXTURES, 'programs', 'eu-open-deals.mjs'), sha = execFileSync('sha256sum', [PROGRAM]).toString().split(' ')[0];
  const fetcher = { id: 'mcp.crm.list_deals', entryId: 'crm', kind: 'mcp-http', trust: 'T2', custody: 'C2', risk: 'high', requiresApproval: true, effects: 'none', cost: 0, dataClass: 'public',
    egress: 'third-party', outputLabel: 'untrusted:mcp.crm', implementation: `sha256:${'a'.repeat(64)}`, view: { name: 'crm_list_deals', summary: 'List deals.', inputSchema: { type: 'object' } } };
  const entry = { id: 'deal-totals', kind: 'program', trust: 'T0', status: 'active', source: { lang: 'js', file: PROGRAM, sha256: sha }, uses: [fetcher.id], limits: { maxCalls: 5 },
    members: { eu_total: { type: 'deal.sum', system: 'crm', verbs: ['compute'], objects: ['deal'], effects: 'none', risk: 'low', requiresApproval: false, outputLabel: 'trusted', dataClass: 'internal',
      egress: 'local', maxTimeoutMs: 30000, cost: 0, outputMode: 'structured', outputSchema: { type: 'object' },
      view: { name: 'crm_open_deal_total', summary: 'Sum open deals.', inputSchema: { type: 'object', additionalProperties: false, required: ['region'], properties: { region: { enum: ['EU', 'US'] } } } } } } };
  const program = programMember(entry, new Map([[fetcher.id, fetcher]]));
  assert.deepEqual([program.trust, program.custody, program.risk, program.requiresApproval, program.egress], ['T2', 'C2', 'high', true, 'third-party']);
  assert.equal(autoBind(envelope, program, { controlLabel: 'untrusted:nodecap.work' }).ok, false);
});

// ============================================== #10: replay and resume are bound to the broker's code ==============================================

test('thesis #10: the compiled registry identity covers the broker thresholds and the capability source code', async t => {
  const member = { id: 'mcp.crm.search_contacts', entryId: 'crm', kind: 'mcp-stdio', tool: 'search_contacts', effects: 'none', risk: 'low', trust: 'T1', outputLabel: 'untrusted:mcp.crm', objects: ['contact'],
    system: 'crm', verbs: ['search'], implementation: `sha256:${'1'.repeat(64)}`, view: { name: 'crm_search_contacts', summary: 'Find contacts.', inputSchema: { type: 'object' } } };
  const lock = { flowId: 'F', tier0: {}, members: { [member.id]: member }, nodes: { work: { bound: [], skills: [], standby: [member.id], acquire: { max: 2 }, maxTurns: 4, maxCallsPerMember: 20, controlLabel: 'untrusted:nodecap.work' } } };
  const compile = (fn, thresholds) => fn({ lock, lockHash: 'sha256:l', host: {}, envelope, envelopeDigest: 'sha256:e', ...(thresholds ? { thresholds } : {}) }).hash();
  assert.notEqual(compile(compileRegistry), compile(compileRegistry, { tau: 9, delta: 0.5 }), 'other selection thresholds are another registry');
  // The same lock under a changed copy of src/capabilities (one comment in the broker) is another registry too.
  const dir = mkdtempSync(path.join(tmpdir(), 'nodecap-code-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  for (const copy of ['a', 'b']) for (const sub of ['src', 'schemas']) cpSync(path.join(ROOT, sub), path.join(dir, copy, sub), { recursive: true });
  appendFileSync(path.join(dir, 'b', 'src', 'capabilities', 'broker.mjs'), '\n// a changed broker\n');
  const [a, b] = await Promise.all(['a', 'b'].map(copy => import(path.join(dir, copy, 'src', 'capabilities', 'registry.mjs'))));
  assert.notEqual(compile(a.compileRegistry), compile(b.compileRegistry), 'a changed broker is another registry: resume and replay fail closed');
});

// ======================================================= #11: lowering refuses, never drops =======================================================

test('thesis #11: agent-node settings the lowering cannot carry are refused; recitation is carried onto every turn', () => {
  const lock = { flowId: FLOW, tier0: {}, members: {}, nodes: { work: { bound: [], skills: [], standby: [], acquire: null, maxTurns: 3, maxCallsPerMember: 5, controlLabel: 'untrusted:nodecap.work' } } };
  for (const extra of [{ timeoutMs: 1000 }, { onError: 'continue' }, { context: { budget: { maxInputTokens: 500 } } }])
    assert.throws(() => lowerWorkflow(flow([work(extra)]), lock), code('LOWER_UNSUPPORTED'), JSON.stringify(extra));
  const recite = { goal: true, constraints: ['Never email a customer.'] };
  const lowered = lowerWorkflow(flow([work({ context: { recite } })]), lock);
  assert.deepEqual(lowered.nodes.find(n => n.kind === 'loop').body.nodes[0].context.recite, recite);
});

// =========================================== #12, #13: one success definition; tool text per call ===========================================

test('thesis #12: the analysis reports the one-definition success (oracle AND run succeeded) beside the frozen oracle-only count', async () => {
  const { armTable } = await import('../experiments/nodecap/bed/analyze.mjs');
  const row = (task, arm, success, status, error = null) => ({ task, arm, success, status, error, used: [], proposals: [], turns: 1, exposed: 1, toolDefTokens: 1, promptTokens: 1 });
  const table = armTable([row('T06', 'B', true, 'failed', 'NODE_ANSWER_INVALID'), row('T01', 'B', true, 'succeeded'), row('T11', 'B', true, 'failed', 'CAPABILITY_GAP')]);
  assert.deepEqual([table.B.success, table.B.successStrict, table.B.oracleOnlySuccesses], [3, 2, ['T06: failed/NODE_ANSWER_INVALID']]);
});

test('thesis #13: tool text is measured per model call, views delivered through find and ARGS_INVALID answers included', async () => {
  const { toolTextPerCall } = await import('../experiments/nodecap/bed/episode.mjs');
  const inputs = [{ name: 'tools', value: 't'.repeat(40) }, { name: 'standby', value: 's'.repeat(40) }, { name: 'transcript', ref: 'previous.log.transcript' }];
  const construction = { lowered: { nodes: [{ kind: 'loop', body: { nodes: [{ context: { inputs } }] } }] } };
  const log = (i, transcript) => ({ type: 'node.completed', nodeKey: `root/work__loop:${i}/log`, output: { transcript } }), stepAt = i => ({ type: 'node.completed', nodeKey: `root/work__loop:${i}/step` });
  const found = { result: { ok: true, action: 'find', matches: ['m'.repeat(80)] } }, invalid = { result: { ok: false, code: 'ARGS_INVALID', signature: 'g'.repeat(40) } };
  const store = { events: () => [stepAt(0), log(0, [found]), stepAt(1), log(1, [found, invalid]), stepAt(2)] };
  assert.deepEqual(toolTextPerCall({ store, chain: [{ construction, runId: 'R' }] }), [20, 40, 50]);
});

// ===================================== #18: every proposal a call raises is in the run's chain =====================================

test('thesis #18: a definition change found during a call raises a proposal that is also an adaptation decision in the run\'s chain', async t => {
  const dir = workspace(t), file = path.join(dir, 'rugpull.jsonl');
  const entry = { ...rugpullEntry(), trust: 'T1', trustAnnotations: true, source: stdioSource('rugpull-stdio.mjs', ['--ledger', file, '--flip-after', '2'], { write: [dir] }) };
  const h = await setup(t, { dir, entries: [entry], sidecar: sidecarFor({ systems: ['rugpull'], objects: ['row'], effectsMax: 'none', max: 2 }), script: [read('rugpull_export_data', { rows: ['a'] }), stuck()] });
  const run = await h.execute();
  assert.equal(turn(run, 0).do.code, 'DEFINITION_CHANGED', JSON.stringify(turn(run, 0).do));
  const [proposal] = h.ledger.proposals();
  assert.equal(proposal.kind, 'capability.definition-changed');
  const chained = h.decisions().find(d => d.action.result === 'proposal');
  assert.deepEqual([chained?.action.proposalId, chained?.action.kind], [proposal.id, 'capability.definition-changed']);
  assert.ok(h.store.events(run.id).some(e => e.type === 'decision.recorded' && e.id === chained.id), 'in the hash chain');
});

// ============================================ #20: launch compares-and-swaps what construction saw ============================================

test('thesis #20: a version constructed before the flow moved on is not launched over it; the catalog digest is the host\'s own', async t => {
  const dir = workspace(t), store = new Store(dir), ledger = openLedger(dir);
  const catalog = checkCatalog(catalogOf(crmEntry())), host = new NodecapHost({ catalog, ledger, envelope });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const sidecar = sidecarFor(CRM_ONLY);
  await assert.rejects(construct({ workflow: flow([work()]), sidecar, host, envelope, types, store, catalogDigest: `sha256:${'f'.repeat(64)}` }), code('CATALOG_DIGEST_MISMATCH'));
  const v1 = await construct({ workflow: flow([work()]), sidecar, host, envelope, types, store }), v2 = await construct({ workflow: flow([work({ description: 'Another version' })], 2), sidecar, host, envelope, types, store });
  assert.equal(v1.catalogDigest, catalogDigest(catalog));
  approveVersion(ledger, v1); approveVersion(ledger, v2);
  await launch({ store, ledger, host, construction: v1, envelope, modelPolicy: loaded });
  // v2 was constructed when the flow had no version; v1 is the flow now, and v2 would silently replace it.
  await assert.rejects(launch({ store, ledger, host, construction: v2, envelope, modelPolicy: loaded }), error => ['CONFLICT', 'STALE_WORKFLOW'].includes(error.code));
  assert.equal(store.workflow(FLOW).hash, v1.workflowHash, 'the flow still runs v1');
});

// ============================================ #21: credentials given to a stdio server are scrubbed ============================================

test('thesis #21: a credential a stdio server takes from its environment is scrubbed: envAllow refuses credential names; an envSecrets value echoed back never reaches the model', async t => {
  const secret = `tok-${randomUUID()}-${randomUUID()}`;
  const members = { env_value: { type: 'env.read', system: 'probe', verbs: ['read'], objects: ['env'], effects: 'none', risk: 'low', requiresApproval: false, outputLabel: 'untrusted:mcp.probe', dataClass: 'internal',
    egress: 'local', maxTimeoutMs: 10000, cost: 0, outputMode: 'structured', outputSchema: { type: 'object' }, attestedBy: 'owner', attestedAt: '2026-11-04',
    view: { name: 'probe_env_value', summary: 'Read one setting.', inputSchema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: S(100) } } } } };
  const probe = source => ({ id: 'probe', kind: 'mcp-stdio', trust: 'T1', status: 'active', trustAnnotations: true, source, members });
  assert.throws(() => checkCatalog(catalogOf(probe(stdioSource('probe-stdio.mjs', [], { envAllow: ['PROBE_API_TOKEN'] })))), code('CATALOG_ENV_SECRET'));
  const h = await setup(t, { entries: [probe({ ...stdioSource('probe-stdio.mjs', []), envSecrets: ['PROBE_API_TOKEN'] })], env: { PROBE_API_TOKEN: secret },
    sidecar: sidecarFor({ systems: ['probe'], objects: ['env'], effectsMax: 'none', max: 2 }), script: [read('probe_env_value', { name: 'PROBE_API_TOKEN' }), stuck(), stuck()] });
  const run = await h.execute();
  assert.equal(run.error?.code, 'SECRET_EXPOSURE', JSON.stringify(run.error));
  for (const call of h.provider.calls) assert.ok(!call.prompt.includes(secret), 'the credential never reached a prompt');
  assert.ok(!JSON.stringify(h.store.events(run.id)).includes(secret), 'nor the run\'s events');
});

// ============================================= #22: the per-member call budget is per node =============================================

test('thesis #22: maxCallsPerMember is each node\'s own budget: one node\'s calls do not spend another\'s', async t => {
  const workflow = flow([work({}, 'a'), work({ needs: ['a'] }, 'b')]);
  const sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { a: { acquire: CRM_ONLY, maxTurns: 3, maxCallsPerMember: 1 }, b: { acquire: CRM_ONLY, maxTurns: 3, maxCallsPerMember: 1 } } };
  const h = await setup(t, { entries: [crmEntry()], workflow, sidecar,
    script: [read('crm_search_contacts', { query: 'Ada' }), done({ email: 'ada@analytical.example' }), read('crm_search_contacts', { query: 'Grace' }), done({ email: 'grace@cobol.example' })] });
  const run = await h.execute();
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(turn(run, 0, 'b').do.ok, true, JSON.stringify(turn(run, 0, 'b').do));
});

// ============================================= #23: an approval counts only after its request =============================================

test('thesis #23: nodecap.act accepts the user\'s decision only when it follows the call\'s own approval request in the chain', async () => {
  const member = { id: 'mcp.s.append', entryId: 's', kind: 'mcp-stdio', tool: 'append', effects: 'non-idempotent', risk: 'low', trust: 'T1', objects: ['row'], system: 's', verbs: ['create'],
    dataClass: 'internal', egress: 'local', outputLabel: 'untrusted:mcp.s', view: { name: 's_append', summary: 'Append a row.', inputSchema: { type: 'object' } } };
  const lock = { flowId: 'F', tier0: {}, members: { [member.id]: member }, nodes: { work: { bound: [member.id], skills: [], standby: [], acquire: null, maxTurns: 3, maxCallsPerMember: 5, controlLabel: 'untrusted:nodecap.work' } } };
  const calls = [];
  const host = { members: new Map(), entry: () => ({ id: 's', status: 'active' }), ledger: null, outsideCandidates: () => [], scrub: { assertClean: v => v }, invoke: async id => { calls.push(id); return { ok: true }; } };
  const ledger = { callDecision: () => ({ approve: true }), proposalsOfRun: () => [], cacheGrant() {} };
  const dispatcher = new Dispatcher({ host, lock, lockHash: 'sha256:l', envelope, envelopeDigest: 'sha256:e', ledger });
  const nodeKey = 'root/work__loop:0/act', args = { decision: { action: 'act', tool: 's_append', args: { row: 'x' } } };
  const approvalId = digest({ workflowHash: 'w', registryHash: 'r', nodeKey, tool: 'nodecap.act', args, idempotencyKey: 'k' });
  const ctx = events => ({ runId: 'R', nodeKey, idempotencyKey: 'k', store: { events: () => events, rows: { header: () => ({ workflowHash: 'w', registryHash: 'r' }) }, decisions: () => [], recordDecision() {} } });
  const decided = { type: 'approval.decided', approvalId, approved: true, actor: 'user' }, requested = { type: 'approval.requested', approvalId };
  await assert.rejects(async () => dispatcher.act(args, ctx([decided, requested])), code('APPROVAL_MISSING'));
  assert.deepEqual(calls, [], 'a decision recorded before the request sends nothing');
  await dispatcher.act(args, ctx([requested, decided]));
  assert.deepEqual(calls, [member.id], 'in order, the call is sent');
});
