// Replay harness (DESIGN §6.1): re-create a recorded run on the frozen kit from a COPY of its journal.
//
//   mode 'replay'          strict: a call missing from the journal fails with REPLAY_MISS, so nothing can spend
//   mode 'replay-or-live'  verification: unchanged nodes hit the journal, changed nodes go to the provider table (journaled)
//
// A recorded run is identified by its run id or by a trial key `ARM/TASKKEY/TRIAL` (e.g. F-haiku/records:test:d3:s6001/0).
// Run contents and task text are untrusted data: this module returns ids, scores and counts; callers decide what to print.
import path from 'node:path';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REPO, WORK_ROOT, loadKit, assertNotSealed, sha256 } from './kit.mjs';

const HAIKU = 'claude-haiku-5-5', HAIKU45 = 'claude-haiku-4-5-20251001', SONNET = 'claude-sonnet-5-5', OPUS = 'claude-opus-5-5';
// Recorded experiments the prototype can replay: where their results and journal are, which policy subset they ran with, and
// the runtime caps their arm used (experiments/lib/arms/foundry-workflow.mjs).
export const SOURCES = Object.freeze({
  'c0-dev': { dir: 'experiments/runs/c0-dev', results: ['results.jsonl', 'probes.jsonl'], journal: 'journal.sqlite', models: [HAIKU, SONNET, OPUS], runtime: { maxCost: 2, maxConcurrency: 8, maxDurationMs: 20 * 60 * 1000 } },
  p1: { dir: 'experiments/runs/p1', results: ['results.jsonl'], journal: 'journal.sqlite', models: [HAIKU, HAIKU45, SONNET], runtime: { maxCost: 2, maxConcurrency: 8, maxDurationMs: 20 * 60 * 1000 } },
});
export const TASK_KEY = /^([a-z0-9-]+):([a-z]+):d(\d+):s(\d+)$/;
const readJsonl = file => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

// Every recorded Foundry-workflow trial of a source (rows that carry a run id). Sealed families are refused at intake.
export function trialsOf(sourceId, { repo = REPO, sources = SOURCES } = {}) {
  const source = sources[sourceId];
  if (!source) throw new Error(`unknown source ${sourceId}`);
  const out = [];
  for (const file of source.results) {
    const full = path.join(repo, source.dir, file);
    if (!existsSync(full)) continue;
    for (const row of readJsonl(full)) {
      const m = TASK_KEY.exec(row.taskKey ?? row.task ?? '');
      if (!m || !row.meta?.runId) continue;
      if (/^sealed/.test(m[1]) || m[2] === 'sealed') continue;
      out.push({ source: sourceId, kind: file.replace(/\.jsonl$/, ''), key: `${row.arm}/${row.taskKey}/${row.trial}`, runId: row.meta.runId, armId: row.arm, family: m[1], split: m[2],
        difficulty: Number(m[3]), seed: Number(m[4]), taskKey: row.taskKey, trial: row.trial, pass: !!row.pass, score: row.score, taskHash: row.taskHash, costUsd: row.costUsd,
        latencyMs: row.latencyMs, calls: row.meta.calls, escalations: row.meta.escalations ?? 0, verdict: row.meta.verdict, experiment: row.experiment, row });
    }
  }
  return out;
}
export function allTrials(opts) { return Object.keys(opts?.sources ?? SOURCES).flatMap(s => trialsOf(s, opts)); }

// `ref` is a run id, or ARM/TASKKEY/TRIAL (`|` also separates). A task key alone (`records:test:d3:s6001#1`) is accepted when exactly one arm matches.
export function findTrial(ref, trials = allTrials()) {
  const byRun = trials.filter(t => t.runId === ref);
  if (byRun.length === 1) return byRun[0];
  const parts = String(ref).split(/[|/]/);
  if (parts.length === 3) { const hit = trials.filter(t => t.armId === parts[0] && t.taskKey === parts[1] && String(t.trial) === parts[2]); if (hit.length === 1) return hit[0]; }
  const m = /^(.+)#(\d+)$/.exec(String(ref));
  if (m) { const hit = trials.filter(t => t.taskKey === m[1] && String(t.trial) === m[2]); if (hit.length === 1) return hit[0]; if (hit.length > 1) throw new Error(`HEAL_TRIAL_AMBIGUOUS: ${ref} matches ${hit.map(t => t.key).join(', ')}`); }
  throw new Error(`HEAL_TRIAL_UNKNOWN: no recorded trial matches ${ref}`);
}

// The workflow a trial ran with is given by the caller (a JSON file, or a builder module); the harness proves it by replay fidelity.
export async function loadWorkflow(spec, { builderArgs = null } = {}) {
  if (spec && typeof spec === 'object') return structuredClone(spec);
  const file = path.resolve(spec);
  if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'));
  const mod = await import(pathToFileURL(file).href);
  const build = mod.default ?? mod.buildRecordsV3Workflow ?? mod.build;
  if (typeof build !== 'function') throw new Error(`HEAL_WORKFLOW_BUILDER: ${spec} exports no builder`);
  return build(builderArgs ?? undefined);
}
// P1's fhand-haiku workflow, exactly as experiments/p1/run.mjs built it.
export async function p1Workflow(cls = 'M') {
  const { buildRecordsV3Workflow } = await import(pathToFileURL(path.join(REPO, 'experiments/workflows/records-v3.mjs')).href);
  return buildRecordsV3Workflow({ extractModelClass: cls, conventionsModelClass: cls, maxClass: 'L', concurrency: 4, maxCost: 2, reasoning: 'none' });
}

// ---- contexts: one journal copy + port per worker --------------------------------------------------------------------
export async function openCtx(source, { name = 'ctx', scratch = path.join(WORK_ROOT, 'journals'), providers = {}, kit = null, journalFile = null, models = null } = {}) {
  kit ??= await loadKit();
  const src = SOURCES[source] ?? { models: models ?? [HAIKU, SONNET, OPUS], runtime: { maxCost: 2, maxConcurrency: 8, maxDurationMs: 20 * 60 * 1000 } };
  const file = journalFile ?? path.join(REPO, src.dir, src.journal);
  const copy = kit.copyJournal(file, path.join(scratch, `${source}-${name}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sqlite`));
  const policy = kit.sessionPolicy(models ?? src.models);
  const port = new kit.ModelPort({ policy, providers, journal: copy.journal, mode: 'replay', concurrency: { 'claude-cli': 8 } });
  const baseMaxId = copy.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM model_calls').get().m;
  return { kit, source, policy, port, journal: copy.journal, db: copy.db, file: copy.file, runtime: src.runtime, baseMaxId,
    close() { try { copy.db.close(); } catch { /* already closed */ } rmSync(copy.file, { force: true }); rmSync(`${copy.file}-wal`, { force: true }); rmSync(`${copy.file}-shm`, { force: true }); } };
}
// Every call a context made LIVE (a row it added that is not a replay of a recorded row: answered, failed or cancelled) is copied into a
// kept evidence journal before the throwaway copy is deleted. Review 2026-10-08: the V3/V4/V5 replicas of the live runs journaled their
// live calls only into copies that close() deletes, so the raw outputs behind "2 of 3 replicas pass", the node-check failures and the
// two bound-charged cancelled calls were gone; only the spend lines remained.
export function keepLiveRows(ctx, file, tag = null) {
  if (!file) return 0;
  const rows = ctx.db.prepare('SELECT * FROM model_calls WHERE id > ? ORDER BY id').all(ctx.baseMaxId ?? 0).filter(r => { try { const q = JSON.parse(r.request ?? '{}'); return !q.replayOf && q.heal !== 'counterfactual'; } catch { return true; } });
  if (!rows.length) return 0;
  mkdirSync(path.dirname(file), { recursive: true });
  const kept = ctx.kit.emptyJournal(file);   // creates the kit's journal schema
  try {
    const cols = Object.keys(rows[0]).filter(c => c !== 'id');
    const ins = kept.db.prepare(`INSERT INTO model_calls(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
    for (const r of rows) ins.run(...cols.map(c => c === 'request' && tag ? JSON.stringify({ ...JSON.parse(r.request ?? '{}'), healEvidence: tag }) : r[c]));
  } finally { kept.db.close(); }
  return rows.length;
}
export function setProviders(ctx, providers) { ctx.port.providers = providers; ctx.port.semaphores = new Map(); }

// ---- tasks, answers, cost --------------------------------------------------------------------------------------------
let beds;
export async function bedsLib() { return beds ??= await import(pathToFileURL(path.join(REPO, 'experiments/lib/beds.mjs')).href); }
export async function taskOf(trial) {
  assertNotSealed(trial);
  const { makeTasks } = await bedsLib();
  const [t] = await makeTasks(trial.family, { split: trial.split, seeds: [trial.seed], difficulty: trial.difficulty });
  return t;
}
export const inputOf = t => ({ prompt: t.task.prompt, inputs: t.task.inputs ?? {}, ...(t.task.files ? { files: t.task.files } : {}) });
export const answerOf = outputs => { const raw = outputs?.answer; return raw == null ? null : (raw.answer ?? raw); };
export async function oracleOf(family, task, answer) {
  if (answer == null) return { pass: false, score: 0, details: { noOutput: true } };
  const { score } = await bedsLib(); return score(family, task, answer);
}

// The dollar value of a run's calls as if none were replayed: a replay row costs 0, so charge the row it replays.
export function costs(journal, runId) {
  let live = 0, full = 0, liveCalls = 0, calls = 0;
  for (const r of journal.forRun(runId)) {
    calls++;
    let cost = r.costUsd, hops = 0, cur = r;
    while (cur.request?.replayOf && hops++ < 6) { const o = journal.get(cur.request.replayOf); if (!o) break; cur = o; cost = o.costUsd; }
    full += cost ?? 0;
    if (!r.request?.replayOf) { live += r.costUsd ?? 0; liveCalls++; }
  }
  const c = journal.costForRun(runId);
  return { liveUsd: live, fullUsd: full, liveCalls, calls, unknownCalls: c.costUnknownCalls ?? 0, unknownUpperUsd: c.costUnknownCalls ? (c.costUnknownUpperUsd ?? c.costUnknownEstimateUsd ?? 0) : 0 };
}

// ---- running one trial -----------------------------------------------------------------------------------------------
// Same Foundry construction as the probe and the C0/P1 arms: save the workflow, regenerate the task from its seed (the task hash
// must equal the recorded one), reuse the arm's sampleSalt. `salt` overrides it (a distinct reader tag per k-sample sibling uses it).
export async function replayRun(ctx, workflow, trial, { mode = 'replay', salt = null, task = null, maxCost = null, keepWorkspace = false, signal } = {}) {
  const t = task ?? await taskOf(trial);
  const root = path.join(WORK_ROOT, 'ws'); mkdirSync(root, { recursive: true });
  const ws = mkdtempSync(path.join(root, 'ws-'));
  const { kit } = ctx;
  const foundry = new kit.Foundry(ws, { models: ctx.port, modelPolicy: ctx.policy, policy: { ...ctx.runtime, ...(maxCost ? { maxCost } : {}) } });
  const started = Date.now();
  try {
    // The immutable evaluation staging keeps the candidate's exact version and hash (the store's head rules would insist on version 1);
    // createRun validates the workflow against the policy and registry again.
    const saved = foundry.store.stageEvaluationWorkflow(workflow);
    const run = foundry.createRun(saved.hash, inputOf(t), { sampleSalt: salt ?? `${trial.armId}:t${trial.trial}`, modelMode: mode });
    const done = await foundry.runtime.execute(run.id, { signal });
    const answer = answerOf(done.outputs);
    const oracle = await oracleOf(trial.family, t.task, answer);
    const events = foundry.store.events(run.id).filter(e => /^model\.|^node\.(failed|resumed)|^run\.(failed|verdict)/.test(e.type))
      .map(e => ({ type: e.type, nodeKey: e.nodeKey ?? null, rule: e.rule ?? null, from: e.fromModel ?? null, to: e.toModel ?? null, errorCode: e.errorCode ?? null, replayed: e.replayed ?? null }));
    return { runId: run.id, workflowHash: saved.hash, taskHash: t.taskHash, taskKey: t.taskKey, status: done.status, error: done.error ? { code: done.error.code, message: String(done.error.message ?? '').slice(0, 300), details: done.error.details ?? null } : null,
      verdict: done.verdict?.verdict ?? null, pass: !!oracle.pass, score: oracle.score ?? 0, oracleDetails: oracle.details ?? null, ms: Date.now() - started, ...costs(ctx.journal, run.id),
      outputs: done.outputs ?? {}, frames: done.frames ?? {}, nodes: done.nodes ?? {}, answer, events, run: done };
  } finally { await foundry.close(); if (!keepWorkspace) rmSync(ws, { recursive: true, force: true }); }
}

// Does a replay of the recorded trial reproduce the record? (DESIGN §5 step 1.) `full` = also the model-call count.
export function fidelity(trial, r) {
  const checks = { taskHash: r.taskHash === trial.taskHash, pass: r.pass === trial.pass, score: Math.abs((r.score ?? 0) - (trial.score ?? 0)) < 1e-6, verdict: r.verdict === trial.verdict, calls: r.calls === trial.calls };
  return { identical: Object.values(checks).every(Boolean), checks };
}

// ---- substitution ----------------------------------------------------------------------------------------------------
// Refs a node reads: code args, or an agent's context inputs. A pinned node must keep them, otherwise the taint label of its
// output changes the downstream prompt and replay misses (P-1).
export const readsOf = n => n.kind === 'code' ? (n.args ?? {}) : Object.fromEntries((n.context?.inputs ?? []).filter(i => i.ref).map((i, k) => [`r${k}`, { $ref: i.ref }]));
export const pinNode = (workflow, id, value, { keepReads = true } = {}) => ({ ...workflow, nodes: workflow.nodes.map(n => n.id !== id ? n : { id, kind: 'code', lang: 'js',
  needs: n.needs ?? [], description: `heal counterfactual pin of ${id}`, args: keepReads ? readsOf(n) : {},
  source: `export default function main() { return ${JSON.stringify(value)}; }`, timeoutMs: 20000 }) });

// Journal injection (copies only): a newer row with the same replay key wins Journal.lookup (ORDER BY id DESC). The node's own
// checks and escalation stay live, which pin cannot do.
export function injectRow(db, id, value) {
  const r = db.prepare('SELECT * FROM model_calls WHERE id=?').get(id), cols = Object.keys(r).filter(c => c !== 'id');
  const { lastInsertRowid } = db.prepare(`INSERT INTO model_calls(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(c =>
    c === 'response' ? JSON.stringify({ ...JSON.parse(r.response), value, heal: { counterfactualOf: id } })
      : c === 'request' ? JSON.stringify({ ...JSON.parse(r.request ?? '{}'), heal: 'counterfactual' }) : c === 'cost_usd' ? 0 : r[c]));
  return Number(lastInsertRowid);
}
export const uninject = (db, id) => db.prepare("DELETE FROM model_calls WHERE json_extract(response,'$.heal.counterfactualOf')=?").run(id);
export const sameKeyCount = (db, id) => db.prepare('SELECT COUNT(*) n FROM model_calls WHERE replay_key=(SELECT replay_key FROM model_calls WHERE id=?) AND ok=1').get(id).n;

// The calls of a recorded run that produced a node's accepted value: per node key, the last ok row (escalations and resamples
// come first, the accepted answer last).
export function acceptedCalls(journal, runId) {
  const last = new Map();
  for (const r of journal.forRun(runId)) if (r.ok && !r.request?.replayOf && !r.response?.heal) last.set(r.nodeKey, r);
  return [...last.values()];
}

// Node lookup by id anywhere in the workflow (root or map/loop bodies).
export function findNode(workflow, id, trail = []) {
  for (const n of workflow.nodes ?? []) {
    if (n.id === id) return { node: n, trail, flow: workflow };
    if (n.body) { const r = findNode(n.body, id, [...trail, n.id]); if (r) return r; }
  }
  return null;
}
export const nodeIdOfKey = key => String(key).split('/').pop();
export const workflowSha = workflow => sha256(JSON.stringify(workflow)).slice(0, 16);

// Bounded parallel map (results keep input order).
export async function pmap(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
