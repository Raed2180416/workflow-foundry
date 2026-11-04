#!/usr/bin/env node
// AppWorld paid-arm plan: the exact commands and their cost estimates (no model call; $0).
// Per-task anchors are PLAN §10.2's AppWorld row (A-H $33.6 / 168, F-H $67.2 / 168, A-S $102.4 / 64, A-O $80.0 / 20) and
// the owner's brief (A-HN control about $42 / 168). They are [I] until the dev pilot measures cost and p99 per arm; the
// pilot's numbers replace them before any sealed run (PLAN §5.2 "Caps", PREREG §1.6).
//
//   node experiments/breadth/appworld/costest.mjs [--out research/breadth-20261021/appworld/cost-estimate.json]
import path from 'node:path';
import { RESEARCH, writeJson } from './lib.mjs';
import { ARMS, PILOT_SIZES } from './run.mjs';
import { loadSplit } from './split.mjs';

export const PER_TASK_USD = Object.freeze({ 'A-H': 33.6 / 168, 'A-HN': 42 / 168, 'F-H': 67.2 / 168, 'A-S': 102.4 / 64, 'A-O': 80 / 20 });
const R = 'node experiments/breadth/appworld/run.mjs';
const FREEZE = 'research/breadth-20261021/appworld/SEALED-FREEZE.json';
const usd = x => Math.round(x * 100) / 100;
const capOf = (est, budget) => Math.max(usd(est * 1.3), usd(budget * 2)); // 30% headroom, at least two sessions' reservation

export function plan(split = loadSplit()) {
  const sizes = { haiku: split.roles.sealed.length, 'A-S': split.sealed.sonnetDefault.length, 'A-O': split.sealed.opusAnchors.length };
  const dev = [
    { step: 'init probe (sessions stop at their init event; no model request is sent)', arm: 'all', usd: 0,
      cmds: Object.keys(ARMS).map(a => `${R} --arm ${a} --split devTrain --limit 2 --offline --cap ${ARMS[a].budgetUsd * 2}`) },
    { step: 'probe battery: 2 smoke units per arm on devTrain (identity and date checks read from these transcripts)', arm: 'all',
      usd: usd(2 * (PER_TASK_USD['A-H'] + PER_TASK_USD['A-HN'] + PER_TASK_USD['A-S']) + PER_TASK_USD['A-O']),
      cmds: [`${R} --arm A-H --split devTrain --limit 2 --cap 1.2 --run-id aw-smoke-ah`, `${R} --arm A-HN --split devTrain --limit 2 --cap 1.4 --run-id aw-smoke-ahn`,
        `${R} --arm A-S --split devTrain --limit 2 --cap 8 --run-id aw-smoke-as`, `${R} --arm A-O --split devTrain --limit 1 --cap 10 --run-id aw-smoke-ao`] },
    ...['A-H', 'A-HN', 'A-S', 'A-O'].map(a => ({ step: `dev pilot and cost gate: ${a} on the first ${PILOT_SIZES[a]} devTrain tasks in pilot order`, arm: a, usd: usd(PILOT_SIZES[a] * PER_TASK_USD[a]),
      cmds: [`${R} --arm ${a} --pilot --cap ${capOf(PILOT_SIZES[a] * PER_TASK_USD[a], ARMS[a].budgetUsd)} --run-id aw-pilot-${a.toLowerCase()}`] })),
    { step: 'bed card (Opus, from public docs, the tool schema and devTrain only; written by the F-kit card step, not this adapter)', arm: 'card', usd: 5, cmds: [] },
    { step: 'F-kit dev looks (F-H on devTrain, <= 3 looks on devCheck; the F-kit, not this adapter)', arm: 'F-H', usd: 15, cmds: [] },
  ];
  const sealed = [
    { arm: 'A-H', subset: 'haiku', n: sizes.haiku },
    { arm: 'F-H', subset: 'haiku', n: sizes.haiku, note: 'F-kit (not this adapter); 2 F-reuse lineages' },
    { arm: 'A-S', subset: 'A-S', n: sizes['A-S'] },
    { arm: 'A-O', subset: 'A-O', n: sizes['A-O'] },
  ].map(x => { const est = usd(x.n * PER_TASK_USD[x.arm]); const cap = capOf(est, ARMS[x.arm]?.budgetUsd ?? 1); return { ...x, usd: est, capUsd: cap,
    cmds: ARMS[x.arm] ? [`${R} --arm ${x.arm} --sealed --freeze ${FREEZE} --subset ${x.subset} --cap ${cap} --run-id aw-sealed-${x.arm.toLowerCase()}`] : [] }; });
  const control = { arm: 'A-HN', subset: 'haiku', n: sizes.haiku, usd: usd(sizes.haiku * PER_TASK_USD['A-HN']) };
  control.capUsd = capOf(control.usd, ARMS['A-HN'].budgetUsd);
  control.cmds = [`${R} --arm A-HN --sealed --freeze ${FREEZE} --subset haiku --cap ${control.capUsd} --run-id aw-sealed-a-hn`];
  const devUsd = usd(dev.reduce((a, s) => a + s.usd, 0)), sealedUsd = usd(sealed.reduce((a, s) => a + s.usd, 0)), sealedCap = usd(sealed.reduce((a, s) => a + s.capUsd, 0));
  return { kind: 'appworld-cost-plan', evidence: 'estimate [I] from PLAN §10.2 anchors; replaced by dev-pilot measurements before any sealed run', perTaskUsd: PER_TASK_USD, sizes,
    dev, devUsd, devCapUsd: 90, sealed, sealedUsd, sealedCapSum: sealedCap, sealedCapUsd: 380, control,
    order: 'dev only after the AppWorld $0 gates; sealed only after the cheap beds and the portfolio dev gate, with a SEALED-FREEZE.json written at the PREREG v1 freeze (arms, F-kit and card hashes, per-arm caps from 1.5 x dev p99, the A-S cut from the pilot ICC)' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--out');
  const out = i > 0 ? process.argv[i + 1] : path.join(RESEARCH, 'cost-estimate.json');
  const p = plan();
  writeJson(out, p);
  console.log(JSON.stringify({ devUsd: p.devUsd, sealedUsd: p.sealedUsd, sealedCapSum: p.sealedCapSum, controlUsd: p.control.usd }, null, 1));
}
