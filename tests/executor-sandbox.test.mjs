// Executor sandbox (C0 preflight R1, R4, R5): mount steps, environment scrub, transcript scans, session
// classification and the cost of a killed session. Live checks run only where user namespaces are available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, symlinkSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  maskSteps, scrubEnv, nestedModelUses, sessionError, streamUsageOf, splitReady, runClaudeCode, sandboxAvailable,
  executorEnv, binaryKeeps, sandboxScript, sandboxProbeArgs, dropUidArgs, UNPRIVILEGED_ID, UNSHARE_ARGS, DEFAULT_HIDDEN, DEFAULT_KEEP_RO, DEFAULT_DEVICES, EXECUTOR_ENV_ALLOWED, WORK_ROOT, KIT_ROOT, SANDBOX_READY,
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
  assert.ok(steps.indexOf(steps.find(s => s.startsWith('while read -r mp'))) > steps.findIndex(s => s.startsWith('mount --rbind')), 'kept paths are copied before the host is made read-only');
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
  assert.deepEqual(DEFAULT_KEEP_RO.slice(0, 2), ['/root/.ccr', '/home/claude/.claude/remote/.oauth_token']);
  assert.ok(!DEFAULT_KEEP_RO.some(p => p === '/home/claude/.claude/remote' || /session_ingress/.test(p)), 'the parent session ingress token is never kept');
  // Any other host: the invoking user's home is hidden; only the claude and node binaries (and the links leading to
  // them) stay visible, never a whole tool directory and never ~/.claude (ISOLATION-PROBE-laptop §5.3).
  const home = os.homedir();
  if (!['/', '/root'].includes(home)) assert.ok(DEFAULT_HIDDEN.includes(home), 'the invoking user\'s home is hidden');
  assert.deepEqual(DEFAULT_KEEP_RO.slice(2), binaryKeeps(['claude', 'node'], process.env.PATH));
  for (const p of DEFAULT_KEEP_RO.slice(2)) assert.match(path.basename(p) + ' ' + p, /claude|node/, p);
  assert.ok(!DEFAULT_KEEP_RO.includes(path.join(home, '.local/bin')) && !DEFAULT_KEEP_RO.includes(path.join(home, '.local')) && !DEFAULT_KEEP_RO.includes('/root/.local'));
  assert.ok(DEFAULT_HIDDEN.includes('/var/log'), 'host logs are masked');
  // C0 gate 2026-10-07: the account directories are hidden (only the CLI login stays, read-only) and sysfs is read-only.
  assert.ok(DEFAULT_HIDDEN.includes('/home/claude') && DEFAULT_HIDDEN.includes('/home/ubuntu'));
  assert.equal(maskSteps({ workdir: work }).at(-1), 'mount -o remount,bind,ro /sys');
});

test('scrubEnv removes repository credentials and the parent session identity, keeping the rest', () => {
  const env = scrubEnv({ GH_TOKEN: 'x', GIT_CONFIG_KEY_0: 'x', AWS_SESSION_TOKEN: 'x', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/s',
    CLAUDE_SESSION_INGRESS_TOKEN_FILE: '/x', MAX_THINKING_TOKENS: '9', CLAUDE_CODE_SYNC_SKILLS: '1', SBX_TELEMETRY_SOCKET: '/run/x', PATH: '/usr/bin', HOME: '/root', HTTPS_PROXY: 'http://p', CLAUDE_CODE_ENTRYPOINT: 'x', N: undefined });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/root', HTTPS_PROXY: 'http://p', CLAUDE_CODE_ENTRYPOINT: 'x' });
});

// A fake host environment shaped like the owner's laptop (ISOLATION-PROBE-laptop §2.2: 27 credential-like names passed
// the old deny-list). Values are dummies; the real environment is never read or printed.
const CREDENTIAL_LIKE = /token|key|secret|pass|auth|cred/i;
const fakeHostEnv = home => ({
  PATH: '/usr/local/bin:/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', LC_TIME: 'C', LC_ALL: 'C.UTF-8', TERM: 'xterm', USER: 'u', LOGNAME: 'u', SHELL: '/bin/fish',
  CLAUDE_CODE_OAUTH_TOKEN: 'fake-oauth', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', FORCE_PROMPT_CACHING_5M: '1', DISABLE_AUTOUPDATER: '1',
  ...Object.fromEntries(['OPENROUTER', 'CEREBRAS', 'DEEPSEEK'].flatMap(p => [1, 2, 3, 4, 5].map(i => [`${p}_API_KEY_A${i}`, 'x']))),
  OPENCODE_ZEN_API_KEY_OC1: 'x', CLINE_API_KEY: 'x', EXPLABS_API_KEY: 'x', AGENTIC_OS_LOCAL_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'x',
  GH_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'x', DB_PASSWORD: 'x', GOOGLE_APPLICATION_CREDENTIALS: '/x', SOME_AUTH_HEADER: 'x', MY_SECRET: 'x',
  CLAUDE_CODE_OAUTH_SCOPES: 'x', CLAUDE_CODE_MESSAGING_TOKEN: 'x', USE_LOCAL_OAUTH: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDECODE: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
  FOUNDRY_SYSTEMONE_API_KEY: 'x', FOUNDRY_SYSTEMONE_URL: 'http://x', FOUNDRY_MODEL_GATEWAY_URL: 'http://host-own', FOUNDRY_MODEL_GATEWAY_TOKEN: 'host-own',
  XDG_CONFIG_HOME: `${home}/.config`, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus', DISPLAY: ':0', TMPDIR: `${home}/tmp`, N: undefined,
});

test('executorEnv is an allow-list: no credential-like name but CLAUDE_CODE_OAUTH_TOKEN survives a laptop-shaped environment', () => {
  const home = '/home/fake-owner', hidden = [...DEFAULT_HIDDEN, home];
  const host = fakeHostEnv(home);
  assert.ok(Object.keys(host).filter(k => CREDENTIAL_LIKE.test(k)).length >= 27, 'the fake environment carries the probe\'s credential load');
  const env = executorEnv({ env: host, hidden });
  assert.deepEqual(Object.keys(env).filter(k => CREDENTIAL_LIKE.test(k)), ['CLAUDE_CODE_OAUTH_TOKEN']);
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_OAUTH_TOKEN', 'DISABLE_AUTOUPDATER', 'DISABLE_UPDATES', 'FORCE_PROMPT_CACHING_5M', 'HOME', 'LANG', 'LC_ALL', 'LC_TIME', 'LOGNAME', 'PATH', 'TERM', 'TMPDIR', 'USER']);
  assert.equal(env.TMPDIR, '/tmp'); assert.equal(env.HOME, home);
  for (const k of Object.keys(env)) assert.ok(['TMPDIR', 'HOME'].includes(k) || EXECUTOR_ENV_ALLOWED.includes(k) || /^LC_/.test(k), k);
  // The old deny-list would have passed the third-party keys (the measured leak).
  assert.ok(Object.keys(scrubEnv(host)).filter(k => CREDENTIAL_LIKE.test(k)).length >= 27);
  // extraEnv: the host-minted gateway pair passes; credentials and HOME are refused.
  const gw = executorEnv({ env: host, hidden, extraEnv: { FOUNDRY_MODEL_GATEWAY_URL: 'http://127.0.0.1:9', FOUNDRY_MODEL_GATEWAY_TOKEN: 'per-session' } });
  assert.equal(gw.FOUNDRY_MODEL_GATEWAY_TOKEN, 'per-session'); assert.equal(gw.FOUNDRY_MODEL_GATEWAY_URL, 'http://127.0.0.1:9');
  for (const k of ['GH_TOKEN', 'AWS_SESSION_TOKEN', 'OPENROUTER_API_KEY_A1', 'ANTHROPIC_API_KEY', 'DB_PASSWORD', 'FOUNDRY_SYSTEMONE_API_KEY', 'HOME'])
    assert.throws(() => executorEnv({ env: host, hidden, extraEnv: { [k]: 'x' } }), { code: 'SANDBOX_ENV' }, k);
  // HOME must be masked: a home the sandbox would show is refused, never passed.
  assert.throws(() => executorEnv({ env: host, hidden: ['/tmp'] }), { code: 'SANDBOX_ENV' });
  assert.equal(executorEnv({ env: { ...host, HOME: `${home}/sub` }, hidden }).HOME, `${home}/sub`);
});

test('binaryKeeps follows symlinks to the real binaries and keeps nothing else from the tool directory', t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), bin = path.join(home, '.local/bin'), versions = path.join(home, '.local/share/claude/versions'), nodeDir = path.join(home, '.nvm/v24/bin');
  for (const d of [bin, versions, nodeDir]) mkdirSync(d, { recursive: true });
  const exe = (p, body = '#!/bin/sh\necho ok\n') => { writeFileSync(p, body); chmodSync(p, 0o755); };
  exe(path.join(versions, '2.0.1'), '#!/bin/sh\necho fake-claude-2.0.1\n'); symlinkSync(path.join(versions, '2.0.1'), path.join(bin, 'claude'));
  exe(path.join(nodeDir, 'node')); symlinkSync('../../.nvm/v24/bin/node', path.join(bin, 'node'));
  for (const name of ['secret-tool', 'gh-wrapper', 'deploy.sh']) exe(path.join(bin, name));
  writeFileSync(path.join(bin, 'not-executable'), 'x');
  const real = p => realpathSync(p);
  const keeps = binaryKeeps(['claude', 'node', 'absent'], `/nonexistent:${bin}:/usr/bin`);
  assert.deepEqual(keeps, [path.join(bin, 'claude'), real(path.join(versions, '2.0.1')), path.join(bin, 'node'), real(path.join(nodeDir, 'node'))]);
  assert.ok(!keeps.some(p => /secret-tool|gh-wrapper|deploy|not-executable/.test(p)));
  // maskSteps: links inside a hidden root are recreated (absolute target), files are bound read-only, the directory is not kept.
  const work = path.join(root, 'work'); mkdirSync(work);
  const steps = maskSteps({ workdir: work, hidden: [home], keepRo: keeps });
  const text = steps.join('\n');
  assert.match(text, new RegExp(`ln -s '${real(path.join(versions, '2.0.1'))}' '${path.join(bin, 'claude')}'`));
  assert.match(text, new RegExp(`mount -o remount,bind,ro '${real(path.join(nodeDir, 'node'))}'`));
  assert.doesNotMatch(text, new RegExp(`mount --rbind '${bin}'`), 'the tool directory itself is never bound');
  // A kept file outside every hidden root is already visible: no step (and never a truncating `: >` on a host file).
  const outside = maskSteps({ workdir: work, hidden: [path.join(root, 'elsewhere')], keepRo: keeps });
  assert.doesNotMatch(outside.join('\n'), new RegExp(`: > '${root}`));
});

test('maskSteps replaces /dev with a fresh read-only tmpfs of basic nodes, then makes sysfs read-only', t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, 'w'); mkdirSync(work);
  const steps = maskSteps({ workdir: work });
  const text = steps.join('\n');
  assert.deepEqual([...DEFAULT_DEVICES], ['null', 'zero', 'full', 'random', 'urandom', 'tty']);
  for (const n of DEFAULT_DEVICES) assert.match(text, new RegExp(`mount --bind /dev/${n} '/mnt/dev/${n}'`));
  assert.doesNotMatch(text, /nvidia|\/dev\/dri|\/dev\/nvme|\/dev\/sd/);
  assert.match(text, /mount --move '\/mnt\/dev' \/dev\nmount -o remount,bind,ro,nosuid \/dev\nmount -o remount,bind,ro \/sys$/);
  assert.doesNotMatch(maskSteps({ workdir: work, devices: null }).join('\n'), /foundry-dev/);
  assert.throws(() => maskSteps({ workdir: work, devices: ['../sda'] }), { code: 'EXECUTOR_PATH' });
  assert.throws(() => maskSteps({ workdir: work, keepRo: ['/dev/shm'] }), { code: 'EXECUTOR_PATH' });
});

test('the program runs one user namespace deeper as the host uid (CLI root check), and the availability probe has that shape', () => {
  const uid = process.getuid(), gid = process.getgid();
  // On a root host (the cloud) the program runs as UNPRIVILEGED_ID: the host uid 0 would fail the CLI root check.
  const [mu, mg] = uid === 0 ? [UNPRIVILEGED_ID, UNPRIVILEGED_ID] : [uid, gid];
  const last = sandboxScript(['true'], '/w', ['claude', '-p', 'x']).split('\n').at(-1);
  assert.equal(last, `exec unshare --user --map-user=${mu} --map-group=${mg} 'claude' '-p' 'x'`);
  assert.match(last, /^exec unshare --user --map-user=\d+ --map-group=\d+ /);
  assert.equal(sandboxScript(['true'], '/w', ['c'], { uid: 1234, gid: 99 }).split('\n').at(-1), "exec unshare --user --map-user=1234 --map-group=99 'c'");
  assert.deepEqual(sandboxProbeArgs(uid, gid), ['--user', '--map-root-user', '--mount', '--pid', '--fork', '--mount-proc', 'unshare', '--user', `--map-user=${mu}`, `--map-group=${mg}`, 'true']);
  assert.deepEqual(dropUidArgs(0, 0), ['unshare', '--user', '--map-user=65534', '--map-group=65534'], 'a root host never maps uid 0 into the program namespace');
  assert.deepEqual(dropUidArgs(1000, 1000), ['unshare', '--user', '--map-user=1000', '--map-group=1000'], 'a non-root host is unchanged');
  assert.deepEqual(UNSHARE_ARGS, ['--user', '--map-root-user', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc'], 'the outer (mount-phase) namespace is unchanged');
  assert.throws(() => dropUidArgs('1000; rm -rf /', 0), { code: 'SANDBOX_UNAVAILABLE' });
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
  // The caller's own abort is CANCELLED (orch-20261021 rank 21), whatever else a resultless end would read as; a result printed first stands.
  assert.equal(sessionError({ result: null, cancelled: true }), 'CANCELLED');
  assert.equal(sessionError({ result: null, sandboxReady: false, cancelled: true }), 'CANCELLED');
  assert.equal(sessionError({ result: null, stderr: 'API Error: 529 overloaded', cancelled: true }), 'CANCELLED');
  assert.equal(sessionError({ result: { is_error: false, result: 'done' }, cancelled: true }), null);
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

test('a session the caller aborts ends CANCELLED, not EXECUTOR_PROTOCOL (orch-20261021 rank 21, probe L3), and is charged at its bound', { skip: live }, async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const workdir = path.join(root, 'aborted'); mkdirSync(workdir);
  writeFileSync(path.join(workdir, 'fake-claude'), FAKE_CLI({ result: false })); chmodSync(path.join(workdir, 'fake-claude'), 0o755);
  const halt = new AbortController();
  const pending = runClaudeCode({ model: 'claude-haiku-4-5-20251001', prompt: 'x', workdir, budgetUsd: 0.75, timeoutMs: 30000, binary: path.join(workdir, 'fake-claude'), signal: halt.signal });
  // Abort once the session has started (its init event is on stdout); the fake CLI would otherwise sleep 30 s.
  setTimeout(() => halt.abort(), 1500);
  const started = Date.now(), r = await pending;
  assert.ok(Date.now() - started < 20000, 'the abort ended the session');
  assert.equal(r.error.code, 'CANCELLED'); assert.equal(r.ok, false);
  assert.equal(r.costUnknown, true); assert.equal(r.costUpperUsd, 0.75, 'a cancelled session is still charged at its bound');
  const early = new AbortController(); early.abort();
  const before = await runClaudeCode({ model: 'claude-haiku-4-5-20251001', prompt: 'x', workdir, budgetUsd: 0.75, timeoutMs: 30000, binary: path.join(workdir, 'fake-claude'), signal: early.signal });
  assert.equal(before.error.code, 'CANCELLED', 'a signal aborted before launch also reads as CANCELLED');
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

// The probe's env/device check (ISOLATION-PROBE-laptop §1), run through runClaudeCode itself with a seeded fake host
// environment: the stand-in CLI records variable names only, the device list and the masked paths.
const PROBE_CLI = `#!/bin/sh
cat > /dev/null
{ echo "env|$(env | cut -d= -f1 | grep -v '^_$' | sort | tr '\\n' ' ')"
  echo "dev|$(ls -A /dev | sort | tr '\\n' ' ')"
  test -e /dev/nvidia0; echo "nvidia0|$?"
  test -e /var/log/journal; echo "journal|$?"
  echo "varlog|$(ls -A /var/log | wc -l | tr -d ' ')"
  echo x > /dev/null; echo "null-w|$?"
  echo "urandom|$(head -c 4 /dev/urandom | wc -c | tr -d ' ')"
  touch /dev/shm/probe; echo "shm-w|$?"
  touch /dev/probe 2>/dev/null; echo "dev-w|$?"
  echo "localbin|$(ls -A "$HOME/.local/bin" 2>/dev/null | tr '\\n' ' ')"
  echo "uid|$(id -u)"
  test -e /home/claude/.claude/remote/.session_ingress_token; echo "ingress|$?"
  mount -t tmpfs probe /tmp 2>/dev/null; echo "mount|$?"
  umount -l /var/log 2>/dev/null; echo "umount|$?"
  unshare --user --map-root-user mount -t tmpfs probe /tmp 2>/dev/null; echo "remap-mount|$?"
  touch "$HOME/probe-home" /tmp/probe-tmp; echo "masks-w|$?"
} > probe.txt 2>&1
echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0,"num_turns":1}'
`;

test('live executor: only allow-listed variable names, basic /dev nodes, no host logs, no extra tools (probe re-run)', { skip: live }, async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const workdir = path.join(root, 'w'); mkdirSync(workdir);
  writeFileSync(path.join(workdir, 'probe-cli'), PROBE_CLI); chmodSync(path.join(workdir, 'probe-cli'), 0o755);
  const hostEnv = fakeHostEnv(os.homedir());
  const r = await runClaudeCode({ model: 'claude-haiku-4-5-20251001', prompt: 'x', workdir, timeoutMs: 30000, binary: path.join(workdir, 'probe-cli'), hostEnv,
    env: { FOUNDRY_MODEL_GATEWAY_URL: 'http://127.0.0.1:9', FOUNDRY_MODEL_GATEWAY_TOKEN: 'per-session' } });
  assert.equal(r.sandboxReady, true, JSON.stringify(r.error)); assert.equal(r.ok, true, JSON.stringify(r.error));
  const out = Object.fromEntries(readFileSync(path.join(workdir, 'probe.txt'), 'utf8').trim().split('\n').map(l => [l.slice(0, l.indexOf('|')), l.slice(l.indexOf('|') + 1).trim()]));
  const names = out.env.split(' ').filter(Boolean);
  assert.deepEqual(names.filter(n => CREDENTIAL_LIKE.test(n)), ['CLAUDE_CODE_OAUTH_TOKEN', 'FOUNDRY_MODEL_GATEWAY_TOKEN'], 'only the CLI auth and the explicit per-session gateway token');
  // sh adds PWD and SHLVL itself; dash (Ubuntu 0.5.12) also exports OLDPWD after the script's own cd.
  for (const n of names) assert.ok(['PWD', 'OLDPWD', 'SHLVL', 'TMPDIR', 'HOME', 'FOUNDRY_MODEL_GATEWAY_URL', 'FOUNDRY_MODEL_GATEWAY_TOKEN'].includes(n) || EXECUTOR_ENV_ALLOWED.includes(n) || /^LC_/.test(n), n);
  const devs = out.dev.split(' ');
  for (const n of ['null', 'zero', 'urandom', 'shm', 'fd']) assert.ok(devs.includes(n), n);
  assert.ok(!devs.some(n => /^(nvidia|dri|nvme|sd[a-z]|kvm|input|snd|mem|kmsg)/.test(n)), out.dev);
  // The parent cloud session's ingress credential never reaches a session (only the CLI login file is kept).
  assert.notEqual(out.ingress, '0', 'session ingress token visible in the sandbox');
  assert.equal(out.nvidia0, '1'); assert.equal(out.journal, '1'); assert.equal(out.varlog, '0');
  assert.equal(out['null-w'], '0'); assert.equal(out.urandom, '4'); assert.equal(out['shm-w'], '0'); assert.notEqual(out['dev-w'], '0', '/dev itself is read-only');
  // The home keeps at most the claude and node links in ~/.local/bin (binaryKeeps; the 402 owner tools stay hidden). The
  // cloud's node is /root/.local/bin/node (scripts/setup-node24.sh), the laptop's claude is ~/.local/bin/claude.
  assert.ok(out.localbin.split(' ').filter(Boolean).every(n => n === 'claude' || n === 'node'), out.localbin);
  // The session runs as the host uid (not 0) and holds no power over the mount namespace, even after a further unshare.
  assert.equal(out.uid, String(process.getuid() === 0 ? UNPRIVILEGED_ID : process.getuid()));
  assert.notEqual(out.mount, '0'); assert.notEqual(out.umount, '0'); assert.notEqual(out['remap-mount'], '0');
  assert.equal(out['masks-w'], '0', 'the private home and /tmp masks stay writable');
});

test('a CLI that bails at startup (no stream event) is booked at $0, not at its budget', { skip: live }, async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const workdir = path.join(root, 'w'); mkdirSync(workdir);
  writeFileSync(path.join(workdir, 'bail'), '#!/bin/sh\necho "Error: --dangerously-skip-permissions cannot be used with root/sudo privileges" >&2\nexit 1\n'); chmodSync(path.join(workdir, 'bail'), 0o755);
  const r = await runClaudeCode({ model: 'claude-haiku-4-5-20251001', prompt: 'x', workdir, budgetUsd: 2, timeoutMs: 30000, binary: path.join(workdir, 'bail') });
  assert.equal(r.sandboxReady, true); assert.equal(r.error.code, 'EXECUTOR_PROTOCOL'); assert.equal(r.error.exitCode, 1);
  assert.equal(r.costUsd, 0); assert.equal(r.costUnknown, false); assert.equal(r.costUpperUsd, 0);
});

test('live runSandboxed: a kept binary link resolves and runs while the rest of its tool directory stays hidden', { skip: live }, async t => {
  const root = tmpRoot(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), bin = path.join(home, '.local/bin'), versions = path.join(home, '.local/share/claude/versions'), work = path.join(root, 'w');
  for (const d of [bin, versions, work]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(versions, '9.9.9'), '#!/bin/sh\necho fake-claude-9.9.9\n'); chmodSync(path.join(versions, '9.9.9'), 0o755);
  symlinkSync(path.join(versions, '9.9.9'), path.join(bin, 'claude'));
  writeFileSync(path.join(bin, 'other-tool'), '#!/bin/sh\necho leaked\n'); chmodSync(path.join(bin, 'other-tool'), 0o755);
  writeFileSync(path.join(versions, '9.9.8'), 'old');
  const keepRo = binaryKeeps(['claude'], bin);
  const r = await runSandboxed({ command: 'sh', args: ['-c', `"${bin}/claude"; ls -A "${bin}" | tr '\\n' ' '; echo; ls -A "${versions}" | tr '\\n' ' '; echo; echo x > "${versions}/9.9.9" 2>/dev/null && echo WRITABLE || echo ro`],
    workdir: work, hidden: [...DEFAULT_HIDDEN, home], keepRo, timeoutMs: 30000 });
  assert.equal(r.code, 0, r.stderr); assert.equal(r.sandboxReady, true);
  const [ran, listed, vers, ro] = r.stdout.trim().split('\n').map(s => s.trim());
  assert.equal(ran, 'fake-claude-9.9.9'); assert.equal(listed, 'claude'); assert.equal(vers, '9.9.9'); assert.equal(ro, 'ro');
});
