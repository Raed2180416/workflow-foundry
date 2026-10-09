import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harvestJudges, profileJudge, tierDownJudge, kevRecords } from '../tierdown.mjs';

const schema = { type: 'object', properties: { meaning: { type: 'string', enum: ['void', 'live'] }, quote: { type: 'string' } }, required: ['meaning', 'quote'] };
const ev = (name, i, value, tier = 'claude-haiku-5-5', tried = 1) => ({ kind: 'judge', name, tier, tiersTried: Array.from({ length: tried }, () => ({ model: tier, ok: true })),
  system: 'sys', prompt: `p${i}`, schema, value, costUsd: 0.001 });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'tierdown-'));
  for (let t = 0; t < 3; t++) {
    const d = path.join(root, `task-${t}`); mkdirSync(d, { recursive: true });
    const events = [{ kind: 'step', name: 'parse' }];
    for (let i = 0; i < 3; i++) events.push(ev('status', 3 * t + i, { meaning: i % 2 ? 'void' : 'live', quote: `q${i}` }));
    for (let i = 0; i < 2; i++) events.push(ev('order', 2 * t + i, { order: 'dmy' }, 'claude-sonnet-5-5', 2));
    writeFileSync(path.join(d, 'trace.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  }
  // The same call embedded in a results row must not be counted twice.
  writeFileSync(path.join(root, 'results.jsonl'), JSON.stringify({ taskId: 'x', trace: [ev('status', 0, { meaning: 'live', quote: 'q0' })] }) + '\n');
  return root;
}

test('harvest groups judge events by name and dedupes embedded copies', () => {
  const j = harvestJudges(fixture());
  assert.deepEqual([...j.keys()].sort(), ['order', 'status']);
  assert.equal(j.get('status').length, 9);
  assert.equal(j.get('order').length, 6);
});

test('profile reports tiers, escalation and constants', () => {
  const j = harvestJudges(fixture());
  const order = profileJudge(j.get('order')), status = profileJudge(j.get('status'));
  assert.equal(order.modalTier, 'claude-sonnet-5-5');
  assert.equal(order.escalationRate, 1);
  assert.deepEqual(order.constant, { order: 'dmy' });
  assert.equal(status.constant, undefined);
  assert.equal(status.distinctValues, 3);
});

test('tier-down tries only cheaper tiers and assigns on agreement', async () => {
  const j = harvestJudges(fixture());
  const seen = [];
  const modelPort = { call: async ({ modelId }) => { seen.push(modelId); return { ok: true, value: { order: 'dmy' }, costUsd: 0.0001 }; } };
  const r = await tierDownJudge({ calls: j.get('order'), modelPort, runId: 't', rounds: [2, 6] });
  assert.equal(r.assigned, 'claude-haiku-5-5');
  assert.ok(seen.every(m => m === 'claude-haiku-5-5'));
  const none = await tierDownJudge({ calls: j.get('status'), modelPort, runId: 't' });
  assert.equal(none.assigned, null);
  assert.match(none.reason, /cheapest/);
});

test('Kev export emits one classification question per enum field', () => {
  const recs = kevRecords(harvestJudges(fixture()).get('status'));
  assert.equal(recs.length, 9);
  assert.deepEqual(Object.keys(recs[0].questions), ['meaning']);
  assert.deepEqual(recs[0].questions.meaning.criteria, ['void', 'live']);
  assert.equal(new Set(recs.map(r => r._meta.id)).size, 9);
});

test('decision agreement ignores evidence fields', async () => {
  const { decisionAgreement, stripEvidence } = await import('../tierdown.mjs');
  const a = { systems: [{ name: 'LEDGR', order: 'DMY', quote: 'Datum ist TT.MM.' }], reason: 'x' };
  const b = { systems: [{ name: 'LEDGR', order: 'DMY', quote: 'Datum: TT.MM.JJJJ' }], reason: 'y' };
  assert.equal(decisionAgreement(a, b), 1);
  assert.deepEqual(stripEvidence(a), { systems: [{ name: 'LEDGR', order: 'DMY' }] });
  assert.ok(decisionAgreement(a, { systems: [{ name: 'LEDGR', order: 'MDY', quote: 'z' }] }) < 1);
});

test('decisionAgreement with a tolerance (v2.1, opt-in): fitted numbers within tolerance agree, items pair as a multiset; without one, unchanged', async () => {
  const { decisionAgreement } = await import('../tierdown.mjs');
  const ref = { fits: [{ s: 'A', vmax: 4.0198, quote: 'x' }, { s: 'B', vmax: 3.3 }] }, cand = { fits: [{ s: 'B', vmax: 3.31 }, { s: 'A', vmax: 4.0213, quote: 'other' }] };
  assert.ok(decisionAgreement(ref, cand) < 0.5, 'default: positional, exact numbers');
  assert.equal(decisionAgreement(ref, cand, { relTol: 0.01, absTol: 1e-9 }), 1);
  assert.equal(decisionAgreement(ref, cand, { relTol: 0.0001, absTol: 0 }), 0.5, 'the names still pair; the vmax leaves do not');
  assert.equal(decisionAgreement({ v: 5 }, { v: -5 }, { relTol: 0.5, absTol: 0 }), 0, 'a sign flip is a difference (|a-b| = 10 > 0.5 x 5)');
});
