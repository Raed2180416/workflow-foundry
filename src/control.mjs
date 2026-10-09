// The owner's control surface over executing runs: `foundry cancel RUN` and `foundry stop-all` (R-21, synthesis §3.17), also behind
// POST /api/runs/:id/cancel and /api/stop-all. The CLI that cancels is usually not the process that executes the run, so cancellation is
// durable and goes through the store, never through a signal alone:
//
//   1. requestCancel (src/runtime.mjs) records `cancelRequest` and a `run.cancel_requested` event in one compare-and-swap update.
//   2. The process executing the run sees it (its Invocation polls the header; a run resumed later sees it on taking ownership), aborts its
//      model calls and sandboxes, which kills their process groups, and writes the cancelled verdict itself. A run in this process is aborted
//      at once, without waiting for the poll.
//   3. A run nothing executes (parked on a timer, a human or an approval; or its owner died, after the abort and before the verdict
//      included) is closed here (closeCancelled): the same verdict, written by the canceller in one update.
//   4. A live owner that has not stopped when the grace period ends is reported (cancel) or, for `--force` and stop-all, killed with its
//      whole process tree (killOwnerTree), and the run is then closed as in 3.
//
// A run stops as `cancelled` (verdict `inconclusive`, code CANCELLED), a final state: it is never resumed. A run that had an effect of unknown
// outcome in flight (a task whose capability has effects) stops as `uncertain` instead, as any interrupted effect does, and the report lists it.
// Every step is a compare-and-swap update with its chain events, so a crash at any point leaves a consistent, verifiable run (and another
// `foundry cancel`, or `foundry resume`, finishes the job).
import { setTimeout as delay } from 'node:timers/promises';
import { errorData } from './data.mjs';
import { ownerAlive, processStartStamp } from './runtime.mjs';
import { ancestorsOf, processTable, reapChildren } from './children.mjs';
export { ancestorsOf, processTable };

const FINAL = new Set(['succeeded', 'failed', 'cancelled']);
const LIST_LIMIT = 50;
const POLL_MS = 25;
const KILL_WAIT_MS = 3000;

// ---- processes -------------------------------------------------------------------------------------------------------------------------

/** Every live descendant of `pid` (children, their children ...), zombies excluded. */
export function descendantsOf(table, pid) {
  const children = new Map();
  for (const p of table) { if (!children.has(p.ppid)) children.set(p.ppid, []); children.get(p.ppid).push(p); }
  const found = [], pending = [...(children.get(pid) ?? [])];
  while (pending.length) { const p = pending.pop(); if (found.some(x => x.pid === p.pid)) continue; found.push(p); pending.push(...(children.get(p.pid) ?? [])); }
  return found.filter(p => p.state !== 'Z');
}
/**
 * What to kill to stop an owner process and everything it started, from a process table. Sandboxes and model CLIs run in their own (detached)
 * process groups, so those are signalled as groups; a descendant in the owner's own group, or in a group this process shares, is signalled by pid.
 * Never this process, its ancestors, or any group they belong to (on 10-07 the first stop-all matched itself): the plan names only processes
 * below the owner, and the owner itself only when it is not this process or one of its ancestors.
 * -> {skipped} | {owner, groups: [pgid], pids: [pid]}
 */
export function escalationPlan(table, ownerPid, selfPid = process.pid) {
  const byPid = new Map(table.map(p => [p.pid, p]));
  const owner = byPid.get(ownerPid);
  if (!owner || owner.state === 'Z') return { skipped: 'the owner process has already exited' };
  const protectedPids = new Set(ancestorsOf(table, selfPid));
  if (protectedPids.has(ownerPid)) return { skipped: 'the owner is this process or one of its ancestors' };
  const protectedGroups = new Set([...protectedPids].map(pid => byPid.get(pid)?.pgid).filter(Number.isInteger));
  const groups = new Set(), pids = new Set();
  for (const p of descendantsOf(table, ownerPid)) {
    if (protectedPids.has(p.pid)) continue;
    if (p.pgid !== owner.pgid && !protectedGroups.has(p.pgid)) groups.add(p.pgid); else pids.add(p.pid);
  }
  return { owner: ownerPid, groups: [...groups].sort((a, b) => a - b), pids: [...pids].sort((a, b) => a - b) };
}
const send = (target, signal) => { try { process.kill(target, signal); return true; } catch { return false; } };
const stillThere = (table, plan) => table.some(p => p.state !== 'Z' && (p.pid === plan.owner || plan.pids.includes(p.pid) || plan.groups.includes(p.pgid)));
/**
 * Stop a run's owner by force: freeze it (so it cannot start the next node while its processes are killed), SIGKILL every process below it
 * (sandboxes, model CLIs and anything they started) and then the owner, and wait until none is left. The owner is identified by the pid and
 * start time its run recorded, never by name. -> {pid, killed, groups, pids, skipped?}
 */
export async function killOwnerTree(owner, { selfPid = process.pid } = {}) {
  const report = { pid: owner.pid, killed: false, groups: [], pids: [] };
  const current = processStartStamp(owner.pid);
  if (!ownerAlive(owner) || (owner.processStart && current && owner.processStart !== current)) return { ...report, killed: true, skipped: 'the owner process is gone' };
  let plan = escalationPlan(processTable(), owner.pid, selfPid);
  if (plan.skipped) return { ...report, killed: /exited/.test(plan.skipped), skipped: plan.skipped };
  send(owner.pid, 'SIGSTOP');
  plan = escalationPlan(processTable(), owner.pid, selfPid);
  if (plan.skipped) return { ...report, killed: /exited/.test(plan.skipped), skipped: plan.skipped };
  const all = { owner: owner.pid, groups: new Set(plan.groups), pids: new Set(plan.pids) };
  const kill = () => {
    for (const group of all.groups) send(-group, 'SIGKILL');
    for (const pid of all.pids) send(pid, 'SIGKILL');
    send(owner.pid, 'SIGKILL');
  };
  kill();
  for (const end = Date.now() + KILL_WAIT_MS; Date.now() < end;) {
    // A child that was forking while the owner froze may have started another process: take what is below the owner (and in our groups) too.
    const table = processTable(), more = escalationPlan(table, owner.pid, selfPid);
    for (const group of more.groups ?? []) all.groups.add(group);
    for (const pid of more.pids ?? []) all.pids.add(pid);
    if (!stillThere(table, { owner: owner.pid, groups: [...all.groups], pids: [...all.pids] })) return { ...report, killed: true, groups: [...all.groups], pids: [...all.pids] };
    kill();
    await delay(20);
  }
  return { ...report, groups: [...all.groups], pids: [...all.pids], skipped: 'some processes survived SIGKILL (not permitted to signal them, or an uninterruptible wait)' };
}

// ---- reports ---------------------------------------------------------------------------------------------------------------------------

const listed = items => ({ count: items.length, items: items.slice(0, LIST_LIMIT) });
const nodeKeyOf = ({ frameKey, nodeId }) => `${frameKey}/${nodeId}`;
// What the run looks like once stopped: the nodes the cancellation stopped, the effects whose outcome is unknown, what was left unanswered.
function stoppedState(store, runId) {
  const header = store.rows.header(runId);
  const effectsUnknown = store.rows.withStatus(runId, 'uncertain').map(x => ({ nodeKey: nodeKeyOf(x), tool: x.state.tool ?? null, effects: x.state.effects ?? null, error: x.state.error?.code ?? null }));
  const stopped = store.rows.withStatus(runId, 'failed').filter(x => x.state.error?.code === 'CANCELLED').map(x => ({ nodeKey: nodeKeyOf(x), kind: x.state.kind ?? null }));
  const questions = store.rows.withStatus(runId, 'awaiting_human').map(nodeKeyOf);
  const approvals = Object.values(header.approvals ?? {}).filter(a => a.status === 'pending').map(a => ({ approvalId: a.id, nodeKey: a.nodeKey, tool: a.tool }));
  return { header, effectsUnknown, stopped, unanswered: { questions, approvals } };
}
function sentence(outcome, runId, workflowId, state, { waitedMs, escalation, finishedBefore, orphans = [] } = {}) {
  const { header, effectsUnknown, stopped, unanswered } = state, who = `Run ${runId}${workflowId ? ` (${workflowId})` : ''}`;
  const verdict = header.verdict?.verdict ? `, verdict ${header.verdict.verdict}` : '';
  if (outcome === 'already-finished') {
    return finishedBefore ? `${who} finished on its own (${header.status}${verdict}) before the cancellation took effect; the cancellation request stands in its record.`
      : `${who} is already ${header.status}${verdict}; there is nothing to cancel.`;
  }
  if (outcome === 'uncertain' && state.noop) return `${who} is uncertain: an effect's outcome is unknown. Nothing is executing, so there is nothing to cancel; check the effect (see effectsUnknown) before running this again.`;
  const parts = [];
  if (stopped.length) parts.push(`stopped ${stopped.length} running node${stopped.length === 1 ? '' : 's'} (${stopped.slice(0, 5).map(x => `${x.nodeKey}${x.kind ? ` ${x.kind}` : ''}`).join(', ')}${stopped.length > 5 ? ', ...' : ''})`);
  if (unanswered.questions.length) parts.push(`${unanswered.questions.length} question${unanswered.questions.length === 1 ? '' : 's'} left unanswered`);
  if (unanswered.approvals.length) parts.push(`${unanswered.approvals.length} approval${unanswered.approvals.length === 1 ? '' : 's'} left undecided`);
  const what = parts.length ? parts.join('; ') : 'nothing was running';
  const processes = escalation ? escalation.groups.length + escalation.pids.length : 0;
  const killed = (escalation?.killed && !escalation.skipped ? ` The owner (pid ${escalation.pid}) did not stop within the grace period and was killed with ${processes} process${processes === 1 ? '' : 'es'} below it.` : '')
    + (orphans.length ? ` Stopped ${orphans.length} process group${orphans.length === 1 ? '' : 's'} its dead owner had left running (${orphans.map(o => o.kind).join(', ')}).` : '');
  if (outcome === 'cancelled') return `${who} cancelled: ${what}. The run is closed and will not be resumed. Effects that completed before the stop remain recorded.${killed}`;
  if (outcome === 'uncertain') {
    return `${who} stopped with ${effectsUnknown.length} effect${effectsUnknown.length === 1 ? '' : 's'} of unknown outcome (${effectsUnknown.slice(0, 5).map(x => `${x.nodeKey}${x.tool ? ` ${x.tool}` : ''}`).join(', ')}${effectsUnknown.length > 5 ? ', ...' : ''}): `
      + `each may or may not have happened, so check them before anything re-runs. Also: ${what}.${killed}`;
  }
  if (outcome === 'requested') return `Cancellation of ${who} is recorded and its owner (pid ${header.owner?.pid ?? '?'}) was asked to stop; it will record the cancelled verdict when it has aborted its work.`;
  return `Cancellation of ${who} is recorded, but its owner (pid ${header.owner?.pid ?? '?'}) had not stopped after ${Math.round((waitedMs ?? 0) / 100) / 10} s. `
    + `It will stop when it next looks (it checks every fraction of a second). If it is stuck, run \`foundry cancel ${runId} --force\` to kill it and its sandboxes and model processes.${escalation?.skipped ? ` Not killed: ${escalation.skipped}.` : ''}`;
}
function report(foundry, runId, outcome, { requested = null, waitedMs = 0, escalation = null, finishedBefore = false, noop = false, owner = null, orphans = [] } = {}) {
  const state = { ...stoppedState(foundry.store, runId), noop };
  const { header } = state;
  return {
    runId, workflowId: header.workflowId ?? null, outcome, noop, status: header.status, verdict: header.verdict?.verdict ?? null, error: header.error ?? null,
    cancel: header.cancelRequest ?? requested, owner: owner ?? (header.owner ? { pid: header.owner.pid } : null), waitedMs,
    stopped: listed(state.stopped), effectsUnknown: listed(state.effectsUnknown), unanswered: state.unanswered,
    ...(escalation ? { escalation } : {}), ...(orphans.length ? { orphans } : {}), message: sentence(outcome, runId, header.workflowId, state, { waitedMs, escalation, finishedBefore, orphans })
  };
}

// ---- cancel ----------------------------------------------------------------------------------------------------------------------------

/**
 * Cancel one run. Resolves once the run has stopped, or the grace period has passed with its owner still alive. `outcome`:
 *   cancelled         the run is now cancelled (final);
 *   uncertain         it stopped with an effect of unknown outcome (listed in effectsUnknown), or already was uncertain (`noop`);
 *   already-finished  it had succeeded, failed or been cancelled: nothing was changed (`noop`);
 *   requested         graceMs is 0: the request is recorded and its owner asked to stop, without waiting;
 *   not-stopped       the owner had not stopped within graceMs (and was not killed: `force` kills it).
 * Throws NOT_FOUND for an unknown run.
 *
 * graceMs: how long to wait for the owner to abort its work and record the verdict. force: after the grace period, kill the owner and everything
 * below it (killOwnerTree), then close the run here. `escalations` (stop-all) shares one kill per owner process between its runs.
 */
export async function cancelRun(foundry, runId, { actor = 'cli', reason = '', graceMs = 10000, force = false, journalDb, escalations = new Map() } = {}) {
  const { store, runtime } = foundry, startedAt = Date.now();
  let header = store.rows.header(runId); // NOT_FOUND
  if (FINAL.has(header.status)) return report(foundry, runId, 'already-finished', { noop: true });
  if (header.status === 'uncertain') return report(foundry, runId, 'uncertain', { noop: true });
  let requested;
  try { requested = runtime.requestCancel(runId, { actor, reason }).request; }
  catch (error) {
    if (error.code === 'RUN_CLOSED') return report(foundry, runId, 'already-finished', { noop: true, finishedBefore: false });
    if (error.code === 'RUN_UNCERTAIN') return report(foundry, runId, 'uncertain', { noop: true });
    throw error;
  }
  foundry.active.get(runId)?.controller.abort(); // this process executes it: no need to wait for the poll
  let deadline = startedAt + graceMs, phase = 'grace', escalation = null;
  const orphans = [];
  for (;;) {
    header = store.rows.header(runId);
    if (FINAL.has(header.status) || header.status === 'uncertain') break;
    const owner = header.owner;
    if (!owner || !ownerAlive(owner)) {
      // Nothing executes it: parked, or its owner died (after the abort and before the verdict, perhaps). Stop the process groups a dead
      // owner left running (src/children.mjs), then close the run here.
      orphans.push(...reapChildren(store, runId).filter(child => child.killed));
      try { runtime.closeCancelled(runId, { actor, reason, journalDb }); }
      catch (error) { if (!['RUN_BUSY', 'RUN_CLOSED', 'RUN_UNCERTAIN'].includes(error.code)) throw error; }
      continue;
    }
    if (Date.now() >= deadline) {
      if (phase === 'grace' && force) {
        const key = `${owner.pid}:${owner.processStart ?? ''}`;
        if (!escalations.has(key)) escalations.set(key, killOwnerTree(owner));
        escalation = await escalations.get(key);
        phase = 'killed'; deadline = Date.now() + KILL_WAIT_MS;
        if (!escalation.killed) break;
        continue;
      }
      break;
    }
    await delay(POLL_MS);
  }
  const waitedMs = Date.now() - startedAt;
  header = store.rows.header(runId);
  if (header.status === 'cancelled') return report(foundry, runId, 'cancelled', { requested, waitedMs, escalation, orphans });
  if (header.status === 'uncertain') return report(foundry, runId, 'uncertain', { requested, waitedMs, escalation, orphans });
  if (FINAL.has(header.status)) return report(foundry, runId, 'already-finished', { requested, waitedMs, finishedBefore: true, orphans });
  return report(foundry, runId, graceMs === 0 ? 'requested' : 'not-stopped', { requested, waitedMs, escalation, orphans });
}

// ---- stop-all --------------------------------------------------------------------------------------------------------------------------

/**
 * Stop everything in this workspace: cancel every run that has not reached a final status. Executing runs are asked to stop (and killed with
 * their process trees after the grace period unless `escalate` is false); runs parked on a timer, a human or an approval, and runs whose owner
 * died, are closed here. Closing parked runs also ends their timers, so a later `foundry tick` or `serve` does not restart them. Runs that
 * are `uncertain` are left as they are (nothing is executing; cancelling does not settle the effect). `executingOnly` leaves the parked runs
 * alone. Never signals this process or its ancestors. Always resolves with a report; runs that could not be stopped are in `failed`/`results`.
 */
export async function stopAll(foundry, { actor = 'cli', reason = '', graceMs = 10000, executingOnly = false, escalate = true, journalDb } = {}) {
  const { store } = foundry, escalations = new Map(), skipped = [], targets = [];
  for (const id of store.openRunIds()) {
    const header = store.rows.header(id), executing = (!!header.owner && ownerAlive(header.owner)) || header.status === 'running';
    if (header.status === 'uncertain') skipped.push({ runId: id, status: header.status, reason: 'uncertain: nothing is executing, and cancelling does not settle the effect of unknown outcome' });
    else if (executingOnly && !executing) skipped.push({ runId: id, status: header.status, reason: 'not executing (executing-only)' });
    else targets.push(id);
  }
  // Every cancel writes its request and aborts what this process executes before its first wait, so the requests are all out before any waiting.
  const settled = await Promise.allSettled(targets.map(id => cancelRun(foundry, id, { actor, reason, graceMs, force: escalate, journalDb, escalations })));
  const results = [], failed = [];
  settled.forEach((entry, i) => { if (entry.status === 'fulfilled') results.push(entry.value); else failed.push({ runId: targets[i], error: errorData(entry.reason) }); });
  // Process groups still on file for runs that nothing executes any more (a run that ended, or whose owner died and which was not open
  // above): the leftovers of a killed owner. Runs with a live owner are not touched.
  const strays = [];
  for (const id of store.childRunIds()) {
    let header;
    try { header = store.rows.header(id); } catch { header = null; }
    if (header && !FINAL.has(header.status) && header.owner && ownerAlive(header.owner)) continue;
    for (const child of reapChildren(store, id)) if (child.killed) strays.push({ runId: id, pid: child.pid, kind: child.kind });
  }
  const count = outcome => results.filter(r => r.outcome === outcome).length;
  const killed = [...escalations.values()].length ? (await Promise.all(escalations.values())) : [];
  const summary = { requested: targets.length, cancelled: count('cancelled'), uncertain: count('uncertain'), alreadyFinished: count('already-finished'), notStopped: count('not-stopped') + count('requested'), failed: failed.length, skipped: skipped.length, strays: strays.length };
  const lines = [`${summary.cancelled} of ${targets.length} run${targets.length === 1 ? '' : 's'} cancelled`];
  if (summary.uncertain) lines.push(`${summary.uncertain} stopped with an effect of unknown outcome`);
  if (summary.alreadyFinished) lines.push(`${summary.alreadyFinished} finished on their own`);
  if (summary.notStopped) lines.push(`${summary.notStopped} not stopped yet (the owner is still alive)`);
  if (failed.length) lines.push(`${failed.length} could not be cancelled (${failed.slice(0, 3).map(f => `${f.runId}: ${f.error.code}`).join(', ')})`);
  if (skipped.length) lines.push(`${skipped.length} left alone`);
  const orphaned = results.reduce((sum, r) => sum + (r.orphans?.length ?? 0), 0) + strays.length;
  if (orphaned) lines.push(`stopped ${orphaned} process group${orphaned === 1 ? '' : 's'} that dead owners had left running`);
  if (killed.length) lines.push(`killed ${killed.length} owner process${killed.length === 1 ? '' : 'es'} (${killed.map(k => `pid ${k.pid}${k.skipped ? `, ${k.skipped}` : ''}`).join('; ')}) with everything below ${killed.length === 1 ? 'it' : 'them'}`);
  return { workspace: store.workspace, at: Date.now(), reason, summary, results, failed, skipped, strays, killed, message: `${lines.join('; ')}.` };
}
/** The process exit code a cancel or stop-all report maps to: 0 stopped (or nothing to stop), 2 an effect of unknown outcome, 3 not stopped. */
export function exitCodeOf(result) {
  if (result.results) {
    if (result.failed.length || result.summary.notStopped) return 3;
    return result.summary.uncertain ? 2 : 0;
  }
  return result.outcome === 'not-stopped' ? 3 : result.outcome === 'uncertain' ? 2 : 0;
}
