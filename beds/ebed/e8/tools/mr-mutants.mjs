// The metamorphic relations (metamorphic.mjs, E-BED §9.3) against the oracle mutants of tools/mutate.mjs (E-BED §9.5:
// "goldens + controls + metamorphic checks kill >= 95%"). $0, no model calls; development evidence on dev seeds.
// The mutants are mutate.mjs's own: its `mutants(src)` is read from its text, as ledger/mutants-20261015/harness/gen.mjs
// does; mutate.mjs and its scoring are untouched. For every mutant and every relation (its `mutCases`):
//   oracle     the relation's journals (the ORIGINAL arms on W and T(W), built once) graded by the mutant; MR11: the
//              mutant's expectation before each first compensation against the saga planner
//   reference  the mutant drives the reference policy on W and T(W) (both timings); MR11: its ledger against the planner
// A relation kills a mutant when either flavour shows a violation (the original shows none: checked first). Each kill
// of a mutant the ledger calls equivalent (ledger/mutants-20261015/data/classes.json) gets a witness: a journal and case
// where the mutant's verdict differs from the original's (oracle kills: one side must differ, since the original's
// verdicts agree across the pair); for reference kills, the mutant reference's journals graded by both, else
// 'reference-only' (the policy differs, no graded verdict does).
//   node beds/ebed/e8/tools/mr-mutants.mjs [--only 3,17 | --from K --limit N] [--equivalents | --non-equivalents]
//          [--quick] [--arms ref-earliest,ref-latest,...] [--no-reference] [--json out.json]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { oracleItem } from '../index.mjs';
import { MRS, fixture, oracleCheck, referenceCheck, mr11OracleCheck, verdictSigs, caseLabel, specKey } from '../metamorphic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SRC = readFileSync(path.join(here, '..', 'transition.mjs'), 'utf8');
const msrc = readFileSync(path.join(here, 'mutate.mjs'), 'utf8');
const mutants = new Function(`${msrc.slice(msrc.indexOf('function mutants(src)'), msrc.indexOf('const worldsArg'))}; return mutants;`)();
const ALL = mutants(SRC);
const classes = JSON.parse(readFileSync(path.join(here, '..', 'ledger', 'mutants-20261015', 'data', 'classes.json'), 'utf8'));
const EQUIV = new Set(classes.filter(c => c.v === 'equivalent').map(c => c.k));
const ledgerVerdict = new Map(classes.map(c => [c.k, c.v]));
const only = arg('--only', null)?.split(',').map(Number) ?? null;
const from = Number(arg('--from', '0'));
const limit = Number(arg('--limit', String(ALL.length)));
let ks = (only ?? ALL.map((_, k) => k).slice(from, from + limit));
const withReference = !process.argv.includes('--no-reference');
const jsonOut = arg('--json', null);
const ARMS = arg('--arms', null)?.split(',') ?? null;        // a subset of each relation's arms (both flavours)
const EQUIV_ONLY = process.argv.includes('--equivalents'), SKIP_EQUIV = process.argv.includes('--non-equivalents');
const QUICK = process.argv.includes('--quick');                 // the first mutCase of each relation only
if (EQUIV_ONLY) ks = ks.filter(k => EQUIV.has(k));
if (SKIP_EQUIV) ks = ks.filter(k => !EQUIV.has(k));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// 1. Fixtures with the original oracle; the relations must hold on it (the suite's `known` variants are not used here).
const cache = new Map();
const fixtures = new Map();
for (const mr of MRS) {
  const list = [];
  for (const c of QUICK ? mr.mutCases.slice(0, 1) : mr.mutCases) {
    const fx = await fixture(mr, c, { cache, arms: ARMS ? mr.arms.filter(a => ARMS.includes(a)) : mr.arms });
    const o = mr.kind === 'mr11' ? mr11OracleCheck(fx) : oracleCheck(fx);
    const r = await referenceCheck(fx);
    if (o.length || r.length) throw new Error(`${caseLabel(mr, c)} fails on the unmutated oracle: ${JSON.stringify(o[0] ?? r[0]).slice(0, 400)}`);
    list.push(fx);
  }
  fixtures.set(mr.id, list);
}
log(`fixtures: ${[...fixtures.values()].flat().length} over ${cache.size} worlds; ${ALL.length} mutants (${EQUIV.size} grader-equivalent in the ledger); running ${ks.length}${withReference ? '' : ' (oracle flavour only)'}`);

const sig = (item, world, rows, tf) => { try { return verdictSigs(item, world, rows, tf); } catch (e) { return new Map([['*', `THROW ${String(e?.message ?? e).slice(0, 120)}`]]); } };

/** Oracle-kill witness: a side of the pair on which the mutant's verdict differs from the original's. */
function oracleWitness(fx, item, v) {
  for (const [side, world, rows] of [['source', fx.W, fx.src[v.arm]], ['follow-up', fx.Wt, fx.dst[v.arm]]]) {
    if (!rows) continue;
    const a = sig(oracleItem, world, rows), b = sig(item, world, rows);
    for (const c of [v.case, ...a.keys()].filter(Boolean)) if (a.get(c) !== b.get(c)) return { journal: `${v.arm} on ${side} (${caseLabel({ id: fx.mr }, fx)})`, case: c, original: a.get(c) ?? null, mutant: b.get(c) ?? null };
    if (b.has('*')) return { journal: `${v.arm} on ${side}`, case: '*', original: 'graded', mutant: b.get('*') };
  }
  return { journal: null, note: 'no verdict difference found on either side (the violation is in the relation-specific check)' };
}
/** Reference-kill witness: the mutant reference's journals graded by the original and by the mutant. */
function referenceWitness(fx, item, journals) {
  for (const [arm, j] of Object.entries(journals)) {
    for (const [side, world, rows] of [['source', fx.W, j.src], ['follow-up', fx.Wt, j.dst]]) {
      if (!rows) continue;
      const a = sig(oracleItem, world, rows), b = sig(item, world, rows);
      for (const c of a.keys()) if (a.get(c) !== b.get(c)) return { journal: `mutant ${arm} on ${side} (${caseLabel({ id: fx.mr }, fx)})`, case: c, original: a.get(c), mutant: b.get(c) ?? null };
    }
  }
  return { journal: null, note: 'reference-only: the mutant reference policy breaks the relation, and the original and mutant graders agree on every case of its journals' };
}

// 2. Mutants.
const tmp = mkdtempSync(path.join(os.tmpdir(), 'e8-mr-mutants-'));
const results = [];
const save = () => {
  if (!jsonOut) return;
  const summary = summarize();
  writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), mutants: ALL.length, ran: results.length, withReference, summary, results }, null, 1));
};
function summarize() {
  const per = {};
  for (const mr of MRS) {
    const killedO = results.filter(r => r.mr?.[mr.id]?.oracle).map(r => r.k), killedR = results.filter(r => r.mr?.[mr.id]?.reference).map(r => r.k);
    const union = [...new Set([...killedO, ...killedR])].sort((a, b) => a - b);
    per[mr.id] = { oracle: killedO.length, reference: killedR.length, killed: union.length, equivalentsKilled: union.filter(k => EQUIV.has(k)) };
  }
  const any = results.filter(r => r.mr && Object.values(r.mr).some(x => x.oracle || x.reference)).map(r => r.k);
  return { perRelation: per, killedByAny: any.length, importErrors: results.filter(r => r.importError).map(r => r.k),
    equivalentsRun: results.filter(r => EQUIV.has(r.k)).length, equivalentsKilled: any.filter(k => EQUIV.has(k)),
    ledgerKilledNotKilledByAnyMR: results.filter(r => r.mr && ledgerVerdict.get(r.k) === 'killed' && !any.includes(r.k)).length };
}
try {
  for (const k of ks) {
    const m = ALL[k];
    const lines = SRC.split('\n'); lines[m.line] = m.to;
    const file = path.join(tmp, `m${k}.mjs`);
    writeFileSync(file, lines.join('\n'));
    const rec = { k, line: m.line + 1, ledger: ledgerVerdict.get(k) ?? null, equivalent: EQUIV.has(k), from: m.from.trim().slice(0, 200), to: m.to.trim().slice(0, 200) };
    let mod;
    try { mod = await import(pathToFileURL(file).href); } catch (e) { rec.importError = String(e?.message ?? e).slice(0, 120); results.push(rec); log(`k${k} import error`); continue; }
    const item = { ...oracleItem, referenceTransition: mod.referenceTransition, recordsOf: mod.recordsOf };
    const sigCache = new Map(), srcCache = new Map();
    rec.mr = {};
    rec.ms = { oracle: 0, reference: 0 };
    for (const mr of MRS) {
      let t = Date.now();
      const r = { oracle: null, reference: null };
      for (const fx of fixtures.get(mr.id)) {
        const v = (mr.kind === 'mr11' ? mr11OracleCheck(fx, item) : oracleCheck(fx, item, { sigCache, first: true }))[0];
        if (v) { r.oracle = { at: caseLabel(mr, fx), ...v }; if (rec.equivalent) r.oracle.witness = oracleWitness(fx, item, v); break; }
      }
      rec.ms.oracle += Date.now() - t; t = Date.now();
      // The reference flavour (the expensive one: host runs of the mutant reference): every case of an equivalent; for
      // the others the first case, earliest timing, and only where the oracle flavour did not already kill.
      if (withReference) {
        const list = r.oracle && !rec.equivalent ? [] : rec.equivalent ? fixtures.get(mr.id) : fixtures.get(mr.id).slice(0, 1);
        for (const fx of list) {
          const journals = {};
          const v = (await referenceCheck(fx, item, { srcCache, journals, timings: rec.equivalent ? ['ref-earliest', 'ref-latest'] : ['ref-earliest'] }))[0];
          if (v) { r.reference = { at: caseLabel(mr, fx), ...v }; if (rec.equivalent) r.reference.witness = referenceWitness(fx, item, journals); break; }
        }
      }
      rec.ms.reference += Date.now() - t;
      for (const x of [r.oracle, r.reference]) if (x) for (const f of ['source', 'followUp']) if (typeof x[f] === 'string') x[f] = x[f].slice(0, 600);
      rec.mr[mr.id] = r;
    }
    const by = Object.entries(rec.mr).filter(([, x]) => x.oracle || x.reference).map(([id, x]) => `${id}${x.oracle ? 'o' : ''}${x.reference ? 'r' : ''}`);
    results.push(rec);
    log(`k${k} [${rec.ledger}] ${by.length ? by.join(' ') : '-'} (oracle ${(rec.ms.oracle / 1000).toFixed(1)} s, reference ${(rec.ms.reference / 1000).toFixed(1)} s)`);
    if (results.length % 10 === 0) save();
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
save();
const s = summarize();
console.log('\nper relation (mutants killed: oracle flavour / reference flavour / either):');
for (const [id, x] of Object.entries(s.perRelation)) console.log(`  ${id.padEnd(5)} ${String(x.oracle).padStart(3)} / ${String(x.reference).padStart(3)} / ${String(x.killed).padStart(3)}${x.equivalentsKilled.length ? `   equivalents killed: ${x.equivalentsKilled.join(', ')}` : ''}`);
console.log(`any relation: ${s.killedByAny} of ${results.length} run (${s.importErrors.length} do not load: ${s.importErrors.join(', ')}); equivalents run ${s.equivalentsRun}, killed by some relation: ${s.equivalentsKilled.join(', ') || 'none'}`);
for (const r of results.filter(x => x.equivalent && x.mr && Object.values(x.mr).some(y => y.oracle || y.reference))) {
  console.log(`\nEQUIVALENT k${r.k} line ${r.line}\n  - ${r.from}\n  + ${r.to}`);
  for (const [id, x] of Object.entries(r.mr)) for (const fl of ['oracle', 'reference']) if (x[fl]) console.log(`  ${id} ${fl}: ${x[fl].at} ${x[fl].arm ?? ''} ${x[fl].what} ${x[fl].case ?? ''}\n    witness ${JSON.stringify(x[fl].witness).slice(0, 900)}`);
}
console.log(`\nwall ${((Date.now() - t0) / 1000).toFixed(0)} s`);
