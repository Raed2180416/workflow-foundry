// The spike's MCP server (stdio): seven task-directed tools over FoundryApp (research/surface-20261021/DESIGN.md §3).
//
//   propose_flow  describe what you want -> questions, an honest refusal, or a version-bound proposal with a plain summary and checks
//   explain_flow  steps, checks ("definition of done"), outside actions and limits of a proposal or flow, in plain words
//   dry_run       run the exact proposal on practice data (isolated store, practice outbox) and report checks and would-do actions
//   ask_person_to_turn_on  ASK THE PERSON to turn a version on. The model cannot approve: the decision comes from the client's own
//                 dialog (MCP elicitation, shown to the person) or from the Foundry page / CLI. Marked anthropic/requiresUserInteraction.
//                 (It was called `approve`; a permission prompt for a tool named "approve" right before the real yes read as two yeses,
//                 P1 walkthrough M4.) Declining the dialog is a no and is recorded; closing it decides nothing (M5).
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
//
// What the agent sees of a live run (P4 walkthrough B3): counts and step names, never the recipients or the text of a live list (the
// person reads those in the page). The run date of a card automation is the server's clock, not a date the agent chose (P1 M11).
//
// Since the security review of 2026-10-21:
//   H3  the person decides in Foundry's page unless the dialog is safe to use right now: `dialog` is false by default, and the CLI passes a
//       check (app/onboarding/detect.mjs dialogAllowed) that runs on every ask_person_to_turn_on: a client Foundry knows how to check
//       (Claude Code), no organisation-managed Claude Code, no Elicitation or ElicitationResult hook anywhere Foundry looks, and no launch
//       flag that can carry hooks no file shows. A "no" in the dialog is still recorded; a hook that says no only refuses.
//   M5  every run_flow result goes through strip(), with or without the site: the agent never gets a live action's arguments.
//   L8  the dialog states the practice result and that nothing is sent BEFORE anything built from settings, and each line built from
//       settings is flattened to one line and shortened, so a setting cannot draw a second "Practice run ... passed" line.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { validateData } from '../../src/validate.mjs';
import { errorData } from '../../src/data.mjs';
import { loadLibrary, templateOf, slotsOf } from '../core/library.mjs';
import { cardPromises } from '../onboarding/card-text.mjs';
import { suggest, FORMS } from '../onboarding/suggest.mjs';

const id = { type: 'string', minLength: 1, maxLength: 128 };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const item = { type: 'object', additionalProperties: false, required: ['title', 'status'],
  properties: { title: { type: 'string', minLength: 1, maxLength: 300 }, status: { enum: ['done', 'open', 'blocked'] }, owner: { type: 'string', maxLength: 120 } } };
// The flow input is a JSON object; each flow's own input schema checks it when the run is created. The stub's weekly report takes
// { weekOf, items[] } (items as below); library flows take { now: ISO date-time } and read their data from the workspace sheets.
const flowInput = { type: 'object', description: 'The flow input as a JSON OBJECT (not a string): {now: "2026-10-21T09:00:00Z"} for library flows; {weekOf, items: [{title, status: done|open|blocked}]} for the preview weekly report.',
  properties: { now: { type: 'string', minLength: 10, maxLength: 40 }, weekOf: { type: 'string', minLength: 1, maxLength: 40 }, items: { type: 'array', maxItems: 500, items: item } } };
const DID = { send: w => `drafted “${w.subject}” to ${w.to}`, post: w => `written a post for ${w.to}`, append: w => `added ${w.subject} to the ${w.to} list` };
const kinds = items => { const n = k => items.filter(i => i.action === k).length; return [n('send') ? `${n('send')} e-mail draft(s)` : null, n('post') ? `${n('post')} chat post(s)` : null].filter(Boolean).join(' and ') || `${items.length} item(s)`; };

function say(tool, r) {
  if (r.ok === false) return `${r.problem?.what ?? 'That did not work.'} ${r.problem?.next ?? ''}`.trim();
  switch (tool) {
    case 'propose_flow':
      if (r.status === 'needs_answers') return `${r.notWritten?.length ? 'You filled an address the person never wrote, so it was not used. ' : ''}I need one answer first: ${r.questions.map(q => q.question).join(' ')}`;
      if (r.status === 'unsupported') return `${r.reply} Tell the person what Foundry can make, and if one is close, call propose_flow with that template and settings from their words.`;
      if (r.status === 'no_change' || r.status === 'build_failed') return r.reply;
      return `I drafted “${r.summary.title}” (version ${r.version}). It will: ${r.willDo.join('; ')}. It will not: ${r.willNotDo.join('; ')}. Nothing is running. Next: test it on pretend data (dry_run).`;
    case 'explain_flow': return `“${r.summary.title}” has ${r.summary.steps.length} steps and ${r.summary.checks.length} checks that define done.`;
    case 'dry_run': return r.passed ? `Practice run passed all ${r.checks.length} checks. On pretend data it would have ${r.wouldDo.map(w => (DID[w.action] ?? DID.send)(w)).join('; ') || 'made nothing'}. Nothing real was sent: a real run makes drafts the person sends themselves.`
      : `Practice run did not pass: ${r.headline}`;
    case 'ask_person_to_turn_on': return r.status === 'approved' ? `The person turned on version ${r.version ?? ''} (${r.workflowHash?.slice(0, 8)}). Before each run makes anything, they see the full list and approve it once.`
      : r.status === 'rejected' ? `The person said no${r.channel === 'mcp-elicitation' ? ' in the dialog' : ''}. Nothing was turned on.`
      : r.status === 'not_decided' ? 'The person closed the dialog without deciding. Nothing was turned on; ask again when they are ready.'
      : `Waiting for the person to decide. ${r.how}`;
    case 'list_templates': return `${r.templates.length} automation cards. Pick the one that does the main thing the person asked for, fill its settings only from their words, and call propose_flow with template and settings. If none fits, say so.`;
    case 'run_flow': if (r.batchId) return `The person is checking the exact list of what this run would make (${r.made}) as of ${r.asOf?.slice(0, 10)}, in ${r.where}. Nothing is made until they approve it there. When they have, tell them the drafts are on the Drafts page and that they send them themselves.`;
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

// dialog: may the client's own dialog decide? false (the default: the person decides in the page), true (a caller that vouches for the
// client, tests), or a function ({ server }) => { ok } asked on every ask_person_to_turn_on (the CLI: app/onboarding/detect.mjs).
// A line for the dialog from text Foundry did not write itself (settings, titles): one line, no control characters, at most 160 characters.
const oneLine = (text, max = 160) => { const t = String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
// The cards in one sentence, for an honest "cannot build that" (P1 walkthrough M10: the stub's refusal named one old card).
function cardsReply(request) {
  const titles = FORMS.order.map(id => FORMS.templates[id]?.card).filter(Boolean);
  const s = typeof request === 'string' ? suggest(request) : { candidates: [] };
  const close = s.candidates[0] ? ` The closest by keywords is "${s.candidates[0].title}" (template ${s.candidates[0].id}).` : '';
  return { reply: `Foundry can't make that yet. It can make ${titles.length} kinds of automation today: ${titles.join('; ')}.${close} Nothing was created.`,
    cards: FORMS.order.map(id => ({ id, title: FORMS.templates[id]?.card })) };
}

export function toolDefinitions(app, { dashboardUrl = () => null, batches = null, dialog = false, openCommand = 'node app/cli.mjs open' } = {}) {
  const where = () => dashboardUrl() ? `The person decides in ${dashboardUrl()}; you cannot decide for them.`
    : `Ask the person to run ${openCommand} in their own terminal and decide in the page it opens. You cannot decide for them.`;
  async function approve({ proposalId }, context) {
    const request = app.requestApproval({ proposalId });
    if (!request.ok || request.status === 'approved') return request;
    const server = context?.server, caps = server?.getClientCapabilities?.()?.elicitation;
    const formDialog = !!caps && (!!caps.form || Object.keys(caps).length === 0);
    // Asked again on every call (H3): a hook can be added in the middle of a session.
    let useDialog = false;
    if (formDialog) { try { useDialog = typeof dialog === 'function' ? (await dialog({ server }))?.ok === true : dialog === true; } catch { useDialog = false; } }
    if (useDialog) {
      // The client shows this dialog to the PERSON (MCP elicitation, form mode). The model sees only the outcome. Short and in plain
      // words: the test result and that turning it on sends nothing, then what it will do; a check without a plain sentence is left out
      // (P1 M6). Lines built from settings come last, one line each (L8).
      const s = request.summary, proposal = app.foundry.store.proposal(proposalId), t = templateOf(proposal.workflow);
      const will = (t ? cardPromises(t, slotsOf(proposal.workflow)).willDo : s.steps.map(x => x.text)).slice(0, 12).map(w => oneLine(w));
      const passed = (request.practice?.checks ?? []).filter(c => c.passed === true).length, total = (request.practice?.checks ?? []).length;
      let result;
      try {
        result = await server.elicitInput({ message: `Turn on “${oneLine(t ? FORMS.templates[t.id]?.card ?? s.title : s.title, 80)}”, version ${request.version}?\n\n` +
          `Practice run on pretend data: passed ${passed} of ${total} checks. Turning it on makes and sends nothing.\n\nEach time you run it, it will:\n- ${will.join('\n- ')}`,
          requestedSchema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', title: 'Your decision', enum: ['approve', 'reject'] }, note: { type: 'string', title: 'Note (optional)', maxLength: 500 } } } });
      } catch { result = null; }
      if (result?.action === 'accept' && ['approve', 'reject'].includes(result.content?.decision)) {
        const decided = app.decideActivation(request.approvalId, result.content.decision === 'approve', { channel: 'mcp-elicitation', note: result.content.note ?? null });
        return decided.ok === false ? decided : { ...decided, workflowHash: request.workflowHash, version: request.version };
      }
      // "Decline" in the dialog is a no, recorded as one; closing it (cancel) decides nothing. Neither opens the browser (P1 M5).
      if (result?.action === 'decline') return { ...app.decideActivation(request.approvalId, false, { channel: 'mcp-elicitation', note: 'declined in the coding agent\'s dialog' }), channel: 'mcp-elicitation' };
      if (result?.action === 'cancel') return { ok: true, status: 'not_decided', approvalId: request.approvalId };
    }
    return { ...request, how: where() };
  }
  // With batches (the site), a run of a card automation starts with the exact list the person approves in their browser.
  async function runFlow(a) { return strip(await runFlowInner(a)); }
  async function runFlowInner(a) {
    if (!batches) return app.run(a);
    let head = null; try { head = app.foundry.store.workflow(a.flowId); } catch { head = null; }
    if (!head || !templateOf(head.workflow) || !app.ledger.approvedFor(a.flowId, head.hash) || app.practiceOnly()) return app.run(a);
    let b;
    // The run is as of today (the server's clock): the agent's date would decide who gets which reminder (P1 M11).
    try { b = await batches.preview(a.flowId); }
    catch (error) {
      if (error.code === 'SHEET_NOT_FOUND') return { ok: true, status: 'needs_data', needsData: error.sheets ?? [], flowId: a.flowId, where: dashboardUrl(`/go-live/${a.flowId}`) ?? 'the Foundry page (run "node app/cli.mjs site")' };
      throw error;
    }
    if (!b.ok) return { ok: false, problem: { what: `A test of this version on the person's own list did not pass: ${b.headline}`, next: 'Nothing was made. Look at the run in Foundry, or change a setting.', code: 'BATCH_TEST_FAILED' }, checks: b.checks };
    if (!b.items.length) return app.run({ flowId: a.flowId, input: b.input });
    const agentDate = typeof a.input?.now === 'string' ? a.input.now.slice(0, 10) : null;
    return { ok: true, status: 'awaiting_human', batchId: b.batchId, count: b.items.length, made: kinds(b.items), flowId: a.flowId, asOf: b.input.now,
      ...(agentDate && agentDate !== b.input.now.slice(0, 10) ? { dateNote: `Foundry used today's date (${b.input.now.slice(0, 10)}), not ${agentDate}.` } : {}),
      expiresAt: b.expiresAt, where: dashboardUrl('/waiting') ?? `the Foundry page (the person runs ${openCommand})` };
  }
  // A live run's pending sends carry real recipients and text: the agent gets the step names only (P4 walkthrough B3).
  const strip = r => r && Array.isArray(r.pendingApprovals) ? { ...r, pendingApprovals: r.pendingApprovals.map(({ args, ...rest }) => rest) } : r;
  async function propose(a) {
    const r = await app.propose({ ...a, ...(a.template ? { origin: 'agent' } : {}) });
    return r.status === 'unsupported' && !a.template ? { ...r, ...cardsReply(a.request) } : r;
  }
  const defs = [
    ['propose_flow', 'Turn a plain-language request into a proposed automation, or questions, or an honest "cannot build that". Nothing runs. Pass the person\'s exact words in request; pass answers to earlier questions in answers, keyed by question id. To change an existing flow, pass flowId. Best: call list_templates first and pass template (a card id) and settings (filled only from the person\'s words).',
      object({ request: { type: 'string', minLength: 1, maxLength: 30000 }, answers: { type: 'object', additionalProperties: { type: 'string', maxLength: 2000 } }, flowId: id,
        template: { type: 'string', minLength: 1, maxLength: 64 }, settings: settingsSchema }, ['request']),
      propose, false],
    ['explain_flow', 'Explain a proposal or flow in plain words: its steps, the checks that define done, the outside actions it can take and its limits.', object({ proposalId: id, flowId: id }), a => app.explain(a), true],
    ['dry_run', 'Try the exact proposed version on practice data, with outside actions replaced by a practice stand-in. Reports which checks passed and what it would have done. Required before approval.',
      object({ proposalId: id, practiceInput: flowInput }, ['proposalId']), a => app.dryRun({ proposalId: a.proposalId, input: a.practiceInput }), false],
    ['ask_person_to_turn_on', 'Ask the PERSON to turn on a proposed version after a passing practice run. You cannot turn it on: the person decides in a dialog or in the Foundry page. Returns approved, rejected, not_decided (they closed the dialog), or awaiting_human with where they decide.',
      object({ proposalId: id }, ['proposalId']), approve, false],
    ['run_flow', 'Run the current, person-approved version of a flow with an input OBJECT. Unapproved or changed versions are refused. Outside actions (sending) pause until the person approves them; for an automation made from a card, the person first sees the exact list of what the run would make and approves that list.',
      object({ flowId: id, input: flowInput }, ['flowId', 'input']), runFlow, false],
    ['flow_status', 'Status of one run in plain words: what happened, which step failed and what to do, checks, the steps waiting for the person, cost.', object({ runId: id }, ['runId']), a => strip(app.status(a)), true],
    ['list_flows', 'List flows, drafts awaiting practice or approval, and how many things are waiting for the person.', object({}), () => app.list(), true],
    ['list_templates', 'List the automation cards Foundry can build today: what each does and never does, its settings and defaults, which settings must come from the person (with why), and the data it reads. Read-only.',
      object({}), () => ({ ok: true, templates: templateCatalog() }), true]
  ];
  return defs.map(([name, description, inputSchema, execute, readOnly]) => ({
    name, description, inputSchema, execute,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: name === 'run_flow' },
    // Claude Code shows a permission prompt for this tool on every call and never auto-approves it (code.claude.com/docs/en/mcp,
    // "Require approval for a specific tool"); other clients ignore the key.
    ...(name === 'ask_person_to_turn_on' ? { _meta: { 'anthropic/requiresUserInteraction': true } } : {})
  }));
}

export async function serveAppMcp(app, { transport = new StdioServerTransport(), dashboardUrl, batches = null, dialog = false, openCommand } = {}) {
  const server = new Server({ name: 'workflow-foundry-surface', version: '0.0.1' }, { capabilities: { tools: {} },
    instructions: 'Workflow Foundry builds small automations that are checked before they run. Call list_templates first, then propose_flow with a template and settings from the person\'s words, dry_run before ask_person_to_turn_on, and relay `say` to the person. Only the person can turn things on or approve what a run makes.' });
  const defs = toolDefinitions(app, { dashboardUrl, batches, dialog, ...(openCommand ? { openCommand } : {}) });
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
