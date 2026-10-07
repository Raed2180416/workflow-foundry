// Output schema, validator and scorer for the `records` bed. Shared by the oracle (index.mjs) and the
// generator's decisiveness checks (world.mjs), so both use exactly the same pass rule.

// Size caps (portable maxItems / maxLength) bound oracle work on hostile outputs: an export has at most
// 150 rows, so a real answer never comes near them.
const nullable = (t, extra = {}) => ({ type: [t, 'null'], ...extra });
export const LIMITS = { records: 1000, sourceRows: 400, text: 200 };
export const outputSchema = {
  type: 'object',
  required: ['records'],
  properties: {
    records: {
      type: 'array',
      maxItems: LIMITS.records,
      items: {
        type: 'object',
        required: ['entity_id', 'source_rows', 'given_name', 'family_name', 'birth_date', 'country', 'phone_e164', 'amount_usd'],
        properties: {
          entity_id: { type: 'integer' },
          source_rows: { type: 'array', minItems: 1, maxItems: LIMITS.sourceRows, items: { type: 'integer' } },
          given_name: { type: 'string', maxLength: LIMITS.text },
          family_name: { type: 'string', maxLength: LIMITS.text },
          birth_date: nullable('string', { maxLength: LIMITS.text }),
          country: nullable('string', { maxLength: LIMITS.text }),
          phone_e164: nullable('string', { maxLength: LIMITS.text }),
          amount_usd: nullable('number'),
        },
      },
    },
  },
};

// Minimal validator for the portable JSON Schema subset used above. Only own properties count
// (an inherited `records` or field does not satisfy `required`).
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
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
  if (errs.length >= 32) return errs; // enough to reject; stop walking hostile outputs
  const types = schema.type === undefined ? null : [].concat(schema.type);
  if (types && !types.some(t => typeOk(t, v))) { errs.push(`${path}: expected ${types.join('|')}`); return errs; }
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${path}: not in enum`);
  if (typeof v === 'string' && schema.maxLength !== undefined && v.length > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength}`);
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && v.length > schema.maxItems) { errs.push(`${path}: more than ${schema.maxItems} items`); return errs; }
    if (schema.items) for (let i = 0; i < v.length && errs.length < 32; i++) validate(schema.items, v[i], `${path}[${i}]`, errs);
  } else if (v !== null && typeof v === 'object') {
    for (const key of schema.required ?? []) if (!own(v, key)) errs.push(`${path}: missing ${key}`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) if (own(v, key)) validate(sub, v[key], `${path}.${key}`, errs);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(v)) if (!own(schema.properties ?? {}, key)) errs.push(`${path}: unexpected ${key}`);
    }
  }
  return errs;
}

// Snapshot a caller-supplied output into plain data before validating it, so accessors, proxies and
// prototype chains cannot show the validator one value and the scorer another. Returns null if the
// value cannot be snapshotted (functions, proxies, symbols) or is obviously oversized.
export function snapshot(output) {
  try {
    if (output !== null && typeof output === 'object' && !Array.isArray(output) && own(output, 'records')) {
      const recs = output.records;
      if (Array.isArray(recs) && recs.length > LIMITS.records) return { records: { length: recs.length, oversized: true } };
    }
    return structuredClone(output);
  } catch { return undefined; }
}

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

export function scoreAgainst(truthRecords, rawOutput) {
  const output = snapshot(rawOutput);
  const errors = output === undefined ? ['$: not plain JSON-like data'] : validate(outputSchema, output);
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
