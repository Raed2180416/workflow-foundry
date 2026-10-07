import test from 'node:test';
import assert from 'node:assert/strict';
import { leafAgreement, nodeIdOf, searchNode } from './distill.mjs';

test('nodeIdOf strips map indices', () => {
  assert.equal(nodeIdOf('root/extract:3/read'), 'root/extract/read');
  assert.equal(nodeIdOf('root/a:10/b:2/c'), 'root/a/b/c');
});

test('leafAgreement counts reference leaves and penalises extras', () => {
  assert.equal(leafAgreement({ a: 1, b: ' x ' }, { a: 1, b: 'x' }), 1);
  assert.equal(leafAgreement({ a: 1, b: 'x' }, { a: 2, b: 'x' }), 0.5);
  assert.equal(leafAgreement({ rows: [{ id: 1 }, { id: 2 }] }, { rows: [{ id: 1 }] }), 0.5);
  assert.equal(leafAgreement({ a: 1 }, { a: 1, z: 9 }), 0.5);
  assert.equal(leafAgreement([], []), 1);
  assert.equal(leafAgreement({ a: 1 }, null), 0);
});

test('searchNode drops weak candidates early and assigns the cheapest survivor', async () => {
  const calls = Array.from({ length: 8 }, (_, i) => ({ system: '', prompt: `p${i}`, schema: { type: 'object' }, value: { v: i } }));
  const quality = { cheap: () => ({ v: -1 }), mid: i => ({ v: i }), dear: i => ({ v: i }) };
  const seen = [];
  const modelPort = { call: async ({ modelId, prompt }) => { seen.push(modelId); const i = Number(prompt.slice(1)); return { ok: true, value: quality[modelId](i), costUsd: modelId === 'dear' ? 1 : 0.1 }; } };
  const r = await searchNode({ node: 'n', calls, candidates: ['cheap', 'mid', 'dear'], modelPort, runId: 't', rounds: [2, 8] });
  assert.equal(r.assigned, 'mid');
  assert.equal(seen.filter(m => m === 'cheap').length, 2);
  assert.equal(r.candidates.find(c => c.model === 'mid').n, 8);
});
