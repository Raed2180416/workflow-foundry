// Diagnostic counterexamples against the existing, unmodified Foundry source.
// These are source-informed development witnesses, NOT held-out evaluation.
// No model calls, installs, production capabilities, or edits to Foundry.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeObjectiveCandidate, extractRequirements, nodeKindsOf,
  OBJECTIVE_MOTIFS, OBJECTIVE_FAMILY_ID,
} from '../../workflow-foundry/src/construction-objective.mjs';
import { Foundry } from '../../workflow-foundry/src/foundry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../workflow-foundry');
const out = path.resolve(process.argv[2] ?? path.join(here, 'counterexample-run-1'));
mkdirSync(out, { recursive: false }); // Refuse to overwrite an earlier run.
const sha = value => createHash('sha256').update(value).digest('hex');
function fingerprint() {
  const files = [];
  function visit(relative) {
    for (const item of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.join(relative, item.name);
      if (item.isDirectory()) visit(name);
      else if (item.isFile()) files.push(name);
    }
  }
  visit('src'); visit('schemas');
  files.push('package.json', 'package-lock.json', 'bin/foundry.mjs', 'tests/construction-objective.test.mjs');
  return Object.fromEntries(files.sort().map(name => [name, sha(readFileSync(path.join(root, name)))]));
}
const before = fingerprint();
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), node: process.version,
  scope: 'source-informed deterministic diagnostics; not a benchmark or Jev evaluation',
  foundryRoot: root,
  gitHead: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  gitStatusBefore: execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' }),
  scriptSha256: sha(readFileSync(fileURLToPath(import.meta.url))), sourceSha256: before,
  modelCalls: 0, sourceEdits: 0, semanticWitnesses: [], runtimeWitnesses: [],
};
const pairs = [
  {
    id: 'approval-negation',
    a: 'For this harmless formatting task, use human approval before returning the result.',
    b: 'For this harmless formatting task, do not use human approval before returning the result.',
    requiredDistinction: 'An explicit required method and its prohibition are different obligations.',
  },
  {
    id: 'obsolete-quoted-wait',
    a: 'The current instruction is: "wait 30 days" before returning the result.',
    b: 'The archived instruction was: "wait 30 days". That instruction is obsolete. Return the result now.',
    requiredDistinction: 'An adopted current instruction and explicitly obsolete quoted material are different obligations.',
  },
];
for (const pair of pairs) {
  const a = extractRequirements(pair.a), b = extractRequirements(pair.b);
  const ca = composeObjectiveCandidate(pair.a), cb = composeObjectiveCandidate(pair.b);
  const sameRequirements = JSON.stringify(a.requirements) === JSON.stringify(b.requirements);
  const sameExecutableNodes = JSON.stringify(ca.workflow.nodes) === JSON.stringify(cb.workflow.nodes);
  report.semanticWitnesses.push({ ...pair, extractionA: a, extractionB: b, sameRequirements, sameExecutableNodes,
    limitation: 'Full candidate text/id retain the wording; the collapse is in requirement extraction and executable composition.' });
  assert.equal(sameRequirements, true, `${pair.id}: source changed; inspect before interpreting`);
  assert.equal(sameExecutableNodes, true, `${pair.id}: source changed; inspect before interpreting`);
}
const numerical = extractRequirements('Approve invoice then pay, wait 30 days, compensate on cancel');
const spelled = extractRequirements('Have a reviewer sign off the invoice, pay it, wait thirty days, then compensate if cancelled');
report.durationWitness = { numerical, spelled,
  missingSpelledDurationLimit: !spelled.requestedBeyondIr.some(x => x.limit === 'delayMsMax'),
  numericalDurationLimit: numerical.requestedBeyondIr.some(x => x.limit === 'delayMsMax') };
assert.equal(report.durationWitness.missingSpelledDurationLimit, true);
assert.equal(report.durationWitness.numericalDurationLimit, true);

const combinedText = 'For every match, check the score; if scoring fails, use a separate error path.';
const combined = composeObjectiveCandidate(combinedText);
report.compositionWitness = {
  objective: combinedText, requirements: combined.requirements, nodeKinds: nodeKindsOf(combined.workflow),
  failedMotifs: OBJECTIVE_MOTIFS[OBJECTIVE_FAMILY_ID].filter(x => !x.inspect(combined)).map(x => x.id),
};
assert.equal(combined.requirements.includes('map-fanout'), true);
assert.equal(combined.requirements.includes('branching'), true);
assert.equal(report.compositionWitness.nodeKinds.includes('map'), false);
assert.equal(report.compositionWitness.failedMotifs.includes('map-or-loop-when-required'), true);

// Execute only existing core tools in this new workspace. Nothing is sent,
// deployed or modified outside the dedicated diagnostic output directory.
const foundry = new Foundry(path.join(out, 'workspace'));
try {
  const objective = 'Research a claim and refuse to send ungrounded citations';
  const candidate = composeObjectiveCandidate(objective);
  writeFileSync(path.join(out, 'candidate.json'), JSON.stringify(candidate, null, 2), { flag: 'wx' });
  const saved = foundry.save(candidate.workflow);
  for (const item of [
    { id: 'grounded-true-control', input: { claim: { grounded: true } }, expectedLocalStatus: 'succeeded' },
    { id: 'explicitly-ungrounded', input: { claim: { grounded: false } }, expectedLocalStatus: 'succeeded' },
    { id: 'missing-grounding-evidence', input: {}, expectedLocalStatus: 'succeeded' },
    { id: 'malformed-type-control', input: { claim: { grounded: 'no' } }, expectedLocalStatus: 'failed' },
  ]) {
    const run = foundry.createRun(saved.hash, item.input);
    let thrown = null;
    try { await foundry.startRun(run.id); } catch (error) { thrown = { code: error.code, message: error.message }; }
    const trace = foundry.inspectRun(run.id);
    writeFileSync(path.join(out, `${item.id}.trace.json`), JSON.stringify(trace, null, 2), { flag: 'wx' });
    report.runtimeWitnesses.push({ ...item, runId: run.id, workflowHash: saved.hash,
      localStatus: trace.status, independentTaskVerified: trace.independentTaskVerified,
      traceFile: `${item.id}.trace.json`, thrown });
    assert.equal(trace.status, item.expectedLocalStatus, `${item.id}: source changed; inspect trace`);
    assert.equal(trace.independentTaskVerified, false);
  }
} finally { await foundry.close(); }

report.sourceUnchanged = JSON.stringify(before) === JSON.stringify(fingerprint());
assert.equal(report.sourceUnchanged, true, 'Source changed during diagnostics; do not attribute to a stable snapshot');
report.gitStatusAfter = execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' });
report.finishedAt = new Date().toISOString();
report.interpretation = [
  'A well-typed grounded:false flag is accepted; the compiler checks its type, not semantic grounding.',
  'Missing claim data uses the supplied grounded:true default. This is not independent evidence.',
  'No actual citation lookup or sending capability runs. These witnesses show false local completion for the intended task, not unauthorized external sending.',
  'The runtime separately retains independentTaskVerified:false; do not attribute the compiler acceptance weakness to a claim of externally verified task success.',
  'Assertions passing reproduce known failure modes. They do not qualify the product or establish any Jev capability.',
];
writeFileSync(path.join(out, 'RESULTS.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output: out, sourceUnchanged: report.sourceUnchanged,
  semanticCollapses: report.semanticWitnesses.length, durationFailure: true,
  missingFanout: true, runtime: report.runtimeWitnesses.map(x => ({ id: x.id, status: x.localStatus,
    independentTaskVerified: x.independentTaskVerified })), modelCalls: 0 }, null, 2));
