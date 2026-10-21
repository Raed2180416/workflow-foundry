import { createModelPort } from '../lib/models.mjs';
const out = process.argv[2];
const { port, tokens } = createModelPort({ journalFile: `${out}/journal.sqlite`, allowedModels: ['claude-haiku-5-5', 'mercury-3'], tokenCap: 5000, callTokens: 3000 });
const schema = { type: 'object', additionalProperties: false, required: ['city', 'population_band'], properties: { city: { type: 'string' }, population_band: { type: 'string', enum: ['small', 'medium', 'large'] } } };
const r = await port.call({ runId: 'm3-port-probe-20261021', nodeKey: 'probe', modelId: 'mercury-3', system: 'Answer in JSON matching the schema.', prompt: 'Name the capital of France and its population band.', schema, decoding: { maxTokens: 400 } });
const safe = { ok: r.ok, value: r.value, modelId: r.modelId, provider: r.provider, usage: r.usage, costUsd: r.costUsd, error: r.error ? { code: r.error.code, message: String(r.error.message).slice(0, 300) } : null, meterTokens: typeof tokens === 'function' ? tokens() : tokens };
console.log(JSON.stringify(safe, null, 1));
