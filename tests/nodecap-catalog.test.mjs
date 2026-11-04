// Nodecap P1: host capability catalog, envelope and ledger (ARCHITECTURE.md §3.2). Development tests, $0, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { loadCatalog, checkCatalog, catalogDigest, entryStatus, bindable, secretLike } from '../src/capabilities/catalog.mjs';
import { DEFAULT_ENVELOPE, checkEnvelope, envelopeDigest, autoBind, denyListed } from '../src/capabilities/envelope.mjs';
import { NodecapLedger } from '../src/capabilities/ledger.mjs';
import { catalogOf, crmEntry, ticketsEntry, workspace, openLedger, person } from './support/nodecap.mjs';

const code = expected => error => { assert.equal(error.code, expected, `${error.code}: ${error.message}`); return true; };

test('catalog: a valid JSONC catalog loads, gets default statuses and a stable digest', t => {
  const dir = workspace(t), file = path.join(dir, 'catalog.jsonc');
  const catalog = catalogOf(crmEntry(), ticketsEntry('http://127.0.0.1:0/mcp'));
  writeFileSync(file, `// owner catalog\n${JSON.stringify(catalog, null, 2)}`);
  const loaded = loadCatalog(file, { allowDev: true });
  assert.equal(loaded.catalog.entries.length, 2);
  assert.equal(loaded.digest, catalogDigest(loaded.catalog));
  // Key order does not move the digest.
  const reverse = v => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
  const shuffled = reverse(loaded.catalog);
  assert.notEqual(JSON.stringify(shuffled), JSON.stringify(loaded.catalog));
  assert.equal(catalogDigest(shuffled), loaded.digest);
});

test('catalog: refusals (symlink, size, unknown key, duplicate id, secret value, env name, dev gating, transport, program entries, members)', async t => {
  const dir = workspace(t), file = path.join(dir, 'c.json'), link = path.join(dir, 'link.json');
  writeFileSync(file, JSON.stringify(catalogOf(crmEntry())));
  symlinkSync(file, link);
  assert.throws(() => loadCatalog(link), code('CATALOG_PATH'));
  const big = path.join(dir, 'big.json'); writeFileSync(big, ' '.repeat(1024 * 1024 + 1));
  assert.throws(() => loadCatalog(big), code('CATALOG_SIZE'));
  const bad = path.join(dir, 'bad.json'); writeFileSync(bad, '{"schema": "foundry-catalog/1", "entries": [}');
  assert.throws(() => loadCatalog(bad), code('CATALOG_SYNTAX'));
  assert.throws(() => checkCatalog({ ...catalogOf(crmEntry()), extra: 1 }), code('SCHEMA_MISMATCH'));
  assert.throws(() => checkCatalog(catalogOf({ ...crmEntry(), surprise: true })), code('SCHEMA_MISMATCH'));
  assert.throws(() => checkCatalog(catalogOf(crmEntry(), crmEntry())), code('CATALOG_DUPLICATE'));
  // A credential VALUE anywhere is refused, before schema checks; names only.
  const leaky = crmEntry(); leaky.source.args.push(`ghp_${'a1B2c3D4'.repeat(5)}`);
  assert.throws(() => checkCatalog(catalogOf(leaky)), code('CATALOG_SECRET_VALUE'));
  const entropic = crmEntry(); entropic.source.args.push('Zq8xK2mN9vB4wL7pR3tY6uH1jF5gD0sA');
  assert.throws(() => checkCatalog(catalogOf(entropic)), code('CATALOG_SECRET_VALUE'));
  assert.equal(secretLike('sha256:' + 'a'.repeat(64)), false);
  assert.equal(secretLike('workflow-foundry-nodecap/1'), false);
  const lower = ticketsEntry('http://127.0.0.1:0/mcp', { credential: { custody: 'C0', read: { env: 'lower_case' } } });
  assert.throws(() => checkCatalog(catalogOf(lower), { allowDev: true }), code('SCHEMA_MISMATCH'));
  assert.throws(() => checkCatalog(catalogOf(ticketsEntry('http://127.0.0.1:0/mcp'))), code('CATALOG_DEV_ENTRY'));
  const plain = { ...ticketsEntry('http://tickets.example/mcp'), dev: false };
  assert.throws(() => checkCatalog(catalogOf(plain)), code('CATALOG_TRANSPORT'));
  // Program entries (CM0) need a pinned JavaScript source, exactly one attested member and the members they use; python is not supported.
  assert.throws(() => checkCatalog(catalogOf({ id: 'prog', kind: 'program', trust: 'T0', source: {} })), code('SCHEMA_MISMATCH'));
  assert.throws(() => checkCatalog(catalogOf({ id: 'prog', kind: 'program', trust: 'T0', source: { lang: 'python', file: '/x.py', sha256: 'a'.repeat(64) } })), code('SCHEMA_MISMATCH'));
  assert.throws(() => checkCatalog(catalogOf({ id: 'prog', kind: 'program', trust: 'T0', source: { lang: 'js', file: '/x.mjs', sha256: 'a'.repeat(64) }, members: {} })), code('CATALOG_PROGRAM'));
  const memberless = crmEntry(); delete memberless.members;
  assert.throws(() => checkCatalog(catalogOf(memberless)), code('CATALOG_MEMBERS'));
  const unidempotent = crmEntry(); delete unidempotent.members.update_contact.idempotencyArgument;
  assert.throws(() => checkCatalog(catalogOf(unidempotent)), code('CATALOG_IDEMPOTENCY'));
});

test('catalog: T3 entries are never bindable; status comes from the ledger once it has one', t => {
  const ledger = new NodecapLedger(workspace(t)); t.after(() => ledger.close());
  const { entries: [crm, t3] } = checkCatalog(catalogOf(crmEntry(), { ...crmEntry({ id: 'shady', trust: 'T3' }) }));
  assert.equal(bindable(crm, ledger), true);
  assert.equal(bindable(t3, ledger), false);
  ledger.quarantine('crm', 'DEFINITION_CHANGED', { tool: 'search_contacts' });
  assert.equal(entryStatus(crm, ledger), 'quarantined');
  assert.equal(bindable(crm, ledger), false);
  assert.equal(ledger.quarantineLog('crm')[0].code, 'DEFINITION_CHANGED');
});

test('ledger: the status machine allows only its transitions, with compare-and-swap; a move to active needs a person', t => {
  const ledger = openLedger(workspace(t)); t.after(() => ledger.close());
  const activate = (rev, status) => person(NodecapLedger.statusSubject({ entryId: 'x', status, to: 'active', rev }), true);
  // An entry the ledger has not recorded moves from the status its owner wrote in the catalog (here none: imported, where the machine
  // starts); the caller never says where it moves from, and without the catalog nothing moves (fix round 2026-11-04, thesis N4).
  const catalog = { entries: [{ id: 'x' }] };
  assert.throws(() => ledger.setStatus('x', { to: 'qualified', expectedRev: 0 }), code('LEDGER_CATALOG_REQUIRED'));
  assert.throws(() => ledger.setStatus('x', { to: 'active', expectedRev: 0, catalog }), code('LEDGER_TRANSITION'));
  assert.equal(ledger.setStatus('x', { to: 'qualified', expectedRev: 0, catalog }).rev, 1);
  assert.throws(() => ledger.setStatus('x', { to: 'active', expectedRev: 0 }), code('CONFLICT'));
  assert.throws(() => ledger.setStatus('x', { to: 'active', expectedRev: 1, actor: 'owner' }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  assert.equal(ledger.setStatus('x', { to: 'active', expectedRev: 1, person: activate(1, 'qualified') }).status, 'active');
  ledger.setStatus('x', { to: 'quarantined', expectedRev: 2 }); ledger.setStatus('x', { to: 'active', expectedRev: 3, person: activate(3, 'quarantined') }); ledger.setStatus('x', { to: 'revoked', expectedRev: 4 });
  assert.throws(() => ledger.setStatus('x', { to: 'active', expectedRev: 5 }), code('LEDGER_TRANSITION'));
});

test('ledger: concurrent proposal decisions give one winner and one CONFLICT; elicitation never widens', t => {
  const dir = workspace(t), a = openLedger(dir), b = openLedger(dir);
  t.after(() => { a.close(); b.close(); });
  const proposal = a.putProposal({ kind: 'capability.bind', flowId: 'flow', diff: { added: [{ member: 'mcp.sheets.append_row' }] } });
  const subject = (choice = null) => NodecapLedger.proposalSubject(proposal, { choice });
  assert.throws(() => a.decideProposal(proposal.id, { person: { channel: 'mcp-elicitation', approve: true, subject: subject('mcp.sheets.append_row') }, expectedRev: 1, choice: 'mcp.sheets.append_row' }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  const outcomes = [];
  for (const [ledger, approve] of [[a, true], [b, false]]) {
    const choice = approve ? 'mcp.sheets.append_row' : null;
    try { outcomes.push(ledger.decideProposal(proposal.id, { person: person(subject(choice), approve), expectedRev: 1, choice }).status); } catch (error) { outcomes.push(error.code); }
  }
  assert.deepEqual(outcomes, ['approved', 'CONFLICT']);
  assert.equal(b.proposal(proposal.id).status, 'approved');
  assert.equal(b.proposal(proposal.id).decision.channel, 'scripted', 'the record says which channel decided');
  // Lock approvals are a person's too, and bind the whole subject.
  const parts = { workflowHash: 'a'.repeat(64), lockHash: 'sha256:' + 'b'.repeat(64), envelopeDigest: 'e', catalogDigest: 'c', dryRunId: null };
  assert.throws(() => a.approveLock(parts, { person: { channel: 'cli', approve: true, subject: NodecapLedger.subject(parts) } }), code('APPROVAL_CHANNEL_INSUFFICIENT'));
  assert.throws(() => a.approveLock(parts, { person: person(NodecapLedger.subject({ ...parts, dryRunId: 'other' }), true) }), code('PERSON_SUBJECT_MISMATCH'));
  a.approveLock(parts, { person: person(NodecapLedger.subject(parts), true) });
  assert.ok(b.lockApproval(parts));
  assert.equal(b.lockApproval({ ...parts, lockHash: 'sha256:' + 'c'.repeat(64) }), null);
  // Flow heads move by compare-and-swap.
  a.setHead('flow', { workflowHash: 'w1', lockHash: 'l1', expectedRev: 0 });
  assert.throws(() => b.setHead('flow', { workflowHash: 'w2', lockHash: 'l2', expectedRev: 0 }), code('CONFLICT'));
  assert.equal(b.setHead('flow', { workflowHash: 'w2', lockHash: 'l2', expectedRev: 1 }).rev, 2);
});

test('envelope: closed keys, effects-none auto-bind, deny list, I6 and the egress-aware Rule of Two', () => {
  const envelope = checkEnvelope(DEFAULT_ENVELOPE);
  assert.match(envelopeDigest(envelope), /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => checkEnvelope({ ...DEFAULT_ENVELOPE, extra: 1 }), code('SCHEMA_MISMATCH'));
  assert.throws(() => checkEnvelope({ ...DEFAULT_ENVELOPE, autoBind: { ...DEFAULT_ENVELOPE.autoBind, effects: ['none', 'idempotent'] } }), code('ENVELOPE_POLICY'));
  const read = { id: 'mcp.crm.search_contacts', tool: 'search_contacts', effects: 'none', risk: 'low', trust: 'T1', custody: null, cost: 0, dataClass: 'private', egress: 'local', view: { name: 'crm_search_contacts', summary: 's' } };
  assert.deepEqual(autoBind(envelope, read), { ok: true });
  assert.equal(autoBind(envelope, { ...read, effects: 'non-idempotent' }).code, 'NEED_EFFECTFUL');
  assert.equal(autoBind(envelope, { ...read, effects: 'idempotent' }, { controlLabel: 'untrusted:web' }).code, 'NEED_UNTRUSTED_EFFECT');
  assert.equal(autoBind(envelope, { ...read, trust: 'T2' }).code, 'NEED_TRUST');
  assert.equal(autoBind(envelope, { ...read, cost: 0.01 }).code, 'NEED_COST');
  assert.equal(autoBind(envelope, { ...read, custody: 'C2' }).code, 'NEED_CUSTODY');
  assert.equal(autoBind(envelope, { ...read, egress: 'third-party' }).code, 'NEED_RULE_OF_TWO');
  assert.equal(autoBind(envelope, { ...read, dataClass: 'public', egress: 'third-party' }, { holdsPrivate: true }).code, 'NEED_RULE_OF_TWO');
  assert.deepEqual(autoBind(envelope, { ...read, dataClass: 'public', egress: 'third-party' }), { ok: true });
  for (const tool of ['manage_connections', 'COMPOSIO_MANAGE_CONNECTIONS', 'auto_provision_mcp', 'zapier_manage_connections_v2']) {
    assert.equal(denyListed(envelope, { id: `mcp.broker.${tool}`, tool }), true, tool);
    assert.equal(autoBind(envelope, { ...read, id: `mcp.broker.${tool}`, tool }).code, 'NEED_DENYLISTED');
  }
});
