// C0 protocol (preflight R2, R5, R8 and kit hygiene): the session policy subset, the builder's policy file,
// the runtime's default model timeout, killed-session pricing in B0, kit integrity and the STALE_WORKFLOW hint.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { loadPolicy } from '../../src/models/policy.mjs';
import { ModelPort } from '../../src/models/port.mjs';
import { Journal } from '../../src/journal.mjs';
import { ScriptedProvider } from '../../src/models/providers/scripted.mjs';
import { validateWorkflow } from '../../src/validate.mjs';
import { createDefaultRegistry } from '../../src/capabilities.mjs';
import { Foundry } from '../../src/foundry.mjs';
import { sandboxAvailable } from '../../src/executors/claude-code.mjs';
import { subsetPolicy, createModelPort } from './models.mjs';
import { buildKit, kitIntact, kitFiles, SCRIPT_KIT_ALLOW } from './kit.mjs';
import { foundryWorkflow } from './arms/foundry-workflow.mjs';
import { b0Agent } from './arms/b0-agent.mjs';
import { construct } from '../c0/construct.mjs';
import { builderPrompt } from '../c0/prompts.mjs';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const cli = path.join(root, 'bin/foundry.mjs');
const owner = loadPolicy();
const MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'c0p-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const agentWorkflow = cls => ({
  schemaVersion: '1.0', id: 'c0-policy', version: 1, title: 't', goal: 'classify', domain: 'test',
  envelope: { assumptions: [], risks: [], successCriteria: ['labelled'] }, budget: { maxSteps: 20, maxConcurrency: 2, maxDurationMs: 120000, maxCost: 1 },
  nodes: [{ id: 'answer', kind: 'agent', needs: [], description: 'label', role: 'classify', instructions: 'Label the text.',
    context: { inputs: [{ name: 'text', ref: 'input.prompt', label: 'trusted', render: 'text' }] },
    returns: { type: 'object', properties: { team: { type: 'string', enum: ['a', 'b'] } }, required: ['team'], additionalProperties: false },
    model: { class: cls, maxClass: 'F' } }],
  acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.team' } }],
});

test('subsetPolicy keeps only the session models and their providers; class S is empty and fails validation', () => {
  const sub = subsetPolicy(owner.policy, MODELS);
  assert.deepEqual(sub.models.map(m => m.id), MODELS); assert.deepEqual(Object.keys(sub.providers), ['claude-cli']);
  assert.match(sub.policyVersion, /\+only:/); assert.ok(Object.isFrozen(sub));
  assert.throws(() => subsetPolicy(owner.policy, ['claude-opus-5-5', 'gpt-x']), /not in the owner policy: gpt-x/);
  const registry = createDefaultRegistry();
  const s = validateWorkflow(agentWorkflow('S'), { registry, modelPolicy: sub });
  assert.equal(s.valid, false); assert.ok(s.errors.some(e => e.code === 'MODEL_CLASS_EMPTY'), JSON.stringify(s.errors));
  assert.equal(validateWorkflow(agentWorkflow('M'), { registry, modelPolicy: sub }).valid, true);
  assert.equal(validateWorkflow(agentWorkflow('S'), { registry, modelPolicy: owner.policy }).valid, true, 'the owner policy still has class S');
});

test('createModelPort with allowedModels constructs no local provider and records both policy hashes', t => {
  const dir = tmp(t);
  const { port, policyHash, ownerPolicyHash, db } = createModelPort({ journalFile: path.join(dir, 'j.sqlite'), allowedModels: MODELS, concurrency: { 'claude-cli': 16 } });
  t.after(() => db.close());
  assert.deepEqual(Object.keys(port.providers), ['claude-cli'], 'no LlamaServerProvider: a local server can never be started');
  assert.equal(port.policyHash, policyHash); assert.equal(ownerPolicyHash, owner.hash); assert.notEqual(policyHash, owner.hash);
  assert.equal(port.concurrency['claude-cli'], 16);
});

test('the Foundry CLI validates against a session policy file (validate --policy)', t => {
  const dir = tmp(t);
  const policyFile = path.join(dir, 'policy.json'), wf = path.join(dir, 'wf.json');
  writeFileSync(policyFile, JSON.stringify(subsetPolicy(owner.policy, MODELS))); writeFileSync(wf, JSON.stringify(agentWorkflow('S')));
  const r = spawnSync(process.execPath, [cli, 'validate', wf, '--policy', policyFile], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr); assert.match(r.stdout, /MODEL_CLASS_EMPTY/);
  writeFileSync(wf, JSON.stringify(agentWorkflow('M')));
  assert.equal(spawnSync(process.execPath, [cli, 'validate', wf, '--policy', policyFile], { encoding: 'utf8' }).status, 0);
});

test('a workspace holding another version of the workflow id refuses with a usable STALE_WORKFLOW hint', t => {
  const dir = tmp(t), wf = path.join(dir, 'wf.json'), ws = path.join(dir, 'ws');
  const w = { ...agentWorkflow('M'), nodes: [{ id: 'answer', kind: 'code', needs: [], description: 'c', lang: 'js', source: 'export default () => ({ team: "a" });' }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.answer.team' } }] };
  writeFileSync(wf, JSON.stringify(w));
  assert.equal(spawnSync(process.execPath, [cli, 'run', wf, '--input', '{}', '--workspace', ws], { encoding: 'utf8' }).status, 0);
  writeFileSync(wf, JSON.stringify({ ...w, title: 'edited' }));
  const r = spawnSync(process.execPath, [cli, 'run', wf, '--input', '{}', '--workspace', ws], { encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /STALE_WORKFLOW/); assert.match(r.stdout + r.stderr, /fresh --workspace/);
});

test('the F arm runs on the port policy (a subset) and the runtime defaults a node call timeout to the port timeout (R8)', async t => {
  const sub = subsetPolicy(owner.policy, MODELS);
  const provider = new ScriptedProvider(() => ({ value: { team: 'a' }, costUsd: 0.001 }));
  const port = new ModelPort({ policy: sub, journal: new Journal(new DatabaseSync(':memory:')), providers: { 'claude-cli': provider }, timeoutMs: 290000 });
  const seen = []; const spy = Object.assign(Object.create(port), { call: req => { seen.push(req.timeoutMs); return port.call(req); }, policyHash: port.policyHash, policy: sub, journal: port.journal, timeoutMs: port.timeoutMs });
  const arm = foundryWorkflow({ id: 'F-t', workflow: agentWorkflow('M'), modelPort: spy, maxDurationMs: 600000 });
  assert.equal(arm.def.policyHash, port.policyHash); assert.equal(arm.def.maxDurationMs, 600000); assert.match(arm.def.workflowSha, /^[0-9a-f]{16}$/);
  const r = await arm.run({ task: { prompt: 'refund', inputs: {} }, taskKey: 'x', trial: 0, workdir: tmp(t) });
  assert.equal(r.error, null, JSON.stringify(r.error)); assert.deepEqual(r.output, { team: 'a' });
  assert.deepEqual(seen, [290000], 'no node timeoutMs: the ModelPort timeout, not a separate 120 s default');
});

test('construct refuses a model port whose policy is not exactly the session models', async () => {
  await assert.rejects(construct({ arm: 'F', familyId: 'records', modelPort: { policy: owner.policy }, workRoot: '/nonexistent', label: 'x', models: MODELS }), /must be exactly the session models/);
  await assert.rejects(construct({ arm: 'B2', familyId: 'records', modelPort: { policy: owner.policy }, models: MODELS }), /unknown construction arm/);
});

test('builder prompts: both arms point to their skill in the kit; F lists the session classes; B1 states the execution environment', () => {
  const opts = { probes: 3, minutes: 45, constructionModelUsd: 2, perTaskUsd: 1, scoreChecks: 12, models: MODELS, classes: 'M = a, L = b, F = c', kitDir: '/opt/foundry-kit/k' };
  const f = builderPrompt('F', opts), b = builderPrompt('B1', opts);
  assert.match(f, /\/opt\/foundry-kit\/k\/skills\/micro-harness\/SKILL\.md/); assert.match(b, /\/opt\/foundry-kit\/k\/skills\/script-harness\/SKILL\.md/);
  assert.match(f, /Model classes in this session \(\.\/tools\/policy\.json\): M = a, L = b, F = c/); assert.match(f, /new --workspace after each edit/);
  for (const p of [f, b]) assert.match(p, /node tools\/budget\.mjs prints the construction model spend/);
  assert.match(b, /no network other than callModel/); assert.match(b, /\.\/tools\/run-solver probes\/probe-0/); assert.match(b, /tools\/calls\.jsonl/);
  assert.equal(f.split('\n').slice(0, 12).join('\n'), b.split('\n').slice(0, 12).join('\n'), 'the shared preamble is identical');
});

test('guidance symmetry: script-harness is family-neutral and within ±15% of micro-harness (SKILL.md and its reference)', () => {
  const size = p => readFileSync(path.join(root, p)).length;
  const r1 = size('skills/script-harness/SKILL.md') / size('skills/micro-harness/SKILL.md');
  const r2 = size('skills/script-harness/references/patterns.md') / size('skills/micro-harness/references/operators.md');
  assert.ok(r1 >= 0.85 && r1 <= 1.15, `SKILL.md ratio ${r1}`); assert.ok(r2 >= 0.85 && r2 <= 1.15, `reference ratio ${r2}`);
  const text = readFileSync(path.join(root, 'skills/script-harness/SKILL.md'), 'utf8') + readFileSync(path.join(root, 'skills/script-harness/references/patterns.md'), 'utf8');
  for (const family of ['incident', 'codefix', 'kinetics', 'gridquest', 'gameqa', 'runbook']) assert.doesNotMatch(text, new RegExp(family, 'i'));
  assert.deepEqual(kitFiles(SCRIPT_KIT_ALLOW).sort(), ['skills/script-harness/SKILL.md', 'skills/script-harness/references/patterns.md']);
});

test('a kit directory that was modified is rebuilt, never reused', t => {
  const base = tmp(t);
  const kit = buildKit({ base, allow: SCRIPT_KIT_ALLOW });
  const files = kitFiles(SCRIPT_KIT_ALLOW);
  assert.equal(kitIntact(kit.dir, files, kit.hash), true);
  writeFileSync(path.join(kit.dir, 'skills/script-harness/SKILL.md'), 'planted');
  writeFileSync(path.join(kit.dir, 'extra.md'), 'planted');
  assert.equal(kitIntact(kit.dir, files, kit.hash), false);
  const again = buildKit({ base, allow: SCRIPT_KIT_ALLOW });
  assert.equal(again.hash, kit.hash); assert.equal(kitIntact(again.dir, files, again.hash), true); assert.equal(existsSync(path.join(again.dir, 'extra.md')), false);
});

test('B0 charges a killed session at its budget bound and records the transcript scan (R5)', { skip: sandboxAvailable() ? false : 'no user namespaces' }, async t => {
  const workdir = tmp(t);
  const fake = path.join(workdir, 'fake-claude');
  writeFileSync(fake, `#!/bin/sh\ncat > /dev/null\necho '{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","name":"Bash","input":{"command":"claude -p hi"}}],"usage":{"input_tokens":3,"output_tokens":9}}}'\nsleep 30\n`);
  chmodSync(fake, 0o755);
  const arm = b0Agent({ id: 'B0-t', model: 'claude-haiku-4-5-20251001', budgetUsd: 1, timeoutMs: 2500, binary: fake });
  assert.equal(arm.def.binary, undefined, 'the stand-in binary is not part of the arm definition');
  const r = await arm.run({ task: { prompt: 'p', inputs: {} }, familyId: 'records', outputSchema: { type: 'object' }, workdir, state: {} });
  assert.equal(r.costUsd, 1); assert.equal(r.costUnknown, true); assert.equal(r.error.code, 'EXECUTOR_TIMEOUT');
  assert.equal(r.meta.nestedModelAttempts, 1); assert.deepEqual(r.meta.streamUsage, { inputTokens: 3, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 0 });
});
