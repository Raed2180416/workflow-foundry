// Credential resolution and the run-scoped scrub set, ARCHITECTURE.md §2.6 (I7). Credentials resolve only in host code, at call time, from
// owner-provisioned environment variables (custody C0) or the OS keychain (C1, through execFile, never a shell). A resolved value is held
// for one call and added to a scrub set; every model-visible string, journal row, event, artifact and trace is checked against the set
// before it is written. C2 (outer client hand-off) is refused unattended; C3 (hosted broker) and C4 (IdP) are owner decisions, not built.
import { execFile } from 'node:child_process';
import { fail } from './common.mjs';

const ENV = /^[A-Z][A-Z0-9_]*$/;
const KEYCHAIN = /^[A-Za-z0-9._@-]{1,128}$/;

/** The OS keychain lookup, no shell: libsecret `secret-tool` on Linux, `security` on macOS. Tests inject a stand-in. */
export function osKeychain({ service, account }, { platform = process.platform, timeoutMs = 5000 } = {}) {
  if (!KEYCHAIN.test(service ?? '') || !KEYCHAIN.test(account ?? '')) fail('CREDENTIAL_REF', 'Keychain service and account are plain names');
  const [file, args] = platform === 'darwin' ? ['/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w']]
    : platform === 'linux' ? ['secret-tool', ['lookup', 'service', service, 'account', account]] : [null, null];
  if (!file) return Promise.reject(Object.assign(new Error('unsupported platform'), { code: 'CREDENTIAL_UNAVAILABLE' }));
  return new Promise((resolve, reject) => execFile(file, args, { shell: false, timeout: timeoutMs, maxBuffer: 64 * 1024, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? '' } },
    (error, stdout) => error ? reject(Object.assign(new Error('keychain lookup failed'), { code: 'CREDENTIAL_UNAVAILABLE' })) : resolve(stdout.replace(/\n$/, ''))));
}

export class ScrubSet {
  #values = new Set();
  add(value) { if (typeof value === 'string' && value.length >= 6) this.#values.add(value); return value; }
  get size() { return this.#values.size; }
  /** Whether `text` (a string or any JSON value) contains a held secret. */
  contains(text) {
    const s = typeof text === 'string' ? text : JSON.stringify(text ?? null);
    for (const value of this.#values) if (s.includes(value)) return true;
    return false;
  }
  redact(text) { let s = String(text); for (const value of this.#values) s = s.split(value).join('[redacted]'); return s; }
  assertClean(text, where) { if (this.contains(text)) fail('SECRET_EXPOSURE', `A credential value would have reached ${where}; refused`); return text; }
}

/**
 * Resolve one credential reference ({env} or {keychain}) for a call. `custody` is the entry's custody class; `scrub` receives the value.
 * Missing values are CREDENTIAL_MISSING (a typed preflight failure), never a silent fallback to another source.
 */
export async function resolveCredential(ref, { custody = 'C0', scrub, env = process.env, keychain = osKeychain } = {}) {
  if (!ref || typeof ref !== 'object') fail('CREDENTIAL_REF', 'A credential reference is required');
  if (custody === 'C2') fail('CUSTODY_UNATTENDED', 'Custody C2 (outer client hand-off) needs the outer client present; refused for an unattended run');
  if (custody === 'C3' || custody === 'C4') fail('CUSTODY_UNSUPPORTED', `Custody ${custody} is an owner decision and is not built in this spike`);
  let value;
  if (Object.hasOwn(ref, 'env')) {
    if (custody !== 'C0') fail('CUSTODY_MISMATCH', 'An env reference is custody C0');
    if (!ENV.test(ref.env)) fail('CREDENTIAL_REF', 'Env references are upper-case names');
    value = env[ref.env];
  } else if (Object.hasOwn(ref, 'keychain')) {
    if (custody !== 'C1') fail('CUSTODY_MISMATCH', 'A keychain reference is custody C1');
    try { value = await keychain(ref.keychain); } catch { value = undefined; }
  } else fail('CREDENTIAL_REF', 'A credential reference is {env} or {keychain}');
  if (typeof value !== 'string' || !value) fail('CREDENTIAL_MISSING', 'The referenced credential is not provisioned', { ref: Object.keys(ref)[0] });
  scrub?.add(value);
  return value;
}
/** Presence check for preflight: resolves and discards (the value still enters the scrub set). */
export async function credentialPresent(ref, options) { try { await resolveCredential(ref, options); return true; } catch (error) { if (error.code === 'CREDENTIAL_MISSING') return false; throw error; } }
