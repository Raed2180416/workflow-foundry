// What the doctor can tell about this computer without reading anything private (SPEC §12.3). Every check is a stat or a PATH
// lookup. Never read: ~/.claude.json, credential stores, .env values, or any key's value. Never run `claude mcp list` (it connects
// to the configured servers). Two checks parse a file, and only with the person's consent (consent: true), and only the named keys:
//   managed Claude Code policy  managed-settings.json: allowedMcpServers, deniedMcpServers, allowManagedMcpServersOnly
//                               managed-mcp.json: the server entries (to see whether Foundry's exact command is among them)
//   answering hooks             whether any place Claude Code takes hooks from names an Elicitation or ElicitationResult hook (a hook
//                               there can answer Foundry's dialog with no dialog shown, or change what the person chose). Since the
//                               security review of 2026-10-21 (H3) that is every place below, read again on every ask_person_to_turn_on
//                               (a hook can be added in the middle of a session), and only to test for those two hook names:
//                                 settings.json and settings.local.json in $CLAUDE_CONFIG_DIR and ~/.claude, and in .claude/ of the
//                                 folder the agent runs in and each folder above it; plugins (their hooks/hooks.json, plugin.json and
//                                 any hooks file it names) and skills and subagents (their frontmatter) under those .claude folders;
//                                 managed-settings.json and managed-settings.d/*.json in the managed folder.
//                               A Claude Code started with --settings, --plugin-dir or --agents, or driven by a program (print mode,
//                               the Agent SDK's stream-json input), can carry hooks no file shows: then Foundry does not use the dialog.
//                               Not read, so not seen (honesty review M9): settings an organisation sends Claude Code over the network
//                               (server-managed settings) or through a device-management profile, and plugins or skills kept outside
//                               these folders. For anyone who uses plugins, allowManagedHooksOnly in managed settings is the safe setting.
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { homedir, platform } from 'node:os';
import { onPath, detectBackend } from './keychain.mjs';

export const KEY_ENV_NAMES = Object.freeze(['INCEPTION_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']);

/** The managed-policy folders Claude Code documents (code.claude.com/docs/en/managed-mcp, read 2026-10-21). */
export function managedDirs({ env = process.env, os = platform() } = {}) {
  if (env.FOUNDRY_MANAGED_DIR) return [path.resolve(env.FOUNDRY_MANAGED_DIR)];
  if (os === 'darwin') return ['/Library/Application Support/ClaudeCode'];
  if (os === 'win32') return ['C:\\Program Files\\ClaudeCode'];
  return ['/etc/claude-code'];
}
const isFile = f => { try { return statSync(f).isFile(); } catch { return false; } };
const isDir = f => { try { return statSync(f).isDirectory(); } catch { return false; } };
const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const sameArgv = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

/** Would Claude Code admit Foundry's exact command under this policy? yes | no | unknown, with the reason. */
export function admission({ settings, mcp }, argv) {
  const entries = list => Array.isArray(list) ? list.filter(e => e && typeof e === 'object') : null;
  const denied = entries(settings?.deniedMcpServers), allowed = entries(settings?.allowedMcpServers);
  if (denied?.some(e => sameArgv(e.serverCommand, argv))) return { admitted: 'no', why: 'Your organisation blocks this exact command.' };
  if (denied?.some(e => e.serverName === 'foundry')) return { admitted: 'no', why: 'Your organisation blocks a server named foundry.' };
  if (mcp && typeof mcp === 'object') {
    const servers = Object.values(mcp.mcpServers ?? {});
    const listed = servers.some(s => sameArgv([s?.command, ...(Array.isArray(s?.args) ? s.args : [])], argv));
    return listed ? { admitted: 'yes', why: 'Your organisation lists this exact command.' } : { admitted: 'no', why: 'Your organisation decides every server on this computer, and Foundry is not one of them.' };
  }
  // Honesty review M10: allowManagedMcpServersOnly makes the managed allowlist the only one (an "approved catalog"); without it, allowlists
  // from every settings scope merge, so a user can add servers of their own (a "soft allowlist", code.claude.com/docs/en/managed-mcp, read
  // 2026-10-21; research/onboarding-20261021/sweeps/org-enterprise.md). Foundry's exact command on the managed list is admitted either way.
  const only = settings?.allowManagedMcpServersOnly === true;
  if (allowed) {
    if (allowed.some(e => sameArgv(e.serverCommand, argv))) return { admitted: 'yes', why: only ? 'Your organisation allows this exact command, and only the servers it allows.' : 'Your organisation allows this exact command. Its list is a soft allowlist (allowManagedMcpServersOnly is not set), so users can add other servers too.' };
    if (allowed.some(e => e.serverName === 'foundry')) return { admitted: 'unknown', why: 'Allowed by name only, which Claude Code says is not a security control.' };
    return { admitted: 'no', why: only ? 'Your organisation allows only the servers on its list, and Foundry is not on it.' : 'Your organisation allows a list of servers, and Foundry is not on it. (The list is a soft allowlist, without allowManagedMcpServersOnly, so a user\'s own settings could add Foundry; ask IT instead.)' };
  }
  if (only) return { admitted: 'no', why: 'Only servers your organisation allows may start, and its managed settings list none.' };
  return { admitted: 'unknown', why: 'The policy does not mention Foundry.' };
}

// ------------------------------------------------------------------------------------------------ hooks that could answer the dialog (H3)
const HOOK_KEY = /"(Elicitation|ElicitationResult)"\s*:/;          // a hook event key in JSON (settings, hooks.json, plugin.json)
const HOOK_YAML = /^\s*-?\s*["']?(Elicitation|ElicitationResult)["']?\s*:/m; // the same in skill or subagent frontmatter
const read = f => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const frontmatter = text => { const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? ''); return m ? m[1] : ''; };
/** The folders Claude Code reads settings from for this process: $CLAUDE_CONFIG_DIR and ~/.claude, and .claude/ of cwd and each folder above. */
export function claudeDirs({ env = process.env, home = env.FOUNDRY_HOME_DIR ?? homedir(), cwd = process.cwd() } = {}) {
  const user = [...new Set([env.CLAUDE_CONFIG_DIR && path.isAbsolute(env.CLAUDE_CONFIG_DIR) ? path.resolve(env.CLAUDE_CONFIG_DIR) : null, path.join(home, '.claude')].filter(Boolean))];
  const project = [];
  for (let dir = path.resolve(cwd), i = 0; i < 64; i++) { project.push(path.join(dir, '.claude')); const up = path.dirname(dir); if (up === dir) break; dir = up; }
  return { user, project: project.filter(d => !user.includes(d)) };
}
/**
 * Is there a hook that could answer Foundry's dialog? Reads only the places listed in the header, and from each file only whether it
 * names an Elicitation or ElicitationResult hook. Returns { found, files: [paths], incomplete } (incomplete: a folder too large to read
 * whole, which counts as "could be there").
 */
export function answeringHooks({ env = process.env, home = env.FOUNDRY_HOME_DIR ?? homedir(), cwd = process.cwd(), os = platform(), maxEntries = 20000 } = {}) {
  const files = [];
  let seen = 0, incomplete = false;
  const jsonHook = f => { const t = read(f); if (t !== null && HOOK_KEY.test(t)) files.push(f); };
  const mdHook = f => { const t = read(f); if (t !== null && HOOK_YAML.test(frontmatter(t))) files.push(f); };
  // A bounded walk: hooks files and plugin manifests anywhere under a plugins folder; frontmatter of .md files in skills and agents.
  const walk = (dir, depth, onFile) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > maxEntries) { incomplete = true; return; }
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0 && e.name !== 'node_modules' && e.name !== '.git') walk(f, depth - 1, onFile); }
      else if (e.isFile()) onFile(f, e.name, dir);
    }
  };
  const plugin = (f, name, dir) => {
    if (name === 'hooks.json' || (path.basename(dir) === 'hooks' && name.endsWith('.json'))) return jsonHook(f);
    if (name === 'plugin.json') {
      jsonHook(f);
      // A manifest may name its hooks file(s) by path.
      let m = null; try { m = JSON.parse(read(f) ?? 'null'); } catch { m = null; }
      const root = path.basename(dir) === '.claude-plugin' ? path.dirname(dir) : dir;
      for (const h of [m?.hooks].flat().filter(x => typeof x === 'string')) jsonHook(path.resolve(root, h));
    }
  };
  const markdown = (f, name) => { if (name.endsWith('.md')) mdHook(f); };
  const { user, project } = claudeDirs({ env, home, cwd });
  for (const d of [...user, ...project]) {
    for (const n of ['settings.json', 'settings.local.json']) jsonHook(path.join(d, n));
    walk(path.join(d, 'plugins'), 8, plugin);
    walk(path.join(d, 'skills'), 3, markdown);
    walk(path.join(d, 'agents'), 3, markdown);
  }
  for (const dir of managedDirs({ env, os })) {
    jsonHook(path.join(dir, 'managed-settings.json'));
    walk(path.join(dir, 'managed-settings.d'), 0, (f, name) => { if (name.endsWith('.json')) jsonHook(f); });
  }
  return { found: files.length > 0, files: [...new Set(files)], incomplete };
}
/**
 * Launch flags that can carry hooks no file shows, or mean no person sees a dialog, on the process that started this server and on the
 * nearest Claude Code process above it (a wrapper between them is allowed for). ['unknown'] when the chain cannot be read; null when none.
 */
const LAUNCH = new Set(['--settings', '--plugin-dir', '--agents', '--input-format', '--sdk-url', '-p', '--print']);
const claudeLike = argv => argv.slice(0, 2).some(a => /(^|[\\/])claude(\.exe)?$/i.test(a) || /claude-code|[\\/]claude[\\/]versions[\\/]/i.test(a));
export function launchFlags({ chain = parentChain() } = {}) {
  if (chain === null) return ['unknown'];
  const nearest = chain.findIndex(claudeLike);
  const hits = [chain[0], nearest > 0 ? chain[nearest] : null].filter(Boolean).flatMap(argv => argv.map(a => a.split('=')[0]).filter(a => LAUNCH.has(a)));
  return hits.length ? [...new Set(hits)] : null;
}
/** argv of the parent and up to three more ancestors (Linux: /proc; macOS: ps). null when they cannot be read. */
export function parentChain({ pid = process.ppid, os = platform(), depth = 4 } = {}) {
  const out = [];
  try {
    for (let p = pid, i = 0; p > 1 && i < depth; i++) {
      if (os === 'linux') {
        out.push(readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0').filter(Boolean));
        p = Number(/^PPid:\s*(\d+)/m.exec(readFileSync(`/proc/${p}/status`, 'utf8'))?.[1] ?? 0);
      } else if (os === 'darwin') {
        const r = spawnSync('/bin/ps', ['-o', 'ppid=,args=', '-p', String(p)], { encoding: 'utf8', timeout: 3000 });
        const m = /^\s*(\d+)\s+(.*)$/.exec(r.stdout?.trim() ?? '');
        if (!m) return i ? out : null;
        out.push(m[2].split(/\s+/)); p = Number(m[1]);
      } else return null;
    }
  } catch { return out.length ? out : null; }
  return out;
}
/** The MCP clients whose hook locations Foundry knows how to check (the name a client gives in its MCP initialize request). */
export const DIALOG_CLIENTS = Object.freeze(['claude-code']);
/**
 * May Foundry ask the person in this client's own dialog right now (H3)? Only a client on DIALOG_CLIENTS, on a computer whose Claude Code
 * the organisation does not manage, with no hook anywhere Foundry looks, and not started in a way that can carry hooks no file shows.
 * Otherwise the person decides in Foundry's page. Returns { ok, why }.
 */
export function dialogAllowed({ client = null, env = process.env, os = platform(), home = env.FOUNDRY_HOME_DIR ?? homedir(), cwd = process.cwd(), chain } = {}) {
  if (!client || !DIALOG_CLIENTS.includes(client.name)) return { ok: false, why: 'client' };
  if (managedDirs({ env, os }).some(d => isFile(path.join(d, 'managed-settings.json')) || isFile(path.join(d, 'managed-mcp.json')) || hasJson(path.join(d, 'managed-settings.d')))) return { ok: false, why: 'managed' };
  const hooks = answeringHooks({ env, home, cwd, os });
  if (hooks.found || hooks.incomplete) return { ok: false, why: 'hook' };
  if (launchFlags(chain === undefined ? {} : { chain })) return { ok: false, why: 'launch' };
  return { ok: true, why: null };
}
const hasJson = dir => { try { return readdirSync(dir).some(f => f.endsWith('.json')); } catch { return false; } };

/** Doctor extras: agents present, managed policy, keychain backend, env key NAMES, the default port, answering hooks. */
export async function detect({ env = process.env, os = platform(), home = env.FOUNDRY_HOME_DIR ?? homedir(), cwd = process.cwd(), argv = null, consent = false, port = 4178 } = {}) {
  const agents = {
    claudeCode: { onPath: !!onPath('claude', env), folder: isDir(path.join(home, '.claude')) },
    cursor: { onPath: !!(onPath('cursor', env) || onPath('cursor-agent', env)), folder: isDir(path.join(home, '.cursor')) },
    codex: { onPath: !!onPath('codex', env), folder: isDir(path.join(home, '.codex')) },
    vscode: { onPath: !!onPath('code', env) }
  };
  const managed = { present: false, dir: null, files: [] };
  for (const dir of managedDirs({ env, os })) {
    const files = [...['managed-mcp.json', 'managed-settings.json'].filter(f => isFile(path.join(dir, f))), ...(hasJson(path.join(dir, 'managed-settings.d')) ? ['managed-settings.d'] : [])];
    if (files.length) { managed.present = true; managed.dir = dir; managed.files = files; break; }
  }
  if (managed.present && consent && argv) {
    const settings = managed.files.includes('managed-settings.json') ? readJson(path.join(managed.dir, 'managed-settings.json')) : null;
    const mcp = managed.files.includes('managed-mcp.json') ? readJson(path.join(managed.dir, 'managed-mcp.json')) : null;
    managed.admission = admission({ settings: settings && { allowedMcpServers: settings.allowedMcpServers, deniedMcpServers: settings.deniedMcpServers,
      allowManagedMcpServersOnly: settings.allowManagedMcpServersOnly }, mcp: mcp && { mcpServers: mcp.mcpServers } }, argv);
  }
  let hook = { checked: false };
  if (consent) { const h = answeringHooks({ env, home, cwd, os }); hook = { checked: true, answeringHook: h.found || h.incomplete, files: h.files.length, incomplete: h.incomplete }; }
  const portFree = await new Promise(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
  return { agents, managed, keychain: detectBackend({ env, os }), envKeyNames: KEY_ENV_NAMES.filter(n => typeof env[n] === 'string' && env[n].length > 0), port: { default: port, free: portFree }, hook };
}

/** Plain lines for the doctor, built from detect(). */
export function detectLines(d) {
  const lines = [];
  const found = Object.entries({ 'Claude Code': d.agents.claudeCode, Cursor: d.agents.cursor, Codex: d.agents.codex }).filter(([, a]) => a.onPath || a.folder).map(([n]) => n);
  lines.push({ check: 'Coding agents', ok: true, optional: true, say: found.length ? `Found ${found.join(', ')}. See the line to paste with: node app/cli.mjs connect (or on the page: Connections, then your agent)` : 'No coding agent found. You can use Foundry in your browser without one.' });
  if (d.managed.present) lines.push({ check: 'Managed computer', ok: true, optional: true, managed: true,
    say: `Your organisation manages Claude Code on this computer.${d.managed.admission ? ` Would Foundry be allowed: ${d.managed.admission.admitted} (${d.managed.admission.why})` : ''} A one-page brief for IT is in the site.` });
  lines.push({ check: 'Keychain', ok: true, optional: true, say: d.keychain === 'none' ? 'No keychain Foundry can use: AI keys cannot be saved (you do not need one).' : `AI keys, if you add one, go into your keychain (${d.keychain}).` });
  if (d.envKeyNames.length) lines.push({ check: 'Keys in your environment', ok: true, optional: true, say: `Set in your terminal: ${d.envKeyNames.join(', ')}. Foundry does not read their values unless you choose an AI builder.` });
  lines.push({ check: 'Port', ok: true, optional: true, say: d.port.free ? `Port ${d.port.default} is free.` : `Port ${d.port.default} is in use; Foundry will pick another.` });
  if (d.hook.checked && d.hook.answeringHook) lines.push({ check: 'Answering hook', ok: true, optional: true, say: 'Your Claude Code has a hook that could answer Foundry\'s dialog for you, so Foundry asks you in your browser instead (the line from connect includes --consent for this).' });
  return lines;
}
