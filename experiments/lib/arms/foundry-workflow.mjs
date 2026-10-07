// F arm: run a Foundry workflow once per task. The workflow receives {prompt, inputs} (plus
// files when the task has them) and must have a node with id `answer` whose output is the
// final answer (or {answer: ...}). Cost is run.cost (hosted list price, every journaled call
// including retries/escalations); imputed local compute is summed from the journal.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Foundry } from '../../../src/foundry.mjs';

// The runtime is given the port's own policy (a session subset of the owner policy, e.g. C0's three Claude models),
// so validation, class resolution and escalation see exactly the models the port can call.
// maxDurationMs null keeps the runtime default (1 h); C0 passes its 20-minute execution cap.
export function foundryWorkflow({ id, workflow, modelPort, assignment = null, maxCostUsd = 1, maxDurationMs = null, notesFor = null }) {
  const def = { kind: 'foundry-workflow', workflowId: workflow.id, workflowVersion: workflow.version,
    workflowSha: createHash('sha256').update(JSON.stringify(workflow)).digest('hex').slice(0, 16), policyHash: modelPort.policyHash ?? null, assignment, maxCostUsd, maxDurationMs };
  return {
    id, def, stateful: false, workflow,
    async run({ task, taskKey, trial, workdir }) {
      const foundry = new Foundry(path.join(workdir, 'ws'), { models: modelPort, modelPolicy: modelPort.policy, policy: { maxCost: maxCostUsd, maxConcurrency: 8, ...(maxDurationMs ? { maxDurationMs } : {}) } });
      try {
        const saved = foundry.save(workflow);
        const input = { prompt: task.prompt, inputs: task.inputs ?? {}, ...(task.files ? { files: task.files } : {}) };
        const run = foundry.createRun(saved.hash, input, { sampleSalt: `${id}:t${trial}`, ...(assignment ? { assignment } : {}) });
        const started = Date.now();
        const done = await foundry.runtime.execute(run.id);
        const out = done.outputs?.answer;
        const calls = modelPort.journal.forRun(run.id);
        const imputed = calls.reduce((s, c) => s + (c.imputedUsd ?? 0), 0);
        const models = {};
        for (const c of calls) models[c.modelId] = (models[c.modelId] ?? 0) + 1;
        const escalations = foundry.store.decisions(run.id).filter(d => d.kind === 'escalation').length;
        return {
          output: out == null ? null : (out.answer ?? out), costUsd: done.cost ?? 0, imputedUsd: imputed, latencyMs: Date.now() - started,
          costUnknown: (done.costUnknownCalls ?? 0) > 0,
          error: done.status === 'succeeded' ? null : { code: done.error?.code ?? done.status, message: String(done.error?.message ?? '').slice(0, 300) },
          meta: { runId: run.id, status: done.status, verdict: done.verdict?.verdict, calls: calls.length, models, escalations,
            ...(done.costUnknownCalls ? { costUnknownCalls: done.costUnknownCalls, costUnknownUpperUsd: done.costUnknownUpperUsd ?? null } : {}) },
        };
      } finally { await foundry.close(); }
    },
  };
}
