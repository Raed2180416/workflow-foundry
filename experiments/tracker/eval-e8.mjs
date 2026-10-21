// Requirement tracker, analyst-side evaluation on E8 (research/need-router-20261014/tracker-e8/PREREG.md). This file is
// NOT part of the tracker: the tracker (extract, write, check) never imports it. It scores an extracted ledger against
// the frozen gold (ids, U-list, clause anchors) mechanically, and maps a build's failing requirements to the SPEC-E ids
// they cover.
//
//   node experiments/tracker/eval-e8.mjs score --ledger L.json [--ledger L2.json ...] [--gold gold.json] [--text SPEC-E.md]
//   node experiments/tracker/eval-e8.mjs adjudicate --ledger L.json --build solver.mjs     (oracle join; analyst only)
//
// Scoring is against the frozen SPEC-E only (FROZEN_SPEC_E: git 48535bb, the text gold.json's spans and anchors were
// written on). The working-tree SPEC-E has moved since the freeze (lines shift by 7 before §4 as of 2026-10-21), and a
// moved text makes every span wrong and some anchors unlocatable (the scorer used to crash on a null anchor). `score`
// therefore reads the frozen revision from git by default, and scoreExtraction refuses any text, or any ledger, whose
// sha256 is not the gold's (compromise register E1, FIXES Action 3).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexText, isNormative } from './ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = s => createHash('sha256').update(s).digest('hex');

/** The SPEC-E revision the frozen gold was written against (gold.json source.sha256; tracker-e8/freeze.json specE). */
export const FROZEN_SPEC_E = Object.freeze({ rev: '48535bb', file: 'beds/ebed/e8/spec/SPEC-E.md', sha256: 'c013c04c80636682f46fd9bdbc2bf436712ed53233b03a06ba74bd88824f8cf1' });
export const GOLD_FILE = 'research/need-router-20261014/tracker-e8/gold.json';
/**
 * The go-live paragraph of the frozen SPEC-E (§3.5, lines 91–93; FIXES Action 3 acceptance). Coverage is judged per
 * sentence that starts on these lines: `normative` counts the sentences the coverage guard flags (ledger.mjs CUES),
 * which are the ones a missed condition can hide in; `all` adds the descriptive opening sentence.
 */
export const GO_LIVE_LINES = Object.freeze([91, 93]);

/** The frozen SPEC-E text, read from git (never from the working tree); throws unless its sha256 is the frozen one. */
export function frozenSpecE({ rev, file, sha256: want } = FROZEN_SPEC_E, { root = ROOT } = {}) {
  let text;
  try { text = execFileSync('git', ['show', `${rev}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(`cannot read the frozen SPEC-E (git show ${rev}:${file}): ${String(e?.stderr || e?.message || e).trim().slice(0, 200)}`); }
  const got = sha256(text);
  if (got !== want) throw new Error(`git show ${rev}:${file} has sha256 ${got}, not the frozen ${want}`);
  return text;
}

/** Sentences starting on lines [lo, hi] and the ledger entries whose located quote overlaps each. */
export function linesCoverage(ledger, text, [lo, hi] = GO_LIVE_LINES) {
  const ix = indexText(text);
  const ranges = ledger.requirements.map(r => ({ id: r.id, at: ix.locate(r.quote) })).filter(r => r.at);
  const rows = ix.sentences().filter(s => s.line >= lo && s.line <= hi).map(s => ({ line: s.line, lineEnd: s.lineEnd, normative: isNormative(s.text), text: s.text,
    by: ranges.filter(r => r.at.start < s.end && s.start < r.at.end).map(r => r.id) }));
  const count = xs => ({ sentences: xs.length, covered: xs.filter(s => s.by.length).length });
  return { lines: [lo, hi], normative: count(rows.filter(s => s.normative)), all: count(rows), rows };
}

/** Ids whose span contains the requirement's quote span. */
export const idsOf = (span, spans) => Object.entries(spans).filter(([, s]) => span.line >= s[0] && span.lineEnd <= s[1]).map(([id]) => id);

/** scoreExtraction(ledger, gold, text) → mechanical recall metrics (PREREG §a). `text` must be the gold's (frozen) text. */
export function scoreExtraction(ledger, gold, text) {
  const ix = indexText(text);
  if (gold.source?.sha256 && ix.sha256 !== gold.source.sha256)
    throw new Error(`the text is not the one the gold was written against (sha256 ${ix.sha256}, gold ${gold.source.sha256}); score against the frozen SPEC-E (frozenSpecE())`);
  if (ledger.source?.sha256 && ledger.source.sha256 !== ix.sha256)
    throw new Error(`the ledger was extracted from another text (sha256 ${ledger.source.sha256}, scored text ${ix.sha256}); its spans do not refer to the gold's lines`);
  const ranges = ledger.requirements.map(r => ({ id: r.id, at: ix.locate(r.quote), span: r.span })).filter(r => r.at);
  const covered = spans => Object.keys(spans).filter(id => ranges.some(r => r.span.line >= spans[id][0] && r.span.lineEnd <= spans[id][1]));
  const ids = covered(gold.ids);
  const uSpans = Object.fromEntries(Object.entries(gold.u).map(([k, u]) => [k, u.span]));
  const us = covered(uSpans);
  const clauses = gold.clauses.map(c => {
    const a = ix.locate(c.anchor);
    if (!a) throw new Error(`gold clause ${c.id}: its anchor does not locate in the scored text`);
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
    // The second pass over the coverage list (run.mjs gleanLedger), when the ledger had one.
    gleaned: ledger.requirements.filter(r => r.gleaned).length,
    gleanCostUsd: ledger.gleaning?.length ? ledger.gleaning.reduce((s, g) => s + (g.costUsd ?? 0), 0) : null,
    goLive: (({ lines, normative, all, rows }) => ({ lines, normative, all, missed: rows.filter(s => !s.by.length).map(s => `${s.line}: ${s.text.slice(0, 80)}`) }))(linesCoverage(ledger, text)),
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
    const gold = JSON.parse(readFileSync(get('gold')[0] ?? path.join(ROOT, GOLD_FILE), 'utf8'));
    const text = get('text').length ? readFileSync(get('text')[0], 'utf8') : frozenSpecE();   // either way it must hash to the gold's
    for (const f of get('ledger')) console.log(JSON.stringify({ ledger: f, ...scoreExtraction(JSON.parse(readFileSync(f, 'utf8')), gold, text) }));
  } else if (args[0] === 'adjudicate') {
    const ledger = JSON.parse(readFileSync(get('ledger')[0], 'utf8'));
    const r = await adjudicate({ ledger, solverSource: readFileSync(get('build')[0], 'utf8'), log: s => console.error(s) });
    console.log(JSON.stringify(r, null, 1));
  } else { console.error('usage: eval-e8.mjs score --ledger L.json [...] [--gold gold.json] [--text SPEC-E.md, default: git show 48535bb] | adjudicate --ledger L.json --build solver.mjs'); process.exit(2); }
}
