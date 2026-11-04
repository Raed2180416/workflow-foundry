// A bed's world process, host side: a JSON-lines child (one request, one response line, in order). The bed runs in
// its own pinned venv outside the repository, with `python -I`, an allow-listed environment and, by default, no
// network (`unshare -rn`, falling back to an error, never to a networked run).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

/** The bed's environment: nothing from the host but locale and a PATH; no credentials, no proxy, no HOME files. */
export function bedEnv(liveDir) {
  const keep = ['LANG', 'LC_ALL', 'TZ'];
  const env = Object.fromEntries(keep.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  return { ...env, PATH: '/usr/bin:/bin', HOME: liveDir, PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0', TQDM_DISABLE: '1', MPLBACKEND: 'Agg' };
}

let netnsOk;
/** True when an unprivileged network namespace can be made here (the bed then runs network-off). */
export function netnsAvailable() {
  if (netnsOk === undefined) netnsOk = spawnSync('unshare', ['-rn', 'true'], { timeout: 10_000 }).status === 0;
  return netnsOk;
}

/** argv for a bed command: `unshare -rn <python> -I <script> ...` when network isolation is available. */
export function bedArgv(python, script, args, { network = false } = {}) {
  const base = [python, '-I', script, ...args];
  if (network) return base;
  if (!netnsAvailable()) throw new Error('BED_SANDBOX: no network namespace available; the bed never runs networked');
  return ['unshare', '-rn', ...base];
}

/** Run a bed command to completion; resolves { code, stdout, stderr, lines } (lines = parsed JSON lines of stdout). */
export function runBedCommand({ python, script, args, cwd, timeoutMs = 30 * 60_000 }) {
  if (!existsSync(python)) throw new Error(`bed interpreter missing: ${python}`);
  mkdirSync(cwd, { recursive: true });
  const argv = bedArgv(python, script, args);
  return new Promise((resolve, reject) => {
    const c = spawn(argv[0], argv.slice(1), { cwd, env: bedEnv(cwd), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; c.kill('SIGKILL'); }, timeoutMs);
    c.stdout.on('data', d => { stdout += d; });
    c.stderr.on('data', d => { if (stderr.length < 200_000) stderr += d; });
    c.on('error', reject);
    c.on('close', (code, signal) => {
      clearTimeout(t);
      const lines = stdout.split('\n').filter(l => l.trim().startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      resolve({ code, signal, timedOut, stdout, stderr, lines });
    });
  });
}

/** A long-lived `serve` child. request(obj) resolves with the next response line. */
export function startBedServer({ python, script, args, cwd, readyTimeoutMs = 60_000 }) {
  mkdirSync(cwd, { recursive: true });
  const argv = bedArgv(python, script, args);
  const c = spawn(argv[0], argv.slice(1), { cwd, env: bedEnv(cwd), stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', stderr = '', closed = false;
  const queue = [];   // pending resolvers, FIFO
  const early = [];   // lines with no waiter yet (the ready line)
  c.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const w = queue.shift();
      if (w) w.resolve(msg); else early.push(msg);
    }
  });
  c.stderr.on('data', d => { if (stderr.length < 100_000) stderr += d; });
  c.stdin.on('error', () => {});
  const exited = new Promise(res => c.on('close', code => { closed = true; for (const w of queue.splice(0)) w.reject(new Error(`bed exited (${code}): ${stderr.slice(-800)}`)); res(code); }));
  const next = (ms = 120_000) => new Promise((resolve, reject) => {
    if (early.length) return resolve(early.shift());
    if (closed) return reject(new Error(`bed exited: ${stderr.slice(-800)}`));
    const w = { resolve, reject };
    queue.push(w);
    setTimeout(() => { const i = queue.indexOf(w); if (i >= 0) { queue.splice(i, 1); reject(new Error(`bed: no answer within ${ms} ms`)); } }, ms).unref();
  });
  const ready = next(readyTimeoutMs).then(m => { if (m.kind !== 'ready') throw new Error(`bed: expected ready, got ${JSON.stringify(m).slice(0, 200)}`); return m; });
  let chain = Promise.resolve();
  const request = (obj, ms) => {
    const p = chain.then(() => { if (closed) throw new Error('bed is closed'); c.stdin.write(JSON.stringify(obj) + '\n'); return next(ms); });
    chain = p.catch(() => {});
    return p;
  };
  return {
    ready, request, pid: c.pid, stderr: () => stderr,
    async close() { if (!closed) { try { await request({ op: 'quit' }, 10_000); } catch {} try { c.stdin.end(); } catch {} } await Promise.race([exited, new Promise(r => setTimeout(r, 5_000))]); if (!closed) c.kill('SIGKILL'); },
    kill() { try { c.kill('SIGKILL'); } catch {} },
  };
}
