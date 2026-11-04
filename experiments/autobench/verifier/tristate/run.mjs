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
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { combine } from '../requirement-ledger-v2/verify.mjs';
import { verify as ccVerify } from '../code-checks/verify.mjs';
import { factsKey } from '../code-checks/facts.mjs';
import { REPORTED_ARMS, fileSha, labelPass, loadLab, readJsonl, viewOf, worldsOf } from '../mutlab/labio.mjs';
import { ADAPTERS_VERSION, canonicalRowsOf, ccObligations, ownObligations, rl2Check, rl2Ledgers, rl2Obligations } from './adapters.mjs';
import { POLICIES, TRI_VERSION, compareVerdicts, verdictOf } from './verdict.mjs';
import { RISKCOV_VERSION, curve, loto, rowSummary } from './riskcov.mjs';
import { clopperPearson, effectiveN, headlineRow, manifestFromLaunch, signTest } from '../../../lib/certify.mjs';

export const POOLS = Object.freeze({ P2: ['m3-a1c', 'sonnet-a1'], P3: ['m3-a1c', 'haiku-a1c', 'haiku-a1'], P3s: ['m3-a1c', 'sonnet-a1', 'haiku-a1'], P6: [...REPORTED_ARMS] });
export const CONFIGS = Object.freeze({
  'rl2': { rl2: true, cc: false, own: false },
  'rl2+cc': { rl2: true, cc: true, own: false },
  'cc': { rl2: false, cc: true, own: false },
  'own': { rl2: false, cc: false, own: true },
});

/** Obligations and effects of one row for a source configuration. */
export function obligationsFor(cfg, parts) {
  const obs = [];
  if (cfg.rl2) obs.push(...rl2Obligations(parts.rl2.results, { judged: parts.rl2.judged, verdicts: parts.verdicts }));
  if (cfg.cc) obs.push(...ccObligations(parts.cc.checks));
  if (cfg.own) obs.push(...ownObligations(parts.selfCheck));
  return { obs, effects: cfg.rl2 ? parts.rl2.effects : [] };
}

/** Pick per task in a pool: rank(cands) -> best; returns {passes, picks: Map task -> row, gains, losses vs the default}. */
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
    per.push({ task, fold: best.fold, y: best.y, defY: def.y, oracle: cands.some(c => c.y) });
  }
  return { n, passes, gains, losses, oracle: per.filter(p => p.oracle).length, per };
}

function summarizeSelection(sel, { heldout, hard }) {
  const sub = f => { const p = sel.per.filter(f); return { n: p.length, passes: p.filter(x => x.y).length, gains: p.filter(x => x.y && !x.defY).length, losses: p.filter(x => !x.y && x.defY).length, oracle: p.filter(x => x.oracle).length }; };
  const all = sub(() => true), ho = sub(p => heldout.has(p.fold)), reach = sub(p => !hard.has(p.task));
  const st = signTest(all.gains, all.losses);
  return { all, heldout: ho, reachable: reach, signTestP: st.pTwoSided, ci: clopperPearson(all.passes, all.n) };
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
  const canonical = new Map([...canonicalRowsOf(allRows, lab.ARM_ORDER)].map(([t, cr]) => [t, { view: viewOf(cr), world0: worldsOf(vlab, cr).initial }]));
  const ledgers = rl2Ledgers(readJsonl(path.join(a.rl2, 'extract.jsonl')), canonical);
  const verdictsByRow = new Map(readJsonl(path.join(a.rl2, 'judge-all.jsonl')).filter(j => j.ok).map(j => [j.rowId, j.verdicts]));
  const storedChecks = new Map(readJsonl(path.join(a.rl2, 'checks-all.jsonl')).map(c => [c.rowId, c]));
  const facts = JSON.parse(readFileSync(a['cc-facts'], 'utf8'));

  // ---- per row: recompute RL2 and code-checks, check fidelity, then verdicts
  const fidelity = { rl2Rows: 0, rl2Identical: 0, rl2Differ: [], ccRows: 0 };
  const items = [];
  for (const r of allRows) {
    const w = worldsOf(vlab, r);
    const L = ledgers.get(r.task);
    const rl2 = rl2Check(L, { diff: r.diff, world0: w.initial, final: w.final });
    const st = storedChecks.get(r.rowId);
    if (st) {
      fidelity.rl2Rows++;
      const k = x => JSON.stringify(x.map(c => [c.key, c.hard, c.pass]));
      if (k(st.code) === k(rl2.results)) fidelity.rl2Identical++; else fidelity.rl2Differ.push(r.rowId);
    }
    const view = viewOf(r);
    const f = facts[factsKey(view.prompt.user, view.services)];
    const cc = ccVerify({ view, world0: w.initial, hf: f?.ok ? f.facts : null });
    fidelity.ccRows++;
    const verdicts = verdictsByRow.get(r.rowId) ?? null;
    const rl2v = combine({ code: rl2.results, judged: rl2.judged, verdicts, readers: L.merged.readers });
    items.push({ rowId: r.rowId, task: r.task, arm: r.arm, fold: r.fold, y: labelPass(r), parts: { rl2, cc, verdicts, selfCheck: r.selfCheck }, rl2v,
      ownAllPass: r.selfCheck?.kind === 'a1c-checks' ? Boolean(r.selfCheck.terminationAllPass ?? r.selfCheck.allPass) : null });
  }
  fidelity.rl2DifferCount = fidelity.rl2Differ.length;
  fidelity.rl2Differ = fidelity.rl2Differ.length;   // count only (row ids name tasks)

  const reported = items.filter(it => REPORTED_ARMS.includes(it.arm));
  const heldout = new Set([3, 4]);
  const out = { versions: { tri: TRI_VERSION, adapters: ADAPTERS_VERSION, riskcov: RISKCOV_VERSION }, evidence: 'development (dev60, k = 1; RL2 designed on folds 0-2, folds 3-4 held out)', inputs, fidelity, configs: {} };

  for (const [cname, cfg] of Object.entries(CONFIGS)) {
    for (const [pname, pol] of Object.entries(POLICIES)) {
      if (cname === 'cc' && pname !== 'T1') continue;
      const key = `${cname}/${pname}`;
      const scope = cfg.own ? reported.filter(it => it.parts.selfCheck?.kind === 'a1c-checks') : reported;
      const its = scope.map(it => { const o = obligationsFor(cfg, it.parts); return { ...it, v: verdictOf(o.obs, o.effects, pol) }; });
      const ho = its.filter(it => heldout.has(it.fold));
      const unknownKinds = {};
      for (const it of its) for (const s of it.v.assumptions) unknownKinds[s.kind] = (unknownKinds[s.kind] ?? 0) + 1;
      const rowsWithUnknownOnly = {};
      for (const it of its.filter(x => x.v.row === 'UNKNOWN')) { const kinds = [...new Set(it.v.assumptions.map(s => s.kind))].sort().join('+'); rowsWithUnknownOnly[kinds] = (rowsWithUnknownOnly[kinds] ?? 0) + 1; }
      const res = {
        rows: rowSummary(its), heldoutRows: rowSummary(ho), unknownKinds, unknownRowKinds: rowsWithUnknownOnly,
        curve: curve(its), curveHeldout: curve(ho),
        loto: { a20: loto(its, { alpha: 0.2, delta: 0.1 }), a35: loto(its, { alpha: 0.35, delta: 0.1 }), a50: loto(its, { alpha: 0.5, delta: 0.1 }),
          a20FixedSequence: loto(its, { alpha: 0.2, delta: 0.1, method: 'fixed_sequence' }) },
        postHoc: Boolean(pol.postHoc),
      };
      // the ATTACK count: the own checks' "all pass" verdicts on the two A1-C pipelines
      res.ownAllPass = {};
      for (const arm of ['m3-a1c', 'haiku-a1c']) {
        const ap = its.filter(it => it.arm === arm && it.ownAllPass);
        res.ownAllPass[arm] = { trueAccepts: ap.filter(it => it.y).length, falseAccepts: ap.filter(it => !it.y).length,
          trueStaySupported: ap.filter(it => it.y && it.v.row === 'SUPPORTED').length, trueReleased: ap.filter(it => it.y && it.v.release).length,
          falseBecomeFailed: ap.filter(it => !it.y && it.v.row === 'FAILED').length, falseBecomeUnknown: ap.filter(it => !it.y && it.v.row === 'UNKNOWN').length,
          falseStillSupported: ap.filter(it => !it.y && it.v.row === 'SUPPORTED').length };
      }
      // selection by (FAILED, SUPPORTED, UNKNOWN); R0 and R1 (RL2 accept, score) beside it
      if (!cfg.own) {
        const byTask = new Map();
        for (const it of its) { if (!byTask.has(it.task)) byTask.set(it.task, []); byTask.get(it.task).push(it); }
        res.selection = {};
        for (const [p, arms] of Object.entries(POOLS)) {
          const tri = selectPool(byTask, arms, (c, b) => compareVerdicts(c.v, b.v) < 0);
          const r1 = selectPool(byTask, arms, (c, b) => (c.rl2v.accept !== b.rl2v.accept ? c.rl2v.accept : c.rl2v.score > b.rl2v.score + 1e-12));
          const r0 = selectPool(byTask, arms, () => false);
          res.selection[p] = { tri: summarizeSelection(tri, { heldout, hard }), R1: summarizeSelection(r1, { heldout, hard }), R0: summarizeSelection(r0, { heldout, hard }) };
        }
      }
      out.configs[key] = res;
    }
  }
  // headline rows with the ceiling column (D28 (4)) for the P2 selections; the manifest is the union of the two forks'
  // launch records (legacy: effort unset in both)
  const launchOf = run => JSON.parse(readFileSync(path.join(a['autobench-root'], run, 'launch.json'), 'utf8'));
  const p2nodes = [['m3-a1c', 'm3-a1c-dev60-dn'], ['sonnet-a1', 'a1s-dev60-dn']].flatMap(([arm, run]) => manifestFromLaunch(launchOf(run), { runId: run }).nodes.map(n => ({ ...n, name: `${arm}:${n.name}` })));
  out.headline = {};
  for (const key of ['rl2+cc/T1', 'rl2/T1']) {
    const sel = out.configs[key].selection.P2;
    out.headline[key] = Object.fromEntries(['tri', 'R1', 'R0'].map(rule => [rule, headlineRow({ label: `P2 ${rule} (${key})`, passes: sel[rule].all.passes, n: sel[rule].all.n,
      reachable: { passes: sel[rule].reachable.passes, n: sel[rule].reachable.n, source: 'dev60 minus the 7 hard benchmark defects (move0/dev60-ceiling-strata.json)' },
      manifest: { runId: `P2-${rule}`, paid: true, nodes: rule === 'R0' ? p2nodes.filter(n => n.name.startsWith('m3-a1c:')) : p2nodes }, legacy: 'pre-D28 dev runs: effort unset in the launch records' })]));
  }
  // n_eff of the scored rows (task clusters, label as the event)
  out.rowsNeff = effectiveN([...new Set(reported.map(it => it.task))].map(t => { const xs = reported.filter(it => it.task === t); return { n: xs.length, wrong: xs.filter(it => !it.y).length }; }));
  writeFileSync(a.out, JSON.stringify(out, null, 1) + '\n');
  const brief = Object.fromEntries(Object.entries(out.configs).map(([k, v]) => [k, { sup: v.rows.supported, prec: v.rows.supportedPrecision?.toFixed(3), cov: v.rows.coverage.toFixed(3), unkPass: v.rows.unknownPassRate?.toFixed(3), loto20: `${v.loto.a20.released}/${v.loto.a20.n} prec ${v.loto.a20.precision?.toFixed(3)}`, P2: v.selection ? `${v.selection.P2.tri.all.passes} (R1 ${v.selection.P2.R1.all.passes}, R0 ${v.selection.P2.R0.all.passes})` : '-' }]));
  console.log(JSON.stringify({ fidelity: { rl2: `${fidelity.rl2Identical}/${fidelity.rl2Rows}`, cc: fidelity.ccRows }, rowsNeff: out.rowsNeff.nEff, brief }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
