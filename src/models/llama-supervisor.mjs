// On-demand llama-server processes for local policy models (DESIGN §2). A server is started
// only when its port is not already healthy, runs detached in its own process group with a
// scoped environment, and is stopped by the supervisor that started it (or that adopted it
// through its pid file after a crash); any other server is never touched. Started servers are
// also stopped on process exit unless stopOnExit is false.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FoundryError } from '../data.mjs';
import { runProcess } from '../process.mjs';
import { isPolicyModel } from './policy.mjs';

export const DEFAULT_LLAMA_BINARY = '/opt/llamacpp/build/bin/llama-server';
export const DEFAULT_MODELS_DIR = '/opt/models';
const versions = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tail = file => { try { return readFileSync(file, 'utf8').slice(-2000); } catch { return ''; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const supervised = new Set();
let exitHooked = false;
const hookExit = () => {
  if (exitHooked) return; exitHooked = true;
  process.once('exit', () => { for (const s of supervised) for (const { pid } of s.started.values()) try { process.kill(-pid, 'SIGTERM'); } catch {} });
};

async function getJson(url, timeoutMs = 2000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  const text = await response.text();
  let body = null; try { body = JSON.parse(text); } catch {}
  return { status: response.status, body };
}

export class LlamaSupervisor {
  constructor({ policy, binary = DEFAULT_LLAMA_BINARY, modelsDir = DEFAULT_MODELS_DIR, host = '127.0.0.1', ctx = 8192, threads = 4, parallel = 1,
    startTimeoutMs = 120000, logDir = tmpdir(), stopOnExit = true, extraArgs = [] } = {}) {
    if (!policy?.models) throw new FoundryError('MODEL_POLICY_INVALID', 'LlamaSupervisor requires the model policy');
    if (host !== '127.0.0.1' && host !== 'localhost') throw new FoundryError('MODEL_REQUEST', 'Local model servers bind to loopback only');
    Object.assign(this, { policy, binary, modelsDir, host, ctx, threads, parallel, startTimeoutMs, logDir, stopOnExit, extraArgs: [...extraArgs] });
    this.started = new Map(); this.pending = new Map();
  }

  pidFile(entry) { return path.join(this.logDir, `foundry-llama-${entry.port}.pid`); }
  #track(port, record) {
    this.started.set(port, record);
    if (this.stopOnExit) { supervised.add(this); hookExit(); }
  }
  // Re-own a server this binary started earlier (e.g. before a crash) so it can still be stopped.
  #adopt(entry) {
    if (this.started.has(entry.port)) return false;
    try {
      const pid = Number(readFileSync(this.pidFile(entry), 'utf8').trim());
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      if (!Number.isSafeInteger(pid) || !alive(pid) || !argv.slice(0, 2).includes(this.binary) || argv[argv.indexOf('--port') + 1] !== String(entry.port)) return false;
      this.#track(entry.port, { pid, adopted: true, modelId: entry.id });
      return true;
    } catch { return false; }
  }

  baseUrl(entry) { return `http://${this.host}:${entry.port}`; }
  weightsPath(entry) { return path.join(this.modelsDir, entry.weights.file); }

  async engineVersion() {
    if (!versions.has(this.binary)) {
      const probe = runProcess(this.binary, ['--version'], { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' }, timeoutMs: 20000, maxBytes: 64 * 1024 })
        .then(r => { const line = `${r.stdout}\n${r.stderr}`.match(/version:\s*(.+)/)?.[1]?.trim(); if (!line) throw new FoundryError('MODEL_UNAVAILABLE', 'llama-server --version printed no version'); return `llama-server ${line}`; });
      versions.set(this.binary, probe);
      probe.catch(() => versions.delete(this.binary));
    }
    return versions.get(this.binary);
  }

  async health(entry) {
    try { const r = await getJson(`${this.baseUrl(entry)}/health`); return r.status === 200 && r.body?.status === 'ok'; }
    catch { return false; }
  }

  // A healthy port must be serving this entry's weights, never a different model.
  async #checkServed(entry) {
    let props;
    try { props = await getJson(`${this.baseUrl(entry)}/props`, 5000); } catch (error) { throw new FoundryError('MODEL_UNAVAILABLE', `llama-server /props unavailable on port ${entry.port}: ${error.message}`); }
    const served = props.body?.model_path;
    if (typeof served !== 'string' || path.basename(served) !== entry.weights.file)
      throw new FoundryError('MODEL_UNAVAILABLE', `Port ${entry.port} serves ${served ? path.basename(served) : 'an unknown model'}, not ${entry.weights.file}`);
    return { modelPath: served, buildInfo: props.body?.build_info ?? null };
  }

  async ensureServer(entry) {
    if (!entry || !isPolicyModel(this.policy, entry.id) || !entry.port || !entry.weights?.file) throw new FoundryError('MODEL_NOT_IN_POLICY', `Model ${entry?.id} is not a local policy model`);
    if (this.pending.has(entry.port)) return this.pending.get(entry.port);
    const task = this.#ensure(entry).finally(() => this.pending.delete(entry.port));
    this.pending.set(entry.port, task);
    return task;
  }

  async #ensure(entry) {
    if (await this.health(entry)) {
      const served = await this.#checkServed(entry);
      const adopted = this.#adopt(entry);
      return { port: entry.port, pid: this.started.get(entry.port)?.pid ?? null, started: false, adopted, ...served };
    }
    const weights = this.weightsPath(entry);
    if (!existsSync(weights) || !statSync(weights).isFile()) throw new FoundryError('MODEL_UNAVAILABLE', `Weights for ${entry.id} are missing: ${weights}`);
    if (!existsSync(this.binary)) throw new FoundryError('MODEL_UNAVAILABLE', `llama-server binary is missing: ${this.binary}`);
    const log = path.join(this.logDir, `foundry-llama-${entry.port}.log`);
    const fd = openSync(log, 'a', 0o600);
    let child;
    try {
      child = spawn(this.binary, ['-m', weights, '--host', this.host, '--port', String(entry.port), '-c', String(this.ctx), '-t', String(this.threads),
        '-np', String(this.parallel), '--jinja', ...this.extraArgs],
      { detached: true, stdio: ['ignore', fd, fd], env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    } finally { closeSync(fd); }
    let exited = null;
    child.once('exit', (code, signal) => { exited = { code, signal }; if (this.started.get(entry.port)?.child === child) this.started.delete(entry.port); });
    child.once('error', error => { exited = { error: error.message }; if (this.started.get(entry.port)?.child === child) this.started.delete(entry.port); });
    child.unref();
    this.#track(entry.port, { pid: child.pid, child, log, modelId: entry.id });
    try { writeFileSync(this.pidFile(entry), `${child.pid}\n`, { mode: 0o600 }); } catch {}
    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      if (exited) rmSync(this.pidFile(entry), { force: true });
      if (exited) throw new FoundryError('MODEL_UNAVAILABLE', `llama-server for ${entry.id} exited during startup (${JSON.stringify(exited)}): ${tail(log).trim().split('\n').at(-1) ?? ''}`);
      if (await this.health(entry)) return { port: entry.port, pid: child.pid, started: true, log, ...await this.#checkServed(entry) };
      await sleep(250);
    }
    await this.stopServer(entry);
    throw new FoundryError('MODEL_UNAVAILABLE', `llama-server for ${entry.id} was not healthy within ${this.startTimeoutMs} ms`);
  }

  /** Stop a server this supervisor started or adopted. Returns false when it owns none on that port. */
  async stopServer(entry, { graceMs = 10000 } = {}) {
    const record = this.started.get(entry.port);
    if (!record) return false;
    try { process.kill(-record.pid, 'SIGTERM'); } catch {}
    const running = () => record.child ? record.child.exitCode === null && record.child.signalCode === null : alive(record.pid);
    const deadline = Date.now() + graceMs;
    while (running() && Date.now() < deadline) await sleep(100);
    if (running()) { try { process.kill(-record.pid, 'SIGKILL'); } catch {} await sleep(200); }
    this.started.delete(entry.port);
    rmSync(this.pidFile(entry), { force: true });
    return true;
  }

  async stopAll() {
    const ports = [...this.started.keys()];
    for (const port of ports) await this.stopServer({ port });
    supervised.delete(this);
    return ports.length;
  }
}

let shared;
export const defaultSupervisor = policy => (shared && shared.policy === policy ? shared : (shared = new LlamaSupervisor({ policy })));
export const ensureServer = (policy, entry) => defaultSupervisor(policy).ensureServer(entry);
export const stopServer = (policy, entry) => defaultSupervisor(policy).stopServer(entry);
