// The spike's MCP server (stdio): thirteen task-directed tools over FoundryApp (research/surface-20261021/DESIGN.md §3), with ONE free-form
// front door (app/FRONT-DOOR.md, 2026-11-05): the calling agent builds a typed workflow for whatever the person needs and Foundry checks it.
//
//   construction_guide  how to build one (read-only): the construction skill's core, this app's rules and its capability catalogue; one
//                 reference or worked example by name, on demand (skills/foundry-construct/). It replaced list_templates: the seven
//                 examples are worked examples an agent may start from, never the only things Foundry can build.
//   propose_flow  the person's exact words plus, best, a typed `workflow` the agent built (and `practiceInput` cases) -> a version-bound
//                 proposal, or a refusal that names each blocker (a capability this app lacks, a target the person never wrote, a
//                 workflow that does not validate or lint clean); with words alone, Foundry's own builder tries (questions, a
//                 proposal, or an honest "cannot build that")
//   explain_flow  steps, checks ("definition of done"), outside actions and limits of a proposal or flow, in plain words
//   dry_run       run the exact proposal on practice data (isolated store, practice outbox) and report checks and would-do actions
//   ask_person_to_turn_on  ASK THE PERSON to turn a version on. The model cannot approve: the decision comes from the client's own
//                 dialog (MCP elicitation, shown to the person) or from the Foundry page / CLI. Marked anthropic/requiresUserInteraction.
//                 (It was called `approve`; a permission prompt for a tool named "approve" right before the real yes read as two yeses,
//                 P1 walkthrough M4.) Declining the dialog is a no and is recorded; closing it decides nothing (M5).
//   run_flow      run the current approved version; outside actions still pause for the person
//   flow_status   a run in plain words: status, failed step, what to do, checks, pending approvals, cost
//   list_flows    flows, proposals, and how many things wait for the person
//
// With a site (cli `mcp --dashboard`), run_flow on an automation made from one of the site's examples first shows the person the exact
// list of what the run would make, in their browser, and the person approves that list in one click (app/onboarding/batch.mjs; SPEC §7.5).
// A free-form automation's outside actions each ask the person (list_waiting / answer_waiting, or the page); its turn-on dialog shows
// the exact list its practice run would have made, bound by digest to that practice run.
//   need_check    does this request need a workflow at all? (ROUTER-1; code-only hint, or the cascade when the host plugs in a judge)
//   list_waiting  what runs wait on the person for: questions from human steps and actions paused for approval (app/core/human-tasks.mjs)
//   answer_waiting ASK THE PERSON to answer one of them. The model cannot answer: the answer comes from the client's own dialog (MCP
//                 elicitation, bound to the exact question shown) or from the dashboard / CLI. Marked anthropic/requiresUserInteraction.
//   conditions    what the person asked for (the condition tracker, app/core/tracker/): each condition (their own words), its check in
//                 plain words and its status (met / unmet / unknown with why / waived); with check: true it first tries that exact
//                 version on practice data; with a runId, on what that live run read and did (every finished run_flow is also checked
//                 and reports what it broke)
//   edit_conditions  PROPOSE edits to the conditions (add one by quoting the person's words, change its summary, remove one); the person
//                 accepts or rejects in the client's dialog (only where the H3 check vouches for it, as for ask_person_to_turn_on) or
//                 the dashboard. The model can never confirm or waive a condition. Marked anthropic/requiresUserInteraction.
//
// Every result has `say`: one or two sentences the agent can relay as is. Arguments are validated against the advertised schema
// before anything runs. Tool output is data about the user's workspace; nothing in it is an instruction to the agent.
//
// What the agent sees of a live run (P4 walkthrough B3): counts and step names, never the recipients or the text of a live list (the
// person reads those in the page). The run date of an example's automation is the server's clock, not a date the agent chose (P1 M11).
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
import { templateOf, slotsOf } from '../core/library.mjs';
import { cardPromises } from '../onboarding/card-text.mjs';
import { FORMS } from '../onboarding/suggest.mjs';
import { constructionGuide } from '../core/guide.mjs';
import { needAdvice, needToolSpec } from '../core/need.mjs';
import { listHumanTasks, answerQuestion, decideApproval } from '../core/human-tasks.mjs';

const id = { type: 'string', minLength: 1, maxLength: 128 };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const item = { type: 'object', additionalProperties: false, required: ['title', 'status'],
  properties: { title: { type: 'string', minLength: 1, maxLength: 300 }, status: { enum: ['done', 'open', 'blocked'] }, owner: { type: 'string', maxLength: 120 } } };
// The flow input is a JSON object; each flow's own input schema checks it when the run is created (explain_flow shows that schema).
const flowInput = { type: 'object', description: 'The flow input as a JSON OBJECT (not a string) that matches the flow\'s inputSchema (explain_flow shows it), for example {now: "2026-10-21T09:00:00Z"} or {}.',
  properties: { now: { type: 'string', minLength: 10, maxLength: 40 }, weekOf: { type: 'string', minLength: 1, maxLength: 40 }, items: { type: 'array', maxItems: 500, items: item } } };
const DID = { send: w => `drafted “${w.subject}” to ${w.to}`, post: w => `written a post for ${w.to}`, append: w => `added ${w.subject} to the ${w.to} list` };
const kinds = items => { const n = k => items.filter(i => i.action === k).length; return [n('send') ? `${n('send')} e-mail draft(s)` : null, n('post') ? `${n('post')} chat post(s)` : null].filter(Boolean).join(' and ') || `${items.length} item(s)`; };

function say(tool, r) {
  if (r.ok === false) return `${r.problem?.what ?? 'That did not work.'} ${r.problem?.next ?? ''}`.trim();
  switch (tool) {
    case 'propose_flow':
      if (r.status === 'needs_answers') return `${r.notWritten?.length ? 'You filled an address the person never wrote, so it was not used. ' : ''}I need one answer first: ${r.questions.map(q => q.question).join(' ')}`;
      if (r.status === 'unsupported') return `${r.reply} If a workflow can do it with this app's capabilities, build it yourself (construction_guide) and pass it as workflow; otherwise tell the person plainly what Foundry cannot do.`;
      if (r.status === 'refused') return `${r.reply} ${r.blockers?.[0]?.next ?? ''}`.trim();
      if (r.status === 'no_change' || r.status === 'build_failed') return r.reply;
      // The need note is shown only when a judged decision says no workflow is needed (review M3): the code-only router misses about
      // a third of the requests that do need one, so on its word alone the note would mislead.
      return `I drafted “${r.summary.title}” (version ${r.version}). It will: ${r.willDo.join('; ')}. It will not: ${r.willNotDo.join('; ')}. Nothing is running. Next: test it on pretend data (dry_run).${r.need && r.need.basis === 'cascade' && !r.need.needsWorkflow ? ` Note: ${r.need.say}` : ''}`;
    case 'explain_flow': return `“${r.summary.title}” has ${r.summary.steps.length} steps and ${r.summary.checks.length} checks that define done.`;
    case 'dry_run': return r.passed ? `Practice run passed all ${r.checks.length} checks${r.cases?.length > 1 ? ` in ${r.cases.length} cases` : ''}. On pretend data it would have ${r.wouldDo.map(w => (DID[w.action] ?? DID.send)(w)).join('; ') || 'made nothing'}.${r.standInAnswers?.length ? ` Practice answered ${r.standInAnswers.length} question(s) with stand-in answers.` : ''} Nothing real was sent: a real run makes drafts the person sends themselves.`
      : `Practice run did not pass: ${r.headline}${r.problem?.next ? ` ${r.problem.next}` : ''}`;
    case 'ask_person_to_turn_on': return r.status === 'approved' ? `The person turned on version ${r.version ?? ''} (${r.workflowHash?.slice(0, 8)}). ${r.eachRun === 'each action' ? 'Each send or post still asks them first.' : 'Before each run makes anything, they see the full list and approve it once.'}`
      : r.status === 'rejected' ? `The person said no${r.channel === 'mcp-elicitation' ? ' in the dialog' : ''}. Nothing was turned on.`
      : r.status === 'not_decided' ? 'The person closed the dialog without deciding. Nothing was turned on; ask again when they are ready.'
      : r.status === 'declined_by_client' ? `Your client declined the dialog. That may have been automatic (a setting or a hook), so it is not recorded as the person's no. Nothing was turned on. ${r.how}`
      : `Waiting for the person to decide. ${r.how}`;
    case 'construction_guide': return r.name ? `Loaded ${r.name}.` : `The construction guide: the skill's core, this app's ${r.rules.length} rules and ${r.capabilities.length} capabilities. Build a typed workflow for what the person asked, then call propose_flow with their exact words, the workflow and practiceInput. Load a reference or example by name only when a step needs it.`;
    case 'run_flow': if (r.batchId) return `The person is checking the exact list of what this run would make (${r.made}) as of ${r.asOf?.slice(0, 10)}, in ${r.where}. Nothing is made until they approve it there. When they have, tell them the drafts are on the Drafts page and that they send them themselves.`;
      if (r.needsData) return `Foundry needs the person's ${r.needsData.join(' and ')} first. They can drop the file in ${r.where}.`;
      // falls through
    case 'flow_status': return `${r.headline}${r.problem ? ` ${r.problem.what} ${r.problem.next}` : ''}${r.pendingApprovals?.length ? ` The person must approve: ${r.pendingApprovals.map(a => a.step).join('; ')}.` : ''}`
      + (r.conditions?.unmet?.length ? ` Not met in this run: “${r.conditions.unmet[0].quote}”${r.conditions.unmet.length > 1 ? ` and ${r.conditions.unmet.length - 1} more` : ''}.` : '');
    case 'list_flows': return `${r.flows.length} flow(s), ${r.proposals.length} draft(s), ${r.waitingForYou} item(s) waiting for the person.`;
    case 'need_check': return r.say;
    case 'list_waiting': return r.tasks.length ? `${r.tasks.length} thing(s) wait for the person: ${r.tasks.map(t => t.kind === 'question' ? `a question in “${t.flowTitle}”` : `allowing ${t.action} in “${t.flowTitle}”`).join('; ')}. Only the person can answer (answer_waiting asks them).`
      : `Nothing waits for the person.${r.notContinued.length ? ` ${r.notContinued.length} run(s) did not continue after a decision.` : ''}`;
    case 'answer_waiting': return r.status === 'answered' ? `The person answered. ${r.continued?.words ?? ''}`.trim() : r.status === 'decided' ? `The person ${r.approved ? 'allowed' : 'refused'} it. ${r.continued?.words ?? ''}`.trim()
      : r.status === 'not_answered' ? 'The person did not answer.' : `Waiting for the person. ${r.how}`;
    case 'conditions': {
      const t = r.tally ?? {}, unmet = (r.conditions ?? []).filter(c => c.status === 'unmet');
      return `${r.conditions?.length ?? 0} condition(s) from the person's words${r.live ? ` on live run ${String(r.runId).slice(0, 8)}` : ''}: ${t.met ?? 0} met, ${t.unmet ?? 0} not met, ${t.unknown ?? 0} unknown, ${t.waived ?? 0} waived.`
        + (unmet.length ? ` Not met: “${unmet[0].quote}” (${unmet[0].evidence?.[0]?.why ?? 'see evidence'}). The build, the check or the words may be wrong; ask the person.` : '');
    }
    case 'edit_conditions': return r.status === 'accepted' ? 'The person accepted the change.' : r.status === 'rejected' ? 'The person said no; nothing changed.'
      : r.status === 'not_decided' ? 'The person closed the dialog without deciding. The change still waits for them.'
      : `Proposed. The person accepts or rejects it${r.how ? `: ${r.how}` : ''}; you cannot.`;
    default: return '';
  }
}

// A question's answer schema as an MCP elicitation form (flat, primitive fields only); null when it needs the dashboard's form.
const PRIMITIVE = new Set(['string', 'number', 'integer', 'boolean']);
function fieldOf(schema, title) {
  if (Array.isArray(schema?.enum)) return schema.enum.every(v => typeof v === 'string') ? { type: 'string', title, enum: schema.enum } : null;
  if (!PRIMITIVE.has(schema?.type)) return null;
  const keep = Object.fromEntries(['minimum', 'maximum', 'minLength', 'maxLength'].filter(k => schema[k] !== undefined).map(k => [k, schema[k]]));
  return { type: schema.type, title, ...keep };
}
export function elicitationForm(schema) {
  const one = fieldOf(schema, 'Your answer');
  if (one) return { wrap: true, requestedSchema: { type: 'object', required: ['answer'], properties: { answer: one } } };
  if (schema?.type !== 'object' || !schema.properties) return null;
  const fields = Object.entries(schema.properties).map(([k, v]) => [k, fieldOf(v, k)]);
  if (!fields.length || fields.some(([, f]) => !f)) return null;
  return { wrap: false, requestedSchema: { type: 'object', required: schema.required ?? [], properties: Object.fromEntries(fields) } };
}
const elicits = server => { const caps = server?.getClientCapabilities?.()?.elicitation; return !!caps && (!!caps.form || Object.keys(caps).length === 0); };

/** Tool definitions bound to one FoundryApp. `context.server` is the MCP Server (for elicitation); `options.dashboardUrl()` names where a person approves. */
// dialog: may the client's own dialog decide? false (the default: the person decides in the page), true (a caller that vouches for the
// client, tests), or a function ({ server }) => { ok } asked on every ask_person_to_turn_on (the CLI: app/onboarding/detect.mjs).
// A line for the dialog from text Foundry did not write itself (settings, titles): one line, no control characters, at most 160 characters.
const oneLine = (text, max = 160) => { const t = String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
// Words alone that Foundry's own builder could not turn into a flow: the honest answer names no examples (they are not the limit of
// what Foundry can build); the agent can build the workflow itself.
const WORDS_ONLY = 'Foundry\'s own builder could not make that from words alone. Nothing was created.';
// needJudge: the host's optional, capped need judge (src/need/router.mjs modelJudge + cappedJudge); without one, need_check is a labelled
// code-only hint (ROUTER-1).
export function toolDefinitions(app, { dashboardUrl = () => null, batches = null, dialog = false, openCommand = 'node app/cli.mjs open', needJudge = null } = {}) {
  const NEED = needToolSpec('need_check', { judge: needJudge?.model ?? null });
  const need = request => needAdvice({ ...request, judge: needJudge });
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
      // A free-form version: the exact list its practice run would have made (bound by digest to that practice run), one line each (L8).
      const listed = (request.practice?.wouldDo ?? []).slice(0, 8).map(w => oneLine(`${w.action === 'send' ? `e-mail “${w.subject}” to` : w.action === 'post' ? 'post to' : `add ${w.subject} to`} ${w.to}`, 120));
      const more = Math.max(0, (request.practice?.wouldDo ?? []).length - listed.length);
      const standIns = (request.practice?.standIns ?? []).length;
      let result;
      try {
        result = await server.elicitInput({ message: `Turn on “${oneLine(t ? FORMS.templates[t.id]?.card ?? s.title : s.title, 80)}”, version ${request.version}?\n\n` +
          // Fix round 2026-10-21 (review:honesty, older defect): say which data the practice ran on; it can be the person's own list.
          `Practice run on ${request.practice?.dataSource === 'your-data' ? 'your own list (nothing was made or sent)' : 'pretend data'}: passed ${passed} of ${total} checks. Turning it on makes and sends nothing.` +
          (listed.length ? `\n\nOn practice data it would have made${standIns ? ` (with ${standIns} stand-in answer(s) to its questions)` : ''}:\n- ${listed.join('\n- ')}${more ? `\n- and ${more} more` : ''}\nEach real send or post asks you first.` : '') +
          `\n\nEach time you run it, it will:\n- ${will.join('\n- ')}`,
          requestedSchema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', title: 'Your decision', enum: ['approve', 'reject'] }, note: { type: 'string', title: 'Note (optional)', maxLength: 500 } } } });
      } catch { result = null; }
      if (result?.action === 'accept' && ['approve', 'reject'].includes(result.content?.decision)) {
        const decided = app.decideActivation(request.approvalId, result.content.decision === 'approve', { channel: 'mcp-elicitation', note: result.content.note ?? null });
        return decided.ok === false ? decided : { ...decided, workflowHash: request.workflowHash, version: request.version, eachRun: t && batches ? 'list' : 'each action' };
      }
      // "Decline" comes from the client, and need not be the person (honesty review M2): Codex rejects a dialog by itself when its
      // approval_policy does not allow MCP elicitations, and a hook can decline one. So it is not recorded as the person's no: the
      // request stays waiting in the page, and the decision log says the client declined (it may have been automatic). Closing the
      // dialog (cancel) decides nothing either. Neither opens the browser (P1 M5).
      if (result?.action === 'decline') {
        try { app.onDecision?.({ kind: 'dialog-declined', decision: 'declined by the client (may be automatic; not recorded as the person\'s no)', channel: 'mcp-elicitation',
          by: 'the coding agent\'s client', who: null, howKnown: 'The coding agent\'s client answered "decline". Foundry cannot tell whether a person, a setting or a hook chose it.', flowId: request.flowId, version: request.version, workflowHash: request.workflowHash, approvalId: request.approvalId }); } catch { /* a record, never a gate */ }
        return { ok: true, status: 'declined_by_client', approvalId: request.approvalId, channel: 'mcp-elicitation', how: where() };
      }
      if (result?.action === 'cancel') return { ok: true, status: 'not_decided', approvalId: request.approvalId };
    }
    return { ...request, how: where() };
  }
  // With batches (the site), a run of an automation made from one of the site's examples starts with the exact list the person approves
  // in their browser; a free-form automation's outside actions each ask the person.
  async function runFlow(a) { return strip(await runFlowInner(a)); }
  async function runFlowInner(a) {
    if (!batches) return app.run(a);
    let head = null; try { head = app.foundry.store.workflow(a.flowId); } catch { head = null; }
    if (!head || !app.ledger.approvedFor(a.flowId, head.hash) || app.practiceOnly()) return app.run(a);
    const example = !!templateOf(head.workflow);
    // A free-form automation makes its list too, unless it asks questions or waits while it runs (each action asks the person then).
    if (!example && (!app.isFreeform(head.hash) || head.workflow.nodes.some(function inner(n) { return n.kind === 'human' || n.kind === 'wait' || (n.body?.nodes ?? []).some(inner); }))) return app.run(a);
    let b;
    // The run is as of today (the server's clock): the agent's date would decide who gets which reminder (P1 M11).
    try { b = await batches.preview(a.flowId, example ? {} : { input: a.input }); }
    catch (error) {
      if (error.code === 'SHEET_NOT_FOUND') return { ok: true, status: 'needs_data', needsData: error.sheets ?? [], flowId: a.flowId, where: dashboardUrl(`/go-live/${a.flowId}`) ?? 'the Foundry page (run "node app/cli.mjs site")' };
      throw error;
    }
    if (!b.ok) return { ok: false, problem: { what: `A test of this version on the person's own list did not pass: ${b.headline}`, next: 'Nothing was made. Look at the run in Foundry, or change a setting.', code: 'BATCH_TEST_FAILED' }, checks: b.checks };
    if (!b.items.length) return app.run({ flowId: a.flowId, input: b.input });
    const agentDate = typeof a.input?.now === 'string' ? a.input.now.slice(0, 10) : null;
    return { ok: true, status: 'awaiting_human', batchId: b.batchId, count: b.items.length, made: kinds(b.items), flowId: a.flowId, asOf: b.input?.now ?? b.createdAt,
      ...(agentDate && typeof b.input?.now === 'string' && agentDate !== b.input.now.slice(0, 10) ? { dateNote: `Foundry used today's date (${b.input.now.slice(0, 10)}), not ${agentDate}.` } : {}),
      expiresAt: b.expiresAt, where: dashboardUrl('/waiting') ?? `the Foundry page (the person runs ${openCommand})` };
  }
  // A live run's pending sends carry real recipients and text: the agent gets the step names only (P4 walkthrough B3).
  const strip = r => r && Array.isArray(r.pendingApprovals) ? { ...r, pendingApprovals: r.pendingApprovals.map(({ args, ...rest }) => rest) } : r;
  async function propose(a) {
    const r = await app.propose({ request: a.request, answers: a.answers, flowId: a.flowId, ...(a.workflow !== undefined ? { workflow: a.workflow, practiceInput: a.practiceInput } : {}) });
    if (r.status === 'unsupported' && a.workflow === undefined) { const { supported, ...rest } = r; return { ...rest, reply: r.builder?.startsWith?.('freeform-builder') ? r.reply : WORDS_ONLY }; }
    return r;
  }
  const practiceCase = object({ name: { type: 'string', minLength: 1, maxLength: 80 }, input: { type: 'object' }, sheets: { type: 'object', maxProperties: 20, additionalProperties: { type: 'array', maxItems: 2000, items: { type: 'object' } } },
    answers: { type: 'object', maxProperties: 50 } });
  // What waits for the person. Approvals carry the engine's facts and argument names, not the argument values (those are for the person's
  // dialog); a question carries its text, fenced. Nothing here lets the model answer.
  function listWaiting() {
    const list = listHumanTasks(app);
    return { ok: true, tasks: list.tasks.map(t => ({ taskId: t.id, kind: t.kind, runId: t.runId, flowTitle: t.flowTitle, step: t.step, inLoopOrMap: t.facts.inLoopOrMap ?? false,
      ...(t.kind === 'question' ? { question: t.facts.question.text, answerableHere: !!elicitationForm(t.facts.answerSchema) } : { action: t.facts.action, effect: t.facts.effect, risk: t.facts.risk, argumentNames: t.facts.argumentNames }) })),
      notContinued: list.notContinued.map(n => ({ runId: n.runId, what: n.what, code: n.code })) };
  }
  async function answerWaiting({ taskId }, context) {
    const task = listHumanTasks(app).tasks.find(t => t.id === taskId);
    if (!task) return { ok: false, problem: { what: 'Nothing with that id is waiting for the person.', next: 'Call list_waiting for the current ids.' } };
    const server = context?.server;
    // H3 (security review 2026-10-21): the client's dialog decides only when it is safe to use right now, exactly as for
    // ask_person_to_turn_on: `dialog` is false by default, and the CLI passes the dialogAllowed check, asked again on every call.
    let useDialog = false;
    if (elicits(server)) { try { useDialog = typeof dialog === 'function' ? (await dialog({ server }))?.ok === true : dialog === true; } catch { useDialog = false; } }
    if (!useDialog) return { ok: true, status: 'awaiting_human', taskId, how: where() };
    if (task.kind === 'approval') {
      const args = task.arguments.map(a => `${a.name} = ${a.value.text}${a.value.clippedChars ? ` (… ${a.value.clippedChars} more characters)` : ''}`).join('\n');
      let result = null;
      try {
        result = await server.elicitInput({ message: `Allow “${task.facts.action}” in “${task.flowTitle}”? It ${task.facts.effect}; risk ${task.facts.risk ?? 'unknown'}.\nStep: ${task.step}\n` +
          `${task.facts.shapedByUntrustedData ? 'Some arguments came from untrusted data (documents or model output).\n' : ''}Arguments:\n${args}`,
          requestedSchema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', title: 'Your decision', enum: ['approve', 'reject'] } } } });
      } catch { result = null; }
      if (result?.action !== 'accept' || !['approve', 'reject'].includes(result.content?.decision)) return { ok: true, status: 'not_answered', taskId };
      const decided = await decideApproval(app, { runId: task.runId, approvalId: task.approvalId, approved: result.content.decision === 'approve', channel: 'mcp-elicitation' });
      return { ok: true, status: 'decided', taskId, approved: decided.approved, continued: decided.continued, runStatus: decided.run?.status ?? null };
    }
    const form = elicitationForm(task.facts.answerSchema);
    if (!form) return { ok: true, status: 'awaiting_human', taskId, how: `This answer needs the form in the dashboard. ${where()}` };
    let result = null;
    try { result = await server.elicitInput({ message: `“${task.flowTitle}” asks you: ${task.facts.question.text}\nStep: ${task.step}`, requestedSchema: form.requestedSchema }); }
    catch { result = null; }
    if (result?.action !== 'accept' || !result.content) return { ok: true, status: 'not_answered', taskId };
    // Bound to the question shown: the request hash read before the dialog opened (STALE_TASK if it changed while the person answered).
    const answered = await answerQuestion(app, { runId: task.runId, nodeKey: task.nodeKey, answer: form.wrap ? result.content.answer : result.content, requestHash: task.requestHash, channel: 'mcp-elicitation' });
    return { ok: true, status: 'answered', taskId, continued: answered.continued, runStatus: answered.run?.status ?? null };
  }
  // The condition tracker's edits (app/core/tracker/service-hooks.mjs): the model only PROPOSES; the person accepts or rejects. The
  // client's dialog decides only under the same H3 check as ask_person_to_turn_on and answer_waiting (`dialog` false by default, the
  // CLI's dialogAllowed asked again on every call); otherwise the person decides in the page.
  async function editConditions({ flowId, changes }, context) {
    const proposed = await app.proposeConditionEdit({ flowId, changes, by: 'model' });
    if (proposed.status !== 'proposed') return proposed;
    const server = context?.server;
    let useDialog = false;
    if (elicits(server)) { try { useDialog = typeof dialog === 'function' ? (await dialog({ server }))?.ok === true : dialog === true; } catch { useDialog = false; } }
    if (useDialog) {
      // Lines built from the model's text (quotes, summaries, ids): one line each, shortened (L8).
      const lines = changes.map(c => c.op === 'add' ? `add “${oneLine(c.quote)}”${c.summary ? ` (${oneLine(c.summary, 120)})` : ''}` : c.op === 'remove' ? `remove ${oneLine(c.conditionId, 64)}` : `change ${oneLine(c.conditionId, 64)}${c.summary ? ` to “${oneLine(c.summary, 120)}”` : ''}`);
      let result = null;
      try { result = await server.elicitInput({ message: `Change what you asked for on “${oneLine(flowId, 64)}”?\n\n${lines.join('\n')}`,
        requestedSchema: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', title: 'Your decision', enum: ['accept', 'reject'] } } } }); } catch { result = null; }
      if (result?.action === 'accept' && ['accept', 'reject'].includes(result.content?.decision)) {
        const d = await app.decideCondition({ flowId, action: result.content.decision, proposalId: proposed.proposal.id, channel: 'mcp-elicitation' });
        return { ok: true, status: d.proposal.status, proposal: d.proposal };
      }
      // A decline may be automatic (a setting or a hook), and closing decides nothing: the edit keeps waiting in the page.
      if (result?.action === 'cancel') return { ...proposed, status: 'not_decided', how: where() };
    }
    return { ...proposed, how: where() };
  }
  const change = object({ op: { enum: ['add', 'change', 'remove'] }, conditionId: id, quote: { type: 'string', minLength: 2, maxLength: 2000 }, summary: { type: 'string', minLength: 1, maxLength: 300 } }, ['op']);
  const defs = [
    ['construction_guide', 'How to build a Foundry automation for ANY request: the construction skill\'s core, this app\'s rules, and every capability a workflow may use (with its schemas). Pass name (e.g. "references/patterns.md" or "exemplars/invoice-chase.json") to load one reference or worked example on demand. Read-only.',
      object({ name: { type: 'string', minLength: 1, maxLength: 120 } }), a => constructionGuide(app, a), true],
    ['propose_flow', 'Propose an automation. Pass the person\'s exact words in request, and best a typed workflow you built for it (construction_guide) in workflow, with practiceInput cases. Foundry checks it (capabilities, that every address it sends to is in the person\'s words or data, strict validation and lint) and returns a version-bound proposal or a refusal naming each blocker. With words alone, Foundry\'s own builder tries. Pass answers to earlier questions in answers; to change a flow, pass flowId (and version + 1). Nothing runs.',
      object({ request: { type: 'string', minLength: 1, maxLength: 30000 }, answers: { type: 'object', additionalProperties: { type: 'string', maxLength: 2000 } }, flowId: id,
        workflow: { type: 'object', description: 'A typed Workflow Foundry workflow (construction_guide).' }, practiceInput: { type: 'array', minItems: 1, maxItems: 5, items: practiceCase } }, ['request']),
      propose, false],
    ['explain_flow', 'Explain a proposal or flow in plain words: its steps, the checks that define done, the outside actions it can take and its limits.', object({ proposalId: id, flowId: id }), a => app.explain(a), true],
    ['dry_run', 'Try the exact proposed version on practice data, with outside actions replaced by a practice stand-in. Reports which checks passed and what it would have done. Required before approval.',
      object({ proposalId: id, practiceInput: flowInput }, ['proposalId']), a => app.dryRun({ proposalId: a.proposalId, input: a.practiceInput }), false],
    ['ask_person_to_turn_on', 'Ask the PERSON to turn on a proposed version after a passing practice run. You cannot turn it on: the person decides in a dialog or in the Foundry page. Returns approved, rejected, not_decided (they closed the dialog), declined_by_client (the client declined the dialog, perhaps automatically; not the person\'s no), or awaiting_human with where they decide.',
      object({ proposalId: id }, ['proposalId']), approve, false],
    ['run_flow', 'Run the current, person-approved version of a flow with an input OBJECT. Unapproved or changed versions are refused. Outside actions (sending, posting) pause until the person approves them; for an automation made from one of the site\'s examples, the person first sees the exact list of what the run would make and approves that list.',
      object({ flowId: id, input: flowInput }, ['flowId', 'input']), runFlow, false],
    ['flow_status', 'Status of one run in plain words: what happened, which step failed and what to do, checks, the steps waiting for the person, cost.', object({ runId: id }, ['runId']), a => strip(app.status(a)), true],
    ['list_flows', 'List flows, drafts awaiting practice or approval, and how many things are waiting for the person.', object({}), () => app.list(), true],
    // ROUTER-1 need router (app/core/need.mjs): read-only, $0 without a judge.
    [NEED.name, NEED.description, NEED.inputSchema, a => need(a), true],
    ['list_waiting', 'List what runs wait on the person for: questions from human steps (also inside maps and loops) and actions paused for approval, with ids for answer_waiting. You cannot answer them.', object({}), listWaiting, true],
    ['answer_waiting', 'Ask the PERSON to answer one waiting question or decide one paused action, in a dialog the client shows them. You cannot answer: you pass only the task id. Returns answered, decided, not_answered, or awaiting_human with where to answer.',
      object({ taskId: { type: 'string', minLength: 1, maxLength: 128 } }, ['taskId']), answerWaiting, false],
    ['conditions', 'What the person asked for, as conditions read from their own words: each with its quote, its check in plain words and its status (met, unmet with evidence, unknown with why, waived), and the status on the latest live run. With check: true (and a proposalId or flowId) the exact version is first tried on practice data; with a runId, the conditions are checked on what that finished live run read and did. You cannot confirm or waive a condition; the person does.',
      object({ flowId: id, proposalId: id, runId: id, check: { type: 'boolean' } }), a => (a.runId ? app.checkRun({ runId: a.runId }) : a.check ? app.checkConditions(a) : app.conditions(a)), false],
    ['edit_conditions', 'Propose changes to the person\'s conditions: add one by quoting their exact words, change a summary, or remove one. Nothing changes until the PERSON accepts it, in a dialog the client shows them or in the Foundry page; you cannot accept it.',
      object({ flowId: id, changes: { type: 'array', minItems: 1, maxItems: 20, items: change } }, ['flowId', 'changes']), editConditions, false]
  ];
  // propose_flow also carries the need router's advice (additive field; the code-only hint, or the cascade with the host's judge).
  // Found by name, not position (review m5).
  // It wraps the front door's propose (the honest "cannot build that" reply), never replaces it.
  const proposeDef = defs.find(d => d[0] === 'propose_flow'), proposeBase = proposeDef[3];
  proposeDef[3] = async a => { const r = await proposeBase(a); return r && r.ok !== false ? { ...r, need: await need({ request: a.request }) } : r; };
  return defs.map(([name, description, inputSchema, execute, readOnly]) => ({
    name, description, inputSchema, execute,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: name === 'run_flow' },
    // Claude Code shows a permission prompt for this tool on every call and never auto-approves it (code.claude.com/docs/en/mcp,
    // "Require approval for a specific tool"); other clients ignore the key.
    ...(['ask_person_to_turn_on', 'answer_waiting', 'edit_conditions'].includes(name) ? { _meta: { 'anthropic/requiresUserInteraction': true } } : {})
  }));
}

export async function serveAppMcp(app, { transport = new StdioServerTransport(), dashboardUrl, batches = null, dialog = false, openCommand, needJudge = null } = {}) {
  const server = new Server({ name: 'workflow-foundry-surface', version: '0.0.1' }, { capabilities: { tools: {} },
    instructions: 'Workflow Foundry turns what a person needs into an automation that is checked before it runs. Call construction_guide, build a typed workflow for their request, then propose_flow with their exact words, the workflow and practiceInput; dry_run before ask_person_to_turn_on; relay `say` to the person. Only the person can turn things on or approve what a run makes.' });
  const defs = toolDefinitions(app, { dashboardUrl, batches, dialog, ...(openCommand ? { openCommand } : {}), needJudge });
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
