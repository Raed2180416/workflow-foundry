// Prints the tables used in README.md:
//   node beds/ownerci/measure.mjs [seeds=40] [oracleSeeds=6]
// Tokens are estimateTokens(prompt) + estimateTokens(inputs) (utf8 bytes / 4, see beds/lib).
import { generate, instance, oracle, referenceSolve, CATALOG, POOL_SIZES, KNOBS } from './index.mjs';
import { MODULE_IDS, MODULES } from './modules.mjs';
import { estimateTokens } from '../lib/canonical.mjs';

const seeds = Number(process.argv[2] || 40);
const oracleSeeds = Number(process.argv[3] || 6);
const q = (xs, f) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(f * xs.length))];

console.log('## Catalog: kept mutants per module and operator\n');
const ops = [...new Set(CATALOG.mutants.map(m => m.operator))].sort();
console.log(`| module | lines | visible tests | hidden tests | enumerated | kept | hidden-only | ${ops.join(' | ')} |`);
console.log(`|---|---|---|---|---|---|---|${ops.map(() => '---').join('|')}|`);
for (const id of MODULE_IDS) {
  const info = CATALOG.modules[id];
  const ms = CATALOG.mutants.filter(m => m.module === id);
  console.log(`| ${id} (\`${MODULES[id].modulePath}\`) | ${info.originalLines} | ${info.visibleTests.length} | ${info.hiddenTests.length} | ${info.stats.enumerated} | ${ms.length} | ${ms.filter(m => !m.visibleFailing.length).length} | ${ops.map(o => ms.filter(m => m.operator === o).length).join(' | ')} |`);
}
const all = CATALOG.mutants;
console.log(`| **total** | | | | ${Object.values(CATALOG.modules).reduce((s, i) => s + i.stats.enumerated, 0)} | ${all.length} | ${all.filter(m => !m.visibleFailing.length).length} | ${ops.map(o => all.filter(m => m.operator === o).length).join(' | ')} |`);
console.log('\nDiscarded:', JSON.stringify(Object.fromEntries(MODULE_IDS.map(id => [id, CATALOG.modules[id].stats.discarded]))));

console.log('\n## Pools (distinct instances per difficulty and module)\n');
console.log(JSON.stringify(POOL_SIZES));

console.log('\n## Sizes per difficulty\n');
console.log('| d | mutants (hidden-only) | input tokens min / median / max | module lines (median) | modules drawn |');
console.log('|---|---|---|---|---|');
for (const d of [1, 2, 3, 4, 5]) {
  const tok = [], lines = [], mods = {};
  for (let seed = 1; seed <= seeds; seed++) {
    const task = generate({ seed, split: 'dev', difficulty: d });
    const inst = instance(task);
    tok.push(estimateTokens(task.prompt) + estimateTokens(task.inputs));
    lines.push(inst.mutated.split('\n').length);
    mods[inst.module] = (mods[inst.module] ?? 0) + 1;
  }
  console.log(`| ${d} | ${KNOBS[d].mutants} (${KNOBS[d].hiddenOnly}) | ${q(tok, 0)} / ${q(tok, 0.5)} / ${q(tok, 1)} | ${q(lines, 0.5)} | ${Object.entries(mods).map(([k, v]) => `${k} ${v}`).join(', ')} |`);
}

console.log('\n## Oracle wall time per task (referenceSolve, ms)\n');
console.log('| d | min | median | max | sandbox |');
console.log('|---|---|---|---|---|');
for (const d of [1, 2, 3, 4, 5]) {
  const times = [];
  let sandbox = null;
  for (let seed = 1; seed <= oracleSeeds; seed++) {
    const task = generate({ seed, split: 'dev', difficulty: d });
    const t0 = performance.now();
    const out = oracle(task, referenceSolve(task));
    times.push(performance.now() - t0);
    sandbox = out.details.sandbox;
    if (!out.pass) console.log(`  !! reference failed ${task.id}`);
  }
  console.log(`| ${d} | ${Math.round(q(times, 0))} | ${Math.round(q(times, 0.5))} | ${Math.round(q(times, 1))} | ${sandbox} |`);
}
