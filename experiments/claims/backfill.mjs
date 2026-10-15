// SPINE-0 + LAT-0 + OUT-0 back-fill (FIRST-CLASS-PROGRAMS §0.1, §6.4, §8.4, §10 rows 1-2). $0: no model, Jev or paid call.
// Reads existing run outputs through the adapters, validates every claim row, and writes to
// research/architecture-20261015/runs/spine-0/: claims.jsonl.gz (every row), coverage.json, census.json, latency.json,
// transfer.json, predictions.json and run.json. It prints the MDE table and the predictions (PREDICTION.md) before it reads
// any run output.
//   node experiments/claims/backfill.mjs [--no-live] [--out <dir>]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRows, fieldCoverage, policyModelIds, TRACKED, SUPPLIED } from './schema.mjs';
import { census } from './origin.mjs';
import { ROOT, sha256 } from './adapters/util.mjs';
import * as e8 from './adapters/e8.mjs';
import * as needRouter from './adapters/need-router.mjs';
import * as autobench from './adapters/automationbench.mjs';
import * as jq from './adapters/jq.mjs';
import * as jneed2 from './adapters/jneed2.mjs';
import { latencyReport } from '../timing/report.mjs';
import { transferTable, mcnemarMde } from '../outside/transfer.mjs';

export const ADAPTERS = Object.freeze({ e8, needRouter, autobench, jq, jneed2 });
const OUT = 'research/architecture-20261015/runs/spine-0';

/** Every back-filled row, in adapter order. */
export function allRows({ live = true } = {}) {
  return [...e8.rows(), ...needRouter.rows(), ...autobench.rows({ live }), ...jq.rows(), ...jneed2.rows()];
}

/** Read a claims.jsonl.gz written by this tool. */
export function loadClaims(file = path.join(ROOT, OUT, 'claims.jsonl.gz')) {
  return gunzipSync(readFileSync(file)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

/** The MDE lines printed before the run (PREDICTION.md table, recomputed). */
export function mdeLines() {
  const e8m = mcnemarMde(14), abm = mcnemarMde(6);
  return [
    `E8 s12 paired completed cases, n = 14: MDE ${e8m.discordant} discordant pairs all one way (exact two-sided McNemar p = ${e8m.p.toFixed(3)}), ${e8m.share.toFixed(2)} in pass rate`,
    `AutomationBench A1 vs A0 dev-first6, n = 6: MDE ${abm.discordant} of 6 one way (p = ${abm.p.toFixed(3)}), ${abm.share.toFixed(2)} in strict pass rate`,
    'time per verified success at K = 1: no run-to-run variance; the only interval is the success count\'s (Clopper-Pearson); ratios are descriptive',
    'p99 at n < 100 is the sample maximum (nearest rank): tails are reported, never compared',
    'origin census: a count, no MDE',
  ];
}

const three = (supported, refuted) => (refuted ? 'refuted' : supported ? 'supported' : 'inconclusive');

/** Evaluate PREDICTION.md P1-P6 on the back-filled rows. */
export function predictionChecks(rows, { cen, lat, cov }) {
  const out = {};
  // P1 origin census
  {
    const s = cen.shares;
    const sup = s.thirdPartyVerdictRows <= 0.10 && s.thirdPartyChargedUsd <= 0.15 && (s.realLogRows ?? 0) === 0;
    const ref = s.thirdPartyVerdictRows > 0.20 || s.thirdPartyChargedUsd > 0.20;
    out.P1 = { reading: three(sup, ref), thirdPartyVerdictRowShare: s.thirdPartyVerdictRows, thirdPartyChargedUsdShare: s.thirdPartyChargedUsd, realLogRows: cen.byGroup['real-log'].rows };
  }
  // P2 meter
  {
    const rep = rows.reduce((a, r) => a + (r.usd.reported ?? 0), 0), ch = rows.reduce((a, r) => a + (r.usd.charged ?? 0), 0);
    const m1 = rows.filter(r => ['m1', 'm1-d5', 'm1-r'].includes(r.run));
    const m1Diff = m1.reduce((a, r) => a + (r.usd.charged ?? 0) - (r.usd.reported ?? 0), 0);
    const ratio = rep > 0 ? ch / rep : null, share = ch - rep > 0 ? m1Diff / (ch - rep) : null;
    out.P2 = { reading: ratio === null ? 'inconclusive' : three(ratio >= 2.5 && share !== null && share >= 0.8, ratio < 1.5), reportedUsd: rep, chargedUsd: ch, ratio, m1ShareOfDifference: share,
      notInRepo: needRouter.NOT_IN_REPO, chargedWithNotInRepoUsd: ch + needRouter.NOT_IN_REPO.reduce((a, x) => a + (x.meterUsd ?? 0), 0) };
  }
  // P3 M1 tails at d3 (tag m1)
  {
    const arms = lat.arms.filter(a => a.bed === 'wbed' && a.run === 'm1');
    const ratios = Object.fromEntries(arms.map(a => [a.arm, a.wall.p50 ? a.wall.p99 / a.wall.p50 : null]));
    // A p99 that lands on a timed-out call is the runner's deadline, so the ratio is a lower bound (true p99 >= deadline):
    // it can still support (>= 10), but a truncated ratio below 5 cannot refute.
    const truncated = Object.fromEntries(arms.map(a => [a.arm, !!a.wall.atDeadline?.p99]));
    const v = Object.values(ratios);
    const refuted = arms.some(a => ratios[a.arm] !== null && ratios[a.arm] < 5 && !truncated[a.arm]);
    out.P3 = { reading: three(v.length === 2 && v.every(x => x >= 10), refuted), p99OverP50: ratios, p99AtDeadline: truncated,
      deadlineHits: Object.fromEntries(arms.map(a => [a.arm, a.wall.deadlineHits])),
      note: 'p99 at n = 96 is the maximum; where p99AtDeadline is true the p99 is the 300 s model-port deadline (timed-out calls), so p99/p50 is a lower bound capped by construction at deadline/p50' };
  }
  // P4 AutomationBench time to first effect as a share of wall time
  {
    const rs = rows.filter(r => r.task.bed === 'automationbench' && r.models.length && Number.isFinite(r.timing.timeToFirstEffectMs) && r.timing.wallMs > 0 && !r.refs.supersededBy);
    const shares = rs.map(r => r.timing.timeToFirstEffectMs / r.timing.wallMs).sort((a, b) => a - b);
    const med = shares.length ? shares[Math.ceil(0.5 * shares.length) - 1] : null;
    const noWrite = rows.filter(r => r.task.bed === 'automationbench' && r.models.length && r.provenance['timing.timeToFirstEffectMs']?.kind === 'n/a').length;
    out.P4 = { reading: med === null ? 'inconclusive' : three(med >= 0.40, med < 0.25), medianShare: med, rows: shares.length, rowsWithNoWrite: noWrite };
  }
  // P5 E8 s12 ranking by wall time per verified success. Point reading at agent-H's lower wall bound; the success-count
  // intervals (Clopper-Pearson, K = 1) decide whether the reading resolves (§0.3: a reading inside the intervals is inconclusive).
  {
    const m = lat.e8.matched, a = m.agent[0];
    const perfect = m.built.filter(b => b.successes === b.total && b.total > 0);
    const agentLo = a?.perSuccess?.pointLo ?? null;
    const agentCi = a?.wallMsBounds ? { lo: a.wallMsBounds.lo / (a.total * a.successCi.hi), hi: a.wallMsBounds.lo / (a.total * a.successCi.lo) } : null;
    const built = perfect.map(b => {
      const ps = b.perSuccessBuildChargedHere;
      return { run: b.run, perSuccessMs: ps?.pointLo ?? null, ciMs: ps ? { lo: ps.lo, hi: ps.hi } : null,
        ahead: ps ? ps.pointLo < agentLo : null, separated: ps && agentCi ? (ps.hi < agentCi.lo || ps.lo > agentCi.hi) : false };
    });
    const allAhead = built.length > 0 && built.every(x => x.ahead), anyBehind = built.some(x => x.ahead === false);
    const reading = anyBehind ? (built.filter(x => x.ahead === false).every(x => x.separated) ? 'refuted' : 'inconclusive (a built arm is behind on the point estimate, inside the intervals)')
      : allAhead ? (built.every(x => x.separated) ? 'supported' : 'inconclusive (every built arm is ahead on the point estimates; the success-count intervals overlap)') : 'inconclusive';
    out.P5 = { reading, agentPerSuccessMs: { lowerWall: agentLo, upperWall: a?.perSuccess?.pointHi ?? null, lowerWallCi: agentCi }, built,
      note: 'built arms carry build (and repair) wall only: their run wall on the world was not recorded (smoke runs on practice worlds take seconds)' };
  }
  // P6 coverage of the S6 fields the old outputs cannot supply
  {
    const all = cov.overall;
    const share = f => all[f].share;
    const applicable = f => { const c = all[f]; const app = c.rows - c.byKind['n/a']; return app ? c.supplied / app : null; };
    const ttfe = share('timing.timeToFirstEffectMs'), model = share('timing.components.modelMs'), waits = share('timing.components.waits');
    out.P6 = { reading: three(ttfe <= 0.40 && model <= 0.40 && waits === 0, ttfe >= 0.50 || model >= 0.50), timeToFirstEffectShare: ttfe, modelSplitShare: model, waitsShare: waits,
      applicableOnly: { timeToFirstEffect: applicable('timing.timeToFirstEffectMs'), modelSplit: applicable('timing.components.modelMs'), waits: applicable('timing.components.waits') },
      // Supplementary, not the preregistered reading: one-call rows supply both fields by construction (the answer is the
      // only effect and the call is all model time). Counting only rows where the first effect precedes done, and where a
      // non-model component was measured:
      nonDegenerate: {
        timeToFirstEffect: rows.filter(r => Number.isFinite(r.timing.timeToFirstEffectMs) && Number.isFinite(r.timing.timeToDoneMs) && r.timing.timeToDoneMs - r.timing.timeToFirstEffectMs > 0).length / rows.length,
        modelSplit: rows.filter(r => Number.isFinite(r.timing.components.modelMs) && r.timing.components.nonModelMs > 0).length / rows.length,
      } };
  }
  return out;
}

/** Coverage per adapter and overall, with the most common reasons a field is missing. */
export function coverage(rows) {
  const by = {};
  for (const r of rows) (by[r.source.adapter] ??= []).push(r);
  const reasons = {};
  for (const f of TRACKED) {
    const m = new Map();
    for (const r of rows) { const p = r.provenance[f]; if (p && !SUPPLIED.includes(p.kind)) { const k = `${r.source.adapter} | ${p.kind} | ${p.why}`; m.set(k, (m.get(k) ?? 0) + 1); } }
    reasons[f] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ n, reason: k }));
  }
  return { overall: fieldCoverage(rows), byAdapter: Object.fromEntries(Object.entries(by).map(([k, rs]) => [k, { rows: rs.length, fields: fieldCoverage(rs) }])), notSupplied: reasons };
}

async function main() {
  const argv = process.argv.slice(2);
  const live = !argv.includes('--no-live');
  const oi = argv.indexOf('--out');
  // resolve, not join: an absolute --out must not land inside the repository as ROOT/<absolute path>
  const out = path.resolve(ROOT, oi >= 0 ? argv[oi + 1] : OUT);
  // 1. MDE and prediction, before any run output is read
  console.log('SPINE-0 + LAT-0 + OUT-0 back-fill ($0). Minimum detectable effects:');
  for (const l of mdeLines()) console.log(`  - ${l}`);
  const pred = path.join(ROOT, OUT, 'PREDICTION.md');
  if (!existsSync(pred)) throw new Error('PREDICTION.md must exist before the back-fill runs');
  const ptxt = readFileSync(pred, 'utf8');
  console.log('\nPredictions (PREDICTION.md, sha256 ' + sha256(ptxt).slice(0, 16) + '):');
  console.log(ptxt.slice(ptxt.indexOf('## Predictions'), ptxt.indexOf('## Reading rule')).trim());
  // 2. back-fill and validate
  const t0 = Date.now();
  const rows = allRows({ live });
  const policy = JSON.parse(readFileSync(path.join(ROOT, 'policy/models.json'), 'utf8'));
  const bad = validateRows(rows, { modelIds: policyModelIds(policy) });
  if (bad.length) { console.error(JSON.stringify(bad.slice(0, 5), null, 1)); throw new Error(`${bad.length} invalid claim rows`); }
  const cov = coverage(rows), cen = census(rows), lat = latencyReport(rows), tr = transferTable(rows);
  const preds = predictionChecks(rows, { cen, lat, cov });
  // 3. write
  mkdirSync(out, { recursive: true });
  const jsonl = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(path.join(out, 'claims.jsonl.gz'), gzipSync(Buffer.from(jsonl), { level: 9 }));
  const w = (f, o) => writeFileSync(path.join(out, f), JSON.stringify(o, (k, v) => (v === Infinity ? 'Infinity' : v), 1) + '\n');
  w('coverage.json', cov); w('census.json', cen); w('latency.json', lat); w('transfer.json', tr); w('predictions.json', preds);
  let head = null;
  try { head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch {}
  const counts = {};
  for (const r of rows) { const k = `${r.source.adapter} | ${r.run} | ${r.arm} | ${r.rowKind}`; counts[k] = (counts[k] ?? 0) + 1; }
  w('run.json', { schema: 'spine-0/run@1', at: new Date().toISOString(), head, live, ms: Date.now() - t0, rows: rows.length, claimsJsonlSha256: sha256(jsonl),
    predictionSha256: sha256(ptxt), automationbench: autobench.discoverRuns(), counts, cost: { usd: 0, modelCalls: 0 } });
  // 4. print
  console.log(`\n${rows.length} claim rows, all valid; written to ${path.relative(ROOT, out)}/ (${(Date.now() - t0)} ms)`);
  for (const [k, v] of Object.entries(preds)) console.log(`  ${k}: ${v.reading}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
