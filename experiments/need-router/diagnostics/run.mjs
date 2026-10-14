// Runs the M0 $0 diagnostics D0-D6 (research/need-router-20261014/DESIGN.md §7 M0 item 10) and writes
//   research/need-router-20261014/analysis/m0/diagnostics.json   every number, with the source file and sha256 it came from
//   research/need-router-20261014/analysis/m0/REPORT.md          the same numbers as prose and tables (with --report)
// No model call, no network. Inputs: the rescued archive (research/need-router-20261014/archive/, see rescue.mjs), the committed JIT stream
// exports (research/jit-20261008/runs/), the feature census, prereg/stages.json, the corpus overlay and the E8 and runbook beds.
//   node experiments/need-router/diagnostics/rescue.mjs                      once: copy the git-ignored P1 and C0-dev JSONL into the archive
//   node experiments/need-router/diagnostics/run.mjs [--only d0,d3] [--report] [--out DIR] [--check]
// --check recomputes everything and compares it with the committed diagnostics.json (exit 1 on a difference); D1's anchor-bed features are
// computed from beds that were still being written, so a difference there is reported first.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_DIR, ARCHIVE_DIR, REPO, rel, sha256 } from './common.mjs';
import { loadLegacyJobs, loadConstructions } from './legacy.mjs';
import { runD0 } from './d0-knn.mjs';
import { runD1 } from './d1-shortcut.mjs';
import { computeAnchorFeatures } from './anchors.mjs';
import { runD2 } from './d2-cofailure.mjs';
import { runD3 } from './d3-signals.mjs';
import { runD4 } from './d4-fragility.mjs';
import { runD5 } from './d5-guard.mjs';
import { runD6 } from './d6-cost.mjs';

export const ALL = Object.freeze(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']);
const here = path.dirname(fileURLToPath(import.meta.url));
export const MODULES = Object.freeze(['common', 'census', 'legacy', 'anchors', 'd0-knn', 'd1-shortcut', 'd2-cofailure', 'd3-signals', 'd4-fragility', 'd5-guard', 'd6-cost', 'rescue'].map(m => `${m}.mjs`));

export async function runAll({ only = ALL, archiveDir = ARCHIVE_DIR } = {}) {
  const want = new Set(only);
  const legacy = loadLegacyJobs({ archiveDir });
  const cons = loadConstructions({ archiveDir });
  const out = {
    schema: 'need-router-m0-diagnostics/1', evidence: 'development (D0, D1, D5 on the census, the job table and the corpus) and LEGACY/development (D2, D3, D4, D6 on archived rows)',
    note: 'No model call. Every archived row is LEGACY: it predates the need-router protocol and is never pooled with new labels (DESIGN §2).',
    code: Object.fromEntries(MODULES.map(m => [m, sha256(readFileSync(path.join(here, m))).slice(0, 16)])),
    inputs: {
      legacySources: legacy.sources, notes: legacy.notes,
      jobs: legacy.jobs.map(j => ({ id: j.id, kind: j.kind, family: j.family, oracle: j.oracle, units: j.pairing.paired, modes: j.pairing.modes, dropped: j.pairing.dropped, rows: j.rows.length, allRows: j.allRows.length, builds: j.builds.map(b => ({ mode: b.mode, usd: Math.round(b.usd * 1e4) / 1e4 })), sources: j.sources })),
    },
  };
  if (want.has('d0')) out.d0 = runD0();
  if (want.has('d1')) { const a = await computeAnchorFeatures(); out.d1 = runD1({ anchors: a.features }); out.d1.anchorBeds = { seeds: a.seeds, difficulties: a.difficulties, errors: a.errors, features: a.features }; }
  if (want.has('d2')) out.d2 = runD2(legacy.jobs);
  if (want.has('d3')) out.d3 = await runD3(legacy.jobs);
  if (want.has('d4')) out.d4 = runD4(legacy.jobs);
  if (want.has('d5')) out.d5 = await runD5();
  if (want.has('d6')) out.d6 = runD6(legacy.jobs, { constructions: cons.builds });
  return out;
}

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(REPO, arg('--out', rel(OUT_DIR)));
  const only = arg('--only') ? arg('--only').split(',') : ALL;
  const results = await runAll({ only });
  const text = JSON.stringify(results, null, 1) + '\n';
  const file = path.join(outDir, 'diagnostics.json');
  if (process.argv.includes('--check')) {
    const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
    const ok = prev === text;
    console.log(ok ? `diagnostics.json reproduced byte for byte (${text.length} bytes)` : `diagnostics.json differs from a fresh run (${prev?.length ?? 'missing'} against ${text.length} bytes)`);
    process.exitCode = ok ? 0 : 1;
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
