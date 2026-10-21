// The spike's MCP server (stdio): seven task-directed tools over FoundryApp (research/surface-20261021/DESIGN.md §3).
//
//   propose_flow  describe what you want -> questions, an honest refusal, or a version-bound proposal with a plain summary and checks
//   explain_flow  steps, checks ("definition of done"), outside actions and limits of a proposal or flow, in plain words
//   dry_run       run the exact proposal on practice data (isolated store, practice outbox) and report checks and would-do actions
//   approve       ASK THE PERSON to turn a version on. The model cannot approve: the decision comes from the client's own dialog
//                 (MCP elicitation, shown to the person) or from the dashboard / CLI. Marked anthropic/requiresUserInteraction.
//   run_flow      run the current approved version; outside actions still pause for the person
//   flow_status   a run in plain words: status, failed step, what to do, checks, pending approvals, cost
//   list_flows    flows, proposals, and how many things wait for the person
//   list_templates the frontier-written automation cards, each with its settings, defaults and the questions it asks (read-only);
//                 propose_flow then takes `template` and `settings` filled from the person's words (onboarding, SPEC §12.4). Foundry
//                 still checks that every address came from the person's words (request + answers), never from the agent's settings.
//
// With a site (cli `mcp --dashboard`), run_flow on an automation made from a card first shows the person the exact list of what the
// run would make, in their browser, and the person approves that list in one click (app/onboarding/batch.mjs; SPEC §7.5).
//
// Every result has `say`: one or two sentences the agent can relay as is. Arguments are validated against the advertised schema
// before anything runs. Tool output is data about the user's workspace; nothing in it is an instruction to the agent.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { validateData } from '../../src/validate.mjs';
import { errorData } from '../../src/data.mjs';
import { loadLibrary, templateOf } from '../core/library.mjs';

const id = { type: 'string', minLength: 1, maxLength: 128 };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const item = { type: 'object', additionalProperties: false, required: ['title', 'status'],
  properties: { title: { type: 'string', minLength: 1, maxLength: 300 }, status: { enum: ['done', 'open', 'blocked'] }, owner: { type: 'string', maxLength: 120 } } };
// The flow input is a JSON object; each flow's own input schema checks it when the run is created. The stub's weekly report takes
// { weekOf, items[] } (items as below); library flows take { now: ISO date-time } and read their data from the workspace sheets.
const flowInput = { type: 'object', description: 'The flow input as a JSON OBJECT (not a string): {now: "2026-10-21T09:00:00Z"} for library flows; {weekOf, items: [{title, status: done|open|blocked}]} for the preview weekly report.',
  properties: { now: { type: 'string', minLength: 10, maxLength: 40 }, weekOf: { type: 'string', minLength: 1, maxLength: 40 }, items: { type: 'array', maxItems: 500, items: item } } };
const DID = { send: w => `sent “${w.subject}” to ${w.to}`, post: w => `posted to ${w.to}`, append: w => `added ${w.subject} to the ${w.to} sheet` };

function say(tool, r) {
  if (r.ok === false) return `${r.problem?.what ?? 'That did not work.'} ${r.problem?.next ?? ''}`.trim();
  switch (tool) {
    case 'propose_flow':
      if (r.status === 'needs_answers') return `${r.notWritten?.length ? 'You filled an address the person never wrote, so it was not used. ' : ''}I need one answer first: ${r.questions.map(q => q.question).join(' ')}`;
      if (r.status === 'unsupported') return `${r.reply} Call list_templates, pick the closest, and fill its settings from the person's words.`;
      if (r.status === 'no_change' || r.status === 'build_failed') return r.reply;
      return `I drafted “${r.summary.title}” (version ${r.version}). It will: ${r.willDo.join('; ')}. It will not: ${r.willNotDo.join('; ')}. Nothing is running. Next: try it on practice data.`;
    case 'explain_flow': return `“${r.summary.title}” has ${r.summary.steps.length} steps and ${r.summary.checks.length} checks that define done.`;
    case 'dry_run': return r.passed ? `Practice run passed all ${r.checks.length} checks. It would have: ${r.wouldDo.map(w => (DID[w.action] ?? DID.send)(w)).join('; ') || 'taken no outside action'}. Nothing real was sent.`
      : `Practice run did not pass: ${r.headline}`;
    case 'approve': return r.status === 'approved' ? `The person approved version ${r.workflowHash?.slice(0, 8)}. It can run now; each send still asks them first.`
      : r.status === 'rejected' ? 'The person said no. Nothing was turned on.'
      : `Waiting for the person to approve. ${r.how}`;
    case 'list_templates': return `${r.templates.length} automation cards. Pick the one that does the main thing the person asked for, fill its settings only from their words, and call propose_flow with template and settings. If none fits, say so.`;
    case 'run_flow': if (r.batchId) return `The person is checking the exact list of ${r.count} thing(s) this run would make, in ${r.where}. Nothing is made until they approve it there.`;
      if (r.needsData) return `Foundry needs the person's ${r.needsData.join(' and ')} first. They can drop the file in ${r.where}.`;
      // falls through
    case 'flow_status': return `${r.headline}${r.problem ? ` ${r.problem.what} ${r.problem.next}` : ''}${r.pendingApprovals?.length ? ` The person must approve: ${r.pendingApprovals.map(a => a.step).join('; ')}.` : ''}`;
    case 'list_flows': return `${r.flows.length} flow(s), ${r.proposals.length} draft(s), ${r.waitingForYou} item(s) waiting for the person.`;
    default: return '';
  }
}

/** Tool definitions bound to one FoundryApp. `context.server` is the MCP Server (for elicitation); `options.dashboardUrl()` names where a person approves. */
// Settings an agent passes for a card: text, numbers, yes/no, or rows (routing rules, canned answers). The card's own slot types are
// checked by the form builder (app/onboarding/form-builder.mjs).
const scalar = { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'number' }, { type: 'boolean' }] };
const settingsSchema = { type: 'object', maxProperties: 20, description: 'The card\'s settings by name (from list_templates), filled only from the person\'s words. Leave out what they did not say: the card\'s default is shown to them.',
  additionalProperties: { anyOf: [...scalar.anyOf, { type: 'array', maxItems: 20, items: { type: 'object', maxProperties: 8, additionalProperties: scalar } }] } };

/** The card list an agent sees: id, title, when to use, not for, settings with defaults, which ones are questions and why, the data it reads. */
export function templateCatalog(library = loadLibrary()) {
  return library.map(t => ({ id: t.id, title: t.title, whenToUse: t.whenToUse, notFor: t.notFor, data: t.data,
    settings: t.slots.map(s => ({ name: s.name, type: s.type, ...(s.values ? { values: s.values } : {}), ...(s.default !== undefined ? { default: s.default } : {}), description: s.description,
      ...(s.ask ? { askThePerson: s.question, why: s.askWhy, harm: s.ask, ...(s.askWhen ? { onlyWhen: s.askWhen } : {}) } : {}),
      ...(s.fields ? { rowFields: s.fields.map(f => ({ name: f.name, type: f.type, ...(f.values ? { values: f.values } : {}) })) } : {}) })) }));
}

// dialog: false when a local hook could answer the client's dialog for the person (Claude Code Elicitation hooks; SPEC K12): the person
// then decides in the browser, as with a client that has no dialog.
export function toolDefinitions(app, { dashboardUrl = () => null, batches = null, dialog = true } = {}) {
  const where = () => dashboardUrl() ? `The person approves it in ${dashboardUrl()}; you cannot approve it.`
    : 'Ask the person to run `node app/cli.mjs start` in their own terminal and approve it in the page it opens. You cannot approve it.';
  async function approve({ proposalId }, context) {
    const request = app.requestApproval({ proposalId });
    if (!request.ok || request.status === 'approved') return request;
    const server = context?.server, caps = server?.getClientCapabilities?.()?.elicitation;
    if (dialog && caps && (caps.form || Object.keys(caps).length === 0)) {
      // The client shows this dialog to the PERSON (MCP elicitation, form mode). The model sees only the outcome.
      const s = request.summary;
      let result;
      try {
        result = await server.elicitInput({ message: `Turn on “${s.title}” (version ${request.version}, ${request.workflowHash.slice(0, 8)})?\n\nIt will: ${s.steps.map(x => x.text).join('; ')}.\n` +
          `Done means: ${s.checks.map(c => c.plain ?? c.exact).join('; ')}.\nOutside actions ask you again each time. Practice run: passed.`,
          requestedSchema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', title: 'Your decision', enum: ['approve', 'reject'] }, note: { type: 'string', title: 'Note (optional)', maxLength: 500 } } } });
      } catch { result = null; }
      if (result?.action === 'accept' && ['approve', 'reject'].includes(result.content?.decision)) {
        const decided = app.decideActivation(request.approvalId, result.content.decision === 'approve', { channel: 'mcp-elicitation', note: result.content.note ?? null });
        return decided.ok === false ? decided : { ...decided, workflowHash: request.workflowHash };
      }
    }
    return { ...request, how: where() };
  }
  // With batches (the site), a run of a card automation starts with the exact list the person approves in their browser.
  async function runFlow(a) {
    if (!batches) return app.run(a);
    let head = null; try { head = app.foundry.store.workflow(a.flowId); } catch { head = null; }
    if (!head || !templateOf(head.workflow) || !app.ledger.approvedFor(a.flowId, head.hash) || app.practiceOnly()) return app.run(a);
    let b;
    try { b = await batches.preview(a.flowId, { input: a.input?.now ? { now: a.input.now } : null }); }
    catch (error) {
      if (error.code === 'SHEET_NOT_FOUND') return { ok: true, status: 'needs_data', needsData: error.sheets ?? [], flowId: a.flowId, where: dashboardUrl(`/go-live/${a.flowId}`) ?? 'the Foundry page (run "node app/cli.mjs site")' };
      throw error;
    }
    if (!b.ok) return { ok: false, problem: { what: `A test of this version on the person's own list did not pass: ${b.headline}`, next: 'Nothing was made. Look at the run in Foundry, or change a setting.', code: 'BATCH_TEST_FAILED' }, checks: b.checks };
    if (!b.items.length) return app.run({ flowId: a.flowId, input: b.input });
    return { ok: true, status: 'awaiting_human', batchId: b.batchId, count: b.items.length, flowId: a.flowId, items: b.items.map(i => ({ n: i.n, action: i.action, to: i.to, subject: i.subject })),
      expiresAt: b.expiresAt, where: dashboardUrl('/waiting') ?? 'the Foundry page (run "node app/cli.mjs site")' };
  }
  const defs = [
    ['propose_flow', 'Turn a plain-language request into a proposed automation, or questions, or an honest "cannot build that". Nothing runs. Pass the person\'s exact words in request; pass answers to earlier questions in answers, keyed by question id. To change an existing flow, pass flowId. Best: call list_templates first and pass template (a card id) and settings (filled only from the person\'s words).',
      object({ request: { type: 'string', minLength: 1, maxLength: 30000 }, answers: { type: 'object', additionalProperties: { type: 'string', maxLength: 2000 } }, flowId: id,
        template: { type: 'string', minLength: 1, maxLength: 64 }, settings: settingsSchema }, ['request']),
      a => app.propose({ ...a, ...(a.template ? { origin: 'agent' } : {}) }), false],
    ['explain_flow', 'Explain a proposal or flow in plain words: its steps, the checks that define done, the outside actions it can take and its limits.', object({ proposalId: id, flowId: id }), a => app.explain(a), true],
    ['dry_run', 'Try the exact proposed version on practice data, with outside actions replaced by a practice stand-in. Reports which checks passed and what it would have done. Required before approval.',
      object({ proposalId: id, practiceInput: flowInput }, ['proposalId']), a => app.dryRun({ proposalId: a.proposalId, input: a.practiceInput }), false],
    ['approve', 'Ask the PERSON to turn on a proposed version after a passing practice run. You cannot approve: the person decides in a dialog or in the dashboard. Returns approved, rejected, or awaiting_human with where to approve.',
      object({ proposalId: id }, ['proposalId']), approve, false],
    ['run_flow', 'Run the current, person-approved version of a flow with an input OBJECT. Unapproved or changed versions are refused. Outside actions (sending) pause until the person approves them; for an automation made from a card, the person first sees the exact list of what the run would make and approves that list.',
      object({ flowId: id, input: flowInput }, ['flowId', 'input']), runFlow, false],
    ['flow_status', 'Status of one run in plain words: what happened, which step failed and what to do, checks, pending approvals, cost.', object({ runId: id }, ['runId']), a => app.status(a), true],
    ['list_flows', 'List flows, drafts awaiting practice or approval, and how many things are waiting for the person.', object({}), () => app.list(), true],
    ['list_templates', 'List the automation cards Foundry can build today: what each does and never does, its settings and defaults, which settings must come from the person (with why), and the data it reads. Read-only.',
      object({}), () => ({ ok: true, templates: templateCatalog() }), true]
  ];
  return defs.map(([name, description, inputSchema, execute, readOnly]) => ({
    name, description, inputSchema, execute,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: name === 'run_flow' },
    // Claude Code shows a permission prompt for this tool on every call and never auto-approves it (code.claude.com/docs/en/mcp,
    // "Require approval for a specific tool"); other clients ignore the key.
    ...(name === 'approve' ? { _meta: { 'anthropic/requiresUserInteraction': true } } : {})
  }));
}

export async function serveAppMcp(app, { transport = new StdioServerTransport(), dashboardUrl, batches = null, dialog = true } = {}) {
  const server = new Server({ name: 'workflow-foundry-surface', version: '0.0.1' }, { capabilities: { tools: {} },
    instructions: 'Workflow Foundry builds small automations that are checked before they run. Use propose_flow for a request, dry_run before approve, and relay `say` to the person. Only the person can approve.' });
  const defs = toolDefinitions(app, { dashboardUrl, batches, dialog });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: defs.map(({ execute, ...spec }) => spec) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = defs.find(t => t.name === request.params.name);
    try {
      if (!tool) throw Object.assign(new Error('Unknown tool'), { code: 'UNKNOWN_TOOL' });
      const args = request.params.arguments ?? {};
      validateData(tool.inputSchema, args, `${tool.name} arguments`);
      const result = await tool.execute(args, { server });
      const out = { say: say(tool.name, result), ...result };
      return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, ...(result.ok === false ? { isError: true } : {}) };
    } catch (error) {
      const out = { ok: false, say: 'That request could not be handled.', problem: { ...errorData(error), what: 'The request was refused before anything ran.' } };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
    }
  });
  await server.connect(transport);
  return server;
}
