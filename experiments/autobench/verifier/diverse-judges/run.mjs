#!/usr/bin/env node
// Run the diverse-judges verifier over the verifier lab's stored rows (development evidence, devTrain dev60 only).
//
//   set -a; . /root/.config/foundry/inception.env; set +a     # only when --judge mercury (the key never enters a file or log)
//   node run.mjs --vlab <lab dir> --out <dir> --judge haiku|sonnet|mercury [--arms a,b] [--folds 0,1] [--tasks t1,t2]
//       [--variant world|diffonly] [--limit N] [--concurrency N] [--usd-cap 4] [--mercury-cap 1500000] [--sizes]
//
// Each candidate (one row = one arm's final world on one task) is judged alone. The judge sees verifierView(row) rendered
// by view.mjs (request, connected apps' records before the run, the changes) and never the label, task name, arm, run or a
// path. Every call goes through ModelPort (journal in <out>/journal.sqlite, mode replay-or-live: a repeated call is free).
// Budgets are cumulative over the journal: --usd-cap bounds the Claude spend of every run that shares the journal, and
// --mercury-cap bounds Mercury's tokens (the provider's run cap is set to what is left).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createModelPort } from '../../../lib/models.mjs';
import { judgeContext } from './view.mjs';
import { JUDGE_VERSION, judgeMessages, judgeOnce } from './judge.mjs';

export const JUDGES = Object.freeze({ haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', mercury: 'mercury-3' });
const CLAUDE = new Set(['claude-haiku-5-5', 'claude-sonnet-5-5']);

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    if (['sizes', 'dry'].includes(name)) a[name] = true; else a[name] = argv[++i];
  }
  return a;
}
const list = s => (s ? String(s).split(',').map(x => x.trim()).filter(Boolean) : null);

/** Spend already in the journal: Claude USD and Mercury tokens (prompt incl. cached + completion). */
export function journalSpend(file) {
  if (!existsSync(file)) return { claudeUsd: 0, mercuryTokens: 0, byModel: {} };
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare('select model_id, count(*) n, sum(cost_usd) usd, sum(input_tokens) i, sum(output_tokens) o, sum(cache_read_tokens) cr, sum(cache_write_tokens) cw from model_calls group by model_id').all();
  db.close();
  const byModel = Object.fromEntries(rows.map(r => [r.model_id, { calls: r.n, usd: r.usd ?? 0, input: r.i ?? 0, output: r.o ?? 0, cacheRead: r.cr ?? 0, cacheWrite: r.cw ?? 0 }]));
  const claudeUsd = rows.filter(r => CLAUDE.has(r.model_id)).reduce((s, r) => s + (r.usd ?? 0), 0);
  const m = byModel['mercury-3'];
  return { claudeUsd, mercuryTokens: m ? m.input + m.output + m.cacheRead : 0, byModel };
}

function leakCheck(row, text) {
  const bad = [row.task, row.run, row.rowId, 'task_completed_correctly', 'partial_credit', '/var/tmp/foundry-work', 'vlab'].filter(s => s && text.includes(s));
  return bad;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.vlab || !o.out || !o.judge) throw new Error('usage: node run.mjs --vlab <dir> --out <dir> --judge haiku|sonnet|mercury [...]');
  const modelId = JUDGES[o.judge];
  if (!modelId) throw new Error(`unknown judge ${o.judge}`);
  const lab = await import(pathToFileURL(path.join(path.resolve(o.vlab), 'load.mjs')).href);
  const variant = o.variant ?? 'world';
  if (!['world', 'diffonly'].includes(variant)) throw new Error('--variant world|diffonly');
  const rows = lab.loadRows({ canonicalOnly: true, arms: list(o.arms), folds: list(o.folds)?.map(Number), tasks: list(o.tasks) });
  rows.sort((a, b) => a.task.localeCompare(b.task) || lab.ARM_ORDER.indexOf(a.arm) - lab.ARM_ORDER.indexOf(b.arm));
  const out = path.resolve(o.out);
  mkdirSync(out, { recursive: true });
  const resultsFile = path.join(out, `judgments-${o.judge}-${variant}.jsonl`), journalFile = path.join(out, 'journal.sqlite');
  const keyOf = r => `${JUDGE_VERSION}|${variant}|${o.judge}|${r.rowId}`;
  const done = new Set();
  if (existsSync(resultsFile)) for (const l of readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); if (j.ok) done.add(j.key); }
  let todo = rows.filter(r => !done.has(keyOf(r)));
  if (o.limit) todo = todo.slice(0, Number(o.limit));

  const ctxOf = r => {
    const view = lab.verifierView(r);
    const initial = variant === 'world' ? lab.loadWorlds(r).initial : null;
    return judgeContext(view, initial, { withRecords: variant === 'world', recordsCap: Number(o['records-cap'] ?? 20000) });
  };

  if (o.sizes) {
    let chars = 0, max = 0, trunc = 0;
    for (const r of todo) { const c = ctxOf(r); const m = judgeMessages(c); const n = m.system.length + m.prompt.length; chars += n; max = Math.max(max, n); if (c.recordsTruncated) trunc++; }
    console.log(JSON.stringify({ rows: todo.length, chars, approxTokens: Math.round(chars / 3.2), meanChars: Math.round(chars / Math.max(1, todo.length)), maxChars: max, recordsTruncated: trunc }));
    return;
  }

  const usdCap = Number(o['usd-cap'] ?? 4), mercuryCap = Number(o['mercury-cap'] ?? 1_500_000);
  const spent = journalSpend(journalFile);
  const mercuryLeft = Math.floor(mercuryCap - spent.mercuryTokens);
  if (modelId === 'mercury-3' && mercuryLeft < 20_000) throw new Error(`Mercury token budget exhausted: ${spent.mercuryTokens} of ${mercuryCap} used`);
  if (CLAUDE.has(modelId) && spent.claudeUsd >= usdCap) throw new Error(`Claude budget exhausted: $${spent.claudeUsd.toFixed(4)} of $${usdCap}`);
  const { port, tokens } = createModelPort({ journalFile, allowedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'mercury-3'], tokenCap: Math.max(1, mercuryLeft),
    callTokens: 100_000, maxBudgetUsdPerCall: modelId === 'claude-sonnet-5-5' ? 0.3 : 0.1, concurrency: { 'claude-cli': Number(o.concurrency ?? 6), inception: Number(o.concurrency ?? 3) } });
  const decoding = modelId === 'mercury-3' ? { maxTokens: 8000, reasoning: o['mercury-reasoning'] ?? 'low' } : { reasoning: o.reasoning ?? 'none' };

  let usd = spent.claudeUsd, stop = null, n = 0;
  const started = Date.now();
  // Claude: candidates of one task run one after another so the task-shared system prompt is a cache read after the first.
  const byTask = new Map();
  for (const r of todo) { if (!byTask.has(r.task)) byTask.set(r.task, []); byTask.get(r.task).push(r); }
  const queue = [...byTask.values()];
  const width = Number(o.concurrency ?? (modelId === 'mercury-3' ? 3 : 6));
  const worker = async () => {
    while (queue.length && !stop) {
      const group = queue.shift();
      for (const r of group) {
        if (stop) return;
        if (CLAUDE.has(modelId) && usd >= usdCap) { stop = `Claude budget cap $${usdCap} reached ($${usd.toFixed(4)})`; return; }
        const ctx = ctxOf(r);
        const m = judgeMessages(ctx);
        const leaks = leakCheck(r, m.system + m.prompt);
        if (leaks.length) { appendFileSync(resultsFile, JSON.stringify({ key: keyOf(r), rowId: r.rowId, judge: o.judge, ok: false, error: { code: 'LEAK_REFUSED', message: `context contains ${leaks.length} forbidden string(s)` } }) + '\n'); continue; }
        let res;
        try { res = await judgeOnce(port, { modelId, ctx, runId: `dj-${JUDGE_VERSION}-${variant}`, nodeKey: `${o.judge}:${lab.opaqueId(r)}`, decoding, mode: 'replay-or-live' }); }
        catch (e) { res = { ok: false, error: { code: e.code ?? 'ERROR', message: String(e.message ?? e).slice(0, 300) }, costUsd: e.costUsd ?? 0 }; }
        if (CLAUDE.has(modelId)) usd += res.costUsd ?? 0;
        if (res.error?.code === 'MODEL_BUDGET' && modelId === 'mercury-3') stop = `Mercury token cap: ${res.error.message}`;
        if (res.error?.code === 'MODEL_RATE_LIMIT') stop = 'rate limited';
        n++;
        appendFileSync(resultsFile, JSON.stringify({ key: keyOf(r), version: JUDGE_VERSION, variant, judge: o.judge, modelId, rowId: r.rowId, vid: lab.opaqueId(r), ok: res.ok, verdict: res.verdict ?? null,
          value: res.value ?? null, error: res.error ?? null, usage: res.usage ?? null, costUsd: res.costUsd ?? 0, latencyMs: res.latencyMs ?? null, replayed: res.replayed ?? false,
          chars: res.chars ?? null, recordsTruncated: ctx.recordsTruncated, at: new Date().toISOString() }) + '\n');
        if (n % 10 === 0) console.error(`[${o.judge}/${variant}] ${n}/${todo.length} judged, claude $${usd.toFixed(4)}, mercury ${JSON.stringify(tokens()?.inception ?? null)}, ${Math.round((Date.now() - started) / 1000)} s`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, width) }, worker));
  const after = journalSpend(journalFile);
  console.log(JSON.stringify({ judge: o.judge, variant, judged: n, todo: todo.length, stop, claudeUsdTotal: after.claudeUsd, mercuryTokensTotal: after.mercuryTokens, byModel: after.byModel, seconds: Math.round((Date.now() - started) / 1000) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.stack ?? String(e)); process.exit(1); });
}
