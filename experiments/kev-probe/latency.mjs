// Step 0: Kev-0.8B CPU latency against state size, questions per request, and prefix-cache hits.
// Run alone (no other probe work): node experiments/kev-probe/latency.mjs
// Writes experiments/runs/kev-probe/latency.jsonl (raw) and latency-summary.json.
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { build } from '../../beds/incident/gen.mjs';
import { RUN_DIR, kevClient, kevIdentity, spend, load, appendJsonl, writeJsonl, readJsonl, median, quantile } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const OUT = path.join(RUN_DIR, 'latency.jsonl');
const SIZES = [100, 500, 2000, 6000];          // target state tokens (Qwen tokenizer)
const CHARS_PER_TOKEN = 1.78;                   // measured on this filler with the base tokenizer (log text: hex, timestamps)
const QCOUNTS = [1, 3, 6];
// 5 repeats each; the 6000-token size is cut to 3 repeats because a fresh 6k-token prefill takes minutes on
// this shared 4-core box (stated in the report).
const REPEATS = { 100: 5, 500: 5, 2000: 5, 6000: 3 };

// Filler: a generated incident log (dev seed 11, d5). Content is irrelevant to latency but realistic.
const filler = build(11, 'dev', 5).task.inputs.log;
const QUESTIONS = [
  ['Which tier logs the most errors in this excerpt?', { edge: 'edge or gateway services', api: 'API services', core: 'core services', data: 'data stores and batch jobs' }],
  ['Is there an incident in progress in this excerpt?', { yes: 'errors are rising', no: 'routine traffic only' }],
  ['What is the most common log level?', { info: 'INFO', warn: 'WARN', error: 'ERROR' }],
  ['Does any line mention a TLS or certificate problem?', { yes: 'it does', no: 'it does not' }],
  ['Does any line mention a deploy or rollout?', { yes: 'it does', no: 'it does not' }],
  ['How noisy is this excerpt?', { low: 'mostly routine', medium: 'some warnings', high: 'many errors' }],
];
const questions = n => Object.fromEntries(QUESTIONS.slice(0, n).map(([q, c], i) => [`q${i}`, { type: 'choice', instructions: q, criteria: c }]));

let offset = 0;
function freshState(tokens) {
  const chars = Math.round(tokens * CHARS_PER_TOKEN);
  const nonce = `excerpt ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}\n`;
  const text = filler.slice(offset, offset + chars);
  offset = (offset + chars) % (filler.length - 20000);
  return nonce + text;
}

const client = kevClient();
async function timed(state, n, cond, size, rep) {
  spend('kev', 1, `latency ${size}/${n}/${cond}`);
  const t0 = performance.now();
  const body = await client.ask({ state, questions: questions(n) });
  const wallMs = performance.now() - t0;
  const row = { size, n, cond, rep, wallMs: Math.round(wallMs), serverMs: body.latency_ms, inputTokens: body.usage?.input_tokens ?? null, load1: load().one };
  appendJsonl(OUT, row);
  console.log(JSON.stringify(row));
  return row;
}

const ident = await kevIdentity();
const before = load();
console.log('kev', JSON.stringify(ident), 'load', before.uptime);
const done = new Set(readJsonl(OUT).map(r => `${r.size}|${r.n}|${r.rep}|${r.cond}`));
for (const size of SIZES) {
  for (let rep = 0; rep < REPEATS[size]; rep++) {
    for (const n of QCOUNTS) {
      if (done.has(`${size}|${n}|${rep}|fresh`) && done.has(`${size}|${n}|${rep}|cached`)) continue; // resume
      const s = freshState(size);
      await timed(s, n, 'fresh', size, rep);   // new state: prefix cache miss
      await timed(s, n, 'cached', size, rep);  // same state again: prefix cache hit
    }
  }
}
const after = load();
const rows = readJsonl(OUT);
const summary = [];
for (const size of SIZES) for (const n of QCOUNTS) for (const cond of ['fresh', 'cached']) {
  const xs = rows.filter(r => r.size === size && r.n === n && r.cond === cond);
  if (!xs.length) continue;
  summary.push({ size, n, cond, reps: xs.length, stateTokensApprox: median(xs.map(r => r.inputTokens)),
    wallMedianMs: median(xs.map(r => r.wallMs)), wallP90Ms: quantile(xs.map(r => r.wallMs), 0.9),
    serverMedianMs: median(xs.map(r => r.serverMs)), serverP90Ms: quantile(xs.map(r => r.serverMs), 0.9), load1Median: median(xs.map(r => r.load1)) });
}
writeFileSync(path.join(RUN_DIR, 'latency-summary.json'), JSON.stringify({ kev: ident, loadBefore: before, loadAfter: after, summary }, null, 1));
console.table(summary);
