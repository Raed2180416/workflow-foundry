// Swarm ladder rung 1, paid runner (research/swarm-20261021/PREREG-SWARM-R1.md). One entry point per stage:
//   node experiments/swarm/run-r1.mjs freeze      write FROZEN-R1.json (code, prereg, task and arm hashes, CLI, policy); $0
//   node experiments/swarm/run-r1.mjs check       verify the freeze; $0
//   node experiments/swarm/run-r1.mjs build       W: one Haiku builder session writes solve.mjs on dev probes (§4.3)
//   node experiments/swarm/run-r1.mjs calibrate   dev seed 368: A, S, W once each (cost calibration, dev only, §6.1)
//   node experiments/swarm/run-r1.mjs heldout     test seeds from 9301: A, S, W once each, N by the §6.2 rule
// Every paid stage refuses to start unless `check` passes, and every trial is gated by the one global ledger (§6.3): the
// cap is $8.00 of Haiku over all stages, the capability probe included. Exit codes: 0 done, 3 trials left after an
// environment fault (the launcher waits 30 minutes and resumes), 4 cap reached, 5 freeze mismatch, 6 rule stop (N < 4).
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTasks, loadFamily } from '../lib/beds.mjs';
import { runExperiment, armHash, faultsFileOf } from '../lib/runner.mjs';
import { createModelPort } from '../lib/models.mjs';
import { construct } from '../c0/construct.mjs';
import { agentArm, swarmArm, workflowArm, MODEL, LEAD_PREAMBLE, sha16 } from './arms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DOC_DIR = path.join(ROOT, 'research/swarm-20261021');
export const LIVE = process.env.SWARM_R1_LIVE ?? '/var/tmp/foundry-work/swarm-r1';
export const FAMILY = 'wbed-r6', DIFFICULTY = 5;
// §6: the frozen design
export const DESIGN = Object.freeze({
  capUsd: 8.00, probeUsd: 0.00444496, reserveUsd: 0.50, margin: 1.25, nMin: 4, nMax: 10,
  agent: { budgetUsd: 1.00, timeoutMs: 30 * 60 * 1000 },
  swarm: { budgetUsd: 1.00, timeoutMs: 30 * 60 * 1000 },
  workflow: { perTaskUsd: 0.40, timeoutMs: 20 * 60 * 1000, maxCallUsd: 0.40 },
  build: { probeSeeds: [365, 366, 367], builderEffort: 'high', builderBudgetUsd: 1.00, constructionModelUsd: 0.40, minutes: 40, scoreChecks: 6 },
  calibrationSeeds: [368], heldoutSeeds: [9301, 9302, 9303, 9304, 9305, 9306, 9307, 9308, 9309, 9310],
  blocksInParallel: 2,
});
export const FROZEN_CODE = Object.freeze([
  'experiments/swarm/arms.mjs', 'experiments/swarm/spawn-tree.mjs', 'experiments/swarm/coord.mjs', 'experiments/swarm/rootcause.mjs',
  'experiments/swarm/run-r1.mjs', 'experiments/swarm/analyze-r1.mjs', 'experiments/swarm/launch-r1.sh',
  'src/executors/claude-code.mjs', 'src/executors/sandboxed-command.mjs', 'experiments/lib/runner.mjs', 'experiments/lib/beds.mjs', 'experiments/lib/services.mjs',
  'experiments/lib/arms/b0-agent.mjs', 'experiments/lib/arms/b1-script.mjs', 'experiments/c0/construct.mjs', 'experiments/c0/prompts.mjs', 'experiments/lib/kit.mjs',
  'beds/wbed/r6/index.mjs', 'beds/wbed/r6/world.mjs', 'beds/wbed/r6/render.mjs', 'beds/wbed/r6/pipeline.mjs', 'beds/wbed/r6/score.mjs', 'beds/wbed/r6/stages.mjs',
  'beds/wbed/r6/verify.mjs', 'beds/wbed/r6/vocab.mjs', 'beds/wbed/r6/controls.mjs', 'beds/wbed/r6/budget.mjs', 'beds/wbed/r6/whitebox.mjs', 'beds/wbed/r6/heuristic.mjs',
  'policy/models.json', 'research/swarm-20261021/PREREG-SWARM-R1.md',
]);
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const fileSha = rel => sha256(readFileSync(path.join(ROOT, rel)));
export function cliFacts(binary = 'claude') {
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
  let real = null; try { real = execFileSync('readlink', ['-f', execFileSync('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8' }).trim()], { encoding: 'utf8' }).trim(); } catch {}
  return { version, sha256: real ? sha256(readFileSync(real)) : null };
}

/** The frozen record: everything a paid stage must find unchanged. */
export async function freezeRecord({ withCli = true } = {}) {
  const calib = await makeTasks(FAMILY, { split: 'dev', seeds: DESIGN.calibrationSeeds, difficulty: DIFFICULTY });
  const held = await makeTasks(FAMILY, { split: 'test', seeds: DESIGN.heldoutSeeds, difficulty: DIFFICULTY });
  const probes = await makeTasks(FAMILY, { split: 'dev', seeds: DESIGN.build.probeSeeds, difficulty: DIFFICULTY });
  const fam = await loadFamily(FAMILY);
  const arms = [agentArm({ ...DESIGN.agent }), swarmArm({ ...DESIGN.swarm })];
  return {
    schema: 'swarm-r1-freeze/1', design: DESIGN, family: FAMILY, bedVersion: fam.version, model: MODEL,
    code: Object.fromEntries(FROZEN_CODE.map(f => [f, fileSha(f)])),
    leadPreambleSha16: sha16(LEAD_PREAMBLE), arms: Object.fromEntries(arms.map(a => [a.id, armHash(a)])),
    tasks: { calibration: calib.map(t => [t.taskKey, t.taskHash]), heldout: held.map(t => [t.taskKey, t.taskHash]), probes: probes.map(t => [t.taskKey, t.taskHash]) },
    cli: withCli ? cliFacts() : null,
  };
}
const FROZEN_FILE = path.join(DOC_DIR, 'FROZEN-R1.json');
/** Differences between the frozen record and now ([] when unchanged). */
export function freezeDiff(frozen, now) {
  const out = [];
  const cmp = (a, b, at) => {
    if (a && typeof a === 'object' && b && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) cmp(a[k], b[k], `${at}.${k}`); return; }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(at);
  };
  cmp(frozen, now, '$');
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// One global ledger over every stage (§6.3): the probe, the build, every trial (recorded and faulted).
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
export function spentSoFar(live = LIVE) {
  let usd = DESIGN.probeUsd;
  const b = path.join(live, 'build', 'construction.json');
  if (existsSync(b)) usd += JSON.parse(readFileSync(b, 'utf8')).constructionCostUsd ?? 0;
  for (const stage of ['calibrate', 'heldout']) {
    const f = path.join(live, stage, 'results.jsonl');
    for (const r of [...readJsonl(f), ...readJsonl(faultsFileOf(f))]) usd += (r.costUsd ?? 0) + (r.imputedUsd ?? 0);
  }
  return usd;
}
/** §6.2: N from the calibration block cost. */
export function heldoutN({ spent, blockUsd }) {
  const n = Math.floor((DESIGN.capUsd - spent - DESIGN.reserveUsd) / (DESIGN.margin * blockUsd));
  return Math.max(0, Math.min(DESIGN.nMax, n));
}

async function checkFrozen() {
  if (!existsSync(FROZEN_FILE)) { console.error('no FROZEN-R1.json: run freeze first'); process.exit(5); }
  const frozen = JSON.parse(readFileSync(FROZEN_FILE, 'utf8'));
  const diff = freezeDiff(frozen, await freezeRecord());
  if (diff.length) { console.error(`FREEZE MISMATCH (${diff.length}): ${diff.slice(0, 12).join(', ')}`); process.exit(5); }
  return frozen;
}

const port = () => createModelPort({ journalFile: path.join(LIVE, 'journal.sqlite'), allowedModels: [MODEL], maxBudgetUsdPerCall: DESIGN.workflow.maxCallUsd });
const W_SCRIPT = path.join(LIVE, 'build', 'solve.mjs'), W_RECORD = path.join(LIVE, 'build', 'construction.json');
/** §4.3: a build that delivered no solve.mjs is an outcome, not a fault: W then answers nothing on every task at $0. */
export const noArtifactArm = id => ({ id, def: { kind: 'no-artifact', model: MODEL }, stateful: false,
  async run() { return { output: null, costUsd: 0, error: { code: 'NO_ARTIFACT', message: 'the Haiku builder delivered no solve.mjs' } }; } });
function armsFor(modelPort) {
  const archiveRoot = path.join(LIVE, 'archive');
  const arms = [agentArm({ ...DESIGN.agent, archiveRoot }), swarmArm({ ...DESIGN.swarm, archiveRoot })];
  if (existsSync(W_RECORD)) {
    const rec = JSON.parse(readFileSync(W_RECORD, 'utf8'));
    if (!rec.artifact) arms.push(noArtifactArm('W-workflow-haiku'));
    else {
      // the solver run is the one the build recorded (its sha256), never an edited copy
      if (sha256(readFileSync(W_SCRIPT)) !== rec.artifactSha256) throw new Error('W solve.mjs differs from the build record');
      arms.push(workflowArm({ scriptPath: W_SCRIPT, modelPort, perTaskUsd: DESIGN.workflow.perTaskUsd, timeoutMs: DESIGN.workflow.timeoutMs, archiveRoot }));
    }
  }
  return arms;
}
const log = msg => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); appendFileSync(path.join(LIVE, 'run.log'), line + '\n'); };
// A trial is missing when an arm has no recorded row for a task (it faulted, or the process died).
const missingOf = (resultsFile, arms, tasks) => { const done = new Set(readJsonl(resultsFile).map(r => `${r.arm}|${r.taskKey}`)); return arms.flatMap(a => tasks.filter(t => !done.has(`${a.id}|${t.taskKey}`)).map(t => `${a.id}|${t.taskKey}`)); };

async function stageBuild() {
  const dir = path.join(LIVE, 'build');
  if (existsSync(path.join(dir, 'construction.json'))) { log('build: already done'); return 0; }
  if (spentSoFar() + DESIGN.build.builderBudgetUsd + DESIGN.build.constructionModelUsd > DESIGN.capUsd) { log('build: CAP'); return 4; }
  const { port: modelPort, policyHash } = port();
  modelPort.policyHash = policyHash;
  const res = await construct({ arm: 'B1', armId: 'W-workflow-haiku', familyId: FAMILY, probeSeeds: DESIGN.build.probeSeeds, difficulty: DIFFICULTY, builderModel: MODEL,
    builderEffort: DESIGN.build.builderEffort, builderBudgetUsd: DESIGN.build.builderBudgetUsd, constructionModelUsd: DESIGN.build.constructionModelUsd,
    perTaskUsd: DESIGN.workflow.perTaskUsd, minutes: DESIGN.build.minutes, scoreChecks: DESIGN.build.scoreChecks, modelPort, workRoot: path.join(LIVE, 'build-work'),
    label: 'w-haiku-r1', models: [MODEL] });
  mkdirSync(dir, { recursive: true });
  if (res.artifactPath) copyFileSync(res.artifactPath, W_SCRIPT);
  for (const f of ['BUILD-NOTES.md', '.executor-transcript.jsonl']) if (existsSync(path.join(res.workdir, f))) copyFileSync(path.join(res.workdir, f), path.join(dir, f.replace(/^\./, '')));
  const { kitDir, ...rec } = res.record;
  writeFileSync(path.join(dir, 'construction.json'), JSON.stringify(rec, null, 1));
  log(`build: artifact=${rec.artifact} sha=${rec.artifactSha256?.slice(0, 16)} cost=$${rec.constructionCostUsd.toFixed(4)} error=${rec.builderError?.code ?? '-'} scoreChecks used=${rec.scoreLog.length} firstPass=${rec.firstPassAtCheck}`);
  return 0;
}

async function runStage(stage, tasks, { blocks = 1 } = {}) {
  const { port: modelPort, policyHash } = port();
  modelPort.policyHash = policyHash;
  const arms = armsFor(modelPort);
  const dir = path.join(LIVE, stage); mkdirSync(dir, { recursive: true });
  const resultsFile = path.join(dir, 'results.jsonl');
  let maxBlock = 0;
  const blockCost = taskKey => readJsonl(resultsFile).filter(r => r.taskKey === taskKey).reduce((s, r) => s + (r.costUsd ?? 0), 0);
  for (const t of tasks) if (!missingOf(resultsFile, arms, [t]).length) maxBlock = Math.max(maxBlock, blockCost(t.taskKey));
  for (let i = 0; i < tasks.length;) {
    const todo = tasks.slice(i).filter(t => missingOf(resultsFile, arms, [t]).length).slice(0, blocks);
    if (!todo.length) break;
    // §6.3 runtime guard: a block starts only if the ledger can still pay for it at the largest block cost seen (or the
    // calibration's) with the margin.
    const per = Math.max(maxBlock, readCalibration()?.blockUsd ?? 0) * DESIGN.margin;
    const room = DESIGN.capUsd - spentSoFar();
    const fit = per > 0 ? Math.min(todo.length, Math.floor(room / per)) : todo.length;
    if (fit < 1) { log(`${stage}: CAP guard ($${room.toFixed(2)} left, block bound $${per.toFixed(2)}); stopping with complete blocks only`); return 4; }
    const batch = todo.slice(0, fit);
    log(`${stage}: block ${batch.map(t => t.taskKey).join(', ')} (spent $${spentSoFar().toFixed(3)})`);
    await runExperiment({ experiment: `swarm-r1-${stage}`, arms, tasks: batch, trials: 1, workRoot: path.join(LIVE, 'work'), resultsFile, concurrency: arms.length * batch.length,
      envFaultRule: true, strictResume: true, log });
    for (const t of batch) if (!missingOf(resultsFile, arms, [t]).length) maxBlock = Math.max(maxBlock, blockCost(t.taskKey));
    if (batch.some(t => missingOf(resultsFile, arms, [t]).length)) { log(`${stage}: trials left after an environment fault: ${missingOf(resultsFile, arms, batch).join(', ')}`); return 3; }
    i = tasks.indexOf(batch.at(-1)) + 1;
  }
  return missingOf(resultsFile, arms, tasks).length ? 3 : 0;
}
function readCalibration() {
  const f = path.join(LIVE, 'calibrate', 'results.jsonl');
  const rows = readJsonl(f);
  if (!rows.length) return null;
  const blockUsd = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  return { rows, blockUsd, arms: [...new Set(rows.map(r => r.arm))] };
}

async function main() {
  const cmd = process.argv[2];
  mkdirSync(LIVE, { recursive: true });
  if (cmd === 'freeze') { writeFileSync(FROZEN_FILE, JSON.stringify(await freezeRecord(), null, 1) + '\n'); console.log(`wrote ${FROZEN_FILE}`); return 0; }
  if (cmd === 'check') { await checkFrozen(); console.log('freeze OK'); return 0; }
  if (cmd === 'spent') { console.log(spentSoFar().toFixed(4)); return 0; }
  await checkFrozen();
  if (cmd === 'build') return stageBuild();
  if (cmd === 'calibrate') return runStage('calibrate', await makeTasks(FAMILY, { split: 'dev', seeds: DESIGN.calibrationSeeds, difficulty: DIFFICULTY }));
  if (cmd === 'heldout') {
    const cal = readCalibration();
    if (!cal || cal.arms.length < 3) { log('heldout: calibration incomplete (needs A, S and W rows)'); return 6; }
    const decided = path.join(LIVE, 'heldout', 'n.json');
    let n;
    if (existsSync(decided)) n = JSON.parse(readFileSync(decided, 'utf8')).n;
    else {
      n = heldoutN({ spent: spentSoFar(), blockUsd: cal.blockUsd });
      mkdirSync(path.dirname(decided), { recursive: true });
      writeFileSync(decided, JSON.stringify({ n, blockUsd: cal.blockUsd, spentAtDecision: spentSoFar(), at: new Date().toISOString() }, null, 1));
    }
    log(`heldout: N = ${n} (calibration block $${cal.blockUsd.toFixed(3)})`);
    if (n < DESIGN.nMin) { log(`heldout: N < ${DESIGN.nMin}: rule stop (§6.2), amendment needed`); return 6; }
    return runStage('heldout', await makeTasks(FAMILY, { split: 'test', seeds: DESIGN.heldoutSeeds.slice(0, n), difficulty: DIFFICULTY }), { blocks: DESIGN.blocksInParallel });
  }
  console.error('usage: run-r1.mjs freeze|check|spent|build|calibrate|heldout'); return 2;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
