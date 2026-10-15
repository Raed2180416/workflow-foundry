// Discrimination sanity check ($0, no model calls): the part-A walker arm (tools/walker.mjs: every incident record of
// SPEC R1-R3, R6 and R7.1, but no SLA engine, no deadline closures and no timers) run through the real host and graded
// by the E7 oracle, with the pools of the world's two reference runs. A sound oracle passes it only on completed cases
// where nothing of what it leaves out is due (messages that name no incident). A developer check, not a control and not
// a specificity solver: run it on dev seeds (1001-1199) only; the rehearsal block 1201-1249 is single-use (DESIGN §13).
//   node beds/ebed/e7/tools/walker-grade.mjs [--seed 1101] [--difficulty 3] [--size n]
import { generateWorld, referenceRuns, oracle, binding } from '../index.mjs';
import { walkerArm } from './walker.mjs';
import { createHost } from '../../host/host.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const seed = Number(arg('--seed', '1101'));
const d = Number(arg('--difficulty', '3'));
const size = arg('--size', null);
if (seed >= 1201 && seed <= 1249) throw new Error(`seed ${seed} is in the single-use rehearsal block 1201-1249: use a dev seed (1001-1199)`);
const w = generateWorld({ seed, difficulty: d, ...(size ? { size: Number(size) } : {}) });
const { pools } = await referenceRuns(w);
const host = createHost({ item: binding, world: w, arm: walkerArm() });
await host.run();
const v = oracle(w, host.journal.contentRows(), { pools });
const comp = v.cases.filter(c => c.pool === 'completed');
const passed = comp.filter(c => c.pass);
const byClass = {};
for (const c of passed) byClass[c.class] = (byClass[c.class] ?? 0) + 1;
const layers = {};
for (const c of comp.filter(x => !x.pass)) { const k = c.firstDivergence ? `L${c.firstDivergence.layer}:${c.firstDivergence.code}` : 'armCensored'; layers[k] = (layers[k] ?? 0) + 1; }
console.log(`seed ${seed} d${d}: walker passes ${passed.length}/${comp.length} completed cases (${v.cases.length} cases), critical ${v.critical.length}`);
console.log('  passed by class:', JSON.stringify(byClass), ' passed with no incident:', passed.filter(c => c.subject === null).length);
console.log('  first divergences of the failures:', JSON.stringify(Object.fromEntries(Object.entries(layers).sort((a, b) => b[1] - a[1]))));
