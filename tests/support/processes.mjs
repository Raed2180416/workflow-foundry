// Process inspection for the cancellation tests (Linux /proc): who is running, in which process group, and whether a group is gone.
// Deliberately independent of src/control.mjs, which the tests check.
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

/** [{pid, ppid, pgid, state}] of every process. */
export const processes = () => readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(pid => {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8'), fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return [{ pid: Number(pid), ppid: Number(fields[1]), pgid: Number(fields[2]), state: fields[0] }];
  } catch { return []; }
});
/** The processes of one process group that are running or stopped (an exited process that nobody reaped yet is not). */
export const groupMembers = pgid => processes().filter(p => p.pgid === pgid && p.state !== 'Z');
/** Is the process present and not a zombie? */
export const isRunning = pid => processes().some(p => p.pid === pid && p.state !== 'Z');
/** Wait for `predicate()` to be truthy (returned), polling; resolves its last value after `ms`. */
export async function until(predicate, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(20); }
  return predicate();
}
/** The pid of a process that has exited (a stand-in for the owner of a crashed run). */
export async function exitedPid() {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  await new Promise(resolve => child.once('exit', resolve));
  return child.pid;
}
