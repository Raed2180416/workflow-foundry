// harness/v3 commit gate (ATTACK §6 Move 2): before any write reaches the world, the planned effect is checked against Δ*
// (requirement-ledger-v3/dstar.mjs) and the effect registry (registry.mjs):
//   P  a HARD prohibition of Δ* forbids it: a message to an excluded member's address, a channel post, a message or a new
//      record that names an excluded member, a change to a record Δ* says must not get it;
//   K  its entity key was already committed (a duplicate is a no-op by algebra: refused, never re-sent);
//   O  whether it discharges an obligation of Δ* (a recipient, channel, app or record Δ* expects to change). A write that
//      discharges none is UNEXPLAINED: admitted under the default policy, held under `holdUnexplained`, and in every case
//      reported (it is an UNKNOWN of the three-valued verdict, never a pass).
// An admitted write gets a certificate {key, op, discharges, witness}: the witness names the entity a read-back must show
// (kinetic proofreading: the second discrimination step consumes the world's own state, not the actor's plan).
// The gate is a pure function of (Δ*, registry state, call): it never reads the actor's brief, plan or self-report.
// Generic by construction (PREREG-AB-v1 H7/H8). Call arguments are untrusted data.
import { callFacts, createRegistry, identityOf, isWrite, routes, normText } from './registry.mjs';
import { containsLiteral, norm } from '../../verifier/requirement-ledger-v3/lib.mjs';

export const GATE_VERSION = 'v3-gate-v1';
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

/** Compile Δ*'s hard prohibitions and its obligations into call-level rules. */
export function gateRules(dstar) {
  const prohibit = [], expect = [];
  for (const a of dstar?.assertions ?? []) {
    const c = a.check, P = c.params ?? {};
    if (a.polarity === 'must_not' && a.status === 'hard') {
      if (c.type === 'msg_none' && P.target?.email) prohibit.push({ id: a.id, kind: 'recipient', email: P.target.email.toLowerCase(), origin: a.origin });
      else if (c.type === 'post_none' && P.target?.channel) prohibit.push({ id: a.id, kind: 'channel', channel: P.target.channel, origin: a.origin });
      else if (c.type === 'msg_lacks_any' || c.type === 'msg_lacks') prohibit.push({ id: a.id, kind: 'mention', target: P.target ?? {}, lits: P.lits ?? [P.lit], origin: a.origin });
      else if (c.type === 'created_none_any' || c.type === 'created_none') prohibit.push({ id: a.id, kind: 'create-mention', app: P.app || null, container: P.container ?? null, lits: P.lits ?? [P.lit], origin: a.origin });
      else if ((c.type === 'rec_unchanged' || c.type === 'rec_kept') && P.ptr && !/^google_sheets:row:/.test(P.ptr)) prohibit.push({ id: a.id, kind: 'record', recordId: idTail(P.ptr), scope: P.scope ?? 'any', deleteOnly: c.type === 'rec_kept', origin: a.origin });
      else if (c.type === 'rec_field_not' && P.ptr && !/^google_sheets:row:/.test(P.ptr)) prohibit.push({ id: a.id, kind: 'record-field', recordId: idTail(P.ptr), field: P.field, value: P.value, origin: a.origin });
    } else if (a.polarity === 'must') {
      if (P.target?.email) expect.push({ id: a.id, kind: 'recipient', email: P.target.email.toLowerCase() });
      else if (P.target?.channel) expect.push({ id: a.id, kind: 'channel', channel: P.target.channel });
      else if (P.target?.ptr || P.ptr) expect.push({ id: a.id, kind: 'record', recordId: idTail(P.target?.ptr ?? P.ptr) });
      else if (P.app) expect.push({ id: a.id, kind: 'app', app: P.app, container: P.container ?? null });
    }
  }
  return { prohibit, expect };
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

/**
 * createGate({dstar, registry, holdUnexplained, identity, universes}) -> {check(call) -> decision, rules, registry}
 * (universes: the code-enumerated universes Δ* was built over; a message's key then carries the members it is about)
 * (identity defaults to registry.mjs identityOf, v2; the replay passes identityOfV1 to reproduce the first measurement)
 * decision: {action: 'read'|'admit'|'refuse'|'hold'|'undecodable', key, violations, duplicate, discharges, unexplained, certificate}
 * A refused or held write is not committed and not recorded. An identical retry of a refused write is refused again
 * (the refusal is the Δ* rule, not a counter): the actor must change the effect, not repeat it.
 */
export function createGate({ dstar, registry = createRegistry(), holdUnexplained = false, rs = ROUTES, identity = identityOf, universes = null } = {}) {
  const rules = gateRules(dstar);
  const about = aboutIndex(universes);
  return {
    rules, registry,
    check(call) {
      const facts = callFacts(call, rs);
      if (!facts) {
        let method = 'GET';
        try { method = String(JSON.parse(call?.arguments ?? '{}').method ?? 'GET').toUpperCase(); } catch { /* not JSON */ }
        return { action: method === 'GET' ? 'read' : 'undecodable' };
      }
      if (!isWrite(facts)) return { action: 'read', facts };
      const base = identity(facts);
      const members = about.length && MESSAGE_KINDS.has(facts.channelKind) ? aboutOf(facts, about) : [];
      const key = members.length ? `${base}|about:${members.join(',')}` : base;
      const duplicate = registry.seen(key);
      const violations = violationsOf(facts, rules);
      const discharges = dischargesOf(facts, rules);
      const unexplained = !discharges.length;
      let action = 'admit';
      if (violations.length || duplicate) action = 'refuse';
      else if (unexplained && holdUnexplained) action = 'hold';
      const decision = { action, key, facts, violations, duplicate, discharges, unexplained };
      if (action === 'admit') {
        registry.record(key, { op: facts.op });
        decision.certificate = { key, op: facts.op, discharges, witness: `read back ${facts.app ?? '?'} ${facts.channelKind ?? facts.effect} ${(facts.recipients[0] ?? facts.channels[0] ?? facts.ids[0] ?? '')}`.trim(), version: GATE_VERSION };
      }
      return decision;
    },
    /** After the world answered an admitted write: a failed write releases its key (the effect did not happen). */
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
