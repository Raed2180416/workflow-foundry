// check-runner.mjs: runs a subflow request's check (agent-written code) for subflow.mjs, never in the host process.
//
// A check is module source text: `export default (answer, unit) => verdict` (or a named export `check`), sync or async, with
// unit = {id, input}. Verdicts as flow-v3's: null, undefined, true or [] = ok; false, a string, a list of strings or
// {ok: false, reasons} = the problem; a throw is a problem too. Every run() is a fresh process in a fresh directory holding
// only check.mjs and run-check.mjs, so a check keeps no state between runs (the planted mutant arrives in a run of its own,
// shaped like any other case). The cases arrive on stdin with a nonce read before check.mjs is imported; only the final
// stdout line that carries the nonce counts, so a check cannot print or exit its way to a verdict.
//   sandboxCheckRunner()  the executor sandbox (src/executors/sandboxed-command.mjs runSandboxed, network off, repository,
//                         oracles and every other workdir hidden): the runner for live use.
//   processCheckRunner()  a plain child process, cwd = HOME = its directory, env {PATH} (the $0 runner, as
//                         experiments/library/run.mjs runs solvers): for tests and $0 replays only.
// run({source, cases: [{output, unit}], timeoutMs}) -> {verdicts: [{ok, problem?}]} | {error: {code, message}}.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { runSandboxed } from '../../src/executors/sandboxed-command.mjs';
import { WORK_ROOT } from '../../src/executors/claude-code.mjs';

export const RUN_CHECK_SOURCE = `// run-check.mjs (experiments/rec/check-runner.mjs): verdicts of ./check.mjs on the cases given on stdin.
import { readFileSync } from 'node:fs';
// Taken before check.mjs is imported, so the check cannot reach the nonce or swap the writer.
const write = process.stdout.write.bind(process.stdout), stringify = JSON.stringify, exit = process.exit.bind(process);
let input = null;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch {}
const nonce = input?.nonce, cases = Array.isArray(input?.cases) ? input.cases : [];
const out = o => write('\\n' + stringify({ nonce, ...o }) + '\\n');
const msg = e => String(e?.message ?? e).slice(0, 300);
let fn = null;
try { const m = await import('./check.mjs'); fn = typeof m.default === 'function' ? m.default : typeof m.check === 'function' ? m.check : null; }
catch (e) { out({ error: { code: 'CHECK_LOAD', message: 'check.mjs failed to load: ' + msg(e) } }); exit(0); }
if (!fn) { out({ error: { code: 'CHECK_EXPORT', message: 'check.mjs exports no function (default or check)' } }); exit(0); }
const verdictOf = v => {
  if (v === null || v === undefined || v === true) return { ok: true };
  if (v === false) return { ok: false, problem: 'check failed' };
  if (Array.isArray(v)) return v.length ? { ok: false, problem: v.map(String).join('; ').slice(0, 500) } : { ok: true };
  if (typeof v === 'object' && 'ok' in v) return v.ok === true ? { ok: true } : { ok: false, problem: String(v.reasons ?? v.reason ?? 'check failed').slice(0, 500) };
  return { ok: false, problem: String(v).slice(0, 500) };
};
const verdicts = [];
for (const c of cases) {
  try { verdicts.push(verdictOf(await fn(c.output, c.unit))); }
  catch (e) { verdicts.push({ ok: false, problem: 'check threw: ' + msg(e) }); }
}
out({ verdicts });
exit(0);
`;

// The verdicts of a run's stdout: the last line that parses and carries this run's nonce.
export function verdictsOf(stdout, nonce, n) {
  const line = String(stdout).split('\n').reverse().find(l => { try { return JSON.parse(l)?.nonce === nonce; } catch { return false; } });
  if (!line) return { error: { code: 'CHECK_RUNNER', message: 'the check run printed no verdict line' } };
  const o = JSON.parse(line);
  if (o.error) return { error: { code: String(o.error.code ?? 'CHECK_RUNNER'), message: String(o.error.message ?? '').slice(0, 300) } };
  if (!Array.isArray(o.verdicts) || o.verdicts.length !== n) return { error: { code: 'CHECK_RUNNER', message: 'the check run returned the wrong number of verdicts' } };
  return { verdicts: o.verdicts.map(v => (v?.ok === true ? { ok: true } : { ok: false, problem: String(v?.problem ?? 'check failed').slice(0, 500) })) };
}

function prepare(root, source, cases) {
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, 'check-'));
  writeFileSync(path.join(dir, 'check.mjs'), source);
  writeFileSync(path.join(dir, 'run-check.mjs'), RUN_CHECK_SOURCE);
  const nonce = randomBytes(16).toString('hex');
  return { dir, nonce, input: JSON.stringify({ nonce, cases }) };
}

/** A plain child process per run ($0 tests and replays; no sandbox). */
export function processCheckRunner({ root = path.join(tmpdir(), 'rec-checks'), timeoutMs: defaultMs = 30000 } = {}) {
  return {
    kind: 'process',
    async run({ source, cases, timeoutMs = defaultMs }) {
      const { dir, nonce, input } = prepare(root, source, cases);
      try {
        const child = spawn(process.execPath, ['--max-old-space-size=256', 'run-check.mjs'], { cwd: dir, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', timedOut = false;
        child.stdout.on('data', d => { if (stdout.length < 4 * 1024 * 1024) stdout += d; });
        child.stderr.on('data', () => {});
        child.stdin.on('error', () => {});
        child.stdin.end(input);
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
        await new Promise(resolve => child.on('close', resolve));
        clearTimeout(timer);
        if (timedOut) return { error: { code: 'CHECK_TIMEOUT', message: `the check ran over ${timeoutMs} ms` } };
        return verdictsOf(stdout, nonce, cases.length);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

/** The executor sandbox per run (live use): network off, the repository and every other workdir hidden. */
export function sandboxCheckRunner({ root = path.join(WORK_ROOT, 'rec-checks'), timeoutMs: defaultMs = 30000, run = runSandboxed } = {}) {
  return {
    kind: 'sandbox',
    async run({ source, cases, timeoutMs = defaultMs }) {
      const { dir, nonce, input } = prepare(root, source, cases);
      try {
        let r;
        try { r = await run({ command: 'node', args: ['--max-old-space-size=256', 'run-check.mjs'], workdir: dir, input, network: false, timeoutMs }); }
        catch (e) { return { error: { code: e.code ?? 'SANDBOX_UNAVAILABLE', message: String(e.message ?? e).slice(0, 300) } }; }
        if (r.sandboxReady === false) return { error: { code: 'SANDBOX_SETUP', message: String(r.stderr ?? '').slice(-300) } };
        if (r.timedOut) return { error: { code: 'CHECK_TIMEOUT', message: `the check ran over ${timeoutMs} ms` } };
        return verdictsOf(r.stdout, nonce, cases.length);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}
