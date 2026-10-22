// Host-side helpers for the AgentDojo adapter (experiments/breadth/agentdojo; research/breadth-20261021/agentdojo/).
//
// bridge.py is the only code that imports the pinned package. It runs in the venv outside the repo
// (/var/tmp/foundry-work/benches/agentdojo/venv, decision D16), with `python -P -s` (no script directory and no user
// site on sys.path) and an environment built here from nothing but PATH, LANG, a private HOME and PYTHONHASHSEED=0, from
// a neutral working directory, inside a user+network namespace (`unshare --user --map-root-user --net`: no network), and is
// reached only from this host process. Agents reach the suite tools through tool.mjs -> a file mailbox -> the host
// facade (facade.mjs) -> the bridge; the shared python tool runs host-side under src/sandbox.mjs.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
export const BENCH_ROOT = process.env.FOUNDRY_AGENTDOJO_ROOT ?? '/var/tmp/foundry-work/benches/agentdojo';
export const VENV_PY = path.join(BENCH_ROOT, 'venv/bin/python');
export const BRIDGE = path.join(HERE, 'bridge.py');
export const TOOL_CLIENT = path.join(HERE, 'tool.mjs');
export const RESEARCH = path.join(REPO, 'research/breadth-20261021/agentdojo');
export const SPLIT_FILE = path.join(RESEARCH, 'SPLIT.json');
/** Host-only data (snapshots, per-unit records, authored sealed injection tasks): outside the repo and hidden from every
 * executor and code sandbox (/var/tmp is masked in both). */
export const HOST_ROOT = process.env.FOUNDRY_AGENTDOJO_HOST ?? '/var/tmp/foundry-work/agentdojo-host';
export const PROTO = '@@bridge ';
export const PIN = Object.freeze({ package: 'agentdojo', version: '0.1.35', benchmark: 'v1.2.2', attack: 'important_instructions',
  pypi: 'https://pypi.org/project/agentdojo/0.1.35/', repo: 'https://github.com/ethz-spylab/agentdojo', license: 'MIT',
  wheelSha256: '364bea4219716b716bf639f504d195943f7f6a5535d312ca41d7098704a2affd' });
export const SUITES = Object.freeze(['banking', 'slack', 'travel', 'workspace']);
export const MAX_STEPS = 15;

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export function writeJson(p, obj, indent = 1) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, indent) + '\n'); }
export const readJsonl = p => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** Canonical JSON (sorted keys, no spaces), identical to bridge.py canon() for JSON values. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const shaCanon = v => sha256(canon(v));

/** The bridge's environment: no host credentials, no proxy settings, a private HOME. */
export function bridgeEnv(liveDir) {
  return { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: path.join(liveDir, 'home'), PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1' };
}
/** argv for one bridge process: no network (user+net namespace), isolated interpreter. */
export function bridgeArgv(args) {
  // Not -I: it implies -E, which ignores PYTHONHASHSEED, and upstream's calendar create_event orders participants through
  // a set of strings (calendar_client.py:44-45), so a random hash seed changed tool output and post-state digests
  // between processes (4 workspace user tasks). The environment is ours alone (bridgeEnv), so -E adds nothing.
  return ['unshare', ['--user', '--map-root-user', '--net', '--', VENV_PY, '-P', '-s', BRIDGE, ...args]];
}

const parseProto = text => text.split('\n').filter(l => l.startsWith(PROTO)).map(l => { try { return JSON.parse(l.slice(PROTO.length)); } catch { return null; } }).filter(Boolean);

/** Run one bridge command to completion. Returns { code, stdout, stderr, proto }. */
export function runBridge(args, { liveDir, timeoutMs = 60 * 60_000 } = {}) {
  if (!existsSync(VENV_PY)) throw new Error(`AgentDojo venv missing: ${VENV_PY} (research/breadth-20261021/agentdojo/ACQUISITION.md)`);
  mkdirSync(path.join(liveDir, 'home'), { recursive: true });
  const [bin, argv] = bridgeArgv(args);
  return new Promise((resolve, reject) => {
    const c = spawn(bin, argv, { cwd: liveDir, env: bridgeEnv(liveDir), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.stdout.on('data', d => { stdout += d; });
    c.stderr.on('data', d => { if (stderr.length < 200_000) stderr += d; });
    c.on('error', reject);
    c.on('close', code => { clearTimeout(t); resolve({ code, stdout, stderr, proto: parseProto(stdout) }); });
  });
}
export async function bridgeOk(args, opts) {
  const r = await runBridge(args, opts);
  const err = r.proto.find(p => p.kind === 'error');
  if (r.code !== 0 || err) throw new Error(`bridge ${args[0]} failed (${r.code}): ${err?.error ?? r.stderr.slice(-1500)}${err?.trace ? `\n${err.trace}` : ''}`);
  return r;
}

/**
 * A long-lived `bridge.py serve` process. request(op) sends one JSON line and resolves with the matching reply (by
 * handle; requests on one handle are answered in order). Every unit of a run shares the process.
 */
export class BridgeServer {
  constructor({ liveDir, authored = null, onExit = null }) {
    if (!existsSync(VENV_PY)) throw new Error(`AgentDojo venv missing: ${VENV_PY}`);
    mkdirSync(path.join(liveDir, 'home'), { recursive: true });
    const [bin, argv] = bridgeArgv(['serve', ...(authored ? ['--authored', authored] : [])]);
    this.proc = spawn(bin, argv, { cwd: liveDir, env: bridgeEnv(liveDir), stdio: ['pipe', 'pipe', 'pipe'] });
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
      for (const w of this.waiting.splice(0)) w.rej(new Error(`bridge exited (${code}): ${this.stderr.slice(-1500)}`));
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
  open(handle, unit, hostDir, maxRequests = MAX_STEPS) { return this.request({ op: 'open', handle, unit, hostDir, maxRequests }, ['ready']); }
  calls(handle, calls) { return this.request({ op: 'calls', handle, calls }, ['results']); }
  close(handle, final) { return this.request({ op: 'close', handle, final }, ['closed']); }
  plan(unit, policy, mutant = null) { const handle = this.handle('p'); return this.request({ op: 'plan', handle, unit, policy, mutant }, ['plan']); }
  mutants(suite, userTask) { const handle = this.handle('m'); return this.request({ op: 'mutants', handle, suite, userTask }, ['mutants']); }
  async quit() {
    if (this.closed) return;
    const done = new Promise(res => this.proc.on('close', res));
    try { this.proc.stdin.end(JSON.stringify({ op: 'quit' }) + '\n'); } catch {}
    const t = setTimeout(() => { try { this.proc.kill('SIGKILL'); } catch {} }, 30_000);
    await done; clearTimeout(t);
  }
}

/** Unit id: suite/userTask/condition[/injectionTask]. */
export const unitId = u => [u.suite, u.userTask, u.condition, ...(u.injectionTask ? [u.injectionTask] : [])].join('/');

export async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
