// OUT-0 transfer table helpers ($0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mcnemarExact, mcnemarMde, pairArms } from '../transfer.mjs';

test('exact McNemar and its MDE', () => {
  assert.equal(mcnemarExact(4, 0), 0.125);
  assert.equal(mcnemarExact(0, 0), 1);
  assert.equal(mcnemarMde(14).discordant, 6);
  assert.equal(mcnemarMde(6).share, 1);
  assert.equal(mcnemarMde(4).discordant, null);
});

const row = (key, kind, s, t) => ({ task: { key }, verdict: { kind, pass: s === t, successes: s, total: t, score: s / t } });

test('count rows pair only when one arm is perfect; binary rows pair exactly', () => {
  const p = pairArms([row('w', 'count', 14, 14)], [row('w', 'count', 10, 14)]);
  assert.deepEqual(p.discordant, { aOnly: 4, bOnly: 0 });
  assert.equal(p.mcnemarP, 0.125); assert.equal(p.cases, 14);
  const q = pairArms([row('w', 'count', 12, 14)], [row('w', 'count', 10, 14)]);
  assert.equal(q.discordant, null); assert.equal(q.mcnemarP, null);
  const b = pairArms([row('a', 'binary', 1, 1), row('b', 'binary', 0, 1)], [row('a', 'binary', 0, 1), row('b', 'binary', 0, 1), row('c', 'binary', 1, 1)]);
  assert.equal(b.pairedKeys, 2); assert.deepEqual(b.discordant, { aOnly: 1, bOnly: 0 });
});
