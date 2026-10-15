// Prompt-cache read share per arm (research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §3.2 "Cache share", §5 row 2
// MEM-0; critique F17): the prompt cache is an accidental memory, so every report prints, per arm, the share of prompt
// tokens read from it. Same formula as experiments/lib/services.mjs Ledger.cacheReadShare (cache reads / all prompt tokens,
// rounded to 1e-4, null before any prompt token); kept here so reports outside the stamped trees need not import it.
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
