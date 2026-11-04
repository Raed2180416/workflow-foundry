#!/usr/bin/env node
// Interleaved arms (PLAN §5.2 "Interleaving"; the AgentDojo bed's interleave.mjs adapted). The union of the arms' units
// runs in the split's hashed run order, in blocks of WHOLE SCENARIOS (A-HN carries its notes across the variants of a
// scenario, so a scenario never straddles two blocks); every arm runs its units of a block before the next block starts,
// and the arm order rotates from block to block. A stop (cap, usage meter, environment fault) therefore leaves every arm
// with the same unbiased paired subset, and no arm runs at a systematically different time. Each arm keeps its own run
// (run id `<base>-<arm>`, launch, ledger, cap, results, resume) through run.mjs runUnits; one host-only grader process
// serves all arms; the usage-meter reading carries from block to block. A stop in any arm stops all of them (exit 3, or
// 4 for a cap, 5 for the meter); rerunning the same command resumes every arm.
//
//   node experiments/breadth/appworld/interleave.mjs --arms A-H,A-HN,A-S,A-O --pilot --caps A-H=7.8,A-HN=9.75,A-S=24.96,A-O=31.2 --run-id aw-pilot
//   node experiments/breadth/appworld/interleave.mjs --arms A-H,A-HN,A-S,A-O --sealed --freeze research/breadth-20261021/appworld/SEALED-FREEZE.json \
//        --caps A-H=43.68,A-HN=54.6,A-S=133.12,A-O=104 --run-id aw-sealed     (A-H and A-HN run all 168; A-S and A-O their frozen subsets)
// Options: --block 4 (scenarios per block) --concurrency 2 --max-turns 50 --max-executes 100 --timeout-min 15 --card FILE
//   --split devTrain|devCheck (with --look for devCheck) --limits A-S=12 (dev: the first N of the arm's units in hashed order)
//   --offline (the $0 init probe through the same interleaving) --no-copy
// F-H joins through the F-kit runner; this driver runs the A arms only.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BridgeServer, HOST_ROOT, scenarioOf } from './lib.mjs';
import { ARMS, DEFAULTS, idsFor, parseArgs, runUnits } from './run.mjs';
import { loadSplit, runOrder } from './split.mjs';

const kv = s => Object.fromEntries((s ?? '').split(',').filter(Boolean).map(x => { const [k, v] = x.split('='); return [k, Number(v)]; }));

/** Each arm's task ids: sealed comparators use their frozen subsets; --limits takes the first N in hashed run order. */
export function armIds(a, arms, split) {
  const out = {};
  for (const arm of arms) {
    const sub = a.sealed ? (arm === 'A-S' || arm === 'A-O' ? arm : 'haiku') : undefined;
    let ids = idsFor({ ...a, arm, subset: sub }, split);
    const lim = kv(a.limits)[arm];
    if (lim) ids = runOrder(ids, split.salt).slice(0, lim);
    out[arm] = ids;
  }
  return out;
}

/** Blocks of whole scenarios over the union of the arms' ids, in hashed run order. */
export function scenarioBlocks(perArm, salt, scenariosPerBlock) {
  const union = runOrder([...new Set(Object.values(perArm).flat())], salt);
  const scen = [];
  for (const id of union) { const s = scenarioOf(id); if (!scen.includes(s)) scen.push(s); }
  const blocks = [];
  for (let i = 0; i < scen.length; i += scenariosPerBlock) {
    const ss = new Set(scen.slice(i, i + scenariosPerBlock));
    blocks.push(union.filter(id => ss.has(scenarioOf(id))));
  }
  return blocks;
}

export async function interleave(a, { log = m => process.stderr.write(m + '\n'), runUnitsImpl = runUnits, graderImpl = null } = {}) {
  const arms = String(a.arms ?? '').split(',').filter(Boolean);
  if (!arms.length || arms.some(x => !ARMS[x]) || new Set(arms).size !== arms.length) throw new Error(`--arms takes distinct arms from ${Object.keys(ARMS).join(', ')}`);
  const caps = kv(a.caps);
  for (const arm of arms) if (!(caps[arm] > 0)) throw new Error(`--caps needs a USD cap for ${arm}`);
  const split = a.splitObject ?? loadSplit();
  const per = armIds(a, arms, split);
  const blocks = scenarioBlocks(per, split.salt, Number(a.block ?? 4));
  const base = a['run-id'] ?? `aw-il-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
  const num = (v, d) => (v === undefined ? d : Number(v));
  const grader = a.offline ? null : (graderImpl ?? new BridgeServer({ cmd: 'grade-serve', root: path.join(HOST_ROOT, 'runs', `${base}-grade-root`), onExit: c => log(`[interleave] grader exited (${c})`) }));
  if (grader?.hello) await grader.hello;
  const last = {};
  let stopped = null, stopKind = null, meterSeed = null;
  try {
    for (let k = 0; k < blocks.length && !stopped; k++) {
      const order = arms.map((_, i) => arms[(i + k) % arms.length]); // rotate the arm order per block
      for (const arm of order) {
        const only = blocks[k].filter(id => per[arm].includes(id));
        if (!only.length) continue;
        const runId = `${base}-${arm.toLowerCase()}`;
        const res = await runUnitsImpl({ ids: per[arm], onlyIds: only, armName: arm, capUsd: caps[arm], budgetUsd: num(a.budget, undefined), profile: a.profile ?? 'arm',
          repeat: num(a.repeat, 1), maxTurns: num(a['max-turns'], DEFAULTS.maxTurns), maxExecutes: num(a['max-executes'], DEFAULTS.maxExecutes),
          timeoutMin: num(a['timeout-min'], DEFAULTS.timeoutMin), concurrency: num(a.concurrency, DEFAULTS.concurrency), cardFile: a.card, runId,
          resume: existsSync(path.join(HOST_ROOT, 'runs', runId, 'launch.json')), sealed: Boolean(a.sealed), freeze: a.freeze, look: a.look ?? null,
          offline: Boolean(a.offline), outDir: a['no-copy'] ? null : undefined, grader, meterSeed, log });
        last[arm] = res.summary;
        meterSeed = res.summary?.meter?.last ?? meterSeed;
        if (res.stopped) { stopped = `${arm}: ${res.stopped}`; stopKind = res.stopKind; break; }
      }
      log(`[interleave] block ${k + 1}/${blocks.length} done${stopped ? `; STOPPED (${stopped})` : ''}`);
    }
  } finally { if (grader && !graderImpl) await grader.quit(); }
  return { base, arms, blocks: blocks.length, units: Object.fromEntries(arms.map(x => [x, per[x].length])), stopped, stopKind, summaries: last };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  const r = await interleave(a);
  const brief = s => s && { n: s.n, of: s.of, complete: s.complete, tgc: s.tgc, sgc: s.sgc, subGoal: s.subGoal, spentUsd: s.cost?.spentUsd, copiedTo: s.copiedTo };
  process.stdout.write(JSON.stringify({ ...r, summaries: Object.fromEntries(Object.entries(r.summaries).map(([k, s]) => [k, brief(s)])) }, null, 1) + '\n');
  if (r.stopped) process.exit(r.stopKind === 'cap' ? 4 : r.stopKind === 'meter' ? 5 : 3);
}
