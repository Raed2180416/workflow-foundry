import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { FoundryError } from './data.mjs';

/** Bounded argv-only subprocess. No shell parsing or inherited credential env. */
export async function runProcess(command, args, { cwd, env, input = '', timeoutMs = 60000, signal, maxBytes = 4 * 1024 * 1024 } = {}) {
  if (typeof command !== 'string' || !Array.isArray(args) || args.some(x => typeof x !== 'string')) throw new FoundryError('PROCESS_ARGUMENTS', 'Command and string argv are required');
  if (!env || typeof env !== 'object') throw new FoundryError('PROCESS_ENV', 'A deliberately scoped environment is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new FoundryError('PROCESS_TIMEOUT', 'A bounded subprocess timeout is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new FoundryError('PROCESS_OUTPUT_LIMIT', 'Output budget must be an integer between one byte and 64 MiB');
  if (signal?.aborted) throw new FoundryError('CANCELLED', 'Subprocess was cancelled before launch');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, failure = null, killTimer;
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const startedAt = Date.now();
    const kill = () => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
    };
    const stop = error => {
      if (!failure) failure = error;
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch {}
      killTimer ??= setTimeout(kill, 500);
    };
    const abort = () => stop(new FoundryError('CANCELLED', 'Subprocess cancelled'));
    const timer = setTimeout(() => stop(new FoundryError('PROCESS_TIMEOUT', 'Subprocess exceeded its wall-clock budget')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const collect = which => chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { stop(new FoundryError('PROCESS_OUTPUT_LIMIT', 'Subprocess output exceeded its byte budget')); return; }
      if (which === 'stdout') stdout += decoders.stdout.write(chunk); else stderr += decoders.stderr.write(chunk);
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error); });
    child.once('error', error => { failure = new FoundryError('PROCESS_LAUNCH', error.message); });
    child.once('close', (code, terminationSignal) => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      stdout += decoders.stdout.end(); stderr += decoders.stderr.end();
      if (failure) kill();
      const result = { command, args, code, signal: terminationSignal, stdout, stderr, elapsedMs: Date.now() - startedAt };
      if (failure) { failure.processResult = result; reject(failure); }
      else if (code !== 0) { const error = new FoundryError('PROCESS_FAILED', `${command} exited with ${code ?? terminationSignal}`); error.processResult = result; reject(error); }
      else resolve(result);
    });
    child.stdin.end(input);
  });
}
