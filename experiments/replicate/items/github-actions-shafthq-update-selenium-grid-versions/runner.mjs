// Executes a GitHub Actions workflow of the kind this item is about (one job, `run:` steps under bash, two known `uses:` actions)
// against a "world" of recorded fixtures and mocks, and returns what happened (an observation). It is the machinery behind the control
// "the original passes": the vendored original, and broken variants of it, are run here unchanged.
//
// Supported semantics (anything else THROWS, nothing is silently flattened):
//   * one job; steps run in order; a step runs only if no earlier step failed and its `if:` holds (`success()` is implied);
//   * `run:` steps: ${{ }} is substituted BEFORE bash sees the script (as the runner does), then `bash -e script` (the runner's default
//     shell is `bash -e {0}`: errexit, no pipefail) in the workspace, with a minimal environment and $GITHUB_OUTPUT;
//   * $GITHUB_OUTPUT is parsed as the runner does (name=value, name<<DELIM blocks); a line it cannot parse fails the step;
//   * expressions: steps.<id>.outputs.<name>, secrets.GITHUB_TOKEN (a fixed dummy), and `==`/`!=` between those and string literals
//     (case-insensitive, as GitHub compares strings);
//   * `uses: actions/checkout` is a no-op (the workspace already holds the repository); `uses: peter-evans/create-pull-request` is
//     the recording stub in mocks/pull-requests.mjs.
// Hermetic by construction: env -i style environment, PATH = shims + /usr/bin:/bin, curl only reaches the local mock (any other URL
// is blocked and logged), docker is a stub, and where `unshare --mount` works /tmp is a private tmpfs (the original writes
// /tmp/reference-compose.yml, an absolute path, so without it the run leaves a file in the host's /tmp).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './miniyaml.mjs';
import { startReferenceServer } from './mocks/reference-server.mjs';
import { PullRequestStore } from './mocks/pull-requests.mjs';
import { REFERENCE_HOST, REFERENCE_URL } from './spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRATCH = process.env.FOUNDRY_REPLICATE_SCRATCH ?? '/var/tmp/foundry-work/replicate';
export const DUMMY_TOKEN = 'rbench-dummy-token-not-a-credential';
const STEP_TIMEOUT_MS = 30000;

export class Unsupported extends Error { constructor(message) { super(message); this.name = 'Unsupported'; this.code = 'UNSUPPORTED'; } }

// ---------- expressions -------------------------------------------------------------------------------------------------
function operand(src, ctx) {
  const s = src.trim();
  let m;
  if ((m = /^'((?:[^']|'')*)'$/.exec(s))) return m[1].replaceAll("''", "'");
  if ((m = /^steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)$/.exec(s))) return ctx.steps[m[1]]?.outputs?.[m[2]] ?? '';
  if (s === 'secrets.GITHUB_TOKEN') return DUMMY_TOKEN;
  throw new Unsupported(`expression operand "${s}"`);
}
/** `${{ ... }}` substitution inside a string. Only context lookups are supported. */
export function interpolate(text, ctx) {
  return text.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expr) => String(operand(expr, ctx)));
}
/** An `if:` condition: `success()`, or `A == B` / `A != B`. */
export function evalCondition(src, ctx) {
  const s = String(src).trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1').trim();
  if (s === 'success()') return true;
  const m = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(s);
  if (!m) throw new Unsupported(`condition "${s}"`);
  const same = String(operand(m[1], ctx)).toLowerCase() === String(operand(m[3], ctx)).toLowerCase();
  return m[2] === '==' ? same : !same;
}

// ---------- $GITHUB_OUTPUT -----------------------------------------------------------------------------------------------
export class FileCommandError extends Error { constructor(line) { super(`Unable to process file command 'output' successfully.\nInvalid format '${line}'`); this.name = 'FileCommandError'; } }
/** name=value lines and name<<DELIM ... DELIM blocks; blank lines are skipped; anything else is an error (as in the runner). */
export function parseOutputFile(text) {
  const out = {}, lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    const eq = line.indexOf('='), heredoc = line.indexOf('<<');
    if (heredoc > 0 && (eq < 0 || heredoc < eq)) {
      const name = line.slice(0, heredoc), delimiter = line.slice(heredoc + 2), value = [];
      if (!delimiter) throw new FileCommandError(line);
      let closed = false;
      for (i++; i < lines.length; i++) { if (lines[i] === delimiter) { closed = true; break; } value.push(lines[i]); }
      if (!closed) throw new FileCommandError(line);
      out[name] = value.join('\n');
    } else if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
    else throw new FileCommandError(line);
  }
  return out;
}

// ---------- workflow ------------------------------------------------------------------------------------------------------
const STEP_KEYS = new Set(['name', 'id', 'uses', 'with', 'run', 'if']);
const ALLOWED_USES = [/^actions\/checkout@/, /^peter-evans\/create-pull-request@/];
export function parseWorkflow(text) {
  const doc = parseYaml(text);
  if (!doc || typeof doc !== 'object') throw new Unsupported('workflow is not a mapping');
  for (const key of Object.keys(doc)) if (!['name', 'on', 'permissions', 'jobs'].includes(key)) throw new Unsupported(`workflow key "${key}"`);
  const jobs = Object.entries(doc.jobs ?? {});
  if (jobs.length !== 1) throw new Unsupported(`${jobs.length} jobs (exactly one is supported)`);
  const [jobId, job] = jobs[0];
  for (const key of Object.keys(job)) if (!['runs-on', 'steps'].includes(key)) throw new Unsupported(`job key "${key}"`);
  if (!Array.isArray(job.steps) || !job.steps.length) throw new Unsupported('job without steps');
  const ids = new Set();
  const steps = job.steps.map((s, index) => {
    for (const key of Object.keys(s)) if (!STEP_KEYS.has(key)) throw new Unsupported(`step key "${key}" (step ${index + 1})`);
    if (!!s.run === !!s.uses) throw new Unsupported(`step ${index + 1} must have exactly one of run / uses`);
    if (s.uses && !ALLOWED_USES.some(re => re.test(s.uses))) throw new Unsupported(`action ${s.uses}`);
    if (s.id) { if (ids.has(s.id)) throw new Unsupported(`duplicate step id ${s.id}`); ids.add(s.id); }
    return { index, id: s.id ?? null, name: s.name ?? s.id ?? `step ${index + 1}`, run: s.run ?? null, uses: s.uses ?? null, with: s.with ?? {}, if: s.if ?? null };
  });
  return { name: doc.name ?? null, jobId, steps };
}

// ---------- host probes ---------------------------------------------------------------------------------------------------
const which = (name, dirs = (process.env.PATH ?? '/usr/bin:/bin').split(':')) => dirs.map(d => path.join(d, name)).find(p => existsSync(p));
export const hostTools = () => ({ bash: which('bash', ['/usr/bin', '/bin']), curl: which('curl'), unshare: which('unshare', ['/usr/bin', '/bin']), node: process.execPath });
let isolationProbe = null;
/** 'mount-ns' if `unshare --mount` can give a step a private /tmp here, else 'none'. */
export function isolation() {
  if (isolationProbe) return isolationProbe;
  const { unshare, bash } = hostTools();
  if (!unshare || !bash) return (isolationProbe = 'none');
  const r = spawnSync(unshare, ['--mount', '--propagation', 'private', '--', '/bin/sh', '-c', 'mount -t tmpfs tmpfs /tmp && test -z "$(ls -A /tmp)"'], { encoding: 'utf8', timeout: 10000 });
  return (isolationProbe = r.status === 0 ? 'mount-ns' : 'none');
}

function readTree(dir, rel = '', out = {}) {
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name, abs = path.join(dir, r);
    if (statSync(abs).isDirectory()) readTree(dir, r, out); else out[r] = readFileSync(abs, 'utf8');
  }
  return out;
}
function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) { const abs = path.join(dir, rel); mkdirSync(path.dirname(abs), { recursive: true }); writeFileSync(abs, text); }
}
const tail = (text, n = 10) => text.split('\n').filter(l => l.trim() !== '').slice(-n).join('\n');

function runBash({ script, cwd, env, tools, mode }) {
  return new Promise(resolve => {
    const argv = mode === 'mount-ns'
      ? [tools.unshare, '--mount', '--propagation', 'private', '--', '/bin/sh', '-c', 'mount -t tmpfs tmpfs /tmp && exec "$@"', 'sh', tools.bash, '-e', script]
      : [tools.bash, '-e', script];
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, STEP_TIMEOUT_MS);
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : (code ?? 128), signal, output, timedOut }); });
    child.on('error', error => { clearTimeout(timer); resolve({ code: 127, output: String(error.message), timedOut: false }); });
  });
}

const parseJsonl = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const parseCurlLog = file => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { const [verdict, url] = l.split('\t'); return { verdict, url }; }) : []);

/**
 * Run `workflowText` against a world: {repo: {path: text}, http: {status, body} | {error}, openPullRequests: [...]}.
 * Returns the observation. `keep` leaves the run directory in place (for debugging).
 */
export async function runWorkflow({ workflowText, world, keep = false }) {
  const workflow = parseWorkflow(workflowText);
  const tools = hostTools();
  for (const t of ['bash', 'curl']) if (!tools[t]) throw new Unsupported(`host tool ${t} not found`);
  const mode = isolation();
  mkdirSync(SCRATCH, { recursive: true });
  const run = mkdtempSync(path.join(SCRATCH, 'run-'));
  const workspace = path.join(run, 'workspace'), out = path.join(run, 'out'), home = path.join(run, 'home');
  for (const d of [workspace, out, home]) mkdirSync(d, { recursive: true });
  writeTree(workspace, world.repo);
  const server = await startReferenceServer({ response: world.http });
  const store = new PullRequestStore({ base: world.repo, openPullRequests: world.openPullRequests ?? [] });
  const ctx = { steps: {} };
  const baseEnv = {
    PATH: `${path.join(HERE, 'mocks', 'bin')}:/usr/bin:/bin`, HOME: home, LANG: 'C.UTF-8', CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: workspace,
    RBENCH_OUT: out, RBENCH_PORT: String(server.port), RBENCH_REFERENCE_URL: REFERENCE_URL, RBENCH_REFERENCE_HOST: REFERENCE_HOST,
    RBENCH_NODE: tools.node, RBENCH_MOCKS: path.join(HERE, 'mocks'), RBENCH_CURL: tools.curl,
  };
  const steps = [];
  let failed = null;
  const started = performance.now();
  try {
    for (const step of workflow.steps) {
      const rec = { index: step.index, id: step.id, name: step.name, kind: step.run ? 'run' : 'uses', status: 'skipped', exitCode: null, output: '', outputs: {}, ms: 0 };
      steps.push(rec);
      if (failed) continue;                                   // implicit success() on every step
      if (step.if && !evalCondition(step.if, ctx)) continue;
      const t0 = performance.now();
      try {
        if (step.run) {
          const scriptFile = path.join(out, `step-${step.index + 1}.sh`), outputFile = path.join(out, `output-${step.index + 1}`);
          writeFileSync(scriptFile, interpolate(step.run, ctx));
          writeFileSync(outputFile, '');
          const r = await runBash({ script: scriptFile, cwd: workspace, env: { ...baseEnv, GITHUB_OUTPUT: outputFile }, tools, mode });
          rec.exitCode = r.code; rec.output = r.output;
          if (r.timedOut) { rec.status = 'failure'; rec.output += `\n[rbench] step killed after ${STEP_TIMEOUT_MS} ms`; }
          else if (r.code !== 0) rec.status = 'failure';
          else {
            try { rec.outputs = parseOutputFile(readFileSync(outputFile, 'utf8')); rec.status = 'success'; }
            catch (error) { if (!(error instanceof FileCommandError)) throw error; rec.status = 'failure'; rec.output += `\n${error.message}`; }
          }
        } else if (/^actions\/checkout@/.test(step.uses)) {
          if (Object.keys(step.with).length) throw new Unsupported('actions/checkout inputs');
          rec.status = 'success';
        } else {
          const inputs = Object.fromEntries(Object.entries(step.with).map(([k, v]) => [k, interpolate(String(v ?? ''), ctx)]));
          const event = store.createPullRequest({ workspace: readTree(workspace), inputs });
          rec.outputs = { 'pull-request-operation': event.operation === 'none' ? '' : event.operation, ...(event.number ? { 'pull-request-number': String(event.number) } : {}) };
          rec.output = event.operation === 'none' ? 'create-pull-request stub: no changes, nothing to do' : `create-pull-request stub: ${event.operation} #${event.number} from ${event.branch}`;
          rec.status = 'success';
        }
      } finally { rec.ms = Math.round(performance.now() - t0); }
      if (rec.id) ctx.steps[rec.id] = { outputs: rec.outputs };
      if (rec.status === 'failure') failed = rec;
    }
  } finally {
    await server.close();
  }
  const wallMs = Math.round(performance.now() - started);
  const observation = {
    isolation: mode,
    failed: !!failed,
    failedStep: failed ? { index: failed.index, name: failed.name, exitCode: failed.exitCode } : null,
    message: failed ? tail(failed.output) : '',
    steps,
    http: server.requests,
    curl: parseCurlLog(path.join(out, 'curl.log')),
    docker: parseJsonl(path.join(out, 'docker.jsonl')),
    pr: store.snapshot(),
    workspace: readTree(workspace),
    wallMs,
  };
  if (!keep) rmSync(run, { recursive: true, force: true });
  else observation.runDir = run;
  return observation;
}
