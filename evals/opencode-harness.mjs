#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(source), '..');
const runs = path.join(root, 'evals/runs');
const binary = '/usr/bin/opencode';
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const write = (file, data) => { writeFileSync(file, data, { mode: 0o600 }); chmodSync(file, 0o600); };
const readJSON = file => JSON.parse(readFileSync(file, 'utf8'));

export function runDirectory(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id ?? '')) throw Error('Run ID must be 1–32 lowercase letters, digits or hyphens.');
  return path.join(runs, id);
}

export function shellQuote(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw Error('Invalid shell argument.');
  return "'" + text.replaceAll("'", "'\\''") + "'";
}

export function parseModelCatalog(text) {
  const blocks = text.split(/^(?=opencode\/[^\s]+\s*$)/m).filter(part => part.startsWith('opencode/'));
  return blocks.map(block => {
    const id = block.slice(0, block.indexOf('\n')).trim();
    const start = block.indexOf('{');
    const end = block.lastIndexOf('}');
    if (start < 0 || end < start) throw Error(`Missing metadata for ${id}`);
    return { id, metadata: JSON.parse(block.slice(start, end + 1)) };
  });
}

export function assertFreeModel(catalog, id) {
  const item = catalog.find(entry => entry.id === id);
  if (!item || !id.startsWith('opencode/')) throw Error('Selected model was not observed in the isolated OpenCode catalog.');
  const cost = item.metadata.cost;
  if (!cost || cost.input !== 0 || cost.output !== 0) throw Error('Input and output prices must both be explicitly zero.');
  const checkPrice = (value, key) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [child, amount] of Object.entries(value)) checkPrice(amount, `${key}.${child}`);
    } else if (value !== 0) throw Error(`Nonzero or unknown model price: ${key}`);
  };
  checkPrice(cost, 'cost');
  return item;
}

function environment() {
  // Preserve the existing HOME value. Its host contents are absent inside bwrap.
  return {
    PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8',
    TERM: 'xterm-256color', COLORTERM: 'truecolor',
    XDG_CONFIG_HOME: '/state/config', XDG_DATA_HOME: '/state/data',
    XDG_CACHE_HOME: '/state/cache', XDG_STATE_HOME: '/state/state',
    OPENCODE_CONFIG: '/task/opencode.json', OPENCODE_CONFIG_DIR: '/state/config/opencode',
  };
}

function sandboxArgs(run, args) {
  const readonlyInputs = existsSync(path.join(run, 'workspace/inputs'))
    ? ['--ro-bind', path.join(run, 'workspace/inputs'), '/task/inputs'] : [];
  return [
    '--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid',
    '--unshare-ipc', '--unshare-uts', '--cap-drop', 'ALL',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--dir', '/home', '--dir', process.env.HOME,
    '--dir', '/etc', '--ro-bind', '/etc/ssl', '/etc/ssl',
    '--ro-bind', realpathSync('/etc/resolv.conf'), '/etc/resolv.conf',
    '--ro-bind', '/etc/hosts', '/etc/hosts',
    '--bind', path.join(run, 'state'), '/state',
    '--bind', path.join(run, 'workspace'), '/task',
    '--ro-bind', path.join(run, 'workspace/opencode.json'), '/task/opencode.json',
    ...readonlyInputs,
    '--chdir', '/task', binary, ...args,
  ];
}

function isolated(run, args, options = {}) {
  return spawnSync('/usr/bin/bwrap', sandboxArgs(run, args), {
    env: environment(), encoding: 'utf8', timeout: 45000,
    maxBuffer: 16 * 1024 * 1024, ...options,
  });
}

function saveProcess(run, name, args) {
  if (existsSync(path.join(run, `${name}.stdout.txt`))) name += `-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const result = isolated(run, args);
  write(path.join(run, `${name}.stdout.txt`), result.stdout ?? '');
  write(path.join(run, `${name}.stderr.txt`), result.stderr ?? '');
  write(path.join(run, `${name}.process.json`), json({
    startedAt, finishedAt: new Date().toISOString(), args,
    exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
  }));
  if (result.error || result.status !== 0) throw Error(`${name} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function tmux(run, args) {
  const result = spawnSync('/usr/bin/tmux', ['-S', path.join(run, 'tmux.sock'), '-f', '/dev/null', ...args], {
    env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', TERM: 'xterm-256color' },
    encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw Error(`tmux ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function prepare(id) {
  const run = runDirectory(id);
  if (existsSync(run)) throw Error('Run already exists; preserve it and use another ID.');
  process.umask(0o077);
  mkdirSync(run, { recursive: true, mode: 0o700 });
  for (const directory of ['workspace', 'state/config/opencode', 'state/data', 'state/cache', 'state/state']) {
    mkdirSync(path.join(run, directory), { recursive: true, mode: 0o700 });
  }
  write(path.join(run, 'workspace/opencode.json'), json({
    $schema: 'https://opencode.ai/config.json', enabled_providers: ['opencode'],
    autoupdate: false, share: 'disabled', plugin: [], lsp: false, formatter: false,
    permission: {
      '*': 'deny', read: { '*': 'deny', '/task/*': 'allow', 'task/*': 'allow', 'output.json': 'allow' },
      edit: { '*': 'deny', '/task/output.json': 'allow', 'task/output.json': 'allow', 'output.json': 'allow' },
    },
  }));
  write(path.join(run, 'manifest.json'), json({
    id, createdAt: new Date().toISOString(), mode: 'actual-tui', split: 'diagnostic',
    binary, binarySHA256: sha256(readFileSync(binary)), model: null,
    credentials: 'No host credentials or provider environment variables mounted or inherited.',
    isolation: 'bubblewrap: host home absent; fresh XDG state; only synthetic task workspace writable; host network available for free provider.',
    restrictions: 'No shell, subagents, MCP, external plugins, LSP, webfetch, websearch or automatic sharing.',
    humanInterventions: [], status: 'prepared',
  }));
  return { run, status: 'prepared', directoryMode: (statSync(run).mode & 0o777).toString(8) };
}

function main() {
  const [command, id, ...extra] = process.argv.slice(2);
  if (command === 'prepare') return prepare(id);
  const run = runDirectory(id);
  if (!existsSync(path.join(run, 'manifest.json'))) throw Error('Run was not prepared by this harness.');
  const manifest = readJSON(path.join(run, 'manifest.json'));
  if (command === 'inspect') {
    const commands = {
      version: ['--version'], help: ['--help'], models: ['models', 'opencode', '--pure'],
      catalog: ['models', 'opencode', '--verbose', '--pure'], paths: ['debug', 'paths', '--pure'],
      config: ['debug', 'config', '--pure'], sessions: ['session', 'list', '--format', 'json', '--pure'],
      exportHelp: ['export', '--help'],
    };
    if (!commands[extra[0]]) throw Error('Unknown inspection.');
    return saveProcess(run, extra[0], commands[extra[0]]);
  }
  if (command === 'select') {
    const catalog = parseModelCatalog(readFileSync(path.join(run, 'catalog.stdout.txt'), 'utf8'));
    const selected = assertFreeModel(catalog, extra[0]);
    const configPath = path.join(run, 'workspace/opencode.json');
    const config = readJSON(configPath);
    config.model = selected.id;
    config.small_model = selected.id;
    write(configPath, json(config));
    Object.assign(manifest, { model: selected.id, observedModelMetadata: selected.metadata });
    write(path.join(run, 'manifest.json'), json(manifest));
    return { selected: selected.id, cost: selected.metadata.cost };
  }
  if (command === '_child') {
    const result = isolated(run, ['--pure', '--model', manifest.model, '--prompt', readFileSync(path.join(run, 'prompt.txt'), 'utf8')], {
      stdio: 'inherit', timeout: 240000,
    });
    write(path.join(run, 'tui.process.json'), json({ finishedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message ?? null }));
    process.exitCode = result.status ?? 1;
    return;
  }
  if (command === 'start') {
    if (manifest.status !== 'prepared' || !manifest.model) throw Error('A fresh run and observed free model selection are required.');
    const prompt = readFileSync(path.join(run, 'prompt.txt'), 'utf8');
    if (!prompt.trim()) throw Error('Prompt is empty.');
    chmodSync(path.join(run, 'prompt.txt'), 0o600);
    manifest.promptSHA256 = sha256(prompt);
    manifest.configSHA256 = sha256(readFileSync(path.join(run, 'workspace/opencode.json')));
    manifest.harnessSHA256 = sha256(readFileSync(source));
    manifest.protocolSHA256 = sha256(readFileSync(path.join(root, 'evals/PROTOCOL.md')));
    manifest.startedAt = new Date().toISOString();
    manifest.wallBudgetSeconds = 240;
    manifest.status = 'started';
    write(path.join(run, 'manifest.json'), json(manifest));
    tmux(run, ['new-session', '-d', '-s', 'evaluation', '-x', '132', '-y', '42', '-c', path.join(run, 'workspace'), '/bin/bash', '--noprofile', '--norc']);
    tmux(run, ['set-option', '-g', 'remain-on-exit', 'on']);
    tmux(run, ['set-option', '-g', 'history-limit', '20000']);
    write(path.join(run, 'transcript.ansi'), '');
    tmux(run, ['pipe-pane', '-o', '-t', 'evaluation:0.0', `/usr/bin/cat >> ${shellQuote(path.join(run, 'transcript.ansi'))}`]);
    const launch = 'exec ' + ['/usr/bin/node', source, '_child', id].map(shellQuote).join(' ');
    tmux(run, ['send-keys', '-t', 'evaluation:0.0', '-l', launch]);
    tmux(run, ['send-keys', '-t', 'evaluation:0.0', 'Enter']);
    return { status: 'started', run, model: manifest.model, promptSHA256: manifest.promptSHA256 };
  }
  if (command === 'screen') {
    const screen = tmux(run, ['capture-pane', '-p', '-t', 'evaluation:0.0', '-S', '-1000']);
    write(path.join(run, `screen-${Date.now()}.txt`), screen);
    return screen;
  }
  if (command === 'stop') {
    const screen = tmux(run, ['capture-pane', '-p', '-t', 'evaluation:0.0', '-S', '-1000']);
    write(path.join(run, 'screen-final.txt'), screen);
    tmux(run, ['kill-server']);
    Object.assign(manifest, { stoppedAt: new Date().toISOString(), status: 'stopped' });
    write(path.join(run, 'manifest.json'), json(manifest));
    return { status: 'stopped', run };
  }
  if (command === 'export' || command === 'export-local') {
    if (!/^ses_[A-Za-z0-9]+$/.test(extra[0] ?? '')) throw Error('Use an observed session ID.');
    const args = ['export', extra[0], '--pure'];
    if (command === 'export') args.push('--sanitize');
    const exported = JSON.parse(saveProcess(run, command === 'export' ? 'session-export' : 'session-export-local', args));
    return {
      sessionID: exported.info.id, version: exported.info.version,
      model: exported.info.model, cost: exported.info.cost, tokens: exported.info.tokens,
      messages: exported.messages.map(message => ({
        role: message.info.role, finish: message.info.finish,
        tools: message.parts.filter(part => part.type === 'tool').map(part => ({
          name: part.tool, status: part.state?.status,
          filePath: part.state?.input?.filePath, error: part.state?.error,
        })),
        finalText: message.info.finish === 'stop' ? message.parts.filter(part => part.type === 'text').map(part => part.text).join('') : undefined,
      })),
    };
  }
  throw Error('Usage: node evals/opencode-harness.mjs prepare|inspect|select|start|screen|stop|export RUN [ARG]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === source) {
  try { const result = main(); if (result !== undefined) console.log(typeof result === 'string' ? result : json(result)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
