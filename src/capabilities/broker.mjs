// The adaptive broker and the tool-node dispatcher, ARCHITECTURE.md §2.3, §2.4 and §3.7.
//
// Adaptivity ladder inside a run:
//   L1  auto-bind: a standby member inside the envelope (effects none, low risk, trusted source, no cost, authored view, I6, Rule of Two)
//       is granted by code, with no model call and no person; the grant is an `adaptation` decision in the run's hash chain.
//   L2  per-call approval: an effectful standby member is reachable only through nodecap.act, which the engine gates with a user approval
//       bound to (workflow, registry, node, exact arguments); the dispatcher verifies that decision in the chain AND a person's decision
//       (./person.mjs) for the host's own rendering of the call (describeCall: the member, its arguments, and for ui.commit the held
//       request as the host recorded it, body included) before calling. A person never approves a model's account of an effect.
//   L3  out of lock: a need nothing in bound ∪ standby can meet raises a proposal a person decides on the dashboard or CLI (never a model,
//       a signal, or an MCP elicitation) and comes back to the node as a CAPABILITY_GAP refusal: the node may still finish with what it
//       holds; if it ends without an answer, the run ends with a typed CAPABILITY_GAP (nodecap.close), and approval yields lock N+1 and a
//       continuation run (review-thesis #5: a gap no longer kills the node on the spot).
// Routing is by the TOOL's effects, never the model's label (review-thesis #6): an `act` on an effects-none tool is a read; an `act` on an
// effectful tool is first checked by nodecap.do (the tool is in reach, its arguments match its view, a ui.commit names a held request) and
// only then reaches the engine's approval gate, so a person is never asked about a call that cannot run.
// Nothing here widens the lock: find never widens, a signal cannot grant, grants die with the run (THESIS D11).
// Cheap-model fit (review-cost 2026-10-22): a need's object, system and kind rank, they never exclude (B2); a request that names a tool
// asks for exactly that tool (B1); a need nothing in reach matches first shows the nearest members and asks for confirmation, and only a
// repeated request raises a proposal (B2); L1 grants are code inside the envelope and are not counted against acquire.max (m1); the log
// keeps the need and ends a node that repeats one refused call a third time (M4).
import { clone } from '../data.mjs';
import { validateData } from '../validate.mjs';
import { approxTokens, digest, fail, FoundryError, isPrivate, refusal, toolNodeOf } from './common.mjs';
import { subjectOf } from './person.mjs';
import { autoBind, denyListed } from './envelope.mjs';
import { entryStatus } from './catalog.mjs';
import { indexMembers } from './rank.mjs';
import { renderView } from './members.mjs';
import { viewIndex } from './resolve.mjs';
import { decisionRecord, nodecapDecisions, record } from './journal.mjs';
import { stepUpProposal } from './oauth.mjs';

/** Selection thresholds for a typed need (score ≥ τ and margin ≥ δ grant a single best match). Development defaults; NC-1 freezes them on D1-D6. */
export const THRESHOLDS = Object.freeze({ tau: 1.0, delta: 0.5 });
const TRANSCRIPT_BYTES = 24 * 1024;
// Verbs that change something: a request with one of them (and no explicit effect) asks for an effectful tool. A read verb asks for a
// read; any other verb (transform, compute, observe, navigate) leaves the class to the ranking: the top match decides (review-cost B1).
const CHANGING_VERBS = new Set(['create', 'update', 'delete', 'send']);
const READ_VERBS = new Set(['read', 'search', 'list']);
/** Ranking boosts of a need's typed fields (review-cost B2): they order the whole lock section, never filter it. A grant still needs text
 *  evidence (score ≥ τ): typed fields alone never grant. Development defaults, like THRESHOLDS. */
export const NEED_BOOSTS = Object.freeze({ verb: 0.5, object: 0.5, system: 0.5, kind: 0.25 });
const kindOf = m => m.kind === 'skill' ? 'skill' : m.kind === 'cua' ? 'ui' : 'tool';
/** A need is an object with at least a verb, an object or a why (the decision schema requires verb and object when a need is given). */
export const isNeed = need => !!need && typeof need === 'object' && !Array.isArray(need) && ['verb', 'object', 'why'].some(k => typeof need[k] === 'string');
const round3 = x => Math.round(x * 1000) / 1000;

/**
 * Rank members for a need (review-cost B2): BM25F over the authored text on the need's words, plus a boost for each of the need's verb,
 * object and system the member is attested with (`match`), plus a smaller one for its kind (`order`). Nothing is excluded: a mistyped
 * verb, object, system or kind only costs rank. Best first; ties by text score, then id.
 */
export function rankNeed(members, need) {
  const query = ['verb', 'object', 'system', 'why'].map(k => need?.[k]).filter(v => typeof v === 'string').join(' ');
  const text = members.length ? new Map(indexMembers(members).rank(query, members.length).map(r => [r.id, r.score])) : new Map();
  return members.map(m => {
    const score = text.get(m.id) ?? 0;
    const match = score + (need?.verb && (m.verbs ?? []).includes(need.verb) ? NEED_BOOSTS.verb : 0) + (need?.object && m.objects.includes(need.object) ? NEED_BOOSTS.object : 0)
      + (need?.system && m.system === need.system ? NEED_BOOSTS.system : 0);
    return { id: m.id, score, match, order: match + (need?.kind && kindOf(m) === need.kind ? NEED_BOOSTS.kind : 0) };
  }).sort((a, b) => b.order - a.order || b.score - a.score || (a.id < b.id ? -1 : 1));
}
/**
 * The request rule, pure (I10: recomputable from the lock, the need and the named tool). `named`: the member the decision's `tool` names
 * in this node's index (review-cost B1: a request that names a tool asks for that tool). Otherwise the candidates are the members with
 * any match, of the need's effect class when the need states one (an explicit effect, or a changing or read verb), narrowed to the
 * members with the need's verb when any has it. No candidate: nothing in reach meets the need (L3).
 */
export function selectForNeed(lock, node, need, { tool = null } = {}) {
  const section = lock.nodes[node], ranked = rankNeed([...section.bound, ...section.skills, ...section.standby].map(id => lock.members[id]), need);
  const named = tool && tool !== 'none' ? viewIndex(lock, node).get(tool) ?? null : null;
  if (named) return { named, cls: null, ranked, candidates: [ranked.find(r => r.id === named)] };
  const cls = need.effect ? (need.effect === 'none' ? 'read' : 'effect') : CHANGING_VERBS.has(need.verb) ? 'effect' : READ_VERBS.has(need.verb) ? 'read' : null;
  const sameClass = ranked.filter(r => r.match > 0 && (cls === null || (lock.members[r.id].effects !== 'none') === (cls === 'effect')));
  const byVerb = need.verb ? sameClass.filter(r => (lock.members[r.id].verbs ?? []).includes(need.verb)) : [];
  return { named: null, cls, ranked, candidates: byVerb.length ? byVerb : sameClass };
}
/** Whether the first candidate is a decisive text match: its score clears τ and leads every other candidate's text score by δ. */
export function decisiveMatch(candidates, { tau, delta }) {
  const [top, ...rest] = candidates;
  return !!top && top.score >= tau && top.score - Math.max(0, ...rest.map(r => r.score)) >= delta;
}
/**
 * The decision of one typed request, pure (I10; the dispatcher records it, the selection dev split replays it). `held(id)`: the member is
 * bound or already granted to the node; `verdictOf(id)`: decideMember for it as a request. Outcomes: unmet (nothing in reach matches),
 * bound, needs-approval (an effectful top: never granted by a request), granted (an L1 read: named, or a decisive match), options (a
 * closed choice among usable candidates), refused (with the broker's code).
 */
export function decideRequest({ lock, node, need, tool = null, thresholds = THRESHOLDS, held = () => false, verdictOf }) {
  const selection = selectForNeed(lock, node, need, { tool }), { candidates } = selection;
  if (!candidates.length) return { outcome: 'unmet', selection };
  const [top] = candidates, member = lock.members[top.id];
  if (held(top.id)) return { outcome: 'bound', member: top.id, selection };
  const verdict = verdictOf(top.id);
  if (member.effects !== 'none') {
    if (verdict.code === 'NEED_UNTRUSTED_EFFECT' || verdict.code === 'NEED_EFFECTFUL') return { outcome: 'needs-approval', member: top.id, selection };
    return { outcome: 'refused', member: top.id, code: verdict.code, selection };
  }
  // A named member needs no score (the model asked for exactly it, as a read of it would); a ranked one must be a decisive match.
  if (verdict.result === 'granted' && (selection.named !== null || decisiveMatch(candidates, thresholds))) return { outcome: 'granted', member: top.id, selection };
  const options = candidates.filter(r => held(r.id) || verdictOf(r.id).result === 'granted').slice(0, 3);
  if (!options.length) return { outcome: 'refused', member: top.id, code: verdict.code ?? 'NEED_UNDECIDED', selection };
  return { outcome: 'options', member: top.id, options, selection };
}
/** What a model is told when a find or request carries no need: where the need goes, with an example from this node's own lock. */
export function needHelp(lock, node) {
  const section = lock.nodes[node], m = lock.members[[...section.standby, ...section.bound, ...section.skills][0]];
  const need = { verb: m?.verbs?.[0] ?? 'read', object: m?.objects?.[0] ?? 'other', why: 'what you need, in your own words' };
  return { hint: 'Put "need" beside "args" in the decision, not inside "args".', example: { action: 'request', tool: 'none', args: {}, need } };
}
/** Whether the user's decision for `approvalId` is in the chain AFTER its request (the runtime's own rule, src/runtime.mjs approvedInChain). */
export function approvedAfterRequest(events, approvalId) {
  const requested = events.findIndex(e => e.type === 'approval.requested' && e.approvalId === approvalId);
  return requested >= 0 && events.slice(requested + 1).some(e => e.type === 'approval.decided' && e.approvalId === approvalId && e.approved === true && e.actor === 'user');
}

/**
 * The pure broker rule for one member (I10: recomputable from the recorded features). `features`: { inBound, priorGrant, inStandby,
 * entryStatus, grantsSoFar, nodeGrantsSoFar, nodeGrantLimit, grantsPerRun, via, approvalId, controlLabel, holdsPrivate, holdsThirdParty }.
 * grantsSoFar and nodeGrantsSoFar count L2 grants (in the run, in the node): L1 grants are not limited by them (review-cost m1).
 */
export function decideMember(features, member, envelope) {
  if (features.inBound) return { result: 'bound' };
  if (features.priorGrant) return { result: 'bound', granted: true };
  if (!features.inStandby) return { result: 'refused', code: 'NOT_BOUND' };
  if (features.entryStatus !== 'active') return { result: 'refused', code: 'CAPABILITY_QUARANTINED' };
  if (denyListed(envelope, member)) return { result: 'refused', code: 'NEED_DENYLISTED' };
  if (member.effects !== 'none') {
    // The grant limits cap what goes beyond code (review-cost m1): L2 grants (a person approves each call) count against acquire.max and
    // grantsPerRun, L3 proposals against proposalsPerRun. An L1 grant is decided by code inside the envelope and counts against neither,
    // so a read the model did not need cannot spend the node's budget for the effect it does need.
    if (features.grantsSoFar >= features.grantsPerRun || features.nodeGrantsSoFar >= features.nodeGrantLimit) return { result: 'refused', code: 'GRANT_LIMIT' };
    // L2: only through nodecap.act, after the engine's user approval of this exact call.
    if (features.via === 'act' && features.approvalId) return { result: 'granted', level: 'L2' };
    return { result: 'refused', code: features.controlLabel !== 'trusted' ? 'NEED_UNTRUSTED_EFFECT' : 'NEED_EFFECTFUL' };
  }
  const verdict = autoBind(envelope, member, { controlLabel: features.controlLabel, holdsPrivate: features.holdsPrivate, holdsThirdParty: features.holdsThirdParty === true });
  return verdict.ok ? { result: 'granted', level: 'L1' } : { result: 'refused', code: verdict.code };
}

/** Bound a model-visible value to about `tokens` tokens (approximate, chars/4): trim the longest arrays first, else a text preview. */
export function boundView(value, tokens = 1500) {
  if (approxTokens(JSON.stringify(value)) <= tokens) return { value, truncated: false };
  const copy = clone(value);
  for (let guard = 0; guard < 200 && approxTokens(JSON.stringify(copy)) > tokens; guard++) {
    let longest = null;
    const visit = v => { if (Array.isArray(v)) { if (!longest || v.length > longest.length) longest = v; v.forEach(visit); } else if (v && typeof v === 'object') Object.values(v).forEach(visit); };
    visit(copy);
    if (!longest || longest.length <= 1) break;
    longest.length = Math.floor(longest.length / 2);
  }
  if (approxTokens(JSON.stringify(copy)) <= tokens) return { value: copy, truncated: true };
  return { value: { preview: JSON.stringify(value).slice(0, tokens * 4) }, truncated: true };
}

export class Dispatcher {
  /** host: NodecapHost; lock; lockHash; envelope; envelopeDigest; ledger (proposals); mode 'live' | 'practice'. */
  constructor({ host, lock, lockHash, envelope, envelopeDigest, ledger = null, mode = 'live', thresholds = THRESHOLDS }) {
    Object.assign(this, { host, lock, lockHash, envelope, envelopeDigest, ledger, mode, thresholds });
  }
  // ---- run state, rebuilt from the chain (the nodecap decisions and completed dispatcher outputs), never from a side table ----
  state(ctx, node) {
    const decisions = nodecapDecisions(ctx.store, ctx.runId), grants = new Set(), nodeGrants = new Set(), l2 = new Set(), nodeL2 = new Set();
    let proposals = 0, seq = 0;
    for (const d of decisions) {
      if (d.action?.result === 'granted') {
        grants.add(`${d.features.node}\u0000${d.action.member}`); if (d.features.node === node) nodeGrants.add(d.action.member);
        if (d.action.level === 'L2') { l2.add(`${d.features.node}\u0000${d.action.member}`); if (d.features.node === node) nodeL2.add(d.action.member); }
      }
      if (d.action?.result === 'proposal') proposals++;
      if (d.features.nodeKey === ctx.nodeKey) seq++;
    }
    const section = this.lock.nodes[node], reachable = [...section.bound, ...section.skills, ...nodeGrants].map(id => this.lock.members[id]);
    // Every call that reached a member counts against maxCallsPerMember, failed ones included: a server that fails every call (and asks
    // for a step-up each time) cannot buy itself unlimited turns.
    // maxCallsPerMember is a per-NODE budget (its lock section's): only this node's calls count (review-thesis #22).
    const calls = new Map(), own = new RegExp(`/${node}__loop:\\d+/(do|act)$`);
    for (const e of ctx.store.events(ctx.runId)) if (e.type === 'node.completed' && own.test(e.nodeKey ?? '') && e.output?.member) calls.set(e.output.member, (calls.get(e.output.member) ?? 0) + 1);
    // Every proposal raised in the run counts against proposalsPerRun, whichever path raised it (L3 gap, definition change, step-up).
    proposals = Math.max(proposals, this.ledger?.proposalsOfRun(ctx.runId).length ?? 0);
    // The Rule of Two counts private data the node holds through its members AND through its inputs (resolve records the input class).
    return { grantsSoFar: l2.size, nodeL2Grants: nodeL2.size, nodeGrants, proposals, seq, calls, holdsPrivate: reachable.some(m => isPrivate(m.dataClass)) || isPrivate(section.inputClass),
      holdsThirdParty: reachable.some(m => m.egress === 'third-party') };
  }
  features(ctx, node, memberId, state, { via, approvalId = null }) {
    const section = this.lock.nodes[node], member = this.lock.members[memberId], entry = this.host.entry(member.entryId);
    return { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, member: memberId, via,
      inBound: section.bound.includes(memberId) || section.skills.includes(memberId), priorGrant: state.nodeGrants.has(memberId), inStandby: section.standby.includes(memberId),
      entryStatus: entryStatus(entry, this.host.ledger), grantsSoFar: state.grantsSoFar, nodeGrantsSoFar: state.nodeL2Grants,
      nodeGrantLimit: section.acquire?.max ?? 0, grantsPerRun: this.envelope.limits.grantsPerRun, approvalId,
      controlLabel: section.controlLabel, holdsPrivate: state.holdsPrivate, holdsThirdParty: state.holdsThirdParty };
  }
  decide(ctx, kind, features, action, { need = null, rationale }) {
    const header = ctx.store.rows.header(ctx.runId), state = { seq: nodecapDecisions(ctx.store, ctx.runId).filter(d => d.features.nodeKey === ctx.nodeKey).length };
    return record(ctx, decisionRecord({ runId: ctx.runId, nodeKey: ctx.nodeKey, seq: state.seq, identity: header.identity, kind, features, action, need,
      controlLabel: this.lock.nodes[features.node].controlLabel, rationale }));
  }
  /** Implicit or explicit request for one member of the node's lock section. Records a decision unless the member is already held. */
  acquire(ctx, node, memberId, state, { via, approvalId = null, need = null }) {
    const features = this.features(ctx, node, memberId, state, { via, approvalId }), member = this.lock.members[memberId];
    const decision = decideMember(features, member, this.envelope);
    if (decision.result === 'bound') return decision;
    const id = this.decide(ctx, 'adaptation', features, { result: decision.result, member: memberId, ...(decision.code ? { code: decision.code } : {}), ...(decision.level ? { level: decision.level } : {}) },
      { need, rationale: decision.result === 'granted' ? `${decision.level} grant of ${memberId} by the broker` : `refused ${memberId}: ${decision.code}` });
    if (decision.result === 'granted') this.ledger?.cacheGrant(ctx.runId, node, memberId, id);
    return { ...decision, decisionId: id };
  }
  /**
   * Ranked authored views of the node's members for a need; out-of-lock catalog tools come back as names only. The whole section is
   * ranked (rankNeed: typed fields boost, never filter; review-cost B2); find shows the members with any match, or, when none has one, the
   * nearest members by kind hint.
   */
  find(node, need) {
    const section = this.lock.nodes[node], pool = [...section.bound, ...section.skills, ...section.standby].map(id => this.lock.members[id]);
    const all = rankNeed(pool, need), matched = all.filter(r => r.match > 0);
    const knownObjects = new Set(pool.flatMap(m => m.objects)), knownSystems = new Set(pool.map(m => m.system));
    const outsideFits = c => (!need.verb || (c.verbs ?? []).includes(need.verb))
      && (!need.system || (need.system === 'other' ? !knownSystems.has(c.system) : c.system === need.system))
      && (!need.object || (need.object === 'other' ? c.objects.some(o => !knownObjects.has(o)) : c.objects.includes(need.object)));
    // Outside this node's lock: qualified members the lock did not give this node, and catalog tools that did not qualify (T3, quarantined,
    // revoked, imported). Names only, for a proposal; never callable in this run.
    const inSection = new Set(pool.map(m => m.id));
    const qualified = [...this.host.members.values()].filter(m => !inSection.has(m.id)).map(m => ({ id: m.id, entry: m.entryId, trust: m.trust, status: entryStatus(this.host.entry(m.entryId), this.host.ledger),
      type: m.type, system: m.system, objects: m.objects, verbs: m.verbs, effects: m.effects, egress: m.egress, summary: m.view.summary }));
    const outside = [...qualified, ...this.host.outsideCandidates()].filter(outsideFits);
    // `ranked`: what find shows (five); `all`: the whole section in rank order.
    return { ranked: (matched.length ? matched : all).slice(0, 5), all, outside: outside.slice(0, 5) };
  }
  // ---- the dispatchers ----
  async do(args, ctx) {
    const { node } = toolNodeOf(ctx.nodeKey), section = this.lock.nodes[node];
    if (!section) fail('NODECAP_NODE_UNKNOWN', `No lock section for tool node ${node}`);
    const decision = args.decision, state = this.state(ctx, node);
    if (decision.action === 'find') {
      // A find without a need (or with its words put inside args) is refused with an example, never answered with every member (B2).
      if (!isNeed(decision.need)) return this.#out(ctx, refusal('NEED_REQUIRED', needHelp(this.lock, node)));
      const found = this.find(node, decision.need);
      this.decide(ctx, 'selection', { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, via: 'find', eligibleDigest: `sha256:${digest(found.ranked.map(r => r.id))}`, scores: found.ranked.map(r => round3(r.match)) },
        { result: 'options', options: found.ranked.map(r => r.id), outside: found.outside.map(c => c.id) }, { need: decision.need, rationale: 'find over the node lock section' });
      // Outside-lock candidates are host records for a proposal; the model learns only that some exist (never their ids or names).
      return this.#out(ctx, { ok: true, action: 'find', matches: found.ranked.map(r => renderView(this.lock.members[r.id])), outsideLock: found.outside.length });
    }
    if (decision.action === 'request') return this.#request(ctx, node, decision, state);
    if (decision.action !== 'read' && decision.action !== 'act') return this.#out(ctx, refusal('ACTION_UNSUPPORTED'));
    const memberId = viewIndex(this.lock, node).get(decision.tool);
    if (!memberId) return this.#out(ctx, refusal('TOOL_ABSENT', { hint: 'Use a tool listed under tools or standby, or action request with a need' }));
    const member = this.lock.members[memberId];
    // An act on an effectful tool: checked here, before the engine asks a person (nodecap.act runs only when this says ready).
    if (decision.action === 'act' && member.effects !== 'none') return this.#prepare(ctx, node, member, decision, state);
    // An act on an effects-none tool is a read: routing follows the tool's effects, never the model's label.
    if (member.effects !== 'none') return this.#out(ctx, refusal('EFFECT_CLASS_MISMATCH', { hint: 'This tool changes something: use action act' }));
    const granted = this.acquire(ctx, node, memberId, state, { via: 'implicit' });
    if (granted.result !== 'bound' && granted.result !== 'granted') return this.#out(ctx, refusal(granted.code, { tool: decision.tool }));
    return this.#call(ctx, node, member, decision, state);
  }
  async act(args, ctx) {
    const { node } = toolNodeOf(ctx.nodeKey), section = this.lock.nodes[node];
    if (!section) fail('NODECAP_NODE_UNKNOWN', `No lock section for tool node ${node}`);
    const decision = args.decision;
    // The engine gated this task (requiresApproval): verify the user's decision for these exact arguments is in the chain...
    const header = ctx.store.rows.header(ctx.runId);
    const approvalId = digest({ workflowHash: header.workflowHash, registryHash: header.registryHash, nodeKey: ctx.nodeKey, tool: 'nodecap.act', args, idempotencyKey: ctx.idempotencyKey });
    // (the decision must come AFTER this call's own request in the chain, as the runtime requires: review-thesis #23)
    if (!approvedAfterRequest(ctx.store.events(ctx.runId), approvalId)) fail('APPROVAL_MISSING', 'nodecap.act runs only after a user approved this exact call, after it was requested');
    // ...and that a person (an authenticated person channel, not the string 'user') approved the host's rendering of this call as it stands now.
    const rendering = await describeCall({ host: this.host, lock: this.lock, runId: ctx.runId, nodeKey: ctx.nodeKey, decision });
    if (this.ledger?.callDecision(callSubject(approvalId, rendering))?.approve !== true)
      fail('APPROVAL_MISSING', 'nodecap.act runs only after a person approved the host\'s rendering of this exact call');
    const memberId = viewIndex(this.lock, node).get(decision.tool);
    if (!memberId) return this.#out(ctx, refusal('TOOL_ABSENT'));
    const member = this.lock.members[memberId];
    if (member.effects === 'none') return this.#out(ctx, refusal('EFFECT_CLASS_MISMATCH', { hint: 'This tool has no effects: use action read' }));
    const state = this.state(ctx, node), granted = this.acquire(ctx, node, memberId, state, { via: 'act', approvalId });
    if (granted.result !== 'bound' && granted.result !== 'granted') return this.#out(ctx, refusal(granted.code, { tool: decision.tool }));
    return this.#call(ctx, node, member, decision, state);
  }
  /**
   * nodecap.do for an act on an effectful tool: every check that does not need the person, made BEFORE the engine asks one (review-thesis
   * #6): the tool is in reach for an L2 call (status, deny list, limits), its arguments match its authored view, its call budget is not
   * spent, and a ui.commit names a request the page holds. Ready means only "a person may now be asked"; nodecap.act re-checks all of it.
   */
  async #prepare(ctx, node, member, decision, state) {
    const verdict = decideMember(this.features(ctx, node, member.id, state, { via: 'act', approvalId: 'pending-approval' }), member, this.envelope);
    if (verdict.result !== 'bound' && verdict.result !== 'granted') return this.#out(ctx, refusal(verdict.code, { tool: decision.tool }));
    if ((state.calls.get(member.id) ?? 0) >= this.lock.nodes[node].maxCallsPerMember) return this.#out(ctx, refusal('BUDGET_EXHAUSTED', { tool: member.view.name }));
    try { validateData(member.view.inputSchema, decision.args ?? {}, `${member.id} arguments`); }
    catch (error) { if (!(error instanceof FoundryError)) throw error; return this.#out(ctx, refusal('ARGS_INVALID', { tool: member.view.name, signature: renderView(member) })); }
    if (member.kind === 'cua' && member.tool === 'commit' && !(await this.host.heldRequest({ runId: ctx.runId, node, entryId: member.entryId, id: decision.args?.id })))
      return this.#out(ctx, refusal('HELD_UNKNOWN', { tool: member.view.name, hint: 'commit names the id of a request the page holds (pending)' }));
    return this.#out(ctx, { ok: true, action: 'act', ready: true, tool: member.view.name, note: 'A person decides this call.' });
  }
  /**
   * A typed request (review-thesis #4, review-cost B1 and B2). A tool the decision names in this node's index is the one asked for.
   * Otherwise the whole section is ranked for the need (selectForNeed: typed fields boost, never filter), the need's effect class filters
   * when the need states one, its verb narrows when any candidate has it, and only the TOP candidate is ever granted, when its text score
   * clears τ and leads every other candidate's by δ. An effectful top answers needs-approval with its authored view (use act). A need
   * nothing in reach matches first answers NEED_UNMET with the nearest members; the same request again raises a proposal for a person and
   * comes back as a CAPABILITY_GAP refusal (the node continues; review-thesis #5).
   */
  async #request(ctx, node, decision, state) {
    const need = decision.need, section = this.lock.nodes[node];
    if (!isNeed(need)) return this.#out(ctx, refusal('NEED_REQUIRED', needHelp(this.lock, node)));
    const held = id => section.bound.includes(id) || section.skills.includes(id) || state.nodeGrants.has(id);
    const verdictOf = id => decideMember(this.features(ctx, node, id, state, { via: 'request' }), this.lock.members[id], this.envelope);
    const r = decideRequest({ lock: this.lock, node, need, tool: decision.tool, thresholds: this.thresholds, held, verdictOf });
    if (r.outcome === 'unmet') return this.#unmet(ctx, node, need, r.selection, state);
    const member = this.lock.members[r.member], view = renderView(member);
    switch (r.outcome) {
      case 'bound': return this.#out(ctx, { ok: true, action: 'request', result: 'bound', tool: member.view.name, ...(r.selection.named ? {} : { view }) });
      // An effect is never granted by a request: the model is pointed at act, where a person decides the exact call.
      case 'needs-approval': return this.#out(ctx, { ok: true, action: 'request', result: 'needs-approval', tool: member.view.name, view, hint: 'Use action act with this tool; a person approves the call.' });
      case 'refused':
        this.decide(ctx, 'adaptation', this.features(ctx, node, r.member, state, { via: 'request' }), { result: 'refused', member: r.member, code: r.code }, { need, rationale: `refused ${r.member}: ${r.code}` });
        return this.#out(ctx, refusal(r.code));
      case 'options':
        // A closed choice among the candidates this node could actually use (held, or grantable by L1); the model picks by reading one.
        this.decide(ctx, 'selection', { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, via: 'request', scores: r.options.map(o => round3(o.score)) },
          { result: 'options', options: r.options.map(o => o.id) }, { need, rationale: 'no decisive standby member: a closed choice' });
        return this.#out(ctx, { ok: true, action: 'request', result: 'options', options: r.options.map(o => renderView(this.lock.members[o.id])) });
      default: {
        const granted = this.acquire(ctx, node, r.member, state, { via: 'request', need });
        if (granted.result !== 'granted' && granted.result !== 'bound') return this.#out(ctx, refusal(granted.code));
        return this.#out(ctx, { ok: true, action: 'request', result: 'granted', tool: member.view.name, view });
      }
    }
  }
  /**
   * L3 (review-cost B2): nothing in reach matches the need. The first time, the node hears NEED_UNMET with the nearest members of its
   * section (a mistyped need costs one turn, not a person's attention); the same need again is confirmed and raises a proposal for a person
   * (never a model or a signal), which the node hears as a typed CAPABILITY_GAP and may continue past.
   */
  #unmet(ctx, node, need, selection, state) {
    const section = this.lock.nodes[node], needKey = `sha256:${digest({ node, need })}`;
    if (!nodecapDecisions(ctx.store, ctx.runId).some(d => d.action?.result === 'unmet' && d.action.needKey === needKey)) {
      const nearest = selection.ranked.slice(0, 3);
      this.decide(ctx, 'selection', { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, via: 'request', scores: nearest.map(r => round3(r.match)) },
        { result: 'unmet', needKey, options: nearest.map(r => r.id) }, { need, rationale: 'nothing in reach matches the need: the nearest members, and a confirmation before a person is asked' });
      return this.#out(ctx, refusal('NEED_UNMET', { nearest: nearest.map(r => renderView(this.lock.members[r.id])),
        hint: 'Nothing in reach matches this need. Use one of these tools, or send the same request again to ask a person for a new capability.' }));
    }
    if (state.proposals >= this.envelope.limits.proposalsPerRun) return this.#out(ctx, refusal('PROPOSAL_LIMIT'));
    const found = this.find(node, need), proposal = this.#propose(ctx, node, need, found.outside);
    this.decide(ctx, 'adaptation', { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, via: 'request', controlLabel: section.controlLabel,
      candidates: found.outside.map(c => c.id) }, { result: 'proposal', proposalId: proposal?.id ?? null }, { need, rationale: 'need outside the lock, confirmed: a proposal for a person; the node continues with what it holds' });
    return this.#out(ctx, refusal('CAPABILITY_GAP', { proposal: !!proposal, hint: 'Nothing in reach meets this need; a person will decide. Finish with the tools you have, or answer stuck.' }));
  }
  #propose(ctx, node, need, outside) {
    if (!this.ledger) return null;
    // Deny-listed candidates (by name, attested type or object class) are reported (flagged) but never offered for binding.
    const flags = c => [...(denyListed(this.envelope, c) ? ['deny-listed'] : []), ...(c.trust === 'T3' ? ['T3'] : []),
      ...(c.status !== 'active' ? [`status:${c.status}`] : []), ...(c.effects !== 'none' ? ['effectful'] : []), ...(c.egress === 'third-party' ? ['third-party-egress'] : [])];
    const riskSummary = { candidates: outside.map(c => ({ member: c.id, trust: c.trust, effects: c.effects, egress: c.egress, status: c.status, flags: flags(c) })),
      flags: [...new Set(outside.flatMap(flags))], noCandidate: outside.length === 0 };
    const header = ctx.store.rows.header(ctx.runId);
    const offered = outside.filter(c => !denyListed(this.envelope, c));
    // The definition each offered member had when the person was asked: its implementation (pins, view, attestation) when it qualified in
    // this process, else its attestation hash; binding refuses a member whose definition moved since (M2).
    const definition = c => { const m = this.host.member(c.id); return m ? { implementation: m.implementation, pins: m.pins, attestationHash: m.attestationHash } : { implementation: null, attestationHash: c.attestationHash ?? null }; };
    const dedupKey = `sha256:${digest({ kind: 'gap', flowId: this.lock.flowId, fromLockHash: this.lockHash, node, offered: offered.map(c => c.id) })}`;
    return this.ledger.openProposal(dedupKey) ?? this.ledger.putProposal({ kind: offered.some(c => c.status === 'active') ? 'capability.bind' : 'capability.admit', flowId: this.lock.flowId, fromWorkflowHash: header.workflowHash, fromLockHash: this.lockHash,
      node, need: { ...need, label: this.lock.nodes[node].controlLabel }, dedupKey,
      quoted: offered.map(c => ({ text: c.summary, label: 'untrusted:catalog', sourceHash: digest({ c: c.summary }) })),
      diff: { added: offered.map(c => ({ member: c.id, effects: c.effects, trust: c.trust, egress: c.egress, ...definition(c) })) }, riskSummary,
      evidence: { runId: ctx.runId, nodeKey: ctx.nodeKey } });
  }
  async #call(ctx, node, member, decision, state) {
    const section = this.lock.nodes[node];
    if ((state.calls.get(member.id) ?? 0) >= section.maxCallsPerMember) return this.#out(ctx, refusal('BUDGET_EXHAUSTED', { tool: member.view.name }));
    let result;
    try {
      result = await this.host.invoke(member.id, decision.args ?? {}, { runId: ctx.runId, node, signal: ctx.signal, idempotencyKey: ctx.idempotencyKey,
        artifactsDir: ctx.artifactsDir, practice: this.mode === 'practice', approved: member });
    } catch (error) {
      if (!(error instanceof FoundryError)) throw error;
      // Proposals raised by a failing call share the run's proposal limit and are de-duplicated: a hostile server cannot raise one per turn.
      const room = this.ledger && this.state(ctx, node).proposals < this.envelope.limits.proposalsPerRun;
      // Every proposal a call raises is also an adaptation decision in the run's chain (review-thesis #18), like a gap's.
      const chain = (proposal, rationale) => { if (proposal?.evidence?.runId === ctx.runId && !nodecapDecisions(ctx.store, ctx.runId).some(d => d.action?.proposalId === proposal.id))
        this.decide(ctx, 'adaptation', { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, via: 'call', member: member.id, controlLabel: this.lock.nodes[node].controlLabel },
          { result: 'proposal', proposalId: proposal.id, kind: proposal.kind }, { rationale }); };
      if (error.code === 'DEFINITION_CHANGED' && room) {
        const dedupKey = `sha256:${digest({ kind: 'capability.definition-changed', entry: member.entryId })}`;
        chain(this.ledger.openProposal(dedupKey) ?? this.ledger.putProposal({ kind: 'capability.definition-changed', flowId: this.lock.flowId, node, fromLockHash: this.lockHash, dedupKey,
          diff: { added: [] }, riskSummary: { entry: member.entryId, fieldDiff: error.details?.fieldDiff ?? [] }, evidence: { runId: ctx.runId, nodeKey: ctx.nodeKey } }), `${member.entryId} changed its definition: a proposal for a person`);
      }
      // A 403 insufficient_scope is never stepped up automatically: it becomes a scope.step-up proposal a person decides. Only an HTTP
      // challenge on an OAuth entry is one (guarded-fetch raises it; JSON-RPC error codes and error text never are), and only owner-listed
      // scopes are carried (oauth.mjs stepUpProposal).
      const entry = this.host.entry(member.entryId);
      if (error.code === 'SCOPE_INSUFFICIENT' && room && entry?.kind === 'mcp-http' && entry.credential?.oauth) chain(stepUpProposal(this.ledger, { entry, scopeClass: member.effects === 'none' ? 'read' : 'write',
        scopes: error.details?.scopes ?? [], flowId: this.lock.flowId, node, evidence: { runId: ctx.runId, nodeKey: ctx.nodeKey, member: member.id } }), `${member.entryId} asked for a scope step-up: a proposal for a person`);
      if (['CANCELLED', 'SECRET_EXPOSURE'].includes(error.code)) throw error;
      // Host-chosen code only: upstream text never reaches the model. Invalid arguments come back with the member's Foundry-authored
      // signature (owner text, never server text): a standby index line names a tool without its arguments, so a model that called it
      // from the index learns them here instead of guessing again (found before the NC-1 Haiku run, PREREG-NODECAP-1 §2).
      if (error.code === 'SCHEMA_MISMATCH') return this.#out(ctx, refusal('ARGS_INVALID', { tool: member.view.name, member: member.id, signature: renderView(member) }));
      return this.#out(ctx, refusal(error.code, { tool: member.view.name, member: member.id }));
    }
    const view = boundView(result, member.modelViewTokens ?? 1500);
    // (The approval id stays out of the model-visible output: it is run-specific, so it would break replay; the grant decision holds it.)
    return this.#out(ctx, { ok: true, member: member.id, tool: member.view.name, result: view.value, ...(view.truncated ? { truncated: true } : {}) });
  }
  #out(ctx, value) { this.host.scrub.assertClean(value, 'a node output'); return value; }
  /**
   * nodecap.log: append the turn to the bounded transcript (the need included, review-cost M4). The same call refused with the same code a
   * second time gets a hint in its entry; a third time ends the node as stuck with the typed reason REPEATED_REFUSAL instead of spending its
   * remaining turns (the T02 loop of the NC-1 Haiku run sent one refused request ten times). "The same call": action, tool and need, plus
   * the arguments of a read or act.
   */
  log(args) {
    const { decision, result, effect, previous } = args, turns = (previous?.turns ?? 0) + 1;
    // An act's own result (the effect) wins over nodecap.do's pre-check of it.
    const outcome = effect ?? result ?? null;
    const entry = { turn: turns, action: decision.action, tool: decision.tool, ...(decision.args && Object.keys(decision.args).length ? { args: decision.args } : {}),
      ...(decision.need ? { need: decision.need } : {}), result: outcome };
    const repeats = { ...(previous?.repeats ?? {}) };
    let stuckReason = null;
    if (outcome && typeof outcome === 'object' && outcome.ok === false && typeof outcome.code === 'string') {
      const key = digest({ action: decision.action, tool: decision.tool ?? null, need: decision.need ?? null, args: ['read', 'act'].includes(decision.action) ? decision.args ?? {} : null, code: outcome.code }).slice(0, 16);
      const n = (repeats[key] ?? 0) + 1;
      delete repeats[key]; repeats[key] = n;
      for (const k of Object.keys(repeats).slice(0, Math.max(0, Object.keys(repeats).length - 32))) delete repeats[k];
      if (n === 2) entry.repeat = { count: n, hint: 'This exact call was refused before with the same code. Change the call, use another tool, or answer stuck.' };
      if (n >= 3) { entry.repeat = { count: n }; stuckReason = 'REPEATED_REFUSAL'; }
    }
    const transcript = [...(previous?.transcript ?? []), entry];
    let dropped = previous?.dropped ?? 0;
    while (transcript.length > 1 && Buffer.byteLength(JSON.stringify(transcript)) > TRANSCRIPT_BYTES) { transcript.shift(); dropped++; }
    const done = decision.action === 'done' || decision.action === 'stuck' || stuckReason !== null;
    const status = decision.action === 'done' ? 'done' : decision.action === 'stuck' || stuckReason ? 'stuck' : 'running';
    return { transcript, done, status, turns, ...(decision.action === 'done' && decision.answer !== undefined ? { answer: decision.answer } : {}), ...(dropped ? { dropped } : {}),
      ...(Object.keys(repeats).length ? { repeats } : {}), ...(stuckReason ? { stuckReason } : {}) };
  }
  async close(args, ctx) {
    const node = /\/([A-Za-z][A-Za-z0-9_-]*)$/.exec(ctx.nodeKey)?.[1], section = this.lock.nodes[node];
    if (!section) fail('NODECAP_NODE_UNKNOWN', `No lock section for tool node ${node}`);
    if (this.host.sessions) {
      const entries = [...new Set([...section.bound, ...section.standby].map(id => this.lock.members[id]).filter(m => m.kind === 'cua').map(m => m.entryId))];
      for (const entryId of entries) {
        const entry = this.host.entry(entryId);
        if (!this.host.sessions.has({ runId: ctx.runId, node, entry })) continue;
        const session = await this.host.sessions.get({ runId: ctx.runId, node, entry });
        if (ctx.artifactsDir && session.tracing) { const trace = await session.exportTrace(ctx.artifactsDir); this.ledger?.receipt('ui.trace', { runId: ctx.runId, node, ...trace }); }
      }
      await this.host.sessions.closeNode(ctx.runId, node);
    }
    const log = args.log;
    if (log.status !== 'done') {
      // A node that raised a gap proposal and could not finish without it ends the run with the typed gap (a person decides; continuation).
      const gap = nodecapDecisions(ctx.store, ctx.runId).filter(d => d.action?.result === 'proposal' && d.features?.via === 'request' && d.features?.node === node).at(-1);
      if (gap) throw new FoundryError('CAPABILITY_GAP', 'This node needs a capability outside its approved lock; a person must decide the proposal', { proposalId: gap.action.proposalId, decisionId: gap.id, node });
      fail('NODE_STUCK', `Tool node ${node} ended without an answer (${log.stuckReason ?? log.status})`, { reason: log.stuckReason ?? log.status });
    }
    if (log.answer === undefined) fail('NODE_ANSWER_INVALID', `Tool node ${node} returned no answer`);
    validateData(section.returns, log.answer, `${node} answer`);
    return log.answer;
  }
}

/**
 * The host's rendering of one effect call (L2): what a person approves, and what the dispatcher re-renders and checks before sending.
 * Built only from host state: the lock's member record, the call's arguments, and for ui.commit the held request as the UI session
 * recorded it (method, origin, path, body hash and decoded, redacted body), never the model's description of it.
 */
export async function describeCall({ host, lock, runId, nodeKey, decision }) {
  const { node } = toolNodeOf(nodeKey), memberId = lock.nodes[node] ? viewIndex(lock, node).get(decision?.tool) : null;
  if (!memberId) return { known: false, tool: String(decision?.tool ?? '').slice(0, 64) };
  const member = lock.members[memberId];
  const rendering = { known: true, member: member.id, entry: member.entryId, effects: member.effects, risk: member.risk, view: renderView(member), args: decision.args ?? {} };
  if (member.kind === 'cua' && member.tool === 'commit') rendering.held = await host.heldRequest({ runId, node, entryId: member.entryId, id: decision.args?.id });
  return rendering;
}
/** The host rendering of a Tier-0 effect call (a task node naming an effectful member directly). */
export function describeTier0Call({ lock, memberId, args }) {
  const member = lock.members[memberId];
  if (!member || !Object.values(lock.tier0 ?? {}).includes(memberId)) return { known: false, tool: String(memberId ?? '').slice(0, 64) };
  return { known: true, tier0: true, member: member.id, entry: member.entryId, effects: member.effects, risk: member.risk, view: renderView(member), args: args ?? {} };
}
/** The host rendering of a pending engine approval of a run under `lock` (what a person channel shows before asking for a decision). */
export async function describeApproval({ host, lock, run, approvalId }) {
  const approval = run.approvals?.[approvalId];
  if (!approval) return { known: false, tool: null };
  if (approval.tool === 'nodecap.act') return describeCall({ host, lock, runId: run.id, nodeKey: approval.nodeKey, decision: approval.args?.decision ?? {} });
  return describeTier0Call({ lock, memberId: approval.tool, args: approval.args });
}
/** The subject a person decides for one effect call: the engine's approval id (workflow, registry, node, arguments) and the host rendering. */
export const callSubject = (approvalId, rendering) => subjectOf({ kind: 'call', approvalId, rendering });
/** Plain text of a rendering for a person channel (the CLI prints it; data in it is quoted as untrusted). */
export function renderCall(rendering) {
  if (!rendering.known) return `Unknown tool ${rendering.tool}: decline.`;
  const lines = [`Effect: ${rendering.view}`, `Member: ${rendering.member} (${rendering.effects}, risk ${rendering.risk})`, `Arguments (untrusted, shaped by tool output): ${JSON.stringify(rendering.args)}`];
  if (rendering.member.startsWith('ui.') && rendering.member.endsWith('.commit')) {
    if (rendering.held) lines.push(`Request that will be sent: ${rendering.held.method} ${rendering.held.origin}${rendering.held.path}`, `Body (untrusted): ${JSON.stringify(rendering.held.body)}`);
    else lines.push('No such held request: decline.');
  }
  return lines.join('\n');
}
