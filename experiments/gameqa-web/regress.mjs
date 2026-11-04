#!/usr/bin/env node
// $0 regression-pack analysis for GQA-1 (after scoring). R08 node 14: a confirmed bug becomes a replayable regression test
// that must fail on the buggy build and pass on the fixed build. For every report of a check-based arm (workflow,
// workflow-random, monkey, monkey-ref) this replays its minimized tokens on B1 and on the clean build (tester sessions, no
// probes) and evaluates the checks behind the report:
//   failsOnB1      the arm's own check is violated on the buggy build (it should be: the report was confirmed there)
//   passesOnClean  the same check holds on the clean build: a valid regression test. A check that also fails on the clean
//                  build is a wrong check (a false alarm that a control build would have caught; R08 discriminator 1).
// It also writes the pack: one entry per oracle-credited, 1-minimal report (deduplicated by bug), reusable on build N+1.
//   node experiments/gameqa-web/regress.mjs OUT_PACK.json RUN_DIR [RUN_DIR ...] > regress.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth } from '../../beds/gameqa-web/oracle.mjs';
import { compileChecks, violationPredicate } from './qa-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (dir, f) => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), 'utf8')) : null);
const REF = JSON.parse(readFileSync(path.join(ROOT, 'experiments/gameqa-web/reference-checks.json'), 'utf8')).checks;

export async function regressRun(b1, clean, dir) {
  const meta = read(dir, 'meta.json'), stats = read(dir, 'stats.json'), reports = read(dir, 'reports.json') ?? [], score = read(dir, 'score.json');
  if (!stats?.reportChecks) return { runId: meta?.runId, arm: meta?.arm, skipped: 'no checks behind the reports (agent arm)' };
  const specs = meta.arm === 'monkey-ref' ? REF : (read(dir, 'constructed.json')?.specs ?? []);
  const { checks } = compileChecks(specs);
  const out = [];
  for (const [i, r] of reports.entries()) {
    const ids = stats.reportChecks[i] ?? [];
    const onB1 = [], onClean = [];
    for (const id of ids) {
      onB1.push(await violationPredicate(b1, r.seed, id, checks)(r.steps));
      onClean.push(await violationPredicate(clean, r.seed, id, checks)(r.steps));
    }
    const pr = score?.perReport?.find(x => x.index === i);
    out.push({ index: i, checks: ids, failsOnB1: onB1.some(Boolean), passesOnClean: !onClean.some(Boolean), oracle: pr?.verdict, bug: pr?.bug ?? null, minimal: pr?.minimal ?? null,
      seed: r.seed, steps: r.steps, title: r.title });
  }
  const valid = out.filter(x => x.failsOnB1 && x.passesOnClean).length;
  return { runId: meta.runId, arm: meta.arm, reports: out.length, validRegressionTests: valid, wrongChecks: out.filter(x => !x.passesOnClean).length,
    falseReportsCaughtByControl: out.filter(x => x.oracle === 'no_fault' && !x.passesOnClean).length, falseReportsMissedByControl: out.filter(x => x.oracle === 'no_fault' && x.passesOnClean).length,
    perReport: out, specs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [packFile, ...dirs] = process.argv.slice(2);
  if (!packFile || !dirs.length) { console.error('usage: regress.mjs OUT_PACK.json RUN_DIR [RUN_DIR ...]'); process.exit(2); }
  const truth = loadTruth(), browser = await launchBrowser();
  const b1 = await openSession(browser, { flags: truth.build.flags }), clean = await openSession(browser, { flags: [] });
  const results = [], pack = new Map();
  for (const d of dirs) {
    const r = await regressRun(b1, clean, d);
    console.error(r.runId, r.skipped ?? `reports ${r.reports}, valid regression tests ${r.validRegressionTests}, wrong checks ${r.wrongChecks}`);
    for (const x of r.perReport ?? []) {
      if (x.oracle !== 'credited' || !x.minimal || !x.failsOnB1 || !x.passesOnClean || pack.has(x.bug)) continue;
      const spec = x.checks.map(id => r.specs.find(c => c.id === id) ?? { id, rule: 'generic detector (template)' });
      pack.set(x.bug, { bug: x.bug, from: r.runId, seed: x.seed, steps: x.steps, checks: spec, title: x.title });
    }
    const { specs, ...rest } = r;
    results.push(rest);
  }
  await b1.close(); await clean.close(); await browser.close();
  writeFileSync(packFile, `${JSON.stringify({ note: 'GQA-1 regression pack: per injected bug, one oracle-credited 1-minimal repro with the executable check that detects it; each test fails on B1 and passes on the clean build. Bug ids are oracle-side labels (analysis only).', tests: [...pack.values()].sort((a, b) => a.bug.localeCompare(b.bug)) }, null, 1)}\n`);
  console.log(JSON.stringify(results, null, 1));
}
