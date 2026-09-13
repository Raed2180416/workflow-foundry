import { applyEdits, modify, parse } from 'jsonc-parser';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, lstatSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { packageRoot, skillCatalog } from './foundry.mjs';
import { FoundryError } from './data.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const availableClients = ['generic', 'opencode', 'claude', 'cursor', 'codex'];
const cli = path.join(packageRoot, 'bin/foundry.mjs');
const q = text => "'" + String(text).replaceAll("'", "'\\''") + "'";
const present = file => { try { lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };

function inside(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new FoundryError('INSTALL_PATH', 'Install paths must be relative and cannot traverse parents');
  const target = path.join(root, relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (present(current) && lstatSync(current).isSymbolicLink()) throw new FoundryError('INSTALL_SYMLINK', `Installation does not follow existing symlink ${relative}`);
  }
  return target;
}
function getJsonc(content, filename) {
  const errors = [];
  const result = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !result || Array.isArray(result) || typeof result !== 'object') throw new FoundryError('INSTALL_CONFIG', `${filename} is not a valid JSON/JSONC object; left unchanged`);
  return result;
}
function setJsonc(content, keypath, value) {
  return applyEdits(content, modify(content, keypath, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }));
}

export function planInstall(project, { client = 'generic', hooks = true } = {}) {
  if (!availableClients.includes(client)) throw new FoundryError('INSTALL_CLIENT', `Supported clients: ${availableClients.join(', ')}`);
  const root = realpathSync(project), changes = [], notes = [];
  const load = relative => { const file = inside(root, relative); return present(file) ? readFileSync(file, 'utf8') : null; };
  const add = (relative, after, { replace = false } = {}) => {
    const before = load(relative);
    if (before === after) return;
    if (before !== null && !replace) throw new FoundryError('INSTALL_CONFLICT', `Existing ${relative} differs; left unchanged`);
    changes.push({ relative, before, after, beforeHash: before === null ? null : hash(before), afterHash: hash(after) });
  };
  const copySkill = (name, relative = '') => {
    const source = path.join(packageRoot, 'skills', name, relative);
    for (const item of readdirSync(source, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new FoundryError('INSTALL_SKILL_SYMLINK', 'Skill packages must not contain symlinks');
      const rel = path.posix.join(relative, item.name);
      if (item.isDirectory()) copySkill(name, rel);
      else if (item.isFile()) {
        if (!/\.(md|json|txt)$/.test(item.name)) continue;
        const prefix = client === 'claude' ? '.claude/skills' : '.agents/skills';
        add(`${prefix}/${name}/${rel}`, readFileSync(path.join(source, item.name), 'utf8'));
      }
    }
  };
  for (const skill of skillCatalog()) copySkill(skill.name);
  const command = process.execPath;
  const args = [cli, 'mcp', '--workspace', root];
  const mcp = { command, args };
  const mergeMcp = (filename, key, entry) => {
    const before = load(filename) ?? '{}\n'; const data = getJsonc(before, filename);
    const prior = data[key]?.['workflow-foundry'];
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(entry)) throw new FoundryError('INSTALL_MCP_CONFLICT', `${filename} already defines workflow-foundry differently`);
    add(filename, setJsonc(before, [key, 'workflow-foundry'], entry), { replace: true });
  };
  if (client === 'opencode') {
    const jsonc = present(inside(root, 'opencode.jsonc')), json = present(inside(root, 'opencode.json'));
    if (jsonc && json) throw new FoundryError('INSTALL_AMBIGUOUS', 'Both opencode.json and opencode.jsonc exist; choose one canonical config first');
    mergeMcp(jsonc ? 'opencode.jsonc' : 'opencode.json', 'mcp', { type: 'local', command: [command, ...args], enabled: true, timeout: 30000 });
    if (hooks) {
      const hooksUrl = pathToFileURL(path.join(packageRoot, 'src/hooks.mjs')).href;
      add('.opencode/plugins/workflow-foundry.js', `// Project-scoped advisory hook. Runtime validation is independent.\nimport { validateChangedFile } from ${JSON.stringify(hooksUrl)};\nexport const WorkflowFoundry = async ({ directory }) => ({\n  "tool.execute.after": async (input, output) => {\n    if (!["write", "edit", "apply_patch"].includes(input.tool)) return;\n    const file = input.args?.filePath ?? input.args?.file_path ?? output.metadata?.filePath;\n    if (!file) return;\n    try {\n      const result = validateChangedFile(directory, file);\n      if (result.applicable && typeof output.output === "string") output.output += "\\nWorkflow Foundry advisory: " + JSON.stringify(result);\n    } catch (error) {\n      if (typeof output.output === "string") output.output += "\\nWorkflow Foundry validation error: " + error.message;\n    }\n  }\n});\n`);
      notes.push('OpenCode hook is advisory and requires the client to load project plugins; some tool versions do not provide a file path, so runtime validation remains mandatory.');
    }
  } else if (client === 'claude') {
    mergeMcp('.mcp.json', 'mcpServers', { type: 'stdio', ...mcp });
    if (hooks) {
      const file = '.claude/settings.json', before = load(file) ?? '{}\n', data = getJsonc(before, file);
      const hook = { matcher: 'Write|Edit', hooks: [{ type: 'command', command: [command, cli, 'hook', '--workspace', root].map(q).join(' '), timeout: 10 }] };
      const previous = data.hooks?.PostToolUse ?? [];
      if (!Array.isArray(previous)) throw new FoundryError('INSTALL_HOOK_CONFIG', 'Existing PostToolUse configuration is not an array');
      const exists = previous.some(value => JSON.stringify(value) === JSON.stringify(hook));
      add(file, setJsonc(before, ['hooks', 'PostToolUse'], exists ? previous : [...previous, hook]), { replace: true });
      notes.push('Claude Code may require project MCP/hook trust approval; this installer never grants trust or permissions.');
    }
  } else if (client === 'cursor') {
    mergeMcp('.cursor/mcp.json', 'mcpServers', mcp);
    notes.push('Cursor MCP configuration and portable skills are installed; a Cursor-specific hook is not claimed or installed.');
  } else if (client === 'codex') {
    const file = '.codex/config.toml', before = load(file) ?? '';
    const block = `# BEGIN workflow-foundry managed MCP\n[mcp_servers.workflow-foundry]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 20\ntool_timeout_sec = 120\n# END workflow-foundry managed MCP\n`;
    if (/^\s*\[\s*mcp_servers\.(?:workflow-foundry|["']workflow-foundry["'])\s*\]/m.test(before)) {
      if (!before.includes(block)) throw new FoundryError('INSTALL_MCP_CONFLICT', 'Codex already defines workflow-foundry differently');
    } else add(file, `${before}${before.endsWith('\n') || !before ? '' : '\n'}\n${block}`, { replace: true });
    notes.push('Codex project MCP settings require a trusted project; no trust/approval bypass or unqualified Codex hook is installed.');
  } else {
    add('workflow-foundry.mcp.json', JSON.stringify({ mcpServers: { 'workflow-foundry': mcp } }, null, 2) + '\n');
    notes.push('Generic MCP config is an importable template. An unknown client is not automatically configured by placing this file.');
  }
  const ignore = load('.gitignore') ?? '';
  if (!ignore.split(/\r?\n/).some(line => line.trim() === '/.foundry/' || line.trim() === '.foundry/')) add('.gitignore', `${ignore}${ignore.endsWith('\n') || !ignore ? '' : '\n'}/.foundry/\n`, { replace: true });
  return { root, client, changes, notes, hooksRequested: hooks, source: packageRoot, command: [command, ...args] };
}

function atomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.foundry-${randomUUID()}.tmp`;
  writeFileSync(temp, text, { flag: 'wx', mode: 0o600 }); renameSync(temp, file);
}
export function install(project, options = {}) {
  const plan = planInstall(project, options);
  if (options.dryRun) return { ...plan, changes: plan.changes.map(({ before, after, ...summary }) => summary), dryRun: true };
  // Check every original before writing any change. A conflict is not overwrite
  // permission. Persist backups/journal first for process-crash recovery.
  for (const change of plan.changes) {
    const target = inside(plan.root, change.relative);
    const current = present(target) ? readFileSync(target, 'utf8') : null;
    if (current !== change.before) throw new FoundryError('INSTALL_STALE', `File changed during install: ${change.relative}`);
  }
  const id = randomUUID(), journalPath = inside(plan.root, `.foundry/install/${id}.json`);
  const journal = { id, source: packageRoot, project: plan.root, client: plan.client, createdAt: Date.now(), status: 'applying', changes: plan.changes };
  atomic(journalPath, JSON.stringify(journal, null, 2) + '\n');
  const applied = [];
  try {
    for (const change of plan.changes) {
      const target = inside(plan.root, change.relative);
      const current = present(target) ? readFileSync(target, 'utf8') : null;
      if (current !== change.before) throw new FoundryError('INSTALL_STALE', `Concurrent edit detected: ${change.relative}`);
      atomic(target, change.after); applied.push(change);
    }
    journal.status = 'installed'; atomic(journalPath, JSON.stringify(journal, null, 2) + '\n');
  } catch (error) {
    for (const change of applied.reverse()) {
      const target = inside(plan.root, change.relative);
      if (!present(target) || hash(readFileSync(target, 'utf8')) !== change.afterHash) continue;
      if (change.before === null) unlinkSync(target); else atomic(target, change.before);
    }
    journal.status = 'rolled-back-after-error'; journal.error = error.message;
    atomic(journalPath, JSON.stringify(journal, null, 2) + '\n'); throw error;
  }
  return { installed: true, id, project: plan.root, client: plan.client, fileCount: plan.changes.length, journal: journalPath, notes: plan.notes, command: plan.command };
}

export function uninstall(project, installId, { dryRun = false } = {}) {
  if (!/^[0-9a-f-]{36}$/.test(installId)) throw new FoundryError('INSTALL_ID', 'Use the installation receipt id');
  const root = realpathSync(project), journalPath = inside(root, `.foundry/install/${installId}.json`);
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  if (journal.project !== root || journal.id !== installId || !['installed', 'applying', 'partial-uninstall'].includes(journal.status)) throw new FoundryError('INSTALL_JOURNAL', 'Installation receipt cannot be used for this project/state');
  const conflicts = journal.changes.filter(change => {
    const target = inside(root, change.relative);
    const current = present(target) ? readFileSync(target, 'utf8') : null;
    return current !== change.after && current !== change.before;
  }).map(change => change.relative);
  if (conflicts.length) throw new FoundryError('UNINSTALL_CONFLICT', 'Files changed after installation; nothing was restored', conflicts);
  if (dryRun) return { dryRun: true, changes: journal.changes.map(c => c.relative) };
  const restored = [];
  for (const change of [...journal.changes].reverse()) {
    const target = inside(root, change.relative);
    const current = present(target) ? readFileSync(target, 'utf8') : null;
    if (current !== change.after && current !== change.before) {
      journal.status = 'partial-uninstall'; journal.restored = restored; journal.conflict = change.relative;
      atomic(journalPath, JSON.stringify(journal, null, 2) + '\n');
      throw new FoundryError('UNINSTALL_CONFLICT', 'A file changed during uninstall; that edit was preserved and remaining operations stopped', { conflict: change.relative, restoredFiles: restored });
    }
    if (current !== change.before) {
      if (change.before === null) { if (present(target)) unlinkSync(target); }
      else atomic(target, change.before);
    }
    restored.push(change.relative);
  }
  journal.status = 'uninstalled'; journal.uninstalledAt = Date.now(); atomic(journalPath, JSON.stringify(journal, null, 2) + '\n');
  return { uninstalled: true, id: installId, restoredFiles: journal.changes.length };
}
