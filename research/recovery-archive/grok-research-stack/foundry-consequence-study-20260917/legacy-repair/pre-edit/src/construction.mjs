import { clone, digest, canonical, checkData, FoundryError } from './data.mjs';
import { suiteEvaluator } from './evaluation.mjs';
import {
  FAMILY_SPECS, MOTIFS, NAIVE, RESPECTING, interpretHarness, PUBLIC_HARNESS_CATALOG
} from './construction-families.mjs';
import {
  INTENT_NAIVE, INTENT_RESPECTING, INTENT_SCENARIOS, INTENT_CLASSES, INTENT_MOTIFS,
  INTENT_SPECS, PRODUCTION_LATTICE, interpretIntent, FOUNDRY_IR_LIMITS
} from './construction-durable.mjs';
import {
  OBJECTIVE_FAMILY_ID, OBJECTIVE_MOTIFS, OBJECTIVE_SPECS, IR_UNSUPPORTED,
  extractRequirements, composeObjectiveCandidate, summarizeObjectiveCandidate,
  interpretObjective, requiredMotifsFor
} from './construction-objective.mjs';

export { MOTIFS, NAIVE, RESPECTING, interpretHarness, PUBLIC_HARNESS_CATALOG };
export {
  INTENT_NAIVE, INTENT_RESPECTING, INTENT_SCENARIOS, INTENT_CLASSES, INTENT_MOTIFS,
  INTENT_SPECS, PRODUCTION_LATTICE, interpretIntent, FOUNDRY_IR_LIMITS
};
export {
  OBJECTIVE_FAMILY_ID, OBJECTIVE_MOTIFS, OBJECTIVE_SPECS, IR_UNSUPPORTED,
  extractRequirements, composeObjectiveCandidate, summarizeObjectiveCandidate,
  interpretObjective, requiredMotifsFor
};

const MAX_FAMILIES = 32;
const MAX_INTENT_CLASSES = 8;
const MAX_OBJECTIVES = 16;

export const EXTERNAL_SEAMS = Object.freeze({
  typedDecisionEngine: Object.freeze({ id: 'typesafe-system-one', available: false, required: false }),
  memoryStore: Object.freeze({ id: 'external-memory', available: false, required: false })
});

const PAIR_KEYS = ['taskSHA256', 'schemaSHA256', 'model', 'appVersion', 'executorSHA256', 'toolsSHA256', 'budgetSHA256', 'configSHA256'];

const FAMILIES = {};
for (const spec of Object.values(FAMILY_SPECS)) {
  for (const scenario of spec.heldOut.target.scenarios) {
    const got = interpretHarness(spec.heldOut.target.harness, scenario.input);
    if (digest(got) !== digest(scenario.expected)) {
      throw new FoundryError('HELD_OUT_FIXTURE', `Gold harness diverges from sealed scenario ${spec.id}/${scenario.id}`, { got, expected: scenario.expected });
    }
  }
  const family = clone(spec);
  family.heldOut.seal = digest(family.heldOut.target);
  FAMILIES[family.id] = family;
}

const INTENTS = {};
for (const spec of Object.values(INTENT_SPECS)) {
  for (const scenario of spec.heldOut.target.scenarios) {
    const got = interpretIntent(spec.heldOut.target.harness, scenario.input, spec.id);
    if (digest(got) !== digest(scenario.expected)) {
      throw new FoundryError('HELD_OUT_FIXTURE', `Gold intent diverges from sealed scenario ${spec.id}/${scenario.id}`, { got, expected: scenario.expected });
    }
  }
  const intent = clone(spec);
  intent.heldOut.seal = digest(intent.heldOut.target);
  INTENTS[intent.id] = intent;
}

const OBJECTIVES = {};
for (const spec of Object.values(OBJECTIVE_SPECS)) {
  const composed = composeObjectiveCandidate(spec.builderPack.objective, { mode: 'compose', objectiveId: spec.id });
  const summary = summarizeObjectiveCandidate(composed);
  if (digest(summary) !== digest(spec.heldOut.target.expected)) {
    throw new FoundryError('OBJECTIVE_FIXTURE', `Composed objective diverges from sealed summary ${spec.id}`, { got: summary, expected: spec.heldOut.target.expected });
  }
  for (const scenario of spec.heldOut.target.scenarios) {
    const got = interpretObjective(composed, scenario.input);
    if (digest(got) !== digest(scenario.expected)) {
      throw new FoundryError('OBJECTIVE_FIXTURE', `Composed objective diverges from sealed scenario ${spec.id}/${scenario.id}`, { got, expected: scenario.expected });
    }
  }
  const objective = clone(spec);
  objective.heldOut.seal = digest(objective.heldOut.target);
  OBJECTIVES[objective.id] = objective;
}

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return canonical(value);
}

function tryParseJson(text) {
  const s = text.trim();
  if (s.length < 2) return null;
  const c = s[0];
  if (c !== '{' && c !== '[') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function containsDigest(value, needles, seen = new WeakSet()) {
  if (value == null) return false;
  if (typeof value === 'string') {
    for (const n of needles) if (n && value.includes(n)) return true;
    const parsed = tryParseJson(value);
    if (parsed !== null && containsDigest(parsed, needles, seen)) return true;
    return false;
  }
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (needles.includes(digest(value))) return true;
  } catch {
    /* not canonical JSON */
  }
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    if (containsDigest(child, needles, seen)) return true;
  }
  return false;
}

function heldOutNeedles(frozen) {
  const target = frozen.heldOut.target;
  const harness = target?.harness;
  const scenarios = target?.scenarios;
  const needles = [
    frozen.heldOut.uniqueMarker,
    frozen.heldOut.seal,
    digest(target),
    canonical(target),
    harness ? digest(harness) : '',
    harness ? canonical(harness) : '',
    Array.isArray(scenarios) ? digest(scenarios) : '',
    Array.isArray(scenarios) ? canonical(scenarios) : '',
    target?.expected != null ? digest(target.expected) : '',
    target?.expected != null ? canonical(target.expected) : '',
    target?.marker && target.marker.length >= 12 ? target.marker : ''
  ];
  if (Array.isArray(scenarios)) {
    for (const scenario of scenarios) {
      needles.push(digest(scenario), canonical(scenario));
      if (scenario?.expected != null) {
        needles.push(digest(scenario.expected), canonical(scenario.expected));
      }
    }
  }
  return needles.filter(n => typeof n === 'string' && n.length >= 12);
}

function scanNoCheat({ families = [], intents = [], objectives = [], builderContext = {}, repairFeedback = null, constraints = [] }) {
  const leakage = [];
  const items = [
    ...families.map(id => freezeFamily(id)),
    ...intents.map(id => freezeIntentClass(id)),
    ...objectives.map(id => freezeObjective(id))
  ];
  for (const frozen of items) {
    try {
      detectLeakage({ family: frozen, builderContext, repairFeedback, constraints });
    } catch (error) {
      if (error?.code !== 'HOLDOUT_LEAKAGE') throw error;
      leakage.push({ id: frozen.id, message: error.message });
    }
  }
  return { envelope: 'fail-closed', leakage, rejected: leakage.length > 0, scanned: true };
}

function requireMotif(familyId, motifId) {
  const motif = (MOTIFS[familyId] ?? INTENT_MOTIFS[familyId] ?? OBJECTIVE_MOTIFS[familyId] ?? []).find(m => m.id === motifId);
  if (!motif) throw new FoundryError('UNKNOWN_MOTIF', `Unknown motif ${familyId}:${motifId}`);
  return motif;
}

export function listFamilies() {
  return Object.keys(FAMILIES).sort();
}

export function listIntentClasses() {
  return Object.keys(INTENTS).sort();
}

function freezeSplit(spec, unknownCode, unknownMessage, idKey) {
  if (!spec) throw new FoundryError(unknownCode, unknownMessage);
  const frozen = clone(spec);
  if (frozen.heldOut.seal !== digest(frozen.heldOut.target)) throw new FoundryError('UNSEALED_HELDOUT', 'Held-out target bytes do not match the frozen seal');
  const builderPack = frozen.builderPack;
  const disjoint = !textOf(builderPack).includes(frozen.heldOut.uniqueMarker)
    && digest(builderPack) !== digest(frozen.heldOut.target)
    && !frozen.heldOut.paths.some(p => textOf(builderPack).includes(p));
  if (!disjoint) throw new FoundryError('HELDOUT_SPLIT', 'Builder-visible pack is not disjoint from held-out target bytes');
  frozen.split = {
    [idKey]: frozen.id,
    builderPackSHA256: digest(builderPack),
    heldOutSHA256: digest(frozen.heldOut.target),
    seal: frozen.heldOut.seal,
    disjoint: true
  };
  return frozen;
}

export function freezeFamily(id) {
  return freezeSplit(FAMILIES[id], 'UNKNOWN_FAMILY', `Unknown harness family: ${id}`, 'familyId');
}

export function freezeIntentClass(id) {
  return freezeSplit(INTENTS[id], 'UNKNOWN_INTENT', `Unknown intent class: ${id}`, 'intentClass');
}

export function freezeObjective(id) {
  return freezeSplit(OBJECTIVES[id], 'UNKNOWN_OBJECTIVE', `Unknown objective fixture: ${id}`, 'objectiveId');
}

export function listObjectiveIds() {
  return Object.keys(OBJECTIVES).sort();
}

export function builderVisiblePack(family, { constraints = [] } = {}) {
  const frozen = family.split ? family : freezeFamily(family.id ?? family);
  const source = FAMILIES[frozen.id];
  return {
    familyId: frozen.id,
    intent: source.builderPack.intent,
    publicInterface: clone(source.builderPack.publicInterface),
    ideologicalReasons: clone(source.builderPack.ideologicalReasons),
    constructionConstraints: constraints.filter(c => c.familyId === frozen.id).map(c => ({ id: c.id, motif: c.motif, why: c.why })),
    seams: EXTERNAL_SEAMS
  };
}

function resolveFrozen(family) {
  if (family?.split) return family;
  const id = family?.id ?? family;
  if (FAMILIES[id]) return freezeFamily(id);
  if (INTENTS[id]) return freezeIntentClass(id);
  if (OBJECTIVES[id]) return freezeObjective(id);
  return freezeIntentClass(id);
}

export function detectLeakage({ family, builderContext = {}, repairFeedback = null, constraints = [] }) {
  const frozen = resolveFrozen(family);
  if (repairFeedback?.split === 'heldout' || repairFeedback?.suite?.split === 'heldout') {
    throw new FoundryError('HOLDOUT_LEAKAGE', 'A held-out suite cannot drive iterative generation or supply repair feedback');
  }
  if (repairFeedback?.suite) suiteEvaluator(repairFeedback.suite);
  const needles = heldOutNeedles(frozen);
  const blobs = [builderContext, repairFeedback, constraints];
  const haystack = blobs.map(textOf).join('\n');
  for (const n of needles) {
    if (haystack.includes(n)) throw new FoundryError('HOLDOUT_LEAKAGE', 'Builder context contains held-out target bytes');
  }
  for (const blob of blobs) {
    if (containsDigest(blob, needles)) throw new FoundryError('HOLDOUT_LEAKAGE', 'Builder context contains held-out target bytes');
  }
  for (const p of frozen.heldOut.paths) {
    if (haystack.includes(p)) throw new FoundryError('HOLDOUT_LEAKAGE', 'Builder context contains a held-out target path');
  }
}

export function validateHarnessCandidate(candidate) {
  checkData(candidate);
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || candidate.schemaVersion !== '1.0' || typeof candidate.familyId !== 'string') {
    throw new FoundryError('HARNESS_CANDIDATE', 'Harness candidate must be a JSON object with schemaVersion 1.0 and familyId');
  }
  return true;
}

export function inspectConstructionPair(baseline, treatment) {
  const errors = [];
  for (const key of PAIR_KEYS) {
    if (!baseline?.[key] || !treatment?.[key] || baseline[key] !== treatment[key]) errors.push(`Missing or unequal comparison control: ${key}`);
  }
  if (baseline?.sessionID === treatment?.sessionID || !baseline?.sessionID || !treatment?.sessionID) errors.push('Arms require distinct recorded sessions.');
  if (baseline?.arm !== 'baseline' || treatment?.arm !== 'foundry') errors.push('Comparison arms are mislabeled.');
  if (baseline?.split !== treatment?.split) errors.push('Arms have different exposure splits.');
  if (baseline?.skillSHA256) errors.push('Baseline was exposed to Foundry skills.');
  if (!treatment?.skillSHA256) errors.push('Foundry skill snapshot is missing.');
  if (baseline?.split === 'heldout' && (!baseline?.sealVerified || !treatment?.sealVerified)) errors.push('Heldout sealing is not verified.');
  return { comparable: errors.length === 0, errors };
}

export function compareCloseness(candidate, family, options = {}) {
  if (options.oracle === 'self-attested' || options.oracle === 'status-only') {
    throw new FoundryError('WEAK_EVALUATOR', 'Closeness cannot use self-attestation or status-only checks');
  }
  validateHarnessCandidate(candidate);
  const frozen = family.split ? family : freezeFamily(family.id ?? family);
  const sealVerified = frozen.heldOut.seal === digest(frozen.heldOut.target);
  if (!sealVerified) return { comparable: false, close: false, errors: ['Heldout sealing is not verified.'], misses: [], ideologicalGaps: [] };
  const misses = [], ideologicalGaps = [];
  if (candidate.familyId !== frozen.id) {
    misses.push({ familyId: frozen.id, motif: 'family-identity', kind: 'structural', detail: 'Candidate familyId does not match the held-out family' });
    ideologicalGaps.push({
      familyId: frozen.id, motif: 'family-identity', kind: 'structural',
      why: 'Cross-family identity is an ideological miss; remaining target-family motifs are still inspected so the gap ledger is not emptied.'
    });
  }
  for (const motif of MOTIFS[frozen.id]) {
    if (!motif.inspect(candidate)) {
      const miss = { familyId: frozen.id, motif: motif.id, kind: 'structural', detail: `Defining motif ${motif.id} is absent from candidate structure (claimedMotifs/selfAttestedSuccess are ignored)` };
      misses.push(miss);
      ideologicalGaps.push({ familyId: frozen.id, motif: motif.id, why: motif.why, kind: 'structural' });
    }
  }
  for (const scenario of frozen.heldOut.target.scenarios) {
    const got = interpretHarness(candidate, scenario.input);
    if (digest(got) !== digest(scenario.expected)) {
      misses.push({ familyId: frozen.id, motif: scenario.id, kind: 'behavioral', scenarioId: scenario.id, detail: `Held-out scenario ${scenario.id} diverged` });
      const related = MOTIFS[frozen.id].find(m => !m.inspect(candidate));
      if (related && !ideologicalGaps.some(g => g.motif === related.id)) {
        ideologicalGaps.push({ familyId: frozen.id, motif: related.id, why: related.why, kind: 'behavioral' });
      }
    }
  }
  const close = misses.length === 0;
  if (candidate.selfAttestedSuccess && !close) {
    misses.push({ familyId: frozen.id, motif: 'self-attestation', kind: 'structural', detail: 'Self-attested success is not a closeness pass' });
  }
  return { comparable: true, close, errors: [], misses, ideologicalGaps, selfAttested: !!candidate.selfAttestedSuccess };
}

export function gapToConstraint(gap) {
  return {
    id: `constraint:${gap.familyId}:${gap.motif}`,
    familyId: gap.familyId,
    motif: gap.motif,
    source: 'ideological-gap',
    why: gap.why
  };
}

export function ledgerFromGaps(gaps) {
  const seen = new Set(), ledger = [];
  for (const gap of gaps) {
    const key = `${gap.familyId}:${gap.motif}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ledger.push(gapToConstraint(gap));
  }
  return ledger;
}

export function assertConstraints(candidate, ledger) {
  validateHarnessCandidate(candidate);
  const applicable = (ledger ?? []).filter(c => c.familyId === candidate.familyId || c.familyId === `intent:${candidate.intentClass}` || (c.familyId === OBJECTIVE_FAMILY_ID && candidate.familyId === OBJECTIVE_FAMILY_ID) || c.motif === 'family-identity' || c.motif === 'intent-class-identity');
  if (!applicable.length) return { ok: true, checked: [], none: true };
  const violations = [];
  for (const constraint of applicable) {
    if (constraint.motif === 'family-identity') {
      if (candidate.familyId !== constraint.familyId) violations.push({ constraint: constraint.id, motif: constraint.motif });
      continue;
    }
    if (constraint.motif === 'intent-class-identity') {
      const expected = constraint.familyId.startsWith('intent:') ? constraint.familyId.slice('intent:'.length) : constraint.familyId;
      if (candidate.intentClass !== expected) violations.push({ constraint: constraint.id, motif: constraint.motif });
      continue;
    }
    if (constraint.familyId !== candidate.familyId && constraint.familyId !== `intent:${candidate.intentClass}`) continue;
    const motif = requireMotif(constraint.familyId, constraint.motif);
    if (!motif.inspect(candidate)) violations.push({ constraint: constraint.id, motif: constraint.motif });
  }
  if (violations.length) throw new FoundryError('CONSTRAINT_VIOLATION', 'Construction omitted a recorded ideological constraint', { violations });
  return { ok: true, checked: applicable.map(c => c.id), none: false };
}

export function createScriptedProvider(mode = 'naive') {
  const calls = [];
  return {
    identity: {
      provider: 'scripted-construction',
      model: 'no-model-called',
      mode,
      role: mode === 'respecting' ? 'oracle' : 'construction'
    },
    calls,
    generate(args) {
      calls.push(clone(args));
      if (args?.pack?.objective) {
        return composeObjectiveCandidate(args.pack.objective, {
          mode: mode === 'respecting' ? 'compose' : 'naive',
          objectiveId: args.pack.objectiveId ?? 'freeform'
        });
      }
      const intentClass = args?.pack?.intentClass;
      if (intentClass) {
        if (!INTENT_NAIVE[intentClass]) throw new FoundryError('UNKNOWN_INTENT', `Unknown intent class: ${intentClass}`);
        return clone(mode === 'respecting' ? INTENT_RESPECTING[intentClass] : INTENT_NAIVE[intentClass]);
      }
      const familyId = args?.pack?.familyId;
      if (!NAIVE[familyId]) throw new FoundryError('UNKNOWN_FAMILY', `Unknown harness family: ${familyId}`);
      return clone(mode === 'respecting' ? RESPECTING[familyId] : NAIVE[familyId]);
    }
  };
}

export function constructHarness({ familyId, builderContext = {}, provider, constraints = [], repairFeedback = null } = {}) {
  if (!provider || typeof provider.generate !== 'function' || !provider.identity) throw new FoundryError('PROVIDER', 'An identified construction provider is required');
  const family = freezeFamily(familyId);
  detectLeakage({ family, builderContext, repairFeedback, constraints });
  const pack = builderVisiblePack(family, { constraints });
  detectLeakage({ family, builderContext: pack, constraints });
  const generated = provider.generate({ pack, constraints: pack.constructionConstraints });
  const candidate = generated?.candidate ?? generated;
  validateHarnessCandidate(candidate);
  if (constraints.length) assertConstraints(candidate, constraints);
  return { candidate, packHash: digest(pack), familyId, provider: clone(provider.identity), split: family.split };
}

export function defaultPairControls(program) {
  return {
    taskSHA256: digest({ families: program.families, intent: 'multi-family-construction' }),
    schemaSHA256: digest({ schemaVersion: '1.0', candidate: 'harness' }),
    model: 'scripted-construction/no-model-called',
    appVersion: '0.1.0',
    executorSHA256: digest({ interpreters: listFamilies() }),
    toolsSHA256: digest({ motifs: Object.fromEntries(listFamilies().map(id => [id, MOTIFS[id].map(m => m.id)])) }),
    budgetSHA256: digest({ maxFamilies: MAX_FAMILIES, maxScenarios: 64 }),
    configSHA256: digest({ id: program.id, families: program.families })
  };
}

export function bundledConstructionProgram() {
  return { schemaVersion: '1.0', id: 'multi-family-closeness-v1', families: listFamilies(), provider: 'scripted-naive', constraints: [] };
}

export function primaryReport(report) {
  return {
    families: report.families,
    noCheat: report.noCheat,
    closenessMisses: report.closeness.misses,
    constraintLedger: (report.constraintLedger ?? []).map(c => ({ id: c.id, familyId: c.familyId, motif: c.motif })),
    catalog: {
      encoded: PUBLIC_HARNESS_CATALOG.filter(c => c.encoded).map(c => c.id),
      notEncoded: PUBLIC_HARNESS_CATALOG.filter(c => !c.encoded).map(c => ({ id: c.id, company: c.company, note: c.note }))
    }
  };
}

export function runConstructionProgram(programInput = bundledConstructionProgram()) {
  const program = checkData(clone(programInput));
  if (program.schemaVersion !== '1.0' || !Array.isArray(program.families) || program.families.length < 2) {
    throw new FoundryError('CONSTRUCTION_PROGRAM', 'A construction program must compare at least two harness families');
  }
  if (program.families.length > MAX_FAMILIES || new Set(program.families).size !== program.families.length) {
    throw new FoundryError('CONSTRUCTION_PROGRAM', 'Family ids must be unique and bounded');
  }
  for (const id of program.families) freezeFamily(id);
  const controls = program.pairControls ?? defaultPairControls(program);
  const skillSHA256 = digest({ skills: program.builderContext?.skills ?? [] });
  let pair;
  if (program.pair) pair = inspectConstructionPair(program.pair.baseline, program.pair.treatment);
  else {
    const seals = program.families.map(id => freezeFamily(id)).every(f => f.heldOut.seal === digest(f.heldOut.target));
    pair = inspectConstructionPair(
      { ...controls, arm: 'baseline', split: 'heldout', sessionID: `heldout:${program.families.join('+')}`, sealVerified: seals },
      { ...controls, arm: 'foundry', split: 'heldout', sessionID: `candidate:${program.id}`, skillSHA256, sealVerified: seals }
    );
  }
  const noCheat = scanNoCheat({
    families: program.families,
    builderContext: program.builderContext ?? {},
    repairFeedback: program.repairFeedback ?? null,
    constraints: program.constraints ?? []
  });
  if (noCheat.rejected) {
    return {
      schemaVersion: '1.0', id: program.id, families: program.families, ok: false,
      noCheat, seams: EXTERNAL_SEAMS,
      closeness: { comparable: false, close: false, errors: ['HOLDOUT_LEAKAGE'], misses: [], families: {} },
      constraintLedger: [],
      catalog: PUBLIC_HARNESS_CATALOG,
      qualification: 'Held-out leakage; no closeness claim. Not commercial parity.'
    };
  }
  if (!pair.comparable) {
    return {
      schemaVersion: '1.0', id: program.id, families: program.families, ok: false,
      noCheat, seams: EXTERNAL_SEAMS,
      closeness: { comparable: false, close: false, errors: pair.errors, misses: [], families: {} },
      constraintLedger: [],
      catalog: PUBLIC_HARNESS_CATALOG,
      qualification: 'Comparison is not comparable; no closeness claim. Not commercial parity.'
    };
  }
  const mode = program.provider === 'scripted-respecting' ? 'respecting' : 'naive';
  const provider = createScriptedProvider(mode);
  const families = {}, misses = [], gaps = [];
  for (const familyId of program.families) {
    const family = freezeFamily(familyId);
    const built = constructHarness({
      familyId, builderContext: program.builderContext ?? {}, provider,
      constraints: (program.constraints ?? []).filter(c => c.familyId === familyId),
      repairFeedback: program.repairFeedback ?? null
    });
    const closeness = compareCloseness(built.candidate, family);
    families[familyId] = { close: closeness.close, misses: closeness.misses, ideologicalGaps: closeness.ideologicalGaps, packHash: built.packHash, split: built.split };
    misses.push(...closeness.misses);
    gaps.push(...closeness.ideologicalGaps);
  }
  const constraintLedger = ledgerFromGaps(gaps);
  const close = Object.values(families).every(f => f.close);
  return {
    schemaVersion: '1.0', id: program.id, families: program.families, ok: true,
    noCheat, seams: EXTERNAL_SEAMS, provider: provider.identity,
    closeness: { comparable: true, close, errors: [], misses, families },
    constraintLedger,
    catalog: PUBLIC_HARNESS_CATALOG,
    qualification: 'Construction closeness against frozen public-behavior fixtures for the enumerated families only; not commercial parity or live-model quality. Closed-source families are public-protocol fixtures, not product source. scripted-respecting is an oracle lookup, not a live constructor. Construction does not drive generate/MCP.'
  };
}

export function builderVisibleIntentPack(intent, { constraints = [] } = {}) {
  const frozen = intent.split ? intent : freezeIntentClass(intent.id ?? intent);
  const source = INTENTS[frozen.id];
  const familyId = `intent:${frozen.id}`;
  return {
    familyId,
    intentClass: frozen.id,
    intent: source.builderPack.intent,
    publicInterface: clone(source.builderPack.publicInterface),
    ideologicalReasons: clone(source.builderPack.ideologicalReasons),
    constructionConstraints: constraints.filter(c => c.familyId === familyId || c.familyId === frozen.id).map(c => ({ id: c.id, motif: c.motif, why: c.why })),
    seams: EXTERNAL_SEAMS
  };
}

export function constructFromIntent({ intentClass, builderContext = {}, provider, constraints = [], repairFeedback = null } = {}) {
  if (!provider || typeof provider.generate !== 'function' || !provider.identity) throw new FoundryError('PROVIDER', 'An identified construction provider is required');
  const intent = freezeIntentClass(intentClass);
  detectLeakage({ family: intent, builderContext, repairFeedback, constraints });
  const pack = builderVisibleIntentPack(intent, { constraints });
  detectLeakage({ family: intent, builderContext: pack, constraints });
  const generated = provider.generate({ pack, constraints: pack.constructionConstraints });
  const candidate = generated?.candidate ?? generated;
  validateHarnessCandidate(candidate);
  if (constraints.length) assertConstraints(candidate, constraints);
  return { candidate, packHash: digest(pack), intentClass, familyId: pack.familyId, provider: clone(provider.identity), split: intent.split };
}

export function compareIntentCloseness(candidate, intentClass, options = {}) {
  if (options.oracle === 'self-attested' || options.oracle === 'status-only') {
    throw new FoundryError('WEAK_EVALUATOR', 'Closeness cannot use self-attestation or status-only checks');
  }
  validateHarnessCandidate(candidate);
  const frozen = freezeIntentClass(intentClass);
  const familyId = `intent:${intentClass}`;
  const sealVerified = frozen.heldOut.seal === digest(frozen.heldOut.target);
  if (!sealVerified) return { comparable: false, close: false, errors: ['Heldout sealing is not verified.'], misses: [], ideologicalGaps: [] };
  const misses = [], ideologicalGaps = [];
  if (!candidate.intentClass || candidate.intentClass !== intentClass) {
    misses.push({
      familyId, motif: 'intent-class-identity', kind: 'structural',
      detail: candidate.intentClass ? 'Candidate intentClass does not match the requested intent class' : 'Candidate omitted intentClass'
    });
    ideologicalGaps.push({
      familyId, motif: 'intent-class-identity', kind: 'structural',
      why: 'Intent-class identity is required; omitting intentClass is not fail-open.'
    });
  }
  for (const motif of INTENT_MOTIFS[familyId]) {
    if (!motif.inspect(candidate)) {
      const miss = { familyId, motif: motif.id, kind: 'structural', detail: `Defining motif ${motif.id} is absent from candidate structure (claimedMotifs/selfAttestedSuccess are ignored)` };
      misses.push(miss);
      ideologicalGaps.push({ familyId, motif: motif.id, why: motif.why, kind: 'structural' });
    }
  }
  for (const scenario of frozen.heldOut.target.scenarios) {
    let got;
    try {
      got = interpretIntent(candidate, scenario.input, intentClass);
    } catch {
      got = { interpreter: 'threw' };
    }
    if (digest(got) !== digest(scenario.expected)) {
      misses.push({ familyId, motif: scenario.id, kind: 'behavioral', scenarioId: scenario.id, detail: `Held-out scenario ${scenario.id} diverged` });
      const related = INTENT_MOTIFS[familyId].find(m => !m.inspect(candidate));
      if (related && !ideologicalGaps.some(g => g.motif === related.id)) {
        ideologicalGaps.push({ familyId, motif: related.id, why: related.why, kind: 'behavioral' });
      }
    }
  }
  const close = misses.length === 0;
  if (candidate.selfAttestedSuccess && !close) {
    misses.push({ familyId, motif: 'self-attestation', kind: 'structural', detail: 'Self-attested success is not a closeness pass' });
  }
  return { comparable: true, close, errors: [], misses, ideologicalGaps, selfAttested: !!candidate.selfAttestedSuccess, intentClass };
}

export function bundledIntentProgram() {
  return { schemaVersion: '1.0', id: 'intent-lattice-closeness-v1', intentClasses: listIntentClasses(), provider: 'scripted-naive', constraints: [] };
}

export function primaryIntentReport(report) {
  return {
    intentClasses: report.intentClasses,
    noCheat: report.noCheat,
    closenessMisses: report.closeness.misses,
    constraintLedger: (report.constraintLedger ?? []).map(c => ({ id: c.id, familyId: c.familyId, motif: c.motif })),
    lattice: PRODUCTION_LATTICE.map(m => ({ id: m.id, intentClass: m.intentClass })),
    irLimits: report.irLimits ?? FOUNDRY_IR_LIMITS,
    catalog: {
      encoded: PUBLIC_HARNESS_CATALOG.filter(c => c.encoded).map(c => c.id),
      notEncoded: PUBLIC_HARNESS_CATALOG.filter(c => !c.encoded).map(c => ({ id: c.id, company: c.company, note: c.note }))
    }
  };
}

function defaultIntentPairControls(program) {
  return {
    taskSHA256: digest({ intentClasses: program.intentClasses, intent: 'intent-lattice-construction' }),
    schemaSHA256: digest({ schemaVersion: '1.0', candidate: 'harness' }),
    model: 'scripted-construction/no-model-called',
    appVersion: '0.1.0',
    executorSHA256: digest({ interpreters: listIntentClasses() }),
    toolsSHA256: digest({ motifs: Object.fromEntries(listIntentClasses().map(id => [id, INTENT_MOTIFS[`intent:${id}`].map(m => m.id)])) }),
    budgetSHA256: digest({ maxIntentClasses: MAX_INTENT_CLASSES, maxScenarios: 64 }),
    configSHA256: digest({ id: program.id, intentClasses: program.intentClasses })
  };
}

export function runIntentProgram(programInput = bundledIntentProgram()) {
  const program = checkData(clone(programInput));
  if (program.schemaVersion !== '1.0' || !Array.isArray(program.intentClasses) || program.intentClasses.length < 2) {
    throw new FoundryError('CONSTRUCTION_PROGRAM', 'An intent program must compare at least two intent classes');
  }
  if (program.intentClasses.length > MAX_INTENT_CLASSES || new Set(program.intentClasses).size !== program.intentClasses.length) {
    throw new FoundryError('CONSTRUCTION_PROGRAM', 'Intent class ids must be unique and bounded');
  }
  for (const id of program.intentClasses) freezeIntentClass(id);
  const controls = program.pairControls ?? defaultIntentPairControls(program);
  const skillSHA256 = digest({ skills: program.builderContext?.skills ?? [] });
  let pair;
  if (program.pair) pair = inspectConstructionPair(program.pair.baseline, program.pair.treatment);
  else {
    const seals = program.intentClasses.map(id => freezeIntentClass(id)).every(f => f.heldOut.seal === digest(f.heldOut.target));
    pair = inspectConstructionPair(
      { ...controls, arm: 'baseline', split: 'heldout', sessionID: `heldout:${program.intentClasses.join('+')}`, sealVerified: seals },
      { ...controls, arm: 'foundry', split: 'heldout', sessionID: `candidate:${program.id}`, skillSHA256, sealVerified: seals }
    );
  }
  const noCheat = scanNoCheat({
    intents: program.intentClasses,
    builderContext: program.builderContext ?? {},
    repairFeedback: program.repairFeedback ?? null,
    constraints: program.constraints ?? []
  });
  if (noCheat.rejected) {
    return {
      schemaVersion: '1.0', id: program.id, intentClasses: program.intentClasses, ok: false,
      noCheat, seams: EXTERNAL_SEAMS,
      closeness: { comparable: false, close: false, errors: ['HOLDOUT_LEAKAGE'], misses: [], classes: {} },
      constraintLedger: [],
      lattice: PRODUCTION_LATTICE,
      irLimits: FOUNDRY_IR_LIMITS,
      catalog: PUBLIC_HARNESS_CATALOG,
      qualification: 'Held-out leakage; no closeness claim. Not commercial parity.'
    };
  }
  if (!pair.comparable) {
    return {
      schemaVersion: '1.0', id: program.id, intentClasses: program.intentClasses, ok: false,
      noCheat, seams: EXTERNAL_SEAMS,
      closeness: { comparable: false, close: false, errors: pair.errors, misses: [], classes: {} },
      constraintLedger: [],
      lattice: PRODUCTION_LATTICE,
      irLimits: FOUNDRY_IR_LIMITS,
      catalog: PUBLIC_HARNESS_CATALOG,
      qualification: 'Comparison is not comparable; no closeness claim. Not commercial parity.'
    };
  }
  const mode = program.provider === 'scripted-respecting' ? 'respecting' : 'naive';
  const provider = createScriptedProvider(mode);
  const classes = {}, misses = [], gaps = [];
  for (const intentClass of program.intentClasses) {
    const built = constructFromIntent({
      intentClass, builderContext: program.builderContext ?? {}, provider,
      constraints: (program.constraints ?? []).filter(c => c.familyId === `intent:${intentClass}` || c.familyId === intentClass),
      repairFeedback: program.repairFeedback ?? null
    });
    const closeness = compareIntentCloseness(built.candidate, intentClass);
    classes[intentClass] = { close: closeness.close, misses: closeness.misses, ideologicalGaps: closeness.ideologicalGaps, packHash: built.packHash, split: built.split };
    misses.push(...closeness.misses);
    gaps.push(...closeness.ideologicalGaps);
  }
  const constraintLedger = ledgerFromGaps(gaps);
  const close = Object.values(classes).every(c => c.close);
  return {
    schemaVersion: '1.0', id: program.id, intentClasses: program.intentClasses, ok: true,
    noCheat, seams: EXTERNAL_SEAMS, provider: provider.identity,
    closeness: { comparable: true, close, errors: [], misses, classes },
    constraintLedger,
    lattice: PRODUCTION_LATTICE,
    irLimits: FOUNDRY_IR_LIMITS,
    catalog: PUBLIC_HARNESS_CATALOG,
    qualification: 'Intent-lattice closeness against frozen production motifs for listIntentClasses() only; free-text / unknown classes are UNKNOWN_INTENT. A coding-agent-shaped candidate must fail durable-business-process. scripted-respecting is an oracle lookup, not a live constructor. Construction does not drive generate/MCP. Not commercial parity or live-model quality. Foundry IR limits are named, not papered over as Temporal.'
  };
}

export function builderVisibleObjectivePack(objective, { constraints = [] } = {}) {
  const frozen = objective.split ? objective : freezeObjective(objective.id ?? objective);
  const source = OBJECTIVES[frozen.id];
  return {
    familyId: OBJECTIVE_FAMILY_ID,
    objectiveId: frozen.id,
    objective: source.builderPack.objective,
    intent: source.builderPack.intent,
    publicInterface: clone(source.builderPack.publicInterface),
    ideologicalReasons: clone(source.builderPack.ideologicalReasons),
    constructionConstraints: constraints.filter(c => c.familyId === OBJECTIVE_FAMILY_ID || c.familyId === frozen.id).map(c => ({ id: c.id, motif: c.motif, why: c.why })),
    seams: EXTERNAL_SEAMS
  };
}

function groundedObjectiveView(candidate, frozen) {
  const extracted = extractRequirements(frozen.builderPack.objective);
  if (extracted.code) throw new FoundryError(extracted.code, extracted.message);
  return { ...candidate, requirements: extracted.requirements, requestedBeyondIr: extracted.requestedBeyondIr };
}

export function constructFromObjective({ objective, objectiveId, builderContext = {}, provider, constraints = [], repairFeedback = null } = {}) {
  if (!provider || typeof provider.generate !== 'function' || !provider.identity) throw new FoundryError('PROVIDER', 'An identified construction provider is required');
  if (objectiveId) {
    const frozen = freezeObjective(objectiveId);
    detectLeakage({ family: frozen, builderContext, repairFeedback, constraints });
    const pack = builderVisibleObjectivePack(frozen, { constraints });
    detectLeakage({ family: frozen, builderContext: pack, constraints });
    const generated = provider.generate({ pack, constraints: pack.constructionConstraints });
    const candidate = generated?.candidate ?? generated;
    validateHarnessCandidate(candidate);
    if (constraints.length) assertConstraints(candidate, constraints);
    return { candidate, packHash: digest(pack), objectiveId, familyId: OBJECTIVE_FAMILY_ID, provider: clone(provider.identity), split: frozen.split };
  }
  const text = typeof objective === 'string' ? objective : '';
  const extracted = extractRequirements(text);
  if (extracted.code) throw new FoundryError(extracted.code, extracted.message, { ungrounded: extracted.ungrounded, requirements: extracted.requirements });
  const noCheat = scanNoCheat({
    objectives: listObjectiveIds(),
    builderContext,
    repairFeedback,
    constraints
  });
  if (noCheat.rejected) throw new FoundryError('HOLDOUT_LEAKAGE', 'Builder context contains held-out target bytes', { leakage: noCheat.leakage });
  const pack = {
    familyId: OBJECTIVE_FAMILY_ID,
    objectiveId: 'freeform',
    objective: text,
    intent: `Compose a Foundry workflow IR for: ${text}`,
    publicInterface: {
      nodeKinds: ['task', 'assert', 'human', 'map', 'loop', 'wait'],
      irLimits: FOUNDRY_IR_LIMITS,
      authoring: 'inspect/edit/version/freeze; validate-before-save; human accept/discard; evidence-bound; autoApply false'
    },
    ideologicalReasons: requiredMotifsFor(extracted.requirements).map(motif => ({ motif, why: (OBJECTIVE_MOTIFS[OBJECTIVE_FAMILY_ID].find(m => m.id === motif) ?? {}).why })),
    constructionConstraints: constraints.filter(c => c.familyId === OBJECTIVE_FAMILY_ID).map(c => ({ id: c.id, motif: c.motif, why: c.why })),
    seams: EXTERNAL_SEAMS
  };
  const generated = provider.generate({ pack, constraints: pack.constructionConstraints });
  const candidate = generated?.candidate ?? generated;
  validateHarnessCandidate(candidate);
  if (constraints.length) assertConstraints(candidate, constraints);
  return { candidate, packHash: digest(pack), objectiveId: 'freeform', familyId: OBJECTIVE_FAMILY_ID, provider: clone(provider.identity), split: null };
}

export function compareObjectiveCloseness(candidate, objectiveId, options = {}) {
  if (options.oracle === 'self-attested' || options.oracle === 'status-only') {
    throw new FoundryError('WEAK_EVALUATOR', 'Closeness cannot use self-attestation or status-only checks');
  }
  validateHarnessCandidate(candidate);
  const frozen = freezeObjective(objectiveId);
  const familyId = OBJECTIVE_FAMILY_ID;
  const sealVerified = frozen.heldOut.seal === digest(frozen.heldOut.target);
  if (!sealVerified) return { comparable: false, close: false, errors: ['Heldout sealing is not verified.'], misses: [], ideologicalGaps: [] };
  const misses = [], ideologicalGaps = [];
  if (candidate.familyId !== familyId) {
    misses.push({ familyId, motif: 'family-identity', kind: 'structural', detail: 'Candidate familyId does not match objective-composition' });
    ideologicalGaps.push({
      familyId, motif: 'family-identity', kind: 'structural',
      why: 'Objective composition is Foundry workflow IR, not a named-harness clone; remaining motifs are still inspected.'
    });
  }
  const view = groundedObjectiveView(candidate, frozen);
  for (const motif of OBJECTIVE_MOTIFS[familyId]) {
    if (!motif.inspect(view)) {
      const miss = { familyId, motif: motif.id, kind: 'structural', detail: `Defining motif ${motif.id} is absent from candidate structure (claimedMotifs/selfAttestedSuccess are ignored)` };
      misses.push(miss);
      ideologicalGaps.push({ familyId, motif: motif.id, why: motif.why, kind: 'structural' });
    }
  }
  for (const scenario of frozen.heldOut.target.scenarios) {
    let got;
    try {
      got = interpretObjective(candidate, scenario.input);
    } catch {
      got = { interpreter: 'threw' };
    }
    if (digest(got) !== digest(scenario.expected)) {
      misses.push({ familyId, motif: scenario.id, kind: 'behavioral', scenarioId: scenario.id, detail: `Held-out scenario ${scenario.id} diverged` });
      const related = OBJECTIVE_MOTIFS[familyId].find(m => !m.inspect(view));
      if (related && !ideologicalGaps.some(g => g.motif === related.id)) {
        ideologicalGaps.push({ familyId, motif: related.id, why: related.why, kind: 'behavioral' });
      }
    }
  }
  const close = misses.length === 0;
  if (candidate.selfAttestedSuccess && !close) {
    misses.push({ familyId, motif: 'self-attestation', kind: 'structural', detail: 'Self-attested success is not a closeness pass' });
  }
  return { comparable: true, close, errors: [], misses, ideologicalGaps, selfAttested: !!candidate.selfAttestedSuccess, objectiveId };
}

export function bundledObjectiveProgram() {
  return { schemaVersion: '1.0', id: 'objective-composition-closeness-v1', objectives: listObjectiveIds(), provider: 'scripted-naive', constraints: [] };
}

export function primaryObjectiveReport(report) {
  return {
    objectives: report.objectives,
    familyId: OBJECTIVE_FAMILY_ID,
    noCheat: report.noCheat,
    closenessMisses: report.closeness.misses,
    constraintLedger: (report.constraintLedger ?? []).map(c => ({ id: c.id, familyId: c.familyId, motif: c.motif })),
    irLimits: report.irLimits ?? FOUNDRY_IR_LIMITS,
    catalog: {
      encoded: PUBLIC_HARNESS_CATALOG.filter(c => c.encoded).map(c => c.id),
      notEncoded: PUBLIC_HARNESS_CATALOG.filter(c => !c.encoded).map(c => ({ id: c.id, company: c.company, note: c.note }))
    }
  };
}

function defaultObjectivePairControls(program) {
  return {
    taskSHA256: digest({ objectives: program.objectives, intent: 'objective-composition' }),
    schemaSHA256: digest({ schemaVersion: '1.0', candidate: 'harness' }),
    model: 'scripted-construction/no-model-called',
    appVersion: '0.1.0',
    executorSHA256: digest({ interpreters: listObjectiveIds() }),
    toolsSHA256: digest({ motifs: OBJECTIVE_MOTIFS[OBJECTIVE_FAMILY_ID].map(m => m.id) }),
    budgetSHA256: digest({ maxObjectives: MAX_OBJECTIVES, maxScenarios: 64 }),
    configSHA256: digest({ id: program.id, objectives: program.objectives })
  };
}

export function runObjectiveProgram(programInput = bundledObjectiveProgram()) {
  const program = checkData(clone(programInput));
  if (program.schemaVersion !== '1.0' || !Array.isArray(program.objectives) || program.objectives.length < 2) {
    throw new FoundryError('CONSTRUCTION_PROGRAM', 'An objective program must compare at least two objective fixtures');
  }
  if (program.objectives.length > MAX_OBJECTIVES || new Set(program.objectives).size !== program.objectives.length) {
    throw new FoundryError('CONSTRUCTION_PROGRAM', 'Objective ids must be unique and bounded');
  }
  for (const id of program.objectives) freezeObjective(id);
  const controls = program.pairControls ?? defaultObjectivePairControls(program);
  const skillSHA256 = digest({ skills: program.builderContext?.skills ?? [] });
  let pair;
  if (program.pair) pair = inspectConstructionPair(program.pair.baseline, program.pair.treatment);
  else {
    const seals = program.objectives.map(id => freezeObjective(id)).every(f => f.heldOut.seal === digest(f.heldOut.target));
    pair = inspectConstructionPair(
      { ...controls, arm: 'baseline', split: 'heldout', sessionID: `heldout:${program.objectives.join('+')}`, sealVerified: seals },
      { ...controls, arm: 'foundry', split: 'heldout', sessionID: `candidate:${program.id}`, skillSHA256, sealVerified: seals }
    );
  }
  const noCheat = scanNoCheat({
    objectives: program.objectives,
    builderContext: program.builderContext ?? {},
    repairFeedback: program.repairFeedback ?? null,
    constraints: program.constraints ?? []
  });
  if (noCheat.rejected) {
    return {
      schemaVersion: '1.0', id: program.id, objectives: program.objectives, ok: false,
      noCheat, seams: EXTERNAL_SEAMS,
      closeness: { comparable: false, close: false, errors: ['HOLDOUT_LEAKAGE'], misses: [], fixtures: {} },
      constraintLedger: [],
      irLimits: FOUNDRY_IR_LIMITS,
      catalog: PUBLIC_HARNESS_CATALOG,
      qualification: 'Held-out leakage; no closeness claim. Not commercial parity.'
    };
  }
  if (!pair.comparable) {
    return {
      schemaVersion: '1.0', id: program.id, objectives: program.objectives, ok: false,
      noCheat, seams: EXTERNAL_SEAMS,
      closeness: { comparable: false, close: false, errors: pair.errors, misses: [], fixtures: {} },
      constraintLedger: [],
      irLimits: FOUNDRY_IR_LIMITS,
      catalog: PUBLIC_HARNESS_CATALOG,
      qualification: 'Comparison is not comparable; no closeness claim. Not commercial parity.'
    };
  }
  const mode = program.provider === 'scripted-respecting' ? 'respecting' : 'naive';
  const provider = createScriptedProvider(mode);
  const fixtures = {}, misses = [], gaps = [];
  for (const objectiveId of program.objectives) {
    const built = constructFromObjective({
      objectiveId, builderContext: program.builderContext ?? {}, provider,
      constraints: (program.constraints ?? []).filter(c => c.familyId === OBJECTIVE_FAMILY_ID || c.familyId === objectiveId),
      repairFeedback: program.repairFeedback ?? null
    });
    const closeness = compareObjectiveCloseness(built.candidate, objectiveId);
    fixtures[objectiveId] = { close: closeness.close, misses: closeness.misses, ideologicalGaps: closeness.ideologicalGaps, packHash: built.packHash, split: built.split };
    misses.push(...closeness.misses);
    gaps.push(...closeness.ideologicalGaps);
  }
  const constraintLedger = ledgerFromGaps(gaps);
  const close = Object.values(fixtures).every(f => f.close);
  return {
    schemaVersion: '1.0', id: program.id, objectives: program.objectives, ok: true,
    noCheat, seams: EXTERNAL_SEAMS, provider: provider.identity,
    closeness: { comparable: true, close, errors: [], misses, fixtures },
    constraintLedger,
    irLimits: FOUNDRY_IR_LIMITS,
    catalog: PUBLIC_HARNESS_CATALOG,
    qualification: 'Objective-composition closeness against frozen inspect-summaries for listObjectiveIds() only; free-text that matches no grounded cue is UNKNOWN_OBJECTIVE; ungrounded capabilities are UNGROUNDED_OBJECTIVE. scripted-respecting is the compiler itself (oracle), not a live constructor. Construction does not drive generate/MCP. Not a fifth intent class and not more named-harness families. Foundry IR limits are named, not papered over as Temporal. Not commercial parity or live-model quality.'
  };
}
