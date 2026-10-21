import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, FoundryError } from '../src/data.mjs';
import { Foundry } from '../src/foundry.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import {
  assertConstraints, builderVisibleIntentPack, bundledIntentProgram, compareIntentCloseness,
  constructFromIntent, constructHarness, createScriptedProvider, detectLeakage, freezeFamily, freezeIntentClass,
  FOUNDRY_IR_LIMITS, INTENT_CLASSES, interpretIntent, ledgerFromGaps, listFamilies, listIntentClasses,
  PRODUCTION_LATTICE, primaryIntentReport, PUBLIC_HARNESS_CATALOG, runConstructionProgram,
  runIntentProgram, INTENT_MOTIFS, INTENT_RESPECTING, INTENT_SCENARIOS, INTENT_SPECS, IR_UNSUPPORTED
} from '../src/construction.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin/foundry.mjs');

test('intent classes are not named-harness families', () => {
  const families = new Set(listFamilies());
  const classes = listIntentClasses();
  assert.deepEqual(classes, ['coding-agent-session', 'cx-supervised-conversation', 'durable-business-process', 'graph-automation']);
  for (const id of classes) {
    assert.equal(families.has(id), false, id);
    assert.equal(families.has(`intent:${id}`), false, `intent:${id}`);
    assert.ok(INTENT_CLASSES[id]);
  }
  assert.throws(() => constructHarness({ familyId: 'intent:durable-business-process', provider: createScriptedProvider('naive') }), { code: 'UNKNOWN_FAMILY' });
  assert.throws(() => freezeFamily('durable-business-process'), { code: 'UNKNOWN_FAMILY' });
});

test('intent split keeps builder pack disjoint from held-out gold', () => {
  for (const id of listIntentClasses()) {
    const frozen = freezeIntentClass(id);
    const pack = builderVisibleIntentPack(frozen);
    assert.equal(frozen.split.disjoint, true);
    assert.equal(frozen.split.builderPackSHA256, digest(frozen.builderPack));
    assert.equal(frozen.split.heldOutSHA256, digest(frozen.heldOut.target));
    assert.equal(JSON.stringify(pack).includes(frozen.heldOut.uniqueMarker), false);
    for (const p of frozen.heldOut.paths) assert.equal(JSON.stringify(pack).includes(p), false);
    assert.equal(pack.intentClass, id);
    assert.equal(pack.familyId, `intent:${id}`);
  }
});

test('intent construction rejects held-out target bytes and held-out repair', () => {
  const frozen = freezeIntentClass('durable-business-process');
  const provider = createScriptedProvider('naive');
  assert.throws(() => constructFromIntent({ intentClass: frozen.id, builderContext: { leak: frozen.heldOut.target }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructFromIntent({ intentClass: frozen.id, builderContext: { text: frozen.heldOut.uniqueMarker }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructFromIntent({ intentClass: frozen.id, builderContext: { files: [frozen.heldOut.paths[0]] }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructFromIntent({ intentClass: frozen.id, provider, repairFeedback: { split: 'heldout' } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.equal(provider.calls.length, 0);
});

test('schema-valid self-attested intent candidate missing motifs fails closeness', () => {
  const built = constructFromIntent({ intentClass: 'durable-business-process', provider: createScriptedProvider('naive') });
  assert.equal(built.candidate.selfAttestedSuccess, true);
  const closeness = compareIntentCloseness(built.candidate, 'durable-business-process');
  assert.equal(closeness.comparable, true);
  assert.equal(closeness.close, false);
  for (const motif of ['side-effects-isolated-from-replay', 'durable-timer-not-process-sleep', 'hitl-survives-worker-death', 'compensate-irreversible-effects', 'workers-ephemeral-history-durable', 'not-a-coding-agent-loop', 'retries-bounded-poison-parks', 'in-flight-code-pinned', 'ir-limits-named-not-papered']) {
    assert.ok(closeness.misses.some(m => m.motif === motif), motif);
  }
  assert.ok(closeness.misses.some(m => m.kind === 'behavioral' && m.scenarioId === 'not-coding-loop'));
  assert.ok(closeness.misses.some(m => m.motif === 'self-attestation'));
});

test('respecting intent gold is close; naive is not; constraint re-injection is independent', () => {
  const naive = constructFromIntent({ intentClass: 'durable-business-process', provider: createScriptedProvider('naive') }).candidate;
  const closeness = compareIntentCloseness(naive, 'durable-business-process');
  const ledger = ledgerFromGaps(closeness.ideologicalGaps);
  assert.throws(() => assertConstraints(naive, ledger), { code: 'CONSTRAINT_VIOLATION' });
  assert.throws(() => constructFromIntent({ intentClass: 'durable-business-process', provider: createScriptedProvider('naive'), constraints: ledger }), { code: 'CONSTRAINT_VIOLATION' });
  const respected = constructFromIntent({ intentClass: 'durable-business-process', provider: createScriptedProvider('respecting'), constraints: ledger });
  assert.equal(assertConstraints(respected.candidate, ledger).ok, true);
  assert.equal(compareIntentCloseness(respected.candidate, 'durable-business-process').close, true);
});

test('coding-agent-shaped candidates fail durable-business-process even when they are gold SWE harnesses', () => {
  const mini = freezeFamily('mini-swe-agent').heldOut.target.harness;
  const miniVsDurable = compareIntentCloseness(mini, 'durable-business-process');
  assert.equal(miniVsDurable.close, false);
  assert.ok(miniVsDurable.ideologicalGaps.some(g => g.motif === 'not-a-coding-agent-loop'));
  assert.ok(miniVsDurable.ideologicalGaps.some(g => g.motif === 'durable-timer-not-process-sleep'));
  assert.ok(miniVsDurable.misses.some(m => m.kind === 'behavioral' && m.scenarioId === 'not-coding-loop'));
  const shape = interpretIntent(mini, { op: 'shape' }, 'durable-business-process');
  assert.equal(shape.codingAgentLoop, true);
  const codex = freezeFamily('openai-codex').heldOut.target.harness;
  const codexVsDurable = compareIntentCloseness(codex, 'durable-business-process');
  assert.equal(codexVsDurable.close, false);
  const temporal = freezeFamily('temporal-durable').heldOut.target.harness;
  const temporalVsDurable = compareIntentCloseness(temporal, 'durable-business-process');
  assert.equal(temporalVsDurable.close, false, 'Temporal gold is a vendor family, not the Foundry-shaped intent lattice (persisted-wake-reinvoke + human-node)');
  const durableGold = constructFromIntent({ intentClass: 'durable-business-process', provider: createScriptedProvider('respecting') }).candidate;
  assert.equal(compareIntentCloseness(durableGold, 'coding-agent-session').close, false);
});

test('every intent gold is close and naive is not; production lattice covers all classes', () => {
  for (const id of listIntentClasses()) {
    const gold = compareIntentCloseness(freezeIntentClass(id).heldOut.target.harness, id);
    assert.equal(gold.close, true, `${id} gold misses ${JSON.stringify(gold.misses)}`);
    const naive = compareIntentCloseness(constructFromIntent({ intentClass: id, provider: createScriptedProvider('naive') }).candidate, id);
    assert.equal(naive.close, false, id);
    assert.ok(naive.ideologicalGaps.length > 0, id);
  }
  const classes = new Set(PRODUCTION_LATTICE.map(m => m.intentClass));
  for (const id of listIntentClasses()) assert.ok(classes.has(id), id);
});

test('intent program constructs without cheating and reports misses plus a constraint ledger', () => {
  const report = runIntentProgram(bundledIntentProgram());
  assert.equal(report.ok, true);
  assert.ok(report.intentClasses.length >= 2);
  assert.ok(report.intentClasses.includes('durable-business-process'));
  assert.ok(report.intentClasses.includes('coding-agent-session'));
  assert.equal(report.noCheat.envelope, 'fail-closed');
  assert.equal(report.closeness.comparable, true);
  assert.equal(report.closeness.close, false);
  assert.ok(report.closeness.misses.length > 0);
  assert.ok(report.constraintLedger.length > 0);
  assert.equal(report.seams.typedDecisionEngine.required, false);
  assert.equal(report.irLimits.delayMsMax, 3600000);
  assert.equal(report.irLimits.compensateKind, false);
  assert.equal(report.irLimits.timerDispatch, 'persisted-wake-reinvoke');
  assert.deepEqual(report.irLimits, FOUNDRY_IR_LIMITS);
  const again = runIntentProgram(bundledIntentProgram());
  assert.deepEqual(primaryIntentReport(again), primaryIntentReport(report));
});

test('catalog encodes Fin and durable runtimes; coding families stay encoded separately', () => {
  const encoded = new Set(PUBLIC_HARNESS_CATALOG.filter(c => c.encoded).map(c => c.id));
  for (const id of ['temporal-durable', 'restate-services', 'inngest-steps', 'intercom-fin', 'openai-codex']) {
    assert.ok(encoded.has(id), id);
  }
  assert.equal(PUBLIC_HARNESS_CATALOG.some(c => c.id === 'intercom-fin' && c.encoded === false), false);
  assert.ok(PUBLIC_HARNESS_CATALOG.some(c => c.id === 'aws-step-functions' && c.encoded === false));
});

test('family program bound rejects more than 32 families; intent bound rejects more than 8 classes', () => {
  const families = [...listFamilies(), 'not-a-family'];
  while (families.length <= 32) families.push(`pad-${families.length}`);
  assert.throws(() => runConstructionProgram({ schemaVersion: '1.0', id: 'too-many', families, provider: 'scripted-naive' }), { code: 'CONSTRUCTION_PROGRAM' });
  const classes = [...listIntentClasses()];
  while (classes.length <= 8) classes.push(`pad-${classes.length}`);
  assert.throws(() => runIntentProgram({ schemaVersion: '1.0', id: 'too-many-intent', intentClasses: classes, provider: 'scripted-naive' }), { code: 'CONSTRUCTION_PROGRAM' });
});

test('CLI construct-intent emits intent classes, no-cheat, misses and constraint ledger', () => {
  const result = spawnSync(process.execPath, [cli, 'construct-intent'], { encoding: 'utf8', timeout: 30000, cwd: root });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.ok(report.intentClasses.length >= 2);
  assert.equal(report.noCheat.envelope, 'fail-closed');
  assert.ok(report.closeness.misses.length > 0);
  assert.ok(report.constraintLedger.length > 0);
  assert.equal(report.ok, true);
  assert.equal(report.irLimits.delayMsMax, 3600000);
});

test('FoundryError remains the fail-closed type on intent leakage', () => {
  try {
    constructFromIntent({
      intentClass: 'graph-automation',
      provider: createScriptedProvider('naive'),
      builderContext: { text: freezeIntentClass('graph-automation').heldOut.uniqueMarker }
    });
    assert.fail('expected throw');
  } catch (error) {
    assert.equal(error instanceof FoundryError, true);
    assert.equal(error.code, 'HOLDOUT_LEAKAGE');
  }
});

test('unknown intent classes fail closed; the lattice is not any-intent', () => {
  assert.throws(() => freezeIntentClass('claims-processing-custom'), { code: 'UNKNOWN_INTENT' });
  assert.throws(() => constructFromIntent({ intentClass: 'claims-processing-custom', provider: createScriptedProvider('naive') }), { code: 'UNKNOWN_INTENT' });
  assert.throws(() => freezeIntentClass('sre-incident-routing'), { code: 'UNKNOWN_INTENT' });
  assert.throws(() => freezeIntentClass('healthcare-triage'), { code: 'UNKNOWN_INTENT' });
});

test('omitted or mismatched intentClass is not fail-open and becomes a constraint', () => {
  const gold = freezeIntentClass('durable-business-process').heldOut.target.harness;
  const omitted = { ...gold };
  delete omitted.intentClass;
  const omittedClose = compareIntentCloseness(omitted, 'durable-business-process');
  assert.equal(omittedClose.close, false);
  assert.ok(omittedClose.misses.some(m => m.motif === 'intent-class-identity'));
  assert.ok(omittedClose.ideologicalGaps.some(g => g.motif === 'intent-class-identity'));
  const mismatched = { ...gold, intentClass: 'coding-agent-session' };
  const mismatch = compareIntentCloseness(mismatched, 'durable-business-process');
  assert.equal(mismatch.close, false);
  assert.ok(mismatch.ideologicalGaps.some(g => g.motif === 'intent-class-identity'));
  const ledger = ledgerFromGaps(mismatch.ideologicalGaps);
  assert.throws(() => assertConstraints(mismatched, ledger), { code: 'CONSTRAINT_VIOLATION' });
  assert.equal(assertConstraints(gold, ledger).ok, true);
});

test('intent gold harness bytes without the unique marker still fail closed', () => {
  const frozen = freezeIntentClass('durable-business-process');
  const provider = createScriptedProvider('naive');
  assert.throws(() => constructFromIntent({
    intentClass: frozen.id, provider, builderContext: { leak: frozen.heldOut.target.harness }
  }), { code: 'HOLDOUT_LEAKAGE' });
  const leaked = runIntentProgram({
    schemaVersion: '1.0', id: 'leak-intent-harness', intentClasses: ['durable-business-process', 'coding-agent-session'],
    provider: 'scripted-naive', builderContext: { leak: frozen.heldOut.target.harness }
  });
  assert.equal(leaked.ok, false);
  assert.equal(leaked.noCheat.rejected, true);
  assert.equal(leaked.noCheat.scanned, true);
});

test('serialized intent gold and held-out scenarios fail closed as HOLDOUT_LEAKAGE', () => {
  const frozen = freezeIntentClass('durable-business-process');
  const gold = frozen.heldOut.target.harness;
  const scenarios = frozen.heldOut.target.scenarios;
  const provider = createScriptedProvider('naive');
  assert.throws(() => detectLeakage({ family: frozen, builderContext: { source: JSON.stringify(gold) } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => detectLeakage({ family: frozen, builderContext: { leak: scenarios } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructFromIntent({
    intentClass: frozen.id, provider, builderContext: { source: JSON.stringify(gold) }
  }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructFromIntent({
    intentClass: frozen.id, provider, builderContext: { leak: scenarios }
  }), { code: 'HOLDOUT_LEAKAGE' });
  assert.equal(provider.calls.length, 0);
  const leakedSource = runIntentProgram({
    schemaVersion: '1.0', id: 'leak-intent-serialized', intentClasses: ['durable-business-process', 'coding-agent-session'],
    provider: 'scripted-naive', builderContext: { source: JSON.stringify(gold) }
  });
  assert.equal(leakedSource.ok, false);
  assert.equal(leakedSource.noCheat.rejected, true);
  const leakedScenarios = runIntentProgram({
    schemaVersion: '1.0', id: 'leak-intent-scenarios', intentClasses: ['durable-business-process', 'coding-agent-session'],
    provider: 'scripted-naive', builderContext: { leak: scenarios }
  });
  assert.equal(leakedScenarios.ok, false);
  assert.equal(leakedScenarios.noCheat.rejected, true);
});

function waitWorkflow(extra = {}) {
  return {
    schemaVersion: '1.0', id: extra.id ?? 'WaitHonesty', version: 1,
    title: 'Wait crash honesty', goal: 'Show wait crash restarts deadline', domain: 'general',
    envelope: { assumptions: ['Local wait'], risks: ['Deadline restart'], successCriteria: ['Wait persists or honestly restarts'] },
    budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: extra.maxDurationMs ?? 2592000000, maxCost: 0 },
    nodes: extra.nodes ?? [{ id: 'pause', kind: 'wait', description: 'Durable wait honesty probe', needs: [], delayMs: extra.delayMs ?? 5000 }],
    acceptance: extra.acceptance ?? [{ op: 'exists', value: { $ref: 'nodes.pause.waitedMs' } }]
  };
}

test('Foundry IR honestly rejects delayMs above 1 hour and compensate nodes', () => {
  const tooLong = validateWorkflow(waitWorkflow({ delayMs: 3600001 }));
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.errors.some(e => e.code === 'SCHEMA' && /delayMs|maximum|3600000/.test(`${e.message} ${e.path ?? ''}`)), JSON.stringify(tooLong.errors));
  const compensate = validateWorkflow(waitWorkflow({
    nodes: [{ id: 'undo', kind: 'compensate', description: 'Saga compensation is not an IR node', needs: [] }],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.undo.id' } }]
  }));
  assert.equal(compensate.valid, false);
  assert.ok(compensate.errors.some(e => e.code === 'SCHEMA'), JSON.stringify(compensate.errors));
  assert.equal(FOUNDRY_IR_LIMITS.delayMsMax, 3600000);
  assert.equal(FOUNDRY_IR_LIMITS.compensateKind, false);
  assert.equal(FOUNDRY_IR_LIMITS.continueAsNew, false);
});

test('createRun caps a 30-day workflow budget at the 1-hour policy default', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'foundry-ir-budget-'));
  const foundry = new Foundry(path.join(dir, 'workspace'));
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  foundry.save(waitWorkflow({ id: 'BudgetCap', maxDurationMs: 2592000000, delayMs: 1000 }));
  const run = foundry.createRun('BudgetCap');
  const stored = foundry.store.run(run.id);
  assert.equal(stored.deadline - stored.createdAt, 3600000);
  assert.ok(stored.deadline - stored.createdAt <= FOUNDRY_IR_LIMITS.budgetPolicyCapMs);
});

test('wait crash between charge and waiting restarts wakeAt rather than restoring a timer-service deadline', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'foundry-ir-wait-'));
  const foundry = new Foundry(path.join(dir, 'workspace'));
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  foundry.save(waitWorkflow({ id: 'WaitCrash', delayMs: 60000, maxDurationMs: 3600000 }));
  const created = foundry.createRun('WaitCrash');
  const first = await foundry.startRun(created.id);
  assert.equal(first.status, 'waiting');
  const wakeAt1 = foundry.store.run(created.id).nodes.pause.wakeAt;
  assert.equal(typeof wakeAt1, 'number');
  foundry.store.updateRun(created.id, r => {
    r.nodes.pause.status = 'running';
    delete r.nodes.pause.wakeAt;
    r.status = 'ready';
  }, { type: 'synthetic.wait-crash-between-charge-and-waiting' });
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await foundry.startRun(created.id);
  assert.equal(second.status, 'waiting');
  const wakeAt2 = foundry.store.run(created.id).nodes.pause.wakeAt;
  assert.equal(typeof wakeAt2, 'number');
  assert.ok(wakeAt2 > wakeAt1, `expected restarted wakeAt ${wakeAt2} > ${wakeAt1}`);
  assert.equal(FOUNDRY_IR_LIMITS.waitCrashRestartsDeadline, true);
});

// Compromise register C6 (2026-10-21): the IR limits are stated in several model-facing and grading places. They must
// change together (the C6 track, #75 with #78), never one alone, or the builder pack contradicts itself.
test('the durable builder pack, motif, harness, held-out scenario and IR_UNSUPPORTED state the same IR limits', () => {
  const L = FOUNDRY_IR_LIMITS;
  const spec = INTENT_SPECS['durable-business-process'];
  const { intent, publicInterface, ideologicalReasons } = spec.builderPack;
  const motif = INTENT_MOTIFS['intent:durable-business-process'].find(m => m.id === 'ir-limits-named-not-papered');
  const why = ideologicalReasons.find(r => r.motif === motif.id).why;
  assert.equal(why, motif.why);
  for (const text of [intent, publicInterface.ir, why]) assert.ok(text.includes(L.timerDispatch), `names timerDispatch ${L.timerDispatch}`);
  assert.equal(/restarts wakeAt/.test(why), L.waitCrashRestartsDeadline);
  assert.equal(/wait crash restarts the deadline/.test(intent), L.waitCrashRestartsDeadline);
  assert.ok(publicInterface.ir.includes(`waitCrashRestartsDeadline ${L.waitCrashRestartsDeadline}`));
  assert.equal(motif.inspect(INTENT_RESPECTING['durable-business-process']), true);
  const scenario = INTENT_SCENARIOS['durable-business-process'].find(x => x.id === 'ir-limits-named');
  for (const [k, v] of Object.entries(scenario.expected)) assert.equal(v, L[k], `scenario ir-limits-named ${k}`);
  for (const entry of IR_UNSUPPORTED) {
    const [k, v] = entry.split(':');
    if (k in L) assert.equal(v, String(L[k]), `IR_UNSUPPORTED ${entry}`);
  }
});
