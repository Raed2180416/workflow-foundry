// Run one command in the executor sandbox: user+mount+pid namespace with a fresh /proc, the host filesystem
// read-only, the repository (and with it the oracles), the corpus, the model caches, /root, /tmp and every other
// workdir hidden, repository credentials scrubbed, a wall timeout and a process-group kill. network: false adds a
// private network namespace (no interfaces up: nothing on the host loopback or beyond is reachable; a host service is
// reached only through a unix socket inside the workdir). Used to run B1 scripts.
import { spawn } from 'node:child_process';
import { FoundryError } from '../data.mjs';
import { DEFAULT_HIDDEN, UNSHARE_ARGS, maskSteps, sandboxAvailable, sandboxScript, splitReady } from './claude-code.mjs';

const SCRUBBED = /^(GH_TOKEN|GITHUB_TOKEN|GIT_CONFIG_.*|GIT_ASKPASS|CLOUDSDK_AUTH_ACCESS_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|CLAUDE_CODE_SESSION_ACCESS_TOKEN|CLAUDE_SESSION_INGRESS_TOKEN_FILE)$/;

export async function runSandboxed({ command, args = [], workdir, env = {}, timeoutMs = 10 * 60 * 1000, hidden = DEFAULT_HIDDEN, keepRo = [], network = true, input = '', maxOutputBytes = 8 * 1024 * 1024, signal } = {}) {
  if (!sandboxAvailable()) throw new FoundryError('SANDBOX_UNAVAILABLE', 'User/mount/pid namespaces are required to hide oracles from scripts');
  const script = sandboxScript(maskSteps({ workdir, hidden, keepRo }), workdir, [command, ...args]);
  // Minimal environment: no model credentials, so a script can reach models only through the host
  // gateway (which enforces policy and budget). /root (CLI login state) is hidden as well.
  // (No NODE_EXTRA_CA_CERTS: the proxy CA bundle lives under the hidden /root; pass it in env with keepRo if ever needed.)
  const base = { PATH: '/opt/node24/bin:/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: workdir };
  for (const k of Object.keys(env)) if (SCRUBBED.test(k)) throw new FoundryError('SANDBOX_ENV', `refusing to pass credential variable ${k}`);
  const child = spawn('unshare', [...UNSHARE_ARGS, ...(network ? [] : ['--net']), 'sh', '-c', script], { env: { ...base, ...env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '', timedOut = false, truncated = false;
  child.stdout.on('data', d => { if (stdout.length < maxOutputBytes) stdout += d; else truncated = true; });
  child.stderr.on('data', d => { if (stderr.length < 256 * 1024) stderr += d; });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  signal?.addEventListener('abort', kill, { once: true });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const started = Date.now();
  const code = await new Promise(resolve => child.on('close', resolve));
  clearTimeout(timer);
  // sandboxReady false: the mount namespace could not be set up and the command never ran (an environment fault).
  const { ready, stderr: errText } = splitReady(stderr);
  return { code, stdout, stderr: errText.slice(-8000), timedOut, truncated, sandboxReady: ready, durationMs: Date.now() - started };
}
