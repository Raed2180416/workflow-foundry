// One-off check (development evidence): a run created and parked by the real version-1 engine (commit 96cab64, extracted to ./engine)
// resumes under the worktree's engine (version 2) with engine.migrated, takes an answer, completes, and verify-run accepts it.
//   node v1-to-v2.mjs <phase: create|resume> <workspace> [runId]
import path from 'node:path';
const [phase, workspace, runId] = process.argv.slice(2);
const WT = '/home/user/workflow-foundry/.claude/worktrees/agent-a799b6269e6dfdf8c';
const V1 = new URL('./engine/', import.meta.url).pathname;
const workflow = { schemaVersion: '1.0', id: 'V1Park', version: 1, title: 'Parked under v1', goal: 'Survive an engine bump.', domain: 'general',
  envelope: { assumptions: ['Synthetic'], risks: ['Engine drift'], successCriteria: ['Completes under v2'] },
  budget: { maxSteps: 10, maxConcurrency: 1, maxDurationMs: 3600000, maxCost: 0 },
  nodes: [{ id: 'sleep', kind: 'task', needs: [], description: 'a step done under v1', tool: 'core.sleep', args: { ms: 5 }, timeoutMs: 5000, retry: { maxAttempts: 1 } },
    { id: 'ask', kind: 'human', needs: ['sleep'], description: 'a person decides', question: 'Proceed?', answerSchema: { type: 'boolean' } }],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.ask.answer' }, right: true }] };
if (phase === 'create') {
  const { Foundry } = await import(path.join(V1, 'src/foundry.mjs'));
  const { engineHash } = await import(path.join(V1, 'src/engine.mjs'));
  const f = new Foundry(workspace); f.save(workflow);
  const run = f.createRun('V1Park', {});
  const r = await f.startRun(run.id);
  console.log(JSON.stringify({ phase, runId: run.id, status: r.status, engineHash }));
  await f.close();
} else {
  const { Foundry } = await import(path.join(WT, 'src/foundry.mjs'));
  const { engineHash, engineVersion } = await import(path.join(WT, 'src/engine.mjs'));
  const { verifyRun } = await import(path.join(WT, 'src/verify-run.mjs'));
  const f = new Foundry(workspace);
  const parked = await f.startRun(runId);
  f.runtime.answer(runId, 'root/ask', true, { actor: 'owner', channel: 'check' });
  const done = await f.startRun(runId);
  const events = f.store.events(runId), migrated = events.filter(e => e.type === 'engine.migrated');
  const report = verifyRun(f.store, runId);
  console.log(JSON.stringify({ phase, engineHash, engineVersion, parkedStatus: parked.status, final: done.status, verdict: done.verdict?.verdict,
    migrated: migrated.map(({ fromVersion, toVersion, from, to }) => ({ fromVersion, toVersion, from: from.slice(0, 12), to: to.slice(0, 12) })),
    recordEngine: f.store.run(runId).engineHash.slice(0, 12), verifyOk: report.ok, findings: report.findings.map(x => `${x.severity}:${x.code}`) }));
  await f.close();
}
