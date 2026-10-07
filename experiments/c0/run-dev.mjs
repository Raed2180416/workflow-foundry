// C0 development round (research/construction-20261006/PREREG-dev.md). Resumable: constructions whose
// construction.json exists are reused; execution trials already in results.jsonl are skipped.
// Usage: node experiments/c0/run-dev.mjs [--families a,b] [--phase construct|execute|all] [--dry]
import path from 'node:path';
import { existsSync, readFileSync, mkdirSync, cpSync, appendFileSync } from 'node:fs';
import { construct } from './construct.mjs';
import { createModelPort } from '../lib/models.mjs';
import { makeTasks } from '../lib/beds.mjs';
import { runExperiment, armHash } from '../lib/runner.mjs';
import { foundryWorkflow } from '../lib/arms/foundry-workflow.mjs';
import { b1Script } from '../lib/arms/b1-script.mjs';
import { b0Agent } from '../lib/arms/b0-agent.mjs';

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const FAMILIES = arg('families', 'records,incident,codefix,synth,kinetics').split(',');
const PHASE = arg('phase', 'all'), DRY = process.argv.includes('--dry');
const MODELS = ['qwen3.5-4b-q4km', 'claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const OUT = path.resolve('experiments/runs/c0-dev'), WORK = '/var/tmp/foundry-work/c0-dev';
const ART = path.resolve('research/construction-20261006/artifacts');
mkdirSync(OUT, { recursive: true });
const { port } = createModelPort({ journalFile: path.join(OUT, 'journal.sqlite') });

async function constructionFor(arm, familyId) {
  const label = `${arm}-${familyId}-k1`, dir = path.join(WORK, 'construct', label);
  if (existsSync(path.join(dir, 'construction.json'))) return { record: JSON.parse(readFileSync(path.join(dir, 'construction.json'), 'utf8')), workdir: dir };
  if (DRY) return { record: { label, planned: true }, workdir: dir };
  const res = await construct({ arm, familyId, probeSeeds: [1, 2, 3], difficulty: 3, builderModel: 'claude-opus-5-5', builderBudgetUsd: 8,
    constructionModelUsd: 2, perTaskUsd: 1, minutes: 45, scoreChecks: 12, modelPort: port, workRoot: path.join(WORK, 'construct'), label, models: MODELS });
  appendFileSync(path.join(OUT, 'constructions.jsonl'), JSON.stringify(res.record) + '\n');
  const keep = path.join(ART, label); mkdirSync(keep, { recursive: true });
  for (const f of ['workflow.json', 'solve.mjs', 'BUILD-NOTES.md', 'construction.json']) if (existsSync(path.join(res.workdir, f))) cpSync(path.join(res.workdir, f), path.join(keep, f));
  return res;
}

if (PHASE !== 'execute') {
  // Constructions run 4 at a time (each is a long builder session).
  const jobs = FAMILIES.flatMap(f => ['F', 'B1'].map(a => [a, f]));
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) { const [a, f] = jobs[next++]; const r = await constructionFor(a, f); console.log('construction', a, f, JSON.stringify({ artifact: r.record.artifact, cost: r.record.constructionCostUsd, firstPassAtCheck: r.record.firstPassAtCheck })); } }));
}
if (PHASE !== 'construct') {
  for (const familyId of FAMILIES) {
    const arms = [];
    const F = await constructionFor('F', familyId), B1 = await constructionFor('B1', familyId);
    if (F.record.artifact === 'workflow.json') {
      const workflow = JSON.parse(readFileSync(path.join(F.workdir, 'workflow.json'), 'utf8'));
      arms.push(foundryWorkflow({ id: 'F', workflow, modelPort: port, maxCostUsd: 1 }));
    }
    if (B1.record.artifact === 'solve.mjs') arms.push(b1Script({ id: 'B1', scriptPath: path.join(B1.workdir, 'solve.mjs'), modelPort: port, perTaskUsd: 1 }));
    arms.push(b0Agent({ id: 'B0-opus', model: 'claude-opus-5-5', budgetUsd: 2, timeoutMs: 20 * 60 * 1000 }));
    arms.push(b0Agent({ id: 'B0-haiku', model: 'claude-haiku-4-5-20251001', budgetUsd: 1, timeoutMs: 20 * 60 * 1000 }));
    const tasks = await makeTasks(familyId, { split: 'test', seeds: [6001, 6002, 6003, 6004], difficulty: 3 });
    if (DRY) { console.log(familyId, arms.map(a => [a.id, armHash(a)]), tasks.map(t => t.taskHash.slice(0, 12))); continue; }
    await runExperiment({ experiment: `c0-dev-${familyId}`, arms, tasks, trials: 2, workRoot: path.join(WORK, 'exec'), resultsFile: path.join(OUT, 'results.jsonl'), concurrency: 3 });
  }
}
process.exit(0);
