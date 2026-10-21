// Nodecap P2 stretch: OAuth for remote MCP servers (ARCHITECTURE.md §2.6), against a loopback fake authorization server and an
// OAuth-protected MCP server (experiments/nodecap/fixtures/servers/oauth-world.mjs). MCP authorization 2026-07-28 as read 2026-10-21:
// PKCE S256 (refused when the AS does not advertise it), RFC 8707 `resource` in both requests, `state`, RFC 9207 `iss` before the code is
// used, the attested issuer only, no grant wider than requested, tokens bound to one server (never sent elsewhere), host-side refresh with
// rotation, and no automatic step-up: a 403 insufficient_scope is a typed refusal and a proposal only a person decides. $0, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { construct, launch, subjectOf, executeRun } from '../src/capabilities/launcher.mjs';
import { McpConnection } from '../src/capabilities/mcp-client.mjs';
import { qualifyMcp, PinGuard, invokeMcp } from '../src/capabilities/import-mcp.mjs';
import { ScrubSet } from '../src/capabilities/credentials.mjs';
import { connectOAuth, oauthBearer, canonicalResource, checkIss, connectScopes, stepUpProposal } from '../src/capabilities/oauth.mjs';
import { startOAuthWorld, userAgent, CLIENT_ID } from '../experiments/nodecap/fixtures/servers/oauth-world.mjs';
import { FIXTURES, catalogOf, ticketsEntry, workspace } from './support/nodecap.mjs';

const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const READ_REF = { keychain: { service: 'foundry-nodecap', account: 'tickets-read' } }, WRITE_REF = { keychain: { service: 'foundry-nodecap', account: 'tickets-write' } };
function memoryKeychain() {
  const map = new Map(), key = ({ service, account }) => `${service}/${account}`;
  return { map, get: async ref => map.get(key(ref)) ?? null, put: async (ref, value) => { map.set(key(ref), value); }, record: ref => JSON.parse(map.get(key(ref.keychain))) };
}
function oauthEntry(world, { issuer = world.issuer, scopes = { read: ['tickets:read'], write: ['tickets:read', 'tickets:write'] }, url = world.url } = {}) {
  const entry = { ...ticketsEntry(url), credential: { custody: 'C1', read: READ_REF, write: WRITE_REF, oauth: { issuer, clientId: CLIENT_ID, scopes } } };
  return checkCatalog(catalogOf(entry), { allowDev: true }).entries[0];
}
async function world(t, options) { const w = await startOAuthWorld(options); t.after(() => w.close()); return w; }
const at = (w, kind) => w.log.filter(l => l.at === kind);

test('oauth connect: PKCE S256, resource in both requests, state and iss checked; separate read and write tokens drive the calls', async t => {
  const w = await world(t), kc = memoryKeychain(), entry = oauthEntry(w), opened = [];
  assert.equal(canonicalResource(`${w.url}#frag`), w.url);
  const read = await connectOAuth(entry, { scopeClass: 'read', channel: 'cli', openUrl: userAgent({ log: opened }), keychainStore: kc.put });
  assert.deepEqual([read.scopes, read.resource, read.issuer, read.refreshable], [['tickets:read'], w.url, w.issuer, true]);
  const [authorize] = at(w, 'as.authorize'), [token] = at(w, 'as.token');
  assert.deepEqual([authorize.method, authorize.hasChallenge, authorize.resource, authorize.scope, authorize.state], ['S256', true, w.url, 'tickets:read', true]);
  assert.deepEqual([token.grant, token.resource, token.hasVerifier], ['authorization_code', w.url, true]);
  assert.equal(new URL(opened[0]).origin, w.asOrigin, 'the authorization URL is on the attested issuer');
  await connectOAuth(entry, { scopeClass: 'write', channel: 'dashboard', openUrl: userAgent(), keychainStore: kc.put });
  assert.equal(kc.record(READ_REF).scope, 'tickets:read');
  assert.equal(kc.record(WRITE_REF).scope, 'tickets:read tickets:write');
  // Calls: the read session carries the read token, the write session the write token.
  const scrub = new ScrubSet(), connection = new McpConnection(entry, { keychain: kc.get, keychainStore: kc.put, scrub });
  t.after(() => connection.close());
  const q = await qualifyMcp(entry, connection), guard = new PinGuard(entry, connection, { pins: q.pins, tools: q.tools });
  assert.equal((await invokeMcp(q.members.find(m => m.tool === 'get_ticket'), { connection, guard }, { id: 42 })).ticket.id, 42);
  assert.equal((await invokeMcp(q.members.find(m => m.tool === 'add_comment'), { connection, guard }, { id: 42, body: 'Order 7731 refunded.' })).comments, 1);
  assert.deepEqual(w.ledger.map(l => [l.tool, l.scopes.join(' ')]), [['get_ticket', 'tickets:read'], ['add_comment', 'tickets:read tickets:write']]);
  assert.equal(scrub.contains(kc.record(READ_REF).access_token), true, 'token values join the run scrub set');
  assert.equal(at(w, 'as.authorize').length, 2, 'no extra authorization happened behind the person');
  // The module that drives authorization never starts a process (no shell `open` of an authorization URL).
  const source = readFileSync(fileURLToPath(new URL('../src/capabilities/oauth.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /child_process|\bexec(File|Sync)?\(|\bspawn\(/);
});

test('oauth refusals: iss mismatch or missing, no PKCE, unattested AS, wider grant, foreign endpoint, bad state, non-person channel', async t => {
  const kc = memoryKeychain(), go = (entry, extra = {}) => connectOAuth(entry, { scopeClass: 'read', channel: 'cli', openUrl: userAgent(), keychainStore: kc.put, timeoutMs: 5000, ...extra });
  const wrong = await world(t, { iss: 'wrong' });
  await assert.rejects(go(oauthEntry(wrong)), code('OAUTH_ISS_MISMATCH'));
  assert.equal(at(wrong, 'as.token').length, 0, 'the code never reached a token endpoint');
  const missing = await world(t, { iss: 'absent' });
  await assert.rejects(go(oauthEntry(missing)), code('OAUTH_ISS_MISSING'));
  assert.equal(at(missing, 'as.token').length, 0);
  // The spec's fourth row: the AS does not advertise iss and sends none, so the client proceeds.
  const legacy = await world(t, { iss: 'absent', issSupported: false });
  assert.equal((await go(oauthEntry(legacy))).scopes[0], 'tickets:read');
  const noPkce = await world(t, { pkce: false });
  await assert.rejects(go(oauthEntry(noPkce)), code('OAUTH_PKCE_UNSUPPORTED'));
  assert.equal(at(noPkce, 'as.authorize').length, 0, 'refused before any authorization request');
  const rogue = await world(t, { rogueAs: true });
  await assert.rejects(go(oauthEntry(rogue)), code('OAUTH_ISSUER_UNATTESTED'));
  assert.equal(at(rogue, 'as.metadata').length, 0, 'the unattested AS is never contacted');
  const widen = await world(t, { widen: true }), before = kc.map.size;
  await assert.rejects(go(oauthEntry(widen)), code('OAUTH_SCOPE_WIDER'));
  assert.equal(kc.map.size, before, 'a wider grant is discarded, not stored');
  const foreign = await world(t, { authorizationEndpoint: 'http://127.0.0.1:9/authorize' }), opened = [];
  await assert.rejects(go(oauthEntry(foreign), { openUrl: userAgent({ log: opened }) }), code('OAUTH_ENDPOINT_REFUSED'));
  assert.equal(opened.length, 0, 'a foreign authorization URL is never opened');
  const csrf = await world(t);
  await assert.rejects(go(oauthEntry(csrf), { openUrl: userAgent({ tamper: url => url.searchParams.set('state', 'forged') }) }), code('OAUTH_STATE_MISMATCH'));
  assert.equal(at(csrf, 'as.token').length, 0);
  await assert.rejects(go(oauthEntry(csrf), { channel: 'mcp-elicitation' }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  // The iss table, directly.
  assert.throws(() => checkIss(new URLSearchParams('code=x&iss=https://a.example/'), { recordedIssuer: 'https://a.example', issSupported: true }), code('OAUTH_ISS_MISMATCH'), 'no trailing-slash normalization');
  assert.doesNotThrow(() => checkIss(new URLSearchParams('code=x'), { recordedIssuer: 'https://a.example', issSupported: undefined }));
  // Catalog rules: OAuth only on remote servers, tokens only in the keychain, https issuers off loopback.
  const base = oauthEntry(csrf);
  assert.throws(() => checkCatalog(catalogOf({ ...base, credential: { ...base.credential, custody: 'C0', read: { env: 'A_TOKEN' }, write: { env: 'B_TOKEN' } } }), { allowDev: true }), code('CATALOG_OAUTH'));
  assert.throws(() => checkCatalog(catalogOf({ ...base, dev: false, source: { url: 'https://tickets.example/mcp', transport: 'streamable-http' } })), code('CATALOG_TRANSPORT'), 'an http issuer is refused off dev');
});

test('oauth bearer: a token for another server is never sent; refresh is host-side with resource and rotation, never wider', async t => {
  const a = await world(t), b = await world(t), kc = memoryKeychain();
  await connectOAuth(oauthEntry(a), { scopeClass: 'read', channel: 'cli', openUrl: userAgent(), keychainStore: kc.put });
  // Entry B shares the keychain refs and even the issuer attestation, but the stored token was issued for A's resource.
  const entryB = oauthEntry(b, { issuer: a.issuer }), connB = new McpConnection(entryB, { keychain: kc.get });
  t.after(() => connB.close());
  await assert.rejects(connB.listAll(), code('OAUTH_TOKEN_AUDIENCE'));
  assert.equal(b.seenAuth.length, 0, 'B never saw a request, let alone a token');
  // Refresh: two hours later the token is stale; host code refreshes it (resource again) and stores the rotated refresh token.
  const entryA = oauthEntry(a), first = kc.record(READ_REF), later = () => Date.now() + 2 * 3600 * 1000;
  const bearer = oauthBearer(entryA, { scopeClass: 'read', keychain: kc.get, keychainStore: kc.put, now: later });
  const token = await bearer();
  const refresh = at(a, 'as.token').filter(l => l.grant === 'refresh_token');
  assert.deepEqual(refresh.map(l => l.resource), [a.url]);
  assert.notEqual(token, first.access_token);
  assert.notEqual(kc.record(READ_REF).refresh_token, first.refresh_token, 'the rotated refresh token was stored');
  assert.equal(kc.record(READ_REF).scope, 'tickets:read', 'same scope after refresh');
  // The old refresh token no longer works (rotation); its error is a closed code, never AS text.
  await kc.put(READ_REF.keychain, JSON.stringify(first));
  await assert.rejects(bearer(), error => { assert.equal(error.code, 'OAUTH_REFRESH_REFUSED'); assert.equal(error.details.oauthError, 'invalid_grant'); return true; });
  // Without a store, an expired token is a typed failure (a person reconnects); nothing falls back.
  await assert.rejects(oauthBearer(entryA, { scopeClass: 'read', keychain: kc.get, now: later })(), code('AUTH_EXPIRED'));
  await assert.rejects(oauthBearer(entryA, { scopeClass: 'write', keychain: kc.get })(), code('CREDENTIAL_MISSING'));
});

test('oauth step-up: a read-scoped write is refused (no automatic up-scope); only a person-approved proposal widens the next connect', async t => {
  const w = await world(t), kc = memoryKeychain(), ledger = new NodecapLedger(workspace(t));
  t.after(() => ledger.close());
  // The owner under-attested the write class (read scope only).
  const entry = oauthEntry(w, { scopes: { read: ['tickets:read'], write: ['tickets:read'] } });
  await connectOAuth(entry, { scopeClass: 'read', channel: 'cli', openUrl: userAgent(), keychainStore: kc.put });
  await connectOAuth(entry, { scopeClass: 'write', channel: 'cli', openUrl: userAgent(), keychainStore: kc.put });
  const connection = new McpConnection(entry, { keychain: kc.get, keychainStore: kc.put });
  t.after(() => connection.close());
  const q = await qualifyMcp(entry, connection), guard = new PinGuard(entry, connection, { pins: q.pins, tools: q.tools });
  let refusal;
  await assert.rejects(invokeMcp(q.members.find(m => m.tool === 'add_comment'), { connection, guard }, { id: 42, body: 'x' }), error => { refusal = error; return error.code === 'SCOPE_INSUFFICIENT'; });
  assert.deepEqual(refusal.details.scopes, ['tickets:write']);
  assert.doesNotMatch(JSON.stringify({ m: refusal.message, d: refusal.details }), /IGNORE|admin/, 'the challenge description never travels');
  assert.equal(at(w, 'as.authorize').length, 2, 'no automatic re-authorization beyond the two connects');
  assert.equal(w.tickets.get(42).comments.length, 0);
  const proposal = stepUpProposal(ledger, { entry, scopeClass: 'write', scopes: refusal.details.scopes, evidence: { test: true } });
  assert.deepEqual([proposal.kind, proposal.scopes, proposal.quoted[0].label], ['scope.step-up', ['tickets:write'], 'untrusted:mcp.tickets']);
  assert.throws(() => connectScopes(entry, 'write', { ledger, stepUp: proposal.id }), code('OAUTH_SCOPE_UNAPPROVED'), 'open is not approved');
  assert.throws(() => ledger.decideProposal(proposal.id, { approve: true, channel: 'mcp-elicitation', expectedRev: proposal.rev }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  ledger.decideProposal(proposal.id, { approve: true, channel: 'cli', expectedRev: proposal.rev });
  assert.throws(() => connectScopes(entry, 'read', { ledger, stepUp: proposal.id }), code('OAUTH_SCOPE_UNAPPROVED'), 'the approval is for the write class only');
  const again = await connectOAuth(entry, { scopeClass: 'write', channel: 'cli', openUrl: userAgent(), keychainStore: kc.put, ledger, stepUp: proposal.id });
  assert.deepEqual(again.scopes, ['tickets:read', 'tickets:write']);
  const fresh = new McpConnection(entry, { keychain: kc.get, keychainStore: kc.put });
  t.after(() => fresh.close());
  assert.equal((await invokeMcp(q.members.find(m => m.tool === 'add_comment'), { connection: fresh, guard: new PinGuard(entry, fresh, { pins: q.pins, tools: q.tools }) }, { id: 42, body: 'Order 7731 refunded.' })).comments, 1);
});

test('oauth through the runtime: an approved effect with a read-scoped token is refused SCOPE_INSUFFICIENT and opens a step-up proposal; tokens never reach a model', async t => {
  const w = await world(t), kc = memoryKeychain(), dir = workspace(t);
  const entry = oauthEntry(w, { scopes: { read: ['tickets:read'], write: ['tickets:read'] } });
  await connectOAuth(entry, { scopeClass: 'read', channel: 'cli', openUrl: userAgent(), keychainStore: kc.put });
  await connectOAuth(entry, { scopeClass: 'write', channel: 'cli', openUrl: userAgent(), keychainStore: kc.put });
  const loaded = loadPolicy(), M = loaded.policy.models.find(m => m.class === 'M').id, envelope = checkEnvelope(DEFAULT_ENVELOPE);
  const store = new Store(dir), ledger = new NodecapLedger(dir), catalog = checkCatalog(catalogOf(entry), { allowDev: true });
  const host = new NodecapHost({ catalog, ledger, envelope, keychain: kc.get, keychainStore: kc.put });
  const step = value => ({ value: { tool: 'none', args: {}, ...value } });
  const provider = new ScriptedProvider({ [M]: [step({ action: 'read', tool: 'tickets_get', args: { id: 42 } }), step({ action: 'act', tool: 'tickets_add_comment', args: { id: 42, body: 'Order 7731' } }), step({ action: 'stuck' })] });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) });
  t.after(async () => { await host.close(); store.close(); ledger.close(); });
  const workflow = { schemaVersion: '1.0', id: 'NodecapOAuth', version: 1, title: 'OAuth probe', goal: 'Comment on ticket 42', domain: 'diagnostic',
    envelope: { assumptions: ['fixture servers'], risks: [], successCriteria: ['typed answer'] }, budget: { maxSteps: 200, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 0 },
    nodes: [{ id: 'work', kind: 'agent', needs: [], description: 'Tool node', role: 'extract', instructions: 'Comment on ticket 42 with its order number.', model: { class: 'M' },
      returns: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } } }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.work' } }] };
  const sidecar = { schema: 'foundry-nodecap-toolnodes/1', nodes: { work: { acquire: { systems: ['tickets'], objects: ['ticket'], effectsMax: 'non-idempotent', max: 3 }, maxTurns: 6 } } };
  const construction = await construct({ workflow, sidecar, host, envelope, types: loadTypes(path.join(FIXTURES, 'types.json')), catalogDigest: catalogDigest(catalog) });
  assert.deepEqual(construction.lint.errors, []);
  ledger.approveLock(subjectOf(construction), { channel: 'cli' });
  const { runtime, run: created } = await launch({ store, ledger, host, construction, envelope, models, modelPolicy: loaded });
  let run = await executeRun({ runtime, host, runId: created.id });
  assert.equal(run.status, 'awaiting_approval', JSON.stringify(run.error));
  for (const id of Object.keys(run.approvals)) runtime.approve(run.id, id, true, 'user');
  run = await executeRun({ runtime, host, runId: run.id });
  assert.equal(run.error?.code, 'NODE_STUCK');
  const turn1 = run.frames['root/work__loop:1'].outputs.act;
  assert.deepEqual([turn1.ok, turn1.code], [false, 'SCOPE_INSUFFICIENT'], 'the model sees a host code only');
  const [proposal] = ledger.proposals({ status: 'open' });
  assert.deepEqual([proposal.kind, proposal.entry, proposal.scopeClass, proposal.scopes], ['scope.step-up', 'tickets', 'write', ['tickets:write']]);
  assert.deepEqual(w.ledger.map(l => l.tool), ['get_ticket'], 'the write never reached a handler');
  assert.equal(at(w, 'as.authorize').length, 2, 'two connects by the person, no automatic step-up');
  // No token value in prompts, events or the model journal.
  const tokens = [kc.record(READ_REF).access_token, kc.record(WRITE_REF).access_token, kc.record(READ_REF).refresh_token];
  const seen = [...provider.calls.map(c => `${c.system}\n${c.prompt}`), JSON.stringify(store.events(run.id)), JSON.stringify(new Journal(store).forRun(run.id))].join('\n');
  for (const token of tokens) assert.equal(seen.includes(token), false);
  assert.doesNotMatch(seen, /IGNORE PREVIOUS/);
});
