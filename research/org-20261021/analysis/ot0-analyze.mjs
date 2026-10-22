// $0 analysis for RESULT-OT0.md: re-grade each agent arm's committed host journal (per-case first divergences under the
// E8 oracle and E8 + C2 overlay), compare the 14 cases across arms (discordant pairs, exact McNemar), and compute the P3
// cost basis. Reads only journals and result files. Run from the repo root:
//   node <this file> ahv-s12-r1 af-sonnet-s12-r1 af-opus-s12-r1
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const imp = p => import(path.join(ROOT, p));
const e8 = await imp('beds/ebed/e8/index.mjs');
const { baseWorld, overlayWorld, overlayOracle } = await imp('experiments/constitution/overlay.mjs');
const { buildRegistry } = await imp('experiments/constitution/registry.mjs');
const { CONTROL_TYPES } = await imp('beds/ebed/host/journal.mjs');
const { SIZED, LIVE_ROOT } = await imp('experiments/constitution/run-agents.mjs');

const registry = buildRegistry();
const W = overlayWorld(baseWorld(SIZED), { registry });
const { pools } = await e8.referenceRuns(W);
const contentOf = r => { const { seq, prev, hash, ...c } = r; return c; };
const rowsOf = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !CONTROL_TYPES.has(r.type)).map(contentOf);

function perCase(rows) {
  const v = e8.oracle(W, rows, { pools }), o = overlayOracle(W, rows, { pools });
  const out = {};
  for (const c of v.cases.filter(x => x.pool === 'completed')) {
    const oc = o.cases.find(x => x.case === c.case);
    out[c.case] = { e8: c.pass, ov: oc?.pass ?? null, armCensored: c.armCensored, fd: c.firstDivergence ? { layer: c.firstDivergence.layer, code: c.firstDivergence.code, ...Object.fromEntries(Object.entries(c.firstDivergence).filter(([k]) => !['layer', 'code'].includes(k)).map(([k, x]) => [k, typeof x === 'string' ? x.slice(0, 160) : JSON.stringify(x)?.slice(0, 200)])) } : null,
      fdOv: oc?.firstDivergence ? { layer: oc.firstDivergence.layer, code: oc.firstDivergence.code } : null, critical: c.critical.length };
  }
  return out;
}

const subjects = {};
for (const label of process.argv.slice(2)) {
  const live = path.join(LIVE_ROOT, label, 'journal.jsonl');
  if (!existsSync(live)) { console.log(`${label}: no journal`); continue; }
  subjects[label] = perCase(rowsOf(live));
}
// The W-C / W-CS lineages on the sized world: re-run their stored programs at $0 (as build-wc graded them).
const { runArm } = await imp('experiments/constitution/run.mjs');
const { sandboxArm } = await imp('beds/ebed/host/sandbox-arm.mjs');
const { sha } = await imp('experiments/constitution/port.mjs');
for (const L of ['wc-e8-1', 'wc-e8-2', 'wc-e8-3']) {
  const src = readFileSync(path.join(ROOT, 'research/org-20261021/runs', L, 'solver.mjs'), 'utf8');
  const run = await runArm({ spec: SIZED, arm: 'W-CS', registry, workflowHash: sha(src), make: () => sandboxArm({ id: L, solverSource: src, timeoutMs: 20_000 }) });
  subjects[`${L}/W-CS`] = perCase(run.rows);
}
const cases = Object.keys(Object.values(subjects)[0] ?? {}).sort();
console.log('cases', cases.length, cases.join(' '));
for (const [s, pc] of Object.entries(subjects)) {
  const e = cases.filter(c => pc[c]?.e8).length, o = cases.filter(c => pc[c]?.ov).length;
  console.log(`\n## ${s}: E8 ${e}/${cases.length}, +C2 ${o}/${cases.length}`);
  for (const c of cases) if (!pc[c]?.e8 || !pc[c]?.ov) console.log(`  ${c}: E8 ${pc[c].e8 ? 'pass' : 'FAIL'} +C2 ${pc[c].ov ? 'pass' : 'FAIL'}${pc[c].armCensored ? ' (arm-censored)' : ''} first divergence ${JSON.stringify(pc[c].fd)} | +C2 ${JSON.stringify(pc[c].fdOv)} crit ${pc[c].critical}`);
}
// exact two-sided McNemar on the discordant pairs
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
const mcnemar = (b, c) => { const n = b + c; if (!n) return 1; const k = Math.min(b, c); let p = 0; for (let i = 0; i <= k; i++) p += binom(n, i); return Math.min(1, 2 * p / 2 ** n); };
console.log('\n## paired (E8 + C2 overlay; A-only / B-only discordant, exact McNemar two-sided)');
const names = Object.keys(subjects);
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  const A = subjects[names[i]], B = subjects[names[j]];
  const a = cases.filter(c => A[c]?.ov && !B[c]?.ov).length, b = cases.filter(c => !A[c]?.ov && B[c]?.ov).length;
  console.log(`  ${names[i]} vs ${names[j]}: ${a} / ${b}; p ${mcnemar(a, b).toFixed(3)}`);
}
