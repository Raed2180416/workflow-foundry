// Executor sandbox (C0 preflight R1, R4, R5): mount steps, environment scrub, transcript scans, session
// classification and the cost of a killed session. Live checks run only where user namespaces are available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {
  maskSteps, scrubEnv, nestedModelUses, sessionError, streamUsageOf, splitReady, runClaudeCode, sandboxAvailable,
  DEFAULT_HIDDEN, DEFAULT_KEEP_RO, WORK_ROOT, KIT_ROOT, SANDBOX_READY,
} from '../src/executors/claude-code.mjs';
import { runSandboxed } from '../src/executors/sandboxed-command.mjs';

const live = sandboxAvailable() ? false : 'user/mount/pid namespaces are not available here';
const tmpRoot = () => mkdtempSync(path.join(tmpdir(), 'foundry-exec-'));
const tmpfsTargets = steps => steps.filter(s => s.startsWith('mount -t tmpfs -o mode=0755')).map(s => s.split(' ').at(-1).replaceAll("'", ''));

test('maskSteps hides top-level paths only: nested hidden paths are skipped instead of failing the sandbox', t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const outer = path.join(root, 'outer'), inner = path.join(outer, 'inner'), work = path.join(root, 'work');
  for (const d of [inner, work]) mkdirSync(d, { recursive: true });
  const steps = maskSteps({ workdir: work, hidden: [outer, inner, path.join(root, 'missing')] });
  const targets = tmpfsTargets(steps);
  assert.ok(targets.includes(outer), 'the outer hidden path is masked');
  assert.ok(!targets.includes(inner), 'a hidden path inside another one is not mounted on (its mount point would not exist)');
  assert.ok(!targets.some(p => p.endsWith('missing')), 'paths that do not exist are skipped');
  // The default list nests /root/.claude-like paths too: adding one must not add a step.
  const d = maskSteps({ workdir: work, hidden: [...DEFAULT_HIDDEN, '/root/.claude', '/tmp/nested-under-tmp'] });
  assert.equal(tmpfsTargets(d).filter(p => p.startsWith('/root')).length, existsSync('/root') ? 1 : 0);
  assert.ok(!tmpfsTargets(d).some(p => p.startsWith('/tmp/')));
});

test('maskSteps keeps the workdir writable and the kit read-only inside hidden roots, and refuses to hide a kept path', t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, 'w'), kit = path.join(root, 'kit'); mkdirSync(work); mkdirSync(kit);
  const steps = maskSteps({ workdir: work, kitDir: kit, hidden: [root] });
  const text = steps.join('\n');
  assert.match(steps[0], /^mount -t tmpfs .* '\/mnt'$/, 'a private staging tmpfs comes first');
  assert.ok(steps.indexOf(steps.find(s => s.startsWith('for mp in'))) > steps.findIndex(s => s.startsWith('mount --rbind')), 'kept paths are copied before the host is made read-only');
  assert.match(text, new RegExp(`mount --move '/mnt/k0' '${work}'`)); assert.match(text, new RegExp(`mount --move '/mnt/k1' '${kit}'`));
  assert.match(text, new RegExp(`mount -o remount,bind,ro '${kit}'`)); assert.doesNotMatch(text, new RegExp(`remount,bind,ro '${work}'`));
  assert.ok(tmpfsTargets(steps).includes(root));
  const defaults = tmpfsTargets(maskSteps({ workdir: work }));
  assert.ok(!existsSync(WORK_ROOT) || defaults.includes('/var/tmp') || defaults.includes(WORK_ROOT), 'every other workdir is hidden');
  assert.throws(() => maskSteps({ workdir: work, hidden: [work] }), { code: 'EXECUTOR_PATH' });
  assert.throws(() => maskSteps({ workdir: root, hidden: [work] }), { code: 'EXECUTOR_PATH' }, 'a hidden path inside the workdir');
  assert.throws(() => maskSteps({ workdir: work, kitDir: path.join(work, 'kit') }), { code: 'EXECUTOR_PATH' }, 'kept paths may not nest');
  assert.throws(() => maskSteps({ workdir: '/proc/self' }), { code: 'EXECUTOR_PATH' });
  assert.ok(DEFAULT_HIDDEN.includes(KIT_ROOT) && DEFAULT_HIDDEN.includes('/root') && DEFAULT_HIDDEN.includes('/tmp') && DEFAULT_HIDDEN.includes('/home/user'));
  assert.deepEqual([...DEFAULT_KEEP_RO], ['/root/.ccr', '/root/.local', '/home/claude/.claude/remote']);
  // C0 gate 2026-10-07: the account directories are hidden (only the CLI login stays, read-only) and sysfs is read-only.
  assert.ok(DEFAULT_HIDDEN.includes('/home/claude') && DEFAULT_HIDDEN.includes('/home/ubuntu'));
  assert.equal(maskSteps({ workdir: work }).at(-1), 'mount -o remount,bind,ro /sys');
});

test('scrubEnv removes repository credentials and the parent session identity, keeping the rest', () => {
  const env = scrubEnv({ GH_TOKEN: 'x', GIT_CONFIG_KEY_0: 'x', AWS_SESSION_TOKEN: 'x', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/s',
    CLAUDE_SESSION_INGRESS_TOKEN_FILE: '/x', MAX_THINKING_TOKENS: '9', CLAUDE_CODE_SYNC_SKILLS: '1', SBX_TELEMETRY_SOCKET: '/run/x', PATH: '/usr/bin', HOME: '/root', HTTPS_PROXY: 'http://p', CLAUDE_CODE_ENTRYPOINT: 'x', N: undefined });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/root', HTTPS_PROXY: 'http://p', CLAUDE_CODE_ENTRYPOINT: 'x' });
});

test('nestedModelUses counts nested CLI runs and direct API use, not mentions of the word', () => {
  const bash = command => ({ name: 'Bash', input: { command } });
  const hits = [bash('claude -p "hi"'), bash('cd x && claude --model claude-haiku-4-5-20251001 -p q'), bash('/opt/node22/bin/claude -p x'), bash('timeout 60 claude -p x'),
    bash('FOO=1 exec claude -p x'), bash('echo $(claude -p x)'), bash('curl https://api.anthropic.com/v1/messages -d @b.json'), bash('npx -y @anthropic-ai/claude-code -p x'),
    { name: 'Write', input: { file_path: 'a.mjs', content: "import { spawn } from 'node:child_process'; spawn('claude', ['-p', q]);" } },
    { name: 'Write', input: { file_path: 'a.py', content: 'import anthropic\nc = anthropic.Anthropic()' } },
    { name: 'Edit', input: { new_string: "execSync('claude -p ' + q)" } },
    // a direct call of the kit's CLI would skip the session gateway (C0 gate 2026-10-07)
    bash('node /opt/foundry-kit/f5c921b04646bec8/bin/foundry.mjs run wf.json --input {}'), bash('cd x && node /opt/foundry-kit/abc123/bin/foundry.mjs resume r1')];
  for (const u of hits) assert.equal(nestedModelUses([u]), 1, JSON.stringify(u.input));
  const misses = [bash('grep -rn claude tools/policy.json'), bash('cat ~/.claude/settings.json'), bash('ls /root/.claude'), bash('node solve.mjs --model claude-opus-5-5'),
    bash('echo "use claude-haiku-4-5-20251001"'), bash('node /opt/foundry-kit/abc123/bin/foundry.mjs validate wf.json'), { name: 'Write', input: { content: "callModel({ model: 'claude-sonnet-5-5' })" } }, { name: 'Read', input: { file_path: '/x/claude' } }];
  for (const u of misses) assert.equal(nestedModelUses([u]), 0, JSON.stringify(u.input));
  assert.equal(nestedModelUses([...hits, ...misses]), hits.length);
});

test('sessionError: budget before rate limits, usage limits are rate limits, a sandbox that never got ready is an environment fault', () => {
  assert.equal(sessionError({ result: { is_error: true, subtype: 'error_max_budget_usd', result: 'budget limit reached' } }), 'EXECUTOR_BUDGET');
  assert.equal(sessionError({ result: { is_error: true, result: "You've hit your limit · resets 5pm" } }), 'MODEL_RATE_LIMIT');
  assert.equal(sessionError({ result: { is_error: true, result: 'Claude AI usage limit reached|1791400000' } }), 'MODEL_RATE_LIMIT');
  assert.equal(sessionError({ result: null, stderr: 'API Error: 529 overloaded' }), 'MODEL_RATE_LIMIT');
  assert.equal(sessionError({ result: { is_error: true, api_error_status: 503, result: 'x' } }), 'MODEL_UNAVAILABLE');
  assert.equal(sessionError({ result: { is_error: true, result: 'tool loop failed' } }), 'EXECUTOR_ERROR');
  assert.equal(sessionError({ result: null }), 'EXECUTOR_PROTOCOL');
  assert.equal(sessionError({ result: null, sandboxReady: false }), 'SANDBOX_UNAVAILABLE');
  assert.equal(sessionError({ result: null, timedOut: true }), 'EXECUTOR_TIMEOUT');
  assert.equal(sessionError({ result: { is_error: false, result: 'done' } }), null);
  assert.deepEqual(splitReady(`${SANDBOX_READY}\nwarn\n`), { ready: true, stderr: 'warn\n' });
  assert.deepEqual(splitReady('mount: failed\n'), { ready: false, stderr: 'mount: failed\n' });
});

test('streamUsageOf counts each assistant message once (stream-json repeats it per content block)', () => {
  const m = (id, usage) => ({ type: 'assistant', message: { id, usage } });
  const u = streamUsageOf([m('a', { input_tokens: 1, output_tokens: 1 }), m('a', { input_tokens: 1, output_tokens: 40, cache_read_input_tokens: 900 }), m('b', { input_tokens: 2, output_tokens: 5, cache_creation_input_tokens: 70 }), { type: 'user' }]);
  assert.deepEqual(u, { inputTokens: 3, outputTokens: 45, cacheReadTokens: 900, cacheWriteTokens: 70 });
});

// A stand-in CLI inside the workdir: prints stream-json events, then either a result or hangs until killed.
const FAKE_CLI = ({ result }) => `#!/bin/sh
cat > /dev/null
echo '{"type":"system","subtype":"init","session_id":"fake-session"}'
echo '{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}],"usage":{"input_tokens":5,"output_tokens":7,"cache_read_input_tokens":100}}}'
${result ? `echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0.123,"num_turns":1}'` : 'sleep 30'}
`;

test('a killed executor session is charged at its budget bound, never $0 (R5)', { skip: live }, async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = async (name, result) => {
    const workdir = path.join(root, name); mkdirSync(workdir);
    writeFileSync(path.join(workdir, 'fake-claude'), FAKE_CLI({ result })); chmodSync(path.join(workdir, 'fake-claude'), 0o755);
    return runClaudeCode({ model: 'claude-haiku-4-5-20251001', prompt: 'x', workdir, budgetUsd: 0.75, timeoutMs: result ? 30000 : 2500, binary: path.join(workdir, 'fake-claude') });
  };
  const killed = await run('killed', false);
  assert.equal(killed.error.code, 'EXECUTOR_TIMEOUT');
  assert.equal(killed.costUsd, null); assert.equal(killed.costUnknown, true); assert.equal(killed.costUpperUsd, 0.75);
  assert.equal(killed.costUsd ?? killed.costUpperUsd, 0.75, 'callers charge the bound');
  assert.deepEqual(killed.streamUsage, { inputTokens: 5, outputTokens: 7, cacheReadTokens: 100, cacheWriteTokens: 0 });
  assert.equal(killed.sessionId, 'fake-session'); assert.equal(killed.toolUses.length, 1); assert.equal(killed.sandboxReady, true);
  const finished = await run('finished', true);
  assert.equal(finished.ok, true); assert.equal(finished.costUsd, 0.123); assert.equal(finished.costUnknown, false); assert.equal(finished.costUpperUsd, 0.123);
});

test('live sandbox: own workdir only, nested hidden paths, read-only host, own pid namespace, optional no-network (R1)', { skip: live }, async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const workdir = path.join(root, 'mine'), other = path.join(root, 'other'); mkdirSync(workdir); mkdirSync(other); writeFileSync(path.join(other, 'answer.json'), '{"secret":1}');
  const bait = http.createServer((q, s) => s.end('reached')); await new Promise(r => bait.listen(0, '127.0.0.1', r)); t.after(() => bait.close());
  const probe = `
ls -A /root | tr '\\n' ' '; echo "|root"
[ -e ${JSON.stringify(other)} ] && echo "OTHER-VISIBLE" || echo "other-hidden"
printf '%s|home-user\\n' "$(ls -A /home/user 2>/dev/null | wc -l | tr -d ' ')"
printf '%s|pid1\\n' "$(head -c 5 /proc/1/cmdline | tr '\\0' ' ')"
touch /etc/foundry-probe 2>/dev/null && echo "ETC-WRITABLE" || echo "etc-ro"
touch ./mine-ok && echo "workdir-rw"
node -e "fetch('http://127.0.0.1:${bait.address().port}/').then(()=>console.log('NET-REACHED'),()=>console.log('net-blocked'))"`;
  const hidden = [...DEFAULT_HIDDEN, '/root/.claude', root];
  const r = await runSandboxed({ command: 'sh', args: ['-c', probe], workdir, hidden, network: false, timeoutMs: 30000 });
  assert.equal(r.code, 0, r.stderr); assert.equal(r.sandboxReady, true);
  const out = r.stdout;
  assert.match(out, /^\|root$/m, '/root is an empty tmpfs (nested /root/.claude did not break the setup)');
  assert.match(out, /other-hidden/); assert.match(out, /^0\|home-user$/m); assert.match(out, /^sh -c\|pid1$/m);
  assert.match(out, /etc-ro/); assert.match(out, /workdir-rw/); assert.match(out, /net-blocked/);
  assert.equal(existsSync(path.join(workdir, 'mine-ok')), true, 'writes to the workdir reach the host');
  const open = await runSandboxed({ command: 'node', args: ['-e', `fetch('http://127.0.0.1:${bait.address().port}/').then(()=>console.log('NET-REACHED'),()=>console.log('net-blocked'))`], workdir, timeoutMs: 30000 });
  assert.match(open.stdout, /NET-REACHED/, 'network: true (the default) keeps the host loopback');
});
