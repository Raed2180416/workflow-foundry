// Cloud-side client for the Foundry laptop bridge. Zero dependencies.
//
//   import { BridgeClient, loadKey, discover } from './bridge/cloud/client.mjs';
//   const client = new BridgeClient({ endpoint: (await discover()).url, key: loadKey() });
//   const kev = new SystemOneClient({ url: `${client.endpoint}/svc/kev`, fetchImpl: client.bridgeFetch });
//
// Every request except /health is signed (bridge/PROTOCOL.md §2). Requests go through HTTPS_PROXY
// with a CONNECT tunnel when the environment sets one (transport.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, keyId, publicKeyPem, signRequest, toPrivateKey, toPublicKey, sha256hex } from '../common/protocol.mjs';
import { parseRelPath } from '../common/relpath.mjs';
import { DEFAULT_BRANCH, DEFAULT_MAILBOX_DIR, Mailbox, parseEndpoint, runGit } from '../mailbox.mjs';
import { readAll, request } from './transport.mjs';

export const BRIDGE_HOME = path.join(os.homedir(), '.foundry-bridge');
export const DEFAULT_KEY_PATH = path.join(BRIDGE_HOME, 'cloud-ed25519.pem');
export const TERMINAL_JOB = new Set(['succeeded', 'failed', 'cancelled', 'stopped', 'lost']);

export class BridgeError extends Error {
  constructor(status, body, message) { super(message); this.code = 'BRIDGE_HTTP'; this.status = status; this.body = body; this.error = body?.error; this.reason = body?.reason; }
}

// ---- keys ----------------------------------------------------------------------------------------

export function keygen({ privatePath = DEFAULT_KEY_PATH, publicPath, force = false } = {}) {
  privatePath = path.resolve(privatePath);
  publicPath = path.resolve(publicPath ?? privatePath.replace(/\.pem$/, '') + '.pub');
  if (publicPath === privatePath) throw new Error('public and private key paths must differ');
  if (!force) for (const p of [privatePath, publicPath]) if (fs.existsSync(p)) throw Object.assign(new Error(`${p} exists; pass --force to replace it`), { code: 'EXISTS' });
  fs.mkdirSync(path.dirname(privatePath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(publicPath), { recursive: true });
  const { publicKey, privateKey, keyId: id } = generateKeyPair();
  // write the private key to a fresh 0600 file and rename it into place, so it is never world-readable
  const tmp = path.join(path.dirname(privatePath), `.keygen-${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, privatePath);
  fs.writeFileSync(publicPath, publicKeyPem(publicKey), { mode: 0o644 });
  return { keyId: id, privatePath, publicPath };
}

export function loadKey(privatePath = process.env.FOUNDRY_BRIDGE_KEY ?? DEFAULT_KEY_PATH) {
  let st;
  try { st = fs.statSync(privatePath); } catch { throw Object.assign(new Error(`no bridge key at ${privatePath}; run: node bridge/cloud/cli.mjs keygen`), { code: 'NO_KEY' }); }
  if (process.platform !== 'win32' && (st.mode & 0o077)) throw Object.assign(new Error(`${privatePath} is readable by group/others (mode ${(st.mode & 0o777).toString(8)}); chmod 600 it`), { code: 'KEY_PERMS' });
  const privateKey = toPrivateKey(fs.readFileSync(privatePath, 'utf8'));
  const publicKey = toPublicKey(privateKey);
  return { privateKey, publicKey, keyId: keyId(publicKey), path: privatePath };
}

// ---- discovery -----------------------------------------------------------------------------------

export async function defaultRemote(env = process.env) {
  if (env.FOUNDRY_BRIDGE_REMOTE) return env.FOUNDRY_BRIDGE_REMOTE;
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = await runGit(['-C', repo, 'remote', 'get-url', 'origin'], { timeoutMs: 10_000, env });
  if (r.code !== 0) throw new Error('cannot read the repository origin; set FOUNDRY_BRIDGE_REMOTE');
  return r.stdout.trim();
}

// git fetch the mailbox branch and read bridge-state/endpoint.json.
export async function discover({ mailboxDir = process.env.FOUNDRY_BRIDGE_MAILBOX ?? DEFAULT_MAILBOX_DIR, remote, branch = process.env.FOUNDRY_BRIDGE_BRANCH ?? DEFAULT_BRANCH, env = process.env, now = Date.now(), allowHttpLocal = env.FOUNDRY_BRIDGE_ALLOW_LOCAL === '1', staleAfterMs } = {}) {
  const mb = new Mailbox({ dir: mailboxDir, remote: remote ?? await defaultRemote(env), branch, env });
  const head = await mb.refresh();
  const raw = mb.readEndpointRaw();
  const keys = mb.readKeys().keys.map(k => k.id);
  const killed = mb.isKilled();
  if (raw === null) return { ok: false, url: null, errors: ['no bridge-state/endpoint.json yet: the laptop daemon has not published'], head, keys, killed };
  return { ...parseEndpoint(raw, { now, allowHttpLocal, ...(staleAfterMs ? { staleAfterMs } : {}) }), head, keys, killed };
}

// ---- client --------------------------------------------------------------------------------------

function headerObject(h) {
  const out = {};
  if (!h) return out;
  const entries = typeof h.entries === 'function' && !Array.isArray(h) ? h.entries() : Array.isArray(h) ? h : Object.entries(h);
  for (const [k, v] of entries) out[String(k).toLowerCase()] = String(v);
  return out;
}

function toBuffer(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw new TypeError('bridgeFetch supports string, Buffer, ArrayBuffer, typed-array and URLSearchParams bodies');
}

async function fileSha256(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Transform({ transform(c, _e, cb) { h.update(c); cb(); } }));
  return h.digest('hex');
}

export class BridgeClient {
  constructor({ endpoint, key, keyPath, timeoutMs = 60_000, env = process.env, transport = request, clockOffsetMs = 0 } = {}) {
    if (!endpoint) throw new Error('BridgeClient needs an endpoint (discover() or FOUNDRY_BRIDGE_URL)');
    const u = new URL(endpoint);
    if (u.pathname !== '/' || u.search || u.username) throw new Error('endpoint must be an origin like https://<name>.trycloudflare.com');
    this.endpoint = u.origin; this.origin = u.origin;
    this.key = key ?? loadKey(keyPath);
    Object.assign(this, { timeoutMs, env, transport, clockOffsetMs });
    this.bridgeFetch = this.bridgeFetch.bind(this);
  }

  // One signed request. `body`: Buffer/string; or `file` (streamed, hashed first). Retries once after a
  // stale_timestamp refusal, using the daemon's Date header to correct this machine's clock.
  async signed(method, pathWithQuery, { body, file, headers = {}, signal, timeoutMs = this.timeoutMs, idleMs } = {}) {
    if (!pathWithQuery.startsWith('/')) throw new TypeError('path must start with /');
    method = method.toUpperCase();
    const buf = toBuffer(body);
    const bodySha256 = file ? await fileSha256(file) : sha256hex(buf ?? '');
    const size = file ? (await fsp.stat(file)).size : buf?.length;
    for (let attempt = 0; attempt < 2; attempt++) {
      const sigHeaders = signRequest({ privateKey: this.key.privateKey, keyId: this.key.keyId, method, path: pathWithQuery, bodySha256, ts: Date.now() + this.clockOffsetMs });
      const hdrs = { ...headers, ...sigHeaders };
      if (size !== undefined) hdrs['content-length'] = String(size);
      const res = await this.transport(this.endpoint + pathWithQuery, { method, headers: hdrs, body: file ? fs.createReadStream(file) : buf, signal, timeoutMs, idleMs, env: this.env });
      if (res.status === 401 && attempt === 0 && res.headers.date) {
        const text = (await readAll(res.body, 1 << 20)).toString('utf8');
        let j = null; try { j = JSON.parse(text); } catch {}
        const server = Date.parse(res.headers.date);
        if (j?.reason === 'stale_timestamp' && Number.isFinite(server)) { this.clockOffsetMs = server - Date.now(); continue; }
        return { ...res, body: Readable.from([Buffer.from(text)]) };
      }
      return res;
    }
    throw new Error('unreachable');
  }

  async json(method, pathWithQuery, payload, opts = {}) {
    const res = await this.signed(method, pathWithQuery, { ...opts, body: payload === undefined ? undefined : JSON.stringify(payload), headers: payload === undefined ? {} : { 'content-type': 'application/json' } });
    const text = (await readAll(res.body, 64 << 20)).toString('utf8');
    let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
    if (res.status < 200 || res.status >= 300) throw new BridgeError(res.status, j ?? { raw: text.slice(0, 500) }, `${method} ${pathWithQuery} -> ${res.status} ${j?.error ?? ''}${j?.reason ? ` (${j.reason})` : ''}: ${j?.message ?? text.slice(0, 200)}`);
    return j;
  }

  // fetch-compatible: usable as `fetchImpl` for src/judgment.mjs SystemOneClient (url = <endpoint>/svc/kev)
  // and for OpenAI-compatible clients (base url = <endpoint>/svc/llm/<name>/v1).
  async bridgeFetch(input, init = {}) {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    let pathWithQuery;
    if (typeof urlStr !== 'string') throw new TypeError('bridgeFetch: input must be a URL or path');
    if (urlStr.startsWith('/')) pathWithQuery = urlStr;
    else {
      const u = new URL(urlStr);
      if (u.origin !== this.origin) throw new TypeError(`bridgeFetch: ${u.origin} is not the bridge endpoint ${this.origin}`);
      pathWithQuery = u.pathname + u.search;
    }
    const method = (init.method ?? (typeof input === 'object' && input?.method) ?? 'GET').toUpperCase();
    const headers = headerObject(init.headers);
    const body = toBuffer(init.body);
    if (init.body instanceof URLSearchParams && !headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    const res = await this.signed(method, pathWithQuery, { body, headers, signal: init.signal ?? undefined });
    const out = new Headers();
    for (let i = 0; i < res.rawHeaders.length; i += 2) { try { out.append(res.rawHeaders[i], res.rawHeaders[i + 1]); } catch {} }
    const nullBody = [101, 204, 205, 304].includes(res.status) || method === 'HEAD';
    if (nullBody) res.body.resume();
    return new Response(nullBody ? null : Readable.toWeb(res.body), { status: res.status, statusText: res.statusText, headers: out });
  }

  // ---- endpoints ----
  async health() {
    const t0 = Date.now();
    const res = await this.transport(`${this.endpoint}/health`, { method: 'GET', timeoutMs: this.timeoutMs, env: this.env });
    const text = (await readAll(res.body, 1 << 16)).toString('utf8');
    const server = Date.parse(res.headers.date ?? '');
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status: res.status, ...(j ?? { raw: text.slice(0, 200) }), rttMs: Date.now() - t0, skewMs: Number.isFinite(server) ? server - Date.now() : null };
  }
  ping() { return this.json('GET', '/ping'); }
  info() { return this.json('GET', '/info'); }
  list(dir = '', { recursive = false } = {}) {
    const q = new URLSearchParams(); if (dir) q.set('dir', dir); if (recursive) q.set('recursive', '1');
    return this.json('GET', `/files${q.size ? `?${q}` : ''}`);
  }
  async upload(file, rel, { overwrite = false, timeoutMs = 30 * 60_000 } = {}) {
    parseRelPath(rel, { tops: ['data', 'runs'] });
    const res = await this.json('PUT', `/files/${rel}${overwrite ? '?overwrite=1' : ''}`, undefined, { file, timeoutMs });
    return res;
  }
  async download(rel, dest, { timeoutMs = 60_000 } = {}) {
    parseRelPath(rel);
    const res = await this.signed('GET', `/files/${rel}`, { timeoutMs });
    if (res.status !== 200) {
      const text = (await readAll(res.body, 1 << 20)).toString('utf8');
      let j = null; try { j = JSON.parse(text); } catch {}
      throw new BridgeError(res.status, j, `GET /files/${rel} -> ${res.status}: ${j?.message ?? text.slice(0, 200)}`);
    }
    const expected = res.headers['x-bridge-sha256'];
    await fsp.mkdir(path.dirname(path.resolve(dest)), { recursive: true });
    const tmp = `${dest}.part-${crypto.randomBytes(3).toString('hex')}`;
    const h = crypto.createHash('sha256'); let size = 0;
    try {
      await pipeline(res.body, new Transform({ transform(c, _e, cb) { h.update(c); size += c.length; cb(null, c); } }), fs.createWriteStream(tmp));
    } catch (error) { await fsp.rm(tmp, { force: true }); throw error; }
    const sha256 = h.digest('hex');
    if (!expected || sha256 !== expected) { await fsp.rm(tmp, { force: true }); throw new Error(`download ${rel}: sha256 ${sha256} does not match the daemon's ${expected ?? '(none)'}`); }
    await fsp.rename(tmp, dest);
    return { path: rel, dest, size, sha256 };
  }
  // Downloads every file under a directory (e.g. a run) to destDir, preserving relative paths.
  async downloadDir(rel, destDir) {
    const listing = await this.list(rel, { recursive: true });
    const out = [];
    for (const e of listing.entries.filter(x => x.type === 'file')) out.push(await this.download(e.path, path.join(destDir, path.relative(rel, e.path))));
    return { files: out, truncated: listing.truncated };
  }
  submitJob(kind, params = {}) { return this.json('POST', '/jobs', { kind, params }); }
  job(id) { return this.json('GET', `/jobs/${encodeURIComponent(id)}`); }
  jobs() { return this.json('GET', '/jobs'); }
  log(id, offset = 0, limit) { return this.json('GET', `/jobs/${encodeURIComponent(id)}/log?offset=${offset}${limit ? `&limit=${limit}` : ''}`); }
  cancel(id) { return this.json('POST', `/jobs/${encodeURIComponent(id)}/cancel`); }

  // Polls the job (and its log) until it reaches a terminal state, or, for a service, until it is
  // running. Network errors are retried until timeoutMs; the job keeps running on the laptop.
  async waitJob(id, { pollMs = 2000, timeoutMs = 6 * 3600_000, onLog, signal } = {}) {
    const deadline = Date.now() + timeoutMs;
    let offset = 0; let lastError = null;
    for (;;) {
      if (signal?.aborted) throw new Error('waitJob aborted');
      try {
        const chunk = await this.log(id, offset);
        if (chunk.data && onLog) onLog(chunk.data);
        offset = chunk.nextOffset;
        if (chunk.nextOffset < chunk.size) continue;   // more log to read right away
        const job = await this.job(id);
        if (TERMINAL_JOB.has(job.state) || (job.class === 'service' && job.state === 'running')) {
          const rest = await this.log(id, offset);
          if (rest.data && onLog) onLog(rest.data);
          return job;
        }
        lastError = null;
      } catch (error) {
        if (error instanceof BridgeError && error.status < 500 && error.status !== 429) throw error;
        lastError = error;
      }
      if (Date.now() > deadline) throw new Error(`waitJob ${id}: timed out after ${timeoutMs} ms${lastError ? ` (last error: ${lastError.message})` : ''}`);
      await new Promise(r => setTimeout(r, pollMs));
    }
  }
}

export async function connect({ endpoint = process.env.FOUNDRY_BRIDGE_URL, keyPath, ...rest } = {}) {
  let discovered = null;
  if (!endpoint) {
    discovered = await discover(rest);
    if (!discovered.url) throw new Error(`bridge endpoint not available: ${discovered.errors.join('; ')}`);
    endpoint = discovered.url;
  }
  return { client: new BridgeClient({ endpoint, keyPath }), discovered };
}
