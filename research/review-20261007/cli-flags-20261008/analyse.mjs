// Offline analysis of results.json: reconstructs each call's cost from its usage (Haiku 5.5 list price from policy/models.json; cache reads
// 0.1x input; cache writes 2x input at the CLI default 1-hour TTL, 1.25x with FORCE_PROMPT_CACHING_5M) and splits the per-call saving
// between the cache-write price tier and the shorter prompt the CLI builds when CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1.
//   node research/review-20261007/cli-flags-20261008/analyse.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy } from '../../../src/models/policy.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url)), results = JSON.parse(readFileSync(path.join(dir, 'results.json'), 'utf8'));
const price = loadPolicy().policy.models.find(m => m.id === results.model).price;
const usd = (u, writeMultiplier) => ((u.input + 0.1 * u.cacheRead + writeMultiplier * u.cacheWrite) * price.inputPerMTok + u.output * price.outputPerMTok) / 1e6;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
let maxErr = 0;
for (const r of results.rows) maxErr = Math.max(maxErr, Math.abs(usd(r, r.arm === 'off' ? 2 : 1.25) - r.costUsd));
const out = { reconstructionMaxAbsErrorUsd: +maxErr.toExponential(2), shapes: {} };
for (const shape of ['shared', 'unique']) {
  const off = results.rows.filter(r => r.shape === shape && r.arm === 'off'), on = results.rows.filter(r => r.shape === shape && r.arm === 'on');
  const offCost = mean(off.map(r => r.costUsd)), onCost = mean(on.map(r => r.costUsd));
  const offAt5m = mean(off.map(r => usd(r, 1.25))); // the OFF calls re-priced at the 5-minute write rate: the price-tier effect alone
  out.shapes[shape] = { offMeanUsd: +offCost.toFixed(7), onMeanUsd: +onCost.toFixed(7), savingUsd: +(offCost - onCost).toFixed(7), savingPct: +(100 * (offCost - onCost) / offCost).toFixed(1),
    priceTierShareOfSavingPct: +(100 * (offCost - offAt5m) / (offCost - onCost)).toFixed(0), shorterPromptShareOfSavingPct: +(100 * (offAt5m - onCost) / (offCost - onCost)).toFixed(0),
    cacheWriteTokensOffMean: +mean(off.map(r => r.cacheWrite)).toFixed(0), cacheWriteTokensOnMean: +mean(on.map(r => r.cacheWrite)).toFixed(0) };
}
writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
