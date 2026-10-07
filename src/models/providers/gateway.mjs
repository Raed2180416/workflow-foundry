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
  async complete({ modelEntry, system, prompt, schema, decoding = {}, signal, nodeKey = null }) {
    let res, body;
    // A call aborted after the request may have reached the host: the host may still be paying for it, so its spend
    // is unknown here (the host ledger charges what it observes), never a silent $0.
    const aborted = message => fail('CANCELLED', `gateway call cancelled: ${message}`, { costUnknown: true, costCapUsd: null });
    try {
      res = await this.fetchImpl(`${this.url}/model`, { method: 'POST', signal, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelEntry.id, system, prompt, schema, decoding, ...(nodeKey ? { node: String(nodeKey).slice(0, 200) } : {}) }) });
    } catch (error) { throw signal?.aborted ? aborted(error.message) : fail('MODEL_UNAVAILABLE', `gateway unreachable: ${error.message}`); }
    try { body = await res.json(); } catch (error) { if (signal?.aborted) throw aborted(error.message); body = {}; }
    if (res.status === 402) throw fail('MODEL_BUDGET', `gateway budget exhausted (spent ${body.spentUsd} of ${body.capUsd})`);
    if (res.status === 401 || res.status === 403 || res.status === 503) throw fail('MODEL_UNAVAILABLE', `gateway refused: ${body.error ?? res.status}`);
    if (res.status !== 200) throw fail(body?.error?.code ?? 'MODEL_PROTOCOL', `gateway error ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
    // A host call whose spend the host could not observe stays unknown here too (never a silent $0).
    if (!body.ok) throw fail(body.error?.code ?? 'MODEL_PROTOCOL', body.error?.message ?? 'gateway call failed',
      body.costUnknown === true ? { costUnknown: true, costCapUsd: body.costUpperUsd ?? null } : { costUsd: body.costUsd ?? 0 });
    return { value: body.value, text: null, usage: null, costUsd: body.costUsd ?? 0, finishReason: 'stop', engineVersion: `gateway:${body.modelId}` };
  }
}
