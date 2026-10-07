// ownerci hidden regression tests for src/journal.mjs. Authored for the bed from the ORIGINAL
// module's behaviour at the frozen commit; never shown to solvers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Journal, REPLAYABLE_ERRORS, isReplayable } from './src/journal.mjs';

const base = (over = {}) => ({ replayKey: 'k', runId: 'r', nodeKey: 'n', modelId: 'm', ok: true, ...over });
const fresh = () => new Journal(new DatabaseSync(':memory:'));
const rejects = (journal, entry, message) => assert.throws(() => journal.record(entry), e => e.name === 'FoundryError' && e.code === 'JOURNAL_ENTRY' && e.message === message, message);

test('hidden journal: constructor accepts a handle or an object holding one', () => {
  const db = new DatabaseSync(':memory:');
  const viaStore = new Journal({ db });
  assert.equal(viaStore.db, db);
  assert.equal(new Journal(db).db, db);
  for (const bad of [null, undefined, {}, { db: {} }, 'file.db']) {
    assert.throws(() => new Journal(bad), e => e.code === 'JOURNAL_DB' && e.message === 'Journal requires a node:sqlite DatabaseSync handle');
  }
});

test('hidden journal: integer fields accept zero and null but reject negatives, fractions and strings', () => {
  const j = fresh();
  const id = j.record(base({ attempt: 0, sampleIndex: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }));
  const row = j.get(id);
  assert.deepEqual([row.attempt, row.sampleIndex, row.inputTokens, row.outputTokens, row.latencyMs], [0, 0, 0, 0, 0]);
  const nulls = j.get(j.record(base({ attempt: null })));
  assert.deepEqual([nulls.attempt, nulls.sampleIndex, nulls.inputTokens, nulls.latencyMs], [null, null, null, null]);
  rejects(j, base({ attempt: -1 }), 'attempt must be an integer >= 0');
  rejects(j, base({ sampleIndex: 2.5 }), 'sampleIndex must be an integer >= 0');
  rejects(j, base({ inputTokens: '10' }), 'inputTokens must be an integer >= 0');
  rejects(j, base({ outputTokens: 2 ** 53 }), 'outputTokens must be an integer >= 0');
  rejects(j, base({ latencyMs: -3 }), 'latencyMs must be an integer >= 0');
  assert.equal(j.forRun('r').length, 2);
});

test('hidden journal: money fields default to zero and must be finite and non-negative', () => {
  const j = fresh();
  const row = j.get(j.record(base()));
  assert.equal(row.costUsd, 0); assert.equal(row.imputedUsd, 0);
  assert.equal(j.get(j.record(base({ costUsd: 0, imputedUsd: 0.25 }))).imputedUsd, 0.25);
  rejects(j, base({ costUsd: -0.0001 }), 'costUsd must be a non-negative number');
  rejects(j, base({ costUsd: '0.1' }), 'costUsd must be a non-negative number');
  rejects(j, base({ imputedUsd: NaN }), 'imputedUsd must be a non-negative number');
  rejects(j, base({ imputedUsd: Infinity }), 'imputedUsd must be a non-negative number');
});

test('hidden journal: required and optional strings', () => {
  const j = fresh();
  rejects(j, base({ replayKey: undefined }), 'replayKey is required');
  rejects(j, base({ runId: null }), 'runId is required');
  rejects(j, base({ nodeKey: '' }), 'nodeKey must be a string');
  rejects(j, base({ modelId: 5 }), 'modelId must be a string');
  rejects(j, base({ provider: 5 }), 'provider must be a string');
  rejects(j, base({ promptHash: {} }), 'promptHash must be a string');
  const row = j.get(j.record(base({ provider: '', engineVersion: 'v', receiptHash: null })));
  assert.equal(row.provider, ''); assert.equal(row.engineVersion, 'v'); assert.equal(row.receiptHash, null);
  for (const bad of [null, undefined, 'entry', 7]) assert.throws(() => j.record(bad), e => e.code === 'JOURNAL_ENTRY' && e.message === 'A journal entry object is required');
});

test('hidden journal: only ok === true is a success; failures need a non-empty error code', () => {
  const j = fresh();
  rejects(j, base({ ok: false }), 'errorCode is required');
  rejects(j, base({ ok: 1 }), 'errorCode is required');
  rejects(j, base({ ok: 'true', errorCode: '' }), 'errorCode must be a string');
  const truthy = j.get(j.record(base({ ok: 1, errorCode: 'MODEL_SCHEMA' })));
  assert.equal(truthy.ok, false); assert.equal(truthy.errorCode, 'MODEL_SCHEMA');
  const success = j.get(j.record(base({ errorCode: 'MODEL_REFUSAL' })));
  assert.equal(success.ok, true); assert.equal(success.errorCode, null);
  const ids = j.forRun('r').map(r => r.id);
  assert.deepEqual(ids, [truthy.id, success.id]);
  assert.equal(typeof success.id, 'number');
});

test('hidden journal: rows map every column and JSON fields round-trip', () => {
  const j = fresh();
  const entry = base({ attempt: 3, sampleIndex: 1, provider: 'p', engineVersion: 'e', decoding: { b: 2, a: 1 }, receiptHash: 'rh', promptHash: 'ph',
    request: { prompt: 'x' }, response: { value: [1, { z: null }] }, inputTokens: 11, outputTokens: 7, costUsd: 0.5, imputedUsd: 0.125, latencyMs: 42 });
  const row = j.get(j.record(entry));
  const { createdAt, id, ...rest } = row;
  assert.equal(typeof createdAt, 'number'); assert.equal(typeof id, 'number');
  assert.deepEqual(rest, { replayKey: 'k', runId: 'r', nodeKey: 'n', attempt: 3, sampleIndex: 1, modelId: 'm', provider: 'p', engineVersion: 'e',
    decoding: { a: 1, b: 2 }, receiptHash: 'rh', promptHash: 'ph', request: { prompt: 'x' }, response: { value: [1, { z: null }] }, ok: true, errorCode: null,
    inputTokens: 11, outputTokens: 7, costUsd: 0.5, imputedUsd: 0.125, latencyMs: 42 });
  const empty = j.get(j.record(base({ replayKey: 'k2' })));
  assert.deepEqual([empty.decoding, empty.request, empty.response], [null, null, null]);
  assert.equal(j.get(999), null);
});

test('hidden journal: isReplayable is a strict boolean over ok and the replayable error codes', () => {
  assert.equal(isReplayable(null), false);
  assert.equal(isReplayable(undefined), false);
  assert.equal(isReplayable({ ok: true }), true);
  assert.equal(isReplayable({ ok: true, errorCode: 'MODEL_TIMEOUT' }), true);
  for (const code of REPLAYABLE_ERRORS) assert.equal(isReplayable({ ok: false, errorCode: code }), true);
  for (const code of ['MODEL_TIMEOUT', 'MODEL_RATE_LIMIT', 'CANCELLED', null]) assert.equal(isReplayable({ ok: false, errorCode: code }), false);
  assert.ok(Object.isFrozen(REPLAYABLE_ERRORS));
});

test('hidden journal: lookup returns the newest replayable row of its key only', () => {
  const j = fresh();
  const first = j.record(base({ replayKey: 'a' }));
  assert.equal(j.lookup('a').id, first);
  const refusal = j.record(base({ replayKey: 'a', ok: false, errorCode: 'MODEL_REFUSAL' }));
  j.record(base({ replayKey: 'a', ok: false, errorCode: 'MODEL_UNAVAILABLE' }));
  j.record(base({ replayKey: 'b' }));
  assert.equal(j.lookup('a').id, refusal);
  assert.equal(j.lookup('a').ok, false);
  const truncated = j.record(base({ replayKey: 'a', ok: false, errorCode: 'MODEL_TRUNCATED' }));
  assert.equal(j.lookup('a').id, truncated);
  assert.equal(j.lookup('c'), null);
});

test('hidden journal: forAttempt matches run, node and attempt exactly, in insertion order', () => {
  const j = fresh();
  const a = j.record(base({ attempt: 1 }));
  j.record(base({ attempt: 2 }));
  j.record(base({ attempt: 1, nodeKey: 'other' }));
  j.record(base({ attempt: 1, runId: 'r2' }));
  const b = j.record(base({ attempt: 1, ok: false, errorCode: 'X' }));
  assert.deepEqual(j.forAttempt('r', 'n', 1).map(r => r.id), [a, b]);
  assert.deepEqual(j.forAttempt('r', 'n', 3), []);
  assert.deepEqual(j.forRun('r2').map(r => r.runId), ['r2']);
  assert.deepEqual(j.forRun('none'), []);
});

test('hidden journal: costForRun reports unobserved spend with bounds and estimates', () => {
  const j = fresh();
  j.record(base({ costUsd: 0.25, imputedUsd: 0.5, inputTokens: 3, outputTokens: 4 }));
  j.record(base({ response: { costUnknown: true, costUpperUsd: 0.75, costEstimateUsd: 0.125 } }));
  j.record(base({ ok: false, errorCode: 'E', response: { costUnknown: false, costUpperUsd: 9 } }));
  const bounded = j.costForRun('r');
  assert.deepEqual(bounded, { calls: 3, costUsd: 0.25, imputedUsd: 0.5, inputTokens: 3, outputTokens: 4, errors: 1,
    costUnknownCalls: 1, costUnknownUpperUsd: 0.75, costUnknownEstimateUsd: 0.125 });
  j.record(base({ response: { costUnknown: true, costEstimateUsd: 0.25 } }));
  const unbounded = j.costForRun('r');
  assert.equal(unbounded.costUnknownCalls, 2);
  assert.equal(unbounded.costUnknownUpperUsd, null);
  assert.equal(unbounded.costUnknownEstimateUsd, 0.375);
  assert.deepEqual(j.costForRun('other'), { calls: 0, costUsd: 0, imputedUsd: 0, inputTokens: 0, outputTokens: 0, errors: 0 });
  const k = fresh();
  k.record(base({ response: { costUnknown: true, costUpperUsd: 1 } }));
  k.record(base({ response: { costUnknown: true, costUpperUsd: 2 } }));
  assert.deepEqual(Object.fromEntries(Object.entries(k.costForRun('r')).filter(([key]) => key.startsWith('costUnknown'))),
    { costUnknownCalls: 2, costUnknownUpperUsd: 3, costUnknownEstimateUsd: 0 });
});

// ---- added by the 2026-10-07 audit (AUDIT.md F7)
test('hidden journal: modelId is required on every entry', () => {
  const j = new Journal(new DatabaseSync(':memory:'));
  const base = { replayKey: 'k', runId: 'r', nodeKey: 'n', modelId: 'm', ok: true };
  assert.equal(typeof j.record(base), 'number');
  assert.throws(() => j.record({ ...base, modelId: undefined }), { code: 'JOURNAL_ENTRY', message: 'modelId is required' });
  assert.throws(() => j.record({ ...base, modelId: '' }), { code: 'JOURNAL_ENTRY', message: 'modelId must be a string' });
});
