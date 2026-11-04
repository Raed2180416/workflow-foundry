// Host-side helpers for the AppWorld adapter (experiments/breadth/appworld; research/breadth-20261021/appworld/).
//
// bridge.py is the only code that imports the pinned package (appworld 0.1.3.post1, data 0.1.0), from the venv outside
// the repo (/var/tmp/foundry-work/benches/appworld/venv, decision D16), as `python -P -s` with an environment built here
// from nothing. Two kinds of bridge process:
//   - the ARM-FACING `serve` process, one per unit (a fresh world per task in a fresh process), inside the executor
//     sandbox of src/executors/claude-code.mjs (maskSteps + sandboxScript: private user/mount/pid namespaces, host
//     read-only, /home, /root, /tmp, /var/tmp ... masked) plus a network namespace. Visible: the pinned venv (read-only),
//     bridge.py (read-only), the unit's PUBLIC VIEW (read-only: base DBs, API docs and the unit's own specs.json and
//     dbs/, hard links, no ground_truth/, no datasets/) and the unit's serve root (read-write: AppWorld's outputs);
//   - HOST-ONLY processes (grade-serve, official, evaluate-dir, plan, inventory): a network namespace and nothing else;
//     their root links to the FULL data. Nothing an arm runs can reach them (bg8.json).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HIDDEN, UNSHARE_ARGS, WORK_ROOT, maskSteps, sandboxScript, splitReady } from '../../../src/executors/claude-code.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
export const BENCH_ROOT = process.env.FOUNDRY_APPWORLD_ROOT ?? '/var/tmp/foundry-work/benches/appworld';
export const VENV_DIR = path.join(BENCH_ROOT, 'venv');
export const VENV_PY = path.join(VENV_DIR, 'bin/python');
export const SITE_PACKAGES = path.join(VENV_DIR, 'lib/python3.12/site-packages');
export const DATA_DIR = path.join(BENCH_ROOT, 'root/data');
export const DOWNLOADS = path.join(BENCH_ROOT, 'downloads.json');
export const BRIDGE = path.join(HERE, 'bridge.py');
export const RESEARCH = path.join(REPO, 'research/breadth-20261021/appworld');
export const SPLIT_FILE = path.join(RESEARCH, 'SPLIT.json');
/** Host-only data (snapshots, verdict rows with assertion texts, transcripts, sealed manifests): outside the repo and
 * hidden from every executor and code sandbox (/var/tmp is masked in all of them). */
export const HOST_ROOT = process.env.FOUNDRY_APPWORLD_HOST ?? '/var/tmp/foundry-work/appworld-host';
/** Per-run live data (serve roots, public views, workdirs). */
export const LIVE_ROOT = process.env.FOUNDRY_APPWORLD_LIVE ?? path.join(WORK_ROOT, 'appworld-live');
export const PROTO = '@@bridge ';
export const PIN = Object.freeze({
  package: 'appworld', version: '0.1.3.post1', pypi: 'https://pypi.org/project/appworld/0.1.3.post1/', repo: 'https://github.com/StonyBrookNLP/appworld',
  wheelSha256: 'db77f8003982502383a50fa2974983894bd1c54f64e2fd3f7e1540d5edd037eb', license: 'Apache-2.0 (+ encrypted-redistribution condition on the data)',
  dataUrl: 'https://s3.us-west-2.amazonaws.com/appworld.dev/data-0.1.0.bundle', dataSha256: 'fd9f9608c2ec71ed0ac25c3633a738b9129a318a129e31230425b9188e508250', dataBytes: 34280074,
  dataManifestSha256: '230bc4d4bac05328e90098bba2da7edb9950f8ede8de296aed415d1109a1ed5e', unpackedAppsManifestSha256: '8f069913c68ddd5ff7c8d0f6496127fa3c6c3eb5f08a22c9f6476ff32b8e3e19',
  lockSha256: '9acb060307c6e777629ab2dce7795b08710459dbaf7985a4d3380d5ad6879693',
});
export const SPLITS = Object.freeze({ train: 90, dev: 57, test_normal: 168, test_challenge: 417 });
/** World settings (bridge.py world_kwargs). `arm`: the README's experiment config (appworld_config: random_seed 100,
 * max_interactions 1000, max_api_calls_per_interaction 5000, raise_on_extra_parameters true; README read 2026-11-04,
 * sha256 f4049141...7bdd), with the package default raise_on_failure (True). `verify`: appworld/verify.py's gold check
 * (raise_on_failure False, everything else default). */
export const WORLD_PROFILES = Object.freeze({
  arm: Object.freeze({ raiseOnFailure: true, raiseOnExtraParameters: true, maxApiCallsPerInteraction: 5000 }),
  verify: Object.freeze({ raiseOnFailure: false }),
});

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export function writeJson(p, obj, indent = 1) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, indent) + '\n'); }
export const readJsonl = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
/** Canonical JSON (sorted keys, no spaces). */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const shaCanon = v => sha256(canon(v));
export const scenarioOf = taskId => String(taskId).replace(/_\d+$/, '');
export const TASK_ID = /^[0-9a-f]{7}_[1-9]$/;

/** The install check (BG-0): 80 pinned distributions, every installed file equal to its wheel RECORD, and the app source
 * that `appworld install` unpacked equal to the manifest recorded right after that step. Reads files only. */
export async function verifyInstall() {
  const r = await runPlain('/usr/bin/python3', ['-I', path.join(HERE, 'verify_install.py'), DOWNLOADS, SITE_PACKAGES, PIN.unpackedAppsManifestSha256], { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// ---- environments and argv ----------------------------------------------------------------------------------------
export function bridgeEnv(root) {
  return { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: path.join(root, 'home'), APPWORLD_ROOT: root, APPWORLD_CACHE: path.join(root, '.cache'),
    PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1' };
}
/** A host-only bridge command: no network (user+net namespace), the full data behind `root/data`. */
export function hostArgv(args) { return ['unshare', ['--user', '--map-root-user', '--net', '--', VENV_PY, '-P', '-s', BRIDGE, ...args]]; }
/** The arm-facing serve process: the executor sandbox (mask steps) plus a network namespace. */
export function serveArgv(serveRoot, publicDir) {
  const steps = maskSteps({ workdir: serveRoot, hidden: DEFAULT_HIDDEN, keepRo: [VENV_DIR, publicDir, BRIDGE] });
  const script = sandboxScript(steps, serveRoot, [VENV_PY, '-P', '-s', BRIDGE, 'serve']);
  return ['unshare', [...UNSHARE_ARGS, '--net', 'sh', '-c', script]];
}

/** A root directory for a host-only process: `data` links to the full data. */
export function hostRoot(dir) {
  mkdirSync(path.join(dir, 'home'), { recursive: true });
  const link = path.join(dir, 'data');
  if (!existsSync(link)) symlinkSync(DATA_DIR, link);
  return dir;
}

/** Hard-link a tree (same filesystem: no bytes copied). */
function linkTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) linkTree(s, d); else if (e.isFile()) linkSync(s, d);
  }
}
/** The public view for a set of tasks: base DBs, API docs, the data's LICENSE/README/version and each task's specs.json
 * and dbs/. Never ground_truth/ (the decrypted answers, evaluation code and test data), never datasets/ (split lists). */
export function buildPublicView(dir, taskIds, { dataDir = DATA_DIR } = {}) {
  rmSync(dir, { recursive: true, force: true });
  const data = path.join(dir, 'data');
  mkdirSync(path.join(data, 'tasks'), { recursive: true });
  for (const f of ['LICENSE', 'README_BEFORE_SHARING.md', 'version.txt']) if (existsSync(path.join(dataDir, f))) linkSync(path.join(dataDir, f), path.join(data, f));
  linkTree(path.join(dataDir, 'base_dbs'), path.join(data, 'base_dbs'));
  linkTree(path.join(dataDir, 'api_docs'), path.join(data, 'api_docs'));
  for (const id of taskIds) {
    if (!TASK_ID.test(id)) throw new Error(`bad task id ${id}`);
    const src = path.join(dataDir, 'tasks', id), dst = path.join(data, 'tasks', id);
    mkdirSync(dst, { recursive: true });
    linkSync(path.join(src, 'specs.json'), path.join(dst, 'specs.json'));
    linkTree(path.join(src, 'dbs'), path.join(dst, 'dbs'));
  }
  return dir;
}
/** A serve root: AppWorld's working root (writable outputs) whose `data` links to the read-only public view. */
export function buildServeRoot(dir, publicDir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'home'), { recursive: true });
  symlinkSync(path.join(publicDir, 'data'), path.join(dir, 'data'));
  return dir;
}

/** Copy a closed unit's AppWorld outputs (dbs/, logs/) from the serve root to a host-only snapshot directory, then remove
 * them from the serve root. */
export function snapshotOutputs(serveRoot, outputRel, snapDir) {
  const src = path.join(serveRoot, outputRel);
  if (!path.resolve(src).startsWith(path.resolve(serveRoot) + path.sep)) throw new Error('output path escapes the serve root');
  rmSync(snapDir, { recursive: true, force: true });
  mkdirSync(snapDir, { recursive: true });
  for (const sub of ['dbs', 'logs']) if (existsSync(path.join(src, sub))) cpSync(path.join(src, sub), path.join(snapDir, sub), { recursive: true });
  rmSync(src, { recursive: true, force: true });
  return snapDir;
}

const parseProto = text => text.split('\n').filter(l => l.startsWith(PROTO)).map(l => { try { return JSON.parse(l.slice(PROTO.length)); } catch { return null; } }).filter(Boolean);

/** Run a plain command to completion. */
export function runPlain(bin, argv, { cwd = undefined, env, timeoutMs = 60 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.stdout.on('data', d => { stdout += d; });
    c.stderr.on('data', d => { if (stderr.length < 200_000) stderr += d; });
    c.on('error', reject);
    c.on('close', code => { clearTimeout(t); resolve({ code, stdout, stderr, proto: parseProto(stdout) }); });
  });
}
/** Run one host-only bridge command (inventory, official, evaluate-dir, plan) to completion in `root`. */
export async function runHost(args, { root, timeoutMs = 3 * 60 * 60_000 } = {}) {
  if (!existsSync(VENV_PY)) throw new Error(`AppWorld venv missing: ${VENV_PY} (research/breadth-20261021/appworld/ACQUISITION.md)`);
  hostRoot(root);
  const [bin, argv] = hostArgv(args);
  const r = await runPlain(bin, argv, { cwd: root, env: bridgeEnv(root), timeoutMs });
  const err = r.proto.find(p => p.kind === 'error' && !p.handle && !p.key);
  if (r.code !== 0 || err) throw new Error(`bridge ${args[0]} failed (${r.code}): ${err?.error ?? r.stderr.slice(-1500)}${err?.trace ? `\n${err.trace}` : ''}`);
  return r;
}

/**
 * A long-lived bridge process speaking JSON lines: `serve` (sandboxed, arm-facing) or `grade-serve` (host-only).
 * request(op, kinds) sends one line and resolves with the matching reply (by handle).
 */
export class BridgeServer {
  constructor({ cmd = 'serve', serveRoot = null, publicDir = null, root = null, onExit = null }) {
    if (!existsSync(VENV_PY)) throw new Error(`AppWorld venv missing: ${VENV_PY}`);
    let bin, argv, cwd, env;
    if (cmd === 'serve') {
      if (!serveRoot || !publicDir) throw new Error('serve needs a serve root and a public view');
      [bin, argv] = serveArgv(serveRoot, publicDir); cwd = serveRoot; env = bridgeEnv(serveRoot);
    } else if (cmd === 'grade-serve') {
      if (!root) throw new Error('grade-serve needs a host root');
      hostRoot(root); [bin, argv] = hostArgv(['grade-serve']); cwd = root; env = bridgeEnv(root);
    } else throw new Error(`unknown bridge server command ${cmd}`);
    this.cmd = cmd;
    this.proc = spawn(bin, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: cmd === 'serve' });
    this.buf = ''; this.stderr = ''; this.waiting = []; this.closed = false; this.seq = 0;
    this.hello = new Promise((res, rej) => { this.waiting.push({ handle: undefined, kinds: ['hello'], res, rej }); });
    this.proc.stdout.on('data', d => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const l = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
        if (!l.startsWith(PROTO)) continue;
        let m; try { m = JSON.parse(l.slice(PROTO.length)); } catch { continue; }
        const k = this.waiting.findIndex(w => (w.handle === m.handle || (w.handle === undefined && m.handle === undefined)) && (w.kinds.includes(m.kind) || m.kind === 'error'));
        if (k < 0) continue;
        const [w] = this.waiting.splice(k, 1);
        if (m.kind === 'error') w.rej(Object.assign(new Error(`bridge: ${m.error}`), { trace: m.trace })); else w.res(m);
      }
    });
    this.proc.stderr.on('data', d => { if (this.stderr.length < 200_000) this.stderr += d; });
    this.proc.stdin.on('error', () => {});
    this.proc.on('close', code => {
      this.closed = true;
      for (const w of this.waiting.splice(0)) w.rej(new Error(`bridge exited (${code}): ${splitReady(this.stderr).stderr.slice(-1500)}`));
      onExit?.(code);
    });
  }
  request(op, kinds) {
    if (this.closed) return Promise.reject(new Error('bridge is closed'));
    return new Promise((res, rej) => {
      this.waiting.push({ handle: op.handle, kinds, res, rej });
      this.proc.stdin.write(JSON.stringify(op) + '\n');
    });
  }
  handle(prefix = 'u') { return `${prefix}${++this.seq}`; }
  open(handle, taskId, settings = {}) { return this.request({ op: 'open', handle, taskId, settings }, ['ready']); }
  execute(handle, code) { return this.request({ op: 'execute', handle, code }, ['output']); }
  docs(handle, appName = null, apiName = null) { return this.request({ op: 'docs', handle, appName, apiName }, ['docs']); }
  close(handle) { return this.request({ op: 'close', handle }, ['closed']); }
  async grade(taskId, snapshot) { return (await this.request({ op: 'grade', handle: this.handle('g'), taskId, snapshot }, ['graded'])).row; }
  async quit() {
    if (this.closed) return;
    const done = new Promise(res => this.proc.on('close', res));
    try { this.proc.stdin.end(JSON.stringify({ op: 'quit' }) + '\n'); } catch {}
    const t = setTimeout(() => { try { this.cmd === 'serve' ? process.kill(-this.proc.pid, 'SIGKILL') : this.proc.kill('SIGKILL'); } catch {} }, 30_000);
    await done; clearTimeout(t);
  }
}

export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

/** Free bytes on the filesystem holding `p` (the D16 disk gate). */
export async function freeBytes(p = '/var/tmp') {
  const r = await runPlain('df', ['-B1', '--output=avail', p], { env: { PATH: '/usr/bin:/bin' } });
  return Number(r.stdout.trim().split('\n').pop());
}
export const fileSize = p => { try { return statSync(p).size; } catch { return null; } };
