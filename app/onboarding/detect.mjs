// What the doctor can tell about this computer without reading anything private (SPEC §12.3). Every check is a stat or a PATH
// lookup. Never read: ~/.claude.json, credential stores, .env values, or any key's value. Never run `claude mcp list` (it connects
// to the configured servers). Two checks parse a file, and only with the person's consent (consent: true), and only the named keys:
//   managed Claude Code policy  managed-settings.json: allowedMcpServers, deniedMcpServers, allowManagedMcpServersOnly
//                               managed-mcp.json: the server entries (to see whether Foundry's exact command is among them)
//   answering hooks             ~/.claude/settings.json and ./.claude/settings.json: whether hooks.Elicitation or
//                               hooks.ElicitationResult exist (a local hook can answer Foundry's dialog for the person)
import { existsSync, statSync, readFileSync } from 'node:fs';
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
  if (settings?.allowManagedMcpServersOnly === true) return { admitted: 'no', why: 'Only servers your organisation set up are allowed.' };
  if (allowed) {
    if (allowed.some(e => sameArgv(e.serverCommand, argv))) return { admitted: 'yes', why: 'Your organisation allows this exact command.' };
    if (allowed.some(e => e.serverName === 'foundry')) return { admitted: 'unknown', why: 'Allowed by name only, which Claude Code says is not a security control.' };
    return { admitted: 'no', why: 'Your organisation allows a list of servers, and Foundry is not on it.' };
  }
  return { admitted: 'unknown', why: 'The policy does not mention Foundry.' };
}

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
    const files = ['managed-mcp.json', 'managed-settings.json'].filter(f => isFile(path.join(dir, f)));
    if (files.length) { managed.present = true; managed.dir = dir; managed.files = files; break; }
  }
  if (managed.present && consent && argv) {
    const settings = managed.files.includes('managed-settings.json') ? readJson(path.join(managed.dir, 'managed-settings.json')) : null;
    const mcp = managed.files.includes('managed-mcp.json') ? readJson(path.join(managed.dir, 'managed-mcp.json')) : null;
    managed.admission = admission({ settings: settings && { allowedMcpServers: settings.allowedMcpServers, deniedMcpServers: settings.deniedMcpServers,
      allowManagedMcpServersOnly: settings.allowManagedMcpServersOnly }, mcp: mcp && { mcpServers: mcp.mcpServers } }, argv);
  }
  let hook = { checked: false };
  if (consent) {
    const found = [path.join(home, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.json')].filter(isFile).map(f => {
      const hooks = readJson(f)?.hooks ?? {};
      return Object.hasOwn(hooks, 'Elicitation') || Object.hasOwn(hooks, 'ElicitationResult') ? f : null;
    }).filter(Boolean);
    hook = { checked: true, answeringHook: found.length > 0, files: found.length };
  }
  const portFree = await new Promise(resolve => { const s = createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
  return { agents, managed, keychain: detectBackend({ env, os }), envKeyNames: KEY_ENV_NAMES.filter(n => typeof env[n] === 'string' && env[n].length > 0), port: { default: port, free: portFree }, hook };
}

/** Plain lines for the doctor, built from detect(). */
export function detectLines(d) {
  const lines = [];
  const found = Object.entries({ 'Claude Code': d.agents.claudeCode, Cursor: d.agents.cursor, Codex: d.agents.codex }).filter(([, a]) => a.onPath || a.folder).map(([n]) => n);
  lines.push({ check: 'Coding agents', ok: true, optional: true, say: found.length ? `Found ${found.join(', ')}. Connect one with: node app/cli.mjs connect` : 'No coding agent found. You can use Foundry in your browser without one.' });
  if (d.managed.present) lines.push({ check: 'Managed computer', ok: true, optional: true, managed: true,
    say: `Your organisation manages Claude Code on this computer.${d.managed.admission ? ` Would Foundry be allowed: ${d.managed.admission.admitted} (${d.managed.admission.why})` : ''} A one-page brief for IT is in the site.` });
  lines.push({ check: 'Keychain', ok: true, optional: true, say: d.keychain === 'none' ? 'No keychain Foundry can use: AI keys cannot be saved (you do not need one).' : `AI keys, if you add one, go into your keychain (${d.keychain}).` });
  if (d.envKeyNames.length) lines.push({ check: 'Keys in your environment', ok: true, optional: true, say: `Set in your terminal: ${d.envKeyNames.join(', ')}. Foundry does not read their values unless you choose an AI builder.` });
  lines.push({ check: 'Port', ok: true, optional: true, say: d.port.free ? `Port ${d.port.default} is free.` : `Port ${d.port.default} is in use; Foundry will pick another.` });
  if (d.hook.checked && d.hook.answeringHook) lines.push({ check: 'Answering hook', ok: true, optional: true, say: 'Your Claude Code has a hook that could answer for you, so Foundry asks in your browser instead.' });
  return lines;
}
