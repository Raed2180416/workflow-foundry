// $0 validation of the W-bed reference workflows (README.md): each reference runs on W-bed dev seeds through the real
// compiled path (experiments/jit/run-compiled.mjs: the B1 sandbox, no network, the model gateway's socket as the only way
// out, flow-v3 as tools/flow.mjs, a per-task gateway budget) with a STUB gateway for judges (stub-policy.mjs, policies A
// and B). Analyst side only: the bed oracle scores the delivered answer (pass and score are kept, its details are not),
// and nothing it says reaches the reference. No model is called.
//   node beds/wbed/references/validate.mjs --rung r1|r3 [--seeds 301-312] [--difficulties 3,4] [--policies A,B]
//        [--concurrency 2] [--work <dir>] [--out <file.json>] [--labels]   (--labels: also compare with referenceSolve)
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../../experiments/lib/models.mjs';
import { runCompiled, FLOW_V3 } from '../../../experiments/jit/run-compiled.mjs';
import { canonical } from '../../lib/canonical.mjs';
import { stubScript } from './stub-policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5', MODELS = [HAIKU, SONNET];
export const REFERENCES = Object.freeze({
  r1: { bed: 'wbed-r1', file: path.join(HERE, 'r1-reference.mjs') },
  r3: { bed: 'wbed-r3', file: path.join(HERE, 'r3-reference.mjs') },
});
export const PER_TASK_USD = 1, TIMEOUT_MS = 5 * 60 * 1000;
const sha = s => createHash('sha256').update(s).digest('hex');

export function stubPort(policyName, log) {
  const owner = loadPolicy().policy, policy = subsetPolicy(owner, MODELS);
  const prices = Object.fromEntries(owner.models.filter(m => MODELS.includes(m.id)).map(m => [m.id, m.price]));
  return new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': new ScriptedProvider(stubScript(policyName, prices, log)) } });
}

// One run: the reference on one task under one stub policy. Returns the row the summary reads.
export async function runOne({ rung, seed, difficulty, policy, work, labels = false }) {
  const ref = REFERENCES[rung];
  const bed = await import(`../../${ref.bed}/index.mjs`);
  const task = bed.generate({ seed, split: 'dev', difficulty });
  const workdir = path.join(work, `${rung}-${seed}-d${difficulty}-${policy}`);
  rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
  const log = [];
  const rc = await runCompiled({ solvePath: ref.file, task: { prompt: task.prompt, inputs: task.inputs, ...(task.files ? { files: task.files } : {}) }, modelPort: stubPort(policy, log),
    perTaskUsd: PER_TASK_USD, timeoutMs: TIMEOUT_MS, workdir, outputSchema: bed.outputSchema, allowedModels: MODELS, flowPath: FLOW_V3, label: `wbed-ref-${rung}-${seed}-${difficulty}-${policy}` });
  let pass = false, score = 0;
  if (rc.status === 'ok') { const o = bed.oracle(task, rc.output); pass = !!o.pass; score = typeof o.score === 'number' ? o.score : 0; }
  const judges = rc.trace.filter(e => e.kind === 'judge');
  const done = [...rc.trace].reverse().find(e => ['done', 'deopt', 'crash'].includes(e.kind));
  const row = {
    rung, seed, difficulty, policy, status: rc.status, deopt: rc.deopt ? { kind: rc.deopt.kind, name: rc.deopt.name } : null, error: rc.error?.code ?? null,
    pass, score, outDigest: rc.output == null ? null : sha(canonical(rc.output)).slice(0, 16),
    costUsd: rc.costUsd, modelCalls: log.length, sonnetCalls: log.filter(x => x.model === SONNET).length,
    judges: judges.length, judgesFailed: judges.filter(j => !j.ok).length, judgeNames: [...new Set(judges.map(j => j.name.replace(/:.*$/, '')))].sort(),
    escalations: judges.filter(j => j.ok && j.escalations > 0).length, flags: rc.flags?.names ?? [], flagCount: rc.flags?.count ?? 0,
    latencyMs: rc.latencyMs, events: rc.trace.length, maxPromptChars: Math.max(0, ...log.map(x => x.promptChars)), invariants: done?.invariants ?? null, guards: done?.guards ?? null,
  };
  if (labels && rc.status === 'ok') row.labelMatch = canonical(bed.referenceSolve(task)) === canonical(rc.output);
  if (rc.status !== 'ok') row.stderrTail = (rc.meta?.stderrTail ?? '').slice(-300);
  return row;
}

export function parseRange(s) {
  return String(s).split(',').flatMap(part => { const [a, b] = part.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
}

// Per (seed, difficulty): did the delivered answer depend on the stub policy?
export function summarize(rows) {
  const byTask = new Map();
  for (const r of rows) { const k = `${r.rung}:${r.seed}:${r.difficulty}`; if (!byTask.has(k)) byTask.set(k, []); byTask.get(k).push(r); }
  const tasks = [...byTask.entries()].map(([k, rs]) => {
    const digests = new Set(rs.map(r => r.outDigest ?? `status:${r.status}`));
    return { task: k, statuses: Object.fromEntries(rs.map(r => [r.policy, r.status])), pass: Object.fromEntries(rs.map(r => [r.policy, r.pass])),
      judgeDependent: digests.size > 1, judges: Math.max(...rs.map(r => r.judges)) };
  });
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const policies = [...new Set(rows.map(r => r.policy))].sort();
  return {
    runs: rows.length, tasks: tasks.length,
    perPolicy: Object.fromEntries(policies.map(p => { const rs = rows.filter(r => r.policy === p); return [p, {
      runs: rs.length, ok: rs.filter(r => r.status === 'ok').length, deopt: rs.filter(r => r.status === 'deopt').length, crash: rs.filter(r => r.status === 'crash').length,
      invalid: rs.filter(r => r.status === 'invalid').length, timeout: rs.filter(r => r.status === 'timeout').length, pass: rs.filter(r => r.pass).length,
      costUsd: { total: Math.round(sum(rs, r => r.costUsd) * 1e6) / 1e6, max: Math.max(...rs.map(r => r.costUsd)), mean: Math.round((sum(rs, r => r.costUsd) / rs.length) * 1e6) / 1e6 },
      modelCalls: { total: sum(rs, r => r.modelCalls), max: Math.max(...rs.map(r => r.modelCalls)) }, sonnetCalls: sum(rs, r => r.sonnetCalls),
      ...(rs.some(r => 'labelMatch' in r) ? { labelMatch: rs.filter(r => r.labelMatch).length } : {}),
      deopts: Object.fromEntries([...new Set(rs.filter(r => r.deopt).map(r => `${r.deopt.kind}:${r.deopt.name}`))].map(k => [k, rs.filter(r => r.deopt && `${r.deopt.kind}:${r.deopt.name}` === k).length])),
    }]; })),
    judgeIndependent: tasks.filter(t => !t.judgeDependent).length,
    judgeIndependentPass: tasks.filter(t => !t.judgeDependent && Object.values(t.pass).every(Boolean)).length,
    judgeIndependentFail: tasks.filter(t => !t.judgeDependent && Object.values(t.pass).every(x => !x)).length,
    judgeDependent: tasks.filter(t => t.judgeDependent).length,
    passUnderSomePolicy: tasks.filter(t => Object.values(t.pass).some(Boolean)).length,
    tasksDetail: tasks,
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
  const rungs = args.rung === 'all' || !args.rung ? Object.keys(REFERENCES) : String(args.rung).split(',');
  const seeds = parseRange(args.seeds ?? '301-312'), diffs = parseRange(args.difficulties ?? '3,4'), policies = String(args.policies ?? 'A,B').split(',');
  const work = args.work ?? mkdtempSync(path.join(os.tmpdir(), 'wbed-refs-'));
  const jobs = [];
  for (const rung of rungs) for (const seed of seeds) for (const difficulty of diffs) for (const policy of policies) jobs.push({ rung, seed, difficulty, policy, work, labels: !!args.labels });
  const rows = [], conc = Number(args.concurrency ?? 2);
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const row = await runOne(j);
      rows.push(row);
      process.stderr.write(`${row.rung} s${row.seed} d${row.difficulty} ${row.policy}: ${row.status}${row.deopt ? ` (${row.deopt.kind}:${row.deopt.name})` : ''} pass=${row.pass} $${row.costUsd.toFixed(5)} calls=${row.modelCalls}${'labelMatch' in row ? ` label=${row.labelMatch}` : ''}\n`);
    }
  }));
  rows.sort((a, b) => a.rung.localeCompare(b.rung) || a.seed - b.seed || a.difficulty - b.difficulty || a.policy.localeCompare(b.policy));
  const shas = Object.fromEntries(rungs.map(r => [r, sha(readFileSync(REFERENCES[r].file))]));
  const report = { generatedBy: 'beds/wbed/references/validate.mjs', referenceSha256: shas, flowV3Sha256: sha(readFileSync(FLOW_V3)), split: 'dev', seeds, difficulties: diffs, policies,
    perTaskUsd: PER_TASK_USD, stub: 'stub-policy.mjs (A: first enum / first sentence; B: last enum / last sentence)', summary: Object.fromEntries(rungs.map(r => [r, summarize(rows.filter(x => x.rung === r))])), rows };
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1) + '\n');
  const brief = Object.fromEntries(Object.entries(report.summary).map(([r, s]) => [r, { ...s, tasksDetail: undefined }]));
  process.stdout.write(JSON.stringify(brief, null, 1) + '\n');
  if (!args.work) rmSync(work, { recursive: true, force: true });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
