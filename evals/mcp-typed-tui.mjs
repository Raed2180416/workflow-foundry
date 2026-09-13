#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { assertFreeModel, parseModelCatalog, shellQuote } from './opencode-harness.mjs';
import { hashBytes, inspectTuiEvidence } from './evidence.mjs';
import { inspectRollup } from './mcp-tui.mjs';

const source = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(source), '..');
const campaign = 'typed-input-20260913';
const selectedSkills = ['workflow-foundry', 'runtime-native', 'domain-software', 'human-steering'];
const json = value => JSON.stringify(value, null, 2) + '\n';
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value, replace = false) => {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, value, { flag: replace ? 'w' : 'wx', mode: 0o600 });
};
const canonical = value => JSON.stringify((function order(item) {
  return Array.isArray(item) ? item.map(order) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, order(item[key])])) : item;
})(value));
export const originalTask = 'Create a new reusable bounded workflow named NumericRollup, version 1. It accepts input.values, an array of at most 100 actual numbers. Produce an actual UTF-8 JSON artifact named totals.json with exactly total (the sum of the supplied values) and count (the number of supplied values). Recompute from input at execution time. Empty input must produce total 0 and count 0. Missing, non-array or nonnumeric values must fail without claiming success or writing the result. Acceptance must inspect actual capability results, including the produced artifact; a constant report is insufficient. Use only registered capabilities. Budget: at most 12 steps, concurrency at most 3, total execution duration at most 5000ms, cost 0; task timeouts at most 1000ms and one attempt. This is a synthetic local data-processing task, not production deployment.';
export const editTask = 'Revise the existing NumericRollup workflow by adding one output field, values, containing the unchanged input.values numeric array. The actual totals.json artifact must now contain exactly total, count and values. Preserve all existing numeric validation, input-derived total and count, empty-array behavior, execution budgets and acceptance of actual capability/artifact results. Empty input must produce total 0, count 0 and values []. Save a new immutable version; preserve prior versions and their runs.';

function directory(id) {
  if (path.isAbsolute(id ?? '')) {
    if (!/^mcp-typed-[a-z0-9-]+$/.test(path.basename(id))) throw Error('Expected a typed campaign directory.');
    return id;
  }
  if (!/^mcp-typed-[a-z0-9-]{1,22}$/.test(id ?? '')) throw Error('Use a fresh mcp-typed-* run id of at most 32 characters.');
  return path.join(root, 'evals/runs', id);
}

// Inventory all regular bytes and internal symlink targets; no live dependency mount.
export function inventory(base, names = ['.']) {
  const entries = {};
  const walk = relative => {
    const file = path.resolve(base, relative), stat = lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of readdirSync(file).sort()) walk(path.posix.join(relative, name));
    } else if (stat.isSymbolicLink()) {
      const target = readlinkSync(file), resolved = realpathSync(file), boundary = path.resolve(base) + path.sep;
      if (path.isAbsolute(target) || !resolved.startsWith(boundary)) throw Error(`External snapshot symlink: ${relative}`);
      entries[relative] = { type: 'symlink', target };
    } else if (stat.isFile()) entries[relative] = { type: 'file', bytes: stat.size, sha256: hashBytes(readFileSync(file)), executable: !!(stat.mode & 0o111) };
    else throw Error(`Unsupported snapshot entry: ${relative}`);
  };
  for (const name of names) walk(name);
  return entries;
}

function freeze(run, previous) {
  const names = ['src', 'bin', 'schemas', 'node_modules', 'package.json', 'package-lock.json', 'AGENTS.md', 'docs/ARCHITECTURE.md', ...selectedSkills.map(name => `skills/${name}`), 'evals/mcp-typed-tui.mjs', 'evals/opencode-harness.mjs', 'evals/evidence.mjs', 'evals/mcp-tui.mjs', 'evals/MCP-TYPED-TUI-PROTOCOL.md'];
  const from = previous ? path.join(previous, 'server') : root;
  const before = inventory(from, names);
  for (const name of names) {
    const destination = path.join(run, 'server', name);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    cpSync(path.join(from, name), destination, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
  }
  const after = inventory(from, names), copied = inventory(path.join(run, 'server'), names);
  if (!isDeepStrictEqual(before, after) || !isDeepStrictEqual(before, copied)) throw Error('Source changed during freeze; preserve this failed acquisition and retry in a fresh directory.');
  mkdirSync(path.join(run, 'runtime'), { mode: 0o700 });
  const binaries = {};
  const platform = { platform: process.platform, architecture: process.arch, nodeVersions: process.versions, osRelease: readFileSync('/etc/os-release', 'utf8'), libraries: {}, probes: [] };
  for (const name of ['node', 'opencode']) {
    const input = previous ? path.join(previous, 'runtime', name) : `/usr/bin/${name}`;
    const hash = hashBytes(readFileSync(input));
    copyFileSync(input, path.join(run, 'runtime', name)); chmodSync(path.join(run, 'runtime', name), 0o700);
    if (hashBytes(readFileSync(input)) !== hash || hashBytes(readFileSync(path.join(run, 'runtime', name))) !== hash) throw Error('Runtime binary changed during freeze.');
    binaries[name] = { sha256: hash, bytes: lstatSync(path.join(run, 'runtime', name)).size };
    const linked = spawnSync('/usr/bin/ldd', [input], { encoding: 'utf8', timeout: 10000 });
    platform.probes.push({ binary: name, exitCode: linked.status, stdout: linked.stdout, stderr: linked.stderr });
    for (const match of (linked.stdout ?? '').matchAll(/(?:=>\s+|^\s*)(\/[^\s()]+)/gm)) {
      if (existsSync(match[1])) platform.libraries[match[1]] = hashBytes(readFileSync(match[1]));
    }
  }
  write(path.join(run, 'platform.json'), json(platform));
  const result = { at: new Date().toISOString(), previous: previous ?? null, names, files: copied, binaries, sourceIdentity: hashBytes(canonical(copied)), dependencyIdentity: hashBytes(canonical(Object.fromEntries(Object.entries(copied).filter(([name]) => name.startsWith('node_modules/'))))), systemLibraries: 'Host OS/shared libraries remain read-only host platform; executable bytes and all project/Node dependency bytes are frozen.' };
  write(path.join(run, 'snapshot.json'), json(result));
  return result;
}

export function verifyFreeze(run) {
  const snapshot = readJSON(path.join(run, 'snapshot.json'));
  const current = inventory(path.join(run, 'server'), snapshot.names);
  if (!isDeepStrictEqual(snapshot.files, current)) throw Error('Frozen source or dependency bytes changed.');
  for (const [name, metadata] of Object.entries(snapshot.binaries)) if (hashBytes(readFileSync(path.join(run, 'runtime', name))) !== metadata.sha256) throw Error(`Frozen executable changed: ${name}`);
  for (const [file, expected] of Object.entries(readJSON(path.join(run, 'platform.json')).libraries)) if (hashBytes(readFileSync(file)) !== expected) throw Error(`Host runtime library changed: ${file}`);
  return { sourceIdentity: snapshot.sourceIdentity, dependencyIdentity: snapshot.dependencyIdentity, files: Object.keys(current).length, stable: true };
}

function environment() {
  return { PATH: '/runtime:/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor', XDG_CONFIG_HOME: '/state/config', XDG_DATA_HOME: '/state/data', XDG_CACHE_HOME: '/state/cache', XDG_STATE_HOME: '/state/state', OPENCODE_CONFIG: '/task/opencode.json', OPENCODE_CONFIG_DIR: '/state/config/opencode' };
}
function sandbox(run, command, { writableConfig = false, offline = false, workspace = path.join(run, 'workspace') } = {}) {
  return ['--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', ...(offline ? ['--unshare-net'] : []), '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', process.env.HOME, '--dir', '/etc', ...(!offline ? ['--ro-bind', '/etc/ssl', '/etc/ssl', '--ro-bind', realpathSync('/etc/resolv.conf'), '/etc/resolv.conf', '--ro-bind', '/etc/hosts', '/etc/hosts'] : []), '--bind', path.join(run, 'state'), '/state', '--bind', workspace, '/task', '--ro-bind', path.join(run, 'server'), '/server', '--ro-bind', path.join(run, 'runtime'), '/runtime', ...(!writableConfig && existsSync(path.join(workspace, 'opencode.json')) ? ['--ro-bind', path.join(workspace, 'opencode.json'), '/task/opencode.json'] : []), ...(existsSync(path.join(workspace, 'inputs')) ? ['--ro-bind', path.join(workspace, 'inputs'), '/task/inputs'] : []), ...(!writableConfig && existsSync(path.join(workspace, '.agents')) ? ['--ro-bind', path.join(workspace, '.agents'), '/task/.agents'] : []), '--chdir', '/task', ...command];
}
function execute(run, label, command, options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync('/usr/bin/bwrap', sandbox(run, command, options), { env: environment(), encoding: 'utf8', timeout: 45000, maxBuffer: 24 * 1024 * 1024 });
  write(path.join(run, `${label}.stdout.txt`), result.stdout ?? '');
  write(path.join(run, `${label}.stderr.txt`), result.stderr ?? '');
  write(path.join(run, `${label}.process.json`), json({ command, startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null }));
  if (!options.allowFailure && (result.error || result.status !== 0)) throw Error(`${label} failed: ${result.error?.message ?? result.stderr}`);
  return result;
}
const cli = (...args) => ['/runtime/node', '/server/bin/foundry.mjs', ...args, '--workspace', '/task'];

// OpenCode global (non-git) projects use worktree '/', so its built-in tools
// authorize path.relative('/', '/task/output.json') as 'task/output.json'.
// These aliases describe the same already-authorized sandbox paths, not new paths.
export function taskPermissionAliases(permission) {
  const updated = structuredClone(permission);
  updated.read['task/inputs/*'] = 'allow';
  updated.read['task/.agents/skills/*'] = 'allow';
  updated.read['task/output.json'] = 'allow';
  updated.edit['task/output.json'] = 'allow';
  return updated;
}

async function mcpClient(run, workspace, callback) {
  const sdk = path.join(run, 'server/node_modules/@modelcontextprotocol/sdk/dist/esm/client');
  const { Client } = await import(pathToFileURL(path.join(sdk, 'index.js')));
  const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, 'stdio.js')));
  const transport = new StdioClientTransport({ command: '/usr/bin/bwrap', args: sandbox(run, cli('mcp'), { offline: true, workspace }), env: environment(), stderr: 'pipe' });
  const client = new Client({ name: 'foundry-typed-tui-evaluator', version: '1.0.0' });
  let stderr = '';
  transport.stderr?.on('data', bytes => { stderr += bytes; });
  try { await client.connect(transport, { timeout: 15000 }); return await callback(client); }
  finally { await client.close(); write(path.join(run, `mcp-stderr-${Date.now()}.txt`), stderr); }
}

export function inspectTransportCatalog(catalog) {
  const errors = [], object = catalog.tools?.find(tool => tool.name === 'foundry_run'), text = catalog.tools?.find(tool => tool.name === 'foundry_run_json');
  if (object?.inputSchema?.properties?.input?.type !== 'object' || !object.inputSchema.required?.includes('input')) errors.push('Object transport input must be explicitly typed and required.');
  if (text?.inputSchema?.properties?.inputJson?.type !== 'string' || !text.inputSchema.required?.includes('inputJson')) errors.push('Text transport must explicitly require inputJson string.');
  for (const tool of catalog.tools ?? []) if (/approve|answer|shell|exec|command/i.test(tool.name)) errors.push(`Unexpected authority or shell tool: ${tool.name}`);
  return { passed: errors.length === 0, errors, object, text };
}

async function prepare(id, ready, previousID, mode = 'original') {
  if (ready !== 'PRIME_READY_20260913') throw Error('Explicit prime READY acknowledgment is required before freezing.');
  if (!['original', 'edit', 'retry'].includes(mode)) throw Error('Unknown preparation mode.');
  const run = directory(id), previous = previousID ? directory(previousID) : null;
  if (existsSync(run)) throw Error('Preserve existing run directories.');
  if (mode !== 'original' && !previous) throw Error('A prior preserved run is required.');
  if (previous) {
    verifyFreeze(previous);
    const prior = readJSON(path.join(previous, 'manifest.json'));
    if (prior.status !== 'stopped') throw Error('Stop previous TUI first.');
    const score = readJSON(path.join(previous, 'typed-score.json'));
    if (mode === 'edit' && !score.passed) throw Error('Edit needs a complete successful first integration.');
    if (mode === 'retry' && score.passed) throw Error('Do not retry a passed integration.');
  }
  mkdirSync(run, { recursive: true, mode: 0o700 });
  for (const name of ['workspace', 'state/config/opencode', 'state/data', 'state/cache', 'state/state']) mkdirSync(path.join(run, name), { recursive: true, mode: 0o700 });
  const snapshot = freeze(run, previous);
  write(path.join(run, 'protocol.md'), readFileSync(path.join(run, 'server/evals/MCP-TYPED-TUI-PROTOCOL.md')));
  const historicalTask = readFileSync(path.join(root, 'evals/runs/mcp-installed-v2-20260913/task.txt'), 'utf8').trim();
  if (historicalTask !== originalTask) throw Error('Original task differs from preserved historical request.');
  const config = { $schema: 'https://opencode.ai/config.json', enabled_providers: ['opencode'], autoupdate: false, share: 'disabled', plugin: [], lsp: false, formatter: false, permission: { '*': 'deny' } };
  write(path.join(run, 'workspace/opencode.json'), json(config));
  const catalog = execute(run, 'catalog', ['/runtime/opencode', 'models', 'opencode', '--verbose', '--pure']).stdout;
  const model = assertFreeModel(parseModelCatalog(catalog), 'opencode/ling-3.0-flash-fin-free');
  config.model = model.id; config.small_model = model.id;
  write(path.join(run, 'workspace/opencode.json'), json(config), true);
  let previousLocator, previousWorkflowHash;
  if (mode === 'edit') {
    previousLocator = readJSON(path.join(previous, 'workspace/output.json'));
    previousWorkflowHash = readJSON(path.join(previous, 'candidate.json')).workflowHash;
    cpSync(path.join(previous, 'workspace/.foundry'), path.join(run, 'workspace/.foundry'), { recursive: true, errorOnExist: true, force: false });
    write(path.join(run, 'previous-locator.json'), json(previousLocator));
    write(path.join(run, 'previous-workspace-inventory.json'), json(inventory(path.join(previous, 'workspace'))));
  }
  const installation = JSON.parse(execute(run, 'install', cli('install', '--project', '/task', '--client', 'opencode', '--no-hooks'), { writableConfig: true }).stdout);
  const installedConfig = readJSON(path.join(run, 'workspace/opencode.json')), installedCommand = installedConfig.mcp['workflow-foundry'].command;
  installedConfig.permission = { '*': 'deny', read: { '*': 'deny', '/task/inputs/*': 'allow', '/task/.agents/skills/*': 'allow', '/task/output.json': 'allow', 'output.json': 'allow' }, edit: { '*': 'deny', '/task/output.json': 'allow', 'output.json': 'allow' }, skill: { '*': 'deny', ...Object.fromEntries(selectedSkills.map(name => [name, 'allow'])) }, 'workflow-foundry_*': 'allow' };
  const permissionBefore = structuredClone(installedConfig.permission);
  installedConfig.permission = taskPermissionAliases(installedConfig.permission);
  write(path.join(run, 'workspace/opencode.json'), json(installedConfig), true);
  const request = JSON.parse(execute(run, 'request', cli('request', '--text', mode === 'edit' ? editTask : originalTask, ...(mode === 'edit' ? ['--workflow', previousLocator.workflowId, '--expected-hash', previousWorkflowHash] : []))).stdout);
  write(path.join(run, 'task.txt'), (mode === 'edit' ? editTask : originalTask) + '\n');
  write(path.join(run, 'original-task.txt'), originalTask + '\n');
  let prompt = `Use the installed native skill tool to load workflow-foundry, then use the real workflow-foundry MCP server to process queued request ${request.id}. Obtain foundry_design_context with this requestId and domain software. Construct your own reusable workflow from that natural-language request, validate it, submit a request-bound proposal, apply that proposal, run the saved workflow once with input {"values":[3,7,11]}, and inspect the resulting run/event receipt. Do not substitute a summary for actual tool calls, write server state directly, or claim independent task qualification. Keep all work within the requested local synthetic task. Finally write /task/output.json containing exactly requestId, proposalId, workflowId and runId from the actual tool responses. No shell, external tools or paid providers are available. You may correct validator/tool failures within this one bounded session.`;
  if (mode === 'edit') prompt += ' This is a version-bound edit of the existing workflow. Read its prior program from the actual design context, create a new version for the queued change, and preserve the old version and runs.';
  if (mode === 'retry') {
    const feedbackFile = path.join(previous, 'next-interface-feedback.json');
    if (!existsSync(feedbackFile)) throw Error('A retry requires separately preserved evidence-bound feedback for one interface issue.');
    const feedback = readJSON(feedbackFile);
    if (typeof feedback.issue !== 'string' || typeof feedback.evidence !== 'string' || feedback.workflowEdits !== 0) throw Error('Invalid retry diagnostic record.');
    write(path.join(run, 'workspace/inputs/feedback.json'), json(feedback));
    prompt += ' Read /task/inputs/feedback.json first. It contains preserved diagnostic evidence from the preceding attempt, not a workflow solution. Use the NEW request id in this prompt.';
  }
  write(path.join(run, 'prompt.txt'), prompt + '\n');
  const manifest = { id: path.basename(run), campaign, mode: 'actual-tui', condition: 'typed-installed-skills-actual-mcp', revision: mode, split: 'diagnostic-transport', createdAt: new Date().toISOString(), status: 'prepared', previous: previousID ?? null, previousLocator, previousWorkflowHash, model: model.id, observedModelMetadata: model.metadata, requestId: request.id, selectedSkills, installation, installedCommand, sourceIdentity: snapshot.sourceIdentity, dependencyIdentity: snapshot.dependencyIdentity, binarySHA256: snapshot.binaries.opencode.sha256, promptSHA256: hashBytes(readFileSync(path.join(run, 'prompt.txt'))), taskSHA256: hashBytes(readFileSync(path.join(run, 'task.txt'))), protocolSHA256: hashBytes(readFileSync(path.join(run, 'protocol.md'))), configSHA256: hashBytes(readFileSync(path.join(run, 'workspace/opencode.json'))), wallBudgetSeconds: 240, newModelSessionLimit: 3, operatorInterventions: [{ actor: 'worker-9', type: 'READY-source-freeze-real-installer-task-staging', workflowEdits: 0, description: mode === 'edit' ? 'Preserved original workflow/state, fresh TUI state, output-field NL edit.' : 'Unchanged historical task, no candidate authored; typed transport implementation from prime.' }] };
  manifest.preparationSHA256 = hashBytes(readFileSync(source));
  manifest.operatorInterventions.push({ actor: 'worker-9', type: 'non-git-worktree-permission-path-alias', workflowEdits: 0, before: permissionBefore, after: installedConfig.permission, description: 'Actual isolated OpenCode project row had worktree /. Add only task-prefixed spellings of the same input/skill/locator paths. Existing star denials remain.' });
  write(path.join(run, 'preparation.mjs'), readFileSync(source));
  write(path.join(run, 'manifest.json'), json(manifest));
  const observed = await mcpClient(run, path.join(run, 'workspace'), client => client.listTools({}, { timeout: 15000 }));
  write(path.join(run, 'mcp-catalog.json'), json(observed));
  const qualification = inspectTransportCatalog(observed);
  write(path.join(run, 'mcp-catalog-check.json'), json(qualification));
  if (!qualification.passed) throw Error(qualification.errors.join('\n'));
  execute(run, 'skills', ['/runtime/opencode', 'debug', 'skill', '--pure']);
  execute(run, 'mcp-connected', ['/runtime/opencode', 'mcp', 'list', '--pure']);
  return { run, requestId: request.id, installedCommand, model: model.id, catalogPrice: model.metadata.cost, snapshot: verifyFreeze(run) };
}

function tmux(run, args) {
  const result = spawnSync('/usr/bin/tmux', ['-S', path.join(run, 'tmux.sock'), '-f', '/dev/null', ...args], { env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', TERM: 'xterm-256color' }, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stderr);
  return result.stdout;
}
function start(run) {
  const manifest = readJSON(path.join(run, 'manifest.json'));
  if (manifest.status !== 'prepared') throw Error('A fresh prepared TUI is required.');
  const attempts = readdirSync(path.dirname(run)).filter(name => name.startsWith('mcp-typed-')).flatMap(name => {
    const file = path.join(path.dirname(run), name, 'manifest.json');
    return existsSync(file) ? [readJSON(file)] : [];
  }).filter(item => item.campaign === campaign && item.startedAt);
  if (attempts.length >= 3 || attempts.some(item => item.status === 'started')) throw Error('Campaign session or single-TUI limit reached.');
  verifyFreeze(run);
  if (hashBytes(readFileSync(path.join(run, 'workspace/opencode.json'))) !== manifest.configSHA256) throw Error('Config drift before start.');
  Object.assign(manifest, { startedAt: new Date().toISOString(), status: 'started', ordinal: attempts.length + 1 });
  write(path.join(run, 'manifest.json'), json(manifest), true);
  tmux(run, ['new-session', '-d', '-s', 'evaluation', '-x', '132', '-y', '42', '-c', path.join(run, 'workspace'), '/bin/bash', '--noprofile', '--norc']);
  tmux(run, ['set-option', '-g', 'remain-on-exit', 'on']);
  tmux(run, ['set-option', '-g', 'history-limit', '20000']);
  write(path.join(run, 'transcript.ansi'), '');
  tmux(run, ['pipe-pane', '-o', '-t', 'evaluation:0.0', `/usr/bin/cat >> ${shellQuote(path.join(run, 'transcript.ansi'))}`]);
  const launch = [path.join(run, 'runtime/node'), path.join(run, 'server/evals/mcp-typed-tui.mjs'), '_child', run].map(shellQuote).join(' ');
  tmux(run, ['send-keys', '-t', 'evaluation:0.0', '-l', 'exec ' + launch]);
  tmux(run, ['send-keys', '-t', 'evaluation:0.0', 'Enter']);
  return { run, ordinal: manifest.ordinal, model: manifest.model, startedAt: manifest.startedAt };
}
function child(run) {
  const manifest = readJSON(path.join(run, 'manifest.json'));
  const result = spawnSync('/usr/bin/bwrap', sandbox(run, ['/runtime/opencode', '--pure', '--model', manifest.model, '--prompt', readFileSync(path.join(run, 'prompt.txt'), 'utf8')]), { env: environment(), stdio: 'inherit', timeout: 240000, killSignal: 'SIGTERM' });
  write(path.join(run, 'tui.process.json'), json({ finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null }));
  process.exitCode = result.status ?? 1;
}
function stop(run) {
  const manifest = readJSON(path.join(run, 'manifest.json'));
  if (manifest.status !== 'started') throw Error('Expected an active owned TUI.');
  write(path.join(run, 'screen-final.txt'), tmux(run, ['capture-pane', '-p', '-t', 'evaluation:0.0', '-S', '-1000']));
  tmux(run, ['kill-server']);
  Object.assign(manifest, { status: 'stopped', stoppedAt: new Date().toISOString(), outputSHA256: existsSync(path.join(run, 'workspace/output.json')) ? hashBytes(readFileSync(path.join(run, 'workspace/output.json'))) : null });
  write(path.join(run, 'manifest.json'), json(manifest), true);
  const before = inventory(path.join(run, 'workspace'));
  cpSync(path.join(run, 'workspace'), path.join(run, 'tui-workspace-preserved'), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
  const copied = inventory(path.join(run, 'tui-workspace-preserved'));
  if (!isDeepStrictEqual(before, copied) || !isDeepStrictEqual(before, inventory(path.join(run, 'workspace')))) throw Error('Workspace changed during preservation; retain acquisition failure.');
  write(path.join(run, 'stopped-workspace-inventory.json'), json(copied));
  return { run, status: manifest.status };
}

export function mcpValue(part) {
  try {
    const value = JSON.parse(part.state.output);
    if (value.isError) return null;
    return value.content ? JSON.parse(value.content.find(item => item.type === 'text').text) : value;
  } catch { return null; }
}
export function inspectModelChain({ manifest, session, state, locator }) {
  const parts = session?.messages?.flatMap(message => message.parts ?? []) ?? [];
  const completed = parts.filter(part => part.type === 'tool' && part.state?.status === 'completed');
  const errors = [], has = (name, predicate) => completed.some(part => part.tool?.endsWith('_' + name) && predicate(mcpValue(part), part.state.input));
  const partial = Object.fromEntries(['foundry_design_context', 'foundry_validate', 'foundry_propose', 'foundry_apply_proposal', 'foundry_run', 'foundry_run_json', 'foundry_inspect'].map(name => [name, completed.filter(part => part.tool?.endsWith('_' + name) && mcpValue(part)).length]));
  const proposal = state.proposals?.find(item => item.id === locator?.proposalId);
  const request = state.requests?.find(item => item.id === manifest.requestId);
  const candidatePart = completed.find(part => part.tool?.endsWith('_foundry_propose') && part.state.input?.requestId === manifest.requestId && mcpValue(part)?.id === proposal?.id);
  const candidate = candidatePart?.state.input?.workflow;
  if (!completed.some(part => part.tool === 'skill' && part.state.input?.name === 'workflow-foundry')) errors.push('Missing actual native workflow-foundry skill load.');
  if (!locator || !isDeepStrictEqual(Object.keys(locator).sort(), ['proposalId', 'requestId', 'runId', 'workflowId']) || locator.requestId !== manifest.requestId || candidate?.id !== locator.workflowId) errors.push('Locator does not bind request and model candidate.');
  if (!proposal || !candidate || !isDeepStrictEqual(proposal.workflow, candidate)) errors.push('Persisted proposal does not equal completed model submission.');
  if (request?.status !== 'applied' || proposal?.status !== 'applied') errors.push('Request/proposal were not applied.');
  if (!has('foundry_design_context', (value, input) => input?.requestId === manifest.requestId && value?.requestId === manifest.requestId && typeof value.contextHash === 'string')) errors.push('Missing request-bound design context.');
  if (!has('foundry_validate', (value, input) => value?.valid === true && candidate && isDeepStrictEqual(input?.workflow, candidate))) errors.push('Exact model candidate lacks successful validation.');
  if (!has('foundry_apply_proposal', (value, input) => value?.status === 'applied' && input?.proposalId === proposal?.id)) errors.push('Missing actual application of the locator proposal.');
  const acceptedRun = (value, input) => value?.status === 'succeeded' && value.id === locator?.runId && value.workflowHash === proposal?.workflowHash && [candidate?.id, proposal?.workflowHash].includes(input?.workflowId);
  const objectRun = has('foundry_run', (value, input) => acceptedRun(value, input) && isDeepStrictEqual(input?.input, { values: [3, 7, 11] }));
  const jsonRun = has('foundry_run_json', (value, input) => { try { return acceptedRun(value, input) && typeof input.inputJson === 'string' && isDeepStrictEqual(JSON.parse(input.inputJson), { values: [3, 7, 11] }); } catch { return false; } });
  if (!objectRun && !jsonRun) errors.push('Missing actual sample run tied to candidate, locator and exact input.');
  if (!has('foundry_inspect', (value, input) => input?.runId === locator?.runId && value?.id === locator?.runId && value?.workflowHash === proposal?.workflowHash && Array.isArray(value?.events))) errors.push('Missing actual inspect of the locator run.');
  if (!state.runs?.some(item => item.id === locator?.runId && item.workflowId === locator?.workflowId && item.status === 'succeeded')) errors.push('No persisted successful locator run.');
  return { passed: errors.length === 0, errors, partial, proposal, candidate, request, transport: objectRun ? 'object' : jsonRun ? 'explicit-json-text' : null, runArguments: parts.filter(part => /_foundry_run(?:_json)?$/.test(part.tool ?? '')).map(part => ({ tool: part.tool, status: part.state?.status, inputType: typeof part.state?.input?.input, arguments: part.state?.input, error: part.state?.error })) };
}

async function independent(run, chain, locator, manifest) {
  const workspace = path.join(run, 'controls/workspace'); mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const report = { condition: 'independent-actual-mcp', modelCalls: 0, calls: [], cases: [], workflowHash: chain.proposal.workflowHash };
  const rawCalls = path.join(run, 'independent-calls.jsonl'); write(rawCalls, '');
  const record = value => { report.calls.push(value); appendFileSync(rawCalls, JSON.stringify(value) + '\n'); };
  const wanted = values => ({ total: values.reduce((sum, value) => sum + value, 0), count: values.length, ...(manifest.revision === 'edit' ? { values } : {}) });
  const bytesFor = (where, id) => {
    if (!/^[a-f0-9-]{36}$/.test(id ?? '')) return undefined;
    const file = path.join(where, '.foundry/artifacts', id, 'totals.json');
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  };
  const textPart = value => JSON.parse(value.content.find(item => item.type === 'text').text);
  try {
  await mcpClient(run, path.join(run, 'workspace'), async client => {
    const response = await client.callTool({ name: 'foundry_inspect', arguments: { runId: locator.runId } }, undefined, { timeout: 15000 });
    record({ name: 'foundry_inspect', arguments: { runId: locator.runId }, response });
    report.cases.push({ caseId: 'actual-tui-sample', ...inspectRollup({ run: textPart(response), artifactBytes: bytesFor(path.join(run, 'workspace'), locator.runId), expected: wanted([3, 7, 11]), workflowHash: chain.proposal.workflowHash }) });
    if (manifest.revision === 'edit') {
      const old = await client.callTool({ name: 'foundry_inspect', arguments: { runId: manifest.previousLocator.runId } }, undefined, { timeout: 15000 });
      record({ name: 'foundry_inspect', arguments: { runId: manifest.previousLocator.runId }, response: old });
      const oldState = textPart(old);
      report.cases.push({ caseId: 'old-run-preserved', ...inspectRollup({ run: oldState, artifactBytes: bytesFor(path.join(run, 'workspace'), oldState.id), expected: { total: 21, count: 3 }, workflowHash: manifest.previousWorkflowHash }) });
      const replay = await client.callTool({ name: 'foundry_run', arguments: { workflowId: manifest.previousWorkflowHash, input: { values: [2, 5] } } }, undefined, { timeout: 15000 });
      record({ name: 'foundry_run', arguments: { workflowId: manifest.previousWorkflowHash, input: { values: [2, 5] } }, response: replay });
      const replayed = textPart(replay);
      const inspected = await client.callTool({ name: 'foundry_inspect', arguments: { runId: replayed.id } }, undefined, { timeout: 15000 });
      record({ name: 'foundry_inspect', arguments: { runId: replayed.id }, response: inspected });
      report.cases.push({ caseId: 'old-version-replay', ...inspectRollup({ run: textPart(inspected), artifactBytes: bytesFor(path.join(run, 'workspace'), replayed.id), expected: { total: 7, count: 2 }, workflowHash: manifest.previousWorkflowHash }) });
    }
  });
  await mcpClient(run, workspace, async client => {
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
      record({ name, arguments: args, response }); return { response, value: textPart(response) };
    };
    const saved = await call('foundry_save', { workflow: chain.candidate });
    if (saved.response.isError) throw Error('Exact candidate could not be saved for independent replay.');
    for (const [caseId, tool, args, expected] of [
      ['sample', 'foundry_run', { input: { values: [3, 7, 11] } }, wanted([3, 7, 11])],
      ['changed', 'foundry_run', { input: { values: [2, 5] } }, wanted([2, 5])],
      ['empty', 'foundry_run', { input: { values: [] } }, wanted([])],
      ['nonnumeric', 'foundry_run', { input: { values: [1, '2'] } }, null],
      ['missing-values', 'foundry_run', { input: {} }, null],
      ['nonarray', 'foundry_run', { input: { values: 7 } }, null],
      ['serialized-object-rejected', 'foundry_run', { input: '{"values":[3,7,11]}' }, null],
      ['missing-transport-input', 'foundry_run', {}, null],
      ['explicit-json-sample', 'foundry_run_json', { inputJson: '{"values":[3,7,11]}' }, wanted([3, 7, 11])],
      ['invalid-json', 'foundry_run_json', { inputJson: '{broken' }, null],
      ['double-encoded-json', 'foundry_run_json', { inputJson: JSON.stringify('{"values":[3,7,11]}') }, null],
    ]) {
      const artifacts = path.join(workspace, '.foundry/artifacts');
      const before = existsSync(artifacts) ? inventory(artifacts) : {};
      const executed = await call(tool, { workflowId: chain.proposal.workflowHash, ...args });
      if (expected === null && executed.response.isError) {
        const after = existsSync(artifacts) ? inventory(artifacts) : {};
        report.cases.push({ caseId, passed: ['SCHEMA_MISMATCH', 'INPUT_JSON'].includes(executed.value.error?.code) && isDeepStrictEqual(before, after), code: executed.value.error?.code, artifactsUnchanged: isDeepStrictEqual(before, after) });
      } else if (typeof executed.value.id === 'string') {
        const inspected = await call('foundry_inspect', { runId: executed.value.id });
        report.cases.push({ caseId, ...inspectRollup({ run: inspected.value, artifactBytes: bytesFor(workspace, executed.value.id), expected, workflowHash: chain.proposal.workflowHash }) });
      } else report.cases.push({ caseId, passed: false, error: 'No inspectable run or valid rejection.', response: executed.response });
    }
  });
  report.passed = report.cases.length === (manifest.revision === 'edit' ? 14 : 12) && report.cases.every(item => item.passed);
  } catch (error) { report.passed = false; report.error = { message: error.message, stack: error.stack }; }
  finally { report.finishedAt = new Date().toISOString(); write(path.join(run, 'independent-mcp.json'), json(report)); }
  return report;
}

async function score(run) {
  const manifest = readJSON(path.join(run, 'manifest.json'));
  if (manifest.status !== 'stopped') throw Error('Stop actual TUI before scoring.');
  const session = readJSON(path.join(run, 'session-export-local.stdout.txt'));
  const output = existsSync(path.join(run, 'workspace/output.json')) ? readFileSync(path.join(run, 'workspace/output.json'), 'utf8') : undefined;
  const evidence = inspectTuiEvidence({ manifest, session, prompt: readFileSync(path.join(run, 'prompt.txt'), 'utf8'), transcript: readFileSync(path.join(run, 'transcript.ansi'), 'utf8'), output });
  const state = JSON.parse(execute(run, 'foundry-state', cli('state'), { offline: true }).stdout);
  let locator; try { locator = JSON.parse(output); } catch { /* Failure remains explicit in the chain gate. */ }
  const chain = inspectModelChain({ manifest, session, state, locator });
  const errors = [...evidence.errors, ...chain.errors];
  if (hashBytes(readFileSync(path.join(run, 'workspace/opencode.json'))) !== manifest.configSHA256) errors.push('Installed configuration drift.');
  const stable = verifyFreeze(run);
  if (chain.candidate) write(path.join(run, 'candidate.json'), json({ workflow: chain.candidate, workflowHash: chain.proposal.workflowHash, proposalId: chain.proposal.id, requestId: manifest.requestId, sessionSHA256: hashBytes(readFileSync(path.join(run, 'session-export-local.stdout.txt'))), modelCandidateSHA256: hashBytes(canonical(chain.candidate)), manualEdits: 0 }));
  let controls;
  if (!errors.length) {
    try { controls = await independent(run, chain, locator, manifest); }
    catch (error) { errors.push(`Independent MCP replay failed: ${error.message}`); write(path.join(run, 'independent-error.json'), json({ message: error.message, stack: error.stack })); }
  }
  if (manifest.revision === 'edit' && chain.candidate && (chain.proposal.workflowHash === manifest.previousWorkflowHash || chain.proposal.baseHash !== manifest.previousWorkflowHash)) errors.push('Edit did not create a distinct version bound to the prior hash.');
  const report = { evaluatedAt: new Date().toISOString(), condition: manifest.condition, revision: manifest.revision, source: stable, evidence, chain, errors, controls: controls ? { passed: controls.passed, cases: controls.cases } : null, passed: errors.length === 0 && controls?.passed === true, limitations: ['Exposed bounded diagnostic tasks; no product parity or heldout inference.', 'The exported tool arguments establish client behavior; model-versus-schema-conversion origin is not inferred.', 'System OS/shared libraries are not a frozen filesystem image.'] };
  verifyFreeze(run);
  write(path.join(run, 'typed-score.json'), json(report));
  return { run, passed: report.passed, errors, partial: chain.partial, transport: chain.transport, cost: evidence.cost, model: evidence.model, controls: report.controls, source: stable };
}

async function main() {
  const [action, id, ...args] = process.argv.slice(2), run = directory(id);
  if (action === 'prepare') return prepare(id, args[0], args[1], args[2]);
  if (action === 'start') return start(run);
  if (action === '_child') return child(run);
  if (action === 'stop') return stop(run);
  if (action === 'verify-freeze') return verifyFreeze(run);
  if (action === 'screen') {
    const value = tmux(run, ['capture-pane', '-p', '-t', 'evaluation:0.0', '-S', '-1000']);
    write(path.join(run, `screen-${Date.now()}.txt`), value); return value;
  }
  if (action === 'sessions') return execute(run, `sessions-${Date.now()}`, ['/runtime/opencode', 'session', 'list', '--format', 'json', '--pure']).stdout;
  if (action === 'export') {
    if (!/^ses_[A-Za-z0-9]+$/.test(args[0] ?? '')) throw Error('Use an observed session id.');
    const exported = JSON.parse(execute(run, 'session-export-local', ['/runtime/opencode', 'export', args[0], '--pure']).stdout);
    return { id: exported.info.id, model: exported.info.model, cost: exported.info.cost, final: exported.messages.some(message => message.info.finish === 'stop'), tools: exported.messages.flatMap(message => message.parts ?? []).filter(part => part.type === 'tool').map(part => ({ tool: part.tool, status: part.state?.status, error: part.state?.error })) };
  }
  if (action === 'score') return score(run);
  throw Error('Use prepare|start|screen|sessions|stop|export|score|verify-freeze RUN [ARGS].');
}
if (process.argv[1] && path.resolve(process.argv[1]) === source) {
  process.umask(0o077);
  main().then(result => { if (result !== undefined) console.log(typeof result === 'string' ? result : json(result)); }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
