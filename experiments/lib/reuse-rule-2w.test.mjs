// M3b (research/jit-20261008/DEV-NOTES.md D30; PROOF-LEDGER K1; LIBRARY-TESTS L4): the reuse acceptance rule under crossed
// parent × entry clustering. $0, seeded, deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kishDeff, kishDeff2, crossedOf, clusterDeff2, reuseBoundRule, reuseBoundRule2, exactBinomialBounds, RHO_REUSE_FLOOR, RHO_ENTRY_FLOOR,
} from './stats.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { crossedParams, trueIccs, drawCrossed, simulateCrossed, decide2 } from './reuse-rule-sim.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
// 96 parents × 6 offers dealt over E entries cyclically by blocks (parent i sees entries (i·6 + k) mod E); wrongAt(i, j).
const l4 = (E, wrongAt = () => false) => {
  const d = [];
  for (let i = 0; i < 96; i++) for (let k = 0; k < 6; k++) { const j = (i * 6 + k) % E; d.push({ parent: `t${i}`, entry: `e${j}`, wrong: wrongAt(i, j) }); }
  return d;
};

test('Deff₂, crossedOf and clusterDeff2 by hand', () => {
  close(kishDeff2(Array(96).fill(6), Array(12).fill(48), 0.1, 0.1), 1 + 5 * 0.1 + 47 * 0.1);   // L4 as written: 6.2
  close(kishDeff2(Array(96).fill(6), Array(96).fill(6), 0.1, 0.1), 2);
  close(kishDeff2([1, 11, 6], Array(18).fill(1), 0.1, 0.7), kishDeff([1, 11, 6], 0.1));       // singleton entries: M3's one-way Deff
  const c = crossedOf([{ parent: 'a', entry: 'x', wrong: true }, { parent: 'a', entry: 'y', label: 'correct' }, { parent: 'b', entry: 'x', wrong: false }]);
  assert.deepEqual(c.rows, [{ parent: 'a', n: 2, wrong: 1 }, { parent: 'b', n: 1, wrong: 0 }]);
  assert.deepEqual(c.cols, [{ entry: 'x', n: 2, wrong: 1 }, { entry: 'y', n: 1, wrong: 0 }]);
  assert.throws(() => crossedOf([{ parent: 'a', wrong: false }]), /without entry/);                // the entry id is required
  assert.throws(() => clusterDeff2({ rows: [{ n: 2, wrong: 0 }], cols: [{ n: 3, wrong: 0 }] }), /disagree/);
  const s = clusterDeff2(crossedOf(l4(12)));                                                     // no variation: both floors
  assert.equal(s.rhoHatParent, null); assert.equal(s.rhoHatEntry, null);
  assert.equal(s.rhoParentUsed, RHO_REUSE_FLOOR); assert.equal(s.rhoEntryUsed, RHO_ENTRY_FLOOR);
  close(s.mStarParent, 6); close(s.mStarEntry, 48); close(s.deff, 6.2); close(s.nEff, 576 / 6.2);
  close(clusterDeff2(crossedOf(l4(12)), { combine: 'max' }).deff, 1 + 47 * 0.1);
});

test('with every decision its own entry, the two-way rule is the M3 rule', () => {
  const r = rng('m3b-test-reduce');
  for (let k = 0; k < 40; k++) {
    const d = [];
    for (let i = 0; i < 60 + k * 7; i++) for (let m = 0; m < 1 + (i % 7); m++) d.push({ parent: i, entry: `${i}.${m}`, wrong: r.next() < 0.02 + 0.03 * (i % 3) });
    const one = reuseBoundRule(crossedOf(d).rows, { method: 'exact' }), two = reuseBoundRule2(crossedOf(d));
    assert.equal(two.decision, one.decision); close(two.nEff, one.nEff, 1e-9); close(two.upper, one.upper, 1e-12);
  }
});

test('reuseBoundRule2 on hand-built L4-shaped data', () => {
  const perfect = reuseBoundRule2(crossedOf(l4(12)));
  assert.equal(perfect.decision, 'serve');                                   // 0 of n_eff 92.9: upper 0.032
  close(perfect.upper, exactBinomialBounds(0, 576 / 6.2).hi, 1e-12);
  // 10 wrong, one in each of 10 entries and 10 parents (l4(12) gives even parents entries 0–5, odd parents 6–11): served
  // by the parent-only rule, not decided by the two-way rule (upper 0.060).
  const sp = crossedOf(l4(12, (i, j) => (j < 6 && i === 2 * j) || (j >= 6 && j < 10 && i === 2 * (j - 6) + 1)));
  assert.equal(sp.rows.reduce((a, c) => a + c.wrong, 0), 10);
  assert.equal(reuseBoundRule(sp.rows, { method: 'exact' }).decision, 'serve');
  assert.equal(reuseBoundRule2(sp).decision, 'no-decision');
  // The same 10 wrong concentrated in one entry: ρ̂_E is high, so the bound widens; the per-entry guard kills.
  const conc = crossedOf(l4(12, (i, j) => j === 0 && i < 20));
  const c2 = reuseBoundRule2(conc);
  assert.ok(c2.rhoHatEntry > RHO_ENTRY_FLOOR && c2.deff > 6.2, `ρ̂_E ${c2.rhoHatEntry}`);
  assert.equal(c2.decision, 'no-decision');
  const g = reuseBoundRule2(conc, { entryGuard: true });
  assert.equal(g.decision, 'kill'); assert.equal(g.guardEntries, 1); assert.match(g.reason, /entry guard/);
  assert.equal(reuseBoundRule2(crossedOf(l4(96))).decision, 'serve');      // 96 entries of 6: Deff 2
});

test('the crossed generator: exact mean, the Deff₂ variance, the M3 limit, and decisions that round-trip', () => {
  const g0 = crossedParams({ p: 0.05, rhoP: 0.1, rhoE: 0 });               // ρ_E = 0: M3's beta-binomial parent model
  assert.equal(g0.muV, 0); assert.equal(g0.varV, 0); close(g0.muU, 0.05, 1e-12); close(g0.varU, 0.1 * 0.05 * 0.95, 1e-12);
  assert.throws(() => crossedParams({ p: 0.01, rhoP: 0.9, rhoE: 0.9 }), /unreachable/);
  for (const cell of [{ p: 0.05, rhoP: 0.1, rhoE: 0.1, entries: 12 }, { p: 0.01, rhoP: 0.1, rhoE: 0.05, entries: 24 },
    { p: 0.05, rhoP: 0.1, rhoE: 0, entries: 12, shape: 'blind' }, { p: 0.05, rhoP: 0.1, rhoE: 0.1, entries: 48, alloc: 'solver' }]) {
    const r = rng('m3b-test-gen', JSON.stringify(cell)), K = 3000, t = trueIccs(cell);
    let X = 0, X2 = 0, N = 0, pred = 0;
    for (let i = 0; i < K; i++) {
      const c = drawCrossed(r, cell);
      X += c.wrong; X2 += c.wrong * c.wrong; N += c.n;
      pred += c.n * cell.p * (1 - cell.p) * kishDeff2(c.rows.map(x => x.n), c.cols.map(x => x.n), t.rhoP, t.rhoE);
    }
    const varRatio = (X2 / K - (X / K) ** 2) / (pred / K);
    assert.ok(Math.abs(X / N - cell.p) < 0.08 * cell.p, `${JSON.stringify(cell)} mean ${X / N}`);
    assert.ok(Math.abs(varRatio - 1) < 0.1, `${JSON.stringify(cell)} variance ratio ${varRatio}`);
  }
  const c = drawCrossed(rng('m3b-test-rt'), { p: 0.05, rhoP: 0.1, rhoE: 0.1, entries: 12, admit: 0.5, decisions: true });
  const x = crossedOf(c.decisions), sortPairs = cs => cs.map(v => [v.n, v.wrong]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(sortPairs(x.rows), sortPairs(c.rows)); assert.deepEqual(sortPairs(x.cols), sortPairs(c.cols));
  const bal = drawCrossed(rng('m3b-test-bal'), { p: 0, entries: 48 });         // balanced allocation: every entry 12 offers
  assert.ok(bal.cols.length === 48 && bal.cols.every(v => v.n === 12));
});

test('the verifier\'s finding holds under the exact crossed model, and M3b removes it (12 entries, ρ_E 0.05, p 0.05)', () => {
  const s = simulateCrossed({ reps: 3000, seed: 'm3b-test-verifier', rules: ['aE', 'aE2', 'ref'], p: 0.05, rhoP: 0, rhoE: 0.05, entries: 12 });
  assert.ok(s.byRule.aE.serve > 0.07, `M3 rule miss ${s.byRule.aE.serve}`);     // the verifier: 10.9% (product model)
  assert.ok(s.byRule.aE.serveIfLibBad < 0.05, `M3 rule, library-rate miss ${s.byRule.aE.serveIfLibBad}`); // it bounds θ_lib
  assert.ok(s.byRule.aE2.serve <= 0.05, `M3b miss ${s.byRule.aE2.serve}`);
});

test('decide2 applies the declared procedure mechanically', () => {
  const row = (rule, entries, admit, falseKill, miss, tier = 'binding') => ({ rule, tier, entries, admit, falseKill, miss, pass: falseKill <= 0.05 && miss <= 0.05 });
  const grid = [];
  for (const E of [12, 24]) for (const adm of [1, 0.5]) {
    grid.push(row('A', E, adm, E === 24 ? 0.03 : 0.3, 0.02));                   // safe; meets at 24 only
    grid.push(row('B', E, adm, 0.01, E === 12 && adm === 0.5 ? 0.051 : 0.02)); // one unsafe cell: inadmissible
    grid.push(row('C', E, adm, adm === 1 ? 0.04 : 0.2, 0.01));                 // safe; meets at 12 at share 1 only
  }
  grid.push(row('A', 24, 1, 0.5, 0.01, 'robustness'), row('C', 24, 1, 0.5, 0.2, 'robustness'));
  const d = decide2(grid, { candidates: ['A', 'B', 'C'], entries: [12, 24], admits: [1, 0.5] });
  const by = Object.fromEntries(d.candidates.map(c => [c.rule, c]));
  assert.equal(by.B.admissible, false); assert.equal(by.B.unsafeCells, 1);
  assert.deepEqual(by.A.eNeeded, { 1: 24, 0.5: 24 }); assert.deepEqual(by.C.eNeeded, { 1: 12, 0.5: null });
  assert.equal(d.chosen, 'C');                                                  // smaller E needed at share 1 wins first
});
