// Validate the capability contracts against the E8 oracle (research/composition-20261021/HARNESS.md §3.3). $0, no model
// calls, dev seeds only (E-bed dev block 1001-1199; composition harness seeds 1161-1168, HARNESS.md §6).
//   node experiments/compose/validate.mjs [--worlds 1161:2:40,1162:3:40,1163:4:40,1164:5:60] [--mutants 30] [--out <json>]
// Subjects: both reference runs (must pass every contract), every bad/gaming/necessity/oss control, and a sample of the
// oracle's killed reference mutants (beds/ebed/e8/ledger/latent-defects/index.json: status e0-visible, latent,
// latent-unrevealed or silent, asOracleMutant killed; the reference policy driven by the mutated transition, run as the
// arm, beds/ebed/e8/defects.mjs). Per completed case: both reject / oracle only (a capability miss) / contracts only (a
// disagreement: a finding, never tuned away) / both pass; arm-censored cases (a run the host stopped) are counted apart.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as e8 from '../../beds/ebed/e8/index.mjs';
import { CONTROLS, runControl } from '../../beds/ebed/e8/controls.mjs';
import { transitionMutants, armItemOf, runMutant, scratchDir, removeDir } from '../../beds/ebed/e8/defects.mjs';
import { evaluateCapabilities, CAPABILITIES } from './capabilities.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
export const DEFAULT_WORLDS = '1161:2:40,1162:3:40,1163:4:40,1164:5:60';
const DEV = s => s >= 1001 && s <= 1199;

/** Compare the oracle's and the contracts' verdicts on one journal. */
export function compare(world, rows, pools, { rules } = {}) {
  const v = e8.oracle(world, rows, { pools });
  const ev = evaluateCapabilities(world, rows, { pools, canonicalArgs: e8.canonicalArgs, ...(rules ? { rules } : {}) });
  const capOf = new Map(ev.cases.map(c => [c.case, c]));
  const out = { both: 0, oracleOnly: 0, capsOnly: 0, pass: 0, armCensored: 0, completed: 0, capFails: {}, misses: [], extras: [] };
  for (const c of v.cases) {
    if (c.pool !== 'completed') continue;
    const cap = capOf.get(c.case);
    if (!cap) continue;
    out.completed += 1;
    if (c.armCensored && !c.firstDivergence) { out.armCensored += 1; continue; }
    for (const f of cap.failed) out.capFails[f] = (out.capFails[f] ?? 0) + 1;
    if (!c.pass && !cap.pass) out.both += 1;
    else if (!c.pass) { out.oracleOnly += 1; out.misses.push({ case: c.case, class: c.class, oracle: c.firstDivergence }); }
    else if (!cap.pass) { out.capsOnly += 1; out.extras.push({ case: c.case, class: c.class, violations: cap.violations }); }
    else out.pass += 1;
  }
  return out;
}

const add = (acc, r) => { for (const k of ['both', 'oracleOnly', 'capsOnly', 'pass', 'armCensored', 'completed']) acc[k] = (acc[k] ?? 0) + r[k]; return acc; };

export async function validateAll({ worlds = DEFAULT_WORLDS, mutants = 30, log = console.log } = {}) {
  const specs = worlds.split(',').map(s => { const [seed, d, size] = s.split(':').map(Number); return { seed, d, size }; });
  for (const s of specs) if (!DEV(s.seed)) throw new Error(`seed ${s.seed} is outside the E-bed dev block 1001-1199`);
  const W = [];
  for (const s of specs) {
    const w = e8.generateWorld({ seed: s.seed, difficulty: s.d, mix: 'tail', size: s.size });
    const ref = await e8.referenceRuns(w);
    W.push({ ...s, w, pools: ref.pools, ref });
  }
  const res = { date: new Date().toISOString().slice(0, 10), evidence: 'development (dev worlds, E-bed dev block); $0', worlds: specs, capabilities: CAPABILITIES.map(c => c.id), reference: [], controls: [], mutants: [] };
  // 1. References: every contract must pass on every completed case.
  for (const x of W) for (const timing of ['earliest', 'latest']) {
    const r = compare(x.w, x.ref.runs[timing].rows, x.pools);
    res.reference.push({ seed: x.seed, d: x.d, timing, ...r });
    log(`reference ${timing} ${x.seed} d${x.d}: contracts fail ${r.capsOnly + r.both}/${r.completed}; oracle fails ${r.both + r.oracleOnly}`);
  }
  // 2. Controls.
  for (const ctl of CONTROLS) {
    const acc = { id: ctl.id, kind: ctl.kind, worlds: [], misses: [], extras: [], capFails: {} };
    for (const x of W) {
      if ((ctl.minDifficulty ?? 2) > x.d) continue;
      const r = compare(x.w, await runControl(ctl.id, x.w), x.pools);
      acc.worlds.push({ seed: x.seed, d: x.d, both: r.both, oracleOnly: r.oracleOnly, capsOnly: r.capsOnly, pass: r.pass, armCensored: r.armCensored });
      add(acc, r);
      for (const [k2, n] of Object.entries(r.capFails)) acc.capFails[k2] = (acc.capFails[k2] ?? 0) + n;
      acc.misses.push(...r.misses.slice(0, 5).map(m => ({ seed: x.seed, d: x.d, ...m })));
      acc.extras.push(...r.extras.slice(0, 5).map(m => ({ seed: x.seed, d: x.d, ...m })));
    }
    acc.caughtWhereOracleRejects = acc.both > 0 || (acc.both + acc.oracleOnly) === 0;
    res.controls.push(acc);
    log(`control ${ctl.id}: both ${acc.both}, oracle only ${acc.oracleOnly}, contracts only ${acc.capsOnly}, pass ${acc.pass}, arm-censored ${acc.armCensored}`);
  }
  // 3. A sample of the oracle's killed reference mutants.
  const index = JSON.parse(readFileSync(path.join(ROOT, 'beds/ebed/e8/ledger/latent-defects/index.json'), 'utf8'));
  const killed = index.mutants.filter(m => ['e0-visible', 'latent', 'latent-unrevealed', 'silent'].includes(m.status) && m.asOracleMutant === 'killed' && m.id.startsWith('ref-k'));
  const step = Math.max(1, Math.floor(killed.length / mutants));
  const sample = killed.filter((_, i) => i % step === 0).slice(0, mutants);
  const all = transitionMutants();
  const dir = scratchDir();
  try {
    for (const m of sample) {
      const mut = all.find(x => x.id === m.id);
      const item = await armItemOf(mut, dir);
      const acc = { id: m.id, operator: m.operator, line: m.line, status: m.status, from: mut.from, to: mut.to, worlds: [], misses: [], extras: [], capFails: {} };
      for (const x of W) {
        const { rows, aborted } = await runMutant(mut, x.w, { item, maxWakeups: 6000 });
        const r = compare(x.w, rows, x.pools);
        acc.worlds.push({ seed: x.seed, d: x.d, aborted: aborted ?? null, both: r.both, oracleOnly: r.oracleOnly, capsOnly: r.capsOnly, pass: r.pass, armCensored: r.armCensored });
        add(acc, r);
        for (const [k2, n] of Object.entries(r.capFails)) acc.capFails[k2] = (acc.capFails[k2] ?? 0) + n;
        acc.misses.push(...r.misses.slice(0, 4).map(z => ({ seed: x.seed, d: x.d, ...z })));
        acc.extras.push(...r.extras.slice(0, 4).map(z => ({ seed: x.seed, d: x.d, ...z })));
      }
      acc.oracleRejects = acc.both + acc.oracleOnly > 0;
      acc.contractsReject = acc.both + acc.capsOnly > 0;
      res.mutants.push(acc);
      log(`mutant ${m.id} (${m.operator}, line ${m.line}): both ${acc.both}, oracle only ${acc.oracleOnly}, contracts only ${acc.capsOnly}, arm-censored ${acc.armCensored}`);
    }
  } finally { removeDir(dir); }
  const sum = list => list.reduce((a, r) => add(a, r), {});
  res.summary = {
    reference: { ...sum(res.reference), allPass: res.reference.every(r => r.capsOnly + r.both === 0) },
    controls: { ...sum(res.controls), caughtWhereOracleRejects: res.controls.filter(c => c.caughtWhereOracleRejects).length, of: res.controls.length },
    mutants: { ...sum(res.mutants), sampled: res.mutants.length, oracleRejects: res.mutants.filter(m => m.oracleRejects).length,
      contractsAlsoReject: res.mutants.filter(m => m.oracleRejects && m.contractsReject).length, contractsOnly: res.mutants.filter(m => !m.oracleRejects && m.contractsReject).length },
  };
  return res;
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = await validateAll({ worlds: arg('--worlds', DEFAULT_WORLDS), mutants: Number(arg('--mutants', '30')) });
  console.log(JSON.stringify(res.summary, null, 1));
  const out = arg('--out', null);
  if (out) { mkdirSync(path.dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(res, null, 1)); }
}
