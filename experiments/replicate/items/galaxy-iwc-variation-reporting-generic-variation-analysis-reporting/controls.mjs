// Controls for the oracle: outputs that must pass (the original, the reference) and outputs that must fail.
// A control is `make(task) -> output` in the shape oracle() expects: { cases: { <caseId>: tables } }.
// Controls see the evaluation inputs (they play the part of a candidate) but never the expected tables.
import { rng } from '../../../../beds/lib/rng.mjs';
import { battery } from './oracle.mjs';
import { runJob, MUTATIONS, AF_RECALC_HEADER, ALL_VARIANTS_HEADER, BY_VARIANT_HEADER, COMBINED_HEADER } from './reference.mjs';
import { runOriginalWorkflow } from './original-emulator.mjs';
import { shippedCase, TABLES } from './cases.mjs';

const solveAll = (task, fn) => ({ cases: Object.fromEntries(battery(task).map(c => [c.caseId, fn(c.inputs, c)])) });
const strip = ({ _all, ...tables }) => tables;

// ---- must pass ---------------------------------------------------------------------------------------------------

// The reference implementation (also exported as referenceSolve).
export const referenceSolve = task => solveAll(task, inputs => runJob(inputs));

// "Original" control. Galaxy cannot run in this container (README: Original control), so it is built in two parts:
//  * the shipped case answers with the tables the original Galaxy run shipped (verbatim files);
//  * every derived case answers with the output of the ORIGINAL .ga executed step by step by original-emulator.mjs.
export const originalControl = task => solveAll(task, (inputs, c) => (c.kind === 'shipped' ? { ...c.expected } : strip(runOriginalWorkflow(inputs))));

export const passControls = [
  { name: 'reference', make: referenceSolve },
  { name: 'original (shipped tables + .ga emulator)', make: originalControl },
];

// ---- must fail ---------------------------------------------------------------------------------------------------

const tsv = header => header.join('\t') + '\n';
const headerOnly = inputs => ({
  af_recalculated: Object.fromEntries(inputs.samples.map(s => [s.id, tsv(AF_RECALC_HEADER)])),
  all_variants_all_samples: tsv(ALL_VARIANTS_HEADER), by_variant_report: tsv(BY_VARIANT_HEADER), combined_variant_report: tsv(COMBINED_HEADER),
});

function mapTables(t, f) {
  return { af_recalculated: Object.fromEntries(Object.entries(t.af_recalculated).map(([k, v]) => [k, f(v, 'af_recalculated')])),
    ...Object.fromEntries(TABLES.slice(1).map(k => [k, f(t[k], k)])) };
}

export const badControls = [
  // trivial / vacuous
  { name: 'empty', make: () => ({ cases: {} }) },
  { name: 'do-nothing (right headers, no rows)', make: task => solveAll(task, inputs => headerOnly(inputs)) },
  { name: 'echo-input (the first VCF as every table)', make: task => solveAll(task, inputs => ({ af_recalculated: Object.fromEntries(inputs.samples.map(s => [s.id, s.vcf])),
    all_variants_all_samples: inputs.samples[0].vcf, by_variant_report: inputs.samples[0].vcf, combined_variant_report: inputs.samples[0].vcf })) },
  { name: 'shipped-case-only (hard-coded answer, nothing for derived cases)', make: task => ({ cases: { shipped: { ...shippedCase().expected } } }) },
  // corrupted / shuffled
  { name: 'shuffled-rows', make: task => solveAll(task, (inputs, c) => mapTables(runJob(inputs), (text, k) => {
    const [head, ...rows] = text.split('\n').filter(Boolean), r = rng('shuffle', c.caseId, k);
    return [head, ...r.shuffle(rows)].join('\n') + '\n';
  })) },
  { name: 'one-corrupted-cell', make: task => solveAll(task, inputs => {
    const t = runJob(inputs), lines = t.all_variants_all_samples.split('\n'), cells = lines[1].split('\t');
    cells[7] = String(Number(cells[7]) + 0.000001); // AF of the first record
    lines[1] = cells.join('\t');
    return { ...t, all_variants_all_samples: lines.join('\n') };
  }) },
  // plausible but wrong: the plan's broken controls and further near misses
  ...MUTATIONS.map(m => ({ name: `mutation:${m}`, make: task => solveAll(task, inputs => runJob(inputs, { mutation: m })) })),
  // a tidy-up that a T3 "improve" attempt might apply: the original appends the label again on records the input already carries it for
  { name: 'dedupe-filter-label (changes published FILTER text)', make: task => solveAll(task, inputs => mapTables(runJob(inputs), t => t.replace(/(min_af_[^\t;]+);\1/g, '$1'))) },
  // right numbers, wrong shape
  { name: 'crlf-line-endings-and-no-header', make: task => solveAll(task, inputs => mapTables(runJob(inputs), t => t.split('\n').slice(1).join('\r\n'))) },
];
