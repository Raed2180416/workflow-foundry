import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = '/home/raed/Projects/workflow-foundry';
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const before = read(path.join(root, 'BEFORE.json'));
const differences = before.oldProtocol.sources.flatMap(item => {
  const current = sha(readFileSync(item.file));
  return current === item.sha256 ? [] : [{ file: item.file, before: item.sha256, after: current }];
});
assert.equal(differences.length, 1);
assert.equal(differences[0].file, path.join(repo, 'src/opencode-v2-free.mjs'));
for (const item of before.copies) assert.equal(sha(readFileSync(path.join(root, item.copy))), item.sha256);
for (const item of before.copies.filter(item => item.source.includes('/tests/'))) assert.equal(sha(readFileSync(item.source)), item.sha256);
for (const item of before.failedCampaign.receipts) assert.equal(sha(readFileSync(path.join(before.failedCampaign.directory, item.file))), item.sha256);
for (const item of before.evaluatorFreezes) assert.equal(sha(readFileSync(item.file)), item.sha256);
const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
const command = before.oldProtocol.check.command;
const check = spawnSync(command[0], command.slice(1), { encoding: 'utf8', timeout: 30000, maxBuffer: 512 * 1024, env });
assert.equal(check.status, 1, 'Old source freeze must reject the intentional provider revision');
assert.ok(check.stderr.includes('Complete frozen configuration/source identity differs'));
const diff = spawnSync('/usr/bin/diff', ['-u', path.join(root, 'before/opencode-v2-free.mjs'), path.join(repo, 'src/opencode-v2-free.mjs')],
  { encoding: 'utf8', timeout: 10000, maxBuffer: 512 * 1024, env });
assert.equal(diff.status, 1);
writeFileSync(path.join(root, 'ADAPTER.diff'), diff.stdout, { flag: 'wx', mode: 0o600 });
const result = { status: 'PASS_INTENTIONAL_SOURCE_EVOLUTION', at: new Date().toISOString(), differences,
  oldProtocolCheck: { command, expectedExitCode: 1, exitCode: check.status, stdout: check.stdout, stderr: check.stderr },
  unchangedOldProtocolSources: before.oldProtocol.sources.length - differences.length,
  unchangedFailedCampaignReceipts: before.failedCampaign.receipts.length,
  unchangedEvaluatorFreezes: before.evaluatorFreezes,
  priorCampaignSourceStableFieldPreserved: read(path.join(before.failedCampaign.directory, 'RESULTS.json')).sourceStable,
  newTestsSHA256: sha(readFileSync(path.join(repo, 'tests/provider-termination.test.mjs'))),
  diffSHA256: sha(Buffer.from(diff.stdout)), liveModelCalls: 0, externalRequests: 0 };
writeFileSync(path.join(root, 'CHANGE-RECEIPT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: result.status, differences, oldProtocolCheck: check.status,
  unchangedFailedCampaignReceipts: result.unchangedFailedCampaignReceipts, newTestsSHA256: result.newTestsSHA256 }));
