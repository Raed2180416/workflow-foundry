#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from './evidence.mjs';
import { runDirectory } from './opencode-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [parentID, pairID, baselineID, foundryID] = process.argv.slice(2);
const parent = runDirectory(parentID), pair = runDirectory(pairID);
if (existsSync(pair)) throw Error('Correction pair already exists.');
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
const json = value => JSON.stringify(value, null, 2) + '\n';
const write = (file, value) => { writeFileSync(file, value, { mode: 0o600 }); chmodSync(file, 0o600); };
const source = readJSON(path.join(parent, 'pair.json'));
const comparison = readJSON(path.join(parent, 'comparison.json'));
if (!comparison.comparable) throw Error('Resolve the original comparison controls before correction.');
process.umask(0o077);
mkdirSync(pair, { mode: 0o700 });
cpSync(path.join(parent, 'frozen'), path.join(pair, 'frozen'), { recursive: true });
for (const file of ['capabilities.json', 'skill-context.md', 'cases.json', 'execution-dependencies.json']) copyFileSync(path.join(parent, file), path.join(pair, file));
const pairManifest = { ...source, id: pairID, createdAt: new Date().toISOString(), status: 'frozen-before-generation', parentPair: parentID, correctionRound: 1, baselineID: undefined, foundryID: undefined };
write(path.join(pair, 'pair.json'), json(pairManifest));
const staged = spawnSync(process.execPath, [path.join(root, 'evals/compare-incident.mjs'), 'stage', pairID, baselineID, foundryID], { cwd: root, encoding: 'utf8', timeout: 45000 });
if (staged.error || staged.status !== 0) throw Error(staged.error?.message ?? staged.stderr);
const feedback = {
  phase: 'single diagnostic correction', taskUnchanged: true, sameFeedbackForBothArms: true,
  observations: comparison.results.map(result => ({
    arm: result.arm, constructionPassed: result.constructionPassed,
    constructionErrors: result.evidence.errors, schemaErrors: result.schema?.errors ?? [],
    failedCases: result.outcomes.filter(item => !item.passed).map(item => ({
      caseId: item.caseId, errors: item.errors, runStatus: item.runStatus, actions: item.actions, simulatorHealthy: item.simulatorHealthy,
    })),
  })),
  failingInputEvidence: { deployment: { recentChange: true }, metrics: {}, logs: { crashLoop: false } },
  expectedForFailingInput: 'No remediation and no successful recovery, because a required boolean is absent.',
  observedForFailingInput: 'A rollback effect occurred even though the run later failed. Final failure alone does not undo that effect.',
  correctionBudget: { wallSeconds: 240, operatorFeedbackMessages: 1 },
  instruction: 'Use the unchanged task contract. Your own previous candidate is supplied when it exists; otherwise construct one now. Write a complete candidate to output.json. No evaluator or runtime tools are available in this TUI turn; do not claim new execution results.',
};
write(path.join(pair, 'feedback.json'), json(feedback));
const correctionPrompt = 'Read /task/inputs/task.md, /task/inputs/IR-GUIDE.md, /task/inputs/workflow.schema.json, /task/inputs/capabilities.json, /task/inputs/skill-context.md, /task/inputs/feedback.json and /task/inputs/prior-candidate.json. This is the one allowed diagnostic correction turn. Apply the unchanged task contract and supplied independent oracle feedback. Your own prior candidate is supplied when available; null means the earlier turn produced no candidate. Write a complete candidate JSON to /task/output.json using the file tool. Do not claim execution or validation occurred during this turn.\n';
for (const [oldID, newID] of [[source.baselineID, baselineID], [source.foundryID, foundryID]]) {
  const oldRun = runDirectory(oldID), newRun = runDirectory(newID), inputs = path.join(newRun, 'workspace/inputs');
  const candidate = path.join(oldRun, 'workspace/output.json');
  write(path.join(inputs, 'prior-candidate.json'), existsSync(candidate) ? readFileSync(candidate) : 'null\n');
  write(path.join(inputs, 'feedback.json'), json(feedback));
  write(path.join(newRun, 'prompt.txt'), correctionPrompt);
  const manifest = readJSON(path.join(newRun, 'manifest.json'));
  Object.assign(manifest, { parentRun: oldID, correctionRound: 1, feedbackSHA256: hashBytes(json(feedback)), priorCandidateSHA256: hashBytes(readFileSync(path.join(inputs, 'prior-candidate.json'))) });
  manifest.inputFiles['prior-candidate.json'] = manifest.priorCandidateSHA256;
  manifest.inputFiles['feedback.json'] = manifest.feedbackSHA256;
  manifest.operatorInterventions.push({ actor: 'worker-5 evaluator agent', at: new Date().toISOString(), type: 'diagnostic-feedback', exactContentFile: 'inputs/feedback.json', sha256: manifest.feedbackSHA256, manuallyEditedCandidate: false, contextReset: 'Fresh TUI session, same skill arm, task docs, common feedback and own prior candidate only.' });
  write(path.join(newRun, 'manifest.json'), json(manifest));
}
const finalPair = readJSON(path.join(pair, 'pair.json'));
Object.assign(finalPair, { feedbackSHA256: hashBytes(json(feedback)), correctionPromptSHA256: hashBytes(correctionPrompt), priorCandidateContext: 'Each arm receives its own exact prior candidate, or null; raw candidates were not repaired by the operator.' });
write(path.join(pair, 'pair.json'), json(finalPair));
console.log(json({ pair: pairID, baselineID, foundryID, feedbackSHA256: finalPair.feedbackSHA256, samePromptSHA256: finalPair.correctionPromptSHA256 }));
