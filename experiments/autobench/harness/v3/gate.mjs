// harness/v3 commit gate (ATTACK §6 Move 2): before any write reaches the world, the planned effect is checked against Δ*
// (requirement-ledger-v3/dstar.mjs) and the effect registry (registry.mjs):
//   P  a HARD prohibition of Δ* forbids it: a message to an excluded member's address, a channel post, a message or a new
//      record that names an excluded member, a change to a record Δ* says must not get it;
//   K  its entity key was already committed (a duplicate is a no-op by algebra: refused, never re-sent);
//   O  whether it discharges an obligation of Δ* (a recipient, channel, app or record Δ* expects to change). A write that
//      discharges none is UNEXPLAINED: HELD by default (ATTACK Move 2: "admitted with a certificate ... or held"),
//      admitted only under `holdUnexplained: false`, and in every case reported (an UNKNOWN of the three-valued verdict,
//      never a pass).
// Fail closed (review of 2026-11-04, finding 10): a call the gate cannot read is HELD, never treated as a read: a tool
// outside the harness's known tools, arguments that do not parse, a body without a method, a non-GET call whose facts do
// not decode. A hard ban of Δ* that no call-level rule can enforce (a sheet-row ban: the call does not carry the row's
// identity) is listed in `rules.unenforced` and attached to every write of its app as `unverified`, an UNKNOWN.
// An admitted write gets a certificate {key, op, discharges, witness}: the witness is a READ-BACK SPEC (app, kind,
// recipients, channels, ids, name) with status 'pending'; witnessHolds() confirms it against the world's own changes
// (kinetic proofreading: the second discrimination step consumes the world's state, not the actor's plan or the tool's
// own reply). A certificate whose witness was never confirmed is a claim, not evidence.
// The gate is a pure function of (Δ*, registry state, call): it never reads the actor's brief, plan or self-report.
// Generic by construction (PREREG-AB-v1 H7/H8). Call arguments are untrusted data.
import { callFacts, createRegistry, identityOf, isWrite, routes, normText } from './registry.mjs';
import { containsLiteral, norm } from '../../verifier/requirement-ledger-v3/lib.mjs';

export const GATE_VERSION = 'v3-gate-v2';
/** Tools of the harness that cannot change the world (the AutomationBench tool set: a docs search and an encoder). Any
 *  other tool but api_fetch is unknown to the gate and held. */
export const READ_TOOLS = Object.freeze(new Set(['api_search', 'base64_encode']));
export const WRITE_TOOL = 'api_fetch';
const ROUTES = routes();
const MESSAGE_KINDS = new Set(['email', 'chat', 'dm', 'sms', 'social', 'reply', 'esign']);

// What a message is ABOUT: the code-enumerated members (universe.mjs) whose full label it names. Two messages to one
// recipient under one subject are one effect only when they are about the same members (a re-send, however reworded);
// per-item messages about different members are different effects. (Found on the dev60 replay, in-sample, disclosed:
// recipient + subject alone conflated three per-employee approval requests into one key.)
export function aboutIndex(universes) {
  const out = [];
  for (const u of universes ?? []) for (const m of u.members ?? []) { const f = norm(m.label); if (f.length >= 4 && /[a-z]/.test(f)) out.push({ key: m.key, f }); }
  return out;
}
export const aboutOf = (facts, idx) => [...new Set(idx.filter(x => containsLiteral(facts.text, x.f) === 'exact').map(x => x.key))].sort();
const idTail = key => String(key ?? '').split(/[:/]/).pop();

const appOfPtr = p => { const m = /^([a-z0-9_]+)[.:]/i.exec(String(p ?? '')); return m ? m[1].toLowerCase() : null; };

/** Compile Δ*'s hard prohibitions and its obligations into call-level rules; a hard ban no call-level rule can enforce
 *  goes to `unenforced` (never silently dropped). */
export function gateRules(dstar) {
  const prohibit = [], expect = [], unenforced = [];
  for (const a of dstar?.assertions ?? []) {
    const c = a.check, P = c.params ?? {};
    if (a.polarity === 'must_not' && a.status === 'hard') {
      const sheetRow = /^google_sheets:row:/.test(String(P.ptr ?? ''));
      let rule = null, why = 'no call-level rule exists for this check';
      if (c.type === 'msg_none' && P.target?.email) rule = { id: a.id, kind: 'recipient', email: P.target.email.toLowerCase(), origin: a.origin };
      else if (c.type === 'post_none' && P.target?.channel) rule = { id: a.id, kind: 'channel', channel: P.target.channel, origin: a.origin };
      else if (c.type === 'msg_lacks_any' || c.type === 'msg_lacks') rule = { id: a.id, kind: 'mention', target: P.target ?? {}, lits: P.lits ?? [P.lit], origin: a.origin };
      else if (c.type === 'created_none_any' || c.type === 'created_none') rule = { id: a.id, kind: 'create-mention', app: P.app || null, container: P.container ?? null, lits: P.lits ?? [P.lit], origin: a.origin };
      else if ((c.type === 'rec_unchanged' || c.type === 'rec_kept') && P.ptr && !sheetRow) rule = { id: a.id, kind: 'record', recordId: idTail(P.ptr), scope: P.scope ?? 'any', deleteOnly: c.type === 'rec_kept', origin: a.origin };
      else if (c.type === 'rec_field_not' && P.ptr && !sheetRow) rule = { id: a.id, kind: 'record-field', recordId: idTail(P.ptr), field: P.field, value: P.value, origin: a.origin };
      else if (sheetRow) why = 'a sheet-row ban: a write call does not carry the row identity the ban names';
      if (rule) prohibit.push(rule);
      else unenforced.push({ id: a.id, type: c.type, origin: a.origin, app: P.app || appOfPtr(P.ptr) || (P.target?.email ? 'gmail' : P.target?.channel ? 'slack' : null), about: P.ptr ?? P.target ?? null, why });
    } else if (a.polarity === 'must') {
      if (P.target?.email) expect.push({ id: a.id, kind: 'recipient', email: P.target.email.toLowerCase() });
      else if (P.target?.channel) expect.push({ id: a.id, kind: 'channel', channel: P.target.channel });
      else if (P.target?.ptr || P.ptr) expect.push({ id: a.id, kind: 'record', recordId: idTail(P.target?.ptr ?? P.ptr) });
      else if (P.app) expect.push({ id: a.id, kind: 'app', app: P.app, container: P.container ?? null });
    }
  }
  return { prohibit, expect, unenforced };
}

const channelHit = (facts, ch) => facts.channels.some(x => [ch?.id, ch?.name].filter(Boolean).some(y => norm(y) === norm(x)));
const namesAny = (text, lits) => (lits ?? []).find(l => l && containsLiteral(text, l) === 'exact') ?? null;

/** The violations of one write: [{rule, why}] */
export function violationsOf(facts, rules) {
  const out = [];
  const isMessage = MESSAGE_KINDS.has(facts.channelKind);
  for (const r of rules.prohibit) {
    if (r.kind === 'recipient' && isMessage && facts.recipients.includes(r.email)) out.push({ rule: r, why: `a message to ${r.email}` });
    else if (r.kind === 'channel' && isMessage && channelHit(facts, r.channel)) out.push({ rule: r, why: `a post in #${r.channel.name ?? r.channel.id}` });
    else if (r.kind === 'mention' && isMessage) {
      const t = r.target;
      const toTarget = t.email ? facts.recipients.includes(String(t.email).toLowerCase()) : t.channel ? channelHit(facts, t.channel) : t.ptr ? facts.ids.includes(idTail(t.ptr)) : true;
      const lit = toTarget ? namesAny(facts.text, r.lits) : null;
      if (lit) out.push({ rule: r, why: `names "${lit}"` });
    } else if (r.kind === 'create-mention' && facts.effect === 'create' && (!r.app || r.app === facts.app) && (!r.container || facts.ids.includes(r.container) || normText(facts.url).includes(normText(r.container)))) {
      const lit = namesAny(facts.text, r.lits);
      if (lit) out.push({ rule: r, why: `a new ${facts.app} record names "${lit}"` });
    } else if (r.kind === 'record' && facts.ids.includes(r.recordId) && (r.deleteOnly ? facts.effect === 'delete' : r.scope === 'reply' ? ['reply', 'note'].includes(facts.channelKind) || /note|repl|comment|part/i.test(facts.op ?? '') : ['update', 'delete'].includes(facts.effect) || ['reply', 'note'].includes(facts.channelKind))) out.push({ rule: r, why: `changes record ${r.recordId}` });
    else if (r.kind === 'record-field' && facts.ids.includes(r.recordId) && facts.effect === 'update' && namesAny(facts.text, [r.value])) out.push({ rule: r, why: `sets ${r.field} to "${r.value}" on ${r.recordId}` });
  }
  return out;
}

/** The obligations a write discharges (ids). */
export function dischargesOf(facts, rules) {
  const out = [];
  for (const e of rules.expect) {
    if (e.kind === 'recipient' && facts.recipients.includes(e.email)) out.push(e.id);
    else if (e.kind === 'channel' && channelHit(facts, e.channel)) out.push(e.id);
    else if (e.kind === 'record' && facts.ids.includes(e.recordId)) out.push(e.id);
    else if (e.kind === 'app' && e.app === facts.app && (!e.container || facts.ids.includes(e.container) || normText(facts.url).includes(normText(e.container)))) out.push(e.id);
  }
  return out;
}

/** The read-back spec of an admitted write: what the world must show afterwards. */
export function witnessOf(facts) {
  return { app: facts.app ?? null, kind: facts.channelKind ?? facts.effect, effect: facts.effect, recipients: facts.recipients.slice(0, 8), channels: facts.channels.slice(0, 4), ids: facts.ids.slice(0, 8), name: facts.name || facts.subject || '', status: 'pending' };
}

/** Does the world's own change list ({changes: [{op, app, coll, id, record, ref}]}) show a witness? A message: a new
 *  record of the app addressed to one of its recipients or posted in one of its channels; a reply or an update: a change
 *  to one of its ids; a create: a new record of the app (naming it, when it has a name); a delete: a deleted id. */
export function witnessHolds(w, diff) {
  const changes = diff?.changes ?? [];
  const sameApp = c => !w.app || c.app === w.app;
  const text = c => normText(JSON.stringify(c.record ?? {}));
  const idHit = c => w.ids.some(id => String(c.id) === String(id) || Object.values(c.ref ?? {}).map(String).includes(String(id)) || text(c).includes(normText(id)));
  if (MESSAGE_KINDS.has(w.kind) && w.kind !== 'reply') {
    return changes.some(c => c.op === 'created' && sameApp(c) && (w.recipients.some(e => text(c).includes(e)) || w.channels.some(ch => text(c).includes(normText(ch)))));
  }
  if (w.kind === 'reply' || w.kind === 'note' || w.effect === 'update') return changes.some(c => (c.op === 'updated' || c.op === 'created') && sameApp(c) && idHit(c));
  if (w.effect === 'delete') return changes.some(c => c.op === 'deleted' && sameApp(c) && idHit(c));
  if (w.effect === 'create') return changes.some(c => c.op === 'created' && sameApp(c) && (!w.name || text(c).includes(normText(w.name))));
  return changes.some(sameApp);
}

/**
 * createGate({dstar, registry, holdUnexplained, identity, universes, readTools}) -> {check(call) -> decision, rules, registry}
 * (universes: the code-enumerated universes Δ* was built over; a message's key then carries the members it is about)
 * (identity defaults to registry.mjs identityOf, v2; the replay passes identityOfV1 to reproduce the first measurement)
 * decision: {action: 'read'|'admit'|'refuse'|'hold', reason?, key, violations, duplicate, discharges, unexplained,
 *   unverified, certificate}
 * A refused or held write is not committed and not recorded. An identical retry of a refused write is refused again
 * (the refusal is the Δ* rule, not a counter): the actor must change the effect, not repeat it.
 */
export function createGate({ dstar, registry = createRegistry(), holdUnexplained = true, rs = ROUTES, identity = identityOf, universes = null, readTools = READ_TOOLS } = {}) {
  const rules = gateRules(dstar);
  const about = aboutIndex(universes);
  const hold = (reason, extra = {}) => ({ action: 'hold', reason, undecodable: true, violations: [], discharges: [], ...extra });
  return {
    rules, registry,
    check(call) {
      const name = call?.name;
      if (readTools.has(name)) return { action: 'read' };
      if (name !== WRITE_TOOL) return hold(`unknown tool ${JSON.stringify(String(name ?? '')).slice(0, 60)}: it may change the world and the gate cannot read it`);
      let args = call.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { return hold('the arguments do not parse'); } }
      if (!args || typeof args !== 'object' || Array.isArray(args)) return hold('the arguments do not parse');
      const method = args.method === undefined || args.method === null || String(args.method).trim() === '' ? null : String(args.method).toUpperCase();
      const hasBody = args.body !== undefined && args.body !== null && args.body !== '';
      if (method === null && hasBody) return hold('a body without a method');
      let facts;
      try { facts = callFacts({ ...call, arguments: args }, rs); } catch { facts = null; }
      if (!facts) return (method ?? 'GET') === 'GET' ? { action: 'read' } : hold('a write whose facts do not decode');
      if (method !== null && method !== 'GET' && !facts.route) { try { new URL(facts.url); } catch { return hold('a write to a URL that does not parse'); } }
      if (!isWrite(facts)) return { action: 'read', facts };
      const base = identity(facts);
      const members = about.length && MESSAGE_KINDS.has(facts.channelKind) ? aboutOf(facts, about) : [];
      const key = members.length ? `${base}|about:${members.join(',')}` : base;
      const duplicate = registry.seen(key);
      const violations = violationsOf(facts, rules);
      const discharges = dischargesOf(facts, rules);
      const unexplained = !discharges.length;
      const unverified = rules.unenforced.filter(u => u.app && u.app === facts.app).map(u => u.id);
      let action = 'admit';
      if (violations.length || duplicate) action = 'refuse';
      else if (unexplained && holdUnexplained) action = 'hold';
      const decision = { action, key, facts, violations, duplicate, discharges, unexplained, unverified, ...(action === 'hold' ? { reason: 'an unexplained write: it discharges no obligation of Δ*' } : {}) };
      if (action === 'admit') {
        registry.record(key, { op: facts.op });
        decision.certificate = { key, op: facts.op, discharges, unverified, witness: witnessOf(facts), version: GATE_VERSION };
      }
      return decision;
    },
    /** After the world answered an admitted write: a failed write releases its key (the effect did not happen). The
     *  tool's reply is only a hint; the certificate's witness is confirmed by witnessHolds on the world's changes. */
    settle(decision, ok) { if (decision?.action === 'admit' && !ok) registry.forget(decision.key); },
  };
}

/** Did the world accept a write? A tool result whose JSON carries an error, ok: false or an HTTP status >= 400 did not. */
export function writeSucceeded(result) {
  const c = result?.content ?? result;
  let j = c;
  if (typeof c === 'string') { try { j = JSON.parse(c); } catch { return !/\b(error|failed|not found|invalid)\b/i.test(c.slice(0, 200)); } }
  if (j && typeof j === 'object') {
    if (j.error || j.errors || j.ok === false) return false;
    const st = Number(j.status ?? j.statusCode ?? j.code);
    if (Number.isFinite(st) && st >= 400) return false;
  }
  return true;
}
