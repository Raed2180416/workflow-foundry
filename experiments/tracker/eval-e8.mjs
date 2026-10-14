// Requirement tracker, analyst-side evaluation on E8 (research/need-router-20261014/tracker-e8/PREREG.md). This file is
// NOT part of the tracker: the tracker (extract, write, check) never imports it. It scores an extracted ledger against
// the frozen gold (ids, U-list, clause anchors) mechanically, and maps a build's failing requirements to the SPEC-E ids
// they cover.
//
//   node experiments/tracker/eval-e8.mjs score --ledger L.json [--ledger L2.json ...] --gold gold.json --text SPEC-E.md
//   node experiments/tracker/eval-e8.mjs adjudicate --ledger L.json --build solver.mjs     (oracle join; analyst only)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexText } from './ledger.mjs';

/** Ids whose span contains the requirement's quote span. */
export const idsOf = (span, spans) => Object.entries(spans).filter(([, s]) => span.line >= s[0] && span.lineEnd <= s[1]).map(([id]) => id);

/** scoreExtraction(ledger, gold, text) → mechanical recall metrics (PREREG §a). */
export function scoreExtraction(ledger, gold, text) {
  const ix = indexText(text);
  const ranges = ledger.requirements.map(r => ({ id: r.id, at: ix.locate(r.quote), span: r.span })).filter(r => r.at);
  const covered = spans => Object.keys(spans).filter(id => ranges.some(r => r.span.line >= spans[id][0] && r.span.lineEnd <= spans[id][1]));
  const ids = covered(gold.ids);
  const uSpans = Object.fromEntries(Object.entries(gold.u).map(([k, u]) => [k, u.span]));
  const us = covered(uSpans);
  const clauses = gold.clauses.map(c => {
    const a = ix.locate(c.anchor);
    const hit = ranges.filter(r => r.at.start < a.end && a.start < r.at.end).map(r => r.id);
    const unc = (ledger.uncovered ?? []).some(u => u.line <= a.line && a.lineEnd <= (u.lineEnd ?? u.line));
    return { id: c.id, of: c.of, covered: hit.length > 0, by: hit, inUncovered: unc };
  });
  const missedClauses = clauses.filter(c => !c.covered);
  const lines = text.split('\n');
  const historyStart = lines.findIndex(l => /^## 6\./.test(l)) + 1;
  const nonNormative = ledger.requirements.filter(r => (historyStart > 0 && r.span.line >= historyStart) || /^\s*#/.test(lines[r.span.line - 1] ?? ''));
  const returned = ledger.extractor?.returned ?? (ledger.requirements.length + (ledger.dropped?.length ?? 0));
  return {
    entries: ledger.requirements.length, returned, dropped: ledger.dropped?.length ?? 0, droppedShare: returned ? (ledger.dropped?.length ?? 0) / returned : 0,
    idRecall: ids.length / Object.keys(gold.ids).length, idsCovered: ids.length, idsMissed: Object.keys(gold.ids).filter(id => !ids.includes(id)),
    uRecall: us.length / Object.keys(uSpans).length, uMissed: Object.keys(uSpans).filter(id => !us.includes(id)),
    clauseCoverage: (clauses.length - missedClauses.length) / clauses.length, clausesMissed: missedClauses.map(c => c.id),
    guardYield: missedClauses.length ? missedClauses.filter(c => c.inUncovered).length / missedClauses.length : null,
    guardCaught: missedClauses.filter(c => c.inUncovered).map(c => c.id),
    nonNormative: nonNormative.map(r => r.id), uncovered: ledger.uncovered?.length ?? 0,
    kinds: ledger.requirements.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {}),
    costUsd: ledger.extractor?.costUsd ?? null, latencyMs: ledger.extractor?.latencyMs ?? null, model: ledger.extractor?.model ?? null,
  };
}

/**
 * adjudicate({ ledger, solverSource }) → per requirement, every ok:false instance on this build's practice runs, each
 * joined (by subject) to the bed oracle's verdict on the same case of the same run. Analyst-side only (PREREG §c1): the
 * build still runs out of process; the oracle grades the host rows of that run, with the pools of the reference runs.
 */
export async function adjudicate({ ledger, solverSource, practice, log = () => {} }) {
  const { runBuild, propertiesOver } = await import('./run.mjs');
  const e8 = await import('../../beds/ebed/e8/index.mjs');
  const { PRACTICE } = await import('../ebed/smoke-service.mjs');
  const item = { binding: e8.binding, generateWorld: e8.generateWorld, oracleItem: e8.oracleItem };
  practice ??= PRACTICE;
  const runs = await runBuild({ item, solverSource, practice, log });
  const results = await propertiesOver(ledger, runs);
  const out = { worlds: {}, requirements: {} };
  const norm = s => (typeof s === 'string' ? s.trim().replace(/^#/, '').toUpperCase() : null);
  for (const [i, run] of runs.entries()) {
    const world = e8.generateWorld({ seed: practice.seeds[i], difficulty: practice.difficulties[i], mix: 'tail', ...(practice.size ? { size: practice.size } : {}) });
    const { pools } = await e8.referenceRuns(world);
    const v = e8.oracle(world, run.rows, { pools, arm: 'adjudicate' });
    const bySubject = new Map();
    for (const c of v.cases) { const k = norm(c.subject); if (!bySubject.has(k)) bySubject.set(k, []); bySubject.get(k).push(c); }
    const comp = v.cases.filter(c => c.pool === 'completed');
    out.worlds[run.world] = { completed: comp.length, passed: comp.filter(c => c.pass).length, critical: v.critical.length };
    for (const [id, res] of results.get(run.world)) {
      if (!res?.ok) continue;
      for (const inst of res.instances.filter(x => x.ok === false)) {
        const cases = bySubject.get(norm(inst.subject)) ?? [];
        (out.requirements[id] ??= []).push({ world: Number(run.world), subject: inst.subject, at: inst.at, why: inst.why, refs: inst.refs,
          oracle: cases.length ? cases.map(c => ({ case: c.case, class: c.class, pool: c.pool, pass: c.pass, complete: c.complete,
            first: c.firstDivergence ? { code: c.firstDivergence.code, rule: c.firstDivergence.rule ?? null, lid: c.firstDivergence.lid ?? null, at: c.firstDivergence.at ?? null } : null })) : null });
      }
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = k => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]] : []));
  if (args[0] === 'score') {
    const gold = JSON.parse(readFileSync(get('gold')[0], 'utf8'));
    const text = readFileSync(get('text')[0], 'utf8');
    for (const f of get('ledger')) console.log(JSON.stringify({ ledger: f, ...scoreExtraction(JSON.parse(readFileSync(f, 'utf8')), gold, text) }));
  } else if (args[0] === 'adjudicate') {
    const ledger = JSON.parse(readFileSync(get('ledger')[0], 'utf8'));
    const r = await adjudicate({ ledger, solverSource: readFileSync(get('build')[0], 'utf8'), log: s => console.error(s) });
    console.log(JSON.stringify(r, null, 1));
  } else { console.error('usage: eval-e8.mjs score --ledger L.json [...] --gold gold.json --text SPEC-E.md | adjudicate --ledger L.json --build solver.mjs'); process.exit(2); }
}
