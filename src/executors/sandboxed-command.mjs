// Run one command in the executor sandbox: user+mount namespace with the repository (and with it the
// oracles), the corpus and the model caches hidden, repository credentials scrubbed, a wall timeout and a
// process-group kill. Network stays available (the host gateway is on loopback). Used to run B1 scripts.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { FoundryError } from '../data.mjs';
import { DEFAULT_HIDDEN, sandboxAvailable } from './claude-code.mjs';

const SCRUBBED = /^(GH_TOKEN|GITHUB_TOKEN|GIT_CONFIG_.*|GIT_ASKPASS|CLOUDSDK_AUTH_ACCESS_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|CLAUDE_CODE_SESSION_ACCESS_TOKEN|CLAUDE_SESSION_INGRESS_TOKEN_FILE)$/;
const shellQuote = s => `'${String(s).replaceAll("'", `'\\''`)}'`;

export async function runSandboxed({ command, args = [], workdir, env = {}, timeoutMs = 10 * 60 * 1000, hidden = [...DEFAULT_HIDDEN, '/opt/models', '/opt/hf-cache', '/root'], input = '', maxOutputBytes = 8 * 1024 * 1024, signal } = {}) {
  if (!sandboxAvailable()) throw new FoundryError('SANDBOX_UNAVAILABLE', 'User/mount namespaces are required to hide oracles from scripts');
  const mounts = hidden.filter(p => existsSync(p)).map(p => `mount -t tmpfs tmpfs ${shellQuote(p)}`).join(' && ');
  const script = `${mounts ? mounts + ' && ' : ''}cd ${shellQuote(workdir)} && exec ${[command, ...args].map(shellQuote).join(' ')}`;
  // Minimal environment: no model credentials, so a script can reach models only through the host
  // gateway (which enforces policy and budget). /root (CLI login state) is hidden as well.
  const base = { PATH: '/opt/node24/bin:/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: workdir, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ?? '' };
  for (const k of Object.keys(env)) if (SCRUBBED.test(k)) throw new FoundryError('SANDBOX_ENV', `refusing to pass credential variable ${k}`);
  const child = spawn('unshare', ['--user', '--map-root-user', '--mount', '--fork', 'sh', '-c', script], { env: { ...base, ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '', timedOut = false, truncated = false;
  child.stdout.on('data', d => { if (stdout.length < maxOutputBytes) stdout += d; else truncated = true; });
  child.stderr.on('data', d => { if (stderr.length < 256 * 1024) stderr += d; });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  signal?.addEventListener('abort', kill, { once: true });
  child.stdin.end(input);
  const started = Date.now();
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer);
  return { code, stdout, stderr: stderr.slice(-8000), timedOut, truncated, durationMs: Date.now() - started };
}
