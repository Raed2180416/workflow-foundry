// Foundry bridge wire protocol: request signing shared by the laptop daemon and the cloud client.
// Zero dependencies (node: builtins only) and Node >= 20, because the daemon runs on the owner's laptop.
//
// Canonical string (PROTOCOL.md §2):
//   METHOD "\n" path-with-query "\n" timestamp-ms "\n" nonce "\n" sha256hex(body)
// signed with Ed25519 (crypto.sign(null, ...)); the signature travels base64 in x-bridge-sig.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DAEMON_VERSION = '0.2.0';
export const PROTOCOL = 'foundry-bridge/1';

export const H = Object.freeze({
  key: 'x-bridge-key',            // key id: first 16 hex of sha256(raw 32-byte Ed25519 public key)
  ts: 'x-bridge-ts',              // milliseconds since the epoch, decimal
  nonce: 'x-bridge-nonce',        // >= 16 random bytes, lowercase hex
  sig: 'x-bridge-sig',            // base64 Ed25519 signature of the canonical string
  bodySha: 'x-bridge-body-sha256' // optional extension: the body hash, announced so the daemon can verify before reading the body
});

export const MAX_SKEW_MS = 120_000;
export const NONCE_TTL_MS = 10 * 60_000;
export const NONCE_RE = /^[0-9a-f]{32,128}$/;
export const TS_RE = /^[0-9]{1,16}$/;
export const KEY_ID_RE = /^[0-9a-f]{16}$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const SIG_B64_RE = /^[A-Za-z0-9+/]{86}==$/; // 64 bytes in standard base64

export function sha256hex(data) {
  return crypto.createHash('sha256').update(data ?? '').digest('hex');
}
export const EMPTY_SHA256 = sha256hex('');

export function canonicalString({ method, path, ts, nonce, bodySha256 }) {
  if (typeof method !== 'string' || !/^[A-Z]+$/.test(method)) throw new TypeError('canonicalString: method must be an upper-case token');
  if (typeof path !== 'string' || !path.startsWith('/') || /[\r\n\0]/.test(path)) throw new TypeError('canonicalString: path must start with / and contain no CR, LF or NUL');
  if (!TS_RE.test(String(ts))) throw new TypeError('canonicalString: ts must be decimal milliseconds');
  if (!NONCE_RE.test(String(nonce))) throw new TypeError('canonicalString: nonce must be 32-128 lowercase hex characters');
  if (!SHA256_RE.test(String(bodySha256))) throw new TypeError('canonicalString: bodySha256 must be 64 lowercase hex characters');
  return `${method}\n${path}\n${ts}\n${nonce}\n${bodySha256}`;
}

export function newNonce() { return crypto.randomBytes(16).toString('hex'); }

// ---- keys ----------------------------------------------------------------------------------------

export function toPublicKey(input) {
  const key = input instanceof crypto.KeyObject ? input : crypto.createPublicKey(input);
  const pub = key.type === 'private' ? crypto.createPublicKey(key) : key;
  if (pub.asymmetricKeyType !== 'ed25519') throw new TypeError(`expected an Ed25519 key, got ${pub.asymmetricKeyType}`);
  return pub;
}

export function toPrivateKey(input) {
  const key = input instanceof crypto.KeyObject ? input : crypto.createPrivateKey(input);
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') throw new TypeError('expected an Ed25519 private key');
  return key;
}

export function rawPublicKey(publicKey) {
  const jwk = toPublicKey(publicKey).export({ format: 'jwk' });
  const raw = Buffer.from(jwk.x, 'base64url');
  if (raw.length !== 32) throw new TypeError('Ed25519 public key must be 32 bytes');
  return raw;
}

export function keyId(publicKey) { return sha256hex(rawPublicKey(publicKey)).slice(0, 16); }

export function publicKeyPem(publicKey) { return toPublicKey(publicKey).export({ type: 'spki', format: 'pem' }); }

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { publicKey, privateKey, keyId: keyId(publicKey) };
}

// ---- sign / verify -------------------------------------------------------------------------------

// Returns the four (or five) x-bridge-* headers for one request. `bodySha256` defaults to the hash of `body`.
export function signRequest({ privateKey, keyId: kid, method, path, body, bodySha256, ts = Date.now(), nonce = newNonce(), announceBodyHash = true }) {
  const priv = toPrivateKey(privateKey);
  const id = kid ?? keyId(priv);
  const hash = bodySha256 ?? sha256hex(body ?? '');
  const canonical = canonicalString({ method: method.toUpperCase(), path, ts: String(ts), nonce, bodySha256: hash });
  const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), priv).toString('base64');
  const headers = { [H.key]: id, [H.ts]: String(ts), [H.nonce]: nonce, [H.sig]: sig };
  if (announceBodyHash) headers[H.bodySha] = hash;
  return headers;
}

export function verifySignature(publicKey, canonical, sigB64) {
  if (typeof sigB64 !== 'string' || !SIG_B64_RE.test(sigB64)) return false;
  const sig = Buffer.from(sigB64, 'base64');
  if (sig.length !== 64) return false;
  try { return crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKey, sig); } catch { return false; }
}

export function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

// ---- nonce cache ---------------------------------------------------------------------------------
// A nonce is remembered until max(now, ts) + ttl. Because ttl (10 min) is longer than the +-120 s
// timestamp window, a forgotten nonce can never pass the timestamp check again, whatever the clock
// did in between: expiry is anchored in the request's own timestamp. Expired entries are purged from
// the front (insertion order is expiry order up to the 240 s spread of accepted timestamps, so an
// entry may outlive its expiry by that much, never the reverse). When full of unexpired nonces the
// cache refuses new ones rather than evicting: evicting an unexpired nonce would reopen a replay window.
//
// `file` (optional) makes the cache survive a daemon restart (finding F2): every accepted nonce is
// appended synchronously to the journal before the request is acted on, and the unexpired entries
// are reloaded on start. The journal is compacted when it holds many expired lines. A failed write is
// reported through onError (the cache keeps working in memory) and in `journal.error`.
const JOURNAL_LINE = /^([0-9]{1,16}) ([0-9a-f]{32,128})$/;

export class NonceCache {
  #map = new Map(); #file = null; #lines = 0; #onError; #error = null;
  constructor({ ttlMs = NONCE_TTL_MS, maxSize = 100_000, now = () => Date.now(), file = null, onError = () => {} } = {}) {
    this.ttlMs = ttlMs; this.maxSize = maxSize; this.now = now; this.#file = file; this.#onError = onError;
    if (file) this.#load();
  }
  #load() {
    let text = '';
    try { text = fs.readFileSync(this.#file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') this.#fail(error); }
    const t = this.now(); const entries = [];
    for (const line of text.split('\n')) {
      const m = JOURNAL_LINE.exec(line);   // a torn last line from a crash simply does not match
      if (m && Number(m[1]) > t) entries.push([m[2], Number(m[1])]);
    }
    entries.sort((a, b) => a[1] - b[1]);
    for (const [nonce, expiry] of entries) this.#map.set(nonce, Math.max(expiry, this.#map.get(nonce) ?? 0));
    this.#compact();
  }
  #fail(error) {
    const msg = `nonce journal ${this.#file}: ${error.code ?? error.message}`;
    if (this.#error !== msg) this.#onError(new Error(msg));
    this.#error = msg;
  }
  #compact() {
    if (!this.#file) return;
    try {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, [...this.#map].map(([n, e]) => `${e} ${n}\n`).join(''), { mode: 0o600 });
      fs.renameSync(tmp, this.#file);
      this.#lines = this.#map.size; this.#error = null;
    } catch (error) { this.#fail(error); }
  }
  #purge() {
    const t = this.now();
    for (const [nonce, expiry] of this.#map) { if (expiry > t) break; this.#map.delete(nonce); }
  }
  has(nonce) { this.#purge(); return this.#map.has(nonce); }
  // true when recorded; false when already seen; throws NONCE_CACHE_FULL when full.
  // `ts` is the request's timestamp (ms); expiry is max(now, ts) + ttl.
  add(nonce, ts = this.now()) {
    this.#purge();
    if (this.#map.has(nonce)) return false;
    if (this.#map.size >= this.maxSize) { const e = new Error('nonce cache full'); e.code = 'NONCE_CACHE_FULL'; throw e; }
    const expiry = Math.max(this.now(), Number(ts) || 0) + this.ttlMs;
    this.#map.set(nonce, expiry);
    if (this.#file) {
      if (this.#lines >= Math.max(4096, 2 * this.#map.size)) this.#compact();
      else {
        try { fs.appendFileSync(this.#file, `${expiry} ${nonce}\n`, { mode: 0o600 }); this.#lines++; this.#error = null; }
        catch (error) { this.#fail(error); }
      }
    }
    return true;
  }
  get size() { this.#purge(); return this.#map.size; }
  get journal() { return this.#file ? { file: this.#file, lines: this.#lines, error: this.#error } : null; }
}
