import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Foundry } from '../src/foundry.mjs';
import { engineHash, engineIdentity } from '../src/engine.mjs';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const workflow = () => ({ schemaVersion: '1.0', id: 'EngineBound', version: 1,
  title: 'Bind paused execution to its engine', goal: 'Preserve a human question across a compatible restart.', domain: 'general',
  envelope: { assumptions: ['Synthetic local state'], risks: ['Changed runtime semantics'], successCriteria: ['Exact human answer is preserved'] },
  budget: { maxSteps: 3, maxConcurrency: 1, maxDurationMs: 60000, maxCost: 0 },
  nodes: [{ id: 'question', kind: 'human', needs: [], description: 'Pause for an explicit typed answer.', question: 'Proceed with this local control?', answerSchema: { type: 'boolean' } }],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.question.answer' }, right: true }]
});
async function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-engine-'));
  const foundry = new Foundry(path.join(dir, 'workspace')); foundry.save(workflow());
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, foundry };
}

test('Engine binding: native creation records the loaded source identity in both run and event', async t => {
  const { foundry } = await setup(t);
  const run = foundry.runtime.create(workflow(), {}, { engineHash: '0'.repeat(64) });
  assert.equal(run.engineHash, engineHash, 'Caller cannot replace the runtime-owned identity');
  assert.equal(foundry.store.events(run.id)[0].engineHash, engineHash);
  const identity = engineIdentity(); assert.equal(identity.hash, engineHash);
  assert.ok(identity.files['dataflow.mjs']); assert.match(identity.scope, /not remote/);
  assert.equal((await foundry.startRun(run.id)).status, 'awaiting_human');
  foundry.runtime.answer(run.id, 'root/question', true);
  assert.equal((await foundry.startRun(run.id)).status, 'succeeded');
});

test('Engine binding: historical unbound and corrupted bindings fail without dispatch or journal mutation', async t => {
  const { foundry } = await setup(t);
  const hash = foundry.store.workflow(workflow().id).hash;
  const legacy = foundry.store.createRun(hash, {}, foundry.registry.hash(), foundry.runtime.policy);
  const before = foundry.store.events(legacy.id);
  await assert.rejects(foundry.startRun(legacy.id), { code: 'ENGINE_UNBOUND' });
  assert.deepEqual(foundry.store.events(legacy.id), before);
  assert.equal(foundry.store.run(legacy.id).steps, 0);
  foundry.store.updateRun(legacy.id, run => { run.engineHash = engineHash; }, { type: 'synthetic.binding-corruption' });
  await assert.rejects(foundry.startRun(legacy.id), { code: 'ENGINE_BINDING_CORRUPT' });
  assert.equal(foundry.store.run(legacy.id).steps, 0);
});

test('Engine binding: an actual second process with changed engine source rejects a pending run while identical source resumes', async t => {
  const { dir, foundry } = await setup(t), copied = path.join(dir, 'copy');
  mkdirSync(path.join(copied, 'src'), { recursive: true }); mkdirSync(path.join(copied, 'schemas'));
  const names = ['engine.mjs', 'runtime.mjs', 'store.mjs', 'data.mjs', 'dataflow.mjs', 'validate.mjs', 'capabilities.mjs'];
  for (const name of names) copyFileSync(path.join(sourceRoot, 'src', name), path.join(copied, 'src', name));
  copyFileSync(path.join(sourceRoot, 'schemas/workflow.schema.json'), path.join(copied, 'schemas/workflow.schema.json'));
  symlinkSync(path.join(sourceRoot, 'node_modules'), path.join(copied, 'node_modules'), 'dir');
  const run = foundry.createRun(workflow().id);
  const code = `
    import {Store} from ${JSON.stringify(new URL(`file://${path.join(copied, 'src/store.mjs')}`).href)};
    import {Runtime} from ${JSON.stringify(new URL(`file://${path.join(copied, 'src/runtime.mjs')}`).href)};
    import {createDefaultRegistry} from ${JSON.stringify(new URL(`file://${path.join(copied, 'src/capabilities.mjs')}`).href)};
    import {engineHash} from ${JSON.stringify(new URL(`file://${path.join(copied, 'src/engine.mjs')}`).href)};
    const store=new Store(${JSON.stringify(foundry.store.workspace)});
    try { const r=await new Runtime(store,createDefaultRegistry()).execute(${JSON.stringify(run.id)}); console.log(JSON.stringify({status:r.status,engineHash})); }
    catch(error){console.log(JSON.stringify({code:error.code,engineHash}));}
    finally {store.close();}
  `;
  const invoke = () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' }, timeout: 5000, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  };
  const same = invoke(); assert.equal(same.engineHash, engineHash); assert.equal(same.status, 'awaiting_human');
  const before = foundry.store.events(run.id);
  appendFileSync(path.join(copied, 'src/runtime.mjs'), '\n// Synthetic compatibility change, not production code modification.\n');
  const changed = invoke(); assert.notEqual(changed.engineHash, engineHash); assert.equal(changed.code, 'ENGINE_DRIFT');
  assert.deepEqual(foundry.store.events(run.id), before);
  assert.equal(foundry.store.run(run.id).status, 'awaiting_human');
  assert.ok(readFileSync(path.join(sourceRoot, 'src/runtime.mjs'), 'utf8').includes('ENGINE_DRIFT'));
});
