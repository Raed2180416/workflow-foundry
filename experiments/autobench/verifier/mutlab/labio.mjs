// Move 3/4/6: read-only access to the stored dev60 verifier lab (VERIFIER-LAB.md §8) through an allowlist.
//
// The lab directory (dataset.jsonl, worlds/) and the stored verifier outputs live outside the repo (scratchpad); every path
// comes in as an argument. Hygiene (PREREG-AB-v1 §5, VERIFIER-LAB.md, ATTACK.md): only devTrain dev60 rows of dev60 runs
// are read; a run id naming devcheck, look, test or sealed, or any run outside DEV60_RUNS, stops the read. Labels are
// returned separately from what a verifier may see (viewOf drops them), and nothing here writes a grader string.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export const DEV60_RUNS = Object.freeze(['a0-dev60', 'a0-dev60-dn', 'a0-dev60-dn-v306', 'a0s-dev60-dn', 'a1-dev60', 'a1-dev60-dn', 'a1-dev60-dn-fill',
  'a1s-dev60-dn', 'a1s-dev60-dn-fill', 'a1c-dev60-dn', 'm3-a1c-dev60-dn', 'm3-a1c-dev60-dn-fill', 'a1csp-smoke2']);
export const REPORTED_ARMS = Object.freeze(['m3-a1c', 'sonnet-a1', 'haiku-a1c', 'sonnet-a0', 'haiku-a1', 'haiku-a0']);
export const FORBIDDEN_RUN = /devcheck|look|test|sealed/i;

export function runAllowed(run) {
  return typeof run === 'string' && DEV60_RUNS.includes(run) && !FORBIDDEN_RUN.test(run);
}
export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const fileSha = f => sha256(readFileSync(f));
export const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
export const readGz = f => JSON.parse(gunzipSync(readFileSync(f)).toString('utf8'));

/** Lab rows, each checked against the allowlist (a forbidden run throws before anything else is read). */
export function loadLab(labDir, { canonicalOnly = true, outcomeOnly = true, arms = null } = {}) {
  const f = path.join(labDir, 'dataset.jsonl');
  const rows = readJsonl(f);
  for (const r of rows) if (!runAllowed(r.run)) throw new Error(`labio: run ${r.run} is not on the dev60 allowlist`);
  return rows.filter(r => (!canonicalOnly || r.canonical) && (!outcomeOnly || r.outcome) && (!arms || arms.includes(r.arm)));
}

/** What a verifier may see of a row: request, clock, services and the diff (never label, task name, arm, run or paths). */
export function viewOf(row, diff = row.diff) {
  return { vid: sha256(`v|${row.rowId}`).slice(0, 12), prompt: { system: row.prompt.system, user: row.prompt.user }, today: row.today, services: row.services, diff };
}
export const labelPass = row => row.label.task_completed_correctly === 1;
export function worldsOf(labDir, row) {
  return { initial: readGz(path.join(labDir, row.worlds.initial)), final: readGz(path.join(labDir, row.worlds.final)) };
}

/** The stored call log of a row as replay steps: [{calls: [{name, arguments, orig}]}]. */
export function stepsOf(row) {
  const host = row.source?.host;
  if (!host || !runAllowed(row.run) || !host.includes(`/${row.run}/host/`)) throw new Error(`labio: no allowed host directory for ${row.rowId}`);
  const f = path.join(host, 'calls.jsonl');
  return readJsonl(f).map(s => ({ calls: (s.calls ?? []).map((c, j) => ({ name: c.name, arguments: c.arguments, orig: (s.results ?? [])[j] ?? null })) }));
}

/** E-mail addresses that occur anywhere in a world (string leaves). */
export function worldEmails(world) {
  const out = new Set();
  const re = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const walk = v => {
    if (typeof v === 'string') for (const m of v.match(re) ?? []) out.add(m.toLowerCase());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(world);
  return [...out].sort();
}
