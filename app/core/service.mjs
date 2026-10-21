// FoundryApp: the one service behind the spike's three faces (MCP tools, dashboard, CLI). It wraps the existing runtime without changing
// it (src/ is frozen for this work): the Foundry facade, its store, proposals, runs and approvals are the real ones.
//
// Lifecycle it enforces (research/surface-20261021/DESIGN.md §2):
//   propose (version-bound proposal; the model may do this) -> dry run on practice data (isolated store, practice registry)
//   -> approval request (needs a passing dry run of the SAME hash) -> a person decides (dashboard, CLI or the MCP client's dialog)
//   -> the proposal is applied (head compare-and-swap) -> runs of that exact hash only -> each outside action asks again.
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Foundry } from '../../src/foundry.mjs';
import { FoundryError, errorData, digest } from '../../src/data.mjs';
import { appRegistry } from './capabilities.mjs';
import { buildFromIntent, SAMPLE_INPUT, BUILDER_ID } from './builder.mjs';
import { describeWorkflow, explainRun, failureText } from './explain.mjs';
import { Ledger, HUMAN_CHANNELS } from './ledger.mjs';

const problem = (error, extra = {}) => ({ ok: false, problem: { ...(failureText(errorData(error)) ?? {}), code: error.code ?? 'ERROR', details: errorData(error).message }, ...extra });

export class FoundryApp {
  constructor({ workspace, now = Date.now } = {}) {
    if (typeof workspace !== 'string' || !workspace.trim()) throw new FoundryError('APP_WORKSPACE', 'A workspace directory is required');
    this.root = path.resolve(workspace);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.liveDir = path.join(this.root, 'live'); this.outboxDir = path.join(this.root, 'outbox'); this.practiceRoot = path.join(this.root, 'practice');
    this.registry = appRegistry({ mode: 'live', outboxDir: this.outboxDir });
    this.foundry = new Foundry(this.liveDir, { registry: this.registry });
    this.ledger = new Ledger(path.join(this.root, 'app-ledger.sqlite'), { now });
  }
  async close() { await this.foundry.close(); this.ledger.close(); }
  get storeFile() { return path.join(this.foundry.store.directory, 'foundry.sqlite'); }

  #head(flowId) { try { return this.foundry.store.workflow(flowId); } catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; } }
  #baseOf(head) {
    if (!head) return null;
    const send = head.workflow.nodes.find(n => n.id === 'send'), compose = head.workflow.nodes.find(n => n.id === 'compose');
    return { id: head.workflow.id, version: head.workflow.version, recipient: send?.args?.to ?? null, team: compose?.args?.variables?.team ?? null };
  }

  /** describe-intent -> a version-bound proposal, questions, or an honest refusal. Never runs anything. */
  propose({ request, answers = {}, flowId = null }) {
    let head = flowId ? this.#head(flowId) : null;
    if (flowId && !head) return problem(new FoundryError('NOT_FOUND', `No flow named ${flowId}`));
    let built = buildFromIntent({ request, answers, base: this.#baseOf(head) });
    if (built.status !== 'ready') return { ok: true, ...built };
    // Same template, same team: this is a new version of an existing flow, never a silent second copy.
    if (!head) { head = this.#head(built.workflow.id); if (head) built = buildFromIntent({ request, answers, base: this.#baseOf(head) }); }
    // A revision that would change nothing but the version number is not proposed (a schedule, for example, is not part of the flow).
    if (head && digest({ ...built.workflow, version: 0 }) === digest({ ...head.workflow, version: 0 }))
      return { ok: true, status: 'no_change', flowId: head.workflow.id, version: head.workflow.version, builder: BUILDER_ID, understood: built.understood,
        reply: 'Nothing in the flow would change, so no new version was made. Schedules and connectors are not part of this preview yet.' };
    const validation = this.foundry.validate(built.workflow, { strict: true });
    if (!validation.valid) return problem(new FoundryError('INVALID_PROPOSAL', 'The builder produced a workflow that does not validate'), { validation });
    const designRequest = this.foundry.store.createAgentDesignRequest({ task: request, workflowId: head ? head.workflow.id : null, expectedHash: head?.hash ?? null });
    const proposal = this.foundry.propose({ requestId: designRequest.id, workflow: built.workflow,
      rationale: `Built by ${BUILDER_ID} from template ${built.template}. Understood: ${JSON.stringify(built.understood)}` });
    return { ok: true, status: 'proposed', builder: BUILDER_ID, proposalId: proposal.id, requestId: designRequest.id, flowId: built.workflow.id,
      version: built.workflow.version, workflowHash: proposal.workflowHash, basedOn: head ? { version: head.workflow.version, hash: head.hash } : null,
      changes: proposal.impact, understood: built.understood, willDo: built.willDo, willNotDo: built.willNotDo,
      summary: describeWorkflow(built.workflow, this.registry), lintWarnings: validation.warnings.map(w => w.code),
      next: 'Try it on practice data with dry_run. Nothing has run and nothing is active yet.' };
  }

  explain({ proposalId = null, flowId = null }) {
    if (proposalId) {
      const p = this.foundry.store.proposal(proposalId);
      return { ok: true, proposalId, status: p.status, workflowHash: p.workflowHash, changes: p.impact, summary: describeWorkflow(p.workflow, this.registry),
        dryRun: this.ledger.latestDryRun(proposalId), approval: this.ledger.forFlow(p.workflow.id).find(a => a.proposalId === proposalId) ?? null };
    }
    const head = this.#head(flowId);
    if (!head) return problem(new FoundryError('NOT_FOUND', `No flow named ${flowId}`));
    return { ok: true, flowId, workflowHash: head.hash, summary: describeWorkflow(head.workflow, this.registry), active: !!this.ledger.approvedFor(flowId, head.hash) };
  }

  /** Run the exact proposed workflow on practice data in its own store, with the practice registry. Records the result. */
  async dryRun({ proposalId, input }) {
    const proposal = this.foundry.store.proposal(proposalId);
    const dir = path.join(this.practiceRoot, `${proposalId.slice(0, 8)}-${randomUUID().slice(0, 8)}`), outbox = path.join(dir, 'outbox');
    const registry = appRegistry({ mode: 'practice', outboxDir: outbox });
    const practice = new Foundry(dir, { registry });
    try {
      let done, events = [];
      practice.save(proposal.workflow);
      try { done = await practice.startRun(practice.createRun(proposal.workflow.id, input ?? SAMPLE_INPUT).id); }
      catch (error) { return problem(error, { practice: true, passed: false, next: 'Fix the practice input or ask for a changed flow.' }); }
      events = practice.store.events(done.id);
      const wouldDo = existsSync(outbox) ? readdirSync(outbox).filter(f => f.endsWith('.json')).map(f => {
        const m = JSON.parse(readFileSync(path.join(outbox, f), 'utf8'));
        return { action: 'send', to: m.to, subject: m.subject, preview: m.body.slice(0, 400) };
      }) : [];
      const explained = explainRun(done, proposal.workflow, events);
      const passed = done.status === 'succeeded' && done.verdict?.verdict === 'pass';
      const record = this.ledger.recordDryRun({ proposalId, workflowHash: proposal.workflowHash, registryHash: registry.hash(), practiceRunId: done.id, passed,
        body: { headline: explained.headline, checks: explained.checks, wouldDo, inputHash: digest(input ?? SAMPLE_INPUT), practiceDir: dir } });
      return { ok: true, practice: true, dryRunId: record.id, passed, headline: explained.headline, checks: explained.checks, wouldDo, problem: explained.problem,
        practiceRunId: done.id, workflowHash: proposal.workflowHash, practiceRegistryHash: registry.hash(), liveRegistryHash: this.registry.hash(),
        caveat: 'Practice used a stand-in for sending and sample items. It shows the flow behaves as described; it does not show delivery works.',
        next: passed ? 'Ask the person to approve it (approve). They decide in their own window, not you.' : 'Do not ask for approval: the practice run did not pass.' };
    } finally { await practice.close(); }
  }

  /** Ask a person to turn this exact version on. Returns the open request; it never decides it. */
  requestApproval({ proposalId }) {
    const proposal = this.foundry.store.proposal(proposalId);
    const dry = this.ledger.latestDryRun(proposalId);
    if (!dry || !dry.passed || dry.workflowHash !== proposal.workflowHash) return problem(new FoundryError('NEEDS_DRY_RUN', 'Run a passing practice run of this exact version first'));
    if (proposal.status !== 'proposed') {
      const active = this.ledger.approvedFor(proposal.workflow.id, proposal.workflowHash);
      if (active) return { ok: true, status: 'approved', approvalId: active.id, flowId: proposal.workflow.id, workflowHash: proposal.workflowHash };
      return problem(new FoundryError('PROPOSAL_CLOSED', `This proposal is ${proposal.status}`));
    }
    const act = this.ledger.requestActivation({ flowId: proposal.workflow.id, proposalId, workflowHash: proposal.workflowHash, dryRunId: dry.id });
    return { ok: true, status: 'awaiting_human', approvalId: act.id, flowId: proposal.workflow.id, version: proposal.workflow.version, workflowHash: proposal.workflowHash,
      summary: describeWorkflow(proposal.workflow, this.registry), practice: { dryRunId: dry.id, checks: dry.body.checks } };
  }

  /** A person's decision on turning a version on (called by the dashboard, the CLI, or the MCP elicitation handler only). */
  decideActivation(id, approved, { channel, principal = 'local-user', note = null } = {}) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Approvals come only from a person, not from ${channel}`);
    const act = this.ledger.activation(id), proposal = this.foundry.store.proposal(act.proposalId);
    if (approved && proposal.workflowHash !== act.workflowHash) throw new FoundryError('STALE_APPROVAL', 'The proposal changed after the request was made');
    const decided = this.ledger.decide(id, approved, { channel, principal, note, expectRev: act.rev });
    if (!approved) return { ok: true, status: 'rejected', approvalId: id };
    try { if (proposal.status === 'proposed') this.foundry.apply(act.proposalId); }
    catch (error) {
      this.ledger.db.prepare("UPDATE activations SET status='superseded', note=?, rev=rev+1 WHERE id=? AND rev=?").run(`apply failed: ${error.code}`, id, decided.rev);
      return problem(new FoundryError('STALE_APPROVAL', `Approved, but the flow changed meanwhile (${error.code}); nothing was turned on`));
    }
    return { ok: true, status: 'approved', approvalId: id, flowId: act.flowId, workflowHash: act.workflowHash, channel };
  }

  /** Run the current, approved version. Refuses unapproved or stale versions. */
  async run({ flowId, input }) {
    const head = this.#head(flowId);
    if (!head) {
      const proposed = this.foundry.store.proposals().some(p => p.workflow.id === flowId && p.status === 'proposed');
      return problem(new FoundryError(proposed ? 'NOT_APPROVED' : 'NOT_FOUND', proposed ? `${flowId} is proposed but not turned on yet` : `No flow named ${flowId}`));
    }
    if (!this.ledger.approvedFor(flowId, head.hash)) {
      const older = this.ledger.forFlow(flowId).find(a => a.status === 'approved');
      return problem(new FoundryError(older ? 'STALE_APPROVAL' : 'NOT_APPROVED', older ? 'The approved version is not the current one' : 'This version has not been approved to run'));
    }
    let created;
    try { created = this.foundry.createRun(flowId, input ?? {}); } catch (error) { return problem(error); }
    if (created.workflowHash !== head.hash) { await this.foundry.cancel(created.id, { graceMs: 0 }); return problem(new FoundryError('STALE_APPROVAL', 'The flow changed while starting')); }
    await this.foundry.startRun(created.id).catch(() => {});
    return this.status({ runId: created.id });
  }

  status({ runId }) {
    const run = this.foundry.publicRun(this.foundry.store.run(runId));
    const workflow = this.foundry.store.workflow(run.workflowHash).workflow;
    return { ok: true, ...explainRun(run, workflow, this.foundry.store.events(runId)) };
  }

  list() {
    const flows = this.foundry.store.workflows().map(w => {
      const head = w.workflow ? w : this.foundry.store.workflow(w.id);
      const runs = this.foundry.store.runs().filter(r => r.workflowId === head.workflow.id);
      return { flowId: head.workflow.id, title: head.workflow.title, version: head.workflow.version, workflowHash: head.hash,
        active: !!this.ledger.approvedFor(head.workflow.id, head.hash), runs: runs.length,
        lastRun: runs[0] ? { runId: runs[0].id, status: runs[0].status, at: runs[0].updatedAt } : null };
    });
    const proposals = this.foundry.store.proposals().filter(p => p.status === 'proposed').map(p => ({ proposalId: p.id, flowId: p.workflow.id, version: p.workflow.version,
      workflowHash: p.workflowHash, dryRun: this.ledger.latestDryRun(p.id)?.passed ?? null }));
    return { ok: true, flows, proposals, waitingForYou: this.inbox().count };
  }

  /** Everything waiting for a person: versions to turn on, and actions paused before they happen. */
  inbox() {
    const activations = this.ledger.pending().map(a => {
      const p = this.foundry.store.proposal(a.proposalId);
      return { kind: 'activation', approvalId: a.id, flowId: a.flowId, version: p.workflow.version, workflowHash: a.workflowHash, title: p.workflow.title,
        changes: p.impact, summary: describeWorkflow(p.workflow, this.registry), practice: this.ledger.latestDryRun(a.proposalId)?.body?.checks ?? [] };
    });
    const actions = this.foundry.store.runs().filter(r => r.status === 'awaiting_approval').flatMap(r => {
      const workflow = this.foundry.store.workflow(r.workflowHash).workflow, explained = explainRun(r, workflow);
      return explained.pendingApprovals.map(a => ({ kind: 'action', runId: r.id, flowId: r.workflowId, approvalId: a.approvalId, step: a.step, tool: a.tool,
        to: a.args?.to ?? null, subject: a.args?.subject ?? null, preview: typeof a.args?.body === 'string' ? a.args.body.slice(0, 600) : null }));
    });
    return { activations, actions, count: activations.length + actions.length };
  }

  /** A person's decision on one paused action; on yes, the run resumes here. */
  async decideAction(runId, approvalId, approved, { channel } = {}) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Approvals come only from a person, not from ${channel}`);
    this.foundry.runtime.approve(runId, approvalId, approved, 'user');
    if (approved) await this.foundry.startRun(runId).catch(() => {});
    return this.status({ runId });
  }
}
