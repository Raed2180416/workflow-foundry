#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDirectory } from './opencode-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [parentID, pairID, baselineID, foundryID, model, smokeID] = process.argv.slice(2);
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
const parent = runDirectory(parentID), pair = runDirectory(pairID), smoke = runDirectory(smokeID);
const verdict = readJSON(path.join(smoke, 'verdict.json'));
if (!verdict.passed || verdict.model !== model) throw Error('This model has not passed the specified actual TUI smoke.');
if (existsSync(pair)) throw Error('Pair already exists.');
const source = readJSON(path.join(parent, 'pair.json'));
process.umask(0o077);
mkdirSync(pair, { mode: 0o700 });
cpSync(path.join(parent, 'frozen'), path.join(pair, 'frozen'), { recursive: true });
for (const file of ['capabilities.json', 'skill-context.md', 'cases.json', 'execution-dependencies.json']) copyFileSync(path.join(parent, file), path.join(pair, file));
const manifest = { ...source, id: pairID, createdAt: new Date().toISOString(), status: 'frozen-before-generation', parentPair: parentID, modelCondition: model, modelAvailabilitySmoke: smokeID, baselineID: undefined, foundryID: undefined };
writeFileSync(path.join(pair, 'pair.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
const invoke = (file, args) => {
  const result = spawnSync(process.execPath, [path.join(root, file), ...args], { cwd: root, encoding: 'utf8', timeout: 45000 });
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stderr);
};
invoke('evals/compare-incident.mjs', ['stage', pairID, baselineID, foundryID]);
for (const id of [baselineID, foundryID]) {
  copyFileSync(path.join(smoke, 'catalog.stdout.txt'), path.join(runDirectory(id), 'catalog.stdout.txt'));
  invoke('evals/opencode-harness.mjs', ['select', id, model]);
  const file = path.join(runDirectory(id), 'manifest.json'), run = readJSON(file);
  run.modelAvailabilitySmoke = smokeID;
  run.operatorInterventions.push({ actor: 'worker-5 evaluator agent', at: new Date().toISOString(), type: 'new-model-condition', description: 'Changed both arms to the same catalog-observed zero-price model only after its actual TUI smoke passed. Original task, skill, runtime and oracle bytes preserved.' });
  writeFileSync(file, JSON.stringify(run, null, 2) + '\n', { mode: 0o600 });
}
console.log(JSON.stringify({ pair: pairID, model, modelAvailabilitySmoke: smokeID, baselineID, foundryID, frozenExecutor: source.executorSHA256 }, null, 2));
