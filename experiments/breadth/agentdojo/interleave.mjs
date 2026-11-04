#!/usr/bin/env node
// Interleaved arms (PLAN §5.2 "Interleaving"): the units run in hashed order, and every arm runs a block of units before
// the next block starts, so a stop (cap, meter, environment fault) leaves each arm with the same unbiased paired subset
// and no arm runs at a systematically different time. The arm order rotates from block to block. Every arm keeps its own
// run (its own run id, ledger, cap, results and resume) through run.mjs runUnits; one bridge and one grader process
// serve all arms. A stop in any arm stops all of them.
//
//   node experiments/breadth/agentdojo/interleave.mjs --arms A-H,A-S --split dev --limits A-S=30 --caps A-H=3,A-S=6 --run-id ad-dev-pilot-1
//   node experiments/breadth/agentdojo/interleave.mjs --arms A-H,A-S,A-O --sealed --freeze <SEALED-FREEZE.json> --repeat 2 \
//        --caps A-H=5,A-S=15,A-O=15 --run-id ad-sealed-1        (A-S and A-O run their frozen comparator subsets)
// Options: --block 10 (units per block) --concurrency 3 --timeout-min 8 --max-turns 16 --card FILE --no-copy
//   --offline (the $0 init probe through the same interleaving: every session stops at its init event)
// F-H joins through the F-kit runner when it exists; this driver runs the A arms only.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BridgeServer, readJson } from './lib.mjs';
import { ARMS, DEFAULTS, RUNS_ROOT, orderUnits, parseArgs, runUnits, unitsFor } from './run.mjs';
import { loadSplit } from './split.mjs';

const kv = s => Object.fromEntries((s ?? '').split(',').filter(Boolean).map(x => { const [k, v] = x.split('='); return [k, Number(v)]; }));

/** Which units each arm runs: sealed comparators use the manifest's frozen subsets; dev limits take the first N in hashed order. */
export async function armUnits(a, arms, split) {
  const out = {};
  for (const arm of arms) {
    const sub = a.sealed && ['A-S', 'A-O'].includes(arm) ? arm : undefined;
    let us = await unitsFor({ ...a, subset: sub });
    const lim = kv(a.limits)[arm];
    if (lim) us = orderUnits(us, split.salt).slice(0, lim);
    out[arm] = us;
  }
  return out;
}

export async function interleave(a, { log = m => process.stderr.write(m + '\n') } = {}) {
  const arms = String(a.arms ?? '').split(',').filter(Boolean);
  if (!arms.length || arms.some(x => !ARMS[x])) throw new Error(`--arms takes a list of ${Object.keys(ARMS).join(', ')}`);
  const caps = kv(a.caps);
  for (const arm of arms) if (!(caps[arm] > 0)) throw new Error(`--caps needs a USD cap for ${arm}`);
  const split = loadSplit();
  const per = await armUnits(a, arms, split);
  const all = orderUnits([...new Map(Object.values(per).flat().map(u => [u.id, u])).values()], split.salt);
  const block = Number(a.block ?? 10);
  const base = a['run-id'] ?? `ad-il-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
  const authored = a.sealed ? readJson(a.freeze).authoredPath : null;
  const liveDir = path.join(RUNS_ROOT, base);
  const bridge = new BridgeServer({ liveDir, authored });
  const grader = new BridgeServer({ liveDir, authored, cmd: 'grade-serve' });
  await bridge.hello; await grader.hello;
  const last = {};
  let stopped = null;
  try {
    for (let b = 0, k = 0; b < all.length && !stopped; b += block, k++) {
      const ids = new Set(all.slice(b, b + block).map(u => u.id));
      const order = arms.map((_, i) => arms[(i + k) % arms.length]); // rotate the arm order per block
      for (const arm of order) {
        if (![...ids].some(id => per[arm].some(u => u.id === id))) continue;
        const runId = `${base}-${arm}`;
        const res = await runUnits({ units: per[arm], unitsLabel: a.sealed ? 'sealed (interleaved)' : 'dev units (interleaved)', armName: arm, capUsd: caps[arm],
          repeat: Number(a.repeat ?? 1), maxTurns: Number(a['max-turns'] ?? DEFAULTS.maxTurns), maxRequests: Number(a['max-requests'] ?? DEFAULTS.maxRequests),
          timeoutMin: Number(a['timeout-min'] ?? DEFAULTS.timeoutMin), concurrency: Number(a.concurrency ?? DEFAULTS.concurrency), cardFile: a.card, runId,
          resume: existsSync(path.join(RUNS_ROOT, runId, 'launch.json')), sealed: Boolean(a.sealed), freeze: a.freeze, authored, bridge, grader, onlyIds: ids, offline: Boolean(a.offline), outDir: a['no-copy'] ? null : undefined, log });
        last[arm] = res.summary;
        if (res.stopped) { stopped = `${arm}: ${res.stopped}`; break; }
      }
      log(`[interleave] block ${k + 1}/${Math.ceil(all.length / block)} done${stopped ? `; STOPPED (${stopped})` : ''}`);
    }
  } finally { await bridge.quit(); await grader.quit(); }
  return { base, arms, block, units: Object.fromEntries(arms.map(x => [x, per[x].length])), stopped, summaries: last };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  const r = await interleave(a);
  const brief = s => s && { n: s.n, of: s.of, complete: s.complete, benign: s.benign, underAttack: s.underAttack, spentUsd: s.cost?.spentUsd, copiedTo: s.copiedTo };
  console.log(JSON.stringify({ ...r, summaries: Object.fromEntries(Object.entries(r.summaries).map(([k, s]) => [k, brief(s)])) }, null, 1));
  if (r.stopped) process.exit(3);
}
