// claude-cli provider child environment (research/review-20261007/04-efficiency-rust.md, change 1; synthesis §3.14):
// CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 and FORCE_PROMPT_CACHING_5M=1 are set for the child by default, configurable
// in the policy provider config (`childEnv`), recorded in the journal request, and kept out of the replay key.
// A local fake binary stands in for the CLI: no network, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPolicy, validatePolicy } from '../src/models/policy.mjs';
import { ModelPort, modelDigestOf } from '../src/models/port.mjs';
import { ClaudeCliProvider, DEFAULT_CHILD_ENV, claudeChildEnv } from '../src/models/providers/claude-cli.mjs';
import { Journal } from '../src/journal.mjs';

const { policy } = loadPolicy();
const HAIKU = 'claude-haiku-5-5';
const schema = { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false };
const NE = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', CACHE = 'FORCE_PROMPT_CACHING_5M';

const FAKE = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const seen = {};
  for (const k of ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'FORCE_PROMPT_CACHING_5M', 'DISABLE_TELEMETRY', 'MAX_THINKING_TOKENS', 'GH_TOKEN']) seen[k] = process.env[k] ?? null;
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(seen) + '\n');
  const model = argv[argv.indexOf('--model') + 1];
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', total_cost_usd: 0.0001, structured_output: { label: 'x' },
    usage: { input_tokens: 10, output_tokens: 2 }, modelUsage: { [model]: { costUSD: 0.0001, canonicalModel: model, costBasis: 'list' } } }));
});
`;

function rig(t, { policy: pol = policy, ambient = {}, ...options } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-fake-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = path.join(dir, 'claude'), log = path.join(dir, 'log.jsonl');
  writeFileSync(binary, FAKE); chmodSync(binary, 0o755); writeFileSync(log, '');
  const env = { ...process.env, FAKE_CLAUDE_LOG: log, GH_TOKEN: 'placeholder', ...ambient };
  for (const k of [NE, CACHE, 'DISABLE_TELEMETRY']) if (!(k in ambient)) delete env[k];
  const provider = new ClaudeCliProvider({ policy: pol, binary, env, ...options });
  const journal = new Journal(new DatabaseSync(':memory:'));
  const port = new ModelPort({ policy: pol, journal, providers: { 'claude-cli': provider } });
  let n = 0;
  const call = (over = {}) => port.call({ runId: 'r', nodeKey: `n${n++}`, attempt: 1, modelId: HAIKU, system: 's', prompt: 'p', schema, decoding: { reasoning: 'none' }, ...over });
  const seen = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return { provider, journal, port, call, seen };
}
const withChildEnv = childEnv => { const p = structuredClone(policy); if (childEnv === undefined) delete p.providers['claude-cli'].childEnv; else p.providers['claude-cli'].childEnv = childEnv; return p; };

test('the owner policy carries the two flags, and the child process sees them by default', async t => {
  assert.deepEqual(policy.providers['claude-cli'].childEnv, { [NE]: '1', [CACHE]: '1' });
  assert.deepEqual(DEFAULT_CHILD_ENV, { [NE]: '1', [CACHE]: '1' });
  const { call, seen, journal } = rig(t);
  const r = await call();
  assert.equal(r.ok, true);
  const child = seen()[0];
  assert.equal(child[NE], '1'); assert.equal(child[CACHE], '1');
  assert.equal(child.MAX_THINKING_TOKENS, '0', 'the decoding-driven variable is still set per call');
  assert.equal(child.GH_TOKEN, null, 'repository credentials are still scrubbed');
  assert.deepEqual(journal.get(r.journalId).request.providerRequest.env, { [NE]: '1', [CACHE]: '1' }, 'the flags are auditable in the journal request');
});

test('a policy without a childEnv block still gets the defaults; an empty block sets nothing', async t => {
  const absent = rig(t, { policy: withChildEnv(undefined) });
  await absent.call();
  assert.equal(absent.seen()[0][NE], '1'); assert.equal(absent.seen()[0][CACHE], '1');

  const empty = rig(t, { policy: withChildEnv({}) });
  const r = await empty.call();
  assert.equal(empty.seen()[0][NE], null); assert.equal(empty.seen()[0][CACHE], null);
  assert.deepEqual(empty.journal.get(r.journalId).request.providerRequest.env, {});
});

test('the policy overrides per flag: "0" sets it off, null removes an ambient value; the ambient value never wins', async t => {
  const pol = withChildEnv({ [NE]: null, [CACHE]: '0', DISABLE_TELEMETRY: '1' });
  const { call, seen, journal } = rig(t, { policy: pol, ambient: { [NE]: '1', [CACHE]: '1' } });
  const r = await call();
  const child = seen()[0];
  assert.equal(child[NE], null, 'null removes the variable from the child even when the parent exports it');
  assert.equal(child[CACHE], '0'); assert.equal(child.DISABLE_TELEMETRY, '1');
  assert.deepEqual(journal.get(r.journalId).request.providerRequest.env, { [NE]: null, [CACHE]: '0', DISABLE_TELEMETRY: '1' });

  const dflt = rig(t, { ambient: { [NE]: '0', [CACHE]: '0' } });
  await dflt.call();
  assert.equal(dflt.seen()[0][NE], '1', 'the policy value wins over an inherited one, so every run is the same configuration');
  assert.equal(dflt.seen()[0][CACHE], '1');
});

test('the constructor option replaces the policy block (an A/B measurement can switch the flags off)', async t => {
  const off = rig(t, { childEnv: { [NE]: null, [CACHE]: null }, ambient: { [NE]: '1' } });
  const r = await off.call();
  assert.equal(off.seen()[0][NE], null); assert.equal(off.seen()[0][CACHE], null);
  assert.deepEqual(off.journal.get(r.journalId).request.providerRequest.env, { [NE]: null, [CACHE]: null });
  assert.throws(() => new ClaudeCliProvider({ policy, childEnv: { ANTHROPIC_MODEL: 'x' } }), { code: 'MODEL_POLICY_INVALID' });
  assert.throws(() => new ClaudeCliProvider({ policy, childEnv: 'yes' }), { code: 'MODEL_POLICY_INVALID' });
});

test('claudeChildEnv: scrubbed base, then the block, then the per-call thinking budget', () => {
  const env = claudeChildEnv({ PATH: '/bin', GH_TOKEN: 'x', MAX_THINKING_TOKENS: '99', [NE]: '0' }, { [NE]: '1', [CACHE]: '1', DISABLE_TELEMETRY: null }, 1024);
  assert.deepEqual(env, { PATH: '/bin', [NE]: '1', [CACHE]: '1', MAX_THINKING_TOKENS: '1024' });
});

test('the policy validator accepts only known non-decoding variables with "0", "1" or null', () => {
  const ok = childEnv => { const p = structuredClone(policy); p.providers['claude-cli'].childEnv = childEnv; return validatePolicy(p); };
  assert.doesNotThrow(() => ok({}));
  assert.doesNotThrow(() => ok({ [NE]: '1', [CACHE]: '0', DISABLE_TELEMETRY: null, DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1' }));
  const bad = {
    'not an object': 'yes', 'array': [NE], 'null block': null,
    'model override': { ANTHROPIC_MODEL: 'claude-opus-5-5' }, 'base url': { ANTHROPIC_BASE_URL: 'http://x' }, 'api key': { ANTHROPIC_API_KEY: 'k' },
    'thinking budget': { MAX_THINKING_TOKENS: '0' }, 'effort': { CLAUDE_EFFORT: 'low' }, 'credential-like': { GH_TOKEN: '1' },
    'unknown claude flag': { CLAUDE_CODE_DISABLE_THINKING: '1' }, 'lowercase name': { [NE.toLowerCase()]: '1' },
    'non-boolean value': { [NE]: 'true' }, 'number value': { [NE]: 1 }, 'long value': { [NE]: '1'.repeat(40) },
  };
  for (const [name, childEnv] of Object.entries(bad)) assert.throws(() => ok(childEnv), { code: 'MODEL_POLICY_INVALID' }, name);
});

// The provider config of claude-cli and the claude-haiku-5-5 entry exactly as they were before this change (HEAD c983182).
// The digest is what every existing journal's replay keys were computed from; it must not move.
const OLD_CONFIG = { kind: 'claude-cli', binary: 'claude', auth: "the cloud session's own managed Claude Code login; no API key is read or stored",
  invocation: ['-p', '--output-format', 'json', '--no-session-persistence', '--safe-mode', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--tools', ''],
  features: { jsonSchema: true, toolChoiceRequired: false, reasoningThenFormat: true } };
const OLD_ENTRY = { id: 'claude-haiku-5-5', class: 'M', family: 'claude', provider: 'claude-cli', price: { inputPerMTok: 0.1, outputPerMTok: 0.5, source: 'x' } };
const OLD_DIGEST = '205cf9250137614c133c91b6120023d4cf45496eab94d5bf0c2e81d2bfc1c882';

test('the child environment never enters the replay key: existing journals keep replaying', async t => {
  assert.equal(modelDigestOf(OLD_ENTRY, OLD_CONFIG), OLD_DIGEST, 'pre-change digest (reference value)');
  assert.equal(modelDigestOf(OLD_ENTRY, { ...OLD_CONFIG, childEnv: { [NE]: '1', [CACHE]: '1' } }), OLD_DIGEST);
  assert.equal(modelDigestOf(OLD_ENTRY, { ...OLD_CONFIG, childEnv: {} }), OLD_DIGEST);
  const live = policy.providers['claude-cli'], { childEnv, ...without } = live;
  assert.ok(childEnv);
  assert.equal(modelDigestOf(policy.models.find(m => m.id === HAIKU), live), modelDigestOf(policy.models.find(m => m.id === HAIKU), without));

  // End to end: a call recorded under the flags-on policy replays under a flags-off policy, with zero provider calls.
  const on = rig(t), first = await on.call({ nodeKey: 'same' });
  const offPolicy = withChildEnv({});
  const off = new ModelPort({ policy: offPolicy, journal: on.journal, mode: 'replay', salt: 'r', providers: {} });
  const replayed = await off.call({ runId: 'r', nodeKey: 'same', attempt: 1, modelId: HAIKU, system: 's', prompt: 'p', schema, decoding: { reasoning: 'none' } });
  assert.equal(replayed.replayed, true); assert.equal(replayed.replayKey, first.replayKey); assert.deepEqual(replayed.value, first.value);
  assert.equal(on.seen().length, 1);
});

test('the flags do not change the decoding the provider reports', () => {
  const a = new ClaudeCliProvider({ policy }), b = new ClaudeCliProvider({ policy, childEnv: {} });
  for (const reasoning of ['none', 'low', 'medium', 'high']) assert.deepEqual(a.effectiveDecoding({ reasoning }), b.effectiveDecoding({ reasoning }));
});
