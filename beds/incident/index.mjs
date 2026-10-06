// `incident` bed: SRE incident triage over a generated microservice system and log bundle.
// Interface per beds/CONTRACT.md. The oracle and reference solver are trusted host code.
import { FAULT_CLASSES, SIBLING_CLASS } from './catalog.mjs';
import { build, VERSION } from './gen.mjs';

export const family = {
  id: 'incident',
  domain: 'SRE incident triage',
  version: VERSION,
  kind: 'oneshot',
  description: 'Find the root service, fault class, start time and blast radius of one injected fault in a fictional microservice system from its service map, an incident ticket and an interleaved multi-service log bundle (300 to ~4000 lines) full of cascades, aliases and red herrings.',
};

export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['root_service', 'fault_class', 'first_bad_timestamp', 'impacted_services', 'evidence_line_ids'],
  properties: {
    root_service: { type: 'string', minLength: 1, maxLength: 80, description: 'canonical service name from the dependency table' },
    fault_class: { type: 'string', enum: [...FAULT_CLASSES] },
    first_bad_timestamp: { type: 'string', minLength: 20, maxLength: 40, description: 'ISO-8601 UTC timestamp, e.g. 2026-03-14T10:22:31Z' },
    impacted_services: { type: 'array', minItems: 1, maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 80 } },
    evidence_line_ids: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 12 } },
  },
};

export const PASS_RULE = 'root_service exact AND fault_class exact AND |first_bad_timestamp - T| <= 60 s AND Jaccard(impacted_services) >= 0.8';
const TIME_TOLERANCE_S = 60;
const JACCARD_MIN = 0.8;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export function generate({ seed, split = 'dev', difficulty = 3 } = {}) {
  return build(seed, split, difficulty).task;
}

// Minimal validator for the portable schema subset used by outputSchema.
export function validateOutput(output) {
  const errors = [];
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(output)) return ['output must be a JSON object'];
  for (const key of outputSchema.required) if (!Object.hasOwn(output, key)) errors.push(`missing required field '${key}'`);
  for (const key of Object.keys(output)) if (!Object.hasOwn(outputSchema.properties, key)) errors.push(`unexpected field '${key}'`);
  for (const [key, spec] of Object.entries(outputSchema.properties)) {
    if (!Object.hasOwn(output, key)) continue;
    const v = output[key];
    if (spec.type === 'string') {
      if (typeof v !== 'string') { errors.push(`'${key}' must be a string`); continue; }
      if (spec.minLength !== undefined && v.length < spec.minLength) errors.push(`'${key}' is too short`);
      if (spec.maxLength !== undefined && v.length > spec.maxLength) errors.push(`'${key}' is too long`);
      if (spec.enum && !spec.enum.includes(v)) errors.push(`'${key}' must be one of the enum values`);
    } else if (spec.type === 'array') {
      if (!Array.isArray(v)) { errors.push(`'${key}' must be an array`); continue; }
      if (spec.minItems !== undefined && v.length < spec.minItems) errors.push(`'${key}' needs at least ${spec.minItems} item(s)`);
      if (spec.maxItems !== undefined && v.length > spec.maxItems) errors.push(`'${key}' has more than ${spec.maxItems} items`);
      v.forEach((item, i) => {
        if (typeof item !== 'string') errors.push(`'${key}[${i}]' must be a string`);
        else if (item.length < spec.items.minLength || item.length > spec.items.maxLength) errors.push(`'${key}[${i}]' has an invalid length`);
      });
    }
  }
  if (typeof output.first_bad_timestamp === 'string' && !(ISO_RE.test(output.first_bad_timestamp) && Number.isFinite(Date.parse(output.first_bad_timestamp)))) {
    errors.push("'first_bad_timestamp' is not an ISO-8601 timestamp with a UTC offset");
  }
  return errors;
}

const norm = name => String(name).trim().toLowerCase();

// Small memo of rebuilt truths: rebuilding is deterministic, the cache only saves time when the
// oracle and the controls score the same task repeatedly. Callers never receive cached objects.
const memo = new Map();
function rebuildTruth(task) {
  const key = `${task.seed}|${task.split}|${task.difficulty}`;
  if (memo.has(key)) { const hit = memo.get(key); memo.delete(key); memo.set(key, hit); return hit; }
  const { truth } = build(task.seed, task.split, task.difficulty);
  memo.set(key, truth);
  if (memo.size > 12) memo.delete(memo.keys().next().value);
  return truth;
}

export function oracle(task, output) {
  if (!task || task.family !== 'incident') return { pass: false, score: 0, details: { error: 'not an incident task' } };
  let truth;
  try { truth = rebuildTruth(task); }
  catch (error) { return { pass: false, score: 0, details: { error: `cannot rebuild task: ${error.message}` } }; }
  const errors = validateOutput(output);
  if (errors.length) return { pass: false, score: 0, details: { schemaValid: false, errors } };

  const rootOk = norm(output.root_service) === norm(truth.root_service);
  const classOk = output.fault_class === truth.fault_class;
  const deltaS = Math.abs(Date.parse(output.first_bad_timestamp) - Date.parse(truth.first_bad_timestamp)) / 1000;
  const timeOk = deltaS <= TIME_TOLERANCE_S;
  const want = new Set(truth.impacted_services.map(norm));
  const got = new Set(output.impacted_services.map(norm));
  const inter = [...got].filter(x => want.has(x)).length;
  const jaccard = inter / (want.size + got.size - inter);
  const impactedOk = jaccard >= JACCARD_MIN;
  const relevant = new Set([...truth.rootIds, ...truth.depIds]);
  const ids = [...new Set(output.evidence_line_ids)];
  const evidenceHits = ids.filter(id => relevant.has(id)).length;
  const evidencePrecision = ids.length ? evidenceHits / ids.length : 0;
  const pass = rootOk && classOk && timeOk && impactedOk;
  const score = 0.9 * ((rootOk ? 1 : 0) + (classOk ? 1 : 0) + (timeOk ? 1 : 0) + Math.min(1, jaccard)) / 4 + 0.1 * evidencePrecision;
  return {
    pass,
    score: Math.round(score * 1e4) / 1e4,
    details: {
      schemaValid: true, rootOk, classOk, timeOk, timeDeltaS: Math.round(deltaS), impactedOk,
      jaccard: Math.round(jaccard * 1e4) / 1e4, evidenceCited: ids.length, evidenceRelevant: evidenceHits,
      onsetCited: ids.includes(truth.onsetId), rule: PASS_RULE,
    },
  };
}

const truthOf = task => rebuildTruth(task);

export function referenceSolve(task) {
  const t = truthOf(task);
  return {
    root_service: t.root_service,
    fault_class: t.fault_class,
    first_bad_timestamp: t.first_bad_timestamp,
    impacted_services: [...t.impacted_services],
    evidence_line_ids: [t.onsetId, ...t.rootIds.filter(id => id !== t.onsetId).slice(0, 7), ...t.depIds.slice(0, 4)],
  };
}

const shiftIso = (iso, seconds) => new Date(Date.parse(iso) + seconds * 1000).toISOString().replace('.000Z', 'Z');

export const badControls = [
  { name: 'empty', make: () => ({}) },
  {
    name: 'shuffled-or-corrupted',
    make(task) {
      const t = truthOf(task);
      const others = t.services.filter(s => !t.impacted_services.includes(s));
      return {
        root_service: t.noisy[0],
        fault_class: FAULT_CLASSES[(FAULT_CLASSES.indexOf(t.fault_class) + 4) % FAULT_CLASSES.length],
        first_bad_timestamp: shiftIso(t.first_bad_timestamp, -420),
        impacted_services: others.length ? others : ['unknown-service'],
        evidence_line_ids: [],
      };
    },
  },
  {
    // Near miss: blames the loudest direct caller of the root (everything else exact).
    name: 'plausible-but-wrong',
    make(task) {
      const t = truthOf(task);
      return { ...referenceSolve(task), root_service: t.firstHopCallers[0] };
    },
  },
  { name: 'sibling-class', make: task => ({ ...referenceSolve(task), fault_class: SIBLING_CLASS[truthOf(task).fault_class] }) },
  { name: 'late-timestamp', make: task => ({ ...referenceSolve(task), first_bad_timestamp: shiftIso(truthOf(task).first_bad_timestamp, 150) }) },
  {
    name: 'impacted-missing-half',
    make(task) {
      const t = truthOf(task);
      const keep = t.impacted_services.filter(s => s !== t.root_service).slice(Math.floor(t.impacted_services.length / 2));
      return { ...referenceSolve(task), impacted_services: [t.root_service, ...keep].slice(0, Math.max(1, t.impacted_services.length - Math.floor(t.impacted_services.length / 2))) };
    },
  },
  {
    // Follows the most tempting red herring: the routine deploy, else the misleading claim, else the noisy job.
    name: 'follow-red-herring',
    make(task) {
      const t = truthOf(task);
      const svc = t.herrings.deploys[0] || (t.herrings.claims[0] && t.herrings.claims[0].svc) || t.noisy[0];
      return { ...referenceSolve(task), root_service: svc, fault_class: t.fault_class === 'bad_config_deploy' ? SIBLING_CLASS.bad_config_deploy : 'bad_config_deploy' };
    },
  },
];
