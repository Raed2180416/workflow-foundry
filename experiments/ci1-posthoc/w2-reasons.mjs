#!/usr/bin/env node
// Wave-2 failing-world reasons, grouped (analysis, $0): for each item, every distinct first reason of every failing hidden world over
// the given labels (addresses and ids shortened), with the builds that show it. Used to root-cause every wave-2 failure.
//   node experiments/ci1-posthoc/w2-reasons.mjs <label...>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const RUNS = process.env.CI1_RUNS ?? '/var/tmp/foundry-work/ci1-20261021/runs';
const by = new Map();
for (const label of process.argv.slice(2)) {
  const dir = path.join(RUNS, label, 'records'); if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); if (r.pass) continue;
    for (const w of (r.worlds ?? []).filter(x => !x.pass)) for (const reason of (w.reasons ?? []).slice(0, 2)) {
      const key = `${r.item} | ${String(reason).replace(/\{.*\}/, '{row}').slice(0, 230)}`;
      if (!by.has(key)) by.set(key, new Set()); by.get(key).add(`${label.replace('w2-', '')}k${r.k}:${w.id}`);
    }
    if (r.outcome !== 'ready') { const key = `${r.item} | outcome ${r.outcome}`; if (!by.has(key)) by.set(key, new Set()); by.get(key).add(`${label}k${r.k}`); }
  }
}
for (const [k, v] of [...by].sort()) console.log(`${k}  <= ${[...v].sort().join(' ')}`);
