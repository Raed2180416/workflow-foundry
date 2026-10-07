import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Journal, REPLAYABLE_ERRORS, isReplayable } from '../src/journal.mjs';

const entry = (over = {}) => ({ replayKey: 'k1', runId: 'run-1', nodeKey: 'norm', attempt: 1, sampleIndex: 0, modelId: 'qwen3.5-2b-q4km',
  provider: 'llama-server', engineVersion: 'llama-server test', decoding: { maxTokens: 64, reasoning: 'none', temperature: null },
  receiptHash: 'r'.repeat(64), promptHash: 'p'.repeat(64), request: { system: 's', prompt: 'p' }, response: { value: { a: 1 }, text: '{"a":1}' },
  ok: true, inputTokens: 10, outputTokens: 5, costUsd: 0, imputedUsd: 0.001, latencyMs: 18, ...over });

test('journal creates model_calls and its indexes idempotently on a shared handle', () => {
  const db = new DatabaseSync(':memory:');
  new Journal(db); new Journal(db);
  const columns = db.prepare('PRAGMA table_info(model_calls)').all().map(c => c.name);
  assert.deepEqual(columns, ['id', 'replay_key', 'run_id', 'node_key', 'attempt', 'sample_index', 'model_id', 'provider', 'engine_version', 'decoding',
    'receipt_hash', 'prompt_hash', 'request', 'response', 'ok', 'error_code', 'input_tokens', 'output_tokens', 'cost_usd', 'imputed_usd', 'latency_ms', 'created_at']);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='model_calls' ORDER BY name").all().map(r => r.name);
  assert.deepEqual(indexes, ['model_calls_attempt', 'model_calls_replay']);
  assert.throws(() => new Journal({}), { code: 'JOURNAL_DB' });
});

test('record round-trips every field and lookup returns the latest replayable row for a key', () => {
  const journal = new Journal(new DatabaseSync(':memory:'));
  const first = journal.record(entry());
  const row = journal.get(first);
  assert.equal(row.replayKey, 'k1'); assert.equal(row.ok, true); assert.equal(row.errorCode, null);
  assert.deepEqual(row.decoding, { maxTokens: 64, reasoning: 'none', temperature: null });
  assert.deepEqual(row.response.value, { a: 1 }); assert.equal(row.request.prompt, 'p');
  assert.equal(row.imputedUsd, 0.001); assert.equal(row.latencyMs, 18); assert.equal(typeof row.createdAt, 'number');
  const schemaFailure = journal.record(entry({ ok: false, errorCode: 'MODEL_SCHEMA', response: { text: 'nope' } }));
  assert.equal(journal.lookup('k1').id, schemaFailure, 'model-behaviour failures replay as recorded');
  journal.record(entry({ ok: false, errorCode: 'MODEL_RATE_LIMIT' }));
  journal.record(entry({ ok: false, errorCode: 'MODEL_TIMEOUT' }));
  journal.record(entry({ ok: false, errorCode: 'CANCELLED' }));
  assert.equal(journal.lookup('k1').id, schemaFailure, 'environment faults are journaled but never replayed');
  assert.equal(journal.lookup('missing'), null);
  assert.deepEqual(REPLAYABLE_ERRORS, ['MODEL_SCHEMA', 'MODEL_TRUNCATED', 'MODEL_REFUSAL']);
  assert.equal(isReplayable(journal.get(schemaFailure)), true);
});

test('forAttempt, forRun and costForRun are scoped and ordered', () => {
  const journal = new Journal(new DatabaseSync(':memory:'));
  const a = journal.record(entry({ replayKey: 'a', costUsd: 0.002, imputedUsd: 0, inputTokens: 100, outputTokens: 20, modelId: 'claude-haiku-4-5-20251001', provider: 'claude-cli' }));
  const b = journal.record(entry({ replayKey: 'b', attempt: 2, ok: false, errorCode: 'MODEL_RATE_LIMIT', costUsd: 0, imputedUsd: 0, inputTokens: 0, outputTokens: 0 }));
  const c = journal.record(entry({ replayKey: 'c', imputedUsd: 0.0005, inputTokens: 7, outputTokens: 3 }));
  journal.record(entry({ replayKey: 'd', runId: 'run-2', costUsd: 5 }));
  assert.deepEqual(journal.forAttempt('run-1', 'norm', 1).map(r => r.id), [a, c]);
  assert.deepEqual(journal.forAttempt('run-1', 'norm', 2).map(r => r.id), [b]);
  assert.deepEqual(journal.forRun('run-1').map(r => r.id), [a, b, c]);
  const cost = journal.costForRun('run-1');
  assert.equal(cost.calls, 3); assert.equal(cost.errors, 1);
  assert.ok(Math.abs(cost.costUsd - 0.002) < 1e-12); assert.ok(Math.abs(cost.imputedUsd - 0.0005) < 1e-12);
  assert.equal(cost.inputTokens, 107); assert.equal(cost.outputTokens, 23);
  assert.deepEqual(journal.costForRun('nobody'), { calls: 0, costUsd: 0, imputedUsd: 0, inputTokens: 0, outputTokens: 0, errors: 0 });
});

test('record rejects incomplete or malformed entries without writing', () => {
  const journal = new Journal(new DatabaseSync(':memory:'));
  assert.throws(() => journal.record(entry({ replayKey: undefined })), { code: 'JOURNAL_ENTRY' });
  assert.throws(() => journal.record(entry({ ok: false, errorCode: undefined })), { code: 'JOURNAL_ENTRY' });
  assert.throws(() => journal.record(entry({ costUsd: -1 })), { code: 'JOURNAL_ENTRY' });
  assert.throws(() => journal.record(entry({ attempt: 1.5 })), { code: 'JOURNAL_ENTRY' });
  assert.throws(() => journal.record(entry({ response: { bad: Infinity } })), { code: 'INVALID_NUMBER' });
  assert.equal(journal.forRun('run-1').length, 0);
});

