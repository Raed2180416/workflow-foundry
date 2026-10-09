// B7-E6 (BLOCKER-SYNTHESIS row 50): is the JIT adjudication verdict independent of comparison order when the comparator
// is not transitive? The archived shadow/adjudication triples are lost, so this constructs one at $0.
//
// The adjudication under test is stream.mjs runJitTask (read-only here; the stream runs with scripted fakes, as in
// stream.test.mjs): compiled answer c; shadow s1 (fresh interpreter session); if s1 ~ c, agree. Otherwise adjudicator s2
// and the checks run in a fixed order: first s2 ~ c ('compiled' wins), then s2 ~ s1 ('interpreter' wins, a regression is
// recorded), else 'unresolved'. With the tolerant comparator (compare.mjs, relTol 0.01) "~" is not transitive:
// L = 1.000, M = 1.009, H = 1.018 give L ~ M and M ~ H but not L ~ H.
//
// Findings this file pins down (it documents current behaviour; it does not change the implementation):
// 1. The verdict DOES depend on the order of the two adjudication checks. On c = L, s1 = H, s2 = M both checks are true
//    (M sits within tolerance of both ends), and the code's order makes 'compiled' win. The other order would deliver
//    s1 and record a regression. The tie is broken in favour of the compiled answer (dossier 2 §B7.1 predicted this).
// 2. Swapping the two interpreter draws (s1 <-> s2, which are exchangeable fresh sessions) never changes the delivered
//    answer for this triple: all 6 role assignments deliver c. What changes is the event trail (agree vs adjudicated)
//    and whether a shadow trace joins the compile pool.
// 3. nversion.mjs (the N-version probe) groups answers by an exact canonical key, which is an equivalence relation, so its
//    majority cannot depend on order. It runs on import (a CLI script), so it is not imported here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runStream, sameAnswer, POLICY_MODELS } from '../stream.mjs';
import { tolerantEqual } from '../compare.mjs';

const TOL = { relTol: 0.01, absTol: 1e-9 };
const L = { vmax: 1.0 }, M = { vmax: 1.009 }, H = { vmax: 1.018 };
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-majority-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// One JIT stream of 2 tasks: idx 0 is warmup (interpreted), idx 1 runs the compiled solver (answer c) and is shadowed
// (shadowEvery 1); the shadow answers s1 and the adjudicator s2. Returns idx 1's row.
async function adjudicate(t, { c, s1, s2 }) {
  const root = tmp(t);
  const deps = {
    policyIds: [...POLICY_MODELS], outputSchema: { type: 'object' },
    makeTasks: async (familyId, { split, seeds, difficulty }) => seeds.map(seed => ({ familyId, task: { id: `fake:${split}:d${difficulty}:${seed}`, seed, split, difficulty, prompt: 'p', inputs: { seed } },
      taskKey: `fake:${split}:d${difficulty}:s${seed}`, taskHash: `h${seed}` })),
    createModelPort: () => ({ port: { fake: true } }),
    score: async (familyId, task, output) => ({ pass: output?.vmax === c.vmax, score: 0 }),
    async interpret(a) {
      const role = a.traceId.split('-')[1];
      const answer = role === 'shadow' ? s1 : role === 'adjudicator' ? s2 : L;
      return { traceId: a.traceId, taskId: a.task.id, seed: a.task.seed, model: a.model, answer, costUsd: 0.1, costUnknown: false, error: null, scripts: [], commands: [],
        task: { prompt: a.task.prompt, inputs: a.task.inputs } };
    },
    async runCompiled() { return { status: 'ok', output: c, deopt: null, trace: [], costUsd: 0.01, costUnknown: false, latencyMs: 1, error: null, meta: { errors: {} } }; },
    async compile(a) {
      const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
      const solvePath = path.join(workdir, 'solve.mjs'); writeFileSync(solvePath, `// ${a.label}\n`);
      const perCase = a.traces.map((x, i) => ({ id: `trace-${i}`, ref: x.traceId, kind: 'trace', status: 'exact', exact: true, partial: 1 }));
      return { record: { checkTraces: { exact: perCase.length, exactRate: 1, partial: 1, deopts: 0, crashes: 0, deoptKinds: {}, perCase, clean: true, unexplained: [], accepted: true },
        builderCostUsd: 0, gatewayCostUsd: 0, checkCostUsd: 0, compileCostUsd: 0, nestedModelAttempts: 0, builderError: null }, workdir, solvePath };
    },
  };
  const config = { experiment: 'jit-majority', familyId: 'fake', split: 'dev', segments: [{ difficulty: 3, seeds: '1..2' }], arms: ['jit:claude-sonnet-5-5/claude-haiku-5-5'],
    jit: { warmup: 1, shadowEvery: 1, recompileOnDeopts: 2, maxTraces: 8, compilerFallback: 'claude-opus-5-5', compare: 'tolerant', relTol: TOL.relTol, absTol: TOL.absTol },
    perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, concurrency: 1 };
  const res = await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  const rows = readJsonl(path.join(res.runDir, 'jit-claude-sonnet-5-5--claude-haiku-5-5', 'results.jsonl'));
  const row = rows.find(r => r.idx === 1);
  assert.ok(row, 'task idx 1 ran');
  const ev = kind => row.events.filter(e => e.kind === kind);
  return { row, delivered: row.delivered, answerIs: row.delivered === 'compiled' ? 'c' : row.delivered === 'adjudicated' ? 's1' : row.delivered,
    shadowAgree: ev('shadow')[0]?.agree ?? null, outcome: ev('adjudicate')[0]?.outcome ?? null, regression: ev('regression').length > 0 };
}

// The same decision as stream.mjs, with the two adjudication checks in the other order (s2 ~ s1 first). Used only to state
// what a different order would decide; it is not an implementation proposal.
const reversedOrder = (c, s1, s2, eq) => (eq(s1, c) ? 'agree' : eq(s2, s1) ? 'interpreter' : eq(s2, c) ? 'compiled' : 'none');
const eq = (a, b) => sameAnswer(a, b, 'tolerant', TOL);

test('the tolerant comparator is not transitive on L, M, H (the premise of B7-E6)', () => {
  assert.equal(tolerantEqual(L, M, TOL), true, 'L ~ M (0.9% apart)');
  assert.equal(tolerantEqual(M, H, TOL), true, 'M ~ H (0.9% apart)');
  assert.equal(tolerantEqual(L, H, TOL), false, 'L !~ H (1.8% apart)');
  // stream.mjs sameAnswer in 'tolerant' mode is the same relation.
  assert.deepEqual([eq(L, M), eq(M, H), eq(L, H)], [true, true, false]);
});

test('current behaviour: c = L, s1 = H, s2 = M is adjudicated for the compiled answer; the reverse check order would side with the shadow', async t => {
  const got = await adjudicate(t, { c: L, s1: H, s2: M });
  assert.equal(got.shadowAgree, false, 'the shadow disagrees (L !~ H)');
  assert.equal(got.outcome, 'compiled', 'both checks hold; s2 ~ c is tested first, so the compiled answer wins');
  assert.equal(got.delivered, 'compiled');
  assert.equal(got.regression, false, 'no regression case is recorded');
  // KNOWN PROPERTY (documented, not fixed here): the verdict depends on comparison order. With s2 ~ s1 tested first the
  // same triple would deliver s1 = H and record a regression against the compiled solver.
  assert.equal(reversedOrder(L, H, M, eq), 'interpreter');
  assert.notEqual(reversedOrder(L, H, M, eq), got.outcome, 'order dependence: the two check orders disagree on this triple');
});

test('the mirror triple (c = H, s1 = L, s2 = M) is order dependent the same way', async t => {
  const got = await adjudicate(t, { c: H, s1: L, s2: M });
  assert.deepEqual([got.shadowAgree, got.outcome, got.delivered, got.regression], [false, 'compiled', 'compiled', false]);
  assert.equal(reversedOrder(H, L, M, eq), 'interpreter');
});

test('control: a transitive triple (c = L, s1 = s2 = H) is not order dependent and sides with the interpreters', async t => {
  const got = await adjudicate(t, { c: L, s1: H, s2: H });
  assert.deepEqual([got.outcome, got.delivered, got.regression], ['interpreter', 'adjudicated', true]);
  assert.equal(reversedOrder(L, H, H, eq), 'interpreter', 'both orders agree when the relation is transitive on the triple');
});

test('exchanging the two interpreter draws: all 6 role assignments of {L, M, H} deliver the compiled answer, with different event trails', async t => {
  const V = { L, M, H };
  const table = [];
  for (const [c, s1, s2] of [['L', 'M', 'H'], ['L', 'H', 'M'], ['M', 'L', 'H'], ['M', 'H', 'L'], ['H', 'L', 'M'], ['H', 'M', 'L']]) {
    const got = await adjudicate(t, { c: V[c], s1: V[s1], s2: V[s2] });
    table.push({ c, s1, s2, agree: got.shadowAgree, outcome: got.outcome, delivered: got.delivered });
  }
  assert.deepEqual(table, [
    { c: 'L', s1: 'M', s2: 'H', agree: true, outcome: null, delivered: 'compiled' },
    { c: 'L', s1: 'H', s2: 'M', agree: false, outcome: 'compiled', delivered: 'compiled' },
    { c: 'M', s1: 'L', s2: 'H', agree: true, outcome: null, delivered: 'compiled' },
    { c: 'M', s1: 'H', s2: 'L', agree: true, outcome: null, delivered: 'compiled' },
    { c: 'H', s1: 'L', s2: 'M', agree: false, outcome: 'compiled', delivered: 'compiled' },
    { c: 'H', s1: 'M', s2: 'L', agree: true, outcome: null, delivered: 'compiled' },
  ]);
  // The delivered answer is invariant to s1 <-> s2 here, but whether the shadow agreed (and so whether its trace joins the
  // compile pool, stream.mjs addTrace on agree) depends on which draw happened to be the shadow.
});

// An order-independent rule (dossier 2 option 2: equivalence classes by single linkage over '~' with a diameter check, so
// a chain L ~ M ~ H wider than the tolerance is 'indeterminate') does not exist in stream.mjs. Kept visible, not silent.
test.todo('order-independent adjudication: single-linkage classes with a diameter check (B7 option 2); not implemented in stream.mjs');
