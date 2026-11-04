// DUR-1 contract sandbox (review R2-B5). A C-O contract patch is model-written code (an edited copy of
// experiments/compose/capabilities.mjs; a verifier-blind session writes it from complaint texts, which can carry the ADV
// injection). It never runs in the harness process, which holds the world, the oracle, the gate, the spend ledger, the
// freezes and the sealed bundle: each patched module is evaluated in its own child process (contract-worker.mjs) under
// Node's permission model, reading only the code it imports (experiments/, beds/ebed/, beds/lib/, src/), its own readings
// directory and the transition item's directory; no writes, no child processes, no workers, no native addons; an EMPTY
// environment (no credentials). A call that errors or exceeds its time limit is a ContractModuleError: the module is not
// trusted further (certification and verifier-blind acceptance treat it as a failed update).
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ROOT } from './changes.mjs';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'contract-worker.mjs');
export const READ_ROOTS = Object.freeze(['experiments', 'beds/ebed', 'beds/lib', 'src'].map(d => path.join(ROOT, d)));
export const CALL_TIMEOUT_MS = 180_000;
const MAX_WORLDS = 6;

export class ContractModuleError extends Error { constructor(m) { super(`DUR1_CONTRACT_MODULE: ${m}`); this.code = 'DUR1_CONTRACT_MODULE'; } }

class Child {
  constructor(moduleFile, itemFile) {
    const allow = [...READ_ROOTS, path.dirname(moduleFile), ...(itemFile ? [path.dirname(itemFile)] : [])];
    this.p = spawn(process.execPath, ['--permission', ...allow.map(a => `--allow-fs-read=${a}`), WORKER, moduleFile, itemFile ?? ''], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = new Map(); this.worlds = []; this.n = 0; this.err = ''; this.dead = false;
    createInterface({ input: this.p.stdout, crlfDelay: Infinity }).on('line', line => {
      let r; try { r = JSON.parse(line); } catch { return; }
      const w = this.pending.get(r.id); if (!w) return;
      this.pending.delete(r.id); clearTimeout(w.timer); w.resolve(r); this.idle();
    });
    this.p.stderr.on('data', d => { if (this.err.length < 4000) this.err += String(d); });
    this.p.on('exit', code => { this.dead = true; for (const w of this.pending.values()) { clearTimeout(w.timer); w.reject(new ContractModuleError(`the worker exited (${code}): ${this.err.slice(0, 400)}`)); } this.pending.clear(); });
    this.p.on('error', e => { this.dead = true; for (const w of this.pending.values()) { clearTimeout(w.timer); w.reject(new ContractModuleError(String(e?.message ?? e))); } this.pending.clear(); });
    this.idle();
  }
  // The child never keeps the harness alive while idle.
  idle() { if (this.pending.size) return; for (const s of [this.p, this.p.stdin, this.p.stdout, this.p.stderr]) s?.unref?.(); }
  busy() { for (const s of [this.p, this.p.stdin, this.p.stdout, this.p.stderr]) s?.ref?.(); }
  call(msg, timeoutMs = CALL_TIMEOUT_MS) {
    if (this.dead) return Promise.reject(new ContractModuleError(`the worker is gone: ${this.err.slice(0, 400)}`));
    const id = ++this.n;
    this.busy();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.kill(); reject(new ContractModuleError(`no answer within ${timeoutMs / 1000} s`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.p.stdin.write(JSON.stringify({ ...msg, id }) + '\n');
    });
  }
  async ensureWorld(key, W) {
    if (this.worlds.includes(key)) { this.worlds = [...this.worlds.filter(k => k !== key), key]; return; }
    while (this.worlds.length >= MAX_WORLDS) { const old = this.worlds.shift(); await this.call({ op: 'drop', key: old }); }
    const r = await this.call({ op: 'world', key, W });
    if (!r.ok) throw new ContractModuleError(r.error);
    this.worlds.push(key);
  }
  kill() { this.dead = true; try { this.p.kill('SIGKILL'); } catch { /* gone */ } }
}

const children = new Map();
/**
 * evaluateSandboxed({ module, itemFile, worldKey, W, cases, rows, pools, rules }) → the module's case verdicts (as
 * evaluateCapabilities' `cases`), computed out of process.
 */
export async function evaluateSandboxed({ module, itemFile = null, worldKey, W, cases, rows, pools, rules, timeoutMs = CALL_TIMEOUT_MS }) {
  const key = `${module}|${itemFile ?? ''}`;
  let c = children.get(key);
  if (!c || c.dead) { c = new Child(module, itemFile); children.set(key, c); }
  await c.ensureWorld(worldKey, W);
  const r = await c.call({ op: 'eval', key: worldKey, cases, rows, pools, rules }, timeoutMs);
  if (!r.ok) throw new ContractModuleError(r.error);
  return r.cases;
}
export function closeSandboxes() { for (const c of children.values()) c.kill(); children.clear(); }
