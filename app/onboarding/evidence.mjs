// The evidence bundle for one run (SPEC §7.4 P5): what an auditor needs from this computer alone. It is assembled from the records,
// never from memory: the run's hash-chained events re-verified on read (chain head included), the exact workflow version (by hash),
// the turn-on decision with who made it and through which channel, the practice run it rests on, each action decision from the chain
// (and, for an approved list, which item of the list it applied), the list itself in full (every item's digest), who started the run,
// the person's decisions from their own chained log, lists they declined, drafts they marked as sent, the "Who decides what" version
// in force, which Foundry build made it, and the known gaps, stated. Times are ISO 8601 UTC, except inside `events`, which are kept
// exactly as recorded (milliseconds since 1970) so their hashes can be checked.
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { readStore } from '../dashboard/server.mjs';
import { explainRun } from '../core/explain.mjs';
import { canonical } from '../../src/data.mjs';
import { GAPS, CHANNEL_WORDS } from './brief.mjs';
import { buildInfo } from './build-info.mjs';
import { DecisionLog } from './decisions.mjs';
import { sentMarks, listDrafts } from './drafts.mjs';
import { AuthorityMaps } from './authority-map.mjs';

const iso = t => (t === null || t === undefined ? null : new Date(t).toISOString());
const sha = s => createHash('sha256').update(s).digest('hex');

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
  const batch = batches ? batches.all().find(b => b.result?.runId === runId) ?? null : null;
  const byApproval = Object.fromEntries(Object.entries(batch?.usedBy ?? {}).map(([n, u]) => [u.approvalId, { batchId: batch.batchId, item: Number(n), digest: batch.items.find(i => i.n === Number(n))?.digest ?? null }]));
  const decisions = raw.chain.events.filter(e => /approval/i.test(e.type)).map(e => ({ seq: e.seq, at: iso(e.at), type: e.type, node: e.nodeKey ?? null,
    approvalId: e.approvalId ?? null, actor: e.actor ?? null, approved: e.approved ?? null,
    ...(e.type === 'approval.decided' && byApproval[e.approvalId] ? { fromList: { ...byApproval[e.approvalId], appliedBy: 'Foundry, from the person\'s one approval of the list' } } : {}) }));
  const log = new DecisionLog(app.root);
  const logCheck = log.verify();
  const marks = sentMarks(app), runDrafts = listDrafts(app).filter(d => d.runId === runId);
  let org = null; try { const cur = new AuthorityMaps(app.root).current(); org = cur ? { version: cur.version, hash: cur.hash, enforcedAtRunTime: false } : null; } catch { org = null; }
  const build = buildInfo();
  const bundle = {
    schema: 'foundry-evidence/2', generatedAt: date.toISOString(), generatedOn: { host: hostname(), note: 'this computer; not sent anywhere' },
    foundry: { name: build.name, version: build.version, commit: build.commit, changedSinceCommit: build.changedSinceCommit, files: build.tree },
    run: { runId, flowId: raw.header.workflowId, status: raw.header.status, verdict: raw.header.verdict?.verdict ?? null, createdAt: iso(raw.header.createdAt), updatedAt: iso(raw.header.updatedAt),
      headline: view?.headline ?? null, checks: view?.checks ?? [],
      startedBy: batch?.result?.startedBy ?? batch?.decision?.by ?? null, startedThrough: batch ? CHANNEL_WORDS[batch.decision?.channel] ?? batch.decision?.channel : null,
      startedNote: batch ? 'The run started when the person approved its list.' : 'Who started this run was not recorded (it was not started from an approved list).' },
    chain: { verified: raw.chain.ok, events: raw.chain.count, head: raw.chain.head, reason: raw.chain.reason ?? null },
    workflow: { hash: raw.header.workflowHash, version: raw.workflow?.version ?? null, title: raw.workflow?.title ?? null, note: raw.workflowNote, body: raw.workflow },
    turnedOn: approved ? { approvalId: approved.id, by: approved.principal, channel: approved.channel, channelWords: CHANNEL_WORDS[approved.channel] ?? approved.channel,
      requestedAt: iso(approved.requestedAt), decidedAt: iso(approved.decidedAt), note: approved.note, proposalId: approved.proposalId, proposalStatus: proposal?.status ?? null } : null,
    ledger: activations.map(a => ({ approvalId: a.id, status: a.status, by: a.principal, channel: a.channel, decidedAt: iso(a.decidedAt), workflowHash: a.workflowHash })),
    practice: dry ? { dryRunId: dry.id, passed: dry.passed, at: iso(dry.at), workflowHash: dry.workflowHash, dataSource: dry.body.dataSource ?? 'template', checks: dry.body.checks } : null,
    actionDecisions: decisions,
    batch: batch ? { batchId: batch.batchId, decision: batch.decision, asOf: batch.input?.now ?? null, createdAt: batch.createdAt, items: batch.items.length, made: batch.result?.made ?? null,
      stoppedAt: batch.result?.stoppedAt ?? null, list: batch.items.map(i => ({ n: i.n, action: i.action, to: i.to, subject: i.subject, bodySha256: sha(String(i.body ?? '')), digest: i.digest })) } : null,
    declinedLists: batches ? batches.all().filter(b => b.flowId === raw.header.workflowId && b.status === 'declined').map(b => ({ batchId: b.batchId, decision: b.decision, items: b.items.length,
      list: b.items.map(i => ({ n: i.n, to: i.to, subject: i.subject, digest: i.digest })) })) : [],
    draftsMarkedSent: runDrafts.map(d => ({ draft: d.id, to: d.to, subject: d.subject, markedSent: marks[d.id] ?? null })),
    personDecisions: { log: 'site/decisions.jsonl', check: logCheck, lines: log.forFlow(raw.header.workflowId) },
    whoDecidesWhat: org,
    events: raw.chain.events,
    gaps: GAPS,
    howToCheck: 'Run: node app/cli.mjs check-evidence FILE. By hand: for each event in order, drop its hash field and take sha256 of its canonical JSON (keys sorted, no spaces): it must equal the hash shown, and the next event must name it as previousHash. The last hash must equal chain.head. The workflow body must hash the same way to workflow.hash. Each line of personDecisions.lines hashes the same way (without its hash) and names the line before as prev.'
  };
  return bundle;
}

/** Check an evidence file on its own (what `node app/cli.mjs check-evidence FILE` runs). Returns { ok, problems: [], checked: {} }. */
export function checkEvidence(bundle) {
  const problems = [], checked = { events: 0, decisions: 0 };
  const hashOf = v => sha(canonical(v));
  let prev = null;
  for (const e of bundle?.events ?? []) {
    const { hash, ...rest } = e;
    if (hashOf(rest) !== hash) problems.push(`event ${e.seq}: its hash does not match its content`);
    if ((e.previousHash ?? null) !== prev) problems.push(`event ${e.seq}: it does not name the event before it`);
    prev = hash; checked.events += 1;
  }
  if (bundle?.chain?.head && prev !== bundle.chain.head) problems.push('the last event is not the chain head the file states');
  if (bundle?.workflow?.body && hashOf(bundle.workflow.body) !== bundle.workflow.hash) problems.push('the workflow body does not hash to the workflow hash');
  for (const l of bundle?.personDecisions?.lines ?? []) {
    const { hash, ...rest } = l;
    if (hashOf(rest) !== hash) problems.push(`decision ${l.seq}: its hash does not match its content`);
    checked.decisions += 1;
  }
  return { ok: problems.length === 0, problems, checked };
}
