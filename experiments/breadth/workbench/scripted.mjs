// Scripted ($0) task-runs of WorkBench through the full facade: gold replay, floors, mutants, baseline agents.
// Each item = { key, task, actions } (WorkBench action strings the scripted agent issues as MCP calls, in order).
// Workers each own a world process; every item resets its world, runs a real relay process with a scripted MCP client,
// snapshots the live world, and is graded host-side afterwards by a separate bed process.
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BENCH, catalogFrom, gradeTrajectories, materializeFacadeBin, runTaskThroughFacade, scriptedAgent, sha256, startWorld, stepsFor } from './lib.mjs';

/** runScriptedBatch({ items, tasksFile, label, concurrency }) -> { rows, verdicts, ms } */
export async function runScriptedBatch({ items, tasksFile, label = 'scripted', concurrency = 2, liveRoot = path.join(BENCH, 'live', `${label}-${Date.now()}`), python = true, log = () => {} }) {
  const t0 = Date.now();
  mkdirSync(liveRoot, { recursive: true });
  const worlds = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, (_, i) => startWorld(path.join(liveRoot, `world-${i}`)));
  try {
    await Promise.all(worlds.map(w => w.ready));
    const catalog = await catalogFrom(worlds[0]);
    const facadeBin = materializeFacadeBin(path.join(liveRoot, 'facade-bin'), catalog.mcpTools);
    const rows = new Array(items.length);
    let next = 0, done = 0;
    await Promise.all(worlds.map(async (world, wi) => {
      while (next < items.length) {
        const i = next++;
        const it = items[i];
        const steps = await stepsFor(world, it.actions);
        const hostDir = path.join(liveRoot, 'host', `${wi}`);
        const r = await runTaskThroughFacade({ task: it.task, world, catalog, facadeBin, workRoot: path.join(liveRoot, 'w', `${wi}`), hostDir, agent: scriptedAgent(steps), python });
        rows[i] = { id: it.task.id, key: it.key, intended: it.actions, actions: r.trajectory.actions, fatal: Boolean(r.trajectory.fatal), error: r.trajectory.fatal ? `fatal: ${r.trajectory.fatal}` : '', live: r.snapshot,
          facade: { worldCalls: r.facade.worldCalls, writes: r.facade.writes, refused: r.facade.refused, rejected: r.facade.rejected, envFault: r.facade.envFault },
          isErrorResults: (r.agentResult?.results ?? []).filter(x => x.isError).length };
        if (++done % 100 === 0) log(`[${label}] ${done}/${items.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
      }
    }));
    const verdicts = await gradeTrajectories(rows.map(({ id, key, actions, error, fatal, live }) => ({ id, key, actions, error, fatal, live })), { tasksFile, dir: path.join(liveRoot, 'grade') });
    return { rows, verdicts, ms: Date.now() - t0, liveRoot };
  } finally {
    await Promise.all(worlds.map(w => w.close()));
  }
}

/** The run's determinism digest: per key, the official verdict, the native verdict, the live end-state digest and the
 * logged actions. */
export function runDigest(rows, verdicts) {
  const byKey = new Map(verdicts.map(v => [v.key, v]));
  const parts = rows.map(r => { const v = byKey.get(r.key); return [r.key, v?.correct ?? null, v?.native_correct ?? null, sha256(JSON.stringify(r.live ?? null)), sha256(JSON.stringify(r.actions))]; })
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return sha256(JSON.stringify(parts));
}

export function cleanup(liveRoot) { rmSync(liveRoot, { recursive: true, force: true }); }
