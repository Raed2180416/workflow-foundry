// The one standard, on journals. For each mutant k (scratch copy of the current transition with one line
// mutated), grade every case of every corpus journal with gradeCase exactly as the grader does (frozen at the first
// divergence, records only for complete divergence-free cases) under the original and under the mutant, and compare the
// case verdicts: pass, complete, oracle error, first divergence (layer/code/lid). Prints JSON lines per mutant.
//   node gdiff.mjs <mutantDir> <k,k,...> <corpus.json,...> [maxDiffs]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const R = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');   // beds/ebed
const { generateWorld, oracleItem, canonicalArgs } = await import(pathToFileURL(`${R}/e8/index.mjs`).href);
const { indexJournal, caseIds } = await import(pathToFileURL(`${R}/oracle/view.mjs`).href);
const { gradeCase } = await import(pathToFileURL(`${R}/oracle/grade.mjs`).href);
const [dir, kList, files, maxArg] = process.argv.slice(2);
const MAX = Number(maxArg ?? 3);
const ks = kList.split(',').map(Number);
const items = {};
for (const k of ks) {
  try { const m = await import(pathToFileURL(`${dir}/m${k}.mjs`).href); items[k] = { ...oracleItem, referenceTransition: m.referenceTransition, recordsOf: m.recordsOf }; }
  catch (e) { items[k] = { error: String(e?.message ?? e).slice(0, 100) }; }
}
const fd = v => (v.firstDivergence ? `${v.firstDivergence.layer}/${v.firstDivergence.code}/${v.firstDivergence.lid ?? v.firstDivergence.field ?? ''}` : '');
// The verdict as the grader reports it: the first divergence when there is one (then pass is false whatever `complete` is),
// otherwise pass or censored (complete or not); an oracle error is its own outcome.
const sig = v => (v.oracleError ? 'E' : v.firstDivergence ? `D:${fd(v)}` : v.complete ? 'PASS' : 'OPEN');
const res = Object.fromEntries(ks.map(k => [k, { k, diffs: 0, completedDiffs: 0, cases: 0, ex: [] }]));
for (const f of files.split(',')) {
  const C = JSON.parse(readFileSync(f, 'utf8'));
  const w = generateWorld({ seed: C.spec.seed, difficulty: C.spec.d, mix: 'tail', size: C.spec.size });
  for (const j of C.journals) {
    const idx = indexJournal(w, j.rows, { canonicalArgs });
    for (const c of caseIds(w)) {
      const pool = C.pools[c] ?? null;
      const o = sig(gradeCase({ item: oracleItem, world: w, idx, c, pool }));
      for (const k of ks) {
        const r = res[k];
        if (items[k].error || r.diffs >= MAX) continue;
        r.cases++;
        let m;
        try { m = sig(gradeCase({ item: items[k], world: w, idx, c, pool })); } catch (e) { m = `THROW ${e?.message}`; }
        if (m !== o) { r.diffs++; if (pool === 'completed') r.completedDiffs++; r.ex.push(`${C.spec.seed}:${C.spec.d} ${j.name} ${c} [${pool}] orig ${o} | mut ${m}`); }
      }
    }
  }
}
for (const k of ks) console.log(JSON.stringify(items[k].error ? { k, error: items[k].error } : res[k]));
