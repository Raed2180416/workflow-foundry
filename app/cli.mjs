#!/usr/bin/env node
// One entry point for the surface spike (research/surface-20261021/DESIGN.md §6, onboarding).
//
//   node app/cli.mjs site    [--workspace DIR] [--port N] [--no-open]   the onboarding site (app/site): cards, tests, turn-on, drafts, runs
//        [--builder templates|mercury] [--token-cap N]                    on 127.0.0.1 only; one Foundry window per workspace (<ws>/.lock)
//   node app/cli.mjs start   [--workspace DIR] [--port N] [--no-open]   check this machine, open the dashboard, print how to connect agents
//   node app/cli.mjs mcp     [--workspace DIR] [--dashboard]            stdio MCP server for Claude Code, Codex, Cursor, ...
//        [--builder stub|haiku|mercury] [--token-cap N]                    who builds flows: the $0 stub (default), or a cheap model over
//                                                                           the template library (BUILDER-1); Mercury needs a token cap
//   node app/cli.mjs doctor  [--workspace DIR]                          what works here and what does not, in plain words
//   node app/cli.mjs connect [--workspace DIR]                          the exact command or config for each coding agent (prints only)
//   node app/cli.mjs approve APPROVAL_ID [--workspace DIR]              approve in this terminal (asks you to type yes; needs a real terminal):
//                                                                        turning a version on, or one paused action (shows To, Subject, full text)
//
// Safe defaults: the workspace is a private directory (0700) under the user's home; nothing listens beyond 127.0.0.1; no config file of any
// coding agent is written (connect prints what to paste); no model is called unless --builder names one; nothing is sent beyond the
// local outbox.
import { parseArgs } from 'node:util';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { accessSync, constants, mkdirSync, writeFileSync } from 'node:fs';
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

/** The doctor plus the onboarding extras (agents, managed policy, keychain, key NAMES, port, hooks): stat and PATH lookups only. */
export async function doctorFull({ workspace, env = process.env, os = platform(), consent = false } = {}) {
  const { detect, detectLines } = await import('./onboarding/detect.mjs');
  const base = doctor({ workspace, env, os }), c = connectInstructions(workspace);
  const d = await detect({ env, os, argv: c.allowlist.serverCommand, consent });
  return { ...base, items: [...base.items, ...detectLines(d)], agents: d.agents, managed: d.managed, keychain: d.keychain, envKeyNames: d.envKeyNames, port: d.port, hook: d.hook };
}

export function connectInstructions(workspace) {
  const cli = path.join(here, 'cli.mjs'), node = process.execPath;
  const args = [cli, 'mcp', '--dashboard', '--workspace', workspace];
  const server = { command: node, args };
  return {
    claudeCode: `claude mcp add --transport stdio foundry -- "${node}" "${cli}" mcp --dashboard --workspace "${workspace}"`,
    codex: `codex mcp add foundry -- "${node}" "${cli}" mcp --dashboard --workspace "${workspace}"`,
    cursorJson: { mcpServers: { foundry: server } },
    // Cursor's documented install link: the server config, JSON.stringify'd then base64 (cursor.com/docs/mcp/install-links; not tested in Cursor).
    cursorLink: `cursor://anysphere.cursor-deeplink/mcp/install?name=foundry&config=${Buffer.from(JSON.stringify(server)).toString('base64')}`,
    // Claude Code managed policy matches serverCommand exactly, every argument in order; a name is not a control (code.claude.com/docs/en/managed-mcp).
    allowlist: { serverCommand: [node, ...args] },
    note: 'Nothing was written to any config file. Paste one of these. The approve tool always asks you, never your agent.'
  };
}

export function browserOpener(os = platform(), env = process.env) {
  // Tests (and people who prefer it) get the address in a file instead of a browser window: FOUNDRY_URL_FILE=<path>.
  if (env.FOUNDRY_URL_FILE) return url => { try { writeFileSync(env.FOUNDRY_URL_FILE, `${url}\n`, { mode: 0o600 }); return true; } catch { return false; } };
  return url => {
    const [cmd, args] = os === 'darwin' ? ['open', [url]] : os === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); return true; } catch { return false; }
  };
}

async function main() {
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, dashboard: { type: 'boolean' },
    builder: { type: 'string' }, 'token-cap': { type: 'string' }, consent: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  const [command = 'help', item] = positionals;
  const workspace = path.resolve(args.workspace ?? defaultWorkspace());
  const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
  if (command === 'help' || args.help) return print('Usage: node app/cli.mjs site | start | mcp | doctor [--consent] | connect | approve ID  [--workspace DIR]');
  if (command === 'doctor') { const report = await doctorFull({ workspace, consent: !!args.consent }); for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`); process.exitCode = report.ok ? 0 : 1; return; }
  if (command === 'site') {
    const report = await doctorFull({ workspace });
    for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`);
    if (!report.ok) { process.exitCode = 1; return; }
    const { takeLock } = await import('./site/lock.mjs');
    const lock = takeLock(workspace, 'site');
    if (!lock.ok) { process.stderr.write(`${lock.say}\n`); process.exitCode = 3; return; }
    const { createSite, siteApp } = await import('./site/server.mjs');
    const app = await siteApp({ workspace, builder: args.builder ?? 'templates', tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined });
    const site = createSite(app, { workspace });
    const { url } = await site.listen(args.port ? Number(args.port) : 4178).catch(() => site.listen(0));
    lock.update({ url: url.split('#')[0] });
    print(`\nFoundry is open: ${url}\n(This link carries a one-time key. Keep it to yourself: anyone with it can approve for you.)`);
    const c = connectInstructions(workspace);
    print(`\nUse a coding agent? Paste one line (nothing is written for you):\n  Claude Code: ${c.claudeCode}\n  Codex:       ${c.codex}\n  Cursor:      ${c.cursorLink}`);
    if (!args['no-open']) browserOpener()(url);
    const stop = async () => { await site.close(); await app.close(); lock.release(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
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
    const [{ serveAppMcp }, { createDashboard }, { SiteBuilder }] = await Promise.all([import('./mcp/server.mjs'), import('./dashboard/server.mjs'), import('./onboarding/site-builder.mjs')]);
    // Cards (list_templates + settings) are filled by the $0 form builder; words alone go to the chosen builder (the stub by default).
    const builder = new SiteBuilder({ text: await makeBuilder(args.builder ?? 'stub', { workspace, tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined }) });
    (await import('./onboarding/proposal-check.mjs')).withOrgPolicy(builder, workspace);
    const app = new FoundryApp({ workspace, builder });
    let base = null;
    // With --dashboard, the first approval that the client cannot show as a dialog starts a loopback dashboard and opens it in the
    // person's browser. The one-time key goes to the browser only; the tool result (which the model reads) gets the bare address.
    // The person's decisions open in the onboarding site's "Waiting for you" page (FOUNDRY_UI=dashboard keeps the older dashboard).
    // If a Foundry window is already open for this workspace (a live <ws>/.lock), the person decides there; no second server starts.
    const useSite = process.env.FOUNDRY_UI !== 'dashboard';
    const [lockModule, siteModule] = useSite && args.dashboard ? await Promise.all([import('./site/lock.mjs'), import('./site/server.mjs')]) : [null, null];
    let siteLock = null, elsewhere = false;
    const dashboardUrl = args.dashboard ? (route = '/waiting') => {
      if (!base) {
        const other = useSite ? lockModule.readLock(workspace) : null;
        if (other?.alive && other.pid !== process.pid) { elsewhere = true; base = Promise.resolve(null); }
        else if (useSite) {
          siteLock = lockModule.takeLock(workspace, 'mcp');
          const site = siteModule.createSite(app, { workspace });
          base = site.listen(0).then(({ url }) => { siteLock.update?.({ url: url.split('#')[0] }); return url; });
        } else base = createDashboard(app).listen(0).then(({ url }) => url);
        // The one-time key goes to the browser only; the tool result (which the model reads) never carries it.
        base.then(url => { if (url) browserOpener()(useSite ? `${url}&r=${encodeURIComponent(route)}` : url); });
      }
      return elsewhere ? 'the Foundry window you already have open (look under "Waiting for you")'
        : 'the Foundry page that opened in your browser (if none opened, run "node app/cli.mjs site" in your own terminal)';
    } : () => null;
    const batches = useSite && args.dashboard ? new (await import('./onboarding/batch.mjs')).Batches(app) : null;
    await serveAppMcp(app, { dashboardUrl, batches });
    process.once('exit', () => siteLock?.release?.());
    return;
  }
  if (command === 'approve') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write('approve needs a real terminal: type it yourself, not through an agent.\n'); process.exitCode = 2; return; }
    const app = new FoundryApp({ workspace });
    try {
      const inbox = app.inbox();
      const pending = inbox.activations.find(a => a.approvalId === item);
      const action = pending ? null : inbox.actions.find(a => a.approvalId === item);
      if (!pending && !action) { print('Nothing with that id is waiting for you.'); process.exitCode = 1; return; }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      if (pending) {
        print(`Turn on “${pending.title}” (version ${pending.version})?\nIt will: ${pending.summary.steps.map(s => s.text).join('; ')}`);
        const answer = (await rl.question('Type yes to turn it on, anything else to refuse: ')).trim().toLowerCase();
        rl.close();
        print(app.decideActivation(item, answer === 'yes', { channel: 'cli' }).status);
        return;
      }
      // A paused action: show exactly what would happen, in full (the arguments the approval is bound to), then ask.
      const full = app.status({ runId: action.runId }).pendingApprovals.find(p => p.approvalId === item);
      const a = full?.args ?? {};
      print(`${action.step}\nTo: ${a.to ?? a.channel ?? '?'}${a.subject ? `\nSubject: ${a.subject}` : ''}\n----- full text -----\n${a.body ?? a.text ?? JSON.stringify(a, null, 2)}\n---------------------`);
      const answer = (await rl.question('Type yes to allow exactly this, anything else to refuse: ')).trim().toLowerCase();
      rl.close();
      print((await app.decideAction(action.runId, item, answer === 'yes', { channel: 'cli' })).headline);
    } finally { await app.close(); }
    return;
  }
  process.stderr.write(`Unknown command ${command}. Try: node app/cli.mjs help\n`); process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.code ?? 'ERROR'}: ${error.message}\n`); process.exitCode = 1; });
