import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateWorkflow } from '/home/raed/Projects/workflow-foundry/src/validate.mjs';
import { registryFactory } from './capabilities.mjs';
import { aggregate, evaluateCandidate, loadSuite, verifyFreeze } from './oracle.mjs';
import { suppliedWorkflow, renamedEquivalent, MUTANTS } from './supplied.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
verifyFreeze();
const out = path.join(root, process.argv[2] ?? 'calibration-001');
assert.ok(out.startsWith(`${root}${path.sep}`));
mkdirSync(out, { mode: 0o700 });
const save = (name, value) => writeFileSync(path.join(out,name), JSON.stringify(value,null,2)+'\n', { flag:'wx',mode:0o600 });
const candidates = [['positive', suppliedWorkflow()], ['equivalent', renamedEquivalent()], ...MUTANTS.map(name => [name,suppliedWorkflow(name)])];
const sourceHashes = ['supplied.mjs','calibrate.mjs'].map(name => ({path:name,sha256:createHash('sha256').update(readFileSync(path.join(root,name))).digest('hex')}));
save('CONTROL_FREEZE.json',{frozenAt:new Date().toISOString(),sourceHashes, modelsCalled:0,
  controls:candidates.map(([name,workflow])=>({name,sha256:createHash('sha256').update(JSON.stringify(workflow)).digest('hex')}))});
const matrix=[];
for (const [name, workflow] of candidates) {
  save(`${name}.json`,workflow);
  const shape=validateWorkflow(workflow,{registry:registryFactory()});
  save(`${name}-validation.json`,shape);
  assert.equal(shape.valid,true,`${name} must be an executable valid graph: ${JSON.stringify(shape.errors)}`);
  const row={name,supplied:true,graphValid:shape.valid};
  for (const split of ['development','sealed']) {
    const report=await evaluateCandidate(workflow,loadSuite(split),{directory:path.join(out,`${name}-${split}`)});
    row[split]=aggregate(report);
  }
  matrix.push(row);
  save(`${name}-aggregate.json`,row);
  console.log(JSON.stringify({name,developmentPass:row.development.passed,sealedPass:row.sealed.passed,
    developmentCasesPassed:row.development.metrics.passedCount,sealedCasesPassed:row.sealed.metrics.passedCount}));
}
const positive=matrix.filter(row=>['positive','equivalent'].includes(row.name));
const mutants=matrix.filter(row=>MUTANTS.includes(row.name));
const audit={schemaVersion:'sample-consequence-calibration-v1',createdAt:new Date().toISOString(),modelsCalled:0,
  positiveControlsPass:positive.every(row=>row.development.passed && row.sealed.passed),
  allMutantsRejected:mutants.every(row=>!row.development.passed && !row.sealed.passed),
  matrix, limitations:['Evaluator-author supplied control graphs.','Fixed scenarios, not a population.','Sealed cases are provider-hidden only if generation remains restricted to PUBLIC and development.']};
audit.passed=audit.positiveControlsPass && audit.allMutantsRejected;
save('AUDIT.json',audit);
assert.equal(audit.passed,true,'Calibration failed; preserve this entire directory');
console.log(JSON.stringify({calibrationPath:out,passed:audit.passed,positiveControls:positive.length,mutantsRejected:mutants.length}));
