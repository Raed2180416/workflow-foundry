// Everything a run waits on a person for, in one list: questions from `human` nodes and actions paused for approval.
//
// Before this file the app could approve a paused action (FoundryApp.inbox, decideAction) but a question from a `human` node could not be
// answered anywhere in the app, and the inbox looked only at the 100 most recent runs. Here:
//   listHumanTasks   every open run (store.openRunIds), every frame (a question inside a map item counts), both kinds; and the runs a
//                    person's decision was meant to continue that did not (notContinued)
//   answerQuestion   a person's answer: a human channel only, bound to the exact question shown (the hash of its human.requested event),
//                    re-validated by the host (tools/ui compileForm + validateAnswer) and again by the engine, then the run continues
//   decideApproval   a person's yes or no on a paused action, bound to the approval id (itself a digest over the exact arguments)
// Channels: the dashboard (app/dashboard/live.mjs), the CLI (app/cli.mjs tasks|answer) and MCP elicitation (app/mcp/server.mjs
// answer_waiting). Every one of them goes through the two functions here.
//
// Forged approval dialogs ("Lies-in-the-Loop", Checkmarx 2025): a task leads with typed facts the engine wrote (tool, effect class, risk,
// the argument names, the argument hash from the chain and whether the record still matches it). Every value that could carry model,
// tool or document text is fenced (run-graph.mjs fence): sanitised, blank-line padding collapsed into a visible marker, capped with counts.
//
// Execution authority stays outside the model: these functions refuse any channel that is not a person's (ledger.mjs HUMAN_CHANNELS).
import { FoundryError, digest, errorData } from '../../src/data.mjs';
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

// The request events of one run, in one pass (not one scan of the run's events per question): the last human.requested per node key and
// the last approval.requested per approval id, each checked against its own recorded hash (as store.findEvent does).
function requestIndex(store, runId) {
  const questions = new Map(), approvals = new Map();
  const rows = store.rows.stmt("SELECT body, hash FROM events WHERE run_id=? AND json_extract(body, '$.type') IN ('human.requested', 'approval.requested') ORDER BY seq").all(runId);
  for (const row of rows) {
    const event = JSON.parse(row.body);
    if (digest(event) !== row.hash) throw new FoundryError('CORRUPT_EVENTS', `Event ${event.seq} (${event.type}) does not match its recorded hash`, { seq: event.seq });
    if (event.type === 'human.requested') questions.set(event.nodeKey, { ...event, hash: row.hash }); else approvals.set(event.approvalId, { ...event, hash: row.hash });
  }
  return { questions, approvals };
}

/** The open tasks of one run (its header or whole record, and its workflow), both kinds. */
export function tasksOfRun(app, run, workflow, { title = null } = {}) {
  const store = app.foundry.store, out = [], executing = busy(run);
  const asked = store.rows.withStatus(run.id, 'awaiting_human'), pendingApprovals = Object.values(run.approvals ?? {}).filter(a => a.status === 'pending');
  if (!asked.length && !pendingApprovals.length) return out;
  const index = requestIndex(store, run.id);
  const base = { runId: run.id, flowId: run.workflowId, flowTitle: fence(title ?? workflow.title, 120).text, workflowHash: run.workflowHash };
  for (const { frameKey, nodeId, state } of asked) {
    const nodeKey = `${frameKey}/${nodeId}`, def = defOf(workflow, nodeKey), requested = index.questions.get(nodeKey) ?? null;
    const question = state.question ?? def?.question ?? '', schema = state.answerSchema ?? def?.answerSchema ?? null;
    const form = tryCompileForm({ answerSchema: schema, question: typeof question === 'string' && question.trim() ? question : 'Your answer', formName: `task-${digest({ runId: run.id, nodeKey }).slice(0, 12)}` });
    out.push({ kind: 'question', id: digest({ runId: run.id, nodeKey, requested: requested?.hash ?? null }), ...base, nodeKey, step: fence(def?.description ?? nodeId, 200).text,
      requestedAt: requested?.at ?? null, requestSeq: requested?.seq ?? null, requestHash: requested?.hash ?? null,
      // The question is workflow text (authored when the flow was built, not at run time); it is still shown fenced.
      facts: { question: fence(question, 1000), answerSchema: schema, schemaHash: digest(schema), principal: def?.principal ?? null, inLoopOrMap: frameKey !== 'root' },
      form: form.ok ? { ok: true, spec: form.spec } : { ok: false, errors: form.errors.slice(0, 5) },
      runBusy: executing });
  }
  for (const approval of pendingApprovals) {
    const cap = app.registry.get(approval.tool) ?? null, def = defOf(workflow, approval.nodeKey);
    const requested = index.approvals.get(approval.id) ?? null;
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

// A run that has stopped ('uncertain' included: an action of unknown outcome is reconciled by a person before anything else) lists nothing.
const OPEN = new Set(['awaiting_human', 'awaiting_approval', 'running', 'waiting', 'ready']);
/** Every open task in the workspace, oldest run first: questions and approvals from every open run, including those in maps and loops.
 *  Reads each open run's header only (status, owner, approvals), its waiting rows, and, for a run that waits on a person, its request events
 *  once. `notContinued`: runs a person's decision was meant to continue that did not (an uncertain effect, a refusal by the engine, a give-up). */
export function listHumanTasks(app, { runId = null } = {}) {
  const store = app.foundry.store, tasks = [], workflows = new Map();
  for (const id of runId ? [runId] : store.openRunIds()) {
    const run = store.rows.header(id);
    if (!OPEN.has(run.status)) continue;
    if (!workflows.has(run.workflowHash)) workflows.set(run.workflowHash, store.workflow(run.workflowHash).workflow);
    tasks.push(...tasksOfRun(app, run, workflows.get(run.workflowHash)));
  }
  return { schema: TASKS_SCHEMA, tasks, count: tasks.length, questions: tasks.filter(t => t.kind === 'question').length, approvals: tasks.filter(t => t.kind === 'approval').length,
    notContinued: notContinued(app, runId) };
}

const refuseChannel = channel => { if (!HUMAN_CHANNELS.includes(channel)) throw new FoundryError('APPROVAL_AUTHORITY', `Answers and approvals come only from a person (${HUMAN_CHANNELS.join(', ')}), not from ${channel}`); };

// ------------------------------------------------------------------------------------------------ continuing a run after a decision
// After a decision the run continues. A run that a live process still executes (another branch is working) usually picks the decision up
// itself (probe in research/node-graph-ui-20261021/RESULT-NODE-GRAPH-DATA.md §6). If that process parks or ends the run without it (the
// runtime computes the parked status before its final compare-and-swap, so a decision that lands in between leaves the run parked with
// nothing pending), the run is resumed here as soon as no live process holds it. Never two executions: startRun refuses a run a live owner
// holds (RUN_BUSY, after which this keeps waiting), and a stopped run is left alone.
// 'uncertain' counts as stopped: an action of unknown outcome is the person's to reconcile, and nothing resumes such a run until they have
// (run-graph.mjs tells the person the same). A row in 'uncertain' holds the resume even when the run's status says otherwise (the runtime's
// answer() and approve() set a parked run 'ready' whatever its rows hold).
// Every outcome other than "it ran" (held for an uncertain effect, refused by the engine, gave up waiting, cancelled at shutdown) is written
// to the app ledger's database (table run_resumes) and listed by listHumanTasks as `notContinued`, so a person sees that the run did not
// continue, also after a restart. Waiting polls back off from 100 ms to 2 s.
const STOPPED = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
const jobs = new Map();                               // promise -> { app, runId, controller }
const tables = new WeakSet();
function resumeTable(app) {
  if (!tables.has(app)) {
    app.ledger.db.exec('CREATE TABLE IF NOT EXISTS run_resumes(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, outcome TEXT NOT NULL, code TEXT, detail TEXT, at INTEGER NOT NULL)');
    tables.add(app);
  }
  return app.ledger.db;
}
function record(app, runId, outcome, { code = null, detail = null } = {}) {
  const entry = { runId, outcome, code, detail, at: Date.now() };
  if (outcome !== 'ran') {
    try { resumeTable(app).prepare('INSERT INTO run_resumes(run_id, outcome, code, detail, at) VALUES(?,?,?,?,?)').run(runId, outcome, code, detail, entry.at); }
    catch { /* the ledger is closed (shutdown): the outcome is still returned to the caller */ }
  }
  return entry;
}
/** Every recorded resume outcome of a run that did not run it, oldest first. */
export function resumeRecords(app, runId) {
  return resumeTable(app).prepare('SELECT run_id AS runId, outcome, code, detail, at FROM run_resumes WHERE run_id=? ORDER BY id').all(runId).map(r => ({ ...r }));
}
const NOT_CONTINUED = { held: 'Your decision was recorded, but the run holds an action of unknown outcome, so it was not resumed.',
  refused: 'Your decision was recorded, but the engine refused to resume the run.', 'gave-up': 'Your decision was recorded, but the run stayed busy too long to resume it here.',
  cancelled: 'Your decision was recorded; the app stopped before the run could be resumed.' };
// The last recorded outcome of each run, when the run is still open, no live process holds it and nothing happened to it since.
function notContinued(app, runId = null) {
  let rows;
  try {
    rows = resumeTable(app).prepare(`SELECT run_id AS runId, outcome, code, detail, at FROM run_resumes r WHERE id = (SELECT MAX(id) FROM run_resumes WHERE run_id = r.run_id)${runId ? ' AND run_id=?' : ''} ORDER BY at`)
      .all(...(runId ? [runId] : []));
  } catch { return []; }
  const store = app.foundry.store, out = [];
  for (const r of rows) {
    let header; try { header = store.rows.header(r.runId); } catch { continue; }
    if (['succeeded', 'failed', 'cancelled'].includes(header.status) || busy(header) || (header.updatedAt ?? 0) > r.at) continue;
    out.push({ kind: 'not-continued', ...r, status: header.status, what: NOT_CONTINUED[r.outcome] ?? 'The run did not continue.',
      next: r.outcome === 'held' ? 'Check the action by hand, then resume the run (foundry resume RUN_ID).' : 'Resume the run when ready (foundry resume RUN_ID).' });
  }
  return out;
}

const sleep = (ms, signal = null) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
async function resumeWhenFree(app, runId, { signal, pollMs = 100, maxPollMs = 2000, maxMs = 3600000 } = {}) {
  const t0 = Date.now(), store = app.foundry.store;
  for (let wait = pollMs; ; wait = Math.min(maxPollMs, wait * 2)) {
    if (signal.aborted) return record(app, runId, 'cancelled');
    const header = store.rows.header(runId);
    if (header.status === 'uncertain' || store.rows.anyWithStatus(runId, 'uncertain')) return record(app, runId, 'held', { code: 'EFFECT_UNCERTAIN', detail: 'An action of unknown outcome must be reconciled by a person first' });
    if (STOPPED.has(header.status)) return { runId, outcome: 'not-needed', status: header.status };
    if (!busy(header)) {
      // startRun rejects only when the engine refuses to take the run (MODEL_POLICY_REQUIRED, ENGINE_DRIFT, DEADLINE before resume, ...);
      // a run that it takes and that then fails resolves with the failed run.
      try { const run = await app.foundry.startRun(runId); return { ...record(app, runId, 'ran'), status: run?.status ?? store.rows.header(runId).status }; }
      catch (error) {
        const { code, message } = errorData(error);
        if (code !== 'RUN_BUSY') return record(app, runId, 'refused', { code, detail: String(message ?? '').slice(0, 300) });
      }
    }
    if (Date.now() - t0 > maxMs) return record(app, runId, 'gave-up', { detail: `The run stayed busy for ${Math.round(maxMs / 1000)} s` });
    await sleep(wait, signal);
  }
}
function track(app, runId, options) {
  const controller = new AbortController();
  const promise = resumeWhenFree(app, runId, { ...options, signal: controller.signal })
    .catch(error => record(app, runId, 'refused', { code: errorData(error).code }))
    .finally(() => jobs.delete(promise));
  jobs.set(promise, { app, runId, controller });
  return promise;
}
/** Resumes started here that have not ended yet (all apps, or one); tests and a clean shutdown await them. */
export const settleResumes = (app = null) => Promise.allSettled([...jobs].filter(([, j]) => !app || j.app === app).map(([p]) => p));
/** Stop every resume of `app` that still waits for a busy run (a run already started is the Foundry's to finish or cancel); records each. */
export function cancelResumes(app) { for (const [, j] of jobs) if (j.app === app) j.controller.abort(); return settleResumes(app); }

const CONTINUED = { ran: 'It ran.', 'not-needed': 'Nothing to continue: the run had already stopped.', ...NOT_CONTINUED };
// The request returns after at most `waitMs`, never after the whole remaining run: with the outcome when there is one by then (it ran and
// stopped, or it was held, refused or cancelled), otherwise with what is happening ('running', or 'waiting' for the live process that holds
// the run). The resume itself goes on in the background (settleResumes, cancelResumes).
async function continueRun(app, runId, { waitMs = 1000, resume = {} } = {}) {
  const holder = busy(app.foundry.store.rows.header(runId));
  const job = track(app, runId, resume);
  // waitMs Infinity (the CLI, whose process is where the run continues): wait for the outcome itself.
  const outcome = Number.isFinite(waitMs) ? await Promise.race([job, sleep(waitMs).then(() => null)]) : await job;
  if (outcome) return { outcome: outcome.outcome, code: outcome.code ?? null, words: CONTINUED[outcome.outcome] ?? outcome.outcome };
  return holder ? { outcome: 'waiting', code: null, words: 'It continues when the steps it is working on finish.' } : { outcome: 'running', code: null, words: 'It is running.' };
}

// The run's status after a person's answer or decision; a run that ended also carries the condition tracker's live check (FoundryApp's
// narrow hook, as for run and decideAction), so a resumed run reports what of the person's conditions it broke.
const statusWithConditions = async (app, runId) => { const s = app.status({ runId }); return typeof app.withConditions === 'function' ? app.withConditions(s) : s; };

/** A person's answer to one question. `requestHash` is the hash of the human.requested event the person was shown (compare-and-swap).
 *  `waitMs`: how long the call may wait for the run's outcome (the run goes on in the background). */
export async function answerQuestion(app, { runId, nodeKey, answer, requestHash, channel, actor = null, waitMs = 1000, resume = {} } = {}) {
  refuseChannel(channel);
  const store = app.foundry.store, run = store.rows.header(runId);
  if (!OPEN.has(run.status)) throw new FoundryError(run.status === 'uncertain' ? 'RUN_UNCERTAIN' : 'NO_QUESTION',
    run.status === 'uncertain' ? 'This run holds an action of unknown outcome: check it by hand and reconcile it before answering' : 'No question is waiting at that step');
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
  const continued = await continueRun(app, runId, { waitMs, resume });
  return { ok: true, runId, nodeKey, channel, continued, run: await statusWithConditions(app, runId) };
}

/** A person's yes or no on one paused action. The approval id is a digest over the exact tool and arguments, so it binds what was shown. */
export async function decideApproval(app, { runId, approvalId, approved, channel, waitMs = 1000, resume = {} } = {}) {
  refuseChannel(channel);
  if (typeof approved !== 'boolean') throw new FoundryError('APPROVAL_AUTHORITY', 'An explicit yes or no is required');
  const run = app.foundry.store.rows.header(runId);
  if (run.approvals?.[approvalId]?.status !== 'pending') throw new FoundryError('APPROVAL_CONFLICT', 'That action is no longer waiting for a decision');
  app.foundry.runtime.approve(runId, approvalId, approved, 'user');
  const continued = approved ? await continueRun(app, runId, { waitMs, resume }) : { outcome: 'stopped', code: 'APPROVAL_REJECTED', words: 'You said no, so the run stopped.' };
  return { ok: true, runId, approvalId, approved, channel, continued, run: await statusWithConditions(app, runId) };
}
