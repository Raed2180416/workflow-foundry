// Minimal HTTP(S) client that honours HTTPS_PROXY / NO_PROXY with a CONNECT tunnel.
// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set at startup, and
// undici's ProxyAgent is not a public module in Node 24, so this file implements the tunnel with
// node:http + node:tls. Zero dependencies.
//
// CA trust: Node already adds NODE_EXTRA_CA_CERTS to its default store at startup. When that is not
// set and the agent-proxy bundle exists (/root/.ccr/ca-bundle.crt), it is added explicitly.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export const AGENT_PROXY_CA = '/root/.ccr/ca-bundle.crt';

export class TransportError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

function ipv4ToInt(ip) { return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0; }
function cidrMatch(ip, cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!net.isIPv4(base) || !net.isIPv4(ip) || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function bypassProxy(hostname, port, noProxy) {
  if (!noProxy) return false;
  const host = String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
  for (let entry of String(noProxy).split(/[\s,]+/)) {
    entry = entry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;
    let ePort = null;
    const m = /^(.*[^:]):([0-9]+)$/.exec(entry);
    if (m && !entry.includes('::')) { entry = m[1]; ePort = Number(m[2]); }
    if (ePort !== null && ePort !== port) continue;
    if (entry.includes('/')) { if (cidrMatch(host, entry)) return true; continue; }
    if (entry.startsWith('*.')) entry = entry.slice(1);
    if (entry.startsWith('.')) { if (host.endsWith(entry) || host === entry.slice(1)) return true; continue; }
    if (host === entry || host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

export function proxyFor(url, env = process.env) {
  const u = url instanceof URL ? url : new URL(url);
  const isHttps = u.protocol === 'https:';
  const proxy = isHttps ? (env.HTTPS_PROXY ?? env.https_proxy) : (env.HTTP_PROXY ?? env.http_proxy);
  if (!proxy) return null;
  const port = Number(u.port || (isHttps ? 443 : 80));
  if (bypassProxy(u.hostname, port, env.NO_PROXY ?? env.no_proxy)) return null;
  return proxy;
}

export function defaultCa(env = process.env) {
  if (env.NODE_EXTRA_CA_CERTS) return undefined;   // already in Node's default store
  try { return [...tls.rootCertificates, fs.readFileSync(AGENT_PROXY_CA, 'utf8')]; } catch { return undefined; }
}

function onAbort(signal, fn) {
  if (!signal) return () => {};
  if (signal.aborted) { fn(); return () => {}; }
  signal.addEventListener('abort', fn, { once: true });
  return () => signal.removeEventListener('abort', fn);
}

function connectTunnel(proxyUrl, host, port, signal) {
  const p = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const target = `${host.includes(':') ? `[${host}]` : host}:${port}`;
    const headers = { host: target };
    if (p.username || p.password) headers['proxy-authorization'] = `Basic ${Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64')}`;
    const mod = p.protocol === 'https:' ? https : http;
    const req = mod.request({ host: p.hostname.replace(/^\[|\]$/g, ''), port: Number(p.port || (p.protocol === 'https:' ? 443 : 80)), method: 'CONNECT', path: target, headers, agent: false });
    const off = onAbort(signal, () => req.destroy(new TransportError('ABORTED', 'request aborted')));
    req.on('connect', (res, socket, head) => {
      off();
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new TransportError(res.statusCode === 403 || res.statusCode === 407 ? 'PROXY_DENIED' : 'PROXY_REFUSED', `proxy refused CONNECT ${target}: ${res.statusCode} ${res.statusMessage ?? ''}`.trim(), { status: res.statusCode }));
        return;
      }
      if (head?.length) socket.unshift(head);
      resolve(socket);
    });
    req.on('error', error => { off(); reject(error instanceof TransportError ? error : new TransportError('PROXY_UNREACHABLE', `proxy ${p.hostname}:${p.port}: ${error.code ?? error.message}`, { cause: error })); });
    req.end();
  });
}

function connectDirect(host, port, signal) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    const off = onAbort(signal, () => s.destroy(new TransportError('ABORTED', 'request aborted')));
    s.once('connect', () => { off(); resolve(s); });
    s.once('error', error => { off(); reject(error instanceof TransportError ? error : new TransportError('CONNECT_FAILED', `${host}:${port}: ${error.code ?? error.message}`, { cause: error })); });
  });
}

function startTls(socket, servername, ca, signal) {
  return new Promise((resolve, reject) => {
    const opts = { socket, servername: net.isIP(servername) ? undefined : servername, ALPNProtocols: ['http/1.1'] };
    if (ca) opts.ca = ca;
    const t = tls.connect(opts);
    const off = onAbort(signal, () => t.destroy(new TransportError('ABORTED', 'request aborted')));
    t.once('secureConnect', () => { off(); resolve(t); });
    t.once('error', error => { off(); reject(error instanceof TransportError ? error : new TransportError('TLS_FAILED', `TLS to ${servername}: ${error.code ?? error.message}`, { cause: error })); });
  });
}

// -> { status, statusText, headers, body (IncomingMessage) }. `body` may be a Buffer, string or a
// Readable (then pass content-length in headers). `timeoutMs` bounds connect + response headers;
// `idleMs` bounds silence while the body streams.
export async function request(urlStr, { method = 'GET', headers = {}, body, signal, timeoutMs = 60_000, idleMs = 120_000, env = process.env, ca = defaultCa(env), proxy } = {}) {
  const url = new URL(urlStr);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TransportError('BAD_URL', `unsupported protocol ${url.protocol}`);
  const isHttps = url.protocol === 'https:';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || (isHttps ? 443 : 80));
  const proxyUrl = proxy === undefined ? proxyFor(url, env) : proxy;
  const deadline = AbortSignal.timeout(timeoutMs);
  const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const mapAbort = error => {
    if (signal?.aborted) return new TransportError('ABORTED', 'request aborted');
    if (deadline.aborted) return new TransportError('TIMEOUT', `no response from ${url.host} within ${timeoutMs} ms`);
    return error;
  };
  let socket;
  try {
    socket = proxyUrl ? await connectTunnel(proxyUrl, host, port, sig) : await connectDirect(host, port, sig);
    if (isHttps) socket = await startTls(socket, host, ca, sig);
  } catch (error) {
    socket?.destroy();
    // phase 'connect': nothing of the request was sent, so the caller may safely retry it
    const e = mapAbort(error);
    if (e && typeof e === 'object') e.phase = 'connect';
    throw e;
  }

  const payload = typeof body === 'string' ? Buffer.from(body) : body;
  const hdrs = { host: url.host, connection: 'close', ...headers };
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) hdrs['content-length'] = String(payload.length);
  else if (payload === undefined && !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(method)) hdrs['content-length'] = '0';

  return new Promise((resolve, reject) => {
    const sock = socket;
    // no `agent` option: with agent:false Node would build a fresh Agent and ignore createConnection
    const req = http.request({ method, path: url.pathname + url.search, headers: hdrs, createConnection: () => sock, setHost: false });
    const off = onAbort(sig, () => req.destroy(new TransportError('ABORTED', 'aborted')));
    req.on('response', res => {
      off();
      res.setTimeout(idleMs, () => res.destroy(new TransportError('IDLE_TIMEOUT', `response from ${url.host} stalled for ${idleMs} ms`)));
      if (signal) { const off2 = onAbort(signal, () => res.destroy(new TransportError('ABORTED', 'request aborted'))); res.once('close', off2); }
      resolve({ status: res.statusCode, statusText: res.statusMessage ?? '', headers: res.headers, rawHeaders: res.rawHeaders, body: res });
    });
    req.on('error', error => { off(); sock.destroy(); reject(mapAbort(error instanceof TransportError ? error : new TransportError('REQUEST_FAILED', `${method} ${url.host}: ${error.code ?? error.message}`, { cause: error }))); });
    if (payload === undefined) req.end();
    else if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) req.end(payload);
    else if (typeof payload.pipe === 'function') { payload.on('error', e => req.destroy(e)); payload.pipe(req); }
    else { req.destroy(); reject(new TransportError('BAD_BODY', 'body must be a string, Buffer, Uint8Array or Readable')); }
  });
}

export async function readAll(stream, limit = 64 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of stream) { size += c.length; if (size > limit) { stream.destroy(); throw new TransportError('TOO_LARGE', `response over ${limit} bytes`); } chunks.push(c); }
  return Buffer.concat(chunks);
}
