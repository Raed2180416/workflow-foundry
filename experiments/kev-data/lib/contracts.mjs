// The frozen port contracts (spec/ports.json, JUDGE-PROGRAM.md §1, §2.1): loading, hashing and the
// acceptance checks (42 ports + 3 ledger-only contracts; Q0-Q3; 2-64 options; <= 32 criteria;
// questions <= 4,000 characters with every slot at its longest; field provenance for every state
// key; deploymentRate; allowedKnowledge; real-token budgets).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_STATE_KEYS, LIMITS, slotNames } from '../judges/kit.mjs';
import { renderQuestion } from './render.mjs';
import { DEPLOYMENT_RATES } from './balance.mjs';
import { sha256, tagged } from './hash.mjs';

export const KEV_DATA = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const REPO_ROOT = path.resolve(KEV_DATA, '..', '..');
export const SPEC_PATH = path.join(KEV_DATA, 'spec', 'ports.json');

export const PORT_IDS = Object.freeze(['R1', 'R2', 'R3', 'R4', 'R5', 'I1', 'I2', 'I3', 'S1', 'S2', 'S3', 'S4', 'S5', 'K1', 'K2', 'K3',
  'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'F1', 'F2', 'F3', 'C1', 'C2', 'C3', 'C4', 'C5',
  'C6', 'C7', 'C8', 'C9']);
export const LEDGER_IDS = Object.freeze(['L1', 'L2', 'L3']);
export const WAVE1 = Object.freeze(['R1', 'R2', 'R3', 'R4', 'I1', 'I2', 'S2', 'Q4', 'X1', 'X3', 'X5', 'X8', 'F1']);

export function loadSpec(file = SPEC_PATH) {
  const bytes = readFileSync(file);
  const spec = JSON.parse(bytes.toString('utf8'));
  return { spec, hash: tagged(sha256(bytes)), file, contracts: { ...spec.ports, ...spec.ledgerOnly } };
}

const nonEmpty = s => typeof s === 'string' && s.trim().length > 0;
const DECISION = /^D:[A-H]\d{1,2}$/;

// The longest filling of each slot, for the 4,000-character check.
function longestSlots(contract) {
  const out = {};
  for (const [name, s] of Object.entries(contract.slots ?? {})) {
    out[name] = s.values?.length ? s.values.reduce((a, b) => (b.length > a.length ? b : a)) : 'x'.repeat(s.maxChars ?? 200);
  }
  return out;
}
function sampleOptions(contract) {
  if (contract.options) return {};
  const src = contract.optionSource, n = src.max;
  const names = Array.from({ length: n }, (_, i) => {
    if (src.pattern === '^c[1-8]$') return `c${i + 1}`;
    if (src.pattern === '^C[1-8]$') return `C${i + 1}`;
    if (src.pattern === '^c[0-9]{1,2}$') return `c${i + 1}`;
    return `option_${i + 1}`;
  });
  return { options: names, optionDescriptions: Object.fromEntries(names.map(o => [o, 'd'.repeat(80)])) };
}

function checkCommon(id, c, errors, { ledger }) {
  const err = m => errors.push(`${id}: ${m}`);
  if (c.id !== id) err(`id ${c.id} does not match its key`);
  if (!/^[a-z][a-z0-9_]*$/.test(c.name ?? '')) err('name must be snake_case');
  if (!Array.isArray(c.decisions) || !c.decisions.length || !c.decisions.every(d => DECISION.test(d))) err('decisions must be D:Xn ids');
  if (c.questionType !== 'choice') err('questionType must be choice (JudgmentPort serves choice only)');
  const need = ledger ? ['Q0'] : ['Q0', 'Q1', 'Q2', 'Q3'];
  for (const q of need) if (!nonEmpty(c.wordings?.[q])) err(`missing wording ${q}`);
  for (const [q, text] of Object.entries(c.wordings ?? {})) for (const s of slotNames(text)) if (!c.slots?.[s]) err(`wording ${q} uses undeclared slot {${s}}`);
  for (const [name, s] of Object.entries(c.slots ?? {})) {
    if (!nonEmpty(s.source)) err(`slot ${name} needs a trusted source`);
    if (!(s.values?.length || Number.isInteger(s.maxChars))) err(`slot ${name} needs values or maxChars`);
  }
  if (c.options) {
    const names = Object.keys(c.options);
    if (names.length < LIMITS.minOptions || names.length > LIMITS.maxOptions) err(`has ${names.length} options (2-64)`);
    if (!names.every(n => n.length <= LIMITS.maxOptionChars && nonEmpty(n))) err('option names must be 1-200 characters');
    if (!Object.values(c.options).every(nonEmpty)) err('every option needs a description');
  } else if (c.optionSource) {
    const s = c.optionSource;
    if (!(Number.isInteger(s.max) && s.max >= 2 && s.max <= LIMITS.maxOptions)) err('optionSource.max must be 2-64');
    if (!nonEmpty(s.kind)) err('optionSource.kind is required');
  } else err('needs options or optionSource');
  if (!Array.isArray(c.criteria) || c.criteria.length > LIMITS.maxCriteria || !c.criteria.every(nonEmpty)) err('criteria must be <= 32 non-empty strings');
  const keys = c.state?.keys;
  if (!keys || typeof keys !== 'object' || !Object.keys(keys).length) err('needs state keys');
  else for (const [k, p] of Object.entries(keys)) {
    for (const seg of k.split('.')) if (FORBIDDEN_STATE_KEYS.includes(seg)) err(`state key ${k} uses a forbidden name`);
    if (!nonEmpty(p?.event) || !nonEmpty(p?.source)) err(`state key ${k} needs field provenance {event, source}`);
    if (k.includes('.') && !keys[k.split('.')[0]]) err(`nested state key ${k} needs its parent declared`);
  }
  // Render every wording at its longest slot filling through the serving path.
  for (const w of Object.keys(c.wordings ?? {})) {
    try { renderQuestion(c, { wording: w, slots: longestSlots(c), ...sampleOptions(c) }); }
    catch (e) { err(`wording ${w} does not render within JudgmentPort limits: ${e.message}`); }
  }
  for (const [name, s] of Object.entries(c.slots ?? {})) for (const v of s.values ?? []) if (/[{}]/.test(v)) err(`slot ${name} value contains a brace`);
}

export function validateSpec(spec) {
  const errors = [];
  const ports = spec?.ports ?? {}, ledger = spec?.ledgerOnly ?? {};
  const ids = Object.keys(ports), lids = Object.keys(ledger);
  if (ids.length !== 42 || PORT_IDS.some(id => !ports[id]) || ids.some(id => !PORT_IDS.includes(id))) errors.push(`spec: expected the 42 ports ${PORT_IDS.join(',')}, got ${ids.join(',')}`);
  if (lids.length !== 3 || LEDGER_IDS.some(id => !ledger[id])) errors.push(`spec: expected ledger-only L1-L3, got ${lids.join(',')}`);
  for (const [id, c] of Object.entries(ports)) {
    checkCommon(id, c, errors, { ledger: false });
    const err = m => errors.push(`${id}: ${m}`);
    if (![1, 2, 3].includes(c.wave)) err('wave must be 1, 2 or 3');
    if (!['gating', 'advisory'].includes(c.authority)) err('authority must be gating or advisory');
    if (!DEPLOYMENT_RATES.includes(c.deploymentRate)) err(`deploymentRate must be one of ${DEPLOYMENT_RATES.join(', ')}`);
    if (!Array.isArray(c.allowedKnowledge) || !c.allowedKnowledge.every(a => nonEmpty(a.knowledge) && nonEmpty(a.basis))) err('allowedKnowledge must be a list of {knowledge, basis}');
    const b = c.budget;
    if (!b || !Number.isInteger(b.typical) || !Number.isInteger(b.max) || b.typical <= 0 || b.typical > b.max || b.max > (b.hardCap ?? 8192) || !['M', 'E'].includes(b.evidence)) err('budget must be {typical <= max <= hardCap, evidence M|E} in real tokens');
    if (!Array.isArray(c.families?.train) || !c.families.train.length || !Array.isArray(c.families?.heldOut)) err('families must list train and heldOut');
    if (!nonEmpty(c.labelSource)) err('labelSource is required (labels never come from an LLM)');
    if (!(c.epsilon > 0 && c.epsilon <= 0.2)) err('epsilon out of range');
    if (!c.use || !nonEmpty(c.use.consumer) || !c.use.terminal?.kind) err('use needs a consumer and a terminal route');
    if (c.wave === 1 && !(c.heldoutWordings?.['calib-ood'] === 10 && c.heldoutWordings?.['dev-ood'] === 10 && c.heldoutWordings?.['test-ood'] === 20)) err('wave-1 ports take 10/10/20 held-out wordings');
  }
  for (const [id, c] of Object.entries(ledger)) {
    checkCommon(id, c, errors, { ledger: true });
    if (c.ledgerOnly !== true || c.training !== 'none' || c.gate !== 'none') errors.push(`${id}: ledger-only contracts carry no data, training or gate`);
  }
  const wave1 = ids.filter(id => ports[id].wave === 1).sort();
  if (JSON.stringify(wave1) !== JSON.stringify([...WAVE1].sort())) errors.push(`spec: wave 1 must be ${WAVE1.join(',')}, got ${wave1.join(',')}`);
  if (spec?.route?.weak?.policyClass !== 'M' || spec?.route?.strong?.policyClass !== 'L') errors.push('spec: route must name the weak (class M) and strong (class L) policy models');
  return { ok: errors.length === 0, errors };
}

// The route's model ids must resolve in the owner policy with the stated class (AGENTS.md: model ids
// come only from the policy file).
export function checkRouteAgainstPolicy(spec, policyFile = path.join(REPO_ROOT, 'policy', 'models.json')) {
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  const errors = [];
  for (const role of ['weak', 'strong']) {
    const r = spec.route[role], m = policy.models.find(x => x.id === r.modelId);
    if (!m) errors.push(`${role}: ${r.modelId} is not in policy/models.json`);
    else if (m.class !== r.policyClass) errors.push(`${role}: ${r.modelId} is class ${m.class} in the policy, the contract says ${r.policyClass}`);
  }
  return { ok: errors.length === 0, errors };
}
