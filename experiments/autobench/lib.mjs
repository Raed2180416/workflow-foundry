// Host-side helpers for the AutomationBench bridge (experiments/autobench): bridge processes, task selection, the
// agent prompt and a scripted (no-model) runner. See bridge.py for what the bridge does and does not change.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
export const CORPUS = path.join(REPO, 'corpus/AutomationBench');
export const VENV_PY = path.join(CORPUS, '.venv/bin/python');
export const BRIDGE = path.join(HERE, 'bridge.py');
export const TOOL_CLIENT = path.join(HERE, 'tool.mjs');
export const PUBLIC_DOMAINS = Object.freeze(['sales', 'marketing', 'operations', 'support', 'finance', 'hr']);
export const PROTO = '@@bridge ';

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
export function writeJson(p, obj, indent = 1) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, indent) + '\n'); }

/** The bridge's environment: no host credentials and no network configuration reach AutomationBench's code. */
export function bridgeEnv(liveDir) {
  const keep = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
  const env = Object.fromEntries(keep.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
  return { ...env, HOME: path.join(liveDir, 'home'), HF_HOME: path.join(liveDir, 'hf'), HF_DATASETS_OFFLINE: '1', HF_HUB_OFFLINE: '1', TQDM_DISABLE: '1' };
}

function parseProto(text) {
  return text.split('\n').filter(l => l.startsWith(PROTO)).map(l => { try { return JSON.parse(l.slice(PROTO.length)); } catch { return null; } }).filter(Boolean);
}

/** Run one bridge command to completion (python -I, from a neutral directory). Returns { code, stdout, stderr, proto }. */
export function runBridge(args, { liveDir, timeoutMs = 20 * 60_000 } = {}) {
  if (!existsSync(VENV_PY)) throw new Error(`AutomationBench venv missing: run uv sync inside ${CORPUS}`);
  mkdirSync(liveDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const c = spawn(VENV_PY, ['-I', BRIDGE, ...args], { cwd: liveDir, env: bridgeEnv(liveDir), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.stdout.on('data', d => { stdout += d; });
    c.stderr.on('data', d => { if (stderr.length < 200_000) stderr += d; });
    c.on('error', reject);
    c.on('close', code => { clearTimeout(t); resolve({ code, stdout, stderr, proto: parseProto(stdout) }); });
  });
}

export async function bridgeJson(args, opts) {
  const r = await runBridge(args, opts);
  const err = r.proto.find(p => p.kind === 'error');
  if (r.code !== 0 || err) throw new Error(`bridge ${args[0]} failed (${r.code}): ${err?.error ?? r.stderr.slice(-1500)}`);
  const line = r.stdout.split('\n').filter(l => l.trim().startsWith('{')).pop();
  return line ? JSON.parse(line) : null;
}

/** All task names with domain (bridge.py list). */
export async function listTasks(domains, { liveDir }) {
  const r = await runBridge(['list', '--domains', domains.join(',')], { liveDir });
  if (r.code !== 0) throw new Error(`bridge list failed: ${r.stderr.slice(-1500)}`);
  return r.stdout.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
}

// Deterministic PRNG (mulberry32) for the stratified subset.
function rng(seedStr) {
  let a = parseInt(sha256(String(seedStr)).slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** n tasks stratified over domains (equal shares, the remainder to the first domains in the given order), seeded. */
export function stratifiedSubset(tasks, n, seed, domains) {
  const by = new Map(domains.map(d => [d, tasks.filter(t => t.domain === d).map(t => t.task).sort()]));
  const quota = new Map(domains.map((d, i) => [d, Math.floor(n / domains.length) + (i < n % domains.length ? 1 : 0)]));
  const out = [];
  for (const d of domains) {
    const pool = by.get(d) ?? [], r = rng(`${seed}:${d}`);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    out.push(...pool.slice(0, quota.get(d)));
  }
  return out;
}

/** The harness text appended to the official system prompt: how the official tools are reached here. */
// AM-9 (PREREG-AB-v1): Claude Code injects the host date into every session; the official eval gives no date. With
// dateNote the shared tool section says so (both arms), the closest the CLI allows to the official 'no date'. Off by default,
// so a run started before AM-9 keeps its exact text.
export const DATE_NOTE = "The date shown in your session context belongs to the machine running you, not to this task; take dates from the request and the task's own records.";
export function adapterText(catalog, maxSteps, { dateNote = false } = {}) {
  return `## Tools in this environment
Your tools are not native function calls here. Call them from Bash with the client in your working directory:
  node tool.mjs call <tool_name> '<arguments as a JSON object>'
  node tool.mjs batch '[{"name": "<tool_name>", "arguments": {...}}, ...]'
\`batch\` runs several calls in one step, in order: use it where you would make parallel tool calls. Arguments can also be given as @file.json or - (stdin, e.g. from a heredoc) when shell quoting is awkward. \`node tool.mjs list\` prints the tool definitions again. Each \`call\` or \`batch\` invocation is one step; the environment runs at most ${maxSteps - 1} steps. The printed output is exactly what the tool returned. When the work is done, stop.${dateNote ? ` ${DATE_NOTE}` : ''}

The tools (name, description, JSON parameters):
${JSON.stringify(catalog, null, 1)}`;
}

/** Copy the agent-side files into a fresh workdir: the client and the tool definitions. Nothing else. */
export function materializeWorkdir(workdir, catalog) {
  mkdirSync(path.join(workdir, '.tools'), { recursive: true });
  cpSync(TOOL_CLIENT, path.join(workdir, 'tool.mjs'));
  writeFileSync(path.join(workdir, 'tools.json'), JSON.stringify(catalog, null, 1));
}

/** Start `bridge.py serve` for one rollout; resolves once the env's setup_state ran. stop() ends the rollout and
 * resolves with the bridge's final protocol line after grading (host-only files are then in hostDir). */
export function startServe({ liveDir, input, world = null, mailbox, hostDir, det = 'record', maxSteps = 50, fork = 0, expectContract = null, readyTimeoutMs = 120_000 }) {
  const args = ['-I', BRIDGE, 'serve', '--input', input, '--mailbox', mailbox, '--host', hostDir, '--det', det, '--max-steps', String(maxSteps), '--fork', String(fork)];
  if (world) args.push('--world', world);
  if (expectContract) args.push('--expect-contract', expectContract);
  mkdirSync(hostDir, { recursive: true });
  const c = spawn(VENV_PY, args, { cwd: liveDir, env: bridgeEnv(liveDir), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const lines = [];
  const waiters = [];
  c.stdout.on('data', d => {
    stdout += d;
    let i;
    while ((i = stdout.indexOf('\n')) >= 0) {
      const l = stdout.slice(0, i); stdout = stdout.slice(i + 1);
      if (l.startsWith(PROTO)) { try { const m = JSON.parse(l.slice(PROTO.length)); lines.push(m); waiters.forEach(w => w()); } catch {} }
    }
  });
  c.stderr.on('data', d => { if (stderr.length < 100_000) stderr += d; });
  c.stdin.on('error', () => {});
  const exited = new Promise(res => c.on('close', code => { waiters.forEach(w => w()); res(code); }));
  let closed = false;
  exited.then(() => { closed = true; });
  const waitFor = (kind, ms) => new Promise((resolve, reject) => {
    const check = () => {
      const m = lines.find(x => x.kind === kind || x.kind === 'error');
      if (m) return m.kind === 'error' ? reject(new Error(`bridge: ${m.error}`)) : resolve(m);
      if (closed) return reject(new Error(`bridge exited before '${kind}': ${stderr.slice(-1500)}`));
    };
    waiters.push(check);
    check();
    setTimeout(() => reject(new Error(`bridge: no '${kind}' within ${ms} ms`)), ms).unref();
  });
  const ready = waitFor('ready', readyTimeoutMs);
  return {
    ready,
    pid: c.pid,
    async stop(ms = 300_000) {
      if (!closed) c.stdin.end('stop\n');
      const done = await waitFor('done', ms);
      await exited;
      return done;
    },
    kill() { try { c.kill('SIGKILL'); } catch {} },
    stderr: () => stderr,
  };
}

/** A scripted session (no model): runs each step as `node tool.mjs batch @step.json` in the workdir, exactly as an
 * agent's Bash tool would. stepsFor({task, fork}) -> [{calls: [{name, arguments}]}...]. */
export function scriptedRunner(stepsFor) {
  return async ({ workdir, task }) => {
    const t0 = Date.now();
    const steps = stepsFor(task) ?? [];
    const outputs = [];
    for (const [i, step] of steps.entries()) {
      if (!step.calls?.length) continue;
      const f = path.join(workdir, `.step-${i}.json`);
      writeFileSync(f, JSON.stringify(step.calls));
      const r = await new Promise(res => {
        const c = spawn(process.execPath, ['tool.mjs', 'batch', `@${f}`], { cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'] });
        let o = '', e = '';
        c.stdout.on('data', d => { o += d; }); c.stderr.on('data', d => { e += d; });
        c.on('close', code => res({ code, stdout: o, stderr: e }));
      });
      outputs.push(r);
    }
    return { ok: true, error: null, costUsd: 0, costUnknown: false, costUpperUsd: 0, turns: outputs.length, durationMs: Date.now() - t0, toolUses: [], outputs, label: 'scripted' };
  };
}
