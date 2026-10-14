#!/usr/bin/env node
// eval-invariance.mjs (ATTACK-20261014 §3 M1; PROOF-LEDGER K3, K4): the $0 offline evaluation of output-invariance contracts
// and witness tags. No model is called anywhere: every compiled run goes through run-compiled.mjs with a STRICT memo port
// over the archived run's own journal rows (createMemoPort without a live port: a request the journal cannot answer throws
// REPLAY_MISS and nothing is spent). Three parts:
//   (A) archived. Every compiled answer of the archived dev streams (<runs>/<experiment>/<jit arm>/: results.jsonl,
//       journal.jsonl, solvers/) is rebuilt from the version in force and that run's journal rows (fidelity: its oracle score
//       equals the archived row's when the row delivered it), labelled right or wrong by the bed oracle (analyst side, dev
//       seeds), and then each declared relation's variants (K seeds) run through the same solver, each with a fresh strict
//       memo port over the same rows. A variant that needs a request the journal does not hold is 'needs-paid-judges' (not
//       measured: its judge prompts changed, so only a paid run can answer them); one that runs on journal answers alone is
//       measured. Judge answers are therefore held fixed for identical requests: what is measured is the code path's order
//       and state dependence, not a fresh judge sample.
//   (B) synthetic panel. Deterministic text-level solvers that read only task.inputs: the records text solver
//       (beds/records/solve-text.mjs) and its single-judgment ablations (known-wrong solvers), and the kinetics white-box
//       parser (beds/kinetics/attacks/whitebox-v4.mjs, written with the generator open) at d3, where it is mostly right.
//   (C) witness. Per bed, witnessCheck on the reference answer (false alarms) and on every bad control (recall per tag).
// The M1 rule (ATTACK §3): adopt as a contract if the variants flag >= 50% of wrong compiled outputs at <= 10% false alarms
// on correct ones in both (i) the archived versions and (ii) a fresh dev range; kill below 25%. Only part of (i) runs at $0.
//
//   node experiments/jit/eval-invariance.mjs [--runs research/jit-20261008/runs] [--experiments jit-dev-records-1,jit-dev-kinetics-1]
//        [--k 3] [--parts archived,synthetic,witness] [--work <dir>] [--keep] [--out <file.json>] [--concurrency 2] [--json]
import path from 'node:path';
import os from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCompiled, createMemoPort, DEFAULT_FLOW } from './run-compiled.mjs';
import { runVariants, validateRelations } from './invariance.mjs';
import { flowFileOf } from './prompts.mjs';
import { loadFamily, makeTasks } from '../lib/beds.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUNS = path.join(REPO, 'research/jit-20261008/runs');
export const DEFAULT_EXPERIMENTS = Object.freeze(['jit-dev-records-1', 'jit-dev-kinetics-1']);
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

async function pool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

// ------------------------------------------------------------------------------------------------ (A) archived
// The compiled answers of one archived arm: rows whose compiled run returned ok (delivered, adjudicated or shadowed).
export function compiledRowsOf(rows) {
  return rows.filter(r => r.compiledStatus === 'ok' && r.stateAfter?.version?.dir && Number.isInteger(r.version)).sort((a, b) => a.idx - b.idx);
}
export const journalPrefixOf = row => `${row.experiment}:${row.armSlug}:${row.idx}:v${row.version}:`;
const taskOfKey = async key => { const m = /^(.+):([a-z]+):d(\d+):s(\d+)$/.exec(key); const [t] = await makeTasks(m[1], { split: m[2], seeds: [Number(m[4])], difficulty: Number(m[3]) }); return t; };

// One replay: a strict memo port over `journal` (no live port) and runCompiled. Returns the run and the memo stats.
async function replay({ solvePath, task, journal, workdir, familyId, flowPath }) {
  const port = createMemoPort({ journal, strict: true });
  const run = await runCompiled({ solvePath, task, modelPort: port, perTaskUsd: 1, timeoutMs: 10 * 60 * 1000, workdir, familyId, flowPath, label: 'm1-replay' });
  return { run, stats: port.memo.stats() };
}

// Evaluate one archived compiled answer. Returns the record of part (A) for it.
export async function evalArchivedRow({ row, armDir, bed, relations, k, work, flowPath }) {
  const task = (await taskOfKey(row.taskKey)).task;
  const journal = readJsonl(path.join(armDir, 'journal.jsonl')).filter(j => typeof j.runId === 'string' && j.runId.startsWith(journalPrefixOf(row)));
  const verDir = row.stateAfter.version.dir.replace(/^versions\//, '');
  const solvePath = [path.join(armDir, 'solvers', verDir, 'solve.mjs'), path.join(armDir, 'versions', verDir, 'solve.mjs')].find(existsSync);
  const base = { experiment: row.experiment, arm: row.armSlug, idx: row.idx, taskKey: row.taskKey, difficulty: row.difficulty, version: row.version, solver: verDir, delivered: row.delivered,
    archivedPass: row.pass, archivedScore: row.score, journalRows: journal.length };
  if (!solvePath) return { ...base, status: 'no-solver' };
  const dir = path.join(work, `${row.armSlug}-${row.idx}`);
  const orig = await replay({ solvePath, task, journal, workdir: path.join(dir, 'original'), familyId: bed.family.id, flowPath });
  base.original = { status: orig.run.status, requests: orig.stats.requests, hits: orig.stats.hits, misses: orig.stats.misses, costUsd: orig.run.costUsd };
  if (orig.run.status !== 'ok' || orig.stats.misses > 0) return { ...base, status: 'original-not-replayable' };
  const output = orig.run.output, sc = bed.oracle(task, output);
  const fidelity = row.delivered === 'compiled' ? sc.score === row.score : null;
  const rec = { ...base, status: 'evaluated', compiledPass: !!sc.pass, compiledScore: sc.score, fidelity, witness: bed.witnessOf(task).primary,
    witnessCheck: (bed.witnessCheck?.(task, output) ?? []).length, variants: [] };
  for (let n = 0; n < k; n++) {
    const stats = new Map();
    const v = await runVariants({ relations, task, output, seed: `m1:${row.experiment}:${row.armSlug}:${row.idx}:${n}`, stopOnViolation: false,
      runVariant: async (vt, rel) => {
        const r = await replay({ solvePath, task: vt, journal, workdir: path.join(dir, `v${n}-${rel.id}`), familyId: bed.family.id, flowPath });
        stats.set(rel.id, r.stats);
        return r.run;
      } });
    for (const x of v.results) {
      const st = stats.get(x.relation);
      const needsPaid = st && st.misses > 0;
      rec.variants.push({ k: n, relation: x.relation, distribution: relations.find(r => r.id === x.relation)?.distribution ?? null,
        status: needsPaid ? 'needs-paid-judges' : x.status, ...(st ? { requests: st.requests, hits: st.hits, misses: st.misses } : {}),
        ...(x.status === 'disagree' && !needsPaid ? { levels: [...new Set(x.violations.map(y => y.level))], violations: x.violations.slice(0, 5) } : {}),
        ...(x.reason ? { reason: x.reason } : {}), ...(x.deopt ? { deopt: x.deopt } : {}), ...(x.error ? { error: x.error } : {}), info: x.info ?? null });
    }
  }
  return rec;
}

// Flag rules over a row's variants, for one view (a filter on variants: all, the first seed only, 'in' relations only, one
// relation). measurable: at least one variant ran on journal answers alone; flagged: one of those disagreed; pending: the
// relations of the view none of whose variants could run at $0 (only paid judge calls can say whether they would flag).
const measured = vs => vs.filter(v => v.status === 'agree' || v.status === 'disagree');
export const VIEWS = Object.freeze({ any: () => true, firstDraw: v => v.k === 0, inDistribution: v => v.distribution === 'in' });
export function rowFlags(rec, view = VIEWS.any) {
  const vs = (rec.variants ?? []).filter(view), m = measured(vs), rels = [...new Set(vs.map(v => v.relation))];
  const pending = rels.filter(id => !m.some(v => v.relation === id) && vs.some(v => v.relation === id && v.status === 'needs-paid-judges'));
  return { measurable: m.length > 0, flagged: m.some(v => v.status === 'disagree'), pending };
}

// The M1 rule on part (i) at $0 for one view. lower = flagged / all wrong (pending counted as missed); upper = (flagged +
// wrong outputs with a pending relation) / all wrong (pending counted as caught); measured = flagged / measurable wrong;
// false alarms = flagged / measurable right.
export function m1Rule(recs, view = VIEWS.any) {
  const ev = recs.filter(r => r.status === 'evaluated'), wrong = ev.filter(r => !r.compiledPass), right = ev.filter(r => r.compiledPass);
  const f = r => rowFlags(r, view);
  const wM = wrong.filter(r => f(r).measurable).length, wF = wrong.filter(r => f(r).flagged).length, wP = wrong.filter(r => !f(r).flagged && f(r).pending.length).length;
  const cM = right.filter(r => f(r).measurable).length, cF = right.filter(r => f(r).flagged).length;
  const lower = wrong.length ? wF / wrong.length : null, upper = wrong.length ? (wF + wP) / wrong.length : null, fa = cM ? cF / cM : null;
  let verdict;
  if (!wrong.length) verdict = 'no wrong compiled output';
  else if (upper < 0.25) verdict = 'KILL on (i): recall < 25% even if every relation that needs paid judges flagged its output';
  else if (lower >= 0.5 && fa != null && fa <= 0.1) verdict = 'meets (i); (ii) on a fresh dev range still decides';
  else if (wP) verdict = `open: ${wP} of ${wrong.length} wrong outputs have relations that only paid judge calls can run`;
  else verdict = 'open: between the lines on (i)';
  return { wrong: wrong.length, wrongMeasurable: wM, wrongFlagged: wF, wrongPending: wP, right: right.length, rightMeasurable: cM, rightFlagged: cF,
    recallLowerPct: lower == null ? null : pct(wF, wrong.length), recallMeasuredPct: pct(wF, wM), recallUpperPct: upper == null ? null : pct(wF + wP, wrong.length),
    falseAlarmPct: fa == null ? null : pct(cF, cM), verdict };
}
// The rule per view and per relation.
export function m1Rules(recs) {
  const rels = [...new Set(recs.flatMap(r => (r.variants ?? []).map(v => v.relation)))];
  return { ...Object.fromEntries(Object.entries(VIEWS).map(([k, view]) => [k, m1Rule(recs, view)])),
    byRelation: Object.fromEntries(rels.map(id => [id, m1Rule(recs, v => v.relation === id)])) };
}

export async function evalArchived({ runs = DEFAULT_RUNS, experiments = DEFAULT_EXPERIMENTS, k = 3, work, concurrency = 2, log = () => {} }) {
  const out = [];
  for (const experiment of experiments) {
    const expDir = path.join(runs, experiment);
    if (!existsSync(expDir)) { log(`(A) ${experiment}: not found`); continue; }
    for (const arm of readdirSync(expDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name.startsWith('jit-')).map(d => d.name).sort()) {
      const armDir = path.join(expDir, arm), rows = compiledRowsOf(readJsonl(path.join(armDir, 'results.jsonl')));
      if (!rows.length) continue;
      const bed = await loadFamily(rows[0].taskKey.split(':')[0]), relations = validateRelations(bed.invariance ?? [], bed.family.id);
      const armJson = existsSync(path.join(armDir, 'arm.json')) ? JSON.parse(readFileSync(path.join(armDir, 'arm.json'), 'utf8')) : {};
      const pv = armJson.def?.compile?.promptVersion ?? 1, flowPath = pv >= 2 ? path.join(HERE, flowFileOf({ promptVersion: pv })) : DEFAULT_FLOW;
      const recs = new Array(rows.length);
      await pool(rows, concurrency, async (row, i) => {
        recs[i] = await evalArchivedRow({ row, armDir, bed, relations, k, work, flowPath });
        const r = recs[i], fl = r.status === 'evaluated' ? rowFlags(r) : null;
        log(`(A) ${experiment} ${arm} #${row.idx} ${row.taskKey.split(':').pop()} v${row.version}: ${r.status}${r.status === 'evaluated' ? ` ${r.compiledPass ? 'right' : 'WRONG'} (fidelity ${r.fidelity}), variants measured ${measured(r.variants).length}/${r.variants.length}, flagged ${fl.flagged}${fl.pending.length ? `, pending ${fl.pending.join('+')}` : ''}` : ''}`);
      });
      out.push(...recs);
    }
  }
  return out;
}

// Per (experiment, relation) counts of variant statuses, and the judge-call boundary (which relations stay at $0).
export function relationTable(recs) {
  const t = {};
  for (const r of recs.filter(x => x.status === 'evaluated')) for (const v of r.variants) {
    const key = `${r.experiment}|${v.relation}`, x = t[key] ??= { experiment: r.experiment, relation: v.relation, distribution: v.distribution, variants: 0, measured: 0, disagree: 0, disagreeOnWrong: 0, disagreeOnRight: 0, needsPaidJudges: 0, skip: 0, variantNotOk: 0, paidJudgeAt: {} };
    x.variants++;
    if (v.status === 'agree' || v.status === 'disagree') x.measured++;
    if (v.status === 'disagree') { x.disagree++; if (r.compiledPass) x.disagreeOnRight++; else x.disagreeOnWrong++; }
    if (v.status === 'needs-paid-judges') { x.needsPaidJudges++; const at = v.deopt?.name ?? v.deopt?.kind ?? v.status; x.paidJudgeAt[at] = (x.paidJudgeAt[at] ?? 0) + 1; }
    if (v.status === 'skip') x.skip++;
    if (v.status.startsWith('variant-')) x.variantNotOk++;
  }
  return Object.values(t);
}

// ------------------------------------------------------------------------------------------------ (B) synthetic panel
export async function evalSynthetic({ k = 5 } = {}) {
  const rec = await import('../../beds/records/index.mjs'), { solveText, ABLATIONS } = await import('../../beds/records/solve-text.mjs');
  const records = { solver: 'beds/records/solve-text.mjs (reads task.inputs only)', tasks: 0, right: 0, byRelation: {}, ablations: {} };
  const bump = (o, id, key) => { o[id] ??= { variants: 0, flagged: 0 }; o[id].variants++; if (key) o[id].flagged++; };
  for (const d of [3, 4, 5]) for (let s = 201; s <= 224; s++) {
    const t = rec.generate({ seed: s, split: 'dev', difficulty: d }), o = solveText(t);
    records.tasks++;
    if (!rec.oracle(t, o).pass) continue;
    records.right++;
    for (const rel of rec.invariance) for (let n = 0; n < k; n++) {
      const m = rel.make(structuredClone(t), { seed: `syn:${s}:${d}:${n}`, output: o });
      if (m.skip) continue;
      bump(records.byRelation, rel.id, rel.check(o, solveText(m.task), m.info).length > 0);
    }
  }
  for (const a of ABLATIONS) {
    const x = records.ablations[a] = { wrong: 0, flagged: 0, byRelation: {} };
    for (let s = 201; s <= 212; s++) {
      const t = rec.generate({ seed: s, split: 'dev', difficulty: 3 }), o = solveText(t, { ablate: a });
      if (rec.oracle(t, o).pass) continue;
      x.wrong++;
      let any = false;
      for (const rel of rec.invariance) {
        const m = rel.make(structuredClone(t), { seed: `syn:${s}:3:0`, output: o });
        if (m.skip) continue;
        const hit = rel.check(o, solveText(m.task, { ablate: a }), m.info).length > 0;
        bump(x.byRelation, rel.id, hit); any ||= hit;
      }
      if (any) x.flagged++;
    }
  }
  const kin = await import('../../beds/kinetics/index.mjs'), { heuristicSolve } = await import('../../beds/kinetics/attacks/whitebox-v4.mjs');
  const kinetics = { solver: 'beds/kinetics/attacks/whitebox-v4.mjs (white-box parser, generator source open; d3 dev 201-240)', tasks: 0, right: 0, rightByRelation: {}, wrong: 0, wrongFlagged: 0, wrongByRelation: {} };
  for (let s = 201; s <= 240; s++) {
    const t = kin.generate({ seed: s, split: 'dev', difficulty: 3 });
    let o; try { o = heuristicSolve(structuredClone(t)); } catch { continue; }
    kinetics.tasks++;
    const right = kin.oracle(t, o).pass;
    if (right) kinetics.right++; else kinetics.wrong++;
    let any = false;
    for (const rel of kin.invariance) for (let n = 0; n < Math.min(k, 3); n++) {
      const m = rel.make(structuredClone(t), { seed: `syn:${s}:3:${n}`, output: o });
      if (m.skip) continue;
      let ov; try { ov = heuristicSolve(structuredClone(m.task)); } catch { ov = null; }
      const hit = rel.check(o, ov, m.info, {}).length > 0;
      bump(right ? kinetics.rightByRelation : kinetics.wrongByRelation, rel.id, hit); any ||= hit && !right;
    }
    if (any) kinetics.wrongFlagged++;
  }
  return { records, kinetics };
}

// ------------------------------------------------------------------------------------------------ (C) witness
export const WITNESS_BEDS = Object.freeze(['records', 'kinetics', 'wbed-r1', 'wbed-r2', 'wbed-r3', 'wbed-r4', 'wbed-r5']);
export async function evalWitness({ beds = WITNESS_BEDS, seeds = [301, 302, 303, 304, 305, 306] } = {}) {
  const out = [];
  for (const id of beds) {
    const b = await loadFamily(id), ds = id === 'kinetics' ? [4, 5] : [3, 4];
    const x = { bed: id, primary: b.witness.primary, tags: b.witness.tags, checks: b.witness.checks.map(c => `${c.tag}/${c.scope}`), reference: 0, referenceFlagged: 0, wrong: 0, wrongFlagged: 0, byControl: {} };
    for (const d of ds) for (const seed of seeds) {
      const t = b.generate({ seed, split: 'dev', difficulty: d });
      // R5's hash-total check reads the trailer the way a correct decoder does: analyst side here (dumpOf), the agent node's
      // verbatim-quoted report at run time.
      const ctx = id === 'wbed-r5' ? { trailer: b.dumpOf(t).trailer } : {};
      x.reference++; if (b.witnessCheck(t, b.referenceSolve(t), ctx).length) x.referenceFlagged++;
      for (const c of b.badControls) {
        if (c.minDifficulty && d < c.minDifficulty) continue;
        let o; try { o = c.make(t); } catch { continue; }
        if (b.oracle(t, o).pass) continue;
        const y = x.byControl[c.name] ??= { wrong: 0, flagged: 0 };
        y.wrong++; x.wrong++;
        if (b.witnessCheck(t, o, ctx).length) { y.flagged++; x.wrongFlagged++; }
      }
    }
    out.push(x);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ CLI
export function parseArgs(argv) {
  const o = { runs: DEFAULT_RUNS, experiments: [...DEFAULT_EXPERIMENTS], k: 3, parts: ['archived', 'synthetic', 'witness'], work: null, keep: false, out: null, concurrency: 2, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--runs') { o.runs = path.resolve(v); i++; } else if (a === '--experiments') { o.experiments = v.split(','); i++; } else if (a === '--k') { o.k = Number(v); i++; }
    else if (a === '--parts') { o.parts = v.split(','); i++; } else if (a === '--work') { o.work = path.resolve(v); i++; } else if (a === '--out') { o.out = path.resolve(v); i++; }
    else if (a === '--concurrency') { o.concurrency = Number(v); i++; } else if (a === '--keep') o.keep = true; else if (a === '--json') o.json = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!(Number.isInteger(o.k) && o.k >= 1)) throw new Error('--k must be an integer >= 1');
  for (const p of o.parts) if (!['archived', 'synthetic', 'witness'].includes(p)) throw new Error(`--parts: unknown part ${p}`);
  return o;
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const o = parseArgs(argv);
  const work = o.work ?? mkdtempSync(path.join(os.tmpdir(), 'eval-invariance-'));
  mkdirSync(work, { recursive: true });
  const result = { tool: 'experiments/jit/eval-invariance.mjs', modelCalls: 0, k: o.k, experiments: o.experiments };
  try {
    if (o.parts.includes('archived')) {
      const recs = await evalArchived({ runs: o.runs, experiments: o.experiments, k: o.k, work, concurrency: o.concurrency, log: o.json ? () => {} : log });
      const byExp = Object.fromEntries(o.experiments.map(e => [e, recs.filter(r => r.experiment === e)]));
      result.archived = {
        rows: recs,
        relations: relationTable(recs),
        rule: Object.fromEntries(Object.entries(byExp).map(([e, rs]) => [e, m1Rules(rs)])),
        pooled: m1Rules(recs),
        fidelity: { checked: recs.filter(r => r.fidelity != null).length, matched: recs.filter(r => r.fidelity === true).length },
        notReplayable: recs.filter(r => r.status !== 'evaluated').map(r => ({ experiment: r.experiment, arm: r.arm, idx: r.idx, status: r.status, original: r.original ?? null })),
      };
    }
    if (o.parts.includes('synthetic')) result.synthetic = await evalSynthetic({ k: 5 });
    if (o.parts.includes('witness')) result.witness = await evalWitness();
  } finally { if (!o.keep && !o.work) rmSync(work, { recursive: true, force: true }); }
  if (o.out) { mkdirSync(path.dirname(o.out), { recursive: true }); writeFileSync(o.out, JSON.stringify(result, null, 1) + '\n'); }
  if (o.json) log(JSON.stringify(result, null, 1));
  else {
    if (result.archived) {
      const line = (e, view, x) => log(`(i) ${e} [${view}]: wrong ${x.wrongFlagged}/${x.wrong} flagged (measurable ${x.wrongMeasurable}, pending ${x.wrongPending}), right ${x.rightFlagged}/${x.rightMeasurable} measurable flagged; recall ${x.recallLowerPct}% (measured ${x.recallMeasuredPct}%, upper ${x.recallUpperPct}%), false alarms ${x.falseAlarmPct}% -> ${x.verdict}`);
      for (const [e, r] of [...Object.entries(result.archived.rule), ['pooled', result.archived.pooled]]) {
        for (const view of Object.keys(VIEWS)) line(e, view, r[view]);
        for (const [id, x] of Object.entries(r.byRelation)) line(e, id, x);
      }
      for (const t of result.archived.relations) log(`    ${t.experiment} ${t.relation} (${t.distribution}): ${t.measured}/${t.variants} measured at $0, ${t.needsPaidJudges} need paid judges ${JSON.stringify(t.paidJudgeAt)}, ${t.skip} skipped, ${t.variantNotOk} variant not ok; disagree ${t.disagree} (wrong ${t.disagreeOnWrong}, right ${t.disagreeOnRight})`);
      log(`    fidelity ${result.archived.fidelity.matched}/${result.archived.fidelity.checked}; not replayable ${result.archived.notReplayable.length}`);
    }
    if (result.synthetic) {
      const s = result.synthetic;
      log(`(B) records text solver: right ${s.records.right}/${s.records.tasks}; false alarms ${JSON.stringify(s.records.byRelation)}`);
      const ab = Object.values(s.records.ablations); log(`(B) records ablations: flagged ${ab.reduce((a, x) => a + x.flagged, 0)}/${ab.reduce((a, x) => a + x.wrong, 0)} wrong outputs over ${ab.length} ablations`);
      log(`(B) kinetics white-box parser d3: right ${s.kinetics.right}/${s.kinetics.tasks}; on right answers ${JSON.stringify(s.kinetics.rightByRelation)}; wrong flagged ${s.kinetics.wrongFlagged}/${s.kinetics.wrong} ${JSON.stringify(s.kinetics.wrongByRelation)}`);
    }
    if (result.witness) for (const w of result.witness) log(`(C) ${w.bed} [${w.primary}]: reference flagged ${w.referenceFlagged}/${w.reference}; bad controls flagged ${w.wrongFlagged}/${w.wrong}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(String(e?.stack ?? e)); process.exit(2); });
}
