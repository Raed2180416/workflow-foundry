// Development tool: print a compact trace of one replay on a build (default B1, oracle probes on).
//   node experiments/gameqa-web/trace.mjs SEED TOKEN [TOKEN ...]      (FLAGS=none for the clean build)
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth } from '../../beds/gameqa-web/oracle.mjs';

const [seed, ...rest] = process.argv.slice(2);
const steps = [...rest, process.env.TOKENS ?? ''].flatMap(a => a.split(/\s+/)).filter(Boolean);
const flags = process.env.FLAGS === 'none' ? [] : loadTruth().build.flags;
const browser = await launchBrowser();
const s = await openSession(browser, { flags, oracle: true });
const r = await s.replayWithProbes(Number(seed), steps, { detail: 'each' });
let i = 0;
for (const st of r.steps) {
  if (st.macro) { console.log(`  [${st.macro} -> ${st.expanded} steps]`); continue; }
  const o = st.obs.state;
  const fired = r.fired.filter(f => f.step === i).map(f => f.id);
  const vis = st.obs.ui.filter(u => u.visible).map(u => `${u.id}${u.kind === 'button' ? (u.top ? '' : '(COVERED)') : ''}`).join(',');
  console.log(`${String(i).padStart(3)} ${st.token.padEnd(12)} (${o.player.x},${o.player.y}) ${o.mode} sc=${o.score} lv=${o.lives} k=${o.keys} c=${o.coins} t=${o.timeLeft} d=${o.dashCooldown} inv=${o.invulnerable} ev=${o.events.join('|')} en=${o.enemies.map(e => `${e.x},${e.y}`).join(' ')} hud=[${Object.values(st.obs.hud).join('|')}] ui=${vis}${fired.length ? ` FIRED ${fired}` : ''}`);
  i++;
}
await s.close(); await browser.close();
