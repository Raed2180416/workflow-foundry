// The process groups a run has started, kept in the store while they run (table run_children), so that whoever finds the run's owner dead
// can still stop them. Sandboxed code and model-CLI subprocesses run in their own (detached) process groups whose wall-clock limits are timers
// in the owner's process: a killed owner (SIGKILL, the OOM killer, a machine reset) leaves them running, a busy loop burning a CPU or a model
// call that is still billed. The owner's own signal handlers cannot help there, so the groups are recorded as they start and removed as they end.
//
//   - Spawn sites (src/sandbox.mjs, src/process.mjs) call trackChild() right after spawn; it records the group when the call happens inside an
//     execution (childScope, set by the runtime around its sandbox and model calls) and does nothing otherwise (a script, an experiment).
//   - reapChildren() kills what a dead owner left: used by `foundry cancel`, `stop-all`, and by a run that takes ownership again.
//
// Dependency-free on purpose (it is imported by process.mjs and sandbox.mjs, which the model providers use).
import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

// Linux only: setpriv(1) sets PR_SET_PDEATHSIG before it execs the command, so the kernel SIGKILLs the child the moment the process that
// spawned it dies, however it dies (SIGKILL, the OOM killer). Detached groups otherwise outlive a killed owner until a cancel or resume
// reaps them, and the experiment executors record nothing to reap (orch-20261021 B2, B3). Elsewhere (macOS has no PDEATHSIG) the
// recorded groups and reapChildren stay the only cleanup.
const SETPRIV = process.platform === 'linux' ? (['/usr/bin/setpriv', '/bin/setpriv'].find(p => { try { return existsSync(p); } catch { return false; } }) ?? null) : null;
/** [command, args] for spawn(): `command` wrapped so that it dies with the process that spawns it (see SETPRIV); unchanged without setpriv. */
export function lifeline(command, args) { return SETPRIV ? [SETPRIV, ['--pdeathsig', 'KILL', '--', command, ...args]] : [command, args]; }
/** Did setpriv itself fail to exec the wrapped command (it exits 126/127 and says so)? That is a launch failure of the command, as a spawn
 *  ENOENT/EACCES was before the lifeline wrapped it, never a run of the command that failed. */
export const lifelineExecFailed = (code, stderr = '') => !!SETPRIV && (code === 126 || code === 127) && /^setpriv: failed to execute /m.test(String(stderr));

/** Set by the runtime around a sandbox or model call: {add(child), remove(pid)}. */
export const childScope = new AsyncLocalStorage();

/** The kernel start time of a process (field 22 of /proc/PID/stat; identifies a process across pid reuse), or null. */
export function startOf(pid) {
  try { const text = readFileSync(`/proc/${pid}/stat`, 'utf8'); return text.slice(text.lastIndexOf(')') + 2).split(' ')[19] ?? null; }
  catch { return null; }
}
/** [{pid, ppid, pgid, state, start}] for every process (Linux /proc); empty where /proc is not available. */
export function processTable(root = '/proc') {
  let names;
  try { names = readdirSync(root); } catch { return []; }
  const table = [];
  for (const name of names) {
    if (!/^[0-9]+$/.test(name)) continue;
    try {
      const text = readFileSync(`${root}/${name}/stat`, 'utf8'), rest = text.slice(text.lastIndexOf(')') + 2).split(' ');
      table.push({ pid: Number(name), state: rest[0], ppid: Number(rest[1]), pgid: Number(rest[2]), start: rest[19] });
    } catch { /* exited while scanning */ }
  }
  return table;
}
/** `pid` and its ancestors, nearest first. */
export function ancestorsOf(table, pid) {
  const byPid = new Map(table.map(p => [p.pid, p])), found = [];
  for (let at = pid, seen = new Set(); at > 0 && byPid.has(at) && !seen.has(at); at = byPid.get(at).ppid) { seen.add(at); found.push(at); }
  return found.length ? found : [pid];
}

/**
 * Record a process group this call has just started (spawn it with `detached: true`, so the child leads its own group) with the run that is
 * executing it. Returns the function to call when the process has ended. Never throws: a store that is busy or closed only means the group is
 * not recorded, which is the situation before this existed.
 */
export function trackChild(child, kind) {
  const scope = childScope.getStore();
  if (!scope || !Number.isInteger(child?.pid)) return () => {};
  try { scope.add({ pid: child.pid, pgid: child.pid, start: startOf(child.pid), kind }); } catch { return () => {}; }
  return () => { try { scope.remove(child.pid); } catch { /* the run's store is gone */ } };
}

const send = (target, signal) => { try { process.kill(target, signal); return true; } catch { return false; } };
/**
 * Kill the process groups a run recorded and no execution owns any more, and forget them. Call only when the run's owner is dead or the run
 * is final. A recorded group is killed when its leader is still the process that was recorded (same start time), or when the leader has gone but
 * members remain (the kernel does not reuse a group's id while it has members, so those are the recorded group's). A leader pid that now belongs
 * to another process means the recorded group is gone, and nothing is signalled. Never signals this process, its ancestors or their groups.
 * -> [{pid, kind, killed}] (`killed`: a group was signalled; false when nothing of it was left)
 */
export function reapChildren(store, runId, { table, selfPid = process.pid, kill = send } = {}) {
  const rows = store.children(runId);
  if (!rows.length) return [];
  table ??= processTable();
  const byPid = new Map(table.map(p => [p.pid, p])), protectedPids = new Set(ancestorsOf(table, selfPid));
  const protectedGroups = new Set([...protectedPids].map(pid => byPid.get(pid)?.pgid).filter(Number.isInteger));
  const reaped = [];
  for (const row of rows) {
    const leader = byPid.get(row.pid), members = table.some(p => p.pgid === row.pgid && p.state !== 'Z');
    // A live leader is the recorded process only if its start time is the recorded one; with no start time on file it cannot be told apart
    // from a process that reused the pid, so it is left alone.
    const ours = leader && leader.state !== 'Z' ? (row.start != null && leader.start === row.start) : members;
    let killed = false;
    if (ours && !protectedGroups.has(row.pgid) && !protectedPids.has(row.pid)) killed = kill(-row.pgid, 'SIGKILL') || kill(row.pid, 'SIGKILL');
    reaped.push({ pid: row.pid, kind: row.kind, killed });
  }
  store.forgetChildren(runId);
  return reaped;
}
