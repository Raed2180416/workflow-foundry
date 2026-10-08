// Run a compiled solve.mjs on one task (SPEC §5), sandboxed exactly like the B1 arm: no network, the model gateway's
// unix socket in tools/ as the only way out, a per-task gateway budget, tools/model.mjs (MODEL_TOOL, byte-identical)
// and tools/flow.mjs beside it. Exit 75 means a deopt (deopt.json says why); any other non-zero exit is a crash.
// `invalid` means the output fails the bed's outputSchema (repo validator), never the oracle.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { runSandboxed } from '../../src/executors/sandboxed-command.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { MODEL_TOOL, taskFiles } from '../c0/construct.mjs';
import { loadFamily } from '../lib/beds.mjs';
import { validateOutput } from './interpret.mjs';

export const DEOPT_EXIT = 75, MAX_TRACE_EVENTS = 5000;
export const DEFAULT_FLOW = path.resolve(new URL('./flow.mjs', import.meta.url).pathname);

const parseLines = text => text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const lastJsonLine = stdout => {
  try { return JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1) ?? 'null'); } catch { try { return JSON.parse(stdout); } catch { return null; } }
};

// status: ok | deopt | crash | timeout | invalid. An environment fault (sandbox could not start, provider rate limit)
// is reported through error.code / meta.errors exactly as the B1 arm does, so the stream can apply ENV_FAULTS.
export async function runCompiled({ solvePath, task, modelPort, perTaskUsd = 1, timeoutMs = 20 * 60 * 1000, workdir, familyId = null, outputSchema = null,
  allowedModels = null, flowPath = DEFAULT_FLOW, label = 'compiled' }) {
  if (!solvePath || !task || !workdir) throw new Error('runCompiled needs solvePath, task and workdir');
  const schema = outputSchema ?? (familyId ? (await loadFamily(familyId)).outputSchema : null);
  const source = readFileSync(solvePath, 'utf8');
  mkdirSync(path.join(workdir, 'tools'), { recursive: true });
  for (const stale of ['deopt.json', 'trace.jsonl', '.solve.stdout', '.solve.stderr']) rmSync(path.join(workdir, stale), { force: true });
  const ledger = new Ledger({ capUsd: perTaskUsd, label });
  // A fresh run id per attempt: a retried run (after an environment fault) is never served journaled answers.
  const svc = await startServices({ modelPort, ledger, runId: `${label}:${randomUUID()}`, allowedModels, socketDir: path.join(workdir, 'tools') });
  let r;
  try {
    const files = { 'solve.mjs': source, 'tools/model.mjs': MODEL_TOOL, 'tools/gateway.json': JSON.stringify({ socket: 'gw.sock', token: svc.token }), ...taskFiles(task) };
    if (flowPath && existsSync(flowPath)) files['tools/flow.mjs'] = readFileSync(flowPath, 'utf8');
    for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true }); writeFileSync(path.join(workdir, rel), content); }
    r = await runSandboxed({ command: 'node', args: ['solve.mjs', 'task.json'], workdir, timeoutMs, network: false });
  } catch (error) {
    // runSandboxed throws only before the script starts (no namespaces): an environment fault, nothing spent.
    r = { code: null, stdout: '', stderr: String(error.message ?? error), timedOut: false, sandboxReady: false, durationMs: 0, thrown: error.code ?? 'SANDBOX_UNAVAILABLE' };
  } finally { await svc.close(); }   // settles in-flight gateway calls, so the ledger read below is complete
  writeFileSync(path.join(workdir, '.solve.stdout'), r.stdout); writeFileSync(path.join(workdir, '.solve.stderr'), r.stderr);
  const trace = existsSync(path.join(workdir, 'trace.jsonl')) ? parseLines(readFileSync(path.join(workdir, 'trace.jsonl'), 'utf8')).slice(0, MAX_TRACE_EVENTS) : [];
  let deopt = null;
  if (existsSync(path.join(workdir, 'deopt.json'))) { try { deopt = JSON.parse(readFileSync(path.join(workdir, 'deopt.json'), 'utf8')); } catch { deopt = { kind: 'unknown', detail: 'deopt.json is not JSON' }; } }
  let status, output = null, error = null, schemaErrors = null;
  if (!r.sandboxReady && !r.timedOut) { status = 'crash'; error = { code: 'SANDBOX_UNAVAILABLE', message: r.stderr.slice(-400) }; }
  else if (r.timedOut) { status = 'timeout'; error = { code: 'SCRIPT_TIMEOUT' }; }
  else if (r.code === DEOPT_EXIT) { status = 'deopt'; deopt ??= { kind: 'unknown', detail: 'exit 75 without deopt.json' }; }
  else if (r.code !== 0) { status = 'crash'; error = { code: 'SCRIPT_ERROR', exitCode: r.code, message: r.stderr.slice(-400) }; }
  else {
    output = lastJsonLine(r.stdout);
    const check = output == null ? { valid: false, errors: ['no JSON on the last stdout line'] } : validateOutput(schema, output);
    if (check.valid) status = 'ok';
    else { status = 'invalid'; schemaErrors = check.errors; error = { code: output == null ? 'SCRIPT_OUTPUT' : 'OUTPUT_SCHEMA', message: (check.errors ?? []).join('; ').slice(0, 400) }; }
  }
  if (status !== 'deopt') deopt = status === 'ok' || status === 'invalid' ? null : deopt;
  // A call whose spend could not be observed is charged at its bound (unbounded: the per-task cap), never $0.
  const unknownUsd = ledger.unknownCalls > 0 ? (ledger.unknownUpperUsd ?? perTaskUsd) : 0;
  return {
    status, output, deopt, trace, costUsd: ledger.spentUsd + unknownUsd, costUnknown: ledger.unknownCalls > 0, imputedUsd: ledger.imputedUsd, latencyMs: r.durationMs, error,
    meta: { exitCode: r.code, calls: ledger.calls, errors: ledger.errors, refusals: ledger.refusals, unknownCalls: ledger.unknownCalls, unknownUpperUsd: ledger.unknownUpperUsd,
      spentUsd: ledger.spentUsd, overshootUsd: Math.max(0, ledger.spentUsd - perTaskUsd), schemaErrors, stderrTail: r.stderr.slice(-400),
      solveSha256: createHash('sha256').update(source).digest('hex'), flow: !!(flowPath && existsSync(flowPath)) },
  };
}
