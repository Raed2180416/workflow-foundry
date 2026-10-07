// Interleaved experiment runner: tasks × trials × arms, scored only by the bed oracle.
// Stateless arms run in a bounded pool; stateful arms (B0+N, library arms) process each stream
// order sequentially so their state only ever comes from earlier tasks in that order.
import path from 'node:path';
import { mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonical } from '../../beds/lib/canonical.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { loadFamily, score } from './beds.mjs';
import { Results } from './results.mjs';

export const armHash = arm => createHash('sha256').update(canonical({ id: arm.id, def: arm.def })).digest('hex').slice(0, 16);

// PREREG-dev §5 environment-fault rule (opt-in: envFaultRule): a FAILED trial that met an environment fault (its own
// error, or any model call it made) is not an outcome. It goes to <results>.faults.jsonl, not the results, so a resume
// retries it; more than 25% faulted trials (after at least 8 attempts in one runExperiment call) stops the run as a stall.
// strictResume (opt-in) refuses to resume over trials recorded by another version of an arm (a different armHash).
// Both are opt-in so experiments already in progress keep the semantics they started with.
export const ENV_FAULTS = Object.freeze(new Set(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE', 'EXECUTOR_LAUNCH', 'EXECUTOR_PROTOCOL']));
export const metEnvFault = r => ENV_FAULTS.has(r?.error?.code) || Object.keys(r?.meta?.errors ?? {}).some(c => ENV_FAULTS.has(c));
export const faultsFileOf = resultsFile => resultsFile.replace(/\.jsonl$/, '') + '.faults.jsonl';
export const STALL_MIN_ATTEMPTS = 8, STALL_FRACTION = 0.25;

async function pool(items, limit, fn) {
  const out = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function runExperiment({ experiment, arms, tasks, trials = 3, workRoot, resultsFile, concurrency = 4, keepWorkdirs = false, log = console.log, onRecord = null,
  envFaultRule = false, strictResume = false }) {
  // Sandboxed arms hide the repository, so a workdir inside it would be invisible to the executor.
  if (path.resolve(workRoot).startsWith(path.resolve(new URL('../..', import.meta.url).pathname) + path.sep)) throw new Error(`workRoot must be outside the repository: ${workRoot}`);
  const results = new Results(resultsFile);
  const faultsFile = faultsFileOf(resultsFile);
  let attempted = 0, faulted = 0, stalled = null;
  // Resume never mixes versions of an arm: a recorded trial of this arm id must come from the same definition.
  if (strictResume) for (const arm of arms) for (const t of tasks) for (let trial = 0; trial < trials; trial++) {
    const prior = results.done.get(`${arm.id}|${t.taskKey}|${trial}`);
    if (prior && prior.armHash !== armHash(arm)) throw new Error(`resume would mix versions of ${arm.id} (${prior.armHash} vs ${armHash(arm)}): use a new results file`);
  }
  const checkStall = () => {
    if (envFaultRule && attempted >= STALL_MIN_ATTEMPTS && faulted > STALL_FRACTION * attempted) stalled ??= new Error(`STALL (PREREG-dev §5): ${faulted}/${attempted} trials hit environment faults; resume after the reset`);
  };
  const one = async (arm, t, trial, state) => {
    if (stalled) return;
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
    attempted++;
    if (envFaultRule && !verdict.pass && metEnvFault(result)) {
      faulted++;
      appendFileSync(faultsFile, JSON.stringify({ experiment, arm: arm.id, armHash: armHash(arm), family: t.familyId, task: t.taskKey, trial, costUsd: result.costUsd ?? null,
        costUnknown: result.costUnknown ?? false, error: result.error ?? null, metaErrors: result.meta?.errors ?? null, latencyMs: result.latencyMs ?? (Date.now() - started),
        at: new Date().toISOString() }) + '\n');
      log(`${arm.id} ${t.taskKey} t${trial}: ENV FAULT ${result.error?.code ?? Object.keys(result.meta?.errors ?? {}).join(',')} (not recorded; a resume retries it)`);
      checkStall();
      // A learning stream stops at the fault (its later tasks depend on this one's state); a resume continues it here.
      if (arm.stateful) throw Object.assign(new Error(`${arm.id}: environment fault in a learning stream; resume after the reset`), { code: 'STREAM_ENV_FAULT' });
      return;
    }
    let extraCost = 0;
    if (arm.afterTask) {
      try { extraCost = (await arm.afterTask({ task: t.task, taskKey: t.taskKey, trial, result, verdict, workdir, state })).costUsd ?? 0; }
      catch (error) { log(`afterTask failed for ${arm.id}: ${error.message}`); }
    }
    const rec = results.append({
      experiment, arm: arm.id, armHash: armHash(arm), family: t.familyId, task: t.taskKey, taskKey: t.taskKey, taskHash: t.taskHash, trial,
      pass: !!verdict.pass, score: verdict.score ?? null, costUsd: (result.costUsd ?? 0) + extraCost, imputedUsd: result.imputedUsd ?? 0, costUnknown: result.costUnknown ?? false,
      latencyMs: result.latencyMs ?? (Date.now() - started), error: result.error ?? null, meta: result.meta ?? null,
      oracleDetails: verdict.details ? JSON.stringify(verdict.details).slice(0, 2000) : null,
      stateAfter: arm.stateful ? structuredClone(state) : undefined,
    });
    if (!keepWorkdirs && rec.pass) rmSync(workdir, { recursive: true, force: true });
    log(`${arm.id} ${t.taskKey} t${trial}: ${rec.pass ? 'PASS' : 'fail'} score=${rec.score} $${rec.costUsd.toFixed(4)}${rec.error ? ' err=' + rec.error.code : ''}`);
    if (onRecord) onRecord(rec);
    checkStall();
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
    pool(streams, Math.max(1, Math.floor(concurrency / 2)), fn => fn().catch(error => { if (error.code !== 'STREAM_ENV_FAULT') throw error; log(error.message); })),
  ]);
  if (stalled) throw stalled;
  return results.all().filter(r => r.experiment === experiment);
}
