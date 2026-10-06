import { experimental_evaluate } from 'ai';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cases, providerRequest, boundRecommendation, score, sha } from './cases.mjs';

const mode = process.argv[2] ?? 'freeze';
const root = new URL('./', import.meta.url);
const sourceFiles = ['cases.mjs', 'run-diagnostic.mjs', 'package-lock.json'];
const manifest = { schemaVersion: 'jev-consequences-v1', frozenAt: new Date().toISOString(), model: 'typesafe-ai/jev',
  sdk: 'ai@7.0.105', cases: cases.length, plannedCalls: 36, maxRetries: 0,
  perCallTimeoutMs: 20000, totalInputTokenLimit: 60000, requiredConfirmedPricePerMillionInput: 0.042,
  labelOrigin: 'Researcher supplied, not model consensus; diagnostic not held out.',
  files: sourceFiles.map(path => ({ path, sha256: sha(readFileSync(new URL(path, root), 'utf8')) })),
  casesHash: sha(cases), missingEvidenceIsExplicit: true, noAuthorityGranted: true };
if (mode === 'freeze') {
  writeFileSync(new URL('DIAGNOSTIC_FREEZE.json', root), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  writeFileSync(new URL('CASES.private.json', root), JSON.stringify(cases, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(manifest, null, 2));
} else {
  const frozen = JSON.parse(readFileSync(new URL('DIAGNOSTIC_FREEZE.json', root), 'utf8'));
  if (frozen.casesHash !== manifest.casesHash || JSON.stringify(frozen.files) !== JSON.stringify(manifest.files)) throw new Error('FROZEN_SOURCE_CHANGED');
  if (!['oracle-wiring', 'live'].includes(mode)) throw new Error('Use freeze, oracle-wiring, or live');
  if (mode === 'live') {
    // A separately recorded catalog receipt is required before a larger campaign.
    // Historical handoff pricing alone never enables dispatch.
    const price = JSON.parse(readFileSync(new URL('LIVE_PRICE_AUTHORIZATION.json', root), 'utf8'));
    if (price.model !== frozen.model || price.inputPerMillion !== frozen.requiredConfirmedPricePerMillionInput || price.outputPerMillion !== 0 || !price.catalogReceiptSha256) throw new Error('UNVERIFIED_PRICING');
  }
  const out = new URL(`diagnostic-${mode}-${Date.now()}/`, root);
  mkdirSync(out, { recursive: false });
  const records = [];
  let inputTokens = 0;
  for (const variant of ['original', 'reversed-options']) {
    for (const item of cases) {
      if (inputTokens >= frozen.totalInputTokenLimit) throw new Error('TOKEN_BUDGET');
      const request = providerRequest(item, variant !== 'original');
      const start = Date.now();
      const record = { caseId: item.id, variant, requestHash: sha(request), mode };
      writeFileSync(new URL(`${item.id}-${variant}.request.json`, out), JSON.stringify(request, null, 2), { flag: 'wx' });
      try {
        let result;
        if (mode === 'oracle-wiring') {
          result = { answers: { decision: { type: 'choice', choice: item.expected,
            probabilities: Object.fromEntries(Object.keys(request.questions.decision.criteria).map(key => [key, Number(key === item.expected)])) } },
            usage: { inputTokens: 0, outputTokens: 0 }, providerMetadata: { supplied: { oracle: true } }, warnings: [], response: { modelId: 'researcher-supplied-oracle' } };
        } else {
          const raw = await experimental_evaluate({ model: frozen.model, ...request, maxRetries: 0, abortSignal: AbortSignal.timeout(frozen.perCallTimeoutMs) });
          result = { answers: raw.answers, usage: raw.usage, rounding: raw.rounding, warnings: raw.warnings,
            providerMetadata: raw.providerMetadata, response: { modelId: raw.response.modelId, timestamp: raw.response.timestamp } };
          if (!Number.isInteger(result.usage.inputTokens)) throw new Error('MISSING_USAGE');
          inputTokens += result.usage.inputTokens;
        }
        Object.assign(record, { status: 'received', elapsedMs: Date.now() - start, result });
        record.recommendation = boundRecommendation(item, request, record);
      } catch (error) {
        Object.assign(record, { status: 'failed', errorName: error.name, statusCode: error.statusCode ?? null });
      }
      records.push(record);
      writeFileSync(new URL(`${item.id}-${variant}.result.json`, out), JSON.stringify(record, null, 2), { flag: 'wx' });
      if (record.status === 'failed') break;
    }
    if (records.at(-1)?.status === 'failed') break;
  }
  const result = { mode, inputTokens, records, metrics: score(records),
    intelligenceClaim: mode === 'oracle-wiring' ? 'None: supplied-label plumbing control only; no Jev call.' : 'Bounded judgment on a supplied candidate set, not construction intelligence.' };
  writeFileSync(new URL('RESULTS.json', out), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ directory: fileURLToPath(out), mode, metrics: result.metrics, inputTokens }, null, 2));
}
