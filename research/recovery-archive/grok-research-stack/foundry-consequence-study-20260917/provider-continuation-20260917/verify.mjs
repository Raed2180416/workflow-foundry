import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT, sha } from './driver.mjs';
import { runProcess } from '/home/raed/Projects/workflow-foundry/src/process.mjs';

const repo = '/home/raed/Projects/workflow-foundry';
const root = path.join(ROOT, `checks-${randomUUID()}`); mkdirSync(root, { mode: 0o700 });
const sources = ['driver.mjs', 'driver.test.mjs', 'access-check.mjs', 'verify.mjs'].map(file => path.join(ROOT, file));
sources.push(...['campaign.mjs', 'cos-campaign.mjs', 'CAMPAIGN_PROTOCOL.json', 'benchmark/oracle.mjs', 'benchmark/oracle-v2.mjs',
  'benchmark/FREEZE.json', 'benchmark/FREEZE_V2.json', 'benchmark/calibration-v2-campaign-review-001/NOTE.md'].map(file => path.join(ROOT, '..', file)));
sources.push(...['src/opencode-v2-free.mjs', 'tests/opencode-v2-free.test.mjs', 'src/opencode-free.mjs', 'src/ollama-local.mjs', 'src/process.mjs'].map(file => path.join(repo, file)));
const snapshot = () => Object.fromEntries(sources.map(file => [file, sha(readFileSync(file))]));
const before = snapshot(), commands = [];
for (const [name, command, args, cwd] of [
  ...['driver.mjs', 'driver.test.mjs', 'access-check.mjs', 'verify.mjs'].map(file => [`syntax-${file}`, '/usr/bin/node', ['--check', path.join(ROOT, file)], ROOT]),
  ['focused-tests', '/usr/bin/node', ['--test', '--test-concurrency=1', path.join(ROOT, 'driver.test.mjs'), path.join(repo, 'tests/opencode-v2-free.test.mjs'), path.join(repo, 'tests/provider-quota.test.mjs')], ROOT],
  ['doctor', '/usr/bin/npm', ['run', 'check'], repo],
]) {
  let receipt;
  try {
    receipt = await runProcess(command, args, { cwd, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeoutMs: 45000, maxBytes: 2 * 1024 * 1024 });
    commands.push({ name, status: 'PASS', receipt: `${name}.json` });
  } catch (error) { receipt = { code: error.code, message: error.message, processResult: error.processResult }; commands.push({ name, status: 'FAIL', receipt: `${name}.json` }); }
  writeFileSync(path.join(root, `${name}.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
const after = snapshot(), changed = sources.filter(file => before[file] !== after[file]);
const report = { status: commands.every(item => item.status === 'PASS') && !changed.length ? 'PASS' : 'FAIL', at: new Date().toISOString(),
  root, commands, sourceHashes: after, changed, sourceStable: !changed.length,
  modelCalls: 0, suitesLoaded: 0, fullCampaignRuns: 0,
  scope: 'Supplied callbacks, real public setup and empty-batch native apply/v2 artifact audit; no hidden suites or model construction.',
  pluginEvidence: { SerenaManual: 'HTTP404 tunnel_client_not_seen', projectQualityMap: 'HTTP404 tunnel_client_not_seen', securityScanFast: 'HTTP404 tunnel_client_not_seen' },
  packageScripts: JSON.parse(readFileSync(path.join(repo, 'package.json'))).scripts };
writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: report.status, root, commands, sourceStable: report.sourceStable, modelCalls: 0 }));
if (report.status !== 'PASS') process.exitCode = 1;
