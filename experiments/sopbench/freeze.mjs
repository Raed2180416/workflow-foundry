#!/usr/bin/env node
// SOP-Bench phase 2: write the freeze file (research/sopbench-20261021/DESIGN.md §4, §7) from finished build runs. It copies
// each SOP's best workflow to experiments/sopbench/frozen/<id>/<sop>/ (committed with the freeze) and records: the split
// and the sealed row lists, every workflow's sha256, the sha256 of the code a sealed run depends on, the builder and repair
// prompt templates, both arms' settings and budgets, k, the decision rule and the run cap. The bridge and both runners refuse
// sealed rows unless this file names the split; sealed.mjs also refuses if any frozen sha256 no longer matches.
//
//   node experiments/sopbench/freeze.mjs --id p2 --builds p2-pilot,p2-main --sops a,b,... --cap 40 [--agent-model <policy id>]
//     [--v1-build <run>] [--v2-build <run> --v2-sops a,b,c --v2-rows 40]   (distractor-ablation workflows, built on dev rows too)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { WORK_ROOT } from '../../src/executors/claude-code.mjs';
import { HERE, REPO, RESEARCH, readJson, sha256, shuffled, writeJson } from './lib.mjs';
import { loadSplit } from './split.mjs';
import { BUILD_PROMPT, REPAIR_PROMPT } from './build.mjs';
import { W_DEFAULTS, artifactFiles, artifactSha256 } from './exec.mjs';
import { DEFAULTS as A_DEFAULTS } from './run.mjs';
import { codeHashes } from './sealed.mjs';

export const DECISION_RULE = Object.freeze({
  metric: 'strict pass^k per sealed row (all k runs pass the strict grader); per SOP the mean over its sealed rows; headline the macro mean over the frozen SOPs',
  k: 3,
  uncertainty: 'bootstrap over rows within SOPs, 10,000 resamples, seed "sopbench-p2-bootstrap"; W - A paired on the rows both arms completed',
  reliabilityClaim: 'W macro strict pass^3 >= 0.90 AND its 95% lower bound >= 0.85, both with and without the orchestration-only SOPs',
  beatsAgent: 'W - A macro strict pass^3 >= +0.05 AND the paired 95% interval excludes 0',
  cost: 'W amortised cost per sealed run ((build + repair + sealed-run judge spend) / W runs) below A mean cost per run',
  otherwise: 'the claim is not supported; numbers, per-SOP table and failure anatomy are reported as a negative result',
  upstreamMetric: 'reported beside every strict number as context, never as the headline',
  faults: 'environment faults (rate or usage limits, sandbox unavailable) stop the run and are never scored; a deopt, crash or timeout of a workflow and an L5 violation of an agent session are fails',
});

const readRecords = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/** The latest build record per SOP across build runs (a later run in the list wins). */
function latestBuilds(builds) {
  const recs = {};
  for (const run of builds) for (const r of readRecords(path.join(WORK_ROOT, 'sopbench', run, 'builds.jsonl'))) recs[r.sop] = { ...r, run };
  return recs;
}
/** Copy a build record's best workflow under the frozen root and describe it. */
function freezeArtifact(rec, dir) {
  cpSync(rec.artifactDir, dir, { recursive: true });
  const files = artifactFiles(dir);
  if (artifactSha256(files) !== rec.artifactSha256) throw new Error(`${rec.sop}: copied artifact does not match its build record`);
  return { dir: path.relative(REPO, dir), sha256: rec.artifactSha256, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256(v)])), buildRun: rec.run, bestRound: rec.bestRound,
    devPass: rec.devPass, devRows: rec.devRows, buildCostUsd: rec.costUsd };
}

/**
 * Ablation cells (DESIGN.md §8): V1-minimal (video_annotation without its 20 stub tools, all sealed rows; its comparison is the
 * primary run, which serves the shipped bloated registry) and V2-bloated (3 SOPs with 20 generated distractors each, on a
 * seeded 40-row subsample of their sealed rows; its comparison is the primary run on the same rows).
 */
export function ablationCells({ id, v1Build, v2Build, v2Sops, v2Rows = 40, split }) {
  const cells = [];
  const root = path.join(REPO, 'experiments/sopbench/frozen', id, 'ablation');
  const catalogOf = (sop, kind) => { const f = path.join(HERE, 'ablation', `${sop}-${kind}.json`); return { file: path.relative(REPO, f), sha256: sha256(readFileSync(f)) }; };
  if (v1Build) {
    const r = latestBuilds([v1Build]).video_annotation;
    if (!r?.artifactDir) throw new Error('V1: no video_annotation workflow in ' + v1Build);
    cells.push({ id: 'V1-minimal', compareWith: 'primary (the shipped catalog: 6 real + 20 stub tools)', sops: ['video_annotation'], catalogs: { video_annotation: catalogOf('video_annotation', 'minimal') },
      artifacts: { video_annotation: freezeArtifact(r, path.join(root, 'V1-minimal', 'video_annotation')) },
      rows: { video_annotation: { sealed: split.sops.video_annotation.sealed, sealedSha256: split.sops.video_annotation.sealedSha256 } } });
  }
  if (v2Build) {
    const recs = latestBuilds([v2Build]);
    const artifacts = {}, rows = {}, catalogs = {};
    for (const s of v2Sops) {
      if (!recs[s]?.artifactDir) throw new Error(`V2: no ${s} workflow in ${v2Build}`);
      artifacts[s] = freezeArtifact(recs[s], path.join(root, 'V2-bloated', s));
      catalogs[s] = catalogOf(s, 'bloated');
      const pick = shuffled(split.sops[s].sealed, `sopbench-p2-ablation-v2:${s}`).slice(0, v2Rows).sort((a, b) => a - b);
      rows[s] = { sealed: pick, subsampleOf: split.sops[s].sealedSha256, seed: `sopbench-p2-ablation-v2:${s}` };
    }
    cells.push({ id: 'V2-bloated', compareWith: 'primary on the same rows (the original catalog)', sops: v2Sops, catalogs, artifacts, rows });
  }
  return cells;
}

export function makeFreeze({ id, builds, sops, capUsd, agentModel = 'claude-haiku-5-5', ablation = null, split = loadSplit() }) {
  // The latest record per SOP across the given build runs (a later run in the list wins).
  const recs = latestBuilds(builds);
  const missing = sops.filter(s => !recs[s] || recs[s].failedBuild || !recs[s].artifactDir);
  const frozenRoot = path.join(REPO, 'experiments/sopbench/frozen', id);
  rmSync(frozenRoot, { recursive: true, force: true });
  const artifacts = {}, dev = {};
  for (const s of sops) {
    if (!recs[s] || recs[s].failedBuild || !recs[s].artifactDir) continue;   // a SOP without a workflow: every W run of it is a fail
    artifacts[s] = freezeArtifact(recs[s], path.join(frozenRoot, s));
    dev[s] = { devPass: recs[s].devPass, devRows: recs[s].devRows, buildPass: recs[s].buildPass, repairPass: recs[s].repairPass, buildCostUsd: recs[s].costUsd };
  }
  const builderModels = [...new Set(sops.map(s => recs[s]?.builderModel).filter(Boolean))], judgeModels = [...new Set(sops.flatMap(s => recs[s]?.judgeModels ?? []))];
  const buildCostUsd = sops.reduce((a, s) => a + (recs[s]?.costUsd ?? 0), 0);
  const freeze = {
    kind: 'sopbench-freeze', version: 1, id, createdAt: new Date().toISOString(),
    note: 'Freeze for the SOP-Bench phase-2 sealed run (research/sopbench-20261021/DESIGN.md). Commit before any sealed row is touched.',
    splitSha256: split.splitSha256, sops, withoutWorkflow: missing,
    rows: Object.fromEntries(sops.map(s => [s, { n: split.sops[s].sealed.length, sealedSha256: split.sops[s].sealedSha256, sealed: split.sops[s].sealed }])),
    k: DECISION_RULE.k,
    arms: {
      W: { builderModels, judgeModels, buildRuns: builds, maxSteps: W_DEFAULTS.maxSteps, budgetUsdPerRun: W_DEFAULTS.budgetUsd, timeoutMs: W_DEFAULTS.timeoutMs, buildCostUsd,
        sandbox: 'runSandboxed, network off; tools via the bridge mailbox; judges via the gateway unix socket' },
      A: { model: agentModel, budgetUsd: A_DEFAULTS.budgetUsd, maxSteps: A_DEFAULTS.maxSteps, timeoutMin: A_DEFAULTS.timeoutMin, effort: null, tools: A_DEFAULTS.tools,
        prompt: 'run.mjs systemPrompt + userPrompt (unchanged from the phase-1 dev baseline)' },
    },
    artifacts, devResults: dev, orchestrationOnly: ['aircraft_inspection'],
    prompts: { buildTemplateSha256: sha256(BUILD_PROMPT.toString()), repairTemplateSha256: sha256(REPAIR_PROMPT.toString()) },
    code: codeHashes(),
    decisionRule: DECISION_RULE,
    caps: { sealedRunCapUsd: capUsd, phase2CapUsd: 100 },
    ablation: ablation ? { design: 'DESIGN.md §8', cells: ablationCells({ id, split, ...ablation }) } : null,
  };
  return freeze;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), a = {};
  for (let i = 0; i < argv.length; i++) a[argv[i].slice(2)] = argv[++i];
  const ablation = a['v1-build'] || a['v2-build'] ? { v1Build: a['v1-build'], v2Build: a['v2-build'], v2Sops: (a['v2-sops'] ?? 'dangerous_goods,customer_service,know_your_business').split(','), v2Rows: Number(a['v2-rows'] ?? 40) } : null;
  const f = makeFreeze({ id: a.id, builds: a.builds.split(','), sops: a.sops.split(','), capUsd: Number(a.cap), agentModel: a['agent-model'] ?? 'claude-haiku-5-5', ablation });
  const out = path.join(RESEARCH, `FREEZE-${a.id}.json`);
  if (existsSync(out)) throw new Error(`${out} exists: a freeze is written once`);
  writeJson(out, f);
  console.log(JSON.stringify({ out: path.relative(REPO, out), sops: f.sops.length, withoutWorkflow: f.withoutWorkflow, artifacts: Object.fromEntries(Object.entries(f.artifacts).map(([s, x]) => [s, x.sha256.slice(0, 16)])) }, null, 1));
}
