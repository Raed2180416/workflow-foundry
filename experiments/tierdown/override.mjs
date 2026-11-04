// Tier-down replay override (A10 / #42). Copied into a compiled run's sandbox as tools/flow-override.mjs by
// runCompiled({ flowOverride }); flow-v2.mjs and flow-v3.mjs consult its default export before every judge model call
// (flow-v3.mjs header: override(callSite, request) -> undefined | {value} | {error}). It reads its instructions from
// tools/flow-override.json (runCompiled flowOverrideData) and uses node built-ins only (the sandbox has no network and
// no repo).
//
// Data (all optional):
//   { log: true,                       append one line per judge model call to ./override-log.jsonl (the run's workdir)
//     serve: [ {key, value} | {key, error} | {key, values: [v0, v1, ...]} ] }
// key = requestKeyOf(request): sha256 of canonical {system, prompt, schema}, the request WITHOUT the model and decoding,
// so one entry answers every tier and every sample of that request (a tier swap or a perturbation replaces the judge's
// decision, not one tier's attempt). `values` serves the k-th sample of the run the k-th value (the last one again past
// the end); `value` serves every sample. A request with no entry returns undefined: the call goes to the model port,
// which in this harness is a strict memo over the archived journal (a request the journal does not hold is a
// REPLAY_MISS, so nothing is ever spent).
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

// canonical JSON as flow-v2.mjs computes it (sorted keys, undefined dropped).
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}
export const requestKeyOf = ({ system = '', prompt = '', schema } = {}) =>
  createHash('sha256').update(canonical({ system: String(system), prompt: String(prompt), schema: schema ?? null })).digest('hex');

const DATA_FILE = new URL('./flow-override.json', import.meta.url);
const data = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf8')) : {};
const serve = new Map((Array.isArray(data.serve) ? data.serve : []).map(e => [e.key, e]));
const served = new Map();   // key -> samples served so far

export default function override(callSite, request) {
  const key = requestKeyOf(request), entry = serve.get(key);
  let response;
  if (entry) {
    if ('error' in entry) response = { error: String(entry.error) };
    else if (Array.isArray(entry.values) && entry.values.length) {
      const k = served.get(key) ?? 0; served.set(key, k + 1);
      response = { value: entry.values[Math.min(k, entry.values.length - 1)] };
    } else response = { value: entry.value };
  }
  if (data.log) {
    const line = { id: callSite.id, name: callSite.name, ordinal: callSite.ordinal, digest: callSite.digest, tier: callSite.tier, tierIndex: callSite.tierIndex,
      sample: callSite.sample, key, reasoning: request.decoding?.reasoning ?? null, served: response !== undefined,
      sys: createHash('sha256').update(String(request.system ?? '')).digest('hex').slice(0, 16),
      sch: createHash('sha256').update(canonical(request.schema ?? null)).digest('hex').slice(0, 16) };
    try { appendFileSync('override-log.jsonl', JSON.stringify(line) + '\n'); } catch { /* a read-only cwd only loses the log */ }
  }
  return response;
}
