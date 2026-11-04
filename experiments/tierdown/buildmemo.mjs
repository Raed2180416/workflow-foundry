#!/usr/bin/env node
// B-memo at build time ($0; dossier §4 item 5, measured, NOT applied): how much of the archived compile and check judge
// spend repeats a request an earlier RUN of the same arm already answered (same model, system, prompt and schema),
// i.e. what a k-th-answer memo across runs would have served. Repeats inside one run (k-sample votes) are counted apart:
// a memo must not serve those (MEM-0 M3). Applying it changes what jit-check measures (code determinism instead of judge
// variance), so it is an owner decision; this tool only prices it.
//
//   node experiments/tierdown/buildmemo.mjs [--runs DIR] [--json]
import { readFileSync } from 'node:fs';
import { listArms, journalOf, phaseOf, sha256, DEFAULT_RUNS } from './archive.mjs';
import { canonical } from './override.mjs';

export function buildMemo(arms) {
  const out = { byPhase: {}, byExperiment: {} };
  for (const arm of arms) {
    const seenRuns = new Map();   // request key -> set of run ids that asked it
    for (const j of journalOf(arm)) {
      const body = j.request?.body;
      if (!body) continue;
      const phase = phaseOf(String(j.runId));
      if (phase !== 'compile' && phase !== 'check' && phase !== 'delivery') continue;
      const key = sha256(canonical([j.modelId, body.system ?? '', body.prompt ?? '', body.schema ?? null]));
      const runs = seenRuns.get(key) ?? new Set(), usd = j.costUsd ?? 0;
      const kind = runs.size === 0 ? 'first' : runs.has(j.runId) && runs.size === 1 ? 'same-run-repeat' : 'cross-run-repeat';
      runs.add(j.runId); seenRuns.set(key, runs);
      for (const agg of [out.byPhase[phase] ??= {}, (out.byExperiment[arm.experiment] ??= {})[phase] ??= {}]) {
        agg.usd = (agg.usd ?? 0) + usd; agg.calls = (agg.calls ?? 0) + 1;
        agg[`${kind}Usd`] = (agg[`${kind}Usd`] ?? 0) + usd; agg[`${kind}Calls`] = (agg[`${kind}Calls`] ?? 0) + 1;
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const r = buildMemo(listArms({ runs: opt('--runs', DEFAULT_RUNS) }));
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else for (const [p, a] of Object.entries(r.byPhase)) console.log(`${p}: $${a.usd.toFixed(2)} in ${a.calls} calls; cross-run repeats $${(a['cross-run-repeatUsd'] ?? 0).toFixed(2)} (${a['cross-run-repeatCalls'] ?? 0}); same-run repeats $${(a['same-run-repeatUsd'] ?? 0).toFixed(2)} (${a['same-run-repeatCalls'] ?? 0})`);
}
