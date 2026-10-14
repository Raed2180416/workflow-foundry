// stream.mjs slice 2a (design/FLOW-V3-SLICE2.md §3–§4; FLOW-V3-SLICE1 §3 item 5): the `library` option (validation, the
// stream budget rule, arm hashes), the per-arm registry (ISO wipe, CUR seed, registration of adopted accepted versions),
// the call host per compiled run, calls.jsonl, row fields, the export, and a deopt of kind 'call'. The last test is the
// dry run over wbed-r4: a parent compiled solver (flow-v3, in the sandbox) calls two R1 packs by hash through the stub
// gateway; the in-profile pack runs the library's R1 solver, the planted pack is refused outside its profile and
// interpreted locally, and the budget rolls up exactly. No model calls; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runStream, normalizeConfig, parseArm, libraryOf, selectTraces, REFUSAL_KINDS, POLICY_MODELS, armPaths } from '../stream.mjs';
import { createRegistry, CALL_MODEL, REGISTRY_FILE } from '../call-host.mjs';
import { learnProfile, PARAMS_V2, TOLERANT_CHECK, SIZE_FEATURES } from '../profile.mjs';
import { runCompiled } from '../run-compiled.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';
import { loadPolicy } from '../../../src/models/policy.mjs';
import { ModelPort } from '../../../src/models/port.mjs';
import { Journal } from '../../../src/journal.mjs';
import { ScriptedProvider } from '../../../src/models/providers/scripted.mjs';
import { subsetPolicy } from '../../lib/models.mjs';
import * as R1 from '../../../beds/wbed/r1/index.mjs';
import * as R4 from '../../../beds/wbed/r4/index.mjs';

const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-slib-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const ARM = 'jit:claude-haiku-5-5/claude-haiku-5-5';
const LIB = { mode: 'iso', childBudgetUsd: 0.3, concurrency: 2, parentMarginUsd: 0.1 };
const BASE = { experiment: 'lib-fake', familyId: 'fake', split: 'dev', segments: [{ difficulty: 3, seeds: '1..4' }], arms: ['agent:claude-haiku-5-5', ARM],
  jit: { warmup: 1, shadowEvery: 0, recompileOnDeopts: 1, maxTraces: 8, compilerFallback: 'claude-opus-5-5' }, perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, concurrency: 1,
  compile: { promptVersion: 5 } };
const hashes = raw => { const c = normalizeConfig(raw); return Object.fromEntries(c.arms.map(a => [a, parseArm(a, c, { policyIds: [...POLICY_MODELS] }).hash])); };

test('config.library: validated, defaults written out, the stream budget rule perTaskUsd >= concurrency × childBudgetUsd + parentMarginUsd enforced; set, it defines a new JIT arm (agent arms unchanged)', () => {
  const lib = normalizeConfig({ ...BASE, library: LIB }).library;
  assert.deepEqual(lib, { mode: 'iso', childBudgetUsd: 0.3, concurrency: 2, parentMarginUsd: 0.1, maxDepth: 3, check: { ignore: [...SIZE_FEATURES].sort(), lineFormat: 'tolerant', vocabMinUnseen: 2 },
    novelMode: 'refuse', interpretFloorUsd: 0.1, register: true });
  assert.equal('library' in normalizeConfig(BASE), false);
  assert.deepEqual(hashes({ ...BASE, library: LIB }), hashes({ ...BASE, library: { ...LIB, maxDepth: 3, check: TOLERANT_CHECK, novelMode: 'refuse', interpretFloorUsd: 0.1, register: true } }), 'explicit defaults hash the same');
  const h0 = hashes(BASE), h1 = hashes({ ...BASE, library: LIB });
  assert.equal(h1['agent:claude-haiku-5-5'], h0['agent:claude-haiku-5-5']); assert.notEqual(h1[ARM], h0[ARM]);
  assert.notEqual(hashes({ ...BASE, library: { ...LIB, mode: 'cur' } })[ARM], h1[ARM], 'CUR and ISO are different arms');
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, concurrency: 4 } }), /perTaskUsd 1 is below concurrency × childBudgetUsd \+ parentMarginUsd = 4 × 0\.3 \+ 0\.1 = 1\.3/);
  assert.equal(normalizeConfig({ ...BASE, perTaskUsd: 1.3, library: { ...LIB, concurrency: 4 } }).library.concurrency, 4, 'exactly at the rule is allowed (the margin keeps it strict)');
  assert.throws(() => normalizeConfig({ ...BASE, compile: {}, library: LIB }), /needs compile\.promptVersion 5/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, mode: 'both' } }), /mode must be one of cur, iso/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, from: 'x/{slug}/library' } }), /only with mode 'cur'/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, parentMarginUsd: 0 } }), /parentMarginUsd must be a positive/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, concurrency: 0 } }), /concurrency must be an integer >= 1/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, maxDepth: 9 } }), /maxDepth must be an integer in 1\.\.8/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, check: { lineFormat: 'loose' } } }), /lineFormat must be one of/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, extra: 1 } }), /library\.extra is not supported/);
  assert.equal(libraryOf({}), null);
  // deopt kind 'call' is a refusal kind (v2.2 preserveRefusals) and its own trace kind for selection
  assert.ok(REFUSAL_KINDS.has('call'));
  assert.deepEqual(selectTraces([{ idx: 1, seq: 0, kind: 'call' }, { idx: 3, seq: 1, kind: 'warmup' }, { idx: 2, seq: 2, kind: 'warmup' }], 2).map(x => x.kind), ['warmup', 'call']);
});

// A fake world for the stream wiring (as stream.test.mjs's): tasks are seeds; the oracle passes {v: seed}.
function fakeDeps({ compiled = () => ({ status: 'ok' }) } = {}) {
  const calls = { runCompiled: [], compile: [], interpret: [] };
  const deps = {
    policyIds: [...POLICY_MODELS], outputSchema: { type: 'object' },
    makeTasks: async (familyId, { split, seeds, difficulty }) => seeds.map(seed => ({ familyId, task: { id: `fake:${seed}`, seed, split, difficulty, prompt: `Task ${seed}: report v.`, inputs: { seed, rows: [seed, seed + 1] } },
      taskKey: `fake:s${seed}`, taskHash: `h${seed}` })),
    createModelPort: () => ({ port: { fake: true, policy: { models: [] } } }),
    score: async (f, task, output) => ({ pass: output?.v === task.seed, score: output?.v === task.seed ? 1 : 0 }),
    async interpret(a) {
      calls.interpret.push({ traceId: a.traceId, model: a.model });
      return { traceId: a.traceId, answer: { v: a.task.seed }, costUsd: 0.1, costUnknown: false, error: null, scripts: [], commands: [], task: { prompt: a.task.prompt, inputs: a.task.inputs } };
    },
    async runCompiled(a) {
      calls.runCompiled.push({ idx: a.task.seed - 1, ledger: a.ledger, allowedModels: a.allowedModels, port: a.modelPort, flowPath: a.flowPath });
      const r = compiled(a.task.seed - 1);
      return { status: r.status, output: r.status === 'ok' ? { v: a.task.seed } : null, deopt: r.deopt ?? null, trace: [], costUsd: 0.01, costUnknown: false, latencyMs: 1, error: null, meta: { errors: {} } };
    },
    async compile(a) {
      calls.compile.push({ library: a.library ?? null, interpreter: typeof a.interpreter, callHost: a.callHost ?? null, promptVersion: a.promptVersion });
      const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
      const solvePath = path.join(workdir, 'solve.mjs'); writeFileSync(solvePath, `// ${a.label}\n`);
      const perCase = a.traces.map((t, i) => ({ id: `trace-${i}`, ref: t.traceId, kind: 'trace', status: 'exact', exact: true, partial: 1 }));
      return { record: { checkTraces: { exact: perCase.length, exactRate: 1, partial: 1, deopts: 0, crashes: 0, deoptKinds: {}, perCase, clean: true, unexplained: [], accepted: true },
        promptVersion: a.promptVersion, builderCostUsd: 1, gatewayCostUsd: 0.5, checkCostUsd: 0.25, compileCostUsd: 1.75, nestedModelAttempts: 0 }, workdir, solvePath };
    },
  };
  return { deps, calls };
}

test('library arm (fakes): ISO starts empty, an accepted adopted version is registered with a PARAMS_V2 profile, every compiled run gets a call host port, a Ledger and flow:call; a call deopt is a row deoptKind; the export carries the library', async t => {
  const root = tmp(t), runRoot = path.join(root, 'runs');
  const slug = parseArm(ARM, normalizeConfig(BASE), { policyIds: [...POLICY_MODELS] }).slug;
  // a stale library from an earlier run of this experiment: ISO wipes it on a fresh start
  mkdirSync(path.join(runRoot, 'lib-fake', slug, 'library'), { recursive: true }); writeFileSync(path.join(runRoot, 'lib-fake', slug, 'library', REGISTRY_FILE), '{"op":"register","entry":{"hash":"sha256:stale"}}\n');
  const { deps, calls } = fakeDeps({ compiled: idx => (idx === 2 ? { status: 'deopt', deopt: { kind: 'call', name: 'S1', detail: { refused: 'outside-profile' } } } : { status: 'ok' }) });
  const res = await runStream({ config: { ...BASE, arms: [ARM], library: LIB }, deps, runRoot, workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(res.arms[0].errors, []);
  const p = armPaths(path.join(runRoot, 'lib-fake'), slug), rows = readJsonl(p.results);
  assert.equal(rows.length, 4);
  const reg = createRegistry({ dir: path.join(p.dir, 'library') }), list = reg.list();
  assert.equal(reg.get('sha256:stale'), null, 'the stale entry was wiped');
  assert.deepEqual(list.map(x => x.evidence.version), [1, 2], 'v1, and v2 after the call deopt (recompileOnDeopts 1)');
  const e = reg.get(list[0].hash);
  assert.equal(e.flowVersion, 3); assert.equal(e.profile.params.observe.looseLines, true); assert.equal(e.profile.n, 1); assert.deepEqual(e.checkOptions, LIB_CHECK);
  assert.equal(e.evidence.familyId, 'fake'); assert.equal(e.evidence.version, 1); assert.equal(e.contract.taskTemplate, 'Task 1: report v.');
  assert.ok(existsSync(e.solvePath) && e.solvePath.startsWith(path.join(p.dir, 'library', 'solvers')));
  assert.ok(readJsonl(p.events).some(x => x.kind === 'library-register' && x.hash === e.hash));
  // compiles got the library, an interpreter and the host options; compiled runs a host port, a Ledger at perTaskUsd and flow:call
  assert.ok(calls.compile.every(c => c.library && c.interpreter === 'function' && c.callHost.maxDepth === 3 && c.promptVersion === 5));
  assert.ok(calls.runCompiled.length >= 3);
  for (const c of calls.runCompiled) {
    assert.equal(c.ledger.capUsd, 1); assert.ok(c.allowedModels.includes(CALL_MODEL)); assert.equal(typeof c.port.call, 'function'); assert.ok(c.port.scope, 'a call host port');
    assert.ok(c.flowPath.endsWith('flow-v3.mjs'));
  }
  const deopted = rows.find(r => r.idx === 2);
  assert.equal(deopted.deoptKind, 'call'); assert.equal(deopted.delivered, 'interpreter'); assert.deepEqual(deopted.calls, { childCalls: 0, callSpentUsd: 0, ends: 0, refused: 0, deopts: 0, interpreted: 0, warnings: 0 });
  assert.ok(rows.find(r => r.idx === 1).calls, 'every compiled row of a library arm says what its calls did');
  const exported = path.join(runRoot, 'lib-fake', 'export', slug, 'library', REGISTRY_FILE);
  assert.ok(existsSync(exported), 'the export carries the registry');
});
const LIB_CHECK = { ignore: [...SIZE_FEATURES].sort(), lineFormat: 'tolerant', vocabMinUnseen: 2 };

test('library mode cur: a fresh arm is seeded from `from` (the previous rung\'s library); a missing source is an error', async t => {
  const root = tmp(t), runRoot = path.join(root, 'runs');
  const slug = parseArm(ARM, normalizeConfig(BASE), { policyIds: [...POLICY_MODELS] }).slug;
  const prev = path.join(runRoot, 'rung-1', slug, 'library');
  mkdirSync(path.join(prev, 'solvers'), { recursive: true }); writeFileSync(path.join(prev, 'solvers', 'r1.mjs'), 'console.log(1)');
  const r1 = createRegistry({ dir: prev }).register({ solvePath: 'solvers/r1.mjs', contract: { output: { type: 'object' }, taskTemplate: 'R1' }, evidence: { familyId: 'fake-r1' } });
  const { deps } = fakeDeps();
  const config = { ...BASE, experiment: 'rung-2', arms: [ARM], segments: [{ difficulty: 3, seeds: '1..2' }], library: { ...LIB, mode: 'cur', from: 'rung-1/{slug}/library' } };
  const res = await runStream({ config, deps, runRoot, workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(res.arms[0].errors, []);
  const reg = createRegistry({ dir: path.join(runRoot, 'rung-2', slug, 'library') });
  assert.equal(reg.get(r1.hash).evidence.familyId, 'fake-r1', 'the R1 entry came along'); assert.equal(reg.list().length, 2, 'plus this rung\'s v1');
  assert.ok(existsSync(reg.get(r1.hash).solvePath));
  assert.ok(readJsonl(path.join(runRoot, 'rung-2', slug, 'events.jsonl')).some(e => e.kind === 'library-seeded'));
  const bad = await runStream({ config: { ...config, experiment: 'rung-3', library: { ...config.library, from: 'nowhere/{slug}/library' } }, deps, runRoot, workRoot: path.join(root, 'work'), log: () => {} });
  assert.match(bad.arms[0].errors.join('\n'), /has no registry\.jsonl/);
});

test('library arm: a compiled run records its answers (resume: true) and the retry after an environment fault resumes from the first attempt\'s rows', async t => {
  const root = tmp(t), runRoot = path.join(root, 'runs');
  const { deps } = fakeDeps();
  const seen = [];
  deps.runCompiled = async a => {
    const attempt = seen.filter(x => x.idx === a.task.seed - 1).length;
    seen.push({ idx: a.task.seed - 1, resume: a.resume });
    if (a.task.seed === 2 && attempt === 0) return { status: 'crash', output: null, trace: [], costUsd: 0.02, costUnknown: false, error: { code: 'MODEL_RATE_LIMIT' }, meta: { errors: {}, resume: { rows: [{ seq: 0, digest: 'd', occurrence: 0, ok: true, value: { factor: 1 } }], stats: { served: 0 } } } };
    return { status: 'ok', output: { v: a.task.seed }, trace: [], costUsd: 0.01, costUnknown: false, error: null, meta: { errors: {}, resume: { rows: [], stats: { served: a.resume === true ? 0 : 1 } } } };
  };
  const res = await runStream({ config: { ...BASE, experiment: 'lib-resume', arms: [ARM], segments: [{ difficulty: 3, seeds: '1..2' }], library: LIB }, deps, runRoot, workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(res.arms[0].errors, []);
  const retry = seen.filter(x => x.idx === 1);
  assert.equal(retry.length, 2); assert.equal(retry[0].resume, true, 'the first attempt records');
  assert.deepEqual(retry[1].resume, [{ seq: 0, digest: 'd', occurrence: 0, ok: true, value: { factor: 1 } }], 'the retry resumes from its rows');
  const row = readJsonl(path.join(runRoot, 'lib-resume', parseArm(ARM, normalizeConfig(BASE), { policyIds: [...POLICY_MODELS] }).slug, 'results.jsonl')).find(r => r.idx === 1);
  assert.deepEqual(row.events.filter(e => e.kind === 'compiled').map(e => [e.attempt, e.resumed ?? 0]), [[0, 0], [1, 1]]);
});

// ---- the dry run over wbed-r4 (sandboxed compiled runs, stub gateway) ----
const skip = sandboxAvailable() ? false : 'no user namespaces';
const R1_OUT = { type: 'object', required: ['customers', 'totals'], properties: { customers: { type: 'array' }, totals: { type: 'object' } } };
// The library's R1 "solver": one judge through the gateway, a typed answer (a stand-in for an accepted R1 solver).
const R1_SOLVER = `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 0.3 });
const task = flow.input();
const v = await flow.judge('close-date', { tiers: ['claude-haiku-5-5'], prompt: 'close date?', schema: { type: 'object', properties: { factor: { type: 'number' } }, required: ['factor'] } });
flow.done({ customers: [], totals: { from: 'r1-solver', systems: Object.keys(task.inputs.invoices).length } });`;
const parentSolver = r1Hash => `import { createFlow } from './tools/flow.mjs';
const flow = createFlow({ budgetUsd: 1 });
const task = flow.input();
const packs = Object.entries(task.inputs.subsidiaries).filter(([, s]) => s.pack === 'receivables-close');
const out = await flow.phase('children', () => flow.map(packs, ([id, s]) => flow.call('${r1Hash}', s.inputs, { name: id, budgetUsd: 0.3, prompt: s.prompt, onRefuse: 'interpret' }), { concurrency: 2 }));
flow.done({ children: Object.fromEntries(packs.map(([id], i) => [id, out[i].totals.from])) });`;

test('dry run over wbed-r4 (stub gateway, sandboxed): the parent compiled solver calls two R1 packs by hash; the in-profile pack runs the library solver, the planted pack is refused outside its profile and interpreted locally; the budget rolls up exactly', { skip }, async t => {
  const root = tmp(t), runRoot = path.join(root, 'runs');
  const config = { experiment: 'r4-dry', familyId: 'wbed-r4', split: 'dev', segments: [{ difficulty: 3, seeds: [341, 342] }], arms: [ARM],
    jit: { warmup: 1, shadowEvery: 0, recompileOnDeopts: 2, maxTraces: 8, compilerFallback: 'claude-opus-5-5' }, perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, compiledMinutes: 2,
    compile: { promptVersion: 5 }, library: { mode: 'cur', from: 'r1-prev/{slug}/library', childBudgetUsd: 0.3, concurrency: 2, parentMarginUsd: 0.1 } };
  const slug = parseArm(ARM, normalizeConfig(config), { policyIds: [...POLICY_MODELS] }).slug;
  // The previous rung's library: an R1 entry with a PARAMS_V2 profile of the R1 stream shape (dev 301-316 d3, 317-324 d4).
  const prev = path.join(runRoot, 'r1-prev', slug, 'library');
  mkdirSync(path.join(prev, 'solvers'), { recursive: true }); writeFileSync(path.join(prev, 'solvers', 'r1.mjs'), R1_SOLVER);
  const r1Tasks = [...Array.from({ length: 16 }, (_, i) => R1.generate({ seed: 301 + i, split: 'dev', difficulty: 3 })), ...Array.from({ length: 8 }, (_, i) => R1.generate({ seed: 317 + i, split: 'dev', difficulty: 4 }))]
    .map(x => ({ prompt: x.prompt, inputs: x.inputs }));
  const r1 = createRegistry({ dir: prev }).register({ solvePath: 'solvers/r1.mjs', contract: { output: R1_OUT, taskTemplate: r1Tasks[0].prompt }, profile: learnProfile(r1Tasks, PARAMS_V2),
    checkOptions: TOLERANT_CHECK, evidence: { familyId: 'wbed-r1' } });
  const task342 = R4.generate({ seed: 342, split: 'dev', difficulty: 3 }), kids = R4.childrenOf(task342).filter(k => k.family === 'wbed-r1');
  const planted = kids.find(k => k.outsideProfile), inside = kids.find(k => !k.outsideProfile);
  assert.ok(planted && inside, 'seed 342 at d3 has one planted and one in-profile R1 pack');
  const MODELS = [...POLICY_MODELS], seen = { child: [], compile: 0 };
  const deps = {
    policyIds: MODELS, outputSchema: { type: 'object' },
    createModelPort: () => ({ port: new ModelPort({ policy: subsetPolicy(loadPolicy().policy, MODELS), journal: new Journal(new DatabaseSync(':memory:')),
      providers: { 'claude-cli': new ScriptedProvider(() => ({ value: { factor: 1 }, costUsd: 0.02 })) } }) }),
    score: async () => ({ pass: true, score: 1 }),
    async interpret(a) {
      const role = a.traceId.split('-')[1];
      if (role === 'child') seen.child.push({ prompt: a.task.prompt, budgetUsd: a.budgetUsd, model: a.model, familyId: a.familyId, systems: Object.keys(a.task.inputs.invoices) });
      const answer = role === 'child' ? { customers: [], totals: { from: 'interpreter' } } : { warmup: true };
      return { traceId: a.traceId, answer, costUsd: role === 'child' ? 0.05 : 0.1, costUnknown: false, error: null, scripts: [], commands: [], task: { prompt: a.task.prompt, inputs: a.task.inputs } };
    },
    async compile(a) {
      seen.compile++;
      assert.deepEqual(a.library.list().map(e => e.hash), [r1.hash], 'the builder\'s library holds the R1 entry');
      const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
      const solvePath = path.join(workdir, 'solve.mjs'); writeFileSync(solvePath, parentSolver(r1.hash));
      const perCase = a.traces.map((tr, i) => ({ id: `trace-${i}`, ref: tr.traceId, kind: 'trace', status: 'exact', exact: true, partial: 1 }));
      return { record: { checkTraces: { exact: 1, exactRate: 1, partial: 1, deopts: 0, crashes: 0, deoptKinds: {}, perCase, clean: true, unexplained: [], accepted: true },
        promptVersion: 5, builderCostUsd: 0, gatewayCostUsd: 0, checkCostUsd: 0, compileCostUsd: 0, nestedModelAttempts: 0 }, workdir, solvePath };
    },
    runCompiled,
  };
  const res = await runStream({ config, deps, runRoot, workRoot: path.join(root, 'work'), log: () => {} });
  assert.deepEqual(res.arms[0].errors, []);
  const p = armPaths(path.join(runRoot, 'r4-dry'), slug), rows = readJsonl(p.results), row = rows.find(r => r.idx === 1);
  assert.equal(seen.compile, 1);
  assert.equal(row.delivered, 'compiled', JSON.stringify(row.events)); assert.equal(row.compiledStatus, 'ok'); assert.equal(row.taskKey.includes('342') || row.seed === 342, true);
  // The two calls: S? in-profile -> the library R1 solver (one $0.02 judge); the planted pack -> refused outside-profile -> interpreted ($0.05).
  const callRows = readJsonl(path.join(p.dir, 'calls.jsonl'));
  assert.deepEqual(callRows.map(e => [e.childId, e.kind, e.callee === r1.hash]).sort(), [[inside.sub_id, 'call-end', true], [planted.sub_id, 'interpret-child', true]].sort());
  const end = callRows.find(e => e.kind === 'call-end'), ic = callRows.find(e => e.kind === 'interpret-child');
  assert.equal(end.childId, inside.sub_id); close(end.spentUsd, 0.02, 'the R1 solver\'s judge'); assert.equal(end.applicability.novel, false); assert.equal(end.applicability.checked, true);
  assert.equal(ic.childId, planted.sub_id); assert.equal(ic.refused, 'outside-profile'); assert.equal(ic.outcome, 'refused'); assert.equal(ic.interpreted.ok, true); close(ic.spentUsd, 0.05, 'the interpreter');
  assert.ok(ic.refusedDetail.reasons.some(r => r.path.startsWith(`inputs.invoices.${planted.planted.system}`)), 'refused on the planted system');
  assert.ok(end.promptDigest && ic.promptDigest, 'the per-call prompts are in the key');
  // The interpreter solved the planted pack alone: its own prompt and inputs, the call's budget, the arm's interpreter.
  assert.equal(seen.child.length, 1);
  assert.deepEqual({ ...seen.child[0], systems: undefined }, { prompt: task342.inputs.subsidiaries[planted.sub_id].prompt, budgetUsd: 0.3, model: 'claude-haiku-5-5', familyId: 'wbed-r1', systems: undefined });
  // Budget roll-up: the row's compiled cost = the child solver + the interpreter = the host's spend at depth 1, exactly.
  close(row.costBreakdown.compiled, 0.07, 'compiled = $0.02 + $0.05');
  assert.deepEqual({ ...row.calls, callSpentUsd: undefined }, { childCalls: 2, callSpentUsd: undefined, ends: 1, refused: 0, deopts: 0, interpreted: 1, warnings: 0 }); close(row.calls.callSpentUsd, 0.07, 'host total');
  close(callRows.reduce((s, e) => s + e.spentUsd, 0), row.costBreakdown.compiled, 'calls.jsonl sums to the row');
  const compiledEv = row.events.find(e => e.kind === 'compiled'); close(compiledEv.costUsd, 0.07, 'the compiled event');
  // The parent's own trace: phase spans around the calls, the planted pack as interpret-child (localDeopt).
  const runDir = path.join(root, 'work', 'r4-dry', slug), dir = readdirSync(runDir).find(d => d.startsWith('i001-compiled-'));
  const trace = readJsonl(path.join(runDir, dir, 'trace.jsonl'));
  assert.deepEqual(trace.filter(e => e.kind.startsWith('phase-')).map(e => [e.kind, e.span]), [['phase-start', 'phase:children#0'], ['phase-end', 'phase:children#0']]);
  assert.ok(trace.filter(e => e.kind.startsWith('call-') || e.kind === 'interpret-child').every(e => e.phase === 'phase:children#0'));
  const pic = trace.find(e => e.kind === 'interpret-child'); assert.equal(pic.localDeopt, true); assert.equal(pic.name, planted.sub_id);
  assert.deepEqual(JSON.parse(readFileSync(path.join(runDir, dir, '.solve.stdout'), 'utf8').trim()), { children: Object.fromEntries(kids.map(k => [k.sub_id, k.outsideProfile ? 'interpreter' : 'r1-solver'])) });
  // The child ran in its own sandbox and trace; the interpreted pack left a child trace in the arm (not in its compile pool).
  assert.ok(existsSync(path.join(runDir, dir, 'calls-root', end.childTrace)));
  const ev = readJsonl(p.events);
  assert.ok(ev.some(e => e.kind === 'interpret-child' && e.callee === r1.hash && e.reason === 'outside-profile'));
  assert.ok(ev.some(e => e.kind === 'library-register'), 'the parent version was registered too (CUR keeps it for the next rung)');
  assert.ok(readdirSync(p.traces).some(f => f.includes('-child-')));
});
