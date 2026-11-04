// $0 audit of the bed: random exploration with the oracle-informed reference checks (reference-checks.json) on the clean
// build (expect zero violations: the clean build follows its spec) and on build B1 (which reference checks the faults trip).
//   node experiments/gameqa-web/audit-clean.mjs [ticks] [seed]
import { readFileSync } from 'node:fs';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth } from '../../beds/gameqa-web/oracle.mjs';
import { compileChecks, scanRun } from './qa-lib.mjs';
import { monkeyToken, mulberry32 } from './arms.mjs';

const ticksBudget = Number(process.argv[2] ?? 20000), rngSeed = Number(process.argv[3] ?? 1);
const ref = JSON.parse(readFileSync(new URL('./reference-checks.json', import.meta.url), 'utf8'));
const { checks, rejected } = compileChecks(ref.checks);
if (rejected.length) { console.error('reference checks do not parse:', rejected); process.exit(1); }
const browser = await launchBrowser();
const out = {};
for (const [name, flags] of [['clean', []], ['B1', loadTruth().build.flags]]) {
  const s = await openSession(browser, { flags });
  const rng = mulberry32(rngSeed);
  const viol = new Map(), errors = new Map();
  let ticks = 0, episodes = 0;
  while (ticks < ticksBudget) {
    const seed = 1 + Math.floor(rng() * 1e6), tokens = Array.from({ length: 200 }, () => monkeyToken(rng));
    const start = await s.reset(seed);
    const run = await s.run(tokens, { detail: 'each' });
    ticks += run.primitives; episodes++;
    const r = scanRun(run, start, checks);
    const prims = run.steps.filter(x => x.obs);
    for (const v of r.violations) if (!viol.has(v.checkId)) viol.set(v.checkId, { seed, steps: tokens.slice(0, v.tokenIndex + 1), at: v.step, n: 0,
      ...(name === 'clean' ? { prev: v.step > 0 ? prims[v.step - 1].obs.state : start.state, cur: prims[v.step].obs.state, token: prims[v.step].token } : {}) });
    for (const v of r.violations) viol.get(v.checkId).n++;
    for (const e of r.errors) errors.set(e.id, e.error);
  }
  await s.close();
  out[name] = { ticks, episodes, violations: Object.fromEntries(viol), errors: Object.fromEntries(errors) };
  console.error(name, ticks, 'ticks', [...viol.keys()].join(', ') || 'no violations', errors.size ? `errors ${[...errors.keys()]}` : '');
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
