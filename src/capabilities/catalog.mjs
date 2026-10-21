// Host capability catalog (`foundry-catalog/1`): the owner's inventory of MCP servers, skills, computer-use surfaces, connections and
// builtins, every value an owner attestation. ARCHITECTURE.md §2.1 and §3.2. The catalog is an explicitly selected owner file (JSONC),
// never auto-loaded from a workspace; it holds credential REFERENCES (env names, keychain service/account), never values. Mutable host
// records (status after quarantine, observed pins, receipts, proposals) live in the nodecap ledger (./ledger.mjs), not in this file.
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import { checkData, clone } from '../data.mjs';
import { validateData } from '../validate.mjs';
import { CUSTODY, DATA_CLASSES, digest, EFFECTS, EGRESS, fail, LABEL, TRUST, VERBS } from './common.mjs';

const ID = '^[a-z][a-z0-9-]{0,40}$';
const ENV = '^[A-Z][A-Z0-9_]*$';
const PINV = '^sha256:[0-9a-f]{64}$';
const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
export const KINDS = Object.freeze(['mcp-stdio', 'mcp-http', 'skill', 'cua', 'connection', 'builtin', 'program']);
export const STATUSES = Object.freeze(['imported', 'qualified', 'active', 'quarantined', 'revoked']);
const secretRef = { type: 'object', additionalProperties: false, minProperties: 1, maxProperties: 1, properties: {
  env: { type: 'string', pattern: ENV, maxLength: 128 },
  keychain: { type: 'object', additionalProperties: false, required: ['service', 'account'], properties: {
    service: { type: 'string', pattern: '^[A-Za-z0-9._-]{1,128}$' }, account: { type: 'string', pattern: '^[A-Za-z0-9._@-]{1,128}$' } } } } };
const scopeList = { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', pattern: '^[A-Za-z0-9_.:/-]{1,80}$' } };
// OAuth (src/capabilities/oauth.mjs): an owner-attested issuer, a pre-registered public client id, and the scopes of each scope class.
// The tokens live in the OS keychain under the credential's read and write refs (custody C1); the catalog never holds a token.
const oauthSchema = { type: 'object', additionalProperties: false, required: ['issuer', 'clientId', 'scopes'], properties: {
  issuer: { type: 'string', minLength: 8, maxLength: 2048 }, clientId: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,200}$' },
  scopes: { type: 'object', additionalProperties: false, required: ['read', 'write'], properties: { read: scopeList, write: scopeList } } } };
const credential = { type: 'object', additionalProperties: false, required: ['custody'], properties: {
  custody: { enum: CUSTODY }, read: secretRef, write: secretRef, oauth: oauthSchema, scopes: { type: 'object', additionalProperties: false, properties: {
    read: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 120 } }, write: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 120 } } } } } };
const view = { type: 'object', additionalProperties: false, required: ['name', 'summary', 'inputSchema'], properties: {
  name: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' }, summary: { type: 'string', minLength: 1, maxLength: 200 }, inputSchema: { type: 'object' } } };
const classification = {
  type: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,40}(\\.[a-z][a-z0-9-]{0,40}){1,3}$' }, system: { type: 'string', pattern: ID },
  verbs: { type: 'array', minItems: 1, maxItems: 8, items: { enum: VERBS } },
  objects: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', pattern: ID } },
  intents: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 120 } }
};
/** One attested member: what the owner vouches a tool does, and the Foundry-authored view a model may see. */
export const memberSchema = { type: 'object', additionalProperties: false,
  required: ['type', 'system', 'verbs', 'objects', 'effects', 'risk', 'outputLabel', 'dataClass', 'egress', 'maxTimeoutMs', 'cost', 'outputMode', 'outputSchema', 'view', 'attestedBy', 'attestedAt'],
  properties: { ...classification,
    effects: { enum: EFFECTS }, risk: { enum: ['low', 'high'] }, requiresApproval: { type: 'boolean' },
    outputLabel: { type: 'string', pattern: LABEL, maxLength: 200 }, dataClass: { enum: DATA_CLASSES }, egress: { enum: EGRESS },
    maxTimeoutMs: { type: 'integer', minimum: 1, maximum: 600000 }, cost: { type: 'number', minimum: 0, maximum: 1000 },
    outputMode: { enum: ['structured', 'json-text', 'text'] }, outputSchema: { type: 'object' }, modelViewTokens: { type: 'integer', minimum: 16, maximum: 20000 },
    idempotencyArgument: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]*$' },
    view, argMap: { type: 'object', maxProperties: 64, additionalProperties: { type: 'string', pattern: '^(/[A-Za-z0-9_-]{1,64}){1,4}$' } },
    scopes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 120 } },
    capability: { type: 'string', pattern: '^core\\.[a-z]+$' },
    attestedBy: { const: 'owner' }, attestedAt: { type: 'string', pattern: DATE } } };
const scriptSchema = { type: 'object', additionalProperties: false, required: ['lang', 'path', 'sha256', 'inputSchema', 'outputSchema', 'view', 'type', 'system', 'verbs', 'objects'],
  properties: { ...classification, lang: { enum: ['js', 'python'] }, path: { type: 'string', pattern: '^scripts/[A-Za-z0-9_.-]{1,64}$' }, sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, view, maxTimeoutMs: { type: 'integer', minimum: 1, maximum: 60000 } } };
const entrySchema = { type: 'object', additionalProperties: false, required: ['id', 'kind', 'trust'], properties: {
  id: { type: 'string', pattern: ID }, kind: { enum: KINDS }, trust: { enum: TRUST }, status: { enum: STATUSES }, dev: { type: 'boolean' },
  trustAnnotations: { type: 'boolean' }, source: { type: 'object' }, connection: { type: 'string', pattern: ID }, credential,
  pin: { type: 'object', additionalProperties: false, required: ['server', 'tools', 'clientInfo'], properties: {
    server: { type: 'string', pattern: PINV }, tools: { type: 'object', additionalProperties: { type: 'string', pattern: PINV } },
    clientInfo: { const: 'workflow-foundry-nodecap/1' }, listedAt: { type: 'string', maxLength: 40 } } },
  canary: { type: 'object', additionalProperties: false, required: ['tool', 'args', 'answerHash'], properties: {
    tool: { type: 'string', maxLength: 128 }, args: { type: 'object' }, answerHash: { type: 'string', pattern: PINV } } },
  members: { type: 'object', maxProperties: 200, additionalProperties: memberSchema },
  // skill entries
  manifest: { type: 'string', pattern: PINV }, label: { type: 'string', pattern: LABEL, maxLength: 200 }, maxTokens: { type: 'integer', minimum: 16, maximum: 5000 },
  requires: { type: 'object', additionalProperties: false, properties: {
    tools: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 128 } }, egress: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 } },
    credentials: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 128 } }, scripts: { type: 'boolean' } } },
  view: { type: 'object', additionalProperties: false, required: ['name', 'summary'], properties: { name: view.properties.name, summary: view.properties.summary } },
  ...classification,
  scripts: { type: 'object', maxProperties: 20, additionalProperties: scriptSchema },
  // cua entries
  login: { type: 'object', additionalProperties: false, required: ['path', 'user', 'password'], properties: { path: { type: 'string', pattern: '^/[A-Za-z0-9/_-]{0,100}$' }, user: secretRef, password: secretRef } },
  limits: { type: 'object', additionalProperties: false, properties: { maxSteps: { type: 'integer', minimum: 1, maximum: 200 }, observationTokens: { type: 'integer', minimum: 100, maximum: 20000 } } },
  // connection entries
  provider: { type: 'string', pattern: ID }, origins: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 200 } } } };
export const catalogSchema = { type: 'object', additionalProperties: false, required: ['schema', 'entries'], properties: {
  schema: { const: 'foundry-catalog/1' }, entries: { type: 'array', maxItems: 500, items: entrySchema } } };

const sourceSchemas = {
  'mcp-stdio': { type: 'object', additionalProperties: false, required: ['command', 'args'], properties: {
    command: { type: 'string', minLength: 1, maxLength: 4096 }, args: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 4096 } },
    cwd: { type: 'string', maxLength: 4096 }, envAllow: { type: 'array', maxItems: 30, items: { type: 'string', pattern: ENV } } } },
  'mcp-http': { type: 'object', additionalProperties: false, required: ['url', 'transport'], properties: {
    url: { type: 'string', minLength: 8, maxLength: 2048 }, transport: { const: 'streamable-http' } } },
  skill: { type: 'object', additionalProperties: false, required: ['root'], properties: { root: { type: 'string', minLength: 1, maxLength: 4096 } } },
  cua: { type: 'object', additionalProperties: false, required: ['backend', 'origins', 'profile'], properties: {
    backend: { const: 'playwright-local' }, executablePath: { type: 'string', maxLength: 4096 }, origins: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', maxLength: 200 } },
    profile: { enum: ['S0'] }, holdPaths: { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,40}$' } } } },
  connection: { type: 'object', additionalProperties: false, properties: {} },
  builtin: { type: 'object', additionalProperties: false, properties: {} }
};

// Credential VALUES never belong in a catalog: names only. Key-like prefixes and long high-entropy tokens are refused anywhere in the file
// (pins `sha256:<hex>` and plain paths/URLs are not secrets).
const KEY_PREFIX = /^(sk-|sk_|ghp_|gho_|ghs_|github_pat_|xox[abprs]-|AKIA|ASIA|AIza|glpat-|eyJ[A-Za-z0-9_-]{8,}\.)/;
function entropy(text) {
  const counts = new Map(); for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return [...counts.values()].reduce((sum, n) => sum - (n / text.length) * Math.log2(n / text.length), 0);
}
export function secretLike(value) {
  if (typeof value !== 'string') return false;
  if (KEY_PREFIX.test(value)) return true;
  if (value.length < 32 || /\s/.test(value) || /^sha256:[0-9a-f]{64}$/.test(value) || /^[0-9a-f]{64}$/.test(value) || value.includes('/') || value.includes('.')) return false;
  return /[A-Za-z]/.test(value) && /[0-9]/.test(value) && entropy(value) >= 4.0;
}
function scanSecrets(value, at = '$') {
  if (typeof value === 'string') { if (secretLike(value)) fail('CATALOG_SECRET_VALUE', `The catalog holds a credential-like value at ${at}; catalogs hold env or keychain names only`, { path: at }); return; }
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (secretLike(key)) fail('CATALOG_SECRET_VALUE', `Credential-like key at ${at}`); scanSecrets(child, `${at}.${key}`); }
}
const loopback = url => { try { const u = new URL(url); return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname); } catch { return false; } };

/** Check a parsed catalog object (closed keys, per-kind sources, secret scan, dev gating). Returns a deep copy with defaults applied. */
export function checkCatalog(catalog, { allowDev = false } = {}) {
  checkData(catalog);
  scanSecrets(catalog);
  validateData(catalogSchema, catalog, 'host capability catalog', { trustedSchema: true });
  const ids = new Set(), out = clone(catalog);
  for (const entry of out.entries) {
    if (ids.has(entry.id)) fail('CATALOG_DUPLICATE', `Duplicate catalog entry id ${entry.id}`);
    ids.add(entry.id);
    if (entry.kind === 'program') fail('CATALOG_KIND_UNSUPPORTED', 'Program capabilities (CM0) are designed but not built in this spike; the entry is refused, not flattened', { id: entry.id });
    validateData(sourceSchemas[entry.kind], entry.source ?? {}, `catalog entry ${entry.id} source`, { trustedSchema: true });
    if (entry.dev === true && !allowDev) fail('CATALOG_DEV_ENTRY', `Entry ${entry.id} is a development (loopback) entry; it loads only with allowDev`, { id: entry.id });
    if (entry.kind === 'mcp-http') {
      const url = entry.source.url;
      if (!url.startsWith('https://') && !(entry.dev === true && loopback(url))) fail('CATALOG_TRANSPORT', `Entry ${entry.id}: remote MCP servers must use https (loopback http only for dev entries)`, { id: entry.id });
    }
    const oauth = entry.credential?.oauth;
    if (oauth) {
      if (!['mcp-http', 'connection'].includes(entry.kind)) fail('CATALOG_OAUTH', `Entry ${entry.id}: OAuth applies to remote MCP servers (MCP authorization: stdio servers take credentials from the environment)`);
      if (entry.credential.custody !== 'C1' || !entry.credential.read?.keychain || !entry.credential.write?.keychain) fail('CATALOG_OAUTH', `Entry ${entry.id}: OAuth tokens are held in the OS keychain (custody C1) under keychain read and write refs`);
      if (!oauth.issuer.startsWith('https://') && !(entry.dev === true && loopback(oauth.issuer))) fail('CATALOG_TRANSPORT', `Entry ${entry.id}: the authorization server must use https (loopback http only for dev entries)`);
    }
    if (entry.kind === 'cua') for (const origin of entry.source.origins) if (!origin.startsWith('https://') && !(entry.dev === true && loopback(origin))) fail('CATALOG_TRANSPORT', `Entry ${entry.id}: UI origins must be https (loopback http only for dev entries)`);
    if (['mcp-stdio', 'mcp-http', 'builtin'].includes(entry.kind) && !entry.members) fail('CATALOG_MEMBERS', `Entry ${entry.id} attests no members; an unattested tool is never bindable`, { id: entry.id });
    if (entry.kind === 'skill' && (!entry.view || !entry.type || !entry.system)) fail('CATALOG_MEMBERS', `Skill entry ${entry.id} needs an owner view, type and system`);
    for (const [name, member] of Object.entries(entry.members ?? {})) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(name)) fail('CATALOG_MEMBERS', `Entry ${entry.id}: member name ${name.slice(0, 40)} is outside the registry name profile`);
      if (member.effects === 'idempotent' && !member.idempotencyArgument && entry.kind !== 'builtin') fail('CATALOG_IDEMPOTENCY', `Entry ${entry.id}/${name}: an idempotent external tool needs an idempotencyArgument contract`);
      if (entry.kind === 'builtin' && !member.capability) fail('CATALOG_MEMBERS', `Builtin member ${entry.id}/${name} must name a core capability`);
    }
    entry.status ??= 'imported';
  }
  const connections = new Map(out.entries.filter(e => e.kind === 'connection').map(e => [e.id, e]));
  for (const entry of out.entries) if (entry.connection && !connections.has(entry.connection)) fail('CATALOG_CONNECTION', `Entry ${entry.id} names unknown connection ${entry.connection}`);
  return out;
}

/** Load an explicitly selected catalog file. Symlinks, files over 1 MiB, invalid JSONC and every refusal of checkCatalog are refused. */
export function loadCatalog(file, { allowDev = false } = {}) {
  const info = lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile()) fail('CATALOG_PATH', 'The catalog must be a regular file, not a symlink');
  if (info.size > 1024 * 1024) fail('CATALOG_SIZE', 'The catalog is larger than 1 MiB');
  const canonical = realpathSync(file), text = readFileSync(canonical, 'utf8'), errors = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: false, disallowComments: false });
  if (errors.length) fail('CATALOG_SYNTAX', `Catalog is not valid JSONC: ${errors.slice(0, 3).map(e => `${printParseErrorCode(e.error)}@${e.offset}`).join(', ')}`);
  const catalog = checkCatalog(parsed, { allowDev });
  return { catalog, path: canonical, dir: path.dirname(canonical), digest: catalogDigest(catalog) };
}

export const catalogDigest = catalog => `sha256:${digest(catalog)}`;
/** Current status: the ledger's record wins over the file's initial status (quarantine and revocation happen only through the ledger). */
export function entryStatus(entry, ledger = null) { return ledger?.status(entry.id)?.status ?? entry.status ?? 'imported'; }
export const bindable = (entry, ledger = null) => entry.trust !== 'T3' && entryStatus(entry, ledger) === 'active';
