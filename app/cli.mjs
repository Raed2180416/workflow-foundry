#!/usr/bin/env node
// One entry point for the surface spike (research/surface-20261021/DESIGN.md §6, onboarding).
//
//   node app/cli.mjs open    [--workspace DIR]                            open Foundry: the page that is already running, or start it
//   node app/cli.mjs site    [--workspace DIR] [--port N] [--no-open]   the onboarding site (app/site): cards, tests, turn-on, drafts, runs
//        [--builder templates|mercury] [--token-cap N] [--new-key]       on 127.0.0.1 only; one Foundry window per workspace (<ws>/.lock)
//   node app/cli.mjs start   [--workspace DIR] [--port N] [--no-open]   check this machine, open the older dashboard, print how to connect agents
//   node app/cli.mjs mcp     [--workspace DIR] [--dashboard] [--consent]  stdio MCP server for Claude Code, Codex, Cursor, ...
//        [--builder stub|haiku|mercury] [--token-cap N]                    who builds flows from words alone: the $0 stub (default), or a cheap
//                                                                           model over the template library, only if Settings allow it
//   node app/cli.mjs doctor  [--workspace DIR] [--json] [--consent]     what works here and what does not, in plain words (--json: for IT)
//   node app/cli.mjs connect [--workspace DIR] [--json]                 the exact line for each coding agent (prints only)
//   node app/cli.mjs approve APPROVAL_ID [--workspace DIR]              approve in this terminal (asks you to type yes; needs a real terminal):
//                                                                        turning a version on, or one paused action (shows To, Subject, full text)
//   node app/cli.mjs check-evidence FILE                                re-check an evidence file's chains on its own
//
// Safe defaults: the workspace is a private directory (0700) under the user's home; nothing listens beyond 127.0.0.1; no config file of any
// coding agent is written (connect prints what to paste); no model is called unless --builder names one and Settings allow it; nothing is
// sent beyond the local outbox. The page's key is kept in <ws>/site/session.json (0600), so a bookmark keeps working; it is never printed
// on stderr or given to a coding agent.
import { parseArgs } from 'node:util';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { accessSync, constants, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FoundryApp } from './core/service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI = path.join(here, 'cli.mjs');
// Builder choice: model ids come from the owner policy only (policy/models.json); the stub calls no model.
export const BUILDERS = Object.freeze({ stub: null, haiku: 'claude-haiku-5-5', mercury: 'mercury-3' });
export async function makeBuilder(name = 'stub', { workspace, tokenCap = 200000 } = {}) {
  if (!Object.hasOwn(BUILDERS, name)) throw Object.assign(new Error(`--builder is one of ${Object.keys(BUILDERS).join(', ')}`), { code: 'BUILDER_CHOICE' });
  if (name === 'stub') return (await import('./core/builder.mjs')).stubBuilder;
  const { ModelBuilder, createBuilderPort } = await import('./core/builder-model.mjs');
  const { port } = await createBuilderPort({ model: BUILDERS[name], journalFile: path.join(workspace, 'builder-journal.sqlite'), ...(name === 'mercury' ? { tokenCap } : {}) });
  return new ModelBuilder({ port, model: BUILDERS[name] });
}
/** A model builder only when this workspace's Allowed AI (Settings, or the organisation's policy) names it (P4 walkthrough B3). */
export async function builderAllowed(name, workspace) {
  if (!name || name === 'stub' || name === 'templates') return null;
  const { loadSettings } = await import('./onboarding/settings.mjs');
  const s = loadSettings(workspace);
  return s.allowedAI === name ? null : `Settings say no AI may build from your words with ${name} (Allowed AI: ${s.allowedAI}${s.managed?.allowedAI ? ', set by your organisation' : ''}). Change Allowed AI in Settings first, or start without --builder.`;
}
export function defaultWorkspace(env = process.env, os = platform()) {
  if (env.FOUNDRY_HOME) return path.resolve(env.FOUNDRY_HOME);
  if (os === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'Foundry');
  return path.join(homedir(), '.foundry');
}

/** Can this machine open a browser window? (an SSH session or a container usually cannot: P1 walkthrough B1) */
export function canOpenBrowser(env = process.env, os = platform()) {
  if (env.FOUNDRY_URL_FILE) return true;
  if (os === 'darwin' || os === 'win32') return true;
  if (env.BROWSER) return true;
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY) && spawnSync('sh', ['-c', 'command -v xdg-open'], { stdio: 'ignore' }).status === 0;
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
  // A fresh copy without `npm ci` cannot start the agent connection (P1 walkthrough B4): say so here, not as "failed" in the agent.
  let mcpLibrary = true; try { import.meta.resolve('@modelcontextprotocol/sdk/server/index.js'); } catch { mcpLibrary = false; }
  items.push({ check: 'Agent connection library', ok: true, optional: true, mcp: mcpLibrary, say: mcpLibrary ? 'Coding agents can connect (the MCP library is installed).'
    : `The library coding agents connect through is missing. In ${path.dirname(here)} run: npm ci --ignore-scripts` });
  const bwrap = os === 'linux' && spawnSync('sh', ['-c', 'command -v bwrap'], { stdio: 'ignore' }).status === 0;
  items.push({ check: 'Sandbox for code steps', ok: bwrap, optional: true,
    say: bwrap ? 'Code steps can run in a sandbox.' : os === 'linux' ? 'No sandbox (bubblewrap) found: flows with code steps are refused; everything else works.'
      : `On ${os === 'darwin' ? 'macOS' : os === 'win32' ? 'Windows' : os}, any step that runs a script is refused: Foundry's script sandbox (bubblewrap, which needs Linux user namespaces) exists only on Linux. Everything else works.` });
  const browser = canOpenBrowser(env, os);
  items.push({ check: 'Browser', ok: true, optional: true, browser, say: browser ? 'Foundry can open its page in your browser.'
    : `No browser can be opened from here (an SSH session or a container?). Run "node ${CLI} open --workspace ${workspace}" on this machine to get your Foundry link, and open it in a browser that can reach this computer.` });
  items.push({ check: 'Models', ok: true, optional: true, say: 'No model key needed: cards are filled by code and call no model. An AI builder (Mercury, or Claude Haiku from the command line) works only if Allowed AI in Settings names it.' });
  items.push({ check: 'Network', ok: true, optional: true, say: 'Works offline. The page listens on 127.0.0.1 only.' });
  return { workspace, ok: items.filter(i => !i.optional).every(i => i.ok), items };
}

/** The doctor plus the onboarding extras (agents, managed policy, keychain, key NAMES, port, hooks): stat and PATH lookups only. */
export async function doctorFull({ workspace, env = process.env, os = platform(), consent = false } = {}) {
  const { detect, detectLines } = await import('./onboarding/detect.mjs');
  const base = doctor({ workspace, env, os }), c = connectInstructions(workspace);
  const d = await detect({ env, os, argv: c.allowlist.serverCommand, consent });
  return { ...base, items: [...base.items, ...detectLines(d)], agents: d.agents, managed: d.managed, keychain: d.keychain, envKeyNames: d.envKeyNames, port: d.port, hook: d.hook };
}

// The lines a person pastes. With the default workspace the command leaves --workspace out, so IT can allowlist one command for every
// machine with the same install path (P4 walkthrough M2). --consent lets the server read the agent's own settings files (only their
// hooks and the managed MCP keys; app/onboarding/detect.mjs) to see whether a hook could answer Foundry's dialog for the person; if so,
// the person decides in the browser instead (P1 M14, P4 M7).
const q = s => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;
export function connectInstructions(workspace) {
  const cli = CLI, node = process.execPath;
  const custom = path.resolve(workspace) !== defaultWorkspace();
  const args = [cli, 'mcp', '--dashboard', '--consent', ...(custom ? ['--workspace', workspace] : [])];
  const server = { command: node, args };
  const line = args.map(q).join(' ').replace(/"(mcp|--dashboard|--consent|--workspace)"/g, '$1');
  return {
    claudeCode: `claude mcp add --transport stdio foundry -- ${q(node)} ${line}`,
    claudeCodeEveryProject: `claude mcp add --scope user --transport stdio foundry -- ${q(node)} ${line}`,
    codex: `codex mcp add foundry -- ${q(node)} ${line}`,
    cursorJson: { mcpServers: { foundry: server } },
    // Cursor's documented install link: the server config, JSON.stringify'd then base64 (cursor.com/docs/mcp/install-links; not tested in Cursor).
    cursorLink: `cursor://anysphere.cursor-deeplink/mcp/install?name=foundry&config=${Buffer.from(JSON.stringify(server)).toString('base64')}`,
    // Claude Code managed policy matches serverCommand exactly, every argument in order; a name is not a control (code.claude.com/docs/en/managed-mcp).
    allowlist: { serverCommand: [node, ...args] },
    openCommand: `node ${q(cli)} open${custom ? ` --workspace ${q(workspace)}` : ''}`,
    note: 'Nothing was written to any config file. Paste one of these. The approve tool always asks you, never your agent.'
  };
}
/** connect, as a person reads it: one labelled line per agent. */
export function connectText(c) {
  return ['Paste one line into a terminal (a shell, not the agent\'s chat). Nothing is written for you.', '',
    'Claude Code (this project only; run it in the project folder):', `  ${c.claudeCode}`, '', 'Claude Code (every project):', `  ${c.claudeCodeEveryProject}`, '',
    'Codex:', `  ${c.codex}`, '', 'Cursor: open this link, or add the JSON below to .cursor/mcp.json', `  ${c.cursorLink}`, `  ${JSON.stringify(c.cursorJson)}`, '',
    'Then start your agent there and check the connection (in Claude Code: type /mcp). To open Foundry\'s page yourself:', `  ${c.openCommand}`].join('\n');
}

/** Open a URL in the person's browser. Resolves true when a browser was started; never throws, never prints the URL (it carries the key). */
export function browserOpener(os = platform(), env = process.env) {
  // Tests (and people who prefer it) get the address in a file instead of a browser window: FOUNDRY_URL_FILE=<path>.
  if (env.FOUNDRY_URL_FILE) return async url => { try { writeFileSync(env.FOUNDRY_URL_FILE, `${url}\n`, { mode: 0o600 }); return true; } catch { return false; } };
  return url => new Promise(resolve => {
    const [cmd, args] = env.BROWSER ? [env.BROWSER, [url]] : os === 'darwin' ? ['open', [url]] : os === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
    let child;
    try { child = spawn(cmd, args, { stdio: 'ignore', detached: true }); } catch { resolve(false); return; }
    child.once('error', () => resolve(false)); // xdg-open missing (SSH, container): no crash, no URL on stderr (P1 walkthrough B1)
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

async function serveSite({ workspace, args, print }) {
  const { takeLock, readLock } = await import('./site/lock.mjs');
  const { siteSession, keyedUrl, DEFAULT_PORT } = await import('./site/session.mjs');
  const session = siteSession(workspace, { fresh: !!args['new-key'] });
  const held = readLock(workspace);
  // Already running for this folder: open that page (with its key) instead of refusing (P1 B2, P2 B2).
  if (held?.alive && held.pid !== process.pid && held.url) {
    const url = keyedUrl(held.url, session.token);
    print(`Foundry is already running for this folder. Opening it: ${held.url}\n(The link with its key: ${url}\n Keep it to yourself: anyone with it can approve for you.)`);
    if (!args['no-open'] && !(await browserOpener()(url))) print(`No browser could be opened here. Open the link above in your browser.`);
    return;
  }
  const report = await doctorFull({ workspace });
  for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`);
  if (!report.ok) { process.exitCode = 1; return; }
  const builderRefusal = await builderAllowed(args.builder, workspace);
  if (builderRefusal) { process.stderr.write(`${builderRefusal}\n`); process.exitCode = 2; return; }
  const lock = takeLock(workspace, 'site');
  if (!lock.ok) { process.stderr.write(`${lock.say}\n`); process.exitCode = 3; return; }
  const { createSite, siteApp } = await import('./site/server.mjs');
  const app = await siteApp({ workspace, builder: args.builder ?? 'templates', tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined });
  const site = createSite(app, { workspace, token: session.token });
  const wanted = args.port ? Number(args.port) : session.port ?? DEFAULT_PORT;
  const { url, port } = await site.listen(wanted).catch(() => site.listen(0));
  session.remember(port);
  lock.update({ url: url.split('#')[0] });
  print(`\nFoundry is open: ${url}\n(This link carries this folder's key. Keep it to yourself: anyone with it can approve for you. Bookmark http://127.0.0.1:${port}/ to come back while Foundry runs; after a restart, run: ${connectInstructions(workspace).openCommand})`);
  print(`\nUse a coding agent? See every line with: node ${q(CLI)} connect${path.resolve(workspace) !== defaultWorkspace() ? ` --workspace ${q(workspace)}` : ''}`);
  if (!args['no-open'] && !(await browserOpener()(url))) print('No browser could be opened here. Open the link above in your browser.');
  const stop = async () => { await site.close(); await app.close(); lock.release(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

async function main() {
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, dashboard: { type: 'boolean' },
    builder: { type: 'string' }, 'token-cap': { type: 'string' }, consent: { type: 'boolean' }, json: { type: 'boolean' }, 'new-key': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  const [command = 'help', item] = positionals;
  const workspace = path.resolve(args.workspace ?? defaultWorkspace());
  const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
  if (command === 'help' || args.help) return print('Usage: node app/cli.mjs open | site | connect | doctor [--json] | mcp | approve ID | check-evidence FILE  [--workspace DIR]');
  if (command === 'doctor') {
    const report = await doctorFull({ workspace, consent: !!args.consent });
    if (args.json) {
      const { loadSettings } = await import('./onboarding/settings.mjs');
      const { buildInfo } = await import('./onboarding/build-info.mjs');
      const s = loadSettings(workspace), b = buildInfo();
      print({ workspace, ok: report.ok, mode: s.mode, allowedAI: s.allowedAI, setByOrganisation: s.managed, policyFiles: s.policyFiles, build: { commit: b.commit, changedSinceCommit: b.changedSinceCommit, files: b.tree.sha256, node: b.node },
        managedClaudeCode: report.managed.present, items: report.items.map(i => ({ check: i.check, ok: i.ok, optional: !!i.optional, say: i.say })) });
    } else for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`);
    process.exitCode = report.ok ? 0 : 1; return;
  }
  if (command === 'site' || command === 'open') return serveSite({ workspace, args, print });
  if (command === 'connect') { const c = connectInstructions(workspace); return print(args.json ? c : connectText(c)); }
  if (command === 'check-evidence') {
    if (!item) { process.stderr.write('Usage: node app/cli.mjs check-evidence FILE\n'); process.exitCode = 2; return; }
    const { checkEvidence } = await import('./onboarding/evidence.mjs');
    let bundle; try { bundle = JSON.parse(readFileSync(item, 'utf8')); } catch (error) { process.stderr.write(`Cannot read ${item}: ${error.message}\n`); process.exitCode = 2; return; }
    const r = checkEvidence(bundle);
    print(r.ok ? `Consistent: ${r.checked.events} run events and ${r.checked.decisions} decisions hash as recorded, each linked to the one before; the last event is the chain head the file states (${bundle.chain?.head}). This shows nothing changed after the file was made only if you compare that head with a copy kept somewhere else.`
      : `Not consistent:\n- ${r.problems.join('\n- ')}`);
    process.exitCode = r.ok ? 0 : 1; return;
  }
  if (command === 'start') {
    const report = doctor({ workspace });
    for (const i of report.items) print(`${i.ok ? 'ok ' : i.optional ? 'note' : 'NO '}  ${i.say}`);
    if (!report.ok) { process.exitCode = 1; return; }
    const builderRefusal = await builderAllowed(args.builder, workspace);
    if (builderRefusal) { process.stderr.write(`${builderRefusal}\n`); process.exitCode = 2; return; }
    const { createDashboard } = await import('./dashboard/server.mjs');
    const builder = await makeBuilder(args.builder ?? 'stub', { workspace, tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined });
    const app = new FoundryApp({ workspace, builder }), dash = createDashboard(app);
    print(`Builder: ${builder.id}`);
    const { url } = await dash.listen(args.port ? Number(args.port) : 4178).catch(() => dash.listen(0));
    print(`\nYour dashboard: ${url}\n(This link carries a key for this session. Keep it to yourself; anyone with it can approve for you.)`);
    print(`\nConnect your coding agent:\n${connectText(connectInstructions(workspace))}`);
    if (!args['no-open']) await browserOpener()(url);
    const stop = async () => { await dash.close(); await app.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  if (command === 'mcp') {
    // stdout is the MCP channel: nothing else may be printed there, and the page's key never goes to stdout or stderr.
    const builderRefusal = await builderAllowed(args.builder, workspace);
    if (builderRefusal) { process.stderr.write(`${builderRefusal}\n`); process.exitCode = 2; return; }
    const [{ serveAppMcp }, { createDashboard }, { SiteBuilder }, { recordDecisions }] = await Promise.all([import('./mcp/server.mjs'), import('./dashboard/server.mjs'),
      import('./onboarding/site-builder.mjs'), import('./onboarding/decisions.mjs')]);
    // Cards (list_templates + settings) are filled by the $0 form builder; words alone go to the chosen builder (the stub by default).
    const builder = new SiteBuilder({ text: await makeBuilder(args.builder ?? 'stub', { workspace, tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined }) });
    (await import('./onboarding/proposal-check.mjs')).withOrgPolicy(builder, workspace);
    const app = new FoundryApp({ workspace, builder });
    recordDecisions(app);
    let base = null;
    // With --dashboard, the first decision that the client cannot show as a dialog opens the person's Foundry page in their browser:
    // the page already running for this workspace (a live <ws>/.lock), or one this server starts on the workspace's own port with the
    // workspace's own key (so the person's bookmark works). The key goes to the browser only; the tool result (which the model reads)
    // gets plain words. If no browser can be opened here, the result says how the person opens it themselves.
    const useSite = process.env.FOUNDRY_UI !== 'dashboard';
    const [lockModule, siteModule, sessionModule] = useSite && args.dashboard ? await Promise.all([import('./site/lock.mjs'), import('./site/server.mjs'), import('./site/session.mjs')]) : [null, null, null];
    const openCmd = connectInstructions(workspace).openCommand;
    let siteLock = null, elsewhere = false, opened = canOpenBrowser();
    const dashboardUrl = args.dashboard ? (route = '/waiting') => {
      if (!base) {
        const other = useSite ? lockModule.readLock(workspace) : null;
        const session = useSite ? sessionModule.siteSession(workspace) : null;
        if (other?.alive && other.pid !== process.pid && other.url) { elsewhere = true; base = Promise.resolve(other.url); }
        else if (useSite) {
          siteLock = lockModule.takeLock(workspace, 'mcp');
          const site = siteModule.createSite(app, { workspace, token: session.token });
          base = site.listen(session.port ?? sessionModule.DEFAULT_PORT).catch(() => site.listen(0)).then(({ url, port }) => { session.remember(port); siteLock.update?.({ url: url.split('#')[0] }); return url.split('#')[0]; });
        } else base = createDashboard(app).listen(0).then(({ url }) => url);
        base.then(async url => { if (url && !(await browserOpener()(useSite ? sessionModule.keyedUrl(url, session.token, route) : url))) opened = false; });
      }
      if (!opened) return `the Foundry page. No browser could be opened here, so the person opens it themselves: in their own terminal on this machine they run ${openCmd}`;
      return elsewhere ? 'the Foundry page they already have open (it shows the list under "Waiting for you")'
        : `the Foundry page that opened in their browser (if none opened, they run ${openCmd} in their own terminal)`;
    } : () => null;
    // FOUNDRY_TEST_AS_OF fixes the date a list is "as of" for the scripted journeys only; every list shows its date to the person.
    const asOf = process.env.FOUNDRY_TEST_AS_OF ? () => Date.parse(process.env.FOUNDRY_TEST_AS_OF) : undefined;
    const batches = useSite && args.dashboard ? new (await import('./onboarding/batch.mjs')).Batches(app, asOf ? { asOf } : {}) : null;
    // With --consent, look for a hook that could answer Foundry's dialog for the person, and for an organisation's managed Claude Code
    // policy; if either exists, the person decides in the browser (P4 walkthrough M7).
    let dialog = true;
    if (args.consent) { const d = await (await import('./onboarding/detect.mjs')).detect({ consent: true }); dialog = !d.hook.answeringHook && !d.managed.present; }
    await serveAppMcp(app, { dashboardUrl, batches, dialog, openCommand: openCmd });
    process.once('exit', () => siteLock?.release?.());
    return;
  }
  if (command === 'approve') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write('approve needs a real terminal: type it yourself, not through an agent.\n'); process.exitCode = 2; return; }
    const app = new FoundryApp({ workspace });
    (await import('./onboarding/decisions.mjs')).recordDecisions(app);
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
