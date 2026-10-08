#!/usr/bin/env node
// Runs every control against the oracle and writes controls/report.json (raw numbers; nothing is hand-edited).
//   node experiments/replicate/items/n8n-12679/controls/run-controls.mjs [--seeds 20]
// The original-definition controls need /opt/corpus/n8n/workflows/12679.json.gz (sha256-pinned); without it they are recorded as unavailable.
import { writeFileSync } from 'node:fs';
import * as bed from '../index.mjs';
import { CONFIG } from '../scenarios.mjs';
import { driveSync } from '../env.mjs';
import { makeFaithful, makeImproved } from './reference.mjs';
import { ORIGINAL, originalAvailable, loadOriginal, rebind, makeOriginalHandler, expressionsOf, classifyExpression, MUTANTS } from './original.mjs';
import { canonical } from '../../../../../beds/lib/canonical.mjs';

const N = Number(process.argv[process.argv.indexOf('--seeds') + 1]) || 20;
const seeds = Array.from({ length: N }, (_, i) => i);
const task = (seed, difficulty, variant) => bed.generate({ seed, split: 'dev', difficulty, variant });
const tally = (arr, f) => arr.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
const codesOf = r => [...new Set(r.details.scenarios?.flatMap(s => s.codes) ?? [])];
const timed = f => { const t = Date.now(); const v = f(); return [v, Date.now() - t]; };

const report = { item: bed.ITEM, harness: bed.VERSION, seeds: N, status: 'development/diagnostic; not a sealed evaluation', controls: {} };

// 1. known-good references
for (const [name, variant, mk] of [['faithful-transcription', 'T2', () => makeFaithful(CONFIG)], ['improved', 'T3', () => makeImproved(CONFIG)]]) {
  const byDifficulty = {};
  for (const d of [1, 2, 3, 4, 5]) {
    const rs = seeds.slice(0, d === 3 ? N : 5).map(s => { const t = task(s, d, variant); return bed.oracle(t, driveSync(t, mk())); });
    byDifficulty[`d${d}`] = { seeds: rs.length, pass: tally(rs, r => r.pass), meanCalls: Math.round(rs.reduce((a, r) => a + r.details.cost.externalCalls, 0) / rs.length), ...(variant === 'T3' ? { meanRatioToTranscription: Number((rs.reduce((a, r) => a + r.details.cost.ratioToReference, 0) / rs.length).toFixed(3)) } : {}) };
  }
  report.controls[name] = { variant, byDifficulty };
}
// The faithful transcription on T3 shows which probes the original's behaviour fails.
{
  const probeFails = {}, rs = seeds.map(s => { const t = task(s, 3, 'T3'); return bed.oracle(t, driveSync(t, makeFaithful(CONFIG))); });
  for (const r of rs) for (const p of r.details.probesFailed) probeFails[p] = (probeFails[p] ?? 0) + 1;
  report.controls['faithful-transcription'].onT3 = { seeds: N, corePass: tally(rs, r => r.details.coreFailed.length === 0), probesFailedBySeedCount: probeFails, costPass: tally(rs, r => r.details.cost.withinTarget) };
}

// 2. known-bad controls (T2 core; every seed at d3)
report.controls.bad = {};
for (const c of bed.badControls) {
  const rs = seeds.map(s => { const t = task(s, 3, 'T2'); return bed.oracle(t, c.make(t)); });
  const codes = {};
  for (const r of rs) for (const k of codesOf(r)) codes[k] = (codes[k] ?? 0) + 1;
  report.controls.bad[c.name] = { describe: c.describe, seeds: N, passedOracle: tally(rs, r => r.pass), meanScore: Number((rs.reduce((a, r) => a + r.score, 0) / N).toFixed(3)), expectedCodes: c.expect, expectedCodesHit: c.expect.map(e => tally(rs, r => codesOf(r).includes(e))), codesBySeedCount: codes };
}

// 3. the ORIGINAL definition, executed
if (!originalAvailable()) report.controls.original = { available: false, why: `${ORIGINAL.rawPath} not present` };
else {
  const wf = rebind(loadOriginal(), CONFIG);
  const ex = expressionsOf(wf);
  const kinds = {};
  for (const e of ex) { const k = classifyExpression(e.expr); kinds[k] = (kinds[k] ?? 0) + 1; }
  const run = (def, variant, shape, s, d) => { const t = task(s, d, variant); const h = makeOriginalHandler(def, CONFIG, { zohoGetShape: shape }); const out = driveSync(t, h); return { v: bed.oracle(t, out), out, h }; };
  const orig = { available: true, sha256: ORIGINAL.sha256, expressions: { total: ex.length, byKind: kinds, unreviewed: ex.length - tally(ex, e => classifyExpression(e.expr)) }, binding: wf.__binding };
  const agg = (shape, variant) => {
    const rs = seeds.map(s => run(wf, variant, shape, s, 3));
    const probeFails = {}, nodeErrors = {};
    for (const { v, h } of rs) { for (const p of v.details.probesFailed) probeFails[p] = (probeFails[p] ?? 0) + 1; for (const r of h.runs) if (r.error) { const k = r.error.replace(/\d{5,}/g, '#').slice(0, 80); nodeErrors[k] = (nodeErrors[k] ?? 0) + 1; } }
    const coreFailed = {}; for (const { v } of rs) for (const id of v.details.coreFailed) coreFailed[id] = (coreFailed[id] ?? 0) + 1;
    return { seeds: N, corePass: tally(rs, ({ v }) => v.details.coreFailed.length === 0), coreFailedBySeedCount: coreFailed, probesFailedBySeedCount: probeFails, meanExternalCalls: Math.round(rs.reduce((a, { v }) => a + v.details.cost.externalCalls, 0) / N), meanFailedCalls: Number((rs.reduce((a, { v }) => a + v.details.cost.failedCalls, 0) / N).toFixed(1)), nodeErrorsAcrossSeeds: nodeErrors };
  };
  orig.alias = agg('alias', 'T3');           // Zoho "get" exposes a lowercase email (charitable reading, the primary control)
  orig.raw = agg('raw', 'T3');               // Zoho "get" returns the raw Zoho record only
  // trace identity with the committed transcription
  let same = 0, total = 0, firstDiff = null;
  for (const d of [1, 2, 3, 4, 5]) for (const s of seeds.slice(0, 8)) {
    const t = task(s, d, 'T3');
    const a = driveSync(t, makeOriginalHandler(wf, CONFIG)).actions, b = driveSync(t, makeFaithful(CONFIG)).actions;
    total++; if (canonical(a) === canonical(b)) same++; else firstDiff ??= { seed: s, difficulty: d };
  }
  orig.traceIdenticalToTranscription = { identical: same, of: total, firstDiff };
  orig.mutants = {};
  for (const [name, m] of Object.entries(MUTANTS)) {
    const mutated = m.apply(structuredClone(wf));
    const rs = seeds.map(s => run(mutated, 'T2', 'alias', s, 3).v);
    const codes = {}; for (const r of rs) for (const k of codesOf(r)) codes[k] = (codes[k] ?? 0) + 1;
    orig.mutants[name] = { describe: m.describe, passedOracle: tally(rs, r => r.pass), codesBySeedCount: codes };
  }
  report.controls.original = orig;
}

const out = new URL('./report.json', import.meta.url);
writeFileSync(out, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify(report, null, 1));
