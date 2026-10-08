// The JIT stream state machine at $0: every dependency (interpreter, compiler, compiled runner, oracle, model port)
// is a scripted fake, so the transitions, the per-arm files, resume and cost totals are checked exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runStream, normalizeConfig, parseArm, selectTraces, accepted, worseOnOld, exactOf, sameAnswer, POLICY_MODELS, armPaths } from '../stream.mjs';
import { buildReport } from '../report.mjs';

const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-stream-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const TRUTH = seed => ({ v: seed });

// A fake world. Tasks are seeds 1..n (idx = seed - 1); the "oracle" passes an answer equal to {v: seed}.
// plan.compiled(version, idx) -> {status, output?, deopt?}; plan.interpret(idx, role, n) -> answer | {error}
// plan.checks(callNo, {traces, regressions, builderModel}) -> checkTraces. hooks.* may throw to simulate a crash.
function fakeDeps(plan, hooks = {}) {
  const calls = { interpret: [], runCompiled: [], compile: [], score: 0, active: 0, maxActive: 0 };
  const deps = {
    policyIds: [...POLICY_MODELS], outputSchema: { type: 'object' },
    makeTasks: async (familyId, { split, seeds, difficulty }) => seeds.map(seed => ({ familyId, task: { id: `fake:${split}:d${difficulty}:${seed}`, seed, split, difficulty, prompt: 'p', inputs: { seed } },
      taskKey: `fake:${split}:d${difficulty}:s${seed}`, taskHash: `h${seed}` })),
    createModelPort: ({ journalFile, allowedModels }) => { calls.port = { journalFile, allowedModels }; return { port: { fake: true } }; },
    score: async (familyId, task, output) => { calls.score++; const pass = output?.v === task.seed; return { pass, score: pass ? 1 : 0 }; },
    async interpret(a) {
      const idx = a.task.seed - 1, role = a.traceId.split('-')[1];
      const n = calls.interpret.filter(c => c.idx === idx && c.role === role).length;
      calls.interpret.push({ idx, role, model: a.model, traceId: a.traceId });
      calls.active++; calls.maxActive = Math.max(calls.maxActive, calls.active);
      await new Promise(r => setTimeout(r, 2));
      calls.active--;
      hooks.interpret?.(idx, role, n);
      const got = plan.interpret?.(idx, role, n);
      const answer = got === undefined ? TRUTH(a.task.seed) : got?.error ? null : got;
      return { traceId: a.traceId, taskId: a.task.id, seed: a.task.seed, model: a.model, answer, costUsd: 0.1, costUnknown: false, error: got?.error ? { code: got.error } : null,
        scripts: [], commands: [], task: { prompt: a.task.prompt, inputs: a.task.inputs } };
    },
    async runCompiled(a) {
      const idx = a.task.seed - 1, version = Number(a.label.split(':v').at(-1));
      calls.runCompiled.push({ idx, version, solve: readFileSync(a.solvePath, 'utf8'), allowedModels: a.allowedModels });
      hooks.runCompiled?.(idx, version);
      const r = plan.compiled(version, idx) ?? { status: 'ok' };
      return { status: r.status, output: r.status === 'ok' ? (r.output ?? TRUTH(a.task.seed)) : null, deopt: r.deopt ?? null, trace: [], costUsd: 0.01, costUnknown: false, latencyMs: 1,
        error: r.error ? { code: r.error } : null, meta: { errors: r.metaErrors ?? {} } };
    },
    async compile(a) {
      const callNo = calls.compile.length + 1;
      calls.compile.push({ builderModel: a.builderModel, label: a.label, traceIds: a.traces.map(t => t.traceId), regressionIds: a.regressions.map(r => r.regressionId),
        previous: a.previous, models: a.models, budget: a.builderBudgetUsd, minutes: a.minutes, regressionExpected: a.regressions.map(r => r.expected) });
      hooks.compile?.(callNo);
      const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
      const solvePath = path.join(workdir, 'solve.mjs'); writeFileSync(solvePath, `// ${a.label}\n`);
      const checkTraces = plan.checks(callNo, a);
      return { record: { checkTraces, builderCostUsd: 1, gatewayCostUsd: 0.5, checkCostUsd: 0.25, constructionCostUsd: 1.5, compileCostUsd: 1.75, nestedModelAttempts: 0,
        builderError: plan.builderError?.(callNo) ?? null }, workdir, solvePath };
    },
  };
  return { deps, calls };
}

const perCase = (a, exactFor) => {
  const cases = [...a.traces.map(t => ({ id: t.traceId })), ...a.regressions.map(r => ({ id: r.regressionId }))];
  const pc = cases.map((c, i) => ({ ...c, exact: exactFor(c, i, cases) }));
  return { exact: pc.filter(c => c.exact).length / pc.length, partial: 0.9, deopts: 0, crashes: 0, perCase: pc };
};

// Scenario: warmup 2, shadow every 2nd compiled ok, recompile after 2 deopts. Every transition of SPEC §6.2.
const PLAN = {
  interpret(idx, role) {
    if (idx === 9 && role === 'adjudicator') return { v: 999 };   // three different answers: no majority
    if (idx === 11 && role === 'adjudicator') return { v: -1 };   // sides with the compiled answer
    return undefined;                                              // the true answer
  },
  compiled(version, idx) {
    if (version === 1 && idx === 4) return { status: 'deopt', deopt: { kind: 'guard', name: 'known-dialects' } };
    if (version === 1 && idx === 5) return { status: 'crash', error: 'SCRIPT_ERROR' };
    if (version === 2 && [7, 9, 11].includes(idx)) return { status: 'ok', output: { v: -1 } };
    return { status: 'ok' };
  },
  checks(callNo, a) {
    if (callNo === 1) return perCase(a, (c, i) => i === 0);                      // v1 Haiku: 50% -> Opus fallback
    if (callNo === 2) return perCase(a, () => true);                             // v1 Opus: 100%, adopted
    if (callNo === 3) return perCase(a, () => true);                             // v2: recompile after 2 deopts
    if (callNo === 4) return perCase(a, (c, i, all) => c.id !== all.filter(x => x.id.includes('-interpreter-')).at(-1).id);   // v3: worse on an old case
    return perCase(a, () => true);
  },
};
const CONFIG = {
  experiment: 'jit-fake', familyId: 'fake', split: 'dev', segments: [{ difficulty: 3, seeds: '1..12' }], arms: ['jit:claude-sonnet-5-5/claude-haiku-5-5'],
  jit: { warmup: 2, shadowEvery: 2, recompileOnDeopts: 2, maxTraces: 8, compilerFallback: 'claude-opus-5-5' }, perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, concurrency: 2,
};
const kinds = row => row.events.map(e => e.kind).filter(k => !['spend'].includes(k));

function checkScenario(rows, calls, { compileCalls = 4 } = {}) {
  assert.equal(rows.length, 12);
  const by = i => rows.find(r => r.idx === i);
  // warmup
  for (const i of [0, 1]) { assert.equal(by(i).delivered, 'interpreter'); assert.equal(by(i).version, null); assert.ok(kinds(by(i)).includes('interpret')); }
  // first compile at idx 2: Haiku fails acceptance, one Opus fallback, Opus version adopted
  assert.deepEqual(calls.compile.slice(0, 2).map(c => c.builderModel), ['claude-haiku-5-5', 'claude-opus-5-5']);
  assert.deepEqual(calls.compile[0].budget, 3); assert.deepEqual(calls.compile[1].budget, 8); assert.equal(calls.compile[1].minutes, 45);
  assert.equal(calls.compile[0].previous, null);
  assert.equal(calls.compile[0].traceIds.length, 2);
  assert.ok(kinds(by(2)).includes('fallback-compile')); assert.ok(kinds(by(2)).includes('compile'));
  assert.equal(by(2).events.find(e => e.kind === 'compile').builderModel, 'claude-opus-5-5');
  assert.equal(by(2).delivered, 'compiled'); assert.equal(by(2).version, 1);
  // shadow agree at the 2nd compiled ok
  assert.deepEqual(by(3).events.find(e => e.kind === 'shadow'), { kind: 'shadow', version: 1, agree: true });
  assert.equal(by(3).delivered, 'compiled');
  // deopt -> interpreter, crash -> interpreter; two of them trigger a recompile at idx 6
  assert.equal(by(4).delivered, 'interpreter'); assert.equal(by(4).deoptKind, 'guard'); assert.ok(kinds(by(4)).includes('deopt'));
  assert.equal(by(5).delivered, 'interpreter'); assert.equal(by(5).compiledStatus, 'crash'); assert.ok(kinds(by(5)).includes('crash'));
  assert.equal(by(5).stateAfter.pendingCompile, 'deopts');
  assert.ok(kinds(by(6)).includes('recompile')); assert.equal(by(6).version, 2);
  assert.match(calls.compile[2].previous, /v1-opus55/, 'a recompile gets the current solve.mjs');
  const v2traces = calls.compile[2].traceIds;
  assert.equal(v2traces.length, 5, 'warmup 2 + agreeing shadow + deopt + crash fallbacks');
  assert.ok(v2traces[0].startsWith('i005-'), 'newest first');
  // shadow disagrees, the adjudicator sides with the shadow: compiled minority -> adjudicated, regression, recompile
  assert.deepEqual(kinds(by(7)).filter(k => ['shadow', 'disagree', 'adjudicate', 'regression'].includes(k)), ['shadow', 'disagree', 'adjudicate', 'regression']);
  assert.equal(by(7).delivered, 'adjudicated'); assert.equal(by(7).pass, true);
  assert.equal(by(7).stateAfter.regressions.length, 1);
  // the recompile at idx 8 gets the regression (with the adjudicated answer, never the oracle's verdict) and is worse
  // than v2 on v2's old cases: rejected, v2 kept
  assert.equal(calls.compile[3].regressionIds.length, 1); assert.deepEqual(calls.compile[3].regressionExpected, [{ v: 8 }]);
  assert.ok(kinds(by(8)).includes('rejected')); assert.equal(by(8).version, 2);
  assert.equal(calls.compile.length, compileCalls, 'v3 was accepted (>= 75%) so no Opus fallback, and nothing else compiles');
  // no majority -> unresolved, compiled answer delivered
  assert.ok(kinds(by(9)).includes('unresolved')); assert.equal(by(9).delivered, 'compiled'); assert.equal(by(9).pass, false);
  assert.equal(by(10).delivered, 'compiled');
  // adjudicator sides with the compiled answer: compiled majority, no regression
  assert.deepEqual(by(11).events.find(e => e.kind === 'adjudicate'), { kind: 'adjudicate', version: 2, outcome: 'compiled' });
  assert.equal(by(11).delivered, 'compiled'); assert.equal(by(11).stateAfter.regressions.length, 1);
  // shadows and adjudicators use the arm's interpreter model; nothing else interprets
  assert.ok(calls.interpret.every(c => c.model === 'claude-sonnet-5-5'));
  assert.equal(rows.filter(r => r.pass).length, 10);
}

test('JIT state machine: warmup, compile with Opus fallback, shadows, deopt/crash, regression, rejected recompile, unresolved, costs', async t => {
  const root = tmp(t);
  const { deps, calls } = fakeDeps(PLAN);
  const res = await runStream({ config: CONFIG, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(res.arms.map(a => a.errors), [[]]);
  const rows = [...res.rows].sort((a, b) => a.idx - b.idx);
  checkScenario(rows, calls);
  // the gateway port is per arm, with the arm's models only
  assert.equal(calls.port.journalFile, path.join(root, 'runs/jit-fake/jit-claude-sonnet-5-5--claude-haiku-5-5/journal.sqlite'));
  assert.deepEqual(calls.port.allowedModels, [...POLICY_MODELS].sort());
  // costs: 11 interpretations x $0.1, 10 compiled runs x $0.01, 4 compile attempts x ($1 builder + $0.5 gateway + $0.25 check)
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  close(total, 11 * 0.1 + 10 * 0.01 + 4 * 1.75, 'total');
  const comp = k => rows.reduce((s, r) => s + (r.costBreakdown[k] ?? 0), 0);
  close(comp('interpreter'), 0.4, 'interpreter'); close(comp('shadow'), 0.4, 'shadow'); close(comp('adjudicator'), 0.3, 'adjudicator');
  close(comp('compiled'), 0.1, 'compiled'); close(comp('compileBuilder'), 4, 'builder'); close(comp('compileGateway'), 2, 'gateway'); close(comp('compileCheck'), 1, 'check');
  // every row's cost is the sum of its spend events
  const p = armPaths(path.join(root, 'runs/jit-fake'), 'jit-claude-sonnet-5-5--claude-haiku-5-5');
  const spends = readJsonl(p.events).filter(e => e.kind === 'spend');
  close(spends.reduce((s, e) => s + e.costUsd, 0), total, 'events = rows');
  // the arm wrote only its own directory (arms run as separate processes)
  assert.deepEqual(readdirSync(path.join(root, 'runs/jit-fake')), ['jit-claude-sonnet-5-5--claude-haiku-5-5']);
  assert.deepEqual(readdirSync(p.dir).sort(), ['arm.json', 'events.jsonl', 'regressions', 'results.jsonl', 'traces', 'versions']);
  assert.deepEqual(readdirSync(p.versions).sort(), ['v1-haiku55', 'v1-opus55', 'v2-haiku55', 'v3-haiku55']);
  assert.equal(readdirSync(p.regressions).length, 1);
  const reg = JSON.parse(readFileSync(path.join(p.regressions, readdirSync(p.regressions)[0]), 'utf8'));
  assert.deepEqual(reg.expected, { v: 8 }); assert.deepEqual(reg.compiledOutput, { v: -1 }); assert.equal('pass' in reg, false);
  // the report agrees
  const rep = buildReport(path.join(root, 'runs/jit-fake'));
  const a = rep.arms[0];
  close(a.totalUsd, total, 'report total'); assert.equal(a.successes, 10);
  assert.equal(a.counts.compiles, 2); assert.equal(a.counts.recompiles, 1); assert.equal(a.counts.rejected, 1); assert.equal(a.counts.fallbackCompiles, 1);
  assert.deepEqual(a.counts.deoptsByKind, { guard: 1 }); assert.equal(a.counts.crashes, 1); assert.equal(a.counts.shadows, 4); assert.equal(a.counts.disagreements, 3);
  assert.equal(a.counts.regressions, 1); assert.equal(a.counts.unresolved, 1);
  assert.deepEqual(a.deliveredBy, { interpreter: 4, compiled: 7, adjudicated: 1 });
});

test('resume after crashes mid-stream: finished rows are skipped, state and the compiled version are rebuilt, no compile is bought twice, every dollar is billed', async t => {
  const root = tmp(t);
  const opts = { config: CONFIG, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} };
  let crashed = { interp: false, compiled: false };
  const hooks = {
    interpret(idx, role) { if (idx === 5 && role === 'interpreter' && !crashed.interp) { crashed.interp = true; throw new Error('process died (interpreter)'); } },
    runCompiled(idx) { if (idx === 8 && !crashed.compiled) { crashed.compiled = true; throw new Error('process died (compiled)'); } },
  };
  const { deps, calls } = fakeDeps(PLAN, hooks);
  const r1 = await runStream({ ...opts, deps });
  assert.match(r1.arms[0].errors[0], /process died \(interpreter\)/);
  assert.equal(r1.rows.length, 5, 'rows 0-4 finished');
  const r2 = await runStream({ ...opts, deps });
  assert.match(r2.arms[0].errors[0], /process died \(compiled\)/);
  assert.equal(r2.rows.length, 8);
  const r3 = await runStream({ ...opts, deps });
  assert.deepEqual(r3.arms[0].errors, []); assert.equal(r3.arms[0].done, 4, 'only rows 8-11 ran in the third process');
  const rows = [...r3.rows].sort((a, b) => a.idx - b.idx);
  checkScenario(rows, calls);
  assert.ok(kinds(rows[8]).includes('compile-reused'), 'the v3 compile finished before the crash and is reused');
  // the crashed attempts' spend is billed to the row that finished the index: idx 5's first compiled run, idx 8's compile
  close(rows[5].orphanUsd, 0.01, 'idx 5 orphan'); close(rows[8].orphanUsd, 1.75, 'idx 8 orphan');
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  close(total, 11 * 0.1 + 10 * 0.01 + 4 * 1.75 + 0.01, 'total includes the crashed attempt');
  const p = armPaths(path.join(root, 'runs/jit-fake'), 'jit-claude-sonnet-5-5--claude-haiku-5-5');
  close(readJsonl(p.events).filter(e => e.kind === 'spend').reduce((s, e) => s + e.costUsd, 0), total, 'events = rows');
  assert.equal(readJsonl(p.results).length, 12, 'no row written twice');
  // a changed arm definition refuses to resume over these rows
  await assert.rejects(runStream({ ...opts, deps, config: { ...CONFIG, jit: { ...CONFIG.jit, shadowEvery: 3 } } }), /resume would mix versions/);
});

test('environment faults are retried once, then recorded as faults (never failures); the JIT stream stops there and a resume continues it', async t => {
  const root = tmp(t);
  const opts = { config: { ...CONFIG, segments: [{ difficulty: 3, seeds: [1, 2, 3, 4] }] }, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} };
  let limited = true;
  const plan = { ...PLAN, interpret: (idx, role, n) => (idx === 0 && n === 0 ? { error: 'MODEL_RATE_LIMIT' } : idx === 1 && limited ? { error: 'MODEL_RATE_LIMIT' } : undefined) };
  const { deps, calls } = fakeDeps(plan);
  const r1 = await runStream({ ...opts, deps });
  assert.deepEqual(r1.arms[0].errors, []); assert.equal(r1.arms[0].faults, 1);
  assert.equal(r1.rows.length, 1, 'idx 0 retried and finished; idx 1 faulted twice and stopped the stream');
  assert.ok(kinds(r1.rows[0]).includes('fault-retry')); assert.equal(r1.rows[0].pass, true);
  close(r1.rows[0].costUsd, 0.2, 'the faulted attempt is still charged');
  const p = armPaths(path.join(root, 'runs/jit-fake'), 'jit-claude-sonnet-5-5--claude-haiku-5-5');
  const faults = readJsonl(p.faults);
  assert.equal(faults.length, 1); assert.equal(faults[0].idx, 1); assert.equal(faults[0].error.code, 'MODEL_RATE_LIMIT');
  assert.equal(calls.interpret.filter(c => c.idx === 2).length, 0, 'nothing after the fault ran');
  limited = false;
  const r2 = await runStream({ ...opts, deps });
  assert.equal(r2.rows.length, 4);
  const row1 = r2.rows.find(r => r.idx === 1);
  close(row1.orphanUsd, 0.2, 'the two faulted attempts are billed to the row that finished idx 1'); close(row1.costUsd, 0.3, 'row 1');
});

test('agent and static arms: concurrency cap, static deopt/crash fall back to the Haiku interpreter (recorded), per-arm files only', async t => {
  const root = tmp(t);
  const plan = { compiled: (v, idx) => (idx === 1 ? { status: 'deopt', deopt: { kind: 'guard' } } : idx === 2 ? { status: 'invalid', error: 'OUTPUT_SCHEMA' } : { status: 'ok' }), checks: () => null };
  const { deps, calls } = fakeDeps(plan);
  const solve = path.join(root, 'B1-x', 'solve.mjs'); mkdirSync(path.dirname(solve)); writeFileSync(solve, '// static\n');
  const config = { ...CONFIG, experiment: 'flat', segments: [{ difficulty: 3, seeds: '1..6' }], arms: ['agent:claude-haiku-5-5', 'agent:claude-opus-5-5', `static:${solve}`], concurrency: 2 };
  const res = await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.ok(res.arms.every(a => a.errors.length === 0 && a.done === 6));
  assert.ok(calls.maxActive <= 2, `at most 2 concurrent tasks (saw ${calls.maxActive})`);
  const st = res.rows.filter(r => r.kind === 'static').sort((a, b) => a.idx - b.idx);
  assert.equal(st[1].delivered, 'interpreter'); assert.equal(st[1].deoptKind, 'guard');
  assert.deepEqual(st[1].events.find(e => e.kind === 'fallback'), { kind: 'fallback', model: 'claude-haiku-5-5' });
  assert.equal(st[2].compiledStatus, 'invalid'); assert.equal(st[2].delivered, 'interpreter');
  assert.equal(st[0].delivered, 'compiled'); assert.equal(st[0].version, null);
  assert.deepEqual(calls.interpret.filter(c => c.role === 'fallback').map(c => c.model), ['claude-haiku-5-5', 'claude-haiku-5-5']);
  assert.ok(calls.runCompiled.every(c => c.solve === '// static\n'));
  assert.deepEqual(readdirSync(path.join(root, 'runs/flat')).sort(), ['agent-claude-haiku-5-5', 'agent-claude-opus-5-5', 'static-B1-x-solve']);
  // --arms filter: a second process on one arm finds its rows done and runs nothing
  const before = calls.interpret.length;
  const again = await runStream({ config, deps, arms: ['agent-claude-opus-5-5'], runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.equal(again.arms.length, 1); assert.equal(again.arms[0].done, 0); assert.equal(calls.interpret.length, before);
  const rep = buildReport(path.join(root, 'runs/flat'));
  assert.equal(rep.arms.length, 3);
  close(rep.arms.find(a => a.kind === 'static').totalUsd, 6 * 0.01 + 2 * 0.1, 'static total');
});

test('dry run: plan only, nothing written; config and arm validation', async t => {
  const root = tmp(t);
  const { deps, calls } = fakeDeps(PLAN);
  const out = [];
  const res = await runStream({ config: CONFIG, deps, dry: true, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: x => out.push(x) });
  assert.equal(res.plan.tasks.length, 12); assert.equal(existsSync(path.join(root, 'runs')), false); assert.equal(calls.interpret.length, 0);
  assert.throws(() => parseArm('agent:gpt-unlisted', normalizeConfig(CONFIG), {}), /not in policy\/models.json/);
  assert.throws(() => parseArm('jit:claude-haiku-5-5', normalizeConfig(CONFIG), {}), /<interpreter>\/<compiler>/);
  assert.throws(() => normalizeConfig({ ...CONFIG, split: 'test', segments: [{ seeds: [6001] }] }), /fresh seeds >= 7001/);
  assert.deepEqual(normalizeConfig(CONFIG).segments[0].seeds, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  await assert.rejects(runStream({ config: CONFIG, deps, runRoot: path.join(root, 'runs'), workRoot: path.resolve('experiments/runs/x'), log: () => {} }), /outside the repository/);
});

test('helpers: trace selection keeps every deopt kind, acceptance, worse-on-old-cases, answer comparison', () => {
  const pool = [
    { traceId: 'a', idx: 0, seq: 0, kind: 'warmup' }, { traceId: 'b', idx: 1, seq: 1, kind: 'warmup' }, { traceId: 'g', idx: 4, seq: 2, kind: 'guard' },
    ...Array.from({ length: 8 }, (_, i) => ({ traceId: `s${i}`, idx: 10 + i, seq: 3 + i, kind: 'shadow' })), { traceId: 'j', idx: 20, seq: 11, kind: 'judge' },
  ];
  const sel = selectTraces(pool, 4).map(x => x.traceId);
  assert.deepEqual(sel, ['j', 's7', 's6', 'g'], 'newest first, the old guard deopt kept');
  const ct = (ids, ex) => ({ exact: ex.filter(Boolean).length / ex.length, perCase: ids.map((id, i) => ({ id, exact: ex[i], partial: ex[i] ? 1 : 0.5 })) });
  assert.equal(accepted(ct(['a', 'b', 'c', 'd'], [1, 1, 1, 0])), true);
  assert.equal(accepted(ct(['a', 'b', 'c', 'd'], [1, 1, 0, 0])), false);
  assert.equal(accepted(ct(['a', 'b', 'c', 'reg-1'], [1, 1, 1, 0]), { regressionIds: ['reg-1'] }), false, 'a failing regression case blocks acceptance');
  assert.equal(exactOf({ exact: 3, perCase: [] , cases: 4 }), 0.75);
  assert.equal(worseOnOld(ct(['a', 'b', 'c'], [1, 0, 1]), ct(['a', 'b'], [1, 1])), true);
  assert.equal(worseOnOld(ct(['a', 'b', 'c'], [1, 1, 0]), ct(['a', 'b'], [1, 1])), false, 'a new case failing is not worse on the old cases');
  assert.equal(worseOnOld({ exact: 0.5 }, { exact: 0.8 }), true, 'aggregate fallback without per-case ids');
  assert.equal(worseOnOld(null, { exact: 0.8 }), true);
  // compile.mjs records: positional ids (trace-<i>, newest first) with ref = traceId/caseId, exact as a count, exactRate
  const rec = (pairs, regs = []) => ({ exact: pairs.filter(p => p[1] === 'exact').length, exactRate: pairs.filter(p => p[1] === 'exact').length / pairs.length,
    perCase: pairs.map(([ref, status], i) => ({ id: regs.includes(ref) ? `case-${i}` : `trace-${i}`, ref, kind: regs.includes(ref) ? 'regression' : 'trace', status, ...(status === 'exact' || status === 'diff' ? { exact: status === 'exact' } : {}) })),
    regressions: regs.length, regressionsPassed: pairs.filter(p => regs.includes(p[0]) && p[1] === 'exact').length });
  const oldRec = rec([['t1', 'exact'], ['t0', 'exact']]);
  assert.equal(exactOf(rec([['t2', 'exact'], ['t1', 'exact'], ['t0', 'deopt'], ['t9', 'exact']])), 0.75);
  assert.equal(worseOnOld(rec([['t2', 'exact'], ['t1', 'exact'], ['t0', 'deopt']]), oldRec), true, 'matched by ref although trace-1 moved');
  assert.equal(worseOnOld(rec([['t2', 'diff'], ['t1', 'exact'], ['t0', 'exact']]), oldRec), false);
  assert.equal(accepted(rec([['r1', 'diff'], ['t1', 'exact'], ['t0', 'exact'], ['t2', 'exact'], ['t3', 'exact']], ['r1'])), false, 'the regression case must pass');
  assert.equal(accepted(rec([['r1', 'exact'], ['t1', 'exact'], ['t0', 'exact'], ['t2', 'diff']], ['r1'])), true);
  assert.equal(sameAnswer({ a: [1, 2], b: 1 }, { b: 1, a: [1, 2] }), true);
  assert.equal(sameAnswer({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(sameAnswer({ a: [1, 2] }, { a: [2, 1] }, 'unordered'), true);
  assert.equal(sameAnswer(null, null), false, 'a missing answer never votes');
});
