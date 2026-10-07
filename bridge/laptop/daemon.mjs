#!/usr/bin/env node
// Foundry bridge laptop daemon. Zero npm dependencies, Node >= 20, ESM.
//
//   node bridge/laptop/daemon.mjs [--config ~/foundry-bridge/bridge-config.json] [--check]
//        [--host 127.0.0.1] [--port 8765] [--workdir DIR] [--keys-dir DIR] [--public-url URL] [--no-mailbox]
//
// Binds 127.0.0.1 only; a Cloudflare quick tunnel (cloudflared) is the only way in. Every endpoint
// except GET /health needs an Ed25519 signature by a key listed in the mailbox branch
// (bridge-state/keys/*.pub). See bridge/PROTOCOL.md.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  DAEMON_VERSION, PROTOCOL, H, MAX_SKEW_MS, NONCE_RE, TS_RE, KEY_ID_RE, SHA256_RE, SIG_B64_RE,
  NonceCache, canonicalString, verifySignature, sha256hex, constantTimeEqualHex
} from '../common/protocol.mjs';
import { parseRelPath, TOPS } from '../common/relpath.mjs';
import { Mailbox, readKeyDir } from '../mailbox.mjs';
import { DEFAULT_CONFIG_PATH, loadConfig, normalizeConfig, ConfigError } from './config.mjs';
import { JobManager, JobError, JOB_ID_RE } from './jobs.mjs';
import { Publisher } from './publisher.mjs';
import { diskFree, gitHead, gpuInfo, gpuSummary, osInfo, pythonVersion } from './sysinfo.mjs';
import { discoverTunnelUrl } from './tunnel.mjs';

export class HttpError extends Error {
  constructor(status, code, message, reason, details) { super(message ?? code); this.status = status; this.code = code; this.reason = reason ?? code; this.details = details; }
}

const authFail = (reason, message) => new HttpError(401, 'unauthorized', message ?? reason, reason);
const UPLOAD_TOPS = ['data', 'runs'];   // logs/ is daemon-owned: readable, never writable
const STRIP_REQ = /^(x-bridge-.*|authorization|proxy-authorization|cookie|host|connection|keep-alive|transfer-encoding|te|trailer|upgrade|proxy-connection|content-length|expect|forwarded|x-forwarded-.*|x-real-ip|true-client-ip|cf-.*|cdn-loop)$/i;
const STRIP_RES = /^(connection|keep-alive|transfer-encoding|proxy-.*|trailer|upgrade)$/i;

function inside(child, parent) { return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep); }

function sendJson(req, res, status, obj, headers = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  const close = !req.complete;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(close ? { connection: 'close' } : {}), ...headers });
  res.end(body);
  // an unauthenticated or refused request may still be streaming a large body: do not read it
  if (close) res.once('finish', () => setTimeout(() => { if (!req.complete) req.socket?.destroy(); }, 100).unref());
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) { failed = true; req.pause(); reject(new HttpError(413, 'too_large', `body over ${limit} bytes`)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', error => { if (!failed) { failed = true; reject(new HttpError(400, 'bad_body', error.message)); } });
    req.on('aborted', () => { if (!failed) { failed = true; reject(new HttpError(400, 'bad_body', 'request aborted')); } });
  });
}

async function hashFile(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Transform({ transform(c, _e, cb) { h.update(c); cb(); } }));
  return h.digest('hex');
}

// ---- daemon --------------------------------------------------------------------------------------

export async function createDaemon({ config, keysDir = null, mailbox = null, publicUrl = null, log = defaultLog, now = () => Date.now(), publish = true } = {}) {
  const cfg = normalizeConfig(config);   // idempotent on an already normalized config
  await fsp.mkdir(cfg.workdir, { recursive: true });
  const startedAt = new Date(now()).toISOString();
  const state = { keys: new Map(), keySource: keysDir ? 'keys-dir' : mailbox ? 'mailbox' : 'none', keysLoadedAt: 0, keyErrors: [], killed: false, mailboxHead: null, refreshError: null, refreshedAt: null };
  const nonces = new NonceCache({ maxSize: cfg.limits.nonceCache, now });
  let publisher = null;

  const jobs = new JobManager({ config: cfg, workdir: cfg.workdir, log, refresh: () => refresh(), onServicesChange: () => publisher?.poke(), now });
  await jobs.init();
  const workdirReal = jobs.workdirReal;
  const accessLogFile = path.join(workdirReal, 'logs', 'bridge-access.log');

  function access(rec) {
    try {
      try { if (fs.statSync(accessLogFile).size > 10 * 1024 * 1024) fs.renameSync(accessLogFile, `${accessLogFile}.1`); } catch {}
      fs.appendFileSync(accessLogFile, JSON.stringify(rec) + '\n');
    } catch {}
  }

  function setKeys(list, errors = []) {
    state.keys = new Map(list.map(k => [k.id, k]));
    state.keysLoadedAt = now(); state.keyErrors = errors;
  }
  function setKilled(on) {
    if (on !== state.killed) log(on ? 'KILL switch set: stopping all jobs and services, refusing signed requests' : 'KILL switch cleared');
    state.killed = !!on; jobs.setKilled(on);
  }

  async function refresh() {
    if (keysDir) {
      const { keys, errors } = readKeyDir(keysDir);
      setKeys(keys, errors); state.refreshedAt = new Date(now()).toISOString();
      return { source: 'keys-dir', keys: keys.map(k => k.id), errors };
    }
    if (!mailbox) return { source: 'none', keys: [] };
    try {
      const head = await mailbox.refresh();
      const { keys, errors } = mailbox.readKeys();
      setKeys(keys, errors); setKilled(mailbox.isKilled());
      Object.assign(state, { mailboxHead: head, refreshError: null, refreshedAt: new Date(now()).toISOString() });
      return { source: 'mailbox', head, keys: keys.map(k => k.id), errors, killed: state.killed };
    } catch (error) {
      state.refreshError = error.message;
      throw error;
    }
  }

  // ---- auth ----
  function preAuth(req) {
    const h = req.headers;
    const kid = h[H.key], ts = h[H.ts], nonce = h[H.nonce], sig = h[H.sig];
    if (!kid || !ts || !nonce || !sig) throw authFail('unsigned', 'missing x-bridge-* signature headers');
    if (state.keySource === 'mailbox' && state.keysLoadedAt && now() - state.keysLoadedAt > cfg.mailbox.keysMaxAgeHours * 3600_000) throw new HttpError(503, 'keys_stale', 'trusted keys have not been refreshed recently; refusing all keys until the mailbox refresh succeeds');
    const key = KEY_ID_RE.test(kid) ? state.keys.get(kid) : undefined;
    if (!key) throw authFail('unknown_key', 'unknown key');
    if (!TS_RE.test(ts)) throw authFail('bad_timestamp');
    const skew = now() - Number(ts);
    if (Math.abs(skew) > MAX_SKEW_MS) throw authFail('stale_timestamp', `timestamp outside +-${MAX_SKEW_MS / 1000} s`);
    if (!NONCE_RE.test(nonce)) throw authFail('bad_nonce');
    if (nonces.has(nonce)) throw authFail('replayed_nonce', 'nonce already used');
    if (!SIG_B64_RE.test(sig)) throw authFail('bad_signature');
    const announced = h[H.bodySha];
    if (announced !== undefined && !SHA256_RE.test(announced)) throw new HttpError(400, 'bad_body_hash', 'x-bridge-body-sha256 must be 64 lowercase hex');
    return { key, keyId: kid, ts, nonce, sig, announced };
  }
  function verify(auth, req, bodySha) {
    let canonical;
    try { canonical = canonicalString({ method: req.method, path: req.url, ts: auth.ts, nonce: auth.nonce, bodySha256: bodySha }); }
    catch { throw authFail('bad_request_line'); }
    if (!verifySignature(auth.key.publicKey, canonical, auth.sig)) throw authFail('bad_signature', 'bad signature');
    let added;
    try { added = nonces.add(auth.nonce); } catch { throw new HttpError(503, 'busy', 'nonce cache full', 'nonce_cache_full'); }
    if (!added) throw authFail('replayed_nonce', 'nonce already used');
  }

  // ---- routes ----
  const ROUTES = [
    ['GET', /^\/info$/, 'info'], ['GET', /^\/ping$/, 'ping'],
    ['GET', /^\/files$/, 'listFiles'], ['GET', /^\/files\/(.+)$/, 'getFile'], ['PUT', /^\/files\/(.+)$/, 'putFile'],
    ['POST', /^\/jobs$/, 'submit'], ['GET', /^\/jobs$/, 'listJobs'],
    ['GET', /^\/jobs\/([^/]+)$/, 'getJob'], ['GET', /^\/jobs\/([^/]+)\/log$/, 'jobLog'], ['POST', /^\/jobs\/([^/]+)\/(?:cancel|stop)$/, 'cancel'],
    ['*', /^\/svc\/kev(\/.*)?$/, 'svcKev'], ['*', /^\/svc\/llm\/([a-z0-9][a-z0-9-]{0,31})(\/.*)?$/, 'svcLlm']
  ];
  function match(method, pathname) {
    for (const [m, re, name] of ROUTES) { const hit = re.exec(pathname); if (hit && (m === '*' || m === method)) return { name, args: hit.slice(1) }; }
    return null;
  }

  async function handle(req, res, rec) {
    const raw = req.url;
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.length > 8192) throw new HttpError(400, 'bad_request', 'bad request target');
    const qi = raw.indexOf('?');
    const pathname = qi < 0 ? raw : raw.slice(0, qi);
    const query = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1));
    if (pathname === '/health' && (req.method === 'GET' || req.method === 'HEAD')) return sendJson(req, res, 200, { ok: !state.killed, version: DAEMON_VERSION });

    const route = match(req.method, pathname);
    const isUpload = route?.name === 'putFile';
    const limit = isUpload ? cfg.limits.fileBytes : cfg.limits.jsonBytes;
    const auth = preAuth(req);
    const declared = req.headers['content-length'] !== undefined ? Number(req.headers['content-length']) : null;
    if (declared !== null && (!Number.isFinite(declared) || declared > limit)) throw new HttpError(413, 'too_large', `body over ${limit} bytes`);
    let body = null;
    if (isUpload) {
      if (!auth.announced) throw new HttpError(400, 'body_hash_required', 'uploads must announce x-bridge-body-sha256');
      verify(auth, req, auth.announced);   // before a single body byte is written to disk
    } else {
      body = await readBody(req, limit);
      const sha = sha256hex(body);
      if (auth.announced && !constantTimeEqualHex(sha, auth.announced)) throw authFail('body_hash_mismatch', 'body does not match x-bridge-body-sha256');
      verify(auth, req, sha);
    }
    rec.keyId = auth.keyId;
    if (state.killed) throw new HttpError(403, 'killed', 'the kill switch is set (bridge-state/KILL in the mailbox)');
    if (!route) throw new HttpError(404, 'not_found', 'no such endpoint');
    const [a1, a2] = route.args;
    switch (route.name) {
      case 'ping': return sendJson(req, res, 200, { ok: true, keyId: auth.keyId, version: DAEMON_VERSION, protocol: PROTOCOL, time: new Date(now()).toISOString() });
      case 'info': return sendJson(req, res, 200, await info());
      case 'listFiles': return sendJson(req, res, 200, await listFiles(query.get('dir') ?? '', query.get('recursive') === '1'));
      case 'getFile': return getFile(req, res, a1);
      case 'putFile': return putFile(req, res, a1, auth.announced, query.get('overwrite') === '1', limit);
      case 'submit': {
        let payload;
        try { payload = JSON.parse(body.toString('utf8') || 'null'); } catch { throw new HttpError(400, 'bad_json', 'body is not JSON'); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400, 'bad_json', 'expected {kind, params}');
        const extraKeys = Object.keys(payload).filter(k => k !== 'kind' && k !== 'params');
        if (extraKeys.length) throw new HttpError(400, 'bad_json', `unexpected fields: ${extraKeys.join(', ')}`);
        const job = await jobs.submit(payload.kind, payload.params);
        return sendJson(req, res, 202, job);
      }
      case 'listJobs': return sendJson(req, res, 200, { jobs: jobs.list({ limit: Math.min(500, Number(query.get('limit')) || 50) }), queue: jobs.queue() });
      case 'getJob': { const j = JOB_ID_RE.test(a1) && jobs.get(a1); if (!j) throw new HttpError(404, 'no_job', 'no such job'); return sendJson(req, res, 200, j); }
      case 'jobLog': {
        if (!JOB_ID_RE.test(a1)) throw new HttpError(404, 'no_job', 'no such job');
        const offset = Math.max(0, Math.floor(Number(query.get('offset')) || 0));
        const lim = Math.min(1024 * 1024, Math.max(1, Math.floor(Number(query.get('limit')) || 256 * 1024)));
        const r = jobs.readLog(a1, offset, lim);
        if (!r) throw new HttpError(404, 'no_job', 'no such job');
        return sendJson(req, res, 200, r);
      }
      case 'cancel': { const j = JOB_ID_RE.test(a1) && await jobs.cancel(a1); if (!j) throw new HttpError(404, 'no_job', 'no such job'); return sendJson(req, res, 200, j); }
      case 'svcKev': return proxy(req, res, jobs.serviceTarget('kev.serve'), a1 ?? '/', qi < 0 ? '' : raw.slice(qi), body, 'kev');
      case 'svcLlm': return proxy(req, res, jobs.serviceTarget('llama.serve', a1), a2 ?? '/', qi < 0 ? '' : raw.slice(qi), body, `llm/${a1}`);
    }
    throw new HttpError(404, 'not_found', 'no such endpoint');
  }

  async function info() {
    const [gpu, python, kev, disk] = await Promise.all([gpuInfo(cfg.nvidiaSmi), pythonVersion(cfg.python), gitHead(cfg.kevDir), diskFree(workdirReal)]);
    return {
      version: DAEMON_VERSION, protocol: PROTOCOL, startedAt, time: new Date(now()).toISOString(),
      os: osInfo(), node: process.version, python: python.version ?? null, pythonError: python.reason ?? null,
      kevCommit: kev.commit ?? null, llamaServer: !!(cfg.llamaServer && fs.existsSync(cfg.llamaServer)), device: cfg.device,
      gpu, disk, services: jobs.services(), queue: jobs.queue(),
      keys: { source: state.keySource, count: state.keys.size, errors: state.keyErrors.length, loadedAt: state.keysLoadedAt ? new Date(state.keysLoadedAt).toISOString() : null },
      mailbox: state.keySource === 'mailbox' ? { branch: cfg.mailbox.branch, head: state.mailboxHead, refreshedAt: state.refreshedAt, error: state.refreshError, lastPublished: publisher?.lastPublished ?? null, publishError: publisher?.lastError ?? null } : null,
      tunnel: publisher?.tunnel ?? { url: publicUrl, source: publicUrl ? 'flag' : null },
      killed: state.killed, limits: { fileBytes: cfg.limits.fileBytes, jsonBytes: cfg.limits.jsonBytes }
    };
  }

  // ---- files ----
  async function topReal(top) {
    const p = path.join(workdirReal, top);
    await fsp.mkdir(p, { recursive: true });
    return fsp.realpath(p);
  }
  function relOrThrow(input, opts) {
    try { return parseRelPath(input, opts); } catch (error) { throw new HttpError(400, 'bad_path', error.message, error.reason); }
  }

  async function listFiles(dir, recursive) {
    if (!dir) return { dir: '', entries: TOPS.map(t => ({ path: t, type: 'dir' })) };
    const { segments, rel } = relOrThrow(dir);
    const top = await topReal(segments[0]);
    let real;
    try { real = await fsp.realpath(path.join(workdirReal, ...segments)); } catch { throw new HttpError(404, 'not_found', `${rel} does not exist`); }
    if (!inside(real, top)) throw new HttpError(403, 'symlink_escape', `${rel} leaves ${segments[0]}/`);
    if (!(await fsp.stat(real)).isDirectory()) throw new HttpError(400, 'not_a_directory', `${rel} is not a directory`);
    const entries = []; let truncated = false;
    async function walk(abs, relDir, depth) {
      const ents = (await fsp.readdir(abs, { withFileTypes: true })).sort((x, y) => x.name.localeCompare(y.name));
      for (const e of ents) {
        if (e.name.startsWith('.')) continue;
        if (entries.length >= 5000) { truncated = true; return; }
        const r = `${relDir}/${e.name}`, a = path.join(abs, e.name);
        if (e.isSymbolicLink()) { entries.push({ path: r, type: 'symlink' }); continue; }
        if (e.isDirectory()) { entries.push({ path: r, type: 'dir' }); if (recursive && depth < 16) await walk(a, r, depth + 1); continue; }
        if (e.isFile()) { const st = await fsp.stat(a); entries.push({ path: r, type: 'file', size: st.size, mtime: st.mtime.toISOString() }); }
      }
    }
    await walk(real, rel, 0);
    return { dir: rel, entries, truncated };
  }

  async function getFile(req, res, tail) {
    const { segments, rel } = relOrThrow(tail, { decode: true });
    const top = await topReal(segments[0]);
    let real;
    try { real = await fsp.realpath(path.join(workdirReal, ...segments)); } catch { throw new HttpError(404, 'not_found', `${rel} does not exist`); }
    if (!inside(real, top)) throw new HttpError(403, 'symlink_escape', `${rel} leaves ${segments[0]}/ through a symlink`);
    const st = await fsp.stat(real);
    if (st.isDirectory()) throw new HttpError(400, 'is_directory', `${rel} is a directory; use GET /files?dir=`);
    if (!st.isFile()) throw new HttpError(403, 'not_a_file', `${rel} is not a regular file`);
    const sha = await hashFile(real);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'x-bridge-sha256': sha, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    await pipeline(fs.createReadStream(real), res);
  }

  async function putFile(req, res, tail, expectedSha, overwrite, limit) {
    const { segments, rel } = relOrThrow(tail, { decode: true, tops: UPLOAD_TOPS });
    if (segments.length < 2) throw new HttpError(400, 'bad_path', 'name a file below data/ or runs/');
    const top = await topReal(segments[0]);
    // walk the parents: an existing component may be a symlink only if it stays inside the top dir
    let cur = top;
    for (const seg of segments.slice(1, -1)) {
      const next = path.join(cur, seg);
      let st = null;
      try { st = await fsp.lstat(next); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!st) { await fsp.mkdir(next); cur = next; continue; }
      if (st.isSymbolicLink()) {
        const r = await fsp.realpath(next);
        if (!inside(r, top)) throw new HttpError(403, 'symlink_escape', `${rel} leaves ${segments[0]}/ through a symlink`);
        if (!(await fsp.stat(r)).isDirectory()) throw new HttpError(409, 'not_a_directory', `${seg} is not a directory`);
        cur = r; continue;
      }
      if (!st.isDirectory()) throw new HttpError(409, 'not_a_directory', `${seg} is not a directory`);
      cur = next;
    }
    const target = path.join(cur, segments[segments.length - 1]);
    let existing = null;
    try { existing = await fsp.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing?.isSymbolicLink()) throw new HttpError(403, 'symlink_target', `${rel} is a symlink`);
    if (existing?.isDirectory()) throw new HttpError(409, 'is_directory', `${rel} is a directory`);
    if (existing && !overwrite) throw new HttpError(409, 'exists', `${rel} exists; pass ?overwrite=1 to replace it`);
    const tmp = path.join(cur, `.upload-${crypto.randomBytes(6).toString('hex')}.part`);
    const hash = crypto.createHash('sha256'); let size = 0;
    try {
      await pipeline(req, new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length;
          if (size > limit) return cb(new HttpError(413, 'too_large', `body over ${limit} bytes`));
          hash.update(chunk); cb(null, chunk);
        }
      }), fs.createWriteStream(tmp, { flags: 'wx', mode: 0o644 }));
    } catch (error) {
      await fsp.rm(tmp, { force: true });
      if (error instanceof HttpError) throw error;
      if (error.code === 'ENOSPC') throw new HttpError(507, 'disk_full', 'no space left on the laptop');
      throw new HttpError(400, 'bad_body', `upload interrupted: ${error.code ?? error.message}`);
    }
    const sha = hash.digest('hex');
    if (!constantTimeEqualHex(sha, expectedSha)) { await fsp.rm(tmp, { force: true }); throw new HttpError(400, 'body_hash_mismatch', 'uploaded bytes do not match x-bridge-body-sha256'); }
    await fsp.rename(tmp, target);
    return sendJson(req, res, 201, { path: rel, size, sha256: sha });
  }

  // ---- service proxy ----
  function proxy(req, res, target, upstreamPath, search, body, label) {
    if (!target) throw new HttpError(502, 'service_not_running', `no running ${label} service`);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!STRIP_REQ.test(k)) headers[k] = v;
    headers.host = `127.0.0.1:${target.port}`;
    if (body.length || !['GET', 'HEAD'].includes(req.method)) headers['content-length'] = String(body.length);
    return new Promise(resolve => {
      const up = http.request({ host: '127.0.0.1', port: target.port, method: req.method, path: upstreamPath + search, headers, agent: false, timeout: cfg.proxyTimeoutSeconds * 1000 });
      up.on('response', ur => {
        const out = {};
        for (const [k, v] of Object.entries(ur.headers)) if (!STRIP_RES.test(k)) out[k] = v;
        res.writeHead(ur.statusCode, out);
        ur.pipe(res);
        ur.on('end', resolve); ur.on('error', () => { res.destroy(); resolve(); });
      });
      up.on('timeout', () => up.destroy(Object.assign(new Error('upstream timeout'), { code: 'ETIMEDOUT' })));
      up.on('error', error => {
        if (!res.headersSent) sendJson(req, res, error.code === 'ETIMEDOUT' ? 504 : 502, { error: error.code === 'ETIMEDOUT' ? 'upstream_timeout' : 'upstream_unreachable', message: `${label}: ${error.code ?? error.message}` });
        else res.destroy();
        resolve();
      });
      up.end(body);
    });
  }

  // ---- server ----
  const server = http.createServer((req, res) => {
    const t0 = Date.now();
    const rec = { t: new Date(now()).toISOString(), method: req.method, path: String(req.url ?? '').slice(0, 300), status: 0, ms: 0, keyId: null, reason: null };
    res.on('finish', () => { rec.status = res.statusCode; rec.ms = Date.now() - t0; access(rec); });
    res.on('close', () => { if (!res.writableFinished) { rec.status = res.statusCode; rec.ms = Date.now() - t0; rec.reason ??= 'connection_closed'; access(rec); } });
    handle(req, res, rec).catch(error => {
      const known = error instanceof HttpError || error instanceof JobError;
      const status = known ? error.status : 500;
      rec.reason = known ? (error.reason ?? error.code) : 'internal_error';
      if (!known) log(`internal error on ${req.method} ${rec.path}: ${error.stack ?? error.message}`);
      if (res.headersSent) { res.destroy(); return; }
      const reason = known && error.reason && error.reason !== error.code ? { reason: error.reason } : {};
      sendJson(req, res, status, { error: known ? error.code : 'internal_error', message: known ? error.message : 'internal error', ...reason, ...(error.details ? { details: error.details } : {}) });
    });
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 30 * 60_000;
  server.keepAliveTimeout = 5_000;
  server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n'); } catch {} });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: cfg.host, port: cfg.port }, () => { server.off('error', reject); resolve(); }); });
  const port = server.address().port;
  const url = `http://${cfg.host.includes(':') ? `[${cfg.host}]` : cfg.host}:${port}`;

  // initial keys; with a mailbox the publisher refreshes on its first tick
  if (keysDir) await refresh();
  if (mailbox && publish) {
    publisher = new Publisher({
      mailbox, refresh, log, daemonVersion: DAEMON_VERSION, startedAt, now,
      heartbeatMs: cfg.mailbox.heartbeatMinutes * 60_000, refreshMs: cfg.mailbox.refreshMinutes * 60_000, pollMs: cfg.tunnel.pollSeconds * 1000,
      discoverTunnel: () => discoverTunnelUrl({ publicUrl: publicUrl ?? cfg.tunnel.publicUrl, metrics: cfg.tunnel.metrics, log: cfg.tunnel.log }),
      snapshot: async () => ({ gpu: gpuSummary(await gpuInfo(cfg.nvidiaSmi)), services: jobs.services().map(s => ({ id: s.id, kind: s.kind, name: s.name, state: s.state })) })
    }).start();
  } else if (mailbox) await refresh().catch(error => log(`mailbox refresh failed: ${error.message}`));

  let closing = null;
  const close = () => (closing ??= doClose());
  async function doClose() {
    const closed = new Promise(r => server.close(r));
    server.closeAllConnections?.();
    await closed;
    await jobs.shutdown();
    if (publisher) await publisher.stop();
  }
  return { server, port, url, jobs, state, refresh, setKilled, close, publisher: () => publisher, config: cfg };
}

function defaultLog(msg) { process.stdout.write(`[foundry-bridge ${new Date().toISOString()}] ${msg}\n`); }

// ---- CLI -----------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { config: process.env.FOUNDRY_BRIDGE_CONFIG ?? DEFAULT_CONFIG_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => { const v = argv[++i]; if (v === undefined) throw new ConfigError(`${a} needs a value`); return v; };
    switch (a) {
      case '--config': o.config = next(); break;
      case '--host': o.host = next(); break;
      case '--port': o.port = Number(next()); break;
      case '--workdir': o.workdir = next(); break;
      case '--keys-dir': o.keysDir = path.resolve(next()); break;
      case '--public-url': o.publicUrl = next(); break;
      case '--no-mailbox': o.noMailbox = true; break;
      case '--check': o.check = true; break;
      case '--version': o.version = true; break;
      case '-h': case '--help': o.help = true; break;
      default: throw new ConfigError(`unknown argument ${a}`);
    }
  }
  return o;
}

async function defaultRemote() {
  const { runGit } = await import('../mailbox.mjs');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const r = await runGit(['-C', repo, 'remote', 'get-url', 'origin'], { timeoutMs: 10_000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

async function check(cfg, opts) {
  const lines = []; let ok = true;
  const mark = (good, label, detail = '') => { if (!good) ok = false; lines.push(`${good ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`); };
  const warn = (label, detail = '') => lines.push(`WARN  ${label}${detail ? `: ${detail}` : ''}`);
  const soft = (good, label, detail = '') => (good ? mark(true, label, detail) : warn(label, detail));
  mark(Number(process.versions.node.split('.')[0]) >= 20, 'node >= 20', process.version);
  try { await fsp.mkdir(cfg.workdir, { recursive: true }); await fsp.access(cfg.workdir, fs.constants.W_OK); mark(true, 'workdir writable', cfg.workdir); } catch (e) { mark(false, 'workdir writable', e.message); }
  const py = await pythonVersion(cfg.python); mark(!!py.version, 'python', py.version ?? py.reason);
  const kev = await gitHead(cfg.kevDir); mark(!!kev.commit, 'kev checkout', kev.commit ?? kev.reason);
  const gpu = await gpuInfo(cfg.nvidiaSmi); soft(gpu.available, 'nvidia-smi', gpu.available ? `${gpu.gpus[0].name}, ${gpu.gpus[0].memoryTotalMiB} MiB, driver ${gpu.gpus[0].driver}, CUDA ${gpu.cuda}` : gpu.reason);
  if (cfg.llamaServer) mark(fs.existsSync(cfg.llamaServer), 'llama-server', cfg.llamaServer); else warn('llama-server', 'not configured (optional)');
  if (opts.keysDir) { const k = readKeyDir(opts.keysDir); mark(k.keys.length > 0, 'keys dir', `${k.keys.length} key(s)${k.errors.length ? `, errors: ${k.errors.join('; ')}` : ''}`); }
  else if (cfg.mailbox.enabled && !opts.noMailbox) {
    try {
      const mb = new Mailbox({ dir: cfg.mailbox.dir, remote: cfg.mailbox.remote ?? await defaultRemote(), branch: cfg.mailbox.branch });
      const head = await mb.refresh(); const k = mb.readKeys();
      mark(k.keys.length > 0, 'mailbox keys', `${cfg.mailbox.branch}@${head.slice(0, 8)}: ${k.keys.length} key(s) [${k.keys.map(x => x.id).join(', ')}]${k.errors.length ? `, errors: ${k.errors.join('; ')}` : ''}`);
      if (mb.isKilled()) warn('mailbox', 'KILL file present: the daemon will refuse all work');
      const push = await (await import('../mailbox.mjs')).runGit(['push', '--dry-run', '--quiet', 'origin', `HEAD:refs/heads/${cfg.mailbox.branch}`], { cwd: mb.dir, timeoutMs: 60_000 });
      mark(push.code === 0, 'mailbox push access (dry run)', push.code === 0 ? 'ok' : push.stderr.trim().slice(0, 200));
    } catch (e) { mark(false, 'mailbox', e.message); }
  } else warn('mailbox', 'disabled');
  const t = await discoverTunnelUrl({ publicUrl: opts.publicUrl ?? cfg.tunnel.publicUrl, metrics: cfg.tunnel.metrics, log: cfg.tunnel.log });
  soft(!!t.url, 'tunnel URL', t.url ? `${t.url} (${t.source})` : 'not found yet (start cloudflared)');
  const free = await new Promise(r => { const s = http.createServer(); s.once('error', () => r(false)); s.listen(cfg.port, cfg.host, () => s.close(() => r(true))); });
  soft(free, `port ${cfg.host}:${cfg.port} free`, free ? '' : 'in use (the daemon may already be running)');
  return { ok, text: lines.join('\n') };
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  if (opts.help) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  if (opts.version) { console.log(DAEMON_VERSION); return; }
  let cfg;
  try {
    const base = fs.existsSync(opts.config) ? JSON.parse(fs.readFileSync(opts.config, 'utf8')) : (opts.keysDir ? {} : null);
    if (!base) throw new ConfigError(`config ${opts.config} not found (copy bridge/laptop/bridge-config.example.json there)`);
    for (const k of ['host', 'port', 'workdir']) if (opts[k] !== undefined) base[k] = opts[k];
    cfg = normalizeConfig(base);
  } catch (error) { console.error(error.message); process.exit(2); }
  if (opts.check) { const r = await check(cfg, opts); console.log(r.text); process.exit(r.ok ? 0 : 1); }
  let mailbox = null;
  if (!opts.keysDir && cfg.mailbox.enabled && !opts.noMailbox) {
    const remote = cfg.mailbox.remote ?? await defaultRemote();
    if (!remote) { console.error('mailbox.remote is not set and the repository origin could not be read'); process.exit(2); }
    mailbox = new Mailbox({ dir: cfg.mailbox.dir, remote, branch: cfg.mailbox.branch });
  }
  const d = await createDaemon({ config: cfg, keysDir: opts.keysDir ?? null, mailbox, publicUrl: opts.publicUrl ?? null });
  defaultLog(`foundry-bridge ${DAEMON_VERSION} listening on ${d.url} (workdir ${cfg.workdir}; keys from ${opts.keysDir ? 'keys dir' : mailbox ? `mailbox ${cfg.mailbox.branch}` : 'nowhere: every signed request will fail'})`);
  let stopping = false;
  const stop = async sig => {
    if (stopping) return; stopping = true;
    defaultLog(`${sig}: stopping jobs and services, publishing state=stopped`);
    const hard = setTimeout(() => process.exit(1), 40_000); hard.unref();
    try { await d.close(); } catch (e) { defaultLog(`shutdown error: ${e.message}`); }
    process.exit(0);
  };
  process.on('unhandledRejection', error => defaultLog(`unhandled rejection (daemon keeps running): ${error?.stack ?? error}`));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGHUP', () => d.refresh().then(r => defaultLog(`SIGHUP refresh: ${r.keys?.length ?? 0} key(s)`), e => defaultLog(`SIGHUP refresh failed: ${e.message}`)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
