// $0 oracle-validity audit for the gameqa-web bed: differential replay of a faulty build against the clean build.
// For random inputs (the monkey's token distribution, optionally after a setup prefix that reaches the deep parts of the
// level) each episode is replayed on both builds with the same seed. At the first tick where anything a tester can observe
// differs (state, HUD text, UI: visibility, text, rectangles, whether a button is on top), some injected-fault probe must
// already have fired: otherwise the build has a deviation the oracle cannot credit (an un-probed bug, which would turn a
// correct report into a "false report"). Conversely every probe must coincide with an observable difference in its own
// tick (a probe with no visible effect would credit an unobservable "bug").
// Only the first divergence of an episode is informative (after it the two games differ), so faults that rarely come
// first in B1 are audited one flag at a time (FLAGS=<one flag>), where every divergence belongs to that flag.
//   node experiments/gameqa-web/differential.mjs [episodes] [rngSeed] [flags: B1 | flag,flag | each] [prefix: 0|1]
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth } from '../../beds/gameqa-web/oracle.mjs';
import { monkeyToken, mulberry32 } from './arms.mjs';

const episodes = Number(process.argv[2] ?? 200), rngSeed = Number(process.argv[3] ?? 11), flagArg = process.argv[4] ?? 'B1', usePrefix = process.argv[5] === '1';
const truth = loadTruth();
// Setup prefixes (bed-author audit only, never given to an arm): the key, the lever, the gate, the far rooms, a full run.
const PREFIXES = [[], ['goto:4,5'], ['goto:3,5'], ['goto:1,8', 'use'], ['goto:4,5', 'goto:1,8', 'use', 'goto:10,5'],
  ['goto:4,5', 'goto:1,8', 'use', 'goto:10,5', 'down', 'goto:10,7'], ['goto:4,5', 'goto:1,8', 'use', 'goto:11,3', 'goto:10,5', 'down', 'goto:11,8', 'goto:10,7'],
  ['goto:4,5', 'goto:1,8', 'use', 'goto:10,5', 'down', 'goto:12,7']];
const view = o => JSON.stringify({ s: { ...o.state, frame: undefined }, h: o.hud, u: o.ui.map(u => ({ id: u.id, v: u.visible, t: u.text, r: u.rect, top: u.top })) });
function tokenIndexOf(run, prim) {
  let tok = -1, left = 0, n = -1;
  for (const st of run.steps) {
    if (st.macro) { tok++; left = st.expanded ?? 0; continue; }
    if (left > 0) left--; else tok++;
    if (++n === prim) return tok;
  }
  return tok;
}
async function audit(browser, flags, label) {
  const clean = await openSession(browser, { flags: [], oracle: true });
  const bug = await openSession(browser, { flags, oracle: true });
  const rng = mulberry32(rngSeed);
  const out = { label, flags, episodes, rngSeed, prefix: usePrefix, ticks: 0, diverged: 0, unprobedDivergence: [], silentProbes: [], firstProbeCounts: {}, probeCounts: {} };
  for (let e = 0; e < episodes; e++) {
    const seed = 1 + Math.floor(rng() * 1e6);
    const pre = usePrefix ? PREFIXES[Math.floor(rng() * PREFIXES.length)] : [];
    const tokens = [...pre, ...Array.from({ length: 120 - pre.length }, () => monkeyToken(rng))];
    const a = await clean.replayWithProbes(seed, tokens, { detail: 'each' });
    const b = await bug.replayWithProbes(seed, tokens, { detail: 'each' });
    if (a.fired.length) throw new Error(`a probe fired on the clean build: ${JSON.stringify(a.fired)}`);
    const pa = a.steps.filter(s => s.obs), pb = b.steps.filter(s => s.obs);
    out.ticks += pb.length;
    let d = -1;
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) if (view(pa[i].obs) !== view(pb[i].obs)) { d = i; break; }
    if (d < 0 && pa.length !== pb.length) d = Math.min(pa.length, pb.length);     // goto expansions differ: the maps differ
    const p = b.fired.length ? b.fired[0].step : -1;
    if (p >= 0) out.firstProbeCounts[b.fired[0].id] = (out.firstProbeCounts[b.fired[0].id] ?? 0) + 1;
    for (const f of b.fired) out.probeCounts[f.id] = (out.probeCounts[f.id] ?? 0) + 1;
    if (d >= 0) out.diverged++;
    if (d >= 0 && (p < 0 || p > d)) out.unprobedDivergence.push({ seed, tokens: tokens.slice(0, 1 + tokenIndexOf(b, d)), tick: d, firstProbe: b.fired[0] ?? null,
      clean: pa[d]?.obs.state, b1: pb[d]?.obs.state });
    // the probe's own tick must show a difference, unless an earlier probe already made the runs diverge
    for (const f of b.fired) if (f.step < d || d < 0) out.silentProbes.push({ seed, tokens, id: f.id, tick: f.step, firstDivergence: d });
  }
  await clean.close(); await bug.close();
  out.unprobed = out.unprobedDivergence.length; out.silent = out.silentProbes.length;
  out.unprobedDivergence = out.unprobedDivergence.slice(0, 20);
  out.silentProbes = out.silentProbes.slice(0, 20);
  return out;
}
const browser = await launchBrowser();
const sets = flagArg === 'each' ? truth.build.flags.map(f => [f, [f]]) : flagArg === 'B1' ? [['B1', truth.build.flags]] : [[flagArg, flagArg.split(',')]];
const results = [];
for (const [label, flags] of sets) {
  const r = await audit(browser, flags, label);
  console.error(`${label}: ${r.ticks} ticks, diverged ${r.diverged}/${episodes}, unprobed ${r.unprobed}, silent ${r.silent}, probes ${JSON.stringify(r.probeCounts)}`);
  results.push(r);
}
await browser.close();
console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 1));
