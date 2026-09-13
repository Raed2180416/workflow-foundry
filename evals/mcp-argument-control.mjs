#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runDirectory } from './opencode-harness.mjs';
import { hashBytes } from './evidence.mjs';
import { inspectRollup } from './mcp-tui.mjs';

// Post-TUI diagnostic control: no model call, no candidate edits, no network.
// This cannot turn an incomplete OpenCode TUI session into a successful one.
const source = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(source), '..');
const [originID, controlID] = process.argv.slice(2);
const origin = runDirectory(originID), directory = runDirectory(controlID);
if (existsSync(directory)) throw Error('Preserve an existing control run.');
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
const textPart = value => JSON.parse(value.content.find(part => part.type === 'text').text);
const state = readJSON(path.join(origin, 'foundry-state.stdout.txt'));
const sessionFile = path.join(origin, 'session-export-local.stdout.txt');
const session = readJSON(sessionFile), manifest = readJSON(path.join(origin, 'manifest.json'));
if (manifest.status !== 'stopped' || !manifest.sourceHashes) throw Error('Use a stopped, source-bound TUI run.');
const proposal = state.proposals.find(item => item.requestId === manifest.requestId && item.status === 'applied');
const proposed = session.messages.flatMap(message => message.parts ?? []).find(part => {
  if (part.tool !== 'workflow-foundry_foundry_propose' || part.state.status !== 'completed') return false;
  try {
    const output = JSON.parse(part.state.output), value = output.content ? textPart(output) : output;
    return value.id === proposal?.id;
  } catch { return false; }
});
if (!proposal || !proposed || !isDeepStrictEqual(proposal.workflow, proposed.state.input.workflow)) throw Error('No exact model-proposed, applied candidate is preserved.');
for (const [name, hash] of Object.entries(manifest.sourceHashes)) {
  if (hashBytes(readFileSync(path.join(origin, 'server', name))) !== hash) throw Error(`Server snapshot changed: ${name}`);
}
process.umask(0o077);
mkdirSync(path.join(directory, 'workspace'), { recursive: true, mode: 0o700 });
const write = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
write('candidate-from-model-proposal.json', proposal.workflow);
const report = {
  startedAt: new Date().toISOString(), originID, condition: 'deterministic-local-mcp-argument-control',
  generatedByModel: false, newModelCalls: 0, taskCandidateOrigin: 'Exact completed model MCP proposal, without workflow edits',
  sessionSHA256: hashBytes(readFileSync(sessionFile)), sourceHashes: manifest.sourceHashes,
  evaluatorSHA256: hashBytes(readFileSync(source)), proposalId: proposal.id, workflowHash: proposal.workflowHash,
  calls: [], cases: [], limitations: ['This is a post-TUI diagnostic control; both failed TUI attempts retain their original outcome.', 'It does not identify whether the string arguments originated in model choice or a client/provider schema conversion.'],
};
const commandArgs = [
  '--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid', '--unshare-net',
  '--unshare-ipc', '--unshare-uts', '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr',
  '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
  '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', process.env.HOME,
  '--ro-bind', path.join(origin, 'server'), '/server',
  '--ro-bind', path.join(root, 'node_modules'), '/server/node_modules',
  '--bind', path.join(directory, 'workspace'), '/task', '--chdir', '/task',
  '/usr/bin/node', '/server/bin/foundry.mjs', 'mcp', '--workspace', '/task',
];
const transport = new StdioClientTransport({ command: '/usr/bin/bwrap', args: commandArgs, env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8' }, stderr: 'pipe' });
const client = new Client({ name: 'foundry-evaluator-argument-control', version: '1.0.0' });
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
  const value = textPart(result);
  report.calls.push({ name, arguments: args, isError: result.isError ?? false, response: value });
  return { result, value };
};
try {
  await client.connect(transport, { timeout: 15000 });
  const catalog = await client.listTools({}, { timeout: 15000 });
  report.observedRunTool = catalog.tools.find(item => item.name === 'foundry_run');
  const saved = await call('foundry_save', { workflow: proposal.workflow });
  if (saved.result.isError) throw Error('Exact model candidate could not be saved.');
  const stringInput = await call('foundry_run', { workflowId: proposal.workflowHash, input: '{"values":[3,7,11]}' });
  report.cases.push({ caseId: 'serialized-object', passed: stringInput.result.isError === true && stringInput.value.error?.code === 'SCHEMA_MISMATCH', response: stringInput.value });
  for (const [caseId, input, expected] of [
    ['object-sample', { values: [3, 7, 11] }, { total: 21, count: 3 }],
    ['object-changed', { values: [2, 5] }, { total: 7, count: 2 }],
    ['object-empty', { values: [] }, { total: 0, count: 0 }],
    ['object-invalid', { values: [1, '2'] }, null],
  ]) {
    const executed = await call('foundry_run', { workflowId: proposal.workflowHash, input });
    if (expected === null) {
      report.cases.push({ caseId, passed: executed.result.isError === true && executed.value.error?.code === 'SCHEMA_MISMATCH', response: executed.value });
      continue;
    }
    if (executed.result.isError || !/^[a-f0-9-]{36}$/.test(executed.value.id ?? '')) {
      report.cases.push({ caseId, passed: false, response: executed.value }); continue;
    }
    const inspected = await call('foundry_inspect', { runId: executed.value.id });
    const artifact = path.join(directory, 'workspace/.foundry/artifacts', executed.value.id, 'totals.json');
    report.cases.push({ caseId, ...inspectRollup({ run: inspected.value, artifactBytes: existsSync(artifact) ? readFileSync(artifact, 'utf8') : undefined, expected, workflowHash: proposal.workflowHash }) });
  }
  report.passed = report.cases.length === 5 && report.cases.every(item => item.passed);
} catch (error) {
  report.passed = false; report.error = { name: error.name, message: error.message };
} finally {
  await client.close();
  report.finishedAt = new Date().toISOString();
  write('argument-control.json', report);
}
console.log(JSON.stringify({ directory, passed: report.passed, error: report.error, observedRunTool: report.observedRunTool, cases: report.cases, newModelCalls: 0 }, null, 2));
if (!report.passed) process.exitCode = 1;
