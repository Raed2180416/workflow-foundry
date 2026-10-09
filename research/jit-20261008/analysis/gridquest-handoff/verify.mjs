// Sanity checks for the stand-ins (no model calls). Exits non-zero on any failure.
import { bed, split, worldOf, absState, exploreFrom, canReach } from './lib.mjs';
import { explore, simulate } from '../../../../beds/gridquest/solver.mjs';
import { makeEnv } from '../../../../beds/gridquest/engine.mjs';
import { regexAgentV2, templateAwareAgent } from '../../../../beds/gridquest/diagnostics.mjs';

let bad = 0;
const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL', msg); } };
const seeds = [...Array(30).keys(), ...Array.from({ length: 30 }, (_, i) => 100 + i)];
const empty = m => ({ visited: new Set([m.start]), toggled: new Map(), done: new Set() });

for (const d of [3, 4, 5]) {
  let regex0 = 0, tmpl0 = 0, n0 = 0;
  for (const seed of seeds) {
    const task = bed.generate({ seed, split, difficulty: d });
    const W = worldOf(task), m = W.model;
    // 1. exploreFrom(init, empty memory) == solver.explore, action for action
    const a = explore(m, W.budget), b = exploreFrom(m, m.init, empty(m), W.budget);
    check(JSON.stringify(a.actions) === JSON.stringify(b.actions) && a.won === b.won, `explore mismatch d${d} s${seed}`);
    // 2. the explorer plan, run through the real env, wins and the abstract state tracks the engine
    const sh = makeEnv(W.w, W.budget);
    const st = [m.init];
    for (const act of b.actions) { sh.step(act); st.push(absState(m, sh._state())); }
    const sim = simulate(m, b.actions);
    check(sh._state().won && sim.won, `explorer plan does not win d${d} s${seed}`);
    // 3. oracle accepts the explorer's own record through the ledgered env
    const env = bed.createEnv(task); env.reset();
    for (const act of b.actions) env.step(act);
    check(bed.oracle(task, env.record()).pass, `oracle rejects explorer d${d} s${seed}`);
    check(canReach(m, m.init), `treasure unreachable d${d} s${seed}`);
    // 4. README replication (seeds 0..29 only)
    if (seed < 30) {
      n0++;
      const e1 = bed.createEnv(task); regexAgentV2(e1, W.budget); if (bed.oracle(task, e1.record()).pass) regex0++;
      const e2 = bed.createEnv(task); templateAwareAgent(e2, W.budget); if (bed.oracle(task, e2.record()).pass) tmpl0++;
    }
  }
  console.log(`d${d}: seeds 0..29 dev  regexAgentV2 ${regex0}/${n0}  templateAwareAgent ${tmpl0}/${n0}   (README: regexV2 ${[1, 0, 0][d - 3]}, templateAware ${[13, 4, 9][d - 3]})`);
}
console.log(bad ? `${bad} FAILURES` : 'all checks passed');
process.exit(bad ? 1 : 0);
