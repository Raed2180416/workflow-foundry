import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { requireV2RawFreeModel, requireV2LocalFreeModel, parseOpenCodeV2Events, validateOpenCodeV2Export,
  validateV2WireRequest, classifyV2Status, nativeV2Headers, makeOpenCodeV2Config, openCodeV2SandboxArgs, OpenCodeV2FreeProvider,
  OPENCODE_V2_ALLOWLIST, OPENCODE_V2_VERSION, OPENCODE_V2_BINARY_SHA256, requireOpenCodeV2Binary, requireOpenCodeV2Pin, validateOpenCodeV2Allowlist } from '../src/opencode-v2-free.mjs';
import { combine, linux, bwrap, usrBinNode, opencodeUnlisted } from './support/gates.mjs';

// Source-informed v2 fixtures. Live receipts remain in the isolated study;
// these fixtures contain no benchmark task or hidden evaluation material.
const prompt = 'Return exactly {"ok":true}';
const text = '{"ok":true}';
const tokens = { input: 42, output: 5, reasoning: 0, cache: { read: 0, write: 0 } };
const model = { providerID: 'opencode', id: 'big-pickle', variant: 'default' };
const events = () => [
  { type: 'step_start', timestamp: 1, sessionID: 'ses_fixture', part: { id: 'prt_start', sessionID: 'ses_fixture', messageID: 'msg_assistant', type: 'step-start' } },
  { type: 'text', timestamp: 2, sessionID: 'ses_fixture', part: { id: 'prt_text', sessionID: 'ses_fixture', messageID: 'msg_assistant', type: 'text', text } },
  { type: 'step_finish', timestamp: 3, sessionID: 'ses_fixture', part: { id: 'prt_finish', sessionID: 'ses_fixture', messageID: 'msg_assistant', type: 'step-finish', reason: 'stop', cost: 0, tokens } },
];
const lines = value => value.map(item => JSON.stringify(item)).join('\n') + '\n';
const exported = () => ({
  info: { id: 'ses_fixture', model, agent: 'foundry', cost: 0, tokens, outcome: 'succeeded', location: { directory: '/task' } },
  messages: [
    { id: 'msg_user', type: 'user', text: prompt, time: { created: 1 } },
    { id: 'msg_assistant', type: 'assistant', agent: 'foundry', model, content: [{ type: 'text', text }], cost: 0, tokens, finish: 'stop', time: { created: 1, completed: 3 } },
    { id: 'msg_idle', type: 'idle', outcome: 'succeeded', time: { created: 4 } },
  ],
});
const raw = () => ({ opencode: { id: 'opencode', api: 'https://opencode.ai/zen/v1', npm: '@ai-sdk/openai-compatible', models: {
  'big-pickle': { id: 'big-pickle', cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 } },
} } });
const local = () => ({ data: [{ ...model, modelID: 'big-pickle', status: 'active', enabled: true, variants: [],
  package: '@opencode/ai/providers/openai-compatible', settings: { apiKey: 'public', baseURL: 'http://127.0.0.1:1234/zen/v1' }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] }] });

test('v2 catalog: raw explicit zero prices are mandatory before normalized local prices are accepted', () => {
  assert.equal(requireV2RawFreeModel(raw()).id, 'big-pickle');
  for (const field of ['input', 'output', 'cache_read', 'cache_write']) {
    for (const value of [undefined, '0', null, -1, 0.01]) {
      const changed = raw(); changed.opencode.models['big-pickle'].cost[field] = value;
      assert.throws(() => requireV2RawFreeModel(changed), { code: 'MODEL_NOT_FREE' });
    }
  }
  const tier = raw(); tier.opencode.models['big-pickle'].cost.context_over_200k = { input: 0, output: 0 };
  assert.throws(() => requireV2RawFreeModel(tier), { code: 'MODEL_NOT_FREE' });
  const deprecated = raw(); deprecated.opencode.models['big-pickle'].status = 'deprecated';
  assert.throws(() => requireV2RawFreeModel(deprecated), { code: 'MODEL_CATALOG' });
  const redirect = raw(); redirect.opencode.api = 'https://elsewhere.invalid';
  assert.throws(() => requireV2RawFreeModel(redirect), { code: 'MODEL_CATALOG' });
  assert.throws(() => requireV2RawFreeModel(raw(), 'opencode/guessed-free'), { code: 'MODEL_ID' });
  assert.equal(requireV2LocalFreeModel(local(), 'http://127.0.0.1:1234/zen/v1').id, 'big-pickle');
  const normalized = local(); delete normalized.data[0].cost[0].cache.write;
  assert.throws(() => requireV2LocalFreeModel(normalized, 'http://127.0.0.1:1234/zen/v1'), { code: 'MODEL_NOT_FREE' });
  assert.throws(() => requireV2LocalFreeModel({ data: [] }, 'http://127.0.0.1:1234/zen/v1'), { code: 'MODEL_CATALOG' });
});

test('v2 event parser accepts a complete native step and independently agrees with native export', () => {
  const parsed = parseOpenCodeV2Events(lines(events()));
  assert.equal(parsed.text, text);
  assert.deepEqual(validateOpenCodeV2Export(exported(), parsed, prompt), { text, sessionID: 'ses_fixture', reportedCost: 0, tokens });
});

test('v2 fast-response reconciliation requires a terminal native export when step events were not delivered', () => {
  const projected = events()[1];
  projected.part.id = 'prt_assistant_text-0'; projected.part.time = { start: 1, end: 3 };
  assert.throws(() => parseOpenCodeV2Events(lines([projected])), { code: 'MODEL_INCOMPLETE' });
  const parsed = parseOpenCodeV2Events(lines([projected]), { allowProjection: true });
  assert.equal(parsed.completionWitness, 'export-required'); assert.equal(parsed.tokens, undefined);
  assert.equal(validateOpenCodeV2Export(exported(), parsed, prompt).reportedCost, 0);
  const missing = exported(); delete missing.info.outcome;
  assert.throws(() => validateOpenCodeV2Export(missing, parsed, prompt), { code: 'MODEL_DRIFT' });
  const usageMissing = exported(); delete usageMissing.info.tokens; delete usageMissing.messages[1].tokens;
  assert.throws(() => validateOpenCodeV2Export(usageMissing, parsed, prompt), { code: 'MODEL_USAGE_UNKNOWN' });
  const changed = exported(); changed.info.model = { ...model, variant: 'high' };
  assert.throws(() => validateOpenCodeV2Export(changed, parsed, prompt), { code: 'MODEL_DRIFT' });
});

test('v2 native start plus reconciled text still requires matching durable finish, usage and zero cost', () => {
  const list = events().slice(0, 2);
  list[1].part.id = 'prt_assistant_text-0'; list[1].part.time = { start: 1, end: 3 };
  assert.throws(() => parseOpenCodeV2Events(lines(list)), { code: 'MODEL_INCOMPLETE' });
  const parsed = parseOpenCodeV2Events(lines(list), { allowProjection: true });
  assert.equal(parsed.completionWitness, 'export-required');
  assert.equal(parsed.tokens, undefined);
  assert.equal(validateOpenCodeV2Export(exported(), parsed, prompt).reportedCost, 0);
  for (const change of [
    data => { data.messages[1].finish = 'length'; },
    data => { delete data.messages[1].time.completed; },
    data => { delete data.info.tokens; },
    data => { data.messages[1].cost = 1; },
    data => { data.messages[1].content.push({ type: 'tool' }); },
    data => { data.messages[1].content[0].text = 'different'; },
  ]) { const data = exported(); change(data); assert.throws(() => validateOpenCodeV2Export(data, parsed, prompt)); }
  assert.throws(() => parseOpenCodeV2Events(lines([list[1], list[0]]), { allowProjection: true }));
  const extraStart = structuredClone(list[0]); extraStart.part.id = 'prt_start_2';
  assert.throws(() => parseOpenCodeV2Events(lines([list[0], extraStart, list[1]]), { allowProjection: true }));
  const unprojected = structuredClone(list); unprojected[1].part.id = 'prt_ordinary';
  assert.throws(() => parseOpenCodeV2Events(lines(unprojected), { allowProjection: true }));
});

test('v2 event parser rejects incomplete, duplicate, mixed-session, tool, nonzero/unknown-cost and legacy evidence', () => {
  for (const change of [
    list => list.pop(), list => list.push(list.at(-1)), list => { list[2].part.reason = 'length'; },
    list => { list[2].part.cost = undefined; }, list => { list[2].part.cost = 1; },
    list => { list[1].sessionID = 'ses_other'; }, list => { list[1].part.messageID = 'msg_other'; },
    list => { list[1].type = 'tool_use'; }, list => { list[1].part.id = list[0].part.id; },
    list => { list[0].timestamp = undefined; }, list => { list[2].part.type = 'finish'; },
    list => { list[1].part.text = undefined; }, list => { list[1].type = 'unexpected'; },
  ]) { const list = events(); change(list); assert.throws(() => parseOpenCodeV2Events(lines(list))); }
  assert.throws(() => parseOpenCodeV2Events('not json\n'), { code: 'MODEL_PROTOCOL' });
  assert.throws(() => parseOpenCodeV2Events(''), { code: 'MODEL_INCOMPLETE' });
});

test('v2 export rejects self-claims without matching prompt/model/terminal/cost/text/token evidence and rejects retries', () => {
  const parsed = parseOpenCodeV2Events(lines(events()));
  for (const change of [
    data => { data.info.model = { ...model, id: 'other' }; }, data => { data.info.cost = undefined; },
    data => { data.info.outcome = 'failed'; }, data => { data.messages[0].text = 'different prompt'; },
    data => { data.messages[1].content[0].text = 'claim only'; }, data => { data.messages[1].finish = 'length'; },
    data => { data.messages[1].tokens = { ...tokens, input: 9 }; }, data => { data.messages[1].retry = { attempt: 2 }; },
    data => { data.messages[1].content.push({ type: 'tool' }); }, data => { data.messages[1].time.completed = undefined; },
    data => data.messages.pop(), data => data.messages.push({ type: 'system', text: 'extra' }),
  ]) { const data = exported(); change(data); assert.throws(() => validateOpenCodeV2Export(data, parsed, prompt)); }
  assert.throws(() => validateOpenCodeV2Export({ info: { id: 'ses_fixture' }, messages: [{ info: { role: 'assistant' } }] }, parsed, prompt));
});

test('v2 wire admission requires the selected model, exact prompt, bounded tokens and no tools or prior conversation', () => {
  const request = () => ({ model: 'big-pickle', stream: true, max_tokens: 128, messages: [{ role: 'system', content: 'format only' }, { role: 'user', content: prompt }] });
  const options = { prompt, maxOutputTokens: 128 };
  assert.equal(validateV2WireRequest(request(), options).model, 'big-pickle');
  for (const change of [
    data => { data.model = 'paid'; }, data => { data.stream = false; }, data => { data.max_tokens = undefined; },
    data => { data.max_tokens = 129; }, data => { data.tools = [{ type: 'function' }]; }, data => { data.tool_choice = 'auto'; },
    data => { data.messages[1].content = 'altered'; }, data => data.messages.push({ role: 'assistant', content: 'older' }),
    data => { data.functions = []; }, data => { data.messages[0].tool_calls = []; },
  ]) { const data = request(); change(data); assert.throws(() => validateV2WireRequest(data, options)); }
});

test('v2 configuration disables all tool plugins; sandbox has no host-network, home or caller-directory mounts', () => {
  const config = makeOpenCodeV2Config('http://127.0.0.1:1234/zen/v1', 128);
  assert.equal(config.plugins[0], '-*');
  assert.ok(config.plugins.slice(1).every(name => !name.includes('tool')));
  assert.deepEqual(config.providers.opencode.body, { max_tokens: 128, tools: [], tool_choice: 'none' });
  assert.equal(config.agents.foundry.steps, 2);
  const args = openCodeV2SandboxArgs('/receipt/root');
  assert.ok(args.includes('--unshare-all')); assert.ok(!args.includes('--share-net'));
  assert.ok(!args.includes('/home/raed')); assert.ok(!args.includes('/run')); assert.ok(!args.includes('/etc'));
  assert.ok(args.includes('/bridge')); assert.ok(args.includes('/receipt/root/task'));
  assert.equal(args.at(-1), '--sandbox-driver');
});

test('v2 structured HTTP failures distinguish limits/auth/unavailable and never promote provider error text to instructions', () => {
  for (const [status, code] of [[429, 'MODEL_RATE_LIMIT'], [401, 'MODEL_AUTH_REQUIRED'], [403, 'MODEL_AUTH_REQUIRED'], [503, 'MODEL_UNAVAILABLE']]) {
    const error = classifyV2Status(status, '90'); assert.equal(error.code, code);
    assert.equal(error.details.retryAfterSeconds, 90); assert.equal(error.details.automaticRetry, false);
  }
  assert.equal(classifyV2Status(429, 'secret-like-provider-text').details.retryAfterSeconds, null);
});

test('v2 constructor rejects an unsupported model and unbounded budgets before any external call', () => {
  assert.throws(() => new OpenCodeV2FreeProvider({ model: 'guessed/default' }), { code: 'MODEL_ID' });
  assert.throws(() => new OpenCodeV2FreeProvider({ timeoutMs: Infinity }), { code: 'MODEL_BUDGET' });
  assert.throws(() => new OpenCodeV2FreeProvider({ maxOutputTokens: 100000 }), { code: 'MODEL_BUDGET' });
});

test('v2 bridge preserves native client identity while discarding authorization, cookies and unrelated headers', () => {
  const headers = { 'user-agent': 'opencode/2.0.5', 'x-opencode-project': 'global', 'x-opencode-session': 'ses_fixture',
    'x-opencode-client': 'opencode', 'x-session-id': 'ses_fixture', 'x-session-affinity': 'ses_fixture',
    authorization: 'must-not-be-forwarded', cookie: 'must-not-be-forwarded', 'x-other': 'irrelevant' };
  const selected = nativeV2Headers(headers);
  assert.equal(selected['user-agent'], headers['user-agent']); assert.equal(selected['x-opencode-session'], 'ses_fixture');
  assert.ok(!Object.hasOwn(selected, 'authorization')); assert.ok(!Object.hasOwn(selected, 'cookie')); assert.ok(!Object.hasOwn(selected, 'x-other'));
  assert.throws(() => nativeV2Headers({ ...headers, 'user-agent': undefined }), { code: 'MODEL_HEADER_DRIFT' });
  assert.throws(() => nativeV2Headers({ ...headers, 'x-opencode-client': 'bad\r\nvalue' }), { code: 'MODEL_HEADER_DRIFT' });
});

// Provider pin (ROADMAP §5.0). These exercise the exact functions the
// constructor (digest stage), the sandbox driver and the post-run check call.
const pinned = OPENCODE_V2_ALLOWLIST[0];
const otherSHA = 'b'.repeat(64);
const drift = pattern => error => error.code === 'MODEL_BINARY_DRIFT' && /OPENCODE_V2_ALLOWLIST/.test(error.message) && pattern.test(error.message) &&
  Array.isArray(error.details?.allowlist) && error.details.allowlist.length >= 1;

test('v2 provider pin: the allowlist is frozen, exact, evidenced and keeps the v2.0.5 compatibility names', () => {
  assert.ok(Object.isFrozen(OPENCODE_V2_ALLOWLIST)); assert.ok(OPENCODE_V2_ALLOWLIST.every(Object.isFrozen));
  assert.deepEqual(OPENCODE_V2_ALLOWLIST.map(entry => entry.version), ['opencode v2.0.5']);
  assert.equal(pinned.sha256, 'a7568b505c1fce84d329c709b5661da11a778b0e06959e34147a916111cc5be4');
  assert.equal(OPENCODE_V2_VERSION, pinned.version); assert.equal(OPENCODE_V2_BINARY_SHA256, pinned.sha256);
  assert.throws(() => { OPENCODE_V2_ALLOWLIST.push({ version: 'opencode v2.0.23', sha256: otherSHA, evidence: 'x' }); }, TypeError);
  assert.throws(() => { pinned.sha256 = otherSHA; }, TypeError);
  assert.equal(validateOpenCodeV2Allowlist(OPENCODE_V2_ALLOWLIST), OPENCODE_V2_ALLOWLIST);
  for (const bad of [[], [{ ...pinned, evidence: '' }], [{ ...pinned, sha256: pinned.sha256.toUpperCase() }], [{ ...pinned, version: 'v2.0.5' }],
    [{ ...pinned, version: 'opencode v2.*' }], [{ ...pinned, version: 'opencode >=2.0.5' }], [pinned, { ...pinned, version: 'opencode v2.0.6' }]])
    assert.throws(() => validateOpenCodeV2Allowlist(bad), { code: 'MODEL_BINARY_ALLOWLIST' });
});

test('v2 provider pin: an unlisted binary digest is rejected with MODEL_BINARY_DRIFT naming the allowlist', () => {
  for (const sha256 of [otherSHA, pinned.sha256.slice(0, 63) + '0', pinned.sha256.toUpperCase(), '', undefined, null]) {
    assert.throws(() => requireOpenCodeV2Binary(sha256), drift(/not on OPENCODE_V2_ALLOWLIST/));
    // Even reporting the exact listed version cannot admit an unlisted digest.
    assert.throws(() => requireOpenCodeV2Pin({ sha256, version: pinned.version }), drift(/not on OPENCODE_V2_ALLOWLIST/));
  }
  const error = (() => { try { requireOpenCodeV2Binary(otherSHA); } catch (caught) { return caught; } })();
  assert.match(error.message, new RegExp(`${pinned.version} sha256:${pinned.sha256}`));
  assert.equal(error.details.observedSHA256, otherSHA);
  assert.deepEqual(error.details.allowlist, [{ version: pinned.version, sha256: pinned.sha256, evidence: pinned.evidence }]);
});

test('v2 provider pin: a listed digest with a mismatched reported version is rejected (no open-ended version detection)', () => {
  for (const version of ['opencode v2.0.23', 'opencode v2.0.50', 'opencode v2.0.5-1.1', 'opencode v2.0.5 ', ' opencode v2.0.5', 'opencode v2.0', 'v2.0.5', '2.0.5', 'opencode V2.0.5', '', undefined, null, 205])
    assert.throws(() => requireOpenCodeV2Pin({ sha256: pinned.sha256, version }), drift(/reported version/));
  assert.throws(() => requireOpenCodeV2Pin({ version: pinned.version }), drift(/not on OPENCODE_V2_ALLOWLIST/));
  assert.throws(() => requireOpenCodeV2Pin(), drift(/not on OPENCODE_V2_ALLOWLIST/));
});

test('v2 provider pin: a listed pair is accepted and digest/version must come from the SAME entry', () => {
  assert.equal(requireOpenCodeV2Binary(pinned.sha256), pinned);
  assert.equal(requireOpenCodeV2Pin({ sha256: pinned.sha256, version: pinned.version }), pinned);
  // A synthetic two-entry allowlist: each half of the pair is listed, but in
  // different entries, so a cross-entry combination must still be refused.
  const second = Object.freeze({ version: 'opencode v9.9.9', sha256: otherSHA, evidence: `${'0'.repeat(40)}:synthetic/receipt.json` });
  const two = validateOpenCodeV2Allowlist(Object.freeze([pinned, second]));
  assert.equal(requireOpenCodeV2Pin({ sha256: otherSHA, version: second.version }, two), second);
  assert.equal(requireOpenCodeV2Pin({ sha256: pinned.sha256, version: pinned.version }, two), pinned);
  assert.throws(() => requireOpenCodeV2Pin({ sha256: pinned.sha256, version: second.version }, two), drift(/reported version/));
  assert.throws(() => requireOpenCodeV2Pin({ sha256: otherSHA, version: pinned.version }, two), drift(/reported version/));
  // The production allowlist does not contain the synthetic entry.
  assert.throws(() => requireOpenCodeV2Pin({ sha256: otherSHA, version: second.version }), drift(/not on OPENCODE_V2_ALLOWLIST/));
});

const pinEvidence = (() => {
  const [commit, file] = pinned.evidence.split(/:(.*)/s);
  const shown = spawnSync('git', ['show', `${commit}:${file}`], { cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (shown.error) return { skip: `requires git to read the pin evidence receipt (${shown.error.code})` };
  if (shown.status !== 0) return { skip: `requires git history containing ${commit.slice(0, 12)} (shallow or exported checkout; receipt also in release evidence-20261006)` };
  return { text: shown.stdout };
})();
test('v2 provider pin: the evidence receipt cited for the v2.0.5 pair records that exact digest and version', { skip: pinEvidence.skip ?? false }, () => {
  const audit = JSON.parse(pinEvidence.text);
  assert.equal(audit.binarySHA256, pinned.sha256); assert.equal(audit.version, pinned.version); assert.equal(audit.model, 'opencode/big-pickle');
});

// Synthetic host: only the existence/identity of the three host paths and the
// bytes of /usr/bin/opencode are supplied; nothing is executed. The constructor's
// own digest stage must refuse the unlisted binary and name the allowlist.
test('v2 provider pin: the constructor refuses a synthetic unlisted /usr/bin/opencode before any execution', { skip: linux() }, t => {
  const host = new Set(['/usr/bin/bwrap', '/usr/bin/opencode', '/usr/bin/node']);
  const bytes = Buffer.from('synthetic unlisted opencode binary; never executed');
  const { existsSync, realpathSync, readFileSync } = fs;
  const mocks = [
    t.mock.method(fs, 'existsSync', file => host.has(file) || existsSync(file)),
    t.mock.method(fs, 'realpathSync', (file, ...rest) => host.has(file) ? file : realpathSync(file, ...rest)),
    t.mock.method(fs, 'readFileSync', (file, ...rest) => file === '/usr/bin/opencode' ? bytes : readFileSync(file, ...rest)),
  ];
  const spawned = t.mock.method(fs, 'openSync', () => assert.fail('The constructor must not open or execute anything'));
  syncBuiltinESMExports();
  t.after(() => { for (const mock of [...mocks, spawned]) mock.mock.restore(); syncBuiltinESMExports(); });
  assert.throws(() => new OpenCodeV2FreeProvider({ timeoutMs: 1000 }), drift(/not on OPENCODE_V2_ALLOWLIST/));
  assert.ok(mocks[2].mock.calls.some(call => call.arguments[0] === '/usr/bin/opencode'), 'the installed binary bytes were hashed');
});

test('v2 provider pin: the real constructor refuses an installed but unlisted OpenCode before any execution', { skip: combine(linux, bwrap, usrBinNode, opencodeUnlisted) }, () => {
  assert.throws(() => new OpenCodeV2FreeProvider({ timeoutMs: 1000 }), drift(/not on OPENCODE_V2_ALLOWLIST|not a link/));
});
