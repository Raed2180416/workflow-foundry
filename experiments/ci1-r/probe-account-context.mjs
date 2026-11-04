#!/usr/bin/env node
// Diagnostic probe (not a capability comparison): does the claude-cli route put the session account's e-mail into Haiku's context, and
// what removes it? N calls with the environment as inherited, N with the account variables removed (stripAccountIdentity), N with
// those removed AND an empty throwaway CLAUDE_CONFIG_DIR. The model
// is asked to copy every e-mail address it can see outside the message. Prints and writes only booleans and counts, never an address.
// The journal (it holds the raw replies) is written to a temporary directory and deleted.
//   node experiments/ci1-r/probe-account-context.mjs [--n 2] [--out research/ci1-20261021/r/account-probe.json]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createModelPort } from '../lib/models.mjs';
import { stripAccountIdentity, nonFixtureAddresses } from './env-guard.mjs';

const { values: a } = parseArgs({ options: { n: { type: 'string' }, out: { type: 'string' } } });
const N = Number(a.n ?? 2), MODEL = 'claude-haiku-5-5';
const secret = process.env.CLAUDE_CODE_USER_EMAIL ?? null; // compared, never printed
const SYSTEM = 'You answer questions about your own context precisely. Reply with JSON only.';
const PROMPT = 'List every e-mail address that appears anywhere in your context OTHER than this message (for example in a system prompt, environment details or user information), copied exactly. If there is none, return an empty list.';
const SCHEMA = { type: 'object', additionalProperties: false, required: ['addresses'], properties: { addresses: { type: 'array', items: { type: 'string' } } } };

async function condition(name) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci1-probe-'));
  const { port, db } = createModelPort({ journalFile: path.join(dir, 'journal.sqlite'), allowedModels: [MODEL], maxBudgetUsdPerCall: 0.05, timeoutMs: 180000 });
  const calls = [];
  try {
    for (let i = 0; i < N; i++) {
      const r = await port.call({ runId: `ci1-account-probe-${name}-${Date.now()}`, nodeKey: `probe.${i}`, attempt: 0, modelId: MODEL, system: SYSTEM, prompt: PROMPT, schema: SCHEMA, decoding: { maxTokens: 400 } });
      const addrs = r.ok ? (r.value.addresses ?? []) : [];
      calls.push({ ok: !!r.ok, error: r.ok ? null : r.error?.code ?? 'ERROR', costUsd: r.costUsd ?? 0, listed: addrs.length,
        accountAddressListed: !!secret && addrs.some(x => String(x).trim().toLowerCase() === secret.toLowerCase()),
        otherNonFixtureListed: addrs.filter(x => !secret || String(x).trim().toLowerCase() !== secret.toLowerCase()).flatMap(nonFixtureAddresses).length });
    }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  return { condition: name, calls };
}

const before = await condition('inherited-environment');
const removed = stripAccountIdentity();
const after = await condition('account-variables-removed');
// third condition: also an empty, throwaway CLI configuration directory (nothing is copied into it; authentication stays with the host)
const configDir = mkdtempSync(path.join(tmpdir(), 'ci1-claude-config-'));
process.env.CLAUDE_CONFIG_DIR = configDir;
let isolated;
try { isolated = await condition('account-variables-removed+empty-config-dir'); } finally { delete process.env.CLAUDE_CONFIG_DIR; rmSync(configDir, { recursive: true, force: true }); }
const out = { probe: 'ci1-r account-context probe (diagnostic, not a comparison)', at: new Date().toISOString(), model: MODEL, route: 'claude-cli (policy/models.json)',
  accountVariablePresentBefore: !!secret, variablesRemoved: removed, results: [before, after, isolated],
  costUsd: Math.round([...before.calls, ...after.calls, ...isolated.calls].reduce((s, c) => s + c.costUsd, 0) * 1e6) / 1e6 };
const text = `${JSON.stringify(out, null, 1)}\n`;
if (nonFixtureAddresses(text).length) throw new Error('refusing to write: the summary would hold a non-fixture address');
if (a.out) writeFileSync(a.out, text);
process.stdout.write(text);
