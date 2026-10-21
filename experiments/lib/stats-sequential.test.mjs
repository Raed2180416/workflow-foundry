// Tests for the group-sequential core in experiments/lib/stats.mjs (register A4/B7; FIXES §2 action 7, T1). $0.
//   nice -n 15 node --test --test-concurrency=1 experiments/lib/stats-sequential.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../../beds/lib/rng.mjs';
import {
  crossesAt, crossingProbability, mcnemarExactCounts, mixtureEvalue, normalUpper, obrienFlemingBoundary, pairedBayesInterval,
  pairedPermutation, pairedSignFlipZ, pocockBoundary, studentTQuantile, twoSidedP,
} from './stats.mjs';
import * as jit from '../jit/stats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);

test('O\'Brien-Fleming and Pocock reproduce the published constants and nominal levels', () => {
  // Jennison & Turnbull (2000) Tables 2.1 and 2.3, two-sided alpha 0.05, equally spaced looks.
  const obf = { 2: 1.977, 3: 2.004, 4: 2.024, 5: 2.040 }, poc = { 2: 2.178, 3: 2.289, 4: 2.361, 5: 2.413 };
  for (const K of [2, 3, 4, 5]) {
    close(obrienFlemingBoundary(K).constant, obf[K], 0.001, `C_B(${K})`);
    close(pocockBoundary(K).constant, poc[K], 0.001, `C_P(${K})`);
  }
  const b = obrienFlemingBoundary(5);
  // FIXES A4 (the skeptic's rerun): nominal two-sided .000005/.0013/.0085/.0226/.0413, each within one unit of its last
  // quoted digit (computed here: 5.07e-6, 0.00126, 0.00845, 0.0226, 0.0413).
  [[0.000005, 1e-6], [0.0013, 1e-4], [0.0085, 1e-4], [0.0226, 1e-4], [0.0413, 1e-4]].forEach(([p, eps], i) => close(b.nominal[i], p, eps, `look ${i + 1}`));
  close(b.totalAlpha, 0.05, 1e-5); close(b.cumulativeAlpha.at(-1), 0.05, 1e-5);
  close(pocockBoundary(5).nominal[0], 0.0158, 0.0001, 'Pocock 5-look nominal');
  // Unequal information fractions (the dev-train schedule) and a smaller alpha are accepted; nominal levels increase.
  const u = obrienFlemingBoundary(3, { alpha: 0.025, fractions: [60, 120, 151] });
  assert.deepEqual(u.fractions.map(x => +x.toFixed(4)), [0.3974, 0.7947, 1]);
  assert.ok(u.nominal[0] < u.nominal[1] && u.nominal[1] < u.nominal[2] && u.nominal[2] < 0.025);
  close(u.totalAlpha, 0.025, 1e-5);
  assert.equal(crossesAt(b, 5, 0.04), true); assert.equal(crossesAt(b, 1, 0.001), false);
  assert.throws(() => obrienFlemingBoundary(3, { fractions: [0.5, 0.4, 1] }), /increasing/);
  assert.throws(() => pocockBoundary(0), /positive integer/);
});

test('crossing probability: one look is the plain two-sided level; an infinite first boundary changes nothing; Monte Carlo agrees', () => {
  close(crossingProbability([1.959964], [1]).total, 0.05, 1e-6);
  close(crossingProbability([Infinity, 1.959964], [0.5, 1]).total, 0.05, 1e-4);
  close(twoSidedP(1.959964), 0.05, 1e-6); close(normalUpper(4.5622) * 2, 5.06e-6, 0.1e-6);
  // Brownian-motion simulation of the 5-look OBF boundary.
  const b = obrienFlemingBoundary(5), r = rng('obf-mc'), reps = 40000;
  let hits = 0;
  for (let i = 0; i < reps; i++) {
    let s = 0;
    for (let k = 1; k <= 5; k++) { s += r.normal(0, Math.sqrt(0.2)); if (Math.abs(s / Math.sqrt(0.2 * k)) >= b.z[k - 1]) { hits++; break; } }
  }
  close(hits / reps, 0.05, 3 * Math.sqrt(0.05 * 0.95 / reps), 'simulated type-I');
});

test('mixture e-value: (12, 2) = 12.0 and (12, 3) = 4.5; its expectation under H0 is 1 (a test martingale)', () => {
  assert.equal(+mixtureEvalue(12, 2).toFixed(1), 12.0);
  assert.equal(+mixtureEvalue(12, 3).toFixed(1), 4.5);
  assert.equal(mixtureEvalue(0, 0), 1);
  for (const n of [1, 5, 14, 30]) {
    let e = 0;
    for (let b = 0; b <= n; b++) e += mcnemarPmf(b, n) * mixtureEvalue(b, n - b);
    close(e, 1, 1e-9, `E[E_${n}]`);
  }
  assert.throws(() => mixtureEvalue(1.5, 2), /non-negative integers/);
  close(mcnemarExactCounts(12, 2).p, 0.0129, 0.0001); close(mcnemarExactCounts(12, 4).p, 0.0768, 0.0001);
});
function mcnemarPmf(b, n) { let lc = 0; for (let i = 1; i <= b; i++) lc += Math.log(n - b + i) - Math.log(i); return Math.exp(lc - n * Math.log(2)); }

test('paired permutation: exact enumeration on a hand case; Monte Carlo agrees with exact; zero differences give p = 1', () => {
  // d = (1, 1, 1): 8 sign vectors, |sum| >= 3 only for all +1 or all -1 -> p = 2/8.
  assert.equal(pairedPermutation([1, 1, 1], [0, 0, 0]).p, 0.25);
  assert.equal(pairedPermutation([0.5, 0.2], [0.5, 0.2]).p, 1);
  const r = rng('perm-mc');
  const x = Array.from({ length: 20 }, () => r.next()), y = x.map(v => Math.min(1, Math.max(0, v - 0.08 + 0.3 * (r.next() - 0.5))));
  const ex = pairedPermutation(x, y), mc = pairedPermutation(x, y, { exactMax: 10, iterations: 40000 });
  assert.equal(ex.method, 'exact'); assert.equal(mc.method, 'monte-carlo');
  close(mc.p, ex.p, 0.01, 'MC vs exact');
  // The large-sample z agrees with the permutation p in the middle of the range.
  close(twoSidedP(pairedSignFlipZ(x, y)), ex.p, 0.03, 'normal approximation');
  assert.throws(() => pairedPermutation([1, 2], [1]), /equal length/);
});

// Stored AutomationBench dev60 runs (development evidence): Sonnet + A1 harness vs Sonnet alone, same 60 tasks.
function loadRuns(...dirs) {
  const out = new Map();
  for (const d of dirs) for (const l of readFileSync(path.join(ROOT, 'research/automationbench-20261014/runs', d, 'results.jsonl'), 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l), f = r.forks[0];
    if (f.sessionError || f.harnessError || f.skipped) continue;
    out.set(r.task, { pass: r.final ? r.final.task_completed_correctly : 0, pc: r.final ? r.final.partial_credit : 0 });
  }
  return out;
}

test('stored runs: partial-credit permutation p is about 0.0034 where strict McNemar is 0.077 (Sonnet + A1 vs Sonnet, dev60)', () => {
  const A = loadRuns('a1s-dev60-dn', 'a1s-dev60-dn-fill'), B = loadRuns('a0s-dev60-dn');
  const tasks = [...A.keys()].filter(t => B.has(t)).sort();
  assert.equal(tasks.length, 60);
  const pc = pairedPermutation(tasks.map(t => A.get(t).pc), tasks.map(t => B.get(t).pc));
  assert.equal(pc.method, 'exact'); assert.equal(pc.nonZero, 24);
  close(pc.meanDiff, 0.1196, 0.0005, 'mean partial-credit difference');
  close(pc.p, 0.0034, 0.0004, 'exact sign-flip p');
  const b = tasks.filter(t => A.get(t).pass && !B.get(t).pass).length, c = tasks.filter(t => !A.get(t).pass && B.get(t).pass).length;
  assert.deepEqual([b, c], [12, 4]);
  close(mcnemarExactCounts(b, c).p, 0.0768, 0.0001, 'strict McNemar');
  const iv = pairedBayesInterval(tasks.map(t => A.get(t).pc), tasks.map(t => B.get(t).pc));
  assert.equal(iv.kind, 'continuous');
  assert.ok(iv.lo > 0.02 && iv.lo < 0.07 && iv.hi > 0.17 && iv.hi < 0.22, `partial-credit interval [${iv.lo}, ${iv.hi}] (researcher's bootstrap [0.040, 0.199])`);
  const sv = pairedBayesInterval(tasks.map(t => A.get(t).pass), tasks.map(t => B.get(t).pass));
  assert.equal(sv.kind, 'binary'); assert.deepEqual(sv.table, { both: 16, aOnly: 12, bOnly: 4, neither: 28 });
  assert.ok(sv.lo < 0.133 && sv.hi > 0.133 && sv.pPositive > 0.9);
});

test('paired Bayes intervals: binary Dirichlet and continuous Bayesian bootstrap cover a simulated truth', () => {
  const r = rng('bayes-cov');
  let covB = 0, covC = 0;
  const reps = 300;
  for (let i = 0; i < reps; i++) {
    const n = 60, x = [], y = [], u = [], v = [];
    for (let j = 0; j < n; j++) {
      const p = r.next();
      x.push(r.next() < Math.min(1, p + 0.1) ? 1 : 0); y.push(r.next() < p ? 1 : 0);
      const q = r.next(); u.push(Math.min(1, q + 0.05 * r.next() + 0.05)); v.push(q);
    }
    // truth: E[x - y] = E[min(1, p + 0.1) - p] = 0.1 - 0.005 = 0.095; E[u - v] = E[min(1, q + 0.05 + 0.05w) - q]
    const ib = pairedBayesInterval(x, y, { draws: 4000, seed: `b${i}` }), ic = pairedBayesInterval(u, v, { draws: 4000, seed: `c${i}` });
    if (ib.lo <= 0.095 && 0.095 <= ib.hi) covB++;
    if (ic.lo <= TRUE_C && TRUE_C <= ic.hi) covC++;
  }
  assert.ok(covB / reps >= 0.92, `binary coverage ${covB / reps}`);
  assert.ok(covC / reps >= 0.92, `continuous coverage ${covC / reps}`);
  assert.throws(() => pairedBayesInterval([0.5], [0], { kind: 'binary' }), /0\/1/);
});
// E[min(1, q + 0.05 + 0.05 w) - q] for q, w ~ U(0, 1), by quadrature.
const TRUE_C = (() => { let s = 0, n = 0; for (let q = 0.0005; q < 1; q += 0.001) for (let w = 0.005; w < 1; w += 0.01) { s += Math.min(1, q + 0.05 + 0.05 * w) - q; n++; } return s / n; })();

test('Student t quantiles; the JIT instrument re-exports the shared core', () => {
  close(studentTQuantile(0.975, 10), 2.228, 0.001); close(studentTQuantile(0.975, 2), 4.303, 0.001); close(studentTQuantile(0.5, 7), 0, 1e-6);
  for (const k of ['obrienFlemingBoundary', 'pocockBoundary', 'mixtureEvalue', 'pairedPermutation', 'pairedBayesInterval']) assert.equal(typeof jit[k], 'function', k);
  assert.equal(jit.obrienFlemingBoundary, obrienFlemingBoundary);
});
