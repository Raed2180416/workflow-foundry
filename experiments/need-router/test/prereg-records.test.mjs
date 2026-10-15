// Regression tests for the review's blocker B2 ("the preregistration is stale against M1"): every figure PREREG §0.1,
// §12 and §13 and stages.json record for M1 (tags m1, m1-d5) and M1-R (tag m1-r) is recomputed here from the committed
// rows, so a record that drifts from its run, or a run that changes under its record, fails a test. $0: reads M1's
// committed development rows (dev attack seeds 379-390 and 479-490, one call per task; not need-router labels) and git
// objects; no model, no bed, no held-out or sealed file.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { capMeter, hasObservedCost } from '../prereg-rules.mjs';
import { STAGES_FILE, PREREG_FILE, sectionOf, sha256 } from '../prereg-check.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNS = path.join(REPO, 'research/need-router-20261014/runs');
const STAGES = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
const TEXT = readFileSync(PREREG_FILE, 'utf8');
const rowsOf = (tag, file = 'results.jsonl') => readFileSync(path.join(RUNS, tag, file), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const r4 = x => Math.round(x * 1e4) / 1e4;
const reported = rows => r4(rows.reduce((a, r) => a + (r.costUsd ?? 0) + (r.imputedUsd ?? 0), 0));
const EFFORT = { 'b0-call-haiku-none': 0, 'b0-call-haiku-medium': 1 };
/** "a/12, b/12" per family (efforts none, medium), from rows. */
function passPerEffort(rows) {
  const by = {};
  for (const r of rows) { const x = (by[r.family] ??= [[0, 0], [0, 0]]); const e = EFFORT[r.arm]; x[e][0] += r.pass ? 1 : 0; x[e][1] += 1; }
  return Object.fromEntries(Object.entries(by).map(([f, x]) => [f, x.map(([p, n]) => `${p}/${n}`).join(', ')]));
}
const M1 = STAGES.stages.find(s => s.id === 'M1'), M1R = STAGES.stages.find(s => s.id === 'M1-R');
const gitShow = (commit, file) => { try { return execFileSync('git', ['show', `${commit}:${file}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };

test('review B2: the M1 records (tags m1 and m1-d5) match their committed rows: calls, pass counts, reported dollars, §12 meter', () => {
  for (const tag of ['m1', 'm1-d5']) {
    const o = M1.observed[tag], rows = rowsOf(tag);
    assert.equal(o.status, 'complete', tag);
    assert.equal(rows.length, o.calls, `${tag} calls`);
    assert.equal(reported(rows), o.reportedUsd, `${tag} reported dollars`);
    assert.equal(rows.filter(r => r.error?.code === 'MODEL_TIMEOUT' && !hasObservedCost(r)).length, o.timeoutRowsAtZero, `${tag} timeouts booked at $0`);
    assert.equal(r4(capMeter(rows, { bound: 1 }).meterUsd), o.meterUsd, `${tag} on the §12 meter ($1 per-call bound)`);
    assert.deepEqual(passPerEffort(rows), o.onePassPerEffort, `${tag} one-call passes per effort`);
    const ats = rows.map(r => r.at).sort();
    assert.equal(ats[0].slice(0, 19), o.firstRow.slice(0, 19), `${tag} first row`);
    assert.equal(ats.at(-1).slice(0, 19), o.lastRow.slice(0, 19), `${tag} last row`);
    assert.ok(o.meterUsd > M1.capShares[tag], `${tag} overran its share on the meter, and §13 records it`);
  }
  // Every M1-d5 row is at d5 on the four rungs it names; the d5 gate reading follows from the counts.
  assert.ok(rowsOf('m1-d5').every(r => r.taskKey.split(':')[2] === 'd5'));
  assert.match(M1.observed['m1-d5'].gates.wbedAdmission, /passed for R2, R3 and R6 .*failed for R3'/);
  // The text carries the same figures (§0.1, §12, §13 D3).
  const total = r4(M1.observed.m1.meterUsd + M1.observed['m1-d5'].meterUsd), rep = r4(M1.observed.m1.reportedUsd + M1.observed['m1-d5'].reportedUsd);
  assert.equal(total, 62.9156);
  for (const s of ['$33.9199', `$${total}`, `$${rep}`]) assert.ok(sectionOf(TEXT, /^### 0\.1\b/m).includes(s) && sectionOf(TEXT, /^## 13\./m).includes(s), s);
  assert.match(sectionOf(TEXT, /^### 0\.1\b/m), /R3′ \(`r3p`\) 10\/12 and 11\/12/);
});

test('review B2: M1-R is recorded as its own stage and matches its rows: outcomes, merged labels, reported dollars, §12 meter with set-aside attempts', () => {
  const o = M1R.observed['m1-r'], rows = rowsOf('m1-r'), merged = rowsOf('m1-r', 'merged.jsonl');
  assert.equal(rows.length, o.calls);
  assert.equal(reported(rows), o.reportedUsd);
  assert.equal(r4(o.attempts[1].reportedUsd.first + o.attempts[1].reportedUsd.resume), o.reportedUsd, 'attempt 2 and its resume make up the reported figure');
  const meter = capMeter(rows, { bound: 1 });
  assert.equal(meter.noCostRows, o.timeoutRowsAtZero);
  assert.equal(r4(meter.meterUsd), o.meterUsd);
  assert.equal(r4(o.meterUsd + o.setAsideRowsAtZero * 1), o.meterWithSetAsideUsd, 'set-aside attempts at their $1 bound (§12)');
  assert.ok(o.meterWithSetAsideUsd > M1R.capUsd, 'over the plan cap on the strict meter: deviation D7 says so');
  // Every re-run trial is one of M1's timeouts, with the same arm hash and task hash.
  const timeouts = new Map([...rowsOf('m1'), ...rowsOf('m1-d5')].filter(r => r.error?.code === 'MODEL_TIMEOUT').map(r => [`${r.arm}|${r.taskKey}`, r]));
  assert.equal(timeouts.size, 54);
  for (const r of rows) { const src = timeouts.get(`${r.arm}|${r.taskKey}`); assert.ok(src, r.taskKey); assert.equal(r.armHash, src.armHash); assert.equal(r.taskHash, src.taskHash); }
  assert.ok(!rows.some(r => r.family === 'wbed-r3p'), 'M1-R ran no r3p task');
  // Outcomes as recorded.
  const count = f => rows.filter(f).length;
  assert.deepEqual({ pass: count(r => r.pass), failWithAnswer: count(r => !r.pass && !r.error), MODEL_TIMEOUT: count(r => r.error?.code === 'MODEL_TIMEOUT'), MODEL_SCHEMA: count(r => r.error?.code === 'MODEL_SCHEMA') }, o.outcomes);
  assert.deepEqual(rows.filter(r => r.pass).map(r => `${r.taskKey} ${r.arm.replace('b0-call-haiku-', '')}`).sort(), [...o.passes].sort());
  assert.equal(count(r => r.error?.code === 'MODEL_RATE_LIMIT'), 0, 'the rate-limited trials were re-run; none is left in the rows');
  // Labels: tasks one call solves at either effort, before (m1 + m1-d5) and after the merge (m1r).
  const solved = rs => { const by = new Map(); for (const r of rs) by.set(r.taskKey, (by.get(r.taskKey) ?? false) || !!r.pass); return [[...by.values()].filter(Boolean).length, by.size]; };
  assert.deepEqual(solved([...rowsOf('m1'), ...rowsOf('m1-d5')]), [61, 144]);
  assert.deepEqual(solved(merged), [65, 144]);
  assert.match(o.labels, /61\/144 .* 65\/144/);
  // The runner sha is the file at its recorded commit; the text names the stage, the tag and the figures.
  const commit = o.committedRunner.split(' ')[0], src = gitShow(commit, 'experiments/need-router/m1-rerun.mjs');
  if (src !== null) assert.equal(sha256(src), o.m1RerunSha256);
  const s01 = sectionOf(TEXT, /^### 0\.1\b/m), s13 = sectionOf(TEXT, /^## 13\./m);
  for (const s of ['$7.8934', '$17.8934', '$25.8934', '61/144 to 65/144']) assert.ok(s01.includes(s), s);
  assert.match(s13, /D7\. M1-R, an unregistered one-call run after M1 was\s+closed/);
  assert.match(s13, /\$25\.8934 with the 8 set-aside\s+attempts/);
});

test('review B2: the runner shas recorded per tag are the runner files at their recorded commits', () => {
  for (const [tag, commitField] of [['m1', 'engine'], ['m1-d5', 'committedRunner']]) {
    const o = M1.observed[tag];
    const commit = tag === 'm1' ? 'e5defed' : o[commitField].split(' ')[0];
    const src = gitShow(commit, 'experiments/need-router/m1-run.mjs');
    if (src === null) continue; // a shallow clone without the commit: nothing to compare
    assert.equal(sha256(src), o.m1RunSha256, tag);
  }
  // Records name only files that exist in the repository or are explicitly outside it.
  for (const f of [M1.observed.m1.report, M1R.observed['m1-r'].report]) assert.ok(existsSync(path.join(REPO, f)), f);
});
