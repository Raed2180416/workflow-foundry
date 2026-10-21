// MCP import, qualification and invocation, ARCHITECTURE.md §3.3. Turns an attested catalog entry plus a live listing into pinned member
// records; guards every call with the pins (always re-listed before an effectful call; refused before sending on any change, I9); maps
// results into typed outputs without letting server prose or error text reach a model (I11).
import { compileDataSchema } from '../validate.mjs';
import { portableSchemaViolations } from '../schema-subset.mjs';
import { checkData } from '../data.mjs';
import { digest, effectRank, fail, FoundryError, pinOf, sha256 } from './common.mjs';
import { comparePins, serverDigest, toolDigest } from './pin.mjs';
import { custodyOf, memberRecord } from './members.mjs';

/**
 * What a tool's annotations say about its effects, honoured only for trusted servers (trust T0/T1 with trustAnnotations). Untrusted:
 * non-idempotent, high, approval. The MCP spec: clients MUST consider annotations untrusted unless they come from trusted servers.
 */
export function annotationFloor(entry, annotations = {}, { idempotencyArgument = null } = {}) {
  const trusted = ['T0', 'T1'].includes(entry.trust) && entry.trustAnnotations === true;
  if (!trusted) return { effects: 'non-idempotent', risk: 'high', requiresApproval: true, trusted };
  const a = annotations ?? {};
  if (a.readOnlyHint === true) return { effects: 'none', risk: 'low', requiresApproval: false, trusted };
  const destructive = a.destructiveHint !== false; // absent means true (spec default)
  const effects = a.idempotentHint === true && !destructive && idempotencyArgument ? 'idempotent' : 'non-idempotent';
  return { effects, risk: destructive ? 'high' : 'low', requiresApproval: destructive, trusted };
}
/** Explicit hints that are TIGHTER than the owner's attestation (an attested read that the server calls destructive): a conflict, never a loosening. */
export function hintConflict(annotations = {}, attested) {
  const a = annotations ?? {};
  let hinted = null;
  if (a.readOnlyHint === false || a.destructiveHint === true) hinted = a.idempotentHint === true && a.destructiveHint === false ? 'idempotent' : 'non-idempotent';
  if (a.destructiveHint === true && attested.risk === 'low' && attested.effects !== 'none') return { attested: attested.effects, hinted: 'non-idempotent', field: 'destructiveHint' };
  return hinted && effectRank(hinted) > effectRank(attested.effects) ? { attested: attested.effects, hinted, field: a.destructiveHint === true ? 'destructiveHint' : 'readOnlyHint' } : null;
}
/** A schema a member exposes must be inside the portable subset (src/schema-subset.mjs) and compile under the strict validator. */
export function checkMemberSchema(schema, where) {
  const violations = portableSchemaViolations(schema);
  if (violations.length) fail('SCHEMA_PROFILE_UNSUPPORTED', `${where}: schema outside the supported subset (${violations.slice(0, 3).map(v => `${v.path} ${v.keyword ?? ''}`).join('; ')})`, { violations: violations.slice(0, 10) });
  try { compileDataSchema(schema); } catch (error) { fail('SCHEMA_PROFILE_UNSUPPORTED', `${where}: ${error.code}`); }
  return schema;
}

/** Pins of a fresh listing. */
export function pinsOf(entry, listing) {
  const tools = Object.fromEntries(listing.tools.map(tool => [tool.name, toolDigest(tool)]));
  return { server: serverDigest({ entry, ...listing, toolDigests: tools }), tools, clientInfo: 'workflow-foundry-nodecap/1' };
}

/**
 * Qualify one MCP entry: list, pin, compare with the attested pin (if any), check each attested member exists, map annotations, refuse
 * schemas outside the subset, and build member records. A pin mismatch quarantines the entry (DEFINITION_CHANGED); a tighter hint than the
 * attestation quarantines it too (ATTESTATION_HINT_CONFLICT). Returns { pins, tools, members }.
 */
export async function qualifyMcp(entry, connection, { ledger = null } = {}) {
  // The notification count BEFORE listing: a list_changed that races the listing marks the pins stale (an extra re-list, never a miss).
  const changesBefore = connection.listChanges ?? 0, listedAt = Date.now();
  const listing = await connection.listAll();
  const pins = pinsOf(entry, listing), byName = new Map(listing.tools.map(t => [t.name, t]));
  if (entry.pin) {
    const compared = comparePins(entry.pin, pins);
    if (!compared.ok) {
      ledger?.quarantine(entry.id, 'DEFINITION_CHANGED', { changed: compared.changed.map(c => c.tool), added: compared.added, removed: compared.removed });
      fail('DEFINITION_CHANGED', `Server ${entry.id} no longer matches its attested pin`, { entry: entry.id, changed: compared.changed.map(c => c.tool), added: compared.added, removed: compared.removed, serverChanged: compared.serverChanged });
    }
  }
  ledger?.recordPins(entry.id, pins);
  const members = [];
  for (const [name, attestation] of Object.entries(entry.members ?? {})) {
    const tool = byName.get(name);
    if (!tool) fail('MEMBER_TOOL_MISSING', `Attested tool ${entry.id}/${name} is not listed by the server`, { entry: entry.id, tool: name });
    const conflict = hintConflict(tool.annotations, attestation);
    if (conflict) {
      ledger?.quarantine(entry.id, 'ATTESTATION_HINT_CONFLICT', { tool: name, ...conflict });
      fail('ATTESTATION_HINT_CONFLICT', `${entry.id}/${name}: the server's hints are tighter than the owner's attestation`, { entry: entry.id, tool: name, ...conflict });
    }
    checkMemberSchema(attestation.view.inputSchema, `${entry.id}/${name} view`);
    compileDataSchema(attestation.outputSchema);
    members.push(memberRecord({ entry, name, attestation, pins: { server: pins.server, tool: pins.tools[name] }, adapter: 'nodecap-mcp/1' }));
  }
  return { pins, tools: Object.fromEntries(byName), members, changesBefore, listedAt };
}

/**
 * The pin guard of one entry: re-lists when the TTL lapses, after a list_changed notification, and always before an effectful call;
 * on any difference it quarantines the entry and refuses with DEFINITION_CHANGED {fieldDiff} before the call is sent.
 */
export class PinGuard {
  // `verifiedAt`/`seenChanges`: when the pins were last checked against a listing on this connection, and the notification count before
  // that listing (qualification returns both as listedAt/changesBefore); the defaults force a first re-list.
  constructor(entry, connection, { pins, tools = {}, ttlMs = 60000, ledger = null, now = Date.now, verifiedAt = 0, seenChanges = 0 } = {}) {
    Object.assign(this, { entry, connection, pins, tools, ttlMs, ledger, now, verifiedAt, seenChanges, broken: null, relists: 0 });
  }
  /** Stale after a list_changed notification (counted by the connection, so one that arrived before this guard existed still counts) or the TTL. */
  get stale() { return (this.connection.listChanges ?? 0) !== this.seenChanges || this.now() - this.verifiedAt >= this.ttlMs; }
  async check({ force = false } = {}) {
    if (this.broken) throw this.broken;
    if (!force && !this.stale) return true;
    this.relists++;
    const changes = this.connection.listChanges ?? 0;
    const listing = await this.connection.listAll();
    const observed = pinsOf(this.entry, listing), after = Object.fromEntries(listing.tools.map(t => [t.name, t]));
    const compared = comparePins(this.pins, observed, { before: this.tools, after });
    if (!compared.ok) {
      const fieldDiff = compared.changed.map(c => ({ tool: c.tool, fields: c.fields }));
      this.ledger?.quarantine(this.entry.id, 'DEFINITION_CHANGED', { fieldDiff, added: compared.added, removed: compared.removed });
      this.broken = new FoundryError('DEFINITION_CHANGED', `Server ${this.entry.id} changed its definitions since they were pinned; the call was not sent`, { entry: this.entry.id, fieldDiff, added: compared.added, removed: compared.removed });
      throw this.broken;
    }
    this.verifiedAt = this.now(); this.seenChanges = changes;
    return true;
  }
}

const MAX_OUTPUT = 512 * 1024;
/** Map one view-level argument object onto the member's arguments (argMap view-pointer → member-pointer; identity without one). */
export function mapArgs(argMap, args) {
  if (!argMap) return args;
  const out = {};
  for (const [from, to] of Object.entries(argMap)) {
    const value = from.split('/').slice(1).reduce((v, k) => v && typeof v === 'object' && Object.hasOwn(v, k) ? v[k] : undefined, args);
    if (value === undefined) continue;
    const keys = to.split('/').slice(1);
    let cursor = out;
    for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
    cursor[keys.at(-1)] = value;
  }
  return out;
}
/** Turn a CallToolResult into the member's typed output. Error text is hashed, never returned; undeclared non-text content is refused. */
export function toOutput(member, result) {
  if (result?.isError) {
    const text = (result.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
    fail('MCP_TOOL_ERROR', `${member.id} reported an error`, { textHash: sha256(text), bytes: Buffer.byteLength(text) });
  }
  let value;
  if (member.outputMode === 'structured') {
    if (result?.structuredContent === undefined) fail('MCP_OUTPUT', `${member.id} returned no structuredContent`);
    value = result.structuredContent;
  } else {
    if (!Array.isArray(result?.content) || result.content.some(part => part.type !== 'text')) fail('MCP_OUTPUT', `${member.id} returned non-text content it does not declare`);
    const text = result.content.map(part => part.text).join('\n');
    if (member.outputMode === 'text') value = { text };
    else { try { value = JSON.parse(text); } catch { fail('MCP_OUTPUT', `${member.id} returned malformed JSON text`); } }
  }
  checkData(value, { maxBytes: MAX_OUTPUT });
  return value;
}
/** Call one MCP member: pin check (forced for effects), argument mapping, scope by effects, typed output. */
export async function invokeMcp(member, { connection, guard }, args, { signal, idempotencyKey } = {}) {
  await guard.check({ force: member.effects !== 'none' });
  let bound = mapArgs(member.argMap, args);
  if (member.idempotencyArgument) bound = { ...bound, [member.idempotencyArgument]: idempotencyKey };
  const result = await connection.call(member.tool, bound, { signal, timeoutMs: member.maxTimeoutMs, scope: member.effects === 'none' ? 'read' : 'write' });
  return toOutput(member, result);
}
/** Known-answer canary: a fixed read whose answer hash the owner attested at qualification. A changed answer quarantines the entry. */
export async function runCanary(entry, connection, { ledger = null } = {}) {
  if (!entry.canary) return { ran: false };
  const result = await connection.call(entry.canary.tool, entry.canary.args, { scope: 'read' });
  const answer = result?.structuredContent ?? (result?.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
  const answerHash = pinOf({ answer });
  if (answerHash !== entry.canary.answerHash) {
    ledger?.quarantine(entry.id, 'BEHAVIOUR_CHANGED', { tool: entry.canary.tool });
    fail('BEHAVIOUR_CHANGED', `Server ${entry.id} answered its known-answer canary differently`, { entry: entry.id });
  }
  return { ran: true, answerHash };
}
export const canaryHash = answer => pinOf({ answer });
export { custodyOf, digest };
