import { experimental_evaluate } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// No credential files, environment dumps, alternate provider, or retry fallback.
// The small synthetic request is the only evaluation dispatched by this script.
const root = new URL('./', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const receipt = { observedAt: new Date().toISOString(), model: 'typesafe-ai/jev',
  node: process.version, sdk: 'ai@7.0.105', gateway: '@ai-sdk/gateway@4.0.85',
  sourceSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  lockSha256: sha(readFileSync(new URL('package-lock.json', root))),
  keyPresent: Boolean(process.env.AI_GATEWAY_API_KEY),
  oidcPresent: Boolean(process.env.VERCEL_OIDC_TOKEN), maxRetries: 0 };
const safeError = error => ({ name: error?.name ?? 'Error',
  statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
  // SDK messages can contain provider bodies; only fixed classifications escape.
  category: /auth|api.key|oidc|credential|token/i.test(String(error?.message))
    ? 'authentication-unavailable' : /model|unsupported/i.test(String(error?.message))
      ? 'model-or-interface-unavailable' : 'provider-or-transport-error' });
try {
  const catalog = await gateway.getAvailableModels();
  const records = catalog.models ?? catalog.data ?? [];
  receipt.catalog = { status: 'received', records: records.filter(record => /jev/i.test(record.id ?? '')) };
} catch (error) { receipt.catalog = { status: 'failed', ...safeError(error) }; }
const request = {
  model: receipt.model,
  state: { objective: 'Create a draft only.', observation: 'A draft was created; nothing was sent.' },
  questions: { draftOnly: { type: 'choice', instructions: 'Which outcome is supported by the observation?',
    criteria: { draft: 'A draft was created and no send occurred.', sent: 'A message was sent.', unknown: 'The observation does not establish either outcome.' } } },
  maxRetries: 0,
};
receipt.promptSha256 = sha(JSON.stringify(request));
const start = Date.now();
try {
  const result = await experimental_evaluate({ ...request, abortSignal: AbortSignal.timeout(20000) });
  receipt.evaluation = { status: 'received', elapsedMs: Date.now() - start,
    answers: result.answers, usage: result.usage, rounding: result.rounding,
    providerMetadata: result.providerMetadata, warnings: result.warnings,
    responseModelId: result.response.modelId, responseTimestamp: result.response.timestamp };
} catch (error) {
  receipt.evaluation = { status: 'failed', elapsedMs: Date.now() - start, ...safeError(error) };
}
writeFileSync(new URL('ACCESS_RECEIPT.json', root), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(receipt, null, 2));
