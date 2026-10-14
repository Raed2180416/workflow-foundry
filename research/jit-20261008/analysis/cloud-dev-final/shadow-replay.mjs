#!/usr/bin/env node
// $0 offline reconstruction of the dev-stream shadow pairs (DEV-NOTES D25). The dev streams ran before the tolerant
// comparator (jit.compare 'unordered'), and the row of a shadowed task does not keep the compiled answer. This rebuilds it
// and asks what the comparator would have decided:
//   1. the compiled answer: the archived solve.mjs of the version in force, run through run-compiled.mjs with a STRICT memo
//      port over only that run's model-call journal rows (createMemoPort, no live port: a request the journal cannot answer
//      throws REPLAY_MISS, so no model is ever called). Fidelity check: the replayed answer's oracle score must equal the
//      row's archived score (and `misses` must be 0).
//   2. the shadow and adjudicator answers: the archived traces (traces/<id>.json, .answer).
//   3. the stream's own decision rule (stream.mjs: shadow agrees -> done; else adjudicator ~ compiled -> 'compiled',
//      adjudicator ~ shadow -> 'interpreter' (deliver the shadow), else 'none' = unresolved) under sameAnswer() in the mode
//      the stream ran ('unordered') and under 'tolerant' at several relTol with tolerantKeys (default vmax,km; the exclusion
//      list stays exact), plus the pairwise numeric distances and the oracle score of each of the three answers.
// The bed oracle is used on dev seeds only, to score (experimenter's view), as the dev notes allow. No model calls.
//
// usage: node shadow-replay.mjs --runs <dir with the stream dirs> --experiment jit-dev-kinetics-1 [--family kinetics]
//          [--work <scratch dir>] [--out shadow-replay.json] [--tol 0.01,0.02,0.05] [--keys vmax,km]
//   <runs>/<experiment>/<arm>/ is the container layout (journal.sqlite, versions/) or the committed mirror
//   (research/jit-20261008/runs/<experiment>/<arm>/: journal.jsonl, solvers/). A journal.sqlite is copied to the work dir
//   before it is opened, so the original (and any -wal/-shm beside it) is never touched.
import path from 'node:path';
import os from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const imp = rel => import(path.join(REPO, rel));
const { journalToJsonl, sameAnswer } = await imp('experiments/jit/stream.mjs');
const { createMemoPort, runCompiled, DEFAULT_FLOW } = await imp('experiments/jit/run-compiled.mjs');
const { makeTasks, score } = await imp('experiments/lib/beds.mjs');

const arg = (n, d = null) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const runs = path.resolve(arg('runs', path.join(REPO, 'experiments/runs/jit'))), experiment = arg('experiment');
if (!experiment) { console.error('usage: node shadow-replay.mjs --runs <dir> --experiment <jit-dev-kinetics-1> [--family kinetics] [--work dir] [--out file] [--tol 0.01,0.02,0.05] [--keys vmax,km]'); process.exit(2); }
const family = arg('family', 'kinetics'), tols = arg('tol', '0.01,0.02,0.05').split(',').map(Number), keys = arg('keys', 'vmax,km').split(',');
const work = path.resolve(arg('work', mkdtempSync(path.join(os.tmpdir(), 'shadow-replay-')))); mkdirSync(work, { recursive: true });
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

const modes = [['unordered (as run)', 'unordered', {}], ...tols.map(t => [`tolerant rel ${t}`, 'tolerant', { relTol: t, absTol: 1e-9, tolerantKeys: keys }])];
const decide = (C, S, A, mode, tol) => {
  const eq = (a, b) => sameAnswer(a, b, mode, tol);
  if (eq(S, C)) return 'agree (no adjudicator call)';
  if (A != null && eq(A, C)) return 'compiled wins (adjudicator ~ compiled)';
  if (A != null && eq(A, S)) return 'interpreter wins (deliver shadow, regression)';
  return 'none (unresolved, compiled delivered)';
};
// Largest relative difference over the fitted keys (aligned by condition_id) and the exclusion-list difference.
const dist = (X, Y) => {
  const mx = new Map(Y.conditions.map(c => [c.condition_id, c]));
  let worst = 0, at = null;
  for (const c of X.conditions) { const d = mx.get(c.condition_id); if (!d) continue; for (const k of keys) { const r = Math.abs(c[k] - d[k]) / Math.max(Math.abs(c[k]), Math.abs(d[k]), 1e-300); if (r > worst) { worst = r; at = `${c.condition_id}.${k}`; } } }
  const ex = new Set(X.excluded_samples), ey = new Set(Y.excluded_samples);
  return { maxRel: +worst.toExponential(3), at, exclusionDiff: [...ex].filter(s => !ey.has(s)).concat([...ey].filter(s => !ex.has(s))) };
};

const out = { experiment, family, runs, tolerantKeys: keys, cases: [] };
const expDir = path.join(runs, experiment);
for (const d of readdirSync(expDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name.startsWith('jit-')).map(d => d.name).sort()) {
  const armDir = path.join(expDir, d), rows = readJsonl(path.join(armDir, 'results.jsonl'));
  // The journal as JSON lines: from the sqlite (copied first) or the mirror's journal.jsonl.
  let jsonl;
  if (existsSync(path.join(armDir, 'journal.sqlite'))) {
    const tmp = path.join(work, 'journals', d); mkdirSync(tmp, { recursive: true });
    copyFileSync(path.join(armDir, 'journal.sqlite'), path.join(tmp, 'journal.sqlite'));
    for (const ext of ['-wal', '-shm']) if (existsSync(path.join(armDir, `journal.sqlite${ext}`))) copyFileSync(path.join(armDir, `journal.sqlite${ext}`), path.join(tmp, `journal.sqlite${ext}`));
    jsonl = journalToJsonl(path.join(tmp, 'journal.sqlite'), { maxBodyBytes: Infinity });
  } else jsonl = readFileSync(path.join(armDir, 'journal.jsonl'), 'utf8');
  const jrows = jsonl.split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const row of rows.filter(r => (r.events ?? []).some(e => e.kind === 'shadow' && e.agree === false) && r.shadowTraceId)) {
    const label = `${d.replace(/^jit-claude-/, '').replace(/--claude-haiku-5-5$/, '')}/H ${row.taskKey.split(':').pop()}`.replace(/^(\w+)-5-5\/H/, (m, a) => `${a[0].toUpperCase()}/H`);
    const prefix = `${row.experiment}:${row.armSlug}:${row.idx}:`;
    const mine = jrows.filter(j => j.runId.startsWith(prefix));
    const dir = path.join(work, 'replay', `${d}-${row.idx}`); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'journal.jsonl'), mine.map(j => JSON.stringify(j)).join('\n') + '\n');
    const verDir = row.stateAfter.version.dir.replace(/^versions\//, ''), solve = [path.join(armDir, 'versions', verDir, 'solve.mjs'), path.join(armDir, 'solvers', verDir, 'solve.mjs')].find(existsSync);
    const m = /^(.+):([a-z]+):d(\d+):s(\d+)$/.exec(row.taskKey), [t] = await makeTasks(m[1], { split: m[2], seeds: [Number(m[4])], difficulty: Number(m[3]) });
    const port = createMemoPort({ journal: path.join(dir, 'journal.jsonl'), strict: true });   // no live port
    const r = await runCompiled({ solvePath: solve, task: t.task, modelPort: port, perTaskUsd: 1, timeoutMs: 600000, workdir: path.join(dir, 'work'), familyId: m[1], flowPath: DEFAULT_FLOW, label: 'replay' });
    const st = port.memo.stats(), sc = async X => { const v = X ? await score(m[1], t.task, X) : null; return v ? { pass: v.pass, score: v.score } : null; };
    const trace = id => JSON.parse(readFileSync(path.join(armDir, 'traces', `${id}.json`), 'utf8')).answer;
    const C = r.output, S = trace(row.shadowTraceId), A = row.adjudicatorTraceId ? trace(row.adjudicatorTraceId) : null;
    const c = { case: label, idx: row.idx, taskKey: row.taskKey, version: row.version, solver: verDir, archived: { delivered: row.delivered, pass: row.pass, score: row.score, shadowUsd: row.costBreakdown?.shadow, adjudicatorUsd: row.costBreakdown?.adjudicator },
      replay: { status: r.status, journalRows: mine.length, requests: st.requests, hits: st.hits, misses: st.misses, costUsd: r.costUsd, scoreMatchesArchived: C != null && (await sc(C))?.score === row.score },
      oracle: { compiled: C ? await sc(C) : null, shadow: await sc(S), adjudicator: A ? await sc(A) : null }, distance: C ? { 'compiled-shadow': dist(C, S), 'compiled-adjudicator': A ? dist(C, A) : null, 'shadow-adjudicator': A ? dist(S, A) : null } : null,
      decision: C ? Object.fromEntries(modes.map(([lab, mode, tol]) => [lab, decide(C, S, A, mode, tol)])) : null, answers: { compiled: C, shadow: S, adjudicator: A } };
    out.cases.push(c);
    console.log(`${label} (idx ${row.idx}, v${row.version} ${verDir}): replay ${r.status}, ${st.hits}/${st.requests} journal hits, ${st.misses} misses, $${r.costUsd}, score ${c.oracle.compiled?.score} vs archived ${row.score} -> ${c.replay.scoreMatchesArchived ? 'MATCH' : 'MISMATCH'}`);
    console.log(`   oracle  compiled ${JSON.stringify(c.oracle.compiled)} shadow ${JSON.stringify(c.oracle.shadow)} adjudicator ${JSON.stringify(c.oracle.adjudicator)}`);
    if (c.distance) for (const [k, v] of Object.entries(c.distance)) if (v) console.log(`   dist ${k}: max rel ${v.maxRel} at ${v.at}; exclusion-list difference ${JSON.stringify(v.exclusionDiff)}`);
    if (c.decision) for (const [k, v] of Object.entries(c.decision)) console.log(`   ${k.padEnd(22)} ${v}`);
  }
}
const o = arg('out');
if (o) writeFileSync(path.resolve(o), JSON.stringify(out, null, 1));
