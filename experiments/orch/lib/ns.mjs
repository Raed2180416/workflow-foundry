// Run a shell script inside a fresh user + mount namespace (no root needed): mount a small tmpfs (a real ENOSPC), or mask
// /proc with an empty tmpfs (a host without procfs: macOS, BSD, hardened containers). The script's stdout JSON lines are
// returned. Processes started inside keep their real pids (no pid namespace), so the caller sees them in its own /proc.
import { spawn } from 'node:child_process';
const quote = s => `'${String(s).replaceAll("'", "'\\''")}'`;
export { quote };
export function inNamespace(script, { timeoutMs = 120000, env = {} } = {}) {
  return new Promise(resolve => {
    const child = spawn('unshare', ['--user', '--map-root-user', '--mount', 'sh', '-c', script], { env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { if (err.length < 100000) err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const lines = out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      resolve({ code, signal, lines, stderr: err });
    });
  });
}
