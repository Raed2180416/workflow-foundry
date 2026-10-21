// Member records: one callable unit of a catalog entry (an MCP tool, a skill, a skill script, a ui.* action, a builtin), with the owner's
// attestation, the Foundry-authored view a model may see, and the pins its implementation digest binds. ARCHITECTURE.md §2.2 and §3.6.
import { clone } from '../data.mjs';
import { digest, fail, LABEL } from './common.mjs';

const ATTESTED = ['type', 'system', 'verbs', 'objects', 'intents', 'effects', 'risk', 'requiresApproval', 'outputLabel', 'dataClass', 'egress', 'maxTimeoutMs', 'cost',
  'outputMode', 'outputSchema', 'idempotencyArgument', 'modelViewTokens', 'scopes', 'capability'];
export const custodyOf = (entry, catalog = null) => entry.credential?.custody ?? (entry.connection ? catalog?.entries.find(e => e.id === entry.connection)?.credential?.custody : null) ?? null;

/** Build a member record. `id` defaults to `<prefix>.<entry>.<name>` (mcp. for MCP kinds). */
export function memberRecord({ entry, name, attestation, pins, adapter, id = null, custody = undefined, extra = {} }) {
  const view = clone(attestation.view);
  if (!new RegExp(LABEL).test(attestation.outputLabel)) fail('MEMBER_LABEL', `Member ${entry.id}/${name} has an invalid output label`);
  const attested = Object.fromEntries(ATTESTED.filter(k => attestation[k] !== undefined).map(k => [k, clone(attestation[k])]));
  attested.requiresApproval ??= attested.risk === 'high';
  attested.intents ??= [];
  const record = {
    id: id ?? `${entry.kind.startsWith('mcp') ? 'mcp' : entry.kind}.${entry.id}.${name}`, entryId: entry.id, kind: entry.kind, tool: name, trust: entry.trust,
    custody: custody === undefined ? custodyOf(entry) : custody, ...attested, view, argMap: attestation.argMap ? clone(attestation.argMap) : null,
    pins: clone(pins), attestationHash: `sha256:${digest(attested)}`, viewHash: `sha256:${digest(view)}`, ...extra
  };
  record.implementation = `sha256:${digest({ entryId: entry.id, pins: record.pins, viewHash: record.viewHash, attestationHash: record.attestationHash, adapter })}`;
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(record.id)) fail('MEMBER_NAME', `Member id ${record.id.slice(0, 60)} is outside the registry name profile`);
  return record;
}

// ---- Foundry-authored renderings (the only text about a member a model sees; never server or skill prose for untrusted sources) ----
const typeOf = s => s?.enum ? `one of ${s.enum.map(v => JSON.stringify(v)).join('|')}` : Array.isArray(s?.type) ? s.type.join('|') : s?.type === 'array' ? `array of ${typeOf(s.items)}` : s?.type ?? 'any';
/** A compact argument signature from a view schema: `query: string (≤200), limit?: integer`. */
export function signature(schema) {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([k, s]) => `${k}${required.has(k) ? '' : '?'}: ${typeOf(s)}${s?.maxLength ? ` (≤${s.maxLength})` : ''}`).join(', ');
}
export const renderView = member => `${member.view.name}(${signature(member.view.inputSchema)}) — ${member.view.summary}${member.effects !== 'none' ? ' [effect: needs approval]' : ''}`;
export const renderIndexLine = member => `${member.view.name} — ${member.view.summary}`;
/** What a lock stores of a member: the record minus nothing secret (records hold refs and pins only). */
export const lockView = member => clone(member);
