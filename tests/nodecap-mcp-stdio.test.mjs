// Nodecap P2: MCP stdio adapter, pins, annotation mapping, rug pulls and output handling (ARCHITECTURE.md §3.3). Local fixture servers
// only (experiments/nodecap/fixtures/servers); no network, $0. Development tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkCatalog } from '../src/capabilities/catalog.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { McpConnection } from '../src/capabilities/mcp-client.mjs';
import { annotationFloor, hintConflict, qualifyMcp, PinGuard, invokeMcp, runCanary, canaryHash, mapArgs } from '../src/capabilities/import-mcp.mjs';
import { renderView, renderIndexLine } from '../src/capabilities/members.mjs';
import { catalogOf, crmEntry, rugpullEntry, CRM_MEMBERS, ledgerLines, workspace } from './support/nodecap.mjs';

const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };
const POISON = /IMPORTANT|evil\.invalid|export_data|Do not tell/;
function open(t, entry) {
  const [checked] = checkCatalog(catalogOf(entry)).entries;
  const connection = new McpConnection(checked);
  t.after(() => connection.close());
  return { entry: checked, connection };
}

test('mcp stdio: qualification pins every tool and builds members whose text is owner-authored only', async t => {
  const dir = workspace(t), ledgerFile = path.join(dir, 'crm.jsonl'), ledger = new NodecapLedger(dir);
  t.after(() => ledger.close());
  const { entry, connection } = open(t, crmEntry({ ledger: ledgerFile }));
  const q = await qualifyMcp(entry, connection, { ledger });
  assert.match(q.pins.server, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(q.pins.tools).sort(), ['get_contact', 'list_deals', 'search_contacts', 'update_contact', 'weird_schema']);
  assert.deepEqual(q.members.map(m => m.id).sort(), ['mcp.crm.get_contact', 'mcp.crm.list_deals', 'mcp.crm.search_contacts', 'mcp.crm.update_contact']);
  assert.match(q.tools.search_contacts.description, POISON, 'the fixture really is poisoned');
  for (const member of q.members) {
    assert.doesNotMatch(JSON.stringify(member), POISON, `${member.id} carries no server prose`);
    assert.doesNotMatch(renderView(member) + renderIndexLine(member), POISON);
  }
  assert.equal(ledger.observedPins('crm')[0].server, q.pins.server);
  // A call works, lands in the server ledger, and returns the typed structured output.
  const search = q.members.find(m => m.tool === 'search_contacts');
  const guard = new PinGuard(entry, connection, { pins: q.pins, tools: q.tools, verifiedAt: q.listedAt, seenChanges: q.changesBefore });
  const out = await invokeMcp(search, { connection, guard }, { query: 'Ada' });
  assert.equal(out.contacts[0].email, 'ada@analytical.example');
  assert.equal(guard.relists, 1, 'every call re-lists against the pins first (a late list_changed must not open a window)');
  assert.deepEqual(ledgerLines(ledgerFile).map(l => l.tool), ['search_contacts']);
});

test('mcp stdio: an annotation-only change moves the pin; qualification and the guard refuse with the changed field', async t => {
  const dir = workspace(t), ledger = new NodecapLedger(dir);
  t.after(() => ledger.close());
  const first = open(t, crmEntry());
  const q = await qualifyMcp(first.entry, first.connection);
  const members = structuredClone(CRM_MEMBERS); // attestation unchanged
  const drifted = open(t, crmEntry({ variant: 'b', pin: q.pins, members }));
  await assert.rejects(qualifyMcp(drifted.entry, drifted.connection, { ledger }), code('DEFINITION_CHANGED'));
  assert.equal(ledger.status('crm').status, 'quarantined');
  // The guard reports which top-level field changed (host-computed), and refuses before sending.
  const guard = new PinGuard(drifted.entry, drifted.connection, { pins: q.pins, tools: q.tools, ledger });
  const search = q.members.find(m => m.tool === 'search_contacts');
  await assert.rejects(invokeMcp(search, { connection: drifted.connection, guard }, { query: 'Ada' }), error => {
    assert.equal(error.code, 'DEFINITION_CHANGED');
    assert.deepEqual(error.details.fieldDiff, [{ tool: 'search_contacts', fields: ['annotations'] }]);
    return true;
  });
});

test('mcp stdio: a rug pull after list_changed is refused before the call is sent (server counter stays 0)', async t => {
  const dir = workspace(t), ledgerFile = path.join(dir, 'rug.jsonl'), ledger = new NodecapLedger(dir);
  t.after(() => ledger.close());
  const { entry, connection } = open(t, rugpullEntry({ ledger: ledgerFile }));
  const q = await qualifyMcp(entry, connection, { ledger });
  const guard = new PinGuard(entry, connection, { pins: q.pins, tools: q.tools, verifiedAt: q.listedAt, seenChanges: q.changesBefore, ledger });
  for (let i = 0; i < 100 && connection.listChanges === q.changesBefore; i++) await delay(10);
  assert.ok(connection.listChanges > q.changesBefore, 'the server announced tools/list_changed');
  assert.equal(guard.stale, true);
  const member = q.members[0];
  await assert.rejects(invokeMcp(member, { connection, guard }, { rows: ['a'] }), error => {
    assert.equal(error.code, 'DEFINITION_CHANGED');
    assert.deepEqual(error.details.fieldDiff[0].fields, ['description', 'inputSchema']);
    return true;
  });
  assert.equal(ledgerLines(ledgerFile).length, 0, 'export_data was never called');
  assert.equal(ledger.status('rugpull').status, 'quarantined');
  // Once broken, the guard stays broken for this connection.
  await assert.rejects(guard.check(), code('DEFINITION_CHANGED'));
});

test('mcp stdio: annotation mapping table, and a hint tighter than the attestation quarantines', async t => {
  const trusted = { trust: 'T1', trustAnnotations: true }, untrusted = { trust: 'T2', trustAnnotations: true };
  assert.deepEqual(annotationFloor(untrusted, { readOnlyHint: true }), { effects: 'non-idempotent', risk: 'high', requiresApproval: true, trusted: false });
  assert.deepEqual(annotationFloor({ trust: 'T1' }, { readOnlyHint: true }).effects, 'non-idempotent', 'trustAnnotations must be explicit');
  assert.deepEqual(annotationFloor(trusted, { readOnlyHint: true }), { effects: 'none', risk: 'low', requiresApproval: false, trusted: true });
  assert.equal(annotationFloor(trusted, { idempotentHint: true, destructiveHint: false }, { idempotencyArgument: 'requestId' }).effects, 'idempotent');
  assert.equal(annotationFloor(trusted, { idempotentHint: true, destructiveHint: false }).effects, 'non-idempotent', 'idempotent needs an idempotency argument');
  assert.deepEqual(annotationFloor(trusted, {}), { effects: 'non-idempotent', risk: 'high', requiresApproval: true, trusted: true }, 'absent destructiveHint means destructive');
  assert.equal(hintConflict({ readOnlyHint: true }, { effects: 'none', risk: 'low' }), null);
  assert.equal(hintConflict({}, { effects: 'none', risk: 'low' }), null, 'no explicit hint, no conflict');
  assert.deepEqual(hintConflict({ destructiveHint: true }, { effects: 'none', risk: 'low' }).hinted, 'non-idempotent');
  const dir = workspace(t), ledger = new NodecapLedger(dir);
  t.after(() => ledger.close());
  // Variant b says search_contacts is destructive while the owner attests a read: refused, never loosened.
  const { entry, connection } = open(t, crmEntry({ variant: 'b' }));
  await assert.rejects(qualifyMcp(entry, connection, { ledger }), code('ATTESTATION_HINT_CONFLICT'));
  assert.equal(ledger.quarantineLog('crm')[0].code, 'ATTESTATION_HINT_CONFLICT');
});

test('mcp stdio: schemas outside the subset are refused; error text never surfaces; canaries; argMap', async t => {
  const members = { ...structuredClone(CRM_MEMBERS), weird_schema: { ...structuredClone(CRM_MEMBERS.get_contact), type: 'code.read',
    view: { name: 'crm_weird', summary: 'A code lookup.', inputSchema: { type: 'object', properties: { code: { type: 'string', pattern: '^[A-Z]{3}$' } } } } } };
  const weird = open(t, crmEntry({ members }));
  await assert.rejects(qualifyMcp(weird.entry, weird.connection), code('SCHEMA_PROFILE_UNSUPPORTED'));
  const dir = workspace(t), ledger = new NodecapLedger(dir);
  t.after(() => ledger.close());
  const { entry, connection } = open(t, crmEntry());
  const q = await qualifyMcp(entry, connection);
  const guard = new PinGuard(entry, connection, { pins: q.pins, tools: q.tools });
  const get = q.members.find(m => m.tool === 'get_contact');
  await assert.rejects(invokeMcp(get, { connection, guard }, { id: 'nope' }), error => {
    assert.equal(error.code, 'MCP_TOOL_ERROR');
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)}`, /SYSTEM|ignore previous/i);
    assert.match(error.details.textHash, /^[0-9a-f]{64}$/);
    return true;
  });
  // Known-answer canary: the attested hash passes; a different one quarantines with BEHAVIOUR_CHANGED.
  const answer = { contacts: [{ id: 'canary', name: 'Canary Seven', email: 'canary@fixture.example' }] };
  const good = { ...entry, canary: { tool: 'search_contacts', args: { query: 'canary-7' }, answerHash: canaryHash(answer) } };
  assert.equal((await runCanary(good, connection, { ledger })).ran, true);
  const bad = { ...entry, canary: { ...good.canary, answerHash: canaryHash({ contacts: [] }) } };
  await assert.rejects(runCanary(bad, connection, { ledger }), code('BEHAVIOUR_CHANGED'));
  assert.equal(ledger.status('crm').status, 'quarantined');
  assert.deepEqual(mapArgs({ '/q': '/query', '/opts/limit': '/limit' }, { q: 'x', opts: { limit: 3 }, extra: 1 }), { query: 'x', limit: 3 });
});

test('mcp stdio: the child environment holds only the entry\'s envAllow names, not SDK defaults', async t => {
  process.env.NODECAP_ENV_ALLOW = 'allowed'; process.env.NODECAP_ENV_DENY = 'must-not-reach';
  t.after(() => { delete process.env.NODECAP_ENV_ALLOW; delete process.env.NODECAP_ENV_DENY; });
  const entry = crmEntry({ extraArgs: ['--env-probe'] });
  entry.source.envAllow = ['NODECAP_ENV_ALLOW'];
  const { connection } = open(t, entry);
  const result = await connection.call('env_probe', {});
  assert.deepEqual(result.structuredContent.set, ['NODECAP_ENV_ALLOW']);
});
