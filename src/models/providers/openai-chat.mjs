// ModelPort provider for remote OpenAI-compatible chat endpoints (policy kind openai-chat-https; research/mercury-20261021/).
// It serves executorModels[] entries, and ModelPort reaches one only when a call names its id (policy.mjs portModelById):
// never by class resolution or escalation. One typed call is one chat.completions request: the system and user message, the
// output schema as a strict json_schema response_format, no tools. ModelPort validates the reply against the schema and
// journals it, so replay and crash recovery work as for every other provider.
//
// Token caps (a model listed at $0 has no other spend bound): before sending, a call projects its tokens (input at
// CHARS_PER_TOKEN characters per token, plus its output allowance: decoding.maxTokens, else the policy max_tokens default,
// else min(8000, the model's maxOutputTokens)). It is refused with MODEL_BUDGET, without a request, when that passes the
// per-call cap (callTokens) or when the run's tokens used + reserved by calls in flight + it would pass the per-run cap
// (runTokenCap, required: one provider instance is one run). It settles at the usage the endpoint reports (its projection
// when none is reported, or when it was cut off in flight). provider.tokens holds the meter.
//
// Errors are the ModelPort codes, mapped like the executor's (src/models/openai-chat-client.mjs: bounded retries, the
// process-wide 429 cooldown, the key redacted from every message): MODEL_RATE_LIMIT, MODEL_UNAVAILABLE (5xx, transport, 401/403,
// no credential), MODEL_PROTOCOL (a refused request, an unparseable body, no message, a served model other than the one
// named), MODEL_BUDGET (a token cap). No silent substitution.
import { FoundryError } from '../../data.mjs';
import { REMOTE_CHAT_KIND } from '../policy.mjs';
import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_RETRY, LIMITED, chatCompletion, chatEndpoint, redact } from '../openai-chat-client.mjs';

export const DEFAULT_CALL_TOKENS = 100_000;
export const CHARS_PER_TOKEN = 3;
export const DEFAULT_OUTPUT_ALLOWANCE = 8000;
const REASONING_EFFORT = Object.freeze({ none: null, low: 'low', medium: 'medium', high: 'high' });
const fail = (code, message, extra = {}) => Object.assign(new FoundryError(code, message), extra);
const sameModel = (served, id) => served === id || new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{8}$`).test(served);

/** The decoding this provider applies, defaults named, not resolved: the provider config (its requestDefaults included) is
 * already in the replay key through modelDigestOf, so the same decoding hashes the same with or without a live provider. */
export const openaiChatDecoding = (d = {}) => ({ maxTokens: d.maxTokens ?? 'provider-default', reasoning: d.reasoning ?? 'none', temperature: d.temperature ?? 'provider-default' });

export class OpenAIChatProvider {
  constructor({ policy, providerName, hostEnv = process.env, baseUrl = null, retry = DEFAULT_RETRY, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    callTokens = DEFAULT_CALL_TOKENS, runTokenCap, concurrency = 2 } = {}) {
    const config = policy?.providers?.[providerName];
    if (!config || config.kind !== REMOTE_CHAT_KIND) throw new FoundryError('MODEL_POLICY_INVALID', `Policy has no ${REMOTE_CHAT_KIND} provider named ${providerName}`);
    if (!(Number.isInteger(runTokenCap) && runTokenCap > 0)) throw new FoundryError('MODEL_REQUEST', `provider ${providerName}: runTokenCap (a positive integer) is required; a $0 model has no other spend bound`);
    if (!(Number.isInteger(callTokens) && callTokens > 0)) throw new FoundryError('MODEL_REQUEST', `provider ${providerName}: callTokens must be a positive integer`);
    Object.assign(this, { policy, providerName, config, hostEnv, retry, requestTimeoutMs, callTokens, concurrency, override: baseUrl !== null,
      endpoint: chatEndpoint(config, baseUrl), tokens: { cap: runTokenCap, callCap: callTokens, spent: 0, reserved: 0, calls: 0, refused: 0, unknown: 0 } });
  }

  effectiveDecoding(decoding) { return openaiChatDecoding(decoding); }

  body({ modelEntry, system, prompt, schema, decoding = {} }) {
    const d = openaiChatDecoding(decoding), defaults = this.config.requestDefaults ?? {};
    const effort = REASONING_EFFORT[d.reasoning];
    if (effort === undefined) throw fail('MODEL_REQUEST', `reasoning ${d.reasoning} has no reasoning_effort on this endpoint`);
    return {
      model: modelEntry.id,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: { name: 'output', schema, strict: true } },
      ...defaults,
      ...(d.temperature !== 'provider-default' ? { temperature: d.temperature } : {}),
      ...(d.maxTokens !== 'provider-default' ? { max_tokens: d.maxTokens } : {}),
      ...(effort ? { reasoning_effort: effort } : {}),
    };
  }

  async complete({ modelEntry, system, prompt, schema, decoding = {}, signal, timeoutMs = this.requestTimeoutMs }) {
    if (!modelEntry || modelEntry.provider !== this.providerName || !(this.policy.executorModels ?? []).some(m => m.id === modelEntry.id))
      throw new FoundryError('MODEL_NOT_IN_POLICY', `Model ${modelEntry?.id} is not a ${this.providerName} executor model in the policy`);
    const body = this.body({ modelEntry, system, prompt, schema, decoding });
    const request = { endpoint: this.override ? 'loopback override (test)' : this.endpoint, model: body.model, response_format: 'json_schema(strict)', credentialEnv: this.config.credentialEnv,
      temperature: body.temperature ?? 'provider-default', max_tokens: body.max_tokens ?? 'provider-default', reasoning_effort: body.reasoning_effort ?? null };
    const t = this.tokens, price = modelEntry.price;
    const input = Math.ceil((String(system).length + String(prompt).length + JSON.stringify(schema ?? null).length + 64) / CHARS_PER_TOKEN);
    const want = input + (Number.isInteger(body.max_tokens) ? body.max_tokens : Math.min(DEFAULT_OUTPUT_ALLOWANCE, modelEntry.maxOutputTokens ?? DEFAULT_OUTPUT_ALLOWANCE));
    if (want > t.callCap) { t.refused += 1; throw fail('MODEL_BUDGET', `token cap: this call projects about ${want} tokens (input ~${input} + its output allowance), over the per-call cap of ${t.callCap}`, { request, costUsd: 0 }); }
    if (t.spent + t.reserved + want > t.cap) { t.refused += 1; throw fail('MODEL_BUDGET', `token cap: ${t.spent} used + ${t.reserved} reserved + ${want} would pass the run cap of ${t.cap}`, { request, costUsd: 0 }); }
    const usd = n => (n * Math.max(price.inputPerMTok, price.outputPerMTok)) / 1e6;
    t.reserved += want;
    let data, sent = false;
    try {
      ({ data } = await chatCompletion({ endpoint: this.endpoint, body, hostEnv: this.hostEnv, credentialEnv: this.config.credentialEnv, retry: this.retry,
        requestTimeoutMs: Math.min(this.requestTimeoutMs, timeoutMs), signal, deadline: Date.now() + timeoutMs, onRequest: () => { sent = true; } }));
    } catch (e) {
      t.reserved -= want;
      // Cut off in flight (cancelled, the port's deadline): it may have been billed. Book its projection; its spend is unknown.
      if (signal?.aborted) { if (sent) { t.spent += want; t.unknown += 1; } throw fail('CANCELLED', 'chat request aborted', { request, ...(sent ? { costUnknown: true, costCapUsd: usd(want) } : {}) }); }
      const code = e.code === 'EXECUTOR_ERROR' || e.code === 'EXECUTOR_PROTOCOL' ? 'MODEL_PROTOCOL' : e.code ?? 'MODEL_PROTOCOL';
      throw fail(code, String(e.message ?? e).slice(0, 2000), { request });
    }
    t.reserved -= want; t.calls += 1;
    const u = data?.usage;
    const prompted = Number(u?.prompt_tokens ?? 0) || 0, completed = Number(u?.completion_tokens ?? 0) || 0, cached = Number(u?.prompt_tokens_details?.cached_tokens ?? 0) || 0;
    if (u) t.spent += prompted + completed; else { t.spent += want; t.unknown += 1; }
    // ModelPort's usage convention (the claude CLI's): inputTokens are the uncached prompt tokens, cacheReadTokens the cached ones.
    const usage = { inputTokens: Math.max(0, prompted - cached), outputTokens: completed, cacheReadTokens: cached, cacheWriteTokens: 0 };
    const costUsd = u ? ((prompted - cached) * price.inputPerMTok + cached * (price.cacheReadPerMTok ?? price.inputPerMTok) + completed * price.outputPerMTok) / 1e6 : undefined;
    const meta = { servedModel: typeof data?.model === 'string' ? data.model : null, providerId: data?.id ?? null, reasoningTokens: Number(u?.completion_tokens_details?.reasoning_tokens ?? 0) || 0,
      totalTokens: u ? prompted + completed : null, tokensProjected: want };
    const extra = { request, usage, ...(costUsd === undefined ? { costUnknown: true, costCapUsd: usd(want) } : { costUsd }), meta };
    if (typeof data?.model === 'string' && data.model && !sameModel(data.model, modelEntry.id)) throw fail('MODEL_PROTOCOL', `the endpoint served ${data.model} instead of ${modelEntry.id}`, extra);
    const choice = data?.choices?.[0], msg = choice?.message;
    if (!msg || typeof msg !== 'object') {
      const said = redact(JSON.stringify(data?.error ?? data ?? null).slice(0, 300), this.hostEnv[this.config.credentialEnv]);
      throw fail(LIMITED.test(said) ? 'MODEL_RATE_LIMIT' : 'MODEL_PROTOCOL', `the endpoint returned no message: ${said}`, extra);
    }
    const finishReason = typeof msg.refusal === 'string' && msg.refusal ? 'refusal' : choice.finish_reason === 'length' ? 'length' : choice.finish_reason ?? null;
    const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map(c => c?.text ?? '').join('') : null;
    return { text, usage, ...(costUsd === undefined ? {} : { costUsd }), finishReason, engineVersion: typeof data?.system_fingerprint === 'string' ? data.system_fingerprint : null, request, meta };
  }
}
