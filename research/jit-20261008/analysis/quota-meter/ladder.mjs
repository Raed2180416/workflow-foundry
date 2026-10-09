#!/usr/bin/env node
// Sensitivity ladder: does the 0.01-resolution meter move at all for a given spend, and by how much per token class?
// Each rung is one call with a large padded input (cache write on first use; a second identical rung reads it back), so a
// token class (input / cache write / cache read / output) can be loaded alone. Hard dollar cap on the sum of total_cost_usd.
//   node ladder.mjs --model claude-haiku-5-5 --rungs write:60000,read:60000,out:0 --cap 0.20
// rung = <kind>:<approx padded tokens>; kinds: write (fresh padded prompt), read (repeat the previous rung's prompt), out (ask for a long answer).
import path from 'node:path';
import { HERE, runCall, saveRaw, appendJsonl, pad } from './lib.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const MODEL = arg('model', 'claude-haiku-5-5');
const CAP = Number(arg('cap', '0.20'));
const OUT = path.resolve(HERE, arg('out', 'raw/ladder'));
const rungs = arg('rungs', 'write:60000,read:60000').split(',').map(s => { const [kind, n] = s.split(':'); return { kind, n: Number(n) }; });
if (MODEL.includes('opus') || MODEL.includes('sonnet')) { if (!process.argv.includes('--allow-big')) { console.error('refusing a ladder on a non-Haiku model without --allow-big'); process.exit(2); } }

let spent = 0, lastPrompt = null, n = 0;
for (const { kind, n: tokens } of rungs) {
  n++;
  const label = `ladder-${MODEL.split('-')[1]}-${n}-${kind}${tokens}`;
  let prompt;
  if (kind === 'write') prompt = lastPrompt = `${pad(`${label}-${Date.now()}`, tokens)}\n\nIgnore the lines above. Reply with the single word: ok`;
  else if (kind === 'read') prompt = lastPrompt;
  else prompt = 'Write the numbers from 1 to 1500, comma separated, nothing else.';
  const budget = 0.15;
  if (spent + budget > CAP) { console.log(`SKIP ${label}: ${spent.toFixed(4)} + ${budget} > cap ${CAP}`); continue; }
  const r = await runCall({ model: MODEL, prompt, maxBudgetUsd: budget, timeoutMs: 240000 });
  saveRaw(OUT, label, r.rawText);
  const s = r.summary; spent += s.costUsd ?? 0;
  const row = { ts: new Date().toISOString(), label, model: MODEL, kind, exitCode: r.exitCode, costUsd: s.costUsd, inputTokens: s.inputTokens, outputTokens: s.outputTokens, cacheReadTokens: s.cacheReadTokens, cacheWriteTokens: s.cacheWriteTokens, fiveHour: s.fiveHour, sevenDay: s.sevenDay, runningSpentUsd: +spent.toFixed(6) };
  appendJsonl(path.join(OUT, 'ladder.jsonl'), row);
  console.log(JSON.stringify({ label, cost: s.costUsd, in: s.inputTokens, out: s.outputTokens, cr: s.cacheReadTokens, cw: s.cacheWriteTokens, h5: s.fiveHour?.utilization, d7: s.sevenDay?.utilization, exit: r.exitCode, spent: +spent.toFixed(5), err: r.exitCode ? r.stderr.slice(-200) : undefined }));
}
console.log(`LADDER list-price spend ${spent.toFixed(5)} USD (cap ${CAP})`);
