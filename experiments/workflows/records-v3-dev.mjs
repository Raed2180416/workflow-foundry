// Development driver for experiments/workflows/records-v3.mjs on the records bed DEV split only (seeds 101-160).
// Runs the workflow through the F arm (experiments/lib/arms/foundry-workflow.mjs) and the shared runner, scores with
// the bed oracle, and appends one line per trial to /var/tmp/foundry-work/records-v3/dev-log.jsonl.
// Usage: node experiments/workflows/records-v3-dev.mjs <difficulty> <seeds: 101-110 | 101,102> [--label L] [--conv M|L]
//        [--extract M|L] [--max L] [--mode live|replay-or-live] [--trial K] [--concurrency N]
// --mode replay-or-live serves identical prompts from the journal (zero cost) and is for code-only iteration;
// reported numbers come from --mode live runs with a fresh --label (fresh samples).
import path from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment } from '../lib/runner.mjs';
import { createModelPort } from '../lib/models.mjs';
import { foundryWorkflow } from '../lib/arms/foundry-workflow.mjs';
import { Foundry } from '../../src/foundry.mjs';
import { buildRecordsV3Workflow } from './records-v3.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const [d, seedSpec] = argv;
const seeds = seedSpec.includes('-') ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(seedSpec.split('-').map(Number)) : seedSpec.split(',').map(Number);
if (seeds.some(s => !(s >= 101 && s <= 160))) throw new Error('dev seeds 101-160 only');
const ROOT = '/var/tmp/foundry-work/records-v3';
mkdirSync(ROOT, { recursive: true });
const mode = opt('mode', 'live'), label = opt('label', 'dev'), trial = Number(opt('trial', '0'));
const options = { extractModelClass: opt('extract', 'M'), conventionsModelClass: opt('conv', 'M'), maxClass: opt('max', 'L'),
  concurrency: Number(opt('concurrency', '4')), maxCost: Number(opt('maxcost', '1')), reasoning: 'none' };
const { port, journal } = createModelPort({ journalFile: path.join(ROOT, 'journal.sqlite') });
// The arm calls port.call through the runtime, which passes the run's modelMode; a dev wrapper can pin the mode instead.
const modelPort = mode === 'live' ? port : Object.assign(Object.create(port), { call: req => port.call({ ...req, mode }) });
const workflow = buildRecordsV3Workflow(options);
const armId = `v3-${label}-x${options.extractModelClass}-c${options.conventionsModelClass}-m${options.maxClass}`;
const inner = foundryWorkflow({ id: armId, workflow, modelPort, maxCostUsd: options.maxCost });
// Wrap the arm to pull the workflow's own diagnostics (conventions, verify reasons, per-node spend) into meta.
const arm = { ...inner, async run(args) {
  const result = await inner.run(args);
  try {
    const f = new Foundry(path.join(args.workdir, 'ws'));
    const run = f.store.run(result.meta.runId);
    const merge = run.outputs?.merge ?? {}, check = run.outputs?.check ?? {};
    const calls = journal.forRun(result.meta.runId);
    const perNode = {};
    for (const c of calls) { const segs = c.nodeKey.split('/'), m = segs.find(x => x.includes(':')); const k = m ? m.split(':')[0] : segs.at(-1); perNode[k] = Math.round(((perNode[k] ?? 0) + (c.costUsd ?? 0)) * 1e5) / 1e5; }
    result.meta = { ...result.meta, conventions: merge.conventions, diagnostics: merge.diagnostics, unparsed: merge.unparsed, verify: { pass: check.pass, reasons: (check.reasons ?? []).slice(0, 12) },
      perNode, replayed: calls.filter(c => c.replayedFrom != null || c.costUsd === 0).length };
    await f.close();
  } catch (error) { result.meta = { ...result.meta, metaError: String(error.message ?? error) }; }
  return result;
} };
const tasks = await makeTasks('records', { split: 'dev', seeds, difficulty: Number(d) });
const recs = await runExperiment({ experiment: `records-v3-dev`, arms: [arm], tasks, trials: trial + 1, workRoot: path.join(ROOT, 'work'),
  resultsFile: path.join(ROOT, mode === 'live' ? 'results-live.jsonl' : `replay/results-${Date.now()}.jsonl`), concurrency: Number(opt('parallel', '3')), keepWorkdirs: false, log: () => {} });
for (const r of recs.filter(x => x.arm === armId && x.trial === trial && tasks.some(t => t.taskKey === x.taskKey))) {
  const det = r.oracleDetails ? JSON.parse(r.oracleDetails) : {};
  const line = { at: r.at, label, mode, arm: armId, options, task: r.taskKey, trial: r.trial, pass: r.pass, score: r.score, costUsd: r.costUsd,
    calls: r.meta?.calls, models: r.meta?.models, escalations: r.meta?.escalations, verdict: r.meta?.verdict, status: r.meta?.status, error: r.error,
    perNode: r.meta?.perNode, conventions: r.meta?.conventions, diagnostics: r.meta?.diagnostics, verify: r.meta?.verify,
    oracle: { pairF1: det.pairF1, fieldAccuracy: det.fieldAccuracy, extra: det.extra, missing: det.missing, E: det.entities, perField: det.perField, mismatches: det.mismatches } };
  appendFileSync(path.join(ROOT, 'dev-log.jsonl'), JSON.stringify(line) + '\n');
  console.log(`${r.taskKey} ${r.pass ? 'PASS' : 'fail'} score=${r.score?.toFixed(3)} $${r.costUsd.toFixed(4)} calls=${r.meta?.calls} esc=${r.meta?.escalations} ${r.error ? 'err=' + r.error.code : ''}`
    + ` pF1=${det.pairF1?.toFixed?.(3)} fAcc=${det.fieldAccuracy?.toFixed?.(3)} extra=${det.extra} missing=${det.missing}`);
  if (!r.pass) console.log('   diag:', JSON.stringify(r.meta?.diagnostics ?? []).slice(0, 600), '\n   mism:', JSON.stringify(det.mismatches ?? []).slice(0, 1500));
}
process.exit(0);
