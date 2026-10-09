// stats.mjs at $0: exact tests reproduce the hand computations on nversion-records-dev.json (critique V22: Fisher
// p ≈ 0.032, Wilson 74–98% for 22/24, McNemar p = 0.22 on a 5/1 split); the power table formula; the clustered CI and
// the decision rule; the 25% env-fault rule; the IPW miss estimate; report.mjs's new sections; the verification-policy
// simulator's determinism and its dispute-only bias.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_FAULTS } from '../../lib/runner.mjs';
import {
  binomTwoSided, mcnemarExact, fisherUpper, wilson, normCdf, normQuantile, designEffect, pairedPower, powerTable, minimumDetectable, renderPowerTable,
  pairRows, bootstrapCIs, pairedComparison, decide, envFaultCheck, ipwMissEstimate, hypergeomTotalCI, ENV_FAULT_CODES, FLOOR_POINTS, RHO_PREREG, DECISION_RULE,
} from '../stats.mjs';
import { buildReport, renderMarkdown } from '../report.mjs';
import { simulate, loadTasks } from '../../../research/jit-20261008/analysis/verification-policy-sim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const nv = JSON.parse(readFileSync(path.join(here, '../../../research/jit-20261008/nversion-records-dev.json'), 'utf8'));
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg ?? ''}: ${a} != ${b}`);

test('reproduces the critique hand computations on nversion-records-dev.json', () => {
  // opusV2 and sonnetV1: both answered 20 tasks, wrong on 5 and 4, jointly on 3 (synthesis §1; critique V22).
  const both = nv.rows.filter(r => r.runs.opusV2.status === 'ok' && r.runs.sonnetV1.status === 'ok');
  const wO = both.filter(r => !r.runs.opusV2.pass).length, wS = both.filter(r => !r.runs.sonnetV1.pass).length;
  const joint = both.filter(r => !r.runs.opusV2.pass && !r.runs.sonnetV1.pass).map(r => r.taskKey.split(':').at(-1));
  assert.deepEqual([both.length, wO, wS, joint.length], [20, 5, 4, 3]);
  assert.deepEqual(joint, ['s214', 's223', 's224']);
  close(wO * wS / both.length, 1.0, 1e-9, 'expected joint failures under independence');
  close(fisherUpper(3, 5, 4, 20), 0.0320, 5e-5, 'one-sided Fisher');
  // Wilson for the S/H stream's 22/24 (HANDOFF §2): 74–98%.
  const w = wilson(22, 24); close(w.lo, 0.741, 1e-3, 'Wilson lo'); close(w.hi, 0.977, 1e-3, 'Wilson hi');
  // Exact McNemar on dossier 1's 5/1 split: 14/64.
  close(mcnemarExact(5, 1).p, 14 / 64, 1e-12, 'McNemar 5/1');
  // Summary counts the synthesis cites: 7 unanimous (6 correct), 67 answers of which 24 wrong.
  assert.deepEqual([nv.summary.unanimous.n, nv.summary.unanimous.pass], [7, 6]);
  const answers = nv.rows.flatMap(r => Object.values(r.runs)).filter(x => x.status === 'ok');
  assert.deepEqual([answers.length, answers.filter(x => !x.pass).length], [67, 24]);
});

test('exact binomial and McNemar edge cases', () => {
  assert.equal(binomTwoSided(0, 0), 1);
  assert.equal(mcnemarExact(0, 0).p, 1);
  close(binomTwoSided(0, 6), 2 / 64, 1e-12);
  assert.equal(binomTwoSided(3, 6), 1);
  close(mcnemarExact(1, 5).p, mcnemarExact(5, 1).p, 1e-15, 'symmetric');
  close(normCdf(1.959964), 0.975, 1e-6); close(normQuantile(0.8), 0.841621, 1e-5);
});

test('the env-fault codes match runner.mjs ENV_FAULTS', () => {
  assert.deepEqual([...ENV_FAULT_CODES].sort(), [...ENV_FAULTS].sort());
});

test('power table: the stated formula, Deff = 1 + (m − 1)ρ, K = 1 never decides', () => {
  close(designEffect(24, 0.1), 3.3, 1e-12); close(designEffect(24, 0.3), 7.9, 1e-12);
  const c = pairedPower({ K: 2, m: 24, delta: 0.10, rho: 0 });
  // pX .85, pY .75: ψ = .85·.25 + .75·.15 = .325; Var = .315; SE = sqrt(.315/48)
  close(c.psi, 0.325, 1e-12); close(c.se, Math.sqrt(0.315 / 48), 1e-12);
  close(c.test, normCdf(0.1 / c.se - 1.959964) + normCdf(-0.1 / c.se - 1.959964), 1e-6);
  assert.equal(pairedPower({ K: 1, delta: 0.1, rho: 0 }).rule, 0);
  const t = powerTable();
  assert.equal(t.cells.length, 3 * 4 * 3);
  // Power never rises with ρ; no cell at δ <= 10 points reaches 80% for K <= 4.
  for (const K of [2, 3, 4]) for (const d of [0.03, 0.05, 0.1]) {
    const p = [0, 0.1, 0.3].map(rho => t.cells.find(x => x.K === K && x.delta === d && x.rho === rho).rule);
    assert.ok(p[0] >= p[1] && p[1] >= p[2]);
    assert.ok(p.every(x => x < 0.8));
  }
  const mde = minimumDetectable({ K: 2, rho: 0 });
  assert.ok(mde > 0.15 && mde < 0.3, `MDE ${mde}`);
  assert.match(renderPowerTable(t), /\| 0\.1 \| 3\.3 \| 2 \|/);
});

const rowsOf = (passes, extra = {}) => passes.map((p, idx) => ({ idx, taskKey: `records:test:d3:s${8001 + idx}`, pass: !!p, ...extra }));

test('pairing, clustered CI (wider of cluster bootstrap and Deff-widened task bootstrap) and both units', () => {
  const jit = rowsOf([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1]), agent = rowsOf([1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0]);
  const pairs = pairRows(jit, agent, { stream: 'A', armX: 'jit:s/h', armY: 'agent:haiku' });
  assert.equal(pairs.length, 12); assert.ok(pairs.every(p => p.cluster === 'A::jit:s/h' && p.jit));
  const c = pairedComparison(pairs, { iterations: 2000 });
  assert.equal(c.gapTasks, 3); close(c.gapPoints, 25, 1e-9);
  assert.deepEqual([c.mcnemar.xOnly, c.mcnemar.yOnly], [4, 1]);
  assert.equal(c.ci.deff, designEffect(12, RHO_PREREG));
  assert.ok(c.ci.lo <= c.ci.deffWidened.lo + 1e-12 && c.ci.lo <= c.ci.clusterBootstrap.lo + 1e-12);
  assert.ok(c.ci.deffWidened.hi - c.ci.deffWidened.lo > c.ci.iidBootstrap.hi - c.ci.iidBootstrap.lo, 'widened');
  // Two agents: the cluster is the task and no Deff applies.
  const aa = pairedComparison(pairRows(agent, jit, { armX: 'agent:a', armY: 'agent:b' }), { iterations: 500 });
  assert.equal(aa.ci.deff, 1); assert.equal(aa.ci.clusters, 12);
  // Deterministic for a fixed seed.
  assert.deepEqual(bootstrapCIs(pairs, { iterations: 300, seed: 's' }), bootstrapCIs(pairs, { iterations: 300, seed: 's' }));
});

test('decision rule: K >= 2, floor in every stream, McNemar, clustered CI, env faults', () => {
  const big = s => pairRows(rowsOf(Array(24).fill(1)), rowsOf(Array.from({ length: 24 }, (_, i) => (i % 2 ? 1 : 0))), { stream: s, armX: 'jit:x', armY: 'agent:y' });
  const one = decide(big('A'), { iterations: 1000 });
  assert.equal(one.verdict, 'directional, no decision'); assert.deepEqual(one.failed, ['K']);
  const two = decide([...big('A'), ...big('B')], { iterations: 1000 });
  assert.equal(two.verdict, 'effect: X better', JSON.stringify(two.checks)); assert.equal(two.rule, DECISION_RULE);
  assert.match(two.units, /\+24 tasks over 48 paired tasks \(50\.0 points\)/);
  // Stream B reversed: the floor fails in a stream (and the pooled gap vanishes).
  const rev = pairRows(rowsOf(Array.from({ length: 24 }, (_, i) => (i % 2 ? 1 : 0))), rowsOf(Array(24).fill(1)), { stream: 'B', armX: 'jit:x', armY: 'agent:y' });
  const mixed = decide([...big('A'), ...rev], { iterations: 500 });
  assert.equal(mixed.verdict, 'directional, no decision'); assert.ok(mixed.failed.includes('F'));
  // A 2-task gap per stream (8.3 points) clears the point floor but not the test.
  const small = s => pairRows(rowsOf(Array.from({ length: 24 }, (_, i) => (i < 20 ? 1 : 0))), rowsOf(Array.from({ length: 24 }, (_, i) => (i < 18 ? 1 : 0))), { stream: s, armX: 'jit:x', armY: 'agent:y' });
  const s2 = decide([...small('A'), ...small('B')], { iterations: 500 });
  assert.equal(s2.checks.F, true); assert.equal(s2.checks.T, false); assert.equal(s2.verdict, 'directional, no decision');
  assert.equal(s2.pooled.taskRule, false, 'report.mjs task rule would call 2 tasks noise; shown, not applied');
  assert.equal(decide([...big('A'), ...big('B')], { invalid: ['jit:x@B'], iterations: 200 }).verdict, 'invalid: env faults');
  assert.equal(FLOOR_POINTS, 3);
});

test('env-fault rule: unresolved (JIT stream stops at the fault), degraded verification, resolved faults, 25% limit', () => {
  const rows = n => Array.from({ length: n }, (_, idx) => ({ idx, arm: 'jit:a/b', events: [] }));
  // Fault at #18 stops the stream: 6 of 24 unresolved = 25%, not above the limit.
  let e = envFaultCheck({ rows: rows(18), faults: [{ idx: 18, error: { code: 'MODEL_RATE_LIMIT' } }], planned: 24, kind: 'jit' });
  assert.deepEqual([e.impaired, e.invalid, e.verdict], [6, false, 'valid']); assert.deepEqual(e.byCode, { MODEL_RATE_LIMIT: 1 });
  // At #17: 7 of 24 > 25%.
  e = envFaultCheck({ rows: rows(17), faults: [{ idx: 17, error: { code: 'MODEL_UNAVAILABLE' } }], planned: 24, kind: 'jit' });
  assert.deepEqual([e.impaired, e.invalid, e.verdict], [7, true, 'invalid: env faults']);
  // Faults a resume resolved count as events, not impaired tasks; a shadow fault degrades its row; transient retries reported.
  const r = rows(24); r[3].events = [{ kind: 'shadow-fault' }]; r[4].events = [{ kind: 'fault-retry' }];
  e = envFaultCheck({ rows: r, faults: Array.from({ length: 8 }, (_, i) => ({ idx: i + 10, metaErrors: { SANDBOX_UNAVAILABLE: 1 } })), planned: 24, kind: 'jit' });
  assert.deepEqual([e.impaired, e.degraded, e.unresolved, e.faultEvents, e.transientRetries, e.stressed, e.invalid], [1, [3], [], 8, 1, true, false]);
  // Agent arm: a missing row without a fault is missingOther, not env.
  e = envFaultCheck({ rows: rows(24).filter(x => x.idx !== 5).map(x => ({ ...x, arm: 'agent:h' })), faults: [], planned: 24, kind: 'agent' });
  assert.deepEqual([e.impaired, e.missingOther], [0, [5]]);
});

test('IPW miss estimate: HT point, exact finite-population strata', () => {
  const all = Array.from({ length: 10 }, (_, i) => ({ verified: true, propensity: 1, wrong: i < 3 }));
  assert.deepEqual(ipwMissEstimate(all), { deliveries: 10, verified: 10, misses: 3, rate: 0.3, lo: 0.3, hi: 0.3 });
  const half = Array.from({ length: 10 }, (_, i) => ({ verified: i % 2 === 0, propensity: 0.5, wrong: i < 4 }));
  const e = ipwMissEstimate(half);   // verified 0, 2, 4, 6, 8: wrong 0 and 2
  close(e.rate, 0.4, 1e-12); assert.ok(e.lo <= 0.4 && e.hi >= 0.4 && e.lo >= 0.2);
  assert.deepEqual(hypergeomTotalCI(0, 0, 7), { lo: 0, hi: 7 }); assert.deepEqual(hypergeomTotalCI(2, 5, 5), { lo: 2, hi: 2 });
  const sup = ipwMissEstimate(half, { finite: false }); assert.ok(sup.hi - sup.lo > 0);
});

test('report.mjs prints both units, names the rule applied, and the env-fault table', t => {
  const runDir = mkdtempSync(path.join(tmpdir(), 'jit-stats-')); t.after(() => rmSync(runDir, { recursive: true, force: true }));
  const arm = (spec, slug, kind, passes) => {
    const dir = path.join(runDir, slug); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'arm.json'), JSON.stringify({ experiment: 'e', spec, slug, kind }));
    writeFileSync(path.join(dir, 'results.jsonl'), passes.map((p, idx) => JSON.stringify({ experiment: 'e', arm: spec, kind, idx, taskKey: `records:dev:d3:s${201 + idx}`, pass: !!p, costUsd: 0.1, delivered: kind === 'agent' ? 'interpreter' : 'compiled', events: [] })).join('\n') + '\n');
  };
  arm('agent:claude-haiku-5-5', 'agent-h', 'agent', [1, 0, 1, 0, 1, 1, 0, 1]);
  arm('jit:claude-sonnet-5-5/claude-haiku-5-5', 'jit-sh', 'jit', [1, 1, 1, 1, 1, 1, 1, 0]);
  const rep = buildReport(runDir), jit = rep.arms.find(a => a.kind === 'jit');
  const p = jit.paired['agent:claude-haiku-5-5'];
  assert.equal(p.gapTasks, 2); close(p.gapPoints, 25, 1e-9); assert.equal(p.taskRuleClears, false); assert.equal(p.pointFloorClears, true);
  assert.match(p.verdict, /directional, no decision/);
  assert.equal(jit.envFaults.verdict, 'valid');
  assert.deepEqual(jit.vsAgents['agent:claude-haiku-5-5'], { successGap: 2, successRateGap: 0.25, noise: true }, 'old field unchanged');
  const md = renderMarkdown(rep);
  assert.match(md, /## Paired comparison, both units/); assert.match(md, /## Environment faults \(PREREG §6 rule\)/);
  assert.match(md, /K=1 stream per arm: any success gap under 3 points/); assert.match(md, /rule applied is the PREREG decision rule/);
});

test('verification-policy simulator: deterministic, dispute-only bias, IPW floor unbiased', () => {
  const tasks = loadTasks();
  assert.equal(tasks.length, 24);
  const a = simulate({ tasks, draws: 300, epsilons: [0.25] }), b = simulate({ tasks, draws: 300, epsilons: [0.25] });
  assert.deepEqual(a, b);
  const row = (p, s, eps = null) => a.rows.find(r => r.policy === p && r.solver === s && r.eps === eps);
  // opusV2: 9 wrong of 24 deliveries, 5 of them on undisputed tasks (s214, unanimous, and the d4 singletons s217, s218, s220, s222) -> naive bias −5/24.
  assert.deepEqual([a.truth.opusV2.wrong, a.truth.opusV2.wrongUndisputed], [9, 5]);
  close(row('dispute-only', 'opusV2').bias, -5 / 24, 1e-12);
  assert.ok(Math.abs(row('floor', 'opusV2', 0.25).bias) < 0.03);
  assert.ok(row('floor', 'opusV2', 0.25).calls > row('dispute-only', 'opusV2').calls);
});
