// Run arm agent-H / agent-O (experiments/ebed/agent-arm.mjs) on E8 dev worlds and grade it with the item's oracle and the
// reference pools, like B1 (build.mjs) so the two are paired per world. METERED: every case-tick is one model session.
// A total cap stops the stream with a host QuotaStop (the clock freezes; cases still open are censored, not failed).
//   node experiments/ebed/run-agent.mjs --model claude-haiku-5-5 --label agenth-e8-1 --seeds 1232 --difficulties 2 \
//        --size 16 --tick-budget 0.5 --tick-minutes 8 --cap 15 --concurrency 4 [--effort low] [--workspace]
import { writeFileSync, mkdirSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { createHost, QuotaStop } from '../../beds/ebed/host/host.mjs';
import { resumeRun } from '../../beds/ebed/host/replay.mjs';
import { agentArm } from './agent-arm.mjs';
import { contractText } from './build.mjs';
import { addUsage, cacheReadShare, zeroUsage } from '../memory/cache-share.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'policy', 'models.json'), 'utf8'));

/** Wrap an arm so the stream stops (QuotaStop) once recorded spend reaches capUsd; unknown costs count at their bound. */
export function capped(arm, capUsd, spent = { usd: 0 }) {
  return {
    ...arm,
    async tick(input, ctx) {
      if (spent.usd >= capUsd) throw new QuotaStop(`arm cap $${capUsd} reached ($${spent.usd.toFixed(2)})`);
      const rec = ctx.recordCost;
      const c = { ...ctx, recordCost: row => { spent.usd += row.costUnknown ? (row.costUpperUsd ?? 0) : (row.costUsd ?? 0); rec(row); } };
      return arm.tick.call(arm, input, c);
    },
    spent,
  };
}

/** Grade a finished (or frozen) host run: completed-case pass rates, by class, first-divergence codes, costs. */
export function summarize(world, rows, pools, label) {
  const v = e8.oracle(world, rows, { pools, arm: label });
  const comp = v.cases.filter(c => c.pool === 'completed');
  const byClass = {}, codes = {};
  for (const c of comp) { const k = (byClass[c.class] ??= { n: 0, pass: 0, censored: 0 }); k.n += 1; if (c.pass) k.pass += 1; if (c.armCensored) k.censored += 1; }
  for (const c of comp.filter(x => !x.pass)) { const k = c.firstDivergence ? `L${c.firstDivergence.layer}:${c.firstDivergence.code}` : 'armCensored'; codes[k] = (codes[k] ?? 0) + 1; }
  const calls = rows.filter(r => r.type === 'call');
  const costs = calls.flatMap(r => r.costs ?? []);
  return {
    completed: comp.length, passed: comp.filter(c => c.pass).length, armCensored: comp.filter(c => c.armCensored).length,
    critical: v.critical.length, armErrors: rows.filter(r => r.type === 'arm.error').length,
    ticks: calls.length, costUsd: costs.reduce((s, c) => s + (c.costUsd ?? 0), 0), costUnknown: costs.filter(c => c.costUnknown).length,
    byClass, codes,
  };
}

async function main() {
  const model = arg('--model', null);
  // Mercury hook: executorModels ids (e.g. mercury-3) too; agentArm picks the model's session executor (tickExecutor).
  if (![...POLICY.models, ...(POLICY.executorModels ?? [])].some(m => m.id === model)) throw new Error(`--model must be a policy model id (policy/models.json): ${model}`);
  const label = arg('--label', null);
  if (!label) throw new Error('--label is required');
  const out = path.join(ROOT, 'research/enterprise-20261014/runs', label);
  if (existsSync(path.join(out, 'result.json'))) throw new Error(`${out}/result.json exists`);
  mkdirSync(out, { recursive: true });
  const [s0, s1] = arg('--seeds', '1232').split('-').map(Number);
  const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
  const difficulties = arg('--difficulties', '2').split(',').map(Number);
  const size = arg('--size', null) === null ? undefined : Number(arg('--size'));
  const cap = Number(arg('--cap', '15')), tickBudget = Number(arg('--tick-budget', '0.5')), tickMinutes = Number(arg('--tick-minutes', '8'));
  const concurrency = Number(arg('--concurrency', '4'));
  const useWs = process.argv.includes('--workspace');
  const spent = { usd: 0 };
  const rows = [];
  // Live logs stay outside the repository while the run is in flight; they are copied in when it ends.
  const liveDir = path.join('/var/tmp/foundry-work/ebed-arms', label);
  mkdirSync(liveDir, { recursive: true });
  const liveTicks = path.join(liveDir, 'ticks.jsonl');
  // A resumed run counts what its earlier invocations already spent against the cap.
  if (existsSync(liveTicks)) spent.usd = readFileSync(liveTicks, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .reduce((a, x) => a + (x.costUnknown ? (x.costUpperUsd ?? 0) : (x.costUsd ?? 0)), 0);
  for (const d of difficulties) for (const seed of seeds) {
    const w = e8.generateWorld({ seed, difficulty: d, mix: 'tail', ...(size ? { size } : {}) });
    const { pools } = await e8.referenceRuns(w);
    const workRoot = path.join('/var/tmp/foundry-work/ebed-arms', label, `w${seed}-d${d}`);
    // --workspace is agent-H-ws: one workspace shared across ticks and instances, the honest "learns on the job" baseline
    // (MEM-0 M1); a Foundry arm built on agentArm keeps the default, a workspace per instance.
    const arm = capped(agentArm({ id: label, model, workRoot, contract: contractText(), effort: arg('--effort', null), budgetUsdPerTick: tickBudget,
      minutesPerTick: tickMinutes, journal: liveTicks, ...(useWs ? { workspaceScope: 'arm' } : {}) }), cap, spent);
    // The host journal lives on disk so a stopped run (background time limit, crash, quota) resumes from its last commit:
    // the committed prefix is replayed at $0 (resumeRun) and live calls pick up at the interrupted wake-up.
    const journalFile = path.join(liveDir, `journal-w${seed}-d${d}.jsonl`), blobDir = path.join(liveDir, `blobs-w${seed}-d${d}`);
    const hostOpts = { item: e8.binding, world: w, arm, concurrency: useWs ? 1 : concurrency, callTimeoutMs: (tickMinutes + 1) * 60_000,
      journalFile, blobDir, ...(useWs ? { workspaceDir: path.join(workRoot, 'ws') } : {}) };
    const t = Date.now();
    let status, host;
    try {
      if (existsSync(journalFile)) { console.log(`  resuming from ${journalFile}`); const r = await resumeRun(hostOpts); status = r.status; host = r.host; }
      else { host = createHost(hostOpts); status = (await host.run()).status; }
    } catch (e) { status = `host-error: ${String(e?.message ?? e).slice(0, 200)}`; }
    if (!host) { rows.push({ seed, d, size: size ?? null, status, wallMs: Date.now() - t }); console.log(`  d${d} seed ${seed}: ${status}`); continue; }
    const s = summarize(w, host.journal.contentRows(), pools, label);
    rows.push({ seed, d, size: size ?? null, status, wallMs: Date.now() - t, ...s });
    console.log(`  d${d} seed ${seed}${size ? ` size ${size}` : ''}: ${status}; ${s.passed}/${s.completed} completed pass (${s.armCensored} open at freeze), critical ${s.critical}, arm errors ${s.armErrors}, ${s.ticks} ticks, $${s.costUsd.toFixed(2)}`);
    writeFileSync(path.join(liveDir, 'result.partial.json'), JSON.stringify({ label, model, rows }, null, 1));
    if (spent.usd >= cap) break;
  }
  // The arm's prompt-cache read share over every tick session that reported usage (MEM-0; F17).
  const usage = existsSync(liveTicks) ? readFileSync(liveTicks, 'utf8').split('\n').filter(Boolean).reduce((u, l) => addUsage(u, JSON.parse(l).tokens), zeroUsage()) : zeroUsage();
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ label, item: e8.family.id, spec: e8.specE.sha256, model, effort: arg('--effort', null), workspace: useWs,
    workspaceScope: useWs ? 'arm' : null, tickBudgetUsd: tickBudget, tickMinutes, capUsd: cap, spentUsd: spent.usd, usage, cacheReadShare: cacheReadShare(usage),
    seeds, difficulties, size: size ?? null, rows }, null, 1));
  if (existsSync(liveTicks)) copyFileSync(liveTicks, path.join(out, 'ticks.jsonl'));
  console.log(`spent $${spent.usd.toFixed(2)} of $${cap}; prompt-cache read share ${cacheReadShare(usage) ?? '–'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
