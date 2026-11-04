// Credential resolution and the run-scoped scrub set, ARCHITECTURE.md §2.6 (I7). Credentials resolve only in host code, at call time, from
// owner-provisioned environment variables (custody C0) or the OS keychain (C1, through execFile on an absolute path, never a shell or a PATH
// lookup). A resolved value is held for one call and added to a scrub set; every model-visible string, journal row, event, artifact and
// trace is checked against the set before it is written. The set matches each value and its common encodings (URL and form encoding, JSON
// string escaping, base64 at every byte alignment), so an encoded copy is caught too. A credential shorter than MIN_SECRET characters cannot
// be told apart from ordinary text, so it is refused (CREDENTIAL_UNSCRUBBABLE) rather than resolved and left unscrubbed. C2 (outer client
// hand-off) is refused unattended; C3 (hosted broker) and C4 (IdP) are owner decisions, not built.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fail } from './common.mjs';

const ENV = /^[A-Z][A-Z0-9_]*$/;
const KEYCHAIN = /^[A-Za-z0-9._@-]{1,128}$/;
export const MIN_SECRET = 6;
// Absolute paths only: a writable directory early on PATH must not be able to stand in for the keychain tool.
const SECRET_TOOL = ['/usr/bin/secret-tool', '/bin/secret-tool'];
const secretTool = () => SECRET_TOOL.find(f => existsSync(f)) ?? null;

/** The OS keychain lookup, no shell: libsecret `secret-tool` on Linux, `security` on macOS. Tests inject a stand-in. */
export function osKeychain({ service, account }, { platform = process.platform, timeoutMs = 5000 } = {}) {
  if (!KEYCHAIN.test(service ?? '') || !KEYCHAIN.test(account ?? '')) fail('CREDENTIAL_REF', 'Keychain service and account are plain names');
  const [file, args] = platform === 'darwin' ? ['/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w']]
    : platform === 'linux' ? [secretTool(), ['lookup', 'service', service, 'account', account]] : [null, null];
  if (!file) return Promise.reject(Object.assign(new Error('no keychain tool at a trusted absolute path'), { code: 'CREDENTIAL_UNAVAILABLE' }));
  return new Promise((resolve, reject) => execFile(file, args, { shell: false, timeout: timeoutMs, maxBuffer: 64 * 1024, env: { PATH: '/usr/bin:/bin', DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? '' } },
    (error, stdout) => error ? reject(Object.assign(new Error('keychain lookup failed'), { code: 'CREDENTIAL_UNAVAILABLE' })) : resolve(stdout.replace(/\n$/, ''))));
}

/**
 * Store a secret in the OS keychain (used for OAuth token records, custody C1). Linux: `secret-tool store`, with the secret on STDIN (never
 * on argv, where other processes could read it), no shell. macOS `security add-generic-password` takes the secret on argv, so it is
 * refused in this spike (CREDENTIAL_STORE_UNSUPPORTED). Tests inject a stand-in.
 */
export function osKeychainStore({ service, account }, value, { platform = process.platform, timeoutMs = 5000 } = {}) {
  if (!KEYCHAIN.test(service ?? '') || !KEYCHAIN.test(account ?? '')) fail('CREDENTIAL_REF', 'Keychain service and account are plain names');
  if (platform !== 'linux') return Promise.reject(Object.assign(new Error('keychain store unsupported on this platform in the spike'), { code: 'CREDENTIAL_STORE_UNSUPPORTED' }));
  const tool = secretTool();
  if (!tool) return Promise.reject(Object.assign(new Error('no keychain tool at a trusted absolute path'), { code: 'CREDENTIAL_STORE_FAILED' }));
  return new Promise((resolve, reject) => {
    const child = execFile(tool, ['store', '--label', `workflow-foundry ${service}`, 'service', service, 'account', account], { shell: false, timeout: timeoutMs,
      env: { PATH: '/usr/bin:/bin', DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? '' } },
    error => error ? reject(Object.assign(new Error('keychain store failed'), { code: 'CREDENTIAL_STORE_FAILED' })) : resolve());
    child.stdin.end(value);
  });
}

/** The forms a secret takes in transit and at rest: itself, URL/form encoded, JSON-escaped, and the stable middle of its base64 at each of the three byte alignments. */
export function secretVariants(value) {
  const out = new Set([value]);
  try { out.add(encodeURIComponent(value)); out.add(encodeURIComponent(value).replace(/%20/g, '+')); } catch {}
  out.add(JSON.stringify(value).slice(1, -1));
  const bytes = Buffer.from(value, 'utf8');
  for (const k of [0, 1, 2]) {
    const b64 = Buffer.concat([Buffer.alloc(k), bytes]).toString('base64');
    const start = k ? 4 : 0, end = Math.floor((k + bytes.length) / 3) * 4, middle = b64.slice(start, end);
    if (middle.length >= 8) { out.add(middle); out.add(middle.replace(/\+/g, '-').replace(/\//g, '_')); }
  }
  return [...out].filter(v => v.length >= MIN_SECRET);
}
export class ScrubSet {
  #values = new Set(); #forms = new Set();
  /** Hold a credential value (resolved by host code). Values shorter than MIN_SECRET are not held: resolveCredential refuses them first. */
  add(value) { if (typeof value === 'string' && value.length >= MIN_SECRET && !this.#values.has(value)) { this.#values.add(value); for (const v of secretVariants(value)) this.#forms.add(v); } return value; }
  /** Hold a value observed in a session (a cookie, a storage value): the same as add, for values the host did not resolve itself. */
  addObserved(value) { return this.add(value); }
  get size() { return this.#values.size; }
  /** Whether `text` (a string or any JSON value) contains a held secret in any of its forms. */
  contains(text) {
    const s = typeof text === 'string' ? text : JSON.stringify(text ?? null);
    for (const form of this.#forms) if (s.includes(form)) return true;
    return false;
  }
  redact(text) { let s = String(text); for (const form of this.#forms) s = s.split(form).join('[redacted]'); return s; }
  containsBuffer(buffer) { for (const form of this.#forms) if (buffer.includes(Buffer.from(form, 'utf8'))) return true; return false; }
  /** Replace every held form in raw bytes (trace archives, artifacts). */
  redactBuffer(buffer) {
    let out = buffer;
    for (const form of this.#forms) {
      const needle = Buffer.from(form, 'utf8');
      if (!out.includes(needle)) continue;
      const parts = []; let at = 0, i;
      while ((i = out.indexOf(needle, at)) >= 0) { parts.push(out.subarray(at, i), REDACTED); at = i + needle.length; }
      parts.push(out.subarray(at)); out = Buffer.concat(parts);
    }
    return out;
  }
  assertClean(text, where) { if (this.contains(text)) fail('SECRET_EXPOSURE', `A credential value would have reached ${where}; refused`); return text; }
}
const REDACTED = Buffer.from('[redacted]', 'utf8');
// Names under which a site keeps a credential (a cookie, a storage key, a header).
const CREDENTIAL_NAME = /sess|sid|auth|token|jwt|csrf|xsrf|secret|key|passw|login|remember|bearer|credential|signature/i;
// A plain word or words: each all lower case, Capitalised or all capitals, at most 20 letters (a random mixed-case string is not one).
const WORD = '(?:[a-z]{1,20}|[A-Z][a-z]{1,19}|[A-Z]{1,20})', PLAIN_WORDS = new RegExp(`^${WORD}(?:[ _.,:-]${WORD})*$`);
/**
 * Whether a value observed in a browser session (a cookie, a storage value, a header) can be a credential, so that it joins the host-wide
 * scrub set (fix round 2026-11-04, security N3: every cookie of 6 characters or more joined it, so `lang=english` failed any later output
 * containing "english", the broker's own "granted" included). Fails closed where a credential is likely: always for a value a credential
 * header carried (`credential`), and for an HttpOnly cookie or a cookie or storage key named like a credential (unless the value is a
 * boolean word). Otherwise a plain word or words or a short number is page vocabulary, not a credential; anything else counts when it looks
 * random (16+ characters, or 8+ with a digit and another character class). Every value is still redacted from the session's own trace
 * (cua.mjs traceScrub), credential-like or not.
 */
export function credentialLike(value, { name = '', httpOnly = false, credential = false } = {}) {
  if (typeof value !== 'string' || value.length < MIN_SECRET) return false;
  if (credential) return true;
  if (/^(?:true|false|null|undefined|yes|no|on|off)$/i.test(value)) return false;
  if (httpOnly || CREDENTIAL_NAME.test(String(name))) return true;
  if (PLAIN_WORDS.test(value) || /^\d{1,13}$/.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(value)).length;
  return value.length >= 16 || (value.length >= 8 && classes >= 2 && /[0-9]/.test(value));
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
  if (value.length < MIN_SECRET) fail('CREDENTIAL_UNSCRUBBABLE', `The referenced credential is shorter than ${MIN_SECRET} characters; it could not be scrubbed from traces and logs, so it is refused`, { ref: Object.keys(ref)[0] });
  scrub?.add(value);
  return value;
}
/** Presence check for preflight: resolves and discards (the value still enters the scrub set). */
export async function credentialPresent(ref, options) { try { await resolveCredential(ref, options); return true; } catch (error) { if (error.code === 'CREDENTIAL_MISSING') return false; throw error; } }
