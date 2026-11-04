// DUR-1 runner (PREREG-DUR-1 §13; BUILD-PLAN rows 11-18). One entry point for every stage; each paid stage refuses to
// start without --paid, a matching freeze (F-A for the author, F-B for everything else) and room in the $80 ledger.
//
//   node experiments/durability/run.mjs dry [--lineages b1lh-e8-1,ch-e8-1] [--out DIR]      $0 end to end (stubs only)
//   node experiments/durability/run.mjs stagez [--streams s1,s2,s3] [--out DIR]              $0 Stage Z (needs SEALED)
//   node experiments/durability/run.mjs author --paid                                         P1 (freeze F-A)
//   node experiments/durability/run.mjs p0 --paid                                             P0 rehearsal (F-B)
//   node experiments/durability/run.mjs heal --streams s1,s2 --paid [--lineages ...]          P2 C-O + P3 MH-H (F-B)
//   node experiments/durability/run.mjs windows --streams s1,s2 --paid [--kind A-H|A-Ox]      P4 / P5 / P8 (F-B)
//   node experiments/durability/run.mjs refm --paid                                           P6 REF-M on s1 (F-B)
//   node experiments/durability/run.mjs redteam --paid                                        P7 J2 (F-B)
//   node experiments/durability/run.mjs forks --paid                                          P9 MH-stale, LD-H, MH-H->O (F-B)
//   node experiments/durability/run.mjs analyze [--out DIR]                                   $0 report from the run records
// Environment faults (rate or session limit, model or sandbox unavailable) are never scored: the chain script waits 30
// minutes and resumes (dur1-chain.sh). Every stage resumes from its records: a lineage-stream with a record is skipped.
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { worldsOf, dryWorlds, STREAM_IDS, PRACTICE, assertDurSeeds, allScheduledSeeds, AUTHOR_VALIDATION, CHANGES, T0_MS, DAY_MS } from './schedule.mjs';
import { buildBundle, loadSealed, evidenceBundle, ROOT, WORK } from './changes.mjs';
import { referencePools, gradeRun } from './oracle.mjs';
import { runBundle, programVersion, controlVersion, BAD_CONTROLS, LINEAGES, AS_DELIVERED, REF_SOLVERS } from './arms.mjs';
import { runStream, ContractOwner } from './stream.mjs';
import { stubSession, HAIKU_PATCH, OPUS_PATCH, spendOf, StopError } from './heal-adapter.mjs';
import { stubCO, CO_SESSION } from './contracts-owner.mjs';
import { streamExposure, attributeRecord, modelOf, certifyRecord } from './model.mjs';
import { report, renderReport } from './report.mjs';
import { rStaticVersion, ruleTimes, maintSwitches, ceilSwitches, switchTimeline, LAGS } from './rmaint.mjs';
import { selectWindow, runWindow, WINDOW_CHANGES, K_DEFAULT, AGENT } from './windows.mjs';
import { runLD, LATENT, stubLD, manifestOf } from './ld.mjs';
import { search, confirm, evaluate } from './wc-search.mjs';
import { redTeamSession, stubRedTeam, blindBaseline, RT_SESSIONS } from './redteam/session.mjs';
import { sweepStream } from './sweep.mjs';
import { harmShield, shieldRefusals } from './shield-harm.mjs';
import { calibrate, runDetector, instanceTasks } from './edetector.mjs';
import { powerReport } from './power.mjs';
import { runAuthor, authorGates, stubAuthor, AUTHOR_SESSION, SEALED_DIR } from './author.mjs';
import { checkFreeze } from './freeze.mjs';
import { exposureSummary, exposureOf } from './exposure.mjs';
import { armVersion } from './arms.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
export const RES = path.join(ROOT, 'research/durability-20261021');
export const RUNS = process.env.DUR1_RUNS ?? path.join(RES, 'runs');   // tests point DUR1_RUNS at a scratch directory
export const SPEND = path.join(RUNS, 'spend.jsonl');
export const TOTAL_CAP = 80;
/** Prereg §12: priority order, per-row caps (USD). A session starts only if total spent + its cap <= $80. */
export const PRIORITY = Object.freeze([
  { row: 'P0', item: 'rehearsal (MH-H mini-stream, A-H window)', cap: 2 },
  { row: 'P1', item: 'sealed author', cap: 4 },
  { row: 'P2', item: 'C-O', cap: 6 },
  { row: 'P3', item: 'MH-H streams s1-s2', cap: 15 },
  { row: 'P4', item: 'A-H windows s1-s2 + repeat', cap: 13 },
  { row: 'P5', item: 'stream s3 (MH-H + A-H)', cap: 13 },
  { row: 'P6', item: 'REF-M on s1', cap: 6 },
  { row: 'P7', item: 'J2 red team', cap: 8 },
  { row: 'P8', item: 'A-Ox probe', cap: 7 },
  { row: 'P9', item: 'MH-stale, LD-H, MH-H->O', cap: 5 },
  { row: 'reserve', item: 'faulted sessions, overruns', cap: 1 },
]);
export const capOf = row => PRIORITY.find(p => p.row === row)?.cap ?? 0;

/** The prereg §12 row of a ledger scope (attempt suffixes `#a<n>` keep their row). */
export function rowOf(scope) {
  const s = String(scope);
  if (/^P0|^p0/.test(s)) return 'P0';
  if (/^P1$|^author/.test(s)) return 'P1';
  if (/^co-/.test(s)) return 'P2';
  if (/^MH-H\.[^.]+\.s3/.test(s) || /^A-H\..*s3/.test(s)) return 'P5';
  if (/^MH-H\./.test(s)) return 'P3';
  if (/^A-H\./.test(s)) return 'P4';
  if (/^REF-M\./.test(s)) return 'P6';
  if (/^J2|^RT-|^A-H-RT/.test(s)) return 'P7';
  if (/^A-Ox/.test(s)) return 'P8';
  if (/^MH-stale|^LD-H|^MH-HO/.test(s)) return 'P9';
  return 'reserve';
}

/** Room left in a row: cumulative caps through it minus committed spend (upper: open sessions at their cap) through it. */
export function rowRoom(row, ledger = SPEND) {
  const order = PRIORITY.map(p => p.row);
  const i = order.indexOf(row);
  if (i < 0) return 0;
  const s = spendOf(ledger);
  const capThrough = PRIORITY.slice(0, i + 1).reduce((a, p) => a + p.cap, 0);
  const spentThrough = Object.entries(s.byScope).filter(([sc]) => order.indexOf(rowOf(sc)) <= i).reduce((a, [, v]) => a + v, 0);
  return Math.min(capThrough - spentThrough, TOTAL_CAP - s.upperUsd);
}

const argv = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const flag = name => argv.includes(`--${name}`);
const list = (name, dflt) => (opt(name) ? opt(name).split(',').filter(Boolean) : dflt);
const stamp = () => new Date().toISOString().slice(11, 19);

/**
 * A paid session config (model, effort, caps from the frozen constants) with the spend ledger, the freeze gate and the row
 * room gate, kept apart (review B4/R2-B1): a failed freeze stops the chain (exit 3); no room in the row is a budget stop.
 */
export function paidSession(conf, { scope, row, freeze, scopeCap = capOf(row) }) {
  if (!conf.effort) throw new Error(`DUR1_EFFORT: ${conf.role ?? conf.model} has no effort (D28 (4))`);
  return { kind: 'paid', ...conf, spend: { file: SPEND, scope, totalCap: TOTAL_CAP, scopeCap }, checkFreeze: () => freeze,
    checkRoom: () => { const room = rowRoom(row); return room + 1e-9 >= conf.budgetUsd ? { ok: true } : { ok: false, reason: `row ${row} has $${room.toFixed(2)} left, session cap $${conf.budgetUsd}` }; } };
}

/** Refuse a paid stage unless --paid, the freeze holds and the ledger has room for the row's cap. */
export async function guardPaid(stage, row) {
  if (!flag('paid')) throw Object.assign(new Error(`DUR1_UNPAID: ${stage} spends money; pass --paid (after the freeze)`), { code: 'DUR1_UNPAID' });
  const fz = await checkFreeze(row === 'P1' ? 'A' : 'B');
  if (!fz.ok) throw Object.assign(new Error(`DUR1_FREEZE: ${JSON.stringify(fz).slice(0, 400)}`), { code: 'DUR1_FREEZE' });
  const s = spendOf(SPEND);
  if (s.upperUsd >= TOTAL_CAP) throw Object.assign(new Error(`DUR1_BUDGET: $${s.upperUsd.toFixed(2)} of $${TOTAL_CAP} committed`), { code: 'DUR1_BUDGET' });
  mkdirSync(RUNS, { recursive: true });
  return fz;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pieces shared by the dry run and Stage Z

/** V-1 / V-2 / V-3 on one world spec: reference pools, bad controls, exposure floors (sealed counts only). */
export async function gatesOfWorld(spec, { sealed, controls = BAD_CONTROLS, floors = true }) {
  const b = await buildBundle(spec, { sealed });
  const ref = await referencePools(b);
  const out = { key: b.key, world: b.worldDigest, completed: ref.control.completed, v1: ref.control.ok, v1Problems: ref.control.problems.slice(0, 3), v2: {}, v3: null };
  const changed = spec.changes.length > 0;
  if (changed) for (const c of controls) {
    const run = await runBundle(b, { version: controlVersion(c) });
    const g = gradeRun(b, run.rows, ref.pools);
    out.v2[c] = g.passed < g.completed || g.oracleErrors > 0 ? 'fails' : 'PASSES';
  }
  if (floors && changed) { const ex = await exposureOf(spec, { sealed, bundle: b }); out.v3 = exposureSummary(ex); }
  return out;
}

/** Static comparator runs of one stream: S-H* lineages, R-static, R-maint(L), R-ceil, REF-S, c-oss (as asked). */
export async function staticArms({ stream, worlds, sealed, lineages, refSolvers = Object.keys(REF_SOLVERS), coss = true, rmaint = true, lags = LAGS, exposure, co, runDir, log }) {
  const recs = { 'S-H*': {}, 'REF-S': {}, 'R-static': {}, 'R-maint0': {}, 'R-maint2': {}, 'R-maint7': {}, 'R-ceil': {}, 'c-oss': {} };
  for (const l of lineages) recs['S-H*'][l] = await runStream({ arm: 'static', label: `S-Hstar.${l}.${stream}`, start: programVersion(LINEAGES[l], { id: l }), worlds, sealed, co, runDir, log });
  for (const s of refSolvers) recs['REF-S'][s] = await runStream({ arm: 'static', label: `REF-S.${s}.${stream}`, start: programVersion(REF_SOLVERS[s], { id: s }), worlds, sealed, co, runDir, log });
  if (coss) recs['c-oss'].ref = await runStream({ arm: 'static', label: `c-oss.${stream}`, start: Object.freeze({ ...controlVersion('c-oss'), digest: 'control-c-oss' }), worlds, sealed, co, runDir, log });
  recs['R-static'].ref = await runStream({ arm: 'static', label: `R-static.${stream}`, start: rStaticVersion(), worlds, sealed, co, runDir, log });
  if (rmaint) {
    const times = ruleTimes({ staticRecord: recs['R-static'].ref, worlds, exposure: k => exposure.of(k) });
    const cache = new Map();
    for (const L of lags) {
      const sw = maintSwitches(times, L);
      recs[`R-maint${L}`].ref = await runStream({ arm: 'static', label: `R-maint${L}.${stream}`, start: rStaticVersion(), worlds, sealed, co, runDir, log, timelineFor: spec => switchTimeline(spec.k, sw, { cache, label: `R-maint${L}` }) });
    }
    const sw = ceilSwitches(times);
    recs['R-ceil'].ref = await runStream({ arm: 'static', label: `R-ceil.${stream}`, start: rStaticVersion(), worlds, sealed, co, runDir, log, timelineFor: spec => switchTimeline(spec.k, sw, { cache, label: 'R-ceil' }) });
    recs.ruleTimes = times;
  }
  return recs;
}

/** A $0 stub per-tick agent runner: writes a do-nothing output (exercises routing, the validator and the cost meter). */
export const stubAgentRunner = async ({ workdir }) => {
  const input = JSON.parse(readFileSync(path.join(workdir, 'task.json'), 'utf8'));
  writeFileSync(path.join(workdir, 'output.json'), JSON.stringify({ decisions: { subject: input.carry?.subject ?? null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], carry: input.carry ?? null }));
  return { costUsd: 0, turns: 0 };
};

// ---------------------------------------------------------------------------------------------------------------------
// The $0 dry run: every piece end to end on the rehearsal mini-stream with stubs. Never a DUR-1 result.

export async function dry({ lineages = ['b1lh-e8-1', 'ch-e8-1'], out = path.join(WORK, 'dry'), log = m => console.log(`${stamp()} ${m}`), light = false } = {}) {
  mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  const summary = { label: 'DUR-1 $0 DRY RUN (rehearsal seeds 1207-1208, size 24, stub sealed bundle, stub sessions): plumbing only, never evidence', steps: {} };
  const step = async (name, fn) => { const t = Date.now(); log(`-- ${name}`); try { summary.steps[name] = { ok: true, ...(await fn()), ms: Date.now() - t }; } catch (e) { summary.steps[name] = { ok: false, error: String(e?.stack ?? e).slice(0, 600), ms: Date.now() - t }; log(`!! ${name}: ${String(e?.message ?? e).slice(0, 300)}`); } };
  // Seeds and the stub sealed bundle (the author's gates on one validation world, at the dry size).
  const stubFile = path.join(ROOT, 'experiments/durability/fixtures/sealed-stub.json');
  const sealed = loadSealed(stubFile);
  const worlds = dryWorlds();
  await step('seeds', async () => { assertDurSeeds(allScheduledSeeds()); assertDurSeeds(worlds.map(w => w.seed)); let refused = 0; for (const s of [1161, 1168, 9101, 9201, 9301, 8801, 1170, 1189]) { try { assertDurSeeds([s]); } catch { refused += 1; } } return { scheduled: allScheduledSeeds().length, refusedOutside: `${refused}/8` }; });
  await step('author-stub', async () => {
    const r = await runAuthor({ session: stubAuthor(), sealedDir: path.join(out, 'sealed'), sealedJson: path.join(out, 'SEALED.dry.json'), log, gateOpts: { seeds: [AUTHOR_VALIDATION[0]], size: 24, controls: ['noop', 'charge-twice'] } });
    return { sealedOk: r.ok, sha256: r.sha256?.slice(0, 16) ?? null, worlds: (r.counts?.worlds ?? []).map(w => ({ seed: w.seed, referenceOk: w.referenceOk, exposure: w.exposure, controls: w.controls })) };
  });
  // Stage Z gates on the dry worlds.
  await step('stagez-gates', async () => ({ worlds: await Promise.all(worlds.map(async w => gatesOfWorld(w, { sealed, controls: light ? ['noop', 'charge-twice'] : BAD_CONTROLS }))) }));
  let ex = null;
  await step('exposure', async () => { ex = await streamExposure(worlds, { sealed }); return { floors: ex.floors }; });
  const runDir = path.join(out, 'runs');
  const practice = PRACTICE.slice(0, 1);      // dry: one practice world (1235, d2) instead of three, for speed
  const co = new ContractOwner({ session: id => (id === 'R1' ? stubCO('analyst-R1') : id === 'R2s' ? stubCO('notice:review-cleared:1970-01-01T00:00:00Z') : stubCO('none')), runDir, sealed, log, practice });
  let stat = null;
  await step('static-arms', async () => {
    stat = await staticArms({ stream: 'r1', worlds, sealed, lineages, refSolvers: light ? ['S1'] : ['S1', 'S2'], coss: !light, lags: light ? [2] : LAGS, exposure: ex, co, runDir, log });
    return { ruleTimes: stat.ruleTimes, worlds: Object.fromEntries(Object.entries(stat).filter(([k]) => k !== 'ruleTimes').flatMap(([arm, by]) => Object.entries(by).map(([u, r]) => [`${arm}/${u}`, r.worlds.map(w => `${w.gradeSummary.passed}/${w.gradeSummary.completed}`)]))) };
  });
  const healRecs = {};
  await step('heal-arm', async () => {
    for (const l of lineages) healRecs[l] = await runStream({ arm: 'heal', label: `MH-H.${l}.r1`, start: programVersion(LINEAGES[l], { id: l }), worlds, sealed, heal: { session: () => stubSession('scripted') }, co, runDir, log, practice });
    return { lineages: Object.fromEntries(Object.entries(healRecs).map(([l, r]) => [l, { worlds: r.worlds.map(w => `${w.gradeSummary.passed}/${w.gradeSummary.completed}`), sessions: r.sessions.length, promotions: r.promotions.length, rollbacks: r.rollbacks.length,
      incidents: r.incidents.length, prefixIdentical: r.worlds.flatMap(w => w.prefixChecks).filter(p => p.kind !== 're-execution').every(p => p.identical) }])) };
  });
  const staleRecs = {};
  await step('mh-stale-fork', async () => { const l = lineages[0]; staleRecs[l] = await runStream({ arm: 'heal', label: `MH-stale.${l}.r1`, start: programVersion(LINEAGES[l], { id: l }), worlds, sealed, heal: { session: () => stubSession('scripted'), stale: ['R1', 'vb'] }, co, runDir, log, practice }); return { lineage: l, worlds: staleRecs[l].worlds.map(w => `${w.gradeSummary.passed}/${w.gradeSummary.completed}`) }; });
  const attr = { 'S-H*': {}, 'MH-H': {} }, certs = {};
  await step('attribution', async () => {
    for (const l of lineages) { attr['S-H*'][l] = await attributeRecord({ rec: stat['S-H*'][l], worlds, ex, sealed }); attr['MH-H'][l] = await attributeRecord({ rec: healRecs[l], worlds, ex, sealed }); }
    return { induced: Object.fromEntries(Object.entries(attr).map(([a, by]) => [a, Object.fromEntries(Object.entries(by).map(([l, x]) => [l, Object.fromEntries(Object.entries(x).map(([k, v]) => [k, Object.fromEntries(Object.entries(v.induced).map(([c, s]) => [c, s.length]))]))]))])) };
  });
  await step('certification', async () => {
    for (const l of lineages) certs[l] = { r1: await certifyRecord({ rec: healRecs[l], worlds, sealed, attribution: attr['MH-H'][l], practice, exposure: ex.of }) };
    return { verdicts: Object.fromEntries(Object.entries(certs).map(([l, b]) => [l, b.r1.map(c => `${c.k}.${c.day} ${c.change}: ${c.verdict} (${c.label})`)])) };
  });
  let windowPairs = [];
  await step('windows-stub-agent', async () => {
    const spec = worlds[1];
    const b = await buildBundle(spec, { sealed });
    const ref = await referencePools(b);
    const exK = ex.of(spec.k);
    const ch = spec.changes.find(c => c.id === 'R2s');
    const sel = selectWindow({ stream: 'r1', change: 'R2s', exposed: exK.R2s ?? new Set(), pools: ref.pools, W: b.W, onsetMs: ch.onsetMs, k: 2 });
    const cases = [...sel.exposed, ...sel.controls];
    const r = await runWindow({ bundle: b, cases, kind: 'A-H', runner: stubAgentRunner, label: 'dry-R2s' });
    const g = gradeRun(b, r.rows, ref.pools);
    const agentPass = new Map(g.cases.map(c => [c.case, c.pass ? 1 : 0]));
    for (const l of lineages) { const w = healRecs[l].worlds.find(x => x.k === spec.k); for (const c of cases) if (w.grade[c]) windowPairs.push({ lineage: l, window: 'r1-R2s', case: c, heal: w.grade[c][0], agent: agentPass.get(c) ?? 0 }); }
    return { selected: cases.length, ticks: r.ticks, routedCases: r.routedCases.length, costUsd: r.costUsd, status: r.status, pairs: windowPairs.length };
  });
  let ldA = null;
  await step('ld-h-stub', async () => {
    const id = LATENT[0];
    const r = await runLD({ id, heal: { session: () => stubLD('revert', manifestOf(id)) }, co, runDir: path.join(out, 'ld'), maxWorlds: 1, log, practice });
    ldA = [r.analysis];
    return { id, healed: r.analysis.healed, durable: r.analysis.durable, regressions: r.analysis.regressions, falseComplaintHarm: r.analysis.falseComplaintHarm, promotions: r.analysis.promotions.length };
  });
  let wc = null;
  await step('wc1-search', async () => {
    const v = programVersion(LINEAGES[lineages[0]], { id: lineages[0] });
    const s = await search({ targetId: lineages[0], version: v, budget: light ? 4 : 8, poolSize: light ? 4 : 8, maxSize: 14, log });   // a small pool so the Poisson half samples at a toy budget
    const c = await confirm({ targetId: lineages[0], version: v, top: s.top.slice(0, 1), salts: 2 });
    wc = { search: s, confirm: c };
    return { used: s.used, budget: s.budget, htFailure: s.ht.failure, cvar10: s.cvar10, top: s.top.slice(0, 2).map(t => ({ key: t.key, score: t.score })), confirmed: c.map(x => ({ key: x.key, confirmed: x.confirmed, recur: x.recur })), bedFindings: s.bedFindings.length };
  });
  let rt = null;
  await step('redteam-stub', async () => {
    const v = programVersion(LINEAGES[lineages[0]], { id: lineages[0] });
    const r = await redTeamSession({ id: 'dry-rt', targetId: lineages[0], version: v, session: stubRedTeam({ probes: 2 }), runDir: path.join(out, 'redteam'), log });
    const blind = await blindBaseline({ targetId: lineages[0], version: v, probes: 2, log });
    const best = [];
    for (const x of r.validated.filter(y => y.valid)) best.push((await evaluate(lineages[0], v, x.vector)).silent ?? 0);
    rt = [{ target: lineages[0], redTeamBest: best.length ? Math.max(...best) : 0, blindBest: Math.max(0, ...blind.evaluated.map(e => e.silent ?? 0)) }];
    return { probes: r.record.probes, scenarios: r.record.scenarios, valid: r.record.valid, bedFindings: r.record.bedFindings, blindUsed: blind.used };
  });
  await step('sweep', async () => { const l = lineages[0]; const s = healRecs[l].promotions.length ? await sweepStream({ rec: healRecs[l], specs: worlds, sealed }) : { rows: [], pooled: null }; return { promotions: healRecs[l].promotions.length, pooled: s.pooled }; });
  await step('shield-ablation', async () => {
    const spec = worlds[1];
    const b = await buildBundle(spec, { sealed });
    const ref = await referencePools(b);
    const base = programVersion(LINEAGES[lineages[0]], { id: lineages[0] });
    const { makeVersionArm } = await import('./arms.mjs');
    const shielded = armVersion(`${base.id}+SH`, ({ bundle, journal }) => harmShield(makeVersionArm(base, { bundle, journal })));
    const a = gradeRun(b, (await runBundle(b, { version: base })).rows, ref.pools);
    const r = await runBundle(b, { version: shielded });
    const g = gradeRun(b, r.rows, ref.pools);
    return { base: `${a.passed}/${a.completed} critical ${a.critical}`, shielded: `${g.passed}/${g.completed} critical ${g.critical}`, refusals: shieldRefusals(r.rows).length };
  });
  let m6 = null;
  await step('m6-detector', async () => {
    const cal0 = [];
    for (const p of PRACTICE.slice(0, light ? 1 : 3)) { const b = await evidenceBundle(p, { rules: [], editions: [], renames: [] }); const run = await runBundle(b, { version: programVersion(LINEAGES[lineages[0]], { id: lineages[0] }) }); cal0.push({ rows: run.rows, world: b.W }); }
    const cal = calibrate(cal0);
    const tasks = [];
    for (const spec of worlds) { const b = await buildBundle(spec, { sealed }); const run = await runBundle(b, { version: programVersion(LINEAGES[lineages[0]], { id: lineages[0] }) }); tasks.push(...instanceTasks(run.rows, b.W).map(t => ({ ...t, world: spec.k }))); }
    const r = runDetector(cal, tasks);
    m6 = { alarms: r.alarms.length, calibration: cal.n };
    return { calibration: cal.n, instances: tasks.length, alarms: r.alarms.map(a => ({ world: a.world, at: a.at })).slice(0, 5) };
  });
  await step('power', async () => { const p = powerReport({ quick: true }); return { sd: p.sd, mde: p.mde, d3: p.d3 }; });
  let rep = null;
  await step('report', async () => {
    const model = (recs, at) => Object.fromEntries(Object.entries(recs).map(([u, r]) => [u, { r1: modelOf(r, at?.[u] ?? null, ex.of) }]));
    const arms = { 'S-H*': model(stat['S-H*'], attr['S-H*']), 'MH-H': model(healRecs, attr['MH-H']), 'MH-stale': model(staleRecs), 'REF-S': model(stat['REF-S']), 'R-static': model(stat['R-static']),
      'R-maint0': model(stat['R-maint0']), 'R-maint2': model(stat['R-maint2']), 'R-maint7': model(stat['R-maint7']), 'R-ceil': model(stat['R-ceil']) };
    // The dry stream is called r1; the rules read s1 for K-0, D-4 and D-9, so the dry report aliases r1 as s1.
    const alias = a => Object.fromEntries(Object.entries(a).map(([arm, by]) => [arm, Object.fromEntries(Object.entries(by).map(([u, b]) => [u, { s1: b.r1 }]))]));
    const results = { worlds: { s1: worlds }, exposure: { s1: ex }, arms: alias(arms), certs: Object.fromEntries(Object.entries(certs).map(([l, b]) => [l, { s1: b.r1 }])),   // certs carry critRegression (D-1's clause)
      windows: windowPairs.length ? { pairs: windowPairs } : null, ld: ldA, redTeam: rt, costs: { agentProjected: { s1: 1 }, coUsd: {} }, m6,
      records: { 'MH-H': Object.fromEntries(Object.entries(healRecs).map(([l, r]) => [l, { s1: r }])) } };
    rep = report(results);
    writeFileSync(path.join(out, 'REPORT.dry.json'), JSON.stringify(rep, (k, v) => (v instanceof Set ? [...v] : v === Infinity ? 'Infinity' : v), 1));
    writeFileSync(path.join(out, 'REPORT.dry.md'), renderReport(rep));
    return { owner: rep.owner, rules: Object.fromEntries(Object.entries(rep.rules).map(([k, v]) => [k, v.verdict ?? null])) };
  });
  summary.ms = Date.now() - t0;
  summary.allStepsOk = Object.values(summary.steps).every(s => s.ok);
  writeFileSync(path.join(out, 'DRY.json'), JSON.stringify(summary, (k, v) => (v === Infinity ? 'Infinity' : v), 1));
  return { summary, report: rep };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage Z ($0, after the sealed bundle exists): gates, exposure, static comparators, K-0 on s1. FAIL CLOSED (review
// B6/R2-B3): V-11, V-1 (a reference timing below 100% or an oracle error), V-2 (a bad control passes a changed world),
// V-3 (an exposure floor not met) and K-1 (runStream) write runs/stagez/STOP.json and exit 5; the chain stops. K-0's
// verdict is written to K0.json; the chain refuses every paid step without K0.json saying "kill": false.

/** The Stage Z gate failures of one world's gates (V-1, V-2, V-3). */
export function gateFailures(g) {
  const out = [];
  if (!g.v1) out.push(`V-1 ${g.key}: ${(g.v1Problems ?? []).join('; ').slice(0, 300)}`);
  for (const [c, v] of Object.entries(g.v2 ?? {})) if (v !== 'fails') out.push(`V-2 ${g.key}: bad control ${c} ${v}`);
  for (const [c, e] of Object.entries(g.v3 ?? {})) if (e.floor !== null && e.floor !== undefined && !e.meets) out.push(`V-3 ${g.key}: ${c} ${e.completed} completed exposed < floor ${e.floor}`);
  return out;
}

export async function stageZ({ streams = STREAM_IDS, lineages = Object.keys(LINEAGES), out = path.join(RUNS, 'stagez'), log }) {
  const sealedMeta = JSON.parse(readFileSync(path.join(RES, 'SEALED.json'), 'utf8'));
  const sealed = loadSealed(sealedMeta.file ?? path.join(SEALED_DIR, 'bundle.json'), { sha256: sealedMeta.sha256 });
  mkdirSync(out, { recursive: true });
  const stop = why => { writeFileSync(path.join(out, 'STOP.json'), JSON.stringify({ at: new Date().toISOString(), why }, null, 1)); throw new StopError(`Stage Z: ${why}`); };
  const co = new ContractOwner({ session: id => (id === 'R1' ? stubCO('analyst-R1') : stubCO('none')), runDir: out, sealed, log });   // K-0: the analyst's R1 reading stands in for C-O
  const res = { streams: {} };
  // V-11: the nine starting versions reproduce 1,022/1,022 on the FH-1 grading worlds (1232-1234 x d2, d3, d5), FH-1's own grader.
  const v11File = path.join(out, 'V11.json');
  if (!existsSync(v11File)) {
    const { gradeSubject } = await import('../fh/grade.mjs');
    const v11 = {};
    for (const l of lineages) { const g = await gradeSubject(LINEAGES[l], { judge: 'oracle', label: 'dur1-v11' }); v11[l] = { oracle: `${g.totals.oraclePassed}/${g.totals.oracleN}`, ok: g.totals.oraclePassed === g.totals.oracleN && g.totals.oracleN === 1022, digest: g.digest }; log(`V-11 ${l}: ${v11[l].oracle}`); }
    writeFileSync(v11File, JSON.stringify(v11, null, 1));
  }
  res.v11 = JSON.parse(readFileSync(v11File, 'utf8'));
  const v11Bad = Object.entries(res.v11).filter(([, x]) => !x.ok).map(([l, x]) => `${l} ${x.oracle}`);
  if (v11Bad.length) stop(`V-11 fails: ${v11Bad.join(', ')}`);
  for (const s of streams) {
    const worlds = worldsOf(s, { sealedOnsets: sealed.onsets() });
    const gates = [];
    for (const w of worlds) gates.push(await gatesOfWorld(w, { sealed }));
    writeFileSync(path.join(out, `${s}.gates.json`), JSON.stringify({ gates }, null, 1));
    const bad = gates.flatMap(gateFailures);
    if (bad.length) stop(bad.slice(0, 12).join(' | '));
    const ex = await streamExposure(worlds, { sealed });
    const stat = await staticArms({ stream: s, worlds, sealed, lineages, exposure: ex, co, runDir: path.join(out, s), log });   // K-1 inside runStream throws StopError
    res.streams[s] = { gates, floors: ex.floors, ruleTimes: stat.ruleTimes };
    writeFileSync(path.join(out, `${s}.gates.json`), JSON.stringify(res.streams[s], null, 1));
    if (s === 's1') {
      const attr = {};
      for (const l of lineages) attr[l] = await attributeRecord({ rec: stat['S-H*'][l], worlds, ex, sealed });
      const m = Object.fromEntries(lineages.map(l => [l, modelOf(stat['S-H*'][l], attr[l])]));
      const { k0 } = await import('./analyze.mjs');
      res.k0 = k0(m);
      writeFileSync(path.join(out, 'K0.json'), JSON.stringify(res.k0, null, 1));
      log(`K-0: ${res.k0.verdict} ${JSON.stringify(res.k0.perChange)}`);
    }
  }
  if (!res.k0) stop('K-0 was not computed (stream s1 not in this Stage Z run)');
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI

async function main() {
  const cmd = argv[0];
  const log = m => console.log(`${stamp()} ${m}`);
  if (cmd === 'dry') {
    const r = await dry({ lineages: list('lineages', ['b1lh-e8-1', 'ch-e8-1']), out: opt('out', path.join(WORK, 'dry')), log, light: flag('light') });
    console.log(JSON.stringify({ allStepsOk: r.summary.allStepsOk, ms: r.summary.ms, steps: Object.fromEntries(Object.entries(r.summary.steps).map(([k, v]) => [k, v.ok ? 'ok' : `FAILED: ${v.error.slice(0, 200)}`])), owner: r.report?.owner ?? null }, null, 1));
    process.exit(r.summary.allStepsOk ? 0 : 1);
  }
  if (cmd === 'stagez') { const r = await stageZ({ streams: list('streams', STREAM_IDS), lineages: list('lineages', Object.keys(LINEAGES)), log }); console.log(JSON.stringify({ k0: r.k0?.verdict ?? null, kill: r.k0?.kill ?? null })); return; }
  if (cmd === 'author') {
    const fz = await guardPaid('author', 'P1');
    const r = await runAuthor({ session: paidSession(AUTHOR_SESSION, { scope: 'P1', row: 'P1', freeze: fz }), log });
    console.log(JSON.stringify({ ok: r.ok, sha256: r.sha256 ?? null, counts: r.counts }, null, 1));
    process.exit(r.ok ? 0 : 1);
  }
  if (['p0', 'heal', 'windows', 'refm', 'redteam', 'forks'].includes(cmd)) {
    const { paidStage } = await import('./paid.mjs');
    await paidStage(cmd, { argv, opt, flag, list, log, guardPaid, paidSession });
    return;
  }
  if (cmd === 'wc1') { const { wc1Stage } = await import('./paid.mjs'); const r = await wc1Stage({ when: opt('when', 't0'), log }); console.log(JSON.stringify({ when: r.when, targets: Object.keys(r.targets).length, transfer: r.transfer.length })); return; }
  if (cmd === 'rtwindows') { await guardPaid('rtwindows', 'P7'); const { rtWindowsStage } = await import('./paid.mjs'); const r = await rtWindowsStage({ log }); console.log(JSON.stringify(r.map(x => ({ label: x.label, agentPass: `${x.agentPass}/${x.n}`, costUsd: x.costUsd })))); return; }
  if (cmd === 'advset') { const { advSetStage } = await import('./paid.mjs'); const r = await advSetStage({ log }); console.log(JSON.stringify({ worlds: r.set.length, cross: r.cross.length })); return; }
  if (cmd === 'analyze') { const { analyzeRuns } = await import('./paid.mjs'); const r = await analyzeRuns({ log }); console.log(renderReport(r)); return; }
  console.error('usage: run.mjs dry|stagez|author|p0|heal|windows|refm|redteam|forks|analyze (see the header)');
  process.exit(2);
}

/**
 * Exit codes the chain (dur1-chain.sh) acts on: 3 refused (a changed freeze or --paid missing; never a budget), 4 budget (a
 * row or the total is out of room before the stage could do anything), 5 a stop rule fired (K-1, V-1, V-2, V-3, V-6,
 * V-11, a missing K-0 input: the chain stops), 75 environment fault (wait 30 minutes and resume), 1 harness error.
 */
export const EXIT = Object.freeze({ DUR1_UNPAID: 3, DUR1_FREEZE: 3, DUR1_BUDGET: 4, DUR1_BUDGET_STOP: 4, DUR1_STOP: 5, DUR1_ENV_FAULT: 75, DUR1_HARNESS: 1 });
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(String(e?.stack ?? e)); process.exit(EXIT[e?.code] ?? 1); });
