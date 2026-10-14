#!/usr/bin/env node
// The R0-K tables behind DEV-NOTES D32, from the committed mirror research/jit-20261008/runs/jit-r0-kinetics/ ($0, no model
// call, nothing under beds/sealed/ is read). Only the files stream.mjs writes are read: arm.json, results.jsonl, events.jsonl,
// traces/*.json (isolation counters only).
//   node r0k-tables.mjs [--runs <dir holding jit-r0-kinetics>] [--out r0k-tables.json] [--md r0k-tables.md]
// Development evidence only (dev seeds 225-248, K = 1, E1c kit 852ebdf05588de97, cloud container).
import path from 'node:path';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { mcnemarExact } = await import(path.join(REPO, 'experiments/jit/stats.mjs'));
const arg = (n, d = null) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const runs = path.resolve(arg('runs', path.join(REPO, 'research/jit-20261008/runs'))), dir = path.join(runs, 'jit-r0-kinetics');
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const sum = xs => xs.reduce((a, b) => a + b, 0), r3 = x => Math.round(x * 1000) / 1000, r1 = x => Math.round(x * 10) / 10;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const COMPILE = ['compileBuilder', 'compileGateway', 'compileCheck'];

const arms = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort().map(slug => {
  const a = path.join(dir, slug), meta = JSON.parse(readFileSync(path.join(a, 'arm.json'), 'utf8'));
  const traces = existsSync(path.join(a, 'traces')) ? readdirSync(path.join(a, 'traces')).map(f => JSON.parse(readFileSync(path.join(a, 'traces', f), 'utf8'))) : [];
  return { slug, meta, rows: readJsonl(path.join(a, 'results.jsonl')).sort((x, y) => x.idx - y.idx), events: readJsonl(path.join(a, 'events.jsonl')), traces };
});
const agent = arms.find(a => a.meta.kind === 'agent'), jit = arms.find(a => a.meta.kind === 'jit');

const armSummary = a => {
  const rows = a.rows, starts = rows.map(r => Date.parse(r.host.startedAt)), ends = rows.map(r => Date.parse(r.host.endedAt));
  const seg = Object.fromEntries([...new Set(rows.map(r => `d${r.difficulty}`))].map(g => { const rs = rows.filter(r => `d${r.difficulty}` === g); return [g, `${rs.filter(r => r.pass).length}/${rs.length}`]; }));
  const spend = a.events.filter(e => e.kind === 'spend'), unknown = spend.filter(e => e.costUnknown);
  const total = sum(rows.map(r => r.costUsd)), ok = rows.filter(r => r.pass).length;
  const lat = rows.map(r => r.latencyMs / 60000);
  const sessions = a.events.filter(e => e.kind === 'interpret' || (e.kind === 'compile-attempt'));
  return { arm: a.meta.spec, hash: a.meta.hash, done: rows.length, pass: ok, bySegment: seg, totalUsd: r3(total), imputedUsd: r3(sum(unknown.map(e => e.costUsd))), measuredUsd: r3(total - sum(unknown.map(e => e.costUsd))),
    usdPerSuccess: ok ? r3(total / ok) : null, usdPerTask: r3(total / rows.length),
    deliveredBy: rows.reduce((m, r) => (m[r.delivered] = (m[r.delivered] ?? 0) + 1, m), {}),
    firstStart: new Date(Math.min(...starts)).toISOString(), lastEnd: new Date(Math.max(...ends)).toISOString(), wallMin: r1((Math.max(...ends) - Math.min(...starts)) / 60000),
    taskMin: { p50: r1(q(lat, 0.5)), p95: r1(q(lat, 0.95)), max: r1(Math.max(...lat)), sum: r1(sum(lat)) },
    unknownCostRows: rows.filter(r => r.costUnknown).map(r => r.idx), unknownCostSpend: unknown.map(e => ({ idx: e.idx, component: e.component, usd: e.costUsd })),
    rowErrors: rows.filter(r => r.error).length, eventErrors: a.events.filter(e => e.error).length, retries: a.events.filter(e => e.kind === 'interpret' && e.attempt > 0).length,
    interpretSessions: a.events.filter(e => e.kind === 'interpret').length,
    isolation: { nestedModelAttempts: sum(a.events.map(e => e.nestedModelAttempts ?? 0)) + sum(a.events.filter(e => e.kind === 'compile-attempt').map(e => e.result.nestedModelAttempts ?? 0)),
      hiddenPathAttempts: sum(a.events.map(e => e.hiddenPathAttempts ?? 0)) + sum(a.events.filter(e => e.kind === 'compile-attempt').map(e => e.result.hiddenPathAttempts ?? 0)),
      outsidePathsReferencingHostCredentialDirs: a.traces.flatMap(t => t.outsidePaths ?? []).filter(p => /^\/home\/claude|^\/root\/\.ccr/.test(p)).length },
    sessionsLaunched: sessions.length };
};

const jitDetail = (() => {
  const rows = jit.rows, ev = jit.events, b = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.costBreakdown ?? {})) b[k] = (b[k] ?? 0) + v;
  const total = sum(rows.map(r => r.costUsd)), compile = sum(COMPILE.map(k => b[k] ?? 0));
  const attempts = ev.filter(e => e.kind === 'compile-attempt').map(e => { const x = e.result, c = x.checkTraces ?? {};
    return { idx: e.idx, version: x.version, builder: x.builderModel.replace('claude-', ''), usd: r3(x.costUsd), builderError: x.builderError, exact: `${c.exact}/${c.cases}`, partial: c.partial, clean: c.clean, accepted: c.accepted, failed: c.acceptance?.failed ?? [] }; });
  const byBuilder = {};
  for (const x of attempts) { const t = byBuilder[x.builder] ??= { attempts: 0, accepted: 0, usd: 0 }; t.attempts++; t.accepted += x.accepted ? 1 : 0; t.usd = r3(t.usd + x.usd); }
  const recompiles = ev.filter(e => e.kind === 'recompile').map(e => ({ idx: e.idx, version: e.version, reason: e.reason, builder: e.builderModel.replace('claude-', ''), accepted: e.accepted }));
  const compiled = ev.filter(e => e.kind === 'compiled').map(e => ({ idx: e.idx, version: e.version, status: e.status, deoptKind: e.deoptKind ?? null, usd: r3(e.costUsd) }));
  // Compile spend attributable to a regression-triggered recompile: the attempts at the same idx as that recompile event.
  const regRecompiles = recompiles.filter(x => x.reason === 'regression');
  const regCompileUsd = sum(regRecompiles.map(x => sum(rows.find(r => r.idx === x.idx) ? COMPILE.map(k => rows.find(r => r.idx === x.idx).costBreakdown?.[k] ?? 0) : [0])));
  const shadowRows = rows.filter(r => r.shadowTraceId);
  const compiledOk = compiled.filter(c => c.status === 'ok');
  const shadows = shadowRows.map(r => { const e = r.events.find(x => x.kind === 'shadow'), adj = r.events.find(x => x.kind === 'adjudicate');
    return { idx: r.idx, seed: r.seed, version: r.version, reason: r.shadowReason, draw: r3(r.shadowDraw), propensity: r.shadowPropensity, belowFloor: r.shadowDraw < 0.25, agree: e.agree, withinToleranceOnly: e.canonicalAgree === false && e.agree, flags: r.flags?.count ?? null,
      adjudication: adj?.outcome ?? null, compiledOraclePass: r.compiledPass ?? (r.delivered === 'compiled' ? r.pass : null), delivered: r.delivered, pass: r.pass, score: r.score, shadowUsd: r3(r.costBreakdown.shadow ?? 0), adjudicatorUsd: r3(r.costBreakdown.adjudicator ?? 0) }; });
  const steady = rows.filter(r => r.idx >= 3), nonCompile = r => r.costUsd - sum(COMPILE.map(k => r.costBreakdown?.[k] ?? 0));
  const last6 = rows.slice(-6), cap = ev.length ? 32 : null;
  const cum = []; let c = 0; for (const r of rows) { cum.push({ idx: r.idx, startCumUsd: r3(c), costUsd: r3(r.costUsd) }); c += r.costUsd; }
  return { breakdown: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, r3(v)])), compileUsd: r3(compile), compileSharePct: r1(100 * compile / total), nonCompileUsd: r3(total - compile),
    attempts, byBuilder, fallbacks: ev.filter(e => e.kind === 'fallback-compile').length, rechecks: ev.filter(e => e.kind === 'recheck').length, recompiles, adoptions: ev.filter(e => e.kind === 'adoption').map(e => ({ idx: e.idx, version: e.version, builder: e.builderModel.replace('claude-', ''), accepted: e.accepted })),
    compiled, deoptRate: r3(compiled.filter(c => c.status !== 'ok').length / compiled.length), compiledOk: compiledOk.length,
    regressionRecompileCompileUsd: r3(regCompileUsd), regressionRecompiles: regRecompiles.length,
    shadows, shadowUsd: r3(b.shadow ?? 0), adjudicatorUsd: r3(b.adjudicator ?? 0),
    effectiveShadowRate: { shadowed: shadows.length, compiledOk: compiledOk.length, rate: compiledOk.length ? r3(shadows.length / compiledOk.length) : null, floorDrawsBelow025: shadows.filter(s => s.belowFloor).length, flagForced: shadows.filter(s => /flag/.test(s.reason)).length },
    steadyState: { fromIdx: 3, tasks: steady.length, usdPerTaskExCompile: r3(sum(steady.map(nonCompile)) / steady.length), compiledRunsUsd: r3(sum(steady.map(r => r.costBreakdown?.compiled ?? 0))), interpreterFallbackUsd: r3(sum(steady.filter(r => r.compiledStatus && r.compiledStatus !== 'ok').map(r => r.costBreakdown?.interpreter ?? 0))),
      verificationUsd: r3(sum(steady.map(r => (r.costBreakdown?.shadow ?? 0) + (r.costBreakdown?.adjudicator ?? 0)))) },
    capStop: { armCapUsd: cap, lastTaskStartedAtCumUsd: cum.at(-1).startCumUsd, lastTaskUsd: cum.at(-1).costUsd, endCumUsd: r3(total), overshootUsd: r3(total - cap), last6MeanUsdPerTask: r3(sum(last6.map(r => r.costUsd)) / last6.length), meanUsdPerTask: r3(total / rows.length) },
    projection24: { linearUsd: r3(total / rows.length * 24), lowUsd: r3(total + 10 * sum(steady.map(nonCompile)) / steady.length), highUsd: r3(total + 10 * sum(last6.map(r => r.costUsd)) / last6.length) },
    projection24Min: { linear: r1((rows.reduce((s, r) => s + r.latencyMs, 0) / 60000) / rows.length * 24), last6: r1(rows.reduce((s, r) => s + r.latencyMs, 0) / 60000 + 10 * sum(last6.map(r => r.latencyMs / 60000)) / 6) },
    deliveredOracle: Object.fromEntries(['interpreter', 'compiled', 'adjudicated'].map(k => [k, `${rows.filter(r => r.delivered === k && r.pass).length}/${rows.filter(r => r.delivered === k).length}`])) };
})();

// Paired read on the tasks both arms finished (descriptive; K = 1; the JIT interpreter is Opus, the agent is Haiku).
const ay = new Map(agent.rows.map(r => [r.taskKey, r]));
const pairs = jit.rows.map(r => ({ idx: r.idx, taskKey: r.taskKey, jit: r.pass, agent: ay.get(r.taskKey).pass, jitUsd: r.costUsd, agentUsd: ay.get(r.taskKey).costUsd, jitDelivered: r.delivered, jitScore: r.score, agentScore: ay.get(r.taskKey).score }));
const jitOnly = pairs.filter(p => p.jit && !p.agent).length, agentOnly = pairs.filter(p => !p.jit && p.agent).length;
const paired = { n: pairs.length, both: pairs.filter(p => p.jit && p.agent).length, jitOnly, agentOnly, neither: pairs.filter(p => !p.jit && !p.agent).length, jitPass: pairs.filter(p => p.jit).length, agentPass: pairs.filter(p => p.agent).length,
  gapTasks: pairs.filter(p => p.jit).length - pairs.filter(p => p.agent).length, gapPoints: r1(100 * (pairs.filter(p => p.jit).length - pairs.filter(p => p.agent).length) / pairs.length), mcnemar: mcnemarExact(jitOnly, agentOnly),
  jitUsd: r3(sum(pairs.map(p => p.jitUsd))), agentUsd: r3(sum(pairs.map(p => p.agentUsd))), jitUsdPerSuccess: r3(sum(pairs.map(p => p.jitUsd)) / pairs.filter(p => p.jit).length), agentUsdPerSuccess: r3(sum(pairs.map(p => p.agentUsd)) / pairs.filter(p => p.agent).length), pairs };

const out = { experiment: 'jit-r0-kinetics', note: 'development evidence only: dev seeds 225-248, K = 1, E1c kit 852ebdf05588de97, cloud container', arms: { agent: armSummary(agent), jit: armSummary(jit) }, jit: jitDetail, paired };
const o = arg('out'); if (o) writeFileSync(path.resolve(o), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
