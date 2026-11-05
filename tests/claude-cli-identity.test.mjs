// claude-cli provider: no account identity in the child (research/tracker-20261021/RESULT-TRACKER.md §11, review B2; register C7).
// A local fake binary stands in for the CLI and mimics the observed behaviour of claude 2.1.318: the user-context e-mail is the
// account stored in the global config (CLAUDE_CONFIG_DIR, else HOME) or, failing that, CLAUDE_CODE_USER_EMAIL. No network, no model.
// The address below is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { ClaudeCliProvider, isolatedEnv, IDENTITY_ENV } from '../src/models/providers/claude-cli.mjs';
import { Journal } from '../src/journal.mjs';

const { policy } = loadPolicy();
const HAIKU = 'claude-haiku-5-5';
const ADDR = 'host.person@mailhost.test';
const schema = { type: 'object', properties: { email: { type: ['string', 'null'] } }, required: ['email'], additionalProperties: false };

const FAKE = String.raw`#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
process.stdin.resume();
process.stdin.on('end', () => {
  const dir = process.env.CLAUDE_CONFIG_DIR, file = dir ? path.join(dir, '.claude.json') : path.join(process.env.HOME, '.claude.json');
  let stored = null;
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount?.emailAddress ?? null; } catch {}
  const email = stored ?? process.env.CLAUDE_CODE_USER_EMAIL ?? null;
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ email, configDir: dir ?? null, configDirExists: dir ? fs.existsSync(dir) : null,
    configDirEmpty: dir ? fs.readdirSync(dir).length === 0 : null, cwd: process.cwd(), account: process.env.CLAUDE_CODE_ACCOUNT_UUID ?? null,
    org: process.env.CLAUDE_CODE_ORGANIZATION_UUID ?? null }) + '\n');
  const model = argv[argv.indexOf('--model') + 1];
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', total_cost_usd: 0.0001, structured_output: { email },
    usage: { input_tokens: 10, output_tokens: 2 }, modelUsage: { [model]: { costUSD: 0.0001, canonicalModel: model, costBasis: 'list' } } }));
});
`;

function rig(t, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-fake-identity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  mkdirSync(home);
  writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: ADDR, accountUuid: 'a-1', organizationUuid: 'o-1' } }));
  const binary = path.join(dir, 'claude'), log = path.join(dir, 'log.jsonl');
  writeFileSync(binary, FAKE); chmodSync(binary, 0o755); writeFileSync(log, '');
  const env = { PATH: process.env.PATH, HOME: home, FAKE_CLAUDE_LOG: log, CLAUDE_CODE_USER_EMAIL: ADDR, CLAUDE_CODE_ACCOUNT_UUID: 'a-1', CLAUDE_CODE_ORGANIZATION_UUID: 'o-1' };
  const provider = new ClaudeCliProvider({ policy, binary, env, ...options });
  const journal = new Journal(new DatabaseSync(':memory:'));
  const port = new ModelPort({ policy, journal, providers: { 'claude-cli': provider } });
  let n = 0;
  const call = () => port.call({ runId: 'r', nodeKey: `n${n++}`, attempt: 0, modelId: HAIKU, system: 's', prompt: 'p', schema, decoding: { reasoning: 'none' } });
  const seen = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return { call, seen, journal };
}

test('by default the child sees no account identity: an empty config directory of its own and no identity variables', async t => {
  const { call, seen, journal } = rig(t);
  const r = await call();
  assert.equal(r.ok, true);
  assert.equal(r.value.email, null, 'neither the stored account nor the variable reaches the child');
  const child = seen()[0];
  assert.equal(child.account, null); assert.equal(child.org, null);
  assert.equal(child.configDirExists, true); assert.equal(child.configDirEmpty, true);
  assert.notEqual(path.dirname(child.configDir), child.cwd, 'the config directory sits beside the cwd, which stays empty');
  assert.match(path.basename(child.configDir), /^foundry-claude-config-/);
  assert.equal(existsSync(child.configDir), false, 'and is removed after the call');
  assert.equal(existsSync(child.cwd), false);
  assert.equal(journal.get(r.journalId).request.providerRequest.identity, 'isolated', 'the journal records the mode');
});

test("identity 'inherit' restores the old behaviour (an A/B measurement only): the stored account reaches the child", async t => {
  const { call, journal } = rig(t, { identity: 'inherit' });
  const r = await call();
  assert.equal(r.value.email, ADDR);
  assert.equal(journal.get(r.journalId).request.providerRequest.identity, 'inherit');
});

test('removing the variables alone is not enough (the canary\'s finding): the stored account still reaches the child', async t => {
  // No identity variables, but the config directory inherited: the stored account still answers.
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-fake-identity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  mkdirSync(home);
  writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: ADDR } }));
  const binary = path.join(dir, 'claude'), log = path.join(dir, 'log.jsonl');
  writeFileSync(binary, FAKE); chmodSync(binary, 0o755); writeFileSync(log, '');
  const provider = new ClaudeCliProvider({ policy, binary, identity: 'inherit', env: { PATH: process.env.PATH, HOME: home, FAKE_CLAUDE_LOG: log } });
  const port = new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': provider } });
  const r = await port.call({ runId: 'r', nodeKey: 'x', attempt: 0, modelId: HAIKU, system: 's', prompt: 'p', schema, decoding: { reasoning: 'none' } });
  assert.equal(r.value.email, ADDR);
});

test('isolatedEnv drops every identity variable and sets the config directory; an unknown mode is refused', () => {
  const env = isolatedEnv({ PATH: '/bin', CLAUDE_CODE_USER_EMAIL: ADDR, CLAUDE_CODE_ACCOUNT_UUID: 'a', CLAUDE_CODE_ORGANIZATION_UUID: 'o', CLAUDE_CODE_ACCOUNT_TAGGED_ID: 't', CLAUDE_CONFIG_DIR: '/home/x/.claude' }, '/tmp/c');
  assert.deepEqual(env, { PATH: '/bin', CLAUDE_CONFIG_DIR: '/tmp/c' });
  assert.ok(IDENTITY_ENV.test('CLAUDE_CODE_USER_EMAIL') && !IDENTITY_ENV.test('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'));
  assert.throws(() => new ClaudeCliProvider({ policy, identity: 'none' }), /identity must be one of/);
});
