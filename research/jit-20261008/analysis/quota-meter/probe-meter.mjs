#!/usr/bin/env node
// Meter poller (B10-E2): one tiny Haiku call every --interval-s seconds, each reading the subscription meter from the
// rate_limit_event in `--output-format stream-json --verbose`. Appends one row per poll to a JSONL log and prints a line;
// a row with changed=true marks a 0.01 tick. Haiku only. Hard caps on calls and on list-price dollars; it stops at whichever
// comes first, and a call that errors or has no rate_limit_event counts toward the call cap and is logged, not retried.
//
//   node probe-meter.mjs --interval-s 600 --iterations 18 --max-calls 20 --max-usd 0.50 --log meter-log.jsonl
//   node probe-meter.mjs --dry-run                      # print the plan and the worst-case spend, call nothing
//   node probe-meter.mjs --iterations 3 --interval-s 5  # smoke
// Optional load: --load-tokens N pads every poll's prompt with about N fresh (cache-write) tokens, so a drift in the
// meter can be set against a known token count; the default 0 is a pure reading and moves the meter by nothing visible.
// Nothing is read from disk but the policy file; auth is the CLI's own login.
import path from 'node:path';
import { HERE, runCall, saveRaw, appendJsonl, secretScan, pad } from './lib.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const MODEL = arg('model', 'claude-haiku-5-5');
const INTERVAL_S = Number(arg('interval-s', '600'));
const ITER = Number(arg('iterations', '3'));
const MAX_CALLS = Number(arg('max-calls', '20'));
const MAX_USD = Number(arg('max-usd', '0.50'));
const LOAD = Number(arg('load-tokens', '0'));
const LOG = path.resolve(HERE, arg('log', 'meter-log.jsonl'));
const RAW = path.resolve(HERE, arg('raw', 'raw/poll'));
const PER_CALL_USD = Number(arg('per-call-usd', LOAD ? '0.15' : '0.05'));
const TAG = arg('tag', 'poll');

if (!/haiku/.test(MODEL)) { console.error('probe-meter is Haiku only (hard rule): refusing', MODEL); process.exit(2); }
if (!(INTERVAL_S >= 0 && ITER >= 1 && MAX_CALLS >= 1 && MAX_USD > 0 && LOAD >= 0 && LOAD <= 90000)) { console.error('bad arguments (load-tokens <= 90000 keeps the prompt under the 100K price tier)'); process.exit(2); }
const calls = Math.min(ITER, MAX_CALLS);
console.log(`plan: ${calls} poll(s) of ${MODEL} every ${INTERVAL_S}s, load ${LOAD} tokens/poll, caps ${MAX_CALLS} calls / $${MAX_USD}; worst case $${Math.min(calls * PER_CALL_USD, MAX_USD)} (per-call --max-budget-usd ${PER_CALL_USD})`);
if (process.argv.includes('--dry-run')) process.exit(0);

let spent = 0, prev = null, done = 0;
for (let i = 1; i <= calls; i++) {
  if (spent + PER_CALL_USD > MAX_USD) { console.log(`STOP: $${spent.toFixed(5)} + per-call cap ${PER_CALL_USD} would pass $${MAX_USD}`); break; }
  const label = `${TAG}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const prompt = LOAD ? `${pad(label, LOAD)}\n\nIgnore the lines above. Reply with the single word: ok` : 'Reply with the single word: ok';
  const r = await runCall({ model: MODEL, prompt, maxBudgetUsd: PER_CALL_USD, timeoutMs: 180000 });
  const s = r.summary;
  spent += s.costUsd ?? 0; done++;
  const h5 = s.fiveHour?.utilization ?? null, d7 = s.sevenDay?.utilization ?? null;
  const row = { ts: new Date().toISOString(), i, model: MODEL, exitCode: r.exitCode, costUsd: s.costUsd, inputTokens: s.inputTokens, outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens, cacheWriteTokens: s.cacheWriteTokens, loadTokens: LOAD, status: s.status, claim: s.claimType,
    fiveHour: h5, fiveHourResetsAt: s.fiveHour?.resetsAt ?? null, sevenDay: d7, sevenDayResetsAt: s.sevenDay?.resetsAt ?? null,
    changed: prev ? (h5 !== prev.h5 || d7 !== prev.d7) : null, d5h: prev && h5 != null ? +(h5 - prev.h5).toFixed(4) : null, d7d: prev && d7 != null ? +(d7 - prev.d7).toFixed(4) : null,
    rateLimitEvents: s.rateLimitEvents, runningSpentUsd: +spent.toFixed(6), secretHits: secretScan(r.lines).length };
  appendJsonl(LOG, row);
  if (process.argv.includes('--save-raw')) saveRaw(RAW, label, r.rawText);
  console.log(`${row.ts} #${i} 5h=${h5} 7d=${d7} status=${s.status} cost=${s.costUsd} tokens(cw=${s.cacheWriteTokens},cr=${s.cacheReadTokens},out=${s.outputTokens}) spent=$${spent.toFixed(5)}${row.changed ? '  <-- tick' : ''}${r.exitCode ? ` EXIT ${r.exitCode}: ${r.stderr.slice(-160)}` : ''}${s.rateLimitEvents ? '' : '  (no rate_limit_event)'}`);
  if (h5 != null) prev = { h5, d7 };
  if (r.exitCode && /usage limit|rate.?limit|429/i.test(r.stderr + (s.text ?? ''))) { console.log('STOP: the account reports a limit'); break; }
  if (i < calls) await new Promise(res => setTimeout(res, INTERVAL_S * 1000));
}
console.log(`done: ${done} call(s), list-price spend $${spent.toFixed(5)}, log ${path.relative(HERE, LOG)}`);
