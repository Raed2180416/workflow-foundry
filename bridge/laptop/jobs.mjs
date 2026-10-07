// Fixed job registry, explicit parameter schemas, FIFO GPU queue and long-running services.
// Processes are spawned with argument arrays (never a shell), a minimal environment and their own
// process group, so cancel/stop reaches the whole tree. Commands come from bridge-config.json paths;
// requests only choose among validated parameters.
//
// Checkpoints (finding F1). Kev reads a run's head.pt with torch.load, which unpickles. So:
//  - runs/ is written only by jobs (the files API refuses uploads there);
//  - a `runs/<dir>` reference must name a kev.train job this daemon ran to success, and its head.pt
//    must still have the sha256 recorded when that job ended;
//  - every job runs with TORCH_FORCE_WEIGHTS_ONLY_LOAD=1 (torch then refuses pickled code even where
//    a caller passes weights_only=False), and kev.* jobs are refused unless the configured python has
//    torch >= 2.6 (older weights-only unpicklers had a known bypass, CVE-2025-32434).
import { execFile, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseRelPath } from '../common/relpath.mjs';
import { diskFree as defaultDiskFree } from './sysinfo.mjs';

export const HUB_RUN_RE = /^jaredpalmer\/kev-[0-9.]+b(@v[0-9.]+)?$/;
export const BASE_RE = /^Qwen\/Qwen3(\.[0-9]+)?-[0-9.]+B(-Base)?$/;
export const SERVICE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const JOB_ID_RE = /^j-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;
const IS_WIN = process.platform === 'win32';

export const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'stopped', 'lost']);

export class JobError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

// ---- parameter schemas ---------------------------------------------------------------------------

const S = {
  int: (min, max, dflt) => ({ type: 'int', min, max, default: dflt }),
  num: (min, max, dflt) => ({ type: 'number', min, max, default: dflt }),
  enumOf: (values, dflt) => ({ type: 'enum', values, default: dflt }),
  str: (re, dflt) => ({ type: 'string', re, default: dflt }),
  dataFile: ({ required = true, ext } = {}) => ({ type: 'dataFile', required, ext }),
  runRef: ({ required = true, allowNone = false, dflt } = {}) => ({ type: 'runRef', required, allowNone, default: dflt }),
  obj: (shape, dflt = {}) => ({ type: 'object', shape, default: dflt }),
  hfModel: () => ({ type: 'hfModel' })
};

// kev.train flags the cloud may set besides the named parameters (kev/train.py at the pinned commit)
export const TRAIN_EXTRA = {
  perm_kl: S.num(0, 10), perm_frac: S.num(0, 1), ord_w: S.num(0, 10), brier_w: S.num(0, 10),
  label_smoothing: S.num(0, 1), focal_gamma: S.num(0, 10), head_lr: S.num(0, 1e-2), weight_decay: S.num(0, 1),
  seed: S.int(0, 2 ** 31 - 1), max_steps: S.int(0, 1_000_000), lora_targets: S.enumOf(['all', 'dense', 'attn', 'qv']),
  base_revision: S.str(/^[0-9a-f]{40}$/), weights_dtype: S.enumOf(['fp32', 'bf16']), replay: S.int(0, 100_000),
  suite: S.str(/^evals\/[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/), p_none_pair: S.num(0, 1),
  length_sort: S.int(0, 1), row_budget: S.int(0, 1_000_000), shared_prefix: S.int(0, 1)
};

export const KINDS = {
  'sys.selftest': { class: 'gpu', params: {} },
  'kev.train': {
    class: 'gpu',
    params: {
      dataset: S.dataFile(), base: S.str(BASE_RE, 'Qwen/Qwen3.5-0.8B-Base'),
      initFrom: S.runRef({ required: false, allowNone: true, dflt: 'jaredpalmer/kev-0.8b@v1.0' }),
      epochs: S.int(1, 10, 1), lr: S.num(1e-6, 1e-3, 2e-5), batch: S.int(1, 16, 1), accum: S.int(1, 64, 8),
      dtype: S.enumOf(['bf16', 'fp32'], 'bf16'), maxState: S.int(384, 8192, 384), checkpointing: S.int(0, 1, 1),
      lora: S.int(4, 64, 16), extra: S.obj(TRAIN_EXTRA)
    }
  },
  'kev.benchmark': { class: 'gpu', params: { run: S.runRef(), data: S.dataFile(), rotations: S.int(1, 8, 1) } },
  'kev.serve': { class: 'service', params: { run: S.runRef({ required: false, dflt: 'jaredpalmer/kev-0.8b@v1.0' }), port: S.int(8008, 8099, 8008) } },
  'llama.serve': {
    class: 'service',
    params: { name: S.str(SERVICE_NAME_RE), gguf: S.dataFile({ required: false, ext: '.gguf' }), hf: S.hfModel(), ctx: S.int(256, 131072, 4096), ngl: S.int(0, 999, 99), port: S.int(8100, 8199, 8100) }
  },
  'git.refresh': { class: 'inline', params: {} }
};

function inside(child, parent) { return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep); }

// Validates `params` against `schema`. Returns { value (as recorded), resolved (absolute paths) }.
export async function validateParams(schema, params, ctx, prefix = '') {
  const errors = []; const value = {}; const resolved = {};
  if (params === undefined || params === null) params = {};
  if (typeof params !== 'object' || Array.isArray(params)) throw new JobError(400, 'invalid_params', 'params must be an object');
  for (const k of Object.keys(params)) if (!(k in schema)) errors.push(`${prefix}${k}: unknown parameter`);
  for (const [k, spec] of Object.entries(schema)) {
    const name = prefix + k; let v = params[k];
    if (v === undefined || v === null) {
      if (spec.default !== undefined) v = structuredClone(spec.default);
      else if (spec.required && spec.type !== 'object') { errors.push(`${name}: required`); continue; }
      else if (spec.type === 'object') v = {};
      else continue;
      if (spec.type !== 'object' && spec.type !== 'runRef') { value[k] = v; continue; }
    }
    switch (spec.type) {
      case 'int':
        if (!Number.isInteger(v) || v < spec.min || v > spec.max) errors.push(`${name}: integer ${spec.min}..${spec.max}`); else value[k] = v; break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v) || v < spec.min || v > spec.max) errors.push(`${name}: number ${spec.min}..${spec.max}`); else value[k] = v; break;
      case 'enum':
        if (!spec.values.includes(v)) errors.push(`${name}: one of ${spec.values.join('|')}`); else value[k] = v; break;
      case 'string':
        if (typeof v !== 'string' || !spec.re.test(v)) errors.push(`${name}: must match ${spec.re}`); else value[k] = v; break;
      case 'dataFile': {
        if (typeof v !== 'string') { errors.push(`${name}: a path under data/`); break; }
        try {
          if (spec.ext && !v.endsWith(spec.ext)) throw new Error(`must end with ${spec.ext}`);
          resolved[k] = await ctx.resolveFile(v, ['data']); value[k] = v;
        } catch (error) { errors.push(`${name}: ${error.message}`); }
        break;
      }
      case 'runRef': {
        if (v === '' && spec.allowNone) { value[k] = ''; resolved[k] = ''; break; }
        if (typeof v !== 'string') { errors.push(`${name}: a hub id matching ${HUB_RUN_RE} or runs/<jobId> of a finished kev.train job`); break; }
        if (HUB_RUN_RE.test(v)) { value[k] = v; resolved[k] = v; break; }
        try { resolved[k] = await ctx.resolveRunDir(v); value[k] = v; } catch (error) { errors.push(`${name}: ${error.message}`); }
        break;
      }
      case 'object': {
        if (typeof v !== 'object' || Array.isArray(v)) { errors.push(`${name}: object`); break; }
        try { const r = await validateParams(spec.shape, v, ctx, `${name}.`); value[k] = r.value; resolved[k] = r.resolved; }
        catch (error) { errors.push(...(error.details ?? [error.message])); }
        break;
      }
      case 'hfModel': {
        if (typeof v !== 'object' || Array.isArray(v) || typeof v.repo !== 'string' || typeof v.file !== 'string' || Object.keys(v).some(x => x !== 'repo' && x !== 'file')) { errors.push(`${name}: {repo, file}`); break; }
        const allowed = ctx.llamaAllowlist().some(m => m.repo === v.repo && m.file === v.file);
        if (!allowed) errors.push(`${name}: ${v.repo} ${v.file} is not in the operator's llama allowlist`); else { value[k] = { repo: v.repo, file: v.file }; resolved[k] = value[k]; }
        break;
      }
      default: errors.push(`${name}: unsupported schema type`);
    }
  }
  if (errors.length) throw new JobError(400, 'invalid_params', `invalid parameters: ${errors.join('; ')}`, errors);
  return { value, resolved };
}

// ---- commands ------------------------------------------------------------------------------------

export const SELFTEST_PY = String.raw`
import json, os, platform, sys, time
r = {"python": sys.version.split()[0], "platform": platform.platform()}
try:
    import torch
    r["torch"] = torch.__version__
    r["torch_cuda_build"] = torch.version.cuda
    r["cuda_available"] = bool(torch.cuda.is_available())
    r["mps_available"] = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
    if r["cuda_available"]:
        p = torch.cuda.get_device_properties(0)
        r["device"] = p.name
        r["capability"] = f"{p.major}.{p.minor}"
        r["vram_mib"] = p.total_memory // 2**20
        r["bf16_supported"] = bool(torch.cuda.is_bf16_supported())
        n = 4096
        a = torch.randn(n, n, device="cuda", dtype=torch.bfloat16)
        b = torch.randn(n, n, device="cuda", dtype=torch.bfloat16)
        for _ in range(3):
            a @ b
        torch.cuda.synchronize()
        t = time.perf_counter(); k = 20
        for _ in range(k):
            a @ b
        torch.cuda.synchronize()
        dt = (time.perf_counter() - t) / k
        r["bf16_matmul_4096_ms"] = round(dt * 1e3, 3)
        r["bf16_tflops"] = round(2 * n ** 3 / dt / 1e12, 2)
        r["peak_mem_mib"] = torch.cuda.max_memory_allocated() // 2**20
except Exception as e:
    r["torch_error"] = f"{type(e).__name__}: {e}"
# The bridge's pickle guard (PROTOCOL.md §5): torch >= 2.6, and a pickle that would call a function
# must be refused even when weights_only=False is asked for (TORCH_FORCE_WEIGHTS_ONLY_LOAD=1).
try:
    import io, re
    import torch
    m = re.match(r"(\d+)\.(\d+)", torch.__version__)
    r["torch_weights_only_safe"] = bool(m) and (int(m.group(1)), int(m.group(2))) >= (2, 6)
    r["torch_force_weights_only"] = os.environ.get("TORCH_FORCE_WEIGHTS_ONLY_LOAD")
    class _Probe:
        def __reduce__(self):
            return (print, ("FOUNDRY_PICKLE_GADGET_RAN",))
    buf = io.BytesIO(); torch.save({"probe": _Probe()}, buf); buf.seek(0)
    try:
        torch.load(buf, map_location="cpu", weights_only=False)
        r["pickle_guard"] = "executed"
    except Exception as e:
        r["pickle_guard"] = "refused"
except Exception as e:
    r["pickle_guard"] = f"error: {type(e).__name__}: {e}"
try:
    import kev
    r["kev_import"] = "ok"
    import transformers, peft
    r["transformers"] = transformers.__version__
    r["peft"] = peft.__version__
except Exception as e:
    r["kev_error"] = f"{type(e).__name__}: {e}"
print("FOUNDRY_RESULT " + json.dumps(r), flush=True)
ok = r.get("cuda_available") and "kev_error" not in r and "torch_error" not in r
ok = ok and r.get("torch_weights_only_safe") and r.get("pickle_guard") == "refused"
sys.exit(0 if ok else 1)
`;

// Reads the torch version from package metadata (no torch import: fast).
export const TORCH_PROBE_PY = String.raw`
import importlib.metadata as m
try:
    print("FOUNDRY_TORCH " + m.version("torch"))
except m.PackageNotFoundError:
    print("FOUNDRY_TORCH none")
`;
export const MIN_TORCH = Object.freeze([2, 6]);
export function torchSafe(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version ?? ''));
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > MIN_TORCH[0] || (maj === MIN_TORCH[0] && min >= MIN_TORCH[1]);
}

export async function hashFile(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), async src => { for await (const c of src) h.update(c); });
  return h.digest('hex');
}

function flag(name) { return `--${name}`; }

export function buildCommand(kind, job, resolved, cfg, outDirAbs) {
  const p = job.params;
  const requireKev = () => {
    if (!cfg.python) throw new JobError(503, 'not_configured', 'bridge-config.json has no "python" (the Kev venv interpreter)');
    if (!cfg.kevDir) throw new JobError(503, 'not_configured', 'bridge-config.json has no "kevDir" (the Kev checkout)');
  };
  switch (kind) {
    case 'sys.selftest':
      requireKev();
      return { cmd: cfg.python, args: ['-c', SELFTEST_PY], cwd: cfg.kevDir };
    case 'kev.train': {
      requireKev();
      if (p.dtype === 'bf16' && cfg.device !== 'cuda') throw new JobError(400, 'invalid_params', `dtype bf16 needs device cuda; this laptop is configured for ${cfg.device}`);
      const args = ['-m', 'kev.train', '--data', resolved.dataset, '--base', p.base,
        '--epochs', String(p.epochs), '--lr', String(p.lr), '--batch', String(p.batch), '--accum', String(p.accum),
        '--dtype', p.dtype, '--max_state', String(p.maxState), '--checkpointing', String(p.checkpointing), '--lora', String(p.lora),
        '--device', cfg.device, '--out', outDirAbs];
      if (resolved.initFrom) args.push('--init_from', resolved.initFrom);
      for (const [k, v] of Object.entries(p.extra ?? {})) {
        if (k === 'suite') {
          const abs = path.resolve(cfg.kevDir, v);
          if (!inside(abs, path.resolve(cfg.kevDir)) || !fs.existsSync(path.join(abs, 'manifest.json'))) throw new JobError(400, 'invalid_params', `extra.suite: ${v} is not a suite directory in the Kev checkout`);
          args.push('--suite', abs);
        } else args.push(flag(k), String(v));
      }
      return { cmd: cfg.python, args, cwd: cfg.kevDir };
    }
    case 'kev.benchmark': {
      requireKev();
      const args = ['-m', 'kev.benchmark', '--run', resolved.run, '--data', resolved.data, '--out', outDirAbs, '--device', cfg.device];
      if (p.rotations > 1) args.push('--rotations', String(p.rotations));
      return { cmd: cfg.python, args, cwd: cfg.kevDir };
    }
    case 'kev.serve':
      requireKev();
      return { cmd: cfg.python, args: ['-m', 'kev.serve', '--run', resolved.run, '--host', '127.0.0.1', '--port', String(p.port)], cwd: cfg.kevDir, probe: '/v1/models' };
    case 'llama.serve': {
      if (!cfg.llamaServer) throw new JobError(503, 'not_configured', 'bridge-config.json has no "llamaServer"');
      if (!!p.gguf === !!p.hf) throw new JobError(400, 'invalid_params', 'llama.serve needs exactly one of gguf (a data/ file) or hf ({repo, file} from the allowlist)');
      const model = p.gguf ? ['-m', resolved.gguf] : ['--hf-repo', p.hf.repo, '--hf-file', p.hf.file];
      return { cmd: cfg.llamaServer, args: [...model, '--host', '127.0.0.1', '--port', String(p.port), '-c', String(p.ctx), '-ngl', String(p.ngl), '--alias', p.name], cwd: path.dirname(cfg.llamaServer), probe: '/health' };
    }
    default: throw new JobError(400, 'unknown_kind', `unknown job kind ${kind}`);
  }
}

// Minimal job environment: a few basics, CUDA/HF/torch knobs, proxy settings, operator extras.
// Tokens are not passed unless the operator lists them in envPassthrough.
const PASS_PREFIX = /^(CUDA_|NVIDIA_|HF_|HUGGINGFACE_|PYTORCH_|TORCH_|KEV_|LLAMA_|NCCL_|OMP_|MKL_)/;
const PASS_EXACT = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'LD_LIBRARY_PATH', 'XDG_CACHE_HOME', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']);
const SECRETISH = /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i;

export function jobEnv(cfg, base = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (cfg.envPassthrough.includes(k)) { env[k] = v; continue; }
    if ((PASS_EXACT.has(k) || PASS_PREFIX.test(k)) && !SECRETISH.test(k)) env[k] = v;
  }
  Object.assign(env, cfg.env);
  if (cfg.kevDir) env.PYTHONPATH = cfg.kevDir;
  env.PYTHONUNBUFFERED = '1'; env.PYTHONNOUSERSITE = '1'; env.TOKENIZERS_PARALLELISM = 'false';
  // the pickle guard (F1): torch refuses pickled code in every torch.load, even with weights_only=False
  delete env.TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD;
  env.TORCH_FORCE_WEIGHTS_ONLY_LOAD = '1';
  if (cfg.python && !IS_WIN) env.PATH = `${path.dirname(cfg.python)}${path.delimiter}${env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`;
  return env;
}

function newJobId() {
  const d = new Date().toISOString().replace(/[-:]/g, '');   // 20261007T150102.345Z
  return `j-${d.slice(0, 8)}-${d.slice(9, 15)}-${crypto.randomBytes(3).toString('hex')}`;
}

function killTree(pid, signal) {
  if (!pid) return;
  if (IS_WIN) { try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }); } catch {} return; }
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch {} }
}

function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen({ host: '127.0.0.1', port, exclusive: true }, () => s.close(() => resolve(true)));
  });
}

function probe(port, route, timeoutMs = 3000) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: route, timeout: timeoutMs, agent: false }, res => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

// Reads at most `limit` bytes from `offset`, trimmed back to a UTF-8 character boundary.
export function readLogChunk(file, offset, limit) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return { data: '', nextOffset: offset, size: 0 }; }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.min(Math.max(0, offset), size);
    const len = Math.min(limit, size - start);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    let end = len;
    if (start + len < size) {   // do not split a multi-byte character at the cut
      let i = len - 1, cont = 0;
      while (i >= 0 && (buf[i] & 0xc0) === 0x80 && cont < 3) { i--; cont++; }
      if (i >= 0) {
        const lead = buf[i]; const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
        if (need > cont + 1) end = i;
      }
    }
    return { data: buf.subarray(0, end).toString('utf8'), nextOffset: start + end, size };
  } finally { fs.closeSync(fd); }
}

async function listOutputs(dirAbs, relPrefix, max = 2000) {
  const files = []; let truncated = false;
  async function walk(abs, rel) {
    let ents; try { ents = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      if (files.length >= max) { truncated = true; return; }
      const a = path.join(abs, e.name), r = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(a, r);
      else if (e.isFile()) files.push({ path: r, size: (await fsp.stat(a)).size });
    }
  }
  await walk(dirAbs, relPrefix);
  return { dir: relPrefix, files, truncated };
}

// ---- manager -------------------------------------------------------------------------------------

const LIVE_MANAGERS = new Set();
let exitHookInstalled = false;

export class JobManager {
  #jobs = new Map(); #children = new Map(); #queue = []; #running = null; #killed = false;
  #inlineRunning = null; #inlinePending = null; #torch = null; #torchProbe = null;
  constructor({ config, workdir, log = () => {}, refresh = async () => ({}), onServicesChange = () => {}, now = () => Date.now(), diskFree = defaultDiskFree, logWatchMs = 5000 }) {
    Object.assign(this, { cfg: config, workdir, log, refresh, onServicesChange, now, diskFree, logWatchMs });
    this.jobsDir = path.join(workdir, 'jobs'); this.logsDir = path.join(workdir, 'logs'); this.runsDir = path.join(workdir, 'runs'); this.dataDir = path.join(workdir, 'data');
  }

  async init() {
    for (const d of [this.jobsDir, this.logsDir, this.runsDir, this.dataDir]) await fsp.mkdir(d, { recursive: true });
    this.workdirReal = await fsp.realpath(this.workdir);
    for (const name of (await fsp.readdir(this.jobsDir)).filter(n => n.endsWith('.json'))) {
      try {
        const job = JSON.parse(await fsp.readFile(path.join(this.jobsDir, name), 'utf8'));
        if (!JOB_ID_RE.test(job.id) || name !== `${job.id}.json`) continue;
        if (!TERMINAL.has(job.state)) { job.state = 'lost'; job.error = 'daemon restarted while this job was queued or running'; job.endedAt ??= new Date(this.now()).toISOString(); await this.#save(job); }
        this.#jobs.set(job.id, job);
      } catch {}
    }
    await this.#prune();
    LIVE_MANAGERS.add(this.#children);
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      // last resort when the daemon dies: children run in their own process groups and would otherwise outlive it
      process.on('exit', () => { for (const m of LIVE_MANAGERS) for (const c of m.values()) killTree(c.pid, 'SIGKILL'); });
    }
  }

  // ---- path resolution used by validators and the files API ----
  async resolveFile(rel, tops) {
    const { segments } = parseRelPath(rel, { tops });
    const top = await fsp.realpath(path.join(this.workdirReal, segments[0]));
    let real;
    try { real = await fsp.realpath(path.join(this.workdirReal, ...segments)); } catch { throw new Error(`${rel} does not exist`); }
    if (!inside(real, top)) throw new Error(`${rel} escapes ${segments[0]}/ through a symlink`);
    if (!(await fsp.stat(real)).isFile()) throw new Error(`${rel} is not a file`);
    return real;
  }
  // A checkpoint reference must be runs/<jobId> of a kev.train job this daemon ran to success, whose
  // head.pt still has the sha256 recorded when the job ended (F1). Nothing else under runs/ is loaded.
  async resolveRunDir(rel) {
    const { segments } = parseRelPath(rel, { tops: ['runs'] });
    if (segments.length !== 2 || !JOB_ID_RE.test(segments[1])) throw new Error('name a checkpoint as runs/<jobId> of a kev.train job this daemon ran');
    const job = this.#jobs.get(segments[1]);
    if (!job || job.kind !== 'kev.train' || job.state !== 'succeeded' || !job.checkpoint?.headSha256) throw new Error(`${rel} is not a checkpoint of a kev.train job this daemon finished successfully`);
    const dir = path.join(this.workdirReal, 'runs', segments[1]);
    const st = await fsp.lstat(dir).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`${rel} is missing or is not a plain directory`);
    const head = path.join(dir, 'head.pt');
    const hs = await fsp.lstat(head).catch(() => null);
    if (!hs?.isFile()) throw new Error(`${rel}/head.pt is missing or is not a regular file`);
    if (await hashFile(head) !== job.checkpoint.headSha256) throw new Error(`${rel}/head.pt changed after the job wrote it; refusing to load it`);
    return dir;
  }
  llamaAllowlist() {
    if (!this.cfg.llamaAllowlist) return [];
    try {
      const j = JSON.parse(fs.readFileSync(this.cfg.llamaAllowlist, 'utf8'));
      return (Array.isArray(j?.models) ? j.models : []).filter(m => typeof m?.repo === 'string' && typeof m?.file === 'string');
    } catch { return []; }
  }

  // torch version of the configured python, from package metadata. Cached: 10 min when safe, 1 min otherwise.
  async torchCheck({ force = false } = {}) {
    const t = this.#torch;
    if (!force && t && this.now() - t.at < (t.safe ? 600_000 : 60_000)) return t;
    this.#torchProbe ??= (async () => {
      let version = null, error = null;
      if (!this.cfg.python) error = 'python not configured';
      else {
        const r = await new Promise(resolve => execFile(this.cfg.python, ['-c', TORCH_PROBE_PY], { cwd: this.cfg.kevDir ?? os.tmpdir(), env: jobEnv(this.cfg), timeout: 60_000, windowsHide: true, maxBuffer: 1 << 16 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })));
        const m = /^FOUNDRY_TORCH (\S+)$/m.exec(r.stdout);
        if (m && m[1] !== 'none') version = m[1];
        else error = m ? 'torch is not installed in the configured python' : `torch probe failed: ${(r.err?.code ?? r.stderr.trim().split('\n').pop() ?? 'no output')}`.slice(0, 300);
      }
      this.#torch = { at: this.now(), version, safe: !error && torchSafe(version), error };
      return this.#torch;
    })().finally(() => { this.#torchProbe = null; });
    return this.#torchProbe;
  }

  // ---- public API ----
  get killed() { return this.#killed; }
  setKilled(on, reason = 'kill switch') {
    const was = this.#killed; this.#killed = !!on;
    if (on && !was) this.stopAll(reason);
  }

  async submit(kind, params) {
    if (this.#killed) throw new JobError(403, 'killed', 'the kill switch is set; no new work is accepted');
    if (typeof kind !== 'string' || !Object.hasOwn(KINDS, kind)) throw new JobError(400, 'unknown_kind', `unknown job kind ${String(kind).slice(0, 60)}; known: ${Object.keys(KINDS).join(', ')}`);
    const def = KINDS[kind];
    const { value, resolved } = await validateParams(def.params, params, this);
    if (def.class === 'inline' && this.#inlinePending) return { ...this.public(this.#inlinePending), coalesced: true };   // F4: at most one waiting
    if (def.class === 'gpu' && this.#queue.length >= this.cfg.limits.maxQueued) throw new JobError(429, 'queue_full', `${this.#queue.length} GPU jobs are already queued (limit ${this.cfg.limits.maxQueued}); wait or cancel some`);
    const id = newJobId();
    const job = { id, kind, class: def.class, params: value, state: 'queued', createdAt: new Date(this.now()).toISOString(), startedAt: null, endedAt: null, exitCode: null, signal: null, error: null, result: null, outputs: null, log: `logs/${id}.log` };
    let built = null;
    if (def.class !== 'inline') {
      const outRel = def.class === 'gpu' && kind !== 'sys.selftest' ? `runs/${id}` : null;
      built = buildCommand(kind, job, resolved, this.cfg, outRel ? path.join(this.workdirReal, 'runs', id) : null);
      if (outRel) job.outputDir = outRel;
      await this.#checkDisk();
      if (kind.startsWith('kev.')) {
        const t = await this.torchCheck();
        if (!t.safe) throw new JobError(503, 'unsafe_torch', `refusing ${kind}: the configured python has ${t.version ? `torch ${t.version}` : 'no usable torch'}${t.error ? ` (${t.error})` : ''}; Kev checkpoints are pickles and need torch >= ${MIN_TORCH.join('.')} to be loaded safely`);
      }
    }
    if (def.class === 'service') await this.#checkService(kind, job);
    this.#jobs.set(id, job);
    await this.#save(job);
    if (def.class === 'gpu') { this.#queue.push({ job, built }); this.#pump(); }
    else if (def.class === 'service') await this.#start(job, built);
    else if (this.#inlineRunning) this.#inlinePending = job;
    else this.#runInline(job);
    return this.public(job);
  }

  get(id) { const j = this.#jobs.get(id); return j ? this.public(j) : null; }
  list({ limit = 50 } = {}) { return [...this.#jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(j => this.summary(j)); }
  queue() { return { running: this.#running?.id ?? null, queued: this.#queue.map(q => q.job.id) }; }
  services() { return [...this.#jobs.values()].filter(j => j.class === 'service' && !TERMINAL.has(j.state)).map(j => this.summary(j)); }
  get recordCount() { return this.#jobs.size; }

  // { port } of the running service, or null
  serviceTarget(kind, name) {
    for (const j of this.#jobs.values()) {
      if (j.class !== 'service' || j.state !== 'running' || j.kind !== kind) continue;
      if (kind === 'llama.serve' && j.params.name !== name) continue;
      return { port: j.params.port, id: j.id };
    }
    return null;
  }

  readLog(id, offset = 0, limit = 256 * 1024) {
    const job = this.#jobs.get(id);
    if (!job) return null;
    const chunk = readLogChunk(path.join(this.logsDir, `${id}.log`), offset, limit);
    return { id, offset, ...chunk, done: TERMINAL.has(job.state) && chunk.nextOffset >= chunk.size, state: job.state };
  }

  async cancel(id) {
    const job = this.#jobs.get(id);
    if (!job) return null;
    if (TERMINAL.has(job.state)) return this.public(job);
    const qi = this.#queue.findIndex(q => q.job.id === id);
    if (qi >= 0) { this.#queue.splice(qi, 1); await this.#finish(job, { state: 'cancelled', error: 'cancelled while queued' }); return this.public(job); }
    if (this.#inlinePending === job) { this.#inlinePending = null; await this.#finish(job, { state: 'cancelled', error: 'cancelled while queued' }); return this.public(job); }
    job.cancelRequested = true;
    const child = this.#children.get(id);
    if (child) {
      killTree(child.pid, 'SIGTERM');
      setTimeout(() => { if (this.#children.has(id)) killTree(child.pid, 'SIGKILL'); }, 10_000).unref();
    }
    await this.#save(job);
    return this.public(job);
  }

  stopAll(reason) {
    for (const q of this.#queue.splice(0)) this.#finish(q.job, { state: 'cancelled', error: reason }).catch(error => this.log(`finish ${q.job.id}: ${error.message}`));
    if (this.#inlinePending) { const j = this.#inlinePending; this.#inlinePending = null; this.#finish(j, { state: 'cancelled', error: reason }).catch(() => {}); }
    for (const id of this.#children.keys()) this.cancel(id).catch(error => this.log(`cancel ${id}: ${error.message}`));
  }

  async shutdown() {
    this.stopAll('daemon shutting down');
    const deadline = Date.now() + 12_000;
    while (this.#children.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  }

  public(job) {
    const { cancelRequested, pid, finishing, ...rest } = job;
    return { ...rest, cancelRequested: !!cancelRequested };
  }
  summary(j) { return { id: j.id, kind: j.kind, class: j.class, state: j.state, createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt, exitCode: j.exitCode, name: j.params?.name ?? null, port: j.params?.port ?? null }; }

  // ---- internals ----
  async #save(job) {
    const file = path.join(this.jobsDir, `${job.id}.json`);
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(job, null, 2));
    await fsp.rename(tmp, file);
  }

  // F3: refuse new work while the workdir's disk is nearly full (uploads are checked by the daemon)
  async #checkDisk() {
    const minBytes = this.cfg.limits.minFreeMiB * 2 ** 20;
    if (!minBytes) return;
    const d = await this.diskFree(this.workdirReal);
    if (d.freeBytes !== null && d.freeBytes !== undefined && d.freeBytes < minBytes) throw new JobError(507, 'insufficient_storage', `only ${Math.floor(d.freeBytes / 2 ** 20)} MiB free in the workdir (limit ${this.cfg.limits.minFreeMiB} MiB); free some space on the laptop`);
  }

  // F3: keep at most limits.maxJobRecords finished records (and their logs). Records of successful
  // kev.train jobs are kept: they are the provenance that lets runs/<jobId> be loaded again.
  async #prune() {
    const max = this.cfg.limits.maxJobRecords;
    const done = [...this.#jobs.values()].filter(j => TERMINAL.has(j.state) && !(j.kind === 'kev.train' && j.state === 'succeeded'));
    if (done.length <= max) return;
    done.sort((a, b) => String(a.endedAt ?? a.createdAt).localeCompare(String(b.endedAt ?? b.createdAt)));
    for (const j of done.slice(0, done.length - max)) {
      this.#jobs.delete(j.id);
      await fsp.rm(path.join(this.jobsDir, `${j.id}.json`), { force: true }).catch(() => {});
      await fsp.rm(path.join(this.logsDir, `${j.id}.log`), { force: true }).catch(() => {});
    }
  }

  async #checkService(kind, job) {
    const live = [...this.#jobs.values()].filter(j => j.class === 'service' && !TERMINAL.has(j.state));
    if (kind === 'kev.serve' && live.some(j => j.kind === 'kev.serve')) throw new JobError(409, 'service_exists', 'a kev.serve service is already running; stop it first');
    if (kind === 'llama.serve') {
      if (live.some(j => j.kind === 'llama.serve' && j.params.name === job.params.name)) throw new JobError(409, 'service_exists', `llama service ${job.params.name} already exists`);
      if (live.filter(j => j.kind === 'llama.serve').length >= this.cfg.maxLlamaServices) throw new JobError(409, 'too_many_services', `at most ${this.cfg.maxLlamaServices} llama services`);
    }
    if (live.some(j => j.params.port === job.params.port) || !(await portFree(job.params.port))) throw new JobError(409, 'port_busy', `port ${job.params.port} is in use`);
  }

  #pump() {
    if (this.#running || this.#killed) return;
    const next = this.#queue.shift();
    if (!next) return;
    this.#running = next.job;
    this.#start(next.job, next.built).catch(error => this.log(`job ${next.job.id} start failed: ${error.message}`));
  }

  // Stops a running job for a reason of the daemon's (timeout, log too large, not ready): it ends failed.
  #abort(job, child, reason) {
    if (job.killedFor) return;
    job.killedFor = reason;
    killTree(child.pid, 'SIGTERM');
    setTimeout(() => { if (this.#children.has(job.id)) killTree(child.pid, 'SIGKILL'); }, 10_000).unref();
  }

  async #start(job, built) {
    const logFile = path.join(this.logsDir, `${job.id}.log`);
    const fd = fs.openSync(logFile, 'a');
    const shown = [built.cmd, ...built.args].map(a => (a.includes('\n') || a.length > 200) ? `<inline code, ${a.length} chars>` : a)
      .map(a => a.split(this.workdirReal).join('$WORKDIR').split(os.homedir()).join('~')).join(' ');
    fs.writeSync(fd, `[bridge ${new Date(this.now()).toISOString()}] start ${job.kind} ${job.id}: ${shown}\n`);
    let child;
    try {
      child = spawn(built.cmd, built.args, { cwd: built.cwd, env: jobEnv(this.cfg), stdio: ['ignore', fd, fd], detached: !IS_WIN, windowsHide: true, shell: false });
    } catch (error) {
      fs.closeSync(fd);
      await this.#finish(job, { state: 'failed', error: `spawn failed: ${error.message}` });
      return;
    }
    fs.closeSync(fd);
    job.state = job.class === 'service' ? 'starting' : 'running';
    job.startedAt = new Date(this.now()).toISOString(); job.pid = child.pid;
    this.#children.set(job.id, child);
    await this.#save(job);
    let done = false;
    const onEnd = async (code, signal, err) => {
      if (done) return; done = true;
      clearTimeout(timer); clearInterval(watchLog);
      this.#children.delete(job.id);
      const state = job.killedFor ? 'failed'
        : job.cancelRequested ? (job.class === 'service' ? 'stopped' : 'cancelled')
        : code === 0 && job.class !== 'service' ? 'succeeded' : 'failed';
      const error = err ? `spawn error: ${err.code ?? err.message}` : job.killedFor ? job.killedFor : state === 'failed' ? (job.class === 'service' ? `service exited (code ${code}, signal ${signal})` : `exit code ${code}${signal ? `, signal ${signal}` : ''}`) : null;
      try { await this.#finish(job, { state, exitCode: code ?? null, signal: signal ?? null, error }); }
      catch (e) { this.log(`job ${job.id}: could not record its end: ${e.message}`); }
    };
    child.on('error', err => onEnd(null, null, err));
    child.on('exit', (code, signal) => onEnd(code, signal, null));
    const limit = this.#timeoutFor(job);
    const timer = limit ? setTimeout(() => this.#abort(job, child, `timed out after ${limit} s`), limit * 1000) : null;
    timer?.unref?.();
    // F3: a job's log may not grow past limits.jobLogBytes
    const maxLog = this.cfg.limits.jobLogBytes;
    const watchLog = setInterval(() => {
      let size = 0; try { size = fs.statSync(logFile).size; } catch {}
      if (size > maxLog) this.#abort(job, child, `log grew past ${maxLog} bytes (limits.jobLogBytes)`);
    }, this.logWatchMs);
    watchLog.unref?.();
    if (job.class === 'service') { this.onServicesChange(); this.#watchReady(job, built.probe, child).catch(error => this.log(`service ${job.id} readiness: ${error.message}`)); }
  }

  #timeoutFor(job) { return job.class === 'service' ? 0 : this.cfg.timeouts[job.kind] ?? 0; }

  async #watchReady(job, route, child) {
    const deadline = Date.now() + this.cfg.serviceStartSeconds * 1000;
    while (job.state === 'starting' && this.#children.has(job.id)) {
      const status = await probe(job.params.port, route);
      if (status === 200 && job.state === 'starting') {
        job.state = 'running'; job.readyAt = new Date(this.now()).toISOString();
        await this.#save(job); this.onServicesChange();
        this.log(`service ${job.kind} ${job.id} ready on 127.0.0.1:${job.params.port}`);
        return;
      }
      if (Date.now() > deadline) { this.#abort(job, child, 'service did not become ready in time'); return; }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  async #finish(job, { state, exitCode = null, signal = null, error = null }) {
    if (TERMINAL.has(job.state) || job.finishing) return;
    job.finishing = true;
    const wasService = job.class === 'service';
    const endedAt = new Date(this.now()).toISOString();
    const logFile = path.join(this.logsDir, `${job.id}.log`);
    const err = error ?? job.error ?? null;
    // the end line is written before the state turns terminal, so a log reader that sees `done` has it
    try { fs.appendFileSync(logFile, `[bridge ${endedAt}] end ${state}${exitCode !== null ? ` exit=${exitCode}` : ''}${signal ? ` signal=${signal}` : ''}${err ? ` (${err})` : ''}\n`); } catch {}
    try {
      const tail = readLogChunk(logFile, Math.max(0, (fs.existsSync(logFile) ? fs.statSync(logFile).size : 0) - 65536), 65536).data;
      const lines = tail.split('\n').filter(l => l.startsWith('FOUNDRY_RESULT '));
      if (lines.length) job.result = JSON.parse(lines[lines.length - 1].slice('FOUNDRY_RESULT '.length));
    } catch {}
    if (job.outputDir) {
      const abs = path.join(this.workdirReal, job.outputDir);
      job.outputs = fs.existsSync(abs) ? await listOutputs(abs, job.outputDir) : { dir: job.outputDir, files: [], truncated: false };
    }
    // F1 provenance: the head.pt this job wrote, so runs/<jobId> can be loaded later and only unchanged
    if (job.kind === 'kev.train' && state === 'succeeded') {
      const head = path.join(this.workdirReal, 'runs', job.id, 'head.pt');
      try { if ((await fsp.lstat(head)).isFile()) job.checkpoint = { dir: `runs/${job.id}`, headSha256: await hashFile(head) }; } catch {}
    }
    job.exitCode = exitCode; job.signal = signal; job.error = err; job.endedAt = endedAt;
    job.state = state; delete job.finishing;
    await this.#save(job);
    if (this.#running === job) { this.#running = null; setImmediate(() => this.#pump()); }
    if (wasService) this.onServicesChange();
    this.log(`job ${job.kind} ${job.id} -> ${job.state}${job.error ? ` (${job.error})` : ''}`);
    await this.#prune().catch(e => this.log(`pruning job records: ${e.message}`));
  }

  // git.refresh: one runs at a time and at most one waits (F4); the refresh itself is serialized with
  // the publisher by the daemon and the mailbox lock.
  async #runInline(job) {
    this.#inlineRunning = job;
    try {
      job.state = 'running'; job.startedAt = new Date(this.now()).toISOString();
      await this.#save(job);
      try {
        job.result = await this.refresh();
        await this.#finish(job, { state: 'succeeded' });
      } catch (error) {
        await this.#finish(job, { state: 'failed', error: error.message });
      }
    } catch (error) {
      this.log(`inline job ${job.id}: ${error.message}`);
    } finally {
      this.#inlineRunning = null;
      const next = this.#inlinePending; this.#inlinePending = null;
      if (next && !TERMINAL.has(next.state)) this.#runInline(next);
    }
  }
}
