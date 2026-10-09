// node --test research/jit-20261008/analysis/replication/census/lib.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normGraph, gedUpper, distance, lowerBound, titleStem, jaccard, typeNorm } from './lib.mjs';
const mk = (types, edges) => normGraph({ graph: { nodes: types.map((t, i) => ({ id: `n${i}`, type: t, category: t.split(':')[0], effects: 'none' })), edges: edges.map(([a, b]) => ({ from: `n${a}`, to: `n${b}`, kind: 'control' })) } });
test('identical graphs have distance 0; renamed ids/numbers are normalised', () => {
  const A = mk(['trigger:a1', 'action:b', 'action:c'], [[0, 1], [1, 2]]), B = mk(['trigger:a2', 'action:b', 'action:c'], [[0, 1], [1, 2]]);
  assert.equal(distance(A, B).d, 0); assert.equal(typeNorm('node-7:v2'), 'node-#:v#');
});
test('one extra node and edge: distance = (1 + 0.5*1 ... ) / size, small and positive; unrelated graphs are far', () => {
  const A = mk(['trigger:a', 'action:b', 'action:c'], [[0, 1], [1, 2]]), B = mk(['trigger:a', 'action:b', 'action:c', 'action:d'], [[0, 1], [1, 2], [2, 3]]);
  const d = distance(A, B).d; assert.ok(d > 0 && d < 0.4, String(d));
  const C = mk(['loop:x', 'model:y', 'human:z'], [[1, 0]]); assert.ok(distance(A, C).d > 0.5);
  assert.ok(lowerBound(A, B) <= d + 1e-9 && lowerBound(A, C) <= distance(A, C).d + 1e-9);
});
test('symmetry', () => {
  const A = mk(['trigger:a', 'action:b', 'loop:c'], [[0, 1], [1, 2]]), B = mk(['trigger:a', 'action:b'], [[0, 1]]);
  assert.ok(Math.abs(distance(A, B).d - distance(B, A).d) < 1e-9);
});
test('lineage helpers', () => { assert.equal(titleStem('Report v2 (copy) 12'), 'report'); assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3); });
