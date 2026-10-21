// FH-1 ($0): precompute the N-version ensemble signatures on the practice worlds (cached for every heal attempt), and measure each
// verifier's precision and recall on the practice worlds against the oracle (analysis only; no arm ever sees the oracle):
//   contracts  a completed order is flagged when it fails any capability contract;
//   N-version  an order is flagged when the build disagrees with the strict majority of the 9 recorded builds;
//   none       nothing is flagged.
//   node experiments/fh/ensemble.mjs [--out research/heal-20261021/fh1/verifiers.json]
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT, PRACTICE, worldKey } from './grade.mjs';
import { ensembleSignatures, nversionDisagreements, ENSEMBLE } from './heal.mjs';

const BASE = path.join(ROOT, 'research/heal-20261021/fh1/baseline');
const r3 = x => Math.round(x * 1000) / 1000;

export async function verifierTable() {
  const sigs = await ensembleSignatures();
  const ens = Object.fromEntries(ENSEMBLE.map(b => [b, sigs[b]]));
  const out = {};
  for (const b of ENSEMBLE) {
    const f = path.join(BASE, `${b}.json`);
    if (!existsSync(f)) continue;
    const base = JSON.parse(readFileSync(f, 'utf8'));
    const cases = base.practice.worlds.flatMap(w => w.cases.map(c => ({ ...c, world: w.world })));
    const nv = new Set(nversionDisagreements(ens, b).map(x => `${x.world}/${x.order}`));
    const judged = cases.filter(c => c.oracle !== undefined && c.contracts !== undefined);
    const truthFail = judged.filter(c => !c.oracle);
    const row = { orders: judged.length, oracleFailing: truthFail.length, byClass: {} };
    for (const [name, flag] of [['contracts', c => c.contracts === false], ['nversion', c => nv.has(`${c.world}/${c.order}`)]]) {
      const flagged = judged.filter(flag);
      const tp = flagged.filter(c => !c.oracle).length;
      row[name] = { flagged: flagged.length, truePositives: tp, precision: flagged.length ? r3(tp / flagged.length) : null, recall: truthFail.length ? r3(tp / truthFail.length) : null };
    }
    for (const c of truthFail) {
      const k = (row.byClass[c.class] ??= { failing: 0, contracts: 0, nversion: 0 });
      k.failing += 1; if (c.contracts === false) k.contracts += 1; if (nv.has(`${c.world}/${c.order}`)) k.nversion += 1;
    }
    out[b] = row;
  }
  const pool = name => { const xs = Object.values(out); const fl = xs.reduce((s, x) => s + x[name].flagged, 0), tp = xs.reduce((s, x) => s + x[name].truePositives, 0), fail = xs.reduce((s, x) => s + x.oracleFailing, 0); return { flagged: fl, truePositives: tp, oracleFailing: fail, precision: fl ? r3(tp / fl) : null, recall: fail ? r3(tp / fail) : null }; };
  return { practiceWorlds: PRACTICE.map(worldKey), perBuild: out, pooled: { contracts: pool('contracts'), nversion: pool('nversion') } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  if (process.argv.includes('--signatures-only')) { await ensembleSignatures(); console.log('ensemble signatures cached'); }
  else {
    const t = await verifierTable();
    writeFileSync(arg('--out', path.join(ROOT, 'research/heal-20261021/fh1/verifiers.json')), JSON.stringify(t, null, 1));
    console.log(JSON.stringify(t.pooled, null, 1));
    for (const [b, r] of Object.entries(t.perBuild)) console.log(b, JSON.stringify({ failing: r.oracleFailing, contracts: r.contracts, nversion: r.nversion, byClass: r.byClass }));
  }
}
