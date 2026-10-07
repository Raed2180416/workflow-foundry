// B1 arm: run a builder-written script (solve.mjs) once per task in the sandbox. Its only model access is
// the host gateway with a per-task budget, so its spend is measured exactly like the F arm's.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { runSandboxed } from '../../../src/executors/sandboxed-command.mjs';
import { startServices, Ledger } from '../services.mjs';
import { MODEL_TOOL, taskFiles } from '../../c0/construct.mjs';

export function b1Script({ id, scriptPath, modelPort, perTaskUsd = 1, timeoutMs = 20 * 60 * 1000, allowedModels = null }) {
  const source = readFileSync(scriptPath, 'utf8');
  const def = { kind: 'b1-script', scriptSha: createHash('sha256').update(source).digest('hex').slice(0, 16), perTaskUsd, timeoutMs, network: 'gateway-socket-only',
    allowedModels, policyHash: modelPort.policyHash ?? null, modelTool: createHash('sha256').update(MODEL_TOOL).digest('hex').slice(0, 16) };
  return {
    id, def, stateful: false,
    async run({ task, taskKey, trial, workdir }) {
      const ledger = new Ledger({ capUsd: perTaskUsd, label: `${id}:${taskKey}:t${trial}` });
      // A fresh run id per attempt: a retried trial (after an environment fault) is never served journaled answers.
      // The script runs without any network: its only way out is the gateway's unix socket in its own tools/ directory.
      mkdirSync(path.join(workdir, 'tools'), { recursive: true });
      const svc = await startServices({ modelPort, ledger, runId: `${id}:${taskKey}:t${trial}:${randomUUID()}`, allowedModels, socketDir: path.join(workdir, 'tools') });
      let r;
      try {
        const files = { 'solve.mjs': source, 'tools/model.mjs': MODEL_TOOL, 'tools/gateway.json': JSON.stringify({ socket: 'gw.sock', token: svc.token }), ...taskFiles(task) };
        for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true }); writeFileSync(path.join(workdir, rel), content); }
        r = await runSandboxed({ command: 'node', args: ['solve.mjs', 'task.json'], workdir, timeoutMs, network: false });
      } finally { await svc.close(); }   // settles in-flight gateway calls, so the ledger read below is complete
      writeFileSync(path.join(workdir, '.solve.stdout'), r.stdout); writeFileSync(path.join(workdir, '.solve.stderr'), r.stderr);
      let output = null;
      try { output = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).at(-1) ?? 'null'); } catch { try { output = JSON.parse(r.stdout); } catch {} }
      const error = !r.sandboxReady && !r.timedOut ? { code: 'SANDBOX_UNAVAILABLE', message: r.stderr.slice(-400) }
        : r.timedOut ? { code: 'SCRIPT_TIMEOUT' } : r.code !== 0 ? { code: 'SCRIPT_ERROR', message: r.stderr.slice(-400) } : output == null ? { code: 'SCRIPT_OUTPUT' } : null;
      return { output, costUsd: ledger.spentUsd, imputedUsd: ledger.imputedUsd, costUnknown: ledger.unknownCalls > 0, latencyMs: r.durationMs, error,
        meta: { calls: ledger.calls, errors: ledger.errors, refusals: ledger.refusals, unknownCalls: ledger.unknownCalls, unknownUpperUsd: ledger.unknownUpperUsd,
          overshootUsd: Math.max(0, ledger.spentUsd - perTaskUsd), stderrTail: r.stderr.slice(-400) } };
    },
  };
}
