// The evidence bundle for one run (SPEC §7.4 P5): what an auditor needs from this computer alone. It is assembled from the records,
// never from memory: the run's hash-chained events re-verified on read (chain head included), the exact workflow version (by hash),
// the turn-on decision and its channel from the activation ledger, the practice run it rests on, each action decision from the chain,
// the batch decision when a list was approved in one click, and the known gaps, stated.
import { readStore } from '../dashboard/server.mjs';
import { explainRun } from '../core/explain.mjs';
import { GAPS } from './brief.mjs';

export function evidenceBundle(app, runId, { batches = null, date = new Date() } = {}) {
  const raw = readStore(app.storeFile, r => {
    const h = r.header(runId), chain = r.events(runId, { header: h }), wf = r.workflow(h.workflowHash);
    return { header: h, chain, workflow: wf.workflow, workflowNote: wf.reason ?? null };
  });
  const view = raw.workflow ? explainRun(app.foundry.publicRun(app.foundry.store.run(runId)), raw.workflow, raw.chain.events) : null;
  const activations = app.ledger.forFlow(raw.header.workflowId).filter(a => a.workflowHash === raw.header.workflowHash);
  const approved = activations.find(a => a.status === 'approved') ?? null;
  const proposal = approved ? app.foundry.store.proposal(approved.proposalId) : null;
  const dry = approved ? app.ledger.latestDryRun(approved.proposalId) : null;
  const decisions = raw.chain.events.filter(e => /approval/i.test(e.type)).map(e => ({ seq: e.seq, at: e.at, type: e.type, node: e.nodeKey ?? null,
    approvalId: e.approvalId ?? null, actor: e.actor ?? null, approved: e.approved ?? null }));
  const batch = batches ? batches.all().find(b => b.result?.runId === runId) ?? null : null;
  return {
    schema: 'foundry-evidence/1', generatedAt: date.toISOString(), generatedOn: 'this computer; not sent anywhere',
    run: { runId, flowId: raw.header.workflowId, status: raw.header.status, verdict: raw.header.verdict?.verdict ?? null, createdAt: raw.header.createdAt, updatedAt: raw.header.updatedAt,
      headline: view?.headline ?? null, checks: view?.checks ?? [] },
    chain: { verified: raw.chain.ok, events: raw.chain.count, head: raw.chain.head, reason: raw.chain.reason ?? null },
    workflow: { hash: raw.header.workflowHash, version: raw.workflow?.version ?? null, title: raw.workflow?.title ?? null, note: raw.workflowNote, body: raw.workflow },
    turnedOn: approved ? { approvalId: approved.id, channel: approved.channel, principal: approved.principal, requestedAt: new Date(approved.requestedAt).toISOString(),
      decidedAt: approved.decidedAt ? new Date(approved.decidedAt).toISOString() : null, note: approved.note, proposalId: approved.proposalId, proposalStatus: proposal?.status ?? null } : null,
    ledger: activations.map(a => ({ approvalId: a.id, status: a.status, channel: a.channel, principal: a.principal, decidedAt: a.decidedAt ? new Date(a.decidedAt).toISOString() : null, workflowHash: a.workflowHash })),
    practice: dry ? { dryRunId: dry.id, passed: dry.passed, at: new Date(dry.at).toISOString(), workflowHash: dry.workflowHash, dataSource: dry.body.dataSource ?? 'template', checks: dry.body.checks } : null,
    actionDecisions: decisions,
    batch: batch ? { batchId: batch.batchId, decision: batch.decision, items: batch.items.length, made: batch.result?.made ?? null, stoppedAt: batch.result?.stoppedAt ?? null } : null,
    events: raw.chain.events,
    gaps: GAPS,
    howToCheck: 'For each event in order, drop its hash field and take sha256 of its canonical JSON (keys sorted, no spaces): it must equal the hash shown, and the next event must name it as previousHash. The last hash must equal chain.head. The workflow body must hash the same way to workflow.hash.'
  };
}
