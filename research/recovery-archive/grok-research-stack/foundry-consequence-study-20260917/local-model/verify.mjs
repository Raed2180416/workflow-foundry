import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '/home/raed/Projects/workflow-foundry/src/process.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), `checks-${randomUUID()}`);
const repo = '/home/raed/Projects/workflow-foundry';
mkdirSync(root, { mode: 0o700 });
const save = (name, value) => writeFileSync(path.join(root, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o400, flag: 'wx' });
const files = ['src/ollama-local.mjs', 'tests/ollama-local.test.mjs', 'src/opencode-v2-free.mjs', 'tests/opencode-v2-free.test.mjs', 'src/opencode-free.mjs', 'src/process.mjs'];
const hashes = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.join(repo, file))).digest('hex')]));
const before = hashes(); save('BEFORE.json', before);
const results = [];
for (const [name, command, args] of [
  ...files.slice(0, 4).map(file => [`syntax-${path.basename(file)}`, '/usr/bin/node', ['--check', file]]),
  ['focused-tests', '/usr/bin/node', ['--test', '--test-concurrency=2', 'tests/ollama-local.test.mjs', 'tests/opencode-v2-free.test.mjs', 'tests/provider-quota.test.mjs']],
  ['doctor', '/usr/bin/npm', ['run', 'check']],
]) {
  try {
    const result = await runProcess(command, args, { cwd: repo, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeoutMs: 45000 });
    save(`${name}.json`, result);
    results.push({ name, status: 'PASS', command, args, receipt: `${name}.json` });
  } catch (error) {
    save(`${name}.json`, { code: error.code, message: error.message, processResult: error.processResult });
    results.push({ name, status: 'FAIL', code: error.code, receipt: `${name}.json` }); process.exitCode = 1;
  }
}
const after = hashes();
const sourceStable = JSON.stringify(before) === JSON.stringify(after);
const legacyPreserved = after['src/opencode-free.mjs'] === '6848bfcba60945d1dfebf8fbf7e2461590f1c33eb85f5e2dc3bce84a347eeeca' && after['src/process.mjs'] === 'bfc97e88bb73bc8f15ba2d174ab1d97c615c3fd097e57c57964bd8bc4196bb7a';
if (!sourceStable || !legacyPreserved) process.exitCode = 1;
const result = { status: process.exitCode ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), root, results, sourceHashes: after, sourceStable, legacyPreserved,
  ollamaAdapterLines: readFileSync(path.join(repo, 'src/ollama-local.mjs'), 'utf8').trimEnd().split('\n').length,
  packageScripts: JSON.parse(readFileSync(path.join(repo, 'package.json'))).scripts,
  inferenceCalls: 0, networkCalls: 0, scope: 'Supplied local transport/GPU fixtures, OpenCode event/export fixtures and generator quota regressions; syntax and repository doctor. No model inference.' };
save('RESULT.json', result);
console.log(JSON.stringify(result, null, 2));
