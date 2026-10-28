#!/usr/bin/env node
// SW-1b analysis (PREREG-SW-1b.md): the template-miss probe. Rows from one or more results.jsonl files (the SW-1b run on
// the 'blocks' layout and, for the paired layout contrast, eval-1's delimited units on the same worlds). Every verdict is
// re-derived from the stored answers and the bed (truth does not depend on the layout); every spec that reached the call
// host is re-checked against the node envelope and a fixed reference envelope, as analyze.mjs does for SW-1.
//   node experiments/subworkflow/analyze-sw1b.mjs --results <file>[,<file>...] [--seeds 201,202,...] [--difficulty 4] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import * as bed from '../../beds/golive/index.mjs';
import { checkSpec, PURE_OPS, EFFECT_OPS } from './dsl.mjs';
import { NODE_MODEL, NODE_BUDGET_USD, SUB_MAX_USD, MAX_DEPTH } from './node.mjs';
import { NODE_INPUTS } from './prompts.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const files = (args.results ?? '').split(',').filter(Boolean);
if (!files.length) { console.error('--results is required'); process.exit(2); }
const D = Number(args.difficulty ?? 4), SEEDS = args.seeds ? new Set(args.seeds.split(',').map(Number)) : null;
const r6 = x => Math.round(x * 1e6) / 1e6, pct = (k, n) => (n ? `${k}/${n} (${(100 * k / n).toFixed(1)}%)` : '0/0');
const layoutOf = r => r.layout ?? (String(r.taskId).includes('+blocks') ? 'blocks' : 'delimited');

const last = new Map();
for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  if (r.status === 'complete') last.set(r.unit, r);
  else if (!last.has(r.unit) || last.get(r.unit).status !== 'complete') last.set(r.unit, r);
}
const rows = [...last.values()].filter(r => r.difficulty === D && (!SEEDS || SEEDS.has(r.seed)));
const complete = rows.filter(r => r.status === 'complete');

const refEnvelope = { inputs: [...NODE_INPUTS], ops: [...PURE_OPS], models: [NODE_MODEL], maxDepth: MAX_DEPTH, budgetUsd: SUB_MAX_USD };
function nestedEffects(spec, out = []) {
  for (const s of spec?.steps ?? []) {
    if (EFFECT_OPS.includes(s?.op)) out.push(s.op);
    if (s?.op === 'call') { try { nestedEffects(JSON.parse(s.specJson), out); } catch { /* checkSpec reports it */ } }
  }
  return out;
}
function auditNode(n) {
  const problems = [];
  for (const x of n.specsRun ?? []) {
    const own = checkSpec(x.spec, x.envelope, { depth: 1 });
    if (!own.ok) problems.push(`spec of round ${x.round} fails its own envelope`);
    const ref = checkSpec(x.spec, { ...refEnvelope, budgetUsd: Math.max(x.envelope.budgetUsd, 0) }, { depth: 1 });
    if (ref.widening.length) problems.push(`spec of round ${x.round} widens the reference envelope`);
    if (x.envelope.budgetUsd > SUB_MAX_USD + 1e-9) problems.push(`round ${x.round} carve above $${SUB_MAX_USD}`);
    if (x.envelope.inputs.some(k => !NODE_INPUTS.includes(k))) problems.push(`round ${x.round} grants inputs outside the node`);
    if (nestedEffects(x.spec).length) problems.push('effect op in a spec that ran');
  }
  for (const e of n.events ?? []) {
    if (e.kind === 'call-end' && (e.depth ?? 0) > MAX_DEPTH) problems.push(`depth ${e.depth}`);
    if (e.kind === 'call-end' && e.spentUsd > (e.budgetUsd ?? Infinity) + 1e-9) problems.push(`child over its reservation`);
  }
  if (n.costUsd > NODE_BUDGET_USD + 1e-9) problems.push('node over budget');
  problems.push(...(n.authority?.violations ?? []).map(v => `runner: ${v}`));
  return problems;
}
const enriched = complete.map(r => {
  const t = bed.generate({ seed: r.seed, split: r.split, difficulty: r.difficulty });
  const nodes = r.nodes.map(n => ({ ...n, pass: n.answer ? bed.nodeOracle(t, n.channel, n.answer).pass : false, audit: auditNode(n) }));
  const answers = nodes.map(n => n.answer).filter(Boolean);
  const pass = bed.oracle(t, { channels: answers, group: { orders: answers.reduce((s, a) => s + a.totals.orders, 0), usd_cents: answers.reduce((s, a) => s + a.totals.usd_cents, 0) } }).pass;
  return { ...r, layout: layoutOf(r), nodes, pass, world: `${r.split}:d${r.difficulty}:${r.seed}` };
});

function summary(arm, layout) {
  const rs = enriched.filter(r => r.arm === arm && r.layout === layout);
  const back = rs.flatMap(r => r.nodes.filter(n => n.kind === 'backlog')), simple = rs.flatMap(r => r.nodes.filter(n => n.kind === 'simple'));
  const cost = rs.reduce((s, r) => s + r.costUsd, 0), backCost = back.reduce((s, n) => s + n.costUsd, 0), passBack = back.filter(n => n.pass).length;
  const tally = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return { arm, layout, tasks: rs.length, taskPass: rs.filter(r => r.pass).length, backlogNodes: back.length, backlogPass: passBack, simplePass: simple.filter(n => n.pass).length, simpleNodes: simple.length,
    costPerTask: r6(rs.length ? cost / rs.length : 0), backlogCostPerNode: r6(back.length ? backCost / back.length : 0), costPerPassingBacklogNode: passBack ? r6(backCost / passBack) : null,
    paths: tally(back, n => n.path ?? 'error'), passByPath: tally(back.filter(n => n.pass), n => n.path ?? 'error'),
    template: tally(back.filter(n => n.sub?.select), n => n.sub.select.template), openUsed: back.filter(n => n.sub?.open).length,
    openPass: back.filter(n => n.sub?.open && n.path === 'subworkflow' && n.pass).length, rounds: tally(back.filter(n => n.rounds?.length), n => n.rounds.length),
    audit: back.concat(simple).flatMap(n => n.audit).length, violations: back.concat(simple).reduce((s, n) => s + (n.authority?.violations?.length ?? 0), 0),
    effects: back.concat(simple).reduce((s, n) => s + (n.authority?.executedEffects ?? 0), 0), proposals: back.concat(simple).reduce((s, n) => s + (n.proposals?.length ?? 0), 0),
    maxDepth: Math.max(0, ...back.map(n => n.maxDepthSeen ?? 0)), nodeOver: back.concat(simple).filter(n => n.costUsd > NODE_BUDGET_USD + 1e-9).length,
    errors: tally(back.concat(simple).filter(n => n.error), n => n.error.code), wallSec: rs.length ? Math.round(rs.reduce((s, r) => s + r.wallMs, 0) / rs.length / 1000) : null };
}
function pair(a, la, b, lb) {
  const A = new Map(enriched.filter(r => r.arm === a && r.layout === la).map(r => [r.world, r])), B = new Map(enriched.filter(r => r.arm === b && r.layout === lb).map(r => [r.world, r]));
  const keys = [...A.keys()].filter(k => B.has(k));
  const c = { both: 0, onlyA: 0, onlyB: 0, neither: 0 };
  for (const k of keys) for (const n of A.get(k).nodes.filter(x => x.kind === 'backlog')) {
    const m = B.get(k).nodes.find(z => z.channel === n.channel);
    if (n.pass && m.pass) c.both++; else if (n.pass) c.onlyA++; else if (m.pass) c.onlyB++; else c.neither++;
  }
  return { a: `${a}/${la}`, b: `${b}/${lb}`, worlds: keys.length, ...c, costA: r6(keys.reduce((s, k) => s + A.get(k).costUsd, 0)), costB: r6(keys.reduce((s, k) => s + B.get(k).costUsd, 0)) };
}

const ARMS = ['A0', 'A1F', 'A2F', 'A2OF'].filter(a => enriched.some(r => r.arm === a));
const LAYOUTS = ['delimited', 'blocks'].filter(l => enriched.some(r => r.layout === l));
const summaries = LAYOUTS.flatMap(l => ARMS.filter(a => enriched.some(r => r.arm === a && r.layout === l)).map(a => summary(a, l)));
const pairs = [];
for (const a of ARMS) if (LAYOUTS.length > 1) pairs.push(pair(a, 'blocks', a, 'delimited'));
for (const [a, b] of [['A1F', 'A2F'], ['A2OF', 'A2F'], ['A2OF', 'A1F'], ['A1F', 'A0'], ['A2F', 'A0'], ['A2OF', 'A0']]) if (ARMS.includes(a) && ARMS.includes(b)) pairs.push(pair(a, 'blocks', b, 'blocks'));
const result = { files, difficulty: D, seeds: SEEDS ? [...SEEDS] : null, units: rows.length, complete: complete.length, notComplete: rows.filter(r => r.status !== 'complete').map(r => r.unit), summaries, pairs };
if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 1));

const out = [`units ${result.units}, complete ${result.complete}${result.notComplete.length ? `; not complete: ${result.notComplete.join(', ')}` : ''}`, '',
  '| arm | layout | tasks pass | backlog pass | simple pass | $/task | $/backlog node | $/passing backlog node | backlog paths | passes by path | template picked | open stage used / passed | rounds | audit | violations | effects | proposals | max depth | node over | errors | wall s |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
const kv = o => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
for (const s of summaries) out.push(`| ${s.arm} | ${s.layout} | ${pct(s.taskPass, s.tasks)} | ${pct(s.backlogPass, s.backlogNodes)} | ${pct(s.simplePass, s.simpleNodes)} | ${s.costPerTask} | ${s.backlogCostPerNode} | ${s.costPerPassingBacklogNode ?? '-'} | ${kv(s.paths)} | ${kv(s.passByPath)} | ${kv(s.template)} | ${s.openUsed} / ${s.openPass} | ${kv(s.rounds)} | ${s.audit} | ${s.violations} | ${s.effects} | ${s.proposals} | ${s.maxDepth} | ${s.nodeOver} | ${kv(s.errors)} | ${s.wallSec} |`);
out.push('', '| a vs b (paired backlog nodes, same worlds) | worlds | both | only a | only b | neither | $ a | $ b |', '|---|---|---|---|---|---|---|---|');
for (const p of pairs) out.push(`| ${p.a} vs ${p.b} | ${p.worlds} | ${p.both} | ${p.onlyA} | ${p.onlyB} | ${p.neither} | ${p.costA} | ${p.costB} |`);
console.log(out.join('\n'));
