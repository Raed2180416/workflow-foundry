// Nodecap P2: streamable-HTTP MCP adapter with env bearer credentials (ARCHITECTURE.md §3.3, §2.6). Loopback fixture servers only; $0.
// OAuth (PKCE, RFC 8707 resource, RFC 9207 iss, refresh, step-up as a proposal) is exercised in tests/nodecap-oauth.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { checkCatalog } from '../src/capabilities/catalog.mjs';
import { McpConnection } from '../src/capabilities/mcp-client.mjs';
import { qualifyMcp, PinGuard, invokeMcp } from '../src/capabilities/import-mcp.mjs';
import { guardedFetch } from '../src/capabilities/guarded-fetch.mjs';
import { ScrubSet, resolveCredential } from '../src/capabilities/credentials.mjs';
import { startTicketsServer } from '../experiments/nodecap/fixtures/servers/tickets-http.mjs';
import { catalogOf, ticketsEntry } from './support/nodecap.mjs';

const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
async function world(t) {
  const readToken = `canary-read-${randomUUID()}`, writeToken = `canary-write-${randomUUID()}`;
  const env = { NODECAP_TICKETS_READ_TOKEN: readToken, NODECAP_TICKETS_WRITE_TOKEN: writeToken };
  const server = await startTicketsServer({ readToken, writeToken });
  t.after(() => server.close());
  return { server, env, readToken, writeToken };
}
function connect(t, entry, { env, scrub = new ScrubSet(), onRequest } = {}) {
  const [checked] = checkCatalog(catalogOf(entry), { allowDev: true }).entries;
  const connection = new McpConnection(checked, { env, scrub, onRequest });
  t.after(() => connection.close());
  return { entry: checked, connection, scrub };
}

test('mcp http: a bearer from env reaches only its own origin; read and write use separate credentials', async t => {
  const w = await world(t), other = await world(t), sent = [];
  const { entry, connection, scrub } = connect(t, ticketsEntry(w.server.url), { env: w.env, onRequest: r => sent.push(r) });
  const q = await qualifyMcp(entry, connection);
  assert.deepEqual(q.members.map(m => m.tool).sort(), ['add_comment', 'get_ticket', 'search_tickets', 'set_label']);
  assert.ok(w.server.seenAuth.length > 0 && w.server.seenAuth.every(s => s.authorization === 'present'));
  const guard = new PinGuard(entry, connection, { pins: q.pins, tools: q.tools, verifiedAt: q.listedAt, seenChanges: q.changesBefore });
  const get = q.members.find(m => m.tool === 'get_ticket'), comment = q.members.find(m => m.tool === 'add_comment');
  assert.equal((await invokeMcp(get, { connection, guard }, { id: 42 })).ticket.id, 42);
  assert.deepEqual((await invokeMcp(comment, { connection, guard }, { id: 42, body: 'Order 7731 refunded.' })).comments, 1);
  assert.deepEqual(w.server.ledger.map(l => [l.tool, l.scope]), [['get_ticket', 'read'], ['add_comment', 'write']]);
  assert.ok(sent.every(r => r.origin === w.server.origin && r.authorized));
  assert.equal(scrub.contains(`x ${w.readToken} y`), true, 'resolved values join the run scrub set');
  // The same connection's fetch refuses another origin before sending: the second server never sees a request, let alone a header.
  const fetcher = guardedFetch({ origin: w.server.url, dev: true, bearer: async () => w.readToken });
  await assert.rejects(fetcher(`${other.server.origin}/mcp`, { method: 'POST', body: '{}' }), code('EGRESS_REFUSED'));
  assert.equal(other.server.seenAuth.length, 0);
  // An entry with no credential sends no Authorization header at all.
  const bare = connect(t, ticketsEntry(other.server.url, { credential: undefined }), { env: w.env });
  delete bare.entry.credential;
  await assert.rejects(new McpConnection(bare.entry, { env: w.env }).listAll(), code('AUTH_REQUIRED'));
  assert.ok(other.server.seenAuth.every(s => s.authorization === 'absent'));
});

test('mcp http: a read token cannot write (403 insufficient_scope becomes a typed refusal, never a step-up)', async t => {
  const w = await world(t);
  const entry = ticketsEntry(w.server.url, { credential: { custody: 'C0', read: { env: 'NODECAP_TICKETS_READ_TOKEN' }, write: { env: 'NODECAP_TICKETS_READ_TOKEN' } } });
  const { entry: checked, connection } = connect(t, entry, { env: w.env });
  const q = await qualifyMcp(checked, connection);
  const guard = new PinGuard(checked, connection, { pins: q.pins, tools: q.tools });
  await assert.rejects(invokeMcp(q.members.find(m => m.tool === 'add_comment'), { connection, guard }, { id: 42, body: 'x' }), error => {
    assert.equal(error.code, 'SCOPE_INSUFFICIENT');
    assert.doesNotMatch(error.message, new RegExp(w.readToken));
    return true;
  });
  assert.equal(w.server.tickets.get(42).comments.length, 0);
  assert.equal(w.server.ledger.filter(l => l.tool === 'add_comment').length, 0, 'the call never reached a handler');
});

test('mcp http: redirects are refused; https is required off loopback; missing credentials are typed', async t => {
  const redirector = http.createServer((req, res) => { res.writeHead(307, { location: 'http://127.0.0.1:9/elsewhere' }).end(); });
  await new Promise(resolve => redirector.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => redirector.close(resolve)));
  const url = `http://127.0.0.1:${redirector.address().port}/mcp`;
  const { connection } = connect(t, ticketsEntry(url), { env: { NODECAP_TICKETS_READ_TOKEN: 'canary-read-zzzzzz', NODECAP_TICKETS_WRITE_TOKEN: 'canary-write-zzzzzz' } });
  await assert.rejects(connection.listAll(), code('REDIRECT_REFUSED'));
  await assert.rejects(guardedFetch({ origin: 'http://tickets.example/mcp' })('http://tickets.example/mcp'), code('EGRESS_REFUSED'));
  await assert.rejects(guardedFetch({ origin: 'http://10.0.0.5/mcp', dev: true })('http://10.0.0.5/mcp'), code('EGRESS_REFUSED'), 'dev allows loopback only');
  await assert.rejects(resolveCredential({ env: 'NODECAP_NOT_SET_ANYWHERE' }, { env: {} }), code('CREDENTIAL_MISSING'));
  await assert.rejects(resolveCredential({ env: 'X' }, { custody: 'C2' }), code('CUSTODY_UNATTENDED'));
  await assert.rejects(resolveCredential({ env: 'X' }, { custody: 'C3' }), code('CUSTODY_UNSUPPORTED'));
  // C1: the keychain lookup is injected (a stand-in), never a shell; the value enters the scrub set.
  const scrub = new ScrubSet();
  const value = await resolveCredential({ keychain: { service: 'foundry', account: 'tickets' } }, { custody: 'C1', scrub, keychain: async ({ service, account }) => `kc-${service}-${account}-secret` });
  assert.equal(value, 'kc-foundry-tickets-secret');
  assert.equal(scrub.redact(`token=${value}`), 'token=[redacted]');
});
