// pass2.mjs <drawOrder...>: adjudication sheet. For each detector-assigned L1 pattern in an item: how it was assigned (rule + anchor nodes, token, or plumbing witness) and whether the blind label had it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const OUT = path.resolve(HERE, '..'); const ROOT = path.resolve(HERE, '../../../../../..');
const labels = new Map(fs.readFileSync(path.join(OUT, 'L1-audit-labels.jsonl'), 'utf8').trim().split('\n').map(l => { const o = JSON.parse(l); return [o.drawOrder, o]; }));
const cen = new Map(fs.readFileSync(path.join(HERE, 'census-nodes.out.jsonl'), 'utf8').trim().split('\n').map(l => { const o = JSON.parse(l); return [o.id, o]; }));
const items = new Map(fs.readFileSync(path.join(ROOT, 'research/corpus-20261006/items.jsonl'), 'utf8').trim().split('\n').map(l => { const o = JSON.parse(l); return [o.id, o]; }));
const S = (n, w = 70) => `${n.category}/${n.type.slice(0, 26)}: ${(n.summary ?? '').slice(0, w)}`;
for (const a of process.argv.slice(2)) {
  const L = labels.get(Number(a)); const c = cen.get(L.id); const it = items.get(L.id);
  console.log(`\n===== #${L.drawOrder} ${L.id} [${c.plat}] mine=${L.patterns.join(',')}`);
  const byP = {}; for (const na of c.nodeAssign) (byP[na.p] ??= []).push(na);
  const ps = new Set([...Object.keys(c.needs), ...c.plumbing]);
  for (const p of ps) {
    if (p.startsWith('L0')) continue;
    const mine = L.patterns.includes(p) ? 'MINE' : '    ';
    const parts = [];
    if (byP[p]) { const rules = {}; byP[p].forEach(x => rules[x.rule] = (rules[x.rule] ?? 0) + 1); parts.push(`rules ${JSON.stringify(rules)}`); parts.push('anchors: ' + byP[p].slice(0, 3).map(x => `#${x.idx} ${S(it.graph.nodes[x.idx], 60)}`).join(' | ')); }
    const tk = c.tokens.filter(t => t.p === p).map(t => t.t); if (tk.length) parts.push(`token ${tk.join('+')}`);
    if (c.witness[p]) parts.push(`plumbing witness: ` + c.witness[p].slice(0, 3).map(i => `#${i} ${S(it.graph.nodes[i], 50)}`).join(' | '));
    console.log(`${mine} ${p} ${parts.join(' ; ')}`);
  }
}
