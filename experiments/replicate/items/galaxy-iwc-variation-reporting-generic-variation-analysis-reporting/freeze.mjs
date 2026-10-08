#!/usr/bin/env node
// Freezes the canonical evaluation battery: node freeze.mjs [--write]. Without --write it only prints and compares.
// The test suite fails if a regenerated battery, expected table or task text differs from fixtures/frozen-battery.json,
// so cases cannot drift silently once comparative runs start. Re-freeze only with a version bump (README, "Freezing").
import { writeFileSync, readFileSync } from 'node:fs';
import { hashOf, sha256 } from '../../../../beds/lib/canonical.mjs';
import { battery, expectedOf } from './oracle.mjs';
import { generate, TASK_TYPES } from './index.mjs';

export const CANONICAL = Object.freeze({ seed: 1, split: 'test', difficulty: 3 });
const FILE = new URL('./fixtures/frozen-battery.json', import.meta.url);

export function snapshot() {
  const cases = battery(CANONICAL).map(c => ({
    caseId: c.caseId, kind: c.kind, samples: c.inputs.samples.length, params: c.inputs.params,
    inputSha256: hashOf(c.inputs), expectedSha256: hashOf(expectedOf(c)),
  }));
  const tasks = Object.fromEntries(TASK_TYPES.map(t => [t, hashOf(generate({ ...CANONICAL, taskType: t }))]));
  return { schema: 'rbench-frozen-battery/1', canonical: CANONICAL, cases, tasks, batterySha256: sha256(JSON.stringify(cases)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snap = snapshot();
  if (process.argv.includes('--write')) { writeFileSync(FILE, JSON.stringify(snap, null, 1) + '\n'); console.log('wrote', FILE.pathname); }
  else { const old = JSON.parse(readFileSync(FILE, 'utf8')); console.log(old.batterySha256 === snap.batterySha256 ? 'battery unchanged' : 'BATTERY CHANGED'); }
  console.log(snap.batterySha256, snap.tasks);
}
