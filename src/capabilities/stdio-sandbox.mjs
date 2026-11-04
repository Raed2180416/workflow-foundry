// The stdio MCP server sandbox and code pins, ARCHITECTURE.md §2.2 (review finding M3). A stdio server is third-party code: before it is
// spawned, every file the owner pinned for it (`source.integrity`: absolute path -> sha256, the command itself included) is re-hashed, and
// a mismatch refuses the spawn (SOURCE_INTEGRITY; the host quarantines the entry), so a package that updated in place with identical tool
// definitions is caught. The command is an absolute path: no PATH lookup. The server then runs in Linux namespaces built like
// src/sandbox.mjs (which is engine-hashed and runs code with stdin written once, so it is not reused directly):
//   - user, mount and pid namespaces, plus a network namespace with no interfaces up unless a member attests a non-local egress;
//   - a fresh tmpfs root holding read-only binds of the system directories (VISIBLE_PATHS), the pinned files and the owner's `sandbox.read`
//     paths, read-write binds of the owner's `sandbox.write` directories only, a private /tmp, the namespace's /proc and five /dev nodes
//     (no terminal device: the server cannot open /dev/tty or read the person's typing);
//   - pivot_root onto that root, the host root detached, the new root read-only, then one more user+mount namespace as an unmapped user with
//     no capabilities, so the kernel locks every inherited mount (a root inside the first namespace could otherwise remount a bind rw);
//   - its own session (setsid), a minimal environment (PATH and the entry's envAllow names only), cwd inside the sandbox.
// Linux only; without unshare(1) the spawn is refused (SANDBOX_UNAVAILABLE), never run unsandboxed.
import { createHash } from 'node:crypto';
import { existsSync, openSync, readSync, closeSync, fstatSync, realpathSync, statSync } from 'node:fs';
import { VISIBLE_PATHS } from '../sandbox.mjs';
import { fail } from './common.mjs';

const SAFE_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const PLAIN = /^\/[A-Za-z0-9._@+/-]{0,1023}$/;
const first = candidates => candidates.find(file => existsSync(file)) ?? null;

// sha256 of a file, cached per (real path, device, inode, size, mtime, ctime) for the life of the process (a node binary is ~120 MB). The
// ctime is in the key because anyone who can rewrite a file can also restore its size and mtime; nobody can set its ctime back.
const HASHES = new Map();
/** sha256 (hex) of the real file behind `file`, cached per process; what an owner pins in `source.integrity`. */
export const fileSha256 = file => fileHash(realpathSync(file));
function fileHash(file) {
  const fd = openSync(file, 'r');
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) fail('SOURCE_INTEGRITY', `${file} is not a regular file`, { files: [file] });
    const key = `${file}\u0000${info.dev}\u0000${info.ino}\u0000${info.size}\u0000${info.mtimeMs}\u0000${info.ctimeMs}`;
    if (HASHES.has(key)) return HASHES.get(key);
    const hash = createHash('sha256'), buffer = Buffer.alloc(1 << 20);
    for (let n; (n = readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, n));
    const hex = hash.digest('hex');
    HASHES.set(key, hex);
    return hex;
  } finally { closeSync(fd); }
}
/** Re-hash every pinned file of a stdio entry; refuse (SOURCE_INTEGRITY) on a missing or changed file. Returns the real paths. */
export function verifyIntegrity(entry) {
  const bad = [], real = [];
  for (const [file, expected] of Object.entries(entry.source.integrity ?? {})) {
    let path;
    try { path = realpathSync(file); } catch { bad.push(file); continue; }
    try { if (fileHash(path) !== expected) bad.push(file); else real.push(path); } catch (error) { if (error.code === 'SOURCE_INTEGRITY') throw error; bad.push(file); }
  }
  if (!Object.keys(entry.source.integrity ?? {}).length) fail('SOURCE_INTEGRITY', `Entry ${entry.id} pins no files; a stdio server is never spawned unpinned`, { files: [] });
  if (bad.length) fail('SOURCE_INTEGRITY', `Entry ${entry.id}: ${bad.length} pinned file(s) changed or are missing since the owner attested them; the server was not started`, { files: bad.slice(0, 20) });
  return real;
}

const SETUP = `set -eu
inner="$1"; shift
nro="$1"; shift; ro=""; i=0; while [ "$i" -lt "$nro" ]; do ro="$ro $1"; shift; i=$((i+1)); done
nrw="$1"; shift; rw=""; i=0; while [ "$i" -lt "$nrw" ]; do rw="$rw $1"; shift; i=$((i+1)); done
cwd="$1"; shift
mount -t tmpfs -o rw,nosuid,nodev,size=4m,nr_inodes=4096,mode=0755 foundry-stdio-root /mnt
cd /mnt
mkdir old proc dev tmp
mount -t tmpfs -o rw,nosuid,nodev,size=64m,nr_inodes=4096,mode=1777 foundry-stdio-tmp tmp
for p in ${VISIBLE_PATHS.join(' ')} $ro; do
  if [ -e ".$p" ] || [ -L ".$p" ]; then continue; fi
  if [ -L "$p" ]; then mkdir -p ".\${p%/*}"; ln -s "$(readlink "$p")" ".$p"
  elif [ -d "$p" ]; then mkdir -p ".$p"; mount --rbind "$p" ".$p"; mount -o remount,bind,ro,nosuid,nodev ".$p"
  elif [ -f "$p" ]; then mkdir -p ".\${p%/*}"; : > ".$p"; mount --bind "$p" ".$p"; mount -o remount,bind,ro,nosuid,nodev ".$p"
  fi
done
for p in $rw; do
  [ -d "$p" ] || { echo "foundry-stdio: writable path $p is not a directory" >&2; exit 95; }
  mkdir -p ".$p" 2>/dev/null || true
  mount --bind "$p" ".$p"; mount -o remount,bind,rw,nosuid,nodev ".$p"
done
mount --rbind /proc proc
mount -t tmpfs -o rw,nosuid,size=64k,nr_inodes=64,mode=0755 foundry-dev dev
for n in null zero full random urandom; do : > "dev/$n"; mount --bind "/dev/$n" "dev/$n"; done
ln -s /proc/self/fd dev/fd; ln -s fd/0 dev/stdin; ln -s fd/1 dev/stdout; ln -s fd/2 dev/stderr
mount -o remount,bind,ro dev
pivot_root . old
cd /
umount -n -l /old
rmdir /old
mount -n -o remount,bind,ro /
cd "$cwd"
exec unshare --user --mount /bin/sh -c "$inner" foundry-stdio "$@"`;
const INNER = `set -eu
caps=
while read -r key value; do if [ "$key" = CapEff: ]; then caps="$value"; fi; done < /proc/self/status
if [ "$caps" != 0000000000000000 ]; then echo "foundry-stdio: capabilities remain ($caps)" >&2; exit 98; fi
exec setsid -w "$@"`;

/** Whether the entry may reach the network: only when a member attests a first- or third-party egress. */
export const needsNetwork = entry => Object.values(entry.members ?? {}).some(m => m.egress && m.egress !== 'local');

/**
 * The spawn of one stdio entry: { command, args, cwd, env } for StdioClientTransport. `env` is the host env the envAllow names and
 * env-named write directories are read from. Verifies the integrity pins first.
 */
export function sandboxedSpawn(entry, { env = process.env, unshare = null } = {}) {
  if (process.platform !== 'linux') fail('SANDBOX_UNAVAILABLE', 'stdio MCP servers run only in the Linux namespace sandbox; refused, never run unsandboxed');
  const unshareBinary = unshare ?? first(['/usr/bin/unshare', '/bin/unshare', '/usr/sbin/unshare', '/sbin/unshare']);
  if (!unshareBinary) fail('SANDBOX_UNAVAILABLE', 'unshare(1) is not installed; a stdio server is never run unsandboxed');
  if (!PLAIN.test(entry.source.command)) fail('SANDBOX_PATH', `Entry ${entry.id}: the command must be an absolute plain path`);
  const pinned = verifyIntegrity(entry);
  const plain = (p, what) => { if (!PLAIN.test(p)) fail('SANDBOX_PATH', `Entry ${entry.id}: ${what} ${String(p).slice(0, 80)} is not an absolute plain path`); return p; };
  const read = [...new Set([...pinned.map(p => plain(p, 'pinned file')), plain(entry.source.command, 'command'), ...(entry.source.sandbox?.read ?? []).map(p => plain(p, 'read path'))])];
  const write = (entry.source.sandbox?.write ?? []).map(w => {
    const dir = typeof w === 'string' ? w : env[w.env];
    if (!dir) fail('SANDBOX_PATH', `Entry ${entry.id}: the writable directory named by ${w.env} is not set`);
    let real;
    try { real = realpathSync(dir); } catch { fail('SANDBOX_PATH', `Entry ${entry.id}: writable directory ${String(dir).slice(0, 80)} does not exist`); }
    if (!statSync(real).isDirectory()) fail('SANDBOX_PATH', `Entry ${entry.id}: ${real.slice(0, 80)} is not a directory`);
    return plain(real, 'writable directory');
  });
  const cwd = entry.source.cwd ? plain(entry.source.cwd, 'cwd') : '/tmp';
  const namespaces = ['--user', '--map-root-user', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc', ...(needsNetwork(entry) ? [] : ['--net'])];
  const childEnv = { PATH: SAFE_PATH };
  for (const name of entry.source.envAllow ?? []) if (env[name] !== undefined) childEnv[name] = env[name];
  // Credentials (envSecrets) are passed only after the host resolved them into the scrub set (mcp-client.mjs).
  for (const name of entry.source.envSecrets ?? []) if (env[name] !== undefined) childEnv[name] = env[name];
  return { command: unshareBinary, args: [...namespaces, '/bin/sh', '-c', SETUP, 'foundry-stdio', INNER, String(read.length), ...read, String(write.length), ...write, cwd, entry.source.command, ...entry.source.args],
    cwd: '/', env: childEnv, network: needsNetwork(entry) };
}
