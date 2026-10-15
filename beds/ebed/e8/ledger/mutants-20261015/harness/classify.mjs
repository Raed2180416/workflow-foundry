// Classify every mutant of <dir> under the one standard (MUTANTS.md §0): killed = (a golden fails it and a
// witness journal shows a verdict difference) or (the 7-world corpus differential shows one); otherwise equivalent.
//   node classify.mjs <workDir> [golden-matrix.jsonl] > classes.json
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const S = process.argv[2] ?? '.';   // the work directory: gm*.jsonl, wit*.jsonl, gd*.jsonl
const rd = f => (existsSync(`${S}/${f}`) ? readFileSync(`${S}/${f}`, 'utf8').trim().split('\n').filter(l => l.startsWith('{')).map(JSON.parse) : []);
const gm = Object.fromEntries(rd(process.argv[3] ?? 'golden-matrix.jsonl').map(r => [r.k, r]));
const wit = {}; for (const f of readdirSync(S).filter(x => /^wit.*\.jsonl$/.test(x))) for (const r of rd(f)) if (r.witness) wit[r.k] ??= r.witness;
const manual = { 123: { golden: 'amend-and-cancel-in-one-instant (S11)', manual: 'manual.mjs: amend and cancel at D, then a cancel-refused', orig: 'D:2/outside-allowed/', mut: 'PASS' },
  241: { golden: 'delivery-before-collection-report', manual: 'manual241.mjs: W2 order, no status set within 120 min of the delivery', orig: 'D:3/missed/fst:F:dispatched', mut: 'D:3/missed/fst:F:completed' },
  77: { golden: 'duplicate-placement-changes-no-items', manual: 'manual.mjs: a second placement with other items before the create', orig: 'OPEN', mut: 'D:2/outside-allowed/' } };
for (const [k, w] of Object.entries(manual)) wit[k] ??= w;
const gd = {}; for (const f of readdirSync(S).filter(x => /^gd.*\.jsonl$/.test(x))) for (const r of rd(f)) gd[r.k] = r;
const out = [];
for (let k = 0; k < Object.keys(gm).length; k++) {
  const g = gm[k], golden = g.err ? [] : Object.keys(g.fails), w = wit[k] ?? null, c = gd[k] ?? null;
  let v, ev;
  if (g.err) { v = 'killed'; ev = `the mutant does not load (${g.err})`; }
  else if (golden.length && w) { v = 'killed'; ev = `golden \`${golden[0]}\`; witness on \`${w.golden}\`${w.manual ? ' (hand-built)' : ''}: ${w.orig} vs ${w.mut}`; }
  else if (c && c.completedDiffs > 0) { v = 'killed'; ev = `corpus: ${c.ex[0]}`; }
  else if (c && c.diffs > 0) { v = 'killed'; ev = `corpus (censored case): ${c.ex[0]}`; }
  else if (golden.length) { v = 'CAUGHT-NOT-VISIBLE'; ev = `fails ${golden.join(', ')}; no witness; corpus ${c ? '0' : 'not run'}`; }
  else { v = c ? 'equivalent' : 'NOT-RUN'; ev = c ? `no golden fails it; corpus 0 in ${c.cases}` : 'corpus not run'; }
  out.push({ k, v, golden, ev });
}
const tally = {}; for (const o of out) tally[o.v] = (tally[o.v] ?? 0) + 1;
console.error(JSON.stringify(tally));
for (const o of out) if (!['killed', 'equivalent'].includes(o.v)) console.error(JSON.stringify(o));
console.log(JSON.stringify(out));
