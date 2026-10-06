import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFreeze } from '../benchmark/oracle-v2.mjs';

const out = path.dirname(fileURLToPath(import.meta.url));
const repo = '/home/raed/Projects/workflow-foundry';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['bin/foundry.mjs', 'package.json', 'package-lock.json', 'schemas/workflow.schema.json',
  ...['src', 'tests'].flatMap(dir => readdirSync(path.join(repo, dir)).filter(name => name.endsWith('.mjs')).map(name => `${dir}/${name}`))];
const snapshot = () => Object.fromEntries(files.map(file => [file, sha(readFileSync(path.join(repo, file)))]));
const before = snapshot(), results = [];
verifyFreeze();
for (const [name, executable, args, timeout] of [
  ['repository-tests', 'npm', ['test'], 150000],
  ['doctor', 'npm', ['run', 'check'], 15000],
  ['tracked-diff-check', 'git', ['diff', '--check'], 15000],
]) {
  const started = Date.now();
  const result = spawnSync(executable, args, { cwd: repo, env: { ...process.env,
    FOUNDRY_TERMINATION_EVIDENCE_ROOT: path.join(out, 'final-provider-controls'),
    FOUNDRY_HISTORY_CLI_EVIDENCE: path.join(out, 'final-history-cli-controls') },
    encoding: 'utf8', timeout, maxBuffer: 12 * 1024 * 1024 });
  const counts = Object.fromEntries([...result.stdout.matchAll(/^(?:#|ℹ) (tests|pass|fail|skipped|cancelled) (\d+)/gm)].map(m => [m[1], Number(m[2])]));
  writeFileSync(path.join(out, `FINAL-${name}.stdout`), result.stdout, { flag: 'wx', mode: 0o600 });
  writeFileSync(path.join(out, `FINAL-${name}.stderr`), result.stderr, { flag: 'wx', mode: 0o600 });
  const row = { name, command: [executable, ...args], exitCode: result.status, signal: result.signal,
    error: result.error?.message ?? null, elapsedMs: Date.now() - started, counts,
    stdoutSHA256: sha(result.stdout), stderrSHA256: sha(result.stderr) };
  results.push(row); console.log(JSON.stringify(row));
}
const after = snapshot();
const changed = files.filter(file => before[file] !== after[file]);
const tests = results.find(row => row.name === 'repository-tests');
const passed = results.every(row => row.exitCode === 0) && changed.length === 0 && tests.counts.fail === 0 && tests.counts.tests > 0;
verifyFreeze();
const report = { passed, at: new Date().toISOString(), scope: 'Actual complete product regression after intentional provider/history CLI revisions; supplied offline inference fixtures only.',
  results, counts: tests.counts, sourceBefore: before, sourceAfter: after, changedDuringVerification: changed,
  nativeEvaluatorFreeze: 'unchanged', modelCalls: 0,
  providerFixtureScope: 'New termination tests run the installed CLI/private server and production adapter, but all parent fetches are supplied and the child has no external network.' };
writeFileSync(path.join(out, 'FINAL_REGRESSION.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
assert.ok(passed, 'Final regression or source stability failed; inspect the preserved outputs');
