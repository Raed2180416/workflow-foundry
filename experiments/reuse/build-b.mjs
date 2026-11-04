// Rebuilding from scratch with the SAME builder (research/reuse-20261021/PREREG-C2-1.md §2, arms S and R-deopt): the
// SOP-Bench phase-2 builder loop (experiments/sopbench/build.mjs buildSop) run on program B's labelled history for one
// supplier instead of SOP-Bench's dev rows. Unchanged: the build and repair prompts (imported, byte-identical), the
// builder model (Haiku 5.5 from the policy file) and effort (high), the tools, the kit (tools/run-solver.mjs,
// tools/check.mjs, tools/strict.mjs), the SDK, the section contracts, 2 repair rounds, the keep-only-if-no-row-lost rule.
// Changed: B's world answers the tools (world-b.mjs) where the SOP-Bench bridge did; the examples are the supplier's 5 build
// and 10 repair products with B's oracle labels; session caps are $1.00 build / $0.50 repair (SOP-Bench: $3 / $1.50; the
// dangerous_goods build cost $0.03, so the caps bind only on a runaway session).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_TOOLS, nestedModelUses, runClaudeCode } from '../../src/executors/claude-code.mjs';
import { startServices, Ledger } from '../lib/services.mjs';
import { ENV_FAULTS } from '../lib/runner.mjs';
import { BUILD_PROMPT, REPAIR_PROMPT } from '../sopbench/build.mjs';
import { artifactFiles, artifactSha256, outputSchemaOf, sdkFiles, writeFiles } from '../sopbench/exec.mjs';
import { finalOutputText, strictVerdict } from '../sopbench/scorer.mjs';
import { HERE as SOP_HERE } from '../sopbench/lib.mjs';
import { serveMailbox } from './world-b.mjs';
import { runArtifact } from './host.mjs';
import { sha256 } from './lib.mjs';

export const BUILD_B_DEFAULTS = Object.freeze({ builderModel: 'claude-haiku-5-5', judgeModels: ['claude-haiku-5-5'], buildBudgetUsd: 1.0, repairBudgetUsd: 0.5, buildMinutes: 30,
  repairMinutes: 20, rounds: 2, builderJudgeUsd: 0.25, checkConcurrency: 3 });
const OUTPUT_COLUMNS = ['hazard_class'];
const kitFile = f => readFileSync(path.join(SOP_HERE, 'kit', f), 'utf8');
const expectedOf = truth => ({ hazard_class: truth.hazard_class });
/** Strict grade of a workflow answer against B's label, with the SOP-Bench strict scorer. */
export const strictOf = (answer, truth) => strictVerdict(finalOutputText(answer ?? {}), { hazard_class: { str: truth.hazard_class, isna: false } }, OUTPUT_COLUMNS).pass;

/** The builder's workdir files (everything but the SDK, which needs the gateway token). examples: [{ product, task }]. */
function workdirFiles({ sopText, catalog, examples }) {
  const files = { 'sop.txt': sopText, 'catalog.json': JSON.stringify(catalog, null, 1),
    'tools/run-solver.mjs': kitFile('run-solver.mjs'), 'tools/check.mjs': kitFile('check.mjs'), 'tools/strict.mjs': readFileSync(path.join(SOP_HERE, 'scorer.mjs'), 'utf8') };
  for (const ex of examples) {
    files[`rows/${ex.product.index}/task.json`] = JSON.stringify(ex.task, null, 1);
    files[`rows/${ex.product.index}/expected.json`] = JSON.stringify(expectedOf(ex.product.truth), null, 1);
  }
  return files;
}

async function session({ workdir, world, round, model, prompt, budgetUsd, minutes, modelPort, judgeModels, judgeUsd, catalog, runner = runClaudeCode, label }) {
  const ledger = new Ledger({ capUsd: judgeUsd, label: `c2-build:${label}:r${round}` });
  const svc = await startServices({ modelPort, ledger, allowedModels: judgeModels, socketDir: path.join(workdir, 'tools'), runId: `c2-build:${label}:r${round}:${Date.now()}` });
  writeFiles(workdir, { ...sdkFiles({ catalog, outputColumns: OUTPUT_COLUMNS, gateway: { socket: 'gw.sock', token: svc.token } }), 'output-schema.json': JSON.stringify(outputSchemaOf(OUTPUT_COLUMNS), null, 1) });
  rmSync(path.join(workdir, '.tools'), { recursive: true, force: true });
  const box = serveMailbox({ box: path.join(workdir, '.tools'), world, maxSteps: 1_000_000 });
  let r = null, error = null;
  try { r = await runner({ model, prompt, workdir, budgetUsd, timeoutMs: minutes * 60_000, effort: 'high', tools: DEFAULT_TOOLS, round }); }
  catch (e) { error = String(e?.message ?? e).slice(0, 500); }
  const served = await box.stop();
  try { await svc.close({ graceMs: 30_000 }); } catch {}
  return { r, error, judgeUsd: ledger.spentUsd, judgeCalls: ledger.calls, toolCalls: served.calls.filter(c => c.name).length,
    sessionError: r?.error?.code ?? (error ? 'HARNESS' : null), costUsd: r ? (r.costUsd ?? r.costUpperUsd ?? budgetUsd) : 0, costUnknown: Boolean(r?.costUnknown),
    turns: r?.turns ?? null, durationMs: r?.durationMs ?? null, nested: nestedModelUses(r?.toolUses ?? []), resultText: String(r?.result ?? '').slice(-1500) };
}

/** Run an artifact on examples in B's world and grade them strictly. */
export async function evaluateArtifact({ files, examples, world, live, catalog, modelPort, judgeModels, tagPrefix, concurrency = 3 }) {
  const out = new Array(examples.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, examples.length)) }, async () => {
    while (i < examples.length) {
      const k = i++, ex = examples[k];
      const run = await runArtifact({ files, catalog, outputColumns: OUTPUT_COLUMNS, task: ex.task, world, live, tag: `${tagPrefix}-${ex.product.index}`, modelPort, judgeModels });
      out[k] = { row: ex.product.index, id: ex.product.id, ...run, strict: run.status === 'done' && strictOf(run.answer, ex.product.truth) };
    }
  }));
  return out;
}

function writeFailures(workdir, records) {
  rmSync(path.join(workdir, 'failures'), { recursive: true, force: true });
  for (const r of records.filter(x => !x.strict)) {
    const d = path.join(workdir, 'failures', String(r.row));
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'result.json'), JSON.stringify({ status: r.status, answer: r.answer ?? null, wrongFields: r.status === 'done' ? OUTPUT_COLUMNS : null, error: r.error ? String(r.error).slice(-1500) : null }, null, 1));
    writeFileSync(path.join(d, 'trace.jsonl'), r.events.map(e => JSON.stringify(e)).join('\n') + '\n');
    if (r.deopt) writeFileSync(path.join(d, 'deopt.json'), JSON.stringify(r.deopt, null, 1));
    writeFileSync(path.join(d, 'tool-calls.jsonl'), r.calls.filter(c => c.name).map(c => JSON.stringify({ section: c.section ?? null, name: c.name, arguments: c.arguments ?? null, result: String(c.content ?? '').slice(0, 2000) })).join('\n') + '\n');
  }
}

/**
 * buildForSource(o) -> record. o: { label, sopText, catalog, buildExamples, repairExamples (each { product, task }), worldFor(ids)
 * -> World restricted to ids, live, modelPort, judgeModels, builderModel, budgets..., reserve(b), settle(b, cost), log, runner }.
 */
export async function buildForSource(o) {
  const opt = { ...BUILD_B_DEFAULTS, ...o };
  const { label, live, log = () => {} } = opt;
  const workdir = path.join(live, 'build', label, 'w');
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
  const buildIds = opt.buildExamples.map(e => e.product.id), allIds = [...buildIds, ...opt.repairExamples.map(e => e.product.id)];
  const rec = { label, builderModel: opt.builderModel, judgeModels: opt.judgeModels, rounds: [], costUsd: 0, buildRows: opt.buildExamples.map(e => e.product.index), repairRows: opt.repairExamples.map(e => e.product.index) };
  const prompt0 = BUILD_PROMPT({ cols: OUTPUT_COLUMNS, n: opt.buildExamples.length, judgeTiers: opt.judgeModels });
  rec.buildPromptSha256 = sha256(prompt0);
  writeFiles(workdir, { ...workdirFiles({ sopText: opt.sopText, catalog: opt.catalog, examples: opt.buildExamples }), 'BRIEF.md': prompt0 });
  let best = null;
  const t0 = Date.now();
  for (let round = 0; round <= opt.rounds; round++) {
    let prompt, budget, minutes, ids;
    if (round === 0) { prompt = prompt0; budget = opt.buildBudgetUsd; minutes = opt.buildMinutes; ids = buildIds; }
    else {
      const failed = best.eval.filter(r => !r.strict);
      if (!failed.length) break;
      writeFiles(workdir, workdirFiles({ sopText: opt.sopText, catalog: opt.catalog, examples: [...opt.buildExamples, ...opt.repairExamples] }));
      for (const [rel, text] of Object.entries(best.files)) writeFiles(workdir, { [rel]: text });
      writeFailures(workdir, best.eval);
      prompt = REPAIR_PROMPT({ n: allIds.length, failed: failed.length });
      rec.repairPromptSha256 = sha256(REPAIR_PROMPT({ n: 0, failed: 0 }));
      budget = opt.repairBudgetUsd; minutes = opt.repairMinutes; ids = allIds;
    }
    if (!(await opt.reserve(budget))) { rec.stopped = 'cap'; break; }
    log(`[build] ${label} round ${round}: session (${opt.builderModel}, $${budget}, ${minutes} min, ${ids.length} products served)`);
    const s = await session({ workdir, world: opt.worldFor(ids), round, model: opt.builderModel, prompt, budgetUsd: budget, minutes, modelPort: opt.modelPort, judgeModels: opt.judgeModels,
      judgeUsd: opt.builderJudgeUsd, catalog: opt.catalog, runner: opt.runner, label });
    opt.settle(budget, s.costUsd + s.judgeUsd);
    rec.costUsd += s.costUsd + s.judgeUsd;
    const roundRec = { round, sessionError: s.sessionError, costUsd: s.costUsd, costUnknown: s.costUnknown, judgeUsd: s.judgeUsd, judgeCalls: s.judgeCalls, turns: s.turns, durationMs: s.durationMs,
      toolCalls: s.toolCalls, nestedModelUses: s.nested, error: s.error };
    rec.rounds.push(roundRec);
    const transcript = path.join(workdir, '.executor-transcript.jsonl');
    if (existsSync(transcript)) cpSync(transcript, path.join(live, 'build', label, `transcript-r${round}.jsonl`));
    if (ENV_FAULTS.has(s.sessionError) || s.error) { rec.envFault = s.sessionError ?? s.error; log(`[build] ${label} round ${round}: environment fault ${rec.envFault}`); break; }
    const files = artifactFiles(workdir);
    if (!files) { roundRec.artifact = null; log(`[build] ${label} round ${round}: no solve.mjs`); break; }
    roundRec.artifactSha256 = artifactSha256(files);
    roundRec.files = Object.keys(files).sort();
    const adir = path.join(live, 'build', label, 'artifacts', `r${round}`);
    rmSync(adir, { recursive: true, force: true }); writeFiles(adir, files);
    const evalRecs = await evaluateArtifact({ files, examples: [...opt.buildExamples, ...opt.repairExamples], world: opt.worldFor(allIds), live, catalog: opt.catalog, modelPort: opt.modelPort,
      judgeModels: opt.judgeModels, tagPrefix: `${label}-r${round}`, concurrency: opt.checkConcurrency });
    const checkUsd = evalRecs.reduce((a, r) => a + (r.costUsd ?? 0), 0);
    rec.costUsd += checkUsd;
    const pass = new Set(evalRecs.filter(r => r.strict).map(r => r.row));
    Object.assign(roundRec, { buildPass: evalRecs.filter(r => r.strict && rec.buildRows.includes(r.row)).length, repairPass: evalRecs.filter(r => r.strict && rec.repairRows.includes(r.row)).length,
      devPass: pass.size, checkUsd, statuses: evalRecs.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}), failedRows: evalRecs.filter(r => !r.strict).map(r => r.row),
      judgeCallsPerRun: evalRecs.reduce((a, r) => a + (r.judgeCalls ?? 0), 0) / evalRecs.length });
    log(`[build] ${label} round ${round}: build ${roundRec.buildPass}/${buildIds.length}, repair ${roundRec.repairPass}/${opt.repairExamples.length}, session $${s.costUsd.toFixed(3)}, ${((s.durationMs ?? 0) / 60000).toFixed(1)} min`);
    if (evalRecs.some(r => r.status === 'env')) { rec.envFault = 'workflow run environment fault'; break; }
    const lost = best ? [...best.pass].filter(x => !pass.has(x)) : [];
    roundRec.lostRows = lost;
    if (!best || (lost.length === 0 && pass.size > best.pass.size)) { best = { round, files, eval: evalRecs, pass }; roundRec.kept = true; } else roundRec.kept = false;
  }
  rec.wallMs = Date.now() - t0;
  if (best) {
    const bdir = path.join(live, 'build', label, 'best');
    rmSync(bdir, { recursive: true, force: true }); writeFiles(bdir, best.files);
    Object.assign(rec, { bestRound: best.round, artifactSha256: artifactSha256(best.files), devPass: best.pass.size, devRows: allIds.length, artifactDir: bdir,
      judgeCallsPerRun: best.eval.reduce((a, r) => a + (r.judgeCalls ?? 0), 0) / best.eval.length,
      proof: { inputs: best.eval.filter(r => r.strict).map(r => r.row) } });
  } else rec.failedBuild = true;
  rmSync(workdir, { recursive: true, force: true });
  return rec;
}
