// DUR-1 power and operating characteristics, $0 (PREREG-DUR-1 §11; BUILD-PLAN row 20). Reproduces every number of
// prereg §11 and the operating characteristics of §10 from fixed seeds and prints one JSON (its sha256 goes into
// FREEZE.json). Started from the synthesis step's scratch scripts (calc/power.mjs, signflip.mjs, d3.mjs), with relative
// imports. Simulation sizes are the scratch scripts' (reps 600-4000); `--quick` divides them for tests.
//   node experiments/durability/power.mjs [--quick] [--out <file>]
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pairedPermutation } from '../lib/stats.mjs';

const lcg = seed => { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; };
const normalOf = rnd => () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const L = x => Math.log(x / (1 - x)), E = x => 1 / (1 + Math.exp(-x));
const r3 = x => Math.round(x * 1000) / 1000, r4 = x => Math.round(x * 10000) / 10000;

/** The 9 programs' as-delivered failing counts on the FH-1 grading pool (1,022 cases each; RESULT-FH1.md at 9e2a2b61). */
export const FAILING = Object.freeze([0, 7, 19, 48, 48, 48, 67, 102, 136]);
export const POOL = 1022;

/** SD of the as-delivered build rates and its chi-square 95% interval (8 df: quantiles 2.180 and 17.535). */
export function buildSd(failing = FAILING, m = POOL) {
  const f = failing.map(x => 1 - x / m);
  const mu = f.reduce((a, b) => a + b, 0) / f.length;
  const sd = Math.sqrt(f.reduce((a, b) => a + (b - mu) ** 2, 0) / (f.length - 1));
  return { rates: f.map(r4), mean: r4(mu), sd: r4(sd), lo: r4(sd * Math.sqrt(8 / 17.535)), hi: r4(sd * Math.sqrt(8 / 2.180)) };
}

/** One-sided exact sign-flip p (p/2 when the mean is positive, else 1 - p/2). */
export const signFlipP = d => { const r = pairedPermutation(d, d.map(() => 0)); return r.meanDiff > 0 ? r.p / 2 : 1 - r.p / 2; };

/** MDE of the exact one-sided sign-flip test at power 0.8 (bisection over the mean, normal differences of SD sigma). */
export function signFlipMde(sigma, alpha, n, { reps = 1500, seed = 4242 } = {}) {
  const rnd = lcg(seed), norm = normalOf(rnd);
  const power = mu => { let k = 0; for (let r = 0; r < reps; r++) { const d = Array.from({ length: n }, () => mu + sigma * norm()); if (signFlipP(d) <= alpha) k++; } return k / reps; };
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (power(m) >= 0.8) hi = m; else lo = m; }
  return r3(hi);
}

/** D-3 power: two-way (lineage x window) bootstrap non-inferiority at margin delta and level alpha. */
export function d3Power({ W = 12, k = 8, nL = 9, pA = 0.85, gap = 0, sdLin = 0.4, sdWin = 0.6, sdCase = 1.0, alpha = 0.025, reps = 600, B = 1000, delta = 0.10, seed = 777 } = {}) {
  const rnd = lcg(seed), norm = normalOf(rnd);
  let sup = 0;
  for (let r = 0; r < reps; r++) {
    const lin = Array.from({ length: nL }, () => sdLin * norm());
    const M = Array.from({ length: nL }, () => new Array(W).fill(0));
    for (let w = 0; w < W; w++) {
      const we = sdWin * norm();
      for (let c = 0; c < k; c++) {
        const ce = sdCase * norm();
        const ya = rnd() < E(L(pA) + we + ce) ? 1 : 0;
        for (let l = 0; l < nL; l++) { const yh = rnd() < E(L(Math.min(0.995, pA + gap)) + we + ce + lin[l]) ? 1 : 0; M[l][w] += (yh - ya) / k; }
      }
    }
    const boots = [];
    for (let b = 0; b < B; b++) {
      const li = Array.from({ length: nL }, () => Math.floor(rnd() * nL)), wi = Array.from({ length: W }, () => Math.floor(rnd() * W));
      let t = 0; for (const l of li) for (const w of wi) t += M[l][w]; boots.push(t / (nL * W));
    }
    boots.sort((a, b) => a - b);
    if (boots[Math.floor(alpha * B)] > -delta) sup++;
  }
  return r3(sup / reps);
}

/** Operating characteristics of the clustered durable-share rule (9 lineages x 12 cells, lineage effect SD tau on logit). */
export function durableOC(pt, { tau = 0.8, R = 4000, seed = 12345 } = {}) {
  const rnd = lcg(seed), norm = normalOf(rnd);
  let sup = 0, fal = 0;
  for (let r = 0; r < R; r++) { let x = 0, n = 0; for (let l = 0; l < 9; l++) { const pl = E(L(pt) + tau * norm()); for (let c = 0; c < 12; c++) { n++; if (rnd() < pl) x++; } } const sh = x / n; if (sh >= 0.8) sup++; if (sh < 0.5) fal++; }
  return { pSupport: r3(sup / R), pFalsify: r3(fal / R) };
}
/** D-6 pooled recall rule: 18 onsets x 9 lineages, onset effect SD 0.8 on logit. */
export function recallOC(pt, { R = 4000, seed = 12345 } = {}) {
  const rnd = lcg(seed + 1), norm = normalOf(rnd);
  let pass = 0, fail = 0;
  for (let r = 0; r < R; r++) { let x = 0, n = 0; for (let o = 0; o < 18; o++) { const po = E(L(pt) + 0.8 * norm()); for (let l = 0; l < 9; l++) { n++; if (rnd() < po) x++; } } const rc = x / n; if (rc >= 0.9) pass++; if (rc < 0.5) fail++; }
  return { pPass: r3(pass / R), pFail: r3(fail / R) };
}
const binomGE = (n, p, k) => { let t = 0; const c = (n, r) => { let x = 1; for (let i = 0; i < r; i++) x = x * (n - i) / (i + 1); return x; }; for (let j = k; j <= n; j++) t += c(n, j) * p ** j * (1 - p) ** (n - j); return t; };

export function powerReport({ quick = false } = {}) {
  const q = quick ? 10 : 1;
  const sd = buildSd();
  const out = { schema: 'dur1-power/1', sd };
  out.signFlip = { minP9: r4(signFlipP([1, 2, 3, 4, 5, 6, 7, 8, 9])), p8of9SmallestNegative: r4(signFlipP([-1, 2, 3, 4, 5, 6, 7, 8, 9])),
    mde: Object.fromEntries([0.029, 0.043, 0.083].map(s => [s, { a025: signFlipMde(s, 0.025, 9, { reps: Math.round(1500 / q) }), a05: signFlipMde(s, 0.05, 9, { reps: Math.round(1500 / q) }), n6a025: signFlipMde(s, 0.025, 6, { reps: Math.round(1500 / q) }) }])) };
  out.d3 = {};
  for (const W of [12, 8]) for (const gap of [-0.05, 0, 0.05]) out.d3[`W${W}_gap${gap}`] = { a025: d3Power({ W, gap, reps: Math.round(600 / q) }), a05: d3Power({ W, gap, alpha: 0.05, reps: Math.round(600 / q) }) };
  out.d3.W12_k4_gap0 = d3Power({ W: 12, k: 4, gap: 0, reps: Math.round(600 / q) });
  out.d3.sizeAtMargin = d3Power({ W: 12, gap: -0.10, reps: Math.round(600 / q) });
  out.durable = Object.fromEntries([0.9, 0.85, 0.75, 0.6, 0.4].map(p => [p, durableOC(p, { R: Math.round(4000 / q) })]));
  out.recall = Object.fromEntries([0.97, 0.93, 0.9, 0.85, 0.6].map(p => [p, recallOC(p, { R: Math.round(4000 / q) })]));
  out.d4 = Object.fromEntries([0.95, 0.9, 0.8, 0.7].map(p => [p, r3(binomGE(9, p, 7))]));
  out.d5 = { units: 162, zeroEventBound: r4(3 / 162) };
  out.d6 = { onsetsPerLineage: 18, wilsonLower18of18: r3(18 / (18 + 1.96 ** 2) - 0) };
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rep = powerReport({ quick: process.argv.includes('--quick') });
  const text = JSON.stringify(rep, null, 1);
  const i = process.argv.indexOf('--out');
  if (i > 0) { mkdirSync(path.dirname(process.argv[i + 1]), { recursive: true }); writeFileSync(process.argv[i + 1], text + '\n'); }
  console.log(text);
  console.log(`sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
