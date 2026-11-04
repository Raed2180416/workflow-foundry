// The Claude Code CLI pinned by bytes (compromise C2; src/cli-pin.mjs, scripts/fetch-cli.mjs, research/manifests/claude-cli.lock.json).
// Fake CLIs (shell scripts) stand in for two CLI versions; no model is called and nothing is downloaded. One check reads the CLI
// installed on this host (hash only) when it is the locked version. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliIdentityOf, cliPinChange, DEFAULT_LOCK, fileSha256, platformKey, readCliLock, resolveCli } from '../src/cli-pin.mjs';
import { gcCli, installCli, referencedVersions } from '../scripts/fetch-cli.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ClaudeCliProvider } from '../src/models/providers/claude-cli.mjs';

const policy = loadPolicy().policy, model = policy.models.find(m => m.provider === 'claude-cli');
const scratch = t => { const dir = mkdtempSync(path.join(tmpdir(), 'cli-pin-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
// A fake CLI of `version` whose answer names its tool list; `log` (optional) records every launch, --version included.
const fakeCli = (version, { log = null } = {}) => `#!/bin/sh
${log ? `echo "$$ $*" >> ${JSON.stringify(log)}` : ''}
if [ "$1" = "--version" ]; then echo "${version} (Claude Code)"; exit 0; fi
cat > /dev/null
printf '%s\\n' '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', structured_output: { version, tools: version === '2.1.300' ? ['Bash'] : ['Bash', 'Read'] }, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 }, modelUsage: { [model.id]: {} } })}'
`;
// Install a fake as a pinned binary under root/<sha>/claude and write its lock. -> {lock, sha256, file}
function pinned(dir, root, version, name = version) {
  const staged = path.join(dir, `stage-${name}`); writeFileSync(staged, fakeCli(version)); chmodSync(staged, 0o755);
  const sha256 = fileSha256(staged), size = statSync(staged).size, file = path.join(root, sha256, 'claude');
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, readFileSync(staged)); chmodSync(file, 0o755);
  const lock = path.join(dir, `lock-${name}.json`);
  writeFileSync(lock, JSON.stringify({ kind: 'foundry.cli-lock/1', tool: 'claude-code', version, platforms: { [platformKey()]: { binary: 'claude', sha256, size } } }));
  return { lock, sha256, file, staged };
}
const call = provider => provider.complete({ modelEntry: model, system: 's', prompt: 'p', schema: { type: 'object' } });

test('the lock in the repository is well formed, and on a host whose CLI is the locked version its bytes are the locked ones', t => {
  const lock = readCliLock(DEFAULT_LOCK, 'linux-x64');
  assert.equal(lock.version, '2.1.306'); assert.match(lock.entry.sha256, /^[0-9a-f]{64}$/); assert.equal(lock.entry.size, 290532720);
  const installed = '/opt/claude-code/bin/claude';
  const version = existsSync(installed) ? spawnSync(installed, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: tmpdir(), DISABLE_AUTOUPDATER: '1', DISABLE_UPDATES: '1' }, timeout: 20000 }).stdout ?? '' : '';
  if (platformKey() !== 'linux-x64' || !version.startsWith('2.1.306')) { t.skip(`installed CLI is not 2.1.306 on linux-x64 (${version.trim() || 'absent'})`); return; }
  assert.equal(statSync(installed).size, lock.entry.size);
  assert.equal(fileSha256(installed), lock.entry.sha256, 'the release manifest hash is the bytes of the CLI on this host');
});

test('resolveCli: the pinned bytes resolve to an absolute path; a 1-byte tamper is CLI_DRIFT; no lock, no pin; an unacquired pin is refused', t => {
  const dir = scratch(t), root = path.join(dir, 'cli'), p = pinned(dir, root, '2.1.300');
  const r = resolveCli({ lockFile: p.lock, cliRoot: root });
  assert.equal(r.path, p.file); assert.ok(path.isAbsolute(r.path)); assert.equal(r.version, '2.1.300'); assert.equal(r.sha256, p.sha256);
  assert.equal(resolveCli({ lockFile: null, cliRoot: root }), null, 'pinning is off without a lock');
  appendFileSync(p.file, 'x');
  assert.throws(() => resolveCli({ lockFile: p.lock, cliRoot: root }), { code: 'CLI_DRIFT' });
  // Same size, one byte changed, mtime restored: the identity cache still notices (ctime and the content hash).
  const bytes = readFileSync(p.staged); bytes[bytes.length - 2] ^= 1; writeFileSync(p.file, bytes);
  const { atime, mtime } = statSync(p.staged); utimesSync(p.file, atime, mtime);
  assert.throws(() => resolveCli({ lockFile: p.lock, cliRoot: root }), { code: 'CLI_DRIFT' });
  const unacquired = path.join(dir, 'unacquired.json');
  writeFileSync(unacquired, JSON.stringify({ kind: 'foundry.cli-lock/1', tool: 'claude-code', version: '2.1.306', platforms: { [platformKey()]: { sha256: null, size: null } } }));
  assert.throws(() => resolveCli({ lockFile: unacquired, cliRoot: root }), { code: 'CLI_UNPINNED' });
  rmSync(root, { recursive: true, force: true });
  assert.throws(() => resolveCli({ lockFile: p.lock, cliRoot: root }), { code: 'CLI_UNPINNED' }, 'a lock whose binary is not fetched never falls back to PATH');
});

test('a pinned provider never launches the fake `claude` first on PATH, and records the pinned version that served each call', async t => {
  const dir = scratch(t), root = path.join(dir, 'cli'), bin = path.join(dir, 'bin'), log = path.join(dir, 'path-claude.log');
  mkdirSync(bin); writeFileSync(path.join(bin, 'claude'), fakeCli('9.9.9', { log })); chmodSync(path.join(bin, 'claude'), 0o755);
  const p = pinned(dir, root, '2.1.300');
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: dir };
  const provider = new ClaudeCliProvider({ policy, env, binary: 'claude', cliLock: p.lock, cliRoot: root });
  const r = await call(provider);
  assert.deepEqual(r.value, { version: '2.1.300', tools: ['Bash'] });
  assert.equal(r.engineVersion, `claude-code 2.1.300 sha256:${p.sha256.slice(0, 12)}`);
  assert.equal(existsSync(log), false, 'the CLI on PATH was never launched, not even for --version');
  // The pinned file is swapped behind the provider's back: the next call is refused, nothing runs.
  writeFileSync(p.file, fakeCli('2.1.306')); chmodSync(p.file, 0o755);
  await assert.rejects(call(provider), error => error.code === 'MODEL_PROTOCOL' && /^CLI_DRIFT/.test(error.message));
  assert.equal(existsSync(log), false);
  // Unpinned, the same provider runs the CLI on PATH and asks it for its version on every call.
  const loose = new ClaudeCliProvider({ policy, env, binary: 'claude', cliLock: null });
  assert.equal((await call(loose)).engineVersion, 'claude-code 9.9.9');
  assert.equal((await call(loose)).engineVersion, 'claude-code 9.9.9');
  assert.equal(readFileSync(log, 'utf8').split('\n').filter(l => / --version$/.test(l)).length, 2, 'one version probe per call (the per-connect check)');
});

test('incident replay: resumed at the 2.1.300 lock while PATH has 2.1.306, the run gets the 2.1.300 tool list; bumping the lock is refused on resume', async t => {
  const dir = scratch(t), root = path.join(dir, 'cli'), bin = path.join(dir, 'bin');
  mkdirSync(bin); writeFileSync(path.join(bin, 'claude'), fakeCli('2.1.306')); chmodSync(path.join(bin, 'claude'), 0o755);
  const old = pinned(dir, root, '2.1.300'), bumped = pinned(dir, root, '2.1.306', 'bumped');
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: dir };
  const launch = resolveCli({ lockFile: old.lock, cliRoot: root });
  const recorded = { version: launch.version, sha256: launch.sha256, pinned: true };
  const resumed = await call(new ClaudeCliProvider({ policy, env, binary: 'claude', cliLock: old.lock, cliRoot: root }));
  assert.deepEqual(resumed.value.tools, ['Bash'], 'the 2.1.300 tool list, not the 2.1.306 one on PATH');
  assert.equal(cliPinChange(recorded, { ...resolveCli({ lockFile: old.lock, cliRoot: root }), pinned: true }), null, 'the same pin resumes');
  const now = resolveCli({ lockFile: bumped.lock, cliRoot: root });
  assert.match(cliPinChange(recorded, { version: now.version, sha256: now.sha256, pinned: true }), /CLI changed since launch: 2\.1\.300 .* -> 2\.1\.306/);
  assert.match(cliPinChange(recorded, cliIdentityOf('claude', '2.1.306', { pathEnv: env.PATH })), /CLI changed since launch/, 'nor resumed unpinned on another binary');
  assert.equal(cliPinChange({ version: '2.1.300' }, { version: '2.1.306', sha256: now.sha256 }), null, 'a launch that recorded no hash (an older run) is not refused here');
});

test('fetch-cli: installs only the locked bytes (from a local file here), refuses below the disk guard; GC never deletes a pinned or referenced version', async t => {
  const dir = scratch(t), root = path.join(dir, 'cli'), src = pinned(dir, path.join(dir, 'elsewhere'), '2.1.300');
  const got = await installCli({ lockFile: src.lock, cliRoot: root, from: src.staged });
  assert.equal(got.sha256, src.sha256); assert.equal(got.already, false); assert.equal(resolveCli({ lockFile: src.lock, cliRoot: root }).path, got.path);
  assert.equal((await installCli({ lockFile: src.lock, cliRoot: root, from: src.staged })).already, true);
  const wrong = path.join(dir, 'wrong'); writeFileSync(wrong, fakeCli('2.1.306'));
  const other = path.join(dir, 'other-root');
  await assert.rejects(installCli({ lockFile: src.lock, cliRoot: other, from: wrong }), { code: 'CLI_DRIFT' });
  assert.equal(existsSync(path.join(other, src.sha256, 'claude')), false, 'nothing is installed from wrong bytes');
  await assert.rejects(installCli({ lockFile: src.lock, cliRoot: path.join(dir, 'tiny'), from: src.staged, minFreeBytes: Number.MAX_SAFE_INTEGER }), { code: 'DISK_GUARD' });
  let fetched = 0;
  await assert.rejects(installCli({ lockFile: src.lock, cliRoot: path.join(dir, 'net'), fetchImpl: async () => { fetched++; return { ok: true, body: null, status: 200 }; } }), { code: 'CLI_LOCK_INVALID' }, 'a lock without a release URL is not fetched');
  assert.equal(fetched, 0);
  // GC: four versions; the lock's and one an unfinished run's launch.json names are kept; at most two remain otherwise.
  const shas = ['a', 'b', 'c', 'd'].map(x => x.repeat(64));
  shas.forEach((sha, i) => { mkdirSync(path.join(root, sha), { recursive: true }); const s = new Date(Date.now() - (10 - i) * 60000); utimesSync(path.join(root, sha), s, s); });
  const runs = path.join(dir, 'runs');
  mkdirSync(path.join(runs, 'r1'), { recursive: true }); writeFileSync(path.join(runs, 'r1', 'launch.json'), JSON.stringify({ cli: { version: '2.1.300', sha256: shas[0] } }));
  mkdirSync(path.join(runs, 'r2'), { recursive: true }); writeFileSync(path.join(runs, 'r2', 'launch.json'), JSON.stringify({ cli: { sha256: shas[1] } })); writeFileSync(path.join(runs, 'r2', 'summary.json'), '{}');
  assert.deepEqual([...referencedVersions([runs])], [shas[0]], 'a finished run (summary.json) does not hold its version');
  const gc = gcCli({ cliRoot: root, protect: [src.sha256], scan: [runs] });
  assert.ok(existsSync(path.join(root, src.sha256, 'claude')), 'the pinned version is never deleted');
  assert.ok(existsSync(path.join(root, shas[0])), 'a version an unfinished run references is never deleted');
  assert.deepEqual(gc.removed.sort(), [shas[1], shas[2], shas[3]].sort());
});
