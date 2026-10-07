// Test runner for the ownerci bed: materialises a fresh temp copy of a frozen fixture with one
// module replaced, runs the frozen visible tests, the hidden tests and the export guard with
// `node --test` in a child process, and returns per-test results.
//
// Isolation: when the kernel allows unprivileged namespaces, the run happens inside
// `unshare --user --map-root-user --net --mount --pid --mount-proc --fork --kill-child`: no network,
// no view of host processes, tmpfs over /home, /root and /opt/models (so the repository, the bed's
// own fixtures and hidden tests are not visible), the root file system remounted read-only and only
// the temp copy writable. Otherwise a plain child process. Either way the child gets a minimal
// environment (no inherited variables, HOME and TMPDIR inside the temp copy), a 60 s wall timeout
// enforced by `timeout -s KILL`, a per-test timeout, a V8 heap cap, code generation from strings
// disabled (no eval / Function) and the harden.mjs preload (frozen assert objects). Results travel
// through a custom reporter that runs in the `node --test` parent (which never imports the
// candidate) into a file whose name carries a per-run random nonce; nothing the candidate prints
// is parsed. The exit status of `node --test` is returned so that the oracle can require a clean
// exit (AUDIT.md F3).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODULES } from './modules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, 'fixtures');
const REPORTER_SRC = path.join(HERE, 'reporter.mjs');
const HARDEN_SRC = path.join(HERE, 'harden.mjs');
export const HIDDEN_FILE = 'hidden.test.mjs';
export const GUARD_FILE = '__ownerci_exports__.test.mjs';
export const GUARD_TEST = 'ownerci export guard';
const REPORTER_FILE = '__ownerci_reporter__.mjs';
const HARDEN_FILE = '__ownerci_harden__.mjs';
export const WALL_SECONDS = 60;
const TIMEOUT_BIN = ['/usr/bin/timeout', '/bin/timeout'].find(p => existsSync(p)) ?? null;
const UNSHARE_BIN = ['/usr/bin/unshare', '/bin/unshare'].find(p => existsSync(p)) ?? null;
const UNSHARE_ARGS = ['--user', '--map-root-user', '--net', '--mount', '--pid', '--mount-proc', '--fork', '--kill-child'];
// Runs as root of the new user namespace. $1 is the temp copy; the rest is the command.
const SANDBOX_SCRIPT = [
  'set -e',
  'job="$1"; shift',
  'mount --bind "$job" "$job"',
  'mount -t tmpfs -o size=1m,mode=0755 tmpfs /home',
  'mount -t tmpfs -o size=1m,mode=0700 tmpfs /root',
  'if [ -d /opt/models ]; then mount -t tmpfs -o size=1m,mode=0755 tmpfs /opt/models; fi',
  'mount -o remount,bind,ro / 2>/dev/null || true',
  'cd "$job"',
  'exec "$@"',
].join('\n');
// Node flags for the parent and (through NODE_OPTIONS) every test-file child.
const nodeOptions = dir => `--max-old-space-size=512 --disallow-code-generation-from-strings --import=${pathToFileURL(path.join(dir, HARDEN_FILE)).href}`;

const fileCache = new Map();
function listFiles(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** All frozen files of one fixture (module, visible tests, related sources, hidden tests). */
export function fixtureFiles(moduleId) {
  if (!Object.hasOwn(MODULES, moduleId)) throw new Error(`ownerci: unknown module ${moduleId}`);
  if (!fileCache.has(moduleId)) {
    const dir = path.join(FIXTURES, moduleId);
    const files = {};
    for (const rel of listFiles(dir)) files[rel] = readFileSync(path.join(dir, rel), 'utf8');
    fileCache.set(moduleId, Object.freeze(files));
  }
  return fileCache.get(moduleId);
}

let sandboxProbe = null;
/** True when an unprivileged user+net namespace can be created here (probed once). */
export function sandboxAvailable() {
  if (sandboxProbe === null) {
    if (!UNSHARE_BIN) sandboxProbe = false;
    else {
      const probeDir = mkdtempSync(path.join(tmpdir(), 'ownerci-probe-'));
      const r = spawnSync(UNSHARE_BIN, [...UNSHARE_ARGS, '/bin/sh', '-c', SANDBOX_SCRIPT, 'ownerci-sandbox', probeDir, '/bin/true'],
        { env: { PATH: '/usr/bin:/bin' }, timeout: 5000, stdio: 'ignore' });
      rmSync(probeDir, { recursive: true, force: true });
      sandboxProbe = !r.error && r.status === 0;
    }
  }
  return sandboxProbe;
}

function guardTestSource(modulePath, exportsSpec) {
  return `import test from 'node:test';
import * as candidate from './${modulePath}';
const expected = ${JSON.stringify(exportsSpec)};
const kindOf = v => typeof v === 'function' ? (/^class[\\s{]/.test(Function.prototype.toString.call(v)) ? 'class' : 'function')
  : Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
test(${JSON.stringify(GUARD_TEST)}, () => {
  const problems = [];
  for (const e of expected) {
    if (!Object.hasOwn(candidate, e.name)) { problems.push('missing export ' + e.name); continue; }
    const v = candidate[e.name], kind = kindOf(v);
    if (kind !== e.kind) { problems.push('export ' + e.name + ' changed from ' + e.kind + ' to ' + kind); continue; }
    if ((kind === 'function' || kind === 'class') && v.length !== e.arity) problems.push('arity of ' + e.name + ' changed from ' + e.arity + ' to ' + v.length);
    for (const [m, arity] of Object.entries(e.methods ?? {})) {
      const f = v.prototype?.[m];
      if (typeof f !== 'function') problems.push('missing method ' + e.name + '.' + m);
      else if (f.length !== arity) problems.push('arity of ' + e.name + '.' + m + ' changed from ' + arity + ' to ' + f.length);
    }
  }
  if (problems.length) throw new Error('OWNERCI_GUARD ' + JSON.stringify(problems));
});
`;
}

function prepare(moduleId, moduleSource, { exportsSpec = null, includeHidden = true } = {}) {
  const m = MODULES[moduleId];
  const files = fixtureFiles(moduleId);
  const dir = mkdtempSync(path.join(tmpdir(), `ownerci-${moduleId}-`));
  for (const [rel, text] of Object.entries(files)) {
    if (rel === HIDDEN_FILE && !includeHidden) continue;
    const out = path.join(dir, rel);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, rel === m.modulePath ? moduleSource : text);
  }
  const testFiles = [m.testPath];
  if (includeHidden) testFiles.push(HIDDEN_FILE);
  if (exportsSpec) { writeFileSync(path.join(dir, GUARD_FILE), guardTestSource(m.modulePath, exportsSpec)); testFiles.push(GUARD_FILE); }
  for (const f of testFiles) if (!Object.hasOwn(files, f) && f !== GUARD_FILE) throw new Error(`ownerci: test file ${f} missing from fixture ${moduleId}`);
  // The reporter and the preload are copied into the temp copy: inside the sandbox the bed
  // directory itself is hidden.
  writeFileSync(path.join(dir, REPORTER_FILE), readFileSync(REPORTER_SRC, 'utf8'));
  writeFileSync(path.join(dir, HARDEN_FILE), readFileSync(HARDEN_SRC, 'utf8'));
  const resultFile = path.join(dir, `.ownerci-result-${randomBytes(12).toString('hex')}.json`);
  const nodeArgs = ['--test', `--test-concurrency=${testFiles.length}`, '--test-timeout=20000', `--test-reporter=${pathToFileURL(path.join(dir, REPORTER_FILE)).href}`,
    `--test-reporter-destination=${resultFile}`, ...testFiles];
  const sandboxed = sandboxAvailable();
  let cmd = process.execPath, args = nodeArgs;
  if (TIMEOUT_BIN) { args = ['-s', 'KILL', String(WALL_SECONDS), cmd, ...args]; cmd = TIMEOUT_BIN; }
  if (sandboxed) { args = [...UNSHARE_ARGS, '/bin/sh', '-c', SANDBOX_SCRIPT, 'ownerci-sandbox', dir, cmd, ...args]; cmd = UNSHARE_BIN; }
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8', HOME: dir, TMPDIR: dir, NO_COLOR: '1',
    NODE_OPTIONS: nodeOptions(dir) };
  return { dir, cmd, args, env, resultFile, sandboxed, testFiles };
}

function collect(job, proc) {
  const out = { ok: false, sandbox: job.sandboxed ? 'unshare' : 'plain-child', exitStatus: proc.status ?? null, signal: proc.signal ?? null, tests: [], error: null };
  try {
    if (!existsSync(job.resultFile)) { out.error = `no reporter output (${proc.signal ? `killed by ${proc.signal}` : `exit ${proc.status}`}); stderr: ${String(proc.stderr ?? '').slice(-600)}`; return out; }
    const parsed = JSON.parse(readFileSync(job.resultFile, 'utf8'));
    out.tests = (parsed.results ?? []).map(r => ({ ...r, file: r.file ? path.relative(job.dir, r.file.startsWith('file:') ? fileURLToPath(r.file) : r.file).split(path.sep).join('/') : null }));
    out.ok = true;
    return out;
  } catch (e) {
    out.error = `unparseable reporter output: ${e.message}`;
    return out;
  } finally {
    rmSync(job.dir, { recursive: true, force: true });
  }
}

/** Synchronous run (used by the oracle). */
export function runSync(moduleId, moduleSource, opts = {}) {
  const job = prepare(moduleId, moduleSource, opts);
  const started = performance.now();
  const proc = spawnSync(job.cmd, job.args, { cwd: job.dir, env: job.env, encoding: 'utf8', timeout: (WALL_SECONDS + 5) * 1000, killSignal: 'SIGKILL',
    maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const result = collect(job, proc);
  result.wallMs = Math.round(performance.now() - started);
  return result;
}

/** Asynchronous run (used by the offline catalog builder to run mutants in parallel). */
export function runAsync(moduleId, moduleSource, opts = {}) {
  const job = prepare(moduleId, moduleSource, opts);
  const started = performance.now();
  return new Promise(resolve => {
    const child = spawn(job.cmd, job.args, { cwd: job.dir, env: job.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.resume();
    child.stderr.on('data', d => { if (stderr.length < 100000) stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), (WALL_SECONDS + 5) * 1000);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      const result = collect(job, { status, signal, stderr });
      result.wallMs = Math.round(performance.now() - started);
      resolve(result);
    });
  });
}

/** Split runner results into visible / hidden / guard maps keyed by top-level test name.
 * A name reported more than once is recorded in `duplicates` (and the map keeps a failing entry
 * if any report failed); top-level results that are not an expected test of the three files
 * (for example the file-level failure node:test reports when a test process crashes) are in
 * `other`. The oracle treats both as failures (AUDIT.md F3). */
export function classify(moduleId, run) {
  const m = MODULES[moduleId];
  const visible = new Map(), hidden = new Map(), other = [], duplicates = [];
  let guard = null;
  const put = (map, t, key) => {
    if (map.has(key)) { duplicates.push(`${t.file}::${key}`); if (map.get(key).status === 'pass') map.set(key, t); return; }
    map.set(key, t);
  };
  for (const t of run.tests) {
    if (t.nesting !== 0) continue;
    if (t.file === m.testPath) put(visible, t, t.name);
    else if (t.file === HIDDEN_FILE) put(hidden, t, t.name);
    else if (t.file === GUARD_FILE && t.name === GUARD_TEST) { if (guard) duplicates.push(`${t.file}::${t.name}`); if (!guard || guard.status === 'pass') guard = t; }
    else other.push(t);
  }
  return { visible, hidden, guard, other, duplicates };
}
