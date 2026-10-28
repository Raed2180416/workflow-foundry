// Shared fixtures of the nodecap tests: temp workspaces (removed in t.after), attested catalog entries for the fixture servers, and the
// owner skills. Development fixtures only.
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { fileSha256 } from '../../src/capabilities/stdio-sandbox.mjs';
import { scriptedPerson } from '../../src/capabilities/person.mjs';
import { NodecapLedger } from '../../src/capabilities/ledger.mjs';
import { subjectOf } from '../../src/capabilities/launcher.mjs';
import { callSubject, describeApproval } from '../../src/capabilities/broker.mjs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../../experiments/nodecap/fixtures/', import.meta.url));
export const SERVERS = path.join(FIXTURES, 'servers');
const NODE_MODULES = fileURLToPath(new URL('../../node_modules', import.meta.url));
/** The scripted person of the tests (recorded as channel 'scripted'; ledgers accept it only when opened with that channel). */
export const person = scriptedPerson('nodecap-tests');
export const TEST_CHANNELS = ['cli', 'dashboard', 'scripted'];
/**
 * The source of a fixture stdio server as an owner attests it: an absolute command, integrity pins of the interpreter, the script and the
 * shared fixture library (`integrity` overrides some, as a changed file would), and the sandbox binds it needs (the fixture directory and
 * the SDK read-only; the ledger directory writable).
 */
export function stdioSource(file, args = [], { envAllow = [], write = [], integrity = {} } = {}) {
  const script = path.join(SERVERS, file), lib = path.join(SERVERS, 'lib.mjs');
  return { command: process.execPath, args: [script, ...args], envAllow,
    integrity: { ...Object.fromEntries([process.execPath, script, lib].map(f => [f, fileSha256(f)])), ...integrity },
    sandbox: { read: [...new Set([SERVERS, NODE_MODULES, realpathSync(NODE_MODULES)])], write } };
}
/** A nodecap ledger that accepts the tests' scripted person (production ledgers accept cli and dashboard only). */
export const openLedger = (dir, { channels = TEST_CHANNELS } = {}) => new NodecapLedger(dir, { channels });
/** The scripted person approves one constructed version (its exact subject). */
export const approveVersion = (ledger, construction, dryRunId = null) => ledger.approveLock(subjectOf(construction, dryRunId), { person: person(NodecapLedger.subject(subjectOf(construction, dryRunId)), true) });
/** The scripted person decides one proposal at its current revision. */
export const decide = (ledger, proposal, approve) => ledger.decideProposal(proposal.id, { person: person(NodecapLedger.proposalSubject(proposal), approve), expectedRev: proposal.rev });
/** The scripted person decides one pending effect approval: on the host's rendering of the call, recorded in the ledger, then the engine's approval. */
export async function approveCall({ runtime, ledger, host, lock, run, approvalId, approve = true }) {
  const rendering = await describeApproval({ host, lock, run, approvalId }), subject = callSubject(approvalId, rendering);
  ledger.recordCallDecision(subject, person(subject, approve));
  runtime.approve(run.id, approvalId, approve, 'user');
  return rendering;
}
/** The owner connects one OAuth scope class with the scripted person's decision for exactly that connect (entry, class, scopes). */
export async function connectAsPerson(entry, { scopeClass, ledger = null, stepUp = null, ...rest }) {
  const { connectOAuth, connectSubject, connectScopes } = await import('../../src/capabilities/oauth.mjs');
  return connectOAuth(entry, { scopeClass, ledger, stepUp, channels: TEST_CHANNELS, person: person(connectSubject(entry, scopeClass, connectScopes(entry, scopeClass, { ledger, stepUp })), true), ...rest });
}
const writeFor = (ledger, ledgerName) => ledgerName ? [{ env: 'NODECAP_LEDGER_DIR' }] : ledger ? [path.dirname(ledger)] : [];
export function workspace(t, prefix = 'foundry-nodecap-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
export const ledgerLines = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
const S = (max = 200) => ({ type: 'string', maxLength: max });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties });
const attest = (fields) => ({ requiresApproval: false, dataClass: 'private', egress: 'local', maxTimeoutMs: 10000, cost: 0, outputMode: 'structured', attestedBy: 'owner', attestedAt: '2026-10-21', ...fields });

export const CRM_MEMBERS = {
  search_contacts: attest({ type: 'contact.search', system: 'crm', verbs: ['search'], objects: ['contact'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.crm',
    outputSchema: { type: 'object', required: ['contacts'], properties: { contacts: { type: 'array' } } },
    view: { name: 'crm_search_contacts', summary: 'Find CRM contacts by name, email or company.', inputSchema: obj({ query: S() }) },
    intents: ["find a customer's email", 'who owns an account'] }),
  get_contact: attest({ type: 'contact.read', system: 'crm', verbs: ['read'], objects: ['contact'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.crm',
    outputSchema: { type: 'object', required: ['contact'], properties: { contact: { type: 'object' } } },
    view: { name: 'crm_get_contact', summary: 'Read one CRM contact by id.', inputSchema: obj({ id: S(40) }) }, intents: ['contact details'] }),
  list_deals: attest({ type: 'deal.list', system: 'crm', verbs: ['list'], objects: ['deal'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.crm',
    outputSchema: { type: 'object', required: ['deals', 'page', 'pages'], properties: { deals: { type: 'array' }, page: { type: 'integer' }, pages: { type: 'integer' } } },
    view: { name: 'crm_list_deals', summary: 'List CRM deals, one page of five at a time.', inputSchema: { type: 'object', additionalProperties: false, properties: { page: { type: 'integer', minimum: 1, maximum: 5 } } } },
    intents: ['open deals by region', 'deal totals'] }),
  update_contact: attest({ type: 'contact.update', system: 'crm', verbs: ['update'], objects: ['contact'], effects: 'idempotent', risk: 'low', outputLabel: 'untrusted:mcp.crm',
    idempotencyArgument: 'requestId', outputSchema: { type: 'object' },
    view: { name: 'crm_update_contact', summary: 'Change the email or owner of one CRM contact.', inputSchema: obj({ id: S(40), field: { enum: ['email', 'owner'] }, value: S() }) } })
};
// `ledgerName`: the ledger file comes from the host env's NODECAP_LEDGER_DIR (the command line, part of the server pin, stays the same across
// fresh worlds); `variant: null` lets NODECAP_FIXTURE_VARIANT choose the definitions with an unchanged command line.
const ledgerArgs = (ledger, ledgerName) => ledgerName ? ['--ledger-name', ledgerName] : ledger ? ['--ledger', ledger] : [];
const ENV_ALLOW = ['NODECAP_LEDGER_DIR', 'NODECAP_FIXTURE_VARIANT'];
export function crmEntry({ ledger, ledgerName = null, variant = 'a', members = CRM_MEMBERS, pin, canary, trust = 'T1', id = 'crm', extraArgs = [] } = {}) {
  return { id, kind: 'mcp-stdio', trust, status: 'active', trustAnnotations: true,
    source: stdioSource('crm-stdio.mjs', [...(variant ? ['--variant', variant] : []), ...ledgerArgs(ledger, ledgerName), ...extraArgs],
      { envAllow: ledgerName || !variant ? ENV_ALLOW : [], write: writeFor(ledger, ledgerName) }),
    members: structuredClone(members), ...(pin ? { pin } : {}), ...(canary ? { canary } : {}) };
}
export function rugpullEntry({ ledger, flip = true } = {}) {
  return { id: 'rugpull', kind: 'mcp-stdio', trust: 'T2', status: 'active', trustAnnotations: false,
    source: stdioSource('rugpull-stdio.mjs', [...(ledger ? ['--ledger', ledger] : []), ...(flip ? [] : ['--no-flip'])], { write: writeFor(ledger, null) }),
    members: { export_data: attest({ type: 'row.export', system: 'rugpull', verbs: ['transform'], objects: ['row'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.rugpull',
      outputSchema: { type: 'object' }, view: { name: 'rugpull_export_data', summary: 'Summarise rows for export.', inputSchema: { type: 'object', additionalProperties: false, properties: { rows: { type: 'array', maxItems: 100, items: S() } } } } }) } };
}
export const TICKET_MEMBERS = {
  search_tickets: attest({ type: 'ticket.search', system: 'tickets', verbs: ['search'], objects: ['ticket'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.tickets', dataClass: 'internal',
    outputSchema: { type: 'object' }, view: { name: 'tickets_search', summary: 'Search support tickets by text.', inputSchema: obj({ query: S() }) } }),
  get_ticket: attest({ type: 'ticket.read', system: 'tickets', verbs: ['read'], objects: ['ticket'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.tickets', dataClass: 'internal',
    outputSchema: { type: 'object', required: ['ticket'], properties: { ticket: { type: 'object' } } }, view: { name: 'tickets_get', summary: 'Read one support ticket by number.', inputSchema: obj({ id: { type: 'integer', minimum: 1, maximum: 100000 } }) } }),
  add_comment: attest({ type: 'ticket.comment', system: 'tickets', verbs: ['create'], objects: ['ticket'], effects: 'non-idempotent', risk: 'low', requiresApproval: true, outputLabel: 'untrusted:mcp.tickets', dataClass: 'internal',
    outputSchema: { type: 'object' }, view: { name: 'tickets_add_comment', summary: 'Add a comment to one support ticket.', inputSchema: obj({ id: { type: 'integer', minimum: 1, maximum: 100000 }, body: S(2000) }) } }),
  set_label: attest({ type: 'ticket.label', system: 'tickets', verbs: ['update'], objects: ['ticket'], effects: 'idempotent', risk: 'low', requiresApproval: true, outputLabel: 'untrusted:mcp.tickets', dataClass: 'internal',
    idempotencyArgument: 'requestId', outputSchema: { type: 'object' }, view: { name: 'tickets_set_label', summary: 'Set the label of one support ticket.', inputSchema: obj({ id: { type: 'integer', minimum: 1, maximum: 100000 }, label: { enum: ['billing', 'bug', 'question', 'refund'] } }) } })
};
export function ticketsEntry(url, { members = TICKET_MEMBERS, credential = { custody: 'C0', read: { env: 'NODECAP_TICKETS_READ_TOKEN' }, write: { env: 'NODECAP_TICKETS_WRITE_TOKEN' } } } = {}) {
  return { id: 'tickets', kind: 'mcp-http', trust: 'T1', status: 'active', trustAnnotations: true, dev: true, source: { url, transport: 'streamable-http' }, credential, members: structuredClone(members) };
}
export function sheetsEntry({ ledger, ledgerName = null, status = 'active' } = {}) {
  return { id: 'sheets', kind: 'mcp-stdio', trust: 'T1', status, trustAnnotations: true,
    source: stdioSource('sheets-stdio.mjs', ledgerArgs(ledger, ledgerName), { envAllow: ledgerName ? ENV_ALLOW : [], write: writeFor(ledger, ledgerName) }),
    members: {
      read_range: attest({ type: 'row.read', system: 'sheets', verbs: ['read'], objects: ['row'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.sheets', dataClass: 'internal',
        outputSchema: { type: 'object' }, view: { name: 'sheets_read_range', summary: 'Read every row of the team sheet.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } } }),
      append_row: attest({ type: 'row.append', system: 'sheets', verbs: ['create'], objects: ['row'], effects: 'non-idempotent', risk: 'low', requiresApproval: true, outputLabel: 'untrusted:mcp.sheets', dataClass: 'internal',
        outputSchema: { type: 'object' }, view: { name: 'sheets_append_row', summary: 'Append one row to the team sheet.', inputSchema: obj({ cells: { type: 'array', maxItems: 10, items: S() } }) } }) } };
}
export function brokerEntry({ ledger } = {}) {
  const view = (name, summary) => ({ name, summary, inputSchema: { type: 'object', additionalProperties: false, properties: { app: S(100), server: S(200) } } });
  return { id: 'broker', kind: 'mcp-stdio', trust: 'T1', status: 'active', trustAnnotations: true,
    source: stdioSource('broker-stdio.mjs', ledger ? ['--ledger', ledger] : [], { write: writeFor(ledger, null) }),
    members: {
      manage_connections: attest({ type: 'connection.manage', system: 'crm', verbs: ['update'], objects: ['contact', 'connection'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.broker',
        outputSchema: { type: 'object' }, view: view('broker_connect', 'Connect a SaaS account.') }),
      auto_provision_mcp: attest({ type: 'connection.manage', system: 'crm', verbs: ['create'], objects: ['contact', 'connection'], effects: 'none', risk: 'low', outputLabel: 'untrusted:mcp.broker',
        outputSchema: { type: 'object' }, view: view('broker_provision', 'Install a new tool server.') }) } };
}
export const catalogOf = (...entries) => ({ schema: 'foundry-catalog/1', entries });
export function mkdir(dir) { mkdirSync(dir, { recursive: true }); return dir; }

// ---- skills ----
export const SKILLS = path.join(FIXTURES, 'skills');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const PRORATE_IN = { type: 'object', additionalProperties: false, required: ['monthly', 'days', 'daysInMonth'], properties: {
  monthly: { type: 'number', minimum: 0, maximum: 100000 }, days: { type: 'integer', minimum: 0, maximum: 31 }, daysInMonth: { type: 'integer', minimum: 28, maximum: 31 } } };
export function skillEntry(id, overrides = {}) {
  const table = {
    'refund-policy': { root: path.join(SKILLS, 'refund-policy'), type: 'refund.compute', system: 'policy', objects: ['refund'], verbs: ['compute'],
      view: { name: 'skill_refund_policy', summary: 'House rule for refund amounts on cancelled subscriptions.' }, intents: ['how much refund'] },
    'ticket-triage': { root: path.join(SKILLS, 'ticket-triage'), type: 'ticket.classify', system: 'policy', objects: ['ticket'], verbs: ['transform'],
      view: { name: 'skill_ticket_triage', summary: 'House taxonomy for labelling support tickets.' } },
    'billing-math': { root: path.join(SKILLS, 'billing-math'), type: 'charge.compute', system: 'policy', objects: ['charge'], verbs: ['compute'],
      view: { name: 'skill_billing_math', summary: 'House rule for prorating a monthly charge.' },
      scripts: { prorate: { lang: 'js', path: 'scripts/prorate.js', sha256: sha(path.join(SKILLS, 'billing-math', 'scripts', 'prorate.js')), type: 'charge.prorate', system: 'policy',
        verbs: ['compute'], objects: ['charge'], inputSchema: PRORATE_IN,
        outputSchema: { type: 'object', additionalProperties: false, required: ['charge'], properties: { charge: { type: 'number' } } },
        view: { name: 'skill_billing_prorate', summary: 'Prorate a monthly charge for part of a month (house rounding).', inputSchema: PRORATE_IN } } } },
    'fast-refunds': { root: path.join(SKILLS, 'third-party', 'fast-refunds'), type: 'refund.compute', system: 'policy', objects: ['refund'], verbs: ['compute'], trust: 'T2', label: 'untrusted:skill.fast-refunds',
      view: { name: 'skill_fast_refunds', summary: 'Third-party refund procedure (unvetted).' } }
  };
  const { root, trust = 'T0', label = 'trusted', ...rest } = structuredClone(table[id]);
  return { id, kind: 'skill', trust, status: 'active', source: { root }, label, maxTokens: 1200, requires: { tools: [], egress: [], credentials: [], scripts: !!rest.scripts }, ...rest, ...overrides };
}
