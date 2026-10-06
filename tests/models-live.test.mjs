// Opt-in live lane (FOUNDRY_LIVE_MODELS=1): one hosted Haiku structured call through the claude
// CLI and one local qwen3.5-2b-q4km call through llama-server. Development/diagnostic evidence
// only; it proves the providers are REACHABLE, not any capability claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { ClaudeCliProvider } from '../src/models/providers/claude-cli.mjs';
import { LlamaServerProvider } from '../src/models/providers/llama-server.mjs';
import { LlamaSupervisor, DEFAULT_LLAMA_BINARY, DEFAULT_MODELS_DIR } from '../src/models/llama-supervisor.mjs';
import { Journal } from '../src/journal.mjs';

const { policy, hash } = loadPolicy();
const HAIKU = 'claude-haiku-4-5-20251001', QWEN = 'qwen3.5-2b-q4km';
const live = process.env.FOUNDRY_LIVE_MODELS === '1';
const optIn = 'opt-in live lane: set FOUNDRY_LIVE_MODELS=1 (one hosted Haiku call via the claude CLI, about $0.003, and one local qwen3.5-2b-q4km call via llama-server)';
const claudeGate = () => {
  if (!live) return optIn;
  const binary = policy.providers['claude-cli'].binary;
  const probe = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30000 });
  return probe.status === 0 ? false : `requires the '${binary}' CLI on PATH with its managed login (probe exit ${probe.status ?? probe.error?.code})`;
};
const llamaGate = () => {
  if (!live) return optIn;
  const weights = path.join(DEFAULT_MODELS_DIR, policy.models.find(m => m.id === QWEN).weights.file);
  if (!existsSync(DEFAULT_LLAMA_BINARY)) return `requires ${DEFAULT_LLAMA_BINARY}`;
  return existsSync(weights) ? false : `requires local weights ${weights}`;
};
const schema = { type: 'object', additionalProperties: false, required: ['label', 'confidence'], properties: {
  label: { type: 'string', enum: ['positive', 'negative', 'neutral'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } } };
const request = modelId => ({ runId: `live-${Date.now()}`, nodeKey: 'sentiment', attempt: 1, sampleIndex: 0, modelId, schema,
  system: 'You label the sentiment of one customer review. Answer only with the requested JSON object.',
  prompt: '<input name="review" label="untrusted:fixture">I love this kettle: it boils fast and looks great.</input>\n\n## Task\nLabel the sentiment of the review.',
  decoding: { maxTokens: 128, reasoning: 'none' } });
const report = (t, lane, r) => {
  const line = { lane, policyHash: hash.slice(0, 12), modelId: r.modelId, provider: r.provider, engineVersion: r.engineVersion, ok: r.ok, value: r.value,
    error: r.error?.code, finishReason: r.finishReason, costUsd: r.costUsd, imputedUsd: Number(r.imputedUsd.toFixed(6)), latencyMs: r.latencyMs, usage: r.usage };
  t.diagnostic(JSON.stringify(line));
  return line;
};

test('live: one Haiku structured call through the claude CLI, then exact replay', { skip: claudeGate(), timeout: 300000 }, async t => {
  const journal = new Journal(new DatabaseSync(':memory:'));
  const port = new ModelPort({ policy, journal, providers: { 'claude-cli': new ClaudeCliProvider({ policy, maxBudgetUsd: 0.25 }) } });
  const r = await port.call(request(HAIKU));
  report(t, 'hosted', r);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.value.label, 'positive');
  assert.equal(r.modelId, HAIKU);
  assert.ok(r.costUsd > 0 && r.costUsd < 0.05, `cost ${r.costUsd}`);
  assert.match(r.engineVersion, /^claude-code \d/);
  const row = journal.get(r.journalId);
  assert.ok(row.response.meta.servedModels.includes(HAIKU), 'the CLI served the requested model');
  const again = await new ModelPort({ policy, journal, mode: 'replay', salt: row.request.salt, providers: {} }).call({ ...request(HAIKU), runId: 'replay' });
  assert.deepEqual(again.value, r.value); assert.equal(again.costUsd, 0);
});

test('live: one local qwen3.5-2b-q4km call through an on-demand llama-server', { skip: llamaGate(), timeout: 300000 }, async t => {
  const supervisor = new LlamaSupervisor({ policy });
  t.after(() => supervisor.stopAll());
  const entry = policy.models.find(m => m.id === QWEN);
  const preexisting = await supervisor.health(entry);
  const journal = new Journal(new DatabaseSync(':memory:'));
  const port = new ModelPort({ policy, journal, providers: { 'llama-server': new LlamaServerProvider({ policy, supervisor }) } });
  const r = await port.call(request(QWEN));
  const line = report(t, 'local', r);
  t.diagnostic(JSON.stringify({ serverPreexisting: preexisting, server: journal.get(r.journalId).response.meta?.server, timings: journal.get(r.journalId).response.meta?.timings }));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(line.value.label, 'positive');
  assert.equal(r.costUsd, 0); assert.ok(r.imputedUsd > 0);
  assert.match(r.engineVersion, /^llama-server /);
  const warm = await port.call({ ...request(QWEN), nodeKey: 'sentiment-warm' });
  report(t, 'local-warm', warm);
  assert.equal(warm.ok, true, JSON.stringify(warm.error));
});
