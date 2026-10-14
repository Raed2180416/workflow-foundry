// Out-of-process, sandboxed arm adapter for untrusted solvers (E-BED §8.1 step 7; host README §2 "the journal is not
// arm-readable", review finding 16). A model-written solver must never run in the process that holds the world (truth,
// generator) or the oracle: it could read them, rebuild the world from its seed, or patch the grader. Here the solver
// runs in its own process inside the executor sandbox (src/executors/claude-code.mjs: user, mount and pid namespaces,
// every host home and work root hidden, no network namespace access, no credentials in the environment); only the
// solver file and a small worker are in its directory. The host (trusted process) sends each call's input and the files
// that changed; the solver's ctx.query / ctx.status / ctx.instances calls are answered synchronously over the same pipe
// (the worker blocks on a read), so the tick contract is unchanged.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { maskSteps, sandboxScript, UNSHARE_ARGS, DEFAULT_HIDDEN, binaryKeeps, sandboxAvailable } from '../../../src/executors/claude-code.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');

// The worker runs inside the sandbox: it imports ./solver.mjs and serves ticks over stdin/stdout (JSON lines).
export const WORKER_SOURCE = `import { readSync, writeSync } from 'node:fs';
const { createSolver } = await import('./solver.mjs');
const solver = createSolver();
let buf = '';
const chunk = Buffer.alloc(1 << 16);
function readLine() {
  for (;;) {
    const i = buf.indexOf('\\n');
    if (i >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); return l; }
    let n;
    try { n = readSync(0, chunk, 0, chunk.length, null); } catch (e) { if (e.code === 'EAGAIN') continue; throw e; }
    if (n === 0) return null;
    buf += chunk.toString('utf8', 0, n);
  }
}
const send = o => { const b = Buffer.from(JSON.stringify(o) + '\\n'); let off = 0; while (off < b.length) off += writeSync(1, b, off); };
function call(op, args) {
  send({ t: 'ctx', op, args });
  const r = JSON.parse(readLine());
  if (r.t === 'ctxe') { const e = new Error(r.message); e.code = r.code; e.reason = r.reason; throw e; }
  return r.value;
}
const files = {};
for (;;) {
  const line = readLine();
  if (line === null) break;
  const m = JSON.parse(line);
  if (m.t !== 'tick') continue;
  for (const p of Object.keys(files)) if (!m.paths.includes(p)) delete files[p];
  Object.assign(files, m.files);
  const ctx = { files: { ...files }, workspace: null, recordCost() {},
    query: (table, filter) => call('query', [table, filter ?? {}]), status: (system, key) => call('status', [system, key]),
    instances: filter => call('instances', [filter ?? {}]) };
  let out;
  try { out = await solver.tick(m.input, ctx); send({ t: 'out', output: out === undefined ? null : out }); }
  catch (e) { send({ t: 'err', message: String(e && e.stack || e).slice(0, 2000) }); }
}
`;

/**
 * sandboxArm({ id, solverSource, workRoot, timeoutMs }) → arm { id, tick(input, ctx), close() }. The child is started
 * on the first call and restarted after a timeout or a crash (its module state is lost; the carry is the arm's state).
 */
export function sandboxArm({ id, solverSource, workRoot = '/var/tmp/foundry-work/ebed-arms', timeoutMs = 30_000 }) {
  if (!sandboxAvailable()) throw new Error('sandbox unavailable: user/mount/pid namespaces are required to run an untrusted solver');
  mkdirSync(workRoot, { recursive: true });
  let child = null, buf = '', waiters = [], queue = [], sent = new Map(), dir = null, stderr = '';
  const start = () => {
    dir = mkdtempSync(path.join(workRoot, 'arm-'));
    writeFileSync(path.join(dir, 'solver.mjs'), solverSource);
    writeFileSync(path.join(dir, 'arm-worker.mjs'), WORKER_SOURCE);
    const script = sandboxScript(maskSteps({ workdir: dir, hidden: DEFAULT_HIDDEN, keepRo: binaryKeeps(['node']) }), dir, ['node', '--max-old-space-size=512', 'arm-worker.mjs']);
    child = spawn('unshare', [...UNSHARE_ARGS, '--net', 'sh', '-c', script], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    sent = new Map(); buf = ''; stderr = '';
    child.stdout.on('data', d => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(line); const w = waiters.shift(); if (w) w(m); else queue.push(m); }
    });
    child.stderr.on('data', d => { if (stderr.length < 16 * 1024) stderr += d; });
    child.on('close', () => { const ws = waiters.splice(0); for (const w of ws) w({ t: 'dead' }); child = null; });
  };
  const kill = () => { if (child) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } child = null; } if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } };
  const next = timeout => new Promise((resolve, reject) => {
    if (queue.length) return resolve(queue.shift());
    const timer = setTimeout(() => { const i = waiters.indexOf(fn); if (i >= 0) waiters.splice(i, 1); reject(Object.assign(new Error('call timeout'), { timeout: true })); }, timeout);
    const fn = m => { clearTimeout(timer); resolve(m); };
    waiters.push(fn);
  });
  const send = o => child.stdin.write(JSON.stringify(o) + '\n');
  return {
    id,
    async tick(input, ctx) {
      if (!child) start();
      const files = {};
      const paths = Object.keys(ctx.files);
      for (const p of paths) { const d = sha(ctx.files[p]); if (sent.get(p) !== d) { files[p] = ctx.files[p]; sent.set(p, d); } }
      for (const p of [...sent.keys()]) if (!paths.includes(p)) sent.delete(p);
      send({ t: 'tick', input, files, paths });
      const deadline = Date.now() + timeoutMs;
      try {
        for (;;) {
          const m = await next(Math.max(1, deadline - Date.now()));
          if (m.t === 'out') return m.output;
          if (m.t === 'err') throw new Error(`solver: ${m.message}`);
          if (m.t === 'dead') throw new Error(`solver process exited: ${stderr.slice(-500)}`);
          if (m.t === 'ctx') {
            try { const fn = { query: ctx.query, status: ctx.status, instances: ctx.instances }[m.op]; send({ t: 'ctxr', value: fn(...m.args) ?? null }); }
            catch (e) { send({ t: 'ctxe', message: String(e?.message ?? e), code: e?.code ?? null, reason: e?.reason ?? null }); }
          }
        }
      } catch (e) { if (e.timeout || !child) kill(); throw e; }
    },
    close: kill,
  };
}
