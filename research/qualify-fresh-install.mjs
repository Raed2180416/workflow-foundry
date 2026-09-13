#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, DEFAULT_INHERITED_ENV_VARS } from '@modelcontextprotocol/sdk/client/stdio.js';

// Local/offline package installation control. This is not a model experiment,
// publication, clean-machine compatibility claim, or fresh registry download.
const root = path.resolve(import.meta.dirname, '..');
const cache = process.argv[2] ? path.resolve(process.argv[2]) : path.join(process.env.HOME, '.npm');
if (!existsSync(path.join(cache, '_cacache'))) throw new Error('A pre-existing npm content cache is required; no online fallback will run.');
process.umask(0o077);
const base = path.join(root, '.foundry/qualification-resume-20260913'); mkdirSync(base, { recursive: true });
const evidence = mkdtempSync(path.join(base, 'fresh-install-'));
const home = path.join(evidence, 'empty-home'), consumer = path.join(evidence, 'consumer'), target = path.join(evidence, 'task');
for (const directory of [home, consumer, target]) mkdirSync(directory, { mode: 0o700 });
for (const name of ['user.npmrc', 'global.npmrc']) writeFileSync(path.join(evidence, name), '', { flag: 'wx', mode: 0o600 });
writeFileSync(path.join(consumer, 'package.json'), '{"name":"foundry-fresh-offline-test","private":true,"version":"1.0.0"}\n', { flag: 'wx', mode: 0o600 });
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (name, value) => writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const env = {
  PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, LANG: 'C.UTF-8', NODE_NO_WARNINGS: '1',
  NPM_CONFIG_USERCONFIG: path.join(evidence, 'user.npmrc'), NPM_CONFIG_GLOBALCONFIG: path.join(evidence, 'global.npmrc'),
  NPM_CONFIG_CACHE: cache, NPM_CONFIG_OFFLINE: 'true', NPM_CONFIG_IGNORE_SCRIPTS: 'true',
  NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false', NPM_CONFIG_UPDATE_NOTIFIER: 'false'
};
const report = { scope: 'Fresh npm installation from a local archive, using a pre-existing content cache in npm offline mode; no node_modules symlink, lifecycle scripts, model call, public publishing or credential configuration',
  startedAt: new Date().toISOString(), node: process.version, evidence, scriptSHA256: sha(readFileSync(import.meta.filename)), checks: [], commands: [] };
function run(program, args, cwd) {
  const began = Date.now();
  const result = spawnSync(program, args, { cwd, env, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
  const receipt = `command-${report.commands.length + 1}.json`;
  write(receipt, { program, args, cwd, exit: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr, elapsedMs: Date.now() - began });
  report.commands.push({ program: path.basename(program), args, exit: result.status, signal: result.signal, receipt });
  if (result.status !== 0) throw new Error(`${path.basename(program)} ${args[0]} failed; see ${receipt}. No network retry was attempted.`);
  return result.stdout;
}
let client;
try {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')));
  const output = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', evidence], root));
  // npm versions expose either a record array or an object keyed by package name.
  const packed = Array.isArray(output) ? output.find(entry => entry.name === pkg.name) : output[pkg.name];
  assert.equal(packed?.name, pkg.name); assert.ok(Array.isArray(packed.files));
  const archive = path.join(evidence, packed.filename);
  report.archive = { path: archive, sha256: sha(readFileSync(archive)), entries: packed.files.length, size: packed.size, unpackedSize: packed.unpackedSize };
  const before = Object.fromEntries(packed.files.map(file => [file.path, sha(readFileSync(path.join(root, file.path)))]));
  write('packed-source-before.json', before);
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive], consumer);
  const installed = path.join(consumer, 'node_modules/@contrare-research/workflow-foundry');
  assert.equal(lstatSync(installed).isSymbolicLink(), false);
  for (const file of packed.files) assert.equal(sha(readFileSync(path.join(installed, file.path))), before[file.path], file.path);
  report.checks.push({ name: 'Fresh installed product bytes match the archive source inventory', passed: true });
  for (const [name, version] of Object.entries(pkg.dependencies)) {
    const directory = path.join(consumer, 'node_modules', name);
    assert.equal(lstatSync(directory).isSymbolicLink(), false);
    assert.equal(JSON.parse(readFileSync(path.join(directory, 'package.json'))).version, version);
  }
  report.checks.push({ name: 'Exact production dependency pins installed without existing node_modules symlinks', passed: true });
  const cli = path.join(installed, 'bin/foundry.mjs');
  report.install = JSON.parse(run(process.execPath, [cli, 'install', '--project', target, '--client', 'opencode', '--no-hooks'], consumer));
  assert.equal(report.install.installed, true);
  const config = JSON.parse(readFileSync(path.join(target, 'opencode.json'))).mcp['workflow-foundry'];
  assert.deepEqual(config.command, [process.execPath, cli, 'mcp', '--workspace', target]);
  report.checks.push({ name: 'Fresh CLI installs a project MCP command pointing at its actual installed package', passed: true });
  client = new Client({ name: 'fresh-install-audit', version: '1' });
  const transport = new StdioClientTransport({ command: config.command[0], args: config.command.slice(1),
    env: { ...Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(key => [key, ''])), PATH: env.PATH, HOME: home, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  transport.stderr?.resume(); await client.connect(transport, { timeout: 10000 });
  const catalog = await client.listTools(); report.toolCount = catalog.tools.length;
  for (const name of ['foundry_trial', 'foundry_request_repair', 'foundry_run', 'foundry_run_json', 'foundry_delivery']) assert.ok(catalog.tools.some(tool => tool.name === name), name);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
    if (result.isError) throw new Error(JSON.stringify(result));
    return JSON.parse(result.content.find(item => item.type === 'text').text);
  };
  const workflow = JSON.parse(readFileSync(path.join(installed, 'examples/hello.json')));
  await call('foundry_save', { workflow });
  const executed = await call('foundry_run', { workflowId: workflow.id, input: { name: 'Fresh install' } });
  assert.equal(executed.status, 'succeeded');
  const inspected = await call('foundry_inspect', { runId: executed.id });
  assert.equal(inspected.workflowHash, executed.workflowHash); assert.ok(inspected.events.length > 0);
  const actual = readFileSync(path.join(target, '.foundry/artifacts', executed.id, 'greeting.txt'), 'utf8');
  assert.equal(actual, 'Hello, Fresh install!');
  report.checks.push({ name: 'Generated MCP command completes a real workflow with exact artifact and event evidence', passed: true });
  report.run = { id: executed.id, workflowHash: executed.workflowHash, engineHash: executed.engineHash, artifact: actual, eventCount: inspected.events.length };
  await client.close(); client = null;
  const after = Object.fromEntries(packed.files.map(file => [file.path, sha(readFileSync(path.join(root, file.path)))]));
  report.sourceChanged = Object.keys(before).filter(key => before[key] !== after[key]);
  report.sourceStable = report.sourceChanged.length === 0;
  report.passed = report.checks.every(check => check.passed) && report.sourceStable;
} catch (error) { report.passed = false; report.error = error.message; }
finally {
  await client?.close(); report.finishedAt = new Date().toISOString(); write('report.json', report);
  console.log(JSON.stringify({ evidence, passed: report.passed, checks: report.checks, sourceChanged: report.sourceChanged ?? null, archive: report.archive ?? null, error: report.error ?? null, modelCalls: 0 }));
  if (!report.passed) process.exitCode = 1;
}
