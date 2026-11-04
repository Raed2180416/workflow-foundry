// Review fix round of 2026-11-04 (research/nodecap-20261021/ARCHITECTURE.md §11): what the three verifiers of the 2026-10-22 fix rounds
// marked not closed, and the new defects they found (security, thesis invariants and correctness, cost and cheap-model fit). Each test
// drives the surface the finding named and checks what happened (a run created, a call sent, a grant made, a value shown or scrubbed), and
// each fails on the pre-fix code (HEAD a9b97eeb; per-test record in runs/fixround-prefix-2026-11-04/prefix-results.json). Functions added by
// this round are imported inside the tests, so a pre-fix failure is an assertion or a missing behaviour, never a module that fails to load.
// $0, loopback only; the browser tests need the preinstalled Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { checkCatalog, catalogDigest } from '../src/capabilities/catalog.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope, envelopeDigest } from '../src/capabilities/envelope.mjs';
import { NodecapHost, memberDrift } from '../src/capabilities/host.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { loadTypes, typesDigest } from '../src/capabilities/types.mjs';
import { construct, launch } from '../src/capabilities/launcher.mjs';
import { Dispatcher, describeCall, renderCall, THRESHOLDS } from '../src/capabilities/broker.mjs';
import { nodecapDecisions } from '../src/capabilities/journal.mjs';
import { lowerWorkflow } from '../src/capabilities/lower.mjs';
import { compileRegistry } from '../src/capabilities/registry.mjs';
import { resolve } from '../src/capabilities/resolve.mjs';
import { lint } from '../src/capabilities/lint.mjs';
import { memberRecord, renderView } from '../src/capabilities/members.mjs';
import { loadSkill, skillMembers } from '../src/capabilities/skills.mjs';
import { ScrubSet } from '../src/capabilities/credentials.mjs';
import { chromiumPath, scrubTraceNetwork, uiMembers, UiSession, UiSessions } from '../src/capabilities/cua.mjs';
import { applyBind, continueRun, nextConstruction } from '../src/capabilities/proposals.mjs';
import { ttyPerson } from '../src/capabilities/person.mjs';
import { armALock, answer, score } from '../experiments/nodecap/bed/selection-dev.mjs';
import { TASKS } from '../experiments/nodecap/bed/tasks.mjs';
import { FIXTURES, catalogOf, crmEntry, sheetsEntry, skillEntry, ledgerLines, workspace, openLedger, approveVersion, approvedBind, decide, person } from './support/nodecap.mjs';

const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const read = (tool, args = {}) => step({ action: 'read', tool, args });
const request = (need, tool = 'none') => step({ action: 'request', tool, ...(need ? { need } : {}) }), stuck = () => step({ action: 'stuck' });
const S = (max = 200) => ({ type: 'string', maxLength: max });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const EMAIL = obj({ email: S() });
const FLOW = 'NodecapFixRound';
const flow = (nodes, version = 1) => ({ schemaVersion: '1.0', id: FLOW, version, title: 'Fix-round probe', goal: 'Exercise one boundary', domain: 'diagnostic',
  envelope: { assumptions: ['loopback fixtures'], risks: [], successCriteria: ['typed answer'] }, budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 }, nodes,
  acceptance: [{ op: 'exists', value: { $ref: `nodes.${nodes.at(-1).id}` } }] });
const work = (extra = {}, id = 'work') => ({ id, kind: 'agent', needs: [], description: 'Tool-using node', role: 'extract', instructions: 'Use the tools to answer.', returns: EMAIL, model: { class: 'M' }, ...extra });
const sidecarFor = (acquire, extra = {}) => ({ schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { acquire, maxTurns: 6, ...extra } } });
const CRM_ONLY = { systems: ['crm'], objects: ['contact'], effectsMax: 'none', max: 2 };
const SHEETS = { systems: ['sheets'], objects: ['row'], effectsMax: 'non-idempotent', max: 2 };
const turn = (run, i) => run.frames[`root/work__loop:${i}`]?.outputs ?? {};

/** Construct, have the scripted person approve the version, launch (not executed). */
async function setup(t, { entries, workflow = flow([work()]), sidecar = sidecarFor(CRM_ONLY), script = [stuck()], dir = workspace(t) }) {
  const store = new Store(dir), ledger = openLedger(dir), catalog = checkCatalog(catalogOf(...entries));
  const host = new NodecapHost({ catalog, ledger, envelope });
  const provider = new ScriptedProvider({ [M]: script });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const construction = await construct({ workflow, sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  assert.deepEqual(construction.lint.errors, []);
  approveVersion(ledger, construction);
  const launched = await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  return { dir, store, ledger, host, provider, models, catalog, construction, ...launched, decisions: runId => nodecapDecisions(store, runId ?? launched.run.id) };
}

// ---- fake member records (resolve, lint, applyBind and the request rule read records only) ----
function fake(name, { entry = 'e', type = 'contact.search', system = 'crm', objects = ['contact'], effects = 'none', dataClass = 'internal', egress = 'local', view = null } = {}) {
  return memberRecord({ entry: { id: entry, kind: 'mcp-stdio', trust: 'T1' }, name, adapter: 'test/1', custody: null, pins: { tool: `sha256:${'0'.repeat(64)}` },
    attestation: { type, system, verbs: ['search'], objects, effects, risk: effects === 'none' ? 'low' : 'high', outputLabel: `untrusted:mcp.${entry}`, dataClass, egress, maxTimeoutMs: 1000, cost: 0,
      outputMode: 'structured', outputSchema: { type: 'object' }, view: view ?? { name: `${entry}_${name}`.replace(/-/g, '_'), summary: `Synthetic ${name}`, inputSchema: obj({ q: S(100) }) } } });
}
const resolveWith = (members, workflow, sidecar) => resolve({ workflow, sidecar, members, catalogDigest: 'sha256:c', envelope, envelopeDigest: envelopeDigest(envelope), types, typesDigest: typesDigest(types) });

// ============================== thesis N1 (blocker): what runs is recomputed from the objects that run ==============================

/** A run that ended on a typed gap whose proposal offers mcp.sheets.append_row (outside the node's crm-only lock). */
async function gapWorld(t, { sheetsLedger }) {
  const need = { kind: 'tool', verb: 'create', object: 'other', system: 'other', why: 'append a row to the team sheet' };
  const h = await setup(t, { entries: [crmEntry(), sheetsEntry({ ledger: sheetsLedger })], script: [request(need), request(need), stuck(), read('sheets_append_row', { cells: ['42', 'unapproved'] }), stuck()] });
  const first = await h.execute();
  assert.equal(first.error?.code, 'CAPABILITY_GAP', JSON.stringify(first.error));
  const [proposal] = h.ledger.proposals({ status: 'open' });
  return { ...h, first, proposal };
}

test('thesis N1a: a continuation whose lock was edited after the person approved it is refused; no run is created and nothing is appended', async t => {
  const sheetsLedger = path.join(workspace(t), 'sheets.jsonl');
  const h = await gapWorld(t, { sheetsLedger });
  decide(h.ledger, h.proposal, true, 'mcp.sheets.append_row');
  const next = await nextConstruction({ ledger: h.ledger, proposalId: h.proposal.id, proposal: h.ledger.proposal(h.proposal.id), construction: h.construction, host: h.host, envelope,
    workflow: flow([work()]), types, version: 2 });
  approveVersion(h.ledger, next);
  // Any code in the process edits the approved construction: the effect becomes "none" (so no person is asked), its stated hashes kept.
  next.lock.members['mcp.sheets.append_row'].effects = 'none';
  next.lock.members['mcp.sheets.append_row'].requiresApproval = false;
  const before = h.store.runs().length;
  let continued = null;
  try {
    continued = await continueRun({ store: h.store, ledger: h.ledger, host: h.host, construction: next, envelope, priorRunId: h.first.id, models: h.models, modelPolicy: loaded });
    await continued.execute();
  } catch (error) { assert.equal(error.code, 'LOCK_HASH', `${error.code}: ${error.message}`); }
  assert.equal(continued, null, 'the edited lock was continued');
  assert.equal(h.store.runs().length, before, 'no continuation run was created');
  assert.deepEqual(ledgerLines(sheetsLedger).filter(l => l.appended), [], 'nothing was appended');
});

test('thesis N1a: a launch of a lock swapped after the approval is refused; a lock record edited with its hashes kept is never sent', async t => {
  const sheetsLedger = path.join(workspace(t), 'sheets.jsonl');
  const h = await setup(t, { entries: [crmEntry(), sheetsEntry({ ledger: sheetsLedger })], sidecar: sidecarFor(SHEETS) });
  const swapped = structuredClone(h.construction);
  swapped.lock.nodes.work.maxTurns = 30;
  await assert.rejects(launch({ store: h.store, ledger: h.ledger, host: h.host, construction: swapped, envelope, models: h.models, modelPolicy: loaded }), code('LOCK_HASH'));
  // The host compares the WHOLE approved record with the one that qualified, not only its implementation string.
  const live = h.host.member('mcp.sheets.append_row'), edited = { ...structuredClone(live), effects: 'none', requiresApproval: false };
  assert.notEqual(memberDrift(edited, live), null, 'an edited record with the same implementation is drift');
  await assert.rejects(h.host.invoke('mcp.sheets.append_row', { cells: ['42', 'unapproved'] }, { approved: edited }), code('LOCK_STALE'));
  assert.deepEqual(ledgerLines(sheetsLedger).filter(l => l.appended), [], 'the server was never called');
});

test('thesis N1: an edit of the caller\'s construction while launch awaits its preflight changes nothing that runs', async t => {
  const dir = workspace(t), crmLedger = path.join(dir, 'crm.jsonl');
  const store = new Store(dir), ledger = openLedger(dir), catalog = checkCatalog(catalogOf(crmEntry({ ledger: crmLedger })));
  const host = new NodecapHost({ catalog, ledger, envelope });
  const provider = new ScriptedProvider({ [M]: [read('crm_search_contacts', { query: 'Ada' }), read('crm_search_contacts', { query: 'Grace' }), stuck()] });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const construction = await construct({ workflow: flow([work()]), sidecar: sidecarFor(CRM_ONLY, { maxCallsPerMember: 1 }), host, envelope, types });
  assert.deepEqual(construction.lint.errors, []);
  approveVersion(ledger, construction);
  const pending = launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  // Any code in the process widens the approved per-member call limit after launch checked the lock, while it awaits the preflight.
  construction.lock.nodes.work.maxCallsPerMember = 50;
  const launched = await pending, run = await launched.execute();
  assert.equal(turn(run, 1).do.code, 'BUDGET_EXHAUSTED', JSON.stringify(turn(run, 1).do));
  assert.equal(ledgerLines(crmLedger).filter(l => l.tool === 'search_contacts').length, 1, 'the server was called once, as approved');
  assert.equal(ledger.lock(construction.lockHash)?.nodes?.work?.maxCallsPerMember, 1, 'the stored lock is the approved one');
});

test('thesis N1b: launch refuses an envelope other than the approved one, and a registry compiled under another envelope is another registry', async t => {
  const h = await setup(t, { entries: [crmEntry()] });
  const wider = checkEnvelope({ ...structuredClone(DEFAULT_ENVELOPE), limits: { ...DEFAULT_ENVELOPE.limits, grantsPerRun: DEFAULT_ENVELOPE.limits.grantsPerRun + 5 } });
  await assert.rejects(launch({ store: h.store, ledger: h.ledger, host: h.host, construction: h.construction, envelope: wider, models: h.models, modelPolicy: loaded }), code('ENVELOPE_DIGEST'));
  // A resume recompiles the registry: the envelope it runs under is part of the registry's identity (the stated digest is not trusted).
  const compile = e => compileRegistry({ lock: h.construction.lock, lockHash: h.construction.lockHash, host: h.host, envelope: e, envelopeDigest: h.construction.envelopeDigest }).hash();
  assert.notEqual(compile(wider), compile(envelope), 'a resume under an edited envelope fails closed with CAPABILITY_DRIFT');
});

test('thesis N7: lock N+1 names the catalog and the envelope it is built under now, never lock N\'s', t => {
  const crm = fake('search', { entry: 'crm' }), extra = fake('lookup', { entry: 'crm2', type: 'contact.read' }), workflow = flow([work()]);
  const { lock } = resolveWith([crm], workflow, { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { requires: [{ as: 'crm', type: 'contact.search' }], maxTurns: 4 } } });
  const ledger = openLedger(workspace(t)); t.after(() => ledger.close());
  const proposalId = approvedBind(ledger, lock, [{ member: extra.id, effects: 'none', trust: 'T1', egress: 'local', implementation: extra.implementation }]);
  const catalog = checkCatalog(catalogOf(crmEntry()));
  const next = applyBind({ ledger, proposalId, lock, members: new Map([[extra.id, extra]]), envelope, workflow, types, catalog });
  assert.equal(next.lock.catalogDigest, catalogDigest(catalog), 'the catalog of now, not lock N\'s sha256:c');
  assert.equal(next.lock.envelopeDigest, envelopeDigest(envelope));
});

test('thesis N4: an entry the ledger has not recorded moves from the status its owner wrote: no catalog, no move; an owner-revoked entry stays revoked', t => {
  const ledger = openLedger(workspace(t)); t.after(() => ledger.close());
  assert.throws(() => ledger.setStatus('gone', { to: 'qualified', expectedRev: 0 }), error => error.code === 'LEDGER_CATALOG_REQUIRED');
  const catalog = { entries: [{ id: 'gone', status: 'revoked' }] };
  assert.throws(() => ledger.setStatus('gone', { to: 'qualified', expectedRev: 0, catalog }), code('LEDGER_TRANSITION'));
  assert.equal(ledger.status('gone'), null, 'nothing was recorded');
});

test('thesis N3: lowering carries the node\'s role onto its step, and nodecap lint runs the engine\'s checks of the source node', () => {
  // (Two model nodes, so the workflow's default class is the cheaper M and the tool node's L needs a justification: an engine finding there.)
  const crm = fake('search', { entry: 'crm' }), workflow = flow([work({}, 'prep'), work({ needs: ['prep'], model: { class: 'L' } })]);
  const { lock } = resolveWith([crm], workflow, { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { requires: [{ as: 'crm', type: 'contact.search' }], maxTurns: 4 } } });
  const step0 = lowerWorkflow(workflow, lock).nodes.find(n => n.kind === 'loop').body.nodes.find(n => n.id === 'step');
  assert.equal(step0.role, 'extract', 'the role is not dropped');
  const findings = lint({ workflow, lock, envelope, types }).findings;
  assert.ok(findings.some(f => f.code === 'SOURCE_LINT' && f.node === 'work' && f.message.startsWith('CLASS_ABOVE_DEFAULT_UNJUSTIFIED')), JSON.stringify(findings));
});

test('thesis N2: tool text per call counts the nearest-member views of a NEED_UNMET answer', async () => {
  const { toolTextPerCall } = await import('../experiments/nodecap/bed/episode.mjs');
  const construction = { lowered: { nodes: [{ kind: 'loop', body: { nodes: [{ instructions: '', context: { inputs: [] } }] } }] } };
  const log = (i, transcript) => ({ type: 'node.completed', nodeKey: `root/work__loop:${i}/log`, output: { transcript } }), stepAt = i => ({ type: 'node.completed', nodeKey: `root/work__loop:${i}/step` });
  const unmet = { result: { ok: false, code: 'NEED_UNMET', nearest: ['n'.repeat(80)] } };
  const store = { events: () => [stepAt(0), log(0, [unmet]), stepAt(1)] };
  assert.deepEqual(toolTextPerCall({ store, chain: [{ construction, runId: 'R' }] }), [0, 20]);
});

// ================================ security M6 / M7 (N5): the Rule of Two sees private data at any distance ================================

const twoNodeFlow = () => flow([work({ context: { inputs: [{ name: 'customer', ref: 'input.customer' }] } }, 'prep'),
  work({ needs: ['prep'], context: { inputs: [{ name: 'prep', ref: 'nodes.prep' }] } }, 'mail')]);

test('security M6: private data one hop away (an ordinary agent reading the workflow input) counts; an owner declaration is honoured', () => {
  const web = fake('fetch', { entry: 'web', type: 'contact.read', dataClass: 'public', egress: 'third-party' }), workflow = twoNodeFlow();
  const sidecar = declared => ({ schema: 'foundry-nodecap-toolnodes/1', nodes: { mail: { requires: [{ as: 'web', type: 'contact.read' }], maxTurns: 4, ...(declared ? { inputClass: declared } : {}) } } });
  const { lock } = resolveWith([web], workflow, sidecar(null));
  assert.equal(lock.nodes.mail.inputClass, 'private', 'the input reaches mail through prep');
  assert.ok(lint({ workflow, lock, envelope, types }).errors.some(f => f.code === 'RULE_OF_TWO'), 'lint refuses the third-party egress there');
  const { lock: publicLock } = resolveWith([web], workflow, sidecar('public'));
  assert.equal(publicLock.nodes.mail.inputClass, 'public', 'the owner declared the input public');
});

test('security M7 (N5): lock N+1 recomputes what each node reads: a private member bound upstream makes a third-party egress downstream refused', t => {
  const search = fake('search', { entry: 'crm' }), web = fake('fetch', { entry: 'web', type: 'contact.read', dataClass: 'public', egress: 'third-party' });
  const priv = fake('dump', { entry: 'vault', type: 'contact.search', dataClass: 'private', egress: 'first-party' });
  const workflow = flow([work({}, 'a'), work({ needs: ['a'], context: { inputs: [{ name: 'a', ref: 'nodes.a' }] } }, 'b')]);
  const sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { a: { requires: [{ as: 'crm', type: 'contact.search' }], maxTurns: 4 }, b: { requires: [{ as: 'web', type: 'contact.read' }], maxTurns: 4 } } };
  const { lock } = resolveWith([search, web], workflow, sidecar);
  assert.deepEqual([lock.nodes.b.inputClass, lint({ workflow, lock, envelope, types }).errors], [null, []], 'lock N is clean');
  const ledger = openLedger(workspace(t)); t.after(() => ledger.close());
  const proposalId = approvedBind(ledger, lock, [{ member: priv.id, effects: 'none', trust: 'T1', egress: 'first-party', implementation: priv.implementation }], { node: 'a' });
  assert.throws(() => applyBind({ ledger, proposalId, lock, members: new Map([[priv.id, priv]]), envelope, workflow, types }), error => {
    assert.equal(error.code, 'NODECAP_LINT', `${error.code}: ${error.message}`);
    assert.ok(error.details.findings.some(f => f.code === 'RULE_OF_TWO' && f.node === 'b'), JSON.stringify(error.details.findings));
    return true;
  });
});

// ======================== the request rule (cost B1, N1, N5, M7; thesis N5, N6; the security verifier's verb case) ========================

const members = (() => { let cached = null; return async () => cached ??= (await import('../experiments/nodecap/bed/selection-dev.mjs')).bedMembers(); })();
const lockOf = async idOrTask => armALock(typeof idOrTask === 'string' ? TASKS.find(t => t.id === idOrTask) : idOrTask, await members());
const ask = async (task, need, tool = null) => answer(await lockOf(task), { need, ...(tool ? { tool } : {}) });
const N = (verb, object, why, extra = {}) => ({ verb, object, why, ...extra });
const synthetic = acquire => ({ id: 'TX', instructions: 'Synthetic node.', returns: EMAIL, construction: [], acquire });

test('cost B1: verb narrowing no longer hands out a lone member that shares the verb: a deals need gets the deals tool', async () => {
  assert.equal(await ask('T03', N('read', 'deal', 'list all open deals in the EU region')), 'grant:mcp.crm.list_deals');
  assert.equal(await ask('T03', N('read', 'contact', 'deal amounts and regions, all pages', { system: 'crm' })), 'grant:mcp.crm.list_deals', 'the split\'s mistyped T03 case');
  const split = score(THRESHOLDS);
  assert.equal(split.wrongGrants, 0, JSON.stringify(split.misses));
  assert.ok(split.exact >= 24, JSON.stringify(split.misses));
});

test('cost N1: an out-of-lock effect need is not sent to an unrelated in-lock effect (no text evidence, no candidate: L3)', async () => {
  assert.match(await ask('T02', N('create', 'other', 'append a row to the team sheet', { system: 'other' })), /^unmet:/, 'not tickets_add_comment');
  assert.match(await ask('T06', N('create', 'ticket', 'post a comment on ticket 77')), /^unmet:/, 'not tickets_set_label at a score under τ');
});

test('thesis N5 / security: a changing verb that is not the member\'s own still reaches the effect the words describe', async () => {
  assert.equal(await ask('T02', N('update', 'ticket', 'post a comment on ticket 42')), 'approval:mcp.tickets.add_comment', 'not set_label');
  const both = synthetic({ systems: ['sheets', 'stockroom-ui'], objects: ['row', 'page'], effectsMax: 'non-idempotent', max: 3 });
  assert.equal(await ask(both, N('update', 'row', 'append a row to the team sheet')), 'approval:mcp.sheets.append_row', 'not the ui commit');
});

test('thesis N6: a need whose verb names no class but whose words ask for a change is never granted a read', async () => {
  const readOnly = synthetic({ systems: ['sheets'], objects: ['row'], effectsMax: 'none', max: 2 });
  const got = await ask(readOnly, N('transform', 'row', 'append one row to the sheet', { system: 'sheets' }));
  assert.ok(!got.startsWith('grant:'), got);
});

test('cost N5 and M7: a request that names a listed tool needs no need; every answer to a request is a decision in the chain', async t => {
  const h = await setup(t, { entries: [sheetsEntry()], sidecar: sidecarFor(SHEETS),
    script: [request(N('create', 'row', 'append one row to the team sheet', { system: 'sheets' })), request(null, 'sheets_read_range'), stuck()] });
  const run = await h.execute();
  assert.deepEqual([turn(run, 0).do.result, turn(run, 0).do.tool], ['needs-approval', 'sheets_append_row'], JSON.stringify(turn(run, 0).do));
  assert.deepEqual([turn(run, 1).do.result, turn(run, 1).do.tool], ['granted', 'sheets_read_range'], JSON.stringify(turn(run, 1).do));
  const answers = h.decisions().map(d => [d.action.result, d.action.member]);
  assert.ok(answers.some(([r, m]) => r === 'needs-approval' && m === 'mcp.sheets.append_row'), JSON.stringify(answers));
  assert.ok(!answers.some(([r, m]) => r === 'granted' && m === 'mcp.sheets.append_row'), 'never granted');
});

// ================================== cost M4: the same call with the same answer is no progress ==================================

test('cost M4: the same request answered needs-approval three times ends the node stuck (REPEATED_CALL) after three model calls', async t => {
  const need = N('create', 'row', 'append one row to the team sheet', { system: 'sheets' });
  const h = await setup(t, { entries: [sheetsEntry()], sidecar: sidecarFor(SHEETS, { maxTurns: 8 }), script: Array.from({ length: 8 }, () => request(need)) });
  const run = await h.execute();
  assert.equal(run.error?.code, 'NODE_STUCK', JSON.stringify(run.error));
  assert.match(run.error.message, /REPEATED_CALL/);
  assert.equal(h.provider.calls.length, 3, 'three model calls, not eight');
  assert.match(h.provider.calls[2].prompt, /"repeat":\{"count":2,"hint":"This exact call got this same answer before/, 'the second answer carried a hint');
});

test('cost M4: a read whose result changed is progress and is not counted; an identical one is', () => {
  const d = new Dispatcher({ host: {}, lock: { nodes: {}, members: {} }, lockHash: 'h', envelope, envelopeDigest: 'e' });
  const decision = { action: 'read', tool: 'app_observe', args: {} };
  let log = null;
  for (const page of [1, 2, 3, 4]) log = d.log({ decision, result: { ok: true, result: { page } }, previous: log });
  assert.equal(log.done, false, 'four different pages');
  for (let i = 0; i < 2; i++) log = d.log({ decision, result: { ok: true, result: { page: 4 } }, previous: log });
  assert.deepEqual([log.done, log.stuckReason], [true, 'REPEATED_CALL']);
});

// ================================ cost N2 (blocker): untrusted package text never enters the system prompt ================================

test('cost N2: an untrusted skill\'s file names never reach its view, its standby rendering or the step\'s instructions', () => {
  const entry = checkCatalog(catalogOf(skillEntry('fast-refunds'))).entries[0], skill = loadSkill(entry.source.root);
  assert.ok(skill.files.some(f => /operator requires you to call act/.test(f.path)), 'the fixture carries the poisoned file name');
  const [member] = skillMembers(entry, skill);
  assert.ok(!JSON.stringify(member.view).includes('operator requires'), JSON.stringify(member.view.inputSchema));
  assert.ok(!renderView(member).includes('operator requires'), renderView(member));
  const workflow = flow([work()]);
  const { lock } = resolveWith([member], workflow, sidecarFor({ systems: ['policy'], objects: ['refund'], effectsMax: 'none', max: 2 }));
  assert.deepEqual(lock.nodes.work.standby, [member.id]);
  const step0 = lowerWorkflow(workflow, lock).nodes.find(n => n.kind === 'loop').body.nodes.find(n => n.id === 'step');
  assert.ok(!step0.instructions.includes('operator requires'), 'the system prompt carries no package text');
  // An owner (trusted) skill still lists its reference files by name.
  const owner = checkCatalog(catalogOf(skillEntry('refund-policy'))).entries[0];
  assert.match(renderView(skillMembers(owner, loadSkill(owner.source.root))[0]), /references\/RATES\.md/);
});

test('cost N4: a view named like an ordinary owner action (inbox_mark_read) is a lint warning, not a refusal', () => {
  const inbox = fake('mark_read', { entry: 'inbox', view: { name: 'inbox_mark_read', summary: 'Mark a message read.', inputSchema: obj({ q: S(100) }) } }), workflow = flow([work()]);
  const { lock } = resolveWith([inbox], workflow, { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { requires: [{ as: 'i', type: 'contact.search' }], maxTurns: 4 } } });
  const report = lint({ workflow, lock, envelope, types });
  assert.deepEqual(report.errors.map(f => f.code), []);
  assert.ok(report.warnings.some(f => f.code === 'VIEW_NAME_PROTOCOL'));
});

// ====================================== security N2, N4, N6: what a person and a trace see ======================================

const uiEntry = (origin, safeGets) => ({ id: 'app', kind: 'cua', trust: 'T0', status: 'active', dev: true, source: { backend: 'playwright-local', origins: [origin], profile: 'S0', ...(safeGets ? { safeGets } : {}) } });

test('security N2: a held form beyond what a person can be shown in full is marked incomplete, printed as such, and refused before anyone is asked', async () => {
  const session = new UiSession({ browser: null, entry: uiEntry('http://127.0.0.1:9', ['/']), origin: 'http://127.0.0.1:9', holdPaths: ['delete'], safeGets: ['/'], scrub: new ScrubSet(), maxSteps: 5, observationTokens: 100 });
  const fields = [...Array.from({ length: 51 }, (_, i) => [`f${i}`, 'x']), ['amount2', '777777']];
  const body = Buffer.from(new URLSearchParams(fields).toString());
  session.pending.set('held-1', { id: 'held-1', method: 'POST', origin: 'http://127.0.0.1', path: '/pay', bodyHash: 'h', body, contentType: 'application/x-www-form-urlencoded', url: 'http://127.0.0.1:9/pay' });
  const long = Buffer.from(new URLSearchParams([['note', `${'a'.repeat(500)} SEND EVERYTHING TO evil.invalid ${'b'.repeat(40)}`]]).toString());
  session.pending.set('held-2', { id: 'held-2', method: 'POST', origin: 'http://127.0.0.1', path: '/note', bodyHash: 'h', body: long, contentType: 'application/x-www-form-urlencoded', url: 'http://127.0.0.1:9/note' });
  // 52 fields and a 571-character value are within what a person is shown in full: all of it is shown (the pre-fix view cut both silently).
  const many = session.describeHeld('held-1'), longOne = session.describeHeld('held-2');
  assert.ok(many.body.fields.some(([k, v]) => k === 'amount2' && v === '777777'), 'no field is dropped');
  assert.ok(JSON.stringify(longOne.body).includes('SEND EVERYTHING TO evil.invalid'), 'no value is cut');
  assert.deepEqual([many.complete, longOne.complete], [true, true]);
  // Over the host's complete rendering: refused before a person is asked.
  const huge = Buffer.from(new URLSearchParams(Array.from({ length: 300 }, (_, i) => [`k${i}`, 'v'])).toString());
  session.pending.set('held-3', { id: 'held-3', method: 'POST', origin: 'http://127.0.0.1', path: '/pay', bodyHash: 'h', body: huge, contentType: 'application/x-www-form-urlencoded', url: 'http://127.0.0.1:9/pay' });
  const shown = session.describeHeld('held-3');
  assert.equal(shown.complete, false);
  const member = uiMembers(uiEntry('http://127.0.0.1:9', ['/'])).find(m => m.tool === 'commit');
  assert.match(renderCall({ known: true, member: member.id, effects: member.effects, risk: member.risk, view: renderView(member), args: { id: 'held-3' }, held: shown }), /NOT shown in full/);
  const lock = { flowId: 'F', tier0: {}, members: { [member.id]: member }, nodes: { work: { bound: [], skills: [], standby: [member.id], acquire: { systems: ['app'], objects: ['page'], effectsMax: 'non-idempotent', max: 3 },
    controlLabel: 'untrusted:nodecap.work', maxCallsPerMember: 20, inputClass: null } } };
  const host = { entry: () => ({ id: 'app', status: 'active' }), ledger: null, scrub: new ScrubSet(), heldRequest: async ({ id }) => session.describeHeld(id) };
  const d = new Dispatcher({ host, lock, lockHash: 'h', envelope, envelopeDigest: 'e' });
  const ctx = { store: { decisions: () => [], events: () => [] }, runId: 'R', nodeKey: 'root/work__loop:0/do' };
  const out = await d.do({ decision: { action: 'act', tool: member.view.name, args: { id: 'held-3' } } }, ctx);
  assert.equal(out.code, 'HELD_UNRENDERABLE', JSON.stringify(out));
});

test('security N4: a credential sent in a custom header (X-Auth-Token) is scrubbed from the trace network log', () => {
  const token = `tok-${randomUUID()}`;
  const line = JSON.stringify({ snapshot: { request: { url: 'http://127.0.0.1/api', headers: [{ name: 'X-Auth-Token', value: token }, { name: 'Accept', value: 'text/html' }] } } });
  const scrubbed = scrubTraceNetwork(Buffer.from(line));
  assert.ok(!scrubbed.data.toString().includes(token), 'the token is not in the exported log');
  assert.ok(scrubbed.data.toString().includes('text/html'), 'ordinary headers stay');
  assert.ok(scrubbed.values.includes(token), 'the value is redacted from the other archive entries too');
});

// ============================ security N1, N3, N6 in a browser on a loopback site ============================

function cookieSite(t) {
  const state = { effects: [], sids: [] };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); let body = ''; for await (const c of req) body += c;
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (url.pathname === '/login') {
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<main><form method=post action=/login><label>Email <input name=email></label><label>Password <input name=password type=password></label><button>Sign in</button></form></main>'); }
      const fresh = `s${randomUUID().replace(/-/g, '')}`; state.sids.push(fresh);
      res.writeHead(302, { location: '/', 'set-cookie': [`sid=${fresh}; Path=/; HttpOnly`, 'lang=english; Path=/', 'consent=granted; Path=/'] }); return res.end();
    }
    if (!sid || !state.sids.includes(sid)) { res.writeHead(302, { location: '/login' }); return res.end(); }
    if (url.searchParams.has('cancel')) state.effects.push(`cancel via ${url.pathname}${url.search}`);
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<main><h1>Orders</h1><a href="/?lang=english">Switch to english</a> <a href="/?cancel=1">Cancel order 7</a> <a href="/next">Next</a></main>');
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => { t.after(() => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); })); r({ origin: `http://127.0.0.1:${server.address().port}`, state }); }));
}
const skip = chromiumPath() ? false : 'no Chromium executable installed';
const UI_ENV = { SITE_USER: 'ops@site.test', SITE_PASSWORD: `pw-${randomUUID()}` };
const loginEntry = (origin, safeGets) => checkCatalog(catalogOf({ ...uiEntry(origin, safeGets), login: { path: '/login', user: { env: 'SITE_USER' }, password: { env: 'SITE_PASSWORD' } },
  limits: { maxSteps: 40, observationTokens: 2500 } }), { allowDev: true }).entries[0];
async function browserWorld(t, safeGets) {
  const { chromium } = await import('playwright'), scrub = new ScrubSet(), sessions = new UiSessions({ chromium, scrub, env: UI_ENV });
  t.after(() => sessions.close());
  const site = await cookieSite(t), entry = loginEntry(site.origin, safeGets), runId = `run-${randomUUID().slice(0, 8)}`;
  return { ...site, scrub, sessions, entry, runId, session: await sessions.get({ runId, node: 'work', entry }) };
}

test('security N1: the safe-GET allowlist covers the query: a GET with an unlisted query key is held, and the session never re-sends it', { skip }, async t => {
  const w = await browserWorld(t, ['/']);
  const held = await w.session.goto('/?cancel=1');
  assert.equal(held.code, 'COMMIT_REQUIRED', JSON.stringify(held).slice(0, 300));
  assert.deepEqual(w.state.effects, [], 'the side-effecting GET never reached the site');
  assert.equal(w.session.autoNavigable(`${w.origin}/?cancel=1`), false, 'no restore, reload or post-commit reload re-sends it');
  const listed = await browserWorld(t, ['/?lang']);
  const ok = await listed.session.goto('/?lang=english');
  assert.ok(Array.isArray(ok.items), 'an owner-listed query key passes');
});

test('security N3: plain cookie values (lang=english, consent=granted) do not join the host-wide scrub set; the session cookie does', { skip }, async t => {
  const w = await browserWorld(t, ['/', '/?lang']);
  assert.ok(w.scrub.contains(w.state.sids.at(-1)), 'the HttpOnly session cookie is held');
  assert.equal(w.scrub.contains('english'), false, '"english" is page vocabulary');
  assert.equal(w.scrub.contains('granted'), false, 'the broker\'s own "granted" no longer fails a run');
  const view = await w.session.observe();
  assert.ok(view.items.some(i => i.name === 'Switch to english'), JSON.stringify(view.items));
  assert.doesNotThrow(() => w.scrub.assertClean({ ok: true, action: 'request', result: 'granted', view }, 'a node output'));
});

test('security N3: the scrub rule fails closed where a credential is likely (an HttpOnly or credential-named value, a random-looking one)', async () => {
  const { credentialLike } = await import('../src/capabilities/credentials.mjs');
  assert.equal(credentialLike('english', { name: 'lang' }), false);
  assert.equal(credentialLike('granted', { name: 'consent' }), false);
  assert.equal(credentialLike('english', { name: 'sid', httpOnly: true }), true, 'an HttpOnly cookie counts whatever its value looks like');
  assert.equal(credentialLike('1234567890', { name: 'session_id' }), true, 'a numeric id under a credential name counts');
  assert.equal(credentialLike('AbCdEfGhIjKlMnOpQr', { name: 'state' }), true, 'a random mixed-case string is not a word');
  assert.equal(credentialLike('x9Kq2mZ7', {}), true);
  assert.equal(credentialLike('anything', { credential: true }), true, 'a value a credential header carried');
});

test('security N6: without an allowlist, a person approves ui.act on the host\'s account of the element and the page, never on {basis, index, op}', { skip }, async t => {
  const w = await browserWorld(t, null);
  const page = await w.session.goto('/');
  const target = page.items.find(i => i.name === 'Cancel order 7');
  const member = uiMembers(w.entry).find(m => m.tool === 'act');
  assert.equal(member.effects, 'non-idempotent', 'without safeGets act is an approval-gated effect');
  const lock = { flowId: 'F', tier0: {}, members: { [member.id]: member }, nodes: { work: { bound: [], skills: [], standby: [member.id] } } };
  const host = { heldRequest: async () => null, uiCall: ({ runId, node, tool, args }) => w.sessions.describeUi({ runId, node, entry: w.entry, tool, args }) };
  const rendering = await describeCall({ host, lock, runId: w.runId, nodeKey: 'root/work__loop:0/act', decision: { tool: member.view.name, args: { basis: page.basis, index: target.i, op: 'click' } } });
  assert.deepEqual(rendering.ui?.element, { role: 'link', name: 'Cancel order 7', nth: 0 }, JSON.stringify(rendering));
  assert.equal(rendering.ui.page, '/');
  assert.match(renderCall(rendering), /Action: click on link "Cancel order 7"/);
});

// ============================ security N7: a record a ledger does not accept never swallows a real decision ============================

const PTY = `
import os, pty, re, select, sys, time
master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
seen, deadline = b'', time.time() + 20
while time.time() < deadline:
    if select.select([master], [], [], 0.2)[0]:
        seen += os.read(master, 4096)
        m = re.search(rb'Type "approve ([A-Z0-9]{6})"', seen)
        if m:
            os.write(master, b'approve ' + m.group(1) + b'\\n')
            break
time.sleep(0.5)
print('done', flush=True)
`;
async function cliApproval(subject) {
  const child = spawn('python3', ['-I', '-c', PTY], { stdio: ['ignore', 'pipe', 'inherit'] }), lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  try { const ttyPath = (await lines.next()).value; const decision = ttyPerson({ subject, summary: 'Approve this version', ttyPath }); await lines.next(); return decision; } finally { child.kill(); }
}

test('security N7: a bed\'s scripted record in the same file does not swallow a later person approval on a channel the production ledger accepts', { skip: process.platform !== 'linux' && 'pty helper is Linux-only' }, async t => {
  const dir = workspace(t), bed = openLedger(dir, { channels: ['scripted'] }), production = new NodecapLedger(dir);
  t.after(() => { bed.close(); production.close(); });
  const parts = { workflowHash: 'w', lockHash: 'l', envelopeDigest: 'e', catalogDigest: 'c', dryRunId: null };
  bed.approveLock(parts, { person: person(NodecapLedger.subject(parts), true) });
  assert.equal(production.lockApproval(parts), null, 'the scripted record does not count here');
  production.approveLock(parts, { person: await cliApproval(NodecapLedger.subject(parts)) });
  assert.equal(production.lockApproval(parts)?.channel, 'cli', 'the person\'s approval was recorded, not swallowed');
});
