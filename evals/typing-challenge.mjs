#!/usr/bin/env node
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashBytes } from './evidence.mjs';
import { inspectIncident } from './incident-oracle.mjs';
import { runDirectory } from './opencode-harness.mjs';

const [pairID, ...runIDs] = process.argv.slice(2);
if (!runIDs.length) throw Error('Usage: typing-challenge.mjs PAIR RUN...');
const pair = runDirectory(pairID), pairManifest = JSON.parse(readFileSync(path.join(pair, 'pair.json'), 'utf8'));
const load = relative => import(pathToFileURL(path.join(pair, 'frozen', relative)).href);
const [{ Store }, { Runtime }, { createDefaultRegistry }, { validateWorkflow }] = await Promise.all(['src/store.mjs', 'src/runtime.mjs', 'src/capabilities.mjs', 'src/validate.mjs'].map(load));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (hashBytes(readFileSync(path.join(root, 'evals/incident-oracle.mjs'))) !== pairManifest.sourceHashes['evals/incident-oracle.mjs']) throw Error('Oracle changed after pair freeze.');
const json = value => JSON.stringify(value, null, 2) + '\n';
const invalidValues = [null, 0, 1, 'false', 'true', [], {}];
const fields = [['metrics', 'cpuSaturated'], ['deployment', 'recentChange'], ['logs', 'crashLoop']];
const cases = fields.flatMap(([probe, field]) => invalidValues.map((value, index) => {
  const observations = { metrics: { cpuSaturated: true }, deployment: { recentChange: true }, logs: { crashLoop: false } };
  observations[probe][field] = value;
  return {
    id: `type-${probe}-${index}`, split: 'diagnostic-post-correction', requiredOutcome: 'fail-closed',
    fixture: { healthy: false, observations, correctAction: probe === 'deployment' ? 'scale' : 'rollback' },
    invalidField: `${probe}.${field}`, invalidValue: value,
  };
}));

for (const runID of runIDs) {
  if (![pairManifest.baselineID, pairManifest.foundryID].includes(runID)) throw Error('Run does not belong to the named pair.');
  const runDir = runDirectory(runID), challenge = path.join(runDir, 'typing-challenge');
  if (existsSync(challenge)) throw Error('Preserve the existing challenge result.');
  const scoreFile = existsSync(path.join(runDir, 'construction-execution-v2.json')) ? 'construction-execution-v2.json' : 'construction-execution.json';
  const scored = JSON.parse(readFileSync(path.join(runDir, scoreFile), 'utf8'));
  if (!scored.constructionPassed) throw Error('A model-provenanced valid candidate is required for this execution challenge.');
  const bytes = readFileSync(path.join(runDir, 'workspace/output.json'));
  if (hashBytes(bytes) !== scored.evidence.outputSHA256) throw Error('Generated output changed since the primary score.');
  const workflow = JSON.parse(bytes), registry = createDefaultRegistry();
  if (!validateWorkflow(workflow, { registry }).valid) throw Error('Frozen runtime cannot validate this candidate.');
  process.umask(0o077);
  mkdirSync(challenge, { mode: 0o700 });
  writeFileSync(path.join(challenge, 'cases.json'), json(cases), { mode: 0o600 });
  const receipt = { at: new Date().toISOString(), taskClass: 'Wrong-type booleans required by the existing task contract', split: 'diagnostic-post-correction', casesSHA256: hashBytes(json(cases)), outputSHA256: hashBytes(bytes), independentHeldout: false };
  writeFileSync(path.join(challenge, 'freeze.json'), json(receipt), { mode: 0o600 });
  const outcomes = [];
  for (const taskCase of cases) {
    const workspace = path.join(challenge, taskCase.id), store = new Store(workspace);
    try {
      let expectedHash = null;
      if (workflow.version > 1) {
        const prior = JSON.parse(readFileSync(path.join(runDir, 'workspace/inputs/prior-candidate.json'), 'utf8'));
        if (!prior || prior.id !== workflow.id || prior.version + 1 !== workflow.version) throw Error('Missing exact workflow revision history.');
        expectedHash = store.saveWorkflow(prior).hash;
      }
      store.saveWorkflow(workflow, { expectedHash });
      const runtime = new Runtime(store, registry, pairManifest.executePolicy);
      const instance = runtime.create(workflow, {}, { fixture: taskCase.fixture });
      const state = await runtime.execute(instance.id), world = store.fixture(instance.id), events = store.events(instance.id);
      const verdict = inspectIncident({ taskCase, run: state, world, events });
      outcomes.push({ ...verdict, invalidField: taskCase.invalidField, invalidValue: taskCase.invalidValue });
      writeFileSync(path.join(workspace, 'evidence.json'), json({ run: state, world, events, verdict }), { mode: 0o600 });
    } finally { store.close(); }
  }
  const report = { runID, ...receipt, oracleSourceSHA256: pairManifest.sourceHashes['evals/incident-oracle.mjs'], passed: outcomes.filter(item => item.passed).length, total: outcomes.length, falseSuccesses: outcomes.filter(item => !item.passed && item.runStatus === 'succeeded').length, outcomes };
  writeFileSync(path.join(challenge, 'report.json'), json(report), { mode: 0o600 });
  console.log(json({ runID, passed: report.passed, total: report.total, falseSuccesses: report.falseSuccesses, casesSHA256: receipt.casesSHA256, examples: outcomes.filter(item => !item.passed).slice(0, 3) }));
}
