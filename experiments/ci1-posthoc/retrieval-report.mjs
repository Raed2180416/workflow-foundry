#!/usr/bin/env node
// What A2's leave-one-out retrieval returns for every bed item, at $0 (analysis): exclusions by reason, the 3 pattern cards and the 3
// corpus exemplars (ids, scores; skeletons stay local), and whether an exemplar is itself another bed item.
//   node experiments/ci1-posthoc/retrieval-report.mjs [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieve, buildIndex, indexHash } from '../ci1/retrieve.mjs';
import { BED } from '../ci1/bed.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const split = JSON.parse(readFileSync(path.join(here, '../../research/ci1-20261021/SPLIT.json'), 'utf8'));
const bedIds = new Set([...split.dev, ...split.test]);
const index = buildIndex();
const rows = [];
for (const [s, ids] of [['dev', split.dev], ['test', split.test]]) for (const id of ids) {
  const spec = JSON.parse(readFileSync(path.join(BED, 'items', id, 'spec.json'), 'utf8'));
  const request = readFileSync(path.join(BED, 'items', id, 'description.md'), 'utf8');
  const r = retrieve({ request, workspace: spec.workspace, targetId: id, index });
  const reasons = Object.values(r.exclusionReasons).reduce((m, x) => { const k = x.replace(/ \(.*/, ''); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  rows.push({ id, split: s, excluded: r.excluded, reasons, patterns: r.patterns.map(p => p.id), exemplars: r.exemplars.map(e => ({ id: e.id, score: e.score, bedItem: bedIds.has(e.id) })), shape: r.shape, blockChars: r.block.length });
}
const freq = {}; for (const r of rows.filter(r => r.split === 'test')) for (const p of r.patterns) freq[p] = (freq[p] ?? 0) + 1;
const summary = { index: { entries: index.entries.length, distinctHashes: new Set(index.entries.map(e => e.hash)).size, sha256: indexHash() },
  testPatternFrequency: freq, testExemplarsThatAreBedItems: rows.filter(r => r.split === 'test').reduce((s, r) => s + r.exemplars.filter(e => e.bedItem).length, 0),
  meanExcludedBeyondTarget: rows.reduce((s, r) => s + r.excluded, 0) / rows.length, rows };
for (const r of rows) console.log(`${r.id} ${r.split} excluded=${r.excluded} ${JSON.stringify(r.reasons)} patterns=${r.patterns.join(',')} exemplars=${r.exemplars.map(e => `${e.id}${e.bedItem ? '*' : ''}`).join(',')}`);
console.log(JSON.stringify({ ...summary, rows: undefined }));
const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (out) writeFileSync(out, `${JSON.stringify(summary, null, 1)}\n`);
