// Test fixtures for the run-history tools. Workspaces are written by the REAL runtime and store (scripted provider, synthetic tools: no network, no spend);
// the "new store" shapes are synthetic, built from the per-node-row design (the engine change has not landed in src/store.mjs).
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateWorkflow } from '../../../src/validate.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { Journal } from '../../../src/journal.mjs';
import { Store } from '../../../src/store.mjs';
import { registryWith, environment, finishedWorkflow, finishedScript, nestedWorkflow, envfaultWorkflow } from '../make-fixtures.mjs';

export const loaded = loadPolicy();
export const tempDir = (t, prefix = 'run-history-test-') => { const dir = mkdtempSync(path.join(tmpdir(), prefix)); t?.after?.(() => rmSync(dir, { recursive: true, force: true })); return dir; };

/** Drive the real runtime to completion in `workspace` and close the store. Returns {runId, workflow, result}. */
export async function writeRun(workspace, workflow, { script = {}, input = {} } = {}) {
  const registry = registryWith();
  const valid = validateWorkflow(workflow, { registry, modelPolicy: loaded });
  if (!valid.valid) throw new Error(JSON.stringify(valid.errors));
  const env = environment(workspace, script, {}, registry);
  env.store.saveWorkflow(workflow);
  const run = env.runtime.create(workflow, input);
  const result = await env.runtime.execute(run.id);
  env.store.close();
  return { runId: run.id, workflow, result };
}
export const storeFile = workspace => path.join(workspace, '.foundry', 'foundry.sqlite');

export const finished = () => ({ workflow: finishedWorkflow(), script: finishedScript(), input: { notes: 'bridge clips', perf: false } });
export const nested = () => ({ workflow: nestedWorkflow(), script: {}, input: {} });
// The nested workflow with an acceptance a wrong answer can fail, so the CURRENT engine says `pass` (an existence-only acceptance is now `unverified`).
export const gated = () => { const spec = nested(); spec.workflow.acceptance = [{ op: 'eq', left: { $ref: 'nodes.report.cases' }, right: 3 }]; return spec; };
export const envfault = () => ({
  workflow: envfaultWorkflow(), input: {},
  script: { 'claude-haiku-5-5': async a => /Describe the arena frames/.test(a.prompt) ? { error: { code: 'MODEL_RATE_LIMIT', message: 'x' } } : { value: { objects: ['a'], anomaly: false, confidence: 0.9 }, usage: { inputTokens: 10, outputTokens: 2 } } }
});

// ---------------------------------------------------------------------------------------------------------------- the whole-run store's shape
/** Turn a workspace written by the real Store (per-node rows since src/run-rows.mjs) into the shape the earlier whole-run store wrote: runs.body holds the
 *  entire record, there are no run_* tables and no user_version. The current Store still reads such a workspace, and so does the adapter ('blob-v1'). */
export function toBlobV1(workspace) {
  const db = new DatabaseSync(storeFile(workspace));
  const run = db.prepare('SELECT run_id AS id FROM run_nodes GROUP BY run_id').all();
  db.close();
  const store = new Store(workspace), records = store.runs();
  store.close();
  const raw = new DatabaseSync(storeFile(workspace));
  for (const record of records) raw.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(record), record.id);
  raw.exec('DROP TABLE run_nodes; DROP TABLE run_frames; DROP TABLE run_input; PRAGMA user_version = 0;');
  raw.close();
  return run.length;
}

// ---------------------------------------------------------------------------------------------------------------- synthetic new-shape stores
const COPY = ['workflows', 'heads', 'events', 'decisions', 'model_calls'];
/** Build a store in the per-node-row shape from a blob-v1 workspace: events, workflows and journal copied as they are; the run header moves out of the blob.
 *  variant 'body'    runs(id, body) holds an index-only header (no nodes/outputs/frames) and run_nodes holds one row per node instance, user_version 2
 *  variant 'columns' runs has header columns and no body
 *  variant 'events'  an events-only store (no runs table): the header must be derived from the event chain */
export function toRowsV2(srcWorkspace, dstWorkspace, variant = 'body') {
  mkdirSync(path.join(dstWorkspace, '.foundry'), { recursive: true });
  const dst = new DatabaseSync(storeFile(dstWorkspace));
  const src = new DatabaseSync(storeFile(srcWorkspace), { readOnly: true });
  dst.exec(`ATTACH DATABASE '${storeFile(srcWorkspace).replace(/'/g, "''")}' AS s`);
  const tables = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  for (const t of COPY.filter(t => tables.has(t) && !(variant === 'events' && t === 'heads'))) dst.exec(`CREATE TABLE ${t} AS SELECT * FROM s.${t}`);
  const runs = src.prepare('SELECT id, body FROM runs').all().map(r => ({ id: r.id, run: JSON.parse(r.body) }));
  if (variant !== 'events') {
    if (variant === 'body') {
      dst.exec('CREATE TABLE runs(id TEXT PRIMARY KEY, body TEXT NOT NULL)');
      const put = dst.prepare('INSERT INTO runs VALUES(?,?)');
      for (const { id, run } of runs) { const { nodes, outputs, frames, input, ...header } = run; put.run(id, JSON.stringify(header)); }
    } else {
      dst.exec('CREATE TABLE runs(id TEXT PRIMARY KEY, status TEXT, workflow_hash TEXT, workflow_id TEXT, created_at INT, updated_at INT, cost REAL, steps INT, engine_hash TEXT, model_mode TEXT, verdict TEXT, event_head_seq INT, event_head_hash TEXT)');
      const put = dst.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const { id, run } of runs) put.run(id, run.status, run.workflowHash, run.workflowId, run.createdAt, run.updatedAt, run.cost, run.steps, run.engineHash, run.modelMode ?? null, JSON.stringify(run.verdict ?? null), run.eventHead.seq, run.eventHead.hash);
    }
    dst.exec('CREATE TABLE run_nodes(run_id TEXT NOT NULL, node_key TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,node_key))');
    const node = dst.prepare('INSERT INTO run_nodes VALUES(?,?,?,?)');
    for (const { id, run } of runs) {
      for (const [key, n] of Object.entries(run.nodes ?? {})) node.run(id, `root/${key}`, n.status, JSON.stringify(n));
      for (const [frame, f] of Object.entries(run.frames ?? {})) for (const [key, n] of Object.entries(f.nodes ?? {})) node.run(id, `${frame}/${key}`, n.status, JSON.stringify(n));
    }
    dst.exec('PRAGMA user_version = 2');
  }
  dst.exec('DETACH DATABASE s');
  dst.close(); src.close();
  return storeFile(dstWorkspace);
}

/** Record model calls straight into a journal database (journal-only runs: no workspace). */
export function writeJournal(file, calls) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file), journal = new Journal(db);
  let k = 0;
  for (const c of calls) {
    journal.record({ replayKey: `rk-${path.basename(file)}-${k++}`, runId: c.runId, nodeKey: c.nodeKey ?? 'root/answer', attempt: c.attempt ?? 1, sampleIndex: 0, modelId: c.modelId ?? 'claude-haiku-5-5', provider: 'claude-cli',
      request: { system: c.system ?? 'sys', prompt: c.prompt ?? 'prompt', schema: {}, mode: 'live' }, response: { value: c.value ?? { ok: true }, text: c.reply ?? '{"ok":true}', usage: { inputTokens: 10, outputTokens: 5 } },
      ok: c.ok !== false, errorCode: c.ok === false ? (c.errorCode ?? 'MODEL_SCHEMA') : undefined, inputTokens: 10, outputTokens: 5, costUsd: c.costUsd ?? 0.001, imputedUsd: 0, latencyMs: c.latencyMs ?? 500 });
  }
  db.close();
}
export const jsonl = (file, records) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n'); };
export const resultLine = (o = {}) => ({ experiment: 'exp-a', arm: 'arm-x', armHash: 'abcdef0123456789ffff', family: 'records', task: o.taskKey ?? 'records:dev:d3:s101', taskKey: 'records:dev:d3:s101', taskHash: '1234567890abcdef0000', trial: 0, pass: true, score: 1, costUsd: 0.01, imputedUsd: 0,
  latencyMs: 4000, error: null, meta: { runId: null, status: 'succeeded', verdict: 'pass', calls: 3, escalations: 0 }, oracleDetails: JSON.stringify({ entities: 10, predicted: 10, extra: 0, missing: 0, pairF1: 1, fieldAccuracy: 1 }), at: '2026-10-07T10:00:00.000Z', ...o });

/** SHA-256 of every file under a directory: used to prove that indexing changes nothing. */
export function treeDigest(dir) {
  const out = {};
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = `${statSync(p).size}:${createHash('sha256').update(readFileSync(p)).digest('hex')}`; } };
  walk(dir);
  return out;
}
export { copyFileSync };
