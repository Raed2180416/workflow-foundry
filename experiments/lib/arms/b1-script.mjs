// B1 arm: run a builder-written script (solve.mjs) once per task in the sandbox. Its only model access is
// the host gateway with a per-task budget, so its spend is measured exactly like the F arm's.
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runSandboxed } from '../../../src/executors/sandboxed-command.mjs';
import { startServices, Ledger } from '../services.mjs';
import { MODEL_TOOL, taskFiles } from '../../c0/construct.mjs';

export function b1Script({ id, scriptPath, modelPort, perTaskUsd = 1, timeoutMs = 15 * 60 * 1000 }) {
  const source = readFileSync(scriptPath, 'utf8');
  const def = { kind: 'b1-script', scriptSha: createHash('sha256').update(source).digest('hex').slice(0, 16), perTaskUsd, timeoutMs };
  return {
    id, def, stateful: false,
    async run({ task, taskKey, trial, workdir }) {
      const ledger = new Ledger({ capUsd: perTaskUsd });
      const svc = await startServices({ modelPort, ledger, runId: `${id}:${taskKey}:t${trial}` });
      try {
        const files = { 'solve.mjs': source, 'tools/model.mjs': MODEL_TOOL, 'tools/gateway.json': JSON.stringify({ url: svc.url, token: svc.token }), ...taskFiles(task) };
        for (const [rel, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(workdir, rel)), { recursive: true }); writeFileSync(path.join(workdir, rel), content); }
        const r = await runSandboxed({ command: 'node', args: ['solve.mjs', 'task.json'], workdir, timeoutMs });
        let output = null;
        try { output = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).at(-1) ?? 'null'); } catch { try { output = JSON.parse(r.stdout); } catch {} }
        const error = r.timedOut ? { code: 'SCRIPT_TIMEOUT' } : r.code !== 0 ? { code: 'SCRIPT_ERROR', message: r.stderr.slice(-400) } : output == null ? { code: 'SCRIPT_OUTPUT' } : null;
        return { output, costUsd: ledger.spentUsd, imputedUsd: ledger.imputedUsd, latencyMs: r.durationMs, error, meta: { calls: ledger.calls, errors: ledger.errors } };
      } finally { await svc.close(); }
    },
  };
}

