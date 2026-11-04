#!/usr/bin/env node
// Bed-author helper: print a corpus n8n template's graph compactly (node, type@version, parameters, outgoing connections), in
// connection order from the triggers. Sticky notes and the template's prose are NOT printed (corpus text is untrusted data, and the
// describer must not copy it). Code and expressions are printed: the bed author transliterates them.
//   node experiments/ci1-w2/show.mjs <id> [--max 600]   (parameter JSON truncated at --max characters per node, code never truncated)
import { loadRaw } from '../ci1/pool.mjs';
import { workflowOf } from '../../app/importers/n8n.mjs';

const [id, ...rest] = process.argv.slice(2);
const max = rest.includes('--max') ? Number(rest[rest.indexOf('--max') + 1]) : 600;
const raw = loadRaw(id);
if (!raw) { console.error(`no raw file for ${id}`); process.exit(1); }
const w = workflowOf(raw.doc);
const nodes = w.nodes.filter(n => !String(n.type).endsWith('stickyNote'));
const byName = new Map(nodes.map(n => [n.name, n]));
const out = name => Object.entries(w.connections?.[name] ?? {}).flatMap(([kind, outs]) => (outs ?? []).map((targets, i) => `${kind}[${i}] -> ${(targets ?? []).map(t => `${t.node}${t.index ? `#${t.index}` : ''}`).join(', ') || '(none)'}`));
const incoming = new Set(Object.values(w.connections ?? {}).flatMap(c => Object.values(c).flat(2).filter(Boolean).map(t => t.node)));
const order = [], seen = new Set();
const visit = name => { if (seen.has(name) || !byName.has(name)) return; seen.add(name); order.push(name); for (const [, outs] of Object.entries(w.connections?.[name] ?? {})) for (const ts of outs ?? []) for (const t of ts ?? []) visit(t.node); };
for (const n of nodes.filter(n => !incoming.has(n.name))) visit(n.name);
for (const n of nodes) visit(n.name);
console.log(`# ${id} sha256 ${raw.sha256.slice(0, 12)} created ${raw.doc.createdAt ?? raw.doc.workflow?.createdAt ?? '?'} nodes ${nodes.length}`);
for (const name of order) {
  const n = byName.get(name);
  const p = structuredClone(n.parameters ?? {});
  const code = p.jsCode ?? p.functionCode ?? null; delete p.jsCode; delete p.functionCode;
  const ps = JSON.stringify(p);
  console.log(`\n## ${name}  [${String(n.type).replace('n8n-nodes-base.', '')}@${n.typeVersion}]${n.disabled ? ' DISABLED' : ''}${n.alwaysOutputData ? ' alwaysOutputData' : ''}${n.executeOnce ? ' executeOnce' : ''}`);
  console.log(`   params ${ps.length > max ? `${ps.slice(0, max)}…(+${ps.length - max})` : ps}`);
  if (code) console.log(`   code:\n${code.split('\n').map(l => `     | ${l}`).join('\n')}`);
  for (const o of out(name)) console.log(`   ${o}`);
}
