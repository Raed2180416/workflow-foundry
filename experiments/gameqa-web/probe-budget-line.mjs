#!/usr/bin/env node
// GQA-1 diagnostic (post-hoc, development evidence; not a comparative run): does the "USD budget" line that `claude -p
// --max-budget-usd` adds to the model's context make the solo agent stop early?
//   node experiments/gameqa-web/probe-budget-line.mjs --live [--samples 2] > research/gameqa-20261021/diag/budget-line.json
// (1) quote probe: one call with the flag and one without, asking the model to copy any line of its context that is about
//     a budget, money or tokens (only such lines are kept, e-mail addresses are redacted: the CLI context can carry the
//     host account identity).
// (2) counterfactual replay: the exact prompt of the turn on which each frozen agent rep (gqa1-agent-r1..r5) answered
//     "finish", read from its model journal, is sent again `--samples` times with the flag (as in the runs) and without it.
//     Recorded per sample: the action, the length of the planned run, whether the notes cite a budget or cost, the notes.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createModelPort } from '../lib/models.mjs';
import { omitCliBudgetFlag } from './transport.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values: a } = parseArgs({ options: { live: { type: 'boolean', default: false }, samples: { type: 'string', default: '2' } } });
if (!a.live) { console.error('paid diagnostic: pass --live'); process.exit(2); }
const MODEL = 'claude-haiku-5-5', SAMPLES = Number(a.samples), CAP_USD = 0.25;
const redact = s => String(s ?? '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');
const BUDGET_WORDS = /budget|usd|\$|cost|spen[dt]|money|tokens? (left|remaining)/i;

function finishingTurn(runId) {
  const file = path.join(ROOT, 'experiments/runs/gameqa-web', runId, 'journal.sqlite');
  if (!existsSync(file)) throw new Error(`no journal for ${runId}`);
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare('SELECT node_key, request, response, ok FROM model_calls WHERE ok = 1 ORDER BY id').all();
  db.close();
  const fin = rows.filter(r => JSON.parse(r.response)?.value?.action === 'finish').at(-1);
  if (!fin) throw new Error(`${runId}: no finishing turn`);
  const q = JSON.parse(fin.request);
  return { nodeKey: fin.node_key, system: q.system, prompt: q.prompt, schema: q.schema };
}

const ports = {};
for (const cond of ['flag', 'noflag']) {
  const journalFile = path.join(ROOT, 'experiments/runs/gameqa-web/diag-budget-line', cond, 'journal.sqlite');
  const p = createModelPort({ journalFile, allowedModels: [MODEL], maxBudgetUsdPerCall: CAP_USD });
  if (cond === 'noflag') omitCliBudgetFlag(p.port);
  ports[cond] = p;
}
let spent = 0;
async function call(cond, req) {
  const r = await ports[cond].port.call({ runId: `diag-budget-line-${cond}`, modelId: MODEL, decoding: { reasoning: 'low' }, salt: `diag-budget-line-${cond}`, ...req });
  spent += (r.costUsd ?? 0) + (r.costUnknown ? (r.costUpperUsd ?? CAP_USD) : 0);
  return r;
}

const out = { experiment: 'GQA-1 diagnostic: CLI budget line', evidence: 'development (post-hoc diagnostic, not comparative)', model: MODEL,
  cliCap: CAP_USD, at: new Date().toISOString(), quote: {}, replay: [] };
const QUOTE_SCHEMA = { type: 'object', additionalProperties: false, required: ['lines'], properties: { lines: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 400 } } } };
for (const cond of ['flag', 'noflag']) {
  const r = await call(cond, { nodeKey: 'quote', system: 'You answer in JSON.', schema: QUOTE_SCHEMA,
    prompt: 'Apart from this message and your system prompt, your context may hold other lines of text, for example about a budget, money, cost or tokens. Copy every such line about a budget, money, cost or tokens verbatim into "lines". If there is none, return an empty list.' });
  out.quote[cond] = r.ok ? (r.value.lines ?? []).map(redact).filter(l => BUDGET_WORDS.test(l)) : { error: r.error?.code };
  console.error('quote', cond, JSON.stringify(out.quote[cond]));
}
for (let rep = 1; rep <= 5; rep++) {
  const runId = `gqa1-agent-r${rep}`, t = finishingTurn(runId);
  for (const cond of ['flag', 'noflag']) for (let s = 0; s < SAMPLES; s++) {
    const r = await call(cond, { nodeKey: `${runId}-${t.nodeKey}`, sampleIndex: s, system: t.system, prompt: t.prompt, schema: t.schema });
    const v = r.ok ? r.value : null;
    const row = { run: runId, turn: t.nodeKey, cond, sample: s, ok: r.ok, error: r.ok ? null : r.error?.code, action: v?.action ?? null,
      plannedTokens: v?.steps?.length ?? null, reports: v?.reports?.length ?? null, citesBudget: v ? BUDGET_WORDS.test(v.notes) : null, notes: redact(v?.notes).slice(0, 600), costUsd: r.costUsd ?? 0 };
    out.replay.push(row);
    console.error(runId, t.nodeKey, cond, s, row.action, row.plannedTokens, row.citesBudget ? 'cites budget' : '');
  }
}
const tally = cond => { const rs = out.replay.filter(r => r.cond === cond && r.ok); return { n: rs.length, finish: rs.filter(r => r.action === 'finish').length, citesBudget: rs.filter(r => r.citesBudget).length }; };
out.summary = { flag: tally('flag'), noflag: tally('noflag'), usd: Math.round(spent * 1e6) / 1e6 };
for (const p of Object.values(ports)) p.db.close();
console.log(JSON.stringify(out, null, 1));
