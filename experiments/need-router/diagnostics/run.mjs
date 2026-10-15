// Runs the M0 $0 diagnostics D0-D6 (research/need-router-20261014/DESIGN.md §7 M0 item 10) and writes
//   research/need-router-20261014/analysis/m0/diagnostics.json   every number, with the source file and sha256 it came from
//   research/need-router-20261014/analysis/m0/REPORT.md          the same numbers as prose and tables (with --report)
// No model call, no network. Inputs: the rescued archive (research/need-router-20261014/archive/, see rescue.mjs), the committed JIT stream
// exports (research/jit-20261008/runs/), the feature census, prereg/stages.json, the corpus overlay and the E8 and runbook beds.
//   node experiments/need-router/diagnostics/rescue.mjs                      once: copy the git-ignored P1 and C0-dev JSONL into the archive
//   node experiments/need-router/diagnostics/launch-env.mjs --write           once per measurement: scan the saved CLI transcripts for the cache-write rate they were
//                                                                            billed at, into analysis/m0/launch-env.json (this file, not the transcripts, is what run.mjs reads)
//   node experiments/need-router/diagnostics/run.mjs [--only d0,d3 --out DIR] [--report] [--out DIR] [--check]
// A run that skips a diagnostic (--only) may not write analysis/m0/diagnostics.json: label-run reads D6's cost-meter gate from that file, and a copy without
// D6 would switch the gate off. A subset needs an --out directory other than analysis/m0 (its diagnostics.json then carries `partial`); --check takes no --only.
// --check recomputes everything and compares it with the committed diagnostics.json through currency.mjs, which separates the results (every number
// and label) from the provenance (the sha256 of each input file, the code fingerprints, each anchor bed's module-graph hash): exit 0 when current;
// exit 2 with "inputs moved, re-run run.mjs --report" when an input or the code moved (whether or not the numbers changed); exit 1 when results
// differ with none of their inputs moved. D1's anchor-bed features and D5's E8 text come from files still being written, so those moves are expected.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_DIR, ARCHIVE_DIR, REPO, rel, sha256, sourceOf } from './common.mjs';
import { compareCurrency, describeCurrency } from './currency.mjs';
import { loadLegacyJobs, loadConstructions, P1_HAND_AUTHORING, ceilingRule } from './legacy.mjs';
import { runD0 } from './d0-knn.mjs';
import { runD1 } from './d1-shortcut.mjs';
import { computeAnchorFeatures } from './anchors.mjs';
import { runD2 } from './d2-cofailure.mjs';
import { runD3 } from './d3-signals.mjs';
import { runD4 } from './d4-fragility.mjs';
import { runD5 } from './d5-guard.mjs';
import { runD6 } from './d6-cost.mjs';
import { readLaunchEnv, LAUNCH_ENV_FILE } from './launch-env.mjs';

export const ALL = Object.freeze(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']);
const here = path.dirname(fileURLToPath(import.meta.url));
export const MODULES = Object.freeze(['common', 'census', 'currency', 'legacy', 'anchors', 'd0-knn', 'd1-shortcut', 'd2-cofailure', 'd3-signals', 'd4-fragility', 'd5-guard', 'd6-cost', 'launch-env', 'rescue'].map(m => `${m}.mjs`));
// Modules outside this directory whose logic the numbers depend on (their fingerprints are recorded too, so a change there reads as "code moved").
export const EXTERNAL_MODULES = Object.freeze(['metrics', 'harvest', 'features', 'meter-gate'].map(m => `../${m}.mjs`));

/**
 * Which diagnostics a run covers and where it may write (pure). errors: unknown names; a subset aimed at the committed analysis/m0 (it would rewrite
 * diagnostics.json without the other sections, D6's meter gate among them); --check with a subset (it compares a full run with the committed file).
 */
export function planRun({ only = ALL, outDir = OUT_DIR, check = false } = {}) {
  const errors = [], want = new Set(only), unknown = [...want].filter(k => !ALL.includes(k));
  if (unknown.length) errors.push(`unknown diagnostic(s) ${unknown.join(', ')} (known: ${ALL.join(', ')})`);
  const missing = ALL.filter(k => !want.has(k)), full = !missing.length && !unknown.length, committed = path.resolve(outDir) === path.resolve(OUT_DIR);
  if (missing.length && committed) errors.push(`--only ${[...want].join(',')} would rewrite the committed ${rel(path.join(OUT_DIR, 'diagnostics.json'))} without ${missing.join(', ')}: label-run reads the D6 cost-meter gate from it and a copy without D6 switches the gate off. Run every diagnostic, or give --out a directory other than analysis/m0`);
  if (missing.length && check) errors.push('--check compares a full run with the committed diagnostics.json: it cannot take --only');
  return { errors, full, only: ALL.filter(k => want.has(k)), missing, committed };
}

export async function runAll({ only = ALL, archiveDir = ARCHIVE_DIR } = {}) {
  const want = new Set(only);
  const legacy = loadLegacyJobs({ archiveDir });
  const cons = loadConstructions({ archiveDir });
  const out = {
    schema: 'need-router-m0-diagnostics/1', evidence: 'development (D0, D1, D5 on the census, the job table and the corpus) and LEGACY/development (D2, D3, D4, D6 on archived rows)',
    note: 'No model call. Every archived row is LEGACY: it predates the need-router protocol and is never pooled with new labels (DESIGN §2).',
    code: Object.fromEntries([...MODULES, ...EXTERNAL_MODULES].map(m => [path.basename(m), sha256(readFileSync(path.join(here, m))).slice(0, 16)])),
    inputs: {
      legacySources: legacy.sources, notes: legacy.notes,
      // Stream experiments under research/jit-20261008/runs/ that no LEGACY job definition names: never opened (legacy.mjs loadJitJobs).
      skippedStreams: legacy.skipped,
      // Which model wrote each workflow mode's workflow, and so which modes are ceiling arms (L_ceiling only): legacy.mjs LEGACY_REGISTRY.
      ceilingRule: ceilingRule(),
      // The P1 hand workflow's authoring cost, charged in full as a build row to each hand mode (legacy.mjs P1_HAND_AUTHORING).
      p1Authoring: { usd: P1_HAND_AUTHORING.usd, lowerBound: P1_HAND_AUTHORING.lowerBound, calls: P1_HAND_AUTHORING.calls, modes: P1_HAND_AUTHORING.modes, source: P1_HAND_AUTHORING.source },
      // pairing: what the diagnostics' own pairing dropped; harvest: what the stream harvest dropped before it (tasks a mode ran outside the paired set,
      // modes under half coverage, the external builds charged); builds: fixed costs charged, lower bounds marked.
      jobs: legacy.jobs.map(j => ({ id: j.id, kind: j.kind, family: j.family, oracle: j.oracle, units: j.pairing.paired, modes: j.pairing.modes, dropped: j.pairing.dropped, rows: j.rows.length, allRows: j.allRows.length,
        builds: j.builds.map(b => ({ mode: b.mode, usd: Math.round(b.usd * 1e4) / 1e4, ...(b.lowerBound ? { lowerBound: true } : {}) })), harvest: j.harvest ?? null, sources: j.sources })),
    },
  };
  // A subset run says so in its own file, so that nothing reads it as the full set (meter-gate.mjs parseMeterGate names it when it finds no gate).
  if (ALL.some(k => !want.has(k))) out.partial = { ran: ALL.filter(k => want.has(k)), notRun: ALL.filter(k => !want.has(k)) };
  // The anchor beds' features are computed once, for D0's anchor sensitivity and D1's second table.
  const anchors = want.has('d0') || want.has('d1') ? await computeAnchorFeatures() : null;
  if (want.has('d0')) out.d0 = runD0({ anchors });
  if (want.has('d1')) { const a = anchors; out.d1 = runD1({ anchors: a.features }); out.d1.anchorBeds = { seeds: a.seeds, difficulties: a.difficulties, errors: a.errors, features: a.features, beds: a.beds }; }
  if (want.has('d2')) out.d2 = runD2(legacy.jobs);
  if (want.has('d3')) out.d3 = await runD3(legacy.jobs);
  if (want.has('d4')) out.d4 = runD4(legacy.jobs);
  if (want.has('d5')) out.d5 = await runD5();
  if (want.has('d6')) {
    out.d6 = runD6(legacy.jobs, { constructions: cons.builds });
    // The launch-environment measurement (launch-env.mjs, the only reader of CLI transcripts) is a committed input: read from its JSON, never from the transcripts.
    const le = readLaunchEnv();
    out.d6.launchEnv = le ? { source: sourceOf(LAUNCH_ENV_FILE), measuredAt: le.measuredAt, after: le.after, priceTable: le.priceTable, summary: le.summary } : null;
  }
  return out;
}

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(REPO, arg('--out', rel(OUT_DIR)));
  const only = arg('--only') ? [...new Set(arg('--only').split(',').map(x => x.trim()).filter(Boolean))] : ALL;
  const plan = planRun({ only, outDir, check: process.argv.includes('--check') });
  if (plan.errors.length) { for (const e of plan.errors) console.error(`run.mjs: refused: ${e}`); process.exitCode = 2; }
  else await main(only, outDir);
}
async function main(only, outDir) {
  const results = await runAll({ only });
  const text = JSON.stringify(results, null, 1) + '\n';
  const file = path.join(outDir, 'diagnostics.json');
  if (process.argv.includes('--check')) {
    const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (prev === text) { console.log(`diagnostics.json reproduced byte for byte (${text.length} bytes)`); process.exitCode = 0; }
    else if (prev === null) { console.log('diagnostics.json is missing: run run.mjs --report'); process.exitCode = 1; }
    else {
      const r = compareCurrency(JSON.parse(prev), JSON.parse(text));
      console.log(describeCurrency(r));
      process.exitCode = r.status === 'results-differ' ? 1 : r.status === 'inputs-moved' ? 2 : 0;
    }
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, text);
    console.log(`wrote ${rel(file)} (${text.length} bytes)`);
    for (const k of only) {
      const r = results[k]; if (!r) continue;
      console.log(`${r.id}: ${JSON.stringify(r.summary)}`);
    }
    if (process.argv.includes('--report')) {
      const { renderReport } = await import('./report.mjs');
      const rf = path.join(outDir, 'REPORT.md');
      writeFileSync(rf, renderReport(results));
      console.log(`wrote ${rel(rf)}`);
    }
  }
}
