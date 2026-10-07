// ModelPort (DESIGN §2/§3): the single door to model providers. Policy-checked ids, a portable
// output schema, replay keys, per-provider concurrency, cost accounting, and a journal row
// committed before any result is returned.
import { FoundryError, checkData, digest } from '../data.mjs';
import { compileDataSchema } from '../validate.mjs';
import { portableSchemaViolations } from '../schema-subset.mjs';
import { isReplayable } from '../journal.mjs';
import { estimateTokens } from '../context.mjs';
import { modelById, providerConfig } from './policy.mjs';

export const MODEL_ERRORS = Object.freeze(['MODEL_SCHEMA', 'MODEL_TRUNCATED', 'MODEL_REFUSAL', 'MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'MODEL_PROTOCOL', 'MODEL_BUDGET']);
export const MODES = Object.freeze(['live', 'replay', 'replay-or-live']);
export const REASONING = Object.freeze(['none', 'low', 'medium', 'high']);
const DEFAULT_CONCURRENCY = { 'claude-cli': 6, 'llama-server': 1 };
const PER_MODEL_KINDS = new Set(['openai-compatible-http']);

// DESIGN §5.3 portable output-schema subset (one allowlist, shared with the validator). Anything
// else is rejected before a provider sees it: llama.cpp would silently drop it.
export function checkPortableSchema(schema) {
  const violations = portableSchemaViolations(schema);
  if (violations.length) throw new FoundryError('UNSUPPORTED_SCHEMA', `Output schema is outside the portable subset: ${violations.slice(0, 5)
    .map(v => `${v.path}${v.keyword ? ` ${v.keyword}` : ''}: ${v.problem}`).join('; ')}`, { violations });
  return schema;
}

export function normalizeDecoding(decoding = {}) {
  if (!decoding || typeof decoding !== 'object' || Array.isArray(decoding)) throw new FoundryError('MODEL_REQUEST', 'decoding must be an object');
  const unknown = Object.keys(decoding).filter(k => !['maxTokens', 'reasoning', 'temperature'].includes(k));
  if (unknown.length) throw new FoundryError('MODEL_REQUEST', `Unsupported decoding fields: ${unknown.join(', ')}`);
  const { maxTokens = null, reasoning = 'none', temperature = null } = decoding;
  if (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 65536)) throw new FoundryError('MODEL_REQUEST', 'decoding.maxTokens must be an integer 1..65536');
  if (!REASONING.includes(reasoning)) throw new FoundryError('MODEL_REQUEST', `decoding.reasoning must be one of ${REASONING.join('|')}`);
  if (temperature !== null && (typeof temperature !== 'number' || !(temperature >= 0 && temperature <= 2))) throw new FoundryError('MODEL_REQUEST', 'decoding.temperature must be 0..2');
  return { maxTokens, reasoning, temperature };
}

export const promptHashOf = ({ system, prompt, schema }) => digest({ system, prompt, schema });
// A replay key binds what decides a sample: the prompt, the policy entry behind the id and its provider config
// (weights, invocation, engine; accounting-only fields excluded), the decoding the provider applies, sample and salt.
export const modelDigestOf = (entry, config) => {
  // Excluded: accounting (price, imputed compute), routing (class, port, auth) and documentation (knownGaps) fields.
  const { price, class: _class, port: _port, ...model } = entry, { imputedComputeUsdPerHour, auth, knownGaps, ...provider } = config ?? {};
  return digest({ model, provider });
};
export const replayKeyOf = ({ promptHash, modelId, modelDigest, decoding, sampleIndex, salt }) => digest({ promptHash, modelId, modelDigest, decoding, sampleIndex, salt });

// Thinking budget per reasoning level (MAX_THINKING_TOKENS for the claude CLI). Measured 2026-10-07: --effort alone
// does not stop Haiku 4.5 from extended thinking on this route (5.2K output tokens per extraction call at --effort low);
// MAX_THINKING_TOKENS=0 does (102 vs 307 output tokens on a probe, same answer).
export const THINKING = Object.freeze({ none: 0, low: 1024, medium: 8000, high: 32000 });
const EFFORT = Object.freeze({ none: 'low', low: 'low', medium: 'medium', high: 'high' });
// The decoding each provider kind actually applies, its defaults resolved: the replay key hashes it, so the stock
// resolvers live here, in the engine identity. A registered provider answers for its own options (effectiveDecoding);
// these serve when none is (strict replay, a test double, the sandbox gateway). The claude CLI has no temperature or
// max-tokens control, so a requested value becomes the provider default.
export const DECODING_BY_KIND = Object.freeze({
  'claude-cli': (d = {}) => {
    const reasoning = d.reasoning ?? 'none';
    return { reasoning, effort: EFFORT[reasoning] ?? 'low', thinkingTokens: THINKING[reasoning] ?? 0, maxTokens: 'provider-default', temperature: 'provider-default' };
  },
  'openai-compatible-http': (d = {}, { defaultMaxTokens = 1024 } = {}) => ({ maxTokens: d.maxTokens ?? defaultMaxTokens, reasoning: d.reasoning ?? 'none', temperature: d.temperature ?? 0 }),
});

const RATE = /\b(429|529)\b|overloaded|rate.?limit/i;
export function classifyError(error) {
  if (error?.code === 'CANCELLED') return 'CANCELLED';
  if (MODEL_ERRORS.includes(error?.code)) return error.code;
  if (error?.name === 'TimeoutError' || error?.code === 'PROCESS_TIMEOUT') return 'MODEL_TIMEOUT';
  if (RATE.test(String(error?.message ?? ''))) return 'MODEL_RATE_LIMIT';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOENT', 'EHOSTUNREACH', 'PROCESS_LAUNCH'].includes(error?.code ?? error?.cause?.code)) return 'MODEL_UNAVAILABLE';
  return 'MODEL_PROTOCOL';
}

class Semaphore {
  constructor(limit) { this.limit = limit; this.active = 0; this.queue = []; }
  acquire(signal) {
    if (signal?.aborted) return Promise.reject(new FoundryError('CANCELLED', 'Model call cancelled while queued'));
    if (this.active < this.limit) { this.active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const waiter = { resolve: () => { signal?.removeEventListener('abort', onAbort); resolve(); } };
      const onAbort = () => { const i = this.queue.indexOf(waiter); if (i >= 0) this.queue.splice(i, 1); reject(new FoundryError('CANCELLED', 'Model call cancelled while queued')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiter);
    });
  }
  release() { const next = this.queue.shift(); if (next) next.resolve(); else this.active--; }
}

const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : 0;
const usageOf = u => ({ inputTokens: count(u?.inputTokens), outputTokens: count(u?.outputTokens), cacheReadTokens: count(u?.cacheReadTokens), cacheWriteTokens: count(u?.cacheWriteTokens) });
const listPrice = (price, u) => ((u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens) * (price?.inputPerMTok ?? 0) + u.outputTokens * (price?.outputPerMTok ?? 0)) / 1e6;
const plain = v => JSON.parse(JSON.stringify(v));
const ajvMessage = errors => (errors ?? []).slice(0, 5).map(e => `${e.instancePath || '(root)'} ${e.message}`).join('; ');
// error.feedback is the model-facing summary of a fault the port detected, built only from fixed text and the schema
// (schema paths and the validator's schema-derived messages). Instance paths and provider text can quote model output
// that untrusted input steers, so a provider-reported fault carries no feedback.
const own = (code, message, extra = {}) => ({ code, message, feedback: message, ...extra });
const schemaFeedback = errors => [...new Set((errors ?? []).map(e => `${e.schemaPath} ${e.message}`))].slice(0, 5).join('; ');
// A provider that ran but could not observe its spend reports costUnknown (and its per-call cap): the row records a
// bound (the cap; null when the provider has none) and an estimate (list price of the estimated input, within the cap).
function unknownSpend(entry, req, failure) {
  const cap = Number.isFinite(failure.costCapUsd) && failure.costCapUsd >= 0 ? failure.costCapUsd : null;
  const inputTokens = estimateTokens(req.system) + estimateTokens(req.prompt) + estimateTokens(JSON.stringify(req.schema));
  const estimate = listPrice(entry.price, { ...zeroUsage(), inputTokens });
  return { costUnknown: true, costUpperUsd: cap, costEstimateUsd: cap === null ? estimate : Math.min(cap, estimate) };
}

export class ModelPort {
  constructor({ policy, providers = {}, journal, mode = 'live', salt = null, concurrency = {}, timeoutMs = 300000, now = Date.now } = {}) {
    if (!policy?.models || !policy?.providers) throw new FoundryError('MODEL_PORT', 'ModelPort requires a loaded model policy');
    if (!journal || ['record', 'lookup', 'forAttempt'].some(f => typeof journal[f] !== 'function')) throw new FoundryError('MODEL_PORT', 'ModelPort requires a journal; unjournaled model calls are not allowed');
    if (!MODES.includes(mode)) throw new FoundryError('MODEL_PORT', `mode must be one of ${MODES.join('|')}`);
    for (const [name, p] of Object.entries(providers)) if (typeof p?.complete !== 'function') throw new FoundryError('MODEL_PORT', `Provider ${name} lacks complete()`);
    Object.assign(this, { policy, providers, journal, mode, salt, concurrency, timeoutMs, now });
    this.policyHash = digest(policy);
    this.semaphores = new Map();
  }

  #semaphore(entry) {
    const config = providerConfig(this.policy, entry), provider = this.providers[entry.provider];
    const perModel = provider.perModel ?? PER_MODEL_KINDS.has(config.kind);
    const key = perModel ? `${entry.provider}:${entry.id}` : entry.provider;
    if (!this.semaphores.has(key)) {
      const limit = this.concurrency[key] ?? this.concurrency[entry.provider] ?? provider.concurrency ?? DEFAULT_CONCURRENCY[entry.provider] ?? 1;
      if (!Number.isInteger(limit) || limit < 1 || limit > 64) throw new FoundryError('MODEL_PORT', `Concurrency for ${key} must be 1..64`);
      this.semaphores.set(key, new Semaphore(limit));
    }
    return this.semaphores.get(key);
  }

  #fromRow(row, flags) {
    const r = row.response ?? {};
    const replayed = !flags.recovered;
    return {
      ok: row.ok, value: row.ok ? r.value : undefined, text: r.text ?? null, usage: r.usage ?? zeroUsage(),
      costUsd: replayed ? 0 : row.costUsd, imputedUsd: replayed ? 0 : row.imputedUsd, latencyMs: flags.latencyMs ?? row.latencyMs,
      finishReason: r.finishReason ?? null, modelId: row.modelId, provider: row.provider, engineVersion: row.engineVersion,
      replayed: true, ...(row.ok ? {} : { error: r.error ?? { code: row.errorCode, message: row.errorCode } }),
      replayKey: row.replayKey, promptHash: row.promptHash, journalId: flags.journalId ?? row.id,
      ...(flags.recovered ? { recovered: true } : { replayedFrom: r.replayedFrom ?? row.id }),
    };
  }

  #request(req) {
    if (!req || typeof req !== 'object') throw new FoundryError('MODEL_REQUEST', 'A model request object is required');
    const { runId, nodeKey, attempt = 0, sampleIndex = 0, modelId, system, prompt, schema, receiptHash = null } = req;
    if (typeof runId !== 'string' || !runId || typeof nodeKey !== 'string' || !nodeKey) throw new FoundryError('MODEL_REQUEST', 'runId and nodeKey are required');
    if (!Number.isSafeInteger(attempt) || attempt < 0 || !Number.isSafeInteger(sampleIndex) || sampleIndex < 0) throw new FoundryError('MODEL_REQUEST', 'attempt and sampleIndex must be non-negative integers');
    if (typeof system !== 'string' || typeof prompt !== 'string' || Buffer.byteLength(system) + Buffer.byteLength(prompt) > 2 * 1024 * 1024) throw new FoundryError('MODEL_REQUEST', 'system and prompt must be strings within 2 MiB');
    if (receiptHash !== null && typeof receiptHash !== 'string') throw new FoundryError('MODEL_REQUEST', 'receiptHash must be a string');
    const mode = req.mode ?? this.mode;
    if (!MODES.includes(mode)) throw new FoundryError('MODEL_REQUEST', `mode must be one of ${MODES.join('|')}`);
    const salt = req.salt ?? this.salt ?? runId;
    if (typeof salt !== 'string') throw new FoundryError('MODEL_REQUEST', 'salt must be a string');
    const timeoutMs = req.timeoutMs ?? this.timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new FoundryError('MODEL_REQUEST', 'timeoutMs must be 1..3600000');
    return { runId, nodeKey, attempt, sampleIndex, modelId, system, prompt, schema, receiptHash, mode, salt, timeoutMs, decoding: normalizeDecoding(req.decoding ?? {}), signal: req.signal };
  }

  #decoding(entry, config, requested) {
    const provider = this.providers[entry.provider];
    const resolve = typeof provider?.effectiveDecoding === 'function' ? d => provider.effectiveDecoding(d, { modelEntry: entry, providerConfig: config }) : DECODING_BY_KIND[config.kind];
    return resolve ? checkData(plain(resolve({ ...requested }))) : requested;
  }

  async call(input) {
    const req = this.#request(input);
    // Preconditions: none of these reach a provider or the journal.
    const entry = modelById(this.policy, req.modelId), config = providerConfig(this.policy, entry);
    checkPortableSchema(req.schema);
    const validate = compileDataSchema(req.schema);
    const promptHash = promptHashOf(req), decoding = this.#decoding(entry, config, req.decoding);
    const replayKey = replayKeyOf({ promptHash, modelId: entry.id, modelDigest: modelDigestOf(entry, config), decoding, sampleIndex: req.sampleIndex, salt: req.salt });
    const base = { replayKey, runId: req.runId, nodeKey: req.nodeKey, attempt: req.attempt, sampleIndex: req.sampleIndex, modelId: entry.id,
      decoding, receiptHash: req.receiptHash, promptHash };
    const started = this.now();

    if (req.mode !== 'replay') {
      // Crash recovery (R2): this exact call already completed in this attempt; never pay for it twice.
      const prior = this.journal.forAttempt(req.runId, req.nodeKey, req.attempt).findLast(r => r.replayKey === replayKey && isReplayable(r));
      if (prior) return this.#fromRow(prior, { recovered: true });
    }
    if (req.mode !== 'live') {
      const hit = this.journal.lookup(replayKey);
      if (hit) {
        const latencyMs = Math.max(0, this.now() - started);
        const journalId = this.journal.record({ ...base, provider: hit.provider, engineVersion: hit.engineVersion,
          request: { mode: req.mode, salt: req.salt, replayOf: hit.id }, response: { ...hit.response, replayedFrom: hit.response?.replayedFrom ?? hit.id },
          ok: hit.ok, errorCode: hit.errorCode, inputTokens: hit.inputTokens, outputTokens: hit.outputTokens, costUsd: 0, imputedUsd: 0, latencyMs });
        return this.#fromRow(hit, { latencyMs, journalId });
      }
      if (req.mode === 'replay') throw new FoundryError('REPLAY_MISS', `No journaled response for ${req.nodeKey} (sample ${req.sampleIndex}) on ${entry.id}`, { replayKey, modelId: entry.id, nodeKey: req.nodeKey, sampleIndex: req.sampleIndex });
    }

    const provider = this.providers[entry.provider];
    if (!provider) throw new FoundryError('MODEL_PROVIDER_MISSING', `No provider is registered for ${entry.provider} (model ${entry.id})`);
    const semaphore = this.#semaphore(entry);
    await semaphore.acquire(req.signal);
    let raw, failure, latencyMs, timedOut = false;
    const callStart = this.now();
    try {
      const deadline = AbortSignal.timeout(req.timeoutMs);
      const signal = req.signal ? AbortSignal.any([req.signal, deadline]) : deadline;
      try { raw = await provider.complete({ modelEntry: entry, providerConfig: config, system: req.system, prompt: req.prompt, schema: req.schema, decoding: req.decoding, signal, timeoutMs: req.timeoutMs }); }
      catch (error) { failure = error; timedOut = deadline.aborted && !req.signal?.aborted; }
    } finally { latencyMs = Math.max(0, this.now() - callStart); semaphore.release(); }

    const usage = usageOf(raw?.usage ?? failure?.usage);
    const reportedCost = raw?.costUsd ?? failure?.costUsd;
    const known = typeof reportedCost === 'number' && Number.isFinite(reportedCost) && reportedCost >= 0;
    const costUsd = known ? reportedCost : listPrice(entry.price, usage);
    // run.cost and costUsd stay known spend; an unobservable spend is never recorded as a silent exact $0.
    const spend = !raw && !known && failure?.costUnknown === true ? unknownSpend(entry, req, failure) : {};
    const imputedUsd = (config.imputedComputeUsdPerHour ?? 0) * latencyMs / 3600000;
    const engineVersion = raw?.engineVersion ?? failure?.engineVersion ?? null;
    let ok = false, value, error = null;
    const finishReason = raw?.finishReason ?? null;
    if (failure) {
      const code = req.signal?.aborted ? 'CANCELLED' : timedOut ? 'MODEL_TIMEOUT' : classifyError(failure);
      error = { code, message: String(failure.message ?? failure).slice(0, 3000) };
    } else if (finishReason === 'length') error = own('MODEL_TRUNCATED', 'Generation stopped at the token limit (finish_reason=length)');
    else if (finishReason === 'refusal') error = own('MODEL_REFUSAL', 'The model refused the request');
    else {
      value = raw?.value;
      if (value === undefined) {
        try { value = JSON.parse(raw?.text ?? ''); } catch { error = own('MODEL_SCHEMA', 'Model output is not a JSON value'); }
      }
      if (!error) {
        try { checkData(value); } catch (e) { error = own('MODEL_SCHEMA', `Model output is not plain JSON data: ${e.message}`); value = undefined; }
      }
      if (!error && validate(value) !== true) error = own('MODEL_SCHEMA', `Model output does not satisfy its schema: ${ajvMessage(validate.errors)}`,
        { details: (validate.errors ?? []).slice(0, 10), feedback: `Model output does not satisfy its schema: ${schemaFeedback(validate.errors)}` });
      ok = !error;
    }
    const response = { value: ok ? value : undefined, rejectedValue: !ok && value !== undefined ? value : undefined, text: raw?.text ?? failure?.text ?? null,
      usage, finishReason, error: error ?? undefined, meta: raw?.meta ?? failure?.meta ?? undefined, ...spend };
    const journalId = this.journal.record({ ...base, provider: entry.provider, engineVersion,
      request: plain({ system: req.system, prompt: req.prompt, schema: req.schema, mode: req.mode, salt: req.salt, providerRequest: raw?.request ?? failure?.request }),
      response: plain(response), ok, errorCode: error?.code, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd, imputedUsd, latencyMs });
    // The journaled spend of a cancelled call travels with the cancellation, so the caller can still charge it.
    if (error?.code === 'CANCELLED') throw new FoundryError('CANCELLED', 'Model call cancelled', { journalId, replayKey, modelId: entry.id, costUsd, imputedUsd, latencyMs, usage, ...spend });
    return { ok, value: ok ? value : undefined, text: response.text, usage, costUsd, imputedUsd, latencyMs, finishReason, modelId: entry.id,
      provider: entry.provider, engineVersion, replayed: false, ...(error ? { error } : {}), ...spend, replayKey, promptHash, journalId };
  }

  /** Journaled outcomes of one node attempt, for crash recovery and audit (DESIGN §3). */
  recover({ runId, nodeKey, attempt }) {
    return this.journal.forAttempt(runId, nodeKey, attempt).map(row => this.#fromRow(row, { recovered: true }));
  }
}
