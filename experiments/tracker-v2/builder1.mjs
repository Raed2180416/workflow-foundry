// BUILDER-1 adapter for the condition tracker (task #60): the second bed with executable oracles. Analyst-side code; the tracker in
// app/core/tracker never imports it.
//
// - words(case): the person's words = the request (turn 0) + the answer key's answers, in the case's question order (later turns). The
//   answers are what the simulated person says when asked (experiments/surface/person.mjs); they reach the tracker as later edits.
// - builds(): every archived BUILDER-1 build that exists and is strictly valid (5 arms: B-H, B-M, B0-H and the two post-hoc fix arms),
//   each with the hidden-world oracle verdict already recorded in its run record (research/surface-20261021/runs/<arm>/records). The
//   hidden worlds are never run or read here: only the recorded verdict (verified true/false) is used, to label defects.
// - scoreCapture(): condition recall against the frozen gold (research/tracker-20261021/gold-builder1.json), mechanically.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locate } from '../../app/core/tracker/words.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const CASES_FILE = path.join(ROOT, 'research/surface-20261021/eval/cases.json');
export const RUNS_DIR = path.join(ROOT, 'research/surface-20261021/runs');
export const ARMS = Object.freeze(['b-h-1', 'b-m-1', 'b0-h-1', 'b-h-fix-1', 'b-m-fix-1']);
export const GOLD_FILE = path.join(ROOT, 'research/tracker-20261021/gold-builder1.json');
export const sha256 = s => createHash('sha256').update(s).digest('hex');

export const loadCases = () => JSON.parse(readFileSync(CASES_FILE, 'utf8')).cases;

/** The person's words for one case: request, then each answer of the answer key (in question order). */
export function wordsFor(caseDef) {
  const words = [{ turn: 0, kind: 'request', text: caseDef.request }];
  for (const q of caseDef.questions ?? []) words.push({ turn: words.length, kind: 'answer', question: q.id, text: q.answer });
  return words;
}

/** Archived builds: { arm, case, workflow, verified, runPassed, reasons, trapViolated }. Only built, strictly valid, fit cases. */
export function archivedBuilds({ arms = ARMS } = {}) {
  const out = [];
  for (const arm of arms) {
    const dir = path.join(RUNS_DIR, arm, 'records');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (r.judgement?.kind !== 'fit' || r.outcome !== 'ready' || r.builtValid !== true || !r.workflow) continue;
      out.push({ id: `${arm}/${r.case}`, arm, case: r.case, workflow: r.workflow, workflowHash: sha256(JSON.stringify(r.workflow)), template: r.template ?? null,
        verified: r.judgement.verified === true, runPassed: r.judgement.runPassed === true, reasons: r.judgement.reasons ?? [], trapViolated: !!r.judgement.trap?.violated,
        builderCostUsd: r.cost?.usd ?? 0 });
    }
  }
  return out;
}

/** Check that every gold anchor locates verbatim in its turn; returns the problems (empty when the gold is well formed). */
export function validateGold(gold, cases = loadCases()) {
  const problems = [];
  for (const c of cases) {
    const list = gold.cases[c.id];
    if (!list) { problems.push(`${c.id}: no gold entry`); continue; }
    const words = wordsFor(c);
    for (const g of list) for (const [turn, anchor] of g.anchors) {
      const at = locate(words.filter(w => w.turn === turn), anchor);
      if (!at || at.turn !== turn) problems.push(`${g.id}: anchor ${JSON.stringify(anchor)} not in turn ${turn}`);
    }
  }
  return problems;
}

/** Maximum one-to-one matching (Kuhn) of gold conditions to captured conditions by span overlap in the same turn. */
export function scoreCapture(conditions, goldList, words) {
  const spans = goldList.map(g => g.anchors.map(([turn, a]) => ({ turn, ...locate(words.filter(w => w.turn === turn), a) })));
  const overlap = (c, g) => spans[g].some(s => s && c.source && c.source.turn === s.turn && c.source.start < s.end && s.start < c.source.end);
  const owner = new Array(conditions.length).fill(-1);
  const tryG = (g, seen) => {
    for (let j = 0; j < conditions.length; j++) {
      if (seen.has(j) || !overlap(conditions[j], g)) continue;
      seen.add(j);
      if (owner[j] === -1 || tryG(owner[j], seen)) { owner[j] = g; return true; }
    }
    return false;
  };
  const matched = new Set();
  for (let g = 0; g < goldList.length; g++) if (tryG(g, new Set())) matched.add(g);
  const byGold = new Map(owner.map((g, j) => [g, j]).filter(([g]) => g >= 0));
  const rows = goldList.map((g, i) => {
    const j = byGold.get(i);
    const c = j === undefined ? null : conditions[j];
    return { id: g.id, kind: g.kind, testable: g.testable, covered: matched.has(i), by: c ? (c.id ?? `#${j}`) : null,
      verificationAgrees: c ? (c.verification === 'test') === g.testable : null };
  });
  return { gold: goldList.length, covered: matched.size, recall: goldList.length ? matched.size / goldList.length : null,
    testableGold: goldList.filter(g => g.testable).length, testableCovered: rows.filter(r => r.testable && r.covered).length,
    captured: conditions.length, unmatchedCaptured: conditions.length - matched.size, rows };
}
