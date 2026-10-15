// Oracle mutation testing for E8 (E-BED §9.5, K1: mutation score >= 0.95). $0. Mutants of the reference transition
// (transition.mjs, which imports nothing) are killed by either of two independent checks:
//   1. the goldens (golden.mjs): a golden that passes the original transition fails the mutant;
//   2. the corpus: both reference runs, every control and every specificity solver under specificity/ (model-written,
//      so run out of process in the sandbox arm), on dev worlds. A mutant is killed when any completed-pool case's
//      verdict, oracle-error status or first divergence (layer, code, lid) differs from the original oracle's.
// Survivors are printed with their diff for review: each is either equivalent (recorded in ledger/MUTANTS.md) or needs
// a new golden / corpus world.
//   node beds/ebed/e8/tools/mutate.mjs [--worlds 1009:3:60,...] [--limit N] [--no-specificity] [--json out.json]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateWorld, referenceRuns, oracleItem, binding } from '../index.mjs';
import { CONTROLS, runControl } from '../controls.mjs';
import { gradeStream } from '../../oracle/grade.mjs';
import { createHost } from '../../host/host.mjs';
import { sandboxArm } from '../../host/sandbox-arm.mjs';
import { runGoldens } from '../golden.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SRC = readFileSync(path.join(here, '..', 'transition.mjs'), 'utf8');

/** Mutation operators over code lines (comments skipped). Each returns [{ line, from, to }]. */
function mutants(src) {
  const lines = src.split('\n');
  const out = [];
  const ops = [
    [/ <= /g, ' < '], [/ < /g, ' <= '], [/ >= /g, ' > '], [/ > /g, ' >= '],
    [/ === /g, ' !== '], [/ !== /g, ' === '], [/ && /g, ' || '], [/ \|\| /g, ' && '],
    [/120 \* MIN/g, '60 * MIN'], [/60 \* MIN/g, '120 * MIN'], [/ \+ SEC/g, ''], [/ - MIN\)/g, ')'],
    [/Math\.max\(/g, 'Math.min('], [/Math\.min\(/g, 'Math.max('],
    [/\.find\(/g, '.findLast('], [/\[0\]/g, '.at(-1)'],
    [/\{ after: \[\.\.\.after\], money: true \}/g, '{ money: true }'], [/\{ after: \[\.\.\.after\] \}/g, '{}'],
    [/'collected', 'inTransit', 'delivered'/g, "'collected'"], [/!s\.failedMsg/g, 'true'], [/!prePatched/g, 'true'],
    [/forwardOk\(([a-zA-Z.]+)\)/g, 'true'], [/before\(row, cut(?:, cutEv)?\)/g, 'row.at < cut'],
  ];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('import') || t.startsWith('export function canonicalArgs')) return;
    for (const [re, rep] of ops) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(ln)) !== null) {
        const to = ln.slice(0, m.index) + m[0].replace(new RegExp(re.source), rep) + ln.slice(m.index + m[0].length);
        if (to !== ln) out.push({ line: i, from: ln, to });
      }
    }
    // statement deletion: a required effect or status never named
    if (/^(lid|fst|ost|ntf)\(/.test(t) || /^tasksReq\.push\(/.test(t) || /^permitted\.push\(/.test(t)) out.push({ line: i, from: ln, to: ln.replace(t, 'void 0;') });
  });
  return out;
}

const worldsArg = arg('--worlds', '1009:3:60,1010:5:60,1011:4:60,1012:2:60').split(',').map(s => { const [seed, d, size] = s.split(':').map(Number); return { seed, d, size }; });
const corpus = [];
const specDir = path.join(here, '..', 'specificity');
let solvers = [];
try { solvers = process.argv.includes('--no-specificity') ? [] : readdirSync(specDir).filter(f => f.endsWith('.mjs')); } catch { /* none yet */ }
for (const { seed, d, size } of worldsArg) {
  const w = generateWorld({ seed, difficulty: d, mix: 'tail', size });
  const r = await referenceRuns(w);
  corpus.push({ w, pools: r.pools, name: `ref-earliest@${seed}`, rows: r.runs.earliest.rows });
  corpus.push({ w, pools: r.pools, name: `ref-latest@${seed}`, rows: r.runs.latest.rows });
  for (const c of CONTROLS) corpus.push({ w, pools: r.pools, name: `${c.id}@${seed}`, rows: await runControl(c.id, w) });
  for (const f of solvers) {
    const arm = sandboxArm({ id: f, solverSource: readFileSync(path.join(specDir, f), 'utf8'), timeoutMs: 20_000 });
    const host = createHost({ item: binding, world: w, arm, callTimeoutMs: 25_000 });
    try { await host.run(); } finally { arm.close(); }
    corpus.push({ w, pools: r.pools, name: `${f}@${seed}`, rows: host.journal.contentRows() });
  }
}
const fd = c => (c.firstDivergence ? `${c.firstDivergence.layer}/${c.firstDivergence.code}/${c.firstDivergence.lid ?? c.firstDivergence.field ?? ''}` : '');
const signature = item => corpus.map(j => {
  const v = gradeStream({ item, world: j.w, rows: j.rows, pools: j.pools });
  return v.cases.filter(c => c.pool === 'completed').map(c => `${c.case}:${c.pass ? 1 : 0}${c.oracleError ? 'E' : ''}:${fd(c)}`).join(',');
});
const base = signature(oracleItem);
const baseGold = runGoldens(oracleItem.referenceTransition, oracleItem.recordsOf);
if (baseGold.some(g => !g.pass)) throw new Error(`goldens fail the original transition: ${baseGold.filter(g => !g.pass).map(g => g.name)}`);
console.log(`corpus: ${corpus.length} journals over ${worldsArg.length} worlds (${solvers.length} specificity solvers)`);
const all = mutants(SRC);
const limit = Number(arg('--limit', String(all.length)));
const tmp = path.join(here, '..', '.mutants');
mkdirSync(tmp, { recursive: true });
let killed = 0;
const killedBy = {};
const survivors = [];
for (const [k, m] of all.slice(0, limit).entries()) {
  const lines = SRC.split('\n');
  lines[m.line] = m.to;
  const file = path.join(tmp, `m${k}.mjs`);
  writeFileSync(file, lines.join('\n'));
  let dead = false, by = null;
  try {
    const mod = await import(pathToFileURL(file).href);
    const gold = runGoldens(mod.referenceTransition, mod.recordsOf).filter(g => !g.pass);
    if (gold.length) { dead = true; by = `golden:${gold[0].name}`; }
    else {
      const sig = signature({ ...oracleItem, referenceTransition: mod.referenceTransition, recordsOf: mod.recordsOf });
      const i = sig.findIndex((x, j) => x !== base[j]);
      if (i >= 0) { dead = true; by = `corpus:${corpus[i].name}`; }
    }
  } catch (e) { dead = true; by = `error:${String(e?.message ?? e).slice(0, 60)}`; }
  if (dead) { killed += 1; killedBy[by.split(':')[0]] = (killedBy[by.split(':')[0]] ?? 0) + 1; } else survivors.push({ k, line: m.line + 1, from: m.from.trim(), to: m.to.trim() });
  if ((k + 1) % 10 === 0) console.log(`  ${k + 1}/${Math.min(limit, all.length)} mutants, killed ${killed}`);
}
rmSync(tmp, { recursive: true, force: true });
const n = Math.min(limit, all.length);
console.log(`mutants: ${n}, killed ${killed} (${JSON.stringify(killedBy)}), survived ${survivors.length}, score ${(killed / n).toFixed(3)}`);
for (const s of survivors) console.log(`  SURVIVOR #${s.k} line ${s.line}\n    - ${s.from.slice(0, 200)}\n    + ${s.to.slice(0, 200)}`);
const j = arg('--json', null);
if (j) writeFileSync(j, JSON.stringify({ n, killed, killedBy, survivors }, null, 1));
