// Evaluation cases for the item: the shipped case (real data, shipped expected tables) and seeded derived
// multi-sample cases (resampled records of the shipped VCF, 2 to 5 samples, shifted thresholds) whose
// expected tables come from reference.mjs. Derived cases are labelled `derived`; the shipped case is `shipped`.
//
// Everything here is a pure function of (seed, split, difficulty, index): no Math.random, no clock.
import { readFileSync } from 'node:fs';
import { rng } from '../../../../beds/lib/rng.mjs';
import { pyFloat } from './formats.mjs';
import { failsThresholds, filterLabel, runJob } from './reference.mjs';

const fx = rel => readFileSync(new URL(`./fixtures/${rel}`, import.meta.url), 'utf8');
export const SHIPPED_SAMPLE_ID = 'filtered variants ERR3485802';
export const SHIPPED_PARAMS = Object.freeze({ af: 0.05, dp: 1, dp_alt: 10 });
export const TABLES = ['af_recalculated', 'all_variants_all_samples', 'by_variant_report', 'combined_variant_report'];
export const N_DERIVED = 20;

export function shippedCase() {
  const inputs = { params: { ...SHIPPED_PARAMS }, samples: [{ id: SHIPPED_SAMPLE_ID, vcf: fx('shipped/input.vcf') }] };
  const expected = {
    af_recalculated: { [SHIPPED_SAMPLE_ID]: fx('shipped/af_recalculated.tabular') },
    all_variants_all_samples: fx('shipped/all_variants_all_samples.tabular'),
    by_variant_report: fx('shipped/by_variant_report.tabular'),
    combined_variant_report: fx('shipped/combined_variant_report.tabular'),
  };
  return { caseId: 'shipped', kind: 'shipped', inputs, expected, features: { samples: 1, records: 595, params: inputs.params } };
}

// ---- source pool: the shipped records, kept with their raw INFO so annotations stay realistic ----------------
let poolCache;
function pool() {
  if (poolCache) return poolCache;
  const seen = new Set(), recs = [];
  for (const line of fx('shipped/input.vcf').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    const key = `${f[1]}:${f[3]}>${f[4]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const info = f[7].split(';').map(t => { const i = t.indexOf('='); return i < 0 ? [t, null] : [t.slice(0, i), t.slice(i + 1)]; });
    const get = k => info.find(([n]) => n === k)?.[1];
    const dp4 = get('DP4').split(',').map(Number);
    recs.push({ chrom: f[0], pos: Number(f[1]), ref: f[3], alt: f[4], qual: f[5], info, dp: Number(get('DP')), af: Number(get('AF')), alt0: dp4[2] + dp4[3] });
  }
  const effects = [];
  for (const r of recs) { const e = r.info.find(([n]) => n === 'EFF')?.[1]; if (e) effects.push(e); }
  poolCache = { recs, effects };
  return poolCache;
}

const HEADER_BASE = [
  '##fileformat=VCFv4.0',
  '##source=R-bench derived case: records resampled from the IWC test VCF (lofreq call --call-indels, SnpEff 4.3t)',
  '##reference=reference.fa',
  '##INFO=<ID=DP,Number=1,Type=Integer,Description="Raw Depth">',
  '##INFO=<ID=AF,Number=1,Type=Float,Description="Allele Frequency">',
  '##INFO=<ID=SB,Number=1,Type=Integer,Description="Phred-scaled strand bias at this position">',
  '##INFO=<ID=DP4,Number=4,Type=Integer,Description="Counts for ref-forward bases, ref-reverse, alt-forward and alt-reverse bases">',
  '##INFO=<ID=INDEL,Number=0,Type=Flag,Description="Indicates that the variant is an INDEL.">',
  '##INFO=<ID=HRUN,Number=1,Type=Integer,Description="Homopolymer length to the right of report indel position">',
  '##FILTER=<ID=sb_fdr,Description="Strand-Bias Multiple Testing Correction: fdr corr. pvalue > 0.001000">',
  '##INFO=<ID=EFF,Number=.,Type=String,Description="Predicted effects for this variant.Format: \'Effect ( Effect_Impact | Functional_Class | Codon_Change | Amino_Acid_Change| Amino_Acid_length | Gene_Name | Transcript_BioType | Gene_Coding | Transcript_ID | Exon_Rank  | Genotype [ | ERRORS | WARNINGS ] )\' ">',
];
const DEFAULT_EXPR = '( ( DP4[2] + DP4[3] ) < ( 0.05 * DP ) ) | ( DP < 1 ) | ( ( AF * DP ) < ( 10 - 0.5 ) )';
const PREFLAG_HEADER = `##FILTER=<ID=SnpSift,Description="SnpSift 4.3t (build 2017-11-24 10:18), by Pablo Cingolani, Expression used: ${DEFAULT_EXPR}">`;
const COLS = '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// af as the smallest integer ratio num/den (af has at most 3 decimals in every case)
const ratio = af => { const den0 = 1000, num0 = Math.round(af * den0), g = gcd(num0, den0); return [num0 / g, den0 / g]; };

// Observation (DP, AF, SB, DP4) with the arithmetic the caller's VCF obeys: DP4 sums to DP.
function observation(r, src, scaleSd) {
  const dp = Math.max(1, Math.round(src.dp * Math.exp(r.normal(0, scaleSd))));
  const altFrac = clamp((src.alt0 / src.dp) * Math.exp(r.normal(0, 0.35)), 0, 1);
  const alt = Math.round(altFrac * dp), ref = dp - alt;
  const refF = Math.floor(ref * r.float(0.2, 0.8)), altF = Math.round(alt * r.float(0.2, 0.8));
  const af = r.chance(0.3) ? clamp(alt / dp, 0.01, 1) : clamp((alt / dp) * r.float(0.9, 1.1), 0.01, 1);
  return { dp, af: af.toFixed(6), sb: r.chance(0.85) ? 0 : r.int(1, 30), dp4: [refF, ref - refF, altF, alt - altF] };
}

// Distance of the three decision terms from their boundaries; used to keep ordinary records away from
// float-rounding ambiguity (an exact-boundary record is built on purpose only where all evaluators agree).
function ambiguous(o, params) {
  const dp = o.dp, af = Number(o.af), alt = o.dp4[2] + o.dp4[3];
  return Math.abs(alt - params.af * dp) < 1e-6 || Math.abs(af * dp - (params.dp_alt - 0.5)) < 1e-4;
}

const infoText = (src, o, eff) => {
  const parts = [];
  for (const [k, v] of src.info) {
    if (k === 'EFF' || k === 'LOF' || k === 'NMD') continue;
    parts.push(k === 'DP' ? `DP=${o.dp}` : k === 'AF' ? `AF=${o.af}` : k === 'SB' ? `SB=${o.sb}` : k === 'DP4' ? `DP4=${o.dp4.join(',')}` : v === null ? k : `${k}=${v}`);
  }
  if (eff) parts.push(`EFF=${eff}`);
  return parts.join(';');
};

const BASES = ['A', 'C', 'G', 'T'];

// SnpEff writes the effects of one variant sorted by putative impact, highest first (documented for ANN; observed for the classic EFF
// format in all 321 multi-effect records of the seven SnpEff-annotated IWC SARS-CoV-2 test VCFs under /opt/corpus, none of which mixes
// impacts). Generated multi-effect lists follow that order (stable inside one impact), so "keep the first effect" (what the .ga does)
// and "keep the highest-impact effect" (what its step label says) agree, as they do on real SnpEff output. Family v1 used random order.
const IMPACT_RANK = { HIGH: 0, MODERATE: 1, LOW: 2, MODIFIER: 3 };
const impactOf = e => IMPACT_RANK[e.slice(e.indexOf('(') + 1).split('|')[0]] ?? 4;
export const snpEffOrder = list => list.map((e, i) => [e, i]).sort((a, b) => impactOf(a[0]) - impactOf(b[0]) || a[1] - b[1]).map(x => x[0]);
const funclassOf = e => e.slice(e.indexOf('(') + 1).split('|')[1] ?? '';

// Probes added by the adversarial verification (family version 2), drawn from their own random stream `r2` so the other records of a
// case keep their v1 values:
//  * zero-dp       : a record with DP=0. Only step 4 ("DP >= 1") removes it; a solution that skips the prefilter keeps a row for it.
//  * multi-allelic : two SNVs at one POS, both clearly passing, with different FUNCLASS (the shape of the shipped VCF at POS 32029,
//                    135598 and 177899, which never pass there). by_variant_report groups by POS:REF>ALT, combined_variant_report
//                    computes its statistics per POS; a solution that conflates the two now fails every derived case, not one in three.
function probes(r2, effects, used, nSamples) {
  const out = [];
  const freePos = () => { let pos; do { pos = r2.int(1000, 195000); } while (used.has(pos)); used.add(pos); return pos; };
  const targets = () => r2.sample([...Array(nSamples).keys()], Math.min(nSamples, r2.int(1, 2)));
  { const ref = r2.pick(BASES), alt = r2.pick(BASES.filter(b => b !== ref));
    out.push({ tag: 'zero-dp', targets: targets(), recs: [{ pos: freePos(), ref, alt, o: { dp: 0, af: (0).toFixed(6), sb: 0, dp4: [0, 0, 0, 0] }, eff: null }] }); }
  { const pos = freePos(), ref = r2.pick(BASES), alts = r2.sample(BASES.filter(b => b !== ref), 2), dp = r2.pick([100, 120, 150, 200]);
    const e1 = r2.pick(effects), others = effects.filter(e => funclassOf(e) !== funclassOf(e1));
    out.push({ tag: 'multi-allelic', targets: targets(), recs: [
      { pos, ref, alt: alts[0], o: mk(dp, 0.5, dp / 2), eff: e1 },
      { pos, ref, alt: alts[1], o: mk(dp, 0.3, Math.round(0.3 * dp)), eff: others.length ? r2.pick(others) : null }] }); }
  return out;
}

// Observation with DP4 summing to dp, alt reads `alt`, caller AF `af` (the filter expression treats AF and DP4 independently).
const mk = (dp, af, alt) => {
  const ref = dp - alt, refF = Math.floor(ref / 2), altF = Math.floor(alt / 2);
  return { dp, af: af.toFixed(6), sb: 0, dp4: [refF, ref - refF, altF, alt - altF] };
};

// Hand-built records on or next to each decision boundary of the SnpSift expression (every case gets them).
function engineered(p, r) {
  const out = [];
  const snv = () => { const a = r.pick(BASES); return [a, r.pick(BASES.filter(b => b !== a))]; };
  const flagged = o => failsThresholds({ info: new Map([['DP', String(o.dp)], ['AF', o.af], ['DP4', o.dp4.join(',')]]) }, p);
  const adds = (tag, o) => { const [ref, alt] = snv(); out.push({ tag, o, ref, alt }); };
  // boundary-af: alt reads exactly af*DP (not flagged: the AF test is "<"); the integer ratio keeps double and exact arithmetic in agreement
  const [num, den] = ratio(p.af);
  for (let k = 1; k <= 12; k++) {
    const dp = den * k, alt = num * k, o = mk(dp, 1, alt);
    if (dp < Math.max(p.dp, p.dp_alt) || alt < p.af * dp || alt / dp < p.af || flagged(o)) continue;
    adds('boundary-af', o); break;
  }
  // boundary-dp-alt: AF*DP exactly dp_alt - 0.5 (not flagged: the variant-depth test is "<")
  { const dp = 2 * p.dp_alt - 1; if (dp >= p.dp) { const o = mk(dp, 0.5, dp); if (!flagged(o)) adds('boundary-dp-alt', o); } }
  // low-af: only the AF test fires
  { const dp = Math.max(p.dp, p.dp_alt, 40), o = mk(dp, 1, Math.max(0, Math.floor(p.af * dp) - 1)); if (flagged(o)) adds('low-af', o); }
  // low-dp-alt: only the variant-depth test fires
  for (let dp = Math.max(p.dp, 2); dp < 5 * (p.dp_alt - 0.9); dp++) { const o = mk(dp, 0.2, dp); if (flagged(o)) { adds('low-dp-alt', o); break; } }
  // below-dp / boundary-dp: depth just below / exactly at the DP threshold
  if (p.dp >= 2) { const o = mk(p.dp - 1, 1, p.dp - 1); if (flagged(o)) adds('below-dp', o); }
  { const o = mk(p.dp, 1, p.dp); if (!flagged(o)) adds('boundary-dp', o); }
  return out;
}

const PARAM_SETS = {
  af: [0.02, 0.05, 0.05, 0.1, 0.2, 0.25],
  dp: [1, 1, 5, 10, 20],
  dp_alt: [3, 5, 10, 10, 20],
};
const SIZES = { universe: [18, 40, 90, 160, 280] }; // variants per case by difficulty 1..5 (level 3 is the plan's setting)

// opts: { universe, nSamples, params, preflagged, multiEffect }; r2: the probes' own random stream (v2)
function build(r, opts, r2) {
  const { recs, effects } = pool();
  const defaults = SHIPPED_PARAMS, defaultLabel = filterLabel(defaults), p = opts.params;
  const universe = r.sample(recs, opts.universe).sort((a, b) => a.pos - b.pos);
  const used = new Set(universe.map(x => x.pos));
  const ids = new Set();
  while (ids.size < opts.nSamples) ids.add(`filtered variants ERR${3480000 + r.int(0, 99999)}`);
  const sampleIds = [...ids].sort();
  // the effect list is a property of the variant, so every sample that carries it reports the same annotation
  const effOf = new Map();
  for (const v of universe) {
    const own = v.info.find(([n]) => n === 'EFF')?.[1];
    if (opts.multiEffect && r.chance(0.22)) effOf.set(v, snpEffOrder([own ?? r.pick(effects), ...r.sample(effects, r.int(1, 2))]).join(','));
    else effOf.set(v, own ?? null);
  }
  const perSample = sampleIds.map(() => []);
  sampleIds.forEach((id, si) => {
    const keep = r.float(0.55, 0.92);
    for (const v of universe) {
      if (!r.chance(keep)) continue;
      let o = null;
      for (let attempt = 0; attempt < 12 && !o; attempt++) { const c = observation(r, v, 0.5); if (!ambiguous(c, p) && !ambiguous(c, defaults)) o = c; }
      if (o) perSample[si].push({ pos: v.pos, chrom: v.chrom, ref: v.ref, alt: v.alt, qual: v.qual, o, src: v, eff: effOf.get(v) });
    }
  });
  const tags = [];
  for (const e of engineered(p, r)) {
    let pos; do { pos = r.int(1000, 195000); } while (used.has(pos)); used.add(pos);
    const targets = r.sample(sampleIds.map((_, i) => i), Math.min(sampleIds.length, r.int(1, 2)));
    for (const si of targets) perSample[si].push({ pos, chrom: 'KP849471', ref: e.ref, alt: e.alt, qual: '100.0', o: e.o, src: { info: [['DP', ''], ['AF', ''], ['SB', ''], ['DP4', '']] }, eff: null });
    tags.push(e.tag);
  }
  for (const pr of probes(r2, effects, used, sampleIds.length)) {
    for (const si of pr.targets) for (const x of pr.recs) perSample[si].push({ ...x, chrom: 'KP849471', qual: '100.0', filter0: 'PASS', probe: true, src: { info: [['DP', ''], ['AF', ''], ['SB', ''], ['DP4', '']] } });
    tags.push(pr.tag);
  }
  const samples = sampleIds.map((id, si) => {
    const recsS = perSample[si].sort((a, b) => a.pos - b.pos);
    const body = recsS.map(x => {
      let filter = x.filter0 ?? (r.chance(0.05) ? 'sb_fdr' : 'PASS'); // probes take no draw from r
      const probe = { info: new Map([['DP', String(x.o.dp)], ['AF', x.o.af], ['DP4', x.o.dp4.join(',')]]) };
      if (opts.preflagged && failsThresholds(probe, defaults)) filter = filter === 'PASS' ? defaultLabel : `${filter};${defaultLabel}`;
      return [x.chrom, x.pos, '.', x.ref, x.alt, x.qual, filter, infoText(x.src, x.o, x.eff)].join('\t');
    });
    const header = [...HEADER_BASE, ...(opts.preflagged ? [PREFLAG_HEADER] : []), COLS];
    return { id, vcf: [...header, ...body].join('\n') + '\n', n: recsS.filter(x => !x.probe).length };
  });
  return { samples, tags };
}

// choose(r, attempt) -> opts. Retries (deterministically) until the case has enough records and PASS rows to be informative.
function make(seed, split, difficulty, label, index, choose) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng('rbench', 'galaxy-variation-reporting', seed, split, difficulty, label, index, attempt);
    const r2 = rng('rbench', 'galaxy-variation-reporting', 'probes-v2', seed, split, difficulty, label, index, attempt);
    const opts = choose(r);
    const { samples, tags } = build(r, opts, r2);
    if (samples.some(s => s.n < 8)) continue;
    const inputs = { params: opts.params, samples: samples.map(({ id, vcf }) => ({ id, vcf })) };
    const passRows = runJob(inputs).combined_variant_report.split('\n').length - 2;
    if (passRows < 6) continue;
    const features = { kind: label, params: opts.params, preflagged: opts.preflagged, multiEffect: opts.multiEffect, samples: samples.length,
      records: samples.reduce((n, s) => n + s.n, 0), engineered: tags, combinedRows: passRows, attempt };
    return { inputs, features };
  }
  throw new Error(`galaxy-variation-reporting: no valid ${label} case for index ${index}`);
}

// v2: the AF threshold of the 15 shifted cases is stratified (each value in 3 cases) instead of drawn, so a fault that only shows for one
// AF value (e.g. the label printed as min_af_0.10 instead of Python's min_af_0.1) fails at least 3 derived cases and cannot hide inside the
// 18-of-20 tolerance. The draw is still made, so the rest of the case's random stream is unchanged.
const AF_STRATA = [0.02, 0.1, 0.2, 0.25, 0.05];
const chooseDerived = (index, difficulty) => r => {
  let params;
  if (index % 4 === 0) params = { ...SHIPPED_PARAMS };
  else { r.pick(PARAM_SETS.af); params = { af: AF_STRATA[(index - 1 - Math.floor(index / 4)) % AF_STRATA.length], dp: r.pick(PARAM_SETS.dp), dp_alt: r.pick(PARAM_SETS.dp_alt) }; }
  if (index % 4 !== 0 && params.af === 0.05 && params.dp === 1 && params.dp_alt === 10) params.dp = 5; // "shifted": never the defaults
  return { universe: SIZES.universe[difficulty - 1] + r.int(-3, 8), nSamples: 2 + (index % 4), params,
    preflagged: index % 2 === 0 || index % 3 === 0, multiEffect: index % 2 === 1 };
};
// examples: 1 = default thresholds, pre-flagged input (its header shows the SnpSift expression); 2 = shifted thresholds, raw input;
// 3 = shifted thresholds, pre-flagged input with multi-effect records
const chooseExample = index => r => {
  const params = index === 0 ? { ...SHIPPED_PARAMS } : index === 1 ? { af: 0.1, dp: 10, dp_alt: 5 } : { af: 0.02, dp: 1, dp_alt: 20 };
  return { universe: 14, nSamples: 2, params, preflagged: index !== 1, multiEffect: index === 2 };
};

export function derivedCase({ seed, split, difficulty = 3, index }) {
  const { inputs, features } = make(seed, split, difficulty, 'derived', index, chooseDerived(index, difficulty));
  return { caseId: `derived-${String(index).padStart(2, '0')}`, kind: 'derived', inputs, features };
}

export function batteryInputs({ seed, split, difficulty = 3 }) {
  return [shippedCase(), ...Array.from({ length: N_DERIVED }, (_, index) => derivedCase({ seed, split, difficulty, index }))];
}

// Small worked examples a T2 solver may read (a separate random stream: never an evaluation case).
export function exampleCase({ seed, split, difficulty = 3, index }) {
  const { inputs, features } = make(seed, split, difficulty, 'example', index, chooseExample(index));
  return { caseId: `example-${index + 1}`, kind: 'example', inputs, features, expected: runJob(inputs) };
}
