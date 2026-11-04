// Fixes of the 2026-10-22 review "cost and cheap-model fit" (research/nodecap-20261021/ARCHITECTURE.md §10): one or more tests per fixed
// finding, each asserting what happened (a grant, a proposal, a person asked, a turn spent, a value in the prompt or the report), so that it
// fails on the pre-fix code (0438b9c3) by an assertion. New exports are imported inside the tests that need them, so a missing export fails
// one test, not the file. ScriptedProvider and loopback fixtures only; $0.
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
import { NodecapHost } from '../src/capabilities/host.mjs';
import { loadTypes } from '../src/capabilities/types.mjs';
import { construct, launch } from '../src/capabilities/launcher.mjs';
import { nodecapDecisions } from '../src/capabilities/journal.mjs';
import { memberRecord } from '../src/capabilities/members.mjs';
import { uiMembers } from '../src/capabilities/cua.mjs';
import { resolve } from '../src/capabilities/resolve.mjs';
import { lint } from '../src/capabilities/lint.mjs';
import { FIXTURES, catalogOf, crmEntry, sheetsEntry, workspace, openLedger, approveVersion } from './support/nodecap.mjs';

const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id;
const envelope = checkEnvelope(DEFAULT_ENVELOPE), types = loadTypes(path.join(FIXTURES, 'types.json'));
const step = value => ({ value: { tool: 'none', args: {}, ...value } });
const read = (tool, args = {}) => step({ action: 'read', tool, args });
const request = (need, tool = 'none') => step({ action: 'request', tool, need }), find = need => step({ action: 'find', need });
const done = answer => step({ action: 'done', answer }), stuck = () => step({ action: 'stuck' });
const EMAIL = { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', maxLength: 200 } } };
const flow = nodes => ({ schemaVersion: '1.0', id: 'NodecapCost', version: 1, title: 'Cost probe', goal: 'Answer with the tools the node acquires', domain: 'diagnostic',
  envelope: { assumptions: ['fixture servers'], risks: [], successCriteria: ['typed answer'] }, budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 }, nodes,
  acceptance: [{ op: 'exists', value: { $ref: `nodes.${nodes.at(-1).id}` } }] });
const work = () => ({ id: 'work', kind: 'agent', needs: [], description: 'Tool-using node', role: 'extract', instructions: 'Use the tools to answer.', returns: EMAIL, model: { class: 'M' } });
const sidecarFor = (acquire, extra = {}) => ({ schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { ...(acquire ? { acquire } : {}), maxTurns: 6, ...extra } } });
const CRM = { systems: ['crm'], objects: ['contact', 'deal'], effectsMax: 'idempotent', max: 2 };
const SHEETS = { systems: ['sheets'], objects: ['row'], effectsMax: 'non-idempotent', max: 2 };

async function setup(t, { entries, sidecar, script }) {
  const dir = workspace(t), store = new Store(dir), ledger = openLedger(dir);
  const catalog = checkCatalog(catalogOf(...entries));
  const host = new NodecapHost({ catalog, ledger, envelope });
  const provider = new ScriptedProvider({ [M]: script });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const construction = await construct({ workflow: flow([work()]), sidecar, host, envelope, types, catalogDigest: catalogDigest(catalog) });
  assert.deepEqual(construction.lint.errors, []);
  approveVersion(ledger, construction);
  const launched = await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  const run = await launched.execute();
  return { store, ledger, host, provider, construction, run, decisions: () => nodecapDecisions(store, run.id) };
}
const turn = (run, i) => run.frames[`root/work__loop:${i}`]?.outputs ?? {};
const grants = h => h.decisions().filter(d => d.action.result === 'granted').map(d => d.action.member);

// ================================== B1: a request hands out the tool asked for, never another one ==================================

test('B1: a request that names a tool asks for exactly that tool (an effect answers needs-approval), never a better-scoring read', async t => {
  // The NC-1 T06 shape: the decision named tickets_set_label; the pre-fix broker ignored the name and handed out a read.
  const h = await setup(t, { entries: [sheetsEntry()], sidecar: sidecarFor(SHEETS),
    script: [request({ verb: 'read', object: 'row', system: 'sheets', why: 'the team sheet' }, 'sheets_append_row'), stuck()] });
  const out = turn(h.run, 0).do;
  assert.deepEqual([out.result, out.tool], ['needs-approval', 'sheets_append_row'], JSON.stringify(out));
  assert.deepEqual(grants(h), [], 'no read was granted in its place');
});

test('B1: with no effect class in the need, the top match decides: a comment-shaped need never grants the read that is left', async t => {
  // The NC-1 T02 shape: the need described an effect with a verb that names no class; the pre-fix rule filtered to reads and granted one.
  const h = await setup(t, { entries: [sheetsEntry()], sidecar: sidecarFor(SHEETS),
    script: [request({ verb: 'transform', object: 'row', system: 'sheets', why: 'append one row to the team sheet' }), stuck()] });
  const out = turn(h.run, 0).do;
  assert.deepEqual([out.result, out.tool], ['needs-approval', 'sheets_append_row'], JSON.stringify(out));
  assert.deepEqual(grants(h), [], 'sheets_read_range was not granted');
});

// ====================== B2: a mistyped need never ends the node; find and request need a need; L3 is confirmed ======================

test('B2: find without a need is refused with an example of where the need goes (never answered with every member)', async t => {
  // The NC-1 Haiku run put its need as a string inside args (T08 turn 2, T09 turn 6); it was accepted and ignored.
  const h = await setup(t, { entries: [crmEntry()], sidecar: sidecarFor(CRM), script: [step({ action: 'find', args: { need: 'a tool to read deals' } }), stuck()] });
  const out = turn(h.run, 0).do;
  assert.equal(out.code, 'NEED_REQUIRED', JSON.stringify(out));
  assert.equal(out.matches, undefined, 'no member list');
  assert.equal(typeof out.example?.need?.verb, 'string', JSON.stringify(out));
  assert.deepEqual(h.decisions().filter(d => d.kind === 'selection'), [], 'no find was recorded');
});

test('B2: object and system rank, never filter: a need with system "other" still reaches the in-lock member it describes (no gap, no proposal)', async t => {
  const h = await setup(t, { entries: [crmEntry()], sidecar: sidecarFor(CRM),
    script: [request({ verb: 'search', object: 'contact', system: 'other', why: 'find the Analytical Engines contact and its email' }), stuck()] });
  const out = turn(h.run, 0).do;
  assert.notEqual(out.code, 'CAPABILITY_GAP', JSON.stringify(out));
  assert.deepEqual([out.result, out.tool], ['granted', 'crm_search_contacts'], JSON.stringify(out));
  assert.deepEqual(h.ledger.proposals(), [], 'no proposal for a capability the node already had');
});

test('B2: a need nothing in reach matches first answers NEED_UNMET with the nearest members; only the same request again asks a person', async t => {
  const need = { verb: 'create', object: 'other', system: 'other', kind: 'tool', why: 'append a row to the team sheet' };
  const h = await setup(t, { entries: [crmEntry(), sheetsEntry()], sidecar: sidecarFor(CRM),
    script: [request(need), read('crm_search_contacts', { query: 'Ada' }), done({ email: 'ada@analytical.example' })] });
  assert.equal(h.run.status, 'succeeded', JSON.stringify(h.run.error));
  const out = turn(h.run, 0).do;
  assert.equal(out.code, 'NEED_UNMET', JSON.stringify(out));
  assert.ok(out.nearest.length >= 1 && out.nearest.every(v => typeof v === 'string' && v.includes('(')), 'the nearest members as authored views');
  assert.deepEqual(h.ledger.proposals(), [], 'a person was not asked about a need the node did not confirm');
});

// ================================== M2: no view is named like a protocol action ==================================

test('M2: computer-use views are not named like protocol actions, and lint refuses a view that is', () => {
  const entry = { id: 'stockroom-ui', kind: 'cua', trust: 'T0', status: 'active', source: { backend: 'playwright-local', origins: ['http://127.0.0.1:9'], profile: 'S0', safeGets: ['/'] } };
  const names = uiMembers(entry).map(m => m.view.name);
  for (const n of names) assert.ok(!['read', 'act', 'find', 'request', 'done', 'stuck'].includes(n.split('_').at(-1)), `${n} collides with a protocol action`);
  const bad = memberRecord({ entry: { id: 'books', kind: 'mcp-stdio', trust: 'T1' }, name: 'act', adapter: 'test/1', pins: {}, attestation: { type: 'contact.search', system: 'books', verbs: ['search'], objects: ['contact'],
    effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.books', dataClass: 'internal', egress: 'local', view: { name: 'books_act', summary: 'Search books.', inputSchema: { type: 'object' } } } });
  const workflow = flow([work()]), sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { requires: [{ as: 'b', type: 'contact.search' }], maxTurns: 4 } } };
  const { lock } = resolve({ workflow, sidecar, members: [bad], catalogDigest: 'sha256:c', envelope, envelopeDigest: 'sha256:e', types });
  assert.ok(lint({ workflow, lock, envelope, types }).errors.some(f => f.code === 'VIEW_NAME_PROTOCOL'), 'a view named x_act is refused before launch');
});

// ================================== M3: standby members as full views; no member the task cannot use ==================================

test('M3: a standby member is shown with its argument signature and its [effect] mark', async t => {
  const h = await setup(t, { entries: [crmEntry()], sidecar: sidecarFor(CRM), script: [stuck()] });
  const [call] = h.provider.calls, seen = `${call.system}\n${call.prompt}`;
  assert.match(seen, /crm_search_contacts\(query: string \(≤200\)\) — Find CRM contacts/, 'the signature of a standby read');
  assert.match(seen, /crm_update_contact\(id: string \(≤40\), field: one of "email"\|"owner", value: string \(≤200\)\) — [^\n]*\[effect: needs approval\]/, 'the signature and effect mark of a standby effect');
});

test('M3: the computer-use trace export and assert never enter a tool node\'s standby', () => {
  const entry = { id: 'app', kind: 'cua', trust: 'T0', status: 'active', source: { backend: 'playwright-local', origins: ['http://127.0.0.1:9'], profile: 'S0', safeGets: ['/'] } };
  const workflow = flow([work()]), sidecar = sidecarFor({ systems: ['app'], objects: ['page'], effectsMax: 'non-idempotent', max: 6 });
  const { lock } = resolve({ workflow, sidecar, members: uiMembers(entry), catalogDigest: 'sha256:c', envelope, envelopeDigest: 'sha256:e', types });
  assert.deepEqual(lock.nodes.work.standby.filter(id => /\.(assert|trace\.export)$/.test(id)), []);
  assert.ok(lock.nodes.work.standby.includes('ui.app.extract') && lock.nodes.work.standby.includes('ui.app.commit'));
});

// ================================== M4: a repeated refusal ends the node; the need is in the transcript ==================================

test('M4: the same call refused a third time ends the node as stuck (REPEATED_REFUSAL) instead of spending its turns; the second gets a hint', async t => {
  const bad = read('crm_search_contacts', { q: 'Analytical' });
  const h = await setup(t, { entries: [crmEntry()], sidecar: sidecarFor(CRM), script: [bad, bad, bad, bad, bad, done({ email: 'x@y.example' })] });
  assert.equal(h.provider.calls.length, 3, 'three model calls, not six');
  assert.equal(h.run.status, 'failed');
  assert.equal(h.run.error.code, 'NODE_STUCK');
  assert.match(h.run.error.message, /REPEATED_REFUSAL/);
  assert.match(h.provider.calls[2].prompt, /"repeat":\{"count":2,"hint":"This exact call was refused before/, 'the second refusal carried a hint to the next turn');
});

test('M4: the transcript keeps the need of a find or request (the record a selection failure needs)', async t => {
  const h = await setup(t, { entries: [crmEntry()], sidecar: sidecarFor(CRM), script: [find({ verb: 'search', object: 'contact', why: 'zz-why-marker' }), stuck()] });
  assert.match(h.provider.calls[1].prompt, /"need":\{[^}]*"why":"zz-why-marker"/);
});

// ================================== M5: the static tool sections are a cacheable prefix ==================================

test('M5: tools, standby and the protocol sit in the system prompt, identical on every turn; the per-turn prompt carries the transcript only', async t => {
  const h = await setup(t, { entries: [crmEntry()], sidecar: sidecarFor(CRM, { requires: [{ as: 'deals', type: 'deal.list' }] }),
    script: [read('crm_search_contacts', { query: 'Ada' }), read('crm_get_contact', { id: 'c-1' }), done({ email: 'ada@analytical.example' })] });
  assert.equal(h.run.status, 'succeeded', JSON.stringify(h.run.error));
  const systems = new Set(h.provider.calls.map(c => c.system));
  assert.equal(systems.size, 1, 'one system prompt for every turn of the node');
  const [system] = systems;
  for (const view of ['crm_list_deals(page?: integer)', 'crm_search_contacts(query: string', 'Tool protocol (Foundry)']) assert.ok(system.includes(view), view);
  for (const call of h.provider.calls) assert.doesNotMatch(call.prompt, /crm_search_contacts\(query|Tool protocol/, 'no static tool text in the per-turn prompt');
});

// ================================== m1: L1 grants do not spend acquire.max ==================================

test('m1: an L1 read the model did not need does not spend the node\'s grant limit (acquire.max 1, two reads)', async t => {
  const h = await setup(t, { entries: [crmEntry()], sidecar: sidecarFor({ ...CRM, max: 1 }),
    script: [read('crm_get_contact', { id: 'c-1' }), read('crm_search_contacts', { query: 'Ada' }), done({ email: 'ada@analytical.example' })] });
  assert.equal(h.run.status, 'succeeded', JSON.stringify(h.run.error));
  assert.equal(turn(h.run, 1).do.ok, true, JSON.stringify(turn(h.run, 1).do));
  assert.deepEqual(grants(h), ['mcp.crm.get_contact', 'mcp.crm.search_contacts']);
});

// ================================== m3: no need field where find and request do not exist ==================================

test('m3: a node that can neither find nor request has no need field in its decision schema', async t => {
  const h = await setup(t, { entries: [crmEntry()], sidecar: sidecarFor(null, { requires: [{ as: 'search', type: 'contact.search' }] }), script: [stuck()] });
  const schema = h.provider.calls[0].schema;
  assert.deepEqual(schema.properties.action.enum.filter(a => a === 'find' || a === 'request'), []);
  assert.equal(schema.properties.need, undefined);
});

// ================================== M6, M7, m7: the records and measures a cost reading needs ==================================

test('M6/M7/m7: an episode keeps per-call usage, output length and latency, the decisions with their needs, and the tool context with schema and protocol', { timeout: 120000 }, async () => {
  const { TASKS } = await import('../experiments/nodecap/bed/tasks.mjs');
  const { runEpisode } = await import('../experiments/nodecap/bed/episode.mjs');
  const row = await runEpisode({ task: TASKS.find(x => x.id === 'T01'), arm: 'A' });
  assert.equal(row.success, true, JSON.stringify(row));
  assert.equal(row.calls?.length, row.turns, 'one record per model call');
  assert.ok(row.calls.every(c => typeof c.outputChars === 'number' && c.outputChars > 0 && typeof c.latencyMs === 'number'));
  assert.ok(row.toolContextTokens - row.toolDefTokens >= 250, `the decision schema and protocol are counted: ${row.toolContextTokens} vs ${row.toolDefTokens}`);
  assert.ok(row.decisions?.some(d => d.result === 'granted' && d.member === 'mcp.crm.search_contacts' && d.level === 'L1'), JSON.stringify(row.decisions));
  assert.deepEqual([typeof row.modelMs, typeof row.constructMs], ['number', 'number']);
  assert.equal(row.grantsInGold, 1);
});

test('M6/M7: the analysis reports calls and dollars per success, a cache-correct estimate for prefix-less rows, and grant precision over every grant', async () => {
  const { armTable } = await import('../experiments/nodecap/bed/analyze.mjs');
  const row = (task, success, extra) => ({ task, arm: 'B', success, status: success ? 'succeeded' : 'failed', used: [], proposals: [], exposed: 40, promptTokens: 1, ...extra });
  // Two B episodes recorded with the tool block in the user prompt: 3 calls, 1 run, 4,000 static tokens, $0.01 each.
  const B = armTable([row('T01', true, { turns: 3, runs: 1, toolDefTokens: 4000, cost: { usd: 0.01, calls: 3 } }), row('T03', false, { turns: 3, runs: 1, toolDefTokens: 4000, cost: { usd: 0.01, calls: 3 } })]).B;
  assert.equal(B.callsPerSuccess, 6);
  assert.equal(B.callsPerSuccessfulEpisode, 3);
  // (3 - 1) later calls x 4,000 tokens x (1.25 - 0.1) x $0.10/MTok = $0.00092 saved per episode.
  assert.equal(B.costCacheCorrectUsd, 0.01816);
  const A = armTable([{ task: 'T02', arm: 'A', success: false, status: 'failed', used: [], proposals: [], turns: 12, exposed: 4, promptTokens: 1, toolDefTokens: 57,
    grants: ['L1:mcp.tickets.search_tickets'], cost: { usd: 0.0046, calls: 12 } }]).A;
  assert.equal(A.grantPrecision, 0, 'a wrong grant counts although its member was never called');
});

test('M7: the selection development split answers every case without a server, and the current thresholds grant nothing wrong on the NC-1 Haiku shapes', async () => {
  const { score, CASES } = await import('../experiments/nodecap/bed/selection-dev.mjs');
  const { THRESHOLDS } = await import('../src/capabilities/broker.mjs');
  const s = score(THRESHOLDS);
  assert.equal(s.cases, CASES.length);
  // The T02 and T06 shapes the paid run granted wrongly (search_tickets for a comment or a label need) now point at the effect.
  for (const c of s.misses) assert.ok(!['T02', 'T06'].includes(c.task), JSON.stringify(c));
  assert.ok(s.exact >= 23, JSON.stringify(s.misses));
  assert.ok(s.wrongGrants <= 1, JSON.stringify(s.misses));
});

// ================================== M8: arm S, the static baseline ==================================

test('M8: arm S (the same lock, acquire clause static: no find, standby listed with the tools) solves T04 through its L3 continuation', { timeout: 120000 }, async () => {
  const { TASKS } = await import('../experiments/nodecap/bed/tasks.mjs');
  const { runEpisode } = await import('../experiments/nodecap/bed/episode.mjs');
  const S = await runEpisode({ task: TASKS.find(x => x.id === 'T04'), arm: 'S', replay: true });
  assert.equal(S.success, true, JSON.stringify(S));
  assert.equal(S.runs, 2, 'the gap was confirmed, a person approved, lock N+1 continued');
  assert.ok(!S.trace.some(x => x.action === 'find'));
  assert.deepEqual(S.replay, { deterministic: true, runs: 2, diffs: [] });
});

test('M8 (found by the scale world): a standby over the cap keeps exactly maxPerNode members, the most relevant first', () => {
  const crm = { id: 'crm', kind: 'mcp-stdio', trust: 'T1' };
  const mk = (name, summary) => memberRecord({ entry: crm, name, adapter: 'test/1', pins: {}, attestation: { type: 'contact.archive', system: 'crm', verbs: ['search'], objects: ['contact'],
    effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.crm', dataClass: 'internal', egress: 'local', view: { name: `crm_${name}`, summary, inputSchema: { type: 'object' } } } });
  const members = [mk('owner_email', 'Find the email address of a contact owner.'), ...Array.from({ length: 30 }, (_, i) => mk(`archive_${i}`, i % 2 ? 'Archived contact history.' : 'Old partition.'))];
  const workflow = { ...flow([{ ...work(), instructions: 'Find the email address of the contact owner.' }]) }, sidecar = sidecarFor({ systems: ['crm'], objects: ['contact'], effectsMax: 'none', max: 2 });
  const { lock } = resolve({ workflow, sidecar, members, catalogDigest: 'sha256:c', envelope, envelopeDigest: 'sha256:e', types });
  assert.equal(lock.nodes.work.standby.length, envelope.standby.maxPerNode);
  assert.ok(lock.nodes.work.standby.includes('mcp.crm.owner_email'), 'the member the instructions describe survives the cap');
});
