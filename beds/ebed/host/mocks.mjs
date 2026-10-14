// Typed mock systems of record (BED-CONTRACT-v1.1 §3.3, §3.4; E-BED §2.2, G19). A system is declared as data plus
// small apply functions:
//
//   defineSystem({ id, latencyMinutes, description,
//     tables: { <table>: { pk, fields: { <field>: schema }, computed?: [field], hidden?: true } },
//     ops:    { <op>: { args: schema, keyed, subjectArgs: [arg], reverses?: 'system.op', money?: true,
//                       readOnly?: true, batch?: true (args.items[] applied item by item, each with its own key;
//                       `itemContext: [arg]` names the batch-level args that are part of each item's identity —
//                       a batch envelope such as a run id is not, so an item resubmitted in a new run dedupes),
//                       apply(db, args, ctx) -> result  |  applyItem(db, item, args, ctx) -> result } } })
//
// What a mock does: validate arguments against the op's schema (with any F5 rename active at that time), keyed
// idempotency (a committed key returns its original result and is not applied again; the same key with different
// arguments is `409 key-conflict`, not applied), `status(key)` on every keyed system, referential integrity and
// business-record writes. What it never does: correlate, deduplicate un-keyed calls, enforce a workflow rule (posting a
// held invoice is the arm's mistake to make and the oracle's to grade), compute a deadline or compensate.
//
// Tables may mark product-computed fields (`computed`, Track P strips them from every arm-visible read) and hidden
// tables (`hidden`: mock-internal state such as a fraud verdict list; never readable by an arm).
import { S, schemaProblems, validate, plainCopy } from './schema.mjs';
import { canonical, hashOf } from '../../lib/canonical.mjs';

export class MockError extends Error {
  constructor(code, reason, detail = {}) {
    super(`${code} ${reason}`); this.name = 'MockError'; this.code = code; this.reason = reason; this.detail = detail;
  }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const KEY_SCHEMA = S.str(200, { minLength: 1 });

/** Validate and freeze a system declaration; adds the read-only `status` op to every system with a keyed op. */
export function defineSystem(def) {
  if (!/^[a-z][a-z0-9-]*$/.test(def.id ?? '')) throw new Error(`system id: ${def.id}`);
  const latencyMinutes = def.latencyMinutes ?? 1;
  if (!Number.isInteger(latencyMinutes) || latencyMinutes < 1) throw new Error(`${def.id}: latency must be >= 1 minute (no same-instant results)`);
  const tables = {};
  for (const [name, t] of Object.entries(def.tables ?? {})) {
    if (!t.pk || !isObj(t.fields) || !(t.pk in t.fields)) throw new Error(`${def.id}.${name}: pk must be a declared field`);
    for (const f of t.computed ?? []) if (!(f in t.fields)) throw new Error(`${def.id}.${name}: computed field ${f} not declared`);
    tables[name] = Object.freeze({ pk: t.pk, fields: t.fields, computed: Object.freeze([...(t.computed ?? [])]), hidden: !!t.hidden });
  }
  const ops = {};
  for (const [name, op] of Object.entries(def.ops ?? {})) {
    const problems = schemaProblems(op.args, { root: 'object' });
    if (problems.length) throw new Error(`${def.id}.${name} args: ${problems[0]}`);
    if (op.batch && !(op.args.properties?.items?.type === 'array')) throw new Error(`${def.id}.${name}: batch op needs args.items`);
    if (!op.readOnly && typeof (op.batch ? op.applyItem : op.apply) !== 'function') throw new Error(`${def.id}.${name}: no apply`);
    ops[name] = Object.freeze({ keyed: !!op.keyed, subjectArgs: Object.freeze([...(op.subjectArgs ?? [])]), reverses: op.reverses ?? null,
      money: !!op.money, readOnly: !!op.readOnly, batch: !!op.batch, itemContext: Object.freeze([...(op.itemContext ?? [])]), args: op.args, apply: op.apply, applyItem: op.applyItem,
      description: op.description ?? '' });
  }
  if (Object.values(ops).some(o => o.keyed) && !ops.status) {
    ops.status = Object.freeze({ keyed: false, subjectArgs: Object.freeze([]), reverses: null, money: false, readOnly: true, batch: false,
      args: S.obj({ key: KEY_SCHEMA }), description: 'committed | not-found | pending for an idempotency key (read-only)' });
  }
  return Object.freeze({ id: def.id, description: def.description ?? '', latencyMinutes, tables: Object.freeze(tables), ops: Object.freeze(ops) });
}

/** `schemas.effects` entries for a set of systems (BED-CONTRACT-v1.1 §2): { 'system.op': { args, keyed, subjectArgs, reverses?, readOnly?, money?, batch? } }. */
export function effectSchemas(systems) {
  const out = {};
  for (const sys of systems) for (const [name, op] of Object.entries(sys.ops)) {
    out[`${sys.id}.${name}`] = { args: op.args, keyed: op.keyed, subjectArgs: [...op.subjectArgs], ...(op.reverses ? { reverses: op.reverses } : {}),
      ...(op.readOnly ? { readOnly: true } : {}), ...(op.money ? { money: true } : {}), ...(op.batch ? { batch: true } : {}) };
  }
  return out;
}

/** Arm-visible SoR table schemas (`schemas.sor`): hidden tables omitted; product-computed fields marked. */
export function sorSchemas(systems) {
  const out = {};
  for (const sys of systems) for (const [name, t] of Object.entries(sys.tables)) {
    if (t.hidden) continue;
    out[`${sys.id}.${name}`] = { pk: t.pk, fields: t.fields, computedBy: Object.fromEntries(t.computed.map(f => [f, 'product'])) };
  }
  return out;
}

function applyRename(schema, renames) {
  if (!renames.length) return schema;
  const s = structuredClone(schema);
  for (const { from, to } of renames) {
    // A renamed field lives at the top level of the args or, for batch ops, in the item schema.
    const node = s.properties && from in s.properties ? s
      : s.properties?.items?.items?.properties && from in s.properties.items.items.properties ? s.properties.items.items : null;
    if (!node) continue;
    node.properties[to] = node.properties[from];
    delete node.properties[from];
    if (node.required) node.required = node.required.map(k => (k === from ? to : k));
  }
  return s;
}

/** One running mock system: its tables, its committed keys and its active renames. */
export class MockSystem {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.db = Object.fromEntries(Object.keys(def.tables).map(t => [t, new Map()]));
    this.keys = new Map();       // key -> { op, argsDigest, status, result, atMs }
    this.counters = new Map();
    this.renames = [];           // [{ atMs, op, from, to }] (F5), sorted by time
  }

  addRename(r) { this.renames.push(r); this.renames.sort((a, b) => a.atMs - b.atMs); }
  activeRenames(op, atMs) { return this.renames.filter(r => r.op === op && r.atMs <= atMs); }
  argsSchema(op, atMs) { return applyRename(this.def.ops[op].args, this.activeRenames(op, atMs)); }

  /** The `api/<system>.schema.json` file an arm reads: ops (args with renames active at `atMs`) and visible tables. */
  apiSchema(atMs) {
    const ops = {};
    for (const [name, op] of Object.entries(this.def.ops)) {
      ops[name] = { args: this.argsSchema(name, atMs), keyed: op.keyed, subjectArgs: [...op.subjectArgs], readOnly: op.readOnly,
        batch: op.batch, money: op.money, ...(op.reverses ? { reverses: op.reverses } : {}), description: op.description };
    }
    const tables = {};
    for (const [name, t] of Object.entries(this.def.tables)) if (!t.hidden) tables[name] = { pk: t.pk, fields: t.fields, computedBy: Object.fromEntries(t.computed.map(f => [f, 'product'])) };
    return { system: this.id, latencyMinutes: this.def.latencyMinutes, ops, tables };
  }

  /** Map renamed argument names back to the op's internal names; error 400 naming a retired field. */
  normaliseArgs(op, args, atMs) {
    const renames = this.activeRenames(op, atMs);
    const schema = this.argsSchema(op, atMs);
    const errors = validate(schema, args);
    if (errors.length) {
      const retired = renames.find(r => (isObj(args) && r.from in args) || (Array.isArray(args?.items) && args.items.some(it => isObj(it) && r.from in it)));
      throw new MockError(400, retired ? 'field-renamed' : 'invalid-args', { errors: errors.slice(0, 8), ...(retired ? { field: retired.from, renamedTo: retired.to } : {}) });
    }
    if (!renames.length) return args;
    const back = x => {
      if (!isObj(x)) return x;
      const y = { ...x };
      for (const r of renames) if (r.to in y) { y[r.from] = y[r.to]; delete y[r.to]; }
      return y;
    };
    const out = back(args);
    if (Array.isArray(out.items)) out.items = out.items.map(back);
    return out;
  }

  keyStatus(key, pending) {
    if (this.keys.has(key)) return 'committed';
    if (pending?.has(`${this.id}\u0000${key}`)) return 'pending';
    return 'not-found';
  }

  #txn(touched) {
    const staged = new Map();     // `${table}\u0000${pk}` -> { name, pk, row }
    const sys = this;
    const k = (table, pk) => `${table}\u0000${typeof pk}:${pk}`;
    const table = name => { if (!sys.db[name]) throw new MockError(500, `no table ${name}`); return sys.db[name]; };
    const api = {
      get(name, pk) { const kk = k(name, pk); if (staged.has(kk)) return structuredClone(staged.get(kk).row); const r = table(name).get(pk); return r ? structuredClone(r) : null; },
      has(name, pk) { return api.get(name, pk) !== null; },
      insert(name, row) {
        const pk = row[sys.def.tables[name].pk];
        if (pk === undefined || pk === null) throw new MockError(400, 'missing-id', { table: name });
        if (api.has(name, pk)) throw new MockError(409, 'exists', { table: name, id: pk });
        staged.set(k(name, pk), { name, pk, row: structuredClone(row) }); touched.push([name, pk]); return pk;
      },
      update(name, pk, fields) {
        const cur = api.get(name, pk);
        if (!cur) throw new MockError(404, 'not-found', { table: name, id: pk });
        staged.set(k(name, pk), { name, pk, row: { ...cur, ...structuredClone(fields) } }); touched.push([name, pk]); return pk;
      },
      upsert(name, row) { const pk = row[sys.def.tables[name].pk]; staged.set(k(name, pk), { name, pk, row: structuredClone(row) }); touched.push([name, pk]); return pk; },
      require(name, pk) { const r = api.get(name, pk); if (!r) throw new MockError(404, 'not-found', { table: name, id: pk }); return r; },
      nextId(prefix) { const n = (sys.counters.get(prefix) ?? 0) + 1; sys.counters.set(prefix, n); return `${prefix}${String(n).padStart(6, '0')}`; },
      rows(name) { return [...table(name).values()].map(r => structuredClone(r)); },
    };
    const flush = () => { for (const { name, pk, row } of staged.values()) table(name).set(pk, row); };
    return { api, flush };
  }

  /**
   * Apply one (non-batch) op. Returns { applied, committed, status, result?, error?, touched, deduped? }.
   * `fault`: an injected behaviour decided by the host ('F1'|'F2'|'F3'|'F6' or null).
   */
  apply(op, rawArgs, key, atMs, { fault = null, ctx = {} } = {}) {
    const r = this.#apply(op, rawArgs, key, atMs, { fault, ctx });
    // F3: the request reached the system (and committed if it could) but the caller learns nothing about the outcome.
    return fault === 'F3' ? { ...r, status: 'unknown', result: undefined, error: { code: 'timeout', reason: 'timeout-after-commit' } } : r;
  }

  #apply(op, rawArgs, key, atMs, { fault = null, ctx = {} } = {}) {
    const def = this.def.ops[op];
    if (!def) return { applied: false, committed: false, status: 'error', error: { code: 404, reason: 'unknown-op' }, touched: [] };
    const touched = [];
    // Transport-level faults come first: the request never reaches the system (F1, F2, F6).
    if (fault === 'F1') return { applied: false, committed: false, status: 'rate-limited', error: { code: 429, reason: 'rate-limited' }, touched };
    if (fault === 'F2') return { applied: false, committed: false, status: 'error', error: { code: 503, reason: 'unavailable', retryable: true }, touched };
    if (fault === 'F6') return { applied: false, committed: false, status: 'error', error: { code: 'permanent', reason: 'permanent-failure', retryable: false }, touched };
    let args;
    try { args = this.normaliseArgs(op, rawArgs, atMs); }
    catch (e) { return { applied: false, committed: false, status: 'error', error: { code: e.code, reason: e.reason, ...e.detail }, touched }; }
    const argsDigest = hashOf(args);
    if (def.keyed && key != null && this.keys.has(key)) {
      const prior = this.keys.get(key);
      if (prior.op !== op || prior.argsDigest !== argsDigest) return { applied: false, committed: false, status: 'error', error: { code: 409, reason: 'key-conflict' }, touched };
      return { applied: false, committed: false, deduped: true, status: prior.status, result: structuredClone(prior.result), touched };
    }
    const { api, flush } = this.#txn(touched);
    let result;
    try { result = def.apply(api, args, { ...ctx, atMs, key }); }
    catch (e) {
      if (!(e instanceof MockError)) throw e;
      return { applied: false, committed: false, status: 'error', error: { code: e.code, reason: e.reason, ...e.detail }, touched: [] };
    }
    flush();
    result = plainCopy(result ?? {}) ?? {};
    if (def.keyed && key != null) this.keys.set(key, { op, argsDigest, status: 'ok', result, atMs });
    return { applied: true, committed: true, status: 'ok', result, touched };
  }

  /** The identity of one batch item: the item plus the batch-level args the op declares as its context. */
  itemDigest(op, item, batchArgs) {
    const def = this.def.ops[op];
    return hashOf({ item, context: Object.fromEntries(def.itemContext.map(k => [k, batchArgs?.[k] ?? null])) });
  }

  /** Apply one item of a batch op (each item carries its own key). Same return shape as apply(). */
  applyItem(op, item, batchArgs, key, atMs, { fault = null, ctx = {} } = {}) {
    const def = this.def.ops[op];
    const touched = [];
    if (fault === 'F4') return { applied: false, committed: false, status: 'error', error: { code: 503, reason: 'batch-item-not-processed', retryable: true }, touched };
    const argsDigest = this.itemDigest(op, item, batchArgs);
    if (def.keyed && key != null && this.keys.has(key)) {
      const prior = this.keys.get(key);
      if (prior.op !== op || prior.argsDigest !== argsDigest) return { applied: false, committed: false, status: 'error', error: { code: 409, reason: 'key-conflict' }, touched };
      return { applied: false, committed: false, deduped: true, status: prior.status, result: structuredClone(prior.result), touched };
    }
    const { api, flush } = this.#txn(touched);
    let result;
    try { result = def.applyItem(api, item, batchArgs, { ...ctx, atMs, key }); }
    catch (e) {
      if (!(e instanceof MockError)) throw e;
      return { applied: false, committed: false, status: 'error', error: { code: e.code, reason: e.reason, ...e.detail }, touched: [] };
    }
    flush();
    result = plainCopy(result ?? {}) ?? {};
    if (def.keyed && key != null) this.keys.set(key, { op, argsDigest, status: 'ok', result, atMs });
    return { applied: true, committed: true, status: 'ok', result, touched };
  }

  /** Read-only ops: status(key) and declared `readOnly` ops (they never enter the ledger). */
  read(op, rawArgs, atMs, pending) {
    const def = this.def.ops[op];
    if (!def?.readOnly) return { status: 'error', error: { code: 404, reason: 'unknown-op' } };
    let args;
    try { args = this.normaliseArgs(op, rawArgs, atMs); }
    catch (e) { return { status: 'error', error: { code: e.code, reason: e.reason, ...e.detail } }; }
    if (op === 'status' && !def.apply) return { status: 'ok', result: { key: args.key, status: this.keyStatus(args.key, pending) } };
    const { api } = this.#txn([]);
    try { return { status: 'ok', result: plainCopy(def.apply(api, args, { atMs })) ?? {} }; }
    catch (e) { if (!(e instanceof MockError)) throw e; return { status: 'error', error: { code: e.code, reason: e.reason, ...e.detail } }; }
  }

  /** World and product writes (journaled by the host as world.write / product.write, never as arm effects). */
  write(table, row) {
    const t = this.def.tables[table];
    if (!t) throw new Error(`${this.id}: no table ${table}`);
    const pk = row[t.pk];
    if (pk === undefined || pk === null) throw new Error(`${this.id}.${table}: row without ${t.pk}`);
    this.db[table].set(pk, structuredClone(row));
    return pk;
  }

  /** Arm-visible copy of a row: hidden tables never, product-computed fields only when `includeComputed`. */
  visible(table, row, includeComputed) {
    const t = this.def.tables[table];
    if (t.hidden) return null;
    if (includeComputed || !t.computed.length) return structuredClone(row);
    const out = { ...row };
    for (const f of t.computed) delete out[f];
    return structuredClone(out);
  }

  get(table, pk, includeComputed = false) {
    const row = this.db[table]?.get(pk);
    return row ? this.visible(table, row, includeComputed) : null;
  }

  /** sor.query(table, { where: { field: value | { gte, lte, in } }, limit <= 1000 }): sorted by primary key. */
  query(table, { where = {}, limit = 1000 } = {}, includeComputed = false) {
    const t = this.def.tables[table];
    if (!t || t.hidden) throw new MockError(404, 'no-such-table', { table });
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new MockError(400, 'bad-limit');
    if (!isObj(where)) throw new MockError(400, 'bad-where');
    const pass = row => Object.entries(where).every(([f, cond]) => {
      if (!includeComputed && t.computed.includes(f)) return false;
      const v = row[f];
      if (isObj(cond)) {
        if ('in' in cond && !(Array.isArray(cond.in) && cond.in.some(x => canonical(x) === canonical(v)))) return false;
        if ('gte' in cond && !(v !== undefined && v !== null && v >= cond.gte)) return false;
        if ('lte' in cond && !(v !== undefined && v !== null && v <= cond.lte)) return false;
        return true;
      }
      return canonical(v ?? null) === canonical(cond);
    });
    const keys = [...this.db[table].keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out = [];
    for (const k of keys) {
      const row = this.db[table].get(k);
      if (pass(row)) out.push(this.visible(table, row, includeComputed));
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Full state (all tables, keys, counters) for the SoR digest and replay checks. */
  state() {
    const tables = {};
    for (const [name, m] of Object.entries(this.db)) tables[name] = [...m.keys()].sort().map(k => m.get(k));
    const keys = [...this.keys.keys()].sort().map(k => [k, this.keys.get(k)]);
    return { tables, keys, counters: [...this.counters.entries()].sort() };
  }
}
