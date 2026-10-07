import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, createServer } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MASKED_PATHS, runCode, sandboxStatus } from '../src/sandbox.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const status = await sandboxStatus();
const skip = status.available ? false : `sandbox unavailable on this host (${status.reason}); code nodes fail closed with SANDBOX_UNAVAILABLE instead of running`;
const rejects = (promise, code, extra = () => true) => assert.rejects(promise, e => e.code === code && extra(e));
const py = lines => lines.join('\n') + '\n';

test('sandbox: js and python pure functions return parsed JSON', { skip }, async () => {
  const js = await runCode({ lang: 'js', source: 'export default function main(input) { console.log("noise"); return { sum: input.a + input.b, tag: `${input.tag}!` }; }', input: { a: 2, b: 3, tag: 'é' } });
  assert.deepEqual(js.value, { sum: 5, tag: 'é!' });
  assert.equal(js.stderr, 'noise\n', 'console output is diverted away from the result channel');
  const python = await runCode({ lang: 'python', source: py(['def main(input):', '    print("noise")', '    return {"sum": input["a"] + input["b"], "tag": input["tag"] + "!"}']), input: { a: 2, b: 3, tag: 'é' } });
  assert.deepEqual(python.value, { sum: 5, tag: 'é!' });
  assert.equal(python.stderr, 'noise\n');
  assert.deepEqual((await runCode({ lang: 'js', source: 'export default () => null' })).value, null);
});

test('sandbox: async js main is awaited', { skip }, async () => {
  const r = await runCode({ lang: 'js', source: 'export default async function main(input) { await new Promise(r => setTimeout(r, 20)); return { doubled: input.v * 2 }; }', input: { v: 21 } });
  assert.deepEqual(r.value, { doubled: 42 });
  const p = await runCode({ lang: 'python', source: py(['import asyncio', 'async def main(input):', '    await asyncio.sleep(0.01)', '    return input["v"] + 1']), input: { v: 1 } });
  assert.equal(p.value, 2);
});

test('sandbox: the environment holds PATH only', { skip }, async () => {
  process.env.FOUNDRY_SANDBOX_SENTINEL = 'present-outside';
  try {
    const js = await runCode({ lang: 'js', source: 'export default () => Object.keys(process.env).sort()' });
    assert.deepEqual(js.value, ['PATH']);
    const python = await runCode({ lang: 'python', source: py(['import os', 'def main(input):', '    return sorted(os.environ)']) });
    // CPython adds LC_CTYPE itself when it coerces the C locale (PEP 538); nothing is inherited.
    assert.ok(python.value.every(k => ['PATH', 'LC_CTYPE'].includes(k)), python.value.join(','));
  } finally { delete process.env.FOUNDRY_SANDBOX_SENTINEL; }
});

test('sandbox: timeout and cancellation kill the whole process tree', { skip, timeout: 30000 }, async () => {
  const started = Date.now();
  await rejects(runCode({ lang: 'js', source: 'export default () => { for (;;) {} }', timeoutMs: 800 }), 'CODE_TIMEOUT');
  assert.ok(Date.now() - started < 5000);
  const controller = new AbortController(); setTimeout(() => controller.abort(), 300);
  await rejects(runCode({ lang: 'python', source: py(['import time', 'def main(input):', '    time.sleep(30)']), timeoutMs: 20000, signal: controller.signal }), 'CANCELLED');
  const tag = String(900000 + randomBytes(3).readUIntBE(0, 3));
  const survivors = () => readdirSync('/proc').filter(p => /^\d+$/.test(p)).filter(p => {
    try { return readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0').includes(tag); } catch { return false; }
  });
  const run = runCode({ lang: 'python', timeoutMs: 2500, source: py(['import os, time', 'def main(input):',
    '    if os.fork() == 0:', '        os.setsid()', `        os.execv("/bin/sleep", ["sleep", "${tag}"])`, '    while True: time.sleep(0.05)']) });
  let seen = false;
  for (let i = 0; i < 40 && !seen; i++) { await new Promise(r => setTimeout(r, 50)); seen = survivors().length > 0; }
  assert.ok(seen, 'control: the escaped child is visible while the code runs');
  await rejects(run, 'CODE_TIMEOUT');
  for (let i = 0; i < 40 && survivors().length; i++) await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(survivors(), [], 'a forked, setsid() child must not outlive the timeout');
});

test('sandbox: network is unreachable, including host loopback', { skip, timeout: 30000 }, async t => {
  const server = createServer(socket => socket.end('hello')); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { port } = server.address();
  // Control: the listener is reachable from outside the sandbox.
  await new Promise((resolve, reject) => { const c = connect(port, '127.0.0.1'); c.on('data', () => { c.destroy(); resolve(); }); c.on('error', reject); });
  const pyProbe = py(['import socket', 'def main(input):', '    out = {}', '    for host, port in [("127.0.0.1", input["port"]), ("1.1.1.1", 80)]:', '        try:',
    '            socket.create_connection((host, port), timeout=2).close()', '            out[host] = "connected"', '        except OSError as e:', '            out[host] = type(e).__name__', '    return out']);
  const p = await runCode({ lang: 'python', source: pyProbe, input: { port } });
  assert.notEqual(p.value['127.0.0.1'], 'connected'); assert.notEqual(p.value['1.1.1.1'], 'connected');
  const js = await runCode({ lang: 'js', input: { port }, source: `export default async function main({ port }) {
    const out = {};
    try { await fetch('http://127.0.0.1:' + port + '/'); out.fetch = 'connected'; } catch (e) { out.fetch = e.cause?.code ?? e.code ?? e.name; }
    out.connect = await new Promise(async resolve => { try { const net = await import('node:net'); const c = net.connect(port, '127.0.0.1');
      c.on('connect', () => resolve('connected')); c.on('error', e => resolve(e.code)); } catch (e) { resolve(e.code ?? e.name); } });
    return out; }` });
  assert.notEqual(js.value.fetch, 'connected'); assert.notEqual(js.value.connect, 'connected');
});

test('sandbox: repository files are not readable', { skip }, async t => {
  const target = path.join(root, 'package.json');
  assert.ok(existsSync(target));
  const js = await runCode({ lang: 'js', input: { target }, source: `import { readFileSync } from 'node:fs';
    export default ({ target }) => { try { return readFileSync(target, 'utf8').slice(0, 10); } catch (e) { return { denied: e.code }; } }` });
  assert.deepEqual(js.value, { denied: 'ERR_ACCESS_DENIED' }, 'node --permission denies every file read');
  const masked = MASKED_PATHS.some(p => target.startsWith(`${p}/`));
  if (!masked) { t.diagnostic(`repository at ${root} is outside the masked paths; python read isolation is not asserted here`); return; }
  const python = await runCode({ lang: 'python', input: { target }, source: py(['def main(input):', '    try:', '        return open(input["target"]).read()[:10]', '    except OSError as e:', '        return {"denied": type(e).__name__}']) });
  assert.deepEqual(python.value, { denied: 'FileNotFoundError' });
});

test('sandbox: code cannot write outside its ephemeral tmpfs', { skip }, async t => {
  const outsideDir = mkdtempSync(path.join(tmpdir(), 'foundry-sandbox-write-'));
  const probe = `/opt/foundry-sandbox-probe-${process.pid}-${randomBytes(4).toString('hex')}`;
  t.after(() => { rmSync(outsideDir, { recursive: true, force: true }); rmSync(probe, { force: true }); });
  const targets = [probe, path.join(outsideDir, 'leak.txt'), path.join(root, 'leak.txt')];
  const python = await runCode({ lang: 'python', input: { targets }, source: py(['def main(input):', '    out = []', '    for t in input["targets"]:', '        try:',
    '            open(t, "w").write("x")', '            out.append("wrote")', '        except OSError as e:', '            out.append(type(e).__name__)', '    return out']) });
  assert.equal(python.value[0], 'OSError', 'read-only remount blocks writes to unmasked system paths');
  for (const target of targets) assert.equal(existsSync(target), false, `${target} must not exist outside`);
  const js = await runCode({ lang: 'js', input: { targets }, source: `import { writeFileSync } from 'node:fs';
    export default ({ targets }) => targets.map(t => { try { writeFileSync(t, 'x'); return 'wrote'; } catch (e) { return e.code; } })` });
  assert.deepEqual(js.value, ['ERR_ACCESS_DENIED', 'ERR_ACCESS_DENIED', 'ERR_ACCESS_DENIED']);
  for (const target of targets) assert.equal(existsSync(target), false);
  const spawnTry = await runCode({ lang: 'js', source: `import { execSync } from 'node:child_process';
    export default () => { try { execSync('id'); return 'spawned'; } catch (e) { return e.code; } }` });
  assert.equal(spawnTry.value, 'ERR_ACCESS_DENIED');
});

test('sandbox: code cannot unmount its masks, clear read-only or regain capabilities', { skip }, async t => {
  const target = path.join(root, 'package.json'), probe = `/opt/foundry-sandbox-escape-${process.pid}-${randomBytes(4).toString('hex')}`;
  t.after(() => rmSync(probe, { force: true }));
  const source = py(['import ctypes, os', 'def main(input):', '    libc = ctypes.CDLL(None, use_errno=True)', '    out = {"uid": os.getuid()}',
    '    out["umount"] = libc.umount2(b"/home", 2)', '    out["remount"] = libc.mount(None, b"/", None, 32 | 4096, None)',
    '    with open("/proc/self/status") as f:', '        out["capEff"] = [l.split()[1] for l in f if l.startswith("CapEff:")][0]',
    '    try:', '        os.unshare(os.CLONE_NEWUSER | os.CLONE_NEWNS)', '        out["nested"] = "ok"',
    '        out["umount2"] = libc.umount2(b"/home", 2)', '        out["remount2"] = libc.mount(None, b"/", None, 32 | 4096, None)',
    '    except OSError as e:', '        out["nested"] = type(e).__name__',
    '    for key, action in [("read", lambda: open(input["target"]).read()), ("write", lambda: open(input["probe"], "w").write("x"))]:', '        try:',
    '            action()', '            out[key] = "allowed"', '        except OSError as e:', '            out[key] = type(e).__name__', '    return out']);
  const { value } = await runCode({ lang: 'python', source, input: { target, probe } });
  assert.notEqual(value.uid, 0, 'the interpreter is not namespace root');
  assert.equal(value.capEff, '0000000000000000');
  assert.equal(value.umount, -1); assert.equal(value.remount, -1);
  if (value.nested === 'ok') { assert.equal(value.umount2, -1, 'inherited masks are locked'); assert.equal(value.remount2, -1, 'inherited read-only is locked'); }
  assert.notEqual(value.write, 'allowed');
  if (MASKED_PATHS.some(p => target.startsWith(`${p}/`))) assert.notEqual(value.read, 'allowed');
  assert.equal(existsSync(probe), false);
});

test('sandbox: the root is an allowlist; host trees outside it do not exist and every mount but /tmp is read-only', { skip }, async () => {
  const source = py(['import os', 'def main(input):', '    out = {"root": sorted(os.listdir("/")), "etc": sorted(os.listdir("/etc")), "dev": sorted(os.listdir("/dev"))}',
    '    out["masked"] = {d: os.listdir(d) for d in input["masked"] if os.path.isdir(d)}',
    '    out["absent"] = [p for p in ["/sys", "/boot", "/nix", "/old", "/lost+found", "/container_info.json", "/mnt/user-data", "/opt/corpus"] if os.path.lexists(p)]',
    '    with open("/proc/self/mountinfo") as f:', '        rows = [l.split() for l in f]', '    out["writable"] = [r[4] for r in rows if "ro" not in r[5].split(",")]', '    return out']);
  const { value } = await runCode({ lang: 'python', source, input: { masked: MASKED_PATHS } });
  const allowed = new Set(['usr', 'bin', 'sbin', 'lib', 'lib32', 'lib64', 'libx32', 'etc', 'proc', 'dev', ...MASKED_PATHS.map(p => p.slice(1))]);
  assert.deepEqual(value.root.filter(e => !allowed.has(e)), [], `unexpected root entries: ${value.root}`);
  assert.deepEqual(value.etc.filter(e => !['ld.so.cache', 'ld.so.conf', 'ld.so.conf.d', 'localtime'].includes(e)), [], `unexpected /etc entries: ${value.etc}`);
  assert.deepEqual(value.dev, ['fd', 'full', 'null', 'random', 'stderr', 'stdin', 'stdout', 'urandom', 'zero']);
  assert.equal(Object.keys(value.masked).length, MASKED_PATHS.length, 'masked trees exist as directories');
  for (const [dir, entries] of Object.entries(value.masked)) assert.deepEqual(entries, [], `${dir} must be empty (python's interpreter lives under /usr)`);
  assert.deepEqual(value.absent, []);
  assert.deepEqual(value.writable, ['/tmp']);
});

test('sandbox: per-process limits cap memory, processes and file size inside the namespace', { skip, timeout: 60000 }, async () => {
  const source = py(['import os, time', 'def main(input):', '    with open("/proc/self/limits") as f:', '        lim = {l[:26].strip(): l[26:47].strip() for l in f}',
    '    kids, err = 0, None', '    try:', '        for _ in range(64):', '            if os.fork() == 0:', '                time.sleep(2)', '                os._exit(0)', '            kids += 1',
    '    except OSError as e:', '        err = type(e).__name__', '    small = len(bytearray(256 << 20)) >> 20', '    try:', '        bytearray(1 << 30)', '        big = "allocated"', '    except MemoryError:', '        big = "MemoryError"',
    '    return {"limits": [lim["Max processes"], lim["Max address space"], lim["Max file size"], lim["Max core file size"]], "kids": kids, "err": err, "small": small, "big": big}']);
  const { value } = await runCode({ lang: 'python', source, timeoutMs: 30000 });
  assert.deepEqual(value.limits, ['8', String(1 << 30), String(16 << 20), '0']);
  assert.equal(value.err, 'BlockingIOError'); assert.ok(value.kids < 8, `a fork loop is bounded by RLIMIT_NPROC (forked ${value.kids})`);
  assert.deepEqual([value.small, value.big], [256, 'MemoryError'], 'a 256 MiB allocation works; 1 GiB exceeds RLIMIT_AS');
  const alloc = mib => runCode({ lang: 'js', source: `export default () => { const a = []; for (let i = 0; i < ${mib / 64}; i++) a.push(Buffer.alloc(64 << 20, 1)); return a.length; }`, timeoutMs: 30000 })
    .then(r => r.value, e => e.code);
  assert.equal(await alloc(256), 4, 'control: ordinary Buffer use still works under RLIMIT_DATA');
  assert.equal(await alloc(1536), 'CODE_ERROR', 'Buffers outside the V8 heap are capped by RLIMIT_DATA');
});

test('sandbox: a root host runs the sandbox as an unprivileged kernel uid', { skip: skip || (process.getuid?.() !== 0 && 'host is not root') }, async () => {
  const tag = String(800000 + randomBytes(3).readUIntBE(0, 3));
  const run = runCode({ lang: 'python', timeoutMs: 3000, source: py(['import os, time', 'def main(input):', '    if os.fork() == 0:', `        os.execv("/bin/sleep", ["sleep", "${tag}"])`, '    time.sleep(30)']) });
  let uid;
  for (let i = 0; i < 40 && uid === undefined; i++) {
    await new Promise(r => setTimeout(r, 50));
    for (const p of readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
      try { if (readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0').includes(tag)) uid = readFileSync(`/proc/${p}/status`, 'utf8').match(/^Uid:\s+(\d+)/m)[1]; } catch {}
    }
  }
  await rejects(run, 'CODE_TIMEOUT');
  assert.equal(uid, '65534', 'RLIMIT_NPROC is not enforced for kuid 0, so sandboxed code must not run as host root');
});

test('sandbox: oversized output is rejected', { skip }, async () => {
  await rejects(runCode({ lang: 'js', source: 'export default () => "x".repeat(600 * 1024)' }), 'CODE_OUTPUT');
  await rejects(runCode({ lang: 'python', source: py(['def main(input):', '    return "x" * (600 * 1024)']) }), 'CODE_OUTPUT');
  await rejects(runCode({ lang: 'js', source: 'export default () => "x".repeat(100)', maxOutputBytes: 50 }), 'CODE_OUTPUT');
  await rejects(runCode({ lang: 'js', source: 'export default () => undefined' }), 'CODE_OUTPUT');
  await rejects(runCode({ lang: 'python', source: py(['def main(input):', '    return {1, 2}']) }), 'CODE_OUTPUT');
});

test('sandbox: exceptions become CODE_ERROR with bounded stderr', { skip }, async () => {
  await rejects(runCode({ lang: 'js', source: 'export default () => { throw new Error("boom-js") }' }), 'CODE_ERROR', e => /boom-js/.test(e.message) && e.details.exitCode !== 0);
  await rejects(runCode({ lang: 'python', source: py(['def main(input):', '    raise ValueError("boom-py")']) }), 'CODE_ERROR', e => /ValueError: boom-py/.test(e.message));
  await rejects(runCode({ lang: 'python', source: 'def main(:\n' }), 'CODE_ERROR', e => /SyntaxError/.test(e.message));
  await rejects(runCode({ lang: 'js', source: 'export const x = 1;' }), 'CODE_ERROR', e => /default function main/.test(e.message));
  await rejects(runCode({ lang: 'js', source: 'export default () => { console.error("y".repeat(200000)); throw new Error("late") }' }), 'CODE_ERROR', e => e.message.length < 2100 && e.details.stderr.length <= 4097);
});

test('sandbox: fails closed when unshare is unavailable and validates requests', async () => {
  await rejects(runCode({ lang: 'js', source: 'export default () => 1', unshare: '/nonexistent/unshare' }), 'SANDBOX_UNAVAILABLE');
  await rejects(runCode({ lang: 'js', source: 'export default () => 1', unshare: '/bin/false' }), 'SANDBOX_UNAVAILABLE');
  await rejects(runCode({ lang: 'ruby', source: 'x' }), 'CODE_LANG');
  await rejects(runCode({ lang: 'js', source: '' }), 'CODE_SOURCE');
  await rejects(runCode({ lang: 'js', source: 'export default () => 1', timeoutMs: 0 }), 'CODE_TIMEOUT_INVALID');
  await rejects(runCode({ lang: 'js', source: 'export default () => 1', maxOutputBytes: 600 * 1024 }), 'CODE_OUTPUT_INVALID');
  await rejects(runCode({ lang: 'js', source: 'export default () => 1', input: { n: NaN } }), 'INVALID_NUMBER');
});

// Builder sessions run inside an executor sandbox (unshare --user --map-root-user) where only uid 0 is
// mapped; a code node there must still run (keeping the mapped root) instead of failing setuid(65534).
test('sandbox: code nodes run inside an outer user namespace that maps only root', { skip: skip || (process.getuid?.() !== 0 && 'host is not root') }, async () => {
  const { spawnSync } = await import('node:child_process');
  const sandbox = fileURLToPath(new URL('../src/sandbox.mjs', import.meta.url));
  const script = `import { runCode, idMapped } from ${JSON.stringify(sandbox)};
    const r = await runCode({ lang: 'js', source: 'export default function main(i) { return { y: i.x * 2 }; }', input: { x: 21 } });
    console.log(JSON.stringify({ y: r.value?.y ?? null, mapped: idMapped('uid_map', 65534) }));`;
  const p = spawnSync('unshare', ['--user', '--map-root-user', '--mount', '--fork', process.execPath, '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60000 });
  assert.equal(p.status, 0, p.stderr);
  const out = JSON.parse(p.stdout.trim().split('\n').at(-1));
  assert.deepEqual(out, { y: 42, mapped: false });
});
