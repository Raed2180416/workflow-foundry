#!/usr/bin/env node
// One entry point for the surface spike (research/surface-20261021/DESIGN.md §6, onboarding).
//
//   node app/cli.mjs start   [--workspace DIR] [--port N] [--no-open]   check this machine, open the dashboard, print how to connect agents
//   node app/cli.mjs mcp     [--workspace DIR] [--dashboard]            stdio MCP server for Claude Code, Codex, Cursor, ...
//   node app/cli.mjs doctor  [--workspace DIR]                          what works here and what does not, in plain words
//   node app/cli.mjs connect [--workspace DIR]                          the exact command or config for each coding agent (prints only)
//   node app/cli.mjs approve APPROVAL_ID [--workspace DIR]              approve in this terminal (asks you to type yes; needs a real terminal)
//
// Safe defaults: the workspace is a private directory (0700) under the user's home; nothing listens beyond 127.0.0.1; no config file of any
// coding agent is written (connect prints what to paste); no model is called; nothing is sent beyond the local outbox.
import { parseArgs } from 'node:util';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FoundryApp } from './core/service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export function defaultWorkspace(env = process.env, os = platform()) {
  if (env.FOUNDRY_HOME) return path.resolve(env.FOUNDRY_HOME);
  if (os === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'Foundry');
  return path.join(homedir(), '.foundry');
}

/** Plain-language environment report. Every item says what it means for the person, not just a flag. */
export function doctor({ workspace, env = process.env, os = platform() } = {}) {
  const items = [];
  const major = Number(process.versions.node.split('.')[0]);
  items.push({ check: 'Node.js', ok: major >= 24, say: major >= 24 ? `Node ${process.versions.node}: fine.` : `Node ${process.versions.node} is too old; install Node 24 or newer.` });
  let sqlite = true; try { spawnSync(process.execPath, ['-e', 'require("node:sqlite")'], { stdio: 'ignore' }); } catch { sqlite = false; }
  items.push({ check: 'Built-in database', ok: sqlite, say: sqlite ? 'Runs are recorded in a local database file.' : 'node:sqlite is missing; runs cannot be recorded.' });
  let writable = true; try { mkdirSync(workspace, { recursive: true, mode: 0o700 }); accessSync(workspace, constants.W_OK); } catch { writable = false; }
  items.push({ check: 'Workspace', ok: writable, say: writable ? `Your flows and run records live in ${workspace}.` : `Cannot write ${workspace}; set FOUNDRY_HOME to a folder you own.` });
  const bwrap = os === 'linux' && spawnSync('sh', ['-c', 'command -v bwrap'], { stdio: 'ignore' }).status === 0;
  items.push({ check: 'Sandbox for code steps', ok: bwrap, optional: true,
    say: bwrap ? 'Code steps can run in a sandbox.' : os === 'linux' ? 'No sandbox (bubblewrap) found: flows with code steps are refused; everything else works.'
      : `No sandbox on ${os === 'darwin' ? 'macOS' : os === 'win32' ? 'Windows' : os} in this preview: flows with code steps are refused; everything else works.` });
  items.push({ check: 'Models', ok: true, optional: true, say: env.INCEPTION_API_KEY || env.ANTHROPIC_API_KEY ? 'A model key is set in the environment, but this preview never calls a model.'
    : 'No model key needed: this preview builds from templates and calls no model.' });
  items.push({ check: 'Network', ok: true, optional: true, say: 'Works offline. The dashboard listens on 127.0.0.1 only.' });
  return { workspace, ok: items.filter(i => !i.optional).every(i => i.ok), items };
}

export function connectInstructions(workspace) {
  const cli = path.join(here, 'cli.mjs'), node = process.execPath;
  return {
    claudeCode: `claude mcp add --transport stdio foundry -- "${node}" "${cli}" mcp --dashboard --workspace "${workspace}"`,
    codex: `codex mcp add foundry -- "${node}" "${cli}" mcp --dashboard --workspace "${workspace}"`,
    cursorJson: { mcpServers: { foundry: { command: node, args: [cli, 'mcp', '--dashboard', '--workspace', workspace] } } },
    note: 'Nothing was written to any config file. Paste one of these. The approve tool always asks you, never your agent.'
  };
}

export function browserOpener(os = platform()) {
  return url => {
    const [cmd, args] = os === 'darwin' ? ['open', [url]] : os === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); return true; } catch { return false; }
  };
}

async function main() {
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, dashboard: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  const [command = 'help', item] = positionals;
  const workspace = path.resolve(args.workspace ?? defaultWorkspace());
  const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
  if (command === 'help' || args.help) return print('Usage: node app/cli.mjs start | mcp | doctor | connect | approve APPROVAL_ID  [--workspace DIR]');
  if (command === 'doctor') { const report = doctor({ workspace }); for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`); process.exitCode = report.ok ? 0 : 1; return; }
  if (command === 'connect') return print(connectInstructions(workspace));
  if (command === 'start') {
    const report = doctor({ workspace });
    for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`);
    if (!report.ok) { process.exitCode = 1; return; }
    const { createDashboard } = await import('./dashboard/server.mjs');
    const app = new FoundryApp({ workspace }), dash = createDashboard(app);
    const { url } = await dash.listen(args.port ? Number(args.port) : 4178).catch(() => dash.listen(0));
    print(`\nYour dashboard: ${url}\n(This link carries a one-time key. Keep it to yourself; anyone with it can approve for you.)`);
    const c = connectInstructions(workspace);
    print(`\nConnect your coding agent (paste one):\n  Claude Code: ${c.claudeCode}\n  Codex:       ${c.codex}\n  Cursor:      add to .cursor/mcp.json -> ${JSON.stringify(c.cursorJson)}`);
    if (!args['no-open']) browserOpener()(url);
    const stop = async () => { await dash.close(); await app.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  if (command === 'mcp') {
    // stdout is the MCP channel: nothing else may be printed there.
    const [{ serveAppMcp }, { createDashboard }] = await Promise.all([import('./mcp/server.mjs'), import('./dashboard/server.mjs')]);
    const app = new FoundryApp({ workspace });
    let base = null;
    // With --dashboard, the first approval that the client cannot show as a dialog starts a loopback dashboard and opens it in the
    // person's browser. The one-time key goes to the browser only; the tool result (which the model reads) gets the bare address.
    const dashboardUrl = args.dashboard ? () => {
      if (!base) {
        const dash = createDashboard(app);
        base = dash.listen(0).then(({ url }) => { browserOpener()(url); return url.split('#')[0]; });
      }
      return 'the Foundry page that opened in your browser (if none opened, run "node app/cli.mjs start" in your own terminal)';
    } : () => null;
    await serveAppMcp(app, { dashboardUrl });
    return;
  }
  if (command === 'approve') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write('approve needs a real terminal: type it yourself, not through an agent.\n'); process.exitCode = 2; return; }
    const app = new FoundryApp({ workspace });
    try {
      const pending = app.inbox().activations.find(a => a.approvalId === item);
      if (!pending) { print('Nothing with that id is waiting for you.'); process.exitCode = 1; return; }
      print(`Turn on “${pending.title}” (version ${pending.version})?\nIt will: ${pending.summary.steps.map(s => s.text).join('; ')}`);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = (await rl.question('Type yes to turn it on, anything else to refuse: ')).trim().toLowerCase();
      rl.close();
      print(app.decideActivation(item, answer === 'yes', { channel: 'cli' }).status);
    } finally { await app.close(); }
    return;
  }
  process.stderr.write(`Unknown command ${command}. Try: node app/cli.mjs help\n`); process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.code ?? 'ERROR'}: ${error.message}\n`); process.exitCode = 1; });
