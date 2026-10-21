#!/usr/bin/env node
// Put the pinned Claude Code CLI where src/cli-pin.mjs looks for it: <cliRoot>/<sha256>/claude, verified against the lock
// (research/manifests/claude-cli.lock.json; compromise C2, research/engine-20261021/ENGINE-BUMP.md §4). Never runs npm install and
// never runs anything it fetched. The raw binary comes from the release URL in the lock, or from a local file (--from) when an
// identical binary is already on the host; either way it is accepted only if its size and sha256 equal the lock's.
//
//   node scripts/fetch-cli.mjs [--lock FILE] [--cli-root DIR] [--from LOCAL_BINARY] [--gc-only] [--scan DIR ...]
//
// Disk: refuses below 1 GB free (a binary is about 290 MB). Garbage collection keeps at most 2 versions and never deletes the
// version the lock names or one referenced by an unfinished run (a launch.json under a --scan root, default /var/tmp/foundry-work,
// whose cli.sha256 names it and that has no summary.json beside it).
import { chmodSync, copyFileSync, createWriteStream, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CLI_ROOT, DEFAULT_LOCK, fileSha256, platformKey, readCliLock } from '../src/cli-pin.mjs';

export const MIN_FREE_BYTES = 1024 ** 3, KEEP_VERSIONS = 2, DEFAULT_SCAN = ['/var/tmp/foundry-work'];
const HEX64 = /^[0-9a-f]{64}$/;

export function freeBytes(dir) { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); }

/** Install the pinned binary. -> {path, sha256, size, source, already}. Throws when the disk guard, the lock or the bytes refuse it. */
export async function installCli({ lockFile = DEFAULT_LOCK, cliRoot = DEFAULT_CLI_ROOT, from = null, platform = platformKey(), minFreeBytes = MIN_FREE_BYTES, fetchImpl = globalThis.fetch } = {}) {
  const lock = readCliLock(lockFile, platform);
  if (!lock.entry) throw Object.assign(new Error(`${lockFile} has no sha256 for ${platform}: acquire the pin first`), { code: 'CLI_UNPINNED' });
  const { sha256, size } = lock.entry, dir = path.join(cliRoot, sha256), target = path.join(dir, 'claude');
  mkdirSync(cliRoot, { recursive: true });
  if (existsSync(target)) {
    if (fileSha256(target) !== sha256) throw Object.assign(new Error(`${target} exists with other bytes: remove it, then fetch again`), { code: 'CLI_DRIFT' });
    return { path: target, sha256, size: statSync(target).size, source: 'present', already: true };
  }
  const free = freeBytes(cliRoot);
  if (free < minFreeBytes + (size ?? 0)) throw Object.assign(new Error(`refusing to fetch: ${Math.floor(free / 1e6)} MB free, need ${Math.ceil((minFreeBytes + (size ?? 0)) / 1e6)} MB`), { code: 'DISK_GUARD' });
  const partial = path.join(cliRoot, `.partial-${randomUUID()}`);
  let source;
  try {
    if (from) {
      // A local copy: a hard link when it is on the same file system (no extra space), a copy otherwise.
      try { linkSync(from, partial); } catch { copyFileSync(from, partial); }
      source = `local:${path.resolve(from)}`;
    } else {
      const manifest = JSON.parse(readFileSync(lockFile, 'utf8')).sources?.manifest ?? {};
      const url = String(manifest.binaryUrlTemplate ?? '').replace('<platform>', platform);
      if (!/^https:\/\//.test(url)) throw Object.assign(new Error(`${lockFile} names no https binary URL`), { code: 'CLI_LOCK_INVALID' });
      const res = await fetchImpl(url);
      if (!res.ok || !res.body) throw Object.assign(new Error(`GET ${url}: HTTP ${res.status}`), { code: 'CLI_FETCH' });
      const hash = createHash('sha256'), out = createWriteStream(partial, { mode: 0o600 });
      let bytes = 0;
      for await (const chunk of res.body) {
        bytes += chunk.length; hash.update(chunk);
        if (size != null && bytes > size) throw Object.assign(new Error(`GET ${url}: more than the locked ${size} bytes`), { code: 'CLI_DRIFT' });
        if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
      }
      await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
      source = url;
    }
    const got = fileSha256(partial), bytes = statSync(partial).size;
    if (got !== sha256 || (size != null && bytes !== size)) throw Object.assign(new Error(`the fetched CLI is not the pinned ${lock.version}: sha256 ${got.slice(0, 12)}, ${bytes} bytes; the lock says ${sha256.slice(0, 12)}, ${size} bytes`), { code: 'CLI_DRIFT' });
    mkdirSync(dir, { recursive: true });
    chmodSync(partial, 0o755);
    renameSync(partial, target);
    return { path: target, sha256, size: bytes, source, already: false };
  } finally { rmSync(partial, { force: true }); }
}

/** CLI versions referenced by unfinished runs: launch.json files (depth <= 3 under each root) with cli.sha256 and no summary.json. */
export function referencedVersions(roots = DEFAULT_SCAN) {
  const out = new Set();
  const walk = (dir, depth) => {
    let names; try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (names.some(d => d.isFile() && d.name === 'launch.json') && !names.some(d => d.name === 'summary.json')) {
      try { const sha = JSON.parse(readFileSync(path.join(dir, 'launch.json'), 'utf8'))?.cli?.sha256; if (HEX64.test(sha ?? '')) out.add(sha); } catch {}
    }
    if (depth < 3) for (const d of names) if (d.isDirectory() && !d.isSymbolicLink()) walk(path.join(dir, d.name), depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return out;
}

/** Keep at most `keep` versions under cliRoot; never delete a protected one (the lock's, or one an unfinished run references).
 *  Oldest (by mtime) go first. -> {kept: [sha], removed: [sha], protected: [sha]} */
export function gcCli({ cliRoot = DEFAULT_CLI_ROOT, keep = KEEP_VERSIONS, protect = [], scan = DEFAULT_SCAN } = {}) {
  let entries = [];
  try { entries = readdirSync(cliRoot, { withFileTypes: true }).filter(d => d.isDirectory() && HEX64.test(d.name)).map(d => d.name); } catch { return { kept: [], removed: [], protected: [] }; }
  const guarded = new Set([...protect, ...referencedVersions(scan)]);
  const byAge = entries.map(sha => ({ sha, mtime: (() => { try { return statSync(path.join(cliRoot, sha)).mtimeMs; } catch { return 0; } })() })).sort((a, b) => b.mtime - a.mtime);
  const removed = [];
  let count = byAge.length;
  for (const { sha } of [...byAge].reverse()) {
    if (count <= keep) break;
    if (guarded.has(sha)) continue;
    rmSync(path.join(cliRoot, sha), { recursive: true, force: true }); removed.push(sha); count--;
  }
  return { kept: byAge.map(e => e.sha).filter(sha => !removed.includes(sha)), removed, protected: [...guarded].filter(sha => entries.includes(sha)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const lockFile = opt('--lock') ?? DEFAULT_LOCK, cliRoot = opt('--cli-root') ?? DEFAULT_CLI_ROOT;
  const scan = argv.flatMap((a, i) => (a === '--scan' ? [argv[i + 1]] : []));
  try {
    const installed = argv.includes('--gc-only') ? null : await installCli({ lockFile, cliRoot, from: opt('--from') });
    const lock = readCliLock(lockFile);
    const gc = gcCli({ cliRoot, protect: lock.entry ? [lock.entry.sha256] : [], scan: scan.length ? scan : DEFAULT_SCAN });
    console.log(JSON.stringify({ installed, gc }, null, 1));
  } catch (error) { console.error(JSON.stringify({ error: { code: error.code ?? 'ERROR', message: error.message } })); process.exit(1); }
}
