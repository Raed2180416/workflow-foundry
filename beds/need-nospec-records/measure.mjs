// Reproduces the size table of the README: node beds/need-nospec-records/measure.mjs [firstSeed=601] [count=40]
// Tokens are UTF-8 bytes / 4 (beds/lib/canonical.mjs estimateTokens), the method of the records README.
import * as bed from './index.mjs';
import { estimateTokens } from '../lib/canonical.mjs';
import { inlineRender } from '../../experiments/lib/beds.mjs';

export const SEED_FIRST = 601, SEED_COUNT = 40;
const stat = xs => ({ avg: xs.reduce((s, x) => s + x, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) });
const fmt = n => Math.round(n).toLocaleString('en-US');
export const fmtStat = s => `${fmt(s.avg)} [${fmt(s.min)}..${fmt(s.max)}]`;

/** Per difficulty: input tokens of the task, of the new batch alone, per example, of the paired records task, and the inline render. */
export function measure(first = SEED_FIRST, count = SEED_COUNT) {
  const out = {};
  for (const d of [1, 2, 3, 4, 5]) {
    const rows = { total: [], newBatch: [], example: [], records: [], inline: [], people: [], exampleRecords: [] };
    for (let seed = first; seed < first + count; seed++) {
      const t = bed.generate({ seed, split: 'dev', difficulty: d });
      const { examples, ...batch } = t.inputs;
      rows.total.push(bed.inputTokens(t));
      rows.newBatch.push(estimateTokens(t.prompt) + estimateTokens(batch));
      for (const ex of examples) rows.example.push(estimateTokens(ex));
      rows.records.push(bed.inputTokens(bed.pairedRecordsTask(t)));
      rows.inline.push(estimateTokens(inlineRender(t)));
      rows.people.push(bed.referenceSolve(t).records.length);
      rows.exampleRecords.push(examples.reduce((s, ex) => s + ex.output.records.length, 0));
    }
    out[d] = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, stat(v)]));
    out[d].examples = bed.EXAMPLE_COUNT[d];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const first = Number(process.argv[2] ?? SEED_FIRST), count = Number(process.argv[3] ?? SEED_COUNT);
  const m = measure(first, count);
  console.log(`seeds ${first}..${first + count - 1}, split dev (tokens = UTF-8 bytes / 4)`);
  for (const d of [1, 2, 3, 4, 5]) {
    const r = m[d];
    console.log(`d${d}  k=${r.examples}  input tokens ${fmtStat(r.total)}  | new batch + prompt ${fmtStat(r.newBatch)}  | per example ${fmtStat(r.example)}`
      + `  | records same seed ${fmtStat(r.records)}  | inline render ${fmtStat(r.inline)}  | people ${fmt(r.people.avg)}  | example records ${fmt(r.exampleRecords.avg)}`);
  }
}
