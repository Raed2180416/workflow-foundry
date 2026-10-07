// Shared test scaffolding: scratch dirs under /var/tmp/foundry-work/bridge-test-*, throwaway keys,
// a fake python/llama-server, and a daemon on an ephemeral loopback port. No network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, publicKeyPem, signRequest, sha256hex } from '../common/protocol.mjs';
import { createDaemon } from '../laptop/daemon.mjs';
import { normalizeConfig } from '../laptop/config.mjs';

process.env.FOUNDRY_BRIDGE_TEST = '1';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRATCH_ROOT = '/var/tmp/foundry-work';

// Cleanups run last-registered-first, so a daemon or job manager stops before its scratch dir goes.
const stacks = new WeakMap();
export function defer(t, fn) {
  if (!t?.after) return;
  let stack = stacks.get(t);
  if (!stack) {
    stack = []; stacks.set(t, stack);
    t.after(async () => { while (stack.length) { try { await stack.pop()(); } catch {} } });
  }
  stack.push(fn);
}

export function scratch(t, tag = 'x') {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SCRATCH_ROOT, `bridge-test-${tag}-`));
  defer(t, () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function wrapper(dir, name, script) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return file;
}
export function fakePython(dir) { return wrapper(dir, 'python', path.join(HERE, 'fixtures', 'fake-python.mjs')); }
export function fakeLlama(dir) { return wrapper(dir, 'llama-server', path.join(HERE, 'fixtures', 'fake-llama.mjs')); }

export function testKey(dir, label = 'cloud') {
  const k = generateKeyPair();
  if (dir) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${label}-${k.keyId}.pub`), publicKeyPem(k.publicKey));
  }
  return k;
}

export function testConfig(root, overrides = {}) {
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin, { recursive: true });
  const kevDir = path.join(root, 'kev'); fs.mkdirSync(path.join(kevDir, 'evals', 'tiny'), { recursive: true });
  fs.writeFileSync(path.join(kevDir, 'evals', 'tiny', 'manifest.json'), '{}');
  return normalizeConfig({
    port: 0, workdir: path.join(root, 'work'), python: fakePython(bin), kevDir, llamaServer: fakeLlama(bin),
    nvidiaSmi: path.join(bin, 'no-nvidia-smi'),
    mailbox: { enabled: false }, tunnel: { metrics: null, log: null },
    timeouts: { 'sys.selftest': 30, 'kev.train': 30, 'kev.benchmark': 30 },
    serviceStartSeconds: 20,
    ...overrides
  });
}

export async function startDaemon(t, { root, config, keysDir, ...rest } = {}) {
  root ??= scratch(t, 'daemon');
  keysDir ??= path.join(root, 'keys');
  fs.mkdirSync(keysDir, { recursive: true });
  const key = rest.key ?? testKey(keysDir);
  const cfg = config ?? testConfig(root);
  const logs = [];
  const d = await createDaemon({ config: cfg, keysDir, log: m => logs.push(m), ...rest.daemonOpts });
  defer(t, () => d.close());
  return { d, key, root, keysDir, cfg, logs, url: d.url };
}

// Raw HTTP request to the daemon with full control over headers (for rejection tests).
export function raw(url, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, method, path: p, headers, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body !== undefined) req.end(body); else req.end();
  });
}

// Signed raw request; `mutate(headers)` may tamper with the signed headers before sending.
export function signed(url, key, { method = 'GET', path: p = '/', body, headers = {}, ts, nonce, signPath, signMethod, signBody, announce = true, mutate } = {}) {
  const h = signRequest({ privateKey: key.privateKey, keyId: key.keyId, method: signMethod ?? method, path: signPath ?? p, body: signBody ?? body ?? '', ts, nonce, announceBodyHash: announce });
  const all = { ...headers, ...h };
  if (body !== undefined) all['content-length'] = String(Buffer.byteLength(body));
  mutate?.(all);
  return raw(url, { method, path: p, headers: all, body });
}

export async function waitFor(fn, { timeoutMs = 10_000, everyMs = 50, what = 'condition' } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, everyMs));
  }
}

// Writes what a kev.train job this daemon ran to success leaves behind (its record in jobs/ with the
// head.pt hash, and runs/<jobId>/head.pt), so tests can reference runs/<jobId> without training.
export function plantTrainedRun(workdir, { id = `j-20261007-000000-${crypto.randomBytes(3).toString('hex')}`, head = Buffer.alloc(0) } = {}) {
  fs.mkdirSync(path.join(workdir, 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(workdir, 'runs', id), { recursive: true });
  fs.writeFileSync(path.join(workdir, 'runs', id, 'head.pt'), head);
  const t = new Date().toISOString();
  const rec = { id, kind: 'kev.train', class: 'gpu', params: {}, state: 'succeeded', createdAt: t, startedAt: t, endedAt: t, exitCode: 0, signal: null, error: null, result: null, outputs: null, log: `logs/${id}.log`, outputDir: `runs/${id}`, checkpoint: { dir: `runs/${id}`, headSha256: sha256hex(head) } };
  fs.writeFileSync(path.join(workdir, 'jobs', `${id}.json`), JSON.stringify(rec));
  return `runs/${id}`;
}

export const sha = sha256hex;
export const randomHex = n => crypto.randomBytes(n).toString('hex');
