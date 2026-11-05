// FoundryApp: the one service behind the spike's three faces (MCP tools, dashboard, CLI). It wraps the existing runtime without changing
// it (src/ is frozen for this work): the Foundry facade, its store, proposals, runs and approvals are the real ones.
//
// Lifecycle it enforces (research/surface-20261021/DESIGN.md §2):
//   propose (version-bound proposal; the model may do this) -> dry run on practice data (isolated store, practice registry)
//   -> approval request (needs a passing dry run of the SAME hash) -> a person decides (dashboard, CLI or the MCP client's dialog)
//   -> the proposal is applied (head compare-and-swap) -> runs of that exact hash only -> each outside action asks again.
//
// The builder is pluggable (BUILDER-1): the stub (default, $0, no model), the model builder over the example library
// (./builder-model.mjs) or the free-form builder (./builder-freeform.mjs). All return the same shape; every proposal names its builder.
//
// The free-form front door (app/FRONT-DOOR.md): propose also takes a typed `workflow` the calling agent built (with `practiceInput`
// cases). It is checked by code (./freeform.mjs: capabilities this app has, semantics it can run, every outside-effect target grounded in
// the person's words or data, an independent check per kind of outside effect, strict validation and the construction lint) and then goes
// through the same path: practice of that exact version (./freeform-practice.mjs), the person's yes, compare-and-swap, per-action asks.
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Foundry } from '../../src/foundry.mjs';
import { FoundryError, errorData, digest } from '../../src/data.mjs';
import { appRegistry } from './capabilities.mjs';
import { SAMPLE_INPUT, stubBuilder } from './builder.mjs';
import { templateOf, slotsOf, practiceOf } from './library.mjs';
import { plainTextProblems } from './plain-text.mjs';
import { runInWorld } from './practice.mjs';
import { checkFreeform, practiceCases, refusalReply, wordsOf, allNodes } from './freeform.mjs';
import { practiseCase, sheetsRead, wouldDoOf } from './freeform-practice.mjs';
import { describeWorkflow, explainRun, failureText, reword } from './failure-words.mjs';
import { Ledger, HUMAN_CHANNELS } from './ledger.mjs';
import { machinePolicy } from './machine-policy.mjs';
import { Tracker } from './tracker/index.mjs';
import * as tracked from './tracker/service-hooks.mjs';

// The digest that binds a planned outside action to its full content: sha256 of the canonical {tool, args} (batch approval matches on it).
export const effectDigest = (tool, args) => digest({ tool, args });
/**
 * Honesty review 2026-10-21 (minor 6): mkdir's mode applies only to a folder it creates, so a workspace that already existed (a --workspace
 * the person made) kept its mode, and folders and files inside get the default modes. Each start sets the workspace itself to 0700, which
 * keeps other OS users out of everything inside it. Only a folder this account owns, and never the home folder or the filesystem root.
 */
export function privateWorkspace(root) {
  try {
    const st = statSync(root), uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid === null || st.uid !== uid || path.resolve(root) === path.resolve(homedir()) || path.resolve(root) === path.parse(path.resolve(root)).root) return false;
    if ((st.mode & 0o777) !== 0o700) chmodSync(root, 0o700);
    return true;
  } catch { return false; }
}
/**
 * Whether other OS users are kept out of the workspace, as it is now: { private: true | false | null, mode: '0700' | null, mine }. null
 * where modes say nothing (no POSIX user ids, as on Windows). The pages say "only your user" only when this is true (honesty review,
 * minor 6): privateWorkspace() leaves the home folder and a folder of another account as they are.
 */
export function workspacePrivacy(root) {
  try {
    const st = statSync(root), uid = typeof process.getuid === 'function' ? process.getuid() : null;
    const mode = (st.mode & 0o777).toString(8).padStart(4, '0');
    if (uid === null) return { private: null, mode: null, mine: null };
    return { private: st.uid === uid && (st.mode & 0o077) === 0, mode, mine: st.uid === uid };
  } catch { return { private: false, mode: null, mine: null }; }
}
/** Security review 2026-10-21 (L16): the workspace keeps itself out of any git repository it sits in (a .gitignore that ignores all). */
export function ignoreWorkspace(root) { try { writeFileSync(path.join(root, '.gitignore'), '# Foundry: your lists, drafts, records and decisions. Never commit them.\n*\n', { flag: 'wx', mode: 0o600 }); } catch { /* already there, or not writable */ } }
// The service's own codes and the onboarding wording are in ./failure-words.mjs (app/core/explain.mjs is frozen by the BUILDER-1 manifest).
const plainFailure = data => failureText(data);
const problem = (error, extra = {}) => ({ ok: false, problem: { ...(plainFailure(errorData(error)) ?? {}), code: error.code ?? 'ERROR', details: errorData(error).message }, ...extra });

export class FoundryApp {
  constructor({ workspace, now = Date.now, builder = stubBuilder, trackerPort = null, trackerModel = 'claude-haiku-5-5' } = {}) {
    if (typeof workspace !== 'string' || !workspace.trim()) throw new FoundryError('APP_WORKSPACE', 'A workspace directory is required');
    if (!builder || typeof builder.build !== 'function' || typeof builder.id !== 'string') throw new FoundryError('APP_BUILDER', 'A builder with an id and build() is required');
    this.root = path.resolve(workspace); this.builder = builder;
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    privateWorkspace(this.root);
    ignoreWorkspace(this.root);
    this.liveDir = path.join(this.root, 'live'); this.outboxDir = path.join(this.root, 'outbox'); this.practiceRoot = path.join(this.root, 'practice');
    // Local stand-ins (sheets, chat) live in the workspace's world directory: <workspace>/world/sheets/<name>.json.
    this.worldDir = path.join(this.root, 'world');
    this.registry = appRegistry({ mode: 'live', outboxDir: this.outboxDir, worldDir: this.worldDir });
    this.foundry = new Foundry(this.liveDir, { registry: this.registry });
    this.ledger = new Ledger(path.join(this.root, 'app-ledger.sqlite'), { now });
    // The condition tracker (task #60): without a model port it logs the person's words as conditions ($0 rule) and binds no check.
    this.tracker = new Tracker({ file: path.join(this.root, 'conditions.sqlite'), port: trackerPort, model: trackerModel, now });
  }
  async close() { await this.foundry.close(); this.ledger.close(); this.tracker.close(); }
  get storeFile() { return path.join(this.foundry.store.directory, 'foundry.sqlite'); }

  #head(flowId) { try { return this.foundry.store.workflow(flowId); } catch (error) { if (error.code === 'NOT_FOUND') return null; throw error; } }
  #baseOf(head) {
    if (!head) return null;
    const template = templateOf(head.workflow);
    if (template) return { id: head.workflow.id, version: head.workflow.version, template: template.id, slots: slotsOf(head.workflow) ?? {} };
    const send = head.workflow.nodes.find(n => n.id === 'send'), compose = head.workflow.nodes.find(n => n.id === 'compose');
    return { id: head.workflow.id, version: head.workflow.version, recipient: send?.args?.to ?? null, team: compose?.args?.variables?.team ?? null, workflow: head.workflow };
  }

  /** describe-intent -> a version-bound proposal, questions, or an honest refusal. Never runs anything. Asynchronous: a model may build. */
  // template / settings / origin (onboarding site, app/onboarding/form-builder.mjs): a template id and its settings filled from a form
  // (origin 'site-form') or by the person's coding agent (origin 'agent'); builders that do not know them ignore them.
  // workflow / practiceInput (the free-form front door): a typed workflow the calling agent built, with optional practice cases.
  async propose({ request, answers = {}, flowId = null, template = undefined, settings = undefined, origin = undefined, workflow = undefined, practiceInput = undefined }) {
    if (workflow !== undefined) return this.#proposeFreeform({ request, answers, flowId, workflow, practiceInput, builder: 'the calling agent (free-form)' });
    let head = flowId ? this.#head(flowId) : null;
    if (flowId && !head) return problem(new FoundryError('NOT_FOUND', `No flow named ${flowId}`));
    let built;
    try { built = await this.builder.build({ request, answers, base: this.#baseOf(head), ...(template !== undefined ? { template, settings, origin } : {}) }); }
    catch (error) { if (['REQUEST_TEXT', 'ANSWERS'].includes(error.code)) throw error; return problem(error, { builder: this.builder.id }); }
    const report = built.buildReport ? (({ callLog, ...rest }) => rest)(built.buildReport) : null;
    if (built.status !== 'ready') { const { args, buildReport, ...rest } = built; return { ok: true, ...rest, ...(report ? { build: report } : {}) }; }
    // A free-form builder's workflow takes the same checks and practice as an agent's (./builder-freeform.mjs).
    if (built.freeform) return this.#proposeFreeform({ request, answers, flowId, workflow: built.workflow, practiceInput: built.practice, builder: built.builder, report, understood: built.understood });
    // Same template, same team: this is a new version of an existing flow, never a silent second copy.
    if (!head) { head = this.#head(built.workflow.id); if (head) built = await this.builder.rebase(built, this.#baseOf(head)); }
    // A revision that would change nothing but the version number is not proposed (a schedule, for example, is not part of the flow).
    const same = w => digest({ ...w, version: 0, metadata: null });
    if (head && same(built.workflow) === same(head.workflow))
      return { ok: true, status: 'no_change', flowId: head.workflow.id, version: head.workflow.version, builder: built.builder, understood: built.understood,
        reply: 'Nothing in the flow would change, so no new version was made. Schedules and connectors are not part of this preview yet.', ...(report ? { build: report } : {}) };
    const validation = this.foundry.validate(built.workflow, { strict: true });
    if (!validation.valid) return problem(new FoundryError('INVALID_PROPOSAL', 'The builder produced a workflow that does not validate'), { validation, builder: built.builder });
    // L8, whichever builder made it (a model's settings included): every text setting is plain text (app/core/plain-text.mjs).
    const plain = plainTextProblems(templateOf(built.workflow), slotsOf(built.workflow));
    if (plain.length) return { ok: true, status: 'build_failed', builder: built.builder, template: built.template, problems: plain,
      reply: `Some settings are not usable: ${plain.join('; ')}. Nothing was created.` };
    const task = typeof request === 'string' && request.trim() ? request : `Settings for template ${built.template} filled in a form: ${JSON.stringify(settings ?? {}).slice(0, 4000)}`;
    const designRequest = this.foundry.store.createAgentDesignRequest({ task, workflowId: head ? head.workflow.id : null, expectedHash: head?.hash ?? null });
    const proposal = this.foundry.propose({ requestId: designRequest.id, workflow: built.workflow,
      rationale: `Built by ${built.builder} from template ${built.template}. Understood: ${JSON.stringify(built.understood)}` });
    const conditions = await tracked.trackProposal(this, { flowId: built.workflow.id, request, answers });
    return { ok: true, status: 'proposed', builder: built.builder, template: built.template, ...(report ? { build: report } : {}), conditions, proposalId: proposal.id, requestId: designRequest.id, flowId: built.workflow.id,
      version: built.workflow.version, workflowHash: proposal.workflowHash, basedOn: head ? { version: head.workflow.version, hash: head.hash } : null,
      changes: proposal.impact, understood: built.understood, willDo: built.willDo, willNotDo: built.willNotDo,
      summary: describeWorkflow(built.workflow, this.registry), lintWarnings: validation.warnings.map(w => w.code),
      next: 'Try it on practice data with dry_run. Nothing has run and nothing is active yet.' };
  }

  /**
   * The free-form front door: check a typed workflow (built by the calling agent, or by the free-form builder from the person's words)
   * and make a version-bound proposal of it, or refuse with named blockers. Never runs anything and never changes the workflow.
   */
  async #proposeFreeform({ request, answers = {}, flowId = null, workflow, practiceInput, builder, report = null, understood = null }) {
    const refused = (blockers, extra = {}) => ({ ok: true, status: 'refused', builder, blockers, reply: refusalReply(blockers), ...(report ? { build: report } : {}), ...extra,
      next: 'Fix what each blocker names and propose again, or tell the person plainly what Foundry cannot do. Nothing was created.' });
    if (typeof request !== 'string' || !request.trim()) throw new FoundryError('REQUEST_TEXT', 'Pass the person\'s own words in request: every address a workflow uses is checked against them');
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || typeof workflow.id !== 'string')
      return refused([{ code: 'NOT_A_WORKFLOW', what: 'What was passed is not a workflow (an object with an id and nodes).', next: 'Build a typed workflow as construction_guide describes.' }]);
    // Which flow this is a version of: the one named, or the one with the workflow's id. Compare-and-swap happens at apply (expectedHash).
    let head = flowId ? this.#head(flowId) : this.#head(workflow.id);
    if (flowId && !head) return problem(new FoundryError('NOT_FOUND', `No flow named ${flowId}`));
    if (flowId && workflow.id !== flowId) return refused([{ code: 'FLOW_MISMATCH', what: `The workflow's id is ${String(workflow.id).slice(0, 64)}, but it was proposed as a change to ${flowId}.`, next: `Give the workflow the id ${flowId}, or leave flowId out to make a new automation.` }]);
    const wantVersion = head ? head.workflow.version + 1 : 1;
    if (workflow.version !== wantVersion) return refused([{ code: 'VERSION_CONFLICT', what: head ? `${workflow.id} is at version ${head.workflow.version}, so a change to it is version ${wantVersion}, not ${workflow.version}.` : `A new automation starts at version 1, not ${workflow.version}.`,
      next: `Set version to ${wantVersion} (list_flows shows each automation's current version).` }]);
    const same = w => digest({ ...w, version: 0, metadata: null });
    if (head && same(workflow) === same(head.workflow))
      return { ok: true, status: 'no_change', flowId: head.workflow.id, version: head.workflow.version, builder, reply: 'Nothing in the flow would change, so no new version was made.' };
    const words = wordsOf(request, answers);
    const checked = checkFreeform(workflow, { registry: this.registry, words, validate: w => this.foundry.validate(w, { strict: true }) });
    const blockers = [...checked.blockers];
    // Practice cases: the agent's (or the builder's), checked against the input schema now, so a bad one is refused before anything exists.
    let cases = [];
    try { cases = practiceCases(practiceInput, workflow.inputSchema ?? { type: 'object' }); }
    catch (error) { blockers.push({ code: 'PRACTICE_INPUT', what: `A practice case is not usable: ${String(error.message).slice(0, 300)}.`, next: 'A case is { name, input, sheets: { sheetName: [rows] }, answers: { humanStepId: answer } }; its input must satisfy the workflow\'s inputSchema.' }); }
    const reads = sheetsRead(workflow);
    const lacking = reads.filter(sheet => !cases.length || cases.some(c => !Array.isArray(c.sheets?.[sheet])));
    if (reads.length && lacking.length && !blockers.some(b => b.code === 'PRACTICE_INPUT'))
      blockers.push({ code: 'PRACTICE_DATA_MISSING', what: `Practice needs rows for the sheet(s) the workflow reads: ${lacking.join(', ')}. Foundry does not invent rows for a sheet.`,
        next: 'Give practiceInput cases with sheets: { name: [rows] } that look like the person\'s data (include the cases that must NOT trigger an action).' });
    if (blockers.length) return refused(blockers, { validation: checked.validation ? { valid: checked.validation.valid, errors: (checked.validation.errors ?? []).slice(0, 20), lint: checked.validation.lint ?? null } : null });
    const designRequest = this.foundry.store.createAgentDesignRequest({ task: request, workflowId: head ? head.workflow.id : null, expectedHash: head?.hash ?? null });
    const proposal = this.foundry.propose({ requestId: designRequest.id, workflow,
      rationale: `Built by ${builder} (free-form). Checked by code: capabilities, outside-effect targets in the person's words or data, an independent check per outside effect, strict validation and the construction lint.` });
    const effects = checked.effects;
    this.ledger.recordFreeform({ proposalId: proposal.id, workflowHash: proposal.workflowHash, body: { builder, cases, effects, words: words.slice(0, 30000) } });
    const conditions = await tracked.trackProposal(this, { flowId: workflow.id, request, answers });
    const summary = describeWorkflow(workflow, this.registry);
    const asks = [...new Set(effects.filter(e => this.registry.get(e.tool)?.requiresApproval).map(e => e.verb))];
    const silent = [...new Set(effects.filter(e => !this.registry.get(e.tool)?.requiresApproval).map(e => e.verb))];
    const humans = allNodes(workflow).filter(({ node }) => node.kind === 'human').length;
    return { ok: true, status: 'proposed', builder, ...(report ? { build: report } : {}), conditions, proposalId: proposal.id, requestId: designRequest.id, flowId: workflow.id,
      version: workflow.version, workflowHash: proposal.workflowHash, basedOn: head ? { version: head.workflow.version, hash: head.hash } : null, changes: proposal.impact,
      understood: understood ?? { request: request.slice(0, 300) },
      willDo: [...summary.steps.map(s => s.text), ...(asks.length ? [`Ask you before it does each of these: ${asks.join(', ')}`] : []),
        ...(silent.length ? [`Do this without asking each time (safe to repeat, and re-checked after the run): ${silent.join(', ')}`] : []), ...(humans ? [`Ask you ${humans} question(s) while it runs`] : [])],
      willNotDo: [...(summary.notSupported ?? []), ...(asks.length ? ['Send or post anything you have not said yes to'] : []), 'Run before you turn it on'],
      outsideActions: effects.map(e => ({ step: e.description, does: e.verb, to: e.target ?? 'from your data', source: e.source, asksFirst: !!this.registry.get(e.tool)?.requiresApproval })),
      practice: { cases: cases.length ? cases.map(c => c.name) : ['made by Foundry from the input schema'], generatedInput: !cases.length || cases.some(c => c.inputGenerated) },
      summary, lintWarnings: (checked.validation?.warnings ?? []).map(w => w.code), notes: checked.notes,
      next: 'Try it on practice data with dry_run. Nothing has run and nothing is active yet.' };
  }

  /** A free-form proposal's dry run: every practice case on the exact version, outside effects against their stand-ins. */
  async #dryRunFreeform(proposal, record, input = undefined, ownSheets = null) {
    let cases = record.body.cases ?? [];
    try {
      if (input !== undefined) cases = practiceCases([{ name: 'your practice input', input, sheets: ownSheets ?? cases[0]?.sheets ?? {}, answers: cases[0]?.answers ?? {} }], proposal.workflow.inputSchema ?? { type: 'object' });
      else if (!cases.length) cases = practiceCases([{}], proposal.workflow.inputSchema ?? { type: 'object' });
    } catch (error) { return problem(error, { practice: true, passed: false, next: 'Fix the practice input or ask for a changed flow.' }); }
    mkdirSync(this.practiceRoot, { recursive: true, mode: 0o700 });
    const results = [];
    for (const c of cases) results.push(await practiseCase(proposal.workflow, c, { root: this.practiceRoot, keep: true }));
    const passed = results.every(r => r.passed);
    const wouldDo = results.flatMap(r => wouldDoOf(r.effects ?? { outbox: [], chat: {}, appended: {} }, cases.length > 1 ? r.name : null));
    const checks = results.flatMap(r => (r.explained?.checks ?? []).map(c => ({ ...c, ...(cases.length > 1 ? { case: r.name } : {}) })));
    const firstBad = results.find(r => !r.passed);
    const headline = passed ? `Practice passed${cases.length > 1 ? ` in all ${cases.length} cases` : ''}.` : `Practice case “${firstBad.name}” did not pass: ${firstBad.explained?.headline ?? firstBad.error?.message ?? firstBad.status}`;
    const standIns = results.flatMap(r => r.answered.map(a => ({ case: r.name, step: a.step, answer: a.answer, from: a.from })));
    const listDigest = digest(wouldDo.map(w => w.digest));
    const body = { headline, checks, wouldDo, wouldDoDigest: listDigest, dataSource: 'practice', freeform: true, standIns,
      cases: results.map((r, i) => ({ name: r.name, passed: r.passed, status: r.status, inputHash: digest(cases[i].input ?? {}), sheetsHash: digest(cases[i].sheets ?? {}), inputGenerated: !!cases[i].inputGenerated, practiceDir: r.dir, runId: r.run?.id ?? null, error: r.error ?? null })) };
    const dry = this.ledger.recordDryRun({ proposalId: proposal.id, workflowHash: proposal.workflowHash, registryHash: results[0]?.registryHash ?? 'none',
      practiceRunId: results.map(r => r.run?.id ?? 'none').join(','), passed, body });
    const problemOf = firstBad ? (firstBad.error?.code === 'PRACTICE_TIMER' ? { code: 'PRACTICE_TIMER', what: firstBad.error.message, next: 'Practice cannot wait that long. Take the timer\'s time from the run input (wait.at), so a practice case can use a time already due.' }
      : reword(firstBad.explained?.problem) ?? (firstBad.error ? { code: firstBad.error.code, what: firstBad.error.message, next: 'Fix the workflow or the practice case and propose again.' } : null)) : null;
    return { ok: true, practice: true, dryRunId: dry.id, passed, headline, checks, wouldDo, wouldDoDigest: listDigest, problem: problemOf,
      cases: body.cases.map(({ practiceDir, ...c }) => c), ...(standIns.length ? { standInAnswers: standIns } : {}),
      practiceRunId: dry.practiceRunId, workflowHash: proposal.workflowHash, practiceRegistryHash: results[0]?.registryHash ?? null, liveRegistryHash: this.registry.hash(),
      caveat: `Practice used stand-ins for every outside action (sending, posting, sheets)${standIns.length ? ' and stand-in answers at the questions' : ''}, on practice data. It shows the flow behaves as described; it does not show delivery works.`,
      next: passed ? 'Ask the person to turn it on (ask_person_to_turn_on). They decide in their own window, not you.' : 'Do not ask the person to turn it on: practice did not pass.' };
  }

  explain({ proposalId = null, flowId = null }) {
    if (proposalId) {
      const p = this.foundry.store.proposal(proposalId);
      return { ok: true, proposalId, status: p.status, workflowHash: p.workflowHash, changes: p.impact, summary: describeWorkflow(p.workflow, this.registry), inputSchema: p.workflow.inputSchema ?? null,
        dryRun: this.ledger.latestDryRun(proposalId), approval: this.ledger.forFlow(p.workflow.id).find(a => a.proposalId === proposalId) ?? null };
    }
    const head = this.#head(flowId);
    if (!head) return problem(new FoundryError('NOT_FOUND', `No flow named ${flowId}`));
    return { ok: true, flowId, workflowHash: head.hash, summary: describeWorkflow(head.workflow, this.registry), inputSchema: head.workflow.inputSchema ?? null, active: !!this.ledger.approvedFor(flowId, head.hash) };
  }

  /** Run the exact proposed workflow on practice data in its own store, with the practice registry. Records the result. */
  // sheets (library flows only): the person's own rows instead of the template's practice sheets (dataSource 'your-data').
  async dryRun({ proposalId, input, sheets = null }) {
    const proposal = this.foundry.store.proposal(proposalId);
    const template = templateOf(proposal.workflow);
    if (template) return this.#dryRunLibrary(proposal, template, input, sheets);
    const freeform = this.ledger.freeform(proposalId);
    if (freeform) return this.#dryRunFreeform(proposal, freeform, input, sheets);
    const dir = path.join(this.practiceRoot, `${proposalId.slice(0, 8)}-${randomUUID().slice(0, 8)}`), outbox = path.join(dir, 'outbox');
    const registry = appRegistry({ mode: 'practice', outboxDir: outbox });
    const practice = new Foundry(dir, { registry });
    try {
      let done, events = [];
      // Stage the exact proposed version (its hash and version number) without a head, as the trial store does for candidates.
      practice.store.stageEvaluationWorkflow(proposal.workflow);
      try { done = await practice.startRun(practice.createRun(proposal.workflowHash, input ?? SAMPLE_INPUT).id); }
      catch (error) { return problem(error, { practice: true, passed: false, next: 'Fix the practice input or ask for a changed flow.' }); }
      events = practice.store.events(done.id);
      const wouldDo = existsSync(outbox) ? readdirSync(outbox).filter(f => f.endsWith('.json')).map(f => {
        const m = JSON.parse(readFileSync(path.join(outbox, f), 'utf8'));
        return { action: 'send', to: m.to, subject: m.subject, preview: m.body.slice(0, 400), digest: effectDigest('outbox.send', { to: m.to, subject: m.subject, body: m.body }) };
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

  /** A library flow's dry run: the template's practice sheets in a fresh practice world, the practice registry, the exact version. */
  async #dryRunLibrary(proposal, template, input, ownSheets = null) {
    mkdirSync(this.practiceRoot, { recursive: true, mode: 0o700 });
    const world = practiceOf(template), runInput = input ?? world.input;
    const dataSource = ownSheets && Object.keys(ownSheets).length ? 'your-data' : 'template';
    const sheets = dataSource === 'your-data' ? { ...world.sheets, ...ownSheets } : world.sheets;
    const res = await runInWorld(proposal.workflow, { sheets, input: runInput, mode: 'practice', keep: true, root: this.practiceRoot });
    if (['invalid', 'input-refused'].includes(res.status)) return problem(Object.assign(new FoundryError(res.error?.code ?? 'VALIDATION', res.error?.message ?? 'refused'), {}), { practice: true, passed: false, next: 'Fix the practice input or ask for a changed flow.' });
    const wouldDo = [...res.effects.outbox.map(m => ({ action: 'send', to: m.to, subject: m.subject, preview: m.body.slice(0, 400), digest: effectDigest('outbox.send', { to: m.to, subject: m.subject, body: m.body }) })),
      ...Object.entries(res.effects.chat).flatMap(([channel, posts]) => posts.map(text => ({ action: 'post', to: channel, subject: null, preview: text.slice(0, 400), digest: effectDigest('chat.post', { channel, text }) }))),
      ...Object.entries(res.effects.appended).map(([sheet, rows]) => ({ action: 'append', to: sheet, subject: `${rows.length} row(s)`, count: rows.length, rows: rows.slice(0, 50),
        preview: JSON.stringify(rows.slice(0, 3)).slice(0, 400), digest: effectDigest('sheet.append', { sheet, rows }) }))];
    const explained = res.explained;
    const record = this.ledger.recordDryRun({ proposalId: proposal.id, workflowHash: proposal.workflowHash, registryHash: res.run.registryHash, practiceRunId: res.run.id, passed: res.passed,
      body: { headline: explained.headline, checks: explained.checks, wouldDo, inputHash: digest(runInput), sheetsHash: digest(sheets), dataSource, practiceDir: res.dir, template: template.id } });
    return { ok: true, practice: true, dryRunId: record.id, passed: res.passed, dataSource, headline: explained.headline, checks: explained.checks, wouldDo, problem: reword(explained.problem),
      practiceRunId: res.run.id, workflowHash: proposal.workflowHash, practiceRegistryHash: res.run.registryHash, liveRegistryHash: this.registry.hash(),
      caveat: 'Practice used stand-ins for sending, posting and the sheets, with the example\'s practice data. It shows the flow behaves as described; it does not show delivery works.',
      next: res.passed ? 'Ask the person to approve it (approve). They decide in their own window, not you.' : 'Do not ask for approval: the practice run did not pass.' };
  }

  /** Ask a person to turn this exact version on. Returns the open request; it never decides it. */
  // Since the UX review (M7): a removed draft cannot be asked about; the version that is the current one and was turned off can be asked
  // about again (turning on again is a new request and a new yes, never the old yes revived).
  requestApproval({ proposalId }) {
    const proposal = this.foundry.store.proposal(proposalId);
    if (this.ledger.withdrawn(proposalId)) return problem(new FoundryError('DRAFT_REMOVED', 'This draft was removed'));
    const dry = this.ledger.latestDryRun(proposalId);
    if (!dry || !dry.passed || dry.workflowHash !== proposal.workflowHash) return problem(new FoundryError('NEEDS_DRY_RUN', 'Run a passing practice run of this exact version first'));
    if (proposal.status !== 'proposed') {
      const active = this.ledger.approvedFor(proposal.workflow.id, proposal.workflowHash);
      if (active) return { ok: true, status: 'approved', approvalId: active.id, flowId: proposal.workflow.id, workflowHash: proposal.workflowHash };
      if (!this.#turnedOff(proposal)) return problem(new FoundryError('PROPOSAL_CLOSED', `This proposal is ${proposal.status}`));
    }
    const act = this.ledger.requestActivation({ flowId: proposal.workflow.id, proposalId, workflowHash: proposal.workflowHash, dryRunId: dry.id });
    return { ok: true, status: 'awaiting_human', approvalId: act.id, flowId: proposal.workflow.id, version: proposal.workflow.version, workflowHash: proposal.workflowHash,
      summary: describeWorkflow(proposal.workflow, this.registry), practice: { dryRunId: dry.id, checks: dry.body.checks, dataSource: dry.body.dataSource ?? 'template',
        ...(dry.body.freeform ? { wouldDo: dry.body.wouldDo, wouldDoDigest: dry.body.wouldDoDigest, standIns: dry.body.standIns ?? [] } : {}) } };
  }

  /** A person's decision on turning a version on (called by the dashboard, the CLI, or the MCP elicitation handler only). */
  // principal: who decided, as this computer knows them (the site, the MCP server and the CLI set app.principal from the person's name in
  // Settings, the OS account and the host: "Ravi Patel (ravi@laptop)"); 'local-user' when nothing set it. onDecision (optional) is told
  // of every decision, so a caller can keep it in its own chained log (app/onboarding/decisions.mjs).
  decideActivation(id, approved, { channel, principal = this.principal?.() ?? 'local-user', note = null } = {}) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Approvals come only from a person, not from ${channel}`);
    const act = this.ledger.activation(id), proposal = this.foundry.store.proposal(act.proposalId);
    if (approved && proposal.workflowHash !== act.workflowHash) throw new FoundryError('STALE_APPROVAL', 'The proposal changed after the request was made');
    if (approved && this.ledger.withdrawn(act.proposalId)) throw new FoundryError('DRAFT_REMOVED', 'This draft was removed, so it cannot be turned on');
    // Turning an applied version on again (M7): only while it is still the current version.
    if (approved && proposal.status !== 'proposed' && this.#head(act.flowId)?.hash !== act.workflowHash) throw new FoundryError('STALE_APPROVAL', 'A newer version replaced this one; turn that one on instead');
    const decided = this.ledger.decide(id, approved, { channel, principal, note, expectRev: act.rev });
    // dryRunId (honesty review B1): the practice run this yes rests on, so an evidence file's practice section is tied to a logged line.
    try { this.onDecision?.({ kind: 'turn-on', decision: approved ? 'approved' : 'rejected', channel, principal, flowId: act.flowId, version: proposal.workflow.version, workflowHash: act.workflowHash, approvalId: id, dryRunId: act.dryRunId ?? null, note }); } catch { /* the log is a record, never a gate */ }
    if (!approved) return { ok: true, status: 'rejected', approvalId: id };
    try { if (proposal.status === 'proposed') this.foundry.apply(act.proposalId); }
    catch (error) {
      this.ledger.db.prepare("UPDATE activations SET status='superseded', note=?, rev=rev+1 WHERE id=? AND rev=?").run(`apply failed: ${error.code}`, id, decided.rev);
      return problem(new FoundryError('STALE_APPROVAL', `Approved, but the flow changed meanwhile (${error.code}); nothing was turned on`));
    }
    return { ok: true, status: 'approved', approvalId: id, flowId: act.flowId, workflowHash: act.workflowHash, channel };
  }

  /** The current version of a proposal's automation, approved and then turned off (so it can be asked about again), or null. */
  #turnedOff(proposal) {
    const head = this.#head(proposal.workflow.id);
    if (!head || head.hash !== proposal.workflowHash) return null;
    return this.ledger.forFlow(head.workflow.id).find(a => a.workflowHash === head.hash && a.status === 'approved' && a.turnedOff) ?? null;
  }

  /**
   * A person turns the current version off (UX review M7; SPEC §5 A5 "undo: turn off"). It stops making lists and runs; anything of it
   * still waiting for a yes (a paused run) is cancelled; what it already made (drafts, rows) stays. Only a human channel. Returns
   * { ok, status: 'off', approvalId, cancelled: [runIds] } or a problem (NOT_ON).
   */
  async turnOff({ flowId, channel, principal = this.principal?.() ?? 'local-user', note = null }) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person turns an automation off, not ${channel}`);
    const head = this.#head(flowId);
    if (!head) return problem(new FoundryError('NOT_FOUND', `No automation named ${flowId}`));
    const on = this.ledger.approvedFor(flowId, head.hash);
    if (!on) return problem(new FoundryError('NOT_ON', 'This automation is not on'));
    this.ledger.turnOff(on.id, { channel, principal, note });
    const cancelled = [];
    for (const r of this.foundry.store.runs().filter(x => x.workflowId === flowId && ['awaiting_approval', 'running', 'pending', 'created'].includes(x.status))) {
      try { await this.foundry.cancel(r.id, { actor: 'user', reason: 'turned off by the person', graceMs: 0 }); cancelled.push(r.id); } catch { /* finished meanwhile */ }
    }
    try { this.onDecision?.({ kind: 'turn-off', decision: 'turned off', channel, principal, flowId, version: head.workflow.version, workflowHash: head.hash, approvalId: on.id, cancelledRuns: cancelled, note }); } catch { /* a record, never a gate */ }
    return { ok: true, status: 'off', flowId, approvalId: on.id, version: head.workflow.version, cancelled };
  }

  /** A person removes a draft they will not turn on (M7). Its request, if any, stops waiting. A version that was turned on is not a draft. */
  withdraw({ proposalId, channel, principal = this.principal?.() ?? 'local-user' }) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Only a person removes a draft, not ${channel}`);
    const proposal = this.foundry.store.proposal(proposalId);
    if (proposal.status !== 'proposed') return problem(new FoundryError('PROPOSAL_CLOSED', 'This version was turned on, so it is not a draft; turn it off instead'));
    this.ledger.withdraw(proposalId, { flowId: proposal.workflow.id, channel, principal });
    try { this.onDecision?.({ kind: 'draft-removed', decision: 'removed', channel, principal, flowId: proposal.workflow.id, version: proposal.workflow.version, workflowHash: proposal.workflowHash, proposalId }); } catch { /* a record, never a gate */ }
    return { ok: true, status: 'removed', proposalId, flowId: proposal.workflow.id };
  }

  /** Run the current, approved version. Refuses unapproved or stale versions. */
  async run({ flowId, input }) {
    if (this.practiceOnly()) return problem(new FoundryError('PRACTICE_ONLY', 'Practice-only mode is on for this workspace (or its settings.json could not be read)'));
    const head = this.#head(flowId);
    if (!head) {
      const proposed = this.foundry.store.proposals().some(p => p.workflow.id === flowId && p.status === 'proposed');
      return problem(new FoundryError(proposed ? 'NOT_APPROVED' : 'NOT_FOUND', proposed ? `${flowId} is proposed but not turned on yet` : `No flow named ${flowId}`));
    }
    if (!this.ledger.approvedFor(flowId, head.hash)) {
      if (this.ledger.forFlow(flowId).some(a => a.workflowHash === head.hash && a.status === 'approved' && a.turnedOff)) return problem(new FoundryError('TURNED_OFF', 'This automation is turned off'));
      const older = this.ledger.forFlow(flowId).find(a => a.status === 'approved');
      return problem(new FoundryError(older ? 'STALE_APPROVAL' : 'NOT_APPROVED', older ? 'The approved version is not the current one' : 'This version has not been approved to run'));
    }
    let created;
    try { created = this.foundry.createRun(flowId, input ?? {}); } catch (error) { return problem(error); }
    if (created.workflowHash !== head.hash) { await this.foundry.cancel(created.id, { graceMs: 0 }); return problem(new FoundryError('STALE_APPROVAL', 'The flow changed while starting')); }
    await this.foundry.startRun(created.id).catch(() => {});
    return tracked.afterRun(this, this.status({ runId: created.id }));
  }

  /** Practice-only mode (<workspace>/settings.json mode: 'practice-only', set by the person in the site's Settings): no live run starts. */
  // An organisation's machine policy (app/core/machine-policy.mjs) can force it on for every Foundry folder on this computer.
  practiceOnly() {
    if (machinePolicy().mode === 'practice-only') return true;
    try { return JSON.parse(readFileSync(path.join(this.root, 'settings.json'), 'utf8'))?.mode === 'practice-only'; }
    catch (error) { if (error.code === 'ENOENT') return false; return true; } // an unreadable settings file fails closed
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
    const proposals = this.foundry.store.proposals().filter(p => p.status === 'proposed' && !this.ledger.withdrawn(p.id)).map(p => ({ proposalId: p.id, flowId: p.workflow.id, version: p.workflow.version,
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
        to: a.args?.to ?? a.args?.channel ?? null, subject: a.args?.subject ?? null,
        preview: typeof a.args?.body === 'string' ? a.args.body.slice(0, 600) : typeof a.args?.text === 'string' ? a.args.text.slice(0, 600) : null }));
    });
    return { activations, actions, count: activations.length + actions.length };
  }

  /** A person's decision on one paused action; on yes, the run resumes here. */
  // fromList: { batchId, n, digest } when Foundry applies the person's one yes to an exact list to this paused action (onboarding batch).
  async decideAction(runId, approvalId, approved, { channel, fromList = null } = {}) {
    if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Approvals come only from a person, not from ${channel}`);
    this.foundry.runtime.approve(runId, approvalId, approved, 'user');
    // flowId (honesty review B1): the line names its automation, so an evidence file can show that none of its lines was left out.
    let flowId = null; try { flowId = this.foundry.store.rows.header(runId)?.workflowId ?? null; } catch { flowId = null; }
    try { this.onDecision?.({ kind: fromList ? 'list-item' : 'action', decision: approved ? 'approved' : 'rejected', channel, principal: this.principal?.() ?? 'local-user', runId, flowId, approvalId,
      ...(fromList ? { batchId: fromList.batchId, item: fromList.n, digest: fromList.digest, appliedBy: 'Foundry, from your one approval of the list' } : {}) }); } catch { /* a record, never a gate */ }
    if (approved) await this.foundry.startRun(runId).catch(() => {});
    return tracked.afterRun(this, this.status({ runId }));
  }

  // The condition tracker's surface (./tracker/service-hooks.mjs): what the person asked for, checked on practice data.
  conditions(args) { return tracked.conditions(this, args); }
  checkConditions(args) { return tracked.checkConditions(this, args); }
  proposeConditionEdit(args) { return tracked.proposeConditionEdit(this, args); }
  decideCondition(args) { return tracked.decideCondition(this, args); }
  checkRun(args) { return tracked.checkRun(this, args); }
  /** Was this exact version made through the free-form front door (checked and recorded by #proposeFreeform)? */
  isFreeform(workflowHash) { return this.foundry.store.proposals().some(p => p.workflowHash === workflowHash && !!this.ledger.freeform(p.id)); }
  /** A run's status answer with the live condition check attached when the run has ended (human-tasks.mjs resumes call it too). */
  withConditions(answer) { return tracked.afterRun(this, answer); }
}
