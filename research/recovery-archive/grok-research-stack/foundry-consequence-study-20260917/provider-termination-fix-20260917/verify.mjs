import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '/home/raed/Projects/workflow-foundry/src/process.mjs';

const study = path.dirname(fileURLToPath(import.meta.url));
const repo = '/home/raed/Projects/workflow-foundry';
const root = path.join(study, `checks-${randomUUID()}`); mkdirSync(root, { mode: 0o700 });
const sha = value => createHash('sha256').update(value).digest('hex');
const files = ['src/opencode-v2-free.mjs', 'tests/provider-termination.test.mjs', 'tests/opencode-v2-free.test.mjs', 'tests/provider-quota.test.mjs'];
const snapshot = () => Object.fromEntries(files.map(file => [file, sha(readFileSync(path.join(repo, file)))]));
const before = snapshot(), results = [];
const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', FOUNDRY_TERMINATION_EVIDENCE_ROOT: path.join(root, 'cases') };
for (const [name, command, args] of [
  ['syntax-provider', '/usr/bin/node', ['--check', 'src/opencode-v2-free.mjs']],
  ['syntax-tests', '/usr/bin/node', ['--check', 'tests/provider-termination.test.mjs']],
  ['focused-tests', '/usr/bin/node', ['--test', '--test-concurrency=1', 'tests/provider-termination.test.mjs', 'tests/opencode-v2-free.test.mjs', 'tests/provider-quota.test.mjs']],
  ['doctor', '/usr/bin/npm', ['run', 'check']],
]) {
  let record;
  try {
    const result = await runProcess(command, args, { cwd: repo, env, timeoutMs: 90000, maxBytes: 2 * 1024 * 1024 });
    record = { status: 'PASS', ...result };
  } catch (error) {
    record = { status: 'FAIL', code: error.code, message: error.message, processResult: error.processResult }; process.exitCode = 1;
  }
  writeFileSync(path.join(root, `${name}.json`), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  results.push({ name, status: record.status, receipt: `${name}.json` });
  console.log(JSON.stringify({ name, status: record.status, root }));
}
const after = snapshot(), sourceStable = JSON.stringify(before) === JSON.stringify(after);
if (!sourceStable) process.exitCode = 1;
const result = { status: process.exitCode ? 'FAIL' : 'PASS', at: new Date().toISOString(), root, results,
  sourceStable, sources: after, scope: 'Supplied provider responses through actual installed CLI/server and production adapter; provider/quota regression tests and doctor.',
  liveModelCalls: 0, externalProviderRequests: 0 };
writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result));
