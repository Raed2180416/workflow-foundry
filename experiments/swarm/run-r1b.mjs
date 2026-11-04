// Swarm ladder rung 1b (EXPLORATORY; PREREG-SWARM-R1.md Amendment 1, written after the rung-1 held-out stage showed the
// swarm lead never delegating): arm S-F is arm S with one change, a fan-out preamble that makes delegation mandatory. It
// asks the question rung 1 could not answer: when a Haiku swarm actually fans out on this bed, what happens?
//   node experiments/swarm/run-r1b.mjs check|run
// Runs on the first k rung-1 held-out tasks (k by the Amendment 1 rule), one trial each, under the same global $8 ledger
// (rung 1's spend counted). Live data: /var/tmp/foundry-work/swarm-r1b (the archive layout of rung 1, so analyze-r1.mjs
// reads it with { live }).
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment, faultsFileOf } from '../lib/runner.mjs';
import { runClaudeCode, readJsonFile, nestedModelUses } from '../../src/executors/claude-code.mjs';
import { solverView } from '../lib/beds.mjs';
import { messageUsageOf, taskHostPaths, repoPathMentions } from '../c0/construct.mjs';
import { outsidePaths, mentionedPaths } from '../lib/arms/b0-agent.mjs';
import { MODEL, SWARM_ENV, SWARM_TOOLS, SWARM_ARGS, LEAD_PREAMBLE, sha16, sessionFacts, archiveDirOf } from './arms.mjs';
import { DESIGN, FAMILY, DIFFICULTY, LIVE as LIVE_R1, spentSoFar } from './run-r1.mjs';

export const LIVE = process.env.SWARM_R1B_LIVE ?? '/var/tmp/foundry-work/swarm-r1b';
// The one change from arm S: a second paragraph that makes fan-out mandatory. Task-agnostic (no R6 word), so the lead
// still chooses the split; it may not do the work alone.
export const FANOUT_RULE = [
  'Delegation is required for this task: before you do any of the work yourself, split it into 4 to 8 independent parts',
  'and start one worker per part, all in the same message. Do not solve the task alone; your own work is the split, the',
  'merge, and resolving conflicts between workers.',
].join(' ');
export const PREAMBLE_F = LEAD_PREAMBLE + '\n\n' + FANOUT_RULE;
const instructions = schema => ['', '---', 'Inputs are in ./inputs.json (and ./files/ if present). Work autonomously; do not ask questions.',
  'Write your final answer to ./answer.json as JSON that matches this JSON Schema exactly:', '```json', JSON.stringify(schema, null, 1), '```'].join('\n');

/** Arm S-F: arm S (arms.mjs swarmArm) with PREAMBLE_F in place of LEAD_PREAMBLE; everything else identical. */
export function fanoutArm({ id = 'SF-swarm-fanout-haiku', budgetUsd, timeoutMs, archiveRoot = null, executor = runClaudeCode }) {
  const def = { kind: 'swarm-native-fanout', model: MODEL, budgetUsd, timeoutMs, tools: SWARM_TOOLS.join(','), env: SWARM_ENV, extraArgs: SWARM_ARGS, preambleSha: sha16(PREAMBLE_F) };
  return {
    id, def, stateful: false,
    async run(ctx) {
      const { task, outputSchema, workdir } = ctx;
      const view = solverView(task);
      const prompt = view.prompt + instructions(outputSchema) + '\n\n' + PREAMBLE_F;
      const r = await executor({ model: MODEL, prompt, workdir, files: view.files, budgetUsd, timeoutMs, tools: [...SWARM_TOOLS], env: { ...SWARM_ENV }, extraArgs: [...SWARM_ARGS] });
      const stated = taskHostPaths([view.prompt, view.files]);
      const outside = outsidePaths(r.toolUses, [workdir], { ignore: stated }), mentioned = mentionedPaths(r.toolUses, [workdir]);
      const repo = repoPathMentions(r.toolUses, { ignoreText: JSON.stringify([view.prompt, view.files]), counted: u => outsidePaths([u], [workdir], { ignore: stated }).attempts > 0 });
      const archive = archiveRoot ? archiveDirOf(archiveRoot, id, ctx.taskKey, ctx.trial) : null;
      let facts; try { facts = sessionFacts({ workdir, archive }); } catch (error) { facts = { factsError: String(error.message ?? error).slice(0, 300) }; }
      return { output: readJsonFile(workdir, 'answer.json'), costUsd: r.costUsd ?? r.costUpperUsd, costUnknown: r.costUnknown, latencyMs: r.durationMs, error: r.error,
        meta: { turns: r.turns, tools: r.toolUses.length, costUnknown: r.costUnknown, costUpperUsd: r.costUpperUsd, streamUsage: r.streamUsage, finalUsage: r.usage ?? null,
          nestedModelAttempts: nestedModelUses(r.toolUses), sessionId: r.sessionId, messageUsage: r.transcript ? messageUsageOf(r.transcript) : null,
          hiddenPathAttempts: outside.attempts, outsidePaths: outside.paths.slice(0, 20), pathMentions: mentioned.attempts, repoPathMentions: repo.attempts, ...facts } };
    },
  };
}

const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
/** Spend of rung 1b (recorded and faulted trials). */
export function spent1b(live = LIVE) {
  const f = path.join(live, 'heldout', 'results.jsonl');
  return [...readJsonl(f), ...readJsonl(faultsFileOf(f))].reduce((s, r) => s + (r.costUsd ?? 0) + (r.imputedUsd ?? 0), 0);
}
/** Amendment 1 rule: k = min(4, the number of complete rung-1 held-out blocks, ⌊(8.00 − spent − 0.20) / (1.25 × S's
 *  largest held-out cost)⌋); seeds are the first k complete rung-1 held-out seeds in order. */
export function kOf({ spent, sMaxUsd, complete }) {
  return Math.max(0, Math.min(4, complete, Math.floor((DESIGN.capUsd - spent - 0.20) / (1.25 * sMaxUsd))));
}

async function main() {
  const cmd = process.argv[2];
  const amendment = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../research/swarm-20261021/PREREG-SWARM-R1.md');
  if (!/## Amendments[\s\S]*Amendment 1/.test(readFileSync(amendment, 'utf8'))) { console.error('Amendment 1 is not written'); return 5; }
  const r1 = readJsonl(path.join(LIVE_R1, 'heldout', 'results.jsonl'));
  const seeds = [...new Set(r1.map(r => Number(r.taskKey.split(':s')[1])))].sort((a, b) => a - b).filter(s => ['A-agent-haiku', 'S-swarm-haiku', 'W-workflow-haiku'].every(a => r1.some(r => r.arm === a && r.taskKey.endsWith(`:s${s}`))));
  const sMax = Math.max(...r1.filter(r => r.arm === 'S-swarm-haiku').map(r => r.costUsd ?? 0));
  const spent = spentSoFar(LIVE_R1) + spent1b();
  const decided = path.join(LIVE, 'k.json');
  mkdirSync(LIVE, { recursive: true });
  let k;
  if (existsSync(decided)) k = JSON.parse(readFileSync(decided, 'utf8')).k;
  else { k = kOf({ spent, sMaxUsd: sMax, complete: seeds.length }); writeFileSync(decided, JSON.stringify({ k, seeds: seeds.slice(0, k), sMaxUsd: sMax, spentAtDecision: spent, at: new Date().toISOString() }, null, 1)); }
  console.log(`rung 1b: k = ${k} (spent $${spent.toFixed(3)}, S max $${sMax.toFixed(3)}, seeds ${seeds.slice(0, k).join(', ')})`);
  if (cmd === 'check') return 0;
  if (cmd !== 'run') { console.error('usage: run-r1b.mjs check|run'); return 2; }
  if (k < 1) return 4;
  const tasks = await makeTasks(FAMILY, { split: 'test', seeds: seeds.slice(0, k), difficulty: DIFFICULTY });
  const arm = fanoutArm({ ...DESIGN.swarm, archiveRoot: path.join(LIVE, 'archive') });
  const log = msg => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); appendFileSync(path.join(LIVE, 'run.log'), line + '\n'); };
  await runExperiment({ experiment: 'swarm-r1b-heldout', arms: [arm], tasks, trials: 1, workRoot: path.join(LIVE, 'work'), resultsFile: path.join(LIVE, 'heldout', 'results.jsonl'),
    concurrency: 2, envFaultRule: true, strictResume: true, log });
  log(`rung 1b done; spent overall $${(spentSoFar(LIVE_R1) + spent1b()).toFixed(3)}`);
  const done = new Set(readJsonl(path.join(LIVE, 'heldout', 'results.jsonl')).map(r => r.taskKey));
  return tasks.every(t => done.has(t.taskKey)) ? 0 : 3;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
