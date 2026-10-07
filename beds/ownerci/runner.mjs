// Test runner for the ownerci bed: materialises a fresh temp copy of a frozen fixture with one
// module replaced, runs the frozen visible tests, the hidden tests and the export guard with
// `node --test` in a child process, and returns per-test results.
//
// Isolation: `unshare --user --map-root-user --net --fork --kill-child` (no network, fresh user
// namespace) when the kernel allows it, otherwise a plain child process. Either way the child
// gets a minimal environment (no inherited variables, HOME and TMPDIR inside the temp copy),
// a 60 s wall timeout enforced by `timeout -s KILL` on the whole process group, a per-test
// timeout and a V8 heap cap. Results travel through a custom reporter that runs in the
// `node --test` parent (which never imports the candidate) into a file whose name carries a
// per-run random nonce; nothing the candidate prints is parsed.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODULES } from './modules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, 'fixtures');
const REPORTER = pathToFileURL(path.join(HERE, 'reporter.mjs')).href;
export const HIDDEN_FILE = 'hidden.test.mjs';
export const GUARD_FILE = '__ownerci_exports__.test.mjs';
export const GUARD_TEST = 'ownerci export guard';
export const WALL_SECONDS = 60;
const TIMEOUT_BIN = ['/usr/bin/timeout', '/bin/timeout'].find(p => existsSync(p)) ?? null;
const UNSHARE_BIN = ['/usr/bin/unshare', '/bin/unshare'].find(p => existsSync(p)) ?? null;
const UNSHARE_ARGS = ['--user', '--map-root-user', '--net', '--fork', '--kill-child'];

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
      const r = spawnSync(UNSHARE_BIN, [...UNSHARE_ARGS, '/bin/true'], { env: { PATH: '/usr/bin:/bin' }, timeout: 5000, stdio: 'ignore' });
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
  const resultFile = path.join(dir, `.ownerci-result-${randomBytes(12).toString('hex')}.json`);
  const nodeArgs = ['--test', `--test-concurrency=${testFiles.length}`, '--test-timeout=20000', `--test-reporter=${REPORTER}`,
    `--test-reporter-destination=${resultFile}`, ...testFiles];
  const sandboxed = sandboxAvailable();
  let cmd = process.execPath, args = nodeArgs;
  if (TIMEOUT_BIN) { args = ['-s', 'KILL', String(WALL_SECONDS), cmd, ...args]; cmd = TIMEOUT_BIN; }
  if (sandboxed) { args = [...UNSHARE_ARGS, cmd, ...args]; cmd = UNSHARE_BIN; }
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8', HOME: dir, TMPDIR: dir, NO_COLOR: '1',
    NODE_OPTIONS: '--max-old-space-size=512' };
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

/** Split runner results into visible / hidden / guard maps keyed by top-level test name. */
export function classify(moduleId, run) {
  const m = MODULES[moduleId];
  const visible = new Map(), hidden = new Map(), other = [];
  let guard = null;
  for (const t of run.tests) {
    if (t.nesting !== 0) continue;
    if (t.file === m.testPath) visible.set(t.name, t);
    else if (t.file === HIDDEN_FILE) hidden.set(t.name, t);
    else if (t.file === GUARD_FILE && t.name === GUARD_TEST) guard = t;
    else other.push(t);
  }
  return { visible, hidden, guard, other };
}
