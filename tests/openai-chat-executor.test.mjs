// The remote OpenAI-compatible chat executor (src/executors/openai-chat.mjs; research/mercury-20261021/) and its policy
// kind (openai-chat-https, executorModels[]). $0: every endpoint here is a loopback fake; no key, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPolicy, validatePolicy, executorModelById, sessionModelById, modelById, modelsForClass, REMOTE_CHAT_KIND } from '../src/models/policy.mjs';
import { runOpenAIChat, executorForModel, classifyHttp, redact, priceUsage, OPENAI_CHAT_KEEP_RO, TOOL_OUTPUT_MAX_CHARS, EXECUTOR_KIND } from '../src/executors/openai-chat.mjs';
import { runClaudeCode, sandboxAvailable, nestedModelUses, streamUsageOf, CLOUD_LOGIN_FILE, DEFAULT_KEEP_RO } from '../src/executors/claude-code.mjs';
import { auditSession, readStream } from '../experiments/autobench/accounting.mjs';
import { ENV_FAULTS } from '../experiments/lib/runner.mjs';

const live = sandboxAvailable() ? false : 'user/mount/pid namespaces are not available here';
const { policy } = loadPolicy();
const mutable = () => structuredClone(policy);
const KEY = 'test-only-key-not-a-secret-7f3a';
const hostEnv = (extra = {}) => ({ ...process.env, INCEPTION_API_KEY: KEY, ...extra });
const tmpRoot = () => mkdtempSync(path.join(tmpdir(), 'foundry-oc-'));
const FAST_RETRY = { attempts: 3, baseDelayMs: 20, maxDelayMs: 200 };

// A scripted chat.completions endpoint on loopback. `script` is a list of steps, one per request: an object
// { status?, body?, headers?, delayMs?, destroy? } or a function (requestBody, n) -> that object. Requests are recorded.
async function fakeEndpoint(t, script) {
  const requests = [];
  const server = http.createServer((q, s) => {
    let b = '';
    q.on('data', d => { b += d; });
    q.on('end', async () => {
      let body = null; try { body = JSON.parse(b); } catch {}
      requests.push({ url: q.url, method: q.method, authorization: q.headers.authorization, body });
      const n = requests.length - 1;
      const raw = script[Math.min(n, script.length - 1)];
      const step = typeof raw === 'function' ? raw(body, n) : raw;
      if (step.delayMs) await new Promise(r => setTimeout(r, step.delayMs));
      if (step.destroy) { q.socket.destroy(); return; }
      s.writeHead(step.status ?? 200, { 'content-type': 'application/json', ...(step.headers ?? {}) });
      s.end(typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {}));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests };
}
const reply = (message, { usage = { prompt_tokens: 100, completion_tokens: 10 }, model = 'mercury-3' } = {}) => ({ body: { id: 'same-id-every-time', object: 'chat.completion', model,
  choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage } });
const bash = (command, id = `c-${Math.random().toString(36).slice(2, 8)}`) => ({ id, type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command }) } });
const call = (name, args, id = `c-${Math.random().toString(36).slice(2, 8)}`) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const toolResults = file => readStream(file).filter(e => e.type === 'user').map(e => e.message.content[0]);
const run = (t, opts) => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const workdir = path.join(root, 'w'); mkdirSync(workdir);
  return runOpenAIChat({ model: 'mercury-3', prompt: 'do the task', workdir, hostEnv: hostEnv(), timeoutMs: 60_000, retry: FAST_RETRY, ...opts }).then(r => ({ ...r, root, workdir }));
};

// --- policy -------------------------------------------------------------------------------------------------------------
test('policy: Mercury is an executor model on an openai-chat-https provider, apart from models[] and class routing', () => {
  const { entry, provider } = executorModelById(policy, 'mercury-3');
  assert.equal(provider.kind, REMOTE_CHAT_KIND);
  assert.equal(provider.baseUrl, 'https://api.inceptionlabs.ai/v1');
  assert.equal(provider.credentialEnv, 'INCEPTION_API_KEY');
  assert.equal(entry.class, 'M'); assert.deepEqual([entry.price.inputPerMTok, entry.price.outputPerMTok], [0, 0]); assert.match(entry.price.source, /100M-token free allowance/);
  assert.deepEqual(Object.values(executorModelById(policy, 'mercury-2.5').entry.price).slice(0, 3), [0.2, 0.75, 0.02]);
  assert.throws(() => modelById(policy, 'mercury-3'), { code: 'MODEL_NOT_IN_POLICY' }, 'ModelPort and class routing never see it');
  assert.ok(!modelsForClass(policy, 'M').some(m => m.provider === 'inception'));
  assert.throws(() => executorModelById(policy, 'mercury-2'), { code: 'MODEL_NOT_IN_POLICY' }, 'only listed ids');
  assert.equal(sessionModelById(policy, 'mercury-3').kind, REMOTE_CHAT_KIND);
  assert.equal(sessionModelById(policy, 'claude-haiku-5-5').kind, 'claude-cli');
  assert.throws(() => sessionModelById(policy, 'gpt-4o'), { code: 'MODEL_NOT_IN_POLICY' });
  assert.equal(executorForModel(policy, 'mercury-3').run, runOpenAIChat);
  assert.equal(executorForModel(policy, 'claude-haiku-5-5').run, runClaudeCode);
  assert.throws(() => executorForModel(policy, 'qwen3.5-2b-q4km'), { code: 'EXECUTOR_MODEL' }, 'a local llama-server model has no session executor');
  assert.match(JSON.stringify(policy.providers.inception), /INCEPTION_API_KEY/);
});

test('policy: a remote-chat provider is https only, names its credential variable, never carries a value, and has no unknown field', () => {
  const cases = {
    'plain http': p => { p.providers.inception.baseUrl = 'http://api.inceptionlabs.ai/v1'; },
    'plain http on loopback': p => { p.providers.inception.baseUrl = 'http://127.0.0.1:8080/v1'; },
    'no baseUrl': p => { delete p.providers.inception.baseUrl; },
    'credential field apiKey': p => { p.providers.inception.apiKey = 'x'; },
    'credential field token': p => { p.providers.inception.token = 'x'; },
    'credential field authorization': p => { p.providers.inception.Authorization = 'Bearer x'; },
    'credential value in credentialEnv': p => { p.providers.inception.credentialEnv = 'sk_live_4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c'; },
    'credential value pasted into docs': p => { p.providers.inception.docs += ' key sk_4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e'; },
    'credentialEnv missing': p => { delete p.providers.inception.credentialEnv; },
    'credentialEnv null': p => { p.providers.inception.credentialEnv = null; },
    'unknown provider field': p => { p.providers.inception.headers = { 'x-extra': '1' }; },
    'unknown requestDefaults field': p => { p.providers.inception.requestDefaults = { temperature: 0, top_k: 5 }; },
    'temperature out of range': p => { p.providers.inception.requestDefaults = { temperature: 3 }; },
    'childEnv on a remote provider': p => { p.providers.inception.childEnv = {}; },
    'remote model in models[]': p => { p.models.push({ ...p.executorModels[0] }); p.executorModels.shift(); },
    'executor model on claude-cli': p => { p.executorModels[0].provider = 'claude-cli'; },
    'executor model unknown field': p => { p.executorModels[0].apiKey = 'x'; },
    'executor model class outside order': p => { p.executorModels[0].class = 'XL'; },
    'executor model duplicate id': p => { p.executorModels[1].id = 'claude-haiku-5-5'; },
    'executor model price without source': p => { delete p.executorModels[0].price.source; },
    'executor model unknown price field': p => { p.executorModels[0].price.perRequest = 1; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const p = mutable(); mutate(p);
    assert.throws(() => validatePolicy(p), { code: 'MODEL_POLICY_INVALID' }, name);
  }
  const ok = mutable(); ok.providers.inception.requestDefaults = { temperature: 0.2, max_tokens: 4096 };
  assert.doesNotThrow(() => validatePolicy(ok));
  assert.doesNotThrow(() => validatePolicy(mutable()));
});

// --- pure helpers ---------------------------------------------------------------------------------------------------------
test('classifyHttp: 429 and 529 are rate limits, 5xx and transport failures unavailable (both retried), 401/403 unavailable at once', () => {
  assert.deepEqual(classifyHttp({ status: 429 }), { code: 'MODEL_RATE_LIMIT', retry: true });
  assert.deepEqual(classifyHttp({ status: 529 }), { code: 'MODEL_RATE_LIMIT', retry: true });
  assert.deepEqual(classifyHttp({ status: 500 }), { code: 'MODEL_UNAVAILABLE', retry: true });
  assert.deepEqual(classifyHttp({ status: 503 }), { code: 'MODEL_UNAVAILABLE', retry: true });
  assert.deepEqual(classifyHttp({ transportError: new Error('ECONNREFUSED') }), { code: 'MODEL_UNAVAILABLE', retry: true });
  assert.deepEqual(classifyHttp({ status: 401 }), { code: 'MODEL_UNAVAILABLE', retry: false });
  assert.deepEqual(classifyHttp({ status: 402, text: '{"error":"quota exceeded"}' }), { code: 'MODEL_RATE_LIMIT', retry: false });
  assert.deepEqual(classifyHttp({ status: 400, text: '{"error":"bad tool schema"}' }), { code: 'EXECUTOR_ERROR', retry: false });
  for (const c of ['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'SANDBOX_UNAVAILABLE', 'EXECUTOR_LAUNCH', 'EXECUTOR_PROTOCOL']) assert.ok(ENV_FAULTS.has(c), c);
  assert.equal(redact(`auth failed for ${KEY}; header Authorization: Bearer ${KEY}`, KEY).includes(KEY), false);
  assert.equal(redact('Bearer abc.def-ghi', null), 'Bearer [redacted]');
  assert.equal(priceUsage({ input: 1_000_000, cached: 500_000, output: 1_000_000 }, { inputPerMTok: 0.2, outputPerMTok: 0.75, cacheReadPerMTok: 0.02 }), 0.1 + 0.01 + 0.75);
  assert.deepEqual(OPENAI_CHAT_KEEP_RO, DEFAULT_KEEP_RO.filter(p => p !== CLOUD_LOGIN_FILE), 'the claude CLI login is the only keep dropped');
});

test('caller errors throw before anything runs: no model, an unlisted model, an unsupported tool or effort, a remote baseUrl override', async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = { prompt: 'x', workdir: path.join(root, 'w'), hostEnv: hostEnv() };
  await assert.rejects(runOpenAIChat({ ...base }), { code: 'EXECUTOR_MODEL' });
  await assert.rejects(runOpenAIChat({ ...base, model: 'claude-haiku-5-5' }), { code: 'MODEL_NOT_IN_POLICY' }, 'a claude-cli model is not an executor model');
  await assert.rejects(runOpenAIChat({ ...base, model: 'mercury-3', tools: ['Bash', 'WebFetch'] }), { code: 'EXECUTOR_TOOLS' });
  await assert.rejects(runOpenAIChat({ ...base, model: 'mercury-3', effort: 'max' }), { code: 'EXECUTOR_EFFORT' }, 'refused, not flattened to high');
  await assert.rejects(runOpenAIChat({ ...base, model: 'mercury-3', baseUrl: 'https://evil.example/v1' }), { code: 'EXECUTOR_OPTION' });
  await assert.rejects(runOpenAIChat({ ...base, model: 'mercury-3', maxTurns: 0 }), { code: 'EXECUTOR_OPTION' });
  assert.equal(existsSync(base.workdir), false, 'nothing was materialized');
});

// --- live sessions (sandboxed tools, loopback endpoint) -----------------------------------------------------------------
test('a tool-calling session: the key goes only into the Authorization header; tools run in the sandbox; the transcript reads like stream-json', { skip: live }, async t => {
  const ep = await fakeEndpoint(t, [
    reply({ content: 'Looking first.', tool_calls: [bash('echo hello > note.txt; cat note.txt; printf "%s|" "$(env | cut -d= -f1 | sort | tr "\\n" " ")"'), call('Write', { file_path: 'sub/out.json', content: '{"a":1}' })] }),
    reply({ content: null, tool_calls: [call('Read', { file_path: 'sub/out.json' }), call('Edit', { file_path: 'sub/out.json', old_string: '1', new_string: '2' }), call('Glob', { pattern: '**/*.json' }), call('Grep', { pattern: 'hello', output_mode: 'content' })] }),
    reply({ content: 'All done.' }),
  ]);
  const r = await run(t, { baseUrl: ep.baseUrl, systemPrompt: 'OFFICIAL SYSTEM PROMPT', appendSystemPrompt: 'APPENDED', effort: 'high' });
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.result, 'All done.'); assert.equal(r.turns, 3); assert.equal(r.requests, 3);
  assert.equal(r.costUsd, 0); assert.equal(r.costUnknown, false); assert.equal(r.sandboxReady, true);
  assert.deepEqual(r.streamUsage, { inputTokens: 300, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 });
  // Requests: model id from the policy, the system prompt verbatim (+ append), the user prompt, the tools, the effort.
  const first = ep.requests[0];
  assert.equal(first.url, '/v1/chat/completions'); assert.equal(first.authorization, `Bearer ${KEY}`);
  assert.equal(first.body.model, 'mercury-3'); assert.equal(first.body.reasoning_effort, 'high');
  assert.deepEqual(first.body.messages, [{ role: 'system', content: 'OFFICIAL SYSTEM PROMPT\n\nAPPENDED' }, { role: 'user', content: 'do the task' }]);
  assert.deepEqual(first.body.tools.map(x => x.function.name), ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
  assert.ok(!('temperature' in first.body), 'no temperature unless the policy sets one');
  const second = ep.requests[1].body.messages;
  assert.equal(second.length, 5); assert.equal(second[2].role, 'assistant'); assert.equal(second[2].tool_calls.length, 2); assert.equal(second[3].role, 'tool');
  // Tool effects and outputs.
  const results = toolResults(r.transcript);
  assert.match(results[0].content, /^hello\n/); assert.equal(results[0].is_error, false);
  const envNames = results[0].content.split('\n')[1].replace(/\|$/, '').trim().split(' ');
  assert.ok(!envNames.includes('INCEPTION_API_KEY') && !envNames.includes('CLAUDE_CODE_OAUTH_TOKEN') && !envNames.some(n => /proxy/i.test(n)), envNames.join(' '));
  assert.match(results[2].content, /^\s+1\t\{"a":1\}$/); assert.match(results[3].content, /Edited .*out\.json \(1 replacement\)/);
  assert.match(results[4].content, /sub\/out\.json/); assert.match(results[5].content, /note\.txt:1:hello/);
  assert.equal(readFileSync(path.join(r.workdir, 'sub/out.json'), 'utf8'), '{"a":2}');
  // The credential never reaches the transcript, the result or the workdir.
  const transcript = readFileSync(r.transcript, 'utf8');
  assert.ok(!transcript.includes(KEY) && !JSON.stringify(r).includes(KEY));
  // The auditors read it unchanged: responses by unique id (the endpoint reused one id), tools, models, timestamps.
  const events = readStream(r.transcript);
  assert.equal(events[0].type, 'system'); assert.equal(events[0].subtype, 'init'); assert.equal(events.at(-1).type, 'result'); assert.equal(events.at(-1).num_turns, 3);
  const audit = auditSession({ events, calls: [], maxSteps: 50, expectModel: 'mercury-3' });
  assert.equal(audit.modelResponses, 3); assert.equal(audit.toolResponses, 2); assert.equal(audit.sessionToolUses, 6); assert.deepEqual(audit.models, ['mercury-3']);
  assert.deepEqual(audit.violations, []); assert.equal(audit.mapping, 'timestamps'); assert.equal(audit.resultSubtype, 'success');
  assert.deepEqual(streamUsageOf(events), { inputTokens: 300, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.equal(r.toolUses.length, 6); assert.equal(r.toolUses[0].name, 'Bash');
});

test('the sandbox is the claude executor\'s: hidden paths are empty, the host is read-only, other workdirs and the CLI login are invisible, no network', { skip: live }, async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const other = path.join(root, 'other'); mkdirSync(other); writeFileSync(path.join(other, 'answer.json'), '{"secret":1}');
  const bait = http.createServer((q, s) => s.end('reached')); await new Promise(r => bait.listen(0, '127.0.0.1', r)); t.after(() => bait.close());
  const probe = [
    `printf '%s|home-user\\n' "$(ls -A /home/user 2>/dev/null | wc -l | tr -d ' ')"`,
    `[ -e ${JSON.stringify(other)} ] && echo "OTHER-VISIBLE" || echo "other-hidden"`,
    `cat ${JSON.stringify(path.join(other, 'answer.json'))} 2>&1 | head -1`,
    `touch /etc/foundry-probe 2>/dev/null && echo "ETC-WRITABLE" || echo "etc-ro"`,
    `test -e ${CLOUD_LOGIN_FILE}; echo "login|$?"`,
    `ls -A /root | tr '\\n' ' '; echo "|root"`,
    `id -u; echo tmp-ok > /tmp/t && cat /tmp/t`,
    `node -e "fetch('http://127.0.0.1:${bait.address().port}/').then(()=>console.log('NET-REACHED'),()=>console.log('net-blocked'))"`,
  ].join('\n');
  const ep = await fakeEndpoint(t, [reply({ tool_calls: [bash(probe), call('Read', { file_path: path.join(other, 'answer.json') }), call('Write', { file_path: '/etc/foundry-probe', content: 'x' })] }),
    reply({ tool_calls: [bash('cat /tmp/t')] }), reply({ content: 'ok' })]);
  const workdir = path.join(root, 'mine'); mkdirSync(workdir);
  const r = await runOpenAIChat({ model: 'mercury-3', prompt: 'probe', workdir, hostEnv: hostEnv(), baseUrl: ep.baseUrl, timeoutMs: 60_000, retry: FAST_RETRY, hidden: [...(await import('../src/executors/claude-code.mjs')).DEFAULT_HIDDEN, root] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const [out, read, write, again] = toolResults(r.transcript).map(x => x.content);
  assert.match(out, /^0\|home-user$/m); assert.match(out, /other-hidden/); assert.match(out, /No such file or directory/); assert.match(out, /etc-ro/);
  assert.match(out, /^login\|1$/m, 'the claude CLI login file is not kept for a remote-chat session');
  assert.doesNotMatch(out, /\.ccr.*\.claude|\.claude/); assert.match(out, new RegExp(`^${process.getuid() === 0 ? 65534 : process.getuid()}$`, 'm')); assert.match(out, /^tmp-ok$/m); assert.match(out, /net-blocked/);
  assert.match(read, /^Error: ENOENT/); assert.match(write, /^Error: .*(EROFS|read-only)/i);
  assert.equal(again, 'tmp-ok\n', '/tmp lasts for the session (one sandbox per session)');
  assert.equal(existsSync('/etc/foundry-probe'), false);
});

test('maxTurns: the tool calls of the last allowed response run, then the session ends as error_max_turns', { skip: live }, async t => {
  const ep = await fakeEndpoint(t, [(_, n) => reply({ tool_calls: [bash(`echo turn${n + 1} >> turns.txt`)] })]);
  const r = await run(t, { baseUrl: ep.baseUrl, maxTurns: 3, binary: '/nonexistent/claude-a1' });
  assert.equal(r.error.code, 'EXECUTOR_MAX_TURNS'); assert.equal(r.turns, 3); assert.equal(ep.requests.length, 3);
  assert.equal(readFileSync(path.join(r.workdir, 'turns.txt'), 'utf8'), 'turn1\nturn2\nturn3\n');
  const events = readStream(r.transcript);
  const audit = auditSession({ events, calls: [], maxSteps: 4, expectModel: 'mercury-3' });
  assert.equal(audit.stopReason, 'max_turns'); assert.equal(audit.modelResponses, 3); assert.deepEqual(audit.violations, []);
  assert.deepEqual(events[0].ignored, { binary: '/nonexistent/claude-a1' }, 'the CLI step-guard binary is recorded as ignored');
  assert.equal(ENV_FAULTS.has(r.error.code), false, 'a task outcome, not an environment fault');
});

test('budget: a priced model stops between turns once the policy price times the reported usage reaches budgetUsd; tokens cap a free one', { skip: live }, async t => {
  // mercury-2.5: 0.20 in / 0.75 out per MTok. 1M input tokens per response = $0.20.
  const priced = await fakeEndpoint(t, [reply({ tool_calls: [bash('true')] }, { usage: { prompt_tokens: 1_000_000, completion_tokens: 0 }, model: 'mercury-2.5' })]);
  const r = await run(t, { model: 'mercury-2.5', baseUrl: priced.baseUrl, budgetUsd: 0.5, tokenBudget: null });
  assert.equal(r.error.code, 'EXECUTOR_BUDGET'); assert.equal(r.turns, 3, '$0.20, $0.40, $0.60: the third response crosses $0.50');
  assert.ok(Math.abs(r.costUsd - 0.6) < 1e-9); assert.equal(r.costUnknown, false);
  assert.equal(readStream(r.transcript).at(-1).subtype, 'error_max_budget_usd');
  const free = await fakeEndpoint(t, [reply({ tool_calls: [bash('true')] }, { usage: { prompt_tokens: 400, completion_tokens: 100 } })]);
  const f = await run(t, { baseUrl: free.baseUrl, budgetUsd: 0.01, tokenBudget: 1200 });
  assert.equal(f.error.code, 'EXECUTOR_BUDGET'); assert.equal(f.turns, 3); assert.equal(f.costUsd, 0);
  assert.equal(readStream(f.transcript).at(-1).subtype, 'error_max_budget_tokens');
  const missing = await fakeEndpoint(t, [{ body: { model: 'mercury-2.5', choices: [{ message: { role: 'assistant', content: 'no usage reported' } }] } }]);
  const m = await run(t, { model: 'mercury-2.5', baseUrl: missing.baseUrl, budgetUsd: 0.3 });
  assert.equal(m.ok, true); assert.equal(m.costUsd, null); assert.equal(m.costUnknown, true); assert.equal(m.costUpperUsd, 0.3, 'unknown cost is booked at the budget bound');
});

test('timeout: a slow endpoint or a long command ends the session as EXECUTOR_TIMEOUT, and the command\'s processes die', { skip: live }, async t => {
  const slow = await fakeEndpoint(t, [{ ...reply({ content: 'late' }), delayMs: 5000 }]);
  const a = await run(t, { baseUrl: slow.baseUrl, timeoutMs: 1500 });
  assert.equal(a.error.code, 'EXECUTOR_TIMEOUT'); assert.ok(a.durationMs < 4500, `${a.durationMs}`); assert.equal(a.costUsd, 0, 'a free model costs 0 even when cut off');
  const long = await fakeEndpoint(t, [reply({ tool_calls: [bash('sleep 30; echo never > done.txt')] }), reply({ content: 'x' })]);
  const b = await run(t, { baseUrl: long.baseUrl, timeoutMs: 3000 });
  assert.equal(b.error.code, 'EXECUTOR_TIMEOUT'); assert.ok(b.durationMs < 8000, `${b.durationMs}`);
  assert.equal(existsSync(path.join(b.workdir, 'done.txt')), false);
  assert.equal(readStream(b.transcript).at(-1).error_code, 'EXECUTOR_TIMEOUT');
  // A per-command timeout is a tool error, not the end of the session.
  const cmd = await fakeEndpoint(t, [reply({ tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 'sleep 20', timeout: 1000 }) } }] }), reply({ content: 'moved on' })]);
  const c = await run(t, { baseUrl: cmd.baseUrl });
  assert.equal(c.ok, true); assert.match(toolResults(c.transcript)[0].content, /timed out after 1 s/); assert.equal(toolResults(c.transcript)[0].is_error, true);
});

test('HTTP 429 and 5xx are retried with backoff, then mapped to MODEL_RATE_LIMIT / MODEL_UNAVAILABLE (environment faults); 401 is not retried', { skip: live }, async t => {
  const limited = await fakeEndpoint(t, [{ status: 429, body: { error: { message: `rate limited (key ${KEY})` } }, headers: { 'retry-after': '0' } }]);
  const a = await run(t, { baseUrl: limited.baseUrl });
  assert.equal(a.error.code, 'MODEL_RATE_LIMIT'); assert.equal(limited.requests.length, 3); assert.equal(a.retries, 2); assert.equal(a.turns, 0); assert.equal(a.costUsd, 0);
  assert.ok(!a.error.stderr.includes(KEY) && !readFileSync(a.transcript, 'utf8').includes(KEY), 'an echoed key is redacted');
  assert.equal(readStream(a.transcript).filter(e => e.subtype === 'api_error').length, 3);
  const flaky = await fakeEndpoint(t, [{ status: 500, body: 'oops' }, { status: 503, body: 'busy' }, reply({ content: 'recovered' })]);
  const b = await run(t, { baseUrl: flaky.baseUrl });
  assert.equal(b.ok, true); assert.equal(b.result, 'recovered'); assert.equal(b.retries, 2);
  const down = await fakeEndpoint(t, [{ status: 502, body: 'bad gateway' }]);
  const c = await run(t, { baseUrl: down.baseUrl });
  assert.equal(c.error.code, 'MODEL_UNAVAILABLE'); assert.equal(down.requests.length, 3);
  const reset = await fakeEndpoint(t, [{ destroy: true }]);
  const d = await run(t, { baseUrl: reset.baseUrl });
  assert.equal(d.error.code, 'MODEL_UNAVAILABLE'); assert.equal(reset.requests.length, 3);
  const auth = await fakeEndpoint(t, [{ status: 401, body: { error: 'invalid api key' } }]);
  const e = await run(t, { baseUrl: auth.baseUrl });
  assert.equal(e.error.code, 'MODEL_UNAVAILABLE'); assert.equal(auth.requests.length, 1);
  const bad = await fakeEndpoint(t, [{ status: 400, body: { error: 'context too long' } }]);
  const f = await run(t, { baseUrl: bad.baseUrl });
  assert.equal(f.error.code, 'EXECUTOR_ERROR'); assert.equal(bad.requests.length, 1);
  const garbled = await fakeEndpoint(t, [{ body: 'not json' }]);
  assert.equal((await run(t, { baseUrl: garbled.baseUrl })).error.code, 'EXECUTOR_PROTOCOL');
  for (const r of [a, c, d, e]) assert.ok(ENV_FAULTS.has(r.error.code), r.error.code);
  // A rate limit mid-session keeps what the session did and its cost.
  const mid = await fakeEndpoint(t, [reply({ tool_calls: [bash('echo did > did.txt')] }), { status: 429, body: 'slow down' }]);
  const g = await run(t, { baseUrl: mid.baseUrl });
  assert.equal(g.error.code, 'MODEL_RATE_LIMIT'); assert.equal(g.turns, 1); assert.equal(existsSync(path.join(g.workdir, 'did.txt')), true);
});

test('no credential in the environment: MODEL_UNAVAILABLE before any request, at $0; the key is never passed into the sandbox', { skip: live }, async t => {
  const ep = await fakeEndpoint(t, [reply({ content: 'x' })]);
  const r = await run(t, { baseUrl: ep.baseUrl, hostEnv: { ...process.env, INCEPTION_API_KEY: '' } });
  assert.equal(r.error.code, 'MODEL_UNAVAILABLE'); assert.match(r.error.stderr, /INCEPTION_API_KEY is not set/); assert.equal(ep.requests.length, 0); assert.equal(r.costUsd, 0);
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(runOpenAIChat({ model: 'mercury-3', prompt: 'x', workdir: path.join(root, 'w'), hostEnv: hostEnv(), baseUrl: ep.baseUrl, env: { INCEPTION_API_KEY: KEY } }), { code: 'SANDBOX_ENV' });
  await assert.rejects(runOpenAIChat({ model: 'mercury-3', prompt: 'x', workdir: path.join(root, 'w2'), hostEnv: hostEnv(), baseUrl: ep.baseUrl, env: { HARMLESS_NAME: KEY } }), { code: 'SANDBOX_ENV' }, 'nor under another name');
});

test('the transcript is written without following a link the session planted; big outputs are truncated head and tail; nested model use is visible', { skip: live }, async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const victim = path.join(root, 'victim.txt'); writeFileSync(victim, 'untouched');
  const ep = await fakeEndpoint(t, [reply({ tool_calls: [bash(`ln -s ${JSON.stringify(victim)} .executor-transcript.jsonl; seq 1 200000`), bash('claude -p "hi" || true')] }), reply({ content: 'bye' })]);
  const workdir = path.join(root, 'w'); mkdirSync(workdir);
  const r = await runOpenAIChat({ model: 'mercury-3', prompt: 'x', workdir, hostEnv: hostEnv(), baseUrl: ep.baseUrl, timeoutMs: 60_000, retry: FAST_RETRY });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(readFileSync(victim, 'utf8'), 'untouched'); assert.equal(lstatSync(r.transcript).isFile(), true);
  const big = toolResults(r.transcript)[0].content;
  assert.ok(big.length <= TOOL_OUTPUT_MAX_CHARS + 100, `${big.length}`); assert.match(big, /^1\n2\n/); assert.match(big, /characters truncated/); assert.match(big, /\n200000\n?/);
  assert.equal(nestedModelUses(r.toolUses), 1, 'a nested claude CLI in a Bash command is counted like in a claude session');
  assert.equal(r.label, `executor:${EXECUTOR_KIND}:mercury-3`);
});

test('a session without tools needs no sandbox; an unknown tool call or bad arguments are tool errors the model sees', { skip: live }, async t => {
  const plain = await fakeEndpoint(t, [reply({ content: 'just text' })]);
  const a = await run(t, { baseUrl: plain.baseUrl, tools: [] });
  assert.equal(a.ok, true); assert.ok(!('tools' in plain.requests[0].body));
  const weird = await fakeEndpoint(t, [reply({ tool_calls: [call('Write', { file_path: 'x', content: 'y' }), { id: 'b', type: 'function', function: { name: 'Bash', arguments: '{not json' } }] }), reply({ content: 'ok' })]);
  const b = await run(t, { baseUrl: weird.baseUrl, tools: ['Bash'] });
  assert.equal(b.ok, true);
  const [w, j] = toolResults(b.transcript);
  assert.match(w.content, /Unknown tool Write/); assert.equal(w.is_error, true); assert.match(j.content, /not a JSON object/);
  assert.equal(existsSync(path.join(b.workdir, 'x')), false);
});
