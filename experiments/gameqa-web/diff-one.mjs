// Development tool: replay one (seed, tokens) on the clean build and on B1 and print the first observable difference.
//   node experiments/gameqa-web/diff-one.mjs SEED 'tok tok ...'
//   node experiments/gameqa-web/diff-one.mjs --from differential-output.json     (every unprobed divergence in a differential run)
import { readFileSync } from 'node:fs';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth } from '../../beds/gameqa-web/oracle.mjs';

const args = process.argv.slice(2);
const cases = args[0] === '--from'
  ? JSON.parse(readFileSync(args[1], 'utf8')).unprobedDivergence.map(x => ({ seed: x.seed, tokens: x.tokens }))
  : [{ seed: Number(args[0]), tokens: args[1].split(/\s+/).filter(Boolean) }];
const browser = await launchBrowser();
const c = await openSession(browser, { flags: [], oracle: true }), b = await openSession(browser, { flags: loadTruth().build.flags, oracle: true });
const flat = (o, pre = '') => Object.entries(o ?? {}).flatMap(([k, v]) => v && typeof v === 'object' ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, JSON.stringify(v)]]);
for (const { seed, tokens } of cases) {
  console.log(`== seed ${seed}: ${tokens.join(' ')}`);
  const ra = await c.replayWithProbes(seed, tokens, { detail: 'each' }), rb = await b.replayWithProbes(seed, tokens, { detail: 'each' });
  const pa = ra.steps.filter(s => s.obs), pb = rb.steps.filter(s => s.obs);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const A = Object.fromEntries(flat(pa[i]?.obs)), B = Object.fromEntries(flat(pb[i]?.obs));
    const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter(k => A[k] !== B[k] && !k.endsWith('frame'));
    if (!keys.length) continue;
    console.log(`first difference at tick ${i} (B1 token ${pb[i]?.token}, clean token ${pa[i]?.token}); B1 probes: ${JSON.stringify(rb.fired)}`);
    for (const k of keys.slice(0, 30)) console.log(`  ${k}: clean=${A[k]} B1=${B[k]}`);
    for (let j = Math.max(0, i - 4); j <= i; j++) {
      const sa = pa[j]?.obs.state, sb = pb[j]?.obs.state;
      console.log(`  t${j} ${pb[j]?.token} | clean P(${sa?.player.x},${sa?.player.y}) ${sa?.mode} ev=${sa?.events} | B1 P(${sb?.player.x},${sb?.player.y}) ${sb?.mode} ev=${sb?.events}`);
    }
    break;
  }
}
await c.close(); await b.close(); await browser.close();
