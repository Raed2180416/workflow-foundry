import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const study = path.dirname(fileURLToPath(import.meta.url));
const root = '/home/raed/Projects/workflow-foundry';
const output = mkdtempSync(path.join(study, 'verification-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const baseline = Object.fromEntries(readFileSync(path.join(study, 'pre-edit/source.sha256'), 'utf8').trim().split('\n').map(line => {
  const match = line.match(/^([0-9a-f]{64})\s+(.+)$/);
  if (!match) throw new Error('Invalid pre-edit source manifest');
  return [match[2], match[1]];
}));
const owned = ['bin/foundry.mjs', 'tests/outcome-cli.test.mjs', 'docs/OUTCOME-REPAIR.md'];
const names = [...new Set([...Object.keys(baseline), ...owned])];
const snapshot = () => Object.fromEntries(names.map(name => [name, sha(readFileSync(path.join(root, name)))]));
const before = snapshot();
save('SOURCE-BEFORE.json', before);
mkdirSync(path.join(output, 'source'));
for (const name of owned) copyFileSync(path.join(root, name), path.join(output, 'source', path.basename(name)));
const home = path.join(output, 'home'); mkdirSync(home);
const env = { PATH: '/usr/bin:/bin', HOME: home, NODE_NO_WARNINGS: '1',
  FOUNDRY_OUTCOME_CLI_EVIDENCE: path.join(output, 'cli-evidence') };
const checks = [
  ['syntax-cli', process.execPath, ['--check', 'bin/foundry.mjs']],
  ['syntax-tests', process.execPath, ['--check', 'tests/outcome-cli.test.mjs']],
  ['focused-tests', process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=2',
    'tests/outcome-cli.test.mjs', 'tests/outcome-repair.test.mjs', 'tests/cli-provider-selection.test.mjs']],
  ['doctor', 'npm', ['run', 'check']],
  ['repository-tests', 'npm', ['test']],
  ['diff-check', 'git', ['diff', '--check', '--', 'bin/foundry.mjs']]
];
const results = [];
for (const [name, command, args] of checks) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(path.join(output, `${name}.stdout`), result.stdout ?? '', { flag: 'wx', mode: 0o600 });
  writeFileSync(path.join(output, `${name}.stderr`), result.stderr ?? '', { flag: 'wx', mode: 0o600 });
  const record = { name, command: [command, ...args], exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
    durationMs: Date.now() - started, stdoutSha256: sha(result.stdout ?? ''), stderrSha256: sha(result.stderr ?? '') };
  if (name.endsWith('tests')) {
    record.tests = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled'].map(label => {
      const match = result.stdout?.match(new RegExp(`(?:#|ℹ) ${label} (\\d+)`));
      return [label, match ? Number(match[1]) : null];
    }));
  }
  results.push(record); console.log(JSON.stringify({ output, ...record }));
  if (result.status !== 0 || result.error) break;
}
const after = snapshot();
const changedDuringVerification = names.filter(name => before[name] !== after[name]);
const changedSincePreEdit = Object.keys(baseline).filter(name => baseline[name] !== after[name]);
const unexpectedPreEditChanges = changedSincePreEdit.filter(name => name !== 'bin/foundry.mjs');
const report = { output, sourceBefore: before, sourceAfter: after, owned, results, changedDuringVerification, changedSincePreEdit,
  unexpectedPreEditChanges, liveModelCalls: 0,
  qualification: 'Subprocess development controls and repository regression checks. Generation tests replace provider modules with supplied offline doubles and block network/provider child dispatch.',
  passed: checks.length === results.length && results.every(x => x.exitCode === 0 && !x.error) && !changedDuringVerification.length && !unexpectedPreEditChanges.length };
save('REPORT.json', report);
console.log(JSON.stringify({ output, passed: report.passed, changedDuringVerification, unexpectedPreEditChanges, results: results.map(x => ({ name: x.name, exitCode: x.exitCode, tests: x.tests })) }, null, 2));
if (!report.passed) process.exitCode = 1;
