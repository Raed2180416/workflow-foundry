// Mailbox: an orphan branch (default `foundry-bridge`) of the private repository that carries
// bridge-state/ only:
//   bridge-state/README.md       what this branch is; it never merges
//   bridge-state/keys/*.pub      trusted cloud public keys (PEM SPKI); delete a file to revoke it
//   bridge-state/endpoint.json   the laptop's current tunnel URL and heartbeat
//   bridge-state/KILL            present = the daemon refuses all signed requests and stops all work
// Both sides use a dedicated clone (default ~/.foundry-bridge/mailbox), never the main checkout.
// Every write is fetch -> reset to the remote tip -> re-apply -> commit -> push, retried with backoff
// on a non-fast-forward. That is a rebase of one regenerated commit; it works in shallow clones where
// `pull --rebase` can fail, and it never force-pushes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { keyId, toPublicKey } from './common/protocol.mjs';

export const DEFAULT_BRANCH = 'foundry-bridge';
export const STATE_DIR = 'bridge-state';
export const ENDPOINT_FILE = `${STATE_DIR}/endpoint.json`;
export const KEYS_DIR = `${STATE_DIR}/keys`;
export const KILL_FILE = `${STATE_DIR}/KILL`;
export const README_FILE = `${STATE_DIR}/README.md`;
export const ENDPOINT_SCHEMA = 'foundry-bridge/endpoint@1';
export const DEFAULT_MAILBOX_DIR = path.join(os.homedir(), '.foundry-bridge', 'mailbox');
export const DEFAULT_COMMIT_ARGS = Object.freeze(['-c', 'user.name=foundry-bridge', '-c', 'user.email=foundry-bridge@localhost']);
export const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export function redact(text) {
  return String(text ?? '').replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1<redacted>@');
}

export class GitError extends Error {
  constructor(args, code, stderr) {
    super(`git ${args.filter(a => !/^-c$/.test(a)).slice(0, 4).join(' ')} failed (exit ${code}): ${redact(stderr).trim().slice(0, 600)}`);
    this.code = 'GIT_FAILED'; this.exitCode = code; this.stderr = redact(stderr);
  }
}

export function runGit(args, { cwd, env = process.env, git = 'git', timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(git, args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', d => { if (stdout.length < 4e6) stdout += d; });
    child.stderr.setEncoding('utf8').on('data', d => { if (stderr.length < 1e6) stderr += d; });
    const timer = setTimeout(() => { stderr += `\n[timeout after ${timeoutMs} ms]`; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(Object.assign(new GitError(args, -1, error.message), { cause: error })); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function git(args, opts) {
  const r = await runGit(args, opts);
  if (r.code !== 0) throw new GitError(args, r.code, r.stderr);
  return r.stdout;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isNonFastForward = stderr => /non-fast-forward|fetch first|\[rejected\]|stale info|failed to update ref|cannot lock ref/i.test(stderr);

// ---- keys ----------------------------------------------------------------------------------------

// Reads every *.pub (PEM SPKI Ed25519, <= 4 KiB) in `dir`. Bad files are reported, never fatal.
export function readKeyDir(dir) {
  const keys = new Map(); const errors = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (error) { return { keys: [], errors: error.code === 'ENOENT' ? [] : [`${dir}: ${error.code}`] }; }
  for (const name of names.sort()) {
    if (!name.endsWith('.pub') || name.startsWith('.')) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile()) { errors.push(`${name}: not a regular file`); continue; }
      if (st.size > 4096) { errors.push(`${name}: larger than 4 KiB`); continue; }
      const publicKey = toPublicKey(fs.readFileSync(file, 'utf8'));
      const id = keyId(publicKey);
      if (!keys.has(id)) keys.set(id, { id, file: name, publicKey });
    } catch (error) { errors.push(`${name}: ${error.message}`); }
  }
  return { keys: [...keys.values()], errors };
}

export function keyFileName(label, id) {
  if (!LABEL_RE.test(label)) throw new TypeError(`key label must match ${LABEL_RE}`);
  return `${label}-${id}.pub`;
}

// ---- endpoint.json -------------------------------------------------------------------------------

export function buildEndpoint({ url, daemonVersion, startedAt, heartbeatAt, gpu = null, services = [], tunnelSource = null, state = 'up' }) {
  return {
    schema: ENDPOINT_SCHEMA, state, url: url ?? null, tunnelSource, daemonVersion,
    startedAt, heartbeatAt,
    gpu: gpu ? { name: gpu.name ?? null, memoryTotalMiB: gpu.memoryTotalMiB ?? null, driver: gpu.driver ?? null, cuda: gpu.cuda ?? null } : null,
    services: services.map(s => ({ id: s.id, kind: s.kind, name: s.name ?? null, state: s.state }))
  };
}

const ENDPOINT_URL_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]{1,5})?\/?$/;
const LOCAL_URL_RE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}\/?$/;

export function validEndpointUrl(url, { allowHttpLocal = false } = {}) {
  return typeof url === 'string' && (ENDPOINT_URL_RE.test(url) || (allowHttpLocal && LOCAL_URL_RE.test(url)));
}

// -> { ok, url, state, ageMs, stale, errors, endpoint }. `stale` when the heartbeat is older than
// staleAfterMs (default 40 min: two missed 15-minute heartbeats plus slack).
export function parseEndpoint(input, { now = Date.now(), staleAfterMs = 40 * 60_000, allowHttpLocal = false } = {}) {
  const errors = [];
  let ep = input;
  if (typeof input === 'string') { try { ep = JSON.parse(input); } catch { return { ok: false, url: null, errors: ['endpoint.json is not JSON'] }; } }
  if (!ep || typeof ep !== 'object' || Array.isArray(ep)) return { ok: false, url: null, errors: ['endpoint.json is not an object'] };
  if (ep.schema !== ENDPOINT_SCHEMA) errors.push(`schema is ${JSON.stringify(ep.schema)}, expected ${ENDPOINT_SCHEMA}`);
  const url = ep.url ?? null;
  if (url !== null && !validEndpointUrl(url, { allowHttpLocal })) errors.push('url is not an https origin');
  if (url === null) errors.push(ep.state === 'stopped' ? 'daemon reported it stopped' : 'no tunnel URL published yet');
  const hb = Date.parse(ep.heartbeatAt ?? '');
  if (!Number.isFinite(hb)) errors.push('heartbeatAt missing or invalid');
  const ageMs = Number.isFinite(hb) ? now - hb : null;
  const stale = ageMs === null || ageMs > staleAfterMs;
  return { ok: errors.length === 0, url: url && errors.length === 0 ? url.replace(/\/$/, '') : null, state: ep.state ?? null, ageMs, stale, errors, endpoint: ep };
}

export const MAILBOX_README = `# foundry-bridge mailbox

This orphan branch is the rendezvous point between the Workflow Foundry cloud session and the
owner's laptop GPU bridge (see \`bridge/PROTOCOL.md\` on the main branches). **It never merges** into
any other branch and contains nothing but \`bridge-state/\`.

| Path | Written by | Meaning |
|---|---|---|
| \`bridge-state/keys/<label>-<keyid>.pub\` | cloud (or the owner) | Ed25519 public keys (PEM SPKI) the laptop daemon trusts. Delete a file to revoke that key; the daemon re-reads keys on every refresh (default every 5 minutes). |
| \`bridge-state/endpoint.json\` | laptop daemon | Current Cloudflare quick-tunnel URL, daemon version, heartbeat time, GPU summary, running services. No secrets, no paths. |
| \`bridge-state/KILL\` | anyone with write access | Kill switch. While this file exists the daemon stops every job and service and refuses all signed requests. Delete it to re-enable. |

The trust root is write access to this private repository: whoever can push here can add a key.
Never put private keys, tokens or datasets on this branch. Commits are append-only (never force-push).
`;

// ---- Mailbox -------------------------------------------------------------------------------------

export class Mailbox {
  constructor({ dir = DEFAULT_MAILBOX_DIR, remote, branch = DEFAULT_BRANCH, git: gitBin = 'git', env = process.env, depth = 1, commitArgs = DEFAULT_COMMIT_ARGS, timeoutMs = 120_000 } = {}) {
    if (!remote || typeof remote !== 'string') throw new TypeError('Mailbox needs a remote URL or path');
    if (!BRANCH_RE.test(branch) || branch.includes('..')) throw new TypeError(`invalid mailbox branch ${branch}`);
    Object.assign(this, { dir: path.resolve(dir), remote, branch, gitBin, env, depth, commitArgs: [...commitArgs], timeoutMs });
  }
  #opts(extra = {}) { return { cwd: this.dir, env: this.env, git: this.gitBin, timeoutMs: this.timeoutMs, ...extra }; }
  #depthArgs() { return this.depth ? ['--depth', String(this.depth)] : []; }

  static async remoteBranchExists(remote, branch, { env = process.env, git: gitBin = 'git', timeoutMs = 60_000 } = {}) {
    const out = await git(['ls-remote', '--heads', remote, `refs/heads/${branch}`], { env, git: gitBin, timeoutMs, cwd: os.tmpdir() });
    return out.trim().length > 0;
  }

  get cloned() { return fs.existsSync(path.join(this.dir, '.git')); }

  async ensure() {
    if (this.cloned) {
      const url = (await git(['remote', 'get-url', 'origin'], this.#opts())).trim();
      if (url !== this.remote) throw Object.assign(new Error(`mailbox clone at ${this.dir} points at a different remote; move it aside or pass that remote`), { code: 'MAILBOX_REMOTE_MISMATCH' });
      return;
    }
    await fsp.mkdir(path.dirname(this.dir), { recursive: true });
    const r = await runGit(['clone', '--quiet', '--no-tags', '--single-branch', '--branch', this.branch, ...this.#depthArgs(), this.remote, this.dir], this.#opts({ cwd: path.dirname(this.dir) }));
    if (r.code !== 0) {
      if (/Remote branch .* not found|couldn't find remote ref/i.test(r.stderr)) throw Object.assign(new Error(`mailbox branch ${this.branch} does not exist on the remote yet (run bridge/cloud/init-mailbox.mjs)`), { code: 'MAILBOX_MISSING' });
      throw new GitError(['clone'], r.code, r.stderr);
    }
  }

  // Fetch the remote tip and make the clone match it exactly (it is a dedicated clone: nothing local to keep).
  async refresh() {
    await this.ensure();
    const r = await runGit(['fetch', '--quiet', '--no-tags', ...this.#depthArgs(), 'origin', `+refs/heads/${this.branch}:refs/remotes/origin/${this.branch}`], this.#opts());
    if (r.code !== 0) {
      if (/couldn't find remote ref/i.test(r.stderr)) throw Object.assign(new Error(`mailbox branch ${this.branch} disappeared from the remote`), { code: 'MAILBOX_MISSING' });
      throw new GitError(['fetch'], r.code, r.stderr);
    }
    await git(['checkout', '--quiet', '-B', this.branch, `refs/remotes/origin/${this.branch}`], this.#opts());
    await git(['reset', '--quiet', '--hard', `refs/remotes/origin/${this.branch}`], this.#opts());
    await git(['clean', '-fdxq'], this.#opts());
    return this.head();
  }

  async head() { return (await git(['rev-parse', 'HEAD'], this.#opts())).trim(); }

  readKeys() { return readKeyDir(path.join(this.dir, KEYS_DIR)); }
  isKilled() { return fs.existsSync(path.join(this.dir, KILL_FILE)); }
  readEndpointRaw() {
    try { return fs.readFileSync(path.join(this.dir, ENDPOINT_FILE), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  // mutator(dir) -> truthy when it changed something. Retries non-fast-forward pushes with backoff.
  async update(mutator, { message = 'bridge-state update', retries = 6, baseDelayMs = 1000, maxDelayMs = 60_000 } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      await this.refresh();
      const changed = await mutator(this.dir);
      if (!changed) return { pushed: false, head: await this.head(), attempts: attempt };
      await git(['add', '-A', '--', STATE_DIR], this.#opts());
      const diff = await runGit(['diff', '--cached', '--quiet'], this.#opts());
      if (diff.code === 0) return { pushed: false, head: await this.head(), attempts: attempt };
      await git([...this.commitArgs, 'commit', '--quiet', '--no-verify', '-m', message], this.#opts());
      const push = await runGit(['push', '--quiet', '--no-verify', 'origin', `HEAD:refs/heads/${this.branch}`], this.#opts());
      if (push.code === 0) return { pushed: true, head: await this.head(), attempts: attempt };
      lastError = new GitError(['push'], push.code, push.stderr);
      if (!isNonFastForward(push.stderr)) throw lastError;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) * (0.5 + Math.random() / 2);
      await sleep(delay);
    }
    throw lastError;
  }

  async publishEndpoint(endpoint, opts = {}) {
    const body = JSON.stringify(endpoint, null, 2) + '\n';
    return this.update(dir => {
      const file = path.join(dir, ENDPOINT_FILE);
      const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (prev === body) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      return true;
    }, { message: `endpoint: ${endpoint.state} ${endpoint.heartbeatAt}`, ...opts });
  }

  async addKey({ label, pem }, opts = {}) {
    const id = keyId(toPublicKey(pem));
    const name = keyFileName(label, id);
    return { id, file: name, ...(await this.update(dir => {
      const existing = readKeyDir(path.join(dir, KEYS_DIR)).keys;
      if (existing.some(k => k.id === id)) return false;
      fs.mkdirSync(path.join(dir, KEYS_DIR), { recursive: true });
      fs.writeFileSync(path.join(dir, KEYS_DIR, name), toPublicKey(pem).export({ type: 'spki', format: 'pem' }));
      return true;
    }, { message: `keys: add ${name}`, ...opts })) };
  }

  async revokeKey(id, opts = {}) {
    return this.update(dir => {
      const { keys } = readKeyDir(path.join(dir, KEYS_DIR));
      const hits = keys.filter(k => k.id === id);
      for (const k of hits) fs.rmSync(path.join(dir, KEYS_DIR, k.file));
      return hits.length > 0;
    }, { message: `keys: revoke ${id}`, ...opts });
  }

  async setKill(on, opts = {}) {
    return this.update(dir => {
      const file = path.join(dir, KILL_FILE);
      if (on === fs.existsSync(file)) return false;
      if (on) fs.writeFileSync(file, `kill switch set ${new Date().toISOString()}\n`); else fs.rmSync(file);
      return true;
    }, { message: on ? 'KILL: stop all bridge work' : 'KILL: removed', ...opts });
  }
}

// Creates the orphan mailbox branch (README + keys) if it does not exist, else adds missing keys.
// Uses a throwaway directory under `scratch`; never touches any other checkout.
export async function initMailbox({ remote, branch = DEFAULT_BRANCH, keys = [], scratch = os.tmpdir(), env = process.env, git: gitBin = 'git', commitArgs = DEFAULT_COMMIT_ARGS, mailboxDir, dryRun = false } = {}) {
  const exists = await Mailbox.remoteBranchExists(remote, branch, { env, git: gitBin });
  const keyEntries = keys.map(({ label, pem }) => ({ label, pem: toPublicKey(pem).export({ type: 'spki', format: 'pem' }), id: keyId(toPublicKey(pem)) }));
  if (dryRun) return { exists, branch, keys: keyEntries.map(k => ({ id: k.id, file: keyFileName(k.label, k.id) })), pushed: false };
  const writeAll = dir => {
    let changed = false;
    const readme = path.join(dir, README_FILE);
    fs.mkdirSync(path.join(dir, KEYS_DIR), { recursive: true });
    if (!fs.existsSync(readme) || fs.readFileSync(readme, 'utf8') !== MAILBOX_README) { fs.writeFileSync(readme, MAILBOX_README); changed = true; }
    const have = new Set(readKeyDir(path.join(dir, KEYS_DIR)).keys.map(k => k.id));
    for (const k of keyEntries) {
      if (have.has(k.id)) continue;
      fs.writeFileSync(path.join(dir, KEYS_DIR, keyFileName(k.label, k.id)), k.pem); changed = true; have.add(k.id);
    }
    return changed;
  };
  if (exists) {
    const mb = new Mailbox({ dir: mailboxDir ?? fs.mkdtempSync(path.join(scratch, 'mailbox-init-')), remote, branch, env, git: gitBin, commitArgs });
    try {
      const r = await mb.update(writeAll, { message: 'mailbox: README and keys' });
      return { created: false, branch, keys: keyEntries.map(k => k.id), ...r };
    } finally { if (!mailboxDir) fs.rmSync(mb.dir, { recursive: true, force: true }); }
  }
  const dir = fs.mkdtempSync(path.join(scratch, 'mailbox-orphan-'));
  const opts = { cwd: dir, env, git: gitBin };
  try {
    await git(['init', '--quiet'], opts);
    await git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], opts);
    writeAll(dir);
    await git(['add', '-A', '--', STATE_DIR], opts);
    await git([...commitArgs, 'commit', '--quiet', '--no-verify', '-m', 'foundry-bridge mailbox: orphan branch (never merges)'], opts);
    await git(['remote', 'add', 'origin', remote], opts);
    const push = await runGit(['push', '--quiet', '--no-verify', 'origin', `HEAD:refs/heads/${branch}`], opts);
    if (push.code !== 0) {
      if (isNonFastForward(push.stderr)) return initMailbox({ remote, branch, keys, scratch, env, git: gitBin, commitArgs, mailboxDir });   // created concurrently
      throw new GitError(['push'], push.code, push.stderr);
    }
    return { created: true, branch, keys: keyEntries.map(k => k.id), pushed: true, head: (await git(['rev-parse', 'HEAD'], opts)).trim() };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
