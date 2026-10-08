// Mock chat model for the classification step: a recorded-response (VCR style) classifier with two price/quality tiers.
//   complete {system?, prompt, schema?, tier?='standard'} -> 200 {content:{...}, usage:{inputTokens,outputTokens}, costUsd, tier}
//                                                            422 NO_RECORDING / AMBIGUOUS_INPUT   500 / 503 injected failures (input tokens are still charged)
// The mock does not read the instructions: it finds the mail's reference token ("MR-xxxxx", part of every synthetic mail) in system+prompt and answers
// with the recorded classification of that mail for the chosen tier. A prompt that does not contain the mail therefore gets no answer, like a cassette miss.
// With `schema.properties` only those properties are returned (and charged). Tokens are estimated as utf8 bytes / 4.
// Live runs replace this mock by a real model through createEnv({ modelBackend }); the episode record then carries the observed answers (modelTape).
import { ok, fail } from './common.mjs';
import { estimateTokens } from '../../../../../beds/lib/canonical.mjs';
import { MODEL_TIERS, LATENCY_MS } from '../spec.mjs';

const REF_RE = /MR-[0-9A-F]{5}/g;
const words = s => s.split(/(?<=[.!?])\s+/).filter(Boolean);
const titleCase = s => s.split(/[-\s]+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
export const round8 = x => Math.round(x * 1e8) / 1e8;

export class Model {
  constructor({ recordings, infoByRef }) { this.opts = { recordings, infoByRef }; this.state = { attempts: {}, calls: 0 }; }

  complete({ system, prompt, schema, tier = 'standard' } = {}) {
    this.state.calls++;
    const t = MODEL_TIERS[tier];
    if (!t) return fail(400, 'BAD_TIER', `tier must be one of ${Object.keys(MODEL_TIERS).join(', ')}`);
    if (typeof prompt !== 'string' || !prompt.trim()) return fail(400, 'BAD_REQUEST', 'prompt is required');
    const text = `${typeof system === 'string' ? system : ''}\n${prompt}`;
    const inputTokens = estimateTokens(text);
    const charge = outputTokens => ({ inputTokens, outputTokens, costUsd: round8(inputTokens * t.inputPerMTok / 1e6 + outputTokens * t.outputPerMTok / 1e6) });
    const known = [...new Set(text.match(REF_RE) ?? [])].filter(r => this.opts.recordings[r]);
    if (known.length !== 1) {
      const res = fail(422, known.length ? 'AMBIGUOUS_INPUT' : 'NO_RECORDING', known.length ? 'the prompt contains more than one mail' : 'no recorded answer for this input');
      return { status: res.status, body: { ...res.body, usage: { inputTokens, outputTokens: 0 }, costUsd: charge(0).costUsd }, latencyMs: LATENCY_MS.modelBase };
    }
    const ref = known[0];
    const rec = this.opts.recordings[ref];
    const attempt = this.state.attempts[ref] = (this.state.attempts[ref] ?? 0) + 1;
    if (rec.fail === 'permanent' || (rec.fail === 'transient' && attempt === 1)) {
      const status = rec.fail === 'permanent' ? 500 : 503;
      const res = { status, body: { error: { type: status === 500 ? 'server_error' : 'overloaded', message: 'The model could not produce an answer.' }, usage: { inputTokens, outputTokens: 0 }, costUsd: charge(0).costUsd } };
      res.latencyMs = LATENCY_MS.modelBase;
      return res;
    }
    const info = this.opts.infoByRef[ref];
    const [isCustomerRequest, category, priority, confidence] = rec[tier] ?? rec.standard;
    const sentences = words(info.plain.replace(/\s+/g, ' '));
    const full = {
      isCustomerRequest, category, priority, confidence, productArea: rec.area, sentiment: rec.sentiment,
      title: info.subject.replace(/^((re|fwd?|aw)\s*:\s*)+/i, '').trim().slice(0, 100) || '(no subject)',
      summary: sentences.slice(0, 2).join(' ').slice(0, 400),
      customerName: info.fromName, customerCompany: info.company,
      stepsToReproduce: category === 'Bug' ? sentences.slice(0, 3).join(' ').slice(0, 300) : '',
      reasoning: `Recorded ${tier} answer.`,
    };
    const props = schema && typeof schema === 'object' && schema.properties ? Object.keys(schema.properties) : null;
    const content = props ? Object.fromEntries(props.filter(k => k in full).map(k => [k, full[k]])) : full;
    const outputTokens = estimateTokens(JSON.stringify(content));
    return { status: 200, body: { content, tier, usage: { inputTokens, outputTokens }, costUsd: charge(outputTokens).costUsd }, latencyMs: LATENCY_MS.modelBase + outputTokens * LATENCY_MS.modelPerOutputToken };
  }
}
export const companyOf = addr => titleCase(String(addr).split('@')[1].split('.')[0]);
