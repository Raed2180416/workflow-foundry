// One Foundry window per workspace (SPEC §11): <workspace>/.lock holds the pid of the process serving the site. A second `site`
// start on a live lock is refused with a plain sentence; `mcp --dashboard` sends the person to the window that is already open.
// The lock guards only against two windows; the store itself is SQLite with WAL and tolerates several readers and writers.
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';

const fileOf = workspace => path.join(workspace, '.lock');
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export function readLock(workspace) {
  const file = fileOf(workspace);
  if (!existsSync(file)) return null;
  try { const v = JSON.parse(readFileSync(file, 'utf8')); return { ...v, alive: alive(v.pid) }; } catch { return { pid: null, alive: false }; }
}
export function takeLock(workspace, kind) {
  const file = fileOf(workspace), current = readLock(workspace);
  if (current?.alive && current.pid !== process.pid)
    return { ok: false, holder: current, say: `Foundry is already open for this workspace (pid ${current.pid}). Use that window, or start with --workspace <other>.` };
  let state = { pid: process.pid, kind, startedAt: new Date().toISOString() };
  const write = () => writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  write();
  return { ok: true, update(fields) { state = { ...state, ...fields }; write(); }, release() { try { if (readLock(workspace)?.pid === process.pid) rmSync(file, { force: true }); } catch { /* gone */ } } };
}
