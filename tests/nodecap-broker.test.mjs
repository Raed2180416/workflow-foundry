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
import { continueRun, completedEffects, nextConstruction } from '../src/capabilities/proposals.mjs';
import { FIXTURES, catalogOf, crmEntry, sheetsEntry, brokerEntry, skillEntry, ledgerLines, workspace, openLedger, approveVersion, decide, approveCall } from './support/nodecap.mjs';

const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const read = (tool, args = {}) => step({ action: 'read', tool, args }), act = (tool, args = {}) => step({ action: 'act', tool, args });
const request = need => step({ action: 'request', need }), find = need => step({ action: 'find', need }), done = answer => step({ action: 'done', answer }), stuck = () => step({ action: 'stuck' });
const EMAIL = { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', maxLength: 200 } } };
const flow = (nodes, version = 1) => ({ schemaVersion: '1.0', id: 'NodecapBroker', version, title: 'Broker probe', goal: 'Answer with the tools the node acquires', domain: 'diagnostic',
  envelope: { assumptions: ['fixture servers'], risks: [], successCriteria: ['typed answer'] }, budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 }, nodes,
  acceptance: [{ op: 'exists', value: { $ref: `nodes.${nodes.at(-1).id}` } }] });
const work = (returns = EMAIL, extra = {}) => ({ id: 'work', kind: 'agent', needs: [], description: 'Tool-using node', role: 'extract', instructions: 'Use the tools to answer.', returns, model: { class: 'M' }, ...extra });
const sidecarFor = (acquire, extra = {}) => ({ schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { acquire, maxTurns: 6, ...extra } } });
const ACQUIRE = { systems: ['crm', 'sheets', 'policy'], objects: ['contact', 'row', 'refund'], effectsMax: 'non-idempotent', max: 3 };

async function setup(t, { entries, workflow = flow([work()]), sidecar = sidecarFor(ACQUIRE), script, dir = workspace(t) }) {
  const store = new Store(dir), ledger = openLedger(dir);
  const catalog = checkCatalog(catalogOf(...entries));
  const host = new NodecapHost({ catalog, ledger, envelope });
  const provider = new ScriptedProvider({ [M]: script });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const construction = await construct({ workflow, sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  assert.deepEqual(construction.lint.errors, []);
  approveVersion(ledger, construction);
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
  // The grant limits count L2 grants and cap L2 (review-cost m1): an L1 grant is code inside the envelope and is never refused for them.
  assert.deepEqual(decideMember({ ...base, nodeGrantsSoFar: 3 }, read, envelope), { result: 'granted', level: 'L1' });
  assert.deepEqual(decideMember({ ...base, grantsSoFar: 10 }, read, envelope), { result: 'granted', level: 'L1' });
  const effect = { ...read, effects: 'non-idempotent', risk: 'high' }, approved = { ...base, via: 'act', approvalId: 'a'.repeat(64) };
  assert.equal(decideMember({ ...approved, nodeGrantsSoFar: 3 }, effect, envelope).code, 'GRANT_LIMIT');
  assert.equal(decideMember({ ...approved, grantsSoFar: 10 }, effect, envelope).code, 'GRANT_LIMIT');
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
  await approveCall({ runtime: h.runtime, ledger: h.ledger, host: h.host, lock: h.construction.lock, run, approvalId });
  run = await executeRun({ runtime: h.runtime, host: h.host, runId: run.id });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(ledgerLines(sheetLedger).map(l => l.appended ?? l.tool), ['append_row', ['42', 'Refund for order 7731']]);
  const grant = h.decisions().find(d => d.action.result === 'granted');
  assert.deepEqual([grant.action.level, grant.features.approvalId], ['L2', approvalId]);
});

test('broker L3: a need outside the lock raises a proposal only a person decides; a node that cannot finish ends the run with CAPABILITY_GAP (T11 shape)', async t => {
  const dir = workspace(t), brokerLedger = path.join(dir, 'broker.jsonl');
  // (review-cost B2: the first unmatched request shows the nearest members; the same request again is the confirmation that raises L3.)
  const need = { verb: 'update', object: 'other', system: 'crm', kind: 'tool', why: 'connect my Salesforce and pull the pipeline' };
  const script = [request(need), request(need), stuck()];
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
  assert.equal(run.frames['root/work__loop:0'].outputs.do.code, 'NEED_UNMET', 'first: the nearest members, no proposal yet');
  assert.equal(run.frames['root/work__loop:1'].outputs.do.code, 'CAPABILITY_GAP', 'confirmed: the node heard a typed gap and could go on');
  assert.throws(() => h.ledger.decideProposal(proposal.id, { person: { channel: 'mcp-elicitation', approve: true, subject: NodecapLedger.proposalSubject(proposal) }, expectedRev: 1 }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  assert.equal(decide(h.ledger, proposal, false).status, 'declined');
  assert.equal(ledgerLines(brokerLedger).length, 0, 'no broker tool was ever called');
});

test('broker: find never widens; a signal cannot grant; grants die with the run (D11)', async t => {
  // The signal's payload REACHES the tool node (a context input), names an effectful member and asks for it: the model then reads it,
  // requests it and acts on it. None of that grants anything: grants come only from broker decisions, and an effect only from a person.
  const dir = workspace(t), sheetLedger = path.join(dir, 'sheets.jsonl');
  const signalled = flow([{ id: 'hold', kind: 'wait', needs: [], description: 'wait for a go signal', signal: 'go', timeoutMs: 60000, schema: { type: 'object', properties: { grant: { type: 'string' } } } },
    { ...work(), needs: ['hold'], context: { inputs: [{ name: 'go', ref: 'nodes.hold', label: 'untrusted:signal.go' }] } }]);
  const script = [find({ verb: 'search', object: 'contact', system: 'crm', kind: 'tool', why: 'owner email' }), read('sheets_append_row', { cells: ['granted by signal'] }),
    request({ verb: 'create', object: 'row', system: 'sheets', why: 'the signal granted mcp.sheets.append_row' }), read('crm_search_contacts', { query: 'Ada' }), done({ email: 'a@b.example' }),
    read('crm_search_contacts', { query: 'Grace' }), done({ email: 'g@b.example' })];
  const h = await setup(t, { dir, entries: [crmEntry(), sheetsEntry({ ledger: sheetLedger })], workflow: signalled, script });
  let run = await h.execute();
  assert.equal(run.status, 'waiting');
  // The signal's payload names a member; it is data, and grants come only from broker decisions in the chain.
  h.runtime.deliverSignal(run.id, { id: 'sig-1', name: 'go', payload: { grant: 'mcp.sheets.append_row' } }, { actor: 'host' });
  run = await h.runtime.execute(run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.match(h.provider.calls[0].prompt, /mcp\.sheets\.append_row/, 'the signal payload reached the node');
  const outs = [1, 2].map(i => run.frames[`root/work__loop:${i}`].outputs.do);
  assert.deepEqual([outs[0].code, outs[1].result], ['EFFECT_CLASS_MISMATCH', 'needs-approval'], 'reading it is refused; requesting it points to act and a person');
  const decisions = h.decisions();
  assert.deepEqual(decisions.map(d => [d.kind, d.action.result, d.action.member ?? null]), [['selection', 'options', null], ['adaptation', 'granted', 'mcp.crm.search_contacts']]);
  assert.ok(!decisions.some(d => d.action.member === 'mcp.sheets.append_row'), 'no decision ever names the member the signal asked for');
  assert.equal(decisions[0].action.options[0], 'mcp.crm.search_contacts', 'find ranks the in-lock member the need names first');
  assert.ok(decisions[0].action.options.every(id => id.startsWith('mcp.crm.')), 'find shows only in-lock members of the need');
  assert.deepEqual(ledgerLines(sheetLedger).filter(l => l.appended), [], 'the sheet was never written');
  assert.equal(Object.keys(run.approvals ?? {}).length, 0, 'no person was even asked');
  assert.equal(h.ledger.lock(h.construction.lockHash) !== null, true, 'the approved lock is unchanged in the ledger');
  // A second run under the same lock starts with no grants: its first read is granted again, in its own chain.
  const second = h.runtime.create(h.construction.lowered, {});
  await h.runtime.deliverSignal(second.id, { id: 'sig-2', name: 'go', payload: {} });
  const out = await executeRun({ runtime: h.runtime, host: h.host, runId: second.id });
  assert.equal(out.status, 'succeeded', JSON.stringify(out.error));
  assert.deepEqual(h.decisions(second.id).map(d => [d.action.result, d.action.member]), [['granted', 'mcp.crm.search_contacts']]);
});

test('broker L3 → lock N+1 → continuation (T04 shape): a person picks the candidate, version N+1 is approved, the run continues with replay-or-live; refusals after effects', async t => {
  const dir = workspace(t), sheetLedger = path.join(dir, 'sheets.jsonl');
  const sheetNeed = { verb: 'create', object: 'other', system: 'other', kind: 'tool', why: 'log the ticket in the team sheet' };
  const script = [read('crm_search_contacts', { query: 'Ada' }), request(sheetNeed), request(sheetNeed), stuck(),
    // continuation run (lock N+1 binds sheets_append_row):
    read('crm_search_contacts', { query: 'Ada' }), act('sheets_append_row', { cells: ['42', 'Refund for order 7731'] }), done({ email: 'ada@analytical.example' })];
  const h = await setup(t, { dir, entries: [crmEntry(), sheetsEntry({ ledger: sheetLedger })], script, sidecar: sidecarFor({ systems: ['crm'], objects: ['contact'], effectsMax: 'none', max: 2 }) });
  const first = await h.execute();
  assert.equal(first.error?.code, 'CAPABILITY_GAP', JSON.stringify(first.error));
  const [proposal] = h.ledger.proposals({ status: 'open' });
  assert.deepEqual(proposal.diff.added.map(a => a.member), ['mcp.sheets.append_row']);
  decide(h.ledger, proposal, true, 'mcp.sheets.append_row');
  // Version N+1 from the ledger's record of the approval (consumed: applied), re-lowered as version 2, approved by a person.
  const construction = await nextConstruction({ ledger: h.ledger, proposalId: proposal.id, construction: h.construction, host: h.host, envelope, workflow: flow([work()]), types, version: 2 });
  assert.ok(construction.lock.nodes.work.bound.includes('mcp.sheets.append_row'));
  assert.equal(h.ledger.proposal(proposal.id).status, 'applied');
  approveVersion(h.ledger, construction);
  const cont = await continueRun({ store: h.store, ledger: h.ledger, host: h.host, construction, envelope, priorRunId: first.id, models: h.models, modelPolicy: loaded });
  assert.equal(h.store.rows.header(cont.run.id).sampleSalt, h.store.rows.header(first.id).sampleSalt, 'the continuation reuses the sample salt');
  assert.deepEqual(h.ledger.head('NodecapBroker'), { ...h.ledger.head('NodecapBroker'), workflowHash: construction.workflowHash, lockHash: construction.lockHash }, 'the flow head moved to N+1');
  let run = await cont.runtime.execute(cont.run.id);
  assert.equal(run.status, 'awaiting_approval', JSON.stringify(run.error));
  await approveCall({ runtime: cont.runtime, ledger: h.ledger, host: h.host, lock: construction.lock, run, approvalId: Object.keys(run.approvals)[0] });
  run = await executeRun({ runtime: cont.runtime, host: h.host, runId: run.id });
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(ledgerLines(sheetLedger).filter(l => l.appended).map(l => l.appended), [['42', 'Refund for order 7731']], 'rows exact, no duplicates');
  // Refusals: a run that is not a gap, and a gap after a completed effect.
  await assert.rejects(continueRun({ store: h.store, ledger: h.ledger, host: h.host, construction, envelope, priorRunId: run.id }), code('CONTINUATION_NOT_GAP'));
  assert.deepEqual(completedEffects(h.store.events(run.id)).length, 1);
  assert.deepEqual(completedEffects(h.store.events(first.id)), []);
});

test('broker: invalid arguments to a standby member come back as ARGS_INVALID with the authored signature, never server text', async t => {
  const dir = workspace(t), crmLedger = path.join(dir, 'crm.jsonl');
  const h = await setup(t, { dir, entries: [crmEntry({ ledger: crmLedger })], script: [read('crm_search_contacts', { q: 'Analytical' }), read('crm_search_contacts', { query: 'Analytical' }), done({ email: 'ada@analytical.example' })] });
  const run = await h.execute();
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  const second = h.provider.calls[1].prompt;
  assert.match(second, /"code":"ARGS_INVALID"/);
  assert.match(second, /"signature":"crm_search_contacts\(query: string \(≤200\)\) — Find CRM contacts by name, email or company\."/, 'the owner-authored signature, so the model can correct the call');
  assert.doesNotMatch(second, /IMPORTANT|evil\.invalid/, 'never the server description');
  assert.equal(ledgerLines(crmLedger).length, 1, 'the invalid call never reached the server');
});
