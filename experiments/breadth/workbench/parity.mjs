#!/usr/bin/env node
// WorkBench $0 gates through the full facade (PLAN §5.4 BG-1, BG-2, BG-3, BG-4, BG-11): every item is issued as MCP tool
// calls by a scripted client through a real relay process, the host mailbox and a live bed world, and graded host-side
// by WorkBench's own is_correct (bed.py grade) in a separate process. Each verdict is compared with the evaluator-level
// verdict on the intended action list (bed.py replay: no facade), so "parity" means the facade scores exactly as the
// benchmark's own evaluator would on the same trajectory.
//   node experiments/breadth/workbench/parity.mjs [--sets gold,nothing,mutants,baselines,violations,sealed]
//        [--concurrency 2] [--limit N] [--out FILE]
// Committed: aggregates (PARITY.json). Host-only: per-row verdicts (HOST_ONLY/parity/).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OPERATOR_ADDRESS, VIOLATION_CLASSES, constantItems, goldItems, nothingItems, replayItems, violationItems } from './baselines.mjs';
import { CLONE, HOST_ONLY, RESEARCH, bedJson, readJson, readJsonl, sha256, shippedTasks, writeJson, writeJsonl } from './lib.mjs';
import { cleanup, runDigest, runScriptedBatch } from './scripted.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SETS = opt('sets', 'gold,nothing,mutants,baselines,violations,sealed').split(',');
const CONC = Number(opt('concurrency', 2));
const LIMIT = opt('limit', null) === null ? Infinity : Number(opt('limit'));
const OUT = opt('out', path.join(RESEARCH, 'PARITY.json'));
const DIR = path.join(HOST_ONLY, 'parity');
const log = m => console.error(`[parity ${new Date().toISOString().slice(11, 19)}] ${m}`);
const pct = (a, b) => (b ? Math.round((a / b) * 10000) / 100 : null);

/** Evaluator-level reference verdicts on the intended action lists (no facade). */
async function reference(items, tasksFile, tag) {
  const inFile = path.join(DIR, `ref-${tag}-in.jsonl`), outFile = path.join(DIR, `ref-${tag}.jsonl`);
  writeJsonl(inFile, items.map(it => ({ id: it.task.id, key: it.key, op: it.kind, actions: it.actions })));
  await bedJson(['replay', '--tasks', tasksFile, '--in', inFile, '--out', outFile], { cwd: DIR });
  return new Map(readJsonl(outFile).map(v => [v.key, v]));
}

/** Run items through the facade, grade, compare with the reference; per-row records go host-only. */
async function facadeRun(items, tasksFile, tag) {
  const t0 = Date.now();
  const r = await runScriptedBatch({ items, tasksFile, label: `parity-${tag}`, concurrency: CONC, log });
  const ref = await reference(items, tasksFile, tag);
  const byKey = new Map(r.verdicts.map(v => [v.key, v]));
  const rows = r.rows.map(row => {
    const v = byKey.get(row.key), f = ref.get(row.key);
    return { key: row.key, id: row.id, kind: items.find(i => i.key === row.key)?.kind, correct: v.correct, ref: f?.correct ?? null, agree: v.correct === f?.correct,
      native: v.native_correct, nativeAgree: v.agree, liveMatchesReplay: v.live_matches_replay, actionsIdentical: JSON.stringify(row.actions) === JSON.stringify(row.intended),
      sideEffects: v.side_effects, fatal: row.fatal, equivalentRaw: f?.equivalent_raw ?? null, equivalentNorm: f?.equivalent_norm ?? null, executes: f?.executes ?? null,
      gtLen: v.gt_len, nActions: v.n_actions, envFault: row.facade.envFault, rejected: row.facade.rejected, refused: row.facade.refused };
  });
  writeJsonl(path.join(DIR, `${tag}.jsonl`), rows);
  const digest = runDigest(r.rows, r.verdicts);
  cleanup(r.liveRoot);
  log(`${tag}: ${rows.length} items in ${Math.round((Date.now() - t0) / 1000)} s`);
  return { rows, digest, ms: Date.now() - t0 };
}

function summarize(rows) {
  const n = rows.length;
  return { n, correct: rows.filter(r => r.correct).length, parityAgree: rows.filter(r => r.agree).length, nativeAgree: rows.filter(r => r.nativeAgree).length,
    liveMatchesReplay: rows.filter(r => r.liveMatchesReplay).length, actionsIdentical: rows.filter(r => r.actionsIdentical).length,
    envFaults: rows.filter(r => r.envFault).length, rejected: rows.reduce((a, r) => a + r.rejected, 0), fatal: rows.filter(r => r.fatal).length };
}
const byDomain = (rows, tasks) => {
  const dom = new Map(tasks.map(t => [t.id, t.domain])), out = {};
  for (const r of rows) { const d = dom.get(r.id); (out[d] ??= { n: 0, correct: 0 }); out[d].n++; out[d].correct += r.correct ? 1 : 0; }
  return out;
};

/** An untouched project task (in no gold list) and two board values, read host-side from the shipped CSV. */
function untouchedTask(tasks) {
  const lines = readFileSync(path.join(CLONE, 'data/processed/project_tasks.csv'), 'utf8').trim().split('\n').slice(1);
  const gold = tasks.map(t => t.outcome.join(' ')).join('\n');
  for (const l of lines) {
    const cols = l.split(','), id = cols[0], board = cols.at(-1);
    if (!gold.includes(id) && ['Front end', 'Back end', 'Design'].includes(board)) return { taskId: id, board, otherBoard: board === 'Design' ? 'Front end' : 'Design' };
  }
  throw new Error('no untouched project task');
}

const t0 = Date.now();
const tasks = (await shippedTasks({ cwd: DIR })).slice(0, LIMIT);
const tasksFile = path.join(DIR, 'tasks.jsonl');
writeJsonl(tasksFile, await shippedTasks({ cwd: DIR }));
const split = readJson(path.join(RESEARCH, 'SPLIT.json'));
const devSet = new Set(split.devTemplates);
const devTasks = tasks.filter(t => devSet.has(t.template_id));
const prev = existsSync(OUT) ? readJson(OUT) : {};
const res = { ...prev, bed: 'WorkBench @49c7dfd00c03d384ec59ea57374f50b766aa5613', at: new Date().toISOString(), concurrency: CONC, limit: Number.isFinite(LIMIT) ? LIMIT : null,
  path: 'scripted MCP client -> mcp-relay.mjs (stdio JSON-RPC) -> mailbox -> host.mjs -> bed.py serve (unshare -rn, python -I) -> live world; graded by bed.py grade (WorkBench is_correct) in a separate process; reference = bed.py replay (evaluator-level, no facade)' };

let nothingRows = null;
if (SETS.includes('gold') || SETS.includes('nothing')) {
  const items = [...(SETS.includes('gold') ? goldItems(tasks) : []), ...(SETS.includes('nothing') ? nothingItems(tasks) : [])];
  const a = await facadeRun(items, tasksFile, 'gold-nothing-run1');
  const b = await facadeRun(items, tasksFile, 'gold-nothing-run2');
  const gold = a.rows.filter(r => r.kind === 'gold'), none = a.rows.filter(r => r.kind === 'nothing');
  nothingRows = none;
  const gtLens = gold.map(r => r.gtLen);
  res.BG1_gold = { ...summarize(gold), byDomain: byDomain(gold, tasks), goldLength: { min: Math.min(...gtLens), max: Math.max(...gtLens), mean: Math.round((gtLens.reduce((x, y) => x + y, 0) / gtLens.length) * 100) / 100,
    histogram: gtLens.reduce((h, l) => ({ ...h, [l]: (h[l] ?? 0) + 1 }), {}) }, pass: gold.every(r => r.correct && r.agree && r.nativeAgree && r.liveMatchesReplay) };
  res.BG2_doNothing = { ...summarize(none), byDomain: byDomain(none, tasks), stateChanging: none.filter(r => !r.correct).length };
  res.BG4_determinism = { run1: a.digest, run2: b.digest, identical: a.digest === b.digest, items: items.length, msPerItem: Math.round(a.ms / items.length) };
}

if (SETS.includes('mutants')) {
  const mfile = path.join(DIR, 'mutants.jsonl');
  const shippedFile = path.join(DIR, 'tasks-limited.jsonl');
  writeJsonl(shippedFile, tasks);
  await bedJson(['mutants', '--tasks', shippedFile, '--out', mfile], { cwd: DIR });
  const byId = new Map(tasks.map(t => [t.id, t]));
  const items = readJsonl(mfile).map(m => ({ key: m.key, kind: m.op, task: byId.get(m.id), actions: m.actions, detail: m.detail }));
  const r = await facadeRun(items, tasksFile, 'mutants');
  const ops = {};
  for (const op of [...new Set(r.rows.map(x => x.kind))].sort()) {
    const rs = r.rows.filter(x => x.kind === op);
    const equivalent = rs.filter(x => x.equivalentRaw);           // same final world as gold, exact text: a true equivalent mutant
    const tolerated = rs.filter(x => !x.equivalentRaw && x.equivalentNorm); // differs only in what the official comparison ignores (letter case)
    const live = rs.filter(x => !x.equivalentRaw);
    const killed = live.filter(x => !x.correct);
    ops[op] = { n: rs.length, equivalentRaw: equivalent.length, toleratedCaseOnly: tolerated.length, nonEquivalent: live.length, killed: killed.length, killRate: pct(killed.length, live.length),
      survivors: live.filter(x => x.correct).map(x => x.key).slice(0, 25), equivalentPassed: equivalent.filter(x => x.correct).length, parityAgree: rs.filter(x => x.agree).length };
  }
  const newOps = ['wrong_argument', 'extra_write', 'duplicate_write'];
  const nl = newOps.reduce((a, o) => a + (ops[o]?.nonEquivalent ?? 0), 0), nk = newOps.reduce((a, o) => a + (ops[o]?.killed ?? 0), 0);
  res.BG3_mutation = { operators: ops, newOperators: newOps, newOperatorsKillRate: pct(nk, nl), threshold: 95, pass: newOps.every(o => (ops[o]?.killRate ?? 0) >= 95),
    rule: 'kill rate = killed / non-equivalent; a mutant is equivalent when its full final world (all tables, exact text, row order ignored) equals gold\'s (bed.py replay equivalent_raw); tolerated = differs from gold only in letter case of case-insensitive fields',
    parityAgree: r.rows.filter(x => x.agree).length, n: r.rows.length, digest: r.digest };
}

if (SETS.includes('baselines')) {
  const { items: constItems, fitted } = constantItems(tasks, devTasks);
  const items = [...constItems, ...replayItems(tasks)];
  const r = await facadeRun(items, tasksFile, 'baselines');
  const noneRows = nothingRows ?? (existsSync(path.join(DIR, 'gold-nothing-run1.jsonl')) ? readJsonl(path.join(DIR, 'gold-nothing-run1.jsonl')).filter(x => x.kind === 'nothing') : []);
  const stateChanging = new Set(noneRows.filter(x => !x.correct).map(x => x.id));
  const heldSet = new Set(split.heldOutTemplates);
  const tmpl = new Map(tasks.map(t => [t.id, t.template_id]));
  const agentSummary = rows => ({ all: { n: rows.length, correct: rows.filter(x => x.correct).length, rate: pct(rows.filter(x => x.correct).length, rows.length) },
    stateChanging: (() => { const s = rows.filter(x => stateChanging.has(x.id)); return { n: s.length, correct: s.filter(x => x.correct).length, rate: pct(s.filter(x => x.correct).length, s.length) }; })(),
    dev: (() => { const s = rows.filter(x => devSet.has(tmpl.get(x.id))); return { n: s.length, correct: s.filter(x => x.correct).length, rate: pct(s.filter(x => x.correct).length, s.length) }; })(),
    heldOutShipped: (() => { const s = rows.filter(x => heldSet.has(tmpl.get(x.id))); return { n: s.length, correct: s.filter(x => x.correct).length, rate: pct(s.filter(x => x.correct).length, s.length) }; })(),
    sideEffects: rows.filter(x => x.sideEffects).length, parityAgree: rows.filter(x => x.agree).length });
  res.BG2_baselines = {
    definitions: { nothing: 'no tool call', constant: 'the single most frequent non-empty gold action list among dev-template instances, issued on every task (task-blind)',
      constant_domain: 'its domain\'s most frequent non-empty dev gold list (knows only the domain)', replay: 'naive reuse: replays the gold list of one sibling instance of the same template (sha256-chosen); the floor for copying a cluster\'s previous solution without adaptation' },
    fittedOn: 'dev templates only (SPLIT.json)', constantActions: fitted.global.actions, constantDomainActions: Object.fromEntries(Object.entries(fitted.perDomain).map(([d, f]) => [d, f.actions])),
    stateChangingN: stateChanging.size,
    agents: { nothing: noneRows.length ? agentSummary(noneRows) : null, constant: agentSummary(r.rows.filter(x => x.kind === 'constant')), constant_domain: agentSummary(r.rows.filter(x => x.kind === 'constant_domain')), replay: agentSummary(r.rows.filter(x => x.kind === 'replay')) },
    digest: r.digest };
}

if (SETS.includes('violations')) {
  const untouched = untouchedTask(tasks);
  const items = violationItems(tasks, { untouched });
  const r = await facadeRun(items, tasksFile, 'violations');
  const mut = res.BG3_mutation?.operators ?? {};
  const classes = {};
  for (const [k, c] of Object.entries(VIOLATION_CLASSES)) {
    const rs = r.rows.filter(x => x.kind === k);
    if (rs.length) {
      const nonEq = rs.filter(x => !x.equivalentRaw);
      classes[k] = { ...c, n: rs.length, nonEquivalent: nonEq.length, primaryPass: rs.filter(x => x.correct).length, primaryFailRate: pct(rs.filter(x => !x.correct).length, rs.length),
        officialSideEffectFlag: rs.filter(x => x.sideEffects).length, equivalentRaw: rs.length - nonEq.length, parityAgree: rs.filter(x => x.agree).length };
    } else if (mut[k]) {
      classes[k] = { ...c, source: 'BG3 mutants', n: mut[k].n, nonEquivalent: mut[k].nonEquivalent, primaryFailRate: mut[k].killRate, equivalentRaw: mut[k].equivalentRaw };
    } else classes[k] = { ...c, n: 0 };
  }
  res.BG11_hardViolations = { operatorAddress: OPERATOR_ADDRESS, untouchedTask: untouched, classes,
    summary: 'state-exact primary outcome (is_correct over calendar_events, emails, plots_data, project_tasks, crm_data; src/evals/evaluation.py:174-200) fails on every hard violation that leaves a net state change; it is blind to a transient violation that is undone before the end (transient_write) and to letter case (case_only, by design). The official harm metric (has_side_effects, evaluation.py:203-230) excludes charts and is computed only on incorrect runs.',
    digest: r.digest };
}

if (SETS.includes('sealed')) {
  // Gold replay through the facade on the sealed sets (primary and companion), twice; aggregates only (host-only rows).
  const out = {};
  for (const [name, file] of [['primary', path.join(HOST_ONLY, 'sealed/MANIFEST.json')], ['companion', path.join(HOST_ONLY, 'sealed/COMPANION.json')]]) {
    if (!existsSync(file)) continue;
    const m = readJson(file);
    const sealedTasksFile = path.join(DIR, `sealed-${name}-tasks.jsonl`);
    writeJsonl(sealedTasksFile, m.instances);
    const items = goldItems(m.instances.slice(0, LIMIT));
    const a = await facadeRun(items, sealedTasksFile, `sealed-${name}-1`), b = await facadeRun(items, sealedTasksFile, `sealed-${name}-2`);
    out[name] = { manifestSha256: sha256(JSON.stringify(m)), ...summarize(a.rows), digestIdentical: a.digest === b.digest, pass: a.rows.every(x => x.correct && x.agree && x.nativeAgree) && a.digest === b.digest };
  }
  res.BG1_sealedGold = out;
}

res.ms = Date.now() - t0;
writeJson(OUT, res);
console.log(JSON.stringify({ gold: res.BG1_gold && `${res.BG1_gold.correct}/${res.BG1_gold.n} (parity ${res.BG1_gold.parityAgree})`, nothing: res.BG2_doNothing && `${res.BG2_doNothing.correct}/${res.BG2_doNothing.n}`,
  determinism: res.BG4_determinism?.identical, mutation: res.BG3_mutation && { killRate: res.BG3_mutation.newOperatorsKillRate, pass: res.BG3_mutation.pass },
  sealed: res.BG1_sealedGold, ms: res.ms }, null, 1));
