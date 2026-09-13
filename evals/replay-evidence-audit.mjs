#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes } from './evidence.mjs';
import { runDirectory } from './opencode-harness.mjs';
import { verifyIndependentAudit, verifyAuditReplay } from './sre-campaign.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = runDirectory(process.argv[2]);
if (existsSync(directory)) throw Error('Audit replay already exists; preserve it.');
const originalBytes = readFileSync(path.join(root, 'research/manifests/evidence-contract-audit.json'));
const original = JSON.parse(originalBytes), latest = original.at(-1);
const prior = verifyIndependentAudit(original, latest.sourceHashesAfter);
const snapshot = () => Object.fromEntries(prior.checkedFiles.map(name => [name, hashBytes(readFileSync(path.join(root, name)))]));
const before = snapshot();
if (before['tests/evidence-contract-audit.test.mjs'] !== latest.sourceHashesAfter['tests/evidence-contract-audit.test.mjs']) throw Error('Do not replay a modified independent test suite.');
process.umask(0o077);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const startedAt = new Date().toISOString();
const args = ['--test', '--test-reporter=tap', '--test-concurrency=1', 'tests/evidence-contract-audit.test.mjs'];
const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
const after = snapshot();
const receipt = {
  run: process.argv[2], testAuthor: 'worker-2', executedBy: 'worker-5',
  originalAuditRun: latest.run, originalAuditSHA256: hashBytes(originalBytes),
  startedAt, finishedAt: new Date().toISOString(), command: [process.execPath, ...args],
  sourceHashesBefore: before, sourceHashesAfter: after, sourceStable: JSON.stringify(before) === JSON.stringify(after),
  exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
  stdout: result.stdout, stderr: result.stderr,
  qualification: 'New execution of unchanged independently authored synthetic evidence tests. The original independent report and failures are preserved. No new independent manual review or model evaluation.',
};
writeFileSync(path.join(directory, 'audit-replay.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ directory, ...verifyAuditReplay(original, receipt, after) }, null, 2));
