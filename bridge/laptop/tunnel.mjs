// Finds the public URL of the Cloudflare quick tunnel in front of the daemon, in this order:
//   1. --public-url / tunnel.publicUrl (operator-supplied; e.g. a named tunnel)
//   2. cloudflared's metrics server: GET <metrics>/quicktunnel -> {"hostname":"<random>.trycloudflare.com"}
//   3. cloudflared's log file: the last https://<random>.trycloudflare.com it printed
import fs from 'node:fs';
import http from 'node:http';

export const QUICK_TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g;

export function lastQuickTunnelUrl(text) {
  const all = String(text ?? '').match(QUICK_TUNNEL_RE);
  // cloudflared also logs api.trycloudflare.com (the quick-tunnel API); that is never the tunnel
  const hits = (all ?? []).filter(u => u !== 'https://api.trycloudflare.com');
  return hits.length ? hits[hits.length - 1] : null;
}

export function readLogTail(file, bytes = 256 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function getJson(url, timeoutMs = 3000) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: timeoutMs, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8').on('data', d => { if (body.length < 65536) body += d; });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

export async function discoverTunnelUrl({ publicUrl = null, metrics = null, log = null } = {}) {
  if (publicUrl) return { url: publicUrl.replace(/\/$/, ''), source: 'flag' };
  if (metrics) {
    const j = await getJson(`${metrics.replace(/\/$/, '')}/quicktunnel`);
    const host = j?.hostname;
    if (typeof host === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return { url: `https://${host}`, source: 'cloudflared-metrics' };
  }
  if (log) {
    const url = lastQuickTunnelUrl(readLogTail(log));
    if (url) return { url, source: 'cloudflared-log' };
  }
  return { url: null, source: null };
}
