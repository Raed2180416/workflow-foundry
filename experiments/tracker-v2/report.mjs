#!/usr/bin/env node
// Analyst report (no model call) over research/tracker-20261021/builder1: the numbers RESULT-TRACKER.md quotes.
//   capture   recall vs the frozen gold, per capture file (mechanical span matching, builder1.mjs scoreCapture)
//   bind      decisions per bind file; expressiveness = share of the gold's TESTABLE conditions that were captured AND got a check
//   arms      per judge file (v1 frozen, v2 deviation D2): T0, T2, T2noG3, T0+T2 caught / false alarms; per prose file: T1
//   status    abstention: statuses over every (build, condition), unknown by reason
//   cost      USD per request (capture, bind) and per build (T1), tokens for Mercury
//   node experiments/tracker-v2/report.mjs [--json out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadCases, wordsFor, scoreCapture, GOLD_FILE, archivedBuilds } from './builder1.mjs';

const { values: a } = parseArgs({ options: { dir: { type: 'string' }, json: { type: 'string' } } });
const dir = path.resolve(a.dir ?? 'research/tracker-20261021/builder1');
const readJson = f => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const files = readdirSync(dir).sort();
const gold = JSON.parse(readFileSync(GOLD_FILE, 'utf8'));
const cases = loadCases();
const fit = cases.filter(c => c.template !== 'none');
const r3 = x => Math.round(x * 1000) / 1000;
const out = { capture: {}, bind: {}, arms: {}, status: {}, cost: {} };

for (const f of files.filter(f => /^capture-.*\.json$/.test(f))) {
  const cap = readJson(f);
  let covered = 0, total = 0, tCov = 0, tTot = 0, captured = 0;
  for (const c of cases) { const s = scoreCapture(cap.cases[c.id] ?? [], gold.cases[c.id], wordsFor(c)); covered += s.covered; total += s.gold; tCov += s.testableCovered; tTot += s.testableGold; captured += s.captured; }
  out.capture[f] = { recall: r3(covered / total), covered, total, testableRecall: r3(tCov / tTot), captured, costUsd: cap.costUsd ?? 0, perRequestUsd: r3((cap.costUsd ?? 0) / cases.length * 1000) / 1000 };
}
for (const f of files.filter(f => /^bind-.*\.json$/.test(f))) {
  const b = readJson(f);
  const cap = readJson(b.capture);
  const dec = {};
  let testGold = 0, testGoldChecked = 0;
  for (const c of fit) {
    const list = b.cases[c.id] ?? [];
    for (const x of list) { const d = x.check ? 'check' : x.binding?.decision ?? 'none'; dec[d] = (dec[d] ?? 0) + 1; }
    const s = scoreCapture(cap.cases[c.id] ?? [], gold.cases[c.id], wordsFor(c));
    for (const row of s.rows.filter(r => r.testable)) { testGold++; if (row.covered && list.find(x => x.id === row.by)?.check) testGoldChecked++; }
  }
  out.bind[f] = { cases: Object.keys(b.cases).length, decisions: dec, expressiveness: r3(testGoldChecked / testGold), testableGold: testGold, testableGoldChecked: testGoldChecked,
    costUsd: b.costUsd, perRequestUsd: r3(b.costUsd / Math.max(1, Object.keys(b.cases).length) * 1000) / 1000, tokens: b.tokens ?? null, tokenMeter: b.tokenMeter ?? null };
}
const builds = archivedBuilds();
const bad = new Set(builds.filter(b => !b.verified).map(b => b.id));
const arm = flags => {
  const ids = Object.keys(flags).filter(id => flags[id] !== null && flags[id] !== undefined);
  const flagged = ids.filter(id => flags[id]);
  const caught = flagged.filter(id => bad.has(id)), fa = flagged.filter(id => !bad.has(id));
  return { builds: ids.length, defective: ids.filter(id => bad.has(id)).length, caught: caught.length, falseAlarms: fa.length, precision: flagged.length ? r3(caught.length / flagged.length) : null, falseAlarmIds: fa, caughtIds: caught };
};
for (const f of files.filter(f => /^judge-.*\.json$/.test(f))) {
  const j = readJson(f);
  const B = Object.entries(j.builds);
  const pick = fn => Object.fromEntries(B.map(([id, b]) => [id, fn(b)]));
  out.arms[f] = { T0: arm(pick(b => !b.t0.passed)), T2: arm(pick(b => b.tally.unmet > 0)), T2noG3: arm(pick(b => b.tallyNoG3.unmet > 0)), 'T0+T2': arm(pick(b => !b.t0.passed || b.tally.unmet > 0)),
    ...(B[0]?.[1]?.tallySolo ? { T2solo: arm(pick(b => b.tallySolo.unmet > 0)), 'T0+T2solo': arm(pick(b => !b.t0.passed || b.tallySolo.unmet > 0)) } : {}) };
  const st = { met: 0, unmet: 0, unknown: 0, waived: 0, unknownBy: {}, total: 0 };
  for (const [, b] of B) for (const s of Object.values(b.t2)) { st.total++; st[s.status]++; if (s.status === 'unknown') st.unknownBy[s.reason] = (st.unknownBy[s.reason] ?? 0) + 1; }
  out.status[f] = st;
}
for (const f of files.filter(f => /^prose-.*\.json$/.test(f))) {
  const p = readJson(f);
  out.arms[f] = { T1: arm(Object.fromEntries(Object.entries(p.builds).map(([id, r]) => [id, r.flagged]))) };
  out.cost[f] = { usd: p.costUsd, builds: Object.keys(p.builds).length, perBuildUsd: r3(p.costUsd / Math.max(1, Object.keys(p.builds).length) * 1000) / 1000, errors: Object.values(p.builds).filter(r => r.error).length };
}
if (a.json) writeFileSync(a.json, `${JSON.stringify(out, null, 1)}\n`);
for (const [f, x] of Object.entries(out.capture)) console.log(`capture ${f.padEnd(44)} recall ${x.recall} (${x.covered}/${x.total}) testable ${x.testableRecall} captured ${x.captured} $${x.costUsd}`);
for (const [f, x] of Object.entries(out.bind)) console.log(`bind    ${f.padEnd(58)} expressiveness ${x.expressiveness} (${x.testableGoldChecked}/${x.testableGold}) ${JSON.stringify(x.decisions)} $${x.costUsd}${x.tokenMeter ? ` tokens ${JSON.stringify(x.tokenMeter)}` : ''}`);
for (const [f, x] of Object.entries(out.arms)) for (const [k, s] of Object.entries(x)) console.log(`arm     ${f.padEnd(58)} ${k.padEnd(7)} caught ${String(s.caught).padStart(2)}/${s.defective} FA ${String(s.falseAlarms).padStart(2)} of ${s.builds - s.defective} good  precision ${s.precision}`);
for (const [f, s] of Object.entries(out.status)) console.log(`status  ${f.padEnd(58)} met ${s.met} unmet ${s.unmet} unknown ${s.unknown} (${(s.unknown / s.total).toFixed(2)}) ${JSON.stringify(s.unknownBy)}`);
for (const [f, c] of Object.entries(out.cost)) console.log(`cost    ${f.padEnd(58)} $${c.usd} for ${c.builds} builds = $${c.perBuildUsd}/build, errors ${c.errors}`);
