// Who may use a Foundry page: a one-time code goes in, a key for one browser tab comes out (security review 2026-10-21: H1, H2, M6,
// L12, L15). Shared by the onboarding site (./server.mjs) and the older dashboard (app/dashboard/server.mjs).
//
//   code   32 random bytes (base64url, 43 characters). It works once, within 60 seconds, and only with the Foundry start it was made
//          for. A code is what goes to the browser opener (so a command line that other accounts can list shows a code that is spent
//          within a second) and, only when stdin and stdout are a person's terminal, what is printed (app/cli.mjs).
//          The process that serves the page mints codes in memory. Another process (`open`, or `mcp --dashboard` while the page runs
//          elsewhere) mints one by writing the code's sha256 to <workspace>/site/codes/<sha256>.json (0600 in a 0700 folder) with the
//          id of the running start, read from <workspace>/.lock. Codes made for another start are refused; expired ones are swept.
//   key    what one tab gets for one code (POST /auth/open). The server keeps only its sha256, in memory; the page keeps the key in that
//          tab's sessionStorage. Nothing on disk or in a printed line lets a browser in, and every start of Foundry makes old keys useless.
//   reuse  a code presented a second time withdraws the key its first use got. A person who opened the link twice opens Foundry again;
//          a program that saw the link and raced the browser ends up with a dead key.
//
// What this does not change (stated on the Trust page): a program running as the same OS account can write a code file itself, as it
// can read or change everything else of the person's.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const CODE_TTL_MS = 60 * 1000;
const SPENT_KEEP_MS = 15 * 60 * 1000;
export const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const sha = s => createHash('sha256').update(s).digest('hex');
export const codesDir = workspace => path.join(workspace, 'site', 'codes');
const newCode = () => randomBytes(32).toString('base64url');

/** Mint a code for the Foundry start `instance` that another process serves. Returns the code (never written anywhere itself). */
export function mintCode(workspace, { instance, now = Date.now(), ttl = CODE_TTL_MS } = {}) {
  if (typeof instance !== 'string' || !instance) throw Object.assign(new Error('The running Foundry did not say which start it is'), { code: 'NO_INSTANCE' });
  const dir = codesDir(workspace);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const code = newCode();
  writeFileSync(path.join(dir, `${sha(code)}.json`), JSON.stringify({ instance, expiresAt: now + ttl }), { mode: 0o600, flag: 'wx' });
  return code;
}

/** The address that opens a page with a code: http://127.0.0.1:PORT/#/route?c=CODE (no & or %, so cmd.exe passes it whole). */
export function pageUrl(base, code, route = null) {
  const r = typeof route === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(route) ? route : '/';
  return `${String(base).replace(/[#?].*$/, '').replace(/\/?$/, '/')}#${r}?c=${code}`;
}

/** Take a code file once: it is renamed away first, so two takers cannot both have it. */
function takeFile(workspace, hash) {
  const file = path.join(codesDir(workspace), `${hash}.json`), mine = `${file}.taken-${process.pid}-${randomBytes(4).toString('hex')}`;
  try { renameSync(file, mine); } catch { return null; }
  try { return JSON.parse(readFileSync(mine, 'utf8')); } catch { return null; } finally { rmSync(mine, { force: true }); }
}

/**
 * The gate of one Foundry start. options: workspace (for codes minted by other processes), instance (this start's id), now (clock),
 * token (a key for in-process callers and tests; never printed or written), maxKeys.
 */
export function createGate({ workspace = null, instance = randomUUID(), now = () => Date.now(), token = null, maxKeys = 200 } = {}) {
  const keys = new Map(), codes = new Map(), spent = new Map();
  const addKey = key => { keys.set(sha(key), { at: now() }); while (keys.size > maxKeys) keys.delete(keys.keys().next().value); return key; };
  if (token) addKey(token);
  // Expired or unreadable code files are void: remove them. A code that is still within its minute stays, whichever start it names: two
  // Foundry processes can share a workspace (the site, and `start` or `mcp` with the older dashboard), and a code minted for the other one
  // must keep working (fix round 2026-10-21: a second gate used to delete it, so the person's link failed). A code for another start is
  // refused when it is presented here, and is removed by whichever gate finds it expired.
  if (workspace) {
    try {
      for (const f of readdirSync(codesDir(workspace))) {
        const file = path.join(codesDir(workspace), f);
        if (!/^[a-f0-9]{64}\.json$/.test(f)) { if (/\.taken-/.test(f)) continue; rmSync(file, { force: true }); continue; }
        let v = null; try { v = JSON.parse(readFileSync(file, 'utf8')); } catch { v = null; }
        if (!v || typeof v.instance !== 'string' || !(v.expiresAt >= now())) rmSync(file, { force: true });
      }
    } catch { /* no codes folder yet */ }
  }
  const prune = () => { for (const [h, s] of spent) if (now() - s.at > SPENT_KEEP_MS) spent.delete(h); };
  return {
    instance,
    token,
    /** A code for this start, kept in memory. */
    mint(ttl = CODE_TTL_MS) { const code = newCode(); codes.set(sha(code), { expiresAt: now() + ttl }); return code; },
    /** Trade a code for a tab's key: { ok, key } or { ok: false, status, code }. */
    open(code) {
      if (typeof code !== 'string' || !CODE_SHAPE.test(code)) return { ok: false, status: 400, code: 'CODE_SHAPE' };
      prune();
      const h = sha(code), was = spent.get(h);
      if (was) { if (was.key) keys.delete(was.key); spent.set(h, { ...was, key: null, reused: true }); return { ok: false, status: 409, code: 'CODE_USED' }; }
      let entry = codes.get(h) ?? null; codes.delete(h);
      if (!entry && workspace) { entry = takeFile(workspace, h); if (entry && entry.instance !== instance) entry = null; }
      if (!entry || !(entry.expiresAt >= now())) return { ok: false, status: 401, code: 'CODE_EXPIRED' };
      const key = addKey(randomBytes(32).toString('base64url'));
      spent.set(h, { key: sha(key), at: now() });
      return { ok: true, key };
    },
    /** Is this a key this start gave out (or the in-process token)? */
    check(given) { return typeof given === 'string' && given.length >= 20 && given.length <= 128 && keys.has(sha(given)); },
    get keys() { return keys.size; }
  };
}

/** The plain words for a refused code (the page shows them; no secret in them). */
export const CODE_WORDS = {
  CODE_SHAPE: { what: 'That link is not a Foundry link.', next: 'Open Foundry again with the command below.' },
  CODE_EXPIRED: { what: 'That link has expired. A link works once, within a minute.', next: 'Open Foundry again with the command below.' },
  CODE_USED: { what: 'That link was already used. If you did not open it twice, another program on this computer may have: Foundry has shut out whatever used it.', next: 'Open Foundry again with the command below.' }
};
