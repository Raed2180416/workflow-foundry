#!/usr/bin/env node
// $0 root-cause funnel for GQA-1 runs (analysis only, after scoring; it uses the oracle's probes, so it never feeds an arm).
// For every injected bug and every run it says how far the bug got:
//   triggered   some exploration run of the arm made the bug's fault manifest (replayed on B1 with the probes on)
//   candidate   (workflow / monkey arms) some violated check's candidate repro, as minimized (or as found, when it was not
//               confirmed), makes the fault manifest
//   confirmed   a confirmed, minimized candidate makes it manifest
//   reported    some report of the arm makes it manifest (the oracle's "credited", any class, minimal or not)
//   foundMin    the oracle credits it with a 1-minimal repro (the primary metric)
// and, for each false report, what the arm's own evidence was (the check that fired, or the agent's claim).
//   node experiments/gameqa-web/funnel.mjs RUN_DIR [RUN_DIR ...] > funnel.json
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openSession } from '../../beds/gameqa-web/driver.mjs';
import { loadTruth } from '../../beds/gameqa-web/oracle.mjs';

const truth = loadTruth(), byFlag = new Map(truth.bugs.map(b => [b.flag, b.id]));
const read = (dir, f) => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), 'utf8')) : null);

export async function funnelOf(session, dir) {
  const meta = read(dir, 'meta.json'), stats = read(dir, 'stats.json') ?? {}, score = read(dir, 'score.json'), reports = read(dir, 'reports.json') ?? [];
  const cache = new Map();
  const fires = async (seed, steps) => {
    const k = `${seed}|${steps.join(' ')}`;
    if (!cache.has(k)) {
      const r = await session.replayWithProbes(seed, steps);
      cache.set(k, [...new Set(r.fired.map(f => byFlag.get(f.id)))]);
    }
    return cache.get(k);
  };
  const played = stats.stats?.played ?? [];
  const per = Object.fromEntries(truth.bugs.map(b => [b.id, { triggered: 0, firstTriggerRun: null, candidate: [], confirmed: [], reported: false, foundMin: false }]));
  for (const [i, p] of played.entries()) {
    if (!Array.isArray(p.steps) || !p.steps.length) continue;
    for (const id of await fires(p.seed, p.steps.slice(0, 400))) { per[id].triggered++; per[id].firstTriggerRun ??= i; }
  }
  for (const m of stats.minimized ?? []) {
    if (!m.steps?.length) continue;
    const ids = await fires(m.seed, m.steps);
    for (const id of ids) { per[id].candidate.push(m.checkId); if (m.confirmed) per[id].confirmed.push(m.checkId); }
  }
  for (const r of score?.perReport ?? []) if (r.verdict === 'credited') per[r.bug].reported = true;
  for (const [id, b] of Object.entries(score?.perBug ?? {})) per[id].foundMin = b.foundMin;
  const falseReports = (score?.perReport ?? []).filter(r => r.verdict !== 'credited').map(r => ({ index: r.index, verdict: r.verdict, reason: r.reason,
    bug_class: reports[r.index]?.bug_class, title: reports[r.index]?.title, steps: reports[r.index]?.steps }));
  // verdicts (workflow): which checks the judge rejected, and which confirmed candidates it rejected although they fire a fault
  const rejectedReal = [];
  for (const v of stats.verdicts ?? []) {
    if (v.is_bug !== false) continue;
    const m = (stats.minimized ?? []).find(x => x.confirmed && v.checkIds?.includes(x.checkId));
    if (m) { const ids = await fires(m.seed, m.steps); if (ids.length) rejectedReal.push({ checkIds: v.checkIds, fires: ids, steps: m.steps }); }
  }
  const stage = id => (per[id].foundMin ? 'foundMin' : per[id].reported ? 'reported-not-minimal' : per[id].confirmed.length ? 'confirmed-not-reported'
    : per[id].candidate.length ? 'candidate-not-confirmed' : per[id].triggered ? 'triggered-not-detected' : 'never-triggered');
  return { runId: meta?.runId ?? path.basename(dir), arm: meta?.arm, played: played.length, perBug: Object.fromEntries(Object.entries(per).map(([id, x]) => [id, { stage: stage(id), ...x }])),
    stages: Object.fromEntries(truth.bugs.map(b => [b.id, stage(b.id)])), falseReports, judgeRejectedReal: rejectedReal, replays: cache.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('usage: funnel.mjs RUN_DIR [RUN_DIR ...]'); process.exit(2); }
  const browser = await launchBrowser();
  const session = await openSession(browser, { flags: truth.build.flags, oracle: true });
  const out = [];
  for (const d of dirs) { const f = await funnelOf(session, d); out.push(f); console.error(f.runId, JSON.stringify(f.stages)); }
  await session.close(); await browser.close();
  console.log(JSON.stringify(out, null, 1));
}
