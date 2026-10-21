// One Foundry window per workspace (SPEC §11): <workspace>/.lock holds the pid of the process serving the site and its address. A second
// `site` (or `open`) start on a live lock opens the page that is already running instead of starting another (walkthroughs P1 B2, P2 B2:
// the old refusal named no address and suggested another workspace, which looked like losing every automation); `mcp --dashboard`
// sends the person to the window that is already open.
// The lock guards only against two windows; the store itself is SQLite with WAL and tolerates several readers and writers.
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

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
    return { ok: false, holder: current, say: `Foundry is already running for this folder${current.url ? ` at ${current.url}` : ''}. To open it, run: node ${CLI} open --workspace "${workspace}"` };
  let state = { pid: process.pid, kind, startedAt: new Date().toISOString() };
  const write = () => writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  write();
  return { ok: true, update(fields) { state = { ...state, ...fields }; write(); }, release() { try { if (readLock(workspace)?.pid === process.pid) rmSync(file, { force: true }); } catch { /* gone */ } } };
}
