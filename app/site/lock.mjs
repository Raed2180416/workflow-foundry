// One Foundry window per workspace (SPEC §11): <workspace>/.lock holds the pid of the process serving the site, its address and the id
// of that start (./gate.mjs binds one-time codes to it). A second `site` (or `open`) start on a live lock opens the page that is already
// running instead of starting another (walkthroughs P1 B2, P2 B2); `mcp --dashboard` sends the person to the window that is already open.
// The lock guards only against two windows; the store itself is SQLite with WAL and tolerates several readers and writers.
//
// Since the security review (2026-10-21, L12): a lock counts as live only when its process belongs to this OS account and, on Linux,
// is a Foundry CLI (a recycled pid of another account, which kill(pid, 0) reports as EPERM, is not), and the address it names is used
// only when it has the one shape Foundry writes, http://127.0.0.1:<port>/.
import { readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

const fileOf = workspace => path.join(workspace, '.lock');
/** Is pid a live process of this OS account (and, where the system says, a Foundry CLI)? */
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); } catch { return false; } // EPERM: another account's process, so not this account's Foundry
  if (process.platform === 'linux') {
    try {
      if (typeof process.getuid === 'function' && statSync(`/proc/${pid}`).uid !== process.getuid()) return false;
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').some(a => a.endsWith('cli.mjs'));
    } catch { return true; } // /proc hidden: kill(pid, 0) already said it is ours
  }
  return true;
}
/** The page address a lock names, if it has the shape Foundry writes; otherwise null. */
export function pageBase(url) {
  const m = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/?$/.exec(String(url ?? ''));
  const port = m ? Number(m[1]) : 0;
  return port > 0 && port < 65536 ? `http://127.0.0.1:${port}/` : null;
}
export function readLock(workspace) {
  const file = fileOf(workspace);
  if (!existsSync(file)) return null;
  try { const v = JSON.parse(readFileSync(file, 'utf8')); return { ...v, alive: alive(v.pid) }; } catch { return { pid: null, alive: false }; }
}
export function takeLock(workspace, kind) {
  const file = fileOf(workspace), current = readLock(workspace);
  if (current?.alive && current.pid !== process.pid)
    return { ok: false, holder: current, say: `Foundry is already running for this folder${pageBase(current.url) ? ` at ${pageBase(current.url)}` : ''}. To open it, run: node ${CLI} open --workspace "${workspace}"` };
  let state = { pid: process.pid, kind, startedAt: new Date().toISOString() };
  const write = () => writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  write();
  return { ok: true, update(fields) { state = { ...state, ...fields }; write(); }, release() { try { if (readLock(workspace)?.pid === process.pid) rmSync(file, { force: true }); } catch { /* gone */ } } };
}
