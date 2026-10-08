// Reference implementation of the job "Generic variation analysis reporting" (IWC, v0.1.1).
//
// STATUS: labelled re-implementation, NOT the original. It computes the four report tables the
// workflow publishes from (params, ordered list of per-sample VCFs). It is validated against the
// tables the original Galaxy run shipped (oracle.mjs health gate; item.test.mjs) and, for the derived
// multi-sample cases, cross-checked against original-emulator.mjs, which interprets the real .ga.
// Modelling choices that the shipped data cannot confirm are listed in README.md ("Unverified semantics").
//
// Job interface (also what a candidate gets):
//   input  { params: { af: number, dp: integer, dp_alt: integer },
//            samples: [ { id: string, vcf: string } ] }      // collection order = array order
//   output { af_recalculated: { [sampleId]: tsv }, all_variants_all_samples: tsv,
//            by_variant_report: tsv, combined_variant_report: tsv }

import { pyFloat, javaFloat, g14, pyRound6, galaxySanitize } from './formats.mjs';

export const EFFECT_COLS = ['IMPACT', 'FUNCLASS', 'EFFECT', 'GENE', 'CODON', 'AA', 'TRID'];
export const AF_RECALC_HEADER = ['CHROM', 'POS', 'FILTER', 'REF', 'ALT', 'DP', 'AF', 'DP4', 'SB',
  ...EFFECT_COLS.map(c => `EFF[*].${c}`), 'DP4[2]', 'DP4[3]', 'AFrecalc'];
export const ALL_VARIANTS_HEADER = ['Sample', 'CHROM', 'POS', 'FILTER', 'REF', 'ALT', 'DP', 'AF', 'AFcaller', 'DP4', 'SB',
  ...EFFECT_COLS, 'change', 'change_with_pos'];
export const BY_VARIANT_HEADER = ['POS', 'REF', 'ALT', ...EFFECT_COLS, 'countunique(Sample)', 'min(AF)', 'max(AF)',
  'SAMPLES(above-thresholds)', 'SAMPLES(all)', 'AFs(all)', 'change'];
export const COMBINED_HEADER = ['Sample', 'POS', 'FILTER', 'REF', 'ALT', 'DP', 'AF', 'AFcaller', 'SB', 'DP4', ...EFFECT_COLS,
  'min(AF)', 'max(AF)', 'countunique(change)', 'countunique(FUNCLASS)', 'change'];

// Deliberate faults used by controls.mjs (mutation testing). Default: faithful.
export const MUTATIONS = ['af-boundary-inclusive', 'no-dp-alt-term', 'first-sample-only', 'no-recalc-swap', 'text-sort-pos',
  'ignore-upstream-filter', 'one-row-per-effect', 'unsorted-combined'];

const bytewise = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const tsv = (header, rows) => [header, ...rows].map(r => r.join('\t')).join('\n') + '\n';

export function parseVcf(text) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f.length < 8) throw new Error(`VCF record with ${f.length} columns: ${line.slice(0, 80)}`);
    const info = new Map();
    for (const part of f[7].split(';')) {
      if (!part) continue;
      const i = part.indexOf('=');
      if (i < 0) info.set(part, true); else info.set(part.slice(0, i), part.slice(i + 1));
    }
    records.push({ chrom: f[0], pos: f[1], ref: f[3], alt: f[4], filter: f[6], info });
  }
  return records;
}

// Top-level comma split of an EFF value (commas inside parentheses stay).
function splitEffects(eff) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < eff.length; i++) {
    const c = eff[i];
    if (c === '(') depth++; else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(eff.slice(start, i)); start = i + 1; }
  }
  out.push(eff.slice(start));
  return out;
}

// SnpEff classic EFF entry: EFFECT(IMPACT|FUNCLASS|CODON|AA|AA_LEN|GENE|BIOTYPE|CODING|TRID|EXON|GENOTYPE[|ERR|WARN])
function effectColumns(entry) {
  const i = entry.indexOf('('), name = entry.slice(0, i), f = entry.slice(i + 1, entry.lastIndexOf(')')).split('|');
  const v = x => (x === undefined || x === '' ? '.' : x);
  return [v(f[0]), f[1] === undefined || f[1] === '' ? 'NONE' : f[1], v(name), v(f[5]), v(f[2]), v(f[3]), v(f[8])];
}

export const filterLabel = p => galaxySanitize(`min_af_${pyFloat(p.af)}|min_dp_${p.dp}|min_dp_alt_${p.dp_alt}`);

// SnpSift expression of step 5, true = record gets the label appended to FILTER.
export function failsThresholds(r, p, mutation) {
  const dp = Number(r.info.get('DP')), af = Number(r.info.get('AF'));
  const [, , a2, a3] = r.info.get('DP4').split(',').map(Number);
  const alt = a2 + a3;
  const lowAlt = mutation === 'af-boundary-inclusive' ? alt <= p.af * dp : alt < p.af * dp;
  const lowDp = dp < p.dp;
  const lowAltDepth = mutation === 'no-dp-alt-term' ? false : af * dp < p.dp_alt - 0.5;
  return lowAlt || lowDp || lowAltDepth;
}

// One sample: steps 4 to 13 of the workflow.
export function processSample(vcf, p, mutation) {
  const label = filterLabel(p), extracted = [], processed = [];
  for (const r of parseVcf(vcf)) {
    const dp = Number(r.info.get('DP'));
    if (!(dp >= 1)) continue; // step 4: SnpSift Filter "DP >= 1"
    let filter = r.filter;
    if (failsThresholds(r, p, mutation)) filter = filter === 'PASS' || filter === '.' || filter === '' ? label : `${filter};${label}`; // step 7 (--addFilter)
    if (mutation === 'ignore-upstream-filter') filter = failsThresholds(r, p) ? label : 'PASS';
    const dp4 = r.info.get('DP4').split(','), eff = r.info.get('EFF');
    const effects = eff ? splitEffects(eff).map(effectColumns) : [Array(7).fill('.')];
    const recalc = pyFloat(pyRound6((Number(dp4[2]) + Number(dp4[3])) / dp)); // step 9
    const af = javaFloat(Number(r.info.get('AF')));
    const rows = effects.map(e => [r.chrom, r.pos, filter, r.ref, r.alt, String(dp), af, r.info.get('DP4'), r.info.get('SB'), ...e, dp4[2], dp4[3], recalc]);
    extracted.push(...rows);
    // steps 10 to 13: collapse effects of one variant, keep the first (highest-impact) one, rename AF columns.
    const first = rows[0];
    const kept = mutation === 'one-row-per-effect' ? rows : [first];
    for (const row of kept) {
      processed.push([row[0], row[1], row[2], row[3], row[4], row[5], recalc, af, row[7], row[8], ...row.slice(9, 16)]);
      if (mutation === 'no-recalc-swap') { const x = processed.at(-1); [x[6], x[7]] = [x[7], x[6]]; }
    }
  }
  return { extracted, processed };
}

export function runJob(job, { mutation } = {}) {
  if (mutation && !MUTATIONS.includes(mutation)) throw new Error(`unknown mutation ${mutation}`);
  const { params: p } = job;
  const per = job.samples.map(s => ({ id: s.id, ...processSample(s.vcf, p, mutation) }));
  const af_recalculated = Object.fromEntries(per.map(s => [s.id, tsv(AF_RECALC_HEADER, s.extracted)]));

  // step 14 to 17: collapse the collection (Sample column first) and add change / change_with_pos
  const used = mutation === 'first-sample-only' ? per.slice(0, 1) : per;
  const all = [];
  for (const s of used) for (const r of s.processed) {
    const change = `${r[3]}>${r[4]}`;
    all.push([s.id, ...r, change, `${parseInt(r[1], 10)}:${change}`]);
  }
  const I = { sample: 0, pos: 2, filter: 3, ref: 4, alt: 5, dp: 6, af: 7, afCaller: 8, dp4: 9, sb: 10, funclass: 12, change: 18, key: 19 };
  const isPass = r => r[I.filter] === 'PASS' || r[I.filter] === '.';
  const group = (rows, by) => { const m = new Map(); for (const r of rows) { const k = by(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const uniq = xs => [...new Set(xs)];
  const nums = rows => rows.map(r => Number(r[I.af]));

  // by variant (steps 18, 21, 22, 25, 28, 31, 33)
  const byKey = group(all, r => r[I.key]);
  const byVariant = [];
  for (const rows of byKey.values()) {
    const pass = rows.filter(isPass);
    if (!pass.length) continue; // inner join with the PASS rows
    const r = pass[0];
    byVariant.push([r[I.pos], r[I.ref], r[I.alt], ...r.slice(11, 18), String(uniq(rows.map(x => x[I.sample])).length),
      g14(Math.min(...nums(rows))), g14(Math.max(...nums(rows))),
      uniq(pass.map(x => x[I.sample])).sort(bytewise).join(','), rows.map(x => x[I.sample]).join(','), rows.map(x => x[I.af]).join(','), r[I.change]]);
  }
  const lineOf = r => r.join('\t');
  const posSort = (a, b) => (mutation === 'text-sort-pos' ? bytewise(a[0], b[0]) : Number(a[0]) - Number(b[0])) || bytewise(lineOf(a), lineOf(b));
  byVariant.sort(posSort);

  // combined report (steps 20, 23, 26, 29, 32, 34)
  const byPos = group(all, r => r[I.pos]);
  const passPos = new Set(all.filter(isPass).map(r => r[I.pos]));
  const combined = [];
  for (const [pos, rows] of byPos) {
    if (!passPos.has(pos)) continue;
    const mn = g14(Math.min(...nums(rows))), mx = g14(Math.max(...nums(rows)));
    const nChange = String(uniq(rows.map(x => x[I.change])).length), nFun = String(uniq(rows.map(x => x[I.funclass])).length);
    for (const r of rows) combined.push([r[I.sample], pos, r[I.filter], r[I.ref], r[I.alt], r[I.dp], r[I.af], r[I.afCaller], r[I.sb], r[I.dp4],
      ...r.slice(11, 18), mn, mx, nChange, nFun, r[I.change]]);
  }
  if (mutation !== 'unsorted-combined') combined.sort((a, b) => bytewise(a[0], b[0]) || Number(a[1]) - Number(b[1]) || bytewise(lineOf(a), lineOf(b)));

  return {
    af_recalculated,
    all_variants_all_samples: tsv(ALL_VARIANTS_HEADER, all),
    by_variant_report: tsv(BY_VARIANT_HEADER, byVariant),
    combined_variant_report: tsv(COMBINED_HEADER, combined),
  };
}
