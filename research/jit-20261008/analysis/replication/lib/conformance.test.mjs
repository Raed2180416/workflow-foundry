// node --test research/jit-20261008/analysis/replication/lib/conformance.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { conform, accept, project, spearman, kendall, textNorm } from './conformance.mjs';

const N = { timeTolerance: 1, order: 'auto' };
const ev = (type, key, t, extra = {}) => ({ case: 'c', type, key, ...(t === undefined ? {} : { t }), ...extra });

test('identical logs: fitness = precision = 1', () => {
  const L = [ev('a', { x: 1 }, 0), ev('b', { x: 2 }, 30), ev('b', { x: 2 }, 90)];
  const r = conform(L, L, N);
  assert.equal(r.fitness, 1); assert.equal(r.precision, 1); assert.ok(accept(r));
});

test('a missing effect lowers fitness only; an extra effect lowers precision only', () => {
  const E = [ev('a', {}, 0), ev('b', {}, 10), ev('c', {}, 20)];
  const r1 = conform(E, E.slice(0, 2), N);
  assert.equal(r1.fitness, 2 / 3); assert.equal(r1.precision, 1);
  const r2 = conform(E, [...E, ev('d', {}, 30)], N);
  assert.equal(r2.fitness, 1); assert.equal(r2.precision, 3 / 4);
  assert.ok(!accept(r1) && !accept(r2));
});

test('time tolerance: +-1 s passes, +1.1 s fails', () => {
  const E = [ev('a', {}, 10)];
  assert.ok(accept(conform(E, [ev('a', {}, 10.9)], N)));
  assert.ok(!accept(conform(E, [ev('a', {}, 11.1)], N)));
  assert.equal(conform(E, [ev('a', {}, 11.1)], N).fitness, 0);
});

test('timestamped streams are bags: same-instant swap is not penalised', () => {
  const E = [ev('push', {}, 20), ev('speech', {}, 20)];
  const O = [ev('speech', {}, 20), ev('push', {}, 20)];
  assert.ok(accept(conform(E, O, N)));
});

test('untimed streams are sequences: a swap costs one move each way, order moves are reported', () => {
  const E = [ev('create', { k: 1 }), ev('slack', { k: 1 })];
  const O = [ev('slack', { k: 1 }), ev('create', { k: 1 })];
  const r = conform(E, O, N);
  assert.equal(r.matched, 1); assert.equal(r.fitness, 0.5); assert.equal(r.precision, 0.5);
  assert.equal(r.cases.c.orderMoves, 1);
});

test('streams commute with each other', () => {
  const E = [ev('a', {}, undefined, { stream: 's1' }), ev('b', {}, undefined, { stream: 's2' })];
  const O = [ev('b', {}, undefined, { stream: 's2' }), ev('a', {}, undefined, { stream: 's1' })];
  assert.ok(accept(conform(E, O, N)));
  assert.ok(!accept(conform(E, [ev('b', {}, undefined, { stream: 's1' }), ev('a', {}, undefined, { stream: 's2' })], N)));
});

test('normalisation: text (quotes, whitespace), set, duration, ignore, tokens, unixDate', () => {
  assert.equal(textNorm('it’s  a test '), "it's a test");
  const M = { ...N, fieldRules: { buttons: 'set', dur: 'duration', icon: 'ignore', body: 'tokens:\\d+\\.\\d+', dob: 'unixDate' } };
  const a = project(ev('x', { buttons: ['B', 'A'], dur: '0:30:00', icon: 'x', body: 'old 1.2 new 3.4', dob: String(Date.UTC(2000, 4, 5) / 1000) }), M);
  const b = project(ev('x', { buttons: ['A', 'B'], dur: 1800, icon: 'y', body: 'new 3.4 then 1.2', dob: String(Date.UTC(2000, 4, 4, 22) / 1000) }), M);
  assert.equal(a.sig, b.sig);
  assert.notEqual(project(ev('x', { buttons: ['A'] }), N).sig, project(ev('x', { buttons: ['A', 'B'] }), N).sig);
});

test('empty logs: both empty is perfect; do-nothing has fitness 0 and vacuous precision', () => {
  assert.equal(conform([], [], N).nCases, 0);
  const r = conform([ev('a', {}, 1)], [], N);
  assert.equal(r.fitness, 0); assert.equal(r.precision, 1); assert.equal(r.f1, 0);
});

test('rank statistics', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(kendall([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  assert.ok(Math.abs(kendall([1, 1, 2, 3], [1, 2, 2, 3]) - 0.8) < 1e-9);
});
