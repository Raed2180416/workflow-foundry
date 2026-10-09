// The JIT stream state machine at $0: every dependency (interpreter, compiler, compiled runner, oracle, model port)
// is a scripted fake, so the transitions, the per-arm files, resume and cost totals are checked exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStream, normalizeConfig, parseArm, selectTraces, accepted, worseOnOld, rejectReason, exactOnOld, exactOf, sameAnswer, POLICY_MODELS, armPaths } from '../stream.mjs';
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
      calls.runCompiled.push({ idx, version, solve: readFileSync(a.solvePath, 'utf8'), allowedModels: a.allowedModels, flowPath: a.flowPath });
      hooks.runCompiled?.(idx, version);
      const r = plan.compiled(version, idx) ?? { status: 'ok' };
      return { status: r.status, output: r.status === 'ok' ? (r.output ?? TRUTH(a.task.seed)) : null, deopt: r.deopt ?? null, trace: [], costUsd: 0.01, costUnknown: false, latencyMs: 1,
        error: r.error ? { code: r.error } : null, meta: { errors: r.metaErrors ?? {} }, ...(r.flags ? { flags: r.flags } : {}) };
    },
    async compile(a) {
      const callNo = calls.compile.length + 1;
      calls.compile.push({ builderModel: a.builderModel, label: a.label, traceIds: a.traces.map(t => t.traceId), regressionIds: a.regressions.map(r => r.regressionId),
        previous: a.previous, models: a.models, budget: a.builderBudgetUsd, minutes: a.minutes, regressionExpected: a.regressions.map(r => r.expected), promptVersion: a.promptVersion,
        compare: a.compare, relTol: a.relTol, absTol: a.absTol, acceptance: a.acceptance, minPartial: a.minPartial });
      hooks.compile?.(callNo);
      const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
      const solvePath = path.join(workdir, 'solve.mjs'); writeFileSync(solvePath, `// ${a.label}\n`);
      if (plan.notes) writeFileSync(path.join(workdir, 'BUILD-NOTES.md'), plan.notes(callNo, a));
      const checkTraces = plan.checks(callNo, a);
      return { record: { checkTraces, promptVersion: a.promptVersion ?? 1, builderCostUsd: 1, gatewayCostUsd: 0.5, checkCostUsd: 0.25, constructionCostUsd: 1.5, compileCostUsd: 1.75, nestedModelAttempts: 0,
        builderError: plan.builderError?.(callNo) ?? null }, workdir, solvePath };
    },
  };
  return { deps, calls };
}

// A compile.mjs-shaped check record: positional ids (case-<i> regressions, then trace-<i> newest first) with ref, statuses,
// clean (no crash/deopt/timeout, every regression exact) and accepted (clean, every diff explained in BUILD-NOTES.md).
const perCase = (a, statusFor, { explained = true } = {}) => {
  const cases = [...a.regressions.map((r, i) => ({ id: `case-${i}`, ref: r.caseId, kind: 'regression' })), ...a.traces.map((t, i) => ({ id: `trace-${i}`, ref: t.traceId, kind: 'trace' }))];
  const pc = cases.map((c, i) => { const status = statusFor(c, i, cases); return { ...c, status, ...(status === 'exact' || status === 'diff' ? { exact: status === 'exact', partial: status === 'exact' ? 1 : 0.8 } : {}) }; });
  const exact = pc.filter(c => c.status === 'exact').length, bad = pc.filter(c => ['deopt', 'crash', 'timeout'].includes(c.status)).length;
  const clean = bad === 0 && pc.filter(c => c.kind === 'regression').every(c => c.status === 'exact');
  const diffs = pc.filter(c => c.status === 'diff').map(c => c.id);
  return { exact, exactRate: exact / pc.length, partial: 0.9, deopts: pc.filter(c => c.status === 'deopt').length, crashes: 0, deoptKinds: {}, perCase: pc, clean,
    unexplained: explained ? [] : diffs, accepted: clean && (explained || !diffs.length) };
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
    if (callNo === 1) return perCase(a, (c, i) => (i === 0 ? 'exact' : 'deopt'));   // v1 Haiku: a deopt, not clean, not accepted -> Opus fallback
    if (callNo === 2) return perCase(a, () => 'exact');                               // v1 Opus: accepted, adopted
    if (callNo === 3) return perCase(a, () => 'exact');                               // v2: recompile after 2 deopts
    // v3: accepted (its one diff is explained in BUILD-NOTES.md) but fewer exact on v2's old cases -> rejected, no fallback
    if (callNo === 4) return perCase(a, (c, i, all) => (c.ref === all.filter(x => x.ref?.includes('-interpreter-')).at(-1).ref ? 'diff' : 'exact'));
    return perCase(a, () => 'exact');
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
  assert.match(by(8).events.find(e => e.kind === 'rejected').why, /fewer exact on the old cases \(4 < 5 of 5\)/);
  assert.equal(calls.compile.length, compileCalls, 'v3 was accepted so no Opus fallback, and nothing else compiles');
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
  assert.deepEqual(readdirSync(p.dir).sort(), ['arm.json', 'events.jsonl', 'regressions', 'results.jsonl', 'traces', 'versions'], 'and the lock is released');
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
  // one process per arm: a live owner's lock refuses a second runner; a dead owner's lock is taken over
  const lock = path.join(root, 'runs/flat/agent-claude-opus-5-5/.lock');
  writeFileSync(lock, String(process.ppid));
  await assert.rejects(runStream({ config, deps, arms: ['agent-claude-opus-5-5'], runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} }), /in use by process/);
  writeFileSync(lock, '999999999');
  const taken = await runStream({ config, deps, arms: ['agent-claude-opus-5-5'], runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.equal(taken.arms[0].errors.length, 0); assert.equal(existsSync(lock), false, 'released at the end');
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
  const ct = (ids, ex, clean = true) => ({ clean, accepted: clean, exact: ex.filter(Boolean).length, perCase: ids.map((id, i) => ({ id, exact: ex[i], partial: ex[i] ? 1 : 0.5 })) });
  assert.equal(accepted(ct(['a'], [1])), true); assert.equal(accepted({ exactRate: 1, clean: true }), false, 'acceptance is compile.mjs\'s verdict only');
  assert.equal(exactOf({ exact: 3, perCase: [] , cases: 4 }), 0.75);
  assert.equal(worseOnOld(ct(['a', 'b', 'c'], [1, 0, 1]), ct(['a', 'b'], [1, 1])), true);
  assert.equal(worseOnOld(ct(['a', 'b', 'c'], [1, 1, 0]), ct(['a', 'b'], [1, 1])), false, 'a new case failing is not worse on the old cases');
  assert.equal(rejectReason(ct(['a', 'b'], [1, 1], false), ct(['a', 'b'], [1, 1])), 'not clean', 'a recompiled version must be clean');
  assert.equal(rejectReason(ct(['a', 'b'], [1, 1]), null), null, 'the first version is not compared');
  assert.equal(worseOnOld({ clean: true, exactRate: 0.5 }, { exactRate: 0.8 }), true, 'aggregate fallback without per-case ids');
  assert.equal(worseOnOld(null, { exact: 0.8 }), true);
  // compile.mjs records: positional ids (trace-<i>, newest first) with ref = traceId/caseId, exact as a count, exactRate
  const rec = (pairs, regs = []) => ({ exact: pairs.filter(p => p[1] === 'exact').length, exactRate: pairs.filter(p => p[1] === 'exact').length / pairs.length,
    perCase: pairs.map(([ref, status], i) => ({ id: regs.includes(ref) ? `case-${i}` : `trace-${i}`, ref, kind: regs.includes(ref) ? 'regression' : 'trace', status, ...(status === 'exact' || status === 'diff' ? { exact: status === 'exact' } : {}) })),
    regressions: regs.length, regressionsPassed: pairs.filter(p => regs.includes(p[0]) && p[1] === 'exact').length });
  const oldRec = rec([['t1', 'exact'], ['t0', 'exact']]);
  assert.equal(exactOf(rec([['t2', 'exact'], ['t1', 'exact'], ['t0', 'deopt'], ['t9', 'exact']])), 0.75);
  assert.equal(worseOnOld({ ...rec([['t2', 'exact'], ['t1', 'exact'], ['t0', 'diff']]), clean: true }, oldRec), true, 'matched by ref although trace-1 moved');
  assert.equal(worseOnOld({ ...rec([['t2', 'diff'], ['t1', 'exact'], ['t0', 'exact']]), clean: true }, oldRec), false);
  assert.deepEqual(exactOnOld(rec([['t2', 'diff'], ['t1', 'exact'], ['t0', 'exact']]), oldRec), { shared: 2, oldExact: 2, newExact: 2 });
  assert.equal(sameAnswer({ a: [1, 2], b: 1 }, { b: 1, a: [1, 2] }), true);
  assert.equal(sameAnswer({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(sameAnswer({ a: [1, 2] }, { a: [2, 1] }, 'unordered'), true);
  assert.equal(sameAnswer(null, null), false, 'a missing answer never votes');
});

test('a host check with budget deopts is re-run once at twice checkUsd before acceptance is judged; its cost is billed', async t => {
  const root = tmp(t);
  const plan = { compiled: () => ({ status: 'ok' }), checks: (n, a) => ({ ...perCase(a, () => 'deopt'), deoptKinds: { budget: 2 } }) };
  const { deps, calls } = fakeDeps(plan);
  const rechecks = [];
  deps.recheck = async a => { rechecks.push(a); return { summary: { exact: a.traces.length, exactRate: 1, clean: true, deoptKinds: {}, perCase: a.traces.map((x, i) => ({ id: `trace-${i}`, ref: x.traceId, kind: 'trace', status: 'exact', exact: true })) }, costUsd: 0.4 }; };
  const config = { ...CONFIG, experiment: 'recheck', segments: [{ difficulty: 3, seeds: [1, 2, 3] }], jit: { ...CONFIG.jit, warmup: 1, shadowEvery: 0 }, compile: { checkUsd: 1.25 } };
  const res = await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  const rows = [...res.rows].sort((a, b) => a.idx - b.idx);
  assert.equal(rechecks.length, 1); assert.equal(rechecks[0].capUsd, 2.5); assert.match(rechecks[0].label, /^v1-haiku55-recheck$/);
  assert.equal(calls.compile.length, 1, 'the recheck passed: no Opus fallback');
  assert.ok(kinds(rows[1]).includes('recheck')); assert.equal(rows[1].events.find(e => e.kind === 'compile').accepted, true);
  close(rows[1].costBreakdown.compileCheck, 0.25 + 0.4, 'first check + recheck');
  assert.equal(rows[2].delivered, 'compiled');
  const rec = JSON.parse(readFileSync(path.join(root, 'runs/recheck/jit-claude-sonnet-5-5--claude-haiku-5-5/versions/v1-haiku55/compile.json'), 'utf8'));
  assert.equal(rec.checkTraces.accepted, true); assert.equal(rec.checkTraces.recheck.firstCheck.deoptKinds.budget, 2);
});

// ---- the stream through the real interpret() and runCompiled(): stand-in CLI in each workdir, scripted gateway ----
import { chmodSync, copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { interpret as realInterpret } from '../interpret.mjs';
import { runCompiled as realRunCompiled } from '../run-compiled.mjs';

test('stream with the real interpret and runCompiled: static deopt and crash fall back to the agent; costs flow from the CLI and the gateway', { skip: sandboxAvailable() ? false : 'no user namespaces' }, async t => {
  const root = tmp(t);
  const cli = path.join(root, 'fake-claude');
  writeFileSync(cli, `#!/bin/sh
cat > /dev/null
seed=$(grep -o '"seed": [0-9]*' inputs.json | grep -o '[0-9]*$')
printf 'print(%s)\\n' "$seed" > work.py
printf '{"records":[{"id":%s}]}' "$seed" > answer.json
echo '{"type":"system","subtype":"init","session_id":"s"}'
echo '{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","name":"Bash","input":{"command":"python3 work.py"}}]}}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0.05,"num_turns":1}'
`); chmodSync(cli, 0o755);
  const solve = path.join(root, 'B1-t', 'solve.mjs'); mkdirSync(path.dirname(solve));
  writeFileSync(solve, `import { readFileSync, writeFileSync } from 'node:fs';
import { callModel } from './tools/model.mjs';
const task = JSON.parse(readFileSync(process.argv[2], 'utf8')), seed = task.inputs.seed;
if (seed === 2) { writeFileSync('deopt.json', JSON.stringify({ kind: 'guard', name: 'seed-two' })); process.exit(75); }
if (seed === 3) throw new Error('unexpected input');
if (seed === 4) await callModel({ model: 'claude-haiku-5-5', prompt: 'x' });
console.log(JSON.stringify({ records: [{ id: seed }] }));`);
  const MODELS = [...POLICY_MODELS];
  const port = new ModelPort({ policy: subsetPolicy(loadPolicy().policy, MODELS), journal: new Journal(new DatabaseSync(':memory:')),
    providers: { 'claude-cli': new ScriptedProvider(() => ({ value: { text: 'ok' }, costUsd: 0.02 })) } });
  const { deps } = fakeDeps({ compiled: () => null, checks: () => null });
  Object.assign(deps, {
    outputSchema: { type: 'object', required: ['records'], properties: { records: { type: 'array' } } },
    score: async (f, task, output) => ({ pass: output?.records?.[0]?.id === task.seed, score: 1 }),
    createModelPort: () => ({ port }),
    // the real interpreter, with the stand-in CLI planted in its workdir (the sandbox shows the workdir only)
    interpret: async a => { copyFileSync(cli, path.join(a.workdir, 'fake-claude')); chmodSync(path.join(a.workdir, 'fake-claude'), 0o755); return realInterpret({ ...a, binary: path.join(a.workdir, 'fake-claude') }); },
    runCompiled: realRunCompiled,
  });
  const config = { ...CONFIG, experiment: 'live-shape', familyId: 'records', segments: [{ difficulty: 3, seeds: [1, 2, 3, 4] }], arms: ['agent:claude-haiku-5-5', `static:${solve}`], concurrency: 2, agentMinutes: 1, compiledMinutes: 1 };
  const res = await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.ok(res.arms.every(a => a.errors.length === 0 && a.done === 4), JSON.stringify(res.arms));
  const st = res.rows.filter(r => r.kind === 'static').sort((a, b) => a.idx - b.idx);
  assert.deepEqual(st.map(r => [r.delivered, r.compiledStatus, r.pass]), [['compiled', 'ok', true], ['interpreter', 'deopt', true], ['interpreter', 'crash', true], ['compiled', 'ok', true]]);
  assert.equal(st[1].deoptKind, 'guard');
  close(st.reduce((s, r) => s + r.costUsd, 0), 0.02 + 2 * 0.05, 'static: one gateway call and two fallback sessions');
  const ag = res.rows.filter(r => r.kind === 'agent');
  assert.ok(ag.every(r => r.pass)); close(ag.reduce((s, r) => s + r.costUsd, 0), 4 * 0.05, 'agent');
  const trace = JSON.parse(readFileSync(path.join(root, 'runs/live-shape/agent-claude-haiku-5-5/traces', `${ag[0].traceId}.json`), 'utf8'));
  assert.deepEqual(trace.scripts.map(s => s.path), ['work.py']); assert.deepEqual(trace.commands, ['python3 work.py']);
});

// ---- JIT v2 (opt-in): uncertainty flags, flag-triggered shadows, shadowEvery 0, compile.promptVersion ----
import { renderMarkdown } from '../report.mjs';

// Arm hashes of the live v1 dev configs, taken from the code before the v2 options existed (commit 59938e5).
const V1_HASHES = {
  'dev-records-1': { 'agent:claude-haiku-5-5': '838a9040ccea77e5', 'agent:claude-sonnet-5-5': 'd5f76da861452d98', 'agent:claude-opus-5-5': 'e83c0b59e1d5681e',
    'static:research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs': 'ca4f763d5d03568e', 'jit:claude-haiku-5-5/claude-haiku-5-5': 'b1e7a0d2b8ae7d67',
    'jit:claude-sonnet-5-5/claude-haiku-5-5': 'bba591195f4de46c', 'jit:claude-opus-5-5/claude-haiku-5-5': '2e70574b6dc900d5' },
  'dev-kinetics-1': { 'agent:claude-haiku-5-5': '2e292709027b2786', 'agent:claude-sonnet-5-5': '17b451b20087e9a1', 'jit:claude-haiku-5-5/claude-haiku-5-5': 'd27d59e72f054502',
    'jit:claude-sonnet-5-5/claude-haiku-5-5': 'eaabbde77c7bbf68', 'jit:claude-opus-5-5/claude-haiku-5-5': '930045b2ad53db51' },
};
const hashes = raw => { const c = normalizeConfig(raw); return Object.fromEntries(c.arms.map(a => [a, parseArm(a, c, { policyIds: [...POLICY_MODELS] }).hash])); };

test('v2 defaults: the live v1 configs keep their arm hashes; v2 options at their defaults change nothing; set, they define a new arm', () => {
  for (const [name, want] of Object.entries(V1_HASHES)) {
    const raw = JSON.parse(readFileSync(new URL(`../configs/${name}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(hashes(raw), want, `${name}: arm hashes unchanged`);
    const explicit = { ...raw, jit: { ...raw.jit, shadowOnFlags: false }, compile: { ...raw.compile, promptVersion: 1 } };
    assert.deepEqual(hashes(explicit), want, `${name}: explicit defaults change no hash`);
    const c = normalizeConfig(explicit);
    assert.equal('shadowOnFlags' in c.jit, false); assert.equal('promptVersion' in c.compile, false);
    const jitArm = Object.keys(want).find(a => a.startsWith('jit:'));
    assert.notEqual(hashes({ ...raw, jit: { ...raw.jit, shadowOnFlags: true } })[jitArm], want[jitArm], 'shadowOnFlags defines a new arm');
    assert.notEqual(hashes({ ...raw, compile: { ...raw.compile, promptVersion: 2 } })[jitArm], want[jitArm], 'promptVersion 2 defines a new arm');
    assert.equal(hashes({ ...raw, jit: { ...raw.jit, shadowOnFlags: true } })['agent:claude-haiku-5-5'], want['agent:claude-haiku-5-5'], 'agent arms do not hash jit options');
  }
  assert.throws(() => normalizeConfig({ ...CONFIG, jit: { shadowEvery: -1 } }), /shadowEvery must be an integer >= 0/);
  assert.throws(() => normalizeConfig({ ...CONFIG, jit: { shadowEvery: 1.5 } }), /shadowEvery must be an integer >= 0/);
  assert.throws(() => normalizeConfig({ ...CONFIG, jit: { shadowOnFlags: 'yes' } }), /shadowOnFlags must be true or false/);
  assert.throws(() => normalizeConfig({ ...CONFIG, compile: { promptVersion: 4 } }), /promptVersion must be one of 1, 2, 3/);
  assert.throws(() => normalizeConfig({ ...CONFIG, compile: { fallback: { promptVersion: 3 } } }), /compile\.fallback\.promptVersion is not supported/);
  assert.throws(() => normalizeConfig({ ...CONFIG, compile: { promptVersion: 2, fallback: { promptVersion: 2 } } }), /compile\.fallback\.promptVersion is not supported/);
  assert.equal(normalizeConfig({ ...CONFIG, jit: { shadowEvery: 0, shadowOnFlags: true } }).jit.shadowOnFlags, true);
});

// Warmup 1, then compiled runs at idx 1..5. Flags at idx 2, 3, 5; idx 3's compiled answer is wrong; idx 5's shadow gives no
// answer. The checks accept every compile.
const FLAGS = { 2: { count: 1, names: ['weak-name-match'] }, 3: { count: 2, names: ['weak-name-match', 'judge-escalated:status'] }, 5: { count: 1, names: ['default-used'] } };
const FLAG_PLAN = {
  interpret: (idx, role) => (idx === 5 && role === 'shadow' ? null : undefined),
  compiled: (version, idx) => ({ status: 'ok', ...(idx === 3 ? { output: { v: -1 } } : {}), ...(FLAGS[idx] ? { flags: FLAGS[idx] } : {}) }),
  checks: (n, a) => perCase(a, () => 'exact'),
};
const FLAG_CONFIG = { ...CONFIG, experiment: 'jit-flags', segments: [{ difficulty: 3, seeds: '1..6' }], jit: { ...CONFIG.jit, warmup: 1, shadowEvery: 0, shadowOnFlags: true } };
const FLAG_SLUG = 'jit-claude-sonnet-5-5--claude-haiku-5-5';

function checkFlagScenario(rows, calls) {
  const by = i => rows.find(r => r.idx === i);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map(r => r.shadowReason ?? null), [null, null, 'flag', 'flag', null, 'flag'], 'shadowEvery 0: only flagged compiled runs are shadowed');
  assert.deepEqual(by(2).events.find(e => e.kind === 'shadow'), { kind: 'shadow', version: 1, agree: true, reason: 'flag' });
  assert.deepEqual(by(2).flags, FLAGS[2]); assert.equal(by(2).events.find(e => e.kind === 'compiled').flags, 1); assert.equal(by(2).delivered, 'compiled');
  // the flagged wrong answer: the shadow disagrees, the adjudicator sides with it -> adjudicated, regression, recompile
  assert.deepEqual(kinds(by(3)).filter(k => ['shadow', 'disagree', 'adjudicate', 'regression'].includes(k)), ['shadow', 'disagree', 'adjudicate', 'regression']);
  assert.equal(by(3).delivered, 'adjudicated'); assert.equal(by(3).pass, true);
  assert.equal(by(3).compiledPass, false, 'the oracle on the compiled answer that was replaced (row only)');
  assert.ok(rows.filter(r => r.idx !== 3).every(r => !('compiledPass' in r)), 'only rows whose compiled answer was not delivered');
  assert.ok(kinds(by(4)).includes('recompile')); assert.equal(by(4).version, 2); assert.equal(by(4).shadowReason, undefined);
  assert.equal(calls.compile.length, 2); assert.deepEqual(calls.compile[1].regressionExpected, [{ v: 4 }]);
  assert.deepEqual(by(5).events.find(e => e.kind === 'shadow'), { kind: 'shadow', version: 2, agree: null, note: 'shadow gave no answer', reason: 'flag' });
  assert.equal(by(1).events.some(e => e.kind === 'shadow'), false); assert.equal('flags' in by(1), false); assert.equal('flags' in by(1).events.find(e => e.kind === 'compiled'), false);
  assert.deepEqual(calls.interpret.map(c => [c.idx, c.role]).sort(), [[0, 'interpreter'], [2, 'shadow'], [3, 'adjudicator'], [3, 'shadow'], [5, 'shadow']]);
  assert.equal(rows.filter(r => r.pass).length, 6);
  // the flag shadows change no JIT state beyond what a scheduled shadow would: compiledOks counts compiled oks only
  assert.equal(by(5).stateAfter.compiledOks, 5);
}

test('shadowOnFlags with shadowEvery 0: flag-only shadows (reason flag), adjudication and regression on a flagged wrong answer; costs exact; the report shows flag precision', async t => {
  const root = tmp(t);
  const { deps, calls } = fakeDeps(FLAG_PLAN);
  const res = await runStream({ config: FLAG_CONFIG, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(res.arms.map(a => a.errors), [[]]);
  const rows = [...res.rows].sort((a, b) => a.idx - b.idx);
  checkFlagScenario(rows, calls);
  // 5 interpretations x $0.1, 5 compiled runs x $0.01, 2 compiles x $1.75
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  close(total, 5 * 0.1 + 5 * 0.01 + 2 * 1.75, 'total');
  close(rows.reduce((s, r) => s + (r.costBreakdown.shadow ?? 0), 0), 0.3, 'shadow spend');
  const p = armPaths(path.join(root, 'runs/jit-flags'), FLAG_SLUG);
  close(readJsonl(p.events).filter(e => e.kind === 'spend').reduce((s, e) => s + e.costUsd, 0), total, 'events = rows');
  const rep = buildReport(path.join(root, 'runs/jit-flags'));
  const f = rep.arms[0].flags;
  assert.equal(f.flaggedRuns, 3); assert.equal(f.flagsRaised, 4); assert.deepEqual(f.runsByFlagName, { 'weak-name-match': 2, 'judge-escalated:status': 1, 'default-used': 1 });
  assert.deepEqual(f.scheduled, { ...{ shadows: 0, answered: 0, disagreements: 0, regressions: 0, disagreeRate: null, costUsd: 0 }, flagged: { shadows: 0, answered: 0, disagreements: 0, regressions: 0, disagreeRate: null, costUsd: 0 }, unflagged: { shadows: 0, answered: 0, disagreements: 0, regressions: 0, disagreeRate: null, costUsd: 0 } });
  assert.equal(f.baseRate, null); assert.equal(f.recall, null); assert.equal(f.compiledOk, 5); assert.equal(f.flagRate, 0.6);
  assert.deepEqual(f.flagTriggered, { shadows: 3, answered: 2, disagreements: 1, regressions: 1, disagreeRate: 0.5, costUsd: 0.4 });
  assert.equal(f.flagOnly, 3); assert.equal(f.flagOnlyCostUsd, 0.4, 'three shadows and one adjudicator'); assert.equal(f.flagPrecision, 0.5);
  // the compiled answer is scored, not the delivered one: idx 3's wrong compiled answer counts as a flagged failure
  assert.deepEqual(f.oracle, { flagged: { runs: 3, compiledPass: 2, scored: 3, notDelivered: 1 }, unflagged: { runs: 2, compiledPass: 2, scored: 2, notDelivered: 0 } });
  assert.equal(rep.arms[0].counts.shadows, 3); assert.equal(rep.arms[0].counts.disagreements, 1);
  const md = renderMarkdown(rep);
  assert.match(md, /## Uncertainty flags and flag-triggered shadows/);
  assert.match(md, /\| jit:claude-sonnet-5-5\/claude-haiku-5-5 \| 3\/5 \(60\.0%\), 4 \| 0 \| no base rate, recall not measurable \(no answered scheduled shadow\) \| – \| 3 \(3, \$0\.400\) \| 1\/2 \(50\.0%\) \| 1 \| 2\/3, 2\/2 \|/);
});

test('shadowOnFlags with a schedule: rows record schedule, flag or schedule+flag; one shadow per row', async t => {
  const root = tmp(t);
  const flags = { 2: { count: 1, names: ['a|b'] }, 3: { count: 1, names: ['b'] } };
  const { deps, calls } = fakeDeps({ compiled: (v, idx) => ({ status: 'ok', ...(flags[idx] ? { flags: flags[idx] } : {}) }), checks: (n, a) => perCase(a, () => 'exact') });
  const config = { ...FLAG_CONFIG, experiment: 'jit-mixed', jit: { ...FLAG_CONFIG.jit, shadowEvery: 2 } };
  const res = await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  const rows = [...res.rows].sort((a, b) => a.idx - b.idx);
  assert.deepEqual(rows.map(r => r.shadowReason ?? null), [null, null, 'schedule+flag', 'flag', 'schedule', null]);
  assert.deepEqual(rows.map(r => r.events.filter(e => e.kind === 'shadow').map(e => e.reason)), [[], [], ['schedule+flag'], ['flag'], ['schedule'], []]);
  assert.equal(calls.interpret.filter(c => c.role === 'shadow').length, 3);
  const f = buildReport(path.join(root, 'runs/jit-mixed')).arms[0].flags;
  assert.equal(f.scheduled.shadows, 2); assert.equal(f.flagTriggered.shadows, 2); assert.equal(f.flagOnly, 1); assert.equal(f.flagPrecision, 0);
  assert.equal(f.scheduled.flagged.shadows, 1, 'idx 2: schedule+flag'); assert.equal(f.scheduled.unflagged.shadows, 1, 'idx 4: schedule only');
  assert.equal(f.baseRate, 0); assert.equal(f.recall, null, 'no scheduled disagreement: recall not measurable');
  const md = renderMarkdown(buildReport(path.join(root, 'runs/jit-mixed')));
  const line = md.split('\n').find(l => l.startsWith('| jit:') && l.includes('a b 1'));
  assert.ok(line, 'a | in a flag name is escaped'); assert.equal(line.split('|').length, 12, 'ten cells, none added by the flag name');
});

test('without shadowOnFlags, flags never trigger a shadow and shadow events carry no reason (v1 behaviour); shadowEvery 0 means no shadows', async t => {
  const root = tmp(t);
  const { deps, calls } = fakeDeps(FLAG_PLAN);
  const v1 = { ...FLAG_CONFIG, experiment: 'jit-noflags', jit: { ...CONFIG.jit, warmup: 1, shadowEvery: 0 } };
  const res = await runStream({ config: v1, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  const rows = [...res.rows].sort((a, b) => a.idx - b.idx);
  assert.equal(calls.interpret.filter(c => c.role !== 'interpreter').length, 0, 'no shadow, no adjudicator');
  assert.ok(rows.every(r => !('shadowReason' in r)));
  assert.equal(rows[3].delivered, 'compiled'); assert.equal(rows[3].pass, false, 'the flagged wrong answer goes out unchecked');
  assert.deepEqual(rows[3].flags, FLAGS[3], 'flags are still recorded on the row');
  const rep = buildReport(path.join(root, 'runs/jit-noflags'));
  assert.equal(rep.arms[0].flags.flagTriggered.shadows, 0); assert.equal(rep.arms[0].flags.flaggedRuns, 3);
  // a scheduled shadow keeps the v1 event shape exactly
  const { deps: d2 } = fakeDeps(FLAG_PLAN);
  const sched = await runStream({ config: { ...v1, experiment: 'jit-sched', jit: { ...v1.jit, shadowEvery: 2 } }, deps: d2, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  const r2 = sched.rows.find(r => r.idx === 2);
  assert.deepEqual(r2.events.find(e => e.kind === 'shadow'), { kind: 'shadow', version: 1, agree: true }); assert.equal('shadowReason' in r2, false);
  // the report still counts them as scheduled shadows (no shadowReason without shadowOnFlags), split by flagged and unflagged
  const fs = buildReport(path.join(root, 'runs/jit-sched')).arms[0].flags;
  assert.equal(fs.scheduled.shadows, 2); assert.equal(fs.scheduled.answered, 2); assert.equal(fs.scheduled.flagged.shadows, 1); assert.equal(fs.scheduled.unflagged.shadows, 1);
  assert.equal(fs.flagTriggered.shadows, 0); assert.equal(fs.baseRate, 0);
  assert.ok(sched.rows.every(r => !('compiledPass' in r)), 'a v1 arm records no compiledPass');
  // and a v1 run without any flags yields no flag summary in the report
  const { deps: d3 } = fakeDeps({ compiled: () => ({ status: 'ok' }), checks: (n, a) => perCase(a, () => 'exact') });
  await runStream({ config: { ...v1, experiment: 'jit-plain' }, deps: d3, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  const plain = buildReport(path.join(root, 'runs/jit-plain'));
  assert.equal('flags' in plain.arms[0], false); assert.doesNotMatch(renderMarkdown(plain), /Uncertainty flags/);
});

test('resume through a flag-triggered shadow: a crash in the adjudicator, then a resume, gives the same rows; the crashed attempt is billed', async t => {
  const root = tmp(t);
  const opts = { config: FLAG_CONFIG, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} };
  let crashed = false;
  const { deps, calls } = fakeDeps(FLAG_PLAN, { interpret(idx, role) { if (idx === 3 && role === 'adjudicator' && !crashed) { crashed = true; throw new Error('process died (adjudicator)'); } } });
  const r1 = await runStream({ ...opts, deps });
  assert.match(r1.arms[0].errors[0], /process died \(adjudicator\)/); assert.equal(r1.rows.length, 3);
  const r2 = await runStream({ ...opts, deps });
  assert.deepEqual(r2.arms[0].errors, []); assert.equal(r2.arms[0].done, 3);
  const rows = [...r2.rows].sort((a, b) => a.idx - b.idx);
  calls.interpret = calls.interpret.filter((c, i, all) => !(c.idx === 3 && all.findIndex(x => x.idx === 3 && x.role === c.role) !== i));   // the retried idx-3 calls, once
  checkFlagScenario(rows, calls);
  close(rows[3].orphanUsd, 0.1 + 0.01, 'the crashed attempt\'s compiled run and shadow are billed to idx 3');
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  close(total, 5 * 0.1 + 5 * 0.01 + 2 * 1.75 + 0.11, 'total');
  const p = armPaths(path.join(root, 'runs/jit-flags'), FLAG_SLUG);
  close(readJsonl(p.events).filter(e => e.kind === 'spend').reduce((s, e) => s + e.costUsd, 0), total, 'events = rows');
  assert.equal(readJsonl(p.results).length, 6, 'no row written twice');
});

test('compile.promptVersion 2 reaches every compile attempt (the Opus fallback too) and its result; absent, nothing is passed', async t => {
  const root = tmp(t);
  const plan = { compiled: () => ({ status: 'ok' }), checks: (n, a) => (n === 1 ? perCase(a, () => 'deopt') : perCase(a, () => 'exact')) };
  const { deps, calls } = fakeDeps(plan);
  const config = { ...CONFIG, experiment: 'jit-pv2', segments: [{ difficulty: 3, seeds: [1, 2, 3] }], jit: { ...CONFIG.jit, warmup: 1, shadowEvery: 0 }, compile: { promptVersion: 2 } };
  await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(calls.compile.map(c => [c.builderModel, c.promptVersion]), [['claude-haiku-5-5', 2], ['claude-opus-5-5', 2]]);
  const ev = readJsonl(armPaths(path.join(root, 'runs/jit-pv2'), FLAG_SLUG).events).filter(e => e.kind === 'compile-attempt');
  assert.deepEqual(ev.map(e => e.result.promptVersion), [2, 2]);
  assert.ok(calls.runCompiled.length > 0 && calls.runCompiled.every(c => c.flowPath === fileURLToPath(new URL('../flow-v2.mjs', import.meta.url))), 'version 2 solvers run on flow-v2.mjs');
  // a v2 arm that never flags still gets a flag summary (0 flags), not a silent v1-looking report
  const rep2 = buildReport(path.join(root, 'runs/jit-pv2'));
  assert.equal(rep2.arms[0].flags.flaggedRuns, 0); assert.equal(rep2.arms[0].flags.flagRate, 0);
  assert.match(renderMarkdown(rep2), /no base rate, recall not measurable/);
  const { deps: d1, calls: c1 } = fakeDeps(plan);
  await runStream({ config: { ...config, experiment: 'jit-pv1', compile: {} }, deps: d1, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(c1.compile.map(c => c.promptVersion), [undefined, undefined]);
  assert.ok(c1.runCompiled.every(c => c.flowPath === undefined), 'version 1: run-compiled keeps its default (flow.mjs), nothing passed');
  assert.equal('flags' in buildReport(path.join(root, 'runs/jit-pv1')).arms[0], false);
  const ev1 = readJsonl(armPaths(path.join(root, 'runs/jit-pv1'), FLAG_SLUG).events).filter(e => e.kind === 'compile-attempt');
  assert.ok(ev1.every(e => !('promptVersion' in e.result)));
});

// ---- JIT v2.1 (opt-in): tolerant shadows/adjudication, compile.compare, strict acceptance, prompt v3 ----
test('v2.1 defaults: the live configs keep their arm hashes with the v2.1 options written out at their defaults; set, each defines a new arm', () => {
  for (const [name, want] of Object.entries(V1_HASHES)) {
    const raw = JSON.parse(readFileSync(new URL(`../configs/${name}.json`, import.meta.url), 'utf8'));
    const explicit = { ...raw, compile: { ...raw.compile, compare: 'canonical', acceptance: 'named', promptVersion: 1 } };
    assert.deepEqual(hashes(explicit), want, `${name}: explicit v2.1 defaults change no hash`);
    const c = normalizeConfig(explicit);
    for (const k of ['compare', 'relTol', 'absTol', 'acceptance', 'minPartial', 'promptVersion']) assert.equal(k in c.compile, false, `compile.${k} dropped at its default`);
    assert.equal('relTol' in c.jit, false); assert.equal('absTol' in c.jit, false); assert.equal(c.jit.compare, 'unordered', 'the live configs\' own setting is kept');
    const jitArm = Object.keys(want).find(a => a.startsWith('jit:'));
    const variants = { tolerantShadows: { jit: { ...raw.jit, compare: 'tolerant' } }, tolerantCompile: { compile: { ...raw.compile, compare: 'tolerant' } },
      strict: { compile: { ...raw.compile, acceptance: 'strict', promptVersion: 3 } }, v3: { compile: { ...raw.compile, promptVersion: 3 } },
      keyed: { jit: { ...raw.jit, compare: 'tolerant', tolerantKeys: ['vmax', 'km'] } } };
    const seen = new Set([want[jitArm]]);
    for (const [k, v] of Object.entries(variants)) {
      const h = hashes({ ...raw, ...v });
      assert.ok(!seen.has(h[jitArm]), `${name}: ${k} defines a new arm`); seen.add(h[jitArm]);
      assert.equal(h['agent:claude-haiku-5-5'], want['agent:claude-haiku-5-5'], `${k}: agent arms do not hash jit/compile options`);
    }
    // Tolerances at their defaults hash the same written out or not; a different tolerance is a different arm.
    assert.deepEqual(hashes({ ...raw, jit: { ...raw.jit, compare: 'tolerant', relTol: 0.01, absTol: 1e-9 } }), hashes({ ...raw, ...variants.tolerantShadows }));
    assert.notDeepEqual(hashes({ ...raw, jit: { ...raw.jit, compare: 'tolerant', relTol: 0.02 } }), hashes({ ...raw, ...variants.tolerantShadows }));
    assert.deepEqual(hashes({ ...raw, compile: { ...raw.compile, acceptance: 'strict', promptVersion: 3, minPartial: 0.9 } }), hashes({ ...raw, ...variants.strict }));
    assert.deepEqual(hashes({ ...raw, jit: { ...raw.jit, compare: 'tolerant', allowLooseTolerance: false } }), hashes({ ...raw, ...variants.tolerantShadows }), 'allowLooseTolerance false is the default');
    assert.deepEqual(hashes({ ...raw, jit: { ...raw.jit, compare: 'tolerant', tolerantKeys: ['km', 'vmax', 'km'] } }), hashes({ ...raw, ...variants.keyed }), 'tolerantKeys are a set');
  }
});

test('v2.1 config validation and normalisation', () => {
  const n = x => normalizeConfig({ ...CONFIG, ...x });
  assert.deepEqual(n({ jit: { compare: 'tolerant' } }).jit, { ...n({ jit: {} }).jit, compare: 'tolerant', relTol: 0.01, absTol: 1e-9 });
  assert.equal(n({ jit: { compare: 'tolerant', relTol: 0.05 }, compile: { compare: 'tolerant' } }).compile.relTol, 0.05, 'compile inherits the shadow tolerance');
  assert.equal(n({ jit: { compare: 'tolerant', relTol: 0.05 }, compile: { compare: 'tolerant', relTol: 0.02 } }).compile.relTol, 0.02);
  assert.deepEqual(['compare', 'relTol', 'absTol'].map(k => n({ compile: { compare: 'tolerant' } }).compile[k]), ['tolerant', 0.01, 1e-9]);
  const strict = n({ compile: { acceptance: 'strict', promptVersion: 3 } }).compile;
  assert.deepEqual([strict.acceptance, strict.minPartial], ['strict', 0.9]);
  // A tolerant stream makes the host check tolerant too (its regression cases come from tolerant adjudications), with
  // the shadow tolerance, keys and loose flag; an explicit canonical host check is refused.
  const inherit = n({ jit: { compare: 'tolerant', relTol: 0.02, tolerantKeys: ['vmax', 'km'] } });
  assert.deepEqual(inherit.compile, { ...n({}).compile, compare: 'tolerant', relTol: 0.02, absTol: 1e-9, tolerantKeys: ['km', 'vmax'] });
  assert.deepEqual(inherit.jit.tolerantKeys, ['km', 'vmax']);
  assert.throws(() => n({ jit: { compare: 'tolerant' }, compile: { compare: 'canonical' } }), /compile\.compare 'canonical' with jit\.compare 'tolerant'/);
  // Loose tolerances must be asked for, and the request is part of the arm.
  assert.throws(() => n({ jit: { compare: 'tolerant', relTol: 0.1 } }), /looser than 0\.05/);
  assert.throws(() => n({ compile: { compare: 'tolerant', absTol: 1e-3 } }), /looser than/);
  const loose = n({ jit: { compare: 'tolerant', relTol: 0.1, allowLooseTolerance: true } });
  assert.deepEqual([loose.jit.allowLooseTolerance, loose.compile.allowLooseTolerance, loose.compile.relTol], [true, true, 0.1]);
  assert.equal('allowLooseTolerance' in n({ jit: { compare: 'tolerant', allowLooseTolerance: false } }).jit, false);
  assert.equal(n({ compile: { promptVersion: 3 } }).compile.promptVersion, 3);
  for (const [bad, re] of [[{ jit: { compare: 'fuzzy' } }, /jit\.compare must be one of canonical, unordered, tolerant/], [{ jit: { relTol: 0.01 } }, /jit\.relTol, absTol, tolerantKeys and allowLooseTolerance need jit\.compare 'tolerant'/], [{ jit: { tolerantKeys: ['vmax'] } }, /need jit\.compare 'tolerant'/],
    [{ jit: { compare: 'tolerant', tolerantKeys: 'vmax' } }, /tolerantKeys must be a non-empty list/], [{ compile: { acceptance: 'strict' } }, /acceptance 'strict' needs compile\.promptVersion 3/],
    [{ compile: { acceptance: 'strict', promptVersion: 2 } }, /needs compile\.promptVersion 3/],
    [{ jit: { compare: 'tolerant', relTol: -1 } }, /relTol must be a finite number >= 0/], [{ compile: { compare: 'unordered' } }, /compile\.compare must be canonical or tolerant/],
    [{ compile: { absTol: 1e-9 } }, /compile\.relTol, absTol, tolerantKeys and allowLooseTolerance need compile\.compare 'tolerant'/], [{ compile: { minPartial: 0.8 } }, /minPartial needs compile\.acceptance 'strict'/],
    [{ compile: { acceptance: 'lenient' } }, /acceptance must be one of named, strict/], [{ compile: { acceptance: 'strict', promptVersion: 3, minPartial: 2 } }, /minPartial must be a number in \[0, 1\]/],
    ...['compare', 'relTol', 'absTol', 'tolerantKeys', 'allowLooseTolerance', 'acceptance', 'minPartial'].map(k => [{ compile: { fallback: { [k]: 1 } } }, new RegExp(`compile\\.fallback\\.${k} is not supported`)])]) {
    assert.throws(() => n(bad), re, JSON.stringify(bad));
  }
});

test('sameAnswer tolerant: numbers within tolerance, arrays as multisets; canonical and unordered unchanged', () => {
  assert.equal(sameAnswer({ fit: [1.0, 2] }, { fit: [2.01, 1.004] }, 'tolerant'), true);
  assert.equal(sameAnswer({ fit: [1.0, 2] }, { fit: [2.01, 1.004] }, 'tolerant', { relTol: 0.001 }), false);
  assert.equal(sameAnswer({ fit: [1.0, 2] }, { fit: [2.01, 1.004] }, 'unordered'), false); assert.equal(sameAnswer({ fit: [1, 2] }, { fit: [2, 1] }), false);
  assert.equal(sameAnswer(null, null, 'tolerant'), false, 'a missing answer never votes');
  assert.equal(sameAnswer({ name: ' Anouk' }, { name: 'Anook' }, 'tolerant'), false, 'strings are only trimmed');
});

// Warmup 1, then compiled runs at idx 1..3, every one shadowed. The compiled fit is 1.0, every shadow and adjudicator says
// 1.004 (a refit): one answer within 1%.
const TOL_PLAN = {
  interpret: (idx, role) => (role === 'interpreter' ? undefined : { v: idx + 1, fit: 1.004 }),
  compiled: (version, idx) => ({ status: 'ok', output: { v: idx + 1, fit: 1.0 } }),
  checks: (n, a) => ({ ...perCase(a, () => 'exact'), labeled: a.traces.length, compare: { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }, canonicalExact: 0,
    acceptance: { mode: 'strict', compare: 'tolerant', criteria: { clean: { ok: true }, agreement: { ok: true, partial: 1, minPartial: 0.9, partialOk: true, exactTraces: a.traces.length, exactOk: true }, explained: { ok: true, cases: [] } },
      passed: ['clean', 'agreement', 'explained'], failed: [] } }),
};
const TOL_CONFIG = { ...CONFIG, experiment: 'jit-tol', segments: [{ difficulty: 3, seeds: '1..4' }], jit: { ...CONFIG.jit, warmup: 1, shadowEvery: 1, compare: 'tolerant' },
  compile: { compare: 'tolerant', acceptance: 'strict', promptVersion: 3 } };

test('jit.compare tolerant: refit shadows agree within tolerance (canonicalAgree false), no adjudication; canonical shadows would buy a regression per task', async t => {
  const root = tmp(t);
  const { deps, calls } = fakeDeps(TOL_PLAN);
  const res = await runStream({ config: TOL_CONFIG, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(res.arms.map(a => a.errors), [[]]);
  const rows = [...res.rows].sort((a, b) => a.idx - b.idx);
  for (const i of [1, 2, 3]) {
    assert.deepEqual(rows[i].events.find(e => e.kind === 'shadow'), { kind: 'shadow', version: 1, agree: true, canonicalAgree: false });
    assert.equal(rows[i].delivered, 'compiled');
  }
  assert.equal(calls.interpret.filter(c => c.role === 'adjudicator').length, 0); assert.equal(calls.compile.length, 1, 'no regression, no recompile');
  // The v2.1 compile options reach the compiler; the solver runs on flow-v2.mjs (prompt v3).
  assert.deepEqual(['compare', 'relTol', 'absTol', 'acceptance', 'minPartial', 'promptVersion'].map(k => calls.compile[0][k]), ['tolerant', 0.01, 1e-9, 'strict', 0.9, 3]);
  assert.ok(calls.runCompiled.every(c => c.flowPath === fileURLToPath(new URL('../flow-v2.mjs', import.meta.url))));
  const ev = readJsonl(armPaths(path.join(root, 'runs/jit-tol'), FLAG_SLUG).events).find(e => e.kind === 'compile-attempt');
  assert.deepEqual(ev.result.checkTraces.compare, { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }); assert.deepEqual(ev.result.checkTraces.acceptance.failed, []);
  // The report shows the comparison and acceptance per compile (non-default only).
  const rep = buildReport(path.join(root, 'runs/jit-tol')), cs = rep.arms[0].compileSettings;
  assert.deepEqual(cs.config, { compileCompare: { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }, acceptance: 'strict', minPartial: 0.9, jitCompare: { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 } });
  assert.deepEqual(cs.shadows, { tolerant: 3, agreeTolerantOnly: 3 });
  assert.equal(cs.attempts.length, 1); assert.deepEqual(cs.attempts[0].acceptance.passed, ['clean', 'agreement', 'explained']); assert.equal(cs.attempts[0].canonicalExact, 0);
  const md = renderMarkdown(rep);
  assert.match(md, /## Comparison and acceptance \(non-default\)/);
  assert.match(md, /compile comparison tolerant \(rel 0\.01, abs 1e-9\), acceptance strict \(minPartial 0\.9\), shadow comparison tolerant \(rel 0\.01, abs 1e-9\); tolerant shadows 3, of which agreeing only within tolerance 3\./);
  assert.match(md, /\| jit:claude-sonnet-5-5\/claude-haiku-5-5 \| 1 \| v1 \(claude-haiku-5-5\) \| tolerant \(rel 0\.01, abs 1e-9\) \| 1\/1 \(0\) \| 0\.9 \| strict \(trace partial 1 vs 0\.9, exact traces 1\) \| clean, agreement, explained \| – \| – \| yes \|/);
  // Control: the same world under the default comparison disagrees on every shadow, and the adjudicator (also 1.004)
  // outvotes the compiled answer: a regression and a recompile on each.
  const { deps: d2, calls: c2 } = fakeDeps({ ...TOL_PLAN, checks: (n, a) => perCase(a, () => 'exact') });   // a default compile records neither
  const ctl = await runStream({ config: { ...TOL_CONFIG, experiment: 'jit-canon', jit: { ...CONFIG.jit, warmup: 1, shadowEvery: 1 }, compile: {} }, deps: d2, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  const crow = [...ctl.rows].sort((a, b) => a.idx - b.idx);
  assert.deepEqual(crow.slice(1).map(r => r.delivered), ['adjudicated', 'adjudicated', 'adjudicated']);
  assert.ok(crow.every(r => r.events.filter(e => e.kind === 'shadow').every(e => !('canonicalAgree' in e))), 'default shadow events are unchanged');
  assert.ok(c2.compile.every(c => c.compare === undefined && c.acceptance === undefined && c.relTol === undefined), 'a default arm passes no v2.1 option');
  const crep = buildReport(path.join(root, 'runs/jit-canon'));
  assert.equal('compileSettings' in crep.arms[0], false); assert.doesNotMatch(renderMarkdown(crep), /Comparison and acceptance/);
});

test('strict acceptance on a recheck: the verdict uses the case\'s own task text; a paraphrase is not accepted and buys the Opus fallback', async t => {
  const root = tmp(t);
  const run = async (experiment, notes) => {
    const plan = { compiled: () => ({ status: 'ok' }), checks: (n, a) => ({ ...perCase(a, () => 'deopt'), deoptKinds: { budget: 1 } }), notes: () => notes };
    const { deps, calls } = fakeDeps(plan);
    const make = deps.makeTasks;
    deps.makeTasks = async (...args) => (await make(...args)).map(x => ({ ...x, task: { ...x.task, prompt: 'Report the seed as v.\nSeeds are positive integers.' } }));
    const rechecks = [];
    deps.recheck = async a => { rechecks.push(a); return { summary: { exact: 0, exactRate: 0, partial: 0.95, clean: true, deoptKinds: {}, compare: { mode: 'tolerant' },
      perCase: a.traces.map((x, i) => ({ id: `trace-${i}`, ref: x.traceId, kind: 'trace', status: 'diff', exact: false, partial: 0.95 })) }, costUsd: 0.1 }; };
    const config = { ...CONFIG, experiment, segments: [{ difficulty: 3, seeds: [1, 2] }], jit: { ...CONFIG.jit, warmup: 1, shadowEvery: 0 }, compile: { compare: 'tolerant', acceptance: 'strict', promptVersion: 3 } };
    await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
    const rec = JSON.parse(readFileSync(path.join(root, `runs/${experiment}/${FLAG_SLUG}/versions/v1-haiku55/compile.json`), 'utf8'));
    return { rechecks, calls, ct: rec.checkTraces };
  };
  const good = await run('strict-ok', '## trace-0\nThe task says "Report the seed as v." and the agent wrote w.\n');
  assert.deepEqual(good.rechecks[0].compare, { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 }, 'the recheck compares as the compile did');
  assert.equal(good.ct.accepted, true); assert.deepEqual(good.ct.acceptance.passed, ['clean', 'agreement', 'explained']);
  assert.equal(good.ct.acceptance.criteria.explained.cases[0].verified, 'Report the seed as v.'); assert.deepEqual(good.ct.compare, { mode: 'tolerant', relTol: 0.01, absTol: 1e-9 });
  assert.equal(good.calls.compile.length, 1, 'accepted: no fallback');
  const bad = await run('strict-para', '## trace-0\nThe task wants the seed reported as v.\n');
  assert.equal(bad.ct.accepted, false); assert.deepEqual(bad.ct.acceptance.failed, ['explained']); assert.deepEqual(bad.ct.unexplained, ['trace-0']);
  assert.deepEqual(bad.calls.compile.map(c => c.builderModel), ['claude-haiku-5-5', 'claude-opus-5-5'], 'not accepted: the Opus fallback runs');
});
