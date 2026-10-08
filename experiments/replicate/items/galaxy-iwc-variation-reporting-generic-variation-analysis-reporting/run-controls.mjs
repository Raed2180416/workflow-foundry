#!/usr/bin/env node
// Prints the control matrix for one (seed, split, difficulty): `node run-controls.mjs [seed] [split] [difficulty]`.
import * as item from './index.mjs';
const [seed = 1, split = 'test', difficulty = 3] = process.argv.slice(2);
const task = item.generate({ seed: Number(seed), split, difficulty: Number(difficulty), taskType: 'T2' });
console.log(`rule: ${item.PASS_RULE}\nhealth: ${JSON.stringify(item.evaluatorHealth())}\n`);
console.log('verdict  shipped  derived strict/exact/diff6   control');
for (const [expect, list] of [['must pass', item.originalControls], ['must fail', item.badControls]]) {
  for (const c of list) {
    const v = item.diagnose(task, c.make(task)), d = v.details;
    const ok = (expect === 'must pass') === v.pass;
    console.log(`${v.pass ? 'PASS' : 'fail'}${ok ? ' ' : '!'}   ${d.shipped?.strict ? 'ok  ' : 'FAIL'}    ${String(d.derived?.strict).padStart(2)}/${String(d.derived?.exact).padStart(2)}/${String(d.derived?.diff6).padStart(2)} of ${d.derived?.total}      ${c.name}`);
  }
}
