// Independent implementation of the job, written by the adversarial verifier (2026-10-08) from the .ga and the shipped tables, NOT
// from reference.mjs. Trusted host code used only by item.test.mjs: it shows that a second, separately written faithful solution passes
// (the oracle is not tied to the reference's incidental choices) and, through `opts`, that plausible alternatives and faults land on
// the right side of the verdict:
//   effectPick 'first' | 'maxImpact'   which effect of a multi-effect record is kept (both are correct on SnpEff-ordered input)
//   labelAf 'py' | 'fixed2'           how the AF threshold is printed in the FILTER label (fixed2 = min_af_0.10: wrong)
//   round 'py' | 'js'                 Python round() vs Math.round at exact binary ties (js: wrong only on rare tie values)
//   prefilter true | false            skip step 4 (DP >= 1): wrong
//   byVariantKey 'cwp' | 'pos'        group by_variant_report by POS instead of POS:REF>ALT: wrong
//   posCounts 'real' | 'one'          countunique(change|FUNCLASS) per position hard-coded to 1: wrong
//   minmaxPassOnly, countPassOnly, combinedPassOnly, combinedPosFirst   partial or misordered aggregation: wrong
//   minmaxFmt 'g14' | 'raw'            min/max printed with %.14g or String(x) (identical for these values)
const IMPACT_RANK = { HIGH: 4, MODERATE: 3, LOW: 2, MODIFIER: 1 };
function pyRepr(x) {
  if (x === 0) return '0.0';
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return `${x}.0`;
  let s = String(x);
  if (/e/.test(s)) { const [m, e] = s.split('e'); const n = Number(e); s = `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`; }
  return s;
}
// Python round(x, 6) via exact decimal expansion of the double
function pyRound6(x) {
  const s = x.toFixed(60); const [ip, fp] = s.split('.');
  let n = BigInt(ip + fp.slice(0, 6)); const rest = fp.slice(6);
  const cmp = rest.replace(/0+$/, '') === '5' ? 0 : rest > '5' ? 1 : -1;
  if (cmp > 0 || (cmp === 0 && n % 2n === 1n)) n += 1n;
  return Number(n) / 1e6;
}
function g14(x) { // %.14g
  let s = x.toPrecision(14);
  if (s.includes('e')) { let [m, e] = s.split('e'); if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, ''); const n = Number(e); return `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`; }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
const javaFloat = x => { const s = String(x); return s.includes('.') || s.includes('e') ? s : `${s}.0`; };
function splitTop(s) { const out = []; let d = 0, st = 0; for (let i = 0; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')') d--; else if (s[i] === ',' && !d) { out.push(s.slice(st, i)); st = i + 1; } } out.push(s.slice(st)); return out; }

export function solve(job, o = {}) {
  const { af, dp: dpMin, dp_alt } = job.params;
  const afTxt = o.labelAf === 'fixed2' ? af.toFixed(2) : pyRepr(af);
  const label = `min_af_${afTxt}Xmin_dp_${dpMin}Xmin_dp_alt_${dp_alt}`;
  const H1 = 'CHROM\tPOS\tFILTER\tREF\tALT\tDP\tAF\tDP4\tSB\tEFF[*].IMPACT\tEFF[*].FUNCLASS\tEFF[*].EFFECT\tEFF[*].GENE\tEFF[*].CODON\tEFF[*].AA\tEFF[*].TRID\tDP4[2]\tDP4[3]\tAFrecalc';
  const afr = {}, all = [];
  for (const s of job.samples) {
    const rows = [];
    for (const line of s.vcf.split('\n')) {
      if (!line || line[0] === '#') continue;
      const f = line.split('\t'); const info = {};
      for (const kv of f[7].split(';')) { const i = kv.indexOf('='); if (i < 0) info[kv] = true; else info[kv.slice(0, i)] = kv.slice(i + 1); }
      const DP = Number(info.DP);
      if (o.prefilter !== false && !(DP >= 1)) continue;
      const dp4 = info.DP4.split(',');
      const altN = Number(dp4[2]) + Number(dp4[3]), AF = Number(info.AF);
      let filter = f[6];
      if (altN < af * DP || DP < dpMin || AF * DP < dp_alt - 0.5) filter = (filter === 'PASS' || filter === '.' || filter === '') ? label : `${filter};${label}`;
      const raw = DP > 0 ? altN / DP : 0; // only reachable with prefilter:false (a guarded division)
      const rec = o.round === 'js' ? Math.round(raw * 1e6) / 1e6 : pyRound6(raw);
      const recTxt = pyRepr(rec);
      let effs = info.EFF ? splitTop(info.EFF).map(e => { const nm = e.slice(0, e.indexOf('(')); const p = e.slice(e.indexOf('(') + 1, e.lastIndexOf(')')).split('|'); const v = x => (x ? x : '.'); return { IMPACT: v(p[0]), FUNCLASS: p[1] ? p[1] : 'NONE', EFFECT: v(nm), GENE: v(p[5]), CODON: v(p[2]), AA: v(p[3]), TRID: v(p[8]) }; })
        : [{ IMPACT: '.', FUNCLASS: '.', EFFECT: '.', GENE: '.', CODON: '.', AA: '.', TRID: '.' }];
      const effCols = e => [e.IMPACT, e.FUNCLASS, e.EFFECT, e.GENE, e.CODON, e.AA, e.TRID];
      const base = [f[0], f[1], filter, f[3], f[4], String(DP), javaFloat(AF), info.DP4, info.SB];
      for (const e of effs) afr[s.id] = (afr[s.id] ?? H1 + '\n') + [...base, ...effCols(e), dp4[2], dp4[3], recTxt].join('\t') + '\n';
      let pick = effs[0];
      if (o.effectPick === 'maxImpact') pick = effs.reduce((b, e) => ((IMPACT_RANK[e.IMPACT] ?? 0) > (IMPACT_RANK[b.IMPACT] ?? 0) ? e : b), effs[0]);
      const change = `${f[3]}>${f[4]}`;
      all.push([s.id, f[0], f[1], filter, f[3], f[4], String(DP), recTxt, javaFloat(AF), info.DP4, info.SB, ...effCols(pick), change, `${parseInt(f[1], 10)}:${change}`]);
    }
    if (!(s.id in afr)) afr[s.id] = H1 + '\n';
  }
  const tsv = (h, rows) => [h, ...rows.map(r => r.join('\t'))].join('\n') + '\n';
  const H2 = 'Sample\tCHROM\tPOS\tFILTER\tREF\tALT\tDP\tAF\tAFcaller\tDP4\tSB\tIMPACT\tFUNCLASS\tEFFECT\tGENE\tCODON\tAA\tTRID\tchange\tchange_with_pos';
  const pass = r => r[3] === 'PASS' || r[3] === '.';
  const fmt = o.minmaxFmt === 'raw' ? x => String(x) : g14;
  // by variant
  const keyOf = o.byVariantKey === 'pos' ? r => r[2] : r => r[19];
  const g = new Map(); for (const r of all) { const k = keyOf(r); if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  const bv = [];
  for (const rows of g.values()) {
    const p = rows.filter(pass); if (!p.length) continue; const r = p[0];
    const afs = (o.minmaxPassOnly ? p : rows).map(x => Number(x[7]));
    bv.push([r[2], r[4], r[5], ...r.slice(11, 18), String(new Set((o.countPassOnly ? p : rows).map(x => x[0])).size), fmt(Math.min(...afs)), fmt(Math.max(...afs)),
      [...new Set(p.map(x => x[0]))].sort().join(','), rows.map(x => x[0]).join(','), rows.map(x => x[7]).join(','), r[18]]);
  }
  bv.sort((a, b) => Number(a[0]) - Number(b[0]));
  const H3 = 'POS\tREF\tALT\tIMPACT\tFUNCLASS\tEFFECT\tGENE\tCODON\tAA\tTRID\tcountunique(Sample)\tmin(AF)\tmax(AF)\tSAMPLES(above-thresholds)\tSAMPLES(all)\tAFs(all)\tchange';
  // combined
  const gp = new Map(); for (const r of all) { if (!gp.has(r[2])) gp.set(r[2], []); gp.get(r[2]).push(r); }
  const cb = [];
  for (const [pos, rows] of gp) {
    if (!rows.some(pass)) continue;
    const afs = rows.map(x => Number(x[7]));
    const nC = o.posCounts === 'one' ? '1' : String(new Set(rows.map(x => x[18])).size), nF = o.posCounts === 'one' ? '1' : String(new Set(rows.map(x => x[12])).size);
    for (const r of (o.combinedPassOnly ? rows.filter(pass) : rows)) cb.push([r[0], pos, r[3], r[4], r[5], r[6], r[7], r[8], r[10], r[9], ...r.slice(11, 18), fmt(Math.min(...afs)), fmt(Math.max(...afs)), nC, nF, r[18]]);
  }
  cb.sort(o.combinedPosFirst ? (a, b) => Number(a[1]) - Number(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) : (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || Number(a[1]) - Number(b[1]));
  const H4 = 'Sample\tPOS\tFILTER\tREF\tALT\tDP\tAF\tAFcaller\tSB\tDP4\tIMPACT\tFUNCLASS\tEFFECT\tGENE\tCODON\tAA\tTRID\tmin(AF)\tmax(AF)\tcountunique(change)\tcountunique(FUNCLASS)\tchange';
  return { af_recalculated: afr, all_variants_all_samples: tsv(H2, all), by_variant_report: tsv(H3, bv), combined_variant_report: tsv(H4, cb) };
}
