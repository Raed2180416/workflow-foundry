#!/usr/bin/env node
// WorkBench contamination probe battery (PLAN §5.5 item 1; paid, about $5): for Haiku 5.5, Sonnet 5.5 and Opus 5.5, on
// >= 100 non-sealed shipped DEV instances against the same number of never-published controls (dev-template instances
// regenerated with the breadth seed 8850, text and answer both new), two single-call probes, no tools:
//   continuation  "complete this line of <file>": the row prefix up to the first argument value of its gold outcome;
//                 hit = the model's first value equals the file's (an 8-digit record id or a value that only the file
//                 or the world holds; no world is given);
//   slot          TS-Guessing on the task text: one template parameter value masked; hit = exact fill.
// Per model and probe, one-sided Fisher exact test (shipped hits > control hits) at 0.05. A flag on an H4 bed means
// "not admitted" (PLAN §5.5); WorkBench's sealed set is H4. Sessions use the facade's hardened, sandboxed CLI session with
// no tools and no MCP server. Results: host-only rows; committed aggregates (CONTAM-PROBE.json).
//   node experiments/breadth/workbench/contam-probe.mjs --dry-run                     ($0: items, prompts, estimate)
//   node experiments/breadth/workbench/contam-probe.mjs --cap 8 [--models a,b,c] [--n 100] [--effort low] [--concurrency 3]
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { gate, meterJournal } from '../facade/meter.mjs';
import { runFacadeSession } from '../facade/session.mjs';
import { anchorInstances } from './prescreen.mjs';
import { BENCH, HOST_ONLY, RESEARCH, readJson, readJsonl, shippedTasks, writeJson } from './lib.mjs';
import { armModel } from './arms.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
export const PROBE_VERSION = 'wb-contam-v1';
const CSV_HEADER = '"task","outcome","base_template","chosen_template","domains"';
const fileOf = domain => `data/processed/tasks_and_outcomes/${domain}_tasks_and_outcomes.csv`;
const csvCell = s => `"${String(s).replaceAll('"', '""')}"`;
const pyList = xs => `[${xs.map(x => `'${x}'`).join(', ')}]`;

/** The continuation probe of one task: prompt and target (first argument value of its first gold action), or null. */
export function continuationProbe(t) {
  if (!t.outcome.length) return null;
  const outcomeCell = csvCell(pyList(t.outcome)); // the CSV's own quoting of a Python list literal of action strings
  const i = outcomeCell.indexOf('=""');
  if (i < 0) return null;
  const prefix = `${csvCell(t.task)},${outcomeCell.slice(0, i + 3)}`;
  const rest = outcomeCell.slice(i + 3);
  const target = rest.slice(0, rest.indexOf('""'));
  if (!target) return null;
  return { prompt: `The following is the beginning of a line of the CSV file ${fileOf(t.domain)} of the WorkBench benchmark (github.com/olly-styles/WorkBench). Its header is:\n${CSV_HEADER}\n\nContinue the line exactly from where it stops. Reply with the continuation only, nothing else.\n\n${prefix}`, target };
}

/** The slot probe: the first template parameter of the task text masked. */
export function slotProbe(t) {
  const tpl = t.chosen_template ?? t.base_template;
  if (!tpl || !tpl.includes('{')) return null;
  const parts = tpl.split(/(\{[a-z_]+\})/);
  const re = new RegExp(`^${parts.map(p => (/^\{[a-z_]+\}$/.test(p) ? '(.+?)' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 's');
  const m = re.exec(t.task);
  if (!m || !m[1]) return null;
  const value = m[1];
  const idx = m.index + t.task.indexOf(value);
  const masked = t.task.slice(0, idx) + '[MASK]' + t.task.slice(idx + value.length);
  return { prompt: `The following task is one line of the WorkBench benchmark (github.com/olly-styles/WorkBench, file ${fileOf(t.domain)}), with one word or phrase replaced by [MASK].\n\n${masked}\n\nReply with the exact original text of [MASK] only, nothing else.`, target: value };
}

/** First answer token: the reply up to the first quote, comma, bracket or whitespace run (trimmed, quotes stripped). */
export const firstValue = reply => String(reply ?? '').trim().replace(/^["'`]+/, '').split(/""|"|'|,|\)|\]|\s/)[0];
export function score(kind, target, reply) {
  if (kind === 'continuation') return firstValue(reply) === target;
  return String(reply ?? '').trim().replace(/^["'`]+|["'`.]+$/g, '').toLowerCase() === target.toLowerCase();
}

/** One-sided Fisher exact test: P(X >= a) for a hits among n1 shipped vs b among n2 controls (hypergeometric). */
export function fisherOneSided(a, n1, b, n2) {
  const K = a + b, N = n1 + n2;
  const lf = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const lc = (n, k) => (k < 0 || k > n ? -Infinity : lf(n) - lf(k) - lf(n - k));
  let p = 0;
  for (let x = a; x <= Math.min(K, n1); x++) p += Math.exp(lc(n1, x) + lc(n2, K - x) - lc(N, K));
  return Math.min(1, p);
}

function parseArgs(argv) {
  const o = { models: ['A-H', 'A-S', 'A-O'], n: 100, cap: null, effort: 'low', concurrency: 3, dryRun: false, runId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--models' || a === '--arms') o.models = v().split(',');
    else if (a === '--n') o.n = Number(v());
    else if (a === '--cap') o.cap = Number(v());
    else if (a === '--effort') o.effort = v();
    else if (a === '--concurrency') o.concurrency = Number(v());
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--run-id') o.runId = v();
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = parseArgs(process.argv.slice(2));
  const split = readJson(path.join(RESEARCH, 'SPLIT.json'));
  const devSet = new Set(split.devTemplates);
  const shipped = await shippedTasks({ cwd: path.join(BENCH, 'work') });
  const dev = shipped.filter(t => devSet.has(t.template_id));
  const regenFile = path.join(HOST_ONLY, 'regen', 'seed8850-a.jsonl');
  if (!existsSync(regenFile)) throw new Error('run regen-gate.mjs first (regenerated controls)');
  const shippedGold = new Set(shipped.map(t => `${t.template_id}\u0000${JSON.stringify(t.outcome)}`)), shippedText = new Set(shipped.map(t => t.task));
  const controlPool = readJsonl(regenFile).filter(r => devSet.has(r.template_id) && !shippedText.has(r.task) && !shippedGold.has(`${r.template_id}\u0000${JSON.stringify(r.outcome)}`));
  const pickSpread = (rows, key) => anchorInstances(rows.map(r => ({ id: r.id, template_id: r.template_id })), `${split.salt.sha}:contam:${key}`, rows.length);
  const build = (rows, key, group) => {
    const order = pickSpread(rows, key), byId = new Map(rows.map(r => [r.id, r]));
    const out = [];
    for (const id of order) {
      const t = byId.get(id), c = continuationProbe(t), s = slotProbe(t);
      if (c) out.push({ group, id, kind: 'continuation', ...c });
      if (s) out.push({ group, id, kind: 'slot', ...s });
    }
    return out;
  };
  const take = (items, kind) => items.filter(i => i.kind === kind).slice(0, o.n);
  const sh = build(dev, 'shipped', 'shipped'), ct = build(controlPool, 'control', 'control');
  const probes = ['continuation', 'slot'].flatMap(k => [...take(sh, k), ...take(ct, k)]);
  const arms = o.models.map(a => ({ id: a, ...armModel(a) }));
  // one short no-tool call: about 1-2K prompt tokens written to cache plus a few output tokens (effort low)
  const perCall = { 'A-H': 0.0005, 'A-S': 0.007, 'A-O': 0.014, H45: 0.004 };
  const est = Math.round(probes.length * arms.reduce((s, a) => s + (perCall[a.id] ?? 0.04), 0) * 100) / 100;
  const counts = Object.fromEntries(['continuation', 'slot'].flatMap(k => ['shipped', 'control'].map(g => [`${k}/${g}`, probes.filter(p => p.kind === k && p.group === g).length])));
  if (o.dryRun) {
    console.log(JSON.stringify({ version: PROBE_VERSION, arms: arms.map(a => `${a.id} ${a.model} effort ${o.effort}`), counts, calls: probes.length * arms.length, estimateUsd: est,
      examples: [take(sh, 'continuation')[0], take(sh, 'slot')[0]].map(p => p && { ...p, target: `<${p.target.length} chars>` }) }, null, 1));
    process.exit(0);
  }
  if (!(o.cap > 0)) throw new Error('--cap USD is required');
  const runId = o.runId ?? `contam-${new Date().toISOString().slice(0, 16).replace(/-/g, '').replace(':', '').replace('T', '-')}`;
  const runDir = path.join(HOST_ONLY, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  const rowsFile = path.join(runDir, 'rows.jsonl');
  const done = new Set(readJsonl(rowsFile).map(r => `${r.arm}|${r.group}|${r.id}|${r.kind}`));
  let spent = readJsonl(rowsFile).reduce((s, r) => s + (r.costUsd ?? r.costUpperUsd ?? 0), 0), reserved = 0, stop = null, last = null;
  const meter = meterJournal(path.join(runDir, 'meter.jsonl'));
  const jobs = arms.flatMap(a => probes.map(p => ({ a, p }))).sort((x, y) => (sha(`${runId}:${x.a.id}:${x.p.group}:${x.p.id}:${x.p.kind}`) < sha(`${runId}:${y.a.id}:${y.p.group}:${y.p.id}:${y.p.kind}`) ? -1 : 1));
  const live = path.join(BENCH, 'live', runId);
  let next = 0;
  await Promise.all(Array.from({ length: o.concurrency }, async (_, wi) => {
    while (next < jobs.length && !stop) {
      const { a, p } = jobs[next++];
      const key = `${a.id}|${p.group}|${p.id}|${p.kind}`;
      if (done.has(key)) continue;
      const g = gate(last); if (!g.ok) { stop = `meter: ${g.reason}`; break; }
      const budget = a.id === 'A-O' ? 0.3 : a.id === 'A-S' ? 0.15 : 0.05;
      if (spent + reserved + budget > o.cap) { stop = `cap ${o.cap}`; break; }
      reserved += budget;
      const workdir = path.join(live, `${wi}`);
      rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
      const r = await runFacadeSession({ model: a.model, effort: o.effort, prompt: p.prompt, workdir, mcpConfig: { mcpServers: {} }, builtinTools: [], budgetUsd: budget, maxTurns: 1,
        systemPrompt: 'You answer questions about text files. Reply with the requested text only.', timeoutMs: 180_000, onMeter: m => { last = m; meter.record(m, { arm: a.id }); } });
      reserved -= budget;
      spent += r.costUsd ?? r.costUpperUsd ?? 0;
      if (r.error && ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE', 'EXECUTOR_PROTOCOL', 'EXECUTOR_LAUNCH'].includes(r.error.code)) { stop = `environment fault: ${r.error.code}`; break; }
      appendFileSync(rowsFile, JSON.stringify({ arm: a.id, model: a.model, group: p.group, id: p.id, kind: p.kind, hit: score(p.kind, p.target, r.result), reply: String(r.result ?? '').slice(0, 200),
        error: r.error?.code ?? null, costUsd: r.costUsd, costUpperUsd: r.costUpperUsd }) + '\n');
    }
  }));
  rmSync(live, { recursive: true, force: true });
  const rows = readJsonl(rowsFile).filter(r => !r.error);
  const table = {};
  for (const a of arms) for (const k of ['continuation', 'slot']) {
    const s = rows.filter(r => r.arm === a.id && r.kind === k && r.group === 'shipped'), c = rows.filter(r => r.arm === a.id && r.kind === k && r.group === 'control');
    const sh1 = s.filter(r => r.hit).length, c1 = c.filter(r => r.hit).length;
    table[`${a.id}/${k}`] = { shipped: `${sh1}/${s.length}`, control: `${c1}/${c.length}`, pOneSided: s.length && c.length ? Math.round(fisherOneSided(sh1, s.length, c1, c.length) * 10000) / 10000 : null };
  }
  const flagged = Object.entries(table).filter(([, v]) => v.pOneSided !== null && v.pOneSided < 0.05).map(([k]) => k);
  const res = { version: PROBE_VERSION, runId, at: new Date().toISOString(), stop, spentUsd: Math.round(spent * 10000) / 10000, effort: o.effort, counts, table, flagged,
    verdict: flagged.length ? 'FLAGGED: WorkBench (H4) is not admitted as a primary bed unless the flag is explained' : 'no contamination signal at 0.05 on these probes', models: Object.fromEntries(arms.map(a => [a.id, a.model])) };
  writeJson(path.join(RESEARCH, 'runs', runId, 'CONTAM-PROBE.json'), res);
  console.log(JSON.stringify(res, null, 1));
}
