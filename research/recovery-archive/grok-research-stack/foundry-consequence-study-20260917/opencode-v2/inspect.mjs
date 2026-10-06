import { mkdirSync, writeFileSync, realpathSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runProcess } from '/home/raed/Projects/workflow-foundry/src/process.mjs';

const base = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const online = args[0] === '--online';
if (online) args.shift();
const emptyConfig = args[0] === '--empty-config';
if (emptyConfig) args.shift();
const driver = args[0] === '--driver';
if (driver) args.shift();
const name = args.shift();
if (!name || !/^[a-z0-9-]+$/.test(name) || (!driver && args.length === 0)) throw new Error('Name and bounded CLI argv required');
const root = path.join(base, 'inspection', `${name}-${randomUUID()}`);
for (const rel of ['task', 'state/config/opencode', 'state/data', 'state/cache', 'state/state']) mkdirSync(path.join(root, rel), { recursive: true, mode: 0o700 });
const config = emptyConfig ? {} : { enabled_providers: ['opencode'], autoupdate: false, share: 'disabled', plugin: [], lsp: false, formatter: false, permission: { '*': 'deny' } };
writeFileSync(path.join(root, 'task/opencode.json'), JSON.stringify(config), { mode: 0o600 });
if (driver) writeFileSync(path.join(root, 'task/driver.mjs'), readFileSync(path.join(base, 'catalog-driver.mjs')), { mode: 0o600 });
const env = {
  PATH: '/usr/bin:/bin', HOME: '/home/opencode', LANG: 'C.UTF-8', TERM: 'dumb',
  XDG_CONFIG_HOME: '/state/config', XDG_DATA_HOME: '/state/data', XDG_CACHE_HOME: '/state/cache', XDG_STATE_HOME: '/state/state',
  OPENCODE_CONFIG: '/task/opencode.json', OPENCODE_CONFIG_DIR: '/state/config/opencode',
};
const argv = [
  '--die-with-parent', '--new-session', '--unshare-all', ...(online ? ['--share-net'] : []), '--cap-drop', 'ALL',
  '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
  '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', '/home/opencode',
  '--dir', '/etc', '--ro-bind', '/etc/ssl', '/etc/ssl', '--ro-bind', realpathSync('/etc/resolv.conf'), '/etc/resolv.conf', '--ro-bind', '/etc/hosts', '/etc/hosts',
  '--bind', path.join(root, 'state'), '/state', '--ro-bind', path.join(root, 'task'), '/task', '--chdir', '/task',
  ...(driver ? ['/usr/bin/node', '/task/driver.mjs'] : ['/usr/bin/opencode', ...args]),
];
try {
  const result = await runProcess('/usr/bin/bwrap', argv, { env, timeoutMs: 45000, maxBytes: 2 * 1024 * 1024 });
  writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ root, code: result.code, stdout: result.stdout.slice(0, 24000), stdoutBytes: Buffer.byteLength(result.stdout), stderr: result.stderr.slice(0, 8000) }));
} catch (error) {
  writeFileSync(path.join(root, 'RESULT.json'), JSON.stringify({ error: { code: error.code, message: error.message }, result: error.processResult }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ root, error: { code: error.code, message: error.message }, stdout: error.processResult?.stdout, stderr: error.processResult?.stderr }));
  process.exitCode = 1;
}
