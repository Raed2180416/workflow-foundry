// view.mjs <drawOrder...> : prints a corpus item as the auditor reads it. Hides ir.* (verdict tokens are detector inputs). Never reads the census.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const ROOT = path.resolve(HERE, '../../../../../..');
const draw = JSON.parse(fs.readFileSync(path.join(OUT, 'L1-audit-draw.json'), 'utf8'));
const items = new Map(fs.readFileSync(path.join(ROOT, 'research/corpus-20261006/items.jsonl'), 'utf8').trim().split('\n').map(l => { const o = JSON.parse(l); return [o.id, o]; }));
const W = Number(process.env.W ?? 150);
for (const a of process.argv.slice(2)) {
  const [ord, mode] = a.split(':');
  const d = draw.items.find(x => x.drawOrder === Number(ord)); const it = items.get(d.id);
  console.log(`\n===== #${d.drawOrder} ${it.id}  [${it.source.platform}]  nodes=${it.graph.nodes.length} edges=${it.graph.edges.length}`);
  console.log('TITLE:', it.title); console.log('DESC:', it.description.text);
  console.log('FEAT:', JSON.stringify({ async: it.features.async, humanSteps: it.features.humanSteps, effects: it.features.effects, connectors: (it.features.connectors ?? []).slice(0, 8), hasCode: it.features.hasCode, subworkflows: it.features.subworkflows, loops: it.features.loops, branching: it.features.branching }));
  if (mode === 'notes') console.log('IR-NOTES:', it.ir.notes.slice(0, 2500));
  const idx = new Map(it.graph.nodes.map((n, i) => [n.id, i]));
  const big = it.graph.nodes.length > Number(process.env.BIG ?? 60) && mode !== 'full';
  const ctl = new Set(['trigger', 'condition', 'loop', 'human', 'wait', 'subworkflow', 'merge', 'error-handler', 'model']);
  const sym = k => (k === 'data' ? '>' : k === 'control' ? '=' : k === 'error' ? '!' : '@');
  if (!big) {
    it.graph.nodes.forEach((n, i) => console.log(`${i}\t${n.category}\t${n.effects}\t${n.type.slice(0, 48)}\t${(n.summary ?? '').slice(0, W)}`));
    console.log('EDGES(> data, = control, ! error, @ loop):', it.graph.edges.map(e => `${idx.get(e.from)}${sym(e.kind)}${idx.get(e.to)}`).join(' '));
  } else {
    const h = {}; it.graph.nodes.forEach(n => { const k = `${n.category}|${n.effects}|${n.type.slice(0, 40)}`; (h[k] ??= []).push(n); });
    console.log('HISTOGRAM (count category|effects|type : first summary):');
    Object.entries(h).sort((a, b) => b[1].length - a[1].length).slice(0, Number(process.env.TOPK ?? 40)).forEach(([k, v]) => console.log(`${v.length}\t${k}\t${(v[0].summary ?? '').slice(0, 90)}`));
    const succ = new Map(); it.graph.edges.forEach(e => { (succ.get(e.from) ?? succ.set(e.from, []).get(e.from)).push(`${sym(e.kind)}${idx.get(e.to)}`); });
    console.log('CONTROL NODES (idx cat type summary -> successors):');
    it.graph.nodes.forEach((n, i) => { if (ctl.has(n.category) || it.graph.edges.some(e => e.from === n.id && e.kind === 'error')) console.log(`${i}\t${n.category}\t${n.type.slice(0, 36)}\t${(n.summary ?? '').slice(0, 90)}\t-> ${(succ.get(n.id) ?? []).slice(0, 8).join(',')}`); });
  }
}
