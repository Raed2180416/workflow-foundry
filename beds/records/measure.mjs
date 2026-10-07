// Reproduces the measured tables in README.md: input size per difficulty and the single-judgment
// ablation table. Usage: node beds/records/measure.mjs [seeds=30] [split=dev]
import * as bed from './index.mjs';
import { solveText, ABLATIONS } from './solve-text.mjs';
import { estimateTokens } from '../lib/canonical.mjs';

const N = Number(process.argv[2] ?? 30), split = process.argv[3] ?? 'dev';
const seed0 = split === 'test' ? 5000 : 0;
const DIFFS = [1, 2, 3, 4, 5];
const tasks = Object.fromEntries(DIFFS.map(d => [d, Array.from({ length: N }, (_, i) => bed.generate({ seed: seed0 + i, split, difficulty: d }))]));
const avg = a => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
const fmt = n => n.toLocaleString('en-US');

console.log(`Input size over ${N} ${split} seeds (estimateTokens(prompt) + estimateTokens(inputs))`);
for (const d of DIFFS) {
  const tok = tasks[d].map(t => estimateTokens(t.prompt) + estimateTokens(t.inputs));
  const notes = tasks[d].map(t => estimateTokens(t.inputs.source_notes));
  const ents = tasks[d].map(t => bed.referenceSolve(t).records.length);
  const rows = tasks[d][0].inputs.export.split('\n').length;
  console.log(`d${d}  rows ${rows}  tokens avg ${fmt(avg(tok))} [${fmt(Math.min(...tok))}..${fmt(Math.max(...tok))}]  notes avg ${fmt(avg(notes))}`
    + `  people avg ${avg(ents)} [${Math.min(...ents)}..${Math.max(...ents)}]`);
}

console.log(`\nSingle-judgment ablations of the text-level solver: pass rate (mean score) over ${N} ${split} seeds`);
console.log('ablation'.padEnd(22) + DIFFS.map(d => `d${d}`.padEnd(14)).join(''));
for (const ab of [null, ...ABLATIONS]) {
  const cells = DIFFS.map(d => {
    let pass = 0, score = 0;
    for (const t of tasks[d]) { const r = bed.oracle(t, solveText(t, { ablate: ab })); pass += r.pass; score += r.score; }
    return `${String(Math.round((100 * pass) / N)).padStart(3)}% (${(score / N).toFixed(2)})`.padEnd(14);
  });
  console.log((ab ?? 'none').padEnd(22) + cells.join(''));
}
