#!/usr/bin/env node
// Freezes the evaluation material of this item:  node freeze.mjs [--write]
// Without --write it only compares the committed material with fixtures/FREEZE.json (item.test.mjs does the same). Frozen: every file under
// fixtures/ (except FREEZE.json), the generator, the oracle, the task text and the examples, and the hashes of one canonical task per variant
// (which embed the T3 target computed from fixtures/baseline.json). Change any of it only with a VERSION bump in scenarios.mjs and a note in README.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashOf } from '../../../../beds/lib/canonical.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CODE = ['scenarios.mjs', 'spec.mjs', 'oracle.mjs', 'prompts.mjs', 'examples.mjs', 'miniyaml.mjs', 'runner.mjs', 'mocks/compose-validate.mjs', 'mocks/pull-requests.mjs', 'mocks/reference-server.mjs'];
export const CANONICAL = Object.freeze({ seed: 4, split: 'dev', difficulty: 5 });
const hashFile = rel => createHash('sha256').update(readFileSync(path.join(HERE, rel))).digest('hex');
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) { const p = path.join(dir, name); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}
export function snapshot() {
  const fixtures = walk(path.join(HERE, 'fixtures')).map(f => path.relative(HERE, f).split(path.sep).join('/')).filter(f => f !== 'fixtures/FREEZE.json');
  return { files: Object.fromEntries([...fixtures, ...CODE].map(f => [f, hashFile(f)])) };
}
export async function taskHashes() {
  const bed = await import('./index.mjs');
  return Object.fromEntries(bed.VARIANTS.map(v => [v, hashOf(bed.generate({ ...CANONICAL, variant: v }))]));
}
const file = path.join(HERE, 'fixtures', 'FREEZE.json');
if (import.meta.url === `file://${process.argv[1]}`) {
  const snap = snapshot();
  if (process.argv.includes('--write')) {
    const out = { schema: 'rbench-github-actions-shafthq-update-selenium-grid-versions-freeze/1', version: (await import('./scenarios.mjs')).VERSION,
      frozenAt: new Date().toISOString().slice(0, 19) + 'Z', beforeFirstRun: false,
      note: 'Development harness. The generator, the truth rules and the oracle were iterated while the controls were first run against them (README section 7 lists what the executed original changed); '
        + 'this freeze is taken at the end of the build, after those runs and BEFORE any solver arm has run on the item. Nothing here is a sealed evaluation set.',
      ...snap, canonicalTask: CANONICAL, tasks: await taskHashes() };
    writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
    console.log('wrote fixtures/FREEZE.json');
  } else {
    const old = JSON.parse(readFileSync(file, 'utf8')), t = await taskHashes();
    const bad = Object.keys({ ...old.files, ...snap.files }).filter(f => old.files[f] !== snap.files[f]);
    const badTasks = Object.keys(t).filter(v => old.tasks?.[v] !== t[v]);
    console.log(bad.length ? `CHANGED since freeze: ${bad.join(', ')}` : 'frozen files unchanged', badTasks.length ? `tasks changed: ${badTasks.join(', ')}` : 'canonical tasks unchanged');
    process.exitCode = bad.length || badTasks.length ? 1 : 0;
  }
}
