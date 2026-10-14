// $0 validation of the W-bed reference workflows (README.md): each reference runs on W-bed dev seeds through the real
// compiled path (experiments/jit/run-compiled.mjs: the B1 sandbox, no network, the model gateway's socket as the only way
// out, flow-v3 as tools/flow.mjs, a per-task gateway budget) with a STUB gateway for judges (stub-policy.mjs, policies A
// and B). Analyst side only: the bed oracle scores the delivered answer (pass and score are kept, its details are not),
// and nothing it says reaches the reference. No model is called.
//   node beds/wbed/references/validate.mjs --rung r1|r3 [--seeds 301-312] [--difficulties 3,4] [--policies A,B]
//        [--concurrency 2] [--work <dir>] [--out <file.json>] [--labels]   (--labels: also compare with referenceSolve)
//        [--relations]   (also run every metamorphic relation the bed declares (bed.invariance, ATTACK M1) through the same
//                         sandbox, policy and answers, and record whether the reference's output keeps the relation)
//   node beds/wbed/references/validate.mjs --revalidate [--concurrency 3]
//        README "Re-validation": re-run every recorded row FROZEN.json's revalidate list names (deterministic: author, world
//        and stub policies, $0) on the current engine and compare status, deopt, pass and output digest with the record.
//        Prints the engine shas and the mismatches; FROZEN.json engine.revalidated gains an entry only with 0 mismatches.
//   Policy 'author' (author fixtures 373-378 only): judges answered from author/fixture-answers.json through the flow-v3
//   override hook (author/author-override.mjs); it checks the code given correct readings, not a model.
//   Policy 'world' (any dev seed; analyst side, added by the 2026-10-14 review fixes): judges answered from the generator
//   world (analyst/world-readings.mjs, served by analyst/world-override.mjs for R1 and author/author-override.mjs for R3).
//   It measures the frozen code on seeds the author never saw, given correct readings; it is never evidence about judges.
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
export const AUTHOR_SEEDS = Object.freeze([373, 374, 375, 376, 377, 378]), VALIDATION_SEEDS = Object.freeze([301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312]);
export async function runOne({ rung, seed, difficulty, policy, work, labels = false, flip = null, relations = false }) {
  const ref = REFERENCES[rung];
  const bed = await import(`../../${ref.bed}/index.mjs`);
  let author = {};
  if (policy === 'author') {
    // Fixtures 373-378 (development) or, at the protocol's one revision, the validation seeds 301-312 (diagnostic).
    const file = AUTHOR_SEEDS.includes(seed) ? 'author/fixture-answers.json' : VALIDATION_SEEDS.includes(seed) ? 'author/validation-answers.json' : null;
    if (!file) throw new Error('policy author is for the author fixtures (373-378) and the validation seeds (301-312) only');
    const table = JSON.parse(readFileSync(path.join(HERE, file), 'utf8'));
    author = { flowOverride: path.join(HERE, 'author/author-override.mjs'), flowOverrideData: { answers: table[`${ref.bed}:${seed}:d${difficulty}`] ?? {}, ...(flip ? { flip } : {}) } };
  } else if (policy === 'world') {
    if (flip) throw new Error('--flip is for the author policy only');
    const { readingsFor } = await import('./analyst/world-readings.mjs');
    author = { flowOverride: path.join(HERE, rung === 'r1' ? 'analyst/world-override.mjs' : 'author/author-override.mjs'), flowOverrideData: await readingsFor(rung, seed, difficulty, 'dev') };
  }
  const task = bed.generate({ seed, split: 'dev', difficulty });
  const workdir = path.join(work, `${rung}-${seed}-d${difficulty}-${policy}${flip ? `-flip-${flip}` : ''}`);
  rmSync(workdir, { recursive: true, force: true }); mkdirSync(workdir, { recursive: true });
  const log = [];
  const stubName = policy === 'author' || policy === 'world' ? 'A' : policy;
  const runOn = (t, dir, label, sink) => runCompiled({ solvePath: ref.file, task: { prompt: t.prompt, inputs: t.inputs, ...(t.files ? { files: t.files } : {}) }, modelPort: stubPort(stubName, sink),
    perTaskUsd: PER_TASK_USD, timeoutMs: TIMEOUT_MS, workdir: dir, outputSchema: bed.outputSchema, allowedModels: MODELS, flowPath: FLOW_V3, label, ...author });
  const rc = await runOn(task, workdir, `wbed-ref-${rung}-${seed}-${difficulty}-${policy}`, log);
  let pass = false, score = 0;
  if (rc.status === 'ok') { const o = bed.oracle(task, rc.output); pass = !!o.pass; score = typeof o.score === 'number' ? o.score : 0; }
  const judges = rc.trace.filter(e => e.kind === 'judge');
  const done = [...rc.trace].reverse().find(e => ['done', 'deopt', 'crash'].includes(e.kind));
  const row = {
    rung, seed, difficulty, policy, ...(flip ? { flip } : {}), status: rc.status, deopt: rc.deopt ? { kind: rc.deopt.kind, name: rc.deopt.name } : null, error: rc.error?.code ?? null,
    pass, score, outDigest: rc.output == null ? null : sha(canonical(rc.output)).slice(0, 16),
    costUsd: rc.costUsd, modelCalls: log.length, sonnetCalls: log.filter(x => x.model === SONNET).length,
    judges: judges.length, judgesFailed: judges.filter(j => !j.ok).length, judgeNames: [...new Set(judges.map(j => j.name.replace(/:.*$/, '')))].sort(),
    escalations: judges.filter(j => j.ok && j.escalations > 0).length, overridden: judges.filter(j => j.overridden).length, flags: rc.flags?.names ?? [], flagCount: rc.flags?.count ?? 0,
    latencyMs: rc.latencyMs, events: rc.trace.length, maxPromptChars: Math.max(0, ...log.map(x => x.promptChars)), invariants: done?.invariants ?? null, guards: done?.guards ?? null,
  };
  if (labels && rc.status === 'ok') row.labelMatch = canonical(bed.referenceSolve(task)) === canonical(rc.output);
  // Analyst-side decomposition for R3 (README "R3 bed finding"): are the per-supplier statements the bed reference's (up to
  // the order of discrepancies), and are the totals? Counts only; nothing reaches the reference.
  if (rung === 'r3' && rc.status === 'ok') {
    const ref = bed.referenceSolve(task), norm = st => ({ ...st, discrepancies: [...st.discrepancies].map(d => canonical(d)).sort() });
    row.statementsMatchReference = canonical(rc.output.statements.map(norm)) === canonical(ref.statements.map(norm));
    row.totalsMatchReference = canonical({ b: rc.output.by_reason, t: rc.output.totals }) === canonical({ b: ref.by_reason, t: ref.totals });
    // The code-decided part: every statement with the judged reasons (PRICE, FX, MISSING_CREDIT) and the adjusted balance
    // (which follows them) blanked on both sides.
    const blank = st => ({ ...st, adjusted_balance_minor: null, discrepancies: st.discrepancies.map(d => canonical({ ...d, reason: ['PRICE', 'FX', 'MISSING_CREDIT'].includes(d.reason) ? 'JUDGED' : d.reason === 'UNEXPLAINED' ? 'JUDGED-OR-UNEXPLAINED' : d.reason })).sort() });
    const loose = st => ({ ...blank(st), discrepancies: blank(st).discrepancies.map(x => x.replace('"JUDGED-OR-UNEXPLAINED"', '"JUDGED"')) });
    row.statementsMatchModuloJudged = canonical(rc.output.statements.map(loose)) === canonical(ref.statements.map(loose));
  }
  // --relations (review finding 7): each declared relation's variant through the same sandbox, policy and answers. With
  // correct readings (author, world) a correct solver must keep every relation; 'disagree' is a relation or a reference
  // defect. Analyst side; the variant rows are summarised, not kept.
  if (relations && rc.status === 'ok' && Array.isArray(bed.invariance) && bed.invariance.length) {
    const { runVariants } = await import('../../../experiments/jit/invariance.mjs');
    const v = await runVariants({ relations: bed.invariance, task, output: rc.output, seed: `wbed-refs:${rung}:${seed}:${difficulty}`, stopOnViolation: false,
      runVariant: (t, rel) => { const dir = `${workdir}-v-${rel.id}`; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
        return runOn(t, dir, `wbed-ref-${rung}-${seed}-${difficulty}-${policy}-v-${rel.id}`, []); } });
    row.relations = Object.fromEntries(v.results.map(r => [r.relation, r.status + (r.deopt ? `(${r.deopt.kind}:${r.deopt.name})` : '')]));
  }
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
    // Judge dependence compares the two stub policies only (the author policy answers judges correctly by construction).
    const digests = new Set(rs.filter(r => r.policy === 'A' || r.policy === 'B').map(r => r.outDigest ?? `status:${r.status}`));
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
      judgesFailed: sum(rs, r => r.judgesFailed), maxPromptChars: Math.max(...rs.map(r => r.maxPromptChars)),
      latencyMs: { median: [...rs.map(r => r.latencyMs)].sort((a, b) => a - b)[Math.floor(rs.length / 2)], max: Math.max(...rs.map(r => r.latencyMs)) },
      flags: Object.fromEntries([...new Set(rs.flatMap(r => r.flags))].sort().map(f => [f, rs.filter(r => r.flags.includes(f)).length])),
      ...(rs.some(r => 'labelMatch' in r) ? { labelMatch: rs.filter(r => r.labelMatch).length } : {}),
      ...(rs.some(r => 'statementsMatchReference' in r) ? { statementsMatchReference: rs.filter(r => r.statementsMatchReference).length, totalsMatchReference: rs.filter(r => r.totalsMatchReference).length,
        statementsMatchModuloJudged: rs.filter(r => r.statementsMatchModuloJudged).length } : {}),
      deopts: Object.fromEntries([...new Set(rs.filter(r => r.deopt).map(r => `${r.deopt.kind}:${r.deopt.name}`))].map(k => [k, rs.filter(r => r.deopt && `${r.deopt.kind}:${r.deopt.name}` === k).length])),
      ...(rs.some(r => r.relations) ? { relations: rs.filter(r => r.relations).reduce((acc, r) => { for (const [id, st] of Object.entries(r.relations)) { acc[id] ??= {}; acc[id][st] = (acc[id][st] ?? 0) + 1; } return acc; }, {}) } : {}),
    }]; })),
    judgeIndependent: tasks.filter(t => !t.judgeDependent).length,
    judgeIndependentPass: tasks.filter(t => !t.judgeDependent && t.pass.A && t.pass.B).length,
    judgeIndependentFail: tasks.filter(t => !t.judgeDependent && !t.pass.A && !t.pass.B).length,
    judgeDependent: tasks.filter(t => t.judgeDependent).length,
    passUnderSomeStub: tasks.filter(t => t.pass.A || t.pass.B).length,
    ...(policies.includes('author') ? { passWithAuthorReadings: tasks.filter(t => t.pass.author).length } : {}),
    ...(policies.includes('world') ? { passWithWorldReadings: tasks.filter(t => t.pass.world).length } : {}),
    tasksDetail: tasks,
  };
}

// The recorded rows that a re-validation re-runs: [file, rungs]. The fixture and dev 301-312 files keep R1 only, because
// their R3 rows were recorded on wbed-r3 1.0.0 (the printed quotes, so the R3 totals, moved in 1.1.0).
export const REVALIDATE = Object.freeze([['validation/fixtures-373-378.json', ['r1']], ['validation/dev-301-312.json', ['r1']],
  ['validation/r3-bed-1.1.0.json', ['r3']], ['validation/dev-313-324.json', ['r1', 'r3']]]);
export async function revalidate({ concurrency = 3, work, log = () => {} } = {}) {
  const jobs = [];
  for (const [file, rungs] of REVALIDATE) for (const r of JSON.parse(readFileSync(path.join(HERE, file), 'utf8')).rows) if (rungs.includes(r.rung)) jobs.push({ file, rec: r });
  const mismatches = [];
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < jobs.length) {
      const { file, rec } = jobs[next++];
      const row = await runOne({ rung: rec.rung, seed: rec.seed, difficulty: rec.difficulty, policy: rec.policy, work });
      const a = { status: rec.status, deopt: rec.deopt, pass: rec.pass, outDigest: rec.outDigest }, b = { status: row.status, deopt: row.deopt, pass: row.pass, outDigest: row.outDigest };
      if (canonical(a) !== canonical(b)) mismatches.push({ file, rung: rec.rung, seed: rec.seed, difficulty: rec.difficulty, policy: rec.policy, recorded: a, now: b });
      if (++done % 50 === 0) log(`${done}/${jobs.length}`);
    }
  }));
  return { rows: jobs.length, mismatches, flowV3Sha256: sha(readFileSync(FLOW_V3)), runCompiledSha256: sha(readFileSync(path.join(HERE, '../../../experiments/jit/run-compiled.mjs'))) };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
  if (args.revalidate) {
    const work = mkdtempSync(path.join(os.tmpdir(), 'wbed-refs-reval-'));
    const res = await revalidate({ concurrency: Number(args.concurrency ?? 3), work, log: m => process.stderr.write(m + '\n') });
    rmSync(work, { recursive: true, force: true });
    process.stdout.write(JSON.stringify(res, null, 1) + '\n');
    if (res.mismatches.length) process.exitCode = 1;
    return;
  }
  const rungs = args.rung === 'all' || !args.rung ? Object.keys(REFERENCES) : String(args.rung).split(',');
  const seeds = parseRange(args.seeds ?? '301-312'), diffs = parseRange(args.difficulties ?? '3,4'), policies = String(args.policies ?? 'A,B').split(',');
  const work = args.work ?? mkdtempSync(path.join(os.tmpdir(), 'wbed-refs-'));
  const jobs = [];
  // --flip <class>: author policy with one judge class answered wrongly (sensitivity; see author-override.mjs).
  const flip = typeof args.flip === 'string' ? args.flip : null;
  for (const rung of rungs) for (const seed of seeds) for (const difficulty of diffs) for (const policy of policies) jobs.push({ rung, seed, difficulty, policy, work, labels: !!args.labels, flip, relations: !!args.relations });
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
