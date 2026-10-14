#!/usr/bin/env node
// Final per-arm figures of a JIT dev stream (DEV-NOTES D25), from the files stream.mjs writes (arm.json, results.jsonl,
// events.jsonl, faults.jsonl), on top of experiments/jit/report.mjs (summarizeArm). Adds what report.mjs does not show:
//  - spend that never reached a row (an attempt in flight at an environment fault), split into compile and other, and the
//    compile share of the total *including* it;
//  - compile attempts tallied from events.jsonl (report.mjs counts only events inside finished rows, so the compile of an
//    unfinished task is missing from its counts), by builder: attempts, accepted, clean, dollars, best mean partial;
//  - per adopted version: who built it, whether the host check accepted it, how many compiled deliveries it made and passed;
//  - fault events by code, with their times (the first and the last tell a burst from a stop).
// usage: node arm-tables.mjs --runs <dir> --experiment jit-dev-records-1 [--out file.json]
//   <runs>/<experiment> is the container layout (experiments/runs/jit) or the committed mirror (research/jit-20261008/runs).
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const { loadRun, summarizeArm, buildReport } = await import(path.join(REPO, 'experiments/jit/report.mjs'));
const arg = (n, d = null) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const runs = path.resolve(arg('runs', path.join(REPO, 'experiments/runs/jit'))), experiment = arg('experiment');
if (!experiment) { console.error('usage: node arm-tables.mjs --runs <dir> --experiment <jit-dev-records-1> [--out file.json]'); process.exit(2); }
const COMPILE = ['compileBuilder', 'compileGateway', 'compileCheck'], r3 = x => Math.round(x * 1000) / 1000;
const out = [], runDir = path.join(runs, experiment), envByArm = Object.fromEntries(buildReport(runDir).arms.map(x => [x.spec, x.envFaults]));
for (const a of loadRun(runDir)) {
  const s = summarizeArm(a), b = s.costBreakdown;
  const billed = new Set(a.rows.flatMap(r => r.spendIds ?? []));
  const un = {}; for (const e of a.events) if (e.kind === 'spend' && !billed.has(e.id)) un[e.component] = (un[e.component] ?? 0) + e.costUsd;
  const compRows = COMPILE.reduce((t, k) => t + (b[k] ?? 0), 0), compUn = COMPILE.reduce((t, k) => t + (un[k] ?? 0), 0);
  const segs = [...new Set(a.rows.map(r => r.taskKey.split(':')[2]))].sort();
  const imputed = a.rows.flatMap(r => (r.events ?? []).filter(e => e.kind === 'interpret' && e.error === 'EXECUTOR_TIMEOUT' && e.costUsd)).reduce((t, e) => t + e.costUsd, 0);
  const attempts = {}, adoptions = [];
  for (const e of a.events) {
    if (e.kind === 'compile-attempt') {
      const x = e.result, c = x.checkTraces ?? {}, k = x.builderModel.replace('claude-', ''), t = attempts[k] ??= { attempts: 0, accepted: 0, clean: 0, usd: 0, bestPartial: 0 };
      t.attempts++; t.accepted += c.accepted ? 1 : 0; t.clean += c.clean ? 1 : 0; t.usd += x.costUsd ?? 0; t.bestPartial = Math.max(t.bestPartial, c.partial ?? 0);
    }
    if (e.kind === 'compile' || e.kind === 'recompile') adoptions.push({ idx: e.idx, version: e.version, builder: e.builderModel.replace('claude-', ''), accepted: e.accepted, clean: e.clean });
  }
  for (const v of adoptions) {
    const rs = a.rows.filter(r => r.delivered === 'compiled' && r.version === v.version);
    v.compiledDelivered = rs.length; v.compiledPassed = rs.filter(r => r.pass).length;
  }
  const faults = a.faults.map(f => ({ at: f.at, idx: f.idx, component: f.component, code: f.error?.code ?? f.builderError?.code ?? Object.keys(f.metaErrors ?? {})[0] ?? 'unknown' }));
  const seg = Object.fromEntries(segs.map(g => { const rs = a.rows.filter(r => r.taskKey.split(':')[2] === g); return [g, `${rs.filter(r => r.pass).length}/${rs.length}`]; }));
  const c = s.counts, planned = 24;
  out.push({
    arm: s.spec.replace(/^static:.*\/([^/]+)\/solve\.mjs$/, 'static:$1'), done: `${s.tasks}/${planned}`, pass: `${s.successes}/${s.tasks}`, bySegment: seg,
    totalUsd: r3(s.totalUsd), usdPerSuccess: s.usdPerSuccess == null ? null : r3(s.usdPerSuccess), usdPerTask: r3(s.usdPerTask), unfinishedUsd: r3(s.unbilledUsd), imputedUsd: r3(imputed),
    compileUsd: r3(compRows + compUn), compileUnfinishedUsd: r3(compUn), compileSharePct: s.totalUsd ? Math.round(((compRows + compUn) / s.totalUsd) * 1000) / 10 : 0,
    deliveredBy: s.deliveredBy, deopts: c.deoptsByKind, shadows: c.shadows, disagreements: c.disagreements, adjudications: c.adjudications, unresolved: c.unresolved, regressions: c.regressions,
    versions: s.versions, compileAttempts: Object.fromEntries(Object.entries(attempts).map(([k, v]) => [k, { ...v, usd: r3(v.usd) }])), adopted: adoptions,
    faults: { events: faults.length, byCode: faults.reduce((m, f) => (m[f.code] = (m[f.code] ?? 0) + 1, m), {}), first: faults[0]?.at ?? null, last: faults.at(-1)?.at ?? null, lastComponent: faults.at(-1)?.component ?? null },
    envRule: envByArm[s.spec] ? { planned: envByArm[s.spec].planned, impaired: envByArm[s.spec].impaired, unresolved: envByArm[s.spec].unresolved.length, rate: envByArm[s.spec].impairedRate, verdict: envByArm[s.spec].verdict } : null,
  });
}
console.log(JSON.stringify(out, null, 1));
if (arg('out')) writeFileSync(path.resolve(arg('out')), JSON.stringify(out, null, 1));
