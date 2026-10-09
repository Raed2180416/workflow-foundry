// Run the static C0 records solver (research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs) on regenerated
// records dev tasks, exactly as experiments/jit/stream.mjs runs a `static:` arm's compiled step: experiments/jit/run-compiled.mjs
// runCompiled (sandboxed node, no network, gateway socket, per-task cap $1, 20 min), a model port from experiments/lib/models.mjs
// with the static arm's model subset (Haiku, Sonnet, Opus), journaled to SQLite. Model calls go through the claude-cli provider
// (host-side `claude -p` on the owner's logged-in account).
// Deviations from the stream, recorded in README.md: one task at a time; claude-cli concurrency 2 (RAM); no Haiku-interpreter
// fallback on crash/deopt/invalid (the row reports the compiled status; C0 never deopts by design); a spend stop.
// Usage: node --max-old-space-size=1024 run-c0.mjs <seed...>   (env SPEND_STOP_USD, default 2.3)
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync } from 'node:fs';
import { runCompiled } from '../../../../experiments/jit/run-compiled.mjs';
import { createModelPort } from '../../../../experiments/lib/models.mjs';
import { loadFamily } from '../../../../experiments/lib/beds.mjs';

const REPO = path.resolve(new URL('../../../..', import.meta.url).pathname);
const SOLVER = path.join(REPO, 'research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs');
const SCRATCH = process.env.C0_SCRATCH ?? '/var/tmp/foundry-work/c0-testbed';
const OUTDIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'outputs', 'c0-runs');
const MODELS = ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'];   // stream.mjs parseArm: uniq(gatewayModels + staticFallback).sort()
const SPEND_STOP = Number(process.env.SPEND_STOP_USD ?? 2.3);

const seeds = process.argv.slice(2).map(Number);
if (!seeds.length || seeds.some(s => !Number.isInteger(s) || (s >= 225 && s <= 248) || s >= 5000)) throw new Error('give allowed dev seeds (201-224, 249-272)');

mkdirSync(OUTDIR, { recursive: true });
const resultsFile = path.join(OUTDIR, 'results.jsonl');
const prior = existsSync(resultsFile) ? readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
let spent = prior.reduce((s, r) => s + (r.costUsd ?? 0), 0);
const done = new Set(prior.map(r => r.seed));

const fam = await loadFamily('records');
const { port } = createModelPort({ journalFile: path.join(SCRATCH, 'journal.sqlite'), allowedModels: MODELS, concurrency: { 'claude-cli': 2 } });

for (const seed of seeds) {
  if (done.has(seed)) { console.error(`s${seed}: already done, skipping`); continue; }
  if (spent >= SPEND_STOP) { console.error(`spend stop: $${spent.toFixed(4)} >= $${SPEND_STOP}`); break; }
  const task = JSON.parse(readFileSync(path.join(SCRATCH, 'tasks', `s${seed}.json`), 'utf8'));
  const workdir = path.join(SCRATCH, 'work', `s${seed}`);
  rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
  const t0 = Date.now();
  const rc = await runCompiled({ solvePath: SOLVER, task, modelPort: port, perTaskUsd: 1, timeoutMs: 20 * 60 * 1000, workdir,
    familyId: 'records', outputSchema: fam.outputSchema, allowedModels: MODELS, label: `c0-testbed:static-B1-haiku-records-k1:s${seed}` });
  const verdict = rc.output ? fam.oracle(task, rc.output) : null;
  spent += rc.costUsd ?? 0;
  const stderr = existsSync(path.join(workdir, '.solve.stderr')) ? readFileSync(path.join(workdir, '.solve.stderr'), 'utf8') : '';
  mkdirSync(path.join(OUTDIR, `s${seed}`), { recursive: true });
  writeFileSync(path.join(OUTDIR, `s${seed}`, 'output.json'), JSON.stringify(rc.output));
  writeFileSync(path.join(OUTDIR, `s${seed}`, 'solve.stderr'), stderr);
  writeFileSync(path.join(OUTDIR, `s${seed}`, 'oracle.json'), JSON.stringify(verdict, null, 1));
  const row = { seed, difficulty: task.difficulty, status: rc.status, pass: verdict?.pass ?? false, score: verdict?.score ?? 0,
    predicted: rc.output?.records?.length ?? null, costUsd: rc.costUsd, costUnknown: rc.costUnknown, calls: rc.meta.calls, errors: rc.meta.errors,
    latencyMs: Date.now() - t0, error: rc.error, solveSha256: rc.meta.solveSha256,
    details: verdict ? { pairF1: verdict.details?.pairF1, fieldAccuracy: verdict.details?.fieldAccuracy, extra: verdict.details?.extra, missing: verdict.details?.missing, entities: verdict.details?.entities, reason: verdict.details?.reason ?? null, recall: verdict.details?.recall, precision: verdict.details?.precision } : null };
  appendFileSync(resultsFile, JSON.stringify(row) + '\n');
  console.error(`s${seed} d${task.difficulty} ${rc.status} pass=${row.pass} score=${row.score.toFixed?.(3)} pred=${row.predicted} $${(rc.costUsd ?? 0).toFixed(4)} total $${spent.toFixed(4)} ${Math.round(row.latencyMs / 1000)}s`);
}
process.exit(0);
