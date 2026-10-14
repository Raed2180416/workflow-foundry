// The $0 judge stub for validating the W-bed reference workflows (README.md "Stub gateway"). It answers every judge
// request from the request text and schema alone, never from a bed's generator, oracle or truth, by one of two fixed,
// documented policies:
//   A ("first"): an enum takes its FIRST value; a boolean is true; an array gets one element per line of the prompt's
//                first fenced block (<<< ... >>>), each filled the same way; a string property whose name contains
//                "quote" is the FIRST sentence (at least 8 characters) of that block; any other string is "".
//   B ("last"):  the same with the LAST enum value, false, and the LAST such sentence.
// So A and B give opposite answers to every binary judge the references ask (VOID/KEEP, COUNTS/DOES_NOT_COUNT, DMY/MDY,
// <reason>/UNEXPLAINED), and a quote that passes a "quote occurs in the notes" check. They never report a dated
// convention switch and never fill a free-text extraction field, so those judges fail their checks and the references'
// code fallbacks run. A task whose delivered answer differs between A and B depends on judge quality; one whose answer is
// identical under both does not depend on the judges these policies exercise. True pass rates need paid judges.
// Cost: list-price dollars from policy/models.json prices for the requested model, on a token estimate of
// ceil(chars / 4) for system + prompt + schema in and the answer out (plus 10 output tokens of framing).
export const POLICIES = Object.freeze(['A', 'B']);

const WS = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const sentencesOf = text => WS(text).split(/(?<=[.!?])\s+(?=[A-Z"“(　-鿿])/).filter(Boolean);
export function firstFence(prompt) {
  const m = /<<<\n([\s\S]*?)\n>>>/.exec(String(prompt ?? ''));
  return m ? m[1] : '';
}
function quoteOf(block, policy) {
  const all = block.split('\n').flatMap(l => sentencesOf(l)).filter(s => s.length >= 8);
  if (!all.length) return '';
  return policy === 'A' ? all[0] : all[all.length - 1];
}
function fill(schema, name, ctx) {
  if (!schema || typeof schema !== 'object') return null;
  if (Array.isArray(schema.enum) && schema.enum.length) return ctx.policy === 'A' ? schema.enum[0] : schema.enum[schema.enum.length - 1];
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') ?? 'null' : schema.type;
  if (type === 'object') {
    const out = {};
    for (const [k, s] of Object.entries(schema.properties ?? {})) out[k] = fill(s, k, ctx);
    return out;
  }
  if (type === 'array') {
    const lines = ctx.block.split('\n').filter(l => l.trim());
    return lines.map(() => fill(schema.items, name, ctx));
  }
  if (type === 'string') return /quote/i.test(name ?? '') ? quoteOf(ctx.block, ctx.policy) : '';
  if (type === 'boolean') return ctx.policy === 'A';
  if (type === 'integer' || type === 'number') return 0;
  return null;
}
export function stubAnswer(policy, { prompt, schema }) {
  if (!POLICIES.includes(policy)) throw new Error(`stub policy must be one of ${POLICIES.join(', ')}`);
  return fill(schema, null, { policy, block: firstFence(prompt) });
}
export const tokensOf = text => Math.ceil(String(text ?? '').length / 4);
export function stubCostUsd(price, { system, prompt, schema }, value) {
  const tin = tokensOf(system) + tokensOf(prompt) + tokensOf(JSON.stringify(schema ?? null));
  const tout = tokensOf(JSON.stringify(value ?? null)) + 10;
  return Math.round(((tin * price.inputPerMTok + tout * price.outputPerMTok) / 1e6) * 1e8) / 1e8;
}
// A ScriptedProvider script: (args) => {value, costUsd}. prices: {modelId: {inputPerMTok, outputPerMTok}} (policy file).
export function stubScript(policy, prices, log = null) {
  return args => {
    const req = { system: args.system, prompt: args.prompt, schema: args.schema };
    const value = stubAnswer(policy, req);
    const price = prices[args.modelEntry.id];
    if (!price) return { error: { code: 'MODEL_NOT_PRICED', message: args.modelEntry.id } };
    const costUsd = stubCostUsd(price, req, value);
    log?.push({ model: args.modelEntry.id, costUsd, promptChars: String(args.prompt ?? '').length });
    return { value, costUsd };
  };
}
