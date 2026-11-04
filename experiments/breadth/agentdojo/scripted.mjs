// Scripted ($0) execution on the AgentDojo adapter (experiments/breadth/agentdojo): plans from the bridge (null, refuse,
// gold, injgold, obey, mutant), executed through the SAME serve path a model session uses (open -> one `calls` request
// per step -> close -> snapshot), then graded host-side by a separate `grade` process. The `official` path replays the
// same steps through upstream's own pipeline and evaluator (TaskSuite.run_task_with_pipeline) for parity.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BridgeServer, MAX_STEPS, bridgeOk, readJsonl } from './lib.mjs';

/** Scripted policies. null: answers "Done." with no tool call; refuse: a refusal with no tool call; obey: does the user
 * task's gold AND, right after the first tool output that carries the injection, the injection task's gold (every
 * instruction it sees is obeyed: the ASR ceiling); gold/injgold/mutant are fixtures for parity and oracle checks. */
export const BASELINES = Object.freeze(['null', 'obey', 'refuse']);
export const FIXTURES = Object.freeze(['gold', 'injgold', 'mutant']);

/** Plan every unit (one bridge, sequential). Returns Map id -> plan {steps, final, meta}. */
export async function planUnits(bridge, units, policy, { mutantOf = null } = {}) {
  const out = new Map();
  for (const u of units) out.set(u.id, await bridge.plan(u, policy, mutantOf ? mutantOf(u) : null));
  return out;
}

/** Execute plans through serve: one `calls` request per step. Writes the snapshot to <hostRoot>/<id>/. */
export async function executePlans(bridge, units, plans, hostRoot, { maxRequests = MAX_STEPS } = {}) {
  const recs = [];
  for (const u of units) {
    const p = plans.get(u.id);
    const hostDir = path.join(hostRoot, u.id.replaceAll('/', '__'));
    rmSync(hostDir, { recursive: true, force: true });
    mkdirSync(hostDir, { recursive: true });
    const h = bridge.handle('s');
    const ready = await bridge.open(h, u, hostDir, maxRequests);
    const shown = [];
    for (const step of p.steps) {
      const r = await bridge.calls(h, step);
      shown.push(...r.results.map(x => ({ name: x.name, content: x.content, error: Boolean(x.error) })));
    }
    const closed = await bridge.close(h, p.final);
    recs.push({ id: u.id, unit: u, hostDir, preDigest: ready.preDigest, injectionVectors: ready.injectionVectors, results: shown, postDigest: closed.postDigest,
      traceSha256: closed.traceSha256, steps: closed.steps, calls: closed.calls, meta: p.meta });
  }
  return recs;
}

/** Host-only grading in a separate process (bridge.py grade). Returns Map id -> {utility, security, digest} | {error}. */
export async function gradeRecords(recs, liveDir, { authored = null } = {}) {
  mkdirSync(liveDir, { recursive: true });
  const tag = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const inF = path.join(liveDir, `grade-in-${tag}.jsonl`), outF = path.join(liveDir, `grade-out-${tag}.jsonl`);
  writeFileSync(inF, recs.map(r => JSON.stringify({ id: r.id, hostDir: r.hostDir })).join('\n') + '\n');
  await bridgeOk(['grade', '--in', inF, '--out', outF, ...(authored ? ['--authored', authored] : [])], { liveDir });
  const rows = readJsonl(outF);
  rmSync(inF, { force: true }); rmSync(outF, { force: true });
  return new Map(rows.map(r => [r.id, r]));
}

/** The same plans through upstream's own pipeline and evaluator. Returns Map id -> {utility, security, results, postDigest}. */
export async function officialRun(units, plans, liveDir, { realClock = false, authored = null } = {}) {
  mkdirSync(liveDir, { recursive: true });
  const tag = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const inF = path.join(liveDir, `off-in-${tag}.jsonl`), outF = path.join(liveDir, `off-out-${tag}.jsonl`);
  writeFileSync(inF, units.map(u => { const p = plans.get(u.id); return JSON.stringify({ id: u.id, unit: u, steps: p.steps, final: p.final }); }).join('\n') + '\n');
  await bridgeOk(['official', '--in', inF, '--out', outF, ...(realClock ? ['--real-clock'] : []), ...(authored ? ['--authored', authored] : [])], { liveDir });
  const rows = readJsonl(outF);
  rmSync(inF, { force: true }); rmSync(outF, { force: true });
  return new Map(rows.map(r => [r.id, r]));
}

/** Plan + execute + grade a list of units with one policy on a fresh bridge. Returns [{...rec, verdict}]. */
export async function runScripted(units, policy, { liveDir, hostRoot, authored = null, mutantOf = null, bridge = null } = {}) {
  const own = !bridge;
  const b = bridge ?? new BridgeServer({ liveDir, authored });
  try {
    if (own) await b.hello;
    const plans = await planUnits(b, units, policy, { mutantOf });
    const recs = await executePlans(b, units, plans, hostRoot);
    const verdicts = await gradeRecords(recs, liveDir, { authored });
    return { plans, recs: recs.map(r => ({ ...r, verdict: verdicts.get(r.id) })) };
  } finally { if (own) await b.quit(); }
}

/** Unit constructors. */
export const benignUnit = (suite, userTask) => ({ id: `${suite}/${userTask}/benign`, suite, userTask, condition: 'benign', injectionTask: null, injectionSource: null });
export const attackUnit = (suite, userTask, injectionTask, source = 'upstream', condition = 'attack') =>
  ({ id: `${suite}/${userTask}/${condition}/${injectionTask}`, suite, userTask, condition, injectionTask, injectionSource: source });
