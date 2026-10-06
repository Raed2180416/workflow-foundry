import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPair } from '../evals/evidence.mjs';
import { digest, FoundryError } from '../src/data.mjs';
import {
  assertConstraints, builderVisiblePack, bundledConstructionProgram, compareCloseness,
  constructHarness, createScriptedProvider, defaultPairControls, detectLeakage, freezeFamily,
  inspectConstructionPair, interpretHarness, ledgerFromGaps, listFamilies, MOTIFS,
  PUBLIC_HARNESS_CATALOG, primaryReport, runConstructionProgram
} from '../src/construction.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin/foundry.mjs');
const heldoutSuite = () => ({
  schemaVersion: '1.0', id: 'heldout-repair', split: 'heldout', task: 'Must not drive construction repair.',
  cases: [{ id: 'case-one', input: {}, expect: { statuses: ['succeeded'], checks: [{ op: 'eq', left: { $ref: 'nodes.result.answer' }, right: 42 }] } }]
});

test('frozen split keeps builder pack disjoint from held-out target bytes for two families', () => {
  const ids = listFamilies();
  assert.ok(ids.length >= 8, `expected ≥8 families, got ${ids.join(',')}`);
  for (const id of ['mini-swe-agent', 'n8n-agent', 'cognition-devin-cloud', 'cursor-shadow-workspace', 'langgraph-durable', 'openhands-stuck', 'sierra-agent-os', 'openai-cua', 'harvey-spectre', 'cursor-cloud', 'factory-missions', 'factory-droid-safety', 'sierra-agency', 'openai-codex', 'github-copilot-vscode', 'github-copilot-coding-agent', 'hebbia-matrix', 'amazon-nova-act', 'google-jules', 'futurehouse-paperqa2', 'temporal-durable', 'restate-services', 'inngest-steps', 'intercom-fin']) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(ids.length >= 24, `expected ≥24 families, got ${ids.length}`);
  for (const id of ids) {
    const family = freezeFamily(id);
    const pack = builderVisiblePack(family);
    assert.equal(family.split.disjoint, true);
    assert.equal(family.split.builderPackSHA256, digest(family.builderPack));
    assert.equal(family.split.heldOutSHA256, digest(family.heldOut.target));
    assert.equal(family.split.seal, family.heldOut.seal);
    assert.equal(JSON.stringify(pack).includes(family.heldOut.uniqueMarker), false);
    assert.equal(JSON.stringify(pack).includes(family.heldOut.seal), false);
    for (const p of family.heldOut.paths) assert.equal(JSON.stringify(pack).includes(p), false);
    assert.notEqual(family.split.builderPackSHA256, family.split.heldOutSHA256);
  }
});

test('builder context with held-out target bytes or paths is rejected as HOLDOUT_LEAKAGE', () => {
  const family = freezeFamily('mini-swe-agent');
  const provider = createScriptedProvider('naive');
  assert.throws(() => constructHarness({ familyId: family.id, builderContext: { leak: family.heldOut.target }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructHarness({ familyId: family.id, builderContext: { files: [family.heldOut.paths[0]] }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructHarness({ familyId: family.id, builderContext: { text: family.heldOut.uniqueMarker }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.equal(provider.calls.length, 0);
});

test('held-out suite used as generator or repair feedback fails closed', () => {
  const provider = createScriptedProvider('naive');
  assert.throws(() => constructHarness({ familyId: 'n8n-agent', provider, repairFeedback: { split: 'heldout' } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructHarness({ familyId: 'n8n-agent', provider, repairFeedback: { suite: heldoutSuite() } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.equal(provider.calls.length, 0);
});

test('scripted provider receives only the builder-visible pack and can still emit a candidate', () => {
  const family = freezeFamily('mini-swe-agent');
  const provider = createScriptedProvider('naive');
  const built = constructHarness({ familyId: family.id, provider });
  assert.equal(built.candidate.schemaVersion, '1.0');
  assert.equal(provider.calls.length, 1);
  const seen = JSON.stringify(provider.calls[0]);
  assert.equal(seen.includes(family.heldOut.uniqueMarker), false);
  assert.equal(provider.calls[0].pack.familyId, 'mini-swe-agent');
  assert.equal(provider.calls[0].pack.intent.includes('bash-only'), true);
});

test('skill contamination of held-out bytes in builder skills fails closed', () => {
  const family = freezeFamily('n8n-agent');
  const provider = createScriptedProvider('naive');
  assert.throws(() => constructHarness({
    familyId: family.id, provider,
    builderContext: { skills: [{ name: 'leaked', text: `notes ${family.heldOut.uniqueMarker}` }] }
  }), { code: 'HOLDOUT_LEAKAGE' });
});

test('inspectConstructionPair and inspectPair agree on unequal controls, skill contamination and unsealed heldout', () => {
  const common = Object.fromEntries(['taskSHA256', 'schemaSHA256', 'model', 'appVersion', 'executorSHA256', 'toolsSHA256', 'budgetSHA256', 'configSHA256'].map(key => [key, `unit-${key}`]));
  const baseline = { ...common, arm: 'baseline', split: 'diagnostic', sessionID: 'unit-a' };
  const treatment = { ...common, arm: 'foundry', split: 'diagnostic', sessionID: 'unit-b', skillSHA256: 'unit-skills' };
  assert.equal(inspectPair(baseline, treatment).comparable, true);
  assert.equal(inspectConstructionPair(baseline, treatment).comparable, true);
  assert.equal(inspectPair(baseline, { ...treatment, executorSHA256: 'different' }).comparable, false);
  assert.equal(inspectConstructionPair(baseline, { ...treatment, executorSHA256: 'different' }).comparable, false);
  assert.equal(inspectPair({ ...baseline, skillSHA256: 'leaked' }, treatment).comparable, false);
  assert.equal(inspectConstructionPair({ ...baseline, skillSHA256: 'leaked' }, treatment).comparable, false);
  assert.equal(inspectPair({ ...baseline, split: 'heldout' }, { ...treatment, split: 'heldout' }).comparable, false);
  assert.equal(inspectConstructionPair({ ...baseline, split: 'heldout' }, { ...treatment, split: 'heldout' }).comparable, false);
});

test('construction program with unequal pair controls is not comparable', () => {
  const program = bundledConstructionProgram();
  const controls = defaultPairControls(program);
  const report = runConstructionProgram({
    ...program,
    pair: {
      baseline: { ...controls, arm: 'baseline', split: 'heldout', sessionID: 'a', sealVerified: true, executorSHA256: 'left' },
      treatment: { ...controls, arm: 'foundry', split: 'heldout', sessionID: 'b', sealVerified: true, skillSHA256: 'skills', executorSHA256: 'right' }
    }
  });
  assert.equal(report.ok, false);
  assert.equal(report.closeness.comparable, false);
  assert.equal(report.noCheat.envelope, 'fail-closed');
  assert.ok(report.closeness.errors.some(e => e.includes('unequal comparison control')));
});

test('unsealed held-out claims are not comparable', () => {
  const family = freezeFamily('mini-swe-agent');
  family.heldOut.seal = '0'.repeat(64);
  const report = compareCloseness(family.heldOut.target.harness, family);
  assert.equal(report.comparable, false);
  assert.equal(report.close, false);
});

test('schema-valid self-attested candidate missing defining motifs fails closeness and records gaps', () => {
  const family = freezeFamily('mini-swe-agent');
  const provider = createScriptedProvider('naive');
  const built = constructHarness({ familyId: family.id, provider });
  assert.equal(built.candidate.selfAttestedSuccess, true);
  assert.ok(Array.isArray(built.candidate.claimedMotifs) && built.candidate.claimedMotifs.includes('bash-only-action'));
  const closeness = compareCloseness(built.candidate, family);
  assert.equal(closeness.comparable, true);
  assert.equal(closeness.close, false);
  const structural = closeness.misses.filter(m => m.kind === 'structural').map(m => m.motif);
  for (const motif of ['bash-only-action', 'stateless-process-group', 'completion-token-stdout', 'host-limits', 'linear-history-as-trajectory', 'interrupt-exceptions']) {
    assert.ok(structural.includes(motif), motif);
  }
  assert.ok(closeness.misses.some(m => m.kind === 'behavioral' && m.scenarioId === 'complete-token-rc0'));
  assert.ok(closeness.misses.some(m => m.kind === 'behavioral' && m.scenarioId === 'stateless-cd'));
  assert.ok(closeness.ideologicalGaps.some(g => g.motif === 'stateless-process-group'));
  assert.ok(closeness.misses.some(m => m.motif === 'self-attestation'));
});

test('held-out gold harness is close; that does not make a naive candidate close', () => {
  const family = freezeFamily('n8n-agent');
  const gold = compareCloseness(family.heldOut.target.harness, family);
  assert.equal(gold.comparable, true);
  assert.equal(gold.close, true);
  const naive = compareCloseness(constructHarness({ familyId: family.id, provider: createScriptedProvider('naive') }).candidate, family);
  assert.equal(naive.close, false);
  assert.ok(naive.misses.some(m => m.motif === 'ai-socket-edges'));
  assert.ok(naive.misses.some(m => m.kind === 'behavioral' && m.scenarioId === 'fetch-fails-continue'));
});

test('weak closeness oracles are rejected', () => {
  const family = freezeFamily('mini-swe-agent');
  const candidate = constructHarness({ familyId: family.id, provider: createScriptedProvider('naive') }).candidate;
  assert.throws(() => compareCloseness(candidate, family, { oracle: 'self-attested' }), { code: 'WEAK_EVALUATOR' });
  assert.throws(() => compareCloseness(candidate, family, { oracle: 'status-only' }), { code: 'WEAK_EVALUATOR' });
});

test('recorded ideological gap becomes a constraint the next construction must respect independently', () => {
  const family = freezeFamily('mini-swe-agent');
  const naive = constructHarness({ familyId: family.id, provider: createScriptedProvider('naive') }).candidate;
  const closeness = compareCloseness(naive, family);
  const ledger = ledgerFromGaps(closeness.ideologicalGaps);
  assert.ok(ledger.some(c => c.motif === 'stateless-process-group'));
  assert.throws(() => assertConstraints(naive, ledger), { code: 'CONSTRAINT_VIOLATION' });
  assert.throws(() => constructHarness({ familyId: family.id, provider: createScriptedProvider('naive'), constraints: ledger }), { code: 'CONSTRAINT_VIOLATION' });
  const respected = constructHarness({ familyId: family.id, provider: createScriptedProvider('respecting'), constraints: ledger });
  assert.equal(assertConstraints(respected.candidate, ledger).ok, true);
  assert.equal(compareCloseness(respected.candidate, family).close, true);
});

test('multi-family program constructs without cheating and reports misses plus a constraint ledger', () => {
  const report = runConstructionProgram(bundledConstructionProgram());
  assert.equal(report.ok, true);
  assert.ok(report.families.length >= 2);
  assert.equal(report.noCheat.envelope, 'fail-closed');
  assert.equal(report.noCheat.rejected, false);
  assert.equal(report.closeness.comparable, true);
  assert.equal(report.closeness.close, false);
  assert.ok(report.closeness.misses.length > 0);
  assert.ok(report.constraintLedger.length > 0);
  assert.ok(report.families.includes('mini-swe-agent'));
  assert.ok(report.families.includes('n8n-agent'));
  assert.ok(report.families.includes('harvey-spectre'));
  assert.ok(report.families.includes('factory-missions'));
  assert.ok(report.families.includes('sierra-agency'));
  assert.ok(report.families.includes('openai-codex'));
  assert.ok(report.families.includes('hebbia-matrix'));
  assert.ok(report.families.includes('futurehouse-paperqa2'));
  assert.ok(report.families.includes('temporal-durable'));
  assert.ok(report.families.includes('intercom-fin'));
  assert.ok(Array.isArray(report.catalog));
  assert.ok(report.catalog.some(c => c.id === 'harvey-spectre' && c.encoded === true));
  assert.ok(report.catalog.some(c => c.id === 'openai-codex' && c.encoded === true));
  assert.ok(report.catalog.some(c => c.id === 'intercom-fin' && c.encoded === true));
  assert.ok(report.catalog.some(c => c.id === 'decagon' && c.encoded === false));
  assert.equal(report.catalog.some(c => c.id === 'intercom-fin' && c.encoded === false), false);
  assert.equal(report.seams.typedDecisionEngine.required, false);
  assert.equal(report.seams.memoryStore.available, false);
  const again = runConstructionProgram(bundledConstructionProgram());
  assert.deepEqual(primaryReport(again), primaryReport(report));
});

test('detectLeakage is the shipped gate, not a test double', () => {
  const family = freezeFamily('n8n-agent');
  assert.throws(() => detectLeakage({ family, builderContext: family.heldOut.target }), { code: 'HOLDOUT_LEAKAGE' });
  assert.doesNotThrow(() => detectLeakage({ family, builderContext: builderVisiblePack(family) }));
});

test('every family gold is close and naive is not; claimedMotifs are ignored', () => {
  for (const id of listFamilies()) {
    const family = freezeFamily(id);
    const gold = compareCloseness(family.heldOut.target.harness, family);
    assert.equal(gold.comparable, true, id);
    assert.equal(gold.close, true, `${id} gold misses ${JSON.stringify(gold.misses)}`);
    const naive = compareCloseness(constructHarness({ familyId: id, provider: createScriptedProvider('naive') }).candidate, family);
    assert.equal(naive.close, false, id);
    assert.ok(naive.ideologicalGaps.length > 0, id);
    assert.ok(naive.misses.some(m => m.kind === 'structural'), id);
    const motifIds = MOTIFS[id].map(m => m.id);
    for (const motif of motifIds) {
      assert.ok(naive.misses.some(m => m.motif === motif), `${id} missing structural miss for ${motif}`);
    }
  }
});

test('closed-source families leak-fail and record distinctive ideological gaps', () => {
  const harvey = freezeFamily('harvey-spectre');
  const provider = createScriptedProvider('naive');
  assert.throws(() => constructHarness({ familyId: harvey.id, builderContext: { text: harvey.heldOut.uniqueMarker }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  const naiveHarvey = compareCloseness(constructHarness({ familyId: harvey.id, provider: createScriptedProvider('naive') }).candidate, harvey);
  assert.ok(naiveHarvey.ideologicalGaps.some(g => g.motif === 'durable-run-not-worker'));
  const missions = freezeFamily('factory-missions');
  const naiveMissions = compareCloseness(constructHarness({ familyId: missions.id, provider: createScriptedProvider('naive') }).candidate, missions);
  assert.ok(naiveMissions.ideologicalGaps.some(g => g.motif === 'validator-not-implementer'));
  const ledger = ledgerFromGaps(naiveMissions.ideologicalGaps);
  assert.throws(() => constructHarness({ familyId: missions.id, provider: createScriptedProvider('naive'), constraints: ledger }), { code: 'CONSTRAINT_VIOLATION' });
  const respected = constructHarness({ familyId: missions.id, provider: createScriptedProvider('respecting'), constraints: ledger });
  assert.equal(compareCloseness(respected.candidate, missions).close, true);
  const agency = freezeFamily('sierra-agency');
  const naiveAgency = compareCloseness(constructHarness({ familyId: agency.id, provider: createScriptedProvider('naive') }).candidate, agency);
  assert.ok(naiveAgency.ideologicalGaps.some(g => g.motif === 'secrets-outside-sandbox'));
});

test('industry families leak-fail and record domain-specific ideological gaps', () => {
  const provider = createScriptedProvider('naive');
  const codex = freezeFamily('openai-codex');
  assert.throws(() => constructHarness({ familyId: codex.id, builderContext: { text: codex.heldOut.uniqueMarker }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  const naiveCodex = compareCloseness(constructHarness({ familyId: codex.id, provider: createScriptedProvider('naive') }).candidate, codex);
  assert.ok(naiveCodex.ideologicalGaps.some(g => g.motif === 'web-container-not-tab'));
  assert.ok(naiveCodex.ideologicalGaps.some(g => g.motif === 'extra-input-steers-not-abort'));
  assert.ok(naiveCodex.ideologicalGaps.some(g => g.motif === 'resume-rejoin-vs-fork-copy'));
  assert.equal(codex.heldOut.target.harness.loop.userInputAbortsTask, false);
  assert.equal(interpretHarness(codex.heldOut.target.harness, { op: 'second-task' }).started, false);
  assert.deepEqual(interpretHarness(codex.heldOut.target.harness, { op: 'extra-user-input' }), { steered: true, aborted: false, abort: 'turn-interrupt' });
  assert.deepEqual(interpretHarness(codex.heldOut.target.harness, { op: 'fork-both-boundaries' }), { allowed: false, error: 'invalid_request' });
  const hebbia = freezeFamily('hebbia-matrix');
  const naiveHebbia = compareCloseness(constructHarness({ familyId: hebbia.id, provider: createScriptedProvider('naive') }).candidate, hebbia);
  assert.ok(naiveHebbia.ideologicalGaps.some(g => g.motif === 'orchestrator-never-tools'));
  const ledger = ledgerFromGaps(naiveHebbia.ideologicalGaps);
  assert.throws(() => constructHarness({ familyId: hebbia.id, provider: createScriptedProvider('naive'), constraints: ledger }), { code: 'CONSTRAINT_VIOLATION' });
  const respected = constructHarness({ familyId: hebbia.id, provider: createScriptedProvider('respecting'), constraints: ledger });
  assert.equal(compareCloseness(respected.candidate, hebbia).close, true);
  const nova = freezeFamily('amazon-nova-act');
  assert.equal(interpretHarness(nova.heldOut.target.harness, { op: 'enter-password' }).actor, 'playwright-not-model');
  const paperqa = freezeFamily('futurehouse-paperqa2');
  assert.deepEqual(interpretHarness(paperqa.heldOut.target.harness, { op: 'high-rcs-paper', score: 7 }), { traverse: false, degrees: 0, direction: 'none' });
  const cloud = freezeFamily('github-copilot-coding-agent');
  assert.equal(interpretHarness(cloud.heldOut.target.harness, { op: 'mcp-network' }).firewallApplies, false);
  assert.equal(interpretHarness(cloud.heldOut.target.harness, { op: 'bash-blocked-host' }).firewallApplies, true);
  const jules = freezeFamily('google-jules');
  assert.equal(interpretHarness(jules.heldOut.target.harness, { probe: 'environment' }).microvmDedicatedKernel, false);
});

test('durable families leak-fail and record distinctive ideological gaps', () => {
  const provider = createScriptedProvider('naive');
  const temporal = freezeFamily('temporal-durable');
  assert.throws(() => constructHarness({ familyId: temporal.id, builderContext: { text: temporal.heldOut.uniqueMarker }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  const naiveTemporal = compareCloseness(constructHarness({ familyId: temporal.id, provider: createScriptedProvider('naive') }).candidate, temporal);
  assert.ok(naiveTemporal.ideologicalGaps.some(g => g.motif === 'workflow-deterministic-replay'));
  assert.ok(naiveTemporal.ideologicalGaps.some(g => g.motif === 'durable-timer-not-sleep'));
  const ledger = ledgerFromGaps(naiveTemporal.ideologicalGaps);
  assert.throws(() => constructHarness({ familyId: temporal.id, provider: createScriptedProvider('naive'), constraints: ledger }), { code: 'CONSTRAINT_VIOLATION' });
  const respected = constructHarness({ familyId: temporal.id, provider: createScriptedProvider('respecting'), constraints: ledger });
  assert.equal(compareCloseness(respected.candidate, temporal).close, true);
  const restate = freezeFamily('restate-services');
  const naiveRestate = compareCloseness(constructHarness({ familyId: restate.id, provider: createScriptedProvider('naive') }).candidate, restate);
  assert.ok(naiveRestate.ideologicalGaps.some(g => g.motif === 'three-service-types'));
  assert.equal(interpretHarness(restate.heldOut.target.harness, { probe: 'service-types' }).foldsEverythingIntoWorkflow, false);
  const inngest = freezeFamily('inngest-steps');
  assert.equal(interpretHarness(inngest.heldOut.target.harness, { probe: 'workers' }).manageOwnWorkers, false);
  const fin = freezeFamily('intercom-fin');
  const naiveFin = compareCloseness(constructHarness({ familyId: fin.id, provider: createScriptedProvider('naive') }).candidate, fin);
  assert.ok(naiveFin.ideologicalGaps.some(g => g.motif === 'refine-then-route-before-llm'));
  assert.equal(interpretHarness(fin.heldOut.target.harness, { op: 'high-risk-medical' }).owner, 'human');
});

test('public catalog encoded ids are frozen families; not-encoded stay honest negatives', () => {
  const ids = new Set(listFamilies());
  const encoded = PUBLIC_HARNESS_CATALOG.filter(c => c.encoded);
  const notEncoded = PUBLIC_HARNESS_CATALOG.filter(c => !c.encoded);
  assert.ok(encoded.length >= 8);
  assert.ok(notEncoded.length >= 8);
  for (const entry of encoded) assert.ok(ids.has(entry.id), entry.id);
  for (const entry of notEncoded) {
    assert.equal(ids.has(entry.id), false, entry.id);
    assert.equal(typeof entry.note, 'string');
  }
});

test('OpenHands gold treats three action-obs pairs as not stuck and context-window as unimplemented', () => {
  const family = freezeFamily('openhands-stuck');
  const gold = family.heldOut.target.harness;
  const three = interpretHarness(gold, { events: [
    { kind: 'user-message', key: 'start' },
    { kind: 'action', key: 'ls' }, { kind: 'observation', key: 'listing' },
    { kind: 'action', key: 'ls' }, { kind: 'observation', key: 'listing' },
    { kind: 'action', key: 'ls' }, { kind: 'observation', key: 'listing' }
  ] });
  assert.deepEqual(three, { stuck: false, source: 'host-pattern-match', pattern: null, nudge: null });
  const ctx = interpretHarness(gold, { probe: 'context-window-error-loop' });
  assert.deepEqual(ctx, { stuck: false, implemented: false, issue: '282' });
  const naive = constructHarness({ familyId: family.id, provider: createScriptedProvider('naive') }).candidate;
  const naiveCtx = interpretHarness(naive, { probe: 'context-window-error-loop' });
  assert.equal(naiveCtx.implemented, true);
  assert.notEqual(naiveCtx.implemented, ctx.implemented);
});

test('held-out gold harness bytes without the unique marker still fail closed', () => {
  const family = freezeFamily('mini-swe-agent');
  const provider = createScriptedProvider('naive');
  assert.throws(() => constructHarness({ familyId: family.id, builderContext: { leak: family.heldOut.target.harness }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructHarness({ familyId: family.id, builderContext: { copiedGold: family.heldOut.target.harness }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => detectLeakage({ family, builderContext: family.heldOut.target.harness }), { code: 'HOLDOUT_LEAKAGE' });
  assert.equal(provider.calls.length, 0);
  const leaked = runConstructionProgram({
    schemaVersion: '1.0', id: 'leak-harness-bytes', families: ['mini-swe-agent', 'n8n-agent'],
    provider: 'scripted-naive', builderContext: { leak: family.heldOut.target.harness }
  });
  assert.equal(leaked.ok, false);
  assert.equal(leaked.noCheat.rejected, true);
  assert.equal(leaked.noCheat.scanned, true);
  assert.ok(leaked.noCheat.leakage.length > 0);
});

test('serialized gold source and held-out scenarios fail closed as HOLDOUT_LEAKAGE', () => {
  const family = freezeFamily('mini-swe-agent');
  const gold = family.heldOut.target.harness;
  const scenarios = family.heldOut.target.scenarios;
  const provider = createScriptedProvider('naive');
  assert.ok(Array.isArray(scenarios) && scenarios.length > 0);
  assert.throws(() => detectLeakage({ family, builderContext: { source: JSON.stringify(gold) } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => detectLeakage({ family, builderContext: { source: JSON.stringify(gold, null, 2) } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => detectLeakage({ family, builderContext: { leak: scenarios } }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructHarness({ familyId: family.id, builderContext: { source: JSON.stringify(gold) }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.throws(() => constructHarness({ familyId: family.id, builderContext: { leak: scenarios }, provider }), { code: 'HOLDOUT_LEAKAGE' });
  assert.equal(provider.calls.length, 0);
  const leakedSource = runConstructionProgram({
    schemaVersion: '1.0', id: 'leak-serialized-gold', families: ['mini-swe-agent', 'n8n-agent'],
    provider: 'scripted-naive', builderContext: { source: JSON.stringify(gold) }
  });
  assert.equal(leakedSource.ok, false);
  assert.equal(leakedSource.noCheat.rejected, true);
  assert.equal(leakedSource.noCheat.scanned, true);
  assert.ok(leakedSource.noCheat.leakage.length > 0);
  const leakedScenarios = runConstructionProgram({
    schemaVersion: '1.0', id: 'leak-heldout-scenarios', families: ['mini-swe-agent', 'n8n-agent'],
    provider: 'scripted-naive', builderContext: { leak: scenarios }
  });
  assert.equal(leakedScenarios.ok, false);
  assert.equal(leakedScenarios.noCheat.rejected, true);
  assert.ok(leakedScenarios.noCheat.leakage.length > 0);
});

test('cross-family closeness still records target-family ideological gaps', () => {
  const mini = freezeFamily('mini-swe-agent').heldOut.target.harness;
  const n8n = freezeFamily('n8n-agent');
  const closeness = compareCloseness(mini, n8n);
  assert.equal(closeness.close, false);
  assert.ok(closeness.misses.some(m => m.motif === 'family-identity'));
  assert.ok(closeness.ideologicalGaps.length > 0, 'family-identity must not empty the gap ledger');
  assert.ok(closeness.ideologicalGaps.some(g => g.motif === 'family-identity'));
  assert.ok(closeness.ideologicalGaps.some(g => g.motif === 'continue-on-fail-join'));
  const ledger = ledgerFromGaps(closeness.ideologicalGaps);
  assert.throws(() => assertConstraints(mini, ledger), { code: 'CONSTRAINT_VIOLATION' });
});

test('scripted-respecting is labeled oracle, not a live constructor', () => {
  const naive = createScriptedProvider('naive');
  const respecting = createScriptedProvider('respecting');
  assert.equal(naive.identity.role, 'construction');
  assert.equal(respecting.identity.role, 'oracle');
  assert.equal(respecting.identity.model, 'no-model-called');
});

test('CLI construct-compare emits families, no-cheat, misses and constraint ledger', () => {
  const result = spawnSync(process.execPath, [cli, 'construct-compare'], { encoding: 'utf8', timeout: 30000, cwd: root });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.ok(report.families.length >= 8);
  assert.equal(report.noCheat.envelope, 'fail-closed');
  assert.ok(Array.isArray(report.closeness.misses));
  assert.ok(report.closeness.misses.length > 0);
  assert.ok(Array.isArray(report.constraintLedger));
  assert.ok(report.constraintLedger.length > 0);
  assert.equal(report.ok, true);
  assert.ok(report.catalog.some(c => c.encoded === true));
});
