// Host facts for GET /info and the endpoint heartbeat. Every probe degrades to null with a reason
// (no nvidia-smi on macOS, no python configured yet, ...) instead of failing the request.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';

function run(cmd, args, { timeoutMs = 10_000, env = process.env } = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: timeoutMs, env, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error: error ? (error.code === 'ENOENT' ? 'not found' : (error.killed ? 'timeout' : `exit ${error.code}`)) : null });
    });
  });
}

export function parseNvidiaCsv(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const [name, total, used, driver, util, temp] = line.split(',').map(s => s.trim());
    const num = v => (v === undefined || v === '' || /N\/A|Not Supported/i.test(v) ? null : Number(v));
    return { name, memoryTotalMiB: num(total), memoryUsedMiB: num(used), driver: driver || null, utilizationPct: num(util), temperatureC: num(temp) };
  });
}

export function parseCudaVersion(text) {
  const m = /CUDA Version:\s*([0-9]+(?:\.[0-9]+)*)/.exec(text);
  return m ? m[1] : null;
}

let gpuCache = { at: 0, value: null };
export async function gpuInfo(nvidiaSmi = 'nvidia-smi', { maxAgeMs = 15_000 } = {}) {
  if (gpuCache.value && Date.now() - gpuCache.at < maxAgeMs && gpuCache.cmd === nvidiaSmi) return gpuCache.value;
  const q = await run(nvidiaSmi, ['--query-gpu=name,memory.total,memory.used,driver_version,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits']);
  let value;
  if (!q.ok) value = { available: false, reason: `nvidia-smi ${q.error}`, gpus: [], cuda: null };
  else {
    const banner = await run(nvidiaSmi, []);
    const gpus = parseNvidiaCsv(q.stdout);
    value = { available: gpus.length > 0, gpus, cuda: parseCudaVersion(banner.stdout) };
  }
  gpuCache = { at: Date.now(), value, cmd: nvidiaSmi };
  return value;
}

export function gpuSummary(info) {
  const g = info?.gpus?.[0];
  return g ? { name: g.name, memoryTotalMiB: g.memoryTotalMiB, driver: g.driver, cuda: info.cuda } : null;
}

export async function pythonVersion(python) {
  if (!python) return { version: null, reason: 'python not configured' };
  if (!fs.existsSync(python)) return { version: null, reason: 'configured python does not exist' };
  const r = await run(python, ['--version']);
  return r.ok ? { version: (r.stdout || r.stderr).trim().replace(/^Python\s+/, '') } : { version: null, reason: r.error };
}

export async function gitHead(dir) {
  if (!dir) return { commit: null, reason: 'not configured' };
  const r = await run('git', ['-C', dir, 'rev-parse', 'HEAD']);
  return r.ok ? { commit: r.stdout.trim() } : { commit: null, reason: r.error };
}

export async function diskFree(dir) {
  try {
    const s = await fsp.statfs(dir);
    return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
  } catch (error) { return { freeBytes: null, reason: error.code }; }
}

export function osInfo() {
  let wsl = /microsoft/i.test(os.release());
  if (!wsl && process.platform === 'linux') { try { wsl = /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')); } catch {} }
  return { platform: process.platform, release: os.release(), arch: process.arch, wsl, cpus: os.cpus().length, memoryTotalMiB: Math.round(os.totalmem() / 2 ** 20) };
}
