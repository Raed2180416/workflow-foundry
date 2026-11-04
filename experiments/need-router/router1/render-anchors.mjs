// ROUTER-1: render need-router anchor-bed tasks (and two other one-call controls) the way a router sees a task before
// execution: the prompt (first 6,000 characters) plus size facts (experiments/need-router/jev-need.mjs stateOf). Dev seeds
// of the need-example purpose (601-609, DECISIONS-ADOPTED decision 8); no held-out seed is generated.
import { makeTasks } from '../../lib/beds.mjs';
import { stateOf } from '../jev-need.mjs';

// [family, seeds, why the bed's own README calls it a one-call (or no-workflow) task]
export const ANCHORS = Object.freeze([
  ['need-qa', [601, 602, 603], 'need-qa README: short exact-match question; one call is the hypothesis'],
  ['need-constraint', [601, 602, 603], 'need-constraint README: one-off generation checked by constraints'],
  ['need-stage', [601, 602, 603, 604], 'need-stage README: one stage of a W-bed rung on one item'],
  ['need-r0pad', [601, 602], 'need-r0pad README: wbed-r0 plus irrelevant documents (length without structure)'],
  ['need-r3mini', [601, 602], 'need-r3mini README: wbed-r3 restricted to 2-3 statements'],
  ['need-codefix-noverifier', [601, 602], 'need-codefix-noverifier README: a code fix; an agent without a verifier'],
  ['wbed-r0', [601, 602], 'wbed-r0: the W-bed needs-nothing control (M1: one Haiku call 12/12)'],
  ['ownerci', [601, 602], 'ownerci README: repair one module so CI passes (routine coding)']
]);

export async function renderAnchors() {
  const out = [];
  for (const [family, seeds, why] of ANCHORS) {
    const tasks = await makeTasks(family, { split: 'dev', seeds, difficulty: 3 });
    for (const t of tasks) out.push({ family, seed: Number(t.taskKey.split(':s')[1]), taskKey: t.taskKey, taskHash: t.taskHash, text: stateOf(t.task), why });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await renderAnchors();
  for (const r of rows) console.log(`\n### ${r.taskKey} (${r.text.length} chars)\n${r.text.slice(0, Number(process.argv[2] ?? 700))}`);
}
