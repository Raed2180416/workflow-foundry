#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runDirectory, shellQuote } from './opencode-harness.mjs';
import { hashBytes, inspectTuiEvidence } from './evidence.mjs';

const source = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(source), '..');
const json = value => JSON.stringify(value, null, 2) + '\n';
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value, replace = false) => {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, value, { flag: replace ? 'w' : 'wx', mode: 0o600 }); chmodSync(file, 0o600);
};
const files = ['bin/foundry.mjs', 'src/foundry.mjs', 'src/store.mjs', 'src/runtime.mjs', 'src/data.mjs', 'src/validate.mjs', 'src/capabilities.mjs', 'src/install.mjs', 'src/hooks.mjs', 'src/components.mjs', 'src/mcp.mjs', 'schemas/workflow.schema.json', 'package.json', 'package-lock.json'];
const skills = ['workflow-foundry', 'runtime-native', 'domain-software', 'human-steering'];
const task = 'Create a new reusable bounded workflow named NumericRollup, version 1. It accepts input.values, an array of at most 100 actual numbers. Produce an actual UTF-8 JSON artifact named totals.json with exactly total (the sum of the supplied values) and count (the number of supplied values). Recompute from input at execution time. Empty input must produce total 0 and count 0. Missing, non-array or nonnumeric values must fail without claiming success or writing the result. Acceptance must inspect actual capability results, including the produced artifact; a constant report is insufficient. Use only registered capabilities. Budget: at most 12 steps, concurrency at most 3, total execution duration at most 5000ms, cost 0; task timeouts at most 1000ms and one attempt. This is a synthetic local data-processing task, not production deployment.';
function env() {
  return { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor', XDG_CONFIG_HOME: '/state/config', XDG_DATA_HOME: '/state/data', XDG_CACHE_HOME: '/state/cache', XDG_STATE_HOME: '/state/state', OPENCODE_CONFIG: '/task/opencode.json', OPENCODE_CONFIG_DIR: '/state/config/opencode' };
}
function sandbox(run, command, { writableConfig = false } = {}) {
  return ['--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', process.env.HOME, '--dir', '/etc', '--ro-bind', '/etc/ssl', '/etc/ssl', '--ro-bind', realpathSync('/etc/resolv.conf'), '/etc/resolv.conf', '--ro-bind', '/etc/hosts', '/etc/hosts', '--bind', path.join(run, 'state'), '/state', '--bind', path.join(run, 'workspace'), '/task', '--ro-bind', path.join(run, 'server'), '/server', '--ro-bind', path.join(root, 'node_modules'), '/server/node_modules', ...(!writableConfig ? ['--ro-bind', path.join(run, 'workspace/opencode.json'), '/task/opencode.json'] : []), ...(existsSync(path.join(run, 'workspace/inputs')) ? ['--ro-bind', path.join(run, 'workspace/inputs'), '/task/inputs'] : []), ...(!writableConfig && existsSync(path.join(run, 'workspace/.agents')) ? ['--ro-bind', path.join(run, 'workspace/.agents'), '/task/.agents'] : []), '--chdir', '/task', ...command];
}
function execute(run, label, command, options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync('/usr/bin/bwrap', sandbox(run, command, options), { env: env(), encoding: 'utf8', timeout: 45000, maxBuffer: 20 * 1024 * 1024 });
  write(path.join(run, `${label}.stdout.txt`), result.stdout ?? '');
  write(path.join(run, `${label}.stderr.txt`), result.stderr ?? '');
  write(path.join(run, `${label}.process.json`), json({ command, startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null }));
  if (!options.allowFailure && (result.error || result.status !== 0)) throw Error(`${label} failed: ${result.error?.message ?? result.stderr}`);
  return result;
}
function base(...args) {
  const result = spawnSync(process.execPath, [path.join(root, 'evals/opencode-harness.mjs'), ...args], { cwd: root, encoding: 'utf8', timeout: 45000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw Error(result.error?.message ?? result.stderr);
  return result.stdout;
}
function tmux(run, args) {
  const result = spawnSync('/usr/bin/tmux', ['-S', path.join(run, 'tmux.sock'), '-f', '/dev/null', ...args], { env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', TERM: 'xterm-256color' }, encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) throw Error(result.stderr); return result.stdout;
}
function prepare(id, previousRun) {
  let previousDirectory, previousManifest, previousReport;
  if (previousRun) {
    previousDirectory = runDirectory(previousRun);
    previousManifest = readJSON(path.join(previousDirectory, 'manifest.json'));
    previousReport = readJSON(path.join(previousDirectory, 'mcp-integration-score.json'));
    if (previousReport.passed || previousManifest.previousRun) throw Error('Only one follow-up after the first failed integration is permitted.');
  }
  base('prepare', id); base('inspect', id, 'catalog'); base('select', id, 'opencode/ling-3.0-flash-fin-free');
  const run = runDirectory(id), sourceHashes = {};
  const sourceRoot = previousDirectory ? path.join(previousDirectory, 'server') : root;
  const copy = name => { const bytes = readFileSync(path.join(sourceRoot, name)); sourceHashes[name] = hashBytes(bytes); write(path.join(run, 'server', name), bytes); };
  for (const name of files) copy(name);
  mkdirSync(path.join(run, 'server/node_modules'), { mode: 0o700 });
  const copyMarkdown = name => { for (const item of readdirSync(path.join(sourceRoot, name), { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw Error('Skill symlinks require review.');
    const child = path.posix.join(name, item.name);
    if (item.isDirectory()) copyMarkdown(child); else if (item.isFile() && item.name.endsWith('.md')) copy(child);
  } };
  for (const name of skills) copyMarkdown(`skills/${name}`);
  write(path.join(run, 'protocol.md'), readFileSync(path.join(root, 'evals/MCP-TUI-PROTOCOL.md')));
  write(path.join(run, 'server-snapshot.json'), json({ frozenAt: new Date().toISOString(), files: sourceHashes, selectedSkills: skills, dependencyMount: 'Already-installed public node_modules mounted read-only at /server/node_modules; exact package lock preserved. Dependency file bytes are not separately frozen in this transport test.' }));
  const installation = JSON.parse(execute(run, 'install', ['/usr/bin/node', '/server/bin/foundry.mjs', 'install', '--project', '/task', '--client', 'opencode', '--no-hooks'], { writableConfig: true }).stdout);
  const configPath = path.join(run, 'workspace/opencode.json'), config = readJSON(configPath);
  const installedCommand = config.mcp['workflow-foundry'].command;
  config.permission = { '*': 'deny', read: { '*': 'deny', '/task/inputs/*': 'allow', '/task/.agents/skills/*': 'allow', '/task/output.json': 'allow', 'output.json': 'allow' }, edit: { '*': 'deny', '/task/output.json': 'allow', 'output.json': 'allow' }, skill: { '*': 'deny', ...Object.fromEntries(skills.map(name => [name, 'allow'])) }, 'workflow-foundry_*': 'allow' };
  write(configPath, json(config), true);
  const request = JSON.parse(execute(run, 'request', ['/usr/bin/node', '/server/bin/foundry.mjs', 'request', '--workspace', '/task', '--text', task]).stdout);
  write(path.join(run, 'task.txt'), task + '\n');
  let prompt = `Use the installed native skill tool to load workflow-foundry, then use the real workflow-foundry MCP server to process queued request ${request.id}. Obtain foundry_design_context with this requestId and domain software. Construct your own reusable workflow from that natural-language request, validate it, submit a request-bound proposal, apply that proposal, run the saved workflow once with input {"values":[3,7,11]}, and inspect the resulting run/event receipt. Do not substitute a summary for actual tool calls, write server state directly, or claim independent task qualification. Keep all work within the requested local synthetic task. Finally write /task/output.json containing exactly requestId, proposalId, workflowId and runId from the actual tool responses. No shell, external tools or paid providers are available. You may correct validator/tool failures within this one bounded session.`;
  if (previousRun) {
    const previousSession = readJSON(path.join(previousDirectory, 'session-export-local.stdout.txt'));
    const failedCalls = previousSession.messages.flatMap(message => message.parts ?? []).filter(part => part.tool === 'workflow-foundry_foundry_run' && part.state.status === 'error').map(part => ({ arguments: part.state.input, inputType: typeof part.state.input.input, error: part.state.error }));
    const feedback = { previousRun, previousResultSHA256: hashBytes(readFileSync(path.join(previousDirectory, 'mcp-integration-score.json'))), previousSessionSHA256: hashBytes(readFileSync(path.join(previousDirectory, 'session-export-local.stdout.txt'))), failedCalls, explanation: 'Each recorded input argument was a STRING containing JSON. The workflow requires an actual OBJECT. Supply input as an object in the MCP argument, not serialized JSON text. Use native skill loading for installed skills. An applied request is closed; do not revise or save again after applying. No workflow solution is supplied.' };
    write(path.join(run, 'workspace/inputs/feedback.json'), json(feedback));
    prompt += ' This is the one diagnostic follow-up after a preserved failed TUI attempt. Read /task/inputs/feedback.json first. The prior attempt repeatedly serialized the MCP input argument as a string. For foundry_run, pass an actual object, for example {"workflowId":"NumericRollup","input":{"values":[3,7,11]}}. Do not put quotes around the input object or weaken the workflow schema. Load required skills using the native skill tool. All proposals in this new workspace must bind to its NEW request ID from this prompt; the prior request is closed. This argument-format feedback is evaluator assistance, not evidence that you executed anything.';
  }
  write(path.join(run, 'prompt.txt'), prompt + '\n');
  const manifest = readJSON(path.join(run, 'manifest.json'));
  Object.assign(manifest, { condition: 'installed-skills-actual-mcp', split: 'diagnostic-transport', requestId: request.id, previousRun: previousRun ?? null, appVersion: '1.18.29', selectedSkills: skills, installation, installedCommand, sourceHashes, protocolSHA256: hashBytes(readFileSync(path.join(run, 'protocol.md'))), restrictions: 'Native selected skills and actual local Foundry MCP allowed; external plugins/hooks, shell, web tools, private repository reads and host credentials absent.', operatorInterventions: [{ actor: 'worker-5', type: previousRun ? 'isolated-reinstall-and-observed-argument-feedback' : 'isolated-installer-and-nl-request', at: new Date().toISOString(), description: previousRun ? 'Same server source snapshot and natural-language task; exact prior failed argument types/errors and explicit object-argument example. No candidate or workflow nodes authored.' : 'Real project installer with no hooks; selected four Markdown skill packages, explicit tool permissions, and one natural-language request. No candidate or workflow nodes authored.', workflowEdits: 0 }] });
  write(path.join(run, 'manifest.json'), json(manifest), true);
  return { run, requestId: request.id, installedCommand, installation };
}
function inspect(id, kind) {
  const run = runDirectory(id), commands = { skills: ['debug', 'skill', '--pure'], mcp: ['mcp', 'list', '--pure'], sessions: ['session', 'list', '--format', 'json', '--pure'], config: ['debug', 'config', '--pure'] };
  if (!commands[kind]) throw Error('Use skills, mcp, sessions or config.');
  return execute(run, `${kind}-${Date.now()}`, ['/usr/bin/opencode', ...commands[kind]]).stdout;
}
function start(id) {
  const run = runDirectory(id), manifest = readJSON(path.join(run, 'manifest.json'));
  if (manifest.status !== 'prepared') throw Error('A fresh prepared run is required.');
  Object.assign(manifest, { startedAt: new Date().toISOString(), status: 'started', wallBudgetSeconds: 240, promptSHA256: hashBytes(readFileSync(path.join(run, 'prompt.txt'))), configSHA256: hashBytes(readFileSync(path.join(run, 'workspace/opencode.json'))), harnessSHA256: hashBytes(readFileSync(source)) });
  write(path.join(run, 'manifest.json'), json(manifest), true);
  tmux(run, ['new-session', '-d', '-s', 'evaluation', '-x', '132', '-y', '42', '-c', path.join(run, 'workspace'), '/bin/bash', '--noprofile', '--norc']);
  tmux(run, ['set-option', '-g', 'remain-on-exit', 'on']);
  write(path.join(run, 'transcript.ansi'), '');
  tmux(run, ['pipe-pane', '-o', '-t', 'evaluation:0.0', `/usr/bin/cat >> ${shellQuote(path.join(run, 'transcript.ansi'))}`]);
  tmux(run, ['send-keys', '-t', 'evaluation:0.0', '-l', 'exec ' + ['/usr/bin/node', source, '_child', id].map(shellQuote).join(' ')]);
  tmux(run, ['send-keys', '-t', 'evaluation:0.0', 'Enter']);
  return { run, status: 'started', model: manifest.model };
}
function child(id) {
  const run = runDirectory(id), manifest = readJSON(path.join(run, 'manifest.json'));
  const result = spawnSync('/usr/bin/bwrap', sandbox(run, ['/usr/bin/opencode', '--pure', '--model', manifest.model, '--prompt', readFileSync(path.join(run, 'prompt.txt'), 'utf8')]), { env: env(), stdio: 'inherit', timeout: 240000 });
  write(path.join(run, 'tui.process.json'), json({ finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null }));
  process.exitCode = result.status ?? 1;
}
function exportSession(id, sessionID) {
  if (!/^ses_[A-Za-z0-9]+$/.test(sessionID ?? '')) throw Error('Use an observed session id.');
  const result = JSON.parse(execute(runDirectory(id), 'session-export-local', ['/usr/bin/opencode', 'export', sessionID, '--pure']).stdout);
  return { id: result.info.id, model: result.info.model, cost: result.info.cost, tools: result.messages.flatMap(message => message.parts ?? []).filter(part => part.type === 'tool').map(part => ({ name: part.tool, status: part.state.status, inputKeys: Object.keys(part.state.input ?? {}), error: part.state.error })), finished: result.messages.some(message => message.info.finish === 'stop') };
}
const canonical = value => JSON.stringify((function order(item) {
  return Array.isArray(item) ? item.map(order) : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, order(item[key])])) : item;
})(value));
export function inspectRollup({ run, artifactBytes, expected, workflowHash }) {
  const errors = [], events = run?.events;
  let previousHash = null;
  if (!run || !Array.isArray(events) || !events.length) errors.push('Run/event evidence missing.');
  else {
    for (const [index, event] of events.entries()) {
      const { hash, ...body } = event;
      if (event.seq !== index + 1 || event.previousHash !== previousHash || hashBytes(canonical(body)) !== hash) errors.push('Event chain failed verification.');
      previousHash = hash;
    }
    if (run.eventHead?.seq !== events.length || run.eventHead?.hash !== previousHash) errors.push('Event tail differs from the persisted checkpoint.');
  }
  if (!workflowHash || run?.workflowHash !== workflowHash) errors.push('Run does not bind the submitted workflow hash.');
  const intents = (events ?? []).filter(event => event.type === 'tool.intent' && event.tool === 'core.artifact');
  const completions = intents.flatMap(intent => (events ?? []).filter(event => event.type === 'node.completed' && event.nodeKey === intent.nodeKey && event.seq > intent.seq));
  let artifact;
  if (artifactBytes !== undefined) {
    try { artifact = JSON.parse(artifactBytes); } catch { errors.push('Artifact is not valid JSON.'); }
  }
  if (expected === null) {
    if (run?.status !== 'failed' || artifactBytes !== undefined || completions.length) errors.push('Invalid input did not fail without writing an artifact.');
  } else {
    if (run?.status !== 'succeeded' || !isDeepStrictEqual(artifact, expected)) errors.push('Artifact does not satisfy the numeric task.');
    if (completions.length !== 1 || completions[0].output?.name !== 'totals.json' || completions[0].output?.sha256 !== (artifactBytes === undefined ? null : hashBytes(artifactBytes)) || completions[0].output?.bytes !== (artifactBytes === undefined ? -1 : Buffer.byteLength(artifactBytes))) errors.push('Missing or mismatched actual artifact completion receipt.');
  }
  return { passed: errors.length === 0, errors, artifact, artifactEventCount: completions.length };
}
function mcpValue(part) {
  try {
    const value = JSON.parse(part.state.output);
    if (value.isError) return null;
    return value.content ? JSON.parse(value.content.find(item => item.type === 'text').text) : value;
  } catch { return null; }
}
function score(id) {
  const run = runDirectory(id), manifest = readJSON(path.join(run, 'manifest.json'));
  if (manifest.status !== 'stopped') throw Error('Stop the TUI before scoring.');
  const session = readJSON(path.join(run, 'session-export-local.stdout.txt'));
  const outputPath = path.join(run, 'workspace/output.json');
  const evidence = inspectTuiEvidence({ manifest, session, prompt: readFileSync(path.join(run, 'prompt.txt'), 'utf8'), transcript: readFileSync(path.join(run, 'transcript.ansi'), 'utf8'), output: existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : undefined });
  const errors = [...evidence.errors], completed = session.messages.flatMap(message => message.parts ?? []).filter(part => part.type === 'tool' && part.state.status === 'completed');
  for (const [name, hash] of Object.entries(manifest.sourceHashes)) if (hashBytes(readFileSync(path.join(run, 'server', name))) !== hash) errors.push(`Server source drift: ${name}`);
  if (hashBytes(readFileSync(path.join(run, 'workspace/opencode.json'))) !== manifest.configSHA256) errors.push('Installed config drift.');
  if (!completed.some(part => part.tool === 'skill' && part.state.input?.name === 'workflow-foundry')) errors.push('No successful native installed skill load.');
  const requirements = {
    foundry_design_context: value => value?.requestId === manifest.requestId && typeof value.contextHash === 'string',
    foundry_validate: value => value?.valid === true,
    foundry_propose: value => value?.requestId === manifest.requestId && typeof value.id === 'string',
    foundry_apply_proposal: value => value?.status === 'applied',
    foundry_run: value => value?.status === 'succeeded',
    foundry_inspect: value => Array.isArray(value?.events),
  };
  for (const [name, qualify] of Object.entries(requirements)) if (!completed.some(part => part.tool.endsWith('_' + name) && qualify(mcpValue(part)))) errors.push(`No actual successful MCP ${name} response.`);
  const state = JSON.parse(execute(run, 'foundry-state', ['/usr/bin/node', '/server/bin/foundry.mjs', 'state', '--workspace', '/task']).stdout);
  let locator;
  try { locator = readJSON(outputPath); } catch { errors.push('No valid model-written locator.'); }
  const proposal = state.proposals.find(item => item.id === locator?.proposalId);
  const request = state.requests.find(item => item.id === manifest.requestId);
  const candidate = completed.find(part => part.tool.endsWith('_foundry_propose') && part.state.input?.requestId === manifest.requestId && mcpValue(part)?.id === proposal?.id)?.state.input?.workflow;
  if (!proposal || !candidate || !isDeepStrictEqual(proposal.workflow, candidate)) errors.push('Saved proposal differs from the model MCP submission.');
  if (!locator || !isDeepStrictEqual(Object.keys(locator).sort(), ['proposalId', 'requestId', 'runId', 'workflowId']) || locator.requestId !== manifest.requestId || candidate?.id !== locator.workflowId) errors.push('Model locator does not match the actual request/candidate.');
  if (request?.status !== 'applied') errors.push('Natural-language request was not applied.');
  if (proposal?.status !== 'applied') errors.push('Proposal was not applied.');
  if (!state.runs.some(item => item.id === locator?.runId && item.workflowId === locator?.workflowId && item.status === 'succeeded')) errors.push('Locator has no corresponding successful actual run.');
  const cases = [];
  if (!errors.length) for (const [caseId, input, wanted] of [['tui-sample', { values: [3, 7, 11] }, { total: 21, count: 3 }], ['changed-input', { values: [2, 5] }, { total: 7, count: 2 }], ['empty', { values: [] }, { total: 0, count: 0 }], ['invalid-type', { values: [1, '2'] }, null]]) {
    const command = caseId === 'tui-sample' ? ['/usr/bin/node', '/server/bin/foundry.mjs', 'inspect', locator.runId, '--workspace', '/task'] : ['/usr/bin/node', '/server/bin/foundry.mjs', 'run', locator.workflowId, '--workspace', '/task', '--input', JSON.stringify(input)];
    const result = execute(run, `verify-${caseId}`, command, { allowFailure: true });
    let data; try { data = JSON.parse(result.stdout); } catch { /* Missing output is a failed oracle. */ }
    let artifactBytes, artifactError;
    if (/^[0-9a-f-]{36}$/.test(data?.id ?? '')) {
      const file = path.join(run, 'workspace/.foundry/artifacts', data.id, 'totals.json');
      try { artifactBytes = readFileSync(file, 'utf8'); } catch (error) { artifactError = error.message; }
    }
    const verdict = inspectRollup({ run: data, artifactBytes, expected: wanted, workflowHash: proposal.workflowHash });
    cases.push({ caseId, input, expected: wanted, ...verdict, exitCode: result.status, status: data?.status, runId: data?.id, artifactError });
  }
  const report = { evaluatedAt: new Date().toISOString(), condition: manifest.condition, evidence, errors, request, proposalId: proposal?.id, modelCandidateSHA256: candidate ? hashBytes(canonical(candidate)) : null, cases, passed: !errors.length && cases.length === 4 && cases.every(item => item.passed), limitations: ['Single diagnostic actual-TUI/MCP integration, not heldout model quality or SRE hostcontract evidence.', 'Default registry, no project hook evaluation.', 'Node dependencies read-only from installed packages; no claim of frozen dependency bytes.'] };
  write(path.join(run, 'mcp-integration-score.json'), json(report));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === source) {
  process.umask(0o077);
  try {
    const [action, id, ...args] = process.argv.slice(2);
    const result = action === 'prepare' ? prepare(id, args[0]) : action === 'inspect' ? inspect(id, args[0]) : action === 'start' ? start(id) : action === '_child' ? child(id) : action === 'export' ? exportSession(id, args[0]) : action === 'score' ? score(id) : ['screen', 'stop'].includes(action) ? base(action, id) : (() => { throw Error('Use prepare|inspect|start|screen|stop|export|score RUN [ARG].'); })();
    if (result !== undefined) console.log(typeof result === 'string' ? result : json(result));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
