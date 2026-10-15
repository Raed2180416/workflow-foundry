// One ModelPort per experiment: the owner policy (or a recorded subset of it), its providers, and a journal in
// its own SQLite file, so every arm's model calls are journaled and priced the same way.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadPolicy, validatePolicy, policyHash } from '../../src/models/policy.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ClaudeCliProvider } from '../../src/models/providers/claude-cli.mjs';
import { LlamaServerProvider } from '../../src/models/providers/llama-server.mjs';

const freeze = v => { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; };
// A subset of the owner policy: only the listed ids (each must be in the owner policy) and only their providers.
// Classes keep the owner's order; a class left without a model fails validation with MODEL_CLASS_EMPTY.
export function subsetPolicy(owner, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw new Error('subsetPolicy needs a non-empty list of model ids');
  const missing = ids.filter(id => !owner.models.some(m => m.id === id));
  if (missing.length) throw new Error(`model ids not in the owner policy: ${missing.join(', ')}`);
  const models = owner.models.filter(m => ids.includes(m.id)), used = new Set(models.map(m => m.provider));
  // A session subset holds generative models only: judgment models (judgmentModels, System One; added 2026-10-09 for hosted Jev)
  // never enter a ModelPort, and their providers are not kept, so they are left out with them.
  const { judgmentModels: _judgment, ...generative } = owner;
  return freeze(validatePolicy(structuredClone({ ...generative, policyVersion: `${owner.policyVersion}+only:${[...ids].sort().join(',')}`, models,
    providers: Object.fromEntries(Object.entries(owner.providers).filter(([n]) => used.has(n))) })));
}

export function createModelPort({ journalFile, mode = 'live', salt = null, concurrency = {}, maxBudgetUsdPerCall = 1, allowedModels = null, timeoutMs = undefined } = {}) {
  const owner = loadPolicy();
  const policy = allowedModels ? subsetPolicy(owner.policy, allowedModels) : owner.policy, hash = policyHash(policy);
  mkdirSync(path.dirname(journalFile), { recursive: true });
  const db = new DatabaseSync(journalFile);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const journal = new Journal(db);
  // Only the providers the policy names: with no llama-server model in the subset no local server can be started.
  const providers = {};
  // timeoutMs: the per-call wall limit (the provider's default, 300 s, when omitted; M1-R re-runs timeouts at 600 s).
  if (policy.providers['claude-cli']) providers['claude-cli'] = new ClaudeCliProvider({ policy, maxBudgetUsd: maxBudgetUsdPerCall, ...(timeoutMs ? { timeoutMs } : {}) });
  if (policy.providers['llama-server']) providers['llama-server'] = new LlamaServerProvider({ policy });
  const port = new ModelPort({ policy, providers, journal, mode, salt, concurrency });
  return { port, policy, policyHash: hash, ownerPolicyHash: owner.hash, journal, db };
}
