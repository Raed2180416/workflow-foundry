// C0 development round (research/construction-20261006/PREREG-dev.md). Two builder models (Opus 5.5 and Haiku 4.5),
// each building an F (Foundry workflow) and a B1 (script) artifact per family, plus each model solving the tasks
// directly (B0). Resumable: a construction whose construction.json exists is reused (if it is from this protocol
// version); a construction that met an environment fault is set aside and retried on resume; execution trials already
// in results.jsonl are skipped, faulted ones retried (PREREG §5).
// Usage: node experiments/c0/run-dev.mjs [--families a,b] [--builders opus,haiku] [--phase construct|execute|all] [--dry]
import path from 'node:path';
import { existsSync, readFileSync, mkdirSync, cpSync, appendFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { construct, BUILD_ENV_FAULTS } from './construct.mjs';
import { createModelPort } from '../lib/models.mjs';
import { makeTasks } from '../lib/beds.mjs';
import { kitHash, SCRIPT_KIT_ALLOW } from '../lib/kit.mjs';
import { runExperiment, armHash } from '../lib/runner.mjs';
import { foundryWorkflow } from '../lib/arms/foundry-workflow.mjs';
import { b1Script } from '../lib/arms/b1-script.mjs';
import { b0Agent } from '../lib/arms/b0-agent.mjs';

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt);
const FAMILIES = arg('families', 'records,incident,codefix,synth,kinetics').split(',');
const PHASE = arg('phase', 'all'), DRY = process.argv.includes('--dry');
// Owner policy 2026-10-07: Haiku 4.5 is the deliberately weak model the system must make work; Sonnet 5.5 and
// Opus 5.5 are the stronger tiers. Local generative models (class S) are parked and unreachable (not in the subset).
// Owner policy 2026-10-07: Haiku 5.5 is the weak model (it replaced Haiku 4.5); local generative models are parked.
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
// Builder models. Effort xhigh for both: CLI 2.1.292 accepted --effort xhigh for Haiku 4.5 (probe 2026-10-07: success,
// extended thinking active). If a later CLI rejects it, the session ends without a result (EXECUTOR_PROTOCOL, an
// environment fault in construction-faults.jsonl) and is never retried silently at another effort: change it here
// and record an amendment.
const ALL_BUILDERS = {
  opus: { model: 'claude-opus-5-5', effort: 'xhigh', b0: { budgetUsd: 2 } },
  haiku: { model: 'claude-haiku-5-5', effort: 'xhigh', b0: { budgetUsd: 1 } },
};
const BUILDERS = arg('builders', 'opus,haiku').split(',').map(tag => { if (!ALL_BUILDERS[tag]) throw new Error(`unknown builder ${tag}`); return [tag, ALL_BUILDERS[tag]]; });
// Per-arm caps, identical for both builder models (PREREG §2).
const BUILDER_USD = 8, GATEWAY_USD = 2, MINUTES = 45, SCORE_CHECKS = 12, PER_TASK_USD = 1, EXEC_MS = 20 * 60 * 1000;
const SPEND_STOP_USD = 350, OVER_CAP = 1.2;   // PREREG §5 kill rules
const OUT = path.resolve('experiments/runs/c0-dev'), WORK = '/var/tmp/foundry-work/c0-dev';
const ART = path.resolve('research/construction-20261006/artifacts');
mkdirSync(OUT, { recursive: true });
// 16 CLI slots: four concurrent builders' gateway calls must not queue behind each other's (C0-21).
const { port, policyHash } = createModelPort({ journalFile: path.join(OUT, 'journal.sqlite'), allowedModels: MODELS, concurrency: { 'claude-cli': 16 } });
const KITS = { F: kitHash(), B1: kitHash({ allow: SCRIPT_KIT_ALLOW }) };

const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const SPEND_FILES = ['constructions.jsonl', 'construction-faults.jsonl', 'results.jsonl', 'results.faults.jsonl', 'probes.jsonl', 'probes.faults.jsonl'];
function kill(reason) {
  console.error(`KILL: ${reason}`);
  appendFileSync(path.join(OUT, 'kill.jsonl'), JSON.stringify({ reason, at: new Date().toISOString() }) + '\n');
  process.exit(3);
}
function checkKill(record = null) {   // PREREG §5
  if (record?.label && (record.gatewayCostUsd > OVER_CAP * GATEWAY_USD || record.builderCostUsd > OVER_CAP * BUILDER_USD)) kill(`${record.label} exceeded a cap by more than 20%`);
  const total = SPEND_FILES.flatMap(f => readJsonl(path.join(OUT, f))).reduce((s, r) => s + (r.constructionCostUsd ?? r.costUsd ?? 0), 0);
  if (total > SPEND_STOP_USD) kill(`total spend $${total.toFixed(2)} > $${SPEND_STOP_USD}`);
}

async function constructionFor(arm, [tag, builder], familyId) {
  const armId = `${arm}-${tag}`, label = `${armId}-${familyId}-k1`, dir = path.join(WORK, 'construct', label);
  if (existsSync(path.join(dir, 'construction.json'))) {
    const record = JSON.parse(readFileSync(path.join(dir, 'construction.json'), 'utf8'));
    // Resume reuses only a construction from this protocol version (same session policy, kit and builder).
    if (record.policyHash !== policyHash || record.kitHash !== KITS[arm] || record.builderModel !== builder.model || record.builderEffort !== builder.effort)
      throw Object.assign(new Error(`construction ${label} is from another protocol version (policy/kit/builder differ): move ${dir} aside first`), { code: 'STALE_CONSTRUCTION' });
    return { record, workdir: dir };
  }
  if (DRY) return { record: { label, armId, planned: true }, workdir: dir };
  const res = await construct({ arm, armId, familyId, probeSeeds: [1, 2, 3], difficulty: 3, builderModel: builder.model, builderEffort: builder.effort, builderBudgetUsd: BUILDER_USD,
    constructionModelUsd: GATEWAY_USD, perTaskUsd: PER_TASK_USD, minutes: MINUTES, scoreChecks: SCORE_CHECKS, modelPort: port, workRoot: path.join(WORK, 'construct'), label, models: MODELS });
  if (BUILD_ENV_FAULTS.has(res.record.builderError?.code)) {
    appendFileSync(path.join(OUT, 'construction-faults.jsonl'), JSON.stringify(res.record) + '\n');
    renameSync(dir, `${dir}.fault-${Date.now()}`); checkKill();
    throw Object.assign(new Error(`construction ${label}: environment fault ${res.record.builderError.code}; resume later`), { code: 'CONSTRUCTION_ENV_FAULT' });
  }
  appendFileSync(path.join(OUT, 'constructions.jsonl'), JSON.stringify(res.record) + '\n');
  const keep = path.join(ART, label); mkdirSync(keep, { recursive: true });
  for (const f of ['workflow.json', 'solve.mjs', 'BUILD-NOTES.md', 'construction.json']) if (existsSync(path.join(res.workdir, f))) cpSync(path.join(res.workdir, f), path.join(keep, f));
  checkKill(res.record);
  return res;
}

const noArtifact = (id, reason) => ({ id, def: { kind: 'no-artifact', reason }, stateful: false, run: async () => ({ output: null, costUsd: 0, error: { code: 'NO_ARTIFACT', message: reason } }) });
// The artifact executed is the pinned copy, and only if it still has the hash its construction recorded.
const pinned = (rec, name) => { const p = path.join(ART, rec.label, name); return rec.artifact === name && existsSync(p) && sha(p) === rec.artifactSha256 ? p : null; };
function constructedArm(arm, rec) {
  if (arm === 'F') {
    const p = pinned(rec, 'workflow.json');
    let workflow = null; try { workflow = p ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch {}
    return workflow ? foundryWorkflow({ id: rec.armId, workflow, modelPort: port, maxCostUsd: PER_TASK_USD, maxDurationMs: EXEC_MS })
      : noArtifact(rec.armId, p ? 'workflow.json is not JSON' : rec.artifact ? 'pinned artifact missing or changed' : 'no artifact delivered');
  }
  const p = pinned(rec, 'solve.mjs');
  return p ? b1Script({ id: rec.armId, scriptPath: p, modelPort: port, perTaskUsd: PER_TASK_USD, timeoutMs: EXEC_MS, allowedModels: MODELS })
    : noArtifact(rec.armId, rec.artifact ? 'pinned artifact missing or changed' : 'no artifact delivered');
}

if (DRY) {
  const fileHash = f => sha(path.resolve(f)).slice(0, 16);
  console.log(JSON.stringify({ models: MODELS, policyHash, builders: Object.fromEntries(BUILDERS), kits: KITS, caps: { BUILDER_USD, GATEWAY_USD, MINUTES, SCORE_CHECKS, PER_TASK_USD, EXEC_MS, SPEND_STOP_USD },
    frozen: { prompts: fileHash('experiments/c0/prompts.mjs'), construct: fileHash('experiments/c0/construct.mjs'), analyze: fileHash('experiments/c0/analyze.mjs'),
      runDev: fileHash('experiments/c0/run-dev.mjs'), microHarness: fileHash('skills/micro-harness/SKILL.md'), scriptHarness: fileHash('skills/script-harness/SKILL.md') } }, null, 1));
}
if (PHASE !== 'execute' && !DRY) {
  // Constructions run 4 at a time (each is a long builder session); one failing job never stops the others.
  const jobs = FAMILIES.flatMap(f => BUILDERS.flatMap(b => ['F', 'B1'].map(a => [a, b, f])));
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const [a, b, f] = jobs[next++];
      try { const r = await constructionFor(a, b, f); console.log('construction', r.record.label, JSON.stringify({ artifact: r.record.artifact, cost: r.record.constructionCostUsd, firstPassAtCheck: r.record.firstPassAtCheck, nested: r.record.nestedModelAttempts })); }
      catch (e) {
        if (e.code !== 'CONSTRUCTION_ENV_FAULT') appendFileSync(path.join(OUT, 'construction-faults.jsonl'), JSON.stringify({ arm: a, builder: b[0], familyId: f, error: { code: e.code ?? 'CONSTRUCT_THROW', message: String(e.message).slice(0, 500) }, at: new Date().toISOString() }) + '\n');
        console.log('construction FAULT', a, b[0], f, e.message);
      }
    }
  }));
}
if (PHASE !== 'construct') {
  for (const familyId of FAMILIES) {
    const recs = [];
    try { for (const b of BUILDERS) for (const a of ['F', 'B1']) recs.push([a, (await constructionFor(a, b, familyId)).record]); }
    catch (e) { console.log('skip', familyId, e.message); continue; }   // execution stays paired: all of a family's constructions or none
    const arms = [];
    for (const [a, rec] of recs) {
      if (rec.planned) { console.log(familyId, rec.armId, 'planned (not constructed yet)'); continue; }
      // Pre-registered: a nested model use in the builder transcript voids the construction (spend outside the ledgers).
      if (rec.nestedModelAttempts > 0) { appendFileSync(path.join(OUT, 'voided.jsonl'), JSON.stringify({ label: rec.label, armId: rec.armId, familyId, reason: 'nestedModelAttempts', count: rec.nestedModelAttempts, at: new Date().toISOString() }) + '\n'); console.log('VOID', rec.label); continue; }
      arms.push(constructedArm(a, rec));
    }
    for (const [tag, builder] of BUILDERS) arms.push(b0Agent({ id: `B0-${tag}`, model: builder.model, budgetUsd: builder.b0.budgetUsd, timeoutMs: EXEC_MS, effort: builder.effort }));
    const tasks = await makeTasks(familyId, { split: 'test', seeds: [6001, 6002, 6003, 6004], difficulty: 3 });
    if (DRY) { console.log(familyId, JSON.stringify(arms.map(a => [a.id, armHash(a)])), tasks.map(t => t.taskHash.slice(0, 12)).join(',')); continue; }
    const common = { workRoot: path.join(WORK, 'exec'), concurrency: 3, envFaultRule: true, strictResume: true, onRecord: () => checkKill() };
    // PREREG §3 construction success: the artifact on its probes, without harness fault.
    const probeTasks = await makeTasks(familyId, { split: 'dev', seeds: [1, 2, 3], difficulty: 3 });
    const built = arms.filter(a => !a.id.startsWith('B0-'));
    if (built.length) await runExperiment({ experiment: `c0-dev-probes-${familyId}`, arms: built, tasks: probeTasks, trials: 1, resultsFile: path.join(OUT, 'probes.jsonl'), ...common });
    await runExperiment({ experiment: `c0-dev-${familyId}`, arms, tasks, trials: 2, resultsFile: path.join(OUT, 'results.jsonl'), ...common });
    checkKill();
  }
}
process.exit(0);
