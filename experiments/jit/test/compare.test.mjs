// compare.mjs (JIT v2.1, opt-in tolerant comparison) and check-traces' --tolerant mode. No model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tolerantEqual, tolerantAgreement, numbersEqual, assignMax, tolerance, leaves, MATCH_CAP, DEFAULT_TOLERANCE } from '../compare.mjs';
import { compare, leaves as ctLeaves, parseArgs, comparisonOf, aggregate } from '../check-traces.mjs';

const T = DEFAULT_TOLERANCE;

test('numbers: |a-b| <= max(absTol, relTol * max(|a|,|b|)); sign, zero, NaN, null and infinities', () => {
  assert.equal(numbersEqual(100, 100.9, T), true); assert.equal(numbersEqual(100, 101.2, T), false);
  assert.equal(numbersEqual(100.9, 100, T), true, 'symmetric');
  assert.equal(numbersEqual(0, 0, T), true); assert.equal(numbersEqual(0, -0, T), true);
  assert.equal(numbersEqual(1e-12, -1e-12, T), true, 'opposite signs within absTol');
  assert.equal(numbersEqual(5, -5, T), false, 'a sign flip is a difference'); assert.equal(numbersEqual(-4.02, -4.0, T), true);
  assert.equal(numbersEqual(1e-6, 0, T), false, 'relTol of a tiny number does not swallow it');
  assert.equal(numbersEqual(1e-6, 0, { relTol: 0.01, absTol: 1e-5 }), true);
  assert.equal(numbersEqual(NaN, NaN, T), true); assert.equal(numbersEqual(NaN, 0, T), false);
  assert.equal(numbersEqual(Infinity, Infinity, T), true); assert.equal(numbersEqual(Infinity, -Infinity, T), false); assert.equal(numbersEqual(Infinity, 1e308, T), false);
  assert.equal(numbersEqual(1, 1.5, { relTol: 0, absTol: 0 }), false); assert.equal(numbersEqual(1, 1, { relTol: 0, absTol: 0 }), true);
  assert.equal(tolerantEqual(null, null), true); assert.equal(tolerantEqual(null, 0), false); assert.equal(tolerantEqual(NaN, null), false, 'unlike canonical JSON, NaN is not null');
  assert.equal(tolerantEqual([undefined], [null]), true, 'an undefined array item is null, as canonical JSON writes it');
  assert.equal(tolerantEqual(1, '1'), false); assert.equal(tolerantEqual(true, 1), false); assert.equal(tolerantEqual(true, true), true);
  assert.throws(() => tolerance({ relTol: -1 }), /relTol must be a finite number >= 0/); assert.throws(() => tolerantEqual(1, 1, { absTol: NaN }), /absTol/);
});

test('strings are trimmed (nothing else); objects compare by keys; undefined-valued keys are absent', () => {
  assert.equal(tolerantEqual('  Benoît ', 'Benoît'), true); assert.equal(tolerantEqual('Benoit', 'Benoît'), false);
  assert.equal(tolerantEqual('a  b', 'a b'), false, 'inner whitespace counts'); assert.equal(tolerantEqual('A', 'a'), false);
  assert.equal(tolerantEqual({ vmax: 4.0213, km: 0.512, unit: 'mM ' }, { unit: 'mM', km: 0.5101, vmax: 4.0198 }), true);
  assert.equal(tolerantEqual({ a: 1 }, { a: 1, b: 2 }), false); assert.equal(tolerantEqual({ a: 1, b: undefined }, { a: 1 }), true);
  assert.equal(tolerantEqual({ a: 1 }, { b: 1 }), false); assert.equal(tolerantEqual({}, []), false); assert.equal(tolerantEqual([], []), true);
});

test('arrays are multisets: permuted arrays of objects with near-equal numbers, nested arrays, duplicates', () => {
  const want = [{ id: 'S1', vmax: 4.0, km: 0.50 }, { id: 'S2', vmax: 7.2, km: 1.10 }, { id: 'S3', vmax: 4.0, km: 0.90 }];
  const got = [{ id: 'S3', vmax: 4.01, km: 0.902 }, { km: 0.4999, vmax: 3.99, id: 'S1' }, { id: 'S2', vmax: 7.25, km: 1.1 }];
  assert.equal(tolerantEqual(got, want), true);
  assert.equal(tolerantEqual(got, want, { relTol: 0.001 }), false, 'a tighter tolerance separates them');
  assert.equal(tolerantEqual([[1, 2.001], [3]], [[3.0001], [2, 1]]), true, 'nested arrays are multisets too');
  assert.equal(tolerantEqual([[1, 2]], [[1, 2, 2]]), false);
  assert.equal(tolerantEqual([1, 1, 2], [1, 2, 2]), false, 'multiplicity counts'); assert.equal(tolerantEqual([1, 1, 2], [2, 1, 1]), true);
  assert.equal(tolerantEqual([1, 2], [1, 2, 3]), false);
  // Tolerance is not transitive: pairing the identical 1.0s first would leave 0.991 with 1.0099 (no edge). A real matching
  // pairs 1.0-1.0099 and 0.991-1.0.
  assert.equal(numbersEqual(0.991, 1.0099, T), false);
  assert.equal(tolerantEqual([1.0, 0.991], [1.0, 1.0099]), true);
  assert.equal(tolerantEqual([{ x: 1.0 }, { x: 0.991 }], [{ x: 1.0 }, { x: 1.0099 }]), true, 'the same with objects');
});

test('arrays above the matching cap use the sound greedy fallback: "equal" is still never wrong', () => {
  const n = Math.ceil(Math.sqrt(MATCH_CAP)) + 5;
  const a = Array.from({ length: n }, (_, i) => i * 10), b = [...a].reverse().map(x => x * 1.001);
  const stats = {};
  assert.equal(tolerantEqual(a, b, {}, stats), true); assert.equal(stats.approx, 1);
  const c = [...b]; c[0] = -999;
  assert.equal(tolerantEqual(a, c), false);
});

test('assignMax is an optimal assignment (brute force on random small matrices, both shapes)', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const perms = k => (k <= 1 ? [[...Array(k).keys()]] : perms(k - 1).flatMap(p => Array.from({ length: k }, (_, i) => [...p.slice(0, i), k - 1, ...p.slice(i)])));
  for (let t = 0; t < 400; t++) {
    const n = 1 + Math.floor(rnd() * 4), m = 1 + Math.floor(rnd() * 4);
    const W = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.floor(rnd() * 6)));
    const a = assignMax(W, n, m), cols = a.filter(j => j >= 0);
    assert.equal(new Set(cols).size, cols.length, 'each column at most once');
    const got = a.reduce((s, j, i) => s + (j >= 0 ? W[i][j] : 0), 0);
    let best = 0;
    for (const p of perms(Math.max(n, m))) { let s = 0; for (let i = 0; i < n; i++) if (p[i] < m) s += W[i][p[i]]; best = Math.max(best, s); }
    assert.equal(got, best, JSON.stringify(W));
  }
});

test('tolerantAgreement: partial agreement with optimal item pairing, tolerant leaves, diffs, and canonical-equal inputs', () => {
  const want = { records: [{ id: 1, name: 'Ann', amount: 1 }, { id: 2, name: 'Bo', amount: 2 }] };
  const got = { records: [{ id: 2, name: 'Bo ', amount: 2.001 }, { id: 1, name: 'Ann', amount: 9 }] };
  const d = tolerantAgreement(got, want);
  assert.equal(d.exact, false); assert.equal(d.matched, 5); assert.equal(d.compared, 6); assert.deepEqual(d.diffs, [{ path: '$.records[0].amount', got: 9, want: 1 }]);
  assert.equal(d.approx, 0);
  // Same leaves and denominators as check-traces' canonical diff when nothing is near-equal.
  for (const [g, w] of [[[1, 2, 7], [1, 2]], [{ a: 1, b: 2 }, { a: 1 }], [[{ id: 1 }], [{ id: 1 }, { id: 2 }]], [{ a: '1' }, { a: 1 }], [{ a: [] }, { a: {} }]]) {
    const t = tolerantAgreement(g, w), c = compare(g, w);
    assert.equal(t.partial, c.partial, JSON.stringify([g, w])); assert.equal(t.exact, c.exact); assert.deepEqual(t.diffs, c.diffs);
  }
  assert.equal(leaves({ a: [], b: { c: [1, 2], d: {} } }), ctLeaves({ a: [], b: { c: [1, 2], d: {} } }));
  // Greedy pairing by overlap can lose; the optimal assignment does not. g1 overlaps w1 most (3), so greedy takes it and
  // leaves g2-w2 (0): 3 leaves. Pairing g1-w2 (2) and g2-w1 (2) matches 4.
  const W = [{ a: 1, b: 1, c: 1, d: 0 }, { a: 1, b: 1, c: 0, d: 5 }], G = [{ a: 1, b: 1, c: 1, d: 9 }, { a: 7, b: 7, c: 1, d: 0 }];
  assert.equal(compare(G, W).matched, 3, 'check-traces greedy'); assert.equal(tolerantAgreement(G, W).matched, 4, 'optimal');
  const kinetic = tolerantAgreement({ fits: [{ s: 'B', vmax: 3.31 }, { s: 'A', vmax: 4.0213 }] }, { fits: [{ s: 'A', vmax: 4.0198 }, { s: 'B', vmax: 3.3 }] });
  assert.deepEqual([kinetic.exact, kinetic.partial], [true, 1]);
  assert.equal(compare({ fits: [{ s: 'A', vmax: 4.0213 }] }, { fits: [{ s: 'A', vmax: 4.0198 }] }).exact, false, 'canonical says no');
  assert.deepEqual(tolerantAgreement(null, null), { exact: true, partial: 1, matched: 1, compared: 1, diffs: [], approx: 0 });
});

test('check-traces options: --tolerant/--rel-tol/--abs-tol/--exact; a defaults file; canonical stays the default', () => {
  assert.deepEqual(parseArgs([]), { only: null, max: Infinity, jobs: 3, timeout: 600, out: '.check' }, 'no new keys by default');
  assert.equal(comparisonOf(parseArgs([])), null);
  assert.deepEqual(comparisonOf(parseArgs(['--tolerant'])), { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 });
  assert.deepEqual(comparisonOf(parseArgs(['--tolerant', '--rel-tol', '0.05', '--abs-tol', '0.001'])), { mode: 'tolerant', relTol: 0.05, absTol: 0.001 });
  const file = { compare: 'tolerant', relTol: 0.02, absTol: 0 };
  assert.deepEqual(comparisonOf(parseArgs([]), file), { mode: 'tolerant', relTol: 0.02, absTol: 0 }, 'check-traces.json beside the tool');
  assert.equal(comparisonOf(parseArgs(['--exact']), file), null, '--exact overrides the file');
  assert.deepEqual(comparisonOf(parseArgs(['--rel-tol', '0.5']), file), { mode: 'tolerant', relTol: 0.5, absTol: 0 });
  assert.throws(() => comparisonOf(parseArgs(['--rel-tol', '0.5'])), /need --tolerant/);
  assert.throws(() => parseArgs(['--tolerant', '--rel-tol', '-1']), /--rel-tol needs a finite number >= 0/);
  assert.throws(() => parseArgs(['--abs-tol']), /--abs-tol needs/);
  // The aggregate only grows the tolerant fields in a tolerant run.
  const perCase = [{ id: 'trace-0', kind: 'trace', status: 'exact', exact: true, partial: 1, costUsd: 0, canonicalExact: false }];
  assert.equal('compare' in aggregate(perCase, { total: 1 }), false);
  const agg = aggregate(perCase, { total: 1, cmp: { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 } });
  assert.deepEqual(agg.compare, { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }); assert.equal(agg.canonicalExact, 0);
});
