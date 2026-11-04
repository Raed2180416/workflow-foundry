import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Foundry } from '../src/foundry.mjs';
import { engineHash, engineIdentity, engineOf, engineResumesFrom, engineVersion } from '../src/engine.mjs';
import { engineBinding, identityChanges } from '../src/audit.mjs';
import { verifyRun } from '../src/verify-run.mjs';

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
  // Copy exactly the engine identity set (src/ modules and schemas), so the copy is the whole engine.
  const names = Object.keys(engineIdentity().files);
  assert.ok(names.includes('runtime.mjs') && names.includes('../schemas/workflow.schema.json'));
  for (const name of names) {
    const target = path.join(copied, 'src', name);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(sourceRoot, 'src', name), target);
  }
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

// Engine compatibility ranges (research/engine-20261021/ENGINE-BUMP.md §1).
// A copy of exactly the engine identity set (src/ modules, schemas, lineage) under dir/name, changed by `edit(srcDir)`.
function engineCopy(dir, name, edit = () => {}) {
  const copied = path.join(dir, name);
  for (const file of Object.keys(engineIdentity().files)) {
    const target = path.join(copied, 'src', file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(sourceRoot, 'src', file), target);
  }
  symlinkSync(path.join(sourceRoot, 'node_modules'), path.join(copied, 'node_modules'), 'dir');
  edit(path.join(copied, 'src'));
  return copied;
}
// Run `action` against the workspace in a second process that loads the engine copy.
function underEngine(copied, workspace, action, runId = null) {
  const url = file => JSON.stringify(new URL(`file://${path.join(copied, 'src', file)}`).href);
  const code = `
    import {Store} from ${url('store.mjs')};
    import {Runtime} from ${url('runtime.mjs')};
    import {createDefaultRegistry} from ${url('capabilities.mjs')};
    import {engineHash, engineIdentity} from ${url('engine.mjs')};
    const store=new Store(${JSON.stringify(workspace)});
    const action=${JSON.stringify(action)};
    try {
      if (action==='identity') console.log(JSON.stringify({engineHash, files: engineIdentity().files}));
      else {
        const runtime=new Runtime(store,createDefaultRegistry());
        const id = action==='create' ? runtime.create(${JSON.stringify(workflow())}, {}).id : ${JSON.stringify(runId)};
        const r=await runtime.execute(id); console.log(JSON.stringify({id, status:r.status, engineHash}));
      }
    } catch(error){console.log(JSON.stringify({code:error.code, details:error.details ?? null, message:error.message, engineHash}));}
    finally {store.close();}
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' }, timeout: 15000, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
}
const lineageOf = srcDir => JSON.parse(readFileSync(path.join(srcDir, 'engine-lineage.json'), 'utf8'));

test('Engine lineage: version 1 (commit 96cab64, the engine of the 10-21 runs) is a resumable predecessor on this host', () => {
  assert.ok(engineVersion >= 2 && engineResumesFrom <= 1);
  assert.deepEqual(engineOf(engineHash), { version: engineVersion, current: true, resumable: true });
  assert.equal(engineOf('0'.repeat(64)), null);
  // The hash the 10-21 runs recorded on the owner's host (node v24.21.0, linux x64, ajv 8.20.0): it must be recognised as version 1.
  const id = engineIdentity();
  if (id.node === 'v24.21.0' && id.platform === 'linux' && id.architecture === 'x64' && id.validator === 'ajv@8.20.0')
    assert.equal(engineOf('358cb02019b9826d7181bc313b8f5084a35c45c47c50b051f8149e863caad9f6')?.version, 1);
  assert.ok(id.files['engine-lineage.json'], 'the lineage is part of the engine identity');
});

test('Engine lineage: the chain decides the bound engine; a broken migration chain is an identity change', () => {
  const [a, b, c] = ['a', 'b', 'c'].map(x => x.repeat(64));
  const birth = { type: 'run.created', engineHash: a };
  assert.deepEqual(engineBinding([birth]), { valid: true, hash: a, engines: [a], migrations: [] });
  const moved = [birth, { type: 'engine.migrated', seq: 2, from: a, to: b, fromVersion: 1, toVersion: 2 }];
  assert.equal(engineBinding(moved).hash, b);
  assert.deepEqual(identityChanges({ engineHash: b }, birth, moved), []);
  assert.deepEqual(identityChanges({ engineHash: a }, birth, moved), ['engineHash'], 'the record must follow the migration');
  const skipped = [...moved, { type: 'engine.migrated', seq: 3, from: a, to: c }];
  assert.equal(engineBinding(skipped).valid, false);
  assert.ok(identityChanges({ engineHash: c }, birth, skipped).includes('engineMigration'));
});

test('Engine lineage: a run of a declared-compatible predecessor resumes with engine.migrated in its chain; outside the range, and backwards, it refuses', async t => {
  const { dir, foundry } = await setup(t), workspace = foundry.store.workspace;
  // "old": an engine differing from this checkout by one comment. Its exact file map is what a successor freezes into its lineage.
  const old = engineCopy(dir, 'old', src => appendFileSync(path.join(src, 'runtime.mjs'), '\n// Synthetic predecessor engine (test only).\n'));
  const oldId = underEngine(old, workspace, 'identity');
  const created = underEngine(old, workspace, 'create');
  assert.equal(created.status, 'awaiting_human'); assert.equal(foundry.store.run(created.id).engineHash, oldId.engineHash);
  const successor = (name, version, resumesFrom) => engineCopy(dir, name, src => {
    const lineage = lineageOf(src);
    writeFileSync(path.join(src, 'engine-lineage.json'), JSON.stringify({ ...lineage, version, resumesFrom, predecessors: [{ version: version - 1, source: 'test: old', files: oldId.files }] }));
  });
  // A successor that lists the predecessor but no longer resumes its version: ENGINE_DRIFT, naming both versions; nothing is written.
  const before = foundry.store.events(created.id);
  const far = underEngine(successor('far', 3, 3), workspace, 'resume', created.id);
  assert.equal(far.code, 'ENGINE_DRIFT'); assert.equal(far.details.recordedVersion, 2); assert.equal(far.details.resumesFrom, 3);
  assert.deepEqual(foundry.store.events(created.id), before);
  // A successor declaring it compatible: the run resumes, and the migration is in its chain, once.
  const next = successor('next', 3, 2);
  const resumed = underEngine(next, workspace, 'resume', created.id);
  assert.equal(resumed.status, 'awaiting_human');
  const migrations = () => foundry.store.events(created.id).filter(e => e.type === 'engine.migrated');
  assert.deepEqual(migrations().map(({ from, to, fromVersion, toVersion, resumesFrom }) => ({ from, to, fromVersion, toVersion, resumesFrom })),
    [{ from: oldId.engineHash, to: resumed.engineHash, fromVersion: 2, toVersion: 3, resumesFrom: 2 }]);
  const migratedAt = migrations()[0].seq, events = foundry.store.events(created.id);
  assert.equal(events[migratedAt].type, 'runner.acquired', 'the migration commits with the ownership it precedes');
  assert.equal(foundry.store.run(created.id).engineHash, resumed.engineHash);
  assert.equal(underEngine(next, workspace, 'resume', created.id).status, 'awaiting_human');
  assert.equal(migrations().length, 1, 'a second resume under the same engine records no migration');
  // The older engine never resumes a run a newer engine migrated: the record names an engine its lineage does not know.
  const back = underEngine(old, workspace, 'resume', created.id);
  assert.equal(back.code, 'ENGINE_DRIFT'); assert.equal(back.details.recordedVersion, null);
  foundry.runtime.answer(created.id, 'root/question', true);
  assert.equal(underEngine(next, workspace, 'resume', created.id).status, 'succeeded');
  // verify-run (under this checkout's engine) accepts the migrated record and reports the migration.
  const report = verifyRun(foundry.store, created.id);
  assert.equal(report.ok, true, JSON.stringify(report.findings));
  assert.ok(report.findings.some(f => f.code === 'ENGINE_MIGRATED' && f.fromVersion === 2 && f.toVersion === 3));
  assert.ok(!report.findings.some(f => f.code === 'RUN_IDENTITY_EDITED'));
});
