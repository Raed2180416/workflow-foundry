// Follow-up to a source-review finding. Execute an existing canned workflow
// unchanged in a new local workspace. No model or external effect is invoked.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Foundry } from '../../workflow-foundry/src/foundry.mjs';
import { composeObjectiveCandidate, compareObjectiveCloseness } from '../../workflow-foundry/src/construction.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../workflow-foundry');
const first = JSON.parse(readFileSync(path.join(here, 'counterexample-run-1/RESULTS.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
function unchanged() {
  return Object.entries(first.sourceSha256).every(([name, expected]) =>
    hash(readFileSync(path.join(root, name))) === expected);
}
assert.equal(unchanged(), true, 'Source differs from the earlier diagnostic receipt');
const out = path.resolve(process.argv[2] ?? path.join(here, 'branch-runtime-run-1'));
mkdirSync(out, { recursive: false });
const candidate = composeObjectiveCandidate('HTTP fetch then branch on error with a separate error path', { objectiveId: 'ObjHttpBranch' });
const comparison = compareObjectiveCloseness(candidate, 'ObjHttpBranch');
const foundry = new Foundry(path.join(out, 'workspace'));
let trace;
try {
  const saved = foundry.save(candidate.workflow);
  const run = foundry.createRun(saved.hash, {});
  await foundry.startRun(run.id);
  trace = foundry.inspectRun(run.id);
  writeFileSync(path.join(out, 'TRACE.json'), JSON.stringify(trace, null, 2), { flag: 'wx' });
  writeFileSync(path.join(out, 'CANDIDATE.json'), JSON.stringify(candidate, null, 2), { flag: 'wx' });
  writeFileSync(path.join(out, 'COMPARISON.json'), JSON.stringify(comparison, null, 2), { flag: 'wx' });
} finally { await foundry.close(); }
const report = {
  checkedAt: new Date().toISOString(), scope: 'source-informed development witness, not held-out evaluation',
  scriptSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  inheritedSourceReceipt: '../counterexample-run-1/RESULTS.json',
  sourceUnchanged: unchanged(), comparisonClose: comparison.close,
  runtimeStatus: trace.status, independentTaskVerified: trace.independentTaskVerified,
  missingReferenceObserved: JSON.stringify(trace).includes('nodes.errPath.branch'),
  externalFetchOccurred: false, modelCalls: 0,
  explanation: 'The canned fetch returns a fixed success value. Its skipped error branch supplies no output, while the join references that output without a default. Structural closeness does not test this runtime consequence.',
};
writeFileSync(path.join(out, 'RESULTS.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
assert.equal(report.sourceUnchanged, true);
assert.equal(report.comparisonClose, true);
assert.equal(report.runtimeStatus, 'failed');
assert.equal(report.missingReferenceObserved, true);
console.log(JSON.stringify(report, null, 2));
