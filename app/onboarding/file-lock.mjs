// A lock for read-modify-write on one small JSON file shared by two Foundry processes (the site and the MCP server, security review
// 2026-10-21: M7 for <workspace>/batches.json, L14 for <workspace>/site/decisions.jsonl). Without it, two processes that read, change
// and rewrite the same file lose each other's change: a used list can reopen, and the decision log forks.
//
//   <file>.lock   created with O_EXCL (flag 'wx'), holding { pid, token, at }. Whoever creates it holds the lock; it is removed only by
//                 its holder (the token is checked first). A lock whose process is gone, or older than staleMs, is broken and retaken.
//   <file>.lock.break   (fix round 2026-10-21, review:security new defect 3) breaking a lock is itself done under a second O_EXCL file:
//                 two processes that both found the holder dead could otherwise both remove the lock, the second removing the lock the
//                 first had just taken, and both go on. The breaker re-reads the lock while it holds .break and removes it only if it is
//                 still the very lock it judged (same file, same token). A .break whose process is gone, or older than 5 seconds, is
//                 removed; two processes doing that at once after a crash in the middle of a break is the one race left.
//
// Synchronous on purpose: every caller's read-modify-write is synchronous, so the lock never spans an await. Waiting is a short sleep
// (Atomics.wait) with a deadline; past it the caller gets FILE_BUSY and nothing is changed.
import { openSync, writeSync, closeSync, readFileSync, rmSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { FoundryError } from '../../src/data.mjs';

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const gone = pid => { if (!Number.isInteger(pid) || pid <= 0) return true; try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };

/** What a lock file is now: { ino, age, holder } (holder null when its content is not readable yet), or null when there is none. */
export function look(lock) {
  let st; try { st = statSync(lock); } catch { return null; }
  let holder = null; try { holder = JSON.parse(readFileSync(lock, 'utf8')); } catch { holder = null; }
  return { ino: st.ino, age: Date.now() - st.mtimeMs, holder };
}
const stale = (seen, staleMs) => (seen.holder && gone(seen.holder.pid)) || seen.age > staleMs || (!seen.holder && seen.age > 1000);
/** Remove a lock judged stale, only while holding <lock>.break and only if it is still the same lock (file and token). */
export function breakLock(lock, judged, staleMs) {
  const brk = `${lock}.break`;
  let fd = null;
  try { fd = openSync(brk, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Someone else is breaking it, or a breaker died in the middle: clear a breaker that is certainly left over, then try again later.
    const b = look(brk);
    if (b && ((b.holder && gone(b.holder.pid)) || b.age > 5000 || (!b.holder && b.age > 1000))) { try { rmSync(brk, { force: true }); } catch { /* raced */ } }
    pause(2);
    return;
  }
  try {
    try { writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() })); } finally { closeSync(fd); }
    // Only a holder removes its own lock, and only a breaker removes a stale one. While we hold .break, no other breaker can, and the stale
    // lock's holder is gone; so if the lock is still the one we judged, it stays so until we remove it.
    const now = look(lock);
    if (now && now.ino === judged.ino && (now.holder?.token ?? null) === (judged.holder?.token ?? null) && stale(now, staleMs)) rmSync(lock, { force: true });
  } finally { try { rmSync(brk, { force: true }); } catch { /* already gone */ } }
}

/** Run fn() while holding <file>.lock. options: timeoutMs (wait at most), staleMs (break a lock older than this). Returns fn()'s value. */
export function withFileLock(file, fn, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  const lock = `${file}.lock`, token = randomBytes(8).toString('hex'), deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    let fd = null;
    try { fd = openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const seen = look(lock);
      if (!seen) continue; // released meanwhile: try again
      // A holder that died, or a lock left far too long: break it (its writer cannot be mid-write any more), under the breaker.
      if (stale(seen, staleMs)) breakLock(lock, seen, staleMs);
      if (Date.now() > deadline) throw new FoundryError('FILE_BUSY', 'Another Foundry window is changing the same records. Nothing was changed; try again.');
      pause(Math.min(25, 2 + attempt));
      continue;
    }
    try { writeSync(fd, JSON.stringify({ pid: process.pid, token, at: Date.now() })); } finally { closeSync(fd); }
    try { return fn(); }
    finally {
      try { if (JSON.parse(readFileSync(lock, 'utf8')).token === token) rmSync(lock, { force: true }); } catch { /* already gone */ }
    }
  }
}
