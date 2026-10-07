// Interleaved experiment runner: tasks × trials × arms, scored only by the bed oracle.
// Stateless arms run in a bounded pool; stateful arms (B0+N, library arms) process each stream
// order sequentially so their state only ever comes from earlier tasks in that order.
import path from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonical } from '../../beds/lib/canonical.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { loadFamily, score } from './beds.mjs';
import { Results } from './results.mjs';

export const armHash = arm => createHash('sha256').update(canonical({ id: arm.id, def: arm.def })).digest('hex').slice(0, 16);

async function pool(items, limit, fn) {
  const out = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function runExperiment({ experiment, arms, tasks, trials = 3, workRoot, resultsFile, concurrency = 4, keepWorkdirs = false, log = console.log }) {
  // Sandboxed arms hide the repository, so a workdir inside it would be invisible to the executor.
  if (path.resolve(workRoot).startsWith(path.resolve(new URL('../..', import.meta.url).pathname) + path.sep)) throw new Error(`workRoot must be outside the repository: ${workRoot}`);
  const results = new Results(resultsFile);
  const one = async (arm, t, trial, state) => {
    if (results.has(arm.id, t.taskKey, trial)) {
      // Resume: a learning arm continues from the state it had after this task.
      if (arm.stateful) Object.assign(state, results.done.get(`${arm.id}|${t.taskKey}|${trial}`).stateAfter ?? {});
      return;
    }
    const fam = await loadFamily(t.familyId);
    const workdir = path.join(workRoot, experiment, arm.id, `${t.taskKey.replaceAll(':', '_')}_t${trial}`);
    rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
    const started = Date.now();
    let result;
    try { result = await arm.run({ task: t.task, familyId: t.familyId, taskKey: t.taskKey, trial, outputSchema: fam.outputSchema, workdir, state }); }
    catch (error) { result = { output: null, costUsd: 0, error: { code: error.code ?? 'ARM_ERROR', message: String(error.message ?? error).slice(0, 500) } }; }
    const verdict = result.output == null ? { pass: false, score: 0, details: { noOutput: true } } : await score(t.familyId, t.task, result.output);
    let extraCost = 0;
    if (arm.afterTask) {
      try { extraCost = (await arm.afterTask({ task: t.task, taskKey: t.taskKey, trial, result, verdict, workdir, state })).costUsd ?? 0; }
      catch (error) { log(`afterTask failed for ${arm.id}: ${error.message}`); }
    }
    const rec = results.append({
      experiment, arm: arm.id, armHash: armHash(arm), family: t.familyId, task: t.taskKey, taskKey: t.taskKey, taskHash: t.taskHash, trial,
      pass: !!verdict.pass, score: verdict.score ?? null, costUsd: (result.costUsd ?? 0) + extraCost, imputedUsd: result.imputedUsd ?? 0,
      latencyMs: result.latencyMs ?? (Date.now() - started), error: result.error ?? null, meta: result.meta ?? null,
      oracleDetails: verdict.details ? JSON.stringify(verdict.details).slice(0, 2000) : null,
      stateAfter: arm.stateful ? structuredClone(state) : undefined,
    });
    if (!keepWorkdirs && rec.pass) rmSync(workdir, { recursive: true, force: true });
    log(`${arm.id} ${t.taskKey} t${trial}: ${rec.pass ? 'PASS' : 'fail'} score=${rec.score} $${rec.costUsd.toFixed(4)}${rec.error ? ' err=' + rec.error.code : ''}`);
  };
  const stateless = arms.filter(a => !a.stateful), stateful = arms.filter(a => a.stateful);
  const jobs = [];
  // Interleave: rotate arm order per task so no arm systematically runs first.
  tasks.forEach((t, ti) => { for (let trial = 0; trial < trials; trial++) stateless.forEach((_, ai) => jobs.push([stateless[(ai + ti) % stateless.length], t, trial])); });
  const streams = stateful.flatMap(arm => Array.from({ length: trials }, (_, trial) => async () => {
    // Each trial of a learning arm is a different, seeded stream order (ROADMAP §4.3: >=3 orders).
    const state = {}, order = trial === 0 ? tasks : rng('stream-order', experiment, trial).shuffle(tasks);
    for (const t of order) await one(arm, t, trial, state);
  }));
  await Promise.all([
    pool(jobs, concurrency, ([arm, t, trial]) => one(arm, t, trial, {})),
    pool(streams, Math.max(1, Math.floor(concurrency / 2)), fn => fn()),
  ]);
  return results.all().filter(r => r.experiment === experiment);
}
