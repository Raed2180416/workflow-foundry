// Forwards every model call to a host-side gateway (experiments/lib/services.mjs /model): the host
// enforces the owner policy, the spend cap and its own journal. Used when a Foundry runtime runs
// inside a sandbox (an executor or a construction session) and must not hold model credentials.
// Enabled by FOUNDRY_MODEL_GATEWAY_URL and FOUNDRY_MODEL_GATEWAY_TOKEN.
import { FoundryError } from '../../data.mjs';

const fail = (code, message, extra = {}) => Object.assign(new FoundryError(code, message), extra);

export class GatewayProvider {
  constructor({ url = process.env.FOUNDRY_MODEL_GATEWAY_URL, token = process.env.FOUNDRY_MODEL_GATEWAY_TOKEN, fetchImpl = fetch } = {}) {
    if (!url || !token) throw new FoundryError('MODEL_PORT', 'Gateway provider needs FOUNDRY_MODEL_GATEWAY_URL and FOUNDRY_MODEL_GATEWAY_TOKEN');
    Object.assign(this, { url: url.replace(/\/$/, ''), token, fetchImpl, concurrency: 8 });
  }
  async complete({ modelEntry, system, prompt, schema, decoding = {}, signal }) {
    let res;
    try {
      res = await this.fetchImpl(`${this.url}/model`, { method: 'POST', signal, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelEntry.id, system, prompt, schema, decoding }) });
    } catch (error) { throw fail(signal?.aborted ? 'CANCELLED' : 'MODEL_UNAVAILABLE', `gateway unreachable: ${error.message}`); }
    const body = await res.json().catch(() => ({}));
    if (res.status === 402) throw fail('MODEL_BUDGET', `gateway budget exhausted (spent ${body.spentUsd} of ${body.capUsd})`);
    if (res.status === 401 || res.status === 403) throw fail('MODEL_UNAVAILABLE', `gateway refused: ${body.error ?? res.status}`);
    if (res.status !== 200) throw fail(body?.error?.code ?? 'MODEL_PROTOCOL', `gateway error ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
    if (!body.ok) throw fail(body.error?.code ?? 'MODEL_PROTOCOL', body.error?.message ?? 'gateway call failed', { costUsd: body.costUsd ?? 0 });
    return { value: body.value, text: null, usage: null, costUsd: body.costUsd ?? 0, finishReason: 'stop', engineVersion: `gateway:${body.modelId}` };
  }
}
