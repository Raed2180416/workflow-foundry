// The adaptive broker and the tool-node dispatcher, ARCHITECTURE.md §2.3, §2.4 and §3.7.
//
// Adaptivity ladder inside a run:
//   L1  auto-bind: a standby member inside the envelope (effects none, low risk, trusted source, no cost, authored view, I6, Rule of Two)
//       is granted by code, with no model call and no person; the grant is an `adaptation` decision in the run's hash chain.
//   L2  per-call approval: an effectful standby member is reachable only through nodecap.act, which the engine gates with a user approval
//       bound to (workflow, registry, node, exact arguments); the dispatcher verifies that decision in the chain AND a person's decision
//       (./person.mjs) for the host's own rendering of the call (describeCall: the member, its arguments, and for ui.commit the held
//       request as the host recorded it, body included) before calling. A person never approves a model's account of an effect.
//   L3  out of lock: a need nothing in bound ∪ standby can meet ends the run with a typed CAPABILITY_GAP and a proposal a person decides
//       on the dashboard or CLI (never a model, a signal, or an MCP elicitation); approval yields lock N+1 and a continuation run.
// Nothing here widens the lock: find never widens, a signal cannot grant, grants die with the run (THESIS D11).
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

/**
 * The pure broker rule for one member (I10: recomputable from the recorded features). `features`: { inBound, priorGrant, inStandby,
 * entryStatus, grantsSoFar, nodeGrantsSoFar, nodeGrantLimit, grantsPerRun, via, approvalId, controlLabel, holdsPrivate, holdsThirdParty }.
 */
export function decideMember(features, member, envelope) {
  if (features.inBound) return { result: 'bound' };
  if (features.priorGrant) return { result: 'bound', granted: true };
  if (!features.inStandby) return { result: 'refused', code: 'NOT_BOUND' };
  if (features.entryStatus !== 'active') return { result: 'refused', code: 'CAPABILITY_QUARANTINED' };
  if (denyListed(envelope, member)) return { result: 'refused', code: 'NEED_DENYLISTED' };
  if (features.grantsSoFar >= features.grantsPerRun || features.nodeGrantsSoFar >= features.nodeGrantLimit) return { result: 'refused', code: 'GRANT_LIMIT' };
  if (member.effects !== 'none') {
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
    const decisions = nodecapDecisions(ctx.store, ctx.runId), grants = new Set(), nodeGrants = new Set();
    let proposals = 0, seq = 0;
    for (const d of decisions) {
      if (d.action?.result === 'granted') { grants.add(`${d.features.node}\u0000${d.action.member}`); if (d.features.node === node) nodeGrants.add(d.action.member); }
      if (d.action?.result === 'proposal') proposals++;
      if (d.features.nodeKey === ctx.nodeKey) seq++;
    }
    const section = this.lock.nodes[node], reachable = [...section.bound, ...section.skills, ...nodeGrants].map(id => this.lock.members[id]);
    // Every call that reached a member counts against maxCallsPerMember, failed ones included: a server that fails every call (and asks
    // for a step-up each time) cannot buy itself unlimited turns.
    const calls = new Map();
    for (const e of ctx.store.events(ctx.runId)) if (e.type === 'node.completed' && /__loop:\d+\/(do|act)$/.test(e.nodeKey ?? '') && e.output?.member) calls.set(e.output.member, (calls.get(e.output.member) ?? 0) + 1);
    // Every proposal raised in the run counts against proposalsPerRun, whichever path raised it (L3 gap, definition change, step-up).
    proposals = Math.max(proposals, this.ledger?.proposalsOfRun(ctx.runId).length ?? 0);
    // The Rule of Two counts private data the node holds through its members AND through its inputs (resolve records the input class).
    return { grantsSoFar: grants.size, nodeGrants, proposals, seq, calls, holdsPrivate: reachable.some(m => isPrivate(m.dataClass)) || isPrivate(section.inputClass),
      holdsThirdParty: reachable.some(m => m.egress === 'third-party') };
  }
  features(ctx, node, memberId, state, { via, approvalId = null }) {
    const section = this.lock.nodes[node], member = this.lock.members[memberId], entry = this.host.entry(member.entryId);
    return { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, member: memberId, via,
      inBound: section.bound.includes(memberId) || section.skills.includes(memberId), priorGrant: state.nodeGrants.has(memberId), inStandby: section.standby.includes(memberId),
      entryStatus: entryStatus(entry, this.host.ledger), grantsSoFar: state.grantsSoFar, nodeGrantsSoFar: state.nodeGrants.size,
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
  /** Ranked authored views of the node's members matching a typed need; out-of-lock catalog tools come back as names only. */
  find(node, need) {
    const section = this.lock.nodes[node], pool = [...section.bound, ...section.skills, ...section.standby].map(id => this.lock.members[id]);
    // "other" means outside the values this node knows: it matches no member of the node's section, only outside candidates.
    const fits = m => (need.kind === 'skill' ? m.kind === 'skill' : need.kind === 'ui' ? m.kind === 'cua' : m.kind !== 'skill' && m.kind !== 'cua')
      && need.object !== 'other' && need.system !== 'other' && (!need.object || m.objects.includes(need.object)) && (!need.system || m.system === need.system);
    const knownObjects = new Set(pool.flatMap(m => m.objects)), knownSystems = new Set(pool.map(m => m.system));
    const outsideFits = c => (!need.verb || (c.verbs ?? []).includes(need.verb))
      && (!need.system || (need.system === 'other' ? !knownSystems.has(c.system) : c.system === need.system))
      && (!need.object || (need.object === 'other' ? c.objects.some(o => !knownObjects.has(o)) : c.objects.includes(need.object)));
    const eligible = pool.filter(fits);
    const ranked = eligible.length ? indexMembers(eligible).rank(`${need.verb} ${need.object} ${need.system ?? ''} ${need.why ?? ''}`, 5) : [];
    // Members that fit the typed fields but share no word with the query still count (ranked after the scored ones).
    const rest = eligible.filter(m => !ranked.some(r => r.id === m.id)).map(m => ({ id: m.id, score: 0 }));
    // Outside this node's lock: qualified members the lock did not give this node, and catalog tools that did not qualify (T3, quarantined,
    // revoked, imported). Names only, for a proposal; never callable in this run.
    const inSection = new Set(pool.map(m => m.id));
    const qualified = [...this.host.members.values()].filter(m => !inSection.has(m.id)).map(m => ({ id: m.id, entry: m.entryId, trust: m.trust, status: entryStatus(this.host.entry(m.entryId), this.host.ledger),
      type: m.type, system: m.system, objects: m.objects, verbs: m.verbs, effects: m.effects, egress: m.egress, summary: m.view.summary }));
    const outside = [...qualified, ...this.host.outsideCandidates()].filter(outsideFits);
    return { ranked: [...ranked, ...rest].slice(0, 5), outside: outside.slice(0, 5) };
  }
  // ---- the dispatchers ----
  async do(args, ctx) {
    const { node } = toolNodeOf(ctx.nodeKey), section = this.lock.nodes[node];
    if (!section) fail('NODECAP_NODE_UNKNOWN', `No lock section for tool node ${node}`);
    const decision = args.decision, state = this.state(ctx, node);
    if (decision.action === 'find') {
      const found = this.find(node, decision.need ?? {});
      this.decide(ctx, 'selection', { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, via: 'find', eligibleDigest: `sha256:${digest(found.ranked.map(r => r.id))}`, scores: found.ranked.map(r => Math.round(r.score * 1000) / 1000) },
        { result: 'options', options: found.ranked.map(r => r.id), outside: found.outside.map(c => c.id) }, { need: decision.need ?? null, rationale: 'find over the node lock section' });
      // Outside-lock candidates are host records for a proposal; the model learns only that some exist (never their ids or names).
      return this.#out(ctx, { ok: true, action: 'find', matches: found.ranked.map(r => renderView(this.lock.members[r.id])), outsideLock: found.outside.length });
    }
    if (decision.action === 'request') return this.#request(ctx, node, decision, state);
    if (decision.action !== 'read') return this.#out(ctx, refusal('ACTION_UNSUPPORTED'));
    const memberId = viewIndex(this.lock, node).get(decision.tool);
    if (!memberId) return this.#out(ctx, refusal('TOOL_ABSENT', { hint: 'Use a tool listed under tools or standby, or action request with a need' }));
    const member = this.lock.members[memberId];
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
    if (!ctx.store.events(ctx.runId).some(e => e.type === 'approval.decided' && e.approvalId === approvalId && e.approved === true && e.actor === 'user'))
      fail('APPROVAL_MISSING', 'nodecap.act runs only after a user approved this exact call');
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
  async #request(ctx, node, decision, state) {
    const need = decision.need;
    if (!need) return this.#out(ctx, refusal('NEED_REQUIRED'));
    const found = this.find(node, need), section = this.lock.nodes[node];
    const held = found.ranked.find(r => section.bound.includes(r.id) || section.skills.includes(r.id) || state.nodeGrants.has(r.id));
    if (held && (found.ranked[0].id === held.id)) return this.#out(ctx, { ok: true, action: 'request', result: 'bound', tool: this.lock.members[held.id].view.name });
    const standby = found.ranked.filter(r => section.standby.includes(r.id) && !state.nodeGrants.has(r.id));
    const viable = standby.filter(r => { const d = decideMember(this.features(ctx, node, r.id, state, { via: 'request' }), this.lock.members[r.id], this.envelope); return d.result === 'granted' || d.code === 'NEED_EFFECTFUL'; });
    if (!viable.length) {
      // L3: nothing in the lock meets the need. The node ends with a typed gap and a proposal for a person (never a model or a signal).
      if (state.proposals >= this.envelope.limits.proposalsPerRun) return this.#out(ctx, refusal('PROPOSAL_LIMIT'));
      const refusedHere = standby.length ? decideMember(this.features(ctx, node, standby[0].id, state, { via: 'request' }), this.lock.members[standby[0].id], this.envelope).code : null;
      if (refusedHere && refusedHere !== 'NOT_BOUND') {
        this.decide(ctx, 'adaptation', { ...this.features(ctx, node, standby[0].id, state, { via: 'request' }) }, { result: 'refused', member: standby[0].id, code: refusedHere }, { need, rationale: `refused ${standby[0].id}: ${refusedHere}` });
        return this.#out(ctx, refusal(refusedHere));
      }
      const proposal = this.#propose(ctx, node, need, found.outside);
      const decisionId = this.decide(ctx, 'adaptation', { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, via: 'request', controlLabel: section.controlLabel,
        candidates: found.outside.map(c => c.id) }, { result: 'proposal', proposalId: proposal?.id ?? null }, { need, rationale: 'need outside the lock: typed gap and a proposal for a person' });
      throw new FoundryError('CAPABILITY_GAP', 'This node needs a capability outside its approved lock; a person must decide the proposal', { proposalId: proposal?.id ?? null, decisionId, node });
    }
    const [top, second] = viable;
    const decisive = viable.length === 1 || (top.score >= this.thresholds.tau && top.score - (second?.score ?? 0) >= this.thresholds.delta);
    if (!decisive) {
      this.decide(ctx, 'selection', { node, nodeKey: ctx.nodeKey, lockHash: this.lockHash, envelopeDigest: this.envelopeDigest, via: 'request', scores: viable.slice(0, 3).map(r => Math.round(r.score * 1000) / 1000) },
        { result: 'options', options: viable.slice(0, 3).map(r => r.id) }, { need, rationale: 'several viable standby members: a closed choice' });
      return this.#out(ctx, { ok: true, action: 'request', result: 'options', options: viable.slice(0, 3).map(r => renderView(this.lock.members[r.id])) });
    }
    const member = this.lock.members[top.id];
    if (member.effects !== 'none') return this.#out(ctx, { ok: true, action: 'request', result: 'needs-approval', tool: member.view.name, view: renderView(member) });
    const granted = this.acquire(ctx, node, top.id, state, { via: 'request', need });
    if (granted.result !== 'granted' && granted.result !== 'bound') return this.#out(ctx, refusal(granted.code));
    return this.#out(ctx, { ok: true, action: 'request', result: 'granted', tool: member.view.name, view: renderView(member) });
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
      if (error.code === 'DEFINITION_CHANGED' && room) {
        const dedupKey = `sha256:${digest({ kind: 'capability.definition-changed', entry: member.entryId })}`;
        if (!this.ledger.openProposal(dedupKey)) this.ledger.putProposal({ kind: 'capability.definition-changed', flowId: this.lock.flowId, node, fromLockHash: this.lockHash, dedupKey,
          diff: { added: [] }, riskSummary: { entry: member.entryId, fieldDiff: error.details?.fieldDiff ?? [] }, evidence: { runId: ctx.runId, nodeKey: ctx.nodeKey } });
      }
      // A 403 insufficient_scope is never stepped up automatically: it becomes a scope.step-up proposal a person decides. Only an HTTP
      // challenge on an OAuth entry is one (guarded-fetch raises it; JSON-RPC error codes and error text never are), and only owner-listed
      // scopes are carried (oauth.mjs stepUpProposal).
      const entry = this.host.entry(member.entryId);
      if (error.code === 'SCOPE_INSUFFICIENT' && room && entry?.kind === 'mcp-http' && entry.credential?.oauth) stepUpProposal(this.ledger, { entry, scopeClass: member.effects === 'none' ? 'read' : 'write',
        scopes: error.details?.scopes ?? [], flowId: this.lock.flowId, node, evidence: { runId: ctx.runId, nodeKey: ctx.nodeKey, member: member.id } });
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
  log(args) {
    const { decision, result, effect, previous } = args, turns = (previous?.turns ?? 0) + 1;
    const entry = { turn: turns, action: decision.action, tool: decision.tool, ...(decision.args && Object.keys(decision.args).length ? { args: decision.args } : {}), result: result ?? effect ?? null };
    const transcript = [...(previous?.transcript ?? []), entry];
    let dropped = previous?.dropped ?? 0;
    while (transcript.length > 1 && Buffer.byteLength(JSON.stringify(transcript)) > TRANSCRIPT_BYTES) { transcript.shift(); dropped++; }
    const done = decision.action === 'done' || decision.action === 'stuck';
    return { transcript, done, status: decision.action === 'done' ? 'done' : decision.action === 'stuck' ? 'stuck' : 'running', turns,
      ...(decision.action === 'done' && decision.answer !== undefined ? { answer: decision.answer } : {}), ...(dropped ? { dropped } : {}) };
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
    if (log.status !== 'done') fail('NODE_STUCK', `Tool node ${node} ended without an answer (${log.status})`);
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
