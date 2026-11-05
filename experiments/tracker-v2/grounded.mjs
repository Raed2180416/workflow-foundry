#!/usr/bin/env node
// Grounded catches (analysis, no model call; added 2026-11-04 after scoring, reported beside the preregistered build-level numbers):
// a defective build the tracker flags is caught FOR A REASON only if at least one of its unmet (build, condition) entries carries an
// adjudication label "true" or "oracle-gap" (adjudicate.mjs groups). A build flagged only by unmets labelled false is caught by luck:
// the alarm points the person at something the build does right.
//   node experiments/tracker-v2/grounded.mjs [--dir research/tracker-20261021/heldout]
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { canonical } from '../../src/data.mjs';

const { values: a } = parseArgs({ options: { dir: { type: 'string' } } });
const dir = path.resolve(a.dir ?? 'research/tracker-20261021/heldout');
const readJson = f => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const groups = readJson('adjudication.json').groups;
// Same key as adjudicate.mjs: case, the check, and the failing items with their reasons (view-free).
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
const normWhy = w => String(w ?? '').replace(/\b(base|targeted|repeat)(:[\w-]+)*:e\d+/g, 'e');
for (const f of readdirSync(dir).filter(f => /^judge-.*\.json$/.test(f)).sort()) {
  const j = readJson(f), bind = readJson(j.bind);
  for (const view of ['t2', 't2Solo']) {
    let caught = 0, grounded = 0, fa = 0;
    const lucky = [];
    for (const [id, b] of Object.entries(j.builds)) {
      if (!b[view]) continue;
      const unmet = Object.entries(b[view]).filter(([, s]) => s.status === 'unmet');
      if (!unmet.length) continue;
      if (b.verified) { fa++; continue; }
      caught++;
      const labels = unmet.map(([cid, s]) => {
        const cond = (bind.cases[b.case] ?? []).find(c => c.id === cid);
        const why = (s.evidence ?? []).map(e => `${e.item ?? ''} ${normWhy(e.why)}`).sort().join(' | ');
        const g = groups[`${b.case}:${sha(`${canonical(cond?.check ?? null)}\u0000${why}`)}`];
        return (g?.byBuild?.[id] ?? g)?.label ?? null;
      });
      if (labels.some(l => l === 'true' || l === 'oracle-gap')) grounded++; else lucky.push(id);
    }
    console.log(`${f.padEnd(52)} ${view.padEnd(6)} caught ${String(caught).padStart(2)} grounded ${String(grounded).padStart(2)} by luck ${String(caught - grounded).padStart(2)} FA ${String(fa).padStart(2)}${lucky.length ? `  lucky: ${lucky.join(' ')}` : ''}`);
  }
}
