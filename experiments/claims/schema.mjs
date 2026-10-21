// S1 claim row `claim-row/0`, with the S6 timing fields inside it (FIRST-CLASS-PROGRAMS.md §0.1, §8; SPINE-0).
// One record per arm x task x run. $0: pure functions, no model, no network, no file writes.
//
// A row is either emitted by a runner (`emitted: 'runner'`) or back-filled from an older run's outputs
// (`emitted: 'derived'`, the §0.1 rule: every back-filled field is marked derived). A derived row carries a provenance entry
// for every TRACKED field, saying where the value came from or why the old outputs cannot supply it:
//   copied    the value is a field of a run output, verbatim (`from` names it)
//   computed  the value is computed from run outputs by a stated rule (`rule`)
//   code      the value is a constant of the runner's source at its launch commit (`from` names file@commit)
//   doc       the value is quoted from a report and cannot be re-derived from outputs (`from` names the report)
//   missing   the outputs cannot supply it (`why`); the value is null, never filled in
//   n/a       the field does not apply to this row (`why`); the value is null
//
// Fields (null = not supplied; see provenance):
//   id, schema, emitted, program, experiment, arm, run, trial, rowKind ('task' | 'build' | 'repair' | 'set-aside')
//   models[]      {role: executor|builder|repairer|reader, id}: ids must be in policy/models.json (models or judgmentModels)
//   harness       {id, version, hashes: {name: sha}}: runner, bridge, harness-manifest, arm and policy hashes
//   task          {key, bed, family, unit: case|world|item|task|build, split, cases}
//   origin        {class, group}: class one of ORIGIN_CLASSES (origin.mjs); group our-bed | third-party | real-log
//   fidelity[]    {world, tier: M0..M4 | null, manifest}: every world or mock the row touched (S5; manifest id when one exists)
//   evidence      {class: development | diagnostic | sealed, K}
//   verdict       {kind: binary|count|score|none, pass, successes, total, score, censored, excluded, oracle: {id, sha256}}
//   usd           {run, build, world, upkeep, imputed, reservedUnsettled, reported, repriced, bound, starts, charged, observed}
//                 charged is the need router's §12 meter (meter.mjs): max(reported, re-priced) when observed, else the bound
//   timing (S6)   {wallMs, wallMsBounds {lo, hi}, timeToFirstEffectMs, timeToDoneMs, startedAt, endedAt,
//                  stages[] {stage, ms, n?}, components {modelMs, nonModelMs, toolMs, mockMs,
//                  waits {rateLimitMs, retryAfterMs, queueMs, humanMs}}, concurrency {configured, observedMax},
//                  businessTime {simulatedMs}, deadline {ms, hit} | null}   compute wall time and simulated business time are
//                  never mixed; deadline is the runner's per-start wall limit when known: a row that hit it has a wall time
//                  truncated at the limit (a latency quantile that lands on such a row is a lower bound, not a measurement)
//   envFaults[]   {code, n}: environment faults (rate limits, job limits), kept apart from outcomes
//   refs          {build, setAsideOf, supersedes, supersededBy}: other row ids (a superseded row is kept, never used in tables)
//   source        {adapter, files[] {path, sha256}}
//   provenance    {fieldPath: {kind, from?, rule?, why?}}

export const SCHEMA_ID = 'claim-row/0';
export const ROW_KINDS = Object.freeze(['task', 'build', 'repair', 'set-aside']);
export const UNITS = Object.freeze(['case', 'world', 'item', 'task', 'build']);
export const VERDICT_KINDS = Object.freeze(['binary', 'count', 'score', 'none']);
export const EVIDENCE = Object.freeze(['development', 'diagnostic', 'sealed']);
export const MODEL_ROLES = Object.freeze(['executor', 'builder', 'repairer', 'reader']);
export const TIERS = Object.freeze(['M0', 'M1', 'M2', 'M3', 'M4']);
export const PROV_KINDS = Object.freeze(['copied', 'computed', 'code', 'doc', 'missing', 'n/a']);
export const SUPPLIED = Object.freeze(['copied', 'computed', 'code', 'doc']);
// Origin classes and their groups (FIRST-CLASS-PROGRAMS §0.1 S1, §6): duplicated in origin.mjs's ORIGINS, checked equal by test.
export const ORIGIN_GROUPS = Object.freeze({
  ours: 'our-bed', 'ours-grounded': 'our-bed',
  'outside-world-our-grader': 'third-party', 'outside-world-outside-grader': 'third-party',
  'real-process': 'real-log',
});

// The fields a derived row must account for, one provenance entry each. The coverage report counts these.
export const TRACKED = Object.freeze([
  'models', 'harness.hashes', 'task.key', 'origin.class', 'fidelity', 'evidence.class', 'verdict', 'verdict.oracle.id',
  'usd.reported', 'usd.repriced', 'usd.bound', 'usd.charged', 'usd.build', 'usd.world',
  'timing.wallMs', 'timing.timeToFirstEffectMs', 'timing.timeToDoneMs', 'timing.stages',
  'timing.components.modelMs', 'timing.components.nonModelMs', 'timing.components.toolMs', 'timing.components.mockMs',
  'timing.components.waits', 'timing.concurrency.configured', 'timing.concurrency.observedMax', 'timing.businessTime.simulatedMs',
  'envFaults',
]);

/** Read a dotted path from an object (undefined when any step is missing). */
export function getPath(o, p) { return p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); }

const isNum = x => typeof x === 'number' && Number.isFinite(x);
const isNonNeg = x => isNum(x) && x >= 0;
const isInt = x => Number.isInteger(x);

/** An empty row skeleton: every field present, every value null; callers fill values and provenance. */
export function emptyRow() {
  return {
    schema: SCHEMA_ID, id: null, emitted: 'derived', program: null, experiment: null, arm: null, run: null, trial: 0, rowKind: 'task',
    models: null, harness: { id: null, version: null, hashes: null },
    task: { key: null, bed: null, family: null, unit: null, split: null, cases: null },
    origin: { class: null, group: null }, fidelity: null, evidence: { class: null, K: null },
    verdict: { kind: 'none', pass: null, successes: null, total: null, score: null, censored: false, excluded: false, oracle: { id: null, sha256: null } },
    usd: { run: null, build: null, world: null, upkeep: null, imputed: null, reservedUnsettled: 0, reported: null, repriced: null, bound: null, starts: null, charged: null, observed: null },
    timing: {
      wallMs: null, wallMsBounds: null, timeToFirstEffectMs: null, timeToDoneMs: null, startedAt: null, endedAt: null, stages: null,
      components: { modelMs: null, nonModelMs: null, toolMs: null, mockMs: null, waits: null },
      concurrency: { configured: null, observedMax: null }, businessTime: { simulatedMs: null }, deadline: null,
    },
    envFaults: null, refs: { build: null, setAsideOf: null, supersedes: null, supersededBy: null }, source: { adapter: null, files: [] }, provenance: {},
  };
}

/** Whether a tracked field has a value (null and undefined do not; an empty array or object does: "none observed"). */
export function hasValue(row, field) {
  const v = getPath(row, field);
  if (field === 'verdict') return row.verdict?.kind !== 'none' || row.verdict?.censored === true || row.verdict?.excluded === true;
  return v !== null && v !== undefined;
}

/**
 * Validate one claim row. Returns a list of error strings (empty when valid).
 * opts.modelIds: a Set of allowed model ids (policy/models.json `models[].id` and `judgmentModels[].id`); omitted = not checked.
 */
export function validateClaimRow(row, { modelIds = null } = {}) {
  const e = [];
  const need = (cond, msg) => { if (!cond) e.push(msg); };
  need(row && typeof row === 'object', 'row is not an object');
  if (!row || typeof row !== 'object') return e;
  need(row.schema === SCHEMA_ID, `schema must be ${SCHEMA_ID}`);
  for (const k of ['id', 'experiment', 'arm', 'run']) need(typeof row[k] === 'string' && row[k].length > 0, `${k} must be a non-empty string`);
  need(['derived', 'runner'].includes(row.emitted), 'emitted must be derived or runner');
  need(isInt(row.trial) && row.trial >= 0, 'trial must be an integer >= 0');
  need(ROW_KINDS.includes(row.rowKind), `rowKind must be one of ${ROW_KINDS.join(', ')}`);
  // models
  if (row.models !== null) {
    need(Array.isArray(row.models), 'models must be an array or null');
    for (const m of row.models ?? []) {
      need(MODEL_ROLES.includes(m?.role), `model role ${m?.role} unknown`);
      need(typeof m?.id === 'string', 'model id must be a string');
      if (modelIds && typeof m?.id === 'string') need(modelIds.has(m.id), `model id ${m.id} is not in policy/models.json`);
    }
  }
  // task, origin, evidence
  need(typeof row.task?.key === 'string' && row.task.key.length > 0, 'task.key must be a non-empty string');
  need(typeof row.task?.bed === 'string', 'task.bed must be a string');
  need(UNITS.includes(row.task?.unit), `task.unit must be one of ${UNITS.join(', ')}`);
  need(row.task?.cases === null || (isInt(row.task?.cases) && row.task.cases >= 0), 'task.cases must be a non-negative integer or null');
  need(Object.hasOwn(ORIGIN_GROUPS, row.origin?.class), `origin.class ${row.origin?.class} unknown`);
  need(row.origin?.group === ORIGIN_GROUPS[row.origin?.class], `origin.group must be ${ORIGIN_GROUPS[row.origin?.class]} for ${row.origin?.class}`);
  need(EVIDENCE.includes(row.evidence?.class), `evidence.class must be one of ${EVIDENCE.join(', ')}`);
  need(row.evidence?.K === null || (isInt(row.evidence?.K) && row.evidence.K >= 1), 'evidence.K must be an integer >= 1 or null');
  if (row.fidelity !== null) {
    need(Array.isArray(row.fidelity), 'fidelity must be an array or null');
    for (const f of row.fidelity ?? []) need(f && typeof f.world === 'string' && (f.tier === null || TIERS.includes(f.tier)), `fidelity entry ${JSON.stringify(f)} invalid`);
  }
  // verdict
  const v = row.verdict ?? {};
  need(VERDICT_KINDS.includes(v.kind), `verdict.kind must be one of ${VERDICT_KINDS.join(', ')}`);
  if (v.kind === 'binary') {
    need(typeof v.pass === 'boolean', 'binary verdict needs pass');
    need(v.successes === (v.pass ? 1 : 0) && v.total === 1, 'binary verdict: successes must be pass ? 1 : 0 and total 1');
  }
  if (v.kind === 'count') {
    need(isInt(v.successes) && isInt(v.total) && v.successes >= 0 && v.successes <= v.total, 'count verdict: 0 <= successes <= total, integers');
    need(typeof v.pass === 'boolean', 'count verdict needs pass');
  }
  if (v.kind === 'score') need(isNum(v.score), 'score verdict needs a numeric score');
  if (v.score !== null && v.score !== undefined) need(isNum(v.score), 'verdict.score must be numeric or null');
  if (v.kind === 'none') need(v.pass === null && v.successes === null, 'verdict none carries no pass or successes');
  if (v.kind !== 'none') need(typeof v.oracle?.id === 'string' && v.oracle.id.length > 0, 'a verdict needs an oracle id');
  need(typeof v.censored === 'boolean' && typeof v.excluded === 'boolean', 'verdict.censored and verdict.excluded must be booleans');
  // usd
  const u = row.usd ?? {};
  for (const k of ['run', 'build', 'world', 'upkeep', 'imputed', 'reservedUnsettled', 'reported', 'repriced', 'bound', 'charged'])
    need(u[k] === null || isNonNeg(u[k]), `usd.${k} must be a non-negative number or null`);
  need(u.starts === null || (isInt(u.starts) && u.starts >= 0), 'usd.starts must be a non-negative integer or null');
  need(u.observed === null || typeof u.observed === 'boolean', 'usd.observed must be boolean or null');
  if (isNum(u.charged) && isNum(u.reported)) need(u.charged + 1e-9 >= u.reported, 'usd.charged must be >= usd.reported (the meter never books below what was reported)');
  if (isNum(u.charged) && isNum(u.repriced)) need(u.charged + 1e-9 >= u.repriced, 'usd.charged must be >= usd.repriced');
  if (u.observed === false && isNum(u.bound) && isNum(u.charged) && isInt(u.starts)) need(u.charged + 1e-9 >= u.bound, 'an unobserved row is charged at least its bound');
  // §12: a start with no observed cost is charged at its bound, so it must carry one (a null bound would book it at $0).
  if (u.observed === false) need(isNum(u.bound), 'an unobserved row needs a numeric usd.bound (the meter charges it at its bound)');
  // timing
  const t = row.timing ?? {};
  for (const k of ['wallMs', 'timeToFirstEffectMs', 'timeToDoneMs']) need(t[k] === null || isNonNeg(t[k]), `timing.${k} must be a non-negative number or null`);
  if (t.wallMsBounds !== null) need(t.wallMsBounds && isNonNeg(t.wallMsBounds.lo) && isNonNeg(t.wallMsBounds.hi) && t.wallMsBounds.lo <= t.wallMsBounds.hi, 'timing.wallMsBounds needs 0 <= lo <= hi');
  if (isNum(t.timeToFirstEffectMs) && isNum(t.timeToDoneMs)) need(t.timeToFirstEffectMs <= t.timeToDoneMs + 1e-6, 'time to first effect cannot exceed time to done');
  if (t.stages !== null) {
    need(Array.isArray(t.stages), 'timing.stages must be an array or null');
    for (const s of t.stages ?? []) need(s && typeof s.stage === 'string' && (s.ms === null || isNonNeg(s.ms)), `stage ${JSON.stringify(s)} invalid`);
  }
  const c = t.components ?? {};
  for (const k of ['modelMs', 'nonModelMs', 'toolMs', 'mockMs']) need(c[k] === null || c[k] === undefined || isNonNeg(c[k]), `timing.components.${k} must be non-negative or null`);
  if (c.waits !== null && c.waits !== undefined) for (const k of ['rateLimitMs', 'retryAfterMs', 'queueMs', 'humanMs']) need(c.waits[k] === null || isNonNeg(c.waits[k]), `timing.components.waits.${k} invalid`);
  for (const k of ['configured', 'observedMax']) need(t.concurrency?.[k] === null || (isInt(t.concurrency?.[k]) && t.concurrency[k] >= 1), `timing.concurrency.${k} must be an integer >= 1 or null`);
  need(t.businessTime?.simulatedMs === null || isNonNeg(t.businessTime?.simulatedMs), 'timing.businessTime.simulatedMs must be non-negative or null');
  if (t.deadline !== null && t.deadline !== undefined) need(isNonNeg(t.deadline.ms) && typeof t.deadline.hit === 'boolean', 'timing.deadline needs {ms >= 0, hit: boolean} or null');
  if (row.envFaults !== null) {
    need(Array.isArray(row.envFaults), 'envFaults must be an array or null');
    for (const f of row.envFaults ?? []) need(f && typeof f.code === 'string' && isInt(f.n) && f.n >= 1, `envFault ${JSON.stringify(f)} invalid`);
  }
  if (row.rowKind === 'set-aside') need(v.excluded === true, 'a set-aside row is excluded from outcomes (verdict.excluded)');
  // source
  need(typeof row.source?.adapter === 'string', 'source.adapter must be a string');
  need(Array.isArray(row.source?.files), 'source.files must be an array');
  // provenance: every tracked field of a derived row is accounted for, and value presence agrees with the kind
  if (row.emitted === 'derived') {
    for (const f of TRACKED) {
      const p = row.provenance?.[f];
      if (!p) { e.push(`provenance missing for ${f}`); continue; }
      if (!PROV_KINDS.includes(p.kind)) { e.push(`provenance.${f}.kind ${p.kind} unknown`); continue; }
      const has = hasValue(row, f);
      if (SUPPLIED.includes(p.kind)) need(has, `${f} is marked ${p.kind} but has no value`);
      else need(!has, `${f} is marked ${p.kind} but has a value`);
      if (p.kind === 'missing' || p.kind === 'n/a') need(typeof p.why === 'string' && p.why.length > 0, `${f} (${p.kind}) needs a why`);
      if (p.kind === 'copied' || p.kind === 'code' || p.kind === 'doc') need(typeof p.from === 'string' && p.from.length > 0, `${f} (${p.kind}) needs a from`);
      if (p.kind === 'computed') need(typeof p.rule === 'string' && p.rule.length > 0, `${f} (computed) needs a rule`);
    }
  }
  return e;
}

/** Validate many rows; also checks id uniqueness. Returns [{id, errors}] for the invalid ones. */
export function validateRows(rows, opts = {}) {
  const bad = [], seen = new Map();
  for (const r of rows) {
    const errors = validateClaimRow(r, opts);
    if (seen.has(r?.id)) errors.push(`duplicate id ${r?.id}`);
    seen.set(r?.id, true);
    if (errors.length) bad.push({ id: r?.id ?? null, errors });
  }
  return bad;
}

/** Field coverage over rows: per tracked field, how many rows supply it, by provenance kind. */
export function fieldCoverage(rows) {
  const out = {};
  for (const f of TRACKED) {
    const byKind = Object.fromEntries(PROV_KINDS.map(k => [k, 0]));
    for (const r of rows) byKind[r.provenance?.[f]?.kind ?? (hasValue(r, f) ? 'copied' : 'missing')] += 1;
    const supplied = SUPPLIED.reduce((s, k) => s + byKind[k], 0);
    out[f] = { rows: rows.length, supplied, share: rows.length ? supplied / rows.length : null, byKind };
  }
  return out;
}

/** The model ids the owner policy allows (models, judgment models and executor models). Pass the parsed policy/models.json. */
export function policyModelIds(policy) {
  return new Set([...(policy.models ?? []).map(m => m.id), ...(policy.judgmentModels ?? []).map(m => m.id), ...(policy.executorModels ?? []).map(m => m.id)]);
}
