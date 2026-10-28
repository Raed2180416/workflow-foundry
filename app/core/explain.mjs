// Plain-language views of a workflow, a run and a failure, computed by code from the canonical records (no model, no guessing).
// Shared by the MCP tools and the dashboard so that both say the same thing. Every string here is built from the workflow's own
// descriptions and the run's own events; user and corpus text is data and is never interpreted.
import { condition } from '../../src/data.mjs';

const STATUS = {
  succeeded: 'Finished. Every check in its definition of done passed.',
  failed: 'Stopped with a problem. Nothing after the failed step ran.',
  uncertain: 'Stopped, and one action may or may not have happened. It will not be retried automatically; check it by hand.',
  cancelled: 'Stopped on request. It will not continue.',
  awaiting_approval: 'Waiting for you to approve an action before it happens.',
  awaiting_human: 'Waiting for an answer from you.',
  waiting: 'Waiting for a timer or an outside signal.',
  running: 'Running now.',
  ready: 'Created, not started yet.'
};
// What a failure code means to a person, and what they can do. Unknown codes fall back to a generic text, never to a guess.
const FAILURES = {
  APPROVAL_REJECTED: ['You said no to an action, so the run stopped before doing it.', 'Nothing was sent. Run it again when you are ready.'],
  VERIFY_FAILED: ['The final check failed: what was written to send is not exactly what was saved.', 'Open the run and compare the two. Do not resend until you know why.'],
  ACCEPTANCE_FAILED: ['All steps ran, but the definition of done did not hold.', 'Open the run: the checks list shows which one failed.'],
  INPUT_SCHEMA: ['The input does not have the expected shape.', 'Each item needs a title and a status of done, open or blocked; the week needs a label.'],
  SCHEMA_MISMATCH: ['The input does not have the expected shape.', 'Each item needs a title and a status of done, open or blocked; the week needs a label.'],
  SCHEMA: ['The input does not have the expected shape.', 'Each item needs a title and a status of done, open or blocked; the week needs a label.'],
  VALIDATION: ['The input does not have the expected shape.', 'Check the fields named in the details.'],
  CAPABILITY_DENIED: ['A step asked for an action this workspace does not allow.', 'Nothing ran for that step. An administrator must allow the action first.'],
  COST_BUDGET: ['The run hit its spending limit.', 'Raise the limit for this flow only if the extra cost is worth it.'],
  DEADLINE: ['The run ran out of time.', 'Try a smaller input, or raise the time limit.'],
  TOOL_TIMEOUT: ['A step took too long and was stopped.', 'Run it again; if it keeps happening, the service behind that step is slow or down.'],
  CANCELLED: ['Someone stopped the run.', 'Start a new run when ready.'],
  OUTBOX_CONFLICT: ['A different message already used this id, so nothing was overwritten.', 'This should not happen; report it.'],
  STALE_APPROVAL: ['The flow changed after you approved it.', 'Approve the new version first.'],
  NOT_APPROVED: ['This version has not been turned on by a person yet.', 'Try it on practice data, then ask the person to approve it.'],
  NEEDS_DRY_RUN: ['This version has not passed a practice run yet.', 'Run it on practice data first; approval comes after.'],
  NOT_FOUND: ['There is nothing by that name.', 'List the flows to see what exists.'],
  ACTIVATION_CONFLICT: ['Someone already decided this request.', 'Reload to see the decision.'],
  APPROVAL_AUTHORITY: ['Only a person can approve, in their own window.', 'Ask the person to approve it in the dashboard or the approval dialog.'],
  BUILDER_MODEL: ['The model that builds flows could not give a usable answer.', 'Nothing was created. Try again, or describe the request in other words.'],
  BUILDER_TOKEN_CAP: ['The builder has no token cap for this model.', 'Set a token cap before using a model listed at $0.'],
  MODEL_BUDGET: ['The builder reached its token or spending cap.', 'Nothing was created. The flows you have keep running.'],
  // Plain words for the person (onboarding walkthroughs P2 M16, P5 minor 11; P4 M8: never nudge someone to switch a pilot's control off).
  SHEET_NOT_FOUND: ['Foundry couldn\'t find the list this automation reads.', 'Nothing was made. Give it the list again on the automation\'s page (developers: a JSON list of rows in the workspace world/sheets folder).'],
  PRACTICE_ONLY: ['Practice-only mode is on, so nothing runs for real here.', 'Foundry can still show what a run would make on your list, without making it. Ask whoever set up the pilot before turning it off.'],
  ROWS_DATE: ['A date in your sheet is not in a form the flow can read.', 'Use YYYY-MM-DD, or a date and time with a time zone.']
};
const isRef = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$ref === 'string';

function refText(value, nodes) {
  if (!isRef(value)) return JSON.stringify(value);
  const [root, id, ...rest] = value.$ref.split('.');
  if (root === 'input') return `your input's ${[id, ...rest].join('.')}`;
  const node = nodes.get(id);
  return `the ${rest.join('.') || 'result'} of “${node?.description ?? id}”`;
}
/** One sentence per check, from the condition language (src/data.mjs condition). */
export function checkText(check, nodes) {
  const words = { eq: 'equals', ne: 'differs from', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most', in: 'is one of', contains: 'contains' };
  if (check.op === 'exists') return `${refText(check.value, nodes)} exists`;
  if (check.op === 'not') return `not (${checkText(check.condition, nodes)})`;
  if (check.op === 'all' || check.op === 'any') return check.conditions.map(c => checkText(c, nodes)).join(check.op === 'all' ? ' and ' : ' or ');
  return `${refText(check.left, nodes)} ${words[check.op] ?? check.op} ${refText(check.right, nodes)}`;
}

/** Plain description of a workflow under a registry: steps, checks, actions with effects, approvals, limits. */
export function describeWorkflow(workflow, registry) {
  const nodes = new Map(workflow.nodes.map(n => [n.id, n]));
  const steps = workflow.nodes.map((n, i) => {
    const cap = n.tool ? registry?.get(n.tool) : null;
    const asks = !!cap && (cap.requiresApproval || cap.risk === 'high');
    return { id: n.id, n: i + 1, text: n.description, kind: n.kind, tool: n.tool ?? null,
      effect: cap ? (cap.effects === 'none' ? 'reads or computes only' : cap.effects === 'idempotent' ? 'writes (safe to repeat)' : 'acts on the outside world (not safe to repeat)') : n.kind === 'verify' ? 'checks only' : 'computes only',
      asksFirst: asks, check: n.kind === 'verify' };
  });
  const checks = [
    ...workflow.acceptance.map((c, i) => ({ id: `acceptance.${i}`, plain: workflow.envelope.successCriteria[i] ?? null, exact: checkText(c, nodes) })),
    ...workflow.nodes.filter(n => n.kind === 'verify').map(n => ({ id: `verify.${n.id}`, plain: n.description, exact: `${n.tool ?? n.method} must pass (independent ${n.independence} check)` }))];
  return {
    flowId: workflow.id, version: workflow.version, title: workflow.title, goal: workflow.goal, steps, checks,
    actions: steps.filter(s => s.effect.startsWith('acts') || s.effect.startsWith('writes')).map(s => ({ step: s.text, effect: s.effect, asksFirst: s.asksFirst })),
    limits: { maxSteps: workflow.budget.maxSteps, maxMinutes: Math.round(workflow.budget.maxDurationMs / 60000 * 10) / 10, maxCostUsd: workflow.budget.maxCost ?? 0 },
    assumptions: workflow.envelope.assumptions, notSupported: workflow.envelope.unsupported ?? []
  };
}

/** Evaluate each acceptance check separately on a finished run's outputs, for display. The run's own verdict stays the authority. */
export function checkResults(workflow, run) {
  const nodes = new Map(workflow.nodes.map(n => [n.id, n]));
  const context = { input: run.input, nodes: run.outputs ?? {} };
  const results = workflow.acceptance.map((c, i) => {
    let passed = null;
    try { passed = condition(c, context) === true; } catch { passed = null; }
    if (!['succeeded', 'failed', 'cancelled', 'uncertain'].includes(run.status)) passed = null;
    return { id: `acceptance.${i}`, plain: workflow.envelope.successCriteria[i] ?? checkText(c, nodes), exact: checkText(c, nodes), passed };
  });
  for (const n of workflow.nodes.filter(x => x.kind === 'verify')) {
    const state = run.nodes?.[n.id];
    results.push({ id: `verify.${n.id}`, plain: n.description, exact: `${n.tool ?? n.method} (independent ${n.independence} check)`,
      passed: state?.status === 'completed' ? true : state?.status === 'failed' ? false : null });
  }
  return results;
}

export function failureText(error) {
  if (!error) return null;
  const [what, next] = FAILURES[error.code] ?? [`Stopped with code ${error.code}.`, 'Open the run timeline to see the step that failed.'];
  return { code: error.code, what, next };
}

/** A run in words: status, the step that failed, pending approvals, cost, and checks. */
export function explainRun(run, workflow, events = []) {
  const nodes = new Map(workflow.nodes.map(n => [n.id, n]));
  const failedNode = Object.entries(run.nodes ?? {}).find(([, s]) => ['failed', 'uncertain'].includes(s.status));
  const pending = Object.values(run.approvals ?? {}).filter(a => a.status === 'pending').map(a => {
    const id = a.nodeKey.split('/').pop();
    return { approvalId: a.id, step: nodes.get(id)?.description ?? id, tool: a.tool, args: a.args };
  });
  const done = Object.values(run.nodes ?? {}).filter(s => s.status === 'completed').length;
  return {
    runId: run.id, flowId: run.workflowId, workflowHash: run.workflowHash, status: run.status, headline: STATUS[run.status] ?? `Status: ${run.status}`,
    verdict: run.verdict?.verdict ?? null, verdictReason: run.verdict?.reason ?? null,
    progress: `${done} of ${workflow.nodes.length} steps done`,
    failedStep: failedNode ? nodes.get(failedNode[0])?.description ?? failedNode[0] : null,
    problem: failureText(run.error), pendingApprovals: pending,
    costUsd: run.cost ?? 0, steps: run.steps ?? 0, checks: checkResults(workflow, run),
    timeline: events.map(e => ({ seq: e.seq, at: e.at, type: e.type, step: e.nodeKey ? (nodes.get(String(e.nodeKey).split('/').pop())?.description ?? e.nodeKey) : null })),
    honesty: 'Local checks passing is not proof the real-world task succeeded; it is proof these checks held on this run.'
  };
}
