#!/usr/bin/env node
// Budget guards for the A1-C v2 look-2 chain (research/automationbench-20261014/a1c-v2/look2-chain.sh). DEVELOPER TOOL,
// $0, reads run records only (aggregate cost and token fields; no grade, no task content).
//   spend   --live DIR --runs id1,id2   USD settled by these runs (summary.json cost.spentUsd, else the sum over every
//                                       results.jsonl row's forks: costUsd, or costUpperUsd when the cost is unknown)
//   mercury --live DIR [--other N]      Mercury tokens recorded by every run under DIR (each results.jsonl row's
//                                       forks: tokens.byModel['mercury-*'].total, or tokens.total for a run whose model is
//                                       a Mercury model), plus N tokens used outside these run records (decision D18's
//                                       ledger, research/mercury-20261021/PORT-PROBE.md: probes, BUILDER-1, other tracks)
//   cap     --live DIR --other N [--ceiling 20000000] [--reserve 1000000] [--max 5500000] [--min 4500000]
//                                       the token cap the next Mercury arm may take: min(max, ceiling - tally - reserve);
//                                       exit 6 when it is below min (a decision is needed: D18)
// Every row of every attempt counts (a faulted or resumed task's earlier spend included).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const rows = dir => (existsSync(path.join(dir, 'results.jsonl')) ? readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const readJson = f => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);

/** USD a run settled. */
export function runSpend(dir) {
  const s = readJson(path.join(dir, 'summary.json'));
  if (typeof s?.cost?.spentUsd === 'number') return s.cost.spentUsd;
  return rows(dir).flatMap(r => r.forks ?? []).reduce((t, f) => t + (f.costUnknown ? (f.costUpperUsd ?? 0) : (f.costUsd ?? 0)), 0);
}
/** Mercury tokens a run recorded. */
export function runMercury(dir) {
  const l = readJson(path.join(dir, 'launch.json'));
  const mercModel = /^mercury/.test(String(l?.model ?? ''));
  let n = 0;
  for (const f of rows(dir).flatMap(r => r.forks ?? [])) {
    const by = f.tokens?.byModel ?? null;
    if (by) n += Object.entries(by).filter(([m]) => /^mercury/.test(m)).reduce((s, [, v]) => s + (v?.total ?? 0), 0);
    else if (mercModel) n += f.tokens?.total ?? 0;
  }
  return n;
}
export function mercuryTally(live) {
  const runs = existsSync(live) ? readdirSync(live, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
  const per = Object.fromEntries(runs.map(r => [r, runMercury(path.join(live, r))]).filter(([, n]) => n > 0));
  return { runs: per, total: Object.values(per).reduce((s, n) => s + n, 0) };
}
export function tokenCap({ tally, other, ceiling = 20_000_000, reserve = 1_000_000, max = 5_500_000 }) {
  return Math.max(0, Math.min(max, ceiling - tally - other - reserve));
}

function args(argv) { const a = { _: [] }; for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i]; else a._.push(argv[i]); } return a; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args(process.argv.slice(2));
  const live = a.live ?? '/var/tmp/foundry-work/autobench';
  const cmd = a._[0];
  if (cmd === 'spend') {
    const ids = String(a.runs ?? '').split(',').filter(Boolean);
    const per = Object.fromEntries(ids.map(id => [id, existsSync(path.join(live, id)) ? runSpend(path.join(live, id)) : 0]));
    process.stdout.write(`${JSON.stringify({ runs: per, total: Object.values(per).reduce((s, x) => s + x, 0) })}\n`);
  } else if (cmd === 'mercury' || cmd === 'cap') {
    if (cmd === 'cap' && a.other === undefined) throw new Error('cap: --other N (Mercury tokens outside these run records, from the D18 ledger) is required');
    const t = mercuryTally(live), other = Number(a.other ?? 0);
    if (cmd === 'mercury') { process.stdout.write(`${JSON.stringify({ ...t, other, all: t.total + other })}\n`); }
    else {
      const cap = tokenCap({ tally: t.total, other, ceiling: Number(a.ceiling ?? 20_000_000), reserve: Number(a.reserve ?? 1_000_000), max: Number(a.max ?? 5_500_000) });
      process.stderr.write(`[look2-guard] Mercury: runs ${t.total} + other ${other} = ${t.total + other}; next arm's token cap ${cap}\n`);
      process.stdout.write(`${cap}\n`);
      if (cap < Number(a.min ?? 4_500_000)) process.exit(6);
    }
  } else throw new Error('usage: look2-guard.mjs spend|mercury|cap …');
}
