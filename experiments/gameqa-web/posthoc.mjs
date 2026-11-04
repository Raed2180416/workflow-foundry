#!/usr/bin/env node
// GQA-1 POST-HOC analyses ($0, written after the rep-1 data was seen; not preregistered, labeled as such in the result).
// They use the oracle and the oracle-informed reference checks, so they explain results; they never feed an arm.
//   (a) credited-candidate funnel: every confirmed candidate of a check-based arm is scored like a report (class = its
//       check's class) with the oracle's own credit rule, so "this candidate is a repro of bug X" means the same thing as
//       for reports (the preregistered funnel counts a candidate for every fault its repro fires, even incidentally).
//   (b) exploration x perfect checks: the arm's own exploration runs (seed + tokens, as played) are scanned with the
//       22 reference checks, each (check, screen) violation is reproduced and ddmin-minimized, and the results are
//       scored. It separates "the exploration never made the fault observable" from "the arm's checks or judgment missed
//       it": an upper bound on what the same exploration could have found with perfect checks.
//   node experiments/gameqa-web/posthoc.mjs RUN_DIR [RUN_DIR ...] > posthoc.json
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth, scoreReports } from '../../beds/gameqa-web/oracle.mjs';
import { compileChecks, scanRun, violationPredicate, ddmin } from './qa-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (dir, f) => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), 'utf8')) : null);
const REF = compileChecks(JSON.parse(readFileSync(path.join(ROOT, 'experiments/gameqa-web/reference-checks.json'), 'utf8')).checks).checks;
const GENERIC_CLASS = { 'generic:frozen': 'softlock', 'generic:page-error': 'softlock' };
const found = s => Object.entries(s.perBug).filter(([, b]) => b.foundMin).map(([id]) => id).sort();

export async function creditedCandidates(browser, dir, truth) {
  const stats = read(dir, 'stats.json'), meta = read(dir, 'meta.json');
  const specs = meta.arm === 'monkey-ref' ? JSON.parse(readFileSync(path.join(ROOT, 'experiments/gameqa-web/reference-checks.json'), 'utf8')).checks : (read(dir, 'constructed.json')?.specs ?? []);
  const cands = (stats?.minimized ?? []).filter(m => m.confirmed);
  if (!cands.length) return null;
  const pseudo = cands.map(m => ({ bug_class: specs.find(c => c.id === m.checkId)?.bug_class ?? GENERIC_CLASS[m.checkId] ?? 'softlock', title: m.checkId, seed: m.seed, steps: m.steps }));
  const s = await scoreReports(browser, pseudo, { truth });
  return { candidates: cands.length, foundMinByCandidates: found(s), perCandidate: s.perReport.map((r, i) => ({ checkId: cands[i].checkId, ctx: cands[i].ctx, bug: r.bug ?? null, minimal: r.minimal ?? null, verdict: r.verdict })) };
}

export async function exploreWithPerfectChecks(browser, dir, truth) {
  const stats = read(dir, 'stats.json');
  const played = stats?.stats?.played ?? [];
  if (!played.length) return null;
  const session = await openSession(browser, { flags: truth.build.flags });
  const cands = new Map();
  try {
    for (const p of played) {
      const start = await session.reset(p.seed);
      const run = await session.run(p.steps.slice(0, 400), { detail: 'each' });
      for (const v of scanRun(run, start, REF).violations) {
        const key = `${v.checkId}|${v.ctx}`, steps = p.steps.slice(0, v.tokenIndex + 1);
        if (!cands.has(key) || steps.length < cands.get(key).steps.length) cands.set(key, { checkId: v.checkId, ctx: v.ctx, seed: p.seed, steps });
      }
    }
    const reports = [];
    for (const c of cands.values()) {
      const pred = violationPredicate(session, c.seed, c.checkId, REF, { ctx: c.ctx });
      if (!(await pred(c.steps))) continue;
      const m = await ddmin(c.steps, pred, { maxTests: 400 });
      reports.push({ bug_class: REF.find(x => x.id === c.checkId)?.bug_class ?? GENERIC_CLASS[c.checkId] ?? 'softlock', title: c.checkId, seed: c.seed, steps: m.tokens });
    }
    await session.close();
    const s = await scoreReports(browser, reports, { truth });
    return { played: played.length, signatures: cands.size, foundMinWithPerfectChecks: found(s), n: s.summary.foundMin };
  } catch (e) { await session.close().catch(() => {}); throw e; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.slice(2);
  const truth = loadTruth(), browser = await launchBrowser();
  const out = [];
  for (const d of dirs) {
    const meta = read(d, 'meta.json'), score = read(d, 'score.json');
    const a = await creditedCandidates(browser, d, truth), b = await exploreWithPerfectChecks(browser, d, truth);
    const row = { runId: meta.runId, arm: meta.arm, foundMin: found(score), creditedCandidates: a, exploreWithPerfectChecks: b };
    console.error(row.runId, 'found', row.foundMin.length, '| candidates could credit', a?.foundMinByCandidates.length ?? '-', '| exploration + perfect checks', b?.n ?? '-');
    out.push(row);
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
}
