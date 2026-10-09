// compare.mjs (JIT v2.1, opt-in tolerant comparison) and check-traces' --tolerant mode. No model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tolerantEqual, tolerantAgreement, numbersEqual, assignMax, tolerance, leaves, MATCH_CAP, WORK_CAP, DEFAULT_TOLERANCE, MAX_REL_TOL, MAX_ABS_TOL } from '../compare.mjs';
import { compare, leaves as ctLeaves, parseArgs, comparisonOf, aggregate, MAX_REL_TOL as CT_MAX_REL, MAX_ABS_TOL as CT_MAX_ABS } from '../check-traces.mjs';

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
  assert.deepEqual(comparisonOf(parseArgs(['--tolerant', '--rel-tol', '0.05', '--abs-tol', '0.000001'])), { mode: 'tolerant', relTol: 0.05, absTol: 1e-6 });
  assert.throws(() => comparisonOf(parseArgs(['--tolerant', '--rel-tol', '0.06'])), /looser than 0.05 \/ 0.000001/, 'the same bounds as compare.mjs');
  assert.throws(() => comparisonOf(parseArgs(['--tolerant', '--abs-tol', '0.001'])), /looser than/);
  assert.deepEqual(comparisonOf(parseArgs(['--tolerant', '--rel-tol', '0.5', '--allow-loose-tolerance'])), { mode: 'tolerant', relTol: 0.5, absTol: 1e-9, allowLooseTolerance: true });
  assert.deepEqual(comparisonOf(parseArgs(['--tolerant', '--tolerant-keys', 'vmax, km'])), { mode: 'tolerant', relTol: 0.01, absTol: 1e-9, tolerantKeys: ['km', 'vmax'] });
  assert.throws(() => parseArgs(['--tolerant-keys']), /--tolerant-keys needs/);
  assert.throws(() => comparisonOf(parseArgs(['--tolerant-keys', 'vmax'])), /need --tolerant/);
  assert.deepEqual([CT_MAX_REL, CT_MAX_ABS], [MAX_REL_TOL, MAX_ABS_TOL], 'check-traces repeats compare.mjs\'s bounds');
  const file = { compare: 'tolerant', relTol: 0.02, absTol: 0 };
  assert.deepEqual(comparisonOf(parseArgs([]), file), { mode: 'tolerant', relTol: 0.02, absTol: 0 }, 'check-traces.json beside the tool');
  assert.equal(comparisonOf(parseArgs(['--exact']), file), null, '--exact overrides the file');
  assert.deepEqual(comparisonOf(parseArgs(['--rel-tol', '0.03']), file), { mode: 'tolerant', relTol: 0.03, absTol: 0 });
  assert.deepEqual(comparisonOf(parseArgs([]), { ...file, tolerantKeys: ['vmax'] }), { mode: 'tolerant', relTol: 0.02, absTol: 0, tolerantKeys: ['vmax'] }, 'keys from the file');
  assert.throws(() => comparisonOf(parseArgs([]), { compare: 'tolerant', relTol: 2 }), /looser than/, 'the file is bounded too');
  assert.throws(() => comparisonOf(parseArgs(['--rel-tol', '0.5'])), /need --tolerant/);
  assert.throws(() => parseArgs(['--tolerant', '--rel-tol', '-1']), /--rel-tol needs a finite number >= 0/);
  assert.throws(() => parseArgs(['--abs-tol']), /--abs-tol needs/);
  // The aggregate only grows the tolerant fields in a tolerant run.
  const perCase = [{ id: 'trace-0', kind: 'trace', status: 'exact', exact: true, partial: 1, costUsd: 0, canonicalExact: false }];
  assert.equal('compare' in aggregate(perCase, { total: 1 }), false);
  const agg = aggregate(perCase, { total: 1, cmp: { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 } });
  assert.deepEqual(agg.compare, { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }); assert.equal(agg.canonicalExact, 0);
});

// ---- review fixes (v2.1): integers exact, tolerant keys, bounds, and a work budget for the whole comparison ----
test('two integers are compared exactly (ids, row numbers, counts); non-integers stay tolerant without tolerantKeys', () => {
  const want = { records: [{ entity_id: 150, source_rows: [100, 150], given_name: 'Ana', amount_usd: 1000 }] };
  assert.equal(tolerantEqual({ records: [{ entity_id: 151, source_rows: [101, 151], given_name: 'Ana', amount_usd: 1000 }] }, want), false, 'entity_id 151 is not 150');
  assert.equal(tolerantEqual({ records: [{ entity_id: 150, source_rows: [100, 151], given_name: 'Ana', amount_usd: 1000 }] }, want), false, 'row 151 is not 150');
  assert.equal(numbersEqual(1000, 1009, T), false); assert.equal(numbersEqual(-5, -5, T), true); assert.equal(numbersEqual(4, 4.02, T), true, 'one integer, one fitted value: tolerant');
  // Documented limit: a non-integer amount is still tolerant without tolerantKeys; tolerantKeys (or relTol 0) closes it.
  const cents = { records: [{ entity_id: 150, source_rows: [100, 150], given_name: 'Ana', amount_usd: 1009.9 }] };
  assert.equal(tolerantEqual(cents, want), true);
  assert.equal(tolerantEqual(cents, want, { tolerantKeys: ['vmax', 'km'] }), false, 'amount_usd is not a tolerant key');
  assert.equal(tolerantEqual(cents, want, { relTol: 0, absTol: 0 }), false);
});

test('tolerantKeys: only numbers under a listed key are tolerant; arrays pass the key to their items; everything else exact', () => {
  const tol = { tolerantKeys: ['vmax', 'km'] };
  assert.deepEqual(tolerance(tol), { relTol: 0.01, absTol: 1e-9, tolerantKeys: ['km', 'vmax'] });
  const want = { conditions: [{ condition_id: 'C1', vmax: 4.0198, km: 120 }, { condition_id: 'C2', vmax: 3.3, km: 80 }], excluded_samples: ['S3'] };
  const got = { excluded_samples: [' S3'], conditions: [{ condition_id: 'C2', vmax: 3.31, km: 80.5 }, { condition_id: 'C1', vmax: 4.0213, km: 121 }] };
  assert.equal(tolerantEqual(got, want, tol), true, 'km 121 vs 120 (both integers) is tolerant: km is listed');
  assert.equal(tolerantEqual(got, want), false, 'without keys, two integers (121, 120) are exact');
  assert.equal(tolerantEqual({ vmax: [4.0213, 3.31] }, { vmax: [3.3, 4.0198] }, tol), true, 'an array under a listed key: its items are tolerant');
  assert.equal(tolerantEqual({ vmax: { fit: 4.0213 } }, { vmax: { fit: 4.0198 } }, tol), false, 'a nested object resets the key: fit is not listed');
  assert.equal(tolerantEqual(4.0213, 4.0198, tol), false, 'a top-level number has no key: exact when keys are listed');
  assert.equal(tolerantEqual({ other: 4.0213 }, { other: 4.0198 }, tol), false);
  const d = tolerantAgreement(got, want, tol);
  assert.deepEqual([d.exact, d.partial], [true, 1]);
  const d2 = tolerantAgreement({ ...got, conditions: [{ ...got.conditions[0], vmax: 3.31 }, { ...got.conditions[1], condition_id: 'C1', vmax: 4.0213, km: 130 }] }, want, tol);
  assert.deepEqual(d2.diffs, [{ path: '$.conditions[0].km', got: 130, want: 120 }]);
  for (const bad of [[], 'vmax', [1], ['']]) assert.throws(() => tolerance({ tolerantKeys: bad }), /tolerantKeys must be a non-empty list/);
});

test('tolerance bounds: relTol <= 0.05 and absTol <= 1e-6 unless allowLooseTolerance is set (and then it is recorded)', () => {
  assert.equal(MAX_REL_TOL, 0.05); assert.equal(MAX_ABS_TOL, 1e-6);
  assert.deepEqual(tolerance({ relTol: 0.05, absTol: 1e-6 }), { relTol: 0.05, absTol: 1e-6 });
  assert.throws(() => tolerance({ relTol: 2 }), /looser than 0\.05/); assert.throws(() => tolerance({ absTol: 1e9 }), /looser than/);
  assert.throws(() => tolerantEqual({ vmax: 4, km: 1 }, { vmax: -1000, km: 1e6 }, { relTol: 2 }), /looser than/, 'review repro: relTol 2 no longer makes anything equal');
  assert.throws(() => tolerantEqual(100, 110, { relTol: 0.1 }), /looser than/, 'the oracle\'s own 10% (a near-miss control is 12% off) is refused by default');
  assert.deepEqual(tolerance({ relTol: 0.1, allowLooseTolerance: true }), { relTol: 0.1, absTol: 1e-9, allowLooseTolerance: true });
  assert.equal(tolerantEqual(100, 109.5, { relTol: 0.1, allowLooseTolerance: true }), true);
  assert.deepEqual(tolerance({ allowLooseTolerance: false }), { relTol: 0.01, absTol: 1e-9 }, 'false is the default and is not recorded');
  assert.throws(() => tolerance({ allowLooseTolerance: 'yes' }), /allowLooseTolerance must be true or false/);
});

test('partial agreement above the per-array cap pairs the rest optimally (no worse than canonical); the work budget bounds nested arrays', () => {
  // Review P2-2: 210 records, 10 permuted with one wrong leaf. The key-equal pass, then an optimal assignment of the rest.
  const mk = (i, x) => ({ id: `e${i}`, name: `name${i}`, rows: [i], amt: x });
  const want = Array.from({ length: 210 }, (_, i) => mk(i, i + 0.5)), got = want.map(o => ({ ...o }));
  for (let i = 200; i < 210; i++) got[i] = { ...want[409 - i], amt: -1 };
  const t = tolerantAgreement(got, want), c = compare(got, want);
  assert.ok(t.approx >= 1); assert.ok(t.partial >= c.partial - 1e-12, `${t.partial} >= canonical ${c.partial}`);
  assert.ok(Math.abs(t.partial - (210 * 4 - 10) / (210 * 4)) < 1e-9);
  // Review P2-4 / P2-3: 200 groups x 200 members, every group different, half the members shared. Per-array caps alone
  // took minutes; the budget keeps it to seconds, with a sane lower bound (pairs by a cheap score once over the budget).
  const shuffle = (x, s = 7) => { const y = [...x]; for (let i = y.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [y[i], y[j]] = [y[j], y[i]]; } return y; };
  const g = off => Array.from({ length: 200 }, (_, i) => ({ id: off + i, members: Array.from({ length: 200 }, (_, j) => `m${i}-${j}`) }));
  const A = g(0), B = shuffle(g(10000)).map(x => ({ ...x, members: shuffle(x.members).map((m, j) => (j % 2 ? m : m + 'x')) }));
  const started = Date.now(), r = tolerantAgreement(A, B);
  assert.ok(Date.now() - started < 20000, `bounded (${Date.now() - started} ms)`);
  assert.ok(r.approx > 0); assert.ok(r.partial > 0.45 && r.partial <= 0.5, `partial ${r.partial}`);
  // Nested arrays of near-equal numbers (80 x 80): the budget does not lose the in-order pairing.
  const nest = off => Array.from({ length: 80 }, (_, i) => Array.from({ length: 80 }, (_, j) => (i * 1000 + j * 7.3 + 1) * (1 + off)));
  const n = tolerantAgreement(nest(0.001), nest(0));
  assert.deepEqual([n.exact, n.partial], [true, 1]);
  assert.equal(tolerantEqual(nest(0.001), [...nest(0)].reverse()), true, 'permuted outer array: still a real matching');
  assert.ok(WORK_CAP >= 1e6);
});
