// difffuzz.mjs: the differential gate's three verdicts, pairwise disagreement and the ddmin shrinker. $0, pure.
//   nice -n 15 node --test --test-concurrency=1 experiments/lib/difffuzz.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { differentialGate, pairwise, ddmin } from './difffuzz.mjs';

const ids = Array.from({ length: 80 }, (_, i) => `i${i}`);
const inClass = id => Number(id.slice(1)) < 20;                  // i0..i19 are the justified class
const base = Object.fromEntries(ids.map(id => [id, { verdict: !inClass(id) && Number(id.slice(1)) % 2 === 0 }]));
const fixed = Object.fromEntries(ids.map(id => [id, { verdict: inClass(id) ? true : base[id].verdict }]));
const gate = cand => differentialGate({ ids, inClass, intended: () => true, base, candidate: cand });

test('accept: every justified input flipped, no crash, no disagreement elsewhere; the spurious rate is bounded exactly', () => {
  const c = gate(fixed);
  assert.equal(c.verdict, 'accept');
  assert.equal(c.flipped, 20);
  assert.equal(c.outOfClass, 60);
  assert.ok(Math.abs(c.spuriousUpper - (1 - Math.pow(0.05, 1 / 60))) < 1e-9);
});

test('reject on a crash, on a spurious disagreement and on a missed justified input; inconclusive when nothing is exercised', () => {
  assert.equal(gate({ ...fixed, i50: { crash: 'TypeError: x' } }).verdict, 'reject');
  assert.equal(gate({ ...fixed, i50: { verdict: !base.i50.verdict } }).spurious, 1);
  assert.equal(gate({ ...fixed, i3: { verdict: false } }).missed, 1);
  assert.equal(gate({ ...fixed, i3: { verdict: false } }).verdict, 'reject');
  const none = differentialGate({ ids, inClass: () => false, intended: () => true, base, candidate: base });
  assert.equal(none.verdict, 'inconclusive');
  // a base crash is not scored against the candidate
  const bc = differentialGate({ ids, inClass, intended: () => true, base: { ...base, i70: { crash: 'E' } }, candidate: fixed });
  assert.equal(bc.verdict, 'accept'); assert.equal(bc.baseCrashes, 1);
});

test('pairwise: crashes are their own verdict, identical candidates never disagree', () => {
  const p = pairwise(ids, { a: fixed, b: fixed, c: { ...fixed, i5: { crash: 'TypeError: y' } } });
  assert.equal(p['a|b'].disagree, 0);
  assert.equal(p['a|c'].disagree, 1);
  assert.deepEqual(p['b|c'].ids, ['i5']);
  // two crashes of different kinds disagree, two of one kind agree, and a crash never equals a missing verdict
  const q = pairwise(ids, { c: { ...fixed, i5: { crash: 'TypeError: y' } }, d: { ...fixed, i5: { crash: 'KeyError: z' } },
    e: { ...fixed, i5: { crash: 'TypeError: other message' } }, f: { ...fixed, i5: { verdict: undefined } } });
  assert.equal(q['c|d'].disagree, 1);
  assert.equal(q['c|e'].disagree, 0);
  assert.equal(q['c|f'].disagree, 1);
});

test('ddmin finds a 1-minimal failing subset and refuses an input that does not fail', async () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  const r = await ddmin(items, xs => xs.includes(3) && xs.includes(17) && xs.includes(29));
  assert.deepEqual(r.items.sort((a, b) => a - b), [3, 17, 29]);
  await assert.rejects(() => ddmin(items, () => false), /does not fail/);
  const one = await ddmin(items, async xs => xs.includes(11));
  assert.deepEqual(one.items, [11]);
});
