#!/usr/bin/env node
// Survivor audit helper (analysis, $0): print the code around each code-const / code-eq mutant site of a wave-2 item, the Set node
// values a set-const mutant changes, and the node a skip / cond mutant targets, so a reader can judge each surviving mutant against
// the item's description (equivalent, wording only, value never reaches an effect, boundary not sampled, or a bed defect).
//   CI1_BED=/var/tmp/foundry-work/ci1-20261021/bed-w2 node experiments/ci1-w2/show-mutant.mjs <id> <mutant id...>
import { fileURLToPath } from 'node:url';
import { loadItem } from '../ci1/bed.mjs';
import { mutantNode } from './survivor-audit.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, ...ids] = process.argv.slice(2);
  const item = await loadItem(id);
  const byName = new Map(item.workflow.nodes.map(n => [n.name, n]));
  for (const m of ids) {
    const name = mutantNode(m, new Set(byName.keys())); const n = byName.get(name);
    const at = /@(\d+)/.exec(m);
    if (at && n) { const code = n.parameters.jsCode ?? n.parameters.functionCode ?? ''; const i = Number(at[1]); console.log(`## ${m}\n…${code.slice(Math.max(0, i - 160), i).replace(/\n/g, '⏎')}⟦${code.slice(i, i + 40).replace(/\n/g, '⏎')}⟧${code.slice(i + 40, i + 160).replace(/\n/g, '⏎')}…`); }
    else console.log(`## ${m}\n${JSON.stringify(n?.parameters ?? null).slice(0, 700)}`);
  }
}
