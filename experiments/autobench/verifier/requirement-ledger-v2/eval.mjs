#!/usr/bin/env node
// Evaluate requirement-ledger-v2 on the verifier lab (development evidence, devTrain dev60 only).
//
//   node eval.mjs --vlab <lab dir> --run <rl2 out dir> [--tag T] [--judge-tag J] [--eval-folds 3,4] [--out <dir>]
//        [--exclude-tasks a,b] [--cc <code-checks rows.jsonl>]
//
// Reports, per variant (code checks only; code + judged checks; optional AND with the code-checks verifier):
//  - task-attempt (row) level: precision / recall / F1 of "passes" (accept), fail recall, reject precision, AUROC of score;
//  - requirement level, where assertion TYPES allow: the label's failed assertion types are binned into presence, value
//    and negative; a verifier "flags" a bin when one of its failing checks is of that bin. Recall and precision per bin;
//  - selection: one world per task among stored arms, by (accept, score), ties to the lab's arm order (and the expected
//    result under random tie-breaks), against the best single arm and the oracle; k = 3 forks (Mercury-planner A1-C,
//    Haiku A1-C, Haiku A1) with their stored cost;
//  - a fitted score threshold (fit on 4 folds, scored on the 5th, rotated);
//  - cost: extraction (per task) and judged checks (per candidate), from the run's own records.
// Labels are read here only, for scoring; nothing in this file feeds a verifier.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { combine } from './verify.mjs';

const list = s => (s ? String(s).split(',').map(x => x.trim()).filter(Boolean) : null);
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
function args(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) throw new Error(`unexpected ${k}`); a[k.slice(2)] = argv[++i]; } return a; }

// ---------- metrics ----------
export function auroc(pairs) { // [{s, y}] ; ties count half
  const pos = pairs.filter(p => p.y), neg = pairs.filter(p => !p.y);
  if (!pos.length || !neg.length) return null;
  const sorted = [...pairs].sort((a, b) => a.s - b.s);
  let rankSum = 0, i = 0;
  while (i < sorted.length) { let j = i; while (j < sorted.length && sorted[j].s === sorted[i].s) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) if (sorted[k].y) rankSum += r; i = j; }
  return (rankSum - pos.length * (pos.length + 1) / 2) / (pos.length * neg.length);
}
export function prf(items) { // [{accept, y}]
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const x of items) { if (x.accept && x.y) tp++; else if (x.accept) fp++; else if (x.y) fn++; else tn++; }
  const P = tp + fp ? tp / (tp + fp) : null, R = tp + fn ? tp / (tp + fn) : null;
  return { n: items.length, tp, fp, tn, fn, base: items.length ? (tp + fn) / items.length : null, precision: P, recall: R, f1: P && R ? 2 * P * R / (P + R) : 0,
    failRecall: tn + fp ? tn / (tn + fp) : null, rejectPrecision: tn + fn ? tn / (tn + fn) : null, acceptRate: items.length ? (tp + fp) / items.length : null };
}

// ---------- requirement level (assertion-type bins; eval only) ----------
export const assertionBin = t => (/_not_|_not$/.test(t) ? 'negative'
  : /(body_contains|_contains$|field_equals|cell_equals|signer_order|has_tag|has_status|phone_equals|_count$|recipient|exists_with_field|with_content|has_event|is_read|with_summary|with_subject)/.test(t) ? 'value' : 'presence');
export const checkBin = (type, polarity) => {
  if (polarity === 'must_not' || ['msg_none', 'post_none', 'msg_lacks', 'rec_unchanged', 'rec_field_not', 'rec_kept', 'created_none', 'no_dup'].includes(type)) return 'negative';
  if (['msg_has', 'rec_field', 'created_has'].includes(type)) return 'value';
  return 'presence';
};

const ARMS_K3 = ['m3-a1c', 'haiku-a1c', 'haiku-a1'];
const ARM_SETS = lab => ({
  'all 10 arms': null,
  '8 date-note arms': lab.ARM_ORDER.filter(a => !a.endsWith('-pre')),
  '6 reported arms': ['haiku-a0', 'haiku-a1', 'haiku-a1c', 'sonnet-a0', 'sonnet-a1', 'm3-a1c'],
  'k=3 forks (m3-a1c, haiku-a1c, haiku-a1)': ARMS_K3,
  'm3-a1c + sonnet-a1': ['m3-a1c', 'sonnet-a1'],
  'm3-a1c + haiku-a1c': ['m3-a1c', 'haiku-a1c'],
});

/** Selection over groups: rank by key (higher better), ties to arm order; also the expected passes under a random tie-break. */
function selectGroups(groups, keyOf, order) {
  let pass = 0, randomTie = 0, moved = 0, gains = 0, losses = 0;
  const picks = [];
  for (const [task, rs] of groups) {
    const ranked = [...rs].sort((a, b) => cmpKey(keyOf(b), keyOf(a)) || order.indexOf(a.arm) - order.indexOf(b.arm));
    const best = ranked[0];
    const top = ranked.filter(r => cmpKey(keyOf(r), keyOf(best)) === 0);
    const y = best.label.task_completed_correctly === 1;
    pass += y ? 1 : 0;
    randomTie += top.filter(r => r.label.task_completed_correctly === 1).length / top.length;
    const prior = [...rs].sort((a, b) => order.indexOf(a.arm) - order.indexOf(b.arm))[0];
    if (best.rowId !== prior.rowId) { moved++; const yp = prior.label.task_completed_correctly === 1; if (y && !yp) gains++; if (!y && yp) losses++; }
    picks.push({ task, pick: best.arm, pass: y });
  }
  return { pass, randomTie: Math.round(randomTie * 10) / 10, moved, gainsVsPrior: gains, lossesVsPrior: losses, n: groups.size, picks };
}
const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] > b[i] + 1e-12) return 1; if (a[i] < b[i] - 1e-12) return -1; } return 0; };

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.vlab || !o.run) throw new Error('usage: node eval.mjs --vlab <dir> --run <rl2 out> [--tag T] [--judge-tag J] [--eval-folds 3,4] [--out dir]');
  const lab = await import(pathToFileURL(path.join(path.resolve(o.vlab), 'load.mjs')).href);
  const run = path.resolve(o.run);
  const checks = new Map(readJsonl(path.join(run, `checks${o.tag ? '-' + o.tag : ''}.jsonl`)).map(c => [c.rowId, c]));
  const judge = new Map(readJsonl(path.join(run, `judge${o['judge-tag'] ? '-' + o['judge-tag'] : ''}.jsonl`)).filter(j => j.ok).map(j => [j.rowId, j]));
  const cc = o.cc ? new Map(readJsonl(o.cc).map(r => [r.rowId, r.v?.facts ?? null])) : null;
  const excl = new Set(list(o['exclude-tasks']) ?? []);
  const evalFolds = list(o['eval-folds'])?.map(Number) ?? null;
  const rowsAll = lab.loadRows({ canonicalOnly: true }).filter(r => checks.has(r.rowId) && !excl.has(r.task));
  const inEval = r => !evalFolds || evalFolds.includes(r.fold);

  const variants = {
    code: r => combine({ code: checks.get(r.rowId).code, useJudged: false }),
    'code, support-weighted score': r => { const c = checks.get(r.rowId); return combine({ code: c.code, useJudged: false, readers: c.readers }); },
    'code+judged': r => { const c = checks.get(r.rowId); const j = judge.get(r.rowId); return combine({ code: c.code, judged: c.judged, verdicts: j?.verdicts ?? null, useJudged: true }); },
  };
  variants['code+judged, support-weighted score'] = r => { const c = checks.get(r.rowId); const j = judge.get(r.rowId); return combine({ code: c.code, judged: c.judged, verdicts: j?.verdicts ?? null, useJudged: true, readers: c.readers }); };
  if (cc) variants['code+judged AND code-checks'] = r => { const v = variants['code+judged'](r); const x = cc.get(r.rowId); return x ? { ...v, accept: v.accept && x.accept, score: v.score - (x.accept ? 0 : 1) } : v; };

  const judgedCoverage = { rowsWithJudged: rowsAll.filter(r => checks.get(r.rowId).judged.length).length, rowsJudged: rowsAll.filter(r => judge.has(r.rowId)).length };
  const res = { evalFolds, excludedTasks: [...excl], rows: rowsAll.filter(inEval).length, tasks: new Set(rowsAll.filter(inEval).map(r => r.task)).size, judgedCoverage, variants: {} };

  for (const [name, fn] of Object.entries(variants)) {
    const V = new Map(rowsAll.map(r => [r.rowId, fn(r)]));
    const ev = rowsAll.filter(inEval);
    const items = ev.map(r => ({ accept: V.get(r.rowId).accept, y: r.label.task_completed_correctly === 1, s: V.get(r.rowId).score, arm: r.arm, fold: r.fold }));
    const out = { rowLevel: { ...prf(items), auroc: auroc(items.map(x => ({ s: x.s, y: x.y }))) }, byArm: {}, byFold: {} };
    for (const a of lab.ARM_ORDER) { const it = items.filter(x => x.arm === a); if (it.length) out.byArm[a] = { ...prf(it), auroc: auroc(it.map(x => ({ s: x.s, y: x.y }))) }; }
    for (const f of [0, 1, 2, 3, 4]) { const it = items.filter(x => x.fold === f); if (it.length) out.byFold[f] = { ...prf(it), auroc: auroc(it.map(x => ({ s: x.s, y: x.y }))) }; }
    // requirement level
    const bins = ['presence', 'value', 'negative'];
    const rq = Object.fromEntries(bins.map(b => [b, { labelFailedRows: 0, flaggedRows: 0, both: 0 }]));
    let anyFailedRows = 0, anyFlagged = 0, anyBoth = 0;
    for (const r of ev) {
      const lb = new Set((r.label.failedTypes ?? []).map(assertionBin));
      const v = V.get(r.rowId);
      const fb = new Set(v.failing.filter(f => f.hard).map(f => f.by === 'judge' ? (f.cat === 'negative' || f.cat === 'side_effect' ? 'negative' : 'value') : checkBin(checks.get(r.rowId).code.find(c => c.key === f.key)?.type, checks.get(r.rowId).code.find(c => c.key === f.key)?.polarity)));
      if (fb.has('presence') && r.diff.nChanges === 0) { /* no-op rows count as presence flags */ }
      for (const b of bins) { const L = lb.has(b), F = fb.has(b); if (L) rq[b].labelFailedRows++; if (F) rq[b].flaggedRows++; if (L && F) rq[b].both++; }
      if (lb.size) anyFailedRows++; if (fb.size) anyFlagged++; if (lb.size && fb.size) anyBoth++;
    }
    for (const b of bins) { const x = rq[b]; x.recall = x.labelFailedRows ? x.both / x.labelFailedRows : null; x.precision = x.flaggedRows ? x.both / x.flaggedRows : null; }
    out.requirementLevel = { bins: rq, anyFailure: { labelFailedRows: anyFailedRows, flaggedRows: anyFlagged, both: anyBoth } };
    // per check type: how often a hard failure lands on a failing row
    const per = {};
    for (const r of ev) for (const c of checks.get(r.rowId).code) {
      if (c.pass !== false) continue;
      const k = `${c.type}${c.hard ? '' : ' (soft)'}`;
      per[k] ??= { fires: 0, onFailingRows: 0 };
      per[k].fires++; if (r.label.task_completed_correctly !== 1) per[k].onFailingRows++;
    }
    if (name !== 'code') for (const r of ev) { const j = judge.get(r.rowId); if (!j) continue; for (const q of checks.get(r.rowId).judged) { const v = j.verdicts?.[q.id]?.verdict; if (v !== 'not_met') continue; const k = `judged ${q.kind}${q.hard ? '' : ' (soft)'}`; per[k] ??= { fires: 0, onFailingRows: 0 }; per[k].fires++; if (r.label.task_completed_correctly !== 1) per[k].onFailingRows++; } }
    for (const x of Object.values(per)) x.failPrecision = x.fires ? x.onFailingRows / x.fires : null;
    out.perCheckType = Object.fromEntries(Object.entries(per).sort((a, b) => b[1].fires - a[1].fires));
    // selection
    out.selection = {};
    for (const [setName, arms] of Object.entries(ARM_SETS(lab))) {
      const g = lab.selectionGroups({ rows: rowsAll.filter(inEval), arms, minArms: 2 });
      const best = {}; for (const r of [...g.values()].flat()) { best[r.arm] ??= 0; if (r.label.task_completed_correctly === 1) best[r.arm]++; }
      const bestArm = Object.entries(best).sort((a, b) => b[1] - a[1])[0];
      const oracle = [...g.values()].filter(rs => rs.some(r => r.label.task_completed_correctly === 1)).length;
      const s1 = selectGroups(g, r => { const v = V.get(r.rowId); return [v.accept ? 1 : 0, v.score]; }, lab.ARM_ORDER);
      const s2 = selectGroups(g, r => { const v = V.get(r.rowId); return [v.score]; }, lab.ARM_ORDER);
      const s3 = selectGroups(g, r => { const v = V.get(r.rowId); return [-v.hardFails, v.score]; }, lab.ARM_ORDER);
      out.selection[setName] = { tasks: g.size, bestSingleArm: bestArm ? { arm: bestArm[0], pass: bestArm[1] } : null, oracle,
        acceptThenScore: { pass: s1.pass, randomTie: s1.randomTie, moved: s1.moved, gains: s1.gainsVsPrior, losses: s1.lossesVsPrior },
        scoreOnly: { pass: s2.pass, randomTie: s2.randomTie, moved: s2.moved, gains: s2.gainsVsPrior, losses: s2.lossesVsPrior },
        fewestHardFails: { pass: s3.pass, randomTie: s3.randomTie, moved: s3.moved, gains: s3.gainsVsPrior, losses: s3.lossesVsPrior } };
    }
    // fitted threshold on score (LOFO): fit the F1-best threshold on 4 folds, apply to the 5th
    if (!evalFolds) {
      const fit = [];
      for (const k of [0, 1, 2, 3, 4]) {
        const tr = items.filter(x => x.fold !== k), te = items.filter(x => x.fold === k);
        const ths = [...new Set(tr.map(x => x.s))].sort((a, b) => a - b);
        let bestT = 1, bestF = -1;
        for (const t of ths) { const f = prf(tr.map(x => ({ accept: x.s >= t, y: x.y }))).f1; if (f > bestF) { bestF = f; bestT = t; } }
        fit.push(...te.map(x => ({ accept: x.s >= bestT, y: x.y })));
      }
      out.fittedThreshold = prf(fit);
    }
    res.variants[name] = out;
  }
  // cost
  const ext = readJsonl(path.join(run, 'extract.jsonl')).filter(j => j.ok);
  const jud = readJsonl(path.join(run, `judge${o['judge-tag'] ? '-' + o['judge-tag'] : ''}.jsonl`)).filter(j => j.ok);
  const byReader = {};
  for (const j of ext) { byReader[j.reader] ??= { calls: 0, usd: 0, tokens: 0 }; byReader[j.reader].calls++; byReader[j.reader].usd += j.costUsd ?? 0; byReader[j.reader].tokens += (j.usage?.inputTokens ?? 0) + (j.usage?.outputTokens ?? 0) + (j.usage?.cacheReadTokens ?? 0) + (j.usage?.cacheWriteTokens ?? 0); }
  const nTasks = new Set(ext.map(j => j.task)).size;
  const judgeUsd = jud.reduce((s, j) => s + (j.costUsd ?? 0), 0);
  res.cost = { extractionByReader: byReader, tasks: nTasks, extractionUsdPerTask: nTasks ? Object.values(byReader).reduce((s, x) => s + x.usd, 0) / nTasks : null,
    mercuryTokensPerTask: byReader['mercury:0'] ? byReader['mercury:0'].tokens / byReader['mercury:0'].calls : null,
    judgeCalls: jud.length, judgeUsd, judgeUsdPerCandidate: jud.length ? judgeUsd / jud.length : null };
  const txt = JSON.stringify(res, null, 1);
  if (o.out) { mkdirSync(o.out, { recursive: true }); writeFileSync(path.join(o.out, 'eval.json'), txt); }
  console.log(o.brief ? brief(res) : txt);
}

function brief(res) {
  const f = x => (x === null || x === undefined ? '-' : typeof x === 'number' ? x.toFixed(3) : x);
  const L = [`rows ${res.rows}, tasks ${res.tasks}, evalFolds ${res.evalFolds ?? 'all'}; judged coverage ${JSON.stringify(res.judgedCoverage)}`];
  for (const [n, v] of Object.entries(res.variants)) {
    const r = v.rowLevel;
    L.push(`[${n}] P ${f(r.precision)} R ${f(r.recall)} F1 ${f(r.f1)} AUROC ${f(r.auroc)} failRecall ${f(r.failRecall)} rejPrec ${f(r.rejectPrecision)} base ${f(r.base)} accept ${f(r.acceptRate)}${v.fittedThreshold ? ` | fitted P ${f(v.fittedThreshold.precision)} R ${f(v.fittedThreshold.recall)} F1 ${f(v.fittedThreshold.f1)}` : ''}`);
    L.push(`   req-level: ${Object.entries(v.requirementLevel.bins).map(([b, x]) => `${b} R ${f(x.recall)} P ${f(x.precision)} (${x.labelFailedRows}/${x.flaggedRows})`).join('; ')}`);
    for (const [s, x] of Object.entries(v.selection)) L.push(`   sel ${s}: best ${x.bestSingleArm?.arm}=${x.bestSingleArm?.pass} oracle ${x.oracle} | accept>score ${x.acceptThenScore.pass} (rand ${x.acceptThenScore.randomTie}, +${x.acceptThenScore.gains}/-${x.acceptThenScore.losses}) | score ${x.scoreOnly.pass} | fewestHard ${x.fewestHardFails.pass}`);
    L.push(`   per type: ${Object.entries(v.perCheckType).slice(0, 14).map(([k, x]) => `${k} ${x.fires}/${f(x.failPrecision)}`).join('; ')}`);
  }
  L.push(`cost ${JSON.stringify(res.cost)}`);
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.stack ?? String(e)); process.exit(1); });
}
