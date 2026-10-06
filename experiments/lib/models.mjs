// One ModelPort per experiment: the owner policy, every provider, and a journal in its own
// SQLite file, so every arm's model calls are journaled and priced the same way.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ClaudeCliProvider } from '../../src/models/providers/claude-cli.mjs';
import { LlamaServerProvider } from '../../src/models/providers/llama-server.mjs';

export function createModelPort({ journalFile, mode = 'live', salt = null, concurrency = {}, maxBudgetUsdPerCall = 1 } = {}) {
  const { policy, hash } = loadPolicy();
  mkdirSync(path.dirname(journalFile), { recursive: true });
  const db = new DatabaseSync(journalFile);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const journal = new Journal(db);
  const providers = {
    'claude-cli': new ClaudeCliProvider({ policy, maxBudgetUsd: maxBudgetUsdPerCall }),
    'llama-server': new LlamaServerProvider({ policy }),
  };
  const port = new ModelPort({ policy, providers, journal, mode, salt, concurrency });
  return { port, policy, policyHash: hash, journal, db };
}
