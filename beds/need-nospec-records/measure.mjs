// Reproduces the size table of the README: node beds/need-nospec-records/measure.mjs [firstSeed=601] [count=40]
// and its wider $0 probe (example rejections, the three no-spec controls, referenceSolve): node beds/need-nospec-records/measure.mjs --probe
// Tokens are UTF-8 bytes / 4 (beds/lib/canonical.mjs estimateTokens), the method of the records README.
import * as bed from './index.mjs';
import { estimateTokens } from '../lib/canonical.mjs';
import { inlineRender } from '../../experiments/lib/beds.mjs';
import * as P from '../records/pools.mjs';
import { exampleSeed } from './examples.mjs';

export const SEED_FIRST = 601, SEED_COUNT = 40;
const callingCodes = [...new Set(Object.values(P.COUNTRIES).map(c => c.cc))];
const ccOf = phone => (phone === null ? null : callingCodes.find(cc => phone.startsWith(`+${cc}`)) ?? null);
/** Share of the calling codes in the batch's true phone numbers that also occur in some example's master records. */
export function ccCoverage(task) {
  const need = new Set(bedTruth(task).map(r => ccOf(r.phone_e164)).filter(Boolean));
  const seen = new Set(task.inputs.examples.flatMap(e => e.output.records.map(r => ccOf(r.phone_e164))).filter(Boolean));
  return need.size ? [...need].filter(cc => seen.has(cc)).length / need.size : 1;
}
const bedTruth = task => bed.referenceSolve(task).records;
export const fmtCoverage = fracs => fracs.map(x => `${(x * 100).toFixed(1)}%`).join(' / ');
const stat = xs => ({ avg: xs.reduce((s, x) => s + x, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) });
const fmt = n => Math.round(n).toLocaleString('en-US');
export const fmtStat = s => `${fmt(s.avg)} [${fmt(s.min)}..${fmt(s.max)}]`;

/** Per difficulty: input tokens of the task, of the new batch alone, per example, of the paired records task, and the inline render. */
export function measure(first = SEED_FIRST, count = SEED_COUNT) {
  const out = {};
  for (const d of [1, 2, 3, 4, 5]) {
    const rows = { total: [], newBatch: [], example: [], records: [], inline: [], people: [], exampleRecords: [], cc: [] };
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
      rows.cc.push(ccCoverage(t));
    }
    out[d] = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, stat(v)]));
    out[d].examples = bed.EXAMPLE_COUNT[d];
  }
  return out;
}

/** Wider probe, seeds 1-200 at d1-d2 and 1-60 at d3-d5 (odd seeds on the dev split, even on the test split). */
export function probe() {
  const NEW = ['plausible-but-wrong:copy-example-output', 'plausible-but-wrong:example-rates-reused', 'plausible-but-wrong:trunk-prefix-kept'];
  const ctl = Object.fromEntries(bed.badControls.map(c => [c.name, c]));
  const out = { picks: 0, rejected: 0, maxAttempt: 0, perDifficulty: {} };
  for (const d of [1, 2, 3, 4, 5]) {
    const n = d <= 2 ? 200 : 60;
    const row = { tasks: n, referencePass: 0, controlFailures: Object.fromEntries(NEW.map(c => [c, 0])) };
    for (let seed = 1; seed <= n; seed++) {
      const split = seed % 2 ? 'dev' : 'test';
      const t = bed.generate({ seed, split, difficulty: d });
      if (bed.oracle(t, bed.referenceSolve(t)).pass) row.referencePass++;
      bed.exampleRefs(t).forEach((ref, j) => {
        let attempt = 0;
        while (exampleSeed(seed, split, d, j, attempt) !== ref.seed) attempt++;
        out.picks++; out.rejected += attempt; out.maxAttempt = Math.max(out.maxAttempt, attempt);
      });
      for (const name of NEW) if (!bed.oracle(t, ctl[name].make(t)).pass) row.controlFailures[name]++;
    }
    out.perDifficulty[d] = row;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--probe') {
    console.log(JSON.stringify(probe(), null, 1));
  } else {
    const first = Number(process.argv[2] ?? SEED_FIRST), count = Number(process.argv[3] ?? SEED_COUNT);
    const m = measure(first, count);
    console.log(`seeds ${first}..${first + count - 1}, split dev (tokens = UTF-8 bytes / 4)`);
    for (const d of [1, 2, 3, 4, 5]) {
      const r = m[d];
      console.log(`d${d}  k=${r.examples}  input tokens ${fmtStat(r.total)}  | new batch + prompt ${fmtStat(r.newBatch)}  | per example ${fmtStat(r.example)}`
        + `  | records same seed ${fmtStat(r.records)}  | inline render ${fmtStat(r.inline)}  | people ${fmt(r.people.avg)}  | example records ${fmt(r.exampleRecords.avg)}`);
    }
    console.log(`calling-code coverage: ${fmtCoverage([1, 2, 3, 4, 5].map(d => m[d].cc.avg))}`);
  }
}
