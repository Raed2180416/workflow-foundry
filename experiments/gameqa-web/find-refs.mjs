// Development tool: search short reference repros for each injected bug on build B1 (oracle probes), and check each is
// 1-minimal. Writes nothing; prints JSON to paste into beds/gameqa-web/truth/bugs.json "references".
//   node experiments/gameqa-web/find-refs.mjs [maxSeed]
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth } from '../../beds/gameqa-web/oracle.mjs';

const truth = loadTruth(), maxSeed = Number(process.argv[2] ?? 40);
const browser = await launchBrowser();
const s = await openSession(browser, { flags: truth.build.flags, oracle: true });
const fires = async (seed, steps, flag) => (await s.replayWithProbes(seed, steps)).fired.some(f => f.id === flag);
async function oneMinimal(seed, steps, flag) {
  for (let i = 0; i < steps.length; i++) {
    const w = steps.filter((_, j) => j !== i);
    if (w.length && await fires(seed, w, flag)) return false;
  }
  return true;
}
const waits = k => Array(k).fill('wait');
const fixed = steps => () => [steps];
const CANDIDATES = {
  dash_tunnel: fixed(['right', 'dash-down']),
  hud_coin_dash: fixed(['dash-down']),
  timer_hud_freeze: fixed(['pause', 'click:btn-resume']),
  restart_pause_lock: fixed(['pause', 'click:btn-restart']),
  spike_wrap: fixed(['goto:3,3']),
  pause_move: fixed(['pause+right']),
  multi_move: fixed(['right+right']),
  toast_over_resume: () => [['goto:4,5', 'pause'], ['goto:3,5', 'right', 'pause']],
  key_lost_on_hit: () => {
    const out = [];
    for (let k = 0; k <= 8; k++) out.push(['goto:3,5', ...waits(k), 'right'], ['goto:5,5', ...waits(k), 'left']);
    return out.concat([['goto:4,5']]);
  },
  enemy_swap: () => {
    const out = [];
    for (const [x, y, dir] of [[3, 5, 'right'], [5, 5, 'left'], [2, 5, 'right'], [9, 3, 'down'], [9, 4, 'up'], [10, 4, 'left'], [10, 2, 'left'], [7, 5, 'left'], [1, 4, 'down']])
      for (let k = 0; k <= 6; k++) out.push([`goto:${x},${y}`, ...waits(k), dir]);
    return out;
  },
  score_int16: () => {
    const out = [];
    for (let k1 = 0; k1 <= 3; k1++) for (let k2 = 0; k2 <= 3; k2++)
      out.push(['goto:7,3', ...waits(k1), 'dash-right', 'goto:11,3', ...waits(k2), 'goto:10,5', 'dash-down', 'goto:11,8', 'goto:12,7'],
        ['goto:7,3', 'dash-right', ...waits(k1), 'goto:11,3', 'goto:10,5', ...waits(k2), 'dash-down', 'goto:11,8', 'goto:12,7']);
    for (let k1 = 0; k1 <= 3; k1++) for (let k2 = 0; k2 <= 3; k2++)
      out.push([...waits(k1), 'goto:1,7', 'goto:7,3', 'dash-right', 'goto:11,3', ...waits(k2), 'goto:10,5', 'dash-down', 'goto:11,8'],
        [...waits(k1), 'goto:1,7', 'goto:7,3', 'dash-right', ...waits(k2), 'goto:11,3', 'goto:10,5', 'dash-down', 'goto:11,8']);
    return out;
  },
  bonus_over_next: () => {
    const out = [];
    for (let k = 0; k <= 4; k++) out.push(['goto:7,3', ...waits(k), 'dash-right', 'goto:10,5', 'dash-down', 'goto:12,7'],
      ['goto:7,3', 'dash-right', ...waits(k), 'goto:10,5', 'dash-down', 'goto:12,7']);
    return out;
  },
};
const found = {};
for (const bug of truth.bugs.filter(b => !process.env.ONLY || process.env.ONLY.split(',').includes(b.flag))) {
  const t0 = Date.now();
  outer: for (let seed = 1; seed <= maxSeed; seed++) {
    for (const steps of CANDIDATES[bug.flag]()) {
      if (await fires(seed, steps, bug.flag) && await oneMinimal(seed, steps, bug.flag)) { found[bug.id] = { seed, steps }; break outer; }
    }
  }
  console.error(bug.id, bug.flag, found[bug.id] ? JSON.stringify(found[bug.id]) : 'NOT FOUND', `${Date.now() - t0}ms`);
}
console.log(JSON.stringify(found, null, 1));
await s.close(); await browser.close();
