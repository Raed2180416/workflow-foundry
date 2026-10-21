#!/usr/bin/env node
// Run the requirement-ledger-v2 verifier over the verifier lab's stored rows (development evidence, devTrain dev60 only).
//
//   node run.mjs --vlab <lab dir> --out <dir> --phase sizes|extract|check|judge [--folds 0,1,2] [--tasks t1,t2]
//       [--readers haiku:0,haiku:1,mercury:0] [--world-cap 45000] [--usd-cap 3] [--mercury-cap 1000000] [--concurrency 4]
//       [--judge-model haiku] [--judge-only-accepted] [--limit N]
//   (mercury readers need INCEPTION_API_KEY in the environment: set -a; . /root/.config/foundry/inception.env; set +a)
//
// extract: per task, each reader writes a requirement ledger from the request and the task's canonical initial world
//          (the first arm in the lab's order whose initial world is not rebuilt). One call per (task, reader).
// check:   $0. Grounds and merges the readers' ledgers (compile.mjs) and runs the code checks on every canonical row.
// judge:   per row with judged checks, one clean-context call (judge.mjs) on that row's changes.
// The task name is only a cache key in this harness: no model context ever contains a task name, run, arm, label or a
// path (a leak check refuses any prompt that does). Every model call goes through ModelPort with a journal in
// <out>/journal.sqlite (mode replay-or-live: a repeated call is free). Budgets are cumulative over the journal.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { EXTRACT_SYSTEM, EXTRACT_VERSION, LEDGER_SCHEMA, extractionInput, groundLedger } from './extract.mjs';
import { COMPILE_VERSION, mergeLedgers } from './compile.mjs';
import { CHECK_VERSION, runCodeChecks } from './check.mjs';
import { JUDGE_SCHEMA, JUDGE_VERSION, judgeInput, parseJudge } from './judge.mjs';
import { indexWorld } from './lib.mjs';

export const MODELS = Object.freeze({ haiku: 'claude-haiku-5-5', haikum: 'claude-haiku-5-5', mercury: 'mercury-3', sonnet: 'claude-sonnet-5-5' });
// Reader decoding: haiku = reasoning low (1024 thinking tokens), haikum = reasoning medium (8000); mercury: its default (low).
const READER_REASONING = Object.freeze({ haiku: 'low', haikum: 'medium', sonnet: 'low' });
const CLAUDE = new Set(['claude-haiku-5-5', 'claude-sonnet-5-5']);
const list = s => (s ? String(s).split(',').map(x => x.trim()).filter(Boolean) : null);

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    if (['judge-only-accepted', 'dry'].includes(name)) a[name] = true; else a[name] = argv[++i];
  }
  return a;
}

export function journalSpend(file) {
  if (!existsSync(file)) return { claudeUsd: 0, mercuryTokens: 0, byModel: {} };
  const db = new DatabaseSync(file, { readOnly: true });
  let rows = [];
  try { rows = db.prepare('select model_id, count(*) n, sum(cost_usd) usd, sum(input_tokens) i, sum(output_tokens) o, sum(cache_read_tokens) cr, sum(cache_write_tokens) cw from model_calls group by model_id').all(); } catch { rows = []; }
  db.close();
  const byModel = Object.fromEntries(rows.map(r => [r.model_id, { calls: r.n, usd: r.usd ?? 0, input: r.i ?? 0, output: r.o ?? 0, cacheRead: r.cr ?? 0, cacheWrite: r.cw ?? 0 }]));
  const m = byModel['mercury-3'];
  return { claudeUsd: rows.filter(r => CLAUDE.has(r.model_id)).reduce((s, r) => s + (r.usd ?? 0), 0), mercuryTokens: m ? m.input + m.output + m.cacheRead : 0, byModel };
}

function leakCheck(strings, text) {
  return strings.filter(s => s && text.includes(s));
}

/** Canonical row of each task: the first arm in the lab's order whose initial world was not rebuilt. */
export function canonicalRows(lab, rows) {
  const byTask = new Map();
  for (const r of rows) { if (!byTask.has(r.task)) byTask.set(r.task, []); byTask.get(r.task).push(r); }
  const out = new Map();
  for (const [t, rs] of byTask) {
    const sorted = [...rs].sort((a, b) => lab.ARM_ORDER.indexOf(a.arm) - lab.ARM_ORDER.indexOf(b.arm));
    out.set(t, sorted.find(r => !r.worlds.initialRebuilt) ?? sorted[0]);
  }
  return out;
}

const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.vlab || !o.out || !o.phase) throw new Error('usage: node run.mjs --vlab <dir> --out <dir> --phase sizes|extract|check|judge [...]');
  const lab = await import(pathToFileURL(path.join(path.resolve(o.vlab), 'load.mjs')).href);
  const out = path.resolve(o.out);
  mkdirSync(out, { recursive: true });
  const all = lab.loadRows({ canonicalOnly: true, folds: list(o.folds)?.map(Number), tasks: list(o.tasks) });
  const canon = canonicalRows(lab, all);
  const tasks = [...canon.keys()].sort();
  const worldCap = Number(o['world-cap'] ?? 45000);
  const allTaskNames = [...new Set(lab.loadRows({ canonicalOnly: true }).map(r => r.task))];
  const forbidden = r => [...allTaskNames, r.run, r.rowId, r.arm, 'task_completed_correctly', 'partial_credit', '/var/tmp/foundry-work', 'vlab', 'failedType'];
  const journalFile = path.join(out, 'journal.sqlite');
  const extractFile = path.join(out, 'extract.jsonl');

  if (o.phase === 'sizes') {
    let tot = 0;
    for (const t of tasks) {
      const r = canon.get(t);
      const x = extractionInput(lab.verifierView(r), lab.loadWorlds(r).initial, { capChars: worldCap });
      tot += x.chars;
      console.log(`${String(r.fold)} ${String(x.chars).padStart(7)} ${x.truncated ? 'T' : ' '} ${t}`);
    }
    console.log(JSON.stringify({ tasks: tasks.length, chars: tot, approxTokens: Math.round(tot / 3.6), meanChars: Math.round(tot / tasks.length) }));
    return;
  }

  const usdCap = Number(o['usd-cap'] ?? 3), mercuryCap = Number(o['mercury-cap'] ?? 1_000_000);
  const spent = journalSpend(journalFile);
  const makePort = async (needMercury) => {
    const { createModelPort } = await import('../../../lib/models.mjs');
    const allowed = ['claude-haiku-5-5', 'claude-sonnet-5-5', ...(needMercury ? ['mercury-3'] : [])];
    const left = Math.floor(mercuryCap - spent.mercuryTokens);
    if (needMercury && left < 20_000) throw new Error(`Mercury token budget exhausted: ${spent.mercuryTokens} of ${mercuryCap}`);
    return createModelPort({ journalFile, allowedModels: allowed, ...(needMercury ? { tokenCap: Math.max(1, left), callTokens: 60_000 } : {}),
      maxBudgetUsdPerCall: 0.1, timeoutMs: 400_000, concurrency: { 'claude-cli': Number(o.concurrency ?? 4), inception: Number(o['mercury-concurrency'] ?? 3) } });
  };

  if (o.phase === 'extract') {
    const readers = (list(o.readers) ?? ['haiku:0']).map(s => { const [m, k] = s.split(':'); if (!MODELS[m]) throw new Error(`unknown reader model ${m}`); return { name: s, model: m, modelId: MODELS[m], sample: Number(k ?? 0) }; });
    const done = new Set(readJsonl(extractFile).filter(j => j.ok).map(j => j.key));
    const jobs = [];
    for (const t of tasks) {
      const r = canon.get(t);
      const view = lab.verifierView(r);
      const x = extractionInput(view, lab.loadWorlds(r).initial, { capChars: worldCap });
      const leaks = leakCheck(forbidden(r), x.system + x.prompt);
      if (leaks.length) { console.error(`LEAK_REFUSED ${t}: ${leaks.length} forbidden string(s)`); continue; }
      for (const rd of readers) { const key = `${EXTRACT_VERSION}|${x.key}|${rd.name}`; if (!done.has(key)) jobs.push({ t, r, x, rd, key }); }
    }
    if (o.limit) jobs.splice(Number(o.limit));
    console.error(`extract: ${jobs.length} call(s) to make; journal claude $${spent.claudeUsd.toFixed(4)}, mercury ${spent.mercuryTokens} tokens`);
    if (o.dry || !jobs.length) return;
    const { port, tokens } = await makePort(jobs.some(j => j.rd.model === 'mercury'));
    let usd = spent.claudeUsd, stop = null, n = 0;
    const queue = [...jobs];
    const worker = async () => {
      while (queue.length && !stop) {
        const j = queue.shift();
        if (CLAUDE.has(j.rd.modelId) && usd >= usdCap) { stop = `Claude budget cap $${usdCap} reached`; return; }
        const decoding = j.rd.model === 'mercury' ? { maxTokens: Number(o['mercury-max-tokens'] ?? 20000), reasoning: o['mercury-reasoning'] ?? 'low' } : { reasoning: o.reasoning ?? READER_REASONING[j.rd.model] };
        let res;
        try { res = await port.call({ runId: `rl2-extract-${EXTRACT_VERSION}`, nodeKey: `${j.rd.name}:${j.x.key}`, modelId: j.rd.modelId, system: j.x.system, prompt: j.x.prompt, schema: LEDGER_SCHEMA, decoding, mode: 'replay-or-live', sampleIndex: j.rd.sample }); }
        catch (e) { res = { ok: false, error: { code: e.code ?? 'ERROR', message: String(e.message ?? e).slice(0, 300) }, costUsd: e.costUsd ?? 0 }; }
        if (CLAUDE.has(j.rd.modelId)) usd += res.costUsd ?? 0;
        if (res.error?.code === 'MODEL_BUDGET' && j.rd.model === 'mercury') stop = `Mercury token cap: ${res.error.message}`;
        if (res.error?.code === 'MODEL_RATE_LIMIT') stop = 'rate limited';
        n++;
        appendFileSync(extractFile, JSON.stringify({ key: j.key, version: EXTRACT_VERSION, task: j.t, reader: j.rd.name, modelId: j.rd.modelId, ok: Boolean(res.ok), value: res.ok ? res.value : null,
          error: res.ok ? null : { code: res.error?.code ?? null, message: String(res.error?.message ?? '').slice(0, 300) }, usage: res.usage ?? null, costUsd: res.costUsd ?? 0, latencyMs: res.latencyMs ?? null,
          replayed: res.replayed ?? false, promptChars: j.x.chars, truncated: j.x.truncated, at: new Date().toISOString() }) + '\n');
        console.error(`[extract] ${n}/${jobs.length} ${j.rd.name} ok=${Boolean(res.ok)} $${(res.costUsd ?? 0).toFixed(4)} tok=${JSON.stringify(res.usage ?? {}).slice(0, 120)}${res.ok ? '' : ' ' + String(res.error?.message ?? '').slice(0, 160)}`);
      }
    };
    await Promise.all(Array.from({ length: Number(o.workers ?? 6) }, worker));
    const after = journalSpend(journalFile);
    console.log(JSON.stringify({ phase: 'extract', calls: n, stop, claudeUsdTotal: after.claudeUsd, mercuryTokensTotal: after.mercuryTokens, tokens: tokens() }));
    return;
  }

  if (o.phase === 'check') {
    // Ledgers per task: the latest ok extraction per (task, reader) of the current extract version and prompt.
    const readers = list(o.readers);
    const ext = readJsonl(extractFile).filter(j => j.ok && j.version === EXTRACT_VERSION && (!readers || readers.includes(j.reader)));
    const byTask = new Map();
    for (const j of ext) { if (!byTask.has(j.task)) byTask.set(j.task, new Map()); byTask.get(j.task).set(j.reader, j); }
    const checksFile = path.join(out, `checks${o.tag ? '-' + o.tag : ''}.jsonl`), ledgerFile = path.join(out, `ledgers${o.tag ? '-' + o.tag : ''}.jsonl`);
    writeFileSync(checksFile, ''); writeFileSync(ledgerFile, '');
    for (const t of tasks) {
      const cr = canon.get(t);
      const view = lab.verifierView(cr);
      const w0 = lab.loadWorlds(cr).initial;
      const x = extractionInput(view, w0, { capChars: worldCap });
      const got = byTask.get(t) ?? new Map();
      const grounded = [...got.entries()].filter(([, j]) => j.key.includes(x.key)).map(([reader, j]) => ({ reader, ...groundLedger(j.value, { view, idx: x.idx }) }));
      const merged = mergeLedgers(grounded, { hardSupport: o['hard-support'] ? Number(o['hard-support']) : null });
      appendFileSync(ledgerFile, JSON.stringify({ task: t, readers: grounded.map(g => g.reader), merged, grounded: grounded.map(g => ({ reader: g.reader, ok: g.ok, today: g.today, nReq: g.requirements.length, dropped: g.dropped.length, ruleSources: g.ruleSources, items: g.items })) }) + '\n');
      for (const r of all.filter(x2 => x2.task === t)) {
        const w = lab.loadWorlds(r);
        const res = runCodeChecks(merged, { diff: r.diff, world0: w.initial, final: w.final, canonIdx: x.idx, rowIdx: indexWorld(w.initial) });
        appendFileSync(checksFile, JSON.stringify({ rowId: r.rowId, task: t, version: `${EXTRACT_VERSION}+${COMPILE_VERSION}+${CHECK_VERSION}`, readers: merged.readers, judged: merged.judged, code: res.results }) + '\n');
      }
    }
    console.log(JSON.stringify({ phase: 'check', tasks: tasks.length, rows: all.length, checksFile }));
    return;
  }

  if (o.phase === 'judge') {
    const checksFile = path.join(out, `checks${o.tag ? '-' + o.tag : ''}.jsonl`);
    const judgeFile = path.join(out, `judge${o['judge-tag'] ? '-' + o['judge-tag'] : ''}.jsonl`);
    const checks = new Map(readJsonl(checksFile).map(c => [c.rowId, c]));
    const done = new Set(readJsonl(judgeFile).filter(j => j.ok).map(j => j.key));
    const modelId = MODELS[o['judge-model'] ?? 'haiku'];
    const jobs = [];
    for (const r of all) {
      const c = checks.get(r.rowId);
      if (!c || !c.judged?.length) continue;
      if (o['judge-only-accepted'] && c.code.some(x => x.hard && x.pass === false)) continue;
      const view = lab.verifierView(r);
      const x = judgeInput(view, lab.loadWorlds(r).initial, c.judged);
      const leaks = leakCheck(forbidden(r), x.system + x.prompt);
      if (leaks.length) { console.error(`LEAK_REFUSED ${lab.opaqueId(r)}`); continue; }
      const key = `${JUDGE_VERSION}|${x.key}|${modelId}`;
      if (!done.has(key)) jobs.push({ r, x, key, judged: c.judged });
    }
    if (o.limit) jobs.splice(Number(o.limit));
    console.error(`judge: ${jobs.length} call(s) to make; journal claude $${spent.claudeUsd.toFixed(4)}`);
    if (o.dry || !jobs.length) return;
    const { port } = await makePort(modelId === 'mercury-3');
    let usd = spent.claudeUsd, stop = null, n = 0;
    // candidates of one task one after another (shared system prompt -> cache reads)
    const queue = [...jobs].sort((a, b) => a.r.task.localeCompare(b.r.task));
    const worker = async () => {
      while (queue.length && !stop) {
        const j = queue.shift();
        if (CLAUDE.has(modelId) && usd >= usdCap) { stop = `Claude budget cap $${usdCap} reached`; return; }
        let res;
        try { res = await port.call({ runId: `rl2-judge-${JUDGE_VERSION}`, nodeKey: `${lab.opaqueId(j.r)}:${j.x.key}`, modelId, system: j.x.system, prompt: j.x.prompt, schema: JUDGE_SCHEMA, decoding: modelId === 'mercury-3' ? { maxTokens: 4000, reasoning: 'low' } : { reasoning: o.reasoning ?? 'none' }, mode: 'replay-or-live' }); }
        catch (e) { res = { ok: false, error: { code: e.code ?? 'ERROR', message: String(e.message ?? e).slice(0, 300) }, costUsd: e.costUsd ?? 0 }; }
        if (CLAUDE.has(modelId)) usd += res.costUsd ?? 0;
        if (res.error?.code === 'MODEL_RATE_LIMIT') stop = 'rate limited';
        n++;
        appendFileSync(judgeFile, JSON.stringify({ key: j.key, version: JUDGE_VERSION, rowId: j.r.rowId, modelId, ok: Boolean(res.ok), verdicts: res.ok ? parseJudge(res.value, j.judged) : null,
          error: res.ok ? null : { code: res.error?.code ?? null, message: String(res.error?.message ?? '').slice(0, 300) }, usage: res.usage ?? null, costUsd: res.costUsd ?? 0, replayed: res.replayed ?? false, promptChars: j.x.chars, at: new Date().toISOString() }) + '\n');
        if (n % 10 === 0 || !res.ok) console.error(`[judge] ${n}/${jobs.length} ok=${Boolean(res.ok)} claude $${usd.toFixed(4)}${res.ok ? '' : ' ' + String(res.error?.message ?? '').slice(0, 160)}`);
      }
    };
    await Promise.all(Array.from({ length: Number(o.workers ?? 6) }, worker));
    const after = journalSpend(journalFile);
    console.log(JSON.stringify({ phase: 'judge', calls: n, stop, claudeUsdTotal: after.claudeUsd, mercuryTokensTotal: after.mercuryTokens }));
    return;
  }
  throw new Error(`unknown phase ${o.phase}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.stack ?? String(e)); process.exit(1); });
}
