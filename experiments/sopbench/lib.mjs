// Host-side helpers for the SOP-Bench bridge (experiments/sopbench; research/sopbench-20261021/). bridge.py runs in the
// pinned tool venv (corpus/sop-bench-venv) with `python -I`, from a neutral working directory, with a minimal
// environment and the clone path passed as an argument; nothing from the clone runs any other way.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
export const UPSTREAM = path.join(REPO, 'corpus/sop-bench');
export const VENV_PY = path.join(REPO, 'corpus/sop-bench-venv/bin/python');
export const BRIDGE = path.join(HERE, 'bridge.py');
export const TOOL_CLIENT = path.join(HERE, 'tool.mjs');
export const RESEARCH = path.join(REPO, 'research/sopbench-20261021');
export const SPLIT_FILE = path.join(RESEARCH, 'SPLIT.json');
export const PROTO = '@@bridge ';
/** The upstream pin (ACQUISITION.md). */
export const UPSTREAM_PIN = Object.freeze({ url: 'https://github.com/amazon-science/sop-bench', commit: 'f6d43858b94cf439854038101bce0eecd3e16eae' });

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export function writeJson(p, obj, indent = 1) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, indent) + '\n'); }

/** Canonical JSON identical to bridge.py canon() for JSON values (sorted keys, no spaces, non-ASCII kept). */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const shaCanon = v => sha256(canon(v));

/** The bridge's environment: no host credentials, no network configuration, a private HOME. */
export function bridgeEnv(liveDir) {
  const keep = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
  const env = Object.fromEntries(keep.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  return { ...env, HOME: path.join(liveDir, 'home'), PYTHONHASHSEED: '0' };
}

const parseProto = text => text.split('\n').filter(l => l.startsWith(PROTO)).map(l => { try { return JSON.parse(l.slice(PROTO.length)); } catch { return null; } }).filter(Boolean);

/** Run one bridge command to completion. Returns { code, stdout, stderr, proto }. */
export function runBridge(args, { liveDir, timeoutMs = 20 * 60_000, upstream = UPSTREAM, split = SPLIT_FILE, dataDir = null, withSplit = true } = {}) {
  if (!existsSync(VENV_PY)) throw new Error(`SOP-Bench tool venv missing: ${VENV_PY} (research/sopbench-20261021/ACQUISITION.md)`);
  mkdirSync(path.join(liveDir, 'home'), { recursive: true });
  const [cmd, ...rest] = args;
  const full = ['-I', BRIDGE, cmd, '--upstream', upstream, ...(dataDir ? ['--data-dir', dataDir] : []), ...(withSplit ? ['--split', split] : []), ...rest];
  return new Promise((resolve, reject) => {
    const c = spawn(VENV_PY, full, { cwd: liveDir, env: bridgeEnv(liveDir), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.stdout.on('data', d => { stdout += d; });
    c.stderr.on('data', d => { if (stderr.length < 400_000) stderr += d; });
    c.on('error', reject);
    c.on('close', code => { clearTimeout(t); resolve({ code, stdout, stderr, proto: parseProto(stdout) }); });
  });
}

export async function bridgeOk(args, opts) {
  const r = await runBridge(args, opts);
  const err = r.proto.find(p => p.kind === 'error');
  if (r.code !== 0 || err) {
    const e = new Error(`bridge ${args[0]} failed (${r.code}): ${err?.error ?? r.stderr.slice(-1500)}`);
    e.refused = r.code === 3;
    throw e;
  }
  return r;
}

/** Start `bridge.py serve` for one row; resolves `ready` once the world is loaded and the mailbox opened. stop() ends
 * the rollout (host-only files are then in hostDir). */
export function startServe({ liveDir, sop, row, mailbox, hostDir, maxSteps = 10, sealed = false, freeze = null, upstream = UPSTREAM, split = SPLIT_FILE, dataDir = null, readyTimeoutMs = 120_000 }) {
  const args = ['-I', BRIDGE, 'serve', '--upstream', upstream, ...(dataDir ? ['--data-dir', dataDir] : []), '--split', split, '--sop', sop, '--row', String(row),
    '--mailbox', mailbox, '--host', hostDir, '--max-steps', String(maxSteps), ...(sealed ? ['--sealed'] : []), ...(freeze ? ['--freeze', freeze] : [])];
  mkdirSync(hostDir, { recursive: true });
  mkdirSync(path.join(liveDir, 'home'), { recursive: true });
  const c = spawn(VENV_PY, args, { cwd: liveDir, env: bridgeEnv(liveDir), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const lines = [], waiters = [];
  c.stdout.on('data', d => {
    stdout += d;
    let i;
    while ((i = stdout.indexOf('\n')) >= 0) {
      const l = stdout.slice(0, i); stdout = stdout.slice(i + 1);
      if (l.startsWith(PROTO)) { try { lines.push(JSON.parse(l.slice(PROTO.length))); waiters.forEach(w => w()); } catch {} }
    }
  });
  c.stderr.on('data', d => { if (stderr.length < 100_000) stderr += d; });
  c.stdin.on('error', () => {});
  let closed = false, exitCode = null;
  const exited = new Promise(res => c.on('close', code => { closed = true; exitCode = code; waiters.forEach(w => w()); res(code); }));
  const waitFor = (kind, ms) => new Promise((resolve, reject) => {
    const check = () => {
      const m = lines.find(x => x.kind === kind || x.kind === 'error');
      if (m) return m.kind === 'error' ? reject(Object.assign(new Error(`bridge: ${m.error}`), { refused: exitCode === 3 || /^refused/.test(m.error) })) : resolve(m);
      if (closed) return reject(new Error(`bridge exited before '${kind}': ${stderr.slice(-1500)}`));
    };
    waiters.push(check);
    check();
    setTimeout(() => reject(new Error(`bridge: no '${kind}' within ${ms} ms`)), ms).unref();
  });
  const ready = waitFor('ready', readyTimeoutMs);
  ready.catch(() => {});
  return {
    ready,
    async stop(ms = 120_000) { if (!closed) c.stdin.end('stop\n'); const done = await waitFor('done', ms); await exited; return done; },
    kill() { try { c.kill('SIGKILL'); } catch {} },
    stderr: () => stderr,
  };
}

// Deterministic PRNG (mulberry32 seeded from sha256), as experiments/autobench/lib.mjs.
export function rng(seedStr) {
  let a = parseInt(sha256(String(seedStr)).slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffled(xs, seed) {
  const a = [...xs], r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Copy the agent-side files into a fresh workdir: the client and the tool definitions. Nothing else. */
export function materializeWorkdir(workdir, catalog) {
  mkdirSync(path.join(workdir, '.tools'), { recursive: true });
  cpSync(TOOL_CLIENT, path.join(workdir, 'tool.mjs'));
  writeFileSync(path.join(workdir, 'tools.json'), JSON.stringify(catalog, null, 1));
}
