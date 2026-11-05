#!/usr/bin/env node
// One entry point for the surface spike (research/surface-20261021/DESIGN.md §6, onboarding).
//
//   node app/cli.mjs open    [--workspace DIR]                            open Foundry: the page that is already running, or start it
//   node app/cli.mjs site    [--workspace DIR] [--port N] [--no-open]   the onboarding site (app/site): cards, tests, turn-on, drafts, runs
//        [--builder templates|mercury] [--token-cap N]                   on 127.0.0.1 only; one Foundry window per workspace (<ws>/.lock)
//   node app/cli.mjs start   [--workspace DIR] [--port N] [--no-open]   check this machine, open the older dashboard, print how to connect agents
//   node app/cli.mjs mcp     [--workspace DIR] [--dashboard] [--consent]  stdio MCP server for Claude Code, Codex, Cursor, ...
//        [--builder stub|haiku|mercury|freeform] [--token-cap N]           who builds flows from words alone: the $0 stub (default), a cheap
//                                                                           model over the example library, or `freeform` (Haiku 5.5 writes a
//                                                                           whole workflow from the construction skill: app/core/builder-freeform.mjs),
//                                                                           only if Settings allow that model. An agent can always pass its own
//                                                                           workflow to propose_flow (the free-form front door, app/FRONT-DOOR.md)
//        [--need-judge haiku|mercury] [--need-cap-usd 0.5]                 need_check asks a cheap model unless the code clears the request
//                                                                           (capped per call and per server process; only the model Settings allow); default: code-only hint
//   node app/cli.mjs doctor  [--workspace DIR] [--json] [--consent]     what works here and what does not, in plain words (--json: for IT)
//   node app/cli.mjs connect [--workspace DIR] [--json]                 the exact line for each coding agent (prints only)
//   node app/cli.mjs approve APPROVAL_ID [--workspace DIR]              approve in this terminal (asks you to type yes; needs a real terminal):
//                                                                        turning a version on, or one paused action (shows To, Subject, full text)
//   node app/cli.mjs check-evidence FILE [--head HASH]...               re-check an evidence file on its own; says what it checked and what not,
//                                                                        and where each hash you kept elsewhere is in it
//   node app/cli.mjs need "REQUEST" [--sensitivity 0.5] [--judge haiku|mercury]   does this request need a workflow at all? (a code-only hint and $0
//                                                                           by default; --judge asks a cheap model unless the code clears it, only the model Settings allow; ROUTER-1)
//   node app/cli.mjs tasks   [--workspace DIR]                          what runs wait on you for: questions and paused actions (with ids)
//   node app/cli.mjs answer TASK_ID [--workspace DIR]                   answer one of them in this terminal (needs a real terminal; bound to
//                                                                        the question shown, app/core/human-tasks.mjs, channel 'cli')
//
// Safe defaults: the workspace is a private directory (0700) under the user's home; nothing listens beyond 127.0.0.1; no config file of any
// coding agent is written (connect prints what to paste); no model is called unless --builder names one and Settings allow it; nothing is
// sent beyond the local outbox, except the one key check a person asks for on the Keys page (only if Allowed AI includes that provider).
// Getting into the page (security review 2026-10-21, H1 M6 L15): no key is kept on disk or printed. Each start makes its own keys in
// memory; a browser tab gets one by trading a one-time code (app/site/gate.mjs) that works once, within a minute. The code goes to the
// browser opener; it is printed only when stdin and stdout are both a terminal, and otherwise (output piped or read by a program, as in a
// coding agent's shell or `! command` in Claude Code) the output names the command to run instead. A terminal is what Foundry can test,
// not a person: a program running as the same account can give it a pseudo-terminal (`script`) and read the code, which is within the
// same-account limit the Trust page states (fix round 2026-10-21, review:security new defect 5).
import { parseArgs } from 'node:util';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { accessSync, constants, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FoundryApp, ignoreWorkspace, workspacePrivacy } from './core/service.mjs';
import { listHumanTasks, answerQuestion, decideApproval } from './core/human-tasks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI = path.join(here, 'cli.mjs');
// Builder choice: model ids come from the owner policy only (policy/models.json); the stub calls no model.
export const BUILDERS = Object.freeze({ stub: null, haiku: 'claude-haiku-5-5', mercury: 'mercury-3', freeform: 'claude-haiku-5-5' });
// The Allowed AI setting a builder needs: the free-form builder calls Haiku.
const AI_OF = Object.freeze({ haiku: 'haiku', mercury: 'mercury', freeform: 'haiku' });
export async function makeBuilder(name = 'stub', { workspace, tokenCap = 200000 } = {}) {
  if (!Object.hasOwn(BUILDERS, name)) throw Object.assign(new Error(`--builder is one of ${Object.keys(BUILDERS).join(', ')}`), { code: 'BUILDER_CHOICE' });
  if (name === 'stub') return (await import('./core/builder.mjs')).stubBuilder;
  const { ModelBuilder, createBuilderPort } = await import('./core/builder-model.mjs');
  if (name === 'freeform') {
    const { FreeformBuilder } = await import('./core/builder-freeform.mjs');
    const { port } = await createBuilderPort({ model: BUILDERS.freeform, journalFile: path.join(workspace, 'builder-journal.sqlite'), maxBudgetUsdPerCall: 0.5 });
    return new FreeformBuilder({ port, model: BUILDERS.freeform, maxTotalTokens: tokenCap });
  }
  const { port } = await createBuilderPort({ model: BUILDERS[name], journalFile: path.join(workspace, 'builder-journal.sqlite'), ...(name === 'mercury' ? { tokenCap } : {}) });
  return new ModelBuilder({ port, model: BUILDERS[name] });
}
/** A model builder only when this workspace's Allowed AI (Settings, or the organisation's policy) names it (P4 walkthrough B3). */
export async function builderAllowed(name, workspace) {
  if (!name || name === 'stub' || name === 'templates') return null;
  const { loadSettings } = await import('./onboarding/settings.mjs');
  const s = loadSettings(workspace);
  return s.allowedAI === (AI_OF[name] ?? name) ? null : `Settings say no AI may build from your words with ${name} (Allowed AI: ${s.allowedAI}${s.managed?.allowedAI ? ', set by your organisation' : ''}). Change Allowed AI in Settings first, or start without --builder.`;
}
// The need judge (ROUTER-1 cascade): a policy model over the builder's ModelPort, $0.05 per call at most and maxUsd per process.
// Output caps per model (reliability.json judgeOutputCap). Mercury 3 reasons on every call: at 1,000 tokens 13 of 193 ROUTER-1 test
// calls were cut off with no answer; re-asked at 4,000 all 13 answered (largest answer 1,275 tokens; RESULT-ROUTER-1 addendum C).
export const NEED_JUDGE_MAX_TOKENS = Object.freeze({ 'claude-haiku-5-5': 1000, 'mercury-3': 4000 });
export async function makeNeedJudge(name, { workspace, tokenCap = 20000, maxUsd = 0.5 } = {}) {
  if (!['haiku', 'mercury'].includes(name)) throw Object.assign(new Error('the need judge is haiku or mercury'), { code: 'NEED_JUDGE_CHOICE' });
  // The need judge reads the person's request, so it obeys the same Allowed AI setting as a model builder (onboarding P4 walkthrough B3).
  const { loadSettings } = await import('./onboarding/settings.mjs');
  const settings = loadSettings(workspace);
  if (settings.allowedAI !== name) throw Object.assign(new Error(`Settings say no AI may judge your requests with ${name} (Allowed AI: ${settings.allowedAI}${settings.managed?.allowedAI ? ', set by your organisation' : ''}). Change Allowed AI in Settings first, or leave out the judge: need_check then gives the code-only hint, at $0.`), { code: 'NEED_JUDGE_NOT_ALLOWED' });
  const [{ createBuilderPort }, { modelJudge, cappedJudge }] = await Promise.all([import('./core/builder-model.mjs'), import('../src/need/router.mjs')]);
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const model = BUILDERS[name];
  const { port } = await createBuilderPort({ model, journalFile: path.join(workspace, 'need-journal.sqlite'), maxBudgetUsdPerCall: 0.05, ...(name === 'mercury' ? { tokenCap } : {}) });
  return cappedJudge(modelJudge({ port, modelId: model, runId: `need-${Date.now()}`, maxTokens: NEED_JUDGE_MAX_TOKENS[model] }), { maxUsd, perCallUsd: 0.05 });
}
export function needLine(a) {
  const judged = a.scoreBy !== 'code';
  return `${a.mode.toUpperCase()}  decided by ${a.decidedBy} at sensitivity ${a.sensitivity}: ${judged ? `judge ${Math.round(a.probability * 100)}% against a bar of ${Math.round(a.threshold * 100)}% (code p=${a.codeProbability}, threshold ${a.codeThreshold.toFixed(3)})`
    : `code p=${a.codeProbability} against ${a.basis === 'slider' ? 'the slider end' : `threshold ${a.threshold.toFixed(3)}`}`}\n${a.say}\n${a.why}\nReliability: ${a.reliability}`;
}
export function defaultWorkspace(env = process.env, os = platform()) {
  if (env.FOUNDRY_HOME) return path.resolve(env.FOUNDRY_HOME);
  if (os === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'Foundry');
  return path.join(homedir(), '.foundry');
}

/** Can this machine open a browser window? (an SSH session or a container usually cannot: P1 walkthrough B1) */
export function canOpenBrowser(env = process.env, os = platform(), workspace = null) {
  if (env.FOUNDRY_URL_FILE) return !!urlFileIn(env.FOUNDRY_URL_FILE, workspace);
  if (os === 'darwin' || os === 'win32') return true;
  if (env.BROWSER) return true;
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY) && spawnSync('sh', ['-c', 'command -v xdg-open'], { stdio: 'ignore' }).status === 0;
}

/** One doctor item as printed: "ok", "warn" (it works, but read this), "note" (optional, not there) or "NO" (needed, missing). Fix round
 *  2026-10-21 (review:security 4, review:honesty 6): a warning used to be printed with "ok" in front of it. */
export const doctorLine = i => `${!i.ok ? (i.optional ? 'note' : 'NO  ') : i.warn ? 'warn' : 'ok  '}  ${i.say}`;
/** Plain-language environment report. Every item says what it means for the person, not just a flag. */
export function doctor({ workspace, env = process.env, os = platform() } = {}) {
  const items = [];
  const major = Number(process.versions.node.split('.')[0]);
  items.push({ check: 'Node.js', ok: major >= 24, say: major >= 24 ? `Node ${process.versions.node}: fine.` : `Node ${process.versions.node} is too old; install Node 24 or newer.` });
  let sqlite = true; try { spawnSync(process.execPath, ['-e', 'require("node:sqlite")'], { stdio: 'ignore' }); } catch { sqlite = false; }
  items.push({ check: 'Built-in database', ok: sqlite, say: sqlite ? 'Runs are recorded in a local database file.' : 'node:sqlite is missing; runs cannot be recorded.' });
  let writable = true; try { mkdirSync(workspace, { recursive: true, mode: 0o700 }); accessSync(workspace, constants.W_OK); ignoreWorkspace(workspace); } catch { writable = false; }
  items.push({ check: 'Workspace', ok: writable, say: writable ? `Your flows and run records live in ${workspace}.` : `Cannot write ${workspace}; set FOUNDRY_HOME to a folder you own.` });
  const where = workspaceLocation(workspace);
  if (where.say) items.push({ check: 'Workspace location', ok: true, optional: true, warn: true, say: where.say });
  // Honesty review minor 6: the folder's own mode is what keeps everything inside it from other OS users (files inside keep default
  // modes). Foundry sets it to 0700 when it starts, but not for the home folder or a folder of another account; say which it is.
  const privacy = writable ? workspacePrivacy(workspace) : { private: false, mode: null };
  items.push({ check: 'Workspace privacy', ok: true, optional: true, warn: privacy.private === false, private: privacy.private, mode: privacy.mode,
    say: privacy.private === true ? `Only your user can open ${workspace} (mode ${privacy.mode}).`
      : privacy.private === null ? `This system has no per-user folder modes Foundry can check; who can open ${workspace} depends on its settings.`
        : `Other users of this computer may be able to open ${workspace}${privacy.mode ? ` (mode ${privacy.mode})` : ''}. Foundry makes its folder private (0700) when it starts, but not your home folder or a folder of another account: give Foundry a folder of its own with --workspace.` });
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
  return { workspace, workspacePrivate: privacy.private, ok: items.filter(i => !i.optional).every(i => i.ok), items };
}

/**
 * Is the workspace somewhere a coding agent or a commit would reach it (security review 2026-10-21, L16)? Inside a git repository, or
 * inside the folder this command runs in (the project a coding agent works in). Foundry still starts; it says so and keeps the folder out
 * of git with its own .gitignore. Returns { repo, inProject, say }.
 */
export function workspaceLocation(workspace, { cwd = process.cwd(), home = homedir() } = {}) {
  const ws = path.resolve(workspace);
  let repo = null;
  for (let dir = ws, i = 0; i < 64; i++) { if (existsSync(path.join(dir, '.git'))) { repo = dir; break; } const up = path.dirname(dir); if (up === dir) break; dir = up; }
  const here = path.resolve(cwd), rel = path.relative(here, ws);
  const inProject = here !== path.resolve(home) && here !== path.parse(here).root && !rel.startsWith('..') && !path.isAbsolute(rel);
  const say = repo ? `Your Foundry folder (${ws}) is inside a git repository (${repo}). Foundry put a .gitignore in it so git leaves it out of commits, but anything working in that repository, a coding agent included, can read your lists and records with its file tools. Move it to a folder outside any project (--workspace or FOUNDRY_HOME).`
    : inProject ? `Your Foundry folder (${ws}) is inside the folder you are working in (${here}): a coding agent working there can read your lists and records with its file tools. Move it to a folder outside any project (--workspace or FOUNDRY_HOME).` : null;
  return { repo, inProject, say };
}

/** The doctor plus the onboarding extras (agents, managed policy, keychain, key NAMES, port, hooks): stat and PATH lookups only. */
export async function doctorFull({ workspace, env = process.env, os = platform(), consent = false } = {}) {
  const { detect, detectLines } = await import('./onboarding/detect.mjs');
  const base = doctor({ workspace, env, os }), c = connectInstructions(workspace);
  const d = await detect({ env, os, argv: c.allowlist.serverCommand, consent });
  return { ...base, items: [...base.items, ...detectLines(d)], agents: d.agents, managed: d.managed, keychain: d.keychain, envKeyNames: d.envKeyNames, port: d.port, hook: d.hook };
}

// The lines a person pastes. With the default workspace the command leaves --workspace out, so IT can allowlist one command for every
// machine with the same install path (P4 walkthrough M2). --consent lets the server read Claude Code's settings, plugins, skills and
// subagents (only to test for Elicitation hooks) and the managed MCP keys (app/onboarding/detect.mjs), on every ask, to see whether a
// hook could answer Foundry's dialog for the person; without --consent, or if one could, the person decides in the browser (P1 M14,
// P4 M7, security review H3).
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
    // Honesty review M10: without allowManagedMcpServersOnly the managed list merges with every other scope's (a soft allowlist), so a user
    // can add a copy of Foundry the list does not name; the managed-settings entry IT pastes sets it.
    allowlist: { serverCommand: [node, ...args], managedSettings: { allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverCommand: [node, ...args] }] } },
    openCommand: `node ${q(cli)} open${custom ? ` --workspace ${q(workspace)}` : ''}`,
    // M9: what ask_person_to_turn_on does, without promising more than detect.mjs can see.
    note: 'Nothing was written to any config file. Paste one of these. Your agent cannot turn anything on through Foundry: ask_person_to_turn_on asks you, in Claude Code\'s dialog only when Foundry finds nothing that could answer that dialog for you, otherwise in Foundry\'s page. A hook Foundry cannot see could still answer the dialog.'
  };
}
/** connect, as a person reads it: one labelled line per agent. */
export function connectText(c) {
  return ['Paste one line into a terminal (a shell, not the agent\'s chat). Nothing is written for you.', '',
    'Claude Code (this project only; run it in the project folder):', `  ${c.claudeCode}`, '', 'Claude Code (every project):', `  ${c.claudeCodeEveryProject}`, '',
    'Codex:', `  ${c.codex}`, '', 'Cursor: open this link, or add the JSON below to .cursor/mcp.json', `  ${c.cursorLink}`, `  ${JSON.stringify(c.cursorJson)}`, '',
    'Then start your agent there and check the connection (in Claude Code: type /mcp). To open Foundry\'s page yourself:', `  ${c.openCommand}`].join('\n');
}

/** FOUNDRY_URL_FILE, honoured only for a file inside the workspace (0700): elsewhere it could hand a link to another account (L15). */
export function urlFileIn(file, workspace) {
  if (!file || !workspace) return null;
  const f = path.resolve(file), rel = path.relative(path.resolve(workspace), f);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? f : null;
}
/** Open a URL in the person's browser. Resolves true when a browser was started; never throws, never prints the URL (it carries a
 *  one-time code). The URL is http://127.0.0.1:PORT/#/route?c=CODE: no & or %, so cmd.exe passes it whole on Windows (M6). */
export function browserOpener(os = platform(), env = process.env, { workspace = null } = {}) {
  // The journeys get the address in a file instead of a browser window: FOUNDRY_URL_FILE=<a file inside the workspace>.
  if (env.FOUNDRY_URL_FILE) {
    const file = urlFileIn(env.FOUNDRY_URL_FILE, workspace);
    return async url => { if (!file) return false; try { writeFileSync(file, `${url}\n`, { mode: 0o600 }); return true; } catch { return false; } };
  }
  return url => new Promise(resolve => {
    const [cmd, args] = env.BROWSER ? [env.BROWSER, [url]] : os === 'darwin' ? ['open', [url]] : os === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
    let child;
    try { child = spawn(cmd, args, { stdio: 'ignore', detached: true }); } catch { resolve(false); return; }
    child.once('error', () => resolve(false)); // xdg-open missing (SSH, container): no crash, no URL on stderr (P1 walkthrough B1)
    child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

/** Stdin and stdout are a person's terminal (not piped, not captured by a program such as a coding agent's shell). */
export const personsTerminal = (stdin = process.stdin, stdout = process.stdout) => !!(stdin.isTTY && stdout.isTTY);
/** The command as anyone on this computer may see it (the page without a key shows it): the home folder is written ~ (L18). */
export function displayCommand(command, home = homedir(), os = platform()) {
  if (os === 'win32' || !home || home === '/') return command;
  return command.split(`"${home}/`).join('~/"');
}
/**
 * Let the person's browser in: open the page with a fresh one-time code; when no browser opens, print a one-time link only to a
 * person's terminal, and otherwise the command to run there. mint() makes a code; nothing that lasts is printed (H1).
 */
async function letIn({ base, mint, route = null, args, print, workspace, openCommand, toPerson = personsTerminal() }) {
  const { pageUrl } = await import('./site/gate.mjs');
  if (!args['no-open']) {
    if (await browserOpener(platform(), process.env, { workspace })(pageUrl(base, mint(), route))) { print(`Opened in your browser: ${base}`); return true; }
    print('No browser could be opened here.');
  }
  if (toPerson) print(`Open this link in a browser on this computer. It works once, within a minute; run this command again for a new one:\n  ${pageUrl(base, mint(), route)}`);
  else print(`To open it, run this in your own terminal (a link is shown only to a person's terminal, never to a program reading this output):\n  ${openCommand}`);
  return false;
}
/** Listen on the workspace's home port, or, when another program holds it, on a free port for this start only, and say so (H2). */
async function listenHome(site, { wanted, home, say }) {
  try { return { ...(await site.listen(wanted)), moved: false }; } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const r = await site.listen(0);
    say(`Port ${wanted} is in use by another program, so Foundry is on port ${r.port} for this start. Whatever answers at 127.0.0.1:${wanted} now is not Foundry: don't use a bookmark of it until Foundry is back there.`);
    return { ...r, moved: true };
  }
}

async function serveSite({ workspace, args, print }) {
  const { takeLock, readLock, pageBase } = await import('./site/lock.mjs');
  const { siteSession, DEFAULT_PORT } = await import('./site/session.mjs');
  const { mintCode } = await import('./site/gate.mjs');
  const openCommand = connectInstructions(workspace).openCommand;
  const held = readLock(workspace);
  // Already running for this folder: open that page (with a one-time code) instead of refusing (P1 B2, P2 B2). Only an address of
  // Foundry's own shape, from a live Foundry process of this account (L12).
  const heldBase = held?.alive && held.pid !== process.pid ? pageBase(held.url) : null;
  if (heldBase && held.instance) {
    print(`Foundry is already running for this folder: ${heldBase}`);
    await letIn({ base: heldBase, mint: () => mintCode(workspace, { instance: held.instance }), args, print, workspace, openCommand });
    return;
  }
  const report = await doctorFull({ workspace });
  for (const i of report.items) print(doctorLine(i));
  if (!report.ok) { process.exitCode = 1; return; }
  const builderRefusal = await builderAllowed(args.builder, workspace);
  if (builderRefusal) { process.stderr.write(`${builderRefusal}\n`); process.exitCode = 2; return; }
  const lock = takeLock(workspace, 'site');
  if (!lock.ok) { process.stderr.write(`${lock.say}\n`); process.exitCode = 3; return; }
  const session = siteSession(workspace);
  const { createSite, siteApp } = await import('./site/server.mjs');
  const app = await siteApp({ workspace, builder: args.builder ?? 'templates', tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined });
  const site = createSite(app, { workspace });
  const home = session.port ?? DEFAULT_PORT, wanted = args.port ? Number(args.port) : home;
  const { url, port, moved } = await listenHome(site, { wanted, home, say: print });
  if (!moved) session.remember(port);
  lock.update({ url, instance: site.instance });
  print(`\nFoundry is running: ${url}`);
  await letIn({ base: url, mint: () => site.gate.mint(), args, print, workspace, openCommand });
  print(`To come back later (a closed tab, another browser), run: ${openCommand}`);
  print(`\nUse a coding agent? See every line with: node ${q(CLI)} connect${path.resolve(workspace) !== defaultWorkspace() ? ` --workspace ${q(workspace)}` : ''}`);
  const stop = async () => { await site.close(); await app.close(); lock.release(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

/** Where a hash someone kept elsewhere sits in an evidence file: the run's chain head, or a line of the decision log (null: not in it). */
export function headIn(bundle, hash) {
  if (typeof hash !== 'string' || !hash) return null;
  if (bundle?.chain?.head === hash) return 'the run\'s chain head';
  const links = Array.isArray(bundle?.personDecisions?.links) ? bundle.personDecisions.links : [];
  const i = links.findIndex(l => l?.hash === hash);
  return i < 0 ? null : `decision-log line ${i + 1} of ${links.length}; the file's log continues from it${i + 1 === links.length ? ' (it is the last line)' : ''}`;
}
/** What a consistent file still cannot show, and what to compare (said by check-evidence; the same words as the file's howToCheck). */
export const OUTSIDE_COPY = bundle => `This shows nothing changed after the file was made only when compared with copies kept somewhere else: anyone using this computer account could rewrite a whole file consistently. The run's chain head (${bundle?.chain?.head ?? 'none'}) must equal a copy of it. The decision log keeps growing with every later decision, so a head of it copied earlier (the run page shows one) must appear among this file's decision-log links, at the place it had then, not as its last link (now ${bundle?.personDecisions?.check?.head ?? 'none'}). Pass each copy with --head HASH and Foundry says where it is.`;

async function main() {
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { workspace: { type: 'string' }, port: { type: 'string' }, 'no-open': { type: 'boolean' }, dashboard: { type: 'boolean' },
    builder: { type: 'string' }, 'token-cap': { type: 'string' }, sensitivity: { type: 'string' }, judge: { type: 'string' }, 'need-judge': { type: 'string' }, 'need-cap-usd': { type: 'string' }, consent: { type: 'boolean' }, json: { type: 'boolean' }, head: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } } });
  const [command = 'help', item] = positionals;
  const workspace = path.resolve(args.workspace ?? defaultWorkspace());
  const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
  if (command === 'help' || args.help) return print('Usage: node app/cli.mjs open | site | connect | doctor [--json] | mcp | approve ID | check-evidence FILE [--head HASH] | need "REQUEST" [--sensitivity 0..1] [--judge haiku|mercury] | tasks | answer TASK_ID  [--workspace DIR]');
  if (command === 'need') {
    if (!item) { process.stderr.write('need: pass the request in quotes\n'); process.exitCode = 2; return; }
    const { needAdvice } = await import('./core/need.mjs');
    const s = args.sensitivity === undefined ? undefined : Number(args.sensitivity);
    if (s !== undefined && !(s >= 0 && s <= 1)) { process.stderr.write('need: --sensitivity must be between 0 and 1\n'); process.exitCode = 2; return; }
    let judge = null;
    if (args.judge) {
      if (!['haiku', 'mercury'].includes(args.judge)) { process.stderr.write('need: --judge is haiku or mercury\n'); process.exitCode = 2; return; }
      try { judge = await makeNeedJudge(args.judge, { workspace, ...(args['token-cap'] ? { tokenCap: Number(args['token-cap']) } : {}), maxUsd: 0.05 }); }
      catch (error) { if (error.code !== 'NEED_JUDGE_NOT_ALLOWED') throw error; process.stderr.write(`need: ${error.message}\n`); process.exitCode = 2; return; }
    }
    const a = await needAdvice({ request: positionals.slice(1).join(' '), ...(s === undefined ? {} : { sensitivity: s }), judge });
    print(needLine(a));
    return;
  }
  if (command === 'doctor') {
    const report = await doctorFull({ workspace, consent: !!args.consent });
    if (args.json) {
      const { loadSettings } = await import('./onboarding/settings.mjs');
      const { buildInfo } = await import('./onboarding/build-info.mjs');
      const s = loadSettings(workspace), b = buildInfo();
      print({ workspace, ok: report.ok, mode: s.mode, allowedAI: s.allowedAI, setByOrganisation: s.managed, policyFiles: s.policyFiles, build: { commit: b.commit, changedSinceCommit: b.changedSinceCommit, files: b.tree.sha256, node: b.node },
        managedClaudeCode: report.managed.present, items: report.items.map(i => ({ check: i.check, ok: i.ok, optional: !!i.optional, warn: !!i.warn, say: i.say })) });
    } else for (const i of report.items) print(doctorLine(i));
    process.exitCode = report.ok ? 0 : 1; return;
  }
  if (command === 'site' || command === 'open') return serveSite({ workspace, args, print });
  if (command === 'connect') { const c = connectInstructions(workspace); return print(args.json ? c : connectText(c)); }
  if (command === 'check-evidence') {
    if (!item) { process.stderr.write('Usage: node app/cli.mjs check-evidence FILE [--head HASH]...\n'); process.exitCode = 2; return; }
    const { checkEvidence } = await import('./onboarding/evidence.mjs');
    let bundle; try { bundle = JSON.parse(readFileSync(item, 'utf8')); } catch (error) { process.stderr.write(`Cannot read ${item}: ${error.message}\n`); process.exitCode = 2; return; }
    const r = checkEvidence(bundle);
    // L9, honesty review B1: say exactly which sections were checked, and which were not.
    const list = xs => xs.map(x => `- ${x}`).join('\n');
    // Fix round 2026-10-21 (review:honesty new defect 4): the decision log keeps growing after a run, so a head copied earlier is found among
    // the file's links, not compared with its last one. --head HASH (any number) says where each copied hash is in this file.
    const heads = (args.head ?? []).map(h => ({ h, at: headIn(bundle, h) }));
    print(r.ok ? `Consistent. Checked:\n${list(r.checked.sections)}\nNot checked:\n${list(r.checked.notChecked)}\n${OUTSIDE_COPY(bundle)}`
      : `Not consistent:\n${list(r.problems)}${r.checked.sections.length ? `\nThese sections did check:\n${list(r.checked.sections)}` : ''}`);
    if (heads.length) print(`Copies you kept:\n${list(heads.map(({ h, at }) => `${h}: ${at ?? 'NOT in this file. Either the copy is of another run or log, or this file was rewritten.'}`))}`);
    process.exitCode = r.ok && heads.every(x => x.at) ? 0 : 1; return;
  }
  if (command === 'start') {
    const report = doctor({ workspace });
    for (const i of report.items) print(doctorLine(i));
    if (!report.ok) { process.exitCode = 1; return; }
    const builderRefusal = await builderAllowed(args.builder, workspace);
    if (builderRefusal) { process.stderr.write(`${builderRefusal}\n`); process.exitCode = 2; return; }
    const { createDashboard } = await import('./dashboard/server.mjs');
    const builder = await makeBuilder(args.builder ?? 'stub', { workspace, tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined });
    const app = new FoundryApp({ workspace, builder }), dash = createDashboard(app, { workspace });
    // Decisions made in the older dashboard are logged too (honesty review B1: check-evidence checks who decided against this log).
    (await import('./onboarding/decisions.mjs')).recordDecisions(app);
    print(`Builder: ${builder.id}`);
    const { url } = await listenHome(dash, { wanted: args.port ? Number(args.port) : 4178, home: 4178, say: print });
    print(`\nYour dashboard: ${url}`);
    await letIn({ base: url, mint: () => dash.gate.mint(), args, print, workspace, openCommand: `node ${q(CLI)} start${path.resolve(workspace) !== defaultWorkspace() ? ` --workspace ${q(workspace)}` : ''}` });
    print(`\nConnect your coding agent:\n${connectText(connectInstructions(workspace))}`);
    const stop = async () => { await dash.close(); await app.close(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  if (command === 'mcp') {
    // stdout is the MCP channel: nothing else may be printed there, and no code or key goes to stdout or stderr.
    const where = workspaceLocation(workspace);
    if (where.say) process.stderr.write(`${where.say}\n`);
    const builderRefusal = await builderAllowed(args.builder, workspace);
    if (builderRefusal) { process.stderr.write(`${builderRefusal}\n`); process.exitCode = 2; return; }
    const [{ serveAppMcp }, { createDashboard }, { SiteBuilder }, { recordDecisions }] = await Promise.all([import('./mcp/server.mjs'), import('./dashboard/server.mjs'),
      import('./onboarding/site-builder.mjs'), import('./onboarding/decisions.mjs')]);
    // The site's examples are filled by the $0 form builder; words alone go to the chosen builder (the stub by default); an agent's own
    // typed workflow goes through the free-form front door (FoundryApp.propose with workflow; app/FRONT-DOOR.md).
    const builder = new SiteBuilder({ text: await makeBuilder(args.builder ?? 'stub', { workspace, tokenCap: args['token-cap'] ? Number(args['token-cap']) : undefined }) });
    (await import('./onboarding/proposal-check.mjs')).withOrgPolicy(builder, workspace);
    const app = new FoundryApp({ workspace, builder });
    recordDecisions(app);
    let base = null;
    // With --dashboard, the first decision that the client cannot show as a dialog opens the person's Foundry page in their browser:
    // the page already running for this workspace (a live <ws>/.lock), or one this server starts on the workspace's home port. What
    // goes to the browser opener is a one-time code (app/site/gate.mjs); the tool result (which the model reads) gets plain words and
    // no link. If no browser can be opened here, the result says how the person opens it themselves, in their own terminal.
    const useSite = process.env.FOUNDRY_UI !== 'dashboard';
    const [lockModule, siteModule, sessionModule, gateModule] = args.dashboard ? await Promise.all([import('./site/lock.mjs'), import('./site/server.mjs'), import('./site/session.mjs'), import('./site/gate.mjs')]) : [null, null, null, null];
    const openCmd = connectInstructions(workspace).openCommand;
    let siteLock = null, elsewhere = false, opened = canOpenBrowser(process.env, platform(), workspace);
    // stderr reaches the client's log, not the model: a note that the home port was taken goes there, never a link.
    const note = text => process.stderr.write(`${text}\n`);
    const dashboardUrl = args.dashboard ? (route = '/waiting') => {
      if (!base) {
        const other = useSite ? lockModule.readLock(workspace) : null;
        const otherBase = other?.alive && other.pid !== process.pid ? lockModule.pageBase(other.url) : null;
        if (otherBase && other.instance) { elsewhere = true; base = Promise.resolve({ url: otherBase, mint: () => gateModule.mintCode(workspace, { instance: other.instance }) }); }
        else if (useSite) {
          siteLock = lockModule.takeLock(workspace, 'mcp');
          const session = sessionModule.siteSession(workspace), home = session.port ?? sessionModule.DEFAULT_PORT;
          const site = siteModule.createSite(app, { workspace });
          base = listenHome(site, { wanted: home, home, say: note }).then(({ url, port, moved }) => { if (!moved) session.remember(port); siteLock.update?.({ url, instance: site.instance }); return { url, mint: () => site.gate.mint() }; });
        } else { const dash = createDashboard(app, { workspace }); base = dash.listen(0).then(({ url }) => ({ url, mint: () => dash.gate.mint() })); }
        base.then(async ({ url, mint }) => { if (!(await browserOpener(platform(), process.env, { workspace })(gateModule.pageUrl(url, mint(), useSite ? route : null)))) opened = false; }).catch(() => { opened = false; });
      }
      if (!opened) return `the Foundry page. No browser could be opened here, so the person opens it themselves: in their own terminal on this machine (not through you) they run ${openCmd}`;
      return elsewhere ? 'the Foundry page they already have open (it shows the list under "Waiting for you")'
        : `the Foundry page that opened in their browser (if none opened, they run ${openCmd} in their own terminal, not through you)`;
    } : () => null;
    // FOUNDRY_TEST_AS_OF fixes the date a list is "as of" for the scripted journeys only; every list shows its date to the person.
    const asOf = process.env.FOUNDRY_TEST_AS_OF ? () => Date.parse(process.env.FOUNDRY_TEST_AS_OF) : undefined;
    const batches = useSite && args.dashboard ? new (await import('./onboarding/batch.mjs')).Batches(app, asOf ? { asOf } : {}) : null;
    // The client's own dialog decides only when it is safe right now (security review 2026-10-21, H3; P4 walkthrough M7). Without --consent
    // Foundry may not read Claude Code's settings, so the person decides in the browser. With it, every ask_person_to_turn_on checks again
    // (app/onboarding/detect.mjs dialogAllowed): a client Foundry knows how to check, no managed policy, no answering hook anywhere
    // Foundry looks, no launch flag that can carry hooks no file shows.
    const { dialogAllowed } = await import('./onboarding/detect.mjs');
    const dialog = args.consent ? ({ server }) => dialogAllowed({ client: server?.getClientVersion?.() ?? null }) : false;
    // --need-judge: need_check (and propose_flow's need field) use the cascade with a capped cheap model; without it, a code-only hint.
    if (args['need-judge'] && !['haiku', 'mercury'].includes(args['need-judge'])) { process.stderr.write('--need-judge is haiku or mercury\n'); process.exitCode = 2; await app.close(); return; }
    let needJudge = null;
    if (args['need-judge']) {
      try { needJudge = await makeNeedJudge(args['need-judge'], { workspace, ...(args['token-cap'] ? { tokenCap: Number(args['token-cap']) } : {}), maxUsd: args['need-cap-usd'] ? Number(args['need-cap-usd']) : 0.5 }); }
      catch (error) { if (error.code !== 'NEED_JUDGE_NOT_ALLOWED') throw error; process.stderr.write(`${error.message}\n`); process.exitCode = 2; siteLock?.release?.(); await app.close(); return; }
    }
    await serveAppMcp(app, { dashboardUrl, batches, dialog, openCommand: openCmd, needJudge });
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
  if (command === 'tasks') {
    const app = new FoundryApp({ workspace });
    try {
      const list = listHumanTasks(app);
      if (!list.tasks.length) print('Nothing waits for you.');
      for (const t of list.tasks) print(t.kind === 'question' ? `${t.id.slice(0, 16)}  question  “${t.flowTitle}”, ${t.step}: ${t.facts.question.text}`
        : `${t.id.slice(0, 16)}  approval  “${t.flowTitle}”, ${t.step}: ${t.facts.action} (${t.facts.effect}; risk ${t.facts.risk ?? 'unknown'})`);
      for (const n of list.notContinued) print(`not continued  run ${n.runId}: ${n.what} ${n.next}`);
    } finally { await app.close(); }
    return;
  }
  if (command === 'answer') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) { process.stderr.write('answer needs a real terminal: type it yourself, not through an agent.\n'); process.exitCode = 2; return; }
    const app = new FoundryApp({ workspace });
    try {
      const task = listHumanTasks(app).tasks.find(t => t.id === item || (typeof item === 'string' && item.length >= 8 && t.id.startsWith(item)));
      if (!task) { print('Nothing with that id is waiting for you (node app/cli.mjs tasks lists them).'); process.exitCode = 1; return; }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      // A run another live process holds is left to it (it usually takes the decision itself); a free run continues here, in this terminal.
      const waitMs = task.runBusy ? 0 : Infinity;
      try {
        if (task.kind === 'approval') {
          print(`Allow “${task.facts.action}” in “${task.flowTitle}”? It ${task.facts.effect}; risk ${task.facts.risk ?? 'unknown'}.\nStep: ${task.step}`);
          for (const a of task.arguments) print(`  ${a.name} = ${a.value.text}${a.value.clippedChars ? ` (… ${a.value.clippedChars} more characters)` : ''}`);
          const yes = (await rl.question('Type yes to allow it, anything else to refuse: ')).trim().toLowerCase() === 'yes';
          const r = await decideApproval(app, { runId: task.runId, approvalId: task.approvalId, approved: yes, channel: 'cli', waitMs });
          print(r.continued.words);
        } else {
          print(`“${task.flowTitle}” asks you: ${task.facts.question.text}\nStep: ${task.step}`);
          const schema = task.facts.answerSchema;
          const text = (await rl.question(schema?.type === 'boolean' ? 'Type yes or no: ' : `Type the answer as JSON (${JSON.stringify(schema).slice(0, 200)}): `)).trim();
          const answer = schema?.type === 'boolean' ? /^y(es)?$/i.test(text) : JSON.parse(text);
          const r = await answerQuestion(app, { runId: task.runId, nodeKey: task.nodeKey, answer, requestHash: task.requestHash, channel: 'cli', waitMs });
          print(r.continued.words);
        }
      } finally { rl.close(); }
    } finally { await app.close(); }
    return;
  }
  process.stderr.write(`Unknown command ${command}. Try: node app/cli.mjs help\n`); process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.code ?? 'ERROR'}: ${error.message}\n`); process.exitCode = 1; });
