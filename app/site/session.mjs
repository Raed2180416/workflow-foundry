// The page's home port for one workspace, kept across starts (P1 and P2 walkthroughs, B2), and nothing secret.
//
//   <workspace>/site/session.json   { port, createdAt }   0600 in a 0700 folder
//
// Until the security review of 2026-10-21 this file also held the page key, reused on every start, and the page kept that key in
// localStorage, so a bookmark opened Foundry by itself. That let another local account that bound the port while Foundry was down take
// the key from the browser (H2), and the key reached coding agents through printed links (H1). Now every start makes new keys, a tab
// gets its key only by trading a one-time code (./gate.mjs), and the key stays in that tab. A bookmark of http://127.0.0.1:<port>/ opens
// the page that says the one command that lets the browser in again (`node app/cli.mjs open`).
//
// The home port is the one a bookmark names. When another program holds it, Foundry starts on a free port for this start only, says so
// (whatever answers on the home port is then not Foundry), and does not move its home.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_PORT = 4178;
const fileOf = workspace => path.join(workspace, 'site', 'session.json');

export function readSession(workspace) {
  try { const s = JSON.parse(readFileSync(fileOf(workspace), 'utf8')); return Number.isInteger(s?.port) && s.port > 0 && s.port < 65536 ? { port: s.port, createdAt: s.createdAt ?? null } : { port: null, createdAt: s?.createdAt ?? null }; } catch { return null; }
}
/** The workspace's home port (null until the first start), and remember(port) to make a port the home. Older files' keys are dropped. */
export function siteSession(workspace) {
  const current = readSession(workspace);
  const session = { port: current?.port ?? null, createdAt: current?.createdAt ?? new Date().toISOString() };
  // A file from before the review may still hold a key: rewrite it without one.
  try { if (existsSync(fileOf(workspace)) && 'token' in JSON.parse(readFileSync(fileOf(workspace), 'utf8'))) save(workspace, session); } catch { save(workspace, session); }
  return { ...session, remember(port) { if (session.port !== port) { session.port = port; save(workspace, session); } } };
}
function save(workspace, session) {
  const file = fileOf(workspace);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ port: session.port, createdAt: session.createdAt }, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}
export const sessionExists = workspace => existsSync(fileOf(workspace));
