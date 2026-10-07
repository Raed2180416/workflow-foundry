// bridge-config.json: written by the laptop operator, never by requests. Unknown keys are errors
// (a typo must not silently fall back to a default).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), 'foundry-bridge', 'bridge-config.json');
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  port: 8765,
  workdir: '~/foundry-bridge/work',
  python: null,                 // the Kev venv's python (e.g. ~/kev-venv/bin/python)
  kevDir: null,                 // the Kev checkout (cwd and PYTHONPATH of every kev job)
  device: 'cuda',               // passed to kev.train/kev.benchmark --device
  llamaServer: null,            // llama.cpp llama-server binary (optional)
  llamaAllowlist: null,         // JSON file {"models":[{"repo","file"}]} the operator controls (optional)
  nvidiaSmi: 'nvidia-smi',
  env: {},                      // extra environment for jobs, e.g. {"HF_HOME": "~/hf-cache"}
  envPassthrough: [],           // extra variable names copied from the daemon's environment into jobs
  maxLlamaServices: 2,
  proxyTimeoutSeconds: 300,
  serviceStartSeconds: 1200,
  timeouts: { 'sys.selftest': 900, 'kev.train': 43_200, 'kev.benchmark': 14_400 },
  limits: { fileBytes: 256 * 1024 * 1024, jsonBytes: 1024 * 1024, nonceCache: 100_000 },
  mailbox: { enabled: true, remote: null, branch: 'foundry-bridge', dir: '~/.foundry-bridge/mailbox', refreshMinutes: 5, heartbeatMinutes: 15, keysMaxAgeHours: 24 },
  tunnel: { publicUrl: null, metrics: 'http://127.0.0.1:20241', log: '~/foundry-bridge/cloudflared.log', pollSeconds: 15 }
});

const NESTED = ['timeouts', 'limits', 'mailbox', 'tunnel'];

export function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export class ConfigError extends Error { constructor(msg) { super(msg); this.code = 'CONFIG'; } }

export function normalizeConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConfigError('config must be a JSON object');
  const errors = [];
  for (const k of Object.keys(input)) if (!(k in DEFAULTS) && k !== '$comment') errors.push(`unknown key ${k}`);
  for (const k of NESTED) {
    const v = input[k];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`${k} must be an object`); continue; }
    for (const kk of Object.keys(v)) if (!(kk in DEFAULTS[k]) && kk !== '$comment') errors.push(`unknown key ${k}.${kk}`);
  }
  const c = { ...structuredClone(DEFAULTS), ...structuredClone(input) };
  for (const k of NESTED) c[k] = { ...structuredClone(DEFAULTS[k]), ...(input[k] ?? {}) };
  delete c.$comment; for (const k of NESTED) delete c[k].$comment;

  if (!LOOPBACK.has(c.host)) errors.push(`host must be a loopback address (127.0.0.1, ::1 or localhost), got ${c.host}`);
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) errors.push('port must be an integer 0-65535');
  for (const k of ['workdir', 'python', 'kevDir', 'llamaServer', 'llamaAllowlist', 'nvidiaSmi']) {
    if (c[k] !== null && typeof c[k] !== 'string') { errors.push(`${k} must be a string or null`); continue; }
    if (!c[k]) continue;
    // a bare command name (no separator) is looked up on PATH; anything else is a path
    const bare = k === 'nvidiaSmi' && !/[\\/]/.test(c[k]) && !c[k].startsWith('~');
    if (!bare) c[k] = path.resolve(expandHome(c[k]));
  }
  if (!['cuda', 'cpu', 'mps'].includes(c.device)) errors.push('device must be cuda, cpu or mps');
  if (!c.env || typeof c.env !== 'object' || Array.isArray(c.env)) errors.push('env must be an object');
  else for (const [k, v] of Object.entries(c.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string') errors.push(`env.${k} must be a string with a valid name`);
    else c.env[k] = v.startsWith('~') ? expandHome(v) : v;
  }
  if (!Array.isArray(c.envPassthrough) || c.envPassthrough.some(n => typeof n !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) errors.push('envPassthrough must be a list of variable names');
  for (const [k, v] of Object.entries(c.timeouts)) if (!(Number.isFinite(v) && v > 0)) errors.push(`timeouts.${k} must be positive seconds`);
  for (const [k, v] of Object.entries(c.limits)) if (!(Number.isInteger(v) && v > 0)) errors.push(`limits.${k} must be a positive integer`);
  for (const k of ['maxLlamaServices', 'proxyTimeoutSeconds', 'serviceStartSeconds']) if (!(Number.isFinite(c[k]) && c[k] > 0)) errors.push(`${k} must be positive`);
  const m = c.mailbox;
  if (typeof m.enabled !== 'boolean') errors.push('mailbox.enabled must be boolean');
  if (m.remote !== null && typeof m.remote !== 'string') errors.push('mailbox.remote must be a string');
  if (typeof m.branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(m.branch)) errors.push('mailbox.branch invalid');
  m.dir = path.resolve(expandHome(m.dir));
  if (!(m.refreshMinutes >= 0.05)) errors.push('mailbox.refreshMinutes must be >= 0.05');
  if (!(m.heartbeatMinutes >= 15) && !(m.heartbeatMinutes > 0 && process.env.FOUNDRY_BRIDGE_TEST === '1')) errors.push('mailbox.heartbeatMinutes must be >= 15');
  if (!(m.keysMaxAgeHours > 0)) errors.push('mailbox.keysMaxAgeHours must be positive');
  const t = c.tunnel;
  if (t.publicUrl !== null && (typeof t.publicUrl !== 'string' || !/^https?:\/\/[^\s/]+\/?$/.test(t.publicUrl))) errors.push('tunnel.publicUrl must be an origin URL or null');
  if (t.metrics !== null && (typeof t.metrics !== 'string' || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):[0-9]+\/?$/.test(t.metrics))) errors.push('tunnel.metrics must be a loopback http URL or null');
  if (t.log !== null) { if (typeof t.log !== 'string') errors.push('tunnel.log must be a path or null'); else t.log = path.resolve(expandHome(t.log)); }
  if (!(t.pollSeconds >= 1)) errors.push('tunnel.pollSeconds must be >= 1');
  if (errors.length) throw new ConfigError(`bridge-config invalid:\n  - ${errors.join('\n  - ')}`);
  c.workdir = path.resolve(expandHome(c.workdir));
  return c;
}

export function loadConfig(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) { throw new ConfigError(`cannot read config ${file}: ${error.code}`); }
  let json;
  try { json = JSON.parse(text); } catch (error) { throw new ConfigError(`config ${file} is not valid JSON: ${error.message}`); }
  return normalizeConfig(json);
}
