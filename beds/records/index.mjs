// `records` bed: data repair and entity resolution over a messy multi-system export.
// Interface per beds/CONTRACT.md. Hidden truth is recomputed from (seed, split, difficulty).
import { buildWorld, ruleSolve, resolveGroup, clusterRows } from './world.mjs';
import { isoDate } from './render.mjs';
import * as P from './pools.mjs';

export const family = {
  id: 'records',
  domain: 'data repair / entity resolution',
  version: '1.0.0',
  description: 'Merge a messy export of customer/supplier rows from several legacy systems (mixed locales, '
    + 'nicknames, transliterations, typos, void markers, adversarial staff memos) into one canonical record '
    + 'per real person, following a prose spec for identity, conflict resolution, phone normalisation and USD conversion.',
  kind: 'oneshot',
};

const nullable = t => ({ type: [t, 'null'] });
export const outputSchema = {
  type: 'object',
  required: ['records'],
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        required: ['entity_id', 'source_rows', 'given_name', 'family_name', 'birth_date', 'country', 'phone_e164', 'amount_usd'],
        properties: {
          entity_id: { type: 'integer' },
          source_rows: { type: 'array', minItems: 1, items: { type: 'integer' } },
          given_name: { type: 'string' },
          family_name: { type: 'string' },
          birth_date: nullable('string'),
          country: nullable('string'),
          phone_e164: nullable('string'),
          amount_usd: nullable('number'),
        },
      },
    },
  },
};

// Minimal validator for the portable JSON Schema subset used above.
function typeOk(t, v) {
  switch (t) {
    case 'null': return v === null;
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    default: return false;
  }
}
export function validate(schema, v, path = '$', errs = []) {
  const types = schema.type === undefined ? null : [].concat(schema.type);
  if (types && !types.some(t => typeOk(t, v))) { errs.push(`${path}: expected ${types.join('|')}`); return errs; }
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${path}: not in enum`);
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) v.forEach((x, i) => validate(schema.items, x, `${path}[${i}]`, errs));
  } else if (v !== null && typeof v === 'object') {
    for (const key of schema.required ?? []) if (!(key in v)) errs.push(`${path}: missing ${key}`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) if (key in v) validate(sub, v[key], `${path}.${key}`, errs);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(v)) if (!(key in (schema.properties ?? {}))) errs.push(`${path}: unexpected ${key}`);
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------------------
export function generate({ seed, split = 'dev', difficulty = 3 }) {
  const w = buildWorld(seed, split, difficulty);
  const rowCount = w.allRows.length;
  return {
    id: `records:${split}:d${difficulty}:${seed}`,
    family: family.id,
    seed, split, difficulty,
    prompt: w.prompt,
    inputs: { source_notes: w.notes, spec: w.spec, export: w.exportText },
    budget: { outputTokens: 400 + rowCount * 60 },
  };
}

// ---------------------------------------------------------------------------------------
// Oracle
export const FIELDS = ['entity_id', 'given_name', 'family_name', 'birth_date', 'country', 'phone_e164', 'amount_usd'];
export const THRESHOLDS = { fieldAccuracy: 0.97, pairF1: 0.95, entitySlack: 0.02 };
const normName = s => s.normalize('NFC').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
const normPhone = s => s.replace(/[\s\-().]/g, '');
function fieldOk(field, want, got) {
  if (want === null || got === null || got === undefined) return want === null && (got === null || got === undefined);
  switch (field) {
    case 'entity_id': return got === want;
    case 'given_name': case 'family_name': return normName(got) === normName(want);
    case 'birth_date': return got.trim() === want;
    case 'country': return got.trim().toUpperCase() === want;
    case 'phone_e164': return normPhone(got) === want;
    case 'amount_usd': return Math.abs(got * 100 - Math.round(want * 100)) < 1e-3;
    default: return false;
  }
}
const pairs = n => (n * (n - 1)) / 2;

export function scoreAgainst(truthRecords, output) {
  const errors = validate(outputSchema, output);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors: errors.slice(0, 8) } };
  const pred = output.records;
  const seen = new Map();
  for (let i = 0; i < pred.length; i++) {
    for (const id of pred[i].source_rows) {
      if (seen.has(id) && seen.get(id) !== i) return { pass: false, score: 0, details: { reason: 'row-in-multiple-records', row: id } };
      seen.set(id, i);
    }
  }
  const E = truthRecords.length;
  const truthOf = new Map();
  truthRecords.forEach((t, ti) => t.source_rows.forEach(id => truthOf.set(id, ti)));

  // Pairwise cluster F1 over all listed rows (void/unknown rows only add false-positive pairs).
  let predPairs = 0, tp = 0;
  const overlaps = [];
  pred.forEach((p, pi) => {
    const ids = [...new Set(p.source_rows)];
    predPairs += pairs(ids.length);
    const counts = new Map();
    for (const id of ids) if (truthOf.has(id)) counts.set(truthOf.get(id), (counts.get(truthOf.get(id)) ?? 0) + 1);
    for (const [ti, c] of counts) { tp += pairs(c); overlaps.push({ pi, ti, c, union: ids.length + truthRecords[ti].source_rows.length - c }); }
  });
  const truePairs = truthRecords.reduce((s, t) => s + pairs(t.source_rows.length), 0);
  const precision = predPairs ? tp / predPairs : 1;
  const recall = truePairs ? tp / truePairs : 1;
  const pairF1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  // One-to-one entity matching by row overlap (largest overlap, then smallest union).
  overlaps.sort((a, b) => (b.c - a.c) || (a.union - b.union) || (a.pi - b.pi) || (a.ti - b.ti));
  const pUsed = new Set(), tUsed = new Map();
  for (const o of overlaps) { if (pUsed.has(o.pi) || tUsed.has(o.ti)) continue; pUsed.add(o.pi); tUsed.set(o.ti, o.pi); }
  const extra = pred.length - pUsed.size, missing = E - tUsed.size;

  const perField = Object.fromEntries(FIELDS.map(f => [f, 0]));
  let correct = 0;
  const mismatches = [];
  for (const [ti, pi] of tUsed) {
    for (const f of FIELDS) {
      if (fieldOk(f, truthRecords[ti][f], pred[pi][f])) { correct++; perField[f]++; }
      else if (mismatches.length < 12) mismatches.push({ entity_id: truthRecords[ti].entity_id, field: f, expected: truthRecords[ti][f], got: pred[pi][f] ?? null });
    }
  }
  const matched = tUsed.size;
  const fieldAccuracy = matched ? correct / (matched * FIELDS.length) : 0;
  const fieldAccuracyAll = E ? correct / (E * FIELDS.length) : 1;
  const slack = Math.floor(THRESHOLDS.entitySlack * E);
  const pass = fieldAccuracy >= THRESHOLDS.fieldAccuracy && pairF1 >= THRESHOLDS.pairF1 && extra <= slack && missing <= slack;
  const hm = fieldAccuracyAll + pairF1 ? (2 * fieldAccuracyAll * pairF1) / (fieldAccuracyAll + pairF1) : 0;
  const score = Math.max(0, Math.min(1, hm * Math.max(0, 1 - (extra + missing) / Math.max(1, E))));
  return {
    pass, score: Math.round(score * 1e6) / 1e6,
    details: {
      entities: E, predicted: pred.length, matched, extra, missing, slack,
      pairF1, precision, recall, fieldAccuracy, fieldAccuracyAll,
      perField: Object.fromEntries(FIELDS.map(f => [f, matched ? perField[f] / matched : 0])),
      thresholds: THRESHOLDS, mismatches,
    },
  };
}

// Memoised world for host-side callers (oracle, reference, controls). buildWorld is a pure function
// of (seed, split, difficulty) and these callers never mutate the world, so caching is safe.
const worldCache = new Map();
function hostWorld(task) {
  const key = JSON.stringify([task.seed, task.split, task.difficulty]);
  let w = worldCache.get(key);
  if (!w) {
    w = buildWorld(task.seed, task.split, task.difficulty);
    worldCache.set(key, w);
    if (worldCache.size > 16) worldCache.delete(worldCache.keys().next().value);
  }
  return w;
}

export function oracle(task, output) {
  return scoreAgainst(hostWorld(task).truth.records, output);
}

export function referenceSolve(task) {
  return structuredClone(hostWorld(task).truth);
}

// ---------------------------------------------------------------------------------------
// Bad controls. Each is a plausible failure mode recomputed from the hidden world.
const worldOf = hostWorld;
const rowRecord = (s, fx) => resolveGroup([s], fx);
export const badControls = [
  { name: 'empty', make: () => ({ records: [] }) },
  {
    name: 'shuffled-or-corrupted',
    make: task => {
      const recs = structuredClone(worldOf(task).truth.records);
      const n = recs.length;
      const rot = (f, by) => { const vals = recs.map(x => x[f]); recs.forEach((x, i) => { x[f] = vals[(i + by) % n]; }); };
      rot('birth_date', 1); rot('phone_e164', 2); rot('amount_usd', 3); rot('country', 4);
      return { records: recs };
    },
  },
  {
    // Plausible: every row becomes its own person (no entity resolution at all).
    name: 'no-dedup',
    make: task => { const w = worldOf(task); return { records: w.rows.map(x => rowRecord(x.s, w.fx)) }; },
  },
  {
    // Plausible: void markers ignored (test fixtures, cancelled and withdrawn rows migrated).
    name: 'ignore-void-markers',
    make: task => { const w = worldOf(task); return ruleSolve(w.allRows.map(x => x.s), w.fx); },
  },
  {
    // Plausible: the oldest row wins every conflict instead of the most recent one.
    name: 'oldest-row-wins',
    make: task => {
      const w = worldOf(task);
      const live = w.rows.map(x => x.s);
      const records = clusterRows(live).map(g => resolveGroup(g, w.fx, { order: (a, b) => (a.date - b.date) || (a.rowId - b.rowId) }));
      return { records: records.sort((a, b) => a.entity_id - b.entity_id) };
    },
  },
  {
    // Plausible: every slash date read as US month/day/year (the ATLAS locale note ignored).
    name: 'us-locale-dates',
    make: task => {
      const w = worldOf(task);
      const live = w.rows.map(x => {
        if (x.system !== 'ATLAS' || !x.s.dob || w.ctx.atlasMonthFirst(x.date)) return x.s;
        const { y, m, d } = x.s.dob;
        return d <= 12 ? { ...x.s, dob: { y, m: d, d: m } } : x.s;
      });
      return ruleSolve(live, w.fx);
    },
  },
  {
    // Plausible: balances copied without currency conversion.
    name: 'unconverted-amounts',
    make: task => {
      const w = worldOf(task);
      const flat = { cur: {}, old: {}, cutover: null };
      for (const cur of Object.keys(w.fx.cur)) flat.cur[cur] = 1000000;
      return ruleSolve(w.rows.map(x => x.s), flat);
    },
  },
];

export { buildWorld, isoDate, P as pools };
