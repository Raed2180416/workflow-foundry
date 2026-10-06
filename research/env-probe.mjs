#!/usr/bin/env node
// Environment probe (ROADMAP §5.0). Writes research/env-<YYYYMMDD>/env.json and ENV.md.
//
// Read-only by design: it installs nothing, starts no daemon, runs no install hook and never
// executes OpenCode. Credentials are recorded as env var NAME -> present (true/false) only;
// values are never written, and every string in the output is scrubbed of the values of
// secret-like env vars as a second line of defence. Every probe has a timeout and records its
// error instead of throwing.
//
// Usage: node research/env-probe.mjs [YYYYMMDD] [--out <dir>] [--no-network]
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream, existsSync, accessSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE_SCHEMA = 'workflow-foundry.env-probe/v1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();

// ---------- arguments ----------
const argv = process.argv.slice(2);
let date = null;
let outDir = null;
let network = true;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--no-network') network = false;
  else if (a === '--out') outDir = argv[++i];
  else if (/^\d{8}$/.test(a)) date = a;
  else {
    console.error('Usage: node research/env-probe.mjs [YYYYMMDD] [--out <dir>] [--no-network]');
    process.exit(2);
  }
}
date ??= new Date().toISOString().slice(0, 10).replaceAll('-', '');
outDir = path.resolve(outDir ?? path.join(root, 'research', `env-${date}`));

// ---------- helpers ----------
const MAX_CAPTURE = 64 * 1024;
const tail = (s, n = 400) => (s ?? '').trim().slice(-n);
const firstLine = s => (s ?? '').trim().split('\n')[0] ?? '';
const gib = bytes => (Number.isFinite(bytes) ? Math.round((bytes / 2 ** 30) * 10) / 10 : null);

function run(cmd, args = [], { timeout = 10000, env = process.env, cwd = os.tmpdir() } = {}) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let stdout = '', stderr = '', settled = false, timedOut = false;
    let child;
    const done = result => { if (!settled) { settled = true; clearTimeout(timer); resolve({ ...result, ms: Date.now() - t0 }); } };
    try {
      child = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      return resolve({ ok: false, code: null, error: String(error?.code ?? error), stdout: '', stderr: '', ms: 0 });
    }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', d => { if (stdout.length < MAX_CAPTURE) stdout += d; });
    child.stderr.on('data', d => { if (stderr.length < MAX_CAPTURE) stderr += d; });
    child.on('error', error => done({ ok: false, code: null, error: String(error?.code ?? error), stdout, stderr }));
    child.on('close', (code, signal) => done({ ok: code === 0 && !timedOut, code, signal, timedOut, stdout, stderr, ...(timedOut ? { error: `timeout after ${timeout}ms` } : {}) }));
  });
}

function isExecutable(file) {
  try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; }
}

function which(name) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function realpathOrNull(file) { try { return realpathSync(file); } catch { return null; } }
function readOrNull(file) { try { return readFileSync(file, 'utf8'); } catch { return null; } }

function sha256File(file, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    const timer = setTimeout(() => { stream.destroy(); reject(new Error(`sha256 timeout after ${timeout}ms`)); }, timeout);
    stream.on('data', d => hash.update(d));
    stream.on('error', e => { clearTimeout(timer); reject(e); });
    stream.on('end', () => { clearTimeout(timer); resolve(hash.digest('hex')); });
  });
}

async function probe(name, fn, timeout = 60000) {
  const t0 = Date.now();
  let timer;
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`probe timeout after ${timeout}ms`)), timeout); }),
    ]);
    return { ...value, probeMs: Date.now() - t0 };
  } catch (error) {
    return { error: String(error?.message ?? error), probeMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function toolVersion(name, args = ['--version'], { candidates = [], timeout = 10000 } = {}) {
  const found = which(name) ?? candidates.find(isExecutable) ?? null;
  if (!found) return { present: false, path: null };
  const r = await run(found, args, { timeout });
  return {
    present: true, path: found, realpath: realpathOrNull(found),
    version: firstLine(r.stdout) || firstLine(r.stderr) || null,
    exitCode: r.code, ...(r.error ? { error: r.error } : {}),
  };
}

// ---------- probes ----------
const probes = {};

probes.node = await probe('node', async () => ({
  version: process.version,
  major: Number(process.versions.node.split('.')[0]),
  meetsEngines: Number(process.versions.node.split('.')[0]) >= 24,
  execPath: process.execPath,
  execPathReal: realpathOrNull(process.execPath),
  v8: process.versions.v8,
  lts: process.release.lts ?? null,
  platform: process.platform,
  arch: process.arch,
  nodeOnPath: which('node'),
  nodeOnPathReal: realpathOrNull(which('node') ?? ''),
}));

probes.sqlite = await probe('sqlite', async () => {
  const warnings = [];
  const onWarning = w => warnings.push(`${w.name}: ${w.message}`);
  process.on('warning', onWarning);
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const { v } = db.prepare('select sqlite_version() as v').get();
    db.close();
    await new Promise(r => setImmediate(r));
    return { available: true, sqliteVersion: v, warnings };
  } catch (error) {
    return { available: false, error: String(error?.code ?? error?.message ?? error), warnings };
  } finally {
    process.off('warning', onWarning);
  }
});

probes.os = await probe('os', async () => {
  const osRelease = readOrNull('/etc/os-release') ?? '';
  const pretty = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(osRelease)?.[1] ?? null;
  return {
    type: os.type(), release: os.release(), version: os.version(), platform: os.platform(), arch: os.arch(),
    distro: pretty,
    container: { dockerenv: existsSync('/.dockerenv'), containerenv: existsSync('/run/.containerenv') },
    uid: process.getuid?.() ?? null,
  };
});

probes.cpu = await probe('cpu', async () => {
  const cpus = os.cpus();
  const cpuinfo = readOrNull('/proc/cpuinfo') ?? '';
  const flagLine = /^flags\s*:\s*(.*)$/m.exec(cpuinfo)?.[1]?.split(/\s+/) ?? [];
  const interesting = ['avx', 'avx2', 'fma', 'f16c', 'avx512f', 'avx512_vnni', 'avx512_bf16', 'avx_vnni', 'amx_tile', 'amx_int8', 'amx_bf16'];
  const cgroupV2 = readOrNull('/sys/fs/cgroup/cpu.max')?.trim() ?? null;
  const quotaV1 = readOrNull('/sys/fs/cgroup/cpu/cpu.cfs_quota_us')?.trim() ?? null;
  const periodV1 = readOrNull('/sys/fs/cgroup/cpu/cpu.cfs_period_us')?.trim() ?? null;
  return {
    count: cpus.length,
    availableParallelism: os.availableParallelism?.() ?? null,
    model: cpus[0]?.model ?? null,
    simdFlags: interesting.filter(f => flagLine.includes(f)),
    cgroup: { cpuMaxV2: cgroupV2, cfsQuotaV1: quotaV1, cfsPeriodV1: periodV1 },
    loadavg: os.loadavg().map(n => Math.round(n * 100) / 100),
  };
});

probes.memory = await probe('memory', async () => {
  const meminfo = readOrNull('/proc/meminfo') ?? '';
  const kb = key => { const m = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(meminfo); return m ? Number(m[1]) * 1024 : null; };
  const maxV2 = readOrNull('/sys/fs/cgroup/memory.max')?.trim() ?? null;
  const limitV1 = readOrNull('/sys/fs/cgroup/memory/memory.limit_in_bytes')?.trim() ?? null;
  return {
    totalBytes: os.totalmem(), totalGiB: gib(os.totalmem()),
    freeBytes: os.freemem(), freeGiB: gib(os.freemem()),
    availableBytes: kb('MemAvailable'), availableGiB: gib(kb('MemAvailable')),
    swapTotalBytes: kb('SwapTotal'),
    cgroup: { memoryMaxV2: maxV2, limitInBytesV1: limitV1 },
  };
});

probes.disk = await probe('disk', async () => {
  const entries = {};
  for (const [label, target] of [['root', '/'], ['repo', root]]) {
    try {
      const s = statfsSync(target);
      const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
      entries[label] = { path: target, totalBytes: total, totalGiB: gib(total), freeBytes: free, freeGiB: gib(free) };
    } catch (error) {
      entries[label] = { path: target, error: String(error?.code ?? error) };
    }
  }
  return entries;
});

probes.sandbox = await probe('sandbox', async () => {
  const sysctl = file => readOrNull(file)?.trim() ?? null;
  const userns = {
    maxUserNamespaces: sysctl('/proc/sys/user/max_user_namespaces'),
    unprivilegedUsernsClone: sysctl('/proc/sys/kernel/unprivileged_userns_clone'),
    apparmorRestrictUnprivilegedUserns: sysctl('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'),
  };
  const bwrapPath = which('bwrap');
  const bwrap = { present: Boolean(bwrapPath), path: bwrapPath };
  if (bwrapPath) {
    const v = await run(bwrapPath, ['--version'], { timeout: 5000 });
    bwrap.version = firstLine(v.stdout) || null;
    const t = await run(bwrapPath, ['--unshare-user', '--ro-bind', '/', '/', 'true'], { timeout: 10000 });
    Object.assign(bwrap, { userNamespaceTest: 'bwrap --unshare-user --ro-bind / / true', works: t.ok, exitCode: t.code, stderr: tail(t.stderr, 300), ...(t.error ? { error: t.error } : {}) });
  } else {
    bwrap.works = false;
    bwrap.reason = 'bwrap not found on PATH';
  }
  // Independent signal: can this process create a user namespace at all (tells whether
  // installing bwrap would be sufficient)?
  const unsharePath = which('unshare');
  const unshare = { present: Boolean(unsharePath), path: unsharePath };
  if (unsharePath) {
    const t = await run(unsharePath, ['--user', '--map-root-user', 'true'], { timeout: 10000 });
    Object.assign(unshare, { test: 'unshare --user --map-root-user true', works: t.ok, exitCode: t.code, stderr: tail(t.stderr, 300), ...(t.error ? { error: t.error } : {}) });
  }
  return { userns, bwrap, unshare };
});

probes.docker = await probe('docker', async () => {
  const dockerPath = which('docker');
  const result = { present: Boolean(dockerPath), path: dockerPath, socketExists: existsSync('/var/run/docker.sock'), podman: which('podman') };
  if (!dockerPath) return { ...result, daemonReachable: false };
  const v = await run(dockerPath, ['--version'], { timeout: 5000 });
  result.clientVersion = firstLine(v.stdout) || null;
  // `docker info` only queries an existing daemon; this probe never starts one.
  const info = await run(dockerPath, ['info', '--format', '{{.ServerVersion}}'], { timeout: 10000 });
  Object.assign(result, {
    infoExitCode: info.code,
    daemonReachable: info.ok,
    serverVersion: info.ok ? firstLine(info.stdout) : null,
    infoStderr: info.ok ? '' : tail(info.stderr, 300),
    ...(info.error ? { infoError: info.error } : {}),
  });
  return result;
});

probes.playwright = await probe('playwright', async () => {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || null;
  const result = { browsersPathSet: Boolean(browsersPath), browsersPath, installed: [], expected: null };
  // Expected revisions for the repo's pinned playwright package.
  const browsersJson = readOrNull(path.join(root, 'node_modules/playwright-core/browsers.json'));
  const pkg = readOrNull(path.join(root, 'node_modules/playwright/package.json'));
  if (browsersJson) {
    const list = JSON.parse(browsersJson).browsers ?? [];
    const pick = n => list.find(b => b.name === n);
    result.expected = {
      playwrightVersion: pkg ? JSON.parse(pkg).version : null,
      chromium: pick('chromium') ? { revision: pick('chromium').revision, browserVersion: pick('chromium').browserVersion } : null,
      chromiumHeadlessShell: pick('chromium-headless-shell') ? { revision: pick('chromium-headless-shell').revision } : null,
    };
  }
  const exeCandidates = ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell'];
  if (browsersPath && existsSync(browsersPath)) {
    for (const entry of readdirSync(browsersPath).sort()) {
      if (!entry.startsWith('chromium')) continue;
      const dir = path.join(browsersPath, entry);
      let isLink = false;
      try { isLink = lstatSync(dir).isSymbolicLink(); } catch {}
      const record = { entry, symlinkTo: isLink ? readlinkSync(dir) : null, executables: [] };
      if (!isLink) {
        for (const rel of exeCandidates) {
          const exe = path.join(dir, rel);
          if (isExecutable(exe)) {
            const v = await run(exe, ['--version'], { timeout: 10000 });
            record.executables.push({ path: exe, version: firstLine(v.stdout) || null, exitCode: v.code, ...(v.error ? { error: v.error } : {}) });
          }
        }
        record.installationComplete = existsSync(path.join(dir, 'INSTALLATION_COMPLETE'));
      }
      result.installed.push(record);
    }
    if (result.expected?.chromium) {
      result.expectedChromiumInstalled = existsSync(path.join(browsersPath, `chromium-${result.expected.chromium.revision}`));
      result.expectedHeadlessShellInstalled = existsSync(path.join(browsersPath, `chromium_headless_shell-${result.expected.chromiumHeadlessShell?.revision}`));
    }
  }
  const sys = '/usr/bin/chromium';
  result.usrBinChromium = { present: isExecutable(sys) };
  if (result.usrBinChromium.present) {
    const v = await run(sys, ['--version'], { timeout: 10000 });
    Object.assign(result.usrBinChromium, { realpath: realpathOrNull(sys), version: firstLine(v.stdout) || null });
  }
  return result;
});

probes.opencode = await probe('opencode', async () => {
  // Hash only; OpenCode is never executed by this probe.
  const candidates = [...new Set(['/usr/bin/opencode', which('opencode')].filter(Boolean))];
  const pinSource = readOrNull(path.join(root, 'src/opencode-v2-free.mjs')) ?? '';
  const repoPins = [...new Set(pinSource.match(/\b[0-9a-f]{64}\b/g) ?? [])];
  const binaries = [];
  for (const file of candidates) {
    if (!existsSync(file)) { binaries.push({ path: file, present: false }); continue; }
    const real = realpathOrNull(file);
    const sha256 = await sha256File(real ?? file);
    binaries.push({ path: file, present: true, realpath: real, sizeBytes: statSync(real ?? file).size, sha256, matchesRepoPin: repoPins.includes(sha256) });
  }
  return { present: binaries.some(b => b.present), binaries, repoPinsFrom: 'src/opencode-v2-free.mjs', repoPins };
});

probes.python = await probe('python', async () => ({
  python3: await toolVersion('python3'),
  uv: await toolVersion('uv'),
  pip: await toolVersion(which('pip') ? 'pip' : 'pip3'),
}));

probes.tools = await probe('tools', async () => ({
  git: await toolVersion('git'),
  curl: await toolVersion('curl'),
  xz: await toolVersion('xz'),
  tar: await toolVersion('tar'),
  sha256sum: await toolVersion('sha256sum'),
}));

probes.gpu = await probe('gpu', async () => {
  const smi = which('nvidia-smi');
  const result = {
    nvidiaSmi: { present: Boolean(smi), path: smi },
    devices: { nvidia0: existsSync('/dev/nvidia0'), dri: existsSync('/dev/dri'), kfd: existsSync('/dev/kfd') },
  };
  if (smi) {
    const q = await run(smi, ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], { timeout: 10000 });
    Object.assign(result.nvidiaSmi, { exitCode: q.code, gpus: q.ok ? q.stdout.trim().split('\n') : [], stderr: tail(q.stderr, 300) });
  }
  result.available = Boolean(result.nvidiaSmi.gpus?.length) || result.devices.kfd;
  return result;
});

probes.localModels = await probe('localModels', async () => {
  // Read-only inventory of local open-weight runtimes and weights; GGUF files are not hashed here
  // (multi-GB); the manifest records the hashes verified at download time.
  const llamaCandidates = dir => ['llama-cli', 'llama-server'].map(n => path.join(dir, n));
  const llamaCli = await toolVersion('llama-cli', ['--version'], { candidates: llamaCandidates('/opt/llamacpp/build/bin').slice(0, 1) });
  const llamaServer = await toolVersion('llama-server', ['--version'], { candidates: llamaCandidates('/opt/llamacpp/build/bin').slice(1) });
  const ollama = await toolVersion('ollama', ['--version']);
  const modelsDir = '/opt/models';
  const gguf = existsSync(modelsDir)
    ? readdirSync(modelsDir).filter(f => f.endsWith('.gguf')).sort().map(f => ({ file: f, sizeBytes: statSync(path.join(modelsDir, f)).size, sizeGiB: gib(statSync(path.join(modelsDir, f)).size) }))
    : [];
  const manifestText = readOrNull(path.join(modelsDir, 'MANIFEST.txt'));
  const manifest = manifestText
    ? manifestText.trim().split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length === 4).map(([repository, revision, file, sha256]) => ({ repository, revision, file, sha256 }))
    : null;
  return { llamaCli, llamaServer, ollama, modelsDir, gguf, manifest };
});

const HOSTS = ['huggingface.co', 'registry.npmjs.org', 'pypi.org', 'api.github.com', 'ollama.com', 'nodejs.org', 'arxiv.org', 'api.anthropic.com'];
probes.network = network ? await probe('network', async () => {
  const present = n => Object.hasOwn(process.env, n) && process.env[n] !== '';
  const proxyEnv = Object.fromEntries(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'].map(n => [n, present(n)]));
  const viaFetch = async host => {
    const t0 = Date.now();
    const attempt = async method => {
      const res = await fetch(`https://${host}/`, { method, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      try { await res.body?.cancel(); } catch {}
      return res.status;
    };
    try {
      let method = 'HEAD';
      let status = await attempt(method);
      if (status === 405 || status === 501) { method = 'GET'; status = await attempt(method); }
      return { status, method, ms: Date.now() - t0 };
    } catch (error) {
      return { status: null, error: String(error?.cause?.code ?? error?.name ?? error), ms: Date.now() - t0 };
    }
  };
  const curlPath = which('curl');
  const viaCurl = async host => {
    if (!curlPath) return { status: null, error: 'curl not found' };
    const r = await run(curlPath, ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '-I', '--max-time', '10', `https://${host}/`], { timeout: 15000 });
    const status = Number(r.stdout.trim());
    return { status: status || null, exitCode: r.code, ms: r.ms, ...(r.ok ? {} : { error: tail(r.stderr, 200) || r.error || null }) };
  };
  const hosts = {};
  await Promise.all(HOSTS.map(async host => {
    const [fetchResult, curlResult] = await Promise.all([viaFetch(host), viaCurl(host)]);
    hosts[host] = { fetch: fetchResult, curl: curlResult, reachable: Boolean(fetchResult.status || curlResult.status) };
  }));
  return { method: 'HTTPS HEAD to https://<host>/ (GET on 405/501), 10s timeout, status code only; Node fetch in-process and curl', proxyEnvPresent: proxyEnv, hosts: Object.fromEntries(HOSTS.map(h => [h, hosts[h]])) };
}, 60000) : { skipped: '--no-network' };

const CREDENTIAL_NAMES = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'TYPESAFE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS',
  'MISTRAL_API_KEY', 'GROQ_API_KEY', 'TOGETHER_API_KEY', 'FIREWORKS_API_KEY', 'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'CEREBRAS_API_KEY',
  'MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_BEARER_TOKEN_BEDROCK',
  'GITHUB_TOKEN', 'GH_TOKEN', 'OLLAMA_HOST', 'OLLAMA_API_KEY',
];
probes.credentials = await probe('credentials', async () => {
  const present = Object.fromEntries(CREDENTIAL_NAMES.map(n => [n, Object.hasOwn(process.env, n) && process.env[n] !== '']));
  return { note: 'env var NAME -> present (non-empty); values are never read into the output', present };
});

probes.claudeCli = await probe('claudeCli', async () => {
  const claude = which('claude');
  const result = { present: Boolean(claude), path: claude, realpath: realpathOrNull(claude ?? '') };
  if (!claude) return result;
  const v = await run(claude, ['--version'], { timeout: 20000 });
  result.version = firstLine(v.stdout) || null;
  result.versionExitCode = v.code;
  const h = await run(claude, ['--help'], { timeout: 20000 });
  const flags = ['--print', '--model', '--output-format', '--json-schema', '--system-prompt', '--tools', '--safe-mode', '--strict-mcp-config', '--max-budget-usd', '--bare'];
  result.helpFlags = Object.fromEntries(flags.map(f => [f, new RegExp(`(^|[\\s,])${f.replace(/-/g, '\\-')}\\b`).test(h.stdout)]));
  return result;
});

probes.shell = await probe('shell', async () => ({
  BASH_DEFAULT_TIMEOUT_MS: Object.hasOwn(process.env, 'BASH_DEFAULT_TIMEOUT_MS'),
  BASH_MAX_TIMEOUT_MS: Object.hasOwn(process.env, 'BASH_MAX_TIMEOUT_MS'),
}));

probes.repo = await probe('repo', async () => {
  const head = await run('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 5000 });
  const branch = await run('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 });
  const dirty = await run('git', ['-C', root, 'status', '--porcelain'], { timeout: 10000 });
  return { path: root, head: head.stdout.trim() || null, branch: branch.stdout.trim() || null, dirtyEntries: dirty.ok ? dirty.stdout.split('\n').filter(Boolean).length : null };
});

// ---------- redaction ----------
// Defence in depth: scrub the value of every secret-like env var from the serialized output.
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|PROXY|COOKIE|SESSION)/i;
const secrets = Object.entries(process.env).filter(([n, v]) => SECRET_NAME.test(n) && typeof v === 'string' && v.length >= 8).map(([n, v]) => [n, v]).sort((a, b) => b[1].length - a[1].length);
function scrub(text) {
  let out = text;
  for (const [name, value] of secrets) out = out.split(value).join(`[redacted:${name}]`);
  return out;
}

// ---------- assemble ----------
const report = {
  schema: PROBE_SCHEMA,
  date,
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - started,
  generator: 'research/env-probe.mjs',
  readOnly: true,
  probes,
};

const status = (ok, warn = false) => (ok ? 'ok' : warn ? 'warn' : 'missing');
const p = probes;
const yes = b => (b ? 'yes' : 'no');
const rows = [
  ['Node >= 24', `${p.node.version ?? '?'} at ${p.node.execPathReal ?? p.node.execPath ?? '?'}`, status(p.node.meetsEngines)],
  ['node:sqlite', p.sqlite.available ? `SQLite ${p.sqlite.sqliteVersion}` : `unavailable (${p.sqlite.error})`, status(p.sqlite.available)],
  ['OS / kernel', `${p.os.distro ?? p.os.type} / ${p.os.release}`, 'info'],
  ['CPU', `${p.cpu.count} x ${p.cpu.model} (SIMD: ${(p.cpu.simdFlags ?? []).join(', ') || 'none'})`, 'info'],
  ['RAM', `${p.memory.totalGiB} GiB total, ${p.memory.availableGiB} GiB available`, 'info'],
  ['Disk free', `/ ${p.disk.root?.freeGiB} of ${p.disk.root?.totalGiB} GiB; repo ${p.disk.repo?.freeGiB} GiB`, 'info'],
  ['bwrap + user namespace', p.sandbox.bwrap?.present ? `bwrap ${p.sandbox.bwrap.version ?? ''}; test ${p.sandbox.bwrap.works ? 'passed' : `failed (exit ${p.sandbox.bwrap.exitCode})`}` : 'bwrap not installed', status(p.sandbox.bwrap?.works)],
  ['user namespaces (unshare)', p.sandbox.unshare?.present ? (p.sandbox.unshare.works ? 'unshare --user works' : `unshare --user failed (exit ${p.sandbox.unshare.exitCode})`) : 'unshare not installed', status(p.sandbox.unshare?.works, true)],
  ['Docker', p.docker.present ? `${p.docker.clientVersion}; daemon ${p.docker.daemonReachable ? `reachable (${p.docker.serverVersion})` : `unreachable (docker info exit ${p.docker.infoExitCode})`}` : 'docker client not installed', status(p.docker.daemonReachable)],
  ['Playwright Chromium', p.playwright.browsersPathSet ? `installed: ${(p.playwright.installed ?? []).filter(i => !i.symlinkTo).map(i => `${i.entry}${i.executables?.[0]?.version ? ` (${i.executables[0].version})` : ''}`).join(', ') || 'none'}; playwright ${p.playwright.expected?.playwrightVersion ?? '?'} expects chromium-${p.playwright.expected?.chromium?.revision ?? '?'} (${p.playwright.expected?.chromium?.browserVersion ?? '?'})` : 'PLAYWRIGHT_BROWSERS_PATH not set', status(p.playwright.expectedChromiumInstalled, (p.playwright.installed ?? []).length > 0)],
  ['/usr/bin/chromium', p.playwright.usrBinChromium?.present ? p.playwright.usrBinChromium.version : 'absent', status(p.playwright.usrBinChromium?.present, true)],
  ['OpenCode', p.opencode.present ? p.opencode.binaries.filter(b => b.present).map(b => `${b.path} sha256 ${b.sha256} (repo pin match: ${yes(b.matchesRepoPin)})`).join('; ') : 'absent (/usr/bin/opencode not found)', status(p.opencode.present && p.opencode.binaries.some(b => b.matchesRepoPin))],
  ['python3 / uv / pip', [p.python.python3, p.python.uv, p.python.pip].map(t => (t?.present ? t.version : 'absent')).join(' / '), 'info'],
  ['GPU', p.gpu.available ? (p.gpu.nvidiaSmi.gpus ?? []).join('; ') : `none (nvidia-smi ${p.gpu.nvidiaSmi?.present ? 'present' : 'absent'}, /dev/nvidia0 ${yes(p.gpu.devices?.nvidia0)})`, status(p.gpu.available, true)],
  ['claude CLI', p.claudeCli.present ? `${p.claudeCli.version} at ${p.claudeCli.path}` : 'absent', status(p.claudeCli.present)],
  ['BASH_DEFAULT_TIMEOUT_MS', p.shell.BASH_DEFAULT_TIMEOUT_MS ? 'set' : 'not set (harness default applies)', status(p.shell.BASH_DEFAULT_TIMEOUT_MS, true)],
  ['llama.cpp (CPU)', p.localModels.llamaCli?.present ? `llama-cli ${p.localModels.llamaCli.version ?? ''}; ${(p.localModels.gguf ?? []).length} GGUF in ${p.localModels.modelsDir}` : 'not installed', status(p.localModels.llamaCli?.present, true)],
];
const netRows = probes.network.hosts
  ? Object.entries(probes.network.hosts).map(([h, r]) => `| ${h} | ${r.fetch.status ?? `error: ${r.fetch.error}`} | ${r.curl.status ?? `error: ${r.curl.error}`} |`)
  : [`| (skipped: ${probes.network.skipped}) | | |`];
const credPresent = Object.entries(probes.credentials.present ?? {});
const escapeCell = s => String(s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');

const HUMAN_BEGIN = '<!-- BEGIN HUMAN NOTES (preserved verbatim by env-probe.mjs on re-run) -->';
const HUMAN_END = '<!-- END HUMAN NOTES -->';
const mdPath = path.join(outDir, 'ENV.md');
const previous = readOrNull(mdPath);
const humanBlock = previous && previous.includes(HUMAN_BEGIN) && previous.includes(HUMAN_END)
  ? previous.slice(previous.indexOf(HUMAN_BEGIN), previous.indexOf(HUMAN_END) + HUMAN_END.length)
  : `${HUMAN_BEGIN}\n## Implications\n\n(none recorded yet)\n${HUMAN_END}`;

const md = `# Environment probe ${date}

Generated by \`research/env-probe.mjs\` (${PROBE_SCHEMA}) at ${report.generatedAt} in ${report.durationMs} ms.
Raw results: [env.json](env.json). The probe is read-only: it installs nothing, starts no daemon,
never executes OpenCode, and records credentials as env var names with true/false only.
Repository: \`${p.repo.branch ?? '?'}\` @ \`${p.repo.head ?? '?'}\` (${p.repo.dirtyEntries ?? '?'} uncommitted entries at probe time).

## Summary

| Requirement | Observed | Status |
| --- | --- | --- |
${rows.map(r => `| ${r.map(escapeCell).join(' | ')} |`).join('\n')}

## Outbound HTTPS (status code only, 10 s timeout)

| Host | Node fetch | curl |
| --- | --- | --- |
${netRows.join('\n')}

## Model-provider credentials (names only)

Present: ${credPresent.filter(([, v]) => v).map(([n]) => `\`${n}\``).join(', ') || 'none'}.
Absent: ${credPresent.filter(([, v]) => !v).map(([n]) => `\`${n}\``).join(', ') || 'none'}.

## Probe errors

${Object.entries(probes).filter(([, v]) => v?.error).map(([k, v]) => `- \`${k}\`: ${escapeCell(v.error)}`).join('\n') || '- none'}

${humanBlock}
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'env.json'), scrub(JSON.stringify(report, null, 2)) + '\n');
writeFileSync(mdPath, scrub(md));
console.log(scrub(`env probe ${date}: wrote ${path.relative(root, outDir) || outDir}/env.json and ENV.md in ${report.durationMs} ms`));
for (const r of rows) console.log(scrub(`  ${r[2].padEnd(7)} ${r[0]}: ${r[1]}`));
