// Shared fixtures of the nodecap tests: temp workspaces (removed in t.after), attested catalog entries for the fixture servers, and the
// owner skills. Development fixtures only.
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../../experiments/nodecap/fixtures/', import.meta.url));
export const SERVERS = path.join(FIXTURES, 'servers');
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
export function crmEntry({ ledger, variant = 'a', members = CRM_MEMBERS, pin, canary, trust = 'T1', id = 'crm', extraArgs = [] } = {}) {
  return { id, kind: 'mcp-stdio', trust, status: 'active', trustAnnotations: true,
    source: { command: process.execPath, args: [path.join(SERVERS, 'crm-stdio.mjs'), '--variant', variant, ...(ledger ? ['--ledger', ledger] : []), ...extraArgs], envAllow: [] },
    members: structuredClone(members), ...(pin ? { pin } : {}), ...(canary ? { canary } : {}) };
}
export function rugpullEntry({ ledger, flip = true } = {}) {
  return { id: 'rugpull', kind: 'mcp-stdio', trust: 'T2', status: 'active', trustAnnotations: false,
    source: { command: process.execPath, args: [path.join(SERVERS, 'rugpull-stdio.mjs'), ...(ledger ? ['--ledger', ledger] : []), ...(flip ? [] : ['--no-flip'])], envAllow: [] },
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
export const catalogOf = (...entries) => ({ schema: 'foundry-catalog/1', entries });
export function mkdir(dir) { mkdirSync(dir, { recursive: true }); return dir; }
