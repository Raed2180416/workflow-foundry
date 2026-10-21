// Run one SOP workflow (a solve.mjs on flow-v3 with tools/sop.mjs) on one row: the W-H arm's execution path
// (research/sopbench-20261021/DESIGN.md §2, §5). The run directory holds only the workflow's files, task.json (inputs, no
// answer), the SDK files and the mailbox; the solver runs in the execution sandbox with NO network (runSandboxed): the
// SOP's tools through the bridge's file mailbox, model judgments (flow.judge) through the host gateway's unix socket, on a
// per-run budget, models restricted to the configured judge ids. Its printed answer becomes the same <final_output> text
// the agent arm produces and is graded by the same graders.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runSandboxed } from '../../src/executors/sandboxed-command.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { MODEL_TOOL } from '../c0/construct.mjs';
import { HERE, REPO, SPLIT_FILE, UPSTREAM, readJson, sha256, startServe } from './lib.mjs';
import { finalOutputText } from './scorer.mjs';

export const FLOW_SDK = path.join(REPO, 'experiments/jit/flow-v3.mjs');
export const SOP_PORT = path.join(HERE, 'kit/sop.mjs');
export const DEOPT_EXIT = 75;
/** Workflow-arm protocol constants (frozen with the workflows). */
export const W_DEFAULTS = Object.freeze({ maxSteps: 40, budgetUsd: 0.05, timeoutMs: 180_000 });

/** The output schema every workflow answer must satisfy: each output column, a string or null, nothing else. */
export const outputSchemaOf = cols => ({ type: 'object', required: cols, properties: Object.fromEntries(cols.map(c => [c, { type: ['string', 'null'] }])), additionalProperties: false });

/** The files of a workflow artifact: solve.mjs plus anything under lib/ or sections/ (relative path -> text). */
export function artifactFiles(dir) {
  const out = {};
  const walk = rel => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && /\.(mjs|js|json)$/.test(e.name)) out[r] = readFileSync(path.join(dir, r), 'utf8');
    }
  };
  if (!existsSync(path.join(dir, 'solve.mjs'))) return null;
  out['solve.mjs'] = readFileSync(path.join(dir, 'solve.mjs'), 'utf8');
  for (const sub of ['lib', 'sections']) if (existsSync(path.join(dir, sub))) walk(sub);
  return out;
}
/** sha256 of an artifact: canonical JSON of {path: sha256(text)} sorted by path. */
export const artifactSha256 = files => sha256(JSON.stringify(Object.keys(files).sort().map(k => [k, sha256(files[k])])));

/** The SDK files a run directory (or a builder workdir) gets under tools/; sdkDir: a frozen copy (flow.mjs, model.mjs, sop.mjs). */
export function sdkFiles({ catalog, outputColumns, gateway, sdkDir = null }) {
  return {
    'tools/flow.mjs': readFileSync(sdkDir ? path.join(sdkDir, 'flow.mjs') : FLOW_SDK, 'utf8'),
    'tools/model.mjs': sdkDir ? readFileSync(path.join(sdkDir, 'model.mjs'), 'utf8') : MODEL_TOOL,
    'tools/sop.mjs': readFileSync(sdkDir ? path.join(sdkDir, 'sop.mjs') : SOP_PORT, 'utf8'),
    'tools/catalog.json': JSON.stringify(catalog, null, 1),
    'tools/output-schema.json': JSON.stringify(outputSchemaOf(outputColumns), null, 1),
    'tools/gateway.json': JSON.stringify(gateway),
  };
}
export const writeFiles = (dir, files) => { for (const [rel, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text); } };

/** The task a workflow sees: the prepared row without its hash (no answer is ever in it). */
export const workflowTask = t => ({ sop: t.sop, row: t.row, inputs: t.inputs, task_text: t.task_text, output_columns: t.output_columns });

/**
 * runWorkflowRow(o) -> { status: done|deopt|crash|timeout|env, answer, answerText, costUsd, judgeCalls, steps, toolCalls, sections, deopt, ... }
 * o: { files (artifact), prepDir (bridge prepare output for the SOP), sop, row, live, tag, world ('build'|'dev'), sealed, freeze,
 *      modelPort (null: no model access), judgeModels, budgetUsd, timeoutMs, maxSteps, keep, split, upstream, dataDir }
 */
export async function runWorkflowRow(o) {
  const { files, prepDir, sop, row, live } = o;
  const maxSteps = o.maxSteps ?? W_DEFAULTS.maxSteps, budgetUsd = o.budgetUsd ?? W_DEFAULTS.budgetUsd, timeoutMs = o.timeoutMs ?? W_DEFAULTS.timeoutMs;
  const tag = o.tag ?? `${sop}-${row}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const runDir = path.join(live, 'wf', tag), hostDir = path.join(live, 'wf-host', tag);
  rmSync(runDir, { recursive: true, force: true }); rmSync(hostDir, { recursive: true, force: true });
  mkdirSync(path.join(runDir, '.tools'), { recursive: true });
  const task = readJson(path.join(prepDir, 'rows', String(row), 'task.json'));
  const catalog = readJson(path.join(prepDir, 'catalog.json'));
  const ledger = new Ledger({ capUsd: budgetUsd, label: `wf:${tag}` });
  let svc = null, bridge = null, r = null, envError = null;
  const t0 = Date.now();
  try {
    mkdirSync(path.join(runDir, 'tools'), { recursive: true });
    if (o.modelPort) svc = await startServices({ modelPort: o.modelPort, ledger, allowedModels: o.judgeModels, socketDir: path.join(runDir, 'tools'), runId: `sopbench-wf:${tag}` });
    writeFiles(runDir, { ...files, 'task.json': JSON.stringify(workflowTask(task), null, 1),
      ...sdkFiles({ catalog, outputColumns: task.output_columns, sdkDir: o.sdkDir ?? null, gateway: svc ? { socket: 'gw.sock', token: svc.token } : { url: 'http://127.0.0.1:9', token: 'no-model-access' } }) });
    bridge = startServe({ liveDir: live, sop, row, mailbox: path.join(runDir, '.tools'), hostDir, maxSteps, sealed: o.sealed, freeze: o.freeze, world: o.world ?? 'dev', catalog: o.catalog ?? null,
      split: o.split ?? SPLIT_FILE, upstream: o.upstream ?? UPSTREAM, dataDir: o.dataDir ?? null });
    await bridge.ready;
    r = await runSandboxed({ command: 'node', args: ['solve.mjs', 'task.json'], workdir: runDir, network: false, timeoutMs });
  } catch (e) { envError = String(e?.message ?? e).slice(0, 500); bridge?.kill(); }
  let steps = null;
  try { if (bridge && !envError) steps = (await bridge.stop()).steps; } catch (e) { envError ??= `bridge stop: ${String(e?.message ?? e).slice(0, 300)}`; }
  try { await svc?.close({ graceMs: 60_000 }); } catch {}
  // Outcome
  let status, answer = null, deopt = null;
  if (envError || !r) status = 'env';
  else if (!r.sandboxReady) status = 'env';
  else if (r.timedOut) status = 'timeout';
  else if (r.code === DEOPT_EXIT) { status = 'deopt'; try { deopt = readJson(path.join(runDir, 'deopt.json')); } catch {} }
  else if (r.code === 0) {
    const last = r.stdout.trim().split('\n').filter(Boolean).at(-1);
    try { answer = JSON.parse(last); status = 'done'; } catch { status = 'crash'; }
  } else status = 'crash';
  const trace = existsSync(path.join(runDir, 'trace.jsonl')) ? readFileSync(path.join(runDir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const calls = existsSync(path.join(hostDir, 'calls.jsonl')) ? readFileSync(path.join(hostDir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const sections = [];
  for (const e of trace.filter(e => e.kind === 'phase-end')) sections.push({ name: e.name, ok: e.ok, ms: e.ms, tools: [...new Set(calls.filter(c => c.section === e.name && c.name).map(c => c.name))].sort() });
  mkdirSync(hostDir, { recursive: true });
  for (const f of ['trace.jsonl', 'deopt.json']) if (existsSync(path.join(runDir, f))) cpSync(path.join(runDir, f), path.join(hostDir, f));
  if (r) writeFileSync(path.join(hostDir, 'stdio.txt'), `exit ${r.code}${r.timedOut ? ' (timeout)' : ''}\n--- stdout\n${r.stdout.slice(-20_000)}\n--- stderr\n${r.stderr.slice(-20_000)}`);
  if (!o.keep) rmSync(runDir, { recursive: true, force: true });
  return {
    status, answer, answerText: status === 'done' ? finalOutputText(answer) : '', costUsd: ledger.spentUsd, costUnknownUpperUsd: ledger.unknownUpperUsd, judgeCalls: ledger.calls,
    judgeRefusals: ledger.refusals, steps, toolCalls: calls.filter(c => c.name).length, toolErrors: calls.filter(c => c.error).length, stepLimitRefusals: calls.filter(c => c.refused).length,
    sections, phases: trace.filter(e => e.kind === 'phase-start').length, flags: trace.filter(e => e.kind === 'flag').length,
    deopt: deopt ? { kind: deopt.kind, name: deopt.name, detail: JSON.stringify(deopt.detail ?? null).slice(0, 300) } : null,
    error: status === 'crash' || status === 'env' ? (envError ?? r?.stderr?.slice(-600) ?? null) : null, durationMs: Date.now() - t0, hostDir,
  };
}

/** Prepare one SOP's rows for workflow runs (bridge prepare; refused for sealed rows without --sealed and a freeze). */
export async function prepareRows({ sop, rows, live, world = 'dev', sealed = false, freeze = null, catalog = null, prepName = null, split = SPLIT_FILE, upstream = UPSTREAM, dataDir = null }) {
  const { bridgeOk } = await import('./lib.mjs');
  const prepDir = path.join(live, 'prep', prepName ?? sop);
  await bridgeOk(['prepare', '--sop', sop, '--rows', rows.join(','), '--out', prepDir, ...(sealed ? ['--sealed', '--freeze', freeze] : ['--world', world]), ...(catalog ? ['--catalog', catalog] : [])], { liveDir: live, split, upstream, dataDir });
  return prepDir;
}

/**
 * Run a workflow on rows (k runs each) and grade every answer with the phase-1 graders. Returns { records, summary }.
 * records: { sop, row, fork, status, strict, upstream, costUsd, steps, toolCalls, sections, deopt, error, answerSha256 }.
 */
export async function runWorkflowSet(o) {
  const { gradeAnswers } = await import('./run.mjs');
  const { sop, files, rows, live } = o;
  const k = o.k ?? 1, concurrency = o.concurrency ?? 2, log = o.log ?? (() => {});
  const prepDir = o.prepDir ?? await prepareRows({ sop, rows, live, world: o.world, sealed: o.sealed, freeze: o.freeze, catalog: o.catalog, split: o.split, upstream: o.upstream, dataDir: o.dataDir });
  const jobs = rows.flatMap(row => Array.from({ length: k }, (_, fork) => ({ row, fork })));
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, async () => {
    while (next < jobs.length) {
      const i = next++, { row, fork } = jobs[i];
      out[i] = { sop, row, fork, ...(await runWorkflowRow({ ...o, prepDir, row, tag: `${o.tagPrefix ?? 'run'}-${sop}-${row}-${fork}` })) };
      if (o.onRow) await o.onRow(out[i]);
    }
  }));
  const expectedOf = (s, r) => readJson(path.join(prepDir, 'rows', String(r), 'expected.json'));
  const graded = await gradeAnswers(out.map(x => ({ sop, row: x.row, text: x.answerText })), { liveDir: live, split: o.split ?? SPLIT_FILE, sealed: o.sealed, freeze: o.freeze,
    upstream: o.upstream ?? UPSTREAM, dataDir: o.dataDir ?? null, expectedOf });
  const records = out.map((x, i) => ({ ...x, strict: graded[i].strict, upstream: graded[i].upstream, strictFields: graded[i].strictFields, graderAgree: graded[i].agree,
    answerSha256: sha256(x.answerText ?? '') }));
  for (const r of records) log(`[wf] ${sop}:${r.row}#${r.fork} ${r.status}${r.deopt ? ` (${r.deopt.kind} ${r.deopt.name})` : ''} strict=${r.strict ? 1 : 0} upstream=${r.upstream ? 1 : 0} steps=${r.steps ?? '-'} $${(r.costUsd ?? 0).toFixed(4)}`);
  const byRow = new Map();
  for (const r of records) byRow.set(r.row, [...(byRow.get(r.row) ?? []), r]);
  const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const summary = { sop, rows: rows.length, k, runs: records.length,
    strictPassAt1: mean(records.map(r => (r.strict ? 1 : 0))), upstreamPassAt1: mean(records.map(r => (r.upstream ? 1 : 0))),
    strictPassK: mean([...byRow.values()].map(rs => (rs.every(r => r.strict) ? 1 : 0))), passingRows: [...byRow].filter(([, rs]) => rs.every(r => r.strict)).map(([row]) => row),
    statuses: records.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}), costUsd: records.reduce((a, r) => a + (r.costUsd ?? 0), 0),
    envFaults: records.filter(r => r.status === 'env').length };
  return { records, summary, prepDir };
}
