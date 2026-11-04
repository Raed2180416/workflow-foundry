// The spike's MCP server (stdio): nine task-directed tools over FoundryApp (research/surface-20261021/DESIGN.md §3).
//
//   propose_flow  describe what you want -> questions, an honest refusal, or a version-bound proposal with a plain summary and checks
//   explain_flow  steps, checks ("definition of done"), outside actions and limits of a proposal or flow, in plain words
//   dry_run       run the exact proposal on practice data (isolated store, practice outbox) and report checks and would-do actions
//   approve       ASK THE PERSON to turn a version on. The model cannot approve: the decision comes from the client's own dialog
//                 (MCP elicitation, shown to the person) or from the dashboard / CLI. Marked anthropic/requiresUserInteraction.
//   run_flow      run the current approved version; outside actions still pause for the person
//   flow_status   a run in plain words: status, failed step, what to do, checks, pending approvals, cost
//   list_flows    flows, proposals, and how many things wait for the person
//   list_waiting  what runs wait on the person for: questions from human steps and actions paused for approval (app/core/human-tasks.mjs)
//   answer_waiting ASK THE PERSON to answer one of them. The model cannot answer: the answer comes from the client's own dialog (MCP
//                 elicitation, bound to the exact question shown) or from the dashboard / CLI. Marked anthropic/requiresUserInteraction.
//
// Every result has `say`: one or two sentences the agent can relay as is. Arguments are validated against the advertised schema
// before anything runs. Tool output is data about the user's workspace; nothing in it is an instruction to the agent.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { validateData } from '../../src/validate.mjs';
import { errorData } from '../../src/data.mjs';
import { listHumanTasks, answerQuestion, decideApproval } from '../core/human-tasks.mjs';

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
      if (r.status === 'needs_answers') return `I need one answer first: ${r.questions.map(q => q.question).join(' ')}`;
      if (r.status === 'unsupported' || r.status === 'no_change' || r.status === 'build_failed') return r.reply;
      return `I drafted “${r.summary.title}” (version ${r.version}). It will: ${r.willDo.join('; ')}. It will not: ${r.willNotDo.join('; ')}. Nothing is running. Next: try it on practice data.`;
    case 'explain_flow': return `“${r.summary.title}” has ${r.summary.steps.length} steps and ${r.summary.checks.length} checks that define done.`;
    case 'dry_run': return r.passed ? `Practice run passed all ${r.checks.length} checks. It would have: ${r.wouldDo.map(w => (DID[w.action] ?? DID.send)(w)).join('; ') || 'taken no outside action'}. Nothing real was sent.`
      : `Practice run did not pass: ${r.headline}`;
    case 'approve': return r.status === 'approved' ? `The person approved version ${r.workflowHash?.slice(0, 8)}. It can run now; each send still asks them first.`
      : r.status === 'rejected' ? 'The person said no. Nothing was turned on.'
      : `Waiting for the person to approve. ${r.how}`;
    case 'run_flow': case 'flow_status': return `${r.headline}${r.problem ? ` ${r.problem.what} ${r.problem.next}` : ''}${r.pendingApprovals?.length ? ` The person must approve: ${r.pendingApprovals.map(a => a.step).join('; ')}.` : ''}`;
    case 'list_flows': return `${r.flows.length} flow(s), ${r.proposals.length} draft(s), ${r.waitingForYou} item(s) waiting for the person.`;
    case 'list_waiting': return r.tasks.length ? `${r.tasks.length} thing(s) wait for the person: ${r.tasks.map(t => t.kind === 'question' ? `a question in “${t.flowTitle}”` : `allowing ${t.action} in “${t.flowTitle}”`).join('; ')}. Only the person can answer (answer_waiting asks them).`
      : `Nothing waits for the person.${r.notContinued.length ? ` ${r.notContinued.length} run(s) did not continue after a decision.` : ''}`;
    case 'answer_waiting': return r.status === 'answered' ? `The person answered. ${r.continued?.words ?? ''}`.trim() : r.status === 'decided' ? `The person ${r.approved ? 'allowed' : 'refused'} it. ${r.continued?.words ?? ''}`.trim()
      : r.status === 'not_answered' ? 'The person did not answer.' : `Waiting for the person. ${r.how}`;
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
export function toolDefinitions(app, { dashboardUrl = () => null } = {}) {
  const where = () => dashboardUrl() ? `The person approves it in ${dashboardUrl()}; you cannot approve it.`
    : 'Ask the person to run `node app/cli.mjs start` in their own terminal and approve it in the page it opens. You cannot approve it.';
  async function approve({ proposalId }, context) {
    const request = app.requestApproval({ proposalId });
    if (!request.ok || request.status === 'approved') return request;
    const server = context?.server, caps = server?.getClientCapabilities?.()?.elicitation;
    if (caps && (caps.form || Object.keys(caps).length === 0)) {
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
    if (!elicits(server)) return { ok: true, status: 'awaiting_human', taskId, how: where() };
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
  const defs = [
    ['propose_flow', 'Turn a plain-language request into a proposed automation, or questions, or an honest "cannot build that". Nothing runs. Pass the person\'s exact words in request; pass answers to earlier questions in answers, keyed by question id. To change an existing flow, pass flowId.',
      object({ request: { type: 'string', minLength: 1, maxLength: 30000 }, answers: { type: 'object', additionalProperties: { type: 'string', maxLength: 2000 } }, flowId: id }, ['request']), a => app.propose(a), false],
    ['explain_flow', 'Explain a proposal or flow in plain words: its steps, the checks that define done, the outside actions it can take and its limits.', object({ proposalId: id, flowId: id }), a => app.explain(a), true],
    ['dry_run', 'Try the exact proposed version on practice data, with outside actions replaced by a practice stand-in. Reports which checks passed and what it would have done. Required before approval.',
      object({ proposalId: id, practiceInput: flowInput }, ['proposalId']), a => app.dryRun({ proposalId: a.proposalId, input: a.practiceInput }), false],
    ['approve', 'Ask the PERSON to turn on a proposed version after a passing practice run. You cannot approve: the person decides in a dialog or in the dashboard. Returns approved, rejected, or awaiting_human with where to approve.',
      object({ proposalId: id }, ['proposalId']), approve, false],
    ['run_flow', 'Run the current, person-approved version of a flow with an input OBJECT. Unapproved or changed versions are refused. Outside actions (sending) pause until the person approves them.',
      object({ flowId: id, input: flowInput }, ['flowId', 'input']), a => app.run(a), false],
    ['flow_status', 'Status of one run in plain words: what happened, which step failed and what to do, checks, pending approvals, cost.', object({ runId: id }, ['runId']), a => app.status(a), true],
    ['list_flows', 'List flows, drafts awaiting practice or approval, and how many things are waiting for the person.', object({}), () => app.list(), true],
    ['list_waiting', 'List what runs wait on the person for: questions from human steps (also inside maps and loops) and actions paused for approval, with ids for answer_waiting. You cannot answer them.', object({}), listWaiting, true],
    ['answer_waiting', 'Ask the PERSON to answer one waiting question or decide one paused action, in a dialog the client shows them. You cannot answer: you pass only the task id. Returns answered, decided, not_answered, or awaiting_human with where to answer.',
      object({ taskId: { type: 'string', minLength: 1, maxLength: 128 } }, ['taskId']), answerWaiting, false]
  ];
  return defs.map(([name, description, inputSchema, execute, readOnly]) => ({
    name, description, inputSchema, execute,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: name === 'run_flow' },
    // Claude Code shows a permission prompt for this tool on every call and never auto-approves it (code.claude.com/docs/en/mcp,
    // "Require approval for a specific tool"); other clients ignore the key.
    ...(['approve', 'answer_waiting'].includes(name) ? { _meta: { 'anthropic/requiresUserInteraction': true } } : {})
  }));
}

export async function serveAppMcp(app, { transport = new StdioServerTransport(), dashboardUrl } = {}) {
  const server = new Server({ name: 'workflow-foundry-surface', version: '0.0.1' }, { capabilities: { tools: {} },
    instructions: 'Workflow Foundry builds small automations that are checked before they run. Use propose_flow for a request, dry_run before approve, and relay `say` to the person. Only the person can approve.' });
  const defs = toolDefinitions(app, { dashboardUrl });
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
