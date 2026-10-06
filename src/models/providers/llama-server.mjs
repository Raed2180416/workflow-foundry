// Local open-weight models through llama.cpp's OpenAI-compatible server (DESIGN §2).
// Strict json_schema decoding; thinking only when decoding.reasoning asks for it.
import path from 'node:path';
import { FoundryError } from '../../data.mjs';
import { isPolicyModel } from '../policy.mjs';
import { LlamaSupervisor } from '../llama-supervisor.mjs';

const fail = (code, message, extra = {}) => Object.assign(new FoundryError(code, message), extra);

export class LlamaServerProvider {
  constructor({ policy, providerName = 'llama-server', supervisor, autoStart = true, defaultMaxTokens = 1024, maxResponseBytes = 4 * 1024 * 1024 } = {}) {
    const config = policy?.providers?.[providerName];
    if (!config || config.kind !== 'openai-compatible-http') throw new FoundryError('MODEL_POLICY_INVALID', `Policy has no openai-compatible-http provider named ${providerName}`);
    Object.assign(this, { policy, providerName, config, autoStart, defaultMaxTokens, maxResponseBytes,
      supervisor: supervisor ?? (autoStart ? new LlamaSupervisor({ policy }) : null) });
  }

  baseUrl(entry) { return this.config.baseUrlTemplate.replace('{port}', String(entry.port)); }

  body({ modelEntry, system, prompt, schema, decoding = {} }) {
    return {
      model: modelEntry.id,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature: decoding.temperature ?? 0,
      max_tokens: decoding.maxTokens ?? this.defaultMaxTokens,
      response_format: { type: 'json_schema', json_schema: { name: 'output', schema, strict: true } },
      chat_template_kwargs: { enable_thinking: (decoding.reasoning ?? 'none') !== 'none' },
      stream: false,
    };
  }

  async complete({ modelEntry, system, prompt, schema, decoding = {}, signal }) {
    if (!modelEntry || !isPolicyModel(this.policy, modelEntry.id) || modelEntry.provider !== this.providerName) throw new FoundryError('MODEL_NOT_IN_POLICY', `Model ${modelEntry?.id} is not a ${this.providerName} model in the policy`);
    let engineVersion = null, server = null;
    if (this.supervisor) {
      try { engineVersion = await this.supervisor.engineVersion(); } catch (error) { throw fail('MODEL_UNAVAILABLE', `llama-server version probe failed: ${error.message}`); }
      if (this.autoStart) {
        const started = Date.now();
        try { server = await this.supervisor.ensureServer(modelEntry); } catch (error) { error.engineVersion = engineVersion; throw error; }
        server = { started: !!server?.started, startupMs: server?.started ? Date.now() - started : 0 };
      }
    }
    const body = this.body({ modelEntry, system, prompt, schema, decoding });
    const request = { url: `${this.baseUrl(modelEntry)}/chat/completions`, temperature: body.temperature, max_tokens: body.max_tokens,
      enable_thinking: body.chat_template_kwargs.enable_thinking, response_format: 'json_schema(strict)' };
    const extra = { engineVersion, request };
    let response;
    try {
      response = await fetch(request.url, { method: 'POST', redirect: 'error', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) {
      if (signal?.aborted) throw fail('CANCELLED', 'llama-server request aborted', extra);
      throw fail('MODEL_UNAVAILABLE', `llama-server unreachable on port ${modelEntry.port}: ${error.cause?.code ?? error.message}`, extra);
    }
    const chunks = []; let bytes = 0;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > this.maxResponseBytes) throw fail('MODEL_PROTOCOL', 'llama-server response exceeds its byte budget', extra);
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      if (error.code === 'MODEL_PROTOCOL') throw error;
      if (signal?.aborted) throw fail('CANCELLED', 'llama-server request aborted', extra);
      throw fail('MODEL_UNAVAILABLE', `llama-server response interrupted: ${error.message}`, extra);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!response.ok) {
      const code = response.status === 429 ? 'MODEL_RATE_LIMIT' : response.status >= 500 ? 'MODEL_UNAVAILABLE' : 'MODEL_PROTOCOL';
      throw fail(code, `llama-server HTTP ${response.status}: ${text.slice(0, 300)}`, extra);
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw fail('MODEL_PROTOCOL', 'llama-server returned non-JSON', extra); }
    const choice = parsed?.choices?.[0];
    if (!choice || typeof choice.message !== 'object') throw fail('MODEL_PROTOCOL', 'llama-server response has no choice', extra);
    // No silent substitution: the server reports the weights it actually serves.
    if (typeof parsed.model === 'string' && parsed.model.includes('/') && path.basename(parsed.model) !== modelEntry.weights?.file)
      throw fail('MODEL_PROTOCOL', `llama-server served ${path.basename(parsed.model)}, not ${modelEntry.weights?.file}`, extra);
    const usage = { inputTokens: parsed.usage?.prompt_tokens ?? 0, outputTokens: parsed.usage?.completion_tokens ?? 0,
      cacheReadTokens: parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: 0 };
    const finishReason = choice.finish_reason === 'length' ? 'length' : choice.finish_reason ?? null;
    const meta = { systemFingerprint: parsed.system_fingerprint ?? null, servedModel: typeof parsed.model === 'string' ? path.basename(parsed.model) : null,
      timings: parsed.timings ?? null, server, reasoningChars: typeof choice.message.reasoning_content === 'string' ? choice.message.reasoning_content.length : 0, temperature: body.temperature };
    return { text: typeof choice.message.content === 'string' ? choice.message.content : null, usage, costUsd: 0, finishReason, engineVersion, request, meta };
  }
}
