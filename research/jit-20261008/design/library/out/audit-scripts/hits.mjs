// hits.mjs draw | show <pattern> [from] [to]: fixed-seed draw of detector hits per pattern (seed 20261010) and review sheets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const OUT = path.resolve(HERE, '..'); const ROOT = path.resolve(HERE, '../../../../../..');
const rows = fs.readFileSync(path.join(HERE, 'census-nodes.out.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const SEED = 20261010;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ORDER = ['P37', 'P38', 'P08', 'P01', 'P02', 'P17', 'P18', 'P16', 'P49', 'P48', 'P30', 'P31', 'P22'];   // 5 most frequent (P01 P02 P37 P38 P08), 5 rarest non-zero (P48 P30 P49 P31 P22), support-only extras (P16 P17 P18)
const K = { P37: 10, P38: 10, P08: 10, P01: 20, P02: 20, P17: 20, P18: 20, P16: 20, P49: 20, P48: 10, P30: 10, P31: 10, P22: 10 };
const hitsOf = p => rows.filter(r => (r.needs[p] !== undefined && !p.startsWith('L0')) || r.plumbing.includes(p)).map(r => r.id).sort();
const draw = {};
const rnd = mulberry32(SEED);
for (const p of ORDER) { const pool = hitsOf(p); const a = [...pool]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } draw[p] = { population: pool.length, ids: a.slice(0, K[p]) }; }
if (process.argv[2] === 'draw') { fs.writeFileSync(path.join(OUT, 'L1-detector-hits-draw.json'), JSON.stringify({ seed: SEED, prng: 'mulberry32', method: 'hits per pattern = items whose detector set (control-node needs, token needs, or support-only plumbing) contains the pattern, ids sorted, Fisher-Yates with one shared PRNG stream visiting patterns in the listed order, first k taken (k = min(population, requested))', draw }, null, 1)); console.log(Object.entries(draw).map(([p, d]) => `${p}: ${d.ids.length}/${d.population}`).join('  ')); process.exit(0); }
const items = new Map(fs.readFileSync(path.join(ROOT, 'research/corpus-20261006/items.jsonl'), 'utf8').trim().split('\n').map(l => { const o = JSON.parse(l); return [o.id, o]; }));
const byId = new Map(rows.map(r => [r.id, r]));
const S = (n, w = 70) => `${n.category}/${n.type.slice(0, 22)}: ${(n.summary ?? '').slice(0, w)}`;
const [_, __, mode, p, a = 0, b = 99] = process.argv;
draw[p].ids.slice(Number(a), Number(b)).forEach((id, k) => {
  const c = byId.get(id), it = items.get(id);
  console.log(`\n--- ${p} hit ${Number(a) + k + 1}: ${id} [${c.plat}] n=${it.graph.nodes.length} "${it.title.slice(0, 80)}"`);
  const na = c.nodeAssign.filter(x => x.p === p);
  if (na.length) { const rules = {}; na.forEach(x => rules[x.rule] = (rules[x.rule] ?? 0) + 1); console.log(`  rules ${JSON.stringify(rules)}`); na.slice(0, 4).forEach(x => console.log(`  anchor #${x.idx} ${S(it.graph.nodes[x.idx], 90)}`)); }
  const tk = c.tokens.filter(t => t.p === p).map(t => t.t); if (tk.length) console.log(`  token ${tk.join('+')}`);
  if (c.witness[p]) { const idxs = c.witness[p].slice(0, 4); const succ = new Map(); it.graph.edges.forEach(e => { const f = it.graph.nodes.findIndex(n => n.id === e.from), t = it.graph.nodes.findIndex(n => n.id === e.to); (succ.get(f) ?? succ.set(f, []).get(f)).push(t); }); idxs.forEach(i => console.log(`  witness #${i} ${S(it.graph.nodes[i], 80)} -> ${(succ.get(i) ?? []).slice(0, 5).join(',')}`)); }
  if (p === 'P16' || p === 'P30' || p === 'P49' || p === 'P48') console.log(`  desc: ${it.description.text.slice(0, 200)}`);
});
