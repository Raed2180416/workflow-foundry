// One runner per workdir (orch-20261021 rank 12, chaos F1): two orchestrators that ran compiled solvers in one shared workdir both
// reported "ok" with each other's traces and answers mixed in. A runner now takes an exclusive lock file in the workdir before it
// writes anything there; a second runner, in this process or another, is refused (WORKDIR_BUSY) while the holder lives.
//
// Creation is atomic and complete: the record is written to a private file opened O_EXCL, then hard-linked to the lock name, which
// fails with EEXIST exactly as an O_EXCL open would, so no runner ever reads a half-written lock. A lock whose holder is gone (its
// pid is dead, or now belongs to another process: the start time differs) is stale and taken over: it is renamed aside first, so of
// two runners that find it stale only one moves it, and both then race for a fresh link.
//
//   const lock = lockWorkdir(dir, { label });   // -> { ok: true, release() } | { ok: false, holder: {pid, label, at} }
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { startOf } from '../../src/children.mjs';

export const LOCK_FILE = '.foundry-workdir.lock';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
// The holder still runs: its pid answers and, where /proc gives start times, it is the same process (not a reused pid).
function holds(record) {
  if (!Number.isInteger(record?.pid) || !alive(record.pid)) return false;
  const start = startOf(record.pid);
  return record.start == null || start == null || start === record.start;
}
const readLock = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

export function lockWorkdir(workdir, { label = null } = {}) {
  mkdirSync(workdir, { recursive: true });
  const file = path.join(workdir, LOCK_FILE), token = randomUUID(), mine = `${file}.${token}`;
  const record = { pid: process.pid, start: startOf(process.pid), token, label, at: Date.now() };
  const fd = openSync(mine, 'wx', 0o600);
  try { writeSync(fd, JSON.stringify(record)); } finally { closeSync(fd); }
  try {
    for (let tries = 0; tries < 4; tries++) {
      try { linkSync(mine, file); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const held = readLock(file);
        if (held && holds(held)) return { ok: false, holder: { pid: held.pid, label: held.label ?? null, at: held.at ?? null } };
        // Stale (or unreadable, which a linked lock never is): move it aside and race again for a fresh link.
        const aside = `${file}.stale-${token}-${tries}`;
        try { renameSync(file, aside); rmSync(aside, { force: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        continue;
      }
      return {
        ok: true, file, token,
        // Released only by its holder, and only while the lock is still its own (never another runner's).
        release() { if (readLock(file)?.token === token) rmSync(file, { force: true }); },
      };
    }
    const held = readLock(file);
    return { ok: false, holder: { pid: held?.pid ?? null, label: held?.label ?? null, at: held?.at ?? null } };
  } finally { rmSync(mine, { force: true }); }
}
