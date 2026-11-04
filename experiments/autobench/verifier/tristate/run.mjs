#!/usr/bin/env node
// Move 3 $0 step (ATTACK §6): the three-valued verdict over the stored dev60 verifier outputs, the release rule's
// risk–coverage (leave-one-task-out, Learn-then-Test, n_eff) and lexicographic selection. Development evidence only.
//
//   node run.mjs --vlab <stored dev60 lab> --rl2 <RL2 output dir: extract.jsonl, judge-all.jsonl, checks-all.jsonl>
//       --cc-facts <code-checks facts.json> --strata <move0/dev60-ceiling-strata.json> --out <result.json>
//
// Reads labels only to score; no verifier input contains one. Recomputes the frozen RL2 check phase and code-checks v1.1
// from their stored inputs (no model call) and checks them against the stored outputs first (fidelity). Writes only
// counts, rates and hashes: no task name, grader string or ceiling note.
//
// Review fixes (2026-11-04): verdict tristate-v2 (soft UNKNOWN both ways; an empty verdict is held), every matching
// effect explained (adapters v2), the clock (D28 (2)): code-checks run clock-blind by default ("today" from the request,
// else the work items' business dates, else a labelled null) with the lab's hidden-clock run kept as '@clock' configs;
// the kill clause evaluated by a bound; the decision code moved into exported, tested functions; the headline manifest
// lists every node the selection used (both forks' pipeline nodes, the RL2 readers, the code-check facts call) and
// its $ per task.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { combine } from '../requirement-ledger-v2/verify.mjs';
import { factsKey } from '../code-checks/facts.mjs';
import { REPORTED_ARMS, fileSha, labelPass, loadLab, readJsonl, runAllowed, viewOf, worldsOf } from '../mutlab/labio.mjs';
import { ADAPTERS_VERSION, canonicalRowsOf, ccClock, ccObligations, ownObligations, rl2Check, rl2Ledgers, rl2Obligations } from './adapters.mjs';
import { POLICIES, TRI_VERSION, compareVerdicts, killClause, verdictOf } from './verdict.mjs';
import { RISKCOV_VERSION, curve, loto, rowSummary } from './riskcov.mjs';
import { clopperPearson, effectiveN, headlineRow, signTest } from '../../../lib/certify.mjs';

export const RUN_VERSION = 'tristate-run-v2';
export const POOLS = Object.freeze({ P2: ['m3-a1c', 'sonnet-a1'], P3: ['m3-a1c', 'haiku-a1c', 'haiku-a1'], P3s: ['m3-a1c', 'sonnet-a1', 'haiku-a1'], P6: [...REPORTED_ARMS] });
// clock: 'blind' = code-checks without the hidden clock (D28 (2)); 'visible' = as the verifier lab ran them (meta.current_time)
export const CONFIGS = Object.freeze({
  'rl2': { rl2: true, cc: false, own: false, clock: 'blind', policies: ['T1', 'T2', 'T0', 'TJ', 'T3', 'TC'] },
  'rl2+cc': { rl2: true, cc: true, own: false, clock: 'blind', policies: ['T1', 'T2', 'T0', 'TJ', 'T3', 'TC'] },
  'rl2+cc@clock': { rl2: true, cc: true, own: false, clock: 'visible', policies: ['T1', 'T3', 'TC'] },
  'cc': { rl2: false, cc: true, own: false, clock: 'blind', policies: ['T1', 'TC'] },
  'cc@clock': { rl2: false, cc: true, own: false, clock: 'visible', policies: ['T1', 'TC'] },
  'own': { rl2: false, cc: false, own: true, clock: 'blind', policies: ['T1', 'T2', 'T0', 'TJ', 'T3', 'TC'] },
});

/**
 * Obligations and effects of one row for a source configuration. parts: { rl2: rl2Check result, verdicts (stored judged
 * verdicts or null), cc: {withClock, blind, labelledNull} (ccClock result), selfCheck }.
 */
export function obligationsFor(cfg, parts) {
  const obs = [];
  if (cfg.rl2) obs.push(...rl2Obligations(parts.rl2.results, { judged: parts.rl2.judged, verdicts: parts.verdicts }));
  if (cfg.cc) obs.push(...(cfg.clock === 'visible' ? ccObligations(parts.cc.withClock.checks) : ccObligations(parts.cc.blind.checks, { labelledNull: parts.cc.labelledNull })));
  if (cfg.own) obs.push(...ownObligations(parts.selfCheck));
  return { obs, effects: cfg.rl2 ? parts.rl2.effects : [] };
}

/**
 * Pick per task in a pool. byTask: Map task -> [{arm, y, fold, ...}]; better(c, best) -> bool. The default fork is the
 * pool's first arm; ties keep fork order. Returns {n, passes, gains, losses, oracle, per: [{task, fold, y, defY, oracle,
 * arm}]}.
 */
export function selectPool(byTask, arms, better) {
  let passes = 0, gains = 0, losses = 0, n = 0;
  const per = [];
  for (const [task, rows] of byTask) {
    const cands = arms.map(a => rows.find(r => r.arm === a)).filter(Boolean);
    if (cands.length < 1) continue;
    let best = cands[0];
    for (const c of cands.slice(1)) if (better(c, best)) best = c;
    const def = cands[0];
    n++;
    if (best.y) passes++;
    if (best.y && !def.y) gains++;
    if (!best.y && def.y) losses++;
    per.push({ task, fold: best.fold, y: best.y, defY: def.y, oracle: cands.some(c => c.y), arm: best.arm });
  }
  return { n, passes, gains, losses, oracle: per.filter(p => p.oracle).length, per };
}
/** The three selection rules compared: the tri-state key, R1 (RL2 accept, then score) and R0 (the default fork). */
export const RULES = Object.freeze({
  tri: (c, b) => compareVerdicts(c.v, b.v) < 0,
  R1: (c, b) => (c.rl2v.accept !== b.rl2v.accept ? c.rl2v.accept : c.rl2v.score > b.rl2v.score + 1e-12),
  R0: () => false,
});

/** All / held-out / reachable subsets of a selection, with the sign test of gains vs losses and the CP interval. */
export function summarizeSelection(sel, { heldout, hard }) {
  const sub = f => { const p = sel.per.filter(f); return { n: p.length, passes: p.filter(x => x.y).length, gains: p.filter(x => x.y && !x.defY).length, losses: p.filter(x => !x.y && x.defY).length, oracle: p.filter(x => x.oracle).length }; };
  const all = sub(() => true), ho = sub(p => heldout.has(p.fold)), reach = sub(p => !hard.has(p.task));
  const st = signTest(all.gains, all.losses);
  return { all, heldout: ho, reachable: reach, signTestP: st.pTwoSided, ci: clopperPearson(all.passes, all.n) };
}

/**
 * Every Move 3 quantity for one (source configuration, policy): row-level three-valued summary (all and held-out folds),
 * UNKNOWN composition, the kill clause, the risk–coverage curve, leave-one-task-out certification at three alphas, the
 * A1-C own-check count and, unless own is the source, selection in every pool. items: [{task, arm, fold, y, v, rl2v,
 * ownAllPass}] with v = verdictOf(...).
 */
export function analyzeConfig(its, { heldout = new Set([3, 4]), hard = new Set(), pools = POOLS, selection = true, postHoc = false } = {}) {
  const ho = its.filter(it => heldout.has(it.fold));
  const unknownKinds = {};
  for (const it of its) for (const s of it.v.assumptions) unknownKinds[s.kind] = (unknownKinds[s.kind] ?? 0) + 1;
  const unknownRowKinds = {};
  for (const it of its.filter(x => x.v.row === 'UNKNOWN')) { const kinds = [...new Set(it.v.assumptions.map(s => s.kind))].sort().join('+') || '(none: vacuous)'; unknownRowKinds[kinds] = (unknownRowKinds[kinds] ?? 0) + 1; }
  const res = {
    rows: rowSummary(its), heldoutRows: rowSummary(ho), unknownKinds, unknownRowKinds, kill: killClause(its.map(it => it.v)),
    curve: curve(its), curveHeldout: curve(ho),
    loto: { a20: loto(its, { alpha: 0.2, delta: 0.1 }), a35: loto(its, { alpha: 0.35, delta: 0.1 }), a50: loto(its, { alpha: 0.5, delta: 0.1 }),
      a20FixedSequence: loto(its, { alpha: 0.2, delta: 0.1, method: 'fixed_sequence' }) },
    postHoc,
  };
  res.ownAllPass = {};
  for (const arm of ['m3-a1c', 'haiku-a1c']) {
    const ap = its.filter(it => it.arm === arm && it.ownAllPass);
    res.ownAllPass[arm] = { trueAccepts: ap.filter(it => it.y).length, falseAccepts: ap.filter(it => !it.y).length,
      trueStaySupported: ap.filter(it => it.y && it.v.row === 'SUPPORTED').length, trueReleased: ap.filter(it => it.y && it.v.release).length,
      trueBecomeFailed: ap.filter(it => it.y && it.v.row === 'FAILED').length,
      falseBecomeFailed: ap.filter(it => !it.y && it.v.row === 'FAILED').length, falseBecomeUnknown: ap.filter(it => !it.y && it.v.row === 'UNKNOWN').length,
      falseStillSupported: ap.filter(it => !it.y && it.v.row === 'SUPPORTED').length, falseReleased: ap.filter(it => !it.y && it.v.release).length };
  }
  if (selection) {
    const byTask = new Map();
    for (const it of its) { if (!byTask.has(it.task)) byTask.set(it.task, []); byTask.get(it.task).push(it); }
    res.selection = {};
    for (const [p, arms] of Object.entries(pools)) res.selection[p] = Object.fromEntries(Object.entries(RULES).map(([r, f]) => [r, summarizeSelection(selectPool(byTask, arms, f), { heldout, hard })]));
  }
  return res;
}

/**
 * The nodes a P2 selection used, from the stored records (legacy: no effort recorded anywhere in the forks): each fork's
 * pipeline nodes (or its one session) and the verifier nodes of the rule. nodeRows: per fork, the node list of a stored
 * pipeline record ([{name, kind, model, cap}]) or null for a plain session.
 */
export function selectionManifest({ forks, verifierNodes }) {
  const nodes = [];
  for (const f of forks) {
    if (f.pipelineNodes?.length) for (const n of f.pipelineNodes.filter(x => x.kind !== 'code')) nodes.push({ name: `${f.arm}:${n.name}`, kind: n.kind, model: n.model, effort: f.effort ?? null, temperature: null, cap: n.cap ?? f.cap ?? null });
    else nodes.push({ name: `${f.arm}:session`, kind: 'session', model: f.model, effort: f.effort ?? null, temperature: null, cap: f.cap ?? null });
  }
  return { runId: 'P2', paid: true, nodes: [...nodes, ...verifierNodes] };
}

async function main() {
  const { values: a } = parseArgs({ options: { vlab: { type: 'string' }, rl2: { type: 'string' }, 'cc-facts': { type: 'string' }, strata: { type: 'string' }, out: { type: 'string' },
    'autobench-root': { type: 'string', default: '/var/tmp/foundry-work/autobench' } } });
  for (const k of ['vlab', 'rl2', 'cc-facts', 'strata', 'out']) if (!a[k]) { console.error(`missing --${k}`); process.exit(2); }
  const vlab = path.resolve(a.vlab);
  const lab = await import(pathToFileURL(path.join(vlab, 'load.mjs')).href);
  const allRows = loadLab(vlab);                                      // canonical outcome rows of every lab arm (allowlisted)
  const strata = JSON.parse(readFileSync(a.strata, 'utf8'));
  const hard = new Set(strata.hard.map(x => (typeof x === 'string' ? x : x.task)));
  const inputs = { 'dataset.jsonl': fileSha(path.join(vlab, 'dataset.jsonl')), 'extract.jsonl': fileSha(path.join(a.rl2, 'extract.jsonl')),
    'judge-all.jsonl': fileSha(path.join(a.rl2, 'judge-all.jsonl')), 'checks-all.jsonl': fileSha(path.join(a.rl2, 'checks-all.jsonl')), 'facts.json': fileSha(a['cc-facts']), strata: fileSha(a.strata) };

  // ---- canonical row per task, as RL2 run.mjs chooses it; RL2 ledgers from the stored extractions
  // the stored RL2 extractions were made from views WITH the hidden clock (their cache key includes it): the canonical
  // views keep it so the stored ledgers are found; it is not re-extractable at $0 and is disclosed (D28 (2))
  const canonical = new Map([...canonicalRowsOf(allRows, lab.ARM_ORDER)].map(([t, cr]) => [t, { view: viewOf(cr, cr.diff, { clock: true }), world0: worldsOf(vlab, cr).initial }]));
  const ledgers = rl2Ledgers(readJsonl(path.join(a.rl2, 'extract.jsonl')), canonical);
  const judgeRows = readJsonl(path.join(a.rl2, 'judge-all.jsonl')).filter(j => j.ok);
  const verdictsByRow = new Map(judgeRows.map(j => [j.rowId, j.verdicts]));
  const judgeCostByRow = new Map(judgeRows.map(j => [j.rowId, Number.isFinite(j.costUsd) ? j.costUsd : 0]));
  const storedChecks = new Map(readJsonl(path.join(a.rl2, 'checks-all.jsonl')).map(c => [c.rowId, c]));
  const facts = JSON.parse(readFileSync(a['cc-facts'], 'utf8'));

  // ---- per row: recompute RL2 and code-checks, check fidelity, then verdicts
  const fidelity = { rl2Rows: 0, rl2Identical: 0, rl2Differ: [], ccRows: 0, matchChecked: 0, matchAgree: 0, ccLabelledNullRows: 0, ccClockChangedRows: 0 };
  const items = [];
  for (const r of allRows) {
    const w = worldsOf(vlab, r);
    const L = ledgers.get(r.task);
    const rl2 = rl2Check(L, { diff: r.diff, world0: w.initial, final: w.final });
    fidelity.matchChecked += rl2.matchFidelity.checked; fidelity.matchAgree += rl2.matchFidelity.agree;
    const st = storedChecks.get(r.rowId);
    if (st) {
      fidelity.rl2Rows++;
      const k = x => JSON.stringify(x.map(c => [c.key, c.hard, c.pass]));
      if (k(st.code) === k(rl2.results)) fidelity.rl2Identical++; else fidelity.rl2Differ.push(r.rowId);
    }
    const view = viewOf(r);
    const f = facts[factsKey(view.prompt.user, view.services)];
    const cc = ccClock({ view, world0: w.initial, hf: f?.ok ? f.facts : null });
    fidelity.ccRows++;
    if (cc.labelledNull.length) fidelity.ccLabelledNullRows++;
    if (cc.withClock.accept !== cc.blind.accept) fidelity.ccClockChangedRows++;
    const verdicts = verdictsByRow.get(r.rowId) ?? null;
    const rl2v = combine({ code: rl2.results, judged: rl2.judged, verdicts, readers: L.merged.readers });
    items.push({ rowId: r.rowId, task: r.task, arm: r.arm, fold: r.fold, y: labelPass(r), costUsd: r.costUsd, parts: { rl2, cc, verdicts, selfCheck: r.selfCheck }, rl2v,
      ownAllPass: r.selfCheck?.kind === 'a1c-checks' ? Boolean(r.selfCheck.terminationAllPass ?? r.selfCheck.allPass) : null });
  }
  fidelity.rl2DifferCount = fidelity.rl2Differ.length;
  fidelity.rl2Differ = fidelity.rl2Differ.length;   // count only (row ids name tasks)

  const reported = items.filter(it => REPORTED_ARMS.includes(it.arm));
  const heldout = new Set([3, 4]);
  const out = { versions: { run: RUN_VERSION, tri: TRI_VERSION, adapters: ADAPTERS_VERSION, riskcov: RISKCOV_VERSION },
    evidence: 'development (dev60, k = 1; RL2 designed on folds 0-2, folds 3-4 held out). RL2 readers saw the hidden clock in their extraction prompts (stored; not re-extractable at $0): every config is clock-blind only in its code-checks part',
    inputs, fidelity, configs: {} };

  for (const [cname, cfg] of Object.entries(CONFIGS)) {
    for (const pname of cfg.policies) {
      const pol = POLICIES[pname];
      const scope = cfg.own ? reported.filter(it => it.parts.selfCheck?.kind === 'a1c-checks') : reported;
      const its = scope.map(it => { const o = obligationsFor(cfg, it.parts); return { ...it, v: verdictOf(o.obs, o.effects, pol) }; });
      out.configs[`${cname}/${pname}`] = { clock: cfg.clock, ...analyzeConfig(its, { heldout, hard, selection: !cfg.own, postHoc: Boolean(pol.postHoc) }) };
    }
  }

  // ---- headline rows with the ceiling column (D28 (4)) for the P2 selections: every node the selection used and its $/task
  const autobenchRoot = path.resolve(a['autobench-root']);
  const launchOf = run => {
    if (!runAllowed(run)) throw new Error(`run.mjs: ${run} is not on the dev60 allowlist`);
    return JSON.parse(readFileSync(path.join(autobenchRoot, run, 'launch.json'), 'utf8'));
  };
  const pipelineNodesOf = run => {
    if (!runAllowed(run)) throw new Error(`run.mjs: ${run} is not on the dev60 allowlist`);
    const rec = readJsonl(path.join(autobenchRoot, run, 'results.jsonl')).map(x => x.forks?.[0]?.pipeline?.nodes).find(n => Array.isArray(n) && n.length);
    return rec ? rec.map(n => ({ name: n.name, kind: n.kind, model: n.model, cap: n.cap ?? null })) : null;
  };
  const forkOf = (arm, run) => { const l = launchOf(run); return { arm, model: l.model, effort: l.effort ?? null, cap: l.budgetUsd ?? null, pipelineNodes: pipelineNodesOf(run) }; };
  const forks = [forkOf('m3-a1c', 'm3-a1c-dev60-dn'), forkOf('sonnet-a1', 'a1s-dev60-dn')];
  // verifier nodes (requirement-ledger-v2 run.mjs: readers at reasoning 'low'; judged checks at reasoning 'none'; code-check
  // facts: facts.mjs reasoning 'none'); temperature and caps are not recorded in their journals
  const readerNodes = ['haiku:0', 'haiku:1', 'haiku:2'].map(rd => ({ name: `rl2-reader-${rd.split(':')[1]}`, kind: 'model', model: 'claude-haiku-5-5', effort: 'reasoning:low', temperature: null, cap: null }));
  const factsNode = { name: 'cc-facts', kind: 'model', model: 'claude-haiku-5-5', effort: 'reasoning:none', temperature: null, cap: null };
  const judgeNode = { name: 'rl2-judged-checks', kind: 'model', model: 'claude-haiku-5-5', effort: 'reasoning:none', temperature: null, cap: null };
  const p2rows = reported.filter(it => POOLS.P2.includes(it.arm));
  const p2tasks = [...new Set(p2rows.map(it => it.task))];
  const sum = xs => xs.reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
  const forkUsd = arm => sum(p2rows.filter(it => it.arm === arm).map(it => it.costUsd));
  const readersUsd = sum(p2tasks.map(t => ledgers.get(t)?.costUsd));
  const factsUsd = sum(p2tasks.map(t => { const r = p2rows.find(it => it.task === t); const v = viewOf(allRows.find(x => x.rowId === r.rowId)); return facts[factsKey(v.prompt.user, v.services)]?.costUsd; }));
  const judgedUsd = sum(p2rows.map(it => judgeCostByRow.get(it.rowId)));
  const costs = { 'm3-a1c': forkUsd('m3-a1c'), 'sonnet-a1': forkUsd('sonnet-a1'), rl2Readers: readersUsd, ccFacts: factsUsd, rl2JudgedChecks: judgedUsd,
    mercuryTokensNote: 'm3-a1c also used ~61K Mercury 3 tokens per task (listed price $0; a shadow price is pending under D28 (7))' };
  const ruleCost = { tri: costs['m3-a1c'] + costs['sonnet-a1'] + readersUsd + factsUsd, R1: costs['m3-a1c'] + costs['sonnet-a1'] + readersUsd + judgedUsd, R0: costs['m3-a1c'] };
  const ruleNodes = { tri: [...readerNodes, factsNode], R1: [...readerNodes, judgeNode], R0: [] };
  out.headline = { costsUsdTotal: costs, tasks: p2tasks.length };
  for (const key of ['rl2+cc/T1', 'rl2+cc/TC', 'rl2/T1', 'rl2+cc@clock/T1']) {
    const sel = out.configs[key].selection.P2;
    out.headline[key] = Object.fromEntries(['tri', 'R1', 'R0'].map(rule => [rule, { ...headlineRow({ label: `P2 ${rule} (${key})`, passes: sel[rule].all.passes, n: sel[rule].all.n,
      reachable: { passes: sel[rule].reachable.passes, n: sel[rule].reachable.n, source: 'dev60 minus the 7 hard benchmark defects (move0/dev60-ceiling-strata.json)' },
      manifest: selectionManifest({ forks: rule === 'R0' ? forks.slice(0, 1) : forks, verifierNodes: ruleNodes[rule] }),
      costUsd: ruleCost[rule], legacy: 'pre-D28 dev runs: effort unset in the fork launch records' }), usdPerTask: ruleCost[rule] / p2tasks.length }]));
  }
  // n_eff of the scored rows (task clusters, label as the event)
  out.rowsNeff = effectiveN([...new Set(reported.map(it => it.task))].map(t => { const xs = reported.filter(it => it.task === t); return { n: xs.length, wrong: xs.filter(it => !it.y).length }; }));
  writeFileSync(a.out, JSON.stringify(out, null, 1) + '\n');
  const brief = Object.fromEntries(Object.entries(out.configs).map(([k, v]) => [k, { sup: v.rows.supported, prec: v.rows.supportedPrecision?.toFixed(3), cov: v.rows.coverage.toFixed(3), rel: `${v.rows.released} @ ${v.rows.releasedPrecision?.toFixed(3)}`, vac: v.rows.vacuous, unkPass: v.rows.unknownPassRate?.toFixed(3), kill: v.kill.decision, loto20: `${v.loto.a20.released}/${v.loto.a20.n}`, P2: v.selection ? `${v.selection.P2.tri.all.passes} +${v.selection.P2.tri.all.gains}/-${v.selection.P2.tri.all.losses} (R1 ${v.selection.P2.R1.all.passes}, R0 ${v.selection.P2.R0.all.passes})` : '-' }]));
  console.log(JSON.stringify({ fidelity, rowsNeff: out.rowsNeff.nEff, costs, brief }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
