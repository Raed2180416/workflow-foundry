#!/usr/bin/env node
// Proving a workflow for the registry (research/reuse-20261021/PREREG-C2-1.md §2). An entry is registered only with the
// evidence that proved it, gathered in the environment of the program that built it:
// - a SOP-Bench frozen workflow (program A) is re-run, byte-identical, on its SOP's dev rows (build + repair) through the
//   SOP-Bench bridge on the dev world and graded strictly; the rows it passes, its inputs and its run traces become the
//   entry's evidence and its two profiles (gate.mjs). Sealed rows are never touched (the bridge refuses them).
// - a workflow built by program B (build-b.mjs) is proved the same way on the labelled examples it was built from, in
//   B's world, and registered scoped to its supplier.
//   node experiments/reuse/prove.mjs --sop dangerous_goods --run-id c2-1        ($0 for code-only workflows)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { artifactFiles, artifactSha256, prepareRows, runWorkflowSet } from '../sopbench/exec.mjs';
import { loadSplit } from '../sopbench/split.mjs';
import { learnInputProfile, learnTraceProfile, GATE_VERSION } from './gate.mjs';
import { contractHashOf, contractOf, createRegistry } from './registry.mjs';
import { FROZEN_P2, LIVE_ROOT, RESEARCH, readJson, readJsonl, sha256, writeJson } from './lib.mjs';
import { DG_TOOLS } from './world-b.mjs';

/** Write a profile to the run directory; returns { file, sha256 }. */
export function saveProfile(dir, name, profile) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`), text = JSON.stringify(profile);
  writeFileSync(file, text);
  return { file, sha256: sha256(text) };
}

/** A feature summary of a profile that holds no value from the profiled data (for the repo). */
export function profileSummary(profile) {
  return { schema: profile.schema, n: profile.n, paths: Object.fromEntries(Object.entries(profile.paths).map(([p, s]) => [p, {
    types: Object.keys(s.types).sort(), tasks: s.tasks, ...(s.num ? { num: { min: s.num.min, max: s.num.max }, int: !!s.int } : {}),
    ...(s.alen ? { alen: { min: s.alen.min, max: s.alen.max } } : {}), ...(s.slen ? { slen: { min: s.slen.min, max: s.slen.max } } : {}),
    sets: Object.fromEntries(['classes', 'sigs', 'vocab', 'values'].filter(k => s[k]?.df).map(k => [k, Object.keys(s[k].df).length])) }])) };
}

/** The proven rows' scores, from the bridge call log of a run (component order of DG_TOOLS). */
function scoresOfCalls(calls) {
  const out = {};
  for (const c of calls) {
    const spec = DG_TOOLS[c.name];
    if (!spec) continue;
    try { const v = JSON.parse(c.content); out[spec.comp] = Number.isInteger(v?.[spec.key]) ? v[spec.key] : null; } catch { out[spec.comp] = null; }
  }
  return out;
}

/**
 * proveFrozenSop({ sop, runId, live }) -> { entry, bank, evidence }. Re-runs the frozen p2 workflow of `sop` on its dev rows.
 */
export async function proveFrozenSop({ sop = 'dangerous_goods', runId, live = path.join(LIVE_ROOT, runId), log = m => process.stderr.write(m + '\n') }) {
  const split = loadSplit();
  const e = split.sops[sop];
  const rows = [...e.build, ...e.repair];
  const prepDir = await prepareRows({ sop, rows, live, world: 'dev', prepName: `proof-${sop}` });
  const dir = path.join(FROZEN_P2, sop), sdkDir = path.join(FROZEN_P2, 'sdk');
  const files = artifactFiles(dir);
  const t0 = Date.now();
  const { records, summary } = await runWorkflowSet({ sop, files, rows, live, prepDir, world: 'dev', sdkDir, concurrency: 4, tagPrefix: 'proof' });
  log(`[prove] ${sop}: ${summary.passingRows.length}/${rows.length} strict on dev rows in ${((Date.now() - t0) / 1000).toFixed(0)} s, statuses ${JSON.stringify(summary.statuses)}`);
  const tasks = [], runs = [], bank = [];
  for (const r of records) {
    const task = readJson(path.join(prepDir, 'rows', String(r.row), 'task.json'));
    const calls = readJsonl(path.join(r.hostDir, 'calls.jsonl')).filter(c => c.name);
    const events = readJsonl(path.join(r.hostDir, 'trace.jsonl'));
    tasks.push(task);
    runs.push({ calls, events, answer: r.answer, status: r.status, strict: r.strict });
    const scores = scoresOfCalls(calls);
    bank.push({ row: r.row, inputs: task.inputs, scores, total: Object.values(scores).reduce((a, v) => a + (v ?? 0), 0), strict: r.strict });
  }
  // Evidence: only rows the workflow passed prove it; profiles are learned from those rows' inputs and runs.
  const passed = records.map((r, i) => (r.strict ? i : -1)).filter(i => i >= 0);
  const inputProfile = learnInputProfile(passed.map(i => tasks[i]));
  const traceProfile = learnTraceProfile(passed.map(i => runs[i]));
  const procedureText = readFileSync(path.join(prepDir, 'sop.txt'), 'utf8');
  const catalog = readJson(path.join(prepDir, 'catalog.json'));
  const meta = readJson(path.join(prepDir, 'meta.json'));
  const contract = contractOf({ procedureText, catalog, inputColumns: meta.input_columns, outputColumns: meta.output_columns });
  const id = `sopbench-p2:${sop}`;
  const pdir = path.join(live, 'registry', 'profiles');
  const entry = {
    id, contractHash: contractHashOf(contract), contract,
    artifact: { dir, sha256: artifactSha256(files), files: Object.keys(files).sort() },
    sdk: { dir: sdkDir, sha256: artifactSha256({ 'flow.mjs': readFileSync(path.join(sdkDir, 'flow.mjs'), 'utf8'), 'sop.mjs': readFileSync(path.join(sdkDir, 'sop.mjs'), 'utf8'), 'model.mjs': readFileSync(path.join(sdkDir, 'model.mjs'), 'utf8') }) },
    origin: { program: 'SOP-Bench phase 2 (build once, frozen p2)', freeze: 'research/sopbench-20261021/FREEZE-p2.json',
      evidence: { kind: 'dev rows (build + repair), strict, re-run here through the SOP-Bench bridge', rows, pass: passed.length, of: rows.length, rowsPassed: passed.map(i => records[i].row),
        runSha256: sha256(JSON.stringify(records.map(r => [r.row, r.status, r.strict, r.answerSha256]))) } },
    profiles: { input: saveProfile(pdir, `${sop}.input`, inputProfile), trace: saveProfile(pdir, `${sop}.trace`, traceProfile) },
    gate: { version: GATE_VERSION, learnParams: 'PARAMS_V2' },
    effects: 'none (read-only scoring lookups)',
  };
  writeJson(path.join(live, 'proof', `${sop}.bank.json`), bank);
  writeJson(path.join(live, 'proof', `${sop}.prep.json`), { prepDir, catalogFile: path.join(prepDir, 'catalog.json'), sopFile: path.join(prepDir, 'sop.txt') });
  const reg = createRegistry({ file: path.join(live, 'registry', 'registry.jsonl') });
  if (!reg.get(id)) reg.register(entry);
  const repo = { id, contractHash: entry.contractHash, contract, artifact: { sha256: entry.artifact.sha256, files: entry.artifact.files, dir: path.relative(path.resolve(FROZEN_P2, '../../../..'), dir) },
    sdk: { sha256: entry.sdk.sha256 }, origin: entry.origin, profiles: { input: { sha256: entry.profiles.input.sha256, summary: profileSummary(inputProfile) }, trace: { sha256: entry.profiles.trace.sha256, summary: profileSummary(traceProfile) } },
    gate: entry.gate, effects: entry.effects };
  writeJson(path.join(RESEARCH, 'runs', runId, `entry-${sop}.json`), repo);
  return { entry, bank, evidence: entry.origin.evidence, records };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, xs) => (x.startsWith('--') ? [...acc, [x.slice(2), xs[i + 1]]] : acc), []));
  if (!a['run-id']) throw new Error('--run-id required');
  const { evidence } = await proveFrozenSop({ sop: a.sop ?? 'dangerous_goods', runId: a['run-id'] });
  console.log(JSON.stringify(evidence));
}
