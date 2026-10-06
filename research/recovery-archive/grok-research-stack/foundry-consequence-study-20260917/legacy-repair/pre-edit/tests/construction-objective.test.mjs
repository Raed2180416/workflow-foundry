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
  OBJECTIVE_FAMILY_ID, OBJECTIVE_MOTIFS, PUBLIC_HARNESS_CATALOG, FOUNDRY_IR_LIMITS,
  assertConstraints, builderVisibleObjectivePack, bundledObjectiveProgram,
  compareObjectiveCloseness, constructFromObjective, constructFromIntent,
  createScriptedProvider, detectLeakage, extractRequirements, freezeObjective,
  ledgerFromGaps, listFamilies, listIntentClasses, listObjectiveIds,
  primaryObjectiveReport, runObjectiveProgram, composeObjectiveCandidate
} from '../src/construction.mjs';
import { maxDelayMs, nodeKindsOf } from '../src/construction-objective.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin/foundry.mjs');

test('objective composition is not a fifth intent class or named-harness family', () => {
  const classes = listIntentClasses();
  assert.deepEqual(classes, ['coding-agent-session', 'cx-supervised-conversation', 'durable-business-process', 'graph-automation']);
  assert.equal(classes.includes('objective-composition'), false);
  assert.equal(listFamilies().includes(OBJECTIVE_FAMILY_ID), false);
  assert.equal(listObjectiveIds().length >= 2, true);
  assert.throws(() => freezeObjective('claims-processing-custom'), { code: 'UNKNOWN_OBJECTIVE' });
  assert.throws(() => constructFromIntent({ intentClass: OBJECTIVE_FAMILY_ID, provider: createScriptedProvider('naive') }), { code: 'UNKNOWN_INTENT' });
  for (const id of ['salesforce-agentforce', 'microsoft-power-automate', 'aws-step-functions']) {
    assert.ok(PUBLIC_HARNESS_CATALOG.some(c => c.id === id && c.encoded === false), id);
  }
});

test('empty unknown and ungrounded objectives fail closed', () => {
  assert.equal(extractRequirements('').code, 'OBJECTIVE_REQUIRED');
  assert.equal(extractRequirements('please do the thing').code, 'UNKNOWN_OBJECTIVE');
  assert.equal(extractRequirements('telepathy to approve invoices').code, 'UNGROUNDED_OBJECTIVE');
  assert.equal(extractRequirements('magic spell customer support refund').code, 'UNGROUNDED_OBJECTIVE');
  const provider = createScriptedProvider('respecting');
  assert.throws(() => constructFromObjective({ objective: '', provider }), { code: 'OBJECTIVE_REQUIRED' });
  assert.throws(() => constructFromObjective({ objective: 'please do the thing', provider }), { code: 'UNKNOWN_OBJECTIVE' });
  assert.throws(() => constructFromObjective({ objective: 'telepathy to approve invoices', provider }), { code: 'UNGROUNDED_OBJECTIVE' });
  assert.equal(provider.calls.length, 0);
});

test('objective split keeps builder pack disjoint from held-out inspect summaries', () => {
  for (const id of listObjectiveIds()) {
    const frozen = freezeObjective(id);
    const pack = builderVisibleObjectivePack(frozen);
    assert.equal(frozen.split.disjoint, true);
    assert.equal(JSON.stringify(pack).includes(frozen.heldOut.uniqueMarker), false);
    for (const p of frozen.heldOut.paths) assert.equal(JSON.stringify(pack).includes(p), false);
    assert.equal(pack.familyId, OBJECTIVE_FAMILY_ID);
    assert.equal(pack.objectiveId, id);
    assert.equal(pack.authoring ?? pack.publicInterface.authoring.includes('autoApply false'), true);
  }
});

test('objective construction rejects held-out target bytes paths markers and serialized summaries', () => {
  const frozen = freezeObjective('ObjInvoiceWait');
  const provider = createScriptedProvider('naive');
  assert.throws(() => constructFromObjective({ objectiveId: frozen.id, builderContext: { leak: frozen.heldOut.target }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructFromObjective({ objectiveId: frozen.id, builderContext: { text: frozen.heldOut.uniqueMarker }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructFromObjective({ objectiveId: frozen.id, builderContext: { files: [frozen.heldOut.paths[0]] }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructFromObjective({ objectiveId: frozen.id, provider, repairFeedback: { split: 'heldout' } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => detectLeakage({ family: frozen, builderContext: { source: JSON.stringify(frozen.heldOut.target) } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => detectLeakage({ family: frozen, builderContext: { leak: frozen.heldOut.target.expected } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => detectLeakage({ family: frozen, builderContext: { leak: frozen.heldOut.target.scenarios } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.equal(provider.calls.length, 0);
  const leaked = runObjectiveProgram({
    schemaVersion: '1.0', id: 'leak-objective', objectives: ['ObjInvoiceWait', 'ObjHttpBranch'],
    provider: 'scripted-naive', builderContext: { source: JSON.stringify(frozen.heldOut.target) }
  });
  assert.equal(leaked.ok, false);
  assert.equal(leaked.noCheat.rejected, true);
  assert.equal(leaked.noCheat.scanned, true);
});

test('schema-valid self-attested objective candidate missing motifs fails closeness', () => {
  const built = constructFromObjective({ objectiveId: 'ObjInvoiceWait', provider: createScriptedProvider('naive') });
  assert.equal(built.candidate.selfAttestedSuccess, true);
  assert.ok(Array.isArray(built.candidate.claimedMotifs));
  const closeness = compareObjectiveCloseness(built.candidate, 'ObjInvoiceWait');
  assert.equal(closeness.comparable, true);
  assert.equal(closeness.close, false);
  for (const motif of ['acceptance-not-self-attested', 'host-budget-capped', 'ir-limits-named-in-envelope', 'human-accept-not-auto-apply', 'wait-when-required', 'human-gate-when-required', 'verification-assert-or-validate']) {
    assert.ok(closeness.misses.some(m => m.motif === motif), motif);
  }
  assert.ok(closeness.misses.some(m => m.kind === 'behavioral' && m.scenarioId === 'auto-apply'));
  assert.ok(closeness.misses.some(m => m.motif === 'self-attestation'));
  assert.equal(built.candidate.authoring.autoApply, true);
  assert.ok(maxDelayMs(built.candidate.workflow) <= FOUNDRY_IR_LIMITS.delayMsMax);
  assert.equal(nodeKindsOf(built.candidate.workflow).includes('wait'), false);
  assert.equal(nodeKindsOf(built.candidate.workflow).includes('compensate'), false);
});

test('claimedMotifs cannot paper a naive objective graph', () => {
  const naive = constructFromObjective({ objectiveId: 'ObjInvoiceWait', provider: createScriptedProvider('naive') }).candidate;
  const claimed = { ...naive, claimedMotifs: OBJECTIVE_MOTIFS[OBJECTIVE_FAMILY_ID].map(m => m.id) };
  const closeness = compareObjectiveCloseness(claimed, 'ObjInvoiceWait');
  assert.equal(closeness.close, false);
  assert.ok(closeness.misses.some(m => m.motif === 'wait-when-required'));
});

test('compiler-as-oracle is close; naive is not; constraint re-injection is independent', () => {
  const naive = constructFromObjective({ objectiveId: 'ObjInvoiceWait', provider: createScriptedProvider('naive') }).candidate;
  const closeness = compareObjectiveCloseness(naive, 'ObjInvoiceWait');
  const ledger = ledgerFromGaps(closeness.ideologicalGaps);
  assert.throws(() => assertConstraints(naive, ledger), { code: 'CONSTRAINT_VIOLATION' });
  assert.throws(() => constructFromObjective({ objectiveId: 'ObjInvoiceWait', provider: createScriptedProvider('naive'), constraints: ledger }), { code: 'CONSTRAINT_VIOLATION' });
  const respected = constructFromObjective({ objectiveId: 'ObjInvoiceWait', provider: createScriptedProvider('respecting'), constraints: ledger });
  assert.equal(respected.provider.role, 'oracle');
  assert.equal(assertConstraints(respected.candidate, ledger).ok, true);
  assert.equal(compareObjectiveCloseness(respected.candidate, 'ObjInvoiceWait').close, true);
});

test('every objective gold compose is close and naive is not', () => {
  for (const id of listObjectiveIds()) {
    const gold = constructFromObjective({ objectiveId: id, provider: createScriptedProvider('respecting') }).candidate;
    const goldClose = compareObjectiveCloseness(gold, id);
    assert.equal(goldClose.close, true, `${id} gold misses ${JSON.stringify(goldClose.misses)}`);
    const naive = compareObjectiveCloseness(constructFromObjective({ objectiveId: id, provider: createScriptedProvider('naive') }).candidate, id);
    assert.equal(naive.close, false, id);
    assert.ok(naive.ideologicalGaps.length > 0, id);
  }
});

test('paraphrases that hit the same cues compose without a new intent class', () => {
  const paraphrase = 'Have a reviewer sign off the invoice, pay it, wait thirty days, then compensate if cancelled';
  const built = constructFromObjective({ objective: paraphrase, provider: createScriptedProvider('respecting') });
  assert.equal(built.objectiveId, 'freeform');
  assert.equal(built.candidate.familyId, OBJECTIVE_FAMILY_ID);
  assert.equal(built.candidate.authoring.autoApply, false);
  assert.equal(built.candidate.authoring.humanAcceptDiscard, true);
  assert.ok(nodeKindsOf(built.candidate.workflow).includes('human'));
  assert.ok(nodeKindsOf(built.candidate.workflow).includes('wait'));
  assert.equal(nodeKindsOf(built.candidate.workflow).includes('compensate'), false);
  assert.ok(maxDelayMs(built.candidate.workflow) <= FOUNDRY_IR_LIMITS.delayMsMax);
  assert.ok((built.candidate.workflow.envelope.unsupported ?? []).some(s => s.includes('delayMsMax')));
  assert.ok((built.candidate.workflow.envelope.unsupported ?? []).some(s => s.includes('compensateKind')));
  const closeness = compareObjectiveCloseness(built.candidate, 'ObjInvoiceWait');
  assert.equal(closeness.close, true, JSON.stringify(closeness.misses));
  assert.deepEqual(listIntentClasses().length, 4);
});

test('composed workflows save on the Foundry product path', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'foundry-objective-save-'));
  const foundry = new Foundry(path.join(dir, 'workspace'));
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  const built = constructFromObjective({
    objective: 'Research a claim and refuse to send ungrounded citations',
    provider: createScriptedProvider('respecting')
  });
  const validation = validateWorkflow(built.candidate.workflow);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  const saved = foundry.save(built.candidate.workflow);
  assert.equal(typeof saved.hash, 'string');
  assert.equal(saved.hash.length, 64);
});

test('objective program constructs without cheating and reports misses plus a constraint ledger', () => {
  const report = runObjectiveProgram(bundledObjectiveProgram());
  assert.equal(report.ok, true);
  assert.ok(report.objectives.length >= 2);
  assert.equal(report.noCheat.envelope, 'fail-closed');
  assert.equal(report.closeness.comparable, true);
  assert.equal(report.closeness.close, false);
  assert.ok(report.closeness.misses.length > 0);
  assert.ok(report.constraintLedger.length > 0);
  assert.equal(report.seams.typedDecisionEngine.required, false);
  assert.equal(report.irLimits.delayMsMax, 3600000);
  assert.equal(report.irLimits.compensateKind, false);
  assert.equal(report.provider.role, 'construction');
  const respected = runObjectiveProgram({ ...bundledObjectiveProgram(), provider: 'scripted-respecting' });
  assert.equal(respected.closeness.close, true, JSON.stringify(respected.closeness.misses.slice(0, 8)));
  assert.equal(respected.provider.role, 'oracle');
  const again = runObjectiveProgram(bundledObjectiveProgram());
  assert.deepEqual(primaryObjectiveReport(again), primaryObjectiveReport(report));
});

test('CLI construct-objective emits objectives no-cheat misses and constraint ledger twice', () => {
  const first = spawnSync(process.execPath, [cli, 'construct-objective'], { encoding: 'utf8', timeout: 30000, cwd: root });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const second = spawnSync(process.execPath, [cli, 'construct-objective'], { encoding: 'utf8', timeout: 30000, cwd: root });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const a = JSON.parse(first.stdout);
  const b = JSON.parse(second.stdout);
  assert.ok(a.objectives.length >= 2);
  assert.equal(a.noCheat.envelope, 'fail-closed');
  assert.ok(a.closeness.misses.length > 0);
  assert.ok(a.constraintLedger.length > 0);
  assert.equal(a.ok, true);
  assert.deepEqual(primaryObjectiveReport(a), primaryObjectiveReport(b));
});

test('CLI construct-objective --text composes a savable workflow', async t => {
  const result = spawnSync(process.execPath, [cli, 'construct-objective', '--text', 'HTTP fetch then branch on error with a separate error path'], { encoding: 'utf8', timeout: 30000, cwd: root });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const built = JSON.parse(result.stdout);
  assert.equal(built.candidate.familyId, OBJECTIVE_FAMILY_ID);
  assert.equal(built.candidate.authoring.autoApply, false);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'foundry-objective-cli-'));
  const foundry = new Foundry(path.join(dir, 'workspace'));
  t.after(async () => { await foundry.close(); rmSync(dir, { recursive: true, force: true }); });
  foundry.save(built.candidate.workflow);
});

test('weak oracles and months-scale waits cannot pass', () => {
  const gold = constructFromObjective({ objectiveId: 'ObjInvoiceWait', provider: createScriptedProvider('respecting') }).candidate;
  assert.throws(() => compareObjectiveCloseness(gold, 'ObjInvoiceWait', { oracle: 'self-attested' }), { code: 'WEAK_EVALUATOR' });
  assert.ok(maxDelayMs(gold.workflow) <= 3600000);
  assert.equal(nodeKindsOf(gold.workflow).includes('compensate'), false);
  assert.ok(gold.workflow.envelope.unsupported.includes('delayMsMax:3600000'));
  const lying = composeObjectiveCandidate('Approve invoice then pay, wait 30 days, compensate on cancel', { mode: 'compose', objectiveId: 'ObjInvoiceWait' });
  lying.workflow.nodes.push({ id: 'undo', kind: 'compensate', needs: ['pause'], description: 'Invented saga node' });
  const closeness = compareObjectiveCloseness(lying, 'ObjInvoiceWait');
  assert.equal(closeness.close, false);
});

test('FoundryError remains the fail-closed type on objective leakage', () => {
  try {
    constructFromObjective({
      objectiveId: 'ObjHttpBranch',
      provider: createScriptedProvider('naive'),
      builderContext: { text: freezeObjective('ObjHttpBranch').heldOut.uniqueMarker }
    });
    assert.fail('expected throw');
  } catch (error) {
    assert.equal(error instanceof FoundryError, true);
    assert.equal(error.code, 'HOLDOUT_LEAKAGE');
  }
});
