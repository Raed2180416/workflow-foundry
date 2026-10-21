// Capability proposals (`foundry-capability-proposal/1`) and continuation, ARCHITECTURE.md §2.3 (L3) and §3.7. A proposal is decided only
// through a person's channel (dashboard or CLI) with compare-and-swap (src/capabilities/ledger.mjs). An approved bind yields lock N+1
// (the member added to the node's bound set), a new lowered workflow version, a flow-head CAS, and a CONTINUATION run that reuses the
// prior run's sample salt so unchanged upstream model calls replay at $0. A continuation is refused when the workflow has cross-run state
// or when any effect completed before the gap (no untested carry-over of effects).
import { clone } from '../data.mjs';
import { digest, fail, joinLabels } from './common.mjs';
import { stateNodes } from '../validate.mjs';

export function decideProposal(ledger, id, { approve, channel, actor = 'owner', expectedRev }) { return ledger.decideProposal(id, { approve, channel, actor, expectedRev }); }

/** L0: a construction-time gap becomes a proposal for a person. Candidates are catalog tools of the required type that did not qualify
 *  for this version, quoted as untrusted data with a code-computed risk summary (never their prose as instructions). */
export function constructionProposals({ gaps, host, ledger, flowId, lockHash = null }) {
  return gaps.filter(g => g.type).map(gap => {
    const candidates = [...host.outsideCandidates(), ...[...host.members.values()].map(m => ({ id: m.id, trust: m.trust, status: 'active', type: m.type, effects: m.effects, egress: m.egress, summary: m.view.summary }))]
      .filter(c => c.type === gap.type || String(c.type).startsWith(`${gap.type}.`));
    return ledger.putProposal({ kind: candidates.some(c => c.status === 'active') ? 'capability.bind' : 'capability.admit', flowId, fromLockHash: lockHash, node: gap.node,
      need: { type: gap.type, as: gap.as, label: 'trusted' }, quoted: candidates.map(c => ({ text: c.summary, label: 'untrusted:catalog', sourceHash: digest({ c: c.summary }) })),
      diff: { added: candidates.map(c => ({ member: c.id, effects: c.effects, trust: c.trust, egress: c.egress })) },
      riskSummary: { candidates: candidates.map(c => ({ member: c.id, trust: c.trust, status: c.status, effects: c.effects, flags: [...(c.trust === 'T3' ? ['T3'] : []), ...(c.status !== 'active' ? [`status:${c.status}`] : []), ...(c.effects !== 'none' ? ['effectful'] : [])] })), noCandidate: !candidates.length },
      evidence: { construction: true } });
  });
}

/** Lock N+1 from an approved capability.bind proposal: each added member that qualified joins the node's bound set. */
export function applyBind({ proposal, lock, members, envelope }) {
  if (proposal.status !== 'approved') fail('PROPOSAL_NOT_APPROVED', 'Only an approved proposal changes a lock');
  if (proposal.kind !== 'capability.bind') fail('PROPOSAL_KIND', `A ${proposal.kind} proposal does not bind a member`);
  const next = clone(lock), section = next.nodes[proposal.node];
  if (!section) fail('PROPOSAL_NODE', `The lock has no node ${proposal.node}`);
  for (const { member: id } of proposal.diff.added) {
    const member = members.get(id);
    if (!member) fail('PROPOSAL_MEMBER', `${id} is not a qualified member; admit it first (capability.admit)`);
    if (!section.bound.includes(id) && !section.skills.includes(id)) (member.kind === 'skill' ? section.skills : section.bound).push(id);
    section.standby = section.standby.filter(s => s !== id);
    next.members[id] = clone(member);
  }
  if (section.bound.length > envelope.limits.boundPerNode) fail('TOOLSET_TOO_LARGE', `Binding would give ${proposal.node} ${section.bound.length} tools`);
  section.controlLabel = joinLabels([section.controlLabel, ...section.bound.map(id => next.members[id].outputLabel)]);
  return { lock: next, lockHash: `sha256:${digest(next)}` };
}

/** Effects that completed (or may have) in a run: a tool.intent with effects other than none, then a completion or an uncertain end. */
export function completedEffects(events) {
  const intents = new Map(events.filter(e => e.type === 'tool.intent' && e.effects && e.effects !== 'none').map(e => [e.nodeKey, e]));
  return events.filter(e => intents.has(e.nodeKey) && ['node.completed', 'effect.uncertain', 'node.handled_error'].includes(e.type)).map(e => e.nodeKey);
}

/** Start the continuation of a run that ended on a capability gap, under the new version and lock. */
export function continueRun({ store, runtime, priorRunId, workflow, input = undefined, options = {} }) {
  const prior = store.rows.header(priorRunId), { workflow: priorWorkflow } = store.workflow(prior.workflowHash);
  if (stateNodes(priorWorkflow).length || stateNodes(workflow).length) fail('CONTINUATION_STATEFUL', 'A workflow with cross-run state is not continued; start a new run');
  if (prior.error?.code !== 'CAPABILITY_GAP') fail('CONTINUATION_NOT_GAP', 'Only a run that ended on a capability gap is continued');
  const effects = completedEffects(store.events(priorRunId));
  if (effects.length) fail('CONTINUATION_AFTER_EFFECT', 'An effect completed before the gap; the continuation would repeat or reorder it', { nodeKeys: effects.slice(0, 10) });
  return runtime.create(workflow, input ?? store.run(priorRunId).input, { modelMode: 'replay-or-live', sampleSalt: prior.sampleSalt, ...options });
}
