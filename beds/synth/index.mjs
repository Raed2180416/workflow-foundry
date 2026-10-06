// `synth` bed: research synthesis over a corpus of fictional documents (articles, preprints,
// lab notes, press releases, errata, retractions). See README.md and beds/CONTRACT.md.
import { estimateTokens } from '../lib/canonical.mjs';
import { PROPS } from './catalog.mjs';
import { VERSION, KNOBS, buildWorld, resolve, toOutput, toCanon, relDiff } from './world.mjs';
import { renderTask, aliasText } from './render.mjs';

export const family = {
  id: 'synth',
  domain: 'research synthesis',
  version: VERSION,
  kind: 'oneshot',
  description: 'Build the accepted property table for requested (entity, property) cells from a corpus of fictional research documents, '
    + 'applying retractions, superseded versions, errata, standard conditions, unit conversion, aliases and a prose ranking policy; '
    + 'also list the void (retracted or superseded) documents.',
};

const str = { type: 'string' };
export const outputSchema = {
  type: 'object',
  required: ['table', 'conflicts', 'excluded_doc_ids'],
  additionalProperties: false,
  properties: {
    table: {
      type: 'array',
      items: {
        type: 'object', required: ['entity', 'property', 'value', 'source_doc_id'], additionalProperties: false,
        properties: { entity: str, property: str, value: { type: 'number' }, source_doc_id: str },
      },
    },
    conflicts: {
      type: 'array',
      items: {
        type: 'object', required: ['entity', 'property', 'doc_ids'], additionalProperties: false,
        properties: { entity: str, property: str, doc_ids: { type: 'array', items: str } },
      },
    },
    excluded_doc_ids: { type: 'array', items: str },
  },
};

// Minimal validator for the portable JSON-Schema subset used above.
export function validate(schema, v, path = '$') {
  const errs = [];
  const t = schema.type;
  const typeOk = t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v)
    : t === 'array' ? Array.isArray(v)
      : t === 'number' ? typeof v === 'number' && Number.isFinite(v)
        : t === 'integer' ? Number.isInteger(v)
          : t === 'string' ? typeof v === 'string'
            : t === 'boolean' ? typeof v === 'boolean'
              : t === 'null' ? v === null : true;
  if (!typeOk) return [`${path}: expected ${t}`];
  if (t === 'object') {
    for (const k of schema.required || []) if (!Object.hasOwn(v, k)) errs.push(`${path}: missing ${k}`);
    for (const [k, val] of Object.entries(v)) {
      if (schema.properties && schema.properties[k]) errs.push(...validate(schema.properties[k], val, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected property ${k}`);
    }
  }
  if (t === 'array' && schema.items) v.forEach((x, i) => errs.push(...validate(schema.items, x, `${path}[${i}]`)));
  return errs;
}

// ---------------------------------------------------------------------------------------
// Controls computed from the hidden world. `minDifficulty` gates controls whose trap only
// exists from that level on; `applies(world)` gates controls whose trap depends on the drawn
// policy or features. The generator guarantees every applicable control fails.
const resolved = (o, excl) => w => { const res = resolve(w, o); return toOutput(w, res, excl ? { excluded: excl(w, res) } : {}); };
const hasFeat = f => w => w.requested.some(c => c.feats.includes(f));
const WORLD_CONTROLS = [
  { name: 'empty', minDifficulty: 1, fromWorld: () => ({ table: [], conflicts: [], excluded_doc_ids: [] }) },
  {
    name: 'shuffled-or-corrupted', minDifficulty: 1, fromWorld: w => {
      const out = toOutput(w, resolve(w));
      const ids = out.table.map(r => r.source_doc_id);
      out.table = out.table.map((r, i) => ({ ...r, value: r.value * 1.37, source_doc_id: ids[(i + 1) % ids.length] }));
      out.excluded_doc_ids = out.excluded_doc_ids.slice(1);
      return out;
    },
  },
  {
    name: 'plausible-but-wrong:latest-claim', minDifficulty: 1,
    fromWorld: resolved({ keepRetracted: true, keepSuperseded: true, skipErrata: true, ignoreConditions: true, anyMode: true, allowVariants: true, recencyOnly: true, noPressRule: true }, () => []),
  },
  { name: 'plausible-but-wrong:skip-errata', minDifficulty: 1, fromWorld: resolved({ skipErrata: true }) },
  { name: 'plausible-but-wrong:no-unit-conversion', minDifficulty: 1, fromWorld: resolved({ noConvert: true }) },
  { name: 'plausible-but-wrong:retracted-claims-used', minDifficulty: 1, fromWorld: resolved({ keepRetracted: true }, (w, res) => resolve(w).excluded) },
  { name: 'plausible-but-wrong:superseded-kept', minDifficulty: 1, fromWorld: resolved({ keepSuperseded: true }, (w, res) => res.retracted) },
  { name: 'plausible-but-wrong:conditions-ignored', minDifficulty: 1, fromWorld: resolved({ ignoreConditions: true }) },
  { name: 'plausible-but-wrong:press-release-trusted', minDifficulty: 1, fromWorld: resolved({ pressTrusted: true }) },
  { name: 'plausible-but-wrong:recency-only', minDifficulty: 1, fromWorld: resolved({ recencyOnly: true }) },
  { name: 'plausible-but-wrong:erratum-cited', minDifficulty: 1, fromWorld: w => toOutput(w, resolve(w), { citeErratum: true }) },
  {
    name: 'plausible-but-wrong:one-excluded-missing', minDifficulty: 1,
    fromWorld: w => { const out = toOutput(w, resolve(w)); out.excluded_doc_ids = out.excluded_doc_ids.slice(0, -1); return out; },
  },
  { name: 'plausible-but-wrong:quotes-counted', minDifficulty: 3, fromWorld: resolved({ anyMode: true }) },
  { name: 'plausible-but-wrong:near-name-merged', minDifficulty: 3, fromWorld: w => toOutput(w, resolve(mergeDistractors(w))) },
  { name: 'plausible-but-wrong:concern-as-retraction', minDifficulty: 3, fromWorld: w => { const res = resolve(w, { concernVoids: true }); return toOutput(w, res, { excluded: res.voided }); } },
  { name: 'plausible-but-wrong:erratum-applied-by-document', minDifficulty: 3, fromWorld: resolved({ erratumByDoc: true }) },
  { name: 'plausible-but-wrong:gross-n', minDifficulty: 3, applies: hasFeat('grossN'), fromWorld: resolved({ grossN: true }) },
  { name: 'plausible-but-wrong:variants-counted', minDifficulty: 4, fromWorld: resolved({ allowVariants: true }) },
  { name: 'plausible-but-wrong:printed-n', minDifficulty: 4, applies: hasFeat('nErratum'), fromWorld: resolved({ printedN: true }) },
  {
    name: 'plausible-but-wrong:phantom-retraction-applied', minDifficulty: 4,
    fromWorld: w => { const res = resolve(w, { phantomApplied: true }); return toOutput(w, res, { excluded: res.voided }); },
  },
  { name: 'plausible-but-wrong:injection-followed', minDifficulty: 5, fromWorld: followInjection },
];
const controlApplies = (c, w) => c.minDifficulty <= w.difficulty && (!c.applies || c.applies(w));

// Treat every near-name distractor's claims as claims about the entity it imitates.
function mergeDistractors(w) {
  const to = new Map(w.entities.filter(e => e.distractorOf).map(e => [e.key, e.distractorOf]));
  return { ...w, claims: w.claims.map(c => (to.has(c.ent) ? { ...c, ent: to.get(c.ent) } : c)) };
}
// Obey the instruction-like sentence: its value and its host document, nothing excluded.
function followInjection(w) {
  const out = toOutput(w, resolve(w));
  const inj = w.injection;
  if (!inj) return out;
  const name = w.entMap.get(inj.ent).name;
  out.table = out.table.map(r => (r.entity === name && r.property === inj.prop
    ? { ...r, value: toCanon(inj.prop, inj.claim.value, inj.claim.unit), source_doc_id: w.docMap.get(inj.doc).id } : r));
  out.excluded_doc_ids = [];
  return out;
}

// ---------------------------------------------------------------------------------------
// Hidden state: deterministic retry loop over world attempts until every invariant holds.
const cache = new Map();
// Every entity that some document calls by its code must have that code mapped to its name,
// in so many words, by at least one non-void research document.
export function aliasMappingProblems(world, documents) {
  const voidIds = new Set(resolve(world).excluded.map(k => world.docMap.get(k).id));
  const research = documents.filter(d => !voidIds.has(d.id) && ['journal', 'preprint', 'labnote'].includes(world.docs.find(x => x.id === d.id).kind));
  const problems = [];
  for (const e of world.entities) {
    if (e.phantom) continue;
    const a = aliasText(e).toLowerCase(), n = e.name.toLowerCase();
    if (!documents.some(d => `${d.title} ${d.text}`.toLowerCase().includes(e.alias.toLowerCase()))) continue;
    const pats = [`${n} (${a})`, `${a} (${n})`, `${a} (now named ${n})`, `${n} (code ${a})`, `previously referred to as ${a} is named ${n}`];
    if (!research.some(d => pats.some(p => d.text.toLowerCase().includes(p)))) problems.push(e.name);
  }
  return problems;
}

function checkWorld(world, rendered) {
  if (!world.constraintsOk) return 'date-constraints';
  if (aliasMappingProblems(world, rendered.inputs.documents).length) return 'alias-unmapped';
  const res = resolve(world);
  if (res.cells.some(c => !c.win)) return 'empty-cell';
  if (!res.excluded.length) return 'no-excluded';
  for (const c of WORLD_CONTROLS) {
    if (!controlApplies(c, world)) continue;
    if (oracleCore(world, c.fromWorld(world)).pass) return `control-passes:${c.name}`;
  }
  return null;
}
export function hidden({ seed, split, difficulty: diffIn }) {
  const difficulty = Number(diffIn);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error(`difficulty must be an integer 1..5, got ${diffIn}`);
  if (!['dev', 'test'].includes(split)) throw new Error(`split must be dev or test, got ${split}`);
  const key = `${split}|${typeof seed}:${seed}|${difficulty}`;
  if (cache.has(key)) return cache.get(key);
  const rejects = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    const world = buildWorld(seed, split, difficulty, attempt);
    if (!world.constraintsOk) { rejects.push('date-constraints'); continue; }
    const rendered = renderTask(world, attempt);
    const why = checkWorld(world, rendered);
    if (why) { rejects.push(why); continue; }
    const h = { world, rendered, attempt, rejects };
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    cache.set(key, h);
    return h;
  }
  throw new Error(`synth: no valid world for ${key}: ${rejects.join(', ')}`);
}

// ---------------------------------------------------------------------------------------
// Interface
export function generate({ seed, split = 'dev', difficulty: diffIn = 3 }) {
  const difficulty = Number(diffIn);
  const { rendered, world } = hidden({ seed, split, difficulty });
  const est = estimateTokens(rendered.prompt) + estimateTokens(rendered.inputs);
  return {
    id: `synth-${split}-d${difficulty}-s${seed}`,
    family: family.id,
    seed, split, difficulty,
    prompt: rendered.prompt,
    inputs: structuredClone(rendered.inputs),
    budget: { tokens: est * 3 + 600 * world.requested.length + 4000 },
  };
}

export function referenceSolve(task) {
  const { world } = hidden(task);
  return toOutput(world, resolve(world));
}

export const badControls = WORLD_CONTROLS.filter(c => c.minDifficulty === 1 && !c.applies).map(c => ({ name: c.name, make: task => c.fromWorld(hidden(task).world) }));
// Controls whose trap exists only from `minDifficulty` on, or only for some policies/features
// (`applies(task)`); where they do not apply they can coincide with the reference answer.
export const gatedControls = WORLD_CONTROLS.filter(c => c.minDifficulty > 1 || c.applies).map(c => ({
  name: c.name, minDifficulty: c.minDifficulty, applies: task => controlApplies(c, hidden(task).world), make: task => c.fromWorld(hidden(task).world),
}));

const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
const normId = s => String(s).trim().toUpperCase();

function oracleCore(world, output) {
  const schemaErrors = validate(outputSchema, output);
  if (schemaErrors.length) return { pass: false, score: 0, details: { schemaErrors: schemaErrors.slice(0, 20) } };
  const truth = resolve(world);
  const entKey = new Map();
  for (const e of world.entities) if (!e.distractorOf && !e.background) {
    entKey.set(norm(e.name), e.key); entKey.set(norm(aliasText(e)), e.key); entKey.set(norm(e.alias), e.key);
  }
  const propKey = new Map();
  for (const [p, P] of Object.entries(PROPS)) { propKey.set(norm(p), p); for (const n of P.names) if (!propKey.has(norm(n))) propKey.set(norm(n), p); }
  const rowsFor = new Map();
  for (const row of output.table) {
    const k = `${entKey.get(norm(row.entity))}|${propKey.get(norm(row.property))}`;
    if (!rowsFor.has(k)) rowsFor.set(k, []);
    rowsFor.get(k).push(row);
  }
  const cells = truth.cells.map(c => {
    const t = { entity: world.entMap.get(c.ent).name, property: c.prop, value: c.value, source_doc_id: world.docMap.get(c.src).id };
    const rows = rowsFor.get(`${c.ent}|${c.prop}`) || [];
    if (rows.length !== 1) return { ...t, ok: false, why: rows.length ? 'duplicate rows' : 'missing' };
    const r = rows[0];
    const valueOk = Math.abs(r.value - c.value) <= 0.01 * Math.abs(c.value);
    const srcOk = normId(r.source_doc_id) === t.source_doc_id;
    return { ...t, ok: valueOk && srcOk, valueOk, srcOk, got: { value: r.value, source_doc_id: r.source_doc_id } };
  });
  const id = k => world.docMap.get(k).id;
  const wantEx = new Set(truth.excluded.map(id));
  const gotEx = new Set(output.excluded_doc_ids.map(normId));
  const missingEx = [...wantEx].filter(x => !gotEx.has(x)).sort();
  const extraEx = [...gotEx].filter(x => !wantEx.has(x)).sort();
  const excludedOk = !missingEx.length && !extraEx.length;
  // conflicts: diagnostic only (not part of pass/score)
  const want = new Set(truth.cells.filter(c => c.conflict).map(c => `${c.ent}|${c.prop}|${[...new Set(c.candidates)].map(id).sort().join(',')}`));
  const got = new Set(output.conflicts.map(x => `${entKey.get(norm(x.entity))}|${propKey.get(norm(x.property))}|${[...new Set(x.doc_ids.map(normId))].sort().join(',')}`));
  const hit = [...got].filter(x => want.has(x)).length;
  const correct = cells.filter(c => c.ok).length;
  return {
    pass: correct === cells.length && excludedOk,
    score: correct / cells.length,
    details: {
      cells, correct, total: cells.length, excludedOk, missingExcluded: missingEx, extraExcluded: extraEx,
      conflicts: { expected: want.size, reported: got.size, matched: hit, precision: got.size ? hit / got.size : want.size ? 0 : 1, recall: want.size ? hit / want.size : 1 },
    },
  };
}

export function oracle(task, output) {
  const { world } = hidden(task);
  return oracleCore(world, output);
}

export { KNOBS, relDiff };
