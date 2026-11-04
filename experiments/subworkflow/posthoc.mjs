#!/usr/bin/env node
// SW-1 post-hoc tables (analysis side; not part of the frozen pipeline, which is analyze.mjs). Everything is re-derived
// from the stored answers and the bed:
//   1. the deciding arms' decisions (A1, A2): sub-workflow vs answer, on backlog and simple nodes, per difficulty, and
//      the pass rate of each (decision, kind) cell, with the node's stated reasons for answering backlogs directly;
//   2. efficiency on nodes that need no sub-workflow (owner A5: "don't dumb down the efficiency of the model"): simple
//      nodes' $ and wall time per arm vs A0 on the same node, and the d3 stratum;
//   3. the parent-directed arms' sub-workflow anatomy: rounds to a passing spec, round kinds, template picked, the
//      request's named inputs and granted budget (A2F), and the spend split (node calls / builder calls / child run);
//   4. where each arm's backlog failures come from (path x failure class, failures.mjs classes).
//   node experiments/subworkflow/posthoc.mjs --results <results.jsonl>[,...] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import * as bed from '../../beds/golive/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const last = new Map();
for (const f of (args.results ?? '').split(',').filter(Boolean)) for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  if (r.status === 'complete') last.set(r.unit, r);
  else if (!last.has(r.unit) || last.get(r.unit).status !== 'complete') last.set(r.unit, r);
}
const rows = [...last.values()].filter(r => r.status === 'complete');
const r6 = x => Math.round(x * 1e6) / 1e6, mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const nodes = rows.flatMap(r => {
  const t = bed.generate({ seed: r.seed, split: r.split, difficulty: r.difficulty });
  return r.nodes.map(n => ({ ...n, arm: r.arm, d: r.difficulty, seed: r.seed, world: `${r.difficulty}:${r.seed}`, pass: n.answer ? bed.nodeOracle(t, n.channel, n.answer).pass : false }));
});
const by = (xs, f) => xs.reduce((m, x) => { const k = f(x); (m[k] ??= []).push(x); return m; }, {});
const out = {};

// 1. decisions
out.decisions = {};
for (const arm of ['A1', 'A2']) for (const [d, xs] of Object.entries(by(nodes.filter(n => n.arm === arm), n => `d${n.d}`))) {
  const cell = {};
  for (const n of xs) { const k = `${n.kind}:${n.decision ?? 'error'}`; cell[k] ??= { n: 0, pass: 0 }; cell[k].n++; cell[k].pass += n.pass ? 1 : 0; }
  out.decisions[`${arm} ${d}`] = cell;
}
out.directBacklogReasons = nodes.filter(n => ['A1', 'A2'].includes(n.arm) && n.kind === 'backlog' && n.decision === 'answer').map(n => ({ arm: n.arm, d: n.d, seed: n.seed, pass: n.pass, reason: n.reason }));

// 2. efficiency on nodes that need no sub-workflow: simple nodes vs A0 on the same node
out.simpleNodes = {};
const a0 = new Map(nodes.filter(n => n.arm === 'A0').map(n => [`${n.world}:${n.channel}`, n]));
for (const [arm, xs] of Object.entries(by(nodes.filter(n => n.kind === 'simple'), n => n.arm))) {
  const paired = xs.filter(n => a0.has(`${n.world}:${n.channel}`));
  out.simpleNodes[arm] = { n: xs.length, pass: xs.filter(n => n.pass).length, paths: Object.fromEntries(Object.entries(by(xs, n => n.path ?? 'error')).map(([k, v]) => [k, v.length])),
    meanUsd: r6(mean(xs.map(n => n.costUsd))), ratioToA0: paired.length ? r6(paired.reduce((s, n) => s + n.costUsd, 0) / paired.reduce((s, n) => s + a0.get(`${n.world}:${n.channel}`).costUsd, 0)) : null,
    meanCallMs: Math.round(mean(xs.map(n => (n.callLog ?? []).reduce((s, c) => s + (c.ms ?? 0), 0))) ?? 0) };
}
out.d3 = {};
for (const [arm, xs] of Object.entries(by(nodes.filter(n => n.d === 3), n => n.arm))) {
  out.d3[arm] = { nodes: xs.length, pass: xs.filter(n => n.pass).length, backlogPass: `${xs.filter(n => n.kind === 'backlog' && n.pass).length}/${xs.filter(n => n.kind === 'backlog').length}`,
    usd: r6(xs.reduce((s, n) => s + n.costUsd, 0)), paths: Object.fromEntries(Object.entries(by(xs, n => `${n.kind}:${n.path ?? 'error'}`)).map(([k, v]) => [k, v.length])) };
}

// 3. sub-workflow anatomy (backlog nodes that went to a sub-workflow or fell back)
out.anatomy = {};
for (const [arm, xs] of Object.entries(by(nodes.filter(n => n.kind === 'backlog' && n.sub), n => n.arm))) {
  const kinds = {}; for (const n of xs) for (const r of n.rounds ?? []) kinds[r.kind ?? '?'] = (kinds[r.kind ?? '?'] ?? 0) + 1;
  const split = xs.map(n => {
    const builder = (n.callLog ?? []).filter(c => /^(build|builder|tpl)\./.test(c.key)).reduce((s, c) => s + c.costUsd, 0);
    const own = (n.callLog ?? []).filter(c => !/^(build|builder|tpl)\./.test(c.key)).reduce((s, c) => s + c.costUsd, 0);
    return { builder, own, child: n.costUsd - builder - own };
  });
  out.anatomy[arm] = { nodes: xs.length, subworkflow: xs.filter(n => n.path === 'subworkflow').length, fallback: xs.filter(n => n.path === 'fallback').length,
    roundsToPass: Object.fromEntries(Object.entries(by(xs.filter(n => n.path === 'subworkflow'), n => n.rounds?.length ?? 0)).map(([k, v]) => [k, v.length])),
    roundKinds: kinds, template: Object.fromEntries(Object.entries(by(xs.filter(n => n.sub?.select), n => n.sub.select.template)).map(([k, v]) => [k, v.length])),
    requestInputs: Object.fromEntries(Object.entries(by(xs.filter(n => n.sub?.request?.inputs), n => [...n.sub.request.inputs].sort().join('+'))).map(([k, v]) => [k, v.length])),
    grantedUsd: r6(mean(xs.map(n => n.sub?.request?.grantedUsd).filter(x => typeof x === 'number')) ?? 0),
    meanUsd: { own: r6(mean(split.map(s => s.own))), builder: r6(mean(split.map(s => s.builder))), child: r6(mean(split.map(s => s.child))) },
    passBySubPath: Object.fromEntries(Object.entries(by(xs, n => n.path)).map(([k, v]) => [k, `${v.filter(n => n.pass).length}/${v.length}`])) };
}

// 4. backlog failures by path and class (status = a judged label, cents = conversion/amount, missing/extra = the set)
out.failures = {};
for (const n of nodes.filter(x => x.kind === 'backlog' && !x.pass)) {
  const o = n.oracle ?? {};
  const cls = !n.answer ? `no-answer:${n.error?.code ?? '?'}` : o.shape ? `shape:${o.shape}` : [o.fieldErr?.status && 'status', o.fieldErr?.usd_cents && 'cents', o.fieldErr?.placed && 'placed',
    o.missing?.length && 'missing', o.extra?.length && 'extra', (o.qMissing?.length || o.qExtra?.length) && 'quarantine', o.totalsOk === false && !o.fieldErr?.usd_cents && !o.missing?.length && !o.extra?.length && 'totals'].filter(Boolean).join('+') || 'other';
  const k = `${n.arm} d${n.d}`;
  (out.failures[k] ??= []).push({ seed: n.seed, channel: n.channel, path: n.path, cls, wrong: o.wrong?.length ?? null, missing: o.missing?.length ?? null, extra: o.extra?.length ?? null });
}
// 5. cost under cache-neutral pricing (--journal): the CLI books most input as prompt-cache writes (1.25x) and some as
// cache reads (0.1x); a later arm can read a prefix an earlier arm wrote (same system prompt and node context). Reprice
// every journaled call of a unit with all input at the base rate (policy price: $0.10 / $0.50 per MTok), so arm costs do
// not depend on run order. Per arm: actual journaled $ and cache-neutral $ over its complete units, by stratum.
if (args.journal) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(args.journal, { readOnly: true });
  const q = db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS actual, COALESCE(SUM((input_tokens + COALESCE(cache_read_tokens,0) + COALESCE(cache_write_tokens,0)) * 0.1e-6 + output_tokens * 0.5e-6),0) AS neutral, COALESCE(SUM(cache_read_tokens),0) AS cr, COALESCE(SUM(cache_write_tokens),0) AS cw FROM model_calls WHERE run_id = ?');
  out.costs = {};
  for (const r of rows) {
    const c = q.get(r.runId), k = `${r.arm} ${r.difficulty >= 4 ? 'P' : `d${r.difficulty}`}`;
    const s = (out.costs[k] ??= { units: 0, actual: 0, neutral: 0, cacheRead: 0, cacheWrite: 0 });
    s.units++; s.actual += c.actual; s.neutral += c.neutral; s.cacheRead += c.cr; s.cacheWrite += c.cw;
  }
  for (const s of Object.values(out.costs)) { s.actual = r6(s.actual); s.neutral = r6(s.neutral); s.perUnitActual = r6(s.actual / s.units); s.perUnitNeutral = r6(s.neutral / s.units); }
}
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, (k, v) => (k === 'directBacklogReasons' ? v.map(x => `${x.arm} d${x.d} s${x.seed} pass=${x.pass}: ${x.reason}`) : v), 1));
