// Prompt-cache read share per arm (research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.2 "Cache share", §5 row 2
// MEM-0; critique F17): the prompt cache is an accidental memory, so every report prints, per arm, the share of prompt
// tokens read from it. Same formula as experiments/lib/services.mjs Ledger.cacheReadShare (cache reads / all prompt tokens,
// rounded to 1e-4, null before any prompt token); kept here so reports outside the stamped trees need not import it.
// Used by experiments/jit/report.mjs and experiments/ebed/run-agent.mjs. The CLI prints it per arm (mode) for a need-router
// label-run output directory (rows.jsonl and builds.final.jsonl carry each row's tokens and mode):
//   node experiments/memory/cache-share.mjs <label-run --out dir>...
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

const KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];

/** Add a usage record ({inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}; missing or non-finite parts count 0) into acc. */
export function addUsage(acc, u) {
  if (!u || typeof u !== 'object') return acc;
  for (const k of KEYS) acc[k] += Number.isFinite(u[k]) ? u[k] : 0;
  return acc;
}

/** Cache reads / (input + cache reads + cache writes), rounded to 1e-4; null when there is no prompt token. */
export function cacheReadShare(u) {
  if (!u) return null;
  const prompt = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
  return prompt ? Math.round(((u.cacheReadTokens ?? 0) / prompt) * 1e4) / 1e4 : null;
}

/** The cell a report prints: the share with the prompt tokens it is over, or '–' when nothing reported usage. */
export const cacheShareCell = u => {
  const s = cacheReadShare(u);
  return s === null ? '–' : `${(100 * s).toFixed(1)}% of ${(u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens).toLocaleString('en-US')}`;
};

/** Usage and share per arm: rows [{ <armKey>, tokens }] -> { arm: { usage, cacheReadShare } }, arms in sorted order. */
export function perArm(rows, { armKey = 'mode', tokensKey = 'tokens' } = {}) {
  const by = new Map();
  for (const r of rows) { const a = r?.[armKey]; if (a == null) continue; if (!by.has(a)) by.set(a, zeroUsage()); addUsage(by.get(a), r[tokensKey]); }
  return Object.fromEntries([...by.keys()].sort().map(a => [a, { usage: by.get(a), cacheReadShare: cacheReadShare(by.get(a)) }]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('usage: node experiments/memory/cache-share.mjs <label-run --out dir>...'); process.exit(2); }
  const lines = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  for (const d of dirs) {
    const rows = [...lines(path.join(d, 'rows.jsonl')), ...lines(path.join(d, 'builds.final.jsonl'))];
    console.log(`${d}: ${rows.length} rows and builds`);
    for (const [arm, x] of Object.entries(perArm(rows))) console.log(`  ${arm.padEnd(16)} cache read share ${cacheShareCell(x.usage)}`);
  }
}
