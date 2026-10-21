// Program B's host for a workflow artifact (research/reuse-20261021/PREREG-C2-1.md §2): runs a registry entry's files,
// byte-identical, on one of B's sub-tasks, sandboxed with no network, with B's supplier world answering the tool mailbox
// (world-b.mjs) instead of SOP-Bench's bridge. Same run directory layout, SDK files and limits as the SOP-Bench W-H arm
// (experiments/sopbench/exec.mjs runWorkflowRow): solve.mjs + lib/ + sections/, task.json, tools/{flow,sop,model}.mjs,
// tools/catalog.json, tools/output-schema.json, tools/gateway.json; 40 tool steps, $0.05 of judge calls, 180 s.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runSandboxed } from '../../src/executors/sandboxed-command.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { sdkFiles, writeFiles, W_DEFAULTS, DEOPT_EXIT } from '../sopbench/exec.mjs';
import { serveMailbox } from './world-b.mjs';

const readLines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

/**
 * runArtifact(o) -> { status: done|deopt|crash|timeout|env, answer, events, calls, steps, costUsd, judgeCalls, deopt, error, durationMs }
 * o: { files ({rel: text}), sdkDir, catalog, outputColumns, task, world, live, tag, modelPort?, judgeModels?, maxSteps, budgetUsd, timeoutMs, keep }
 */
export async function runArtifact(o) {
  const maxSteps = o.maxSteps ?? W_DEFAULTS.maxSteps, budgetUsd = o.budgetUsd ?? W_DEFAULTS.budgetUsd, timeoutMs = o.timeoutMs ?? W_DEFAULTS.timeoutMs;
  const tag = o.tag ?? `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const runDir = path.join(o.live, 'wf', tag);
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(path.join(runDir, 'tools'), { recursive: true });
  const ledger = new Ledger({ capUsd: budgetUsd, label: `c2:${tag}` });
  let svc = null, box = null, r = null, envError = null;
  const t0 = Date.now();
  try {
    if (o.modelPort) svc = await startServices({ modelPort: o.modelPort, ledger, allowedModels: o.judgeModels, socketDir: path.join(runDir, 'tools'), runId: `c2:${tag}` });
    writeFiles(runDir, { ...o.files, 'task.json': JSON.stringify(o.task, null, 1),
      ...sdkFiles({ catalog: o.catalog, outputColumns: o.outputColumns, sdkDir: o.sdkDir ?? null, gateway: svc ? { socket: 'gw.sock', token: svc.token } : { url: 'http://127.0.0.1:9', token: 'no-model-access' } }) });
    box = serveMailbox({ box: path.join(runDir, '.tools'), world: o.world, maxSteps });
    r = await runSandboxed({ command: 'node', args: ['solve.mjs', 'task.json'], workdir: runDir, network: false, timeoutMs });
  } catch (e) { envError = String(e?.message ?? e).slice(0, 500); }
  const served = box ? await box.stop() : { steps: null, calls: [] };
  try { await svc?.close({ graceMs: 30_000 }); } catch {}
  let status, answer = null, deopt = null;
  if (envError || !r || !r.sandboxReady) status = 'env';
  else if (r.timedOut) status = 'timeout';
  else if (r.code === DEOPT_EXIT) { status = 'deopt'; try { deopt = JSON.parse(readFileSync(path.join(runDir, 'deopt.json'), 'utf8')); } catch {} }
  else if (r.code === 0) {
    const last = r.stdout.trim().split('\n').filter(Boolean).at(-1);
    try { answer = JSON.parse(last); status = 'done'; } catch { status = 'crash'; }
  } else status = 'crash';
  const events = readLines(path.join(runDir, 'trace.jsonl'));
  const out = {
    status, answer, events, calls: served.calls.map(c => ({ name: c.name ?? null, arguments: c.arguments ?? null, content: c.content ?? null, section: c.section ?? null, error: c.error ?? null, refused: c.refused ?? null })),
    steps: served.steps, costUsd: ledger.spentUsd, judgeCalls: ledger.calls,
    deopt: deopt ? { kind: deopt.kind, name: deopt.name, detail: JSON.stringify(deopt.detail ?? null).slice(0, 300) } : null,
    error: status === 'crash' || status === 'env' ? (envError ?? r?.stderr?.slice(-600) ?? null) : null, durationMs: Date.now() - t0,
    sandboxMs: r?.durationMs ?? null,
  };
  if (!o.keep) rmSync(runDir, { recursive: true, force: true });
  return out;
}
