// Deterministic test double for ModelPort (DESIGN §2). A script is a function
// (args, index) => response, an array (served in call order), or an object keyed by model id
// whose values are a function, an array or a single response. A response is
// { value?, text?, usage?, finishReason?, costUsd?, delayMs?, error?: code | {code, message} }.
import { FoundryError } from '../../data.mjs';

const RESPONSE_KEYS = new Set(['value', 'text', 'usage', 'finishReason', 'costUsd', 'delayMs', 'error', 'meta']);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new FoundryError('CANCELLED', 'aborted'));
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new FoundryError('CANCELLED', 'aborted')); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

export class ScriptedProvider {
  constructor(script, { engineVersion = 'scripted/1', concurrency, perModel } = {}) {
    if (typeof script !== 'function' && (!script || typeof script !== 'object')) throw new FoundryError('SCRIPTED_PROVIDER', 'A script function, list or table is required');
    Object.assign(this, { script, engineVersion, calls: [], active: 0, maxActive: 0, served: new Map() });
    if (concurrency !== undefined) this.concurrency = concurrency;
    if (perModel !== undefined) this.perModel = perModel;
  }

  #next(args, index) {
    const pick = (source, key) => {
      if (typeof source === 'function') return source(args, index);
      if (Array.isArray(source)) {
        const n = this.served.get(key) ?? 0; this.served.set(key, n + 1);
        if (n >= source.length) throw new FoundryError('SCRIPT_EXHAUSTED', `Scripted responses exhausted for ${key}`);
        return typeof source[n] === 'function' ? source[n](args, index) : source[n];
      }
      return source;
    };
    if (typeof this.script === 'function' || Array.isArray(this.script)) return pick(this.script, '*');
    if (!Object.hasOwn(this.script, args.modelEntry.id)) throw new FoundryError('SCRIPT_EXHAUSTED', `No scripted response for ${args.modelEntry.id}`);
    return pick(this.script[args.modelEntry.id], args.modelEntry.id);
  }

  async complete(args) {
    const index = this.calls.length;
    this.calls.push({ modelId: args.modelEntry.id, system: args.system, prompt: args.prompt, schema: args.schema, decoding: args.decoding });
    this.active++; this.maxActive = Math.max(this.maxActive, this.active);
    try {
      const response = await this.#next(args, index);
      if (!response || typeof response !== 'object' || Object.keys(response).some(k => !RESPONSE_KEYS.has(k)))
        throw new FoundryError('SCRIPTED_PROVIDER', 'Scripted responses must be {value|text|usage|finishReason|costUsd|delayMs|error|meta}');
      if (response.delayMs) await sleep(response.delayMs, args.signal);
      if (response.error) {
        const { code, message = code } = typeof response.error === 'string' ? { code: response.error } : response.error;
        const error = new FoundryError(code, message); error.usage = response.usage; error.engineVersion = this.engineVersion; throw error;
      }
      return { value: response.value, text: response.text ?? (response.value === undefined ? null : JSON.stringify(response.value)),
        usage: response.usage ?? { inputTokens: 0, outputTokens: 0 }, finishReason: response.finishReason ?? 'stop', costUsd: response.costUsd,
        engineVersion: this.engineVersion, meta: response.meta };
    } finally { this.active--; }
  }
}
