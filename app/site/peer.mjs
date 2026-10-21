// Which OS account a loopback TCP client runs as, so a Foundry page answers only its own account (security review 2026-10-21: H2,
// L18; the identd idea, applied to 127.0.0.1). On Linux the kernel lists every IPv4 socket with its owner's uid in /proc/net/tcp; the
// client's socket is the row whose local address is 127.0.0.1:<client port> and whose remote address is 127.0.0.1:<our port>.
// Elsewhere (macOS, Windows), or when the row cannot be read, the answer is "unknown" and only the page key decides.
// Root (uid 0) is let in: it can read the workspace anyway, and port-forwarding helpers often run as root.
import { readFileSync } from 'node:fs';

const hexPort = n => n.toString(16).toUpperCase().padStart(4, '0');
const LOOPBACK = '0100007F'; // 127.0.0.1, as the kernel prints it (little-endian)

/** The uid that owns the client end of this socket, or null when it cannot be known. */
export function peerUid(socket, { table = null, platform = process.platform } = {}) {
  if (platform !== 'linux') return null;
  const client = socket?.remotePort, server = socket?.localPort;
  if (!client || !server || socket.remoteAddress !== '127.0.0.1') return null;
  let text = table;
  if (text === null) { try { text = readFileSync('/proc/net/tcp', 'utf8'); } catch { return null; } }
  const want = `${LOOPBACK}:${hexPort(client)}`, other = `${LOOPBACK}:${hexPort(server)}`;
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f[1] === want && f[2] === other) { const uid = Number(f[7]); return Number.isInteger(uid) ? uid : null; }
  }
  return null;
}

/** May a client of this uid use the page? Unknown (null) defers to the key. */
export function sameAccount(uid, me = typeof process.getuid === 'function' ? process.getuid() : null) {
  return uid === null || uid === undefined || me === null || uid === me || uid === 0;
}

/** Wire a node:http server: every connection learns its peer's uid once (one read of /proc/net/tcp per connection). */
export function watchPeers(server) {
  server.on('connection', socket => { socket.foundryPeerUid = peerUid(socket); });
  return server;
}
export const peerAllowed = req => sameAccount(req.socket?.foundryPeerUid ?? null);
