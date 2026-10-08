#!/usr/bin/env node
// Freezes the evaluation fixtures:  node freeze.mjs [--write]
// Without --write it only compares the committed fixtures with fixtures/FREEZE.json (the test suite does the same). Labels, mails, seeds, recorded
// classifier outputs, thresholds and the cost-target rule were frozen BEFORE the first control or solver run (FREEZE.json "frozenAt" / "beforeFirstRun").
// Re-freeze only with a version bump and a note in README ("Freezing").
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { THRESHOLDS } from './spec.mjs';
import { hashOf } from '../../../../beds/lib/canonical.mjs';

const FILES = ['source/cases.mjs', 'fixtures/config.json', 'fixtures/emails.json', 'fixtures/labels.json', 'fixtures/jira-seed.json', 'fixtures/model-recordings.json'];
const here = rel => new URL('./' + rel, import.meta.url);
export const hashFile = rel => createHash('sha256').update(readFileSync(here(rel))).digest('hex');
export const CANONICAL = Object.freeze({ seed: 1, split: 'test', difficulty: 3 });
// Task text, deployment presets, delivery order, T3 baseline and targets of the canonical task, pinned by hash (derived data: needs the controls to compute the baseline).
export async function taskHashes() {
  const bed = await import('./index.mjs');
  return Object.fromEntries(['T1', 'T2', 'T3'].map(v => [v, hashOf(bed.generate({ ...CANONICAL, variant: v }))]));
}
export function snapshot() {
  return { files: Object.fromEntries(FILES.map(f => [f, hashFile(f)])), thresholds: THRESHOLDS };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const snap = snapshot();
  const file = here('fixtures/FREEZE.json');
  if (process.argv.includes('--write')) {
    const old = (() => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } })();
    const out = { schema: 'rbench-n8n-20281-freeze/1', version: '0.1.0',
      frozenAt: old.frozenAt ?? '2026-10-08T09:20:00Z', beforeFirstRun: old.beforeFirstRun ?? true,
      note: 'Single annotator. The two-annotator check of the pilot plan is NOT done (see fixtures/ANNOTATION.md). `files` and `thresholds` were frozen at frozenAt, before any control or solver ran; `tasks` (hashes of the canonical tasks, which embed the T3 baseline and targets computed from the controls) were frozen later, see tasksFrozenAt.',
      ...snap, canonicalTask: CANONICAL, tasksFrozenAt: process.argv.includes('--tasks') ? new Date().toISOString().slice(0, 19) + 'Z' : old.tasksFrozenAt, tasks: process.argv.includes('--tasks') ? await taskHashes() : old.tasks };
    writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
    console.log('wrote fixtures/FREEZE.json');
  } else {
    const old = JSON.parse(readFileSync(file, 'utf8'));
    const bad = FILES.filter(f => old.files[f] !== snap.files[f]);
    const t = await taskHashes();
    const badTasks = Object.keys(t).filter(v => old.tasks?.[v] !== t[v]);
    console.log(bad.length ? `CHANGED since freeze: ${bad.join(', ')}` : 'fixtures unchanged since freeze', badTasks.length ? `tasks changed: ${badTasks.join(', ')}` : 'canonical tasks unchanged');
  }
}
