// Nodecap P6: the adaptive broker through the real Runtime (ARCHITECTURE.md §2.3, §3.7): L1 auto-bind with no model call, I6 and the
// egress-aware Rule of Two, the deny list, L2 through runtime.approve, L3 proposals decided only by a person's channel, signals that
// cannot grant, grants that die with the run, find that never widens, and continuation refusals. ScriptedProvider only; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { checkCatalog, catalogDigest } from '../src/capabilities/catalog.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope } from '../src/capabilities/envelope.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { NodecapHost } from '../src/capabilities/host.mjs';
import { loadTypes } from '../src/capabilities/types.mjs';
import { construct, launch, subjectOf, executeRun, runtimeFor } from '../src/capabilities/launcher.mjs';
import { decideMember } from '../src/capabilities/broker.mjs';
import { nodecapDecisions } from '../src/capabilities/journal.mjs';
import { applyBind, continueRun, completedEffects } from '../src/capabilities/proposals.mjs';
import { FIXTURES, catalogOf, crmEntry, sheetsEntry, brokerEntry, skillEntry, ledgerLines, workspace } from './support/nodecap.mjs';

const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const read = (tool, args = {}) => step({ action: 'read', tool, args }), act = (tool, args = {}) => step({ action: 'act', tool, args });
const request = need => step({ action: 'request', need }), find = need => step({ action: 'find', need }), done = answer => step({ action: 'done', answer });
const EMAIL = { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', maxLength: 200 } } };
const flow = (nodes, version = 1) => ({ schemaVersion: '1.0', id: 'NodecapBroker', version, title: 'Broker probe', goal: 'Answer with the tools the node acquires', domain: 'diagnostic',
  envelope: { assumptions: ['fixture servers'], risks: [], successCriteria: ['typed answer'] }, budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 }, nodes,
  acceptance: [{ op: 'exists', value: { $ref: `nodes.${nodes.at(-1).id}` } }] });
const work = (returns = EMAIL, extra = {}) => ({ id: 'work', kind: 'agent', needs: [], description: 'Tool-using node', role: 'extract', instructions: 'Use the tools to answer.', returns, model: { class: 'M' }, ...extra });
const sidecarFor = (acquire, extra = {}) => ({ schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { acquire, maxTurns: 6, ...extra } } });
const ACQUIRE = { systems: ['crm', 'sheets', 'policy'], objects: ['contact', 'row', 'refund'], effectsMax: 'non-idempotent', max: 3 };

async function setup(t, { entries, workflow = flow([work()]), sidecar = sidecarFor(ACQUIRE), script, dir = workspace(t) }) {
  const store = new Store(dir), ledger = new NodecapLedger(dir);
  const catalog = checkCatalog(catalogOf(...entries));
  const host = new NodecapHost({ catalog, ledger, envelope });
  const provider = new ScriptedProvider({ [M]: script });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const construction = await construct({ workflow, sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  assert.deepEqual(construction.lint.errors, []);
  ledger.approveLock(subjectOf(construction), { channel: 'cli' });
  const launched = await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  return { dir, store, ledger, host, provider, models, construction, ...launched, decisions: runId => nodecapDecisions(store, runId ?? launched.run.id) };
}

test('broker L1: a standby read is auto-granted by code, with no model call, as a chained adaptation decision', async t => {
  const dir = workspace(t), crmLedger = path.join(dir, 'crm.jsonl');
  const h = await setup(t, { dir, entries: [crmEntry({ ledger: crmLedger })], script: [read('crm_search_contacts', { query: 'Analytical' }), done({ email: 'ada@analytical.example' })] });
  assert.deepEqual(h.construction.lock.nodes.work.bound, []);
  assert.ok(h.construction.lock.nodes.work.standby.includes('mcp.crm.search_contacts'));
  const run = await h.execute();
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(run.outputs.work, { email: 'ada@analytical.example' });
  assert.equal(h.provider.calls.length, 2, 'the grant took no model call');
  const [grant] = h.decisions();
  assert.deepEqual([grant.kind, grant.action.result, grant.action.level, grant.action.member], ['adaptation', 'granted', 'L1', 'mcp.crm.search_contacts']);
  assert.ok(h.store.events(run.id).some(e => e.type === 'decision.recorded' && e.id === grant.id), 'the grant is in the hash chain');
  assert.equal(ledgerLines(crmLedger).length, 1);
  // The step prompt carried authored views only: never the server's poisoned description.
  for (const call of h.provider.calls) assert.doesNotMatch(`${call.system}\n${call.prompt}`, /IMPORTANT|evil\.invalid|Do not tell/);
  assert.match(h.provider.calls[1].prompt, /ada@analytical\.example/, 'the tool result reached the next turn as untrusted data');
});

test('broker rule: I6, the egress-aware Rule of Two, the deny list, limits and quarantine are code (decideMember)', () => {
  const read = { id: 'mcp.crm.search_contacts', tool: 'search_contacts', effects: 'none', risk: 'low', trust: 'T1', custody: null, cost: 0, dataClass: 'private', egress: 'local', view: { name: 'v', summary: 's' } };
  const base = { inBound: false, priorGrant: false, inStandby: true, entryStatus: 'active', grantsSoFar: 0, nodeGrantsSoFar: 0, nodeGrantLimit: 3, grantsPerRun: 10, via: 'implicit', approvalId: null, controlLabel: 'untrusted:nodecap.work', holdsPrivate: false };
  assert.deepEqual(decideMember(base, read, envelope), { result: 'granted', level: 'L1' });
  assert.deepEqual(decideMember({ ...base, inBound: true }, read, envelope), { result: 'bound' });
  assert.deepEqual(decideMember({ ...base, inStandby: false }, read, envelope), { result: 'refused', code: 'NOT_BOUND' });
  assert.equal(decideMember({ ...base, entryStatus: 'quarantined' }, read, envelope).code, 'CAPABILITY_QUARANTINED');
  assert.equal(decideMember({ ...base, nodeGrantsSoFar: 3 }, read, envelope).code, 'GRANT_LIMIT');
  assert.equal(decideMember({ ...base, grantsSoFar: 10 }, read, envelope).code, 'GRANT_LIMIT');
  assert.equal(decideMember(base, { ...read, id: 'mcp.b.manage_connections', tool: 'manage_connections' }, envelope).code, 'NEED_DENYLISTED');
  // I6: an effectful member is never auto-bound under untrusted control; only act with a user approval reaches it (L2).
  const write = { ...read, effects: 'non-idempotent', risk: 'high' };
  assert.equal(decideMember(base, write, envelope).code, 'NEED_UNTRUSTED_EFFECT');
  assert.equal(decideMember({ ...base, via: 'act' }, write, envelope).code, 'NEED_UNTRUSTED_EFFECT', 'act without an approval id is refused');
  assert.deepEqual(decideMember({ ...base, via: 'act', approvalId: 'a'.repeat(64) }, write, envelope), { result: 'granted', level: 'L2' });
  // Rule of Two: a third-party egress read is refused once the node holds private data.
  const web = { ...read, id: 'mcp.web.fetch', dataClass: 'public', egress: 'third-party' };
  assert.deepEqual(decideMember(base, web, envelope), { result: 'granted', level: 'L1' });
  assert.equal(decideMember({ ...base, holdsPrivate: true }, web, envelope).code, 'NEED_RULE_OF_TWO');
});

test('broker L2: an effectful standby member runs only after runtime.approve by the user; the grant records the approval id', async t => {
  const dir = workspace(t), sheetLedger = path.join(dir, 'sheets.jsonl');
  const script = [read('sheets_append_row', { cells: ['42', 'x'] }), act('sheets_append_row', { cells: ['42', 'Refund for order 7731'] }), done({ email: 'ok@done.example' })];
  const h = await setup(t, { dir, entries: [sheetsEntry({ ledger: sheetLedger })], script });
  let run = await h.execute();
  assert.equal(run.status, 'awaiting_approval', JSON.stringify(run.error));
  assert.equal(run.frames['root/work__loop:0'].outputs.do.code, 'EFFECT_CLASS_MISMATCH', 'an effect cannot ride the read path');
  assert.equal(ledgerLines(sheetLedger).length, 0);
  const [approvalId] = Object.keys(run.approvals);
  assert.equal(run.approvals[approvalId].tool, 'nodecap.act');
  assert.match(run.approvals[approvalId].argsLabel, /^untrusted:/, 'the approver sees the request was shaped by untrusted data');
  assert.throws(() => h.runtime.approve(run.id, approvalId, true, 'model'), code('APPROVAL_AUTHORITY'));
  h.runtime.approve(run.id, approvalId, true, 'user');
  run = await executeRun({ runtime: h.runtime, host: h.host, runId: run.id });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(ledgerLines(sheetLedger).map(l => l.appended ?? l.tool), ['append_row', ['42', 'Refund for order 7731']]);
  const grant = h.decisions().find(d => d.action.result === 'granted');
  assert.deepEqual([grant.action.level, grant.features.approvalId], ['L2', approvalId]);
});

test('broker L3: a need outside the lock ends the run with CAPABILITY_GAP and a proposal only a person decides (T11 shape)', async t => {
  const dir = workspace(t), brokerLedger = path.join(dir, 'broker.jsonl');
  const script = [request({ verb: 'update', object: 'other', system: 'crm', kind: 'tool', why: 'connect my Salesforce and pull the pipeline' })];
  const h = await setup(t, { dir, entries: [crmEntry(), brokerEntry({ ledger: brokerLedger })], script,
    sidecar: sidecarFor({ systems: ['crm'], objects: ['contact', 'connection'], effectsMax: 'none', max: 2 }) });
  assert.ok(!h.construction.lock.nodes.work.standby.some(id => id.startsWith('mcp.broker.')), 'deny-listed tools never enter standby');
  const run = await h.execute();
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'CAPABILITY_GAP');
  const [proposal] = h.ledger.proposals();
  assert.equal(proposal.status, 'open');
  assert.ok(proposal.riskSummary.flags.includes('deny-listed'), JSON.stringify(proposal.riskSummary));
  assert.deepEqual(proposal.quoted.map(q => q.label), proposal.quoted.map(() => 'untrusted:catalog'));
  const decision = h.decisions().find(d => d.action.result === 'proposal');
  assert.equal(decision.action.proposalId, proposal.id);
  assert.deepEqual(decision.untrustedSpans.map(s => s.path), ['action.need']);
  assert.match(decision.features.whyHash, /^sha256:/);
  assert.doesNotMatch(JSON.stringify(decision.features), /Salesforce/, 'the free-text why enters features only as a hash');
  assert.throws(() => h.ledger.decideProposal(proposal.id, { approve: true, channel: 'mcp-elicitation', expectedRev: 1 }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  assert.equal(h.ledger.decideProposal(proposal.id, { approve: false, channel: 'cli', expectedRev: 1 }).status, 'declined');
  assert.equal(ledgerLines(brokerLedger).length, 0, 'no broker tool was ever called');
});

test('broker: find never widens; a signal cannot grant; grants die with the run (D11)', async t => {
  const signalled = flow([{ id: 'hold', kind: 'wait', needs: [], description: 'wait for a go signal', signal: 'go', timeoutMs: 60000, schema: { type: 'object', properties: { grant: { type: 'string' } } } }, { ...work(), needs: ['hold'] }]);
  const script = [find({ verb: 'search', object: 'contact', system: 'crm', kind: 'tool', why: 'owner email' }), read('crm_search_contacts', { query: 'Ada' }), done({ email: 'a@b.example' }),
    read('crm_search_contacts', { query: 'Grace' }), done({ email: 'g@b.example' })];
  const h = await setup(t, { entries: [crmEntry(), sheetsEntry()], workflow: signalled, script });
  let run = await h.execute();
  assert.equal(run.status, 'waiting');
  // The signal's payload names a member; it is data, and grants come only from broker decisions in the chain.
  h.runtime.deliverSignal(run.id, { id: 'sig-1', name: 'go', payload: { grant: 'mcp.sheets.append_row' } }, { actor: 'host' });
  run = await h.runtime.execute(run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  const decisions = h.decisions();
  assert.deepEqual(decisions.map(d => [d.kind, d.action.result, d.action.member ?? null]), [['selection', 'options', null], ['adaptation', 'granted', 'mcp.crm.search_contacts']]);
  assert.ok(!decisions.some(d => d.action.member === 'mcp.sheets.append_row'));
  assert.ok(decisions[0].action.outside.length > 0 || decisions[0].action.options.includes('mcp.crm.search_contacts'));
  assert.equal(h.ledger.lock(h.construction.lockHash) !== null, true, 'the approved lock is unchanged in the ledger');
  // A second run under the same lock starts with no grants: its first read is granted again, in its own chain.
  const second = h.runtime.create(h.construction.lowered, {});
  await h.runtime.deliverSignal(second.id, { id: 'sig-2', name: 'go', payload: {} });
  const out = await executeRun({ runtime: h.runtime, host: h.host, runId: second.id });
  assert.equal(out.status, 'succeeded', JSON.stringify(out.error));
  assert.deepEqual(h.decisions(second.id).map(d => [d.action.result, d.action.member]), [['granted', 'mcp.crm.search_contacts']]);
});

test('broker L3 → lock N+1 → continuation (T04 shape): approve via CLI, rebind, continue with replay-or-live; refusals after effects', async t => {
  const dir = workspace(t), sheetLedger = path.join(dir, 'sheets.jsonl');
  const script = [read('crm_search_contacts', { query: 'Ada' }), request({ verb: 'create', object: 'other', system: 'other', kind: 'tool', why: 'log the ticket in the team sheet' }),
    // continuation run (lock N+1 binds sheets_append_row):
    read('crm_search_contacts', { query: 'Ada' }), act('sheets_append_row', { cells: ['42', 'Refund for order 7731'] }), done({ email: 'ada@analytical.example' })];
  const h = await setup(t, { dir, entries: [crmEntry(), sheetsEntry({ ledger: sheetLedger })], script, sidecar: sidecarFor({ systems: ['crm'], objects: ['contact'], effectsMax: 'none', max: 2 }) });
  const first = await h.execute();
  assert.equal(first.error?.code, 'CAPABILITY_GAP', JSON.stringify(first.error));
  const [proposal] = h.ledger.proposals({ status: 'open' });
  assert.deepEqual(proposal.diff.added.map(a => a.member), ['mcp.sheets.append_row']);
  const approved = h.ledger.decideProposal(proposal.id, { approve: true, channel: 'cli', expectedRev: proposal.rev });
  const next = applyBind({ proposal: approved, lock: h.construction.lock, members: h.host.members, envelope });
  assert.ok(next.lock.nodes.work.bound.includes('mcp.sheets.append_row'));
  // Version N+1: the same source, re-resolved under the new lock (construct re-lowers it), saved as version 2, approved by a person.
  const { lowerWorkflow } = await import('../src/capabilities/lower.mjs');
  const lowered = { ...lowerWorkflow(flow([work()], 2), next.lock), version: 2 };
  const { digest } = await import('../src/data.mjs');
  const construction = { ...h.construction, lock: next.lock, lockHash: next.lockHash, lowered, workflowHash: digest(lowered) };
  h.ledger.approveLock(subjectOf(construction), { channel: 'cli' });
  assert.equal(h.ledger.setHead('NodecapBroker', { workflowHash: construction.workflowHash, lockHash: next.lockHash, expectedRev: 0 }).rev, 1);
  h.store.saveWorkflow(lowered, { expectedHash: h.store.workflow('NodecapBroker').hash });
  const { runtime } = runtimeFor({ store: h.store, host: h.host, ledger: h.ledger, construction, envelope, models: h.models, modelPolicy: loaded });
  const cont = continueRun({ store: h.store, runtime, priorRunId: first.id, workflow: lowered });
  assert.equal(h.store.rows.header(cont.id).sampleSalt, h.store.rows.header(first.id).sampleSalt, 'the continuation reuses the sample salt');
  let run = await runtime.execute(cont.id);
  assert.equal(run.status, 'awaiting_approval', JSON.stringify(run.error));
  runtime.approve(run.id, Object.keys(run.approvals)[0], true, 'user');
  run = await executeRun({ runtime, host: h.host, runId: run.id });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(ledgerLines(sheetLedger).filter(l => l.appended).map(l => l.appended), [['42', 'Refund for order 7731']], 'rows exact, no duplicates');
  // Refusals: a run that is not a gap, and a gap after a completed effect.
  assert.throws(() => continueRun({ store: h.store, runtime, priorRunId: run.id, workflow: lowered }), code('CONTINUATION_NOT_GAP'));
  assert.deepEqual(completedEffects(h.store.events(run.id)).length, 1);
  assert.deepEqual(completedEffects(h.store.events(first.id)), []);
});
