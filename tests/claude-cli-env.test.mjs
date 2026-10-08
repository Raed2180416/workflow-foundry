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
import { CHILD_ENV_ALLOWED, loadPolicy, validatePolicy } from '../src/models/policy.mjs';
import { ModelPort, modelDigestOf } from '../src/models/port.mjs';
import { ClaudeCliProvider, DEFAULT_CHILD_ENV, claudeChildEnv, childEnvRecord } from '../src/models/providers/claude-cli.mjs';
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
  for (const k of ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'FORCE_PROMPT_CACHING_5M', 'DISABLE_TELEMETRY', 'DISABLE_AUTOUPDATER', 'MAX_THINKING_TOKENS', 'GH_TOKEN']) seen[k] = process.env[k] ?? null;
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(seen) + '\n');
  const model = argv[argv.indexOf('--model') + 1];
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', total_cost_usd: 0.0001, structured_output: { label: 'x' },
    usage: { input_tokens: 10, output_tokens: 2 }, modelUsage: { [model]: { costUSD: 0.0001, canonicalModel: model, costBasis: 'list' } } }));
});
`;

function rig(t, { policy: pol = policy, ambient = {}, script = FAKE, ...options } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-fake-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = path.join(dir, 'claude'), log = path.join(dir, 'log.jsonl');
  writeFileSync(binary, script); chmodSync(binary, 0o755); writeFileSync(log, '');
  const env = { ...process.env, FAKE_CLAUDE_LOG: log, GH_TOKEN: 'placeholder', ...ambient };
  // Every closed-list variable comes from `ambient` only (the session running the tests may export some, e.g. DISABLE_AUTOUPDATER).
  for (const k of CHILD_ENV_ALLOWED) if (!(k in ambient)) delete env[k];
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

// A CLI that dies without a result object, and one that is cancelled mid-call: the journal row of a failed call names the flags too.
const DYING = FAKE.replace("process.stdout.write(JSON.stringify({ type: 'result'", "process.stderr.write('boom'); process.exit(3); process.stdout.write(JSON.stringify({ type: 'result'");
// The slow CLI ignores SIGTERM and starts a helper in its process group that ignores SIGTERM too: only the SIGKILL escalation to the whole
// group ends them, and cancellation must leave neither behind.
const SLOW = String.raw`#!/usr/bin/env node
const fs = require('node:fs'), { spawn } = require('node:child_process');
if (process.argv[2] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
process.on('SIGTERM', () => {});
const helper = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); require('node:fs').appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ helper: process.pid }) + '\\n'); setInterval(() => {}, 1000);"], { stdio: 'ignore' });
process.stdin.resume();
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? null, pid: process.pid, helperPid: helper.pid }) + '\n');
  setInterval(() => {}, 1000);
});
`;
// Alive = present and not a zombie (an orphaned zombie waits for a reaper but runs nothing).
const alive = pid => {
  try { return !/^[ZX]/.test(readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1)); }
  catch (error) { if (error.code !== 'ENOENT') { try { process.kill(pid, 0); return true; } catch { return false; } } return false; }
};
const until = async (check, what, ms = 10000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise(r => setTimeout(r, 20)); } };

test('a failed or cancelled call records the flags in its journal row as well; a cancelled CLI leaves no process behind', { timeout: 30000 }, async t => {
  const dying = rig(t, { script: DYING });
  const failed = await dying.call();
  assert.equal(failed.ok, false); assert.equal(failed.error.code, 'MODEL_PROTOCOL');
  assert.deepEqual(dying.journal.get(failed.journalId).request.providerRequest.env, { [NE]: '1', [CACHE]: '1' });
  assert.equal(dying.seen()[0][NE], '1', 'the dying child still ran with the flags');

  const slow = rig(t, { script: SLOW });
  const controller = new AbortController();
  t.after(() => controller.abort());   // an early assertion failure must not leave the slow CLI running
  const pending = slow.call({ signal: controller.signal });
  await until(() => slow.seen().some(l => l.pid) && slow.seen().some(l => l.helper), 'the slow CLI and its helper');
  const { pid, helperPid } = slow.seen().find(l => l.pid);
  t.after(() => { for (const p of [pid, helperPid]) try { process.kill(p, 'SIGKILL'); } catch {} });
  assert.equal(slow.seen().find(l => l.pid)[NE], '1');
  assert.ok(alive(pid) && alive(helperPid), 'both processes run before the cancellation');
  controller.abort();
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'CANCELLED');
    assert.deepEqual(slow.journal.get(error.details.journalId).request.providerRequest.env, { [NE]: '1', [CACHE]: '1' });
    return true;
  });
  // No orphan: the CLI and its helper both ignore SIGTERM; the group SIGKILL ends them (allow the kernel a moment).
  await until(() => !alive(pid) && !alive(helperPid), 'the cancelled CLI and its helper to exit', 3000);
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

test('the journal records what the child saw: a closed-list variable the block leaves alone is inherited and recorded verbatim', async t => {
  // An empty block under a parent that exports two closed-list variables: the child runs with them, and the record says so
  // (before this, the record was the configured block, {}, and the inherited flags were invisible to an audit).
  const empty = rig(t, { policy: withChildEnv({}), ambient: { [NE]: '0', DISABLE_AUTOUPDATER: '1' } });
  const r = await empty.call();
  assert.equal(empty.seen()[0][NE], '0'); assert.equal(empty.seen()[0].DISABLE_AUTOUPDATER, '1');
  assert.deepEqual(empty.journal.get(r.journalId).request.providerRequest.env, { [NE]: '0', DISABLE_AUTOUPDATER: '1' });
  // The default block plus an inherited DISABLE_AUTOUPDATER: both flags and the inherited variable are on the record.
  const dflt = rig(t, { ambient: { DISABLE_AUTOUPDATER: '1' } });
  const d = await dflt.call();
  assert.deepEqual(dflt.journal.get(d.journalId).request.providerRequest.env, { [NE]: '1', [CACHE]: '1', DISABLE_AUTOUPDATER: '1' });
  // Only closed-list names are ever recorded; the rest of the environment (credentials included) never is.
  assert.deepEqual(childEnvRecord({ PATH: '/bin', GH_TOKEN: 'x', ANTHROPIC_BASE_URL: 'http://x', [CACHE]: '1' }, { [NE]: null }), { [NE]: null, [CACHE]: '1' });
});

test('the policy overrides per flag: null removes an ambient value, "1" sets it; for a named variable the ambient value never wins', async t => {
  const pol = withChildEnv({ [NE]: null, [CACHE]: null, DISABLE_TELEMETRY: '1' });
  const { call, seen, journal } = rig(t, { policy: pol, ambient: { [NE]: '1', [CACHE]: '0' } });
  const r = await call();
  const child = seen()[0];
  assert.equal(child[NE], null, 'null removes the variable from the child even when the parent exports it');
  assert.equal(child[CACHE], null); assert.equal(child.DISABLE_TELEMETRY, '1');
  assert.deepEqual(journal.get(r.journalId).request.providerRequest.env, { [NE]: null, [CACHE]: null, DISABLE_TELEMETRY: '1' });

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
  assert.throws(() => new ClaudeCliProvider({ policy, childEnv: { [NE]: '0' } }), { code: 'MODEL_POLICY_INVALID' }, '"0" is ambiguous');
  // An explicit null is a mistake, not "use the policy" (it used to fall through to the policy block silently).
  assert.throws(() => new ClaudeCliProvider({ policy, childEnv: null }), { code: 'MODEL_POLICY_INVALID' });
  // A Map has no enumerable entries: it must not pass as an empty block (which would silently switch the flags off).
  assert.throws(() => new ClaudeCliProvider({ policy, childEnv: new Map([[NE, '1']]) }), { code: 'MODEL_POLICY_INVALID' });
});

test('claudeChildEnv: scrubbed base, then the block, then the per-call thinking budget', () => {
  const env = claudeChildEnv({ PATH: '/bin', GH_TOKEN: 'x', MAX_THINKING_TOKENS: '99', [NE]: '0' }, { [NE]: '1', [CACHE]: '1', DISABLE_TELEMETRY: null }, 1024);
  assert.deepEqual(env, { PATH: '/bin', [NE]: '1', [CACHE]: '1', MAX_THINKING_TOKENS: '1024' });
});

test('the policy validator accepts only known non-decoding variables with "1" or null, and only on claude-cli', () => {
  const ok = childEnv => { const p = structuredClone(policy); p.providers['claude-cli'].childEnv = childEnv; return validatePolicy(p); };
  assert.doesNotThrow(() => ok({}));
  assert.doesNotThrow(() => ok({ [NE]: '1', [CACHE]: null, DISABLE_TELEMETRY: null, DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1' }));
  // "0" is refused: the CLI reads CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=0 as set (research/review-20261007/cli-flags-20261008/zero-probe.json).
  for (const name of CHILD_ENV_ALLOWED) assert.throws(() => ok({ [name]: '0' }), { code: 'MODEL_POLICY_INVALID' }, `${name}="0"`);
  // Another provider kind never reads childEnv: an inert block (still kept out of the replay key) is refused, not ignored.
  const other = structuredClone(policy), local = Object.keys(other.providers).find(n => other.providers[n].kind !== 'claude-cli');
  assert.ok(local, 'the owner policy lists a non-claude-cli provider');
  other.providers[local].childEnv = { [NE]: '1' };
  assert.throws(() => validatePolicy(other), { code: 'MODEL_POLICY_INVALID' });
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
