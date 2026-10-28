// Capability proposals (`foundry-capability-proposal/1`) and continuation, ARCHITECTURE.md §2.3 (L3) and §3.7. A proposal is decided only
// through a person channel (a PersonDecision for the proposal's subject, ./person.mjs) with compare-and-swap (./ledger.mjs). An approved
// bind yields lock N+1 (the member added to the node's bound set) only if every added member still has the definition the person was shown
// (its implementation, or its attestation when it had not qualified yet) and lock N+1 passes lint (deny list, Rule of Two, effect
// ceilings, schemas); then a new lowered workflow version, a person's approval of that exact version, a flow-head CAS, and a CONTINUATION
// run that reuses the prior run's sample salt so unchanged upstream model calls replay at $0. A continuation runs the launch preflight
// (pins against lock N+1, canaries, credentials) first, and is refused when the workflow has cross-run state or when any effect completed
// before the gap (no untested carry-over of effects).
import { clone } from '../data.mjs';
import { digest, fail, joinLabels } from './common.mjs';
import { stateNodes } from '../validate.mjs';
import { denyListed } from './envelope.mjs';
import { lint } from './lint.mjs';
import { lockMembers } from './resolve.mjs';
import { lowerWorkflow } from './lower.mjs';
import { renderBody } from './skills.mjs';

export function decideProposal(ledger, id, { person, expectedRev }) { return ledger.decideProposal(id, { person, expectedRev }); }

/** L0: a construction-time gap becomes a proposal for a person. Candidates are catalog tools of the required type, quoted as untrusted data
 *  with a code-computed risk summary (never their prose as instructions); deny-listed ones are flagged and never offered. */
export function constructionProposals({ gaps, host, ledger, flowId, lockHash = null, envelope }) {
  if (!envelope) fail('PROPOSAL_ENVELOPE', 'Construction proposals need the envelope (its deny list)');
  return gaps.filter(g => g.type).map(gap => {
    const candidates = [...host.outsideCandidates(), ...[...host.members.values()].map(m => ({ id: m.id, tool: m.tool, trust: m.trust, status: 'active', type: m.type, objects: m.objects, view: m.view, effects: m.effects, egress: m.egress, summary: m.view.summary }))]
      .filter(c => c.type === gap.type || String(c.type).startsWith(`${gap.type}.`));
    const flags = c => [...(denyListed(envelope, c) ? ['deny-listed'] : []), ...(c.trust === 'T3' ? ['T3'] : []), ...(c.trust === 'T2' ? ['T2'] : []), ...(c.status !== 'active' ? [`status:${c.status}`] : []), ...(c.effects !== 'none' ? ['effectful'] : [])];
    const offered = candidates.filter(c => !denyListed(envelope, c));
    const definition = c => { const m = host.member(c.id); return m ? { implementation: m.implementation, pins: m.pins, attestationHash: m.attestationHash } : { implementation: null, attestationHash: c.attestationHash ?? null }; };
    return ledger.putProposal({ kind: offered.some(c => c.status === 'active') ? 'capability.bind' : 'capability.admit', flowId, fromLockHash: lockHash, node: gap.node,
      need: { type: gap.type, as: gap.as, label: 'trusted' }, quoted: offered.map(c => ({ text: c.summary, label: 'untrusted:catalog', sourceHash: digest({ c: c.summary }) })),
      diff: { added: offered.map(c => ({ member: c.id, effects: c.effects, trust: c.trust, egress: c.egress, ...definition(c) })) },
      riskSummary: { candidates: candidates.map(c => ({ member: c.id, trust: c.trust, status: c.status, effects: c.effects, flags: flags(c) })), flags: [...new Set(candidates.flatMap(flags))], noCandidate: !offered.length },
      evidence: { construction: true } });
  });
}

/**
 * Lock N+1 from an approved capability.bind proposal: each added member that qualified, with the definition the person was shown, joins
 * the node's bound set; the result must pass lint before anyone is asked to approve it. `workflow` is the SOURCE workflow (lint walks it).
 */
export function applyBind({ proposal, lock, members, envelope, workflow, types = null, skills = new Map(), catalog = null }) {
  if (proposal.status !== 'approved') fail('PROPOSAL_NOT_APPROVED', 'Only an approved proposal changes a lock');
  if (proposal.kind !== 'capability.bind') fail('PROPOSAL_KIND', `A ${proposal.kind} proposal does not bind a member`);
  if (!workflow) fail('PROPOSAL_WORKFLOW', 'Lock N+1 is linted against its workflow; pass the source workflow');
  const next = clone(lock), section = next.nodes[proposal.node];
  if (!section) fail('PROPOSAL_NODE', `The lock has no node ${proposal.node}`);
  for (const added of proposal.diff.added) {
    const id = added.member, member = members.get(id);
    if (!member) fail('PROPOSAL_MEMBER', `${id} is not a qualified member; admit it first (capability.admit)`);
    // The definition the person approved: the exact implementation when it had qualified, else at least the same owner attestation (its
    // pins are then first shown with lock N+1, which the person approves next). A proposal that recorded neither binds nothing.
    if (!added.implementation && !added.attestationHash) fail('PROPOSAL_DEFINITION_UNKNOWN', `The proposal does not record what the person was shown for ${id}; nothing was bound`, { member: id });
    if (added.implementation ? member.implementation !== added.implementation : member.attestationHash !== added.attestationHash)
      fail('PROPOSAL_DEFINITION_CHANGED', `${id} no longer has the definition the person approved; nothing was bound`, { member: id });
    if (denyListed(envelope, member)) fail('PROPOSAL_DENYLISTED', `${id} is deny-listed; it is never bound`, { member: id });
    if (!section.bound.includes(id) && !section.skills.includes(id)) (member.kind === 'skill' ? section.skills : section.bound).push(id);
    section.standby = section.standby.filter(s => s !== id);
    next.members[id] = clone(member);
  }
  if (section.bound.length > envelope.limits.boundPerNode) fail('TOOLSET_TOO_LARGE', `Binding would give ${proposal.node} ${section.bound.length} tools`);
  section.controlLabel = joinLabels([section.controlLabel, ...section.bound.map(id => next.members[id].outputLabel)]);
  // Lock N+1 is held to the same rules as lock N (review M7): deny list, Rule of Two, effect ceilings, schemas, toolset sizes.
  const report = lint({ workflow, lock: next, envelope, types, skills, catalog });
  if (report.errors.length) fail('NODECAP_LINT', `Lint refused lock N+1: ${report.errors.map(f => f.code).join(', ')}`, { findings: report.errors });
  return { lock: next, lockHash: `sha256:${digest(next)}`, lint: report };
}

/**
 * The next constructed version from an approved bind: qualify the entries of the added members (only those are spawned), applyBind (with
 * the definition check and lint), and lower the source workflow at `version`. The caller has a person approve subjectOf(result) next.
 */
export async function nextConstruction({ proposal, construction, host, envelope, workflow, types = null, version }) {
  await host.qualify({ only: [...new Set(proposal.diff.added.map(a => host.entry(a.member.split('.')[1])?.id).filter(Boolean))] });
  const next = applyBind({ proposal, lock: construction.lock, members: host.members, envelope, workflow, types, skills: host.skills, catalog: host.catalog });
  const skillBodies = Object.fromEntries(Object.values(next.lock.nodes).flatMap(n => n.skills).map(id => [id, renderBody(host.skills.get(next.lock.members[id].entryId))]));
  const lowered = lowerWorkflow({ ...workflow, version }, next.lock, { skillBodies });
  return { ...construction, lock: next.lock, lockHash: next.lockHash, lowered, workflowHash: digest(lowered), lint: next.lint };
}

/** Effects that completed (or may have) in a run: a tool.intent with effects other than none, then a completion or an uncertain end. */
export function completedEffects(events) {
  const intents = new Map(events.filter(e => e.type === 'tool.intent' && e.effects && e.effects !== 'none').map(e => [e.nodeKey, e]));
  return events.filter(e => intents.has(e.nodeKey) && ['node.completed', 'effect.uncertain', 'node.handled_error'].includes(e.type)).map(e => e.nodeKey);
}

/**
 * Start the continuation of a run that ended on a capability gap, under the new version and lock. The launch preflight runs first (the
 * lock's pins against this process's qualification, a forced re-list, canaries, credentials): a continuation never skips it.
 */
export async function continueRun({ store, runtime, priorRunId, workflow, host, lock, input = undefined, options = {} }) {
  const prior = store.rows.header(priorRunId), { workflow: priorWorkflow } = store.workflow(prior.workflowHash);
  if (stateNodes(priorWorkflow).length || stateNodes(workflow).length) fail('CONTINUATION_STATEFUL', 'A workflow with cross-run state is not continued; start a new run');
  if (prior.error?.code !== 'CAPABILITY_GAP') fail('CONTINUATION_NOT_GAP', 'Only a run that ended on a capability gap is continued');
  const effects = completedEffects(store.events(priorRunId));
  if (effects.length) fail('CONTINUATION_AFTER_EFFECT', 'An effect completed before the gap; the continuation would repeat or reorder it', { nodeKeys: effects.slice(0, 10) });
  if (!host || !lock) fail('CONTINUATION_PREFLIGHT', 'A continuation runs the launch preflight: pass the host and lock N+1');
  await host.qualify({ only: [...new Set(lockMembers(lock).map(id => lock.members[id].entryId))] });
  const preflight = await host.preflight(lockMembers(lock), lock);
  if (!preflight.ok) fail('PREFLIGHT_FAILED', `Preflight failed: ${preflight.problems.map(p => `${p.entry}:${p.code}`).join(', ')}`, { problems: preflight.problems });
  return runtime.create(workflow, input ?? store.run(priorRunId).input, { modelMode: 'replay-or-live', sampleSalt: prior.sampleSalt, ...options });
}
