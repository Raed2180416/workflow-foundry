// Run a candidate that is an external command: it reads one JSON job on stdin and prints one JSON result on stdout
// (the same contract as a Foundry `code` node: JSON in, JSON out). Used to plug a solver's program into oracle().
import { spawnSync } from 'node:child_process';
import { evalInputs, oracle } from './index.mjs';

export function runCommandCandidate(task, command, args = [], { cwd, timeoutMs = 20000, env = {} } = {}) {
  const cases = {}, errors = {}, wallMs = {};
  for (const c of evalInputs(task)) {
    const t0 = Date.now();
    const r = spawnSync(command, args, { input: JSON.stringify(c.inputs), cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    wallMs[c.caseId] = Date.now() - t0;
    if (r.error || r.status !== 0) { errors[c.caseId] = (r.error?.message ?? `exit ${r.status}: ${r.stderr}`).slice(0, 200); continue; }
    try { cases[c.caseId] = JSON.parse(r.stdout); } catch (e) { errors[c.caseId] = `stdout is not JSON: ${e.message}`.slice(0, 200); }
  }
  const verdict = oracle(task, { cases });
  return { ...verdict, details: { ...verdict.details, candidateErrors: errors, wallMs } };
}
