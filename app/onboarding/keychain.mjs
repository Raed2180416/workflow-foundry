// Where an AI key may live: the operating system's keychain, or nowhere (SPEC §15.5, decision D11). Never a file.
//
//   macos-security        macOS Keychain through /usr/bin/security; the secret goes in on stdin (`security -i`), never in argv
//   linux-secret-tool     the Secret Service (GNOME Keyring, KWallet) through secret-tool; the secret on stdin
//   windows-passwordvault Windows Credential Locker through PowerShell, the script and the secret on stdin (untested: Preview)
//   ephemeral             this process's memory only (tests; FOUNDRY_KEYCHAIN=ephemeral); gone when Foundry stops
//   none                  no usable keychain: saving is refused and the key is never written anywhere
//
// FOUNDRY_KEYCHAIN overrides the choice. Keys are checked against [A-Za-z0-9_\-.]{16,256} before any backend sees them.
import { spawnSync } from 'node:child_process';
import { existsSync, accessSync, constants } from 'node:fs';
import path from 'node:path';
import { platform } from 'node:os';
import { FoundryError } from '../../src/data.mjs';

export const KEY_SHAPE = /^[A-Za-z0-9_\-.]{16,256}$/;
export const SERVICE = 'foundry';
export const BACKENDS = Object.freeze(['macos-security', 'linux-secret-tool', 'windows-passwordvault', 'ephemeral', 'none']);
const ACCOUNT = /^[a-z][a-z0-9-]{1,40}$/;

export function onPath(name, env = process.env) {
  for (const dir of String(env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, name);
    try { accessSync(file, constants.X_OK); return file; } catch { /* next */ }
  }
  return null;
}

/** Which backend this machine offers (no secret is read). */
export function detectBackend({ env = process.env, os = platform() } = {}) {
  const forced = env.FOUNDRY_KEYCHAIN;
  if (forced) return BACKENDS.includes(forced) ? forced : 'none';
  if (os === 'darwin' && existsSync('/usr/bin/security')) return 'macos-security';
  // secret-tool needs a running Secret Service on the session bus; a headless Linux box usually has none (by design: then refuse).
  if (os === 'linux' && onPath('secret-tool', env) && env.DBUS_SESSION_BUS_ADDRESS) return 'linux-secret-tool';
  if (os === 'win32' && onPath('powershell.exe', env)) return 'windows-passwordvault';
  return 'none';
}

const memory = new Map();
function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, ...(process.env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } : {}) } });
  return { ok: r.status === 0, out: r.stdout ?? '', err: (r.stderr ?? '').slice(0, 300) };
}
const quote = s => `"${String(s).replace(/["\\]/g, '')}"`;

export class Keychain {
  constructor({ backend = detectBackend() } = {}) {
    if (!BACKENDS.includes(backend)) throw new FoundryError('KEYCHAIN', `Unknown keychain backend ${backend}`);
    this.backend = backend;
  }
  get available() { return this.backend !== 'none'; }
  #check(account, secret) {
    if (!ACCOUNT.test(account)) throw new FoundryError('KEYCHAIN', 'Unknown provider');
    if (secret !== undefined && (typeof secret !== 'string' || !KEY_SHAPE.test(secret))) throw new FoundryError('KEY_SHAPE', 'That does not look like an API key (16 to 256 letters, digits, dashes, dots or underscores)');
  }
  set(account, secret) {
    this.#check(account, secret);
    switch (this.backend) {
      case 'none': throw new FoundryError('KEYCHAIN_NONE', 'This computer has no keychain Foundry can use, so the key was not saved');
      case 'ephemeral': memory.set(account, secret); return true;
      case 'macos-security': { const r = run('/usr/bin/security', ['-i'], `add-generic-password -U -s ${SERVICE} -a ${account} -l ${quote(`Foundry: ${account}`)} -w ${secret}\n`); if (!r.ok) throw new FoundryError('KEYCHAIN', 'The keychain refused the key'); return true; }
      case 'linux-secret-tool': { const r = run('secret-tool', ['store', `--label=Foundry: ${account}`, 'service', SERVICE, 'account', account], secret); if (!r.ok) throw new FoundryError('KEYCHAIN', 'The keychain refused the key'); return true; }
      case 'windows-passwordvault': {
        const script = `$v=New-Object Windows.Security.Credentials.PasswordVault; $v.Add((New-Object Windows.Security.Credentials.PasswordCredential('${SERVICE}','${account}','${secret}')))`;
        const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], script); if (!r.ok) throw new FoundryError('KEYCHAIN', 'The keychain refused the key'); return true;
      }
      default: throw new FoundryError('KEYCHAIN', 'No keychain');
    }
  }
  /** The secret, for the builder child process only. Never sent to the page, a log or a model. */
  get(account) {
    this.#check(account);
    switch (this.backend) {
      case 'none': return null;
      case 'ephemeral': return memory.get(account) ?? null;
      case 'macos-security': { const r = run('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']); return r.ok ? r.out.trim() || null : null; }
      case 'linux-secret-tool': { const r = run('secret-tool', ['lookup', 'service', SERVICE, 'account', account]); return r.ok ? r.out.trim() || null : null; }
      case 'windows-passwordvault': { const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], `$v=New-Object Windows.Security.Credentials.PasswordVault; $c=$v.Retrieve('${SERVICE}','${account}'); $c.RetrievePassword(); $c.Password`); return r.ok ? r.out.trim() || null : null; }
      default: return null;
    }
  }
  remove(account) {
    this.#check(account);
    switch (this.backend) {
      case 'none': return false;
      case 'ephemeral': return memory.delete(account);
      case 'macos-security': return run('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', account]).ok;
      case 'linux-secret-tool': return run('secret-tool', ['clear', 'service', SERVICE, 'account', account]).ok;
      case 'windows-passwordvault': return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], `$v=New-Object Windows.Security.Credentials.PasswordVault; $v.Remove($v.Retrieve('${SERVICE}','${account}'))`).ok;
      default: return false;
    }
  }
}
