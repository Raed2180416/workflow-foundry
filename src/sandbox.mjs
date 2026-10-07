import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { checkData, FoundryError } from './data.mjs';

// DESIGN §1.2. Code runs in fresh user+net+mount+pid namespaces: every inherited mount is
// remounted read-only, the environment holds PATH only, and source plus input arrive on stdin.
// Nothing ever falls back to an unsandboxed run. The root is an allowlist, not a mask: setup
// pivots onto a fresh tmpfs holding read-only binds of VISIBLE_PATHS and of the interpreter
// binary alone, the pid namespace's /proc, five /dev nodes and a private /tmp, then detaches the
// host root and makes the new root read-only. Any other host path (uploads, corpus, /opt, /sys…)
// does not exist inside; MASKED_PATHS exist only as empty read-only directories.
// The setup namespace root could undo its own mounts, so the interpreter starts one user+mount
// namespace deeper, as an unmapped user with no capabilities: the kernel then locks every
// mount it inherits (no unmounting a mask, no clearing read-only), even from namespaces it creates.
export const VISIBLE_PATHS = Object.freeze(['/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32', '/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/localtime']);
export const MASKED_PATHS = Object.freeze(['/home', '/root', '/opt', '/mnt', '/srv', '/media', '/tmp', '/var', '/run']);
export const MAX_OUTPUT_BYTES = 512 * 1024;
// Per-process limits set inside the namespace before the interpreter starts (prlimit, soft = hard).
// Python: 1 GiB address space, at most 8 tasks (threads + forks). JS: V8 reserves more address
// space than any useful RLIMIT_AS, so RLIMIT_DATA caps committed private memory (heap, Buffers,
// wasm) at 1.25 GiB: ~0.6 GiB V8/thread baseline plus the 512 MiB heap; --permission already
// forbids child processes and workers, so NPROC only bounds V8/libuv threads (about 11).
// RLIMIT_NPROC is never enforced for host root (kuid 0), so a root host runs the sandbox as nobody.
// Inside an outer user namespace that maps only root (an executor sandbox started with
// --map-root-user), uid 65534 does not exist and setuid would fail with EINVAL; there the code keeps
// the mapped root and NPROC is not enforced, while the memory, file-size and core limits still are.
// That outer sandbox already gives its occupant (a builder agent) a shell, so NPROC adds nothing there.
const MiB = 1024 * 1024, SANDBOX_ID = 65534;
// True when `id` is mapped in this process's user namespace (/proc/self/{uid,gid}_map: inside outside count).
export function idMapped(file, id) {
  try {
    return readFileSync(`/proc/self/${file}`, 'utf8').trim().split('\n').some(line => {
      const [inside, , count] = line.trim().split(/\s+/).map(Number);
      return Number.isFinite(inside) && Number.isFinite(count) && id >= inside && id < inside + count;
    });
  } catch { return false; }
}
export const LIMITS = Object.freeze({
  js: Object.freeze({ nproc: 32, data: 1280 * MiB, fsize: 16 * MiB, core: 0 }),
  python: Object.freeze({ nproc: 8, as: 1024 * MiB, fsize: 16 * MiB, core: 0 })
});
const SAFE_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const RESULT = 'FOUNDRY_RESULT:', READY = 'FOUNDRY_SANDBOX_READY\n';
const STDERR_KEEP = 64 * 1024;
const first = candidates => candidates.find(file => existsSync(file));

// Mount points with escaped names cannot be addressed reliably from sh, so they make the
// sandbox unavailable instead of staying writable. The host /tmp (never visible inside) is the
// staging mount point for the new root; $2 is the interpreter binary, bound at its own path.
const SETUP = `set -eu
inner="$1"; shift
for mp in $(awk '{print $5}' /proc/self/mountinfo); do
  case "$mp" in *\\\\*) echo "foundry-sandbox: unsupported mount point name" >&2; exit 97;; esac
  if mountpoint -q "$mp"; then mount -o remount,bind,ro "$mp"; fi
done
mount -t tmpfs -o rw,nosuid,nodev,size=1m,nr_inodes=1024,mode=0755 foundry-root /tmp
cd /tmp
mkdir old proc dev etc
for d in ${MASKED_PATHS.join(' ')}; do mkdir -p ".$d"; done
for p in ${VISIBLE_PATHS.join(' ')} "$2"; do
  if [ -e ".$p" ] || [ -L ".$p" ]; then continue; fi
  if [ -L "$p" ]; then ln -s "$(readlink "$p")" ".$p"
  elif [ -d "$p" ]; then mkdir -p ".$p"; mount --rbind "$p" ".$p"; mount -o remount,bind,ro ".$p"
  elif [ -f "$p" ]; then mkdir -p ".\${p%/*}"; : > ".$p"; mount --bind "$p" ".$p"; mount -o remount,bind,ro ".$p"
  fi
done
[ -e ".$2" ] || { echo "foundry-sandbox: interpreter $2 is not reachable" >&2; exit 96; }
mount --rbind /proc proc
mount -t tmpfs -o rw,nosuid,size=64k,nr_inodes=64,mode=0755 foundry-dev dev
for n in null zero full random urandom; do : > "dev/$n"; mount --bind "/dev/$n" "dev/$n"; done
ln -s /proc/self/fd dev/fd; ln -s fd/0 dev/stdin; ln -s fd/1 dev/stdout; ln -s fd/2 dev/stderr
mount -o remount,bind,ro dev
pivot_root . old
cd /
umount -n -l /old
rmdir /old
mount -n -t tmpfs -o rw,nosuid,nodev,size=16m,nr_inodes=1024,mode=1777 foundry-tmp /tmp
mount -n -o remount,bind,ro /
cd /tmp
exec unshare --user --mount /bin/sh -c "$inner" foundry-sandbox "$@"`;
const INNER = `set -eu
limits="$1"; shift
caps=
while read -r key value; do if [ "$key" = CapEff: ]; then caps="$value"; fi; done < /proc/self/status
if [ "$caps" != 0000000000000000 ]; then echo "foundry-sandbox: capabilities remain ($caps)" >&2; exit 98; fi
prlimit --pid $$ $limits
printf '${READY.trim()}\\n' >&2
exec env -i PATH=${SAFE_PATH} "$@"`;

const JS_RUNNER = `import { inspect } from 'node:util';
const emit = process.stdout.write.bind(process.stdout);
const toStderr = (...a) => { process.stderr.write(a.map(x => typeof x === 'string' ? x : inspect(x)).join(' ') + '\\n'); };
for (const k of ['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir', 'table']) console[k] = toStderr;
process.stdout.write = process.stderr.write.bind(process.stderr);
const chunks = []; for await (const c of process.stdin) chunks.push(c);
const { source, input } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\\n//# sourceURL=foundry-code.mjs').toString('base64'));
const main = typeof mod.default === 'function' ? mod.default : mod.main;
if (typeof main !== 'function') throw new TypeError('The module must export default function main(input)');
const value = await main(input);
let text;
try { text = JSON.stringify(value); } catch (error) { process.stderr.write('Result is not JSON: ' + error.message + '\\n'); process.exit(3); }
if (text === undefined) { process.stderr.write('main(input) returned no JSON value\\n'); process.exit(3); }
emit('\\n${RESULT}' + text + '\\n', () => process.exit(0));`;

const PY_RUNNER = `import sys, json
emit = sys.stdout.buffer
sys.stdout = sys.stderr
payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
scope = {'__name__': '__foundry_code__', '__builtins__': __builtins__}
exec(compile(payload['source'], 'foundry-code.py', 'exec'), scope)
main = scope.get('main')
if not callable(main):
    raise TypeError('The module must define main(input)')
value = main(payload['input'])
if hasattr(value, '__await__'):
    import asyncio
    async def wait(v):
        return await v
    value = asyncio.run(wait(value))
try:
    text = json.dumps(value, allow_nan=False, ensure_ascii=False, separators=(',', ':'))
except (TypeError, ValueError) as error:
    sys.stderr.write('Result is not JSON: %s\\n' % error)
    sys.stderr.flush()
    sys.exit(3)
emit.write(('\\n${RESULT}' + text + '\\n').encode('utf-8'))
emit.flush()`;

function interpreter(lang) {
  const binary = lang === 'js' ? realpathSync(process.execPath) : (() => {
    const found = first(['/usr/bin/python3', '/usr/local/bin/python3', '/bin/python3']);
    if (!found) throw new FoundryError('SANDBOX_UNAVAILABLE', 'python3 is not installed in a system location');
    return realpathSync(found);
  })();
  if (binary.startsWith('/tmp/')) throw new FoundryError('SANDBOX_UNAVAILABLE', `Interpreter ${binary} lives under a path the sandbox hides`);
  return lang === 'js'
    ? [binary, '--permission', '--max-old-space-size=512', '--input-type=module', '--eval', JS_RUNNER]
    : [binary, '-I', '-B', '-c', PY_RUNNER];
}
const prlimitArgs = lang => Object.entries(LIMITS[lang]).map(([name, value]) => `--${name}=${value}`).join(' ');

const tail = (text, n = 2000) => text.length > n ? `…${text.slice(-n)}` : text;

export async function runCode({ lang, source, input = null, timeoutMs = 10000, maxOutputBytes = MAX_OUTPUT_BYTES, signal, unshare } = {}) {
  if (!['js', 'python'].includes(lang)) throw new FoundryError('CODE_LANG', 'lang must be js or python');
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 256 * 1024) throw new FoundryError('CODE_SOURCE', 'Source must be a non-empty string of at most 256 KiB');
  checkData(input);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new FoundryError('CODE_TIMEOUT_INVALID', 'timeoutMs must be an integer between 1 and 600000');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_OUTPUT_BYTES) throw new FoundryError('CODE_OUTPUT_INVALID', `maxOutputBytes must be an integer between 1 and ${MAX_OUTPUT_BYTES}`);
  if (signal?.aborted) throw new FoundryError('CANCELLED', 'Code execution was cancelled before launch');
  const unshareBinary = unshare ?? first(['/usr/bin/unshare', '/bin/unshare', '/usr/sbin/unshare', '/sbin/unshare']);
  if (!unshareBinary) throw new FoundryError('SANDBOX_UNAVAILABLE', 'unshare(1) is not installed; code nodes never run unsandboxed');
  const argv = ['--user', '--map-root-user', '--net', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc', '/bin/sh', '-c', SETUP, 'foundry-sandbox', INNER, prlimitArgs(lang), ...interpreter(lang)];
  const identity = process.getuid?.() === 0 && idMapped('uid_map', SANDBOX_ID) && idMapped('gid_map', SANDBOX_ID) ? { uid: SANDBOX_ID, gid: SANDBOX_ID } : {};
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(unshareBinary, argv, { cwd: '/', env: { PATH: SAFE_PATH }, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], ...identity }); }
    catch (error) { reject(new FoundryError('SANDBOX_UNAVAILABLE', `Sandbox launch failed: ${error.message}`)); return; }
    const stdout = [], stderr = [];
    let stdoutBytes = 0, stderrBytes = 0, failure = null;
    const limit = maxOutputBytes + RESULT.length + 2;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
    const stop = error => { failure ??= error; kill(); };
    const timer = setTimeout(() => stop(new FoundryError('CODE_TIMEOUT', `Code exceeded its ${timeoutMs} ms wall-clock budget`)), timeoutMs);
    const abort = () => stop(new FoundryError('CANCELLED', 'Code execution was cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > limit) stop(new FoundryError('CODE_OUTPUT', `Code output exceeded ${maxOutputBytes} bytes`));
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      if (stderrBytes < STDERR_KEEP) stderr.push(chunk.subarray(0, STDERR_KEEP - stderrBytes));
      stderrBytes += chunk.length;
    });
    child.stdin.on('error', () => {});
    child.once('error', error => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      reject(new FoundryError('SANDBOX_UNAVAILABLE', `Sandbox launch failed: ${error.message}`));
    });
    child.once('close', (code, terminationSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      const elapsedMs = Date.now() - startedAt;
      const errText = Buffer.concat(stderr).toString('utf8'), ready = errText.startsWith(READY);
      const userErr = ready ? errText.slice(READY.length) : errText;
      const details = { exitCode: code, signal: terminationSignal, elapsedMs, stderr: tail(userErr, 4096) };
      if (failure) return reject(Object.assign(failure, { details }));
      if (!ready) return reject(new FoundryError('SANDBOX_UNAVAILABLE', `Sandbox setup failed (exit ${code ?? terminationSignal}): ${tail(errText.trim(), 500)}`, details));
      if (code === 3) return reject(new FoundryError('CODE_OUTPUT', `Code result is not a JSON value: ${tail(userErr.trim(), 500)}`, details));
      if (code !== 0) return reject(new FoundryError('CODE_ERROR', `Code failed (exit ${code ?? terminationSignal}): ${tail(userErr.trim())}`, details));
      const line = Buffer.concat(stdout).toString('utf8').split('\n').findLast(l => l.startsWith(RESULT));
      if (line === undefined) return reject(new FoundryError('CODE_OUTPUT', 'Code exited without returning a result', details));
      const text = line.slice(RESULT.length);
      if (Buffer.byteLength(text) > maxOutputBytes) return reject(new FoundryError('CODE_OUTPUT', `Code output exceeded ${maxOutputBytes} bytes`, details));
      let value;
      try { value = checkData(JSON.parse(text), { maxBytes: maxOutputBytes }); }
      catch (error) { return reject(new FoundryError('CODE_OUTPUT', `Code result is not supported JSON: ${error.message}`, details)); }
      resolve({ value, stderr: details.stderr, elapsedMs });
    });
    child.stdin.end(JSON.stringify({ source, input }));
  });
}

let probe;
// One cached trivial launch; callers (and tests) use it to report a precise reason.
export function sandboxStatus() {
  probe ??= runCode({ lang: 'js', source: 'export default () => 1;', timeoutMs: 20000 })
    .then(() => ({ available: true, reason: null }), error => ({ available: false, reason: `${error.code}: ${error.message}` }));
  return probe;
}
