// flow-v3 slice 2b wiring (design/FLOW-V3-SLICE2.md §9-§13): config.library.agent / wide (validation, the budget rule with
// the agent reservation, arm hashes), a library arm whose compiled run asks for an agent node (the stream's runner in an
// arm-neutral session directory, the node trace, calls.jsonl with the node's value under its name, the harvest kept and
// exported, the row's agent totals), the opt-in prompt lines, compile's new options, and the R5 dump-profile finding
// (eval-dump-profiles.mjs) on a small fixed set. No model calls; $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runStream, normalizeConfig, parseArm, POLICY_MODELS, armPaths } from '../stream.mjs';
import { CALL_MODEL } from '../call-host.mjs';
import { builderPrompt } from '../prompts.mjs';
import { compile } from '../compile.mjs';
import { learnProfile, checkProfile, PARAMS_V2, PARAMS_V3, TOLERANT_CHECK, STRUCTURE_CHECK, CONTENT_FEATURES } from '../profile.mjs';
import { dumpTask } from '../eval-dump-profiles.mjs';

const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-s2b-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const ARM = 'jit:claude-haiku-5-5/claude-haiku-5-5';
const LIB = { mode: 'iso', childBudgetUsd: 0.3, concurrency: 2, parentMarginUsd: 0.1 };
const BASE = { experiment: 'lib-agent', familyId: 'fake', split: 'dev', segments: [{ difficulty: 3, seeds: '1..3' }], arms: [ARM],
  jit: { warmup: 1, shadowEvery: 0, recompileOnDeopts: 1, maxTraces: 8, compilerFallback: 'claude-opus-5-5' }, perTaskUsd: 1.2, agentBudgetUsd: 1, agentMinutes: 1, concurrency: 1,
  compile: { promptVersion: 5 } };
const hashOf = raw => { const c = normalizeConfig(raw); return parseArm(ARM, c, { policyIds: [...POLICY_MODELS] }).hash; };

test('config.library.agent and wide: validated; the budget rule adds the agent reservation; set, each defines a new arm; absent, the slice 2a arm hash', () => {
  const plain = normalizeConfig({ ...BASE, library: LIB }).library;
  assert.equal('agent' in plain, false); assert.equal('wide' in plain, false);
  const lib = normalizeConfig({ ...BASE, library: { ...LIB, agent: { budgetUsd: 0.3 }, wide: true } }).library;
  assert.deepEqual(lib.agent, { budgetUsd: 0.3, model: null, stallMs: null, textLabel: 'synthetic' }); assert.equal(lib.wide, true);
  const h = hashOf({ ...BASE, library: LIB });
  assert.notEqual(hashOf({ ...BASE, library: { ...LIB, agent: { budgetUsd: 0.3 } } }), h); assert.notEqual(hashOf({ ...BASE, library: { ...LIB, wide: true } }), h);
  assert.equal(hashOf({ ...BASE, library: { ...LIB, wide: false } }), h, 'wide: false is the default');
  assert.throws(() => normalizeConfig({ ...BASE, perTaskUsd: 1, library: { ...LIB, agent: { budgetUsd: 0.4 } } }),
    /perTaskUsd 1 is below concurrency × childBudgetUsd \+ agent\.budgetUsd \+ parentMarginUsd = 2 × 0\.3 \+ 0\.4 \+ 0\.1 = 1\.1/);
  assert.equal(normalizeConfig({ ...BASE, perTaskUsd: 1, library: { ...LIB, agent: { budgetUsd: 0.3 } } }).library.agent.budgetUsd, 0.3, 'exactly at the rule is allowed');
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, agent: { budgetUsd: 0.05 } } }), /budgetUsd must be a number >= 0\.1/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, agent: { budgetUsd: 0.3, textLabel: 'corpus' } } }), /textLabel must be one of synthetic, third-party/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, agent: { budgetUsd: 0.3, tools: ['Task'] } } }), /agent\.tools is not supported/);
  assert.throws(() => normalizeConfig({ ...BASE, library: { ...LIB, wide: 'yes' } }), /wide must be true or false/);
});

test('library arm with agent nodes (fakes): the compiled run\'s agent request runs on the stream\'s runner in an arm-neutral session; trace, event, calls.jsonl value, harvest, export and row totals', async t => {
  const root = tmp(t), runRoot = path.join(root, 'runs'), workRoot = path.join(root, 'work');
  const nodeCalls = [], compiles = [];
  const deps = {
    policyIds: [...POLICY_MODELS], outputSchema: { type: 'object' },
    makeTasks: async (familyId, { split, seeds, difficulty }) => seeds.map(seed => ({ familyId, task: { id: `fake:${seed}`, seed, split, difficulty, prompt: `Task ${seed}.`, inputs: { seed }, files: { 'dump/A.TXT': `rows ${seed}` } },
      taskKey: `fake:s${seed}`, taskHash: `h${seed}` })),
    createModelPort: () => ({ port: { fake: true, policy: { models: [] } } }),
    score: async (f, task, output) => ({ pass: output?.v === task.seed, score: 1 }),
    async interpret(a) { return { traceId: a.traceId, answer: { v: a.task.seed }, costUsd: 0.1, costUnknown: false, error: null, scripts: [], commands: [], task: { prompt: a.task.prompt, inputs: a.task.inputs } }; },
    async agentNode(a) {
      nodeCalls.push(a);
      return { answer: { rows: [a.files['dump/A.TXT']] }, costUsd: 0.12, turns: 4, transcriptSha256: 'c'.repeat(64), nestedModelAttempts: 0, hiddenPathAttempts: 0,
        scripts: [{ path: 'decode.mjs', text: 'export default 1;\n', bytes: 18, source: 'workdir' }], prompt: 'not kept' };
    },
    // A stand-in for the sandboxed run: the solver's agent request, through the call host port the stream built.
    async runCompiled(a) {
      const r = await a.modelPort.call({ modelId: CALL_MODEL, prompt: JSON.stringify({ v: 1, op: 'agent', name: 'decode-dump', span: 'agent:decode-dump#0', attempt: 0, instructions: 'Decode.',
        files: { 'dump/A.TXT': a.task.files['dump/A.TXT'] }, returns: { type: 'object', required: ['rows'], properties: { rows: { type: 'array' } } }, budgetUsd: 0.3, harvest: true }) });
      return { status: 'ok', output: { v: a.task.seed, node: r.value.status }, trace: [], costUsd: r.costUsd, costUnknown: false, latencyMs: 1, error: null, meta: { errors: {} } };
    },
    async compile(a) {
      compiles.push(a);
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const workdir = path.join(a.workRoot, a.label); mkdirSync(workdir, { recursive: true });
      const solvePath = path.join(workdir, 'solve.mjs'); writeFileSync(solvePath, `// ${a.label}\n`);
      const perCase = a.traces.map((tr, i) => ({ id: `trace-${i}`, ref: tr.traceId, kind: 'trace', status: 'exact', exact: true, partial: 1 }));
      return { record: { checkTraces: { exact: perCase.length, exactRate: 1, partial: 1, deopts: 0, crashes: 0, deoptKinds: {}, perCase, clean: true, unexplained: [], accepted: true },
        promptVersion: a.promptVersion, builderCostUsd: 1, gatewayCostUsd: 0, checkCostUsd: 0, compileCostUsd: 1, nestedModelAttempts: 0 }, workdir, solvePath };
    },
  };
  const config = { ...BASE, library: { ...LIB, agent: { budgetUsd: 0.3 }, wide: true } };
  const res = await runStream({ config, deps, runRoot, workRoot, log: () => {} });
  assert.deepEqual(res.arms[0].errors, []);
  const slug = parseArm(ARM, normalizeConfig(config), { policyIds: [...POLICY_MODELS] }).slug, p = armPaths(path.join(runRoot, 'lib-agent'), slug);
  const rows = readJsonl(p.results), compiled = rows.filter(r => r.delivered === 'compiled');
  assert.ok(compiled.length >= 1);
  assert.ok(nodeCalls.length >= 1);
  for (const a of nodeCalls) {
    assert.ok(a.workdir.startsWith(path.join(workRoot, 'lib-agent', 'w') + path.sep), 'interpreter-family session directory');
    assert.match(path.basename(a.workdir), /^[0-9a-f]{12}$/); assert.ok(!a.workdir.includes(slug), 'the path names neither arm nor role');
    assert.equal(a.model, 'claude-haiku-5-5', 'the arm\'s interpreter by default');
  }
  const row = compiled[0];
  assert.deepEqual(row.calls.agents, { nodes: 1, ok: 1, void: 0, failed: 0, refused: 0, spentUsd: 0.12, harvested: 1, stalls: 0 });
  assert.equal(row.calls.childCalls, 0);
  const calls = readJsonl(path.join(p.dir, 'calls.jsonl')).filter(e => e.idx === row.idx);
  assert.equal(calls[0].kind, 'agent-end'); assert.equal(calls[0].childId, 'decode-dump'); assert.deepEqual(calls[0].output, { rows: [`rows ${row.idx + 1}`] });
  const ev = row.events.find(e => e.kind === 'agent-node');
  assert.ok(ev && ev.answer === true && ev.costUsd === 0.12 && ev.scripts === 1);
  const tr = JSON.parse(readFileSync(path.join(p.traces, `${ev.traceId}.json`), 'utf8'));
  assert.equal(tr.role, 'agent-node'); assert.equal(tr.name, 'decode-dump'); assert.equal(tr.prompt, undefined); assert.equal(tr.scripts[0].path, 'decode.mjs');
  const harvest = readdirSync(path.join(p.dir, 'harvest'));
  assert.ok(harvest.length >= 1);
  const h = JSON.parse(readFileSync(path.join(p.dir, 'harvest', harvest[0]), 'utf8'));
  assert.equal(h.name, 'decode-dump'); assert.equal(h.cluster, 'A.TXT');
  assert.ok(existsSync(path.join(runRoot, 'lib-agent', 'export', slug, 'harvest', harvest[0])), 'the export carries the harvest');
  // The builder was told about agent nodes and wide, and its host gets the agent runner.
  assert.ok(compiles.every(c => c.agentBudgetUsd === 0.3 && c.wide === true && typeof c.callHost.agent.runner === 'function' && c.callHost.agent.textLabel === 'synthetic'));
});

test('prompt version 5: agent and wide lines are opt-in insertions (the slice 2a text is unchanged without them); compile validates the new options', async () => {
  const base = { traces: 2, regressions: 0, minutes: 30, gatewayUsd: 1.5, perTaskUsd: 1, models: ['claude-haiku-5-5'], promptVersion: 5, library: 2 };
  const plain = builderPrompt('compile', base), agents = builderPrompt('compile', { ...base, agentBudgetUsd: 0.3 }), wide = builderPrompt('compile', { ...base, wide: true });
  assert.ok(!plain.includes('flow.agent') && !plain.includes('flow.wide'));
  assert.match(agents, /10\. When part of a task is data no code/); assert.match(agents, /at most \$0\.3, carved from yours/); assert.match(agents, /await flow\.agent\('decode'/);
  assert.match(wide, /11\. For many independent items/); assert.match(wide, /await flow\.wide\('items'/);
  const strip = s => s.split('\n').filter(l => !plain.includes(l) ? false : true).join('\n');
  assert.equal(strip(agents), plain, 'only inserted lines'); assert.equal(strip(wide), plain, 'only inserted lines');
  assert.equal(builderPrompt('compile', { ...base, library: 0, agentBudgetUsd: 0.3 }), builderPrompt('compile', { ...base, library: 0 }), 'no library: no agent lines');
  const args = { familyId: 'wbed-r5', traces: [{ task: { prompt: 'p', inputs: {} } }], modelPort: { policy: { models: [{ id: 'claude-haiku-5-5' }] } }, models: ['claude-haiku-5-5'], workRoot: '/nonexistent', label: 'x', promptVersion: 5 };
  await assert.rejects(() => compile({ ...args, agentBudgetUsd: 0.3 }), /need a library/);
  await assert.rejects(() => compile({ ...args, outputSchema: [] }), /outputSchema must be a schema object/);
});

test('R5 dump profiles (eval-dump-profiles.mjs, dev seeds): a PARAMS_V3 profile with STRUCTURE_CHECK tells formats apart by their files; PARAMS_V2 misses a monthly-csv dump', () => {
  assert.ok(CONTENT_FEATURES.includes('line-format') && STRUCTURE_CHECK.ignore.includes('vocabulary') && STRUCTURE_CHECK.ignore.includes('line-count'));
  const stanzas = [301, 304, 313, 314, 316, 317].map(s => dumpTask(s, 'dev', 3)), held = [320, 326].map(s => dumpTask(s, 'dev', 3));
  const others = [dumpTask(342, 'dev', 3), dumpTask(301, 'dev', 5), dumpTask(303, 'dev', 5), dumpTask(303, 'dev', 3)];
  assert.ok(stanzas.every(x => x.format === 'keyed-stanzas') && held.every(x => x.format === 'keyed-stanzas'));
  assert.deepEqual(others.map(x => x.format), ['monthly-csv', 'column-store', 'print-image', 'code-page']);
  const v3 = learnProfile(stanzas.map(x => x.task), PARAMS_V3), v2 = learnProfile(stanzas.map(x => x.task), PARAMS_V2);
  assert.deepEqual(held.map(x => checkProfile(v3, x.task, STRUCTURE_CHECK).novel), [false, false], 'its own format is served');
  assert.deepEqual(others.map(x => checkProfile(v3, x.task, STRUCTURE_CHECK).novel), [true, true, true, true], 'every other format is refused, d5 novel ones included');
  const r = checkProfile(v3, others[1].task, STRUCTURE_CHECK).reasons.map(x => x.feature);
  assert.ok(r.includes('new-path') || r.includes('file-roles') || r.includes('missing-path'), r.join(','));
  // The v2 profile walks inputs.files as an object: a file name with a dot is not a path segment it can parent, so a monthly
  // CSV dump (new file names) raises no new-path and passes (the 105 wrong passes of §12).
  assert.equal(checkProfile(v2, others[0].task, TOLERANT_CHECK).novel, false);
});
