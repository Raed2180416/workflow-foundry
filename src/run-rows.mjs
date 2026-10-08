// Per-node run state (research/review-20261007/04-efficiency-rust.md finding 2, ROADMAP-AMENDMENTS R-9).
//
// The run record used to be ONE JSON blob that every event re-read, re-validated and rewrote, so the cost of an event grew with the size of the run.
// It is now split into rows, and an event reads and writes only the rows it touches:
//
//   runs(id, body, rev, bytes)      body = the run HEADER: every scalar field of the old record (status, steps, cost, eventHead, owner, policy,
//                                   approvals, error, verdict, identity ...) but not `input`, `nodes`, `outputs` or `frames`. `rev` counts header
//                                   writes; `bytes` is the stored size of the whole run (header + input + frames + node rows), kept by delta.
//   run_input(run_id, body)         the workflow input (immutable, and the one field that can be large).
//   run_frames(run_id, frame_key, body, rev)
//                                   one row per nested frame ('root/m:0', 'root/loop:2/inner:1' ...): its fields except nodes/outputs
//                                   (contextHash, result, error). The root frame is the header itself.
//   run_nodes(run_id, node_key, frame_key, node_id, status, label, body, output, rev)
//                                   one row per node instance: `body` is the node state, `output` its output (NULL = none; the text 'null' is a
//                                   JSON null output). `status` and `label` (the non-trusted outputLabel) repeat fields of the state so that
//                                   "is anything uncertain" and "which labels reach this reference" are index lookups, not parses.
//
// Every row carries `rev`. A write is a compare-and-swap on the rev read inside the same IMMEDIATE transaction (STATE_CONFLICT otherwise), so a
// writer that lost a race, or a mutation that re-enters the store, cannot overwrite a newer row. The 12 MiB state bound (and the 10 MiB soft bound
// the runtime checks before it starts a node) is kept by the `bytes` counter; each row also has its own bound (STATE_LIMITS), so one oversized
// output cannot hide in a run that is small overall.
//
// Compatibility. `Store.run(id)` returns exactly the record the whole-run store returned. A run record written by that store (runs.body holds
// `nodes`) still loads as it is, and is split into rows by the first write to it (`migrate`); `Store.migrateRuns()` does that for all runs.
// A tool or test that edits a run by writing a whole record into runs.body gets the same treatment: the whole record wins over stale rows.
import { checkData, FoundryError } from './data.mjs';

export const STATE_LIMITS = Object.freeze({
  headerBytes: 4 * 1024 * 1024, inputBytes: 2 * 1024 * 1024, nodeStateBytes: 1024 * 1024, nodeOutputBytes: 2 * 1024 * 1024, frameBytes: 64 * 1024,
  // Checked by the runtime before it starts a node, so room remains for the failure receipt; the hard bound applies to every write.
  budgetBytes: 10 * 1024 * 1024, totalBytes: 12 * 1024 * 1024
});
/** `draft[STATE_BYTES]`: the stored size of the run when the update began (what checkBudget compares with STATE_LIMITS.budgetBytes). */
export const STATE_BYTES = Symbol('foundry.run.stateBytes');
/** `draft[MATERIALIZE]()`: the whole run, as a plain object, including what this update has changed so far. */
export const MATERIALIZE = Symbol('foundry.run.materialize');

const SPECIAL = new Set(['input', 'nodes', 'outputs', 'frames']);
const FRAME_SPECIAL = new Set(['nodes', 'outputs']);
// The same key-sorted JSON as data.mjs `canonical` (which also validates); callers validate first.
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
export const rowText = value => JSON.stringify(sorted(value));
const size = text => text == null ? 0 : Buffer.byteLength(text);
const parse = text => text == null ? undefined : JSON.parse(text);
const statusOf = state => typeof state?.status === 'string' ? state.status : null;
const labelOf = state => typeof state?.outputLabel === 'string' && state.outputLabel && state.outputLabel !== 'trusted' ? state.outputLabel : null;
const isLegacy = header => Object.hasOwn(header, 'nodes');
// Own enumerable fields except `drop`. Reads only the kept keys: the dropped ones may be lazy accessors on a draft.
const without = (object, drop) => Object.fromEntries(Object.keys(object).filter(key => !drop.has(key)).map(key => [key, object[key]]));
const conflict = what => new FoundryError('STATE_CONFLICT', `The ${what} changed while it was being updated (compare-and-swap on its revision failed); nothing was written`);

// Creates the run tables, or upgrades a store written by the whole-run store (its `runs` table gains rev and bytes). Does nothing, and takes no
// write lock, when the store is already current.
export function installRunTables(db) {
  const columns = () => new Set(db.prepare('PRAGMA table_info(runs)').all().map(c => c.name));
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  if (columns().has('bytes') && columns().has('rev') && ['run_input', 'run_frames', 'run_nodes'].every(name => tables.has(name)) && db.prepare('PRAGMA user_version').get().user_version >= 2) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, definition] of [['rev', 'INTEGER NOT NULL DEFAULT 0'], ['bytes', 'INTEGER NOT NULL DEFAULT 0']]) if (!columns().has(name)) db.exec(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS run_input(run_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_frames(run_id TEXT NOT NULL, frame_key TEXT NOT NULL, body TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(run_id, frame_key));
      CREATE TABLE IF NOT EXISTS run_nodes(run_id TEXT NOT NULL, node_key TEXT NOT NULL, frame_key TEXT NOT NULL, node_id TEXT NOT NULL, status TEXT, label TEXT,
        body TEXT, output TEXT, rev INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(run_id, node_key));
      CREATE INDEX IF NOT EXISTS run_nodes_frame ON run_nodes(run_id, frame_key, node_id, status);
      CREATE INDEX IF NOT EXISTS run_nodes_status ON run_nodes(run_id, status);
      CREATE INDEX IF NOT EXISTS run_nodes_label ON run_nodes(run_id, frame_key, label) WHERE label IS NOT NULL;
      PRAGMA user_version = 2;`);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
}

class Row {
  constructor(id, state, output, rev, origState, origOutput, exists) { Object.assign(this, { id, state, output, rev, origState, origOutput, exists }); }
}

// A writable view of the nodes (or outputs) of one frame. Rows are fetched by key on first use, so a mutation that touches three nodes reads
// three rows, however many the frame has; enumerating the keys loads the whole frame in one query.
const mapView = (frame, side) => new Proxy({}, {
  get: (_, key) => typeof key === 'string' ? frame.row(key)[side] : undefined,
  has: (_, key) => typeof key === 'string' && frame.row(key)[side] !== undefined,
  set: (_, key, value) => { if (typeof key !== 'string') return false; frame.row(key)[side] = value; return true; },
  deleteProperty: (_, key) => { if (typeof key === 'string') frame.row(key)[side] = undefined; return true; },
  defineProperty: (_, key, descriptor) => { if (typeof key !== 'string' || !('value' in descriptor)) return false; frame.row(key)[side] = descriptor.value; return true; },
  ownKeys: () => frame.keys(side),
  getOwnPropertyDescriptor: (_, key) => {
    const value = typeof key === 'string' ? frame.row(key)[side] : undefined;
    return value === undefined ? undefined : { value, writable: true, enumerable: true, configurable: true };
  },
  getPrototypeOf: () => Object.prototype
});

class Frame {
  constructor(session, key) {
    this.session = session; this.key = key; this.rows = new Map(); this.listed = false; this.head = key === 'root' ? null : undefined; this.object = null;
    this.nodes = mapView(this, 'state'); this.outputs = mapView(this, 'output');
  }
  get rr() { return this.session.rr; }
  row(id) {
    let row = this.rows.get(id);
    if (row) return row;
    const stored = this.listed ? undefined : this.rr.stmt('SELECT body, output, rev FROM run_nodes WHERE run_id=? AND node_key=?').get(this.session.id, `${this.key}/${id}`);
    row = stored ? new Row(id, parse(stored.body), parse(stored.output), stored.rev, stored.body, stored.output, true) : new Row(id, undefined, undefined, 0, null, null, false);
    this.rows.set(id, row);
    return row;
  }
  list() {
    if (this.listed) return;
    for (const r of this.rr.stmt('SELECT node_id, body, output, rev FROM run_nodes WHERE run_id=? AND frame_key=?').iterate(this.session.id, this.key))
      if (!this.rows.has(r.node_id)) this.rows.set(r.node_id, new Row(r.node_id, parse(r.body), parse(r.output), r.rev, r.body, r.output, true));
    this.listed = true;
  }
  keys(side) { this.list(); return [...this.rows].filter(([, row]) => row[side] !== undefined).map(([id]) => id).sort(); }
  replace(side, value) {
    this.list();
    for (const row of this.rows.values()) row[side] = undefined;
    for (const [id, item] of Object.entries(value ?? {})) this.row(id)[side] = item;
  }
  // The frame's own fields (contextHash, result, error) as an object whose `nodes` and `outputs` are the views above; undefined when there is no such frame.
  look() {
    if (this.head !== undefined) return;
    const stored = this.rr.stmt('SELECT body, rev FROM run_frames WHERE run_id=? AND frame_key=?').get(this.session.id, this.key);
    this.head = stored ? { fields: JSON.parse(stored.body), text: stored.body, rev: stored.rev, exists: true } : { fields: null, text: null, rev: 0, exists: false };
  }
  exists() { this.look(); return this.head === null || this.head.fields !== null; }
  frame() {
    this.look();
    if (!this.head.fields) return undefined;
    if (!this.object) {
      this.object = this.head.fields;
      Object.defineProperties(this.object, {
        nodes: { get: () => this.nodes, set: value => this.replace('state', value), enumerable: true, configurable: true },
        outputs: { get: () => this.outputs, set: value => this.replace('output', value), enumerable: true, configurable: true }
      });
    }
    return this.object;
  }
  create(value) {
    this.look(); this.list();
    for (const row of this.rows.values()) { row.state = undefined; row.output = undefined; }
    this.head = { ...this.head, fields: without(value, FRAME_SPECIAL) }; this.object = null;
    for (const [id, state] of Object.entries(value.nodes ?? {})) this.row(id).state = state;
    for (const [id, output] of Object.entries(value.outputs ?? {})) this.row(id).output = output;
  }
  remove() {
    this.look(); this.list();
    for (const row of this.rows.values()) { row.state = undefined; row.output = undefined; }
    this.head = { ...this.head, fields: null }; this.object = null;
  }
  fieldsText() { return JSON.stringify(without(this.object ?? this.head.fields, FRAME_SPECIAL)); }
}

class Session {
  constructor(rr, id, header, text, rev, bytes) {
    this.rr = rr; this.id = id; this.header = header; this.text = text; this.rev = rev; this.bytes = bytes;
    this.root = new Frame(this, 'root'); this.frames = new Map(); this.input = null; this.complete = false;
    this.draft = this.#draft();
  }
  frame(key) {
    if (key === 'root') return this.root;
    let frame = this.frames.get(key);
    if (!frame) this.frames.set(key, frame = new Frame(this, key));
    return frame;
  }
  // Everything of the run, in one pass (for code that enumerates frames): three queries instead of one per frame.
  loadAll() {
    if (this.complete) return;
    for (const r of this.rr.stmt('SELECT frame_key, body, rev FROM run_frames WHERE run_id=?').iterate(this.id)) {
      const frame = this.frame(r.frame_key);
      if (frame.head === undefined) frame.head = { fields: JSON.parse(r.body), text: r.body, rev: r.rev, exists: true };
    }
    for (const r of this.rr.stmt('SELECT frame_key, node_id, body, output, rev FROM run_nodes WHERE run_id=?').iterate(this.id)) {
      const frame = this.frame(r.frame_key);
      if (!frame.rows.has(r.node_id)) frame.rows.set(r.node_id, new Row(r.node_id, parse(r.body), parse(r.output), r.rev, r.body, r.output, true));
    }
    for (const frame of [this.root, ...this.frames.values()]) { frame.listed = true; frame.look(); }
    this.complete = true;
  }
  getInput() {
    if (!this.input) { const stored = this.rr.stmt('SELECT body FROM run_input WHERE run_id=?').get(this.id); this.input = { value: parse(stored?.body), text: stored?.body ?? null }; }
    return this.input.value;
  }
  setInput(value) { this.getInput(); this.input.value = value; }
  #draft() {
    const session = this, draft = this.header, frames = new Proxy({}, {
      get: (_, key) => typeof key === 'string' && key !== 'root' ? session.frame(key).frame() : undefined,
      has: (_, key) => typeof key === 'string' && key !== 'root' && session.frame(key).exists(),
      set: (_, key, value) => { if (typeof key !== 'string' || key === 'root') return false; session.frame(key).create(value); return true; },
      deleteProperty: (_, key) => { if (typeof key === 'string' && key !== 'root') session.frame(key).remove(); return true; },
      defineProperty: (_, key, descriptor) => { if (typeof key !== 'string' || key === 'root' || !('value' in descriptor)) return false; session.frame(key).create(descriptor.value); return true; },
      ownKeys: () => { session.loadAll(); return [...session.frames].filter(([, frame]) => frame.exists()).map(([key]) => key).sort(); },
      getOwnPropertyDescriptor: (_, key) => {
        const value = typeof key === 'string' && key !== 'root' ? session.frame(key).frame() : undefined;
        return value === undefined ? undefined : { value, writable: true, enumerable: true, configurable: true };
      },
      getPrototypeOf: () => Object.prototype
    });
    Object.defineProperties(draft, {
      input: { get: () => session.getInput(), set: value => session.setInput(value), enumerable: true, configurable: true },
      nodes: { get: () => session.root.nodes, set: value => session.root.replace('state', value), enumerable: true, configurable: true },
      outputs: { get: () => session.root.outputs, set: value => session.root.replace('output', value), enumerable: true, configurable: true },
      frames: { get: () => frames, set: value => { session.loadAll(); for (const frame of session.frames.values()) frame.remove(); for (const [key, item] of Object.entries(value ?? {})) session.frame(key).create(item); }, enumerable: true, configurable: true },
      [STATE_BYTES]: { get: () => session.bytes },
      [MATERIALIZE]: { value: () => session.materialize() }
    });
    return draft;
  }
  fields() { return without(this.header, SPECIAL); }
  materialize() {
    this.loadAll();
    const run = { ...this.fields() };
    if (this.getInput() !== undefined) run.input = this.input.value;
    const plain = frame => ({
      nodes: Object.fromEntries(frame.keys('state').map(id => [id, frame.rows.get(id).state])),
      outputs: Object.fromEntries(frame.keys('output').map(id => [id, frame.rows.get(id).output]))
    });
    Object.assign(run, plain(this.root));
    run.frames = Object.fromEntries([...this.frames].filter(([, frame]) => frame.exists()).sort(([a], [b]) => a < b ? -1 : 1).map(([key, frame]) => [key, { ...frame.head.fields, ...plain(frame) }]));
    return JSON.parse(JSON.stringify(run));
  }
  // Write what changed. Returns the header as stored (a plain object).
  flush() {
    const { rr } = this, limits = rr.limits;
    let delta = 0;
    const changed = (result, what) => { if (result.changes !== 1) throw conflict(what); };
    if (this.input) {
      const value = this.input.value, now = value === undefined ? null : JSON.stringify(value);
      if (now !== this.input.text) {
        let text = null;
        if (value === undefined) rr.stmt('DELETE FROM run_input WHERE run_id=?').run(this.id);
        else {
          checkData(value, { maxBytes: limits.inputBytes }); text = rowText(value);
          rr.stmt('INSERT INTO run_input(run_id, body) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET body=excluded.body').run(this.id, text);
        }
        delta += size(text) - size(this.input.text);
      }
    }
    for (const frame of [this.root, ...this.frames.values()]) {
      if (frame.key !== 'root' && frame.head) {
        const head = frame.head, now = head.fields === null ? null : frame.fieldsText();
        if (now !== head.text) {
          const key = `frame ${frame.key}`;
          if (now === null) { if (head.exists) { changed(rr.stmt('DELETE FROM run_frames WHERE run_id=? AND frame_key=? AND rev=?').run(this.id, frame.key, head.rev), key); delta -= size(head.text); } }
          else {
            const fields = frame.object ?? head.fields;
            checkData(without(fields, FRAME_SPECIAL), { maxBytes: limits.frameBytes });
            const text = rowText(without(fields, FRAME_SPECIAL));
            if (head.exists) changed(rr.stmt('UPDATE run_frames SET body=?, rev=rev+1 WHERE run_id=? AND frame_key=? AND rev=?').run(text, this.id, frame.key, head.rev), key);
            else changed(rr.stmt('INSERT INTO run_frames(run_id, frame_key, body, rev) VALUES(?,?,?,0)').run(this.id, frame.key, text), key);
            delta += size(text) - size(head.text);
          }
        }
      }
      for (const row of frame.rows.values()) {
        const state = row.state === undefined ? null : JSON.stringify(row.state), output = row.output === undefined ? null : JSON.stringify(row.output);
        if (state === row.origState && output === row.origOutput) continue;
        const key = `${frame.key}/${row.id}`, what = `node ${key}`;
        if (row.state !== undefined) checkData(row.state, { maxBytes: limits.nodeStateBytes });
        if (row.output !== undefined) checkData(row.output, { maxBytes: limits.nodeOutputBytes });
        const body = row.state === undefined ? null : rowText(row.state), out = row.output === undefined ? null : rowText(row.output);
        if (body === null && out === null) {
          if (row.exists) changed(rr.stmt('DELETE FROM run_nodes WHERE run_id=? AND node_key=? AND rev=?').run(this.id, key, row.rev), what);
        } else if (row.exists) {
          changed(rr.stmt('UPDATE run_nodes SET status=?, label=?, body=?, output=?, rev=rev+1 WHERE run_id=? AND node_key=? AND rev=?')
            .run(statusOf(row.state), labelOf(row.state), body, out, this.id, key, row.rev), what);
        } else {
          try { rr.stmt('INSERT INTO run_nodes(run_id, node_key, frame_key, node_id, status, label, body, output, rev) VALUES(?,?,?,?,?,?,?,?,0)').run(this.id, key, frame.key, row.id, statusOf(row.state), labelOf(row.state), body, out); }
          catch (error) { throw /constraint/i.test(String(error.message)) ? conflict(what) : error; }
        }
        delta += size(body) + size(out) - size(row.origState) - size(row.origOutput);
      }
    }
    const fields = this.fields();
    checkData(fields, { maxBytes: limits.headerBytes });
    const text = rowText(fields);
    delta += size(text) - size(this.text);
    const total = this.bytes + delta;
    if (total > limits.totalBytes) throw new FoundryError('DATA_LIMIT', `JSON bytes exceed the supported limit (the run's state would be ${total} bytes; the bound is ${limits.totalBytes})`);
    changed(rr.stmt('UPDATE runs SET body=?, rev=rev+1, bytes=? WHERE id=? AND rev=?').run(text, total, this.id, this.rev), 'run header');
    return JSON.parse(text);
  }
}

// The run record put back together from a header: input, frames and node rows. Keys are in sorted order at every level the record had them
// (it was stored as canonical JSON), so what is printed or served from it keeps its key order.
const inOrder = object => Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]));
function assembleRun(prepare, id, header) {
  const run = { ...header }, input = prepare('SELECT body FROM run_input WHERE run_id=?').get(id);
  if (input) run.input = JSON.parse(input.body);
  run.nodes = {}; run.outputs = {}; run.frames = {};
  for (const r of prepare('SELECT frame_key, body FROM run_frames WHERE run_id=? ORDER BY frame_key').iterate(id)) run.frames[r.frame_key] = inOrder({ ...JSON.parse(r.body), nodes: {}, outputs: {} });
  for (const r of prepare('SELECT frame_key, node_id, body, output FROM run_nodes WHERE run_id=? ORDER BY frame_key, node_id').iterate(id)) {
    const target = r.frame_key === 'root' ? run : run.frames[r.frame_key];
    if (!target) continue; // a node row of a frame that has no frame row is not part of the record
    if (r.body !== null) target.nodes[r.node_id] = JSON.parse(r.body);
    if (r.output !== null) target.outputs[r.node_id] = JSON.parse(r.output);
  }
  return inOrder(run);
}

export class RunRows {
  #statements = new Map(); #database = null;
  constructor(store) { this.store = store; }
  get db() { return this.store.db; }
  get limits() { return this.store.limits; }
  // Prepared statements are cached per database handle (a caller may swap the handle; its statements are then prepared afresh).
  stmt(sql) {
    const db = this.db;
    if (db !== this.#database) { this.#statements.clear(); this.#database = db; }
    let statement = this.#statements.get(sql);
    if (!statement) this.#statements.set(sql, statement = db.prepare(sql));
    return statement;
  }
  snapshot(fn) {
    if (this.db.isTransaction) return fn();
    this.db.exec('BEGIN');
    try { return fn(); } finally { this.db.exec('COMMIT'); }
  }

  // ---- whole-run reads -------------------------------------------------------------------------------------------------------------------
  raw(id) {
    const row = this.stmt('SELECT body, rev, bytes FROM runs WHERE id=?').get(id);
    if (!row) throw new FoundryError('NOT_FOUND', 'Run not found');
    return row;
  }
  /** The run record: header, input, frames and node rows put back together (a record written by the whole-run store is returned as it is). */
  run(id) {
    return this.snapshot(() => {
      const header = JSON.parse(this.raw(id).body);
      return isLegacy(header) ? header : this.assemble(id, header);
    });
  }
  assemble(id, header) { return assembleRun(sql => this.stmt(sql), id, header); }

  // ---- targeted reads (the runtime's hot path): each reads only what it names -----------------------------------------------------------------
  /** The run's own fields (status, steps, cost, eventHead, owner, policy, deadline, approvals ...): no input, nodes, outputs or frames. */
  header(id) {
    const header = JSON.parse(this.raw(id).body);
    return isLegacy(header) ? without(header, SPECIAL) : header;
  }
  nodeState(id, frameKey, nodeId) { return parse(this.stmt('SELECT body FROM run_nodes WHERE run_id=? AND node_key=?').get(id, `${frameKey}/${nodeId}`)?.body); }
  nodeStates(id, frameKey, nodeIds) {
    const states = {};
    for (const nodeId of nodeIds) { const state = this.nodeState(id, frameKey, nodeId); if (state !== undefined) states[nodeId] = state; }
    return states;
  }
  nodeOutput(id, frameKey, nodeId) { return parse(this.stmt('SELECT output FROM run_nodes WHERE run_id=? AND node_key=?').get(id, `${frameKey}/${nodeId}`)?.output); }
  /** Map(node id -> status) for the nodes of one frame (an index-only scan). */
  statuses(id, frameKey) {
    const statuses = new Map();
    for (const r of this.stmt('SELECT node_id, status FROM run_nodes WHERE run_id=? AND frame_key=?').iterate(id, frameKey)) if (r.status !== null) statuses.set(r.node_id, r.status);
    return statuses;
  }
  /** The outputs of one frame, as the record's `outputs` object. */
  frameOutputs(id, frameKey) {
    const outputs = {};
    for (const r of this.stmt('SELECT node_id, output FROM run_nodes WHERE run_id=? AND frame_key=? AND output IS NOT NULL ORDER BY node_id').iterate(id, frameKey)) outputs[r.node_id] = JSON.parse(r.output);
    return outputs;
  }
  /** The ids of the nodes of one frame that have an output. */
  outputKeys(id, frameKey) { return this.stmt('SELECT node_id FROM run_nodes WHERE run_id=? AND frame_key=? AND output IS NOT NULL ORDER BY node_id').all(id, frameKey).map(r => r.node_id); }
  /** The fields of one nested frame (contextHash, result, error), or undefined. */
  frame(id, frameKey) { return parse(this.stmt('SELECT body FROM run_frames WHERE run_id=? AND frame_key=?').get(id, frameKey)?.body); }
  anyWithStatus(id, ...statuses) { return statuses.some(status => this.stmt('SELECT 1 AS found FROM run_nodes WHERE run_id=? AND status=? LIMIT 1').get(id, status) !== undefined); }
  /** Every node row in one of the given statuses, in any frame: [{frameKey, nodeId, status, state}]. */
  withStatus(id, ...statuses) {
    return statuses.flatMap(status => this.stmt('SELECT frame_key, node_id, body FROM run_nodes WHERE run_id=? AND status=? ORDER BY frame_key, node_id').all(id, status)
      .map(r => ({ frameKey: r.frame_key, nodeId: r.node_id, status, state: JSON.parse(r.body) })));
  }
  /** Map(node id -> label) of the nodes of a frame whose output is not trusted; with `nodeIds`, only those nodes. */
  labels(id, frameKey, nodeIds = null) {
    const labels = new Map();
    if (nodeIds) {
      for (const nodeId of nodeIds) { const r = this.stmt('SELECT label FROM run_nodes WHERE run_id=? AND node_key=?').get(id, `${frameKey}/${nodeId}`); if (r?.label) labels.set(nodeId, r.label); }
    } else {
      for (const r of this.stmt('SELECT node_id, label FROM run_nodes WHERE run_id=? AND frame_key=? AND label IS NOT NULL').iterate(id, frameKey)) labels.set(r.node_id, r.label);
    }
    return labels;
  }
  /** The distinct non-trusted labels in the frames whose key starts with `prefix` (exact: the frame `prefix` and its descendants `prefix/...`). */
  frameLabels(id, prefix, { exact = false } = {}) {
    const rows = exact
      ? [...this.stmt('SELECT DISTINCT label FROM run_nodes WHERE run_id=? AND frame_key=? AND label IS NOT NULL').all(id, prefix),
        ...this.stmt('SELECT DISTINCT label FROM run_nodes WHERE run_id=? AND frame_key>=? AND frame_key<? AND label IS NOT NULL').all(id, `${prefix}/`, `${prefix}0`)]
      : this.stmt('SELECT DISTINCT label FROM run_nodes WHERE run_id=? AND frame_key>=? AND frame_key<? AND label IS NOT NULL').all(id, prefix, `${prefix}\uffff`);
    return [...new Set(rows.map(r => r.label))];
  }

  // ---- writes ----------------------------------------------------------------------------------------------------------------------------
  /** Start an update of one run inside the caller's transaction. A whole-run record is split into rows first. */
  open(id) {
    let row = this.raw(id), header = JSON.parse(row.body);
    if (isLegacy(header)) { this.migrate(id, header); row = this.raw(id); header = JSON.parse(row.body); }
    return new Session(this, id, header, row.body, row.rev, row.bytes);
  }
  /** Write a new run: header and input (the caller appends the birth event and then stores the head). */
  insert(run) {
    const header = without(run, SPECIAL), l = this.limits;
    checkData(header, { maxBytes: l.headerBytes }); checkData(run.input, { maxBytes: l.inputBytes });
    const text = rowText(header), input = rowText(run.input);
    this.stmt('INSERT INTO runs(id, body, rev, bytes) VALUES(?,?,0,?)').run(run.id, text, size(text) + size(input));
    this.stmt('INSERT INTO run_input(run_id, body) VALUES(?,?)').run(run.id, input);
  }
  setHeader(run) {
    const header = without(run, SPECIAL), raw = this.raw(run.id), text = rowText(header);
    this.stmt('UPDATE runs SET body=?, rev=rev+1, bytes=? WHERE id=? AND rev=?').run(text, raw.bytes + size(text) - size(raw.body), run.id, raw.rev);
  }
  /** Split a whole-run record into rows (replacing any rows the run already has). Returns the stored size. */
  migrate(id, legacy) {
    const { nodes = {}, outputs = {}, frames = {}, input, ...rest } = legacy, big = { maxBytes: 16 * 1024 * 1024 };
    for (const sql of ['DELETE FROM run_nodes WHERE run_id=?', 'DELETE FROM run_frames WHERE run_id=?', 'DELETE FROM run_input WHERE run_id=?']) this.stmt(sql).run(id);
    let bytes = 0;
    const put = (frameKey, state, output, nodeId) => {
      const body = state === undefined ? null : rowText(checkData(state, big)), out = output === undefined ? null : rowText(checkData(output, big));
      this.stmt('INSERT INTO run_nodes(run_id, node_key, frame_key, node_id, status, label, body, output, rev) VALUES(?,?,?,?,?,?,?,?,0)')
        .run(id, `${frameKey}/${nodeId}`, frameKey, nodeId, statusOf(state), labelOf(state), body, out);
      bytes += size(body) + size(out);
    };
    const frameRows = (frameKey, frameNodes, frameOutputs) => {
      for (const nodeId of new Set([...Object.keys(frameNodes ?? {}), ...Object.keys(frameOutputs ?? {})])) put(frameKey, frameNodes?.[nodeId], frameOutputs?.[nodeId], nodeId);
    };
    if (input !== undefined) { const text = rowText(checkData(input, big)); this.stmt('INSERT INTO run_input(run_id, body) VALUES(?,?)').run(id, text); bytes += size(text); }
    frameRows('root', nodes, outputs);
    for (const [frameKey, frame] of Object.entries(frames)) {
      const head = rowText(checkData(without(frame ?? {}, FRAME_SPECIAL), big));
      this.stmt('INSERT INTO run_frames(run_id, frame_key, body, rev) VALUES(?,?,?,0)').run(id, frameKey, head);
      bytes += size(head); frameRows(frameKey, frame?.nodes, frame?.outputs);
    }
    const text = rowText(checkData(rest, big));
    this.stmt('UPDATE runs SET body=?, rev=rev+1, bytes=? WHERE id=?').run(text, bytes + size(text), id);
    return bytes + size(text);
  }
  /** Split every whole-run record in this store into rows. Returns {migrated, rows} (runs that were already rows are left alone). */
  migrateAll() {
    let migrated = 0;
    for (const { id } of this.stmt('SELECT id FROM runs ORDER BY rowid').all()) {
      const header = JSON.parse(this.raw(id).body);
      if (!isLegacy(header)) continue;
      this.store.transaction(() => { const current = JSON.parse(this.raw(id).body); if (isLegacy(current)) { this.migrate(id, current); migrated++; } });
    }
    return { migrated, runs: this.stmt('SELECT COUNT(*) AS n FROM runs').get().n };
  }
}

