// Duplex RPC sandbox for program capabilities (CM0), ARCHITECTURE.md §2.2 and §3.9. A program is frontier- or owner-written JavaScript,
// admitted by the owner and pinned by sha256; it runs in the SAME namespaces and limits as src/sandbox.mjs runCode (fresh user, net, mount
// and pid namespaces; an allowlisted read-only root; no network; PATH only; prlimits; node --permission), but keeps stdin and stdout open
// as a framed channel: the program calls `await call(memberId, args)`, the HOST runs the member through its own gates and answers.
// src/sandbox.mjs is engine-hashed and must not change, and its runCode writes stdin once, so its SETUP and INNER shell programs are copied
// here verbatim; tests/nodecap-program.test.mjs fails if the copies drift from the originals.
//
// Frames are a 4-byte big-endian length and UTF-8 JSON. The program can write ANY bytes to its stdout (it can reach the real stream through
// prototypes), so the host treats every frame as untrusted: a closed shape ({call: {tool, args}} or {result}), a guarded JSON.parse (a
// malformed frame is PROGRAM_FRAME_INVALID and kills the program; it never crashes the host), a per-frame and a total byte cap, and a
// call sequence the HOST counts (the program cannot set or skip it). Calls are served one at a time, in order.
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { checkData, FoundryError } from '../data.mjs';
import { VISIBLE_PATHS, MASKED_PATHS, LIMITS, idMapped } from '../sandbox.mjs';
import { trackChild } from '../children.mjs';

const SANDBOX_ID = 65534;
const SAFE_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const READY = 'FOUNDRY_SANDBOX_READY\n';
const STDERR_KEEP = 64 * 1024;
export const PROGRAM_MAX_OUTPUT_BYTES = 512 * 1024;
const first = candidates => candidates.find(file => existsSync(file));

// ---- copied verbatim from src/sandbox.mjs (drift-checked by tests/nodecap-program.test.mjs) ----
const SETUP = `set -eu
inner="$1"; shift
while read -r mp opts fs; do
  case "$mp" in *\\\\*) echo "foundry-sandbox: unsupported mount point name" >&2; exit 97;; esac
  mountpoint -q "$mp" || continue
  [ "$fs" = nsfs ] && continue
  keep=
  for f in nosuid nodev noexec noatime nodiratime relatime; do case ",$opts," in *",$f,"*) keep="$keep,$f";; esac; done
  case ",$opts," in *,noatime,*|*,relatime,*) ;; *) keep="$keep,strictatime";; esac
  mount -o "remount,bind,ro$keep" "$mp" 2>/dev/null || [ ! -e "$mp" ] || case "$mp" in
    ${VISIBLE_PATHS.flatMap(p => [`'${p}'`, `'${p}'/*`]).join('|')}) echo "foundry-sandbox: cannot make $mp read-only" >&2; exit 1;;
  esac
done <<FOUNDRY_MOUNTS
$(awk '{for(i=7;i<=NF;i++)if($i=="-"){m[$5]=$6" "$(i+1);break}} END{for(k in m)print k, m[k]}' /proc/self/mountinfo)
FOUNDRY_MOUNTS
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
// ---- end of the verbatim copy ----

// The in-sandbox runner. The program module gets `main(input, { call })`; console output goes to stderr; stdout carries frames only.
const RPC_RUNNER = `import { inspect } from 'node:util';
const raw = process.stdout.write.bind(process.stdout);
const toStderr = (...a) => { process.stderr.write(a.map(x => typeof x === 'string' ? x : inspect(x)).join(' ') + '\\n'); };
for (const k of ['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir', 'table']) console[k] = toStderr;
process.stdout.write = process.stderr.write.bind(process.stderr);
const send = message => new Promise(resolve => { const body = Buffer.from(JSON.stringify(message), 'utf8'), head = Buffer.alloc(4); head.writeUInt32BE(body.length); raw(Buffer.concat([head, body]), resolve); });
let buffered = Buffer.alloc(0), waiter = null;
const queue = [];
process.stdin.on('data', chunk => {
  buffered = Buffer.concat([buffered, chunk]);
  while (buffered.length >= 4) {
    const n = buffered.readUInt32BE(0);
    if (buffered.length < 4 + n) break;
    const frame = JSON.parse(buffered.subarray(4, 4 + n).toString('utf8'));
    buffered = buffered.subarray(4 + n);
    if (waiter) { const w = waiter; waiter = null; w(frame); } else queue.push(frame);
  }
});
const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { waiter = resolve; });
const { source, input } = await next();
const call = async (tool, args = {}) => {
  await send({ call: { tool, args } });
  const reply = await next();
  if (!reply.ok) { const error = new Error(reply.code); error.code = reply.code; throw error; }
  return reply.value;
};
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\\n//# sourceURL=foundry-program.mjs').toString('base64'));
const main = typeof mod.default === 'function' ? mod.default : mod.main;
if (typeof main !== 'function') throw new TypeError('The program must export default function main(input, { call })');
const value = await main(input, { call });
await send({ result: value === undefined ? null : value });
process.exit(0);`;

const prlimitArgs = () => Object.entries(LIMITS.js).map(([name, value]) => `--${name}=${value}`).join(' ');
const tail = (text, n = 2000) => text.length > n ? `…${text.slice(-n)}` : text;
const fail = (code, message, details) => new FoundryError(code, message, details);
const plainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Parse and shape-check one frame from the program: {call: {tool, args}} or {result}. Anything else is PROGRAM_FRAME_INVALID. */
export function parseFrame(bytes) {
  let frame;
  try { frame = JSON.parse(bytes.toString('utf8')); } catch { throw fail('PROGRAM_FRAME_INVALID', 'The program sent a frame that is not JSON'); }
  if (!plainObject(frame)) throw fail('PROGRAM_FRAME_INVALID', 'A frame is a JSON object');
  const keys = Object.keys(frame);
  if (keys.length === 1 && keys[0] === 'result') return { result: frame.result };
  if (keys.length === 1 && keys[0] === 'call' && plainObject(frame.call)) {
    const callKeys = Object.keys(frame.call).sort();
    if (JSON.stringify(callKeys) === JSON.stringify(['args', 'tool']) && typeof frame.call.tool === 'string' && frame.call.tool.length <= 128 && plainObject(frame.call.args)) return { call: frame.call };
  }
  throw fail('PROGRAM_FRAME_INVALID', 'The program sent a frame outside the protocol (only {call: {tool, args}} or {result})');
}

/**
 * Run one program. `onCall({ seq, tool, args })` is the host's gate (it throws a FoundryError to refuse; CAPABILITY_DENIED and anything it
 * marks `fatal` end the program). Resolves { value, calls, bytes, elapsedMs }. Linux only: without unshare(1) it is SANDBOX_UNAVAILABLE.
 */
export async function runProgram({ source, input = null, onCall, maxCalls = 20, timeoutMs = 30000, maxOutputBytes = PROGRAM_MAX_OUTPUT_BYTES, signal, unshare } = {}) {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 256 * 1024) throw fail('CODE_SOURCE', 'Source must be a non-empty string of at most 256 KiB');
  checkData(input);
  if (typeof onCall !== 'function') throw fail('PROGRAM_HOST', 'runProgram needs an onCall gate');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > PROGRAM_MAX_OUTPUT_BYTES) throw fail('CODE_OUTPUT_INVALID', `maxOutputBytes must be between 1 and ${PROGRAM_MAX_OUTPUT_BYTES}`);
  if (signal?.aborted) throw fail('CANCELLED', 'The program was cancelled before launch');
  const unshareBinary = unshare ?? first(['/usr/bin/unshare', '/bin/unshare', '/usr/sbin/unshare', '/sbin/unshare']);
  if (process.platform !== 'linux' || !unshareBinary) throw fail('SANDBOX_UNAVAILABLE', 'Program capabilities run only in the Linux namespace sandbox; refused, never run unsandboxed');
  const binary = realpathSync(process.execPath);
  if (binary.startsWith('/tmp/')) throw fail('SANDBOX_UNAVAILABLE', `Interpreter ${binary} lives under a path the sandbox hides`);
  const argv = ['--user', '--map-root-user', '--net', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc', '/bin/sh', '-c', SETUP, 'foundry-sandbox', INNER, prlimitArgs(),
    binary, '--permission', '--max-old-space-size=512', '--input-type=module', '--eval', RPC_RUNNER];
  const identity = process.getuid?.() === 0 && idMapped('uid_map', SANDBOX_ID) && idMapped('gid_map', SANDBOX_ID) ? { uid: SANDBOX_ID, gid: SANDBOX_ID } : {};
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(unshareBinary, argv, { cwd: '/', env: { PATH: SAFE_PATH }, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'], ...identity }); }
    catch (error) { reject(fail('SANDBOX_UNAVAILABLE', `Sandbox launch failed: ${error.message}`)); return; }
    const untrack = trackChild(child, 'program');
    const stderr = [];
    let stderrBytes = 0, bytes = 0, seq = 0, buffered = Buffer.alloc(0), failure = null, result, hasResult = false, chain = Promise.resolve();
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
    const stop = error => { failure ??= error; kill(); };
    const timer = setTimeout(() => stop(fail('CODE_TIMEOUT', `The program exceeded its ${timeoutMs} ms wall-clock budget`)), timeoutMs);
    const abort = () => stop(fail('CANCELLED', 'The program was cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    const write = message => { if (failure) return; const body = Buffer.from(JSON.stringify(message), 'utf8'), head = Buffer.alloc(4); head.writeUInt32BE(body.length); child.stdin.write(Buffer.concat([head, body])); };
    const serve = async call => {
      if (failure) return;
      seq += 1; // host-counted: the program cannot set, repeat or skip it
      if (seq > maxCalls) return stop(fail('PROGRAM_CALL_LIMIT', `The program made more than ${maxCalls} calls`));
      try { write({ ok: true, value: await onCall({ seq, tool: call.tool, args: call.args }) }); }
      catch (error) {
        if (!(error instanceof FoundryError) || error.code === 'CAPABILITY_DENIED' || error.fatal) return stop(error instanceof FoundryError ? error : fail('PROGRAM_HOST', 'The host failed a program call'));
        write({ ok: false, code: error.code });
      }
    };
    child.stdout.on('data', chunk => {
      if (failure) return;
      bytes += chunk.length; // every byte the program emits counts against the cap
      if (bytes > maxOutputBytes) return stop(fail('PROGRAM_OUTPUT_LIMIT', `The program wrote more than ${maxOutputBytes} bytes`));
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const n = buffered.readUInt32BE(0);
        if (n > maxOutputBytes) return stop(fail('PROGRAM_OUTPUT_LIMIT', `The program announced a frame larger than its ${maxOutputBytes}-byte output budget`));
        if (buffered.length < 4 + n) break;
        let frame;
        try { frame = parseFrame(buffered.subarray(4, 4 + n)); } catch (error) { return stop(error); }
        buffered = buffered.subarray(4 + n);
        if (hasResult) return stop(fail('PROGRAM_FRAME_INVALID', 'The program sent a frame after its result'));
        if (frame.call) chain = chain.then(() => serve(frame.call));
        else { hasResult = true; result = frame.result; }
      }
    });
    child.stderr.on('data', chunk => { if (stderrBytes < STDERR_KEEP) stderr.push(chunk.subarray(0, STDERR_KEEP - stderrBytes)); stderrBytes += chunk.length; });
    child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); untrack(); reject(fail('SANDBOX_UNAVAILABLE', `Sandbox launch failed: ${error.message}`)); });
    child.once('close', async (code, terminationSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); untrack();
      await chain.catch(() => {});
      const elapsedMs = Date.now() - startedAt, errText = Buffer.concat(stderr).toString('utf8'), ready = errText.startsWith(READY);
      const details = { exitCode: code, signal: terminationSignal, elapsedMs, calls: seq, stderr: tail(ready ? errText.slice(READY.length) : errText, 4096) };
      if (failure) return reject(Object.assign(failure, { details: { ...(failure.details ?? {}), ...details } }));
      if (!ready) return reject(fail('SANDBOX_UNAVAILABLE', `Sandbox setup failed (exit ${code ?? terminationSignal})`, details));
      if (code !== 0) return reject(fail('CODE_ERROR', `The program failed (exit ${code ?? terminationSignal})`, details));
      if (!hasResult) return reject(fail('CODE_OUTPUT', 'The program exited without a result', details));
      try { checkData(result, { maxBytes: maxOutputBytes }); } catch (error) { return reject(fail('CODE_OUTPUT', `The program result is not supported JSON (${error.code})`, details)); }
      resolve({ value: result, calls: seq, bytes, elapsedMs });
    });
    write({ source, input });
  });
}
