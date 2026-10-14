// Cross-run keyed state (L0 row 27; E3 engine column step 1): durable state that the runs of one workflow share, such as a
// seen-set, a cursor, a counter or a keyed record.
//
// Declared at the top of the workflow (`state: {<slot>: {type, writer, maxItems, ...}}`) and read or written by `state` nodes
// (`{kind: "state", slot, op, key, value?, by?, ifVersion?}`). The rules:
//   - Scope. A slot belongs to the workflow id: every version of that workflow shares it; no other workflow can name it.
//   - One writer. Statically, only the node the slot declares as its `writer` writes it (or each of a short list of nodes, such as
//     an upsert and an expiry), from one place in the workflow (validate.mjs). At run time every key has a version (the slot
//     revision of its last write; 0 when absent, deleted or expired) and every write runs in one IMMEDIATE transaction, so
//     concurrent writers serialize. A write that names `ifVersion` is a compare-and-swap: a stale version is refused with the
//     typed error STATE_VERSION_CONFLICT and writes nothing. `put` (an overwrite) must name it, so of two writers that read the
//     same version of a key only one can write it; add, incr and delete are atomic read-modify-writes and may name it.
//   - Bounded. maxItems live keys (required), maxValueBytes per value and maxBytes per slot; a write that would pass a bound is
//     refused (STATE_FULL, STATE_VALUE_LIMIT) after expired entries are purged.
//   - Typed. Record and cursor values are checked against the slot's JSON schema (STATE_SCHEMA); counters are safe integers;
//     keys are non-empty, well-formed (no lone surrogate) strings of at most 512 bytes (STATE_KEY). A monotonic cursor refuses to
//     move back (STATE_CURSOR_REGRESSION) in its declared `order`: "number" (the default; finite numbers) or "instant" (ISO 8601
//     date-times with an explicit offset, compared as instants). It is never deleted and never expires, so it cannot be reset.
//     A value read back that no longer satisfies its schema is STATE_CORRUPT (the table was edited).
//   - TTL. With ttlMs (or ttlDays) every write sets expiresAt = now + ttl; an entry at or past it reads as absent (version 0).
//     `now` is the runtime's clock (Runtime option `now`), so expiry can be tested under simulated time.
//   - Journaled. Every operation, read or write, accepted or refused, is a row of state_ops written in the same transaction as
//     the state change and the node's outcome, and the row's hash is bound into the run's chain (`state.op`). A crash therefore
//     either loses the whole operation or keeps all of it. A replay run (modelMode "replay") serves each operation from the
//     recorded row with the same replay key (salt, node key, request, which names the slot's declaration hash) and writes no
//     state; a missing row is REPLAY_MISS. An argument beyond its bound (a value over maxValueBytes) is journaled by its sha256
//     and size, and the journal bytes of a run count against its state budget (runtime.mjs).
//   - Drift. A slot records the hash of what its entries mean: the declaration's semantics (type, schema, label, monotonic,
//     order) and its writers (the writer ids and each writer node's definition, description aside), so the one-writer rule holds
//     across the versions of a workflow that share the slot. A run whose declaration differs is refused (STATE_DRIFT) while the
//     slot holds live entries; an empty slot adopts the new declaration.
//
// The integrity label of the slot (`label`, default trusted) is what a read of it carries; a write whose data or control is
// labelled beyond it is refused (validate.mjs statically, the runtime again), so cross-run state cannot launder taint.
import { canonical, checkData, digest, FoundryError } from './data.mjs';
import { sha256 } from './audit.mjs';

export const STATE_TYPES = Object.freeze(['set', 'counter', 'cursor', 'record']);
export const STATE_READS = Object.freeze(['get']);
export const STATE_WRITES = Object.freeze(['put', 'add', 'incr', 'delete']);
export const STATE_OPS = Object.freeze({
  set: Object.freeze(['get', 'add', 'delete']),
  counter: Object.freeze(['get', 'incr', 'put', 'delete']),
  cursor: Object.freeze(['get', 'put', 'delete']),
  record: Object.freeze(['get', 'put', 'delete'])
});
export const STATE_ARGS = Object.freeze(['key', 'value', 'by', 'ifVersion']);
export const isStateWrite = op => STATE_WRITES.includes(op);
// Refusals are outcomes of the operation: journaled, replayed, and handled by onError "continue". STATE_DRIFT and STATE_CORRUPT
// are integrity faults of the store or the deployment, not of the data: they are thrown, never journaled, never handled.
export const STATE_REFUSALS = Object.freeze(['STATE_VERSION_CONFLICT', 'STATE_FULL', 'STATE_VALUE_LIMIT', 'STATE_SCHEMA', 'STATE_KEY', 'STATE_CURSOR_REGRESSION']);
export const STATE_FAULTS = Object.freeze(['STATE_DRIFT', 'STATE_CORRUPT']);
export const STATE_LIMITS = Object.freeze({
  keyBytes: 512, defaultValueBytes: 64 * 1024, maxValueBytes: 256 * 1024, slotBytes: 64 * 1024 * 1024, maxItems: 1000000, slots: 32,
  // Expired entries purged by each write in passing (all of them when a bound would otherwise refuse the write).
  purgeBatch: 64
});
const DAY_MS = 86400000;

/** The orders a monotonic cursor compares in ("number" is the default). */
export const CURSOR_ORDERS = Object.freeze(['number', 'instant']);
/** A slot declaration by name: own properties only, so a node naming `toString` finds no slot. */
export const slotOf = (workflow, name) => typeof name === 'string' && workflow?.state && Object.hasOwn(workflow.state, name) ? workflow.state[name] : undefined;
/** The slot declaration with its defaults: {type, writer, maxItems, maxValueBytes, maxBytes, ttlMs, schema, monotonic, order, label}. */
export function slotDeclaration(decl) {
  const ttlMs = decl.ttlMs ?? (decl.ttlDays !== undefined ? decl.ttlDays * DAY_MS : null), monotonic = decl.monotonic === true;
  return { type: decl.type, writer: decl.writer, maxItems: decl.maxItems, maxValueBytes: decl.maxValueBytes ?? STATE_LIMITS.defaultValueBytes,
    maxBytes: decl.maxBytes ?? STATE_LIMITS.slotBytes, ttlMs, schema: decl.schema ?? null, monotonic, order: monotonic ? decl.order ?? 'number' : null, label: decl.label ?? 'trusted' };
}
/**
 * The writer nodes of a slot as the workflow defines them (every state node that writes it, at any depth), without their descriptions,
 * ordered by id. They are part of what the slot's entries mean: a version of the workflow whose writers differ is another writer.
 */
export function slotWriters(workflow, name) {
  const found = [];
  const walk = flow => {
    for (const node of flow?.nodes ?? []) {
      if (node.kind === 'state' && node.slot === name && isStateWrite(node.op)) { const { description, ...definition } = node; found.push(definition); }
      if (node.body) walk(node.body);
    }
  };
  walk(workflow);
  return found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/**
 * What a stored entry means: changing any of these changes how existing entries must be read, or who may have written them. Bounds and
 * TTL may change. `writers` are the slot's writer nodes (slotWriters).
 */
export const declarationHash = (decl, writers = []) => digest({ v: 2, type: decl.type, schema: decl.schema ?? null, monotonic: decl.monotonic === true,
  order: decl.monotonic === true ? decl.order ?? 'number' : null, label: decl.label ?? 'trusted', writer: [decl.writer ?? []].flat().sort(), writers: writers.map(node => digest(node)) });
/** The declaration hash of a slot of a workflow: its declaration and its writers. */
export const slotIdentity = (workflow, name) => declarationHash(slotOf(workflow, name), slotWriters(workflow, name));

/** The JSON schema of a state node's output (dataflow.mjs), for one slot type and operation. */
export function stateOutputSchema(decl, op) {
  const record = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });
  const integer = { type: 'integer' }, boolean = { type: 'boolean' };
  if (!decl) return {};
  if (op === 'get') {
    const value = decl.type === 'counter' ? integer : decl.type === 'set' ? undefined : decl.schema ?? {};
    return record({ found: boolean, version: integer, expiresAt: integer, ...(value ? { value } : {}) }, decl.type === 'counter' ? ['found', 'version', 'value'] : ['found', 'version']);
  }
  if (op === 'add') return record({ added: boolean, version: integer }, ['added', 'version']);
  if (op === 'incr') return record({ value: integer, version: integer, previousVersion: integer }, ['value', 'version', 'previousVersion']);
  if (op === 'put') return record({ version: integer, previousVersion: integer, changed: boolean }, ['version', 'previousVersion', 'changed']);
  if (op === 'delete') return record({ deleted: boolean, previousVersion: integer }, ['deleted', 'previousVersion']);
  return {};
}

/**
 * The request an operation is replayed under: the workflow, slot, the slot's declaration hash (slotIdentity: a replay of a version whose
 * declaration or writers differ misses instead of being served entries that version could not read), the operation and its resolved arguments.
 */
export function stateRequest(workflowId, slot, op, args, declHash) {
  if (typeof declHash !== 'string' || !/^[0-9a-f]{64}$/.test(declHash)) throw new FoundryError('STATE_OP', 'A state request names its slot declaration hash');
  const request = { workflowId, slot, declHash, op };
  for (const name of STATE_ARGS) if (args[name] !== undefined) request[name] = args[name];
  return checkData(request, { maxBytes: 4 * 1024 * 1024 });
}
export const stateReplayKey = ({ salt, nodeKey, request }) => digest({ v: 1, salt, nodeKey, request });
// The journal keeps an argument whole up to its bound: a value up to the slot's maxValueBytes (the size a stored value may have), any other
// argument up to 4 KiB (a valid key is at most 512 bytes, about 3 KiB as escaped JSON). Beyond it, the argument is journaled by its sha256
// and size: such an argument is always refused, and the replay key still binds it whole.
const ARG_JOURNAL_BYTES = 4096;
/** The form of a request that state_ops stores (see above). `rawDecl` is the slot declaration. */
export function journalRequest(request, rawDecl) {
  const decl = slotDeclaration(rawDecl), out = { ...request };
  for (const name of STATE_ARGS) {
    if (out[name] === undefined) continue;
    const text = canonical(out[name]), bytes = bytesOf(text);
    if (bytes > (name === 'value' ? decl.maxValueBytes : ARG_JOURNAL_BYTES)) out[name] = { $elided: { sha256: sha256(text), bytes } };
  }
  return out;
}

// The columns of a state_ops row that its hash binds (the request and result texts by their own hashes).
const OP_COLUMNS = Object.freeze(['id', 'replay_key', 'run_id', 'node_key', 'workflow_id', 'slot', 'op', 'ok', 'error_code', 'at', 'replayed_from', 'created_at']);
/** The hash a `state.op` chain event binds for one state_ops row, computed from the row as stored. */
export const stateOpHash = raw => digest({ v: 1, ...Object.fromEntries(OP_COLUMNS.map(column => [column, raw[column] ?? null])),
  request: raw.request == null ? null : sha256(raw.request), result: raw.result == null ? null : sha256(raw.result) });

export function installStateTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS state_slots(workflow_id TEXT NOT NULL, slot TEXT NOT NULL, decl_hash TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
      items INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(workflow_id, slot));
    CREATE TABLE IF NOT EXISTS state_entries(workflow_id TEXT NOT NULL, slot TEXT NOT NULL, key TEXT NOT NULL, value TEXT, version INTEGER NOT NULL,
      expires_at INTEGER, bytes INTEGER NOT NULL, run_id TEXT NOT NULL, node_key TEXT NOT NULL, written_at INTEGER NOT NULL, PRIMARY KEY(workflow_id, slot, key));
    CREATE INDEX IF NOT EXISTS state_entries_expiry ON state_entries(workflow_id, slot, expires_at) WHERE expires_at IS NOT NULL;
    CREATE TABLE IF NOT EXISTS state_ops(id INTEGER PRIMARY KEY, replay_key TEXT NOT NULL, run_id TEXT NOT NULL, node_key TEXT NOT NULL, workflow_id TEXT NOT NULL,
      slot TEXT NOT NULL, op TEXT NOT NULL, request TEXT NOT NULL, result TEXT NOT NULL, ok INTEGER NOT NULL, error_code TEXT, at INTEGER NOT NULL,
      replayed_from INTEGER, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS state_ops_replay ON state_ops(replay_key, id) WHERE replayed_from IS NULL;
    CREATE INDEX IF NOT EXISTS state_ops_run ON state_ops(run_id, id);`);
}

// An ISO 8601 date-time with an explicit offset (Z or ±hh:mm), seconds and up to 9 fraction digits optional; every field is range-checked.
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;
/** The instant an ISO 8601 date-time with an explicit offset names, in nanoseconds since the epoch (a BigInt), or null. */
export function instantNanos(text) {
  const m = typeof text === 'string' && text.length <= 64 ? INSTANT.exec(text) : null;
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(v => v === undefined ? 0 : Number(v));
  const utc = new Date(0);
  utc.setUTCFullYear(year, month, 0); // the last day of `month` (setUTCFullYear has no two-digit-year mapping)
  const days = utc.getUTCDate();
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59 || (m[8] !== 'Z' && (Number(m[10]) > 23 || Number(m[11]) > 59))) return null;
  const offset = m[8] === 'Z' ? 0 : (m[9] === '-' ? -1 : 1) * (Number(m[10]) * 60 + Number(m[11]));
  utc.setUTCFullYear(year, month - 1, day);
  utc.setUTCHours(hour, minute, second, 0);
  return BigInt(utc.getTime() - offset * 60000) * 1000000n + BigInt((m[7] ?? '').padEnd(9, '0'));
}
// Where a monotonic cursor value sits in its order (comparable with <), or null when it is not a value of that order.
const cursorPosition = (order, value) => order === 'instant' ? instantNanos(value) : typeof value === 'number' && Number.isFinite(value) ? value : null;
const refusal = (code, message, details = {}) => ({ ok: false, error: { code, message, details } });
const bytesOf = text => text == null ? 0 : Buffer.byteLength(text);
const live = (entry, now) => !!entry && (entry.expires_at === null || entry.expires_at > now);
const opRow = raw => raw ? { id: raw.id, replayKey: raw.replay_key, runId: raw.run_id, nodeKey: raw.node_key, workflowId: raw.workflow_id, slot: raw.slot, op: raw.op,
  request: JSON.parse(raw.request), result: JSON.parse(raw.result), ok: raw.ok === 1, errorCode: raw.error_code, at: raw.at, replayedFrom: raw.replayed_from, createdAt: raw.created_at } : null;
const entryRow = raw => ({ key: raw.key, value: raw.value === null ? undefined : JSON.parse(raw.value), version: raw.version, expiresAt: raw.expires_at,
  bytes: raw.bytes, runId: raw.run_id, nodeKey: raw.node_key, writtenAt: raw.written_at });

/**
 * The state tables of one Store. `apply` and `record` write; they must run inside the caller's IMMEDIATE transaction (the runtime calls them
 * from the run's compare-and-swap update, so the state change, its journal row, the node outcome and the chain event commit together).
 */
export class StateStore {
  constructor(store) { this.store = store; }
  stmt(sql) { return this.store.rows.stmt(sql); }
  #requireTransaction() { if (!this.store.db.isTransaction) throw new FoundryError('STATE_TRANSACTION', 'State writes run inside the run update transaction'); }

  /**
   * Perform one operation live. `decl` is the slot declaration as written in the workflow; `request` comes from stateRequest; `check(schema,
   * value)` throws when a value does not satisfy a schema; `now` is the operation time (ms). Returns {ok: true, output} or a refusal
   * {ok: false, error: {code, message, details}}. Throws STATE_DRIFT or STATE_CORRUPT (nothing is then written: the caller's transaction rolls back).
   */
  apply(rawDecl, request, { now, runId, nodeKey, check }) {
    this.#requireTransaction();
    if (!Number.isSafeInteger(now) || now < 0) throw new FoundryError('STATE_CLOCK', 'The state clock must return a non-negative integer of milliseconds');
    const decl = slotDeclaration(rawDecl), { workflowId: wf, slot: name, op, key, declHash } = request;
    if (!STATE_OPS[decl.type]?.includes(op)) throw new FoundryError('STATE_OP', `${op} is not an operation of a ${decl.type} slot`);
    // A monotonic cursor is never reset: no delete, no expiry (validate.mjs refuses both statically).
    if (decl.monotonic && (op === 'delete' || decl.ttlMs !== null)) throw new FoundryError('STATE_OP', `Slot ${name} is a monotonic cursor: it is never deleted and never expires`);
    if (decl.monotonic && !CURSOR_ORDERS.includes(decl.order)) throw new FoundryError('STATE_OP', `Slot ${name} declares an unknown cursor order`);
    if (typeof declHash !== 'string') throw new FoundryError('STATE_OP', 'A state request names its slot declaration hash');
    this.#slot(wf, name, declHash, now);
    // Lone surrogates are refused: SQLite stores them as U+FFFD, so distinct keys would share one entry.
    if (typeof key !== 'string' || !key.length || !key.isWellFormed() || bytesOf(key) > STATE_LIMITS.keyBytes)
      return refusal('STATE_KEY', `A state key is a non-empty, well-formed string of at most ${STATE_LIMITS.keyBytes} bytes`, { slot: name, type: typeof key });
    const raw = this.stmt('SELECT * FROM state_entries WHERE workflow_id=? AND slot=? AND key=?').get(wf, name, key);
    const present = live(raw, now), current = present ? raw.version : 0;
    const stored = () => {
      if (!present || raw.value === null) return undefined;
      let value;
      try { value = JSON.parse(raw.value); } catch { throw new FoundryError('STATE_CORRUPT', `A stored value of slot ${name} is not JSON: the state table was edited`, { slot: name }); }
      const fault = this.#valueFault(decl, value, check);
      if (fault) throw new FoundryError('STATE_CORRUPT', `A stored value of slot ${name} no longer satisfies the slot's ${decl.type === 'counter' ? 'integer type' : 'schema'}: the state table was edited`, { slot: name, reason: fault });
      return value;
    };
    if (op === 'get') {
      const output = { found: present, version: current };
      if (decl.type === 'counter') output.value = present ? stored() : 0;
      else if (decl.type !== 'set' && present) output.value = stored();
      if (present && raw.expires_at !== null) output.expiresAt = raw.expires_at;
      return { ok: true, output };
    }
    if (request.ifVersion !== undefined && (!Number.isSafeInteger(request.ifVersion) || request.ifVersion < 0))
      return refusal('STATE_SCHEMA', 'ifVersion must be a non-negative integer (0: the key must be absent)', { slot: name });
    if (request.ifVersion !== undefined && request.ifVersion !== current)
      return refusal('STATE_VERSION_CONFLICT', `The key is at version ${current} of slot ${name}, not the expected ${request.ifVersion}: another writer changed it first`, { slot: name, expected: request.ifVersion, actual: current });
    this.#purge(wf, name, now, STATE_LIMITS.purgeBatch);
    if (op === 'delete') {
      if (!raw) return { ok: true, output: { deleted: false, previousVersion: 0 } };
      const fresh = this.stmt('SELECT bytes FROM state_entries WHERE workflow_id=? AND slot=? AND key=?').get(wf, name, key);
      if (!fresh) return { ok: true, output: { deleted: false, previousVersion: 0 } }; // the purge above removed the expired entry
      this.#change(wf, name, -1, -fresh.bytes, now);
      this.stmt('DELETE FROM state_entries WHERE workflow_id=? AND slot=? AND key=?').run(wf, name, key);
      return { ok: true, output: { deleted: present, previousVersion: current } };
    }
    if (op === 'add' && present) return { ok: true, output: { added: false, version: current } };
    let value = null;
    if (op === 'incr') {
      const by = request.by ?? 1;
      if (!Number.isSafeInteger(by)) return refusal('STATE_SCHEMA', 'A counter increment is a safe integer', { slot: name });
      const next = (present ? stored() : 0) + by;
      if (!Number.isSafeInteger(next)) return refusal('STATE_SCHEMA', `A counter of slot ${name} would leave the safe integer range`, { slot: name, reason: 'overflow' });
      value = next;
    } else if (op === 'put') {
      value = request.value;
      if (value === undefined) return refusal('STATE_SCHEMA', 'put needs a value', { slot: name });
      const fault = this.#valueFault(decl, value, check);
      if (fault) return refusal('STATE_SCHEMA', `The value does not satisfy the ${decl.type === 'counter' ? 'counter type' : `schema of slot ${name}`}`, { slot: name, reason: fault });
      if (decl.type === 'cursor' && decl.monotonic) {
        const position = cursorPosition(decl.order, value);
        if (position === null) return refusal('STATE_SCHEMA', `A monotonic cursor of slot ${name} holds ${decl.order === 'instant' ? 'ISO 8601 date-times with an explicit offset' : 'finite numbers'}`, { slot: name, order: decl.order });
        if (present) {
          const before = cursorPosition(decl.order, stored());
          if (before === null) throw new FoundryError('STATE_CORRUPT', `A stored position of monotonic cursor ${name} is not in its order: the state table was edited`, { slot: name });
          if (position < before) return refusal('STATE_CURSOR_REGRESSION', `A monotonic cursor of slot ${name} cannot move back`, { slot: name, version: current });
        }
      }
    }
    const text = op === 'add' ? null : canonical(value);
    if (text !== null && bytesOf(text) > decl.maxValueBytes) return refusal('STATE_VALUE_LIMIT', `The value is ${bytesOf(text)} bytes; slot ${name} holds values of at most ${decl.maxValueBytes} bytes`, { slot: name, bytes: bytesOf(text), limit: decl.maxValueBytes });
    const size = bytesOf(key) + bytesOf(text);
    // The row this write replaces (an expired one is replaced in place), as it is now (the purge may have removed it).
    const prior = this.stmt('SELECT version, bytes FROM state_entries WHERE workflow_id=? AND slot=? AND key=?').get(wf, name, key);
    const fits = () => {
      const at = this.stmt('SELECT items, bytes FROM state_slots WHERE workflow_id=? AND slot=?').get(wf, name);
      const items = at.items + (prior ? 0 : 1), bytes = at.bytes - (prior?.bytes ?? 0) + size;
      if (items > decl.maxItems) return { bound: 'maxItems', limit: decl.maxItems, items };
      if (bytes > decl.maxBytes) return { bound: 'maxBytes', limit: decl.maxBytes, bytes };
      return null;
    };
    let over = fits();
    if (over) { this.#purge(wf, name, now, Infinity); over = fits(); }
    if (over) return refusal('STATE_FULL', `Slot ${name} is full (${over.bound} ${over.limit})`, { slot: name, ...over });
    const version = this.#change(wf, name, prior ? 0 : 1, size - (prior?.bytes ?? 0), now), expiresAt = decl.ttlMs === null ? null : now + decl.ttlMs;
    if (prior) {
      if (this.stmt('UPDATE state_entries SET value=?, version=?, expires_at=?, bytes=?, run_id=?, node_key=?, written_at=? WHERE workflow_id=? AND slot=? AND key=? AND version=?')
        .run(text, version, expiresAt, size, runId, nodeKey, now, wf, name, key, prior.version).changes !== 1) throw new FoundryError('STATE_CONFLICT', 'A state entry changed inside its own write transaction');
    } else this.stmt('INSERT INTO state_entries(workflow_id, slot, key, value, version, expires_at, bytes, run_id, node_key, written_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(wf, name, key, text, version, expiresAt, size, runId, nodeKey, now);
    if (op === 'add') return { ok: true, output: { added: true, version } };
    if (op === 'incr') return { ok: true, output: { value, version, previousVersion: current } };
    return { ok: true, output: { version, previousVersion: current, changed: !present || raw.value !== text } };
  }
  // Why a value does not fit the slot, or null.
  #valueFault(decl, value, check) {
    if (decl.type === 'counter') return Number.isSafeInteger(value) ? null : 'a counter holds a safe integer';
    try { checkData(value); check(decl.schema, value); return null; }
    catch (error) { return String(error.code ?? error.message ?? 'invalid').slice(0, 200); }
  }
  // The slot row, created on first use; a changed declaration (slotIdentity) is adopted only while the slot holds no live entry.
  #slot(wf, name, declHash, now) {
    let slot = this.stmt('SELECT * FROM state_slots WHERE workflow_id=? AND slot=?').get(wf, name);
    if (!slot) {
      this.stmt('INSERT INTO state_slots(workflow_id, slot, decl_hash, revision, items, bytes, updated_at) VALUES(?,?,?,0,0,0,?)').run(wf, name, declHash, now);
      return this.stmt('SELECT * FROM state_slots WHERE workflow_id=? AND slot=?').get(wf, name);
    }
    if (slot.decl_hash !== declHash) {
      this.#purge(wf, name, now, Infinity);
      slot = this.stmt('SELECT * FROM state_slots WHERE workflow_id=? AND slot=?').get(wf, name);
      if (slot.items > 0) throw new FoundryError('STATE_DRIFT', `Slot ${name} of workflow ${wf} holds ${slot.items} entries written under another declaration (its type, schema, label, monotonic order or writers changed); migrate or empty it before this declaration can use it`, { slot: name, items: slot.items });
      this.stmt('UPDATE state_slots SET decl_hash=?, updated_at=? WHERE workflow_id=? AND slot=?').run(declHash, now, wf, name);
    }
    return slot;
  }
  // Bump the slot revision and its counters (compare-and-swap on the revision read); returns the new revision.
  #change(wf, name, items, bytes, now) {
    const slot = this.stmt('SELECT revision, items, bytes FROM state_slots WHERE workflow_id=? AND slot=?').get(wf, name);
    if (this.stmt('UPDATE state_slots SET revision=revision+1, items=?, bytes=?, updated_at=? WHERE workflow_id=? AND slot=? AND revision=?')
      .run(slot.items + items, slot.bytes + bytes, now, wf, name, slot.revision).changes !== 1) throw new FoundryError('STATE_CONFLICT', 'A state slot changed inside its own write transaction');
    return slot.revision + 1;
  }
  // Remove up to `limit` expired entries and keep the slot counters exact. Expired entries already read as absent; this only frees room.
  #purge(wf, name, now, limit) {
    const expired = this.stmt('SELECT key, bytes FROM state_entries WHERE workflow_id=? AND slot=? AND expires_at IS NOT NULL AND expires_at<=? ORDER BY expires_at LIMIT ?')
      .all(wf, name, now, Number.isFinite(limit) ? limit : -1);
    if (!expired.length) return 0;
    for (const row of expired) this.stmt('DELETE FROM state_entries WHERE workflow_id=? AND slot=? AND key=?').run(wf, name, row.key);
    const freed = expired.reduce((sum, row) => sum + row.bytes, 0);
    this.stmt('UPDATE state_slots SET items=items-?, bytes=bytes-?, updated_at=? WHERE workflow_id=? AND slot=?').run(expired.length, freed, now, wf, name);
    return expired.length;
  }

  // ---- the operation journal --------------------------------------------------------------------------------------------------------
  /**
   * Journal one operation (inside the caller's transaction). `request` is the journal form (journalRequest). Returns {id, bytes}: the row id
   * and the bytes of its request and result texts (what the run's state budget counts).
   */
  record({ replayKey, runId, nodeKey, request, result, at, replayedFrom = null }) {
    this.#requireTransaction();
    const requestText = canonical(request), resultText = canonical(result);
    const { lastInsertRowid } = this.stmt(`INSERT INTO state_ops(replay_key, run_id, node_key, workflow_id, slot, op, request, result, ok, error_code, at, replayed_from, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(replayKey, runId, nodeKey, request.workflowId, request.slot, request.op, requestText, resultText,
      result.ok ? 1 : 0, result.ok ? null : result.error.code, at, replayedFrom, Date.now());
    return { id: Number(lastInsertRowid), bytes: bytesOf(requestText) + bytesOf(resultText) };
  }
  /** The latest recorded (not itself replayed) operation under a replay key, or null. */
  lookup(replayKey) { return opRow(this.stmt('SELECT * FROM state_ops WHERE replay_key=? AND replayed_from IS NULL ORDER BY id DESC LIMIT 1').get(replayKey)); }
  op(id) { return opRow(this.stmt('SELECT * FROM state_ops WHERE id=?').get(id)); }
  /** The raw row (SQLite columns), for hashing. */
  rawOp(id) { return this.stmt('SELECT * FROM state_ops WHERE id=?').get(id) ?? null; }
  opHash(id) { const raw = this.rawOp(id); return raw ? stateOpHash(raw) : null; }
  opsForRun(runId) { return this.stmt('SELECT * FROM state_ops WHERE run_id=? ORDER BY id').all(runId).map(opRow); }

  // ---- inspection (read-only) -------------------------------------------------------------------------------------------------------
  /** The slots of a workflow: [{slot, declHash, revision, items, bytes, updatedAt}]. `items` counts stored entries, expired ones included until purged. */
  slots(workflowId) {
    return this.stmt('SELECT * FROM state_slots WHERE workflow_id=? ORDER BY slot').all(workflowId)
      .map(r => ({ slot: r.slot, declHash: r.decl_hash, revision: r.revision, items: r.items, bytes: r.bytes, updatedAt: r.updated_at }));
  }
  /** Stored entries of a slot, ordered by key (expired ones included, with their expiresAt), at most `limit`. */
  entries(workflowId, slot, { limit = 1000 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw new FoundryError('STATE_LIMIT', 'limit must be 1..100000');
    return this.stmt('SELECT * FROM state_entries WHERE workflow_id=? AND slot=? ORDER BY key LIMIT ?').all(workflowId, slot, limit).map(entryRow);
  }
}
