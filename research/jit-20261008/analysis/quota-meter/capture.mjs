#!/usr/bin/env node
// One-off live capture for B10-E2: a handful of tiny calls across Haiku, Sonnet and Opus with the repo's flags, saving each raw
// event stream and a ledger row. Hard cap: list-price total_cost_usd summed over calls must stay under CAP_USD (default 1.00);
// the next call is skipped when the running total plus its per-call --max-budget-usd could pass the cap.
//   node capture.mjs [--cap 1.00] [--out raw] [--only label,label]
import path from 'node:path';
import { HERE, runCall, saveRaw, appendJsonl, secretScan } from './lib.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const CAP = Number(arg('cap', '1.00'));
const OUT = path.resolve(HERE, arg('out', 'raw'));
const ONLY = arg('only', '')?.split(',').filter(Boolean);
const LEDGER = path.join(OUT, 'ledger.jsonl');

const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5', OPUS = 'claude-opus-5-5';
const TINY = 'Reply with the single word: ok';
const LONGISH = 'List the numbers 1 to 60 separated by commas, then write one sentence about each of the first five. Be brief.';
const NO_FLAGS = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: null, FORCE_PROMPT_CACHING_5M: null };

// label, model, prompt, extra options, per-call budget cap
const PLAN = [
  ['haiku-1-tiny',         HAIKU,  TINY, {}, 0.05],
  ['haiku-2-tiny-repeat',  HAIKU,  TINY, {}, 0.05],                       // same prompt again: does the cache read show, does the meter move
  ['haiku-3-longer',       HAIKU,  LONGISH, {}, 0.05],
  ['haiku-4-json-format',  HAIKU,  TINY, { format: 'json' }, 0.05],       // the repo's exact --output-format json: is the meter in it?
  ['haiku-5-no-childenv',  HAIKU,  TINY, { childEnv: NO_FLAGS }, 0.05],   // without DISABLE_NONESSENTIAL_TRAFFIC / FORCE_PROMPT_CACHING_5M
  ['sonnet-1-tiny',        SONNET, TINY, {}, 0.10],
  ['opus-1-tiny',          OPUS,   TINY, {}, 0.20],
  ['haiku-6-tiny-after',   HAIKU,  TINY, {}, 0.05],                       // a closing Haiku reading, after Sonnet and Opus
];

let spent = 0;
const rows = [];
for (const [label, model, prompt, opts, budget] of PLAN) {
  if (ONLY.length && !ONLY.includes(label)) continue;
  if (spent + budget > CAP) { console.log(`SKIP ${label}: running ${spent.toFixed(4)} + cap ${budget} would pass ${CAP}`); continue; }
  const r = await runCall({ model, prompt, maxBudgetUsd: budget, ...opts });
  const file = saveRaw(OUT, label, r.rawText);
  const s = r.summary, hits = secretScan(r.lines);
  const cost = s.costUsd ?? 0;
  spent += cost;
  const row = { ts: new Date().toISOString(), label, model, format: opts.format ?? 'stream-json', childEnvOff: !!opts.childEnv, exitCode: r.exitCode, wallMs: r.wallMs,
    costUsd: s.costUsd, inputTokens: s.inputTokens, outputTokens: s.outputTokens, cacheReadTokens: s.cacheReadTokens, cacheWriteTokens: s.cacheWriteTokens,
    durationMs: s.durationMs, durationApiMs: s.durationApiMs, served: s.served, rateLimitEvents: s.rateLimitEvents, status: s.status, claim: s.claimType,
    fiveHour: s.fiveHour, sevenDay: s.sevenDay, secretHits: hits, runningSpentUsd: +spent.toFixed(6), file: path.relative(HERE, file) };
  appendJsonl(LEDGER, row);
  rows.push(row);
  console.log(JSON.stringify({ label, cost: s.costUsd, in: s.inputTokens, out: s.outputTokens, cr: s.cacheReadTokens, cw: s.cacheWriteTokens, rle: s.rateLimitEvents, h5: s.fiveHour?.utilization, d7: s.sevenDay?.utilization, hits: hits.length, exit: r.exitCode, spent: +spent.toFixed(5) }));
}
console.log(`TOTAL list-price spend ${spent.toFixed(5)} USD over ${rows.length} calls (cap ${CAP})`);
