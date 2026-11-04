#!/usr/bin/env node
// GQA-1 report-log re-score ($0; review finding M1). The frozen agent protocol made the agent's report list replace itself
// every turn ("your complete current list ... it replaces the previous list"), and only the last list was scored. A bug the
// agent had found and later dropped from its list was therefore lost, and statements such as "no Haiku arm ever found GQ06"
// were true only of final lists. This script scores, for every agent-type run, the union of every report the agent ever
// listed (the append-only log the protocol should have kept), next to its final list.
//   For the A1 runs (gqa1/agent, gqa1nb/agent, gqa1nb/agent-persist) it is POST HOC (written after the review, 2026-11-04).
//   For the A2 runs (gqa1v/agent) it is the secondary metric `foundMinEver`, fixed in amendment A2 before they ran.
//   For gqa2/agent-matched the filed reports already are the log (the two numbers must agree; the script checks it).
// Every report ever listed is scored like a filed report: a dropped wrong report counts as a false report.
//   node experiments/gameqa-web/rescore-union.mjs [RUNS_DIR] > analysis/report-log-rescore.json
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AGENT_ARMS = Object.freeze(['agent', 'agent-persist', 'agent-matched']);
const read = (d, f) => (existsSync(path.join(d, f)) ? JSON.parse(readFileSync(path.join(d, f), 'utf8')) : null);

/** Every distinct report (by seed + tokens) the model listed in a successful call, in first-seen order, with the call
 *  (nodeKey) that first listed it and the last call that still listed it. `rows` are calls.jsonl rows. */
export function emittedReports(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!r?.ok || !Array.isArray(r.value?.reports)) continue;
    for (const rep of r.value.reports) {
      if (!rep || !Array.isArray(rep.steps)) continue;
      const k = `${rep.seed}|${rep.steps.join(' ')}`;
      if (!out.has(k)) out.set(k, { report: rep, first: r.nodeKey, last: r.nodeKey });
      else out.get(k).last = r.nodeKey;
    }
  }
  return [...out.values()];
}
export const readCalls = dir => (existsSync(path.join(dir, 'calls.jsonl')) ? readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const foundIds = s => Object.entries(s.perBug).filter(([, b]) => b.foundMin).map(([id]) => id).sort();

export async function rescoreRun(browser, dir, { truth, scoreReports }) {
  const meta = read(dir, 'meta.json'), final = read(dir, 'score.json');
  const log = emittedReports(readCalls(dir));
  const s = await scoreReports(browser, log.map(x => x.report), { truth });
  const ever = foundIds(s), fin = foundIds(final);
  const dropped = ever.filter(id => !fin.includes(id)).map(id => {
    const i = s.perReport.find(r => r.verdict === 'credited' && r.bug === id && r.minimal)?.index;
    return { bug: id, firstListed: log[i]?.first, lastListed: log[i]?.last, seed: log[i]?.report.seed, steps: log[i]?.report.steps };
  });
  return { run: path.basename(dir), arm: meta.arm, transport: meta.transport ?? null, usd: meta.cost?.spent ?? 0,
    final: { foundMin: fin.length, bugs: fin, reports: final.summary.reports, falseReports: final.summary.falseReports },
    ever: { foundMin: ever.length, bugs: ever, reports: log.length, falseReports: s.summary.falseReports, duplicates: s.summary.duplicates }, dropped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? path.join(ROOT, 'research/gameqa-20261021/runs');
  const { launchBrowser } = await import('../../beds/gameqa-web/driver.mjs');
  const { loadTruth, scoreReports } = await import('../../beds/gameqa-web/oracle.mjs');
  const truth = loadTruth(), browser = await launchBrowser();
  const rows = [];
  try {
    for (const name of readdirSync(dir).sort()) {
      const d = path.join(dir, name), meta = read(d, 'meta.json');
      if (!meta || !AGENT_ARMS.includes(meta.arm) || !read(d, 'score.json')) continue;
      const row = await rescoreRun(browser, d, { truth, scoreReports });
      console.error(row.run.padEnd(28), 'final', row.final.foundMin, `[${row.final.bugs}]`, '| ever listed', row.ever.foundMin, `[${row.ever.bugs}]`, 'false', row.ever.falseReports);
      rows.push(row);
    }
  } finally { await browser.close(); }
  const byArm = {};
  for (const r of rows) {
    const k = `${r.run.slice(0, r.run.indexOf(`-${r.arm}-r`))}/${r.arm}`;
    (byArm[k] ??= { final: [], ever: [], union: new Set(), usd: 0 });
    byArm[k].final.push(r.final.foundMin); byArm[k].ever.push(r.ever.foundMin); r.ever.bugs.forEach(b => byArm[k].union.add(b)); byArm[k].usd += r.usd;
  }
  const arms = Object.fromEntries(Object.entries(byArm).map(([k, v]) => [k, { final: v.final, ever: v.ever, unionAcrossRuns: [...v.union].sort(), usdTotal: Math.round(v.usd * 1e4) / 1e4 }]));
  console.log(JSON.stringify({ note: 'Report-log re-score (rescore-union.mjs): per agent-type run, foundMin of the final list vs of every report ever listed. Post hoc for the A1 runs; the A2 secondary metric foundMinEver for gqa1v/agent.', arms, runs: rows }, null, 1));
}
