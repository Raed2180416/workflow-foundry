#!/usr/bin/env node
// What A2's leave-one-out retrieval returns for every wave-2 item, at $0 (analysis; wave 1: experiments/ci1-posthoc/retrieval-report.mjs):
// whether the target is in the index (so same-author and same-structure exclusions apply), exclusions by reason, the 3 pattern cards
// and the 3 corpus exemplars (ids, scores; skeletons stay local), and whether an exemplar is a wave-1 or wave-2 bed item.
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/retrieval-w2.mjs [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieve, buildIndex, indexHash } from '../ci1/retrieve.mjs';
import { BED } from '../ci1/bed.mjs';
import { SPLIT_W2 } from './manifest-w2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const w1 = JSON.parse(readFileSync(path.join(here, '../../research/ci1-20261021/SPLIT.json'), 'utf8'));
const w2 = JSON.parse(readFileSync(SPLIT_W2, 'utf8'));
const wave1 = new Set([...w1.dev, ...w1.test]), wave2 = new Set(w2.test);
const index = buildIndex();
const rows = [];
for (const id of w2.test) {
  const spec = JSON.parse(readFileSync(path.join(BED, 'items', id, 'spec.json'), 'utf8'));
  const request = readFileSync(path.join(BED, 'items', id, 'description.md'), 'utf8');
  const r = retrieve({ request, workspace: spec.workspace, targetId: id, index });
  const reasons = Object.values(r.exclusionReasons).reduce((m, x) => { const k = x.replace(/ \(.*/, ''); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  rows.push({ id, inIndex: index.entries.some(e => e.id === id), excluded: r.excluded, reasons, patterns: r.patterns.map(p => p.id),
    exemplars: r.exemplars.map(e => ({ id: e.id, score: e.score, wave1: wave1.has(e.id), wave2: wave2.has(e.id) })) });
}
const freq = {}; for (const r of rows) for (const p of r.patterns) freq[p] = (freq[p] ?? 0) + 1;
const summary = { index: { entries: index.entries.length, distinctHashes: new Set(index.entries.map(e => e.hash)).size, sha256: indexHash() }, patternFrequency: freq,
  exemplarsThatAreBedItems: { wave1: rows.reduce((s, r) => s + r.exemplars.filter(e => e.wave1).length, 0), wave2: rows.reduce((s, r) => s + r.exemplars.filter(e => e.wave2).length, 0) },
  targetsInIndex: rows.filter(r => r.inIndex).length, meanExcludedBeyondTarget: rows.reduce((s, r) => s + r.excluded, 0) / rows.length, rows };
for (const r of rows) console.log(`${r.id} inIndex=${r.inIndex} excluded=${r.excluded} ${JSON.stringify(r.reasons)} patterns=${r.patterns.join(',')} exemplars=${r.exemplars.map(e => `${e.id}${e.wave1 ? '(w1)' : ''}${e.wave2 ? '(w2)' : ''}`).join(',')}`);
console.log(JSON.stringify({ ...summary, rows: undefined }));
const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (out) writeFileSync(out, `${JSON.stringify(summary, null, 1)}\n`);
