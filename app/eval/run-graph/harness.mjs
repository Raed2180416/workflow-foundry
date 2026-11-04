// The run-graph evaluation harness: record real runtime runs with a checkpoint snapshot at every committed update, then score what each
// arm would tell a person at every one of those moments against an oracle read from the runtime's own records (the checkpoint and the
// model-call journal), never from the event reducer the arms share.
//
// Arms
//   T    app/core/run-graph.mjs (this work)
//   B1   tools/run-view's reducer as the prototype shows it: its sixteen states in five words, no owner check, the first red card as "the cause"
//   B0   app/dashboard today: run status words, explainRun's failed step (top level only), inbox approvals of runs whose status is awaiting_approval
//   C+   the oracle itself (must score 100%: checks the scorer)
//   C-   T with its states, waiting list and cause blanked (must score far below T: checks the scorer has teeth)
// Questions (the persona tasks of the plan, as data): Q-state (what is each step doing), Q-run (what is the run doing), Q-wait (what waits
// for me), Q-fail (which step failed and with what code), Q-cost (what did each step cost), Q-line (does the one-line summary name the
// failing step and the cost).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { environment } from '../../../tools/run-view/make-fixtures.mjs';
import { validateWorkflow } from '../../../src/validate.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { Store } from '../../../src/store.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ownerAlive } from '../../../src/runtime.mjs';
import { explainRun } from '../../core/explain.mjs';
import * as Real from '../../core/run-graph.mjs';
import { scenarioRegistry } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const policy = loadPolicy();
const C = globalThis.RunViewCore;
const RUN_TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);

// ------------------------------------------------------------------------------------------------------------- recording
function answerFor(schema, yes) {
  if (schema?.type === 'boolean') return yes;
  if (schema?.type === 'object') return Object.fromEntries((schema.required ?? []).map(k => [k, schema.properties[k]?.type === 'boolean' ? yes : schema.properties[k]?.type === 'string' ? 'ok' : 1]));
  return yes;
}
/** Run one scenario in `dir` and keep a checkpoint snapshot after every committed update (the oracle's view at that moment). */
export async function record(dir, sc, { maxRounds = 4 } = {}) {
  mkdirSync(dir, { recursive: true });
  if (sc.crashAfterModel) return recordCrash(dir, sc);
  const registry = sc.registry ?? scenarioRegistry();
  const validation = validateWorkflow(sc.workflow, { registry, modelPolicy: policy });
  if (!validation.valid) return { invalid: validation.errors.slice(0, 3) };
  const env = environment(dir, sc.script, {}, registry);
  env.store.saveWorkflow(sc.workflow);
  const commits = [];
  let runId = null;
  const original = env.store.updateRun.bind(env.store);
  env.store.updateRun = (id, ...rest) => { const out = original(id, ...rest); if (id === runId) { const snap = env.store.run(id); commits.push({ seq: snap.eventHead.seq, run: snap, executing: !!snap.owner }); } return out; };
  const run = env.runtime.create(sc.workflow, sc.input ?? {});
  runId = run.id;
  { const snap = env.store.run(runId); commits.push({ seq: snap.eventHead.seq, run: snap, executing: false }); }
  try {
    if (sc.drive) await sc.drive(env, run);
    else {
      await env.runtime.execute(runId).catch(() => {});
      for (let round = 0; round < maxRounds; round++) {
        const cp = env.store.run(runId), d = sc.decisions?.[round];
        if (!d || !['awaiting_human', 'awaiting_approval'].includes(cp.status)) break;
        let acted = false;
        for (const { frameKey, nodeId, state } of env.store.rows.withStatus(runId, 'awaiting_human')) if (d.answer) { env.runtime.answer(runId, `${frameKey}/${nodeId}`, answerFor(state.answerSchema, d.answerTrue)); acted = true; }
        for (const a of Object.values(env.store.run(runId).approvals ?? {}).filter(a => a.status === 'pending')) { env.runtime.approve(runId, a.id, d.approve, 'user'); acted = true; if (!d.approve) break; }
        if (!acted) break;
        if (RUN_TERMINAL.has(env.store.run(runId).status)) break;
        await env.runtime.execute(runId).catch(() => {});
      }
    }
  } finally { env.store.updateRun = original; }
  const out = { runId, workflow: sc.workflow, commits, events: env.store.events(runId), journal: env.models.journal.forRun(runId), final: env.store.run(runId), store: env.store, registry };
  return out;
}
function recordCrash(dir, sc) {
  const child = spawnSync(process.execPath, [path.join(here, 'crash-child.mjs'), dir, sc.name], { encoding: 'utf8', timeout: 60000 });
  const runId = child.stdout.split('\n')[0].trim();
  const store = new Store(dir), journal = new Journal(store);
  const final = store.run(runId);
  return { runId, workflow: sc.workflow, commits: [{ seq: final.eventHead.seq, run: final, executing: ownerAlive(final.owner ?? { pid: -1 }) && !!final.owner }], events: store.events(runId),
    journal: journal.forRun(runId), final, store, crashed: child.signal === 'SIGKILL' };
}

// ------------------------------------------------------------------------------------------------------------- the oracle
const statusesOf = cp => Real.checkpointStatuses(cp);
const defOf = (workflow, key) => C.defOf(workflow, key);
const approvedFor = (cp, key) => Object.values(cp.approvals ?? {}).some(a => a.nodeKey === key && a.status === 'approved');
function ownTruth(cp, workflow, key, st, executing) {
  const terminal = RUN_TERMINAL.has(cp.status);
  if (!st) return 'idle';
  switch (st.status) {
    case 'completed': {
      const def = defOf(workflow, key), frame = key.slice(0, key.lastIndexOf('/')), id = key.slice(key.lastIndexOf('/') + 1);
      const outputs = frame === 'root' ? cp.outputs : cp.frames?.[frame]?.outputs;
      return def?.kind === 'verify' && outputs?.[id]?.pass === false ? 'problem' : 'done';
    }
    case 'handled_error': return 'done';
    case 'skipped': case 'cancelled': return 'idle';
    // A step stopped because another one failed (CANCELLED), or whose action the person refused, did not run: not a problem of its own.
    case 'failed': return st.error?.code === 'CANCELLED' || Object.values(cp.approvals ?? {}).some(a => a.nodeKey === key && a.status === 'rejected') ? 'idle' : 'problem';
    case 'uncertain': return 'problem';
    case 'awaiting_human': case 'awaiting_approval': return terminal ? 'idle' : 'needs_you';
    case 'running': case 'waiting': case 'waiting_child': return terminal ? 'idle' : cp.status === 'running' && executing === false && st.status === 'running' ? 'problem' : 'working';
    case 'pending': return !terminal && ((st.attempts ?? 0) > 0 || approvedFor(cp, key)) ? 'working' : 'idle';
    default: return 'idle';
  }
}
/** What a person should be told about top-level node `id`, from the checkpoint alone. A container that is still working shows its most urgent part. */
export function truthNode(cp, workflow, id, executing, statuses = statusesOf(cp)) {
  const key = `root/${id}`, own = ownTruth(cp, workflow, key, statuses.get(key), executing);
  if (own !== 'working') return own;
  let best = own;
  for (const [k, st] of statuses) if (k.startsWith(`${key}:`)) { const t = ownTruth(cp, workflow, k, st, executing); if (t === 'needs_you') return 'needs_you'; if (t === 'problem') best = 'problem'; }
  return best;
}
export function truthRun(cp, executing) {
  return { succeeded: 'done', failed: 'problem', uncertain: 'problem', cancelled: 'idle', awaiting_human: 'needs_you', awaiting_approval: 'needs_you', waiting: 'working',
    running: executing === false ? 'problem' : 'working', ready: executing ? 'working' : 'idle' }[cp.status] ?? 'idle';
}
export function truthWaiting(cp) {
  if (RUN_TERMINAL.has(cp.status)) return [];
  return [...statusesOf(cp)].filter(([, s]) => ['awaiting_human', 'awaiting_approval'].includes(s.status)).map(([k, s]) => `${s.status === 'awaiting_human' ? 'question' : 'approval'}:${k}`).sort();
}
export function truthFailing(cp) {
  if (!['failed', 'uncertain'].includes(cp.status)) return null;
  const st = statusesOf(cp), bad = [...st].filter(([, s]) => (s.status === 'failed' && s.error?.code !== 'CANCELLED') || s.status === 'uncertain');
  const leaves = bad.filter(([k]) => !bad.some(([j]) => j !== k && (j.startsWith(`${k}:`) || j.startsWith(`${k}/`))));
  return { leaves: new Map(leaves.map(([k, s]) => [k, s.error?.code ?? null])), runCode: cp.error?.code ?? null };
}
export function truthCost(journal, id) {
  const key = `root/${id}`;
  return journal.filter(r => r.nodeKey === key || r.nodeKey.startsWith(`${key}:`) || r.nodeKey.startsWith(`${key}/`)).reduce((s, r) => s + (r.costUsd ?? 0), 0);
}

// ------------------------------------------------------------------------------------------------------------- the arms
const B1_USER = { idle: 'idle', skipped: 'idle', cancelled: 'idle', queued: 'working', calling: 'working', running: 'working', retrying: 'working', escalated: 'working', checkfailed: 'working', waiting: 'working', needsyou: 'needs_you', failed: 'problem', envfault: 'problem', uncertain: 'problem', done: 'done', handled: 'done' };
const STATUS_USER = { succeeded: 'done', failed: 'problem', uncertain: 'problem', cancelled: 'idle', awaiting_human: 'needs_you', awaiting_approval: 'needs_you', running: 'working', waiting: 'working', ready: 'idle' };

/** Every arm's answers at one moment. `G` is the run-graph module (the real one, or a mutant). */
export function answers(G, { workflow, cp, events, model, b1Model = model, executing, journal = null, only = null }) {
  const ids = workflow.nodes.map(n => n.id), out = {};
  const doc = G.runGraph({ workflow, run: cp, events, model, executing, checkpoint: cp, level: 2, journal });
  const card = new Map(doc.graph.cards.map(c => [c.id, c]));
  out.T = { nodes: Object.fromEntries(ids.map(id => [id, card.get(id)?.state.user ?? 'idle'])), run: doc.run.state.user,
    waiting: doc.waiting.map(w => `${w.kind}:${w.nodeKey}`).sort(), failing: doc.summary.failing ? { nodeKey: doc.summary.failing.nodeKey, code: doc.summary.failing.code ?? null } : null,
    cost: Object.fromEntries(ids.map(id => [id, card.get(id)?.cost.usd ?? 0])), line: doc.summary.oneLine, failingLabel: doc.summary.failing?.label ?? null, checkKnown: doc.summary.failing?.check?.known ?? null };
  if (only === 'T') return out;
  model = b1Model;
  const inst = id => model.insts.get(`root/${id}`);
  const red = ids.find(id => ['failed', 'envfault', 'uncertain'].includes(inst(id)?.state));
  out.B1 = { nodes: Object.fromEntries(ids.map(id => [id, B1_USER[inst(id)?.state ?? 'idle']])), run: STATUS_USER[model.run.status === 'ready' ? (cp.status ?? 'ready') : model.run.status] ?? 'idle',
    waiting: [...model.insts.values()].filter(i => ['awaiting_human', 'awaiting_approval'].includes(i.status) && !RUN_TERMINAL.has(model.run.status)).map(i => `${i.status === 'awaiting_human' ? 'question' : 'approval'}:${i.key}`).sort(),
    failing: ['failed', 'uncertain'].includes(cp.status) ? (red ? { nodeKey: `root/${red}`, code: inst(red).error?.code ?? null } : null) : null,
    cost: Object.fromEntries(ids.map(id => [id, inst(id)?.agg.costUsd ?? 0])), line: null };
  const ex = explainRun(cp, workflow), failedId = Object.entries(cp.nodes ?? {}).find(([, s]) => ['failed', 'uncertain'].includes(s.status))?.[0] ?? null;
  out.B0 = { nodes: null, run: STATUS_USER[cp.status] ?? 'idle',
    waiting: cp.status === 'awaiting_approval' ? ex.pendingApprovals.map(a => `approval:${cp.approvals[a.approvalId].nodeKey}`).sort() : [],
    failing: ['failed', 'uncertain'].includes(cp.status) ? { nodeKey: failedId ? `root/${failedId}` : null, code: cp.error?.code ?? null } : null,
    cost: null, line: `${({ succeeded: 'Done', failed: 'Problem', awaiting_approval: 'Needs your OK', awaiting_human: 'Needs your answer', cancelled: 'Stopped', uncertain: 'Check by hand', running: 'Running', waiting: 'Waiting' })[cp.status] ?? cp.status}${ex.problem ? ` — ${ex.problem.what}` : ''}` };
  return out;
}

// ------------------------------------------------------------------------------------------------------------- scoring
const newTally = () => ({ n: 0, ok: 0 });
const bump = (t, ok) => { t.n++; if (ok) t.ok++; };
export function newScore() { return { state: newTally(), stateLive: newTally(), run: newTally(), wait: newTally(), waitFalseAlarm: newTally(), waitMissed: newTally(), fail: newTally(), failDeep: newTally(), cost: newTally(), costAll: newTally(), line: newTally(), na: {} }; }
const failingRight = (ans, truth) => {
  if (!truth) return ans === null;
  if (!ans) return false;
  if (truth.leaves.size === 0) return ans.nodeKey === null && ans.code === truth.runCode;
  return truth.leaves.has(ans.nodeKey) && truth.leaves.get(ans.nodeKey) === ans.code;
};
const failingTop = (ans, truth) => {           // a weaker reading: names the right top-level step (or the run-level code)
  if (!truth || !ans) return !truth && !ans;
  if (truth.leaves.size === 0) return ans.nodeKey === null;
  const tops = new Set([...truth.leaves.keys()].map(k => k.split('/')[1].replace(/:\d+$/, '')));
  return ans.nodeKey !== null && tops.has(ans.nodeKey.split('/')[1].replace(/:\d+$/, ''));
};
/** Score one arm's answers at one moment against the oracle. `final`: the last moment of a run (cost, failure and line are scored there). */
export function score(sc, arm, a, truth, { final }) {
  // stateLive: only the steps that are not plain "done" or "not running" (the moments a person looks at a live run for).
  if (a.nodes) for (const [id, t] of Object.entries(truth.nodes)) { bump(sc.state, a.nodes[id] === t); if (!['done', 'idle'].includes(t)) bump(sc.stateLive, a.nodes[id] === t); }
  else { sc.na.state = true; sc.na.stateLive = true; }
  bump(sc.run, a.run === truth.run);
  const w = a.waiting ?? [];
  bump(sc.wait, JSON.stringify(w) === JSON.stringify(truth.waiting));
  if (!truth.waiting.length) bump(sc.waitFalseAlarm, w.length === 0);
  for (const k of truth.waiting) bump(sc.waitMissed, w.includes(k));
  if (!final) return;
  if (truth.failing || a.failing) { bump(sc.fail, failingTop(a.failing, truth.failing)); bump(sc.failDeep, failingRight(a.failing, truth.failing)); }
  // cost: the steps that spent money (most steps spend $0, which every arm "gets right"); costAll: every step.
  if (a.cost) { for (const [id, c] of Object.entries(truth.cost)) { const ok = Math.abs((a.cost[id] ?? 0) - c) < 1e-9; bump(sc.costAll, ok); if (c > 0) bump(sc.cost, ok); } }
  else { sc.na.cost = true; sc.na.costAll = true; }
  if (a.line !== null && a.line !== undefined) {
    const needs = [];
    if (truth.failing?.leaves.size) needs.push(a.failingLabel && a.line.includes(a.failingLabel));
    needs.push(/\$|under \$/.test(a.line));
    bump(sc.line, needs.every(Boolean));
  } else sc.na.line = true;
}
export function truthAt(workflow, cp, journal, executing) {
  const ids = workflow.nodes.map(n => n.id), statuses = statusesOf(cp);
  return { nodes: Object.fromEntries(ids.map(id => [id, truthNode(cp, workflow, id, executing, statuses)])), run: truthRun(cp, executing), waiting: truthWaiting(cp),
    failing: truthFailing(cp), cost: Object.fromEntries(ids.map(id => [id, truthCost(journal, id)])) };
}
const oracleArm = (truth) => {
  const key = truth.failing?.leaves.size ? [...truth.failing.leaves.keys()][0] : null, label = key ? C.humanize(key.split('/').at(-1).replace(/:\d+$/, '')) : null;
  return { nodes: truth.nodes, run: truth.run, waiting: truth.waiting,
    failing: truth.failing ? (key ? { nodeKey: key, code: truth.failing.leaves.get(key) } : { nodeKey: null, code: truth.failing.runCode }) : null,
    cost: truth.cost, line: `${label ?? ''} $`, failingLabel: label };
};
const blankArm = (a) => ({ ...a, nodes: Object.fromEntries(Object.keys(a.nodes).map(k => [k, 'done'])), run: 'done', waiting: [], failing: null, cost: Object.fromEntries(Object.keys(a.cost).map(k => [k, 0])), line: 'nothing' });

/**
 * Score a recorded run for every arm at every committed moment. Mutants: { name: module } scored like T.
 * Moments: every commit (live view), the last one is `final`. The journal used for cost truth is the journal at the end of the run.
 */
export function evaluateRecording(rec, { scores, mutants = {}, perRun = null, onMoment = null }) {
  const { workflow, commits, events, journal } = rec;
  // B1 folds with the prototype's reducer as it is (no attribution of approval decisions); T and each mutant with their own folder.
  const models = { T: Real.foldEvents(workflow, []), B1: new C.RunModel({ workflow }, { dispatchKnown: false }), ...Object.fromEntries(Object.entries(mutants).map(([k, G]) => [k, G.foldEvents(workflow, [])])) };
  let applied = 0;
  commits.forEach((c, i) => {
    const final = i === commits.length - 1;
    while (applied < c.seq) { const ev = events[applied++]; for (const m of Object.values(models)) m.apply(ev); }
    // The journal is read with the run at the end (the server reads it with the run); during the run T reads the chain only.
    const prefix = events.slice(0, c.seq), truth = truthAt(workflow, c.run, journal, c.executing), j = final ? journal : null;
    const base = answers(Real, { workflow, cp: c.run, events: prefix, model: models.T, b1Model: models.B1, executing: c.executing, journal: j });
    const arms = { T: base.T, B1: base.B1, B0: base.B0, 'C+': oracleArm(truth), 'C-': blankArm(base.T) };
    for (const [k, G] of Object.entries(mutants)) arms[k] = answers(G, { workflow, cp: c.run, events: prefix, model: models[k], executing: c.executing, journal: j, only: 'T' }).T;
    for (const [arm, a] of Object.entries(arms)) { scores[arm] ??= newScore(); score(scores[arm], arm, a, truth, { final }); }
    if (onMoment) onMoment({ seq: c.seq, status: c.run.status, executing: c.executing, truth, arms, final });
    if (perRun && final) perRun({ truth, arms });
  });
}
export const pct = t => t.n ? Math.round(1000 * t.ok / t.n) / 10 : null;
