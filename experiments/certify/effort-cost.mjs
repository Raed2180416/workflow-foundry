#!/usr/bin/env node
// Move 6 $0 step (ATTACK §6: "the --effort cost model from stored tokens"): what each node of each stored dev60 run cost
// at the effort its launch manifest records, the one effort dose the stored data measure (RL2 Haiku readers at reasoning
// low vs medium on the same tasks), and a projection function that refuses to project through an unmeasured dose.
//
//   node effort-cost.mjs --autobench-root /var/tmp/foundry-work/autobench --rl2 <RL2 output dir> --out <json>
//
// Nothing is inferred silently (D28 (4)): an effort the manifest does not record stays UNSET; a dose with no paired
// measurement is 'unmeasured' and projectCost returns null for it. Prices come only from policy/models.json.
// Development evidence; $0; reads launch.json and results.jsonl cost/token fields of dev60 runs (allowlist), never a grade.
//
// v2 (review, 2026-11-04): every run id is checked against the allowlist BEFORE any of its files is read (v1 read the first
// run's launch.json first); the accounting check reports the output the reported cost implies as a RANGE: the upper end
// ignores cache charges (v1's only number), the lower end charges every cached input token at the full input price and
// every uncached one at 1.25x (cache writes), the most a cache can cost. Both ends are bounds, not prices: the policy file
// lists no Haiku cache price, and none is assumed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkManifest, manifestFromLaunch } from '../lib/certify.mjs';
import { clusterBootstrap } from '../lib/infopath.mjs';

export const EFFORT_COST_VERSION = 'effort-cost-v2';
export const CACHE_WRITE_MAX = 1.25;   // a bound on the cache-write multiplier for the lower end of the implied range
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const COST_RUNS = Object.freeze({ 'haiku-a0': ['a0-dev60-dn'], 'sonnet-a0': ['a0s-dev60-dn'], 'opus-a0-xhigh': ['a0o-dev60-dn'], 'haiku-a1': ['a1-dev60-dn', 'a1-dev60-dn-fill'],
  'sonnet-a1': ['a1s-dev60-dn', 'a1s-dev60-dn-fill'], 'haiku-a1c': ['a1c-dev60-dn'], 'm3-a1c': ['m3-a1c-dev60-dn', 'm3-a1c-dev60-dn-fill'] });
const RUN_OK = id => /dev60/.test(id) && !/devcheck|look|test|sealed/i.test(id);
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

export function policyPrices(policyFile = path.join(ROOT, 'policy/models.json')) {
  const p = JSON.parse(readFileSync(policyFile, 'utf8'));
  return Object.fromEntries([...p.models, ...(p.executorModels ?? [])].filter(m => m.price).map(m => [m.id, { in: m.price.inputPerMTok, out: m.price.outputPerMTok }]));
}

/** Per-arm cost profile from stored records: manifest nodes, $ per task, tokens per model, and the CLI accounting check. */
export function armProfile(root, runs, prices) {
  for (const r of runs) if (!RUN_OK(r)) throw new Error(`effort-cost: run ${r} is not on the dev60 allowlist`);
  const launch = JSON.parse(readFileSync(path.join(root, runs[0], 'launch.json'), 'utf8'));
  const manifest = checkManifest(manifestFromLaunch(launch, { runId: runs[0] }), { legacy: 'pre-D28 dev run' });
  const byTask = new Map();
  for (const r of runs) {
    for (const rec of readJsonl(path.join(root, r, 'results.jsonl'))) {
      const f = rec.forks?.[0];
      if (!f || f.costUsd == null || f.sessionError) continue;
      byTask.set(rec.task, { costUsd: f.costUsd, tokens: f.tokens ?? null, model: launch.model });
    }
  }
  const xs = [...byTask.values()];
  const perModel = {};
  for (const x of xs) for (const [m, t] of Object.entries(x.tokens?.byModel ?? (x.tokens ? { [x.model]: x.tokens } : {}))) {
    perModel[m] ??= { input: [], output: [], cached: [] };
    perModel[m].input.push(t.input ?? 0); perModel[m].output.push(t.output ?? 0); perModel[m].cached.push(t.cachedInput ?? 0);
  }
  // accounting check for the session model: recorded output tokens vs the output the reported cost implies
  const pm = prices[launch.model];
  const implied = xs.filter(x => x.tokens && pm).map(x => impliedOutput(x.tokens.byModel?.[launch.model] ?? x.tokens, x.costUsd, pm));
  return {
    runs, manifest: manifest.nodes, conforming: manifest.conforming, tasks: xs.length, usdPerTask: mean(xs.map(x => x.costUsd)), usdPerTaskMedian: median(xs.map(x => x.costUsd)),
    tokensPerTask: Object.fromEntries(Object.entries(perModel).map(([m, v]) => [m, { input: mean(v.input), output: mean(v.output), cachedInput: mean(v.cached) }])),
    accounting: implied.length ? { meanRecordedOutput: mean(implied.map(i => i.recorded)), meanImpliedOutputUpper: mean(implied.map(i => i.impliedMax)),
      meanImpliedOutputLower: mean(implied.map(i => i.impliedMin)), sessionsRecordingUnderImplied: implied.filter(i => i.recorded < 0.5 * i.impliedMax).length,
      sessionsRecordingUnderImpliedLower: implied.filter(i => i.recorded < 0.5 * i.impliedMin).length, n: implied.length } : null,
  };
}

/**
 * The output a session's reported cost implies, as a range (tokens {input, output, cachedInput}, cost in $, price
 * {in, out} per MTok). impliedMax ignores cache charges (all cached input free); impliedMin charges cached input at the full
 * input price and uncached input at CACHE_WRITE_MAX x (the most either can cost), so the recorded output is checked against
 * the smallest output the cost can mean.
 */
export function impliedOutput(t, costUsd, pm) {
  const input = t.input ?? 0, cached = Math.min(input, t.cachedInput ?? 0), uncached = Math.max(0, input - cached);
  const perOut = pm.out / 1e6;
  const impliedMax = perOut > 0 ? Math.max(0, (costUsd - (uncached * pm.in) / 1e6) / perOut) : null;
  const impliedMin = perOut > 0 ? Math.max(0, (costUsd - (uncached * pm.in * CACHE_WRITE_MAX + cached * pm.in) / 1e6) / perOut) : null;
  return { recorded: t.output ?? 0, impliedMax, impliedMin };
}

/** The measured dose: paired calls of one role at two reasoning levels on the same tasks (RL2 readers haiku vs haikum). */
export function readerDose(extractRows, { low = 'haiku', high = 'haikum', B = 2000 } = {}) {
  const ok = extractRows.filter(j => j.ok && j.version === 'rl2-extract-v3' && j.usage);
  const by = (pref) => { const m = new Map(); for (const j of ok.filter(x => x.reader.split(':')[0] === pref)) { const k = `${j.task}|${j.reader.split(':')[1]}`; m.set(k, j); } return m; };
  const L = by(low), H = by(high);
  const pairs = [...H.keys()].filter(k => L.has(k)).map(k => ({ task: k.split('|')[0], lo: L.get(k), hi: H.get(k) }));
  if (!pairs.length) return { pairs: 0 };
  const out = p => p.usage.outputTokens ?? 0;
  const ratio = idx => { const a = idx.reduce((s, i) => s + out(pairs[i].hi), 0), b = idx.reduce((s, i) => s + out(pairs[i].lo), 0); return b ? a / b : null; };
  const cratio = idx => { const a = idx.reduce((s, i) => s + (pairs[i].hi.costUsd ?? 0), 0), b = idx.reduce((s, i) => s + (pairs[i].lo.costUsd ?? 0), 0); return b ? a / b : null; };
  const all = pairs.map((_, i) => i), cl = pairs.map(p => p.task);
  return { model: 'claude-haiku-5-5', role: 'RL2 ledger reader', from: 'low (1,024 thinking tokens)', to: 'medium (8,000)', pairs: pairs.length, tasks: new Set(cl).size,
    outputPerCall: { low: mean(pairs.map(p => out(p.lo))), medium: mean(pairs.map(p => out(p.hi))) }, usdPerCall: { low: mean(pairs.map(p => p.lo.costUsd)), medium: mean(pairs.map(p => p.hi.costUsd)) },
    outputRatio: ratio(all), outputRatioCI: clusterBootstrap(cl, ratio, { B }), costRatio: cratio(all), costRatioCI: clusterBootstrap(cl, cratio, { B }) };
}

/**
 * Project a run's cost per task when one node's effort changes. doses: [{ model, from, to, costRatio }]. Returns null with
 * a reason when no measured dose covers the change (the projection never assumes a multiplier).
 */
export function projectCost({ nodeCostPerTask, otherCostPerTask = 0, model, from, to }, doses) {
  if (from === to) return { usdPerTask: nodeCostPerTask + otherCostPerTask, measured: true };
  const d = doses.find(x => x.model === model && x.from === from && x.to === to);
  if (!d || d.costRatio == null) return { usdPerTask: null, measured: false, reason: `no paired measurement of ${model} ${from} -> ${to}` };
  return { usdPerTask: nodeCostPerTask * d.costRatio + otherCostPerTask, measured: true, ratio: d.costRatio };
}

async function main() {
  const { values: a } = parseArgs({ options: { 'autobench-root': { type: 'string', default: '/var/tmp/foundry-work/autobench' }, rl2: { type: 'string' }, out: { type: 'string' } } });
  if (!a.rl2 || !a.out) { console.error('usage: node effort-cost.mjs --rl2 <dir> --out <json> [--autobench-root <dir>]'); process.exit(2); }
  const prices = policyPrices();
  const arms = Object.fromEntries(Object.entries(COST_RUNS).map(([arm, runs]) => [arm, armProfile(a['autobench-root'], runs, prices)]));
  const dose = readerDose(readJsonl(path.join(a.rl2, 'extract.jsonl')));
  const doses = dose.pairs ? [{ model: 'claude-haiku-5-5', from: 'low', to: 'medium', costRatio: dose.costRatio }] : [];
  const projections = {
    'RL2 readers low -> medium (3 readers, per task)': projectCost({ nodeCostPerTask: 3 * dose.usdPerCall.low, model: 'claude-haiku-5-5', from: 'low', to: 'medium' }, doses),
    'haiku-a0 session UNSET -> max': projectCost({ nodeCostPerTask: arms['haiku-a0'].usdPerTask, model: 'claude-haiku-5-5', from: 'UNSET', to: 'max' }, doses),
    'm3-a1c act node UNSET -> max': projectCost({ nodeCostPerTask: arms['m3-a1c'].usdPerTask, model: 'claude-haiku-5-5', from: 'UNSET', to: 'max' }, doses),
  };
  const out = { version: EFFORT_COST_VERSION, evidence: 'development; stored dev60 records and RL2 journals, $0; prices from policy/models.json', prices, arms, dose, projections,
    note: 'Every dev60 arm except opus-a0-xhigh ran with effort unset (the CLI default applied, not recorded). The only paired effort dose in the stored data is the RL2 Haiku reader at reasoning low vs medium; projections through any other dose return null.' };
  writeFileSync(a.out, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ arms: Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, `${v.usdPerTask?.toFixed(4)} $/task; ${v.manifest.join(' ')}; accounting ${v.accounting ? `${v.accounting.meanRecordedOutput.toFixed(0)} rec vs ${v.accounting.meanImpliedOutputLower.toFixed(0)}..${v.accounting.meanImpliedOutputUpper.toFixed(0)} implied` : '-'}`])), dose: { pairs: dose.pairs, outputRatio: dose.outputRatio, ci: dose.outputRatioCI, costRatio: dose.costRatio, costCI: dose.costRatioCI }, projections }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
