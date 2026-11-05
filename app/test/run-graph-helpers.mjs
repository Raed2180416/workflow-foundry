// A FoundryApp whose Foundry has a scripted ModelPort and the evaluation's fixture tools, for the human-task and live-route tests ($0).
// The app's own registry has no model port and no slow or high-risk fixture tool; tests swap in one Foundry on the same live directory.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FoundryApp } from '../core/service.mjs';
import { Foundry } from '../../src/foundry.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';
import { loadPolicy } from '../../src/models/policy.mjs';
import { effectRegistry } from '../eval/run-graph/scenarios.mjs';

const loaded = loadPolicy();
export async function appWith(t, { script = {}, registry = effectRegistry() } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'run-graph-app-'));
  const app = new FoundryApp({ workspace: dir });
  await app.foundry.close();
  const provider = new ScriptedProvider(script);
  app.registry = registry;
  app.foundry = new Foundry(app.liveDir, { registry, policy: { allowedCapabilities: registry.list().map(c => c.name), maxCost: 5, maxConcurrency: 16, maxSteps: 50000 },
    models: store => new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) }) });
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  return { app, dir, provider };
}
/** Save a workflow into the app's store and start a run of it; resolves when the run parks or ends. */
export async function startFlow(app, workflow, input = {}) {
  app.foundry.store.saveWorkflow(workflow);
  const run = app.foundry.createRun(workflow.id, input);
  await app.foundry.startRun(run.id).catch(() => {});
  return app.foundry.store.run(run.id);
}
