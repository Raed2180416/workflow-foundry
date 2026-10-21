#!/usr/bin/env node
// SOP-Bench phase 2, the sealed run (research/sopbench-20261021/DESIGN.md §5, §7): both arms on every sealed row of every
// frozen SOP, k runs each, interleaved per row (W then A on even forks, A then W on odd ones), graded by the phase-1
// graders. Refused unless the freeze file names this split, every frozen artifact and code file still has its frozen
// sha256, and the run's settings equal the frozen ones. Per-row records go to ROWS_ROOT/<run-id>/ only (CC BY-NC); no
// per-row grade is printed while the run is open; the repo gets the aggregate summary and the decision-rule evaluation.
//
//   node experiments/sopbench/sealed.mjs --freeze research/sopbench-20261021/FREEZE-p2.json --run-id p2-sealed --cap 40
// Options: --arms W,A (default both) --sops a,b (a subset of the frozen SOPs) --cell <ablation cell id> --concurrency 4 --resume
//   --grade-every 40 (answers graded in batches)
// Environment faults (rate/usage limit, sandbox, a workflow env status) stop the run (exit 3) and are never scored; rerun
// the same command with --resume. The cap stops it too (exit 4).
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WORK_ROOT, runClaudeCode } from '../../src/executors/claude-code.mjs';
import { loadPolicy, modelById } from '../../src/models/policy.mjs';
import { createModelPort } from '../lib/models.mjs';
import { REPO, RESEARCH, readJson, rng, sha256, writeJson } from './lib.mjs';
import { loadSplit } from './split.mjs';
import { ROWS_ROOT, gradeAnswers, isEnvFault, runAgentRow } from './run.mjs';
import { artifactFiles, artifactSha256, prepareRows, runWorkflowRow } from './exec.mjs';

/** Our code a sealed run depends on; each file's sha256 is frozen and a run refuses if one changed. The workflow SDK
 * (flow.mjs, model.mjs, sop.mjs) is a frozen copy under the freeze's sdkDir. */
export const FROZEN_CODE = Object.freeze(['experiments/sopbench/bridge.py', 'experiments/sopbench/upstream.py', 'experiments/sopbench/lib.mjs', 'experiments/sopbench/split.mjs',
  'experiments/sopbench/run.mjs', 'experiments/sopbench/scorer.mjs', 'experiments/sopbench/tool.mjs', 'experiments/sopbench/exec.mjs', 'experiments/sopbench/sealed.mjs']);
/** Shared host code (other teams' files): recorded at the freeze and at run time; drift is reported, not refused. */
export const DEPENDENCIES = Object.freeze(['experiments/lib/services.mjs', 'experiments/lib/models.mjs', 'experiments/lib/runner.mjs', 'experiments/autobench/accounting.mjs',
  'src/executors/claude-code.mjs', 'src/executors/sandboxed-command.mjs', 'src/models/policy.mjs', 'src/models/port.mjs', 'policy/models.json']);
const hashes = list => Object.fromEntries(list.map(f => [f, existsSync(path.join(REPO, f)) ? sha256(readFileSync(path.join(REPO, f))) : null]));
export const codeHashes = () => hashes(FROZEN_CODE);
export const dependencyHashes = () => hashes(DEPENDENCIES);

const readRecords = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Disk (~2 GB free on the shared machine): after a run is audited, drop its bulky host files, keeping their sha256 and
 * size in the record (agent transcripts; a finished workflow's stdout/stderr). Calls, traces and deopts stay. */
function pruneHost(live, tag, arm, rec) {
  const files = arm === 'A' ? [path.join(live, 'host', tag, 'transcript.jsonl')] : rec.status === 'done' ? [path.join(live, 'wf-host', tag, 'stdio.txt')] : [];
  for (const f of files) {
    try { const buf = readFileSync(f); (rec.pruned ??= []).push({ file: path.basename(f), bytes: buf.length, sha256: sha256(buf) }); rmSync(f, { force: true }); } catch {}
  }
}

/** Verify a freeze file against the split, the code and the artifacts; returns it. */
export function verifyFreeze(file, { split = loadSplit(), checkCode = true, root = REPO } = {}) {
  const f = readJson(file);
  const bad = [];
  if (f.kind !== 'sopbench-freeze') bad.push('kind');
  if (f.splitSha256 !== split.splitSha256) bad.push('splitSha256');
  if (checkCode) for (const [p, h] of Object.entries(f.code ?? {})) if (!existsSync(path.join(REPO, p)) || sha256(readFileSync(path.join(REPO, p))) !== h) bad.push(`code ${p}`);
  for (const [file, h] of Object.entries(f.arms?.W?.sdk?.files ?? {})) if (!existsSync(path.resolve(root, f.arms.W.sdk.dir, file)) || sha256(readFileSync(path.resolve(root, f.arms.W.sdk.dir, file))) !== h) bad.push(`sdk ${file}`);
  for (const [sop, a] of Object.entries(f.artifacts ?? {})) {
    const files = artifactFiles(path.resolve(root, a.dir));
    if (!files || artifactSha256(files) !== a.sha256) bad.push(`artifact ${sop}`);
  }
  for (const sop of f.sops) if (!split.sops[sop]) bad.push(`sop ${sop}`); else if (f.rows?.[sop]?.sealedSha256 !== split.sops[sop].sealedSha256) bad.push(`rows ${sop}`);
  if (bad.length) throw new Error(`freeze check failed: ${bad.join(', ')}`);
  return f;
}

/** pass^k per row (all k runs strict), per SOP and the macro over SOPs; bootstrap CIs (rows within SOPs, seeded). */
export function analyse(records, { sops, arms, k, resamples = 10_000, seed = 'sopbench-p2-bootstrap' }) {
  const rowsOf = (arm, sop) => {
    const m = new Map();
    for (const r of records.filter(x => x.arm === arm && x.sop === sop)) m.set(r.row, [...(m.get(r.row) ?? []), r]);
    return m;
  };
  const per = {};
  for (const arm of arms) {
    per[arm] = {};
    for (const sop of sops) {
      const m = rowsOf(arm, sop);
      const complete = [...m].filter(([, rs]) => rs.length >= k);
      per[arm][sop] = { rows: complete.length, passK: mean(complete.map(([, rs]) => (rs.every(r => r.strict) ? 1 : 0))), passAt1: mean(complete.flatMap(([, rs]) => rs.map(r => (r.strict ? 1 : 0)))),
        upstreamAt1: mean(complete.flatMap(([, rs]) => rs.map(r => (r.upstream ? 1 : 0)))), costUsd: complete.flatMap(([, rs]) => rs).reduce((a, r) => a + (r.costUsd ?? 0), 0),
        rowPass: Object.fromEntries(complete.map(([row, rs]) => [row, rs.every(r => r.strict) ? 1 : 0])) };
    }
  }
  const macro = arm => mean(sops.map(s => per[arm][s].passK).filter(x => x !== null));
  const out = { k, arms: {}, perSop: {} };
  for (const arm of arms) out.arms[arm] = { macroPassK: macro(arm), macroPassAt1: mean(sops.map(s => per[arm][s].passAt1).filter(x => x !== null)), macroUpstreamAt1: mean(sops.map(s => per[arm][s].upstreamAt1).filter(x => x !== null)),
    costUsd: sops.reduce((a, s) => a + per[arm][s].costUsd, 0), runs: records.filter(r => r.arm === arm).length };
  for (const sop of sops) out.perSop[sop] = Object.fromEntries(arms.map(a => [a, { rows: per[a][sop].rows, passK: per[a][sop].passK, passAt1: per[a][sop].passAt1, upstreamAt1: per[a][sop].upstreamAt1 }]));
  // Bootstrap: resample each SOP's rows (the rows both arms completed, so W-A is paired).
  const r = rng(seed);
  const rowsBoth = Object.fromEntries(sops.map(s => [s, Object.keys(per[arms[0]][s].rowPass).filter(row => arms.every(a => row in per[a][s].rowPass))]));
  const draws = Object.fromEntries(arms.map(a => [a, []])), diff = [];
  for (let b = 0; b < resamples; b++) {
    const acc = Object.fromEntries(arms.map(a => [a, []]));
    for (const s of sops) {
      const rows = rowsBoth[s]; if (!rows.length) continue;
      const pick = Array.from({ length: rows.length }, () => rows[Math.floor(r() * rows.length)]);
      for (const a of arms) acc[a].push(mean(pick.map(row => per[a][s].rowPass[row])));
    }
    for (const a of arms) draws[a].push(mean(acc[a]));
    if (arms.includes('W') && arms.includes('A')) diff.push(mean(acc.W) - mean(acc.A));
  }
  const ci = xs => { const v = [...xs].sort((x, y) => x - y); return [v[Math.floor(0.025 * v.length)], v[Math.ceil(0.975 * v.length) - 1]]; };
  for (const a of arms) out.arms[a].ci95 = ci(draws[a]);
  if (diff.length) out.wMinusA = { macro: (out.arms.W.macroPassK ?? 0) - (out.arms.A.macroPassK ?? 0), ci95: ci(diff) };
  return out;
}

/** The decision rule of DESIGN.md §7, evaluated on the analysis (and on the analysis without the orchestration-only SOPs). */
export function decide(an, anNoOrch, w) {
  const W = an.arms.W, A = an.arms.A;
  const rel = W && W.macroPassK >= 0.9 && W.ci95[0] >= 0.85 && anNoOrch?.arms.W?.macroPassK >= 0.9 && anNoOrch?.arms.W?.ci95[0] >= 0.85;
  const vsAgent = W && A && an.wMinusA.macro >= 0.05 && an.wMinusA.ci95[0] > 0;
  const cost = W && A && w?.amortisedPerRunUsd !== undefined ? w.amortisedPerRunUsd < A.costUsd / Math.max(1, A.runs) : null;
  return { reliabilityClaim: Boolean(rel), beatsAgent: Boolean(vsAgent), cheaperThanAgent: cost };
}

export async function sealedRun(o) {
  const log = o.log ?? (m => process.stderr.write(m + '\n'));
  const splitFile = o.split ?? undefined, dataDir = o.dataDir ?? null, upstream = o.upstream ?? undefined;
  const split = loadSplit(splitFile);
  const freeze = verifyFreeze(o.freeze, { split, checkCode: o.checkCode ?? true, root: o.root ?? REPO });
  const io = { split: splitFile, dataDir, upstream };
  const arms = o.arms ?? ['W', 'A'];
  // A cell runs its own SOPs, rows, catalogs and workflows: a distractor-ablation cell (DESIGN.md §8) or a separately reported
  // SOP (owner decision D3). The default is the primary run: freeze.primarySops (older freezes: freeze.sops).
  const cell = o.cell ? (freeze.cells ?? []).find(c => c.id === o.cell) : null;
  if (o.cell && !cell) throw new Error(`no cell ${o.cell} in the freeze`);
  const primary = freeze.primarySops ?? freeze.sops;
  const sops = (o.sops ?? cell?.sops ?? primary).filter(s => (cell?.sops ?? primary).includes(s));
  const artifactsOf = cell ? cell.artifacts : freeze.artifacts;
  const rowsOf = s => (cell ? cell.rows[s].sealed : split.sops[s].sealed);
  const catalogOf = s => (cell?.catalogs?.[s] ? path.resolve(o.root ?? REPO, cell.catalogs[s].file) : null);
  if (cell) for (const s of sops) {
    if (!cell.rows[s].sealed.every(r => split.sops[s].sealed.includes(r))) throw new Error(`cell ${cell.id}: rows of ${s} are not sealed rows`);
    if (cell.catalogs?.[s] && sha256(readFileSync(catalogOf(s))) !== cell.catalogs[s].sha256) throw new Error(`cell ${cell.id}: catalog of ${s} changed since the freeze`);
    const f = artifactFiles(path.resolve(o.root ?? REPO, cell.artifacts[s].dir));
    if (!f || artifactSha256(f) !== cell.artifacts[s].sha256) throw new Error(`cell ${cell.id}: artifact of ${s} changed since the freeze`);
  }
  const k = freeze.k;
  const policy = loadPolicy();
  for (const m of [freeze.arms.A.model, ...freeze.arms.W.judgeModels]) if (modelById(policy.policy, m).provider !== 'claude-cli') throw new Error(`model ${m} is not served by claude-cli (this harness's executor)`);
  const live = path.join(WORK_ROOT, 'sopbench', o.runId);
  const rowsDir = path.join(o.rowsRoot ?? ROWS_ROOT, o.runId);
  mkdirSync(live, { recursive: true }); mkdirSync(rowsDir, { recursive: true });
  const rawFile = path.join(rowsDir, 'runs.raw.jsonl'), gradedFile = path.join(rowsDir, 'runs.sealed.jsonl'), faultsFile = path.join(rowsDir, 'faults.jsonl');
  const launch = { freezeSha256: sha256(readFileSync(o.freeze)), cell: o.cell ?? 'primary', arms, sops, k, capUsd: o.capUsd };
  const launchFile = path.join(live, 'launch.json');
  if (existsSync(launchFile) && !o.resume) throw new Error(`${live} holds a run: --resume or a new --run-id`);
  if (existsSync(launchFile) && readJson(launchFile).freezeSha256 !== launch.freezeSha256) throw new Error('resume refused: another freeze file');
  writeJson(launchFile, { ...launch, history: [...(existsSync(launchFile) ? readJson(launchFile).history ?? [] : []), new Date().toISOString()] });
  // Prepare every SOP's sealed rows (refused by the bridge without this freeze).
  for (const s of sops) if (!existsSync(path.join(live, 'prep', s, 'meta.json'))) await prepareRows({ sop: s, rows: rowsOf(s), live, sealed: true, freeze: o.freeze, catalog: catalogOf(s), ...io });
  const files = Object.fromEntries(sops.map(s => [s, artifactsOf[s] ? artifactFiles(path.resolve(o.root ?? REPO, artifactsOf[s].dir)) : null]));
  const expectedOf = (s, r) => readJson(path.join(live, 'prep', s, 'rows', String(r), 'expected.json'));
  // Jobs: rows round-robin over SOPs; per row k forks; per fork both arms (order alternates).
  const done = new Set([...readRecords(gradedFile), ...readRecords(rawFile)].map(r => `${r.arm}:${r.sop}:${r.row}:${r.fork}`));
  const maxRows = Math.max(...sops.map(s => rowsOf(s).length));
  const jobs = [];
  for (let i = 0; i < maxRows; i++) for (const s of sops) { const row = rowsOf(s)[i]; if (row === undefined) continue;
    for (let fork = 0; fork < k; fork++) for (const arm of (fork % 2 ? [...arms].reverse() : arms)) if (!done.has(`${arm}:${s}:${row}:${fork}`)) jobs.push({ arm, sop: s, row, fork }); }
  log(`[sealed] ${o.runId}: ${jobs.length} runs to go (${sops.length} SOPs, k=${k}, arms ${arms.join('+')})`);
  const { port, db } = o.noModels ? { port: null, db: { close() {} } } : createModelPort({ journalFile: path.join(live, 'journal.sqlite'), allowedModels: [...new Set(freeze.arms.W.judgeModels)], concurrency: { 'claude-cli': 4 } });
  let spent = readRecords(rawFile).reduce((a, r) => a + (r.costUsd ?? 0), 0) + readRecords(faultsFile).reduce((a, r) => a + (r.costUsd ?? 0), 0), reserved = 0, stopped = null, next = 0, finished = 0;
  const pending = [];
  const gradePending = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0);
    const g = await gradeAnswers(batch.map(r => ({ sop: r.sop, row: r.row, text: r.answerText ?? '' })), { liveDir: live, sealed: true, freeze: o.freeze, expectedOf, ...io });
    for (const [i, r] of batch.entries()) appendFileSync(gradedFile, JSON.stringify({ ...r, strict: g[i].strict, upstream: g[i].upstream, graderAgree: g[i].agree }) + '\n');
  };
  const budgetOf = arm => (arm === 'A' ? freeze.arms.A.budgetUsd : freeze.arms.W.budgetUsdPerRun);
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, jobs.length)) }, async () => {
      while (next < jobs.length && !stopped) {
        const job = jobs[next++];
        const b = budgetOf(job.arm);
        while (spent + reserved + b > o.capUsd + 1e-9) { if (reserved <= 1e-9) { stopped ??= 'the cap'; break; } await new Promise(r => setTimeout(r, 500)); }
        if (stopped) break;
        reserved += b;
        const tag = `${job.arm}-${job.sop}-${job.row}-${job.fork}`;
        let rec;
        if (job.arm === 'W' && !files[job.sop]) {
          // A SOP whose build failed has no workflow: every W run of it is a fail (DESIGN.md §10).
          rec = { ...job, status: 'no-workflow', answerText: '', costUsd: 0, envFault: false };
        } else if (job.arm === 'W') {
          const w = freeze.arms.W;
          const x = await runWorkflowRow({ files: files[job.sop], prepDir: path.join(live, 'prep', job.sop), sop: job.sop, row: job.row, live, tag, sealed: true, freeze: o.freeze,
            modelPort: port, judgeModels: w.judgeModels, budgetUsd: w.budgetUsdPerRun, timeoutMs: w.timeoutMs, maxSteps: w.maxSteps, catalog: catalogOf(job.sop),
            sdkDir: w.sdk ? path.resolve(o.root ?? REPO, w.sdk.dir) : null, ...io });
          rec = { ...job, status: x.status, answerText: x.answerText, costUsd: x.costUsd, judgeCalls: x.judgeCalls, steps: x.steps, toolCalls: x.toolCalls, sections: x.sections.length,
            deopt: x.deopt, error: x.error ? String(x.error).slice(-400) : null, durationMs: x.durationMs, envFault: x.status === 'env' };
        } else {
          const a = freeze.arms.A;
          const { rec: r } = await runAgentRow({ sop: job.sop, row: job.row, prepDir: path.join(live, 'prep', job.sop), live, tag, hostDir: path.join(live, 'host', tag), runner: o.runner ?? runClaudeCode, catalog: catalogOf(job.sop), ...io,
            model: a.model, budgetUsd: a.budgetUsd, maxSteps: a.maxSteps, timeoutMin: a.timeoutMin, effort: a.effort, tools: a.tools, sealed: true, freeze: o.freeze, audit: true });
          const v = [...(r.session?.violations ?? []), ...(r.nestedModelUses ? ['nested model use'] : [])];
          rec = { ...job, answerText: v.length ? '' : r.answerText ?? '', liveAnswerSha256: sha256(r.answerText ?? ''), violations: v, costUsd: r.costUsd, steps: r.steps ?? null,
            sessionError: r.sessionError ?? null, harnessError: r.harnessError ?? null, durationMs: r.durationMs ?? null, envFault: isEnvFault(r) };
        }
        reserved -= b; spent += rec.costUsd ?? 0;
        pruneHost(live, tag, job.arm, rec);
        if (rec.envFault) { appendFileSync(faultsFile, JSON.stringify(rec) + '\n'); stopped ??= `environment fault at ${tag}: ${rec.sessionError ?? rec.harnessError ?? rec.error ?? rec.status}`; break; }
        appendFileSync(rawFile, JSON.stringify(rec) + '\n');
        pending.push(rec);
        finished++;
        if (pending.length >= (o.gradeEvery ?? 40)) await gradePending();
        if (finished % 50 === 0) log(`[sealed] ${finished}/${jobs.length} runs, $${spent.toFixed(3)} spent (no grades shown while the run is open)`);
      }
    }));
    await gradePending();
  } finally { db.close(); }
  // Records graded in an earlier, interrupted invocation are in gradedFile; ungraded raw ones are graded now.
  const graded = readRecords(gradedFile);
  const gradedKeys = new Set(graded.map(r => `${r.arm}:${r.sop}:${r.row}:${r.fork}`));
  const orphans = readRecords(rawFile).filter(r => !gradedKeys.has(`${r.arm}:${r.sop}:${r.row}:${r.fork}`));
  if (orphans.length) { pending.push(...orphans); await gradePending(); }
  const all = readRecords(gradedFile);
  const summary = { runId: o.runId, cell: launch.cell, freeze: path.relative(REPO, o.freeze), freezeSha256: launch.freezeSha256, evidence: 'SEALED rows (frozen split, frozen workflows and code)', stopped, k, arms, sops,
    runs: all.length, spentUsd: spent, capUsd: o.capUsd, finishedAt: new Date().toISOString(),
    dependencyDrift: Object.entries(dependencyHashes()).filter(([p, h]) => (freeze.dependencies ?? {})[p] !== undefined && freeze.dependencies[p] !== h).map(([p]) => p) };
  if (!stopped) {
    const an = analyse(all, { sops, arms, k });
    const orch = freeze.orchestrationOnly ?? [];
    const anNoOrch = analyse(all, { sops: sops.filter(s => !orch.includes(s)), arms, k, resamples: 2000 });
    const buildUsd = freeze.arms.W.buildCostUsd ?? null;
    const wRuns = all.filter(r => r.arm === 'W').length;
    const w = buildUsd !== null && wRuns ? { amortisedPerRunUsd: (buildUsd + an.arms.W.costUsd) / wRuns } : undefined;
    Object.assign(summary, { analysis: an, analysisWithoutOrchestrationOnly: anNoOrch, wCost: w ?? null, decision: arms.length === 2 && !cell ? decide(an, anNoOrch, w) : null,   // the decision rule covers the primary run only
      ...(cell ? { cellNote: cell.separate ? 'separately reported SOP (owner decision D3): not in the primary set or the decision rule' : `ablation cell: ${cell.compareWith ?? 'see DESIGN.md §8'}` } : {}),
      statuses: Object.fromEntries(arms.map(a => [a, all.filter(r => r.arm === a).reduce((m, r) => ({ ...m, [r.status ?? (r.violations?.length ? 'violation' : 'session')]: (m[r.status ?? (r.violations?.length ? 'violation' : 'session')] ?? 0) + 1 }), {})])),
      graderDisagreements: all.filter(r => r.graderAgree && (r.graderAgree.strict === false || r.graderAgree.upstream === false)).length });
  }
  writeJson(path.join(live, 'summary.json'), summary);
  if (o.outDir !== null) {
    const out = o.outDir ?? path.join(RESEARCH, 'runs', o.runId);
    mkdirSync(out, { recursive: true });
    writeJson(path.join(out, 'summary.json'), summary);
  }
  if (stopped) log(`[sealed] STOPPED: ${stopped}. Resume with the same command and --resume.`);
  return { summary, stopped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2), a = {};
  for (let i = 0; i < argv.length; i++) { const n = argv[i].slice(2); if (n === 'resume') a.resume = true; else a[n] = argv[++i]; }
  const { summary, stopped } = await sealedRun({ freeze: path.resolve(a.freeze), runId: a['run-id'], capUsd: Number(a.cap), resume: Boolean(a.resume), cell: a.cell,
    arms: a.arms ? a.arms.split(',') : undefined, sops: a.sops ? a.sops.split(',') : undefined, concurrency: a.concurrency ? Number(a.concurrency) : 4, gradeEvery: a['grade-every'] ? Number(a['grade-every']) : 40 });
  const { analysis, analysisWithoutOrchestrationOnly, ...head } = summary;
  console.log(JSON.stringify({ ...head, macro: analysis?.arms ?? null }, null, 1));
  if (stopped) process.exit(stopped === 'the cap' ? 4 : 3);
}
