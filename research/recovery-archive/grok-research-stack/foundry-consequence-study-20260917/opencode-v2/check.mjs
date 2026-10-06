import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { runProcess } from '/home/raed/Projects/workflow-foundry/src/process.mjs';
const base = path.dirname(new URL(import.meta.url).pathname);
const repo = '/home/raed/Projects/workflow-foundry';
const root = path.join(base, `checks-${randomUUID()}`); mkdirSync(root, { mode: 0o700 });
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const records = [];
for (const [name, command, args] of [
  ['syntax-source', '/usr/bin/node', ['--check', 'src/opencode-v2-free.mjs']],
  ['syntax-test', '/usr/bin/node', ['--check', 'tests/opencode-v2-free.test.mjs']],
  ['focused-tests', '/usr/bin/node', ['--test', 'tests/opencode-v2-free.test.mjs', 'tests/provider-quota.test.mjs']],
  ['doctor', '/usr/bin/npm', ['run', 'check']],
]) {
  try {
    const result = await runProcess(command, args, { cwd: repo, env: { PATH: '/usr/bin:/bin', HOME: '/home/raed', LANG: 'C.UTF-8' }, timeoutMs: 45000 });
    writeFileSync(path.join(root, `${name}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    records.push({ name, status: 'PASS', command, args, receipt: path.join(root, `${name}.json`) });
  } catch (error) {
    writeFileSync(path.join(root, `${name}.json`), JSON.stringify({ code: error.code, message: error.message, processResult: error.processResult }, null, 2) + '\n', { flag: 'wx' });
    records.push({ name, status: 'FAIL', code: error.code }); process.exitCode = 1;
  }
}
const sourceHashes = Object.fromEntries(['src/opencode-v2-free.mjs', 'tests/opencode-v2-free.test.mjs', 'src/opencode-free.mjs', 'src/process.mjs'].map(file => [file, hash(path.join(repo, file))]));
const preserved = sourceHashes['src/opencode-free.mjs'] === '6848bfcba60945d1dfebf8fbf7e2461590f1c33eb85f5e2dc3bce84a347eeeca'
  && sourceHashes['src/process.mjs'] === 'bfc97e88bb73bc8f15ba2d174ab1d97c615c3fd097e57c57964bd8bc4196bb7a';
if (!preserved) process.exitCode = 1;
const result = { checkedAt: new Date().toISOString(), status: process.exitCode ? 'FAIL' : 'PASS', root, records, sourceHashes, legacyAdapterAndProcessHelperPreserved: preserved,
  packageScripts: JSON.parse(readFileSync(path.join(repo, 'package.json'))).scripts,
  unavailableEvidence: { Serena: 'HTTP404 tunnel_client_not_seen', projectQualityMap: 'HTTP404 tunnel_client_not_seen', fullSecurityScan: 'HTTP404 tunnel_client_not_seen', GitHubCodeScanning: 'HTTP404 tunnel_client_not_seen' } };
writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
