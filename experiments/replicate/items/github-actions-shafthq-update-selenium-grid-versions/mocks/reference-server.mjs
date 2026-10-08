// Deterministic local mock of raw.githubusercontent.com for ONE recorded response: the reference compose file of the
// docker-selenium project. Plain node:http on 127.0.0.1, random port, one route. It records every request it sees (method, path and
// the original URL that the curl shim stamped into a header), so the oracle can check which calls were made.
//   response = { status, body, headers? }      replies with that recording
//   response = { error: 'reset' }              closes the connection without a reply (curl exit 52)
import http from 'node:http';
import { REFERENCE_PATH } from '../spec.mjs';

export async function startReferenceServer({ response, path = REFERENCE_PATH }) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const entry = { method: req.method, path: req.url, originalUrl: req.headers['x-rbench-original-url'] ?? null, status: null };
    requests.push(entry);
    if (req.url !== path) {
      entry.status = 404;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('rbench mock: no recording for this path');
      return;
    }
    if (response.error) { entry.error = response.error; req.socket.destroy(); return; }
    entry.status = response.status;
    res.writeHead(response.status, { 'content-type': 'text/plain; charset=utf-8', ...(response.headers ?? {}) });
    res.end(response.body ?? '');
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    port: server.address().port,
    requests,
    close: () => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}
