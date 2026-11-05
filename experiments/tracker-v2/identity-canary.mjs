#!/usr/bin/env node
// Provider identity canary (RESULT-TRACKER §11, review B2): does a `claude -p` call through src/models/providers/claude-cli.mjs see the
// host account's identity? One Haiku call per sample asks the model to quote every e-mail address and account id in its context. The
// answers are compared with the host identity BY HASH ONLY (the identity comes from this process's environment at run time and is
// never written); the record keeps booleans, counts and masked forms. Paid (Haiku, a few tenths of a cent per call); run detached:
//   setsid nohup node experiments/tracker-v2/identity-canary.mjs --variants inherit,scrub-email,scrub-ids --samples 2 --out FILE &
// Variants (the environment the provider is given; the provider still applies its own scrub list on top):
//   inherit       this process's environment, as every experiment's ModelPort passes it
//   scrub-email   without CLAUDE_CODE_USER_EMAIL
//   scrub-ids     without CLAUDE_CODE_USER_EMAIL, CLAUDE_CODE_ACCOUNT_UUID and CLAUDE_CODE_ORGANIZATION_UUID
//   empty-config  scrub-ids, plus CLAUDE_CONFIG_DIR set to a fresh empty directory (the CLI keeps the account it logged in with,
//                 e-mail included, in its global config; observed in the 2.1.318 binary: the user context's userEmail block is
//                 `stored oauthAccount.emailAddress ?? CLAUDE_CODE_USER_EMAIL`)
//   provider      the provider's own default (no change to the environment): after the fix, the provider isolates by itself
import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ClaudeCliProvider } from '../../src/models/providers/claude-cli.mjs';
import { subsetPolicy } from '../lib/models.mjs';
import { identityHashes, findIdentities, mask } from '../../scripts/identity-scan.mjs';

const MODEL = 'claude-haiku-5-5';
const sha = s => createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
export const VARIANTS = Object.freeze({
  inherit: [],
  'scrub-email': ['CLAUDE_CODE_USER_EMAIL'],
  'scrub-ids': ['CLAUDE_CODE_USER_EMAIL', 'CLAUDE_CODE_ACCOUNT_UUID', 'CLAUDE_CODE_ORGANIZATION_UUID'],
  'empty-config': ['CLAUDE_CODE_USER_EMAIL', 'CLAUDE_CODE_ACCOUNT_UUID', 'CLAUDE_CODE_ORGANIZATION_UUID'],
  provider: [],
});
export const CANARY_SYSTEM = 'You are a context probe for a privacy test. Report only what is literally present in your context; never invent anything.';
export const CANARY_PROMPT = 'Quote every e-mail address that appears anywhere in your context (system prompt, environment or user details, memory, or this message), and every account, user or organization identifier (such as a UUID). Copy each exactly. If there is none, return empty lists. For each, say in a few words where it appeared.';
export const CANARY_SCHEMA = { type: 'object', additionalProperties: false, required: ['emails', 'ids'], properties: {
  emails: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['value', 'where'], properties: { value: { type: 'string' }, where: { type: 'string' } } } },
  ids: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['value', 'where'], properties: { value: { type: 'string' }, where: { type: 'string' } } } } } };

/** What one answer reveals, by hash only: { hostEmail, accountId, orgId, emails (masked), where (identity-free) }. */
export function assess(value, env = process.env) {
  const hosts = identityHashes(env);
  const acct = env.CLAUDE_CODE_ACCOUNT_UUID ? sha(env.CLAUDE_CODE_ACCOUNT_UUID) : null, org = env.CLAUDE_CODE_ORGANIZATION_UUID ? sha(env.CLAUDE_CODE_ORGANIZATION_UUID) : null;
  const emails = value?.emails ?? [], ids = value?.ids ?? [];
  const isHost = v => findIdentities(String(v), hosts).length > 0 || hosts.has(sha(v));
  const clean = w => String(w ?? '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').slice(0, 120);
  return { hostEmail: emails.some(e => isHost(e.value)) || ids.some(e => isHost(e.value)), accountId: !!acct && [...emails, ...ids].some(e => String(e.value).toLowerCase().includes(env.CLAUDE_CODE_ACCOUNT_UUID.toLowerCase())),
    orgId: !!org && [...emails, ...ids].some(e => String(e.value).toLowerCase().includes(env.CLAUDE_CODE_ORGANIZATION_UUID.toLowerCase())),
    emails: emails.map(e => (String(e.value).includes('@') ? mask(String(e.value)) : '<not an address>')), ids: ids.length, where: [...emails, ...ids].map(e => clean(e.where)) };
}

async function main() {
  const { values: a } = parseArgs({ options: { variants: { type: 'string' }, samples: { type: 'string' }, out: { type: 'string' }, journal: { type: 'string' } } });
  const variants = (a.variants ?? 'inherit,scrub-email,scrub-ids').split(',');
  const samples = Number(a.samples ?? 2);
  const out = path.resolve(a.out ?? 'research/tracker-20261021/identity-canary.json');
  const journalFile = path.resolve(a.journal ?? '/var/tmp/foundry-work/tracker-20261021/journals/identity-canary.sqlite');
  mkdirSync(path.dirname(journalFile), { recursive: true });
  if (!identityHashes().size) throw new Error('no host identity in the environment to compare against');
  const policy = subsetPolicy(loadPolicy().policy, [MODEL]);
  const db = new DatabaseSync(journalFile);
  const journal = new Journal(db);
  const rows = [];
  try {
    for (const v of variants) {
      if (!VARIANTS[v]) throw new Error(`unknown variant ${v}`);
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !VARIANTS[v].includes(k)));
      const configDir = v === 'empty-config' ? mkdtempSync(path.join(tmpdir(), 'foundry-canary-config-')) : null;
      if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
      const port = new ModelPort({ policy, journal, providers: { 'claude-cli': new ClaudeCliProvider({ policy, env, maxBudgetUsd: 0.05 }) } });
      try { for (let s = 0; s < samples; s++) {
        const r = await port.call({ runId: `identity-canary-${v}`, nodeKey: 'canary', attempt: 0, sampleIndex: s, modelId: MODEL, system: CANARY_SYSTEM, prompt: CANARY_PROMPT, schema: CANARY_SCHEMA })
          .catch(e => ({ ok: false, error: { code: e.code ?? 'ERROR' } }));
        const row = { variant: v, removed: VARIANTS[v], sample: s, ok: !!r.ok, error: r.ok ? null : r.error?.code ?? null, costUsd: r.costUsd ?? 0, ...(r.ok ? assess(r.value) : {}) };
        rows.push(row);
        console.error(`canary ${v} s${s}: ok=${row.ok} ${row.error ?? ''} hostEmail=${row.hostEmail ?? '-'} accountId=${row.accountId ?? '-'} orgId=${row.orgId ?? '-'} emails=${(row.emails ?? []).join(' ')} $${row.costUsd.toFixed(4)}`);
      } } finally { if (configDir) rmSync(configDir, { recursive: true, force: true }); }
    }
  } finally { db.close(); }
  const doc = { at: new Date().toISOString(), model: MODEL, prompt: CANARY_PROMPT, system: CANARY_SYSTEM, note: 'Identity compared by sha256 only; no address or id is stored here.', rows,
    costUsd: Math.round(rows.reduce((s, r) => s + r.costUsd, 0) * 1e6) / 1e6 };
  writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);
  console.error(`wrote ${out}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(`${e.code ?? 'ERROR'}: ${e.message}`); process.exitCode = 1; });
