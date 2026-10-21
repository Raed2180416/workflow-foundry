// The page's key and port for one workspace, kept across starts (P1 and P2 walkthroughs, B2: a closed tab, a bookmark or a restart
// was a dead end, because every start made a new key on a random port).
//
//   <workspace>/site/session.json   { token, port, createdAt }   0600 in a 0700 folder: readable by this OS user only
//
// The same key on the same port means a bookmark of http://127.0.0.1:<port>/ keeps working: the page keeps the key in the browser's
// storage for that address (per port: another local port cannot read it). `node app/cli.mjs open` prints and opens the keyed link
// again; `node app/cli.mjs site --new-key` makes a new key (every open page then needs the new link). What the key does not change:
// a process running as this OS user can read this file, as it can read everything else of the person's (the same-user limit).
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const DEFAULT_PORT = 4178;
const fileOf = workspace => path.join(workspace, 'site', 'session.json');

export function readSession(workspace) {
  try { const s = JSON.parse(readFileSync(fileOf(workspace), 'utf8')); return /^[A-Za-z0-9_-]{32}$/.test(s?.token ?? '') ? s : null; } catch { return null; }
}
/** The workspace's session, made on first use; fresh: a new key. */
export function siteSession(workspace, { fresh = false } = {}) {
  const current = fresh ? null : readSession(workspace);
  const session = current ?? { token: randomBytes(24).toString('base64url'), port: readSession(workspace)?.port ?? null, createdAt: new Date().toISOString() };
  if (!current) save(workspace, session);
  return { ...session, remember(port) { if (session.port !== port) { session.port = port; save(workspace, session); } } };
}
function save(workspace, session) {
  const file = fileOf(workspace);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ token: session.token, port: session.port, createdAt: session.createdAt }, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}
/** The keyed link of a running page, or null. */
export const keyedUrl = (base, token, route = null) => `${base.replace(/\/?(#.*)?$/, '/')}#t=${token}${route ? `&r=${encodeURIComponent(route)}` : ''}`;
export const sessionExists = workspace => existsSync(fileOf(workspace));
