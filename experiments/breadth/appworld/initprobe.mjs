#!/usr/bin/env node
// $0 configuration probe for every AppWorld arm (PLAN §5.1 "init check"): one devTrain unit per arm with `--offline`
// (session.mjs: a network namespace; the CLI starts, connects the relay, prints its init event and is stopped before any
// model request is sent). Records each arm's init fingerprint and whether the init check passed.
//
//   node experiments/breadth/appworld/initprobe.mjs [--out research/breadth-20261021/appworld/init-probe.json]
import path from 'node:path';
import { RESEARCH, writeJson } from './lib.mjs';
import { ARMS, runUnits } from './run.mjs';
import { loadSplit, runOrder } from './split.mjs';

export async function initProbe({ log = m => process.stderr.write(m + '\n') } = {}) {
  const split = loadSplit();
  const ids = runOrder(split.roles.devTrain, split.salt).slice(0, 1);
  const arms = {};
  for (const arm of Object.keys(ARMS)) {
    const runId = `aw-initprobe-${arm.toLowerCase()}-${Date.now().toString(36)}`;
    const { results, stopped } = await runUnits({ ids, armName: arm, capUsd: ARMS[arm].budgetUsd * 2, offline: true, runId, concurrency: 1, maxTurns: 50, maxExecutes: 100, timeoutMin: 5, outDir: null, log });
    const r = results[0] ?? null;
    arms[arm] = { ok: Boolean(r && !r.sessionError && !stopped), stopped, sessionError: r?.sessionError ?? null, costUsd: r?.costUsd ?? 0, init: r?.init ?? null };
  }
  return { kind: 'appworld-init-probe', at: new Date().toISOString(), unit: ids[0], arms, pass: Object.values(arms).every(a => a.ok) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--out');
  const out = i > 0 ? process.argv[i + 1] : path.join(RESEARCH, 'init-probe.json');
  const res = await initProbe();
  writeJson(out, res);
  console.log(JSON.stringify({ pass: res.pass, arms: Object.fromEntries(Object.entries(res.arms).map(([k, v]) => [k, { ok: v.ok, tools: v.init?.tools, plugins: v.init?.plugins, model: v.init?.model, effortActive: v.init?.perTurnEffortActive, cost: v.costUsd, stopped: v.stopped }])) }, null, 1));
  if (!res.pass) process.exit(1);
}
