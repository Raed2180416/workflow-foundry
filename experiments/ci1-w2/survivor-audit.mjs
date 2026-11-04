#!/usr/bin/env node
// CI-1 wave 2, survivor audit step 1 (analysis, $0): split each item's surviving mutants (never killed by any of the 32 candidate
// worlds, from a bed2.mjs check report) into those whose mutated node the item's trigger cannot reach in the corpus graph (other
// triggers' subgraphs: equivalent by construction for this item) and those it can reach, which a human must audit one by one
// (value never reaches an effect, wording only, boundary not sampled, or a bed defect to fix before the freeze).
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/survivor-audit.mjs <check-report.json...>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadItem } from '../ci1/bed.mjs';

/** Names of the nodes reachable from `start` along main connections (n8n `connections`: source name -> {main: [[{node}]]}). */
export function reachable(workflow, start) {
  const seen = new Set([start]), todo = [start];
  while (todo.length) {
    const n = todo.pop();
    for (const outs of Object.values(workflow.connections?.[n] ?? {})) for (const port of outs ?? []) for (const c of port ?? []) if (c?.node && !seen.has(c.node)) { seen.add(c.node); todo.push(c.node); }
  }
  return seen;
}
/** The node a mutant id names: the longest node name that the text after "<kind>:" starts with. */
export function mutantNode(id, names) {
  const rest = id.slice(id.indexOf(':') + 1);
  return [...names].filter(n => rest.startsWith(n)).sort((a, b) => b.length - a.length)[0] ?? null;
}
export function split(workflow, trigger, survivors) {
  const names = new Set((workflow.nodes ?? []).map(n => n.name)), reach = reachable(workflow, trigger);
  const out = { unreachable: [], reachable: [], unknown: [] };
  for (const s of survivors) { const n = mutantNode(s, names); (n === null ? out.unknown : reach.has(n) ? out.reachable : out.unreachable).push(s); }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const f of process.argv.slice(2)) {
    const text = readFileSync(f, 'utf8'); const r = JSON.parse(text.slice(text.indexOf('{')));
    const item = await loadItem(r.id);
    const s = split(item.workflow, item.spec.trigger, r.mutation.survivors);
    console.log(JSON.stringify({ id: r.id, trigger: item.spec.trigger, survivors: r.mutation.survivors.length, unreachable: s.unreachable.length, unknown: s.unknown, toAudit: s.reachable }));
  }
}
