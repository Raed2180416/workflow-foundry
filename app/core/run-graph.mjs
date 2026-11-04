// The read-only data a run visualisation needs (owner decision D33, 2026-11-04: the visualisation engine and its UI/UX are the owner's;
// our part is the engine plus the read-only data). One typed document per run, `foundry-run-graph/1`:
//   run      status in plain words, one user-facing state, cost, the chain head, whether a process is executing it
//   summary  the one-line summary for run history, the failing step and its cause, how many things wait for a person
//   graph    the workflow IR folded into at most 24 cards (tools/run-view buildSemantic), ranked for layout, each with one of five user
//            states (not running, working, needs you, problem, done), the detailed state behind it, a motion hint, a one-line note, cost
//            and progress
// and, per node instance, a detail record (what the step does, state in words, what to do, inputs, output, cost, checks, model calls).
//
// Everything is computed by code from typed records: the hash-chained events (the same reducer as tools/run-view, RunModel), the
// immutable workflow version, and, when given, the run checkpoint and the model-call journal. No model is called and no model text is
// interpreted: model text only ever appears as data in fields marked untrusted, sanitised and length-capped.
import '../../tools/run-view/run-view.js';                     // defines globalThis.RunViewCore; its UI starts only when a document exists
import { checkText, failureText } from './explain.mjs';
import { condition } from '../../src/data.mjs';

const C = globalThis.RunViewCore;
export const GRAPH_SCHEMA = 'foundry-run-graph/1';
export const NODE_SCHEMA = 'foundry-run-node/1';

// ------------------------------------------------------------------------------------------------------------ five user states
// Industrial-HMI practice (ISA-101): normal is quiet, only active states move, and the state that needs a person is the most salient.
// Colour is never the only signal (glyph and label differ for every state). Motion is a hint the UI may honour (and must let a person
// pause, WCAG 2.2.2); both periods are far below three flashes a second (WCAG 2.3.1).
export const USER_STATES = Object.freeze({
  idle:      Object.freeze({ label: 'Not running', glyph: 'ring',  tone: 'neutral',   motion: 'none' }),
  working:   Object.freeze({ label: 'Working',     glyph: 'dot',   tone: 'active',    motion: 'breathe' }),
  needs_you: Object.freeze({ label: 'Needs you',   glyph: 'ask',   tone: 'attention', motion: 'pulse' }),
  problem:   Object.freeze({ label: 'Problem',     glyph: 'cross', tone: 'danger',    motion: 'none' }),
  done:      Object.freeze({ label: 'Done',        glyph: 'check', tone: 'quiet',     motion: 'none' })
});
export const MOTION = Object.freeze({ breathe: Object.freeze({ periodMs: 3500 }), pulse: Object.freeze({ periodMs: 1200 }), none: Object.freeze({ periodMs: 0 }) });
// The run-view reducer's sixteen detailed states, and 'stalled' (added here: a working step whose process is gone), onto the five.
export const DETAIL_TO_USER = Object.freeze({
  idle: 'idle', skipped: 'idle', cancelled: 'idle', refused: 'idle',
  queued: 'working', calling: 'working', running: 'working', retrying: 'working', escalated: 'working', checkfailed: 'working', waiting: 'working',
  needsyou: 'needs_you',
  failed: 'problem', envfault: 'problem', uncertain: 'problem', stalled: 'problem', checkdisagreed: 'problem',
  done: 'done', handled: 'done'
});
const DETAIL_LABEL = { ...Object.fromEntries(Object.entries(C.STATES).map(([k, v]) => [k, v.label])), stalled: 'Its process stopped while it ran', checkdisagreed: 'The independent check did not pass', refused: 'You said no; it did not run' };
const STILL = new Set(['waiting']);                               // working, but nothing is moving: a timer or an outside signal
const WORKING_DETAILS = new Set(Object.entries(DETAIL_TO_USER).filter(([, u]) => u === 'working').map(([d]) => d));
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const STOPPED = new Set([...TERMINAL, 'uncertain']);

/** The user-facing state of one detailed state, with the motion it may show. `executing` false: nothing is running the run right now. */
export function userState(detail, { executing = true } = {}) {
  const user = DETAIL_TO_USER[detail] ?? 'idle', def = USER_STATES[user];
  const motion = def.motion === 'breathe' && (!executing || STILL.has(detail)) ? 'none' : def.motion;
  return { user, label: def.label, detail, detailLabel: DETAIL_LABEL[detail] ?? detail, glyph: def.glyph, tone: def.tone, motion, periodMs: MOTION[motion].periodMs };
}

// The run as a whole. `executing`: a live process holds the run (null when unknown, e.g. replay of an export).
export function runUserState(status, { executing = null } = {}) {
  // The runtime's answer() and approve() set a run 'ready' even while a live process executes it (it picks the decision up itself); a
  // person sees that as running, not as "not started".
  if (status === 'ready' && executing === true) status = 'running';
  if (status === 'running' && executing === false) return { ...userState('stalled', { executing: false }), words: 'Stopped unexpectedly: no process is running it. Resume it to continue.' };
  const map = {
    ready: ['idle', 'Created, not started yet.'], running: ['running', 'Running now.'], waiting: ['waiting', 'Waiting for a timer or an outside signal. Nothing is needed from you.'],
    awaiting_human: ['needsyou', 'Waiting for your answer.'], awaiting_approval: ['needsyou', 'Waiting for you to approve an action before it happens.'],
    succeeded: ['done', 'Finished. Its own checks passed; that is not an independent check of the real-world result.'],
    failed: ['failed', 'Stopped with a problem. Steps after the problem did not run.'], uncertain: ['uncertain', 'Stopped, and one action may or may not have happened. Check it by hand.'],
    cancelled: ['cancelled', 'Stopped. It will not continue.']
  };
  const [detail, words] = map[status] ?? ['idle', `Status: ${status}`];
  return { ...userState(detail, { executing: executing !== false }), words };
}

// ------------------------------------------------------------------------------------------------------- untrusted text
// Text that came from a model, a tool or a document is data. It is sanitised (invisible and bidi characters made visible), long runs of
// blank lines are collapsed into a visible marker (a payload cannot be pushed out of view by padding, "Lies-in-the-Loop"), and it is
// capped with the count of what was left out.
export function fence(value, max = 600) {
  const raw = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
  const s = C.sanitizeDisplay(raw);
  let blank = 0;
  const collapsed = s.text.replace(/(?:[ \t]*\r?\n){3,}/g, run => { const n = (run.match(/\n/g) ?? []).length; blank += n - 2; return `\n⟦${n - 2} more blank lines⟧\n`; })
    .replace(/[ \t]{40,}/g, run => { blank += 0; return ` ⟦${run.length} spaces⟧ `; });
  const text = collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
  return { text, chars: raw.length, shownChars: Math.min(collapsed.length, max), clippedChars: Math.max(0, collapsed.length - max), invisibleReplaced: s.replaced, blankLinesCollapsed: blank, trust: 'untrusted' };
}
const plain = (value, max = 200) => { const s = C.sanitizeDisplay(String(value ?? '')).text; return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

// ----------------------------------------------------------------------------------------------------------- what to do
const CLASS_REMEDY = {
  environment: ['The model service failed (for example a rate limit or an outage); this is not the workflow\'s fault.', 'Run it again later. Nothing needs changing.'],
  budget: ['It reached its spending, step or time limit.', 'Raise the limit for this flow only if the extra cost is worth it, or give it a smaller input.'],
  check: ['A step\'s answer did not pass its checks.', 'Open the step to see the check and the model\'s answer. The flow may need changed instructions or checks: ask for a changed flow.'],
  exhausted: ['A step\'s answer kept failing its checks or format, even on the larger models it may use.', 'Open the step to see the answers. The flow may need changed instructions or checks: ask for a changed flow.'],
  policy: ['The flow tried something this workspace does not allow.', 'Nothing ran for that step. An administrator must allow it, or the flow must change.'],
  integrity: ['The run\'s record does not verify, or the engine changed under it.', 'Do not trust this record. Start a fresh run.'],
  cancelled: ['Someone stopped it, or another step\'s problem stopped it.', 'Start a new run when ready.'],
  other: ['A step stopped with an error.', 'Open the step: its error and transcript say what happened.']
};
/** What a failure means and what a person can do, from the error code alone (and the engine's own remedy when its verdict carries one). */
export function remedyOf(error, { verdict = null } = {}) {
  if (!error?.code) return null;
  const cls = C.classifyError(error.code), known = failureText(error);
  const [what, next] = known && !/^Stopped with code /.test(known.what) ? [known.what, known.next] : CLASS_REMEDY[cls] ?? CLASS_REMEDY.other;
  return { code: error.code, class: cls, what, next: typeof verdict?.remedy === 'string' ? plain(verdict.remedy, 400) : next };
}

// --------------------------------------------------------------------------------------------------------- the fold
/** Fold a run's events into the reducer state. Events in chain order; the same reducer as tools/run-view (replay and live are one path). */
// The runtime's approval.decided event carries the approval id but no node key, so the reducer alone cannot attribute it: a refused or
// granted action would keep showing "needs you" (found by the differential evaluation, S10). The folder keeps the id -> node key map from
// approval.requested and attributes the decision (marked derivedNodeKey).
export function foldEvents(workflow, events, { model = null } = {}) {
  let m = model;
  if (!m) {
    m = new C.RunModel({ workflow }, { dispatchKnown: false });
    const raw = m.apply.bind(m), approvals = new Map();
    m.apply = ev => {
      if (ev.type === 'approval.requested' && ev.nodeKey) approvals.set(ev.approvalId, ev.nodeKey);
      if (ev.type === 'approval.decided' && !ev.nodeKey && approvals.has(ev.approvalId)) ev = { ...ev, nodeKey: approvals.get(ev.approvalId), derivedNodeKey: true };
      return raw(ev);
    };
  }
  for (const ev of events) m.apply(ev);
  return m;
}
const detailOf = inst => !inst ? 'idle' : inst.status === 'completed' && inst.verifyFalse ? 'checkdisagreed'
  : inst.status === 'failed' && inst.error?.code === 'APPROVAL_REJECTED' ? 'refused' : inst.state;
const executingOf = (status, executing) => executing ?? (status === 'running' ? null : false);
// Stalled: the run says running but no process holds it. Every working step then shows that, not a breathing dot.
// Stopped: once the run has stopped (including 'uncertain', which nothing resumes until a person reconciles it), a step that was still
// waiting for a person, a timer or a model is not waiting any more: the reducer only closes running steps (found by the differential
// evaluation: a failed run kept a question pulsing "needs you").
function effectiveDetail(detail, runStatus, executing) {
  if (runStatus === 'running' && executing === false && WORKING_DETAILS.has(detail) && !STILL.has(detail)) return 'stalled';
  if (STOPPED.has(runStatus) && (detail === 'needsyou' || WORKING_DETAILS.has(detail))) return 'cancelled';
  return detail;
}
// A group card shows its most urgent member: a person first, then a stopped process, then problems, then the reducer's own order.
function combine(details) {
  if (details.length === 1) return details[0];
  for (const d of ['needsyou', 'stalled', 'uncertain', 'failed', 'envfault', 'checkdisagreed']) if (details.includes(d)) return d;
  return C.combineStates(details.map(d => d === 'refused' ? 'cancelled' : d));     // the reducer's order does not know 'refused'
}
const tokensOf = ev => ({ input: ev.usage?.inputTokens ?? 0, output: ev.usage?.outputTokens ?? 0 });

// Per node key: model calls, tokens and cost from the chain's model.called / model.cancelled / recovered events (a journal row once).
function costIndex(events) {
  const byKey = new Map(), seen = new Set();
  for (const ev of events) {
    if (!['model.called', 'node.recovered_from_journal', 'model.cancelled'].includes(ev.type) || !ev.nodeKey) continue;
    if (ev.journalId != null) { if (seen.has(ev.journalId)) continue; seen.add(ev.journalId); }
    const c = byKey.get(ev.nodeKey) ?? { calls: 0, failedCalls: 0, usd: 0, imputedUsd: 0, inputTokens: 0, outputTokens: 0, models: {}, journalIds: [] };
    const t = tokensOf(ev);
    c.calls++; if (ev.ok === false || ev.type === 'model.cancelled') c.failedCalls++;
    c.usd += ev.costUsd ?? 0; c.imputedUsd += ev.imputedUsd ?? 0; c.inputTokens += t.input; c.outputTokens += t.output;
    if (ev.modelId) c.models[ev.modelId] = (c.models[ev.modelId] ?? 0) + 1;
    if (ev.journalId != null) c.journalIds.push(ev.journalId);
    byKey.set(ev.nodeKey, c);
  }
  return byKey;
}
// The same index from the model-call journal (src/journal.mjs forRun rows): the ledger of what was spent. It also holds a call whose row
// committed but whose chain event did not (the process died in between; S13), which the chain alone cannot show.
function costIndexFromJournal(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const c = byKey.get(r.nodeKey) ?? { calls: 0, failedCalls: 0, usd: 0, imputedUsd: 0, inputTokens: 0, outputTokens: 0, models: {}, journalIds: [] };
    c.calls++; if (r.ok === false) c.failedCalls++;
    c.usd += r.costUsd ?? 0; c.imputedUsd += r.imputedUsd ?? 0; c.inputTokens += r.inputTokens ?? 0; c.outputTokens += r.outputTokens ?? 0;
    if (r.modelId) c.models[r.modelId] = (c.models[r.modelId] ?? 0) + 1;
    c.journalIds.push(r.id);
    byKey.set(r.nodeKey, c);
  }
  return byKey;
}
const emptyCost = () => ({ calls: 0, failedCalls: 0, usd: 0, imputedUsd: 0, inputTokens: 0, outputTokens: 0, models: {}, journalIds: [] });
function addCost(into, c) {
  into.calls += c.calls; into.failedCalls += c.failedCalls; into.usd += c.usd; into.imputedUsd += c.imputedUsd; into.inputTokens += c.inputTokens; into.outputTokens += c.outputTokens;
  for (const [k, v] of Object.entries(c.models)) into.models[k] = (into.models[k] ?? 0) + v;
  into.journalIds.push(...c.journalIds);
  return into;
}
// The cost of a top-level node id: every node key under root/<id> (its own calls, a map's items, a loop's iterations).
function costUnder(index, top) {
  const out = emptyCost(), self = `root/${top}`;
  for (const [key, c] of index) if (key === self || key.startsWith(`${self}:`) || key.startsWith(`${self}/`)) addCost(out, c);
  return out;
}
const round = (n, d = 8) => Math.round(n * 10 ** d) / 10 ** d;
const publicCost = c => ({ usd: round(c.usd), imputedUsd: round(c.imputedUsd), calls: c.calls, failedCalls: c.failedCalls, inputTokens: c.inputTokens, outputTokens: c.outputTokens, models: c.models,
  journalIds: c.journalIds.slice(0, 50), moreJournalIds: Math.max(0, c.journalIds.length - 50) });

// ------------------------------------------------------------------------------------------------------- the failing step
const CHECK_INDEX = /(?:^|: )check (\d+) (failed|could not be evaluated)/;
// A node check reads the step's own answer as output.*; in words that is "this step's answer", not a step called "output".
const ANSWER = '__this_answer__';
const answerRefs = value => Array.isArray(value) ? value.map(answerRefs) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === '$ref' && typeof v === 'string' && /^output(\.|$)/.test(v) ? `nodes.${ANSWER}${v.slice(6)}` : answerRefs(v)])) : value;
export function nodeCheckText(check, workflow) {
  return checkText(answerRefs(check), new Map([...workflow.nodes.map(n => [n.id, n]), [ANSWER, { description: 'this step\'s answer' }]]));
}
/** The step that stopped the run and why, from the folded instances: the deepest failed instance, earliest first. */
export function failingOf(model, workflow, run, { checkpoint = null } = {}) {
  const failed = [...model.insts.values()].filter(i => ['failed', 'uncertain'].includes(i.status) && !(i.status === 'failed' && C.classifyError(i.error?.code) === 'cancelled') && i.error?.code !== 'APPROVAL_REJECTED');
  if (!failed.length) {
    if (run.error?.code === 'ACCEPTANCE_FAILED' || run.verdict?.code === 'ACCEPTANCE_FAILED') return { nodeKey: null, step: 'The definition of done', label: 'Definition of done', ...acceptanceCause(workflow, checkpoint), remedy: remedyOf(run.error ?? { code: 'ACCEPTANCE_FAILED' }) };
    if (run.error?.code && ['failed', 'uncertain'].includes(run.status)) return { nodeKey: null, step: null, label: null, code: run.error.code, message: plain(run.error.message, 300), remedy: remedyOf(run.error, { verdict: run.verdict }) };
    return null;
  }
  const isAncestor = (a, b) => b.key.startsWith(`${a.key}:`) || b.key.startsWith(`${a.key}/`);
  const leaves = failed.filter(f => !failed.some(g => g !== f && isAncestor(f, g)));
  leaves.sort((a, b) => (a.endedAt ?? Infinity) - (b.endedAt ?? Infinity) || a.key.localeCompare(b.key));
  const f = leaves[0], def = C.defOf(workflow, f.key), error = f.error ?? run.error ?? { code: 'ERROR', message: '' };
  // Which check: the runtime names the index in NODE_CHECK_FAILED and in model.resampled reasons (typed strings it writes, not model text).
  // After an escalation for a failed check it does not (record gap G2), so the answer is then "unknown", never a guess.
  let check = null;
  const fromMessage = CHECK_INDEX.exec(String(error.message ?? ''));
  const resampled = f.turns.filter(t => t.type === 'model.resampled' && CHECK_INDEX.test(String(t.reason ?? ''))).at(-1);
  const m = fromMessage ?? (resampled ? CHECK_INDEX.exec(resampled.reason) : null);
  const checkRelated = ['NODE_CHECK_FAILED', 'MODEL_ESCALATION_EXHAUSTED', 'VERIFY_FAILED', 'ASSERTION_FAILED'].includes(error.code) || f.checkFails > 0;
  if (m && def?.checks?.[Number(m[1])]) check = { index: Number(m[1]), text: nodeCheckText(def.checks[Number(m[1])], workflow), source: fromMessage ? 'node.failed' : 'model.resampled', known: true };
  else if (checkRelated && (def?.checks?.length ?? 0) > 0) check = { index: null, text: null, known: false, why: `The step has ${def.checks.length} check(s); the record does not say which one failed after an escalation (record gap G2).` };
  const remedy = f.status === 'uncertain' ? { code: error.code, class: 'uncertain', what: 'An action that is not safe to repeat stopped half-way: it may or may not have happened.', next: 'Check by hand (for example in the system it acts on) before running it again. It will not be retried automatically.' }
    : remedyOf(error, { verdict: run.verdict });
  return { nodeKey: f.key, step: def?.description ? plain(def.description, 200) : null, label: C.humanize(f.segs.at(-1).id), kind: def?.kind ?? f.kind ?? null,
    code: error.code, message: plain(error.message, 300), environmentFault: C.classifyError(error.code) === 'environment', uncertain: f.status === 'uncertain', check, remedy, otherFailures: leaves.length - 1 };
}
function acceptanceCause(workflow, checkpoint) {
  if (!checkpoint) return { code: 'ACCEPTANCE_FAILED', check: { known: false, why: 'The checkpoint was not available to evaluate the checks one by one.' } };
  const nodes = new Map(workflow.nodes.map(n => [n.id, n])), failedChecks = [];
  workflow.acceptance.forEach((c, i) => {
    let ok = null;
    try { ok = condition(c, { input: checkpoint.input, nodes: checkpoint.outputs ?? {} }) === true; } catch { ok = null; }
    if (ok === false) failedChecks.push({ index: i, text: checkText(c, nodes), plain: workflow.envelope?.successCriteria?.[i] ?? null });
  });
  return { code: 'ACCEPTANCE_FAILED', check: failedChecks.length ? { known: true, index: failedChecks[0].index, text: failedChecks[0].text, plain: failedChecks[0].plain, all: failedChecks } : { known: false, why: 'No single acceptance check evaluates to false on the stored outputs.' } };
}

// ------------------------------------------------------------------------------------------------------- the document
function cardOf(model, sem, rank, order, { costs, runStatus, executing, now }) {
  const details = sem.members.map(id => effectiveDetail(detailOf(model.insts.get(`root/${id}`)), runStatus, executing));
  const detail = combine(details), st = userState(detail, { executing: executing !== false && !TERMINAL.has(runStatus) });
  const cost = emptyCost(); for (const id of sem.members) addCost(cost, costUnder(costs, id));
  const agg = C.semAgg(model, sem), prog = C.semProgress(model, sem);
  const needs = [...model.insts.values()].filter(i => sem.members.includes(i.segs[0]?.id) && ['awaiting_human', 'awaiting_approval'].includes(i.status))
    .map(i => ({ nodeKey: i.key, kind: i.status === 'awaiting_human' ? 'question' : 'approval' }));
  let line = C.semLine(model, sem, now);
  if (detail === 'stalled') line = 'Its process stopped while this step ran. Resume the run to continue.';
  if (detail === 'checkdisagreed') line = 'The independent check did not pass. It did not stop the run.';
  if (detail === 'refused') line = 'You said no, so this action did not happen.';
  return { id: sem.id, label: plain(sem.label, 80), sub: plain(sem.sub, 160), role: sem.role, kinds: sem.kinds, members: sem.members, folded: sem.why, container: sem.container,
    rank, order, needs: sem.needs, state: st, line: plain(line, 200), progress: prog, cost: publicCost(cost),
    counts: { escalations: agg.escalations, retries: agg.retries, checkFails: agg.checkFails, failedItems: agg.failedItems, envFaults: agg.envFaults }, needsYou: needs };
}

/**
 * The run document. Inputs: the immutable workflow, the run header (src/store run record or its public header), the chain events in
 * order, and optional context. `executing`: whether a live process holds the run (the caller checks the owner; null = unknown).
 * `checkpoint`: the run record with outputs (lets the definition-of-done checks be named one by one). `level`: 0 simple, 1 normal, 2 raw.
 */
export function runGraph({ workflow, run, events, model = null, executing = null, checkpoint = null, level = 0, now = null, chain = null, hints = null, journal = null }) {
  const m = model ?? foldEvents(workflow, events);
  const status = run.status, exec = executingOf(status, executing);
  const at = now ?? m.run.now ?? run.updatedAt ?? 0;
  const sem = C.buildSemantic(workflow, { level, hints }), cols = C.layoutRanks(sem);
  const place = new Map(); cols.forEach((col, r) => col.forEach((id, o) => place.set(id, [r, o])));
  const referenced = new Set(events.filter(e => e.journalId != null).map(e => e.journalId));
  // The journal is used only when it holds every call the chain names (an external journal file the caller did not read would not).
  if (journal) { const ids = new Set(journal.map(r => r.id)); if ([...referenced].some(id => !ids.has(id))) journal = null; }
  const chainCosts = costIndex(events), costs = journal ? costIndexFromJournal(journal) : chainCosts;
  const unrecorded = journal ? journal.filter(r => !referenced.has(r.id)) : [];
  const cards = sem.nodes.map(s => cardOf(m, s, place.get(s.id)[0], place.get(s.id)[1], { costs, runStatus: status, executing: exec, now: at }));
  const total = emptyCost(); for (const c of costs.values()) addCost(total, c);
  const failing = ['failed', 'uncertain'].includes(status) || [...m.insts.values()].some(i => i.status === 'uncertain') ? failingOf(m, workflow, run, { checkpoint }) : null;
  const stopped = status === 'cancelled' && run.error ? remedyOf(run.error, { verdict: run.verdict }) : null;
  const waiting = [...m.insts.values()].filter(i => ['awaiting_human', 'awaiting_approval'].includes(i.status) && !STOPPED.has(status))
    .map(i => ({ nodeKey: i.key, kind: i.status === 'awaiting_human' ? 'question' : 'approval', step: plain(C.defOf(workflow, i.key)?.description ?? i.key, 200), card: sem.rawTo.get(i.segs[0]?.id) ?? null }));
  const ru = runUserState(status, { executing: exec });
  const topIds = workflow.nodes.map(n => n.id), doneTop = topIds.filter(id => ['done', 'handled', 'skipped', 'checkdisagreed'].includes(detailOf(m.insts.get(`root/${id}`)))).length;
  const doc = {
    schema: GRAPH_SCHEMA,
    run: { id: run.id, flowId: run.workflowId, title: plain(workflow.title, 120), workflowHash: run.workflowHash, version: workflow.version ?? null, status, state: ru, words: ru.words,
      executing: exec, createdAt: run.createdAt ?? null, updatedAt: run.updatedAt ?? null, durationMs: m.run.firstAt != null && m.run.now != null ? m.run.now - m.run.firstAt : null,
      steps: { total: topIds.length, finished: doneTop }, cost: { usd: round(total.usd), imputedUsd: round(total.imputedUsd), calls: total.calls, inputTokens: total.inputTokens, outputTokens: total.outputTokens, recordedRunCost: run.cost ?? null,
        source: journal ? 'journal' : 'chain', unrecordedCalls: unrecorded.length, unrecordedUsd: round(unrecorded.reduce((s, r) => s + (r.costUsd ?? 0), 0)),
        ...(unrecorded.length ? { note: 'Some model calls were paid for but the run\'s record does not show them yet (its process stopped right after the call). They are counted here.' } : {}) },
      verdict: run.verdict ? { verdict: run.verdict.verdict ?? null, code: run.verdict.code ?? null, establishesCompletion: run.verdict.establishesCompletion ?? false } : null,
      chain: chain ?? { events: events.length, head: events.at(-1)?.hash?.slice(0, 16) ?? events.at(-1)?.h ?? null, lastSeq: events.at(-1)?.seq ?? 0 },
      independentlyVerified: false },
    summary: null,
    graph: { level, foldedFrom: sem.rawCount, cards, edges: sem.edges, columns: cols.length },
    waiting,
    honesty: 'Done means the step finished and its own checks held; no step here is independently verified unless it says so. Model text is shown only in fields marked untrusted.'
  };
  doc.summary = { oneLine: oneLine(doc, failing, stopped), failing, stopped, waitingForYou: waiting.length };
  return doc;
}

const fmtUsd = n => n === 0 ? '$0' : n < 0.00001 ? 'under $0.00001' : n < 0.001 ? `$${n.toFixed(5)}` : n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
const noStop = text => String(text).replace(/[.\s]+$/, '');
/** One line for run history: what it is, how it ended or where it is, the failing step and cause in words, cost, and what waits for you. */
export function oneLine(doc, failing = doc.summary?.failing ?? null, stopped = doc.summary?.stopped ?? null) {
  const r = doc.run, head = r.state.detail === 'waiting' ? 'Waiting for a timer or a signal'
    : { done: 'Done', problem: 'Problem', needs_you: 'Needs you', working: 'Working', idle: r.status === 'cancelled' ? 'Stopped' : 'Not started' }[r.state.user] ?? r.status;
  const parts = [`${r.title}: ${r.state.detail === 'stalled' ? 'Stalled (no process is running it)' : head}`];
  if (failing) {
    const where = failing.label ? ` at “${failing.label}”` : '';
    const why = noStop(failing.remedy?.what ?? failing.code ?? 'an error');
    const check = failing.check?.known && failing.check.text ? ` (failed check: ${failing.check.text})` : '';
    parts[0] += `${where}: ${why}${check}`;
  }
  else if (stopped) parts[0] += `: ${noStop(stopped.what)}`;
  if (doc.waiting?.length) parts[0] += ` (${doc.waiting.length} waiting for you)`;
  const nums = [`${r.steps.finished} of ${r.steps.total} steps`, fmtUsd(r.cost.usd), r.cost.calls ? `${r.cost.calls} model call${r.cost.calls === 1 ? '' : 's'}` : null,
    Number.isFinite(r.durationMs) ? C.fmtDur(r.durationMs) : null].filter(Boolean);
  return `${parts[0]}. ${nums.join(', ')}.`;
}

// ------------------------------------------------------------------------------------------------------- one node
/** Everything a person needs on one node instance, in the order they need it. */
export function nodeDetail({ workflow, run, events, model = null, nodeKey, executing = null }) {
  const m = model ?? foldEvents(workflow, events);
  const inst = m.insts.get(nodeKey), def = C.defOf(workflow, nodeKey);
  if (!def) return null;
  const exec = executingOf(run.status, executing);
  const detail = effectiveDetail(detailOf(inst), run.status, exec), st = userState(detail, { executing: exec !== false && !TERMINAL.has(run.status) });
  const evs = inst?.turns ?? [];
  const compiled = evs.filter(e => e.type === 'context.compiled').at(-1);
  const completed = evs.filter(e => e.type === 'node.completed').at(-1);
  const costs = costIndex(events), cost = emptyCost();
  for (const [key, c] of costs) if (key === nodeKey || key.startsWith(`${nodeKey}:`) || key.startsWith(`${nodeKey}/`)) addCost(cost, c);
  const nodes = new Map(workflow.nodes.map(n => [n.id, n]));
  const error = inst?.error ?? null, remedy = error ? remedyOf(error, { verdict: run.verdict }) : null;
  const failingHere = error ? failingOf({ insts: new Map([[nodeKey, inst]]) }, workflow, run) : null;
  const checks = (def.checks ?? []).map((c, i) => ({ index: i, text: nodeCheckText(c, workflow),
    status: inst?.status === 'completed' ? 'passed' : failingHere?.check?.known && failingHere.check.index === i ? 'failed' : 'unknown' }));
  const calls = evs.filter(e => ['model.called', 'node.recovered_from_journal', 'model.cancelled'].includes(e.type))
    .map(e => ({ journalId: e.journalId ?? null, at: e.at, modelId: e.modelId ?? null, ok: e.type === 'model.cancelled' ? false : e.ok !== false, errorCode: e.errorCode ?? null,
      costUsd: e.costUsd ?? 0, inputTokens: e.usage?.inputTokens ?? 0, outputTokens: e.usage?.outputTokens ?? 0, latencyMs: e.latencyMs ?? null }));
  const kind = def.kind;
  const io = {
    inputs: compiled?.receipt?.inputs ? compiled.receipt.inputs.map(i => ({ name: plain(i.name, 80), ref: plain(i.ref ?? i.source ?? '', 120), label: i.label ?? i.trust ?? null, hash: typeof i.hash === 'string' ? i.hash.slice(0, 16) : null, tokens: i.tokens ?? null }))
      : kind === 'task' ? [{ name: 'arguments', tool: def.tool, hash: evs.find(e => e.type === 'tool.intent' || e.type === 'approval.requested')?.argsHash?.slice(0, 16) ?? null }] : [],
    output: completed ? { hash: completed.outputHash?.slice(0, 16) ?? null, bytes: completed.outputBytes ?? null, label: completed.outputLabel ?? null,
      value: completed.output === undefined ? null : fence(completed.output, 2000), fetch: completed.output === undefined && completed.seq != null ? `output/${completed.seq}` : null } : null,
    shape: ['code', 'task', 'assert'].includes(kind) ? 'input-to-output' : kind === 'agent' || (kind === 'verify' && def.method === 'agent') ? 'conversation' : kind
  };
  const container = inst?.cont ? { loop: inst.cont.loop, total: inst.cont.total, items: [...inst.cont.items.values()].slice(0, 200).map(it => ({ key: it.key, index: it.idx, state: userState(it.state === 'failed' ? 'failed' : it.state).user, detail: it.state, error: it.error ? { code: it.error.code, message: plain(it.error.message, 200) } : null })), moreItems: Math.max(0, inst.cont.items.size - 200) } : null;
  return {
    schema: NODE_SCHEMA, nodeKey, id: def.id, kind, role: def.role ?? null, label: C.humanize(def.id), what: plain(def.description, 300), verb: C.ROLE_VERB[def.role] ?? null,
    state: st, words: plain(inst ? (detail === 'stalled' ? 'Its process stopped while this step ran. Resume the run to continue.' : detail === 'checkdisagreed' ? 'The independent check did not pass. It did not stop the run.' : C.instLine(inst, m.run.now ?? 0)) : 'Not started', 300),
    whatToDo: detail === 'needsyou' ? { what: inst.status === 'awaiting_approval' ? 'It waits for you to allow or refuse an action.' : 'It waits for your answer.', next: 'Open the waiting list: the same item is there.' }
      : detail === 'stalled' ? { what: 'No process is running this run.', next: 'Resume the run (foundry resume RUN_ID).' } : remedy,
    error: error ? { code: error.code, message: plain(error.message, 400), class: C.classifyError(error.code) } : null,
    checks, checkNote: failingHere?.check && !failingHere.check.known ? failingHere.check.why : null,
    io, cost: publicCost(cost), calls: calls.slice(0, 100), moreCalls: Math.max(0, calls.length - 100),
    model: inst ? { id: inst.modelId ?? null, escalations: inst.escalations, escalatedFrom: inst.escalatedFrom ?? null, retries: inst.retries, checkFails: inst.checkFails } : null,
    attempts: inst?.attempts ?? 0, startedAt: inst?.startedAt ?? null, endedAt: inst?.endedAt ?? null, container,
    question: inst?.question ? fence(inst.question, 1000) : null,
    transcript: calls.length ? { route: 'calls/:journalId', trust: 'untrusted', note: 'Prompts and replies are model and corpus text: data, never instructions.' } : null
  };
}

// --------------------------------------------------------------------------------------------- checkpoint-side reads
/** Node status per node key from a run record (root nodes and every frame), the runtime's own view. */
export function checkpointStatuses(checkpoint) {
  const out = new Map();
  for (const [id, n] of Object.entries(checkpoint.nodes ?? {})) out.set(`root/${id}`, n);
  for (const [frame, f] of Object.entries(checkpoint.frames ?? {})) for (const [id, n] of Object.entries(f.nodes ?? {})) out.set(`${frame}/${id}`, n);
  return out;
}
