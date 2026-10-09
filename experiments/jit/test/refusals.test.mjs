// JIT v2.2 (DEV-NOTES D9): a recompile must not trade a refusal for a silent wrong answer. $0, scripted fakes only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyRefusals } from '../acceptance.mjs';
import { builderPrompt } from '../prompts.mjs';
import { runStream, normalizeConfig, parseArm, POLICY_MODELS, refusalPool, withRefusals } from '../stream.mjs';

const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-refusals-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('applyRefusals: a kept refusal (deopt) or a handled one (exact) is fine, a different answer or a missing case is lost', () => {
  const summary = { clean: false, complete: true, deopts: 2, crashes: 0, timeouts: 0, regressions: 1, regressionsPassed: 1,
    perCase: [{ id: 'case-0', status: 'exact' }, { id: 'trace-0', status: 'exact' }, { id: 'trace-1', status: 'deopt' }, { id: 'trace-2', status: 'diff' }, { id: 'trace-3', status: 'deopt' }] };
  assert.deepEqual(applyRefusals(summary, []), { summary, refusalCheck: null }, 'no refusals: the summary passes through untouched');
  const kept = applyRefusals(summary, ['trace-1', 'trace-3']);
  assert.equal(kept.summary.clean, true, 'deopts only on refusal cases no longer count against clean');
  assert.equal(kept.summary.deopts, 0);
  assert.deepEqual(kept.summary.perCase.map(c => c.id), ['case-0', 'trace-0', 'trace-2']);
  assert.deepEqual(kept.refusalCheck, { cases: ['trace-1', 'trace-3'], kept: ['trace-1', 'trace-3'], handled: [], lost: [], missing: [], failed: [], ok: true });
  const lost = applyRefusals(summary, ['trace-1', 'trace-2', 'trace-9']);
  assert.equal(lost.refusalCheck.ok, false);
  assert.deepEqual([lost.refusalCheck.lost, lost.refusalCheck.missing, lost.refusalCheck.kept], [['trace-2'], ['trace-9'], ['trace-1']]);
  assert.equal(lost.summary.clean, false, 'trace-3 still deopts and is not a refusal case here');
  const crashed = applyRefusals({ ...summary, crashes: 1 }, ['trace-1', 'trace-3']);
  assert.equal(crashed.summary.clean, false, 'a crash anywhere is never cleaned');
});

test('prompt v4: the recompile lets a refusal stand and names the refusal cases; v1-v3 and the v4 first compile are unchanged', () => {
  const A = { traces: 5, regressions: 1, minutes: 30, gatewayUsd: 1.5, perTaskUsd: 1, models: ['claude-haiku-5-5', 'claude-sonnet-5-5'] };
  const v3 = builderPrompt('recompile', { ...A, promptVersion: 3 }), v4 = builderPrompt('recompile', { ...A, promptVersion: 4, refusals: ['trace-1', 'trace-3'] });
  assert.match(v3, /the new cases must run without a deopt or crash/, 'v3 keeps its text');
  assert.doesNotMatch(v3, /refusal/);
  assert.doesNotMatch(v4, /the new cases must run without a deopt or crash/);
  assert.match(v4, /came from inputs the current solver refused: trace-1, trace-3/);
  assert.match(v4, /exactly two acceptable outcomes/);
  assert.match(v4, /Never widen a guard further than the traces you can reproduce/);
  assert.equal(builderPrompt('compile', { ...A, promptVersion: 4 }), builderPrompt('compile', { ...A, promptVersion: 3 }), 'a first compile has no refusals: v4 = v3');
  const v4tail = v4.split('\n\n').slice(1).join('\n\n'), v3tail = v3.split('\n\n').slice(1).join('\n\n');
  assert.equal(v4tail, v3tail, 'only the opening paragraph differs from v3');
});

test('preserveRefusals: off by default (arm hashes unchanged), validated, and a new arm when set', () => {
  const raw = JSON.parse(readFileSync(new URL('../configs/dev-records-1.json', import.meta.url), 'utf8'));
  const hashes = r => { const c = normalizeConfig(r); return Object.fromEntries(c.arms.map(a => [a, parseArm(a, c, { policyIds: [...POLICY_MODELS] }).hash])); };
  const base = hashes(raw);
  assert.deepEqual(hashes({ ...raw, jit: { ...raw.jit, preserveRefusals: false } }), base);
  assert.equal('preserveRefusals' in normalizeConfig({ ...raw, jit: { ...raw.jit, preserveRefusals: false } }).jit, false);
  const jitArm = Object.keys(base).find(a => a.startsWith('jit:'));
  assert.notEqual(hashes({ ...raw, jit: { ...raw.jit, preserveRefusals: true } })[jitArm], base[jitArm]);
  assert.throws(() => normalizeConfig({ ...raw, jit: { ...raw.jit, preserveRefusals: 'yes' } }), /preserveRefusals must be true or false/);
});

test('refusalPool / withRefusals: guard, invariant and judge deopts are refusals; crashes are not; every refusal joins the compile', () => {
  const pool = [
    { traceId: 'w0', idx: 0, seq: 0, role: 'warmup', kind: 'warmup' }, { traceId: 'f1', idx: 4, seq: 1, role: 'fallback', kind: 'guard' },
    { traceId: 'f2', idx: 5, seq: 2, role: 'fallback', kind: 'crash' }, { traceId: 'f3', idx: 6, seq: 3, role: 'fallback', kind: 'judge' },
    { traceId: 's4', idx: 7, seq: 4, role: 'shadow', kind: 'shadow' },
  ];
  assert.deepEqual(refusalPool(pool).map(x => x.traceId), ['f1', 'f3']);
  assert.deepEqual(withRefusals([pool[4], pool[0]], pool).map(x => x.traceId), ['s4', 'w0', 'f3', 'f1']);
  assert.deepEqual(withRefusals([pool[1], pool[3]], pool).map(x => x.traceId), ['f1', 'f3'], 'already present: nothing added');
});

// A scripted stream: v1 deopts (guard) on tasks 3 and 4, which become refusal traces and trigger a recompile at task 5.
function fakeWorld(checks) {
  const calls = { compile: [] };
  const deps = {
    policyIds: [...POLICY_MODELS], outputSchema: { type: 'object' },
    makeTasks: async (familyId, { split, seeds, difficulty }) => seeds.map(seed => ({ familyId, task: { id: `f:${seed}`, seed, split, difficulty, prompt: 'p', inputs: { seed } }, taskKey: `f:${split}:d${difficulty}:s${seed}`, taskHash: `h${seed}` })),
    createModelPort: () => ({ port: {} }),
    score: async (familyId, task, output) => ({ pass: output?.v === task.seed, score: output?.v === task.seed ? 1 : 0 }),
    async interpret(a) { return { traceId: a.traceId, taskId: a.task.id, seed: a.task.seed, model: a.model, answer: { v: a.task.seed }, costUsd: 0.1, costUnknown: false, error: null, scripts: [], commands: [], task: { prompt: 'p', inputs: a.task.inputs } }; },
    async runCompiled(a) {
      const idx = a.task.seed - 1, version = Number(a.label.split(':v').at(-1));
      const deopt = version === 1 && [3, 4].includes(idx);
      return { status: deopt ? 'deopt' : 'ok', output: deopt ? null : { v: a.task.seed }, deopt: deopt ? { kind: 'guard', name: 'known-shape' } : null, trace: [], costUsd: 0.01, costUnknown: false, latencyMs: 1, error: null, meta: { errors: {} } };
    },
    async compile(a) {
      calls.compile.push({ traceIds: a.traces.map(x => x.traceId), refusals: a.refusals ?? [], promptVersion: a.promptVersion });
      const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
      writeFileSync(path.join(workdir, 'solve.mjs'), `// ${a.label}\n`);
      const perCase = a.traces.map((x, i) => ({ id: `trace-${i}`, ref: x.traceId, kind: 'trace', ...checks(calls.compile.length, a, `trace-${i}`) }));
      const raw = { exact: perCase.filter(c => c.status === 'exact').length, partial: 1, deopts: perCase.filter(c => c.status === 'deopt').length, crashes: 0, timeouts: 0, complete: true,
        regressions: 0, regressionsPassed: 0, perCase, clean: perCase.every(c => c.status === 'exact') };
      // compile.mjs's rule, as the real compile applies it (acceptance.mjs applyRefusals).
      const { summary: s, refusalCheck } = applyRefusals(raw, a.refusals ?? []);
      const checkTraces = { ...s, accepted: s.clean && (!refusalCheck || refusalCheck.ok), unexplained: [], ...(refusalCheck ? { refusalCheck } : {}) };
      return { record: { checkTraces, promptVersion: a.promptVersion ?? 1, builderCostUsd: 1, gatewayCostUsd: 0, checkCostUsd: 0, compileCostUsd: 1, nestedModelAttempts: 0, builderError: null }, workdir, solvePath: path.join(workdir, 'solve.mjs') };
    },
  };
  return { deps, calls };
}
const CFG = jit => ({ experiment: 'jit-ref', familyId: 'fake', split: 'dev', segments: [{ difficulty: 3, seeds: '1..8' }], arms: ['jit:claude-sonnet-5-5/claude-haiku-5-5'],
  jit: { warmup: 2, shadowEvery: 0, recompileOnDeopts: 2, maxTraces: 8, compilerFallback: null, ...jit }, compile: { promptVersion: 4 }, perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, concurrency: 1 });
const refusalCases = a => a.traces.map((x, i) => (x.traceId.includes('-interpreter-') && /^i00[34]-/.test(x.traceId) ? `trace-${i}` : null)).filter(Boolean);

test('preserveRefusals: a recompile that answers a refused input differently is rejected; one that keeps refusing it is adopted', async t => {
  // lost: the recompile "handles" the refused shapes but answers them differently from the agent.
  const root1 = tmp(t);
  const w1 = fakeWorld((n, a, id) => (n >= 2 && refusalCases(a).includes(id) ? { status: 'diff', exact: false, partial: 0.8 } : { status: 'exact', exact: true }));
  const r1 = await runStream({ config: CFG({ preserveRefusals: true }), deps: w1.deps, runRoot: path.join(root1, 'runs'), workRoot: path.join(root1, 'work'), log: () => {} });
  const rows1 = [...r1.rows].sort((a, b) => a.idx - b.idx);
  assert.equal(w1.calls.compile.length, 2);
  assert.equal(w1.calls.compile[1].refusals.length, 2, 'both refusal traces are named to the recompile');
  const rej = rows1.flatMap(r => r.events).find(e => e.kind === 'rejected');
  assert.ok(rej, 'the recompile was rejected');
  assert.match(rej.why, /^refusal lost \(trace-\d+, trace-\d+\)$/);
  assert.ok(rows1.filter(r => r.idx >= 5).every(r => r.version === 1), 'v1 is kept');
  // kept: the recompile keeps refusing the refused shapes (deopt) and agrees on everything else.
  const root2 = tmp(t);
  const w2 = fakeWorld((n, a, id) => (n >= 2 && refusalCases(a).includes(id) ? { status: 'deopt' } : { status: 'exact', exact: true }));
  const r2 = await runStream({ config: CFG({ preserveRefusals: true }), deps: w2.deps, runRoot: path.join(root2, 'runs'), workRoot: path.join(root2, 'work'), log: () => {} });
  const rows2 = [...r2.rows].sort((a, b) => a.idx - b.idx);
  assert.ok(rows2.flatMap(r => r.events).some(e => e.kind === 'recompile'), 'adopted: deopts on refusal cases do not make it unclean');
  assert.equal(rows2.at(-1).version, 2);
  // off: without preserveRefusals the same lost-refusal recompile is judged only by the old rule (clean + exact on old cases).
  const root3 = tmp(t);
  const w3 = fakeWorld((n, a, id) => (n >= 2 && refusalCases(a).includes(id) ? { status: 'diff', exact: false, partial: 0.8 } : { status: 'exact', exact: true }));
  await runStream({ config: CFG({}), deps: w3.deps, runRoot: path.join(root3, 'runs'), workRoot: path.join(root3, 'work'), log: () => {} });
  assert.deepEqual(w3.calls.compile.map(c => c.refusals), [[], []], 'no refusals are passed when the option is off');
});
