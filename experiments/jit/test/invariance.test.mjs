// Engine-side M1 (ATTACK-20261014 §3; PROOF-LEDGER K4): invariance.mjs, run-compiled.mjs's `variants` hook, the stream option
// jit.invariance and eval-invariance.mjs. $0: scripted model ports, stub relations, the sandbox for stub solvers, and one
// archived compiled run replayed from its own journal through a STRICT memo port (no live port). Bed relations and witness
// tags are tested beside the beds (beds/lib/metamorphic.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import { runCompiled, FLOW_V2, recordingPort, createMemoPort } from '../run-compiled.mjs';
import { invarianceOf, invarianceDrawOf, selectRelations, validateRelations, runVariants, invarianceSummary, INVARIANCE_KIND, WITNESS_TAGS } from '../invariance.mjs';
import { runStream, normalizeConfig, parseArm, POLICY_MODELS, shadowDrawOf, REFUSAL_KINDS, selectTraces } from '../stream.mjs';
import { m1Rule, m1Rules, rowFlags, VIEWS, parseArgs, evalArchivedRow, compiledRowsOf, journalPrefixOf, DEFAULT_RUNS, evalReferences } from '../eval-invariance.mjs';
import { loadFamily } from '../../lib/beds.mjs';

const skip = sandboxAvailable() ? false : 'no user namespaces';
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-inv-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const rel = (id, extra = {}) => ({ id, kind: 'invariant', distribution: 'in', text: id,
  make: t => ({ task: { ...t, inputs: { ...t.inputs, rows: [...t.inputs.rows].reverse() } }, info: { id } }),
  check: (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? [] : [{ level: 'output' }]), ...extra });

// ---------------------------------------------------------------------------------------------- invariance.mjs
test('invarianceOf: absent is null; defaults written out; every field validated', () => {
  assert.equal(invarianceOf(undefined), null); assert.equal(invarianceOf(null), null);
  assert.deepEqual(invarianceOf({ share: 0.25 }, { seedDefault: 'exp' }), { share: 0.25, seed: 'exp', distribution: 'in', judges: 'replay', mode: 'deopt' });
  assert.deepEqual(invarianceOf({ share: 1, seed: 7, relations: ['a'], distribution: 'all', perTask: 2, relTol: 0.01, judges: 'fresh', mode: 'observe' }, { seedDefault: 'x' }),
    { share: 1, seed: '7', relations: ['a'], distribution: 'all', perTask: 2, relTol: 0.01, judges: 'fresh', mode: 'observe' });
  for (const [bad, re] of [[{ share: 0.5, judges: 'live' }, /judges must be one of replay, fresh/], [{ share: 0.5, mode: 'warn' }, /mode must be one of deopt, observe/],
    [{ share: 0 }, /share must be a number in \(0, 1\]/], [{ share: 1.5 }, /share/], [{ share: '0.5' }, /share/], [{ share: 0.5, extra: 1 }, /extra is not supported/],
    [{ share: 0.5, distribution: 'out' }, /distribution must be 'in' or 'all'/], [{ share: 0.5, perTask: 0 }, /perTask/], [{ share: 0.5, relTol: 0.1 }, /relTol/],
    [{ share: 0.5, relations: [] }, /relations must be a non-empty list/], [{ share: 0.5, seed: {} }, /seed/], [[1], /must be an object/]]) assert.throws(() => invarianceOf(bad, { seedDefault: 's' }), re);
});

test('invarianceDrawOf: deterministic, in [0, 1), independent of the shadow draw; selectRelations by id, distribution and perTask', () => {
  const u = invarianceDrawOf('S1', 4);
  assert.equal(u, invarianceDrawOf('S1', 4)); assert.ok(u >= 0 && u < 1); assert.notEqual(u, shadowDrawOf('S1', 4)); assert.notEqual(u, invarianceDrawOf('S2', 4));
  const all = [rel('a'), rel('b', { distribution: 'out' }), rel('c')];
  assert.deepEqual(selectRelations(all).map(r => r.id), ['a', 'c']);
  assert.deepEqual(selectRelations(all, { distribution: 'all' }).map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual(selectRelations(all, { ids: ['c', 'b'] }).map(r => r.id), ['b', 'c'], 'declared order; ids override the distribution');
  assert.throws(() => selectRelations(all, { ids: ['zz'] }), /unknown relation zz/);
  const one = selectRelations(all, { distribution: 'all', perTask: 1, seed: 's', idx: 3 });
  assert.equal(one.length, 1); assert.deepEqual(selectRelations(all, { distribution: 'all', perTask: 1, seed: 's', idx: 3 }), one, 'seeded');
  const picks = new Set(Array.from({ length: 30 }, (_, i) => selectRelations(all, { distribution: 'all', perTask: 1, seed: 's', idx: i })[0].id));
  assert.ok(picks.size > 1, 'different tasks draw different relations');
  assert.throws(() => validateRelations([rel('a'), rel('a')]), /declared twice/);
  assert.throws(() => validateRelations([{ ...rel('a'), distribution: 'x' }]), /distribution/);
  assert.throws(() => validateRelations([{ ...rel('a'), kind: 'x' }]), /kind/);
  assert.throws(() => validateRelations([{ id: 'a' }]), /make\(\) and check\(\)/);
  assert.throws(() => validateRelations([{ ...rel('a'), distributionOf: 'in' }]), /distributionOf must be a function/);
  // Review fix (finding 3): a task-dependent label is read from the task when one is given.
  const byD = [rel('a'), { ...rel('d', { distribution: 'out' }), distributionOf: t => (t.difficulty >= 4 ? 'in' : 'out') }];
  assert.deepEqual(selectRelations(byD, { task: { difficulty: 3 } }).map(r => r.id), ['a']);
  assert.deepEqual(selectRelations(byD, { task: { difficulty: 4 } }).map(r => r.id), ['a', 'd']);
  assert.deepEqual(selectRelations(byD).map(r => r.id), ['a'], 'no task: the static label');
  assert.equal(INVARIANCE_KIND, 'invariance'); assert.deepEqual(WITNESS_TAGS, ['hash-total', 'exclusion-set', 'conservation', 'count', 'none']);
});

test('runVariants: agree, disagree (stops by default), skip, a variant that does not run ok, a relation that throws; costs add; the output reaches only relations that need it', async () => {
  const task = { prompt: 'p', inputs: { rows: [1, 2, 3] } }, output = { total: 6 };
  const seen = [];
  const relations = [
    { ...rel('skip'), make: () => ({ skip: 'nothing to vary' }) },
    { ...rel('boom'), make: () => { throw new Error('bad make'); } },
    { ...rel('crashy'), make: t => ({ task: { ...t, inputs: { rows: 'x' } }, info: {} }) },
    { ...rel('needs', { needsOutput: true }), make: (t, { seed, output: o }) => { seen.push({ seed, o }); return { task: t, info: { saw: o.total } }; } },
    rel('same'),
    { ...rel('diff'), check: () => [{ level: 'fields' }] },
    rel('after'),
  ];
  const runVariant = async vt => (Array.isArray(vt.inputs.rows) ? { status: 'ok', output: { total: 6 }, costUsd: 0.01 } : { status: 'crash', output: null, costUsd: 0.002, error: { code: 'SCRIPT_ERROR' } });
  const v = await runVariants({ relations, task, output, seed: 's1', runVariant });
  assert.deepEqual(v.results.map(r => [r.relation, r.status]), [['skip', 'skip'], ['boom', 'error'], ['crashy', 'variant-crash'], ['needs', 'agree'], ['same', 'agree'], ['diff', 'disagree']]);
  assert.equal(v.violated.relation, 'diff'); assert.deepEqual(v.violated.violations, [{ level: 'fields' }]);
  assert.ok(Math.abs(v.costUsd - 0.032) < 1e-9, String(v.costUsd));
  assert.deepEqual(seen, [{ seed: 's1:needs', o: { total: 6 } }]);
  assert.equal(v.results.find(r => r.relation === 'crashy').error, 'SCRIPT_ERROR');
  const all = await runVariants({ relations, task, output, seed: 's1', runVariant, stopOnViolation: false });
  assert.deepEqual(all.results.at(-1), { relation: 'after', distribution: 'in', info: { id: 'after' }, costUsd: 0.01, status: 'agree' });
  assert.deepEqual(invarianceSummary(v), { ran: 3, relations: ['skip', 'boom', 'crashy', 'needs', 'same', 'diff'],
    statuses: { skip: 'skip', boom: 'error', crashy: 'variant-crash', needs: 'agree', same: 'agree', diff: 'disagree' }, violated: 'diff', costUsd: 0.032, levels: ['fields'] });
});

// ---------------------------------------------------------------------------------------------- run-compiled hook
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const policy = subsetPolicy(loadPolicy().policy, MODELS);
const port = () => new ModelPort({ policy, journal: new Journal(new DatabaseSync(':memory:')),
  providers: { 'claude-cli': new ScriptedProvider(() => ({ value: { label: 'x' }, costUsd: 0.02 })) } });
const SCHEMA = { type: 'object', required: ['total'], properties: { total: { type: 'number' } } };
const TASK = { id: 'fake:dev:d3:1', prompt: 'p', inputs: { rows: [5, 1, 4] } };
// One gateway call, then the sum (order-free) or the sum and the first row (order-dependent).
// keyed: the one request names the first row, so a reordered variant asks a changed request.
const SOLVE = (first, keyed = false) => `import { readFileSync } from 'node:fs';
import { callModel } from './tools/model.mjs';
const task = JSON.parse(readFileSync(process.argv[2], 'utf8'));
await callModel({ model: 'claude-haiku-5-5', prompt: ${keyed ? '`label ${JSON.stringify(task.inputs.rows)}`' : "'label'"}, schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } });
const rows = task.inputs.rows;
if (!Array.isArray(rows)) throw new Error('rows');
console.log(JSON.stringify({ total: rows.reduce((a, b) => a + b, 0)${first ? ', first: rows[0]' : ''} }));`;

test('recordingPort records model answers (not flow:call) that a memo port then serves; a missing request goes live', async () => {
  let n = 0;
  const live = { policy: { p: 1 }, providers: {}, call: async req => ({ ok: true, value: { n: ++n, prompt: req.prompt }, costUsd: 0.01, modelId: req.modelId }) };
  const rec = recordingPort(live);
  assert.deepEqual(rec.policy, { p: 1 });
  await rec.call({ modelId: 'claude-haiku-5-5', prompt: 'a', schema: {} }); await rec.call({ modelId: 'flow:call', prompt: '{}', schema: {} });
  assert.equal(rec.rows().length, 1);
  const memo = createMemoPort({ journal: rec.rows(), live, strict: false, reuse: false });
  const hit = await memo.call({ modelId: 'claude-haiku-5-5', prompt: 'a', schema: {} }), again = await memo.call({ modelId: 'claude-haiku-5-5', prompt: 'a', schema: {} });
  assert.deepEqual([hit.replayed, hit.costUsd, hit.value.n], [true, 0, 1]);
  assert.equal(again.replayed, undefined, 'reuse off: a second identical request goes live'); assert.equal(memo.memo.stats().live, 1);
  assert.throws(() => recordingPort(null), /a port with call\(\) is required/);
});

test('runCompiled variants: absent or null changes nothing; an order-free solver agrees (judges replayed at $0, or fresh and billed); an order-dependent one deopts with kind invariance (or, observed, is recorded); a crashing variant is recorded, not a disagreement', { skip }, async t => {
  const root = tmp(t);
  const solve = name => { const p = path.join(root, `${name}.mjs`); writeFileSync(p, SOLVE(name === 'first', name === 'keyed')); return p; };
  const args = (name, extra = {}) => ({ solvePath: solve(name), task: TASK, modelPort: port(), perTaskUsd: 1, timeoutMs: 60000, workdir: path.join(root, `w-${name}-${Object.keys(extra).join('')}`), outputSchema: SCHEMA, allowedModels: MODELS, flowPath: FLOW_V2, label: 'inv', ...extra });
  const plain = await runCompiled(args('sum'));
  assert.equal(plain.status, 'ok'); assert.deepEqual(plain.output, { total: 10 }); assert.equal('variants' in plain.meta, false); assert.ok(Math.abs(plain.costUsd - 0.02) < 1e-9);
  const nul = await runCompiled(args('sum', { variants: null }));
  assert.deepEqual(Object.keys(nul).sort(), Object.keys(plain).sort()); assert.deepEqual(Object.keys(nul.meta).sort(), Object.keys(plain.meta).sort());
  assert.equal('variants' in nul.meta, false);
  // judges 'replay' (default; review finding 4): the variant repeats the original's one request unchanged and is served the
  // original's answer at $0; 'fresh' asks it again and pays.
  const ok = await runCompiled(args('sum', { variants: { relations: [rel('reverse')], seed: 's' } }));
  assert.equal(ok.status, 'ok'); assert.deepEqual(ok.output, { total: 10 });
  assert.deepEqual([ok.meta.variants.ran, ok.meta.variants.violated, ok.meta.variants.statuses], [1, null, { reverse: 'agree' }]);
  assert.ok(Math.abs(ok.costUsd - 0.02) < 1e-9, String(ok.costUsd)); assert.equal(ok.meta.variants.costUsd, 0);
  assert.deepEqual([ok.meta.variants.judges, ok.meta.variants.answersRecorded, ok.meta.variants.liveRequests], ['replay', 1, 0]);
  assert.deepEqual(ok.meta.variants.results[0].memo, { requests: 1, served: 1, live: 0 });
  const fresh = await runCompiled(args('sum', { variants: { relations: [rel('reverse')], seed: 's', judges: 'fresh' } }));
  assert.ok(Math.abs(fresh.costUsd - 0.04) < 1e-9, 'fresh: the variant\'s gateway call is billed'); assert.ok(Math.abs(fresh.meta.variants.costUsd - 0.02) < 1e-9);
  assert.equal(fresh.meta.variants.judges, 'fresh'); assert.equal('answersRecorded' in fresh.meta.variants, false);
  // A request the variant changes goes live and is billed under 'replay' too.
  const keyed = await runCompiled(args('keyed', { variants: { relations: [rel('reverse')], seed: 's' } }));
  assert.equal(keyed.status, 'ok'); assert.ok(Math.abs(keyed.meta.variants.costUsd - 0.02) < 1e-9); assert.deepEqual(keyed.meta.variants.results[0].memo, { requests: 1, served: 0, live: 1 });
  // The variants share one budget (review finding 8): capUsd 0 runs none of them; never a disagreement.
  const capped0 = await runCompiled(args('first', { variants: { relations: [rel('reverse'), rel('again')], seed: 's', capUsd: 0 } }));
  assert.equal(capped0.status, 'ok'); assert.deepEqual(capped0.meta.variants.statuses, { reverse: 'variant-budget', again: 'variant-budget' }); assert.ok(Math.abs(capped0.costUsd - 0.02) < 1e-9);
  await assert.rejects(runCompiled(args('sum', { variants: { relations: [], judges: 'x' } })), /judges must be 'replay' or 'fresh'/);
  await assert.rejects(runCompiled(args('sum', { variants: { relations: [], capUsd: -1 } })), /capUsd/);
  assert.ok(existsSync(`${args('sum', { variants: 1 }).workdir}-v-reverse`), 'the variant ran in its own workdir');
  const bad = await runCompiled(args('first', { variants: { relations: [rel('reverse')], seed: 's' } }));
  assert.equal(bad.status, 'deopt'); assert.equal(bad.output, null);
  assert.deepEqual([bad.deopt.kind, bad.deopt.name], ['invariance', 'reverse']); assert.deepEqual(bad.deopt.detail.violations, [{ level: 'output' }]);
  assert.deepEqual(bad.meta.variants.output, { total: 10, first: 5 }); assert.deepEqual(bad.meta.variants.results[0].variantOutput, { total: 10, first: 4 });
  // mode observe (review finding 9): every relation runs, the disagreement is recorded, the answer is not withheld.
  const seen = await runCompiled(args('first', { variants: { relations: [rel('reverse'), rel('again')], seed: 's', observe: true } }));
  assert.equal(seen.status, 'ok'); assert.deepEqual(seen.output, { total: 10, first: 5 }); assert.equal(seen.deopt, null);
  assert.deepEqual([seen.meta.variants.violated, seen.meta.variants.observe, seen.meta.variants.statuses], ['reverse', true, { reverse: 'disagree', again: 'disagree' }]);
  const crash = await runCompiled(args('sum', { variants: { relations: [{ ...rel('garble'), make: tk => ({ task: { ...tk, inputs: { rows: 'x' } }, info: {} }) }], seed: 's' } }));
  assert.equal(crash.status, 'ok'); assert.deepEqual(crash.meta.variants.statuses, { garble: 'variant-crash' }); assert.equal(crash.meta.variants.violated, null);
  // A failed original runs no variant.
  const none = await runCompiled({ ...args('sum', { variants: { relations: [rel('reverse')], seed: 's' } }), task: { ...TASK, inputs: { rows: 'x' } } });
  assert.equal(none.status, 'crash'); assert.deepEqual(none.meta.variants, { skipped: 'original crash', costUsd: 0 });
  await assert.rejects(runCompiled(args('sum', { variants: { relations: 'x' } })), /variants.relations must be a list/);
  await assert.rejects(runCompiled(args('sum', { variants: { relations: [] }, resume: true })), /not wired with ledger, flowScope or resume/);
});

// ---------------------------------------------------------------------------------------------- the stream option
const TRUTH = seed => ({ v: seed });
function fakeDeps(plan) {
  const calls = { runCompiled: [], interpret: [] };
  const deps = {
    policyIds: [...POLICY_MODELS], outputSchema: { type: 'object' },
    makeTasks: async (familyId, { split, seeds, difficulty }) => seeds.map(seed => ({ familyId, task: { id: `fake:${split}:d${difficulty}:${seed}`, seed, split, difficulty, prompt: 'p', inputs: { seed } },
      taskKey: `fake:${split}:d${difficulty}:s${seed}`, taskHash: `h${seed}` })),
    createModelPort: () => ({ port: { fake: true } }),
    loadFamily: async () => ({ invariance: [rel('in-a'), rel('out-b', { distribution: 'out' })] }),
    score: async (familyId, task, output) => { const pass = output?.v === task.seed; return { pass, score: pass ? 1 : 0 }; },
    async interpret(a) {
      calls.interpret.push({ idx: a.task.seed - 1, role: a.traceId.split('-')[1] });
      return { traceId: a.traceId, taskId: a.task.id, seed: a.task.seed, model: a.model, answer: TRUTH(a.task.seed), costUsd: 0.1, costUnknown: false, error: null, scripts: [], commands: [], task: { prompt: a.task.prompt, inputs: a.task.inputs } };
    },
    async runCompiled(a) {
      const idx = a.task.seed - 1;
      calls.runCompiled.push({ idx, variants: a.variants ? { relations: a.variants.relations.map(r => r.id), seed: a.variants.seed, compare: a.variants.compare, judges: a.variants.judges, observe: a.variants.observe } : null });
      const out = plan.wrong?.includes(idx) ? { v: -1 } : TRUTH(a.task.seed);
      if (!a.variants) return { status: 'ok', output: out, deopt: null, trace: [], costUsd: 0.01, costUnknown: false, latencyMs: 1, error: null, meta: { errors: {} } };
      const disagree = plan.disagree?.includes(idx), relations = a.variants.relations.map(r => r.id), unknown = !!plan.unknown?.includes(idx);
      const variants = { ran: relations.length, relations, statuses: Object.fromEntries(relations.map((r, i) => [r, disagree && i === 0 ? 'disagree' : 'agree'])), violated: disagree ? relations[0] : null,
        costUsd: 0.005, costUnknown: unknown, originalCostUnknown: false, ...(a.variants.observe ? { observe: true } : {}), results: [], output: out, ...(disagree ? { levels: ['fields'] } : {}) };
      if (a.variants.observe) return { status: 'ok', output: out, deopt: null, trace: [], costUsd: 0.015, costUnknown: unknown, latencyMs: 1, error: null, meta: { errors: {}, variants } };
      return disagree
        ? { status: 'deopt', output: null, deopt: { kind: 'invariance', name: relations[0], detail: {} }, trace: [], costUsd: 0.015, costUnknown: false, latencyMs: 1, error: null, meta: { errors: {}, variants } }
        : { status: 'ok', output: out, deopt: null, trace: [], costUsd: 0.015, costUnknown: false, latencyMs: 1, error: null, meta: { errors: {}, variants } };
    },
    async compile(a) {
      const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
      const solvePath = path.join(workdir, 'solve.mjs'); writeFileSync(solvePath, `// ${a.label}\n`);
      const cases = a.traces.map((x, i) => ({ id: `trace-${i}`, ref: x.traceId, kind: 'trace', status: 'exact', exact: true, partial: 1 }));
      return { record: { checkTraces: { exact: cases.length, exactRate: 1, partial: 1, deopts: 0, crashes: 0, deoptKinds: {}, perCase: cases, clean: true, unexplained: [], accepted: true },
        builderCostUsd: 1, gatewayCostUsd: 0.5, checkCostUsd: 0.25, compileCostUsd: 1.75, nestedModelAttempts: 0, builderError: null }, workdir, solvePath };
    },
  };
  return { deps, calls };
}
const CONFIG = { experiment: 'jit-inv', familyId: 'fake', split: 'dev', segments: [{ difficulty: 3, seeds: '1..10' }], arms: ['jit:claude-sonnet-5-5/claude-haiku-5-5'],
  jit: { warmup: 2, shadowEvery: 0, recompileOnDeopts: 2, maxTraces: 8, compilerFallback: 'claude-opus-5-5' }, perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, concurrency: 2 };
const SLUG = 'jit-claude-sonnet-5-5--claude-haiku-5-5';
const hashes = raw => { const c = normalizeConfig(raw); return Object.fromEntries(c.arms.map(a => [a, parseArm(a, c, { policyIds: [...POLICY_MODELS] }).hash])); };
const V1 = { 'dev-records-1': 'jit:claude-haiku-5-5/claude-haiku-5-5', 'dev-kinetics-1': 'jit:claude-opus-5-5/claude-haiku-5-5' };

test('jit.invariance: absent or null moves no arm hash (live dev configs); set, it defines a new JIT arm; validation; not with library', () => {
  for (const [name, jitArm] of Object.entries(V1)) {
    const raw = JSON.parse(readFileSync(new URL(`../configs/${name}.json`, import.meta.url), 'utf8')), want = hashes(raw);
    assert.deepEqual(hashes({ ...raw, jit: { ...raw.jit, invariance: null } }), want, `${name}: null changes nothing`);
    assert.equal('invariance' in normalizeConfig(raw).jit, false);
    const h = hashes({ ...raw, jit: { ...raw.jit, invariance: { share: 0.25 } } });
    assert.notEqual(h[jitArm], want[jitArm]); assert.equal(h['agent:claude-haiku-5-5'], want['agent:claude-haiku-5-5']);
    assert.notEqual(hashes({ ...raw, jit: { ...raw.jit, invariance: { share: 0.25, seed: 'other' } } })[jitArm], h[jitArm], 'the seed is hashed');
  }
  assert.equal(normalizeConfig({ ...CONFIG, jit: { ...CONFIG.jit, invariance: { share: 0.5 } } }).jit.invariance.seed, 'jit-inv', 'the seed defaults to the experiment');
  assert.equal(normalizeConfig({ ...CONFIG, seed: 9, jit: { ...CONFIG.jit, invariance: { share: 0.5 } } }).jit.invariance.seed, '9');
  assert.throws(() => normalizeConfig({ ...CONFIG, jit: { ...CONFIG.jit, invariance: { share: 2 } } }), /share must be a number/);
  assert.throws(() => normalizeConfig({ ...CONFIG, compile: { promptVersion: 5 }, library: { mode: 'iso', childBudgetUsd: 0.2, concurrency: 1, parentMarginUsd: 0.1 }, jit: { ...CONFIG.jit, invariance: { share: 0.5 } } }), /not wired for call-host runs/);
  assert.ok(REFUSAL_KINDS.has('invariance'));
  assert.deepEqual(selectTraces([{ idx: 1, seq: 0, kind: 'warmup' }, { idx: 0, seq: 1, kind: 'invariance' }, { idx: 2, seq: 2, kind: 'warmup' }], 2).map(x => x.kind), ['warmup', 'invariance'], 'an invariance deopt trace is kept like any deopt kind');
});

test('jit.invariance in the stream: sampled runs carry the selected relations; a disagreement deopts to the interpreter (compiledPass recorded), feeds the recompile count; variant spend is booked apart', async t => {
  const root = tmp(t);
  const run = async (experiment, invariance, plan) => {
    const { deps, calls } = fakeDeps(plan);
    const res = await runStream({ config: { ...CONFIG, experiment, jit: { ...CONFIG.jit, invariance } }, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
    assert.deepEqual(res.arms.map(a => a.errors), [[]]);
    return { rows: [...res.rows].sort((a, b) => a.idx - b.idx), calls };
  };
  const { rows, calls } = await run('inv-all', { share: 1, distribution: 'all', relTol: 0.01 }, { wrong: [4], disagree: [4, 5] });
  const compiled = calls.runCompiled;
  assert.ok(compiled.length >= 6 && compiled.every(c => c.variants && c.variants.relations.join() === 'in-a,out-b' && c.variants.seed === `inv-all:${c.idx}` && c.variants.compare.relTol === 0.01));
  const by = i => rows.find(r => r.idx === i);
  for (const i of [4, 5]) {
    assert.equal(by(i).deoptKind, 'invariance'); assert.equal(by(i).delivered, 'interpreter'); assert.equal(by(i).pass, true);
    assert.equal(by(i).invariance.violated, 'in-a'); assert.deepEqual(by(i).invariance.levels, ['fields']);
  }
  assert.equal(by(4).compiledPass, false, 'the withheld compiled answer was wrong'); assert.equal(by(5).compiledPass, true, 'a false alarm: the withheld answer was right');
  assert.ok(by(6).events.some(e => e.kind === 'recompile'), 'two invariance deopts trigger the recompile');
  assert.ok(Math.abs(by(3).costBreakdown.invariance - 0.005) < 1e-9 && Math.abs(by(3).costBreakdown.compiled - 0.01) < 1e-9, 'variant spend is booked as invariance');
  assert.equal(by(3).invariance.ran, 2); assert.equal(by(3).invarianceDraw, Math.round(invarianceDrawOf('inv-all', 3) * 1e6) / 1e6, 'the seed defaults to the experiment');
  assert.deepEqual(by(3).events.find(e => e.kind === 'compiled').invariance.statuses, { 'in-a': 'agree', 'out-b': 'agree' });
  const arm = path.join(root, 'runs/inv-all', SLUG);
  assert.ok(readJsonl(path.join(arm, 'events.jsonl')).length > 0);
  // share 0.5, default distribution 'in': sampled iff the draw is below the share, and only 'in' relations run.
  const half = await run('inv-half', { share: 0.5, seed: 'S' }, {});
  for (const c of half.calls.runCompiled) assert.equal(!!c.variants, invarianceDrawOf('S', c.idx) < 0.5, `#${c.idx}`);
  assert.ok(half.calls.runCompiled.some(c => c.variants) && half.calls.runCompiled.some(c => !c.variants));
  assert.ok(half.calls.runCompiled.filter(c => c.variants).every(c => c.variants.relations.join() === 'in-a'));
  for (const r of half.rows.filter(x => x.compiledStatus)) { assert.equal('invarianceDraw' in r, true); assert.equal('invariance' in r, invarianceDrawOf('S', r.idx) < 0.5); }
  // Review fixes: the relations, judges and mode reach run-compiled; an unknown variant spend is booked on the invariance line
  // only (finding 8); observe mode delivers the compiled answer and records the disagreement (finding 9).
  const obs = await run('inv-obs', { share: 1, mode: 'observe', judges: 'fresh' }, { wrong: [4], disagree: [4], unknown: [3] });
  const oc = obs.calls.runCompiled.filter(c => c.variants);
  assert.ok(oc.length && oc.every(c => c.variants.observe === true && c.variants.judges === 'fresh'));
  const o4 = obs.rows.find(r => r.idx === 4);
  assert.deepEqual([o4.delivered, o4.deoptKind, o4.invariance.violated, o4.invariance.observe, o4.pass], ['compiled', null, 'in-a', true, false]);
  assert.ok(!obs.rows.find(r => r.idx === 5).events.some(e => e.kind === 'recompile'), 'observe: no recompile');
  const spends = readJsonl(path.join(root, 'runs/inv-obs', SLUG, 'events.jsonl')).filter(e => e.kind === 'spend' && e.idx === 3);
  assert.deepEqual(spends.filter(e => ['compiled', 'invariance'].includes(e.component)).map(e => [e.component, e.costUnknown]), [['compiled', false], ['invariance', true]]);
  assert.equal(obs.rows.find(r => r.idx === 3).invariance.costUnknown, true);
  assert.equal(half.calls.runCompiled.find(c => c.variants).variants.judges, 'replay', 'replay is the default');
  // Off: no draw, no summary, no variants.
  const off = await run('inv-off', undefined, {});
  assert.ok(off.calls.runCompiled.every(c => c.variants === null));
  assert.ok(off.rows.every(r => !('invarianceDraw' in r) && !('invariance' in r) && !('invariance' in (r.costBreakdown ?? {}))));
});

// ---------------------------------------------------------------------------------------------- eval-invariance.mjs
const v = (k, relation, status, distribution = 'in') => ({ k, relation, status, distribution });
const recOf = (compiledPass, variants) => ({ status: 'evaluated', compiledPass, variants });

test('eval-invariance: rowFlags and the M1 rule per view (lower, measured, upper bounds; kill, meets, open)', () => {
  const r = recOf(false, [v(0, 'a', 'agree'), v(1, 'a', 'disagree'), v(0, 'b', 'needs-paid-judges', 'out'), v(0, 'c', 'skip')]);
  assert.deepEqual(rowFlags(r), { measurable: true, flagged: true, pending: ['b'], complete: false });
  assert.deepEqual(rowFlags(r, VIEWS.firstDraw), { measurable: true, flagged: false, pending: ['b'], complete: false });
  assert.deepEqual(rowFlags(r, VIEWS.inDistribution), { measurable: true, flagged: true, pending: [], complete: true });
  // Review fix (finding 2): a relation with one measured and one unmeasured variant is pending, so the row's upper bound
  // counts it; before the fix it was silently dropped and the "upper bound" was the measured share.
  const partly = recOf(false, [v(0, 'a', 'agree'), v(1, 'a', 'needs-paid-judges')]);
  assert.deepEqual(rowFlags(partly), { measurable: true, flagged: false, pending: ['a'], complete: false });
  const pr = m1Rule([partly, partly, ...Array.from({ length: 6 }, () => recOf(false, [v(0, 'a', 'agree')]))]);
  assert.deepEqual([pr.recallLowerPct, pr.recallUpperPct, pr.wrongPending], [0, 25, 2]); assert.match(pr.verdict, /^open: 2 of 8/);
  assert.deepEqual([pr.codePath.wrongMeasurable, pr.codePath.wrongFlagged, pr.codePath.wrongComplete], [8, 0, 6]);
  assert.match(pr.codePath.what, /code-path order and state dependence only/);
  const wrongClean = n => Array.from({ length: n }, () => recOf(false, [v(0, 'a', 'agree')]));
  const right = n => Array.from({ length: n }, () => recOf(true, [v(0, 'a', 'agree')]));
  assert.match(m1Rule([...wrongClean(10), ...right(5)]).verdict, /^KILL on \(i\)/);
  const flaggedWrong = n => Array.from({ length: n }, () => recOf(false, [v(0, 'a', 'disagree')]));
  const x = m1Rule([...flaggedWrong(6), ...wrongClean(4), ...right(20)]);
  assert.deepEqual([x.recallLowerPct, x.falseAlarmPct], [60, 0]); assert.match(x.verdict, /^meets \(i\)/);
  const fa = m1Rule([...flaggedWrong(6), ...wrongClean(4), ...right(5), recOf(true, [v(0, 'a', 'disagree')])]);
  assert.equal(fa.falseAlarmPct, 16.7); assert.match(fa.verdict, /^open/);
  const pend = m1Rule([...wrongClean(2), recOf(false, [v(0, 'b', 'needs-paid-judges')]), recOf(false, [v(0, 'b', 'needs-paid-judges')])]);
  assert.deepEqual([pend.recallLowerPct, pend.recallUpperPct, pend.wrongPending], [0, 50, 2]); assert.match(pend.verdict, /^open: 2 of 4 wrong outputs/);
  assert.deepEqual(Object.keys(m1Rules([r])).sort(), ['any', 'byRelation', 'firstDraw', 'inDistribution']);
  assert.deepEqual(parseArgs(['--k', '2', '--parts', 'witness']).parts, ['witness']);
  assert.throws(() => parseArgs(['--parts', 'paid']), /unknown part paid/); assert.throws(() => parseArgs(['--k', '0']), /--k/);
});

test('eval-invariance part (A) on one archived compiled answer: rebuilt from its own journal at $0 (fidelity), variants measured or marked needs-paid-judges, never a live call', { skip }, async t => {
  const work = tmp(t), armDir = path.join(DEFAULT_RUNS, 'jit-dev-records-1', 'jit-claude-sonnet-5-5--claude-haiku-5-5');
  const rows = compiledRowsOf(readJsonl(path.join(armDir, 'results.jsonl'))), row = rows.find(r => r.idx === 5);
  assert.equal(journalPrefixOf(row), 'jit-dev-records-1:jit-claude-sonnet-5-5--claude-haiku-5-5:5:v1:');
  const bed = await loadFamily('records');
  const rec = await evalArchivedRow({ row, armDir, bed, relations: validateRelations(bed.invariance, 'records'), k: 1, work, flowPath: (await import('../run-compiled.mjs')).DEFAULT_FLOW });
  assert.equal(rec.status, 'evaluated'); assert.equal(rec.fidelity, true); assert.equal(rec.compiledPass, true); assert.equal(rec.original.misses, 0); assert.equal(rec.original.costUsd, 0);
  assert.equal(rec.witness, 'none');
  assert.deepEqual(rec.variants.map(x => x.relation), ['shuffle-rows', 'duplicate-row', 'drop-singleton']);
  for (const x of rec.variants) assert.ok(['agree', 'disagree', 'skip', 'needs-paid-judges'].includes(x.status) || x.status.startsWith('variant-'), x.status);
  assert.equal(rec.variants.find(x => x.relation === 'shuffle-rows').status, 'needs-paid-judges', 'the VENDEX judge sees the rows in another order');
});

// ---------------------------------------------------------------------------------------------- part (D): references
test('eval-invariance part (D): the W-bed R1 and R3 relations hold for the frozen references with author readings (review finding 13; a subset, $0)', { skip }, async t => {
  const work = tmp(t);
  const out = await evalReferences({ seeds: [373], difficulties: [3, 4], k: 1, work });
  assert.deepEqual(out.map(x => x.rung), ['r1', 'r3']);
  for (const x of out) {
    assert.equal(x.originalOk, x.runs, `${x.rung}: every original runs ok`);
    const totals = Object.values(x.byRelation).reduce((a, y) => ({ agree: a.agree + y.agree, disagree: a.disagree + y.disagree, notOk: a.notOk + y.notOk }), { agree: 0, disagree: 0, notOk: 0 });
    assert.equal(totals.disagree, 0, `${x.rung}: ${JSON.stringify(x.examples)}`); assert.equal(totals.notOk, 0, `${x.rung}: ${JSON.stringify(x.examples)}`);
    assert.ok(totals.agree >= (x.rung === 'r1' ? 8 : 4), `${x.rung}: ${JSON.stringify(x.byRelation)}`);
  }
  assert.deepEqual(Object.keys(out[0].byRelation).sort(), ['drop-idle-singleton@in', 'duplicate-row@out', 'shuffle-bank-feed@out', 'shuffle-customer-rows@out', 'shuffle-invoice-lines@out']);
});
