// Need router v1 (router.mjs, DESIGN §3): import-graph purity, feature whitelist, determinism, monotonicity in V and N,
// guard precedence, the structural rule, the leaf calculator with δ ties, abstention, the kNN stage, and the policies
// inside evaluate.mjs. $0, synthetic and planted data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRUSTED_FEATURES, RULE_KEYS, N1, REQUIREMENT_TYPES, trustedFeatures, requirementType, guardStage, intrinsicOf, fitStructuralRule, decideModes,
  fitNeedRouter, withProbe, nrStaticPolicy, nrKnnPolicy, policies, itemsFromContext,
} from '../router.mjs';
import { WHITELIST } from '../features.mjs';
import { TRUSTED_FEATURES as EVAL_TRUSTED, PROSE_FEATURES, INJECTIONS, fitRule, nrStatic, nrKnn, decideFolds, defaultPolicies, evaluate, importPurity, metamorphic } from '../evaluate.mjs';
import { GRID, HEADLINE, DELTA, makeCell, classOf, needUtility, perTaskUsd, rankModes } from '../metrics.mjs';
import { needsWorkflow as plantedNeed, judgeAlwaysAgent } from './worlds.mjs';
import { plantedRouter, realisticModes, generalModes, rng, NON_MONOTONE_N, V1_MODES } from './router-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const NR = path.resolve(here, '..'), ROOT = path.resolve(NR, '../..');
const V_GRID = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
const N_GRID = [1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 100, 300, 1000];

// ------------------------------------------------------------------------------------------------ import purity
const LEAF_UTILITIES = Object.freeze(['beds/lib/rng.mjs']);   // a PRNG reached through metrics -> jit/stats -> lib/stats
function importGraph(entry) {
  const seen = new Map(), problems = [], dynamic = [];
  const visit = file => {
    if (seen.has(file)) return;
    const src = readFileSync(file, 'utf8'), code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const specs = [...code.matchAll(/(?:^|[;\s])(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(m => m[1]);
    seen.set(file, specs);
    // A dynamic import is an edge too. Outside need-router it is tolerated only inside a CLI-only function (cli*), and
    // every such edge is listed so a new one fails the test.
    for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const fn = [...code.slice(0, m.index).matchAll(/function\s+(\w+)/g)].at(-1)?.[1] ?? '(module)', rel = path.relative(ROOT, file).split(path.sep).join('/');
      dynamic.push(`${rel} -> ${m[1]} (${fn})`);
      if (rel.startsWith('experiments/need-router/') || !/^cli/.test(fn)) problems.push(`${rel} imports ${m[1]} dynamically outside a CLI function`);
    }
    if (/\bimport\s*\(\s*[^'"\s]/.test(code)) problems.push(`${path.relative(ROOT, file)} has a computed dynamic import`);
    for (const s of specs) {
      if (/oracle|reference|results?\.jsonl|\.jsonl$|\/runs\/|sealed|label-run|evaluate\.mjs|harvest\.mjs|replay\.mjs|features\.mjs|lib\/beds\.mjs/i.test(s)) problems.push(`${path.relative(ROOT, file)} imports ${s}`);
      if (!s.startsWith('.')) continue;
      const to = path.resolve(path.dirname(file), s), rel = path.relative(ROOT, to);
      if (!existsSync(to)) { problems.push(`${rel} missing`); continue; }
      if (rel.startsWith(`beds${path.sep}`) && !LEAF_UTILITIES.includes(rel.split(path.sep).join('/'))) problems.push(`${path.relative(ROOT, file)} reaches bed module ${rel}`);
      visit(to);
    }
  };
  visit(entry);
  return { files: [...seen.keys()].map(f => path.relative(ROOT, f).split(path.sep).join('/')), problems, dynamic: [...new Set(dynamic)].sort() };
}

test('import-graph purity: router.mjs and card.mjs never reach a bed, an oracle, a reference, a label or result file', () => {
  for (const f of ['router.mjs', 'card.mjs']) {
    const g = importGraph(path.join(NR, f));
    assert.deepEqual(g.problems, [], `${f}: ${g.problems.join('; ')}`);
    assert.ok(!g.files.some(x => x.startsWith('beds/') && !LEAF_UTILITIES.includes(x)), g.files.join(', '));
    // Known and accepted: metrics.mjs -> jit/stats.mjs, whose CLI-only cliDecide loads ./report.mjs (a run-results reader).
    // It never runs on import; the router uses only stats.mjs's constants. Any other dynamic edge fails here.
    assert.deepEqual(g.dynamic, ['experiments/jit/stats.mjs -> ./report.mjs (cliDecide)'], f);
  }
  // The one bed-tree module reached is a leaf PRNG: no imports, no scorer or oracle exports.
  for (const u of LEAF_UTILITIES) {
    const src = readFileSync(path.join(ROOT, u), 'utf8');
    assert.equal([...src.matchAll(/^\s*import\s/gm)].length, 0, `${u} must be a leaf module`);
    assert.deepEqual([...src.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map(m => m[1]).sort(), ['hashSeed', 'rng']);
  }
  // router.mjs imports metrics.mjs only (features.test.mjs pins the same); card.mjs reads files only to hash this router's sources.
  const r = readFileSync(path.join(NR, 'router.mjs'), 'utf8'), c = readFileSync(path.join(NR, 'card.mjs'), 'utf8');
  assert.deepEqual([...r.matchAll(/from '([^']+)'/g)].map(m => m[1]), ['./metrics.mjs']);
  assert.doesNotMatch(r, /readFileSync|writeFileSync|process\.env|Math\.random|Date\.now|new Date\(/);
  assert.doesNotMatch(c, /writeFileSync|process\.env|Math\.random|Date\.now|new Date\(/);
  assert.equal([...c.matchAll(/readFileSync\(/g)].length, 1);
  assert.ok(c.includes('readFileSync(new URL(`./${f}`, import.meta.url))') && c.includes("CODE_FILES = Object.freeze(['router.mjs', 'card.mjs', 'voi.mjs', 'metrics.mjs'])"));
  // evaluate.mjs's own L5 agrees.
  const L5 = importPurity({ files: [path.join(NR, 'router.mjs'), path.join(NR, 'card.mjs')] });
  assert.equal(L5.ok, true, L5.problems.join('; '));
});

// --------------------------------------------------------------------------------------------- feature whitelist
test('feature whitelist: the router reads the 8 trusted keys only; banned keys and prose counts change nothing', () => {
  assert.deepEqual([...TRUSTED_FEATURES], [...EVAL_TRUSTED]);
  for (const k of TRUSTED_FEATURES) assert.ok(WHITELIST.includes(k), k);
  for (const k of PROSE_FEATURES) assert.ok(!TRUSTED_FEATURES.includes(k), k);
  for (const k of RULE_KEYS) assert.ok(TRUSTED_FEATURES.includes(k), k);
  assert.deepEqual(Object.keys(trustedFeatures({ logInputTokens: 3, family: 7, kind: 1, effectVerbs: 4, promptWords: 2, verifiable: 1, maxListLength: NaN })).sort(), ['logInputTokens', 'verifiable']);
  assert.throws(() => fitNeedRouter(plantedRouter().items, { ruleKeys: ['logInputTokens', 'promptWords'] }), /not a trusted feature/);

  const P = plantedRouter();
  for (const stage of ['leaf', 'knn']) {
    const R = fitNeedRouter(P.items, { modes: V1_MODES, stage });
    for (const j of P.EVAL.slice(0, 12)) {
      const v = P.view(j);
      const dirty = { ...v, features: { ...v.features, family: 99, kind: 3, version: 4, effectVerbs: 9, timeWords: 9, humanWords: 9, promptWords: 9, oracleScore: 1 }, family: 'records', kind: 'oneshot', version: '3.0.0', text: 'build a workflow' };
      for (const c of [HEADLINE, N1, makeCell(10, 100, 10)]) {
        const a = R.decide(v, c), b = R.decide(dirty, c);
        assert.equal(b.mode, a.mode, `${stage} ${j} ${c.key}`);
        assert.deepEqual(b.U, a.U);
        assert.deepEqual(Object.keys(b.features).filter(k => !TRUSTED_FEATURES.includes(k)), []);
      }
    }
  }
  // A trusted key does matter: a small job pushed past θ_tok changes leaf.
  const R = fitNeedRouter(P.items, { modes: V1_MODES });
  const small = P.EVAL.find(j => !plantedNeed(P.W.meta[j].features)), v = P.view(small);
  assert.equal(R.decide(v, HEADLINE).source.leaf, 'not');
  assert.equal(R.decide({ ...v, features: { ...v.features, logInputTokens: 5.5 } }, HEADLINE).source.leaf, 'intrinsic');
});

// ----------------------------------------------------------------------------------------------- determinism
test('determinism: refits, shuffled TRAIN order and repeated calls give identical fits and decisions', () => {
  const P = plantedRouter(), shuffled = [...P.items].reverse();
  for (const stage of ['leaf', 'knn']) {
    const A = fitNeedRouter(P.items, { modes: V1_MODES, stage }), B = fitNeedRouter(shuffled, { modes: V1_MODES, stage });
    assert.deepEqual(B.fitted, A.fitted);
    for (const j of P.EVAL) for (const c of [HEADLINE, N1, makeCell(0.1, 100, 0)]) {
      const a = A.decide(P.view(j), c);
      assert.deepEqual(B.decide(P.view(j), c), a);
      assert.deepEqual(A.decide(P.view(j), c), a);
    }
  }
  assert.throws(() => fitNeedRouter([...P.items, P.items[0]]), /duplicate TRAIN item/);
});

// ---------------------------------------------------------------------------------------------- monotonicity
const valueOf = (st, c) => st.s - c.wOverV * st.q;
test('monotone in V (a theorem, decideModes): the chosen p − (W/V)q and $ per task never fall as V rises; at W = 0 p itself', () => {
  const r = rng(11);
  let checked = 0;
  for (let t = 0; t < 3000; t++) {
    const pred = t % 2 ? realisticModes(r) : generalModes(r);
    for (const w of [0, 1, 10]) for (const N of [1, 10, 100]) {
      let prev = null;
      for (const V of V_GRID) {
        const c = makeCell(V, N, w), m = decideModes(pred, c).mode, st = pred.get(m);
        const cur = { a: valueOf(st, c), usd: perTaskUsd(st, c), p: st.s };
        if (prev) {
          assert.ok(cur.a >= prev.a - 1e-9, `value fell ${prev.a} -> ${cur.a} (V ${V}, N ${N}, W ${w}V)`);
          assert.ok(cur.usd >= prev.usd - 1e-9, `$ fell (V ${V})`);
          if (w === 0) assert.ok(cur.p >= prev.p - 1e-9, `p fell at W = 0 (V ${V})`);
          checked += 1;
        }
        prev = cur;
      }
    }
  }
  assert.ok(checked > 100000);
  // On the planted world the routed p does not fall across the slider at the headline W, for every held-out job.
  const P = plantedRouter(), R = fitNeedRouter(P.items, { modes: V1_MODES });
  for (const j of P.EVAL) for (const N of [1, 10, 100]) {
    const ps = [0.1, 1, 10].map(V => { const d = R.decide(P.view(j), makeCell(V, N, 1)); return d.pred[d.mode].p; });
    assert.ok(ps[1] >= ps[0] - 1e-12 && ps[2] >= ps[1] - 1e-12, `${j} N ${N}: ${ps}`);
  }
});

test('monotone in N: construct-H once chosen stays chosen as N grows; exact ties keep the build cost monotone (theorem)', () => {
  const r = rng(5);
  let stays = 0;
  for (let t = 0; t < 5000; t++) {
    const pred = realisticModes(r), w = [0, 1, 10][t % 3];
    for (const V of V_GRID) {
      let constructAt = null;
      for (const N of N_GRID) {
        const m = decideModes(pred, makeCell(V, N, w)).mode;
        if (constructAt !== null) { assert.equal(m, 'construct-H', `construct-H chosen at N ${constructAt}, ${m} at N ${N} (V ${V}, W ${w}V)`); stays += 1; }
        if (m === 'construct-H' && constructAt === null) constructAt = N;
      }
    }
  }
  assert.ok(stays > 1000, `only ${stays} construct-H continuations checked`);
  // Exact ties: the chosen build cost never decreases in N (upper envelope of lines in 1/N), on any mode set.
  for (let t = 0; t < 3000; t++) {
    const pred = t % 2 ? realisticModes(r) : generalModes(r), w = [0, 1, 10][t % 3];
    for (const V of V_GRID) {
      let B = -1;
      for (const N of N_GRID) { const m = decideModes(pred, makeCell(V, N, w), { delta: 0 }).mode; assert.ok(pred.get(m).B >= B - 1e-12, `exact: build cost fell at N ${N}`); B = pred.get(m).B; }
    }
  }
  // The planted world: every held-out job's class and construct choice are monotone over the metamorphic N grid.
  const P = plantedRouter(), R = fitNeedRouter(P.items, { modes: V1_MODES });
  const mm = metamorphic((v, c) => R.decide(v, c), P.EVAL, { meta: P.W.meta, modesOf: j => P.view(j).modes, cells: [HEADLINE, makeCell(0.1, 10), makeCell(10, 10)] });
  assert.equal(mm.monotone.violations, 0, JSON.stringify(mm.monotone.examples));
});

test('δ ties are not N-monotone in general: the pinned counterexample flips back to no workflow; exact ties do not', () => {
  const at = (N, delta) => decideModes(NON_MONOTONE_N, makeCell(1, N, 0), { delta }).mode;
  assert.equal(at(1, 0.03), 'agent-H+proc');
  assert.equal(at(2, 0.03), 'agent-O');                       // workflow at N = 1, no workflow at N = 2: the known limitation
  assert.equal(classOf(at(1, 0.03)), 'workflow');
  assert.equal(classOf(at(2, 0.03)), 'no-workflow');
  assert.equal(at(1, 0), 'agent-O');
  assert.equal(at(2, 0), 'construct-H');
});

// ------------------------------------------------------------------------------------------- guard precedence
test('guard precedence: a typed requirement forces the workflow class at every cell, before structure and economics', () => {
  const P = plantedRouter();
  for (const stage of ['leaf', 'knn']) {
    const R = fitNeedRouter(P.items, { modes: V1_MODES, stage });
    const cells = [HEADLINE, N1, makeCell(0.1, 1, 0), makeCell(10, 100, 10)];
    const jobs = P.EVAL.filter(x => cells.every(c => R.decide(P.view(x), c).class === 'no-workflow'));   // the economics alone pick no workflow
    assert.ok(jobs.length >= 3, `${stage}: ${jobs.length} no-workflow jobs`);
    for (const j of jobs) {
      const v = P.view(j);
      for (const c of cells) {
        const forced = R.decide({ ...v, requirements: ['human approval'] }, c);
        assert.equal(forced.class, 'workflow', `${stage} ${j} ${c.key}`);
        assert.equal(forced.needsWorkflow, true);
        assert.equal(forced.guard.forced, true);
        assert.equal(forced.guard.requirement, 'human-approval');
        assert.ok(Object.keys(forced.pred).every(m => classOf(m) === 'workflow'), 'only workflow modes are priced');
        if (stage === 'leaf') assert.equal(forced.structure.intrinsic, false, 'the structure reading is still reported');
      }
    }
  }
  const R = fitNeedRouter(P.items, { modes: V1_MODES }), v = P.view(P.EVAL[0]);
  // Typed fields only: spaced names from prereg/stages.json normalise; anything unknown is refused, never guessed.
  assert.deepEqual(guardStage({ requirements: ['effects with authority', 'durable wait', 'schedule', { type: 'audit beyond the journal' }, 'human_approval'] }).requirements,
    ['effects-with-authority', 'durable-wait', 'schedule', 'audit-beyond-journal', 'human-approval']);
  for (const bad of ['needs care', 'workflow', '', 7, { kind: 'durable-wait' }]) assert.throws(() => requirementType(bad), /requirement/);
  assert.throws(() => R.decide({ ...v, requirements: ['pipeline'] }, HEADLINE), /unknown hard-requirement type/);
  // Engine support: flagged, never a reason to drop the guard.
  const e8 = { ...v, requirements: ['durable wait', 'schedule', 'effects with authority'] };
  const noEngine = R.decide(e8, HEADLINE), partial = fitNeedRouter(P.items, { modes: V1_MODES, engine: ['state', 'wait.signal'] }).decide(e8, HEADLINE);
  assert.deepEqual(noEngine.guard.engineSupport, { ok: null, needed: ['compensation', 'state', 'wait.signal'], missing: [], declared: false });
  assert.deepEqual(partial.guard.engineSupport, { ok: false, needed: ['compensation', 'state', 'wait.signal'], missing: ['compensation'], declared: true });
  assert.equal(partial.class, 'workflow');
  assert.equal(R.decide({ ...e8, engine: { constructs: ['state', 'wait.signal', 'compensation'] } }, HEADLINE).guard.engineSupport.ok, true);
  // A forced job that cannot run any workflow mode: the guard still says needsWorkflow, and the router abstains.
  const stuck = R.decide({ ...v, modes: ['direct-H', 'agent-H'], requirements: ['schedule'] }, HEADLINE);
  assert.equal(stuck.needsWorkflow, true);
  assert.match(stuck.abstain.reasons[0], /^forced-without-workflow-mode/);
  assert.equal(stuck.abstain.fallback, 'all-modes');
  assert.ok(['direct-H', 'agent-H'].includes(stuck.mode));
});

test('word cues and a low guard recall only raise "ask"; they never force or change a mode', () => {
  const P = plantedRouter();
  for (const stage of ['leaf', 'knn']) {
    const R = fitNeedRouter(P.items, { modes: V1_MODES, stage }), low = fitNeedRouter(P.items, { modes: V1_MODES, stage, guardRecall: 0.8 });
    for (const j of P.EVAL) for (const c of [HEADLINE, N1]) {
      const v = P.view(j), base = R.decide(v, c);
      const cued = R.decide({ ...v, cues: ['human-gate', 'durable-wait', 'compensation-named-limit', 'humanWords', 'timeWords', 'effectVerbs', 'map-fanout', 'branching'] }, c);
      assert.equal(cued.mode, base.mode); assert.equal(cued.needsWorkflow, base.needsWorkflow); assert.equal(cued.guard.forced, false);
      assert.equal(cued.askFlag, true);
      assert.deepEqual(cued.guard.ask.cues, ['compensation-named-limit', 'durable-wait', 'effectVerbs', 'human-gate', 'humanWords', 'timeWords']);   // no hard-requirement reading: ignored
      const lr = low.decide(v, c);
      assert.equal(lr.mode, base.mode); assert.equal(lr.askFlag, true); assert.match(lr.ask[0], /guard recall 0\.800 < 0\.9/);
      assert.equal(low.decide({ ...v, requirements: ['schedule'] }, c).ask.length, 0, 'a declared requirement needs no ask');
    }
  }
  // A cue whose hinted requirement is declared raises nothing.
  assert.equal(guardStage({ requirements: ['human approval'], cues: ['human-gate'] }).ask.raised, false);
  // The evaluator's keyword and gadget injections are text: they never reach the public view, so they cannot flip a route.
  for (const s of INJECTIONS) assert.equal(typeof s, 'string');
});

// ----------------------------------------------------------------------------------------------- structural rule
test('structural rule: parity with evaluate.fitRule, ties to fewer workflow calls then larger thresholds, LOCO reported', () => {
  const P = plantedRouter();
  const mine = fitStructuralRule(P.items), ref = fitRule(P.ctx, ['logInputTokens', 'maxListLength']);
  assert.deepEqual(mine.thresholds, ref.thresholds);
  assert.equal(mine.trainBalancedAccuracy, ref.trainBalancedAccuracy);
  assert.equal(mine.workflowCalls, ref.workflowCalls);
  assert.ok(mine.thresholds.logInputTokens > 3.8 && mine.thresholds.logInputTokens <= 4.6);
  assert.ok(mine.thresholds.maxListLength > 1.5 && mine.thresholds.maxListLength <= 2.6);
  const R = fitNeedRouter(P.items, { modes: V1_MODES });
  assert.ok(R.loco.folds.length === 4 && R.loco.balancedAccuracy >= 0.75, JSON.stringify(R.loco));
  // Ties: two separable jobs leave a range of perfect thresholds; the larger one wins (fewer workflow calls first).
  const item = (id, x, label) => ({ id, cluster: id, features: { logInputTokens: x, maxListLength: 0 }, statsMap: new Map(), label: () => ({ label, confident: true }) });
  const r = fitStructuralRule([item('a', 2, 'no-workflow'), item('b', 3, 'no-workflow'), item('c', 4, 'workflow'), item('d', 5, 'workflow')]);
  assert.equal(r.thresholds.logInputTokens, 3.5); assert.equal(r.thresholds.maxListLength, Infinity); assert.equal(r.workflowCalls, 2);
  // No confident label: nothing fires.
  assert.deepEqual(fitStructuralRule([item('a', 2, 'either'), item('b', 9, 'either')].map(x => ({ ...x, label: () => ({ label: 'either', confident: false }) }))).thresholds, { logInputTokens: Infinity, maxListLength: Infinity });
  // intrinsicOf: OR of thresholds; a missing key with nothing fired is unreadable, not "no".
  assert.equal(intrinsicOf({ logInputTokens: 1, maxListLength: 3 }, { logInputTokens: 4, maxListLength: 2 }).intrinsic, true);
  assert.equal(intrinsicOf({ logInputTokens: 5 }, { logInputTokens: 4, maxListLength: 2 }).intrinsic, true);
  assert.equal(intrinsicOf({ logInputTokens: 1 }, { logInputTokens: 4, maxListLength: 2 }).intrinsic, null);
  assert.equal(intrinsicOf({ logInputTokens: 1 }, { logInputTokens: 4, maxListLength: Infinity }).intrinsic, false);
});

// --------------------------------------------------------------------------------- leaf calculator and δ ties
test('leaf calculator: recovers the planted modes per leaf over the grid, sends every held-out job to its planted class', () => {
  const P = plantedRouter(), R = fitNeedRouter(P.items, { modes: V1_MODES }), Rd = fitNeedRouter(P.items, { modes: V1_MODES, delta: DELTA });
  const T = R.leafTable(GRID), Td = Rd.leafTable(GRID);
  // Recomputed independently from evaluate.mjs's context: per leaf and cell, the mean TRAIN utility of each mode over the
  // leaf's jobs; the router's default takes the exact best (SBS-train's rule, rankModes), the δ-tie option the cheapest
  // member of the δ acceptable set in mean $ per task.
  for (const leaf of ['intrinsic', 'not']) {
    const its = P.ctx.train.filter(it => (intrinsicOf(it.view.features, R.rule.thresholds).intrinsic ? 'intrinsic' : 'not') === leaf);
    assert.ok(its.length > 0);
    for (const c of GRID) {
      const e = V1_MODES.map(m => ({ mode: m, u: its.reduce((a, it) => a + it.u(c, m), 0) / its.length, usd: its.reduce((a, it) => a + it.usd(c, m), 0) / its.length }));
      const top = Math.max(...e.map(x => x.u)), pick = e.filter(x => x.u >= top - 0.03 - 1e-12).sort((a, b) => a.usd - b.usd)[0].mode;
      assert.equal(T[leaf][c.key].mode, rankModes(e)[0], `exact ${leaf} ${c.key}`);
      assert.equal(Td[leaf][c.key].mode, pick, `δ ties ${leaf} ${c.key}`);
    }
  }
  assert.equal(T.intrinsic[HEADLINE.key].mode, 'construct-H'); assert.equal(T.not[HEADLINE.key].mode, 'direct-H');
  assert.equal(T.pooled[HEADLINE.key].mode, R.decide({ features: {} }, HEADLINE).mode);
  for (const j of P.EVAL) {
    const d = R.decide(P.view(j), HEADLINE), want = plantedNeed(P.W.meta[j].features);
    assert.equal(d.needsWorkflow, want, j); assert.equal(d.class === 'workflow', want, j);
    assert.equal(d.abstain, null);
    assert.equal(d.mode, want ? 'construct-H' : 'direct-H');
  }
});

test('δ ties go to the cheaper mode; δ = 0 takes the exact best; the W·q term charges silent misses', () => {
  const cell = makeCell(1, 10, 1);
  const pred = new Map([['agent-O', { s: 0.95, q: 0.01, c: 0.6, B: 0 }], ['agent-H', { s: 0.62, q: 0.02, c: 0.1, B: 0 }], ['direct-H', { s: 0.6, q: 0.04, c: 0.03, B: 0 }]]);
  // u: agent-O 0.34, agent-H 0.50, direct-H 0.53: best direct-H; within δ = 0.03 agent-H (0.50) is acceptable but dearer.
  const d = decideModes(pred, cell);
  assert.equal(d.mode, 'direct-H'); assert.deepEqual(d.acceptable, ['direct-H', 'agent-H']);
  const near = new Map([['agent-H', { s: 0.66, q: 0.02, c: 0.1, B: 0 }], ['direct-H', { s: 0.6, q: 0.04, c: 0.03, B: 0 }]]);   // u 0.54 vs 0.53
  assert.equal(decideModes(near, cell).mode, 'direct-H'); assert.equal(decideModes(near, cell).best, 'agent-H'); assert.equal(decideModes(near, cell).tie, true);
  assert.equal(decideModes(near, cell, { delta: 0 }).mode, 'agent-H');
  // Exact tie: the cheaper; equal price: the higher utility; then registry order.
  const tie = new Map([['b', { s: 0.5, q: 0, c: 0.2, B: 0 }], ['a', { s: 0.45, q: 0, c: 0.15, B: 0 }]]);
  assert.equal(decideModes(tie, cell, { delta: 0 }).mode, 'a');
  assert.equal(decideModes(new Map([['b', { s: 0.5, q: 0, c: 0.1, B: 0 }], ['a', { s: 0.5, q: 0, c: 0.1, B: 0 }]]), cell, { order: ['a', 'b'] }).mode, 'a');
  // W·q: a mode that delivers many wrong answers wins at W = 0 and loses at W = V and W = 10V.
  const wq = new Map([['loud', { s: 0.8, q: 0.2, c: 0.05, B: 0 }], ['careful', { s: 0.7, q: 0, c: 0.05, B: 0 }]]);
  assert.equal(decideModes(wq, makeCell(1, 10, 0)).mode, 'loud');
  assert.equal(decideModes(wq, makeCell(1, 10, 1)).mode, 'careful');
  assert.ok(Math.abs(decideModes(wq, makeCell(1, 10, 10)).U.get('loud') - (0.8 - 0.05 - 2)) < 1e-12);
  // The routing term lowers every utility by r/(N·V) and never changes the choice.
  const r0 = decideModes(pred, cell), r1 = decideModes(pred, cell, { routingUsd: 0.16 });
  assert.equal(r1.mode, r0.mode);
  for (const m of pred.keys()) assert.ok(Math.abs(r0.U.get(m) - r1.U.get(m) - 0.016) < 1e-12);
  assert.ok(Math.abs(r0.U.get('direct-H') - needUtility(pred.get('direct-H'), cell)) < 1e-15);
});

// ---------------------------------------------------------------------------------------------------- abstention
test('abstention: unreadable structure, thin leaves, unsupported modes and money-losing cells are flagged with a fallback', () => {
  const P = plantedRouter(), R = fitNeedRouter(P.items, { modes: V1_MODES }), v = P.view(P.EVAL[0]);
  const blind = R.decide({ ...v, features: { verifiable: 1 } }, HEADLINE);
  assert.equal(blind.structure.intrinsic, null); assert.equal(blind.needsWorkflow, null);
  assert.equal(blind.source.leaf, 'pooled'); assert.equal(blind.abstain.fallback, 'pooled'); assert.match(blind.abstain.reasons[0], /^structure-unknown/);
  // A leaf with too few TRAIN jobs falls back to the pooled stats.
  const strict = fitNeedRouter(P.items, { modes: V1_MODES, minLeafJobs: 100 }).decide(v, HEADLINE);
  assert.match(strict.abstain.reasons[0], /^thin-leaf/); assert.equal(strict.source.leaf, 'pooled');
  // Modes nobody trained: listed, never priced; nothing supported: today's default, agent-H.
  const odd = R.decide({ ...v, modes: ['agent-H', 'mystery-mode'] }, HEADLINE);
  assert.deepEqual(odd.unsupported, ['mystery-mode']); assert.equal(odd.mode, 'agent-H');
  const onlyH = fitNeedRouter(P.items.map(it => ({ ...it, stats: { 'direct-H': it.stats['direct-H'] } })), { modes: V1_MODES }).decide({ ...v, modes: ['agent-H', 'agent-O'] }, HEADLINE);
  assert.equal(onlyH.mode, 'agent-H'); assert.equal(onlyH.abstain.fallback, 'default-mode'); assert.match(onlyH.abstain.reasons[0], /^no-supported-mode/);
  assert.throws(() => R.decide({ ...v, modes: ['mystery-mode'] }, HEADLINE), /no mode this router knows/);
  // At $0.10 per success a big job loses money in every mode: flagged, the least-bad mode kept.
  const big = P.EVAL.find(j => plantedNeed(P.W.meta[j].features)), poor = R.decide(P.view(big), makeCell(0.1, 1, 1));
  assert.ok(Math.max(...Object.values(poor.U)) < 0);
  assert.match(poor.abstain.reasons.at(-1), /^no-mode-pays/); assert.equal(poor.abstain.fallback, null);
  // Predicted abstain share is reported per mode and equals 1 − p − q.
  for (const x of Object.values(R.decide(v, HEADLINE).pred)) assert.ok(Math.abs(x.abstain - Math.max(0, 1 - x.p - x.q)) < 1e-12);
});

// --------------------------------------------------------------------------------------------------- kNN stage
test('kNN stage (secondary): k by leave-one-cluster-out in {3, 5}, neighbours exposed for L8, planted classes recovered', () => {
  const P = plantedRouter(), R = fitNeedRouter(P.items, { modes: V1_MODES, stage: 'knn' });
  assert.ok([3, 5].includes(R.k)); assert.ok(R.fitted.knn.scores[3] !== undefined && R.fitted.knn.scores[5] !== undefined);
  let right = 0;
  for (const j of P.EVAL) {
    const d = R.decide(P.view(j), HEADLINE);
    assert.equal(d.source.neighbours.length, R.k);
    assert.deepEqual(R.neighbours(P.view(j).features), d.source.neighbours.map(x => x.cluster));
    right += (d.class === 'workflow') === plantedNeed(P.W.meta[j].features) ? 1 : 0;
    assert.equal(d.needsWorkflow, R.decide(P.view(j), makeCell(1, 1, 1)).class === 'workflow');
  }
  assert.ok(right / P.EVAL.length >= 0.75, `kNN routed ${right}/${P.EVAL.length} to the planted class`);
  assert.equal(fitNeedRouter(P.items, { modes: V1_MODES, stage: 'knn', k: 1 }).k, 1);
  assert.throws(() => fitNeedRouter(P.items, { stage: 'tree' }), /stage must be/);
});

// ----------------------------------------------------------------------------------------------- probe update
test('NR-probe pieces: the Beta update moves p, the probe cost is charged as routing dollars, disagreement asks without a verifier', () => {
  const pred = new Map([['direct-H', { s: 0.5, q: 0.2, c: 0.03, B: 0, n: 2 }]]);
  const up = withProbe(pred, { observations: { 'direct-H': { passes: 2, n: 2 } } }).get('direct-H');
  assert.ok(Math.abs(up.s - (1 + 0.5 * 24 + 2) / (2 + 24 + 2)) < 1e-12 && up.s > 0.5);
  assert.ok(withProbe(pred, { observations: { 'direct-H': { passes: 0, n: 2 } } }).get('direct-H').s < 0.5);
  assert.throws(() => withProbe(pred, { observations: { 'direct-H': { passes: 3, n: 2 } } }), /passes <= n/);
  const P = plantedRouter(), R = fitNeedRouter(P.items, { modes: V1_MODES }), v = P.view(P.EVAL[0]);
  const base = R.decide(v, HEADLINE), probed = R.decide(v, HEADLINE, { probe: { observations: { 'direct-H': { passes: 1, n: 2 } }, costUsd: 0.16, disagree: true } });
  assert.equal(probed.routingCostUsd, 0.16);
  assert.ok(Math.abs((base.U['agent-H'] - probed.U['agent-H']) - 0.16 / (HEADLINE.N * HEADLINE.V)) < 1e-12);
  assert.equal(probed.askFlag, true); assert.match(probed.ask.at(-1), /cannot arbitrate/);
  for (const verifier of ['tests', 'owner acceptance check']) assert.equal(R.decide({ ...v, verifier }, HEADLINE, { probe: { observations: {}, costUsd: 0.16, disagree: true } }).askFlag, false, verifier);
  assert.equal(R.decide({ ...v, verifier: 'schema' }, HEADLINE, { probe: { observations: {}, costUsd: 0.16, disagree: true } }).askFlag, true);
});

// ---------------------------------------------------------------------------------------- evaluate.mjs integration
test('the v1 policies run inside evaluate.mjs: δ = 0 matches the reference NR-static on every cell; the default reads SUPPORTED', () => {
  const P = plantedRouter();
  const fold = { train: P.TRAIN, eval: P.EVAL };
  const d = decideFolds({ labels: P.labels, meta: P.W.meta, folds: [fold], policies: [nrStatic(), nrStaticPolicy({ name: 'v1-exact', delta: 0 }), nrStaticPolicy({ name: 'v1' }), nrKnn(), nrKnnPolicy({ name: 'v1-knn' })], modes: V1_MODES, cells: GRID });
  for (const j of P.EVAL) for (const c of GRID) {
    const ref = d.decisions.get('NR-static').get(j).get(c.key), ex = d.decisions.get('v1-exact').get(j).get(c.key);
    assert.equal(ex.mode, ref.mode, `${j} ${c.key}`); assert.equal(ex.needsWorkflow, ref.needsWorkflow);
  }
  assert.deepEqual(d.fitted.get('v1')[0].fitted.thresholds, d.fitted.get('NR-static')[0].fitted.thresholds);
  assert.ok([3, 5].includes(d.fitted.get('v1-knn')[0].k) && typeof d.fitted.get('v1-knn')[0].neighbours === 'function');
  // itemsFromContext recovers the stats the labels were built from.
  for (const it of itemsFromContext(P.ctx)) for (const [m, st] of Object.entries(it.stats)) {
    const ctxItem = P.ctx.train.find(x => x.view.id === it.id);
    for (const c of [HEADLINE, makeCell(0.1, 100, 10)]) assert.ok(Math.abs(needUtility(st, c) - ctxItem.u(c, m)) < 1e-9);
  }
  // `--router router.mjs` replaces the reference NR-static and NR-knn by name.
  assert.deepEqual(policies.map(p => [p.name, p.role]), [['NR-static', 'primary'], ['NR-knn', 'secondary']]);
  const byName = new Map(defaultPolicies().map(p => [p.name, p])); for (const p of policies) byName.set(p.name, p);
  const R = evaluate({ ...P.W, recorded: judgeAlwaysAgent(P.W.meta), split: 'heldout', policies: [...byName.values()], reps: 200, bootReps: 0, l2Perms: 0, randomDraws: 100, attacks: false, leak: false });
  assert.equal(R.primary['NR-static'].reading, 'SUPPORTED', JSON.stringify(R.primary['NR-static'].unmet));
  assert.equal(R.c7a['NR-static'].N1.balancedAccuracy.point, 1);
  assert.ok(R.scores['NR-knn'][HEADLINE.key].delta > 0);
});
