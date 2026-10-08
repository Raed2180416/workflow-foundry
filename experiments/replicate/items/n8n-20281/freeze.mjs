#!/usr/bin/env node
// Freezes the evaluation fixtures:  node freeze.mjs [--write]
// Without --write it only compares the committed fixtures with fixtures/FREEZE.json (the test suite does the same). Labels, mails, seeds, recorded
// classifier outputs, thresholds and the cost-target rule were frozen BEFORE the first control or solver run (FREEZE.json "frozenAt" / "beforeFirstRun").
// Re-freeze only with a version bump and a note in README ("Freezing").
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { THRESHOLDS } from './spec.mjs';

const FILES = ['source/cases.mjs', 'fixtures/config.json', 'fixtures/emails.json', 'fixtures/labels.json', 'fixtures/jira-seed.json', 'fixtures/model-recordings.json'];
const here = rel => new URL('./' + rel, import.meta.url);
export const hashFile = rel => createHash('sha256').update(readFileSync(here(rel))).digest('hex');
export function snapshot() {
  return { files: Object.fromEntries(FILES.map(f => [f, hashFile(f)])), thresholds: THRESHOLDS };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const snap = snapshot();
  if (process.argv.includes('--write')) {
    const out = { schema: 'rbench-n8n-20281-freeze/1', version: '0.1.0', frozenAt: '2026-10-08T09:20:00Z', beforeFirstRun: true,
      note: 'Single annotator. The two-annotator check of the pilot plan is NOT done (see fixtures/ANNOTATION.md).', ...snap };
    writeFileSync(here('fixtures/FREEZE.json'), JSON.stringify(out, null, 1) + '\n');
    console.log('wrote fixtures/FREEZE.json');
  } else {
    const old = JSON.parse(readFileSync(here('fixtures/FREEZE.json'), 'utf8'));
    const bad = FILES.filter(f => old.files[f] !== snap.files[f]);
    console.log(bad.length ? `CHANGED since freeze: ${bad.join(', ')}` : 'fixtures unchanged since freeze');
  }
}
