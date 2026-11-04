// Capability proposals (`foundry-capability-proposal/1`) and continuation, ARCHITECTURE.md §2.3 (L3), §2.9 and §9. A proposal is decided
// only through a person channel (a PersonDecision for the proposal's subject, ./person.mjs) with compare-and-swap (./ledger.mjs); approving
// a capability.bind names exactly ONE offered candidate. An approved bind yields lock N+1 only from the ledger's own record of the proposal
// (never a caller's copy), only on the flow and the lock it was raised on (fromLockHash), only if the chosen member still has the
// definition the person was shown (its implementation, or its attestation when it had not qualified yet), and only if lock N+1 passes
// lint (deny list, Rule of Two, effect ceilings, schemas). Applying consumes the approval (approved -> applied, CAS): one approval, one
// lock N+1. Then a new lowered workflow version, a person's approval of that exact version, and a CONTINUATION run that reuses the prior
// run's sample salt so unchanged upstream model calls replay at $0. A continuation runs every check a launch runs (lint, the person's
// approval of the exact version, the preflight: pins against lock N+1, canaries, credentials), moves the flow head by compare-and-swap
// from the version the gap was raised on, and is refused when the workflow has cross-run state or when any effect completed before the
// gap (no untested carry-over of effects).
import { clone } from '../data.mjs';
import { digest, fail, joinLabels } from './common.mjs';
import { stateNodes } from '../validate.mjs';
import { denyListed } from './envelope.mjs';
import { lint } from './lint.mjs';
import { lockMembers } from './resolve.mjs';
import { lowerWorkflow } from './lower.mjs';
import { renderBody } from './skills.mjs';
import { nodecapDecisions } from './journal.mjs';
import { executeRun, runtimeFor, subjectOf } from './launcher.mjs';

export function decideProposal(ledger, id, { person, expectedRev, choice = null }) { return ledger.decideProposal(id, { person, expectedRev, choice }); }

/** L0: a construction-time gap becomes a proposal for a person. Candidates are catalog tools of the required type, quoted as untrusted data
 *  with a code-computed risk summary (never their prose as instructions); deny-listed ones are flagged and never offered. */
export function constructionProposals({ gaps, host, ledger, flowId, lockHash, envelope }) {
  if (!envelope) fail('PROPOSAL_ENVELOPE', 'Construction proposals need the envelope (its deny list)');
  // A proposal changes only the lock it was raised on (applyBind compares it): one that names no lock could never be applied.
  if (!/^sha256:[0-9a-f]{64}$/.test(String(lockHash))) fail('PROPOSAL_LOCK', 'A construction proposal names the lock (lockHash) its gaps were found in');
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
 * Lock N+1 from an approved capability.bind proposal, read from the LEDGER (`proposalId`; a caller's copy of a proposal is never trusted):
 * approved by a person on a channel this ledger accepts and not yet applied, raised on this flow and on exactly this lock, and binding the
 * ONE candidate the person picked, if it still has the definition the person was shown. The result must pass lint before anyone is asked
 * to approve it. `workflow` is the SOURCE workflow (lint walks it). Pure: it changes nothing (nextConstruction consumes the approval).
 */
export function applyBind({ ledger, proposalId, lock, members, envelope, workflow, types = null, skills = new Map(), catalog = null }) {
  if (!ledger) fail('PROPOSAL_LEDGER', 'Lock N+1 is built from the ledger\'s record of the proposal; pass the ledger and the proposal id');
  const proposal = ledger.approvedProposal(proposalId);
  if (!proposal) fail('PROPOSAL_NOT_APPROVED', 'Only a proposal a person approved (on a channel this ledger accepts), and not applied yet, changes a lock', { status: ledger.proposal(proposalId)?.status ?? null });
  if (proposal.kind !== 'capability.bind') fail('PROPOSAL_KIND', `A ${proposal.kind} proposal does not bind a member`);
  if (!workflow) fail('PROPOSAL_WORKFLOW', 'Lock N+1 is linted against its workflow; pass the source workflow');
  if (workflow.id !== lock.flowId || proposal.flowId !== lock.flowId) fail('PROPOSAL_FLOW_MISMATCH', `The proposal was raised on flow ${String(proposal.flowId).slice(0, 64)}, not on ${String(lock.flowId).slice(0, 64)}`);
  const lockHash = `sha256:${digest(lock)}`;
  if (proposal.fromLockHash !== lockHash) fail('PROPOSAL_LOCK_MISMATCH', 'The proposal was decided against another lock; it changes only the lock it was raised on', { fromLockHash: proposal.fromLockHash ?? null });
  const added = (proposal.diff?.added ?? []).find(a => a.member === proposal.decision?.choice);
  if (!added) fail('PROPOSAL_CHOICE_REQUIRED', 'The approval names no offered candidate; nothing was bound');
  const next = clone(lock), section = next.nodes[proposal.node];
  if (!section) fail('PROPOSAL_NODE', `The lock has no node ${proposal.node}`);
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
  if (section.bound.length > envelope.limits.boundPerNode) fail('TOOLSET_TOO_LARGE', `Binding would give ${proposal.node} ${section.bound.length} tools`);
  section.controlLabel = joinLabels([section.controlLabel, ...section.bound.map(m => next.members[m].outputLabel)]);
  // Lock N+1 is held to the same rules as lock N (review M7): deny list, Rule of Two, effect ceilings, schemas, toolset sizes.
  const report = lint({ workflow, lock: next, envelope, types, skills, catalog });
  if (report.errors.length) fail('NODECAP_LINT', `Lint refused lock N+1: ${report.errors.map(f => f.code).join(', ')}`, { findings: report.errors });
  return { lock: next, lockHash: `sha256:${digest(next)}`, lint: report, proposal: { id: proposal.id, rev: proposal.rev, member: id } };
}

/**
 * The next constructed version from an approved bind: qualify the chosen member's entry (only it is spawned), applyBind (the ledger's
 * record, the lock check, the definition check and lint), lower the source workflow at `version`, and consume the approval (approved ->
 * applied, CAS). The caller has a person approve subjectOf(result) next, then continues the gap-ended run (continueRun).
 */
export async function nextConstruction({ ledger, proposalId, construction, host, envelope, workflow, types = null, version }) {
  const proposal = ledger?.approvedProposal(proposalId);
  if (!proposal) fail('PROPOSAL_NOT_APPROVED', 'Only a proposal a person approved, and not applied yet, yields a new version');
  if (proposal.fromWorkflowHash && proposal.fromWorkflowHash !== construction.workflowHash) fail('PROPOSAL_LOCK_MISMATCH', 'The proposal was raised on another version of the flow');
  const entry = host.entry(String(proposal.decision?.choice ?? '').split('.')[1])?.id;
  await host.qualify({ only: entry ? [entry] : [] });
  const next = applyBind({ ledger, proposalId, lock: construction.lock, members: host.members, envelope, workflow, types, skills: host.skills, catalog: host.catalog });
  const skillBodies = Object.fromEntries(Object.values(next.lock.nodes).flatMap(n => n.skills).map(id => [id, renderBody(host.skills.get(next.lock.members[id].entryId))]));
  const lowered = lowerWorkflow({ ...workflow, version }, next.lock, { skillBodies });
  const result = { ...construction, lock: next.lock, lockHash: next.lockHash, lowered, workflowHash: digest(lowered), lint: next.lint, proposalId: proposal.id,
    from: { workflowHash: construction.workflowHash, lockHash: construction.lockHash } };
  ledger.markApplied(proposal.id, { expectedRev: proposal.rev, lockHash: result.lockHash, workflowHash: result.workflowHash });
  return result;
}

/** Effects that completed (or may have) in a run: a tool.intent with effects other than none, then a completion or an uncertain end. */
export function completedEffects(events) {
  const intents = new Map(events.filter(e => e.type === 'tool.intent' && e.effects && e.effects !== 'none').map(e => [e.nodeKey, e]));
  return events.filter(e => intents.has(e.nodeKey) && ['node.completed', 'effect.uncertain', 'node.handled_error'].includes(e.type)).map(e => e.nodeKey);
}

/**
 * Continue a run that ended on a capability gap, under the version an applied proposal produced (`construction` from nextConstruction).
 * Every check a launch runs, plus the continuation's own: the prior run raised exactly this proposal (its chain holds the gap decision)
 * and did not succeed; the proposal was raised on the prior run's version and lock and applied to this construction; lint is clean; a
 * person approved this exact version; the preflight (lock N+1's pins against this process, canaries, credentials) passes; no effect
 * completed before the gap; the workflow keeps no cross-run state. The flow head then moves by compare-and-swap from the prior run's
 * version to this one (a flow that moved on since the gap is not continued), and the run is created with `modelMode: 'replay-or-live'` and
 * the prior run's sample salt. Returns { runtime, registry, run, execute } as launch does.
 */
export async function continueRun({ store, ledger, host, construction, envelope, priorRunId, models = null, modelPolicy = null, mode = 'live', maxCost = null, input = undefined, options = {} }) {
  if (!ledger || !host || !construction || !envelope) fail('CONTINUATION_PREFLIGHT', 'A continuation runs every launch check: pass the ledger, the host, the construction of version N+1 and the envelope');
  const prior = store.rows.header(priorRunId), priorRun = store.run(priorRunId), { workflow: priorWorkflow } = store.workflow(prior.workflowHash);
  if (priorRun.status === 'succeeded') fail('CONTINUATION_NOT_GAP', 'Only a run that ended on a capability gap is continued');
  const proposal = ledger.proposal(construction.proposalId);
  const gap = proposal ? nodecapDecisions(store, priorRunId).find(d => d.action?.result === 'proposal' && d.action.proposalId === proposal.id) : null;
  if (!gap) fail('CONTINUATION_NOT_GAP', 'Only a run whose own chain raised the applied proposal is continued');
  if (proposal.status !== 'applied' || !ledger.channels.includes(proposal.decision?.channel) || proposal.applied?.lockHash !== construction.lockHash || proposal.applied?.workflowHash !== construction.workflowHash)
    fail('CONTINUATION_PROPOSAL', 'A continuation runs exactly the version the person-approved proposal was applied to');
  if (proposal.fromWorkflowHash !== prior.workflowHash || proposal.fromLockHash !== gap.features.lockHash || construction.from?.lockHash !== proposal.fromLockHash)
    fail('CONTINUATION_PROPOSAL', 'The proposal was raised on another version or lock than the run being continued');
  if (stateNodes(priorWorkflow).length || stateNodes(construction.lowered).length) fail('CONTINUATION_STATEFUL', 'A workflow with cross-run state is not continued; start a new run');
  const effects = completedEffects(store.events(priorRunId));
  if (effects.length) fail('CONTINUATION_AFTER_EFFECT', 'An effect completed before the gap; the continuation would repeat or reorder it', { nodeKeys: effects.slice(0, 10) });
  // The launch checks, in the launch's order.
  if (construction.lint.errors.length) fail('NODECAP_LINT', `Lint refused the version: ${construction.lint.errors.map(f => f.code).join(', ')}`, { findings: construction.lint.errors });
  if (digest(construction.lowered) !== construction.workflowHash) fail('WORKFLOW_HASH', 'The lowered workflow differs from the constructed one');
  const lock = construction.lock;
  await host.qualify({ only: [...new Set(lockMembers(lock).map(id => lock.members[id].entryId))] });
  const preflight = await host.preflight(lockMembers(lock), lock);
  if (!preflight.ok) fail('PREFLIGHT_FAILED', `Preflight failed: ${preflight.problems.map(p => `${p.entry}:${p.code}`).join(', ')}`, { problems: preflight.problems });
  if (!ledger.lockApproval(subjectOf(construction))) fail('LOCK_UNAPPROVED', 'No person approved this exact version (workflow, lock, envelope, catalog, dry run)');
  // The flow head: it must still run the version the gap was raised on; it moves by compare-and-swap (one continuation wins).
  const head = ledger.head(lock.flowId);
  if (!head || head.workflowHash !== prior.workflowHash || head.lockHash !== proposal.fromLockHash) fail('CONTINUATION_STALE_HEAD', 'The flow no longer runs the version the gap was raised on; nothing was continued');
  ledger.putLock(lock);
  store.saveWorkflow(construction.lowered, { expectedHash: prior.workflowHash });
  ledger.setHead(lock.flowId, { workflowHash: construction.workflowHash, lockHash: construction.lockHash, expectedRev: head.rev });
  const { registry, runtime } = runtimeFor({ store, host, ledger, construction, envelope, models, modelPolicy, mode, maxCost });
  const run = runtime.create(construction.lowered, input ?? priorRun.input, { modelMode: 'replay-or-live', sampleSalt: prior.sampleSalt, ...options });
  return { runtime, registry, run, execute: () => executeRun({ runtime, host, runId: run.id }) };
}
