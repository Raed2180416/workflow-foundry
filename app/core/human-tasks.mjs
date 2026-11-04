// Everything a run waits on a person for, in one list: questions from `human` nodes and actions paused for approval.
//
// Before this file the app could approve a paused action (FoundryApp.inbox, decideAction) but a question from a `human` node could not be
// answered anywhere in the app, and the inbox looked only at the 100 most recent runs. Here:
//   listHumanTasks   every open run (store.openRunIds), every frame (a question inside a map item counts), both kinds
//   answerQuestion   a person's answer: a human channel only, bound to the exact question shown (the hash of its human.requested event),
//                    re-validated by the host (tools/ui compileForm + validateAnswer) and again by the engine, then the run resumes
//   decideApproval   a person's yes or no on a paused action, bound to the approval id (itself a digest over the exact arguments)
//
// Forged approval dialogs ("Lies-in-the-Loop", Checkmarx 2025): a task leads with typed facts the engine wrote (tool, effect class, risk,
// the argument names, the argument hash from the chain and whether the record still matches it). Every value that could carry model,
// tool or document text is fenced (run-graph.mjs fence): sanitised, blank-line padding collapsed into a visible marker, capped with counts.
//
// Execution authority stays outside the model: these functions refuse any channel that is not a person's (ledger.mjs HUMAN_CHANNELS).
import { FoundryError, digest } from '../../src/data.mjs';
import { ownerAlive } from '../../src/runtime.mjs';
import { tryCompileForm, validateAnswer } from '../../tools/ui/index.mjs';
import { HUMAN_CHANNELS } from './ledger.mjs';
import { fence } from './run-graph.mjs';

export const TASKS_SCHEMA = 'foundry-human-tasks/1';
const defOf = (workflow, nodeKey) => {
  let nodes = workflow?.nodes, def = null;
  for (const part of String(nodeKey).split('/').slice(1)) { const id = part.replace(/:\d+$/, ''); def = (nodes ?? []).find(n => n.id === id) ?? null; if (!def) return null; nodes = def.body?.nodes; }
  return def;
};
const EFFECT_WORDS = { none: 'reads or computes only', idempotent: 'writes (safe to repeat)' };
const effectWords = cap => cap ? EFFECT_WORDS[cap.effects] ?? 'acts on the outside world (not safe to repeat)' : 'unknown action (not in this workspace\'s registry)';
const busy = header => !!(header.owner && ownerAlive(header.owner));

function argumentFacts(args, label) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [{ name: '(value)', kind: Array.isArray(args) ? 'array' : typeof args, value: fence(args, 300), shapedByUntrustedData: label !== 'trusted' }];
  return Object.entries(args).map(([name, value]) => ({ name: fence(name, 60).text, kind: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    value: fence(value, typeof value === 'string' && value.length > 300 ? 2000 : 300), shapedByUntrustedData: label !== 'trusted' }));
}

/** The open tasks of one run (a run record and its workflow), both kinds. */
export function tasksOfRun(app, run, workflow, { title = null } = {}) {
  const store = app.foundry.store, out = [], executing = busy(run);
  const base = { runId: run.id, flowId: run.workflowId, flowTitle: fence(title ?? workflow.title, 120).text, workflowHash: run.workflowHash };
  for (const { frameKey, nodeId, state } of store.rows.withStatus(run.id, 'awaiting_human')) {
    const nodeKey = `${frameKey}/${nodeId}`, def = defOf(workflow, nodeKey), requested = store.findEvent(run.id, 'human.requested', 'nodeKey', nodeKey);
    const question = state.question ?? def?.question ?? '', schema = state.answerSchema ?? def?.answerSchema ?? null;
    const form = tryCompileForm({ answerSchema: schema, question: typeof question === 'string' && question.trim() ? question : 'Your answer', formName: `task-${digest({ runId: run.id, nodeKey }).slice(0, 12)}` });
    out.push({ kind: 'question', id: digest({ runId: run.id, nodeKey, requested: requested?.hash ?? null }), ...base, nodeKey, step: fence(def?.description ?? nodeId, 200).text,
      requestedAt: requested?.at ?? null, requestSeq: requested?.seq ?? null, requestHash: requested?.hash ?? null,
      // The question is workflow text (authored when the flow was built, not at run time); it is still shown fenced.
      facts: { question: fence(question, 1000), answerSchema: schema, schemaHash: digest(schema), principal: def?.principal ?? null, inLoopOrMap: frameKey !== 'root' },
      form: form.ok ? { ok: true, spec: form.spec } : { ok: false, errors: form.errors.slice(0, 5) },
      runBusy: executing });
  }
  for (const approval of Object.values(run.approvals ?? {}).filter(a => a.status === 'pending')) {
    const cap = app.registry.get(approval.tool) ?? null, def = defOf(workflow, approval.nodeKey);
    const requested = store.findEvent(run.id, 'approval.requested', 'approvalId', approval.id);
    const label = approval.argsLabel ?? 'trusted', control = approval.controlLabel ?? 'trusted';
    out.push({ kind: 'approval', id: approval.id, ...base, nodeKey: approval.nodeKey, step: fence(def?.description ?? approval.nodeKey, 200).text,
      requestedAt: requested?.at ?? null, requestSeq: requested?.seq ?? null, requestHash: requested?.hash ?? null, approvalId: approval.id,
      facts: { action: approval.tool, actionDescription: cap ? fence(cap.description, 200).text : null, effect: effectWords(cap), risk: approval.risk ?? cap?.risk ?? null,
        argumentNames: Object.keys(approval.args ?? {}), argsHash: requested?.argsHash ?? null, argsHashMatchesRecord: !!requested && requested.argsHash === digest(approval.args),
        shapedByUntrustedData: label !== 'trusted' || control !== 'trusted', argsLabel: label, controlLabel: control },
      arguments: argumentFacts(approval.args, label),
      runBusy: executing });
  }
  return out;
}

/** Every open task in the workspace, oldest run first: questions and approvals from every open run, including those in maps and loops. */
export function listHumanTasks(app, { runId = null } = {}) {
  const store = app.foundry.store, tasks = [];
  for (const id of runId ? [runId] : store.openRunIds()) {
    const run = store.run(id);
    if (!['awaiting_human', 'awaiting_approval', 'running', 'waiting', 'ready'].includes(run.status)) continue;
    const { workflow } = store.workflow(run.workflowHash);
    tasks.push(...tasksOfRun(app, run, workflow));
  }
  return { schema: TASKS_SCHEMA, tasks, count: tasks.length, questions: tasks.filter(t => t.kind === 'question').length, approvals: tasks.filter(t => t.kind === 'approval').length };
}

const refuseChannel = channel => { if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Answers and approvals come only from a person (${HUMAN_CHANNELS.join(', ')}), not from ${channel}`); };
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Set();
/** Resumes still waiting for a busy run to be released (tests and a clean shutdown await them). */
export const settleResumes = () => Promise.allSettled([...pending]);

// After a decision the run continues. A run that a live process still executes (another branch is working) usually picks the decision up
// itself (probe in research/node-graph-ui-20261021/RESULT-NODE-GRAPH-DATA.md §6). If that process parks or ends the run without it (the
// runtime computes the parked status before its final compare-and-swap, so a decision that lands in between leaves the run parked with
// nothing pending), the run is resumed here as soon as no live process holds it. Never two executions: startRun refuses a run a live owner
// holds (RUN_BUSY), and a terminal run is left alone.
async function resumeWhenFree(app, runId, { pollMs = 100, maxMs = 3600000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const header = app.foundry.store.rows.header(runId);
    if (TERMINAL.has(header.status)) return header.status;
    if (!busy(header)) { await app.foundry.startRun(runId).catch(() => {}); return 'resumed'; }
    if (Date.now() - t0 > maxMs) return 'gave-up';
    await sleep(pollMs);
  }
}
async function continueRun(app, runId) {
  if (!busy(app.foundry.store.rows.header(runId))) { await resumeWhenFree(app, runId); return 'resumed'; }
  const p = resumeWhenFree(app, runId).finally(() => pending.delete(p));
  pending.add(p);
  return 'continues when the steps it is working on finish';
}

/** A person's answer to one question. `requestHash` is the hash of the human.requested event the person was shown (compare-and-swap). */
export async function answerQuestion(app, { runId, nodeKey, answer, requestHash, channel, actor = null } = {}) {
  refuseChannel(channel);
  const store = app.foundry.store, run = store.run(runId);
  const { workflow } = store.workflow(run.workflowHash);
  const task = tasksOfRun(app, run, workflow).find(t => t.kind === 'question' && t.nodeKey === nodeKey);
  if (!task) throw new FoundryError('NO_QUESTION', 'No question is waiting at that step');
  if (typeof requestHash !== 'string' || requestHash !== task.requestHash) throw new FoundryError('STALE_TASK', 'The question changed since it was shown; reload and answer again');
  if (task.form.ok) {
    const errors = validateAnswer(task.form.spec, answer);
    if (errors.length) throw new FoundryError('ANSWER_INVALID', errors.map(e => e.message).join('; ').slice(0, 1000), { errors: errors.slice(0, 20) });
  }
  // The engine validates the answer against the node's schema again and records human.answered (and, from engine v2, the actor and channel).
  app.foundry.runtime.answer(runId, nodeKey, answer, { actor, channel });
  const continued = await continueRun(app, runId);
  return { ok: true, runId, nodeKey, channel, continued, run: app.status({ runId }) };
}

/** A person's yes or no on one paused action. The approval id is a digest over the exact tool and arguments, so it binds what was shown. */
export async function decideApproval(app, { runId, approvalId, approved, channel } = {}) {
  refuseChannel(channel);
  if (typeof approved !== 'boolean') throw new FoundryError('APPROVAL_AUTHORITY', 'An explicit yes or no is required');
  const run = app.foundry.store.run(runId);
  if (run.approvals?.[approvalId]?.status !== 'pending') throw new FoundryError('APPROVAL_CONFLICT', 'That action is no longer waiting for a decision');
  app.foundry.runtime.approve(runId, approvalId, approved, 'user');
  const continued = approved ? await continueRun(app, runId) : 'stopped: you said no';
  return { ok: true, runId, approvalId, approved, channel, continued, run: app.status({ runId }) };
}
