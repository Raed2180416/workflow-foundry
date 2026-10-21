#!/usr/bin/env node
// One entry point for the surface spike (research/surface-20261021/DESIGN.md §6, onboarding).
//
//   node app/cli.mjs start   [--workspace DIR] [--port N] [--no-open]   check this machine, open the dashboard, print how to connect agents
//   node app/cli.mjs mcp     [--workspace DIR] [--dashboard]            stdio MCP server for Claude Code, Codex, Cursor, ...
//        [--builder stub|haiku|mercury] [--token-cap N]                    who builds flows: the $0 stub (default), or a cheap model over
//                                                                           the template library (BUILDER-1); Mercury needs a token cap
//   node app/cli.mjs doctor  [--workspace DIR]                          what works here and what does not, in plain words
//   node app/cli.mjs connect [--workspace DIR]                          the exact command or config for each coding agent (prints only)
//   node app/cli.mjs approve APPROVAL_ID [--workspace DIR]              approve in this terminal (asks you to type yes; needs a real terminal)
//   node app/cli.mjs need "REQUEST" [--sensitivity 0.5] [--judge haiku|mercury]   does this request need a workflow at all? (code only and $0 by
//                                                                           default; --judge asks a cheap model unless the code clears it; ROUTER-1)
//
// Safe defaults: the workspace is a private directory (0700) under the user's home; nothing listens beyond 127.0.0.1; no config file of any
// coding agent is written (connect prints what to paste); no model is called unless --builder names one; nothing is sent beyond the
// local outbox.
import { parseArgs } from 'node:util';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FoundryApp } from './core/service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Builder choice: model ids come from the owner policy only (policy/models.json); the stub calls no model.
export const BUILDERS = Object.freeze({ stub: null, haiku: 'claude-haiku-5-5', mercury: 'mercury-3' });
export async function makeBuilder(name = 'stub', { workspace, tokenCap = 200000 } = {}) {
  if (!Object.hasOwn(BUILDERS, name)) throw Object.assign(new Error(`--builder is one of ${Object.keys(BUILDERS).join(', ')}`), { code: 'BUILDER_CHOICE' });
  if (name === 'stub') return (await import('./core/builder.mjs')).stubBuilder;
  const { ModelBuilder, createBuilderPort } = await import('./core/builder-model.mjs');
  const { port } = await createBuilderPort({ model: BUILDERS[name], journalFile: path.join(workspace, 'builder-journal.sqlite'), ...(name === 'mercury' ? { tokenCap } : {}) });
  return new ModelBuilder({ port, model: BUILDERS[name] });
}
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
  items.push({ check: 'Models', ok: true, optional: true, say: 'No model key needed: the default builder fills templates by code and calls no model. --builder haiku or --builder mercury lets a cheap model build from the template library (Mercury needs INCEPTION_API_KEY and a token cap).' });
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
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, dashboard: { type: 'boolean' },
    builder: { type: 'string' }, 'token-cap': { type: 'string' }, sensitivity: { type: 'string' }, judge: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  const [command = 'help', item] = positionals;
  const workspace = path.resolve(args.workspace ?? defaultWorkspace());
  const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
  if (command === 'help' || args.help) return print('Usage: node app/cli.mjs start | mcp | doctor | connect | approve APPROVAL_ID | need "REQUEST" [--sensitivity 0..1]  [--workspace DIR]');
  if (command === 'need') {
    if (!item) { process.stderr.write('need: pass the request in quotes\n'); process.exitCode = 2; return; }
    const { needAdvice } = await import('./core/need.mjs');
    const s = args.sensitivity === undefined ? undefined : Number(args.sensitivity);
    if (s !== undefined && !(s >= 0 && s <= 1)) { process.stderr.write('need: --sensitivity must be between 0 and 1\n'); process.exitCode = 2; return; }
    let judge = null;
    if (args.judge) {
      if (!['haiku', 'mercury'].includes(args.judge)) { process.stderr.write('need: --judge is haiku or mercury\n'); process.exitCode = 2; return; }
      const [{ createBuilderPort }, { modelJudge }] = await Promise.all([import('./core/builder-model.mjs'), import('../src/need/router.mjs')]);
      mkdirSync(workspace, { recursive: true, mode: 0o700 });
      const { port } = await createBuilderPort({ model: BUILDERS[args.judge], journalFile: path.join(workspace, 'need-journal.sqlite'), maxBudgetUsdPerCall: 0.05,
        ...(args.judge === 'mercury' ? { tokenCap: args['token-cap'] ? Number(args['token-cap']) : 20000 } : {}) });
      judge = modelJudge({ port, modelId: BUILDERS[args.judge], runId: `need-cli-${Date.now()}` });
    }
    const a = await needAdvice({ request: positionals.slice(1).join(' '), ...(s === undefined ? {} : { sensitivity: s }), judge });
    print(`${a.mode.toUpperCase()}  p=${a.probability} (threshold ${a.threshold.toFixed(3)} at sensitivity ${a.sensitivity}); decided by ${a.decidedBy}\n${a.say}\n${a.why}\nReliability: ${a.reliability}`);
    return;
  }
  if (command === 'doctor') { const report = doctor({ workspace }); for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`); process.exitCode = report.ok ? 0 : 1; return; }
  if (command === 'connect') return print(connectInstructions(workspace));
  if (command === 'start') {
    const report = doctor({ workspace });
    for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`);
    if (!report.ok) { process.exitCode = 1; return; }
    const { createDashboard } = await import('./dashboard/server.mjs');
    const builder = await makeBuilder(args.builder ?? 'stub', { workspace, tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined });
    const app = new FoundryApp({ workspace, builder }), dash = createDashboard(app);
    print(`Builder: ${builder.id}`);
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
    const builder = await makeBuilder(args.builder ?? 'stub', { workspace, tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined });
    const app = new FoundryApp({ workspace, builder });
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
