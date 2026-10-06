import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TASK, INPUT_SCHEMA, MANIFEST_SCHEMA, RULES, PUBLIC_BUDGET } from './contract.mjs';
import { registryFactory } from './capabilities.mjs';
import { expectedFromObservations } from './oracle.mjs';
import { validateSuite } from '/home/raed/Projects/workflow-foundry/src/evaluation.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
assert.equal(existsSync(path.join(root, 'FREEZE.json')), false, 'An existing freeze is immutable');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const save = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
for (const split of ['development', 'sealed']) {
  const file = path.join(root, split, 'SUITE.json');
  const suite = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(suite.task, 'PUBLIC_TASK_PENDING');
  suite.task = TASK;
  writeFileSync(file, JSON.stringify(suite, null, 2) + '\n', { mode: 0o600 });
  validateSuite(suite);
  const truth = JSON.parse(readFileSync(path.join(root, split, 'TRUTH.json'), 'utf8'));
  for (const item of suite.cases) {
    assert.deepEqual(item.expect.artifacts[0].json, expectedFromObservations(item).manifest);
    const physical = truth.cases.find(entry => entry.caseId === item.id).physicalDefects;
    for (const { sampleId, disposition } of item.expect.artifacts[0].json.samples) {
      if (disposition === 'confirmed') assert.equal(physical[sampleId], true);
      if (disposition === 'not_reproduced') assert.equal(physical[sampleId], false);
    }
  }
}
const registry = registryFactory();
const publicContract = { schemaVersion: 'sample-consequence-public-v1', task: TASK,
  inputSchema: INPUT_SCHEMA, manifestSchema: MANIFEST_SCHEMA, rules: RULES,
  budget: PUBLIC_BUDGET, capabilities: registry.list(), registryHash: registry.hash(),
  publicDevelopmentSuite: 'development/SUITE.json',
  scope: 'Fixed source-informed synthetic task. This file contains contracts, not an example workflow or expected graph. Synthetic instrument costs are not provider prices.' };
assert.doesNotMatch(TASK, /\b(?:map|branch|verification)\b/i);
save(path.join(root, 'PUBLIC.json'), publicContract);
const local = ['contract.mjs','capabilities.mjs','oracle.mjs','freeze-public.mjs','PUBLIC.json','development/SUITE.json','development/TRUTH.json','sealed/SUITE.json','sealed/TRUTH.json'];
const nativeRoot = '/home/raed/Projects/workflow-foundry';
const native = ['src/runtime.mjs','src/evaluation.mjs','src/capabilities.mjs','src/data.mjs','src/store.mjs','src/validate.mjs','src/dataflow.mjs','src/engine.mjs','src/foundry.mjs','src/generator.mjs','src/trials.mjs','schemas/workflow.schema.json','package.json','package-lock.json'];
const files = [...local.map(file => path.join(root,file)), ...native.map(file => path.join(nativeRoot,file))].map(file => ({path:file,sha256:sha(file)}));
const freeze = {schemaVersion:'sample-consequence-freeze-v1', frozenAt:new Date().toISOString(),
  modelsCalledByEvaluatorAuthor:0, calibrationStatus:'UNVALIDATED_PENDING_SUPPLIED_AND_MUTANT_EXECUTION',
  constructionStatus:'No supplied workflow has been authored yet; exact evaluator, cases and contracts frozen first.',
  registryHash:registry.hash(), nodeVersion:process.version,
  nativeHead:execFileSync('git',['rev-parse','HEAD'],{cwd:nativeRoot,encoding:'utf8'}).trim(),
  disclosure:'Only PUBLIC.json and development suite may enter synthesis. Sealed suite and truth, supplied workflow, mutants and validation logs must stay out of provider context.',files};
save(path.join(root,'FREEZE.json'),freeze);
console.log(JSON.stringify({publicPath:path.join(root,'PUBLIC.json'),publicSha256:sha(path.join(root,'PUBLIC.json')),
  developmentPath:path.join(root,'development/SUITE.json'),developmentSha256:sha(path.join(root,'development/SUITE.json')),
  sealedPath:path.join(root,'sealed/SUITE.json'),sealedSha256:sha(path.join(root,'sealed/SUITE.json')),
  freezePath:path.join(root,'FREEZE.json'),freezeSha256:sha(path.join(root,'FREEZE.json')),
  registryHash:registry.hash(),calibrationStatus:freeze.calibrationStatus},null,2));
