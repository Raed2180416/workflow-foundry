import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const study = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(study, '../../../workflow-foundry');
const output = mkdtempSync(path.join(study, 'artifacts', 'verification-v2-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const sourcePaths = [...['src', 'tests'].flatMap(folder => readdirSync(path.join(repository, folder))
  .filter(name => name.endsWith('.mjs')).map(name => `${folder}/${name}`)),
  'bin/foundry.mjs', 'schemas/workflow.schema.json', 'package.json', 'package-lock.json'];
const snapshot = () => Object.fromEntries(sourcePaths.map(name => [name, hash(readFileSync(path.join(repository, name)))]));
const before = snapshot(); save('source-before.json', before);
// Do not inherit opt-in browser, installation or model experiment settings.
const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
const commands = [
  { name: 'syntax-module', command: process.execPath, args: ['--check', 'src/outcome-repair.mjs'] },
  { name: 'syntax-tests', command: process.execPath, args: ['--check', 'tests/outcome-repair.test.mjs'] },
  { name: 'native-trajectory', command: process.execPath, args: [path.join(study, 'trajectory.mjs')] },
  { name: 'doctor', command: 'npm', args: ['run', 'check'] },
  { name: 'repository-tests', command: 'npm', args: ['test'] }
];
const results = [];
for (const { name, command, args } of commands) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, { cwd: repository, env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
  writeFileSync(path.join(output, `${name}.stdout`), stdout, { flag: 'wx', mode: 0o600 });
  writeFileSync(path.join(output, `${name}.stderr`), stderr, { flag: 'wx', mode: 0o600 });
  const receipt = { name, command: [command, ...args], cwd: repository, exitCode: result.status,
    signal: result.signal ?? null, error: result.error ? { code: result.error.code, message: result.error.message } : null,
    durationMs: Date.now() - startedAt, stdout: path.join(output, `${name}.stdout`), stderr: path.join(output, `${name}.stderr`),
    stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  save(`${name}.json`, receipt); results.push(receipt);
  console.log(JSON.stringify(receipt));
  if (name === 'repository-tests') console.log(stdout.split('\n').slice(-14).join('\n'));
}
const after = snapshot(); save('source-after.json', after);
const sourceChanges = sourcePaths.filter(name => before[name] !== after[name]);
const report = { output, modelCalls: 0, results, sourceChanges,
  passed: results.every(result => result.exitCode === 0) && sourceChanges.length === 0,
  qualification: 'Local supplied development and repository regression checks only. Optional browser/packaging/MCP integration tests use repository defaults. No linter/formatter/typechecker scripts are declared.',
  pluginEvidence: 'Serena initial_instructions, project_quality_map and security_scan(full) each failed HTTP 404 tunnel_client_not_seen; none are claimed as passing scans.' };
save('REPORT.json', report);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
