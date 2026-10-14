// Rule CR-W (PREREG-WBED-SLICE1 §7.1) after the 2026-10-14 review: findings 4 (a task-only CI at K = 2 is valid only
// for the realized builds) and 9 (a late spend stop voided every cost decision). $0; deterministic seeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { steadyUsd, pairsOf, crw, decideRuns, simulate, planning, killRuleTable, CR_LEVEL, SIGMA_LINEAGE, PLANNED_STEADY } from './crw.mjs';
import { runStream, POLICY_MODELS } from '../../../../experiments/jit/stream.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} ± ${tol}`);

test('steady-state $ excludes compile spend, keeps compiled runs, shadows and adjudication (PREREG §6)', () => {
  assert.equal(steadyUsd({ costUsd: 5, costBreakdown: { compile: 3, 'compile-fallback': 1, compiled: 0.2, shadow: 0.5, adjudicator: 0.3 } }), 1);
  assert.equal(steadyUsd({ costUsd: 0.12 }), 0.12);
});

test('finding 9: pairs are the intersection inside idx 3–23, and V needs 75% of the 21 planned tasks in every stream', () => {
  const rows = (n, c, skip = []) => Array.from({ length: n }, (_, idx) => ({ idx, costUsd: c })).filter(r => !skip.includes(r.idx));
  // X stopped by its cap after idx 18 in stream A (16 steady tasks paired), complete in B.
  const a = pairsOf(rows(19, 1), rows(24, 2), { stream: 'A' }), b = pairsOf(rows(24, 1), rows(24, 2), { stream: 'B' });
  assert.equal(a.length, 16); assert.equal(b.length, PLANNED_STEADY);
  assert.deepEqual([a[0].idx, a.at(-1).idx], [3, 18]);
  const ok = crw([...a, ...b], { iterations: 500 });
  assert.equal(ok.need, 16); assert.equal(ok.checks.V, true, 'a stop after 16 of 21 steady tasks does not void the decision');
  const short = pairsOf(rows(18, 1), rows(24, 2), { stream: 'A' });
  assert.equal(short.length, 15);
  const bad = crw([...short, ...b], { iterations: 500 });
  assert.equal(bad.checks.V, false); assert.equal(bad.verdict.conditional, 'directional, no decision');
  assert.equal(crw([...a, ...b], { iterations: 500, invalid: ['X@A'] }).verdict.process, 'invalid');
});

test('CR-W verdicts: conditional and process; F needs every stream on the pooled side; K = 1 never decides', () => {
  const mk = (stream, r, n = 21) => Array.from({ length: n }, (_, i) => ({ stream, idx: i + 3, x: r * (1 + 0.1 * Math.sin(i)), y: 1 + 0.1 * Math.sin(i) }));
  // A large ratio (×6 in both streams): both verdicts decide "dearer".
  const big = crw([...mk('A', 6), ...mk('B', 6)], { iterations: 2000 });
  assert.equal(big.verdict.conditional, 'X dearer than Y'); assert.equal(big.verdict.process, 'X dearer than Y');
  // ×2 in both streams with tiny task noise: decided for these builds, not as a process (the lineage floor).
  const mid = crw([...mk('A', 2), ...mk('B', 2)], { iterations: 2000 });
  assert.equal(mid.verdict.conditional, 'X dearer than Y'); assert.equal(mid.verdict.process, 'directional, no decision');
  assert.ok(mid.ci.process.lo < mid.ci.conditional.lo && mid.ci.process.hi > mid.ci.conditional.hi);
  near(mid.ci.sigmaP, SIGMA_LINEAGE * Math.sqrt(1 / 2), 1e-12, 'σ_P = σ_L √(n_L / K)');
  // Two lineage-built arms widen further.
  const two = crw([...mk('A', 2), ...mk('B', 2)], { iterations: 2000, lineageArms: 2 });
  assert.ok(two.ci.process.hi - two.ci.process.lo > mid.ci.process.hi - mid.ci.process.lo);
  // Streams on opposite sides: F fails.
  const split = crw([...mk('A', 3), ...mk('B', 0.9)], { iterations: 1000 });
  assert.equal(split.checks.F, false); assert.equal(split.verdict.conditional, 'directional, no decision');
  assert.equal(crw(mk('A', 6), { iterations: 500 }).checks.K, false);
  near(CR_LEVEL, 1 - 0.05 / 3, 1e-12, 'Bonferroni over CR1–CR3');
});

test('finding 4: under the null with an unseen lineage effect (σ_L = 0.5), task-only decisions are about the builds, and the process verdict holds its level', () => {
  const s = simulate({ sigmaLineage: 0.5, sigmaTask: 0.5, lineageArms: 1, trials: 400, iterations: 200 });
  // The review's measurement: read as a process claim, the task-only rule decides about a fifth of the time (crw-sim 21%).
  assert.ok(s.conditionalDecided >= 0.08, `task-only rule decides often: ${s.conditionalDecided}`);
  // Read as a claim about the two realized builds, those decisions are right.
  assert.ok(s.conditionalWrongSign <= 0.02, `conditional wrong sign: ${s.conditionalWrongSign}`);
  // The process verdict with the declared floor stays at or below the nominal 1.67% (plus simulation slack).
  assert.ok(s.processDecided <= 0.03, `process false decisions: ${s.processDecided}`);
  const z = simulate({ sigmaLineage: 0, sigmaTask: 0.5, lineageArms: 1, trials: 300, iterations: 200 });
  assert.ok(z.conditionalDecided <= 0.03 && z.processDecided <= 0.02, JSON.stringify(z));
});

test('planning projection from R0 records reproduces the PREREG §7.1 numbers', () => {
  const p = planning();
  assert.equal(p.pairs, 9);
  near(p.hhSteadyUsdPerTask, 0.118, 0.0005, 'H/H steady $'); near(p.agentUsdPerTask, 0.0614, 0.0005, 'agent $'); near(p.ratio, 1.92, 0.01, 'ratio');
  near(p.conditional.se, 0.194, 0.01, 'conditional SE'); near(p.conditional.mde80.above, 1.87, 0.05, 'conditional MDE');
  near(p.process.oneLineageArm.se, 0.403, 0.01, 'process SE, one arm'); near(p.process.oneLineageArm.mde80.above, 3.69, 0.15, 'process MDE, one arm');
  near(p.process.twoLineageArms.mde80.above, 5.67, 0.25, 'process MDE, two arms');
  assert.ok(p.process.oneLineageArm.ci9833.lo < 1, 'R0\'s ratio would not be decided at the process level');
});

test('kill rule KR-1 table (PREREG §9.1)', () => {
  const t = killRuleTable(), at = (g, p) => t.find(r => r.trueGap === g && r.pRef === p);
  near(at(-0, 0.6).perLineage, 0.071, 0.001, 'false kill, pRef 0.6'); near(at(-0, 0.8).pooled, 0.182, 0.001, 'pooled false kill, pRef 0.8');
  near(at(-0.1, 0.8).perLineage, 0.197, 0.001, '10-point gap'); near(at(-0.3, 0.9).pooled, 0.953, 0.001, '30-point gap pooled');
});

test('decideRuns reads two stream run directories (stream.mjs layout): pairs, verdicts, and the truncation rule', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'crw-runs-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const solve = path.join(root, 'S', 'solve.mjs'); mkdirSync(path.dirname(solve)); writeFileSync(solve, '// static\n');
  const deps = {
    policyIds: [...POLICY_MODELS], outputSchema: { type: 'object' },
    makeTasks: async (familyId, { split, seeds, difficulty }) => seeds.map(seed => ({ familyId, task: { id: `fake:${seed}`, seed, split, difficulty, prompt: 'p', inputs: { seed } }, taskKey: `fake:${split}:d${difficulty}:s${seed}`, taskHash: `h${seed}` })),
    createModelPort: () => ({ port: { fake: true } }),
    score: async (f, task, output) => ({ pass: output?.v === task.seed, score: 1 }),
    interpret: async a => ({ traceId: a.traceId, answer: { v: a.task.seed }, costUsd: 0.1 + 0.01 * (a.task.seed % 3), costUnknown: false, error: null, scripts: [], commands: [] }),
    runCompiled: async a => ({ status: 'ok', output: { v: a.task.seed }, trace: [], costUsd: 0.01 + 0.001 * (a.task.seed % 2), costUnknown: false, latencyMs: 1, meta: { errors: {} } }),
  };
  const agent = 'agent:claude-haiku-5-5', stat = `static:${solve}`, dirs = [];
  for (const [s, base] of [['a', 1], ['b', 101]]) {
    const config = { experiment: `crw-${s}`, familyId: 'fake', split: 'dev', segments: [{ difficulty: 3, seeds: Array.from({ length: 24 }, (_, i) => base + i) }], arms: [agent, stat],
      perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, concurrency: 2 };
    await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
    dirs.push(path.join(root, 'runs', `crw-${s}`));
  }
  const r = await decideRuns(stat, agent, dirs);
  assert.equal(r.lineageArms, 0); assert.equal(r.pooled.n, 42); assert.ok(r.validity.every(v => v.status === 'valid'));
  assert.equal(r.verdict.conditional, 'X cheaper than Y'); assert.equal(r.verdict.process, 'X cheaper than Y', 'no lineage-built arm: the two verdicts agree');
  // The static arm of stream A loses its last 7 rows (as after a spend stop): 7/24 > 25% missing = invalid: truncated.
  const res = path.join(dirs[0], 'static-S-solve', 'results.jsonl');
  writeFileSync(res, readFileSync(res, 'utf8').split('\n').filter(Boolean).filter(l => JSON.parse(l).idx < 17).join('\n') + '\n');
  const cut = await decideRuns(stat, agent, dirs, { lineageArms: 1 });
  assert.deepEqual(cut.validity.find(v => v.arm === stat && v.stream === 'A'), { arm: stat, stream: 'A', planned: 24, impaired: 0, missingOther: 7, status: 'invalid: truncated' });
  assert.equal(cut.verdict.conditional, 'invalid'); assert.equal(cut.pooled.n, 35);
});
