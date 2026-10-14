#!/usr/bin/env node
// Faults and arm-stop review of a finished stream run (R0-RUNBOOK section 3 step 1, "faults.jsonl reviewed"), from the
// committed mirror research/jit-20261008/runs/jit-r0-kinetics/ and the process log copy beside this file. $0, read-only.
//   node faults-review.mjs [--runs <dir holding jit-r0-kinetics>] [--out faults-review-jit-r0-kinetics.json]
// A fault row is written to <arm>/faults.jsonl by stream.mjs when an environment fault stops a task; a mirror carries the
// file only if it exists. EXECUTOR_TIMEOUT is not in the engine's ENV_FAULTS set (stream.mjs), so a timed-out session is a
// costUnknown spend booked at its budget bound, not a fault row: this review lists every such booking separately.
import path from 'node:path';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../../../..');
const arg = (n, d = null) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const dir = path.join(path.resolve(arg('runs', path.join(REPO, 'research/jit-20261008/runs'))), 'jit-r0-kinetics');
const rj = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const r3 = x => Math.round(x * 1000) / 1000, sum = xs => xs.reduce((a, b) => a + b, 0);
const count = xs => xs.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

const arms = {};
for (const slug of readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
  const a = path.join(dir, slug), rows = rj(path.join(a, 'results.jsonl')), ev = rj(path.join(a, 'events.jsonl'));
  const attempts = ev.filter(e => e.kind === 'compile-attempt').map(e => e.result);
  const interpret = ev.filter(e => e.kind === 'interpret');
  const unknown = ev.filter(e => e.kind === 'spend' && e.costUnknown === true);
  const hidden = { interpret: interpret.map(e => e.hiddenPathAttempts ?? 0), compileBuilder: attempts.map(x => x.hiddenPathAttempts ?? 0) };
  arms[slug] = {
    faultsJsonlInMirror: existsSync(path.join(a, 'faults.jsonl')), faultRows: rj(path.join(a, 'faults.jsonl')).length,
    rows: rows.length, rowsWithError: rows.filter(r => r.error).length, rowsCostUnknown: rows.filter(r => r.costUnknown).map(r => r.idx),
    eventsWithError: ev.filter(e => e.error).length,
    costUnknownBookings: unknown.map(e => ({ idx: e.idx, component: e.component, imputedUsd: e.costUsd, at: e.at })),
    interpretSessions: count(interpret.map(e => `${e.role ?? 'interpreter'}/${e.model}/error=${e.error ?? 'none'}/attempt=${e.attempt ?? 0}`)),
    compileAttempts: attempts.map(x => ({ version: x.version, builder: x.builderModel, builderError: x.builderError ?? null, checkError: x.checkError ?? null, costUsd: r3(x.costUsd), accepted: x.checkTraces?.accepted ?? null })),
    rechecks: ev.filter(e => e.kind === 'recheck').map(e => ({ idx: e.idx, version: e.version, reason: e.reason, budgetDeopts: e.budgetDeopts })),
    unresolved: ev.filter(e => e.kind === 'unresolved').map(e => ({ idx: e.idx, version: e.version })),
    hiddenPathAttempts: { interpretShadowAdjudicator: sum(hidden.interpret), sessionsWithAny: hidden.interpret.filter(Boolean).length, sessions: hidden.interpret.length, compileBuilder: sum(hidden.compileBuilder), attemptsWithAny: hidden.compileBuilder.filter(Boolean).length, attempts: hidden.compileBuilder.length },
    nestedModelAttempts: sum(ev.map(e => e.nestedModelAttempts ?? 0)) + sum(attempts.map(x => x.nestedModelAttempts ?? 0)),
  };
}

// The arm-stop record lives only in the process log (a SpendStop is a control-flow stop, not a fault row).
const log = readFileSync(path.join(HERE, 'stream-log-jit-r0-kinetics.txt'), 'utf8');
const j = log.lastIndexOf('\n[\n') + 1, summary = JSON.parse(log.slice(j));
const jitSlug = Object.keys(arms).find(s => s.startsWith('jit-')), jitRows = rj(path.join(dir, jitSlug, 'results.jsonl'));
const totalUsd = sum(jitRows.map(r => r.costUsd)), imputedUsd = sum(arms[jitSlug].costUnknownBookings.map(b => b.imputedUsd));
const cap = 32;
const armStop = {
  logSummary: summary.map(s => ({ spec: s.spec, done: s.done, faults: s.faults, errors: s.errors })),
  capUsd: cap, capSource: 'configs/r0-kinetics-cloud.json (ENGINE-FREEZE section 6): O/H 32, agent 5, spendStopUsd 40',
  recordedSpendUsd: r3(totalUsd), imputedInsideIt: r3(imputedUsd), measuredSpendUsd: r3(totalUsd - imputedUsd),
  stopFiredOnRecordedSpend: totalUsd > cap, stopWouldHaveFiredOnMeasuredSpendOnly: totalUsd - imputedUsd > cap,
  lastTaskStarted: { idx: jitRows.at(-1).idx, startedAtCumUsd: r3(totalUsd - jitRows.at(-1).costUsd), taskUsd: r3(jitRows.at(-1).costUsd) },
  overshootUsd: r3(totalUsd - cap), tasksNotRun: 24 - jitRows.length,
  where: 'stream-log-jit-r0-kinetics.txt (the stop is not written to events.jsonl or faults.jsonl); the check runs when a task starts (stream.mjs begin())',
};
const out = { experiment: 'jit-r0-kinetics', arms, armStop };
const o = arg('out'); if (o) writeFileSync(path.resolve(o), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
