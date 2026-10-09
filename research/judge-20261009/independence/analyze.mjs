// Row 18, step 7: are Jev's errors independent of Claude's? Reads data/sample.jsonl + data/rows-<model>.jsonl.
//   node --max-old-space-size=1024 research/judge-20261009/independence/analyze.mjs
// Writes out/independence-analysis.json and out/independence-tables.md.
// Statistics (J = Jev wrong, M = model wrong; cells a = both wrong, b = J wrong & M right, c = J right & M wrong, d = both right):
//   - sample 2x2, phi, Yule's Q, odds ratio (0.5 added to every cell when one is 0) with a Wald 95% CI, Fisher exact two-sided p;
//   - conditional error rates P(M wrong | J wrong) and P(M wrong | J right); P(M wrong) on the sample and design-weighted (population);
//   - Mantel-Haenszel common odds ratio across ports (difficulty-adjusted) with the Robins-Breslow-Greenland 95% CI and the CMH test;
//   - design-weighted phi on the 1,181-item population (weights = stratum size / quota), stratified bootstrap 95% CI (B = 4000, seed fixed).
// The sample is oversampled on Jev errors and on three ports: the odds ratio, Yule's Q and the conditional rates are unaffected by
// sampling on J within a port; the raw sample phi and the sample P(M wrong) are not, so both are given and the weighted phi is the headline phi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(here, 'data'), OUT = path.join(here, 'out');
fs.mkdirSync(OUT, { recursive: true });
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const sample = readJsonl(path.join(D, 'sample.jsonl'));
const MODELS = fs.readdirSync(D).filter(f => /^rows-.*\.jsonl$/.test(f)).map(f => f.replace(/^rows-|\.jsonl$/g, '')).sort();
const reads = {};
for (const m of MODELS) { const rs = readJsonl(path.join(D, `rows-${m}.jsonl`)); reads[m] = new Map(rs.filter(r => !r.fault).map(r => [r.idx, r])); }

// ---------- helpers ----------
const lf = (() => { const t = [0]; for (let i = 1; i < 2000; i++) t.push(t[i - 1] + Math.log(i)); return n => t[n]; })();
const lchoose = (n, k) => lf(n) - lf(k) - lf(n - k);
export function fisher2(a, b, c, d) {   // two-sided exact p: sum of tables (same margins) no more probable than the observed one
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const lp = x => lchoose(r1, x) + lchoose(r2, c1 - x) - lchoose(n, c1);
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1), p0 = lp(a);
  let p = 0; for (let x = lo; x <= hi; x++) if (lp(x) <= p0 + 1e-9) p += Math.exp(lp(x));
  return Math.min(1, p);
}
function table(items, jw, mw) {
  let a = 0, b = 0, c = 0, d = 0;
  for (const it of items) { const J = jw(it), M = mw(it); if (J && M) a++; else if (J) b++; else if (M) c++; else d++; }
  return { a, b, c, d, n: a + b + c + d };
}
const phi = ({ a, b, c, d }) => { const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d)); return den ? (a * d - b * c) / den : null; };
const yuleQ = ({ a, b, c, d }) => (a * d + b * c ? (a * d - b * c) / (a * d + b * c) : null);
function orWald({ a, b, c, d }) {
  const z = [a, b, c, d].some(x => x === 0) ? 0.5 : 0, A = a + z, B = b + z, C = c + z, Dd = d + z;
  const lor = Math.log((A * Dd) / (B * C)), se = Math.sqrt(1 / A + 1 / B + 1 / C + 1 / Dd);
  return { or: Math.exp(lor), lo: Math.exp(lor - 1.96 * se), hi: Math.exp(lor + 1.96 * se), corrected: z > 0 };
}
function mantelHaenszel(strata) {   // strata: [{a,b,c,d}]
  let R = 0, S = 0, P = 0, Q = 0, PR = 0, PS_QR = 0, QS = 0;
  const parts = [];
  for (const t of strata) {
    const n = t.a + t.b + t.c + t.d; if (n < 2) continue;
    const r = (t.a * t.d) / n, s = (t.b * t.c) / n, p = (t.a + t.d) / n, q = (t.b + t.c) / n;
    R += r; S += s; PR += p * r; PS_QR += p * s + q * r; QS += q * s; parts.push(t);
  }
  if (!S || !R) return { or: R && !S ? Infinity : null, strata: parts.length };
  const or = R / S, se = Math.sqrt(PR / (2 * R * R) + PS_QR / (2 * R * S) + QS / (2 * S * S));
  // CMH test (no continuity correction)
  let num = 0, vsum = 0;
  for (const t of parts) { const n = t.a + t.b + t.c + t.d, r1 = t.a + t.b, c1 = t.a + t.c, e = (r1 * c1) / n; num += t.a - e; vsum += (r1 * (n - r1) * c1 * (n - c1)) / (n * n * (n - 1)); }
  const chi2 = vsum ? (num * num) / vsum : null;
  return { or, lo: Math.exp(Math.log(or) - 1.96 * se), hi: Math.exp(Math.log(or) + 1.96 * se), chi2, strata: parts.length };
}
const chi2p1 = x => { // upper tail of chi-square with 1 df: erfc(sqrt(x/2))
  const t = Math.sqrt(x / 2), z = 1 / (1 + 0.5 * t);
  const erfc = z * Math.exp(-t * t - 1.26551223 + z * (1.00002368 + z * (0.37409196 + z * (0.09678418 + z * (-0.18628806 + z * (0.27886807 + z * (-1.13520398 + z * (1.48851587 + z * (-0.82215223 + z * 0.17087277)))))))));
  return erfc;
};
function weightedPhi(items, jw, mw) {   // design-weighted on the population
  let W = 0, pJ = 0, pM = 0, pJM = 0;
  for (const it of items) { const w = it.weight; W += w; if (jw(it)) pJ += w; if (mw(it)) pM += w; if (jw(it) && mw(it)) pJM += w; }
  pJ /= W; pM /= W; pJM /= W;
  const den = Math.sqrt(pJ * (1 - pJ) * pM * (1 - pM));
  return { pJ, pM, pJM, phi: den ? (pJM - pJ * pM) / den : null, pMgivenJ: pJ ? pJM / pJ : null, pMgivenNotJ: pJ < 1 ? (pM - pJM) / (1 - pJ) : null, N: W };
}
let rngState = 20261009;
const rnd = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };
function bootPhi(items, jw, mw, B = 4000) {
  const by = new Map(); for (const it of items) { if (!by.has(it.stratum)) by.set(it.stratum, []); by.get(it.stratum).push(it); }
  const vals = [];
  for (let i = 0; i < B; i++) {
    const rs = []; for (const g of by.values()) for (let k = 0; k < g.length; k++) rs.push(g[Math.floor(rnd() * g.length)]);
    const w = weightedPhi(rs, jw, mw); if (w.phi != null) vals.push(w.phi);
  }
  vals.sort((x, y) => x - y);
  return { lo: vals[Math.floor(0.025 * vals.length)], hi: vals[Math.floor(0.975 * vals.length)], n: vals.length };
}
const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);

// ---------- per model ----------
const result = { generatedFrom: { sampleN: sample.length, models: MODELS }, models: {}, pairs: {} };
const jevWrong = it => !it.jevCorrect;
const wrongBy = m => it => reads[m].get(it.idx) && !reads[m].get(it.idx).correct;

for (const m of MODELS) {
  const items = sample.filter(it => reads[m].has(it.idx));
  const skipped = sample.length - items.length;
  const mw = wrongBy(m);
  const t = table(items, jevWrong, mw);
  const accM = items.filter(it => !mw(it)).length / items.length;
  const wp = weightedPhi(items, jevWrong, mw);
  const byPort = {};
  for (const it of items) { (byPort[it.port] ??= []).push(it); }
  const ports = Object.entries(byPort).map(([port, its]) => ({ port, ...table(its, jevWrong, mw), jevWrongN: its.filter(jevWrong).length, mWrong: its.filter(mw).length })).sort((x, y) => y.n - x.n);
  const mh = mantelHaenszel(ports);
  const neg = ['interactive:X6', 'runbook:X4', 'kinetics:X3'];
  const subset = items.filter(it => neg.includes(it.port)), rest = items.filter(it => !neg.includes(it.port));
  const costSum = [...reads[m].values()].reduce((a, r) => a + (r.costUsd ?? 0), 0);
  result.models[m] = {
    n: items.length, skippedFaults: skipped, costUsd: r3(costSum * 1e4 / 1e4),
    accuracy: { sample: r3(accM), jevOnSameItems: r3(items.filter(it => it.jevCorrect).length / items.length), weightedPopulation: r3(1 - wp.pM), jevWeightedPopulation: r3(1 - wp.pJ) },
    table2x2: t, phiSample: r3(phi(t)), yuleQ: r3(yuleQ(t)), oddsRatio: Object.fromEntries(Object.entries(orWald(t)).map(([k, v]) => [k, typeof v === 'number' ? r3(v) : v])), fisherP: fisher2(t.a, t.b, t.c, t.d),
    conditional: { pMwrongGivenJwrong: r3(t.a / (t.a + t.b)), pMwrongGivenJright: r3(t.c / (t.c + t.d)), pMwrongSample: r3((t.a + t.c) / t.n),
      pMwrongPopulationWeighted: r3(wp.pM), pMwrongGivenJwrongWeighted: r3(wp.pMgivenJ), pMwrongGivenJrightWeighted: r3(wp.pMgivenNotJ) },
    weighted: { pJwrong: r3(wp.pJ), pMwrong: r3(wp.pM), pBothWrong: r3(wp.pJM), pBothIfIndependent: r3(wp.pJ * wp.pM), phi: r3(wp.phi), phiBootstrap95: (() => { const b = bootPhi(items, jevWrong, mw); return [r3(b.lo), r3(b.hi)]; })() },
    mantelHaenszel: { or: r3(mh.or), lo: r3(mh.lo), hi: r3(mh.hi), chi2: r3(mh.chi2), p: mh.chi2 != null ? chi2p1(mh.chi2) : null, ports: mh.strata },
    negativeResultPorts: (() => { const tt = table(subset, jevWrong, mw); return { ...tt, pMgivenJwrong: r3(tt.a / (tt.a + tt.b)), pMgivenJright: r3(tt.c / (tt.c + tt.d)), or: orWald(tt).or && r3(orWald(tt).or), fisherP: fisher2(tt.a, tt.b, tt.c, tt.d) }; })(),
    otherPorts: (() => { const tt = table(rest, jevWrong, mw); return { ...tt, pMgivenJwrong: r3(tt.a / (tt.a + tt.b)), pMgivenJright: r3(tt.c / (tt.c + tt.d)), or: orWald(tt).or && r3(orWald(tt).or), fisherP: fisher2(tt.a, tt.b, tt.c, tt.d) }; })(),
    perPort: ports,
    // when both are wrong, do they pick the same wrong option?
    sameWrongOption: (() => { const both = items.filter(it => jevWrong(it) && mw(it)); const same = both.filter(it => it.jevChoice === reads[m].get(it.idx).chosen).length; return { bothWrong: both.length, sameWrongOption: same, chanceExpected: r3(both.reduce((a, it) => a + 1 / (it.keys.length - 1), 0)) }; })(),
  };
}

// ---------- pairs of models (Haiku vs Sonnet) as the reference for same-family dependence ----------
if (MODELS.length >= 2) {
  const [m1, m2] = MODELS;
  const items = sample.filter(it => reads[m1].has(it.idx) && reads[m2].has(it.idx));
  const w1 = wrongBy(m1), w2 = wrongBy(m2);
  const t = table(items, w1, w2), wp = weightedPhi(items, w1, w2);
  const by = {}; for (const it of items) (by[it.port] ??= []).push(it);
  const mh = mantelHaenszel(Object.values(by).map(its => table(its, w1, w2)));
  result.pairs[`${m1}~${m2}`] = { n: items.length, table2x2: t, phiSample: r3(phi(t)), yuleQ: r3(yuleQ(t)), oddsRatio: orWald(t).or && r3(orWald(t).or), fisherP: fisher2(t.a, t.b, t.c, t.d),
    pM2wrongGivenM1wrong: r3(t.a / (t.a + t.b)), pM2wrongGivenM1right: r3(t.c / (t.c + t.d)), weightedPhi: r3(wp.phi), weightedPhiBootstrap95: (() => { const b = bootPhi(items, w1, w2); return [r3(b.lo), r3(b.hi)]; })(), weightedPWrongFirst: r3(wp.pJ), weightedPWrongSecond: r3(wp.pM), mantelHaenszelOR: r3(mh.or), mhCI: [r3(mh.lo), r3(mh.hi)] };
  // Jev vs the pair: is Jev's error more or less correlated with a Claude than the Claudes are with each other?
}
// agreement of Claude models with each other restricted to Jev-wrong items
if (MODELS.length >= 2) {
  const [m1, m2] = MODELS;
  const jw = sample.filter(it => jevWrong(it) && reads[m1].has(it.idx) && reads[m2].has(it.idx));
  result.pairs[`${m1}&${m2}-on-Jev-wrong`] = { n: jw.length, bothClaudeWrong: jw.filter(it => wrongBy(m1)(it) && wrongBy(m2)(it)).length, anyClaudeWrong: jw.filter(it => wrongBy(m1)(it) || wrongBy(m2)(it)).length, neitherClaudeWrong: jw.filter(it => !wrongBy(m1)(it) && !wrongBy(m2)(it)).length };
  // majority vote J,H,S: a voter set with Jev replaced by itself vs by a Claude -- only reported as counts
  const all = sample.filter(it => reads[m1].has(it.idx) && reads[m2].has(it.idx));
  const maj = it => ([jevWrong(it), wrongBy(m1)(it), wrongBy(m2)(it)].filter(Boolean).length >= 2);
  const sub = it => (wrongBy(m1)(it) && wrongBy(m2)(it));
  result.pairs.majority3 = { n: all.length, jevHaikuSonnetMajorityWrong: all.filter(maj).length, claudePairBothWrong: all.filter(sub).length,
    rescuedByJev: all.filter(it => wrongBy(m1)(it) && wrongBy(m2)(it) && !jevWrong(it)).length };
}
// ---------- three-way consensus against the label, and a sensitivity analysis without those items ----------
if (MODELS.length >= 2) {
  const [m1, m2] = MODELS;
  const all = sample.filter(it => reads[m1].has(it.idx) && reads[m2].has(it.idx));
  const uni = it => jevWrong(it) && wrongBy(m1)(it) && wrongBy(m2)(it) && it.jevChoice === reads[m1].get(it.idx).chosen && it.jevChoice === reads[m2].get(it.idx).chosen;
  const byPort = {}; for (const it of all.filter(uni)) byPort[it.port] = (byPort[it.port] ?? 0) + 1;
  const keep = all.filter(it => !uni(it));
  const sens = {};
  for (const m of MODELS) {
    const t = table(keep, jevWrong, wrongBy(m)), o = orWald(t);
    sens[m] = { ...t, yuleQ: r3(yuleQ(t)), or: r3(o.or), orLo: r3(o.lo), orHi: r3(o.hi), fisherP: fisher2(t.a, t.b, t.c, t.d), pMgivenJwrong: r3(t.a / (t.a + t.b)), pMgivenJright: r3(t.c / (t.c + t.d)) };
  }
  const jw = all.filter(jevWrong);
  const neg = ['interactive:X6', 'runbook:X4', 'kinetics:X3'];
  result.consensus = { n: all.length, threeWaySameWrongOption: all.filter(uni).length, byPort, jevWrongTotal: jw.length,
    jevWrongNoClaudeWrong: jw.filter(it => !wrongBy(m1)(it) && !wrongBy(m2)(it)).length,
    jevWrongNoClaudeWrong_negPorts: jw.filter(it => !wrongBy(m1)(it) && !wrongBy(m2)(it) && neg.includes(it.port)).length,
    jevWrongNoClaudeWrong_otherPorts: jw.filter(it => !wrongBy(m1)(it) && !wrongBy(m2)(it) && !neg.includes(it.port)).length,
    sensitivityWithoutThreeWayConsensusItems: { n: keep.length, ...sens } };
}
fs.writeFileSync(path.join(OUT, 'independence-analysis.json'), JSON.stringify(result, null, 1));

// ---------- markdown ----------
const f = (x, d = 3) => (x == null ? '–' : typeof x === 'number' ? x.toFixed(d) : String(x));
const pf = p => (p == null ? '–' : p < 0.001 ? '<0.001' : p.toFixed(3));
let md = '';
for (const m of MODELS) {
  const r = result.models[m], t = r.table2x2;
  md += `### ${m}: Jev-wrong x ${m}-wrong (n = ${r.n}${r.skippedFaults ? `, ${r.skippedFaults} items without a read` : ''}, cost $${f(r.costUsd, 4)})\n\n`;
  md += `| | ${m} wrong | ${m} right | total |\n|---|---|---|---|\n| Jev wrong | ${t.a} | ${t.b} | ${t.a + t.b} |\n| Jev right | ${t.c} | ${t.d} | ${t.c + t.d} |\n| total | ${t.a + t.c} | ${t.b + t.d} | ${t.n} |\n\n`;
  md += `| statistic | value |\n|---|---|\n| accuracy on the sample: ${m} / Jev | ${f(r.accuracy.sample)} / ${f(r.accuracy.jevOnSameItems)} |\n| accuracy, design-weighted to the 1,181-item population: ${m} / Jev | ${f(r.accuracy.weightedPopulation)} / ${f(r.accuracy.jevWeightedPopulation)} |\n| phi (sample, inflated by the oversampling of errors) | ${f(r.phiSample)} |\n| Yule's Q | ${f(r.yuleQ)} |\n| odds ratio [95% CI] | ${f(r.oddsRatio.or)} [${f(r.oddsRatio.lo)}, ${f(r.oddsRatio.hi)}]${r.oddsRatio.corrected ? ' (0.5 added)' : ''} |\n| Fisher exact p (two-sided) | ${pf(r.fisherP)} |\n| P(${m} wrong \\| Jev wrong) / P(${m} wrong \\| Jev right), sample | ${f(r.conditional.pMwrongGivenJwrong)} / ${f(r.conditional.pMwrongGivenJright)} |\n| same, design-weighted | ${f(r.conditional.pMwrongGivenJwrongWeighted)} / ${f(r.conditional.pMwrongGivenJrightWeighted)} |\n| P(${m} wrong), population-weighted | ${f(r.conditional.pMwrongPopulationWeighted)} |\n| P(both wrong) weighted vs the product P(J wrong) P(M wrong) | ${f(r.weighted.pBothWrong)} vs ${f(r.weighted.pBothIfIndependent)} |\n| phi, design-weighted [bootstrap 95%] | ${f(r.weighted.phi)} [${f(r.weighted.phiBootstrap95[0])}, ${f(r.weighted.phiBootstrap95[1])}] |\n| Mantel-Haenszel OR across ${r.mantelHaenszel.ports} ports [95% CI], CMH p | ${f(r.mantelHaenszel.or)} [${f(r.mantelHaenszel.lo)}, ${f(r.mantelHaenszel.hi)}], ${pf(r.mantelHaenszel.p)} |\n| when both wrong: same wrong option (expected by chance, uniform over the other options) | ${r.sameWrongOption.sameWrongOption} of ${r.sameWrongOption.bothWrong} (${f(r.sameWrongOption.chanceExpected, 1)}) |\n\n`;
  const ng = r.negativeResultPorts, ot = r.otherPorts;
  md += `| subset | n | both wrong | Jev wrong only | ${m} wrong only | both right | P(M wrong \\| J wrong) | P(M wrong \\| J right) | OR | Fisher p |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  md += `| negative-result ports (interactive X6, runbook X4, kinetics X3) | ${ng.n} | ${ng.a} | ${ng.b} | ${ng.c} | ${ng.d} | ${f(ng.pMgivenJwrong)} | ${f(ng.pMgivenJright)} | ${f(ng.or)} | ${pf(ng.fisherP)} |\n`;
  md += `| other ports | ${ot.n} | ${ot.a} | ${ot.b} | ${ot.c} | ${ot.d} | ${f(ot.pMgivenJwrong)} | ${f(ot.pMgivenJright)} | ${f(ot.or)} | ${pf(ot.fisherP)} |\n\n`;
  md += `Per port (a = both wrong, b = Jev wrong only, c = ${m} wrong only, d = both right):\n\n| port | n | a | b | c | d | ${m} wrong | Jev wrong |\n|---|---|---|---|---|---|---|---|\n`;
  for (const p of r.perPort) md += `| ${p.port} | ${p.n} | ${p.a} | ${p.b} | ${p.c} | ${p.d} | ${p.mWrong} | ${p.jevWrongN} |\n`;
  md += '\n';
}
if (result.consensus) md += `### three-way consensus and sensitivity\n\n\`\`\`json\n${JSON.stringify(result.consensus)}\n\`\`\`\n\n`;
for (const [k, v] of Object.entries(result.pairs)) md += `### ${k}\n\n\`\`\`json\n${JSON.stringify(v)}\n\`\`\`\n\n`;
fs.writeFileSync(path.join(OUT, 'independence-tables.md'), md);
console.log(md);
