// Swarm ladder rung 1 report ($0): the frozen analysis (analyze-r1.mjs) plus the POST-HOC checks the RESULT document
// labels as such:
//   evidence   locus2.mjs: did the evidence a unit needed reach the session (sentence or id+compound co-mention)?
//   W.relative for each W unit on a compound whose establishing test uses the d5 test-split form "run K days after the site
//              visit of DATE": is the visit date before the cut-off while the test date (visit + K) is on or after it, so that a
//              solver dating the test by the visit misses it? (the W solver's latestDate() takes the last date in the extracted
//              phrase: the visit)
//   W.policy   the task's ranking policy (W's solver ranks n-first unless the prompt says "sample size does not matter")
//   W.keys     rows whose entity is a lower-cased code (W's compoundKey() 'name:' fallback), i.e. one compound split in two
//   S-F        rung 1b's fan-out arm (Amendment 1), when its live directory exists
//   node experiments/swarm/report-r1.mjs [--rule a2|a3] [--out <dir>]
import path from 'node:path';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as bed from '../../beds/wbed/r6/index.mjs';
import { analyze, archiveOf, ARMS } from './analyze-r1.mjs';
import { errorUnits, truthOf, trapCounts } from './rootcause.mjs';
import { evidenceLocus } from './locus2.mjs';
import { codeSession, replays } from './coord.mjs';
import { LIVE } from './run-r1.mjs';
import { LIVE as LIVE_1B } from './run-r1b.mjs';

const dayOf = s => { const d = Date.parse(s); return Number.isFinite(d) ? Math.round(d / 864e5) : null; };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function parseAnyDate(s) {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return dayOf(`${m[1]}-${m[2]}-${m[3]}`);
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); if (m) return dayOf(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  m = t.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/); if (m && MONTHS.includes(m[2].toLowerCase())) return dayOf(`${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  m = t.match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/); if (m && MONTHS.includes(m[1].toLowerCase())) return dayOf(`${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`);
  return null;
}
/** The relative test-date sentence of a document: { k, visitDay } or null. */
export function relativeTest(text) {
  const m = String(text).match(/run (\d+) days after the site visit of (.+?)\.(?:\s|$)/);
  if (!m) return null;
  const visit = parseAnyDate(m[2]);
  return visit == null ? null : { k: Number(m[1]), visitDay: visit };
}
function wRelative(task, units) {
  const t = truthOf(task), cutoff = dayOf(task.inputs.question.tested_on_or_after);
  return units.filter(u => u.unit === 'missing-compound').map(u => {
    const est = t.establishing.get(u.code) ?? [];
    const rel = est.map(id => relativeTest(task.files[`corpus/${id}.txt`]));
    const visitBeforeCutoff = rel.length > 0 && rel.every(r => r && r.visitDay < cutoff && r.visitDay + r.k >= cutoff);
    return { code: u.code, establishing: est.length, relative: rel.filter(Boolean).length, explainedByVisitDate: visitBeforeCutoff };
  });
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

export async function report({ live = LIVE, live1b = LIVE_1B, rule = 'a2' } = {}) {
  const res = await analyze({ live, stage: 'heldout', rule });
  // sensitivity (review fix B1): the same analysis under Amendment 3 (a failed cd to a path that does not exist is no access)
  const alt = rule === 'a3' ? null : await analyze({ live, stage: 'heldout', rule: 'a3' });
  const sensitivity = alt ? { a3: { tasks: alt.tasks, incomplete: alt.incomplete, table: alt.table, comparisons: alt.comparisons } } : null;
  const extra = [];
  for (const an of res.anatomyAll ?? res.anatomy) {
    const [, , , s] = an.taskKey.split(':');
    const task = bed.generate({ seed: Number(s.slice(1)), split: 'test', difficulty: 5 });
    const arc = archiveOf(live, an.arm, an.taskKey);
    const units = an.pass ? [] : errorUnits(task, arc.answer);
    const x = { arm: an.arm, taskKey: an.taskKey, pass: an.pass, inComparison: an.inComparison ?? true, policy: truthOf(task).world.policy };
    if (an.arm !== ARMS.W) {
      const ev = evidenceLocus(task, units, arc.events, { parent: 'any' });
      x.evidence = { units: ev.length, seen: ev.filter(e => e.evidence === true).length, notSeen: ev.filter(e => e.evidence === false).length };
    } else {
      x.relative = wRelative(task, units);
      x.lowerCodeRows = (arc.answer?.table ?? []).filter(r => /^[a-z]{2,4}-\d{2,5}$/.test(String(r.entity))).length;
      x.dupRows = units.filter(u => u.unit === 'duplicate-row').length;
      x.policyCellUnits = units.filter(u => u.unit === 'wrong-cell' && u.traps.some(k => k.startsWith('policy-'))).length;
      x.wrongCells = units.filter(u => u.unit === 'wrong-cell').length;
      // review: the technical-report trace, reproducible (W's solve.mjs type list omits "Technical report"): a missing
      // compound every establishing document of which is a technical report; a missing or wrong cell whose true winner is one
      const tr = truthOf(task), isTR = id => tr.byId.get(id)?.kind === 'techreport';
      const cellTR = u => isTR(tr.cells.get(`${u.code}|${u.property}`)?.source);
      const count = (kind, f) => { const us = units.filter(u => u.unit === kind); return { units: us.length, techreport: us.filter(f).length }; };
      x.techreport = { missingCompounds: count('missing-compound', u => (tr.establishing.get(u.code) ?? []).length > 0 && tr.establishing.get(u.code).every(isTR)),
        missingCells: count('missing-cell', cellTR), wrongCells: count('wrong-cell', cellTR) };
      x.calls = arc.calls.length;
    }
    extra.push(x);
  }
  // rung 1b (exploratory) when it ran
  let r1b = null;
  const f1b = path.join(live1b, 'heldout', 'results.jsonl');
  if (existsSync(f1b)) {
    const rows = readFileSync(f1b, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    r1b = rows.map(r => {
      const seed = Number(r.taskKey.split(':s')[1]);
      const task = bed.generate({ seed, split: 'test', difficulty: 5 });
      const arc = archiveOf(live1b, r.arm, r.taskKey);
      const units = r.pass ? [] : errorUnits(task, arc.answer);
      const result = [...arc.events].reverse().find(e => e?.type === 'result');
      const coord = arc.tree ? codeSession({ task, tree: arc.tree, output: arc.answer, error: r.error, stats: result?.subagent_stats ?? null, drift: r.meta?.drift ?? [], workFiles: arc.workFiles, events: arc.events }) : null;
      const rp = !r.pass && arc.tree ? replays({ task, tree: arc.tree, output: arc.answer, workFiles: arc.workFiles, bed }) : null;
      const ev = evidenceLocus(task, units, arc.events, { parent: 'any' });
      return { taskKey: r.taskKey, pass: r.pass, score: r.score, costUsd: r.costUsd, wallS: Math.round(r.latencyMs / 1000), error: r.error?.code ?? null,
        workers: r.meta?.workers, batches: r.meta?.batches, maxConcurrent: r.meta?.maxConcurrent, criticalSteps: r.meta?.criticalSteps, timing: r.meta?.timing ?? null,
        stats: r.meta?.subagentStats ?? null, drift: r.meta?.drift ?? [], traps: trapCounts(units), units: units.length,
        coord: coord ? { codes: Object.entries(coord.codes).filter(([, v]) => v).map(([k]) => k), detail: { missing: coord.detail.missing, planGap: coord.detail.planGap.length,
          unassigned: coord.detail.unassigned.length, aggregationLoss: coord.detail.aggregationLoss.length, conflictWrong: coord.detail.conflictWrong.length, workerWrong: coord.detail.workerWrongPropagated.length } } : null,
        replays: rp, evidence: { seen: ev.filter(e => e.evidence === true).length, notSeen: ev.filter(e => e.evidence === false).length },
        briefs: (arc.tree?.workers ?? []).map(w => ({ chars: w.brief.length, docs: w.docsRead.length, turns: w.turns, ms: w.durationMs, error: w.isError })) };
    });
  }
  // review fix M4: rung 1b's arm against both rung-1 arms on the same task (N = 1, exploratory), not against S alone
  if (r1b) {
    const rows = readFileSync(path.join(live, 'heldout', 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    for (const x of r1b) {
      const same = arm => rows.find(r => r.arm === arm && r.taskKey === x.taskKey);
      const a = same(ARMS.A), sw = same(ARMS.S);
      x.vsSameTask = { A: a ? { pass: a.pass, score: a.score, costUsd: a.costUsd, wallS: Math.round(a.latencyMs / 1000), costRatio: x.costUsd / a.costUsd, wallRatio: x.wallS / (a.latencyMs / 1000) } : null,
        S: sw ? { pass: sw.pass, score: sw.score, costUsd: sw.costUsd, wallS: Math.round(sw.latencyMs / 1000), costRatio: x.costUsd / sw.costUsd, wallRatio: x.wallS / (sw.latencyMs / 1000) } : null };
    }
  }
  return { ...res, sensitivity, posthoc: extra, rung1b: r1b };
}

async function main() {
  const i = process.argv.indexOf('--out'), out = i > 0 ? process.argv[i + 1] : null;
  const j = process.argv.indexOf('--rule'), rule = j > 0 ? process.argv[j + 1] : 'a2';
  const r = await report({ rule });
  const { anatomy, anatomyAll, ...summary } = r;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'SUMMARY-R1.json'), JSON.stringify(summary, null, 1) + '\n');
    writeFileSync(path.join(out, 'ROOTCAUSE-R1.jsonl'), (anatomyAll ?? anatomy).map(x => JSON.stringify(x)).join('\n') + '\n');
  }
  console.log(JSON.stringify({ rules: summary.rules, table: summary.table, comparisons: summary.comparisons.map(c => ({ a: c.a, b: c.b, mcnemar: c.mcnemar, pass: c.passBootstrap.successDiff, score: c.score })),
    sensitivity: summary.sensitivity && Object.fromEntries(Object.entries(summary.sensitivity).map(([k, v]) => [k, { tasks: v.tasks, comparisons: v.comparisons.map(c => ({ a: c.a, b: c.b, mcnemar: c.mcnemar, score: c.score })) }])),
    posthoc: summary.posthoc, rung1b: summary.rung1b }, null, 1));
  void pct;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
