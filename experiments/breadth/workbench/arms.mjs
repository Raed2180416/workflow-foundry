// WorkBench arm configurations (PLAN §5.2, D19). Every arm gets the same facade tools (WorkBench's 27 + python),
// the same system prompt (official text + date note + synthetic identity + optional bed card) and no built-in CLI
// tools. Model ids come only from policy/models.json; effort per PLAN §5.2 ("Effort").
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ARMS = Object.freeze({
  'A-H': Object.freeze({ model: 'claude-haiku-5-5', effort: 'high', builtinTools: [], label: 'Haiku 5.5 alone, effort high' }),
  'A-S': Object.freeze({ model: 'claude-sonnet-5-5', effort: 'high', builtinTools: [], label: 'Sonnet 5.5 alone, effort high' }),
  'A-O': Object.freeze({ model: 'claude-opus-5-5', effort: 'xhigh', builtinTools: [], label: 'Opus 5.5 alone, effort xhigh (D19 frontier comparator)' }),
  // Harness-parity anchor (PLAN §4.3 T1-1): the one model with published per-task WorkBench verdicts that the policy
  // lists. The official runs set no effort, so neither does the anchor.
  'H45': Object.freeze({ model: 'claude-haiku-4-5-20251001', effort: null, builtinTools: [], label: 'Haiku 4.5 through the A-H harness (parity anchor)', publishedModel: 'claude-haiku-4.5' }),
});

const POLICY = fileURLToPath(new URL('../../../policy/models.json', import.meta.url));
/** Refuse an arm whose model the owner policy does not list (no silent fallback). */
export function armModel(arm) {
  const a = ARMS[arm];
  if (!a) throw new Error(`unknown arm ${arm} (one of ${Object.keys(ARMS).join(', ')})`);
  const policy = JSON.parse(readFileSync(POLICY, 'utf8'));
  const m = (policy.models ?? []).find(x => x.id === a.model);
  if (!m) throw new Error(`model ${a.model} is not in policy/models.json`);
  if (m.provider !== 'claude-cli') throw new Error(`model ${a.model} is not served by the claude-cli provider`);
  return { ...a, price: { inputPerMTok: m.price?.inputPerMTok ?? null, outputPerMTok: m.price?.outputPerMTok ?? null } };
}

export const armConfigHash = (arm, extra) => createHash('sha256').update(JSON.stringify({ arm, ...ARMS[arm], ...extra })).digest('hex');
