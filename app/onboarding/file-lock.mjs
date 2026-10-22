// A lock for read-modify-write on one small JSON file shared by two Foundry processes (the site and the MCP server, security review
// 2026-10-21: M7 for <workspace>/batches.json, L14 for <workspace>/site/decisions.jsonl). Without it, two processes that read, change
// and rewrite the same file lose each other's change: a used list can reopen, and the decision log forks.
//
//   <file>.lock   created with O_EXCL (flag 'wx'), holding { pid, token, at }. Whoever creates it holds the lock; it is removed only by
//                 its holder (the token is checked first). A lock whose process is gone, or older than staleMs, is broken and retaken.
//
// Synchronous on purpose: every caller's read-modify-write is synchronous, so the lock never spans an await. Waiting is a short sleep
// (Atomics.wait) with a deadline; past it the caller gets FILE_BUSY and nothing is changed.
import { openSync, writeSync, closeSync, readFileSync, rmSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { FoundryError } from '../../src/data.mjs';

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const gone = pid => { if (!Number.isInteger(pid) || pid <= 0) return true; try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } };

/** Run fn() while holding <file>.lock. options: timeoutMs (wait at most), staleMs (break a lock older than this). Returns fn()'s value. */
export function withFileLock(file, fn, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  const lock = `${file}.lock`, token = randomBytes(8).toString('hex'), deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt++) {
    let fd = null;
    try { fd = openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null; try { holder = JSON.parse(readFileSync(lock, 'utf8')); } catch { holder = null; }
      let age = 0; try { age = Date.now() - statSync(lock).mtimeMs; } catch { continue; } // released meanwhile: try again
      // A holder that died, or a lock left far too long: break it (its writer cannot be mid-write any more).
      if ((holder && gone(holder.pid)) || age > staleMs || (!holder && age > 1000)) { try { rmSync(lock, { force: true }); } catch { /* raced */ } continue; }
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
