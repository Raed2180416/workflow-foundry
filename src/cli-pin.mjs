// The Claude Code CLI pinned by bytes, not by version string (compromise C2; research/engine-20261021/ENGINE-BUMP.md §4).
// A CLI auto-update between or inside runs changed the harness under paid experiments (incident I3: 2.1.300 -> 2.1.306 changed
// the tool list). A lock file (research/manifests/claude-cli.lock.json) names the version and, per platform, the sha256 and size
// from the publisher's release manifest; the binary lives at <cliRoot>/<sha256>/claude (scripts/fetch-cli.mjs puts it there).
//
// resolveCli({ lockFile }) -> {path, version, sha256, size, lockFile} | null
//   null when no lock is named (pinning is off: the caller uses its configured binary and records the version per call). With a
//   lock named it never falls back to PATH: an unacquired pin is CLI_UNPINNED, and a binary whose bytes differ is CLI_DRIFT.
//   The file is hashed once per process and re-hashed only when its identity (device, inode, size, mtime, ctime) changes.
// A lock is named by the caller or by FOUNDRY_CLI_LOCK (the owner's launcher for paid and sealed runs).
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FoundryError } from './data.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_LOCK = path.join(REPO_ROOT, 'research/manifests/claude-cli.lock.json');
export const DEFAULT_CLI_ROOT = path.join(REPO_ROOT, '.foundry/cli');
/** The release manifest's platform key for this host (linux-x64, darwin-arm64, ...). */
export const platformKey = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`;
const HEX64 = /^[0-9a-f]{64}$/;

/** The lock file, checked: {version, entry: this platform's {sha256, size} or null, file}. */
export function readCliLock(file = DEFAULT_LOCK, platform = platformKey()) {
  let lock;
  try { lock = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new FoundryError('CLI_LOCK_INVALID', `CLI lock ${file} cannot be read: ${error.code ?? error.message}`); }
  if (lock?.kind !== 'foundry.cli-lock/1' || typeof lock.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(lock.version) || !lock.platforms || typeof lock.platforms !== 'object')
    throw new FoundryError('CLI_LOCK_INVALID', `CLI lock ${file} is not a foundry.cli-lock/1 document with a version and platforms`);
  const raw = lock.platforms[platform] ?? null;
  if (raw && raw.sha256 != null && !HEX64.test(raw.sha256)) throw new FoundryError('CLI_LOCK_INVALID', `CLI lock ${file}: ${platform}.sha256 must be 64 lowercase hex characters or null`);
  if (raw && raw.size != null && !(Number.isSafeInteger(raw.size) && raw.size > 0)) throw new FoundryError('CLI_LOCK_INVALID', `CLI lock ${file}: ${platform}.size must be a positive integer or null`);
  return { version: lock.version, entry: raw?.sha256 ? { sha256: raw.sha256, size: raw.size ?? null } : null, file: path.resolve(file) };
}

// sha256 of a file by identity: absolute path -> {dev, ino, size, mtimeMs, ctimeMs, sha256}. Read in 4 MiB chunks (a 290 MB binary
// hashes in about 0.3 s and never sits in memory whole).
const hashes = new Map();
export function fileSha256(file) {
  const abs = path.resolve(file), s = statSync(abs), seen = hashes.get(abs);
  if (seen && seen.dev === s.dev && seen.ino === s.ino && seen.size === s.size && seen.mtimeMs === s.mtimeMs && seen.ctimeMs === s.ctimeMs) return seen.sha256;
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(4 * 1024 * 1024), fd = openSync(abs, 'r');
  try { for (let n; (n = readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, n)); } finally { closeSync(fd); }
  const sha256 = hash.digest('hex');
  hashes.set(abs, { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, sha256 });
  return sha256;
}

export function resolveCli({ lockFile = process.env.FOUNDRY_CLI_LOCK || null, cliRoot = process.env.FOUNDRY_CLI_ROOT || DEFAULT_CLI_ROOT, platform = platformKey() } = {}) {
  if (!lockFile) return null;
  const lock = readCliLock(lockFile, platform);
  if (!lock.entry) throw new FoundryError('CLI_UNPINNED', `CLI lock ${lock.file} has no sha256 for ${platform}: the pin is not acquired, and a pinned run never falls back to the CLI on PATH`);
  const file = path.join(path.resolve(cliRoot), lock.entry.sha256, 'claude');
  if (!existsSync(file)) throw new FoundryError('CLI_UNPINNED', `The pinned CLI ${lock.version} (${lock.entry.sha256.slice(0, 12)}) is not at ${file}: fetch it with node scripts/fetch-cli.mjs`, { path: file });
  const size = statSync(file).size, sha256 = fileSha256(file);
  if (sha256 !== lock.entry.sha256 || (lock.entry.size != null && size !== lock.entry.size))
    throw new FoundryError('CLI_DRIFT', `The CLI at ${file} is not the pinned ${lock.version}: sha256 ${sha256.slice(0, 12)}, ${size} bytes; the lock says ${lock.entry.sha256.slice(0, 12)}, ${lock.entry.size ?? '?'} bytes`, { path: file, sha256, expected: lock.entry.sha256 });
  return { path: file, version: lock.version, sha256, size, lockFile: lock.file };
}

/** The identity to record for a CLI binary: {version, sha256, pinned} (unpinned: the hash of the file a name resolves to on PATH). */
export function cliIdentityOf(binary, version, { pinned = false, pathEnv = process.env.PATH ?? '' } = {}) {
  let file = binary;
  if (!path.isAbsolute(file)) file = String(pathEnv).split(':').filter(d => path.isAbsolute(d)).map(d => path.join(d, binary)).find(p => { try { return statSync(p).isFile(); } catch { return false; } }) ?? null;
  let sha256 = null;
  try { sha256 = file ? fileSha256(file) : null; } catch { sha256 = null; }
  return { version: version ?? null, sha256, pinned: !!pinned };
}

/** Why resuming with `current` differs from the CLI a run was launched with (`prior`), or null. A launch without a recorded hash (an
 *  older run) accepts any CLI, and the change is the caller's to record. */
export function cliPinChange(prior, current) {
  if (!prior?.sha256) return null;
  if (!current?.sha256) return `the run was launched with CLI ${prior.version ?? '?'} (sha256 ${prior.sha256.slice(0, 12)}); its identity cannot be read now`;
  if (current.sha256 !== prior.sha256) return `the CLI changed since launch: ${prior.version ?? '?'} (${prior.sha256.slice(0, 12)}) -> ${current.version ?? '?'} (${current.sha256.slice(0, 12)})`;
  if (!!prior.pinned && !current.pinned) return `the run was launched with a pinned CLI; resume it with the same lock (FOUNDRY_CLI_LOCK)`;
  return null;
}
