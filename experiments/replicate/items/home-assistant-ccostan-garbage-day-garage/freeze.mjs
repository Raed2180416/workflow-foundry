// Freezes this item's evaluation parameters BEFORE any comparative run: a hash of the scenario batteries for a fixed set of instances and the
// T3 cost cap measured on the ORIGINAL definition. node freeze.mjs writes fixtures/frozen.json; node freeze.mjs --check compares.
// Re-run (and bump VERSION in spec.mjs) after ANY change to scenarios.mjs, trace.mjs, oracle.mjs or the mocks.
import { readFileSync, writeFileSync } from 'node:fs';
import { hashOf } from '../../../../beds/lib/canonical.mjs';
import { scenariosFor } from './scenarios.mjs';
import { driveSync } from './env.mjs';
import { oracle } from './oracle.mjs';
import { makeOriginal } from './controls/original.mjs';
import { VERSION, T3_COST } from './spec.mjs';

const FILE = new URL('./fixtures/frozen.json', import.meta.url);
export const FROZEN_INSTANCES = [];
for (const split of ['dev', 'test']) for (const seed of [0, 1, 2, 7]) for (const difficulty of [1, 3, 5]) FROZEN_INSTANCES.push({ split, seed, difficulty });
export const keyOfInstance = i => `${i.split}:s${i.seed}:d${i.difficulty}`;

export function hashes() {
  return Object.fromEntries(FROZEN_INSTANCES.map(i => [keyOfInstance(i), hashOf(scenariosFor(i))]));
}
export function measureCost() {
  let max = 0, runs = 0;
  for (let seed = 0; seed < 20; seed++) for (const difficulty of [1, 2, 3, 4, 5]) for (const split of ['dev', 'test']) {
    const task = { seed, split, difficulty, variant: 'T3' };
    const r = oracle(task, driveSync(task, makeOriginal()));
    max = Math.max(max, r.details.cost.selfInflictedWork); runs++;
  }
  return { baselineMax: max, instances: runs };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const check = process.argv.includes('--check');
  const fresh = { schema: 'rbench-frozen/1', version: VERSION, frozenOn: '2026-10-08',
    status: 'development/diagnostic freeze; the scenarios were authored by the same agent that wrote the oracle, so this is not a sealed evaluation',
    instances: hashes(), cost: (() => { const m = measureCost(); return { ...m, factor: T3_COST.factor, cap: Math.ceil(m.baselineMax * T3_COST.factor), measuredOn: 'original definition (controls/original.mjs), seeds 0..19, difficulties 1..5, splits dev+test, max of the core-scenario self-inflicted work' }; })() };
  if (check) {
    const old = JSON.parse(readFileSync(FILE, 'utf8'));
    const same = JSON.stringify(old.instances) === JSON.stringify(fresh.instances) && old.cost.cap === fresh.cost.cap && old.version === fresh.version;
    console.log(same ? 'frozen.json matches' : 'frozen.json DIFFERS'); process.exit(same ? 0 : 1);
  }
  writeFileSync(FILE, JSON.stringify(fresh, null, 1) + '\n');
  console.log(`wrote fixtures/frozen.json: ${Object.keys(fresh.instances).length} instance hashes, cost baseline max ${fresh.cost.baselineMax}, cap ${fresh.cost.cap}`);
}
