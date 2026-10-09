#!/usr/bin/env node
// replay-coverage.mjs (S0-2; FG P1 item 4): can a persisted call journal replay a compiled solver at $0?
//
//   node experiments/jit/replay-coverage.mjs <journal.jsonl> <solve.mjs> <task.json> [--flow v2|v1|<path>] [--family <id>]
//        [--workdir <dir>] [--timeout-s 600] [--per-task-usd 1] [--json]
//
// Replays one task through runCompiled with a strict memo port (run-compiled.mjs createMemoPort: no live port, so a
// request the journal cannot answer fails with REPLAY_MISS and nothing is spent) and reports the hit and miss counts and
// coverage = served / requested. FG P1's rule: under 90% coverage, the "$0 replays" planned on this journal are capped
// live re-runs instead. A strict miss usually ends the run (the judge escalates, then deopts), so later calls are never
// requested: a run stopped by a miss is never called a $0 replay, whatever its coverage so far.
// task.json is the task ({prompt, inputs, files?}) or a record holding one under .task. --family validates the output
// against that bed's outputSchema (never the oracle). No model calls; the sandbox is runCompiled's.
import path from 'node:path';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCompiled, createMemoPort, DEFAULT_FLOW, FLOW_V2 } from './run-compiled.mjs';

export const COVERAGE_BAR = 0.9;
const WORK_ROOT = '/var/tmp/foundry-work/replay-coverage';

// The FG P1 verdict for one replayed task.
export function coverageVerdict(stats, run) {
  const stoppedByMiss = stats.misses > 0 && run?.status !== 'ok' && run?.status !== 'invalid';
  const pct = stats.coverage == null ? 'n/a' : `${(stats.coverage * 100).toFixed(1)}%`;
  if (stats.requests === 0) return { replayable: true, stoppedByMiss: false, text: `$0 replay: the solver made no model calls (status ${run?.status})` };
  if (stats.coverage >= COVERAGE_BAR && !stoppedByMiss) return { replayable: true, stoppedByMiss, text: `$0 replay: coverage ${pct} >= ${COVERAGE_BAR * 100}% (${stats.hits + stats.reused}/${stats.requests} served from the journal)` };
  const why = stats.coverage < COVERAGE_BAR ? `coverage ${pct} < ${COVERAGE_BAR * 100}%` : `coverage ${pct} so far, but the run stopped on a journal miss (status ${run?.status})`;
  return { replayable: false, stoppedByMiss, text: `capped live re-run: ${why}; under FG P1, "$0 replays" on this journal are capped live re-runs` };
}

export async function replayCoverage({ journal, solvePath, task, flowPath = FLOW_V2, familyId = null, outputSchema = null, workdir, timeoutMs = 10 * 60 * 1000,
  perTaskUsd = 1, runner = runCompiled }) {
  const port = createMemoPort({ journal, strict: true });
  const run = await runner({ solvePath, task, modelPort: port, perTaskUsd, timeoutMs, workdir, familyId, outputSchema, flowPath, label: 'replay-coverage' });
  const stats = port.memo.stats();
  return { stats, run: { status: run.status, deopt: run.deopt ?? null, error: run.error ?? null, costUsd: run.costUsd ?? 0 }, verdict: coverageVerdict(stats, run) };
}

export function parseArgs(argv) {
  const o = { positional: [], flow: 'v2', family: null, workdir: null, timeoutS: 600, perTaskUsd: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--flow') { o.flow = v; i++; } else if (a === '--family') { o.family = v; i++; } else if (a === '--workdir') { o.workdir = v; i++; }
    else if (a === '--timeout-s') { o.timeoutS = Number(v); i++; } else if (a === '--per-task-usd') { o.perTaskUsd = Number(v); i++; }
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.positional.push(a);
  }
  if (o.positional.length !== 3) throw new Error('usage: replay-coverage.mjs <journal.jsonl> <solve.mjs> <task.json> [--flow v2|v1|<path>] [--family <id>] [--workdir <dir>] [--timeout-s 600] [--per-task-usd 1] [--json]');
  if (!(o.timeoutS > 0) || !(o.perTaskUsd > 0)) throw new Error('--timeout-s and --per-task-usd must be positive numbers');
  return o;
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const o = parseArgs(argv);
  const [journal, solvePath, taskFile] = o.positional.map(p => path.resolve(p));
  const raw = JSON.parse(readFileSync(taskFile, 'utf8')), task = raw?.task && typeof raw.task === 'object' ? raw.task : raw;
  const flowPath = o.flow === 'v2' ? FLOW_V2 : o.flow === 'v1' ? DEFAULT_FLOW : path.resolve(o.flow);
  let workdir = o.workdir;
  if (!workdir) { mkdirSync(WORK_ROOT, { recursive: true }); workdir = mkdtempSync(path.join(WORK_ROOT, 'run-')); }
  const r = await replayCoverage({ journal, solvePath, task, flowPath, familyId: o.family, workdir, timeoutMs: o.timeoutS * 1000, perTaskUsd: o.perTaskUsd });
  if (o.json) log(JSON.stringify({ ...r, workdir }, null, 1));
  else {
    const s = r.stats;
    log(`requests ${s.requests}  hits ${s.hits} (by the loose key ${s.looseHits})  reused ${s.reused}  misses ${s.misses}  coverage ${s.coverage == null ? 'n/a' : (s.coverage * 100).toFixed(1) + '%'}  (journal rows ${s.journalRows}, unservable ${s.skippedRows})`);
    log(`run: ${r.run.status}${r.run.deopt ? ` (deopt ${r.run.deopt.kind}:${r.run.deopt.name ?? '?'})` : ''}  workdir ${workdir}`);
    for (const m of s.missed.slice(0, 10)) log(`  miss ${m.model} ${m.digest.slice(0, 16)} occurrence ${m.occurrence}`);
    log(r.verdict.text);
  }
  return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(String(e.message ?? e)); process.exit(2); });
}
