import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read existing native runs only. No workflow or provider execution is involved.
const output = path.dirname(fileURLToPath(import.meta.url));
const campaign = path.join(path.dirname(output), 'benchmark/outcome-model-001');
const workspace = path.join(campaign, 'workspace');
const repo = '/home/raed/Projects/workflow-foundry';
const sha = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const database = path.join(workspace, '.foundry/foundry.sqlite');
const before = sha(readFileSync(database));
const records = [];
for (const [file, expected, outputName] of [
  ['WRONG_OBSERVATION.json', 'unsatisfied', 'HISTORY_WRONG_V2.json'],
  ['SATISFIED_OBSERVATION.json', 'satisfied', 'HISTORY_SATISFIED_V2.json'],
]) {
  const observation = read(path.join(campaign, file));
  const args = ['bin/foundry.mjs', 'outcome-history', '--receipt', observation.id, '--workspace', workspace];
  const result = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', timeout: 15000,
    env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1' } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.historicalAssessment.outcome, expected);
  assert.equal(report.currentWorldQualification, false);
  assert.equal(report.currentEvidenceCheck.status, 'unverified');
  assert.equal(report.currentEvidenceCheck.matchesRecordedRegistry, false);
  assert.equal(report.binding.runId, observation.binding.runId);
  assert.equal(report.source.contractId, observation.contractId);
  writeFileSync(path.join(output, outputName), result.stdout, { flag: 'wx', mode: 0o600 });
  records.push({ command: args, observationId: observation.id, historyId: report.id,
    output: outputName, outcome: expected, outputSHA256: sha(result.stdout), exitCode: result.status });
}
assert.equal(sha(readFileSync(database)), before);
const evidence = { passed: true, at: new Date().toISOString(), commands: records,
  dbSHA256Before: before, dbSHA256After: sha(readFileSync(database)), unchangedMainDatabase: true,
  currentRegistryScope: 'Only built-in capability descriptors; historical synthetic instrument catalog differs. No external components were loaded.',
  currentWorldQualification: false, currentEvidenceCheck: 'unverified; no live artifact reads',
  newRuntimeExecutions: 0, modelCalls: 0,
  previousReceipt: { path: 'HISTORY_CLI_CHECK.json', sha256: sha(readFileSync(path.join(output, 'HISTORY_CLI_CHECK.json'))),
    meaning: 'Preserved earlier inspection using the pre-ancestry-fix inspector; not overwritten or silently relabeled.' },
  sourceHashes: Object.fromEntries(['bin/foundry.mjs', 'src/outcome-history.mjs'].map(file => [file, sha(readFileSync(path.join(repo, file)))])) };
writeFileSync(path.join(output, 'HISTORY_CLI_CHECK_V2.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(evidence, null, 2));
